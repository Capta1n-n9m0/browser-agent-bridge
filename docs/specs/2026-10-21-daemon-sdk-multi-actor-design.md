# Daemon, SDK and Multi-Actor Control — Design Spec

- **Date:** 2026-10-21
- **Status:** Approved in discussion (implementation not started). *Corrected 2026-10-22: was
  "implementation not started"; as built Step 6 (§4, §5's daemon/SDK/MCP rows, §9, §10 without tabs,
  §11) is built — stages D0–D5b, 542 tests — and its live E2E waits for the D6 wave; contracts and
  deviations in `docs/plans/2026-10-21-step6-daemon-and-protocol-v2-asbuilt.md`.* *Corrected
  2026-10-23 (Step 7 propagator): Step 6 closed on 2026-10-22, after wave W1. Step 7 (§5's extension row,
  §6, §7, §10's tab parts) is built and E2E-run (Runs 8–10). It has 22 tools and 950 tests in 59 files
  (`npm test` at `9cfc7db`); its gate waits on the user's remaining items. Step 8 (§8) is planned.
  Contracts and deviations: `docs/plans/2026-10-21-step7-multi-actor-tabs-asbuilt.md`.* *Corrected
  2026-10-24 (Step 8 S7): Step 8 (§8, with §5, §10 and §13 where noted below) is built and E2E-run
  (Runs 11–12): 23 tools, 1714 tests in 85 files (`npm test` at `eb6b991`); its gate waits on the
  user's open decisions. Contracts and deviations: `docs/plans/2026-10-21-step8-sdk-surface-and-mcp-cursor-asbuilt.md`.* *Corrected
2026-10-24 (Step 9 propagator): was "1714 tests in 85 files … its gate waits on the user's open decisions" as the
latest state; Step 8 closed 2026-10-24 (wave W2), and Step 9 (Phase E safety: §6.5's and §10's Step 9 notes) is
built and E2E-run (Run 13): 23 tools, 25 codes, 2720 tests in 116 files (`npm test` at `ba6029e`); its gate waits
on the user's ruling on Run 13 and its open decisions. Contracts and deviations:
`docs/plans/2026-10-24-step9-phase-e-safety-asbuilt.md`.* *Corrected 2026-10-25 (Step 10 propagator): was
"its gate waits on the user's ruling on Run 13 and its open decisions" as the latest state; Step 9 closed 2026-10-24
(#202), and Step 10 (the Step 8 follow-ups: the dated Step 10 notes in §8, §10, §11, §12 and §13) is built and
E2E-run (Runs 14–15): 23 tools, 26 codes (25 on the wire), 26 router methods, 3273 tests in 132 files (`npm test`
at `025bdef`); closed 2026-10-25, every open decision ruled (#229). *Corrected 2026-10-25 (cleanup pass): was "its gate waits on the user's open decisions".* Contracts and deviations:
`docs/plans/2026-10-24-step10-step8-follow-ups-asbuilt.md`.* *Corrected 2026-10-26 (cleanup pass): Step 11 (D3 file
upload: §10's Step 11 note) is built and E2E-run (Run 16): 24 tools, 27 codes (26 on the wire), 27 router methods,
3811 tests in 154 files (`npm test` on S6's tree); not closed, its gate waits on the user. *Corrected 2026-10-27: Step 11 closed 2026-10-26 (#288); Step 11b closed 2026-10-27 (#320); current status: `docs/progress-and-roadmap.md`.* *Corrected 2026-10-29 (cleanup pass): Step 12 (Phase F: §10's Step 12 notes) is built and E2E-run (Runs 18–19); its gate waits for the user.* Contracts and deviations:
`docs/plans/2026-10-25-step11-file-upload.md` § As built.* Plans: `docs/plans/2026-10-21-step6-daemon-and-protocol-v2.md`, `…step7-multi-actor-tabs.md`, `…step8-sdk-surface-and-mcp-cursor.md`.
- **Owner:** Abbas Aliyev (@Capta1n-n9m0)
- **Supersedes in part:** `2026-06-04-chrome-real-profile-agent-bridge-design.md` §3 "Controller: MCP server", §4 topology, and the "Tab targeting: active tab" decision. Everything about the extension's perception/action model stands.

---

## 1. Background & motivation

The bridge works: 21 MCP tools drive the real logged-in profile, E2E-verified over five runs. But the
only way to *script* it today is what the `blackboard-ultra` skill does — a 400-line `bb.js` eval'd
into a tab through `browser_evaluate`, booted via a side HTTP server on port 8765, with Claude in the
loop for every call. That works for Blackboard because Blackboard has a REST API behind the page. It
does not generalise to "click through this UI" tasks, every rerun costs tokens, and a human watches.

The field has gone the same way we want to go — browser-use's *workflow-use* ("record once, run a
million times without AI"), Stagehand's observe→act caching, Playwright's planner/generator/healer
agents — but none of them run against the user's **real** Chrome profile. That is the differentiator
this project already has.

Three problems turned out to have one solution:

1. **No scripting SDK.** A program (not Claude) cannot call the primitives.
2. **One Claude session at a time.** Port 9234 is owned by the MCP process; a second session finds
   it busy (handled gracefully since Phase B, but still exclusive).
3. **The orphan problem, inverted.** `lifecycle.ts` (2026-10-21) makes the server exit with its
   session precisely because a lingering process on 9234 was a bug. A persistent daemon makes that
   lingering process the *design*, so its lifecycle has to be deliberate.

> Mental model: **Claude explores once interactively, writes a script, the script runs forever for
> free — against the same logged-in Chrome, while Claude (or a second Claude) keeps working in
> another tab.**

## 2. Goals & non-goals

### Goals
- A **daemon** between any number of clients and the one extension: started by whoever knocks first,
  shared by everyone after, exits when idle.
- A **TypeScript SDK** (`@bridge/sdk`) that scripts — primarily Claude-written scripts and skills —
  use to drive the browser with typed calls and structured results.
- The **MCP server becomes an SDK client**: tool schemas + text rendering, no protocol code of its own.
- **Several actors at once** (two Claude sessions, a script and a Claude session, two scripts) on
  different tabs, in parallel, without their actions mixing.
- **Failures that explain themselves**: structured error codes, and SDK errors that carry a snapshot,
  a screenshot and the recent network entries — the "honest v1" of failure handling.

### Non-goals (YAGNI)
- Self-healing / "Claude fixes the broken step" hooks (Agent SDK in the loop). Good error reports are
  enough; revisit after watching real scripts break.
- A Python (or any non-Node) SDK. The wire protocol is plain JSON over WebSocket; a port later is small.
- Bun. Node + TS stays.
- A second trust boundary. Clients present the same token the extension presents (see §9). Token
  design is a separate future direction.
- Remote-over-network control. Still `127.0.0.1` only.
- Queueing or turn-passing between actors who want the *same* tab. Fail fast instead (§6.3).
- Making a background tab believe it is visible (§7.3 explains why not).

## 3. Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Topology | **Daemon hosts 9234; MCP and scripts are clients of it** | One extension socket shared by all; solves SDK + multi-session + orphan at once. |
| Who starts the daemon | **Whoever knocks first** (MCP or script); the port bind is the lock | No lock file, no race: both starters try to bind, the loser goes back to knocking. |
| Daemon lifetime | **Idle-exit after 10 min with zero clients** + **version handover** | Cheap to restart (extension reconnects on its own); a stale daemon cannot outlive a `npm run build` for long. |
| Wire protocol | **Same `{id,method,params}` RPC, extended**: hello with role/name/build, structured errors, events | The protocol was already a good RPC; the extension needs almost no change to keep speaking it. |
| Payloads | **Extension returns data; MCP renders prose; nothing in between touches the payload** | Scripts need structures, models need text; formatters are pure and move to where the text is needed. |
| Tab addressing | **Daemon-minted handles (`T3`), never raw Chrome ids** | Chrome ids change on restart and on Memory-Saver discard (`tabs.onReplaced`). |
| Multi-actor model | **Named actors, per-actor cursor + tab leases, background execution, a visibility lock only for screen-needing instructions** | Synthesis of the two models discussed (§6.1). |
| Screenshot of a background tab | **Switch-shoot-restore (default) under the visibility lock; CDP `Page.captureScreenshot` opt-in** | Default keeps today's banner-free quality; opt-in avoids stealing the screen from a human. |
| MCP's current tab | **Does not follow the human.** Starts at the active tab on first touch, then stays until Claude or the user says otherwise | A human checking email mid-task must not redirect Claude's next click into Gmail. |
| Primary consumer | **Claude-written scripts and skills** | Shifts polish from API sugar to precise types + JSDoc and errors that contain the fix (§8). |
| Packages | `shared/ extension/ daemon/ sdk/ mcp/` — `server/` renamed to `daemon/`, MCP split out, MCP depends on SDK | Four parts that evolve independently; one client code path exercised by both consumers. |

*Corrected 2026-10-23: the Tab addressing rationale was doubted by Step 7's Stage 0 audit (F7: Chrome's
docs tie `tabs.onReplaced` to prerendering, and a 2024 Chromium change discards by clearing the
document, so the id was expected to stay). Measured on Chrome 156 (Step 7 Run 8, LEASE-6, outcome (b)):
an Urgent Discard from `chrome://discards` **did** give the tab a new id, `tabReplaced` fired, and the
handle kept working — the rationale stands as written (`docs/plans/2026-10-21-step7-multi-actor-tabs-steps/T5-run-record.md`
§ LEASE-6; decisions.md · 2026-10-22 · LEASE-6 measures whether a discard keeps the tab id, with both
outcomes pre-written).*

## 4. Topology

```
 Claude Code #1 ─ stdio ─ mcp/ ─┐                     (clients: same token, role "client", a name)
 Claude Code #2 ─ stdio ─ mcp/ ─┼─ ws://127.0.0.1:9234 ─┐
 export-grades.ts ── sdk/ ──────┘                        │
                                                         ▼
                                              ┌─────────────────────┐
                                              │  daemon/            │  registry · handles · leases
                                              │  (detached node)    │  visibility lock · idle exit
                                              └──────────┬──────────┘
                                                         │ one socket, role "extension"
                                                         ▼
                                              ┌─────────────────────┐
                                              │  extension/ (MV3)   │  offscreen socket · SW router
                                              │  real Chrome profile│  content script · chrome.debugger
                                              └─────────────────────┘
```

The extension still dials out to 9234 and still cannot tell it is talking to a daemon rather than to
the old server: a v1 hello (no `role`) is treated as `role: "extension"`.
*Corrected 2026-10-23 (Step 7 propagator): as built since Step 7 T1, the extension's hello is `{type:
"hello", token, role:"extension", proto:2}`. A Step 6 daemon accepts it. A Step 7 daemon still accepts a
hello with no `proto`, but it then answers every tab-carrying method with `VERSION` and a reload hint,
because such an extension ignores `tabId` and would act past every lease (decisions.md · 2026-10-22 · A
stale extension is refused for tab calls, detected by its hello (#42)) — see Step 7 as-built § Stage T1,
§ Stage T2.*

## 5. Layer contract — who returns what

| Layer | Does | Does not |
|---|---|---|
| **Extension** | Capabilities. Every method takes an explicit `tabId`. Structured results: `snapshot → {url, title, elements: [{ref, role, name, value?, disabled?, checked?, …}], truncated}`, `networkRequests → {entries, total, pending, recordingSince}`, `evaluate → EvalEnvelope`. Structured errors `{code, message, data?}`. Emits tab lifecycle **events**. | Build text for a model (today's snapshot and network formatters move out — they are pure, their tests move with them). Know that several actors exist. |
| **Daemon** | Connection registry (one extension, N clients), hello/token/build check, request routing with id remapping, per-call timeouts, **handles**, **leases**, the **visibility lock**, interception of the tab methods, idle exit, `daemon.*` methods. | Know anything about pages. Its own error codes: `NOT_CONNECTED`, `TIMEOUT`, `TAB_HELD`, `TAB_GONE`, `TAB_UNKNOWN`, `LOCK_TIMEOUT`, `VERSION`, `UNKNOWN_METHOD`, `BAD_PARAMS`. |
| **SDK** | `connect()` with knock → spawn → handover; `BridgeClient.call()`; typed `Tab` API; locators; wait/retry policy; the per-actor **cursor**; **failure enrichment** (a thrown `BridgeError` carries code, snapshot, screenshot path, last N network entries); the pure formatters (`formatSnapshot`, `formatNetwork`) so scripts *can* print what the model sees. | Decide how a model reads things. |
| **MCP** | *Is an SDK client.* Tool schemas, text rendering, the active-tab-on-first-touch convenience, exit-with-session lifecycle (today's `lifecycle.ts` moves here unchanged). | Any protocol code. |

Consequence: `mcp/` shrinks to "SDK call → render", and one client path is tested by both consumers.

*Corrected 2026-10-23 (Step 7 propagator), on the as-built state of the four rows:*
- *Extension: "every method takes an explicit `tabId`" holds on the wire from the Step 7 daemon. The
  extension still falls back to the human's tab, with a warning, when `tabId` is absent, for one
  release; Step 8 S2 removes the fallback.* *Corrected 2026-10-24 (Step 8 S7): as built the fallback
  was removed by stage S2b, not S2; an absent `tabId` is now `BAD_PARAMS` (Step 8 as-built § S2b).
  The SDK row's typed `Tab`, locators and failure enrichment are built (§ S3, § S4), and the formatters
  are also exported from the main entry (decisions.md · 2026-10-23 · S3.4 applies as written: the main
  entry also re-exports the formatters (#75)).*
- *SDK: the formatters `formatSnapshot` and `formatNetwork` exist in `sdk/src/format/`. They are exported
  through the `@bridge/sdk/format` subpath, not the main entry (decisions.md · 2026-10-22 · The
  formatters reach the MCP through a `@bridge/sdk/format` subpath (#46), open for the user).*
- *SDK: the typed `Tab`, locators and failure enrichment are Step 8's.*
- *MCP: the active-tab-on-first-touch cursor is built (`mcp/src/cursor.ts`).*

*See Step 7 as-built § Stage T1, § Stage T4.*

## 6. Multi-actor control

### 6.1 The two models and the synthesis

**Model A — "actor cursor + turn scheduler"** (the original idea): each actor connects with a name; the
daemon keeps its *cursor* (the tab it last touched); instructions never mention tabs; when an actor's
instruction runs, the daemon makes its cursor the active tab, runs the instruction, releases the turn.
Instruction-level locking, so interleaving is safe and the actor's mental model stays "the active tab".

Kept from A: **named actors** (errors say *who* holds a tab), the **cursor** (scripts should not pass a
tab to every call), **instruction-level** pausing.

Why not A as the execution model: the visible tab is one global resource, so every instruction from
every actor would serialise through it even when nothing needs the screen; activating a tab is
asynchronous and has side effects (`visibilitychange`, paused media, throttled timers, SPA refetches);
and the human using the same Chrome would have the view stolen on every instruction.

**Model B — "tab leases, background execution"**: every call carries a tab; the daemon enforces that
a tab is acted on by one actor; calls run on the tab *where it is*, in the background.

What makes B possible — verified by reading the extension: every handler resolves the target through
one function (`extension/src/tabs.ts: activeTab()`), and **only one Chrome API in the whole extension
needs the tab to be visible**: `chrome.tabs.captureVisibleTab` (the viewport screenshot). `executeScript`,
`chrome.debugger`, `webRequest`, `tabs.update` all work on a background tab.

**Synthesis (chosen):** A's table — named actors, cursors — kept in the daemon; B's rule — act on the
tab where it is; and a **visibility lock** that only the screen-needing instructions take, which is
A's instruction-level turn scoped to the few instructions that need it.

```
actor "export-grades.ts"             actor "claude-code #4412"
  cursor T3, leases {T3, T5}           cursor T1, leases {T1}

click T3 ─────────────┐                snapshot T1 ─────┐        ← both run now, no lock
                      ▼                                 ▼
             executeScript(tabId 412)          executeScript(tabId 388)

screenshot T3 ──► acquire VISIBILITY ─► activate 412 ─► capture ─► restore ─► release
screenshot T1 ──► waits for the lock ─────────────────────────────────────────► its turn
```

### 6.2 Handles

Actors never see Chrome tab ids. The daemon mints handles `T1, T2, …` (monotonic per daemon lifetime)
and owns `handle → chromeTabId`. The extension emits `tabCreated {tabId, openerTabId?, url}`,
`tabRemoved {tabId}`, `tabReplaced {addedTabId, removedTabId}`; the daemon remaps on `tabReplaced`
(Memory Saver discard, prerender swap) and marks the handle dead on `tabRemoved` — a later call gets
`TAB_GONE { lastUrl, lastTitle }`, so the error tells you what was lost. A tab that a page opens itself
(`target=_blank`, a popup) carries `openerTabId`; the daemon leases it to the opener's holder and tells
that client (`leaseGranted {tab, reason: "opener"}`), so "click Export, a new tab appears" just works.

*Corrected 2026-10-23 (Step 7 Stage 0 F13): the event params were not fully specified here and differed
from the Step 7 plan; as built (`shared/src/protocol.ts`, Step 7 T0) they are `tabCreated {tabId,
openerTabId?, url}`, `tabRemoved {tabId, lastUrl?, lastTitle?}` (the extension sends the last URL and
title, which `TAB_GONE` needs), `tabReplaced {addedTabId, removedTabId}`, the daemon's `tabGone {tab,
lastUrl?, lastTitle?}`, and `leaseGranted {tab, reason: "opener", url}`. `tabCreated.url` is often empty
for a popup, so the daemon polls `listTabs` (≤ 2 s) to fill `leaseGranted.url` (T5b). Run 8 LEASE-6
confirmed the remap on a Memory-Saver discard (see the note under §3).*

*Corrected 2026-10-24 (Step 9 propagator): was "the extension sends the last URL and title" on every `tabRemoved`
and a `leaseGranted.url` the daemon always waits to fill; as built in Step 9, while disarmed or for a blocked tab
`tabRemoved` carries `hidden: "disarmed" | "blocked"` and no `lastUrl`/`lastTitle`, `tabCreated.url` is `""`, the
daemon omits `lastUrl`/`lastTitle` from `tabGone` and `TAB_GONE` while the last state says disarmed, and
`leaseGranted.url` is `""` without the wait — see §10's Step 9 note; Step 9 as-built § Stage S3; decisions.md ·
2026-10-24 · What `listTabs`, tab events and the daemon reveal while disarmed or for a blocked tab (#134); · S3:
`leaseGranted.url` is `""` while disarmed, whatever the event carried (#161).*

*Amended 2026-10-27 (Step 11b S6; decisions.md · 2026-10-27 · The user rules Step 11b's gate: accept, `newTab` on
`about:blank` (S6), then Run 17b (#311) item 2): a `newTab` with a URL other than `about:blank` now opens the tab on
`about:blank`, installs its block-list rules, then navigates it to the URL, so the `tabCreated` it causes reads `url:
"about:blank"` (not the URL), and the tab's history holds one more entry (`about:blank` before the page). A `newTab`
with no URL or with `about:blank` is unchanged. No event, field, code or message is added; the reply (`{id}`) is
unchanged. See §10's Step 11b S6 note.*

*Amended 2026-10-30 (Step 13 S1, #385): `tabCreated.openerTabId` is the tab whose page opened the new tab
(`webNavigation.onCreatedNavigationTarget`'s `sourceTabId`, joined within 250 ms), or absent; never Chrome's own
`openerTabId`. A background opener's popup now goes to the opener's holder. See §10's Step 13 S1 note.*

### 6.3 Leases

- A tab is held by the actor that opened it (`newTab`), claimed it (`tabs.claim`), or received it by
  the opener rule. Leases die with the connection.
- A call on a tab held by someone else → `TAB_HELD { owner, since }`, **fail fast**. Two actors wanting
  one tab is a design error in the scripts, not a scheduling event. (Future option, not v1: read-only
  `snapshot` on a foreign tab via generation-stamped refs `s7.e12`, which would also catch stale refs.)
- Calls touching no tab — `listTabs`, `networkRequests` (any scope), `daemon.status` — are free.
  *Corrected 2026-10-24 (Step 9 propagator): "free" holds for leases only; as built in Step 9 the extension refuses
  every network call `DISARMED` while disarmed, filters blocked entries from every scope, and redacts `listTabs`
  (refusing it only when the safety state cannot be read) — Step 9 as-built § Stage S2a; decisions.md · 2026-10-24 ·
  In-flight work at disarm and on a newly blocked tab (#137); · S2a: the post-check also replaces error replies;
  `listTabs` with an unreadable state is refused, and has no post-check (#178).*
- `tabs.release {tab}` gives a tab up; `tabs.claim {tab}` on an unheld tab takes it; `tabs.claim
  {active: true}` claims whatever the human is looking at (the MCP's first-touch move).

*Corrected 2026-10-23 (Step 7 propagator), on what was built:*
- *The free list also holds `downloadStart`, `downloadChunk` and `downloadEnd` (decisions.md ·
  2026-10-22 · The daemon's method classes are one table, and the download methods are free (#39)).*
- *`networkClear {tab:"all"}` is refused with `TAB_HELD` while any other client holds any tab (#40 as
  amended by #57).*
- *"Whatever the human is looking at" is the active tab of the last-focused **normal** window
  (decisions.md · 2026-10-22 · "The human's tab" is the active tab of the last-focused normal window
  (#43)).*
- *For one release a Step 6 client's untargeted call goes through a legacy path: it is resolved to
  the human's tab and lease-checked, but grants no lease (#41, #54).*

*See Step 7 as-built § Stage T2.*

### 6.4 The visibility lock

- One daemon-wide async mutex. Taken for the duration of a single call by methods flagged
  *needs-screen*: `screenshot` (viewport, default mode) and `focusTab`.
- Waiting is bounded by the call's own timeout → `LOCK_TIMEOUT`; the holder's call timing out or its
  connection closing releases it, so a hung screenshot cannot wedge everyone.
- Always taken, even if the target happens to be active — uncontended it costs nothing, and the
  extension skips the switch when the tab is already active.
- *Corrected 2026-10-23 (Step 7 propagator), on what was built:*
  - *`selectTab`, the one-release alias of `focusTab`, takes the lock too (decisions.md · 2026-10-22 ·
    `selectTab` takes the visibility lock, like `focusTab` (#53)).*
  - *`mode:"cdp"` and a truthy `fullPage` do not take it.*
  - *One deadline per call bounds the lock wait and the forwarded call together (decisions.md ·
    2026-10-22 · One deadline per call covers the lock wait and the forwarded call (#44)).*
  - *"Costs nothing" holds for the lock. The switch itself costs about 1.5 s of flash (see §7).*

  *See Step 7 as-built § Stage T2.*
- *Amended 2026-10-28 (Step 12 S6-G2; phase doc `docs/plans/2026-10-27-step12-phase-f.md` 0.9 G2 and § S6;
  decisions.md · 2026-10-27 · The user rules Step 12's scope (G12-0) (#321) Q6; · Step 12: G1 and G2 as ruled, their
  contract left to Stage 0 (#326); · Stage 0: G2 by the daemon, one request, a 500 ms pause (#338). Proposed, for the
  user at Step 12's gate. No method, code, event or field is added; nothing changes in the extension, the SDK or the
  MCP):*
  - *A **trusted input** — `click`, `type` or `pressKey` with `trusted: true` and `focusEmulation` not `true`
    (`trustedFocus(method, params)` in `daemon/src/methods.ts`; `takesLock` is unchanged and still false for these
    methods) — is one blocking action. Inside the one client request the daemon's tab layer resolves the handle and
    checks the lease (fail fast, as today), takes the visibility lock, re-resolves and re-checks the lease, forwards
    `focusTab {tabId}`, then checks again that the caller is still connected and still holds the lease, forwards the
    input as sent (with `tabId`, never `tab`), sends the input's reply (result or error) to the caller, and only then
    holds the lock for a **settle pause of 500 ms** before releasing it. No other actor's screenshot or `focusTab` can
    come between the focus and the input, nor inside the pause.*
  - *One deadline (#44) covers the lock wait, both forwards and the pause: the wait ends at the deadline with
    `LOCK_TIMEOUT {holder}`; each forward waits `deadline − now + 5000`; the pause is `min(500, deadline − now)` from
    the moment the input settles (0 when the deadline has passed). The reply is sent before the pause, so the pause
    never spends the caller's time. A known edge: an input that settles at or past the deadline (a slow extension or a
    short `timeoutMs`) gets a pause of 0, so no settle hold follows it. If the `focusTab` forward settles at or past the
    deadline, the input is not forwarded: the caller gets `TIMEOUT "Timed out before calling <method>"` and the lock
    is released at once, with no pause (no input was sent; S6-G2 fixer round 1).*
  - *The pause follows the input forward on every outcome, an error or `TIMEOUT` included (keys may already have
    been sent). If the `focusTab` forward fails, the input is not forwarded: the caller gets `focusTab`'s error and the
    lock is released at once, with no pause. If the caller disconnects or loses the lease between the forwards, the
    input is not forwarded (`NOT_CONNECTED "client disconnected"`, or `TAB_HELD`/`TAB_GONE` as for any call) and the
    lock is released at once; a disconnect during the pause frees the lock at once (`releaseAllOf`).*
  - *A new answer under contention (Stage 0 G-19): a trusted input now waits behind any lock holder and can answer
    `LOCK_TIMEOUT {holder}`, as a lock-taking call does. A trusted input with `focusEmulation: true`, and every
    untrusted input, take no lock and answer as before. A visible change besides that answer: a trusted input sent
    without its own `focusTab` (a raw client, or the SDK's `"none"` policy) now brings its tab to the front and focuses
    its window, as `focusFirst` does.*
  - *A client that calls `focusTab` itself first (the SDK's and the MCP's `focusFirst`, #89, #106) keeps working: its
    own `focusTab` takes and releases the lock as before; the input then focuses again under its own hold. The second
    focus is idempotent (`noteFocus`, `windows.update {focused}`, `tabs.update {active}`), costs one extra round trip,
    and cannot deadlock (the first acquisition ends before the second request waits). The screenshot's restore still
    runs after its own reply, outside the lock; the held focus keeps calling `noteFocus` (G-20), so a late restore does
    not undo it.*

### 6.5 The human

The human is an actor the daemon cannot model: they can click anything at any time, and their
active tab is theirs. Rules that follow: nothing the bridge does changes the active tab except a
screen-needing instruction (which restores it) or an explicit `focusTab`; and the MCP's current tab
does not follow the human (§8.3).

*Added 2026-10-24 (Step 9 S0; phase doc `docs/plans/2026-10-24-step9-phase-e-safety.md` 0.1–0.2;
decisions.md · 2026-10-24 · Phase E's design: the kill switch, the disarmed state, blocked sites, the
JavaScript switch (#128)): the human now also holds three controls, enforced in the extension — the kill
switch (toolbar button, keyboard shortcut, options page: disarmed refuses page calls with `DISARMED`), the
JavaScript switch (off refuses `evaluate`) and the block list (calls on a blocked site are refused
`DOMAIN_BLOCKED`). They are changed only by the human, through the extension's own UI — never by a client,
the daemon or a page (§10's Step 9 note).*

## 7. Screenshots

`chrome.tabs.captureVisibleTab` photographs *what is on screen in a window*; it cannot capture a
background tab. Two modes, both already partly in the code (`fullPage` goes through CDP today):

| Mode | How | Banner | Visible effect | Default for |
|---|---|---|---|---|
| **`switch`** (default) | under the visibility lock: remember the window's active tab → activate target → wait for activation (+ one frame) → `captureVisibleTab` → re-activate the previous tab | no | the tab flashes on screen for ~100–200 ms unless it was already active (then nothing switches) | MCP; humans watching Claude see exactly today's behaviour |
| **`cdp`** (opt-in) | `chrome.debugger` → `Page.captureScreenshot` on the background tab; no lock | yes (~100 ms attach) | none — the human's view is untouched | unattended scripts sharing Chrome with a human |

E2E must establish: `captureVisibleTab` on a *minimized* window (expected to fail — report
`WINDOW_MINIMIZED`), whether CDP renders a tab in a minimized window, and whether `switch` is reliable
across two windows (the lock is global; the activation is per window).

*Superseded 2026-10-23: was "`cdp` … on the background tab; … none — the human's view is untouched;
default for unattended scripts", because Step 7 Run 8 measured `Page.captureScreenshot` never returning
for a hidden tab (SCREEN-2: `TIMEOUT` after 35 s, banner up) or a minimized window (SCREEN-4: 25 s). As
built since Step 7 T5b, `cdp` refuses before attaching: `OFFSCREEN` for a tab that is not active in its
window, `WINDOW_MINIMIZED` for a minimized window (3 ms each, no banner; Run 9 R9-SCREEN-2/-4;
decisions.md · 2026-10-23 · T5b's three fixes). So `cdp` captures only a tab already in front of a
visible window, and today no mode captures a background tab without switching to it.*
*Corrected 2026-10-23: the `switch` row's "~100–200 ms" flash was measured at ~1.5 s (median 1493 ms,
Run 8 SCREEN-1; 1557 ms, Run 9 R9-SCREEN-1; page-side `visibilitychange` timestamps). `switch` works
across two windows without focusing either (R9-SCREEN-5), but a window fully covered by others never
yields a capture (`TIMEOUT`; the previous tab is restored at 30 s since T5b, R9-RESTORE).*

### 7.3 "Render a background tab as if it were active" — needs Chrome launch flags; a later step

CDP `Page.captureScreenshot` already forces the compositor to produce a frame for a background tab —
that *is* the `cdp` mode. What an extension cannot do is make `document.visibilityState` read
`"visible"`, un-throttle timers, or un-pause media for a tab that is not shown. Chrome exposes those
only as **launch flags** — `--disable-renderer-backgrounding`, `--disable-backgrounding-occluded-windows`,
`--disable-background-timer-throttling` — i.e. on the Chrome shortcut, not from inside the profile.
**Decision (2026-10-21): a separate future step** adds these flags to the user's Chrome shortcut (and
documents what each changes for the rest of the browser: battery, every background tab un-throttled),
so that `cdp`-mode scripts see a fully live background tab. Until then the `switch` mode is the way to
get a tab rendered exactly as the user would see it. The one adjacent lever available today is
`Emulation.setFocusEmulationEnabled`, which makes the page believe it has *focus* (Playwright uses it
to drive many pages in one headed browser) — that is the tool for trusted input into a background tab,
and it is on Step 7's E2E list.
*Corrected 2026-10-23: the first sentence did not hold. Run 8 SCREEN-2 measured a `cdp` capture of
a hidden background tab hanging (`TIMEOUT` after 35 012 ms; `T5-run-record.md`, SCREEN-2), so since T5b
`cdp` mode refuses such a tab at once with `OFFSCREEN` or `WINDOW_MINIMIZED` (decisions.md · 2026-10-23 ·
T5b's three fixes (#63)). Focus emulation was not on any run: no bridge method sends
`Emulation.setFocusEmulationEnabled`, so BG-1/BG-2's retry was recorded as not run and returns as a
proposed decision for Step 8 (decisions.md · 2026-10-22 · BG-1/BG-2's focus-emulation retry cannot run
in this wave (#61)). The three launch flags above did not fix trusted input either: a trusted click and
trusted typing into a background tab still answered `ok` and did nothing (Run 10 BGF-1/2; decisions.md ·
2026-10-23 · Chrome's anti-throttling flags do not fix background input (#66)).*
*Corrected 2026-10-24 (Step 8 S7): Step 8 stage FE added the lever (`focusEmulation: true` on trusted
`click`/`type`/`pressKey`) and measured it (Run 11): it does not deliver trusted input to a background
tab either — click 0/3, typing 2/3, key press 0/3 — while the target page reads `visible` during the
call. The SDK therefore focuses first (decisions.md · 2026-10-23 · The background-input policy (#89)).*

## 8. SDK and the MCP as its client

### 8.1 Shape

```ts
import { connect } from "@bridge/sdk";

const b = await connect({ name: "export-grades.ts" });     // knocks; starts the daemon if absent
const tab = await b.newTab("https://ada.blackboard.com/ultra/courses/_19192_1/outline");
await tab.waitFor({ role: "button", name: "Create" });
await tab.click({ role: "button", name: "Create" });
await tab.type({ role: "textbox", name: "Title" }, "Week 7", { trusted: true });
const rows = await tab.evaluate<{ id: string }[]>(`[...document.querySelectorAll("tr")].map(r => ({ id: r.id }))`);
await tab.download(url, "C:/exports/");
await b.close();
```

- Every action accepts a **ref** (`"e12"`) or a **locator** (`{role, name}`, `{text}`, `{css}`). A
  locator is resolved in the content script by the same walk that builds the snapshot (same role and
  accessible-name rules), so what Claude saw in a snapshot is what a locator matches.
- `tab.waitFor({locator})` is the primitive that makes scripts robust to SPAs.
- `tab.evaluate()` returns `EvalEnvelope.value`, typed by the caller; a `kind: "node"` result can be
  turned into a ref (`tab.refOf(result)`) — "find it with JS, act on it with trusted input".
- `b.tab()` is the actor's **cursor** (last created / selected), so `b.click(...)` without a tab works.

*Corrected 2026-10-24 (Step 8 S7), on what Step 8 built (as-built § S1, § S2, § S3; the sketch above
stays as written):*
- *`waitFor` takes a locator in its own arm, `tab.waitFor({locator, state?, timeoutMs?})`, beside
  `{text}`, `{networkIdle}` and `{seconds}`; `state: "hidden"` waits for it to go.*
- *The node → ref step is `tab.evaluateRef(expression)` (wire: `evaluate {asRef: true}` →
  `EvalEnvelope.ref`), not `tab.refOf(result)`; it marks the element with a `data-__bridge-mark`
  attribute that the content script resolves and removes (decisions.md · 2026-10-23 · S2's handler
  details … (#92)).*
- *`download(url, path)` takes a file or directory path; `{text}` matches visible text of any element
  past the snapshot's pruning gates, and `nth` is 0-based (decisions.md · 2026-10-23 · Locator rules,
  the MCP locator schema and the exported `BridgeError` (#83); · S1's locator details (#87)).*
- *The cursor changes only on `newTab`/`claim` and a 4002 reconnect; with none a call throws
  `NO_CURSOR`. Trusted `click`/`type`/`pressKey` focus the tab first (`focusFirst`, #89).*

*Corrected 2026-10-25 (Step 10 propagator), on what Step 10 added to the SDK (Step 10 as-built § S3, § S4):*
- *`tab.evaluateToFile(expression, {path, overwrite?, timeoutMs?})` → `{path, bytes, kind, sha256}` (and the
  client's cursor mirror) writes a value to a file without returning it; the value travels through an
  extension-side store in 1 MiB pulls (decisions.md · 2026-10-25 · Stage 0: `saveTo` uses transport (B), with
  tab-carrying pulls (#205); · S4: `saveTo`'s wire methods, refusals, store caps, SDK form and file finish (#218)).*
- *An action resolved from a locator past the snapshot's 800-element cap emits `client.on("warning", {tab, method,
  kind: "pastSnapshotCap"})`; `tab.locate()` returns the flag; no action's return type changed (decisions.md ·
  2026-10-25 · Stage 0: the cap warning reaches SDK actions as a client event (#206)). The public surface is still
  eight values.*
- *Corrected 2026-10-26 (cleanup pass), on what Step 11 added to the SDK (Step 11 as-built § S4, § S4b):
  `tab.upload(target, paths, {timeoutMs?})` (and the cursor's `client.upload`) puts local files into a file input;
  the SDK checks each path and sends its real path, and Chrome reads the files (`uploadFiles`, §10's Step 11 note;
  decisions.md · 2026-10-25 · Step 11: `Tab.upload`'s signature and result (#240); · S4: `prepareUpload` joins the
  `@bridge/sdk/download` subpath (#261)). The public surface is still eight values.*

### 8.2 Why "Claude writes the scripts" shifts polish toward errors

A human learns an API once and benefits from sugar daily. Claude writes each script fresh from the
**types + JSDoc** (that *is* its documentation) and then iterates on **whatever the error says**. So the
two investments that let Claude succeed in one or two iterations without a human are: a small
orthogonal API with precise types, and errors that contain the fix. Concretely a `BridgeError` has:

```
code:     LOCATOR_NOT_FOUND
message:  no button named "Create" on T3 (https://…/outline). Nearest: button "Create item",
          button "Create folder".
data:     { tab: "T3", url, locator, candidates: [...] }
snapshot: SnapshotResult            (attached by the SDK on failure, when attachable)
screenshot: "…/bridge-failures/2026-10-21T12-01-33-T3.png"
network:  NetworkEntry[]           (last 20 for the tab)
```

`error.message` plus `formatSnapshot(error.snapshot)` is what a script prints by default. The MCP
renders the same fields as text. Nothing here needs a model in the loop.

*Corrected 2026-10-24 (Step 8 S7), as built in S4–S6b:* *the fields are optional properties on the
shared `BridgeError` (no subclass): `snapshot`, `screenshotPath`, `network` (last 20), `attachErrors`
and `report()` (≤ 60 lines), attached only for `LOCATOR_NOT_FOUND LOCATOR_AMBIGUOUS REF_STALE OFFSCREEN
PAGE_ERROR NAV_FAILED TIMEOUT` within one 5 s budget; PNGs go to `BRIDGE_FAILURES_DIR`, else
`~/.browser-agent-bridge/failures/`. The attached snapshot renumbers the tab's refs, so candidate refs
are rewritten or dropped (#93). The screenshot switches the window to the failed tab (Run 12 REP-0).
The MCP renders `report()` plus a PNG image block; a report with an image is a non-error result,
because Claude Code drops images from error results (decisions.md · 2026-10-23 · An MCP failure report
with a screenshot is returned as a non-error result (#100)).*

*Updated 2026-10-30 (Step 14 S1):* *`report()`'s `Screenshot:` line prints a path under the home folder as
`~\…`; `screenshotPath` itself stays absolute (#417 (c)).*

### 8.3 MCP cursor semantics

- Actor name `claude-code #<pid>`; one MCP process per Claude Code session, as today.
- On the first tab-touching tool with no `tab` argument, the MCP **claims the active tab** and sets
  its cursor there. From then on the cursor **stays** — the human switching tabs does not move it.
- Every tool takes an optional `tab` (a handle from `browser_list_tabs`).
- New tools: `browser_use_active_tab` ("work in the tab I just opened": claims the current active tab
  and moves the cursor) and `browser_focus_tab` (bring the cursor's tab on screen, under the lock).
  `browser_select_tab {tab}` moves the cursor and claims, **without** activating on screen.
- `browser_status` reports the cursor, its lease, and whether it differs from the human's active tab.
- `browser_list_tabs` shows handles, owners (actor names) and the human's active marker.

*Corrected 2026-10-23 (Step 7 propagator): Step 7 T4 built these parts:*
- *the first-touch claim, and the cursor staying put;*
- *the optional `tab` on 18 tools;*
- *`browser_focus_tab`;*
- *`browser_select_tab` claiming without activating;*
- *`browser_list_tabs` printing `T3* [owner] Title — url`;*
- *a cursor lost on a 4002 reconnect or a new client, with a one-line notice (decisions.md ·
  2026-10-22 · T4's MCP cursor and tool details (#59)).*

*`browser_status` reports only the human's tab (`Active tab: [T<n>] …`). `browser_use_active_tab` and
the cursor/divergence lines are Step 8's. The tool count is 22 — see Step 7 as-built § Stage T4.*
*Corrected 2026-10-24 (Step 8 S7): Step 8 S5 built the rest — `browser_use_active_tab` (23 tools);
`browser_status` adds `Cursor:` and, only when it differs, `Human's active tab:` after the Step 7
lines, and never claims; the actions and `browser_wait_for` take a nested `locator`; `browser_new_tab`
comes to the front only when the cursor is the human's tab, else opens in the background and says so
(decisions.md · 2026-10-23 · S5's MCP details: `browser_new_tab` activation, the status lines, the
tool schemas, reports (#95)) — see Step 8 as-built § S5.*
*Corrected 2026-10-25 (Step 10 propagator): `browser_focus_tab` is no longer the only tool that brings a tab on
screen — since Step 10 S2 a trusted `browser_click`/`browser_type`/`browser_press_key` sends `focusTab` on its tab
first; the cursor does not move (decisions.md · 2026-10-24 · FE and `focusFirst` are ratified; the MCP's trusted
tools focus first too (#106); #214). Step 10 also added `browser_evaluate {saveTo, overwrite?}` and a warning line
on the six action tools for an element past the snapshot's cap (#127, #216); still 23 tools.*

## 9. Daemon lifecycle

1. **Knock.** A client connects to `127.0.0.1:9234`. `ECONNREFUSED` → it spawns the daemon.
2. **Detached spawn.** `spawn(process.execPath, [daemon/dist/index.js], { detached: true, stdio:
   "ignore", windowsHide: true })` + `unref()`. The daemon therefore has no stdio; it logs to
   `~/.browser-agent-bridge/daemon.log` (size-capped), counts only, never URLs or tokens.
   *Corrected 2026-10-22: as built the log is cut to its last 1 MiB on start and a line containing
   `://` or the token is withheld whole (decisions.md · 2026-10-22 · D3's daemon lifecycle: idle armed
   at start, every shutdown exits 0, bad env values, the log policy) — see as-built § Stage D3.*
3. **The bind is the lock.** Two starters that both saw `ECONNREFUSED` both spawn; the loser's daemon
   gets `EADDRINUSE` and exits at once; the loser client simply keeps knocking (up to 10 s).
   *Corrected 2026-10-22: as built the 10 s runs per spawn cycle and restarts at the client's own
   handover, and each attempt's WebSocket handshake is bounded by the remaining budget (decisions.md ·
   2026-10-22 · The knock's 10 s budget runs per spawn cycle, with a handshake timeout per attempt);
   the losing daemon exits 0 — see as-built § Stage D3, § Stage D4.*
4. **Hello / welcome.** Client → `{type:"hello", token, role:"client", name, build, proto: 2}`.
   Daemon → `{type:"welcome", build, proto, clientId, extensionConnected}`. Extension hellos carry no
   `role` and get the same `welcome` (the router ignores a message without `id`+`method`).
   *Corrected 2026-10-22: as built `clientId` is `"c<n>"` for a client (never reused within a daemon
   process) and `"extension"` for the extension; a failed hello closes with 4001 and the reason
   "expected hello handshake", "invalid token" or "unknown role"; a client waits at most 2 s for the
   welcome, then rejects with `VERSION` and neither spawns nor hands over (decisions.md · 2026-10-22 ·
   A Step 6 client gives up with VERSION when no welcome arrives — open for user review) — see
   as-built § Stage D2, § Stage D4.*
5. **Version handover.** `build` is the sha256 of `daemon/dist/index.js`. A client whose expected
   build (it hashes the file it would spawn) differs from `welcome.build` sends `daemon.shutdown`,
   waits for the port to free, spawns, reconnects. Other clients see their socket close and reconnect
   with the same logic — so after `npm run build` the first client to connect upgrades the daemon for
   everyone. The extension reconnects on its own (`ReconnectingClient`, 0.5–10 s backoff).
   *Corrected 2026-10-22: was "reconnect with the same logic"; as built a client reconnecting after
   4002 runs the knock **without** a handover — a build mismatch there rejects with `VERSION` naming
   both builds — so two clients on different builds cannot hand the daemon back and forth; `connect()`
   itself hands over at most once (decisions.md · 2026-10-22 · A reconnect after 4002 never hands the
   daemon over — open for user review; decisions.md · 2026-10-21 · One daemon handover per connect(),
   then a VERSION error). The daemon replies `{ok:true}`, closes every socket with 4002 "upgrading",
   waits ≤ 1 s, then terminates — see as-built § Stage D2, § Stage D4.*
6. **Idle exit.** Zero *clients* (the extension does not count) for 10 min → exit. Also `daemon.shutdown`.
   *Corrected 2026-10-22: as built the timer is also armed at start with zero clients, and idle,
   `daemon.shutdown` and signals all close the sockets (1001, or 4002 for `daemon.shutdown`) and exit 0
   (decisions.md · 2026-10-22 · D3's daemon lifecycle: idle armed at start, every shutdown exits 0, bad
   env values, the log policy) — see as-built § Stage D3.*
7. **Waiting for Chrome.** A fresh daemon has no extension yet; the SDK's `connect({ waitForExtensionMs })`
   waits for the `extensionStatus {connected:true}` event (default 15 s) before resolving, so a script
   does not start with `NOT_CONNECTED`. *Amended 2026-10-22: `connect({ requireExtension: false })`
   skips the wait and resolves on the welcome; the MCP uses it so that Chrome closed reads as before
   Step 6 (decisions.md · 2026-10-22 · #27, stage D5b).*
8. **Token.** Same token as the extension. Source of truth: `bridge.token` at the repo root (gitignored);
   `BRIDGE_TOKEN` env overrides (the MCP config still passes it that way). The daemon reads it the
   same way; a client that cannot find a token fails before knocking with a message naming both places.
   *Corrected 2026-10-22: as built that failure is a `NOT_CONNECTED` rejection of `connect()` (as are
   a missing daemon build, a bad `BRIDGE_PORT`, the 10 s give-up and a 4001 close), never naming the
   token (decisions.md · 2026-10-22 · The SDK reports configuration and connection failures as
   NOT_CONNECTED — open for user review); "repo root" is the first directory above the code whose
   `package.json` has `"workspaces"` — see as-built § Stage D4.*
9. **MCP exit-with-session** stays exactly as implemented in `lifecycle.ts`, moved to `mcp/`. The
   daemon gets none of it — it is meant to outlive sessions.

## 10. Protocol v2 (normative summary; `shared/src/protocol.ts` is the source)

```
hello    C→D  {type:"hello", token, role?: "extension"|"client", name?, build?, proto?: 2}
welcome  D→C  {type:"welcome", build, proto: 2, clientId, extensionConnected}
request  C→D  {id, method, params?, timeoutMs?}          (D→E: same, id remapped)
response D→C  {id, result} | {id, error:{code, message, data?}}
event    E→D  {event, params}   tabCreated | tabRemoved | tabReplaced | (later: console, navigation)
event    D→C  {event, params}   tabGone | leaseGranted | extensionStatus
```

*Added 2026-10-24 (Step 9 S0; decisions.md · 2026-10-24 · The safety state travels as two events and a
`daemon.status` field (#132)): the event lines above gain one name each — E→D `safetyState`, D→C
`safetyStatus` (both `{armed, evaluate, blockedCount}`; see the Step 9 note at the end of this section).
The block itself is left as written.*

- **Tab parameter.** Clients pass `tab: "T3"` (handle) in `params`; the daemon resolves it to
  `tabId: 412` before forwarding and strips the handle. The extension never sees handles.
- **Daemon-handled methods** (never forwarded): `daemon.status`, `daemon.shutdown`, `tabs.claim`,
  `tabs.release`. **Intercepted** (forwarded, then annotated/recorded): `listTabs` (adds handles,
  owners), `newTab` (mints a handle, leases it to the caller, sets nothing else), `closeTab`.
- **Error codes** (`shared/src/codes.ts`): daemon — `NOT_CONNECTED TIMEOUT UNKNOWN_METHOD BAD_PARAMS
  TAB_HELD TAB_GONE TAB_UNKNOWN LOCK_TIMEOUT VERSION`; extension — `REF_STALE LOCATOR_NOT_FOUND
  LOCATOR_AMBIGUOUS OFFSCREEN RESTRICTED_URL DEBUGGER_ATTACH DEBUGGER_CANCELLED DEBUGGER_DEVTOOLS
  PAGE_ERROR NAV_FAILED DOWNLOAD_HTTP WINDOW_MINIMIZED INTERNAL`. The extension's `Router` serialises a
  thrown `BridgeError {code, data}`; a plain `Error` becomes `INTERNAL` with its message, so nothing
  is lost during the migration.
  *Corrected 2026-10-24 (Step 9 propagator): was "the extension's `Router`"; as built since Step 9 S2a the service
  worker serves through `GatedRouter` (`extension/src/router.ts`), which runs the safety gate before dispatch and as
  a post-check before the reply, throws at registration for a method with no safety class, turns a gate throw into
  `INTERNAL`, and answers an unknown method `UNKNOWN_METHOD` in every state; `Router` is kept unchanged beside it —
  Step 9 as-built § Stage S2a; decisions.md · 2026-10-24 · S2a: the gated router sits beside the unchanged `Router`
  core (#169); · S2a: an unknown method is `UNKNOWN_METHOD` in every state (#170).*
  *Added 2026-10-23 (Step 8 S0; decisions.md · 2026-10-23 · `NO_CURSOR` enters `shared/src/codes.ts`
  as the 23rd code (#76)): SDK — `NO_CURSOR`, a `Tab`-less SDK call with no cursor ("call newTab() or
  claim() first"; §8). The SDK alone raises it, never the daemon or the extension, so it never
  travels on the wire from them; `shared/src/codes.ts` lists it in its own `SDK_ERROR_CODES`, beside
  the daemon and extension lists.*
- **Compatibility.** A v1 hello is accepted as an extension. A v1 error `{message}` from an old
  extension is wrapped as `INTERNAL`. Beyond that, extension and daemon of this generation ship
  together — nothing else speaks the protocol yet.
- *Corrected 2026-10-22 (as built in Step 6):* the error `code` is optional on the wire (`WireError
  {code?, message, data?}`; `fromWire` maps a missing code to `INTERNAL`) and the daemon always sends
  one (decisions.md · 2026-10-22 · D0's protocol shapes: optional wire code, strict v2 hello fields,
  events without id). `timeoutMs` stays on the envelope: the daemon waits `clamp(timeoutMs ?? 30000,
  100, 600000) + 5000` and forwards `{id, method, params}` only (decisions.md · 2026-10-22 · D2's daemon
  details: parseHello beside validateHello, BAD_PARAMS for bad ids, no forwarded timeoutMs, interim
  defaults). `daemon.status` returns `{build, uptime (ms), extensionConnected, clients:[{id, name,
  since}], port}`; any other `daemon.*` method answers `UNKNOWN_METHOD`; `tabs.claim`/`tabs.release` are
  not handled until Step 7 and are forwarded meanwhile. `extensionStatus {connected}` is `true` on each
  extension hello and `false` only when the current extension socket closes. Close codes, not listed
  above: 4001 on a failed hello, 4002 "upgrading" after `daemon.shutdown`, 1001 on idle exit or a
  signal — see as-built § Stage D0, § Stage D2, § Stage D3.
- *Corrected 2026-10-23 (Step 7 propagator): as built in Step 7, on the wire.*
  - *Hello: the extension sends `role:"extension", proto:2`. Without `proto` its tab calls get
    `VERSION` (#42).*
  - *Daemon-handled methods: `tabs.claim {tab | active:true}` → `{tab}` and `tabs.release` →
    `{ok:true}` are now handled.*
  - *Annotations: `newTab` → `{id, tab}`, in the background unless `active:true`. `listTabs` entries add
    `tab`, `owner?`, `current?`, `windowId` and `openerTabId?`. `daemon.status` adds `tabs` and `lock`.*
  - *The network "all" scope is forwarded as `{scope:"all"}` (#52).*
  - *Content-script errors travel as a returned `{__bridgeError:"CODE:message"}`, never a throw (#38).*
  - *The code count is unchanged at 22; `code` stays optional on the wire (decisions.md · 2026-10-22 ·
    v2 peers do not yet require `code` (#51)).*
    *Corrected 2026-10-23 (Step 8 S0): the count is 23 from Step 8 S0 on — `NO_CURSOR` joins as an
    SDK-only code (decisions.md · 2026-10-23 · `NO_CURSOR` enters `shared/src/codes.ts` as the 23rd
    code (#76)); the 22 daemon and extension codes are unchanged.*
  - *Compatibility: a Step 6 client keeps a legacy path for one release (#41, #54), which Step 8 S2
    removes.*
- *Corrected 2026-10-24 (Step 8 S7): as built in Step 8 S2b, on the wire (Step 8 as-built § S2b):*
  - *`tab` is required on every tab call and every unlisted method (`BAD_PARAMS "tab is required"`);
    network calls without `tab` or with "active" mean the human's tab; `selectTab` is answered
    `UNKNOWN_METHOD` by the daemon; any `id` on `closeTab`/`focusTab` is `BAD_PARAMS`. The legacy path
    is gone (it was removed by S2b, not S2).*
  - *`WireError.code` is required; a proto:2 error without one is delivered as `INTERNAL` and logged
    once per connection (decisions.md · 2026-10-23 · S2b makes `code` required on error frames (#73)).*
  - *The extension's hello carries `session` (§13), and the new method `locate {locator}` →
    `{ref, role, name}` is a tab method; actions take `ref` or `locator`.*
  - *The code count is 23: the 22 above plus the SDK-only `NO_CURSOR` (`shared/src/codes.ts`).*
- *Added 2026-10-24 (Step 9 S0; Phase E safety, phase doc `docs/plans/2026-10-24-step9-phase-e-safety.md`
  0.3–0.6; decisions.md · 2026-10-24 · The safety state travels as two events and a `daemon.status` field
  (#132); · The JavaScript switch reuses `DISARMED` with a scope (#133); · What `listTabs`, tab events and the
  daemon reveal while disarmed or for a blocked tab (#134)):*
  - *Two extension codes join, on the wire: `DISARMED` (the human turned the bridge off in Chrome, or turned
    JavaScript off for an `evaluate`) and `DOMAIN_BLOCKED` (the tab's URL, or the call's own target URL, is on
    the human's block list, or is one of the extension's own pages). The count is 25: 24 on the wire (9
    daemon + 15 extension) plus the SDK-only `NO_CURSOR`.*
    *Superseded 2026-10-25: was "`DISARMED` (… or turned JavaScript off for an `evaluate`) … The count is 25: 24 on
    the wire (9 daemon + 15 extension)", because Step 10 S4b adds `JS_DISABLED` for "JavaScript is off" (decisions.md
    · 2026-10-24 · The user rules on the 32 Step 9 open decisions; Step 9 closes (#202): #133 changed): the count is
    26, 25 on the wire (9 daemon + 16 extension) plus the SDK-only `NO_CURSOR`; see the Step 10 note at the end of
    this section.*
  - *`DISARMED` carries `data: {scope: "all" | "evaluate"}` — `"all"` for the kill switch, `"evaluate"` for
    `evaluate` (with or without `asRef`) while JavaScript is off (#133). `DOMAIN_BLOCKED` reveals no host or
    pattern in message or data.*
    *Superseded 2026-10-25: was "`"evaluate"` for `evaluate` … while JavaScript is off", because #202 changed #133:
    a Step 10 extension answers those calls `JS_DISABLED` and produces only `scope: "all"`; `"evaluate"` stays in
    the type for an old (Step 9) extension (see the Step 10 note at the end of this section).*
  - *Neither code is in the SDK's failure-report attach set (a report's calls would only be refused too).*
  - *Events: E→D `safetyState {armed, evaluate, blockedCount}` (`blockedCount` = the valid patterns only),
    sent each time the extension's connection comes up and on every change; D→C `safetyStatus` with the same
    params, relayed on every change. The state never rides the hello (#132). An older daemon counts and drops
    the unknown event; an older SDK ignores it.*
  - *`daemon.status` adds `safety: {armed, evaluate, blockedCount} | null` — null until the extension has
    reported, and null again after the extension socket closes (#132).*
    *Corrected 2026-10-24 (Step 9 propagator): was null only before the first report and after the socket closes;
    as built a new extension hello also resets it to null until that socket reports, `safetyStatus` is never sent
    with null, and the daemon's redaction follows the last non-null state across extension sockets — Step 9
    as-built § Stage S3; decisions.md · 2026-10-24 · S3: A new extension hello resets the reported state to null
    (#165); · S3: `safetyStatus` is never sent with null (#159); · S3: The daemon's redaction follows the last state
    it received, across extension sockets (#160).*
  - *A hidden tab: a `listTabs` row while disarmed, or for a blocked tab, drops `title` and `url` and adds
    `hidden: "disarmed" | "blocked"` (it keeps `id`, `windowId`, `active`, `openerTabId`, `current`, and the
    daemon's `tab`, `owner`); `tabRemoved` then carries `hidden` and no `lastUrl`/`lastTitle`; `tabCreated.url`
    is `""` in the same cases (no new field on `tabCreated`) (#134). The daemon, while the last state it
    received says disarmed, omits `url` from `daemon.status` rows and `lastUrl`/`lastTitle` from `tabGone`
    and `TAB_GONE`; `leaseGranted.url` is then `""` (#134).*
  - *No method of any layer arms, disarms, edits the block list or turns JavaScript on: only the human
    changes the safety state, in Chrome (§6.5).*
- *Added 2026-10-24 (Step 9 S0 fixer r1; the note above reads as a complete definition of both codes, but it is
  narrower than decisions.md · 2026-10-24 · Script URLs and the JavaScript switch; own pages of every extension
  (#138), which this note adds):*
  - *`DISARMED` with `data: {scope: "evaluate"}` also answers `navigate`/`newTab` to a `javascript:`, `data:` or
    `blob:` URL while JavaScript is off; while JavaScript is on, those navigations behave as before Step 9 (#138).*
    *Superseded 2026-10-25: was "`DISARMED` with `data: {scope: "evaluate"}` also answers", because #202 changed
    #133: from Step 10 S4b these navigations answer `JS_DISABLED` while JavaScript is off (the Step 10 note below).*
    *Corrected 2026-10-24 (Step 9 propagator): "behave as before" left Chrome's answer unmeasured; Run 13 measured
    it on Chrome 156: a `javascript:` navigation through the bridge with JavaScript on → `NAV_FAILED`, page unchanged
    (SAFE-6c, record) — Step 9 as-built § Stage S4 "Contracts".*
  - *`DOMAIN_BLOCKED` also answers `navigate`/`newTab` to **any** `chrome-extension://` URL (any extension id),
    and every method on a tab showing **this** extension's own page (by its `url` or `pendingUrl`); such a tab's
    `listTabs` row and events are hidden as a blocked tab's are. `chrome://` navigation is unchanged (#138).*
  - *"`DOMAIN_BLOCKED` reveals no host or pattern in message or data" comes from Stage 0's row SAFE-5
    (`docs/plans/2026-10-24-step9-phase-e-safety-steps/stage0-audit.md` §7: "`DOMAIN_BLOCKED` with no host or
    pattern in message/data"), not from #132–#134.*
  - *`leaseGranted.url` is `""` also for a tab opened onto a blocked URL, not only while disarmed (#134; phase
    doc 0.3's F40 note).*
- *Amended 2026-10-25 (Step 10 S4b, #202; phase doc `docs/plans/2026-10-24-step10-step8-follow-ups.md` 0.12 with
  its Stage 0 F17 note; decisions.md · 2026-10-24 · The user rules on the 32 Step 9 open decisions; Step 9 closes
  (#202), which changed · The JavaScript switch reuses `DISARMED` with a scope (#133)):*
  - *A new extension code joins, on the wire: `JS_DISABLED` — the human turned JavaScript off for the bridge in
    Chrome. The count is 26: 25 on the wire (9 daemon + 16 extension) plus the SDK-only `NO_CURSOR`.*
  - *Produced, while the bridge is armed and JavaScript is off, for exactly the calls that Step 9 answered
    `DISARMED {scope:"evaluate"}`: `evaluate` (with or without `asRef`), Step 10 S4's `evaluateSaveStart`,
    `evaluateSaveChunk` and `evaluateSaveEnd` (class `evaluate`, decisions.md #218), and `navigate`/`newTab` to a
    `javascript:`, `data:` or `blob:` URL (#138). Which methods are gated, and when, is unchanged; only the code
    and its wording change. Its message keeps Step 9's meaning (JavaScript is off; every other tool still works;
    ask the user) and names no URL, pattern, title or id; it carries no `data`.*
  - *While the bridge is off, `DISARMED` with `data: {scope: "all"}` wins over `JS_DISABLED`, for these calls as
    for every other. `DISARMED` keeps `data.scope` for compatibility; a Step 10 extension produces only `"all"`. An
    old (Step 9) extension may still send `DISARMED {scope:"evaluate"}`; the SDK and the MCP render it as the
    JavaScript-off line, and `SafetyScope` keeps its two values (Stage 0 F17).*
  - *`JS_DISABLED` is not in the SDK's failure-report attach set: the MCP renders it as one plain line, with no
    failure report and no screenshot.*
  - *With the bridge armed and JavaScript on, nothing changes.*
- *Corrected 2026-10-25 (Step 10 propagator; Step 10 as-built § S3, § S4): Step 10 also added, on the wire, three
  tab methods `evaluateSaveStart {tab, expression, timeoutMs?}` → `{id, bytes, kind}`, `evaluateSaveChunk {tab, id,
  offset, length?}` → `{data}` (base64, ≤ 1 MiB) and `evaluateSaveEnd {tab, id}` → `{released}` — lease-checked,
  no lock, safety class `evaluate`; a lost or expired id answers `INTERNAL Unknown or expired evaluateSave id: <id>`
  (decisions.md · 2026-10-25 · S4: `saveTo`'s wire methods, refusals, store caps, SDK form and file finish (#218));
  and an optional `pastSnapshotCap: true` on `locate`'s result and on the reply of an action resolved from a
  locator past the snapshot's 800th listable element, absent otherwise (decisions.md · 2026-10-25 · S3: the cap
  warning's edges as built (#216)). Both are open for the user at Step 10's gate.*
- *Amended 2026-10-25 (Step 11 S2; phase doc `docs/plans/2026-10-25-step11-file-upload.md` 0.4–0.6 with their
  Stage 0 notes; decisions.md · 2026-10-25 · Step 11: the safety class `upload` and the code `UPLOAD_REFUSED`
  (#237); · Step 11: the wire method `uploadFiles`, no visibility lock, no focus (#238); · Step 11: upload folders
  are a human-held allow-list in the extension, empty by default (#236); · Stage 0: matcher details — a POSIX path
  with a backslash is refused; ASCII-only case folding (#249); · Stage 0: uploads need Chrome's file access, and the
  bridge never opens or reads `file:` pages (#245)). All proposed, for the user at Step 11's gate:*
  - *A new extension code joins, on the wire: `UPLOAD_REFUSED` — a path given to `uploadFiles` is not strictly
    inside a folder the human allows for uploads in Chrome (the extension's options page, "Upload folders"; none by
    default, so every upload is refused until the human adds one). The count is 27: 26 on the wire (9 daemon + 17
    extension) plus the SDK-only `NO_CURSOR`. Its message is fixed and names no path, folder, count or file name; it
    carries no `data`; it is not in the SDK's failure-report attach set; the SDK and the MCP render it as one plain
    line. A refusal reveals only that a path is outside the folders, never which folders exist. A malformed `paths`
    (not an array, empty, more than 20 entries, an entry that is not a string) is refused the same way (#249).*
    *Amended 2026-10-25 (S4b verifier): the upload handler also answers `UPLOAD_REFUSED`, with its own fixed message,
    when the user has not allowed the extension file access in Chrome (#245 (b), S3); the SDK/MCP line names both
    causes (#263).*
  - *A new tab method: `uploadFiles {tab, ref | locator, paths: string[]}` → `{files: number}` (plus
    `pastSnapshotCap?: true` as every locator-resolved action since Step 10 S3). `paths` holds 1–20 absolute paths
    that Chrome itself opens (`DOM.setFileInputFiles`); no file bytes cross the wire (#235). `files` is the number of
    paths Chrome accepted, not proof that the page took them (#247). Lease-checked, no visibility lock, no focus.*
  - *Its safety class is `upload`: the state and the tab are tested as for class `tab` (disarmed →
    `DISARMED {scope:"all"}`; a blocked tab, this extension's own page or a `file:` page → `DOMAIN_BLOCKED`), then
    every path against the folder list → `UPLOAD_REFUSED`. Order: `DISARMED` > `DOMAIN_BLOCKED` > `UPLOAD_REFUSED` >
    the handler's own `BAD_PARAMS`. At receipt the folder rule runs even for a tab already gone, so a refused path
    answers `UPLOAD_REFUSED` where another class would reach the handler's `TAB_UNKNOWN` (#260). The JavaScript switch does not apply. The folder list lives in
    `chrome.storage.local` (`safety.uploadFolders`), is read per call, and a wrong-typed value refuses every call
    `DISARMED` as Step 9's keys do; no method of any layer reads or changes it. The safety state on the wire
    (`safetyState`, `safetyStatus`, `daemon.status.safety`) is unchanged: no folder count.*
  - *`DOMAIN_BLOCKED` also answers every call on a tab showing a `file:` page (by its `url` or `pendingUrl`, also
    wrapped in `blob:`/`filesystem:`/`view-source:`, the scheme in any case), and `navigate`/`newTab` to a `file:`
    URL, with fixed messages that name no path (#245 (a)). `listTabs` rows and tab events of a `file:` tab are not
    hidden by this rule.* *Superseded 2026-10-26 (Step 11b S0F-a, #288 3d): they are hidden — see the next note.*
  - *With the bridge armed, JavaScript on, an empty block list and no upload folders, every other method answers as
    before, except calls on or to `file:` pages.*
- *Amended 2026-10-26 (Step 11b S0F-a; phase doc `docs/plans/2026-10-26-step11b-block-list-redirects.md` 0.11;
  decisions.md · 2026-10-26 · The user rules Step 11's gate; Step 11 closes (#288) items 3b and 3d; · Stage 0's
  reconciled proposals adopted; S0F split; the download half is built (#296)). No method, code, event or field is
  added:*
  - *A `listTabs` row and every tab event of a tab showing a `file:` page (by `url` or `pendingUrl`, wrapped or in any
    case, as `DOMAIN_BLOCKED` reads it) are hidden exactly as a blocked tab's are (#134): the row drops `title` and
    `url` and carries `hidden: "blocked"`; `tabCreated` carries `url: ""`; `tabRemoved` drops `lastUrl` and
    `lastTitle` and carries `hidden: "blocked"`. The reason reuses `"blocked"` (no new `HiddenReason`), so the
    daemon forgets the cached url/title as for a blocked tab, and older clients read it unchanged.*
  - *An Upload folders line that is a home folder or a folder holding home folders (any drive's `Users`,
    `Documents and Settings` or its 8.3 alias `DOCUME~<n>`, and one name below it; `/home`, `/Users`, `/var/home`,
    `/System/Volumes/Data/Users`, and one name below each; `/root`, `/var/root`, `/private/var/root`; ASCII letters
    in any case) is invalid: the options page marks it with its own reason, which names no path, and the gate's
    matcher never uses it, also when it is already in `storage.local` (fails closed). A folder inside a home stays
    allowed. The `UPLOAD_REFUSED` answer and message are unchanged.*
- *Amended 2026-10-26 (Step 11b S0F-b; phase doc `docs/plans/2026-10-26-step11b-block-list-redirects.md` 0.11;
  decisions.md · 2026-10-26 · The user rules Step 11's gate; Step 11 closes (#288) item 3c, changing #284; · Stage 0's
  reconciled proposals adopted; S0F split; the download half is built (#296)). No method, code, event or field is
  added:*
  - *`uploadFiles` refuses a path that is not an existing file, and the page receives no file. After the file-access
    check (`UPLOAD_REFUSED`, #245 (b)) and before anything touches the page, the service worker fetches each path's
    `file:` URL in order: only status 200 with a readable first chunk counts as a file. A rejected fetch (missing, or
    unreadable: Chrome does not tell them apart), status 0 (a folder), and anything else (another status, a failed
    read, an entry still unanswered when the whole check's one 5 s deadline passes) refuse `BAD_PARAMS`, no `data`, with a fixed message naming the entry's index, never
    its path: `upload: paths[<i>] does not exist (or Chrome cannot read it); nothing was uploaded`, `upload:
    paths[<i>] is a folder, not a file — pass a file; nothing was uploaded`, `upload: paths[<i>] could not be checked
    as an existing file; nothing was uploaded`. Order: `DISARMED` > `DOMAIN_BLOCKED` > `UPLOAD_REFUSED` (folders,
    then file access) > this `BAD_PARAMS`. The file may still change between the check and Chrome's read (accepted,
    #296). The SDK's own preflight (#262) is unchanged and still answers first for an SDK or MCP call.*
- *Amended 2026-10-26 (Step 11b S3a; phase doc `docs/plans/2026-10-26-step11b-block-list-redirects.md` 0.3–0.6;
  decisions.md · 2026-10-26 · Step 11b: the rule set stays equal to the block list and fails closed (#292); · `newTab`
  stays uncovered until the user rules on opening it on `about:blank` (#295); · Stage 0's reconciled proposals adopted;
  S0F split; the download half is built (#296); · S2: the keeper is accepted; it re-syncs when the last live call ends;
  S3a bounds DNR calls (#301)). No method, code, event, field or message is added:*
  - *The block list now stops a covered call's redirect hops, not only its reply. While a `navigate`, `back` or
    `forward` runs, the extension holds Chrome session rules (`declarativeNetRequest`, the
    `declarativeNetRequestWithHostAccess` permission) that block the tab's top-level requests to every blocked host,
    built from the call's own read of the list; they go in after the gate's check before the first side effect and
    come out after the post-check, on every path. A list edit mid-call replaces them. A hop onto a blocked host is
    never requested; `navigate` still answers `DOMAIN_BLOCKED` with an existing block message (its post-check reads the
    blocked URL). `back`/`forward` holding rules wait for the load they start (at most 10 s, never an error) before they
    answer, so the rule outlives the hop. The human's own browsing, every other method and `newTab` (#295) are
    unchanged; `downloadStart` follows in S3b.* *(Superseded for `newTab` by the 2026-10-27 S6 note below.)*
  - *If a rule update fails, takes longer than 5 s, or the list needs more rules than Chrome allows, the covered call
    is refused before its side effect with the existing state-unreadable answer (`DISARMED {scope:"all"}`,
    `STATE_UNREADABLE_MESSAGE`), never Chrome's text; after a failed rebuild the running covered calls are refused
    that way and new ones too, until a rebuild or, once no covered call runs, a clear succeeds.*
- *Amended 2026-10-27 (cleanup pass; Step 11b S3b, `7580d59`; phase doc 0.6 and § As built S3b; decisions.md #302,
  #303). No method, code, event, field or message is added: `downloadStart` holds the typed download rules for its
  fetch; a blocked hop (`safety-hop.ts`, read before `ingest`, no URL kept) answers `DOMAIN_BLOCKED` with R14-5c's
  text; other failures keep today's answer (#303). The rebuild runs only on a block-list edit or an unreadable state
  (`rebuildsRules`, #302).*
- *Amended 2026-10-27 (Step 11b S6; phase doc § S6; decisions.md #311 item 2, #312). No method, code, event, field or
  message is added: `newTab` with a URL that is not `about:blank` is covered as `navigate` is. After the gate's checks
  on the URL Chrome will open (unchanged), the tab is created on `about:blank`, the gate re-checks and the tab's rules
  go in from that read's list; once the blank page has reported its own load (or 2 s passed), the tab is navigated to
  the URL and waited for as before (30 s, the same timeout message), so the wait ends on the URL's load, never on the
  blank page's; the rules come out after the post-check, on every path. If the install fails (or the re-check refuses, or the navigation call
  itself fails), the URL is never opened, the blank tab is closed, and the call answers the existing refusal
  (`DISARMED {scope:"all"}`, `STATE_UNREADABLE_MESSAGE`, for a failed install). The visible differences: the
  `tabCreated` event reads `url: "about:blank"` and the tab has one more history entry (§6.2's 2026-10-27 note).*
- *Note 2026-10-27 (Step 11b S8; S6 verifier N1/N3, decisions.md #313): "never on the blank page's load" above is slightly
  too strong. The wait ignores the blank page's own `complete` only while that event arrives within the 2 s settle; three
  narrow cases are unmeasured in Chrome (the blank page silent over 2 s then completing, a doubled blank `complete`, a
  `tabs.get` reading `complete` ahead of its event). Run 17b saw none of the first two: five 3 s pages answered after
  3074-3102 ms, `completes=1` (R17B-NEWTAB-LOAD); the third is not measured. R17B-RD-2: the blocked server saw 0 requests.*
- *Amended 2026-10-27 (Step 12 S2a; phase doc `docs/plans/2026-10-27-step12-phase-f.md` 0.4 with its Stage 0 note;
  decisions.md · 2026-10-27 · Step 12: `args` for evaluate is a function source called with one JSON value (#322),
  amended by · Stage 0: `args` crosses as a JSON string beside a function object (#330); · Stage 0: an `args` call is
  bounded by a debugger pause and terminate (#331); · Stage 0: an old extension is detected by its hello, not by the
  answer (#332). All proposed, for the user at Step 12's gate. No method, code or event is added; the methods keep
  their safety class `evaluate`):*
  - *`evaluate {tab, expression, timeoutMs?, asRef?, args?}` and `evaluateSaveStart {tab, expression, timeoutMs?,
    args?}` take an optional `args`, any JSON value (`null` included). Without the key, every call is byte for byte
    as before (the console-style expression, `replMode`, the `return` wrapper). With it, `expression` is a **function
    source** (`"(a) => a.rows.length"`, `"async (a) => …"`, `"function (a) { … }"`) called with `args` as its one
    argument, in one debugger session: the source alone is evaluated (`Runtime.evaluate`, in parentheses, no
    `replMode`, `timeout: timeoutMs`) to a function object; then `Runtime.callFunctionOn` on `globalThis` runs the fixed
    wrapper `function (fn, json) { return fn(JSON.parse(json)); }` with `arguments: [{objectId: <the function>},
    {value: JSON.stringify(args)}]`, `awaitPromise: true`, `userGesture: true`, the result kept by objectId and
    shaped by today's serialiser (`asRef` marks and mints a ref as before) or, for `evaluateSaveStart`, held by
    today's save path. `args` appears in no `expression` or `functionDeclaration`; the page receives exactly the
    sent JSON (key order, `null`s), and no page global is added (Stage 0 m1 run 5, B2). The `return` wrapper does
    not apply to a function source. A source that does not evaluate to a function is refused `BAD_PARAMS
    "args: with args, expression must be a function source such as \"(a) => a.rows.length\"; it evaluated to
    <type>"` (`<type>` is CDP's type name, never the value); a syntax error is today's `PAGE_ERROR`.
    The source is evaluated as the parenthesised expression `(<source>\n)`, so it must be one function expression
    with no trailing `;`: `"(a) => a.n;"` is a syntax error there and answers `PAGE_ERROR`, not the not-a-function
    refusal (`extension/src/evaluate/call.ts`, `functionSourceParams`; S2a verifier F2).*
  - *The caps and refusals live in one shared guard, `checkEvaluateArgs(args)` (`shared/src/protocol.ts`), which
    the extension calls before the tab is read and the SDK calls first (S2b). `args` must pass `JSON.stringify`
    with nothing dropped, thrown on or turned into `null` (a value its `toJSON` returns is what is checked; a `Map`
    or a class instance passes as the `{}`-like JSON it gives) and be at most `EVALUATE_ARGS_MAX_BYTES` (1 MiB, 1 048 576 bytes of UTF-8 JSON); else
    `BAD_PARAMS`, no `data`, with a fixed message that names the type or the size and never a part of the value:
    `args: the value holds undefined, which JSON cannot carry — use null, or leave the key out`;
    `args: the value holds a function, which JSON cannot carry — pass plain JSON data`;
    `args: the value holds a symbol, which JSON cannot carry — pass plain JSON data`;
    `args: the value holds a BigInt, which JSON cannot carry — pass it as a string or a number`;
    `args: the value holds NaN or an infinite number, which JSON turns into null — pass null or a string`;
    `args: the value holds a cycle (an object that contains itself), which JSON cannot carry`;
    `args: JSON.stringify threw on the value (a throwing toJSON or getter) — pass plain JSON data`;
    `args: the value is <n> bytes as JSON, over the 1 MiB cap (1048576 bytes)`.
    Over the wire only the size refusal can occur (a parsed frame holds JSON only); the others serve the SDK.*
  - *The bound (#331): the session runs `Debugger.enable` and `Debugger.setBreakpointsActive {active: false}` first,
    reads the function's own `scriptId` (`Runtime.getProperties`, `[[FunctionLocation]]`), and races the call against
    `timeoutMs` as today. At the deadline it sends `Debugger.pause` and waits at most 500 ms for `Debugger.paused`: if
    a paused frame is in the function's own script it sends `Debugger.resume {terminateOnResume: true}`, otherwise a
    plain `Debugger.resume`; with no paused event it resumes nothing. `Debugger.disable` is sent on every path before
    the detach. The answer at the deadline is today's `TIMEOUT` (`raceTimeout`'s text); a "terminated" reply maps to
    `TIMEOUT` as `evaluate`'s does today. Nothing from `Debugger.paused` is kept beyond that check or logged. A loop
    after an `await` is ended but its call never replies (m3 B10), so the race stays.*
  - *The extension's hello gains an optional `features: string[]`, validated by `isHello` when present (an array of
    strings), as `session` is; proto stays 2. A Step 12 extension sends `features: ["evaluateArgs"]`
    (`FEATURE_EVALUATE_ARGS`). An older daemon ignores the field (its hello check reads no unknown key).*
  - *The daemon's rule, built in S2b (#332): an `evaluate` or `evaluateSaveStart` carrying `args` is answered
    `VERSION` with the reload hint, without forwarding, when the connected extension's hello did not list
    `"evaluateArgs"`; every other call is unchanged. A real function result stays `kind: "function"`.*
  - *Note 2026-10-27 (Step 12 S2b, `9921715`; S2b verifier F2; decisions.md #342, proposed): as built, the daemon's
    reload text for this refusal is its own, `ARGS_RELOAD_HINT` (`daemon/src/intercept.ts`): "the Chrome extension is
    an older build without evaluate args — reload it at chrome://extensions (↻ on Browser Agent Bridge)"; a call
    "carries `args`" when the key is present, `null` included. The SDK adds a ninth fixed refusal before any wire call,
    `BAD_PARAMS` "args: pass the function source as a string, such as \"(a) => a.rows.length\" — not a function", for a
    non-string `fn` with `args`; the MCP tool runs `checkEvaluateArgs` itself.*
- *Amended 2026-10-27 (Step 12 S3a; phase doc `docs/plans/2026-10-27-step12-phase-f.md` 0.5 and 0.10 with its Stage 0
  note; decisions.md · 2026-10-27 · Step 12: `consoleMessages`: read on demand, the entry shape, class `tab` (#323),
  amended by · Stage 0: the console read — C1 on the tab's session, filtered before stripping (#333); · Stage 0:
  `consoleMessages` is class `evaluate` until the user rules (#334); · Step 12: how every item passes the safety gate
  (#327). All proposed, for the user at Step 12's gate. One method is added (28 router methods); no code or event):*
  - *`consoleMessages {tab, level?, limit?}` (the daemon forwards `tabId`) answers `{entries: ConsoleEntry[]}`, oldest
    first, newest last. `ConsoleEntry` is `{level, text, ts, kind}`: `level` one of `"error" | "warning" | "info" |
    "debug"` (`console.error`/`assert` and every uncaught error → `error`, `warning` → `warning`, `debug` → `debug`,
    every other console call → `info`); `text` at most `CONSOLE_TEXT_MAX` (2 000) characters, a cut text ending with
    `…`; `ts` the message's own time in ms since the epoch; `kind` `"console"` or `"exception"`. **No CDP-supplied source URL
    or stack** in any field (a description or preview value is cut at its first stack line); text the page itself
    logs (a string argument, say `err.stack`) is passed as logged. `level` keeps that level and every more severe one (absent: all four); `limit` is an
    integer 1–`CONSOLE_ENTRIES_MAX` (200), default 200, and keeps the newest. Anything else is `BAD_PARAMS`, no
    `data`: `consoleMessages: level must be one of "error", "warning", "info", "debug"` or `consoleMessages: limit
    must be an integer from 1 to 200` (`checkConsoleMessagesParams`, `shared/src/protocol.ts`).*
  - *The read: one debugger session on the tab (the tab's own target only; out-of-process frames are not read),
    `Runtime.enable` — Chrome replays the messages and uncaught errors it stored for the page, up to its own bound
    (Stage 0 m1 C1–C3) — a 100 ms settle, `Runtime.disable` on every path, then the detach; the whole read bounded
    at 10 s (today's `TIMEOUT` text). Never `Log.enable`, never `Runtime.discardConsoleEntries`. One top-level
    `chrome.debugger.onEvent` listener feeds the call's collector (`consoleAPICalled`, `exceptionThrown`,
    `exceptionRevoked`, `executionContextCreated`, no child session's event). Text comes from each argument's
    `value`, `unserializableValue`, `description` and `preview` only, never a page call; an exception's text is
    `exceptionDetails.text` and its exception's description, cut at the first stack line (`\n    at `).*
  - *The filters, before anything is stripped: an entry is dropped when any of its sources — a stack frame URL, the
    exception's `url`, a URL in the cut part of a description, the execution context's origin — is on the block list
    (read afresh after the read, as the network query reads it), one of this extension's pages, or `file:`; when it
    has no known source; when its exception was revoked; and when its time is before the latest arm this worker saw
    (its start, until it sees an arm).*
  - *Class `evaluate` in `METHOD_CLASSES` (#334): refused while disarmed (`DISARMED {scope:"all"}`), while
    JavaScript is off (`JS_DISABLED`; the replay can run a page's own Error `message` getter, m1 C8), and on a
    blocked, own or `file:` page (`DOMAIN_BLOCKED`, the existing messages), at receipt, before the attach and at the
    post-check, as `evaluate` is. A tab method in `daemon/src/methods.ts`: lease-checked, no visibility lock. No log
    line carries an entry. The banner shows during the call.*
- *Amended 2026-10-28 (Step 12 S5a; phase doc `docs/plans/2026-10-27-step12-phase-f.md` 0.7 and 0.10 with its Stage 0
  note; decisions.md · 2026-10-27 · Step 12: `uploadFiles {chooser: true}` intercepts the chooser only inside the call
  (#325), amended by · Stage 0: the chooser on the call's own session, with `Page.enable`; JavaScript off refuses it
  (#336); · Step 12: how every item passes the safety gate (#327); · Stage 0: the kept session's lifecycle; an
  overlapping call keeps today's answer (#335). All proposed, for the user at Step 12's gate. No method, code or event
  is added; `uploadFiles` keeps its class `upload`):*
  - *`uploadFiles {tab, ref | locator, paths, chooser?}`: `chooser` is optional; absent, `null` or `false`, every call
    is byte for byte as before. `chooser: true` means the target is an element whose click opens the page's native
    file chooser (a button, a link, a label, or the file input itself), not necessarily a file input. Any other value
    is `BAD_PARAMS "uploadFiles: chooser must be true or false"`. The reply is the same `{files}` (+
    `pastSnapshotCap`). `isUploadFilesParams` (`shared/src/protocol.ts`) accepts an optional boolean `chooser`.*
  - *One shared prologue runs first on both paths, in today's order: the params (`checkUploadParams`: a target, 1–20
    non-empty paths, the `chooser` value), the tab, the file-URL toggle check (`UPLOAD_REFUSED`,
    `NO_FILE_ACCESS_MESSAGE`, #245 (b)), the missing-file check (`BAD_PARAMS` naming `paths[<i>]`, #288 3c). The gate's
    Upload folders rule (#236, #237) and its tab rules run at receipt, before every first side effect and at the
    post-check for both paths, as today. The chooser path skips only the file-input target rule (`uploadInputOf`):
    its input is known from the chooser event, and its own input rules replace it (below).*
  - *Then, on the call's own debugger session (through the keeper, `withDebugger` "File upload", the call's gate
    re-check before the use), the whole leg bounded by today's 15 s (`uploadTimeoutMessage`): the content script marks
    the target element with this call's one-off upload mark (no file-input rule); `Page.enable`;
    `Page.setInterceptFileChooserDialog {enabled: true}`; `Page.getFrameTree`, `Page.createIsolatedWorld` (as
    today's finder); `Runtime.evaluate {userGesture: true}` in that isolated world, a closure-free clicker that finds
    the mark, removes it from every carrier and calls the element's `click()` (a non-HTML element gets a dispatched
    `click` event); a wait for `Page.fileChooserOpened` on the tab's own session (child sessions ignored; an event
    before the click is ignored), bounded at 5 s from the click's reply; the call's gate re-check again, after the
    event and before anything reads its input (a refusal here, a disarm or a block that landed during the wait, ends
    the chooser as below, with no `DOM.setFileInputFiles`); `DOM.describeNode {backendNodeId}`;
    `DOM.setFileInputFiles {files, backendNodeId}`. Then, on **every** path (success, refusal, error, timeout,
    disarm), `Page.setInterceptFileChooserDialog {enabled: false}` and `Page.disable` are sent (a failure of either is
    not reported, and it drops the kept session, S4b, #352). Any refusal or error after the interception was asked for
    also ends the use with an error, so the keeper detaches the session (#347): the chooser is ended by interception
    off and the detach, never by `files: []` (Stage 0 m2 E8). The page's transient activation starts with the click and
    ends no later than the 5 s wait, so a chooser cannot open after the interception is off (F16) — **by construction,
    unmeasured**: no Stage 0 row has a late opener and no source is cited. It needs a live late-opener row before S5
    ships: a front fixture tab whose clicked element opens its chooser by `setTimeout` at about 4.9 s and, in a second
    run, about 5.1 s after the click; pass rule: Chrome's own file dialog never shows on the screen.*
  - *A limit (by construction, unmeasured): the interception is the tab's, not the click's, and the call keeps the
    first top-level chooser event after its click. On a front tab, a chooser the human opens while the call's
    interception is on is taken: opened before the call's click, it is intercepted and ignored, so no dialog shows and
    it is freed only by the off step (the human's click seems to do nothing); opened after the click, within the 5 s
    wait and before the call's own chooser (or when the call's click opens none), it may receive the call's paths
    (always paths inside the Upload folders, into the input the human clicked). Behaviour is unchanged for this
    limit.*
  - *The refusals after the click, fixed, naming no path, raised inside the session as own refusals (unprefixed):
    no chooser within 5 s → `TIMEOUT "No file chooser opened within 5s of the click — target an element whose click
    opens the page's file chooser; nothing was uploaded"`; an event with no `backendNodeId` (a page picker such as
    `showOpenFilePicker`) → `BAD_PARAMS "the file chooser that opened belongs to no file input (a page file picker
    such as showOpenFilePicker); the bridge cannot fill it; nothing was uploaded"`; more than one path and an event
    `mode` other than `selectMultiple` → `SINGLE_FILE_INPUT_MESSAGE`; the node described with `webkitdirectory` →
    `DIRECTORY_INPUT_MESSAGE`, with `disabled` → `DISABLED_INPUT_MESSAGE`; the mark not found → `REF_STALE
    UPLOAD_MARK_GONE_MESSAGE`, several → `INTERNAL UPLOAD_MARK_NOT_UNIQUE_MESSAGE` (today's texts). A breakdown (no
    frame, no world, the clicker failed, no node description) is today's unmarked `INTERNAL "file upload: …; nothing
    was uploaded"`. The mark is swept on every failure path, as today.*
  - *One chooser call per tab at a time: a second `chooser: true` call on a tab whose chooser call has not ended
    answers `DEBUGGER_DEVTOOLS` with the text an overlapping debugger use answers today (#335), after the prologue and
    before any page call or attach.*
  - *The JavaScript switch (#336, the conservative reading): while JavaScript is off, an `uploadFiles` whose `chooser`
    is present and not `null` or `false` is refused `JS_DISABLED` (`JS_DISABLED_MESSAGE`, no `data`) by a params rule
    of class `upload` in the gate (`safety.ts`), in every phase, before the tab and folder tests, so no page call and
    no CDP command runs. Without `chooser`, JavaScript off still does not apply to `uploadFiles`. No path, file name or
    mark reaches a message or a log; the module adds no log call.*
- *Amended 2026-10-28 (Step 12 S5c; decisions.md · 2026-10-28 · S5b as built; an old extension's `chooser` is refused
  `VERSION` by a hello feature, as #332 (#355); the mechanism of the S2a/S2b notes above (#332, #342). Proposed, for
  the user at Step 12's gate. No method, code or event is added; proto stays 2):*
  - *A Step 12 extension's hello lists a second feature, `features: ["evaluateArgs", "uploadChooser"]`
    (`FEATURE_UPLOAD_CHOOSER = "uploadChooser"`, `shared/src/protocol.ts`).*
  - *The daemon's rule (`daemon/src/intercept.ts`): an `uploadFiles` carrying the `chooser` key (its presence counts,
    `null` and `false` included, as `args` under #342) is answered `VERSION` with its own reload text,
    `CHOOSER_RELOAD_HINT`: "the Chrome extension is an older build without the file chooser upload — reload it at
    chrome://extensions (↻ on Browser Agent Bridge)", without forwarding, when the connected extension's hello did not
    list `"uploadChooser"`. The text names no path. Every other call is unchanged; an `uploadFiles` without `chooser`
    is forwarded to a featureless extension as before.*
- *Amended 2026-10-28 (Step 12 S6-G2; decisions.md #321 Q6, #326, #338; proposed, for the user at Step 12's gate). No
  method, code, event or field is added: a trusted `click`/`type`/`pressKey` (no `focusEmulation: true`) holds the
  visibility lock from a daemon-forwarded `focusTab` through the input and a 500 ms pause after its reply (§6.4).
  `LOCK_TIMEOUT {holder}` is a new answer for these three methods under contention.*
- *Note 2026-10-29 (Step 12 S4; the kept debugger session, `extension/src/debugger-keeper.ts`, #335). The S2a and S3a
  notes above that read "then the detach" describe the keeper's release, not a detach per call. A call's session is kept
  per tab and reference-counted, and detached 5 s after its last use, or at once on a disarm, a block, a `file:` page, a
  close or a replace. The banner therefore stays up between calls in that window.*
- *Note 2026-10-29 (Step 13 S1; phase doc `docs/plans/2026-10-29-step13-phase-f-followups.md` 0.2 with its Stage 0
  note; decisions.md · 2026-10-29 · Stage 0: G1 by a join in the extension — `tabCreated.openerTabId` is the navigation
  source; no join, no grant (#385); · The user rules Step 12's gate; Step 12 closes (#374); · Stage 0: adding
  `webNavigation` is not a G13-2 matter (#393)). From S1 on, `tabCreated.openerTabId` names the tab whose page opened
  the new tab, not Chrome's `openerTabId`.*
  - *The worker holds a `tabCreated` whose tab has Chrome's `openerTabId` until that tab's
    `webNavigation.onCreatedNavigationTarget` arrives (either order) or 250 ms pass. Joined, the event carries
    `openerTabId` = the navigation event's `sourceTabId`; not joined, it carries no `openerTabId`. There is no fallback
    to Chrome's value, which names the window's active tab when the opener is a background tab.*
  - *The daemon's opener rule (`daemon/src/intercept.ts`) is unchanged: a new tab is leased to the client holding the
    tab named by `openerTabId`, never to the caller; no `openerTabId`, no grant. So a background opener's popup and a
    Ctrl+click or middle-click tab now go to the opener's holder, and an unjoined tab is granted to nobody.*
  - *No wire shape, event or router method changes; the manifest gains the `webNavigation` permission (#374). The
    worker keeps only tab ids from the navigation event, never its URL. An extension older than S1 sends Chrome's
    `openerTabId` as before.*
  - *`listTabs` rows still carry Chrome's own `openerTabId` (`extension/src/handlers/tabs.ts`), so a row and the
    tab's `tabCreated` can name different openers. No daemon, SDK or MCP path reads the row's `openerTabId`.*
  - *A limit: if the service worker restarts inside the 250 ms hold, the held `tabCreated` is lost, not only its grant.
    The daemon then learns of the tab from its next `listTabs` reply, which mints a handle leased to nobody.*
  - *Note 2026-10-30 (Step 13 closeout): in the bullet on `listTabs` rows above, "reads" means "acts on". The daemon's
    `listTabs` intercept relays each row's `openerTabId` unchanged to the client (`daemon/src/intercept.ts`, `listTabs`, the
    `{ ...t, tab: handle }` rows); no daemon, SDK or MCP path acts on it.*
- *Note 2026-10-29 (Step 13 S4; phase doc `docs/plans/2026-10-29-step13-phase-f-followups.md` 0.6 with its Stage 0
  note; decisions.md · 2026-10-29 · Stage 0: the second-chooser refusal keeps `DEBUGGER_DEVTOOLS` with its own fixed
  text (#389)). The S5a bullet above that reads "with the text an overlapping debugger use answers today (#335)" no
  longer holds: from S4 on, a second `chooser: true` call on a tab whose chooser call has not ended answers
  `DEBUGGER_DEVTOOLS` with its own fixed text, `CHOOSER_BUSY_MESSAGE` (`extension/src/handlers/upload.ts`): "uploadFiles:
  another file chooser upload is still running on this tab; retry after it ends". It names no DevTools, path or tab id.
  The code, the moment of the refusal (after the prologue, before any page call or attach) and every other
  `DEBUGGER_DEVTOOLS` text are unchanged. No method, code or event is added.*

  *See Step 7 as-built § Stage T0, § Stage T1, § Stage T2.*

## 11. Repository layout after the work

```
shared/     protocol v2 types + guards, error codes, (pure) locator types
extension/  unchanged structure; handlers take tabId; events; BridgeError; formatters removed
daemon/     ← server/ renamed: wsHost, connection, handshake, startup + registry, handles, leases,
            lock, intercept, idle, log; entry spawns nothing, just listens
sdk/        BridgeClient (knock/spawn/handover), Tab, locators, BridgeError, format/, download
mcp/        entry (stdio) + tools registry over the SDK + lifecycle.ts + config
recipes/    Claude-written scripts; first dogfood: a Blackboard export, and a one-line bb.js boot
```

`npm test` and `npm run typecheck` cover all five packages; `npm run build` builds daemon, mcp, sdk
and extension. Scripts run with `tsx` (dev dependency) until Node's type stripping is the floor.

*Corrected 2026-10-22: as built `daemon/` has no `startup.ts` (deleted in D5; the daemon never retries
the bind) and adds `main.ts`, `route.ts` and `build.ts`; `sdk/` has `connect.ts`, `knock.ts`,
`client.ts`, `transport.ts`, `spawn.ts`, `paths.ts`, `token.ts` and `download.ts`; `mcp/` adds `link.ts`
(the no-crash 5 s retry). `npm run build` builds daemon, mcp and extension only: `sdk/` has no build
step and is consumed as TypeScript source (bundled into the MCP; scripts run it with `tsx`) — see
as-built § Stage D1, § Stage D3, § Stage D5.*
*Corrected 2026-10-23 (Step 7 propagator): Step 7 added these files:*
- *`daemon/src/{handles,leases,lock,methods,intercept}.ts`;*
- *`sdk/src/format/{snapshot,network,index}.ts`;*
- *`mcp/src/cursor.ts`;*
- *in the extension, `errors.ts`, `tab-events.ts`, `network-scope.ts` and `content/guard.ts`;*
- *in `recipes/`, `reload-extension.ps1` and the E2E helpers.*

*The locator types in `shared/` are still Step 8's — see Step 7 as-built § Stage T1–T4,
§ "RELOAD-AUTO, Run 9, BG-FLAGS".*
*Corrected 2026-10-24 (Step 8 S7): Step 8 added the locator types (`shared/src/protocol.ts`);
`sdk/src/{tab,locator,error,report,policy}.ts`; `daemon/src/handle-mark.ts`; in the extension
`content/{a11y,locate,nearest,marked}.ts`, `handlers/{target,locate,locator-wait}.ts`,
`evaluate/mark.ts`, `trusted-input.ts`, `session-marker.ts`; and `recipes/{sdk-login,s6,fe}.ts` with
`recipes/blackboard/` — see Step 8 as-built.*
*Corrected 2026-10-25 (Step 10 propagator): Step 10 added `extension/src/evaluate-save-store.ts`,
`extension/src/evaluate/save.ts`, `extension/src/handlers/evaluate-save.ts`, `sdk/src/evaluate-save.ts`, the MCP
schema baseline `mcp/test/tool-schemas.ts` with its fixture, and the Run 14–15 helpers in `recipes/` (`s9-r14.ps1`,
`s10*`); it removed `recipes/blackboard/assemble-mcp.ts` and `transcript.ts` (#228) — see Step 10 as-built.*
*Corrected 2026-10-26 (cleanup pass): Step 11 added `extension/src/upload-paths.ts`, `extension/src/upload-files.ts`,
`extension/src/handlers/upload.ts`, `extension/src/content/upload-target.ts`, `sdk/src/upload.ts`, the `s11-*`
fixtures in `test-fixtures/` and Run 16's helpers in `recipes/` (`s11*`, `tsconfig.s11.json`) — see Step 11's
phase doc § As built.*

## 12. Risks and what E2E must settle

| Risk | Mitigation / what to measure |
|---|---|
| Trusted CDP input into a background tab behaves differently from an active one | E2E in Step 7; `Emulation.setFocusEmulationEnabled` is the lever if focus matters. Fallback: the SDK's `focus()` before trusted input. |
| `evaluate` code that needs document focus (clipboard) fails in a background tab | Already known (EVAL run 5); documented; `tab.focus()` exists for it. |
| Switch-shoot-restore flickers or races | Wait for `tabs.onActivated` + one frame before capture; measure; `cdp` mode is the escape. |
| Detached spawn on Windows leaves a console window or dies with the parent | `windowsHide`, `stdio: "ignore"`, `unref()`; test with the nvm shim in between, as for `lifecycle.ts`. |
| A stale daemon keeps running old code | Build-hash handover (§9.5); `daemon.status` prints the build and uptime. |
| Two daemons race for the port | The bind is the lock; the loser exits; verified by starting two scripts simultaneously. |
| Idle exit while a long script sleeps between calls | Idle counts *connections*, not calls; a connected client is never idle. |
| Handles leak | Dead handles are kept for the error message only and pruned after 1 h / 1 000 entries. |

*Corrected 2026-10-23 (Step 7 propagator), on what Step 7 measured:*
- *Row 1: trusted CDP input into a background tab answers `ok` and does nothing (Run 8 BG-1/BG-2). With
  the three launch flags of §7.3 it does the same (Run 10). Focus emulation is unmeasured. Step 8
  measures it before choosing between it and the `focus()` fallback (decisions.md · 2026-10-23 · The
  user rules on Run 8: fix stage T5b, then Run 9 (#62) item 4; · Chrome's anti-throttling flags do not
  fix background input (#66)).*
- *Row 3: the switch flashes for about 1.5 s. `cdp` mode is not an escape for a background tab, since
  it refuses one (§7 notes).*
- *A new risk, found by reading (T2 verifier V4): handles are keyed by Chrome tab id, and ids restart
  with each Chrome session. A daemon that outlives a Chrome restart can keep a leased handle live on a
  reused id, which may be the human's tab.*
*Corrected 2026-10-24 (Step 8 S7): row 1 — focus emulation was measured and does not fix it (Run 11),
so the SDK's `focus()` before trusted input is the policy (#89); the new risk is closed by the session
marker (§13).*
*Corrected 2026-10-25 (Step 10 propagator): row 1 — the MCP's trusted tools focus first too since Step 10 S2 (#106;
Run 15 MCPF-1R 9/9). Row 3 — Step 10's differential row SW-1R stayed undetermined, so `activateForCapture`'s
waits are unchanged and the ~1.5 s flash stays (decisions.md · 2026-10-25 · S7: Run 15 stands as recorded; its
follow-ups (#226) item 1).*
*Corrected 2026-10-26 (cleanup pass): row 3 — Run 16's SW-2 measured d = −24, 95, 68 ms in 3/3 after a warm-up:
the event ends the wait rather than running to its bound; the waits stay (decisions.md · 2026-10-26 · S5-liveA
closes with S5.5 and part of S5.6 failed as recorded; helper fixes before liveB (#282)).*

*See Step 7 as-built § T5, § Stage T2.*

## 13. Open questions (not blocking)

- Should `tabs.claim` on a held tab offer `{wait: true}` for the rare legitimate hand-over between a
  script and a Claude session? Decide after the first real collision.
- Token design beyond "one shared secret" — a separate direction, out of scope here.
- Generation-stamped refs (`s7.e12`) for stale-ref detection and read-only foreign snapshots.
- **Chrome launch flags for live background tabs** (§7.3) — a step of its own after Step 8: a
  documented shortcut change, plus `daemon.status` detecting whether Chrome runs with them.
  *Corrected 2026-10-23 (Step 7 propagator): Run 10 measured that the flags do not make trusted input
  work in a background tab (#66). If this step happens, its case rests on timers, media and
  `visibilityState`, and not on input.*
- *Added 2026-10-23 (Step 7 propagator):* should the extension's hello carry a session marker? On a
  new marker the daemon would retire every handle with `tabGone`, so that a handle never lands on a tab
  id that Chrome reused after a restart. This is T2 verifier V4, a proposal that is not yet decided and
  is contract-level (`docs/plans/2026-10-21-step7-multi-actor-tabs-steps/T2-verifier.md` V4).
  *Answered 2026-10-24 (Step 8 S7): yes. Step 8 S2b built it — the marker is kept across worker
  restarts and extension reloads and changes when Chrome starts; any change after the daemon's first
  extension hello retires every handle (`tabGone` to each holder, leases dropped, the lock untouched),
  and a new daemon never reuses a handle number (decisions.md · 2026-10-23 · The extension hello
  carries an optional session marker (#74); · The session marker's mechanism, amended (#80); · S2b's
  details: the `selectTab` refusal grep, the marker's edge cases, the handle mark (#94)). Measured in
  Run 12: an extension reload kept a held handle (SM-0); a Chrome restart left no handle minted before
  it listed, and the old handle answered `TAB_GONE` (SM-1, where `chrome://quit` had already closed the tab, so the restart retired 0).*
  *Updated 2026-10-25 (Step 10 propagator): the N ≥ 1 branch ran live — a killed Chrome retired 3 held handles
  (`tabGone` with the fixture URL, the old `Tab` → `TAB_GONE`), Run 15 RET-1R (#226 item 4).*
