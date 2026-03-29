/**
 * X Marketing — Hanzi Browse Example
 *
 * Two-layer architecture:
 *   1. Strategy AI (LLM) — analyzes product, scores tweets, drafts replies
 *   2. Browser tool (Hanzi) — searches X, posts replies
 *
 * Setup:
 *   HANZI_API_KEY=hic_live_...  (browser automation)
 *   ANTHROPIC_API_KEY=sk-...    (strategy AI — or set LLM_BASE_URL for proxy)
 *   npm start
 */

import express from "express";

// Disable proxy for all outbound fetch — we reach api.hanzilla.co directly
delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;

const app = express();
app.use(express.json());

const HANZI_KEY = process.env.HANZI_API_KEY;
const HANZI_URL = process.env.HANZI_API_URL || "https://api.hanzilla.co";
const LLM_KEY = process.env.ANTHROPIC_API_KEY || "ccproxy";
const LLM_URL = process.env.LLM_BASE_URL || "https://api.anthropic.com";
const LLM_MODEL = process.env.LLM_MODEL || "claude-sonnet-4-6";
const PORT = process.env.PORT || 3001;

if (!HANZI_KEY) { console.error("Set HANZI_API_KEY"); process.exit(1); }

// In-memory store
let productContext = null;
const drafts = [];
const posted = [];

// ── Hanzi API (browser tool) ─────────────────────────────────

async function hanzi(method, path, body) {
  const res = await fetch(`${HANZI_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${HANZI_KEY}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function pollTask(taskId, timeoutMs = 5 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const s = await hanzi("GET", `/v1/tasks/${taskId}`);
    if (s.status !== "running") return s;
  }
  return { id: taskId, status: "timeout" };
}

// ── Strategy AI (LLM calls) ──────────────────────────────────

async function llm(system, user) {
  const res = await fetch(`${LLM_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": LLM_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data));
  return data.content?.[0]?.text || "";
}

function extractJSON(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  if (fenced) try { return JSON.parse(fenced[1]); } catch {}
  const raw = text.match(/\{[\s\S]*\}/);
  if (raw) try { return JSON.parse(raw[0]); } catch {}
  return null;
}

// ── Routes ───────────────────────────────────────────────────

// Sessions
app.get("/api/sessions", async (req, res) => {
  try { res.json(await hanzi("GET", "/v1/browser-sessions")); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/pair", async (req, res) => {
  try {
    const data = await hanzi("POST", "/v1/browser-sessions/pair", { label: "X Marketing" });
    res.json({ pairing_url: `${HANZI_URL}/pair/${data.pairing_token}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reset everything
app.post("/api/reset", (req, res) => {
  productContext = null;
  drafts.length = 0;
  posted.length = 0;
  res.json({ ok: true });
});

// Read a URL using Hanzi browser → returns page content
app.post("/api/read-url", async (req, res) => {
  try {
    const { browser_session_id, url } = req.body;
    if (!browser_session_id || !url) return res.status(400).json({ error: "browser_session_id and url required" });

    console.log(`[Browser] Reading ${url}...`);
    const task = await hanzi("POST", "/v1/tasks", {
      browser_session_id,
      task: `Open a new tab and go to ${url}

Read the page and extract:
- The main headline/tagline
- What the product does (features, benefits)
- Who it's for (target audience)
- Pricing if visible
- Any social proof (customer logos, testimonials, numbers)
- Key differentiators

Return a structured summary. Be thorough — read the full page, scroll down.`,
    });

    const result = await pollTask(task.id, 3 * 60 * 1000);
    if (result.status !== "complete") {
      return res.status(500).json({ error: `Failed to read URL: ${result.status}` });
    }

    console.log(`[Browser] Page read complete`);
    res.json({ content: result.answer });
  } catch (err) {
    console.error("[Browser] Read URL error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Step 1: Analyze product → Strategy AI generates keywords, audience, voice
app.post("/api/analyze", async (req, res) => {
  try {
    const { name, url, description, page_content } = req.body;
    console.log(`[Strategy] Analyzing product: ${name}${page_content ? ' (with page content)' : ''}`);

    const contextBlock = page_content
      ? `\n\nHere is the actual content from their website:\n<page_content>\n${page_content}\n</page_content>`
      : '';

    const result = await llm(
      `You are an expert X/Twitter marketing strategist. Analyze a product and create a marketing strategy for finding and engaging with relevant conversations on X.`,
      `Analyze this product and create an X marketing strategy:

Product: ${name}
URL: ${url || "N/A"}
Description: ${description || "N/A"}${contextBlock}

Return a JSON object with:
- "keywords": array of 5-8 search keywords/phrases to find relevant tweets (mix of direct terms, pain points, and adjacent topics)
- "audience": one-sentence description of who we're targeting
- "voice": object with "tone" (casual/professional/technical), "style" (short description of how replies should sound), "never_use" (array of words/phrases to avoid)
- "product_pitch": one-sentence description to use when mentioning the product
- "pain_points": array of 3-5 specific problems the product solves

${page_content ? 'Use the actual page content to deeply understand the product. Be specific — reference real features and benefits from the page.' : ''}

Return ONLY the JSON, no other text.

\`\`\`json
{...}
\`\`\``
    );

    const strategy = extractJSON(result);
    if (!strategy) throw new Error("Failed to parse strategy");

    productContext = { name, url, description, ...strategy };
    console.log(`[Strategy] Generated ${strategy.keywords?.length || 0} keywords`);
    res.json(productContext);
  } catch (err) {
    console.error("[Strategy] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/product", (req, res) => {
  res.json(productContext || null);
});

// Step 2: Search X → Browser tool collects raw tweets
app.post("/api/search", async (req, res) => {
  try {
    const { browser_session_id, keywords } = req.body;
    if (!keywords?.length) return res.status(400).json({ error: "keywords required" });

    // One task per keyword, run in parallel. Each task is simple (~10 steps).
    const topKeywords = keywords.slice(0, 3);
    console.log(`[Browser] Searching X for ${topKeywords.length} keywords in parallel: ${topKeywords.join(", ")}`);

    // Launch all search tasks in parallel
    const taskPromises = topKeywords.map(async (keyword) => {
      try {
        const task = await hanzi("POST", "/v1/tasks", {
          browser_session_id,
          task: `Open a new tab. Go to https://x.com/search?q=${encodeURIComponent(keyword)}&src=typed_query&f=live

Wait for results to load. Read the page. Scroll down once. Read the page again.

Then write a DETAILED summary of every tweet you see. For each tweet:
- The author's @handle and display name
- The full tweet text (copy it exactly)
- Approximate like/reply/retweet counts

List ALL tweets as a numbered list. Be thorough.`,
        });
        console.log(`[Browser] Keyword "${keyword}" → task ${task.id}`);
        const result = await pollTask(task.id);
        console.log(`[Browser] Keyword "${keyword}" → ${result.status} (${result.steps} steps)`);
        return { keyword, answer: result.answer, status: result.status, task_id: task.id };
      } catch (err) {
        console.log(`[Browser] Keyword "${keyword}" → error: ${err.message}`);
        return { keyword, answer: null, status: "error", task_id: null };
      }
    });

    const results = await Promise.all(taskPromises);

    // Combine all summaries
    const allSummaries = results
      .filter(r => r.status === "complete" && r.answer && r.answer.length > 50)
      .map(r => `--- Results for "${r.keyword}" ---\n${r.answer}`)
      .join("\n\n");

    const taskIds = results.map(r => r.task_id).filter(Boolean);

    if (!allSummaries) {
      return res.status(500).json({ error: "No tweets found across any keyword", task_ids: taskIds });
    }

    // Strategy AI (Claude) extracts structured tweet data from all summaries
    console.log(`[Strategy] Extracting tweets from ${results.filter(r => r.answer).length} keyword summaries...`);
    const extraction = await llm(
      "You extract structured tweet data from text summaries of X/Twitter search results. Be precise and deduplicate.",
      `Here are summaries of tweets found on X/Twitter across multiple keyword searches. Extract each unique tweet into structured JSON. Deduplicate if the same tweet appears in multiple searches.

For each tweet, extract:
- url (if mentioned, otherwise construct from @handle like https://x.com/handle)
- text (the tweet content)
- author_handle (@handle)
- author_name (display name)
- engagement (likes, replies, retweets as numbers)

SUMMARIES:
${allSummaries}

Return ONLY a JSON object:
\`\`\`json
{"tweets": [{"url": "...", "text": "...", "author_handle": "@...", "author_name": "...", "engagement": {"likes": 0}}]}
\`\`\``
    );

    const parsed = extractJSON(extraction);
    const tweets = parsed?.tweets || [];
    console.log(`[Strategy] Extracted ${tweets.length} unique tweets`);
    res.json({ tweets, task_ids: taskIds });
  } catch (err) {
    console.error("[Browser] Search error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Step 3: Score & draft → Strategy AI processes raw tweets
app.post("/api/draft", async (req, res) => {
  try {
    const { tweets } = req.body;
    if (!tweets?.length) return res.status(400).json({ error: "tweets required" });
    if (!productContext) return res.status(400).json({ error: "Run /api/analyze first" });

    console.log(`[Strategy] Scoring ${tweets.length} tweets and drafting replies...`);

    const skipHandles = posted.map(p => p.author_handle).join(", ") || "none";

    const result = await llm(
      `You are an expert X/Twitter marketer. You score tweet opportunities and draft replies that sound completely human — never AI-generated.

Voice profile:
- Tone: ${productContext.voice?.tone || "casual"}
- Style: ${productContext.voice?.style || "helpful, concise"}
- Never use: ${(productContext.voice?.never_use || []).join(", ") || "em dashes, leverage, harness, streamline"}

Anti-AI rules (CRITICAL):
- No em dashes (—), semicolons, or parallel structure
- No "Hey!", "Great point!", "Love this!", "Check out"
- Under 280 characters
- Use contractions (don't, can't, it's)
- Sound like a text message, not a press release
- Match the energy of the original poster`,

      `Product: ${productContext.name}
URL: ${productContext.url || ""}
Pitch: ${productContext.product_pitch || productContext.description}
Pain points: ${(productContext.pain_points || []).join("; ")}

Skip these handles (already engaged): ${skipHandles}

Here are raw tweets collected from X. Score each 1-10, pick the top 5, and draft a reply for each.

Scoring criteria:
- Relevance to our product's problem space
- Tweet posted recently (last 24h = high, older = low)
- Author quality (real person, relevant bio, 100+ followers)
- Reply visibility (few existing replies = your reply gets seen)
- Conversation potential (questions > statements)

Reply type mix:
- Type A (~40%): Pure value, no product mention. Build reputation.
- Type B (~40%): Value + soft product mention at the end.
- Type C (~20%): Direct recommendation (only when they're explicitly asking for a tool).

Raw tweets:
${JSON.stringify(tweets, null, 2)}

Return JSON:
\`\`\`json
{"drafts": [
  {
    "tweet_url": "...",
    "tweet_text": "...",
    "author_handle": "@...",
    "author_name": "...",
    "author_bio": "...",
    "author_followers": 0,
    "reply_text": "your draft reply",
    "reply_type": "A|B|C",
    "score": 8,
    "reasoning": "why this tweet and this reply approach"
  }
]}
\`\`\``
    );

    const parsed = extractJSON(result);
    const newDrafts = (parsed?.drafts || []).map((d, i) => ({
      id: `d-${Date.now()}-${i}`,
      status: "pending",
      ...d,
    }));

    drafts.push(...newDrafts);
    console.log(`[Strategy] Drafted ${newDrafts.length} replies`);
    res.json({ drafts: newDrafts });
  } catch (err) {
    console.error("[Strategy] Draft error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Drafts CRUD
app.get("/api/drafts", (req, res) => {
  const status = req.query.status;
  res.json(status ? drafts.filter(d => d.status === status) : drafts);
});

app.patch("/api/drafts/:id", (req, res) => {
  const d = drafts.find(x => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: "Not found" });
  if (req.body.status) d.status = req.body.status;
  if (req.body.reply_text) d.reply_text = req.body.reply_text;
  res.json(d);
});

// Step 4: Post → Browser tool posts one reply
app.post("/api/drafts/:id/post", async (req, res) => {
  try {
    const { browser_session_id } = req.body;
    const d = drafts.find(x => x.id === req.params.id);
    if (!d) return res.status(404).json({ error: "Not found" });

    console.log(`[Browser] Posting reply to ${d.author_handle}...`);

    const task = await hanzi("POST", "/v1/tasks", {
      browser_session_id,
      task: `Open a new tab, then go to ${d.tweet_url}

Click the reply button. Type this exact text in the reply box:

${d.reply_text}

Click the post/reply button to submit. Confirm it was posted.`,
    });

    const result = await pollTask(task.id, 2 * 60 * 1000);

    if (result.status === "complete") {
      d.status = "posted";
      posted.push({ ...d, posted_at: new Date().toISOString() });
      console.log(`[Browser] Posted reply to ${d.author_handle}`);
    } else {
      d.status = "failed";
      console.log(`[Browser] Failed to post: ${result.status}`);
    }
    res.json({ draft: d, result: result.status });
  } catch (err) {
    console.error("[Browser] Post error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/posted", (req, res) => res.json(posted));

// ── Frontend ──────────────────────────────────────────────────

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, "index.html"), "utf-8");

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(HTML);
});


app.listen(PORT, () => {
  console.log(`
  X Marketing
  http://localhost:${PORT}

  Strategy AI: ${LLM_URL} (${LLM_MODEL})
  Browser:     ${HANZI_URL}
  `);
});
