const REPORT_PREFIX = 'report=';
const MAX_REPORT_LENGTH = 12000;

function bytesToBase64(bytes) {
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64ToBytes(value) {
  const normalized = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');

  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isValidReport(report) {
  return Boolean(
    report &&
    typeof report === 'object' &&
    typeof report.id === 'string' &&
    typeof report.timestamp === 'string' &&
    report.metrics &&
    typeof report.metrics.download === 'number' &&
    typeof report.metrics.upload === 'number' &&
    typeof report.metrics.ping === 'number'
  );
}

export function createReportShareUrl(report) {
  const json = JSON.stringify(report);
  const encoded = bytesToBase64(new TextEncoder().encode(json));
  const url = new URL(window.location.href);

  url.hash = `${REPORT_PREFIX}${encoded}`;
  return url.toString();
}

export function readReportFromUrl() {
  const hash = window.location.hash;

  if (!hash.startsWith(`#${REPORT_PREFIX}`)) {
    return null;
  }

  const encoded = hash.slice(REPORT_PREFIX.length + 1);

  if (!encoded || encoded.length > MAX_REPORT_LENGTH) {
    return null;
  }

  try {
    const report = JSON.parse(
      new TextDecoder().decode(base64ToBytes(encoded))
    );

    return isValidReport(report) ? report : null;
  } catch {
    return null;
  }
}

export function clearReportFromUrl() {
  const url = new URL(window.location.href);
  url.hash = '';
  window.history.replaceState({}, '', url);
}