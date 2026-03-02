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

import { callLLM, type Message, type ContentBlock, type ContentBlockText } from "../llm/client.js";
import { getToolsForAPI, type ToolDefinition } from "./tools.js";
import { buildSystemPrompt } from "./system-prompt.js";

export interface AgentLoopParams {
  sessionId: string;
  task: string;
  url?: string;
  context?: string;
  /** Send a message to the extension via relay */
  send: (msg: any) => Promise<void>;
  /** Wait for a message from the extension */
  waitForMessage: (filter?: (msg: any) => boolean) => Promise<any>;
  /** Progress callback */
  onUpdate?: (step: string) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

export interface AgentLoopResult {
  success: boolean;
  message: string;
  steps: number;
}

const MAX_STEPS = 100;
const TOOL_TIMEOUT_MS = 60000; // 60s per tool execution

/**
 * Run the agent loop: LLM calls + remote tool execution via extension.
 */
export async function runAgentLoop(params: AgentLoopParams): Promise<AgentLoopResult> {
  const { sessionId, task, url, context, send, waitForMessage, onUpdate, signal } = params;

  // Step 1: Create session in extension — get tab/window
  onUpdate?.("Creating browser session...");
  await send({
    type: "mcp_create_session",
    sessionId,
    url: url || undefined,
  });

  const createResult = await waitForMessage(
    (msg) => msg.type === "session_created" && msg.sessionId === sessionId
  );

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
  const userContent: ContentBlock[] = [];
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
  const initialPage = await executeRemoteTool(
    sessionId, "read_page", { tabId }, send, waitForMessage, signal
  );

  // Build initial page context into the user message
  if (initialPage && !initialPage.error) {
    userContent.push({
      type: "text",
      text: `<system-reminder>Initial page state:\n${formatToolResultText(initialPage.content)}</system-reminder>`,
    });
  }

  const messages: Message[] = [{ role: "user", content: userContent }];

  // Pending follow-up messages (injected via browser_message)
  const pendingMessages: string[] = [];

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
        tools: tools as ToolDefinition[],
        signal,
        onText: (chunk) => {
          // Could stream to onUpdate if desired
        },
      });
    } catch (error: any) {
      if (error.name === "AbortError" || signal?.aborted) {
        await sendCloseSession(sessionId, send);
        return { success: false, message: "Task stopped by user", steps };
      }
      await sendCloseSession(sessionId, send);
      return { success: false, message: `LLM error: ${error.message}`, steps };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use"
    );

    // Extract text response
    const textBlock = response.content.find(
      (b): b is ContentBlockText => b.type === "text"
    );
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
    const toolResults: ContentBlock[] = [];
    for (const toolUse of toolUses) {
      if (signal?.aborted) {
        await sendCloseSession(sessionId, send);
        return { success: false, message: "Task stopped by user", steps };
      }

      onUpdate?.(`[step ${steps}] Using ${toolUse.name}...`);

      const result = await executeRemoteTool(
        sessionId, toolUse.name, toolUse.input, send, waitForMessage, signal
      );

      if (result.error) {
        toolResults.push({
          type: "tool_result" as any,
          tool_use_id: toolUse.id,
          content: `Error: ${result.error}`,
        } as any);
        onUpdate?.(`[step ${steps}] ${toolUse.name} error: ${result.error}`);
      } else {
        toolResults.push({
          type: "tool_result" as any,
          tool_use_id: toolUse.id,
          content: result.content,
        } as any);
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
 * Inject a follow-up message into a running agent loop.
 * Returns a function that can be called to push messages.
 */
export type MessageInjector = (message: string) => void;

/**
 * Execute a tool remotely via the extension.
 */
async function executeRemoteTool(
  sessionId: string,
  toolName: string,
  toolInput: Record<string, any>,
  send: (msg: any) => Promise<void>,
  waitForMessage: (filter?: (msg: any) => boolean) => Promise<any>,
  signal?: AbortSignal,
): Promise<{ content: any; error?: string }> {
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
    waitForMessage(
      (msg) => msg.type === "tool_result" && msg.sessionId === sessionId && msg.toolUseId === toolUseId
    ),
    new Promise<null>((resolve) => {
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

async function sendCloseSession(sessionId: string, send: (msg: any) => Promise<void>): Promise<void> {
  try {
    await send({ type: "mcp_close_session", sessionId });
  } catch {
    // Best effort — session may already be closed
  }
}

function formatToolResultText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
  }
  return JSON.stringify(content);
}
