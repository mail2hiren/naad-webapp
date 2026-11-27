import { useSearchParams } from 'react-router-dom';
import type { StaffRole } from '../types/db';

export type IconName = 'queue' | 'calendar' | 'userPlus' | 'stethoscope' | 'bed' | 'pill' | 'box' | 'chart' | 'users' | 'rupee' | 'receipt';

export type NavItem = { to: string; section?: string; label: string; icon: IconName };

/** Every page a role can reach, in sidebar order. Paths must mirror the
 * `allow` lists on each <ProtectedRoute> in App.tsx; `section` picks a part
 * of a workspace page (read with useSection) so each sidebar item shows one
 * job instead of one long scrolling page. */
export const ROLE_NAV: Record<StaffRole, NavItem[]> = {
  receptionist: [
    { to: '/reception', section: 'queue', label: "Today's queue", icon: 'queue' },
    { to: '/reception', section: 'appointments', label: 'Appointments', icon: 'calendar' },
    { to: '/reception', section: 'walk-in', label: 'Walk-in registration', icon: 'userPlus' },
  ],
  surgeon: [
    { to: '/doctor', label: 'My patients', icon: 'stethoscope' },
    { to: '/inpatient', label: 'Ward', icon: 'bed' },
  ],
  physio: [
    { to: '/doctor', label: 'My patients', icon: 'stethoscope' },
    { to: '/inpatient', label: 'Ward', icon: 'bed' },
  ],
  pharmacist: [
    { to: '/pharmacy', section: 'orders', label: 'Orders', icon: 'pill' },
    { to: '/pharmacy', section: 'stock', label: 'Stock', icon: 'box' },
  ],
  admin: [
    { to: '/admin', section: 'overview', label: 'Overview', icon: 'chart' },
    { to: '/admin', section: 'staff', label: 'Staff', icon: 'users' },
    { to: '/admin', section: 'fees', label: 'Consultation fees', icon: 'rupee' },
    { to: '/admin', section: 'billing', label: 'Discharge billing', icon: 'receipt' },
    { to: '/inpatient', label: 'Ward', icon: 'bed' },
  ],
};

/** The section of the current workspace page chosen in the sidebar. */
export function useSection<T extends string>(fallback: T): T {
  const [params] = useSearchParams();
  return ((params.get('section') as T | null) ?? fallback);
}

