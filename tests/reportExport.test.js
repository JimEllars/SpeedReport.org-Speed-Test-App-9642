// @vitest-environment node
// pdf-lib and qrcode are pure JS, so the export path runs without a DOM. Only
// the download step needs browser globals, and that is stubbed below.
//
// This is the contract test for the lazy export facade: `reportExport` loads
// `pdfReportGenerator` with a dynamic import, so a renamed file or a dropped
// export fails at click time in production with nothing but a console error.
// Exercising the real generator end to end is the only way that shows up in CI.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { downloadReport } from '../src/utils/reportExport';
import { generateReportFingerprint } from '../src/utils/pdfReportGenerator';

const report = {
  id: 'SR-4F2A91',
  timestamp: 1762500000000,
  metrics: {
    download: 940.5,
    upload: 480.2,
    ping: 11.4,
    jitter: 1.8,
    loadedPing: 24.6,
    loadedJitter: 4.2,
    loss: 0,
    bufferbloat: 'A'
  },
  meta: {
    isp: 'Comcast Business',
    asn: 7922,
    colo: 'DFW',
    ip: '203.0.113.10'
  }
};

let createdAnchors;

beforeEach(() => {
  createdAnchors = [];
  vi.stubGlobal('document', {
    body: { appendChild: vi.fn() },
    createElement: () => {
      const anchor = { click: vi.fn(), remove: vi.fn(), href: '', download: '' };
      createdAnchors.push(anchor);
      return anchor;
    }
  });
  // The certificate page encodes the report into the share URL, which reads
  // window.location.href.
  vi.stubGlobal('window', {
    location: { href: 'https://speedreport.org/' },
    setTimeout: globalThis.setTimeout.bind(globalThis)
  });
  // Subclass rather than spreading the real URL: `createObjectURL` is a static
  // the generator needs, and the URL constructor itself must keep working for
  // createReportShareUrl.
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:speedreport');
    static revokeObjectURL = vi.fn();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reportExport lazy facade', () => {
  it('generates and downloads a PDF through the lazily imported generator', async () => {
    await expect(downloadReport(report)).resolves.toBeUndefined();

    expect(createdAnchors).toHaveLength(1);
    expect(createdAnchors[0].download).toBe('SpeedReport-SR-4F2A91.pdf');
    expect(createdAnchors[0].click).toHaveBeenCalledTimes(1);
    // The anchor has to leave the document, or every export leaves a stray node.
    expect(createdAnchors[0].remove).toHaveBeenCalledTimes(1);
  });

  it('still produces the SLA dispute dossier variant', async () => {
    const dossier = {
      ...report,
      sla: {
        status: 'BREACH',
        violations: ['Upload below contracted 500 Mbps floor']
      }
    };

    await expect(downloadReport(dossier, { mode: 'SLA_DISPUTE_DOSSIER' })).resolves.toBeUndefined();
    expect(createdAnchors).toHaveLength(1);
  });

  it('keeps the fingerprint deterministic for a given report', async () => {
    const first = await generateReportFingerprint(report);
    const second = await generateReportFingerprint(report);

    expect(first).toMatch(/^SHA256-[0-9A-F]{16}$/);
    expect(first).toBe(second);
  });
});
