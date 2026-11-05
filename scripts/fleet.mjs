#!/usr/bin/env node
/**
 * Small helper for the Proactive Claude Work Fleet skill. No dependencies. Node 20 or newer.
 *
 *   fleet.mjs init --bedrock <folder>                write the settings file (never overwrites)
 *   fleet.mjs doctor                                 check Claude Code, settings, vault, backlogs
 *   fleet.mjs config                                 print the settings in use
 *   fleet.mjs projects [--active]                    settings plus the vault's project folders
 *   fleet.mjs sessions [--json]                      live sessions, and projects with no mini boss
 *   fleet.mjs holds --project <name> [--action <a>]  list HOLD lines; exit 3 if the action is held
 *   fleet.mjs holds --backlog <file> [--action <a>]  same, for a file
 *   fleet.mjs waiting [--days 1] [--file <note>]     open decisions due a reminder or a recheck
 *   fleet.mjs spawn --name <n> --brief <file> ...    start a persistent background session
 *   fleet.mjs run --name <n> --prompt <file> ...     one headless run, with tools and a cost cap
 *
 * Exit codes: 0 fine, 1 error, 2 bad usage, 3 held by a HOLD line.
 * Everything goes to `claude` as an argument list, never through a shell.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULTS = {
  bedrockPath: "",
  projectsFolder: "Projects",
  defaultsNotes: [],
  projects: [],
  questionQueue: "Inbox/Fleet questions.md",
  waitingOnYou: "Inbox/Waiting on you.md",
  sessionPermissionMode: "dontAsk",
  runner: {
    budgetUsd: 2,
    maxBudgetUsd: 10,
    settingSources: "project,local",
    denyTools: ["Bash(git push --force*)", "Bash(npm publish*)", "Bash(gh repo delete*)"],
  },
};

const CLAUDE = process.env.CLAUDE_BIN || "claude";

export class UsageError extends Error {}

export function settingsPath(env = process.env) {
  return env.WORK_FLEET_CONFIG || path.join(homedir(), ".claude", "work-fleet.json");
}

export function expandHome(p) {
  if (!p) return p;
  return p === "~" || p.startsWith("~/") || p.startsWith("~\\") ? path.join(homedir(), p.slice(1)) : p;
}

export function loadConfig(file = settingsPath(), env = process.env) {
  let saved = {};
  if (existsSync(file)) {
    try {
      saved = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
    } catch (e) {
      throw new Error(`Settings file isn't valid JSON: ${file} (${e.message})`);
    }
  }
  const config = { ...DEFAULTS, ...saved, runner: { ...DEFAULTS.runner, ...saved.runner } };
  config.bedrockPath = expandHome(env.BEDROCK_PATH || config.bedrockPath);
  config.projects = (config.projects ?? []).map((p) => ({ ...p, path: expandHome(p.path), backlog: expandHome(p.backlog) }));
  return config;
}

/** `--flag value` pairs and bare `--flag` switches. Anything else is a usage error. */
export function parseArgs(argv, switches = []) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new UsageError(`Unexpected argument: ${a}`);
    const key = a.slice(2);
    if (switches.includes(key)) out[key] = true;
    else {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${a} needs a value`);
      out[key] = value;
    }
  }
  return out;
}

/**
 * A HOLD line starts with HOLD, after any list marker or bold. Optional [scope,scope] says which actions it
 * holds; with no scope it holds every action. Optional (who, date) is ignored by the gate.
 *   HOLD (2026-01-15): no deploys until the migration is checked
 *   - HOLD [deploy,send] (user, 2026-01-15): "wait until Monday"
 * To lift one, change the word HOLD to LIFTED and quote who lifted it.
 */
export function parseHolds(text) {
  const holds = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const m = /^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s+)?(?:\*\*)?HOLD\b(.*)$/.exec(raw);
    if (!m) return;
    const scope = /\[([^\]]+)\]/.exec(m[1].split(":")[0]);
    holds.push({
      line: i + 1,
      scopes: scope ? scope[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : [],
      text: raw.trim(),
    });
  });
  return holds;
}

/** A hold with no scope holds everything. No action given means every hold counts. */
export function holdsFor(holds, action) {
  if (!action) return holds;
  const a = action.toLowerCase();
  return holds.filter((h) => h.scopes.length === 0 || h.scopes.includes(a));
}

/** Split "Read,Bash(git status, git log),Edit" on commas outside parentheses. */
export function splitTools(spec) {
  const tools = [];
  let depth = 0;
  let cur = "";
  for (const ch of spec) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      if (cur.trim()) tools.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) tools.push(cur.trim());
  return tools;
}

/** Refuses an empty list, and bare Bash unless the caller says so out loud. */
export function checkTools(tools, { allowBareBash = false } = {}) {
  if (tools.length === 0) throw new UsageError("--tools is required: name exactly what this session may use.");
  if (!allowBareBash && tools.some((t) => t === "Bash" || t === "PowerShell")) {
    throw new UsageError("Bare Bash or PowerShell allows any command. Scope it, like Bash(git status*), or pass --allow-bare-shell.");
  }
  return tools;
}

/** Built-in names for --tools, which removes everything else. MCP tools are only gated by --allowedTools. */
export function baseTools(tools) {
  return [...new Set(tools.map((t) => t.replace(/\(.*$/, "")).filter((t) => !t.startsWith("mcp__")))];
}

export function refuseBypass(mode) {
  if (mode === "bypassPermissions") throw new UsageError("Fleet sessions never bypass permissions.");
  return mode;
}

/** Arguments for one headless run. The prompt goes in on stdin, so nothing in it can become a flag. */
export function runArgs({ tools, budgetUsd, model, settingSources, denyTools = [], mcp = false }) {
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "dontAsk", "--max-budget-usd", String(budgetUsd), "--tools", baseTools(tools).join(",")];
  if (settingSources) args.push("--setting-sources", settingSources);
  if (model) args.push("--model", model);
  if (!mcp) args.push("--strict-mcp-config");
  if (denyTools.length) args.push("--disallowedTools", ...denyTools);
  args.push("--allowedTools", ...tools);
  return args;
}

/**
 * Arguments for a persistent background session. --allowedTools takes many values and would swallow a prompt
 * after it, so the brief always follows `--`. There is no cost cap flag for these: --max-budget-usd is --print only.
 */
export function spawnArgs({ name, brief, tools, mode, model, worktree, denyTools = [], mcp = false }) {
  const args = ["--bg", "-n", name, "--permission-mode", refuseBypass(mode), "--tools", baseTools(tools).join(",")];
  if (model) args.push("--model", model);
  if (worktree) args.push("-w", worktree);
  if (!mcp) args.push("--strict-mcp-config");
  if (denyTools.length) args.push("--disallowedTools", ...denyTools);
  args.push("--allowedTools", ...tools, "--", brief);
  return args;
}

export function capBudget(requested, runner) {
  const value = requested === undefined ? runner.budgetUsd : Number(requested);
  if (!Number.isFinite(value) || value <= 0) throw new UsageError("--budget must be a positive number of dollars.");
  if (value > runner.maxBudgetUsd) throw new UsageError(`--budget ${value} is over runner.maxBudgetUsd (${runner.maxBudgetUsd}).`);
  return value;
}

export function checkName(name) {
  if (!name || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(name)) throw new UsageError("--name must be lowercase letters, numbers and dashes.");
  return name;
}

/** Project folders in the vault: <vault>/<projectsFolder>/<name>/_vault.md. */
export function discoverProjects(config) {
  if (!config.bedrockPath) return [];
  const root = path.join(config.bedrockPath, config.projectsFolder);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(root, d.name, "_vault.md")))
    .map((d) => {
      const text = readFileSync(path.join(root, d.name, "_vault.md"), "utf8");
      const status = /^status:\s*"?([\w-]+)/im.exec(text) ?? /Status:\s*([\w-]+)/.exec(text);
      return { name: d.name, status: status ? status[1].toLowerCase() : "unknown", note: path.join(config.projectsFolder, d.name, `${d.name}.md`) };
    });
}

/** Settings win over what the vault says, and a project in settings counts as active unless it says otherwise. */
export function mergeProjects(config, discovered = discoverProjects(config)) {
  const byName = new Map(discovered.map((p) => [p.name.toLowerCase(), p]));
  for (const p of config.projects) byName.set(p.name.toLowerCase(), { status: "active", ...byName.get(p.name.toLowerCase()), ...p });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findProject(config, name) {
  const p = config.projects.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  if (!p) throw new UsageError(`No project called "${name}" in settings. Add it to "projects" in ${settingsPath()}.`);
  return p;
}

/** A project with no backlog set has nothing to obey. A backlog that's set but missing fails closed. */
export function gate(project, action) {
  if (!project?.backlog) return { held: false, holds: [] };
  if (!existsSync(project.backlog)) throw new Error(`Backlog is missing, so holds can't be checked: ${project.backlog}`);
  const holds = holdsFor(parseHolds(readFileSync(project.backlog, "utf8")), action);
  return { held: holds.length > 0, holds };
}

/**
 * The "Waiting on you" tracker. One open decision per line:
 *   - [ ] opened 2026-01-15 | asked 2026-01-15 | project | the decision | waiting-on: user
 *   - [ ] opened 2026-01-15 | asked 2026-01-15 | project | the decision | waiting-on: profit | recheck 2026-03-01
 * Lines that are ticked aren't open. An open line it can't read counts as due, so nothing goes quiet.
 */
export function parseWaiting(text) {
  const items = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const m = /^\s*[-*+]\s+\[ \]\s+(.*)$/.exec(raw);
    if (!m) return;
    const date = (label) => new RegExp("\\b" + label + "\\s+(\\d{4}-\\d{2}-\\d{2})\\b").exec(m[1])?.[1] ?? null;
    const on = /\bwaiting-on:\s*([^|]+)/.exec(m[1])?.[1].trim().toLowerCase() ?? null;
    items.push({ line: i + 1, opened: date("opened"), asked: date("asked"), recheck: date("recheck"), waitingOn: on, text: m[1].trim() });
  });
  return items;
}

/** Due: on the user and last asked at least `days` ago or never; or labelled and at its recheck date. */
export function dueWaiting(items, now = new Date(), days = 1) {
  const age = (d) => (now.getTime() - Date.parse(`${d}T00:00:00Z`)) / 86_400_000;
  return items.flatMap((item) => {
    if (item.waitingOn && item.waitingOn !== "user") {
      if (!item.recheck) return [{ ...item, why: "labelled with no recheck date" }];
      return age(item.recheck) >= 0 ? [{ ...item, why: `recheck ${item.waitingOn}` }] : [];
    }
    if (!item.asked) return [{ ...item, why: "not asked yet" }];
    const waited = age(item.asked);
    if (Number.isNaN(waited)) return [{ ...item, why: "unreadable date" }];
    return waited >= days ? [{ ...item, why: `asked ${Math.floor(waited)} days ago` }] : [];
  });
}

function claudeJson(args) {
  const r = spawnSync(CLAUDE, args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  if (r.error) throw new Error(`Couldn't run "${CLAUDE}" (${r.error.code}). Set CLAUDE_BIN to the full path of the Claude Code program.`);
  if (r.status !== 0) throw new Error(`claude ${args.join(" ")} failed: ${(r.stderr || "").slice(0, 300)}`);
  return JSON.parse(r.stdout);
}

/** Which projects have no live session? A session belongs to a project when its name starts with the project's slug. */
export function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function sessionGaps(projects, sessions) {
  const names = sessions.map((s) => s.name ?? "");
  return projects.filter((p) => p.status === "active").filter((p) => !names.some((n) => n === slug(p.name) || n.startsWith(`${slug(p.name)}-`))).map((p) => p.name);
}

function printHolds(holds) {
  for (const h of holds) console.log(`line ${h.line}: ${h.text}`);
}

function refuseIfHeld(config, flags, defaultAction) {
  if (!flags.project) return null;
  const project = findProject(config, flags.project);
  const { held, holds } = gate(project, flags.action ?? defaultAction);
  if (held) {
    console.error(`Held. Not starting. ${project.backlog}:`);
    for (const h of holds) console.error(`  line ${h.line}: ${h.text}`);
    process.exitCode = 3;
    return { held: true };
  }
  return { project };
}

const commands = {
  init(argv) {
    const flags = parseArgs(argv);
    const file = settingsPath();
    if (existsSync(file)) throw new Error(`Settings already exist, not overwriting: ${file}`);
    mkdirSync(path.dirname(file), { recursive: true });
    const { runner, sessionPermissionMode, projectsFolder, questionQueue, waitingOnYou } = DEFAULTS;
    writeFileSync(file, `${JSON.stringify({ bedrockPath: flags.bedrock ?? "", projectsFolder, defaultsNotes: [], projects: [], questionQueue, waitingOnYou, sessionPermissionMode, runner }, null, 2)}\n`);
    console.log(`Wrote ${file}`);
  },

  doctor() {
    let bad = 0;
    const line = (ok, text) => {
      if (!ok) bad++;
      console.log(`${ok ? "ok  " : "FIX "} ${text}`);
    };
    const version = spawnSync(CLAUDE, ["--version"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
    line(!version.error && version.status === 0, `Claude Code: ${version.stdout?.trim() || `not found as "${CLAUDE}", set CLAUDE_BIN`}`);
    // Older builds print the top-level help here and treat `claude stop <id>` as a prompt, which starts a new agent.
    const stop = spawnSync(CLAUDE, ["stop", "--help"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
    line(/Usage: claude stop/.test(stop.stdout ?? ""), "`claude stop`, `logs` and `rm` are real commands in this shell (if not, this shell finds an older Claude Code: update it, or set CLAUDE_BIN)");
    const file = settingsPath();
    line(existsSync(file), `Settings file: ${file}`);
    const config = loadConfig(file);
    line(Boolean(config.bedrockPath) && existsSync(config.bedrockPath), `Bedrock vault: ${config.bedrockPath || "not set"}`);
    for (const note of config.defaultsNotes) line(existsSync(path.join(config.bedrockPath, note)), `Defaults note: ${note}`);
    const discovered = discoverProjects(config);
    line(config.projects.length + discovered.length > 0, `Projects: ${config.projects.length} in settings, ${discovered.length} in the vault`);
    for (const p of config.projects) {
      if (p.path) line(existsSync(p.path), `${p.name} folder: ${p.path}`);
      if (p.backlog) line(existsSync(p.backlog), `${p.name} backlog: ${p.backlog}`);
    }
    if (bad) process.exitCode = 1;
  },

  config() {
    console.log(`# ${settingsPath()}`);
    console.log(JSON.stringify(loadConfig(), null, 2));
  },

  projects(argv) {
    const flags = parseArgs(argv, ["active"]);
    const all = mergeProjects(loadConfig());
    const list = flags.active ? all.filter((p) => p.status === "active" || p.status === "live") : all;
    for (const p of list) console.log(`${p.name}\t${p.status ?? "unknown"}\t${p.path ?? "-"}`);
  },

  sessions(argv) {
    const flags = parseArgs(argv, ["json"]);
    const sessions = claudeJson(["agents", "--json"]);
    const gaps = sessionGaps(mergeProjects(loadConfig()), sessions);
    if (flags.json) return console.log(JSON.stringify({ sessions, gaps }, null, 2));
    for (const s of sessions) console.log(`${s.name ?? "(unnamed)"}\t${s.kind}\t${s.status ?? "-"}\t${s.state ?? "-"}`);
    if (gaps.length) console.log(`\nActive projects with no session named after them: ${gaps.join(", ")}`);
  },

  holds(argv) {
    const flags = parseArgs(argv);
    let backlog = flags.backlog;
    if (flags.project) backlog = findProject(loadConfig(), flags.project).backlog;
    if (!backlog) throw new UsageError("Give --project <name> (with a backlog in settings) or --backlog <file>.");
    const { holds, held } = gate({ backlog: expandHome(backlog) }, flags.action);
    if (holds.length === 0) return console.log(flags.action ? `Nothing holds "${flags.action}".` : "No holds.");
    printHolds(holds);
    if (held && flags.action) process.exitCode = 3;
  },

  waiting(argv) {
    const flags = parseArgs(argv);
    const config = loadConfig();
    const file = expandHome(flags.file) ?? (config.bedrockPath ? path.join(config.bedrockPath, config.waitingOnYou) : null);
    if (!file) throw new UsageError("Set bedrockPath in settings, or give --file <note>.");
    if (!existsSync(file)) return console.log(`No tracker yet at ${file}. Nothing is recorded as open.`);
    const days = flags.days === undefined ? 1 : Number(flags.days);
    if (!Number.isFinite(days) || days < 0) throw new UsageError("--days must be a number.");
    const items = parseWaiting(readFileSync(file, "utf8"));
    const due = dueWaiting(items, new Date(), days);
    console.log(`${items.length} open, ${due.length} due.`);
    for (const d of due) console.log(`line ${d.line} (${d.why}): ${d.text}`);
  },

  spawn(argv) {
    const flags = parseArgs(argv, ["allow-bare-shell", "mcp", "dry-run"]);
    const config = loadConfig();
    const name = checkName(flags.name);
    if (!flags.brief) throw new UsageError("--brief <file> is required.");
    const brief = readFileSync(flags.brief, "utf8");
    // Windows caps one command line near 32,000 characters. A longer brief belongs in a file the session reads.
    if (brief.length > 30_000) throw new UsageError("The brief is over 30,000 characters. Shorten it, and have the session read a file for the rest.");
    const tools = checkTools(splitTools(flags.tools ?? ""), { allowBareBash: flags["allow-bare-shell"] });
    const gated = refuseIfHeld(config, flags, "spawn");
    if (gated?.held) return;
    const args = spawnArgs({ name, brief, tools, mode: flags.mode ?? config.sessionPermissionMode, model: flags.model, worktree: flags.worktree, denyTools: config.runner.denyTools, mcp: flags.mcp });
    const cwd = expandHome(flags.cwd) ?? gated?.project?.path ?? process.cwd();
    if (flags["dry-run"]) return console.log(JSON.stringify({ cwd, args: args.slice(0, -1) }, null, 2));
    const r = spawnSync(CLAUDE, args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
    if (r.error) throw new Error(`Couldn't run "${CLAUDE}" (${r.error.code}). Set CLAUDE_BIN to the full path.`);
    process.stdout.write(r.stdout);
    if (r.status !== 0) throw new Error(`Session didn't start: ${(r.stderr || "").slice(0, 300)}`);
  },

  async run(argv) {
    const flags = parseArgs(argv, ["allow-bare-shell", "mcp", "dry-run"]);
    const config = loadConfig();
    checkName(flags.name);
    if (!flags.prompt) throw new UsageError("--prompt <file> is required.");
    const prompt = readFileSync(flags.prompt, "utf8");
    const tools = checkTools(splitTools(flags.tools ?? ""), { allowBareBash: flags["allow-bare-shell"] });
    const budgetUsd = capBudget(flags.budget, config.runner);
    const gated = refuseIfHeld(config, flags, "run");
    if (gated?.held) return;
    const args = runArgs({ tools, budgetUsd, model: flags.model, settingSources: config.runner.settingSources, denyTools: config.runner.denyTools, mcp: flags.mcp });
    const cwd = expandHome(flags.cwd) ?? gated?.project?.path ?? process.cwd();
    if (flags["dry-run"]) return console.log(JSON.stringify({ cwd, args }, null, 2));

    const result = await new Promise((resolve, reject) => {
      const child = spawn(CLAUDE, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false });
      let buffer = "";
      let last = null;
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        const parts = buffer.split("\n");
        buffer = parts.pop();
        for (const raw of parts) {
          try {
            const ev = JSON.parse(raw);
            if (ev.type === "result") last = ev;
          } catch {
            // Hook chatter can land on stdout. Only JSON events count.
          }
        }
      });
      child.stderr.resume();
      child.on("error", (e) => reject(new Error(`Couldn't run "${CLAUDE}" (${e.code}). Set CLAUDE_BIN to the full path.`)));
      child.on("close", (code) => resolve({ code, last }));
      child.stdin.end(prompt);
    });
    const r = result.last;
    const ok = result.code === 0 && r?.subtype === "success" && !r?.is_error;
    if (r?.result) console.log(r.result);
    console.log(JSON.stringify({ name: flags.name, ok, stop: r?.subtype ?? "no result", costUsd: r?.total_cost_usd ?? null, turns: r?.num_turns ?? null, denied: r?.permission_denials?.length ?? 0 }));
    if (!ok) process.exitCode = 1;
  },
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || !Object.hasOwn(commands, command)) {
    console.error(`Commands: ${Object.keys(commands).join(", ")}. See the top of this file.`);
    process.exitCode = 2;
    return;
  }
  try {
    await commands[command](rest);
  } catch (e) {
    console.error(e.message);
    process.exitCode = e instanceof UsageError ? 2 : 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
