import type { VitalsRow } from '../types/db';

/**
 * Ward rules: which vital signs need attention. Simple adult thresholds for
 * a prompt, not a score; the doctor decides. Unit tested in tests/lib/ward.test.ts.
 */
export interface VitalFlag { field: keyof VitalsRow; label: string }

export function vitalFlags(v: Pick<VitalsRow, 'bp_systolic' | 'bp_diastolic' | 'pulse' | 'temp_c' | 'spo2' | 'resp_rate' | 'pain'>): VitalFlag[] {
  const out: VitalFlag[] = [];
  if (v.bp_systolic != null && (v.bp_systolic >= 160 || v.bp_systolic < 90)) out.push({ field: 'bp_systolic', label: v.bp_systolic < 90 ? 'Low BP' : 'High BP' });
  else if (v.bp_diastolic != null && v.bp_diastolic >= 100) out.push({ field: 'bp_diastolic', label: 'High BP' });
  if (v.pulse != null && (v.pulse > 110 || v.pulse < 50)) out.push({ field: 'pulse', label: v.pulse < 50 ? 'Slow pulse' : 'Fast pulse' });
  if (v.temp_c != null && (v.temp_c >= 38 || v.temp_c < 35.5)) out.push({ field: 'temp_c', label: v.temp_c < 35.5 ? 'Low temperature' : 'Fever' });
  if (v.spo2 != null && v.spo2 < 94) out.push({ field: 'spo2', label: 'Low oxygen' });
  if (v.resp_rate != null && (v.resp_rate > 24 || v.resp_rate < 10)) out.push({ field: 'resp_rate', label: v.resp_rate < 10 ? 'Slow breathing' : 'Fast breathing' });
  if (v.pain != null && v.pain >= 7) out.push({ field: 'pain', label: 'Severe pain' });
  return out;
}

/** The ledger line for one bed-day, so a day is never charged twice. */
export function bedDayDescription(ward: string, label: string, day: string): string {
  return `Bed ${label} (${ward}), ${day}`;
}
