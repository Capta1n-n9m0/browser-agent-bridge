// Step 7 T2 — the daemon's tab layer (phase doc T2; spec §6, §10; decisions.md #39–#44, #52–#54).
// Step 8 S2b removed the Step 6 compatibility path (#41, #54, #81, #85): every tab call names its tab;
// an extension hello with a changed session marker retires every handle (#74, #80).
//
// Every client request that is not `daemon.*` passes through `TabLayer.request` (via `route.ts`):
// handles are resolved to Chrome tab ids, leases are checked (fail fast), the visibility lock is taken
// for screen-needing methods, and the call is forwarded with a numeric `tabId` and never a `tab` key.
// Extension events keep the handle table current; a client's disconnect drops its leases and its hold
// on the lock.
//
// Logging: only handles, client names and counts — never a URL, title, header value, body or token.
import {
  BridgeError,
  ErrorCodes,
  FEATURE_EVALUATE_ARGS,
  FEATURE_UPLOAD_CHOOSER,
  isEvent,
  isSafetyStateEvent,
  isTabCreatedEvent,
  isTabRemovedEvent,
  isTabReplacedEvent,
  type DaemonStatusSafety,
  type EventMessage,
  type LeaseGrantedParams,
  type SafetyState,
  type SafetyStatusParams,
  type TabCreatedParams,
  type TabGoneParams,
} from "@bridge/shared";
import type { Bridge } from "./bridge.js";
import type { ExtensionConnection } from "./connection.js";
import { HandleTable, type HandleNumbers } from "./handles.js";
import { LeaseTable } from "./leases.js";
import { VisibilityLock } from "./lock.js";
import { classify, takesLock, trustedFocus, NETWORK_METHODS, REMOVED_METHODS, TRUSTED_SETTLE_MS } from "./methods.js";
import { DAEMON_SLACK_MS, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS } from "./route.js";

export const RELOAD_HINT =
  "the Chrome extension is an older build — reload it at chrome://extensions (↻ on Browser Agent Bridge)";
/** Step 12 S2b (#332): `args` sent to an extension whose hello did not list `"evaluateArgs"`. */
export const ARGS_RELOAD_HINT =
  "the Chrome extension is an older build without evaluate args — reload it at chrome://extensions (↻ on Browser Agent Bridge)";
/** Step 12 S5c (#355): `uploadFiles` `chooser` sent to an extension whose hello did not list `"uploadChooser"`. */
export const CHOOSER_RELOAD_HINT =
  "the Chrome extension is an older build without the file chooser upload — reload it at chrome://extensions (↻ on Browser Agent Bridge)";
export const NO_HUMAN_TAB =
  "No normal Chrome window is focused (a DevTools or popup window may have focus) — click a normal Chrome window and retry";

/** The client a request came from. */
export interface Caller {
  clientId: string;
  name: string;
}

export interface TabLayerDeps {
  bridge: Bridge;
  /** A connected client's name; undefined once it is gone. */
  nameOf: (clientId: string) => string | undefined;
  /** Send an event frame to one client (dropped if it is gone). */
  sendTo: (clientId: string, frame: EventMessage<object>) => void;
  log?: (msg: string) => void;
  now?: () => number;
  /** The wait between url-fill polls (T5b fix 3). Default: `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Where handle numbers come from (S2b.9, #79). Default: T1, T2, … per instance. */
  handleNumbers?: HandleNumbers;
  /**
   * Send an event frame to every connected client (Step 9: `safetyStatus`, #132). Default: none (a
   * `TabLayer` built without a host relays nothing).
   */
  broadcast?: (frame: EventMessage<object>) => void;
}

/** The daemon log's line for a safety state: booleans and the count only (phase doc 0.7; #132). */
export function safetyLogLine(s: SafetyState): string {
  return `safety state: armed=${s.armed} evaluate=${s.evaluate} blocked=${s.blockedCount}`;
}

function sameSafety(a: SafetyState | null, b: SafetyState): boolean {
  return a !== null && a.armed === b.armed && a.evaluate === b.evaluate && a.blockedCount === b.blockedCount;
}

export interface StatusTab {
  tab: string;
  tabId: number;
  owner?: string;
  url?: string;
}

interface ListedTab {
  id: number;
  url?: unknown;
  title?: unknown;
  current?: unknown;
  [k: string]: unknown;
}

type Params = Record<string, unknown>;

/** An opener grant waiting for its `leaseGranted` event. `url` may be filled in later (T5b fix 3). */
interface Grant {
  handle: string;
  clientId: string;
  url: string;
}

/** T5b fix 3: how often, and for how long after `tabCreated`, the daemon polls a popup's url. */
export const URL_FILL_POLL_MS = 100;
export const URL_FILL_MAX_MS = 2000;
/** One url-fill `listTabs` call's timeout. */
const URL_FILL_CALL_MS = 1000;

/** A url worth reporting: Chrome's `tabs.onCreated` gives a popup `""` or `about:blank` first. */
function urlKnown(url: string): boolean {
  return url !== "" && url !== "about:blank";
}

function clampTimeout(timeoutMs: number | undefined): number {
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, timeoutMs ?? DEFAULT_TIMEOUT_MS));
}

function hhmmss(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(11, 19);
}

function without(params: Params | undefined, ...keys: string[]): Params {
  const out: Params = { ...(params ?? {}) };
  for (const k of keys) delete out[k];
  return out;
}

const bad = (message: string) => new BridgeError(ErrorCodes.BAD_PARAMS, message);

export class TabLayer {
  readonly handles: HandleTable;
  readonly leases = new LeaseTable();
  readonly lock: VisibilityLock;
  private readonly now: () => number;
  /** Extension connections whose hello carried `proto` ≥ 2 (#42). */
  private readonly protoConnections = new WeakSet<ExtensionConnection>();
  /** Step 12 S2b (#332): extension connections whose hello listed `"evaluateArgs"`. */
  private readonly argsConnections = new WeakSet<ExtensionConnection>();
  /** Step 12 S5c (#355): extension connections whose hello listed `"uploadChooser"`. */
  private readonly chooserConnections = new WeakSet<ExtensionConnection>();
  /**
   * The session marker of the last extension hello (S2b.5, #74 as amended by #80): a string, `null` for
   * a hello without one ("none" is a value), `undefined` before the first hello of this daemon's life.
   */
  private lastSession: string | null | undefined = undefined;
  /**
   * In-flight `newTab` calls (F20). While any is in flight, an opener grant is made at once (so the
   * tab is never unheld) but its `leaseGranted` is held back until they settle: a `newTab` that
   * turns out to have created the tab overrides the lease, and the held-back event is dropped.
   */
  private newTabsInFlight = 0;
  private heldBackGrants: Grant[] = [];
  private readonly sleep: (ms: number) => Promise<void>;
  /** tabId → client closing it (no `tabGone` to the closer). */
  private readonly closing = new Map<number, string>();
  /**
   * Step 9 (#132): the safety state the current extension socket last reported — `null` until it reports,
   * and again from the moment that socket closes or another extension says hello. `daemon.status.safety`.
   */
  private safety: SafetyState | null = null;
  /**
   * The last safety state received in this daemon's life, kept across extension sockets: the redaction of
   * #134 applies while it says disarmed (null: never reported, nothing redacted). An extension that comes
   * back reports again at once, and its report replaces this.
   */
  private lastReceived: SafetyState | null = null;
  /**
   * S3 fixer r1 (verifier finding 5): bumped on every safety-state change. A `listTabs` reply is recorded
   * against the value taken when its request was sent; a reply requested before the latest change (it may
   * arrive after the change's own refresh) still mints handles and clears "blocked" rows, but notes no
   * url/title, so it cannot put back a url the refresh just cleared.
   */
  private safetyGen = 0;

  constructor(private readonly deps: TabLayerDeps) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.handles = new HandleTable({ now: this.now, numbers: deps.handleNumbers });
    this.lock = new VisibilityLock({ nameOf: (id) => this.name(id), now: this.now });
  }

  private name(clientId: string): string {
    return this.deps.nameOf(clientId) ?? clientId;
  }

  private isProto(): boolean {
    const conn = this.deps.bridge.currentConnection();
    return conn !== null && this.protoConnections.has(conn);
  }

  // ------------------------------------------------------------------ extension side

  /**
   * A new extension socket said hello. A changed session marker first retires every handle, synchronously
   * (S2b.5); then a proto:2 hello gets the F15 resync, which mints anew.
   */
  extensionConnected(conn: ExtensionConnection, proto: boolean, session?: string, features: readonly string[] = []): void {
    if (features.includes(FEATURE_EVALUATE_ARGS)) this.argsConnections.add(conn);
    if (features.includes(FEATURE_UPLOAD_CHOOSER)) this.chooserConnections.add(conn);
    const current = session ?? null;
    const previous = this.lastSession;
    this.lastSession = current;
    this.safety = null; // this socket has not reported yet (#132); `lastReceived` keeps redacting

    // The first hello of the daemon's life retires nothing (today's resync). After that any change of
    // value retires: A→B (Chrome restarted), A→none, and none→A.
    if (previous !== undefined && previous !== current) this.retireAll();
    if (!proto) return;
    this.protoConnections.add(conn);
    void this.resync(conn);
  }

  /**
   * The extension's session changed (Chrome restarted, so its tab ids may be reused): every live handle
   * goes gone with its pre-restart url/title, each holder gets `tabGone` once, every lease is dropped.
   * Runs before the resync, with no await, so no call can resolve an old handle to a reused tab id in
   * between. The visibility lock is left alone: a holder's forwarded call is on the old socket (it ends
   * by its answer, its deadline or the socket's close), and a waiter re-resolves its handle when the lock
   * is granted, which now answers `TAB_GONE`. The marker itself is never logged.
   */
  private retireAll(): void {
    const retired = this.handles.retireAll();
    for (const handle of retired) {
      const owner = this.leases.ownerOf(handle);
      this.leases.release(handle);
      if (owner) this.sendGone(owner.clientId, handle);
    }
    this.closing.clear(); // closer entries name the old session's tab ids
    this.deps.log?.(`extension session changed: ${retired.length} handles retired`);
  }

  private async resync(conn: ExtensionConnection): Promise<void> {
    const before = this.handles.live().map((h) => h.handle);
    let result: unknown;
    const gen = this.safetyGen;
    try {
      result = await conn.call("listTabs", undefined, { timeoutMs: DEFAULT_TIMEOUT_MS + DAEMON_SLACK_MS });
    } catch {
      return; // the socket went away; the next hello resyncs
    }
    if (this.deps.bridge.currentConnection() !== conn) return;
    const tabs = this.record(result, gen);
    const present = new Set(tabs.map((t) => t.id));
    let gone = 0;
    for (const handle of before) {
      const r = this.handles.resolve(handle);
      if (r.kind === "live" && !present.has(r.tabId)) {
        this.tabGone(r.tabId, {});
        gone++;
      }
    }
    this.handles.prune(this.now());
    this.deps.log?.(`extension resync: ${tabs.length} tabs, ${gone} gone`);
  }

  /**
   * The current extension socket closed (#132): the state goes back to null — visible through
   * `daemon.status` and the existing `extensionStatus {connected:false}`; no `safetyStatus` is sent, since its
   * params are a `SafetyState`, never null.
   */
  extensionDisconnected(): void {
    if (this.safety === null) return;
    this.safety = null;
    this.deps.log?.("safety state: not reported (extension disconnected)");
  }

  /** `daemon.status.safety` (#132). */
  safetyStatus(): DaemonStatusSafety {
    return this.safety === null ? null : { ...this.safety };
  }

  /** The last state received says disarmed: withhold urls and titles from daemon output (#134, Stage 0 F2). */
  private redacting(): boolean {
    return this.lastReceived !== null && !this.lastReceived.armed;
  }

  /**
   * A well-formed `safetyState` (#132). An identical repeat changes nothing. A change is logged (booleans
   * and the count only), relayed to every client as `safetyStatus`, and followed by one `listTabs` so a tab
   * that became blocked loses its cached url/title within one round trip (#134, Stage 0 F41).
   */
  private onSafetyState(conn: ExtensionConnection, reported: SafetyState): void {
    const state: SafetyState = { armed: reported.armed, evaluate: reported.evaluate, blockedCount: reported.blockedCount };
    this.lastReceived = state;
    if (sameSafety(this.safety, state)) return;
    this.safety = state;
    this.safetyGen++;
    this.deps.log?.(safetyLogLine(state));
    const frame: EventMessage<SafetyStatusParams> = { event: "safetyStatus", params: { ...state } };
    this.deps.broadcast?.(frame);
    if (this.isProto()) void this.refreshAfterSafety(conn);
  }

  /** One `listTabs` after a safety change; its rows update the cache through `record`. Never retried. */
  private async refreshAfterSafety(conn: ExtensionConnection): Promise<void> {
    let result: unknown;
    const gen = this.safetyGen;
    try {
      result = await conn.call("listTabs", undefined, { timeoutMs: DEFAULT_TIMEOUT_MS + DAEMON_SLACK_MS });
    } catch {
      if (this.deps.bridge.currentConnection() === conn) this.deps.log?.("safety state: listTabs after the change failed");
      return;
    }
    if (this.deps.bridge.currentConnection() !== conn) return;
    this.record(result, gen);
  }

  /** A `{event, params}` frame from the extension (already counted by the host). */
  extensionEvent(conn: ExtensionConnection, frame: unknown): void {
    if (this.deps.bridge.currentConnection() !== conn) return; // a replaced socket's late event
    if (isSafetyStateEvent(frame)) {
      this.onSafetyState(conn, frame.params);
    } else if (isEvent(frame) && frame.event === "safetyState") {
      this.deps.log?.("safety state: malformed event dropped");
    } else if (isTabCreatedEvent(frame)) {
      const p = frame.params;
      this.handles.mint(p.tabId);
      this.handles.note(p.tabId, { url: p.url });
      if (p.openerTabId === undefined) return;
      const grant = this.applyOpener(p); // takes effect now (F20); only the event may wait
      if (!grant) return;
      if (urlKnown(grant.url)) this.deliverGrant(grant);
      else void this.fillUrl(conn, p.tabId, grant).then(() => this.deliverGrant(grant));
    } else if (isTabRemovedEvent(frame)) {
      const p = frame.params;
      // #134 / F41: a blocked tab leaves no url/title behind; a "disarmed" one keeps the cache (re-arming
      // restores today's output; the redaction meanwhile is `redacting()`'s).
      if (p.hidden === "blocked") this.handles.forgetPage(p.tabId);
      const last: { lastUrl?: string; lastTitle?: string } = {};
      if (p.lastUrl !== undefined) last.lastUrl = p.lastUrl;
      if (p.lastTitle !== undefined) last.lastTitle = p.lastTitle;
      this.tabGone(p.tabId, last);
      this.handles.prune(this.now());
    } else if (isTabReplacedEvent(frame)) {
      const p = frame.params;
      const { retired } = this.handles.replace(p.removedTabId, p.addedTabId, (h) => this.leases.ownerOf(h) !== undefined);
      if (retired) this.notifyGone(retired);
    }
  }

  /**
   * The opener rule (0.3): a tab opened from a leased tab is granted to that tab's holder at once,
   * unless already leased. Returns the grant (for the `leaseGranted` event), or undefined.
   */
  private applyOpener(p: TabCreatedParams): Grant | undefined {
    if (p.openerTabId === undefined) return undefined;
    const handle = this.handles.handleOf(p.tabId);
    if (!handle || this.leases.ownerOf(handle)) return undefined;
    const openerHandle = this.handles.handleOf(p.openerTabId);
    const owner = openerHandle ? this.leases.ownerOf(openerHandle) : undefined;
    if (!owner) return undefined; // an unleased opener's tab stays unheld
    this.leases.grant(handle, owner.clientId, "opener", this.now());
    return { handle, clientId: owner.clientId, url: p.url };
  }

  /**
   * T5b fix 3 (Run 8 LEASE-3; Stage 0 F33): Chrome's `tabs.onCreated` fires before a popup's url is
   * set, and no event tells the daemon the url later. So poll the extension's `listTabs` — at once,
   * then every `URL_FILL_POLL_MS` — until the tab's url is known or `URL_FILL_MAX_MS` passed since the
   * event, and put the best url seen into `g.url` (a later non-empty value, else what the event had).
   * Stops early when the extension socket changed, the tab is no longer listed, or the grant no longer
   * stands. Never rejects. The handle cache learns the url through `record`.
   */
  private async fillUrl(conn: ExtensionConnection, tabId: number, g: Grant): Promise<void> {
    const deadline = this.now() + URL_FILL_MAX_MS;
    for (;;) {
      if (this.deps.bridge.currentConnection() !== conn || !this.grantStands(g)) return;
      let result: unknown;
      let ok = true;
      const gen = this.safetyGen;
      try {
        result = await conn.call("listTabs", undefined, { timeoutMs: URL_FILL_CALL_MS });
      } catch {
        ok = false;
      }
      if (this.deps.bridge.currentConnection() !== conn) return;
      if (ok) {
        const tab = this.record(result, gen).find((t) => t.id === tabId);
        if (!tab) return; // gone (its tabRemoved drops the lease)
        // F40 (#134): a hidden row will never carry a url — the grant goes out now, as it is.
        if (tab.hidden !== undefined) return;
        if (typeof tab.url === "string" && tab.url !== "") g.url = tab.url;
        if (urlKnown(g.url)) return;
      }
      const left = deadline - this.now();
      if (left <= 0) return;
      await this.sleep(Math.min(URL_FILL_POLL_MS, left));
    }
  }

  /** Send the grant's event now, or hold it back while a `newTab` is in flight (F20). */
  private deliverGrant(g: Grant): void {
    if (this.newTabsInFlight > 0) this.heldBackGrants.push(g);
    else if (this.grantStands(g)) this.sendLeaseGranted(g);
  }

  /**
   * The opener grant still stands: not overridden by a `newTab`, not released, and its holder still
   * connected (a disconnect already dropped the lease).
   */
  private grantStands(g: Grant): boolean {
    const owner = this.leases.ownerOf(g.handle);
    if (!owner || owner.clientId !== g.clientId || owner.reason !== "opener") return false;
    return this.deps.nameOf(g.clientId) !== undefined;
  }

  private sendLeaseGranted(g: Grant): void {
    // While disarmed the url is withheld like every other daemon output (#134).
    const url = this.redacting() ? "" : g.url;
    const frame: EventMessage<LeaseGrantedParams> = { event: "leaseGranted", params: { tab: g.handle, reason: "opener", url } };
    this.deps.sendTo(g.clientId, frame);
  }

  /** Mark a tab's handle gone, drop its lease, tell its holder (unless the holder closed it). */
  private tabGone(tabId: number, last: { lastUrl?: string; lastTitle?: string }): void {
    const handle = this.handles.remove(tabId, last);
    if (!handle) return;
    const owner = this.leases.ownerOf(handle);
    this.leases.release(handle);
    if (owner && this.closing.get(tabId) !== owner.clientId) this.sendGone(owner.clientId, handle);
  }

  /** A handle retired by `replace`: drop its lease and tell the holder. */
  private notifyGone(handle: string): void {
    const owner = this.leases.ownerOf(handle);
    this.leases.release(handle);
    if (owner) this.sendGone(owner.clientId, handle);
  }

  private sendGone(clientId: string, handle: string): void {
    const params: TabGoneParams = { tab: handle };
    const r = this.handles.resolve(handle);
    if (r.kind === "gone" && !this.redacting()) {
      if (r.lastUrl !== undefined) params.lastUrl = r.lastUrl;
      if (r.lastTitle !== undefined) params.lastTitle = r.lastTitle;
    }
    this.deps.sendTo(clientId, { event: "tabGone", params });
  }

  // ------------------------------------------------------------------ client side

  /** A client disconnected (F14): its leases and its hold on (or place in) the lock go at once. */
  clientGone(clientId: string): void {
    this.leases.releaseAll(clientId);
    this.lock.releaseAllOf(clientId);
  }

  /** `daemon.status`'s tab-layer fields; `safety` is Step 9's (#132), and rows lose `url` while disarmed (#134). */
  status(): { tabs: StatusTab[]; lock: { holder?: string }; safety: DaemonStatusSafety } {
    const redact = this.redacting();
    const tabs = this.handles.live().map((h) => {
      const row: StatusTab = { tab: h.handle, tabId: h.tabId };
      const owner = this.leases.ownerOf(h.handle);
      if (owner) row.owner = this.name(owner.clientId);
      if (h.url !== undefined && !redact) row.url = h.url;
      return row;
    });
    const holder = this.lock.holder();
    return { tabs, lock: holder ? { holder: this.name(holder) } : {}, safety: this.safetyStatus() };
  }

  /**
   * Route one client request (not `daemon.*`). Resolves with the result to send, or rejects with a
   * `BridgeError`. `receivedAt` is taken here, synchronously, for the one deadline (#44).
   */
  async request(caller: Caller, method: string, params: Params | undefined, timeoutMs: number | undefined): Promise<unknown> {
    // #85 item 4: answered here, before any resolution — a Step 7 extension would still run it.
    const removed = REMOVED_METHODS.get(method);
    if (removed !== undefined) throw new BridgeError(ErrorCodes.UNKNOWN_METHOD, `${method} ${removed}`);
    const deadline = this.now() + clampTimeout(timeoutMs);
    this.handles.prune(this.now());
    const cls = classify(method, params);

    if (method === "tabs.claim") return this.claim(caller, params ?? {}, deadline);
    if (method === "tabs.release") return this.release(caller, params ?? {});

    if (!this.deps.bridge.isConnected()) throw this.deps.bridge.notConnectedError();
    const proto = this.isProto();

    if (cls === "free" || cls === "listTabs" || cls === "newTab") {
      // A no-proto extension gets exactly what Step 6 sent it (#42: only tab methods are refused).
      if (!proto) return this.forward(method, params, deadline);
      if (cls === "listTabs") return this.listTabs(without(params, "tab"), deadline);
      if (cls === "newTab") return this.newTab(caller, without(params, "tab"), deadline);
      if (method === "networkRequests") return this.networkRequests(params ?? {}, deadline);
      return this.forward(method, without(params, "tab"), deadline);
    }

    // Tab-carrying (incl. closeTab and an unlisted method, which without a `tab` is refused below).
    if (!proto) throw new BridgeError(ErrorCodes.VERSION, RELOAD_HINT);
    const p = params ?? {};
    // #332: an older extension would run the function source as an expression and ignore `args`; never forward.
    if ((method === "evaluate" || method === "evaluateSaveStart") && "args" in p) {
      const conn = this.deps.bridge.currentConnection();
      if (conn === null || !this.argsConnections.has(conn)) throw new BridgeError(ErrorCodes.VERSION, ARGS_RELOAD_HINT);
    }
    // #355: an older extension would ignore `chooser` and treat the target as a file input; never forward.
    if (method === "uploadFiles" && "chooser" in p) {
      const conn = this.deps.bridge.currentConnection();
      if (conn === null || !this.chooserConnections.has(conn)) throw new BridgeError(ErrorCodes.VERSION, CHOOSER_RELOAD_HINT);
    }
    if (method === "networkClear" && p.tab === "all") return this.networkClearAll(caller, p, deadline);
    if ((method === "closeTab" || method === "focusTab") && p.id !== undefined) {
      throw bad(`${method} takes tab (a handle like "T3"), not a Chrome tab id`);
    }

    const target = await this.resolveTarget(method, p, deadline);
    this.checkLease(target.handle, caller);
    if (trustedFocus(method, p)) return this.trustedInput(caller, method, p, target.handle, deadline);

    let release: (() => void) | undefined;
    let tabId = target.tabId;
    if (takesLock(method, p)) {
      if (this.deps.nameOf(caller.clientId) === undefined) {
        throw new BridgeError(ErrorCodes.NOT_CONNECTED, "client disconnected");
      }
      release = await this.lock.acquire(caller.clientId, deadline);
      try {
        // The wait may have been long: the tab may have closed, moved or been claimed meanwhile.
        tabId = this.resolveHandle(target.handle);
        this.checkLease(target.handle, caller);
      } catch (err) {
        release();
        throw err;
      }
    }
    const forwarded = without(p, "tab");
    forwarded.tabId = tabId;
    if (method === "closeTab") this.closing.set(tabId, caller.clientId);
    try {
      const result = await this.forward(method, forwarded, deadline);
      if (method === "closeTab") {
        if (this.handles.handleOf(tabId) === target.handle) this.handles.remove(tabId, {});
        if (this.handles.resolve(target.handle).kind !== "live") this.leases.release(target.handle);
      }
      return result;
    } finally {
      if (method === "closeTab" && this.closing.get(tabId) === caller.clientId) this.closing.delete(tabId);
      release?.();
    }
  }

  /**
   * Step 12 S6-G2 (#321 Q6, #338; spec §6.4): a trusted input as one blocking action. One acquisition covers a forwarded
   * `focusTab`, the input and the settle pause, so no other actor's capture or focus comes between. Caller and lease are
   * re-checked after the wait and again between the forwards; a failure there, or of the focus, or a focus that settled
   * at or past the deadline (`TIMEOUT`), forwards no input and releases at once. The reply goes out first; the pause (`min(500, deadline − now)`, #44) follows every input outcome.
   */
  private async trustedInput(caller: Caller, method: string, p: Params, handle: string, deadline: number): Promise<unknown> {
    const gone = () => new BridgeError(ErrorCodes.NOT_CONNECTED, "client disconnected");
    if (this.deps.nameOf(caller.clientId) === undefined) throw gone();
    const release = await this.lock.acquire(caller.clientId, deadline);
    let tabId: number;
    try {
      tabId = this.resolveHandle(handle);
      this.checkLease(handle, caller);
      await this.forward("focusTab", { tabId }, deadline);
      if (this.deps.nameOf(caller.clientId) === undefined) throw gone();
      tabId = this.resolveHandle(handle);
      this.checkLease(handle, caller);
      // S6-G2 fixer r1 (MINOR-3): a focus that settled at or past the deadline sends no input.
      if (this.now() >= deadline) throw new BridgeError(ErrorCodes.TIMEOUT, `Timed out before calling ${method}`);
    } catch (err) {
      release();
      throw err;
    }
    const forwarded = without(p, "tab");
    forwarded.tabId = tabId;
    try {
      return await this.forward(method, forwarded, deadline);
    } finally {
      const pause = Math.min(TRUSTED_SETTLE_MS, deadline - this.now());
      if (pause > 0) void this.sleep(pause).then(release, release);
      else release();
    }
  }

  /** Forward to the extension, waiting `deadline − now + 5000` (#44). */
  private forward(method: string, params: Params | undefined, deadline: number): Promise<unknown> {
    const wait = deadline - this.now() + DAEMON_SLACK_MS;
    if (wait <= 0) {
      return Promise.reject(new BridgeError(ErrorCodes.TIMEOUT, `Timed out before calling ${method}`));
    }
    return this.deps.bridge.call(method, params, { timeoutMs: wait });
  }

  // ------------------------------------------------------------------ resolution

  private resolveHandle(handle: string): number {
    const r = this.handles.resolve(handle);
    if (r.kind === "live") return r.tabId;
    if (r.kind === "gone") {
      const data: TabGoneParams = { tab: handle };
      const redact = this.redacting(); // #134: no url/title while disarmed
      if (r.lastUrl !== undefined && !redact) data.lastUrl = r.lastUrl;
      if (r.lastTitle !== undefined && !redact) data.lastTitle = r.lastTitle;
      throw new BridgeError(ErrorCodes.TAB_GONE, `tab ${handle} was closed — call listTabs to pick another tab`, data);
    }
    throw new BridgeError(ErrorCodes.TAB_UNKNOWN, `unknown tab handle ${handle} — call listTabs`);
  }

  private checkLease(handle: string, caller: Caller): void {
    const c = this.leases.check(handle, caller.clientId);
    if (c.ok) return;
    const owner = this.name(c.owner);
    throw new BridgeError(
      ErrorCodes.TAB_HELD,
      `tab ${handle} is held by ${JSON.stringify(owner)} since ${hhmmss(c.since)} — use browser_new_tab, or browser_list_tabs to pick a free tab`,
      { owner, since: c.since },
    );
  }

  /**
   * The target of a tab-carrying call: an explicit handle (S2b: `tab` is required). A network call's
   * `tab` is a scope: absent or "active" is the human's tab (#40, kept by #81), a handle is that tab, and
   * a Chrome tab id — a number or a numeric string — is refused (#54's form removed).
   */
  private async resolveTarget(method: string, p: Params, deadline: number): Promise<{ handle: string; tabId: number }> {
    const tab = p.tab;
    if (NETWORK_METHODS.has(method)) {
      if (tab === undefined || tab === "active") return this.humanTab(deadline);
      if (typeof tab !== "string" || /^\s*-?\d+(\.\d+)?\s*$/.test(tab)) {
        throw bad(`tab must be a tab handle like "T3", "all" or "active" — not a Chrome tab id`);
      }
      return { handle: tab, tabId: this.resolveHandle(tab) };
    }
    if (tab === undefined) throw bad("tab is required");
    if (typeof tab !== "string") throw bad(`tab must be a tab handle like "T3"`);
    return { handle: tab, tabId: this.resolveHandle(tab) };
  }

  /** The human's tab (#43): the `current: true` tab of a fresh `listTabs`. */
  private async humanTab(deadline: number): Promise<{ handle: string; tabId: number }> {
    const gen = this.safetyGen;
    const tabs = this.record(await this.forward("listTabs", undefined, deadline), gen);
    const human = tabs.find((t) => t.current === true);
    if (!human) throw new BridgeError(ErrorCodes.INTERNAL, NO_HUMAN_TAB);
    return { handle: this.handles.mint(human.id), tabId: human.id };
  }

  /**
   * Mint and cache every tab of a `listTabs` result; never marks anything gone. `gen` is `safetyGen` when
   * the request was sent: an older one (a safety change came in between) skips only the url/title noting.
   */
  private record(result: unknown, gen: number): ListedTab[] {
    const fresh = gen === this.safetyGen;
    const raw = (result as { tabs?: unknown } | null)?.tabs;
    if (!Array.isArray(raw)) return [];
    const tabs = raw.filter((t): t is ListedTab => typeof t === "object" && t !== null && Number.isInteger((t as ListedTab).id));
    for (const t of tabs) {
      this.handles.mint(t.id);
      // #134 / F41: a "blocked" row clears the cache; any other hidden row leaves it as it is.
      if (t.hidden === "blocked") {
        this.handles.forgetPage(t.id);
        continue;
      }
      if (t.hidden !== undefined || !fresh) continue;
      this.handles.note(t.id, {
        url: typeof t.url === "string" ? t.url : undefined,
        title: typeof t.title === "string" ? t.title : undefined,
      });
    }
    return tabs;
  }

  // ------------------------------------------------------------------ intercepts

  private async listTabs(params: Params, deadline: number): Promise<unknown> {
    const gen = this.safetyGen;
    const result = await this.forward("listTabs", params, deadline);
    if (!Array.isArray((result as { tabs?: unknown } | null)?.tabs)) return result;
    const tabs = this.record(result, gen);
    return {
      ...(result as object),
      tabs: tabs.map((t) => {
        const handle = this.handles.mint(t.id);
        const owner = this.leases.ownerOf(handle);
        return owner ? { ...t, tab: handle, owner: this.name(owner.clientId) } : { ...t, tab: handle };
      }),
    };
  }

  private async newTab(caller: Caller, params: Params, deadline: number): Promise<unknown> {
    this.newTabsInFlight++;
    try {
      const result = await this.forward("newTab", params, deadline);
      const id = (result as { id?: unknown } | null)?.id;
      if (typeof id !== "number" || !Number.isInteger(id)) return result;
      const handle = this.handles.mint(id);
      // Overrides an opener grant made for the same tab (F20). A caller gone meanwhile gets nothing.
      if (this.deps.nameOf(caller.clientId) !== undefined) this.leases.grant(handle, caller.clientId, "opened", this.now());
      return { ...(result as object), tab: handle };
    } finally {
      this.newTabsInFlight--;
      if (this.newTabsInFlight === 0) {
        const held = this.heldBackGrants;
        this.heldBackGrants = [];
        for (const g of held) if (this.grantStands(g)) this.sendLeaseGranted(g);
      }
    }
  }

  private async networkRequests(p: Params, deadline: number): Promise<unknown> {
    let forwarded: Params;
    if (p.id !== undefined) forwarded = without(p, "tab"); // a request-id lookup is global
    else if (p.tab === "all") forwarded = { ...without(p, "tab"), scope: "all" };
    else {
      const target = await this.resolveTarget("networkRequests", p, deadline); // free: no lease check
      forwarded = { ...without(p, "tab"), tabId: target.tabId };
    }
    const result = await this.forward("networkRequests", forwarded, deadline);
    const entries = (result as { entries?: unknown } | null)?.entries;
    if (!Array.isArray(entries)) return result;
    return {
      ...(result as object),
      entries: entries.map((e) => {
        const tabId = (e as { tabId?: unknown } | null)?.tabId;
        if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) return e;
        // The live handle, else the newest dead one; a tab id never seen gets no `tab` — a network
        // entry must not mint a live handle for a tab no listTabs or event has shown (verifier V3).
        const handle = this.handles.lastHandleOf(tabId);
        return handle ? { ...(e as object), tab: handle } : e;
      }),
    };
  }

  /**
   * `networkClear {tab:"all"}` (#40 as amended, stricter): refused with `TAB_HELD` whenever another
   * client holds any tab. Checked synchronously, then forwarded at once — no probe and no await between
   * the check and the forward, so no lease can be granted in between and a held tab's entries are
   * never cleared by someone else.
   */
  private networkClearAll(caller: Caller, p: Params, deadline: number): Promise<unknown> {
    const foreign = this.leases.entries().find((l) => l.clientId !== caller.clientId);
    if (foreign) {
      try {
        this.checkLease(foreign.handle, caller); // throws TAB_HELD {owner, since}
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return this.forward("networkClear", { ...without(p, "tab"), scope: "all" }, deadline);
  }

  private async claim(caller: Caller, p: Params, deadline: number): Promise<unknown> {
    let handle: string;
    if (p.tab === undefined && p.active === true) {
      if (!this.deps.bridge.isConnected()) throw this.deps.bridge.notConnectedError();
      if (!this.isProto()) throw new BridgeError(ErrorCodes.VERSION, RELOAD_HINT);
      handle = (await this.humanTab(deadline)).handle;
    } else if (typeof p.tab === "string") {
      handle = p.tab;
      this.resolveHandle(handle);
    } else {
      throw bad('tabs.claim needs {tab: "<handle>"} or {active: true}');
    }
    this.checkLease(handle, caller);
    if (!this.leases.ownerOf(handle) && this.deps.nameOf(caller.clientId) !== undefined) {
      this.leases.grant(handle, caller.clientId, "claimed", this.now());
    }
    return { tab: handle };
  }

  private release(caller: Caller, p: Params): unknown {
    if (typeof p.tab !== "string") throw bad('tabs.release needs {tab: "<handle>"}');
    this.resolveHandle(p.tab);
    this.checkLease(p.tab, caller);
    this.leases.release(p.tab);
    return { ok: true };
  }
}
