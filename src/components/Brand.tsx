/** Naad's mark: five rounded sound bars ("naad" means sound). Same mark as
 * the printed leaflet and the app icon. */
export function NaadMark({ className = 'w-7 h-6', onDark = false }: { className?: string; onDark?: boolean }) {
  // On a dark sidebar use the bright brand teal; elsewhere follow the theme.
  const a = onDark ? '#6EE7D8' : 'var(--accent)';
  const b = onDark ? '#8FD9FF' : 'var(--accent-ink)';
  return (
    <svg className={className} viewBox="0 0 30 24" aria-hidden="true" focusable="false">
      <rect x="0" y="9" width="3.4" height="6" rx="1.7" fill={a} />
      <rect x="6.6" y="4" width="3.4" height="16" rx="1.7" fill={a} />
      <rect x="13.2" y="0" width="3.4" height="24" rx="1.7" fill={b} />
      <rect x="19.8" y="5.5" width="3.4" height="13" rx="1.7" fill={a} />
      <rect x="26.4" y="9.5" width="3.4" height="5" rx="1.7" fill={a} />
    </svg>
  );
}

/** Mark + wordmark. `tone="light"` is for dark backgrounds (sidebar). */
export function NaadLogo({ tone = 'auto', sub }: { tone?: 'auto' | 'light'; sub?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <NaadMark onDark={tone === 'light'} />
      <div className="leading-tight">
        <div className={`text-xl font-extrabold tracking-tight ${tone === 'light' ? 'text-sidebar-ink' : 'text-ink'}`}>Naad</div>
        {sub && <div className={`text-xs ${tone === 'light' ? 'text-sidebar-faint' : 'text-ink-faint'}`}>{sub}</div>}
      </div>
    </div>
  );
}
