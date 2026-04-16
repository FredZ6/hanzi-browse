/**
 * Credential source detection for CLI setup + doctor.
 *
 * Covers env vars (static API keys), file-based OAuth (Claude Code, Codex),
 * Keychain (Claude Code on macOS), and service account files (Vertex AI).
 *
 * Priority ordering (first = most preferred): managed > static env > OAuth file > Keychain > Codex.
 */

import { join } from 'path';

export type CredentialSlug =
  | 'claude' | 'codex'
  | 'anthropic-env' | 'openai-env' | 'google-env' | 'openrouter-env'
  | 'vertex-sa' | 'hanzi-managed';

export interface CredentialSource {
  name: string;
  slug: CredentialSlug;
  path: string;
}

export interface DetectOptions {
  platform: string;
  homedir: string;
  fileExists: (path: string) => boolean;
  keychainHas: (service: string) => boolean;
  env?: Record<string, string | undefined>;
}

export interface CredentialFlowState {
  sourcesDetected: number;
  anyImported: boolean;
  manualEntryChosen: boolean;
}

const KEYCHAIN_SERVICE = 'Claude Code-credentials';

export function detectCredentialSources(opts: DetectOptions): CredentialSource[] {
  const { platform, homedir, fileExists, keychainHas, env = process.env } = opts;
  const found: CredentialSource[] = [];

  // Managed takes precedence — zero fragility, server-side LLM
  if (env.HANZI_API_KEY) {
    found.push({ name: 'Hanzi Managed', slug: 'hanzi-managed', path: 'HANZI_API_KEY env var' });
  }

  // Static API keys
  if (env.ANTHROPIC_API_KEY) {
    found.push({ name: 'Anthropic API key', slug: 'anthropic-env', path: 'ANTHROPIC_API_KEY env var' });
  }
  if (env.OPENAI_API_KEY) {
    found.push({ name: 'OpenAI API key', slug: 'openai-env', path: 'OPENAI_API_KEY env var' });
  }
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) {
    found.push({ name: 'Google API key', slug: 'google-env', path: 'GEMINI_API_KEY or GOOGLE_API_KEY env var' });
  }
  if (env.OPENROUTER_API_KEY) {
    found.push({ name: 'OpenRouter API key', slug: 'openrouter-env', path: 'OPENROUTER_API_KEY env var' });
  }

  // Vertex service account
  if (env.VERTEX_SA_PATH && fileExists(env.VERTEX_SA_PATH)) {
    found.push({ name: 'Vertex AI service account', slug: 'vertex-sa', path: env.VERTEX_SA_PATH });
  }

  // Claude Code (file, then Keychain on macOS)
  const claudePath = join(homedir, '.claude', '.credentials.json');
  if (fileExists(claudePath)) {
    found.push({ name: 'Claude Code', slug: 'claude', path: claudePath });
  } else if (platform === 'darwin' && keychainHas(KEYCHAIN_SERVICE)) {
    found.push({ name: 'Claude Code', slug: 'claude', path: 'macOS Keychain' });
  }

  // Codex
  const codexPath = join(homedir, '.codex', 'auth.json');
  if (fileExists(codexPath)) {
    found.push({ name: 'Codex CLI', slug: 'codex', path: codexPath });
  }

  return found;
}

// ── Flow state check ─────────────────────────────────────────────────

/**
 * Returns an error message if setup finished with no credentials configured,
 * or null if everything is fine.
 */
export function checkCredentialFlowResult(
  state: CredentialFlowState,
): string | null {
  if (state.sourcesDetected === 0) return null;
  if (state.anyImported) return null;
  if (state.manualEntryChosen) return null;

  return 'No credentials configured. The extension needs a model source to run tasks.\n'
    + 'Add one later in the Chrome extension sidepanel → Settings.';
}
