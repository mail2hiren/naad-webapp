import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doseQty, expiryState, onHand, pickFefo } from '../../src/lib/pharmacy.ts';
import { vitalFlags } from '../../src/lib/ward.ts';

const b = (id: string, expiry: string, qty: number, extra = {}) => ({
  id, org_id: 'o', inventory_id: 1, batch_no: id, expiry, qty, mrp: 5, supplier: null, received_at: '2026-01-01T00:00:00Z',
  received_by: null, written_off_at: null, write_off_reason: null, ...extra,
});
const TODAY = '2026-08-29';

test('dispensing quantity follows dose and duration', () => {
  assert.equal(doseQty({ name: 'Aspirin 75mg', frequency: 'Once daily', duration: '30 days' }), 30);
  assert.equal(doseQty({ name: 'Tramadol 50mg', frequency: 'Twice daily', duration: '5 days' }), 10);
  assert.equal(doseQty({ name: 'Amoxicillin 500mg', frequency: 'Three times a day', duration: '1 week' }), 21);
  assert.equal(doseQty({ name: 'Diclofenac Gel 1%', frequency: 'Twice daily', duration: '10 days' }), 1);
  assert.equal(doseQty({ name: 'Paracetamol 650mg', frequency: 'As needed for pain', duration: '5 days' }), 1);
});

test('expiry: expired, soon (90 days) and fine', () => {
  assert.equal(expiryState('2026-08-28', TODAY), 'expired');
  assert.equal(expiryState('2026-11-27', TODAY), 'soon');
  assert.equal(expiryState('2027-03-01', TODAY), 'ok');
});

test('earliest expiry is dispensed first; expired and written-off stock is never used', () => {
  const batches = [b('late', '2027-06-01', 50), b('early', '2026-10-01', 8), b('gone', '2026-08-01', 99), b('off', '2026-09-15', 40, { written_off_at: '2026-08-20T00:00:00Z' })];
  assert.equal(onHand(batches, 1, TODAY), 58);
  const p = pickFefo(batches, 1, 20, TODAY);
  assert.deepEqual(p.allocations.map((a) => [a.batch.id, a.take]), [['early', 8], ['late', 12]]);
  assert.equal(p.short, 0);
  assert.equal(pickFefo(batches, 1, 70, TODAY).short, 12);
});

test('vital signs that need attention are flagged', () => {
  assert.deepEqual(vitalFlags({ bp_systolic: 128, bp_diastolic: 80, pulse: 78, temp_c: 36.8, spo2: 98, resp_rate: 16, pain: 3 }), []);
  assert.deepEqual(vitalFlags({ bp_systolic: 168, bp_diastolic: 96, pulse: 118, temp_c: 38.4, spo2: 91, resp_rate: 26, pain: 8 }).map((f) => f.label),
    ['High BP', 'Fast pulse', 'Fever', 'Low oxygen', 'Fast breathing', 'Severe pain']);
});
