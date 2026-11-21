// transcribe-and-extract: the ambient AI pipeline. Full description and history in
// the repo copy (supabase/functions/transcribe-and-extract/index.ts); this file only
// wires the Deno runtime to handler.ts. Secrets (DEEPGRAM_API_KEY, ANTHROPIC_API_KEY)
// live in Supabase, never in code.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handle } from "./handler.ts";

Deno.serve((req: Request) =>
  handle(req, {
    env: (name) => Deno.env.get(name),
    fetch: (input, init) => fetch(input, init),
    createClient,
  })
);
