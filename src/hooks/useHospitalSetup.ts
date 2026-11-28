import { useOrgTable } from './useOrgTable';
import type { BedRow, ServiceRateRow } from '../types/db';

/** The hospital's price list, cheapest first within each category. */
export function useRates(orgId: string) {
  const { rows, loaded } = useOrgTable<ServiceRateRow>('service_rates', orgId, (r) => ({ ...r, amount: Number(r.amount) }));
  const rates = [...rows].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return { rates, loaded };
}

/** Wards and beds, by ward then bed label. */
export function useBeds(orgId: string) {
  const { rows, loaded } = useOrgTable<BedRow>('beds', orgId, (b) => ({ ...b, daily_rate: Number(b.daily_rate) }));
  const beds = [...rows].sort((a, b) => a.ward.localeCompare(b.ward) || a.label.localeCompare(b.label, undefined, { numeric: true }));
  return { beds, loaded };
}
