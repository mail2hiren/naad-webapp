import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { useClinic } from '../context/ClinicContext';
import { supabase, scriptedAmbient } from '../lib/supabaseClient';
import { useRealAmbientCapture, type ExtractResult } from '../hooks/useRealAmbientCapture';
import Shell from '../components/Shell';
import { AmbientOrb, Btn, BulletList, BulletListEditor, Card, Collapsible, Field, Modal, Pill, SectionHead, Tabs, inputCls } from '../components/ui';
import { ClinicalAssistantSidebar } from './doctor/ClinicalAssistantSidebar';
import { ConsultationQualityGate, type QualityFlag } from './doctor/ConsultationQualityGate';
import { normalizeClinicalNote, toBullets } from '../lib/clinicalNote';
import { STAGE_LABEL, fmtDateTime, stagePillTone } from '../lib/journey';
import type {
  ClinicalNote, DocumentRow, PreConsultSummary, PrescriptionItem, QueueStatus, RehabExercise,
} from '../types/db';

/** Patient is "in this doctor's queue" if assigned to me and sitting in one
 * of these queue-ish states. Admitted (ward) patients are surfaced too, via
 * a separate check, so the doctor can still open their chart -- see
 * `isWardPatient` below and feature 9 in the spec this view implements. */
const QUEUE_STATUSES: QueueStatus[] = ['waiting_doctor', 'with_doctor', 'awaiting_verification', 'under_review'];

function emptyNote(lastUpdatedBy: string): ClinicalNote {
  return {
    soapSummary: { history: '', examination: [], assessment: [], plan: '' },
    rehabExercises: [],
    precautions: [],
    dosAndDonts: [],
    lastUpdatedBy,
    timestamp: new Date().toISOString(),
  };
}

function emptyRxItem(): PrescriptionItem {
  return {
    medicationId: `med-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '', dosage: '', frequency: '', duration: '', foodInstruction: '',
    isStockAvailable: true, substitutionApproved: false, price: 0,
  };
}

export default function DoctorView() {
  const { practitioner } = useAuth();
  const {
    orgId, patients, practitioners, encounters, prescriptions, pushToast, logAudit,
  } = useClinic();

  const [activePatientId, setActivePatientId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'session' | 'prescription' | 'referral'>('session');
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [lightboxDoc, setLightboxDoc] = useState<DocumentRow | null>(null);
  const [checklistAnswers, setChecklistAnswers] = useState<Record<string, boolean>>({});
  const [dictationPaused, setDictationPaused] = useState(false);
  const [qualityGateOpen, setQualityGateOpen] = useState(false);
  const [referralColleagueId, setReferralColleagueId] = useState('');
  const [referralReason, setReferralReason] = useState('');
  const [referralBusy, setReferralBusy] = useState(false);
  const [authorizeBusy, setAuthorizeBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);

  const [noteDraft, setNoteDraft] = useState<ClinicalNote | null>(null);
  const [rxDraft, setRxDraft] = useState<PrescriptionItem[] | null>(null);
  const noteEncounterIdRef = useRef<string | null>(null);
  const rxIdRef = useRef<string | null>(null);
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rxSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const patient = useMemo(() => patients.find((p) => p.id === activePatientId) ?? null, [patients, activePatientId]);
  const isWardPatient = patient?.queue_status === 'admitted';

  const myQueue = useMemo(
    () => patients.filter((p) => p.assigned_practitioner_id === practitioner?.id
      && (QUEUE_STATUSES.includes(p.queue_status) || p.queue_status === 'admitted')),
    [patients, practitioner],
  );

  const encounter = useMemo(
    () => encounters.find((e) => e.patient_id === activePatientId
      && e.practitioner_id === practitioner?.id && e.status === 'in_progress') ?? null,
    [encounters, activePatientId, practitioner],
  );
  const prescription = useMemo(
    () => (encounter ? prescriptions.find((r) => r.encounter_id === encounter.id) ?? null : null),
    [prescriptions, encounter],
  );
  const patientHistory = useMemo(
    () => encounters
      .filter((e) => e.patient_id === activePatientId && e.status === 'completed')
      .sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [encounters, activePatientId],
  );
  // Doctor feedback (Dr. Jayani round 2, 2026-09-03): "Detailed history of
  // the patient was shown and maintained which I cant see" -- the Admitted
  // -> Discharged journey tracker (see InpatientWardView) had no read-only
  // mirror on the Doctor console. Sorted newest-first, same as the Ward
  // console's own Journey Timeline.
  const journeyHistory = useMemo(
    () => (patient ? [...patient.journey_stage_history].sort(
      (a, b) => new Date(b.enteredAt).getTime() - new Date(a.enteredAt).getTime(),
    ) : []),
    [patient],
  );
  const colleagues = useMemo(
    () => practitioners.filter((p) => p.id !== practitioner?.id && (p.role === 'surgeon' || p.role === 'physio') && p.active),
    [practitioners, practitioner],
  );

  // Real ambient AI (Deepgram transcription + Claude structured extraction
  // via the `transcribe-and-extract` edge function) -- gated behind
  // `scriptedAmbient` so mock mode / Playwright CI keeps the existing
  // no-op dictation flow (a doctor just types into the note fields
  // directly) completely unchanged. Physiotherapists get the `physio`
  // stage (which never extracts exam findings from surgeons' consults,
  // and vice versa -- the edge function itself never extracts examination
  // findings at all, by design, since that's clinician-only).
  const realCapture = useRealAmbientCapture({
    stage: practitioner?.specialty === 'Physiotherapy' ? 'physio' : 'consult',
    patientId: activePatientId,
    encounterId: encounter?.id ?? null,
  });
  const [typedDictationText, setTypedDictationText] = useState('');
  const [showTypedDictation, setShowTypedDictation] = useState(false);

  useEffect(() => {
    if (!scriptedAmbient && realCapture.error) {
      pushToast({ tone: 'warning', title: 'Ambient AI', detail: realCapture.error.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realCapture.error]);

  /** Maps the real `consult`-stage extraction into the SOAP note. History
   * combines everything Claude pulled from the conversation into readable
   * prose; assessment/plan replace the tentative-impression/next-steps
   * fields (always phrased as requiring clinician confirmation -- see the
   * edge function's own system prompt); examination is deliberately left
   * untouched, since the function never extracts exam findings at all. */
  function applyConsultExtraction(result: ExtractResult) {
    if (!noteDraft) return;
    const ex = result.extracted as {
      chiefComplaint?: string; hpi?: string; painLocation?: string; painSeverity?: string; painDuration?: string;
      trauma?: string; aggravating?: string; relieving?: string; functionalLimitation?: string;
      priorTreatment?: string; assessment?: string; plan?: string;
    };
    const historyLines = [
      ex.chiefComplaint ? `Chief complaint: ${ex.chiefComplaint}` : '',
      ex.hpi ?? '',
      ex.painLocation ? `Pain location: ${ex.painLocation}` : '',
      ex.painSeverity ? `Pain severity: ${ex.painSeverity}` : '',
      ex.painDuration ? `Pain duration: ${ex.painDuration}` : '',
      ex.trauma ? `Trauma: ${ex.trauma}` : '',
      ex.aggravating ? `Aggravating factors: ${ex.aggravating}` : '',
      ex.relieving ? `Relieving factors: ${ex.relieving}` : '',
      ex.functionalLimitation ? `Functional limitation: ${ex.functionalLimitation}` : '',
      ex.priorTreatment ? `Prior treatment: ${ex.priorTreatment}` : '',
    ].filter(Boolean).join('\n');
    updateNote({
      soapSummary: {
        ...noteDraft.soapSummary,
        history: historyLines || noteDraft.soapSummary.history,
        assessment: ex.assessment ? [ex.assessment] : noteDraft.soapSummary.assessment,
        plan: ex.plan ?? noteDraft.soapSummary.plan,
      },
    });
    pushToast({ tone: 'ok', title: 'Ambient AI extraction complete', detail: `${result.usage.deepgramMinutes.toFixed(1)} min transcribed` });
  }

  /** Maps the real `physio`-stage extraction. `progressNote` becomes the
   * history (it's already a short clinical synthesis, per the edge
   * function's system prompt -- never a raw transcript dump); ROM/
   * strength/mobility/tolerance/pain score become examination bullets;
   * named exercises are merged into the Rehab Exercises list rather than
   * replacing it, so a physio building up a course across sessions doesn't
   * lose earlier entries. */
  function applyPhysioExtraction(result: ExtractResult) {
    if (!noteDraft) return;
    const ex = result.extracted as {
      painScore?: string; rom?: string; strength?: string; mobility?: string;
      exercisesDone?: string[]; tolerance?: string; progressNote?: string;
    };
    const examBullets = [
      ex.painScore ? `Pain score: ${ex.painScore}` : '',
      ex.rom ? `ROM: ${ex.rom}` : '',
      ex.strength ? `Strength: ${ex.strength}` : '',
      ex.mobility ? `Mobility: ${ex.mobility}` : '',
      ex.tolerance ? `Tolerance: ${ex.tolerance}` : '',
    ].filter(Boolean);
    const existingNames = new Set(noteDraft.rehabExercises.map((r) => r.exerciseName.trim().toLowerCase()));
    const newExercises = (ex.exercisesDone ?? [])
      .filter((name) => name.trim() && !existingNames.has(name.trim().toLowerCase()))
      .map((name) => ({
        exerciseName: name.trim(), sets: 0, reps: 0, frequencyPerWeek: '',
        progressionNotes: 'Completed this session (ambient AI) — confirm sets/reps/frequency.',
      }));
    updateNote({
      soapSummary: {
        ...noteDraft.soapSummary,
        history: ex.progressNote || noteDraft.soapSummary.history,
        examination: examBullets.length > 0 ? examBullets : noteDraft.soapSummary.examination,
      },
      rehabExercises: newExercises.length > 0 ? [...noteDraft.rehabExercises, ...newExercises] : noteDraft.rehabExercises,
    });
    pushToast({ tone: 'ok', title: 'Ambient AI extraction complete', detail: `${result.usage.deepgramMinutes.toFixed(1)} min transcribed` });
  }

  function applyExtraction(result: ExtractResult) {
    if (practitioner?.specialty === 'Physiotherapy') applyPhysioExtraction(result);
    else applyConsultExtraction(result);
  }

  async function handleSubmitTypedDictation() {
    if (scriptedAmbient || !typedDictationText.trim()) return;
    // Typed text supersedes a live recording: release the mic instead of
    // leaving it open (and un-uploaded) behind the typed note.
    if (realCapture.status === 'recording') realCapture.cancel();
    const result = await realCapture.submitTypedText(typedDictationText.trim());
    if (result) {
      applyExtraction(result);
      setTypedDictationText('');
      setShowTypedDictation(false);
    }
  }

  // Reset per-patient scratch state when switching charts.
  useEffect(() => {
    setChecklistAnswers({});
    setDictationPaused(false);
    setQualityGateOpen(false);
    setReferralColleagueId('');
    setReferralReason('');
    setLightboxDoc(null);
    setActiveTab('session');
  }, [activePatientId]);

  // 3-second briefing: attached documents for the active patient.
  useEffect(() => {
    let cancelled = false;
    if (!activePatientId) { setDocuments([]); return; }
    supabase.from('documents').select('*').eq('patient_id', activePatientId).then(({ data }) => {
      if (!cancelled) setDocuments((data as DocumentRow[]) ?? []);
    });
    return () => { cancelled = true; };
  }, [activePatientId]);

  // Adopt the server's clinical_note/prescription as the local editing
  // baseline only when the ENCOUNTER/PRESCRIPTION identity changes -- never
  // on every realtime refresh of the same row, or the doctor's in-flight
  // keystrokes would get clobbered by their own debounced round-trip.
  useEffect(() => {
    if (encounter && encounter.id !== noteEncounterIdRef.current) {
      noteEncounterIdRef.current = encounter.id;
      setNoteDraft(normalizeClinicalNote(encounter.clinical_note) ?? emptyNote(practitioner?.name ?? ''));
    } else if (!encounter) {
      noteEncounterIdRef.current = null;
      setNoteDraft(null);
    }
  }, [encounter, practitioner]);

  useEffect(() => {
    if (prescription && prescription.id !== rxIdRef.current) {
      rxIdRef.current = prescription.id;
      setRxDraft(prescription.items ?? []);
    } else if (!prescription) {
      rxIdRef.current = null;
      setRxDraft(null);
    }
  }, [prescription]);

  function persistNote(next: ClinicalNote) {
    if (!encounter) return;
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    const encId = encounter.id;
    noteSaveTimer.current = setTimeout(() => {
      supabase.from('encounters').update({ clinical_note: next }).eq('id', encId);
    }, 400);
  }

  function persistRx(next: PrescriptionItem[]) {
    if (!prescription) return;
    if (rxSaveTimer.current) clearTimeout(rxSaveTimer.current);
    const rxId = prescription.id;
    rxSaveTimer.current = setTimeout(() => {
      supabase.from('prescriptions').update({ items: next }).eq('id', rxId);
    }, 400);
  }

  function updateNote(patch: Partial<ClinicalNote>) {
    setNoteDraft((prev) => {
      if (!prev) return prev;
      const next: ClinicalNote = { ...prev, ...patch, lastUpdatedBy: practitioner?.name ?? prev.lastUpdatedBy, timestamp: new Date().toISOString() };
      persistNote(next);
      return next;
    });
  }
  function updateRx(next: PrescriptionItem[]) {
    setRxDraft(next);
    persistRx(next);
  }

  async function handleStartDictation() {
    if (!activePatientId || !practitioner || !patient) return;
    setStartBusy(true);
    try {
      const encId = `enc-${Date.now()}`;
      const rxId = `rx-${Date.now()}`;
      const nowIso = new Date().toISOString();
      const preConsult: PreConsultSummary = {
        height: patient.triage?.height ?? null,
        weight: patient.triage?.weight ?? null,
        bloodPressure: patient.triage?.bloodPressure ?? '',
        pulseRate: patient.triage?.pulseRate ?? null,
        complaints: patient.triage?.complaints ?? '',
        frontDeskNotes: patient.intake_state?.rawTranscriptStream ?? '',
      };
      const { error: encErr } = await supabase.from('encounters').insert({
        id: encId,
        org_id: orgId,
        patient_id: activePatientId,
        practitioner_id: practitioner.id,
        specialty: practitioner.specialty,
        status: 'in_progress',
        started_at: nowIso,
        pre_consult_summary: preConsult,
        clinical_note: emptyNote(practitioner.name),
        setting: isWardPatient ? 'ward' : 'clinic',
        ward: null,
        bed: null,
        recording_consent: 'given',
        capture_mode: 'dictation',
        consultation_fee: null,
        billing_notes: null,
        payment_status: 'unpaid',
      });
      if (encErr) { pushToast({ tone: 'critical', title: 'Could not start session', detail: encErr.message }); return; }

      await supabase.from('prescriptions').insert({
        id: rxId, org_id: orgId, encounter_id: encId, patient_id: activePatientId,
        status: 'draft', items: [], approved_by: null, approved_at: null,
      });

      // Ward patients stay 'admitted' throughout -- only outpatient-queue
      // patients advance to 'with_doctor'.
      if (!isWardPatient) {
        await supabase.from('patients').update({ queue_status: 'with_doctor' }).eq('id', activePatientId);
      }
      await logAudit('start-dictation', patient.name);
      pushToast({ tone: 'ok', title: 'Ambient session started', detail: patient.name });
      if (!scriptedAmbient) await realCapture.start();
    } finally {
      setStartBusy(false);
    }
  }

  async function handleStopDictation() {
    if (!scriptedAmbient && realCapture.status === 'recording') {
      const result = await realCapture.stop();
      if (result) applyExtraction(result);
    }
    setDictationPaused(true);
    setQualityGateOpen(true);
  }

  function handleApplyFix(flag: QualityFlag) {
    if (flag.fixKind === 'food-instruction') {
      if (rxDraft && rxDraft.length > 0) {
        updateRx(rxDraft.map((item, idx) => (idx === 0 ? { ...item, foodInstruction: flag.fixText } : item)));
      }
    } else if (flag.fixKind === 'append-precaution') {
      if (noteDraft) updateNote({ precautions: [...noteDraft.precautions, flag.fixText] });
    } else if (flag.fixKind === 'rehab-frequency') {
      if (noteDraft) updateNote({ rehabExercises: noteDraft.rehabExercises.map((e) => ({ ...e, frequencyPerWeek: flag.fixText })) });
    } else if (flag.fixKind === 'append-dos-donts') {
      if (noteDraft) updateNote({ dosAndDonts: [...noteDraft.dosAndDonts, flag.fixText] });
    }
  }

  function handleDismissFlag(_flag: QualityFlag, overrideText?: string) {
    if (overrideText && noteDraft) {
      updateNote({ precautions: [...noteDraft.precautions, overrideText] });
    }
  }

  async function handleRouteToColleague() {
    if (!activePatientId || !encounter || !practitioner || !patient) return;
    const colleague = practitioners.find((p) => p.id === referralColleagueId);
    if (!colleague) { pushToast({ tone: 'warning', title: 'Pick a colleague to route to first' }); return; }
    setReferralBusy(true);
    try {
      const reason = referralReason.trim() || 'Cross-specialty referral requested';
      await supabase.from('referrals').insert({
        id: `ref-${Date.now()}`, org_id: orgId, encounter_id: encounter.id, patient_id: activePatientId,
        from_practitioner_id: practitioner.id, to_specialty: colleague.specialty, reason,
        restrictions: null, status: 'pending',
      });
      await supabase.from('patients').update({
        assigned_practitioner_id: colleague.id, queue_status: 'waiting_doctor',
      }).eq('id', activePatientId);
      await supabase.from('notifications').insert({
        id: `nt-${Date.now()}`, org_id: orgId, patient_id: activePatientId, practitioner_id: colleague.id,
        type: 'doctor_query', message: `${practitioner.name} referred ${patient.name} to you — ${reason}`,
        read: false, channel: 'inapp',
      });
      await logAudit('route-to-colleague', `${patient.name} -> ${colleague.name}`);
      pushToast({ tone: 'info', title: `Routed to ${colleague.name}`, detail: patient.name });
      setActivePatientId(null);
    } finally {
      setReferralBusy(false);
    }
  }

  async function handleAuthorizeAndRoute() {
    if (!activePatientId || !encounter || !practitioner || !patient) return;
    setAuthorizeBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const items = rxDraft ?? prescription?.items ?? [];
      if (prescription) {
        await supabase.from('prescriptions').update({
          status: 'sent_to_pharmacy', approved_by: practitioner.name, approved_at: nowIso, items,
        }).eq('id', prescription.id);
      }
      await supabase.from('pharmacy_orders').insert({
        id: `po-${Date.now()}`, org_id: orgId, prescription_id: prescription?.id ?? '', patient_id: activePatientId,
        status: 'received', items, exception_note: '', updated_at: nowIso, prep_started_at: null, ready_at: null,
      });
      await supabase.from('encounters').update({
        status: 'completed', consultation_fee: practitioner.consult_fee ?? 0, payment_status: 'unpaid',
      }).eq('id', encounter.id);
      // Ward patients don't route through pharmacy pickup -- ward/reception
      // staff handle their medication, so their queue_status stays 'admitted'.
      if (!isWardPatient) {
        await supabase.from('patients').update({ queue_status: 'at_pharmacy' }).eq('id', activePatientId);
      }
      await supabase.from('notifications').insert({
        id: `nt-${Date.now()}`, org_id: orgId, patient_id: activePatientId, practitioner_id: null,
        type: 'prescription_authorized', message: `Prescription authorized for ${patient.name} by ${practitioner.name}`,
        read: false, channel: 'inapp',
      });
      await logAudit('authorize-and-route', patient.name);
      pushToast({ tone: 'ok', title: 'Authorized & routed', detail: patient.name });
      setActivePatientId(null);
    } finally {
      setAuthorizeBusy(false);
    }
  }

  function toggleChecklist(item: string) {
    setChecklistAnswers((prev) => ({ ...prev, [item]: !prev[item] }));
  }

  // ---- Rehab exercise / precaution / dos-and-donts / prescription editors
  function addExercise() {
    if (!noteDraft) return;
    updateNote({ rehabExercises: [...noteDraft.rehabExercises, { exerciseName: '', sets: 0, reps: 0, frequencyPerWeek: '', progressionNotes: '' }] });
  }
  function updateExercise(idx: number, patch: Partial<RehabExercise>) {
    if (!noteDraft) return;
    updateNote({ rehabExercises: noteDraft.rehabExercises.map((e, i) => (i === idx ? { ...e, ...patch } : e)) });
  }
  function removeExercise(idx: number) {
    if (!noteDraft) return;
    updateNote({ rehabExercises: noteDraft.rehabExercises.filter((_, i) => i !== idx) });
  }
  function addPrecaution() {
    if (!noteDraft) return;
    updateNote({ precautions: [...noteDraft.precautions, ''] });
  }
  function updatePrecaution(idx: number, val: string) {
    if (!noteDraft) return;
    updateNote({ precautions: noteDraft.precautions.map((p, i) => (i === idx ? val : p)) });
  }
  function removePrecaution(idx: number) {
    if (!noteDraft) return;
    updateNote({ precautions: noteDraft.precautions.filter((_, i) => i !== idx) });
  }
  function addDosDont() {
    if (!noteDraft) return;
    updateNote({ dosAndDonts: [...noteDraft.dosAndDonts, ''] });
  }
  function updateDosDont(idx: number, val: string) {
    if (!noteDraft) return;
    updateNote({ dosAndDonts: noteDraft.dosAndDonts.map((p, i) => (i === idx ? val : p)) });
  }
  function removeDosDont(idx: number) {
    if (!noteDraft) return;
    updateNote({ dosAndDonts: noteDraft.dosAndDonts.filter((_, i) => i !== idx) });
  }
  function addMedicine() {
    updateRx([...(rxDraft ?? []), emptyRxItem()]);
  }
  function updateMedicine(idx: number, patch: Partial<PrescriptionItem>) {
    if (!rxDraft) return;
    updateRx(rxDraft.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeMedicine(idx: number) {
    if (!rxDraft) return;
    updateRx(rxDraft.filter((_, i) => i !== idx));
  }

  return (
    <Shell title="Doctor Portal">
      <SectionHead
        eyebrow={practitioner?.specialty ?? 'Doctor'}
        title={`Welcome, ${practitioner?.name ?? 'Doctor'}`}
        desc="Your queue, the 3-second briefing, and the ambient clinical note -- all in one chart."
      />

      {!activePatientId && (
        <Card>
          <div className="font-mono text-[10px] tracking-[.14em] uppercase text-accent-ink mb-3">My Queue</div>
          {myQueue.length === 0 ? (
            <p className="text-ink-faint text-sm">No patients are currently assigned to you.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {myQueue.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 bg-surface-2 rounded-lg px-3.5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-ink font-semibold text-sm truncate">{p.name}</span>
                      {p.queue_status === 'admitted' && <Pill tone="gate">Ward</Pill>}
                      {p.urgency_level === 'critical_bypass' && <Pill tone="danger">Critical</Pill>}
                      {p.urgency_level === 'urgent' && <Pill tone="gate">Urgent</Pill>}
                    </div>
                    <div className="text-ink-faint text-xs mt-0.5 font-mono">{p.queue_status.replace(/_/g, ' ')}</div>
                  </div>
                  <Btn variant="primary" data-testid="open-chart" onClick={() => setActivePatientId(p.id)}>
                    Open Chart
                  </Btn>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activePatientId && patient && (
        <div className="flex flex-col gap-4">
          <Btn variant="ghost" className="self-start" onClick={() => setActivePatientId(null)}>&larr; Back to queue</Btn>

          {/* ---- 3-Second Context Briefing Panel -- always visible above the
              tabs below, since it's read-only reference the doctor glances at
              throughout the visit rather than a step in the workflow. ------ */}
          <Card>
                <div className="flex items-center justify-between mb-3">
                  <div className="font-mono text-[10px] tracking-[.14em] uppercase text-accent-ink">3-Second Briefing</div>
                  <div className="flex items-center gap-2">
                    {isWardPatient && <Pill tone="gate">Ward Patient</Pill>}
                    <span className="text-ink font-semibold">{patient.name}</span>
                    <span className="text-ink-faint text-xs font-mono">{patient.age ?? '—'}y · {patient.gender ?? '—'}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                  <TriageStat label="Height" value={patient.triage?.height ? `${patient.triage.height} cm` : '—'} />
                  <TriageStat label="Weight" value={patient.triage?.weight ? `${patient.triage.weight} kg` : '—'} />
                  <TriageStat label="BP" value={patient.triage?.bloodPressure || '—'} />
                  <TriageStat label="Pulse" value={patient.triage?.pulseRate ? `${patient.triage.pulseRate} bpm` : '—'} />
                </div>
                {patient.triage?.complaints && (
                  <div className="text-sm text-ink-soft mb-4 bg-surface-2 rounded-lg px-3 py-2.5">
                    <span className="font-mono text-[9.5px] uppercase text-ink-faint block mb-1">Chief Complaints</span>
                    {patient.triage.complaints}
                  </div>
                )}

                {(patient.intake_state?.rawTranscriptStream || patient.intake_state?.doctorQueryNote) && (
                  <div className="mb-4">
                    <span className="font-mono text-[9.5px] uppercase text-ink-faint block mb-1.5">Front-Desk Notes</span>
                    {patient.intake_state?.rawTranscriptStream && (
                      <p className="text-xs text-ink-soft leading-relaxed bg-surface-2 rounded-lg px-3 py-2.5 mb-1.5">
                        {patient.intake_state.rawTranscriptStream}
                      </p>
                    )}
                    {patient.intake_state?.doctorQueryNote && (
                      <p className="text-xs text-gate leading-relaxed bg-gate-soft rounded-lg px-3 py-2.5">
                        Query flagged: {patient.intake_state.doctorQueryNote}
                      </p>
                    )}
                  </div>
                )}

                {documents.length > 0 && (
                  <div className="mb-4">
                    <span className="font-mono text-[9.5px] uppercase text-ink-faint block mb-1.5">Attached Reports</span>
                    <div className="flex flex-wrap gap-2">
                      {documents.map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => setLightboxDoc(doc)}
                          className="w-24 shrink-0 bg-surface-2 border border-line rounded-lg p-2 text-left hover:border-accent transition-colors"
                        >
                          <div className="h-12 rounded bg-white/5 flex items-center justify-center text-ink-faint text-[9px] font-mono uppercase mb-1.5">
                            {doc.label}
                          </div>
                          <div className="text-[10px] text-ink-soft truncate">{doc.file_name}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ---- Patient Journey -- read-only mirror of the Ward
                    console's Admitted -> Operation -> Physiotherapy ->
                    Progress Review -> Discharged tracker (doctor feedback,
                    Dr. Jayani round 2, 2026-09-03). Ward staff remain the
                    only ones who can advance or edit it -- no controls
                    here, view only. -------------------------------------- */}
                {(patient.journey_stage || journeyHistory.length > 0) && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-[9.5px] uppercase text-ink-faint">Patient Journey</span>
                      <Pill tone={stagePillTone(patient.journey_stage)}>
                        {patient.journey_stage ? STAGE_LABEL[patient.journey_stage] : 'Admission pending stage set'}
                      </Pill>
                    </div>
                    {journeyHistory.length === 0 ? (
                      <p className="text-ink-faint text-xs">No journey history yet.</p>
                    ) : (
                      <div className="flex flex-col divide-y divide-line bg-surface-2 rounded-lg px-3">
                        {journeyHistory.map((h, i) => (
                          <div key={i} className="py-2 first:pt-2.5 last:pb-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <Pill tone={stagePillTone(h.stage)}>{STAGE_LABEL[h.stage]}</Pill>
                              <span className="text-[11px] font-mono text-ink-faint">{fmtDateTime(h.enteredAt)}</span>
                            </div>
                            <div className="text-xs text-ink-soft mt-1">by {h.by || 'Ward staff'}</div>
                            {h.note && <div className="text-sm text-ink mt-1 leading-relaxed">{h.note}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-ink-faint text-[10px] mt-1.5">View only — advanced and edited by Ward staff.</p>
                  </div>
                )}

                {/* ---- Encounter History -- full SOAP per past visit, not
                    just a one-line summary (doctor feedback, Dr. Jayani
                    round 2, 2026-09-03: "I remember now you had used SOAP
                    for every patient"). Left un-collapsed per scoping --
                    only the live Clinical Note gets the collapse/expand
                    treatment, this is reference material for past visits. */}
                {patientHistory.length > 0 && (
                  <div>
                    <span className="font-mono text-[9.5px] uppercase text-ink-faint block mb-1.5">Encounter History</span>
                    <div className="flex flex-col gap-2">
                      {patientHistory.map((h) => (
                        <div key={h.id} className="text-xs bg-surface-2 rounded-lg px-3 py-2.5">
                          <div className="font-mono text-ink-faint mb-2">{h.started_at.slice(0, 10)}</div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
                            <div>
                              <span className="font-mono text-[9px] uppercase text-ink-faint block mb-1">History</span>
                              <p className="text-ink-soft leading-relaxed">{h.clinical_note?.soapSummary?.history || '—'}</p>
                            </div>
                            <div>
                              <span className="font-mono text-[9px] uppercase text-ink-faint block mb-1">Examination</span>
                              <BulletList items={toBullets(h.clinical_note?.soapSummary?.examination)} />
                            </div>
                            <div>
                              <span className="font-mono text-[9px] uppercase text-ink-faint block mb-1">Assessment</span>
                              <BulletList items={toBullets(h.clinical_note?.soapSummary?.assessment)} />
                            </div>
                            <div>
                              <span className="font-mono text-[9px] uppercase text-ink-faint block mb-1">Plan</span>
                              <p className="text-ink-soft leading-relaxed">{h.clinical_note?.soapSummary?.plan || '—'}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>

          {/* ---- Everything below used to be one long vertical stack of
              cards (session control, SOAP note + rehab + precautions +
              dos/donts, prescription, referral, authorize) -- split into
              tabs so a doctor only sees the panel they're working on.
              Authorize & Route stays out of the tabs entirely, as a
              persistent action reachable no matter which panel is open. -- */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">
            <div className="flex flex-col gap-4 min-w-0">
              <Tabs
                tabs={[
                  { id: 'session', label: 'Session & Note' },
                  { id: 'prescription', label: 'Prescription' },
                  { id: 'referral', label: 'Referral' },
                ]}
                activeId={activeTab}
                onChange={setActiveTab}
              />

              {activeTab === 'session' && (
                <div className="flex flex-col gap-4">
                  {/* ---- Ambient session control ----------------------------- */}
                  {!encounter ? (
                    <Card className="flex items-center justify-between gap-4 flex-wrap">
                      <div>
                        <div className="text-ink font-semibold text-sm mb-1">No active consultation session</div>
                        <p className="text-ink-faint text-xs">Start dictation to open a live clinical note for this visit.</p>
                      </div>
                      <Btn variant="glow" data-testid="start-dictation" disabled={startBusy} onClick={handleStartDictation}>
                        {startBusy ? 'Starting…' : 'Start Dictation / Ambient Session'}
                      </Btn>
                    </Card>
                  ) : (
                    <Card>
                      <AmbientOrb size="hero" active={!dictationPaused && (scriptedAmbient || realCapture.status === 'recording')} />
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div>
                          <div className="text-ink font-semibold text-sm">
                            {dictationPaused ? 'Ambient Session Paused'
                              : !scriptedAmbient && realCapture.status === 'processing' ? 'Transcribing…'
                                : !scriptedAmbient && realCapture.status !== 'recording' ? 'Ambient Session Open'
                                  : 'AI Ambient Session Active'}
                          </div>
                          <p className="text-ink-faint text-xs">
                            {dictationPaused ? 'Review the quality gate, then authorize.'
                              : !scriptedAmbient && realCapture.status === 'processing' ? 'Extracting the clinical note from the recording…'
                                : !scriptedAmbient && realCapture.status !== 'recording' ? 'Microphone is off — tap Start Recording to capture this visit, or type below.'
                                  : 'Live Dictation'}
                          </p>
                        </div>
                        {!scriptedAmbient && !dictationPaused && realCapture.status !== 'recording' && realCapture.status !== 'processing' && realCapture.supported && (
                          <Btn variant="glow" data-testid="resume-recording" onClick={() => { void realCapture.start(); }}>
                            🎙️ Start Recording
                          </Btn>
                        )}
                        <Btn
                          variant="gate"
                          data-testid="stop-dictation"
                          disabled={!scriptedAmbient && realCapture.status === 'processing'}
                          onClick={handleStopDictation}
                        >
                          {!scriptedAmbient && realCapture.status === 'processing' ? 'Transcribing…' : 'Stop Dictation'}
                        </Btn>
                      </div>

                      {!scriptedAmbient && !realCapture.supported && (
                        <div className="mt-2 text-[11px] text-ink-faint">
                          Voice capture isn't supported in this browser — use typed dictation below instead.
                        </div>
                      )}

                      {!scriptedAmbient && (
                        <div className="mt-3">
                          <button
                            type="button"
                            data-testid="toggle-typed-dictation"
                            onClick={() => setShowTypedDictation((v) => !v)}
                            className="min-h-11 text-[11px] text-accent-ink underline underline-offset-2"
                          >
                            {showTypedDictation ? 'Hide typed dictation' : 'Or type the consultation instead'}
                          </button>
                          {showTypedDictation && (
                            <div className="mt-2">
                              <textarea
                                className={`${inputCls} min-h-[80px]`}
                                data-testid="typed-dictation-text"
                                value={typedDictationText}
                                onChange={(e) => setTypedDictationText(e.target.value)}
                                placeholder="Type the consultation, as if reading it back…"
                              />
                              <div className="mt-2">
                                <Btn
                                  variant="glow"
                                  data-testid="submit-typed-dictation"
                                  disabled={!typedDictationText.trim() || realCapture.status === 'processing'}
                                  onClick={handleSubmitTypedDictation}
                                >
                                  {realCapture.status === 'processing' ? 'Extracting…' : 'Extract from Text'}
                                </Btn>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </Card>
                  )}

                  {/* ---- Editable clinical note (Human-In-The-Loop) ------------ */}
                  {encounter && noteDraft && (
                    <Card>
                      <div className="font-mono text-[10px] tracking-[.14em] uppercase text-accent-ink mb-3">Clinical Note</div>

                      {/* Each block below is independently collapsible --
                          doctor feedback (Dr. Jayani round 2, 2026-09-03:
                          "you had put nice arrows where each section could
                          be expanded or collapsed"). Unlike the Patient
                          Portal's visit accordion, these don't share state:
                          a doctor can leave Rehab Exercises open while
                          collapsing Precautions, and vice versa. */}
                      <Collapsible title="History · Examination · Assessment · Plan" testId="soap-section">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                          <Field label="History">
                            <textarea
                              className={`${inputCls} min-h-[70px]`}
                              value={noteDraft.soapSummary.history}
                              onChange={(e) => updateNote({ soapSummary: { ...noteDraft.soapSummary, history: e.target.value } })}
                            />
                          </Field>
                          <Field label="Examination">
                            <BulletListEditor
                              items={noteDraft.soapSummary.examination}
                              onChange={(next) => updateNote({ soapSummary: { ...noteDraft.soapSummary, examination: next } })}
                              placeholder="e.g. Tenderness over medial joint line"
                              emptyLabel="No examination findings added yet."
                              itemLabel="Examination finding"
                            />
                          </Field>
                          <Field label="Assessment">
                            <BulletListEditor
                              items={noteDraft.soapSummary.assessment}
                              onChange={(next) => updateNote({ soapSummary: { ...noteDraft.soapSummary, assessment: next } })}
                              placeholder="e.g. Likely grade II MCL sprain"
                              emptyLabel="No assessment points added yet."
                              itemLabel="Assessment point"
                            />
                          </Field>
                          <Field label="Plan">
                            <textarea
                              className={`${inputCls} min-h-[70px]`}
                              value={noteDraft.soapSummary.plan}
                              onChange={(e) => updateNote({ soapSummary: { ...noteDraft.soapSummary, plan: e.target.value } })}
                            />
                          </Field>
                        </div>
                      </Collapsible>

                      {/* Rehab exercises */}
                      <div className="mt-4">
                        <Collapsible title="Rehab Exercises" testId="rehab-section">
                          <div className="flex items-center justify-end mb-1.5">
                            <Btn variant="ghost" onClick={addExercise}>+ Add Exercise</Btn>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            {noteDraft.rehabExercises.map((ex, idx) => (
                              <div key={idx} className="grid grid-cols-1 sm:grid-cols-6 gap-1.5 sm:items-center bg-surface-2 rounded-lg p-2">
                                <GridField label="Exercise">
                                  <input className={inputCls} placeholder="Exercise" value={ex.exerciseName} onChange={(e) => updateExercise(idx, { exerciseName: e.target.value })} />
                                </GridField>
                                <GridField label="Sets">
                                  <input className={inputCls} type="number" placeholder="Sets" value={ex.sets} onChange={(e) => updateExercise(idx, { sets: Number(e.target.value) || 0 })} />
                                </GridField>
                                <GridField label="Reps">
                                  <input className={inputCls} type="number" placeholder="Reps" value={ex.reps} onChange={(e) => updateExercise(idx, { reps: Number(e.target.value) || 0 })} />
                                </GridField>
                                <GridField label="Freq/week">
                                  <input className={inputCls} placeholder="Freq/week" value={ex.frequencyPerWeek} onChange={(e) => updateExercise(idx, { frequencyPerWeek: e.target.value })} />
                                </GridField>
                                <GridField label="Progression notes">
                                  <input className={`${inputCls} sm:col-span-1`} placeholder="Progression notes" value={ex.progressionNotes} onChange={(e) => updateExercise(idx, { progressionNotes: e.target.value })} />
                                </GridField>
                                <Btn variant="danger" className="w-full sm:w-auto" onClick={() => removeExercise(idx)}>Remove</Btn>
                              </div>
                            ))}
                            {noteDraft.rehabExercises.length === 0 && <p className="text-ink-faint text-xs">No exercises added yet.</p>}
                          </div>
                        </Collapsible>
                      </div>

                      {/* Precautions */}
                      <div className="mt-4">
                        <Collapsible title="Precautions" testId="precautions-section">
                          <div className="flex items-center justify-end mb-1.5">
                            <Btn variant="ghost" onClick={addPrecaution}>+ Add</Btn>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            {noteDraft.precautions.map((p, idx) => (
                              <div key={idx} className="flex gap-1.5">
                                <input className={inputCls} aria-label={`Precaution ${idx + 1}`} value={p} onChange={(e) => updatePrecaution(idx, e.target.value)} />
                                <Btn variant="danger" onClick={() => removePrecaution(idx)}>Remove</Btn>
                              </div>
                            ))}
                            {noteDraft.precautions.length === 0 && <p className="text-ink-faint text-xs">No precautions added yet.</p>}
                          </div>
                        </Collapsible>
                      </div>

                      {/* Dos & Don'ts */}
                      <div className="mt-4">
                        <Collapsible title="Dos & Don'ts" testId="dos-donts-section">
                          <div className="flex items-center justify-end mb-1.5">
                            <Btn variant="ghost" onClick={addDosDont}>+ Add</Btn>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            {noteDraft.dosAndDonts.map((p, idx) => (
                              <div key={idx} className="flex gap-1.5">
                                <input className={inputCls} aria-label={`Do or don't ${idx + 1}`} value={p} onChange={(e) => updateDosDont(idx, e.target.value)} />
                                <Btn variant="danger" onClick={() => removeDosDont(idx)}>Remove</Btn>
                              </div>
                            ))}
                            {noteDraft.dosAndDonts.length === 0 && <p className="text-ink-faint text-xs">Nothing added yet.</p>}
                          </div>
                        </Collapsible>
                      </div>
                    </Card>
                  )}
                </div>
              )}

              {activeTab === 'prescription' && (
                !encounter ? (
                  <Card>
                    <p className="text-ink-faint text-sm">Start a consultation session first -- the prescription opens once dictation begins.</p>
                  </Card>
                ) : (
                  <Card>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-[10px] tracking-[.14em] uppercase text-accent-ink">Prescription</span>
                      <Btn variant="ghost" onClick={addMedicine}>+ Add Medicine</Btn>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {(rxDraft ?? []).map((item, idx) => (
                        <div key={item.medicationId} className="grid grid-cols-1 sm:grid-cols-7 gap-1.5 sm:items-center bg-surface-2 rounded-lg p-2">
                          <GridField label="Name">
                            <input className={inputCls} placeholder="Name" value={item.name} onChange={(e) => updateMedicine(idx, { name: e.target.value })} />
                          </GridField>
                          <GridField label="Dosage">
                            <input className={inputCls} placeholder="Dosage" value={item.dosage} onChange={(e) => updateMedicine(idx, { dosage: e.target.value })} />
                          </GridField>
                          <GridField label="Frequency">
                            <input className={inputCls} placeholder="Frequency" value={item.frequency} onChange={(e) => updateMedicine(idx, { frequency: e.target.value })} />
                          </GridField>
                          <GridField label="Duration">
                            <input className={inputCls} placeholder="Duration" value={item.duration} onChange={(e) => updateMedicine(idx, { duration: e.target.value })} />
                          </GridField>
                          <GridField label="Food instruction">
                            <input className={inputCls} placeholder="Food instruction" value={item.foodInstruction} onChange={(e) => updateMedicine(idx, { foodInstruction: e.target.value })} />
                          </GridField>
                          <GridField label="Price">
                            <input className={inputCls} type="number" placeholder="Price" value={item.price} onChange={(e) => updateMedicine(idx, { price: Number(e.target.value) || 0 })} />
                          </GridField>
                          <Btn variant="danger" className="w-full sm:w-auto" onClick={() => removeMedicine(idx)}>Remove</Btn>
                        </div>
                      ))}
                      {(rxDraft ?? []).length === 0 && <p className="text-ink-faint text-xs">No medicines added yet.</p>}
                    </div>
                  </Card>
                )
              )}

              {activeTab === 'referral' && (
                !encounter ? (
                  <Card>
                    <p className="text-ink-faint text-sm">Start a consultation session first -- referrals route the active encounter to a colleague.</p>
                  </Card>
                ) : (
                  <Card>
                    <div className="font-mono text-[10px] tracking-[.14em] uppercase text-accent-ink mb-3">Cross-Referral Routing</div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <select
                        data-testid="referral-dropdown"
                        className={inputCls}
                        value={referralColleagueId}
                        onChange={(e) => setReferralColleagueId(e.target.value)}
                      >
                        <option value="">Select a colleague…</option>
                        {colleagues.map((c) => (
                          <option key={c.id} value={c.id}>{c.name} — {c.specialty}</option>
                        ))}
                      </select>
                      <input
                        className={inputCls}
                        placeholder="Reason for referral"
                        value={referralReason}
                        onChange={(e) => setReferralReason(e.target.value)}
                      />
                      <Btn
                        variant="primary"
                        disabled={!referralColleagueId || referralBusy}
                        onClick={handleRouteToColleague}
                      >
                        {referralBusy ? 'Routing…' : 'Route to Colleague'}
                      </Btn>
                    </div>
                  </Card>
                )
              )}
            </div>

            <ClinicalAssistantSidebar
              specialty={practitioner?.specialty ?? null}
              answers={checklistAnswers}
              onToggle={toggleChecklist}
              patient={patient}
              note={noteDraft}
              onUpdateNote={updateNote}
            />
          </div>

          {/* ---- Authorize & Route -- placed once, below both the tab panel
              and the sidebar, reachable from every tab since it's the
              terminal action for the whole visit rather than a step that
              belongs to any one panel. (An earlier draft floated this as a
              fixed footer, but that overlapped the Clinical Whisperer
              sidebar's checklist -- a real regression caught by re-checking
              the screenshot, not by any test. Full-width normal flow avoids
              covering anything, at the cost of a little scrolling.) ------- */}
          <Card className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-ink font-semibold text-sm mb-1">Authorize &amp; Route</div>
              <p className="text-ink-faint text-xs">
                Sends the prescription to pharmacy and closes out this consultation.
              </p>
            </div>
            <Btn
              variant="glow"
              data-testid="authorize-route"
              disabled={!encounter || authorizeBusy}
              onClick={handleAuthorizeAndRoute}
            >
              {authorizeBusy ? 'Authorizing…' : 'Authorize & Route'}
            </Btn>
          </Card>
        </div>
      )}

      {lightboxDoc && (
        <Modal onClose={() => setLightboxDoc(null)}>
          <div className="font-mono text-[10px] tracking-[.14em] uppercase text-accent-ink mb-3">Attached Report</div>
          <div className="h-40 rounded-xl bg-white/5 flex items-center justify-center text-ink-faint text-xs font-mono uppercase mb-4">
            {lightboxDoc.label}
          </div>
          <div className="text-ink text-lg font-semibold mb-1">{lightboxDoc.file_name}</div>
          <p className="text-ink-faint text-xs mb-4">Uploaded {lightboxDoc.uploaded_at?.slice(0, 10) ?? '—'}</p>
          <Btn variant="glow" onClick={() => setLightboxDoc(null)}>Close</Btn>
        </Modal>
      )}

      {qualityGateOpen && noteDraft && (
        <ConsultationQualityGate
          specialty={practitioner?.specialty ?? null}
          clinicalNote={noteDraft}
          prescriptionItems={rxDraft ?? []}
          onUpdateNote={updateNote}
          onApplyFix={handleApplyFix}
          onDismiss={handleDismissFlag}
          onClose={() => setQualityGateOpen(false)}
        />
      )}
    </Shell>
  );
}

/**
 * Label shown only below the `sm` breakpoint, for the Rehab Exercises and
 * Prescription rows -- both are dense N-column grids meant to read as one
 * compact line on desktop (position + placeholder text is enough there),
 * but they collapse to a cramped, unlabeled 2-column wrap on a real phone
 * (mobile UX audit, 2026-09-03): once a doctor types a value the
 * placeholder disappears, leaving a bare "90" or "10 days" with nothing to
 * say which field it is. Below `sm`, the grid goes to one column and each
 * field gets this label above it -- the exact stacked-label treatment
 * ProgressionMatrix's week rows already got for the same reason. At `sm`
 * and up the label collapses to nothing (`sm:hidden`), so desktop is
 * pixel-identical to before.
 */
function GridField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="sm:hidden block font-mono text-[9px] uppercase text-ink-faint mb-1">{label}</span>
      {children}
    </div>
  );
}

function TriageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-2 rounded-lg px-2.5 py-2">
      <div className="font-mono text-[9px] uppercase text-ink-faint mb-0.5">{label}</div>
      <div className="text-ink text-sm font-semibold truncate">{value}</div>
    </div>
  );
}
