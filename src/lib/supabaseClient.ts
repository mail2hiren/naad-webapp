import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createMockSupabaseClient, type MockSupabaseClient } from '../mock/mockSupabase';

const useMock = import.meta.env.VITE_USE_MOCK === '1';

let client: SupabaseClient | MockSupabaseClient;

if (useMock) {
  client = createMockSupabaseClient();
} else {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  if (!url || !key) {
    throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are required when VITE_USE_MOCK is not set to 1.');
  }
  client = createClient(url, key, { realtime: { params: { eventsPerSecond: 10 } } });
}

// Both branches expose the same subset of the supabase-js v2 surface
// (from/channel/auth) that this app actually uses -- see src/mock/mockSupabase.ts.
export const supabase = client as SupabaseClient;
export const isMockBackend = useMock;
