# How we got here

This is the short story of how the bridge was built, for someone new to the repo.
It was written from the project's progress records and decision log on 2026-11-08.
The full records (step folders, decision archives, cleanup reports) are kept in the git tag `archive/dev-history`.
Read any file there with `git show archive/dev-history:<path>`.

## The idea

Chrome 136 (May 2025) blocked `--remote-debugging-port` on the default user-data-dir.
That broke the usual way to drive your real, logged-in Chrome from a tool.
This project brings the ability back from inside the profile, with an extension.
The mental model: "Playwright MCP, but pointed at your real logged-in Chrome."

Parts that exist today:

- a localhost daemon that owns the one WebSocket port,
- a Chrome MV3 extension loaded unpacked in the real profile,
- an MCP server (25 tools) and a TypeScript SDK, both clients of the daemon.

## The first build (2026-06)

Milestones 0 to 5 built the base.

- A shared protocol, a WebSocket host with a token handshake, and an MCP entry point.
- A Chrome extension with an offscreen document that holds the socket, so the service worker can be culled without dropping the link.
- Perception: an accessibility-style snapshot with element refs, and screenshots.
- Actions: click, type, scroll, hover, select, press key, tabs and history.
- A fallback to real (trusted) input through `chrome.debugger`.
- `browser_wait_for`.

The first live run in real Chrome (2026-06-04) passed 29 cases.
It found three bugs that unit tests could not:

- the MCP server crashed on a busy port,
- `scroll` with no ref crashed on a value Chrome cannot serialise,
- a stale ref silently "succeeded" because Chrome returns `null` when an injected function throws.

The lesson stayed with the project: the real browser finds bugs that mocks do not.

## Phases C, D and B (Steps 1 to 3, 2026-09-03)

The first three plans were named by phase letters. They were run live on the same day.

- **Step 1, Phase C, perception fidelity.**
  - The snapshot now enters open shadow roots and same-origin iframes.
  - It prunes hidden subtrees and lists more roles.
  - Clicks use frame-correct coordinates.
  - All 13 live cases passed first time.
  - Closed shadow roots and cross-origin frames stay out of reach.
- **Step 2, Phase D, action fidelity.**
  - Trusted typing and `press_key` go through real CDP key events.
  - Two live-only bugs were found. A "." was swallowed because its character code equals the Delete key code. The trusted path never scrolled its target into view.
  - A zoom test showed that CDP input needs no coordinate scaling. Chrome folds in page zoom and pixel ratio itself.
- **Step 3, Phase B, robustness.**
  - A busy port is reported clearly and retried.
  - `browser_status` and a socket heartbeat were added.
  - Debugger errors became readable.
  - A 9.5 minute idle test showed the keepalive holds.
  - DevTools docked on a tab does not stop the extension's debugger on Chrome 152, so the planned "one debugger per tab" conflict did not occur.

## Steps 4 and 5 (2026-09-07)

- **Step 4, `browser_evaluate`.** Runs JavaScript in the page through CDP `Runtime.evaluate`, with a serialiser and a server-side timeout.
  - It works on pages whose own CSP forbids `eval`, which is why CDP was chosen over `executeScript`.
  - A live bug: a result that was itself a promise came back empty. A second await fixed it.
  - Evaluate needs the debugger, so it shows Chrome's "debugging this browser" banner.
- **Step 5, network inspection.** `browser_network_requests` and `browser_network_clear` read an always-on log fed by `chrome.webRequest` observers. There is no banner and no debugger.
  - The log is bounded per tab and written through to session storage.
  - Cookie headers never reach the extension. Live on a logged-in site, no cookie or set-cookie header appeared.
  - Response bodies are not captured.
  - `browser_wait_for` gained a network-idle mode.

## Step 6: daemon, SDK, and the MCP as a client (2026-10-21 to 22)

The single-owner MCP server was split into packages: `shared`, `daemon`, `sdk`, `mcp`, `extension`.

- One detached daemon per machine, started by whoever connects first. It exits when idle and hands over when a newer build connects.
- A token gate, roles, a welcome message and error codes.
- The SDK's `connect()` finds, spawns or takes over the daemon. The MCP became an SDK client.
- Protocol version 2.
- Several Claude sessions and scripts can now share one Chrome.

Decision that still matters: the daemon binds `127.0.0.1` only, and the bind itself is the lock.

## Step 7: multi-actor tabs (2026-10-22 to 23)

- Every tab call carries a tab id. The daemon names tabs by handles (`T3`); clients never see Chrome ids.
- A client holds a tab through a lease. A call on another client's tab fails fast with `TAB_HELD`.
- A call that needs the screen (a default-mode screenshot, `focusTab`) waits in one FIFO visibility lock.
- Results became data, formatted in the SDK. `browser_focus_tab` was added, and the MCP gained a cursor (its "current tab").

Live finding: CDP input into a background tab silently does nothing.

## Step 8: the SDK surface (2026-10-23 to 24)

- Locators: `{role, name}`, `{text}`, `{css}`, resolved by the snapshot's own walk.
- A typed `Tab` object, `waitFor` on an element, and `evaluate` that returns a ref.
- Failure reports: when an action fails, the error carries a snapshot, a screenshot and the network log.
- `browser_use_active_tab`, and the first recipes.

Decision that still matters: trusted actions bring the tab to the front first ("focusFirst"). A live test showed that CDP focus emulation does not deliver input to a background tab.

## Step 9: Phase E, safety (2026-10-24)

The human, not the agent, controls what the agent may do.

- A kill switch (toolbar button, `Alt+Shift+K`, options page). While off, every page call is refused `DISARMED`.
- A separate JavaScript switch. Refusals use the code `JS_DISABLED`, added in Step 10.
- A block list, empty by default. A blocked site answers `DOMAIN_BLOCKED`.
- One gate in the extension covers every router method. Nothing on the wire can change the safety state.
- No log line holds a URL, a title or the token; a test scans for this.

Decision that still matters: an allow-list mode was turned down.

## Step 10: the Step 8 follow-ups (2026-10-25)

- The MCP's trusted tools now focus the tab first, as the SDK's did.
- A warning appears when a locator resolves past the 800-element snapshot cap.
- `browser_evaluate {saveTo}` writes a value of up to 256 MiB to a file, in 1 MiB slices.
- Live re-measurements of Step 9: a disarm ends a running trusted action within about 5 ms, and the banner is gone about 5 seconds later.

## Step 11: file upload (2026-10-25 to 26)

- `browser_upload_file` puts files into a file input through CDP, in the background.
- A human-held "Upload folders" list on the options page. It is empty by default and only that page can write it.
- A refusal is the code `UPLOAD_REFUSED`.
- The bridge never opens or acts on `file:` pages.
- Live run: 19 pass, 3 fail, 3 not measured, 4 record. The three fails were a measuring-helper weakness and an unexplained slow case, not product bugs.

## Step 11b: redirects and the block list (2026-10-26 to 27)

- Temporary `declarativeNetRequest` rules, built from the block list, stop a redirect hop onto a blocked host during a bridge navigate, new tab, back, forward or download. This needed a new Chrome permission.
- A live run showed the hop is never sent.
- `back` and `forward` only reach pages that a human or an activating call acted on. That is Chrome's rule, not a bridge defect.

## Step 12: Phase F, ergonomics (2026-10-27 to 29)

- `browser_evaluate {args}`, so data need not be escaped into the code string.
- `browser_console_messages` reads the page console from Chrome's replay.
- A kept debugger session per tab, which detaches after 5 seconds idle.
- Upload through the native file chooser (`chooser: true`).
- A trusted input holds the visibility lock across its focus.
- An old extension is refused with `VERSION`, using a feature list in its hello.

Live runs: Run 18 had 6 pass and 6 fail of 13 rows; Run 19 had 42 pass and 5 fail of 58. Most failures were weak test helpers, and the real ones went into Step 13.

## Step 13: the Phase F follow-ups (2026-10-29 to 30)

- A popup opened by a background tab is leased to the holder of its opener. This used a new permission, `webNavigation`, which the user granted.
- `evaluate` returns values in the page's own key order.
- The console cap keeps the newest lines and says what it dropped.
- A second chooser upload gets its own text, and the lock is freed when the settle pause fails.

Live finding (Run 20): with a fully covered Chrome window, a screenshot can time out after about 35 seconds. It works in about half a second when the window is uncovered. This is still open.

## Step 14: Phase G, own devices (2026-10-30)

Minimal packaging for the user's other Windows devices.

- `npm run setup` is one command to install and register the MCP server.
- `npm run doctor` prints one line per part, read-only.
- `npm run bridge-update` pulls, rebuilds and reloads the extension.
- Scripts can run from any folder through a `file:` dependency on the SDK.
- The failure report's screenshot path shows the home folder as `~`.
- A rehearsal on a scratch clone passed, and the doctor printed 7 of 7 OK.

Decisions that still matter: the token reaches the extension through the clipboard and is never printed. The MCP entry is added with `claude mcp add` at user scope.

## Step 15: distribution, v0.2.0 (2026-11-08)

Browser Agent Bridge for people who don't clone the repo.

- Renamed in code and docs; one npm package `browser-agent-bridge` (daemon, MCP server, SDK, doctor, native host).
- A fixed extension ID from the store's key, and pairing through a native messaging host: no token typed.
- Setup and doctor on Windows, macOS and Linux; CI on all three; a release pipeline on `v*` tags (GitHub Release, npm by trusted publishing).
- License AGPL-3.0-only, the SDK Apache-2.0 (#450). A product-first README, `docs/security.md`, `docs/privacy.md`.
- v0.2.0 released on GitHub and npm; the Web Store listing submitted by hand (Chrome lets no extension script the store), under review.

Decisions that still matter: the store zip drops `key`, the release zip keeps it; Claude Code is the supported route, the `.mcpb` a preview.

## What the product is now

- 25 tools, a daemon, an SDK, an MCP server and an extension.
- The safety model above, enforced in the extension.
- Public on GitHub under AGPL-3.0-only (the SDK Apache-2.0), on npm as `browser-agent-bridge`, the Web Store listing under review.
- See `docs/roadmap.md` for what is next.

## How we worked

- **Steps were built by a tree of agents.** A session agent ran a step. It sent builders to write code, verifiers to check it and fixers to repair it. Stronger models wrote contract and safety code and ran the verifiers. Cheaper models wrote recipes, fixtures, docs and live runners.
- **Every step began with an audit** of the plan against the code, then ran in small stages, each with a verifier's verdict.
- **Live E2E waves ran in real Chrome.** Claude drove its own sessions, Chrome and the Windows UI end to end, including extension reloads. The suite was mostly written as numbered rows with expected results. Many runs ended with some rows marked fail or "not measured", and the next step fixed them.
- **Decisions were written down.** About 442 dated entries record what was decided, why, and what was chosen against. Some were ruled by the user at a gate at the end of each step. Open ones were written in plain language and grouped for the user.
- **Pure logic was written test-first.** The `chrome.*` glue was covered by the manual E2E plan against real Chrome, not by mocks.
- **On 2026-11-08 the process was slimmed to "lean mode."** The step folders, decision archives, cleanup reports and phase documents were archived in the tag `archive/dev-history`. Only the current docs stay in the tree. To read an old record, run `git show archive/dev-history:<path>`.
