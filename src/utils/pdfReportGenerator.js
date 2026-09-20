import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { formatDuration, getReadiness } from './readiness';

export async function downloadReport(report) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const navy = rgb(0.05, 0.08, 0.14);
  const blue = rgb(0.12, 0.45, 0.95);
  const muted = rgb(0.35, 0.4, 0.5);
  const readiness = getReadiness(report.metrics);
  const loadedDelta = Math.max(
    0,
    report.metrics.loadedPing - report.metrics.ping
  );

  page.drawRectangle({
    x: 0,
    y: height - 115,
    width,
    height: 115,
    color: navy
  });

  page.drawText('SPEEDREPORT.ORG', {
    x: 42,
    y: 742,
    size: 12,
    font: bold,
    color: blue
  });

  page.drawText('Network Verification Certificate', {
    x: 42,
    y: 704,
    size: 25,
    font: bold,
    color: rgb(1, 1, 1)
  });

  page.drawText(`Certificate ${report.id}`, {
    x: 42,
    y: 680,
    size: 10,
    font: regular,
    color: rgb(0.7, 0.76, 0.85)
  });

  const line = (label, value, y) => {
    page.drawText(label, {
      x: 42,
      y,
      size: 10,
      font: regular,
      color: muted
    });

    page.drawText(String(value), {
      x: 235,
      y,
      size: 11,
      font: bold,
      color: navy
    });
  };

  page.drawText('CONNECTION DETAILS', {
    x: 42,
    y: 635,
    size: 11,
    font: bold,
    color: blue
  });

  line('Tested', new Date(report.timestamp).toLocaleString(), 610);
  line('Internet provider', report.meta?.isp || 'Unknown', 588);
  line(
    'ASN / Edge node',
    `AS${report.meta?.asn || 0} / ${report.meta?.colo || 'Unknown'}`,
    566
  );
  line('Public IP', report.meta?.ip || 'Unknown', 544);

  page.drawText('MEASURED PERFORMANCE', {
    x: 42,
    y: 500,
    size: 11,
    font: bold,
    color: blue
  });

  line('Download throughput', `${report.metrics.download} Mbps`, 475);
  line('Upload throughput', `${report.metrics.upload} Mbps`, 453);
  line(
    'Idle latency / Jitter',
    `${report.metrics.ping} ms / ${report.metrics.jitter} ms`,
    431
  );
  line(
    'Loaded latency / Jitter',
    `${report.metrics.loadedPing} ms / ${report.metrics.loadedJitter} ms`,
    409
  );
  line('Loaded latency increase', `+${loadedDelta.toFixed(1)} ms`, 387);
  line('Packet loss', `${report.metrics.loss}%`, 365);
  line('Bufferbloat grade', report.metrics.bufferbloat, 343);

  page.drawText('BUSINESS READINESS', {
    x: 42,
    y: 298,
    size: 11,
    font: bold,
    color: blue
  });

  line('Overall assessment', readiness.grade, 273);
  line(
    'Estimated HD voice capacity',
    `${readiness.calls}+ concurrent calls`,
    251
  );
  line(
    'Estimated office capacity',
    `${readiness.employees} active employees`,
    229
  );
  line(
    '1 GB / 10 GB upload',
    `${formatDuration(readiness.uploadSeconds(1))} / ${formatDuration(readiness.uploadSeconds(10))}`,
    207
  );

  page.drawRectangle({
    x: 42,
    y: 92,
    width: width - 84,
    height: 64,
    color: rgb(0.94, 0.96, 0.99)
  });

  page.drawText('Verification note', {
    x: 58,
    y: 130,
    size: 10,
    font: bold,
    color: navy
  });

  page.drawText(
    'Measurements reflect network conditions at the stated time and edge node.',
    {
      x: 58,
      y: 112,
      size: 9,
      font: regular,
      color: muted
    }
  );

  page.drawText(
    'Generated locally in your browser. No report data was uploaded or retained.',
    {
      x: 42,
      y: 54,
      size: 9,
      font: regular,
      color: muted
    }
  );

  const bytes = await pdf.save();
  const url = URL.createObjectURL(
    new Blob([bytes], { type: 'application/pdf' })
  );
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = `SpeedReport-${report.id}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}