# extension/ — Key files and runtime gotchas

The root `CLAUDE.md` and `docs/agent-rules.md` also apply. `src/` and three of its sub-folders have their own `CLAUDE.md`, loaded only when
you open a file there; read the one whose topic you touch from elsewhere in `extension/`:
- `src/` (any file under it) — the block list and redirect hops, the DNR rule builder's facts, the `file:` page rule, the
  upload's file-access, existence and closure-free rules, the chooser upload, the console read, the kept session.
- `src/content/` — IIFE build, snapshot rules, `centerOf`, content-script failures, locators and `a11y.ts`, `locate` vs RefMap, marks.
- `src/evaluate/` — `returnByValue` flattening, `replMode` levels, primitive values over CDP.
- `src/handlers/` — `browser_download` from the worker, `tabId` and `targetTab`, `newTab` in the background, the CDP screenshot refusal.

## Key files
- `extension/src/`: `sw.ts` (the `GatedRouter` + offscreen orchestration; the top-level `chrome.tabs.on*`,
  `action.onClicked` and `storage.onChanged` listeners), `router.ts` (thrown error →
  `{code, message, data?}`; Step 9's `GatedRouter`, the only router `sw.ts` builds: `on` throws for a method
  with no safety class, unknown → `UNKNOWN_METHOD` in every state), `offscreen.ts` (the socket; accepts only
  this extension's non-tab senders, `relay-sender.ts`),
  `client.ts` (the hello; since Step 12 `features: ["evaluateArgs", "uploadChooser"]`, pinned by the last test of
  `extension/test/s12-args-call.test.ts`; the daemon's `VERSION` for a hello without them is in `daemon/CLAUDE.md`), `session-marker.ts` (pure: the session marker's choice over event orders),
  `trusted-input.ts` (pure: the CDP steps of trusted input, with or without focus emulation),
  `tabs.ts` (`targetTab` — `tabId` required since S2b — `humansTab`, `activateForCapture` + restore,
  `cdpCaptureRefusal`),
  `errors.ts` (`BridgeError`, `toWireError`, `splitCoded`), `tab-events.ts` (pure: tab events +
  the last-url/title cache), `opener-join.ts` (Step 13 S1, pure, ids only, no log: holds a `tabCreated` that carries Chrome's `openerTabId`
  up to `OPENER_JOIN_HOLD_MS` = 250 ms and joins it with `webNavigation.onCreatedNavigationTarget`'s `sourceTabId`; a held event
  is released before that tab's `tabRemoved`/`tabReplaced`; an unjoined tab's `tabCreated` can be overtaken by other tabs'
  events meanwhile, and no daemon path depends on the order; needs the `webNavigation` permission, granted by the user
  (#374), no new install warning (#393); `extension/test/opener-join.test.ts`, `tab-events.test.ts`,
  `manifest.test.ts`, and `s3a-dnr-wiring.test.ts` pinning 21 listeners with one `onCreatedNavigationTarget`), `network-scope.ts` (pure: which tab a network call covers),
  `inject.ts` (`ensureContent`/`callInPage` + `toSerializableArgs`/`unwrapResult`), `handlers/*`
  (Step 8: `target.ts` turns a `ref` or `locator` into a ref before the action; `locate.ts`; `locator-wait.ts`, the
  100 ms `waitFor {locator}` poll), `content/{index,snapshot,refmap,actions,geometry,guard}.ts`
  and `content/a11y.ts` (the one walk, `roleOf`, the accessible name, the pruning gates, shared by snapshot and
  locate), `content/locate.ts`, `content/nearest.ts` (candidate ranking),
  `content/marked.ts` (`refOfMarked`), `content/upload-target.ts` (Step 11: `uploadInputOf`, the one-off mark), `debugger.ts` (`withDebugger`, through Step 12's
  `debugger-keeper.ts`: one kept session per tab, #335), `debugger-errors.ts`
  (pure: CDP failure → `{code, message}`), `keys.ts` (pure: key name → CDP key params),
  `evaluate/{serialize,wrap,result,mark}.ts` (pure: in-page serialiser source, `return`-wrapper,
  CDP-result → `EvalEnvelope`, the `asRef` mark; Step 12's `evaluate/call.ts`, the `args` call form, #330), `network-log.ts` (pure: `NetworkLog` reducer + query (its text formatter moved to `sdk/src/format`),
  redaction, body summary, serialise/merge), `network-state.ts` (the singleton log, the
  `storage.session` rehydrate/flush, the own-port variable), `handlers/network.ts`,
  `download.ts` (pure: `DownloadStore`, base64, filename from `content-disposition`) +
  `handlers/download.ts` (the service-worker fetch); the other half is `sdk/src/download.ts`.
  Step 10: `evaluate-save-store.ts` (pure: `EvaluateSaveStore` — 5 min TTL refreshed per pull, 8 entries, 256 MiB per
  value and in total, 1 MiB slices, the `Unknown or expired evaluateSave id` refusal), `evaluate/save.ts` (pure: the
  page-side sources `SAVE_PREPARE_SRC`/`SAVE_META_SRC`/`SAVE_SLICE_SRC`, the value checks and refusal texts) +
  `handlers/evaluate-save.ts` (the three `evaluateSave*` handlers; the CDP-leg slices in `debugger.ts`);
  `content/locate.ts` computes `pastSnapshotCap` and `handlers/{target,locate,actions}.ts` carry it (#216).
  Step 9 (Phase E safety): pure, unit-tested, with no log call — `safety.ts` (the gate
  `safetyDecision`, the method table `METHOD_CLASSES` over all 28 router methods (S3a of Step 12 added `consoleMessages`,
  class `evaluate`, #334, served by `handlers/console.ts` over `console-messages.ts`; Step 11 S2 added `uploadFiles`, class
  `upload`; Step 10 S4 added `evaluateSaveStart`/`evaluateSaveChunk`/`evaluateSaveEnd`, class `evaluate`), `methodClass`
  throws on an unknown name, the refusal messages (`JS_DISABLED_MESSAGE` since Step 10 S4b, `DISARMED_EVALUATE_MESSAGE` its alias, #219), `listTabs`/event redaction, the network predicate),
  `safety-match.ts` (the block-list grammar and matcher, dot boundary only; #135, #156), `safety-state.ts`
  (`SAFETY_KEYS`, the per-call read that fails closed, `SafetyStore.toggle()` → `"disarmed" | "armed" | "ignored" | "write-failed"`, the 1 s re-arm guard, `readStoredArmed`,
  the `safetyState` reporter), `safety-call.ts` (one call's gate at receipt, before each first side effect,
  and the post-check), `safety-debugger.ts` (the session registry `detachAll` at disarm),
  `safety-network.ts` (the ingest filter), `safety-dnr.ts` (Step 11b S1: the block list as DNR session rules, tab
  and download scopes, pure; permission `declarativeNetRequestWithHostAccess`),
  `safety-dnr-keeper.ts` (S2: per-call rule ids, install/release on every path, the
  rebuild only on a block-list edit or an unreadable state since S3b, #302; the start-up clear; fail closed),
  `safety-hop.ts` (S3b: recognises a download's blocked hop from `onErrorOccurred` before `ingest`, keeps no URL),
  `handlers/history.ts` (`back`/`forward`: while the call holds rules, wait for the load it starts, at most 10 s, #302),
  `newtab-open.ts` (S6: `newTab` with a URL opens `about:blank`, holds the rules, settles the blank load, then
  navigates; removes the blank tab if the hold or navigation throws; pure, injected, #311),
  `upload-exists.ts` (Step 11b S0F-b: the pre-attach file check), `upload-paths.ts` (Step 11: the upload-folder matcher and, since S0F-a, the home-folder predicate; pure, no log;
  #236, #249, #258), `upload-files.ts` (Step 11: the upload's CDP steps in one session — finder in a
  `Page.createIsolatedWorld` world, `DOM.setFileInputFiles`, the unmark; the shipped strings are closure-free and
  tested), `handlers/upload.ts` (the `uploadFiles` handler: the file-access check before the attach, #245 (b)),
  `options-model.ts` (the options page's analysis and texts, the Upload folders lines since Step 11),
  `relay-sender.ts` (the offscreen sender check); `pairing.ts` (S4: no token → ask the native host); `badge.ts` (badge/title by state, `BadgeController.press`;
  `chrome.action` injected, unit-tested) logs one fixed line per press (`toggleLogLine`); `options.ts` +
  `extension/options.html` are page glue (DOM + `chrome.storage.local`, the Safety, Blocked sites and Upload folders
  boxes), not unit-tested, read statically by `safety-writers.test.ts`. Guards: `log-scan.test.ts`
  (+ `log-allowlist.ts`, 64 log sites, the npm package's scripts included), `log-sentinel.test.ts`, `safety-writers.test.ts`, `manifest.test.ts`.
  Older files: handlers are listed by method in `sw.ts` (`handlers/{actions,evaluate,navigate,perceive}.ts`);
  `evaluate/wrap.ts` is the `return` heuristic for `replMode`; `content/{actions,geometry,index,refmap}.ts` hold the
  page-side actions, frame-aware element centres, the `window.__agentBridge` entry and the `RefMap`.

## Runtime gotchas

### Service worker, CDP and network
- **`chrome.scripting.executeScript` can't serialize `undefined` in `args`** → "Value is unserializable".
  Optional handler params arrive undefined. `callInPage` runs args through `toSerializableArgs`
  (undefined→null). Don't pass raw optional values into executeScript args.
- **A thrown injected function does NOT reject `executeScript`** — Chrome resolves the frame with
  `result: null`. `unwrapResult` treats null OR undefined as failure (no page fn returns those on
  success). Without it, bad/stale refs *silently succeed*. Keep that invariant if you add page fns.
- **"The human's tab" has one resolver: `humansTab()` = `windows.getLastFocused({windowTypes:["normal"]})`
  → its active tab** (`extension/src/tabs.ts`; decisions.md · 2026-10-22 · "The human's tab" is the active
  tab of the last-focused normal window (#43)). It serves `listTabs`' `current:
  true`, `tabs.claim {active:true}` (so `browser_use_active_tab` and the MCP's first touch), a network
  call with no `tab`, `browser_status` and `browser_list_tabs`'s `*`; the SDK's `tabs()` reads
  `current`. `listTabs`' `active` keeps Chrome's per-window meaning (every window's active tab), so never pick
  "the first `active`" again. Measured with the service-worker DevTools window in front: status and
  snapshot named and acted on the same tab (Run 9 R9-RESOLVER-1, 2026-10-23). With no normal window
  at all, calls fail with `No normal Chrome window is focused (a DevTools or popup window may have
  focus) …`.
- **Chrome allows one debugger per tab**: `chrome.debugger.attach` can throw "Another
  debugger is already attached…" (`DEBUGGER_DEVTOOLS` stays); clicking the banner's Cancel mid-action makes `sendCommand` throw
  "Detached while handling command". `withDebugger` maps both through `describeDebuggerError` — add new
  Chrome strings there, not in handlers. *Measured (Chrome 156):* DevTools docked, undocked, or opened first never made
  the attach refuse (#369; R20-DEVT-UNDOCK, R20-DEVT-EARLY).
- **`@types/chrome` quirks**: use `chrome.tabs.OnUpdatedInfo` (not `TabChangeInfo`);
  `InjectionResult<any>` (its `Awaited<T>` conflicts with TS's); `sendCommand` params want
  `{[k:string]:unknown}` (not `object`).
- **A character's ASCII code is its virtual key code only for `A-Z`, `0-9` and space.** In
  `keys.ts`, sending punctuation with `windowsVirtualKeyCode = charCodeAt(0)` makes Chrome act on the
  wrong key and *drop the character*: `"."` is 46, i.e. `VK_DELETE`, so trusted-typing `x@y.com`
  produced `x@ycom`. Punctuation uses OEM virtual keys — send `text` alone for it.
- **CDP `Input.*` coordinates need no scaling — but the point must be on screen.** `x`/`y` are CSS
  pixels of the layout viewport (what `getBoundingClientRect` gives). Measured at zoom 1.0/1.5 and
  DPR 1/1.25/1.5: `clientX,clientY` always came back identical to what was sent, so do **not** multiply
  by `chrome.tabs.getZoom()` or `devicePixelRatio`. What does bite: CDP never clamps, so a point past
  the viewport edge hit-tests the root element and the click **silently does nothing**. Page zoom
  shrinks the visual viewport in CSS px (150 % turns 1920x940 into 1280x630), which is how an element
  that fit at 100 % ends up off-screen. `centerForInput` scrolls first and throws if it still can't
  reach — keep that if you add a trusted hover/drag.
- **CDP `Runtime.evaluate.timeout` does not fire while the script is `await`ing** — an idle promise
  isn't "executing", so it only bounds *synchronous* code. `evaluateInPage` races the CDP call
  against its own timer (`raceTimeout`) and swallows the loser's rejection; detaching does **not**
  stop page-side work already in flight.
- **`describeDebuggerError(err, what)` / `withDebugger(tabId, fn, what)` take a caller name** —
  it's interpolated into the restricted-URL and timeout messages ("Trusted input" by default,
  `"browser_evaluate"`, `"Full-page screenshot"`).
- **The `saveTo` store is worker memory.** The value waits in `EvaluateSaveStore`
  (`extension/src/evaluate-save-store.ts`: 5 min TTL refreshed per pull, 8 entries, 256 MiB per value and in
  total), dropped at a worker restart, a disarm, JavaScript off, the tab's close or replace, or the TTL; a later
  pull answers `INTERNAL Unknown or expired evaluateSave id: <id>` and the SDK removes `.part` (S4.md §6 candidate
  2; unit + cross-package tests; Run 15 SAVE-TTL, SAVE-CLOSE, SAVE-DISARM, SAVE-JSOFF). The extension never sees the path; the SDK's file finish is in `sdk/CLAUDE.md`. An error thrown inside
  `withDebugger` reaches the wire prefixed `[chrome.debugger] ` (`describeDebuggerError`; Run 15 SAVE-REFUSE) unless
  it was passed to `markOwnRefusal` (`debugger-errors.ts`, a module-private WeakSet): since Step 11 S1 the `saveTo`
  value refusals and the in-session size cap are marked and pass through unchanged, while page errors, `TIMEOUT`,
  the save leg's `INTERNAL` failures and `keys.ts`'s unsupported-key refusal keep the prefix (`extension/test/
  s1-own-refusals.test.ts`; decisions.md · 2026-10-25 · Stage 0: S1 marks the bridge's own refusals explicitly; page
  errors and timeouts keep the prefix (#246)). A new refusal raised inside a session must be marked, or it is prefixed.
- **A module service worker must not use top-level `await`** — Chrome fails the worker with
  `TypeError: Top-level await is disallowed in service workers`, since the script must finish
  evaluating synchronously for its listeners to be known. The network log therefore ingests into
  memory from the first event and `network-state.ts` keeps a `ready` promise that `merge`s the
  rehydrated `storage.session` blob *underneath* the live entries (live wins); handlers `await ready`.
- **`chrome.webRequest` listeners must be registered at the top level of `sw.ts`**, synchronously —
  they must exist on every worker start or the events that woke it are lost. So must the
  `chrome.tabs.on{Created,Updated,Removed,Replaced}` listeners that feed Step 7's tab events (column 1 in
  `sw.ts`) and the opener join's `webNavigation` listener.
- **Cache hits skip `onHeadersReceived`** — `onCompleted` carries `statusCode`/`statusLine`/
  `responseHeaders`/`fromCache`, so the reducer fills status from `onCompleted` too. Same for an
  event whose `requestId` it has never seen (worker restarted mid-request): build the entry from the
  fields every event carries rather than dropping it.
- **`extraHeaders` is omitted from every `extraInfoSpec` on purpose** — without it Chrome never hands
  the extension `Cookie`/`Set-Cookie`, so cookies cannot enter the log at all (stronger than
  redacting). The price, verified live, is that `referer` and `origin` are missing too. Don't add it.
- **`storage.session` is emptied by an extension reload and by Chrome exiting**, and has a 10 MB
  quota — the flush is debounced, writes only `takeDirty()` tabs, and on a rejected `set` calls
  `evictOldest(0.5)` and retries once (writing the union of both dirty sets). The 25 s keepalive
  alarm rarely lets the worker idle out, so the write-through insures against a forced stop or a crash.
- **esbuild keeps comments placed inside array literals** in the bundle (S0.md §6 item 3): keep them out of literals
  where a bounded bundle diff is checked.

The session marker's 2 s bound and the handle retirement on a Chrome restart are in `daemon/CLAUDE.md`.

### Tabs, trusted input and capture

Editing `tabs.ts`' `targetTab` or `cdpCaptureRefusal`? Two gotchas that bind them are in `src/handlers/CLAUDE.md`
(every handler takes `tabId`; the CDP screenshot refusal).
- **Only `captureVisibleTab` needs the tab on screen** — the default (`switch`) viewport screenshot,
  the one call the daemon locks besides `focusTab` (`daemon/src/methods.ts`; the daemon's
  `selectTab` refusal is in `daemon/CLAUDE.md`). Everything
  else runs on a background tab by design; measured there: `waitFor {text}` and `networkIdle` work
  (Run 8 BG-4: text after 3746 ms, idle after 552 ms, the tab hidden throughout).
  Trusted input does not (next bullet); `fullPage` (CDP) on a hidden or minimized tab is unmeasured
  (T5b F9).
- **Trusted CDP input into a background tab answers `ok` and does nothing** (5–10 ms, nothing received; after
  `focusTab` it worked — Run 8 BG-1/BG-2). Chrome's anti-throttling flags do not change it (Run 10 BGF-1/2). Focus
  emulation (`trusted-input.ts`: `Emulation.setFocusEmulationEnabled` on → input → off, one session) does not fix it
  either: click 0/3, typing 2/3 with characters lost, key 0/3, control 0/12, the human's view unchanged 9/9 (Run 11
  FE-0…FE-5), and while it is on the target page reads `visible`, so a page-side visibility check proves nothing.
  Hence `"focusFirst"`: the SDK's and the MCP's trusted input call `focusTab` first (`sdk/CLAUDE.md`, `mcp/CLAUDE.md`).
  An untrusted action whose content path fails is escalated to CDP out of the SDK's sight, so it can still answer `ok`
  and do nothing on a background tab; pass `trusted` or `focus()` when it must land. A clipboard write in `evaluate`
  needs `focusTab` too (BG-3 `NotAllowedError … Document is not focused`). (Uploads differ: Run 16 UP-1, below.)
- **The switch sequence, and why it never focuses the window** (`tabs.ts: activateForCapture`, plan
  0.5): minimized → `WINDOW_MINIMIZED` before switching; reserve a capture slot (Chrome allows 2
  `captureVisibleTab` calls/s; 500 ms spacing, one quota retry); activate the target; wait for
  `onActivated` (≤ 1000 ms) + 50 ms; capture; restore the previous tab — only if the window still
  shows the target and no `focusTab` touched it. `captureVisibleTab` needs the window visible, not
  focused: a target in an unfocused second window captured with the foreground window unchanged (Run
  9 R9-SCREEN-5). `focusTab` is the only call that runs `windows.update({focused:true})` (T3.3 grep;
  its alias `selectTab` was removed in Step 8 S2b; the MCP's trusted tools call it since Step 10 S2 and add no
  focus of their own). Never add focus to the capture, and never lower the
  1000 ms or 50 ms waits without a measurement.
- **`onActivated` ends the capture wait; the human's tab is hidden ~1.5 s per switch capture.** Page-side
  `visibilitychange` on the human's tab: hidden +5–6 ms, visible again after a median 1493 ms (Run 8 SCREEN-1) and
  1557 ms (Run 9 R9-SCREEN-1). The differential row SW-2 (background-tab capture minus front-tab capture, one
  discarded warm-up — the first capture costs ~800 ms more) read d = −24, 95, 68 ms in 3/3, so the wait does not run
  to its 1000 ms bound (Run 16; decisions.md · 2026-10-26 · S5-liveA closes … (#282)); the waits stay as they are.
  Three concurrent captures serialised with no quota error (Run 8 SCREEN-3, Run 9 R9-SCREEN-3).
- **A capture of a tab in a fully covered (occluded) window hangs.** `captureVisibleTab` did not return
  and the call ended in `TIMEOUT` after 35 s (Run 8 SCREEN-5 first attempt); before T5b the target tab
  then stayed in front ≥ 49 s. Since T5b the chain bound restores the previous tab at 30 s: measured
  `TIMEOUT` at 35 119 ms, previous tab active again at +30 026 ms (Run 9 R9-RESTORE). A late restore
  can still spoil the next capture or undo a `focusTab` that lands in its last check (T5b verifier N1,
  residual race).
- **A Memory-Saver discard changes the tab id; `tabReplaced` keeps the handle.** On Chrome 156 an
  Urgent Discard from `chrome://discards` gave the tab a new id (1108126391 → 1108126396) and the
  handle followed through `tabReplaced` (Run 8 LEASE-6 (b); Stage 0 F7 had expected the id to stay).
  While discarded, a page call returns `INTERNAL: The tab was discarded by Chrome's Memory Saver …`
  (`assertNotDiscarded`); `focusTab` reloads it.

### Safety gate (Step 9)
- **Every router method passes the safety gate, and a new one cannot skip it.** `sw.ts` serves through
  `GatedRouter` only (`extension/src/router.ts`); `GatedRouter.on` throws for a name missing from
  `METHOD_CLASSES` (`extension/src/safety.ts`, no default class), and `safety-gate.test.ts` scans every
  `router.on("…")` in `sw.ts` against the table (S1.1, three mutants red; the scan is lexical — `router["on"]`
  escapes it, the throw does not; S1.md §6). A new extension method must enter both `METHOD_CLASSES` and
  `daemon/src/methods.ts`. Exempting or reclassifying a method to pass a row is a forbidden fix.
  (By construction + unit tests.)
- **The state lives in `storage.local`, is read per call, and fails closed.** Keys `safety.armed`,
  `safety.evaluate`, `safety.blockList`, `safety.uploadFolders` (`safety-state.ts` `SAFETY_KEYS`); missing keys = armed,
  JavaScript on, empty list, no upload folder; a failed read or a wrong-typed value refuses every call `DISARMED` (#139, #171). Never move
  it to `storage.session` (a reload would re-arm). A disarm held in memory wins over a read that still says
  armed (#176); a disarm whose write fails twice stays disarmed in memory, returns `"write-failed"` and
  lasts until the worker restarts, which reads storage again — armed (#174; S2b report §6 item 6); a
  rejected re-arm write returns memory to disarmed (S2c, #190). Measured cost of the per-call read:
  snapshot round trip median 3.6 → 5.3 ms (Run 13 SAFE-PERF; #139's Revisit-if not met).
- **Nothing on the wire changes the state.** Only `action.onClicked` (`sw.ts`, the button and the
  `_execute_action` shortcut — there is deliberately no `commands.onCommand`, #142) and the options page
  write it (`safety-writers.test.ts`; `storage.local.remove`/`clear` refused everywhere, #188). The
  `action.onClicked` and both `storage.onChanged` listeners are registered at the top level of `sw.ts`
  with no top-level `await`; `storage.local.setAccessLevel({TRUSTED_CONTEXTS})` runs at module scope after
  every listener, guarded, not awaited (#139). The offscreen document acts only on this extension's
  non-tab senders (`relay-sender.ts`, #173). Adding a wire, daemon or SDK method that arms, disarms, edits
  the list or enables JavaScript is a forbidden fix. (By construction + unit tests; ACL-1 not measured.)
- **The matcher matches only at a dot boundary** — `host === p || host.endsWith("." + p)`
  (`safety-match.ts` `patternMatches`); never substring or dot-less `endsWith` (a forbidden fix). The
  50-case table of stage0-audit.md §5 is `extension/test/safety-match.test.ts`. (Unit tests.)
- **`navigate`/`newTab` are gated on the URL Chrome will open**, so a relative URL that resolves to this
  extension's `options.html` is refused, not just `chrome-extension://…` written out (S2a round-1
  CRITICAL, #175; measured in Run 13 SAFE-REL-1, PASS). `view-source:` of a relative own-page path
  answered `ok` (SAFE-REL-3 `rel`, recorded) — it resolves against the page's origin, not the extension
  (`wrapper=view-source inner=http own=no`, Run 14 R14-REL-3; #196 answered); every later call on such a tab is
  refused.
- **Chrome refuses a `javascript:` navigation through the bridge itself**: `NAV_FAILED JavaScript URLs are
  not allowed in API based extension navigations. …`, page unchanged (Run 13 SAFE-6c, JavaScript on,
  record). With JavaScript off the gate refuses first (Run 13: `DISARMED`, scope `evaluate`, SAFE-6; since Step 10
  S4b `JS_DISABLED` with no `data`, measured live in Run 15 JSD; #202, #219).
- **Redirect hops, the DNR rule builder and `file:` pages** (Step 11b): in `src/CLAUDE.md`, which loads with any file under `src/`.
- **Never log a pattern, URL or title from the safety code.** Nor a URL from anywhere else in the service worker: URLs
  carry tokens, the network code prints counts only (`[bridge] network: rehydrated N entries`), and the same rule holds for
  header values and bodies. The gate, matcher and state modules have no
  log call; a press logs one fixed line (`badge.ts` `toggleLogLine`); the daemon logs booleans and the
  count (`intercept.ts` `safetyLogLine`). `log-scan.test.ts` allowlists every log site (counts pinned per package) and `log-sentinel.test.ts` runs the real daemon on port 0 (#187). Run 13 SAFE-10:
  the daemon log and the worker console held no token, non-fixture `://` or test pattern.
- **The disarm reaches running work fast, Chrome's banner does not.** A running trusted `type` ended `DISARMED`
  5–14 ms after the press; the "is debugging this browser" banner lingered 3–14 s (Run 13 SAFE-4 (b)) and was gone
  between +4.7 and +5.0 s in Run 14 R14-4b, the session detached (#210). A running `waitFor` was refused 54–92 ms
  after the press. A banner seen in a row's sampling window may therefore be an earlier attach's (Run 16 UP-6, #284).
- **An options page follows a `storage.onChanged` change only while visible**: in a covered background window it
  did not show a re-arm until brought to the front (Run 13 SAFE-3); visible beside the driver it showed `Bridge
  armed.` 31 ms after (Run 15 R15-3R, #224); a second options window took 6061 ms in Run 16 UP-OPT (FAIL, cause
  unknown, #285). After a `write-failed` disarm the page shows the stored state while the badge says OFF (S2b
  verifier F4, by construction): the badge is the indicator.
