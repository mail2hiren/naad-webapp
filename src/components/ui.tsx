import { useState } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

/**
 * Shared primitives matching the live app's existing design system 1:1
 * (borderless tinted cards, text-style buttons with accent/gate/danger
 * variants, mono micro-labels, dot-status pills) -- reused by every route
 * view so the whole app reads as one system, not six different builds.
 */

export function Card({ children, className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`bg-surface rounded-[var(--radius)] p-5 md:p-6 ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function Panel({ children, className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-surface-panel backdrop-blur-2xl border border-line-strong rounded-[var(--radius-lg)] shadow-2xl ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

type BtnVariant = 'default' | 'primary' | 'gate' | 'danger' | 'ghost' | 'glow';
const BTN_VARIANT: Record<BtnVariant, string> = {
  default: 'text-ink-soft hover:bg-white/5 hover:text-ink',
  primary: 'text-accent-ink font-bold hover:bg-white/5',
  gate: 'text-gate font-bold hover:bg-white/5',
  danger: 'text-danger hover:bg-danger-soft',
  ghost: 'text-ink-faint hover:text-ink hover:bg-white/5',
  glow: 'bg-accent-ink text-[#04121c] font-bold hover:brightness-110 shadow-[0_0_0_0_rgba(143,217,255,.6)] hover:shadow-[0_0_18px_1px_rgba(143,217,255,.55)]',
};
export function Btn({
  variant = 'default', className = '', children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${BTN_VARIANT[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

type PillTone = 'default' | 'gate' | 'ok' | 'danger' | 'accent';
const PILL_TONE: Record<PillTone, string> = {
  default: 'text-ink-faint', gate: 'text-gate', ok: 'text-ok', danger: 'text-danger', accent: 'text-accent-ink',
};
export function Pill({ tone = 'default', children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider uppercase font-semibold whitespace-nowrap ${PILL_TONE[tone]}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />
      {children}
    </span>
  );
}

export function SectionHead({ eyebrow, title, desc }: { eyebrow?: string; title: string; desc?: string }) {
  return (
    <div className="mb-5">
      {eyebrow && <div className="font-mono text-[10px] tracking-[.14em] uppercase text-accent-ink mb-1.5">{eyebrow}</div>}
      <h2 className="text-xl md:text-2xl">{title}</h2>
      {desc && <p className="text-ink-faint text-sm font-light mt-1.5 max-w-[56ch] leading-relaxed">{desc}</p>}
    </div>
  );
}

export function StatTile({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: PillTone }) {
  return (
    <Card className="!p-4">
      <div className={`font-mono text-xl font-bold ${PILL_TONE[tone] === 'text-ink-faint' ? 'text-ink' : PILL_TONE[tone]}`}>{value}</div>
      <div className="text-[11px] text-ink-faint mt-1 tracking-wide">{label}</div>
    </Card>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block mt-2.5">
      <span className="block font-mono text-[9.5px] tracking-wider uppercase text-ink-faint mb-1.5">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  'w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent';

/**
 * Add/remove/edit list of short text entries, one per line with a bullet
 * marker -- the same interaction the Precautions and Dos & Don'ts fields
 * already used, now shared so Examination/Assessment (and anything else
 * that wants a scannable bullet field instead of a paragraph textarea) get
 * it too (doctor feedback, 2026-09-03: assessment/examination need to read
 * as bullet points, not a paragraph, for a quick glance mid-consult).
 */
export function BulletListEditor({
  items, onChange, placeholder, addLabel = '+ Add point', emptyLabel = 'Nothing added yet.',
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  emptyLabel?: string;
}) {
  function add() { onChange([...items, '']); }
  function update(idx: number, val: string) { onChange(items.map((it, i) => (i === idx ? val : it))); }
  function remove(idx: number) { onChange(items.filter((_, i) => i !== idx)); }

  return (
    <div>
      <div className="flex flex-col gap-1.5">
        {items.map((it, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <span className="text-ink-soft text-sm shrink-0 select-none" aria-hidden="true">•</span>
            <input
              className={inputCls}
              data-testid="bullet-input"
              placeholder={placeholder}
              value={it}
              onChange={(e) => update(idx, e.target.value)}
            />
            <Btn variant="danger" onClick={() => remove(idx)}>✕</Btn>
          </div>
        ))}
        {items.length === 0 && <p className="text-ink-faint text-xs">{emptyLabel}</p>}
      </div>
      <Btn type="button" variant="ghost" className="mt-1.5 !px-0" data-testid="bullet-add" onClick={add}>{addLabel}</Btn>
    </div>
  );
}

/** Read-only rendering of a bullet field -- for the patient portal and any
 * other display-only surface. Renders nothing but a placeholder dash when
 * empty rather than an empty list. */
export function BulletList({ items, emptyLabel = '—' }: { items: string[]; emptyLabel?: string }) {
  if (items.length === 0) return <p className="text-ink-soft">{emptyLabel}</p>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((it, idx) => (
        <li key={idx} className="text-ink-soft flex items-start gap-1.5">
          <span className="shrink-0" aria-hidden="true">•</span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Collapsible -- an independently-expandable section with a ▲/▼ arrow
 * header, for long single-scroll panels like the Clinical Note (doctor
 * feedback, Dr. Jayani round 2, 2026-09-03: "you had put nice arrows where
 * each section could be expanded or collapsed"). Deliberately its own
 * uncoordinated state per instance -- unlike PatientPortalView's visit
 * accordion (one open at a time via a shared `expandedId`), each
 * Collapsible here opens/closes on its own, so a doctor can have History
 * and Rehab Exercises open together while Precautions stays collapsed.
 */
export function Collapsible({
  title, defaultOpen = true, children, testId,
}: { title: ReactNode; defaultOpen?: boolean; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-testid={testId ? `${testId}-toggle` : undefined}
        className="w-full flex items-center justify-between gap-2 py-1 text-left"
      >
        <span className="font-mono text-[9.5px] uppercase text-ink-faint">{title}</span>
        <span className="text-ink-faint text-[10px]" aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

export function Modal({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-bg/80 backdrop-blur-sm p-0 md:p-6" onClick={onClose}>
      <div
        className="w-full md:max-w-lg max-h-[90vh] overflow-y-auto bg-[#0b0e17] border border-line-strong rounded-t-3xl md:rounded-2xl p-5 md:p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function DeviceFrame({ children, focused = false, className = '' }: { children: ReactNode; focused?: boolean; className?: string }) {
  return (
    <div className={`device-frame ${focused ? 'focused' : ''} relative flex flex-col overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

/**
 * AmbientOrb -- the product's signature "listening" visual: an organic
 * morphing blob (see .aura-orb in index.css), not a plain spinner or mic
 * icon. `active` drives the live/paused animation state; `size` picks
 * between a compact inline accent ('sm', next to a status line) and a
 * centerpiece placement ('hero', wrapped in .orb-stage so it reads as the
 * focal point of the ambient-capture card, the way it did in the original
 * design language before this route was split apart).
 */
export function AmbientOrb({ active, size = 'sm' }: { active: boolean; size?: 'sm' | 'hero' }) {
  const dim = size === 'hero' ? 'w-20 h-20 md:w-24 md:h-24' : 'w-10 h-10';
  const orb = <div className={`aura-orb ${dim} shrink-0 ${active ? '' : 'paused'}`} />;
  if (size === 'sm') return orb;
  return <div className="orb-stage">{orb}</div>;
}

/**
 * Tabs -- a lightweight underline tab bar used to split a long single-scroll
 * workspace (e.g. Doctor Portal's consult view) into focused panels without
 * losing anything: every tab's content still exists, just one panel shows
 * at a time. Each tab gets `data-testid="tab-<id>"` so Playwright can target
 * it directly regardless of label text.
 */
export function Tabs<T extends string>({
  tabs, activeId, onChange,
}: { tabs: { id: T; label: string }[]; activeId: T; onChange: (id: T) => void }) {
  return (
    <div className="flex items-center gap-1 border-b border-line mb-4 overflow-x-auto" role="tablist">
      {tabs.map((t) => {
        const isActive = t.id === activeId;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`tab-${t.id}`}
            onClick={() => onChange(t.id)}
            className={`shrink-0 px-3.5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              isActive ? 'border-accent-ink text-accent-ink' : 'border-transparent text-ink-faint hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
