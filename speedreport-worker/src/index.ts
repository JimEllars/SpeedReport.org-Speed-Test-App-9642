import { handleDownload } from "./download";
import { runExecutiveReportCron } from "./executiveReporter";
import { getCorsHeaders, json, telemetryHeaders, errorJson } from "./http";
import { handleMeta } from "./meta";
import { handleUpload } from "./upload";
import { handleTelemetry, handleLeadSubmission } from "./telemetry";

interface WorkerEnv {
  ASSETS: Fetcher;
  TELEMETRY: AnalyticsEngineDataset;
  ADMIN_SECRET?: string;
  RESEND_API_KEY?: string;
  REPORT_RECIPIENT_TO?: string;
  REPORT_RECIPIENT_BCC?: string;
}


function isAuthorized(request: Request, adminSecret?: string): boolean {
  return Boolean(adminSecret) && request.headers.get("Authorization") === `Bearer ${adminSecret}`;
}

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const searchString = url.search.toLowerCase();
    const pathString = url.pathname.toLowerCase();

    const blockedPatterns = [
      "?-d", "auto_prepend_file", "auto_append_file", "allow_url_include", "disable_functions", "safe_mode"
    ];
    const blockedPaths = [
      "..", "%2e%2e", ".php", "/wp-admin", "/wp-login", "xmlrpc.php", "cgi-bin"
    ];

    if (blockedPatterns.some(p => searchString.includes(p)) || blockedPaths.some(p => pathString.includes(p) || searchString.includes(p))) {
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
