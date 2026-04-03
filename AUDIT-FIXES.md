# API / SDK / Docs Audit Fixes

## Pass 1 — Security

- [x] Remove `debug` block from `/v1/me` 401 response
- [x] Sanitize `err.message` in 500 handler — return generic message, log real error server-side
- [x] Add `tools.hanzilla.co` to CORS `ALLOWED_ORIGINS`

## Pass 2 — SDK fixes

- [x] Catch JSON parse errors in `request()` — wrap `res.json()` in try/catch, throw `HanziError`
- [x] Make `createApiKey(name)` required, not optional
- [x] Add `type` parameter to `createApiKey(name, type?)` for publishable key creation
- [x] Add retry logic to `runTask()` polling — retry on transient errors (3 consecutive = give up)
- [x] Validate publishable key prefix in embed.js — warn if secret key passed
- [x] Fix embed.js doc comment to show `hic_pub_` instead of `hic_live_`

## Pass 3 — Docs

- [x] Fix screenshot format: change "PNG" to "JPEG" in docs.html endpoint description
- [x] Add SDK documentation section to docs.html (install, usage, methods, sidebar link)
- [x] Fix landing page code examples — remove fake `bsn_` prefix, show pairing→session flow
- [x] Fix npm README — remove `mcp-server` ref, fix old env var name, add API/SDK quick start
- [x] Document `DELETE /v1/browser-sessions/:id` in docs.html
