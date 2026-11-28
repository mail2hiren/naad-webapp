import { useState, type ReactNode } from 'react';
import { Btn } from '../ui';
import { apptStart, clinicToday, onDay, timeLabel } from '../../lib/schedule';
import { consultMinutes, minutesLabel, queueOf, waitMinutes, LONG_WAIT_MIN } from '../../lib/calendar';
import type { AppointmentRow, BillRow, PatientRow, PractitionerRow } from '../../types/db';

export type FlowAction = 'check_in' | 'call_in' | 'check_out' | 'no_show' | 'bill';

/**
 * Today's patient flow for the ticked doctors: who is due, who is waiting
 * (and for how long), who is with the doctor, who is done and still to bill.
 * Every step is one tap.
 */
export function FlowPanel({
  doctors, appts, patients, bills, now, toneOf, onOpen, onAction, busyId,
}: {
  doctors: PractitionerRow[]; appts: AppointmentRow[]; patients: Map<string, PatientRow>; bills: BillRow[]; now: Date;
  toneOf: (id: string | null) => string; onOpen: (id: string) => void; onAction: (a: AppointmentRow, act: FlowAction) => void; busyId: string | null;
}) {
  const today = clinicToday();
  const [tab, setTab] = useState<'waiting' | 'arriving' | 'done'>('waiting');
  const ids = new Set(doctors.map((d) => d.id));
  const todays = appts.filter((a) => ids.has(a.practitioner_id ?? '') && onDay(a, today));
  const withDoc = todays.filter((a) => a.status === 'in_consultation');
  const waiting = doctors.flatMap((d) => queueOf(d, todays.filter((a) => a.practitioner_id === d.id), now))
    .sort((a, b) => (a.appt.checked_in_at ?? '').localeCompare(b.appt.checked_in_at ?? ''));
  const arriving = todays.filter((a) => a.status === 'scheduled' || a.status === 'requested').sort((a, b) => apptStart(a)!.getTime() - apptStart(b)!.getTime());
  const done = todays.filter((a) => a.status === 'completed').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const toBill = done.filter((a) => !bills.some((b) => b.appointment_id === a.id && b.status !== 'void'));
  const name = (a: AppointmentRow) => patients.get(a.patient_id)?.name ?? 'Patient';
  const doc = (a: AppointmentRow) => doctors.find((d) => d.id === a.practitioner_id)?.name ?? '';
  const longest = Math.max(0, ...waiting.map((w) => waitMinutes(w.appt, now) ?? 0));

  const Row = ({ a, children, meta }: { a: AppointmentRow; children?: ReactNode; meta: ReactNode }) => (
    <li className="flex items-center gap-2 py-2" data-testid="flow-row" data-status={a.status}>
      <span aria-hidden="true" className="w-1 self-stretch rounded-full" style={{ background: toneOf(a.practitioner_id) }} />
      {a.token_no != null && <span className="shrink-0 rounded-md bg-accent text-on-accent px-1.5 text-[13px] font-bold">{a.token_no}</span>}
      <button type="button" className="min-w-0 flex-1 text-left min-h-11" onClick={() => onOpen(a.id)}>
        <span className="block text-sm font-semibold text-ink truncate">{name(a)}</span>
        <span className="block text-[12px] text-ink-soft truncate">{meta}</span>
      </button>
      <span className="shrink-0 flex gap-1">{children}</span>
    </li>
  );

  return (
    <aside className="rounded-2xl bg-surface shadow-[var(--card-shadow)] p-3" data-testid="flow-panel" aria-label="Patient flow today">
      <h2 className="text-base font-semibold text-ink">Patient flow today</h2>
      <div className="mt-2 grid grid-cols-4 gap-1.5 text-center" data-testid="flow-counts">
        {[['Due', arriving.length], ['Waiting', waiting.length], ['With doctor', withDoc.length], ['Done', done.length]].map(([l, n]) => (
          <div key={l as string} className="rounded-lg bg-surface-2 py-1.5">
            <div className="font-mono text-lg font-bold text-ink">{n}</div>
            <div className="text-[12px] text-ink-soft">{l}</div>
          </div>
        ))}
      </div>
      {longest >= LONG_WAIT_MIN && <p className="mt-2 text-[13px] font-semibold text-danger" data-testid="long-wait">Longest wait {minutesLabel(longest)}. Tell the patient, or let the doctor know.</p>}

      {withDoc.length > 0 && (
        <>
          <h3 className="mt-3 text-[13px] font-semibold uppercase tracking-wider text-ink-soft">With doctor</h3>
          <ul className="divide-y divide-line" data-testid="flow-with">
            {withDoc.map((a) => (
              <Row key={a.id} a={a} meta={`${doc(a)} · ${minutesLabel(consultMinutes(a, now) ?? 0)} in`}>
                <Btn variant="default" className="!px-2" data-testid="flow-check-out" disabled={busyId === a.id} onClick={() => onAction(a, 'check_out')}>Check out</Btn>
              </Row>
            ))}
          </ul>
        </>
      )}

      <div className="mt-3 flex gap-1 border-b border-line" role="tablist">
        {([['waiting', `Waiting (${waiting.length})`], ['arriving', `Due (${arriving.length})`], ['done', `Done (${done.length})`]] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} data-testid={`flow-tab-${k}`} onClick={() => setTab(k)}
            className={`min-h-11 px-2.5 text-[13px] font-semibold border-b-2 -mb-px ${tab === k ? 'border-accent-ink text-accent-ink' : 'border-transparent text-ink-soft hover:text-ink'}`}>{l}</button>
        ))}
      </div>

      {tab === 'waiting' && (
        <ul className="divide-y divide-line" data-testid="flow-waiting">
          {waiting.length === 0 && <li className="py-3 text-sm text-ink-soft">Nobody is waiting.</li>}
          {waiting.map(({ appt: a, position, estWait }) => {
            const w = waitMinutes(a, now) ?? 0;
            return (
              <Row key={a.id} a={a} meta={<>
                <span className={w >= LONG_WAIT_MIN ? 'font-semibold text-danger' : ''}>Waiting {minutesLabel(w)}</span>
                {` · ${doc(a)} · ${position === 1 ? 'next in' : `about ${minutesLabel(estWait)} more`}`}
              </>}>
                <Btn variant="glow" className="!px-2" data-testid="flow-call-in" disabled={busyId === a.id} onClick={() => onAction(a, 'call_in')}>Call in</Btn>
              </Row>
            );
          })}
        </ul>
      )}

      {tab === 'arriving' && (
        <ul className="divide-y divide-line" data-testid="flow-arriving">
          {arriving.length === 0 && <li className="py-3 text-sm text-ink-soft">No one else is due today.</li>}
          {arriving.map((a) => {
            const s = apptStart(a)!;
            const late = Math.round((now.getTime() - s.getTime()) / 60_000);
            return (
              <Row key={a.id} a={a} meta={<>
                {timeLabel(s)} · {doc(a)}
                {a.status === 'requested' ? ' · To confirm' : late >= 15 ? <span className="font-semibold text-gate"> · {late} min late</span> : ''}
              </>}>
                {a.status === 'scheduled' && <Btn variant="default" className="!px-2" data-testid="flow-check-in" disabled={busyId === a.id} onClick={() => onAction(a, 'check_in')}>Check in</Btn>}
                {a.status === 'scheduled' && late >= 15 && <Btn variant="ghost" className="!px-2" data-testid="flow-no-show" disabled={busyId === a.id} onClick={() => onAction(a, 'no_show')}>No-show</Btn>}
              </Row>
            );
          })}
        </ul>
      )}

      {tab === 'done' && (
        <ul className="divide-y divide-line" data-testid="flow-done">
          {done.length === 0 && <li className="py-3 text-sm text-ink-soft">No visits finished yet.</li>}
          {done.map((a) => {
            const billed = !toBill.includes(a);
            const mins = consultMinutes(a, now);
            return (
              <Row key={a.id} a={a} meta={`${doc(a)}${a.completed_at ? ` · out ${timeLabel(new Date(a.completed_at))}` : ''}${mins != null ? ` · ${mins} min with doctor` : ''} · ${billed ? 'Billed' : 'To bill'}`}>
                {!billed && <Btn variant="default" className="!px-2" data-testid="flow-bill" onClick={() => onAction(a, 'bill')}>Bill</Btn>}
              </Row>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
