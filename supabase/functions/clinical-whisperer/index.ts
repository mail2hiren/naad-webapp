// Clinical Whisperer edge function entry point. The request logic lives in
// handler.ts so Node can test it; this file only wires the Deno runtime to it.
// Deploys from this repo (.github/workflows/deploy-functions.yml).
// Required secret: ANTHROPIC_API_KEY. Optional: ANTHROPIC_MODEL.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handle } from "./handler.ts";

Deno.serve((req: Request) =>
  handle(req, {
    env: (name) => Deno.env.get(name),
    fetch: (input, init) => fetch(input, init),
    createClient,
  })
);
