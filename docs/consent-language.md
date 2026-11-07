# Consent Language — SpeedReport.org

**Status:** DRAFT FOR COUNSEL REVIEW — not yet deployed. Nothing in this document is live.
**Version string to record with every consent:** `sr-consent-2026-11-v1`
**Prepared:** 2026-11-05 · Onyx for Mr. James Ellars
**Operator of record:** AXiM Systems (DBA), under Axim Capital, LLC (TX) — *confirm the exact
legal entity and registered address with counsel before publishing.*

> **How to use this document.** Sections 1–5 are the actual customer-facing copy, written to
> be pasted into the app. Section 6 is the implementation contract engineers build against.
> Section 7 is the list of questions I need counsel to answer — I have made a defensible
> choice on each and flagged where the choice is load-bearing.
>
> **The golden rule this copy is built around:** SpeedReport's speed test is free, complete
> and identical whether or not you consent. Consent buys exactly one thing — permission to
> contact you about a better connection. No consent, no contact, and the tool still works.
> If the product ever violates that sentence, the language here is a lie and the brand is
> finished.

---

## 1. Consent checkbox (in-app, deal card)

`sr-consent-2026-11-v1`

> ☐ **It's okay to contact me about a better connection at this address.**
>
> I'm asking SpeedReport.org to check whether a faster internet service is available where I
> live or work, and to share my name, email address and ZIP code with a vetted internet
> provider or its authorized sales partner so they can contact me about it. I understand:
>
> - providing this is **optional**, and the speed test works the same either way;
> - the provider or partner — not SpeedReport.org — will contact me, usually by email or
>   phone, and may do so more than once;
> - I can withdraw this permission at any time (see §4), and withdrawing stops future
>   sharing;
> - my consent is recorded with a timestamp and the version of this notice I agreed to.
>
> [Privacy Notice](#2-privacy-notice-short-form) · [How we handle your data](#3-data-handling-disclosure)

**Consent button label:** `Share my address with a provider`
**Decline label:** `No thanks — just my report`

*Deliberately not pre-checked. Not bundled with any other action. Declining must not dim,
shrink or otherwise punish the decline control — same size, same contrast, adjacent.*

---

## 2. Privacy Notice (short form, rendered inline under the checkbox)

`sr-consent-2026-11-v1`

> **What we collect when you ask for a provider match**
>
> **What you give us:** your name, email address, and ZIP code, plus the results of the speed
> test you just ran (download and upload speed, latency, jitter, packet loss, and whether
> your connection struggled under load).
>
> **What we do with it:** we check whether a faster service is available at your address. If
> one is, we share your name, email address, ZIP code and your test results with that
> provider or its authorized sales partner so they can contact you. If none is available, we
> don't share anything and we'll tell you.
>
> **What we never do:** we don't sell your data to data brokers or list resellers; we don't
> share it with anyone who isn't a provider or its authorized partner relevant to your
> request; and we don't publish it.
>
> **What stays on your device:** your test history is stored in your browser. We don't have
> it unless you send it to us.
>
> **How long we keep it:** your request and its outcome are kept for up to 24 months so we
> can honour withdrawal requests and keep accurate records. After that it's deleted or
> anonymized.
>
> **Your choices:** withdraw consent at any time at [/privacy/choices](#4-how-to-withdraw-consent),
> or email **privacy@speedreport.org**.

---

## 3. Data handling disclosure (expandable, `/privacy` page)

### 3.1 What is collected, and when

| Data | Purpose | When | Legal basis (proposed) |
| --- | --- | --- | --- |
| Download/upload speed, latency, jitter, packet loss, bufferbloat grade | Produce your report; measure service quality | Every test | Legitimate interest in operating the service |
| Approximate location (city/region) and network operator, derived from your IP by our edge | Show correct connection details; keep the report accurate | Every test | Legitimate interest; **IP never stored** |
| An anonymous test identifier and timestamp | Prevent abuse; aggregate service statistics | Every test | Legitimate interest |
| Name, email, ZIP code | Route your request to a provider | Only when you consent | **Your consent** |
| Provider-match outcome (whether coverage existed, whether it was shared) | Honour withdrawals; prove what we did with your data | Only when you consent | Legal obligation + legitimate interest |

### 3.2 What is never collected

- No cookies for advertising, no third-party trackers, no ad networks on any SpeedReport page.
- No lawful-intercept or content inspection; we measure throughput, not traffic.
- No persistent identifier tied to a person for the anonymous statistics feed.

### 3.3 Who receives it

One provider, or that provider's authorized sales partner, per request. The current list of
providers and partners is published at `/partners` and updated whenever it changes. If your
address has no available provider, nothing is shared with anyone.

### 3.4 Where it goes

Data is stored in the United States. Where a provider is outside your state, your data may be
transferred to that provider's systems under their own privacy notice, which we link to
before you consent.

### 3.5 Selling

**We do not sell personal information** as "sale" is defined by the CCPA/CPRA or any
comparable state law. Sharing a lead with a provider *at your direction* is a service you
asked for, not a sale — but [counsel: confirm and, if you prefer belt-and-braces, we will
publish a "Do Not Sell or Share My Personal Information" link anyway, since a visible link
costs nothing and forecloses the argument].

---

## 4. How to withdraw consent

`sr-consent-2026-11-v1`

> **Withdrawing your permission**
>
> Email **privacy@speedreport.org** with the subject "Withdraw" and the email address you
> used — or use the form at `/privacy/choices`. No account, no password, no reason required.
>
> We action withdrawals within **10 business days** and confirm by email. Withdrawing stops
> any future sharing. It cannot recall a request a provider has already received; we will
> tell you which provider received it and when, so you can contact them directly.
>
> If you asked us not to contact you again, we keep the minimum record needed to honour that
> — typically your email address and a "do not contact" flag — and nothing else.

---

## 5. Required acknowledgements and the fine print counsel will want

1. **No purchase obligation.** Requesting a provider match costs nothing and creates no
   contract with SpeedReport.org, the provider, or its partner.
2. **No guarantee of service.** Availability, pricing and terms are the provider's; we don't
   set, quote or warrant them. **We do not currently display prices** — if that changes, a
   separate disclosure is required.
3. **No commission disclosure required at point of consent** under current US practice, but
   we will state plainly on `/partners`: *"SpeedReport.org may be paid by a provider or its
   partner when someone we refer becomes a customer. This doesn't change what the speed test
   shows you."* Honesty here is cheaper than a regulator asking.
4. **Test results are indicative.** Measurements reflect the moment of testing, your device,
   Wi-Fi and the path to our test node — not a contractual measurement of your service.
5. **Age.** The service is not directed to children under 16, and we do not knowingly accept
   consent from them.

---

## 6. Implementation contract (what engineers build)

| Requirement | Implementation |
| --- | --- |
| Consent is **affirmative** | Unchecked checkbox; no pre-tick; no "by continuing you agree" pattern. |
| Consent is **specific** | One purpose only: provider matching. Never bundled with newsletter, analytics or terms acceptance. |
| Consent is **recorded** | `consent_at` timestamptz, `consent_version` text, plus the exact ZIP and email consented to. |
| **Version changes** | Bumping `sr-consent-2026-11-v1` requires re-consent for any lead captured under an older version that has not yet been routed. |
| **Minimum necessary** | Name and email are *not* required to receive a report. They are required only for `quality_tier = routable` and therefore only for a payable route. |
| **Withdrawal propagates** | A withdrawal marks the lead `state = withdrawn` and any un-consumed route is cancelled before forwarding. |
| **No shadow collection** | The ZIP is never written to a log, never in telemetry, never in a KV key. Only the derived status is recorded. |
| **Fail-closed** | `payable` requires `consent === true` AND a covered ZIP. Both are already enforced in `leadEngine.buildLeadIntent()`. |

**Where the copy lives:** a single source of truth module
(`src/content/consent.js`) exporting `CONSENT_VERSION` and the strings above, so the checkbox,
the privacy page and the stored version can never drift. When counsel returns edits, one file
changes and the version string bumps.

---

## 7. Questions for counsel — with my recommended answer

| # | Question | My recommended answer | Why it matters |
| --- | --- | --- | --- |
| 1 | TCPA: form-submitted lead vs. autodialed call | Treat **every** lead as needing written consent; prohibit autodialers and prerecorded messages in the partner contract. | One partner making robocalls with our lead exposes us to a class action. |
| 2 | TCPA one-to-one consent (post-*Duguid*) | Each consent names a **single** provider/partner, never a list of brands. | Bundled multi-brand consent is the most likely invalidation. |
| 3 | CCPA/CPRA "sale" vs. "share" | Publish the "Do Not Sell or Share" link regardless of the analysis. | Costs nothing; removes the argument. |
| 4 | Retention period | 24 months, then delete or anonymize. | Long enough to honour withdrawals and defend a dispute; short enough to be defensible. |
| 5 | Data Processing Agreement with DSI / partners | Require a DPA that binds them to use the data **only** for the requested offer, with a deletion obligation. | Without it we are a data broker wearing a dealer hat. |
| 6 | Entity of record | Confirm: AXiM Systems (DBA) or Axim Capital, LLC. | Must match the `/privacy` page, the consent record and the partner contract. |
| 7 | State-specific notices (CA, VA, CO, CT, TX, OR, etc.) | One national notice covering the strictest state. | Cheaper and simpler than per-state branching. |
| 8 | Do we need a "no prices shown" representation? | Yes, keep §5.2 until we display pricing. | Displaying a partner price we don't control is a separate regulatory surface. |

---

## 8. Open items I need from you

1. **Counsel review** of §1–§5 before any consent capture ships (phase P3).
2. **Legal entity + registered address** to fill the operator line at the top.
3. **`privacy@speedreport.org`** — does that mailbox exist yet? Every promise above points at it.
4. **Partner DPA** — does DSI sign one, or only at the master-agent level? This is a question
   for the AE in the same conversation as the coverage-feed ask (§6 of the strategy doc).
