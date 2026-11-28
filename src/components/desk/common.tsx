import { useState, type ReactNode } from 'react';
import { inputCls } from '../ui';
import { OUTCOME_LABEL } from './labels';
import type { ContactOutcome } from '../../types/desk';


/** One tap to record how a call went, with an optional note. */
export function CallOutcome({ outcomes, onSave, busy, testid = 'call-outcome' }: { outcomes: ContactOutcome[]; onSave: (o: ContactOutcome, note: string) => void; busy?: boolean; testid?: string }) {
  const [note, setNote] = useState('');
  return (
    <div className="mt-2 rounded-lg border border-line p-2" data-testid={testid}>
      <input className={`${inputCls} !min-h-9 text-sm`} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Call note" />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {outcomes.map((o) => (
          <button key={o} type="button" disabled={busy} data-testid={`outcome-${o}`} onClick={() => { onSave(o, note); setNote(''); }}
            className="min-h-9 rounded-full border border-line-strong px-3 text-[13px] font-semibold text-ink hover:bg-hover disabled:opacity-40">{OUTCOME_LABEL[o]}</button>
        ))}
      </div>
    </div>
  );
}

export function PageTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1.5" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} data-testid={`desk-tab-${t.id}`} onClick={() => onChange(t.id)}
          className={`min-h-11 rounded-full border px-3.5 text-sm font-semibold ${value === t.id ? 'bg-accent text-on-accent border-accent' : 'border-line-strong text-ink-soft hover:bg-hover'}`}>{t.label}</button>
      ))}
    </div>
  );
}

export function Row({ title, meta, children, testid, tone }: { title: ReactNode; meta?: ReactNode; children?: ReactNode; testid?: string; tone?: 'danger' | 'gate' | 'ok' }) {
  return (
    <li className="py-2.5" data-testid={testid}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 flex items-start gap-2">
          {tone && <span aria-hidden="true" className={`mt-1.5 w-2 h-2 shrink-0 rounded-full ${tone === 'danger' ? 'bg-danger' : tone === 'gate' ? 'bg-gate' : 'bg-ok'}`} />}
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">{title}</span>
            {meta && <span className="block text-[13px] text-ink-soft">{meta}</span>}
          </span>
        </span>
      </div>
      {children}
    </li>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <li className="py-3 text-sm text-ink-soft">{children}</li>;
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'danger' | 'gate' | 'ok' }) {
  return (
    <div className="rounded-xl bg-surface shadow-[var(--card-shadow)] px-3 py-2">
      <div className={`font-mono text-lg font-bold ${tone === 'danger' ? 'text-danger' : tone === 'gate' ? 'text-gate' : tone === 'ok' ? 'text-ok' : 'text-ink'}`}>{value}</div>
      <div className="text-[12px] text-ink-soft">{label}</div>
    </div>
  );
}

export function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-1.5 flex flex-wrap gap-1.5">{children}</div>;
}
