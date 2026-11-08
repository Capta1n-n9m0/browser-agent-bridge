---
name: phase-kickoff
description: Write the phase doc and the short prompt that starts the next build step in this repo (lean mode). Use at a step close, when pausing mid-step (resume point), or when the user asks for a "next session prompt", "kickoff", or "prompt for the next step".
---

# Kickoff

**The phase doc carries the work; the prompt only points at it.** Rules live in `docs/agent-rules.md`, the session
agent's side in `long-run`, measured facts in the package `CLAUDE.md` files. Never restate them.

## 1. The phase doc: `docs/plans/<date>-step<N>-<name>.md`

Template: [`template-phase.md`](template-phase.md). It holds: why, the outcome, the decisions it builds on (date +
title), the stages with a **kind** each (safety / ordinary / docs / live, `agent-rules.md` §4) and a size, the exit
checks, what needs the user (publish, push, accounts, rulings), and an empty § As built. Keep it under ~250 lines.

## 2. The prompt: `docs/plans/next-session-prompt.md` (overwrite)

At most ~300 words:
1. "You are the SESSION AGENT for Step N — <title>. Follow the `long-run` skill." Say whether the user is around or
   away.
2. First checks: `git status` clean, `npm test` and `npm run build` green (quote the counts), port 9234.
3. Read: the phase doc, then the files it names.
4. What needs the user's hands in this step.

## 3. Resume point (pausing mid-step)

Write the state into the root Current state (done, next stage, open questions) and the phase doc's § As built. The
prompt gets one line: "Resume: read Current state and the phase doc's § As built first."

## 4. Check and commit

Every path cited exists; every decision cited exists under that date + title. Commit with the closeout, or alone as
`docs: Step <N> kickoff`.
