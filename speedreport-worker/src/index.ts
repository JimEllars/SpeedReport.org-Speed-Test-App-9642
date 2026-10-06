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

    if (url.pathname === "/api/admin/trigger-report" && request.method === "POST") {
      if (!env.ADMIN_SECRET) {
        console.error("ADMIN_SECRET is not configured; rejecting report trigger.");
        return errorJson("Administrative reporting is unavailable", "admin_unavailable", 503, request, env);
      }

      if (!isAuthorized(request, env.ADMIN_SECRET)) {
        return errorJson("Unauthorized", "unauthorized", 401, request, env);
      }

      // Release workflow: keep manual reports off the response path so admin calls remain reliable.
      ctx.waitUntil(runExecutiveReportCron(env));
      return json({ status: "Report queued" }, 202, request, env);
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ status: "healthy", timestamp: Date.now() }, 200, request, env);
    }

    if (url.pathname === "/api/meta" && request.method === "GET") {
      return handleMeta(request, env);
    }

    if (url.pathname === "/api/ping" && request.method === "GET") {
      return new Response(null, {
        status: 204,
        headers: {
          ...getCorsHeaders(request, env),
          ...telemetryHeaders(request),
          "Content-Length": "0",
        },
      });
    }

    if (url.pathname === "/api/download" && request.method === "GET") {
      return handleDownload(request, url, env);
    }

    if (url.pathname === "/api/upload" && request.method === "POST") {
      return handleUpload(request, env);
    }


    if ((url.pathname === "/api/lead" || url.pathname === "/lead") && request.method === "POST") {
      return handleLeadSubmission(request, env, ctx);
    }

    if ((url.pathname === "/api/telemetry" || url.pathname === "/telemetry") && request.method === "POST") {
      return handleTelemetry(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },

  scheduled(_event: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): void {
    ctx.waitUntil(runExecutiveReportCron(env));
  },
};
