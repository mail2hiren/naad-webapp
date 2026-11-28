import { useMemo, useState } from 'react';
import { Btn, Card, Field, inputCls } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { useClinic } from '../../context/ClinicContext';
import { useCashClosings } from '../../hooks/useDesk';
import { clinicNow, clinicToday, dayKey, money } from '../../lib/schedule';
import { cashForDay, expectedCash } from '../../lib/desk';
import { closeCash, refundBill } from '../../lib/deskActions';
import type { BillRow, PaymentMethod } from '../../types/db';
import { Stat } from './common';
import { fmtDay } from './labels';

const NOTES = [500, 200, 100, 50, 20, 10, 5, 2, 1];
const METHOD: Record<PaymentMethod, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', insurance: 'Insurance' };

/**
 * Day-end cash closing: what came in today by payment method, refunds, the
 * cash that should be in the drawer, a note-by-note count, the difference,
 * and a signed closing that nobody can change afterwards. Refunds are given here.
 */
export function CashClosingSection({ bills }: { bills: BillRow[] }) {
  const { orgId, patients, pushToast, logAudit } = useClinic();
  const { practitioner: me } = useAuth();
  const closings = useCashClosings(orgId);
  const [day, setDay] = useState(clinicToday());
  const [mineOnly, setMineOnly] = useState(true);
  const [float, setFloat] = useState('0');
  const [count, setCount] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const myName = me?.name ?? '';
  const sum = useMemo(() => cashForDay(bills, day, mineOnly ? myName : null), [bills, day, mineOnly, myName]);
  const counted = NOTES.reduce((s, n) => s + n * (Number(count[n]) || 0), 0);
  const expected = expectedCash(sum, Number(float) || 0);
  const diff = Math.round((counted - expected) * 100) / 100;
  const mineClosed = closings.find((c) => c.day === day && c.closed_by === myName);
  const paidToday = bills.filter((b) => b.status !== 'void' && b.paid > 0 && b.paid_at && dayKey(new Date(b.paid_at)) === day && (!mineOnly || b.created_by === myName))
    .sort((a, b) => (a.paid_at ?? '').localeCompare(b.paid_at ?? ''));

  async function close() {
    setSaving(true);
    const e = await closeCash(orgId, {
      day, by: myName, expectedCash: expected, countedCash: counted, upi: sum.byMethod.upi, card: sum.byMethod.card, insurance: sum.byMethod.insurance,
      refundsCash: sum.refunds.cash, note,
    });
    setSaving(false);
    if (e) { pushToast({ tone: 'critical', title: 'Could not close the day', detail: e }); return; }
    await logAudit('reception-cash-closing', `${fmtDay(day)}: expected ${money(expected)}, counted ${money(counted)}, difference ${money(diff)}`);
    pushToast({ tone: diff === 0 ? 'ok' : 'warning', title: 'Day closed', detail: diff === 0 ? 'Cash matches.' : `Difference ${money(diff)} recorded.` });
  }

  return (
    <div data-testid="cash-closing">
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Day"><input type="date" className={`${inputCls} !w-auto`} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} data-testid="cash-day" /></Field>
          <label className="mb-1 inline-flex items-center gap-2 min-h-11 text-sm text-ink">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} className="w-4 h-4 accent-[var(--accent)]" data-testid="cash-mine" />
            Only bills I made ({myName})
          </label>
          <span className="mb-3 ml-auto"><Btn variant="default" onClick={() => window.print()}>Print</Btn></span>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2" data-testid="cash-by-method">
          {(Object.keys(METHOD) as PaymentMethod[]).map((m) => <Stat key={m} label={METHOD[m]} value={money(sum.byMethod[m])} />)}
          <Stat label="Refunds given" value={money(Object.values(sum.refunds).reduce((s, v) => s + v, 0))} tone={sum.refunds.cash ? 'gate' : undefined} />
        </div>
        <p className="mt-2 text-[13px] text-ink-soft">{sum.bills} payments · net {money(sum.total)}. Card and UPI are checked against the bank; cash is counted below.</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="print-sheet">
          <h2 className="text-base font-semibold text-ink">Count the cash · {fmtDay(day)}</h2>
          <Field label="Opening float (cash kept in the drawer from yesterday)"><input className={inputCls} inputMode="numeric" value={float} onChange={(e) => setFloat(e.target.value)} data-testid="cash-float" /></Field>
          <div className="mt-2 grid grid-cols-3 gap-2" data-testid="cash-count">
            {NOTES.map((n) => (
              <label key={n} className="block">
                <span className="block text-[12px] font-semibold text-ink-soft">₹{n} × </span>
                <input className={`${inputCls} !min-h-9`} inputMode="numeric" value={count[n] ?? ''} onChange={(e) => setCount({ ...count, [n]: e.target.value.replace(/\D/g, '') })} aria-label={`Number of ₹${n}`} data-testid={`note-${n}`} />
              </label>
            ))}
          </div>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
            <dt className="text-ink-soft">Cash taken</dt><dd className="text-right text-ink">{money(sum.byMethod.cash)}</dd>
            <dt className="text-ink-soft">Cash refunded</dt><dd className="text-right text-ink">− {money(sum.refunds.cash)}</dd>
            <dt className="text-ink-soft">Opening float</dt><dd className="text-right text-ink">{money(Number(float) || 0)}</dd>
            <dt className="font-semibold text-ink">Should be in the drawer</dt><dd className="text-right font-semibold text-ink" data-testid="cash-expected">{money(expected)}</dd>
            <dt className="font-semibold text-ink">Counted</dt><dd className="text-right font-semibold text-ink" data-testid="cash-counted">{money(counted)}</dd>
            <dt className="font-semibold text-ink">Difference</dt>
            <dd className={`text-right font-bold ${diff === 0 ? 'text-ok' : 'text-danger'}`} data-testid="cash-diff">{diff === 0 ? 'Matches' : `${diff > 0 ? 'Extra' : 'Short'} ${money(Math.abs(diff))}`}</dd>
          </dl>
          <Field label="Note (explain any difference)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} data-testid="cash-note" /></Field>
          {mineClosed
            ? <p className="mt-3 text-sm font-semibold text-ok" data-testid="cash-closed">Closed by you at {new Date(mineClosed.closed_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}: counted {money(mineClosed.counted_cash)}, difference {money(mineClosed.difference)}.</p>
            : <Btn variant="glow" className="mt-3 no-print" data-testid="cash-close" disabled={saving || !myName || (diff !== 0 && !note.trim())} onClick={close}>Close the day</Btn>}
          {!mineClosed && diff !== 0 && !note.trim() && <p className="mt-1 text-[12px] text-ink-faint no-print">Add a note to close with a difference.</p>}
        </Card>

        <div className="space-y-4">
          <RefundBox bills={bills} />
          <Card>
            <h2 className="text-base font-semibold text-ink">Payments · {fmtDay(day)}</h2>
            <ul className="mt-1 divide-y divide-line max-h-80 overflow-y-auto" data-testid="cash-payments">
              {paidToday.length === 0 && <li className="py-2 text-sm text-ink-soft">No payments.</li>}
              {paidToday.map((b) => (
                <li key={b.id} className="flex justify-between gap-2 py-1.5 text-sm">
                  <span className="min-w-0 truncate text-ink">{b.number} · {patients.find((p) => p.id === b.patient_id)?.name}</span>
                  <span className="whitespace-nowrap text-ink">{METHOD[(b.payment_method ?? 'cash') as PaymentMethod]} {money(b.paid)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="text-base font-semibold text-ink">Closings</h2>
            <ul className="mt-1 divide-y divide-line" data-testid="cash-history">
              {closings.length === 0 && <li className="py-2 text-sm text-ink-soft">No days closed yet.</li>}
              {[...closings].sort((a, b) => b.closed_at.localeCompare(a.closed_at)).slice(0, 14).map((c) => (
                <li key={c.id} className="py-1.5 text-sm">
                  <span className="text-ink font-semibold">{fmtDay(c.day)} · {c.closed_by}</span>
                  <span className={`block text-[13px] ${c.difference === 0 ? 'text-ink-soft' : 'text-danger font-semibold'}`}>Counted {money(c.counted_cash)} of {money(c.expected_cash)}{c.difference ? ` · difference ${money(c.difference)}` : ' · matched'}{c.note ? ` · ${c.note}` : ''}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RefundBox({ bills }: { bills: BillRow[] }) {
  const { patients, pushToast, logAudit } = useClinic();
  const [q, setQ] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const bill = bills.find((b) => b.number.toLowerCase() === q.trim().toLowerCase());
  const refunded = (bill as (BillRow & { refunded?: number }) | undefined)?.refunded ?? 0;
  const max = bill ? Math.round((bill.paid - refunded) * 100) / 100 : 0;
  async function save() {
    if (!bill) return;
    setSaving(true);
    const e = await refundBill(bill, Number(amount), method, reason, clinicNow());
    setSaving(false);
    if (e) { pushToast({ tone: 'critical', title: 'Could not refund', detail: e }); return; }
    await logAudit('reception-refund', `${bill.number}: ${money(Number(amount))} by ${method}, ${reason}`);
    pushToast({ tone: 'ok', title: 'Refund recorded', detail: `${bill.number} · ${money(Number(amount))}` });
    setQ(''); setAmount(''); setReason('');
  }
  return (
    <Card data-testid="refund-box">
      <h2 className="text-base font-semibold text-ink">Give a refund</h2>
      <Field label="Receipt number"><input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. R-01003" data-testid="refund-bill" /></Field>
      {q.trim() && !bill && <p className="text-[13px] text-ink-soft">No bill with that number.</p>}
      {bill && (
        <>
          <p className="mt-1 text-[13px] text-ink-soft">{patients.find((p) => p.id === bill.patient_id)?.name} · paid {money(bill.paid)}{refunded ? ` · already refunded ${money(refunded)}` : ''} · up to {money(max)}</p>
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="Amount"><input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="refund-amount" /></Field>
            <Field label="Given back by">
              <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {(Object.keys(METHOD) as PaymentMethod[]).filter((m) => m !== 'insurance').map((m) => <option key={m} value={m}>{METHOD[m]}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Reason"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Test not done, paid twice" data-testid="refund-reason" /></Field>
          <Btn variant="danger" className="mt-2" data-testid="refund-save" disabled={saving || !(Number(amount) > 0) || Number(amount) > max || !reason.trim()} onClick={save}>Record refund</Btn>
        </>
      )}
    </Card>
  );
}
