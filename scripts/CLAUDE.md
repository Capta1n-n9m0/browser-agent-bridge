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
  `bridge/*.ts`, `package/manifest.mjs`, `package/cli.mjs`, `test/*.ts`.
- `scripts/package/` (Step 15 S2, #449): `build.mjs` (`npm run build:npm` → `build/npm/`, gitignored: esbuild bundles
  `dist/{index,mcp,daemon,doctor,setup,cli}.js` with `ws` external, the SDK's `.d.ts` under `types/` with `@bridge/shared`
  rewritten to relative paths, `LICENSE`, `LICENSE-APACHE`, `LICENSES.md`, `THIRD-PARTY-NOTICES.txt` from the bundles'
  metafiles; `npm run pack:npm` also runs `npm pack` into `build/`), `manifest.mjs` (pure: the generated
  `package.json` — license `AGPL-3.0-only AND Apache-2.0` per #450 — and `cliAction`), `cli.mjs` (the main bin:
  none/`mcp` → the MCP server, `doctor`, `setup`, `help`), `LICENSES.md` (which file
  falls under which license), `tsconfig.types.json`. The root `package.json` stays `private`. Tests:
  `scripts/test/s15-package.test.ts`, `s15-doctor-package.test.ts`.
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
- **The native host is registered, not written** (S3; the host is S4's). The plan points at a placeholder script
  (`dist/native-host.js` in the package, `scripts/native-host/host.mjs` in a clone) that does not exist yet, and
  `ALLOWED_EXTENSION_IDS` is empty until S4 fixes the extension's ID, so Chrome lets no caller in. The launcher
  (`native-host.bat`/`.sh`, absolute `process.execPath`) and the manifest live beside the token on Windows; the manifest
  goes to Chrome's `NativeMessagingHosts` folder on macOS and Linux; Windows also gets the `HKCU` key (`reg add`, argv, no
  shell). The doctor reads the key with `reg query` and says "registered; the host arrives in a later version" while
  the script is missing; a missing registration is a hint, not a failure, while `ALLOWED_EXTENSION_IDS` is empty.
- **Token move (#449):** `tokenPlan` keeps the per-user file, moves a clone's `bridge.token` into it (then deletes the
  clone's copy), keeps both when they differ (the per-user file wins), and never prints a value. Clipboard offer: clip.exe
  on win32, pbcopy on darwin, none on Linux.
