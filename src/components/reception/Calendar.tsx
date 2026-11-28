import { useMemo, useState } from 'react';
import { Btn, Card, Field, Modal, Pill, StatTile, inputCls } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { useClinic } from '../../context/ClinicContext';
import { PatientPicker } from './PatientPicker';
import {
  STATUS_LABEL, STATUS_TONE, VISIT_LABEL, addDays, apptStart, clinicNow, clinicToday, dayKey, dayLabel, freeSlots, holdsSlot,
  onDay, slotLength, slotsFor, timeLabel,
} from '../../lib/schedule';
import { useClinicians } from '../../hooks/useClinicians';
import { bookAppointment, checkIn, reschedule, setStatus } from '../../lib/frontDesk';
import type { AppointmentRow, AppointmentStatus, BillRow, PatientRow, PractitionerRow, VisitType } from '../../types/db';

/** Doctor calendar: one column per doctor for the chosen day, every slot
 * either free (tap to book) or showing who is booked and where they are. */
export function CalendarSection({ bills, onBill }: { bills: BillRow[]; onBill: (a: AppointmentRow) => void }) {
  const { appointments, patients } = useClinic();
  const clinicians = useClinicians();
  const [day, setDay] = useState(clinicToday());
  const [who, setWho] = useState('all');
  const [booking, setBooking] = useState<BookingInit | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const now = clinicNow();
  const shown = who === 'all' ? clinicians : clinicians.filter((c) => c.id === who);
  const dayAppts = useMemo(() => appointments.filter((a) => onDay(a, day)), [appointments, day]);
  const open = openId ? appointments.find((a) => a.id === openId) ?? null : null;

  const count = (s: AppointmentStatus) => dayAppts.filter((a) => a.status === s && shown.some((c) => c.id === a.practitioner_id)).length;
  const freeLeft = shown.reduce((n, c) => n + freeSlots(c, day, appointments, now).length, 0);

  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-1">
            <Btn variant="default" aria-label="Previous day" data-testid="cal-prev" onClick={() => setDay(addDays(day, -1))}>‹</Btn>
            <Btn variant={day === clinicToday() ? 'primary' : 'default'} data-testid="cal-today" onClick={() => setDay(clinicToday())}>Today</Btn>
            <Btn variant="default" aria-label="Next day" data-testid="cal-next" onClick={() => setDay(addDays(day, 1))}>›</Btn>
          </div>
          <label className="block">
            <span className="sr-only">Date</span>
            <input type="date" data-testid="cal-date" className={inputCls} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </label>
          <label className="block">
            <span className="sr-only">Doctor</span>
            <select data-testid="cal-who" className={inputCls} value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="all">All doctors</option>
              {clinicians.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="ml-auto">
            <Btn variant="glow" data-testid="book-new" onClick={() => setBooking({ practitionerId: shown[0]?.id, day })}>+ Book appointment</Btn>
          </div>
        </div>
        <h2 className="mt-4 text-lg" data-testid="cal-day-label">{dayLabel(day)}</h2>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
          <StatTile label="Booked" value={count('scheduled') + count('requested')} />
          <StatTile label="Checked in" value={count('checked_in')} tone="ok" />
          <StatTile label="Seen" value={count('completed')} />
          <StatTile label="No-shows" value={count('no_show')} tone="danger" />
          <StatTile label="Free slots left" value={freeLeft} tone="accent" />
        </div>
      </Card>

      {shown.length > 1 && <p className="sm:hidden mb-2 text-[13px] text-ink-soft">Swipe sideways to see every doctor, or pick one above.</p>}
      <div className="relative overflow-x-auto pb-2 -mx-1 px-1" data-testid="calendar">
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(260px, 1fr))` }}>
          {shown.map((c) => (
            <DoctorColumn key={c.id} doctor={c} day={day} now={now} appts={dayAppts.filter((a) => a.practitioner_id === c.id)}
              patients={patients} bills={bills}
              onFree={(start) => setBooking({ practitionerId: c.id, day, start })} onOpen={setOpenId} />
          ))}
        </div>
      </div>

      {booking && <BookingModal init={booking} onClose={() => setBooking(null)} onBooked={(d) => { setDay(d); setBooking(null); }} />}
      {open && <AppointmentModal appt={open} bills={bills} onClose={() => setOpenId(null)} onBill={() => { setOpenId(null); onBill(open); }}
        onRebook={(p) => { setOpenId(null); setBooking({ practitionerId: open.practitioner_id ?? undefined, day, patient: p }); }} />}
    </>
  );
}

function DoctorColumn({
  doctor, day, now, appts, patients, bills, onFree, onOpen,
}: {
  doctor: PractitionerRow; day: string; now: Date; appts: AppointmentRow[]; patients: PatientRow[]; bills: BillRow[];
  onFree: (start: Date) => void; onOpen: (id: string) => void;
}) {
  const slots = slotsFor(doctor, day);
  const len = slotLength(doctor);
  const sorted = [...appts].sort((a, b) => (apptStart(a)?.getTime() ?? 0) - (apptStart(b)?.getTime() ?? 0));
  type Row = { kind: 'free'; start: Date } | { kind: 'appt'; a: AppointmentRow } | { kind: 'break'; label: string };
  const rows: Row[] = [];
  const placed = new Set<string>();
  let lastSession = -1;
  let pastFree = 0;
  slots.forEach((sl, i) => {
    if (sl.session !== lastSession && lastSession !== -1) {
      const prevEnd = new Date(slots[i - 1].start.getTime() + len * 60_000);
      rows.push({ kind: 'break', label: `Break ${timeLabel(prevEnd)} to ${timeLabel(sl.start)}` });
    }
    lastSession = sl.session;
    const s = sl.start.getTime();
    // Appointments starting before this slot that nothing placed yet (off-grid times).
    sorted.filter((a) => !placed.has(a.id) && (apptStart(a)?.getTime() ?? 0) < s).forEach((a) => { placed.add(a.id); rows.push({ kind: 'appt', a }); });
    const here = sorted.filter((a) => !placed.has(a.id) && (apptStart(a)?.getTime() ?? 0) < s + len * 60_000);
    here.forEach((a) => { placed.add(a.id); rows.push({ kind: 'appt', a }); });
    const held = here.some((a) => holdsSlot(a.status))
      || appts.some((a) => holdsSlot(a.status) && (apptStart(a)?.getTime() ?? 0) < s && (apptStart(a)?.getTime() ?? 0) + a.duration_minutes * 60_000 > s);
    if (!held) {
      if (s > now.getTime()) rows.push({ kind: 'free', start: sl.start });
      else pastFree += 1;
    }
  });
  sorted.filter((a) => !placed.has(a.id)).forEach((a) => rows.push({ kind: 'appt', a }));
  const booked = appts.filter((a) => holdsSlot(a.status)).length;

  return (
    <section className="rounded-2xl bg-surface p-3 shadow-[var(--card-shadow)] min-w-0" data-testid="doctor-column" aria-label={`${doctor.name} on ${dayLabel(day)}`}>
      <header className="mb-2 px-1">
        <h3 className="text-base font-semibold text-ink">{doctor.name}</h3>
        <p className="text-[13px] text-ink-soft">{doctor.specialty ?? doctor.title} · {len}-min slots · {booked} booked</p>
      </header>
      {slots.length === 0 && appts.length === 0 && <p className="px-1 py-3 text-sm text-ink-soft">Not working on this day.</p>}
      {pastFree > 0 && <p className="px-1 pb-1 text-[13px] text-ink-faint">{pastFree} earlier slot{pastFree === 1 ? '' : 's'} went unused.</p>}
      <ul className="space-y-1.5">
        {rows.map((r, i) => {
          if (r.kind === 'break') return <li key={`b${i}`} className="px-1 pt-2 pb-1 text-[13px] font-semibold text-ink-faint">{r.label}</li>;
          if (r.kind === 'free') {
            return (
              <li key={`f${r.start.getTime()}`}>
                <button type="button" data-testid="free-slot" onClick={() => onFree(r.start)}
                  className="w-full min-h-11 rounded-lg border border-dashed border-line-strong px-3 py-2 text-left text-sm text-ink-soft hover:bg-hover hover:text-ink">
                  <span className="font-semibold text-ink">{timeLabel(r.start)}</span> · Free
                  <span className="sr-only">, book {doctor.name}</span>
                </button>
              </li>
            );
          }
          const a = r.a;
          const p = patients.find((x) => x.id === a.patient_id);
          const billed = bills.some((b) => b.appointment_id === a.id && b.status !== 'void');
          const gone = a.status === 'cancelled' || a.status === 'no_show';
          return (
            <li key={a.id}>
              <button type="button" data-testid="appt-card" data-status={a.status} onClick={() => onOpen(a.id)}
                className="w-full min-h-11 rounded-lg bg-surface-2 px-3 py-2 text-left hover:bg-hover">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{apptStart(a) ? timeLabel(apptStart(a) as Date) : 'No time'}{a.token_no ? ` · Token ${a.token_no}` : ''}</span>
                  <Pill tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Pill>
                </span>
                <span className={`block text-sm text-ink truncate ${gone ? 'line-through' : ''}`}>{p?.name ?? 'Unknown patient'}</span>
                <span className="block text-[13px] text-ink-soft truncate">
                  {VISIT_LABEL[a.visit_type ?? 'consultation']}{a.reason ? ` · ${a.reason}` : ''}{a.status === 'completed' ? (billed ? ' · Billed' : ' · To bill') : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export interface BookingInit { practitionerId?: string; day: string; start?: Date; patient?: PatientRow | null }

export function BookingModal({ init, onClose, onBooked }: { init: BookingInit; onClose: () => void; onBooked: (day: string) => void }) {
  const { orgId, appointments, pushToast, logAudit } = useClinic();
  const { practitioner: me } = useAuth();
  const clinicians = useClinicians();
  const [patient, setPatient] = useState<PatientRow | null>(init.patient ?? null);
  const [docId, setDocId] = useState(init.practitionerId ?? clinicians[0]?.id ?? '');
  const [day, setDay] = useState(init.start ? dayKey(init.start) : init.day);
  const [time, setTime] = useState(init.start ? String(init.start.getTime()) : '');
  const doc = clinicians.find((c) => c.id === docId);
  const [visit, setVisit] = useState<VisitType>(doc?.role === 'physio' ? 'therapy' : 'consultation');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const free = useMemo(() => (doc ? freeSlots(doc, day, appointments, clinicNow()) : []), [doc, day, appointments]);
  const chosen = free.find((s) => String(s.start.getTime()) === time) ?? null;

  async function save() {
    if (!patient || !doc || !chosen) return;
    setSaving(true);
    const error = await bookAppointment(orgId, appointments, {
      patientId: patient.id, practitioner: doc, start: chosen.start, minutes: chosen.minutes, visitType: visit, reason, bookedBy: me?.name ?? null,
    });
    setSaving(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not book', detail: error }); return; }
    await logAudit('reception-book-appointment', `${patient.name} with ${doc.name}, ${dayLabel(day)} ${timeLabel(chosen.start)}`);
    pushToast({ tone: 'ok', title: 'Appointment booked', detail: `${patient.name} · ${doc.name} · ${timeLabel(chosen.start)}` });
    onBooked(day);
  }

  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="book-title" data-testid="booking-modal">
        <h2 id="book-title" className="text-lg mb-3">Book an appointment</h2>
        <PatientPicker value={patient} onChange={setPatient} />
        <div className="mt-3 grid sm:grid-cols-2 gap-x-3">
          <Field label="Doctor">
            <select data-testid="bk-doctor" className={inputCls} value={docId} onChange={(e) => {
              const d = clinicians.find((c) => c.id === e.target.value);
              setDocId(e.target.value); setTime(''); setVisit(d?.role === 'physio' ? 'therapy' : 'consultation');
            }}>
              {clinicians.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.specialty ?? c.title})</option>)}
            </select>
          </Field>
          <Field label="Date"><input type="date" data-testid="bk-date" className={inputCls} value={day} onChange={(e) => { setDay(e.target.value); setTime(''); }} /></Field>
          <Field label={`Time (${free.length} free)`}>
            <select data-testid="bk-time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)}>
              <option value="">{free.length ? 'Choose a free time' : 'No free time on this day'}</option>
              {free.map((s) => <option key={s.start.getTime()} value={String(s.start.getTime())}>{timeLabel(s.start)}</option>)}
            </select>
          </Field>
          <Field label="Visit">
            <select data-testid="bk-visit" className={inputCls} value={visit} onChange={(e) => setVisit(e.target.value as VisitType)}>
              {(Object.keys(VISIT_LABEL) as VisitType[]).map((v) => <option key={v} value={v}>{VISIT_LABEL[v]}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Reason (optional)"><input data-testid="bk-reason" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Knee pain, review X-ray" /></Field>
        <div className="mt-4 flex gap-2">
          <Btn variant="glow" data-testid="bk-save" disabled={saving || !patient || !chosen} onClick={save}>{saving ? 'Booking…' : 'Book'}</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

function AppointmentModal({
  appt, bills, onClose, onBill, onRebook,
}: { appt: AppointmentRow; bills: BillRow[]; onClose: () => void; onBill: () => void; onRebook: (p: PatientRow | null) => void }) {
  const { appointments, patients, practitioners, pushToast, logAudit } = useClinic();
  const p = patients.find((x) => x.id === appt.patient_id);
  const doc = practitioners.find((x) => x.id === appt.practitioner_id);
  const start = apptStart(appt);
  const [mode, setMode] = useState<'view' | 'reschedule' | 'cancel'>('view');
  const [day, setDay] = useState(start ? dayKey(start) : clinicToday());
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const free = useMemo(() => (doc ? freeSlots(doc, day, appointments, clinicNow(), appt.id) : []), [doc, day, appointments, appt.id]);
  const bill = bills.find((b) => b.appointment_id === appt.id && b.status !== 'void');
  const who = `${p?.name ?? 'Patient'} with ${doc?.name ?? 'doctor'}`;

  async function run(action: () => Promise<string | null>, ok: string, audit: string) {
    setBusy(true);
    const error = await action();
    setBusy(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not update the appointment', detail: error }); return; }
    await logAudit(audit, who);
    pushToast({ tone: 'ok', title: ok, detail: who });
    onClose();
  }

  async function doCheckIn() {
    setBusy(true);
    const { token, error } = await checkIn(appt, appointments, p, clinicNow());
    setBusy(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not check in', detail: error }); return; }
    await logAudit('reception-check-in', `${who}, token ${token ?? '-'}`);
    pushToast({ tone: 'ok', title: token ? `Checked in · Token ${token}` : 'Checked in', detail: `${p?.name ?? ''} is in ${doc?.name ?? 'the doctor'}'s queue` });
    onClose();
  }

  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="appt-title" data-testid="appt-modal">
        <div className="flex items-start justify-between gap-3">
          <h2 id="appt-title" className="text-lg">{p?.name ?? 'Unknown patient'}</h2>
          <Pill tone={STATUS_TONE[appt.status]}>{STATUS_LABEL[appt.status]}</Pill>
        </div>
        {p && <p className="mt-0.5 text-[13px] text-ink-soft">{[p.mrn, p.phone, p.age != null ? `${p.age} y` : null, p.gender].filter(Boolean).join(' · ')}</p>}
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-soft">Doctor</dt><dd className="text-ink">{doc?.name ?? 'Unassigned'}</dd>
          <dt className="text-ink-soft">When</dt><dd className="text-ink">{start ? `${dayLabel(dayKey(start))}, ${timeLabel(start)}` : 'Not set'}</dd>
          <dt className="text-ink-soft">Visit</dt><dd className="text-ink">{VISIT_LABEL[appt.visit_type ?? 'consultation']}{appt.reason ? ` · ${appt.reason}` : ''}</dd>
          {appt.token_no != null && <><dt className="text-ink-soft">Token</dt><dd className="text-ink font-semibold" data-testid="appt-token">{appt.token_no}</dd></>}
          {appt.rescheduled_from && <><dt className="text-ink-soft">Moved from</dt><dd className="text-ink">{new Date(appt.rescheduled_from).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</dd></>}
          {appt.cancel_reason && appt.status === 'cancelled' && <><dt className="text-ink-soft">Reason</dt><dd className="text-ink">{appt.cancel_reason}</dd></>}
          {appt.requested_by_patient && <><dt className="text-ink-soft">Booked by</dt><dd className="text-ink">Patient, from the app</dd></>}
          {bill && <><dt className="text-ink-soft">Bill</dt><dd className="text-ink">{bill.number}</dd></>}
        </dl>

        {mode === 'reschedule' && (
          <div className="mt-4 rounded-lg border border-line p-3" data-testid="reschedule-form">
            <div className="grid sm:grid-cols-2 gap-x-3">
              <Field label="New date"><input type="date" data-testid="rs-date" className={inputCls} value={day} onChange={(e) => { setDay(e.target.value); setTime(''); }} /></Field>
              <Field label={`New time (${free.length} free)`}>
                <select data-testid="rs-time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)}>
                  <option value="">Choose a free time</option>
                  {free.map((s) => <option key={s.start.getTime()} value={String(s.start.getTime())}>{timeLabel(s.start)}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex gap-2">
              <Btn variant="glow" data-testid="rs-save" disabled={busy || !time}
                onClick={() => run(() => reschedule(appt, appointments, new Date(Number(time))), 'Appointment moved', 'reception-reschedule')}>Move appointment</Btn>
              <Btn variant="ghost" onClick={() => setMode('view')}>Back</Btn>
            </div>
          </div>
        )}

        {mode === 'cancel' && (
          <div className="mt-4 rounded-lg border border-line p-3" data-testid="cancel-form">
            <Field label="Why is it cancelled?"><input data-testid="cancel-reason" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Patient called, travelling" /></Field>
            <div className="flex gap-2">
              <Btn variant="danger" data-testid="cancel-confirm" disabled={busy || !reason.trim()}
                onClick={() => run(() => setStatus(appt, 'cancelled', reason.trim()), 'Appointment cancelled', 'reception-cancel')}>Cancel appointment</Btn>
              <Btn variant="ghost" onClick={() => setMode('view')}>Back</Btn>
            </div>
          </div>
        )}

        {mode === 'view' && (
          <div className="mt-5 flex flex-wrap gap-2">
            {appt.status === 'requested' && <>
              <Btn variant="glow" data-testid="confirm-request" disabled={busy} onClick={() => run(() => setStatus(appt, 'scheduled'), 'Request confirmed', 'reception-confirm-request')}>Confirm</Btn>
              <Btn variant="default" onClick={() => setMode('reschedule')}>Offer another time</Btn>
              <Btn variant="danger" onClick={() => setMode('cancel')}>Decline</Btn>
            </>}
            {appt.status === 'scheduled' && <>
              <Btn variant="glow" data-testid="check-in" disabled={busy} onClick={doCheckIn}>Check in</Btn>
              <Btn variant="default" data-testid="reschedule" onClick={() => setMode('reschedule')}>Reschedule</Btn>
              <Btn variant="default" data-testid="no-show" disabled={busy} onClick={() => run(() => setStatus(appt, 'no_show'), 'Marked as no-show', 'reception-no-show')}>No-show</Btn>
              <Btn variant="danger" data-testid="cancel-appt" onClick={() => setMode('cancel')}>Cancel</Btn>
            </>}
            {(appt.status === 'checked_in' || appt.status === 'completed') && !bill && (
              <Btn variant="glow" data-testid="bill-appt" onClick={onBill}>Create bill</Btn>
            )}
            {(appt.status === 'cancelled' || appt.status === 'no_show') && (
              <Btn variant="glow" data-testid="rebook" onClick={() => onRebook(p ?? null)}>Book again</Btn>
            )}
            <Btn variant="ghost" onClick={onClose}>Close</Btn>
          </div>
        )}
      </div>
    </Modal>
  );
}
