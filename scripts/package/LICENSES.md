# Licenses in this package

`browser-agent-bridge` holds code under two licenses, so its `license` field is `AGPL-3.0-only AND Apache-2.0`.

| Files | License | Text |
|---|---|---|
| `dist/index.js` (the SDK, the main export) and everything under `types/` | Apache-2.0 | `LICENSE-APACHE` |
| `dist/cli.js`, `dist/mcp.js`, `dist/daemon.js`, `dist/doctor.js` (the MCP server, the daemon and the commands) | AGPL-3.0-only | `LICENSE` |

The AGPL-3.0 bundles also contain the SDK and the shared protocol types, which stay Apache-2.0 on their own; a script
that imports only the SDK (`import { connect } from "browser-agent-bridge"`) uses Apache-2.0 code only.
`dist/mcp.js` also bundles third-party packages under their own licenses:
`THIRD-PARTY-NOTICES.txt` lists them with their license texts. `ws` is a dependency, installed beside this package.

In the source repository the same split holds: `sdk/` and `shared/` are Apache-2.0, everything else AGPL-3.0-only.
The licenses cover the code, not the name "Browser Agent Bridge".
