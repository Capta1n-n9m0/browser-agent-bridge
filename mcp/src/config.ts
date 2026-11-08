// The MCP's own configuration. The token and port are not read here any more: `connect()` from
// @bridge/sdk resolves them (BRIDGE_TOKEN, the per-user `bridge.token`, a clone's `bridge.token`; BRIDGE_PORT,
// default 9234) — phase-doc decision 0.10.

/**
 * The actor name the daemon lists in `daemon.status` and its log. It carries the MCP's own process
 * id, not `ppid`: under the nvm-windows shim the parent is the shim (decisions.md · 2026-10-21 ·
 * The actor name carries the MCP's own process id).
 */
export function actorName(pid: number = process.pid): string {
  return `claude-code #${pid}`;
}

/**
 * The MCP's `connect()` options. `requireExtension: false`: the MCP holds a daemon client even while
 * Chrome is closed, so `browser_status` reports the extension down and tool calls get the daemon's
 * own NOT_CONNECTED at once, instead of a 15 s wait and a fresh client every ~20 s (decisions.md ·
 * 2026-10-22 #27).
 */
export function connectOptions(pid: number = process.pid): { name: string; requireExtension: false } {
  return { name: actorName(pid), requireExtension: false };
}
