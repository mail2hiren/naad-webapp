import type { InventoryRow, PrescriptionItem, StockBatchRow } from '../types/db';

/**
 * Pharmacy rules: how much to dispense, what is in date, and which batch to
 * take from (earliest expiry first). Free of React and the database so they
 * are unit tested (tests/lib/pharmacy.test.ts). Dates are "YYYY-MM-DD".
 */

/** Days within which a batch counts as expiring soon. */
export const EXPIRY_WARNING_DAYS = 90;

const PER_DAY: [RegExp, number][] = [
  [/four times|\bqid\b|4 ?x/i, 4], [/three times|thrice|\btds\b|\btid\b|3 ?x/i, 3],
  [/twice|\bbd\b|\bbid\b|2 ?x/i, 2], [/once|daily|at night|\bhs\b|\bod\b|morning|1 ?x/i, 1],
];

/** Units for a prescription line: doses a day x days, e.g. "Twice daily" for
 * "5 days" = 10. Creams, gels, drops and "as needed" lines are one pack. */
export function doseQty(item: Pick<PrescriptionItem, 'name' | 'frequency' | 'duration'>): number {
  if (/gel|cream|ointment|drops|syrup|spray|inhaler|lotion/i.test(item.name)) return 1;
  if (/as needed|sos|prn/i.test(item.frequency)) return 1;
  const perDay = PER_DAY.find(([re]) => re.test(item.frequency))?.[1] ?? 1;
  const m = /(\d+)\s*(day|week|month)/i.exec(item.duration);
  const days = m ? Number(m[1]) * (/week/i.test(m[2]) ? 7 : /month/i.test(m[2]) ? 30 : 1) : 1;
  return Math.max(1, perDay * days);
}

/** Matches a prescribed medicine to a stock item by its first word. */
export function matchInventory(inventory: InventoryRow[], itemName: string): InventoryRow | undefined {
  const key = itemName.toLowerCase().trim().split(' ')[0];
  if (!key) return undefined;
  return inventory.find((inv) => inv.drug.toLowerCase().includes(key));
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

export type ExpiryState = 'expired' | 'soon' | 'ok';
export function expiryState(expiry: string, today: string): ExpiryState {
  const d = daysBetween(today, expiry);
  return d < 0 ? 'expired' : d <= EXPIRY_WARNING_DAYS ? 'soon' : 'ok';
}

/** A batch that can still be dispensed: in date, not written off, not empty. */
export function usable(b: StockBatchRow, today: string): boolean {
  return !b.written_off_at && b.qty > 0 && b.expiry >= today;
}

export function onHand(batches: StockBatchRow[], inventoryId: number, today: string): number {
  return batches.filter((b) => b.inventory_id === inventoryId && usable(b, today)).reduce((s, b) => s + b.qty, 0);
}

export interface Allocation { batch: StockBatchRow; take: number }

/** Takes `qty` units from the batches that expire first. `short` is what could not be found. */
export function pickFefo(batches: StockBatchRow[], inventoryId: number, qty: number, today: string): { allocations: Allocation[]; short: number } {
  const usableBatches = batches.filter((b) => b.inventory_id === inventoryId && usable(b, today))
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.received_at.localeCompare(b.received_at));
  const allocations: Allocation[] = [];
  let left = qty;
  for (const batch of usableBatches) {
    if (left <= 0) break;
    const take = Math.min(batch.qty, left);
    allocations.push({ batch, take });
    left -= take;
  }
  return { allocations, short: Math.max(0, left) };
}
