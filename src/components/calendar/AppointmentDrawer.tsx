import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Btn, Field, Pill, inputCls } from '../ui';
import { useClinic } from '../../context/ClinicContext';
import {
  STATUS_LABEL, STATUS_TONE, VISIT_LABEL, apptStart, balance, clinicNow, clinicToday, dayKey, dayLabel, money, timeLabel,
} from '../../lib/schedule';
import { lastVisit, noShowRisk, reminderText, waitMinutes, consultMinutes, minutesLabel, waitlistFor, blockAt } from '../../lib/calendar';
import { bookAppointment, closeWaitlist, reschedule, setStatus, undoStep } from '../../lib/frontDesk';
import { useClinicians } from '../../hooks/useClinicians';
import type { AppointmentRow, BillRow, CalendarBlockRow, PatientRow, WaitlistRow } from '../../types/db';
import type { FlowAction } from './FlowPanel';
import { shortTime } from './shared';
import { freeSlots } from '../../lib/schedule';

const CANCEL_REASONS = ['Patient called to cancel', 'Patient unwell', 'Travelling', 'Doctor unavailable', 'Booked by mistake'];

/**
 * The appointment side panel: who the patient is (with a way into their
 * record), the visit, its timeline, and every next step one tap away.
 */
export function AppointmentDrawer({
  appt, bills, blocks, waitlist, orgName, busy, onClose, onAction, onOpenPatient, onBookFor,
}: {
  appt: AppointmentRow; bills: BillRow[]; blocks: CalendarBlockRow[]; waitlist: WaitlistRow[]; orgName: string; busy: boolean;
  onClose: () => void; onAction: (a: AppointmentRow, act: FlowAction | 'confirm') => void;
  onOpenPatient: (patientId: string) => void; onBookFor: (p: PatientRow | null, doctorId?: string) => void;
}) {
  const { orgId, appointments, patients, pushToast, logAudit } = useClinic();
  const clinicians = useClinicians();
  const p = patients.find((x) => x.id === appt.patient_id);
  const doc = clinicians.find((x) => x.id === appt.practitioner_id);
  const start = apptStart(appt);
  const now = clinicNow();
  const [mode, setMode] = useState<'view' | 'reschedule' | 'cancel' | 'offer'>('view');
  const [rsDoc, setRsDoc] = useState(appt.practitioner_id ?? '');
  const [rsDay, setRsDay] = useState(start ? dayKey(start) : clinicToday());
  const [rsTime, setRsTime] = useState('');
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [freed, setFreed] = useState<{ start: Date; minutes: number; doctorId: string } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => { panel.current?.focus(); }, [appt.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rsDoctor = clinicians.find((c) => c.id === rsDoc);
  const free = useMemo(() => (rsDoctor ? freeSlots(rsDoctor, rsDay, appointments, now, appt.id).filter((s) => !blockAt(blocks, rsDoctor.id, s.start, s.minutes)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rsDoctor, rsDay, appointments, blocks, appt.id]);
  const bill = bills.find((b) => b.appointment_id === appt.id && b.status !== 'void');
  const owed = bills.filter((b) => b.patient_id === appt.patient_id).reduce((s, b) => s + balance(b), 0);
  const risk = noShowRisk(appointments, appt.patient_id, now);
  const last = lastVisit(appointments, appt.patient_id, now);
  const upcoming = appointments.filter((a) => a.patient_id === appt.patient_id && a.id !== appt.id && (a.status === 'scheduled' || a.status === 'requested')
    && (apptStart(a)?.getTime() ?? 0) > now.getTime()).sort((a, b) => apptStart(a)!.getTime() - apptStart(b)!.getTime());
  const series = appt.series_id ? appointments.filter((a) => a.series_id === appt.series_id).sort((a, b) => apptStart(a)!.getTime() - apptStart(b)!.getTime()) : [];
  const who = `${p?.name ?? 'Patient'} with ${doc?.name ?? 'doctor'}`;
  const offers = freed ? waitlistFor(waitlist, freed.doctorId, freed.start).filter((w) => w.patient_id !== appt.patient_id) : [];

  async function run(fn: () => Promise<string | null>, ok: string, audit: string, after?: () => void) {
    setWorking(true);
    const error = await fn();
    setWorking(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not update the appointment', detail: error }); return; }
    await logAudit(audit, who);
    pushToast({ tone: 'ok', title: ok, detail: who });
    if (after) after(); else onClose();
  }

  async function cancel() {
    const was = start && appt.practitioner_id ? { start, minutes: appt.duration_minutes, doctorId: appt.practitioner_id } : null;
    await run(() => setStatus(appt, 'cancelled', reason.trim()), 'Appointment cancelled', 'reception-cancel', () => {
      if (was && was.start.getTime() > now.getTime() && waitlistFor(waitlist, was.doctorId, was.start).some((w) => w.patient_id !== appt.patient_id)) {
        setFreed(was); setMode('offer');
      } else onClose();
    });
  }

  async function offerTo(w: WaitlistRow) {
    const d = clinicians.find((c) => c.id === freed?.doctorId);
    const wp = patients.find((x) => x.id === w.patient_id);
    if (!freed || !d || !wp) return;
    setWorking(true);
    const error = await bookAppointment(orgId, appointments.filter((a) => a.id !== appt.id), {
      patientId: wp.id, practitioner: d, start: freed.start, minutes: freed.minutes, visitType: w.visit_type, reason: w.note ?? '', bookedBy: null,
    }, blocks);
    if (!error) await closeWaitlist(w.id, 'booked');
    setWorking(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not book', detail: error }); return; }
    await logAudit('reception-waitlist-book', `${wp.name} with ${d.name}, ${timeLabel(freed.start)}`);
    pushToast({ tone: 'ok', title: 'Freed time given to the waitlist', detail: `${wp.name} · ${d.name} · ${timeLabel(freed.start)}. Call to let them know.` });
    onClose();
  }

  async function copyReminder() {
    if (!p || !doc || !start) return;
    const text = reminderText(p.name, doc.name, start, orgName);
    try { await navigator.clipboard.writeText(text); pushToast({ tone: 'ok', title: 'Reminder copied', detail: 'Paste it into SMS or WhatsApp.' }); }
    catch { pushToast({ tone: 'warning', title: 'Copy this reminder', detail: text }); }
  }

  const next: { label: string; act: FlowAction | 'confirm'; testid: string } | null =
    appt.status === 'requested' ? { label: 'Confirm booking', act: 'confirm', testid: 'confirm-request' }
      : appt.status === 'scheduled' ? { label: 'Check in', act: 'check_in', testid: 'check-in' }
        : appt.status === 'checked_in' ? { label: 'Call in to doctor', act: 'call_in', testid: 'call-in' }
          : appt.status === 'in_consultation' ? { label: 'Check out', act: 'check_out', testid: 'check-out' }
            : appt.status === 'completed' && !bill ? { label: 'Create bill', act: 'bill', testid: 'bill-appt' } : null;

  const wait = waitMinutes(appt, now);
  const inMin = consultMinutes(appt, now);
  const steps: { label: string; at: string | null | undefined; note?: string }[] = [
    { label: appt.requested_by_patient ? 'Requested from the patient app' : `Booked${appt.booked_by ? ` by ${appt.booked_by}` : ''}`, at: null },
    { label: 'Arrived, waiting', at: appt.checked_in_at, note: wait != null ? `waited ${minutesLabel(wait)}` : undefined },
    { label: 'With doctor', at: appt.called_in_at, note: inMin != null ? `${minutesLabel(inMin)}` : undefined },
    { label: 'Checked out', at: appt.completed_at },
    { label: bill ? `Billed, ${bill.number}` : 'Billed', at: bill?.created_at ?? null },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-bg/60" onClick={onClose}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="appt-title" data-testid="appt-drawer"
        className="h-full w-full sm:max-w-md overflow-y-auto bg-surface-solid border-l border-line-strong shadow-2xl p-5 focus:outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="appt-title" className="text-lg truncate">{p?.name ?? 'Unknown patient'}</h2>
            {p && <p className="text-[13px] text-ink-soft">{[p.age != null ? `${p.age} y` : null, p.gender, p.mrn, p.phone].filter(Boolean).join(' · ')}</p>}
          </div>
          <Btn variant="ghost" aria-label="Close" data-testid="drawer-close" onClick={onClose}>✕</Btn>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Pill tone={STATUS_TONE[appt.status]}>{STATUS_LABEL[appt.status]}</Pill>
          {appt.token_no != null && <span className="text-sm font-semibold text-ink" data-testid="appt-token">Token {appt.token_no}</span>}
          {risk.risk === 'high' && <span className="text-[13px] font-semibold text-danger" data-testid="risk-high">No-show risk: missed {risk.noShows} of {risk.visits}</span>}
          {risk.risk === 'some' && <span className="text-[13px] font-semibold text-gate">Missed a visit before</span>}
        </div>

        {/* Patient summary */}
        {p && (
          <section className="mt-4 rounded-xl bg-surface-2 p-3" data-testid="drawer-patient">
            {p.allergies?.length ? <p className="text-[13px] font-semibold text-danger">Allergies: {p.allergies.join(', ')}</p> : <p className="text-[13px] text-ink-soft">No known allergies recorded.</p>}
            {p.conditions?.length ? <p className="mt-1 text-[13px] text-ink">Conditions: {p.conditions.join(', ')}</p> : null}
            <p className="mt-1 text-[13px] text-ink-soft">
              {last ? `Last visit ${apptStart(last)!.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'First visit'}
              {owed > 0 ? <span className="font-semibold text-gate"> · Owes {money(owed)}</span> : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn variant="default" data-testid="open-record" onClick={() => onOpenPatient(p.id)}>Open patient record</Btn>
              {p.phone && <a className="inline-flex items-center min-h-11 rounded-lg px-3 text-sm font-semibold text-accent-ink hover:bg-hover" href={`tel:${p.phone.replace(/\s/g, '')}`}>Call {p.phone}</a>}
            </div>
          </section>
        )}

        {/* Visit */}
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-soft">Doctor</dt><dd className="text-ink">{doc?.name ?? 'Unassigned'}</dd>
          <dt className="text-ink-soft">When</dt><dd className="text-ink" data-testid="drawer-when">{start ? `${dayLabel(dayKey(start))}, ${timeLabel(start)}` : 'Not set'} · {appt.duration_minutes} min</dd>
          <dt className="text-ink-soft">Visit</dt><dd className="text-ink">{VISIT_LABEL[appt.visit_type ?? 'consultation']}{appt.reason ? ` · ${appt.reason}` : ''}</dd>
          {appt.overbooked && <><dt className="text-ink-soft">Note</dt><dd className="text-gate font-semibold">Overbooked</dd></>}
          {series.length > 1 && <><dt className="text-ink-soft">Course</dt><dd className="text-ink" data-testid="drawer-series">Visit {series.findIndex((a) => a.id === appt.id) + 1} of {series.length}</dd></>}
          {appt.rescheduled_from && <><dt className="text-ink-soft">Moved from</dt><dd className="text-ink">{new Date(appt.rescheduled_from).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</dd></>}
          {appt.cancel_reason && appt.status === 'cancelled' && <><dt className="text-ink-soft">Reason</dt><dd className="text-ink">{appt.cancel_reason}</dd></>}
        </dl>

        {/* Timeline */}
        {appt.status !== 'cancelled' && appt.status !== 'no_show' && (
          <ol className="mt-4 border-l-2 border-line ml-1.5 space-y-2" data-testid="drawer-timeline" aria-label="Visit timeline">
            {steps.map((s, i) => {
              const doneStep = i === 0 || !!s.at;
              return (
                <li key={s.label} className="relative pl-4">
                  <span aria-hidden="true" className={`absolute -left-[7px] top-1 w-3 h-3 rounded-full border-2 ${doneStep ? 'bg-accent border-accent' : 'bg-surface-solid border-line-strong'}`} />
                  <span className={`text-sm ${doneStep ? 'text-ink font-semibold' : 'text-ink-faint'}`}>{s.label}</span>
                  {s.at && <span className="text-[13px] text-ink-soft"> · {timeLabel(new Date(s.at))}{s.note ? `, ${s.note}` : ''}</span>}
                </li>
              );
            })}
          </ol>
        )}

        {mode === 'view' && (
          <>
            {next && <Btn variant="glow" className="mt-5 w-full" data-testid={next.testid} disabled={busy || working} onClick={() => onAction(appt, next.act)}>{next.label}</Btn>}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(appt.status === 'scheduled' || appt.status === 'requested' || appt.status === 'checked_in') && <Btn variant="default" data-testid="reschedule" onClick={() => setMode('reschedule')}>{appt.status === 'requested' ? 'Offer another time' : 'Reschedule'}</Btn>}
              {(appt.status === 'scheduled' || appt.status === 'requested') && <Btn variant="danger" data-testid="cancel-appt" onClick={() => setMode('cancel')}>{appt.status === 'requested' ? 'Decline' : 'Cancel'}</Btn>}
              {appt.status === 'scheduled' && start && start.getTime() < now.getTime() && <Btn variant="default" data-testid="no-show" disabled={busy} onClick={() => onAction(appt, 'no_show')}>No-show</Btn>}
              {['checked_in', 'in_consultation', 'completed', 'no_show'].includes(appt.status) && !bill && (
                <Btn variant="ghost" data-testid="undo-step" disabled={working} onClick={() => run(() => undoStep(appt), 'Step undone', 'reception-undo-step', () => undefined)}>Undo last step</Btn>
              )}
              {appt.status === 'in_consultation' && !bill && <Btn variant="default" data-testid="bill-now" onClick={() => onAction(appt, 'bill')}>Bill now</Btn>}
              {(appt.status === 'scheduled' || appt.status === 'requested') && <Btn variant="default" data-testid="copy-reminder" onClick={copyReminder}>Copy reminder</Btn>}
              {(appt.status === 'cancelled' || appt.status === 'no_show') && <Btn variant="glow" data-testid="rebook" onClick={() => onBookFor(p ?? null, appt.practitioner_id ?? undefined)}>Book again</Btn>}
              {appt.status === 'completed' && <Btn variant="default" data-testid="book-follow-up" onClick={() => onBookFor(p ?? null, appt.practitioner_id ?? undefined)}>Book follow-up</Btn>}
            </div>
          </>
        )}

        {mode === 'reschedule' && (
          <div className="mt-4 rounded-xl border border-line p-3" data-testid="reschedule-form">
            <div className="grid grid-cols-2 gap-x-3">
              <Field label="Doctor">
                <select data-testid="rs-doctor" className={inputCls} value={rsDoc} onChange={(e) => { setRsDoc(e.target.value); setRsTime(''); }}>
                  {clinicians.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Date"><input type="date" data-testid="rs-date" className={inputCls} value={rsDay} onChange={(e) => { if (e.target.value) { setRsDay(e.target.value); setRsTime(''); } }} /></Field>
            </div>
            <p className="mt-2 text-[13px] font-semibold text-ink-soft">{free.length ? `${free.length} free times` : 'No free time on this day'}</p>
            <div className="mt-1 flex flex-wrap gap-1.5 max-h-40 overflow-y-auto" data-testid="rs-times" role="radiogroup" aria-label="Free times">
              {free.map((s) => {
                const v = String(s.start.getTime());
                return <button key={v} type="button" role="radio" aria-checked={rsTime === v} onClick={() => setRsTime(v)}
                  className={`min-h-11 rounded-lg border px-2.5 text-[13px] font-semibold ${rsTime === v ? 'bg-accent text-on-accent border-accent' : 'border-line-strong text-ink hover:bg-hover'}`}>{shortTime(s.start)}</button>;
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <Btn variant="glow" data-testid="rs-save" disabled={working || !rsTime || !rsDoctor}
                onClick={() => run(() => reschedule(appt, appointments, new Date(Number(rsTime)), { practitioner: rsDoctor, blocks }), 'Appointment moved', 'reception-reschedule')}>Move appointment</Btn>
              <Btn variant="ghost" onClick={() => setMode('view')}>Back</Btn>
            </div>
          </div>
        )}

        {mode === 'cancel' && (
          <div className="mt-4 rounded-xl border border-line p-3" data-testid="cancel-form">
            <div className="flex flex-wrap gap-1.5">
              {CANCEL_REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(r)}
                className={`min-h-9 rounded-full border px-2.5 text-[12px] font-semibold ${reason === r ? 'bg-accent text-on-accent border-accent' : 'border-line-strong text-ink-soft hover:bg-hover'}`}>{r}</button>)}
            </div>
            <Field label="Why is it cancelled?"><input data-testid="cancel-reason" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or type a reason" /></Field>
            <div className="mt-2 flex gap-2">
              <Btn variant="danger" data-testid="cancel-confirm" disabled={working || !reason.trim()} onClick={cancel}>Cancel appointment</Btn>
              <Btn variant="ghost" onClick={() => setMode('view')}>Back</Btn>
            </div>
          </div>
        )}

        {mode === 'offer' && freed && (
          <div className="mt-4 rounded-xl border border-accent p-3" data-testid="waitlist-offer">
            <h3 className="text-sm font-semibold text-ink">{timeLabel(freed.start)} is free again</h3>
            <p className="text-[13px] text-ink-soft">These patients asked for a time like this. Give it to one of them?</p>
            <ul className="mt-2 divide-y divide-line">
              {offers.map((w) => {
                const wp = patients.find((x) => x.id === w.patient_id);
                return (
                  <li key={w.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0"><span className="block text-sm font-semibold text-ink">{wp?.name}</span>
                      <span className="block text-[12px] text-ink-soft truncate">{wp?.phone}{w.note ? ` · ${w.note}` : ''}</span></span>
                    <Btn variant="glow" data-testid="offer-book" disabled={working} onClick={() => offerTo(w)}>Book</Btn>
                  </li>
                );
              })}
            </ul>
            <Btn variant="ghost" className="mt-2" onClick={onClose}>Not now</Btn>
          </div>
        )}

        {upcoming.length > 0 && (
          <Section title="Other bookings">
            {upcoming.slice(0, 4).map((a) => (
              <li key={a.id} className="py-1.5 text-sm text-ink">
                {apptStart(a)!.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                <span className="text-ink-soft"> · {clinicians.find((c) => c.id === a.practitioner_id)?.name}</span>
              </li>
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="text-[13px] font-semibold uppercase tracking-wider text-ink-soft">{title}</h3>
      <ul className="divide-y divide-line">{children}</ul>
    </section>
  );
}
