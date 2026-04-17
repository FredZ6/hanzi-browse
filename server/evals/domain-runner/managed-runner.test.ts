import { describe, it, expect, vi } from "vitest";
import { runCaseManaged, stepsToTurnLogs } from "./managed-runner.js";
import type { GoldenCase } from "./types.js";

describe("stepsToTurnLogs", () => {
  it("pairs tool_use with tool_output by step+toolName", () => {
    const turns = stepsToTurnLogs([
      { step: 1, status: "thinking", toolName: null, toolInput: null, durationMs: null },
      { step: 1, status: "tool_use", toolName: "navigate", toolInput: { url: "https://x.com" }, durationMs: null },
      { step: 1, status: "tool_output", toolName: "navigate", toolInput: null, output: "Navigated to https://x.com", durationMs: 120 },
      { step: 2, status: "tool_use", toolName: "javascript_tool", toolInput: { text: "execCommand" }, durationMs: null },
      { step: 2, status: "tool_output", toolName: "javascript_tool", toolInput: null, output: "ok", durationMs: 40 },
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0].step).toBe(1);
    expect(turns[0].tools).toHaveLength(1);
    expect(turns[0].tools[0].name).toBe("navigate");
    expect(turns[0].tools[0].result).toContain("Navigated");
    expect(turns[1].tools[0].name).toBe("javascript_tool");
    expect(turns[1].tools[0].durationMs).toBe(40);
  });

  it("returns empty tools array for a step that only has a thinking record", () => {
    const turns = stepsToTurnLogs([
      { step: 1, status: "thinking", toolName: null, toolInput: null, durationMs: null },
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].tools).toEqual([]);
  });
});

describe("runCaseManaged", () => {
  const baseCase: GoldenCase = {
    id: "test-case",
    task: "Do a test",
    success_check: { type: "agent_answer_contains", substring: "ok" },
  };

  function fakeFetch(responses: Array<{ url: string; ok?: boolean; status?: number; body: any }>): typeof fetch {
    return (async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url);
      for (const r of responses) {
        if (u.endsWith(r.url)) {
          return {
            ok: r.ok !== false,
            status: r.status ?? 200,
            json: async () => r.body,
            text: async () => typeof r.body === "string" ? r.body : JSON.stringify(r.body),
          } as Response;
        }
      }
      throw new Error(`Unexpected fetch: ${u}`);
    }) as any;
  }

  it("passes when task completes and answer contains the substring", async () => {
    const fetchImpl = fakeFetch([
      { url: "/v1/tasks", body: { id: "t1" } },
      { url: "/v1/tasks/t1", body: { status: "complete", answer: "all ok here", steps: 3 } },
      { url: "/v1/tasks/t1/steps", body: { steps: [] } },
    ]);
    const r = await runCaseManaged("x.com", baseCase, {
      apiUrl: "https://api.test", apiKey: "k", browserSessionId: "s",
      pollIntervalMs: 5, fetchImpl,
    });
    expect(r.pass).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.steps).toBe(3);
  });

  it("fails when the answer does not contain the substring", async () => {
    const fetchImpl = fakeFetch([
      { url: "/v1/tasks", body: { id: "t2" } },
      { url: "/v1/tasks/t2", body: { status: "complete", answer: "nope", steps: 1 } },
      { url: "/v1/tasks/t2/steps", body: { steps: [] } },
    ]);
    const r = await runCaseManaged("x.com", baseCase, {
      apiUrl: "https://api.test", apiKey: "k", browserSessionId: "s",
      pollIntervalMs: 5, fetchImpl,
    });
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/did not contain/);
  });

  it("fails when required_tool_call is missing in the step trace", async () => {
    const caseWithReq: GoldenCase = {
      ...baseCase,
      required_tool_call: { tool: "javascript_tool", body_contains: "execCommand" },
    };
    const fetchImpl = fakeFetch([
      { url: "/v1/tasks", body: { id: "t3" } },
      { url: "/v1/tasks/t3", body: { status: "complete", answer: "ok", steps: 2 } },
      {
        url: "/v1/tasks/t3/steps",
        body: {
          steps: [
            { step: 1, status: "tool_use", toolName: "navigate", toolInput: { url: "x" }, durationMs: null },
            { step: 1, status: "tool_output", toolName: "navigate", toolInput: null, output: "ok", durationMs: 1 },
          ],
        },
      },
    ]);
    const r = await runCaseManaged("x.com", caseWithReq, {
      apiUrl: "https://api.test", apiKey: "k", browserSessionId: "s",
      pollIntervalMs: 5, fetchImpl,
    });
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/required_tool_call/);
  });

  it("fails when forbidden_tool_call is present in the step trace", async () => {
    const caseWithForbidden: GoldenCase = {
      ...baseCase,
      forbidden_tool_call: { tool: "form_input", target_regex: "tweetTextarea" },
    };
    const fetchImpl = fakeFetch([
      { url: "/v1/tasks", body: { id: "t4" } },
      { url: "/v1/tasks/t4", body: { status: "complete", answer: "ok", steps: 2 } },
      {
        url: "/v1/tasks/t4/steps",
        body: {
          steps: [
            { step: 1, status: "tool_use", toolName: "form_input", toolInput: { target: "tweetTextarea_0", text: "hi" }, durationMs: null },
            { step: 1, status: "tool_output", toolName: "form_input", toolInput: null, output: "ok", durationMs: 1 },
          ],
        },
      },
    ]);
    const r = await runCaseManaged("x.com", caseWithForbidden, {
      apiUrl: "https://api.test", apiKey: "k", browserSessionId: "s",
      pollIntervalMs: 5, fetchImpl,
    });
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/forbidden_tool_call/);
  });

  it("surfaces the POST status when task creation is rejected", async () => {
    const fetchImpl = fakeFetch([
      { url: "/v1/tasks", ok: false, status: 402, body: { error: "Out of credits" } },
    ]);
    const r = await runCaseManaged("x.com", baseCase, {
      apiUrl: "https://api.test", apiKey: "k", browserSessionId: "s",
      pollIntervalMs: 5, fetchImpl,
    });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/402/);
    expect(r.error).toBe("http_402");
  });
});
