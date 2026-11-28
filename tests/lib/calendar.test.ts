import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, dayKey } from '../../src/lib/schedule.ts';
import {
  addMonths, blockAt, blocksOn, expandRepeat, gridRange, layoutLanes, monthMatrix, nextFree, noShowRisk, outsideHours,
  queueOf, runningLate, searchAppointments, visitMinutes, waitMinutes, waitlistFor, weekDays,
} from '../../src/lib/calendar.ts';

const doctor = { id: 'pr-a', org_id: 'o', auth_user_id: null, name: 'Dr A', role: 'surgeon', title: null, specialty: 'Orthopedics', consult_fee: 800, preferred_language: 'en', active: true } as never;
const physio = { id: 'pr-p', org_id: 'o', name: 'Dr P', role: 'physio', active: true } as never;
const SAT = '2026-08-29';

function appt(id: string, start: Date, extra: Record<string, unknown> = {}) {
  return {
    id, org_id: 'o', patient_id: 'p1', specialty: null, date: start.toISOString(), reason: null, practitioner_id: 'pr-a',
    status: 'scheduled', start_time: start.toISOString(), duration_minutes: 15, requested_by_patient: false, ...extra,
  } as never;
}
const block = (from: Date, to: Date, practitioner: string | null = 'pr-a') =>
  ({ id: 'b', org_id: 'o', practitioner_id: practitioner, starts_at: from.toISOString(), ends_at: to.toISOString(), kind: 'meeting', reason: 'CME', created_by: null }) as never;

test('visit types set the length; therapy follows the physio slot', () => {
  assert.equal(visitMinutes(doctor, 'consultation'), 15);
  assert.equal(visitMinutes(doctor, 'follow_up'), 10);
  assert.equal(visitMinutes(physio, 'therapy'), 30);
});

test('blocked time: own and hospital-wide blocks stop a booking; blocks clip to the day', () => {
  const b = [block(at(SAT, '12:00'), at(SAT, '13:00'))];
  assert.ok(blockAt(b, 'pr-a', at(SAT, '12:45'), 15));
  assert.equal(blockAt(b, 'pr-a', at(SAT, '13:00'), 15), undefined);
  assert.equal(blockAt(b, 'pr-x', at(SAT, '12:15'), 15), undefined);
  const holiday = [block(at(SAT, '00:00'), at('2026-08-31', '00:00'), null)];
  assert.ok(blockAt(holiday, 'pr-x', at('2026-08-30', '10:00'), 15));
  const clip = blocksOn(holiday, 'pr-a', '2026-08-30');
  assert.equal(dayKey(clip[0].from), '2026-08-30');
  assert.equal(clip[0].to.getTime(), at('2026-08-31', '00:00').getTime());
});

test('outside working hours: in the break, before opening, or running past closing', () => {
  assert.equal(outsideHours(doctor, at(SAT, '10:00'), 15), false);
  assert.equal(outsideHours(doctor, at(SAT, '14:00'), 15), true);
  assert.equal(outsideHours(doctor, at(SAT, '13:20'), 15), true);
  assert.equal(outsideHours(doctor, at('2026-08-30', '10:00'), 15), true);
});

test('grid range covers working hours and any booking outside them', () => {
  assert.deepEqual(gridRange([doctor], [SAT], []), { from: 540, to: 1140 });
  assert.deepEqual(gridRange([doctor], [SAT], [appt('x', at(SAT, '19:30'), { duration_minutes: 30 })]), { from: 540, to: 1200 });
});

test('overlapping appointments share the width side by side', () => {
  const placed = layoutLanes([
    appt('a', at(SAT, '10:00'), { duration_minutes: 30 }),
    appt('b', at(SAT, '10:15')),
    appt('c', at(SAT, '10:30')),
    appt('d', at(SAT, '11:00')),
  ]);
  const by = Object.fromEntries(placed.map((p) => [(p.appt as { id: string }).id, p]));
  assert.equal(by.a.lanes, 2);
  assert.equal(by.b.lane, 1);
  assert.equal(by.c.lane, 0);
  assert.equal(by.d.lanes, 1);
});

test('week runs Monday to Sunday; month has six full weeks', () => {
  assert.deepEqual(weekDays(SAT), ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']);
  const m = monthMatrix(SAT);
  assert.equal(m.length, 6);
  assert.equal(m[0][0], '2026-07-27');
  assert.ok(m.flat().includes('2026-08-31'));
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
});

test('waiting and running late are measured from the clock', () => {
  const now = at(SAT, '11:05');
  const waiting = appt('w', at(SAT, '10:30'), { status: 'checked_in', checked_in_at: at(SAT, '10:20').toISOString() });
  assert.equal(waitMinutes(waiting, now), 45);
  assert.equal(runningLate([waiting], now), 35);
  const withDoc = appt('c', at(SAT, '10:45'), { status: 'in_consultation', called_in_at: at(SAT, '10:50').toISOString() });
  assert.equal(runningLate([withDoc, waiting], now), 5);
  assert.equal(runningLate([appt('s', at(SAT, '11:30'))], now), 0);
  // After hours it means nothing: 22:00 is outside every session.
  assert.equal(runningLate([waiting], at(SAT, '22:00'), doctor), 0);
  assert.equal(runningLate([waiting], now, doctor), 35);
});

test('queue order is by arrival; estimates use the doctor\'s pace', () => {
  const now = at(SAT, '11:05');
  const q = queueOf(doctor, [
    appt('late', at(SAT, '10:00'), { status: 'checked_in', checked_in_at: at(SAT, '10:40').toISOString() }),
    appt('early', at(SAT, '10:30'), { status: 'checked_in', checked_in_at: at(SAT, '10:10').toISOString() }),
    appt('done', at(SAT, '09:30'), { status: 'completed', called_in_at: at(SAT, '09:30').toISOString(), completed_at: at(SAT, '09:40').toISOString() }),
  ], now);
  assert.deepEqual(q.map((x) => (x.appt as { id: string }).id), ['early', 'late']);
  assert.deepEqual(q.map((x) => x.estWait), [0, 10]);
});

test('a repeat course: every 2 days, Sundays moved to Monday, no duplicates', () => {
  const days = expandRepeat(at(SAT, '10:00'), { everyDays: 1, count: 3, skipSundays: true }).map(dayKey);
  assert.deepEqual(days, ['2026-08-29', '2026-08-31', '2026-09-01']);
  const two = expandRepeat(at(SAT, '10:00'), { everyDays: 2, count: 4, skipSundays: false }).map(dayKey);
  assert.deepEqual(two, ['2026-08-29', '2026-08-31', '2026-09-02', '2026-09-04']);
});

test('no-show risk comes from the patient\'s own history', () => {
  const now = at(SAT, '11:05');
  const h = [appt('1', at('2026-08-01', '10:00'), { status: 'no_show' }), appt('2', at('2026-08-10', '10:00'), { status: 'completed' })];
  assert.equal(noShowRisk(h, 'p1', now).risk, 'some');
  assert.equal(noShowRisk([...h, appt('3', at('2026-08-20', '10:00'), { status: 'no_show' })], 'p1', now).risk, 'high');
  assert.equal(noShowRisk(h, 'p2', now).risk, 'none');
});

test('next free times skip booked and blocked slots', () => {
  const now = at(SAT, '11:05');
  const free = nextFree([doctor], [appt('x', at(SAT, '11:15'))], [block(at(SAT, '11:30'), at(SAT, '12:00'))], now, { perDoctor: 2 });
  assert.deepEqual(free.map((f) => f.start.getTime()), [at(SAT, '12:00').getTime(), at(SAT, '12:15').getTime()]);
});

test('waitlist matches doctor, days and part of day', () => {
  const w = (id: string, extra: Record<string, unknown>) => ({ id, org_id: 'o', patient_id: 'p', practitioner_id: null, from_day: SAT, to_day: '2026-09-05', part_of_day: 'any', visit_type: 'consultation', note: null, status: 'waiting', appointment_id: null, created_by: null, ...extra }) as never;
  const list = [w('any', {}), w('eve', { part_of_day: 'evening' }), w('other', { practitioner_id: 'pr-z' }), w('gone', { status: 'booked' }), w('later', { from_day: '2026-09-01' })];
  assert.deepEqual(waitlistFor(list, 'pr-a', at(SAT, '10:00')).map((x) => (x as { id: string }).id), ['any']);
  assert.deepEqual(waitlistFor(list, 'pr-a', at(SAT, '17:00')).map((x) => (x as { id: string }).id).sort(), ['any', 'eve']);
});

test('appointment search by name, mobile or hospital number', () => {
  const pts = [{ id: 'p1', name: 'Kavita Deshmukh', mrn: 'DGY-1009', phone: '98220 11223' }] as never[];
  const a = [appt('a', at(SAT, '10:00'))];
  assert.equal(searchAppointments(a, pts, 'kavi').length, 1);
  assert.equal(searchAppointments(a, pts, '11223').length, 1);
  assert.equal(searchAppointments(a, pts, 'dgy-1009').length, 1);
  assert.equal(searchAppointments(a, pts, 'x').length, 0);
});
