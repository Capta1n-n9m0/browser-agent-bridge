# Browser Agent Bridge

Automate your **real, already-logged-in** Chrome (default profile) from an AI agent.

Since Chrome 136 (May 2025) blocked `--remote-debugging-port` on the default user-data-dir,
CDP-against-your-real-profile no longer works for Playwright/Puppeteer/Selenium. This project
restores agent control of that profile via a Chrome extension + an MCP server, so Claude
(or any MCP client) can drive the browser you're already signed in to.

> Think of it as "Playwright MCP, but pointed at your real logged-in Chrome."

## Quick start (Windows)

```powershell
git clone https://github.com/Capta1n-n9m0/browser-agent-bridge
cd browser-agent-bridge
npm run setup
```

Setup installs, builds, creates the token, registers the MCP server in Claude Code and prints the Chrome steps: load
the `extension\` folder unpacked, set its Options (port `9234` and the token), pin its button. Then run `/mcp` in Claude
Code (or start a new session) and `npm run doctor`; every line should say `OK`. Update later with `npm run bridge-update`.
Without Claude Code the MCP entry line fails; scripts do not need it. If PowerShell says running scripts is disabled,
type `npm.cmd run setup` (likewise `npm.cmd run doctor`). An older clone needs `git pull` first.
The full walk-through: [`docs/setup.md` → Install on a new device](docs/setup.md#install-on-a-new-device).

## Documentation

All documentation lives in [`docs/`](docs/).

- **Setup & usage:** [`docs/setup.md`](docs/setup.md)
- **Progress & roadmap:** [`docs/progress-and-roadmap.md`](docs/progress-and-roadmap.md)
- **E2E test plan:** [`docs/e2e-test-plan.md`](docs/e2e-test-plan.md) (+ fixture `test-fixtures/e2e-playground.html`)
- **Design spec:** [`docs/specs/2026-06-04-chrome-real-profile-agent-bridge-design.md`](docs/specs/2026-06-04-chrome-real-profile-agent-bridge-design.md)

## Status

**25 tools**, implemented and **E2E-validated** against the real default profile: Phases A–D
(connection, navigation, perception, action fidelity, robustness) plus `browser_evaluate` and
network inspection (`browser_network_requests`, `browser_network_clear`, and
`browser_wait_for({networkIdle:true})`). Since Step 6, a shared localhost daemon sits between the
extension and its clients (the MCP server and a TypeScript SDK for scripts). Since Step 7, several
actors work on different tabs at once, through tab handles, one owner per tab, and `browser_focus_tab`.
Since Step 8, scripts and Claude can name elements by role and name, text or CSS (resolved by the same
rules as the snapshot), the SDK has a typed `Tab` API whose failures carry a report (snapshot,
screenshot, recent requests), and a Claude session's tab follows you only when you ask
(`browser_use_active_tab`). How to write a script: [`docs/setup.md`](docs/setup.md#writing-a-script).

**Your controls (Step 9, Phase E safety).** A toolbar button, the shortcut `Alt+Shift+K` and the options
page turn the bridge off, so every page call is refused until you turn it back on; a separate switch
takes `browser_evaluate` away; and a block list keeps agents off the sites you name. All three are
enforced in the extension itself, so no agent, script or token holder can undo them. The block list is
not a network firewall — see [`docs/setup.md` → Safety](docs/setup.md#safety).

**Step 10 (the Step 8 follow-ups).** Claude's trusted click, type and key press now bring the tab to the
front of its window first, as a script's already did; an action on an element past the snapshot's
800-element cap says so; `browser_evaluate {saveTo}` (and `tab.evaluateToFile()` in a script) writes a
large value to a file and answers only its path, size and sha256, so bulk data never passes through
Claude's context; and "JavaScript is off" has its own error code, `JS_DISABLED`.

**Step 11 (file upload).** `browser_upload_file` (and `tab.upload()` in a script) puts local files into a page's
file input, as if you had picked them in the file dialog. It is off until you allow it in Chrome: add the
folders agents may upload from to **Upload folders** on the extension's options page, and turn on **Allow access
to file URLs** for the extension. A file outside those folders is refused `UPLOAD_REFUSED`, and the bridge never
opens or acts on `file:` pages. See [`docs/setup.md` → Uploading files](docs/setup.md#uploading-files).

**Step 11b (closed 2026-10-27, #320):** while a bridge `navigate`, `newTab` with a URL,
`back`, `forward` or download runs, the block list also stops a redirect hop onto a blocked site (Runs 17 and 17b,
2026-10-27).

**Step 12 (Phase F, ergonomics; built, Runs 18 and 19 run, closed 2026-10-29, #374).** *(Superseded 2026-10-30: was "not closed", because the user ruled the gate on 2026-10-29, #374.)* `browser_evaluate {args}` passes data to a
function without escaping it into the string (SDK: `{args}` on `evaluate`, `evaluateRef`, `evaluateToFile`; R19-ARGS-2, R19-ARGS-GLOBAL: PASS);
`browser_console_messages` (SDK `tab.consoleMessages()`) reads the page's console, earlier messages included (R19-CON-1: PASS); the bridge
keeps one debugger session per tab while an agent works, to avoid the banner flicker (tested: `extension/test/debugger-keeper.test.ts`; the
live banner reading did not discriminate, R19-KEEP-1); `browser_upload_file {chooser:true}` answers a site's own "Open file" window from your Upload folders (R19-CHOOSE-1, R19-CHOOSE-2: PASS); and a
trusted click, type or key press (not one sent with `focusEmulation`) holds the screen lock from its focus to 500 ms after its input (tested: `daemon/test/s6-trusted-focus.test.ts`; the live timing row R19-G2-1 failed, cause not established). Run 19 (2026-10-28/29, fixture
pages): of 58 row ids, 42 passed, 5 failed, 5 did not discriminate, 3 were not measured and 3 are records
(`docs/plans/2026-10-27-step12-phase-f-steps/S7-run-record.md`). Known limits are in
[`docs/setup.md`](docs/setup.md#reading-the-console) and under Running JavaScript, Uploading files and Troubleshooting.

**Step 13 (the Phase F follow-ups; closed 2026-10-30, #420).** A popup opened by a
background tab now goes to that tab's owner, matched through Chrome's `webNavigation` event, a new permission you granted
(R20-POP-BG-3: PASS, 3 of 3; `extension/test/opener-join.test.ts`). `browser_evaluate` returns an object's keys in the page's
order through the SDK too (`extension/test/s13-envelope.test.ts`). When `browser_console_messages` has more than 20 000
characters it keeps the newest lines and says how many older lines it cut (R20-CON-CAP: PASS;
`sdk/test/s12-console-cap.test.ts`). A second file-chooser upload on a tab running one is refused with its own text
(R20-CHOOSE-TWICE: PASS; `mcp/test/s13-chooser-busy.test.ts`). Run 20 (2026-10-29/30, fixture pages), as the user ruled it
(#420): 24 passed, 4 failed (three popup rows on two sheet clauses, #406; a covered-window screenshot timeout, R20-G2-1),
1 not measured, 3 not run, 2 records
(`docs/plans/2026-10-29-step13-phase-f-followups-steps/S5-run-record.md`). Step 13 is pushed (found on origin at Step 14's start). *Corrected 2026-10-30: was "Step 13's build is not pushed".*

**Step 14 (Phase G, your own devices; built 2026-10-30, not pushed; the gate waits for the user: #432 and the push).** `npm run setup` installs the bridge on a new Windows device,
`npm run doctor` checks every part, `npm run bridge-update` updates it, and a script in any folder imports the SDK
([`docs/setup.md`](docs/setup.md#install-on-a-new-device)). The failure report prints a home-folder screenshot path as `~`.

6089 unit tests green in 255 files (`npm test` 2026-10-30, Step 14). *Superseded 2026-10-30: was "6030 unit tests green in 251 files (`npm test` 2026-10-30, HEAD `f6bafc5`)", because Step 14's tests landed.* The Step 6 daemon split was E2E-tested in
wave W1 (2026-10-22), Step 7's multi-actor tabs in Runs 8–10 (2026-10-22/23), Step 8 in Runs 11–12
(2026-10-23/24), Step 9's safety controls in Run 13 (2026-10-24; 24 rows passed, 7 failed — none
shown to be a product defect; ratified by the user, #202), Step 10 in Runs 14–15 (2026-10-25; Run 15:
27 passed, 3 failed, none a product defect), and Step 11's upload in Run 16 (2026-10-26; 19 passed, 3 failed,
3 not measured, 4 recorded; two failures are a banner check that cannot tell the product from the wave's own
page reads, one is an options-page timing bound with no cause stated), and Step 11b in Runs 17 and 17b (2026-10-27;
Run 17b: 16 passed, 7 failed — rows carried from Run 16's uploads, on helper or sheet defects —, 3 not measured, 2
recorded). Before that, live
in-browser runs of 29 cases (2026-06-04), Phase C (13), Phase D (7) and
Phase B (6) on 2026-09-03, the evaluate pass (20 of 22) and the network pass (15 of 15) on
2026-09-07 — 6 runtime bugs found & fixed across them. Details in
[`docs/progress-and-roadmap.md`](docs/progress-and-roadmap.md).

*Corrected 2026-10-23 (Step 7 propagator): was "21 tools" and "542 unit tests green (2026-10-22; … its
live E2E pending)"; as built Step 7 added `browser_focus_tab` and the tests, and both live waves ran
(`docs/plans/2026-10-21-step7-multi-actor-tabs-asbuilt.md`).* *Corrected 2026-10-24 (Step 8 S7):
was "22 tools" and "950 unit tests green in 59 files (2026-10-23)"; Step 8 added `browser_use_active_tab`,
locators, the `Tab` API and failure reports
(`docs/plans/2026-10-21-step8-sdk-surface-and-mcp-cursor-asbuilt.md`).* *Corrected 2026-10-24 (Step 9
S5): was "1714 unit tests green in 85 files"; Step 9 added the safety controls and their tests
(`docs/plans/2026-10-24-step9-phase-e-safety-asbuilt.md`).* *Corrected 2026-10-25 (Step 10 S8): was
"2720 unit tests green in 116 files (… at `ba6029e`)" and "the run's ratification is open for the user";
Step 10 added its features and tests (`docs/plans/2026-10-24-step10-step8-follow-ups-asbuilt.md`), and the
user ruled Run 13 (#202).*

Merged to `main` and published as a public GitHub repo (2026-09-03). Licensed under MIT until 2026-11-08, now
AGPL-3.0 with an Apache-2.0 SDK (below).

## License

- The daemon, the extension, the MCP server and the setup tools are licensed under the
  [GNU Affero General Public License v3.0 only](LICENSE) (AGPL-3.0-only). If you change them and distribute them, or
  let people use your changed version over a network, you must publish your changes under the same license.
- The SDK (`sdk/`) and the shared protocol types (`shared/`) are licensed under the
  [Apache License 2.0](sdk/LICENSE), so scripts and programs that import the SDK can use any license.

Versions published before 2026-11-08 stay under the MIT license they were released with.

## Trademark

"Browser Agent Bridge" and its logo are the project's name and mark. The licenses above cover the code, not the name:
a fork or a changed version must use a different name and must not suggest it is the official project or is endorsed
by it. Saying truthfully that your work is based on Browser Agent Bridge is fine.
