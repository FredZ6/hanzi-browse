# X Marketing Automation

Find relevant X/Twitter conversations and draft replies — powered by Hanzi Browse.

## Architecture

Two-agent design. The browser agent and the strategy AI have different jobs:

```
Browser Agent (Gemini Flash via Hanzi)     Strategy AI (Claude via ccproxy)
  │                                          │
  │ "Search X for these keywords"            │ "Here's what the browser saw.
  │  Just browse. Click, scroll, read.       │  Extract tweets. Draft replies."
  │  Don't output anything structured.       │  Smart analysis + structured output.
  │                                          │
  ▼                                          ▼
  Browsing log (task_steps)  ──────────→   Tweets + draft replies
```

The browser agent never outputs JSON — it just browses. All `read_page` results are logged in `task_steps`. After browsing, we fetch the steps and pipe them to the strategy AI for extraction and analysis.

This pattern works because:
- Flash is good at browser interaction, bad at structured output
- Claude is good at analysis and structured output, doesn't need a browser
- The browsing log (`GET /v1/tasks/:id/steps`) contains everything the browser saw

## Setup

```bash
cd examples/x-marketing
npm install
```

Required env vars:
```bash
HANZI_API_KEY=hic_live_...          # Browser automation (from dashboard)
ANTHROPIC_API_KEY=sk-ant-... or ccproxy  # Strategy AI
LLM_BASE_URL=http://127.0.0.1:8003/claude  # If using ccproxy
```

```bash
npm start
# Open http://localhost:3001
```

## Flow

1. **Describe your product** — name, URL (optional), description
2. **AI generates strategy** — keywords, audience, voice (Strategy AI)
3. **If URL provided** — browser reads your website for deeper analysis (Browser Agent)
4. **Review strategy** — edit keywords if needed
5. **Search X** — browser searches, scrolls, reads pages (Browser Agent)
6. **Extract + draft** — strategy AI reads browsing log, extracts tweets, drafts replies (Strategy AI)
7. **Review drafts** — approve, edit, or skip each reply
8. **Post** — browser posts approved replies one by one (Browser Agent)

## Key endpoints

| Method | Path | What it does | Agent |
|--------|------|-------------|-------|
| POST | /api/analyze | Generate marketing strategy | Strategy AI |
| POST | /api/read-url | Read a website via browser | Browser |
| POST | /api/search | Search X + extract tweets from browsing log | Browser → Strategy AI |
| POST | /api/draft | Score tweets + draft replies | Strategy AI |
| POST | /api/drafts/:id/post | Post one approved reply | Browser |

## Data

Product strategy and drafts are persisted in localStorage (browser) and in-memory on the server. Restart the server to reset server state. Clear localStorage to reset client state.
