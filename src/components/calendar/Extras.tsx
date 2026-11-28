import { useState } from 'react';
import { Btn, Field, Modal, inputCls } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { useClinic } from '../../context/ClinicContext';
import { useClinicians } from '../../hooks/useClinicians';
import { STATUS_LABEL, VISIT_LABEL, addDays, clinicNow, apptStart, at, dayLabel, holdsSlot, onDay, parseDay, timeLabel } from '../../lib/schedule';
import { reminderText } from '../../lib/calendar';
import { closeWaitlist, createBlock, removeBlock } from '../../lib/frontDesk';
import type { AppointmentRow, BlockKind, CalendarBlockRow, PatientRow, PractitionerRow, WaitlistRow } from '../../types/db';
import { BLOCK_LABEL } from './shared';

/** Block time a doctor (or the hospital) cannot be booked: leave, OT, meetings, holidays. */
export function BlockTimeModal({ day, doctorId, blocks, appts, onClose }: { day: string; doctorId?: string; blocks: CalendarBlockRow[]; appts: AppointmentRow[]; onClose: () => void }) {
  const { orgId, pushToast, logAudit } = useClinic();
  const { practitioner: me } = useAuth();
  const clinicians = useClinicians();
  const [who, setWho] = useState(doctorId ?? clinicians[0]?.id ?? '');
  const [kind, setKind] = useState<BlockKind>('leave');
  const [fromDay, setFromDay] = useState(day);
  const [toDay, setToDay] = useState(day);
  const [allDay, setAllDay] = useState(true);
  const [from, setFrom] = useState('13:00');
  const [to, setTo] = useState('14:00');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const start = allDay ? at(fromDay, '00:00') : at(fromDay, from);
  const end = allDay ? at(addDays(toDay, 1), '00:00') : at(allDay ? toDay : fromDay, to);
  const affected = appts.filter((a) => holdsSlot(a.status) && a.status !== 'completed' && (who === '' || a.practitioner_id === who)
    && (apptStart(a)?.getTime() ?? 0) < end.getTime() && (apptStart(a)?.getTime() ?? 0) + a.duration_minutes * 60_000 > start.getTime());
  const [since] = useState(() => clinicNow().getTime() - 86_400_000 * 30);
  const existing = blocks.filter((b) => Date.parse(b.ends_at) > since).sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  async function save() {
    setSaving(true);
    const error = await createBlock(orgId, { practitionerId: who || null, start, end, kind: who ? kind : 'holiday', reason, createdBy: me?.name ?? null });
    setSaving(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not block the time', detail: error }); return; }
    const name = clinicians.find((c) => c.id === who)?.name ?? 'Whole hospital';
    await logAudit('reception-block-time', `${name}: ${BLOCK_LABEL[who ? kind : 'holiday']} ${start.toLocaleString('en-IN')} to ${end.toLocaleString('en-IN')}`);
    pushToast({ tone: affected.length ? 'warning' : 'ok', title: 'Time blocked', detail: affected.length ? `${affected.length} booking${affected.length === 1 ? '' : 's'} fall in this time. Move or cancel them.` : `${name} cannot be booked then.` });
    onClose();
  }

  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="blk-title" data-testid="block-modal">
        <h2 id="blk-title" className="text-lg">Block time</h2>
        <p className="text-[13px] text-ink-soft">Leave, an operating list, a meeting or a holiday. Nobody can book into it.</p>
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Who">
            <select data-testid="blk-who" className={inputCls} value={who} onChange={(e) => setWho(e.target.value)}>
              {clinicians.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="">Whole hospital (holiday)</option>
            </select>
          </Field>
          <Field label="Kind">
            <select data-testid="blk-kind" className={inputCls} value={who ? kind : 'holiday'} disabled={!who} onChange={(e) => setKind(e.target.value as BlockKind)}>
              {(Object.keys(BLOCK_LABEL) as BlockKind[]).map((k) => <option key={k} value={k}>{BLOCK_LABEL[k]}</option>)}
            </select>
          </Field>
          <Field label="From"><input type="date" data-testid="blk-from-day" className={inputCls} value={fromDay} onChange={(e) => { setFromDay(e.target.value); if (e.target.value > toDay) setToDay(e.target.value); }} /></Field>
          {allDay
            ? <Field label="Until (inclusive)"><input type="date" data-testid="blk-to-day" className={inputCls} value={toDay} min={fromDay} onChange={(e) => setToDay(e.target.value)} /></Field>
            : <div />}
        </div>
        <label className="mt-2 inline-flex items-center gap-2 min-h-11 text-sm text-ink">
          <input type="checkbox" data-testid="blk-all-day" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="w-4 h-4 accent-[var(--accent)]" /> All day
        </label>
        {!allDay && (
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="From time"><input type="time" step={300} data-testid="blk-from" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To time"><input type="time" step={300} data-testid="blk-to" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
        )}
        <Field label="Reason"><input data-testid="blk-reason" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Conference in Mumbai, OT list" /></Field>
        {affected.length > 0 && <p className="mt-2 text-[13px] font-semibold text-gate" data-testid="blk-affected">{affected.length} existing booking{affected.length === 1 ? '' : 's'} in this time will need moving.</p>}
        <div className="mt-4 flex gap-2">
          <Btn variant="glow" data-testid="blk-save" disabled={saving || end.getTime() <= start.getTime()} onClick={save}>Block time</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
        {existing.length > 0 && (
          <section className="mt-5">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-ink-soft">Blocked time</h3>
            <ul className="divide-y divide-line" data-testid="blk-list">
              {existing.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 text-sm text-ink">
                    <span className="font-semibold">{clinicians.find((c) => c.id === b.practitioner_id)?.name ?? 'Whole hospital'}</span> · {BLOCK_LABEL[b.kind]}
                    <span className="block text-[12px] text-ink-soft">{new Date(b.starts_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} to {new Date(b.ends_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{b.reason ? ` · ${b.reason}` : ''}</span>
                  </span>
                  <Btn variant="ghost" data-testid="blk-remove" onClick={async () => {
                    const error = await removeBlock(b.id);
                    if (error) pushToast({ tone: 'critical', title: 'Could not remove', detail: error });
                    else { await logAudit('reception-unblock-time', b.reason ?? b.kind); pushToast({ tone: 'ok', title: 'Block removed', detail: 'The time can be booked again.' }); }
                  }}>Remove</Btn>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  );
}

/** Printable day list per doctor, and tomorrow's reminders ready to copy. */
export function DaySheet({ day, doctors, appts, patients, orgName, onClose }: {
  day: string; doctors: PractitionerRow[]; appts: AppointmentRow[]; patients: Map<string, PatientRow>; orgName: string; onClose: () => void;
}) {
  const { pushToast } = useClinic();
  const tomorrow = addDays(day, 1);
  const reminders = appts.filter((a) => onDay(a, tomorrow) && (a.status === 'scheduled' || a.status === 'requested') && doctors.some((d) => d.id === a.practitioner_id))
    .sort((a, b) => apptStart(a)!.getTime() - apptStart(b)!.getTime());
  const text = reminders.map((a) => {
    const p = patients.get(a.patient_id);
    const d = doctors.find((x) => x.id === a.practitioner_id);
    return `${p?.name} (${p?.phone ?? 'no mobile'}): ${reminderText(p?.name ?? '', d?.name ?? '', apptStart(a)!, orgName)}`;
  }).join('\n\n');
  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="sheet-title" data-testid="day-sheet">
        <div className="print-sheet">
          <h2 id="sheet-title" className="text-lg">Day sheet · {dayLabel(day)}</h2>
          <p className="text-[13px] text-ink-soft">{orgName}</p>
          {doctors.map((d) => {
            const list = appts.filter((a) => a.practitioner_id === d.id && onDay(a, day) && a.status !== 'cancelled').sort((a, b) => apptStart(a)!.getTime() - apptStart(b)!.getTime());
            return (
              <section key={d.id} className="mt-4">
                <h3 className="text-sm font-semibold text-ink">{d.name} · {list.length} patients</h3>
                <table className="mt-1 w-full text-[13px]">
                  <thead><tr className="text-left text-ink-soft"><th className="py-1 pr-2">Time</th><th className="pr-2">Token</th><th className="pr-2">Patient</th><th className="pr-2">Mobile</th><th className="pr-2">Visit</th><th>Step</th></tr></thead>
                  <tbody>
                    {list.length === 0 && <tr><td colSpan={6} className="py-1 text-ink-soft">No bookings.</td></tr>}
                    {list.map((a) => {
                      const p = patients.get(a.patient_id);
                      return (
                        <tr key={a.id} className="border-t border-line text-ink">
                          <td className="py-1 pr-2 whitespace-nowrap">{timeLabel(apptStart(a)!)}</td><td className="pr-2">{a.token_no ?? ''}</td>
                          <td className="pr-2">{p?.name}</td><td className="pr-2 whitespace-nowrap">{p?.phone}</td>
                          <td className="pr-2">{VISIT_LABEL[a.visit_type ?? 'consultation']}</td><td>{STATUS_LABEL[a.status]}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>
        <section className="mt-5 no-print">
          <h3 className="text-sm font-semibold text-ink">Reminders for {parseDay(tomorrow).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })} · {reminders.length}</h3>
          <p className="text-[13px] text-ink-soft">Copy and send by SMS or WhatsApp. Automatic sending needs a paid messaging account (not set up).</p>
          {reminders.length > 0 && <textarea readOnly aria-label="Reminder messages" className={`${inputCls} mt-2 h-32 text-[13px]`} value={text} data-testid="sheet-reminders" />}
        </section>
        <div className="mt-4 flex gap-2 no-print">
          <Btn variant="glow" data-testid="sheet-print" onClick={() => window.print()}>Print</Btn>
          {reminders.length > 0 && <Btn variant="default" onClick={async () => { try { await navigator.clipboard.writeText(text); pushToast({ tone: 'ok', title: 'Reminders copied', detail: `${reminders.length} messages` }); } catch { /* the text box is selectable */ } }}>Copy reminders</Btn>}
          <Btn variant="ghost" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </Modal>
  );
}

/** Everyone waiting for an earlier or particular time. */
export function WaitlistModal({ waitlist, patients, onBook, onClose }: {
  waitlist: WaitlistRow[]; patients: Map<string, PatientRow>; onBook: (w: WaitlistRow) => void; onClose: () => void;
}) {
  const { pushToast } = useClinic();
  const clinicians = useClinicians();
  const open = waitlist.filter((w) => w.status === 'waiting').sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="wl-title" data-testid="waitlist-modal">
        <h2 id="wl-title" className="text-lg">Waitlist · {open.length}</h2>
        <p className="text-[13px] text-ink-soft">When a booking is cancelled, the calendar offers the time to the right person here.</p>
        <ul className="mt-2 divide-y divide-line">
          {open.length === 0 && <li className="py-3 text-sm text-ink-soft">Nobody is waiting.</li>}
          {open.map((w) => {
            const p = patients.get(w.patient_id);
            return (
              <li key={w.id} className="py-2" data-testid="wl-row">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{p?.name}</span>
                    <span className="block text-[12px] text-ink-soft">
                      {clinicians.find((c) => c.id === w.practitioner_id)?.name ?? 'Any doctor'} · {w.from_day.slice(8)}/{w.from_day.slice(5, 7)} to {w.to_day.slice(8)}/{w.to_day.slice(5, 7)}
                      {w.part_of_day !== 'any' ? ` · ${w.part_of_day}` : ''}{p?.phone ? ` · ${p.phone}` : ''}
                    </span>
                    {w.note && <span className="block text-[12px] text-ink-soft">{w.note}</span>}
                  </span>
                  <span className="flex gap-1 shrink-0">
                    <Btn variant="glow" data-testid="wl-book" onClick={() => onBook(w)}>Book</Btn>
                    <Btn variant="ghost" onClick={async () => { const e = await closeWaitlist(w.id, 'removed'); if (e) pushToast({ tone: 'critical', title: 'Could not remove', detail: e }); }}>Remove</Btn>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <Btn variant="ghost" className="mt-3" onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  );
}
