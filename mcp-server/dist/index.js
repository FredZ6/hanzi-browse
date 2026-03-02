#!/usr/bin/env node
/**
 * Hanzi in Chrome MCP Server
 *
 * Drives the agent loop server-side: reads credentials, calls the LLM,
 * and sends tool execution requests to the Chrome extension.
 *
 * The extension is a "remote tool executor" — no native host needed for MCP users.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { WebSocketClient } from "./ipc/websocket-client.js";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { runAgentLoop } from "./agent/loop.js";
import { describeCredentials, resolveCredentials } from "./llm/credentials.js";
import { checkAndIncrementUsage, getLicenseStatus } from "./license/manager.js";
const sessions = new Map();
const pendingScreenshots = new Map();
// Max time a task can run before we return (configurable, default 5 minutes)
const TASK_TIMEOUT_MS = parseInt(process.env.HANZI_IN_CHROME_TIMEOUT_MS || String(5 * 60 * 1000), 10);
const MAX_CONCURRENT = parseInt(process.env.HANZI_IN_CHROME_MAX_SESSIONS || "5", 10);
// WebSocket relay connection
let connection;
const pendingWaiters = [];
/**
 * Wait for a specific message from the extension via WebSocket relay.
 * Returns null on timeout.
 */
function waitForRelayMessage(filter, timeoutMs = 60000) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            const idx = pendingWaiters.findIndex((w) => w.resolve === resolve);
            if (idx !== -1)
                pendingWaiters.splice(idx, 1);
            resolve(null);
        }, timeoutMs);
        pendingWaiters.push({ filter, resolve, timeout });
    });
}
/**
 * Route incoming relay messages to pending waiters.
 */
async function handleMessage(message) {
    // Check pending waiters first
    for (let i = 0; i < pendingWaiters.length; i++) {
        const waiter = pendingWaiters[i];
        if (waiter.filter(message)) {
            clearTimeout(waiter.timeout);
            pendingWaiters.splice(i, 1);
            waiter.resolve(message);
            return;
        }
    }
    // Handle screenshots for pending requests
    const { type, sessionId, ...data } = message;
    if (type === "screenshot" && data.data && sessionId) {
        const pending = pendingScreenshots.get(sessionId);
        if (pending) {
            clearTimeout(pending.timeout);
            pending.resolve(data.data);
            pendingScreenshots.delete(sessionId);
        }
    }
}
async function send(message) {
    await connection.send(message);
}
function formatResult(session) {
    const result = {
        session_id: session.id,
        status: session.status,
        task: session.task,
    };
    if (session.answer)
        result.answer = session.answer;
    if (session.error)
        result.error = session.error;
    if (session.steps.length > 0) {
        result.total_steps = session.steps.length;
        result.recent_steps = session.steps.slice(-5);
    }
    return result;
}
// --- Helpers ---
const EXTENSION_URL = "https://chromewebstore.google.com/detail/hanzi-in-chrome/iklpkemlmbhemkiojndpbhoakgikpmcd";
function openInBrowser(url) {
    const cmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
    exec(`${cmd} "${url}"`);
}
// --- Extension connectivity check ---
async function isExtensionConnected() {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            connection.offMessage(handler);
            resolve(false);
        }, 2000);
        const handler = (msg) => {
            if (msg.type === "status_response") {
                clearTimeout(timeout);
                connection.offMessage(handler);
                resolve(msg.extensionConnected === true);
            }
        };
        connection.onMessage(handler);
        connection.send({ type: "status_query" }).catch(() => resolve(false));
    });
}
// --- Tool definitions ---
const TOOLS = [
    {
        name: "browser_start",
        description: `Start a browser automation task. Controls the user's real Chrome browser with their existing logins, cookies, and sessions.

An autonomous agent navigates, clicks, types, and fills forms. Blocks until complete or timeout (5 min). You can run multiple browser_start calls in parallel — each gets its own browser window.

WHEN TO USE — only when you need a real browser and no other tool can do it:
- Clicking, typing, filling forms, navigating menus, selecting dropdowns
- Testing workflows: "sign up for an account and verify the welcome email arrives"
- Posting or publishing: write a LinkedIn post, send a Slack message, submit a forum reply, post a tweet
- Authenticated pages: read a Jira ticket, check GitHub PR status, pull data from an analytics dashboard, check order status — the user is already logged in
- Dynamic / JS-rendered pages: SPAs, dashboards, infinite scroll — content that plain fetch can't reach
- Multi-step tasks: "find flights from A to B, compare prices, and pick the cheapest"

WHEN NOT TO USE — always prefer faster tools first:
- If you have an API, MCP tool, or CLI command that can accomplish the task, use that instead. Browser automation is slower and should be a last resort.
- Factual or general knowledge questions — just answer directly
- Web search — use built-in web search or a search MCP
- Reading public/static pages — use a fetch, reader, or web scraping tool
- GitHub, Jira, Slack, etc. — use their dedicated API or MCP tool if available
- API requests — use curl or an HTTP tool
- Code, files, or anything that doesn't need a browser

Return statuses:
- "complete" — task succeeded, result in "answer"
- "error" — task failed. Call browser_screenshot to see the page, then browser_message to retry or browser_stop to clean up.
- "timeout" — the 5-minute window elapsed but the task is still running in the browser. This is normal for long tasks. Call browser_screenshot to check progress, then browser_message to continue or browser_stop to end.`,
        inputSchema: {
            type: "object",
            properties: {
                task: {
                    type: "string",
                    description: "What you want done in the browser. Be specific: include the website, the goal, and any details that matter.",
                },
                url: {
                    type: "string",
                    description: "Starting URL to navigate to before the task begins.",
                },
                context: {
                    type: "string",
                    description: "All the information the agent might need: form field values, text to paste, tone/style preferences, credentials, choices to make.",
                },
            },
            required: ["task"],
        },
    },
    {
        name: "browser_message",
        description: `Send a follow-up message to a running or finished browser session. Blocks until the agent acts on it.

Use cases:
- Correct or refine: "actually change the quantity to 3", "use the second address instead"
- Continue after completion: "now click the Download button", "go to the next page and do the same thing"
- Retry after error: "try again", "click the other link instead"

The browser window is still open from the original browser_start call, so the agent picks up exactly where it left off.`,
        inputSchema: {
            type: "object",
            properties: {
                session_id: { type: "string", description: "Session ID from browser_start." },
                message: { type: "string", description: "Follow-up instructions or answer to the agent's question." },
            },
            required: ["session_id", "message"],
        },
    },
    {
        name: "browser_status",
        description: `Check the current status of browser sessions.

Returns session ID, status, task description, and the last 5 steps.`,
        inputSchema: {
            type: "object",
            properties: {
                session_id: { type: "string", description: "Check a specific session. If omitted, returns all running sessions." },
            },
        },
    },
    {
        name: "browser_stop",
        description: `Stop a browser session. The agent stops but the browser window stays open so the user can review the result.

Without "remove", the session can still be resumed later with browser_message. With "remove: true", the browser window closes and the session is permanently deleted.`,
        inputSchema: {
            type: "object",
            properties: {
                session_id: { type: "string", description: "Session to stop." },
                remove: { type: "boolean", description: "If true, also close the browser window and delete session history." },
            },
            required: ["session_id"],
        },
    },
    {
        name: "browser_screenshot",
        description: `Capture a screenshot of the current browser page. Returns a PNG image.

Call this when browser_start returns "error" or times out — see what the agent was looking at.`,
        inputSchema: {
            type: "object",
            properties: {
                session_id: { type: "string", description: "Session to screenshot. If omitted, captures the currently active tab." },
            },
        },
    },
];
// --- MCP Server ---
const server = new Server({ name: "browser-automation", version: "2.0.0" }, { capabilities: { tools: { listChanged: false } } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case "browser_start": {
                const task = args?.task;
                const url = args?.url;
                const context = args?.context;
                if (!task?.trim()) {
                    return { content: [{ type: "text", text: "Error: task cannot be empty" }], isError: true };
                }
                // Check license / usage limit
                const usage = await checkAndIncrementUsage();
                if (!usage.allowed) {
                    return { content: [{ type: "text", text: usage.message }], isError: true };
                }
                console.error(`[MCP] ${usage.message}`);
                // Check credentials before starting
                const creds = resolveCredentials();
                if (!creds) {
                    return {
                        content: [{
                                type: "text",
                                text: "No LLM credentials found. Set ANTHROPIC_API_KEY env var or run `claude login`.",
                            }],
                        isError: true,
                    };
                }
                // Pre-flight: check if extension is connected
                if (!await isExtensionConnected()) {
                    openInBrowser(EXTENSION_URL);
                    return {
                        content: [{
                                type: "text",
                                text: `Chrome extension is not connected. Opening install page in your browser.\n\nIf already installed, make sure Chrome is open and the extension is enabled. Then try again.`,
                            }],
                        isError: true,
                    };
                }
                // Check concurrency
                const activeCount = [...sessions.values()].filter((s) => s.status === "running").length;
                if (activeCount >= MAX_CONCURRENT) {
                    return {
                        content: [{
                                type: "text",
                                text: `Too many parallel tasks (${activeCount}/${MAX_CONCURRENT}). Wait for some to complete or stop them first.`,
                            }],
                        isError: true,
                    };
                }
                const abortController = new AbortController();
                const session = {
                    id: randomUUID().slice(0, 8),
                    task,
                    url,
                    context,
                    status: "running",
                    steps: [],
                    abortController,
                };
                sessions.set(session.id, session);
                console.error(`[MCP] Starting task ${session.id}: ${task.slice(0, 80)}`);
                // Run agent loop directly — drives LLM + tool execution
                const loopPromise = runAgentLoop({
                    sessionId: session.id,
                    task,
                    url,
                    context,
                    signal: abortController.signal,
                    send: (msg) => send(msg),
                    waitForMessage: (filter) => waitForRelayMessage(filter || (() => true), 120000),
                    onUpdate: (step) => {
                        session.steps.push(step);
                        console.error(`[MCP] ${session.id}: ${step}`);
                    },
                });
                session.loopPromise = loopPromise;
                // Race: agent loop vs timeout
                const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), TASK_TIMEOUT_MS));
                const result = await Promise.race([loopPromise, timeoutPromise]);
                if (result === null) {
                    // Timeout — loop is still running
                    session.status = "timeout";
                    session.error = `Task still running after ${TASK_TIMEOUT_MS / 60000} minutes. Use browser_screenshot to check progress, then browser_message to continue or browser_stop to end.`;
                }
                else {
                    session.status = result.success ? "complete" : "error";
                    if (result.success) {
                        session.answer = result.message;
                    }
                    else {
                        session.error = result.message;
                    }
                }
                return {
                    content: [{ type: "text", text: JSON.stringify(formatResult(session), null, 2) }],
                    isError: session.status === "error",
                };
            }
            case "browser_message": {
                const sessionId = args?.session_id;
                const message = args?.message;
                const session = sessions.get(sessionId);
                if (!session) {
                    return { content: [{ type: "text", text: `Session not found: ${sessionId}` }], isError: true };
                }
                if (!message?.trim()) {
                    return { content: [{ type: "text", text: "Error: message cannot be empty" }], isError: true };
                }
                // For follow-up messages, we restart the agent loop with the new message
                // appended to the conversation (the previous loop has completed or timed out)
                const abortController = new AbortController();
                session.status = "running";
                session.answer = undefined;
                session.error = undefined;
                session.abortController = abortController;
                console.error(`[MCP] Message to ${sessionId}: ${message.slice(0, 80)}`);
                // Run a new agent loop with the follow-up message as the task
                const loopPromise = runAgentLoop({
                    sessionId: session.id,
                    task: message,
                    url: session.url,
                    context: session.context,
                    signal: abortController.signal,
                    send: (msg) => send(msg),
                    waitForMessage: (filter) => waitForRelayMessage(filter || (() => true), 120000),
                    onUpdate: (step) => {
                        session.steps.push(step);
                        console.error(`[MCP] ${session.id}: ${step}`);
                    },
                });
                session.loopPromise = loopPromise;
                const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), TASK_TIMEOUT_MS));
                const result = await Promise.race([loopPromise, timeoutPromise]);
                if (result === null) {
                    session.status = "timeout";
                    session.error = `Task still running after ${TASK_TIMEOUT_MS / 60000} minutes.`;
                }
                else {
                    session.status = result.success ? "complete" : "error";
                    if (result.success) {
                        session.answer = result.message;
                    }
                    else {
                        session.error = result.message;
                    }
                }
                return {
                    content: [{ type: "text", text: JSON.stringify(formatResult(session), null, 2) }],
                    isError: session.status === "error",
                };
            }
            case "browser_status": {
                const sessionId = args?.session_id;
                if (sessionId) {
                    const session = sessions.get(sessionId);
                    if (!session) {
                        return { content: [{ type: "text", text: `Session not found: ${sessionId}` }], isError: true };
                    }
                    return { content: [{ type: "text", text: JSON.stringify(formatResult(session), null, 2) }] };
                }
                const active = [...sessions.values()]
                    .filter((s) => s.status === "running")
                    .map(formatResult);
                return { content: [{ type: "text", text: JSON.stringify(active, null, 2) }] };
            }
            case "browser_stop": {
                const sessionId = args?.session_id;
                const session = sessions.get(sessionId);
                if (!session) {
                    return { content: [{ type: "text", text: `Session not found: ${sessionId}` }], isError: true };
                }
                // Abort the running agent loop
                session.abortController?.abort();
                // Tell extension to close the session
                await send({ type: "mcp_close_session", sessionId });
                if (args?.remove) {
                    sessions.delete(sessionId);
                    return { content: [{ type: "text", text: `Session ${sessionId} removed.` }] };
                }
                session.status = "stopped";
                return { content: [{ type: "text", text: `Session ${sessionId} stopped.` }] };
            }
            case "browser_screenshot": {
                const sessionId = args?.session_id;
                // Send execute_tool for screenshot via the remote executor
                const requestId = sessionId || `screenshot-${Date.now()}`;
                const toolUseId = `screenshot_${Date.now()}`;
                await send({
                    type: "mcp_execute_tool",
                    sessionId: requestId,
                    toolName: "computer",
                    toolInput: { action: "screenshot" },
                    toolUseId,
                });
                // Wait for tool_result with the screenshot
                const result = await waitForRelayMessage((msg) => msg.type === "tool_result" && msg.toolUseId === toolUseId, 10000);
                if (result?.content) {
                    // Extract base64 image from content blocks
                    const content = Array.isArray(result.content) ? result.content : [];
                    const imageBlock = content.find((b) => b.type === "image");
                    if (imageBlock?.source?.data) {
                        return {
                            content: [
                                { type: "image", data: imageBlock.source.data, mimeType: imageBlock.source.media_type || "image/png" },
                                { type: "text", text: "Screenshot of current browser state" },
                            ],
                        };
                    }
                    // Fallback: content might be a string with base64 data
                    if (typeof result.content === "string" && result.content.length > 1000) {
                        return {
                            content: [
                                { type: "image", data: result.content, mimeType: "image/png" },
                                { type: "text", text: "Screenshot of current browser state" },
                            ],
                        };
                    }
                }
                // Fallback to the old screenshot mechanism
                const screenshotPromise = new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        pendingScreenshots.delete(requestId);
                        resolve(null);
                    }, 5000);
                    pendingScreenshots.set(requestId, { resolve, timeout });
                });
                await send({ type: "mcp_screenshot", sessionId: requestId });
                const data = await screenshotPromise;
                if (data) {
                    return {
                        content: [
                            { type: "image", data, mimeType: "image/png" },
                            { type: "text", text: "Screenshot of current browser state" },
                        ],
                    };
                }
                return { content: [{ type: "text", text: "Screenshot timed out." }], isError: true };
            }
            default:
                return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
        }
    }
    catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
});
// --- Startup ---
async function main() {
    console.error("[MCP] Starting Hanzi in Chrome MCP Server v2.0...");
    // Startup diagnostics
    const credDesc = describeCredentials();
    console.error(`[MCP] Credentials: ${credDesc}`);
    const licenseStatus = getLicenseStatus();
    console.error(`[MCP] License: ${licenseStatus.message}`);
    connection = new WebSocketClient({
        role: "mcp",
        autoStartRelay: true,
        onDisconnect: () => console.error("[MCP] Relay disconnected, will reconnect"),
    });
    connection.onMessage(handleMessage);
    await connection.connect();
    console.error("[MCP] Connected to relay");
    // Extension connectivity check
    try {
        if (await isExtensionConnected()) {
            console.error("[MCP] Extension connected — ready for tasks");
        }
        else {
            console.error("[MCP] Extension not connected — install from Chrome Web Store and enable it");
        }
    }
    catch {
        // Non-fatal — don't block startup
    }
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[MCP] Server running (agent loop: server-side)");
}
main().catch((error) => {
    console.error("[MCP] Fatal:", error);
    process.exit(1);
});
