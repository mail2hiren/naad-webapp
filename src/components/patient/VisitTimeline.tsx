import { useState } from 'react';
import { BulletList } from '../ui';
import { toBullets } from '../../lib/clinicalNote';
import type { EncounterRow, JourneyHistoryEntry } from '../../types/db';
import { STAGE_LABEL, fmtDateTime as formatDateTime } from '../../lib/journey';

export type TimelineItem =
  | { kind: 'encounter'; id: string; at: string; encounter: EncounterRow }
  | { kind: 'journey'; id: string; at: string; entry: JourneyHistoryEntry };

/** Visits and care-stage changes, newest first; a visit opens to its note. */
export function VisitTimeline({ timeline }: { timeline: TimelineItem[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
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
                    <span className="text-[13px] text-ink-faint font-mono whitespace-nowrap">
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
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-hover"
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
                          <div className="text-[13px] font-semibold text-ink-soft mb-1">History</div>
                          <p className="text-ink-soft">{note.soapSummary.history || '—'}</p>
                        </div>
                        <div>
                          <div className="text-[13px] font-semibold text-ink-soft mb-1">Examination</div>
                          <BulletList items={toBullets(note.soapSummary.examination)} />
                        </div>
                        <div>
                          <div className="text-[13px] font-semibold text-ink-soft mb-1">Assessment</div>
                          <BulletList items={toBullets(note.soapSummary.assessment)} />
                        </div>
                        <div>
                          <div className="text-[13px] font-semibold text-ink-soft mb-1">Plan</div>
                          <p className="text-ink-soft">{note.soapSummary.plan || '—'}</p>
                        </div>

                        {!!note.rehabExercises.length && (
                          <div>
                            <div className="text-[13px] font-semibold text-ink-soft mb-1">Rehab exercises</div>
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
                                <div className="text-[13px] font-semibold text-ink-soft mb-1">Weekly progress -- {note.rehabExercises[0].exerciseName || 'primary exercise'}</div>
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
                            <div className="text-[13px] font-semibold text-gate mb-1">Precautions</div>
                            <ul className="list-disc list-inside text-ink-soft">
                              {note.precautions.map((p, i) => <li key={i}>{p}</li>)}
                            </ul>
                          </div>
                        )}

                        {!!note.dosAndDonts.length && (
                          <div>
                            <div className="text-[13px] font-semibold text-ink-soft mb-1">Do's and don'ts</div>
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
  );
}
