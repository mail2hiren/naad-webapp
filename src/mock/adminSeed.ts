import type { BedRow, ServiceRateRow } from '../types/db';
import { ORG_ID } from './seed';

/**
 * Demo hospital set-up (Phase 5): the price list the admin keeps, and the
 * wards and beds. Admitted demo patients occupy beds so occupancy shows.
 */

const rate = (id: string, name: string, category: ServiceRateRow['category'], amount: number, active = true): ServiceRateRow =>
  ({ id, org_id: ORG_ID, name, category, amount, active, created_at: '2026-08-01T04:30:00Z' });

export const rates: ServiceRateRow[] = [
  rate('rt-reg', 'Registration', 'other', 100),
  rate('rt-xray', 'X-ray (2 views)', 'investigation', 450),
  rate('rt-mri', 'MRI, one joint', 'investigation', 5500),
  rate('rt-ecg', 'ECG', 'investigation', 300),
  rate('rt-cbc', 'Blood test, CBC', 'investigation', 350),
  rate('rt-dress', 'Dressing', 'procedure', 200),
  rate('rt-plaster', 'Plaster cast, below knee', 'procedure', 1800),
  rate('rt-inj', 'Joint injection', 'procedure', 1200),
  rate('rt-physio', 'Physiotherapy session', 'therapy', 600),
  rate('rt-physio8', 'Physiotherapy package, 8 sessions', 'therapy', 4400),
  rate('rt-ward', 'General ward, per day', 'ward', 1500),
  rate('rt-private', 'Private room, per day', 'ward', 3500),
  rate('rt-icu', 'ICU, per day', 'ward', 9000),
  rate('rt-old', 'Old X-ray rate (retired)', 'investigation', 400, false),
];

const bed = (id: string, ward: string, label: string, kind: BedRow['kind'], dailyRate: number, patientId: string | null = null, since: string | null = null): BedRow =>
  ({ id, org_id: ORG_ID, ward, label, kind, daily_rate: dailyRate, active: true, patient_id: patientId, occupied_since: since, created_at: '2026-08-01T04:30:00Z' });

export const beds: BedRow[] = [
  ...['1', '2', '3', '4', '5', '6', '7', '8'].map((n) => bed(`bed-g${n}`, 'General Ward', `G-${n}`, 'general', 1500,
    n === '2' ? 'p-ramesh' : n === '5' ? 'p-suresh' : null,
    n === '2' ? '2026-08-25T06:00:00Z' : n === '5' ? '2026-08-27T09:00:00Z' : null)),
  ...['1', '2', '3', '4'].map((n) => bed(`bed-p${n}`, 'Private Rooms', `P-${n}`, 'private', 3500,
    n === '1' ? 'p-lata' : null, n === '1' ? '2026-08-20T08:00:00Z' : null)),
  ...['1', '2', '3'].map((n) => bed(`bed-i${n}`, 'ICU', `ICU-${n}`, 'icu', 9000)),
  ...['1', '2'].map((n) => bed(`bed-d${n}`, 'Day Care', `D-${n}`, 'day_care', 800)),
];
