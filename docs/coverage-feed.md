# Coverage Feed — Dormant by Design, and How to Wake It

**Status:** Dormant · 2026-11-05
**Companion:** `AXiM-CONNECTED-STRATEGY.md`, `docs/lead-pipeline.md`

---

## 1. What "dormant" means here, precisely

The code is live and tested. The *behaviour* is inert. Concretely, with no feed bound:

| Surface | Behaviour today |
| --- | --- |
| `GET /api/serviceability?zip=…` | `200`, every program `unknown`, `source: "none"` |
| `/health` | `"serviceability": "unbound"`, `degraded: true` |
| `leadEngine.buildLeadIntent()` | `coverage_status = unknown` → offer = `resolve_coverage` → `payable: false` |
| Deal-card UI | **Not rendered.** The existing lead card is unchanged |
| Partner data flow | **Zero.** No lead is formatted for, sent to, or known by a partner |
| Lead capture & storage | Unchanged from before this work |

The property that makes this safe is structural, not procedural: **`lookupCoverage()` has no
code path that returns `covered` without reading an explicit feed entry.** An operator cannot
"accidentally" ship offers by forgetting a flag, because there is no flag that turns coverage
on — only data that satisfies it.

Verified by test: *"never reports covered without a feed, even inside a seed-footprint state"*
(`tests/providerCatalog.test.js`).

---

## 2. Namespace naming

`SERVICEABILITY` is a KV namespace, deliberately **separate from `PROSPECT_STORE`**. They have
different data classes and different failure consequences:

| Binding | Class | Failure mode | Namespace |
| --- | --- | --- | --- |
| `PROSPECT_STORE` | Ops — pending leads, rate-limit counters | Leads dropped or limiter off | **`speedreport-prospect-store`** |
| `SERVICEABILITY` | Reference data — ZIP coverage per program | Offers stop; nothing breaks | **`speedreport-serviceability`** |

Why separate: `PROSPECT_STORE` holds transient operational state with a 24h TTL; the coverage
feed is slow-changing reference data that a nightly job rewrites. Sharing one namespace means a
`kv list` audit mixes them, and a namespace-level incident takes both out at once.

**Naming convention** for the account: `<app>-<purpose>`, all lowercase, hyphenated, app prefix
first so a sorted namespace list groups by application.

Preview/dev namespaces: `speedreport-serviceability-preview`,
`speedreport-prospect-store-preview`.

---

## 3. Activation runbook

Perform in this order. Steps 1–3 are operator actions; 4–7 are code changes I will make.

**Step 1 — create both namespaces**

```bash
cd speedreport-worker
npx wrangler kv namespace create speedreport-prospect-store --config wrangler.jsonc
npx wrangler kv namespace create speedreport-serviceability --config wrangler.jsonc
```

Record the returned ids. Do not paste placeholders — the deploy job performs a real
`wrangler deploy` on `main`, so a fabricated id breaks production.

**Step 2 — bind them**

In `speedreport-worker/wrangler.jsonc`, replace the commented block with:

```jsonc
  "kv_namespaces": [
    { "binding": "PROSPECT_STORE", "id": "<prospect-store-id>" },
    { "binding": "SERVICEABILITY", "id": "<serviceability-id>" },
  ],
```

Note: `SERVICEABILITY` may be bound immediately and left **empty**. An empty feed is
dormant — every ZIP resolves `unknown`. Binding it early is therefore safe and lets the
deployment path be exercised before any coverage data exists. It is only `PROSPECT_STORE`
that must exist before leads are trusted at volume.

**Step 3 — verify the binding**

```bash
curl -s https://speedreport.org/health | jq .dependencies
# expect: {"prospectStore":"bound","leadForwarding":"configured","serviceability":"bound"}
curl -s "https://speedreport.org/api/serviceability?zip=75001" | jq
# expect: programs[].status == "unknown", source == "none"
```

**Step 4 — load coverage when the feed arrives** (see §4)

**Step 5 — flip the deal card on** (my change; one PR)

- `FiberLeadCard` replaces the free-text ask with `buildLeadIntent()` → coverage-gated card.
- Consent checkbox renders from `src/content/consent.js` — **blocked on counsel review of
  `docs/consent-language.md`**. Both ship together or not at all.

**Step 6 — canary**

Run a real test in a ZIP known to be `covered`, and one known to be `known_absent`. Confirm:
covered → offer card with the partner brand; absent → no card; unknown ZIP → "we'll check"
copy only, `payable: false` in the payload Core receives.

**Step 7 — watch `/health`**

`degraded: true` if the feed binding disappears, if lead forwarding is unconfigured, or if the
DLQ is unbound. The 02:35 EST Onyx sweep polls this.

---

## 4. Feed formats the loader will accept

The `SERVICEABILITY` namespace is keyed `svc:<zip5>` with a tiny JSON object — one read per
ZIP question, no scan, no index:

```
svc:75001 -> { "kinetic": "covered", "att-fiber": "known_absent" }
svc:99501 -> { "kinetic": "known_absent" }
```

That contract exists so that whichever shape the partner gives us, a loader can flatten it:

| Partner provides | Loader flattens to `svc:<zip>` |
| --- | --- |
| A CSV of ZIPs per brand (`zip,brand_name`) | one entry per ZIP, brands → program ids |
| A state-level list | expanded only if the partner confirms state-level completeness — otherwise entries stay `unknown` for absent ZIPs |
| An address-level API | resolved at request time by a Phase-3 connector behind the same JSON contract |
| A nightly file drop | same loader, run by cron, with `coverage_checked_at` stamped |

**Rules the loader must obey:**

- Only ever write `covered` or `known_absent`. Never `unknown` (absence of a key *is* unknown).
- An unrecognised brand in their file is dropped, not mapped. Guessing a brand mapping is how
  a partner gets a lead for a service they don't sell.
- Stamp a `feed_version`; rows resolved against a stale feed must be re-resolved before route
  (`docs/lead-pipeline.md` §4, anti-goals).
- Log counts, never ZIPs.

---

## 5. What I need from you, and when

| # | Item | Blocking what |
| --- | --- | --- |
| 1 | The two namespace ids from step 1 | `PROSPECT_STORE` is urgent independently of this project — the DLQ and rate limiter are currently no-ops |
| 2 | The coverage feed (ZIPs per partner) | Steps 4–7. No rush; everything is built for the wait |
| 3 | Counsel sign-off on `docs/consent-language.md` | Step 5, and any routing of personal data |
| 4 | Which program ids the feed will carry | The `PROGRAMS` allowlist in `providerCatalog.js` and in `serviceability.ts` |

Until all four arrive, the correct state of this system is: **built, tested, deployed,
inert.** That is not indecision — it is the only defensible way to hold a lead-generation
pipeline you intend to point at a partner under contract.
