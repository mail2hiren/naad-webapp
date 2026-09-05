import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type MouseEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { useClinic } from '../context/ClinicContext';
import { useAmbientIntake } from '../hooks/useAmbientIntake';
import { useRealAmbientCapture, type ExtractResult } from '../hooks/useRealAmbientCapture';
import { AmbientOrb, Card, Btn, Pill, SectionHead, Field, inputCls, Modal } from '../components/ui';
import Shell from '../components/Shell';
import { supabase, isMockBackend } from '../lib/supabaseClient';
import type { DocumentLabel, TriageVitals } from '../types/db';

/** Local, not-yet-registered doc attached to the in-progress walk-in draft.
 * The real `documents` row is inserted the instant a file is attached (see
 * attachDocFromFile/attachDoc below) -- this array only mirrors it locally
 * so the preview cards render without waiting on a realtime round-trip. */
interface DraftDoc { id: string; label: DocumentLabel; fileName: string }

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function specialtyFor(complaint: string): 'Orthopedics' | 'Critical Care' {
  if (/chest|cough|breath|oxygen/i.test(complaint)) return 'Critical Care';
  if (/knee|joint|fall/i.test(complaint)) return 'Orthopedics';
  return 'Orthopedics';
}

/** Best-effort classification of a dropped file's clinical type from its
 * filename, for the drag-and-drop asset zone (Clinical_User_Stories row
 * 2.6) -- a real DMS would inspect DICOM/HL7 metadata; a filename heuristic
 * is the honest equivalent for a demo asset with no real binary content. */
function classifyFileName(name: string): DocumentLabel {
  if (/x-?ray/i.test(name)) return 'xray';
  if (/mri|blood|lab|report/i.test(name)) return 'report';
  return 'other';
}

export default function ReceptionView() {
  const { practitioner } = useAuth();
  const { orgId, patients, practitioners, appointments, pushToast, logAudit } = useClinic();

  // ---- Telephonic appointment form -------------------------------------
  const [apName, setApName] = useState('');
  const [apPhone, setApPhone] = useState('');
  const [apPractitionerId, setApPractitionerId] = useState('');
  const [apWhen, setApWhen] = useState('');
  const [apSaving, setApSaving] = useState(false);
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set());

  const bookablePractitioners = useMemo(
    () => practitioners.filter((p) => p.role === 'surgeon' || p.role === 'physio'),
    [practitioners],
  );
  const scheduledAppointments = useMemo(
    () => appointments.filter((a) => a.status === 'scheduled'),
    [appointments],
  );

  async function handleBookAppointment(e: FormEvent) {
    e.preventDefault();
    if (!apName.trim() || !apPhone.trim() || !apPractitionerId || !apWhen.trim()) return;
    setApSaving(true);
    try {
      let patientId: string;
      const existing = patients.find((p) => p.phone === apPhone.trim());
      if (existing) {
        patientId = existing.id;
      } else {
        patientId = newId('p');
        await supabase.from('patients').insert({
          id: patientId, org_id: orgId, auth_user_id: null, mrn: null, name: apName.trim(), age: null,
          gender: null, phone: apPhone.trim(), conditions: [], allergies: [], medications: [],
          queue_status: 'new', urgency_level: 'routine', draft_summary: null, assigned_practitioner_id: null,
          preferred_language: 'en', phone_verified: false, journey_stage: null, journey_stage_history: [],
          discharged_at: null, discharge_summary: null, intake_state: {}, triage: {},
        });
      }
      const chosen = bookablePractitioners.find((p) => p.id === apPractitionerId);
      await supabase.from('appointments').insert({
        id: newId('ap'), org_id: orgId, patient_id: patientId, specialty: chosen?.specialty ?? null,
        date: apWhen.trim(), reason: null, practitioner_id: apPractitionerId, status: 'scheduled',
        start_time: apWhen.trim(), duration_minutes: 20, requested_by_patient: false,
      });
      await logAudit('reception-book-appointment', `${apName.trim()} with ${chosen?.name ?? apPractitionerId}`);
      pushToast({ tone: 'ok', title: 'Appointment scheduled', detail: `${apName.trim()} · ${apWhen.trim()}` });
      setApName(''); setApPhone(''); setApPractitionerId(''); setApWhen('');
    } finally {
      setApSaving(false);
    }
  }

  async function handleCheckIn(appointmentId: string, patientId: string) {
    setLeavingIds((prev) => new Set(prev).add(appointmentId));
    await supabase.from('appointments').update({ status: 'checked_in' }).eq('id', appointmentId);
    // Straight to 'waiting_doctor' -- this is what actually lands the patient
    // in the assigned doctor's queue (DoctorView filters on QUEUE_STATUSES,
    // which does not include 'checking_in'). 'checking_in' is reserved for a
    // future in-progress-paperwork state; a checked-in phone appointment has
    // no further front-desk step before the doctor, so it should be visible
    // to the doctor immediately -- that's the zero-refresh sync this button
    // exists for.
    await supabase.from('patients').update({ queue_status: 'waiting_doctor' }).eq('id', patientId);
    setTimeout(() => {
      setLeavingIds((prev) => { const n = new Set(prev); n.delete(appointmentId); return n; });
    }, 250);
  }

  // ---- Live "In Queue" board --------------------------------------------
  const inQueuePatients = useMemo(
    () => patients.filter((p) =>
      p.queue_status === 'checking_in' || p.queue_status === 'waiting_doctor' || p.queue_status === 'awaiting_verification'),
    [patients],
  );

  function practitionerName(id: string | null): string {
    if (!id) return 'Unassigned';
    return practitioners.find((p) => p.id === id)?.name ?? 'Unassigned';
  }

  // ---- AI Guided Intake / walk-in registration --------------------------
  const [inName, setInName] = useState('');
  const [inAge, setInAge] = useState('');
  const [inPhone, setInPhone] = useState('');
  const [inComplaint, setInComplaint] = useState('');
  const [inHeight, setInHeight] = useState('');
  const [inWeight, setInWeight] = useState('');
  const [triageNotes, setTriageNotes] = useState('');
  const [draftDocs, setDraftDocs] = useState<DraftDoc[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [registering, setRegistering] = useState(false);

  // A real `patients` row for the walk-in currently mid-intake, created
  // lazily the moment the first thing that actually needs to persist
  // happens (Pause/Escalate, or a document attach) -- not at "Start
  // Ambient AI Registration", since per the operational spec the live
  // transcript/checklist/chip stream is a local UI buffer only until then.
  // walkInPatientIdRef is the synchronous source of truth read by
  // handlers; walkInPatientId (state) exists purely so useAmbientIntake's
  // persistence target updates once the row exists.
  const walkInPatientIdRef = useRef<string | null>(null);
  const walkInCreatePromiseRef = useRef<Promise<string> | null>(null);
  const [walkInPatientId, setWalkInPatientId] = useState<string | null>(null);
  const scriptedTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const intake = useAmbientIntake(walkInPatientId);

  // Real ambient AI (Deepgram transcription + Claude structured extraction
  // via the `transcribe-and-extract` edge function) -- gated behind
  // `isMockBackend` so mock mode / Playwright CI keeps using the scripted
  // simulation above completely unchanged. `patientId` closes over the
  // component's `walkInPatientId` state, so `ensureWalkInPatientId()` must
  // resolve (and trigger the resulting re-render) before `.start()`/`.stop()`
  // are called from a click that needs the real value -- see the sequencing
  // note in startRealAmbientIntake/stopRealAmbientIntake below.
  const realCapture = useRealAmbientCapture({ stage: 'reception', patientId: walkInPatientId, encounterId: null });
  const [typedIntakeText, setTypedIntakeText] = useState('');
  const [showTypedIntake, setShowTypedIntake] = useState(false);

  // Surface any real-capture failure as a toast, whenever it occurs -- mic
  // permission denied, network unreachable, budget exceeded, no speech,
  // missing server keys, etc. Never blocks the workflow: reception can
  // always fall back to typing (the box below, or the plain intake fields).
  useEffect(() => {
    if (!isMockBackend && realCapture.error) {
      pushToast({ tone: 'warning', title: 'Ambient AI', detail: realCapture.error.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realCapture.error]);

  /** Folds the real structured extraction into the existing UI rather than
   * adding new panels: the diarized transcript feeds the same keyword-based
   * completeness/recommendation tracking `useAmbientIntake` already renders,
   * and the structured fields Claude extracted are appended to the existing
   * Patient-Confirmed Notes box so reception can review/edit before
   * registering -- exactly the human-in-the-loop pattern the rest of this
   * screen already follows. */
  function applyReceptionExtraction(result: ExtractResult) {
    const ex = result.extracted as {
      reasonForVisit?: string; duration?: string; trauma?: boolean; priorTreatment?: string;
      reportsAvailable?: boolean; allergiesMentioned?: string; medicationsMentioned?: string; referringDoctor?: string;
    };
    if (result.diarizedText) intake.appendTranscript(result.diarizedText);
    if (ex.reasonForVisit && !inComplaint.trim()) setInComplaint(ex.reasonForVisit);
    const lines: string[] = [];
    if (ex.reasonForVisit) lines.push(`Reason for visit: ${ex.reasonForVisit}`);
    if (ex.duration) lines.push(`Duration: ${ex.duration}`);
    if (ex.trauma) lines.push('Trauma: reported');
    if (ex.priorTreatment) lines.push(`Prior treatment: ${ex.priorTreatment}`);
    if (ex.reportsAvailable) lines.push('Existing reports: patient mentioned having reports/imaging');
    if (ex.allergiesMentioned) lines.push(`Allergies mentioned: ${ex.allergiesMentioned}`);
    if (ex.medicationsMentioned) lines.push(`Medications mentioned: ${ex.medicationsMentioned}`);
    if (ex.referringDoctor) lines.push(`Referring doctor: ${ex.referringDoctor}`);
    if (lines.length) {
      const block = `🤖 AI Extracted Summary:\n${lines.join('\n')}`;
      setTriageNotes((prev) => (prev ? `${prev}\n\n${block}` : block));
    }
    pushToast({ tone: 'ok', title: 'Ambient AI extraction complete', detail: `${result.usage.deepgramMinutes.toFixed(1)} min transcribed` });
  }

  async function handleAmbientMicClick() {
    if (isMockBackend) { startAmbientIntake(); return; }
    if (realCapture.status === 'recording') {
      const result = await realCapture.stop();
      if (result) applyReceptionExtraction(result);
      return;
    }
    if (realCapture.status === 'processing') return;
    await ensureWalkInPatientId();
    await realCapture.start();
  }

  async function handleSubmitTypedIntake() {
    if (isMockBackend || !typedIntakeText.trim()) return;
    await ensureWalkInPatientId();
    const result = await realCapture.submitTypedText(typedIntakeText.trim());
    if (result) {
      applyReceptionExtraction(result);
      setTypedIntakeText('');
      setShowTypedIntake(false);
    }
  }

  const autoSpecialty = useMemo(() => specialtyFor(inComplaint), [inComplaint]);
  const autoAssignedDoctor = useMemo(
    () => practitioners.find((p) => p.specialty === autoSpecialty) ?? null,
    [practitioners, autoSpecialty],
  );

  /** Returns the walk-in's real patient id, creating the row on first use
   * (reusing an existing patient by phone, same dedup rule the rest of this
   * screen already follows) and caching the in-flight insert so a Pause
   * click and a simultaneous document drop can't mint two rows. */
  async function ensureWalkInPatientId(): Promise<string> {
    if (walkInPatientIdRef.current) return walkInPatientIdRef.current;
    if (walkInCreatePromiseRef.current) return walkInCreatePromiseRef.current;
    const promise = (async () => {
      const existing = inPhone.trim() ? patients.find((p) => p.phone === inPhone.trim()) : undefined;
      let patientId: string;
      if (existing) {
        patientId = existing.id;
      } else {
        patientId = newId('p');
        await supabase.from('patients').insert({
          id: patientId, org_id: orgId, auth_user_id: null, mrn: null,
          name: inName.trim() || 'Walk-in patient', age: inAge ? Number(inAge) : null,
          gender: null, phone: inPhone.trim() || null, conditions: [], allergies: [], medications: [],
          queue_status: 'new', urgency_level: 'routine', draft_summary: null,
          assigned_practitioner_id: autoAssignedDoctor?.id ?? null, preferred_language: 'en',
          phone_verified: false, journey_stage: null, journey_stage_history: [],
          discharged_at: null, discharge_summary: null, intake_state: {}, triage: {},
        });
      }
      walkInPatientIdRef.current = patientId;
      setWalkInPatientId(patientId);
      return patientId;
    })();
    walkInCreatePromiseRef.current = promise;
    return promise;
  }

  function clearScriptedTimeouts() {
    scriptedTimeoutsRef.current.forEach((t) => clearTimeout(t));
    scriptedTimeoutsRef.current = [];
  }

  function startAmbientIntake() {
    if (intake.isRecording) { clearScriptedTimeouts(); intake.setIsRecording(false); return; }
    intake.setIsRecording(true);
    const lines = [
      `Patient states: my name is ${inName.trim() || 'the patient'}.`,
      'I fell yesterday evening and twisted my knee, there is swelling and pain.',
      'The pain has been constant since last night, worse when I try to walk.',
    ];
    lines.forEach((line, i) => {
      scriptedTimeoutsRef.current.push(setTimeout(() => intake.appendTranscript(line), (i + 1) * 700));
    });
    scriptedTimeoutsRef.current.push(setTimeout(() => intake.setIsRecording(false), (lines.length + 1) * 700));
  }

  function handleAnswerChip(id: string, text: string) {
    intake.answerRecommendation(id);
    intake.appendTranscript(`${text} — yes, confirmed.`);
    // Auto-fills the structured triage box (row 2.4), distinct from the raw
    // conversational transcript above.
    setTriageNotes((prev) => (prev ? `${prev}\n${text}: confirmed.` : `${text}: confirmed.`));
  }

  function handleDismissChip(e: MouseEvent, id: string) {
    e.stopPropagation();
    intake.dismissRecommendation(id);
  }

  async function attachDocFromFile(file: File) {
    const patientId = await ensureWalkInPatientId();
    const label = classifyFileName(file.name);
    const id = newId('doc');
    await supabase.from('documents').insert({
      id, org_id: orgId, patient_id: patientId, label, file_name: file.name,
      storage_path: `mock/${file.name}`, uploaded_by: practitioner?.name ?? null,
    });
    setDraftDocs((prev) => [...prev, { id, label, fileName: file.name }]);
  }

  async function attachDoc(kind: 'X-Ray' | 'MRI' | 'Blood Report') {
    const label: DocumentLabel = kind === 'X-Ray' ? 'xray' : kind === 'Blood Report' ? 'report' : 'other';
    const fileName = `${kind} — ${inName.trim() || 'patient'}.pdf`;
    const patientId = await ensureWalkInPatientId();
    const id = newId('doc');
    await supabase.from('documents').insert({
      id, org_id: orgId, patient_id: patientId, label, file_name: fileName,
      storage_path: `mock/${label}.pdf`, uploaded_by: practitioner?.name ?? null,
    });
    setDraftDocs((prev) => [...prev, { id, label, fileName }]);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) { e.preventDefault(); setDragActive(true); }
  function handleDragLeave() { setDragActive(false); }
  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    for (const file of files) await attachDocFromFile(file);
  }

  async function handleRegisterAndQueue() {
    if (!inName.trim()) return;
    setRegistering(true);
    try {
      const assignedId = autoAssignedDoctor?.id ?? null;
      const triage: TriageVitals = {
        height: inHeight ? Number(inHeight) : null,
        weight: inWeight ? Number(inWeight) : null,
        complaints: inComplaint.trim(),
        notes: triageNotes.trim() || undefined,
      };
      const intakeState = { rawTranscriptStream: intake.transcript, completenessCheck: intake.completeness };
      let patientId: string;

      if (walkInPatientIdRef.current) {
        // The row already exists (created early by a Pause/Escalate or a
        // document attach) -- update it in place rather than inserting a
        // second row for the same walk-in.
        patientId = walkInPatientIdRef.current;
        await supabase.from('patients').update({
          name: inName.trim(), age: inAge ? Number(inAge) : null, phone: inPhone.trim() || null,
          queue_status: 'waiting_doctor', urgency_level: 'routine', triage, intake_state: intakeState,
          assigned_practitioner_id: assignedId,
        }).eq('id', patientId);
      } else {
        const existing = inPhone.trim() ? patients.find((p) => p.phone === inPhone.trim()) : undefined;
        if (existing) {
          patientId = existing.id;
          await supabase.from('patients').update({
            name: inName.trim(), age: inAge ? Number(inAge) : existing.age, phone: inPhone.trim() || existing.phone,
            queue_status: 'waiting_doctor', urgency_level: 'routine', triage, intake_state: intakeState,
            assigned_practitioner_id: assignedId,
          }).eq('id', existing.id);
        } else {
          patientId = newId('p');
          await supabase.from('patients').insert({
            id: patientId, org_id: orgId, auth_user_id: null, mrn: null, name: inName.trim(),
            age: inAge ? Number(inAge) : null, gender: 'Other', phone: inPhone.trim() || null,
            conditions: [], allergies: [], medications: [], queue_status: 'waiting_doctor', urgency_level: 'routine',
            draft_summary: null, assigned_practitioner_id: assignedId, preferred_language: 'en', phone_verified: false,
            journey_stage: null, journey_stage_history: [], discharged_at: null, discharge_summary: null,
            intake_state: intakeState, triage,
          });
        }
      }

      // Documents were already inserted for real the moment each was
      // attached/dropped (see attachDoc/attachDocFromFile) -- nothing left
      // to flush here.

      clearScriptedTimeouts();
      intake.reset();
      setInName(''); setInAge(''); setInPhone(''); setInComplaint(''); setInHeight(''); setInWeight('');
      setDraftDocs([]); setTriageNotes(''); setPauseNote(''); setPauseOpen(false);
      setWalkInPaused(false); setWalkInPauseOpen(false); setWalkInQueryNote('');
      walkInPatientIdRef.current = null; walkInCreatePromiseRef.current = null; setWalkInPatientId(null);

      pushToast({ tone: 'ok', title: 'Patient registered and sent to queue' });
      await logAudit('reception-register', inName.trim());
    } finally {
      setRegistering(false);
    }
  }

  // ---- Walk-in Intake Pause Gate (Clinical_User_Stories row 2.5) --------
  // Lives right beside the ambient orb, operating on the walk-in draft
  // itself -- distinct from the "escalate an already-queued patient" gate
  // further below, which targets a patient already selected from the Live
  // In Queue board.
  const [walkInPaused, setWalkInPaused] = useState(false);
  const [walkInPauseOpen, setWalkInPauseOpen] = useState(false);
  const [walkInQueryNote, setWalkInQueryNote] = useState('');
  const [pausingWalkIn, setPausingWalkIn] = useState(false);
  const [sendingWalkInQuery, setSendingWalkInQuery] = useState(false);

  async function handlePauseWalkIn() {
    setPausingWalkIn(true);
    try {
      clearScriptedTimeouts();
      intake.setIsRecording(false);
      setWalkInPaused(true);
      const patientId = await ensureWalkInPatientId();
      await supabase.from('patients').update({
        queue_status: 'awaiting_verification',
        intake_state: { rawTranscriptStream: intake.transcript, completenessCheck: intake.completeness, doctorQueryActive: true },
      }).eq('id', patientId);
      setWalkInPauseOpen(true);
    } finally {
      setPausingWalkIn(false);
    }
  }

  async function handleResumeWalkIn() {
    setWalkInPaused(false);
    setWalkInPauseOpen(false);
    intake.setIsRecording(true);
    const patientId = walkInPatientIdRef.current;
    if (patientId) {
      await supabase.from('patients').update({
        queue_status: 'new',
        intake_state: { rawTranscriptStream: intake.transcript, completenessCheck: intake.completeness, doctorQueryActive: false },
      }).eq('id', patientId);
    }
    pushToast({ tone: 'info', title: 'Intake resumed' });
  }

  async function handleSendWalkInQuery() {
    if (!walkInQueryNote.trim()) return;
    setSendingWalkInQuery(true);
    try {
      const patientId = await ensureWalkInPatientId();
      await supabase.from('patients').update({
        intake_state: {
          rawTranscriptStream: intake.transcript, completenessCheck: intake.completeness,
          doctorQueryActive: true, doctorQueryNote: walkInQueryNote.trim(),
        },
      }).eq('id', patientId);
      await supabase.from('notifications').insert({
        id: newId('nt'), org_id: orgId, patient_id: patientId,
        practitioner_id: autoAssignedDoctor?.id ?? null, type: 'doctor_query',
        message: `Reception is querying about ${inName.trim() || 'a walk-in patient'}: ${walkInQueryNote.trim()}`,
        channel: 'inapp', read: false,
      });
      setWalkInQueryNote('');
      pushToast({ tone: 'info', title: 'Query sent to doctor' });
    } finally {
      setSendingWalkInQuery(false);
    }
  }

  // ---- Intake Pause Gate for an already-queued patient ------------------
  // Selecting a row in the live "In Queue" board below targets it for this
  // gate (a real patient row is required to update queue_status/intake_state
  // and to insert a notification for the assigned doctor).
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseNote, setPauseNote] = useState('');
  const [sendingQuery, setSendingQuery] = useState(false);

  function openPauseGate() {
    setPauseOpen(true);
  }

  async function handleSendDoctorQuery() {
    const targetId = selectedPatientId;
    if (!targetId || !pauseNote.trim()) return;
    setSendingQuery(true);
    try {
      const target = patients.find((p) => p.id === targetId);
      const mergedIntakeState = { ...(target?.intake_state ?? {}), doctorQueryActive: true, doctorQueryNote: pauseNote.trim() };
      await supabase.from('patients').update({
        queue_status: 'awaiting_verification', intake_state: mergedIntakeState,
      }).eq('id', targetId);
      await supabase.from('notifications').insert({
        id: newId('nt'), org_id: orgId, patient_id: targetId,
        practitioner_id: target?.assigned_practitioner_id ?? null, type: 'doctor_query',
        message: `Reception is querying about ${target?.name ?? 'a patient'}: ${pauseNote.trim()}`,
        channel: 'inapp', read: false,
      });
      setPauseNote(''); setPauseOpen(false);
      pushToast({ tone: 'info', title: 'Query sent to doctor' });
    } finally {
      setSendingQuery(false);
    }
  }

  async function handleResumeToQueue(patientId: string) {
    await supabase.from('patients').update({ queue_status: 'waiting_doctor' }).eq('id', patientId);
  }

  // ---- RED ALERT / critical bypass ---------------------------------------
  const [redAlertOpen, setRedAlertOpen] = useState(false);
  const [raName, setRaName] = useState('');
  const [raComplaint, setRaComplaint] = useState('');
  const [raSaving, setRaSaving] = useState(false);
  const criticalCareDoctor = useMemo(
    () => practitioners.find((p) => p.specialty === 'Critical Care') ?? null,
    [practitioners],
  );

  function openRedAlert() {
    setRaName(inName.trim());
    setRaComplaint(inComplaint.trim());
    setRedAlertOpen(true);
  }

  async function handleConfirmRedAlert() {
    if (!raName.trim() || !raComplaint.trim()) return;
    setRaSaving(true);
    try {
      const doctorId = criticalCareDoctor?.id ?? null;
      const existing = patients.find((p) => p.name.trim().toLowerCase() === raName.trim().toLowerCase() && p.phone === (inPhone.trim() || null));
      let patientId: string;
      if (existing) {
        patientId = existing.id;
        await supabase.from('patients').update({
          urgency_level: 'critical_bypass', queue_status: 'with_doctor', assigned_practitioner_id: doctorId,
          triage: { ...existing.triage, complaints: raComplaint.trim() },
        }).eq('id', existing.id);
      } else {
        patientId = newId('p');
        await supabase.from('patients').insert({
          id: patientId, org_id: orgId, auth_user_id: null, mrn: null, name: raName.trim(), age: null,
          gender: null, phone: null, conditions: [], allergies: [], medications: [],
          queue_status: 'with_doctor', urgency_level: 'critical_bypass', draft_summary: null,
          assigned_practitioner_id: doctorId, preferred_language: 'en', phone_verified: false,
          journey_stage: null, journey_stage_history: [], discharged_at: null, discharge_summary: null,
          intake_state: {}, triage: { complaints: raComplaint.trim() },
        });
      }
      await supabase.from('notifications').insert({
        id: newId('nt'), org_id: orgId, patient_id: patientId, practitioner_id: doctorId,
        type: 'critical_bypass',
        message: `🚨 CRITICAL BYPASS: ${raName.trim()} — ${raComplaint.trim()} — routed directly to your queue`,
        channel: 'inapp', read: false,
      });
      await logAudit('critical-bypass-triage', raName.trim());
      setRedAlertOpen(false); setRaName(''); setRaComplaint('');
      pushToast({ tone: 'critical', title: 'Critical bypass routed', detail: raName.trim() });
    } finally {
      setRaSaving(false);
    }
  }

  const isAmbientRecording = isMockBackend ? intake.isRecording : realCapture.status === 'recording';
  const showPauseGate = isAmbientRecording || selectedPatientId != null;
  const pauseTargetPatient = selectedPatientId ? patients.find((p) => p.id === selectedPatientId) ?? null : null;

  return (
    <Shell title="Front Desk">
      <div className="mb-6 flex justify-center">
        <button
          type="button"
          data-testid="red-alert-btn"
          onClick={openRedAlert}
          className="rounded-full bg-danger text-white font-extrabold tracking-wide px-6 py-3 text-sm shadow-lg"
          style={{ animation: 'redPulse 1.6s ease-in-out infinite' }}
        >
          🚨 RED ALERT — Critical Bypass
        </button>
      </div>

      {/* 1. Telephonic Appointment Form + Scheduled list */}
      <Card className="mb-6">
        <SectionHead eyebrow="Front Desk" title="Telephonic Appointment" desc="Book a phone-in appointment with a specialist." />
        <form onSubmit={handleBookAppointment} className="grid md:grid-cols-2 gap-x-4">
          <Field label="Patient Name">
            <input data-testid="ap-name" className={inputCls} value={apName} onChange={(e) => setApName(e.target.value)} placeholder="Full name" />
          </Field>
          <Field label="Phone">
            <input data-testid="ap-phone" className={inputCls} value={apPhone} onChange={(e) => setApPhone(e.target.value)} placeholder="Phone number" />
          </Field>
          <Field label="Selected Specialist">
            <select data-testid="ap-practitioner" className={inputCls} value={apPractitionerId} onChange={(e) => setApPractitionerId(e.target.value)}>
              <option value="">Select specialist…</option>
              {bookablePractitioners.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {p.specialty ?? p.title}</option>
              ))}
            </select>
          </Field>
          <Field label="Date / Time">
            <input data-testid="ap-when" className={inputCls} value={apWhen} onChange={(e) => setApWhen(e.target.value)} placeholder="e.g. 29 Aug, 4:30 PM" />
          </Field>
          <div className="md:col-span-2 mt-4">
            <Btn type="submit" variant="glow" disabled={apSaving} data-testid="save-appointment">
              {apSaving ? 'Scheduling…' : 'Schedule Appointment'}
            </Btn>
          </div>
        </form>

        <div className="mt-6">
          <div className="font-mono text-[10px] tracking-wider uppercase text-ink-faint mb-2">Scheduled Appointments</div>
          {scheduledAppointments.length === 0 && <div className="text-sm text-ink-faint">No scheduled appointments.</div>}
          <div className="space-y-2">
            {scheduledAppointments.map((a) => {
              const p = patients.find((x) => x.id === a.patient_id);
              const doc = practitioners.find((x) => x.id === a.practitioner_id);
              const leaving = leavingIds.has(a.id);
              return (
                <div
                  key={a.id}
                  className={`flex items-center justify-between bg-surface-2 rounded-lg px-3 py-2 transition-all duration-250 ${leaving ? 'opacity-0 -translate-x-2' : 'opacity-100 translate-x-0'}`}
                >
                  <div>
                    <div className="text-sm text-ink font-semibold">{p?.name ?? 'Unknown patient'}</div>
                    <div className="text-[11px] text-ink-faint">{doc?.name ?? 'Unassigned'} · {a.start_time}</div>
                  </div>
                  <Btn
                    variant="glow"
                    data-testid="check-in-btn"
                    onClick={() => handleCheckIn(a.id, a.patient_id)}
                  >
                    Check-In
                  </Btn>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* 3. Live "In Queue" board */}
      <Card className="mb-6">
        <SectionHead eyebrow="Live" title="In Queue" desc="Patients checked in and awaiting or in verification." />
        {inQueuePatients.length === 0 && <div className="text-sm text-ink-faint">Queue is empty.</div>}
        <div className="space-y-2">
          {inQueuePatients.map((p) => {
            const selected = selectedPatientId === p.id;
            return (
              <div
                key={p.id}
                onClick={() => setSelectedPatientId(selected ? null : p.id)}
                className={`flex items-center justify-between bg-surface-2 rounded-lg px-3 py-2 cursor-pointer transition-colors ${selected ? 'ring-2 ring-accent' : ''}`}
              >
                <div>
                  <div className="text-sm text-ink font-semibold">{p.name}</div>
                  <div className="text-[11px] text-ink-faint">{p.triage?.complaints || 'No chief complaint recorded'} · {practitionerName(p.assigned_practitioner_id)}</div>
                  {p.intake_state?.doctorResponseClearance && (
                    <div className="mt-1.5 text-[11px] text-ok bg-ok-soft rounded px-2 py-1 inline-flex items-center gap-2">
                      Doctor cleared: {p.intake_state.doctorResponseClearance}
                      <Btn
                        variant="default"
                        className="!px-2 !py-0.5 !text-[10px]"
                        onClick={(e) => { e.stopPropagation(); handleResumeToQueue(p.id); }}
                      >
                        Resume / Move to Queue
                      </Btn>
                    </div>
                  )}
                </div>
                <Pill tone={p.urgency_level === 'critical_bypass' ? 'danger' : p.urgency_level === 'urgent' ? 'gate' : 'default'}>
                  {p.urgency_level}
                </Pill>
              </div>
            );
          })}
        </div>
        {inQueuePatients.length > 0 && (
          <div className="mt-2 text-[11px] text-ink-faint">Click a patient to select them for the Intake Pause Gate below.</div>
        )}
      </Card>

      {/* 6. Intake Pause Gate (already-queued patient) -- visible while
          ambient intake is running for the walk-in draft below, or while a
          queued patient is selected above. */}
      {showPauseGate && (
        <Card className="mb-6">
          <SectionHead eyebrow="Escalate" title="Intake Pause Gate" desc="Pause and route a question straight to the assigned doctor." />
          <Btn variant="gate" data-testid="pause-intake-btn" onClick={openPauseGate}>
            ⏸ Pause Intake / Query Doctor
          </Btn>
          {!pauseTargetPatient && (
            <div className="mt-2 text-[11px] text-ink-faint">Select a patient in the queue above to target this query.</div>
          )}
          {pauseOpen && (
            <Card className="mt-3 !bg-gate-soft">
              <div className="font-mono text-[10px] tracking-wider uppercase text-gate mb-2">
                {pauseTargetPatient ? `Query Doctor about ${pauseTargetPatient.name}` : 'Query Doctor'}
              </div>
              <textarea
                className={`${inputCls} min-h-[80px]`}
                value={pauseNote}
                onChange={(e) => setPauseNote(e.target.value)}
                placeholder="What do you need the doctor to clarify?"
              />
              <div className="mt-2 flex gap-2">
                <Btn
                  variant="gate"
                  data-testid="send-doctor-query"
                  disabled={sendingQuery || !pauseNote.trim() || !pauseTargetPatient}
                  onClick={handleSendDoctorQuery}
                >
                  {sendingQuery ? 'Sending…' : 'Send Query'}
                </Btn>
                <Btn variant="ghost" onClick={() => setPauseOpen(false)}>Cancel</Btn>
              </div>
            </Card>
          )}
        </Card>
      )}

      {/* 4/5. AI Guided Intake + Triage & Document Manager */}
      <Card className="mb-6">
        <SectionHead eyebrow="Walk-in" title="AI Guided Intake" desc="Register a new walk-in patient with ambient AI assistance." />
        <div className="grid md:grid-cols-2 gap-x-4">
          <Field label="Name">
            <input data-testid="intake-name" className={inputCls} value={inName} onChange={(e) => setInName(e.target.value)} placeholder="Full name" />
          </Field>
          <Field label="Age">
            <input data-testid="intake-age" className={inputCls} value={inAge} onChange={(e) => setInAge(e.target.value)} placeholder="Age" inputMode="numeric" />
          </Field>
          <Field label="Phone">
            <input data-testid="intake-phone" className={inputCls} value={inPhone} onChange={(e) => setInPhone(e.target.value)} placeholder="Phone number" />
          </Field>
          <Field label="Chief Complaint">
            <input data-testid="intake-complaint" className={inputCls} value={inComplaint} onChange={(e) => setInComplaint(e.target.value)} placeholder="What brings them in?" />
          </Field>
        </div>

        {/* Central Audio Anchor -- the heroic pulsing violet/indigo capture
            orb, freezing into a muted static state (.aura-orb.paused) the
            instant intake is paused. */}
        <AmbientOrb size="hero" active={isMockBackend ? intake.isRecording : realCapture.status === 'recording'} />

        <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
          <Btn
            variant={isAmbientRecording ? 'danger' : 'primary'}
            data-testid="start-ambient-intake"
            disabled={walkInPaused || (!isMockBackend && realCapture.status === 'processing')}
            onClick={handleAmbientMicClick}
          >
            🎙️ {isMockBackend
              ? (intake.isRecording ? 'Recording…' : 'Start Ambient AI Registration')
              : (realCapture.status === 'recording' ? 'Recording… (tap to stop)'
                : realCapture.status === 'processing' ? 'Transcribing…'
                  : 'Start Ambient AI Registration')}
          </Btn>

          {/* The Intake Pause Gate -- a highly tactile orange control right
              next to the orb. Freezes the STT loop instantly, sets the
              active queue_status to 'awaiting_verification', mutes the orb,
              and expands the inline routing-query text area below. */}
          {(isAmbientRecording || walkInPaused) && !walkInPaused && (
            <Btn
              variant="gate"
              data-testid="pause-walkin-btn"
              disabled={pausingWalkIn}
              onClick={handlePauseWalkIn}
            >
              {pausingWalkIn ? 'Pausing…' : '⏸ Pause Intake / Query Doctor'}
            </Btn>
          )}
          {walkInPaused && (
            <Btn variant="glow" data-testid="resume-walkin-btn" onClick={handleResumeWalkIn}>
              ▶ Resume Intake
            </Btn>
          )}
        </div>

        {!isMockBackend && !realCapture.supported && (
          <div className="mt-2 text-center text-[11px] text-ink-faint">
            Voice capture isn't supported in this browser — use typed dictation below instead.
          </div>
        )}

        {/* Typed-dictation fallback -- the same real Claude extraction, just
            skipping Deepgram, for when the mic is unavailable/denied or
            reception simply prefers to type. Real mode only; mock mode has
            no equivalent since the scripted simulation already "types" the
            transcript for demo purposes. */}
        {!isMockBackend && (
          <div className="mt-3 text-center">
            <button
              type="button"
              data-testid="toggle-typed-intake"
              onClick={() => setShowTypedIntake((v) => !v)}
              className="text-[11px] text-accent-ink underline underline-offset-2"
            >
              {showTypedIntake ? 'Hide typed dictation' : 'Or type the conversation instead'}
            </button>
            {showTypedIntake && (
              <div className="mt-2 text-left">
                <textarea
                  className={`${inputCls} min-h-[80px]`}
                  data-testid="typed-intake-text"
                  value={typedIntakeText}
                  onChange={(e) => setTypedIntakeText(e.target.value)}
                  placeholder="Type what the patient said, as if reading it back…"
                />
                <div className="mt-2 flex justify-center">
                  <Btn
                    variant="glow"
                    data-testid="submit-typed-intake"
                    disabled={!typedIntakeText.trim() || realCapture.status === 'processing'}
                    onClick={handleSubmitTypedIntake}
                  >
                    {realCapture.status === 'processing' ? 'Extracting…' : 'Extract from Text'}
                  </Btn>
                </div>
              </div>
            )}
          </div>
        )}

        {walkInPauseOpen && (
          <Card className="mt-3 !bg-gate-soft">
            <div className="font-mono text-[10px] tracking-wider uppercase text-gate mb-2">
              Intake Paused — Awaiting Verification
            </div>
            <textarea
              className={`${inputCls} min-h-[80px]`}
              data-testid="walkin-query-note"
              value={walkInQueryNote}
              onChange={(e) => setWalkInQueryNote(e.target.value)}
              placeholder="What do you need the doctor to clarify before intake continues?"
            />
            <div className="mt-2 flex gap-2">
              <Btn
                variant="gate"
                data-testid="send-walkin-query"
                disabled={sendingWalkInQuery || !walkInQueryNote.trim()}
                onClick={handleSendWalkInQuery}
              >
                {sendingWalkInQuery ? 'Sending…' : 'Send Query to Doctor'}
              </Btn>
              <Btn variant="ghost" onClick={() => setWalkInPauseOpen(false)}>Close</Btn>
            </div>
          </Card>
        )}

        {intake.transcript && (
          <div className="mt-3 bg-surface-2 rounded-lg px-3 py-2 text-xs text-ink-soft font-light leading-relaxed">
            {intake.transcript}
          </div>
        )}

        {intake.recommendations.length > 0 && (
          <div className="mt-4">
            <div className="font-mono text-[10px] tracking-wider uppercase text-accent-ink mb-2">🤖 Ambient AI Live Recommendations</div>
            <div className="flex flex-wrap gap-2">
              {intake.recommendations.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  data-testid="rec-chip"
                  onClick={() => handleAnswerChip(r.id, r.text)}
                  className="animate-pulse inline-flex items-center gap-2 bg-accent-soft text-accent-ink rounded-full px-3 py-1.5 text-xs font-semibold"
                >
                  {r.text}
                  <span
                    role="button"
                    onClick={(e) => handleDismissChip(e, r.id)}
                    className="text-ink-faint hover:text-danger"
                  >
                    ✕
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
          {([
            ['identity', 'Identity'], ['complaint', 'Chief Complaint'], ['timeline', 'Timeline'], ['reports', 'Existing Reports'],
          ] as const).map(([key, label]) => (
            <Pill key={key} tone={intake.completeness[key] ? 'ok' : 'default'}>{label}</Pill>
          ))}
        </div>

        {triageNotes && (
          <div className="mt-4">
            <Field label="Patient-Confirmed Notes (Auto-Filled)">
              <textarea
                className={`${inputCls} min-h-[60px]`}
                data-testid="triage-notes"
                value={triageNotes}
                onChange={(e) => setTriageNotes(e.target.value)}
              />
            </Field>
          </div>
        )}

        <div className="mt-6 border-t border-line pt-4">
          <div className="font-mono text-[10px] tracking-wider uppercase text-ink-faint mb-2">Triage & Document Manager</div>
          <div className="grid md:grid-cols-2 gap-x-4">
            <Field label="Height (cm)">
              <input className={inputCls} value={inHeight} onChange={(e) => setInHeight(e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Weight (kg)">
              <input className={inputCls} value={inWeight} onChange={(e) => setInWeight(e.target.value)} inputMode="decimal" />
            </Field>
          </div>
          <div className="mt-3 text-xs text-ink-soft">
            Automated Queue Assignment: <span className="text-accent-ink font-semibold">{autoSpecialty}</span>
            {' '}→ {autoAssignedDoctor ? autoAssignedDoctor.name : 'no matching practitioner found'}
          </div>

          {/* Drag-and-drop asset zone (row 2.6) -- dropped files are
              classified by filename and inserted for real onto the walk-in
              row immediately, not deferred to registration. */}
          <div
            data-testid="doc-dropzone"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`mt-3 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${dragActive ? 'border-accent-ink bg-accent-soft' : 'border-line'}`}
          >
            <div className="text-xs text-ink-faint">Drag & drop X-Ray / MRI / Blood Report files here, or</div>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Btn variant="default" onClick={() => attachDoc('X-Ray')}>+ X-Ray</Btn>
              <Btn variant="default" onClick={() => attachDoc('MRI')}>+ MRI</Btn>
              <Btn variant="default" onClick={() => attachDoc('Blood Report')}>+ Blood Report</Btn>
            </div>
          </div>
          {draftDocs.length > 0 && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
              {draftDocs.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  data-testid="doc-preview-card"
                  onClick={() => pushToast({ tone: 'info', title: 'Document attached', detail: d.fileName })}
                  className="bg-surface-2 hover:bg-white/5 rounded-lg px-3 py-2 flex items-center gap-2 text-left transition-colors"
                >
                  <span className="text-lg shrink-0">{d.label === 'xray' ? '🩻' : d.label === 'report' ? '🧪' : '📎'}</span>
                  <span className="text-[11px] text-ink-soft truncate">{d.fileName}</span>
                </button>
              ))}
            </div>
          )}

          <Btn
            variant="glow"
            className="mt-5"
            data-testid="register-patient"
            disabled={registering || !inName.trim()}
            onClick={handleRegisterAndQueue}
          >
            {registering ? 'Registering…' : 'Register & Send to Queue'}
          </Btn>
        </div>
      </Card>

      {redAlertOpen && (
        <Modal onClose={() => setRedAlertOpen(false)}>
          <div className="font-mono text-[10px] tracking-wider uppercase text-danger mb-2">🚨 Critical Bypass Triage</div>
          <p className="text-sm text-ink-soft mb-4">
            This routes the patient directly to {criticalCareDoctor?.name ?? 'the Critical Care doctor'}'s queue, skipping normal intake.
          </p>
          <Field label="Patient Name">
            <input data-testid="red-alert-name" className={inputCls} value={raName} onChange={(e) => setRaName(e.target.value)} placeholder="Full name" />
          </Field>
          <Field label="One-line Complaint">
            <input data-testid="red-alert-complaint" className={inputCls} value={raComplaint} onChange={(e) => setRaComplaint(e.target.value)} placeholder="e.g. Sudden chest pain, breathless" />
          </Field>
          <div className="mt-5 flex gap-2">
            <Btn
              variant="danger"
              data-testid="red-alert-confirm"
              disabled={raSaving || !raName.trim() || !raComplaint.trim()}
              onClick={handleConfirmRedAlert}
            >
              {raSaving ? 'Routing…' : 'Confirm — Route to Critical Care'}
            </Btn>
            <Btn variant="ghost" onClick={() => setRedAlertOpen(false)}>Cancel</Btn>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
