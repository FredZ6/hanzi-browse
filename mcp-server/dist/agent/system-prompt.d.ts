/**
 * System Prompt for MCP Server Agent Loop
 *
 * Adapted from src/background/modules/system-prompt.js.
 * Simplified for MCP server-side execution:
 * - No turn_answer_start (not needed server-side)
 * - No update_plan (MCP tasks run autonomously)
 * - Keeps core behavior, tool usage, and browser automation instructions
 */
import type { ContentBlockText } from "../llm/client.js";
export declare function buildSystemPrompt(): ContentBlockText[];
