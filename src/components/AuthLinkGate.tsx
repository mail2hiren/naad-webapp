import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, routeForRole } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { NaadLogo } from './Brand';
import { Btn, Panel, inputCls } from './ui';

/** index.html notes when the page was opened from an email link
 * (invitation or password reset) before Supabase consumes the link. */
const KEY = 'naad-auth-link';

function linkType(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function clearLink() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Shows "Set your password" when someone arrives from an invitation or a
 * password-reset email, wherever the link landed; otherwise renders the app. */
export default function AuthLinkGate({ children }: { children: ReactNode }) {
  const [type, setType] = useState<string | null>(linkType);
  if (!type) return <>{children}</>;
  return <SetPasswordFromLink invited={type === 'invite'} onDone={() => { clearLink(); setType(null); }} />;
}

function SetPasswordFromLink({ invited, onDone }: { invited: boolean; onDone: () => void }) {
  const { practitioner, changePassword } = useAuth();
  const navigate = useNavigate();
  const [ready, setReady] = useState<'waiting' | 'ok' | 'expired'>('waiting');
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Supabase turns the link into a session a moment after load; an expired
  // or already-used link never does.
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (alive && data?.session) setReady('ok');
    };
    void check();
    const { data: sub } = supabase.auth.onAuthStateChange((_e: string, session: unknown) => {
      if (alive && session) setReady('ok');
    });
    const timer = setTimeout(() => { if (alive) setReady((r) => (r === 'waiting' ? 'expired' : r)); }, 6000);
    return () => { alive = false; clearTimeout(timer); sub?.subscription?.unsubscribe?.(); };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setError('Use at least 8 characters.');
    if (pw !== again) return setError('The two passwords do not match.');
    setSaving(true);
    const { error: err } = await changePassword(pw);
    setSaving(false);
    if (err) return setError(err);
    onDone();
    navigate(practitioner ? routeForRole(practitioner.role) : '/platform', { replace: true });
  }

  function leave() {
    onDone();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Panel className="max-w-[440px] w-full p-8 md:p-10">
        <div className="mb-7"><NaadLogo sub="Ambient AI for doctors" /></div>
        {ready === 'expired' ? (
          <>
            <h1 className="text-2xl mb-2">This link has expired</h1>
            <p className="text-ink-soft leading-relaxed mb-6">
              Email links work once and expire after a day. On the sign-in page, use "Forgot password?" to get a new one.
            </p>
            <Btn variant="glow" className="w-full" onClick={leave}>Go to sign-in</Btn>
          </>
        ) : (
          <>
            <h1 className="text-2xl mb-2">{invited ? 'Welcome to Naad' : 'Set a new password'}</h1>
            <p className="text-ink-soft leading-relaxed mb-6">
              {invited ? 'Choose a password for your new login.' : 'Choose a new password for your login.'}
            </p>
            <form onSubmit={submit} data-testid="set-password-form">
              <label className="block mt-2.5">
                <span className="block text-[13px] font-semibold text-ink-soft mb-1.5">New password</span>
                <input data-testid="link-new-password" type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
              </label>
              <label className="block mt-2.5">
                <span className="block text-[13px] font-semibold text-ink-soft mb-1.5">Type it again</span>
                <input data-testid="link-new-password-again" type="password" className={inputCls} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
              </label>
              {error && <div className="mt-4 text-sm text-danger bg-danger-soft rounded-lg px-3 py-2" role="alert">{error}</div>}
              <Btn type="submit" variant="glow" className="w-full mt-6" disabled={saving || ready !== 'ok'} data-testid="link-save-password">
                {ready !== 'ok' ? 'Checking your link…' : saving ? 'Saving…' : 'Save password'}
              </Btn>
            </form>
          </>
        )}
      </Panel>
    </div>
  );
}

/** "Forgot password?" for the staff and super admin sign-in pages. The reset
 * email links back to this app, where AuthLinkGate takes over. */
export function ForgotPassword({ initialEmail = '' }: { initialEmail?: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` });
    setBusy(false);
    setSent(true); // same message whether or not the email has a login
  }

  if (!open) {
    return (
      <button type="button" className="mt-3 min-h-11 text-sm font-semibold text-accent-ink" onClick={() => setOpen(true)} data-testid="forgot-password">
        Forgot password?
      </button>
    );
  }
  if (sent) {
    return (
      <p className="mt-4 text-sm text-ink-soft bg-surface-2 rounded-lg px-3 py-2" role="status" data-testid="reset-sent">
        If that email has a Naad login, a reset link is on its way. Open it on this device.
      </p>
    );
  }
  return (
    <form onSubmit={send} className="mt-4 border-t border-line pt-4" data-testid="forgot-form">
      <label className="block">
        <span className="block text-[13px] font-semibold text-ink-soft mb-1.5">Your email</span>
        <input data-testid="forgot-email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      </label>
      <Btn type="submit" variant="primary" className="mt-2 !px-0" disabled={busy} data-testid="send-reset">{busy ? 'Sending…' : 'Email me a reset link'}</Btn>
    </form>
  );
}
