import type { InventoryRow, StockBatchRow, VitalsRow } from '../types/db';
import { ORG_ID } from './seed';

/**
 * Demo pharmacy stock and ward vitals (Phase 5, part 2), written as if today
 * were 2026-08-29 (mockSupabase shifts the dates). Every prescribed demo
 * medicine is stocked; some batches expire soon, one has expired, and a few
 * items are at or below their reorder level. inventory.stock is the total of
 * batches not written off.
 */

const item = (id: number, drug: string, unit: string, low: number, stock: number, alternates: string[] = []): InventoryRow =>
  ({ id, org_id: ORG_ID, drug, stock, unit, low, alternates });

export const inventory: InventoryRow[] = [
  item(5, 'Etoricoxib 90mg', 'tablets', 20, 140, ['Celecoxib 200mg']),
  item(6, 'Aspirin 75mg', 'tablets', 30, 300),
  item(7, 'Tramadol 50mg', 'tablets', 20, 60),
  item(8, 'Diclofenac Gel 1%', 'tubes', 5, 12),
  item(9, 'Paracetamol 650mg', 'tablets', 50, 440),
  item(10, 'Pantoprazole 40mg', 'tablets', 30, 25, ['Rabeprazole 20mg']),
  item(11, 'Atorvastatin 20mg', 'tablets', 30, 90),
  item(12, 'Rabeprazole 20mg', 'tablets', 20, 50),
];

let n = 0;
const batch = (inventoryId: number, batchNo: string, expiry: string, qty: number, mrp: number, supplier = 'Pune Pharma Distributors'): StockBatchRow => {
  n += 1;
  return {
    id: `sb-${n}`, org_id: ORG_ID, inventory_id: inventoryId, batch_no: batchNo, expiry, qty, mrp, supplier,
    received_at: `2026-0${(n % 7) + 1}-1${n % 9}T05:00:00Z`, received_by: 'Vikram Shah', written_off_at: null, write_off_reason: null,
  };
};

export const batches: StockBatchRow[] = [
  batch(1, 'IBU-2611', '2026-11-10', 30, 3), batch(1, 'IBU-2705', '2027-05-31', 10, 3),
  batch(2, 'SAL-2612', '2026-12-31', 3, 22),
  batch(3, 'AMX-2703', '2027-03-31', 60, 9),
  batch(4, 'CAD-2610', '2026-10-15', 2, 18),
  batch(5, 'ETO-2702', '2027-02-28', 100, 12), batch(5, 'ETO-2610', '2026-10-31', 40, 12),
  batch(6, 'ASP-2709', '2027-09-30', 300, 5),
  batch(7, 'TRM-2704', '2027-04-30', 60, 10),
  batch(8, 'DCG-2611', '2026-11-30', 12, 90),
  batch(9, 'PCM-2608', '2026-08-15', 40, 2), batch(9, 'PCM-2706', '2027-06-30', 400, 2),
  batch(10, 'PAN-2703', '2027-03-31', 25, 8),
  batch(11, 'ATV-2801', '2028-01-31', 90, 11),
  batch(12, 'RAB-2709', '2027-09-30', 50, 9),
];

const v = (id: string, patientId: string, at: string, bp: [number, number], pulse: number, temp: number, spo2: number, rr: number, pain: number, note: string | null = null): VitalsRow =>
  ({ id, org_id: ORG_ID, patient_id: patientId, taken_at: at, bp_systolic: bp[0], bp_diastolic: bp[1], pulse, temp_c: temp, spo2, resp_rate: rr, pain, note, recorded_by: 'Dr. Sagar Karvir' });

export const vitals: VitalsRow[] = [
  v('vt-r1', 'p-ramesh', '2026-08-26T03:00:00Z', [142, 88], 96, 37.9, 95, 20, 6, 'Day 1 after surgery'),
  v('vt-r2', 'p-ramesh', '2026-08-27T03:00:00Z', [136, 84], 88, 37.4, 96, 18, 5),
  v('vt-r3', 'p-ramesh', '2026-08-28T03:00:00Z', [130, 82], 82, 37.0, 97, 16, 4),
  v('vt-r4', 'p-ramesh', '2026-08-29T03:00:00Z', [128, 80], 78, 36.8, 98, 16, 3, 'Walking with walker'),
  v('vt-s1', 'p-suresh', '2026-08-28T03:00:00Z', [134, 86], 92, 37.6, 96, 18, 5),
  v('vt-s2', 'p-suresh', '2026-08-28T13:00:00Z', [138, 88], 104, 38.1, 95, 20, 6, 'Low-grade fever, wound reviewed'),
  v('vt-s3', 'p-suresh', '2026-08-29T03:00:00Z', [140, 90], 112, 38.4, 93, 24, 6, 'Fever persisting; blood cultures sent'),
  v('vt-l1', 'p-lata', '2026-08-28T03:00:00Z', [124, 78], 76, 36.7, 98, 16, 2),
  v('vt-l2', 'p-lata', '2026-08-29T03:00:00Z', [122, 76], 74, 36.6, 98, 15, 1, 'Ready for discharge'),
];
