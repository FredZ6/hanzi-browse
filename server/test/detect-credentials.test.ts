import { describe, it, expect } from 'vitest';
import { detectCredentialSources } from '../src/cli/detect-credentials.js';

describe('detectCredentialSources', () => {
  describe('Claude Code credentials', () => {
    it('detects credentials file when it exists', () => {
      const sources = detectCredentialSources({
        platform: 'darwin',
        homedir: '/Users/test',
        fileExists: (p) => p === '/Users/test/.claude/.credentials.json',
        keychainHas: () => false,
      });

      const claude = sources.find(s => s.slug === 'claude');
      expect(claude).toEqual({
        name: 'Claude Code',
        slug: 'claude',
        path: '/Users/test/.claude/.credentials.json',
      });
    });

    it('detects macOS Keychain when credentials file is absent', () => {
      const sources = detectCredentialSources({
        platform: 'darwin',
        homedir: '/Users/test',
        fileExists: () => false,
        keychainHas: (s) => s === 'Claude Code-credentials',
      });

      expect(sources.find(s => s.slug === 'claude')).toEqual({
        name: 'Claude Code',
        slug: 'claude',
        path: 'macOS Keychain',
      });
    });

    it('prefers credentials file over Keychain when both exist', () => {
      const sources = detectCredentialSources({
        platform: 'darwin',
        homedir: '/Users/test',
        fileExists: (p) => p === '/Users/test/.claude/.credentials.json',
        keychainHas: () => true,
      });

      expect(sources.find(s => s.slug === 'claude')!.path)
        .toBe('/Users/test/.claude/.credentials.json');
    });

    it('skips Keychain check on Linux', () => {
      let keychainChecked = false;
      const sources = detectCredentialSources({
        platform: 'linux',
        homedir: '/home/test',
        fileExists: () => false,
        keychainHas: () => { keychainChecked = true; return true; },
      });

      expect(sources.find(s => s.slug === 'claude')).toBeUndefined();
      expect(keychainChecked).toBe(false);
    });

    it('returns nothing when no credentials exist anywhere', () => {
      const sources = detectCredentialSources({
        platform: 'darwin',
        homedir: '/Users/test',
        fileExists: () => false,
        keychainHas: () => false,
      });

      expect(sources.find(s => s.slug === 'claude')).toBeUndefined();
    });
  });

  describe('Codex CLI credentials', () => {
    it('detects auth.json when it exists', () => {
      const sources = detectCredentialSources({
        platform: 'darwin',
        homedir: '/Users/test',
        fileExists: (p) => p === '/Users/test/.codex/auth.json',
        keychainHas: () => false,
      });

      expect(sources.find(s => s.slug === 'codex')).toEqual({
        name: 'Codex CLI',
        slug: 'codex',
        path: '/Users/test/.codex/auth.json',
      });
    });

    it('returns nothing when auth.json is absent', () => {
      const sources = detectCredentialSources({
        platform: 'darwin',
        homedir: '/Users/test',
        fileExists: () => false,
        keychainHas: () => false,
      });

      expect(sources.find(s => s.slug === 'codex')).toBeUndefined();
    });
  });

  describe('combined detection', () => {
    it('detects both Claude (Keychain) and Codex together', () => {
      const sources = detectCredentialSources({
        platform: 'darwin',
        homedir: '/Users/test',
        fileExists: (p) => p === '/Users/test/.codex/auth.json',
        keychainHas: (s) => s === 'Claude Code-credentials',
      });

      expect(sources).toHaveLength(2);
      expect(sources[0]).toMatchObject({ slug: 'claude', path: 'macOS Keychain' });
      expect(sources[1]).toMatchObject({ slug: 'codex' });
    });

    it('returns empty array when nothing is found', () => {
      const sources = detectCredentialSources({
        platform: 'linux',
        homedir: '/home/test',
        fileExists: () => false,
        keychainHas: () => false,
      });

      expect(sources).toEqual([]);
    });
  });
});
