# Docs Writing Guide

How we write docs here. The goal is a small record that stays true, not a pile that keeps growing (lean mode since
2026-11-08).

## Where things live (one source of truth each)

| Place | Holds |
|---|---|
| `README.md` | the product: what it is, who it's for, install, the security model in plain words, a short development section |
| `CLAUDE.md` (root) | the architecture map, a short **Current state**, commands, the invariants every package keeps, conventions |
| `<package>/CLAUDE.md` | that package's Key files and **Runtime gotchas**; a gotcha lives with the code an agent would edit to break it, other packages get a one-line pointer (#232) |
| `docs/agent-rules.md` | the rules for every agent; briefs point to it |
| `docs/specs/` | the design of record: what and why |
| `docs/plans/<date>-step<N>-*.md` | one phase doc per step: plan, stages, exit checks, a short § As built. No steps folder |
| `docs/plans/next-session-prompt.md` | the prompt that starts the next step |
| `docs/decisions.md` | what the user ruled and what the product promises |
| `docs/roadmap.md` · `docs/history.md` | what's next · how we got here, one short block per step |
| `docs/setup.md` · `docs/e2e-test-plan.md` | install and usage · the manual test suite |
| tag `archive/dev-history` | the old step folders, decision archives, cleanup reports and live-run helpers (`git show archive/dev-history:<path>`) |
| Memory (outside the repo) | cross-session feedback and facts the repo doesn't hold |
| `git log` | the details: what changed and why, so commit bodies say why |

Don't duplicate across these; point instead.

## Rules

1. **Update before you create.** The active phase doc first, then the reference doc whose truth changed; a new doc
   only for new work.
2. **Keep it short.** Raw logs are never committed. Word budgets for `CLAUDE.md` files and skills are in
   `scripts/doc-check.mjs`.
3. **Every number cites the command that produced it** (`npm test` → 4112 passed).
4. **Edit in place.** No "Superseded" markers and no growing "Update" sections; history is in `git log`.
5. **Write plainly.** Short sentences. Spell out abbreviations on first use. No internal codes a reader would have to
   look up.
6. **Measured facts stay measured.** A gotcha states what was observed, where and when.
7. **The repo is public.** No tokens, private hostnames, personal URLs, captured page content, local absolute paths
   or the user's name (write `<repo>`, `~`). `LICENSE` keeps the name; the clone command keeps the public GitHub URL.

## Decisions

`docs/decisions.md`, newest first, only for what the user ruled or the product promises:

```markdown
### 2026-11-08 · <plain title> (#N)
**Decided:** One or two plain sentences.
**Why:** The reason.
**Instead of:** What we turned down. (optional)
**Revisit if:** What would reopen it. (optional)
**By:** user | Claude
```

Cite by date and title. A decision waiting for the user goes under **Open decisions** with options and a
recommendation; one that keeps governing gets a line under **Standing decisions**.

## Style

Present tense for what code does, past tense for what happened. Backticks for paths, flags, config keys and
functions. Tables for comparisons.
