import { handleDownload } from "./download";
import { runExecutiveReportCron } from "./executiveReporter";
import { getCorsHeaders, json, telemetryHeaders, errorJson } from "./http";
import { handleMeta } from "./meta";
import { handleUpload } from "./upload";
import { handleTelemetry, handleLeadSubmission } from "./telemetry";

interface WorkerEnv {
  ASSETS: Fetcher;
  TELEMETRY: AnalyticsEngineDataset;
  PROSPECT_STORE?: KVNamespace;
  ADMIN_SECRET?: string;
  RESEND_API_KEY?: string;
  REPORT_RECIPIENT_TO?: string;
  REPORT_RECIPIENT_BCC?: string;
  AXIM_CORE_URL?: string;
  AXIM_INTERNAL_KEY?: string;
  ALLOWED_ORIGINS?: string;
}


function isAuthorized(request: Request, adminSecret?: string): boolean {
  return Boolean(adminSecret) && request.headers.get("Authorization") === `Bearer ${adminSecret}`;
}

/**
 * Percent-decode up to twice, so double-encoded payloads (`%252e%252e`) cannot
 * slip past a single-pass check. Returns lowercase for case-insensitive matching.
 */
function decodeForInspection(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      // Malformed escape sequence - inspect what we have and stop.
      break;
    }
  }
  return decoded.toLowerCase();
}

// PHP-CGI argument injection and common backdoor/exec paths.
const BLOCKED_PATTERNS = [
  "?-d",
  "auto_prepend_file",
  "auto_append_file",
  "allow_url_include",
  "disable_functions",
  "safe_mode",
  "php://input",
  "data://",
];

const BLOCKED_PATHS = [
  "..",
  "%2e%2e",
  ".php",
  "/wp-admin",
  "/wp-login",
  "xmlrpc.php",
  "cgi-bin",
];

// CGI injection commonly arrives as a query parameter whose name starts with a
// dash (e.g. `?-d allow_url_include=on`). No legitimate route here uses one.
const CGI_DASH_PARAM = /(^|[?&])-[a-z]/i;

export function isBlockedRequest(url: URL): boolean {
  const rawPath = url.pathname.toLowerCase();
  const rawSearch = url.search.toLowerCase();
  const inspected = [
    rawPath,
    rawSearch,
    decodeForInspection(rawPath),
    decodeForInspection(rawSearch),
  ];

  if (inspected.some((value) => CGI_DASH_PARAM.test(value))) {
    return true;
  }

  if (BLOCKED_PATTERNS.some((pattern) => inspected.some((value) => value.includes(pattern)))) {
    return true;
  }

  return BLOCKED_PATHS.some((pattern) => inspected.some((value) => value.includes(pattern)));
}

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (isBlockedRequest(url)) {
      return new Response("Forbidden", { status: 403, headers: getCorsHeaders(request, env) });
    }

    if (request.method === "OPTIONS") {
      const headers = getCorsHeaders(request, env);
      return new Response(null, { status: 204, headers });
    }

    const path = url.pathname.replace(/\/$/, ""); // Normalize trailing slashes

    if (request.method === "GET") {
      switch (path) {
        case "/health":
          return json({ status: "healthy", timestamp: Date.now() }, 200, request, env);
        case "/api/meta":
          return handleMeta(request, env);
        case "/api/ping":
          return new Response(null, {
            status: 204,
            headers: {
              ...getCorsHeaders(request, env),
              ...telemetryHeaders(request),
              "Content-Length": "0",
            },
          });
        case "/api/download":
          return handleDownload(request, url, env);
      }
    }

    if (request.method === "POST") {
      switch (path) {
        case "/api/admin/trigger-report":
          if (!env.ADMIN_SECRET) {
            console.error("ADMIN_SECRET is not configured; rejecting report trigger.");
            return errorJson("Administrative reporting is unavailable", "admin_unavailable", 503, request, env);
          }

          if (!isAuthorized(request, env.ADMIN_SECRET)) {
            return errorJson("Unauthorized", "unauthorized", 401, request, env);
          }

          ctx.waitUntil(runExecutiveReportCron(env));
          return json({ status: "Report queued" }, 202, request, env);
        case "/api/upload":
          return handleUpload(request, env);
        case "/api/lead":
        case "/lead":
          return handleLeadSubmission(request, env, ctx);
        case "/api/telemetry":
        case "/telemetry":
          return handleTelemetry(request, env, ctx);
      }
    }

    return env.ASSETS.fetch(request);
  },

  scheduled(_event: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): void {
    ctx.waitUntil(runExecutiveReportCron(env));
  },
};
