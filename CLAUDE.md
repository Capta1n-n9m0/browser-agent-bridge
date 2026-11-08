# CLAUDE.md

Guidance for working in this repo. Keep it accurate — update it when the architecture or the gotchas change.
Each package's facts live in its own `CLAUDE.md`, which loads by itself the first time you open a file there; every
subagent follows `docs/agent-rules.md`.

## What this is

A localhost daemon + Chrome MV3 extension, with an MCP server and a TypeScript SDK as its clients, that
lets an AI agent (Claude) or a script drive the user's **real, logged-in Chrome default profile**. Chrome 136 (May 2025) blocked `--remote-debugging-port` on the default
user-data-dir, breaking CDP-against-your-real-profile; this restores it from *inside* the profile via an
extension. Mental model: "Playwright MCP, but pointed at your real logged-in Chrome."

## Current state (2026-11-08: lean mode in place; Step 15 is next)

- **Shipped:** Steps 1–14, public on GitHub (MIT). 25 tools, 27 codes (26 on the wire), 28 router methods. Windows
  install by `npm run setup` / `doctor` / `bridge-update`; also run by others on macOS and on Linux over an SSH tunnel.
- **Renamed Browser Agent Bridge** (#444): the GitHub repo is `browser-agent-bridge` (old URL redirects) and npm
  `browser-agent-bridge` is claimed (org `@browser-agent-bridge`). The name inside code and docs is still
  chrome-agent-bridge until Step 15 renames it.
- **Next: Step 15, distribution** (#445): npm package, extension zip on GitHub Releases plus a public Chrome Web
  Store listing, a fixed extension ID with pairing by native messaging, installers for less technical users, a
  product-first README; released as v0.2.0 (#447). Network mode waits (#443). Phase doc:
  `docs/plans/2026-11-08-step15-distribution.md`; kickoff: `docs/plans/next-session-prompt.md`; v1 meaning open (#448).
- **Lean mode** (#446): checks by risk, hand-backs instead of report files (`docs/agent-rules.md`). The old step
  folders, decision archives, cleanup reports, phase docs and live-run helpers are in tag `archive/dev-history`
  (`git show archive/dev-history:<path>`); code comments and package `CLAUDE.md` files that cite
  `docs/plans/…`, `docs/decisions-archive/…` or removed `recipes/…` files point into that tag.
- **Reloads need no human:** `recipes/reload-extension.ps1` (#65; one re-run on exit 2). Interactive sessions using
  the bridge need `/mcp` or a fresh session.
- Update this block with the `session-closeout` skill when a stage or step completes.

## Architecture

```
Claude ⇄ (MCP/stdio) ⇄ mcp/ ──┐   both are SDK clients: sdk/ connect() finds, spawns or
scripts (tsx) ⇄ sdk/ ─────────┤   hands over the daemon, then hello {token, role:"client",
                              │   name, build, proto:2} → welcome
                              ⇅ ws://127.0.0.1:9234
daemon/ (one per machine, detached, outlives sessions; token gate; holds the one extension socket;
         answers daemon.status / daemon.shutdown / tabs.claim / tabs.release itself; its tab layer
         turns a client's `tab` handle (T<n>) into a numeric tabId, checks the tab's lease, takes the
         FIFO visibility lock for screen-needing calls, then forwards under its own ids)
                              ⇅ JSON {id,method,params:{tabId,…}} / {id,result|error{code,message,data?}}
                                + events tabCreated/tabRemoved/tabReplaced/safetyState  (extension hello: proto:2, session)
  extension/ (loaded unpacked in the real profile):
    offscreen document  → holds the WebSocket (survives MV3 service-worker culling)
    service worker      → routes methods to handlers; uses chrome.tabs/scripting/debugger
    content script      → window.__agentBridge: RefMap + snapshot + locate + DOM actions (ISOLATED world)
```

Flow: tool → `BridgeLink.call` → `BridgeClient.call(method, params, {timeoutMs})` → WS → daemon
(`route.ts`) → extension socket → `GatedRouter` (the safety gate at receipt, again before each first side effect and as
the post-check) → handler → `chrome.*` / `callInPage`. Default actions use synthetic content-script events (no banner);
`browser_click {trusted:true}` (or a content-action failure) escalates to real CDP `Input` via
`chrome.debugger` (shows the "extension is debugging this browser" banner); with `trusted:true` the SDK and,
since Step 10 S2, the MCP call `focusTab` first (#89, #106). Clients name tabs by
daemon-minted **handles** (`T3`), never Chrome ids; one client holds a tab at a time (a **lease**:
opened, claimed, or a popup of a held tab), and a call on another client's tab fails fast with
`TAB_HELD`. The daemon forwards every tab method with a numeric `tabId` and never a `tab` key, and
each handler acts on `targetTab(p)`, in the background. Only a default-mode viewport screenshot and
`focusTab` need the screen; they run under the daemon's one FIFO **visibility lock**. A tab call
with no `tab` is refused `BAD_PARAMS "tab is required"` (network calls excepted: no `tab` means the
human's tab). The MCP keeps a **cursor** (`mcp/src/cursor.ts`; its rule: `mcp/CLAUDE.md`). A script uses the SDK's typed `Tab` (`client.newTab()` / `claim()`; the
client's own cursor is `client.tab()`): its actions take a ref or a **locator** (`{role, name}`,
`{text}`, `{css}`), resolved in the content script by the snapshot's own walk, and a failure on the
page carries a **failure report** (snapshot, screenshot, network). Network capture is separate and always on: six top-level
`chrome.webRequest` observers feed a bounded per-tab `NetworkLog` (no banner, no debugger), which
`browser_network_requests` / `browser_network_clear` query.
Since Step 9 every router method runs through one safety gate (`extension/src/safety.ts`, served by
`GatedRouter`): the human's kill switch, JavaScript switch, block list and Upload folders are enforced in the
extension, read from `storage.local` per call, and no wire, daemon or SDK method can change them; since Step 11 the
gate also refuses every call on a `file:` page; the network log
records nothing while disarmed and drops blocked hosts. The daemon only relays the state
(`safetyState` → `safetyStatus`, `daemon.status.safety`) and withholds URLs/titles while disarmed.

### Where the code is
One `CLAUDE.md` per package holds its Key files (file by file) and its Runtime gotchas (measured facts; they bind).
- `shared/` — the wire protocol types and guards, the error codes (`shared/CLAUDE.md`).
- `daemon/` — the one-per-machine daemon: bind lock, token gate, handles, leases, the visibility lock (`daemon/CLAUDE.md`).
- `sdk/` — the TypeScript client: `connect`, `BridgeClient`, `Tab`, failure reports, the formatters (`sdk/CLAUDE.md`).
- `mcp/` — the MCP server as an SDK client: the 25 tools, the cursor, the no-crash link (`mcp/CLAUDE.md`).
- `extension/` — the Chrome MV3 extension: service worker, offscreen socket, content script, handlers, the safety gate
  (`extension/CLAUDE.md`; deeper files in `extension/src/` (redirects, DNR, `file:` pages, uploads), `extension/src/content/`,
  `extension/src/evaluate/`, `extension/src/handlers/`).
- `scripts/` — the setup, doctor and update commands, their tests, `examples/` (`scripts/CLAUDE.md`).
- `recipes/` — scripts and live-run helpers, and the facts about driving Chrome and Windows tooling (`recipes/CLAUDE.md`).

## Invariants that bind every package
Details and measured facts are in the package file named; the integrity floor is `docs/agent-rules.md` §2.
- Bind only `127.0.0.1`; the bind is the lock, so the daemon is the one owner of port 9234 (`daemon/CLAUDE.md`).
- The token is a password: never committed (`bridge.token` and `.env` are gitignored), printed or logged.
- Product code never logs a URL, title, header value, body, path, locator text, evaluated value or block-list pattern;
  `extension/test/log-scan.test.ts` allowlists every log site (`extension/CLAUDE.md`).
- Every extension router method passes the safety gate, and nothing on the wire changes the safety state
  (`extension/CLAUDE.md` and `extension/src/CLAUDE.md`, Safety gate).
- A new extension method enters both `METHOD_CLASSES` (`extension/src/safety.ts`) and `daemon/src/methods.ts`.
- Clients name tabs by daemon-minted handle (`T3`), never by Chrome id; a tab call without `tab` is refused
  (`daemon/CLAUDE.md`).
- Bulk data moves in slices: one WebSocket frame over 100 MiB closes the extension socket (`daemon/CLAUDE.md`).
- Pure logic is written test-first; `chrome.*` glue is covered by `docs/e2e-test-plan.md` (Testing philosophy).

## Commands

```bash
npm install
npm run build        # daemon/dist/index.js + mcp/dist/index.js + extension/dist/{sw,options,offscreen,content}.js
npm test             # vitest — 4112 passed (`npm test` 2026-11-08, after the archive; recipes/test and scripts/test included)
npm run typecheck    # tsc across shared/daemon/sdk/mcp/extension/scripts (chained with `&&`; see the cross-package gotchas below)
npm run recipe -- recipes/<file>.ts [args]   # a script against the SDK, run with tsx (= npx tsx recipes/<file>.ts)
npm run setup        # one-command install on a Windows device; `-- --dry-run`, `-- --replace-mcp` (`scripts/CLAUDE.md`)
npm run doctor       # one line per part, read-only (`scripts/CLAUDE.md`)
npm run bridge-update  # pull, rebuild, reload the extension; `-- --no-reload` (`scripts/CLAUDE.md`)
npx tsc --noEmit -p recipes/tsconfig.json # recipes typecheck separately (exit 0, 2026-11-08)
```
Load the extension: `chrome://extensions` → Developer mode → Load unpacked → `extension/`, then set the
token + port `9234` in its Options. The MCP config points at `<repo>/mcp/dist/index.js`; nobody starts
the daemon by hand (the first client spawns it). The token comes from `BRIDGE_TOKEN`, else `bridge.token`
at the repo root (gitignored). Full setup + the tools + "Writing a script": `docs/setup.md`. After `npm run build`, reload the extension (on Windows `recipes/reload-extension.ps1` does it by UI Automation; `docs/setup.md` Manual install §4). New devices start at "Install on a new device", the first section of `docs/setup.md`; a script outside the repo: `examples/list-tabs.ts`.
E2E: serve `test-fixtures/e2e-playground.html` (`python -m http.server 8080 --directory test-fixtures`)
and follow `docs/e2e-test-plan.md`.

## Gotchas that cut across packages
- **Editing extension code requires a manual reload**: `npm run build` then `chrome://extensions` →
  reload ↻. The service worker won't pick up `dist/` changes otherwise — **not even after a full Chrome
  restart** (seen 2026-10-06: a restarted Chrome still ran the old worker and answered the new
  server's `downloadStart` with `unknown method`). An `unknown method: X` error means exactly this; a
  pre-Step-7 extension (its hello has no `proto`) gets every tab call refused by the daemon with
  `VERSION` and a reload hint (decisions.md · 2026-10-22 · A stale extension is refused for tab calls,
  detected by its hello); `unknown method: locate` names a pre-Step-8 extension. MCP
  changes need an MCP reconnect (`/mcp`) or a fresh session; daemon changes take effect when the next
  client connects after `npm run build` (the build-id handover, `daemon/CLAUDE.md`) — a `/mcp` reconnect is one.
- **`npm run typecheck` chains the projects with `&&`** (root `package.json`), so a type error in one
  package hides the later packages' results; when another stage's work is in flight, run `tsc -p
  <pkg>/tsconfig.json` per package (S2b builder and fixer; S2b.md gotcha candidates).
- **A scratch worktree never shares `node_modules` through a junction.** A recursive delete of a worktree
  followed a `node_modules` junction and emptied the main tree's `node_modules/.bin` and `@asamuzakjp` (Step 10
  S4b, observed by its verifier; repaired by `npm ci`). Run `npm ci` in the worktree, or remove a junction only
  with `cmd /c rmdir <link>` before `git worktree remove` — never `rm -rf` / `Remove-Item -Recurse` across it
  (decisions.md · 2026-10-25 · Scratch worktrees never share `node_modules` through a junction a recursive delete
  can follow (#220); S4b.md Findings 1). Its own `npm ci` still leaves `node_modules/@bridge/*` junctions: remove them
  first (`recipes/CLAUDE.md`, Run 19's helper facts; #364, #365).

## Testing philosophy

Logic units (protocol, WS correlation, bridge, handshake, the daemon's registry/routing/lifecycle/log,
the SDK's knock/client/connect over injected I/O and clocks, the MCP link, RefMap, snapshot, actions,
geometry, tools, inject helpers, the `NetworkLog` reducer/query, the daemon's handles/leases/lock/
tab layer, the extension's error mapping and tab events, the MCP cursor, the SDK formatters, Step 9's safety gate, block-list matcher, state store, badge model and
options model, Step 10's save store, save sources and the SDK's file finish) are
**TDD with real assertions**; `mcp/test/multi-actor.test.ts` runs a real daemon + SDK + MCP against a
fake proto:2 extension on port 0.
Socket tests bind port 0, never 9234. The `chrome.*` glue (service worker,
chrome-API handlers) is **not unit-tested** — mocking the extension runtime is low-value; it's covered
by `docs/e2e-test-plan.md` against real Chrome. New pure logic → write a failing test first.

## Conventions

- Commits end with exactly one trailer, `Co-Authored-By: Claude <model> <noreply@anthropic.com>` for the model that
  wrote them, and no `Claude-Session:` line (the user's instruction since Step 10 S7).
- Don't commit the token (`bridge.token`, `.env` are gitignored). The localhost bind + token are the
  only security boundary — treat the token as a password; never log it.

## Skills (project skills in `.claude/skills/`, lean mode)
- Rules for every agent: `docs/agent-rules.md`. Briefs point to it and never paste rules, spec text or numbers.
- `long-run` — the session agent: the chain session agent → step agent → executor, decisions while the user is away,
  the end of a step.
- `step-agent` — the step brief and the executor brief.
- `phase-kickoff` — the phase doc (`template-phase.md`) and `docs/plans/next-session-prompt.md`.
- `session-closeout` — as-built, decisions, roadmap, Current state, gotchas, memory, commit.
- `cleanup-pass` — one agent runs `node scripts/doc-check.mjs` and fixes; once per step.
- Writing rules for every doc: `docs/docs-writing-guide.md`.

## Docs
`README.md` (the product), `docs/specs/` (design of record), `docs/plans/` (the current phase doc and the kickoff),
`docs/agent-rules.md`, `docs/decisions.md` (the user's rulings and product promises), `docs/roadmap.md` (what's next),
`docs/history.md` (how we got here), `docs/docs-writing-guide.md`, `docs/setup.md` (install/usage),
`docs/e2e-test-plan.md` (manual suite + fixture). Older records: tag `archive/dev-history`.
