# AXiM Core API (Phase 1)

Ingests HMAC-authenticated leads from satellite apps (SpeedReport.org) into Supabase.

## Setup
1. Run `supabase/migrations/0001_create_leads.sql` in the Supabase SQL editor.
2. `cp .env.example .env`, fill in values (never commit them), then `npm install && npm start`
   (Node 20.6+: `node --env-file=.env src/server.js`).
3. Deploy anywhere that runs Node (Fly.io, Railway, Render, a VPS) behind HTTPS.

## Deploy on Cloudflare Workers (gives you the AXIM_CORE_URL)
```bash
cd axim-core && npm install
npx wrangler secret put AXIM_INTERNAL_KEY            # same value as the SpeedReport Worker
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npm run deploy
```
Wrangler prints `https://axim-core.<your-subdomain>.workers.dev` — that is `AXIM_CORE_URL`.

## Endpoint
`POST /api/v1/leads/telemetry` — body is the exact JSON the Worker signs; header
`X-Axim-Signature` = hex HMAC-SHA256(body, `AXIM_INTERNAL_KEY`). Invalid/missing → `401`.
Upserts on `test_id`. After insert, an async stub (`onLeadIngested` in `src/handler.js`)
logs the event; Phase 2 predictive scoring plugs in there. `GET /health` for probes.

## Wiring SpeedReport.org
Use the same key on both sides and point the Worker at the deployed base URL (no trailing slash,
no path):

```bash
npm --prefix speedreport-worker exec wrangler secret put AXIM_INTERNAL_KEY
npm --prefix speedreport-worker exec wrangler secret put AXIM_CORE_URL   # e.g. https://core.axim.example
```

Verify: `curl https://core.axim.example/health`, then run a speed test with a lead email and
check the `leads` table.
