---
name: cleanup-pass
description: Keep this repo's docs true and small (lean mode) — run scripts/doc-check.mjs, fix dead paths, stale counts and status text, keep CLAUDE.md files within budget, and propose anything bigger to the user. Use once at a step close, or when the user asks to "clean up the docs", "check the docs", or "run the cleaner".
---

# Cleanup pass

One agent, no area cleaners, no report file. Writing rules: `docs/docs-writing-guide.md`.

1. Run `node scripts/doc-check.mjs`. Read `git diff <last cleanup commit>..HEAD --stat` (find it with
   `git log --grep "cleanup pass" -1`) and the docs it touched.
2. Check: the root Current state matches `docs/roadmap.md` and `git log`; each gotcha sits with the code it binds,
   once; skills and briefs point instead of pasting; `README.md`, `docs/setup.md` and the specs still match what was
   built; `docs/decisions.md` Standing decisions still hold.
3. **Fix the mechanical things yourself:** dead paths, stale counts, status text outside the root `CLAUDE.md`, a
   duplicate replaced by a pointer.
4. **Propose, don't apply:** deleting or rewriting a decision, a `CLAUDE.md` rule or plan content. List these for the
   user.
5. Commit `docs: cleanup pass <date>`; the body lists what was fixed and what was proposed.
