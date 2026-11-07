/**
 * Consent copy — single source of truth.
 *
 * VERSION BUMP RULE: any change to the checkbox wording, the purpose, or the
 * recipients must bump CONSENT_VERSION. A lead captured under an older version
 * that has not yet been routed must be re-consented, because the permission the
 * visitor gave was for the old words, not the new ones.
 *
 * The full reviewable text, including the privacy notice and withdrawal copy,
 * lives in docs/consent-language.md. Keep the two in step: this file is what the
 * app renders and records, that file is what counsel approves.
 *
 * NOT YET DEPLOYED. Consent capture is phase P3 and is blocked on counsel review
 * of docs/consent-language.md. Nothing here should be rendered until that review
 * is on record.
 */

export const CONSENT_VERSION = 'sr-consent-2026-11-v1';

/** The single purpose a SpeedReport visitor can consent to. Never broaden it. */
export const CONSENT_PURPOSE = 'provider_match';

export const CONSENT_COPY = Object.freeze({
  version: CONSENT_VERSION,
  purpose: CONSENT_PURPOSE,

  /** Checkbox label. Rendered unchecked, never pre-ticked. */
  label:
    "It's okay to contact me about a better connection at this address.",

  /** Body text rendered beside or beneath the checkbox. */
  body: [
    "I'm asking SpeedReport.org to check whether a faster internet service is available where I live or work, and to share my name, email address and ZIP code with a vetted internet provider or its authorized sales partner so they can contact me about it. I understand:",
  ],

  bullets: [
    'providing this is optional, and the speed test works the same either way;',
    'the provider or partner — not SpeedReport.org — will contact me, usually by email or phone, and may do so more than once;',
    'I can withdraw this permission at any time, and withdrawing stops future sharing;',
    'my consent is recorded with a timestamp and the version of this notice I agreed to.',
  ],

  /** Buttons. Same size and contrast adjacent — declining is never punished. */
  acceptLabel: 'Share my address with a provider',
  declineLabel: 'No thanks — just my report',

  /** Post-capture acknowledgement shown only after a successful opt-in. */
  acknowledgement: {
    title: 'Request received',
    body: "We'll check whether a faster service is available at your address and share your details only if one is. You can withdraw at any time by emailing privacy@speedreport.org.",
  },

  withdrawalEmail: 'privacy@speedreport.org',
  withdrawalPath: '/privacy/choices',
  partnerListPath: '/partners',
});

/**
 * True when a stored consent record still matches the current notice. A route may
 * only proceed on `true`.
 */
export function isConsentCurrent(record) {
  return Boolean(record) && record.version === CONSENT_VERSION;
}

/**
 * Shape stored with every consented lead. Deliberately minimal: the version is
 * what makes the record defensible, and the ZIP/email are what make withdrawal
 * and route cancellation possible.
 */
export function buildConsentRecord({ at, ip = null }) {
  return {
    version: CONSENT_VERSION,
    purpose: CONSENT_PURPOSE,
    at: at ?? new Date().toISOString(),
    // A hashed source IP is retained for abuse defence and dispute resolution;
    // the raw address never is. Kept optional so the caller decides.
    sourceIpHash: ip,
  };
}
