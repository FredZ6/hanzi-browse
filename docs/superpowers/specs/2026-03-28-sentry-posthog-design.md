# Sentry + PostHog Integration

**Date:** 2026-03-28
**Status:** Approved

## Overview

Add error tracking (Sentry) and product analytics (PostHog) across three surfaces:
1. Local MCP server (npm users) — anonymous, opt-out
2. Managed backend (api.hanzilla.co) — full context
3. Dashboard SPA (browser) — client-side

## 1. Local MCP Users (npm)

### Telemetry consent

- On first run, print: `Hanzi collects anonymous error reports and usage stats. Run "hanzi-browse telemetry off" to disable.`
- Store preference in `~/.hanzi-browse/config.json` as `{ "telemetry": true }`
- Respect `DO_NOT_TRACK=1` and `HANZI_TELEMETRY=0` env vars
- Add CLI commands: `hanzi-browse telemetry off` / `hanzi-browse telemetry on`
- Generate a random UUID on first run, store in config.json as `anonymousId`

### Sentry (errors)

- Init in `server/src/index.ts` (MCP entry point)
- DSN hardcoded (public DSN is safe — it only allows sending events, not reading)
- Gated behind telemetry flag
- Captures: unhandled exceptions, unhandled promise rejections
- Tags: `version`, `os`, `node_version`, `anonymousId`
- Scrubs: file paths, env vars, API keys (use Sentry's `beforeSend` to strip PII)

### PostHog (usage)

- Init in `server/src/index.ts`
- API key hardcoded (public, write-only)
- Gated behind telemetry flag
- Events:
  - `mcp_start` — on server start (with version, os, node_version)
  - `task_completed` — on successful task (with step count, duration)
  - `task_failed` — on failed task (with error category, NOT error message)
  - `setup_completed` — when `hanzi-browse setup` finishes
- Identify with `anonymousId` from config.json
- Never send: task content, URLs, API keys, file paths, user data

### Implementation

New file: `server/src/telemetry.ts`

```typescript
export function initTelemetry(): void
export function trackEvent(name: string, properties?: Record<string, any>): void
export function captureException(error: Error, context?: Record<string, any>): void
export function shutdownTelemetry(): Promise<void>
export function isTelemetryEnabled(): boolean
```

- Reads config from `~/.hanzi-browse/config.json`
- Checks `DO_NOT_TRACK` and `HANZI_TELEMETRY` env vars
- If disabled, all functions are no-ops
- `shutdownTelemetry()` flushes pending events before process exit

## 2. Managed Backend (api.hanzilla.co)

### Sentry (errors)

- Init in `server/src/managed/deploy.ts` at process start
- DSN via `SENTRY_DSN` env var (different project from local MCP)
- Captures: unhandled exceptions, API 500s, LLM failures, relay errors
- Tags: `workspace_id`, `task_id`, `browser_session_id`, `request_id`
- Performance: transactions on task creation, LLM calls

### PostHog (analytics)

- Init in `server/src/managed/deploy.ts`
- API key via `POSTHOG_API_KEY` env var
- Server-side events:
  - `api_key_created` (workspace_id)
  - `pairing_link_generated` (workspace_id)
  - `browser_paired` (workspace_id)
  - `task_created` (workspace_id, has_url, has_context)
  - `task_completed` (workspace_id, steps, duration, input_tokens, output_tokens)
  - `task_failed` (workspace_id, error_category)
  - `credits_purchased` (workspace_id, amount)
- Identify with workspace_id

### Implementation

New file: `server/src/managed/telemetry.ts`

```typescript
export function initManagedTelemetry(sentryDsn?: string, posthogKey?: string): void
export function trackManagedEvent(name: string, properties?: Record<string, any>): void
export function captureManagedError(error: Error, context?: Record<string, any>): void
```

- No-op when env vars not set (dev stays clean)
- Separate from local telemetry module — different SDKs config, different projects

## 3. Dashboard (Browser)

### Sentry

- Init in `server/dashboard/src/main.jsx`
- DSN hardcoded in dashboard code (public, browser SDK)
- Captures: unhandled JS errors, promise rejections
- Tags: user email (from profile), workspace_id
- Source maps uploaded at build time for readable stack traces

### PostHog

- Init in `server/dashboard/src/main.jsx`
- API key hardcoded (public, write-only)
- Auto-captures: pageviews, clicks (PostHog autocapture)
- Custom events:
  - `dashboard_sign_in`
  - `pairing_link_generated` (client-side complement to server event)
  - `connect_browser_clicked`
  - `test_task_run`
  - `integration_prompt_copied`
- Identify with user email from profile

### Implementation

- Add `@sentry/browser` and `posthog-js` to `server/dashboard/package.json`
- Init both in `main.jsx` before rendering
- PostHog autocapture handles most UI interactions automatically

## Dependencies

| Package | Where | Purpose |
|---------|-------|---------|
| `@sentry/node` | server | Server-side error tracking |
| `@sentry/browser` | dashboard | Browser error tracking |
| `posthog-node` | server | Server-side analytics |
| `posthog-js` | dashboard | Browser analytics |

## CLI Commands

Add to `server/src/cli.ts`:

```
hanzi-browse telemetry on    — Enable anonymous telemetry
hanzi-browse telemetry off   — Disable anonymous telemetry
hanzi-browse telemetry status — Show current telemetry setting
```

## Config File

`~/.hanzi-browse/config.json`:
```json
{
  "telemetry": true,
  "anonymousId": "550e8400-e29b-41d4-a716-446655440000"
}
```

## What never gets sent (local MCP)

- Task descriptions, URLs, page content
- API keys, OAuth tokens, credentials
- File paths from the user's machine
- Any personally identifiable information
- The anonymousId is a random UUID, not linked to any account

## Env vars

| Var | Where | Purpose |
|-----|-------|---------|
| `SENTRY_DSN` | managed backend | Sentry project DSN |
| `POSTHOG_API_KEY` | managed backend | PostHog project key |
| `DO_NOT_TRACK=1` | local MCP | Disable all telemetry (convention) |
| `HANZI_TELEMETRY=0` | local MCP | Disable all telemetry |

Local MCP hardcodes the DSN/API key (public, write-only). Managed backend uses env vars (different Sentry/PostHog projects).

## Rollout

1. Create Sentry projects: `hanzi-mcp` (local) and `hanzi-managed` (backend)
2. Create PostHog project: `hanzi` (single project, distinguish by event properties)
3. Implement `server/src/telemetry.ts` (local)
4. Implement `server/src/managed/telemetry.ts` (managed)
5. Implement dashboard client-side init
6. Add CLI telemetry commands
7. Publish new npm version
8. Deploy managed backend
