# Setup & Usage

This bridge lets an MCP client (e.g. Claude) drive your **real, logged-in Chrome**
(default profile). It has three parts: a Node **daemon** that hosts a localhost WebSocket,
a Chrome extension (loaded into your real profile) that connects to it, and the MCP server
your client runs, which connects to the daemon as one of its clients.

## Install on a new device

For a Windows device that has never run the bridge. Total time: a few minutes, most of it `npm ci` and the build.

**You need:** Node.js 20 or newer (with npm), git, Google Chrome 116 or newer. Claude Code is optional: without it
the bridge still works for scripts, and setup prints the one command to register it later. Use PowerShell. The
commands need a checkout that includes them: if you cloned the bridge earlier, run `git pull` first.

If PowerShell says running scripts is disabled (`npm.ps1 cannot be loaded`), type `npm.cmd run setup` instead, and
likewise `npm.cmd run doctor` and `npm.cmd run bridge-update`, or use Command Prompt. This is a known Windows
default, not measured on the machine this guide was written on. Do not change the machine's execution policy for it.

1. **Clone and run setup.** Pick a folder to keep; the bridge runs from it.

   ```powershell
   git clone https://github.com/Capta1n-n9m0/browser-agent-bridge
   cd browser-agent-bridge
   npm run setup
   ```

   Setup works in this order, and each step skips itself when it is already done, so you can run it again at any time:
   it checks the prerequisites, runs `npm ci` and `npm run build` (only when `package-lock.json` or the sources are
   newer than what is installed or built), creates `bridge.token` (a random 256-bit secret; it is never printed and the
   file is gitignored), and registers the MCP server in Claude Code at user scope (`claude mcp add -s user`).
   An entry that already points at another checkout is left alone and reported; `npm run setup -- --replace-mcp`
   replaces it. An entry under the old name `chrome-agent-bridge` is always replaced by `browser-agent-bridge`
   pointing at this checkout. `npm run setup -- --dry-run` shows what it would do and changes nothing.

   **The one question:** "Copy the token to the clipboard for the extension's Options page? [y/N]". Answer `y` to
   paste the token in the Options page (step 4 of the list below); setup then waits, and once you press Enter it empties the clipboard. Windows
   clipboard history (**Win+V**) may keep a copy: delete it there after pasting. Answer `n` (or run without a
   terminal) and the token is not copied: open `bridge.token` in Notepad and copy its one line instead.

   **Exit codes:** `0` done; `1` Node, npm or git is missing, or `npm ci` or the build failed (the line says which);
   `2` setup finished but a part failed (the MCP registration, or a config file it could not parse). Fix what the
   line says and run setup again.

2. **Follow the next steps setup prints.** Setup ends with "Next steps in Chrome", with your real folder paths:
   1. Open `chrome://extensions` and turn on **Developer mode** (top right).
   2. Click **Load unpacked** and choose the `extension\` folder of the checkout.
   3. Open its Options page (Details → Extension options).
   4. **Port** `9234`; **Token** pasted from the clipboard (Ctrl+V), or the one line of `bridge.token` opened in
      Notepad. **Save**.
   5. Pin the extension's toolbar button (puzzle-piece menu → pin). It is the kill switch, and so is `Alt+Shift+K`
      ([Safety](#safety)).
   6. In Claude Code run `/mcp` (or start a new session). `browser_status` should then say the daemon is connected
      and the extension is connected. You never start the daemon yourself ([The daemon](#the-daemon)).
3. **Check with the doctor.**

   ```powershell
   npm run doctor
   ```

   It prints one line per part: Node.js, Build, Token file, MCP entry, Daemon, Extension, and Extension build, plus a
   line for an MCP entry's own token, a local-scope entry, or `BRIDGE_TOKEN` / `BRIDGE_PORT` set in this shell when there
   is one; it stops after Extension when the extension is not connected. A
   healthy install prints `OK` on every line and `No part failed.` (exit 0). A `FAIL` line names what is wrong and its
   fix, and makes the exit code 1. A `HINT` line is not a failure: for example, "Extension: not checked" when no
   daemon answered yet; start Claude Code or a script, then run the doctor again. Without Claude Code, the MCP
   entry line fails (exit 1): a script-only reader can ignore that line. The doctor only reads: it starts
   no daemon, never calls the `claude` CLI and never prints the token.

   **The Extension build line is a heuristic, named as such** (decisions.md · 2026-10-30 · the doctor reads the
   extension's build as a heuristic; #432). Nothing on the wire reports which build the loaded extension runs, so
   the doctor compares `extension\dist\sw.js` with the last "extension resync" line in the daemon's log. If the build
   is newer, it says the extension may be older than the build and tells you to reload it. If it says "resynced
   after the last build", that is a good sign, not a proof.

**Updating later:**

```powershell
npm run bridge-update
```

It runs `git pull --ff-only` (it stops with a plain line if you have local changes or the pull cannot fast-forward),
`npm ci` and `npm run build` when needed, then reloads the extension by `recipes\reload-extension.ps1` (UI
automation in a window of its own; if it presses nothing it runs once more, then tells you to reload by hand:
`chrome://extensions` → the reload button on the card). It exits 0 or 1. Then run `/mcp` in Claude Code, or start a new
session; the next client that connects hands the daemon over to the new build. `npm run bridge-update -- --no-reload`
skips the reload step and prints how to do it by hand.

**Scripts from any folder** need no extra setup beyond this install: see
[Scripts from any folder](#scripts-from-any-folder) under Writing a script.

The rest of this file ([Use it](#5-use-it) onward) describes the tools. The sections below describe the install by
hand, which is what `npm run setup` does for you.

## Manual install

Use this if you cannot run setup (another operating system, a locked-down machine) or want to see each step. It reaches
the same result by a slightly different route: it uses `npm install` where setup uses `npm ci`, a token you choose by
hand where setup writes `bridge.token`, and `BRIDGE_TOKEN` in the MCP entry's env where setup's entry has none. The
numbers 1 to 4 below are what other documents mean by "setup.md §1" to "§4".

### Prerequisites

- Node.js 20+ and npm
- Google Chrome 116+

### 1. Build

```bash
npm install
npm run build
```
This produces `mcp/dist/index.js` (the MCP server), `daemon/dist/index.js` (the daemon) and the
extension bundles in `extension/dist/`.

**End every pre-Step-6 session first.** A Claude session started before this version runs the old
bridge server, which holds port 9234 itself. While one is open the new MCP cannot connect: its tools
say a pre-Step-6 bridge server holds the port. End that session (or restart Claude Code) once.

### 2. Choose a shared token

Pick any random secret string (e.g. `openssl rand -hex 16`). The daemon, every client and the
extension must use the **same** token. Treat it like a password — anything that can
reach the WebSocket with this token can drive your logged-in browser.

Clients find the token in this order: the `BRIDGE_TOKEN` environment variable wins; without it, the
file `bridge.token` at the repo root (gitignored — never commit it). The repo root is the first
directory above the code whose `package.json` has `"workspaces"`; leading and trailing whitespace in
the file is ignored. With a `bridge.token` in place, scripts need no environment variable and the
MCP config's `BRIDGE_TOKEN` is optional. The daemon a client starts gets that client's token and port.

Every client must also use the **same** `BRIDGE_PORT` (default `9234`), the port set in the
extension's Options. A client on another port starts a second daemon there, which the extension
never reaches; that client then fails with `Extension not connected — …`.

### 3. Register the MCP server with your client

Add this to your MCP client config (Claude Desktop / Claude Code), substituting your
token and the absolute path to this repo:

```json
{
  "mcpServers": {
    "browser-agent-bridge": {
      "command": "node",
      "args": ["<absolute-path-to-repo>/mcp/dist/index.js"],
      "env": { "BRIDGE_TOKEN": "<your-token>", "BRIDGE_PORT": "9234" }
    }
  }
}
```

#### Upgrading a machine that ran the bridge before Step 6

Step 6 (2026-10-22) moved the MCP entry from `server/dist/index.js` to `mcp/dist/index.js`. The old
path no longer exists, and the build does not touch your client config, so do this once on every
machine that used the bridge before:

1. **End every Claude session that uses the bridge.** A pre-Step-6 server still holding port 9234
   takes a new client's hello as the extension and breaks that old session; a new client gives up
   after 2 s with a `VERSION` error naming this cause.
2. **Update and build:** `git pull`, then `npm install` (it relinks the five workspaces) and
   `npm run build`. Check that `mcp/dist/index.js` and `daemon/dist/index.js` exist.
3. **Point the MCP config at the new entry.** In Claude Code the user-level entry lives under
   `mcpServers` in `~/.claude.json` (on Windows `%USERPROFILE%\.claude.json`); a project-level one
   lives in the repo's `.mcp.json`. Change only the path in `args`:
   `<absolute-path-to-repo>/server/dist/index.js` → `<absolute-path-to-repo>/mcp/dist/index.js`.
   Leave `env` as it is: `BRIDGE_TOKEN` there still wins over a `bridge.token` file. Instead of
   editing the file you can re-register the server with the CLI:
   ```bash
   claude mcp remove browser-agent-bridge -s user
   claude mcp add browser-agent-bridge -s user -e BRIDGE_TOKEN=<your-token> -e BRIDGE_PORT=9234 -- node <absolute-path-to-repo>/mcp/dist/index.js
   ```
   For Claude Desktop, edit `claude_desktop_config.json` the same way.
4. **Reconnect:** run `/mcp` in Claude Code (or start a new session).
5. **Check:** `browser_status` now starts with `Daemon: connected on 127.0.0.1:9234 (build …)` and
   lists this session as `claude-code #<pid>` under `Clients`. The extension needs **no** reload:
   it is unchanged in Step 6. *Corrected 2026-10-23 (Step 7 propagator): that holds only for Step 6.
   Step 7 changed the extension, so after upgrading past Step 7, reload it (§4). An unreloaded
   extension gets every tab call refused with `VERSION` and a reload hint (decisions.md · 2026-10-22 ·
   A stale extension is refused for tab calls, detected by its hello).* *Updated 2026-10-24: Step 8
   changed the extension again — reload it after upgrading past Step 8; a pre-Step-8 extension answers
   a script's `tab.locate()` with `unknown method: locate`. Step 8 also removed the Step 6 compatibility path: a script
   that calls a tab method without `tab` now gets `BAD_PARAMS "tab is required"`, and `selectTab` gets
   `UNKNOWN_METHOD` (use `focusTab`), so port old scripts to the `Tab` of
   [Writing a script](#writing-a-script).* *Updated 2026-10-25: Step 10 changed the extension, the
   daemon and the MCP again — reload the extension and run `/mcp` (or start a new session) after
   upgrading. An extension not reloaded since Step 9 answers `browser_evaluate {saveTo}` with
   `unknown method: evaluateSaveStart` and a JavaScript-off refusal as `DISARMED` instead of
   `JS_DISABLED`.* *Updated 2026-10-26: Step 11 changed the extension, the daemon and the MCP again — reload the
   extension and run `/mcp` after upgrading; an extension not reloaded since Step 10 answers
   `browser_upload_file` with `unknown method: uploadFiles`. Uploads stay refused until you add Upload folders and
   turn on Allow access to file URLs ([Uploading files](#uploading-files)).* *Updated 2026-10-27: Step 11b changed the
   extension (a new permission, `declarativeNetRequestWithHostAccess`) — reload it after upgrading; an extension not
   reloaded since Step 11 does not stop redirect hops ([Safety](#safety)). Since Step 11b, `browser_new_tab` with a URL
   opens a blank page first (R17B-RD-2).* *Updated 2026-10-29: Step 13 S1 changed the extension (a new permission,
   `webNavigation`, granted by the user, #374; no new install warning, #393) — reload it after upgrading; an extension
   not reloaded since Step 12 leaves a background tab's popup unowned, or leases it to whoever holds the window's active
   tab ([Owners](#owners-leases);
   `extension/test/manifest.test.ts`, R20-0).*

Every client on a machine must use the same `BRIDGE_PORT`; see [The daemon](#the-daemon).

`start-bridge.sh` at the repo root is a macOS-only launcher written for the author's machine (a TODO in its header says so); it is not the Windows way and nothing here needs it.

You do not start the daemon yourself. The first client to connect (usually this MCP server)
starts it in the background; later clients join it. It **outlives the Claude session on purpose**,
so the next session and any script reuse it, and it exits on its own after 10 minutes with no
clients. Its log is `~/.browser-agent-bridge/daemon.log`. See [The daemon](#the-daemon) below.

To try it without an MCP client, use the inspector:
```bash
# PowerShell
$env:BRIDGE_TOKEN="<your-token>"; npx @modelcontextprotocol/inspector node mcp/dist/index.js
```

### 4. Load the extension into your real profile

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the `extension/` folder.
4. Open the extension's **Options** (Details → Extension options, or the puzzle-piece menu).
5. Set **Port** = `9234` and **Token** = `<your-token>`, then **Save**.
6. Pin the extension's toolbar button (puzzle-piece menu → pin): it is the kill switch, and so is
   `Alt+Shift+K` (see [Safety](#safety)).

Open the extension's **service worker** console (chrome://extensions → the extension →
"service worker"). You should see `[bridge] connection: up`.

**After rebuilding the extension** (`npm run build`), Chrome keeps running the old code until the
extension is reloaded (chrome://extensions → ↻ on the Browser Agent Bridge card). On Windows,
`powershell -NoProfile -ExecutionPolicy Bypass -File .\recipes\reload-extension.ps1` does that by UI
automation in a window of its own and verifies it; see `docs/e2e-test-plan.md` §1 item 9.

## 5. Use it

With the daemon running and the extension connected, call the 25 tools from your client. Every tool
marked *tab* also takes an optional `tab` argument — see [Tabs](#tabs) below; without it the tool
acts on **this session's tab**.

| Tool | What it does |
|---|---|
| `browser_status()` | Diagnose the bridge: daemon connected (build, clients by name)? extension connected? the human's active tab, by handle; this session's tab (`Cursor:`), and the human's tab again when it is a different one; then a `Safety:` line (on or off, JavaScript, the number of blocked sites — [Safety](#safety)). Call it first when other tools fail |
| `browser_use_active_tab()` | Make the tab you (the human) are looking at this session's tab. Claude calls it when you say "this tab" or "the tab I'm on" — the only way this session's tab follows you |
| `browser_navigate(url)` *tab* | Navigate the tab |
| `browser_snapshot()` *tab* | Accessibility outline of the tab with element refs |
| `browser_screenshot(fullPage?)` *tab* | Screenshot (viewport; full-page via CDP when `fullPage:true`). A viewport shot of a background tab shows that tab for about 1.5 s, then puts your tab back — see [Screenshots](#screenshots) |
| `browser_click(ref \| locator, trusted?)` *tab* | Click a ref or a [locator](#locators); `trusted:true` forces real CDP input (shows the debugging banner) and first brings the tab to the front of its window, where it stays |
| `browser_type(ref \| locator, text, submit?, trusted?)` *tab* | Type `text` into a ref or locator, optionally submit; `trusted:true` sends real CDP keystrokes (shows the debugging banner) and first brings the tab to the front of its window, where it stays |
| `browser_press_key(key, trusted?)` *tab* | Press a key on the focused element; `trusted:true` sends a real CDP keystroke (shows the debugging banner) and first brings the tab to the front of its window, where it stays |
| `browser_scroll(ref? \| locator?, direction?)` *tab* | Scroll to a ref or locator, or the page up/down |
| `browser_hover(ref \| locator)` *tab* | Hover a ref or locator |
| `browser_select_option(ref \| locator, values)` *tab* | Select option(s) in a `<select>` |
| `browser_back()` / `browser_forward()` *tab* | History navigation; on a history the bridge built alone Chrome refuses it (`INTERNAL`, [Safety](#safety), #308) |
| `browser_wait_for(text?, seconds?, networkIdle?, idleMs?, locator?, state?)` *tab* | Wait until text appears on the tab, for N seconds, — with `networkIdle:true` — until the tab has made no network request for `idleMs` (default 500, max 10 s wait), or — with `locator` — until an element matching it is visible (`state:"hidden"`: until none is; max 10 s) |
| `browser_list_tabs()` | List open tabs: handle, `*` on the human's active tab, the holding actor, title — URL |
| `browser_select_tab(tab)` | Make `tab` this session's tab: claims it, **without** bringing it on screen |
| `browser_focus_tab()` *tab* | Bring the tab on screen and focus its window (trusted click/type/press key do the same first); it does not change this session's tab |
| `browser_new_tab(url?)` / `browser_close_tab(tab)` | Open a tab (it becomes this session's tab; it comes to the front only if you were looking at this session's tab, else it opens in the background; with a URL it opens a blank page first ([Safety](#safety))) / close a tab by handle |
| `browser_evaluate(expression, timeoutMs?, asRef?, saveTo?, overwrite?, args?)` *tab* | Run JavaScript in the tab's page context and return the result (shows the debugging banner); `asRef:true` also returns a `[ref=eN]` for an element result, to act on with the other tools; `saveTo` (an absolute file path) writes the value to that file instead and answers only path, size, kind and sha256; `args` (any JSON value, at most 1 MiB) makes `expression` a function source called with it, such as `"(a) => a.rows.length"` (one function expression, no trailing `;`; an extension older than Step 12 answers `VERSION` — reload it) — see [Running JavaScript](#running-javascript) |
| `browser_network_requests(tab?, filter?, types?, failedOnly?, limit?, includeHeaders?, id?)` | List the network requests the tab has made — method, status, type, duration, size, URL — captured continuously with no banner; `id` shows one request's headers and body summary |
| `browser_network_clear(tab?)` | Forget the recorded network requests, so the next `browser_network_requests` shows only what your next action caused |
| `browser_console_messages(level?, limit?)` *tab* | List the console messages and uncaught errors Chrome kept for the tab's page, those logged before the call included: one line per entry, oldest first (time in UTC, level, `uncaught`, text); `level` keeps that level and every more severe one (`error` > `warning` > `info` > `debug`), `limit` 1–200 (default 200) the newest. Limits: no source URL or stack, a text cut at 2000 characters; messages of a frame in another site's process are not read (a same-site frame's are, and are dropped like the page's when its site is blocked, R19-CON-FRAME); an object logged before the call shows its class name only, not its contents (R20-CON-NOTEA); entries from a blocked site, the extension or a `file:` page, and those logged before the bridge was last switched on or before the extension's worker last restarted, are left out; refused `JS_DISABLED` while JavaScript is off, and wherever `browser_snapshot` is refused; shows the debugging banner while it reads (Step 12, #323, #334) |
| `browser_upload_file(ref \| locator, paths, chooser?)` *tab* | Put 1–20 local files (absolute paths) into a file input, or a label or element holding exactly one, as if you had picked them in the file dialog; with `chooser=true` the target may instead be the button or link that opens the page's own file dialog (refused `JS_DISABLED` while JavaScript is off). Refused `UPLOAD_REFUSED` unless each file is in an **Upload folders** folder you allowed and Chrome's **Allow access to file URLs** is on for the extension; the tab is not brought to the front; answers each file's name, size and sha256 — see [Uploading files](#uploading-files) |
| `browser_download(url, path, overwrite?, timeoutMs?)` | Save a URL to disk with the profile's cookies (fetched by the extension's service worker: no CORS, cross-origin redirects followed). `path` is absolute — a file, or a directory to use the response's filename. Reports size, type and sha256 |

*Superseded 2026-10-22: was 21 tools that all acted on "the active tab", with `browser_select_tab(id)`
making a tab active and `browser_new_tab`/`browser_close_tab` reporting Chrome tab ids, because Step 7
T4 gave every tab-touching tool a `tab` argument, ids became handles, `browser_select_tab` claims
without showing and `browser_focus_tab` is new.*
*Superseded 2026-10-23: was 22 tools, actions by `ref` only and `browser_new_tab` always in front,
because Step 8 S5 added `browser_use_active_tab`, the `locator` on actions and `browser_wait_for`,
`asRef`, and the background rule of `browser_new_tab`.*
*Superseded 2026-10-25: was "`trusted:true` forces real CDP input (shows the debugging banner)" with no
focus, `browser_focus_tab` "the only tool that changes what you see", and `browser_evaluate` without
`saveTo`, because Step 10 S2 made the trusted tools focus first (decisions.md · 2026-10-24 · FE and
`focusFirst` are ratified; the MCP's trusted tools focus first too (#106)) and S4 added `saveTo` (#127).
At that point 23 tools; their names and other parameters are unchanged.* *Superseded 2026-10-26 (Step 11 S4): was "Still 23 tools", because `browser_upload_file` was added (#241); `browser_click`'s description now also says to use it for a file input.*

Typical loop: `browser_snapshot()` to see refs → act by ref (`browser_click`, `browser_type`)
→ snapshot again to see the result. When the name is already known, act by locator and skip the
snapshot.

### Locators

The actions (`browser_click`, `browser_type`, `browser_hover`, `browser_select_option`,
`browser_scroll`) and `browser_wait_for` take a nested `locator` instead of a `ref`:

- `{role, name?}` — e.g. `{role: "button", name: "Sign in"}`: the role and accessible name a
  `browser_snapshot` shows (`- button "Sign in" [ref=e4]`). What a snapshot shows is what a locator
  matches.
- `{text}` — visible text, e.g. `{text: "Forgot password?"}`.
- `{css}` — a CSS selector, e.g. `{css: "#size"}`.

Each may add `nth` (0-based) to pick one of several matches; `exact: true` with `name` or `text`
makes the match case-sensitive and whole instead of a substring. Pass `ref` or `locator`, not both
(a tool error, nothing is sent); `browser_scroll` takes neither to scroll the page.
`browser_type`'s `text` stays what to type, and `browser_wait_for`'s `text` stays the page text to
wait for — a text locator is `locator: {text: …}`. `browser_wait_for({locator, state?})` waits alone
(no `text`, `seconds` or `networkIdle` with it), up to 10 s. `browser_press_key` has no target: it
presses on the focused element.

A locator searches the whole page, also past the 800 elements a `browser_snapshot` lists. When an
action's element comes after the 800th element a snapshot lists (on a page with more than 800), the
action still runs and its answer gains a last line: `Warning: this element is past the snapshot's
800-element cap — browser_snapshot does not list it.` (`mcp/src/tools/registry.ts` `CAP_WARNING_LINE`;
decisions.md · 2026-10-24 · S1's locator details are ratified; a locator past the snapshot's cap warns
(#117)). `browser_wait_for` with a `locator` gives no such line.

### Failure reports

When an action fails because the page was not as expected — `LOCATOR_NOT_FOUND`,
`LOCATOR_AMBIGUOUS`, `REF_STALE`, `OFFSCREEN`, `PAGE_ERROR`, `NAV_FAILED` or `TIMEOUT` — the tool
reads the tab once more and returns a report instead of the bare error: the message, the nearest
candidates, a window of a fresh snapshot (its refs replace the old ones), the failed network requests,
and a screenshot of the tab, as text plus an **image** Claude can see. A report that carries the
image comes back as a result **not flagged as an error**: its first line is still `<CODE>: …`, and
its last line says `The call failed (<CODE>). This result is not flagged as an error only so that the
screenshot reaches you …`, because Claude Code (2.1.309, measured) drops images from error results
(decisions.md · 2026-10-23 · An MCP failure report with a screenshot is returned as a non-error
result). A report without a screenshot stays an error. The PNG is saved under
`~/.browser-agent-bridge/failures/<time>-<handle>.png` (or `BRIDGE_FAILURES_DIR`); clear that folder
now and then. Other errors (`TAB_HELD`, `TAB_GONE`, `NOT_CONNECTED`, …) read as before. A page
exception in `browser_evaluate` (`PAGE_ERROR`) is reported this way too: the snapshot renumbers the
tab's refs and the screenshot may flash a background tab for about 1.5 s; a message of several lines
(a stack) follows the report under `Full message:`, as it was.

The screenshot is a default-mode capture, so **the failed tab flashes for about 1.5 s** if it is in
the background, like any viewport screenshot. Reading the tab is bounded by 5 s: past that a part is
listed as not attached. On a window entirely covered by other windows the screenshot cannot be taken
— the report says so after 5 s — but the bridge has already switched that window to the failed tab,
and may leave it in front for up to about 30 s before switching back.

### Tabs

Several clients can share the bridge — Claude sessions and scripts — each on its own tab. Tabs are
named by **handles** (`T1`, `T2`, …) that the daemon hands out; `browser_list_tabs` shows them:

```
T1  Inbox — https://mail.example/
T3* [claude-code #4412] Agent Bridge E2E Playground — http://localhost:8080/e2e-playground.html
T4  [export-grades.ts] Export — http://localhost:8080/export
```

`*` marks the tab you (the human) are looking at: the active tab of the last-focused normal Chrome
window. `[name]` is the actor that holds the tab; a Claude session is `claude-code #<pid>`, where
`<pid>` is its MCP server's process id.

- **This session's tab.** A tool called without `tab` acts on this session's tab. The first such call
  claims the tab you are looking at and keeps it: switching tabs in Chrome afterwards does not move it.
  `browser_select_tab({tab})`, `browser_new_tab()` and `browser_use_active_tab()` move it; passing
  `tab` to one call does not. It follows you only through `browser_use_active_tab` (and the first
  claim), which Claude calls when you ask it to work on "this tab". `browser_status` shows it as
  `Cursor: T3 "Title" — url (held by me)` (or `none yet`, or `(not open any more)`) and, when you
  look at another tab, adds `Human's active tab: T7 "Gmail" — not mine; call browser_use_active_tab
  to work there` (`— held by <actor>, not mine` when another actor holds that tab).
- **`tab`** takes a handle from `browser_list_tabs`. A tab held by another actor is refused, with the
  holder's name: `tab T3 is held by "export-grades.ts" since 12:01:33 — use browser_new_tab, or
  browser_list_tabs to pick a free tab`. A closed tab gives `tab T3 was closed — call listTabs to pick
  another tab`; this session's tab is then not replaced silently — pick another one.
- **`browser_select_tab({tab})`** claims the tab for this session and makes it this session's tab. It
  does **not** bring it on screen: the human's view stays as it is. `browser_focus_tab()` brings this
  session's tab (or `tab`) on screen and focuses its window. Both need `tab` to be free or yours.
- **A daemon restart** (a new build, or the daemon was stopped) renumbers the handles. The next call
  without `tab` claims the tab you are looking at again, and its result starts with one line:
  `Note: the bridge daemon restarted, so this session's tab was lost; it now holds T2 (the active tab).`
  An old handle passed as `tab` gets `unknown tab handle T9 — call listTabs`.
- **The network tools** keep two extra values for `tab`: `"all"` (every tab) and `"active"` (the same
  as leaving it out: this session's tab).

### Owners (leases)

Each tab has at most one owner, the actor named in `[name]`. An actor owns a tab it opened
(`browser_new_tab`, or `newTab` from a script), a tab it claimed (its first untargeted call, or
`browser_select_tab`), and a tab that a page in one of its tabs opened itself (a `target=_blank`
link or a popup — "click Export, a new tab appears" lands with the clicker; a script gets a
`leaseGranted` event for it). A tab you open yourself is unowned until someone claims it.
*Updated 2026-10-25: measured in Step 10 (Run 14 row R14-POP-1, Run 15 row R15-POP-2): when the
opener tab is in the background, Chrome named another tab as the popup's opener, so the popup stayed
unowned and no `leaseGranted` came; with the opener in front it was granted (after 150 ms). Claim such a
popup by handle (decisions.md · 2026-10-25 · S7: Run 15 stands as recorded; its follow-ups (#226)).*
*Updated 2026-10-29 (Step 13 S1; decisions.md #385): the extension now names the tab whose page opened the popup
(Chrome's `webNavigation` event, matched within 250 ms), so a background opener's popup, and a Ctrl+click or
middle-click tab, goes to the opener tab's owner. If no match comes, the tab is unowned
(`extension/test/opener-join.test.ts`).*
*Updated 2026-10-30 (Run 20, fixture pages): R20-POP-BG-3 PASS in 3 of 3 rounds (a
background opener's popup was leased to the opener's owner, 110 ms; another actor's call on it answered `TAB_HELD`; the
user ruled this the G1 check, #407), and R20-POP-FG-3 PASS (a foreground opener, 54 ms). The first-written R20-POP-BG,
-FG and -OTHER each read FAIL on two sheet clauses, one that cannot pass by construction and one that console lines
cannot bound, while their lease clause held (#406).
R20-POP-OTHER-3 is NOT MEASURED: its human leg opened no popup in 3 clicks, so a popup with no bridge caller is not
shown live.*

- Any call on a tab another actor owns fails at once with `TAB_HELD` and the owner's name; nobody
  waits for a tab. Reading the network log is the exception: `browser_network_requests` works on any
  tab, while `browser_network_clear` on another actor's tab — or `{tab:"all"}` while anyone else owns a
  tab — is refused.
- An owner keeps its tabs until its connection ends: ending a Claude session or a script frees them.
  A script can also give one up (`tab.release()`, the `tabs.release` method).
- A closed tab's handle answers `tab T3 was closed …` for an hour; a Chrome Memory-Saver discard does
  not lose the handle (Chrome gives the tab a new id, the daemon follows it), but calls into the
  discarded page fail until `browser_focus_tab` or `browser_navigate` reloads it.

### What you see while actors work

- **Nothing moves on its own.** Actors work in background tabs. A script's `newTab` opens its tab in
  the background. Claude's `browser_new_tab` opens it in front only when you are looking at this
  session's tab at that moment (you were watching Claude, so you keep watching); otherwise — including
  the session's first tab, and whenever the bridge cannot tell — it opens in the background and the
  result says `(in the background — browser_focus_tab shows it)`. *Superseded 2026-10-23: was "Claude's
  `browser_new_tab` opens it in front", because Step 8 S5 applied phase doc 0.6's rule.* No call
  brings a Chrome window to the front except `browser_focus_tab` (a script's `focusTab`) and the trusted
  input that runs it first (`trusted:true` on `browser_click`, `browser_type`, `browser_press_key`, or
  a script's trusted `click`/`type`/`pressKey`; next bullet). *Superseded 2026-10-25: was "except
  `browser_focus_tab` (a script's `focusTab`)", because Step 10 S2 made the MCP's trusted tools focus
  first (#106); the SDK's already did.*
- **A viewport screenshot of a background tab flashes it.** The bridge switches the tab's window to
  it, captures, and switches back: your tab is hidden for about 1.5 s (measured 1.49–1.59 s, Step 7
  Runs 8 and 9). The window is not brought to the front (the foreground window stayed the same in Run 9). If you
  switch tabs in that window during the flash, the bridge leaves your choice alone instead of
  switching back (barring a race of a few milliseconds).
  Screenshots from several actors take turns, one at a time.
- **Trusted input needs the tab in front, so it brings it there.** Trusted CDP input into a
  background tab returns `Clicked …` / `Typed …` but the page receives nothing (measured in Step 7,
  also with Chrome's anti-throttling flags, and in Step 8 with CDP focus emulation: Run 11 in
  `docs/e2e-test-plan.md`). So `browser_click`, `browser_type` and `browser_press_key` with
  `trusted:true` — like a script's trusted actions (see [Writing a script](#writing-a-script)) — first
  bring the tab to the front of its window and focus the window (as `browser_focus_tab` does), and
  leave it there; this session's tab does not change. Measured in Step 10's Run 15 (row MCPF-1R): on a
  background fixture tab, 9 of 9 trusted clicks, typings and key presses reached the page as trusted
  events, the tab in front. Default synthetic input never changes what you see. Focus and input are
  two calls, so another actor's screenshot in the same window could switch tabs between them (phase doc
  0.2, Stage 0 F19; not seen live). *Superseded 2026-10-29: was "can switch", because S6-G2 closed the gap in the code.* *Updated 2026-10-29 (Step 12 S6-G2): a trusted click, type or key press (not one sent with `focusEmulation`)
  now holds the visibility lock from its focus through the input and 500 ms after the reply, so another
  actor's screenshot waits (`daemon/test/s6-trusted-focus.test.ts`, G6.5 and G6.7). Live, a typed string
  arrived complete in 5 of 5 rounds under a competing capture (R19-G2-2, PASS; evidence of no harm, not a
  view of the gap itself). The timed check of the hold, R19-G2-1, FAILED: the second client's screenshot got
  `TIMEOUT` after about 35 s; its cause is not established.* The same need holds for anything that requires window focus, such
  as a clipboard write in `browser_evaluate`: call `browser_focus_tab` first. *Superseded 2026-10-25:
  was "Call `browser_focus_tab` first, or use the default synthetic input … A script's trusted actions
  focus the tab first by themselves", because Step 10 S2 made the MCP's trusted tools focus first too
  (decisions.md · 2026-10-24 · FE and `focusFirst` are ratified; the MCP's trusted tools focus first
  too (#106)).*

### Screenshots

- **Default (`switch`) mode**, the only one `browser_screenshot` uses for the viewport: the flash
  above, no banner. A minimized window is refused with `WINDOW_MINIMIZED` (`Chrome's window is
  minimized, so the tab cannot be captured — restore the window, or call focusTab first`): restore the
  window and retry. *Superseded 2026-10-24: was "The message still suggests `mode:"cdp"`, which refuses
  a minimized window too; Step 8 rewrites it", because Step 8 S2b rewrote it.* A window entirely covered by other windows cannot be captured: the call times
  out after 35 s, and the bridge puts your tab back after about 30 s.
- **`fullPage:true`** goes through CDP (`chrome.debugger`): the debugging banner shows while it runs.
- **`mode:"cdp"`** (scripts only: `tab.screenshot({mode: "cdp"})`; *superseded 2026-10-24: was
  `client.call("screenshot", {tab, mode: "cdp"})`, because Step 8 added the typed `Tab`*) captures through
  CDP without switching tabs, with the banner. It works only on a tab that is already in front of a
  window that is not minimized: a background tab is refused with `OFFSCREEN` and a minimized window
  with `WINDOW_MINIMIZED`, at once, because Chrome never returns a CDP capture of a hidden tab.

## Writing a script

*Added 2026-10-24 (Step 8). The SDK's types and JSDoc in `sdk/src/` are the reference; this section is
the tour.*

A script is a TypeScript file that imports `@bridge/sdk` and runs with `tsx` from the repo root. It is
one more client of the daemon, beside any Claude session, with its own tabs. The token comes from
`BRIDGE_TOKEN`, else `bridge.token` at the repo root — never put it in a script.

```ts
// my-script.ts — sign in on the E2E fixture page, read its status line.
import { BridgeError, connect } from "@bridge/sdk";

const client = await connect({ name: "my-script.ts" }); // finds, starts or hands over the daemon
try {
  // A new tab, in the background, leased to this script; it becomes the client's cursor.
  const tab = await client.newTab("http://localhost:8080/e2e-playground.html");
  await tab.type({ css: "#email" }, "a@b.com"); // a locator; a ref ("e4") from tab.snapshot() works too
  await tab.click({ role: "button", name: "Sign in" }); // the role and name a snapshot shows
  await tab.waitFor({ text: "form submitted" });
  console.log(await tab.evaluate<string>("document.getElementById('status').textContent"));
  await tab.close();
} catch (err) {
  if (err instanceof BridgeError) {
    console.error(`${err.code}: ${err.message}`);
    if (err.report) console.error(err.report()); // the failure report, when one was attached
  } else console.error(err);
  process.exitCode = 1;
} finally {
  client.close();
}
```

Save it under `recipes/` and run it with the fixture served (`python -m http.server 8080 --directory
test-fixtures`):

```bash
npm run recipe -- recipes/my-script.ts        # the same as: npx tsx recipes/my-script.ts
```

`recipes/sdk-login.ts` is the same flow as a complete recipe (E2E row SDK-1 — the SDK flow end to
end against the fixture, with a header saying what it needs and how it fails); `recipes/README.md` lists the others. Recipes are not part of
`npm run typecheck`: check one with a `tsconfig` in `recipes/` (`npx tsc --noEmit -p
recipes/tsconfig.s6.json` covers the Step 8 recipes).

**Connecting.** `connect({name})` resolves once the daemon has welcomed the script and the extension
is connected (it waits up to 15 s, `waitForExtensionMs`, then rejects with `NOT_CONNECTED`).
`name` is what `browser_list_tabs` and `browser_status` show as the holder. `client.close()` ends the
connection, and with it the script's leases. `connect({failureReports: false})` turns failure
reports off (below).

**Tabs and the cursor.**
- `client.newTab(url?, {active?})` opens a tab in the background (unless `active: true`; with a URL, on a blank page
  first, [Safety](#safety)), leased to
  the script, and returns a `Tab`. `client.claim("T3")` takes a free tab by handle;
  `client.claim({active: true})` takes the tab the human is looking at. `client.tabs()` lists every
  tab as `{handle, title, url, owner?, current}`, where `current` marks the human's tab.
- The client's **cursor** is the `Tab` of the last `newTab()` or `claim()`: `client.tab()` returns it,
  and `client.click(…)`, `client.type(…)` and the other `Tab` methods but `close` act on it. With no
  cursor they throw `NO_CURSOR` ("No tab cursor: call newTab() or claim() first"). Only `newTab`,
  `claim` and a daemon restart change it; `release()`, `close()` and a closed tab do not. After a
  close the next call answers `TAB_GONE`; after `release()` the cursor still names the tab, which is
  now nobody's (calls on it pass the lease check until another actor claims it, then `TAB_HELD`).
  `client.close()` closes the client; close the cursor's tab with `client.tab().close()`.
- A daemon restart (a new build) renumbers the handles: a `Tab` from before it throws `TAB_UNKNOWN`
  without calling anything, and the cursor is cleared. Open or claim the tab again.
- The `Tab` methods: `navigate`, `back`, `forward`, `snapshot`, `screenshot({fullPage?, mode?,
  path?})`, `click`, `type(target, text, {submit?, trusted?})`, `pressKey(key, {trusted?})`, `hover`,
  `scroll({target?, direction?})`, `selectOption(target, values)`, `locate`, `waitFor`, `evaluate`,
  `evaluateRef`, `evaluateToFile(expression, {path, overwrite?, timeoutMs?})`, `network`,
  `networkClear`, `download(url, path)`, `upload(target, paths, {timeoutMs?, chooser?})`, `consoleMessages({level?, limit?})`, `focus`, `close`, `release`. *Updated 2026-10-29 (Step 12 S8): the list had no `consoleMessages`, and `upload` had no `chooser`; `evaluate`, `evaluateRef` and `evaluateToFile` take `{args}`. The `Tab` has `consoleMessages` (`mcp/test/s12-console-cross.test.ts` C3.4, R19-CON-MCP; `sdk/test/s12-upload-chooser.test.ts`, `mcp/test/s12-args-cross.test.ts` B2.1). The client's cursor has it too by the code (`sdk/src/client.ts`, which hands it to the cursor's `Tab`); no test calls it on the client.* *Superseded 2026-10-25: the list
  had no `evaluateToFile`, because Step 10 S4 added it (#127, #205).* *Superseded 2026-10-26: the list had no
  `upload(target, paths, {timeoutMs?})`, because Step 11 S4 added it (#240); the client's cursor has `upload` too
  ([Uploading files](#uploading-files)).*

**Locators.** Every action takes a target: a ref from `tab.snapshot()` (`"e4"`), or a locator object
(`Locator` in `shared/src/protocol.ts`), resolved in the page by the same walk and the same role and
accessible-name rules that build the snapshot:
- `{role, name?, exact?, nth?}` — what a snapshot lists, e.g. `{role: "button", name: "Sign in"}`.
  `name` is a string (a case-insensitive substring of the name the snapshot shows; `exact: true`
  means case-sensitive equality) or `{regex, flags?}`.
- `{text, exact?, nth?}` — the innermost visible element whose text contains it (case-insensitive;
  `exact: true` means equality), interactive or not.
- `{css, nth?}` — a CSS selector; hidden elements never match.

`nth` (0-based) picks one of several matches in page order; without it two matches fail with
`LOCATOR_AMBIGUOUS` and none with `LOCATOR_NOT_FOUND`, whose `error.data.candidates` names the nearest
elements. `tab.locate(locator)` resolves one to `{ref, role, name}` without acting. A `{name}` with
no `role` is refused at once (`BAD_PARAMS`, use `{text}` or add `role`).

A locator searches past the 800 elements a `snapshot()` lists. When the element comes after the 800th
element a snapshot lists (a `snapshot()` does not show it), `tab.locate()`'s result also carries
`pastSnapshotCap: true`, and an action on such an element emits one `client.on("warning", (w) => …)`
event `{tab, method, kind: "pastSnapshotCap"}` (no locator or text; the type `BridgeWarning`) — the
action itself still resolves `undefined` (`shared/src/protocol.ts` `LocateResult`, `sdk/src/client.ts`
`on("warning")`; decisions.md · 2026-10-24 · #117; · 2026-10-25 · Stage 0: the cap warning reaches SDK
actions as a client event (#206)). `waitFor({locator})` carries no flag. On a page with 800 listable
elements or fewer nothing changes.

**Waiting and evaluating.** `tab.waitFor(…)` takes exactly one of `{text}` (page text, up to 10 s),
`{locator, state?, timeoutMs?}` (`state: "visible"` by default, `"hidden"` to wait for it to go;
default 10 s, at most 60 s), `{networkIdle: true, idleMs?}` and `{seconds}`. `tab.evaluate<T>(js)`
resolves with the value when it is plain JSON; a page exception rejects with `PAGE_ERROR`.
`tab.evaluateRef(js)` returns a ref to the `Element` the expression evaluates to — "find it with JS,
act on it with `click`" — and `BAD_PARAMS` for anything else. `tab.evaluateToFile(js, {path,
overwrite?, timeoutMs?})` writes the value to the absolute file `path` instead of returning it — the
SDK half of `browser_evaluate {saveTo}`, with the same rules ([Running JavaScript](#running-javascript))
— and resolves with `{path, bytes, kind, sha256}`, never the value (`sdk/src/tab.ts`; the client's
cursor has it too). With `{args}` (any JSON value, at most 1 MiB), the three `evaluate` methods take `expression` as one
function source and call it with `args`: `tab.evaluate("(a) => a.rows.length", {args: {rows: [1, 2]}})`; the SDK checks
`args` before any call (`mcp/test/s12-args-cross.test.ts`, third test; `shared/test/protocol-step12.test.ts`; R19-ARGS-2). Details and limits:
[Running JavaScript](#running-javascript). `tab.consoleMessages({level?, limit?})` resolves with the entries
`{level, text, ts, kind}` ([Reading the console](#reading-the-console)); `formatConsole(entries)` from `@bridge/sdk/format`
renders them as the MCP prints them (`sdk/test/s12-console-format.test.ts`).

**Failure reports.** When a `Tab` call fails because the page was not as expected —
`LOCATOR_NOT_FOUND`, `LOCATOR_AMBIGUOUS`, `REF_STALE`, `OFFSCREEN`, `PAGE_ERROR`, `NAV_FAILED` or
`TIMEOUT` — the SDK reads the tab once more and sets on the thrown `BridgeError`: `snapshot` (the tab's
snapshot just after the failure), `screenshotPath` (a PNG under `BRIDGE_FAILURES_DIR`, else
`~/.browser-agent-bridge/failures/<time>-<handle>.png`), `network` (the tab's last 20 requests), and
`attachErrors` for any part it could not get within 5 s. `error.report()` renders them in at most 60
lines: message, candidates, a window of the snapshot, the screenshot path (printed with the home folder as `~`;
`screenshotPath` itself stays absolute, #417 (c), Step 14 S1), the failed requests. Other
codes (`TAB_HELD`, `NOT_CONNECTED`, …) carry none of this. Three things to know:
- The screenshot is a default-mode capture: it takes the visibility lock like any screenshot, and
  **the failed tab comes to the front of its window for about 1.3–1.6 s** if it was in the background
  (your tab hidden 1331 ms in Step 8's Run 12, row REP-0 — the failure-report screenshot probe;
  1.49–1.59 s for plain screenshots in Runs 8–9) — the human sees it. On a window covered by other windows the report gives up after 5 s, but the
  failed tab can stay in front for up to about 30 s.
- The report's snapshot renumbers the tab's refs, like any `snapshot()`: refs from before the failure
  are void, use the report's.
- A script that works on a private site (mail, a course, a bank) should pass `failureReports: false`,
  so no screenshot or snapshot of it is written to disk; the Blackboard recipes do.

**Trusted input in a script.** `tab.click(target, {trusted: true})`, `type` and `pressKey` with
`trusted: true` send real CDP input (the debugging banner shows). Trusted input into a background
tab answers `ok` and does nothing — measured in Step 7, and again in Step 8 with Chrome's focus
emulation (Run 11) — so the SDK **focuses the tab first**: the tab comes to the front of its window,
the window is focused, and **it stays there** (decisions.md · 2026-10-23 · The background-input policy).
Without `trusted`, actions are synthetic, show no banner and work on a background tab. One case
escapes the SDK: an untrusted click or type whose synthetic path fails is retried by the extension as
trusted input, which on a background tab does nothing; pass `trusted: true` or call `tab.focus()`
when the input must land.

**Experimental surface.** `client.welcome`, `client.extensionConnected`, `client.on("reconnected", …)`,
`connect({requireExtension: false})` and the MCP's `connectOptions()` (`mcp/src/config.ts`) work and are
tested, but are **experimental** until a later release: their names or shapes may still change
(decisions.md · 2026-10-24 · The Step 6 surface names stay, marked experimental).

**What Claude sees through the MCP** is the same machinery: the [locators](#locators) on the action
tools and `browser_wait_for`, `browser_evaluate {asRef}`, the [failure reports](#failure-reports) with
their image, and this session's tab ([Tabs](#tabs)) — which never follows you except through
`browser_use_active_tab`. The MCP's trusted tools focus first, like the SDK's: `trusted:true` brings
the tab to the front of its window and leaves it there; untrusted actions never do. *Superseded
2026-10-25: was "The MCP's trusted tools do not focus first; `browser_focus_tab` is an explicit call",
because Step 10 S2 made them focus first (#106).*

### Scripts from any folder

A script does not have to live in the repo. Give its own folder the SDK and `tsx`, and it can connect to the bridge
like any other client. Needs a built checkout (`npm run setup` or `npm install`) and Node.

1. In the script's folder, in PowerShell, one command per line:

   ```powershell
   npm init -y
   npm pkg set type=module
   npm install <repo>\sdk tsx
   ```

   `type=module` lets the script use top-level `await`. The first package is a `file:` dependency: npm puts a junction
   `node_modules\@bridge\sdk` that points into your checkout. It does not bring `tsx` or fetch the SDK's own packages
   (they come from the checkout), so `tsx` is a second package from the registry, fetched once; after that nothing
   needs the network. The SDK is TypeScript source with no build, so plain `node` cannot load it: run scripts with
   `npx tsx my-script.ts`.
2. Copy `examples/list-tabs.ts` there and run `npx tsx list-tabs.ts`. It prints each tab the client may see (handle,
   holder, title) and the count. The script changes no tab and no setting; `connect()` may start the daemon, or hand
   it over to a newer build, as any client does. A tab whose title the bridge withholds (the bridge is off, or a
   blocked site) shows as `(hidden: ...)`.
3. The token is found for you. The SDK looks for `BRIDGE_TOKEN`, else `bridge.token` in the checkout it was installed
   from (it walks up from its own folder, not from the script's). Never put the token in a script.
4. To type-check, put your own `tsconfig.json` in the folder (`module` and `moduleResolution` `NodeNext`, `strict`)
   and run the checkout's compiler:

   ```powershell
   node <repo>\node_modules\typescript\bin\tsc -p .
   ```

#### Removing the folder safely

`node_modules\@bridge\sdk` is a junction into your checkout. Deleting the script's folder recursively can follow the
junction and empty the checkout's `sdk\`. Remove the junction first, in **PowerShell** (not Git Bash, whose
`cmd //c rmdir` leaves it in place):

```powershell
cmd /c rmdir node_modules\@bridge\sdk
```

Check that `<repo>\sdk\src` is still there, then delete the folder. `npm uninstall @bridge/sdk` also removes the
junction.

## The daemon

One daemon per machine holds the extension's socket; every Claude session and every script is a
client of it. It runs `node <repo>/daemon/dist/index.js`, listens on `127.0.0.1` only, and has no
console window or output — the log is its only voice.

**The log.** `~/.browser-agent-bridge/daemon.log`, one line per event, `YYYY-MM-DDTHH:MM:SSZ <message>`
in UTC: `start pid=…`, `config pid=… port=… idleMs=… build=…`, `listening on 127.0.0.1:9234`,
`client + "claude-code #1234" (1 client)`, `client - …`, and `exit <code> (<why>) …` with counts. It
holds counts, ids and names only; a line that would contain a URL or the token is replaced by
`[line withheld: contained a URL or the token]`. On start the file is cut back to its last 1 MiB.

**Which build is running.** The build id is the sha256 of `daemon/dist/index.js`. `browser_status`
prints it on its first line (`Daemon: connected on 127.0.0.1:9234 (build <sha256>, up <s>s)`), the
log prints it in the `config` line, and an SDK script gets it from `client.status()` (`daemon.status`).
Compare it with `sha256sum daemon/dist/index.js`, or `Get-FileHash daemon\dist\index.js` in
PowerShell (which prints the same hex in upper case). After `npm run build` changes that file, the
next client to connect asks the old daemon to step down (`daemon.shutdown`), starts the new one, and
the other clients reconnect to it on their own. A `/mcp` reconnect counts as a new client.

**Stopping it by hand.** There is no stop command. The daemon exits by itself after
`BRIDGE_DAEMON_IDLE_MS` (default `600000`, 10 minutes) with no clients — Chrome's extension does not
count as a client. To stop it sooner, stop its process:

```powershell
# Windows (PowerShell): the process listening on the bridge port
Get-NetTCPConnection -LocalPort 9234 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess }
```
```bash
# Linux / macOS: the node process running the daemon file
pkill -f daemon/dist/index.js
```

The PowerShell line does nothing when no daemon is listening. The `pkill` pattern matches the
default daemon file; a daemon started from a `BRIDGE_DAEMON` path (below) needs that path instead.

An open Claude session's MCP starts a new daemon 5 s after the connection drops; a running script
gets an error instead. End the sessions (and any script that would call `connect()` again) first if you want it to stay stopped. The daemon also answers a `daemon.shutdown` request (reply `{ok:true}`, then
it closes every client with code 4002 and exits 0); that is how a newer build replaces an older one,
and connected clients treat 4002 as "reconnect", so it is not a stop button either.

**Development override.** `BRIDGE_DAEMON` points clients at a different daemon file instead of
`<repo>/daemon/dist/index.js`. On Windows give a native path (`C:\…\index.js`): Node reads a Git Bash
path such as `/c/Users/…` as `C:\c\Users\…`. Every client on the machine must point at the same build:
a client with a different one replaces the running daemon (once per connect), and the clients
already connected then fail with a `VERSION` error when they reconnect.

## The debugging banner

When trusted input is used (`browser_click`, `browser_type` or `browser_press_key` with
`trusted:true`, or full-page screenshots), Chrome shows an "an extension is debugging this
browser" banner on that tab. This is expected. Since Step 12 the bridge keeps one debugger session per tab while an
agent works, so the banner stays up, steady, across a run of calls; the session is detached about 5 s after the
last call, and Chrome then takes its own few seconds to remove the banner (5.0–5.2 s measured in Step 12 Stage 0). A
disarm detaches it at once (the banner then goes within seconds; 3–14 s measured), and Cancel on the banner still
ends the session.
Default clicks/typing use synthetic events and do **not** show the banner.

*What Run 19 (2026-10-28/29, fixture pages) measured of this.* Five calls 3 s apart all answered `ok` (R19-KEEP-1; its
banner reading was not discriminating, so the steady banner itself is shown only by the keeper's tests,
`extension/test/debugger-keeper.test.ts`, D4.1). With the session left to idle the banner ended a median 5.1 s later
than when a refusal dropped the session at once (10 132 ms against 5 028 ms, R19-KEEP-2), and a call refused by the
gate while a session was kept answered with the refusal itself (R19-KEEP-3). A refused `uploadFiles` showed no banner
after 20 s of quiet (R19-UP-6, R19-F-RAW, -F-RAW-2, -F-RAW-DIR); Run 18 had read a banner on those rows,
and why the two runs differ is not shown. `browser_console_messages` and the chooser upload show it during the call
(R19-CON-BANNER, R19-CHOOSE-1); a call refused for JavaScript off, a blocked, own or `file:` page showed none
(R19-CON-JSOFF, R19-CON-3, R19-CON-OWN, R19-CON-FILE, R19-CHOOSE-JSOFF). Chrome's DevTools did not
make the bridge's calls fail in Run 19 (docked, 31 of 31 `ok`) or in Run 20 (undocked after an earlier attach, and
opened before the first attach, docked and undocked; R20-DEVT-UNDOCK, R20-DEVT-EARLY PASS). A kept session meeting
DevTools and the start-up sweep of a held tab are not shown live (R20-UP-DEVT, R20-KEEP-4, R20-SWEEP-HELD NOT RUN; R19
rows NOT MEASURED; decisions-archive/step13.md #420).

Reach for `trusted:true` when a site ignores synthetic input — some editors, canvas apps and
anti-automation checks test `event.isTrusted`. Trusted typing focuses the field and selects
its contents first, then replaces the selection with real keystrokes, so it overwrites rather
than appends; it never assigns `.value`.

## Running JavaScript

`browser_evaluate(expression, timeoutMs?)` runs an expression in the **page context** of this
session's tab (or `tab`; *superseded 2026-10-22: was "the active tab's", because of Step 7 T4's tab
argument*),
the same as typing it into the DevTools console: it sees the page's own globals, cookies and
`localStorage`, and it is **not** limited by the page's `script-src` CSP (it goes through CDP, not
`eval`).

**What comes back.** The value of the last expression, shaped for reading:

- plain data → pretty JSON you can reuse; `Map`/`Set`/`Date`/`RegExp`/`BigInt` get readable forms;
- a DOM node → a short description (`<button id="counter"> "Click counter: 0"`) plus a hint to use
  `browser_snapshot` refs to act on it — nodes are never returned as handles;
- a function → its source head; an `Error` (or a rejected promise) → a tool error with the message
  and a trimmed stack;
- cycles become `[Circular]`, and nested `undefined`/functions stay visible as `"undefined"` /
  `"[Function: name]"` rather than being dropped by JSON.

**Limits.** Depth 6, 100 items per array/object, 5 000 characters per string *nested inside* a
serialised object, and 20 000 characters of output in total. When anything is cut the output ends
with `(output truncated — …)`. Note that `maxString` (5 000) applies only to strings inside an
object: a **top-level** string is a primitive that never reaches the in-page serialiser, so it is
capped by the 20 000-character total instead.

*Added 2026-10-29 (Step 12 S8): a limit measured in Run 19.* An object the page returns comes back through the SDK's
`value` with its keys **sorted**, not in the page's order (R19-ARGS-1, FAIL: 4 of 5 values equal to what was sent,
the one object with several keys reordered). The row's own reading is that Chrome's `returnByValue` does this, so it
predates Step 12 and is not an `args` defect; that reading is from Stage 0 and the code, not from a live print. Through the MCP
the printed text kept the page's order, 5 of 5 (R19-ARGS-1, `via=mcp`); the sorted keys are the SDK's `value` only.
*Superseded 2026-10-30: was "its keys sorted", because Step 13 S2 fixed it.* The extension now carries the result across
as one JSON string, so `value` comes back in the page's key order (`extension/test/s13-envelope.test.ts`,
`extension/test/s12-args-cdp.test.ts`). Run 20 read it live: the SDK leg of R20-ARGS-ORDER returned a value equal to what
was sent in 5 of 5 (Run 19: 4 of 5) and R20-0's loaded-build line read `keys=page`. R20-ARGS-ORDER's printed verdict is
RECORD, not PASS (its open conflict is with the user); this note cites the leg, not a PASS for the row.

**Passing data in: `args`.** *Added 2026-10-29 (Step 12).* `browser_evaluate {expression, args}` (SDK `tab.evaluate`,
`evaluateRef`, `evaluateToFile` with `{args}`) takes any JSON value of at most 1 MiB and calls `expression`, which must
be one function expression with no trailing `;`, with `args` as its one argument: `"(a) => a.rows.length"`. Nothing of
`args` is written into the expression string, so there is no quoting to get wrong; the value goes to Chrome as a JSON
string argument (round trip of nested, Unicode and `null` values: `extension/test/s12-args-cdp.test.ts`, B2.1). What
Run 19 measured on fixture pages:
- **No page global is left behind**: after the call the page has no `args` global, no function global and no new own
  key on `window` (R19-ARGS-GLOBAL, PASS; `extension/test/s12-args-cdp.test.ts`, "no page global").
- **Refused before anything runs**, `BAD_PARAMS` with no part of the value in the message: a value `JSON.stringify` would
  drop or turn into `null`, a value over 1 MiB, a source that is not a function; eleven refusals read exactly, and the
  page's effect counter did not move (R19-ARGS-2, PASS; `shared/test/protocol-step12.test.ts`).
- **A page whose CSP forbids `eval`** answers the call like any other (R19-ARGS-CSP, PASS).
- **A loop is stopped at `timeoutMs`**: a call with `timeoutMs` 1 500 answered `TIMEOUT` after 1 516 ms and the page
  answered the next call (R19-ARGS-STOP, PASS; the pause-and-terminate step is tested in
  `extension/test/s12-args-call.test.ts`).
- **JavaScript off** refuses it `JS_DISABLED` before any attach (`extension/test/s12-args-cdp.test.ts`, B2.2). The live
  row R19-ARGS-3 FAILED on its MCP leg, because the sheet expected the extension's message where the MCP prints its own
  one-line refusal (`mcp/test/safety.test.ts`); so the MCP's live refusal of `args` was not shown in Run 19. *Updated 2026-10-30: Run 20 showed it, the MCP's own line, exact (R20-ARGS-3, PASS).*
- **An extension older than Step 12** is refused `VERSION` with a reload hint, nothing forwarded
  (`mcp/test/s12-args-cross.test.ts`, B2.3; `daemon/test/s12-args-feature.test.ts`). Live, the MCP leg of
  R19-ARGS-OLD was not discriminating (it looked for a `VERSION` code on line 1 of an error text that has none), so the
  live MCP text was not shown in Run 19. *Updated 2026-10-30: Run 20 re-read it with a reader that matches the MCP's own
  line and the text was exact (R20-ARGS-OLD, PASS).* Reload the extension ([Troubleshooting](#troubleshooting)).

**Bulk data goes to a file: `saveTo`.** Everything `browser_evaluate` returns enters the model's
context (and the session's transcript on disk). `browser_evaluate {saveTo: <absolute path>,
overwrite?}` writes the value to that file instead (a string as is, anything else as JSON, without the
result limits below, up to 256 MiB) and answers only

```
Saved <path>
<bytes> bytes · <kind> · sha256 <hex>
```

where `<kind>` is `string` or `json` — no part of the value (`mcp/src/tools/registry.ts`, the
`browser_evaluate` handler). The file is UTF-8 without a BOM (a lone surrogate becomes U+FFFD); a
non-string value is `JSON.stringify`'d in the page. The path must be absolute and its folder must
exist (nothing is created); an existing file is replaced only with `overwrite: true`; the file is
written to `<path>.part` and moved into place at the end, so a failure leaves no file. Refused with
`BAD_PARAMS` before anything is read: a relative path, an existing directory, a missing parent folder,
an existing file without `overwrite`, an existing `<path>.part`, and `asRef` with `saveTo`
(`browser_evaluate takes asRef or saveTo, not both — saveTo writes the value to a file, asRef returns a
ref to an element`); refused `BAD_PARAMS` by the page side: a value that is `undefined`, a function, a
symbol, a `Map`, a `Set` or a DOM node; `PAGE_ERROR` when `JSON.stringify` throws (a cycle)
(decisions.md · 2026-10-25 · Stage 0: `saveTo`'s file rules are stricter than `browser_download`'s
(#207)). Produce a very large value with `return …`: it is then read out of the page in 1 MiB slices,
while a bare string expression crosses Chrome's debugger as one piece (`sdk/src/tab.ts`
`evaluateToFile`; #217). The value waits in the extension's memory between slices (5 minutes without a pull,
8 values, 256 MiB) and is dropped when you turn the bridge off, turn JavaScript off or close the tab
(`extension/src/evaluate-save-store.ts`). The tool description says it plainly: `Paging bulk data
through browser_evaluate in chunks is a test device only, never a supported pattern: pass saveTo to
write a large value to a file instead.` From a script the same is `await tab.evaluateToFile(expression,
{path})` ([Writing a script](#writing-a-script)). Measured in Step 10's Run 15 on fixture pages: 1 MiB,
4 MiB, 2 MiB with astral characters across a slice boundary, a JSON value past the result limits, a
418 754-byte synthetic export and a 64 MiB primitive each saved with the page's own sha256 (rows SAVE-*);
a refusal the bridge itself raises for `saveTo` (a value refusal, the in-session size cap) reaches you with its text
unchanged, with no `[chrome.debugger] ` in front (`markOwnRefusal`, `extension/src/debugger-errors.ts`; decisions.md ·
2026-10-25 · S1: the marked set is the `saveTo` value refusals and the cap; the save leg's breakdowns keep the prefix
(#254)). The prefix stays on the save leg's `INTERNAL` failures, its transfer `TIMEOUT`, a raw Chrome error and a page
error; the stringify `PAGE_ERROR` is a value refusal and has none. Run 16's row SAVE-REFUSE-R measured it live and
passed; the `saveTo` description names the answer's `kind`. *Superseded 2026-10-26 (Step 11 S1; the user ruled #227
option (b), #229): was "a refusal's message then read `[chrome.debugger] …` in front of the text, the code and data
right", because Step 10's Run 15 (row SAVE-REFUSE) measured that prefix and it was kept for a while (decisions.md ·
2026-10-25 · S7: SAVE-REFUSE's `[chrome.debugger] ` prefix — the product stays for now; a fix is offered (#227)).* *Superseded 2026-10-25: was "**Not for bulk data.** … Read bulk data with a
script … or save a file with `browser_download`", because Step 10 S4 built `saveTo` (decisions.md ·
2026-10-24 · Bulk data through `browser_evaluate` was a test device only; the MCP gets a `saveTo` path
(#127)) and S8 retired the chunked recipe that paged Step 8's SDK-7 export through it (53 calls of 8 000
characters, a transport test).*

**`return` and `await`.** Top-level `await` works, and so does a multi-statement script whose last
expression is the value (`const a = 1; a + 1` → `2`). A bare `return` is also accepted: the bridge
wraps the code in an async function when it spots a `return` keyword. That is a regex heuristic, not
a parser — a false positive only costs you the completion-value behaviour.

**Errors.** Thrown exceptions and rejected promises arrive as tool errors with the message and
stack. A syntax error arrives as a plain `SyntaxError: …` with **no** line/column information (under
`replMode` Chrome reports it as an exception object, not a compile-time position).

**Timeouts.** `timeoutMs` defaults to 10 000 and is clamped to 100…60 000; the daemon waits 5 s
longer (the SDK client 1 s more), so a long evaluate is not cut short by the bridge's own call timeout. On expiry the debugger
detaches and you get `Timed out after Ns …` — but **work the page already started keeps running**
(a `fetch` in flight is not cancelled).

**The banner.** Every call uses `chrome.debugger`, so Chrome shows the "an extension is debugging
this browser" banner, exactly like `trusted:true` input: it stays while calls follow each other and goes
some seconds after the last one ([The debugging banner](#the-debugging-banner)).

**The JavaScript switch.** Untick **Allow JavaScript (browser_evaluate)** in the options page and
every `browser_evaluate` (with `asRef` or `saveTo` too) is refused `JS_DISABLED`, while every other
tool except `browser_console_messages` (refused too) keeps working; the Blackboard recipes need it ticked. See [Safety](#the-javascript-switch).
*Superseded 2026-10-25: was "refused `DISARMED` with scope `evaluate`", because Step 10 S4b gave
"JavaScript is off" its own code (#202, #219).*

**`userGesture`.** The expression runs with transient user activation, so popups, autoplay and other
gesture-gated APIs work — but activation is **not window focus**. Anything gated on
`document.hasFocus()`, notably `navigator.clipboard.writeText`, still fails with `NotAllowedError`
while the Chrome window is in the background, which is the normal state while an agent drives it.
Focus the window (`browser_focus_tab`) if you need those. *Superseded 2026-10-22: was "(e.g.
`browser_select_tab`)", because since Step 7 T4 `browser_select_tab` no longer changes the screen.*

**It reads the DOM, not the accessibility tree.** `document.querySelectorAll("button")` lists hidden
and `aria-hidden` elements that `browser_snapshot` deliberately prunes. Useful, but don't treat the
two as the same view of the page.

## Reading the console

*Added 2026-10-29 (Step 12 S3, run live in Run 19 on fixture pages).* `browser_console_messages({level?, limit?})` (SDK
`tab.consoleMessages({level?, limit?})`) returns the console messages and uncaught errors Chrome kept for the tab's page,
those logged before the call included, as entries `{level, text, ts, kind}`. The MCP prints one line each, oldest first:
`<UTC time> <level> [uncaught] <text>` (`sdk/test/s12-console-format.test.ts`); a page with none gives `No console
messages.` (R19-CON-MCP, PASS). It reads Chrome's own record: nothing is put into the page, and the banner shows while it
reads and is gone after (R19-CON-BANNER, PASS; one debugger session that only enables and disables the console,
`extension/test/s12-console-gate.test.ts`, "allowed").
- **What comes back.** A page that logged 10 messages and threw once returned 11 entries in time order; `limit: 3` gave
  the newest 3 and `level: "error"` the 2 errors (R19-CON-1, PASS). An uncaught error and an unhandled promise rejection
  are `uncaught` entries (R19-CON-2, R19-CON-REJ, PASS). A text over 2000 characters is cut at 2000 (R19-CON-BIG, PASS).
  After the page navigates, only the new page's messages come back (R19-CON-NAV, PASS). A second read in the same
  session returns the same entries (R19-CON-KEPT, PASS).
- **No source.** An entry holds no URL and no stack (R19-CON-1, `url=0 stack=0`; `extension/test/s12-console-reduce.test.ts`).
  An entry whose source is a blocked site or a bridge page is dropped before anything is stripped (same test file);
  live, a message from a same-site frame whose address was on the block list was dropped, and a frame in another site's
  process was not read at all (R19-CON-FRAME, PASS). The tool's description says the same since Step 13 S3b (R20-CON-DESC,
  PASS; `mcp/test/s12-console-cross.test.ts`).
- **Refusals** are the ones `browser_snapshot` gives, plus JavaScript off: `JS_DISABLED` while JavaScript is off
  (R19-CON-JSOFF, PASS), `DOMAIN_BLOCKED` on a blocked site, a bridge page or a `file:` page (R19-CON-3, R19-CON-OWN,
  R19-CON-FILE, PASS), `DISARMED` while the bridge is off (tested, `extension/test/s12-console-gate.test.ts`, C3.2; the
  live row R19-CON-4 was not discriminating in Run 19; *updated 2026-10-30: R20-CON-4, PASS*).
- **Messages from before the bridge was switched on** are not returned: the floor moves at each arm and at the worker's
  start (`extension/test/s12-console-reduce.test.ts`, "the arm floor"). The live row R19-CON-FLOOR did not make its
  precondition (the driver kept the old waits), so it was not discriminating. *Updated 2026-10-30: Run 20 showed the floor live (R20-CON-FLOOR, PASS).*
- **The MCP text is capped at 20 000 characters**: 200 messages of 2000 characters came back as 9 lines, 18 278 characters
  and one marker line, `… [truncated: 191 more lines, the newest — narrow with level/limit]` (R19-CON-CAP, PASS;
  `sdk/test/s12-console-cap.test.ts`). It kept the **oldest** lines. *Superseded 2026-10-30: was "keeps the oldest
  lines; whether it should keep the newest is open", because the user ruled it (#374 item 6) and Step 13 S3b built it.*
  The cap now keeps the **newest** whole lines, prints them oldest first, and opens with one marker line,
  `… [truncated: <n> older lines cut — narrow with level/limit]`, where `<n>` is the number of lines cut (#398;
  `sdk/test/s12-console-cap.test.ts`, `sdk/src/format/console-messages.ts`). Run 20: 200 entries of 2000 characters came
  back as the newest 9 lines plus the marker, indexes 192 to 200 (R20-CON-CAP, PASS); `limit: 3` printed 3 lines and no
  marker.
- **Limit: an object logged before the read shows as `Object`.** Chrome's replay of earlier messages carries no preview
  of an object's contents, so `console.log({e: new Error("x")})` read later gives its class name, not the message of
  the error inside (R19-CON-NOTEA, FAIL; a product finding with no leak: `url=0 stack=0`). The `Object` reading and its cause are from
  Stage 0 (`stage0-m1-C.txt`) and the code; the live row shows the error's text absent from the reply (`marker=0`) and
  no line prints the entry's text. Objects logged while a read is running were not measured through this tool.
  *Updated 2026-10-30: this is now the documented limit, not a defect to fix (#387; the user allowed a limit, #374 item 5).*
  The tool's description says it: "An object logged before this call shows its class name only, not its contents."
  (`mcp/src/tools/registry.ts`, checked). Run 20 re-measured it as R20-CON-NOTEA, PASS as the documented limit: the
  inner error's text stayed out of the reply (`marker=0`), and the path that would read the contents was not built, so
  that part of the row is NOT REACHABLE.

## Inspecting network requests

`browser_network_requests()` lists what the tab has been talking to. Capture is **always on** and
banner-free — the extension observes `chrome.webRequest`, so there is no `chrome.debugger` attach and
no "extension is debugging this browser" banner — and it behaves like the DevTools Network panel with
**Preserve log** ticked: the log is per **tab** and a navigation does *not* clear it.

**What a line shows.** One line per request, oldest first, newest 50 by default:

```
Network — active tab: showing 3 of 212 (recording since 3m12s ago; 1 pending)
[3893]  2.8s ago   GET     200  document    5ms  12.9 KB  http://localhost:8080/e2e-playground.html
[3894]  2.8s ago   GET     200  xhr         3ms  28 B     http://localhost:8080/ok.json
[3899]  2.8s ago   GET     ERR  xhr         2.0s  —       http://127.0.0.1:9999/  net::ERR_CONNECTION_REFUSED
Use filter/types/failedOnly to narrow, limit to widen, id for one request's headers and body.
```

Id, age, method, status (`ERR` for a network failure, `···` while pending), resource type, duration,
size (`content-length` when the server sent one) and the URL, with the `net::ERR_*` or a redirect's
`→ <target>` after it. A redirect chain is one line per hop: `3900`, then `3900:2`.

**The workflow that answers "what did my click do":** `browser_network_clear()` → act →
`browser_network_requests()`. Clearing the active tab does not reset `recording since`; only
`browser_network_clear({tab:"all"})` does.

**Waiting for the tab to go quiet.** `browser_wait_for({networkIdle: true})` returns once the active
tab has made no request for `idleMs` (default 500, `100`…`10000`), giving up after 10 s. It reads the
same log, so it is *activity*-based, not pending-based: a long poll, an EventSource or a request to a
black-hole address stays pending for its whole life and does **not** block it. A tab the log has
recorded nothing for — including right after the extension's service worker restarts, since the
last-activity timestamp is in memory only — counts as idle and returns immediately.

**Narrowing.** `filter` matches the URL as a case-insensitive substring, or as a regex when you wrap
it in slashes (`"/ok\\.json|nope/"`, flags allowed: `"/OK/i"`). `types` keeps the resource types you
name and accepts the DevTools aliases (`xhr`/`fetch` → `xmlhttprequest`, `document` → `main_frame`,
`frame` → `sub_frame`). `failedOnly` keeps network errors and status ≥ 400. `limit` is clamped to
1…500. `tab` takes a handle from `browser_list_tabs`, or `"all"` (which adds a `tab:<handle>` column;
a request no tab can be named for, such as a site's service worker, shows `tab:-1`). Without `tab`
the listing is this session's tab and its header still reads `Network — active tab: …`. *Superseded
2026-10-22: was "a tab id … a `tab:<id>` column", because Step 7 T4 shows handles, never Chrome ids.*

**One request in full.** `browser_network_requests({id: "3894"})` prints that request's headers and
request-body summary:

```
[3894] GET http://localhost:8080/ok.json
type: xhr   initiator: http://localhost:8080   started 5.8s ago   took 3ms
status: 200 OK   from cache: no   ip: ::1   size: 28 B
request headers:
  accept: */*
response headers:
  content-type: application/json
```

This is the **only** way to see headers: `includeHeaders` keeps them on the structured result, but
the text the tool prints is the table, which has no header columns. Ids are Chrome's `requestId`s and
are only unique **within a capture session** — if the extension's service worker restarts, the
counter can start low again, so an id from an older listing may fail to resolve or (rarely) point at
a different request. Look the id up soon after the listing that gave it to you.

**What is not available.** Response bodies (re-fetch with `browser_evaluate` if you need one),
request bodies beyond a ≤ 2 KB redacted summary, WebSocket frames, transfer size and the timing
breakdown (DNS/TLS/TTFB). Also note:

- A network-level status is not the same as a successful `fetch()`. An opaque `no-cors` response is a
  perfectly good 200 here while the page can read nothing from it, and a 200 whose JSON the page then
  rejects still logs as 200. Conversely, a CORS-blocked `fetch` shows up as `net::ERR_FAILED` on
  current Chrome, not as the response the server actually sent.
- Requests a site's own service worker makes are not attributable to a tab; they land in a `tabId -1`
  bucket, visible only with `tab:"all"`.
- Streams (EventSource, long polls) stay `pending` for their whole life; the header's `N pending`
  counts only requests started in the last 30 s.
- `data:` / `blob:` URLs never touch the network and never appear.

**Bounds.** 500 entries per tab and 2 000 in total; when the total cap is hit the oldest entry of the
*largest* tab is evicted, so one chatty background tab cannot push the tab you care about out of the
log. Closing a tab forgets its entries. The log lives in the extension's session storage and is gone
when Chrome exits or the extension is reloaded.

## Uploading files

`browser_upload_file` (MCP) and `tab.upload()` / `client.upload()` (SDK) put local files into a page's file
input, as if you had picked them in the file dialog. Chrome itself reads the files (`DOM.setFileInputFiles`
through the debugger, so the debugging banner shows briefly); no file bytes cross the bridge. The tab is
not brought to the front, and the call does not take the visibility lock (phase doc 0.6,
`docs/plans/2026-10-25-step11-file-upload.md`).

**Before the first upload you must do two things in Chrome, once.** Both are yours alone; no agent, tool
or token holder can do either:
1. Add the folder(s) the files live in to **Upload folders** on the extension's options page
   ([Safety → Upload folders](#upload-folders)). The list is empty by default, so every upload is refused
   until you do.
2. Turn on **Allow access to file URLs** for the extension: `chrome://extensions` → the extension's
   *Details*. Chrome refuses `DOM.setFileInputFiles` ("Not allowed") to a client that may not read local
   files, which for an extension is this toggle (Stage 0 F1, `docs/plans/2026-10-25-step11-file-upload-steps/stage0-cdp.txt`;
   decisions.md · 2026-10-25 · Stage 0: uploads need Chrome's file access, and the bridge never opens
   or reads `file:` pages (#245)). Changing the toggle reloads the extension. Run 16 found it already on; with it off the bridge refuses with the second text in the table below.

**From Claude.** `browser_upload_file(ref | locator, paths, tab?, chooser?)`, with `paths` 1 to 20 absolute file
paths (more than one only if the input is `multiple`). Its description, as the model reads it
(`mcp/src/tools/registry.ts:613`):

```text
Put one or more local files into a file input — an <input type="file">, a label for one, or an element holding exactly one (the hidden input behind an "Attach" button or drop zone) — found by ref or `locator` in this session's tab (the active tab is claimed on first use) or `tab`, as if the user had picked them in the file dialog. `paths` are absolute file paths on this computer; Chrome reads the files itself. The upload works on a background tab: the tab is not brought to the front. Every file must lie in a folder the user allowed in Chrome (extension options → Upload folders), and the user must have turned on "Allow access to file URLs" for the extension (chrome://extensions → the extension's Details); otherwise the answer is UPLOAD_REFUSED — then stop and ask the user, and never retry with another path. Shows Chrome's 'is debugging this browser' banner briefly. Never click a file input (browser_click): that opens a native file dialog the bridge cannot see or close. The answer lists each file's name, size and sha256 as read on this computer: it says what Chrome accepted, which is not proof that the page received them — check the page (e.g. browser_snapshot) to confirm. With chooser=true, ref or locator may instead be the button or link whose click opens the page's own file dialog: the bridge clicks it and puts the files into that dialog's input without showing the dialog — still only files in the Upload folders, and refused (JS_DISABLED) while JavaScript is off for the bridge.
```

The answer is `Uploaded <n> file(s) to <target>:` and one line per file, `<name> · <bytes> bytes · sha256
<hex>`, the name being the real file's basename; it shows no directory. `browser_click`'s description
now tells the model to use this tool instead of clicking a file input.

**From a script.** `await tab.upload(target, paths, {timeoutMs?, chooser?})` (`target` is a ref or a
[locator](#locators); `paths` a string or an array) resolves with `{files: [{name, bytes, sha256}]}`; the
client's cursor has `client.upload(…)` (`sdk/src/tab.ts`, `sdk/src/client.ts`). Before any call the SDK
checks each path (absolute, an existing regular file, readable; otherwise `BAD_PARAMS` naming the entry's
index, never its path, and no call is made) and sends each file's **real path** (`fs.promises.realpath`),
so a link or junction inside an allowed folder that points out of it is refused by the folder rule. The
sha256 is of the bytes the client read. The SDK check is a convenience and the real-path step, not the
boundary; the folder rule is the extension's.

**A button that opens the file dialog: `chooser`.** *Added 2026-10-28 (Step 12 S5; decisions.md #325, #336, #353).*
Some pages have no file input an agent can target, only an "Upload" button whose click opens Chrome's file
dialog. Pass `chooser: true` (MCP `chooser=true`, SDK `tab.upload(target, paths, {chooser: true})`) and target that
button or link. In one call the bridge tells Chrome to hand the dialog to it instead of showing it, clicks the
button, puts the files into the input the dialog belongs to, and gives the dialog back to Chrome, so your own clicks
open the dialog as usual again. *Superseded 2026-10-29: was "(built, not yet run live; Run 19 checks it)", because Run 19 ran it: R19-CHOOSE-1, R19-CHOOSE-4 PASS (below).* What you see: the debugging banner for the call, and no file dialog. It works on a
tab in the background. The rules are the ones above: only files in your Upload folders, Allow access to file URLs on,
the same answer. It is refused `JS_DISABLED` while JavaScript is off for the bridge, because the click runs in the
page. If no dialog opens within 5 s of the click, the answer is `TIMEOUT` and nothing is uploaded; a page that opens
its own file picker (not a file input) is refused `BAD_PARAMS`. A second `chooser` call on the same tab while one
runs is refused `DEBUGGER_DEVTOOLS` with its own text, which names no DevTools: "uploadFiles: another file chooser upload is still running on this tab; retry after it ends" (*superseded 2026-10-30: was a text that said to close DevTools even when none was open, because Step 13 S4 gave this case its own text, #389;* `extension/test/s5a-chooser.test.ts`; Run 20: call 2 answered it in 7 ms with `names-devtools=no`, R20-CHOOSE-TWICE PASS; the MCP prints it bare with `isError`, `mcp/test/s13-chooser-busy.test.ts`). Without `chooser` an
upload is exactly as before. `chooser` needs the extension reloaded after the update: to an older extension the
bridge sends nothing and answers `VERSION` "the Chrome extension is an older build without the file chooser upload —
reload it at chrome://extensions" (decisions.md #355).

*Run 19 (2026-10-28/29, fixture pages) and the tests, sentence by sentence.*
- **The file reaches the page and no dialog shows** (`dialog=0`), by locator and by ref on a button, and for a label,
  the input itself and two files into a `multiple` input; the page's tab was in the background and the banner showed
  (R19-CHOOSE-1, R19-CHOOSE-LABEL, PASS).
- **Refused with nothing uploaded**: a file outside the Upload folders `UPLOAD_REFUSED`, a missing file `BAD_PARAMS`
  (R19-CHOOSE-2, PASS); JavaScript off `JS_DISABLED` with no click made (R19-CHOOSE-JSOFF, PASS); the bridge turned off
  during the wait `DISARMED` once the 5 s were up (R19-CHOOSE-DISARM, PASS); no dialog in 5 s `TIMEOUT` after 5 022 ms
  (R19-CHOOSE-3, PASS). A button that opens a picker with no input, a single-file input given two files, a folder input
  and a disabled input are refused `BAD_PARAMS`; that is tested (`extension/test/s5a-chooser.test.ts`, "the chooser's
  own input rules"), and the live row R19-CHOOSE-REFUSE was not discriminating (its disabled-input leg cannot open a
  chooser on that page, decisions.md #370). *Updated 2026-10-30: Run 20 used a page whose own control turns the input
  disabled after the chooser opens, and the call was refused `BAD_PARAMS` live (R20-CHOOSE-REFUSE-DIS, PASS).*
- **Chrome's own dialog is given back**: after each call (`ok`, `TIMEOUT`, `BAD_PARAMS`) a click made like yours opened
  Chrome's normal dialog, which the wave then closed (R19-CHOOSE-4, PASS).
- **The MCP form** put the file in, timed out and refused as the SDK does, in Run 16's answer form (R19-CHOOSE-MCP, PASS;
  `mcp/test/s12-upload-chooser.test.ts`). **Without `chooser`** the call sent is exactly as before (the same test file,
  first test; `sdk/test/s12-upload-chooser.test.ts`).
- **Old extension.** The `VERSION` refusal is tested (`daemon/test/s12-chooser-feature.test.ts`); the live row
  R19-VERSION is not discriminating on its MCP leg (it looked for a `VERSION` code on line 1 of an error text that has
  none), so the live MCP text is not yet shown. *Updated 2026-10-30: Run 20 re-read it with a reader that matches the MCP's own
  line and the MCP text was exact (R20-VERSION, PASS).*
- **Not shown: a second call with the same file.** Two `chooser` calls with the same file on one page left the page's `change`
  count at 1, not 2 (R19-CHOOSE-KEPT, FAIL; cause not established, so whether the second set of files reached the
  input is not known). *Updated 2026-10-30: Run 20 re-measured it as a RECORD (R20-CHOOSE-KEPT): a different second file
  fired `change` (2); an identical second selection fires no `input` or `change` and `cancel` fires, which is Chrome's
  rule for an unchanged selection (the record's reading; the row is a RECORD, not a PASS).*

**The answer is not proof.** It says what Chrome accepted. A page that clears its input on `change`, or
rejects the file in its own script, still gets an ok. Judge success by the page (Run 16 judged every upload
row by the page's own reporter, by hash).

**Which element receives the files.** An `<input type="file">`; a `<label>` for one; or an element that
holds exactly one (the hidden input behind an "Attach" button or a drop zone; open shadow roots and
same-origin frames included). Anything else is refused `BAD_PARAMS` before the attach, and so are a disabled
input, a folder input (`webkitdirectory`), more paths than a single-file input takes, and two file inputs under
one element. No paths or more than 20 are refused `BAD_PARAMS` by the SDK's check before anything is sent (the MCP's
input schema rejects them first, and the caller sees the MCP SDK's "Input validation error: Invalid arguments for
tool browser_upload_file" instead of the code); a raw client sending them gets `UPLOAD_REFUSED` at the gate. `accept` is not enforced.

**The refusal: `UPLOAD_REFUSED`.** It means the bridge will not upload, for one of two causes:
- a file is **not inside any folder you listed** under Upload folders (an empty list too), or
- Chrome has **not allowed this extension file access** ("Allow access to file URLs" is off).

It is not exhaustive: malformed paths (relative, `..` parts, network and device paths, reserved names) also
refuse at the gate, which a raw client can reach (from the SDK or the MCP a relative path is `BAD_PARAMS` from
the preflight, and `..` is resolved by `realpath` before sending). A folder on a `subst` or mapped drive may
also refuse, because the file's real path may then resolve past the drive letter and not be inside the folder
you typed (not measured live; S4 verifier). The text depends on
where it is read:

| Where | Text | Source |
|---|---|---|
| Folder rule, on the wire | `That file is not in a folder the user allows for uploads in Chrome (extension options → Upload folders); the bridge will not upload it. Ask the user.` | `extension/src/safety.ts:225` |
| File access off, on the wire | `Chrome does not allow this extension to read local files (chrome://extensions → Browser Agent Bridge → Details → Allow access to file URLs), so the bridge cannot upload. Ask the user.` | `extension/src/upload-files.ts:37` |
| The one line the SDK's `safetyRefusalLine` and the MCP show, either cause | `UPLOAD_REFUSED: the bridge will not upload that file — either it is not in a folder the user allows for uploads in Chrome (extension options → Upload folders), or the user has not turned on "Allow access to file URLs" for the extension (chrome://extensions → the extension's Details). Stop and ask the user; do not retry with another path.` | `sdk/src/error.ts:136` |

The refusal is a safety refusal like `DOMAIN_BLOCKED`: no failure report, no screenshot; a script should stop
and ask, not retry ([Safety → For scripts](#for-scripts)). Other refusals an upload can meet: a blocked site,
a tab showing a `file:` page and the bridge's own pages answer `DOMAIN_BLOCKED`, the kill switch `DISARMED`.
Turning JavaScript off does not stop an upload, except one with `chooser` (above).

**Known limits** (recorded, not fixed; phase doc Open items; decisions.md · 2026-10-25 · Stage 0: who the
folder rule protects against, and the broad-folder warning (#250)):
- An agent that can also run programs on this computer can copy a file into an allowed folder, or drive the
  options page; the folder rule binds an agent whose only reach is the bridge.
- A refusal tells an agent which of its paths are not allowed.
- A raw client that skips the SDK can skip the real-path step. Since Step 11b the extension checks
  that each file exists before the page gets anything and refuses a missing (or unreadable) one, naming only its
  position in the list (#288; Run 16 row UP-RAW had answered ok). *Superseded 2026-10-26: was "a raw upload of a
  missing file inside an allowed folder answered ok … a question for you", because S0F-b checks each file (#299).*
- A file changed between the SDK's read and Chrome's read gives a hash that is not what the page got.
- A refusal raised after the CDP call (you turn the bridge off, or remove the folder, during the call) can
  leave the file in the page.
- Never click a file input: that opens a native dialog the bridge cannot see. Drag-and-drop zones with no
  file input behind them, and a per-upload confirmation mode, are not built.
- An upload to a tab in the background works: Run 16 row UP-1 received the file with no focus.
- With `chooser` (decisions.md #353). *Superseded 2026-10-29: was "by construction, not yet measured live; Run 19 checks them", because Run 19 measured three of them (HUMAN, LATE, DISARM) and added a fourth (FRAME); only the dialog-just-before point and the after-the-files point are by construction.*
  - If you click an upload button **on the same tab** during the 5 s the call waits, your click may be the one the
    call answers: your dialog does not show and the agent's files go into the input you clicked (still only files
    from your Upload folders). Measured once: the call's file went to the input the human-style click opened and no
    dialog showed (R19-CHOOSE-HUMAN, RECORD). A dialog you open on that tab just before the call's click does not
    show either, and is released when the call ends, so your click seems to do nothing (by construction, not measured).
  - A page that tries to open its dialog late shows no dialog, as without `chooser`: when the page's click came 4 900 ms
    after the call's click, the call was answered `ok`; at 5 100 ms the page's click opened no chooser at all and the
    call got `TIMEOUT`; no dialog showed in either (R19-CHOOSE-LATE, PASS, `dialog=0`).
  - A same-origin frame's file input is reached by the click (R19-CHOOSE-FRAME, RECORD).
  - Turning the bridge off during the 5 s wait ends the call with `DISARMED` only when the 5 s are up (`ms=5025`);
    nothing is uploaded (R19-CHOOSE-DISARM, PASS).
  - Turning the bridge or JavaScript off just after the files were put in answers `DISARMED` or `JS_DISABLED`, though
    the page has the files (as the bullet on refusals after the CDP call above).

## Safety

Since Step 9 (Phase E), three controls in Chrome let you stop agents, take JavaScript away from them,
or keep them off chosen sites; since Step 11 a fourth setting, [Upload folders](#upload-folders), decides
which folders agents may upload files from (none by default). They are enforced inside the extension, so they hold whatever a client,
the daemon or anyone holding the token does: no tool, SDK call or daemon method can change them; only
you can, in Chrome (decisions.md · 2026-10-24 · Phase E's design: the kill switch, the disarmed state,
blocked sites, the JavaScript switch). The defaults — on, JavaScript allowed, no blocked sites — behave
as the bridge did before Step 9, except that the bridge never opens extension pages (see "The bridge
never opens its own pages" below). Row IDs below (`SAFE-2`, `SAFE-7d`, …) name rows of the live test
plan, `docs/e2e-test-plan.md` §4.20, whose results are Run 13 in §5.

### The kill switch: three ways to turn the bridge off

- **The toolbar button** "Browser Agent Bridge". One click turns the bridge off, the next turns it on.
  **Pin it** (the puzzle-piece Extensions menu → the pin beside Browser Agent Bridge): until it is
  pinned, Chrome may keep it inside that menu, one click further away from when you need it.
- **The shortcut `Alt+Shift+K`** does the same as a click. It is the extension's "Activate the
  extension" command (`_execute_action`; decisions.md · 2026-10-24 · The shortcut is
  `_execute_action`). Change or clear it at `chrome://extensions/shortcuts`; the options page has a
  button, **Change the keyboard shortcut**, that opens it. Measured on Chrome 156, Windows 11: the
  shortcut was assigned when the extension loaded, and pressing it left the Windows keyboard layout
  unchanged (Run 13, row SAFE-2).
- **The options page**, box **Safety**: **Bridge on (agents may use this browser)** and **Allow
  JavaScript (browser_evaluate)**. Both save as soon as you tick or untick them.

A press that would turn the bridge back on within 1 s of turning it off is ignored, so a double-click
leaves it off; turning off is never ignored (decisions.md · 2026-10-24 · A re-arm right after a disarm
is ignored). The state lives in the extension's `chrome.storage.local`, so what you turned off stays off
across a reload of the extension (measured: Run 13, row SAFE-9) and, because `storage.local` is kept,
across an update of the extension or a restart of Chrome (by construction; not measured). A reload
closes an open options page.

**The badge and the title** (hover over the button) show the state; `OFF` wins over `JS`
(decisions.md · 2026-10-24 · Badge and title; `extension/src/badge.ts`):

| Badge | Title | Meaning |
|---|---|---|
| none | `Browser Agent Bridge — armed (click to turn off)` | On; agents may work |
| `JS` (amber) | `Browser Agent Bridge — armed, JavaScript off (click to turn off)` | On, JavaScript switch off |
| `OFF` (red) | `Browser Agent Bridge — OFF: agents are refused (click to turn on)` | Off |
| `OFF` (red) | `… OFF: the safety state cannot be read, so agents are refused (check the options page)` | See [When the state cannot be read or saved](#when-the-state-cannot-be-read-or-saved) |
| `OFF` (red) | `… OFF, but not saved (storage write failed): …` / `… OFF: turning on failed (storage write failed), …` | Same |

*Added 2026-10-24 (Step 9 propagator): on hover Chrome 156 shows its own second line under these titles, e.g.
`Has access to this site` (Run 13 record, SAFE-1 (4) and SAFE-9); the first line is the extension's.*

### What agents see while the bridge is off

- **Every call that reads or acts on a page is refused** with the code `DISARMED` and `data:
  {scope: "all"}` — navigation, snapshots, screenshots, every action, waits, `evaluate`, `locate`, the
  network tools, downloads, `focusTab` and `closeTab`. The extension's message is "The user has turned
  the bridge off in Chrome, so every page call is refused. Stop and ask the user to turn it back on; do
  not retry." Claude sees one line instead of a failure report (no screenshot, no snapshot): `DISARMED:
  the user has turned the bridge off in Chrome. Stop and ask the user to turn it back on; do not retry.`
  (`sdk/src/error.ts` `safetyRefusalLine`; Run 13 row SAFE-1, verbatim).
- **Still answered:** `browser_status` adds a line `Safety: DISARMED by the user · JavaScript on · 0
  blocked sites` (while armed: `Safety: armed · …`; before the extension reports: `Safety: not reported
  (reload the extension)`). *Corrected 2026-10-24 (Step 9 propagator): was "adds a line" in every case; as built
  the `Safety:` line is a second text item of the result, sent only while the extension is connected — with Chrome
  or the extension down there is no `Safety:` line at all, not `not reported` (Run 13 showed the second item in
  headless Claude sessions' transcripts, SAFE-1 (3)) — see `docs/plans/2026-10-24-step9-phase-e-safety-asbuilt.md`
  § Stage S3 / decisions.md · 2026-10-24 · S3: `browser_status`'s Safety line is a second text item, shown only
  while the extension is connected (#162).* `browser_list_tabs` keeps the handles, the `*` and the owners, but every
  tab reads `(hidden: the bridge is off)` — no title, no URL. The daemon withholds URLs and titles from
  its status rows and tab events while off. Claiming a tab still works, but a lease grants nothing:
  every call on the tab is refused. The connection stays up.
- **Work already running stops.** The disarm detaches every debugger session the bridge holds, ends
  running waits and drops downloads held for pickup. Measured in Run 13: a trusted `type` stopped 14 ms
  after the press, but Chrome's "is debugging this browser" banner was still shown 3 s later and gone by
  14 s (row SAFE-4 (b)); a running `waitFor` was refused 54–92 ms after the press (SAFE-4 (a), 4c).
  *Updated 2026-10-25: Step 10's Run 14 measured it again (row R14-4b): the `type` stopped 5 ms after
  the press, the banner was gone between 4.7 s and 5.0 s after it, and a trusted call after the re-arm
  worked on the same tab.*
- **The network log records nothing while off.** Requests recorded before stay, and the network tools
  show them again once you turn the bridge back on.

### The JavaScript switch

With **Allow JavaScript (browser_evaluate)** unticked, `browser_evaluate` (with or without `asRef`, with
or without `saveTo`; the SDK's `tab.evaluate`, `tab.evaluateRef` and `tab.evaluateToFile`) and a
`browser_navigate`/`browser_new_tab` to a `javascript:`, `data:` or `blob:` URL are refused with the
code `JS_DISABLED`, with no `data`; so is `browser_console_messages` (Step 12); every other tool keeps working (decisions.md · 2026-10-24 · The user
rules on the 32 Step 9 open decisions; Step 9 closes (#202); · Script URLs and the JavaScript switch; own
pages of every extension). The extension's message is "The user has turned JavaScript off for the bridge
in Chrome (browser_evaluate and script URLs are refused). Every other tool still works; ask the user
before relying on browser_evaluate." (`browser_console_messages` is refused too, though this text predates it.) Claude sees one line instead of a failure report (no screenshot, no
snapshot): `JS_DISABLED: the user has turned JavaScript off for the bridge in Chrome, so evaluate
(browser_evaluate) is refused; every other call still works. Ask the user before relying on it; do not
retry it.` (`extension/src/safety.ts` `JS_DISABLED_MESSAGE`; `sdk/src/error.ts` `safetyRefusalLine`). The
badge shows `JS`. Turning the bridge off overrides it: while the bridge is off these calls answer
`DISARMED` (scope `all`), like every other call. With JavaScript on, script URLs behave as before; Chrome
itself answers a `javascript:` navigation through the bridge with `NAV_FAILED` and leaves the page
unchanged (Run 13 row SAFE-6c).
*Superseded 2026-10-25: was "are refused `DISARMED` with `data: {scope: "evaluate"}` … Claude sees:
`DISARMED: the user has turned JavaScript off …`", because Step 10 S4b gave "JavaScript is off" its own
code, `JS_DISABLED` (#202, which changed decisions.md · 2026-10-24 · The JavaScript switch reuses
`DISARMED` with a scope). The message and the line's words after the code are unchanged. An extension not
yet reloaded since Step 9 still answers `DISARMED` with `data: {scope: "evaluate"}`, and Claude then sees
Step 9's line, `DISARMED: the user has turned JavaScript off …` (the same words) — reload the extension.*

**The Blackboard recipes need JavaScript on.** `recipes/blackboard/boot-bb.ts` loads `bb.js` into the
course tab by `evaluate`, and `export-grades.ts` reads the gradebook by `evaluate`; with the switch off
they stop with `JS_DISABLED`. *Superseded 2026-10-25: was "`DISARMED` (scope `evaluate`)", because of
Step 10 S4b (#202).*

### Blocked sites

The options page's **Blocked sites** box takes one pattern per line; **Save blocked sites** stores
them. The grammar (decisions.md · 2026-10-24 · The block-list grammar; · S1: Matcher details §5 leaves
implicit; `extension/src/safety-match.ts`):

| Line | Blocks |
|---|---|
| `bank.example` | `bank.example` and every subdomain (`www.bank.example`, `a.b.bank.example`), any port. Not `notbank.example`, not `bank.example.evil.test`: matching is only at a dot boundary |
| `*.bank.example` | subdomains only, not `bank.example` itself |
| `bank.example:8443` | only that port. The port is the effective one (80 for `http`, 443 for `https`), so `bank.example:443` blocks `https://bank.example/` |
| `https://www.bank.example/login?next=1` | a pasted `http`/`https`/`ws`/`wss` address is reduced to its host (and a non-default port): the whole host `www.bank.example` |
| an IPv4 address, or an IPv6 address in brackets | only that address (`*.` never goes before an address) |
| `# a comment`, an empty line | nothing |

Case does not matter, a trailing dot is ignored, and a non-ASCII name is matched in its punycode form.
An address is tested by its host and effective port; `blob:`, `filesystem:` and `view-source:`
addresses by the address inside them; a `file://server/…` address by its server; an address with no
host (`about:`, `data:`, `chrome:`, `file:///…`) never matches. Any other line is **invalid**: it is
kept in the box, listed in red as `Line <n>: “<text>” — not a site pattern: write a host
(bank.example), *.host for its subdomains only, host:port, an IP address, or paste an http(s) address`,
matches nothing and is not counted. The summary under the box counts the valid lines, e.g. `1 blocked
site. 1 invalid line is not counted (marked below).` (Run 13 row SAFE-OPT-1). Agents see only that
count (`browser_status`, `client.safety()`), never the patterns. If the list needs more of Chrome's blocking
rules than Chrome allows, or a very long site name with a port or `*.` may make a rule Chrome rejects, the box
shows a warning (naming line numbers only), because while such a list is saved agent navigations and downloads
are refused.

What a blocked site means for agents:
- Every call on a tab whose address (or the address it is loading) is blocked is refused
  `DOMAIN_BLOCKED`; so is a navigation, a new tab or a download to a blocked address. The messages
  never name the site or the pattern. Claude sees `DOMAIN_BLOCKED: the user has blocked this site for
  the bridge in Chrome. Stop and ask the user; do not retry, and do not try to reach the site another
  way.`
- `browser_list_tabs` shows such a tab as `(hidden: blocked site)`; tab events and the daemon drop its
  URL and title.
- The network log drops every request whose address, redirect address or initiator is blocked, or
  whose tab shows a blocked site — when it records and again at every query, so a pattern added later
  also hides older entries.
- A tab that moves onto a blocked site during a call gets its reply refused, and every later call.
- A blocked tab can still be claimed; every call on it is refused (decisions.md · 2026-10-24 ·
  `tabs.claim` on a blocked tab is granted, every call on it refused).

**What the block list does not do.** It is not a network firewall. It refuses bridge calls on a tab
whose top-level address is blocked, and navigations the bridge itself starts to one. It does not stop
a page from loading a blocked site: script on an allowed page (an agent's `evaluate` included), a meta
refresh or a link can make Chrome load it with your cookies; the bridge refuses to read or act there
only afterwards. A bridge `back`/`forward` holds the rules since Step 11b (below; measured on a redirect hop, R17B-BACK, R17B-FWD). *Superseded 2026-10-27: was "A redirect hop is still requested … blocking the hop
itself would need a `declarativeNetRequest` rule, which is not built", because Step 11b built the rule (Run 17 RD-1,
RD-3).*

*Redirects, since Step 11b.* While a bridge `navigate`, `browser_new_tab` with a URL, `back`, `forward` or
`downloadStart` runs, the extension holds a Chrome
network rule (`declarativeNetRequest`, built from your list), so a redirect hop that lands on a blocked host is
never sent. Run 17 measured it on fixture servers: the blocked server saw 0 requests for a `browser_navigate`
(row RD-1) and for a `browser_download` (RD-3), with the same answers as before (`DOMAIN_BLOCKED`, no file);
before Step 11b it saw 1 (Run 13 SAFE-5b, Run 14 R14-5c). The rules follow your list: with the pattern
removed, the same redirect loads (RD-4), and a pattern added just before or during a call counts (RD-5, RD-5b).
Run 17b measured more calls on fixture servers (the back rows use a server that answers 200, then 302 to the blocked server):
- `browser_new_tab` with a URL is covered: the tab opens on a blank page, the rules go in, then it goes to the URL.
  The blocked server saw 0 requests (R17B-RD-2; Run 17 RD-2 saw 1). The tab's first address reads `about:blank`,
  its history has one more entry (by design, #311; not measured), and a slow page still makes the call wait for the page's load (R17B-NEWTAB-LOAD:
  five 3 s pages, replies after 3074-3102 ms).
- `back` and `forward` hold the rules too. Measured once each, on a history whose pages had a user activation
  (without one, `back` cannot run at all; see below): the blocked server saw 0 requests and the answer was
  `DOMAIN_BLOCKED` (R17B-BACK, R17B-FWD); the rules read 0 after each reply.
What is still not covered:
- Your own browsing: the rules cover only a bridge call in flight (decisions.md · 2026-10-26 · #290, 0.4 (C)); a
  page you load yourself still reaches a blocked host (RD-6: the blocked server saw 1).
- Requests a page starts by itself after a bridge call ends, such as a script or a meta refresh (phase doc 0.9).

*Superseded 2026-10-27: was "`browser_new_tab` with a URL: its first request still goes out (RD-2 …; #295)", "`back` and
`forward` … Run 17 did not measure a redirect through them", and "or `back`/`forward` can make Chrome load it" (in the
paragraph above), because S6 (`browser_new_tab` opens a blank page first) and Run 17b measured them (R17B-RD-2,
R17B-BACK, R17B-FWD).*

`back` and `forward` have a separate limit, not caused by Step 11b: Chrome's back skips pages no human acted on, so
a history the bridge built alone cannot be gone back through (`INTERNAL`, "Cannot find a next page in history.",
26 of 26 in a scratch Chrome; #308; Run 17b R17B-BACK-NOACT: `INTERNAL` again, message length equal, 1 of 1). A bridge `back`/`forward`
therefore reaches only pages a human, or a call that gave the page an activation (the bridge's own `evaluate`:
R17B-ACT-CTL, `ok` 4 of 4), acted on.

The download's check of its final address was first measured in Step 10's Run 14 (row R14-5c): a download
redirected onto a blocked host was refused `DOMAIN_BLOCKED` with no file written, and the test server saw the
redirect hop and the target each requested once (before Step 11b's rule). *Superseded
2026-10-25: was "unit-tested but **not yet measured live**: Run 13's redirect test timed out on its own
test server, and Step 10 measures it again (decisions.md · 2026-10-24 · S4: SAFE-5c's redirect half,
SAFE-POP-1, SAFE-3 and SAFE-4(b) are re-measured in the next live wave (Step 10))", because Run 14
measured it on a threaded test server (decisions.md · 2026-10-25 · S1: Run 14's results stand as
recorded (#210)).* Finally, a blocked site framed inside an allowed page is
not in that page's snapshot (cross-origin frames are never walked), but **it shows in a screenshot** of
the allowed page.

### Upload folders

Since Step 11, a fourth setting lives beside the block list: the options page's **Upload folders** box. It
holds the folders agents may upload files from ([Uploading files](#uploading-files)). It is **empty by
default, so every upload is refused until you add a folder**. Like the other settings it is read from
`storage.local` per call and only the options page writes it (**Save upload folders**); no wire, daemon, SDK
or MCP method can read or change it (decisions.md · 2026-10-25 · S3: the Upload folders box (#269)).

The box's label is `Folders agents may upload files from, one absolute path per line (empty: no uploads)`
(`extension/options.html:51`). The page shows this warning above it
(`extension/src/options-model.ts`, `UPLOAD_FOLDERS_WARNING`):

```text
An agent may upload any file inside these folders to any site it can open. Allow only folders that hold files you mean to share. A home folder, or a folder that holds home folders, is refused; never allow a folder that holds bridge.token or a .ssh folder. An agent that can also run programs on this computer can put any file into an allowed folder.
```

One absolute folder path per line, from the drive letter (`C:\Users\you\Uploads`) or from `/`. A blank line
and a line starting with `#` are ignored; lines are taken exactly as typed (a line that starts or ends with a
space is invalid); one trailing separator is allowed. A file is allowed only when its real path lies
strictly inside a listed folder at a separator boundary (`C:\Up\x` is not inside `C:\Uploads`); drive-letter
paths compare without regard to case, POSIX paths exactly. A folder's subfolders count.

Since Step 11b, a home folder, or a folder that holds home folders, is refused: any drive's `Users` or
`Documents and Settings` (or a short name such as `DOCUME~1`) and a folder directly inside it, `/home`, `/Users`,
`/var/home`, `/System/Volumes/Data/Users` and a folder directly inside each, and `/root`, `/var/root` and
`/private/var/root`, in any letter case. Such a line is invalid, and the
bridge never uses it, even one saved before this rule (decisions.md · 2026-10-26 · The user rules Step 11's gate;
Step 11 closes (#288) item 3b). A folder inside your home, such as `C:\Users\you\Uploads`, is allowed.
*Superseded 2026-10-26: was "a home folder, or a folder that holds home folders" among the lines **warned, not
refused**, because S0F-a refuses them (#288 3b, #298).*

The page marks each invalid line by its number with one of these reasons (`options-model.ts`, the `UPLOAD_*_REASON`
constants), and the line is not used:
- `a whole drive or the filesystem root is never allowed`
- `starts or ends with a space: a folder is taken exactly as typed`
- `not an absolute folder path: write it from the drive letter (C:\…) or from / (/home/…)`
- `not an allowed folder path: no network (\\server) or device paths, no . or .. parts, no doubled separators, no backslash in a / path, no <>"|?* characters or reserved names (CON, NUL, …)`
- `a home folder, or a folder that holds home folders, is never allowed: every file in it (keys, tokens, documents) could be uploaded. Allow a folder inside it instead`

A valid line inside a `.ssh` folder is **warned, not refused** (decisions.md · 2026-10-25 · Stage 0: who the
folder rule protects against, and the broad-folder warning (#250)); the page shows this next to the line
(`options-model.ts`, `UPLOAD_SSH_WARNING`):
- `a .ssh folder, or a folder inside one: it holds private keys`

Under the box a summary reads `No upload folder: every upload is refused.` or the count, `1 upload folder.` or
`<n> upload folders.`, and, when lines are invalid, adds `1 invalid line is not used (marked below).` or `<n> invalid
lines are not used (marked below).` (`options-model.ts:196-199`). If the saved folders change elsewhere while you
edit, the page says:

`The saved folders were changed elsewhere while you were editing; Save replaces them with the text shown here.`

(`options.ts:93`).

What the folder rule does not stop: an agent with a shell on this computer can copy a file into an allowed
folder or drive the options page itself. Allow only folders that hold what you mean to share, never a
folder with `bridge.token` or `.ssh` (a home folder is refused, above). If the setting cannot be read (a wrong-typed value),
the bridge fails closed as for the other settings: every call is refused `DISARMED` ([When the state cannot
be read or saved](#when-the-state-cannot-be-read-or-saved)).

### The bridge never opens local files

Since Step 11 (decisions.md · 2026-10-25 · Stage 0: uploads need Chrome's file access, and the bridge never
opens or reads `file:` pages (#245); · S2: the `file:` rule's edges (#259)): with **Allow access to file URLs** on, a
tab could show a `file:` page and the bridge would read any local file past the folder rule. So, whether the
toggle is on or off, the bridge refuses every tab call on a tab showing a `file:` page (`closeTab` and
`focusTab` included), and every `browser_navigate` / `browser_new_tab` to a `file:` URL, with
`DOMAIN_BLOCKED`:
- `This tab shows a local file (a file: page), which the bridge never reads or acts on.` (`extension/src/safety.ts:218`)
- `The bridge never opens local files (file: URLs).` (`extension/src/safety.ts:220`)

Since Step 11b, `browser_list_tabs` lists a `file:` tab as it lists a tab on a blocked site, `(hidden: blocked
site)`, without its URL or title, and tab events drop them too (design spec §10, the 2026-10-26 note). A
`browser_download` to a `file:` URL keeps its own `BAD_PARAMS`. You can still open a `file:` page yourself;
agents just cannot act on it. *Superseded 2026-10-26: was "`browser_list_tabs` still lists a `file:` tab with its
URL", because S0F-a hides it (#288 3d).*

### The bridge never opens its own pages

Not configurable: every call on a tab that shows one of this extension's own pages (its options page)
is refused `DOMAIN_BLOCKED` ("This tab shows one of the bridge extension's own pages, which the bridge
never reads or acts on."), and that tab is listed as a blocked site. A navigation or a new tab to
**any** `chrome-extension://` address, of any extension, is refused `DOMAIN_BLOCKED` ("The bridge
never opens extension pages."), also when it is written as a relative address that would resolve to
one (Run 13 rows SAFE-7, SAFE-REL-1). So an agent cannot open the options page to turn itself back on
or empty the list. The settings themselves are closed to page-adjacent code (`chrome.storage.local`
locked to the extension's trusted contexts; built, not measured live — row ACL-1 was not run), and
`chrome://extensions` is out of reach of every
extension (a trusted click there answered `RESTRICTED_URL`, row SAFE-7d) (decisions.md · 2026-10-24 ·
Script URLs and the JavaScript switch; own pages of every extension; · The state is read per call,
fails closed, and is locked to trusted contexts).

### When the state cannot be read or saved

The bridge fails closed: when in doubt, it is off.
- **Cannot be read** (storage fails, or a stored value has the wrong type): every page call is refused
  `DISARMED` ("The bridge could not read its safety state in Chrome, so it refuses the call. Ask the
  user to check the extension."), the badge shows `OFF` with the "cannot be read" title, and the
  options page says `The safety state cannot be read, so agents are refused.` The extension sends no
  state to the daemon meanwhile, so `browser_status` shows the last state it heard, or `not reported`
  on a fresh connection (decisions.md ·
  2026-10-24 · The state is read per call, fails closed, and is locked to trusted contexts; · S2a:
  storage keys, and a wrong-typed value makes the state unreadable; · S2a: no `safetyState` is sent
  while the state cannot be read).
- **Turning off could not be saved** (the storage write failed twice): the bridge is off anyway, held
  in the service worker's memory, every call refused, and the title says `OFF, but not saved (storage
  write failed)`. That lasts until the service worker restarts and reads storage again — then the
  bridge is on. The options page meanwhile shows the stored state (`Bridge armed.`, the switch ticked);
  press the button or untick the switch again (decisions.md · 2026-10-24 · S2a: a disarm whose write
  fails twice returns `"write-failed"` and stays disarmed in memory; the options page showing the stored state is finding F4 of Step 9's stage
S2b verifier, `docs/plans/2026-10-24-step9-phase-e-safety-steps/S2b-verifier.md`).
- **Turning on could not be saved**: the bridge stays off, the title says `turning on failed`, and the
  next press tries again (decisions.md · 2026-10-24 · S2c: a rejected re-arm write returns memory to
  disarmed without counting as a disarm).
- An options-page switch that fails to save says so (`Could not save the bridge switch (storage write
  failed). Showing the stored state.`); a block list that fails to save keeps your text.

An options page left open in a background window may not show a change made elsewhere (the button,
the shortcut) until you bring it to the front (Run 13 row SAFE-3; cause not determined). The badge is
the reliable indicator. *Updated 2026-10-25: with the options window visible beside the window you
click in, the page showed `Bridge armed.` within 2 s of a toolbar re-arm, without a reload (Step 10's
Run 15, row R15-3R); the background-window case is as Run 13 found it.*

### For scripts

`await client.safety()` returns `{armed, evaluate, blockedCount}` as the daemon last heard it, or
`null` before the extension has reported; `client.on("safetyStatus", (s) => …)` fires on every change.
Both are read-only. A refused call throws a `BridgeError` with `code` `DISARMED` (`data.scope` `"all"`),
`JS_DISABLED` (no `data`), `DOMAIN_BLOCKED` or, for an upload, `UPLOAD_REFUSED` (no `data`), with no failure report attached (no screenshot, no
snapshot) and no `report` property; the one line Claude sees is `safetyRefusalLine(err.code, err.data)` from
`@bridge/sdk/report` (decisions.md · 2026-10-24 · S3: Safety refusals get no `report` property; the
wording is `safetyRefusalLine` on `@bridge/sdk/report`). `client.tabs()` marks withheld rows with `hidden:
"disarmed" | "blocked"`, their `title` and `url` then `""`. A script should stop and ask, not retry.
*Superseded 2026-10-25: was "`DISARMED` (`data.scope` `"all"` or `"evaluate"`) or `DOMAIN_BLOCKED`",
because Step 10 S4b added `JS_DISABLED` (#202); only an extension not reloaded since Step 9 still sends
scope `"evaluate"`.* *Superseded 2026-10-26: was "`JS_DISABLED` (no `data`) or `DOMAIN_BLOCKED`", because Step 11
S2 added `UPLOAD_REFUSED` (#237).*

## Security notes

- The WebSocket binds to `127.0.0.1` only and requires the shared token.
- A Claude session's first call without `tab` claims **the tab you are looking at** and keeps acting
  on it, and any actor can claim any unowned tab by handle — so it can touch sensitive tabs (banking,
  email). Be aware of what is in front when a session starts, and what is unowned. *Superseded
  2026-10-23: was "the agent acts on whatever tab is active", because since Step 7 a session keeps its
  own tab and other tabs are reached by handle.*
- **`browser_evaluate` is the sharpest tool here.** It runs with the full authority of the
  logged-in page, plus a user gesture — anything you could do in that tab's DevTools console the
  agent can do: read tokens out of `localStorage`, call authenticated APIs with the page's cookies,
  submit forms, open popups, write the clipboard. Untick **Allow JavaScript** in the options page to
  refuse it while keeping every other tool except `browser_console_messages` ([Safety](#safety)).
  Neither the expression nor its result is ever logged — the service worker records only the
  expression's length. *Superseded 2026-10-24: was "The localhost bind and the shared token remain
  the only boundary; there is no per-domain allow-list yet (an arm/disarm toggle is on the roadmap)",
  because Step 9 added the kill switch, the JavaScript switch and blocked sites.*
- **Your controls in Chrome** ([Safety](#safety)): the toolbar button or `Alt+Shift+K` turns the
  bridge off, the JavaScript switch takes `browser_evaluate` away, and the block list keeps agents off
  chosen sites. They are enforced in the extension, so they hold even against someone holding the
  token. The block list is not a network firewall: see [what it does not
  do](#blocked-sites).
- **Network capture records URLs, and URLs carry secrets.** `browser_network_requests` keeps the
  **whole query string** — that is what makes it useful for debugging an API — so an
  `?access_token=…` in a URL will reach the model, the same way `browser_evaluate` can read
  `localStorage`. Clear the log (`browser_network_clear({tab:"all"})`) after working on a sensitive
  tab if that matters to you.
- **Cookies never enter the extension.** The `webRequest` listeners deliberately omit
  `extraHeaders`, so Chrome does not hand over `Cookie` / `Set-Cookie` at all — stronger than
  redacting them. (The same omission costs us `Referer` and `Origin`, which is an accepted trade.)
  On top of that, `authorization`, `x-api-key`, `x-csrf-token` and any header whose name contains
  `token`, `secret` or `session` are replaced with `<redacted>` **at ingest**, so only the redacted
  form is ever stored; form fields named like `password`, `token`, `secret`, `otp` or `code` are
  redacted in the request-body summary the same way. Headers and bodies are returned only when you
  ask for them (`includeHeaders`, or an `id` lookup).
- **Nothing network-related is logged.** The service-worker console prints entry *counts* only —
  never a URL, a header value or a body — and neither the MCP nor the daemon writes anything about network
  entries (the daemon's log holds counts, ids and names only).

## Troubleshooting

- **Start with `browser_status`.** It tells you which part is broken: the daemon
  (`Daemon: not connected` plus a `Problem:` line), the extension (not connected), or neither (then
  look at the active tab it reports).
- **Every call answers `DISARMED`, `browser_evaluate` answers `JS_DISABLED`, or one tab answers
  `DOMAIN_BLOCKED`**: the bridge is off, JavaScript is off, or the site is on your block list — your
  own controls, working as meant. Check the badge and the `Safety:` line of `browser_status`; see
  [Safety](#safety). *Superseded 2026-10-25: was "JavaScript is off (scope `evaluate`)" under
  `DISARMED`, because Step 10 S4b added `JS_DISABLED` (#202, #219).*
- **`browser_upload_file` answers `UPLOAD_REFUSED`**: the file is not in a folder you listed under Upload folders
  (empty by default), or Allow access to file URLs is off — see [Uploading files](#uploading-files).
- **"No welcome from 127.0.0.1:9234 within 2 s after hello: a pre-Step-6 bridge server holds port
  9234"** from `browser_status` or any tool: an old Claude session still runs the previous bridge
  server. End that session, or stop the process listening on the port (`Stop-Process -Id
  (Get-NetTCPConnection -LocalPort 9234 -State Listen).OwningProcess` in PowerShell). The MCP never
  crashes on this; it retries every 5 s and connects on its own once the port is free.
- **Tools report a different build than you just built, or `VERSION`**: see
  [Which build is running](#the-daemon). Two checkouts or a `BRIDGE_DAEMON` override on the same
  port fight over the one daemon; point every client at the same `daemon/dist/index.js`.
- **"Could not reach the bridge daemon on 127.0.0.1:9234 within 10 s … — see …daemon.log"**: the
  daemon did not start or did not bind. Read the last lines of `~/.browser-agent-bridge/daemon.log`
  (for example `cannot listen on port …`, or no `start` line at all when node could not run the file).
- **"Extension not connected"** from a tool: make sure Chrome is open, the extension is
  enabled, and the Options token/port match the bridge token (`BRIDGE_TOKEN` or `bridge.token`) and `BRIDGE_PORT` the daemon uses.
  Check the service-worker console for `connection: up`.
- **Chrome is closed**: `browser_status` shows `Daemon: connected …` and `Extension: not
  connected — …`, and every other tool fails at once with `Extension not connected — is Chrome open
  and the Browser Agent Bridge extension enabled?`. Open Chrome and the next call works — nothing
  restarts. (*Superseded 2026-10-22: was "`Daemon: not connected` with `Problem: Extension not
  connected — … (waited 15000 ms on port 9234)`", with tools saying `connecting to the bridge
  daemon…` for ~15 s and a new attempt about every 20 s, because the MCP now connects to the daemon
  without waiting for the extension (decisions.md · 2026-10-22 #27).*)
- **Chrome was killed / crashed while connected**: the daemon pings the extension every 30 s and
  drops a socket that misses a pong, so within ~60 s tools report "not connected" instead of
  timing out for 30 s each. Relaunch Chrome and it reconnects by itself.
- **A tool errors with "restricted URL"**: the tab is a `chrome://` page, the New
  Tab page, or the Chrome Web Store, where extensions can't run. Navigate it to a normal page, or
  pick another tab (`browser_select_tab`). *Superseded 2026-10-22: was "the active tab … Switch to a
  normal page", because since Step 7 T4 tools act on this session's tab, not on whatever is active.*
- **A tool errors with `tab T3 is held by "…"`**: another actor (named in the message) holds that
  tab. Open your own (`browser_new_tab`) or pick a free one from `browser_list_tabs`. The first call
  of a session fails this way when another actor already holds the tab you are looking at.
- **"No normal Chrome window is focused (a DevTools or popup window may have focus)"**: there is no
  normal Chrome window to take "the tab you are looking at" from. Click a normal Chrome window and
  retry. (A focused DevTools window alone does not cause it: the bridge reads the last-focused
  *normal* window.)
- **`VERSION` with "the Chrome extension is an older build — reload it at chrome://extensions"** (or, on an
  evaluate call with `args`, "…an older build without evaluate args — reload it at chrome://extensions", or on an
  upload with `chooser`, "…an older build without the file chooser upload — reload it at chrome://extensions"): the
  daemon was rebuilt but Chrome still runs the old extension. Reload it (§4). The daemon refuses before forwarding
  anything (`daemon/test/s12-args-feature.test.ts`, `daemon/test/s12-chooser-feature.test.ts`). Through the MCP the tool
  fails with the same reload text (`mcp/test/s12-args-cross.test.ts`, B2.3); the live rows R19-ARGS-OLD and R19-VERSION
  did not discriminate on that MCP leg in Run 19. *Updated 2026-10-30: Run 20 showed its exact printed form live
  (R20-ARGS-OLD, R20-VERSION, PASS).*
- **`trusted:true` "succeeds" but nothing happens on the page**: the tab was not in front when the
  input ran (see [What you see](#what-you-see-while-actors-work)) — the trusted tools focus first, and since Step 12
  the daemon holds the lock across the focus and the input (not for a call sent with `focusEmulation`), so another actor's screenshot waits
  (`daemon/test/s6-trusted-focus.test.ts`; the live timing row R19-G2-1 failed, cause not established); retry, or `browser_focus_tab` and retry. An untrusted action whose synthetic
  path failed is retried as trusted input by the extension without focusing: pass `trusted:true`.
  *Superseded 2026-10-25: was "the tab is in the background …; `browser_focus_tab` first", because
  Step 10 S2 made the trusted tools focus first (#106).*
- **A screenshot fails with `TIMEOUT` after 35 s**: the tab's window is entirely covered by other
  windows, so Chrome produces no frame to capture; uncover it (your tab is put back after ~30 s).
- **"The tab was discarded by Chrome's Memory Saver"**: Chrome unloaded the tab; `browser_focus_tab`
  or `browser_navigate` reloads it.
- **"Chrome DevTools (or another extension) is already attached to this tab"**: another
  debugger client holds the tab's debugger, so the trusted action cannot attach. Close that client on the tab and retry.
  *Measured 2026-10-30 (Chrome 156, fixture pages):* neither DevTools undocked and opened after an earlier attach
  (R20-DEVT-UNDOCK, PASS) nor DevTools opened before the bridge's first attach, docked or undocked (R20-DEVT-EARLY, PASS),
  made the bridge's attach refuse; each call answered `ok` with a bridge-independent control showing DevTools open. So
  DevTools does not take the tab from the bridge in these cases; the message is still produced for another extension's
  debugger (not measured). The overlap case, two
  bridge calls on one tab at once, answers it (R19-KEEP-OVERLAP, PASS). *Updated 2026-10-30: a second `chooser` upload on
  a tab no longer uses this message; it has its own text (see [Uploading files](#uploading-files), R20-CHOOSE-TWICE).*
- **"The debugging session was cancelled mid-action"**: someone clicked **Cancel** on the
  "is debugging this browser" banner while a trusted action was running (the service-worker console
  logs `debugger detached … canceled_by_user`). Just retry.
- **Connection drops when idle**: the offscreen document should keep it alive; if it still
  drops, reload the extension from `chrome://extensions`.
- **"ref … is outside the viewport after scrolling"**: a `trusted:true` action could not bring
  the element on screen (a fixed overlay, a scroll container that will not move, or a viewport
  too small for it). CDP dispatches at absolute viewport coordinates and does not clamp, so
  rather than click nothing the bridge reports this. Close the overlay, scroll manually, or use
  the default (non-trusted) action, which targets the element directly and needs no coordinates.
  Note that page zoom and HiDPI scaling need no correction — coordinates are CSS pixels and
  Chrome accounts for both.
