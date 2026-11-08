# scripts/ — Key files and runtime gotchas

The root `CLAUDE.md` and `docs/agent-rules.md` also apply. Also covers `examples/`.

## Key files
- `scripts/bridge/lib.mjs`: the pure logic of the three commands (prerequisites, token decision, install and build
  staleness, the MCP entry decision and argv, `finish`, the doctor's lines, the update steps). It reads no file,
  spawns no process and holds no token value. Typed by JSDoc (`// @ts-check`).
- `scripts/bridge/setup.mjs` (`npm run setup`, and `npx browser-agent-bridge setup` from the package, where it is bundled to `dist/setup.js`; Step 15 S3: Windows, macOS, Linux, `--dry-run`, `--platform=` with `--dry-run` only), `scripts/bridge/update.mjs` (`npm run bridge-update`): the I/O around
  `lib.mjs`.
- `scripts/bridge/doctor.ts` (`npm run doctor`): runs under `tsx` because it reads the SDK's TypeScript; one hello and
  `daemon.status` over the SDK's own socket, never spawns or hands over a daemon, never calls the `claude` CLI.
- `scripts/test/s15-setup-os.test.ts` (S3: per-OS token plan, native-host plan, MCP argv, doctor lines) and `scripts/test/s14-{setup,doctor,update}.test.ts`: vitest over `lib.mjs` with injected facts; no real config or CLI.
- `scripts/tsconfig.json`: extends `tsconfig.base.json` with `allowJs` and `checkJs`; includes `bridge/*.mjs`,
  `bridge/*.ts`, `package/manifest.mjs`, `package/cli.mjs`, `native-host/*.mjs`, `release/*.mjs`, `test/*.ts`.
- `scripts/package/` (Step 15 S2, #449): `build.mjs` (`npm run build:npm` → `build/npm/`, gitignored: esbuild bundles
  `dist/{index,mcp,daemon,doctor,setup,cli,native-host}.js` (the list is `BUNDLE_ENTRIES` in `manifest.mjs`) with `ws` external, the SDK's `.d.ts` under `types/` with `@bridge/shared`
  rewritten to relative paths, `LICENSE`, `LICENSE-APACHE`, `LICENSES.md`, `THIRD-PARTY-NOTICES.txt` from the bundles'
  metafiles; `npm run pack:npm` also runs `npm pack` into `build/`), `manifest.mjs` (pure: the generated
  `package.json` — license `AGPL-3.0-only AND Apache-2.0` per #450 — and `cliAction`), `cli.mjs` (the main bin:
  none/`mcp` → the MCP server, `doctor`, `setup`, `help`), `LICENSES.md` (which file
  falls under which license), `tsconfig.types.json`. The root `package.json` stays `private`. Tests:
  `scripts/test/s15-package.test.ts`, `s15-doctor-package.test.ts`.
- `scripts/native-host/` (Step 15 S4): `host.mjs` and `pair.mjs`, the native messaging host (Runtime gotchas).
- `scripts/bridge/host-register.mjs` (Step 15 S5): the native host registration's I/O (`writeHostRegistration`, shared by
  setup and the MCP server) and `firstStartRegistration`, the MCP server's first start (Runtime gotchas); its decision is
  `lib.firstStartDecision`. Tests: `scripts/test/s15-first-start.test.ts` (temp folder, fake `reg`).
- `scripts/package/mcpb/` (Step 15 S5): `npm run pack:mcpb` → `build/browser-agent-bridge-<version>.mcpb`. `build.mjs` runs
  `build:npm`, stages `build/npm/` (without `types/`) plus `node_modules/ws` copied from the root, `manifest.json`
  (`manifest.mjs`, pure, `manifest_version` 0.3) and `icon.png` (copied from `assets/brand/icon-512.png`) in
  `build/mcpb/`, then `mcpb validate` and `mcpb pack` from the pinned devDependency `@anthropic-ai/mcpb` 2.1.2. Test:
  `scripts/test/s15-mcpb.test.ts` (the manifest against the official zod schema, the brand icons' PNG sizes and the manifest's `icons`).
- `scripts/brand/render.mjs` (Step 15 S8): rasterizes `assets/brand/{icon,promo-tile}.svg` into `extension/icons/icon-{16,32,48,128}.png`,
  `assets/brand/icon-512.png` and `promo-tile-440x280.png`; `@resvg/resvg-js` is not a repo dependency (`RESVG_DIR`, see the file's header).
- `scripts/release/` (Step 15 S6, #447): `version.mjs` (pure: `versionMismatches`, `tagProblem`, `setJsonVersion`,
  `changelogSection`), `version-cli.mjs` (`npm run version:check [-- --tag vX.Y.Z]`, `npm run version:set -- X.Y.Z`: writes
  the root `package.json`, `package-lock.json`'s root entries and only the manifest's `"version"` line; the npm package and
  the `.mcpb` take the root's version), `zip.mjs` (pure zip writer: sorted forward-slash names, fixed 2020-01-01 time;
  `storeManifest` drops `key`; `extensionZipFiles`: `manifest.json`, top-level `*.html`, `dist/*.js`, `icons/*.png`),
  `build.mjs` (`npm run release:build [-- --tag vX.Y.Z]` → `build/release/`: the `.tgz`, the `.mcpb`,
  `browser-agent-bridge-extension-<v>.zip`, `release-notes.md`, `SHA256SUMS.txt`; fails when a manifest-named file is
  missing from the zip, and on a full-release tag without its `CHANGELOG.md` section). Called by
  `.github/workflows/release.yml` (the name npm trusted publishing expects, U4; a `-pre` tag makes a draft prerelease and
  no npm publish; `workflow_dispatch` only builds) and by `ci.yml`'s Linux dry run. Test: `scripts/test/s15-release.test.ts`.
- `scripts/doc-check.mjs`: the cleanup pass's objective checks (`cleanup-pass` skill).
- `examples/list-tabs.ts`: the smallest script outside the repo, using the SDK through a `file:` dependency (#430);
  steps in `docs/setup.md`, "Scripts from any folder".

## Runtime gotchas
- **The doctor has two modes** (Step 15 S2): run from the installed package (`findPackageRoot`), it prints a `Package`
  line instead of `Build`, accepts any user-scope MCP entry, skips the extension-build heuristic and never says
  `npm run setup`; in a clone it is as before. Both read the token through the SDK's `findFileToken` and the daemon
  through `resolveDaemonPath`. `doctor.ts` is in the log scan.
- **The old MCP name** (Step 15 S1, #444): `LEGACY_SERVER_NAMES` (`chrome-agent-bridge`). With no current entry the old
  one stands in (`mcpEntry`), and `mcpDecision` says `replace` even without `--replace-mcp`; setup removes every old
  user-scope entry before adding; the doctor fails `MCP entry` (or `Old MCP entry` beside a current one).
- **No root npm script may be named like an npm lifecycle hook** (`install`, `postinstall`, `prepare`, `update`, …):
  npm runs those itself, `npm ci` among them. `LIFECYCLE_NAMES` in `lib.mjs` lists them and the tests read
  `package.json` against it (Stage0.md C1; decisions.md · 2026-10-30 · Stage 0: the three commands are Node scripts with
  non-lifecycle names; S2 in two slices (#427)).
- **`setup.mjs`, `update.mjs` and `lib.mjs` use Node built-ins only**: setup runs before `npm ci`, so no `tsx` and no
  dependency. Only `doctor.ts` may import the SDK.
- **Rehearsing an install (measured 2026-10-30):** `claude mcp get` and `claude mcp list` health-check each server, so
  they start `mcp/dist/index.js`; decide from the config file instead. `CLAUDE_CONFIG_DIR` moves the CLI's
  `.claude.json`: an `add` under a scratch value wrote only there (`claudeConfigPath` in `lib.mjs` reads the same
  variable). Claude Code rewrites `~/.claude.json` on its own, so a guard hashes its `mcpServers` key, not the whole
  file. Rehearse in a scratch clone with a scratch `CLAUDE_CONFIG_DIR`; for the reload script's behaviour there, see
  `recipes/CLAUDE.md`.
- **Setup knows its platform and mode as injected facts** (Step 15 S3). `lib.mjs` helpers take `platform` (default
  `"win32"`, what the Step 14 tests pin; setup and doctor pass `process.platform`). Mode is "package" when the first
  `package.json` above `setup.mjs` is `browser-agent-bridge` without `workspaces`; then there is no git check, `npm ci`
  or build. `lib.userTokenFile` mirrors `sdk/src/token.ts` (setup cannot import TS); a test compares the two.
- **The package's MCP entry is `npx -y browser-agent-bridge`, wrapped as `cmd /c npx …` on win32**: Claude Code on native
  Windows cannot start npx directly. `mcpDecision` in package mode leaves either form and reports (or, with
  `--replace-mcp`, replaces) anything else, a clone path included.
- **The native host** (S3 registers it, S4 wrote it; #449): `scripts/native-host/host.mjs` (thin I/O; bundled to the
  package's `dist/native-host.js` from `BUNDLE_ENTRIES` in `package/manifest.mjs`) over `pair.mjs` (pure, tested in
  `test/s15-native-host.test.ts`, a real child process included). Order: the first argument must equal
  `lib.EXTENSION_ORIGIN` exactly (`chrome-extension://iifofgbdljchbdimlalhphmedfmocela/`), else `forbidden-origin`
  before stdin or any token file is read; then one frame (declared length over 4096 refused unread, 5 s timeout), only
  `{"type":"pair"}`; then the token in the ruled order (`BRIDGE_TOKEN`, the per-user file, a clone's `bridge.token`
  never inside the package) and the port (`BRIDGE_PORT` if 1–65535, else 9234). Reply `{ok:true, token, port}` or
  `{ok:false, error:<fixed code>}`; a token outside `TOKEN_RE` is `bad-token`. Nothing goes to stderr (an uncaught error
  exits 1 silently); its one stdout write is in the log allowlist. Chrome starts it with Chrome's environment, not a
  shell's, so `BRIDGE_TOKEN` set in a terminal does not reach it. `ALLOWED_EXTENSION_IDS = [EXTENSION_ID]`. The
  launcher (`native-host.bat`/`.sh`, absolute `process.execPath`) and the manifest live beside the token on Windows; the
  manifest goes to Chrome's `NativeMessagingHosts` folder on macOS and Linux; Windows also gets the `HKCU` key (`reg
  add`, argv, no shell). The doctor reads the key with `reg query` and the manifest's `allowed_origins`
  (`manifestOrigins`); every Native host problem is a hint (a token pasted in Options still works), and an S3-era
  manifest (empty `allowed_origins`) reads "does not admit this extension's ID": run setup again.
- **The MCP server's first start** (S5, #449): an installed package (npx or the `.mcpb`; a clone does nothing, setup
  owns it) makes the per-user token when neither `BRIDGE_TOKEN` nor the file holds one (flag `wx`: two servers starting
  at once keep the first), then registers the native host from where it runs, whenever the manifest, the launcher or the
  registry value differ (an npx cache folder or a Claude Desktop update that moved the server registers again; an
  unchanged one writes nothing, one `reg query` per start on Windows). Under Electron (`process.versions.electron`,
  Claude Desktop's built-in Node) the launcher sets `ELECTRON_RUN_AS_NODE=1`; whether Claude Desktop's Node is Electron
  is not measured (S9). It never throws; `mcp/src/index.ts` logs one fixed line on `registered` or `failed`.
  `BRIDGE_NO_HOST_REGISTRATION=1` turns it off: **set it for any real run of a packaged MCP server on Windows**, or it
  writes the real `HKCU` key (scratch `APPDATA` moves the files, not the registry). Several installs (npx, `.mcpb`,
  a clone's setup) each register their own host; any of them pairs, the last one to start wins.
- **CI runs Node 22 and sets `BRIDGE_NO_HOST_REGISTRATION=1`** (S6). A test that runs a `.ts` file in a child `node`
  needs type stripping, default only from Node 22.18 / 23.6: `sdk/test/spawn-inherit.test.ts` adds
  `--experimental-strip-types` when `process.features.typescript` is off (on Linux with Node 22.14 it failed without it;
  measured in WSL, 2026-11-08). The Chrome manifest takes no prerelease suffix, so `version:set 0.2.0-rc.1` writes `0.2.0` there.
- **Token move (#449):** `tokenPlan` keeps the per-user file, moves a clone's `bridge.token` into it (then deletes the
  clone's copy), keeps both when they differ (the per-user file wins), and never prints a value. Clipboard offer: clip.exe
  on win32, pbcopy on darwin, none on Linux.
