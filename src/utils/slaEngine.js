export function evaluateSlaCompliance(metrics, selectedTier, subscribedPlan) {
  let downloadThreshold = 0;
  let uploadThreshold = 0;
  let maxLatency = 0;
  let maxJitter = 0;
  let maxPacketLoss = 0;

  if (selectedTier === 'Tier 1: Dedicated Internet Access (DIA)') {
    downloadThreshold = 0.95;
    uploadThreshold = 0.95;
    maxLatency = 20;
    maxJitter = 3;
    maxPacketLoss = 0;
  } else if (selectedTier === 'Tier 2: Business Broadband (Coax/Fiber)') {
    downloadThreshold = 0.80;
    uploadThreshold = 0.70;
    maxLatency = 45;
    maxJitter = 8;
    maxPacketLoss = 0.5;
  } else if (selectedTier === 'Tier 3: Remote Workforce / Best Effort') {
    downloadThreshold = 0.70;
    uploadThreshold = 0.50;
    maxLatency = 65;
    maxJitter = 15;
    maxPacketLoss = 100; // Not explicitly constrained, but practically 100
  }

  const { download, upload, ping, jitter, packetLoss = 0 } = metrics;
  const planDownload = parseFloat(subscribedPlan.split('/')[0]);
  const planUpload = parseFloat(subscribedPlan.split('/')[1]);

  const downloadPct = download / planDownload;
  const uploadPct = upload / planUpload;

  const violations = [];
  const warnings = [];

  if (downloadPct < downloadThreshold) {
    violations.push(`Download throughput delivery (${(downloadPct*100).toFixed(1)}%) below ${(downloadThreshold*100).toFixed(1)}% contractual minimum`);
  } else if (downloadPct < Math.min(1.0, downloadThreshold + 0.15)) {
    warnings.push(`Download throughput delivery (${(downloadPct*100).toFixed(1)}%) within 15% of breach threshold`);
  }

  if (uploadPct < uploadThreshold) {
    violations.push(`Upload throughput delivery (${(uploadPct*100).toFixed(1)}%) below ${(uploadThreshold*100).toFixed(1)}% contractual minimum`);
  } else if (uploadPct < Math.min(1.0, uploadThreshold + 0.15)) {
    warnings.push(`Upload throughput delivery (${(uploadPct*100).toFixed(1)}%) within 15% of breach threshold`);
  }

  if (ping > maxLatency) {
    violations.push(`Latency (${ping}ms) exceeded ${maxLatency}ms SLA budget`);
  } else if (ping > maxLatency * 0.85) {
    warnings.push(`Latency (${ping}ms) within 15% of breach threshold`);
  }

  if (jitter > maxJitter) {
    violations.push(`Packet jitter (${jitter}ms) exceeded ${maxJitter}ms SLA budget`);
  } else if (jitter > maxJitter * 0.85) {
    warnings.push(`Packet jitter (${jitter}ms) within 15% of breach threshold`);
  }

  if (selectedTier !== 'Tier 3: Remote Workforce / Best Effort' && packetLoss > maxPacketLoss) {
    violations.push(`Packet loss (${packetLoss}%) exceeded ${maxPacketLoss}% SLA budget`);
  } else if (selectedTier !== 'Tier 3: Remote Workforce / Best Effort' && packetLoss > Math.max(0, maxPacketLoss - 0.15)) {
     if (packetLoss > 0) warnings.push(`Packet loss (${packetLoss}%) near breach threshold`);
  }

  let status = 'COMPLIANT';
  if (violations.length > 0) {
    status = 'CONTRACTUAL_BREACH';
  } else if (warnings.length > 0) {
    status = 'AT_RISK';
  }

  return {
    status,
    fulfillment: {
      download: downloadPct,
      upload: uploadPct
    },
    violations: [...violations, ...warnings.map(w => w.replace("within 15%", "At risk: within 15%"))]
  };
}
