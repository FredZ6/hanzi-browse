import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleImportCredentials, type ImportDeps } from '../src/cli/import-credentials-handler.js';

function makeDeps(overrides: Partial<ImportDeps> = {}): ImportDeps {
  return {
    importCLI: vi.fn().mockResolvedValue(null),
    importCodex: vi.fn().mockResolvedValue(null),
    loadConfig: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('handleImportCredentials', () => {
  it('calls importCLI for source "claude"', async () => {
    const creds = { accessToken: 'tok_123' };
    const deps = makeDeps({ importCLI: vi.fn().mockResolvedValue(creds) });

    const result = await handleImportCredentials('claude', deps);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(creds);
    expect(deps.importCLI).toHaveBeenCalledOnce();
    expect(deps.importCodex).not.toHaveBeenCalled();
  });

  it('calls importCodex for source "codex"', async () => {
    const creds = { accessToken: 'codex_tok' };
    const deps = makeDeps({ importCodex: vi.fn().mockResolvedValue(creds) });

    const result = await handleImportCredentials('codex', deps);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(creds);
    expect(deps.importCodex).toHaveBeenCalledOnce();
    expect(deps.importCLI).not.toHaveBeenCalled();
  });

  it('reloads config after successful import', async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      importCLI: vi.fn().mockImplementation(async () => { callOrder.push('import'); return {}; }),
      loadConfig: vi.fn().mockImplementation(async () => { callOrder.push('loadConfig'); return null; }),
    });

    await handleImportCredentials('claude', deps);

    expect(callOrder).toEqual(['import', 'loadConfig']);
  });

  it('returns Err for unknown source', async () => {
    const deps = makeDeps();

    const result = await handleImportCredentials('unknown', deps);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain('Unknown credential source');
    expect(deps.importCLI).not.toHaveBeenCalled();
    expect(deps.importCodex).not.toHaveBeenCalled();
    expect(deps.loadConfig).not.toHaveBeenCalled();
  });

  it('returns Err for undefined source', async () => {
    const result = await handleImportCredentials(undefined, makeDeps());

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain('Unknown credential source');
  });

  it('returns Err when import throws', async () => {
    const deps = makeDeps({ importCLI: vi.fn().mockRejectedValue(new Error('Keychain locked')) });

    const result = await handleImportCredentials('claude', deps);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toBe('Keychain locked');
    expect(deps.loadConfig).not.toHaveBeenCalled();
  });

  it('returns Err when loadConfig throws after import', async () => {
    const deps = makeDeps({
      importCodex: vi.fn().mockResolvedValue({ accessToken: 'tok' }),
      loadConfig: vi.fn().mockRejectedValue(new Error('Storage full')),
    });

    const result = await handleImportCredentials('codex', deps);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toBe('Storage full');
  });
});
