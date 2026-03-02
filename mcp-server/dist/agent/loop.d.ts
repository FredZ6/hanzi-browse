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
/**
 * Run the agent loop: LLM calls + remote tool execution via extension.
 */
export declare function runAgentLoop(params: AgentLoopParams): Promise<AgentLoopResult>;
/**
 * Inject a follow-up message into a running agent loop.
 * Returns a function that can be called to push messages.
 */
export type MessageInjector = (message: string) => void;
