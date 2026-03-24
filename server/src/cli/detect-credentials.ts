/**
 * Credential source detection for CLI setup.
 *
 * Claude Code stores OAuth tokens in one of two locations:
 *   1. ~/.claude/.credentials.json (file-based, all platforms)
 *   2. macOS Keychain under "Claude Code-credentials" (macOS only)
 *
 * The original implementation only checked (1), missing most macOS users.
 */

import { join } from 'path';
import { ok, err, Result } from 'neverthrow';

// ── Types ────────────────────────────────────────────────────────────

export interface CredentialSource {
  name: string;
  slug: 'claude' | 'codex';
  path: string;
}

export interface DetectOptions {
  platform: string;
  homedir: string;
  fileExists: (path: string) => boolean;
  keychainHas: (service: string) => boolean;
}

export interface CredentialFlowState {
  sourcesDetected: number;
  anyImported: boolean;
  manualEntryChosen: boolean;
}

// ── Constants ────────────────────────────────────────────────────────

const KEYCHAIN_SERVICE = 'Claude Code-credentials';

// ── Detection ────────────────────────────────────────────────────────

export function detectCredentialSources(opts: DetectOptions): CredentialSource[] {
  const { platform, homedir, fileExists, keychainHas } = opts;
  const found: CredentialSource[] = [];

  const claudePath = join(homedir, '.claude', '.credentials.json');
  if (fileExists(claudePath)) {
    found.push({ name: 'Claude Code', slug: 'claude', path: claudePath });
  } else if (platform === 'darwin' && keychainHas(KEYCHAIN_SERVICE)) {
    found.push({ name: 'Claude Code', slug: 'claude', path: 'macOS Keychain' });
  }

  const codexPath = join(homedir, '.codex', 'auth.json');
  if (fileExists(codexPath)) {
    found.push({ name: 'Codex CLI', slug: 'codex', path: codexPath });
  }

  return found;
}

// ── Flow state check ─────────────────────────────────────────────────

export function checkCredentialFlowResult(
  state: CredentialFlowState,
): Result<null, string> {
  if (state.sourcesDetected === 0) return ok(null);
  if (state.anyImported) return ok(null);
  if (state.manualEntryChosen) return ok(null);

  return err(
    'No credentials configured. The extension needs a model source to run tasks.\n'
    + 'Add one later in the Chrome extension sidepanel → Settings.',
  );
}
