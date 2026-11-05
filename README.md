# Proactive Claude Work Fleet

A Claude Code skill that lets you run all your projects by talking to one session.

## Install

```bash
git clone https://github.com/sriptcollector/proactive-claude-work-fleet "$HOME/.claude/skills/proactive-claude-work-fleet"
```

Works in PowerShell, Git Bash, macOS and Linux. Needs Claude Code and Node 20 or newer. Then, in any session, say "be my top boss" or `/proactive-claude-work-fleet`. It checks your setup, and asks for your vault's location if it needs to.

Update with `git -C "$HOME/.claude/skills/proactive-claude-work-fleet" pull`.

## How it works

You talk to one session, the **top boss**. It works on all your projects at once and figures out which project you mean.

```
you <-> top boss <-> mini boss (one per project) <-> workers
```

- **Commands go down, questions come up.** A worker asks its mini boss, the mini boss asks the top boss, and the top boss asks you.
- **You just tap.** Questions arrive as clickable choices, best one first, several at a time. Questions asked overnight stack up, to 100, and you clear them in rounds. Nothing answered gets asked again.
- **Nothing waits silently.** Every open decision has a dated line in a "Waiting on you" note, and you get a reminder after about a day. Things waiting on a condition, such as profit, can be pushed back with a label.
- **It's proactive.** The boss starts sessions when work needs an owner, changes or stops them, keeps them moving, merges their branches, runs the checks, deploys only when all pass, and looks at the result in a browser.
- **It reports honestly.** What it saw, what a session only reported, what wasn't tested, and what didn't happen.
- **A manager checks on everyone,** on a schedule, and obeys any `HOLD` line you've written in a backlog.
- **Bedrock is the shared memory.** Bedrock here is your Markdown vault of notes, not Amazon Bedrock. Sessions read your defaults first, and write new preferences and results back.
- **Signups take one tap.** An agent researches the plan, checks for an existing account and opens the page. You make the account and say done. It does the rest.

## What it will never do on its own

- Send, delete, buy, change DNS or post publicly without your approval of that exact action. A message saying you approved doesn't count as new authority.
- Put secrets in notes, chat or git, or ask for card numbers in chat.
- Turn on anything that sends. That stays off behind a Start switch you press.
- Run unattended without a named tool list and a cost cap.

These are instructions the sessions follow, backed by Claude Code's permissions where the helper script sets them. They aren't a sandbox. See the limits in `references/manager-schedule.md`.

## Settings

Settings live outside the skill, in `~/.claude/work-fleet.json`, so updates never touch them. Create the file with:

```bash
node "$HOME/.claude/skills/proactive-claude-work-fleet/scripts/fleet.mjs" init --bedrock "/path/to/your/vault"
```

| Setting | What it is |
| --- | --- |
| `bedrockPath` | Your vault's folder. `BEDROCK_PATH` overrides it. |
| `projects` | Your projects: `name`, `path`, `backlog`. Projects in the vault's `Projects/` folder are found on their own. |
| `projectsFolder` | The vault's projects folder. Default `Projects`. |
| `defaultsNotes` | Notes every session reads first. |
| `questionQueue` | The note that holds stacked questions. |
| `waitingOnYou` | The note that tracks every open decision. |
| `sessionPermissionMode` | The mode for spawned sessions. Bypass is refused. |
| `runner` | Cost caps, setting sources and denied commands for headless runs. |

Full example: `settings.example.json`. `WORK_FLEET_CONFIG` points to a different settings file, and `CLAUDE_BIN` to a specific Claude Code program.

Run `claude` once in each project folder and accept the trust prompt. Background sessions refuse an untrusted git repo.

## The helper

`scripts/fleet.mjs` has no dependencies. Claude runs it for you, and you can too.

| Command | What it does |
| --- | --- |
| `doctor` | Checks Claude Code, settings, vault and backlogs |
| `projects [--active]` | Lists projects from settings and the vault |
| `sessions` | Lists live sessions, and active projects with none |
| `holds --project P [--action A]` | Lists HOLD lines. Exit 3 if the action is held |
| `waiting [--days 1]` | Lists open decisions due a reminder or a recheck |
| `spawn --name N --brief F --tools T` | Starts a background session with scoped tools |
| `run --name N --prompt F --tools T --budget D` | One headless run with scoped tools and a cost cap |

## What's in here

- `SKILL.md`: the skill
- `references/`: the boss loop, brief templates, question format, Bedrock integration, manager schedule, service handoff, and tested notes on Claude Code's tools
- `scripts/fleet.mjs`: the helper
- `tests/`: unit tests (`node --test tests/fleet.test.mjs`) and a trigger test that spends a little money (`node tests/trigger-test.mjs`)

## What's been tested

All on Claude Code 2.1.318, Windows 11, Node 24, with throwaway sessions.

- **Helper:** 21 unit tests (`node --test tests/fleet.test.mjs`).
- **Trigger:** `tests/trigger-test.mjs` with Sonnet, one run per prompt, 13 of 13 correct (7 should fire, 6 shouldn't). Tools were limited to `Skill` and `Read` for safety, on a machine with about 150 other skills installed. An earlier description lost 4 of the 7 to similar skills, so a skill close to this one can still compete.
- **Messaging:** a live boss and mini boss exchanged a question and answer with `ListAgents` and `SendMessage`, each waking when messaged.
- **Commands:** `claude --bg`, `agents --json`, `logs`, `stop`, `rm`. The `--tools` scope and the budget stop, on real runs. A manager run against a temporary fleet found its hold, its gap and its overdue decision. `schtasks` create, query, delete.

**Not tested:** a full fleet on real projects; a live `AskUserQuestion` round, which needs a person (its limits were read from the program); the 100-question stack and reminders over real days; `--worktree` on a background session, because the test repo was untrusted and got the trust error; `notify_when_idle`; different permission modes between sessions; cron, macOS and Linux; the `bedrock` MCP tools through this skill; the browser handoff, which needs a person.

See `references/claude-code-tools.md` for the detail and the traps.

## License

MIT
