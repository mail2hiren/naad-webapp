-- Every table in public has row level security on. A table without it is
-- readable and writable by anyone holding the public anon key.
do $$
declare
  missing text;
begin
  select string_agg(c.relname, ', ') into missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if missing is not null then
    raise exception 'row level security is off on: %', missing;
  end if;
end $$;
