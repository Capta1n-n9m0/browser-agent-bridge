# Roadmap

## Where we are

- Steps 1 to 15 are shipped. **v0.2.0** is released (2026-11-08): the GitHub Release and `browser-agent-bridge` on npm. AGPL-3.0-only, the SDK Apache-2.0 (#450).
- The product has 25 tools, a daemon, a TypeScript SDK, an MCP server and a Chrome MV3 extension with a fixed ID and pairing by native messaging.
- The Chrome Web Store listing is submitted and under review. Until it is live, the extension installs from the release zip.

## Ahead: on the way to v1.0.0

What v1.0.0 means: § v1 of `docs/plans/2026-11-08-step15-distribution.md` (#448).

- **The store review.** Answer it if it asks; if it refuses, the product stays on GitHub only. When it is live, update the README and `docs/setup.md` status lines.
- **A Claude Desktop route.** Its settings no longer install a `.mcpb`; likely a plugin.
- **macOS and Linux runs** of the S9 checklist (the user or a friend).
- **Doctor text:** run from the package, it says "the next client hands it over" against a same-version clone daemon that is in fact used as it is.
- **Screenshot error on a store page** names `activeTab`, which the extension no longer has; it should say the gallery cannot be scripted, as the other tools do.
- **The `[chrome-bridge]` log prefix** the rename missed (cosmetic); `scripts/package/build.mjs` is not typechecked.

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
- Auto-update and signed standalone installers are not built (v1 item 6).

## Open questions

- Should control be limited to an "agent tab" the user arms, instead of the active tab? The active tab was chosen for ease. Revisit if it feels unsafe in practice.
- How should very large pages be snapshotted without using up the token budget? Today the snapshot is cut at 800 elements.
- Will the Chrome Web Store accept the listing? If not, the product ships from GitHub only.
- Which installer shape fits: a Claude Desktop extension, a standalone program per OS, or both? Step 15's audit proposes one.
