---
name: session-closeout
description: End-of-session bookkeeping for this repo (lean mode) — the phase doc's as-built, the user's decisions in docs/decisions.md, docs/roadmap.md, the Current state block in CLAUDE.md, a new runtime gotcha in the right package CLAUDE.md, memory, and the commit. Use when finishing significant work, at a stage or step completion, or when the user says "wrap up", "close out", "document this", "update the docs", or "commit this session".
---

# Session closeout

Record outcomes, not narration; `git log` holds the details. Writing rules: `docs/docs-writing-guide.md`.

1. **Phase doc:** status line and a few lines of § As built per finished stage (what shipped, commit, test count with
   its command, anything surprising).
2. **Reference docs whose truth changed:** `README.md`, `docs/setup.md`, `docs/e2e-test-plan.md` (rows for new
   `chrome.*` glue).
3. **`docs/decisions.md`:** only what the user ruled or the product now promises (`agent-rules.md` §8). A rule that
   keeps governing goes under Standing decisions.
4. **`docs/roadmap.md`:** move what shipped out of "Ahead"; add new follow-ups. At a step close, add a short block
   to `docs/history.md`.
5. **`CLAUDE.md`:** overwrite the root Current state in place (a few lines). A runtime fact learned the hard way
   becomes one bullet in the `CLAUDE.md` of the code an agent would edit to break it (#232), dated. Update Key files,
   Commands and counts where they changed.
6. **Memory:** only durable feedback or facts the repo doesn't hold. Never status.
7. **At a step close:** `cleanup-pass`.
8. **Commit** (`agent-rules.md` §10). Push only when the user asks.
