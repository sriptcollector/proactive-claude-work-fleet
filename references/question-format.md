# Questions

The goal is the fewest seconds of the user's time for the most decisions.

## The rule

**Every question to the user is asked with the clickable question tool (`AskUserQuestion`), never in plain text.** That includes "should I go ahead?" at the end of a report. If you need an answer, it's a tool call.

Use as many rounds as it takes. Don't drop a question, and don't squeeze several decisions into one vague one because the tool holds 4 at a time.

Only the top boss asks. Everyone else sends a packet up.

## The tool

Its schema enforces these limits (Claude Code 2.1.318):

- **1 to 4 questions per call, 2 to 4 options per question.** Split larger sets into rounds.
- Each question has `question`, a short `header`, `multiSelect` and `options`. Each option has `label` and `description`.
- Answers typed in the user's own words are read literally.

It isn't offered in `claude -p` runs, so a headless session can't ask at all. Anything headless or further down the chain adds to the stack. If the boss can't show the tool right now, it holds the question in the stack and doesn't fall back to plain text.

## Writing one

- **Best option first**, with `(Recommended)` on its label.
- **Each option says what happens and what it costs**, in one plain line.
- **Put the real numbers and the conflict in the question.** The user shouldn't need to open anything.
- Use `multiSelect` when several can be true.
- Name the project in the header when a round mixes projects.
- For a hard-limit action, name the exact action, target and total on the approving option, so the tap approves that and nothing wider. Log the answer word for word.

## Never repeat

Before asking, check the vault's decision log, preferences and defaults. Once something is answered, or a risk is accepted, it's closed. State a real limit once, then do what they said. Ask again only when the facts changed, and say what changed.

## Packets, up the chain

Workers send the packet in `mini-boss-brief.md` to their mini boss. The mini boss answers what it can from the vault and sends the rest up. The top boss merges duplicates, and the answer goes back down the same path, quoted word for word.

Never block on a question. Carry on with everything else, and say in the packet what you'll do meanwhile.

## The stack: up to 100 overnight

When the user is away, questions don't stop work and don't get lost. The top boss keeps them in the note named by `questionQueue` in settings, up to **100**:

```markdown
- [ ] q-142 | <project> | blocks: <what> | worth: <real number or blank> | from: <session>
  <question> -> 1. <best (Recommended)> 2. <option>
```

When the user comes back, ask in rounds of 4 through the tool until the stack is empty:

1. Blockers of the most work or money first, then hard-limit approvals, then the rest.
2. Merge duplicates and drop what the vault or a later answer has settled.
3. After each round, send the answers down and tick them off in the note. Keep going unless the user says stop. What's left stays stacked.

Past 100, don't grow the stack. Merge related questions. For reversible choices, take the recommended option and log it for review. Hard-limit actions are never decided this way. They wait, however long the stack is.

## Waiting on you: nothing sits silently

Every open decision has a dated line in the vault note named by `waitingOnYou` in settings. The stack holds what hasn't been asked yet. This tracker holds everything still open, asked or not, so nothing can quietly go stale.

```markdown
- [ ] opened 2026-01-15 | asked 2026-01-15 | <project> | Start the email warm-up? | waiting-on: user
- [ ] opened 2026-01-15 | asked 2026-01-15 | <project> | Turn on the paid plan? | waiting-on: profit | recheck 2026-03-01
- [x] opened 2026-01-15 | asked 2026-01-16 | <project> | Use the new header? | answered 2026-01-16: "yes"
```

- **Every open decision goes to the user as a clickable yes or no** through the question tool, with the recommended answer first. Use more options only if yes and no don't cover it. Add the line when the decision opens.
- **Remind after about a day.** `fleet.mjs waiting` lists what's due. Ask again through the tool, with how long it's been waiting and what it's holding up, and update `asked`. This is the one case where a repeat is right, because the question was never answered.
- **Pushed back with a label.** Something waiting on a business condition, such as profit, may leave the reminder cycle: put the condition in `waiting-on:`, with a `recheck` date. Say so to the user when you do it. When the date comes, check the condition and report the real state.
- **Only an answer closes a line.** Tick it and quote the answer. A silent user isn't a no or a yes.
- **Report plainly when something didn't happen.** If a planned send, job, deploy or reminder didn't run, say that it didn't, why if known, and what's next. Don't let it vanish, and don't word it as if it's in progress.
