# Browser Agent Bridge

Let an AI agent use your **real, already-logged-in Chrome**: the browser you use every day, with your accounts, cookies
and extensions, not a fresh empty one.

Browser Agent Bridge is a Chrome extension plus a small program on your own computer. An AI agent such as Claude (or
a script you write) asks the program to read a page, click, type, scroll, take a screenshot or run a bit of
JavaScript, and the extension does it in your Chrome. Everything stays on your machine: the extension talks only to
the program on `127.0.0.1`, and you can switch the whole thing off with one click.

> Think of it as "Playwright MCP, but pointed at your real logged-in Chrome."

## Why it exists

Since Chrome 136 (May 2025), Chrome refuses `--remote-debugging-port` on your default profile. That broke the usual
way to automate it (Playwright, Puppeteer, Selenium). This project gets back in from inside the profile, as an
extension you install and can remove, with controls only you can change.

## Who it is for

- **People who use Claude** (Claude Code or Claude Desktop) and want it to work in the sites they are already signed
  in to: read an inbox, fill in a form, pull a report, check an order.
- **Developers** who want a script, in TypeScript, to drive their own logged-in Chrome (a typed SDK, locators by role
  and name, failure reports that include a screenshot).

It is not for running agents on other people's browsers or over the internet. The bridge listens on your own machine
only.

## Install

Three routes. Pick the one that fits; they share the same extension and the same program.

Status of this release (v0.2.0, in preparation): the Chrome Web Store listing is not live yet. Until it is, install the
extension from the zip on the [GitHub Releases](https://github.com/Capta1n-n9m0/browser-agent-bridge/releases) page
(steps in [`docs/setup.md`](docs/setup.md#route-1-claude-code)). The commands below work once the listing is live.

### 1. Claude Code

1. Install the extension **Browser Agent Bridge** from the Chrome Web Store.
2. Add the bridge to Claude Code (needs Node.js 20 or newer):

   ```
   claude mcp add browser-agent-bridge -- npx -y browser-agent-bridge
   ```

3. Start Claude Code and run `/mcp`. The first start creates your private token and registers the pairing helper, so
   the extension pairs by itself: you never copy or type a token.
4. Ask Claude to call `browser_status`. It should say the daemon and the extension are connected.

Check at any time with `npx browser-agent-bridge doctor`.

### 2. Claude Desktop

Download `browser-agent-bridge-<version>.mcpb` from the GitHub Releases page and double-click it. Claude Desktop
brings its own Node.js. Install the Chrome extension as in route 1.

What has been tested: the `.mcpb` packs and validates, and its server starts and lists the tools in a scratch run. The
install into the Claude Desktop app itself is checked at the end of Step 15 and this line is updated with the result.
macOS has not been tested with the `.mcpb`.

### 3. Developers: the SDK, or a clone

- A script: `npm i browser-agent-bridge`, then `import { connect } from "browser-agent-bridge"`. The SDK is Apache-2.0.
- A clone, for working on the bridge itself:

  ```
  git clone https://github.com/Capta1n-n9m0/browser-agent-bridge
  cd browser-agent-bridge
  npm run setup
  ```

  Setup works on Windows, macOS and Linux. The full walk-through, the manual install and how to write a script are in
  [`docs/setup.md`](docs/setup.md).

Requirements: Google Chrome 116 or newer. The code has branches for Windows, macOS and Linux, and a CI setup for all three (its first run on
GitHub has not happened yet). Tested by hand so far: Windows (the author's machine), macOS (a friend's) and a Linux server reached over an SSH tunnel (this
was before the pairing helper existed; the new install routes get their live check at the end of Step 15).

## What the agent can do

25 tools, all named `browser_*`: list and switch tabs, navigate, take a snapshot of the page as text with element
references, click, type, press keys, scroll, hover, select options, wait, take screenshots, go back and forward, read
the console, inspect network requests, download a file, upload a file from a folder you allow, and run JavaScript in
the page. Several agents can work at once, each on its own tabs. Actions use background tabs by default, so Chrome
does not jump around while an agent works.

## Your controls

These live in Chrome and only you can change them. The agent, the program on your machine and anything holding the
token cannot.

- **Kill switch.** The toolbar button (or `Alt+Shift+K`) turns the bridge off; every page call is refused until you
  turn it back on. The badge says `OFF`.
- **JavaScript switch.** Takes `browser_evaluate` away and keeps everything else.
- **Block list.** Sites you name are off limits: no reading, no clicking, no navigating there, and redirects onto them
  are stopped too. It is a rule for the agent's calls, not a firewall for your browser.
- **Upload folders.** An agent can upload files only from folders you list. The list starts empty.
- **No local files, no extension pages.** The bridge refuses `file:` pages and its own settings page.

Details: [`docs/setup.md`](docs/setup.md#safety).

## Security in plain words

Short version; the full model is [`docs/security.md`](docs/security.md).

- Whoever can drive the bridge can do what you can do in a signed-in tab. Treat it like handing someone your
  keyboard.
- The program listens on `127.0.0.1` only, so other computers cannot reach it, and it needs a secret token. The token
  sits in a file in your user folder, readable by you.
- The extension has no outside connections. It connects to the program on your machine and nowhere else.
- What an agent reads from a page goes to the AI service you chose (for example Anthropic, for Claude), as it would if
  you pasted the page into a chat. The bridge sends nothing anywhere itself and has no analytics.
- The most powerful tool is `browser_evaluate`, which runs JavaScript with your login. You can switch it off.
- Cookies never reach the extension, and sensitive headers are redacted before anything is stored.

Privacy policy: [`docs/privacy.md`](docs/privacy.md).

## Development

The code is a TypeScript monorepo: `shared/` (protocol), `daemon/`, `sdk/`, `mcp/`, `extension/` and `scripts/`. Run
`npm install`, `npm run build`, `npm test` and `npm run typecheck`. `CLAUDE.md` in the repo root and in each package
explains the architecture and the measured gotchas. How the project got here, step by step:
[`docs/history.md`](docs/history.md). What is next: [`docs/roadmap.md`](docs/roadmap.md). The manual test suite:
[`docs/e2e-test-plan.md`](docs/e2e-test-plan.md). Changes per release: [`CHANGELOG.md`](CHANGELOG.md).

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
