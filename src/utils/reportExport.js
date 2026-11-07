/**
 * Public entry point for the PDF report export.
 *
 * `pdfReportGenerator` pulls in pdf-lib (plus its font/encoding tables) and
 * qrcode, which together were ~330 kB of the 897 kB main chunk even though a
 * visitor only needs them if they actually click "Download PDF". Importing this
 * facade instead keeps the generator in its own chunk, loaded on first use.
 *
 * Call sites await `downloadReport(...)` exactly as before; the only difference
 * is that the first click pays a one-off chunk fetch.
 */
export async function downloadReport(report, options = {}) {
  const { downloadReport: generatePdfReport } = await import('./pdfReportGenerator.js');
  return generatePdfReport(report, options);
}

export default downloadReport;
