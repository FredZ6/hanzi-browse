#!/usr/bin/env node
/**
 * Domain-skills eval runner — MANAGED (prod API) mode.
 *
 * Runs each golden case against api.hanzilla.co via HTTP (POST /v1/tasks →
 * poll → GET /v1/tasks/:id/steps). Use this for CI, or any time you want
 * to verify the harness against the same code path real users hit.
 *
 * Usage:
 *   npx tsx server/evals/domain-runner-managed.ts
 *   npx tsx server/evals/domain-runner-managed.ts --domain x.com
 *   npx tsx server/evals/domain-runner-managed.ts --domain x.com --case home-composer
 *   npx tsx server/evals/domain-runner-managed.ts --ci
 *
 * Env:
 *   HANZI_API_KEY              (required) — hic_live_... key for the workspace
 *   HANZI_API_URL              (optional) — defaults to https://api.hanzilla.co
 *   HANZI_EVAL_SESSION_ID      (optional) — if set, use this paired session.
 *                              Otherwise, auto-select the first connected one.
 */
import { readdirSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { loadGoldenFile } from "./domain-runner/load-cases.js";
import { runCaseManaged } from "./domain-runner/managed-runner.js";
import { formatSummary, toJsonReport } from "./domain-runner/report.js";
import type { CaseResult } from "./domain-runner/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Args {
  domain?: string;
  caseId?: string;
  ci: boolean;
  failFast: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { ci: false, failFast: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--domain") a.domain = argv[++i];
    else if (argv[i] === "--case") a.caseId = argv[++i];
    else if (argv[i] === "--ci") a.ci = true;
    else if (argv[i] === "--fail-fast") a.failFast = true;
  }
  return a;
}

async function resolveSessionId(apiUrl: string, apiKey: string): Promise<string> {
  const envId = process.env.HANZI_EVAL_SESSION_ID;
  if (envId) return envId;

  const r = await fetch(`${apiUrl}/v1/browser-sessions`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!r.ok) {
    throw new Error(`GET /v1/browser-sessions returned ${r.status}`);
  }
  const body = await r.json() as { sessions: Array<{ id: string; status: string; label?: string }> };
  const connected = body.sessions.find((s) => s.status === "connected");
  if (!connected) {
    throw new Error(
      "No connected browser session found. Pair the extension first via " +
      `${apiUrl}/pair/<pairing-token> or set HANZI_EVAL_SESSION_ID explicitly.`
    );
  }
  return connected.id;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.HANZI_API_KEY;
  const apiUrl = process.env.HANZI_API_URL ?? "https://api.hanzilla.co";

  if (!apiKey) {
    console.error("Missing HANZI_API_KEY env var.");
    process.exit(2);
  }

  let sessionId: string;
  try {
    sessionId = await resolveSessionId(apiUrl, apiKey);
  } catch (e: any) {
    console.error(e.message);
    process.exit(2);
  }
  process.stderr.write(`[runner] session=${sessionId} api=${apiUrl}\n`);

  const domainDir = resolve(__dirname, "domain");
  if (!existsSync(domainDir)) {
    console.error(`No domain directory at ${domainDir}.`);
    process.exit(2);
  }
  const files = readdirSync(domainDir).filter(f => f.endsWith(".yaml"));

  const all: CaseResult[] = [];
  for (const f of files) {
    const gf = loadGoldenFile(join(domainDir, f));
    if (args.domain && gf.domain !== args.domain) continue;
    for (const c of gf.cases) {
      if (args.caseId && c.id !== args.caseId) continue;
      process.stderr.write(`  … ${gf.domain} / ${c.id}\n`);
      const r = await runCaseManaged(gf.domain, c, {
        apiUrl, apiKey, browserSessionId: sessionId,
      });
      all.push(r);
      if (args.failFast && !r.pass) break;
    }
  }

  if (args.ci) {
    process.stdout.write(toJsonReport(all));
  } else {
    process.stdout.write(formatSummary(all));
  }

  const failed = all.filter(r => !r.pass).length;
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Runner failed:", err);
  process.exit(2);
});
