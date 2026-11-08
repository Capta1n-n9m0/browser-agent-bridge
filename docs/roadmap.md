# Roadmap

## Where we are

- Steps 1 to 14 are shipped. The project is public on GitHub under the MIT license.
- The product has 25 tools, a daemon, a TypeScript SDK, an MCP server and a Chrome MV3 extension.
- It installs on Windows with `npm run setup`. The extension is loaded unpacked.
- On 2026-11-08 the product was renamed **Browser Agent Bridge**.
- Next is **Step 15: distribution** to a wider audience.

## Ahead: Step 15, distribution

These come from the user's rulings of 2026-11-08. The step's first audit proposes the details.

- **Audience.** Less technical people first. The developer route (npm, the SDK, a clone) stays open.
- **Platforms.** Windows, macOS and Linux. A run on macOS and a run on a Linux server over an SSH tunnel both worked.
- **npm.** Publish the daemon, the MCP server and the SDK. The package is `browser-agent-bridge`, in the org `@browser-agent-bridge`.
- **The extension.**
  - A zip on GitHub Releases for the unpacked route.
  - A public Chrome Web Store listing, signed by the store. No self-signed `.crx`.
  - If the store refuses, the product stays on GitHub only.
- **GitHub Releases** carry everything: the extension zip, the npm package and the installers.
- **Installers for less technical people.** A Claude Desktop extension (`.mcpb`), a standalone program per OS, or both. The audit proposes which.
- **A fixed extension ID.** It is required. With it, pairing without a pasted token (native messaging) is required for the non-technical path.
- **Rename inside the code and docs.** The repo is already renamed. The name inside code, config and docs is Step 15 work.
- **README.** Rewrite it about the product, with the security model in plain words. Development history becomes a short section near the end.
- **Install steps.** They change with this step. The planned install test on another device is dropped, because the macOS and Linux runs cover it.

## Later

### Network mode

- The daemon, Chrome and clients on different machines is a future phase.
- Leaving localhost needs encryption and stronger authentication than one shared token.
- Until then Step 15 keeps the `127.0.0.1` bind. It only avoids choices that would block this, such as a host hard-coded in the protocol.

### Other browsers

- Chrome comes first. Other browsers are planned later, which is why the name has no "Chrome" in it.

### Tools and fidelity not built

- Response bodies and WebSocket frames over CDP. The reference-counted kept debugger session they need already exists.
- Console lines appended to an `evaluate` result.
- Banner-free `evaluate` through `chrome.userScripts`. It needs the "Allow User Scripts" toggle.
- Frame targeting for `evaluate`.
- Cookie and storage read tools.
- Multi-window awareness.
- Drag and drop, handling of native dialogs, modifier chords for `press_key`, and caret-preserving trusted typing.
- Snapshot limits. Closed shadow roots and cross-origin frames are out of reach for one content script. Pages over 800 elements are cut, with no expand or viewport-only mode yet.
- Network log options:
  - headers shown in the listing when `includeHeaders` is set,
  - an opt-in for `referer` and `origin`,
  - a query-string redaction flag,
  - a log scoped to the current document,
  - timing and transfer size.
- A bridge `back` or `forward` that reaches history the bridge built. Today it reaches only pages a human or an activating call acted on.
- An allow-list mode for the block list was turned down. It is not planned.

### Known issues and small follow-ups

- A screenshot of a fully covered Chrome window can take about 35 seconds. It takes about half a second when the window is uncovered.
- The SDK and the MCP still bring a tab to the front before a trusted input. Dropping that is a candidate once the covered-window case is understood.
- The doctor checks the extension's build by a heuristic. A build id in the extension's hello would make the check exact. Do this only if the heuristic misleads.
- Setup and update each keep their own npm lookup. Update prints "Already up to date." twice.
- Several live-test rows from Runs 19 and 20 were not measured or not discriminating (DevTools open during an upload, a held-tab sweep). They need a better helper before they count.
- A `subst` or mapped-drive folder in the Upload folders list may be refused. It was not measured live.
- Packaging for macOS and Linux, a stable extension key, auto-update and a signed build were left out of Step 14. Step 15 now covers them.

## Open questions

- Should control be limited to an "agent tab" the user arms, instead of the active tab? The active tab was chosen for ease. Revisit if it feels unsafe in practice.
- How should very large pages be snapshotted without using up the token budget? Today the snapshot is cut at 800 elements.
- Will the Chrome Web Store accept the listing? If not, the product ships from GitHub only.
- Which installer shape fits: a Claude Desktop extension, a standalone program per OS, or both? Step 15's audit proposes one.
