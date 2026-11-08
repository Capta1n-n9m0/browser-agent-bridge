---
name: step-agent
description: Brief templates for this repo's lean agent chain — the STEP BRIEF the session agent hands a step agent and the EXECUTOR BRIEF a step agent hands a builder, verifier, fixer or live runner. Use when spawning a step agent or an executor, or when acting as one.
---

# Step agent kit

Rules: **`docs/agent-rules.md`**. The session agent's side: **`long-run`**.

**A brief points, it doesn't paste:** no rules, no spec or phase-doc text, no copied numbers. Over ~400 words means
something was pasted. Briefs are not saved as files.

## STEP BRIEF (session agent → step agent)

```
You are the STEP AGENT for stage <STAGE> ("<plain name>") of Step <N>, browser-agent-bridge.
Read docs/agent-rules.md first. You never end your turn while a child agent you started is running.
KIND: safety | ordinary | docs | live (agent-rules.md §4 sets the checks).
GOAL: <what and why, a few sentences>.
READ: <phase doc § stage>, <spec §§ if any>.
DONE WHEN: <the phase doc's exit checks for this stage>.
LANE: <files/packages it may change>.
DEVIATIONS: <or "none">.
Commit the stage yourself; hand back per agent-rules.md §7.
```

## EXECUTOR BRIEF (step agent → builder / verifier / fixer / live runner)

```
ROLE: <builder | verifier | fixer | live runner> — stage <STAGE> of Step <N>, browser-agent-bridge.
Read docs/agent-rules.md first (§5, your role).
GOAL: <one paragraph>.
READ: <same list as the step brief>. Verifier: + "the builder's claims: <its hand-back, pasted>".
  Fixer: + "findings: <the verifier's findings, pasted>".
DONE WHEN: <checks>.   LANE: <files>.   SIZE: <~lines, builder only>.
Commit: no (the step agent commits). Hand back per agent-rules.md §7.
```

A verifier gets the same READ list as the builder and reads the phase doc itself; the builder's hand-back is claims to
check, not facts.
