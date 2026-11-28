import type { AppointmentStatus, BlockKind, VisitType } from '../../types/db';
import { VISIT_LABEL } from '../../lib/schedule';

/** Background fill of an appointment by its step in the patient flow (theme tokens). */
export const FLOW_BG: Record<AppointmentStatus, string> = {
  requested: 'var(--flow-requested)', scheduled: 'var(--flow-booked)', checked_in: 'var(--flow-waiting)',
  in_consultation: 'var(--flow-with)', completed: 'var(--flow-done)', cancelled: 'var(--flow-gone)', no_show: 'var(--flow-gone)',
};

/** The order a patient moves through, for the legend and filters. */
export const FLOW_ORDER: AppointmentStatus[] = ['requested', 'scheduled', 'checked_in', 'in_consultation', 'completed', 'no_show', 'cancelled'];

export const BLOCK_LABEL: Record<BlockKind, string> = {
  leave: 'Leave', surgery: 'Surgery / OT', meeting: 'Meeting', holiday: 'Hospital holiday', other: 'Not available',
};

export type CalView = 'day' | 'week' | 'month';

/** Pixels per minute on the time grid: a 15-minute visit is 36 px tall. */
export const PX_PER_MIN = 2.4;

export function shortTime(d: Date): string {
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).replace(' am', 'a').replace(' pm', 'p');
}

export function hourLabel(min: number): string {
  const h = Math.floor(min / 60);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${suffix}`;
}

/** Remembered per device: which doctors are ticked, which view. Never needed for correctness. */
export function remember<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`naad.cal.${key}`);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch { return fallback; }
}
export function store(key: string, value: unknown): void {
  try { localStorage.setItem(`naad.cal.${key}`, JSON.stringify(value)); } catch { /* private mode */ }
}

export const ALL_VISITS = Object.keys(VISIT_LABEL) as VisitType[];
