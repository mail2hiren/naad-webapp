import { useMemo, useState } from 'react';
import { Btn, Card, Field, Modal, Pill, inputCls } from '../ui';
import { useClinic } from '../../context/ClinicContext';
import { PatientLine, PatientPicker } from './PatientPicker';
import { searchPatients } from '../../lib/frontDesk';
import { STATUS_LABEL, STATUS_TONE, VISIT_LABEL, apptStart, balance, clinicNow, money } from '../../lib/schedule';
import type { BillRow, PatientRow } from '../../types/db';

/** Find any patient, see their visits and bills, and book or bill from there. */
export function PatientsSection({
  bills, onBook, onBill, onReceipt,
}: { bills: BillRow[]; onBook: (p: PatientRow) => void; onBill: (p: PatientRow) => void; onReceipt: (b: BillRow) => void }) {
  const { patients, appointments, practitioners } = useClinic();
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const list = useMemo(() => (q.trim() ? searchPatients(patients, q) : [...patients].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 12)), [patients, q]);
  const open = openId ? patients.find((p) => p.id === openId) ?? null : null;
  const now = clinicNow().getTime();

  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[14rem]">
            <Field label="Search patients (name, mobile or hospital number)">
              <input data-testid="patients-search" className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
            </Field>
          </div>
          <div className="mb-3"><Btn variant="glow" data-testid="register-new" onClick={() => setAdding(true)}>+ Register new patient</Btn></div>
        </div>
        <ul className="divide-y divide-line">
          {list.length === 0 && <li className="py-2 text-sm text-ink-soft">No patient found.</li>}
          {list.map((p) => {
            const due = bills.filter((b) => b.patient_id === p.id).reduce((s, b) => s + balance(b), 0);
            return (
              <li key={p.id}>
                <button type="button" data-testid="patient-row" onClick={() => setOpenId(p.id)} className="w-full min-h-11 py-2 px-1 flex items-center justify-between gap-3 text-left hover:bg-hover rounded-lg">
                  <PatientLine p={p} />
                  {due > 0 && <span className="text-[13px] font-semibold text-gate whitespace-nowrap">Due {money(due)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {!q.trim() && patients.length > list.length && <p className="mt-2 text-[13px] text-ink-faint">Showing {list.length} of {patients.length}. Search to find others.</p>}
      </Card>

      {adding && (
        <Modal onClose={() => setAdding(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="reg-title">
            <h2 id="reg-title" className="text-lg mb-3">Register a patient</h2>
            <PatientPicker value={null} onChange={(p) => { if (p) { setAdding(false); setOpenId(p.id); } }} />
          </div>
        </Modal>
      )}

      {open && (
        <Modal onClose={() => setOpenId(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="pt-title" data-testid="patient-detail">
            <h2 id="pt-title" className="text-lg">{open.name}</h2>
            <PatientLine p={open} />
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn variant="glow" data-testid="pt-book" onClick={() => { setOpenId(null); onBook(open); }}>Book appointment</Btn>
              <Btn variant="default" data-testid="pt-bill" onClick={() => { setOpenId(null); onBill(open); }}>New bill</Btn>
            </div>
            {(() => {
              const visits = appointments.filter((a) => a.patient_id === open.id).sort((a, b) => (apptStart(b)?.getTime() ?? 0) - (apptStart(a)?.getTime() ?? 0));
              const upcoming = visits.filter((a) => (apptStart(a)?.getTime() ?? 0) > now && (a.status === 'scheduled' || a.status === 'requested')).reverse();
              const past = visits.filter((a) => !upcoming.includes(a)).slice(0, 6);
              const theirs = bills.filter((b) => b.patient_id === open.id);
              const line = (id: string) => {
                const a = visits.find((x) => x.id === id)!;
                const s = apptStart(a);
                return (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                    <span className="min-w-0">
                      <span className="block text-ink">{s ? s.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'No time'}</span>
                      <span className="block text-[13px] text-ink-soft truncate">{practitioners.find((d) => d.id === a.practitioner_id)?.name} · {VISIT_LABEL[a.visit_type ?? 'consultation']}</span>
                    </span>
                    <Pill tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Pill>
                  </li>
                );
              };
              return (
                <>
                  <h3 className="mt-4 text-sm font-semibold text-ink-soft">Upcoming</h3>
                  <ul className="divide-y divide-line">{upcoming.length ? upcoming.map((a) => line(a.id)) : <li className="py-1.5 text-sm text-ink-soft">None booked.</li>}</ul>
                  <h3 className="mt-3 text-sm font-semibold text-ink-soft">Recent visits</h3>
                  <ul className="divide-y divide-line">{past.length ? past.map((a) => line(a.id)) : <li className="py-1.5 text-sm text-ink-soft">No visits yet.</li>}</ul>
                  <h3 className="mt-3 text-sm font-semibold text-ink-soft">Bills</h3>
                  <ul className="divide-y divide-line" data-testid="pt-bills">
                    {theirs.length === 0 && <li className="py-1.5 text-sm text-ink-soft">No bills.</li>}
                    {theirs.map((b) => (
                      <li key={b.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                        <span className="min-w-0"><span className="block text-ink">{b.number} · {money(b.total)}</span>
                          <span className="block text-[13px] text-ink-soft">{balance(b) > 0 ? `Due ${money(balance(b))}` : b.status === 'void' ? 'Void' : 'Paid'}</span></span>
                        <Btn variant="default" onClick={() => { setOpenId(null); onReceipt(b); }}>Receipt</Btn>
                      </li>
                    ))}
                  </ul>
                </>
              );
            })()}
            <div className="mt-4"><Btn variant="ghost" onClick={() => setOpenId(null)}>Close</Btn></div>
          </div>
        </Modal>
      )}
    </>
  );
}
