#!/usr/bin/env node
/**
 * Does the skill's description fire on the right prompts? Each prompt gets a real, capped `claude -p` run with only
 * read and skill tools, stopped at the model's first tool call or its answer. This costs a little money per prompt.
 *
 *   node tests/trigger-test.mjs [--model sonnet] [--budget 0.25] [--runs 1]
 *
 * It runs from a new empty folder. Install the skill first, in ~/.claude/skills. Only the user's installed skills are
 * in play, so other skills on the machine compete, as they would for real.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "../scripts/fleet.mjs";

const SKILL = "proactive-claude-work-fleet";
const flags = parseArgs(process.argv.slice(2));
const model = flags.model ?? "sonnet";
const budget = flags.budget ?? "0.25";
const runs = Number(flags.runs ?? 1);
const CLAUDE = process.env.CLAUDE_BIN || "claude";
const { shouldTrigger, shouldNotTrigger } = JSON.parse(readFileSync(new URL("./trigger-prompts.json", import.meta.url), "utf8"));
const cwd = mkdtempSync(path.join(tmpdir(), "fleet-trigger-"));

function firstSkill(prompt) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--model", model, "--output-format", "stream-json", "--verbose", "--permission-mode", "dontAsk", "--max-budget-usd", budget, "--strict-mcp-config", "--tools", "Skill,Read", "--allowedTools", "Skill", "Read"];
    const child = spawn(CLAUDE, args, { cwd, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    let buffer = "";
    let found = null;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      child.kill();
      resolve(value);
    };
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop();
      for (const raw of parts) {
        let ev;
        try {
          ev = JSON.parse(raw);
        } catch {
          continue;
        }
        if (ev.type === "assistant") {
          const use = (ev.message?.content ?? []).find((c) => c.type === "tool_use");
          if (use) {
            found = use.name === "Skill" ? String(use.input?.skill) : `(${use.name})`;
            finish(found);
          }
        }
        if (ev.type === "result") finish(found);
      }
    });
    child.on("error", reject);
    child.on("close", () => finish(found));
    child.stdin.end(prompt);
  });
}

let wrong = 0;
async function check(prompts, expected) {
  for (const prompt of prompts) {
    let hits = 0;
    const seen = [];
    for (let i = 0; i < runs; i++) {
      const skill = await firstSkill(prompt);
      seen.push(skill ?? "none");
      if (skill === SKILL) hits++;
    }
    const ok = expected ? hits > runs / 2 : hits === 0;
    if (!ok) wrong++;
    console.log(`${ok ? "ok  " : "MISS"} ${hits}/${runs} [${seen.join(", ")}] ${prompt.slice(0, 80)}`);
  }
}

await check(shouldTrigger, true);
await check(shouldNotTrigger, false);
console.log(wrong ? `${wrong} wrong.` : "All correct.");
if (wrong) process.exitCode = 1;
