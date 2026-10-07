import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { StaffRole } from '../types/db';

/** Every workspace route a role can reach -- must mirror the `allow` lists
 * on each <ProtectedRoute> in App.tsx. Several roles (surgeon/physio land on
 * both Doctor + Ward; admin lands on both Admin + Ward) have more than one
 * reachable workspace, so Shell needs real navigation between them rather
 * than forcing staff to hand-edit the URL. */
const ROLE_NAV: Record<StaffRole, { to: string; label: string }[]> = {
  receptionist: [{ to: '/reception', label: 'Front Desk' }],
  surgeon: [{ to: '/doctor', label: 'Doctor' }, { to: '/inpatient', label: 'Ward' }],
  physio: [{ to: '/doctor', label: 'Doctor' }, { to: '/inpatient', label: 'Ward' }],
  pharmacist: [{ to: '/pharmacy', label: 'Pharmacy' }],
  admin: [{ to: '/admin', label: 'Admin' }, { to: '/inpatient', label: 'Ward' }],
};

/** Shared page chrome for every staff route: sticky glass topbar with the
 * brand mark, workspace nav for roles with more than one reachable route,
 * the signed-in practitioner's name/role, and sign-out -- matching the live
 * app's existing `.topbar`/glass-panel treatment. */
export default function Shell({ title, children }: { title: string; children: ReactNode }) {
  const { practitioner, signOut } = useAuth();
  const navigate = useNavigate();
  const navLinks = practitioner ? ROLE_NAV[practitioner.role] : [];

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-accent-ink focus:text-[#04121c] focus:px-4 focus:py-2 focus:font-bold"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-40 bg-surface-panel backdrop-blur-2xl border-b border-line-strong px-4 md:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-2.5">
          <b className="font-extrabold text-[1.1rem] tracking-wide bg-gradient-to-r from-ink to-accent-ink bg-clip-text text-transparent">NAAD</b>
          <span className="font-mono text-[10px] text-ink-faint">{title}</span>
        </div>
        {navLinks.length > 1 && (
          <nav aria-label="Workspaces" className="flex items-center gap-1" data-testid="workspace-nav">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                data-testid={`nav-${link.to.slice(1)}`}
                className={({ isActive }) =>
                  `inline-flex items-center min-h-11 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors ${
                    isActive ? 'bg-accent-soft text-accent-ink' : 'text-ink-faint hover:text-ink hover:bg-white/5'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-3">
          {practitioner && (
            <span className="font-mono text-[11px] text-ink-faint hidden sm:inline">
              {practitioner.name} · {practitioner.title}
            </span>
          )}
          <button
            onClick={handleSignOut}
            data-testid="sign-out"
            className="min-h-11 text-ink-faint hover:text-accent-ink text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-white/5"
          >
            Sign out
          </button>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="max-w-5xl mx-auto px-4 md:px-6 py-6 focus:outline-none">{children}</main>
    </div>
  );
}
