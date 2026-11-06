# Lead Pipeline — Ingest First, Forward Last

**Status:** Architectural contract · 2026-11-05 · Internal
**Companions:** `AXiM-CONNECTED-STRATEGY.md` (commercial shape), `docs/consent-language.md`
(permission to hold and share), `docs/coverage-feed.md` (dormant activation)

---

## 1. The principle

**Every lead lands in AXiM Core first. Nothing leaves for a partner until Core has it,
scored it, enriched it, and written it down.**

That ordering is not a preference. It is what makes the whole line of business defensible:

| If we forward first… | If Core holds it first… |
| --- | --- |
| A partner's rejection is the only record of the lead. | Ours is the record of truth; the partner is a destination. |
| Enrichment must happen inside a partner's latency budget. | Enrichment is ours, asynchronous, and re-runnable. |
| Adding a partner means re-plumbing the capture path. | Adding a partner means writing one connector. |
| Withdrawal is a support email we hope someone reads. | Withdrawal flips a row and the connector honour it. |
| Attribution and payouts are reconstructed from memory. | Attribution and payouts are columns. |

The satellite (`speedreport.org`'s Worker) is a **producer**. It signs and delivers an
envelope. It never knows who the partner is, never formats for anyone, and never decides
whether something is worth money. Those are Core's jobs.

```
                 ┌─────────────────────────────────────────────┐
  SpeedReport    │              AXiM CORE                      │
  (edge Worker)  │                                             │
   measurement   │  ① INGEST      ✓ HMAC, replay window        │
      │          │                ✓ schema, dedupe on test_id  │
      │  signed  │                ✓ consent record + version   │
      └─────────►│                                             │
                 │  ② ENRICH      (async, idempotent, in Core) │
                 │    · transport classification  (catalog)    │
                 │    · coverage resolution       (feed)       │──► ③ PERSIST
                 │    · opportunity score + reasons            │    lead + route
                 │    · contact quality tier                   │    + state machine
                 │    · attribution (ref, src, campaign)       │
                 │                                             │
                 │  ④ QUALIFY     payable?  ──no──► store only │
                 │                │yes                         │
                 │  ⑤ ROUTE        deliver to partner connector│──► ⑥ RECONCILE
                 │                 (SARA Plus / API / CSV)      │    webhook or import
                 └─────────────────────────────────────────────┘    advances state
                                                                       and payout
```

---

## 2. Stage contracts

### ① Ingest — `POST /api/v1/leads/telemetry` (existing shape, extended)

Core is the only actor allowed to write a lead. The envelope the satellite signs stays
backwards-compatible; new optional fields are additive.

```jsonc
{
  "payload": {
    "testId": "SR-ABC123",              // dedupe key: upsert on test_id
    "timestamp": "2026-11-05T12:00:00Z",
    "metrics": { "downloadMbps": 850, "uploadMbps": 22, "latencyMs": 34,
                 "jitterMs": 3, "bufferbloatGrade": "B", "packetLossPct": 0 },
    "isp": "Comcast Cable Communications",
    "colo": "DFW",
    "leadInfo": {
      "email": "…", "name": "…", "postalCode": "75001",
      "consent": true, "consentVersion": "sr-consent-2026-11-v1", "consentAt": "…"
    },
    "attribution": { "ref": "aff_123", "src": "web3-home", "campaignId": "uuid" }
  },
  "evaluation": { /* satellite's preliminary score; Core recomputes */ }
}
```

**Ingest rules**

- Signature and timestamp window are checked before the body is parsed (already built).
- `test_id` is the idempotency key. Replay after a DLQ recovery must never create a second lead.
- A lead with no consent is still stored as `quality_tier = anonymous` — useful usage signal,
  never routable. **No consent is not an error.**
- The satellite's `evaluation` is treated as a *hint*, not an authority. Core recomputes
  score and coverage with the canonical catalog, because a stale client is untrustworthy.

### ② Enrich — inside Core, asynchronous, idempotent

Runs in `onLeadIngested()` (the Phase-2 hook that already exists as a stub in
`axim-core/src/handler.js`). Each step writes its result to its own column so it can be
re-run without duplicating work:

| Step | Writes | Re-runnable |
| --- | --- | --- |
| Transport classification | `provider_tier`, `provider_basis` | ✓ (pure) |
| Coverage resolution | `coverage_status`, `coverage_source`, `coverage_checked_at` | ✓ (re-run nightly as feed ages) |
| Opportunity scoring | `opportunity_score`, `score_reasons` (jsonb) | ✓ with `scorer_version` |
| Contact quality | `quality_tier` | ✓ |
| Attribution | `campaign_id`, `referral_code`, `source_surface` | ✗ (immutable once written) |

Add `scorer_version` and `catalog_version` columns. When either changes, a nightly job
re-scores `state = captured` rows and logs the delta. That is how a scoring change becomes
observable instead of silently altering past economics.

### ③ Persist — the ledger

```sql
-- extends the existing public.leads
alter table public.leads
  add column if not exists program_id        text,
  add column if not exists partner_id        text default 'dsi',
  add column if not exists offer_type        text,
  add column if not exists quality_tier      text,
  add column if not exists coverage_status   text,
  add column if not exists coverage_source   text,
  add column if not exists coverage_checked_at timestamptz,
  add column if not exists provider_tier     text,
  add column if not exists provider_basis    text,
  add column if not exists score_reasons     jsonb not null default '[]'::jsonb,
  add column if not exists scorer_version    text,
  add column if not exists catalog_version   text,
  add column if not exists campaign_id       uuid,
  add column if not exists referral_code     text,
  add column if not exists source_surface    text,
  add column if not exists consent_version   text,
  add column if not exists consent_at        timestamptz,
  add column if not exists state             text not null default 'captured',
  add column if not exists state_changed_at  timestamptz not null default now(),
  add column if not exists routed_at         timestamptz,
  add column if not exists partner_lead_ref  text,
  add column if not exists payout_cents      integer,
  add column if not exists withdrawn_at      timestamptz;

create index if not exists leads_state_idx on public.leads (state, state_changed_at);
create index if not exists leads_route_ready_idx on public.leads (state, coverage_status)
  where state = 'captured' and coverage_status = 'covered';
```

**The state machine — the only contract partners and reporting share:**

```
captured ──► qualified ──► routed ──► accepted ──► installed ──► paid
    │            │            │           │
    │            │            │           └──► rejected ──► (requeue or close)
    │            │            └───────────────► withdrawn   (visitor withdrew)
    └────────────┴──────────────────────────► closed        (no route available)
                                                        paid ──► clawed_back
```

Transitions are constrained server-side. A partner webhook may only advance
`routed → accepted | rejected` and `installed → paid | clawed_back`. **Nothing a partner
sends can create, edit, or re-route a lead.** That asymmetry is the whole protection.

### ④ Qualify

`payable = consent ∧ quality_tier = routable ∧ coverage_status = covered ∧ offer = fibre_upgrade`

Identical predicate to `leadEngine.buildLeadIntent()` on the client — deliberately duplicated
in Core, because the client's copy is a UI convenience and Core's copy is the one that
authorises a transfer of personal data. A mismatch between them is a bug that must fail
closed.

Everything that fails a component is stored, scored, and never forwarded. It becomes
aggregate evidence: *"we generated 4,100 qualified signals and could only route 900"* is a
sentence that argues for a coverage feed, not a failure.

### ⑤ Route — the connector layer

The connector interface, one implementation per partner:

```
connector.deliver(lead) -> { partnerLeadRef, accepted, rejectionReason }
connector.reconcile()    -> [{ partnerLeadRef, state, payoutCents, effectiveAt }]
connector.capabilities   -> { supports: [sara_plus | api | csv_batch], slaHours }
```

**First connector: manual-assisted (SARA Plus), then API.**
SARA Plus is a human order-entry application, not an API. The honest v1 connector is
therefore: `state = qualified` rows appear in a Core **Route Queue** view; an operator keys
them into SARA and records the partner reference; the row advances to `routed`. That is
manual, and it is *correct* — it produces the first real acceptance and rejection data
before we build anything. The API/batch connector replaces the human once volume justifies it.

Do not build API integration against a partner who has not yet told us what their
definition of a rejected lead is (strategy doc §2, question 6). The manual phase is how we
learn that definition cheaply.

### ⑥ Reconcile

Two acceptable mechanisms, in preference order:

1. **Signed partner webhook** → `POST /api/v1/partners/:partnerId/events`, HMAC-verified,
   deduped on `partner_lead_ref + state + effectiveAt`.
2. **Nightly import** of the partner's commission/status file → same handler, batch mode.

Both land in the same transition function, so a partner who only offers a monthly CSV is not
a second code path.

Reconciliation is where the business actually gets measured: acceptance rate, clawback rate,
average payout, days-to-payout. Those four numbers are the pitch for the *next* partner and
the evidence for moving from dealer-of-record to per-lead pricing.

---

## 3. What this means for what we build, and in what order

| Stage | Where | Depends on | Ships when |
| --- | --- | --- | --- |
| ① Ingest (extended envelope) | Core | — | When the coverage feed lands (dormant until then) |
| ② Enrich | Core | ①; catalog ported to Core | Same PR as ① |
| ③ Persist (schema) | Core | ③ migration | **Can ship now, harmless with no writes** |
| ④ Qualify | Core | ①, ③ | With ① |
| ⑤ Route — manual SARA | Core view | ④ + real coverage feed | First revenue step |
| ⑤ Route — API/batch | Core | partner's spec | Only after manual phase gives us the rejection definition |
| ⑥ Reconcile | Core | ⑤ | With the first real install |

**Everything above is dormant by construction.** With no coverage feed bound, every lead
scores, stores, and sits at `state = captured` — no route, no forward, no exposure. The
pipeline can be built, deployed and observed in production before a single partner
conversation concludes.

---

## 4. Anti-goals (stated so they don't get designed in by accident)

- **No partner-specific logic in the satellite.** The Worker must never learn a partner name.
- **No blocking enrichment on the ingest path.** Ingest acknowledges in <50 ms; enrichment runs
  in `waitUntil` or a queue consumer.
- **No lead mutation by a partner.** Transitions only.
- **No PII in telemetry, logs, or KV keys.** The ZIP lives in a row, not in an infrastructure
  log line.
- **No routing on an expired coverage verdict.** `coverage_checked_at` older than the feed's
  freshness window forces re-resolution before route.
