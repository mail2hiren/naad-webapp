import { useEffect, useRef, useState } from 'react';
import { Btn, Card, Pill, inputCls } from '../../components/ui';
import { supabase } from '../../lib/supabaseClient';
import type { ClinicalNote, JointAlignment, JointAssessmentEntry, PatientRow, RehabExercise, Specialty, WeeklyProgressEntry } from '../../types/db';

/**
 * ClinicalAssistantSidebar -- the "Clinical Whisperer." Reads the signed-in
 * doctor's specialty and renders a different set of prompts AND a different
 * structured tracking widget per specialty (Clinical_User_Stories rows
 * 3.1.A / 3.1.B / 3.1.C), on top of the shared text-prompt checklist that
 * already existed. Checking a checklist item is still a pure local nudge --
 * it writes nothing to Supabase. The specialty widgets below it DO write,
 * through the same `onUpdateNote` callback DoctorView already uses for the
 * SOAP note, so they autosave exactly like everything else on the chart.
 */
const CHECKLISTS: Record<Specialty, string[]> = {
  Orthopedics: [
    'Radiation of pain — does it travel down the leg?',
    'Joint stability — any giving-way or locking?',
    'Morning stiffness — how long does it last?',
    'Joint space alignment on imaging',
    'Radiating nerve signs',
  ],
  Physiotherapy: [
    'Functional movement boundaries — which motions are limited?',
    'Pain triggers — worse sitting or walking?',
    'Mechanical load-bearing limits',
    'Weekly exercise progression plan reviewed',
  ],
  'Critical Care': [
    'Oxygen saturation drops — at rest or on exertion?',
    'Chronic history — diabetes, cardiac, respiratory?',
    'High-risk vitals — BP / HR / RR trend',
    'Oxygen volatility tracking',
    'Comorbid threats reviewed',
  ],
};

const JOINT_ALIGNMENTS: JointAlignment[] = ['Normal', 'Reduced spacing', 'Bone-on-bone', 'Fracture line'];
const ALIGNMENT_TONE: Record<JointAlignment, string> = {
  Normal: 'bg-ok',
  'Reduced spacing': 'bg-gate',
  'Bone-on-bone': 'bg-danger',
  'Fracture line': 'bg-danger',
};

/** Keyword → risk label map for the Critical Care Comorbidity Risk Scan.
 * Per the sheet's own DB-mutation column for row 3.1.C ("Evaluates vital
 * risk properties layers inside runtime memory"), this is a pure derived
 * display over the patient's existing `conditions`/`allergies` -- nothing
 * here is written back to Supabase. */
const COMORBIDITY_KEYWORDS: { pattern: RegExp; risk: string }[] = [
  { pattern: /diabet/i, risk: 'Glycemic volatility -- monitor blood glucose closely' },
  { pattern: /hypertension|cardiac|heart/i, risk: 'Cardiac strain -- watch BP/HR trend closely' },
  { pattern: /asthma|copd|respirat/i, risk: 'Respiratory compromise -- low SpO2 tolerance' },
  { pattern: /renal|kidney/i, risk: 'Renal impairment -- caution with drug dosing' },
  { pattern: /osteoporosis/i, risk: 'Fragile bone stock -- fracture risk on movement' },
];

/**
 * Fetches case-specific prompts from the `clinical-whisperer` edge function
 * (reads the patient's chief complaint / triage notes / front-desk notes /
 * conditions / allergies and asks an LLM for prompts tailored to THIS
 * consult) -- replacing the one-size-fits-all CHECKLISTS per doctor
 * feedback (Dr. Jayani, 2026-09-03: "should be case specific").
 *
 * Fails soft at every layer: no ANTHROPIC_API_KEY configured, the API
 * call erroring, an unparseable response, the edge function itself being
 * unreachable (mock mode, a network hiccup) -- all of it just falls back
 * to the static per-specialty CHECKLISTS, silently, so the sidebar never
 * breaks and a doctor never sees a raw error mid-consult. `aiActive` tells
 * the UI which mode produced the current list, purely for the small
 * "AI" vs "Standard" indicator -- nothing behaves differently either way.
 */
function useWhispererPrompts(specialty: Specialty | null, patient: PatientRow | null) {
  const [state, setState] = useState<{ items: string[]; loading: boolean; aiActive: boolean }>({
    items: specialty ? CHECKLISTS[specialty] : [], loading: false, aiActive: false,
  });
  const requestId = useRef(0);

  useEffect(() => {
    if (!specialty || !patient) {
      setState({ items: specialty ? CHECKLISTS[specialty] : [], loading: false, aiActive: false });
      return;
    }
    const id = ++requestId.current;
    setState({ items: CHECKLISTS[specialty], loading: true, aiActive: false });

    supabase.functions.invoke('clinical-whisperer', {
      body: {
        specialty,
        complaints: patient.triage?.complaints,
        triageNotes: patient.triage?.notes,
        frontDeskNotes: patient.intake_state?.rawTranscriptStream,
        conditions: patient.conditions,
        allergies: patient.allergies,
        age: patient.age,
        gender: patient.gender,
      },
    }).then(({ data, error }: { data: { prompts?: string[] | null; fallback?: boolean } | null; error: unknown }) => {
      if (id !== requestId.current) return; // patient switched mid-request; drop the stale response
      if (error || !data || data.fallback || !Array.isArray(data.prompts) || data.prompts.length === 0) {
        setState({ items: CHECKLISTS[specialty], loading: false, aiActive: false });
      } else {
        setState({ items: data.prompts, loading: false, aiActive: true });
      }
    }).catch(() => {
      if (id !== requestId.current) return;
      setState({ items: CHECKLISTS[specialty], loading: false, aiActive: false });
    });
    // Deliberately keyed on specialty + patient identity only, not on the
    // individual patient fields sent in the request body -- those (triage
    // notes, conditions...) are set once at intake and don't change while
    // the doctor is typing the note, so re-running on every field would
    // just be re-fetching the same case with extra latency and API cost.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialty, patient?.id]);

  return state;
}

export function ClinicalAssistantSidebar({
  specialty,
  answers,
  onToggle,
  patient,
  note,
  onUpdateNote,
}: {
  specialty: Specialty | null;
  answers: Record<string, boolean>;
  onToggle: (item: string) => void;
  patient: PatientRow | null;
  note: ClinicalNote | null;
  onUpdateNote: (patch: Partial<ClinicalNote>) => void;
}) {
  const { items, loading, aiActive } = useWhispererPrompts(specialty, patient);
  const checkedCount = items.filter((it) => answers[it]).length;

  return (
    <div className="flex flex-col gap-4">
      <Card className="!p-4 md:sticky md:top-20 h-fit">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="font-mono text-[10px] tracking-[.14em] uppercase text-accent-ink">Clinical Whisperer</div>
            {specialty && !loading && (
              <Pill tone={aiActive ? 'accent' : 'default'}>{aiActive ? 'AI · Case-specific' : 'Standard'}</Pill>
            )}
          </div>
          <Pill tone={checkedCount === items.length && items.length > 0 ? 'ok' : 'default'}>
            {checkedCount}/{items.length}
          </Pill>
        </div>
        <p className="text-ink-faint text-xs font-light mb-3 leading-relaxed">
          {!specialty
            ? 'Select a patient to load specialty prompts.'
            : loading
              ? 'Reading this patient’s case for tailored prompts…'
              : aiActive
                ? `AI-generated prompts for ${patient?.name ?? 'this patient'}’s specific case.`
                : `${specialty}-specific prompts for this consult.`}
        </p>
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => {
            const checked = !!answers[item];
            return (
              <li key={item}>
                <button
                  type="button"
                  data-testid="checklist-item"
                  onClick={() => onToggle(item)}
                  className={`w-full text-left flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-xs leading-snug transition-colors ${
                    checked ? 'bg-ok-soft text-ok' : 'text-ink-soft hover:bg-white/5 hover:text-ink'
                  }`}
                >
                  <span
                    className={`mt-0.5 shrink-0 w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center ${
                      checked ? 'bg-ok border-ok text-[#04120c]' : 'border-line-strong'
                    }`}
                  >
                    {checked && (
                      <svg viewBox="0 0 12 12" width="9" height="9" fill="none">
                        <path d="M2 6l2.5 2.5L10 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className={checked ? 'line-through decoration-ok/60' : ''}>{item}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      {specialty === 'Orthopedics' && note && (
        <SkeletalAssessmentLog note={note} onUpdateNote={onUpdateNote} />
      )}
      {specialty === 'Physiotherapy' && note && (
        <ProgressionMatrix note={note} onUpdateNote={onUpdateNote} />
      )}
      {specialty === 'Critical Care' && (
        <>
          {patient && <ComorbidityRiskScan patient={patient} />}
          {note && <VitalsTrend note={note} onUpdateNote={onUpdateNote} />}
        </>
      )}
    </div>
  );
}

/** Row 3.1.A -- joint-by-joint alignment tracker with a colored alignment
 * dot per entry (the "alignment lines" the sheet describes), editable
 * during the consult and persisted on the clinical note. */
function SkeletalAssessmentLog({ note, onUpdateNote }: { note: ClinicalNote; onUpdateNote: (patch: Partial<ClinicalNote>) => void }) {
  const entries = note.jointAssessment ?? [];

  function addJoint() {
    onUpdateNote({ jointAssessment: [...entries, { joint: '', alignment: 'Normal' }] });
  }
  function updateJoint(idx: number, patch: Partial<JointAssessmentEntry>) {
    onUpdateNote({ jointAssessment: entries.map((e, i) => (i === idx ? { ...e, ...patch } : e)) });
  }
  function removeJoint(idx: number) {
    onUpdateNote({ jointAssessment: entries.filter((_, i) => i !== idx) });
  }

  return (
    <Card className="!p-4" data-testid="skeletal-assessment-log">
      <div className="flex items-center justify-between mb-1.5">
        <div className="font-mono text-[10px] tracking-[.14em] uppercase text-accent-ink">Skeletal Assessment Log</div>
        <Btn variant="ghost" data-testid="add-joint" onClick={addJoint}>+ Joint</Btn>
      </div>
      <p className="text-ink-faint text-xs font-light mb-3 leading-relaxed">
        Track joint spacing and alignment findings from imaging/exam.
      </p>
      <div className="flex flex-col gap-2">
        {entries.map((e, idx) => (
          <div key={idx} className="flex items-center gap-1.5" data-testid="joint-row">
            <span className={`w-2 h-2 rounded-full shrink-0 ${ALIGNMENT_TONE[e.alignment]}`} />
            <input
              className={inputCls}
              placeholder="Joint (e.g. Left Knee)"
              value={e.joint}
              onChange={(ev) => updateJoint(idx, { joint: ev.target.value })}
            />
            <select
              className={inputCls}
              data-testid="joint-alignment"
              value={e.alignment}
              onChange={(ev) => updateJoint(idx, { alignment: ev.target.value as JointAlignment })}
            >
              {JOINT_ALIGNMENTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <Btn variant="danger" onClick={() => removeJoint(idx)}>✕</Btn>
          </div>
        ))}
        {entries.length === 0 && <p className="text-ink-faint text-xs">No joints logged yet.</p>}
      </div>
    </Card>
  );
}

/** Row 3.1.B -- multi-week Progression Matrix for rehab exercises. Tracks
 * the first rehab exercise on the note (the common case -- add an exercise
 * on the Session & Note tab first); each week is an editable row (pain
 * score, reps completed, note). The same array reads out, unmodified, on
 * the Patient Portal's visit-history accordion once the visit completes. */
function ProgressionMatrix({ note, onUpdateNote }: { note: ClinicalNote; onUpdateNote: (patch: Partial<ClinicalNote>) => void }) {
  const exercises = note.rehabExercises;
  const primary = exercises[0];

  function updatePrimary(patch: Partial<RehabExercise>) {
    onUpdateNote({ rehabExercises: exercises.map((e, i) => (i === 0 ? { ...e, ...patch } : e)) });
  }
  function addWeek() {
    if (!primary) return;
    const weeks = primary.weeklyProgress ?? [];
    const nextWeek = weeks.length > 0 ? Math.max(...weeks.map((w) => w.week)) + 1 : 1;
    updatePrimary({ weeklyProgress: [...weeks, { week: nextWeek, painScore: null, repsCompleted: null, note: '' }] });
  }
  function updateWeek(idx: number, patch: Partial<WeeklyProgressEntry>) {
    if (!primary) return;
    const weeks = primary.weeklyProgress ?? [];
    updatePrimary({ weeklyProgress: weeks.map((w, i) => (i === idx ? { ...w, ...patch } : w)) });
  }
  function removeWeek(idx: number) {
    if (!primary) return;
    const weeks = primary.weeklyProgress ?? [];
    updatePrimary({ weeklyProgress: weeks.filter((_, i) => i !== idx) });
  }

  // Doctor feedback (Dr. Jayani, round 2, 2026-09-03): "you had created
  // progression graph which is also missing" -- a pain-score trend line
  // over the logged weeks, same sparkline technique VitalsTrend already
  // uses for SpO2, just plotted over `week` instead of reading order (weeks
  // aren't guaranteed to be logged in order, so sort before charting).
  const painPoints = (primary?.weeklyProgress ?? [])
    .slice()
    .sort((a, b) => a.week - b.week)
    .map((w) => w.painScore)
    .filter((v): v is number => v != null);
  const painSparkline = painPoints.length >= 2 ? buildSparkline(painPoints) : null;

  return (
    <Card className="!p-4" data-testid="progression-matrix">
      <div className="flex items-center justify-between mb-1.5">
        <div className="font-mono text-[10px] tracking-[.14em] uppercase text-accent-ink">Progression Matrix</div>
        {primary && <Btn variant="ghost" data-testid="add-week" onClick={addWeek}>+ Week</Btn>}
      </div>
      {!primary ? (
        <p className="text-ink-faint text-xs font-light leading-relaxed">
          Add a rehab exercise on the Session &amp; Note tab first -- the weekly matrix tracks progress against it.
        </p>
      ) : (
        <>
          <p className="text-ink-faint text-xs font-light mb-3 leading-relaxed">
            Week-over-week progress for <span className="text-ink-soft">{primary.exerciseName || 'the primary exercise'}</span>.
          </p>
          {painSparkline && (
            <div className="mb-3" data-testid="progression-graph">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[9px] uppercase text-ink-faint">Pain Score Trend</span>
                <span className="font-mono text-[9px] text-ink-faint">0-10</span>
              </div>
              <svg viewBox="0 0 100 28" className="w-full h-7" preserveAspectRatio="none">
                <polyline points={painSparkline} fill="none" stroke="var(--gate)" strokeWidth="2" />
              </svg>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {(primary.weeklyProgress ?? []).map((w, idx) => (
              // Two rows, not one 4-column grid -- doctor feedback (Dr.
              // Jayani, 2026-09-03: "Progression Matrix data is hidden not
              // readable") traced to the Note input being squeezed into a
              // 4th grid column alongside the remove button, leaving it a
              // few pixels wide with no room to show the text typed into
              // it. Week/Pain/Reps/Remove -- all short, fixed-width values
              // -- share a row; Note gets the full card width on its own.
              <div key={idx} className="flex flex-col gap-1.5 bg-surface-2 rounded-lg p-2" data-testid="progression-week-row">
                <div className="flex items-center gap-1.5">
                  <div className="font-mono text-[10px] text-ink-faint w-8 shrink-0">Wk {w.week}</div>
                  <input
                    className={inputCls}
                    type="number"
                    placeholder="Pain 0-10"
                    data-testid="week-pain"
                    value={w.painScore ?? ''}
                    onChange={(ev) => updateWeek(idx, { painScore: ev.target.value === '' ? null : Number(ev.target.value) })}
                  />
                  <input
                    className={inputCls}
                    type="number"
                    placeholder="Reps done"
                    value={w.repsCompleted ?? ''}
                    onChange={(ev) => updateWeek(idx, { repsCompleted: ev.target.value === '' ? null : Number(ev.target.value) })}
                  />
                  <Btn variant="danger" onClick={() => removeWeek(idx)}>✕</Btn>
                </div>
                <input
                  className={inputCls}
                  placeholder="Note"
                  value={w.note}
                  onChange={(ev) => updateWeek(idx, { note: ev.target.value })}
                />
              </div>
            ))}
            {(primary.weeklyProgress ?? []).length === 0 && <p className="text-ink-faint text-xs">No weeks logged yet.</p>}
          </div>
        </>
      )}
    </Card>
  );
}

/** Row 3.1.C (first half) -- amber systemic-warning widget derived purely
 * from the patient's existing conditions/allergies. No DB write, per the
 * sheet's own "runtime memory" framing for this row. */
function ComorbidityRiskScan({ patient }: { patient: PatientRow }) {
  const source = [...patient.conditions, ...patient.allergies.map((a) => `Allergy: ${a}`)];
  const risks = source.flatMap((entry) => {
    const match = COMORBIDITY_KEYWORDS.find((k) => k.pattern.test(entry));
    return match ? [{ entry, risk: match.risk }] : (/^Allergy:/.test(entry) ? [{ entry, risk: `Known allergy -- ${entry.replace('Allergy: ', '')}` }] : []);
  });

  return (
    <Card className="!p-4 border border-gate/40" data-testid="comorbidity-risk-scan">
      <div className="font-mono text-[10px] tracking-[.14em] uppercase text-gate mb-1.5">Comorbidity Risk Scan</div>
      {risks.length === 0 ? (
        <p className="text-ink-faint text-xs font-light leading-relaxed">No comorbidity or allergy risk flags for this patient.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {risks.map((r, i) => (
            <li key={i} className="flex items-start gap-2 bg-gate-soft rounded-lg px-2.5 py-2 text-xs text-gate animate-pulse" data-testid="comorbidity-flag">
              <span className="w-2 h-2 rounded-full bg-gate shrink-0 mt-0.5 shadow-[0_0_8px_2px_var(--gate)]" />
              <span>{r.risk}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Row 3.0.C (second half) -- a doctor-loggable vitals trend. No separate
 * `vitals_history` table exists in this schema, so the trend is built from
 * readings logged during the encounter itself, rendered as a small sparkline. */
function VitalsTrend({ note, onUpdateNote }: { note: ClinicalNote; onUpdateNote: (patch: Partial<ClinicalNote>) => void }) {
  const log = note.vitalsLog ?? [];

  function logReading() {
    onUpdateNote({ vitalsLog: [...log, { timestamp: new Date().toISOString(), spo2: null, heartRate: null, bloodPressure: '' }] });
  }
  function updateReading(idx: number, patch: Partial<(typeof log)[number]>) {
    onUpdateNote({ vitalsLog: log.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
  }

  const spo2Points = log.map((r) => r.spo2).filter((v): v is number => v != null);
  const sparkline = spo2Points.length >= 2 ? buildSparkline(spo2Points) : null;

  return (
    <Card className="!p-4" data-testid="vitals-trend">
      <div className="flex items-center justify-between mb-1.5">
        <div className="font-mono text-[10px] tracking-[.14em] uppercase text-accent-ink">Vitals Trend</div>
        <Btn variant="ghost" data-testid="log-vitals" onClick={logReading}>+ Log Reading</Btn>
      </div>
      {sparkline && (
        <svg viewBox="0 0 100 28" className="w-full h-7 mb-2" preserveAspectRatio="none">
          <polyline points={sparkline} fill="none" stroke="var(--danger)" strokeWidth="2" />
        </svg>
      )}
      <div className="flex flex-col gap-1.5">
        {log.map((r, idx) => (
          <div key={idx} className="grid grid-cols-3 gap-1.5 bg-surface-2 rounded-lg p-2" data-testid="vitals-row">
            <input
              className={inputCls}
              type="number"
              placeholder="SpO2 %"
              data-testid="vitals-spo2"
              value={r.spo2 ?? ''}
              onChange={(ev) => updateReading(idx, { spo2: ev.target.value === '' ? null : Number(ev.target.value) })}
            />
            <input
              className={inputCls}
              type="number"
              placeholder="HR bpm"
              value={r.heartRate ?? ''}
              onChange={(ev) => updateReading(idx, { heartRate: ev.target.value === '' ? null : Number(ev.target.value) })}
            />
            <input
              className={inputCls}
              placeholder="BP"
              value={r.bloodPressure}
              onChange={(ev) => updateReading(idx, { bloodPressure: ev.target.value })}
            />
          </div>
        ))}
        {log.length === 0 && <p className="text-ink-faint text-xs">No vitals logged this session yet.</p>}
      </div>
    </Card>
  );
}

function buildSparkline(values: number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 26 - ((v - min) / range) * 24 - 1;
      return `${x},${y}`;
    })
    .join(' ');
}
