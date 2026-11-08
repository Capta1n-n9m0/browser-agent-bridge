# daemon/ — Key files and runtime gotchas

The root `CLAUDE.md` and `docs/agent-rules.md` also apply.

## Key files
- `daemon/src/`: `index.ts` (entry → `daemon/dist/index.js`), `main.ts` (`runDaemon`: env, token,
  bind-is-the-lock, idle, signals, exit codes), `wsHost.ts` (binds 127.0.0.1, token gate, roles,
  welcome, heartbeat, `shutdown(code)`), `handshake.ts`, `registry.ts` (clients), `route.ts`
  (`daemon.*` methods, timeout bounds, forwarding), `bridge.ts` + `connection.ts` (the extension
  socket, id-correlated calls), `build.ts` (sha256 build id), `daemon-record.ts` (Step 15 S3: which file serves the port), `idle.ts`, `log.ts` (file log + `redact`).
  Step 7's tab layer, all pure but the last: `handles.ts` (`HandleTable`: `T<n>` ↔ Chrome tab id,
  remap on `tabReplaced`, dead handles kept 1 h / 1 000 for `TAB_GONE`), `leases.ts` (`LeaseTable`:
  one owner per tab, `TAB_HELD {owner, since}`), `lock.ts` (`VisibilityLock`: FIFO, `LOCK_TIMEOUT
  {holder}`, released on completion, deadline or disconnect), `methods.ts` (the one method-class
  table — a new extension method must enter it; `REMOVED_METHODS`: `selectTab` → `UNKNOWN_METHOD`; Step 10's
  `evaluateSaveStart`/`Chunk`/`End`, Step 11's `uploadFiles` and Step 12's `consoleMessages` are tab methods,
  lease-checked, no lock, #205, #238, #334 — 28 router methods; Step 12's `trustedFocus` and `TRUSTED_SETTLE_MS`),
  `intercept.ts` (`TabLayer`: resolve, lease check, lock, forward with `tabId`; events → handles; the
  opener rule and `leaseGranted`; `tab is required`; `retireAll` on a changed session marker; Step 9: keeps the extension's last
  `safetyState` (null until reported, from each new extension hello until that socket reports, and after the socket closes;
  `safetyStatus` is never sent with null), logs one line per change (booleans and the
  count), serves `daemon.status.safety`, broadcasts `safetyStatus`, withholds URLs/titles while the last state
  says disarmed, one `listTabs` per change; Step 12: each extension socket's hello `features`, the `VERSION` refusals and
  `trustedInput`, both below),
  `handle-mark.ts` (Step 8 S2b: handle numbers continue across daemons from
  `~/.browser-agent-bridge/handle-mark`, reserved in blocks of 64, a time base when the file fails; with no mark
  yet it carries over the old `~/.chrome-agent-bridge/handle-mark`, read only, Step 15 S1).

## Runtime gotchas
- **The daemon's bind is the lock.** The daemon calls `listen()` once on `127.0.0.1`; `EADDRINUSE` means another daemon
  won, so it logs `port <p> in use — another daemon owns it` and exits **0**, never retrying
  (`daemon/src/main.ts`; spec §9.3; decisions.md · 2026-10-22 · D3's daemon lifecycle). Don't add a
  retry or a non-zero exit there.
  Several Claude sessions and scripts can now share the one daemon as separate clients. The MCP's no-crash rule is in `mcp/CLAUDE.md`.
- **The daemon outlives the session on purpose** — the SDK spawns it detached with no stdio
  (`sdk/src/spawn.ts`). Once listening it exits only on idle (`BRIDGE_DAEMON_IDLE_MS`, default
  600000 ms with zero clients; the extension does not count), `daemon.shutdown`, a signal, or a fatal
  error; at start it also exits 1 on a bad `BRIDGE_PORT`, no token, no build id or a failed `listen`,
  and 0 when the port is taken (`daemon/src/main.ts`). Its only voice is
  `~/.browser-agent-bridge/daemon.log` (`YYYY-MM-DDTHH:MM:SSZ <msg>`, cut to its last 1 MiB on start; a
  line containing `://` or the token is withheld whole) (`daemon/src/log.ts`, D3 2026-10-22). Its build
  id is the sha256 of `daemon/dist/index.js`; `daemon.status` and `browser_status` print it. After
  `npm run build` changes that file, the next client's `connect()` sees a different build in the
  welcome, sends `daemon.shutdown` (other clients get close 4002 and reconnect without a handover — a build mismatch on that reconnect
  rejects with `VERSION`; decisions.md · 2026-10-22 · A reconnect after 4002 never hands the daemon over) and spawns the new one —
  once per `connect()`, then `VERSION`; the 10 s knock budget runs per spawn cycle (`sdk/src/knock.ts`, D4 2026-10-22). Since Step 15 S3 the
  daemon writes `daemon-<port>.json` {build, path, pid} in its state folder right after the bind (`daemon-record.ts`;
  a failed write is one pathless log line), and a client of another install uses a current, not-older daemon instead
  of handing it over (`sdk/CLAUDE.md`). Its pre-D3 `console.error`
  lines in `wsHost.ts` (routing failure, socket error, heartbeat drop) go nowhere, since there is no stdio (open NIT, D3/D5).
- **The daemon pings the extension socket every 30 s and terminates it on a missed pong** — browsers
  answer pings automatically, so a missed pong means Chrome (or the offscreen document) is gone. Without
  this the `Bridge` keeps a stale connection and every call waits the full 30 s timeout. Tests use
  `heartbeatMs: 30` and a `ws` client with `autoPong: false` to simulate a dead Chrome. (Pre-Step-6 this
  ran in the MCP's server; it moved with `wsHost.ts` to `daemon/src`, D1 2026-10-22.)
- **One WebSocket frame over 100 MiB closes the extension socket (1009).** `ws`'s default `maxPayload`
  (100 MiB) is set nowhere in the repo, so one oversized reply drops the extension's socket and every actor's
  in-flight call fails `NOT_CONNECTED`; a single result frame crossed daemon → client whole up to 99 MiB (measured
  on port 0 with a fake extension, Step 10 Stage 0 F1/F2, `…step10…-steps/stage0-transport.txt`, re-run by its
  verifier). Bulk data moves in slices (`downloadChunk`; `saveTo`'s pulls, decisions.md · 2026-10-25 · Stage 0:
  `saveTo` uses transport (B), with tab-carrying pulls (#205)).
- **`ws` is `external` in the daemon and MCP esbuild bundles** (it's CJS; `daemon/build.mjs`,
  `mcp/build.mjs`) — it resolves from `node_modules` at runtime, so both run from the repo.
- **An extension error frame must carry `code`.** On the wire, `code` is required since S2b: a proto:2
  extension error without one is still delivered, as `INTERNAL`, and logged once per connection as
  `extension error without code: <method>` (decisions.md · 2026-10-23 · S2b makes `code` required on
  error frames (#73); `daemon/src/wsHost.ts`).
- **Clients see handles (`T3`), never Chrome ids.** Only the daemon maps them (`daemon/src/handles.ts`);
  a daemon restart renumbers, so the MCP cursor is lost and re-claimed with a one-line notice (T4).
  `newTab`/`listTabs` results still carry the Chrome `id` beside `tab` (kept through Step 8 for its
  consumers: decisions.md · 2026-10-23 · The Chrome `id` stays beside `tab` this step; network calls
  without `tab` stay "active" (#81)). Since Step 8 S2b a new daemon **never reuses a handle number**:
  `daemon/src/handle-mark.ts` continues from `~/.browser-agent-bridge/handle-mark` (blocks of 64; a
  time base when the file cannot be read or written), so a stale `T3` from an earlier daemon answers
  `TAB_UNKNOWN` instead of landing on another tab, and the SDK's `Tab` refuses itself (`TAB_UNKNOWN`,
  no call) after a 4002 reconnect (decisions.md · 2026-10-23 · A new daemon never reuses a handle
  number; the SDK guards stale `Tab`s (#79); · S2b's details: the `selectTab` refusal grep, the marker's edge cases, the handle mark (#94) item 8). Tests inject the base
  and directory, never the real `~/.browser-agent-bridge/`.
- **`leaseGranted.url` starts empty for a popup** — `tabs.onCreated` fires before a `target=_blank`
  tab's url is set (Run 8 LEASE-3: `""`). The daemon polls `listTabs` (100 ms, ≤ 2 s) before sending
  the event; Run 9 R9-LEASE-3 got the url after 45 ms, and another client was refused (`TAB_HELD`) 44
  ms after the click, before the event (the grant is immediate). Since Step 13 S1 the extension joins
  `tabCreated` with `webNavigation.onCreatedNavigationTarget` within 250 ms and sends `openerTabId` = the navigation
  source, or none (`extension/src/opener-join.ts`, `extension/test/opener-join.test.ts`); the daemon's opener rule is
  unchanged. A background opener's popup is leased to the opener's owner (R20-POP-BG-3 PASS, 3 of 3, `in-ms=110`,
  2026-10-30); a popup with no bridge caller is not measured (R20-POP-OTHER-3 NOT MEASURED). Chrome's own `openerTabId`
  names the active tab for a background opener (25 of 30, Stage 0), so the extension never falls back to it. Before S1
  such a popup got no lease (Run 14 R14-POP-1 FAIL, Run 15 R15-POP-2 (b)); with the opener in front it was granted after
  150 ms (R15-POP-2 (a); decisions.md · 2026-10-25 · S7: Run 15 stands as recorded; its follow-ups (#226)).
- **Every tab call names its tab since Step 8 S2b.** The daemon refuses a tab method without `tab`
  (`BAD_PARAMS "tab is required"`, or `VERSION` from a no-proto extension), an unlisted untargeted method
  likewise, any `id` on `closeTab`/`focusTab`, and `selectTab` (`UNKNOWN_METHOD`, before resolution);
  network calls without `tab` (or `"active"`) mean the human's tab, with no log line (Step 8 as-built §
  S2b; decisions.md · 2026-10-23 · The Chrome `id` stays beside `tab` this step; network calls without `tab` stay "active" (#81); · S2b's details: the `selectTab` refusal grep, the marker's edge cases, the handle mark (#94)).
- **The session marker retires every handle when Chrome restarts.** The extension's hello carries
  `session` (`extension/src/session-marker.ts`): reused from `storage.session` on a worker restart; on
  a miss one 2 s bound waits for `runtime.onStartup` (fresh) — an extension reload (`onInstalled`
  install/update) reuses `storage.local`'s only when the bound ends, so **a reload's hello comes up to
  2 s later**; no event → fresh (costs leases, never safety). The daemon compares with the last hello's
  marker: any change after the first hello retires every live handle synchronously before the resync
  (one `tabGone` per holder with the pre-restart url/title, leases dropped, the lock untouched; log
  `extension session changed: <n> handles retired`; the marker is never logged) (decisions.md ·
  2026-10-23 · The session marker's mechanism, amended (#80); · S2b's details: the `selectTab` refusal grep, the marker's edge cases, the handle mark (#94) items 2–4). Measured: an
  extension reload kept the held handle (`extension resync: 5 tabs, 0 gone`, no session line; Run 12
  SM-0), and its resync line came 2 s after the press (pressed 16:53:10.415Z, resync stamped 16:53:12Z; `recipes/reload-extension.ps1` still found it and exited 0; one reload; #94's Revisit-if names this); `chrome://quit` closes every tab before the session changes, so a leased handle is retired by
  `tabGone` at the quit (+1539 ms) and the restart logs `0 handles retired` (Run 12 SM-1, twice;
  S6.md gotcha candidate 4). With a killed (not quit) Chrome the N ≥ 1 branch ran live: kill, relaunch,
  reconnect 106 ms; the daemon logged `extension session changed: 3 handles retired`, the holder got `tabGone`
  with its fixture URL, the old `Tab` answered `TAB_GONE`, and the safety state in `storage.local` survived
  (Run 15 RET-1R, under the user's grant G10-2; decisions.md · 2026-10-25 · S7: Run 15 stands as recorded; its
  follow-ups (#226) item 4).
- **A leaked lease on a retired handle is invisible through the API** — leases are keyed by handle and
  the handle is dead, so only a test that claims through the lease table or after the retire catches it
  (S2b verifier mutation M6, which survived until fixer round 1 added that test; S2b.md).
- **On a reload the daemon logs `safety state:` before `extension resync`** (by design:
  `daemon/src/intercept.ts` `onSafetyState` vs the resync; Run 13 SAFE-9, a wrong expected text, #195). A
  reload also closes an open options page (SAFE-9 record), and right after it `daemon.status` shows URLs one
  round trip later than the state (S3.md §6, by reading the code).
- **A trusted input holds the visibility lock across its focus** (Step 12 S6-G2, #338, #354): a `click`/`type`/`pressKey`
  with `trusted: true` and no `focusEmulation` takes the lock, forwards `focusTab`, re-checks the caller and the lease,
  forwards the input, replies, then holds the lock `TRUSTED_SETTLE_MS` (500 ms) more (`methods.ts` `trustedFocus`,
  `intercept.ts` `trustedInput`; `daemon/test/s6-trusted-focus.test.ts`; `takesLock` unchanged). The settle pause releases the lock with
  `.then(release, release)`, so a rejecting sleep still frees it (#390; same test file, the "rejecting settle sleep"
  case, Step 13 S4). Live, 2026-10-29: R19-G2-2
  PASS (5 of 5 typed strings intact under a competing capture); R19-G2-1 FAIL, the other client's screenshot got
  `TIMEOUT` at about 35 s while the hold was seen (`holder-after-reply-ms=477`), cause not established (a covered-window
  capture hang fits but is not shown; #373).
- **A feature belongs to its extension socket's hello.** `evaluate`/`evaluateSaveStart` with `args` to a socket whose
  hello lacked `"evaluateArgs"` is refused `VERSION` with `ARGS_RELOAD_HINT`, and `uploadFiles` with a `chooser` key
  (`false` and `null` included) lacking `"uploadChooser"` with `CHOOSER_RELOAD_HINT`, before the tab and lease checks and
  with nothing forwarded (`intercept.ts`; `daemon/test/s12-args-feature.test.ts`, `s12-chooser-feature.test.ts`,
  `s12-chooser-wire.test.ts`; #332, #355). A rethrown `VERSION` reaches an MCP agent without its code (`mcp/CLAUDE.md`).

The per-call timeout the SDK passes (`client.call(…, { timeoutMs })`) and the bounds `route.ts` applies to it are described in `sdk/CLAUDE.md`.
The SDK's knock, spawn and handover facts (a pre-Step-6 server on the port, `BRIDGE_PORT` and `BRIDGE_DAEMON` agreement, the `Start-Process` pipe, `spawn(…, {detached:true})` on Windows, several `ws` frames per read) are in `sdk/CLAUDE.md`.
