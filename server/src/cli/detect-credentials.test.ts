import { describe, it, expect } from 'vitest';
import { detectCredentialSources } from './detect-credentials.js';

const make = (overrides = {}) => ({
  platform: 'darwin',
  homedir: '/home/u',
  fileExists: () => false,
  keychainHas: () => false,
  env: {} as Record<string, string>,
  ...overrides,
});

describe('detectCredentialSources (expanded)', () => {
  it('detects ANTHROPIC_API_KEY env var', () => {
    const found = detectCredentialSources(make({ env: { ANTHROPIC_API_KEY: 'sk-...' } }));
    expect(found.some(s => s.slug === 'anthropic-env')).toBe(true);
  });

  it('detects OPENAI_API_KEY env var', () => {
    const found = detectCredentialSources(make({ env: { OPENAI_API_KEY: 'sk-...' } }));
    expect(found.some(s => s.slug === 'openai-env')).toBe(true);
  });

  it('detects HANZI_API_KEY (managed)', () => {
    const found = detectCredentialSources(make({ env: { HANZI_API_KEY: 'hic_live_...' } }));
    expect(found.some(s => s.slug === 'hanzi-managed')).toBe(true);
  });

  it('detects VERTEX_SA_PATH when file exists', () => {
    const found = detectCredentialSources(make({
      env: { VERTEX_SA_PATH: '/tmp/sa.json' },
      fileExists: (p: string) => p === '/tmp/sa.json',
    }));
    expect(found.some(s => s.slug === 'vertex-sa')).toBe(true);
  });

  it('still detects Claude Code and Codex', () => {
    const found = detectCredentialSources(make({
      fileExists: (p: string) => p === '/home/u/.claude/.credentials.json' || p === '/home/u/.codex/auth.json',
    }));
    expect(found.some(s => s.slug === 'claude')).toBe(true);
    expect(found.some(s => s.slug === 'codex')).toBe(true);
  });
});
