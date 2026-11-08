# sdk/ — Key files and runtime gotchas

The root `CLAUDE.md` and `docs/agent-rules.md` also apply.

## Key files
- `sdk/src/`: `index.ts` (public surface, exactly eight values: `connect`, `BridgeClient`, `Tab`,
  `BridgeError`, `ErrorCodes`, `downloadToFile`, `formatSnapshot`, `formatNetwork`; the rest are
  types), `connect.ts` (`connect({name, failureReports?, …})`), `knock.ts` (knock/spawn/handover state
  machine), `client.ts` (`BridgeClient`: calls, events, 4002 reconnect; Step 8's `newTab`, `claim`,
  `tab()` — the cursor, `NO_CURSOR` without one — `tabs()` (rows carry `hidden?`, Step 9), Step 9's `safety()`
  and `on("safetyStatus")`, Step 10's `on("warning")` (a `BridgeWarning {tab, method, kind: "pastSnapshotCap"}`,
  #206), and the cursor's `Tab` methods mirrored but
  `close`), `tab.ts` (Step 8 `Tab {handle}`: navigate…release, stale after a 4002 reconnect →
  `TAB_UNKNOWN` with no call; Step 10's `evaluateToFile` and the type `BridgeWarning`; Step 12's `consoleMessages`,
  `upload(…, {chooser})` and `{args}` on `evaluate`, `evaluateRef`, `evaluateToFile` — `sdk/test/s12-upload-chooser.test.ts`,
  `mcp/test/s12-args-cross.test.ts`), `evaluate-save.ts` (Step 10
  S4: `saveEvaluateToFile` — the target checks, `.part` opened `"wx"`, 1 MiB pulls, the hard-link finish,
  `SAVE_TRANSFER_MS`; re-exported with `checkSaveTarget` on the `@bridge/sdk/download` subpath; #207, #218),
  `locator.ts` (`Target = ref | Locator`, `normalizeTarget`), `error.ts`
  (failure reports: the attach set, the 5 s budget, `report()`; Step 9's `safetyRefusalLine` — one plain line
  for `DISARMED`/`DOMAIN_BLOCKED` and, since Step 10 S4b, `JS_DISABLED` (#219), no report — re-exported by
  `report.ts`), `report.ts` (the `@bridge/sdk/report`
  subpath: `attachContext` for the MCP), `policy.ts` (`TRUSTED_INPUT_POLICY = "focusFirst"`),
  `transport.ts` (the `ws` socket), `spawn.ts`,
  `adopt.ts` (Step 15 S3: the knock's adopt-or-hand-over rule over the daemon record), `paths.ts` (daemon path: `BRIDGE_DAEMON`, else `<package>/dist/daemon.js` inside the installed npm package, else the
  clone's `daemon/dist/index.js`), `token.ts` (`resolveToken`: `BRIDGE_TOKEN`, then the per-user `bridge.token`
  (`userTokenFile`), then a clone's `bridge.token` — skipped inside the installed package (`findPackageRoot`), #449;
  `findFileToken` is the files-only half the doctor uses; also used by the daemon and by scripts outside the repo through
  a `file:` dependency, `examples/list-tabs.ts`, #430),
  `download.ts` (`browser_download`'s client half: target path, chunked pull, atomic write, sha256),
  `upload.ts` (Step 11: `prepareUpload` — each path absolute, an existing readable regular file, else `BAD_PARAMS`
  naming the entry's index, never the path; sends `fs.promises.realpath`; size and sha256 from one read; also on the
  `@bridge/sdk/download` subpath, #261) behind `Tab.upload` / `client.upload` (types `UploadOptions`, `UploadResult`;
  the eight values unchanged, #240); `error.ts`'s `UPLOAD_REFUSED` line names both causes (#263, #264),
  `format/{snapshot,network}.ts` (the pure text formatters, moved from the extension in Step 7 T4,
  byte-identical to the baseline `sdk/test/fixtures/baseline-51de800.json`), exported as the
  `@bridge/sdk/format` subpath (`sdk/package.json` `exports["./format"]`) and from `index.ts`; Step 12's
  `format/console-messages.ts` (`formatConsole`, capped at 20 000 characters, keeps the newest whole lines under one marker line; #345, #398) is on the subpath only, so the
  main surface keeps its eight values (`sdk/test/s12-console-format.test.ts`, last test).

## Runtime gotchas
- **The per-user token file is found from `env` alone** (`userTokenFile`, Step 15 S2): `APPDATA` (else `USERPROFILE`)
  on Windows, `HOME` on macOS, `XDG_CONFIG_HOME` (absolute) or `HOME` elsewhere — never `os.homedir()`. So a test that
  passes `env: {}` reads no real per-user file; keep it that way when adding a reader.
- **The clone and the npm package run different daemon files**, so their build ids differ. Since Step 15 S3 the knock
  asks `adoptDaemon` (`sdk/src/adopt.ts`) on a mismatch: the daemon's record (`~/.browser-agent-bridge/daemon-<port>.json`,
  home from `env`: `USERPROFILE` on Windows, `HOME` elsewhere) names the running file; another install's daemon that is
  still current for that install and not older (package or clone root `version`) is used as it is, on a 4002 reconnect
  too; anything else hands over as before. So a clone and a package never shut each other down; to force your own
  build over another install's equal-version daemon, stop that daemon (`daemon.shutdown`) or use another port.
- **No `console.` text anywhere in `sdk/src`**: `sdk/test/failure-report.test.ts` (the "no 'console.' in any sdk/src
  file" test) fails on the substring, even inside a module path or a comment, so a console-related file or import is
  named without it (`consoleMessages`, a `format/` module named otherwise; seen in Step 12 S3b, 2026-10-27).
- **The call timeout is per-call** — `client.call(method, params, { timeoutMs })`. The daemon bounds
  it to `[100, 600000]` and waits 5 s longer; the client waits 1 s more than the daemon (`route.ts`,
  `sdk/src/client.ts`). The default is still 30 s, so anything that may run longer (`browser_evaluate`,
  `browser_download`) must pass `timeoutMs`, or the daemon reports a timeout while the extension is
  still working. Since Step 7 one deadline covers both the visibility-lock wait (`LOCK_TIMEOUT`) and
  the forwarded call (decisions.md · 2026-10-22 · One deadline per call covers the lock wait and the
  forwarded call).
- **The text formatters live in `sdk/src/format/`** (`@bridge/sdk/format`), not in the extension: the
  extension returns `SnapshotResult {url, title, elements, truncated}` and network entries, and the MCP
  renders them. The output is pinned byte-identical by `sdk/test/format-baseline.test.ts` against
  `sdk/test/fixtures/baseline-51de800.json`, captured once from the pre-T3 code (T4.2). Never
  regenerate that fixture from the new formatter.
- **The SDK's knock hashes `daemon/dist/index.js` on disk at every knock** (`sdk/src/knock.ts:162`,
  `io.hashDaemon`, defined in `sdk/src/spawn.ts:44`), not a build baked into the client, so a client
  started from an older bundle adopts whatever daemon was built last (Stage 0 F5, found by reading
  the code; the Stage 0 verifier re-read it and ran only a same-build 4002 reconnect, so no old-bundle
  client has been run against a newer daemon). That is why the Step 7 daemon kept a legacy path
  for Step 6 clients for one release (decisions.md · 2026-10-22 · A Step 6 client keeps working
  against a Step 7 daemon for one release, without loosening a lease).
- **Failure reports take the visibility lock and switch the screen.** On `LOCATOR_NOT_FOUND
  LOCATOR_AMBIGUOUS REF_STALE OFFSCREEN PAGE_ERROR NAV_FAILED TIMEOUT` a `Tab` call (and the MCP on a `T<n>`
  handle) reads the tab once more — `snapshot`, a default-mode `screenshot`, the last 20 network
  entries — in one 5 s budget, sets them on the same `BridgeError` (`snapshot`, `screenshotPath`,
  `network`, `attachErrors`, `report()` ≤ 60 lines) and never throws from it (`sdk/src/error.ts`). `report()`'s
  `Screenshot:` line shows the home folder as `~` (`homeAsTilde`, display only: `screenshotPath` stays absolute; a
  Windows home folds ASCII letters only; a throwing `homedir` keeps the report; `sdk/test/s14-home-path.test.ts`). The
  screenshot is an ordinary capture under the FIFO lock (another actor's lock → `LOCK_TIMEOUT` or the
  5 s cut in `attachErrors`) and **switches the window to the failed background tab**: probe tab
  `visible` +20 ms, the human's tab hidden 1331 ms, call 1344 ms, PNG showing the failed tab (Run 12
  REP-0, with blue/magenta controls; decisions.md · 2026-10-23 · A probe of the failure-report screenshot
  runs before any row that could attach a non-fixture tab (#97)). On a fully covered window the 5 s cut
  ends the SDK's wait, not the extension's switch (the failed tab may stay in front ~30 s, R9-RESTORE).
  PNGs go to `BRIDGE_FAILURES_DIR`, else `~/.browser-agent-bridge/failures/` — outside the repo; a
  script on a real site's private pages passes `connect({failureReports: false})`, as
  `recipes/blackboard/boot-bb.ts` and `export-grades.ts` do.
- **On Windows `spawn(…, {detached: true})` keeps the child in the parent's process tree** — Windows
  keeps `ParentProcessId`, so `taskkill /T` on a *live* parent kills the "detached" daemon too; a child
  whose spawner had already exited survived the same tree kill (measured with test processes, Stage 0
  audit F3, 2026-10-22). Whether Claude Code ends MCP servers that way is not established; the D6 wave
  (MUX-7) measures it (decisions.md · 2026-10-22 · The detached daemon's survival depends on how the
  session's MCP is killed).
- **A pre-Step-6 server on 9234 takes a v2 hello as the extension.** The old host accepts any hello
  with the right token as the extension, so a Step 6 client replaces the real extension's slot, gets
  no welcome, and leaves that old session broken (measured on port 0, Stage 0 audit F1, 2026-10-22).
  The SDK waits 2 s for the welcome, then gives up with `VERSION` and never spawns or hands over
  (`WELCOME_TIMEOUT_MS`, `sdk/src/knock.ts`). End every pre-Step-6 session before starting a Step 6 one.
- **Every client must agree on `BRIDGE_PORT`.** A client spawns its daemon on its own port, so an MCP
  on 9235 and a script on 9234 start two daemons and the extension (one port in its Options) reaches
  only one; the other client waits and blames Chrome (Stage 0 audit F24, by reading the code, 2026-10-22).
  `BRIDGE_DAEMON` (a dev override of the daemon path) must be a native Windows path on Windows: Node
  resolves `/c/Users/…` to `C:\c\Users\…` (F24); `paths.ts` names that in its error.
- **A daemon spawned through `Start-Process -NoNewWindow` held the caller's output pipe open** — a
  PowerShell call that ran recipes that way returned only when that daemon was stopped (W1 MUX-6,
  2026-10-22, by correlation); a plain foreground `npx tsx recipes/hello.ts` returned at once. Run
  wave blocks with their output to a file, or stop the daemon after. Measured since: `spawnDaemon`
  inherits no pipe — node parent, `sdk/test/spawn-inherit.test.ts`: end-of-file 3–6 ms before the
  child's exit with the stand-in daemon alive in 6 runs, while the `stdio:"inherit"` control held the
  pipe every run; npx parent one ad-hoc trial. The MUX-6 cause remains unmeasured (decisions.md ·
  2026-10-23 · S3.5's outcome and the Step 6 revisit items (#91)).
- **`ws` emits several frames from one TCP read synchronously**, before any promise continuation
  runs. A one-shot listener that settles a promise and unsubscribes later swallows the frames behind
  the one it waited for: the knock lost an `extensionStatus` sent in the same read as the `welcome`, so
  `connect()` waited 15 s and blamed Chrome (D4 verifier, measured, 2026-10-22). Unsubscribe inside the
  listener's own callback.
- **The `saveTo` file finish hard-links `.part` to the target** (`sdk/src/evaluate-save.ts`). `fs.rename` replaces an existing target on Windows and POSIX alike, so the no-overwrite finish
  hard-links `.part` to the target (fails `EEXIST` → `BAD_PARAMS`) and falls back to re-check + rename only where
  links are unsupported (S4.md §6 candidate 3, measured on NTFS by the S4 verifier; decisions.md · 2026-10-25 · S4:
  `saveTo`'s wire methods, refusals, store caps, SDK form and file finish (#218)).
- **The SDK rewrites a failure report's `candidates` refs** (`sdk/src/error.ts`). The SDK
  rewrites the `candidates` refs in a report's `error.data` to the attached snapshot's (unique role +
  name hit) or drops them (decisions.md · 2026-10-23 · S4's failure-report details, and how the MCP
  reaches them (#93)). A snapshot, the report's own included, renumbers the tab's refs (`extension/src/content/CLAUDE.md`, the `locate` bullet).
- **Trusted input is `focusFirst`** (`sdk/src/policy.ts`). Trusted CDP input into a background tab answers `ok` and does nothing, and focus emulation does not fix it (measured: `extension/CLAUDE.md`, Tabs, trusted input and capture). The SDK's `Tab.click/type/pressKey({trusted:true})` call `focusTab` first — the
  tab comes to the front of its window, the window is focused, and it stays there; the SDK never sends
  `focusEmulation` (decisions.md · 2026-10-23 · The background-input policy (#89); · FE's rows and outcome
  table, amended before anything is measured (#78)).
- **`prepareUpload` must use `fs.promises.realpath`, not `fs.realpathSync`** (`sdk/src/upload.ts`; Stage 0 F8): it
  resolves a link or junction and canonicalises case and 8.3 names, where `realpathSync` keeps the given form, so the
  extension's folder rule could judge the wrong location. Not measured: an unreadable file (`EACCES`) and a folder on
  a `subst` or mapped drive. Since Step 11b S0F-b the extension also refuses a missing file before the attach
  (`BAD_PARAMS`, `extension/src/CLAUDE.md` Uploads; #288), so a raw `uploadFiles` no longer answers `ok` for one (UP-RAW, #284).
- **`evaluate`'s returned `value` keeps the page's key order since Step 13 S2** (R20-ARGS-ORDER SDK leg `value-equal=5`,
  2026-10-30; the row prints RECORD). Chrome's `returnByValue` sorts keys (R19-ARGS-1 FAIL, 2026-10-29, #373); the
  measurement and the fix are in `extension/src/evaluate/CLAUDE.md`.
- `Tab.consoleMessages` reads same-site frames too, and its JSDoc says so since S3b: `extension/src/CLAUDE.md` (R19-CON-FRAME).

The daemon's own lifecycle (outliving its session, the bind being the lock) is in `daemon/CLAUDE.md`; the `saveTo` store is in `extension/CLAUDE.md`; the MCP's trusted tools focus first too (`mcp/CLAUDE.md`).
