import { GatedRouter } from "./router.js";
import { navigate } from "./handlers/navigate.js";
import { snapshot, screenshot } from "./handlers/perceive.js";
import { click, type as typeText, scroll, hover, selectOption, pressKey } from "./handlers/actions.js";
import { back, forward } from "./handlers/history.js";
import { listTabs, focusTab, newTab, closeTab } from "./handlers/tabs.js";
import { waitFor } from "./handlers/wait.js";
import { evaluate } from "./handlers/evaluate.js";
import { locate } from "./handlers/locate.js";
import { networkRequests, networkClear } from "./handlers/network.js";
import { downloadStart, downloadChunk, downloadEnd, clearDownloads } from "./handlers/download.js";
import { evaluateSaveStart, evaluateSaveChunk, evaluateSaveEnd, clearEvaluateSaves, dropEvaluateSavesForTab } from "./handlers/evaluate-save.js";
import { uploadFiles } from "./handlers/upload.js";
import { consoleMessages } from "./handlers/console.js";
import { armedFromUnknown, consoleArmFloor, consoleCollectors } from "./console-messages.js";
import { javaScriptOff } from "./evaluate-save-store.js";
import { log as networkLog, ownPort, scheduleFlush, setOwnPort } from "./network-state.js";
import { isOwnTraffic } from "./network-log.js";
import type { WebRequestDetails, WebRequestEvent } from "./network-log.js";
import { TabInfoCache, eventFrame, joinedTabCreated, tabCreatedParams, tabRemovedParams, tabReplacedParams } from "./tab-events.js";
import { OpenerJoin } from "./opener-join.js";
import { MARKER_KEY, SessionMarker, type MarkerStore } from "./session-marker.js";
import { DISARMED_ALL, SafetyReporter, SafetyStore, failClosedView, readStoredArmed, rebuildsRules, reportOf, touchesSafety, type SafetyView } from "./safety-state.js";
import { CallSafety, acceptRelaySender, type CallSafetyDeps } from "./safety-call.js";
import { DnrKeeper, type DnrUpdate } from "./safety-dnr-keeper.js";
import { NetworkIngestGate } from "./safety-network.js";
import { BlockedHopWatcher } from "./safety-hop.js";
import { redactTabCreated, redactTabRemoved } from "./safety.js";
import { debuggerSessions, keepSessions } from "./debugger.js";
import { keptTabRefusal, pageChanged } from "./debugger-keeper.js";
import { BadgeController } from "./badge.js";
import { NATIVE_HOST_NAME, PAIR_REQUEST, PairBackoff, pairLogLine, pairOnce, type PairDeps } from "./pairing.js";

const DEFAULT_PORT = 9234;

// --- The safety state (Step 9, Phase E) ----------------------------------------------------------
// The human's kill switch, JavaScript switch and block list live in `storage.local` (`safety-state.ts`).
// Every router call reads them afresh and fails closed (#139); the memory copy serves the synchronous
// webRequest ingest only. A transition to disarmed detaches every debugger session, refuses new ones and
// drops every held download (#137). Only the worker's own listeners and the options page change the state:
// nothing the router serves can reach `safety.toggle()` (S2b's `action.onClicked` will call it).

const tabInfo = new TabInfoCache();

// Step 11b S3a (#292, #296, #301): the block list as session rules while a covered call runs (`safety-dnr-keeper.ts`).
// The API and the caps are read at call time: a missing API rejects inside the keeper, which fails closed. The
// start-up clear runs behind `ready` (installs queue after it); no top-level `await`. S3b adds the download half: its
// blocked hop is recognised from `onErrorOccurred` (`safety-hop.ts`), read in the existing listener before `ingest`.
const dnr = () => chrome.declarativeNetRequest;
const dnrKeeper = new DnrKeeper({
  updateSessionRules: async (u: DnrUpdate) => dnr().updateSessionRules(u as chrome.declarativeNetRequest.UpdateRuleOptions),
  getSessionRules: async () => dnr().getSessionRules(),
  caps: () => ({ sessionRules: dnr()?.MAX_NUMBER_OF_SESSION_RULES ?? 0, regexRules: dnr()?.MAX_NUMBER_OF_REGEX_RULES ?? 0 }),
  extensionId: chrome.runtime.id,
});
const hopWatcher = new BlockedHopWatcher(chrome.runtime.id);

const safety = new SafetyStore({
  get: (keys) => chrome.storage.local.get([...keys]),
  set: (items) => chrome.storage.local.set(items),
  extensionId: chrome.runtime.id,
  now: Date.now,
  onDisarm: () => {
    void debuggerSessions.detachAll(DISARMED_ALL, (tabId) => chrome.debugger.detach({ tabId }));
    clearDownloads();
    clearEvaluateSaves(); // Step 10 S4 (#205): every held saveTo value goes at a disarm
    void dnrKeeper.sweep(); // Step 11b (#296): only rules no live call owns; a running call keeps its own
  },
  onArm: () => {
    debuggerSessions.refuse(null);
    consoleArmFloor.armed(); // Step 12 S3a (#333): console entries before the latest arm are dropped
  },
});

const callDeps: CallSafetyDeps = {
  readState: () => safety.read(),
  getTab: (tabId) => chrome.tabs.get(tabId),
  replacedBy: (tabId) => tabInfo.replacedBy(tabId),
  lastUrl: (tabId) => tabInfo.lastUrl(tabId),
  watchHops: (list) => hopWatcher.open(list),
  dnrForTab: (tabId) => dnrKeeper.call("navigate", { tabId }), // Step 11b S6 (#312): newTab's blank tab
};

// Step 12 S4b (#324, #335, #347): one kept debugger session per tab, in `debuggerSessions` (the disarm above detaches
// it), dropped by the existing tab and storage listeners below and by `onDetach`. The start-up sweep detaches every
// attached tab target a stopped worker left (m2 D4c); calls wait for it. Not awaited: no top-level `await`.
const keeper = keepSessions((tabId) => keptTabRefusal(callDeps, tabId));
void keeper.sweep();

const router = new GatedRouter((method, params) => new CallSafety(method, params, callDeps, dnrKeeper.call(method, params)));
router.on("navigate", navigate);
router.on("snapshot", snapshot);
router.on("screenshot", screenshot);
router.on("click", click);
router.on("type", typeText);
router.on("scroll", scroll);
router.on("hover", hover);
router.on("selectOption", selectOption);
router.on("pressKey", pressKey);
router.on("back", back);
router.on("forward", forward);
router.on("listTabs", listTabs);
router.on("focusTab", focusTab);
router.on("newTab", newTab);
router.on("closeTab", closeTab);
router.on("waitFor", waitFor);
router.on("evaluate", evaluate);
router.on("locate", locate);
router.on("networkRequests", networkRequests);
router.on("networkClear", networkClear);
router.on("downloadStart", downloadStart);
router.on("downloadChunk", downloadChunk);
router.on("downloadEnd", downloadEnd);
// Step 10 S4 (#205): `browser_evaluate {saveTo}` — class "evaluate" in the safety table, tab methods in the daemon's.
router.on("evaluateSaveStart", evaluateSaveStart);
router.on("evaluateSaveChunk", evaluateSaveChunk);
router.on("evaluateSaveEnd", evaluateSaveEnd);
// Step 11 (#256, S3): `uploadFiles` — class "upload" in the safety table (the folder rule on every path, so the handler
// is never reached with a refused path), a tab method in the daemon's, no lock.
router.on("uploadFiles", uploadFiles);
// Step 12 S3a (#333, #334): `consoleMessages` — class "evaluate" in the safety table, a tab method in the daemon's, no lock.
router.on("consoleMessages", consoleMessages);

// --- Network capture -------------------------------------------------------------------------
// MV3 requires every webRequest listener to be registered synchronously while the worker script
// evaluates (a module SW cannot use top-level `await`), so these live at the top level and ingest
// into the in-memory log from the first event. `network-state.ts` merges the stored log in
// underneath once its rehydrate promise resolves. `extraHeaders` is deliberately absent from every
// extraInfoSpec, so Chrome never hands us Cookie / Set-Cookie.
// Step 9: every event passes the ingest gate (`safety-network.ts`) — dropped while disarmed and for blocked
// hosts, held until the stored state is first known (phase doc 0.4's F9 note).

const ALL_URLS = { urls: ["<all_urls>"] };

const ingestGate = new NetworkIngestGate({
  ingest: (event, d) => {
    networkLog.ingest(event, d);
    scheduleFlush();
  },
  discard: (requestId) => {
    if (networkLog.discard(requestId) > 0) scheduleFlush();
  },
  tabUrl: (tabId) => tabInfo.lastUrl(tabId),
  view: () => safety.ingestView(),
});

function ingest(event: WebRequestEvent, d: WebRequestDetails): void {
  if (isOwnTraffic(d.url, ownPort())) return;
  ingestGate.offer(event, d);
}

chrome.webRequest.onBeforeRequest.addListener(
  (d) => void ingest("onBeforeRequest", d as unknown as WebRequestDetails),
  ALL_URLS,
  ["requestBody"],
);
chrome.webRequest.onSendHeaders.addListener(
  (d) => void ingest("onSendHeaders", d as unknown as WebRequestDetails),
  ALL_URLS,
  ["requestHeaders"],
);
chrome.webRequest.onHeadersReceived.addListener(
  (d) => void ingest("onHeadersReceived", d as unknown as WebRequestDetails),
  ALL_URLS,
  ["responseHeaders"],
);
chrome.webRequest.onBeforeRedirect.addListener(
  (d) => void ingest("onBeforeRedirect", d as unknown as WebRequestDetails),
  ALL_URLS,
  ["responseHeaders"],
);
chrome.webRequest.onCompleted.addListener(
  (d) => void ingest("onCompleted", d as unknown as WebRequestDetails),
  ALL_URLS,
  ["responseHeaders"],
);
chrome.webRequest.onErrorOccurred.addListener(
  (d) => {
    hopWatcher.offer(d); // Step 11b S3b (#296): before `ingest`, which drops blocked hosts; keeps no URL
    void ingest("onErrorOccurred", d as unknown as WebRequestDetails);
  },
  ALL_URLS,
);

chrome.tabs.onRemoved.addListener((tabId) => {
  networkLog.forgetTab(tabId);
  dropEvaluateSavesForTab(tabId); // Step 10 S4 (#205): a closed tab's held saveTo values go
  void keeper.tabGone(tabId); // Step 12 S4b: its kept debugger session goes
  scheduleFlush();
});

// --- Tab lifecycle events → the daemon (spec §6.2, §10) -------------------------------------------
// Registered at the top level, synchronously, like the webRequest observers: the event that woke the
// worker must find its listener. Each event goes out through the offscreen document's existing
// "send" relay as an id-less `{event, params}` frame. If no socket is open the frame is dropped
// (Stage 0 F15 gives the daemon a `listTabs` resync on reconnect for that; T2's side). Nothing here is logged: the cache
// holds URLs and titles, which go on the wire only.
// Step 9 (#134): `tabCreated.url` is "" and `tabRemoved` carries `hidden` instead of `lastUrl`/`lastTitle`
// while disarmed or for a blocked tab (this extension's own pages included). The state is read per event
// (a read that fails redacts as disarmed); the frames go out in order through one chain.

function sendEvent(frame: string): void {
  chrome.runtime.sendMessage({ target: "offscreen", type: "send", data: frame }).catch(() => {});
}

let eventChain: Promise<void> = Promise.resolve();

/** Sends a tab event built under a fresh read of the state, after every earlier one. */
function sendTabEvent(build: (view: SafetyView) => string): void {
  eventChain = eventChain
    .then(async () => {
      let view: SafetyView;
      try {
        view = await safety.read();
      } catch {
        view = failClosedView(chrome.runtime.id);
      }
      sendEvent(build(view));
    })
    .catch(() => {});
}

// Step 13 S1 (G1, #385; spec §10 Note 2026-10-29): a `tabCreated` with Chrome's `openerTabId` waits (≤ 250 ms) for
// its `webNavigation.onCreatedNavigationTarget`, then goes out with `openerTabId` = the source tab, or with none.
// The join sees tab ids only; a removed or replaced tab releases its held `tabCreated` before its own event.
const releaseCreated = new Map<number, (openerTabId: number | undefined) => void>();
const openerJoin = new OpenerJoin((tabId, openerTabId) => {
  const release = releaseCreated.get(tabId);
  releaseCreated.delete(tabId);
  release?.(openerTabId);
});

chrome.tabs.onCreated.addListener((created) => {
  const params = tabCreatedParams(created);
  if (!params) return;
  tabInfo.update(params.tabId, {}, created);
  const urls = [created.url, created.pendingUrl];
  releaseCreated.set(params.tabId, (opener) =>
    sendTabEvent((v) => eventFrame("tabCreated", redactTabCreated(joinedTabCreated(params, opener), v.switches, v.ctx, urls))),
  );
  openerJoin.created(params.tabId, created.openerTabId);
});
// Only the two ids are read; the event's address is never kept or logged.
chrome.webNavigation.onCreatedNavigationTarget.addListener((d) => openerJoin.navigationTarget(d.tabId, d.sourceTabId));
chrome.tabs.onUpdated.addListener((tabId, change, updated) => {
  tabInfo.update(tabId, change, updated);
  if (pageChanged(change)) void keeper.recheckTab(tabId); // Step 12 S4b: blocked, own or file: now → detach
});
chrome.tabs.onRemoved.addListener((tabId) => {
  openerJoin.gone(tabId); // Step 13 S1: a held tabCreated goes out first
  // `retire`, not `take`: the last URL stays known for the length of a call (Stage 0 R2-1).
  const params = tabRemovedParams(tabId, tabInfo.retire(tabId));
  sendTabEvent((v) => eventFrame("tabRemoved", redactTabRemoved(params, v.switches, v.ctx)));
});
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  dropEvaluateSavesForTab(removedTabId); // Step 10 S4 (#205): the old id is gone; its held values go
  void keeper.tabGone(removedTabId); // Step 12 S4b
  openerJoin.gone(removedTabId); // Step 13 S1: a held tabCreated goes out first
  tabInfo.noteReplaced(removedTabId, addedTabId);
  tabInfo.move(removedTabId, addedTabId);
  const frame = eventFrame("tabReplaced", tabReplacedParams(addedTabId, removedTabId));
  sendTabEvent(() => frame);
});

// Refill the cache after a worker restart (Stage 0 F16). Not awaited: no top-level `await` here.
chrome.tabs.query({}).then((all) => tabInfo.fill(all)).catch(() => {});

// --- The session marker (Step 8 S2b.5; decisions.md · 2026-10-23 · #74, amended by #80) ----------------
// Same across worker restarts and extension reloads, new when Chrome restarts; sent in the hello so the
// daemon retires every handle after a Chrome restart. The onStartup/onInstalled listeners below are
// registered synchronously at the top level and only record the event, so an event that fires before
// connect() awaits the marker is not lost. Never logged.

function stored(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

const markerStore: MarkerStore = {
  getSession: async () => stored((await chrome.storage.session.get(MARKER_KEY))[MARKER_KEY]),
  getLocal: async () => stored((await chrome.storage.local.get(MARKER_KEY))[MARKER_KEY]),
  setBoth: async (marker) => {
    await Promise.all([chrome.storage.session.set({ [MARKER_KEY]: marker }), chrome.storage.local.set({ [MARKER_KEY]: marker })]);
  },
};

const sessionMarker = new SessionMarker({
  store: markerStore,
  random: () => crypto.randomUUID(),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onRotate: () => void connect(),
});

// --- Pairing (Step 15 S4, #449) -------------------------------------------------------------------------
// Only connect() asks, and only while no token is stored; the back-off is worker memory, so a worker start tries at
// once. The write is `{token, port}` only, after a fresh re-read finds the token still empty (`pairing.ts`).
const pairBackoff = new PairBackoff(Date.now);
const pairDeps: PairDeps = {
  ask: () => chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, PAIR_REQUEST),
  readToken: async () => (await chrome.storage.local.get(["token"])).token,
  write: async ({ token, port }) => chrome.storage.local.set({ token, port }),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

let connecting = false;
/** A connect() asked for while one was running (e.g. a marker rotation): run once more after it. */
let connectAgain = false;

async function getConfig(): Promise<{ port: number; token: string }> {
  const { port, token } = await chrome.storage.local.get(["port", "token"]);
  const resolved = Number(port) || DEFAULT_PORT;
  setOwnPort(resolved); // so isOwnTraffic can drop the bridge's own loopback socket
  return { port: resolved, token: String(token ?? "") };
}

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Maintain a persistent WebSocket to the local MCP bridge server.",
  });
}

async function connect(): Promise<void> {
  if (connecting) {
    connectAgain = true;
    return;
  }
  connecting = true;
  try {
    const { port, token } = await getConfig();
    if (!token) {
      // Step 15 S4 (#449): ask the local install's native host; a write fires storage.onChanged, which connects.
      const pairLine = pairLogLine(await pairOnce(pairDeps, pairBackoff));
      if (pairLine) console.log(pairLine);
      else console.warn("[bridge] no token set — open the extension options page to configure.");
      return;
    }
    // Waits at most 2 s, and only on a worker start without a stored marker (S2b.5).
    const session = await sessionMarker.current();
    await ensureOffscreen();
    await chrome.runtime.sendMessage({ target: "offscreen", type: "connect", port, token, session });
  } catch (err) {
    console.error("[bridge] connect failed:", err);
  } finally {
    connecting = false;
    if (connectAgain) {
      connectAgain = false;
      void connect();
    }
  }
}

// --- The safetyState event (Step 9; decisions.md · 2026-10-24 · #132; S3's handoff) ----------------------
// `{armed, evaluate, blockedCount}` — never a pattern, never in the hello — each time the connection comes
// up and on every change. Reads are chained so an older state is never sent after a newer one. A state
// that cannot be read is not reported (the daemon keeps "not reported").

const reporter = new SafetyReporter();
let reportChain: Promise<void> = Promise.resolve();

function reportSafety(): void {
  reportChain = reportChain
    .then(async () => {
      const frame = reporter.offer(reportOf(await safety.read()));
      if (frame) sendEvent(frame);
    })
    .catch(() => {});
}

const OFFSCREEN_URL = chrome.runtime.getURL("offscreen.html");

// Messages relayed from the offscreen document. Step 9 (#139, F19, V6): only the offscreen document itself
// (its URL, not a tab showing it) may hand the router a request; anything else is dropped without a log line.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.target !== "sw") return;
  if (!acceptRelaySender(sender, OFFSCREEN_URL)) return;
  if (msg.type === "ws-message") {
    router.handle(msg.data)
      .then((reply) => {
        if (reply) chrome.runtime.sendMessage({ target: "offscreen", type: "send", data: reply }).catch((e) => console.warn("[bridge] reply relay failed:", e));
      })
      .catch(() => {});
  } else if (msg.type === "ws-status") {
    if (msg.connected) {
      console.log("[bridge] connection: up");
      reporter.connectionUp();
      reportSafety();
    } else {
      console.error("[bridge] connection: down");
      reporter.connectionDown();
    }
  }
});

// Diagnostic only: explains a mid-action trusted-input failure in the SW console when the user
// clicks the debugging banner's Cancel (reason "canceled_by_user") or DevTools takes the tab over.
chrome.debugger.onDetach.addListener((source, reason) => {
  console.warn("[bridge] debugger detached, tabId", source.tabId, "reason:", reason);
  // Step 12 S4b: any reason (the human's Cancel, DevTools, a closed target) ends the kept session; never logged wider
  if (typeof source.tabId === "number") keeper.onDetach(source.tabId, reason);
});

// Step 12 S3a (#333): the one top-level CDP event listener; it feeds `consoleMessages`' per-call collectors only.
chrome.debugger.onEvent.addListener((source, method, params) => consoleCollectors.feed(source, method, params));

chrome.runtime.onInstalled.addListener((details) => {
  sessionMarker.installed(details?.reason);
  void connect();
});
chrome.runtime.onStartup.addListener(() => {
  sessionMarker.startup();
  void connect();
});

chrome.alarms.get("keepalive", (existing) => {
  if (!existing) chrome.alarms.create("keepalive", { periodInMinutes: 0.41 }); // ~25s
});
chrome.alarms.onAlarm.addListener((alarm) => {
  // connect() is idempotent (offscreen ignores a redundant same-endpoint connect),
  // so this just ensures the offscreen doc + socket are alive without churn.
  if (alarm.name === "keepalive") void connect();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.token || changes.port)) void connect();
  // Step 9: the options page (or the toggle) changed the safety state: update the memory copy (and run the
  // disarm actions on a disarm), decide held network events, report the new state.
  if (area === "local" && touchesSafety(changes)) {
    const before = safety.memory;
    safety.applyChanges(changes);
    // Step 12 S3a (M-2): an arm from an unknown state (a failed first load) moves the console floor too; onArm sees
    // only disarmed → armed.
    if (armedFromUnknown(before, safety.memory)) consoleArmFloor.armed();
    // Step 10 S4 (#205): JavaScript off (or a state that fails closed) drops every held saveTo value; a disarm
    // drops them in onDisarm.
    if (javaScriptOff(safety.memory)) clearEvaluateSaves();
    // Step 11b S3a (#292), narrowed by S3b (#302): a block-list edit, or a state now unreadable, rebuilds every live
    // call's rules from a fresh read; unreadable → null. The key names stay in safety-state.ts (sw-static's scan).
    if (rebuildsRules(changes, safety.memory)) void safety.read().then((v) => dnrKeeper.rebuild(v.ctx.blockList), () => dnrKeeper.rebuild(null));
    // Step 12 S4b (F4): a change that blocks a kept tab (the block list, the switches, an unreadable state) detaches it
    void keeper.recheckAll();
    ingestGate.flush();
    reportSafety();
  }
});

// Step 9: load the memory copy once (the `ready` every gated read awaits), then decide the network events
// held meanwhile. Not awaited: no top-level `await` here.
void safety.start().then(() => ingestGate.flush());
void dnrKeeper.ready; // Step 11b: every session rule left by an earlier worker goes before the first install

void connect();

// --- The toolbar button, the shortcut and the badge (Step 9 S2b) ------------------------------------------
// One top-level `action.onClicked` listener serves the button and the `_execute_action` shortcut (Chrome
// dispatches that command as `action.onClicked`; there is no `commands.onCommand`) (decisions.md ·
// 2026-10-24 · The shortcut is `_execute_action` (#142)). It is the only caller of `safety.toggle()`; nothing
// the router serves reaches it. Each press logs one fixed line (`badge.ts`, phase doc 0.7). The badge is
// re-derived from a fresh read at every worker start and on every safety-key change (F42, #144); not
// awaited — no top-level `await`.

const badge = new BadgeController({
  api: chrome.action,
  read: () => safety.read().then((v) => v.switches),
  // F5 (S2b verifier): the stored switch, unmasked by a disarm held in memory, so a "not saved" title ends
  // once the OFF is saved. A wrong-typed value throws → unknown (the note stays; the badge is OFF anyway).
  storedArmed: () => readStoredArmed((keys) => chrome.storage.local.get([...keys])),
});

chrome.action.onClicked.addListener(() => void badge.press(() => safety.toggle()));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && touchesSafety(changes)) void badge.refresh();
});

void badge.refresh();

// Step 9 (#139, F4, V7): content scripts must not read or write `storage.local` (the token and the safety
// state live there). After every listener registration, guarded so it cannot throw synchronously, not awaited.
try {
  void chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" as chrome.storage.AccessLevel })?.catch?.(() => {});
} catch {
  // a missing or failing setAccessLevel leaves nothing to undo
}
