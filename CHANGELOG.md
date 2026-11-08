# Changelog

Versions follow `vX.Y.Z`. The npm package, the extension and the Claude Desktop extension carry the same number.

## 0.2.0

Distribution: Browser Agent Bridge for people who do not work from a clone. Not released yet.

- Renamed from "Chrome Agent Bridge" to **Browser Agent Bridge**. The MCP server is `browser-agent-bridge`, the state
  folder is `~/.browser-agent-bridge/`. Setup and doctor replace an old `chrome-agent-bridge` MCP entry.
- One npm package, `browser-agent-bridge`: the MCP server, the daemon, the SDK (main export, with types) and the
  `setup` and `doctor` commands. Claude Code: `claude mcp add browser-agent-bridge -- npx -y browser-agent-bridge`.
- The token lives in a per-user folder, not in the repo. A clone's `bridge.token` still works for developers.
- A fixed extension ID, and pairing with no pasted token: a small helper registered per user answers only the
  extension's ID and returns the token and port. The Options page keeps manual entry. Fresh install means fresh
  extension storage: redo the block list, Upload folders and the JavaScript switch.
- A Claude Desktop extension (`.mcpb`): double-click to install.
- Setup and doctor work on Windows, macOS and Linux.
- GitHub Actions: tests on three operating systems for every push; a `v*` tag builds the extension zip, the `.mcpb`
  and the npm package and creates the release.
- Brand icons for the extension.
- New docs: a product README, `docs/security.md`, `docs/privacy.md`, `docs/store-listing.md`.
- License: AGPL-3.0-only for the program, Apache-2.0 for the SDK and shared types.
- Unchanged: the 25 `browser_*` tools and their names, the wire protocol, the `127.0.0.1` bind and the safety controls.
- New extension permission: `nativeMessaging` (for pairing).

## 0.1.0

The state after Steps 1 to 14: the daemon, the extension, the MCP server and the SDK, with the safety controls, file
upload, console and network tools. Installed from a clone on Windows.
