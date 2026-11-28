import { useEffect, useRef, useState } from 'react';
import { useClinic } from '../../context/ClinicContext';
import { useClinicians } from '../../hooks/useClinicians';
import { clinicNow, clinicToday, onDay } from '../../lib/schedule';
import { queueOf, runningLate } from '../../lib/calendar';
import { playSoftChime } from '../../lib/chime';
import { doctorTone } from '../../lib/calendar';
import { useOrgName } from '../../hooks/useCalendarData';

/**
 * Waiting-room screen for a TV or a spare tablet: each doctor's token now
 * being seen and the next tokens, with a chime when a token is called.
 * Shows tokens and first names only, never anything clinical.
 */
export function TokenScreen() {
  const { orgId, appointments, patients } = useClinic();
  const clinicians = useClinicians();
  const orgName = useOrgName(orgId);
  const [now, setNow] = useState(clinicNow());
  const today = clinicToday();
  const seen = useRef<string>('');

  useEffect(() => { const t = setInterval(() => setNow(clinicNow()), 30_000); return () => clearInterval(t); }, []);

  const boards = clinicians.map((d, i) => {
    const mine = appointments.filter((a) => a.practitioner_id === d.id && onDay(a, today));
    const current = mine.find((a) => a.status === 'in_consultation');
    const next = queueOf(d, mine, now).slice(0, 4);
    return { d, i, current, next, late: runningLate(mine, now, d), working: mine.length > 0 };
  }).filter((b) => b.working);

  const calledKey = boards.map((b) => b.current?.id ?? '').join('|');
  useEffect(() => {
    if (seen.current && seen.current !== calledKey) playSoftChime();
    seen.current = calledKey;
  }, [calledKey]);

  const first = (id: string) => patients.find((p) => p.id === id)?.name.split(' ')[0] ?? '';

  return (
    <div className="min-h-screen bg-bg p-6" data-testid="token-screen">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold text-ink">{orgName}</h1>
        <p className="text-2xl font-semibold text-ink-soft" aria-live="polite">{now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</p>
      </header>
      <div className="mt-6 grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))' }}>
        {boards.length === 0 && <p className="text-xl text-ink-soft">No clinics running now.</p>}
        {boards.map(({ d, i, current, next, late }) => (
          <section key={d.id} className="rounded-3xl bg-surface shadow-[var(--card-shadow)] p-6" style={{ borderTop: `8px solid ${doctorTone(i)}` }} data-testid="token-board" aria-label={d.name}>
            <h2 className="text-2xl font-bold text-ink">{d.name}</h2>
            <p className="text-lg text-ink-soft">{d.specialty ?? d.title}{late ? ` · running about ${late} min late` : ''}</p>
            <p className="mt-4 text-sm font-semibold uppercase tracking-wider text-ink-soft">Now seeing</p>
            <p className="text-7xl font-bold text-accent-ink leading-none" data-testid="token-now">{current?.token_no ?? '–'}</p>
            {current && <p className="text-xl text-ink">{first(current.patient_id)}</p>}
            <p className="mt-5 text-sm font-semibold uppercase tracking-wider text-ink-soft">Next</p>
            <p className="text-3xl font-bold text-ink" data-testid="token-next">{next.length ? next.map((n) => n.appt.token_no ?? '·').join('   ') : '–'}</p>
          </section>
        ))}
      </div>
      <p className="mt-8 text-lg text-ink-soft">Please wait for your token. Tell the front desk if you have been waiting more than 20 minutes.</p>
    </div>
  );
}
