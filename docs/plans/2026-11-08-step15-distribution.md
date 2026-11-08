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
- **U6** — done: the license is AGPL-3.0-only, the SDK and `shared/` Apache-2.0, plus a trademark note (2026-11-08 ·
  The license moves from MIT to AGPL-3.0, with the SDK under Apache-2.0 (#450)). S2 sets the package's `license`
  field as that decision says; S7's README and listing keep the License and Trademark sections.
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

**S0 — facts (checked 2026-11-08; web sources, not yet tested against a live store upload)**

1. **Store `key` and the fixed ID.** The dashboard's Package tab shows the public key of an uploaded draft; take the PEM body and join it into one line for the manifest `key`. The store rejects a zip whose manifest has a `key` field ("key field is not allowed in manifest", reported by developers; not in Google's docs). So the repo keeps `key` for unpacked builds and S6 strips it from the store zip. Sources: developer.chrome.com manifest `key` reference; groups.google.com chromium-extensions "Consistent unpacked extension and app IDs"; GitHub PMDevSolutions/Optia PR #60.
2. **Remote code and permissions (highest risk).** The policy's common violation is "using JavaScript's eval() method or other mechanisms to execute a string fetched from a remote source"; it also says "execution of logic from a remote source is permissible only when accomplished through a documented API" (developer.chrome.com, Webstore program policies). `browser_evaluate` runs the agent's source through `chrome.debugger` `Runtime.evaluate` (`extension/src/evaluate/call.ts:116`), a documented API. The extension fetches no code from any host; the source arrives over the 127.0.0.1 socket from the local agent. A reviewer could still read that as remote code, so S7 writes the explanation. Permissions: the policy asks for "the narrowest permissions necessary" and a single purpose. We found no published per-permission reviewer questions for `debugger`, `<all_urls>`, `webRequest`, `declarativeNetRequestWithHostAccess`, `webNavigation` or `nativeMessaging`; that stays open until a real submission.
3. **Native messaging, per OS.** Windows: `HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\<host>`, default value = the full path of the manifest (the manifest may live anywhere). macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/<host>.json`. Linux: `~/.config/google-chrome/NativeMessagingHosts/<host>.json`. `path` must be absolute on macOS and Linux and may be relative on Windows. `allowed_origins` lists `chrome-extension://<ID>/`; Chrome passes the caller's origin as the host's first argument. Source: developer.chrome.com nativeMessaging (only translated copies were returned; re-read the English `allowed_origins` text at S4). Edge and Chromium paths are not checked.
4. **`.mcpb`.** A zip with `manifest.json` (the only required file). Built by `npm i -g @anthropic-ai/mcpb`, then `mcpb init` and `mcpb pack` (pack validates). Claude Desktop runs on macOS and Windows and ships Node, so a `node` server fits. Icon: `icon.png`, 512 px recommended, 256 px minimum. `compatibility` names the platforms. The `manifest_version` value is not verified (a third-party page says 0.3; the spec in the MCPB repo was not read). Anthropic's directory no longer takes MCPB submissions, so the `.mcpb` ships on GitHub Releases only. Source: claude.com/docs/connectors/building/mcpb.
5. **npm trusted publishing.** On npmjs.com: package settings, Trusted Publisher, GitHub Actions; enter owner, repo, workflow file name and an optional environment; choose publish. The job needs `id-token: write`, npm CLI 11.5.1 or newer and Node 22.14 or newer. Provenance is automatic. Self-hosted runners are not supported. The package must already exist: `browser-agent-bridge@0.0.1` is on npm (`npm view`, 2026-11-08), so U4 can be done now. Source: docs.npmjs.com/trusted-publishers.
6. **Loading unpacked in a scratch profile.** Chrome 137 removed `--load-extension` from branded builds (Chromium groups PSA). Chrome for Testing and Chromium still have it. In branded Chrome, a scratch profile loads the extension by hand: `chrome://extensions` → Load unpacked. This changes how S9 runs (not a stage change; not tested here).

**U4 — done (2026-11-08, by the user):** npm trusted publishing set for `browser-agent-bridge`: GitHub Actions,
`Capta1n-n9m0/browser-agent-bridge`, workflow `release.yml`, publish and dist-tag allowed. S6 creates `release.yml`.

**S1 — done (commit `2510afc`, not pushed):** the old name is gone from code, the MCP server name, the manifest name, the
root package name, the README, docs and CLAUDE.md files. `npm test` 4112 → 4123 passed (11 new, each written to fail first);
typecheck, `recipes` typecheck and build green. Choices: setup always replaces an old `chrome-agent-bridge` entry; the state
folder moved to `~/.browser-agent-bridge/` (the daemon reads the old folder's handle mark when the new one is empty, so handle
numbers are never reused, #79; old logs are not moved); the private `@bridge/*` names stay; `test-fixtures/dl/hello.txt` is
70 bytes now and `docs/e2e-test-plan.md` has the new size and sha256. Legacy names remain only in migration code
(`scripts/bridge/lib.mjs` `LEGACY_SERVER_NAMES`, `daemon/src/log.ts` `legacyStateDirs`, `recipes/reload-extension.ps1`), history, and one-line notes.
User action: `npm run setup` (swaps the real `~/.claude.json` entry), then `/mcp` or a fresh session, then reload the extension.

**S2 — done (commit `e9464d0`, not pushed):** token lookup per #449 (`BRIDGE_TOKEN`, the per-user file, then a clone's
`bridge.token`, which the installed package never reads); the daemon found by `BRIDGE_DAEMON`, then `<package>/dist/daemon.js`,
then the clone layout, from the module's own folder, never the cwd. `npm run build:npm` / `pack:npm` write a gitignored
`build/npm/` (esbuild bundles: SDK as main export with types, MCP server, daemon, doctor; bins `browser-agent-bridge` and
`browser-agent-bridge-doctor`; runtime dependency `ws` only); the root `package.json` stays private. License
`AGPL-3.0-only AND Apache-2.0` with both texts, `LICENSES.md` and third-party notices (#450). `npm test` 4123 → 4153 passed;
typecheck and build green. Independent Opus verifier: PASS; two MINOR fixed (log scan covers `scripts/bridge/lib.mjs`; a
`sdk/src/token.ts` comment). Two scratch installs of the tarball (throwaway token, ports 9277 and 9281): the MCP server
listed 25 tools, an SDK script and doctor ran, the token appeared 0 times in output, log, argv and the tarball; a planted
`bridge.token` and fake daemon in the scratch project were ignored. Left for S3: setup is not in the package and moving a repo
token to the per-user file; `claudeConfigPath` (`scripts/bridge/lib.mjs`) always builds a Windows path; a clone daemon and a
package daemon have different build ids and would hand the port back and forth (read from the code, not run). Left for
later: the `[chrome-bridge]` log prefix the S1 rename missed (cosmetic); `scripts/package/build.mjs` is not typechecked.

**S3 — done (commit `6b964a0`):** setup and doctor run from a clone and from the package (`npx browser-agent-bridge setup`)
on Windows, macOS and Linux, platform and mode injected, one test per OS branch (`scripts/test/s15-setup-os.test.ts`). The MCP
entry (user scope) is `node <repo>/mcp/dist/index.js` from a clone, `npx -y browser-agent-bridge` from the package
(`cmd /c npx …` on native Windows). Setup moves a repo `bridge.token` to the per-user file; if both exist and differ, both stay
and the per-user one wins. `claudeConfigPath` is per platform. Native host `com.browser_agent_bridge.host` registered (HKCU key;
the manifest in Chrome's NativeMessagingHosts on macOS/Linux) with a launcher on the absolute node path; S4 fills in the script
(package `dist/native-host.js`, clone `scripts/native-host/host.mjs`) and `ALLOWED_EXTENSION_IDS` (empty: Chrome admits no
caller); doctor's Native host line is a hint until then. Handover between installs: the daemon writes
`~/.browser-agent-bridge/daemon-<port>.json` {build, path, pid} after binding; a client with a different build uses the running
daemon as it is when it belongs to another install, is that install's current build and the same version or newer, else hands
over as before (also on 4002); no wire change. Checked with real processes on ports 9291/9292 (scratch home, throwaway token).
Trade-off: a clone and a package of the same version keep whichever daemon started first (`sdk/CLAUDE.md`). `npm test` 4153 →
4205 passed; typecheck, build and `pack:npm` green. Not run: a real setup, the real registry, macOS/Linux natively (S6 CI).

**U2 — done (2026-11-08, by the user):** a draft (not submitted) on the Web Store dashboard; ID
`iifofgbdljchbdimlalhphmedfmocela`, which the session agent derived from the public key to confirm.

**S4 — done (commit `f6d0376`):** the manifest gains `key` (the store's public key; a test derives the ID from it) and
`nativeMessaging`, nothing else. The host (`scripts/native-host/pair.mjs` pure, `host.mjs` I/O; packaged `dist/native-host.js`)
checks the caller's origin equals the fixed one before reading anything, reads one request (4 KiB, 5 s), answers only
`{type:"pair"}` with `{ok, token, port}`, else a fixed error code that never echoes input; nothing on stderr; same token order
as the SDK. The extension (`extension/src/pairing.ts` pure, called from `sw.ts` `connect()`) pairs only when no token is
stored, re-reads storage before writing `{token, port}` so a typed token wins, and on a missing or refusing host writes nothing,
logs one fixed line and retries from 30 s doubling to 30 min. `safety-writers.test.ts` admits the one new write (only
`{token, port}`); the log scan covers `scripts/native-host`. Doctor shows native host problems as hints. Independent Opus
verifier: PASS; three MINOR left: no compare-and-set in `storage.local` (a millisecond race with Options), a custom port saved
with an empty token returns to 9234, the npx-cache launcher path can move (S5/S9). `npm test` 4205 → 4287 passed; typecheck,
build, `pack:npm` green. The new ID means a fresh storage: the human redoes the block list, Upload folders, the JavaScript
switch, a kill switch left off, "Allow access to file URLs", site access, the pinned button; pairing restores the token after
`npm run setup`. Fresh storage starts armed, JavaScript on, empty block list, no Upload folders. Left: the MCP server registering
the host on first start (#449) goes to S5; S6 strips `key` from the store zip; `docs/e2e-test-plan.md` lines 175 and 1138 name
the old ID (S7/S9); S9 removes the old unpacked entry and loads it again. Incident: a verifier's test setup fell back to the
repo `bridge.token` and printed the user's real token once in its own tool output; no copy in any commit, the tree or the
scratch folder (counted, 2026-11-08).

**S5 — done (commit `d1fd239`):** `npm run pack:mcpb` (`scripts/package/mcpb/`) builds `build/browser-agent-bridge-<version>.mcpb`
from `build:npm` plus `ws`, a generated `manifest.json` (`manifest_version` "0.3", platforms darwin and win32,
`tools_generated`) and a placeholder icon (S8 replaces it); validated and packed by the pinned `@anthropic-ai/mcpb` 2.1.2.
A fresh clone with `npm ci` packed it and the validator passed. The MCP server's first start (#449; `scripts/bridge/host-register.mjs`,
decision `lib.firstStartDecision`), only when run from an installed package: creates the per-user token if neither
`BRIDGE_TOKEN` nor the file holds one (mode 0600, exclusive create, an existing token never replaced; beyond the brief, kept by
the session agent because a `.mcpb` install has no other token source), then registers the native host from where it runs
whenever the manifest, launcher or registry value differ (fixes the S4 npx-cache MINOR); never throws, one fixed log line;
`BRIDGE_NO_HOST_REGISTRATION=1` opts out and must be set for any real run of a packaged server on Windows, or it writes the real
HKCU key. Under Electron the launcher sets `ELECTRON_RUN_AS_NODE=1`. `npm test` 4287 → 4313 passed; typecheck, build,
`pack:npm` green. Scratch run of the unpacked bundle (port 9296): 25 tools, token, manifest and launcher created in scratch
folders, the token 0 times in stderr; the real registry was not written. S9 measures on Claude Desktop for Windows whether its
Node is Electron and whether the app is MSIX-packaged (APPDATA and HKCU virtualised); which `manifest_version` Claude Desktop
accepts is not checked.

**S8, first half — done (commit `d4ffb28`; awaiting the user's approval):** one SVG source each in `assets/brand/` (a white
suspension bridge on blue `#1F4FD1`, an amber dot for the agent), rendered by `scripts/brand/render.mjs` (`@resvg/resvg-js` not a
repo dependency) into `extension/icons/icon-{16,32,48,128}.png`, `assets/brand/icon-512.png` (the `.mcpb` icon, replacing S5's
placeholder) and `assets/brand/promo-tile-440x280.png` (tagline "Your agent, in your real Chrome", the agent's own wording). The
manifest gains `icons` and `action.default_icon` only. Screenshots wait for S9.

**S6 — done (commit `f73c08e`; CI not yet run on GitHub):** `.github/workflows/ci.yml` (every push and PR; ubuntu, macos, windows
on Node 22: `npm ci`, `version:check`, typecheck, recipes tsc, build, test; a Linux job runs `release:build` and keeps the files)
and `release.yml` (on `v*`: typecheck and test, `release:build --tag`, `gh release create` with the zip, `.mcpb`, `.tgz`,
`SHA256SUMS.txt` and the changelog section, then `npm publish --provenance` by trusted publishing; a prerelease tag makes a draft
and skips npm; started by hand it only builds). Least-privilege permissions per job; both set `BRIDGE_NO_HOST_REGISTRATION=1`.
`npm run release:build` writes `build/release/`: the extension zip has no `key`, forward slashes, the icons, and fails if a file the
manifest names is missing; on a full tag it fails when the tag differs from the version or `CHANGELOG.md` lacks the section (S7
writes `## 0.2.0`). `version:check` / `version:set` keep the root `package.json`, the lockfile and the manifest equal (a prerelease
gives the manifest the bare X.Y.Z). actionlint (wasm, no shellcheck) clean. `npm test` 4313 → 4333 passed (with S8's one); the CI
steps passed on Linux (WSL, Node 22.14, fresh clone: 4332 passed, 1 skipped); macOS not run anywhere. `sdk/test/spawn-inherit.test.ts`
passes `--experimental-strip-types` under Node 22.14 (types are stripped by default only from 22.18).

**S7 — done (commit `64310a1` plus the session agent's fixes; awaiting the user's approval):** `README.md` (product first; the
three routes; says the store listing is not live and the zip is the route until it is; the License and Trademark sections kept),
`docs/security.md`, `docs/privacy.md` (the store's privacy URL), `docs/store-listing.md` (descriptions, category Developer
Tools, single purpose, one reason per permission, the reviewer note on `browser_evaluate`), `docs/setup.md` (an Install section on
top, the developer and manual material kept below), `CHANGELOG.md` (`## 0.2.0`; `npm run release:build` passed with it), the old
extension ID in `docs/e2e-test-plan.md` replaced. The session agent added uploads to the `debugger` reasons, scoped the README's
cookie line to the network log, and removed "Step 15" from the README. Open: `activeTab` is in the manifest and nothing in the code
uses it (`<all_urls>` covers it); removing it is a permission change for the user to rule.

**Approved by the user (2026-11-08):** the icons, the tagline, the README, the listing text, `docs/privacy.md` and
`docs/security.md`. The user granted S9 the use of their real Chrome for the live check.

**Release zip fix (commit `3b7b5a4`, session agent):** the GitHub Release zip had no `key`, so Load unpacked would give a
path-based ID the native host refuses, and pairing could not work before the store listing is live. The release zip now keeps
`key`; `browser-agent-bridge-store-<v>.zip` (without it) is built for the dashboard and stays out of the Release and
`SHA256SUMS.txt`.

**CI on GitHub (2026-11-08):** the first CI run (`1161fcc`) and the next (`3b7b5a4`) passed on ubuntu, macos and windows, with the
Linux release build; a manual Release run built every file and skipped the GitHub Release and npm jobs as designed.

**`activeTab` removed (commit `5aa5e73`, the user's ruling #451).**

**S9 — live check on Windows, in the user's real Chrome (commit `f6970da`; 2026-11-08):** all six rows passed.
(1) Fixed ID: no Browser Agent Bridge card was found when the run began, so nothing was removed; Load unpacked of `extension/`,
driven by UI Automation (folder dialog by WM_SETTEXT and BM_CLICK), gave `iifofgbdljchbdimlalhphmedfmocela`; whether a plain reload
switches the ID is not known. (2) Token replaced: repo `bridge.token` deleted, the real `npm run setup` created the per-user
token (64 characters) and the HKCU native host; the old daemon, respawned by this session's MCP server with the old token, was
ended by `taskkill /F` (a process the runner had not started — recorded as a deviation from §9). (3) Pairing with no token typed:
doctor all OK (`Native host: registered for this extension's ID`, `Extension: connected`), an SDK probe connected in 3049 ms.
(4) Packaged route: the release zip's key gives the fixed ID and has no `activeTab`; the store zip has no key; the tarball's MCP
server in a scratch folder ran 25 tools on the fixture page (new tab, snapshot, type, click, close), the token 0 times in stderr,
the clone's same-version daemon used as it was; the packaged host answered `ok` with the token and refused a wrong origin; an SDK
script from the scratch folder read 29 elements in 111 ms; the clone's setup re-run put the registration back. (5) Kill switch:
the toolbar button disarmed (`DISARMED` on `newTab`) and re-armed; left armed. Synthetic Alt+Shift+K by `keybd_event` did not fire
`_execute_action` (test tooling, not shown to be a product bug). (6) Store screenshots (S8 second half): `assets/store/store-{1,2,3}-*.png`,
1280×800, fixture pages, the Options page with the token masked, real SDK and MCP output.
Fixed on the way: `recipes/reload-extension.ps1` still derived the path-based ID and could not find the card (so `bridge-update`
could not reload); it defaults to the fixed ID now (RELOAD OK after). End state: the runner closed its own last Chrome window and
Chrome exited; the user reopens Chrome and the extension reconnects paired. Open: run from the package, doctor says "the next
client hands it over" against a same-version clone daemon that is in fact used as it is (wrong text). Not run here: the `.mcpb` in
Claude Desktop (U5), macOS and Linux.

**Findings for the user (before S2):** item 2 stays the open risk; the Web Store upload (U2) and the public key are needed only when S4 starts; U4 can be done now because the npm name exists; item 6 means S9 uses a hand-loaded scratch profile unless Chrome for Testing is installed.
