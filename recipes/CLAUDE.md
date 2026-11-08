# recipes/ — Key files, live-run and Windows tooling gotchas

The root `CLAUDE.md` and `docs/agent-rules.md` also apply.

## Key files
- `recipes/` (run with `npm run recipe -- <file>`, i.e. `tsx`; index in `recipes/README.md`): `hello.ts` (SDK smoke
  script; its output is pinned by MUX rows), `sdk-login.ts` (row SDK-1) with its rules `s6-rules.ts`, `t5-lib.ts`
  (small SDK helpers), `reload-extension.ps1` (reloads the extension card by UI Automation and verifies it; exit 2 =
  pressed nothing), `blackboard/` (`boot-bb.ts`, `export-grades.ts` and their pure helpers; read-only by construction,
  `failureReports: false`), `bb-login.ps1` (that login step, a condition wait inside one `-WaitSec` bound, #215),
  `fixtures/` (Blackboard and SSO stand-in pages), `test/` (part of `npm test`), `tsconfig.json`
  (`npx tsc --noEmit -p recipes/tsconfig.json`; recipes are not in `npm run typecheck`).
- The live-wave helpers of Steps 7–13 (`s6`…`s13`, `t5`, `fe`, `bgf`) were moved to tag `archive/dev-history` on
  2026-11-08; gotchas below that name them are still measured facts about Chrome and Windows.

## Runtime gotchas (live runs, Windows tooling, driving Chrome from the outside)
- **The bridge cannot drive the Web Store or its developer dashboard** (Chrome 156, 2026-11-08): on
  `chrome.google.com/webstore/devconsole` scripting, `chrome.debugger` ("The extensions gallery cannot be scripted") and
  capture all fail, and Chrome 156 has no `--allow-scripting-gallery`. Store submissions are done by hand.
- **Windows PowerShell 5.1 mangles `—`** (U+2014): it decodes program output with the console code
  page and writes `Add-Content`/`Set-Content` in ANSI, so `—` becomes `â€"` (D6 fixer; again in W1,
  2026-10-22). Set `[Console]::OutputEncoding = [Text.Encoding]::UTF8`, read with `-Encoding UTF8`, and
  write UTF-8 text with Node or `[IO.File]::WriteAllText`.
- **A hard reload re-fetches `favicon.ico`, and a plain fixture URL can come from Chrome's cache.** Run 8
  NET-1 served W1's 12 914-byte copy from the HTTP cache (`from cache: yes`, the server never hit) and
  printed `12.6 KB` for a 13 106-byte file; Run 9's Ctrl+Shift+R got `12.8 KB`, `from cache: no`, but
  the tab also logged a `404 image favicon.ico`, so `showing 1 of 1` became `2 of 2` (R9-NET-1). Write
  network rows with a fresh query string and a `types` filter.
- **Captures are colour-managed**: a `#ff00ff` bar drawn by the E2E driver (`recipes/t5-lib.ts:148-149`)
  read `#dd00fa` and its cyan `#00ffff` bar `#97fdfd` in a capture
  (Run 8 SCREEN rows, Run 9 R9-SCREEN-2), so pixel checks need a hue rule with slack,
  probed off any label text. In default-mode captures lime `#00ff00` read `#8fff3d` and blue
  `#0000ff` read `#3300f8` (named blue; Run 9, and Run 12 REP-0 control A); cyan through the default
  capture was not measured and is expected to shift like lime: use blue or magenta for colour
  controls (S6 verifier r2, from Run 9's readings; `…step8…-steps/S6.md` gotcha candidate 7).
- **Recipes run with `tsx` (`npm run recipe -- <file>`), and `String(fn)` page code breaks under tsx.**
  tsx's keepNames wraps inner named functions and named arrows in `__name(…)`, so `String(fn)` of such a
  function throws `ReferenceError: __name is not defined` in the page; under vitest the same function
  is self-contained, so a unit test cannot catch it (S6 verifier §7, reproduced in `node:vm`, tsx
  v4.23.15). Recipes ship page code as literal strings. The extension's `SERIALIZER_SRC` is unaffected
  (bundled by esbuild without keepNames). Recipes are not in `npm run typecheck`: use their own
  `tsconfig*.json` (root `CLAUDE.md`, Commands); a recipes test that imports chrome-typed extension code belongs in a tsconfig
  with `"chrome"` in `types` (`tsconfig.s9`/`.s10`) — `tsconfig.s6.json`'s `test/*.test.ts` glob pulled in
  `s9-rules.test.ts` (since `e91e437`, 26 errors in `extension/src/tabs.ts`) and, through `s10-rules.test.ts`,
  `debugger.ts` (since `b55048d`, 3 more) until Step 10 S8 excluded them (S8-builder.md item 3; decisions.md ·
  2026-10-25 · S8: the retirement as done, the s6 typecheck fix, and where the pointers go (#228)).
- **`Alt+Shift+K` is assigned as `_execute_action` on Chrome 156** and pressing it left the Windows input
  layout unchanged (`0x04090409` before and after, three layouts installed; Run 13 SAFE-2). The toolbar
  extension button and the Extensions (puzzle) button expose **no UIA Invoke pattern**: pinning and
  pressing need a mouse click at a `FromPoint`-verified point in the driver's own window (Run 13 record
  block 9; S4.md §10 finding 1).
- **Chrome 156 shows a second line under the extension's action title** ("Has access to this site"; Run 13
  record SAFE-1 (4), SAFE-9): read only the first line when checking the title by UI automation.
- **`chrome.exe --new-window chrome://…` opens a New Tab page, not the page** (Run 8 set-up fix 4;
  RELOAD-AUTO F1). Type the URL into the omnibox of a window the driver opened instead.
- **The extension reload is scripted: `recipes/reload-extension.ps1`** (decisions.md · 2026-10-23 ·
  Later extension reloads use `recipes/reload-extension.ps1`). On `chrome://extensions` Chrome 156's
  UIA tree flattens each card into siblings; the card's reload is AutomationId `dev-reload-button`,
  and the toolbar's Reload is also named "Reload" (AutomationId `view_1003`), so never match by name.
  An unpacked extension's id is sha256(absolute path as UTF-16LE), first 16 bytes as letters a–p.
  Proof of a reload: a new `extension resync` line in `daemon.log` in the same second (5 of 5).
  (RELOAD-AUTO F1–F6.) Since Step 8 S2b a reload's hello waits up to 2 s for the session marker, so the `extension resync` line can come later than the press and the script still finds it (the timings and the decision: `daemon/CLAUDE.md`, the session-marker bullet).
- **UIA `TabItem` is not a tab count**: a page element with `role="tab"` is a `TabItem` too (empty
  ClassName); the tab strip's tabs have ClassName `Tab` (BG-FLAGS finding 3).
- **Chrome's DevTools toolbar buttons are nested pairs of one name; the dock-side menu is a Group plus a Button.**
  Each toolbar button is an outer `toolbar-button` and an inner icon with the same name, so a reader that needs exactly
  one element of that name finds two. For the main menu the outer offers ExpandCollapse and the inner offers Invoke. The
  menu opens in the window's own UIA tree, with no new window. Each Dock side item is a Group with Invoke plus a Button
  with Toggle; the pressed side reads Toggle=On, and invoking the Group undocks and docks. Measured 2026-10-30, Chrome 156,
  DevTools docked in a wave window (`S5-liveC20b.md` §6 item 1; `recipes/s13-devt.ps1`).
- **The driver's shell runs inside a job object** (limit flags `0x800`, breakaway allowed), and a
  process started with plain `Start-Process` inherits the job and the session's environment
  (BG-FLAGS finding 5). Anything that must outlive the driver (Chrome, a daemon) needs breakaway and
  a clean environment — `recipes/bgf-launch.ps1` does both.
- **Windows PowerShell 5.1 traps met in Run 12 (Step 8 S6)** (`…step8…-steps/S6.md` gotcha candidates
  2, 3, 10, 16): the built-in alias `R` (`Invoke-History`) shadows a function named `R`; embedded `"`
  are stripped from a native command's arguments, so send JSON-bearing prompts from Git Bash;
  `Get-ChildItem` with a wildcard in the middle of the path plus `-Filter` returns nothing (put the
  pattern in the path); `>` in a `-NoProfile` shell writes UTF-16LE (`ff fe`), which a UTF-8 reader
  turned into a page `SyntaxError` — read a file's encoding from its BOM. Met in Step 10: variable names are
  case-insensitive, so a local `$h` in a function shadows a script-level `$H` through dynamic scope (S5 builder:
  `Close-Own` cast "127.0.0.1" to IntPtr, exit 1; S5.md Findings 3); and `powershell -File` drops an empty
  argument — `-ArgLine ''` arrived with no value, `Missing an argument for parameter 'ArgLine'`, exit 1 (Run 15
  RET-1, Return 4; S7.md Findings 1): omit an empty parameter and let its default apply.
- **`npx` on Windows goes through `cmd.exe`, which refuses a long argument**: an ~8 000-character actor
  prompt via `npx tsx …` printed `The command line is too long.` and exited 1 with nothing sent
  (cmd's 8191-character limit); `node --import tsx …` worked (Run 12 MCP leg; S6.md candidate 14).
- **Chrome restarts and live sites** (Run 12; S6.md candidates 8, 11–13, 15): a window handle does not
  survive a Chrome restart (session restore brings windows back under new HWNDs) — find the window
  again or open your own; a full-window OS frame includes Chrome's own UI (the bookmark bar), so judge
  frames by numbers or crop to the viewport; Chrome resolves every `*.localhost` name to loopback with
  no DNS lookup (one 127.0.0.1 server can stand in for a second host); the login script's old post-submit
  check (address stable 4 s, at most 20 s) read the SSO page about 8 s after the press, yet the login had
  worked (decisions.md · 2026-10-23 · SDK-6/SDK-7 run in the session the login actually opened (#101)) — so
  since Step 10 S5 `bb-login.ps1` polls on a condition inside one `-WaitSec` bound (default 90) from the press:
  exit 0 on a delayed redirect where the old script exits 4, exit 4 at the bound on a stuck or foreign page (Run
  15 BBL-1: 90006 ms, 90013 ms; decisions.md · 2026-10-25 · S5: `bb-login.ps1`'s post-submit wait — exit rules and
  the hard bound (#215)), and the real pp1 login took one press (Run 15 PP1); session restore adds windows after
  a relaunch, so "exactly one new window" is no safe test — wait for a stable window set and pick only a window
  with a unique title marker (Run 15 Return 5; decisions.md · 2026-10-25 · RET-1's end safety read-back reads only
  a window the wave opens and marks (#223); S7.md Findings 3); and live data can
  change between two reads minutes apart (inferred from counts, not proven), so compare two
  transports over one held snapshot (decisions.md · 2026-10-23 · S6.3 compares one in-page export read through both paths (#103)).
- **A headless `claude -p` actor calls `ToolSearch` first unless tool search is off.** Claude Code 2.1.310 defers
  MCP tools, so an actor's first call was `ToolSearch`, and a row checking "the actor called exactly
  [browser_click]" failed while the page saw 9/9 trusted inputs (Run 15 MCPF-1, CAP-1 FAIL); with
  `ENABLE_TOOL_SEARCH=false` in the actor's environment (`recipes/s9-actor.ts --no-tool-search`) the
  re-measurements MCPF-1R and CAP-1R passed (S7.md Findings 2; `S7-wave-fixer2.md`, an offline dummy-MCP probe).
- **Occlusion guards meet windows you did not open.** An auto-hidden Windows taskbar is a visible topmost window
  whose 2 px strip lies inside the monitor's work area (`[x,1078,…,1126]` on a 1080-px monitor): cut placements
  at the taskbar (Run 14 Return 2; S1.md Findings 1). After a switch is toggled on the options page, a
  Chrome-owned topmost, no-activate popup (`Chrome_WidgetWin_1`, 223×25 px at the window's top right, owned by the
  options window) appears over it (Run 14 Return 3; Run 15 Return 3 and attempt 4; S1.md Findings 2, S7.md
  Findings 4); R15-3R exempted it only because a driver window owned it and it covered none of the read elements
  (#224). A maximized Chrome window's frame overhangs its monitor by 8 px and meets that 2 px strip, so a guard over it
  stops on the taskbars: place the wave's window inside the work area (Run 16 S5-liveA, `S5-liveA-occluders.txt`).
  Park the cursor and print occluder diagnostics before a click that a guard protects (decisions.md · 2026-10-25 · S1:
  Run 14's wave mechanics are kept for Run 15 (#213)).
- **A window title can carry the Chrome profile's display name, so captures drop title lines.** A DevTools window's
  title read plain `DevTools`, with no extension URL, in Run 13 (SAFE-10 set-up, #195), and `DevTools - <profile>` in
  Run 16 (the first line of a worker-console capture leaked it into a commit,
  redacted, #283). Live runners' console captures drop window-title lines, and a report names a scan pattern (a
  profile path) only by a placeholder (S5-record fix round 2).
- **Port 8080 may be held by VS Code (`Code.exe`)**, so Run 16 served its fixtures on 8081 (#273). `python` is on Git
  Bash's PATH but not the PowerShell tool's: start a runner that needs it from Git Bash (S5-liveA run 1).
- **A `STOP:` printed inside a restore must end the wave** (`s11-r16.ps1`, #279). The daemon exits after 600 s idle
  between a STOP and a re-run; the next client spawns it with the same build id.
- **Expected texts are tied to the product's constants, and re-read from the code before a row is committed.** Run 13's
  SAFE-9 and SAFE-10 expected texts were wrong, not the product (the `safety state:` log line precedes `extension
  resync` by design; Chrome 156 titled the worker's DevTools window `DevTools`), and both rows stayed FAIL because
  expected text is never edited after its run (decisions.md · 2026-10-24 · S4: Dated notes on §4.20 for two
  expected-text errors (#195)). `recipes/test/s9-rules.test.ts` and `s10-rules.test.ts` compare every expected text
  with the committed constant it was copied from, so a wording change fails there first.
- **Never run `chrome.exe` on this machine without an own `--user-data-dir`, not even `--version`.** Windows hands a
  bare invocation to the user's running Chrome ("Opening in existing browser session."), which may open a window or
  tab there (Step 11b Stage 0, #297). Read the version from CDP `Browser.getVersion` or the install folder.
- **A scratch Chrome for measurements** (#294): branded Chrome 156 loads an unpacked extension on a fresh temporary
  profile via `--user-data-dir=<temp> --remote-debugging-pipe --enable-unsafe-extension-debugging` and CDP
  `Extensions.loadUnpacked` (file access already on); `chrome.runtime.reload()` or a file-access toggle leaves it
  disabled until `management.setEnabled`. Close it by CDP `Browser.close`, never by killing `chrome.exe`
  (`…step11b…-steps/Stage0-measurer.md`, `Stage0.md` §7).
- **A scratch worktree or a fresh clone (Step 14 S4) checks `.ps1` files out with CRLF**, and 9 tests of `recipes/test/s11-r16-runner.test.ts` fail
  there while the main tree passes (Step 11b S0F-a and S1, seen by two verifiers). Compare a worktree's red there
  against the main tree before calling it a regression.
- **Run 17's helper facts** (`…step11b…-steps/S4-live.md` §6): `s9.ts` prints `ROW`/`CHECK` lines after an ISO time
  while `s11`/`s11b` print them bare, so a judge keyed on a line start needs both forms; `s11.ts make` writes
  `state.json` without s9's `opened` list; the extension's own options tab is listed hidden as `blocked`, so "exactly one
  hidden row" needs the options window closed; a row that needs the state disarmed for N seconds times the ON press
  from the reply, not from the first press (RD-DISARM, #308).
- **Run 17b's helper facts** (`…step11b…-steps/S7-live.md`, `S7-run-record.md` §5): a PowerShell 5.1 `powershell -File`
  script runs at global scope, so a top-level `$o` replaced `$global:O` and the run threw before any state change
  (attempt 1, #317) — name top-level variables so none shadows a global the helpers read; one console-capture path for
  both slices lost liveA's capture, so R17B-LOGS was NOT MEASURED (#318) — give each slice its own path; the banner
  sampler read positive on legs that send no call (R17B-UP-6 `missing`/`relative`), so a positive reading does not show
  that the call raised the banner (cause of any banner FAIL not established).
- **Run 19's helper facts** (Step 12, 2026-10-29; `…step12…-steps/S7-run-record.md` §5, the live ledgers):
  - A pass constant copied from a fake-extension test is not a measurement: `evaluate "function f() {}"` answers
    `kind=undefined` on a real page (a declaration) and `(function f() {})` answers `function` (#366). Measure a control's
    expected answer on a real build. The scripted MCP actor waits for its link (the "connecting to the bridge daemon"
    reply, up to 15 s) before its first call (#366).
  - The driver window guard refuses a window title it does not know: a new fixture page's title is added to it (#367).
  - `{css:"body"}` (also `html`, `head`) never matches in the locator walk; target a real element (#368). A STOP leaves the
    wave's windows open: list them after it.
  - Chrome 156's app-menu button is named `Chrome` (not `Customize and control…`) and offers only expand; Run 19's
    DevTools opener reaches "Developer tools" through it by UIA patterns only, on a window the wave opened (#368, #369).
    Docked DevTools did not refuse the debugger (`extension/CLAUDE.md`).
  - A fixture button that calls `click()` on a disabled input opens nothing (HTML spec); a row about the disabled-input
    refusal needs a handler that targets the input itself (#370).
  - Every segment save must close the worker-console capture window it opened: `Close-S11Window` closes only `S11Own`
    windows, and each reopen leaves a chrome://extensions window, which fired liveD19's `devtools-left-open` STOP (#371).
  - Read MCP text by the MCP's own lines, never by the extension's message or a code on line 1 (`mcp/CLAUDE.md`); a row
    whose reader is shown wrong is NOT DISCRIMINATING, while a wrong expected text in the sheet leaves it FAIL (#195, #373).
  - A scratch worktree with its own `npm ci` still holds `node_modules/@bridge/*` junctions that `git worktree remove`
    cannot delete: remove them one by one first (as #220). Git Bash's `cmd //c rmdir` leaves a junction in place;
    PowerShell's `cmd /c rmdir` removes it (#364, #365).
- **Rehearsing an install (Step 14, measured 2026-10-30):** the `claude` CLI and `.claude.json` facts are in
  `scripts/CLAUDE.md`. `reload-extension.ps1` run from a scratch clone opens and
  closes its own window, finds no card for that clone's `extension\` and exits 2: rehearsals pass `--no-reload`. A fresh
  clone's 9 CRLF reds: the scratch-worktree bullet above.
