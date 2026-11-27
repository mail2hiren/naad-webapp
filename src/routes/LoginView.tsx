import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, routeForRole } from '../context/AuthContext';
import { Panel, Btn, inputCls } from '../components/ui';
import { NaadLogo } from '../components/Brand';
import { ForgotPassword } from '../components/AuthLinkGate';
import type { StaffRole } from '../types/db';

const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'surgeon', label: 'Doctor' },
  { value: 'physio', label: 'Physiotherapist' },
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
    navigate(routeForRole(role));
  }

  useEffect(() => {
    document.title = 'Staff sign-in — Naad';
  }, []);

  useEffect(() => {
    if (practitioner) {
      // Already signed in (e.g. hot reload) -- send straight to their workspace.
      navigate(routeForRole(practitioner.role), { replace: true });
    }
  }, [practitioner, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Panel className="max-w-[440px] w-full p-8 md:p-10">
        <div className="mb-7">
          <NaadLogo sub="Ambient AI for doctors" />
        </div>
        <h1 className="text-2xl mb-2">Staff sign-in</h1>
        <p className="text-ink-soft leading-relaxed mb-6">
          Choose your role and sign in. You'll go straight to your own workspace.
        </p>

        <form onSubmit={handleSubmit} data-testid="login-form">
          <label className="block mt-2.5">
            <span className="block text-[13px] font-semibold text-ink-soft mb-1.5">Role</span>
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
            <span className="block text-[13px] font-semibold text-ink-soft mb-1.5">Email</span>
            <input
              data-testid="login-email"
              type="text"
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@hospital.com"
              autoComplete="username"
            />
          </label>
          <label className="block mt-2.5">
            <span className="block text-[13px] font-semibold text-ink-soft mb-1.5">Password</span>
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
        <ForgotPassword initialEmail={email} />
      </Panel>
    </div>
  );
}
