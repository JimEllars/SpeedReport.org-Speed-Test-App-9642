import { json, errorJson } from "./http";

/**
 * Serviceability — "is there a sellable program at this address?"
 *
 * This is the endpoint that decides whether a SpeedReport visitor is shown a
 * deal card or a polite no-thanks. It exists as a network seam *now* so the
 * answer's source can change without touching the client:
 *
 *   Phase 1 (this file): no feed configured → every program resolves `unknown`,
 *     which the client renders as "search, don't sell". Zero unverified leads
 *     are ever produced by default. This is a deliberate fail-closed design.
 *
 *   Phase 2: `SERVICEABILITY` KV populated per ZIP from whatever the partner
 *     provides — a master agent's coverage file, a partner API nightly sync, or
 *     an operator upload keyed by ZIP (see docs/serviceability-feed.md).
 *
 *   Phase 3: a live partner lookup behind the same JSON contract.
 *
 * Contract (stable across phases):
 *   GET  /api/serviceability?zip=75001[&programs=kinetic,att-fiber]
 *   200  { zip, checkedAt, source, programs: [{ programId, status, source }] }
 *        status ∈ covered | known_absent | unknown | unresolved_zip
 *
 * Privacy: the ZIP is used to answer the request and is never persisted or
 * logged. Only the resolved status is written to the telemetry dataset, and only
 * by the caller that already has consent.
 */

export const COVERAGE_STATUS = {
  COVERED: "covered",
  KNOWN_ABSENT: "known_absent",
  UNKNOWN: "unknown",
  UNRESOLVED_ZIP: "unresolved_zip",
} as const;

export type CoverageStatus = (typeof COVERAGE_STATUS)[keyof typeof COVERAGE_STATUS];

export const DEFAULT_PROGRAMS = ["kinetic", "att-fiber"] as const;

// A ZIP is 5 digits. This is the only validation that matters: anything else is
// not a question we can answer, and it must not reach KV.
const ZIP_PATTERN = /^\d{5}$/;

export interface ProgramCoverage {
  programId: string;
  status: CoverageStatus;
  source: "feed" | "none";
}

export interface ServiceabilityResult {
  zip: string;
  checkedAt: string;
  source: "feed" | "none";
  programs: ProgramCoverage[];
}

function parseProgramIds(raw: string | null): string[] {
  if (!raw) return [...DEFAULT_PROGRAMS];
  const requested = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  // Only known programs are answerable, and the allowlist is what stops this
  // endpoint being used to enumerate arbitrary KV keys.
  return requested.filter((id) => (DEFAULT_PROGRAMS as readonly string[]).includes(id));
}

/**
 * Read coverage for one ZIP. A malformed entry in KV is treated as `unknown`
 * rather than trusted: bad data must not become a sales claim.
 */
export async function resolveServiceability(
  zip: string,
  programIds: string[],
  store?: KVNamespace,
): Promise<ServiceabilityResult> {
  const checkedAt = new Date().toISOString();

  if (!ZIP_PATTERN.test(zip)) {
    return {
      zip,
      checkedAt,
      source: "none",
      programs: programIds.map((programId) => ({
        programId,
        status: COVERAGE_STATUS.UNRESOLVED_ZIP,
        source: "none",
      })),
    };
  }

  let feed: Record<string, string> | null = null;
  if (store) {
    try {
      feed = (await store.get(`svc:${zip}`, "json")) as Record<string, string> | null;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "serviceability.read_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      feed = null;
    }
  }

  const programs: ProgramCoverage[] = programIds.map((programId) => {
    const status = feed?.[programId];
    if (
      status === COVERAGE_STATUS.COVERED ||
      status === COVERAGE_STATUS.KNOWN_ABSENT
    ) {
      return { programId, status, source: "feed" };
    }
    return { programId, status: COVERAGE_STATUS.UNKNOWN, source: "none" };
  });

  return {
    zip,
    checkedAt,
    source: programs.some((entry) => entry.source === "feed") ? "feed" : "none",
    programs,
  };
}

export async function handleServiceability(
  request: Request,
  env: any,
): Promise<Response> {
  const url = new URL(request.url);
  const zip = (url.searchParams.get("zip") ?? "").trim();
  const programIds = parseProgramIds(url.searchParams.get("programs"));

  if (!zip) {
    return errorJson("A zip query parameter is required", "missing_zip", 400, request, env);
  }

  if (!ZIP_PATTERN.test(zip)) {
    return errorJson("zip must be a 5-digit US postal code", "invalid_zip", 400, request, env);
  }

  if (programIds.length === 0) {
    return errorJson(
      "No recognised program requested",
      "unknown_program",
      400,
      request,
      env,
    );
  }

  const result = await resolveServiceability(zip, programIds, env.SERVICEABILITY);
  return json(result, 200, request, env);
}
