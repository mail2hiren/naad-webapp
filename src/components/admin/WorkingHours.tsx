import { useState } from 'react';
import { Btn, Card, Pill, SectionHead } from '../ui';
import { useClinic } from '../../context/ClinicContext';
import { useClinicians } from '../../hooks/useClinicians';
import { supabase } from '../../lib/supabaseClient';
import { DEFAULT_HOURS, WEEK, slotLength, validateHours, weeklySlots } from '../../lib/schedule';
import type { PractitionerRow, Weekday, WorkingHours } from '../../types/db';

const timeCls = 'min-h-11 rounded-lg border border-line-strong bg-surface-solid px-2 text-[15px] text-ink focus:outline-none focus:ring-2 focus:ring-accent';
const LENGTHS = [10, 15, 20, 30, 45, 60];

/** Each doctor's and physio's working days, sessions and slot length. The
 * reception calendar builds its free slots from exactly this. */
export function WorkingHoursSection() {
  const clinicians = useClinicians();
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <Card className="mb-4">
        <SectionHead title="Doctors and physiotherapists" desc="When each doctor and physiotherapist sees patients. Reception can only book inside these hours." />
        <ul className="divide-y divide-line">
          {clinicians.map((c) => {
            const hours = c.working_hours ?? DEFAULT_HOURS;
            const days = WEEK.filter(({ key }) => (hours[key] ?? []).length > 0).map(({ label }) => label.slice(0, 3));
            return (
              <li key={c.id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink">{c.name}</div>
                    <div className="text-[13px] text-ink-soft">
                      {days.join(', ') || 'No working days'} · {slotLength(c)}-min slots · {weeklySlots(hours, slotLength(c))} slots a week
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!c.working_hours && <Pill>Hospital hours</Pill>}
                    <Btn variant="primary" data-testid="edit-hours" aria-expanded={openId === c.id} onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                      {openId === c.id ? 'Close' : 'Edit hours'}
                    </Btn>
                  </div>
                </div>
                {openId === c.id && <HoursEditor key={c.id} doctor={c} onDone={() => setOpenId(null)} />}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[13px] text-ink-faint">Hospital hours: Monday to Saturday, 9:30 am to 1:30 pm and 4:00 pm to 7:00 pm. Changes apply to new bookings; booked appointments stay where they are.</p>
      </Card>
    </>
  );
}

type Draft = Record<Weekday, { on: boolean; sessions: [string, string][] }>;

function toDraft(h: WorkingHours): Draft {
  return Object.fromEntries(WEEK.map(({ key }) => {
    const s = h[key] ?? [];
    return [key, { on: s.length > 0, sessions: s.length ? s.map((x) => [...x] as [string, string]) : [['09:30', '13:30']] }];
  })) as Draft;
}

function fromDraft(d: Draft): WorkingHours {
  return Object.fromEntries(WEEK.filter(({ key }) => d[key].on).map(({ key }) => [key, d[key].sessions])) as WorkingHours;
}

function HoursEditor({ doctor, onDone }: { doctor: PractitionerRow; onDone: () => void }) {
  const { pushToast, logAudit } = useClinic();
  const [draft, setDraft] = useState<Draft>(() => toDraft(doctor.working_hours ?? DEFAULT_HOURS));
  const [len, setLen] = useState<number>(slotLength(doctor));
  const [saving, setSaving] = useState(false);
  const hours = fromDraft(draft);
  const problem = validateHours(hours);

  const setDay = (k: Weekday, patch: Partial<Draft[Weekday]>) => setDraft({ ...draft, [k]: { ...draft[k], ...patch } });
  const setTime = (k: Weekday, i: number, j: 0 | 1, v: string) =>
    setDay(k, { sessions: draft[k].sessions.map((s, n) => (n === i ? (j === 0 ? [v, s[1]] : [s[0], v]) : s)) as [string, string][] });

  async function save(reset = false) {
    setSaving(true);
    const patch = reset ? { working_hours: null, slot_minutes: null } : { working_hours: hours, slot_minutes: len };
    const { error } = await supabase.from('practitioners').update(patch).eq('id', doctor.id);
    setSaving(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not save working hours', detail: error.message }); return; }
    await logAudit('admin-working-hours', `${doctor.name}: ${reset ? 'hospital hours' : `${weeklySlots(hours, len)} slots a week, ${len}-min`}`);
    pushToast({ tone: 'ok', title: 'Working hours saved', detail: doctor.name });
    onDone();
  }

  return (
    <div className="mt-3 rounded-lg border border-line p-3" data-testid="hours-editor">
      <div className="space-y-2">
        {WEEK.map(({ key, label }) => (
          <fieldset key={key} className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">{label}</legend>
            <label className="inline-flex items-center gap-2 min-h-11 w-32 text-sm text-ink">
              <input type="checkbox" data-testid={`day-${key}`} checked={draft[key].on} onChange={(e) => setDay(key, { on: e.target.checked })} />
              {label}
            </label>
            {draft[key].on ? (
              <>
                {draft[key].sessions.map((s, i) => (
                  <span key={i} className="inline-flex items-center gap-1">
                    <input type="time" className={timeCls} aria-label={`${label} session ${i + 1} from`} value={s[0]} onChange={(e) => setTime(key, i, 0, e.target.value)} />
                    <span className="text-ink-soft text-sm">to</span>
                    <input type="time" className={timeCls} aria-label={`${label} session ${i + 1} to`} value={s[1]} onChange={(e) => setTime(key, i, 1, e.target.value)} />
                  </span>
                ))}
                {draft[key].sessions.length === 1
                  ? <Btn variant="default" onClick={() => setDay(key, { sessions: [...draft[key].sessions, ['16:00', '19:00']] })}>+ Evening</Btn>
                  : <Btn variant="ghost" onClick={() => setDay(key, { sessions: draft[key].sessions.slice(0, 1) })}>Remove evening</Btn>}
              </>
            ) : <span className="text-sm text-ink-soft">Day off</span>}
          </fieldset>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-ink">
        Slot length
        <select className={timeCls} data-testid="slot-length" value={len} onChange={(e) => setLen(Number(e.target.value))}>
          {LENGTHS.map((m) => <option key={m} value={m}>{m} minutes</option>)}
        </select>
      </label>
      <p className={`mt-2 text-[13px] ${problem ? 'text-danger' : 'text-ink-soft'}`} role={problem ? 'alert' : undefined} data-testid="hours-summary">
        {problem ?? `${weeklySlots(hours, len)} bookable slots a week.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn variant="glow" data-testid="save-hours" disabled={saving || !!problem} onClick={() => save()}>{saving ? 'Saving…' : 'Save hours'}</Btn>
        {doctor.working_hours && <Btn variant="default" disabled={saving} onClick={() => save(true)}>Use hospital hours</Btn>}
        <Btn variant="ghost" onClick={onDone}>Cancel</Btn>
      </div>
    </div>
  );
}
