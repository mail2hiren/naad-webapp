import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, at, billStatusFor, billTotals, clashes, freeSlots, nextBillNumber, nextToken, slotsFor, balance,
} from '../../src/lib/schedule.ts';

const doctor = { id: 'pr-a', org_id: 'o', auth_user_id: null, name: 'Dr A', role: 'surgeon', title: null, specialty: 'Orthopedics', consult_fee: 800, preferred_language: 'en', active: true } as const;
const physio = { ...doctor, id: 'pr-p', role: 'physio', specialty: 'Physiotherapy' } as const;
const SAT = '2026-08-29';
const SUN = '2026-08-30';

function appt(id: string, practitionerId: string, start: Date, status = 'scheduled', minutes = 15, token: number | null = null) {
  return {
    id, org_id: 'o', patient_id: 'p', specialty: null, date: start.toISOString(), reason: null, practitioner_id: practitionerId,
    status, start_time: start.toISOString(), duration_minutes: minutes, requested_by_patient: false, token_no: token,
  } as never;
}

test('default hours give two sessions Mon-Sat and nothing on Sunday', () => {
  const slots = slotsFor(doctor as never, SAT);
  // 09:30-13:30 = 16 slots of 15 min, 16:00-19:00 = 12 slots.
  assert.equal(slots.length, 28);
  assert.deepEqual([slots[0].start.getHours(), slots[0].start.getMinutes()], [9, 30]);
  assert.equal(slots.filter((s) => s.session === 1).length, 12);
  assert.equal(slotsFor(doctor as never, SUN).length, 0);
});

test('physiotherapists get 30-minute slots, and own working hours win', () => {
  assert.equal(slotsFor(physio as never, SAT).length, 8 + 6);
  const custom = { ...doctor, working_hours: { sat: [['10:00', '11:00']] }, slot_minutes: 20 };
  assert.equal(slotsFor(custom as never, SAT).length, 3);
});

test('a booked slot clashes; cancelled and no-show free it', () => {
  const t = at(SAT, '10:00');
  const booked = [appt('a1', 'pr-a', t), appt('a2', 'pr-a', at(SAT, '10:15'), 'cancelled'), appt('a3', 'pr-a', at(SAT, '10:30'), 'no_show')];
  assert.equal(clashes(booked, 'pr-a', t, 15).length, 1);
  assert.equal(clashes(booked, 'pr-a', at(SAT, '10:15'), 15).length, 0);
  assert.equal(clashes(booked, 'pr-a', at(SAT, '10:30'), 15).length, 0);
  assert.equal(clashes(booked, 'pr-b', t, 15).length, 0, 'another doctor is not a clash');
  assert.equal(clashes(booked, 'pr-a', t, 15, 'a1').length, 0, 'rescheduling ignores itself');
  // A 30-minute physio slot overlapping a 15-minute booking that starts inside it.
  assert.equal(clashes([appt('x', 'pr-p', at(SAT, '10:15'))], 'pr-p', t, 30).length, 1);
});

test('free slots skip the past and the booked', () => {
  const now = at(SAT, '11:05');
  const free = freeSlots(doctor as never, SAT, [appt('a1', 'pr-a', at(SAT, '11:15'))], now);
  assert.equal(free[0].start.getHours() * 60 + free[0].start.getMinutes(), 11 * 60 + 30);
});

test('tokens restart each day and count per doctor', () => {
  const appts = [appt('a', 'pr-a', at(SAT, '09:30'), 'checked_in', 15, 1), appt('b', 'pr-a', at(SAT, '09:45'), 'checked_in', 15, 2),
    appt('c', 'pr-b', at(SAT, '09:45'), 'checked_in', 15, 7), appt('d', 'pr-a', at(addDays(SAT, -1), '09:45'), 'completed', 15, 9)];
  assert.equal(nextToken(appts, 'pr-a', SAT), 3);
  assert.equal(nextToken(appts, 'pr-b', SAT), 8);
  assert.equal(nextToken(appts, 'pr-a', addDays(SAT, 1)), 1);
});

test('receipt numbers run on from the highest', () => {
  assert.equal(nextBillNumber([]), 'R-01001');
  assert.equal(nextBillNumber([{ number: 'R-01001' }, { number: 'R-01007' }, { number: 'junk' }]), 'R-01008');
});

test('bill totals, discount cap and payment status', () => {
  const t = billTotals([{ description: 'Consult', qty: 1, rate: 800 }, { description: 'X-ray', qty: 2, rate: 450.5 }], 101);
  assert.deepEqual(t, { subtotal: 1701, discount: 101, total: 1600 });
  assert.equal(billTotals([{ description: 'x', qty: 1, rate: 100 }], 500).total, 0, 'discount never makes a bill negative');
  assert.equal(billStatusFor(1600, 0), 'unpaid');
  assert.equal(billStatusFor(1600, 600), 'part_paid');
  assert.equal(billStatusFor(1600, 1600), 'paid');
  assert.equal(balance({ total: 1600, paid: 600, status: 'part_paid' }), 1000);
  assert.equal(balance({ total: 1600, paid: 0, status: 'void' }), 0);
});
