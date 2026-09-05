import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { StaffRole } from '../types/db';

/** Route guard: no session -> /login; wrong role for this route -> back to
 * their own workspace. This is what "completely restricting workspace view
 * access" means in practice -- enforced at the router, on the practitioner
 * row loaded from Supabase, not on anything the client claims. */
export default function ProtectedRoute({ allow, children }: { allow: StaffRole[]; children: ReactNode }) {
  const { loading, practitioner } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-ink-faint text-sm">Loading…</div>;
  if (!practitioner) return <Navigate to="/login" replace />;
  if (!allow.includes(practitioner.role)) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
