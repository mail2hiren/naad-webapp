import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { getTheme, setTheme, type Theme } from '../lib/theme';
import { ROLE_NAV, type IconName, type NavItem } from '../lib/nav';
import { NaadLogo } from './Brand';

const ICON_PATH: Record<IconName, string> = {
  queue: 'M4 6h16M4 12h16M4 18h10',
  calendar: 'M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  userPlus: 'M15 19a6 6 0 0 0-12 0M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm10-3v6m3-3h-6',
  stethoscope: 'M6 3v6a4 4 0 0 0 8 0V3M10 13v3a4 4 0 0 0 8 0v-2m0 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  bed: 'M3 18V7m0 7h18v4M3 14V11h7v3m4 0v-3h4a3 3 0 0 1 3 3',
  pill: 'M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7zM7 10l7 7',
  box: 'M21 8 12 3 3 8m18 0v8l-9 5m9-13-9 5m0 8-9-5V8m9 13v-8m0 0L3 8',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  users: 'M16 19a4 4 0 0 0-8 0M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 8a3 3 0 0 0-3-3m-1-5a3 3 0 1 0 0-6M4 19a3 3 0 0 1 3-3m1-5a3 3 0 1 1 0-6',
  rupee: 'M7 4h10M7 9h10M7 4c4 0 6 2 6 5s-2 5-6 5l7 6',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zm3 5h6m-6 4h6m-6 4h3',
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATH[name]} />
    </svg>
  );
}

/** Shared page chrome for every staff route: a left sidebar with the role's
 * pages, the hospital name, the signed-in person, theme and sign-out. On a
 * phone the sidebar becomes a slide-in menu. */
export default function Shell({ title, children }: { title: string; children: ReactNode }) {
  const { practitioner, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const pageStart = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [hospital, setHospital] = useState<string | null>(null);
  const items = practitioner ? ROLE_NAV[practitioner.role] : [];
  const currentSection = new URLSearchParams(search).get('section');

  /* An SPA route change keeps focus wherever it was, so the next Tab would
   * skip past the skip link. Reset focus to the top of the page and give each
   * page its own tab title, the way a full page load would. */
  useEffect(() => {
    document.title = `${title} — Naad`;
    pageStart.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname, search, title]);

  useEffect(() => {
    if (!practitioner) return;
    let alive = true;
    supabase.from('organizations').select('name').eq('id', practitioner.org_id).maybeSingle().then(({ data }) => {
      if (alive) setHospital((data as { name?: string } | null)?.name ?? null);
    });
    return () => { alive = false; };
  }, [practitioner]);

  function isActive(item: NavItem, index: number) {
    if (pathname !== item.to) return false;
    if (!item.section) return true;
    const firstForPath = items.findIndex((i) => i.to === item.to) === index;
    return currentSection ? currentSection === item.section : firstForPath;
  }

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  }

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-5 pb-4 border-b border-white/10">
        <NaadLogo tone="light" sub={hospital ?? undefined} />
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-1" data-testid="workspace-nav">
        {items.map((item, i) => {
          const active = isActive(item, i);
          const href = item.section ? `${item.to}?section=${item.section}` : item.to;
          const testId = `nav-${item.to.slice(1)}${item.section ? `-${item.section}` : ''}`;
          return (
            <Link
              key={href}
              to={href}
              data-testid={testId}
              aria-current={active ? 'page' : undefined}
              onClick={() => setMenuOpen(false)}
              className={`flex items-center gap-3 min-h-11 rounded-lg px-3 text-[15px] font-medium transition-colors ${
                active ? 'bg-sidebar-active text-sidebar-ink' : 'text-sidebar-faint hover:text-sidebar-ink hover:bg-white/5'
              }`}
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-4 border-t border-white/10">
        {practitioner && (
          <div className="mb-3">
            <div className="text-sm font-semibold text-sidebar-ink truncate">{practitioner.name}</div>
            <div className="text-xs text-sidebar-faint truncate">{practitioner.title}</div>
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            data-testid="theme-toggle"
            className="flex-1 min-h-11 rounded-lg text-sm font-medium text-sidebar-faint hover:text-sidebar-ink hover:bg-white/5 border border-white/10"
          >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            data-testid="sign-out"
            className="flex-1 min-h-11 rounded-lg text-sm font-semibold text-sidebar-ink hover:bg-white/5 border border-white/10"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen md:flex">
      <div ref={pageStart} tabIndex={-1} className="sr-only">
        {title}
      </div>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-accent focus:text-on-accent focus:px-4 focus:py-2 focus:font-bold"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="hidden md:block w-64 shrink-0 bg-sidebar sticky top-0 h-screen">{sidebar}</aside>

      {/* Phone top bar + slide-in menu */}
      <header className="md:hidden sticky top-0 z-40 bg-sidebar px-4 py-3 flex items-center justify-between">
        <NaadLogo tone="light" />
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          className="min-h-11 min-w-11 rounded-lg text-sidebar-ink border border-white/10"
        >
          ☰
        </button>
      </header>
      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="w-72 max-w-[85%] bg-sidebar h-full">{sidebar}</div>
          <button type="button" aria-label="Close menu" className="flex-1 bg-black/40" onClick={() => setMenuOpen(false)} />
        </div>
      )}

      <main id="main" tabIndex={-1} className="flex-1 min-w-0 focus:outline-none">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8">
          <h1 className="text-2xl md:text-[28px] mb-6">{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}
