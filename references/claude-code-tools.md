# What Claude Code really offers

Tested on Claude Code 2.1.318 on Windows 11 with throwaway sessions, unless a line says otherwise. Run `claude --help` and `fleet.mjs doctor` before trusting this on another version.

## Finding and messaging sessions

| Tool or command | What it does | Tested |
| --- | --- | --- |
| `ListAgents` (tool) | Lists subagents and other local sessions. Each row gives `name [ref]`, then the kind, status and age. | Yes, in a `-p` run |
| `SendMessage` (tool) | `to` is a name from `ListAgents`. Add ` [ref]` only when a listing or error shows you need it. | Yes, in a `-p` run, to a background session |
| `SendMessage` with `notify_when_idle: true` | One notice when that session next goes idle. Main conversation, same machine. | No. Taken from the tool's description |
| `claude agents --json` | JSON list of live sessions: `name`, `kind` (`interactive` or `background`), `status`, `state`, `cwd`, `pid`, `sessionId`. Background ones also have a short `id`. | Yes |
| `AskUserQuestion` (tool) | The clickable questions: 1 to 4 per call, 2 to 4 options each. Limits read from the program itself. | Shape checked. Not offered in `-p` |

Other things seen:

- **The full loop works.** Two background sessions, boss and mini boss, in `dontAsk` with only `ListAgents` and `SendMessage`: the boss asked, the idle mini boss woke and replied by name, and the boss woke and used the answer.
- Sending to an idle background session wakes it. It answered in its own transcript.
- **A headless sender can't get replies.** When the `-p` run exits, its inbox is gone, and the reply fails. Bosses must be sessions that stay alive. This is why the manager is one-way.
- Both sides of the test ran in `dontAsk`. The tool's description warns that a session in a different permission mode holds cross-session messages for its user's approval. Not tested. Keep one mode across the fleet.
- `-p` runs get an automatic name from their folder, so they can show up in `ListAgents`. Don't take them for fleet members.
- In a subagent, `SendMessage` goes out under the parent session's address, and replies go to the parent, not the subagent. Taken from the tool's description.

## Starting and stopping sessions

| Command | What it does | Tested |
| --- | --- | --- |
| `claude --bg -n <name> ... -- "<prompt>"` | Starts a persistent background session and prints its short id. | Yes |
| `claude logs <id>` | Recent terminal output. Includes terminal control codes. | Yes |
| `claude stop <id>` | Stops it and keeps the conversation. | Yes |
| `claude rm <id>` | Deletes the background session. | Yes |
| `claude attach <id>` | Opens it in this terminal. | No, it needs a real terminal |
| `-w, --worktree [name]` | Gives the session its own git worktree. | No. In an untrusted repo it stops with the trust error below. The flag is from `claude --help` |

## Traps found by testing

- **`--allowedTools` swallows a prompt placed after it.** It takes many values, so the session starts empty and reports `idle - send a prompt to start`. Put `--` before the prompt, or pipe the prompt in. `fleet.mjs` does this for you.
- **A shell can find an older Claude Code.** On the test machine, Git Bash ran 2.1.263 and PowerShell ran 2.1.318. On 2.1.263, `claude stop <id>`, `claude logs <id>` and `claude rm <id>` were taken as **prompts**: they started a new agent that acted on the word "stop", "logs" or "rm" and left the session running. Always check with `fleet.mjs doctor`, which only ever calls `--help`. Set `CLAUDE_BIN` to pin the right program.
- **Background sessions refuse an untrusted git repo:** `Workspace not trusted. Run claude in <folder> once and accept the trust prompt`. Run `claude` once in each project folder before the boss needs it.
- **`--max-budget-usd` is `-p` only**, and it's checked between turns.
- **`--tools` removes built-ins entirely.** `--allowedTools` only decides what runs without asking. `fleet.mjs` sets both.

## Scheduling

| Option | Use |
| --- | --- |
| Windows Task Scheduler (`schtasks`) | Create, query and delete tested. Best for the manager. |
| cron | Not tested. |
| `/schedule` skill | Cloud agents on a cron. From its description, not tested here. Likely can't see local sessions. |
| `/loop` skill, and the `CronCreate`, `ScheduleWakeup` tools | Exist in the session's tool list. Not tested. Check whether they outlive the session before relying on them for the manager. |
| `Monitor` tool | Streams events from a script to a session. Good for watching a deploy or a log. Not tested here. |
| `PushNotification` tool | In the tool list. Not tested. A possible nudge that the stack is waiting, not a way to ask. |
