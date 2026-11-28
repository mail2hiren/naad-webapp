import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Btn, inputCls } from '../ui';
import { useClinic } from '../../context/ClinicContext';
import { useClinicians } from '../../hooks/useClinicians';
import { useCalendarBlocks, useOrgName, useWaitlist } from '../../hooks/useCalendarData';
import {
  STATUS_LABEL, addDays, apptStart, clinicNow, clinicToday, dayKey, dayLabel, freeSlots, holdsSlot, onDay, parseDay, slotLength, timeLabel,
} from '../../lib/schedule';
import { addMonths, blockAt, doctorTone, gridRange, noShowRisk, utilisation, weekDays, searchAppointments, type Risk } from '../../lib/calendar';
import { callIn, checkIn, checkOut, closeWaitlist, reschedule, setStatus } from '../../lib/frontDesk';
import type { AppointmentRow, AppointmentStatus, BillRow, PatientRow, PractitionerRow, VisitType, WaitlistRow } from '../../types/db';
import { DoctorList, FilterPanel, MiniMonth, type Filters } from './Sidebar';
import { TimeGrid, type GridColumn } from './TimeGrid';
import { MonthGrid } from './MonthGrid';
import { FlowPanel, type FlowAction } from './FlowPanel';
import { AppointmentDrawer } from './AppointmentDrawer';
import { QuickBook, type BookingInit } from './QuickBook';
import { BlockTimeModal, DaySheet, WaitlistModal } from './Extras';
import { ALL_VISITS, FLOW_ORDER, remember, store, type CalView } from './shared';

const DEFAULT_STEPS = FLOW_ORDER.filter((s) => s !== 'cancelled');

/**
 * Reception calendar: left panel (month, doctors, filters), day / week /
 * month views, live patient flow, and an appointment panel with every next
 * step. See docs/specs/calendar.md.
 */
export function CalendarPage({ bills, onBill }: { bills: BillRow[]; onBill: (a: AppointmentRow) => void }) {
  const { orgId, appointments, patients, pushToast, logAudit } = useClinic();
  const clinicians = useClinicians();
  const { blocks } = useCalendarBlocks(orgId);
  const { waitlist } = useWaitlist(orgId);
  const orgName = useOrgName(orgId);
  const [, setParams] = useSearchParams();
  const [view, setViewRaw] = useState<CalView>(() => remember<CalView>('view', 'day'));
  const [day, setDay] = useState(clinicToday());
  const [picked, setPicked] = useState<string[] | null>(() => remember<string[] | null>('doctors', null));
  const [filters, setFilters] = useState<Filters>({ visits: new Set(ALL_VISITS), statuses: new Set(DEFAULT_STEPS) });
  const [openId, setOpenId] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingInit | null>(null);
  const [fromWaitlist, setFromWaitlist] = useState<string | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [waitOpen, setWaitOpen] = useState(false);
  const [side, setSide] = useState(false);
  const wide = useMedia('(min-width: 1280px)');
  const large = useMedia('(min-width: 1024px)');
  // The receptionist chooses how much room the calendar gets: hide the left panel, the flow panel, or both.
  const [showLeft, setShowLeftRaw] = useState(() => remember('left', true));
  const [showFlow, setShowFlowRaw] = useState(() => remember('flow', true));
  const setShowLeft = (v: boolean) => { setShowLeftRaw(v); store('left', v); };
  const setShowFlow = (v: boolean) => { setShowFlowRaw(v); store('flow', v); };
  const focus = !showLeft && !showFlow;
  const flowBeside = showFlow && wide;
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(clinicNow());
  const searchRef = useRef<HTMLInputElement>(null);

  // The clock moves the now-line and the waiting times.
  useEffect(() => { const t = setInterval(() => setNow(clinicNow()), 30_000); return () => clearInterval(t); }, []);

  const setView = (v: CalView) => { setViewRaw(v); store('view', v); };
  const selected = useMemo(() => new Set((picked ?? clinicians.map((c) => c.id)).filter((id) => clinicians.some((c) => c.id === id))), [picked, clinicians]);
  const setSelected = (ids: string[]) => { setPicked(ids); store('doctors', ids); };
  const shown = clinicians.filter((c) => selected.has(c.id));
  const toneOf = (id: string | null) => doctorTone(Math.max(0, clinicians.findIndex((c) => c.id === id)));
  const patientMap = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);
  const risks = useMemo(() => new Map<string, Risk>([...new Set(appointments.map((a) => a.patient_id))]
    .map((pid) => [pid, noShowRisk(appointments, pid, now).risk])), [appointments, now]);
  const riskOf = (pid: string): Risk => risks.get(pid) ?? 'none';
  const visible = (a: AppointmentRow) => filters.statuses.has(a.status) && filters.visits.has((a.visit_type ?? 'consultation') as VisitType);

  const step = (n: number) => setDay(view === 'month' ? addMonths(day, n) : addDays(day, n * (view === 'week' ? 7 : 1)));

  // Keyboard: T today, arrows move, D/W/M views, N new, / search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [role="dialog"]') || openId || booking || blocking || sheet || waitOpen) return;
      const k = e.key.toLowerCase();
      if (k === 't') setDay(clinicToday());
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (k === 'd') setView('day');
      else if (k === 'w') setView('week');
      else if (k === 'm') setView('month');
      else if (k === 'n') setBooking({ practitionerId: shown[0]?.id, day });
      else if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const days = view === 'week' ? weekDays(day) : [day];
  const inRange = appointments.filter((a) => days.some((d) => onDay(a, d)) && selected.has(a.practitioner_id ?? ''));
  const range = gridRange(shown, days, inRange);
  const today = clinicToday();
  const columns: GridColumn[] = view === 'week'
    ? days.map((d) => ({
      key: d, day: d, doctors: shown, isToday: d === today,
      title: parseDay(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
      sub: `${inRange.filter((a) => onDay(a, d) && holdsSlot(a.status)).length} booked`,
      appts: inRange.filter((a) => onDay(a, d) && visible(a)),
    }))
    : shown.map((c) => {
      const mine = inRange.filter((a) => a.practitioner_id === c.id);
      const freeLeft = freeSlots(c, day, appointments, now).filter((s) => !blockAt(blocks, c.id, s.start, s.minutes)).length;
      return {
        key: c.id, day, doctor: c, doctors: [c], isToday: day === today, title: c.name,
        sub: `${slotLength(c)}-min slots · ${mine.filter((a) => holdsSlot(a.status)).length} booked · ${freeLeft} free`,
        fill: utilisation(c, day, mine),
        appts: mine.filter(visible),
      };
    });

  const dayAppts = appointments.filter((a) => onDay(a, day) && selected.has(a.practitioner_id ?? ''));
  const count = (...s: AppointmentStatus[]) => dayAppts.filter((a) => s.includes(a.status)).length;
  const results = useMemo(() => searchAppointments(appointments, patients, q), [appointments, patients, q]);
  const open = openId ? appointments.find((a) => a.id === openId) ?? null : null;
  const waiting = waitlist.filter((w) => w.status === 'waiting').length;
  const title = view === 'month' ? parseDay(day).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : view === 'week' ? `${parseDay(days[0]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} to ${parseDay(days[6]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : dayLabel(day);

  async function act(a: AppointmentRow, what: FlowAction | 'confirm') {
    if (what === 'bill') { setOpenId(null); onBill(a); return; }
    const p = patientMap.get(a.patient_id);
    const doc = clinicians.find((c) => c.id === a.practitioner_id);
    const who = `${p?.name ?? 'Patient'} with ${doc?.name ?? 'doctor'}`;
    setBusyId(a.id);
    let error: string | null = null;
    let title = '';
    let detail = who;
    const t = clinicNow();
    if (what === 'check_in') {
      const r = await checkIn(a, appointments, p, t);
      error = r.error; title = r.token ? `Checked in · Token ${r.token}` : 'Checked in';
      detail = `${p?.name ?? ''} is waiting for ${doc?.name ?? 'the doctor'}`;
    } else if (what === 'call_in') { error = await callIn(a, appointments, t); title = 'Called in'; detail = `${p?.name ?? ''} is with ${doc?.name ?? 'the doctor'}`; }
    else if (what === 'check_out') { error = await checkOut(a, t); title = 'Checked out'; detail = `${p?.name ?? ''} is ready to bill`; }
    else if (what === 'no_show') { error = await setStatus(a, 'no_show'); title = 'Marked as no-show'; }
    else if (what === 'confirm') { error = await setStatus(a, 'scheduled'); title = 'Request confirmed'; }
    setBusyId(null);
    if (error) { pushToast({ tone: 'critical', title: 'Could not update the appointment', detail: error }); return; }
    await logAudit(`reception-${what.replace('_', '-')}`, `${who}${a.token_no ? `, token ${a.token_no}` : ''}`);
    pushToast({ tone: 'ok', title, detail });
    // The panel stays open and shows the next step (after check-out: the bill).
  }

  async function move(id: string, doctor: PractitionerRow | undefined, start: Date) {
    const a = appointments.find((x) => x.id === id);
    if (!a) return;
    if (a.status === 'completed' || a.status === 'cancelled' || a.status === 'no_show') { pushToast({ tone: 'warning', title: 'Not moved', detail: `A ${STATUS_LABEL[a.status].toLowerCase()} visit stays where it was.` }); return; }
    const target = doctor ?? clinicians.find((c) => c.id === a.practitioner_id);
    if (!target) return;
    if (start.getTime() < now.getTime() - 5 * 60_000) { pushToast({ tone: 'warning', title: 'Not moved', detail: 'That time has passed.' }); return; }
    const error = await reschedule(a, appointments, start, { practitioner: target, blocks });
    if (error) { pushToast({ tone: 'critical', title: 'Not moved', detail: error }); return; }
    const p = patientMap.get(a.patient_id);
    await logAudit('reception-reschedule', `${p?.name ?? 'Patient'} to ${target.name}, ${dayLabel(dayKey(start))} ${timeLabel(start)}`);
    pushToast({ tone: 'ok', title: 'Appointment moved', detail: `${p?.name ?? 'Patient'} · ${target.name} · ${timeLabel(start)}. Let the patient know.` });
  }

  function openPatient(id: string) {
    setOpenId(null);
    setParams({ section: 'patients', patient: id, from: 'calendar' });
  }

  function bookFromWaitlist(w: WaitlistRow) {
    setWaitOpen(false);
    setFromWaitlist(w.id);
    setBooking({ practitionerId: w.practitioner_id ?? undefined, day: w.from_day > today ? w.from_day : today, patient: patientMap.get(w.patient_id) ?? null });
  }

  const sidebar = (
    <div className="space-y-5">
      <MiniMonth day={day} onPick={(d) => { setDay(d); setSide(false); }} appts={appointments.filter((a) => selected.has(a.practitioner_id ?? ''))} />
      <DoctorList clinicians={clinicians} selected={selected} now={now} appts={appointments}
        onToggle={(id) => { const n = new Set(selected); if (n.has(id)) { if (n.size > 1) n.delete(id); } else n.add(id); setSelected([...n]); }}
        onOnly={(id) => setSelected([id])} onAll={() => setSelected(clinicians.map((c) => c.id))} />
      <FilterPanel filters={filters} onChange={setFilters} />
      <p className="text-[12px] text-ink-faint">Shortcuts: T today · ← → move · D W M views · N new · / search</p>
    </div>
  );

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `${showLeft && large ? '15rem ' : ''}minmax(0,1fr)${flowBeside ? ' 19rem' : ''}` }}>
      {showLeft && large && <aside className="rounded-2xl bg-surface shadow-[var(--card-shadow)] p-3 self-start" aria-label="Calendar options" data-testid="cal-left">{sidebar}</aside>}

      <div className="min-w-0 space-y-3">
        {/* Toolbar */}
        <div className="rounded-2xl bg-surface shadow-[var(--card-shadow)] p-3 flex flex-wrap items-center gap-2" data-testid="cal-toolbar">
          {!large && <Btn variant="default" data-testid="cal-options" aria-expanded={side} onClick={() => setSide(!side)}>Doctors and filters</Btn>}
          {large && <Btn variant="ghost" data-testid="toggle-left" aria-pressed={showLeft} onClick={() => setShowLeft(!showLeft)} title={showLeft ? 'Hide the left panel' : 'Show the left panel'}>{showLeft ? '⇤ Hide panel' : '⇥ Show panel'}</Btn>}
          <Btn variant={day === today ? 'primary' : 'default'} data-testid="cal-today" onClick={() => setDay(today)}>Today</Btn>
          <Btn variant="default" aria-label={`Previous ${view}`} data-testid="cal-prev" onClick={() => step(-1)}>‹</Btn>
          <Btn variant="default" aria-label={`Next ${view}`} data-testid="cal-next" onClick={() => step(1)}>›</Btn>
          <h2 className="text-base font-semibold text-ink mr-auto min-w-0" data-testid="cal-day-label" aria-live="polite">{title}</h2>
          <label className="sr-only" htmlFor="cal-date">Go to date</label>
          <input id="cal-date" type="date" data-testid="cal-date" className={`${inputCls} !w-auto`} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          <div className="inline-flex rounded-lg border border-line-strong p-0.5" role="group" aria-label="View">
            {(['day', 'week', 'month'] as CalView[]).map((v) => (
              <button key={v} type="button" data-testid={`view-${v}`} aria-pressed={view === v} onClick={() => setView(v)}
                className={`min-h-10 px-3 rounded-md text-sm font-semibold capitalize ${view === v ? 'bg-accent text-on-accent' : 'text-ink-soft hover:bg-hover'}`}>{v}</button>
            ))}
          </div>
          <div className="w-full flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[12rem]">
              <label className="sr-only" htmlFor="cal-search">Find an appointment</label>
              <input id="cal-search" ref={searchRef} data-testid="cal-search" className={inputCls} placeholder="Find a booking: name, mobile, hospital no. ( / )" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
              {results.length > 0 && (
                <ul className="absolute z-40 mt-1 w-full max-h-80 overflow-y-auto rounded-xl border border-line-strong bg-surface-solid shadow-xl" data-testid="cal-search-results">
                  {results.map((a) => {
                    const s = apptStart(a)!;
                    return (
                      <li key={a.id}>
                        <button type="button" data-testid="cal-search-result" className="w-full min-h-11 px-3 py-2 text-left hover:bg-hover"
                          onClick={() => { setDay(dayKey(s)); if (view === 'month') setView('day'); if (a.practitioner_id && !selected.has(a.practitioner_id)) setSelected([...selected, a.practitioner_id]); setOpenId(a.id); setQ(''); }}>
                          <span className="block text-sm font-semibold text-ink">{patientMap.get(a.patient_id)?.name} · {STATUS_LABEL[a.status]}</span>
                          <span className="block text-[12px] text-ink-soft">{s.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {clinicians.find((c) => c.id === a.practitioner_id)?.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <Btn variant="default" data-testid="block-time" onClick={() => setBlocking(true)}>Block time</Btn>
            <Btn variant="default" data-testid="open-waitlist" onClick={() => setWaitOpen(true)}>Waitlist{waiting ? ` (${waiting})` : ''}</Btn>
            <Btn variant="default" data-testid="day-sheet-open" onClick={() => setSheet(true)}>Day sheet</Btn>
            <a className="inline-flex items-center min-h-11 rounded-lg px-3 text-sm font-semibold text-accent-ink hover:bg-hover" href="?section=display" target="_blank" rel="noopener" data-testid="token-screen-link">Token screen ↗</a>
            <Btn variant="default" data-testid="toggle-flow" aria-pressed={showFlow} onClick={() => setShowFlow(!showFlow)}>{showFlow ? 'Hide patient flow' : 'Show patient flow'}</Btn>
            <Btn variant={focus ? 'primary' : 'default'} data-testid="toggle-focus" aria-pressed={focus}
              onClick={() => { if (focus) { setShowLeft(true); setShowFlow(true); } else { setShowLeft(false); setShowFlow(false); } }}>{focus ? 'Exit full calendar' : 'Full calendar'}</Btn>
            <Btn variant="glow" data-testid="book-new" onClick={() => setBooking({ practitionerId: shown[0]?.id, day })}>+ New appointment</Btn>
          </div>
          {(!showLeft || !large) && (
            <div className="w-full flex flex-wrap items-center gap-1.5" role="group" aria-label="Doctors shown" data-testid="doctor-chips">
              <span className="text-[13px] font-semibold text-ink-soft mr-1">Doctors:</span>
              {clinicians.map((c, i) => {
                const on = selected.has(c.id);
                return (
                  <button key={c.id} type="button" aria-pressed={on} data-testid="doctor-chip"
                    onClick={() => { const n = new Set(selected); if (on) { if (n.size > 1) n.delete(c.id); } else n.add(c.id); setSelected([...n]); }}
                    className={`inline-flex items-center gap-1.5 min-h-9 rounded-full border px-3 text-[13px] font-semibold ${on ? 'border-line-strong bg-surface-2 text-ink' : 'border-line text-ink-faint'}`}>
                    <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full" style={{ background: on ? doctorTone(i) : 'transparent', border: `2px solid ${doctorTone(i)}` }} />
                    {c.name}
                  </button>
                );
              })}
              {selected.size < clinicians.length && <button type="button" className="min-h-9 px-2 text-[13px] font-semibold text-accent-ink hover:underline" onClick={() => setSelected(clinicians.map((c) => c.id))}>Show all</button>}
            </div>
          )}
        </div>

        {side && !large && <div className="rounded-2xl bg-surface shadow-[var(--card-shadow)] p-3" data-testid="cal-side-mobile">{sidebar}</div>}

        {view !== 'month' && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2" data-testid="cal-stats">
            {[['Booked', count('scheduled', 'requested')], ['Waiting', count('checked_in')], ['With doctor', count('in_consultation')], ['Done', count('completed')], ['No-shows', count('no_show')],
              ['Free left', shown.reduce((n, c) => n + freeSlots(c, day, appointments, now).filter((s) => !blockAt(blocks, c.id, s.start, s.minutes)).length, 0)]].map(([l, n]) => (
              <div key={l as string} className="rounded-xl bg-surface shadow-[var(--card-shadow)] px-3 py-2">
                <div className="font-mono text-lg font-bold text-ink">{n}</div>
                <div className="text-[12px] text-ink-soft">{l}{view === 'week' ? ' (day)' : ''}</div>
              </div>
            ))}
          </div>
        )}

        {view === 'month'
          ? <MonthGrid day={day} doctors={shown} appts={appointments.filter(visible)} blocks={blocks} patients={patientMap} toneOf={toneOf} onPick={(d) => { setDay(d); setView('day'); }} />
          : <TimeGrid columns={columns} range={range} now={now} blocks={blocks} patients={patientMap} bills={bills} toneOf={toneOf} riskOf={riskOf} allAppts={appointments}
            onFree={(doctor, start) => setBooking({ practitionerId: doctor.id, day: dayKey(start), start })}
            onEmpty={(d, start, doctor) => setBooking({ practitionerId: doctor?.id ?? shown[0]?.id, day: d, start: start.getTime() > now.getTime() ? start : undefined })}
            onOpen={setOpenId} onMove={move} />}

        {showFlow && !flowBeside && <FlowPanel doctors={shown} appts={appointments} patients={patientMap} bills={bills} now={now} toneOf={toneOf} onOpen={setOpenId} onAction={act} busyId={busyId} />}
      </div>

      {flowBeside && <div className="self-start sticky top-4" data-testid="cal-right">
        <FlowPanel doctors={shown} appts={appointments} patients={patientMap} bills={bills} now={now} toneOf={toneOf} onOpen={setOpenId} onAction={act} busyId={busyId} />
      </div>}

      {open && <AppointmentDrawer appt={open} bills={bills} blocks={blocks} waitlist={waitlist} orgName={orgName} busy={busyId === open.id}
        onClose={() => setOpenId(null)} onAction={act} onOpenPatient={openPatient}
        onBookFor={(p: PatientRow | null, doctorId?: string) => { setOpenId(null); setBooking({ practitionerId: doctorId, day, patient: p }); }} />}
      {booking && <QuickBook init={booking} onClose={() => { setBooking(null); setFromWaitlist(null); }}
        onBooked={async (d) => { if (fromWaitlist) await closeWaitlist(fromWaitlist, 'booked'); setFromWaitlist(null); setDay(d); setBooking(null); }} />}
      {blocking && <BlockTimeModal day={day} doctorId={shown.length === 1 ? shown[0].id : undefined} blocks={blocks} appts={appointments} onClose={() => setBlocking(false)} />}
      {sheet && <DaySheet day={day} doctors={shown} appts={appointments} patients={patientMap} orgName={orgName} onClose={() => setSheet(false)} />}
      {waitOpen && <WaitlistModal waitlist={waitlist} patients={patientMap} onBook={bookFromWaitlist} onClose={() => setWaitOpen(false)} />}
    </div>
  );
}

/** Tracks a CSS media query (panel layout by screen width). */
function useMedia(q: string): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setOn(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [q]);
  return on;
}
