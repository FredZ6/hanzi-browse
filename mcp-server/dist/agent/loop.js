/**
 * Agent Loop for MCP Server
 *
 * Drives the LLM ↔ tool execution cycle server-side.
 * The extension acts as a remote tool executor.
 *
 * Flow:
 * 1. Send create_session → extension creates tab/window
 * 2. Build initial messages, call LLM
 * 3. For each tool_use → send execute_tool to extension, wait for tool_result
 * 4. Loop until end_turn with no tool calls
 */
import { callLLM } from "../llm/client.js";
import { getToolsForAPI } from "./tools.js";
import { buildSystemPrompt } from "./system-prompt.js";
const MAX_STEPS = 100;
const TOOL_TIMEOUT_MS = 60000; // 60s per tool execution
/**
 * Run the agent loop: LLM calls + remote tool execution via extension.
 */
export async function runAgentLoop(params) {
    const { sessionId, task, url, context, send, waitForMessage, onUpdate, signal } = params;
    // Step 1: Create session in extension — get tab/window
    onUpdate?.("Creating browser session...");
    await send({
        type: "mcp_create_session",
        sessionId,
        url: url || undefined,
    });
    const createResult = await waitForMessage((msg) => msg.type === "session_created" && msg.sessionId === sessionId);
    if (!createResult || createResult.error) {
        return {
            success: false,
            message: createResult?.error || "Failed to create browser session",
            steps: 0,
        };
    }
    const { tabId, windowId } = createResult;
    onUpdate?.(`Browser session created (tab: ${tabId})`);
    // Build system prompt and tools
    const system = buildSystemPrompt();
    const tools = getToolsForAPI();
    // Build initial user message
    const userContent = [];
    userContent.push({ type: "text", text: task });
    // Add tab context
    userContent.push({
        type: "text",
        text: `<system-reminder>${JSON.stringify({
            availableTabs: [{ tabId, title: "Task Tab", url: url || "about:blank", active: true }],
            initialTabId: tabId,
        })}</system-reminder>`,
    });
    // Add task context if provided
    if (context) {
        userContent.push({
            type: "text",
            text: `<system-reminder>Task context (use this information when filling forms or making decisions):\n${context}</system-reminder>`,
        });
    }
    // Step 2: Get initial page state
    onUpdate?.("Reading initial page state...");
    const initialPage = await executeRemoteTool(sessionId, "read_page", { tabId }, send, waitForMessage, signal);
    // Build initial page context into the user message
    if (initialPage && !initialPage.error) {
        userContent.push({
            type: "text",
            text: `<system-reminder>Initial page state:\n${formatToolResultText(initialPage.content)}</system-reminder>`,
        });
    }
    const messages = [{ role: "user", content: userContent }];
    // Pending follow-up messages (injected via browser_message)
    const pendingMessages = [];
    // Step 3: Agent loop
    let steps = 0;
    while (steps < MAX_STEPS) {
        if (signal?.aborted) {
            await sendCloseSession(sessionId, send);
            return { success: false, message: "Task stopped by user", steps };
        }
        steps++;
        onUpdate?.(`[step ${steps}] Thinking...`);
        // Call LLM
        let response;
        try {
            response = await callLLM({
                messages,
                system,
                tools: tools,
                signal,
                onText: (chunk) => {
                    // Could stream to onUpdate if desired
                },
            });
        }
        catch (error) {
            if (error.name === "AbortError" || signal?.aborted) {
                await sendCloseSession(sessionId, send);
                return { success: false, message: "Task stopped by user", steps };
            }
            await sendCloseSession(sessionId, send);
            return { success: false, message: `LLM error: ${error.message}`, steps };
        }
        messages.push({ role: "assistant", content: response.content });
        const toolUses = response.content.filter((b) => b.type === "tool_use");
        // Extract text response
        const textBlock = response.content.find((b) => b.type === "text");
        if (textBlock) {
            onUpdate?.(`[step ${steps}] ${textBlock.text.slice(0, 150)}`);
        }
        // No tool calls + end_turn → task complete
        if (toolUses.length === 0 && response.stop_reason === "end_turn") {
            const answer = textBlock?.text || "Task completed (no text response)";
            await sendCloseSession(sessionId, send);
            return { success: true, message: answer, steps };
        }
        // No tool calls but not end_turn → continue
        if (toolUses.length === 0) {
            continue;
        }
        // Execute each tool remotely
        const toolResults = [];
        for (const toolUse of toolUses) {
            if (signal?.aborted) {
                await sendCloseSession(sessionId, send);
                return { success: false, message: "Task stopped by user", steps };
            }
            onUpdate?.(`[step ${steps}] Using ${toolUse.name}...`);
            const result = await executeRemoteTool(sessionId, toolUse.name, toolUse.input, send, waitForMessage, signal);
            if (result.error) {
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content: `Error: ${result.error}`,
                });
                onUpdate?.(`[step ${steps}] ${toolUse.name} error: ${result.error}`);
            }
            else {
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content: result.content,
                });
                const preview = typeof result.content === "string"
                    ? result.content.slice(0, 100)
                    : "done";
                onUpdate?.(`[step ${steps}] ${toolUse.name}: ${preview}`);
            }
        }
        messages.push({ role: "user", content: toolResults });
        // Inject any pending follow-up messages
        if (pendingMessages.length > 0) {
            const msgs = pendingMessages.splice(0);
            for (const msg of msgs) {
                messages.push({
                    role: "user",
                    content: [{ type: "text", text: msg }],
                });
                onUpdate?.(`[follow-up] ${msg.slice(0, 100)}`);
            }
        }
    }
    await sendCloseSession(sessionId, send);
    return { success: false, message: `Reached max steps (${MAX_STEPS})`, steps };
}
/**
 * Execute a tool remotely via the extension.
 */
async function executeRemoteTool(sessionId, toolName, toolInput, send, waitForMessage, signal) {
    const toolUseId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await send({
        type: "mcp_execute_tool",
        sessionId,
        toolName,
        toolInput,
        toolUseId,
    });
    // Wait for result with timeout
    const result = await Promise.race([
        waitForMessage((msg) => msg.type === "tool_result" && msg.sessionId === sessionId && msg.toolUseId === toolUseId),
        new Promise((resolve) => {
            const timer = setTimeout(() => resolve(null), TOOL_TIMEOUT_MS);
            signal?.addEventListener("abort", () => {
                clearTimeout(timer);
                resolve(null);
            });
        }),
    ]);
    if (!result) {
        if (signal?.aborted) {
            return { content: "", error: "Aborted" };
        }
        return { content: "", error: `Tool ${toolName} timed out after ${TOOL_TIMEOUT_MS / 1000}s` };
    }
    if (result.error) {
        return { content: "", error: result.error };
    }
    return { content: result.content };
}
async function sendCloseSession(sessionId, send) {
    try {
        await send({ type: "mcp_close_session", sessionId });
    }
    catch {
        // Best effort — session may already be closed
    }
}
function formatToolResultText(content) {
    if (typeof content === "string")
        return content;
    if (Array.isArray(content)) {
        return content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n");
    }
    return JSON.stringify(content);
}
