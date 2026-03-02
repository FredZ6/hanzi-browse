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
export const TOOL_DEFINITIONS = [
    {
        name: "read_page",
        description: `Get a rich DOM tree of the page via Chrome DevTools Protocol. Returns interactive elements with numeric backendNodeId references (e.g., [42]<button>Submit</button>). IMPORTANT: Only use element IDs from the CURRENT output — IDs change between calls. Pierces shadow DOM and iframes automatically. tabId is optional — if omitted, the active tab is used automatically.`,
        input_schema: {
            type: "object",
            properties: {
                tabId: {
                    type: "number",
                    description: "Tab ID to target. Optional — if omitted, uses the active tab in your window.",
                },
                max_chars: {
                    type: "number",
                    description: "Maximum characters for output (default: 50000).",
                },
            },
            required: [],
        },
    },
    {
        name: "find",
        description: `Find elements on the page using natural language. Can search for elements by their purpose (e.g., "search bar", "login button") or by text content (e.g., "organic mango product"). Returns up to 20 matching elements with references. tabId is optional.`,
        input_schema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: 'Natural language description of what to find (e.g., "search bar", "add to cart button")',
                },
                tabId: {
                    type: "number",
                    description: "Tab ID to search in. Optional.",
                },
            },
            required: ["query"],
        },
    },
    {
        name: "form_input",
        description: `Set values in ANY form element — text inputs, textareas, native <select> dropdowns, custom React/Workday/MUI dropdown comboboxes, checkboxes, radio buttons, date pickers, and number inputs. For dropdowns (both native and custom), just pass the desired option text as the value. ALWAYS prefer form_input over computer clicks for form fields. tabId is optional.`,
        input_schema: {
            type: "object",
            properties: {
                ref: {
                    type: "string",
                    description: 'Element reference from read_page (numeric backendNodeId, e.g., "42") or find tool (e.g., "ref_1")',
                },
                value: {
                    type: ["string", "boolean", "number"],
                    description: "The value to set.",
                },
                tabId: {
                    type: "number",
                    description: "Tab ID. Optional.",
                },
            },
            required: ["ref", "value"],
        },
    },
    {
        name: "computer",
        description: `Use a mouse and keyboard to interact with a web browser, and take screenshots. tabId is optional.
* Click on elements with the cursor tip in the center. Consult a screenshot to determine coordinates before clicking.
* If a click failed, adjust your click location so the cursor tip visually falls on the element.`,
        input_schema: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: [
                        "left_click", "right_click", "type", "screenshot", "wait",
                        "scroll", "key", "left_click_drag", "double_click",
                        "triple_click", "zoom", "scroll_to", "hover",
                    ],
                    description: "The action to perform.",
                },
                coordinate: {
                    type: "array",
                    items: { type: "number" },
                    minItems: 2,
                    maxItems: 2,
                    description: "(x, y) coordinates in pixels.",
                },
                text: {
                    type: "string",
                    description: 'The text to type or key(s) to press.',
                },
                duration: {
                    type: "number",
                    minimum: 0,
                    maximum: 30,
                    description: "Seconds to wait (for wait action).",
                },
                scroll_direction: {
                    type: "string",
                    enum: ["up", "down", "left", "right"],
                    description: "Direction to scroll.",
                },
                scroll_amount: {
                    type: "number",
                    minimum: 1,
                    maximum: 10,
                    description: "Number of scroll ticks. Default 3.",
                },
                start_coordinate: {
                    type: "array",
                    items: { type: "number" },
                    minItems: 2,
                    maxItems: 2,
                    description: "Starting coordinates for left_click_drag.",
                },
                region: {
                    type: "array",
                    items: { type: "number" },
                    minItems: 4,
                    maxItems: 4,
                    description: "(x0, y0, x1, y1) region for zoom action.",
                },
                repeat: {
                    type: "number",
                    minimum: 1,
                    maximum: 100,
                    description: "Times to repeat key sequence. Default 1.",
                },
                ref: {
                    type: "string",
                    description: "Element reference for scroll_to or as alternative to coordinate for clicks.",
                },
                modifiers: {
                    type: "string",
                    description: 'Modifier keys for clicks (e.g., "ctrl+shift", "cmd+alt").',
                },
                tabId: {
                    type: "number",
                    description: "Tab ID. Optional.",
                },
            },
            required: ["action"],
        },
    },
    {
        name: "navigate",
        description: `Navigate to a URL, or go forward/back in browser history. tabId is optional.`,
        input_schema: {
            type: "object",
            properties: {
                url: {
                    type: "string",
                    description: 'The URL to navigate to. Use "forward"/"back" for history navigation.',
                },
                tabId: {
                    type: "number",
                    description: "Tab ID to navigate. Optional.",
                },
            },
            required: ["url"],
        },
    },
    {
        name: "get_page_text",
        description: `Extract raw text content from the page, prioritizing article content. Ideal for reading articles or text-heavy pages. Returns plain text. tabId is optional.`,
        input_schema: {
            type: "object",
            properties: {
                tabId: {
                    type: "number",
                    description: "Tab ID. Optional.",
                },
                max_chars: {
                    type: "number",
                    description: "Maximum characters for output (default: 50000).",
                },
            },
            required: [],
        },
    },
    {
        name: "tabs_create",
        description: "Creates a new empty tab in the current window.",
        input_schema: {
            type: "object",
            properties: {},
            required: [],
        },
    },
    {
        name: "tabs_context",
        description: "Get context information about all tabs in the current window.",
        input_schema: {
            type: "object",
            properties: {},
            required: [],
        },
    },
    {
        name: "tabs_close",
        description: "Close a tab or popup window. You MUST specify the tabId — use tabs_context to find it.",
        input_schema: {
            type: "object",
            properties: {
                tabId: {
                    type: "number",
                    description: "Tab ID to close. Required.",
                },
            },
            required: ["tabId"],
        },
    },
    {
        name: "read_console_messages",
        description: `Read browser console messages from a tab. Useful for debugging JavaScript errors. Always provide a pattern to filter. tabId is optional.`,
        input_schema: {
            type: "object",
            properties: {
                tabId: { type: "number", description: "Tab ID. Optional." },
                onlyErrors: { type: "boolean", description: "If true, only return errors." },
                clear: { type: "boolean", description: "If true, clear messages after reading." },
                pattern: { type: "string", description: "Regex pattern to filter messages." },
                limit: { type: "number", description: "Max messages to return. Default 100." },
            },
            required: [],
        },
    },
    {
        name: "read_network_requests",
        description: `Read HTTP network requests from a tab. Useful for debugging API calls. tabId is optional.`,
        input_schema: {
            type: "object",
            properties: {
                tabId: { type: "number", description: "Tab ID. Optional." },
                urlPattern: { type: "string", description: "URL pattern to filter requests." },
                clear: { type: "boolean", description: "If true, clear requests after reading." },
                limit: { type: "number", description: "Max requests to return. Default 100." },
            },
            required: [],
        },
    },
    {
        name: "resize_window",
        description: `Resize the browser window. tabId is optional.`,
        input_schema: {
            type: "object",
            properties: {
                width: { type: "number", description: "Target width in pixels." },
                height: { type: "number", description: "Target height in pixels." },
                tabId: { type: "number", description: "Tab ID. Optional." },
            },
            required: ["width", "height"],
        },
    },
    {
        name: "javascript_tool",
        description: `Execute JavaScript code in the page context. Returns the result of the last expression. Do NOT use 'return' — just write the expression. tabId is optional.`,
        input_schema: {
            type: "object",
            properties: {
                action: { type: "string", description: "Must be 'javascript_exec'." },
                text: { type: "string", description: "JavaScript code to execute." },
                tabId: { type: "number", description: "Tab ID. Optional." },
            },
            required: ["action", "text"],
        },
    },
    {
        name: "view_screenshot",
        description: `View a previously captured screenshot. Returns the image for re-examination.`,
        input_schema: {
            type: "object",
            properties: {
                imageId: { type: "string", description: "ID of a previously captured screenshot." },
            },
            required: ["imageId"],
        },
    },
    {
        name: "file_upload",
        description: `Upload a file to a file input element. Provide a filename or absolute path. Provide ref or CSS selector for the input.`,
        input_schema: {
            type: "object",
            properties: {
                ref: { type: "string", description: "Element reference." },
                selector: { type: "string", description: "CSS selector for the file input." },
                filePath: { type: "string", description: "Filename or absolute path." },
                tabId: { type: "number", description: "Tab ID. Optional." },
            },
            required: ["filePath"],
        },
    },
];
/**
 * Get tool definitions formatted for the Anthropic API.
 */
export function getToolsForAPI() {
    return TOOL_DEFINITIONS;
}
