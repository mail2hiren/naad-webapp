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
    { to: '/reception', section: 'calendar', label: 'Calendar', icon: 'calendar' },
    { to: '/reception', section: 'patients', label: 'Patients', icon: 'users' },
    { to: '/reception', section: 'walk-in', label: 'Walk-in registration', icon: 'userPlus' },
    { to: '/reception', section: 'billing', label: 'Billing', icon: 'receipt' },
  ],
  surgeon: [
    { to: '/doctor', label: 'My patients', icon: 'stethoscope' },
    { to: '/inpatient', label: 'Ward', icon: 'bed' },
  ],
  physio: [
    { to: '/doctor', label: "Today's patients", icon: 'stethoscope' },
    { to: '/physio', section: 'caseload', label: 'Caseload', icon: 'users' },
    { to: '/physio', section: 'library', label: 'Exercise library', icon: 'box' },
    { to: '/inpatient', label: 'Ward', icon: 'bed' },
  ],
  pharmacist: [
    { to: '/pharmacy', section: 'orders', label: 'Orders', icon: 'pill' },
    { to: '/pharmacy', section: 'stock', label: 'Stock', icon: 'box' },
    { to: '/pharmacy', section: 'sales', label: 'Sales', icon: 'receipt' },
  ],
  admin: [
    { to: '/admin', section: 'overview', label: 'Overview', icon: 'chart' },
    { to: '/admin', section: 'staff', label: 'Staff', icon: 'users' },
    { to: '/admin', section: 'departments', label: 'Departments', icon: 'box' },
    { to: '/admin', section: 'hours', label: 'Working hours', icon: 'calendar' },
    { to: '/admin', section: 'fees', label: 'Fees and price list', icon: 'rupee' },
    { to: '/admin', section: 'beds', label: 'Wards and beds', icon: 'bed' },
    { to: '/admin', section: 'reports', label: 'Reports', icon: 'chart' },
    { to: '/admin', section: 'audit', label: 'Audit log', icon: 'queue' },
    { to: '/admin', section: 'billing', label: 'Discharge billing', icon: 'receipt' },
    { to: '/inpatient', label: 'Ward', icon: 'bed' },
  ],
};

/** The section of the current workspace page chosen in the sidebar. */
export function useSection<T extends string>(fallback: T): T {
  const [params] = useSearchParams();
  return ((params.get('section') as T | null) ?? fallback);
}

