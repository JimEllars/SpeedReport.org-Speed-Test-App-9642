# Analytics Queries

This document contains standard Cloudflare Analytics Engine SQL queries for visualizing edge telemetry.

## Base Query: Aggregate Bandwidth by ISP

This query extracts metrics from the `TELEMETRY` Analytics Engine dataset, grouping them by ISP.

```sql
SELECT
  blob1 as isp,
  AVG(double1) as avg_download_mbps,
  AVG(double2) as avg_upload_mbps,
  AVG(double3) as avg_latency_ms,
  count() as total_tests
FROM speedreport_telemetry
WHERE timestamp >= NOW() - INTERVAL '7' DAY
GROUP BY isp
ORDER BY total_tests DESC;
```
