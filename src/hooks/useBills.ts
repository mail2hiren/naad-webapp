import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { BillRow } from '../types/db';

/** The hospital's bills, newest first, kept live with a realtime channel. */
export function useBills(orgId: string) {
  const [bills, setBills] = useState<BillRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase.from('bills').select('*').eq('org_id', orgId);
    setBills(((data as BillRow[]) ?? []).map(normalise));
    setLoaded(true);
  }, [orgId]);

  useEffect(() => { queueMicrotask(() => { void reload(); }); }, [reload]);

  useEffect(() => {
    const ch = supabase.channel('rt-bills').on('postgres_changes', { event: '*', schema: 'public', table: 'bills' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (payload: any) => {
        setBills((prev) => {
          if (payload.eventType === 'DELETE') return prev.filter((b) => b.id !== payload.old.id);
          const row = normalise(payload.new as BillRow);
          return prev.some((b) => b.id === row.id) ? prev.map((b) => (b.id === row.id ? row : b)) : [...prev, row];
        });
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const sorted = [...bills].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { bills: sorted, loaded, reload };
}

/** Postgres numeric arrives as a string from the REST API. */
function normalise(b: BillRow): BillRow {
  return { ...b, subtotal: Number(b.subtotal), discount: Number(b.discount), total: Number(b.total), paid: Number(b.paid), items: b.items ?? [] };
}
