import { apptStart, clinicToday, dayKey, holdsSlot, parseDay } from '../../lib/schedule';
import { blocksOn, monthMatrix, sameMonth } from '../../lib/calendar';
import type { AppointmentRow, CalendarBlockRow, PatientRow, PractitionerRow } from '../../types/db';
import { BLOCK_LABEL, shortTime } from './shared';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Month view: each day's load at a glance (booked, done, no-shows, blocked); click a day to open it. */
export function MonthGrid({
  day, doctors, appts, blocks, patients, toneOf, onPick,
}: {
  day: string; doctors: PractitionerRow[]; appts: AppointmentRow[]; blocks: CalendarBlockRow[];
  patients: Map<string, PatientRow>; toneOf: (id: string | null) => string; onPick: (d: string) => void;
}) {
  const today = clinicToday();
  const ids = new Set(doctors.map((d) => d.id));
  const byDay = new Map<string, AppointmentRow[]>();
  appts.forEach((a) => {
    const s = apptStart(a);
    if (!s || !ids.has(a.practitioner_id ?? '')) return;
    const k = dayKey(s);
    byDay.set(k, [...(byDay.get(k) ?? []), a]);
  });
  return (
    <div className="rounded-2xl bg-surface shadow-[var(--card-shadow)] overflow-x-auto" data-testid="month-grid">
      <div className="grid grid-cols-7 min-w-[44rem]">
        {DOW.map((d) => <div key={d} className="px-2 py-2 text-[12px] font-semibold uppercase tracking-wider text-ink-soft border-b border-line">{d}</div>)}
        {monthMatrix(day).flat().map((d) => {
          const list = (byDay.get(d) ?? []).sort((a, b) => apptStart(a)!.getTime() - apptStart(b)!.getTime());
          const held = list.filter((a) => holdsSlot(a.status));
          const done = list.filter((a) => a.status === 'completed').length;
          const missed = list.filter((a) => a.status === 'no_show').length;
          const requests = list.filter((a) => a.status === 'requested').length;
          const dayBlocks = doctors.length ? Array.from(new Map(doctors.flatMap((doc) => blocksOn(blocks, doc.id, d)).map((b) => [b.block.id, b.block])).values()) : [];
          const label = parseDay(d).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
          return (
            <button key={d} type="button" data-testid="month-day" data-day={d} onClick={() => onPick(d)}
              aria-label={`${label}: ${held.length} booked${done ? `, ${done} done` : ''}${missed ? `, ${missed} no-show` : ''}`}
              className={`min-h-28 border-b border-l border-line p-1.5 text-left align-top hover:bg-hover focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent ${sameMonth(d, day) ? '' : 'bg-[var(--off-hours)]'}`}>
              <span className="flex items-center justify-between">
                <span className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full text-[13px] font-semibold ${d === today ? 'bg-accent text-on-accent' : sameMonth(d, day) ? 'text-ink' : 'text-ink-faint'}`}>{Number(d.slice(8))}</span>
                {held.length > 0 && <span className="text-[12px] font-semibold text-ink-soft">{held.length} booked</span>}
              </span>
              {dayBlocks.slice(0, 1).map((b) => (
                <span key={b.id} className="mt-1 block truncate rounded cal-hatch px-1 text-[12px] font-semibold text-ink-soft">{BLOCK_LABEL[b.kind]}</span>
              ))}
              <span className="mt-1 block space-y-0.5">
                {held.slice(0, 3).map((a) => (
                  <span key={a.id} className="flex items-center gap-1 text-[12px] text-ink truncate">
                    <span aria-hidden="true" className="w-1.5 h-1.5 shrink-0 rounded-full" style={{ background: toneOf(a.practitioner_id) }} />
                    <span className="text-ink-soft">{shortTime(apptStart(a)!)}</span>
                    <span className="truncate">{patients.get(a.patient_id)?.name.split(' ')[0] ?? ''}</span>
                  </span>
                ))}
                {held.length > 3 && <span className="block text-[12px] font-semibold text-accent-ink">+{held.length - 3} more</span>}
              </span>
              {(done > 0 || missed > 0 || requests > 0) && (
                <span className="mt-1 block text-[12px] text-ink-soft">
                  {[done ? `${done} done` : '', missed ? `${missed} no-show` : '', requests ? `${requests} to confirm` : ''].filter(Boolean).join(' · ')}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
