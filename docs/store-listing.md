# Chrome Web Store listing text

The text for the Web Store dashboard (Step 15 S7). The user approves it before the submission (S10). Nothing here is
submitted yet.

## Name and category

- **Name:** Browser Agent Bridge (for Chrome)
- **Category:** Developer Tools (alternative: Productivity)
- **Language:** English
- **Privacy policy URL:** `https://github.com/Capta1n-n9m0/browser-agent-bridge/blob/main/docs/privacy.md`
- **Website / support URL:** `https://github.com/Capta1n-n9m0/browser-agent-bridge`

## Short description (132 characters or fewer)

Let an AI agent you run on your computer use your real, logged-in Chrome. Local only, with a kill switch.

## Long description

Browser Agent Bridge lets an AI agent that you run on your own computer, such as Claude Code or Claude Desktop, or a
script you write, work in your real Chrome profile: the one with your accounts and cookies.

How it works: this extension connects to a small program on your computer (at 127.0.0.1) that your agent starts.
The agent asks it to read a page, click, type, scroll, take a screenshot, read the console or network activity, or run
a bit of JavaScript, and the extension does it in a tab. Nothing is sent to the project, and the extension has no
analytics.

You need the other half too: add the bridge to your agent. For Claude Code run
`claude mcp add browser-agent-bridge -- npx -y browser-agent-bridge`. For Claude Desktop, install the .mcpb file from
the project's GitHub Releases. The extension then pairs with it by itself; there is no token to copy.

You stay in control:
- A toolbar button and the shortcut Alt+Shift+K turn the bridge off at once. While it is off, every page call is
  refused.
- A separate switch takes JavaScript execution away from the agent.
- A block list keeps the agent off the sites you name.
- File uploads only work from folders you list, and the list starts empty.
- The bridge never opens local file pages or its own settings page.
- These settings are enforced inside the extension. The agent cannot change them.

Please read before you install: an agent connected to the bridge can do in your signed-in tabs what you can do. Connect
only agents you trust. Page content the agent reads goes to the AI service that agent uses, under that service's terms.

Open source (AGPL-3.0). Source, security model and privacy policy: github.com/Capta1n-n9m0/browser-agent-bridge

## Single purpose statement

Let an AI agent or script that the user runs on their own computer drive the user's Chrome tabs (read, click, type,
navigate, capture) through a local connection, under controls only the user can change.

## Permissions, one plain reason each

| Permission | Why |
|---|---|
| `debugger` | Real keyboard and mouse input for sites that ignore synthetic events, full-page screenshots, console messages, file uploads from the folders the user allows, and running the JavaScript the agent supplies. Chrome shows its "debugging this browser" banner while it is used. |
| `tabs` | List the open tabs and their titles and addresses, open, close and switch tabs for the agent, and follow navigation. |
| `scripting` | Inject the page-reading and clicking code into the tab the agent works on. |
| `activeTab` | Standard grant for the page the user is on when they press the toolbar button. Broad site access is also requested for the agent's work. |
| `alarms` | Keep the extension's connection to the local program alive. Chrome stops idle extension workers, and a timer about every 25 seconds prevents that. |
| `storage` | Keep the pairing token and port, and the user's own settings (switch states, block list, Upload folders). |
| `offscreen` | Hold the connection to the local program in an offscreen document, which survives Chrome stopping the worker. |
| `webRequest` | Observe (never change) the tab's network requests for the network inspection tool. No cookies and no blocking; sensitive headers are redacted. |
| `declarativeNetRequestWithHostAccess` | Enforce the user's block list on redirects, so a redirect cannot take an agent onto a blocked site. Used only for the user's own list. |
| `webNavigation` | Tell which tab opened a new tab or popup, so it goes to the same agent as the page that opened it. |
| `nativeMessaging` | Ask a small helper on the user's computer for the pairing token and port, so the user does not have to copy a token. The helper answers only this extension. |
| Host access `<all_urls>` | The agent can work on any site the user has open, and the user chooses which to block. The extension does nothing on a page until a connected agent asks. |

## For the reviewer: remote code and `browser_evaluate`

The extension does not download or run code from any website or server. All of its code is in the package.

One tool, `browser_evaluate`, runs a JavaScript expression in the page. The expression is written by the AI agent or
script that the user runs on their own machine. It reaches the extension over a WebSocket connection to 127.0.0.1 (the
user's own computer), not from the internet, and the extension runs it through Chrome's documented
`chrome.debugger` API (`Runtime.evaluate`). That is the same thing as the user typing in the DevTools console, done by
software the user installed and connected on purpose. The extension never fetches code from a remote host.

The user can turn the tool off with a switch in the extension's Options ("Allow JavaScript"), which leaves every other
tool working. The whole bridge can be turned off from the toolbar button. These switches are stored in the extension and
cannot be changed by the agent or the local program.

Why each sensitive permission is needed is in the table above. `debugger` is used only for: trusted (real) input,
full-page screenshots, console reading, file uploads from the folders the user allows, and `browser_evaluate`. Test instructions for review: install the extension;
the local program needs Node.js 20 or newer (`npx -y browser-agent-bridge`); a demo with a test page is in the
repository (`test-fixtures/e2e-playground.html`).

## Images

Icons and the small promo tile: `assets/brand/` and `extension/icons/` (S8, first half). Screenshots (1280x800, fixture
pages only) wait for S9.
