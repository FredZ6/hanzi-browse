/**
 * Guard test: every YAML in server/evals/domain/ parses cleanly into a
 * GoldenFile, every case has the required shape, and every case referenced
 * by domain-skills.json actually exists on disk.
 *
 * Catches typos the moment anyone adds a new fixture, before CI spends any
 * tokens running a broken file against the live API.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { loadGoldenFile } from "./load-cases.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOMAIN_DIR = resolve(__dirname, "..", "domain");
const SKILLS_JSON = resolve(__dirname, "..", "..", "src", "agent", "domain-skills.json");

interface DomainEntry { domain: string; lastVerified?: string | null; goldenTasks?: string | null; }

describe("all domain YAMLs", () => {
  const files = readdirSync(DOMAIN_DIR).filter(f => f.endsWith(".yaml"));

  it("the domain directory is non-empty (catches a rename breaking the harness)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f} parses into a valid GoldenFile`, () => {
      const gf = loadGoldenFile(join(DOMAIN_DIR, f));
      expect(gf.domain).toBeTruthy();
      expect(gf.cases.length).toBeGreaterThan(0);
      for (const c of gf.cases) {
        expect(c.id).toBeTruthy();
        expect(c.task).toBeTruthy();
        expect(c.success_check?.type).toMatch(/^(llm_judge|agent_answer_contains)$/);
      }
    });
  }

  it("every goldenTasks pointer in domain-skills.json resolves to a real file", () => {
    const entries: DomainEntry[] = JSON.parse(readFileSync(SKILLS_JSON, "utf-8"));
    for (const e of entries) {
      if (!e.goldenTasks) continue;
      const path = resolve(__dirname, "..", "..", e.goldenTasks);
      expect(() => loadGoldenFile(path), `${e.domain} points at ${e.goldenTasks}`).not.toThrow();
    }
  });

  it("every YAML in the domain dir is referenced by some domain-skills entry", () => {
    const entries: DomainEntry[] = JSON.parse(readFileSync(SKILLS_JSON, "utf-8"));
    const referenced = new Set(entries.map(e => e.goldenTasks).filter(Boolean));
    for (const f of files) {
      const expected = `evals/domain/${f}`;
      expect(referenced, `${f} is not referenced by any domain-skills entry`).toContain(expected);
    }
  });
});
