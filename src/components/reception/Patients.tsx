import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Btn, Card, Field, Modal, Pill, inputCls } from '../ui';
import { useClinic } from '../../context/ClinicContext';
import { PatientLine, PatientPicker } from './PatientPicker';
import { PatientRecord } from './PatientRecord';
import { checkIn, searchPatients } from '../../lib/frontDesk';
import { STATUS_LABEL, STATUS_TONE, apptStart, balance, clinicNow, clinicToday, money, onDay, timeLabel } from '../../lib/schedule';
import { waitMinutes } from '../../lib/calendar';
import type { AppointmentRow, BillRow, PatientRow } from '../../types/db';

type ListFilter = 'today' | 'all' | 'owes';

/**
 * Patients: today's patients first, each with their booking and a one-tap
 * check-in; search everyone; open the full record (also straight from the
 * calendar with ?patient=).
 */
export function PatientsSection({
  bills, onBook, onBill, onBillAppt, onReceipt,
}: { bills: BillRow[]; onBook: (p: PatientRow) => void; onBill: (p: PatientRow) => void; onBillAppt: (a: AppointmentRow) => void; onReceipt: (b: BillRow) => void }) {
  const { patients, appointments, practitioners, pushToast, logAudit } = useClinic();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<ListFilter>('today');
  const [busy, setBusy] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const openId = params.get('patient');
  const fromCalendar = params.get('from') === 'calendar';
  const setOpenId = (id: string | null) => {
    const n = new URLSearchParams(params);
    if (id) n.set('patient', id); else { n.delete('patient'); n.delete('from'); }
    setParams(n);
  };
  const [adding, setAdding] = useState(false);
  const today = clinicToday();
  const now = clinicNow();
  const todayAppt = useMemo(() => {
    const m = new Map<string, AppointmentRow>();
    appointments.filter((a) => onDay(a, today) && a.status !== 'cancelled')
      .sort((a, b) => (apptStart(a)?.getTime() ?? 0) - (apptStart(b)?.getTime() ?? 0))
      .forEach((a) => { const cur = m.get(a.patient_id); if (!cur || cur.status === 'completed' || cur.status === 'no_show') m.set(a.patient_id, a); });
    return m;
  }, [appointments, today]);
  const owedOf = (id: string) => bills.filter((b) => b.patient_id === id).reduce((s, b) => s + balance(b), 0);
  const list = useMemo(() => {
    if (q.trim()) return searchPatients(patients, q);
    if (filter === 'today') return patients.filter((p) => todayAppt.has(p.id)).sort((a, b) => (apptStart(todayAppt.get(a.id)!)?.getTime() ?? 0) - (apptStart(todayAppt.get(b.id)!)?.getTime() ?? 0));
    if (filter === 'owes') return patients.filter((p) => owedOf(p.id) > 0).sort((a, b) => owedOf(b.id) - owedOf(a.id));
    return [...patients].sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patients, q, filter, todayAppt, bills]);
  const open = openId ? patients.find((p) => p.id === openId) ?? null : null;

  async function doCheckIn(p: PatientRow, a: AppointmentRow) {
    setBusy(a.id);
    const { token, error } = await checkIn(a, appointments, p, clinicNow());
    setBusy(null);
    const doc = practitioners.find((d) => d.id === a.practitioner_id)?.name ?? 'the doctor';
    if (error) { pushToast({ tone: 'critical', title: 'Could not check in', detail: error }); return; }
    await logAudit('reception-check-in', `${p.name} with ${doc}, token ${token ?? '-'}`);
    pushToast({ tone: 'ok', title: token ? `Checked in · Token ${token}` : 'Checked in', detail: `${p.name} is waiting for ${doc}` });
  }

  if (open) {
    return (
      <PatientRecord patient={open} bills={bills} backLabel={fromCalendar ? 'Back to calendar' : 'All patients'}
        onBack={() => (fromCalendar ? setParams({ section: 'calendar' }) : setOpenId(null))}
        onBook={onBook} onBill={onBill} onBillAppt={onBillAppt} onReceipt={onReceipt} />
    );
  }

  const counts = { today: todayAppt.size, all: patients.length, owes: patients.filter((p) => owedOf(p.id) > 0).length };

  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[14rem]">
            <Field label="Search patients (name, mobile or hospital number)">
              <input data-testid="patients-search" className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
            </Field>
          </div>
          <div className="mb-0.5"><Btn variant="glow" data-testid="register-new" onClick={() => setAdding(true)}>+ Register new patient</Btn></div>
        </div>
        {!q.trim() && (
          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Show">
            {([['today', "Today's patients"], ['all', 'All patients'], ['owes', 'Owe money']] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={filter === k} data-testid={`pt-filter-${k}`} onClick={() => setFilter(k)}
                className={`min-h-11 rounded-full border px-3.5 text-sm font-semibold ${filter === k ? 'bg-accent text-on-accent border-accent' : 'border-line-strong text-ink-soft hover:bg-hover'}`}>{l} ({counts[k]})</button>
            ))}
          </div>
        )}
        <ul className="mt-2 divide-y divide-line">
          {list.length === 0 && <li className="py-3 text-sm text-ink-soft">{q.trim() ? 'No patient found.' : filter === 'today' ? 'No patients booked today.' : 'Nobody here.'}</li>}
          {list.map((p) => {
            const due = owedOf(p.id);
            const a = todayAppt.get(p.id);
            const doc = a ? practitioners.find((d) => d.id === a.practitioner_id)?.name : null;
            const w = a ? waitMinutes(a, now) : null;
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-1" data-testid="patient-item">
                <button type="button" data-testid="patient-row" onClick={() => setOpenId(p.id)} className="flex-1 min-w-[14rem] min-h-11 py-1.5 px-1 flex items-center justify-between gap-3 text-left hover:bg-hover rounded-lg">
                  <PatientLine p={p} />
                  <span className="text-right">
                    {a && <span className="block text-[13px] text-ink whitespace-nowrap">{timeLabel(apptStart(a)!)} · {doc}{a.token_no ? ` · Token ${a.token_no}` : ''}</span>}
                    {a && <span className="block text-[12px] whitespace-nowrap"><Pill tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}{a.status === 'checked_in' && w != null ? ` ${w} min` : ''}</Pill></span>}
                    {due > 0 && <span className="block text-[13px] font-semibold text-gate whitespace-nowrap">Due {money(due)}</span>}
                  </span>
                </button>
                {a?.status === 'scheduled' && <Btn variant="glow" data-testid="list-check-in" disabled={busy === a.id} onClick={() => doCheckIn(p, a)}>Check in</Btn>}
                {a?.status === 'requested' && <span className="text-[12px] font-semibold text-gate px-2">To confirm in the calendar</span>}
              </li>
            );
          })}
        </ul>
      </Card>

      {adding && (
        <Modal onClose={() => setAdding(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="reg-title">
            <h2 id="reg-title" className="text-lg mb-3">Register a patient</h2>
            <PatientPicker value={null} onChange={(p) => { if (p) { setAdding(false); setOpenId(p.id); } }} />
          </div>
        </Modal>
      )}
    </>
  );
}
