import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { NaadLogo } from './Brand';
import { Btn, Panel, inputCls } from './ui';

/** Shown instead of the workspace when a login was just created or reset:
 * the temporary password works once, then the person picks their own. */
export default function ChangePassword() {
  const { practitioner, changePassword, signOut } = useAuth();
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setError('Use at least 8 characters.');
    if (pw !== again) return setError('The two passwords do not match.');
    setSaving(true);
    const { error: err } = await changePassword(pw);
    setSaving(false);
    if (err) setError(err);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Panel className="max-w-[440px] w-full p-8 md:p-10">
        <div className="mb-7"><NaadLogo sub="Ambient AI for doctors" /></div>
        <h1 className="text-2xl mb-2">Choose your password</h1>
        <p className="text-ink-soft leading-relaxed mb-6">
          Welcome{practitioner ? `, ${practitioner.name}` : ''}. You signed in with a temporary password. Pick your own to continue.
        </p>
        <form onSubmit={submit} data-testid="change-password-form">
          <label className="block mt-2.5">
            <span className="block text-[13px] font-semibold text-ink-soft mb-1.5">New password</span>
            <input data-testid="new-password" type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          </label>
          <label className="block mt-2.5">
            <span className="block text-[13px] font-semibold text-ink-soft mb-1.5">Type it again</span>
            <input data-testid="new-password-again" type="password" className={inputCls} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
          </label>
          {error && <div className="mt-4 text-sm text-danger bg-danger-soft rounded-lg px-3 py-2" role="alert">{error}</div>}
          <Btn type="submit" variant="glow" className="w-full mt-6" disabled={saving} data-testid="save-new-password">
            {saving ? 'Saving…' : 'Save and continue'}
          </Btn>
          <Btn type="button" variant="ghost" className="w-full mt-2" onClick={() => signOut()}>Sign out</Btn>
        </form>
      </Panel>
    </div>
  );
}
