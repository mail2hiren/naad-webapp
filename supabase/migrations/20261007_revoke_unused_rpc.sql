-- Security advisor: these SECURITY DEFINER helpers are not called by the app
-- and should not be reachable through /rest/v1/rpc. (The current_* RLS helper
-- functions stay executable: row-level-security policies evaluate them as the
-- calling role.)
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.link_patient_by_phone(text) from public, anon;
