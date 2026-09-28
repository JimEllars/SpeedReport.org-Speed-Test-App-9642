import { handleDownload } from "./download";
import { runExecutiveReportCron } from "./executiveReporter";
import { getCorsHeaders, json, telemetryHeaders } from "./http";
import { handleMeta } from "./meta";
import { handleUpload } from "./upload";
import { handleTelemetry } from "./telemetry";

interface WorkerEnv {
  ASSETS: Fetcher;
  TELEMETRY: AnalyticsEngineDataset;
  ADMIN_SECRET?: string;
  RESEND_API_KEY?: string;
  REPORT_RECIPIENT_TO?: string;
  REPORT_RECIPIENT_BCC?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
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
      const headers = getCorsHeaders(request);
      if (url.pathname === "/api/telemetry" || url.pathname === "/telemetry") {
        headers["Access-Control-Allow-Headers"] = "Content-Type, X-Session-ID, Cache-Control";
      }
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === "/api/admin/trigger-report" && request.method === "POST") {
      if (!env.ADMIN_SECRET) {
        console.error("ADMIN_SECRET is not configured; rejecting report trigger.");
        return new Response("Administrative reporting is unavailable", { status: 503 });
      }

      if (!isAuthorized(request, env.ADMIN_SECRET)) {
        return new Response("Unauthorized", { status: 401 });
      }

      // Release workflow: keep manual reports off the response path so admin calls remain reliable.
      ctx.waitUntil(runExecutiveReportCron(env));
      return json({ status: "Report queued" }, 202, request);
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ status: "healthy", timestamp: Date.now() }, 200, request);
    }

    if (url.pathname === "/api/meta" && request.method === "GET") {
      return handleMeta(request);
    }

    if (url.pathname === "/api/ping" && request.method === "GET") {
      return new Response(null, {
        status: 204,
        headers: {
          ...getCorsHeaders(request),
          ...telemetryHeaders(request),
          "Content-Length": "0",
        },
      });
    }

    if (url.pathname === "/api/download" && request.method === "GET") {
      return handleDownload(request, url);
    }

    if (url.pathname === "/api/upload" && request.method === "POST") {
      return handleUpload(request);
    }

    if ((url.pathname === "/api/telemetry" || url.pathname === "/telemetry") && request.method === "POST") {
      return handleTelemetry(request, env);
    }

    return env.ASSETS.fetch(request);
  },

  scheduled(_event: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): void {
    ctx.waitUntil(runExecutiveReportCron(env));
  },
};
