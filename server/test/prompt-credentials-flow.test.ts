import { describe, it, expect } from 'vitest';
import { checkCredentialFlowResult } from '../src/cli/detect-credentials.js';

describe('checkCredentialFlowResult', () => {
  it('returns Err when sources exist but none were imported', () => {
    const result = checkCredentialFlowResult({
      sourcesDetected: 2,
      anyImported: false,
      manualEntryChosen: false,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain('No credentials configured');
  });

  it('returns Ok when a source was imported', () => {
    const result = checkCredentialFlowResult({
      sourcesDetected: 2,
      anyImported: true,
      manualEntryChosen: false,
    });

    expect(result.isOk()).toBe(true);
  });

  it('returns Ok when user chose manual entry', () => {
    const result = checkCredentialFlowResult({
      sourcesDetected: 1,
      anyImported: false,
      manualEntryChosen: true,
    });

    expect(result.isOk()).toBe(true);
  });

  it('returns Ok when no sources were detected (manual entry forced)', () => {
    const result = checkCredentialFlowResult({
      sourcesDetected: 0,
      anyImported: false,
      manualEntryChosen: false,
    });

    expect(result.isOk()).toBe(true);
  });

  it('returns Ok when both imported and manual entry', () => {
    const result = checkCredentialFlowResult({
      sourcesDetected: 1,
      anyImported: true,
      manualEntryChosen: true,
    });

    expect(result.isOk()).toBe(true);
  });
});
