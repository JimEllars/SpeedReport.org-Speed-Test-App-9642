import { describe, expect, it } from 'vitest';
import { qualifyLeads, aggregateStatistics, generateHTMLReport } from '../speedreport-worker/src/executiveReporter';

describe('Executive Reporter & Lead Aggregator', () => {
  it('correctly qualifies leads based on degraded connection rules', () => {
    const runs = [
      { downloadMbps: 950, uploadMbps: 900, idlePingMs: 12, loadedPingMs: 15, bufferbloatGrade: 'A', city: 'DFW', region: 'TX', country: 'US', asn: 'AS701', isp: 'Comcast' },
      { downloadMbps: 35, uploadMbps: 10, idlePingMs: 85, loadedPingMs: 120, bufferbloatGrade: 'D', city: 'DFW', region: 'TX', country: 'US', asn: 'AS701', isp: 'Comcast' },
      { downloadMbps: 120, uploadMbps: 20, idlePingMs: 25, loadedPingMs: 65, bufferbloatGrade: 'C', city: 'Austin', region: 'TX', country: 'US', asn: 'AS7018', isp: 'AT&T' },
      { downloadMbps: 45, uploadMbps: 5, idlePingMs: 40, loadedPingMs: 300, bufferbloatGrade: 'F', city: 'Chicago', region: 'IL', country: 'US', asn: 'AS7922', isp: 'Comcast' },
      { downloadMbps: 100, uploadMbps: 100, idlePingMs: 60, loadedPingMs: 15, bufferbloatGrade: 'A', city: 'DFW', region: 'TX', country: 'US', asn: 'AS701', isp: 'Comcast' },
      { downloadMbps: 100, uploadMbps: 100, idlePingMs: 12, loadedPingMs: 60, bufferbloatGrade: 'A', city: 'DFW', region: 'TX', country: 'US', asn: 'AS701', isp: 'Comcast' },
    ];

    const qualified = qualifyLeads(runs);

    // Total runs: 6, but 5 are degraded (run 2, 3, 4, 5, 6)
    // Run 2: download < 50
    // Run 3: upload < 25
    // Run 4: download < 50
    // Run 5: idlePing > 50
    // Run 6: loadedPing > 50
    expect(qualified.length).toBe(5);

    expect(qualified[0].reason).toContain('Download < 50');
    expect(qualified[1].reason).toContain('Upload < 25');
    expect(qualified[2].reason).toContain('Download < 50');
    expect(qualified[3].reason).toContain('Latency > 50');
    expect(qualified[4].reason).toContain('Latency > 50');
  });

  it('aggregates statistics correctly', () => {
    const runs = [
      { downloadMbps: 950, uploadMbps: 900, idlePingMs: 10, loadedPingMs: 15, bufferbloatGrade: 'A', city: 'DFW', region: 'TX', country: 'US', asn: 'AS701', isp: 'Comcast' },
      { downloadMbps: 50, uploadMbps: 50, idlePingMs: 10, loadedPingMs: 15, bufferbloatGrade: 'A', city: 'DFW', region: 'TX', country: 'US', asn: 'AS701', isp: 'Comcast' },
    ];

    const stats = aggregateStatistics(runs);

    expect(stats.totalRuns).toBe(2);
    expect(stats.avgDownload).toBe(500);
    expect(stats.avgUpload).toBe(475);
    expect(stats.avgLatency).toBe(10);
    expect(stats.degradedPercentage).toBe(0);
    expect(stats.topRegions.length).toBe(1);
    expect(stats.commercialLeads.length).toBe(0);
  });

  it('generates an HTML email template outputting non-empty HTML containing valid recipient references', () => {
    const runs = [
      { downloadMbps: 35, uploadMbps: 10, idlePingMs: 85, loadedPingMs: 120, bufferbloatGrade: 'D', city: 'DFW', region: 'TX', country: 'US', asn: 'AS701', isp: 'Comcast' }
    ];
    const stats = aggregateStatistics(runs);
    const html = generateHTMLReport(stats);

    expect(html).toContain('SpeedReport.org Executive Intelligence Summary');
    expect(html).toContain('Comcast');
    expect(html).toContain('DFW');
    // Ensure we can see some degraded metrics
    expect(html).toContain('100.0%');
    expect(html.length).toBeGreaterThan(100);
  });
});
