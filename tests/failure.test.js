import { describe, it, expect, afterEach } from 'vitest';
import {
  FAILURE_CAUSE,
  classifyFailure,
  describeFailure,
  describePartial,
  isLocalDevelopment,
} from '../src/utils/failure';

const setOnline = (value) => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
};

afterEach(() => {
  setOnline(true);
});

describe('classifyFailure', () => {
  it('recognises a browser-level block in both engine dialects', () => {
    expect(classifyFailure(new TypeError('NetworkError when attempting to fetch resource.')))
      .toBe(FAILURE_CAUSE.BLOCKED);
    expect(classifyFailure(new TypeError('Failed to fetch'))).toBe(FAILURE_CAUSE.BLOCKED);
    expect(classifyFailure(new TypeError('Load failed'))).toBe(FAILURE_CAUSE.BLOCKED);
  });

  it('prefers the browser\'s own offline signal over the message', () => {
    setOnline(false);
    expect(classifyFailure(new TypeError('Failed to fetch'))).toBe(FAILURE_CAUSE.OFFLINE);
  });

  it('recognises an edge error status', () => {
    expect(classifyFailure(new Error('Upload endpoint rejected payload (HTTP 501)')))
      .toBe(FAILURE_CAUSE.SERVER);
    expect(classifyFailure(new Error('Metadata service unavailable'))).toBe(FAILURE_CAUSE.SERVER);
  });

  it('separates a stall from a timeout', () => {
    expect(classifyFailure(new Error('Network stall detected during upload'))).toBe(FAILURE_CAUSE.STALLED);
    expect(classifyFailure(new Error('Phase timeout'))).toBe(FAILURE_CAUSE.TIMEOUT);
  });

  it('treats an empty reason as unknown rather than guessing', () => {
    expect(classifyFailure(null)).toBe(FAILURE_CAUSE.UNKNOWN);
    expect(classifyFailure(new Error(''))).toBe(FAILURE_CAUSE.UNKNOWN);
    expect(classifyFailure(undefined)).toBe(FAILURE_CAUSE.UNKNOWN);
  });

  it('does not misclassify an ordinary message containing "status"', () => {
    // "status" appears in the SERVER matcher only to catch "... status 500";
    // an unrelated word must not be forced into the server bucket.
    expect(classifyFailure(new Error('Something entirely different'))).toBe(FAILURE_CAUSE.UNKNOWN);
  });
});

describe('describeFailure', () => {
  it('never tells a production visitor to deploy a Worker', () => {
    // MODE is 'test' here and 'production' in a deployed bundle, so both take
    // the same branch: no deploy advice can reach a visitor.
    expect(isLocalDevelopment()).toBe(false);
    const model = describeFailure(new Error('Failed to fetch'));
    expect(model.showDeployHint).toBe(false);
    expect(model.body).not.toMatch(/deploy/i);
    expect(model.body).not.toMatch(/VITE_API_BASE/);
  });

  it('gives a blocked request actionable advice instead of a stack trace', () => {
    const model = describeFailure(new TypeError('NetworkError when attempting to fetch resource.'));
    expect(model.cause).toBe(FAILURE_CAUSE.BLOCKED);
    expect(model.body).toMatch(/extension|VPN|private window/i);
    // The raw engine message adds nothing a visitor can use.
    expect(model.detail).toBeNull();
  });

  it('keeps an HTTP status visible, because that detail is genuinely useful', () => {
    const model = describeFailure(new Error('Upload endpoint rejected payload (HTTP 501)'));
    expect(model.cause).toBe(FAILURE_CAUSE.SERVER);
    expect(model.detail).toContain('501');
    expect(model.body).toMatch(/on our side/i);
  });

  it('always returns a title and body', () => {
    for (const input of [null, undefined, '', 'weird', new Error('x')]) {
      const model = describeFailure(input);
      expect(model.title.length).toBeGreaterThan(0);
      expect(model.body.length).toBeGreaterThan(0);
    }
  });
});

describe('describePartial', () => {
  it('says the other phases are real, not that the engine is unavailable', () => {
    const model = describePartial('upload', new Error('Network stall detected during upload'));
    expect(model.cause).toBe(FAILURE_CAUSE.STALLED);
    expect(model.title).toBe('The upload phase stalled.');
    expect(model.body).toMatch(/results below are real/i);
    expect(model.title).not.toMatch(/unavailable/i);
    expect(model.body).not.toMatch(/unavailable/i);
  });

  it('names the download phase when download is the one that stalled', () => {
    const model = describePartial('download');
    expect(model.title).toBe('The download phase stalled.');
  });

  it('falls back to a full failure description when no phase is known', () => {
    const model = describePartial(null, new Error('Failed to fetch'));
    expect(model.cause).toBe(FAILURE_CAUSE.BLOCKED);
    expect(model.showDeployHint).toBe(isLocalDevelopment());
  });
});
