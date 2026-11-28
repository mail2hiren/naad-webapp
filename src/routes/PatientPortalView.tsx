import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Panel, Btn, inputCls } from '../components/ui';
import { PatientApp } from '../components/patient/PatientApp';
import type { PatientRow } from '../types/db';

/**
 * Patient app (/patient) -- for patients, NOT staff. Patients sign in with
 * Supabase Auth and are matched to their own `patients` row via
 * `auth_user_id`; row-level security limits every read to their own rows.
 * Deliberately outside the staff system (AuthContext / Shell).
 */
export default function PatientPortalView() {
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    document.title = patient ? `${patient.name} — Naad` : 'Patient portal — Naad';
  }, [patient]);

  // A patient who is already signed in (page reloaded, app reopened) goes
  // straight to their app. A staff session on this device is not a patient.
  useEffect(() => {
    let live = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user.id;
      if (!uid) return;
      const { data: row } = await supabase.from('patients').select('*').eq('auth_user_id', uid).maybeSingle();
      if (live && row) setPatient(row as PatientRow);
    });
    return () => { live = false; };
  }, []);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setSigningIn(true);
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (authError || !authData.user) {
      setLoginError(authError?.message ?? 'Sign-in failed. Check your email and password.');
      setSigningIn(false);
      return;
    }
    const { data: patientRow, error: patientError } = await supabase.from('patients').select('*').eq('auth_user_id', authData.user.id).maybeSingle();
    if (patientError || !patientRow) {
      await supabase.auth.signOut();
      setLoginError('No patient record is linked to this account.');
      setSigningIn(false);
      return;
    }
    setPatient(patientRow as PatientRow);
    setSigningIn(false);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setPatient(null);
    setEmail('');
    setPassword('');
  }

  // -- render: login --------------------------------------------------------
  if (!patient) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Panel className="max-w-[440px] w-full p-8 md:p-10">
          <div className="text-base font-bold text-ink-faint flex items-center gap-2.5 mb-4">
            <span className="w-4 h-px bg-accent" />
            Naad · Patient Portal
          </div>
          <h1 className="text-2xl mb-2">Your care history</h1>
          <p className="text-ink-soft font-light leading-relaxed mb-6">
            This portal is for discharged patients and ongoing outpatients to view their own care history --
            no staff can browse other patients' data through this route. Sign in with the email and password
            given to you at your clinic.
          </p>

          <form onSubmit={handleLogin}>
            <label className="block mt-2.5">
              <span className="block text-[13px] font-semibold text-ink-soft mb-1.5">Email</span>
              <input
                data-testid="patient-login-email"
                type="email"
                className={inputCls}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="username"
              />
            </label>
            <label className="block mt-2.5">
              <span className="block text-[13px] font-semibold text-ink-soft mb-1.5">Password</span>
              <input
                data-testid="patient-login-password"
                type="password"
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>

            {loginError && (
              <div className="mt-4 text-sm text-danger bg-danger-soft rounded-lg px-3 py-2" data-testid="patient-login-error">
                {loginError}
              </div>
            )}

            <Btn
              type="submit"
              variant="glow"
              className="w-full mt-6 py-2.5"
              disabled={signingIn}
              data-testid="patient-login-submit"
            >
              {signingIn ? 'Signing in…' : 'Sign in'}
            </Btn>
          </form>
        </Panel>
      </div>
    );
  }

  return <PatientApp patient={patient} onSignOut={handleSignOut} />;
}
