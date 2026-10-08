import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Card, Panel, Btn, BulletList, Pill, SectionHead, inputCls } from '../components/ui';
import { toBullets } from '../lib/clinicalNote';
import type { EncounterRow, JourneyHistoryEntry, JourneyStage, PatientRow } from '../types/db';

/**
 * Patient Portal (/patient) -- a self-contained route for patients, NOT staff.
 * Patients authenticate against Supabase Auth and are matched to their own
 * `patients` row via `auth_user_id`. This is deliberately outside the staff
 * role-provisioning system (AuthContext / Shell): no staff account can browse
 * other patients' data through this route, and no other route depends on
 * patient-session state, so it is kept local to this component instead of a
 * shared React Context.
 */

const JOURNEY_STAGES: JourneyStage[] = ['admitted', 'operation', 'physiotherapy', 'progress_review', 'discharged'];

const STAGE_LABEL: Record<JourneyStage, string> = {
  admitted: 'Admitted',
  operation: 'Operation',
  physiotherapy: 'Physiotherapy',
  progress_review: 'Progress Review',
  discharged: 'Discharged',
};

type TimelineItem =
  | { kind: 'encounter'; id: string; at: string; encounter: EncounterRow }
  | { kind: 'journey'; id: string; at: string; entry: JourneyHistoryEntry };

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Date pending';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function PatientPortalView() {
  // -- auth / session state --------------------------------------------
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    document.title = 'Patient portal — Naad';
  }, []);

  // -- portal data --------------------------------------------------------
  const [encounters, setEncounters] = useState<EncounterRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // -- rebook widget --------------------------------------------------------
  const [rebooking, setRebooking] = useState(false);
  const [rebookDone, setRebookDone] = useState(false);
  const [rebookError, setRebookError] = useState<string | null>(null);

  async function loadPatientHistory(p: PatientRow) {
    setLoadingHistory(true);
    setHistoryError(null);
    const { data, error } = await supabase
      .from('encounters')
      .select('*')
      .eq('patient_id', p.id)
      .order('started_at', { ascending: false });
    if (error) {
      setHistoryError(error.message);
    } else {
      setEncounters((data ?? []) as EncounterRow[]);
    }
    setLoadingHistory(false);
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setSigningIn(true);

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError || !authData.user) {
      setLoginError(authError?.message ?? 'Sign-in failed. Check your email and password.');
      setSigningIn(false);
      return;
    }

    const { data: patientRow, error: patientError } = await supabase
      .from('patients')
      .select('*')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle();

    if (patientError || !patientRow) {
      await supabase.auth.signOut();
      setLoginError('No patient record is linked to this account.');
      setSigningIn(false);
      return;
    }

    const p = patientRow as PatientRow;
    setPatient(p);
    setSigningIn(false);
    void loadPatientHistory(p);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setPatient(null);
    setEncounters([]);
    setExpandedId(null);
    setRebookDone(false);
    setRebookError(null);
    setEmail('');
    setPassword('');
  }

  async function handleRebook() {
    if (!patient || rebooking) return;
    setRebooking(true);
    setRebookError(null);

    const latestSpecialty = encounters[0]?.specialty ?? null;

    const { error } = await supabase.from('appointments').insert({
      id: `ap-${Date.now()}`,
      org_id: patient.org_id,
      patient_id: patient.id,
      specialty: latestSpecialty,
      date: null,
      reason: 'Follow-up requested via Patient Portal',
      practitioner_id: patient.assigned_practitioner_id,
      status: 'requested',
      duration_minutes: 20,
      requested_by_patient: true,
    });

    if (error) {
      setRebookError(error.message);
      setRebooking(false);
      return;
    }

    setRebookDone(true);
    // Keep the button disabled briefly to prevent double-submission, then
    // allow another request (e.g. if the patient wants a second follow-up).
    setTimeout(() => {
      setRebooking(false);
      setRebookDone(false);
    }, 6000);
  }

  // Merge encounters + journey stage history into one newest-first timeline.
  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];
    for (const enc of encounters) {
      items.push({ kind: 'encounter', id: `enc-${enc.id}`, at: enc.started_at, encounter: enc });
    }
    for (const entry of patient?.journey_stage_history ?? []) {
      items.push({ kind: 'journey', id: `journey-${entry.stage}-${entry.enteredAt}`, at: entry.enteredAt, entry });
    }
    return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [encounters, patient]);

  const currentStageIndex = patient?.journey_stage ? JOURNEY_STAGES.indexOf(patient.journey_stage) : -1;

  // -- render: login --------------------------------------------------------
  if (!patient) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Panel className="max-w-[440px] w-full p-8 md:p-10">
          <div className="font-mono text-[10px] tracking-[.18em] uppercase text-ink-faint font-semibold flex items-center gap-2.5 mb-4">
            <span className="w-4 h-px bg-accent" />
            Naad · Patient Portal
          </div>
          <h1 className="text-2xl mb-2">Your care history</h1>
          <p className="text-ink-soft font-light leading-relaxed mb-6">
            This portal is for discharged patients and ongoing outpatients to view their own care history --
            no staff can browse other patients' data through this route. Sign in with the email and password
            given to you at your clinic.
          </p>

          <form onSubmit={handleLogin}>
            <label className="block mt-2.5">
              <span className="block font-mono text-[9.5px] tracking-wider uppercase text-ink-faint mb-1.5">Email</span>
              <input
                data-testid="patient-login-email"
                type="email"
                className={inputCls}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="username"
              />
            </label>
            <label className="block mt-2.5">
              <span className="block font-mono text-[9.5px] tracking-wider uppercase text-ink-faint mb-1.5">Password</span>
              <input
                data-testid="patient-login-password"
                type="password"
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>

            {loginError && (
              <div className="mt-4 text-sm text-danger bg-danger-soft rounded-lg px-3 py-2" data-testid="patient-login-error">
                {loginError}
              </div>
            )}

            <Btn
              type="submit"
              variant="glow"
              className="w-full mt-6 py-2.5"
              disabled={signingIn}
              data-testid="patient-login-submit"
            >
              {signingIn ? 'Signing in…' : 'Sign in'}
            </Btn>
          </form>
        </Panel>
      </div>
    );
  }

  // -- render: signed-in portal --------------------------------------------------------
  return (
    <div className="min-h-screen p-4 md:p-8 max-w-3xl mx-auto">
      <header className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="font-mono text-[10px] tracking-[.18em] uppercase text-ink-faint font-semibold flex items-center gap-2.5 mb-2">
            <span className="w-4 h-px bg-accent" />
            Naad · Patient Portal
          </div>
          <h1 className="text-2xl">{patient.name}</h1>
          <p className="text-ink-faint text-sm mt-1">
            {patient.mrn ? `MRN ${patient.mrn}` : 'No MRN on file'}
          </p>
        </div>
        <Btn variant="ghost" onClick={handleSignOut} data-testid="patient-sign-out">
          Sign out
        </Btn>
      </header>

      {/* Rebook widget */}
      <Card className="mb-6">
        <SectionHead eyebrow="Follow-up" title="One-click rebook" desc="Request a follow-up appointment -- our front desk will confirm a time." />
        <Btn
          variant="glow"
          data-testid="rebook-followup"
          onClick={handleRebook}
          disabled={rebooking}
        >
          {rebooking ? (rebookDone ? 'Requested' : 'Requesting…') : 'Request follow-up appointment'}
        </Btn>
        {rebookDone && (
          <div className="mt-3 text-sm text-ok bg-ok-soft rounded-lg px-3 py-2">
            Follow-up requested — our front desk will confirm your appointment time shortly.
          </div>
        )}
        {rebookError && (
          <div className="mt-3 text-sm text-danger bg-danger-soft rounded-lg px-3 py-2">
            {rebookError}
          </div>
        )}
      </Card>

      {/* Journey stepper */}
      {!!patient.journey_stage_history?.length && (
        <Card className="mb-6">
          <SectionHead eyebrow="Care Journey" title="Journey progress" />
          <div className="flex flex-wrap gap-3">
            {JOURNEY_STAGES.map((stage, i) => {
              const reached = currentStageIndex >= 0 && i <= currentStageIndex;
              const isCurrent = i === currentStageIndex;
              const tone = isCurrent ? 'accent' : reached ? 'ok' : 'default';
              return (
                <Pill key={stage} tone={tone}>
                  {STAGE_LABEL[stage]}
                </Pill>
              );
            })}
          </div>
        </Card>
      )}

      {/* Visit timeline accordion */}
      <Card>
        <SectionHead eyebrow="Longitudinal History" title="Your visits" desc="Newest first. Click a visit to see full clinical details." />

        {loadingHistory && <p className="text-ink-faint text-sm">Loading your history…</p>}
        {historyError && (
          <div className="text-sm text-danger bg-danger-soft rounded-lg px-3 py-2">{historyError}</div>
        )}
        {!loadingHistory && !historyError && timeline.length === 0 && (
          <p className="text-ink-faint text-sm">No visits on record yet.</p>
        )}

        <div className="flex flex-col gap-2 mt-2">
          {timeline.map((item) => {
            const isOpen = expandedId === item.id;
            if (item.kind === 'journey') {
              return (
                <div key={item.id} className="border border-line rounded-lg px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm text-ink">
                      Care stage: <span className="font-semibold">{STAGE_LABEL[item.entry.stage]}</span>
                    </div>
                    <span className="text-[11px] text-ink-faint font-mono whitespace-nowrap">
                      {formatDateTime(item.entry.enteredAt)}
                    </span>
                  </div>
                  {item.entry.note && <p className="text-ink-soft text-sm mt-1">{item.entry.note}</p>}
                </div>
              );
            }

            const enc = item.encounter;
            const note = enc.clinical_note;
            const summary = toBullets(note?.soapSummary.assessment).join('; ') || note?.soapSummary.plan || 'No summary recorded';

            return (
              <div key={item.id} className="border border-line rounded-lg overflow-hidden">
                <button
                  type="button"
                  data-testid="visit-accordion-header"
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-white/5"
                  onClick={() => setExpandedId(isOpen ? null : item.id)}
                >
                  <div className="min-w-0">
                    <div className="text-sm text-ink font-semibold">
                      {formatDateTime(enc.started_at)} {enc.specialty ? `· ${enc.specialty}` : ''}
                    </div>
                    <div className="text-ink-faint text-xs truncate max-w-[48ch]">{summary}</div>
                  </div>
                  <span className="text-ink-faint text-xs font-mono shrink-0">{isOpen ? '▲' : '▼'}</span>
                </button>

                {isOpen && (
                  <div className="px-3 pb-3.5 pt-1 border-t border-line bg-surface-2">
                    {note ? (
                      <div className="flex flex-col gap-3 mt-2 text-sm">
                        <div>
                          <div className="font-mono text-[9.5px] tracking-wider uppercase text-ink-faint mb-1">History</div>
                          <p className="text-ink-soft">{note.soapSummary.history || '—'}</p>
                        </div>
                        <div>
                          <div className="font-mono text-[9.5px] tracking-wider uppercase text-ink-faint mb-1">Examination</div>
                          <BulletList items={toBullets(note.soapSummary.examination)} />
                        </div>
                        <div>
                          <div className="font-mono text-[9.5px] tracking-wider uppercase text-ink-faint mb-1">Assessment</div>
                          <BulletList items={toBullets(note.soapSummary.assessment)} />
                        </div>
                        <div>
                          <div className="font-mono text-[9.5px] tracking-wider uppercase text-ink-faint mb-1">Plan</div>
                          <p className="text-ink-soft">{note.soapSummary.plan || '—'}</p>
                        </div>

                        {!!note.rehabExercises.length && (
                          <div>
                            <div className="font-mono text-[9.5px] tracking-wider uppercase text-ink-faint mb-1">Rehab exercises</div>
                            <ul className="list-disc list-inside text-ink-soft">
                              {note.rehabExercises.map((ex, i) => (
                                <li key={i}>
                                  {ex.exerciseName} -- {ex.sets}×{ex.reps}, {ex.frequencyPerWeek}
                                  {ex.progressionNotes ? ` (${ex.progressionNotes})` : ''}
                                </li>
                              ))}
                            </ul>
                            {/* Read-only mirror of the physio's editable weekly
                                Progression Matrix (Clinical_User_Stories row
                                3.1.B) -- the same array the doctor writes,
                                shown here exactly as recorded. */}
                            {!!note.rehabExercises[0]?.weeklyProgress?.length && (
                              <div className="mt-2" data-testid="portal-progression-matrix">
                                <div className="font-mono text-[9.5px] tracking-wider uppercase text-ink-faint mb-1">Weekly progress -- {note.rehabExercises[0].exerciseName || 'primary exercise'}</div>
                                <div className="flex flex-col gap-1">
                                  {note.rehabExercises[0].weeklyProgress!.map((w, i) => (
                                    <div key={i} className="text-ink-soft text-xs bg-surface rounded-lg px-2.5 py-1.5" data-testid="portal-progression-week">
                                      Week {w.week}: pain {w.painScore ?? '—'}/10, {w.repsCompleted ?? '—'} reps completed{w.note ? ` — ${w.note}` : ''}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {!!note.precautions.length && (
                          <div>
                            <div className="font-mono text-[9.5px] tracking-wider uppercase text-gate mb-1">Precautions</div>
                            <ul className="list-disc list-inside text-ink-soft">
                              {note.precautions.map((p, i) => <li key={i}>{p}</li>)}
                            </ul>
                          </div>
                        )}

                        {!!note.dosAndDonts.length && (
                          <div>
                            <div className="font-mono text-[9.5px] tracking-wider uppercase text-ink-faint mb-1">Do's and don'ts</div>
                            <ul className="list-disc list-inside text-ink-soft">
                              {note.dosAndDonts.map((d, i) => <li key={i}>{d}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-ink-faint text-sm mt-2">No clinical note recorded for this visit.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
