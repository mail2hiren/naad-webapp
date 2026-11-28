import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Btn, Card } from '../ui';
import { useClinic } from '../../context/ClinicContext';
import { useClinicians } from '../../hooks/useClinicians';
import { useCalendarBlocks } from '../../hooks/useCalendarData';
import {
  apptStart, balance, clinicNow, clinicToday, dayKey, freeSlots, holdsSlot, hoursFor, money, onDay, timeLabel,
} from '../../lib/schedule';
import { blockAt, blocksOn, doctorTone, minutesLabel, runningLate, waitMinutes, LONG_WAIT_MIN } from '../../lib/calendar';
import { checkIn, setStatus } from '../../lib/frontDesk';
import type { AppointmentRow, BillRow } from '../../types/db';

/**
 * Today: the front desk's start screen. The day in numbers, what needs a
 * person now (requests, long waits, late arrivals, visits to bill, money
 * owed by patients who are here), every doctor's day at a glance, who is
 * arriving next, and the common jobs one tap away.
 */
export function TodaySection({ bills, onNewBooking, onBill }: { bills: BillRow[]; onNewBooking: () => void; onBill: (a: AppointmentRow) => void }) {
  const { orgId, appointments, patients, pushToast, logAudit } = useClinic();
  const clinicians = useClinicians();
  const { blocks } = useCalendarBlocks(orgId);
  const [, setParams] = useSearchParams();
  const [now, setNow] = useState(clinicNow());
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(clinicNow()), 30_000); return () => clearInterval(t); }, []);
  const today = clinicToday();
  const go = (section: string, extra: Record<string, string> = {}) => setParams({ section, ...extra });

  const day = useMemo(() => appointments.filter((a) => onDay(a, today)), [appointments, today]);
  const name = (pid: string) => patients.find((p) => p.id === pid)?.name ?? 'Patient';
  const docName = (id: string | null) => clinicians.find((c) => c.id === id)?.name ?? '';
  const n = (...s: AppointmentRow['status'][]) => day.filter((a) => s.includes(a.status)).length;
  const billedIds = new Set(bills.filter((b) => b.status !== 'void' && b.appointment_id).map((b) => b.appointment_id));
  const toBill = day.filter((a) => a.status === 'completed' && !billedIds.has(a.id));
  const collected = bills.filter((b) => b.status !== 'void' && b.paid_at && dayKey(new Date(b.paid_at)) === today).reduce((s, b) => s + b.paid, 0);
  const owedBy = (pid: string) => bills.filter((b) => b.patient_id === pid).reduce((s, b) => s + balance(b), 0);

  const requests = appointments.filter((a) => a.status === 'requested' && (apptStart(a)?.getTime() ?? 0) > now.getTime() - 86_400_000)
    .sort((a, b) => (apptStart(a)?.getTime() ?? 0) - (apptStart(b)?.getTime() ?? 0));
  const longWaits = day.filter((a) => a.status === 'checked_in' && (waitMinutes(a, now) ?? 0) >= LONG_WAIT_MIN)
    .sort((a, b) => (waitMinutes(b, now) ?? 0) - (waitMinutes(a, now) ?? 0));
  const late = day.filter((a) => a.status === 'scheduled' && now.getTime() - (apptStart(a)?.getTime() ?? 0) >= 15 * 60_000);
  const owingHere = day.filter((a) => ['checked_in', 'in_consultation', 'completed'].includes(a.status) && owedBy(a.patient_id) > 0);
  const arriving = day.filter((a) => a.status === 'scheduled' && (apptStart(a)?.getTime() ?? 0) >= now.getTime() - 15 * 60_000 && (apptStart(a)?.getTime() ?? 0) <= now.getTime() + 90 * 60_000)
    .sort((a, b) => apptStart(a)!.getTime() - apptStart(b)!.getTime());
  const attention = requests.length + longWaits.length + late.length + toBill.length + owingHere.length;

  async function act(a: AppointmentRow, what: 'check_in' | 'no_show') {
    setBusy(a.id);
    const p = patients.find((x) => x.id === a.patient_id);
    let error: string | null;
    let title: string;
    if (what === 'check_in') {
      const r = await checkIn(a, appointments, p, clinicNow());
      error = r.error; title = r.token ? `Checked in · Token ${r.token}` : 'Checked in';
    } else { error = await setStatus(a, 'no_show'); title = 'Marked as no-show'; }
    setBusy(null);
    if (error) { pushToast({ tone: 'critical', title: 'Could not update', detail: error }); return; }
    await logAudit(`reception-${what.replace('_', '-')}`, `${name(a.patient_id)} with ${docName(a.practitioner_id)}`);
    pushToast({ tone: 'ok', title, detail: `${name(a.patient_id)} · ${docName(a.practitioner_id)}` });
  }

  return (
    <div className="space-y-4" data-testid="today">
      {/* Quick jobs */}
      <div className="flex flex-wrap gap-2" data-testid="today-actions">
        <Btn variant="glow" data-testid="today-book" onClick={onNewBooking}>+ New appointment</Btn>
        <Btn variant="default" data-testid="today-walk-in" onClick={() => go('walk-in')}>Register walk-in (voice)</Btn>
        <Btn variant="default" onClick={() => go('patients')}>Find a patient</Btn>
        <Btn variant="default" onClick={() => go('billing')}>New bill</Btn>
        <Btn variant="default" onClick={() => go('calendar')}>Open calendar</Btn>
      </div>

      {/* The day in numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2" data-testid="today-stats">
        <Stat label="Booked today" value={day.filter((a) => holdsSlot(a.status)).length} />
        <Stat label="Yet to arrive" value={n('scheduled')} />
        <Stat label="Waiting" value={n('checked_in')} tone={longWaits.length ? 'danger' : undefined} />
        <Stat label="With doctor" value={n('in_consultation')} />
        <Stat label="Done" value={n('completed')} />
        <Stat label="No-shows" value={n('no_show')} />
        <Stat label="To bill" value={toBill.length} tone={toBill.length ? 'gate' : undefined} />
        <Stat label="Collected today" value={money(collected)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* Needs attention */}
        <Card data-testid="today-attention">
          <h2 className="text-base font-semibold text-ink">Needs attention {attention ? <span className="ml-1 rounded-full bg-danger px-2 text-[13px] text-on-danger">{attention}</span> : null}</h2>
          {attention === 0 && <p className="mt-2 text-sm text-ink-soft">All clear. Nothing is waiting on the desk.</p>}
          <ul className="mt-1 divide-y divide-line">
            {requests.map((a) => (
              <Item key={`r${a.id}`} tone="gate" title={`${name(a.patient_id)} asked for an appointment`}
                meta={`${docName(a.practitioner_id)} · ${apptStart(a) ? apptStart(a)!.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'no time yet'} · from the patient app`}>
                <Btn variant="default" data-testid="att-request" onClick={() => go('calendar')}>Confirm in calendar</Btn>
              </Item>
            ))}
            {longWaits.map((a) => (
              <Item key={`w${a.id}`} tone="danger" title={`${name(a.patient_id)} has waited ${minutesLabel(waitMinutes(a, now) ?? 0)}`}
                meta={`${docName(a.practitioner_id)}${a.token_no ? ` · token ${a.token_no}` : ''}. Tell the patient, or let the doctor know.`} />
            ))}
            {late.map((a) => (
              <Item key={`l${a.id}`} tone="gate" title={`${name(a.patient_id)} has not arrived`}
                meta={`Booked ${timeLabel(apptStart(a)!)} with ${docName(a.practitioner_id)} · ${Math.round((now.getTime() - apptStart(a)!.getTime()) / 60_000)} min late`}>
                <Btn variant="default" data-testid="att-check-in" disabled={busy === a.id} onClick={() => act(a, 'check_in')}>Check in</Btn>
                <Btn variant="ghost" data-testid="att-no-show" disabled={busy === a.id} onClick={() => act(a, 'no_show')}>No-show</Btn>
              </Item>
            ))}
            {toBill.map((a) => (
              <Item key={`b${a.id}`} tone="gate" title={`Bill ${name(a.patient_id)}`} meta={`Seen by ${docName(a.practitioner_id)}${a.completed_at ? ` · out ${timeLabel(new Date(a.completed_at))}` : ''}`}>
                <Btn variant="default" data-testid="att-bill" onClick={() => onBill(a)}>Create bill</Btn>
              </Item>
            ))}
            {owingHere.map((a) => (
              <Item key={`o${a.id}`} tone="gate" title={`${name(a.patient_id)} owes ${money(owedBy(a.patient_id))}`} meta="Here today: a good time to collect.">
                <Btn variant="ghost" onClick={() => go('patients', { patient: a.patient_id })}>Open record</Btn>
              </Item>
            ))}
          </ul>
        </Card>

        {/* Arriving next */}
        <Card data-testid="today-arriving">
          <h2 className="text-base font-semibold text-ink">Arriving in the next 90 minutes</h2>
          {arriving.length === 0 && <p className="mt-2 text-sm text-ink-soft">No one else is due soon.</p>}
          <ul className="mt-1 divide-y divide-line">
            {arriving.map((a) => (
              <Item key={a.id} title={`${timeLabel(apptStart(a)!)} · ${name(a.patient_id)}`} meta={`${docName(a.practitioner_id)}${a.reason ? ` · ${a.reason}` : ''}`} dot={doctorTone(clinicians.findIndex((c) => c.id === a.practitioner_id))}>
                <Btn variant="glow" data-testid="arriving-check-in" disabled={busy === a.id} onClick={() => act(a, 'check_in')}>Check in</Btn>
              </Item>
            ))}
          </ul>
        </Card>
      </div>

      {/* Doctors today */}
      <Card data-testid="today-doctors">
        <h2 className="text-base font-semibold text-ink">Doctors today</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {clinicians.map((c, i) => {
            const mine = day.filter((a) => a.practitioner_id === c.id);
            const sessions = hoursFor(c, today);
            const away = blocksOn(blocks, c.id, today);
            const withDoc = mine.find((a) => a.status === 'in_consultation');
            const lateBy = runningLate(mine, now, c);
            const free = freeSlots(c, today, appointments, now).filter((sl) => !blockAt(blocks, c.id, sl.start, sl.minutes)).length;
            return (
              <div key={c.id} className="rounded-xl bg-surface-2 p-3" style={{ borderLeft: `4px solid ${doctorTone(i)}` }} data-testid="today-doctor">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{c.name}</span>
                  <span className="text-[12px] text-ink-soft">{sessions.length ? sessions.map(([f, t]) => `${f}–${t}`).join(', ') : 'Off today'}</span>
                </div>
                <p className="mt-1 text-[13px] text-ink-soft">
                  {mine.filter((a) => holdsSlot(a.status)).length} booked · {mine.filter((a) => a.status === 'checked_in').length} waiting · {mine.filter((a) => a.status === 'completed').length} done · {free} free
                </p>
                <p className="text-[13px] text-ink">{withDoc ? `With ${name(withDoc.patient_id)}${withDoc.token_no ? ` (token ${withDoc.token_no})` : ''}` : sessions.length ? 'Nobody with the doctor' : ''}</p>
                {lateBy > 0 && <p className="text-[13px] font-semibold text-gate">Running {lateBy} min late</p>}
                {away.map(({ block }) => <p key={block.id} className="text-[13px] font-semibold text-ink-soft">Not available: {block.reason ?? block.kind}</p>)}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'danger' | 'gate' }) {
  return (
    <div className="rounded-xl bg-surface shadow-[var(--card-shadow)] px-3 py-2">
      <div className={`font-mono text-lg font-bold ${tone === 'danger' ? 'text-danger' : tone === 'gate' ? 'text-gate' : 'text-ink'}`}>{value}</div>
      <div className="text-[12px] text-ink-soft">{label}</div>
    </div>
  );
}

function Item({ title, meta, tone, dot, children }: { title: string; meta: string; tone?: 'danger' | 'gate'; dot?: string; children?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="today-item">
      <span className="flex min-w-0 items-start gap-2">
        <span aria-hidden="true" className={`mt-1.5 w-2 h-2 shrink-0 rounded-full ${tone === 'danger' ? 'bg-danger' : tone === 'gate' ? 'bg-gate' : ''}`} style={dot ? { background: dot } : undefined} />
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">{title}</span>
          <span className="block text-[13px] text-ink-soft">{meta}</span>
        </span>
      </span>
      {children && <span className="flex gap-1">{children}</span>}
    </li>
  );
}
