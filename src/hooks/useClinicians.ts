import { useMemo } from 'react';
import { useClinic } from '../context/ClinicContext';
import type { PractitionerRow } from '../types/db';

/** Doctors and physiotherapists who take appointments, by name. */
export function useClinicians(): PractitionerRow[] {
  const { practitioners } = useClinic();
  return useMemo(() => practitioners
    .filter((p) => p.active && (p.role === 'surgeon' || p.role === 'physio'))
    .sort((a, b) => a.name.localeCompare(b.name)), [practitioners]);
}
