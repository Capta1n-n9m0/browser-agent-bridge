# Step 15 — Distribution: Browser Agent Bridge for everyone (v0.2.0)

**Date:** 2026-11-08 · **Status:** Planned · **Builds on:** decisions.md · 2026-11-08 · Distribution to a wider
audience: the shape of Step 15 (#445); The product is renamed Browser Agent Bridge (#444); Running over the network
waits for a later phase (#443); Lean mode (#446); Versions are tagged vX.Y.Z (#447); v1.0.0 is our goal (#448); The
user rules Step 15's proposals (#449)

## Why

Today the bridge installs only from a clone, with the extension loaded unpacked and the token pasted by hand. That
works for us, not for a stranger. Step 15 makes it something a less technical person can install in minutes: add the
extension from the Chrome Web Store, add the bridge to Claude, done. No token to copy. Developers keep their route:
`npx`, the SDK from npm, or a clone. The result is released as **v0.2.0**.

## Outcome

- The name inside code, config and docs is **Browser Agent Bridge** (`browser-agent-bridge`); old installs migrate.
- One npm package, `browser-agent-bridge`: the MCP server, the daemon, the SDK and the commands (`setup`, `doctor`).
  Claude Code: `claude mcp add browser-agent-bridge -- npx -y browser-agent-bridge`. Scripts:
  `npm i browser-agent-bridge`.
- The token lives in a per-user folder, not the repo; the daemon is found next to the installed package.
- The extension has a **fixed ID** (the Web Store's), and **pairs without a pasted token** through native messaging.
  The Options page keeps manual entry as a fallback.
- A **Claude Desktop extension** (`.mcpb`): double-click to install; Claude Desktop brings its own Node.
- Setup and doctor work on **Windows, macOS and Linux**.
- **GitHub Releases** carry everything for each `v*` tag: the extension zip, the `.mcpb`, the npm tarball. CI runs the
  tests on all three OSes.
- A **product-first README**, a plain-language **security model**, a **privacy policy**, the Web Store listing text.
- The extension is **submitted to the Chrome Web Store** (public). If the store refuses, the product stays on GitHub.
- Unchanged: 25 tools and their names (`browser_*`), the wire protocol (proto 2), the `127.0.0.1` bind, the safety gate.

## Decisions

- 2026-11-08 · The shape of Step 15 (#445) — the user's rulings: audience, platforms, npm, zip + public store, the
  all-in-one release, installers, fixed ID and pairing, the README.
- 2026-11-08 · Versions are tagged vX.Y.Z (#447): the npm package, the extension manifest, the `.mcpb` and the git tag
  carry one number; Step 15 releases v0.2.0.
- **(ruled, #449) One npm package, not several.** `browser-agent-bridge` holds everything, bundled with esbuild. The SDK
  is its main export. Scoped packages (`@browser-agent-bridge/sdk`) only if users ask. *Why:* one name to install and
  one version to keep in step.
- **(ruled, #449) Token lookup order:** `BRIDGE_TOKEN`, then the per-user file (Windows `%APPDATA%\browser-agent-bridge\`,
  macOS `~/Library/Application Support/browser-agent-bridge/`, Linux `$XDG_CONFIG_HOME` or
  `~/.config/browser-agent-bridge/`), then `bridge.token` at a clone's root (developers). Setup moves an existing
  repo token to the per-user file.
- **(ruled, #449) Installers: `.mcpb` in this step, standalone programs later.** Unsigned standalone programs trigger
  Windows SmartScreen and macOS Gatekeeper warnings (macOS signing needs a paid Apple account), which is worse for
  less technical users than the `.mcpb`. Claude Code users get `npx`. Revisit for v1.
- **(ruled, #449) The native host is the npm package's own script,** registered per user by `setup` and by the MCP server
  on its first start (so a `.mcpb` install needs no extra step). It answers only the extension's fixed ID
  (`allowed_origins`) and returns the token and port; nothing else.
- **(ruled, #449) npm releases by trusted publishing** (GitHub Actions with OIDC, no token or one-time code), set up once
  by the user on npmjs.com. Until then the user publishes by hand.
- **(ruled, #448) What v1.0.0 means:** § v1 below, accepted as our goal.
- **(ruled, #449) The store gets the full version,** `browser_evaluate` included. A rejection is handled when it comes.

## Stages

Kinds and their checks: `docs/agent-rules.md` §4. Sizes are new lines of code and tests.

### S0 — Facts first (kind: docs · read-only · after: none)
Check what the plan assumes, each with a source: (1) the Web Store's rules on the manifest `key` field and how to get
the store's public key for unpacked builds; (2) whether `browser_evaluate` (code supplied at runtime by the local
agent) passes the store's remotely-hosted-code rule, and what reviewers ask for the `debugger`, `<all_urls>`,
`webRequest`, `declarativeNetRequestWithHostAccess`, `webNavigation` and `nativeMessaging` permissions; (3) native
messaging host registration per OS for Chrome (and Chromium, Edge later); (4) the current `.mcpb` format and packing
tool; (5) npm trusted publishing; (6) whether Chrome still lets a scratch profile load an unpacked extension from the
command line (for the live check). **Done when:** a few lines per item in § As built, and any finding that changes a
stage goes to the user. **Highest risk: item 2.** The user ruled (#449): submit the full version anyway; S0 only prepares the
reviewer-facing explanation.

### S1 — The rename (kind: ordinary · ~300 · after: S0)
`chrome-agent-bridge` → `browser-agent-bridge` in code, logs, the MCP server's name, the extension's name ("Browser
Agent Bridge (for Chrome)" in the store; "Browser Agent Bridge" in the manifest), package names, docs and skills.
Setup and doctor recognise an old `chrome-agent-bridge` MCP entry and replace it. Tool names do not change. The local
folder name is the user's. **Done when:** `git grep -i chrome-agent-bridge` finds only migration code and history;
tests green.

### S2 — The npm package (kind: safety · ~500 · after: S1)
The token's new home and lookup order, the daemon found relative to the package, one publishable package (esbuild
bundle, `bin` entries for the MCP server and the commands, the SDK export with types). Safety because it moves the
token. **Done when:** `npm pack`, installed into a scratch folder outside the repo, runs the MCP server, a script
using the SDK, and `doctor`; the token never appears in output, argv or logs (the log scan covers the new paths).

### S3 — Setup and doctor on three OSes (kind: ordinary · ~400 · after: S2)
Node only. Registers the MCP server with Claude Code (`claude mcp add`, user scope), writes the token file, registers
the native host (Windows: `HKCU` registry key; macOS and Linux: the host manifest file). Doctor gains lines for the
native host and the token file. The Windows-only reload stays a developer tool. **Done when:** unit tests per OS
branch with injected facts; a dry run prints the right paths on each OS (CI, S6).

### S4 — Fixed ID and pairing (kind: safety · ~450 · after: S2; needs U2)
The manifest `key` for unpacked builds (the store's public key, U2), the `nativeMessaging` permission, the native host
script, and the extension's pairing: on start, if no token is stored, it asks the host and stores the token and port.
Manual entry stays. **Done when:** unit tests for the host's message handling (wrong origin refused, token never
logged), the extension's pairing logic as pure functions, the log scan extended; the live check (S8) pairs a fresh
install.

### S5 — The Claude Desktop extension (kind: ordinary · ~200 · after: S2, S4)
A `.mcpb` bundle around the npm package's MCP server, with icon, description and the native host registration on first
start. **Done when:** the pack command builds it from a clean tree; its manifest validates.

### S6 — CI and the release pipeline (kind: ordinary · ~250 · after: S5)
GitHub Actions: tests and typecheck on Windows, macOS and Linux for every push. On a `v*` tag: build, the extension
zip (without the `key` field if S0 says the store needs that), the `.mcpb`, the npm tarball, a GitHub Release with all
three and the changelog section; npm publish by trusted publishing once U4 is done. One script keeps the version in
`package.json`, the manifest and the `.mcpb` equal; a test fails if they differ. **Done when:** CI is green on all
three OSes; a dry-run release on a test tag builds every file.

### S7 — Docs and the store listing (kind: docs · after: S1–S5)
A new `README.md` about the product (what it is, who it's for, the three install routes, the safety controls, the
security model in plain words, a short "Development" section pointing to `docs/history.md`), `docs/security.md`,
`docs/privacy.md` (the store needs a public URL; GitHub's rendering of the file is enough), `docs/setup.md` rewritten
around the three routes, `CHANGELOG.md`, and the store listing text with one plain reason per permission.
**Done when:** the user approves the README and the listing text.

### S8 — Icons and screenshots (kind: docs · after: S1)
The extension icons (16, 32, 48, 128), the store screenshots (1280×800, taken on fixture pages only, never a real
site) and the small promo tile (440×280). **Done when:** the user approves them.

### S9 — Live check (kind: live · after: S4–S7)
One short checklist in a scratch Chrome profile on Windows: install the release zip with the fixed ID, pairing with no
token typed, a tool call from Claude Code through `npx`, the `.mcpb` in Claude Desktop (if installed, U5), a script
using the package from a scratch folder, the kill switch still refusing calls. macOS and Linux: the same list for the
user (or the friend) to run. **Done when:** every row passes or has an owner.

### S10 — Release v0.2.0 (needs the user)
Tag `v0.2.0`, the GitHub Release from the pipeline, the npm publish, the store submission (U3). Then answer the store
review if it asks.

## Exit checks

- `npm test`, `npm run typecheck`, `npm run build` green; CI green on Windows, macOS and Linux.
- `git grep -i chrome-agent-bridge` returns only migration code and history.
- A scratch-folder install of the packed npm package runs the MCP server, an SDK script and `doctor`.
- A fresh extension install pairs without a typed token (S9), and the token never appears in any output or log.
- The versions in `package.json`, `extension/manifest.json` and the `.mcpb` are equal (test).
- A `v*` tag produces a GitHub Release with the zip, the `.mcpb` and the npm tarball.
- The user approved the README, the listing text, the icons and screenshots.
- The store submission is sent, or the user chose GitHub only.

## Needs the user

Each item is asked for when its stage needs it, **with numbered step-by-step instructions** for the user (the user's
request, #449).

- **U1** — done: the user ruled the proposals and v1 (#448, #449).
- **U2** — upload a first draft of the extension to the Web Store dashboard (not published) to fix its ID, and copy
  the public key it shows (S4 needs it). S0 confirms the exact steps.
- **U3** — the store submission and answering the review: the listing, privacy policy URL, screenshots, category.
- **U4** — npm trusted publishing on npmjs.com (one form), or publish by hand with the passkey.
- **U5** — Claude Desktop is installed on this machine (S9 tests the `.mcpb` there); the macOS and Linux runs of the
  checklist.
- Approvals: README, listing text, icons, screenshots; every push, tag and publish.

## v1

v1.0.0 is a promise, not a feature list. **Our goal (#448, accepted by the user):** we call it v1 when

1. a stranger installs it on Windows, macOS or Linux without help, from the store (or GitHub if refused) and the
   `.mcpb` or `npx`, with no token typed;
2. the public surface is stable and versioned: MCP tool names and schemas, the SDK's API, the wire protocol, the
   error codes; breaking any of them after v1 means v2;
3. the security model is written down and has been reviewed once by a fresh pair of eyes;
4. CI covers all three OSes and every release is built by the pipeline;
5. no known safety bug is open, and the known issues in `docs/roadmap.md` are fixed or documented;
6. signed standalone installers (the certificate question is taken up on the way to v1).

Between v0.2.0 and v1, each release is v0.x: real users, feedback, fixes. Network mode and other browsers come after
v1, or as v1.x features if they don't break the surface.

## As built

*(filled in per stage)*
