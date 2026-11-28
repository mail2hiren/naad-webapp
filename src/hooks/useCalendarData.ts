import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useOrgTable } from './useOrgTable';
import type { CalendarBlockRow, WaitlistRow } from '../types/db';

/** Blocked time (leave, surgery, meetings, holidays), kept live. */
export function useCalendarBlocks(orgId: string) {
  const { rows, reload } = useOrgTable<CalendarBlockRow>('calendar_blocks', orgId);
  return { blocks: rows, reload };
}

/** Patients waiting for an earlier or a particular time, kept live. */
export function useWaitlist(orgId: string) {
  const { rows, reload } = useOrgTable<WaitlistRow>('appointment_waitlist', orgId);
  return { waitlist: rows, reload };
}

/** The hospital's name, for reminders and the day sheet. */
export function useOrgName(orgId: string): string {
  const [name, setName] = useState('');
  useEffect(() => {
    let live = true;
    if (orgId) void supabase.from('organizations').select('name').eq('id', orgId).maybeSingle().then(({ data }) => { if (live) setName((data as { name?: string } | null)?.name ?? ''); });
    return () => { live = false; };
  }, [orgId]);
  return name || 'the hospital';
}
