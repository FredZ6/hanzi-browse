/**
 * Hanzi Partner Quickstart
 *
 * Minimal integration example: pair a browser, run a task, show the result.
 *
 * Setup:
 *   1. Sign in at https://api.hanzilla.co/api/auth/sign-in/social
 *   2. Create an API key: curl -X POST https://api.hanzilla.co/v1/api-keys \
 *        -H "Cookie: <your session cookie>" -H "Content-Type: application/json" \
 *        -d '{"name":"quickstart"}'
 *   3. Set HANZI_API_KEY=hic_live_... in your environment
 *   4. npm install && npm start
 *   5. Open http://localhost:3000
 */

import express from "express";

const app = express();
app.use(express.json());

const API_KEY = process.env.HANZI_API_KEY;
const BASE_URL = process.env.HANZI_API_URL || "https://api.hanzilla.co";

if (!API_KEY) {
  console.error("Set HANZI_API_KEY environment variable. See README for setup instructions.");
  process.exit(1);
}

// --- Hanzi API helpers (inline — no SDK dependency for this example) ---

async function hanzi(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// --- Routes ---

// Create a pairing token for the user to connect their browser
app.post("/api/pair", async (req, res) => {
  try {
    // Attach metadata so you can identify this session later.
    // In a real app, use your user's ID and a descriptive label.
    const { label, external_user_id } = req.body;
    const data = await hanzi("POST", "/v1/browser-sessions/pair", {
      label: label || "Quickstart user",
      external_user_id: external_user_id || `demo-${Date.now()}`,
    });
    res.json({
      pairing_token: data.pairing_token,
      expires_in_seconds: data.expires_in_seconds,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List connected browser sessions
app.get("/api/sessions", async (req, res) => {
  try {
    const data = await hanzi("GET", "/v1/browser-sessions");
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Run a task on a connected browser
app.post("/api/task", async (req, res) => {
  try {
    const { browser_session_id, task } = req.body;
    if (!browser_session_id || !task) {
      return res.status(400).json({ error: "browser_session_id and task are required" });
    }

    // Create the task
    const created = await hanzi("POST", "/v1/tasks", {
      browser_session_id,
      task,
    });

    // Poll until complete (max 3 minutes)
    const deadline = Date.now() + 3 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const status = await hanzi("GET", `/v1/tasks/${created.id}`);
      if (status.status !== "running") {
        return res.json(status);
      }
    }

    res.json({ id: created.id, status: "timeout", answer: "Task timed out after 3 minutes." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Frontend ---

app.get("/", (req, res) => {
  res.type("html").send(HTML);
});

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hanzi Partner Quickstart</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f5f3ee; color: #1a1a1a; padding: 40px 20px; }
    .container { max-width: 600px; margin: 0 auto; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: #666; margin-bottom: 32px; }
    .card { background: white; border: 1px solid #e0ddd6; border-radius: 12px; padding: 24px; margin-bottom: 16px; }
    .card h2 { font-size: 16px; margin-bottom: 12px; }
    .card p { font-size: 14px; color: #666; margin-bottom: 12px; }
    button { padding: 10px 20px; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .btn-primary { background: #2f4a3d; color: white; }
    .btn-primary:hover { background: #243b30; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    input, textarea { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; font-family: inherit; }
    textarea { resize: vertical; min-height: 60px; }
    .token-display { padding: 12px; background: #1a1a1a; color: #e8d8c4; border-radius: 8px; font-family: monospace; font-size: 13px; word-break: break-all; margin: 8px 0; }
    .status { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; padding: 4px 10px; border-radius: 999px; }
    .status-connected { background: #e8f5e9; color: #2e7d32; }
    .status-disconnected { background: #fff3e0; color: #e65100; }
    .status-none { background: #f5f5f5; color: #999; }
    .result { padding: 16px; background: #fafaf7; border: 1px solid #e8e5de; border-radius: 8px; margin-top: 12px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; }
    .error { color: #c62828; }
    .steps { display: flex; flex-direction: column; gap: 16px; }
    .step-num { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 999px; background: #2f4a3d; color: white; font-size: 12px; font-weight: 700; margin-right: 8px; flex-shrink: 0; }
    .step-header { display: flex; align-items: center; margin-bottom: 8px; font-weight: 600; }
    #session-list { margin: 8px 0; }
    .session-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
    .session-id { font-family: monospace; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Hanzi Partner Quickstart</h1>
    <p class="subtitle">Pair a browser, run a task, see the result.</p>

    <div class="steps">
      <!-- Step 1: Pair -->
      <div class="card">
        <div class="step-header"><span class="step-num">1</span> Connect a browser</div>
        <p>Generate a pairing link. Your user clicks it and their browser connects automatically.</p>
        <button class="btn-primary" id="pair-btn" onclick="pair()">Generate pairing link</button>
        <div id="pair-result"></div>
      </div>

      <!-- Step 2: Check sessions -->
      <div class="card">
        <div class="step-header"><span class="step-num">2</span> Check connected browsers</div>
        <p>See which browsers are connected to your workspace.</p>
        <button class="btn-primary" id="sessions-btn" onclick="checkSessions()">Refresh sessions</button>
        <div id="session-list"></div>
      </div>

      <!-- Step 3: Run task -->
      <div class="card">
        <div class="step-header"><span class="step-num">3</span> Run a task</div>
        <p>Tell the connected browser what to do.</p>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <textarea id="task-input" placeholder="e.g. Go to Hacker News and tell me the top 3 stories">Go to Hacker News and tell me the top 3 stories</textarea>
          <button class="btn-primary" id="task-btn" onclick="runTask()" disabled>Run task</button>
        </div>
        <div id="task-result"></div>
      </div>
    </div>
  </div>

  <script>
    let connectedSessionId = null;

    async function pair() {
      const btn = document.getElementById('pair-btn');
      const out = document.getElementById('pair-result');
      btn.disabled = true;
      btn.textContent = 'Generating...';
      try {
        const res = await fetch('/api/pair', { method: 'POST' });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const pairUrl = '${BASE_URL}/pair/' + data.pairing_token;
        out.innerHTML =
          '<p style="margin-top:8px;"><a href="' + pairUrl + '" target="_blank" style="font-size:15px;font-weight:600;">' + pairUrl + '</a></p>' +
          '<p style="font-size:13px;color:#666;">Send this link to your user. Expires in ' + data.expires_in_seconds + 's.</p>';
      } catch (err) {
        out.innerHTML = '<p class="error">' + err.message + '</p>';
      }
      btn.disabled = false;
      btn.textContent = 'Generate pairing link';
    }

    async function checkSessions() {
      const btn = document.getElementById('sessions-btn');
      const out = document.getElementById('session-list');
      btn.disabled = true;
      try {
        const res = await fetch('/api/sessions');
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const sessions = data.sessions || [];
        if (sessions.length === 0) {
          out.innerHTML = '<p style="margin-top:8px;"><span class="status status-none">No sessions</span> Pair a browser first.</p>';
          connectedSessionId = null;
        } else {
          out.innerHTML = sessions.map(s => {
            const statusClass = s.status === 'connected' ? 'status-connected' : 'status-disconnected';
            const meta = [s.label, s.external_user_id].filter(Boolean).join(' · ');
            return '<div class="session-row">' +
              '<span class="session-id">' + s.id.slice(0, 8) + '...' + (meta ? ' <span style="color:#888;font-family:sans-serif;font-size:12px;">(' + meta + ')</span>' : '') + '</span>' +
              '<span class="status ' + statusClass + '">' + s.status + '</span></div>';
          }).join('');
          const connected = sessions.find(s => s.status === 'connected');
          connectedSessionId = connected ? connected.id : null;
        }
        document.getElementById('task-btn').disabled = !connectedSessionId;
      } catch (err) {
        out.innerHTML = '<p class="error">' + err.message + '</p>';
      }
      btn.disabled = false;
    }

    async function runTask() {
      if (!connectedSessionId) return;
      const btn = document.getElementById('task-btn');
      const out = document.getElementById('task-result');
      const task = document.getElementById('task-input').value.trim();
      if (!task) return;

      btn.disabled = true;
      btn.textContent = 'Running...';
      out.innerHTML = '<p style="color:#666; margin-top:12px;">Task running — this may take a minute...</p>';

      try {
        const res = await fetch('/api/task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ browser_session_id: connectedSessionId, task }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const statusLabel = data.status === 'complete' ? '✓ Complete' : data.status === 'error' ? '✗ Error' : data.status;
        out.innerHTML =
          '<div class="result">' +
          '<strong>' + statusLabel + '</strong> (' + (data.steps || 0) + ' steps)\\n\\n' +
          (data.answer || 'No answer returned.') +
          '</div>';
      } catch (err) {
        out.innerHTML = '<p class="error">' + err.message + '</p>';
      }
      btn.disabled = false;
      btn.textContent = 'Run task';
    }

    // Auto-check sessions on load
    checkSessions();
  </script>
</body>
</html>`;

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Partner quickstart running at http://localhost:${PORT}`);
  console.log(`Using Hanzi API at ${BASE_URL}`);
});
