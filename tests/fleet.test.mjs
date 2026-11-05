import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { baseTools, capBudget, checkName, checkTools, discoverProjects, dueWaiting, gate, holdsFor, loadConfig, mergeProjects, parseArgs, parseHolds, parseWaiting, refuseBypass, runArgs, sessionGaps, slug, spawnArgs, splitTools, DEFAULTS } from "../scripts/fleet.mjs";

const FLEET = fileURLToPath(new URL("../scripts/fleet.mjs", import.meta.url));
const tmp = () => mkdtempSync(path.join(tmpdir(), "fleet-test-"));

function cli(args, env = {}) {
  return spawnSync(process.execPath, [FLEET, ...args], { encoding: "utf8", env: { ...process.env, CLAUDE_BIN: "claude-binary-that-does-not-exist", ...env } });
}

test("HOLD lines parse with and without scopes, bullets and bold", () => {
  const holds = parseHolds(["# Backlog", "HOLD (2026-01-15): no deploys", "- HOLD [deploy, Send] (user, 2026-01-15): wait", "**HOLD**: bold", "- [ ] HOLD [merge]: ticked style", "Not a HOLD: mid-line", "LIFTED (user): old", "HOLDING pattern"].join("\r\n"));
  assert.deepEqual(holds.map((h) => h.line), [2, 3, 4, 5]);
  assert.deepEqual(holds[0].scopes, []);
  assert.deepEqual(holds[1].scopes, ["deploy", "send"]);
  assert.deepEqual(holds[3].scopes, ["merge"]);
});

test("square brackets in the reason aren't scopes", () => {
  assert.deepEqual(parseHolds("HOLD (2026-01-15): see [the spec] first")[0].scopes, []);
});

test("an unscoped hold holds every action; a scoped one only its own", () => {
  const holds = parseHolds("HOLD [deploy]: a\nHOLD: b");
  assert.equal(holdsFor(holds, "deploy").length, 2);
  assert.equal(holdsFor(holds, "send").length, 1);
  assert.equal(holdsFor(parseHolds("HOLD [deploy]: a"), "send").length, 0);
  assert.equal(holdsFor(parseHolds("HOLD [Deploy]: a"), "DEPLOY").length, 1);
});

test("a missing backlog fails closed; no backlog set has nothing to obey", () => {
  assert.throws(() => gate({ backlog: path.join(tmp(), "nope.md") }, "deploy"), /can't be checked/);
  assert.equal(gate({}, "deploy").held, false);
});

test("tool lists split outside parentheses and base names drop patterns and MCP", () => {
  assert.deepEqual(splitTools("Read, Bash(git status, git log),Edit"), ["Read", "Bash(git status, git log)", "Edit"]);
  assert.deepEqual(baseTools(["Read", "Bash(git *)", "Bash(npm *)", "mcp__x__y"]), ["Read", "Bash"]);
});

test("empty tools and bare shells are refused; scoped shells pass", () => {
  assert.throws(() => checkTools([]), /required/);
  assert.throws(() => checkTools(["Read", "Bash"]), /Bare/);
  assert.throws(() => checkTools(["PowerShell"]), /Bare/);
  assert.deepEqual(checkTools(["Bash(git *)"]), ["Bash(git *)"]);
  assert.deepEqual(checkTools(["Bash"], { allowBareBash: true }), ["Bash"]);
});

test("run args carry the cap and tools; the prompt is never an argument", () => {
  const a = runArgs({ tools: ["Read", "Bash(git *)"], budgetUsd: 1.5, settingSources: "project,local", denyTools: ["Bash(npm publish*)"] });
  assert.equal(a[a.indexOf("--max-budget-usd") + 1], "1.5");
  assert.equal(a[a.indexOf("--permission-mode") + 1], "dontAsk");
  assert.equal(a[a.indexOf("--tools") + 1], "Read,Bash");
  assert.ok(a.includes("--strict-mcp-config"));
  assert.ok(!a.includes("--"));
  assert.deepEqual(a.slice(a.indexOf("--allowedTools") + 1), ["Read", "Bash(git *)"]);
});

test("spawn args put the brief after -- so --allowedTools can't swallow it", () => {
  const a = spawnArgs({ name: "x", brief: "--do-this", tools: ["Read"], mode: "dontAsk", worktree: "w" });
  assert.deepEqual(a.slice(-3), ["Read", "--", "--do-this"]);
  assert.equal(a[a.indexOf("-w") + 1], "w");
  assert.equal(a[0], "--bg");
});

test("bypass mode is refused", () => {
  assert.throws(() => refuseBypass("bypassPermissions"), /never bypass/);
  assert.throws(() => spawnArgs({ name: "x", brief: "b", tools: ["Read"], mode: "bypassPermissions" }), /never bypass/);
});

test("budgets are positive and under the ceiling", () => {
  assert.equal(capBudget(undefined, DEFAULTS.runner), DEFAULTS.runner.budgetUsd);
  assert.equal(capBudget("3", DEFAULTS.runner), 3);
  assert.throws(() => capBudget("0", DEFAULTS.runner));
  assert.throws(() => capBudget("abc", DEFAULTS.runner));
  assert.throws(() => capBudget("1000", DEFAULTS.runner), /over/);
});

test("names and args are strict", () => {
  assert.equal(checkName("my-boss-1"), "my-boss-1");
  for (const bad of ["", "Has Space", "--flag", "a/b", undefined]) assert.throws(() => checkName(bad));
  assert.deepEqual(parseArgs(["--a", "1", "--b"], ["b"]), { a: "1", b: true });
  assert.throws(() => parseArgs(["stray"]));
  assert.throws(() => parseArgs(["--a"]));
});

test("settings: defaults, env override, and a clear error on broken JSON", () => {
  const dir = tmp();
  const file = path.join(dir, "s.json");
  assert.equal(loadConfig(file, {}).runner.budgetUsd, 2);
  writeFileSync(file, JSON.stringify({ bedrockPath: "/vault", runner: { budgetUsd: 1 } }));
  const c = loadConfig(file, {});
  assert.equal(c.runner.budgetUsd, 1);
  assert.equal(c.runner.maxBudgetUsd, 10);
  assert.equal(loadConfig(file, { BEDROCK_PATH: "/other" }).bedrockPath, "/other");
  writeFileSync(file, "{nope");
  assert.throws(() => loadConfig(file, {}), /valid JSON/);
  writeFileSync(file, `﻿${JSON.stringify({ bedrockPath: "/bom" })}`);
  assert.equal(loadConfig(file, {}).bedrockPath, "/bom");
});

test("projects come from the vault and settings win", () => {
  const vault = tmp();
  for (const [name, body] of [["Alpha", 'description: "Status: active · Repo: a"'], ["Beta", "status: paused"], ["Gamma", "no status here"]]) {
    mkdirSync(path.join(vault, "Projects", name), { recursive: true });
    writeFileSync(path.join(vault, "Projects", name, "_vault.md"), `---\n${body}\n---\n`);
  }
  mkdirSync(path.join(vault, "Projects", "NotAVault"));
  const config = { bedrockPath: vault, projectsFolder: "Projects", projects: [{ name: "beta", path: "/code/beta", status: "active" }, { name: "Delta", path: "/code/delta" }] };
  const found = discoverProjects(config);
  assert.deepEqual(found.map((p) => [p.name, p.status]), [["Alpha", "active"], ["Beta", "paused"], ["Gamma", "unknown"]]);
  const merged = mergeProjects(config);
  assert.equal(merged.find((p) => p.name.toLowerCase() === "beta").status, "active");
  assert.equal(merged.find((p) => p.name === "Delta").status, "active");
  assert.equal(merged.length, 4);
});

test("gaps are active projects with no session named after them", () => {
  const projects = [{ name: "Two Words", status: "active" }, { name: "Done", status: "active" }, { name: "Old", status: "paused" }];
  assert.equal(slug("Two Words!"), "two-words");
  assert.deepEqual(sessionGaps(projects, [{ name: "done-boss" }, { name: "twowords" }, {}]), ["Two Words"]);
});

test("CLI: holds exits 3 when held, 0 when not, and 1 when the backlog is gone", () => {
  const backlog = path.join(tmp(), "b.md");
  writeFileSync(backlog, "HOLD [deploy] (user): wait\n");
  const held = cli(["holds", "--backlog", backlog, "--action", "deploy"]);
  assert.equal(held.status, 3);
  assert.match(held.stdout, /line 1/);
  assert.equal(cli(["holds", "--backlog", backlog, "--action", "send"]).status, 0);
  assert.equal(cli(["holds", "--backlog", `${backlog}.gone`, "--action", "send"]).status, 1);
});

test("CLI: spawn and run refuse before touching Claude when held or unscoped", () => {
  const dir = tmp();
  const backlog = path.join(dir, "b.md");
  writeFileSync(backlog, "HOLD [run]: stop\nHOLD [spawn]: stop\n");
  const settings = path.join(dir, "s.json");
  writeFileSync(settings, JSON.stringify({ projects: [{ name: "P", backlog }] }));
  const prompt = path.join(dir, "p.md");
  writeFileSync(prompt, "hello");
  const env = { WORK_FLEET_CONFIG: settings };
  assert.equal(cli(["run", "--name", "m", "--prompt", prompt, "--tools", "Read", "--project", "P"], env).status, 3);
  assert.equal(cli(["spawn", "--name", "m", "--brief", prompt, "--tools", "Read", "--project", "P"], env).status, 3);
  assert.equal(cli(["run", "--name", "m", "--prompt", prompt, "--tools", "Bash"], env).status, 2);
  assert.equal(cli(["run", "--name", "m", "--prompt", prompt], env).status, 2);
  assert.equal(cli(["spawn", "--name", "m", "--brief", prompt, "--tools", "Read", "--mode", "bypassPermissions"], env).status, 2);
  assert.equal(cli(["run", "--name", "m", "--prompt", prompt, "--tools", "Read", "--budget", "500"], env).status, 2);
});

test("CLI: dry run shows the exact command, and a missing program is a clear error", () => {
  const dir = tmp();
  const prompt = path.join(dir, "p.md");
  writeFileSync(prompt, "secret brief text");
  const env = { WORK_FLEET_CONFIG: path.join(dir, "none.json") };
  const dry = cli(["spawn", "--name", "m", "--brief", prompt, "--tools", "Read", "--dry-run"], env);
  assert.equal(dry.status, 0);
  assert.ok(!dry.stdout.includes("secret brief text"));
  assert.ok(JSON.parse(dry.stdout).args.includes("--allowedTools"));
  const gone = cli(["run", "--name", "m", "--prompt", prompt, "--tools", "Read"], env);
  assert.equal(gone.status, 1);
  assert.match(gone.stderr, /CLAUDE_BIN/);
});

test("CLI: init writes once and never overwrites", () => {
  const file = path.join(tmp(), "deep", "s.json");
  const env = { WORK_FLEET_CONFIG: file };
  assert.equal(cli(["init", "--bedrock", "/vault"], env).status, 0);
  assert.equal(loadConfig(file, {}).bedrockPath, "/vault");
  assert.equal(cli(["init", "--bedrock", "/other"], env).status, 1);
  assert.equal(loadConfig(file, {}).bedrockPath, "/vault");
});

test("CLI: an unknown command is a usage error", () => {
  assert.equal(cli(["nonsense"]).status, 2);
  assert.equal(cli(["constructor"]).status, 2);
});

test("waiting: what's due, what's pushed back, what's closed, and what can't go quiet", () => {
  const now = new Date("2026-02-10T12:00:00Z");
  const items = parseWaiting(
    [
      "# Waiting on you",
      "- [ ] opened 2026-02-01 | asked 2026-02-08 | P | old | waiting-on: user",
      "- [ ] opened 2026-02-10 | asked 2026-02-10 | P | today | waiting-on: user",
      "- [ ] opened 2026-02-01 | asked 2026-02-01 | P | later | waiting-on: profit | recheck 2026-03-01",
      "- [ ] opened 2026-02-01 | asked 2026-02-01 | P | now | waiting-on: profit | recheck 2026-02-09",
      "- [ ] opened 2026-02-01 | asked 2026-02-01 | P | no date | waiting-on: profit",
      "- [ ] opened 2026-02-01 | P | never asked",
      "- [ ] something free-form",
      "- [x] opened 2026-02-01 | asked 2026-02-02 | P | closed | answered 2026-02-02: yes",
    ].join("\r\n"),
  );
  assert.equal(items.length, 7);
  const due = dueWaiting(items, now);
  assert.deepEqual(due.map((d) => d.line), [2, 5, 6, 7, 8]);
  assert.match(due[0].why, /2 days/);
  assert.match(due[1].why, /recheck profit/);
  assert.deepEqual(dueWaiting(items, now, 5).map((d) => d.line), [5, 6, 7, 8]);
});

test("CLI: waiting reads the note, and says so when there's none", () => {
  const dir = tmp();
  const note = path.join(dir, "w.md");
  writeFileSync(note, "- [ ] opened 2020-01-01 | asked 2020-01-01 | P | old | waiting-on: user\n");
  const env = { WORK_FLEET_CONFIG: path.join(dir, "none.json") };
  const r = cli(["waiting", "--file", note], env);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /1 open, 1 due/);
  assert.match(cli(["waiting", "--file", `${note}.gone`], env).stdout, /No tracker yet/);
  assert.equal(cli(["waiting"], env).status, 2);
});
