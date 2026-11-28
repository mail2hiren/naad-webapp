import { STATUS_LABEL, VISIT_LABEL, apptStart, clinicToday, dayKey, holdsSlot, onDay, parseDay } from '../../lib/schedule';
import { addMonths, doctorTone, monthMatrix, runningLate, sameMonth } from '../../lib/calendar';
import type { AppointmentRow, AppointmentStatus, PractitionerRow, VisitType } from '../../types/db';
import { ALL_VISITS, FLOW_BG, FLOW_ORDER } from './shared';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Small month calendar: jump to any day; days with bookings carry a dot. */
export function MiniMonth({ day, onPick, appts }: { day: string; onPick: (d: string) => void; appts: AppointmentRow[] }) {
  const today = clinicToday();
  const localBusy = new Set(appts.filter((a) => holdsSlot(a.status)).map((a) => apptStart(a)).filter((d): d is Date => d != null).map(dayKey));
  const title = parseDay(day).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  return (
    <div data-testid="mini-month">
      <div className="flex items-center justify-between mb-1">
        <button type="button" className="min-h-11 min-w-11 rounded-lg text-ink-soft hover:bg-hover" aria-label="Previous month" onClick={() => onPick(addMonths(day, -1))}>‹</button>
        <span className="text-sm font-semibold text-ink" aria-live="polite">{title}</span>
        <button type="button" className="min-h-11 min-w-11 rounded-lg text-ink-soft hover:bg-hover" aria-label="Next month" onClick={() => onPick(addMonths(day, 1))}>›</button>
      </div>
      <div className="grid grid-cols-7 text-center text-[12px] text-ink-faint" aria-hidden="true">{DOW.map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-y-0.5" role="group" aria-label={title}>
        {monthMatrix(day).flat().map((d) => {
          const sel = d === day;
          const isToday = d === today;
          return (
            <button key={d} type="button" data-testid={`mini-${d}`} onClick={() => onPick(d)}
              aria-label={parseDay(d).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
              aria-current={sel ? 'date' : undefined}
              className={`relative h-9 rounded-full text-[13px] ${sel ? 'bg-accent text-on-accent font-bold' : isToday ? 'text-accent-ink font-bold ring-1 ring-accent' : sameMonth(d, day) ? 'text-ink hover:bg-hover' : 'text-ink-faint hover:bg-hover'}`}>
              {Number(d.slice(8))}
              {localBusy.has(d) && !sel && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Doctors with a colour each: tick to show, "Only" to show one; today's load and lateness at a glance. */
export function DoctorList({
  clinicians, selected, onToggle, onOnly, onAll, appts, now,
}: {
  clinicians: PractitionerRow[]; selected: Set<string>; onToggle: (id: string) => void; onOnly: (id: string) => void; onAll: () => void;
  appts: AppointmentRow[]; now: Date;
}) {
  const today = clinicToday();
  return (
    <div data-testid="doctor-list">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-ink-soft">Doctors</h3>
        <button type="button" className="min-h-11 px-2 text-[13px] font-semibold text-accent-ink hover:underline" data-testid="doctors-all" onClick={onAll}>
          {selected.size === clinicians.length ? 'All shown' : 'Show all'}
        </button>
      </div>
      <ul className="space-y-0.5">
        {clinicians.map((c, i) => {
          const mine = appts.filter((a) => a.practitioner_id === c.id && onDay(a, today));
          const booked = mine.filter((a) => holdsSlot(a.status)).length;
          const waiting = mine.filter((a) => a.status === 'checked_in').length;
          const late = runningLate(mine, now, c);
          const on = selected.has(c.id);
          return (
            <li key={c.id} className="group flex items-center gap-1 rounded-lg hover:bg-hover">
              <label className="flex flex-1 min-w-0 items-center gap-2.5 px-2 py-1.5 cursor-pointer min-h-11">
                <input type="checkbox" className="sr-only" checked={on} onChange={() => onToggle(c.id)} data-testid="doctor-toggle" aria-label={`Show ${c.name}`} />
                <span aria-hidden="true" className="w-4 h-4 shrink-0 rounded border-2 flex items-center justify-center"
                  style={{ borderColor: doctorTone(i), background: on ? doctorTone(i) : 'transparent' }}>
                  {on && <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="var(--surface-solid)" strokeWidth="2.2"><path d="M2.5 6.2l2.3 2.3 4.7-5" /></svg>}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink truncate">{c.name}</span>
                  <span className="block text-[12px] text-ink-soft truncate">
                    {c.specialty ?? c.title} · {booked} today{waiting ? ` · ${waiting} waiting` : ''}
                  </span>
                  {late > 0 && <span className="block text-[12px] font-semibold text-gate" data-testid="running-late">Running {late} min late</span>}
                </span>
              </label>
              <button type="button" className="min-h-11 px-2 text-[12px] font-semibold text-ink-soft opacity-100 lg:opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-ink"
                onClick={() => onOnly(c.id)} aria-label={`Show only ${c.name}`} data-testid="doctor-only">Only</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface Filters { visits: Set<VisitType>; statuses: Set<AppointmentStatus> }


/** Visit type and step filters, which double as the colour legend. */
export function FilterPanel({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const flip = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };
  return (
    <div className="space-y-3" data-testid="cal-filters">
      <fieldset>
        <legend className="text-[13px] font-semibold uppercase tracking-wider text-ink-soft mb-1">Patient step</legend>
        <div className="flex flex-wrap gap-1.5">
          {FLOW_ORDER.map((s) => {
            const on = filters.statuses.has(s);
            return (
              <label key={s} className={`inline-flex items-center gap-1.5 min-h-9 rounded-full border px-2.5 text-[12px] font-semibold cursor-pointer ${on ? 'border-line-strong text-ink' : 'border-line text-ink-faint line-through'}`}
                style={{ background: on ? FLOW_BG[s] : 'transparent' }}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange({ ...filters, statuses: flip(filters.statuses, s) })} data-testid={`filter-${s}`} />
                {STATUS_LABEL[s]}
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-[13px] font-semibold uppercase tracking-wider text-ink-soft mb-1">Visit type</legend>
        <div className="flex flex-wrap gap-1.5">
          {ALL_VISITS.map((v) => {
            const on = filters.visits.has(v);
            return (
              <label key={v} className={`inline-flex items-center min-h-9 rounded-full border px-2.5 text-[12px] font-semibold cursor-pointer ${on ? 'border-line-strong bg-surface-2 text-ink' : 'border-line text-ink-faint line-through'}`}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange({ ...filters, visits: flip(filters.visits, v) })} />
                {VISIT_LABEL[v]}
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
