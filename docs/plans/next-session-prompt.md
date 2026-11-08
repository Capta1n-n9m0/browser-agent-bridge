# Next session: Step 15 — Distribution (v0.2.0)

You are the SESSION AGENT for Step 15 of Browser Agent Bridge. Follow the `long-run` skill (lean mode). The user is
around for rulings; ask them only what the phase doc lists under "Needs the user".

**First checks**
1. `git status` is clean and `main` matches `origin/main`.
2. `npm test`, `npm run typecheck` and `npm run build` are green; quote the test count.
3. Nothing but the daemon holds port 9234.

**Read**
1. `docs/plans/2026-11-08-step15-distribution.md`: the work, the stages, the exit checks.
2. `docs/agent-rules.md`: how much checking each stage kind gets.
3. The decisions it cites in `docs/decisions.md`.

**Order**
Get U1 (the proposed decisions and v1, #448) from the user first, then run S0 (facts first). Report S0's findings
before S2. Item 2 decides how the store build treats `browser_evaluate`.

**Needs the user's hands in this step:** the Web Store draft upload and the public key (U2), the store submission
(U3), npm trusted publishing or a hand publish (U4), Claude Desktop and the macOS/Linux checklist runs (U5), and
approval of every push, tag and publish.
