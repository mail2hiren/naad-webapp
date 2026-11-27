// platform-admin edge function entry point. The request logic lives in
// handler.ts so Node can test it; this file only wires the Deno runtime to it.
// Uses the platform-provided SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; no
// extra secrets.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handle } from "./handler.ts";

Deno.serve((req: Request) =>
  handle(req, {
    env: (name) => Deno.env.get(name),
    createClient,
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
  })
);
