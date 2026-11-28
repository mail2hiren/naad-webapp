import { useEffect, useMemo, useState } from 'react';
import { Btn, Card, Field, Modal, Pill, SectionHead, StatTile, inputCls } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { useClinic } from '../../context/ClinicContext';
import { PatientLine, PatientPicker } from './PatientPicker';
import { supabase } from '../../lib/supabaseClient';
import {
  VISIT_LABEL, addDays, apptStart, balance, billTotals, clinicNow, clinicToday, dayKey, money, timeLabel,
} from '../../lib/schedule';
import { createBill, recordPayment, voidBill } from '../../lib/frontDesk';
import type { AppointmentRow, BillItem, BillRow, BillStatus, PatientRow, PaymentMethod } from '../../types/db';

const METHOD_LABEL: Record<PaymentMethod, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', insurance: 'Insurance' };
const BILL_STATUS: Record<BillStatus, { label: string; tone: 'default' | 'gate' | 'ok' | 'danger' }> = {
  unpaid: { label: 'Unpaid', tone: 'danger' }, part_paid: { label: 'Part paid', tone: 'gate' }, paid: { label: 'Paid', tone: 'ok' }, void: { label: 'Void', tone: 'default' },
};

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function MethodPicker({ value, onChange }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  return (
    <fieldset className="mb-3">
      <legend className="text-[13px] font-semibold text-ink-soft mb-1.5">Paid by</legend>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
          <label key={m} className={`inline-flex items-center gap-2 min-h-11 rounded-lg border px-3 cursor-pointer text-sm ${value === m ? 'border-accent bg-accent-soft text-ink font-semibold' : 'border-line text-ink-soft'}`}>
            <input type="radio" name="pay-method" value={m} checked={value === m} onChange={() => onChange(m)} data-testid={`pay-${m}`} />
            {METHOD_LABEL[m]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Create a bill for a visit (prefilled from the appointment) or for anything else. */
export function BillModal({
  appointment, patient: initialPatient, bills, onClose, onCreated,
}: { appointment?: AppointmentRow | null; patient?: PatientRow | null; bills: BillRow[]; onClose: () => void; onCreated: (b: BillRow) => void }) {
  const { orgId, patients, practitioners, pushToast, logAudit } = useClinic();
  const { practitioner: me } = useAuth();
  const apptPatient = appointment ? patients.find((p) => p.id === appointment.patient_id) ?? null : null;
  const [patient, setPatient] = useState<PatientRow | null>(apptPatient ?? initialPatient ?? null);
  const doc = appointment ? practitioners.find((p) => p.id === appointment.practitioner_id) : undefined;
  const physioFee = practitioners.find((p) => p.role === 'physio' && p.consult_fee)?.consult_fee ?? 600;
  const [items, setItems] = useState<BillItem[]>(() => (appointment && doc
    ? [{ description: `${VISIT_LABEL[appointment.visit_type ?? 'consultation']}, ${doc.name}`, qty: 1, rate: doc.consult_fee ?? 0 }]
    : []));
  const [discount, setDiscount] = useState('');
  const t = billTotals(items, Number(discount) || 0);
  const [paidNow, setPaidNow] = useState<string | null>(null);
  const paid = paidNow === null ? t.total : Math.max(0, Number(paidNow) || 0);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [saving, setSaving] = useState(false);

  const quick: BillItem[] = [
    { description: 'Registration', qty: 1, rate: 100 },
    { description: 'X-ray (2 views)', qty: 1, rate: 450 },
    { description: 'Dressing', qty: 1, rate: 200 },
    { description: 'Physiotherapy session', qty: 1, rate: physioFee },
    { description: 'Physiotherapy package, 8 sessions', qty: 8, rate: physioFee },
  ];
  const setItem = (i: number, patch: Partial<BillItem>) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  async function save() {
    if (!patient) return;
    setSaving(true);
    const { bill, error } = await createBill(orgId, bills, {
      patientId: patient.id, appointmentId: appointment?.id ?? null, items, discount: Number(discount) || 0,
      paid, method, createdBy: me?.name ?? null,
    }, clinicNow());
    setSaving(false);
    if (error || !bill) { pushToast({ tone: 'critical', title: 'Could not save the bill', detail: error ?? '' }); return; }
    await logAudit('reception-bill', `${bill.number} ${patient.name} ${money(bill.total)}`);
    pushToast({ tone: 'ok', title: `Bill ${bill.number} saved`, detail: `${patient.name} · ${money(bill.total)}` });
    onCreated(bill);
  }

  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="bill-title" data-testid="bill-modal">
        <h2 id="bill-title" className="text-lg mb-3">New bill</h2>
        {appointment && patient ? <div className="rounded-lg bg-surface-2 px-3 py-2"><PatientLine p={patient} /></div>
          : <PatientPicker value={patient} onChange={setPatient} />}
        {appointment && doc && <p className="mt-2 text-[13px] text-ink-soft">For the visit with {doc.name}{apptStart(appointment) ? `, ${timeLabel(apptStart(appointment) as Date)}` : ''}.</p>}

        <div className="mt-4">
          <div className="text-[13px] font-semibold text-ink-soft mb-1.5">Items</div>
          {items.length === 0 && <p className="text-sm text-ink-soft mb-2">No items yet. Add one below.</p>}
          {items.length > 0 && (
            <div className="grid grid-cols-[1fr_4rem_6rem_auto] gap-2 text-[13px] text-ink-soft mb-1" aria-hidden="true">
              <span>Item</span><span>Qty</span><span>Rate (₹)</span><span className="w-11" />
            </div>
          )}
          <ul className="space-y-2" data-testid="bill-items">
            {items.map((it, i) => (
              <li key={i} className="grid grid-cols-[1fr_4rem_6rem_auto] gap-2 items-center">
                <label className="block"><span className="sr-only">Item {i + 1}</span>
                  <input className={inputCls} data-testid="item-desc" value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} /></label>
                <label className="block"><span className="sr-only">Quantity</span>
                  <input className={inputCls} data-testid="item-qty" inputMode="numeric" value={it.qty} onChange={(e) => setItem(i, { qty: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></label>
                <label className="block"><span className="sr-only">Rate in rupees</span>
                  <input className={inputCls} data-testid="item-rate" inputMode="decimal" value={it.rate} onChange={(e) => setItem(i, { rate: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} /></label>
                <Btn variant="ghost" aria-label={`Remove ${it.description || 'item'}`} onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</Btn>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn variant="default" data-testid="add-item" onClick={() => setItems([...items, { description: '', qty: 1, rate: 0 }])}>+ Item</Btn>
            {quick.map((q) => (
              <Btn key={q.description} variant="default" data-testid="quick-item" onClick={() => setItems([...items, q])}>+ {q.description}</Btn>
            ))}
          </div>
        </div>

        <div className="mt-4 grid sm:grid-cols-2 gap-x-3">
          <Field label="Discount (₹)"><input data-testid="bill-discount" className={inputCls} inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" /></Field>
          <Field label="Paid now (₹)"><input data-testid="bill-paid" className={inputCls} inputMode="decimal" value={paidNow ?? String(t.total)} onChange={(e) => setPaidNow(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        </div>
        {paid > 0 && <MethodPicker value={method} onChange={setMethod} />}
        <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm" data-testid="bill-summary">
          <div className="flex justify-between"><span className="text-ink-soft">Subtotal</span><span>{money(t.subtotal)}</span></div>
          {t.discount > 0 && <div className="flex justify-between"><span className="text-ink-soft">Discount</span><span>− {money(t.discount)}</span></div>}
          <div className="flex justify-between font-semibold text-ink"><span>Total</span><span data-testid="bill-total">{money(t.total)}</span></div>
          {paid < t.total && <div className="flex justify-between text-gate"><span>Balance due</span><span>{money(t.total - Math.min(paid, t.total))}</span></div>}
        </div>
        <div className="mt-4 flex gap-2">
          <Btn variant="glow" data-testid="bill-save" disabled={saving || !patient || t.subtotal === 0} onClick={save}>{saving ? 'Saving…' : paid > 0 ? 'Save and take payment' : 'Save bill'}</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

function PaymentModal({ bill, onClose }: { bill: BillRow; onClose: () => void }) {
  const { patients, pushToast, logAudit } = useClinic();
  const due = balance(bill);
  const [amount, setAmount] = useState(String(due));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);
  const p = patients.find((x) => x.id === bill.patient_id);
  async function save() {
    setBusy(true);
    const error = await recordPayment(bill, Number(amount) || 0, method, clinicNow());
    setBusy(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not record the payment', detail: error }); return; }
    await logAudit('reception-payment', `${bill.number} ${money(Number(amount) || 0)} ${METHOD_LABEL[method]}`);
    pushToast({ tone: 'ok', title: 'Payment recorded', detail: `${bill.number} · ${money(Number(amount) || 0)}` });
    onClose();
  }
  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="pay-title" data-testid="payment-modal">
        <h2 id="pay-title" className="text-lg">Take payment · {bill.number}</h2>
        <p className="mt-1 mb-3 text-sm text-ink-soft">{p?.name} · total {money(bill.total)} · paid {money(bill.paid)} · due {money(due)}</p>
        <Field label="Amount (₹)"><input data-testid="pay-amount" className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        <MethodPicker value={method} onChange={setMethod} />
        <div className="flex gap-2">
          <Btn variant="glow" data-testid="pay-save" disabled={busy || !(Number(amount) > 0)} onClick={save}>Record payment</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

function VoidModal({ bill, onClose }: { bill: BillRow; onClose: () => void }) {
  const { pushToast, logAudit } = useClinic();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const error = await voidBill(bill, reason);
    setBusy(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not void the bill', detail: error }); return; }
    await logAudit('reception-void-bill', `${bill.number}: ${reason.trim()}`);
    pushToast({ tone: 'info', title: `Bill ${bill.number} voided` });
    onClose();
  }
  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="void-title" data-testid="void-modal">
        <h2 id="void-title" className="text-lg">Void bill {bill.number}</h2>
        <p className="mt-1 mb-3 text-sm text-ink-soft">A voided bill stays on record but no longer counts. Bills are never deleted.</p>
        <Field label="Reason"><input data-testid="void-reason" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong patient, re-billed as R-01009" /></Field>
        <div className="flex gap-2">
          <Btn variant="danger" data-testid="void-confirm" disabled={busy || !reason.trim()} onClick={save}>Void bill</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

interface Org { name: string; address: string | null; city: string | null; contact_phone: string | null }

/** Printable receipt. Print shows only the receipt (see .print-receipt in index.css). */
export function Receipt({ bill, onClose }: { bill: BillRow; onClose: () => void }) {
  const { orgId, patients, appointments, practitioners } = useClinic();
  const [org, setOrg] = useState<Org | null>(null);
  useEffect(() => {
    let live = true;
    void supabase.from('organizations').select('*').eq('id', orgId).maybeSingle().then(({ data }) => { if (live) setOrg(data as Org | null); });
    return () => { live = false; };
  }, [orgId]);
  const p = patients.find((x) => x.id === bill.patient_id);
  const appt = bill.appointment_id ? appointments.find((a) => a.id === bill.appointment_id) : undefined;
  const doc = appt ? practitioners.find((x) => x.id === appt.practitioner_id) : undefined;
  const due = balance(bill);
  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="rcpt-title" data-testid="receipt">
        <div className="print-receipt">
          <div className="text-center border-b border-line pb-3 mb-3">
            <div className="text-lg font-semibold text-ink">{org?.name ?? 'Hospital'}</div>
            <div className="text-[13px] text-ink-soft">{[org?.address, org?.city && !(org?.address ?? '').includes(org.city) ? org.city : null].filter(Boolean).join(', ')}{org?.contact_phone ? ` · ${org.contact_phone}` : ''}</div>
            <h2 id="rcpt-title" className="mt-2 text-base">{bill.status === 'void' ? 'Receipt (VOID)' : bill.paid > 0 ? 'Receipt' : 'Bill'}</h2>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm mb-3">
            <dt className="text-ink-soft">Number</dt><dd className="text-ink font-semibold" data-testid="receipt-number">{bill.number}</dd>
            <dt className="text-ink-soft">Date</dt><dd className="text-ink">{when(bill.created_at)}</dd>
            <dt className="text-ink-soft">Patient</dt><dd className="text-ink">{p?.name}{p?.mrn ? ` (${p.mrn})` : ''}</dd>
            {doc && <><dt className="text-ink-soft">Doctor</dt><dd className="text-ink">{doc.name}</dd></>}
          </dl>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-ink-soft text-left"><th className="py-1 font-semibold">Item</th><th className="py-1 font-semibold text-right">Qty</th><th className="py-1 font-semibold text-right">Rate</th><th className="py-1 font-semibold text-right">Amount</th></tr></thead>
            <tbody>
              {bill.items.map((it, i) => (
                <tr key={i} className="border-b border-line"><td className="py-1 text-ink">{it.description}</td><td className="py-1 text-right">{it.qty}</td><td className="py-1 text-right">{money(it.rate)}</td><td className="py-1 text-right">{money(it.qty * it.rate)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-sm space-y-0.5">
            {bill.discount > 0 && <div className="flex justify-between"><span className="text-ink-soft">Discount</span><span>− {money(bill.discount)}</span></div>}
            <div className="flex justify-between font-semibold text-ink"><span>Total</span><span>{money(bill.total)}</span></div>
            <div className="flex justify-between"><span className="text-ink-soft">Paid{bill.payment_method ? ` (${METHOD_LABEL[bill.payment_method]})` : ''}</span><span>{money(bill.paid)}</span></div>
            {due > 0 && <div className="flex justify-between font-semibold text-gate"><span>Balance due</span><span>{money(due)}</span></div>}
            {bill.status === 'void' && <div className="text-danger">Voided: {bill.void_reason}</div>}
          </div>
          <p className="mt-4 text-center text-[13px] text-ink-faint">Thank you. Issued by {bill.created_by ?? 'reception'}.</p>
        </div>
        <div className="no-print mt-4 flex gap-2">
          <Btn variant="glow" data-testid="print-receipt" onClick={() => window.print()}>Print</Btn>
          <Btn variant="ghost" data-testid="close-receipt" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </Modal>
  );
}

/** The billing desk: visits waiting to be billed, today's takings and every bill. */
export function BillingSection({ bills, startBill }: { bills: BillRow[]; startBill: (a: AppointmentRow | null) => void }) {
  const { appointments, patients, practitioners } = useClinic();
  const [filter, setFilter] = useState<'today' | 'due' | 'all'>('today');
  const [q, setQ] = useState('');
  const [receipt, setReceipt] = useState<BillRow | null>(null);
  const [paying, setPaying] = useState<BillRow | null>(null);
  const [voiding, setVoiding] = useState<BillRow | null>(null);
  const today = clinicToday();
  const weekAgo = addDays(today, -7);

  const toBill = useMemo(() => appointments.filter((a) => {
    const s = apptStart(a);
    if (!s || (a.status !== 'completed' && a.status !== 'checked_in')) return false;
    const d = dayKey(s);
    return d >= weekAgo && d <= today && !bills.some((b) => b.appointment_id === a.id && b.status !== 'void');
  }).sort((a, b) => (a.status === b.status ? 0 : a.status === 'completed' ? -1 : 1)), [appointments, bills, today, weekAgo]);

  const live = bills.filter((b) => b.status !== 'void');
  const paidToday = live.filter((b) => b.paid_at && dayKey(new Date(b.paid_at)) === today);
  const byMethod = (Object.keys(METHOD_LABEL) as PaymentMethod[])
    .map((m) => [m, paidToday.filter((b) => b.payment_method === m).reduce((s, b) => s + b.paid, 0)] as const)
    .filter(([, v]) => v > 0);
  const outstanding = live.reduce((s, b) => s + balance(b), 0);

  const shown = bills.filter((b) => {
    if (filter === 'today' && dayKey(new Date(b.created_at)) !== today) return false;
    if (filter === 'due' && balance(b) <= 0) return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    const p = patients.find((x) => x.id === b.patient_id);
    return b.number.toLowerCase().includes(s) || (p?.name ?? '').toLowerCase().includes(s) || (p?.mrn ?? '').toLowerCase().includes(s);
  });

  return (
    <>
      <Card className="mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatTile label="Collected today" value={money(paidToday.reduce((s, b) => s + b.paid, 0))} tone="ok" />
          <StatTile label="Bills today" value={live.filter((b) => dayKey(new Date(b.created_at)) === today).length} />
          <StatTile label="Waiting to be billed" value={toBill.length} tone="gate" />
          <StatTile label="Balance due (all)" value={money(outstanding)} tone="danger" />
        </div>
        {byMethod.length > 0 && <p className="mt-2 text-[13px] text-ink-soft">Today by method: {byMethod.map(([m, v]) => `${METHOD_LABEL[m]} ${money(v)}`).join(' · ')}</p>}
        <p className="mt-1 text-[13px] text-ink-faint">Collected today counts bills whose latest payment was today.</p>
      </Card>

      <Card className="mb-4">
        <SectionHead title="Waiting to be billed" desc="Visits from the last 7 days with no bill yet. Seen visits come first." />
        {toBill.length === 0 && <p className="text-sm text-ink-soft">Nothing waiting.</p>}
        <ul className="space-y-2">
          {toBill.map((a) => {
            const p = patients.find((x) => x.id === a.patient_id);
            const doc = practitioners.find((x) => x.id === a.practitioner_id);
            const s = apptStart(a) as Date;
            return (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2" data-testid="to-bill">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{p?.name ?? 'Unknown'}{a.token_no ? ` · Token ${a.token_no}` : ''}</span>
                  <span className="block text-[13px] text-ink-soft">{doc?.name} · {VISIT_LABEL[a.visit_type ?? 'consultation']} · {dayKey(s) === today ? timeLabel(s) : when(s.toISOString())} · {a.status === 'completed' ? 'Seen' : 'With the doctor'}</span>
                </span>
                <Btn variant="glow" data-testid="bill-visit" onClick={() => startBill(a)}>Create bill</Btn>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <h2 className="text-xl">Bills</h2>
          <Btn variant="glow" data-testid="new-bill" onClick={() => startBill(null)}>+ New bill</Btn>
        </div>
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <div role="group" aria-label="Show" className="flex gap-1">
            {([['today', 'Today'], ['due', 'Balance due'], ['all', 'All']] as const).map(([k, label]) => (
              <Btn key={k} variant={filter === k ? 'primary' : 'default'} aria-pressed={filter === k} data-testid={`bills-${k}`} onClick={() => setFilter(k)}>{label}</Btn>
            ))}
          </div>
          <label className="block flex-1 min-w-[12rem]"><span className="sr-only">Search bills</span>
            <input className={inputCls} data-testid="bills-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by patient, hospital number or bill number" /></label>
        </div>
        {shown.length === 0 && <p className="text-sm text-ink-soft">No bills here.</p>}
        <ul className="space-y-2">
          {shown.map((b) => {
            const p = patients.find((x) => x.id === b.patient_id);
            const st = BILL_STATUS[b.status];
            const due = balance(b);
            return (
              <li key={b.id} className="rounded-lg bg-surface-2 px-3 py-2" data-testid="bill-row">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{b.number} · {p?.name ?? 'Unknown'}</span>
                    <span className="block text-[13px] text-ink-soft">{when(b.created_at)} · {b.items.map((it) => it.description).join(', ')}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-right">
                      <span className="block text-sm font-semibold text-ink">{money(b.total)}</span>
                      {due > 0 && <span className="block text-[13px] text-gate">due {money(due)}</span>}
                    </span>
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Btn variant="default" data-testid="open-receipt" onClick={() => setReceipt(b)}>Receipt</Btn>
                  {due > 0 && <Btn variant="primary" data-testid="take-payment" onClick={() => setPaying(b)}>Take payment</Btn>}
                  {b.status !== 'void' && <Btn variant="danger" data-testid="void-bill" onClick={() => setVoiding(b)}>Void</Btn>}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {receipt && <Receipt bill={bills.find((b) => b.id === receipt.id) ?? receipt} onClose={() => setReceipt(null)} />}
      {paying && <PaymentModal bill={paying} onClose={() => setPaying(null)} />}
      {voiding && <VoidModal bill={voiding} onClose={() => setVoiding(null)} />}
    </>
  );
}
