# Privacy policy

Browser Agent Bridge (the Chrome extension, the program it connects to, and the Claude and SDK connectors). Last
updated 2026-11-08.

## In short

- The extension collects nothing for the project. There is no account, no server run by the project, no analytics, no
  advertising and no tracking.
- The extension talks to one place: a program on your own computer, at `127.0.0.1`. Nothing leaves your machine through
  the extension except to the local AI agent or script that you run and connect.
- What an agent does with a page it reads is up to the agent and the AI service you use. The bridge does not send it
  anywhere itself.

## What the extension can touch

Only when an agent you connected asks, and only while the bridge is on:

- **Page content and structure** of the tabs the agent works on: text, element names, links, form fields (as a text
  outline), screenshots, the page's console messages, and the result of JavaScript the agent runs there.
- **Tab information:** the list of open tabs with titles and addresses (URLs), so the agent can pick a tab.
- **Network activity** of tabs: method, status, type, timing, size and address of requests, kept in memory per tab. Cookies are never received by the
  extension. Authorization-style headers and password-like form fields are replaced with `<redacted>` before they are
  stored. Headers and bodies are returned only when the agent asks for one request.
- **Files you allow:** when an agent uploads a file, the extension reads it from a folder you listed in Options. When an
  agent downloads a URL, the extension fetches it with your browser's session and the MCP server or SDK on your machine saves the
  file where the agent says.

The block list, the kill switch and the "Allow JavaScript" switch limit this, and only you can change them.

## What the extension stores

In Chrome's local extension storage on your computer: the pairing token and port, and your own settings (switch
states, block list, Upload folders). A short network log is kept in Chrome's session storage and disappears when you
restart Chrome or reload the extension. Removing the extension deletes all of it. The program on your machine keeps a
token file, a log of events (never URLs, titles, page content, header values or paths) and failure screenshots you can
delete, the log and screenshots in `~/.browser-agent-bridge/` and the token in your per-user config folder.

## Where data goes

- **Extension to the program on your computer:** over a connection to `127.0.0.1` that needs the token. Never to
  another address.
- **The program to your agent:** the page content reaches the agent you connected (for example Claude Code or Claude
  Desktop), which sends it to its AI service under that service's own terms. Review the privacy terms of the agent and
  service you use.
- **To the project, to advertisers, to data brokers, or to any analytics:** nothing, ever. The extension makes no
  request to any server of the project or any third party of its own.

The project does not sell or share user data, does not use it for creditworthiness or lending, and does not use it for
anything except the single purpose: letting the agent you connect drive your browser.

## Permissions

Each permission the extension asks for, and why, is listed in [`docs/store-listing.md`](store-listing.md).

## Your choices

Turn the bridge off with the toolbar button or `Alt+Shift+K`. Block sites, switch off JavaScript or empty the Upload
folders in the extension's Options. Remove the extension in `chrome://extensions` to delete its stored data. The
program's folder `browser-agent-bridge` in your user folder can be deleted at any time.

## Children

The bridge is a developer and power-user tool and is not directed at children.

## Changes and contact

Changes to this policy are made in this file and show in the repository history. Questions: open an issue on the
project's GitHub repository, `https://github.com/Capta1n-n9m0/browser-agent-bridge`.
