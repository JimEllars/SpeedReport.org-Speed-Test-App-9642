// Executive Reporter & Lead Aggregator

export interface TestRun {
  downloadMbps: number;
  uploadMbps: number;
  idlePingMs: number;
  loadedPingMs: number;
  bufferbloatGrade: string;
  city: string;
  region: string;
  country: string;
  asn: string;
  isp: string;
}

export interface QualifiedLead extends TestRun {
  reason: string;
}

export interface RegionStats {
  regionName: string;
  totalRuns: number;
  poorConnections: number;
  avgDownload: number;
  avgUpload: number;
  avgLatency: number;
  degradedPercentage: number;
}

export interface ExecutiveReportEnvironment {
  RESEND_API_KEY?: string;
  REPORT_RECIPIENT_TO?: string;
  REPORT_RECIPIENT_BCC?: string;
}

export interface ExecutiveReportResult {
  success: boolean;
  dryRun: boolean;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

export function qualifyLeads(runs: TestRun[]): QualifiedLead[] {
  return runs
    .map((run) => {
      let reason: string | undefined;

      if (run.downloadMbps < 50) {
        reason = "Download < 50 Mbps";
      } else if (run.uploadMbps < 25) {
        reason = "Upload < 25 Mbps";
      } else if (run.idlePingMs > 50 || run.loadedPingMs > 50) {
        reason = "Latency > 50ms";
      } else if (["C", "D", "F"].includes(run.bufferbloatGrade)) {
        reason = `Bufferbloat ${run.bufferbloatGrade}`;
      }

      return reason ? { ...run, reason } : null;
    })
    .filter((lead): lead is QualifiedLead => lead !== null);
}

export function aggregateStatistics(runs: TestRun[]) {
  if (runs.length === 0) {
    return {
      totalRuns: 0,
      avgDownload: 0,
      avgUpload: 0,
      avgLatency: 0,
      degradedPercentage: 0,
      topRegions: [] as RegionStats[],
      commercialLeads: [] as QualifiedLead[],
    };
  }

  const qualifiedLeads = qualifyLeads(runs);
  const regionMap = new Map<string, RegionStats>();
  let totalDownload = 0;
  let totalUpload = 0;
  let totalLatency = 0;

  for (const run of runs) {
    const regionName = `${run.city}, ${run.region}, ${run.country} · ${run.asn} ${run.isp}`;
    const stats = regionMap.get(regionName) ?? {
      regionName,
      totalRuns: 0,
      poorConnections: 0,
      avgDownload: 0,
      avgUpload: 0,
      avgLatency: 0,
      degradedPercentage: 0,
    };

    stats.totalRuns += 1;
    stats.avgDownload += run.downloadMbps;
    stats.avgUpload += run.uploadMbps;
    stats.avgLatency += run.idlePingMs;
    regionMap.set(regionName, stats);
    totalDownload += run.downloadMbps;
    totalUpload += run.uploadMbps;
    totalLatency += run.idlePingMs;
  }

  for (const lead of qualifiedLeads) {
    const regionName = `${lead.city}, ${lead.region}, ${lead.country} · ${lead.asn} ${lead.isp}`;
    const stats = regionMap.get(regionName);
    if (stats) {
      stats.poorConnections += 1;
    }
  }

  const topRegions = Array.from(regionMap.values())
    .map((stats) => ({
      ...stats,
      avgDownload: stats.avgDownload / stats.totalRuns,
      avgUpload: stats.avgUpload / stats.totalRuns,
      avgLatency: stats.avgLatency / stats.totalRuns,
      degradedPercentage: (stats.poorConnections / stats.totalRuns) * 100,
    }))
    .sort((a, b) => b.poorConnections - a.poorConnections);

  return {
    totalRuns: runs.length,
    avgDownload: totalDownload / runs.length,
    avgUpload: totalUpload / runs.length,
    avgLatency: totalLatency / runs.length,
    degradedPercentage: (qualifiedLeads.length / runs.length) * 100,
    topRegions,
    commercialLeads: qualifiedLeads,
  };
}

export function generateHTMLReport(
  stats: ReturnType<typeof aggregateStatistics>,
): string {
  const topRegionsHtml =
    stats.topRegions
      .slice(0, 10)
      .map(
        (region) => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #333;">${escapeHtml(region.regionName)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #333; text-align: right;">${region.poorConnections} / ${region.totalRuns}</td>
      <td style="padding: 12px; border-bottom: 1px solid #333; text-align: right;">${region.degradedPercentage.toFixed(1)}%</td>
      <td style="padding: 12px; border-bottom: 1px solid #333; text-align: right;">${region.avgDownload.toFixed(1)} Mbps</td>
    </tr>`,
      )
      .join("") ||
    `<tr><td colspan="4" style="padding: 12px;">No telemetry was available for this reporting period.</td></tr>`;

  const leadsHtml =
    stats.commercialLeads
      .slice(0, 15)
      .map(
        (lead) => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #333;">${escapeHtml(`${lead.city}, ${lead.region} · ${lead.asn} ${lead.isp}`)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #333;">${escapeHtml(lead.reason)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #333; text-align: right;">${lead.downloadMbps.toFixed(1)} Mbps</td>
      <td style="padding: 12px; border-bottom: 1px solid #333; text-align: right;">${lead.idlePingMs.toFixed(1)} ms</td>
    </tr>`,
      )
      .join("") ||
    `<tr><td colspan="4" style="padding: 12px;">No degraded connections were identified.</td></tr>`;

  return `<!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #111; color: #eee; margin: 0; padding: 20px; }
          .container { max-width: 800px; margin: 0 auto; background-color: #1a1a1a; padding: 30px; border-radius: 8px; }
          h1 { color: #fff; font-size: 24px; margin-top: 0; border-bottom: 2px solid #333; padding-bottom: 15px; }
          h2 { color: #ddd; font-size: 18px; margin-top: 30px; }
          .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 30px; }
          .kpi-card { background-color: #222; padding: 15px; border-radius: 6px; text-align: center; border: 1px solid #333; }
          .kpi-value { font-size: 24px; font-weight: bold; color: #fff; margin-bottom: 5px; }
          .kpi-label { font-size: 12px; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 14px; }
          th { text-align: left; padding: 12px; border-bottom: 2px solid #333; color: #aaa; font-weight: 600; }
          .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #666; border-top: 1px solid #333; padding-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>SpeedReport.org Executive Intelligence Summary</h1>
          <div class="kpi-grid">
            <div class="kpi-card"><div class="kpi-value">${stats.totalRuns}</div><div class="kpi-label">Total Runs</div></div>
            <div class="kpi-card"><div class="kpi-value">${stats.avgDownload.toFixed(1)}</div><div class="kpi-label">Avg DL (Mbps)</div></div>
            <div class="kpi-card"><div class="kpi-value">${stats.avgLatency.toFixed(1)}</div><div class="kpi-label">Avg Latency (ms)</div></div>
            <div class="kpi-card"><div class="kpi-value" style="color: #ff4444;">${stats.degradedPercentage.toFixed(1)}%</div><div class="kpi-label">Degraded Lines</div></div>
          </div>
          <h2>Top Prospect Regions</h2>
          <table><thead><tr><th>Region & ISP</th><th style="text-align: right;">Poor / Total</th><th style="text-align: right;">% Degraded</th><th style="text-align: right;">Avg DL</th></tr></thead><tbody>${topRegionsHtml}</tbody></table>
          <h2>Commercial Lead Highlights</h2>
          <table><thead><tr><th>Target ISP & Location</th><th>Qualification Reason</th><th style="text-align: right;">Download</th><th style="text-align: right;">Latency</th></tr></thead><tbody>${leadsHtml}</tbody></table>
          <div class="footer">Automated Backend Intelligence Report &middot; SpeedReport.org<br>Strictly Confidential - Internal B2B Prospecting</div>
        </div>
      </body>
    </html>`;
}

export async function runExecutiveReportCron(
  env: ExecutiveReportEnvironment,
  runs: TestRun[] = [],
): Promise<ExecutiveReportResult> {
  const stats = aggregateStatistics(runs);
  const htmlReport = generateHTMLReport(stats);
  const { RESEND_API_KEY: apiKey, REPORT_RECIPIENT_TO: to, REPORT_RECIPIENT_BCC: bcc } =
    env;

  if (!apiKey) {
    console.warn(
      JSON.stringify({
        event: "executive_report.dry_run",
        reason: "RESEND_API_KEY is not configured",
        totalRuns: stats.totalRuns,
      }),
    );
    return { success: true, dryRun: true };
  }

  if (!to) {
    console.error(
      JSON.stringify({
        event: "executive_report.skipped",
        reason: "REPORT_RECIPIENT_TO is not configured",
      }),
    );
    return { success: false, dryRun: false };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "reports@speedreport.org",
        to: [to],
        ...(bcc ? { bcc: [bcc] } : {}),
        subject: "[SpeedReport Executive] Daily Network Diagnostics & Prospecting Summary",
        html: htmlReport,
      }),
    });

    if (!response.ok) {
      console.error(
        JSON.stringify({
          event: "executive_report.dispatch_failed",
          status: response.status,
        }),
      );
      return { success: false, dryRun: false };
    }

    console.log(JSON.stringify({ event: "executive_report.dispatched" }));
    return { success: true, dryRun: false };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "executive_report.dispatch_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { success: false, dryRun: false };
  }
}
