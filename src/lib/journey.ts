import type { JourneyStage } from '../types/db';

/**
 * Shared display logic for the Admitted -> Operation -> Physiotherapy ->
 * Progress Review -> Discharged care-pathway tracker (`journey_stage` /
 * `journey_stage_history` on PatientRow). Originally lived only inside
 * InpatientWardView.tsx, which still owns the one WRITE action
 * (`nextStage`, used to advance/discharge -- Ward staff only). DoctorView
 * needed a READ-ONLY mirror of the same stage labels/pill coloring for its
 * Patient Journey briefing card (doctor feedback, Dr. Jayani round 2,
 * 2026-09-03: "Detailed history of the patient was shown and maintained
 * which I cant see" -- doctors could never see the journey the ward
 * tracks), so the pure-display pieces are factored out here as the one
 * shared source of truth rather than duplicated.
 */
export const STAGE_ORDER: JourneyStage[] = ['admitted', 'operation', 'physiotherapy', 'progress_review', 'discharged'];

export const STAGE_LABEL: Record<JourneyStage, string> = {
  admitted: 'Admitted',
  operation: 'Operation',
  physiotherapy: 'Physiotherapy',
  progress_review: 'Progress Review',
  discharged: 'Discharged',
};

export function stagePillTone(stage: JourneyStage | null): 'ok' | 'gate' | 'danger' {
  if (!stage) return 'gate';
  if (stage === 'physiotherapy' || stage === 'progress_review' || stage === 'discharged') return 'ok';
  return 'gate';
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
