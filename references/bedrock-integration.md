# Bedrock: the shared memory

Bedrock here means the user's Markdown vault (Obsidian-compatible notes linked with `[[Note name]]`), not Amazon Bedrock. Its path is `bedrockPath` in settings, or the `BEDROCK_PATH` environment variable.

## How to reach it

- **If `bedrock` MCP tools are connected, prefer them:** `get_context` (everything on a topic, call it first), `search`, `read_note`, `create_note`, `update`, `remember`, `decide`, `log_result`.
- **Otherwise** read and write the Markdown files directly. Search before creating so you don't make duplicates.
- Sessions started with `fleet.mjs` have no MCP by default. Pass `--mcp` and add the tools by name, or give them file tools on the vault.

## Layout it assumes

Adjust to what's there, and list the user's own defaults notes in `defaultsNotes`.

| Folder | Holds |
| --- | --- |
| `Me/` | `Likes.md`, `Dislikes.md`, `Results.md`, who they are |
| `Approved/` | defaults, skills, `Preferences/` |
| `Projects/<name>/` | one folder per project: `_vault.md` (description with a `Status:`), `<name>.md`, decision log |
| `Marketing/` | strategies ranked by money, `Experiments/` |
| `Accounts/` | account notes, `Services/` (never secrets) |
| `Claude/` | `Chats/` and `Memories/` |
| `Inbox/` | ideas waiting on a decision, and the question stack |

## Read first

Every session, before planning:

1. The notes in `defaultsNotes`.
2. `Me/Likes.md`, `Me/Dislikes.md`, `Me/Results.md`.
3. The project note and its decision log.
4. For anything uncertain, `get_context` with the topic. If the user says "like last time", search `Claude/Chats/`.
5. Before signing up for anything, `Accounts/`.

Ask the user only what the vault doesn't know. Briefs name the notes that apply, and paste the rules that must not be missed.

## Write back

Write as it happens. Keep one writer per note where you can, usually the boss or that project's mini boss.

| When | Where | How |
| --- | --- | --- |
| A new standing preference | `Approved/Preferences/` | `remember` kind `preference`, with their words and the date |
| Clear praise, rejection or correction | `Me/Likes.md`, `Me/Dislikes.md` | `remember` kind `like` or `dislike` |
| A decision | project note, decision log | their exact words, date, what it covers |
| An approval of a hard-limit action | the same log | exact action, target, total, their words |
| A shipped result or number | `Me/Results.md` or the project note | `remember` kind `result` |
| A growth test | `Marketing/Experiments/` | `log_result` with money, spend, hours, verdict |
| An idea worth trying | `Inbox/` | `remember` kind `inbox` |
| A new project | `Projects/<name>/` | `_vault.md` and `<name>.md` with the first goal |
| A new account | `Accounts/` | see `service-handoff.md` |

| An open decision | the `waitingOnYou` note | a dated line, see `question-format.md` |

A session's own memory isn't shared. If another session should know it, it goes in the vault.

## When the user states a rule or request

Apply it everywhere it belongs, right away, without being asked twice:

1. The matching vault note, with their words and the date.
2. Any skill that the rule changes.
3. Any repo or brief it changes, and every live session it affects.

The hard limits still apply. Saving a rule doesn't approve a send, a delete, a purchase, a DNS change or a public post. Before anything goes into a public repo, strip names, clients, emails, phone numbers, keys, private paths, account names and private strategy, scan it, and read the whole diff.

## Never in the vault

Passwords, API keys, tokens, 2FA codes, card numbers. A note may say where a secret lives (`password_location`) and how login works (`auth`, `twofa`). Cloud sync doesn't make a secret safe to store there.
