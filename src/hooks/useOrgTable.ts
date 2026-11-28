import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * All rows of one table for the signed-in hospital, kept live with a
 * realtime channel. `normalise` fixes up a row as it arrives (for example
 * Postgres numerics come back from the REST API as strings).
 */
export function useOrgTable<T extends { id: string | number }>(table: string, orgId: string, normalise: (row: T) => T = (r) => r) {
  const [rows, setRows] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const norm = useCallback(normalise, []);

  const reload = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase.from(table).select('*').eq('org_id', orgId);
    setRows(((data as T[]) ?? []).map(norm));
    setLoaded(true);
  }, [table, orgId, norm]);

  useEffect(() => { queueMicrotask(() => { void reload(); }); }, [reload]);

  useEffect(() => {
    const ch = supabase.channel(`rt-${table}`).on('postgres_changes', { event: '*', schema: 'public', table },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (payload: any) => {
        setRows((prev) => {
          if (payload.eventType === 'DELETE') return prev.filter((r) => r.id !== payload.old.id);
          const row = norm(payload.new as T);
          return prev.some((r) => r.id === row.id) ? prev.map((r) => (r.id === row.id ? row : r)) : [...prev, row];
        });
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [table, norm]);

  return { rows, loaded, reload };
}
