import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at } from '../../src/lib/schedule.ts';
import { cashForDay, claimNextStep, daysAdmitted, expectedCash, groupFollowUps, lapsedPatients, packageState } from '../../src/lib/desk.ts';

const SAT = '2026-08-29';
const fu = (id: string, due: string, status = 'open') => ({ id, org_id: 'o', patient_id: `p-${id}`, practitioner_id: null, due_on: due, reason: null, status, appointment_id: null, created_by: null, created_at: '' }) as never;
const appt = (id: string, pid: string, day: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, org_id: 'o', patient_id: pid, practitioner_id: 'd', specialty: null, date: at(day, '10:00').toISOString(), start_time: at(day, '10:00').toISOString(),
  reason: null, status, duration_minutes: 15, requested_by_patient: false, ...extra,
}) as never;

test('follow-ups group into overdue, today, this week and later; closed ones drop out', () => {
  const g = groupFollowUps([fu('a', '2026-08-20'), fu('b', SAT), fu('c', '2026-09-02'), fu('d', '2026-10-01'), fu('e', '2026-08-01', 'booked')], SAT);
  assert.deepEqual([g.overdue.length, g.today.length, g.week.length, g.later.length], [1, 1, 1, 1]);
});

test('lapsed patients: last visit long ago, nothing booked, no follow-up open', () => {
  const now = at(SAT, '11:00');
  const appts = [
    appt('1', 'gone', '2026-05-01', 'completed'),
    appt('2', 'booked', '2026-05-01', 'completed'), appt('3', 'booked', '2026-09-10', 'scheduled'),
    appt('4', 'recent', '2026-08-20', 'completed'),
    appt('5', 'followed', '2026-05-01', 'completed'),
  ];
  const l = lapsedPatients(appts, [fu('x', '2026-09-01')].map((f) => ({ ...(f as object), patient_id: 'followed' }) as never), now);
  assert.deepEqual(l.map((x) => x.patientId), ['gone']);
  assert.equal(l[0].days, 120);
});

test('day cash by method, refunds taken off, one person\'s bills only when asked', () => {
  const bill = (id: string, paid: number, method: string, by: string, extra: Record<string, unknown> = {}) => ({
    id, org_id: 'o', number: id, patient_id: 'p', appointment_id: null, encounter_id: null, items: [], subtotal: paid, discount: 0, total: paid, paid,
    payment_method: method, status: 'paid', void_reason: null, created_by: by, created_at: at(SAT, '09:00').toISOString(), paid_at: at(SAT, '10:00').toISOString(), ...extra,
  }) as never;
  const bills = [
    bill('a', 800, 'cash', 'Sunita'), bill('b', 1200, 'upi', 'Sunita'), bill('c', 500, 'cash', 'Ravi'),
    bill('d', 300, 'cash', 'Sunita', { status: 'void' }),
    bill('e', 1000, 'cash', 'Sunita', { refunded: 200, refunded_at: at(SAT, '12:00').toISOString(), refund_method: 'cash' }),
    bill('f', 900, 'card', 'Sunita', { paid_at: at('2026-08-28', '10:00').toISOString() }),
  ];
  const all = cashForDay(bills, SAT);
  assert.deepEqual(all.byMethod, { cash: 2300, upi: 1200, card: 0, insurance: 0 });
  assert.equal(all.refunds.cash, 200);
  assert.equal(expectedCash(all), 2100);
  const mine = cashForDay(bills, SAT, 'Sunita');
  assert.equal(mine.byMethod.cash, 1800);
  assert.equal(expectedCash(mine, 500), 2100);
});

test('package sessions: used, booked, left, expiry', () => {
  const pkg = { id: 'pp', sessions_total: 3, status: 'active', expires_on: '2026-09-30' } as never;
  const appts = [appt('1', 'p', '2026-08-20', 'completed', { patient_package_id: 'pp' }), appt('2', 'p', '2026-08-25', 'completed', { patient_package_id: 'pp' }),
    appt('3', 'p', '2026-09-01', 'scheduled', { patient_package_id: 'pp' }), appt('4', 'p', '2026-08-26', 'completed')];
  assert.deepEqual(packageState(pkg, appts, SAT), { used: 2, booked: 1, left: 1, usable: true, why: null });
  assert.equal(packageState({ ...(pkg as object), expires_on: '2026-08-01' } as never, appts, SAT).why, 'Expired');
  assert.equal(packageState({ ...(pkg as object), sessions_total: 2 } as never, appts, SAT).why, 'All sessions used');
});

test('days admitted count a started day; claims say what to do next', () => {
  assert.equal(daysAdmitted({ admitted_at: at('2026-08-27', '18:00').toISOString(), discharged_at: null }, at(SAT, '09:00')), 3);
  assert.equal(daysAdmitted({ admitted_at: at('2026-08-27', '18:00').toISOString(), discharged_at: at(SAT, '11:00').toISOString() }, at(SAT, '12:00')), 2);
  assert.equal(claimNextStep({ status: 'draft', documents_pending: ['ID proof'], kind: 'preauth' }), 'Collect ID proof, then submit');
  assert.equal(claimNextStep({ status: 'approved', documents_pending: [], kind: 'preauth' }), 'Raise the final claim at discharge');
});
