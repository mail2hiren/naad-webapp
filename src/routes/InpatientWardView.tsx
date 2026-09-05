import { useMemo, useState } from 'react';
import Shell from '../components/Shell';
import { AmbientOrb, Card, Btn, Pill, SectionHead, StatTile, Field, inputCls } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useClinic } from '../context/ClinicContext';
import { supabase } from '../lib/supabaseClient';
import { STAGE_LABEL, STAGE_ORDER, fmtDateTime, stagePillTone } from '../lib/journey';
import type { JourneyHistoryEntry, JourneyStage, PatientRow } from '../types/db';

function nextStage(stage: JourneyStage): JourneyStage | null {
  const idx = STAGE_ORDER.indexOf(stage);
  if (idx === -1 || idx === STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1];
}

/** Row 5.0's "Blue indicates stable, Red signifies unstable" bed-matrix
 * coloring, mapped onto this app's existing tone tokens (accent-ink is the
 * app's one blue) rather than introducing a new color. */
function stabilityLabel(status: 'stable' | 'unstable' | undefined): { label: string; tone: 'accent' | 'danger' | 'default' } {
  if (status === 'stable') return { label: 'Stable', tone: 'accent' };
  if (status === 'unstable') return { label: 'Unstable', tone: 'danger' };
  return { label: 'Not yet assessed', tone: 'default' };
}

function fmtRupees(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`;
}

/**
 * Inpatient Ward (/ward). Every patient with queue_status === 'admitted'
 * gets a bed card driven entirely by journey_stage / journey_stage_history
 * on PatientRow -- no parallel status system. Daily rounds notes silently
 * accrue ward_billing_ledger charges (the "billing flag" -- no checkout UI
 * ever appears here), and discharge is gated through a two-step handoff
 * into queue_status:'pending_discharge_clearance' for Admin to settle.
 */
export default function InpatientWardView() {
  const { practitioner } = useAuth();
  const { patients, practitioners, wardLedger, pushToast, logAudit, orgId } = useClinic();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roundsNote, setRoundsNote] = useState('');
  const [savingRounds, setSavingRounds] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceNote, setAdvanceNote] = useState('');
  const [advancing, setAdvancing] = useState(false);
  const [dischargeOpen, setDischargeOpen] = useState(false);
  const [dischargeSummary, setDischargeSummary] = useState('');
  const [dischargeSaving, setDischargeSaving] = useState(false);
  const [admitting, setAdmitting] = useState(false);
  const [stabilitySavingId, setStabilitySavingId] = useState<string | null>(null);

  const admitted = useMemo(
    () => patients.filter((p) => p.queue_status === 'admitted' || p.queue_status === 'pending_discharge_clearance'),
    [patients],
  );

  const ledgerTotalFor = (patientId: string) =>
    wardLedger.filter((l) => l.patient_id === patientId).reduce((sum, l) => sum + l.amount, 0);

  const todayTotal = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return wardLedger.filter((l) => l.created_at.slice(0, 10) === today).reduce((sum, l) => sum + l.amount, 0);
  }, [wardLedger]);

  const selected = admitted.find((p) => p.id === selectedId) ?? null;

  function doctorName(patient: PatientRow): string {
    const doc = practitioners.find((pr) => pr.id === patient.assigned_practitioner_id);
    return doc ? doc.name : 'Unassigned';
  }

  function openChart(id: string) {
    setSelectedId(id);
    setRoundsNote('');
    setAdvanceOpen(false);
    setAdvanceNote('');
    setDischargeOpen(false);
    setDischargeSummary('');
  }

  async function handleAdmitStartJourney(patient: PatientRow) {
    setAdmitting(true);
    const entry: JourneyHistoryEntry = {
      stage: 'admitted',
      enteredAt: new Date().toISOString(),
      by: practitioner?.name ?? 'Ward staff',
      note: '',
    };
    const nextHistory = [...patient.journey_stage_history, entry];
    const { error } = await supabase
      .from('patients')
      .update({ journey_stage: 'admitted', journey_stage_history: nextHistory })
      .eq('id', patient.id);
    setAdmitting(false);
    if (error) {
      pushToast({ tone: 'critical', title: 'Could not start journey', detail: error.message });
      return;
    }
    pushToast({ tone: 'ok', title: 'Journey started', detail: `${patient.name} is now in Admitted.` });
  }

  async function handleSetStability(patient: PatientRow, status: 'stable' | 'unstable') {
    setStabilitySavingId(patient.id);
    const { error } = await supabase
      .from('patients')
      .update({ triage: { ...patient.triage, wardStability: status } })
      .eq('id', patient.id);
    setStabilitySavingId(null);
    if (error) {
      pushToast({ tone: 'critical', title: 'Could not update stability', detail: error.message });
      return;
    }
    await logAudit('ward-set-stability', `${patient.name}: ${status}`);
    pushToast({ tone: status === 'unstable' ? 'critical' : 'ok', title: `Marked ${status === 'stable' ? 'Stable' : 'Unstable'}`, detail: patient.name });
  }

  async function handleSaveRounds(patient: PatientRow) {
    const text = roundsNote.trim();
    if (!text || !patient.journey_stage) return;
    setSavingRounds(true);
    const entry: JourneyHistoryEntry = {
      stage: patient.journey_stage,
      enteredAt: new Date().toISOString(),
      by: practitioner?.name ?? 'Ward staff',
      note: text,
    };
    const nextHistory = [...patient.journey_stage_history, entry];
    const { error: histErr } = await supabase
      .from('patients')
      .update({ journey_stage_history: nextHistory })
      .eq('id', patient.id);
    if (histErr) {
      setSavingRounds(false);
      pushToast({ tone: 'critical', title: 'Could not save rounds note', detail: histErr.message });
      return;
    }
    const { error: ledgerErr } = await supabase.from('ward_billing_ledger').insert({
      id: `wl-${Date.now()}`,
      org_id: orgId,
      patient_id: patient.id,
      encounter_id: null,
      description: 'Inpatient care — daily rounds',
      amount: 1500,
      created_by: practitioner?.name ?? null,
      created_at: new Date().toISOString(),
    });
    setSavingRounds(false);
    if (ledgerErr) {
      pushToast({ tone: 'warning', title: 'Rounds note saved, but ledger charge failed', detail: ledgerErr.message });
      setRoundsNote('');
      return;
    }
    setRoundsNote('');
    pushToast({ tone: 'ok', title: 'Rounds note saved', detail: 'Ledger updated for today.' });
  }

  async function handleAdvanceStage(patient: PatientRow) {
    if (!patient.journey_stage) return;
    const target = nextStage(patient.journey_stage);
    if (!target || target === 'discharged') return; // discharge is gated separately
    const note = advanceNote.trim();
    if (!note) return;
    setAdvancing(true);
    const entry: JourneyHistoryEntry = {
      stage: target,
      enteredAt: new Date().toISOString(),
      by: practitioner?.name ?? 'Ward staff',
      note,
    };
    const nextHistory = [...patient.journey_stage_history, entry];
    const { error } = await supabase
      .from('patients')
      .update({ journey_stage: target, journey_stage_history: nextHistory })
      .eq('id', patient.id);
    setAdvancing(false);
    if (error) {
      pushToast({ tone: 'critical', title: 'Could not advance stage', detail: error.message });
      return;
    }
    setAdvanceOpen(false);
    setAdvanceNote('');
    pushToast({ tone: 'ok', title: `Moved to ${STAGE_LABEL[target]}` });
  }

  async function handleMarkForDischarge(patient: PatientRow) {
    const summary = dischargeSummary.trim();
    if (!summary) return;
    setDischargeSaving(true);
    const now = new Date().toISOString();
    const entry: JourneyHistoryEntry = {
      stage: 'discharged',
      enteredAt: now,
      by: practitioner?.name ?? 'Ward staff',
      note: summary,
    };
    const nextHistory = [...patient.journey_stage_history, entry];
    const { error } = await supabase
      .from('patients')
      .update({
        queue_status: 'pending_discharge_clearance',
        journey_stage: 'discharged',
        journey_stage_history: nextHistory,
        discharged_at: now,
        discharge_summary: summary,
      })
      .eq('id', patient.id);
    setDischargeSaving(false);
    if (error) {
      pushToast({ tone: 'critical', title: 'Could not mark for discharge', detail: error.message });
      return;
    }
    await logAudit('mark-for-discharge', patient.name);
    setDischargeOpen(false);
    setDischargeSummary('');
    pushToast({ tone: 'ok', title: 'Routed to Admin', detail: `${patient.name} is awaiting discharge clearance.` });
  }

  return (
    <Shell title="Inpatient Ward">
      <SectionHead
        eyebrow="Ward Operations"
        title="Inpatient Ward"
        desc="Bed-side journey tracking, daily rounds dictation, and the discharge handoff to Admin."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatTile label="Total accumulated inpatient charges today" value={fmtRupees(todayTotal)} tone="accent" />
        <StatTile label="Admitted beds" value={admitted.length} />
      </div>

      {selected ? (
        <ChartDetail
          patient={selected}
          doctorName={doctorName(selected)}
          ledgerTotal={ledgerTotalFor(selected.id)}
          onBack={() => setSelectedId(null)}
          onAdmitStart={() => handleAdmitStartJourney(selected)}
          admitting={admitting}
          roundsNote={roundsNote}
          setRoundsNote={setRoundsNote}
          onSaveRounds={() => handleSaveRounds(selected)}
          savingRounds={savingRounds}
          advanceOpen={advanceOpen}
          setAdvanceOpen={setAdvanceOpen}
          advanceNote={advanceNote}
          setAdvanceNote={setAdvanceNote}
          onAdvance={() => handleAdvanceStage(selected)}
          advancing={advancing}
          dischargeOpen={dischargeOpen}
          setDischargeOpen={setDischargeOpen}
          dischargeSummary={dischargeSummary}
          setDischargeSummary={setDischargeSummary}
          onMarkForDischarge={() => handleMarkForDischarge(selected)}
          dischargeSaving={dischargeSaving}
          onSetStability={(status) => handleSetStability(selected, status)}
          stabilitySaving={stabilitySavingId === selected.id}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {admitted.length === 0 && (
            <Card className="md:col-span-2 text-center text-ink-faint text-sm py-8">
              No patients currently admitted.
            </Card>
          )}
          {admitted.map((p) => {
            const total = ledgerTotalFor(p.id);
            const tone = stagePillTone(p.journey_stage);
            const label = p.journey_stage ? STAGE_LABEL[p.journey_stage] : 'Admission pending stage set';
            const stability = stabilityLabel(p.triage?.wardStability);
            return (
              <Card
                key={p.id}
                className={`flex flex-col gap-3 ${
                  p.triage?.wardStability === 'unstable' ? 'border border-danger' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-base font-semibold text-ink">{p.name}</div>
                    <div className="text-xs text-ink-faint mt-0.5">
                      {p.age != null ? `${p.age}y` : '—'} · {p.gender ?? '—'}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <Pill tone={tone}>{label}</Pill>
                    <span data-testid="bed-stability-pill">
                      <Pill tone={stability.tone}>{stability.label}</Pill>
                    </span>
                  </div>
                </div>
                <div className="text-xs text-ink-soft">
                  Doctor: <span className="text-ink">{doctorName(p)}</span>
                </div>
                {p.queue_status === 'pending_discharge_clearance' && (
                  <div className="text-[11px] text-gate bg-gate-soft rounded-lg px-2.5 py-1.5">
                    Routed to Admin dashboard for balance verification
                  </div>
                )}
                <div className="flex items-center justify-between mt-1">
                  <div className="font-mono text-sm text-accent-ink font-bold">{fmtRupees(total)}</div>
                  <Btn variant="primary" data-testid="open-ward-chart" onClick={() => openChart(p.id)}>
                    Open Chart
                  </Btn>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Shell>
  );
}

interface ChartDetailProps {
  patient: PatientRow;
  doctorName: string;
  ledgerTotal: number;
  onBack: () => void;
  onAdmitStart: () => void;
  admitting: boolean;
  roundsNote: string;
  setRoundsNote: (v: string) => void;
  onSaveRounds: () => void;
  savingRounds: boolean;
  advanceOpen: boolean;
  setAdvanceOpen: (v: boolean) => void;
  advanceNote: string;
  setAdvanceNote: (v: string) => void;
  onAdvance: () => void;
  advancing: boolean;
  dischargeOpen: boolean;
  setDischargeOpen: (v: boolean) => void;
  dischargeSummary: string;
  setDischargeSummary: (v: string) => void;
  onMarkForDischarge: () => void;
  dischargeSaving: boolean;
  onSetStability: (status: 'stable' | 'unstable') => void;
  stabilitySaving: boolean;
}

function ChartDetail({
  patient, doctorName, ledgerTotal, onBack, onAdmitStart, admitting,
  roundsNote, setRoundsNote, onSaveRounds, savingRounds,
  advanceOpen, setAdvanceOpen, advanceNote, setAdvanceNote, onAdvance, advancing,
  dischargeOpen, setDischargeOpen, dischargeSummary, setDischargeSummary, onMarkForDischarge, dischargeSaving,
  onSetStability, stabilitySaving,
}: ChartDetailProps) {
  const stability = stabilityLabel(patient.triage?.wardStability);
  const locked = patient.queue_status === 'pending_discharge_clearance';
  const target = patient.journey_stage ? nextStage(patient.journey_stage) : null;
  const canAdvance = !!target && target !== 'discharged';
  const canDischarge = patient.journey_stage === 'progress_review';
  const history = [...patient.journey_stage_history].sort(
    (a, b) => new Date(b.enteredAt).getTime() - new Date(a.enteredAt).getTime(),
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Btn variant="ghost" onClick={onBack}>&larr; Back to ward list</Btn>
      </div>

      <Card>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-lg font-semibold text-ink">{patient.name}</div>
            <div className="text-xs text-ink-faint mt-0.5">
              {patient.age != null ? `${patient.age}y` : '—'} · {patient.gender ?? '—'} · Doctor: {doctorName}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-lg text-accent-ink font-bold">{fmtRupees(ledgerTotal)}</div>
            <div className="text-[10px] text-ink-faint uppercase tracking-wider">Running ledger total</div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <Pill tone={stagePillTone(patient.journey_stage)}>
            {patient.journey_stage ? STAGE_LABEL[patient.journey_stage] : 'Admission pending stage set'}
          </Pill>
          <Pill tone={stability.tone}>{stability.label}</Pill>
        </div>
        {!locked && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-ink-faint">Bed status:</span>
            <Btn
              variant={patient.triage?.wardStability === 'stable' ? 'primary' : 'ghost'}
              className="!px-2.5 !py-1 !text-[11px]"
              data-testid="mark-stable"
              disabled={stabilitySaving}
              onClick={() => onSetStability('stable')}
            >
              Stable
            </Btn>
            <Btn
              variant={patient.triage?.wardStability === 'unstable' ? 'danger' : 'ghost'}
              className="!px-2.5 !py-1 !text-[11px]"
              data-testid="mark-unstable"
              disabled={stabilitySaving}
              onClick={() => onSetStability('unstable')}
            >
              Unstable
            </Btn>
          </div>
        )}
        {locked && (
          <div className="mt-3 text-sm text-gate bg-gate-soft rounded-lg px-3 py-2">
            Awaiting Admin discharge clearance. Routed to Admin dashboard for balance verification.
          </div>
        )}
      </Card>

      {!patient.journey_stage && (
        <Card>
          <div className="text-sm text-ink-soft mb-3">This patient has no clinical journey yet.</div>
          <Btn variant="glow" data-testid="admit-patient" onClick={onAdmitStart} disabled={admitting}>
            {admitting ? 'Starting…' : 'Admit — start journey'}
          </Btn>
        </Card>
      )}

      {patient.journey_stage && !locked && (
        <Card>
          <div className="flex items-center gap-2.5 mb-3">
            <AmbientOrb size="sm" active />
            <div className="font-mono text-[10px] tracking-[.14em] uppercase text-accent-ink">
              Daily Rounds Voice Dictation
            </div>
          </div>
          <Field label="Rounds note">
            <textarea
              data-testid="rounds-note-input"
              className={`${inputCls} min-h-[90px]`}
              value={roundsNote}
              onChange={(e) => setRoundsNote(e.target.value)}
              placeholder="Dictate or type today's rounds note…"
            />
          </Field>
          <Btn
            variant="primary"
            className="mt-3"
            data-testid="save-rounds-note"
            onClick={onSaveRounds}
            disabled={savingRounds || !roundsNote.trim()}
          >
            {savingRounds ? 'Saving…' : '🎙️ Save Rounds Note'}
          </Btn>
        </Card>
      )}

      {patient.journey_stage && !locked && canAdvance && target && (
        <Card>
          <div className="font-mono text-[10px] tracking-[.14em] uppercase text-accent-ink mb-3">
            Advance Journey Stage
          </div>
          {!advanceOpen ? (
            <Btn variant="default" data-testid="advance-stage" onClick={() => setAdvanceOpen(true)}>
              Move to {STAGE_LABEL[target]}
            </Btn>
          ) : (
            <>
              <Field label={`Note for moving to ${STAGE_LABEL[target]}`}>
                <textarea
                  className={`${inputCls} min-h-[70px]`}
                  value={advanceNote}
                  onChange={(e) => setAdvanceNote(e.target.value)}
                  placeholder="Clinical note for this stage change…"
                />
              </Field>
              <div className="flex gap-2 mt-3">
                <Btn
                  variant="primary"
                  data-testid="advance-stage"
                  onClick={onAdvance}
                  disabled={advancing || !advanceNote.trim()}
                >
                  {advancing ? 'Saving…' : `Confirm move to ${STAGE_LABEL[target]}`}
                </Btn>
                <Btn variant="ghost" onClick={() => { setAdvanceOpen(false); setAdvanceNote(''); }}>
                  Cancel
                </Btn>
              </div>
            </>
          )}
        </Card>
      )}

      {patient.journey_stage && !locked && canDischarge && (
        <Card>
          <div className="font-mono text-[10px] tracking-[.14em] uppercase text-danger mb-3">
            Discharge Ledger Sync Gate
          </div>
          {!dischargeOpen ? (
            <Btn variant="danger" data-testid="mark-for-discharge" onClick={() => setDischargeOpen(true)}>
              Mark for Discharge
            </Btn>
          ) : (
            <>
              <Field label="Discharge summary">
                <textarea
                  className={`${inputCls} min-h-[90px]`}
                  value={dischargeSummary}
                  onChange={(e) => setDischargeSummary(e.target.value)}
                  placeholder="Discharge summary for the clinical record…"
                />
              </Field>
              <p className="text-xs text-ink-faint mt-2">
                This locks further clinical editing and routes the patient to the Admin dashboard for balance
                verification against the ward billing ledger.
              </p>
              <div className="flex gap-2 mt-3">
                <Btn
                  variant="danger"
                  data-testid="confirm-discharge"
                  onClick={onMarkForDischarge}
                  disabled={dischargeSaving || !dischargeSummary.trim()}
                >
                  {dischargeSaving ? 'Routing…' : 'Confirm discharge & route to Admin'}
                </Btn>
                <Btn variant="ghost" onClick={() => { setDischargeOpen(false); setDischargeSummary(''); }}>
                  Cancel
                </Btn>
              </div>
            </>
          )}
        </Card>
      )}

      <Card>
        <div className="font-mono text-[10px] tracking-[.14em] uppercase text-ink-faint mb-3">
          Journey Timeline (most recent first)
        </div>
        {history.length === 0 ? (
          <div className="text-sm text-ink-faint">No journey history yet.</div>
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {history.map((h, i) => (
              <div key={i} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <Pill tone={stagePillTone(h.stage)}>{STAGE_LABEL[h.stage]}</Pill>
                  <span className="text-[11px] font-mono text-ink-faint">{fmtDateTime(h.enteredAt)}</span>
                </div>
                <div className="text-xs text-ink-soft mt-1.5">by {h.by || 'Ward staff'}</div>
                {h.note && <div className="text-sm text-ink mt-1 leading-relaxed">{h.note}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
