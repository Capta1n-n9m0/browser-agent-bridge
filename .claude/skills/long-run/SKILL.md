---
name: long-run
description: The session agent's contract for a build step in this repo (lean mode) — plan with the user, run one step agent per stage, record the as-built and the user's decisions, close the step. Use when orchestrating a step or phase, launching anything that spans hours or sessions, or resuming one.
---

# Long run (session agent)

Rules for every agent: **`docs/agent-rules.md`** (lean mode). Briefs: **`step-agent`**. Starting the next step:
**`phase-kickoff`**. Closing: **`session-closeout`**.

## The chain

| Level | Who | Does |
|---|---|---|
| 0 | **Session agent** (you) | phase doc, stage split with a risk kind each (`agent-rules.md` §4), one step agent per stage, the as-built, decisions, the user's questions |
| 1 | **Step agent** | owns one stage: does it or delegates it, reads the diff, commits, hands back ~20 lines |
| 2 | **Executor** | builder / verifier / fixer / live runner: one task, done in one go |

- **Small stage (under ~150 lines, or docs): do it yourself** or give it to one step agent that does it itself.
  Three levels only when a stage is big or safety-critical.
- Stages run one after another; two at once only on separate files with no shared port. Only one thing owns port
  9234 at a time.
- Pass `model` and `effort` on every `Agent` call (`agent-rules.md` §6). You may end your turn while a step agent runs.

## While the user is away

- **Build choices:** decide and continue; they go in commit messages.
- **Contract or security questions with no rule in the phase doc:** take the conservative option (security at least as
  strict, existing behaviour unchanged, undoable), note it for the user, keep going.
- Stop only for `agent-rules.md` §3.

## Revival

A step agent that stops without handing back: start a fresh one pointed at the phase doc and `git log`. Never redo
committed work.

## End of step

1. The phase doc's exit checks, one line each, in § As built.
2. `session-closeout`, then `phase-kickoff` for the next step if the user named it.
3. Tell the user: what shipped, decisions taken while they were away, what needs them (push, publish, reload, a
   ruling).
