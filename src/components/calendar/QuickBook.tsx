import { useMemo, useState } from 'react';
import { Btn, Field, Modal, inputCls } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { useClinic } from '../../context/ClinicContext';
import { PatientPicker } from '../reception/PatientPicker';
import { useClinicians } from '../../hooks/useClinicians';
import { useCalendarBlocks } from '../../hooks/useCalendarData';
import { VISIT_LABEL, addDays, apptStart, at, clinicNow, dayKey, dayLabel, freeSlots, onDay, timeLabel } from '../../lib/schedule';
import { blockAt, doctorTone, expandRepeat, nextFree, noShowRisk, visitMinutes } from '../../lib/calendar';
import { addToWaitlist, bookAppointment, bookSeries, bookingProblem, newId } from '../../lib/frontDesk';
import type { PatientRow, VisitType, WaitlistRow } from '../../types/db';
import { shortTime } from './shared';

export interface BookingInit { practitionerId?: string; day: string; start?: Date; patient?: PatientRow | null }

const LENGTHS = [10, 15, 20, 30, 45, 60];

/** Book an appointment: patient, doctor, a free time (or the next free across doctors), repeat courses, overbooking, waitlist. */
export function QuickBook({ init, onClose, onBooked }: { init: BookingInit; onClose: () => void; onBooked: (day: string, appointmentId?: string) => void }) {
  const { orgId, appointments, pushToast, logAudit } = useClinic();
  const { practitioner: me } = useAuth();
  const clinicians = useClinicians();
  const { blocks } = useCalendarBlocks(orgId);
  const now = clinicNow();
  const [patient, setPatient] = useState<PatientRow | null>(init.patient ?? null);
  const [docId, setDocId] = useState(init.practitionerId ?? clinicians[0]?.id ?? '');
  const doc = clinicians.find((c) => c.id === docId);
  const [day, setDay] = useState(init.start ? dayKey(init.start) : init.day);
  const [visit, setVisit] = useState<VisitType>(doc?.role === 'physio' ? 'therapy' : 'consultation');
  const [minutes, setMinutes] = useState(doc ? visitMinutes(doc, doc.role === 'physio' ? 'therapy' : 'consultation') : 15);
  const [time, setTime] = useState(init.start ? `${String(init.start.getHours()).padStart(2, '0')}:${String(init.start.getMinutes()).padStart(2, '0')}` : '');
  const [overbook, setOverbook] = useState(false);
  const [reason, setReason] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [every, setEvery] = useState(doc?.role === 'physio' ? 2 : 7);
  const [count, setCount] = useState(6);
  const [skipSun, setSkipSun] = useState(true);
  const [waitlisting, setWaitlisting] = useState(false);
  const [saving, setSaving] = useState(false);

  const free = useMemo(() => (doc ? freeSlots(doc, day, appointments, now).filter((s) => !blockAt(blocks, doc.id, s.start, s.minutes)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, day, appointments, blocks]);
  const suggestions = useMemo(() => nextFree(clinicians.filter((c) => !doc || c.specialty === doc.specialty || c.id === doc.id), appointments, blocks, now, { limit: 4, perDoctor: 2 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clinicians, doc, appointments, blocks]);
  const start = time ? at(day, time) : null;
  const problem = doc && start ? (start.getTime() < now.getTime() - 5 * 60_000 ? 'That time has passed.' : bookingProblem(appointments, blocks, doc, start, minutes, { overbook })) : null;
  const starts = start && repeat ? expandRepeat(start, { everyDays: every, count, skipSundays: skipSun }) : start ? [start] : [];
  const plan = doc ? starts.map((s) => ({ start: s, why: bookingProblem(appointments, blocks, doc, s, minutes, { overbook }) })) : [];
  const risk = patient ? noShowRisk(appointments, patient.id, now) : null;
  const sameDay = patient ? appointments.find((a) => a.patient_id === patient.id && onDay(a, day) && (a.status === 'scheduled' || a.status === 'checked_in' || a.status === 'requested')) : undefined;

  function pickDoctor(id: string) {
    const d = clinicians.find((c) => c.id === id);
    setDocId(id);
    setTime('');
    const v: VisitType = d?.role === 'physio' ? 'therapy' : 'consultation';
    setVisit(v);
    if (d) setMinutes(visitMinutes(d, v));
  }

  async function save() {
    if (!patient || !doc || !start) return;
    setSaving(true);
    const base = { patientId: patient.id, practitioner: doc, start, minutes, visitType: visit, reason, bookedBy: me?.name ?? null, overbook };
    let detail = `${patient.name} · ${doc.name} · ${timeLabel(start)}`;
    const apptId = newId('ap');
    if (repeat) {
      const r = await bookSeries(orgId, appointments, blocks, base, starts);
      setSaving(false);
      if (r.error) { pushToast({ tone: 'critical', title: 'Could not book the course', detail: r.error }); return; }
      if (!r.booked.length) { pushToast({ tone: 'critical', title: 'Nothing booked', detail: r.skipped[0]?.why ?? 'No free times.' }); return; }
      detail = `${r.booked.length} visits booked${r.skipped.length ? `, ${r.skipped.length} skipped (busy or blocked)` : ''}`;
      await logAudit('reception-book-course', `${patient.name} with ${doc.name}, ${r.booked.length} visits from ${dayLabel(day)}`);
      pushToast({ tone: r.skipped.length ? 'warning' : 'ok', title: 'Course booked', detail });
    } else {
      const error = await bookAppointment(orgId, appointments, { ...base, id: apptId }, blocks);
      setSaving(false);
      if (error) { pushToast({ tone: 'critical', title: 'Could not book', detail: error }); return; }
      await logAudit('reception-book-appointment', `${patient.name} with ${doc.name}, ${dayLabel(day)} ${timeLabel(start)}${overbook ? ' (overbooked)' : ''}`);
      pushToast({ tone: 'ok', title: overbook ? 'Appointment booked (overbooked)' : 'Appointment booked', detail });
    }
    onBooked(day, repeat ? undefined : apptId);
  }

  const morning = free.filter((s) => s.start.getHours() < 14);
  const evening = free.filter((s) => s.start.getHours() >= 14);
  const chip = (s: { start: Date }) => {
    const v = `${String(s.start.getHours()).padStart(2, '0')}:${String(s.start.getMinutes()).padStart(2, '0')}`;
    return (
      <button key={v} type="button" role="radio" aria-checked={time === v} onClick={() => setTime(v)} data-testid="bk-slot"
        className={`min-h-11 min-w-16 rounded-lg border px-2 text-[13px] font-semibold ${time === v ? 'bg-accent text-on-accent border-accent' : 'border-line-strong text-ink hover:bg-hover'}`}>{shortTime(s.start)}</button>
    );
  };

  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="book-title" data-testid="booking-modal">
        <h2 id="book-title" className="text-lg mb-3">New appointment</h2>
        <PatientPicker value={patient} onChange={setPatient} />
        {risk?.risk === 'high' && <p className="mt-2 text-[13px] font-semibold text-danger" data-testid="bk-risk">Missed {risk.noShows} of {risk.visits} visits. Confirm by phone the day before.</p>}
        {sameDay && <p className="mt-2 text-[13px] font-semibold text-gate">Already booked this day at {timeLabel(apptStart(sameDay)!)}.</p>}

        <div className="mt-3 grid grid-cols-2 gap-x-3">
          <Field label="Doctor">
            <select data-testid="bk-doctor" className={inputCls} value={docId} onChange={(e) => pickDoctor(e.target.value)}>
              {clinicians.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.specialty ?? c.title})</option>)}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" data-testid="bk-date" className={inputCls} value={day} onChange={(e) => { if (e.target.value) { setDay(e.target.value); setTime(''); } }} />
          </Field>
          <Field label="Visit">
            <select data-testid="bk-visit" className={inputCls} value={visit} onChange={(e) => { const v = e.target.value as VisitType; setVisit(v); if (doc) setMinutes(visitMinutes(doc, v)); }}>
              {(Object.keys(VISIT_LABEL) as VisitType[]).map((v) => <option key={v} value={v}>{VISIT_LABEL[v]}</option>)}
            </select>
          </Field>
          <Field label="Length">
            <select data-testid="bk-length" className={inputCls} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[...new Set([...LENGTHS, minutes])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </Field>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-ink-soft">{free.length ? `${free.length} free on ${new Date(at(day, '12:00')).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}` : 'No free time on this day'}</span>
            <span className="flex gap-1">
              <Btn variant="ghost" className="!min-h-9" aria-label="Previous day" onClick={() => { setDay(addDays(day, -1)); setTime(''); }}>‹</Btn>
              <Btn variant="ghost" className="!min-h-9" aria-label="Next day" onClick={() => { setDay(addDays(day, 1)); setTime(''); }}>›</Btn>
            </span>
          </div>
          <div role="radiogroup" aria-label="Free times" data-testid="bk-time" className="mt-1 max-h-44 overflow-y-auto space-y-1.5">
            {morning.length > 0 && <div className="flex flex-wrap gap-1.5"><span className="w-full text-[12px] text-ink-faint">Morning</span>{morning.map(chip)}</div>}
            {evening.length > 0 && <div className="flex flex-wrap gap-1.5"><span className="w-full text-[12px] text-ink-faint">Evening</span>{evening.map(chip)}</div>}
          </div>
          {free.length === 0 && suggestions.length > 0 && (
            <div className="mt-2" data-testid="bk-suggest">
              <span className="text-[12px] font-semibold text-ink-soft">Next available</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button key={`${s.doctor.id}${s.start.getTime()}`} type="button" onClick={() => { pickDoctor(s.doctor.id); setDay(dayKey(s.start)); setTime(`${String(s.start.getHours()).padStart(2, '0')}:${String(s.start.getMinutes()).padStart(2, '0')}`); }}
                    className="min-h-11 rounded-lg border border-line-strong px-2 text-left text-[12px] hover:bg-hover">
                    <span className="flex items-center gap-1 font-semibold text-ink"><span aria-hidden="true" className="w-2 h-2 rounded-full" style={{ background: doctorTone(clinicians.indexOf(s.doctor)) }} />{s.doctor.name}</span>
                    <span className="block text-ink-soft">{s.start.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}, {shortTime(s.start)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="inline-flex items-center gap-2 min-h-11 text-sm text-ink">
              <input type="checkbox" data-testid="bk-overbook" checked={overbook} onChange={(e) => setOverbook(e.target.checked)} className="w-4 h-4 accent-[var(--accent)]" />
              Overbook (any time, even if taken)
            </label>
            {(overbook || (time && !free.some((s) => dayKey(s.start) === day && `${String(s.start.getHours()).padStart(2, '0')}:${String(s.start.getMinutes()).padStart(2, '0')}` === time))) && (
              <label className="block"><span className="sr-only">Time</span>
                <input type="time" step={300} data-testid="bk-custom-time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
            )}
          </div>
          {problem && <p className="mt-1 text-[13px] font-semibold text-danger" data-testid="bk-problem" role="alert">{problem}</p>}
        </div>

        <Field label="Reason (optional)">
          <input data-testid="bk-reason" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={doc?.role === 'physio' ? 'e.g. Knee rehab, session 3' : 'e.g. Knee pain, review X-ray'} />
        </Field>

        <div className="mt-3 rounded-xl border border-line p-3">
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink min-h-9">
            <input type="checkbox" data-testid="bk-repeat" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="w-4 h-4 accent-[var(--accent)]" />
            Repeat as a course of visits
          </label>
          {repeat && (
            <>
              <div className="grid grid-cols-3 gap-x-2">
                <Field label="Every">
                  <select data-testid="bk-every" className={inputCls} value={every} onChange={(e) => setEvery(Number(e.target.value))}>
                    {[1, 2, 3, 7, 14].map((n) => <option key={n} value={n}>{n === 1 ? 'Day' : n === 7 ? 'Week' : n === 14 ? '2 weeks' : `${n} days`}</option>)}
                  </select>
                </Field>
                <Field label="Visits">
                  <input type="number" min={2} max={24} data-testid="bk-count" className={inputCls} value={count} onChange={(e) => setCount(Math.max(2, Math.min(24, Number(e.target.value) || 2)))} />
                </Field>
                <label className="mt-8 inline-flex items-center gap-1.5 text-[13px] text-ink">
                  <input type="checkbox" checked={skipSun} onChange={(e) => setSkipSun(e.target.checked)} className="w-4 h-4 accent-[var(--accent)]" /> Skip Sundays
                </label>
              </div>
              {start && (
                <ul className="mt-2 grid grid-cols-2 gap-1 text-[12px]" data-testid="bk-plan">
                  {plan.map((x) => (
                    <li key={x.start.getTime()} className={x.why ? 'text-danger' : 'text-ink'} title={x.why ?? ''}>
                      {x.why ? '✕' : '✓'} {x.start.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}, {shortTime(x.start)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {waitlisting && patient && <WaitlistForm patient={patient} doctorId={docId} day={day} visit={visit} onDone={onClose} />}

        <div className="mt-4 flex flex-wrap gap-2">
          <Btn variant="glow" data-testid="bk-save" disabled={saving || !patient || !doc || !start || (!repeat && !!problem) || (repeat && !plan.some((x) => !x.why))} onClick={save}>
            {saving ? 'Booking…' : repeat ? `Book ${plan.filter((x) => !x.why).length} visits` : 'Book'}
          </Btn>
          {patient && !waitlisting && <Btn variant="default" data-testid="bk-waitlist" onClick={() => setWaitlisting(true)}>Add to waitlist</Btn>}
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

function WaitlistForm({ patient, doctorId, day, visit, onDone }: { patient: PatientRow; doctorId: string; day: string; visit: VisitType; onDone: () => void }) {
  const { orgId, pushToast, logAudit } = useClinic();
  const { practitioner: me } = useAuth();
  const clinicians = useClinicians();
  const [doc, setDoc] = useState(doctorId);
  const [from, setFrom] = useState(day);
  const [to, setTo] = useState(addDays(day, 7));
  const [part, setPart] = useState<WaitlistRow['part_of_day']>('any');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const error = await addToWaitlist(orgId, { patient_id: patient.id, practitioner_id: doc || null, from_day: from, to_day: to, part_of_day: part, visit_type: visit, note, created_by: me?.name ?? null });
    setSaving(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not add to the waitlist', detail: error }); return; }
    await logAudit('reception-waitlist-add', `${patient.name}, ${from} to ${to}`);
    pushToast({ tone: 'ok', title: 'Added to the waitlist', detail: `${patient.name} will be offered the first matching cancellation.` });
    onDone();
  }
  return (
    <div className="mt-3 rounded-xl border border-accent p-3" data-testid="waitlist-form">
      <h3 className="text-sm font-semibold text-ink">Waitlist {patient.name}</h3>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Doctor">
          <select className={inputCls} value={doc} onChange={(e) => setDoc(e.target.value)} data-testid="wl-doctor">
            <option value="">Any doctor</option>
            {clinicians.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Time of day">
          <select className={inputCls} value={part} onChange={(e) => setPart(e.target.value as WaitlistRow['part_of_day'])}>
            <option value="any">Any time</option><option value="morning">Morning</option><option value="evening">Evening</option>
          </select>
        </Field>
        <Field label="From"><input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Until"><input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Field label="Note"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Wants the earliest time, can come in 30 min" data-testid="wl-note" /></Field>
      <Btn variant="glow" className="mt-2" data-testid="wl-save" disabled={saving} onClick={save}>Add to waitlist</Btn>
    </div>
  );
}
