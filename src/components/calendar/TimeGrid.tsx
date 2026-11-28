import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { STATUS_LABEL, VISIT_LABEL, apptStart, at, clashes, dayLabel, hoursFor, parseDay, slotsFor, timeLabel } from '../../lib/schedule';
import { blockAt, blocksOn, layoutLanes, minutesOfDay, waitMinutes, LONG_WAIT_MIN, type Risk } from '../../lib/calendar';
import type { AppointmentRow, BillRow, CalendarBlockRow, PatientRow, PractitionerRow } from '../../types/db';
import { BLOCK_LABEL, FLOW_BG, PX_PER_MIN, hourLabel, shortTime } from './shared';

export interface GridColumn {
  key: string;
  day: string;
  title: string;
  sub?: string;
  /** Day view: the doctor of this column. Week view: none (all ticked doctors share the day). */
  doctor?: PractitionerRow;
  /** Doctors whose hours, blocks and bookings this column shows. */
  doctors: PractitionerRow[];
  appts: AppointmentRow[];
  isToday: boolean;
  /** Booked share of working time (day view), shown as a bar. */
  fill?: number;
}

interface Props {
  columns: GridColumn[];
  range: { from: number; to: number };
  now: Date;
  blocks: CalendarBlockRow[];
  patients: Map<string, PatientRow>;
  bills: BillRow[];
  toneOf: (practitionerId: string | null) => string;
  riskOf: (patientId: string) => Risk;
  allAppts: AppointmentRow[];
  onFree: (doctor: PractitionerRow, start: Date) => void;
  onEmpty: (day: string, start: Date, doctor: PractitionerRow | undefined) => void;
  onOpen: (id: string) => void;
  onMove: (apptId: string, doctor: PractitionerRow | undefined, start: Date) => void;
}

const SNAP = 5;

/** Day and week views: a time grid, one column per doctor (day) or per day (week). */
export function TimeGrid({ columns, range, now, blocks, patients, bills, toneOf, riskOf, allAppts, onFree, onEmpty, onOpen, onMove }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState<{ col: string; min: number } | null>(null);
  const height = (range.to - range.from) * PX_PER_MIN;
  const hours: number[] = [];
  for (let m = range.from; m < range.to; m += 60) hours.push(m);
  const showsToday = columns.some((c) => c.isToday);

  // Open on "now" for today, else on the start of the day.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nowMin = minutesOfDay(now);
    const target = showsToday && nowMin > range.from && nowMin < range.to ? (nowMin - range.from - 60) * PX_PER_MIN : 0;
    el.scrollTop = Math.max(0, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns.map((c) => c.key).join('|')]);

  const minuteAt = (e: MouseEvent | DragEvent, el: HTMLElement) => {
    const y = e.clientY - el.getBoundingClientRect().top;
    return Math.max(range.from, Math.min(range.to - SNAP, range.from + Math.round(y / PX_PER_MIN / SNAP) * SNAP));
  };
  const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

  return (
    <div className="relative rounded-2xl bg-surface shadow-[var(--card-shadow)] overflow-hidden" data-testid="calendar">
      <div ref={scroller} className="overflow-auto max-h-[calc(100vh-14rem)] min-h-[28rem]" data-testid="cal-scroll" tabIndex={0} role="region" aria-label="Appointments by time">
        <div className="grid min-w-max" style={{ gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(${columns.length > 3 ? 118 : columns.length > 1 ? 180 : 240}px, 1fr))` }}>
          {/* Header row */}
          <div className="sticky top-0 left-0 z-30 bg-surface-solid border-b border-line" />
          {columns.map((c) => (
            <div key={c.key} className="sticky top-0 z-20 bg-surface-solid border-b border-l border-line px-2 py-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                {c.doctor && <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: toneOf(c.doctor.id) }} />}
                <span className={`text-sm font-semibold truncate ${c.isToday ? 'text-accent-ink' : 'text-ink'}`}>{c.title}</span>
              </div>
              {c.sub && <div className="text-[12px] text-ink-soft truncate">{c.sub}</div>}
              {c.fill != null && (
                <div className="mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden" role="img" aria-label={`${Math.round(c.fill * 100)}% of working time booked`}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round(c.fill * 100))}%`, background: c.fill > 1 ? 'var(--danger)' : c.fill > 0.85 ? 'var(--gate)' : 'var(--accent)' }} />
                </div>
              )}
            </div>
          ))}

          {/* Time gutter */}
          <div className="sticky left-0 z-10 bg-surface-solid relative" style={{ height }} aria-hidden="true">
            {hours.map((m) => (
              <div key={m} className="absolute right-1.5 -translate-y-1/2 text-[12px] text-ink-faint" style={{ top: (m - range.from) * PX_PER_MIN }}>{m === range.from ? '' : hourLabel(m)}</div>
            ))}
          </div>

          {columns.map((c) => {
            const sessions = c.doctors.flatMap((d) => hoursFor(d, c.day));
            const colBlocks = c.doctor ? blocksOn(blocks, c.doctor.id, c.day)
              : dedupe(c.doctors.flatMap((d) => blocksOn(blocks, d.id, c.day).filter((b) => b.block.practitioner_id === null || c.doctors.length === 1)));
            const placed = layoutLanes(c.appts);
            const free = c.doctor ? slotsFor(c.doctor, c.day).filter((sl) => sl.start.getTime() > now.getTime()
              && !clashes(allAppts, c.doctor!.id, sl.start, sl.minutes).length && !blockAt(blocks, c.doctor!.id, sl.start, sl.minutes)) : [];
            const nowMin = minutesOfDay(now);
            const label = c.doctor ? `${c.doctor.name} on ${dayLabel(c.day)}` : dayLabel(c.day);
            return (
              <section key={c.key} data-testid="doctor-column" data-day={c.day} aria-label={label}
                className="relative border-l border-line"
                style={{ height, background: 'var(--off-hours)' }}
                onClick={(e) => { if (e.target === e.currentTarget) onEmpty(c.day, at(c.day, hhmm(minuteAt(e, e.currentTarget))), c.doctor); }}
                onDragOver={(e) => { e.preventDefault(); setDragOver({ col: c.key, min: minuteAt(e, e.currentTarget) }); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/appt');
                  setDragOver(null);
                  if (id) onMove(id, c.doctor, at(c.day, hhmm(minuteAt(e, e.currentTarget))));
                }}>
                <span className="sr-only">{label}{c.sub ? `, ${c.sub}` : ''}</span>
                {/* Working hours */}
                {sessions.map(([f, t], i) => {
                  const fm = Number(f.slice(0, 2)) * 60 + Number(f.slice(3, 5));
                  const tm = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
                  return <div key={i} aria-hidden="true" className="absolute inset-x-0 bg-surface-solid pointer-events-none" style={{ top: (fm - range.from) * PX_PER_MIN, height: (tm - fm) * PX_PER_MIN }} />;
                })}
                {/* Hour and half-hour lines */}
                {hours.map((m) => (
                  <div key={m} aria-hidden="true" className="absolute inset-x-0 pointer-events-none">
                    <div className="absolute inset-x-0 border-t border-line" style={{ top: (m - range.from) * PX_PER_MIN }} />
                    <div className="absolute inset-x-0 border-t border-dashed border-line opacity-60" style={{ top: (m + 30 - range.from) * PX_PER_MIN }} />
                  </div>
                ))}
                {sessions.length === 0 && c.appts.length === 0 && (
                  <p className="absolute inset-x-2 top-3 text-[13px] text-ink-soft pointer-events-none">{c.doctor ? 'Not working on this day.' : 'Closed.'}</p>
                )}
                {/* Blocked time */}
                {colBlocks.map(({ block, from, to }) => {
                  const top = Math.max(0, minutesOfDay(from) - range.from) * PX_PER_MIN;
                  const endMin = to.getTime() >= parseDay(c.day).getTime() + 86_400_000 ? range.to : minutesOfDay(to);
                  const h = Math.max(18, (Math.min(range.to, endMin) - Math.max(range.from, minutesOfDay(from))) * PX_PER_MIN);
                  return (
                    <div key={block.id} data-testid="cal-block" className="absolute inset-x-0 z-[1] cal-hatch border-y border-line-strong px-2 py-1 pointer-events-none" style={{ top, height: h }}>
                      <span className="inline-block rounded bg-surface-solid px-1.5 text-[12px] font-semibold text-ink-soft">
                        {BLOCK_LABEL[block.kind]}{block.reason ? ` · ${block.reason}` : ''}
                      </span>
                    </div>
                  );
                })}
                {/* Free slots (day view) */}
                {free.map((sl) => (
                  <button key={sl.start.getTime()} type="button" data-testid="free-slot"
                    onClick={() => onFree(c.doctor!, sl.start)}
                    className="group absolute inset-x-1 z-[2] rounded-md text-left px-2 text-[12px] text-transparent hover:text-accent-ink hover:bg-accent-soft focus:text-accent-ink focus:bg-accent-soft focus:outline-none focus:ring-2 focus:ring-accent"
                    style={{ top: (minutesOfDay(sl.start) - range.from) * PX_PER_MIN + 1, height: sl.minutes * PX_PER_MIN - 2 }}>
                    + {timeLabel(sl.start)} free<span className="sr-only">, book {c.doctor!.name}</span>
                  </button>
                ))}
                {/* Drop preview */}
                {dragOver?.col === c.key && (
                  <div aria-hidden="true" className="absolute inset-x-1 z-[3] rounded-md border-2 border-dashed border-accent pointer-events-none" style={{ top: (dragOver.min - range.from) * PX_PER_MIN, height: 15 * PX_PER_MIN }}>
                    <span className="m-1 inline-block rounded bg-surface-solid px-1 text-[12px] font-semibold text-accent-ink">{shortTime(at(c.day, hhmm(dragOver.min)))}</span>
                  </div>
                )}
                {/* Appointments */}
                {placed.map(({ appt: a, lane, lanes }) => {
                  const s = apptStart(a)!;
                  const top = (minutesOfDay(s) - range.from) * PX_PER_MIN;
                  const h = Math.max(22, (a.duration_minutes || 15) * PX_PER_MIN - 2);
                  const p = patients.get(a.patient_id);
                  const gone = a.status === 'cancelled' || a.status === 'no_show';
                  const billed = bills.some((b) => b.appointment_id === a.id && b.status !== 'void');
                  const wait = a.status === 'checked_in' ? waitMinutes(a, now) : null;
                  const risk = a.status === 'scheduled' || a.status === 'requested' ? riskOf(a.patient_id) : 'none';
                  const tall = h >= 48;
                  return (
                    <button key={a.id} type="button" data-testid="appt-card" data-status={a.status} data-appt={a.id}
                      draggable={!gone && a.status !== 'completed'}
                      onDragStart={(e) => { e.dataTransfer.setData('text/appt', a.id); e.dataTransfer.effectAllowed = 'move'; }}
                      onClick={() => onOpen(a.id)}
                      title={`${timeLabel(s)} · ${p?.name ?? 'Patient'} · ${STATUS_LABEL[a.status]}`}
                      className={`absolute z-[4] overflow-hidden rounded-md text-left px-1.5 py-0.5 shadow-sm hover:z-[5] hover:shadow-md focus:z-[5] focus:outline-none focus:ring-2 focus:ring-accent ${a.status === 'requested' ? 'border border-dashed border-gate' : 'border border-line'} ${gone ? 'opacity-90' : ''}`}
                      style={{
                        top, height: h, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`,
                        background: `linear-gradient(${FLOW_BG[a.status]}, ${FLOW_BG[a.status]}), var(--surface-solid)`,
                        borderLeft: `4px solid ${toneOf(a.practitioner_id)}`,
                      }}>
                      <span className="flex items-center gap-1 text-[12px] leading-4 text-ink">
                        <span className="font-semibold whitespace-nowrap">{shortTime(s)}</span>
                        {a.token_no != null && <span className="rounded bg-accent text-on-accent px-1 font-bold">{a.token_no}</span>}
                        <span className={`truncate font-semibold ${gone ? 'line-through' : ''}`}>{p?.name ?? 'Patient'}</span>
                      </span>
                      <span className="block text-[12px] leading-4 text-ink-soft truncate">
                        {STATUS_LABEL[a.status]}
                        {wait != null ? ` · ${wait} min` : ''}
                        {a.overbooked ? ' · Overbooked' : ''}
                        {risk === 'high' ? ' · No-show risk' : ''}
                        {a.status === 'completed' ? (billed ? ' · Billed' : ' · To bill') : ''}
                      </span>
                      {tall && <span className="block text-[12px] leading-4 text-ink-soft truncate">{VISIT_LABEL[a.visit_type ?? 'consultation']}{a.reason ? ` · ${a.reason}` : ''}</span>}
                      {wait != null && wait >= LONG_WAIT_MIN && <span className="absolute top-0.5 right-1 w-2 h-2 rounded-full bg-danger" aria-hidden="true" />}
                    </button>
                  );
                })}
                {/* Now line */}
                {c.isToday && nowMin >= range.from && nowMin <= range.to && (
                  <div aria-hidden="true" data-testid="now-line" className="absolute inset-x-0 z-[6] pointer-events-none" style={{ top: (nowMin - range.from) * PX_PER_MIN }}>
                    <div className="h-0.5" style={{ background: 'var(--now-line)' }} />
                    <div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full" style={{ background: 'var(--now-line)' }} />
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function dedupe<T extends { block: { id: string } }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.block.id) ? false : (seen.add(x.block.id), true)));
}
