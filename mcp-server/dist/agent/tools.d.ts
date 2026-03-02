/**
 * Tool Definitions for MCP Server Agent Loop
 *
 * Copied from src/tools/definitions.js — these are the browser automation
 * tools the LLM can call. The extension executes them as a remote tool executor.
 *
 * Excluded tools:
 * - turn_answer_start: Claude-only UI signaling (not needed server-side)
 * - update_plan: Ask-before-acting planning (MCP tasks run autonomously)
 * - escalate: Now handled locally in the agent loop
 * - get_info: Now handled locally in the agent loop
 * - solve_captcha: Domain-specific, excluded for simplicity
 */
export interface ToolDefinition {
    name: string;
    description: string;
    input_schema: Record<string, any>;
}
export declare const TOOL_DEFINITIONS: ToolDefinition[];
/**
 * Get tool definitions formatted for the Anthropic API.
 */
export declare function getToolsForAPI(): ToolDefinition[];
