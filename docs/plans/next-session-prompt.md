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
U1 is done (#448, #449). Start with S0 (facts first) and report its findings before S2. When a stage needs the
user's hands, ask with numbered step-by-step instructions (#449).

**Needs the user's hands in this step:** the Web Store draft upload and the public key (U2), the store submission
(U3), npm trusted publishing or a hand publish (U4), Claude Desktop and the macOS/Linux checklist runs (U5), and
approval of every push, tag and publish.
