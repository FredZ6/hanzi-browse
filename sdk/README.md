# @hanzi-browse/sdk

TypeScript SDK for [Hanzi Browse](https://browse.hanzilla.co) — give your product a real, signed-in Chrome browser driven by AI. Control it with natural-language tasks from your backend.

## Install

```bash
npm install @hanzi-browse/sdk
```

## Prerequisites

Before any code runs:

1. **[Sign in](https://api.hanzilla.co/api/auth/sign-in/social)** to the developer console and create an API key (`hic_live_...` for server-side, `hic_pub_...` for client-side embed).
2. **Your end-user installs the [Hanzi Browse Chrome extension](https://chromewebstore.google.com/detail/iklpkemlmbhemkiojndpbhoakgikpmcd)**. Pairing fails silently without it. If you're using the embed widget, it prompts the user to install the extension for you.

## Quick start

```ts
import { HanziClient } from '@hanzi-browse/sdk';

const client = new HanziClient({ apiKey: process.env.HANZI_API_KEY! });

// 1. Create a pairing token — hand the URL to your user
const { pairingToken, expiresInSeconds } = await client.createPairingToken({
  label: 'Dr. Smith',
  externalUserId: 'user_123',
});
// Send them to: https://api.hanzilla.co/pair/{pairingToken}
// (expires in 5 minutes — regenerate if they don't click in time)

// 2. Wait for the user to pair, then find their session
const sessions = await client.listSessions();
const browser = sessions.find(s => s.externalUserId === 'user_123' && s.status === 'connected');

// 3. Run a task — `runTask` polls until complete (5-min default timeout)
const result = await client.runTask({
  browserSessionId: browser!.id,
  task: 'Read the patient chart on this page',
  context: 'Extract: name, medications, allergies',
});

console.log(result.answer);
console.log(result.usage); // { inputTokens, outputTokens, apiCalls }
```

## Pairing flow

Your backend creates a short-lived token; the user clicks a link (or your embed widget) and their browser is linked to your workspace.

```ts
// Create the token
const { pairingToken, expiresAt, expiresInSeconds } = await client.createPairingToken({
  label: 'Dr. Smith',      // optional — shown in your dashboard
  externalUserId: 'u_123', // optional — your own ID for the user
});

// Option A: redirect the user
const url = `https://api.hanzilla.co/pair/${pairingToken}`;

// Option B: use the embed widget (client-side, hic_pub_ key required)
// <script src="https://browse.hanzilla.co/embed.js"></script>
// <script>
//   HanziConnect.mount('#target', {
//     apiKey: 'hic_pub_...',
//     pairingToken: '...',
//     onConnected: (sessionId) => { /* your code */ },
//   });
// </script>
```

The token expires in 5 minutes. The resulting `BrowserSession` stays alive for ~30 days and auto-reconnects when the user reopens Chrome.

## Running tasks

### Blocking (recommended)

```ts
const result = await client.runTask({
  browserSessionId: 'sess_abc',
  task: 'Search LinkedIn for "ML engineer", return the top 10 results',
  url: 'https://www.linkedin.com',           // optional starting URL
  context: 'Focus on SF Bay Area',           // optional extra info
  webhookUrl: 'https://yours.com/callback',  // optional; server POSTs when done
});
```

`runTask()` internally calls `createTask()` then polls `getTask()` every 2s until `status !== 'running'`. Transient poll errors (network blips) retry automatically — 3 consecutive failures throw. Timeout defaults to 5 minutes and can be tuned:

```ts
await client.runTask(params, { pollIntervalMs: 5000, timeoutMs: 60_000 });
```

On timeout the SDK calls `cancelTask()` and returns the final state.

### Fire-and-forget (with webhook)

```ts
const task = await client.createTask({
  browserSessionId: 'sess_abc',
  task: 'Post this to LinkedIn',
  webhookUrl: 'https://yours.com/hanzi-done',
});
// → returns immediately with task.id and status: 'running'
// Your webhook endpoint receives POST { id, status, answer, usage, ... }
```

### Manual polling

```ts
const task = await client.createTask(params);
while (true) {
  const current = await client.getTask(task.id);
  if (current.status !== 'running') break;
  await new Promise(r => setTimeout(r, 2000));
}
```

### Debugging a task

```ts
const steps = await client.getTaskSteps(task.id);
// [{ step: 0, toolName: 'browser_navigate', toolInput: {...}, output: '...', ... }]

const shot = await client.getScreenshot(task.id, 3);
// base64 JPEG; prefix with data:image/jpeg;base64, to render
```

## Error handling

The SDK throws `HanziError` on non-2xx responses:

```ts
import { HanziClient, HanziError } from '@hanzi-browse/sdk';

try {
  const result = await client.runTask(params);
} catch (err) {
  if (err instanceof HanziError) {
    console.error('HTTP', err.status, err.data);
    if (err.status === 402) {
      // Out of credits — redirect user to billing
    }
    if (err.status === 404) {
      // Browser session not found / disconnected
    }
  } else {
    // Network error or timeout
  }
}
```

Common status codes: `400` bad params, `401` bad key, `402` billing, `404` not found, `429` rate limited, `500` server.

## API reference

### `new HanziClient(options)`

| Option | Type | Required | Default |
|--------|------|----------|---------|
| `apiKey` | `string` | yes | — |
| `baseUrl` | `string` | no | `https://api.hanzilla.co` |

### Pairing

| Method | Returns | Notes |
|--------|---------|-------|
| `createPairingToken({ label?, externalUserId? })` | `{ pairingToken, expiresAt, expiresInSeconds }` | Token expires in 5 min. |
| `listSessions()` | `BrowserSession[]` | Every session in your workspace. |
| `deleteSession(sessionId)` | `void` | Unpair a browser. |

### Tasks

| Method | Returns | Notes |
|--------|---------|-------|
| `runTask(params, options?)` | `TaskRun` | Blocks until `status !== 'running'`. Auto-retries transient poll errors. |
| `createTask(params)` | `TaskRun` | Starts a task, returns immediately with `status: 'running'`. |
| `getTask(taskId)` | `TaskRun` | Current state. |
| `cancelTask(taskId)` | `void` | Stop a running task. |
| `listTasks()` | `TaskRun[]` | All tasks in your workspace. |
| `getTaskSteps(taskId)` | `TaskStep[]` | Per-step tool calls, inputs, outputs. |
| `getScreenshot(taskId, step)` | `string` | Base64 JPEG for a step. |

**`TaskCreateParams`:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `browserSessionId` | `string` | yes | From `listSessions()`. |
| `task` | `string` | yes | Natural-language instructions. |
| `url` | `string` | no | Starting page. |
| `context` | `string` | no | Extra context (preferences, form data). |
| `webhookUrl` | `string` | no | Server POSTs the final `TaskRun` here on completion. |

### API keys

| Method | Returns | Notes |
|--------|---------|-------|
| `createApiKey(name, type?)` | `{ id, key, name, type }` | `type`: `'secret'` (default, server) or `'publishable'` (embed). Key shown once — store it. |
| `listApiKeys()` | `{ id, keyPrefix, name, createdAt }[]` | Keys shown as prefixes only. |
| `deleteApiKey(keyId)` | `void` | Revokes the key. |

### Usage + billing

| Method | Returns | Notes |
|--------|---------|-------|
| `getUsage()` | `UsageSummary` | Tokens, cost, task count. |
| `getCredits()` | `CreditBalance` | `{ freeRemaining, creditBalance, freeTasksPerMonth }` |
| `health()` | `{ status, relayConnected }` | No auth required. |

## Billing

20 completed tasks/month free, then $0.05 each. Errors and timeouts are free. Check `getCredits()` to see remaining free tasks and purchased balance.

## Support

- **Docs:** [browse.hanzilla.co/docs.html](https://browse.hanzilla.co/docs.html)
- **Sample integration:** [examples/partner-quickstart](https://github.com/hanzili/hanzi-browse/tree/main/examples/partner-quickstart)
- **Discord:** [discord.gg/hahgu5hcA5](https://discord.gg/hahgu5hcA5)
- **Issues:** [github.com/hanzili/hanzi-browse/issues](https://github.com/hanzili/hanzi-browse/issues)

## License

PolyForm Noncommercial 1.0.0. Contact [hanzili0217@gmail.com](mailto:hanzili0217@gmail.com) for commercial terms.
