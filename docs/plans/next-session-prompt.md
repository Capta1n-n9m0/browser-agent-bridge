# Next session: Step 15 — Distribution (v0.2.0), resumed at S2

You are the SESSION AGENT for Step 15 of Browser Agent Bridge. Follow the `long-run` skill (lean mode). The user is
around for rulings; ask them only what the phase doc lists under "Needs the user".

**Resume:** read Current state in `CLAUDE.md` and the phase doc's § As built first. S0, S1 and U4 are done. S2 is next:
start it with a fresh step agent, never a resumed one.

**First checks**
1. `git status` is clean. `main` is ahead of `origin/main` by unpushed Step 15 commits; push only with the user's approval.
2. `npm test`, `npm run typecheck` and `npm run build` are green; quote the test count (4123 after S1).
3. Nothing but the daemon holds port 9234.

**Read**
1. `docs/plans/2026-11-08-step15-distribution.md`: the work, the stages, the exit checks, § As built.
2. `docs/agent-rules.md`: how much checking each stage kind gets (S2 is a safety stage).
3. The decisions it cites in `docs/decisions.md`.

**Open ruling: U6, the license.** If the user has ruled, record it in `docs/decisions.md` and change `LICENSE`, every
`package.json` `license` field and the README before S2 builds the package. If not, ask before S2's package is final.

**Order**
S2, then report its result before S3. When a stage needs the user's hands, ask with numbered step-by-step
instructions (#449).

**Needs the user's hands in this step:** the license ruling (U6), the Web Store draft upload and the public key (U2),
the store submission (U3), Claude Desktop and the macOS/Linux checklist runs (U5), `npm run setup` for the renamed MCP
entry, and approval of every push, tag and publish.
