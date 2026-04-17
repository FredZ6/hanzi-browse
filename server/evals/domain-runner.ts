#!/usr/bin/env node
/**
 * Domain-skills eval runner.
 *
 * Usage:
 *   npx tsx server/evals/domain-runner.ts                          # run all domains
 *   npx tsx server/evals/domain-runner.ts --domain x.com           # one domain
 *   npx tsx server/evals/domain-runner.ts --domain x.com --case reply
 *   npx tsx server/evals/domain-runner.ts --ci                     # JSON output
 *
 * Requires: the Chrome extension paired with a workspace, relay running
 * on ws://localhost:7862, HANZI_EVAL_SESSION_ID env var set to the
 * paired browser_session_id.
 */
import { readdirSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { loadGoldenFile } from "./domain-runner/load-cases.js";
import { runCase } from "./domain-runner/runner.js";
import { formatSummary, toJsonReport } from "./domain-runner/report.js";
import { createRelayExecutor } from "./domain-runner/relay-executor.js";
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sessionId = process.env.HANZI_EVAL_SESSION_ID;
  if (!sessionId) {
    console.error("Missing HANZI_EVAL_SESSION_ID env var (paired browser_session_id).");
    process.exit(2);
  }

  const domainDir = resolve(__dirname, "domain");
  if (!existsSync(domainDir)) {
    console.error(`No domain directory at ${domainDir}. Create YAML files under server/evals/domain/.`);
    process.exit(2);
  }
  const files = readdirSync(domainDir).filter(f => f.endsWith(".yaml"));

  const executor = await createRelayExecutor({
    browserSessionId: sessionId,
  });
  const all: CaseResult[] = [];

  try {
    for (const f of files) {
      const gf = loadGoldenFile(join(domainDir, f));
      if (args.domain && gf.domain !== args.domain) continue;
      for (const c of gf.cases) {
        if (args.caseId && c.id !== args.caseId) continue;
        process.stderr.write(`  … ${gf.domain} / ${c.id}\n`);
        const r = await runCase(gf.domain, c, executor);
        all.push(r);
        if (args.failFast && !r.pass) break;
      }
    }
  } finally {
    await executor.close();
  }

  if (args.ci) {
    process.stdout.write(toJsonReport(all));
  } else {
    process.stdout.write(formatSummary(all));
  }

  const failed = all.filter(r => !r.pass).length;
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("Runner failed:", err);
  process.exit(2);
});
