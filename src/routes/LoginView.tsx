import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, routeForRole } from '../context/AuthContext';
import { Panel, Btn, inputCls } from '../components/ui';
import type { StaffRole } from '../types/db';

const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'surgeon', label: 'Doctor' },
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'admin', label: 'Admin' },
];

/** Secure Authentication Gateway (/login). Validates credentials against
 * Supabase Auth, then checks the signed-in account's real practitioner
 * role against the selected role dropdown -- the dropdown is a UX
 * shortcut to the right route, never itself the source of access control. */
export default function LoginView() {
  const { signIn, practitioner } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<StaffRole>('receptionist');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: err } = await signIn(email.trim(), password, role);
    setSubmitting(false);
    if (err) { setError(err); return; }
    navigate(routeForRole(role === 'physio' ? 'physio' : role));
  }

  useEffect(() => {
    if (practitioner) {
      // Already signed in (e.g. hot reload) -- send straight to their workspace.
      navigate(routeForRole(practitioner.role), { replace: true });
    }
  }, [practitioner, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Panel className="max-w-[440px] w-full p-8 md:p-10">
        <div className="flex items-center gap-3 mb-6">
          <img src="/favicon.svg" alt="" className="w-10 h-10 shrink-0" />
          <div>
            <div className="font-extrabold text-2xl tracking-wide bg-gradient-to-r from-ink to-accent-ink bg-clip-text text-transparent leading-none">
              NAAD
            </div>
            <div className="font-mono text-[10px] tracking-[.18em] uppercase text-ink-faint font-semibold mt-1">
              Ambient AI Healthcare
            </div>
          </div>
        </div>
        <h1 className="text-2xl mb-2">Secure sign-in</h1>
        <p className="text-ink-soft font-light leading-relaxed mb-6">
          Sign in with your staff credentials. Your role provisions which workspace you land on and what you can see.
        </p>

        <form onSubmit={handleSubmit} data-testid="login-form">
          <label className="block mt-2.5">
            <span className="block font-mono text-[9.5px] tracking-wider uppercase text-ink-faint mb-1.5">Role</span>
            <select
              data-testid="login-role"
              className={inputCls}
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
            >
              {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="block mt-2.5">
            <span className="block font-mono text-[9.5px] tracking-wider uppercase text-ink-faint mb-1.5">Username / Email</span>
            <input
              data-testid="login-email"
              type="text"
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@digiyaan.demo"
              autoComplete="username"
            />
          </label>
          <label className="block mt-2.5">
            <span className="block font-mono text-[9.5px] tracking-wider uppercase text-ink-faint mb-1.5">Password</span>
            <input
              data-testid="login-password"
              type="password"
              className={inputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          {error && (
            <div className="mt-4 text-sm text-danger bg-danger-soft rounded-lg px-3 py-2" data-testid="login-error">
              {error}
            </div>
          )}

          <Btn type="submit" variant="glow" className="w-full mt-6 py-2.5" disabled={submitting} data-testid="login-submit">
            {submitting ? 'Signing in…' : 'Sign in'}
          </Btn>
        </form>
      </Panel>
    </div>
  );
}
