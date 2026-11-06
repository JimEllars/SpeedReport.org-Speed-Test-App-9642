# AXiM CONNECTED STRATEGY — SpeedReport as the Lead Engine

**Status:** Draft for operator review · 2026-11-05
**Owner:** Mr. James Ellars · Drafted by Onyx
**Scope:** SpeedReport.org (primary asset), crossing into AXiM Core, AXiM Support, and the
Business Development engine. **Internal only — never publish.**

---

## 0. The one-paragraph thesis

SpeedReport.org measures a visitor's connection and, at the exact moment that visitor
discovers their connection is inadequate, is the single most credible instrument on the
internet to tell them what a better one would cost. Nobody else can present a
fiber offer on that page without damaging their brand, because nobody else is neutral.
That credibility — not traffic volume — is the asset. It is monetised by routing
**serviceability-verified** leads into a partner's order system (DSI Systems today),
under a strict white-label separation: SpeedReport is the instrument, the partner is the
product. Everything in this document is subordinate to one rule: **no lead is ever
routed, and no offer is ever shown, unless coverage at that address is proven.**

---

## 1. Why this is the right lead source (and not just "another funnel")

| Property | Why it matters commercially |
| --- | --- |
| **Intent is generated, not solicited** | A door-to-door rep manufactures urgency. A visitor who just measured 22 Mbps up already has it. |
| **The measurement is the qualification** | We know the transport (cable/DSL/satellite), the asymmetry, the bufferbloat, and whether they are already on fiber — before a human touches the lead. That is the exact data a program needs to (a) accept the lead and (b) not charge it back. |
| **Neutrality is structural** | An ISP-branded speed test cannot recommend a competitor. We can. This is the moat and it is destroyed the moment we brand the test surface. |
| **Zero capex to start** | No inventory, no trucks, no installers, no franchise fee. The cost of entry is an application and a KV namespace. |
| **It compounds into products** | The same measurement pipeline produces the dispute dossier, the ISP scorecard, and the white-label embed — revenue that needs no partner at all (see §6). |

**The strategic inversion versus the original brainstorm:** the value is *not* in
"plugging funnels into DSI and recycling payouts." It is in being the only actor that can
say *"this specific address, on this specific cable plant, at this measured asymmetry, is a
verified, routable upgrade."* That is a data product wearing a commission as a hat.

---

## 2. The deal shape we are actually building toward

Two commercial forms, and we want the first one:

| | **Route-only (target)** | Dealer-of-record (avoid initially) |
| --- | --- | --- |
| What we sell | A qualified, serviceability-verified, consented lead route | A completed install |
| Who closes | Partner's agents / DSI call center / SARA Plus workflow | Us (requires a sales floor) |
| Our cost | Software only | Marketing + headcount + compliance + training |
| Our risk | Payout per lead; no churn clawback | Chargebacks on 30–90 day churn |
| Our take | Per-lead fee, negotiated | Per-install commission |
| Ecosystem fit | Native — it is what the stack already does | Forced |

The dealer application to DSI is worth submitting **as a lead-generation business**
regardless, because it is the cheapest way inside the master-agent relationship and it
gives us a legitimate seat at the table to propose per-lead pricing once we can show
volume and verification quality. But we do **not** build a call center to satisfy it.

**Non-negotiable diligence before signing anything** (four numbers, per brand, in writing):

1. Upfront per service tier.
2. Residual %, if any, and duration.
3. Churn clawback window and its definition ("first bill paid" vs "90 days in service").
4. Payout lag from install to settlement.

Plus two programme-level questions: **(5) is per-qualified-lead pricing available?**
and **(6) what is the definition of a rejected lead?** The answer to 5 and 6 determines
whether we ever need to build anything to answer a phone.

---

## 3. Current factual state of the asset (verified 2026-11-05)

Verified against production and source, not against the roadmap documents.

| Check | Result |
| --- | --- |
| `https://speedreport.org/health` | `200`, `{"status":"healthy","degraded":true}`, `prospectStore: unbound`, `leadForwarding: configured` |
| `POST /api/lead` | `200` with a `leadId` — the endpoint works and forwards to Core |
| Local test suite | **140 passed / 16 files** (baseline before this work: 88 / 13) |
| Lint (`eslint --quiet`) | clean |
| Worker typecheck (`tsc --noEmit`) | clean |
| Build | succeeds; **main chunk 1,139 kB minified / 373 kB gzip** — a first-visit problem for ad-funded traffic (see §7) |
| Speed test engine | Works. 1000 ms rolling throughput window, progressive upload ladder, `COMPLETED_PARTIAL` on stall. |

### 3.1 Three critical-path defects found during the audit

These are the difference between "has lead capture" and "has a lead engine":

**D1 — `PROSPECT_STORE` is unbound in production.** The dead-letter queue and the per-IP
lead rate limiter both silently degrade to no-ops. Right now an inbound flood is
unlimited and an unreachable Core drops leads on the floor. One `wrangler kv namespace
create` and an uncomment away. **Operator action.**

**D2 — the platform-side lead ingress does not exist in the signed Core repo.**
`speedreport-worker/src/telemetry.ts` HMAC-signs to `${AXIM_CORE_URL}/api/v1/leads/telemetry`.
The `axim-core-v1.2` bundle under `cloudflare-workers/` has no such route; the only full
implementation of that contract is the vendored `axim-core/` directory *inside this repo*,
which is not the deployed platform Core. So `leadForwarding: configured` means *credentials
are present*, not *the lead has somewhere to land*. **This is the single most important
unknown in the pipeline and it must be resolved before we send real leads.**
Resolving it means: deploy the `leads` contract into platform Core (migration
`0001_create_leads.sql` plus the handler), or point `AXIM_CORE_URL` at the vendored
service. It is a decision, not a build.

**D3 — there is no attribution or payout ledger.** `leads` has no `partner`,
`program_id`, `campaign_id`, `referral_code`, `routed_at`, `paid_at` or `state` column.
Without those, the per-`?ref=` affiliate mechanism in the ecosystem and any per-lead
billing claim are unprovable. A partner asks "prove these 40 installs came from you" and
the answer is a Supabase table with an email and a JSON blob. **Schema work, §5.**

### 3.2 What the existing lead capture actually does today

`FiberLeadCard` asks for an *optional* email and an *optional* ZIP, then posts to
`/api/lead`, which forwards to Core as `type: "manual_lead"`. Good bones — HMAC signing,
DLQ buffering, replay, permanent-4xx drop, per-IP limiter — and no idea *where* the lead
should go. There is no coverage check (an Alaska ZIP is accepted as cheerfully as a Texas
one), no consent capture, no name, no routing decision. It is a contact form shaped like a
lead engine.

---

## 4. The engine: five gates, in order

Every visitor passes through these. The design principle is that **each gate can only
reduce what happens next**, never expand it. Fail closed, always.

```
  measurement
      │
      ▼
 ① CLASSIFY ──── what transport is on the wire?          leadEngine.scoreOpportunity()
      │          (name first, measurement as corroboration only)
      ▼
 ② SCORE ─────── how bad is it, and for whom?            score + reasons[]
      │          legacy transport / asymmetry / bufferbloat / latency /
      │          underperformance vs paid plan / business audience
      ▼
 ③ COVERAGE ──── is a sellable program proven at this ZIP?
      │          unknown ⇒ NO OFFER. Deal card asks for a ZIP instead.  ◄── the safety valve
      ▼
 ④ OFFER ─────── exactly one card. never a storefront.
      │          on fiber      ⇒ add-on, else diagnostic. never a competitor pitch.
      │          cable + covered⇒ fiber upgrade
      │          cable, no cov ⇒ cable-rescue / diagnostic
      ▼
 ⑤ CONTACT ───── name + email + ZIP + explicit consent  ⇒ ROUTABLE ⇒ payable
                 email + ZIP only                        ⇒ CONTACTABLE ⇒ not payable
                 no email                                ⇒ ANONYMOUS ⇒ usage signal only
      │
      ▼
  route → partner order path (SARA Plus / partner API)  →  Core ledger  →  reconciliation
```

### 4.1 What ships in this PR (Phase 1, pure logic, no user-visible change)

`src/utils/providerCatalog.js` and `src/utils/leadEngine.js` — the classification,
scoring, coverage, offer-selection and payable predicates above, with 37 tests.

Three behaviours are worth calling out because they encode the strategy:

- **`lookupCoverage()` cannot return `covered` without a feed.** Not "returns unknown as a
  fallback" — the type has no path to `covered` that does not read an explicit entry. A
  seed footprint (Kinetic's stated 18-state build) produces `unknown`, never a claim.
- **`selectOffer()` refuses to pitch fiber to a fiber subscriber** regardless of what the
  coverage table says. Selling AT&T Fiber to an AT&T Fiber customer is the fastest way to
  get a dealer agreement terminated.
- **`payable` is computed, not asserted.** It is `routable contact ∧ covered program ∧ fiber
  upgrade`, in one function, so the UI and any future billing claim cannot drift apart.

`speedreport-worker/src/serviceability.ts` — `GET /api/serviceability?zip=…`, the network
seam so the coverage source can move from "nothing" → KV feed → live partner API without
touching the client. Fail-closed for the same reason: unbound KV ⇒ `unknown`.

**Deliberate non-change:** the site still shows the existing lead card and nothing else.
The engine is dark until a coverage feed exists, because turning on deal cards with
`unknown` coverage would produce exactly the unverified leads that generate chargebacks.

---

## 5. Cross-satellite connections

The engine is only worth building if the other satellites consume it. Each link below has
a named contract, so the projects connect by interface rather than by vibes.

### 5.1 AXiM Core — the ledger (highest priority)

Extend `leads` (or add `lead_routes`) with:

```
program_id        text          -- 'kinetic' | 'att-fiber' | ...
partner_id        text          -- 'dsi' | 'direct' | ...
campaign_id       uuid          -- FK to campaigns; carries ?ref=<affiliateId>
referral_code     text          -- the affiliate token from the URL
offer_type        text          -- fiber_upgrade | cable_rescue | security_addon | diagnostic
quality_tier      text          -- routable | contactable | anonymous
coverage_status   text          -- covered | known_absent | unknown | unresolved_zip
coverage_source   text          -- feed | partner_api | none
consent_at        timestamptz   -- when consent was affirmatively captured
consent_version   text          -- which privacy notice they agreed to
routed_at         timestamptz   -- when it was handed to the partner
partner_lead_ref  text          -- the partner's own id (SARA order #, API response id)
state             text          -- captured | routed | accepted | rejected | installed | paid | clawed_back
state_changed_at  timestamptz
payout_cents      integer
```

Why this is not bureaucracy: **the ledger is the product we sell to the next partner.**
"Here are 1,200 verified routes, 61% accepted, 3.2% clawed back" is the sentence that moves
us from dealer-of-record to per-lead pricing. Without it we are a dealer with a website.

The state machine is the contract; the partner webhook (or nightly reconciliation import)
is the only thing allowed to advance it past `routed`.

### 5.2 AXiM Support — the routed lead's landing pad

`support.axim.us.com` already owns SLA escalation, `callAIWithFailover`, and the coding-lab
dispatch proxy. The natural extension: a **Lead Ops queue** where a routed lead that the
partner has not accepted in N hours raises a ticket. Support is also where the "call the
customer" workflow lives *if* we ever move to dealer-of-record — it is the satellite that
could absorb a sales floor with the least new plumbing, which is precisely why §2 says
don't start there.

### 5.3 AXiM Support — dispute dossiers (the no-partner revenue line)

`speedreport` already generates PDF SLA dispute dossiers. Wired to Support, that becomes:
**a business gets a 20 Mbps symmetric circuit on a 500 Mbps contract, uploads our PDF with a
Support ticket, and receives a formal, timestamped evidence package.** This is sellable to
customers with no partner, no coverage feed and no consent questions. It is also the
cleanest first dollar in the whole plan.

### 5.4 AXiM Web3 Frontend — the router-in

Marketing pages link to `speedreport.org/?ref=<affiliateId>&src=<surface>`. The engine reads
`ref` and `src` at measurement time and writes them to the ledger as `referral_code` /
`campaign_id`. This makes the long-discussed affiliate tracking real *and* makes the lead
value attributable per surface — which is how we learn which of the ecosystem's frontends
actually produce revenue rather than clicks.

### 5.5 Onyx Mk3 — the daily sweep

`onyx-edge` already runs a 02:35 EST pass over the Rust daemons. Phase 3 adds: reconcile
`state = routed` older than the partner's stated SLA, decrement coverage-feed freshness,
and surface `health.degraded` transitions (prospectStore, serviceability) into the daily
review. The fail-closed health flags added in this PR are designed to be polled by exactly
this sweep.

---

## 6. The DSI packet: what we must be able to prove

The application form (Zoho, `BecomeaAnAuthorizedDealerKineticLP`) asks for name, contact,
**company name, business address, business website**, and current dealer number (blank).
That is the whole bar. The advantage is not in the form — it is in the one-page brief
attached to the follow-up call.

**Evidence pack to have ready before the account executive calls:**

| Claim we want to make | The number that makes it, and where it comes from |
| --- | --- |
| "We generate qualified broadband intent at scale" | Tests/day, and % with an email captured. ← `speedreport_telemetry` AE dataset |
| "We only send you serviceable leads" | % of captured leads with a **verified** coverage status (must be ~100% by construction) |
| "We know the transport before you call them" | Distribution of `provider_tier` across captured leads |
| "We qualify on pain, not geography" | % with severe asymmetry / bad bufferbloat / underperformance vs paid plan |
| "We can show you where they came from" | Per-surface and per-`ref` attribution from the Core ledger |
| "We take consent seriously" | Consent version recorded per lead; complaint rate = 0 |

**Packet deliverables (I can draft each on request):**

1. **Cover letter** — position as *lead-generation and automation partner*, not a retail
   dealer. Explicitly state we are not requesting door-to-door territory.
2. **One-page capability brief** — the instrument, the qualification gates, the
   verification guarantee, the white-label posture.
3. **The four-numbers ask** — upfront / residual / clawback / lag, per brand, plus the
   per-qualified-lead pricing question.
4. **Coverage-feed request** — what format they can give us (ZIP list, address-level API,
   nightly file), because our `serviceability` KV is built to ingest any of the three.
5. **Technical annex** (optional, if the AE is technical) — HMAC-signed lead delivery,
   dead-letter queue with replay, per-IP rate limiting, no-PII telemetry.

**What we must NOT say:** anything that implies we already hold a coverage feed, or that
implies volume we cannot show from the analytics dataset. The AE will ask for a traffic
number, and it must be the real one.

---

## 7. Sequential plan — smallest first, each step independently valuable

| # | Step | Depends on | Value if everything after it dies |
| --- | --- | --- | --- |
| **P0** | Bind `PROSPECT_STORE` (**operator, 5 min**) | — | Leads stop being dropped; flood protected |
| **P0** | Resolve **D2** — where `/api/v1/leads/telemetry` actually lands | — | The pipeline stops being theatre |
| **P1** | **This PR**: classification/score/coverage/offer engine + `/api/serviceability` | — | The reusable core; zero user-visible risk |
| **P2** | Serviceability feed into KV + deal card reads the engine | P1, partner feed | Real offers on real coverage |
| **P3** | Consent capture (name, email, ZIP, checkbox, version) + `payable` gating | P2 | Genuinely routable leads |
| **P4** | Core ledger schema + partner webhook / reconciliation import | P3 | Attribution; the sentence that sells the next partner |
| **P5** | Route to partner (SARA Plus manual, then API) | P4 | First dollar from the channel |
| **P6** | Bundle-size work: split the report/PDF path (1,139 kB → target <400 kB entry) | — | Paid traffic economics |
| **P7** | Dispute-dossier product (Support integration) | P3 (consent model) | **Revenue with no partner at all** |
| **P8** | ISP scorecard / white-label embed for MSPs | P2 | Second partner-independent line |

**Explicitly deferred:** dealer-of-record, ad spend, any door-to-door anything. Those
require a sales floor, and the business case for the floor is `P5`'s close rate — which we
do not have yet. If `P2`→`P5` shows a high acceptance rate on verified routes, the floor
becomes an obvious investment rather than a guess.

---

## 8. Risk register

| Risk | Severity | Mitigation built into the design |
| --- | --- | --- |
| Unserviceable leads → chargebacks → dealer termination | **Critical** | `lookupCoverage()` cannot return `covered` without a feed; `payable` requires it. Structurally impossible to ship an unverified lead. |
| Brand erosion of the neutral instrument | **High** | White-label rule: no AXiM branding, no partner branding on the test surface, one card after the reading, silent when there is nothing true to say. |
| Lead-quality drift from bot/synthetic traffic | High | Per-IP limiter (needs P0), `quality_tier` downgrades anything without consent, telemetry carries no PII so scraping the dataset yields nothing sellable. |
| Consent / privacy exposure (TCPA, state privacy laws) | **High** | Explicit consent + version recorded; no PII in telemetry; ZIP is address-adjacent and never logged. **This needs your legal read before P3 ships.** |
| Partner concentration (single master agent) | Medium | The engine is program-agnostic (`PROGRAMS` map + per-ZIP array); adding a second master is a table entry, not a refactor. |
| Core ingress absent/misconfigured (D2) | **Critical** | `/health` exposes `leadForwarding`; add an end-to-end canary before P5. |
| Bundle size kills conversion on paid traffic | Medium | P6, before any ad spend. |

---

## 9. Decisions I need from you

1. **D2** — do we deploy the `leads` contract into platform Core, or repoint
   `AXIM_CORE_URL` at the vendored service? (I recommend deploying into Core: the ledger
   belongs with the portfolio, not inside a satellite's repo.)
2. **Coverage feed** — does the DSI application allow us to ask for a ZIP/address feed at
   the same time, or does that come only after approval? (Ask the AE; it changes P2's shape.)
3. **P0 namespace** — say the word and give me the namespace id, or run the one command and
   I'll wire the config in a separate PR.
4. **Legal** — is the consent language mine to draft for your review, or do you want your
   counsel to supply it?
5. **Commercial posture** — confirm *route-only first*. If you want dealer-of-record, say
   so now, because it changes P5 into a staffing project and I'd want to argue against it.

---

## 10. Appendix — files in this change

| File | Purpose |
| --- | --- |
| `src/utils/providerCatalog.js` | Transport classification from name + measurement; seed footprints; the coverage lookup with its fail-closed default. |
| `src/utils/leadEngine.js` | Scoring with reasons, plan parsing, contact quality, single-offer selection, the `payable` predicate, PII-free telemetry projection. |
| `speedreport-worker/src/serviceability.ts` | `GET /api/serviceability` with ZIP validation, program allowlist, KV read, fail-closed resolution. |
| `speedreport-worker/src/index.ts` | Route registration; `serviceability` added to `/health` dependency reporting. |
| `tests/providerCatalog.test.js` | 13 tests: classification priority, measurement fallback, coverage fail-closed. |
| `tests/leadEngine.test.js` | 24 tests: scoring, plan parsing, quality tiers, offer precedence, payable gating, telemetry PII exclusion. |
| `tests/serviceability.test.ts` | 15 tests: KV feed, malformed entries, KV failure, HTTP contract, allowlist-before-read, ZIP never logged, health binding. |
| `tests/workerHttp.test.ts` | Fixture updated for the new binding; health asserts the coverage-feed state. |

**Verified before hand-off:** `vitest run` → 140 passed / 16 files · `eslint --quiet` clean ·
`speedreport-worker tsc --noEmit` clean · `vite build` succeeds.
