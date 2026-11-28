import { supabase } from './supabaseClient';
import { addDays, clashes, slotsFor, type Slot } from './schedule';
import type { AppointmentRow, PractitionerRow } from '../types/db';

/**
 * A patient cannot read other patients' appointments, so free times come
 * from the doctor_busy_times() database function, which returns only when
 * the doctor is busy (no names). Free = a working-hours slot that is in the
 * future and does not overlap a busy time.
 */
export async function patientFreeSlots(doctor: PractitionerRow, day: string, now: Date): Promise<{ slots: Slot[]; error: string | null }> {
  const { data, error } = await supabase.rpc('doctor_busy_times', { p_practitioner: doctor.id, p_day: day });
  if (error) return { slots: [], error: error.message };
  const busy = ((data as { start_time: string; duration_minutes: number }[]) ?? []).map((b, i) => ({
    id: `busy-${i}`, practitioner_id: doctor.id, status: 'scheduled', start_time: b.start_time, date: b.start_time, duration_minutes: b.duration_minutes,
  })) as unknown as AppointmentRow[];
  const slots = slotsFor(doctor, day).filter((s) => s.start.getTime() > now.getTime() && clashes(busy, doctor.id, s.start, s.minutes).length === 0);
  return { slots, error: null };
}

/** The first free slot on the next working days (up to two weeks ahead). */
export async function firstFreeSlot(doctor: PractitionerRow, fromDay: string, now: Date): Promise<Slot | null> {
  for (let i = 1; i <= 14; i += 1) {
    const { slots } = await patientFreeSlots(doctor, addDays(fromDay, i), now);
    if (slots.length) return slots[0];
  }
  return null;
}
