import { useMemo, useState } from 'react';
import { Btn, Card, Modal, Pill, SectionHead, StatTile, inputCls } from '../ui';
import { MethodPicker, PaymentModal, Receipt } from '../reception/Billing';
import { useAuth } from '../../context/AuthContext';
import { useClinic } from '../../context/ClinicContext';
import { supabase } from '../../lib/supabaseClient';
import { createBill, newId } from '../../lib/frontDesk';
import { doseQty, matchInventory, pickFefo } from '../../lib/pharmacy';
import { balance, billTotals, clinicNow, clinicToday, dayKey, money } from '../../lib/schedule';
import type { BillItem, BillRow, PaymentMethod, PharmacyOrderRow, StockBatchRow } from '../../types/db';

interface Line { name: string; detail: string; inventoryId: number | null; qty: number; include: boolean }

/** Dispense an order: earliest-expiry batches are taken, stock goes down,
 * the order is collected and the patient gets a bill and receipt. */
export function DispenseModal({ order, batches, bills, onClose, onDone }: {
  order: PharmacyOrderRow; batches: StockBatchRow[]; bills: BillRow[]; onClose: () => void; onDone: (b: BillRow | null) => void;
}) {
  const { orgId, inventory, patients, pushToast, logAudit } = useClinic();
  const { practitioner } = useAuth();
  const today = clinicToday();
  const patient = patients.find((p) => p.id === order.patient_id);
  const [lines, setLines] = useState<Line[]>(() => order.items.map((it) => {
    const inv = matchInventory(inventory, it.name);
    return { name: it.name, detail: `${it.dosage} · ${it.frequency} · ${it.duration}`, inventoryId: inv?.id ?? null, qty: doseQty(it), include: !!inv };
  }));
  const [discount, setDiscount] = useState('');
  const [paidNow, setPaidNow] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);

  const plan = useMemo(() => lines.map((l) => {
    if (!l.include || l.inventoryId == null) return { line: l, pick: null, rate: 0 };
    const pick = pickFefo(batches, l.inventoryId, l.qty, today);
    const rate = pick.allocations[0]?.batch.mrp ?? order.items.find((i) => i.name === l.name)?.price ?? 0;
    return { line: l, pick, rate };
  }), [lines, batches, today, order.items]);
  const items: BillItem[] = plan.filter((p) => p.pick && p.line.qty - p.pick.short > 0).map((p) => ({
    description: `${p.line.name} (batch ${p.pick!.allocations.map((a) => a.batch.batch_no).join(', ')})`, qty: p.line.qty - p.pick!.short, rate: p.rate,
  }));
  const t = billTotals(items, Number(discount) || 0);
  const paid = paidNow === null ? t.total : Math.max(0, Number(paidNow) || 0);
  const short = plan.filter((p) => p.pick && p.pick.short > 0);
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function save() {
    setBusy(true);
    const now = clinicNow();
    let bill: BillRow | null = null;
    if (items.length) {
      const r = await createBill(orgId, bills, {
        patientId: order.patient_id, appointmentId: null, items, discount: Number(discount) || 0, paid, method, createdBy: practitioner?.name ?? null,
        source: 'pharmacy', pharmacyOrderId: order.id,
      }, now);
      if (r.error || !r.bill) { setBusy(false); pushToast({ tone: 'critical', title: 'Could not bill the medicines', detail: r.error ?? '' }); return; }
      bill = r.bill;
    }
    // Take the stock: each batch down by what was taken, and the item total.
    for (const p of plan) {
      if (!p.pick || p.line.inventoryId == null) continue;
      let taken = 0;
      for (const a of p.pick.allocations) {
        await supabase.from('stock_batches').update({ qty: a.batch.qty - a.take }).eq('id', a.batch.id);
        taken += a.take;
      }
      const inv = inventory.find((i) => i.id === p.line.inventoryId);
      if (inv && taken) await supabase.from('inventory').update({ stock: Math.max(0, inv.stock - taken) }).eq('id', inv.id);
    }
    await supabase.from('pharmacy_orders').update({ status: 'collected', updated_at: now.toISOString() }).eq('id', order.id);
    await supabase.from('notifications').insert({
      id: newId('nt'), org_id: orgId, type: 'general', patient_id: order.patient_id, practitioner_id: null,
      message: `Medicines dispensed for ${patient?.name ?? 'a patient'}`, channel: 'inapp', read: false,
    });
    await logAudit('pharmacy-dispense', `${patient?.name ?? ''}${bill ? `, ${bill.number} ${money(bill.total)}` : ''}${short.length ? `; short: ${short.map((s) => s.line.name).join(', ')}` : ''}`);
    setBusy(false);
    pushToast({ tone: 'ok', title: 'Dispensed', detail: `${patient?.name ?? ''}${bill ? ` · ${bill.number}` : ''}` });
    onDone(bill);
  }

  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="disp-title" data-testid="dispense-modal">
        <h2 id="disp-title" className="text-lg">Dispense for {patient?.name ?? 'patient'}</h2>
        <p className="mt-1 mb-3 text-[13px] text-ink-soft">Earliest-expiry batches are used first. Expired stock is never used.</p>
        <ul className="space-y-2">
          {plan.map((p, i) => (
            <li key={i} className="rounded-lg bg-surface-2 px-3 py-2" data-testid="dispense-line">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <label className="flex items-start gap-2 min-h-11 min-w-0">
                  <input type="checkbox" className="mt-1" checked={p.line.include} disabled={p.line.inventoryId == null} onChange={(e) => setLine(i, { include: e.target.checked })} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{p.line.name}</span>
                    <span className="block text-[13px] text-ink-soft">{p.line.detail}</span>
                  </span>
                </label>
                {p.line.inventoryId == null
                  ? <Pill tone="gate">Not stocked here</Pill>
                  : (
                    <label className="flex items-center gap-2 text-sm text-ink">Qty
                      <input className={`${inputCls} !w-20`} inputMode="numeric" data-testid="dispense-qty" value={p.line.qty} disabled={!p.line.include}
                        onChange={(e) => setLine(i, { qty: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
                    </label>
                  )}
              </div>
              {p.pick && p.line.include && (
                <div className="mt-1 text-[13px] text-ink-soft" data-testid="dispense-plan">
                  {p.pick.allocations.map((a) => `${a.take} from ${a.batch.batch_no} (exp ${a.batch.expiry})`).join(' + ') || 'No usable stock'}
                  {' · '}{money(p.rate)} each
                  {p.pick.short > 0 && <span className="block font-semibold text-danger">Short by {p.pick.short}. Only what is in stock will be dispensed.</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 grid sm:grid-cols-2 gap-x-3">
          <label className="block mb-3"><span className="block text-[13px] font-semibold text-ink-soft mb-1">Discount (₹)</span>
            <input className={inputCls} inputMode="decimal" data-testid="dispense-discount" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" /></label>
          <label className="block mb-3"><span className="block text-[13px] font-semibold text-ink-soft mb-1">Paid now (₹)</span>
            <input className={inputCls} inputMode="decimal" data-testid="dispense-paid" value={paidNow ?? String(t.total)} onChange={(e) => setPaidNow(e.target.value.replace(/[^\d.]/g, ''))} /></label>
        </div>
        {paid > 0 && <MethodPicker value={method} onChange={setMethod} />}
        <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm flex justify-between font-semibold text-ink"><span>Total</span><span data-testid="dispense-total">{money(t.total)}</span></div>
        <div className="mt-4 flex gap-2">
          <Btn variant="glow" data-testid="dispense-save" disabled={busy} onClick={save}>{busy ? 'Saving…' : items.length ? 'Dispense and bill' : 'Dispense (nothing to bill)'}</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

/** The pharmacy's own bills: today's takings and each sale with its receipt. */
export function SalesSection({ bills }: { bills: BillRow[] }) {
  const { patients } = useClinic();
  const [receipt, setReceipt] = useState<BillRow | null>(null);
  const [paying, setPaying] = useState<BillRow | null>(null);
  const today = clinicToday();
  const mine = bills.filter((b) => b.source === 'pharmacy');
  const todays = mine.filter((b) => dayKey(new Date(b.created_at)) === today && b.status !== 'void');
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        <StatTile label="Sales today" value={todays.length} />
        <StatTile label="Collected today" value={money(mine.filter((b) => b.status !== 'void' && b.paid_at && dayKey(new Date(b.paid_at)) === today).reduce((s, b) => s + b.paid, 0))} tone="ok" />
        <StatTile label="Balance due" value={money(mine.reduce((s, b) => s + balance(b), 0))} tone="danger" />
      </div>
      <Card>
        <SectionHead title="Pharmacy bills" desc="Every medicine sale, newest first." />
        {mine.length === 0 && <p className="text-sm text-ink-soft">No sales yet.</p>}
        <ul className="space-y-2">
          {mine.map((b) => (
            <li key={b.id} className="rounded-lg bg-surface-2 px-3 py-2" data-testid="sale-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{b.number} · {patients.find((p) => p.id === b.patient_id)?.name ?? 'Unknown'}</span>
                  <span className="block text-[13px] text-ink-soft truncate">{b.items.map((i) => `${i.qty} x ${i.description.replace(/ \(batch.*\)$/, '')}`).join(', ')}</span>
                </span>
                <span className="text-sm font-semibold text-ink">{money(b.total)}{balance(b) > 0 && <span className="block text-[13px] text-gate font-normal">due {money(balance(b))}</span>}</span>
              </div>
              <div className="mt-1 flex gap-1">
                <Btn variant="default" data-testid="sale-receipt" onClick={() => setReceipt(b)}>Receipt</Btn>
                {balance(b) > 0 && <Btn variant="primary" onClick={() => setPaying(b)}>Take payment</Btn>}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      {receipt && <Receipt bill={bills.find((x) => x.id === receipt.id) ?? receipt} onClose={() => setReceipt(null)} />}
      {paying && <PaymentModal bill={paying} onClose={() => setPaying(null)} />}
    </>
  );
}
