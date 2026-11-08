# Agent rules

The rules every agent follows in this repo: the session agent, step agents and executors. A brief points here and lists
only its deviations. **Lean mode** since 2026-11-08 (decisions.md · 2026-11-08 · Lean mode: checks by risk, hand-backs instead of report files, records archived (#446)): check what can
break, skip ceremony.

## 1. Before you start

- `CLAUDE.md` loads at start; each package's `CLAUDE.md` loads the first time you open a file there. Its gotchas are
  measured facts and bind. Touching a package you haven't opened: read its `CLAUDE.md` first.
- Explore and Plan agents load no `CLAUDE.md`: their brief names every file they need.
- Numbers come from a command you ran, never from a brief or a summary.
- **Windows:** Git Bash is the agents' shell; PowerShell 5.1 is present. If `node` is missing from PATH:
  `export PATH="$(cygpath "$LOCALAPPDATA")/Author Software/nvm/.nodejs:$PATH"`. Run anything that can hang in the
  background, with a timeout.
- Old records (step folders, decision archives, past live-run helpers) are in tag `archive/dev-history`:
  `git show archive/dev-history:<path>`. Read them only when a brief asks.

## 2. Integrity floor

- Never invent or estimate a result. Say what did not run. A failed check is reported, never re-tuned until it passes.
- Never weaken a protective check to pass it: a test, a guard, a timeout, the token gate, a lease or lock rule, the
  safety gate, the log scan.
- **Security boundary:** the root `CLAUDE.md` § Invariants (the bind, the token, what product code never logs, the
  safety gate). No agent loosens it.
- **The repo is public:** nothing committed shows the user's tabs, a real site, a path under the user's profile, the
  user's name, or anything typed into the Options page.

## 3. Stop and ask (report and return)

1. Anything outward-facing or hard to undo: push, tag, publish (npm, Web Store, GitHub release), history rewrite,
   deleting outside the repo.
2. Driving the user's real Chrome profile beyond what the phase doc grants (standing grants: Claude runs live fixture
   waves end to end, #33; reloads by `recipes/reload-extension.ps1`, #65). Never restart or kill Chrome without a grant.
3. Loosening the security boundary, or a contract change (wire protocol, SDK public surface, MCP tool names and
   schemas, error codes, the manifest's permissions) that the phase doc does not already decide.
4. A test or guard failing for a reason you can't explain, after one honest attempt.
5. A permission or classifier denial: report it, never work around it.

Anything else: decide, note it in your hand-back, keep going.

## 4. How much checking (by risk)

The phase doc marks each stage **safety** or **ordinary**.

| Stage kind | What it touches | Checks |
|---|---|---|
| **Safety** | the token, pairing, the bind, the safety gate, logging, the manifest's permissions, anything that could expose the browser | builder (Opus) → **one** independent verifier (Opus) → at most **one** fix round; still failing → §3 |
| **Ordinary** | everything else in code: packaging, installers, CLI, rename, refactors | builder writes tests first for logic; `npm run typecheck`, `npm test`, `npm run build` green; the step agent reads the diff. No verifier |
| **Docs** | README, setup, phase doc | one writer; the step agent (or session agent) reads it |
| **Live** | behaviour only real Chrome shows | **one** short checklist run at the end of the step, by Claude, against fixture pages |

No mutation testing, second verifiers, evidence files or kickoff checkers unless the phase doc asks for one by name.

## 5. Roles

- **Session agent:** plans the step with the user, writes the phase doc, runs one step agent per stage (or does a small
  stage itself), writes the as-built, records decisions, asks the user what is theirs. `long-run` skill.
- **Step agent:** owns one stage. May do small work itself; otherwise starts a builder (and, for a safety stage, a
  verifier and a fixer). Reads the diff before accepting. Commits the stage. Hands back a short summary.
- **Executor** (builder, verifier, fixer, live runner): one task, done in one go, never spawns agents, never commits
  unless the brief says so.
  - **Builder:** do the task; pure logic test-first; run typecheck, test, build and quote the result lines.
  - **Verifier:** never the builder. Reads the phase doc itself, re-runs the checks, attacks the security boundary.
    Findings carry severity (CRITICAL / MAJOR / MINOR), `file:line` and the evidence. **FAIL** on CRITICAL or MAJOR;
    MINOR goes into the hand-back and is fixed only if cheap.
  - **Fixer:** fixes the listed findings only; disputes a wrong one with evidence.
  - **Live runner:** runs the checklist, restores the safety state it touched, stops on anything unexpected.

## 6. Models and effort

- **Opus:** the session agent, step agents, safety builders and fixers, every verifier.
- **Sonnet:** ordinary builders, docs writers, live runners.
- **Effort medium** for every agent; every `Agent` call passes `model` and `effort` explicitly.
- A stage bigger than about 600 new lines is split before it starts.

## 7. Hand-back, not report files

- Executors and step agents hand back in chat: **at most ~20 lines**: verdict (DONE / PARTIAL / BLOCKED, or PASS /
  FAIL), commit hash, test count before → after with the command, deviations, decisions the user should see, a new
  runtime fact worth a `CLAUDE.md` bullet.
- No report or evidence files. The session agent writes what matters into the phase doc's § As built (a few lines per
  stage). Commit messages carry the rest.

## 8. Decisions

Only the session agent writes `docs/decisions.md`, and only for what the **user** ruled or what the **product
promises** (a contract, a security rule, a compatibility promise). Build choices go in the commit message. Format:
`docs/docs-writing-guide.md` § Decisions.

## 9. Waiting, and fresh agents

- **Never end your turn while a child agent you started is running**, except the session agent (#286). Wait for the
  completion notice; long jobs run with `run_in_background`, never a foreground sleep loop.
- Fresh agents, never resumed ones (#225): to continue a stage, start a new agent and point it at the commits and the
  phase doc.
- Kill only processes you started; never `chrome.exe`.

## 10. Commits

- Exact file list; never `git add -A`, `dist/`, `bridge.token`, `.env`, `exports/` or screenshots.
- Message `<type>(<scope>): <what>`; types `feat`, `fix`, `docs`, `test`, `chore`, `refactor`. The body says why and
  names any decision recorded.
- End with exactly one trailer, `Co-Authored-By: Claude <model> <noreply@anthropic.com>`, and no `Claude-Session` line.
- Never `git stash`, `git checkout -- <file>` or `git reset` in the main tree. Only the session agent pushes, and only
  when the user asks.
