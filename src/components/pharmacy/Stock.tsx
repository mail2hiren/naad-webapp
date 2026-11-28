import { useMemo, useState } from 'react';
import { Btn, Card, Field, Modal, Pill, StatTile, inputCls } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { useClinic } from '../../context/ClinicContext';
import { supabase } from '../../lib/supabaseClient';
import { newId } from '../../lib/frontDesk';
import { EXPIRY_WARNING_DAYS, expiryState, onHand } from '../../lib/pharmacy';
import { clinicToday, money } from '../../lib/schedule';
import { downloadCsv } from '../../lib/csv';
import type { InventoryRow, StockBatchRow } from '../../types/db';

type Filter = 'all' | 'reorder' | 'expiring' | 'expired';
const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Medicines on hand by batch: reorder levels, expiry, receiving stock and
 * writing off what has expired. */
export function StockSection({ batches }: { batches: StockBatchRow[] }) {
  const { inventory } = useClinic();
  const today = clinicToday();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [receiving, setReceiving] = useState<InventoryRow | 'new' | null>(null);
  const [writingOff, setWritingOff] = useState<StockBatchRow | null>(null);

  const live = (b: StockBatchRow) => !b.written_off_at && b.qty > 0;
  const rows = useMemo(() => inventory.map((inv) => {
    const mine = batches.filter((b) => b.inventory_id === inv.id && live(b));
    return {
      inv, mine, usable: onHand(batches, inv.id, today),
      expiring: mine.filter((b) => expiryState(b.expiry, today) === 'soon'),
      expired: mine.filter((b) => expiryState(b.expiry, today) === 'expired'),
    };
  }).sort((a, b) => a.inv.drug.localeCompare(b.inv.drug)), [inventory, batches, today]);
  const needsReorder = (r: (typeof rows)[number]) => r.usable <= r.inv.low;

  const shown = rows.filter((r) => (filter === 'all' || (filter === 'reorder' && needsReorder(r)) || (filter === 'expiring' && r.expiring.length > 0) || (filter === 'expired' && r.expired.length > 0))
    && (!q.trim() || r.inv.drug.toLowerCase().includes(q.trim().toLowerCase())));

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <StatTile label="Medicines" value={rows.length} />
        <StatTile label="At or below reorder level" value={rows.filter(needsReorder).length} tone="gate" />
        <StatTile label={`Batches expiring in ${EXPIRY_WARNING_DAYS} days`} value={rows.reduce((n, r) => n + r.expiring.length, 0)} tone="accent" />
        <StatTile label="Expired, not written off" value={rows.reduce((n, r) => n + r.expired.length, 0)} tone="danger" />
      </div>
      <Card>
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1">
            {([['all', 'All'], ['reorder', 'Reorder'], ['expiring', 'Expiring soon'], ['expired', 'Expired']] as const).map(([k, l]) => (
              <Btn key={k} variant={filter === k ? 'primary' : 'default'} aria-pressed={filter === k} data-testid={`stock-${k}`} onClick={() => setFilter(k)}>{l}</Btn>
            ))}
          </div>
          <label className="block flex-1 min-w-[12rem]"><span className="sr-only">Search medicines</span>
            <input className={inputCls} data-testid="stock-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search medicines" /></label>
          <Btn variant="glow" data-testid="receive-new" onClick={() => setReceiving('new')}>+ Receive stock</Btn>
          <Btn variant="default" data-testid="reorder-csv" onClick={() => downloadCsv(`naad-reorder-${today}.csv`, ['Medicine', 'Unit', 'On hand', 'Reorder level', 'Suggested order'],
            rows.filter(needsReorder).map((r) => [r.inv.drug, r.inv.unit, r.usable, r.inv.low, Math.max(r.inv.low * 3 - r.usable, r.inv.low)]))}>Reorder list (CSV)</Btn>
        </div>
        {shown.length === 0 && <p className="text-sm text-ink-soft">Nothing here.</p>}
        <ul className="divide-y divide-line">
          {shown.map((r) => (
            <li key={r.inv.id} className="py-2" data-testid="stock-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" className="min-h-11 text-left min-w-0" aria-expanded={openId === r.inv.id} onClick={() => setOpenId(openId === r.inv.id ? null : r.inv.id)}>
                  <span className="block text-sm font-semibold text-ink">{r.inv.drug}</span>
                  <span className="block text-[13px] text-ink-soft">{r.usable} {r.inv.unit ?? ''} usable · reorder at {r.inv.low} · {r.mine.length} batch{r.mine.length === 1 ? '' : 'es'}</span>
                </button>
                <span className="flex flex-wrap items-center gap-2">
                  {needsReorder(r) && <Pill tone="gate">Reorder</Pill>}
                  {r.expiring.length > 0 && <Pill tone="accent">Expiring soon</Pill>}
                  {r.expired.length > 0 && <Pill tone="danger">Expired batch</Pill>}
                  <Btn variant="primary" data-testid="receive-item" onClick={() => setReceiving(r.inv)}>Receive</Btn>
                </span>
              </div>
              {openId === r.inv.id && <ItemDetail inv={r.inv} batches={r.mine} today={today} onWriteOff={setWritingOff} />}
            </li>
          ))}
        </ul>
      </Card>
      {receiving && <ReceiveModal item={receiving === 'new' ? null : receiving} batches={batches} onClose={() => setReceiving(null)} />}
      {writingOff && <WriteOffModal batch={writingOff} onClose={() => setWritingOff(null)} />}
    </>
  );
}

function ItemDetail({ inv, batches, today, onWriteOff }: { inv: InventoryRow; batches: StockBatchRow[]; today: string; onWriteOff: (b: StockBatchRow) => void }) {
  const { pushToast, logAudit } = useClinic();
  const [low, setLow] = useState(String(inv.low));
  async function saveLow() {
    const v = Number(low);
    if (!Number.isInteger(v) || v < 0 || v === inv.low) return;
    const { error } = await supabase.from('inventory').update({ low: v }).eq('id', inv.id);
    if (error) { pushToast({ tone: 'critical', title: 'Could not save', detail: error.message }); return; }
    await logAudit('pharmacy-reorder-level', `${inv.drug}: ${inv.low} to ${v}`);
    pushToast({ tone: 'ok', title: 'Reorder level saved', detail: `${inv.drug}: ${v}` });
  }
  const sorted = [...batches].sort((a, b) => a.expiry.localeCompare(b.expiry));
  return (
    <div className="mt-2 rounded-lg bg-surface-2 p-3" data-testid="stock-detail">
      <label className="flex flex-wrap items-center gap-2 text-sm text-ink mb-2">Reorder when usable stock is at or below
        <input className={`${inputCls} !w-24`} inputMode="numeric" data-testid="reorder-level" value={low} onChange={(e) => setLow(e.target.value.replace(/\D/g, ''))} onBlur={saveLow} />
        {inv.unit}</label>
      {inv.alternates.length > 0 && <p className="text-[13px] text-ink-soft mb-2">Alternatives: {inv.alternates.join(', ')}</p>}
      {sorted.length === 0 && <p className="text-sm text-ink-soft">No stock.</p>}
      <ul className="divide-y divide-line">
        {sorted.map((b) => {
          const st = expiryState(b.expiry, today);
          return (
            <li key={b.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="batch-row">
              <span><span className="font-semibold text-ink">{b.batch_no}</span><span className="text-ink-soft"> · {b.qty} {inv.unit} · {money(b.mrp)} each{b.supplier ? ` · ${b.supplier}` : ''}</span></span>
              <span className="flex items-center gap-2">
                <Pill tone={st === 'expired' ? 'danger' : st === 'soon' ? 'accent' : 'ok'}>{st === 'expired' ? 'Expired' : 'Expires'} {fmtDate(b.expiry)}</Pill>
                <Btn variant={st === 'expired' ? 'danger' : 'ghost'} data-testid="write-off" onClick={() => onWriteOff(b)}>Write off</Btn>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReceiveModal({ item, batches, onClose }: { item: InventoryRow | null; batches: StockBatchRow[]; onClose: () => void }) {
  const { orgId, inventory, pushToast, logAudit } = useClinic();
  const { practitioner } = useAuth();
  const [itemId, setItemId] = useState<string>(item ? String(item.id) : '__new');
  const [f, setF] = useState({ drug: '', unit: 'tablets', low: '20', batch: '', expiry: '', qty: '', mrp: '', supplier: '' });
  const [busy, setBusy] = useState(false);
  const isNew = itemId === '__new';
  const existing = inventory.find((i) => String(i.id) === itemId);
  const dupBatch = existing && batches.some((b) => b.inventory_id === existing.id && b.batch_no.toLowerCase() === f.batch.trim().toLowerCase());
  const dupDrug = isNew && inventory.some((i) => i.drug.toLowerCase() === f.drug.trim().toLowerCase());
  const today = clinicToday();
  const valid = f.batch.trim() && f.expiry > today && Number(f.qty) > 0 && f.mrp !== '' && (!isNew || (f.drug.trim() && !dupDrug)) && !dupBatch;

  async function save() {
    if (!valid) return;
    setBusy(true);
    let inv = existing;
    if (isNew) {
      const { data, error } = await supabase.from('inventory').insert({ org_id: orgId, drug: f.drug.trim(), stock: 0, unit: f.unit.trim() || null, low: Number(f.low) || 0, alternates: [] }).select().single();
      if (error || !data) { setBusy(false); pushToast({ tone: 'critical', title: 'Could not add the medicine', detail: error?.message ?? '' }); return; }
      inv = data as InventoryRow;
    }
    if (!inv) { setBusy(false); return; }
    const qty = Number(f.qty);
    const { error } = await supabase.from('stock_batches').insert({
      id: newId('sb'), org_id: orgId, inventory_id: inv.id, batch_no: f.batch.trim(), expiry: f.expiry, qty, mrp: Number(f.mrp),
      supplier: f.supplier.trim() || null, received_at: new Date().toISOString(), received_by: practitioner?.name ?? null, written_off_at: null, write_off_reason: null,
    });
    if (error) { setBusy(false); pushToast({ tone: 'critical', title: 'Could not receive the stock', detail: error.message }); return; }
    await supabase.from('inventory').update({ stock: (inv.stock ?? 0) + qty }).eq('id', inv.id);
    setBusy(false);
    await logAudit('pharmacy-receive', `${inv.drug} batch ${f.batch.trim()} x${qty}, expires ${f.expiry}`);
    pushToast({ tone: 'ok', title: 'Stock received', detail: `${inv.drug} · ${qty} ${inv.unit ?? ''}` });
    onClose();
  }

  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="rcv-title" data-testid="receive-modal">
        <h2 id="rcv-title" className="text-lg mb-3">Receive stock</h2>
        <Field label="Medicine">
          <select className={inputCls} data-testid="rcv-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="__new">New medicine…</option>
            {[...inventory].sort((a, b) => a.drug.localeCompare(b.drug)).map((i) => <option key={i.id} value={String(i.id)}>{i.drug}</option>)}
          </select>
        </Field>
        {isNew && (
          <div className="grid sm:grid-cols-3 gap-x-3">
            <Field label="Name and strength"><input className={inputCls} data-testid="rcv-drug" value={f.drug} onChange={(e) => setF({ ...f, drug: e.target.value })} placeholder="e.g. Cefixime 200mg" /></Field>
            <Field label="Unit"><input className={inputCls} data-testid="rcv-unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
            <Field label="Reorder level"><input className={inputCls} inputMode="numeric" value={f.low} onChange={(e) => setF({ ...f, low: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
        )}
        {dupDrug && <p className="text-[13px] text-danger -mt-1 mb-2" role="alert">This medicine is already on the list. Pick it above.</p>}
        <div className="grid sm:grid-cols-2 gap-x-3">
          <Field label="Batch number"><input className={inputCls} data-testid="rcv-batch" value={f.batch} onChange={(e) => setF({ ...f, batch: e.target.value })} /></Field>
          <Field label="Expiry date"><input type="date" className={inputCls} data-testid="rcv-expiry" value={f.expiry} min={today} onChange={(e) => setF({ ...f, expiry: e.target.value })} /></Field>
          <Field label="Quantity"><input className={inputCls} inputMode="numeric" data-testid="rcv-qty" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Selling price per unit (MRP, ₹)"><input className={inputCls} inputMode="decimal" data-testid="rcv-mrp" value={f.mrp} onChange={(e) => setF({ ...f, mrp: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        </div>
        <Field label="Supplier (optional)"><input className={inputCls} value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></Field>
        {dupBatch && <p className="text-[13px] text-danger mb-2" role="alert">This batch number is already in stock for this medicine.</p>}
        {f.expiry && f.expiry <= today && <p className="text-[13px] text-danger mb-2" role="alert">This batch has already expired.</p>}
        <div className="mt-2 flex gap-2">
          <Btn variant="glow" data-testid="rcv-save" disabled={busy || !valid} onClick={save}>{busy ? 'Saving…' : 'Receive'}</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

function WriteOffModal({ batch, onClose }: { batch: StockBatchRow; onClose: () => void }) {
  const { inventory, pushToast, logAudit } = useClinic();
  const [reason, setReason] = useState(batch.expiry < clinicToday() ? 'Expired' : '');
  const [busy, setBusy] = useState(false);
  const inv = inventory.find((i) => i.id === batch.inventory_id);
  async function save() {
    setBusy(true);
    const { error } = await supabase.from('stock_batches').update({ written_off_at: new Date().toISOString(), write_off_reason: reason.trim() }).eq('id', batch.id);
    if (!error && inv) await supabase.from('inventory').update({ stock: Math.max(0, inv.stock - batch.qty) }).eq('id', inv.id);
    setBusy(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not write off', detail: error.message }); return; }
    await logAudit('pharmacy-write-off', `${inv?.drug ?? ''} batch ${batch.batch_no} x${batch.qty}: ${reason.trim()}`);
    pushToast({ tone: 'info', title: 'Written off', detail: `${inv?.drug ?? ''} · batch ${batch.batch_no} · ${batch.qty} ${inv?.unit ?? ''}` });
    onClose();
  }
  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="wo-title" data-testid="writeoff-modal">
        <h2 id="wo-title" className="text-lg">Write off batch {batch.batch_no}</h2>
        <p className="mt-1 mb-3 text-sm text-ink-soft">{inv?.drug} · {batch.qty} {inv?.unit}. The batch stays on record but leaves stock.</p>
        <Field label="Reason"><input className={inputCls} data-testid="wo-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Expired, damaged, recalled" /></Field>
        <div className="flex gap-2">
          <Btn variant="danger" data-testid="wo-confirm" disabled={busy || !reason.trim()} onClick={save}>Write off</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}
