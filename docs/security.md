# Security model

What Browser Agent Bridge lets an agent do, what stops it from doing more, and what it cannot protect you from. Written
in plain words; the design of record is in `docs/specs/` and the measured details are in the `CLAUDE.md` files.

## The one thing to understand

An agent connected to the bridge can do in your signed-in tabs what you can do: read the page, click, type, submit
forms, and (unless you turn it off) run JavaScript with your login. Connect only agents you would trust at your
keyboard. Everything below limits the damage, and none of it changes this.

## The parts and who talks to whom

```
AI agent or script  ->  MCP server / SDK  ->  daemon (127.0.0.1)  ->  extension in your Chrome
```

- **The extension** runs inside your Chrome profile. It is the only part that touches your pages.
- **The daemon** is a small program on your machine. It holds the one connection to the extension and relays calls
  from the agents' side.
- **The MCP server and the SDK** are how Claude and your scripts reach the daemon.

## What protects you

1. **Local only.** The daemon listens on `127.0.0.1`, never on a network address. Other computers cannot connect.
2. **A secret token.** Every client, and the extension, must present the token before the daemon talks to them. The
   token is a random 256-bit value kept in a file in your user folder (set to be readable by you only where the
   system allows it). It is never printed, never logged and never committed to the repository.
3. **Pairing without typing.** The extension asks a small helper program for the token and port. Chrome starts the
   helper only for the extension with the fixed ID, and the helper checks the caller's ID before it reads anything.
   It answers one request type and returns only the token and port. Any other request, or any other caller, gets a
   fixed error that repeats nothing it was sent.
4. **Controls enforced inside the extension.** The kill switch, the JavaScript switch, the block list and the Upload
   folders are stored in the extension and checked on every call, at the start, before each side effect, and after.
   Nothing on the wire, in the daemon or in the SDK can change them: only the toolbar button, the shortcut and the
   Options page can, and those need you at the browser.
5. **Narrow edges.** The bridge refuses `file:` pages and its own settings page. A file upload works only from folders
   you listed, and also needs Chrome's own "Allow access to file URLs" switch. Navigation and redirects onto blocked
   sites are stopped.
6. **Nothing sensitive in logs.** The extension, daemon and MCP server never log a URL, page title, header value,
   page content, file path, evaluated value or block-list entry. A test scans every log call in the code to keep it so.
7. **Cookies stay out.** The network recorder does not receive cookies at all. Authorization-like headers and password-like
   form fields are replaced with `<redacted>` before they are stored.
8. **Separate tabs.** Each tab has at most one owner at a time, so two agents do not fight over a tab.

## What it does not protect you from

- **A hostile agent you connect.** It can read anything on tabs it uses. Use the block list for sites that must stay
  off limits, and the kill switch whenever you want to be sure.
- **Other programs running as you.** The token file is readable by your user account, so malware running as you can
  read it and drive the bridge. A password manager has the same limit.
- **Page content sent to your AI service.** Whatever the agent reads is passed to the model provider you chose, under
  that provider's terms. The bridge adds no extra copy anywhere else.
- **URLs with secrets.** The network tool keeps the whole query string of requests, so an access token in a URL reaches
  the agent. Clear the log with `browser_network_clear` after work on a sensitive tab.
- **The block list is not a firewall.** It governs the agent's calls. It does not block your own browsing or a page
  that loads a blocked site's content inside an allowed page.
- **The debugging banner.** Trusted input, full-page screenshots, `browser_evaluate` and a few other tools use Chrome's
  debugger interface, which makes Chrome show "an extension is debugging this browser". This is Chrome's own warning
  and it is expected.

## The sharpest tool: `browser_evaluate`

It runs JavaScript, supplied by the agent, in the page with your login: it can read local storage, call signed-in
APIs and submit forms. The JavaScript is not downloaded by the extension. It arrives from the local agent through the
program on `127.0.0.1` and is run through Chrome's documented debugger interface. Turn **Allow JavaScript** off in the
Options page to refuse it while every other tool keeps working. Neither the expression nor its result is logged.

## Reporting a problem

Open an issue on the project's GitHub repository. For a security problem, say so in the title and leave out the
details; the maintainer will arrange a private channel. A fresh outside review of this model is a goal before v1.0.0.
