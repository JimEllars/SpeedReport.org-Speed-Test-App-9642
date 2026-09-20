function createDownloadUrl(content, type) {
  return URL.createObjectURL(new Blob([content], { type }));
}

export function downloadJsonReport(report) {
  const content = JSON.stringify(report, null, 2);
  const url = createDownloadUrl(content, 'application/json');
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = `SpeedReport-${report.id}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function addText(documentRef, parent, tag, text, className = '') {
  const element = documentRef.createElement(tag);
  element.textContent = text;

  if (className) {
    element.className = className;
  }

  parent.appendChild(element);
}

export function printReport(report) {
  const printWindow = window.open('', '_blank', 'width=900,height=900');

  if (!printWindow) {
    throw new Error('Print window was blocked');
  }

  const documentRef = printWindow.document;
  const style = documentRef.createElement('style');

  style.textContent = `
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 42px;
      color: #172033;
      font-family: Arial, sans-serif;
      line-height: 1.45;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 30px;
      padding-bottom: 24px;
      border-bottom: 3px solid #2563eb;
    }
    h1 { margin: 0 0 5px; font-size: 28px; }
    h2 {
      margin: 30px 0 12px;
      color: #2563eb;
      font-size: 13px;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .muted { color: #64748b; font-size: 12px; }
    .certificate {
      color: #2563eb;
      font-family: monospace;
      font-weight: 700;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px 34px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 0;
      border-bottom: 1px solid #e2e8f0;
      font-size: 13px;
    }
    .row strong { text-align: right; }
    footer {
      margin-top: 42px;
      padding-top: 14px;
      border-top: 1px solid #cbd5e1;
      color: #64748b;
      font-size: 11px;
    }
    @media print {
      body { padding: 0; }
    }
  `;

  documentRef.head.appendChild(style);

  const body = documentRef.body;
  const header = documentRef.createElement('header');
  const titleBlock = documentRef.createElement('div');

  addText(documentRef, titleBlock, 'h1', 'SpeedReport.org');
  addText(documentRef, titleBlock, 'div', 'Network Verification Report', 'muted');
  header.appendChild(titleBlock);

  const certificate = documentRef.createElement('div');
  addText(documentRef, certificate, 'div', report.id, 'certificate');
  addText(
    documentRef,
    certificate,
    'div',
    new Date(report.timestamp).toLocaleString(),
    'muted'
  );
  header.appendChild(certificate);
  body.appendChild(header);

  const sections = [
    {
      title: 'Connection details',
      rows: [
        ['Provider', report.meta?.isp || 'Unknown'],
        ['Public IP', report.meta?.ip || 'Unknown'],
        ['Network', `AS${report.meta?.asn || 0}`],
        [
          'Edge node',
          `${report.meta?.city || 'Unknown'}, ${report.meta?.country || ''} · ${report.meta?.colo || 'Unknown'}`
        ]
      ]
    },
    {
      title: 'Measured performance',
      rows: [
        ['Download', `${report.metrics.download} Mbps`],
        ['Upload', `${report.metrics.upload} Mbps`],
        ['Idle latency', `${report.metrics.ping} ms`],
        ['Jitter', `${report.metrics.jitter} ms`],
        ['Loaded latency', `${report.metrics.loadedPing} ms`],
        ['Loaded jitter', `${report.metrics.loadedJitter} ms`],
        ['Packet loss', `${report.metrics.loss}%`],
        ['Bufferbloat', report.metrics.bufferbloat]
      ]
    }
  ];

  sections.forEach((section) => {
    addText(documentRef, body, 'h2', section.title);
    const grid = documentRef.createElement('div');
    grid.className = 'grid';

    section.rows.forEach(([label, value]) => {
      const row = documentRef.createElement('div');
      row.className = 'row';
      addText(documentRef, row, 'span', label);
      addText(documentRef, row, 'strong', value);
      grid.appendChild(row);
    });

    body.appendChild(grid);
  });

  addText(
    documentRef,
    body,
    'footer',
    'Measurements reflect network conditions at the stated time and edge node. Generated locally in your browser.'
  );

  printWindow.focus();
  printWindow.print();
  printWindow.close();
}