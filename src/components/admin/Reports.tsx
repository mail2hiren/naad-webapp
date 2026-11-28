import { Fragment, useMemo, useState } from 'react';
import { Btn, Card, SectionHead, StatTile, inputCls } from '../ui';
import { useClinic } from '../../context/ClinicContext';
import { useClinicians } from '../../hooks/useClinicians';
import { useBeds } from '../../hooks/useHospitalSetup';
import { addDays, apptStart, balance, clinicToday, dayKey, dayLabel, money } from '../../lib/schedule';
import { downloadCsv } from '../../lib/csv';
import type { BillRow, PaymentMethod } from '../../types/db';

type Period = 'today' | '7d' | 'month' | 'custom';
const METHOD: Record<PaymentMethod, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', insurance: 'Insurance' };

/** Pure numbers for a date range: visits per doctor, money in and owed,
 * busiest charges, beds and pharmacy. Everything is downloadable as CSV. */
export function ReportsSection({ bills }: { bills: BillRow[] }) {
  const { orgId, appointments, pharmacyOrders, patients } = useClinic();
  const clinicians = useClinicians();
  const { beds } = useBeds(orgId);
  const today = clinicToday();
  const [period, setPeriod] = useState<Period>('7d');
  const [custom, setCustom] = useState({ from: addDays(today, -30), to: today });
  const [from, to] = period === 'today' ? [today, today]
    : period === '7d' ? [addDays(today, -6), today]
      : period === 'month' ? [`${today.slice(0, 8)}01`, today]
        : [custom.from, custom.to];
  const inRange = (iso: string | null | undefined) => { if (!iso) return false; const d = dayKey(new Date(iso)); return d >= from && d <= to; };

  const visits = useMemo(() => appointments.filter((a) => { const s = apptStart(a); return s && inRange(s.toISOString()); }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appointments, from, to]);
  const perDoctor = clinicians.map((c) => {
    const mine = visits.filter((a) => a.practitioner_id === c.id);
    const n = (s: string) => mine.filter((a) => a.status === s).length;
    const billed = bills.filter((b) => b.status !== 'void' && inRange(b.created_at) && mine.some((a) => a.id === b.appointment_id)).reduce((s, b) => s + b.total, 0);
    const due = n('completed') + n('no_show');
    return { name: c.name, booked: mine.length, seen: n('completed'), waiting: n('checked_in'), noShow: n('no_show'), cancelled: n('cancelled'),
      noShowRate: due ? Math.round((n('no_show') / due) * 100) : 0, billed };
  });

  const rangeBills = bills.filter((b) => b.status !== 'void' && inRange(b.created_at));
  const billed = rangeBills.reduce((s, b) => s + b.total, 0);
  const discounts = rangeBills.reduce((s, b) => s + b.discount, 0);
  const collected = bills.filter((b) => b.status !== 'void' && inRange(b.paid_at)).reduce((s, b) => s + b.paid, 0);
  const owed = bills.reduce((s, b) => s + balance(b), 0);
  const byMethod = (Object.keys(METHOD) as PaymentMethod[]).map((m) => [m, bills.filter((b) => b.status !== 'void' && b.payment_method === m && inRange(b.paid_at)).reduce((s, b) => s + b.paid, 0)] as const);
  const items = new Map<string, { qty: number; amount: number }>();
  rangeBills.forEach((b) => b.items.forEach((it) => {
    const cur = items.get(it.description) ?? { qty: 0, amount: 0 };
    items.set(it.description, { qty: cur.qty + it.qty, amount: cur.amount + it.qty * it.rate });
  }));
  const topItems = [...items.entries()].sort((a, b) => b[1].amount - a[1].amount).slice(0, 8);
  const maxItem = topItems[0]?.[1].amount ?? 0;
  const owing = bills.filter((b) => balance(b) > 0).sort((a, b) => balance(b) - balance(a));
  const activeBeds = beds.filter((b) => b.active);
  const dispensed = pharmacyOrders.filter((o) => o.status === 'collected' && inRange(o.updated_at)).length;
  const patientName = (id: string) => patients.find((p) => p.id === id)?.name ?? 'Unknown';
  const label = from === to ? dayLabel(from) : `${dayLabel(from)} to ${dayLabel(to)}`;

  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <div role="group" aria-label="Period" className="flex flex-wrap gap-1">
            {([['today', 'Today'], ['7d', 'Last 7 days'], ['month', 'This month'], ['custom', 'Choose dates']] as const).map(([k, l]) => (
              <Btn key={k} variant={period === k ? 'primary' : 'default'} aria-pressed={period === k} data-testid={`period-${k}`} onClick={() => setPeriod(k)}>{l}</Btn>
            ))}
          </div>
          {period === 'custom' && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm text-ink-soft">From <input type="date" className={inputCls} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
              <label className="text-sm text-ink-soft">To <input type="date" className={inputCls} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
            </div>
          )}
        </div>
        <h2 className="mt-3 text-lg" data-testid="report-range">{label}</h2>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatTile label="Visits seen" value={perDoctor.reduce((s, d) => s + d.seen, 0)} />
          <StatTile label="Billed" value={money(billed)} tone="accent" />
          <StatTile label="Collected" value={money(collected)} tone="ok" />
          <StatTile label="Balance due (all time)" value={money(owed)} tone="danger" />
        </div>
      </Card>

      <Card className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <SectionHead title="Visits by doctor" desc="Booked in the period, and what happened to them." />
          <Btn variant="default" data-testid="csv-visits" onClick={() => downloadCsv(`naad-visits-${from}-to-${to}.csv`,
            ['Doctor', 'Booked', 'Seen', 'Waiting', 'No-show', 'Cancelled', 'No-show %', 'Billed (INR)'],
            perDoctor.map((d) => [d.name, d.booked, d.seen, d.waiting, d.noShow, d.cancelled, d.noShowRate, d.billed]))}>Download CSV</Btn>
        </div>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Visits by doctor, scrolls sideways">
          <table className="w-full text-sm" data-testid="visits-table">
            <thead><tr className="text-left text-ink-soft border-b border-line">
              <th className="py-2 pr-3 font-semibold">Doctor</th><th className="py-2 px-2 font-semibold text-right">Booked</th><th className="py-2 px-2 font-semibold text-right">Seen</th>
              <th className="py-2 px-2 font-semibold text-right">No-show</th><th className="py-2 px-2 font-semibold text-right">Cancelled</th><th className="py-2 pl-2 font-semibold text-right">Billed</th>
            </tr></thead>
            <tbody>
              {perDoctor.map((d) => (
                <tr key={d.name} className="border-b border-line">
                  <td className="py-2 pr-3 text-ink">{d.name}</td><td className="py-2 px-2 text-right">{d.booked}</td><td className="py-2 px-2 text-right">{d.seen}</td>
                  <td className="py-2 px-2 text-right">{d.noShow}{d.noShow ? ` (${d.noShowRate}%)` : ''}</td><td className="py-2 px-2 text-right">{d.cancelled}</td>
                  <td className="py-2 pl-2 text-right">{money(d.billed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Card>
          <SectionHead title="Money" desc="Bills raised in the period, and payments taken in it." />
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
            <dt className="text-ink-soft">Bills raised</dt><dd className="text-right">{rangeBills.length}</dd>
            <dt className="text-ink-soft">Billed</dt><dd className="text-right">{money(billed)}</dd>
            <dt className="text-ink-soft">Discounts given</dt><dd className="text-right">{money(discounts)}</dd>
            {byMethod.map(([m, v]) => <Fragment key={m}><dt className="text-ink-soft">Collected by {METHOD[m]}</dt><dd className="text-right">{money(v)}</dd></Fragment>)}
            <dt className="font-semibold text-ink">Collected</dt><dd className="text-right font-semibold text-ink">{money(collected)}</dd>
          </dl>
          <Btn variant="default" className="mt-3" data-testid="csv-bills" onClick={() => downloadCsv(`naad-bills-${from}-to-${to}.csv`,
            ['Bill', 'Date', 'Patient', 'Items', 'Subtotal', 'Discount', 'Total', 'Paid', 'Balance', 'Method', 'Status'],
            bills.filter((b) => inRange(b.created_at)).map((b) => [b.number, b.created_at.slice(0, 10), patientName(b.patient_id), b.items.map((i) => `${i.qty} x ${i.description}`).join('; '),
              b.subtotal, b.discount, b.total, b.paid, balance(b), b.payment_method ?? '', b.status]))}>Download bills CSV</Btn>
        </Card>
        <Card>
          <SectionHead title="Top charges" desc="What the hospital billed most for in the period." />
          {topItems.length === 0 && <p className="text-sm text-ink-soft">No bills in this period.</p>}
          <ul className="space-y-2">
            {topItems.map(([name, v]) => (
              <li key={name} className="text-sm">
                <div className="flex justify-between gap-2"><span className="text-ink truncate">{name}</span><span className="text-ink-soft whitespace-nowrap">{v.qty} · {money(v.amount)}</span></div>
                <div className="mt-1 h-2 rounded-full bg-surface-2" aria-hidden="true"><div className="h-2 rounded-full bg-accent" style={{ width: `${maxItem ? (v.amount / maxItem) * 100 : 0}%` }} /></div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <SectionHead title="Who owes money" desc="Every bill with a balance, largest first." />
          {owing.length === 0 && <p className="text-sm text-ink-soft">Nothing outstanding.</p>}
          <ul className="divide-y divide-line" data-testid="owing-list">
            {owing.slice(0, 10).map((b) => (
              <li key={b.id} className="py-2 flex justify-between gap-2 text-sm">
                <span className="text-ink">{patientName(b.patient_id)} · {b.number}</span><span className="font-semibold text-gate">{money(balance(b))}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <SectionHead title="Beds and pharmacy" />
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
            <dt className="text-ink-soft">Beds occupied now</dt><dd className="text-right">{activeBeds.filter((b) => b.patient_id).length} of {activeBeds.length}</dd>
            <dt className="text-ink-soft">Prescriptions dispensed in the period</dt><dd className="text-right">{dispensed}</dd>
            <dt className="text-ink-soft">Pharmacy orders waiting now</dt><dd className="text-right">{pharmacyOrders.filter((o) => ['received', 'preparing', 'ready'].includes(o.status)).length}</dd>
          </dl>
        </Card>
      </div>
    </>
  );
}
