import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Shell from '../components/Shell';
import { LineChart } from '../components/LineChart';
import { AmbientOrb, Btn, Card, Field, Modal, Pill, SectionHead, StatTile, inputCls } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useClinic } from '../context/ClinicContext';
import { useRealAmbientCapture } from '../hooks/useRealAmbientCapture';
import { sessionsOf, usePhysio } from '../hooks/usePhysio';
import { useSection } from '../lib/nav';
import { scriptedAmbient, supabase } from '../lib/supabaseClient';
import { demoExtractionFor } from '../mock/demoExtraction';
import type { ExerciseRow, HomeProgrammeItem, PatientRow, PhysioPlanRow, TherapySessionRow } from '../types/db';

const REGIONS = ['Knee', 'Hip', 'Ankle', 'Back', 'Shoulder', 'Neck', 'General'];

function newId(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function fmtDay(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

/**
 * Physiotherapy module: caseload of therapy plans, each plan's session record
 * and progress, the home exercise programme, and the exercise library.
 */
export default function PhysioView() {
  const section = useSection<'caseload' | 'library'>('caseload');
  const [params] = useSearchParams();
  const planId = params.get('plan');
  const { orgId } = useClinic();
  const physio = usePhysio(orgId);
  const plan = planId ? physio.plans.find((p) => p.id === planId) : undefined;

  const title = planId ? 'Therapy plan' : section === 'library' ? 'Exercise library' : 'Caseload';
  return (
    <Shell title={title}>
      {planId ? (
        plan ? <PlanDetail plan={plan} physio={physio} /> : <p className="text-ink-soft">{physio.loaded ? 'Plan not found.' : 'Loading…'}</p>
      ) : section === 'library' ? (
        <Library exercises={physio.exercises} />
      ) : (
        <Caseload physio={physio} />
      )}
    </Shell>
  );
}

type Physio = ReturnType<typeof usePhysio>;

/* ------------------------------------------------------------------------ */
/* Caseload                                                                 */
/* ------------------------------------------------------------------------ */

function Caseload({ physio }: { physio: Physio }) {
  const { patients, referrals, practitioners } = useClinic();
  const { practitioner } = useAuth();
  const [newPlan, setNewPlan] = useState<{ patientId?: string; referralId?: string; condition?: string } | null>(null);
  const [showDone, setShowDone] = useState(false);

  const pending = referrals.filter((r) => r.status === 'pending' && r.to_specialty === 'Physiotherapy');
  const mine = physio.plans.filter((p) => !p.practitioner_id || p.practitioner_id === practitioner?.id || practitioner?.role !== 'physio');
  const active = mine.filter((p) => p.status === 'active').sort((a, b) => (a.review_date ?? '').localeCompare(b.review_date ?? ''));
  const done = mine.filter((p) => p.status === 'completed');
  const patient = (id: string) => patients.find((p) => p.id === id);
  const doctor = (id: string) => practitioners.find((p) => p.id === id)?.name ?? 'A doctor';

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap -mt-3 mb-6">
        <p className="text-ink-soft text-[15px]">Everyone under your care, their progress and when they're due for review.</p>
        <Btn variant="glow" onClick={() => setNewPlan({})} data-testid="new-plan">+ New therapy plan</Btn>
      </div>

      {pending.length > 0 && (
        <Card className="mb-6" data-testid="referrals">
          <SectionHead title={`New referrals (${pending.length})`} desc="Patients sent to physiotherapy by a doctor. Accept to start a therapy plan." />
          <div className="flex flex-col divide-y divide-line">
            {pending.map((r) => (
              <div key={r.id} className="py-3 flex items-start justify-between gap-3 flex-wrap" data-testid="referral-row">
                <div>
                  <div className="font-semibold">{patient(r.patient_id)?.name ?? 'Patient'}</div>
                  <div className="text-sm text-ink-soft">From {doctor(r.from_practitioner_id)} · {r.reason}</div>
                  {r.restrictions && <div className="text-sm text-gate mt-0.5">Precaution: {r.restrictions}</div>}
                </div>
                <Btn variant="primary" data-testid="accept-referral" onClick={() => setNewPlan({ patientId: r.patient_id, referralId: r.id, condition: r.reason ?? '' })}>Accept and plan</Btn>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 mb-6">
        {active.map((p) => <PlanCard key={p.id} plan={p} patient={patient(p.patient_id)} sessions={sessionsOf(physio.sessions, p.id)} />)}
        {physio.loaded && active.length === 0 && <Card><p className="text-ink-soft">No active therapy plans yet.</p></Card>}
      </div>

      {done.length > 0 && (
        <Card>
          <button type="button" className="min-h-11 font-semibold" onClick={() => setShowDone((v) => !v)}>
            {showDone ? '▾' : '▸'} Completed plans ({done.length})
          </button>
          {showDone && (
            <div className="flex flex-col divide-y divide-line mt-2">
              {done.map((p) => (
                <Link key={p.id} to={`/physio?plan=${p.id}`} className="py-2.5 text-ink">
                  <span className="font-semibold">{patient(p.patient_id)?.name}</span>
                  <span className="text-ink-soft"> · {p.condition} · {sessionsOf(physio.sessions, p.id).length} sessions</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      )}

      {newPlan && (
        <NewPlanModal
          initial={newPlan}
          patients={patients}
          existing={physio.plans}
          onClose={() => setNewPlan(null)}
          onCreated={() => { setNewPlan(null); void physio.reload(); }}
        />
      )}
    </>
  );
}

function PlanCard({ plan, patient, sessions }: { plan: PhysioPlanRow; patient?: PatientRow; sessions: TherapySessionRow[] }) {
  const last = sessions.at(-1);
  const first = sessions[0];
  const change = last && first && last.pain_score != null && first.pain_score != null ? last.pain_score - first.pain_score : null;
  const pct = plan.planned_sessions ? Math.min(100, Math.round((sessions.length / plan.planned_sessions) * 100)) : 0;
  const overdue = plan.review_date && plan.review_date < today();
  return (
    <Link to={`/physio?plan=${plan.id}`} data-testid="plan-card"
      className="block bg-surface rounded-[var(--radius)] shadow-[var(--card-shadow)] p-5 hover:ring-2 hover:ring-accent text-ink">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-lg font-bold">{patient?.name ?? 'Patient'}</div>
          <div className="text-sm text-ink-soft">{plan.condition}</div>
        </div>
        {overdue ? <Pill tone="gate">Review due</Pill> : <Pill tone="ok">Active</Pill>}
      </div>
      <div className="mt-3 h-2 rounded-full bg-surface-2 overflow-hidden" aria-hidden="true">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div><span className="text-ink-soft">Sessions</span><div className="font-semibold">{sessions.length}{plan.planned_sessions ? ` of ${plan.planned_sessions}` : ''}</div></div>
        <div>
          <span className="text-ink-soft">Pain now</span>
          <div className="font-semibold">
            {last?.pain_score != null ? `${last.pain_score}/10` : '—'}
            {change != null && change !== 0 && <span className={change < 0 ? 'text-ok' : 'text-danger'}> {change < 0 ? '↓' : '↑'}{Math.abs(change)}</span>}
          </div>
        </div>
        <div><span className="text-ink-soft">Review</span><div className="font-semibold">{fmtDay(plan.review_date)}</div></div>
      </div>
    </Link>
  );
}

function NewPlanModal({
  initial, patients, existing, onClose, onCreated,
}: {
  initial: { patientId?: string; referralId?: string; condition?: string };
  patients: PatientRow[];
  existing: PhysioPlanRow[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { orgId, pushToast, logAudit } = useClinic();
  const { practitioner } = useAuth();
  const [f, setF] = useState({
    patientId: initial.patientId ?? '', condition: initial.condition ?? '', goals: '',
    plannedSessions: '8', perWeek: '2', reviewDate: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const withActivePlan = new Set(existing.filter((p) => p.status === 'active').map((p) => p.patient_id));
  const choices = patients.filter((p) => !withActivePlan.has(p.id) || p.id === initial.patientId).sort((a, b) => a.name.localeCompare(b.name));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.patientId) return setError('Choose the patient.');
    if (!f.condition.trim()) return setError('Describe the condition being treated.');
    setSaving(true); setError(null);
    const id = newId('plan');
    const { error: err } = await supabase.from('physiotherapy_plans').insert({
      id, org_id: orgId, patient_id: f.patientId, referral_id: initial.referralId ?? null, practitioner_id: practitioner?.id ?? null,
      condition: f.condition.trim(), goals: f.goals.trim() || null, status: 'active', start_date: today(),
      planned_sessions: Number(f.plannedSessions) || null, sessions_per_week: Number(f.perWeek) || null,
      review_date: f.reviewDate || null, home_programme: [],
    });
    if (err) { setSaving(false); setError(err.message); return; }
    if (initial.referralId) await supabase.from('referrals').update({ status: 'accepted' }).eq('id', initial.referralId);
    const name = patients.find((p) => p.id === f.patientId)?.name ?? 'patient';
    await logAudit('physio-plan-created', name);
    pushToast({ tone: 'ok', title: 'Therapy plan started', detail: name });
    setSaving(false);
    onCreated();
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="text-xl mb-3">New therapy plan</h2>
      <form onSubmit={submit}>
        <Field label="Patient">
          <select data-testid="plan-patient" className={inputCls} value={f.patientId} onChange={set('patientId')} disabled={!!initial.patientId}>
            <option value="">Choose…</option>
            {choices.map((p) => <option key={p.id} value={p.id}>{p.name}{p.age ? `, ${p.age}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Condition being treated"><input data-testid="plan-condition" className={inputCls} value={f.condition} onChange={set('condition')} placeholder="e.g. Frozen shoulder, left" /></Field>
        <Field label="Goals"><textarea className={`${inputCls} min-h-20`} value={f.goals} onChange={set('goals')} placeholder="What the patient wants to be able to do" /></Field>
        <div className="grid grid-cols-3 gap-x-3">
          <Field label="Planned sessions"><input className={inputCls} inputMode="numeric" value={f.plannedSessions} onChange={set('plannedSessions')} /></Field>
          <Field label="Per week"><input className={inputCls} inputMode="numeric" value={f.perWeek} onChange={set('perWeek')} /></Field>
          <Field label="Review on"><input className={inputCls} type="date" value={f.reviewDate} onChange={set('reviewDate')} /></Field>
        </div>
        {error && <div className="mt-4 text-sm text-danger bg-danger-soft rounded-lg px-3 py-2" role="alert">{error}</div>}
        <div className="mt-5 flex gap-2">
          <Btn type="submit" variant="glow" disabled={saving} data-testid="save-plan">{saving ? 'Saving…' : 'Start plan'}</Btn>
          <Btn type="button" variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------------ */
/* Plan detail                                                              */
/* ------------------------------------------------------------------------ */

function PlanDetail({ plan, physio }: { plan: PhysioPlanRow; physio: Physio }) {
  const { patients } = useClinic();
  const patient = patients.find((p) => p.id === plan.patient_id);
  const sessions = sessionsOf(physio.sessions, plan.id);
  const first = sessions[0];
  const last = sessions.at(-1);
  const painPoints = sessions.filter((s) => s.pain_score != null).map((s, i) => ({ label: `S${i + 1} · ${fmtDay(s.date)}`, value: s.pain_score as number }));

  return (
    <>
      <Link to="/physio" className="inline-flex items-center min-h-11 font-semibold -mt-3">← Caseload</Link>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
        <div>
          <h2 className="text-2xl" data-testid="plan-patient-name">{patient?.name ?? 'Patient'}</h2>
          <p className="text-ink-soft">{plan.condition}{patient?.age ? ` · ${patient.age}y ${patient.gender ?? ''}` : ''}</p>
        </div>
        <Pill tone={plan.status === 'active' ? 'ok' : 'default'}>{plan.status === 'active' ? 'Active' : 'Completed'}</Pill>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatTile label="Sessions done" value={`${sessions.length}${plan.planned_sessions ? ` / ${plan.planned_sessions}` : ''}`} />
        <StatTile label="Pain now (0-10)" value={last?.pain_score ?? '—'} tone="accent" />
        <StatTile label="Pain change since start" value={first?.pain_score != null && last?.pain_score != null ? `${last.pain_score - first.pain_score > 0 ? '+' : ''}${last.pain_score - first.pain_score}` : '—'} tone={first && last && (last.pain_score ?? 0) < (first.pain_score ?? 0) ? 'ok' : 'default'} />
        <StatTile label="Next review" value={fmtDay(plan.review_date)} />
      </div>

      {painPoints.length > 0 && (
        <Card className="mb-6">
          <SectionHead title="Pain over sessions" desc={last?.rom ? `Latest range of motion: ${last.rom}. Strength: ${last.strength ?? '—'}.` : undefined} />
          <LineChart points={painPoints} yMax={10} title="Pain score by session" testId="pain-chart" />
        </Card>
      )}

      {plan.status === 'active' && <RecordSession plan={plan} sessionCount={sessions.length} onSaved={physio.reload} />}

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <HomeProgramme plan={plan} exercises={physio.exercises} onSaved={physio.reload} />
        <PlanDetails plan={plan} onSaved={physio.reload} />
      </div>

      <Card className="mt-6">
        <SectionHead title="Session record" desc="Newest first." />
        <div className="flex flex-col divide-y divide-line">
          {[...sessions].reverse().map((s, idx) => (
            <details key={s.id} className="py-3" data-testid="session-row" open={idx === 0}>
              <summary className="cursor-pointer min-h-11 flex items-center justify-between gap-3">
                <span className="font-semibold">Session {sessions.length - idx} · {fmtDay(s.date)}</span>
                <span className="text-sm text-ink-soft">Pain {s.pain_score ?? '—'}/10{s.rom ? ` · ${s.rom}` : ''}</span>
              </summary>
              <dl className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <div><dt className="text-ink-soft inline">Strength: </dt><dd className="inline">{s.strength ?? '—'}</dd></div>
                <div><dt className="text-ink-soft inline">Mobility: </dt><dd className="inline">{s.mobility ?? '—'}</dd></div>
                <div><dt className="text-ink-soft inline">Tolerance: </dt><dd className="inline">{s.tolerance ?? '—'}</dd></div>
                <div><dt className="text-ink-soft inline">Exercises: </dt><dd className="inline">{s.exercises_done?.join(', ') || '—'}</dd></div>
              </dl>
              {s.progress_note && <p className="mt-2 text-[15px]">{s.progress_note}</p>}
              <p className="mt-1 text-xs text-ink-faint">{s.created_by ?? ''}{s.provenance === 'ai_drafted_clinician_approved' ? ' · drafted by Naad, approved by the physio' : ''}</p>
            </details>
          ))}
          {sessions.length === 0 && <p className="text-ink-soft py-2">No sessions recorded yet.</p>}
        </div>
      </Card>
    </>
  );
}

function parsePain(v: unknown): string {
  const m = /(\d+(?:\.\d+)?)/.exec(String(v ?? ''));
  return m ? String(Math.round(Number(m[1]))) : '';
}

function RecordSession({ plan, sessionCount, onSaved }: { plan: PhysioPlanRow; sessionCount: number; onSaved: () => void }) {
  const { orgId, pushToast, logAudit } = useClinic();
  const { practitioner } = useAuth();
  const blank = { pain: '', rom: '', strength: '', mobility: '', tolerance: '', note: '', exercises: [] as string[] };
  const [f, setF] = useState(blank);
  const [aiUsed, setAiUsed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const capture = useRealAmbientCapture({ stage: 'physio', patientId: plan.patient_id, encounterId: null, planId: plan.id });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const programme = plan.home_programme.map((h) => h.name);
  const exerciseChoices = Array.from(new Set([...programme, ...f.exercises]));

  function applyDraft(ex: Record<string, unknown>) {
    setF((x) => ({
      pain: parsePain(ex.painScore) || x.pain,
      rom: String(ex.rom ?? '') || x.rom,
      strength: String(ex.strength ?? '') || x.strength,
      mobility: String(ex.mobility ?? '') || x.mobility,
      tolerance: String(ex.tolerance ?? '') || x.tolerance,
      note: String(ex.progressNote ?? '') || x.note,
      exercises: Array.from(new Set([...x.exercises, ...((ex.exercisesDone as string[]) ?? [])])),
    }));
    setAiUsed(true);
  }

  async function start() {
    setRecording(true);
    if (!scriptedAmbient) await capture.start();
  }
  async function stop() {
    setRecording(false);
    if (scriptedAmbient) {
      if (import.meta.env.MODE !== 'test') applyDraft(demoExtractionFor('Physiotherapy', plan.condition ?? '', programme).extracted);
      return;
    }
    const result = await capture.stop();
    if (result) applyDraft(result.extracted);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const pain = f.pain === '' ? null : Math.max(0, Math.min(10, Number(f.pain)));
    const { error } = await supabase.from('therapy_sessions').insert({
      id: newId('ts'), org_id: orgId, plan_id: plan.id, patient_id: plan.patient_id, date: new Date().toISOString(),
      pain_score: pain, rom: f.rom.trim() || null, strength: f.strength.trim() || null, mobility: f.mobility.trim() || null,
      exercises_done: f.exercises, tolerance: f.tolerance.trim() || null, progress_note: f.note.trim() || null,
      provenance: aiUsed ? 'ai_drafted_clinician_approved' : 'clinician_approved', created_by: practitioner?.name ?? null,
    });
    setSaving(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not save the session', detail: error.message }); return; }
    await logAudit('therapy-session-recorded', `${plan.condition ?? ''} session ${sessionCount + 1}`);
    pushToast({ tone: 'ok', title: `Session ${sessionCount + 1} saved` });
    setF(blank); setAiUsed(false);
    onSaved();
  }

  return (
    <Card className="mb-6" data-testid="record-session">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <SectionHead title={`Record session ${sessionCount + 1}`} desc="Record the session with Naad and check the draft, or type it in. You sign it by saving." />
        <div className="flex items-center gap-3">
          {recording && <AmbientOrb active />}
          {recording
            ? <Btn variant="glow" onClick={stop} data-testid="stop-session-recording">Stop recording</Btn>
            : <Btn variant="glow" onClick={start} data-testid="start-session-recording" disabled={capture.status === 'processing'}>{capture.status === 'processing' ? 'Transcribing…' : 'Start recording'}</Btn>}
        </div>
      </div>
      {capture.error && <div className="mb-3 text-sm text-danger bg-danger-soft rounded-lg px-3 py-2" role="alert">{capture.error.message}</div>}
      {aiUsed && <div className="mb-3 text-sm bg-accent-soft rounded-lg px-3 py-2" role="status">Naad drafted this from the recording. Check every field before saving.</div>}
      <form onSubmit={save}>
        <div className="grid md:grid-cols-3 gap-x-4">
          <Field label="Pain now (0-10)"><input data-testid="session-pain" className={inputCls} inputMode="numeric" value={f.pain} onChange={set('pain')} placeholder="e.g. 4" /></Field>
          <Field label="Range of motion"><input data-testid="session-rom" className={inputCls} value={f.rom} onChange={set('rom')} placeholder="e.g. Knee flexion 0-110 deg" /></Field>
          <Field label="Strength"><input className={inputCls} value={f.strength} onChange={set('strength')} placeholder="e.g. Quadriceps 4/5" /></Field>
          <Field label="Mobility / function"><input className={inputCls} value={f.mobility} onChange={set('mobility')} placeholder="e.g. Stairs one at a time" /></Field>
          <Field label="Tolerance"><input className={inputCls} value={f.tolerance} onChange={set('tolerance')} placeholder="e.g. Good, mild ache after" /></Field>
        </div>
        <div className="mt-3">
          <span className="block text-[13px] font-semibold text-ink-soft mb-1.5">Exercises done</span>
          <div className="flex flex-wrap gap-2">
            {exerciseChoices.map((name) => {
              const on = f.exercises.includes(name);
              return (
                <button type="button" key={name} aria-pressed={on}
                  onClick={() => setF((x) => ({ ...x, exercises: on ? x.exercises.filter((n) => n !== name) : [...x.exercises, name] }))}
                  className={`min-h-11 px-3 rounded-full border text-sm font-medium ${on ? 'bg-accent text-on-accent border-accent' : 'border-line-strong text-ink'}`}>
                  {name}
                </button>
              );
            })}
            {exerciseChoices.length === 0 && <span className="text-sm text-ink-soft">Add exercises to the home programme to tick them here.</span>}
          </div>
        </div>
        <Field label="Progress note"><textarea data-testid="session-note" className={`${inputCls} min-h-24`} value={f.note} onChange={set('note')} placeholder="How the session went and what's next" /></Field>
        <Btn type="submit" variant="glow" className="mt-4" disabled={saving || recording} data-testid="save-session">{saving ? 'Saving…' : 'Save session'}</Btn>
      </form>
    </Card>
  );
}

function HomeProgramme({ plan, exercises, onSaved }: { plan: PhysioPlanRow; exercises: ExerciseRow[]; onSaved: () => void }) {
  const { pushToast } = useClinic();
  const [items, setItems] = useState<HomeProgrammeItem[]>(plan.home_programme);
  const [pick, setPick] = useState('');
  const [dirty, setDirty] = useState(false);
  const change = (next: HomeProgrammeItem[]) => { setItems(next); setDirty(true); };

  function add() {
    const e = exercises.find((x) => String(x.id) === pick);
    if (!e) return;
    change([...items, { exerciseId: String(e.id), name: e.name, sets: e.sets, reps: e.reps ?? '', timesPerWeek: 5, notes: '' }]);
    setPick('');
  }
  async function save() {
    const { error } = await supabase.from('physiotherapy_plans').update({ home_programme: items }).eq('id', plan.id);
    if (error) { pushToast({ tone: 'critical', title: 'Could not save the programme', detail: error.message }); return; }
    setDirty(false);
    pushToast({ tone: 'ok', title: 'Home programme saved', detail: 'The patient sees it in their app.' });
    onSaved();
  }
  const upd = (i: number, k: keyof HomeProgrammeItem, v: string) =>
    change(items.map((it, j) => (j === i ? { ...it, [k]: k === 'sets' || k === 'timesPerWeek' ? (v === '' ? null : Number(v)) : v } : it)));

  return (
    <Card data-testid="home-programme">
      <SectionHead title="Home exercise programme" desc="What the patient does at home. They see this list in their Naad app." />
      <div className="flex flex-col gap-3">
        {items.map((it, i) => (
          <div key={`${it.name}-${i}`} className="bg-surface-2 rounded-lg p-3" data-testid="programme-item">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{it.name}</span>
              <Btn variant="danger" className="!px-2" aria-label={`Remove ${it.name}`} onClick={() => change(items.filter((_, j) => j !== i))}>Remove</Btn>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <label className="text-xs text-ink-soft">Sets<input className={inputCls} inputMode="numeric" value={it.sets ?? ''} onChange={(e) => upd(i, 'sets', e.target.value)} /></label>
              <label className="text-xs text-ink-soft">Reps / time<input className={inputCls} value={it.reps} onChange={(e) => upd(i, 'reps', e.target.value)} /></label>
              <label className="text-xs text-ink-soft">Days a week<input className={inputCls} inputMode="numeric" value={it.timesPerWeek ?? ''} onChange={(e) => upd(i, 'timesPerWeek', e.target.value)} /></label>
            </div>
            <input className={`${inputCls} mt-2`} aria-label={`Notes for ${it.name}`} value={it.notes} onChange={(e) => upd(i, 'notes', e.target.value)} placeholder="Note for the patient (optional)" />
          </div>
        ))}
        {items.length === 0 && <p className="text-ink-soft">No exercises yet.</p>}
      </div>
      <div className="mt-3 flex gap-2 items-end">
        <label className="flex-1 text-[13px] font-semibold text-ink-soft">Add from library
          <select data-testid="programme-pick" className={`${inputCls} mt-1.5`} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose an exercise…</option>
            {REGIONS.map((r) => (
              <optgroup key={r} label={r}>
                {exercises.filter((e) => (e.region ?? 'General') === r).map((e) => <option key={e.id} value={String(e.id)}>{e.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <Btn variant="primary" onClick={add} disabled={!pick} data-testid="programme-add">Add</Btn>
      </div>
      <Btn variant="glow" className="mt-4" disabled={!dirty} onClick={save} data-testid="programme-save">Save programme</Btn>
    </Card>
  );
}

function PlanDetails({ plan, onSaved }: { plan: PhysioPlanRow; onSaved: () => void }) {
  const { pushToast, logAudit } = useClinic();
  const [f, setF] = useState({
    condition: plan.condition ?? '', goals: plan.goals ?? '', planned: String(plan.planned_sessions ?? ''),
    perWeek: String(plan.sessions_per_week ?? ''), review: plan.review_date ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(patch: Record<string, unknown>, msg: string) {
    const { error } = await supabase.from('physiotherapy_plans').update(patch).eq('id', plan.id);
    if (error) { pushToast({ tone: 'critical', title: 'Could not save', detail: error.message }); return; }
    pushToast({ tone: 'ok', title: msg });
    onSaved();
  }

  return (
    <Card>
      <SectionHead title="Plan and goals" desc={`Started ${fmtDay(plan.start_date)}.`} />
      <Field label="Condition"><input className={inputCls} value={f.condition} onChange={set('condition')} /></Field>
      <Field label="Goals"><textarea className={`${inputCls} min-h-24`} value={f.goals} onChange={set('goals')} /></Field>
      <div className="grid grid-cols-3 gap-x-3">
        <Field label="Planned sessions"><input className={inputCls} inputMode="numeric" value={f.planned} onChange={set('planned')} /></Field>
        <Field label="Per week"><input className={inputCls} inputMode="numeric" value={f.perWeek} onChange={set('perWeek')} /></Field>
        <Field label="Review on"><input className={inputCls} type="date" value={f.review} onChange={set('review')} /></Field>
      </div>
      <div className="mt-4 flex gap-2 flex-wrap">
        <Btn variant="glow" onClick={() => save({
          condition: f.condition.trim() || null, goals: f.goals.trim() || null, planned_sessions: Number(f.planned) || null,
          sessions_per_week: Number(f.perWeek) || null, review_date: f.review || null,
        }, 'Plan saved')}>Save plan</Btn>
        {plan.status === 'active'
          ? <Btn variant="default" data-testid="complete-plan" onClick={async () => { await save({ status: 'completed' }, 'Plan completed'); await logAudit('physio-plan-completed', plan.condition ?? ''); }}>Mark plan complete</Btn>
          : <Btn variant="default" onClick={() => save({ status: 'active' }, 'Plan reopened')}>Reopen plan</Btn>}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/* Exercise library                                                         */
/* ------------------------------------------------------------------------ */

function Library({ exercises }: { exercises: ExerciseRow[] }) {
  const { orgId, pushToast } = useClinic();
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('');
  const [editing, setEditing] = useState<Partial<ExerciseRow> | null>(null);
  const shown = useMemo(() => exercises.filter((e) =>
    (!region || (e.region ?? 'General') === region) && (!q || `${e.name} ${e.instructions ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [exercises, q, region]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing?.name?.trim()) return;
    const row = { name: editing.name.trim(), region: editing.region || 'General', sets: editing.sets ?? null, reps: editing.reps || null, instructions: editing.instructions || null };
    const { error } = editing.id != null
      ? await supabase.from('exercise_library').update(row).eq('id', editing.id)
      : await supabase.from('exercise_library').insert({ org_id: orgId, ...row });
    if (error) { pushToast({ tone: 'critical', title: 'Could not save the exercise', detail: /duplicate|unique/i.test(error.message) ? 'An exercise with this name already exists.' : error.message }); return; }
    pushToast({ tone: 'ok', title: editing.id != null ? 'Exercise updated' : 'Exercise added' });
    setEditing(null);
  }

  return (
    <>
      <div className="flex gap-2 flex-wrap items-end mb-4 -mt-3">
        <label className="flex-1 min-w-48 text-[13px] font-semibold text-ink-soft">Search
          <input data-testid="library-search" className={`${inputCls} mt-1.5`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. squat" />
        </label>
        <label className="text-[13px] font-semibold text-ink-soft">Body region
          <select className={`${inputCls} mt-1.5`} value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All</option>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <Btn variant="glow" onClick={() => setEditing({ region: 'Knee', sets: 3, reps: '10' })} data-testid="add-exercise">+ Add exercise</Btn>
      </div>
      <p className="text-ink-soft text-sm mb-3">{shown.length} of {exercises.length} exercises</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {shown.map((e) => (
          <Card key={e.id} className="!p-4" data-testid="exercise-card">
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold">{e.name}</div>
              <Pill tone="accent">{e.region ?? 'General'}</Pill>
            </div>
            <div className="text-sm text-ink-soft mt-1">{e.sets ? `${e.sets} sets · ` : ''}{e.reps}</div>
            {e.instructions && <p className="text-sm mt-2">{e.instructions}</p>}
            <Btn variant="ghost" className="!px-0 mt-1" onClick={() => setEditing(e)}>Edit</Btn>
          </Card>
        ))}
      </div>
      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <h2 className="text-xl mb-3">{editing.id != null ? 'Edit exercise' : 'Add exercise'}</h2>
          <form onSubmit={save}>
            <Field label="Name"><input data-testid="exercise-name" className={inputCls} value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <div className="grid grid-cols-3 gap-x-3">
              <Field label="Region">
                <select className={inputCls} value={editing.region ?? 'General'} onChange={(e) => setEditing({ ...editing, region: e.target.value })}>
                  {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="Sets"><input className={inputCls} inputMode="numeric" value={editing.sets ?? ''} onChange={(e) => setEditing({ ...editing, sets: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
              <Field label="Reps / time"><input className={inputCls} value={editing.reps ?? ''} onChange={(e) => setEditing({ ...editing, reps: e.target.value })} /></Field>
            </div>
            <Field label="How to do it"><textarea className={`${inputCls} min-h-24`} value={editing.instructions ?? ''} onChange={(e) => setEditing({ ...editing, instructions: e.target.value })} /></Field>
            <div className="mt-5 flex gap-2">
              <Btn type="submit" variant="glow" data-testid="save-exercise">Save</Btn>
              <Btn type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Btn>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
