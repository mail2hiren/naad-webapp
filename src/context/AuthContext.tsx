import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { PractitionerRow, StaffRole } from '../types/db';

interface AuthState {
  loading: boolean;
  authUserId: string | null;
  email: string | null;
  practitioner: PractitionerRow | null;
  signIn: (email: string, password: string, expectedRole: StaffRole) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const ROLE_LABEL: Record<StaffRole, string> = {
  receptionist: 'Receptionist', surgeon: 'Doctor', pharmacist: 'Pharmacist', physio: 'Doctor', admin: 'Admin',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [practitioner, setPractitioner] = useState<PractitionerRow | null>(null);
  // Supabase (real and mock alike) fires onAuthStateChange('SIGNED_IN', ...)
  // the moment signInWithPassword succeeds -- BEFORE signIn() below has had
  // a chance to check the dropdown's expected role against the account's
  // real role. Left unguarded, that listener would independently load and
  // grant the practitioner for ANY successful credential check, flashing
  // the wrong workspace open for an instant even when the role picked at
  // the login gate doesn't match, before signIn()'s own signOut() reverts
  // it -- a real (if brief) unauthorized-access flash, and it also wipes
  // the login form's error message via the resulting redirect-and-bounce.
  // While an interactive signIn() call is in flight, it is the sole
  // authority over `practitioner`; the ambient listener stands down and
  // only resumes for session restoration / external sign-outs.
  const signingInRef = useRef(false);

  async function loadPractitioner(uid: string) {
    const { data } = await supabase.from('practitioners').select('*').eq('auth_user_id', uid).maybeSingle();
    setPractitioner((data as PractitionerRow) ?? null);
  }

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }: any) => {
      if (!mounted) return;
      const session = data?.session;
      if (session?.user) {
        setAuthUserId(session.user.id);
        setEmail(session.user.email);
        await loadPractitioner(session.user.id);
      }
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event: string, session: any) => {
      if (signingInRef.current) return;
      if (session?.user) {
        setAuthUserId(session.user.id);
        setEmail(session.user.email);
        await loadPractitioner(session.user.id);
      } else {
        setAuthUserId(null);
        setEmail(null);
        setPractitioner(null);
      }
    });
    return () => { mounted = false; sub?.subscription?.unsubscribe?.(); };
  }, []);

  async function signIn(emailIn: string, password: string, expectedRole: StaffRole) {
    signingInRef.current = true;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: emailIn, password });
      if (error || !data?.user) return { error: error?.message ?? 'Sign-in failed.' };

      const { data: pr } = await supabase.from('practitioners').select('*').eq('auth_user_id', data.user.id).maybeSingle();
      const row = pr as PractitionerRow | null;
      if (!row || !row.active) {
        await supabase.auth.signOut();
        return { error: 'No active staff account is linked to this login.' };
      }
      // Role provisioning: the selected role must match the account's real role
      // (surgeon covers both Doctor sub-roles: Orthopedics/Critical Care, and
      // physio is also routed as Doctor) -- this is what restricts workspace
      // access, not client-side trust in whatever the dropdown says.
      const grantedLabel = ROLE_LABEL[row.role];
      const wantedLabel = ROLE_LABEL[expectedRole];
      if (grantedLabel !== wantedLabel) {
        await supabase.auth.signOut();
        return { error: `This account is provisioned as ${grantedLabel}, not ${wantedLabel}.` };
      }
      setAuthUserId(data.user.id);
      setEmail(data.user.email ?? emailIn);
      setPractitioner(row);
      return { error: null };
    } finally {
      signingInRef.current = false;
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setAuthUserId(null);
    setEmail(null);
    setPractitioner(null);
  }

  return (
    <AuthContext.Provider value={{ loading, authUserId, email, practitioner, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** Maps a practitioner's real DB role to the route they land on after login. */
export function routeForRole(role: StaffRole): string {
  switch (role) {
    case 'receptionist': return '/reception';
    case 'surgeon': return '/doctor';
    case 'physio': return '/doctor';
    case 'pharmacist': return '/pharmacy';
    case 'admin': return '/admin';
    default: return '/login';
  }
}
