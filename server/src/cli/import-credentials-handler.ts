/**
 * Credential import handler for mcp-bridge.
 *
 * The original mcp-bridge used chrome.runtime.sendMessage() which cannot
 * message the service worker from within itself ("Receiving end does not
 * exist"). This provides a direct-call handler using Result types.
 */

import { ok, err, ResultAsync } from 'neverthrow';

// ── Types ────────────────────────────────────────────────────────────

export interface ImportDeps {
  importCLI: () => Promise<unknown>;
  importCodex: () => Promise<unknown>;
  loadConfig: () => Promise<null>;
}

type CredentialSource = 'claude' | 'codex';

// ── Guard ────────────────────────────────────────────────────────────

function isValidSource(source: unknown): source is CredentialSource {
  return source === 'claude' || source === 'codex';
}

// ── Handler ──────────────────────────────────────────────────────────

export function handleImportCredentials(
  source: unknown,
  deps: ImportDeps,
): ResultAsync<unknown, string> {
  if (!isValidSource(source)) {
    return new ResultAsync(Promise.resolve(err(`Unknown credential source: ${source}`)));
  }

  const importFn = source === 'claude' ? deps.importCLI : deps.importCodex;

  return ResultAsync.fromPromise(importFn(), (e) => (e as Error).message)
    .andThen((credentials) =>
      ResultAsync.fromPromise(deps.loadConfig(), (e) => (e as Error).message)
        .map(() => credentials),
    );
}
