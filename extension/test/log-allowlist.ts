/**
 * Step 9 S2b: the 0.7 log scan's committed allowlist — every `console.*` call, every injected-logger call
 * (`log(…)`, `….log(…)`), every logger or `console`/`process` used as a value, and every `process.stdout`/`stderr`
 * use (the forms `log-scan.ts` enumerates) in `extension/src`, `daemon/src`, `sdk/src`, `mcp/src`, `scripts/package` and
 * `scripts/bridge/doctor.ts` (the npm package's commands, Step 15 S2), `scripts/native-host` (the native host, S4), by file and normalised call
 * text, with what it may print (phase doc 0.7's F28 note; S2.3 as #141 words it). `log-scan.test.ts` fails on a
 * site not listed here and on an entry no longer found. A changed argument is a changed text: re-review it.
 *
 * No entry may print a block-list pattern, a page URL, a tab title, a header value, a body or the token.
 * The daemon's file logger (`daemon/src/log.ts` `redact`) also withholds any whole line that contains `://`
 * or the token; `console.*` in the daemon goes nowhere (it has no stdio, CLAUDE.md).
 */
import type { LogSite } from "./log-scan.js";

export interface AllowedLogSite extends LogSite {
  /** What the call may print, in one line. */
  prints: string;
}

export const LOG_ALLOWLIST: readonly AllowedLogSite[] = [
  // ---------------------------------------------------------------- extension/src (16)
  { file: "extension/src/badge.ts", call: "console.log(toggleLogLine(r))", prints: "one of five fixed strings (`safety: disarmed by the user`, …); no value" },
  { file: "extension/src/debugger.ts", call: 'console.warn("[bridge] focus emulation: disable failed; detach clears it:", describeDebuggerError(err).code)', prints: "a fixed text and an error code name" },
  { file: "extension/src/handlers/actions.ts", call: 'console.warn("[bridge] content-script click failed; escalating to CDP trusted input:", codeOf(err))', prints: "a fixed text and an error code name" },
  { file: "extension/src/handlers/actions.ts", call: 'console.warn("[bridge] content-script type failed; escalating to CDP trusted input:", codeOf(err))', prints: "a fixed text and an error code name" },
  { file: "extension/src/handlers/download.ts", call: 'console.log("[bridge] download held", bytes.length, "bytes")', prints: "a byte count" },
  { file: "extension/src/handlers/evaluate.ts", call: 'console.log("[bridge] evaluate", expression.length, "chars")', prints: "a character count (never the expression)" },
  { file: "extension/src/network-state.ts", call: "console.log(`[bridge] network: rehydrated ${n} entries`)", prints: "an entry count" },
  { file: "extension/src/network-state.ts", call: "console.warn(`[bridge] network: session storage write failed, evicted ${dropped} entries`)", prints: "an entry count" },
  { file: "extension/src/network-state.ts", call: 'console.warn("[bridge] network: session storage write failed again, keeping memory only")', prints: "a fixed text" },
  { file: "extension/src/sw.ts", call: 'console.warn("[bridge] no token set — open the extension options page to configure.")', prints: "a fixed text (says the token is missing; never its value)" },
  { file: "extension/src/sw.ts", call: 'console.error("[bridge] connect failed:", err)', prints: "an Error from chrome.storage / offscreen / runtime.sendMessage on the connect path (Chrome's wording; not known to carry a page URL or the token)" },
  { file: "extension/src/sw.ts", call: 'console.warn("[bridge] reply relay failed:", e)', prints: "an Error from runtime.sendMessage (Chrome's wording, e.g. no receiving end); never the reply" },
  { file: "extension/src/sw.ts", call: "console.log(pairLine)", prints: "one of pairing.ts' fixed pairLogLine strings (Step 15 S4); never the token, the host's reply or Chrome's message" },
  { file: "extension/src/sw.ts", call: 'console.log("[bridge] connection: up")', prints: "a fixed text" },
  { file: "extension/src/sw.ts", call: 'console.error("[bridge] connection: down")', prints: "a fixed text" },
  { file: "extension/src/sw.ts", call: 'console.warn("[bridge] debugger detached, tabId", source.tabId, "reason:", reason)', prints: "a numeric tab id and Chrome's detach reason enum" },

  // ---------------------------------------------------------------- daemon/src (33)
  { file: "daemon/src/handle-mark.ts", call: "log(LOG_UNREADABLE)", prints: "a fixed text" },
  { file: "daemon/src/handle-mark.ts", call: "log(LOG_NOT_WRITTEN)", prints: "a fixed text" },
  { file: "daemon/src/handle-mark.ts", call: "log (as a value): options.log ?? (() => {})", prints: "nothing itself: copies the injected logger into the local `log` whose two calls are above (S2b fixer r1, F2)" },
  { file: "daemon/src/intercept.ts", call: "this.deps.log?.(`extension session changed: ${retired.length} handles retired`)", prints: "a count (never the marker)" },
  { file: "daemon/src/intercept.ts", call: "this.deps.log?.(`extension resync: ${tabs.length} tabs, ${gone} gone`)", prints: "two counts" },
  { file: "daemon/src/intercept.ts", call: 'this.deps.log?.("safety state: not reported (extension disconnected)")', prints: "a fixed text" },
  { file: "daemon/src/intercept.ts", call: "this.deps.log?.(safetyLogLine(state))", prints: "two booleans and the blocked count (never a pattern)" },
  { file: "daemon/src/intercept.ts", call: 'this.deps.log?.("safety state: listTabs after the change failed")', prints: "a fixed text" },
  { file: "daemon/src/intercept.ts", call: 'this.deps.log?.("safety state: malformed event dropped")', prints: "a fixed text (never the event's params)" },
  { file: "daemon/src/main.ts", call: "logger.log(`exit ${code} (${why})${counts}`)", prints: "an exit code, a fixed reason and counts" },
  { file: "daemon/src/main.ts", call: "logger.log(`fatal: ${errorName(err)}`)", prints: "an error's class name only" },
  { file: "daemon/src/main.ts", call: "logger.log(`start pid=${pid}`)", prints: "a pid" },
  { file: "daemon/src/main.ts", call: 'logger.log("daemon record not written — clients of another install may hand this daemon over")', prints: "a fixed text (Step 15 S3; no path)" },
  { file: "daemon/src/main.ts", call: 'logger.log("BRIDGE_PORT is not a port number (1-65535)")', prints: "a fixed text" },
  { file: "daemon/src/main.ts", call: "logger.log(`BRIDGE_DAEMON_IDLE_MS is not a whole number of ms from 1 to ${MAX_IDLE_MS}; using ${DEFAULT_IDLE_MS}`)", prints: "two constants" },
  { file: "daemon/src/main.ts", call: 'logger.log(err instanceof Error ? err.message : "No bridge token")', prints: "resolveToken's 'No bridge token' message: a file path, never a token (none was found)" },
  { file: "daemon/src/main.ts", call: "logger.log(`cannot hash the daemon entry for its build id: ${errorCode(err) ?? errorName(err)}`)", prints: "an errno code or error class name" },
  { file: "daemon/src/main.ts", call: "logger.log(`config pid=${pid} port=${port} idleMs=${idleMs} build=${build}`)", prints: "pid, port, idle ms, build hash" },
  { file: "daemon/src/main.ts", call: "logger.log(msg)", prints: "the WsHost/TabLayer `log` option's lines (the daemon/src entries above and wsHost's below)" },
  { file: "daemon/src/main.ts", call: "logger.log(msg)", prints: "handle-mark's `log` option's lines (its two fixed texts above)" },
  { file: "daemon/src/main.ts", call: "logger.log(`${why} — shutting down`)", prints: "a fixed reason (signal or daemon.shutdown or idle)" },
  { file: "daemon/src/main.ts", call: "logger.log(`shutdown failed: ${errorName(err)}`)", prints: "an error's class name only" },
  { file: "daemon/src/main.ts", call: "logger.log(`listening on 127.0.0.1:${bound}`)", prints: "the bound port" },
  { file: "daemon/src/main.ts", call: "logger.log(`port ${port} in use — another daemon owns it`)", prints: "a port" },
  { file: "daemon/src/main.ts", call: "logger.log(`cannot listen on port ${port}: ${errorCode(err) ?? errorName(err)}`)", prints: "a port and an errno code" },
  { file: "daemon/src/main.ts", call: "logger.log(`client + ${JSON.stringify(name)} (${clients(count)})`)", prints: "a client's self-chosen name and a count (a name with `://` or the token is withheld whole by `redact`)" },
  { file: "daemon/src/main.ts", call: "logger.log(`client - ${JSON.stringify(name)} (${clients(count)})`)", prints: "a client's self-chosen name and a count (as above)" },
  { file: "daemon/src/wsHost.ts", call: 'console.error("[chrome-bridge] routing failed:", err instanceof Error ? err.name : typeof err)', prints: "an error's class name (to no stdio)" },
  { file: "daemon/src/wsHost.ts", call: 'console.error("[chrome-bridge] socket error:", err.message)', prints: "the `ws` library's socket error message (to no stdio)" },
  { file: "daemon/src/wsHost.ts", call: 'console.error(`[chrome-bridge] ${role ?? "unauthenticated peer"} stopped answering pings — dropping the connection`)', prints: "a role name (to no stdio)" },
  { file: "daemon/src/wsHost.ts", call: "log(`extension error without code: ${method}`)", prints: "a method name" },
  { file: "daemon/src/wsHost.ts", call: "log (as a value): log: options.log", prints: "nothing itself: hands the daemon log to TabLayer, whose calls are intercept.ts's `this.deps.log?.(…)` entries (S2b fixer r1, F2)" },
  { file: "daemon/src/wsHost.ts", call: "log (as a value): log = this.options.log", prints: "nothing itself: copies the logger into the local `log` of the `extension error without code` entry above (S2b fixer r1, F2)" },
  { file: "daemon/src/wsHost.ts", call: "log (as a value): proto && log", prints: "nothing: a truthiness test of that local copy (S2b fixer r1, F2)" },

  // ---------------------------------------------------------------- mcp/src (6)
  { file: "mcp/src/index.ts", call: 'console.error("[chrome-bridge] connected to the bridge daemon")', prints: "a fixed text (to the MCP's stderr)" },
  { file: "mcp/src/index.ts", call: "console.error(`[chrome-bridge] bridge daemon unavailable (retrying every 5 s): ${reason}`)", prints: "the SDK's connect() error message (127.0.0.1 port, daemon path, VERSION text; never the token)" },
  { file: "mcp/src/index.ts", call: "console.error(`[chrome-bridge] shutting down: ${reason}`)", prints: "a fixed lifecycle reason (stdin end, a signal name, parent gone)" },
  { file: "mcp/src/index.ts", call: 'console.error("[chrome-bridge] native host registered for this install")', prints: "a fixed text (Step 15 S5 first start; no path)" },
  { file: "mcp/src/index.ts", call: 'console.error("[chrome-bridge] native host registration failed (the Options page still takes a token)")', prints: "a fixed text (Step 15 S5 first start; no path, no error message)" },
  { file: "mcp/src/index.ts", call: 'console.error("[chrome-bridge] fatal:", err)', prints: "a start-up Error with its stack (main() before the server runs; no page data exists yet)" },
  { file: "mcp/src/index.ts", call: "process.stdout (as a value): stdout: process.stdout", prints: "nothing: handed to installLifecycle as an EventEmitter, which only listens for `error` (lifecycle.ts:66,84); the MCP SDK's stdio transport writes the JSON-RPC channel itself, outside the scanned packages (S2b fixer r1, F2)" },
  { file: "mcp/src/index.ts", call: "process (as a value): signals: process", prints: "nothing: handed to installLifecycle as an EventEmitter for signal listeners only (lifecycle.ts:67,85) (S2b fixer r1, F2)" },

  // ---------------------------------------------------------------- sdk/src (0): the SDK never logs.

  // ---------------------------------------------------------------- the npm package's commands (5, Step 15 S2)
  { file: "scripts/package/mcpb/build.mjs", call: "console.log(`built build/${path.basename(out)} (${Object.keys(want).length} runtime dependency copied)`)", prints: "the .mcpb file name and a count (the build tool, never shipped)" },
  { file: "scripts/package/build.mjs", call: "console.log(`built build/npm: ${entries.length} bundles, ${declarations} declaration files, ${thirdParty.size} third-party packages noticed`)", prints: "three counts (the build tool, never shipped)" },
  { file: "scripts/package/cli.mjs", call: "process.stdout (as a value): action.exit === 0 ? process.stdout : process.stderr", prints: "one of cliAction's fixed texts (usage, the setup notice); no argument is echoed" },
  { file: "scripts/package/cli.mjs", call: "process.stderr (as a value): action.exit === 0 ? process.stdout : process.stderr", prints: "one of cliAction's fixed texts (usage, the setup notice); no argument is echoed" },
  { file: "scripts/native-host/host.mjs", call: "process.stdout.write(encodeFrame(reply, endian), () => process.exit(0))", prints: "the one native-messaging reply frame to Chrome (Step 15 S4): {ok:true, token, port} only after the caller's origin equals the extension's fixed one, else {ok:false, error:<fixed code>}; the token on purpose, to that extension only, never to stderr" },
  { file: "scripts/bridge/doctor.ts", call: "console.log(lib.formatLine(l))", prints: "a doctor line: fixed texts, the Node and package versions, ports, paths of the token file and the MCP entry; tokens only as same/differs" },
  { file: "scripts/bridge/doctor.ts", call: 'console.log(failed ? `\\n${failed} part(s) failed: each FAIL line names its fix.` : "\\nNo part failed.")', prints: "a count of failed parts" },
];
