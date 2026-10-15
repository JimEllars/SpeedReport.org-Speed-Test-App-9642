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

    if (request.method === "OPTIONS") {
      const headers = getCorsHeaders(request, env);
      return new Response(null, { status: 204, headers });
    }

    const path = url.pathname.replace(/\/$/, ""); // Normalize trailing slashes

    switch (path) {
      case "/health":
        if (request.method === "GET") {
          return json({ status: "healthy", timestamp: Date.now() }, 200, request, env);
        }
        break;
      case "/api/meta":
        if (request.method === "GET") {
          return handleMeta(request, env);
        }
        break;
      case "/api/ping":
        if (request.method === "GET") {
          return new Response(null, {
            status: 204,
            headers: {
              ...getCorsHeaders(request, env),
              ...telemetryHeaders(request),
              "Content-Length": "0",
            },
          });
        }
        break;
      case "/api/download":
        if (request.method === "GET") {
          return handleDownload(request, url, env);
        }
        break;
      case "/api/admin/trigger-report":
        if (request.method === "POST") {
          if (!env.ADMIN_SECRET) {
            console.error("ADMIN_SECRET is not configured; rejecting report trigger.");
            return errorJson("Administrative reporting is unavailable", "admin_unavailable", 503, request, env);
          }
          if (!isAuthorized(request, env.ADMIN_SECRET)) {
            return errorJson("Unauthorized", "unauthorized", 401, request, env);
          }
          ctx.waitUntil(runExecutiveReportCron(env));
          return json({ status: "Report queued" }, 202, request, env);
        }
        break;
      case "/api/upload":
        if (request.method === "POST") {
          return handleUpload(request, env);
        }
        break;
      case "/api/lead":
      case "/lead":
        if (request.method === "POST") {
          return handleLeadSubmission(request, env, ctx);
        }
        break;
      case "/api/telemetry":
      case "/telemetry":
        if (request.method === "POST") {
          return handleTelemetry(request, env, ctx);
        }
        break;
    }

    return env.ASSETS.fetch(request);
  },

  scheduled(_event: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): void {
    ctx.waitUntil(runExecutiveReportCron(env));
  },
};
