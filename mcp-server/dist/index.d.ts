#!/usr/bin/env node
/**
 * Hanzi in Chrome MCP Server
 *
 * Drives the agent loop server-side: reads credentials, calls the LLM,
 * and sends tool execution requests to the Chrome extension.
 *
 * The extension is a "remote tool executor" — no native host needed for MCP users.
 */
export {};
