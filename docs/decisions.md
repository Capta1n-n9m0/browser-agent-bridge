# Decisions — chrome-agent-bridge

Newest first. Format and rules: [`docs-writing-guide.md`](docs-writing-guide.md#decisions).
Cite an entry by date + title. Closed steps' entries are in `docs/decisions-archive/` (index below).

**Earlier decisions** (before 2026-10-21) live where they were made: the design specs in
`docs/specs/` and the step plans in `docs/plans/`. When one matters again, restate it here
as a dated entry and point back.

## Open decisions

None. Step 14's were ruled by #442; Step 15's shape is #443–#445.

## Standing decisions

A decision that still governs how we work or what the product promises: one line, its date and title, and where
its full entry lives. Entries that only
settled a build detail of one stage, or that a later entry replaced, are not listed; they stay in the archive.

**How we work**
- 2026-10-22 · Live E2E waves are run by Claude end to end (#33) — `decisions-archive/step6.md`
- 2026-10-23 · Later extension reloads use `recipes/reload-extension.ps1` (#65) — `decisions-archive/step7.md`
- 2026-10-24 · The roadmap after Step 8 (#129) — `decisions-archive/step9.md`; amended by #229 (the redirect-rule step after Step 11)
- 2026-10-24 · S4: Live runners return on every stop; one stop rule for sheet and brief (#193) — `decisions-archive/step9.md`
- 2026-10-25 · S5: `bb-login.ps1`'s post-submit wait — exit rules and the hard bound (#215) — `decisions-archive/step10.md`
- 2026-10-25 · Scratch worktrees never share `node_modules` through a junction a recursive delete can follow (#220) — `decisions-archive/step10.md`
- 2026-10-25 · Fresh agents instead of resumed ones (#225) — `decisions-archive/step10.md`
- 2026-10-25 · The user rules on Step 10's open decisions; Step 10 closes (#229) — `decisions-archive/step10.md`
- 2026-10-25 · Lean procedures: rules by pointer, package CLAUDE.md files, risk-tiered models (#230) — `decisions-archive/step11.md`
- 2026-10-25 · Commits carry exactly one trailer and no Claude-Session line (#231) — `decisions-archive/step11.md`
- 2026-10-25 · Gotchas follow the code they bind (#232) — `decisions-archive/step11.md`
- 2026-10-25 · Builders, fixers and live runners run Sonnet at medium effort from S5 on (#270) — `decisions-archive/step11.md`; amended by #289
- 2026-10-25 · S5 is split into seven slices; the stopped prep is salvaged per slice (#271) — `decisions-archive/step11.md`; its rule for small iterations is in `agent-rules.md` §7
- 2026-10-29 · S1: mutants and pre-slice runs never touch the main tree (#395) — `decisions-archive/step13.md`
- 2026-10-26 · Step agents never end their turn on a running child; commits carry the verifier's verdict (#286) — `decisions-archive/step11.md`; made permanent by #289; `agent-rules.md` §8, §10
- 2026-10-26 · How agents are run from Step 11b on; #286 stands; the cleanup pass's proposals applied (#289) — `decisions-archive/step11b.md`
- 2026-10-26 · Step 11b: the permission and the rule's scope ruled; Step 11's follow-ups become its stage S0F (#290) — `decisions-archive/step11b.md`
- 2026-10-26 · Stage 0 measures DNR in a separate scratch Chrome on a temporary profile (#294) — `decisions-archive/step11b.md`
- 2026-10-26 · Stage 0's incident: a stray `chrome.exe --version` reached the user's Chrome; never run Chrome without an own profile (#297) — `decisions-archive/step11b.md`; reported to the user 2026-10-27
- 2026-10-27 · The user rules Step 11b's gate: accept, `newTab` on `about:blank` (S6), then Run 17b (#311) — `decisions-archive/step11b.md`
- 2026-10-27 · The user rules #318 and the cleanup proposals; Step 11b closes (#320) — three fix rounds per stage, the size-cap overrun, wave prompts in `handoffs.md`, the read-only roles; `decisions-archive/step11b.md`; `agent-rules.md` §6, §7
- 2026-10-27 · The user rules Step 12's scope (G12-0) (#321) — `decisions-archive/step12.md`
- 2026-10-29 · The user rules Step 12's gate; Step 12 closes (#374) — `webNavigation` granted; no local path or name in new committed docs (`docs-writing-guide.md`); Step 13 = the Phase F follow-ups and Run 19's re-measurement; then a minimal Phase G for the user's own use; `decisions-archive/step12.md`
- 2026-10-30 · The user rules Step 13's gate; Step 13 closes (#420) — #417 (c): a reply to the calling client is not the log a LOGS row guards, the `~` path fix in Phase G; the wave's own options window is outside `DIALOGS`; next: a minimal Phase G for the user's Windows devices; `decisions-archive/step13.md`
- 2026-10-30 · The user rules Step 14's gate; Step 14 closes (#442) — the doctor's build heuristic kept; the clone
  command keeps the public GitHub URL (rule 9's exception)

**Product promises: the daemon, the clients and their lifecycle**
- 2026-10-21 · The actor name carries the MCP's own process id (#2) — `decisions-archive/step6.md`
- 2026-10-21 · One daemon handover per connect(), then a VERSION error (#10) — `decisions-archive/step6.md`
- 2026-10-21 · The SDK clears its cursor when it reconnects after a daemon restart (#11) — `decisions-archive/step6.md`
- 2026-10-22 · A Step 6 client gives up with VERSION when no welcome arrives (#13) — `decisions-archive/step6.md`
- 2026-10-22 · What clients do on a close code other than 4002 (#15) — `decisions-archive/step6.md`
- 2026-10-22 · The SDK reports configuration and connection failures as NOT_CONNECTED (#21) — `decisions-archive/step6.md`
- 2026-10-22 · A reconnect after 4002 never hands the daemon over (#22) — `decisions-archive/step6.md`
- 2026-10-22 · The knock's 10 s budget runs per spawn cycle, with a handshake timeout per attempt (#23) — `decisions-archive/step6.md`
- 2026-10-22 · BridgeClient exposes welcome, extensionConnected and on("reconnected") in Step 6 (#24) — `decisions-archive/step6.md`
- 2026-10-22 · D3's daemon lifecycle: idle armed at start, every shutdown exits 0, bad env values, the log policy (#25) — `decisions-archive/step6.md`
- 2026-10-22 · The MCP connects without waiting for the extension, so Chrome closed reads as today (#27) — `decisions-archive/step6.md`
- 2026-10-22 · setup.md documents stopping the daemon by killing its process, with no stop script (#29) — `decisions-archive/step6.md`
- 2026-10-22 · The daemon's method classes are one table, and the download methods are free (#39) — `decisions-archive/step7.md`

**Product promises: tabs, handles, leases, locators, the cursor and failure reports**
- 2026-10-22 · Content-script failures are returned, not thrown, to carry `CODE:message` (#38) — `decisions-archive/step7.md`
- 2026-10-22 · The `tab` parameter keeps its "all"/"active" meanings for the network tools (#40) — `decisions-archive/step7.md`
- 2026-10-22 · A stale extension is refused for tab calls, detected by its hello (#42) — `decisions-archive/step7.md`
- 2026-10-22 · "The human's tab" is the active tab of the last-focused normal window (#43) — `decisions-archive/step7.md`
- 2026-10-22 · One deadline per call covers the lock wait and the forwarded call (#44) — `decisions-archive/step7.md`
- 2026-10-22 · The formatters reach the MCP through a `@bridge/sdk/format` subpath (#46) — `decisions-archive/step7.md`
- 2026-10-22 · T1's extension details (#55) — `decisions-archive/step7.md`
- 2026-10-22 · T2's daemon details (#57) — `decisions-archive/step7.md`
- 2026-10-22 · T3's snapshot fields and capture rules (#58) — `decisions-archive/step7.md`
- 2026-10-22 · T4's MCP cursor and tool details (#59) — `decisions-archive/step7.md`
- 2026-10-23 · T5b's three fixes (#63) — `decisions-archive/step7.md`
- 2026-10-23 · S2b makes `code` required on error frames (#73) — `decisions-archive/step8.md`; ratified 2026-10-24 (#108)
- 2026-10-23 · S3.4 applies as written: the main entry also re-exports the formatters (#75) — `decisions-archive/step8.md`; ratified 2026-10-24 (#110)
- 2026-10-23 · `NO_CURSOR` enters `shared/src/codes.ts` as the 23rd code (#76) — `decisions-archive/step8.md`; ratified 2026-10-24 (#111)
- 2026-10-23 · A new daemon never reuses a handle number; the SDK guards stale `Tab`s (#79) — `decisions-archive/step8.md`; ratified 2026-10-24 (#112)
- 2026-10-23 · The session marker's mechanism, amended (#80) — `decisions-archive/step8.md`; ratified 2026-10-24 (#109)
- 2026-10-23 · The Chrome `id` stays beside `tab` this step; network calls without `tab` stay "active" (#81) — `decisions-archive/step8.md`; ratified 2026-10-24 (#113)
- 2026-10-23 · Page-function failures may carry `data` beside the marker (#82) — `decisions-archive/step8.md`; ratified 2026-10-24 (#114)
- 2026-10-23 · Locator rules, the MCP locator schema and the exported `BridgeError` (#83) — `decisions-archive/step8.md`; ratified 2026-10-24 (#115)
- 2026-10-23 · S1's locator details (#87) — `decisions-archive/step8.md`; ratified 2026-10-24 with a cap warning added (#117)
- 2026-10-23 · The SDK `Tab` surface details and the cursor rule as built (#90) — `decisions-archive/step8.md`; ratified 2026-10-24 (#118)
- 2026-10-23 · S2's handler details: the mark rides the serialiser, `pressKey` takes a target, `waitFor {locator}` rules (#92) — `decisions-archive/step8.md`
- 2026-10-23 · S4's failure-report details, and how the MCP reaches them (#93) — `decisions-archive/step8.md`; ratified 2026-10-24 (#120)
- 2026-10-23 · S2b's details: the `selectTab` refusal grep, the marker's edge cases, the handle mark (#94) — `decisions-archive/step8.md`; ratified 2026-10-24 (#121)
- 2026-10-23 · S5's MCP details: `browser_new_tab` activation, the status lines, the tool schemas, reports (#95) — `decisions-archive/step8.md`; ratified 2026-10-24 (#122)
- 2026-10-24 · The Step 6 surface names stay, marked experimental (#119) — `decisions-archive/step8.md`
- 2026-10-24 · Failure reports stay on by default (#120) — `decisions-archive/step8.md`
- 2026-10-24 · `evaluate {asRef}` on a non-element stays an error (#123) — `decisions-archive/step8.md`
- 2026-10-25 · S7: Run 15 stands as recorded; its follow-ups (#226) — `decisions-archive/step10.md`
- 2026-10-29 · Stage 0: G1 by a join in the extension — `tabCreated.openerTabId` is the navigation source; no join, no grant (#385) — `decisions-archive/step13.md`; kept by #420
- 2026-10-29 · `evaluate`'s value keeps the page's key order: the serialiser's envelope crosses as a JSON string (#377) — `decisions-archive/step13.md`; built by #386, narrowed by #396 (page `toJSON` hooks never reach `value`)
- 2026-10-29 · The console texts: newest lines kept with a cut marker (#379) — `decisions-archive/step13.md`; the cap's marker wording by #398

**Product promises: background input, the screen and the MCP result shape**
- 2026-10-23 · The background-input policy (#89) — `decisions-archive/step8.md`; ratified 2026-10-24 (#106)
- 2026-10-24 · An MCP failure report with a screenshot stays a non-error result, re-probed on each Claude Code upgrade (#124) — `decisions-archive/step8.md`
- 2026-10-24 · FE and `focusFirst` are ratified; the MCP's trusted tools focus first too (#106) — `decisions-archive/step8.md`
- 2026-10-29 · Stage 0: the second-chooser refusal keeps `DEBUGGER_DEVTOOLS` with its own fixed text (#389) — `decisions-archive/step13.md`; kept by #420

**Product promises: the safety gate**
- 2026-10-24 · Phase E's design: the kill switch, the disarmed state, blocked sites, the JavaScript switch (#128) — `decisions-archive/step9.md`
- 2026-10-24 · The safety state travels as two events and a `daemon.status` field (#132) — `decisions-archive/step9.md`
- 2026-10-24 · What `listTabs`, tab events and the daemon reveal while disarmed or for a blocked tab (#134) — `decisions-archive/step9.md`
- 2026-10-24 · The block-list grammar (#135) — `decisions-archive/step9.md`
- 2026-10-24 · `tabs.claim` on a blocked tab is granted, every call on it refused (#136) — `decisions-archive/step9.md`
- 2026-10-24 · In-flight work at disarm and on a newly blocked tab (#137) — `decisions-archive/step9.md`
- 2026-10-24 · Script URLs and the JavaScript switch; own pages of every extension (#138) — `decisions-archive/step9.md`; script URLs with JavaScript off answer `JS_DISABLED` since #202/#219
- 2026-10-24 · The state is read per call, fails closed, and is locked to trusted contexts (#139) — `decisions-archive/step9.md`
- 2026-10-24 · `downloadStart` and redirects onto a blocked host (#140) — `decisions-archive/step9.md`; ruled by #202, and its network-rule step placed after Step 11 by #229; built in Step 11b (#290, #292, #296); the gate ruled by #311; `newTab` covered by opening `about:blank` first (S6, #314), measured by Run 17b (#318)
- 2026-10-24 · The shortcut is `_execute_action` (#142) — `decisions-archive/step9.md`
- 2026-10-24 · Badge and title (#143) — `decisions-archive/step9.md`
- 2026-10-24 · A re-arm right after a disarm is ignored (#144) — `decisions-archive/step9.md`
- 2026-10-24 · The SDK's `TabInfo` keeps `title` and `url` as strings and gains an optional `hidden` (#148) — `decisions-archive/step9.md`
- 2026-10-24 · S1: Rule 7 unwraps wrapper URLs and compares case-insensitively (#153) — `decisions-archive/step9.md`
- 2026-10-24 · S1: `downloadStart` checks its own URL against the block list only (#154) — `decisions-archive/step9.md`
- 2026-10-24 · S1: The network filter treats a tab showing this extension's own page as blocked (#155) — `decisions-archive/step9.md`
- 2026-10-24 · S1: Matcher details §5 leaves implicit (#156) — `decisions-archive/step9.md`
- 2026-10-24 · S1: The refusal messages (#158) — `decisions-archive/step9.md`
- 2026-10-24 · S3: `safetyStatus` is never sent with null (#159) — `decisions-archive/step9.md`
- 2026-10-24 · S3: The daemon's redaction follows the last state it received, across extension sockets (#160) — `decisions-archive/step9.md`
- 2026-10-24 · S3: `leaseGranted.url` is `""` while disarmed, whatever the event carried (#161) — `decisions-archive/step9.md`
- 2026-10-24 · S3: `browser_status`'s Safety line is a second text item, shown only while the extension is connected (#162) — `decisions-archive/step9.md`
- 2026-10-24 · S3: Safety refusals get no `report` property; the wording is `safetyRefusalLine` on `@bridge/sdk/report` (#163) — `decisions-archive/step9.md`
- 2026-10-24 · S3: The refusal wording (#164) — `decisions-archive/step9.md`; the JavaScript-off line is `JS_DISABLED` since #202/#219
- 2026-10-24 · S3: The SDK exports the types `SafetyState` and `HiddenReason` (#168) — `decisions-archive/step9.md`
- 2026-10-24 · S2a: an unknown method is `UNKNOWN_METHOD` in every state (#170) — `decisions-archive/step9.md`
- 2026-10-24 · S2a: storage keys, and a wrong-typed value makes the state unreadable (#171) — `decisions-archive/step9.md`
- 2026-10-24 · S2a: the offscreen document accepts only this extension's non-tab senders (#173) — `decisions-archive/step9.md`
- 2026-10-24 · S2a: a disarm whose write fails twice returns `"write-failed"` and stays disarmed in memory (#174) — `decisions-archive/step9.md`
- 2026-10-24 · S2a: `navigate`/`newTab` are gated on the URL Chrome will open (#175) — `decisions-archive/step9.md`
- 2026-10-24 · S2a: a disarm held in memory wins over a storage read (#176) — `decisions-archive/step9.md`
- 2026-10-24 · S2a: a capture whose window showed another tab is refused `OFFSCREEN` (#177) — `decisions-archive/step9.md`
- 2026-10-24 · S2a: the post-check also replaces error replies; `listTabs` with an unreadable state is refused, and has no post-check (#178) — `decisions-archive/step9.md`
- 2026-10-24 · S2a: the network ingest drops a request for good once one of its events was dropped (#179) — `decisions-archive/step9.md`
- 2026-10-24 · S2a: no `safetyState` is sent while the state cannot be read (#180) — `decisions-archive/step9.md`
- 2026-10-24 · S2b: the writers test refuses `storage.local.remove`/`clear` everywhere (#188) — `decisions-archive/step9.md`
- 2026-10-24 · The user rules on the 32 Step 9 open decisions; Step 9 closes (#202) — `decisions-archive/step9.md`
- 2026-10-25 · S4b: `JS_DISABLED`'s wire shape and the SDK line for an old extension (#219) — `decisions-archive/step10.md`
- 2026-10-26 · Step 11b: the rule set stays equal to the block list and fails closed (#292) — `decisions-archive/step11b.md`
- 2026-10-26 · Step 11b: the bridge's answers when a hop is blocked stay as today (#293) — `decisions-archive/step11b.md`
- 2026-10-26 · S1: a default-port pattern makes two regex rules; an over-long regex fails closed (#300) — `decisions-archive/step11b.md`
- 2026-10-27 · `newTab` with a URL opens `about:blank` first (#295 as ruled by #311; built S6, #312–#314) — `decisions-archive/step11b.md`
- 2026-10-27 · Run 17's STOP predates Step 11b: Chrome's `back` skips pages with no user activation … (#308) — a bridge `back`/`forward` reaches only pages a human or an activating call acted on; `decisions-archive/step11b.md`

**Product promises: bulk data, `saveTo`, the cap warning and the schema baseline**
- 2026-10-24 · Bulk data through `browser_evaluate` was a test device only; the MCP gets a `saveTo` path (#127) — `decisions-archive/step8.md`
- 2026-10-25 · Stage 0: `saveTo` uses transport (B), with tab-carrying pulls (#205) — `decisions-archive/step10.md`
- 2026-10-25 · Stage 0: the cap warning reaches SDK actions as a client event (#206) — `decisions-archive/step10.md`
- 2026-10-25 · Stage 0: `saveTo`'s file rules are stricter than `browser_download`'s (#207) — `decisions-archive/step10.md`
- 2026-10-25 · S2: the MCP schema baseline, a failed focus's answer, and the focus sentence (#214) — `decisions-archive/step10.md`
- 2026-10-25 · S3: the cap warning's edges as built (#216) — `decisions-archive/step10.md`
- 2026-10-25 · S4: a primitive completion value crosses the CDP leg whole; S7 measures it (#217) — `decisions-archive/step10.md`
- 2026-10-25 · S4: `saveTo`'s wire methods, refusals, store caps, SDK form and file finish (#218) — `decisions-archive/step10.md`
- 2026-10-25 · S7: SAVE-REFUSE's `[chrome.debugger] ` prefix — the product stays for now; a fix is offered (#227) — `decisions-archive/step10.md`; ruled 2026-10-25: option (b) (#229)

**Product promises: uploads and local files**
- 2026-10-25 · Step 11: the upload is `Tab.upload` / `browser_upload_file` through `DOM.setFileInputFiles` (#234) — `decisions-archive/step11.md`
- 2026-10-25 · Step 11: paths cross the wire, never bytes (#235) — `decisions-archive/step11.md`
- 2026-10-25 · Step 11: upload folders are a human-held allow-list in the extension, empty by default (#236) — `decisions-archive/step11.md`
- 2026-10-25 · Step 11: the safety class `upload` and the code `UPLOAD_REFUSED` (#237) — `decisions-archive/step11.md`
- 2026-10-25 · Step 11: the wire method `uploadFiles`, no visibility lock, no focus (#238) — `decisions-archive/step11.md`; UP-1 passed on a background tab (#284)
- 2026-10-25 · Step 11: `Tab.upload`'s signature and result (#240) — `decisions-archive/step11.md`
- 2026-10-25 · Step 11: the MCP tool `browser_upload_file` (#241) — `decisions-archive/step11.md`
- 2026-10-25 · Step 11: nothing logs an upload path, and the rest of the safety boundary is unchanged (#242) — `decisions-archive/step11.md`; accepted at the gate (#288)
- 2026-10-25 · Stage 0: uploads need Chrome's file access, and the bridge never opens or reads `file:` pages (#245) — `decisions-archive/step11.md`; kept by #288
- 2026-10-25 · Stage 0: a `webkitdirectory` input is refused; `files` is the count Chrome accepted (#247) — `decisions-archive/step11.md`
- 2026-10-25 · Stage 0: who the folder rule protects against, and the broad-folder warning (#250) — `decisions-archive/step11.md`; changed by #288 (a home folder, or a folder of home folders, is refused as an Upload folder); built in S0F-a (#298)
- 2026-10-25 · S2: the `paths` cap, the exact messages, and the folder-line rules (#257) — `decisions-archive/step11.md`
- 2026-10-25 · S2: the `file:` rule's edges (#259) — `decisions-archive/step11.md`; changed by #288 (`listTabs` rows and tab events of a `file:` tab drop `title` and `url` and carry `hidden`); built in S0F-a (#298)
- 2026-10-26 · S5-liveB: the upload works on a background tab; a raw missing-file upload answers ok (#284) — `decisions-archive/step11.md`; changed by #288 (a missing file is an error in the extension too); built in S0F-b (#299)
- 2026-10-26 · The user rules Step 11's gate; Step 11 closes (#288) — `decisions-archive/step11.md`

## Archive

When a step closes, its entries move to `docs/decisions-archive/` with their numbers unchanged.

| File | Step | Numbers | Entries | Dates |
|---|---|---|---|---|
| [`step6.md`](decisions-archive/step6.md) | Step 6: the persistent daemon and protocol v2 | #1–#36 (incl. #2b) | 37 | 2026-10-21 → 2026-10-22 |
| [`step7.md`](decisions-archive/step7.md) | Step 7: multi-actor tabs | #37–#69 | 33 | 2026-10-22 → 2026-10-23 |
| [`step8.md`](decisions-archive/step8.md) | Step 8: the SDK surface and the MCP cursor | #70–#127 | 58 | 2026-10-23 → 2026-10-24 |
| [`step9.md`](decisions-archive/step9.md) | Step 9: Phase E safety | #128–#200, #202 | 74 | 2026-10-24 → 2026-10-24 |
| [`step10.md`](decisions-archive/step10.md) | Step 10: the Step 8 follow-ups | #201, #203–#229 | 28 | 2026-10-24 → 2026-10-25 |
| [`step11.md`](decisions-archive/step11.md) | Step 11: D3 file upload (and the lean procedures) | #230–#264, #266–#288 | 58 | 2026-10-25 → 2026-10-26 |
| [`step11b.md`](decisions-archive/step11b.md) | Step 11b: the block list stops redirected requests | #289–#320 | 32 | 2026-10-26 → 2026-10-27 |
| [`step12.md`](decisions-archive/step12.md) | Step 12: Phase F, ergonomics | #321–#374 | 54 | 2026-10-27 → 2026-10-29 |
| [`step13.md`](decisions-archive/step13.md) | Step 13: the Phase F follow-ups and Run 20 | #375–#420 | 46 | 2026-10-29 → 2026-10-30 |

## Log

The current step's entries, newest first. Step 13's (#375–#420) are in `decisions-archive/step13.md`, Step 12's
(#321–#374) in `decisions-archive/step12.md`. The next entry is 446.

### 2026-11-08 · Distribution to a wider audience: the shape of Step 15 (#445)
**Decided (user),** in chat 2026-11-03 → 2026-11-08:
1. **Audience:** less technical people first; the developer route (npm, the SDK, a clone) stays open.
2. **Platforms:** Windows, macOS and Linux. A friend ran it on macOS and the user on a Linux server over an SSH
   tunnel; both worked.
3. **npm:** the daemon, the MCP server and the SDK are published to npm.
4. **The extension:** a zip on GitHub Releases (unpacked) and a **public** Chrome Web Store listing, signed by the
   store; no self-signed `.crx`. If the store refuses, the product stays on GitHub. The user has a developer account.
5. **GitHub Releases carry everything:** the extension zip, the npm package and the installers.
6. **Installers for less technical people:** a Claude Desktop extension (`.mcpb`), a standalone program per OS, or
   both; Step 15's audit proposes which.
7. **A fixed extension ID is required**, and with it pairing without a pasted token (native messaging) is required
   for the non-technical path.
8. **The README is rewritten about the product,** with the security model in plain words; development history becomes
   a short section near the end.
9. **U.1 is dropped:** the macOS and Linux runs cover it, and the install steps change with Step 15.
**Why:** the user's rulings. **Instead of:** unpacked-only for the user's own devices (#374 item 11, #426).
**Revisit if:** the Web Store refuses the listing (then GitHub only, item 4). **By:** user

### 2026-11-08 · The product is renamed Browser Agent Bridge (#444)
**Decided (user):** the product is **Browser Agent Bridge** ("Browser Agent Bridge (for Chrome)" in the Web Store),
npm package `browser-agent-bridge`, npm org `@browser-agent-bridge`, GitHub repo `Capta1n-n9m0/browser-agent-bridge`.
Chrome comes first; other browsers later. **Done 2026-11-08:** the repo renamed with `gh repo rename` (the old URL
redirects) and the local remote updated; a placeholder `browser-agent-bridge@0.0.1` (README and license only)
submitted by the user and held by npm's staged publishing, with the name already owned by the user's account. Renaming
inside the code and docs is Step 15 work. **Why:** the npm name `chrome-agent-bridge` was taken on 2026-11-01 by an
unrelated project; "Chrome" as a name's first word risks the store's branding rule; the user plans other browsers.
**Instead of:** a takedown or a name transfer: the other package is an independent product (checked 2026-11-08: its
own code and license, nothing of ours), so npm's dispute policy would not apply; a scoped
`@user/chrome-agent-bridge`, long and confusing beside the other product. **By:** user

### 2026-11-08 · Running over the network waits for a later phase (#443)
**Decided (user):** the daemon, Chrome and clients on different machines is a future phase; Step 15 keeps the
`127.0.0.1` bind and only avoids choices that would block it later (for example a hard-coded host in the protocol).
**Why:** leaving localhost needs encryption and stronger authentication than one shared token. **By:** user

### 2026-10-30 · The user rules Step 14's gate; Step 14 closes (#442)
**Decided (user),** on the session agent's plain-language list (chat, 2026-10-30):
1. **#432 (a):** the doctor keeps its heuristic line for the extension's build; a build id in the hello only if U.1
   shows the heuristic misleads.
2. **#441 (a), "a very quick fix with very quick verification":** the eleven unpushed commits were rewritten so the
   Stage 0 commit carries the already-redacted `kickoff-checker-test.txt`; the final tree is byte-identical to the old
   tip, history holds no local path, and the commit ids cited in the docs were updated to the new ones.
3. **G14-1 granted:** push. U.1 (the user's install on another device) follows; its findings become a small follow-up.
4. **The clone command keeps the public GitHub URL** (`README.md`, `docs/setup.md`): an exception to
   `docs-writing-guide.md` rule 9, which now says so; a clone command must work as pasted.
5. **The cleanup pass 2026-10-30-2 proposals P5–P11:** the session agent's recommendations, applied.
**By:** the user

### 2026-10-30 · Step 14's close: the history line with a local path waits for the user (#441)
**Decided:** ruled by #442 (a). The Stage 0 commit held one `kickoff-checker-test.txt` line with the checkout's
absolute path until the history rewrite. **By:** Claude (for the user)

### 2026-10-30 · Two-level stages: the session agent commits each stage after its verifier's verdict (#440)
**Decided:** in Step 14's two-level form the session agent committed S1–S5 itself, after scanning the files for the
user's name, instead of starting a committer. **Why:** the first committer stopped (correctly) on unredacted evidence;
the session agent redacted and committed, and kept that for the small stages. **Instead of:** a Sonnet committer per
stage (`agent-rules.md` §6). **Revisit if:** a later phase runs two levels again — then write it into `long-run`.
**By:** Claude

### 2026-10-30 · S2b: an MCP entry whose `BRIDGE_TOKEN` equals the bridge's reads OK (#439)
**Decided:** the doctor's line is OK with a note that the env entry is optional; only a differing token is flagged.
**Why:** it works; R4.1 asks for green on a working setup. **By:** Claude

### 2026-10-30 · S2b: the doctor runs under tsx with its own hello probe; update exits 0 or 1 (#438)
**Decided:** `npm run doctor` = `tsx scripts/bridge/doctor.ts`: one hello and `daemon.status` through the SDK's
`tryConnect`, never `connect()`/knock (no spawn, no handover); OK / HINT / FAIL lines. `npm run bridge-update` (Node)
runs npm through `npm-cli.js` with no shell and exits 0 or 1 only, so its exit never means "re-run" as the reload's
exit 2 does. Amends #427 (the doctor is not plain Node: it needs the SDK). The S2b build's 252 code + 151 test lines
against a cap of 300 are accepted under `agent-rules.md` §7's 1.5× rule. **By:** Claude

### 2026-10-30 · S2a: setup skips an unneeded build and exits 0 / 1 / 2 (#437)
**Decided:** the build runs unless every output is newer than every input (any doubt builds), so a second run leaves
`dist/` and #432's heuristic alone; exit 1 = a prerequisite missing, 2 = the MCP step failed (the other steps still
run), 0 with a missing `claude` CLI (the next steps say what to add); Node floor 20. Built as #428 and #429 decided.
**By:** Claude

### 2026-10-30 · S1: the `~` rewrite folds ASCII case only and uses the injected home (#436)
**Decided:** a Windows home matches case-insensitively for A–Z (length-preserving; a home with `İ` keeps its dot) with
either separator and prints `~\`; only a path strictly inside the home is rewritten; a throwing `homedir` prints the
absolute path. **By:** Claude

### 2026-10-30 · S3: the consumer folder runs `npm pkg set type=module` and installs tsx beside the SDK (#435)
**Decided:** `npm init -y`, `npm pkg set type=module`, `npm install <repo>\sdk tsx`, then `npx tsx list-tabs.ts`.
Built as #430 decided. **Why:** measured: the `file:` SDK brings no tsx, and npm 11's init writes `commonjs`. **By:** Claude

### 2026-10-30 · S5: the npm.cmd hint for a fresh Windows (#434)
**Decided:** the install section says to run `npm.cmd run setup` (or Command Prompt) if PowerShell refuses `npm.ps1`;
nothing changes the machine's execution policy. **Why:** a known Windows default (one web search; not measured here,
where npm is an `npm.exe`). **Revisit if:** U.1 sees it. **By:** Claude

### 2026-10-30 · S4: the rehearsal's guard hashes the `mcpServers` key, not the whole `~/.claude.json` (#433)
**Decided:** Claude Code rewrites the file on its own, so a whole-file hash moves without any MCP change; the S4
verifier measured that `mcpServers` stayed the same. Later rehearsals guard that key only. **By:** Claude

### 2026-10-30 · Stage 0: the doctor reads the extension's build as a heuristic; no protocol change (#432)
**Decided (kept by #442):** the doctor says "extension connected" from `daemon.status`, compares the daemon's build with the one on
disk, and, as a heuristic named as such, "the extension may be older than the build — reload it" when
`extension\dist\sw.js` is newer than the last `extension resync` line in the daemon's log. The doctor never spawns or
hands over a daemon. The phase doc's Outcome and R4.1 are amended to this wording. **Why:** nothing on the wire reports
the loaded extension's build (Stage0.md C2); the Outcome forbids a protocol change; the conservative option (§4).
**Instead of:** a build id in the extension's hello and `daemon.status` (a contract change), or driving a tab.
**Revisit if:** the user wants an exact check. **By:** Claude (for user review; listed under Open decisions)

### 2026-10-30 · Stage 0: update treats "nothing reloaded" as a hint; `--no-reload` for the rehearsal (#431)
**Decided:** update prints the reload's outcome; `reload-extension.ps1` exit 2 is a hint ("reload it by hand"), not a
failure; a `--no-reload` switch, which S4 uses. **Why:** the reload script drives the user's Chrome and finds no card
for a scratch clone (Stage0.md M2). **Instead of:** running the reload from a scratch clone. **By:** Claude

### 2026-10-30 · Stage 0: scripts outside the repo use a `file:` dependency on the checkout's `sdk`, run with tsx (#430)
**Decided:** `npm install <repo>\sdk` in the script's folder, then `npx tsx script.ts`; the doc says how to remove the
junction it leaves (#220). Changes #425's open question. **Why:** measured (Stage0.md 0.6): resolves, typechecks, finds
the checkout's `bridge.token` from the SDK's own folder, records itself, no global state; `sdk/dist` does not exist and
plain `node` cannot load the `.ts` SDK. **Instead of:** `npm link`, importing `sdk/src` by path. **Revisit if:** the
SDK gets a build. **By:** Claude

### 2026-10-30 · Stage 0: the MCP entry is read from the config file and written by `claude mcp add -s user` (#429)
**Decided:** read `<CLAUDE_CONFIG_DIR or ~>\.claude.json` read-only to decide; register with `claude mcp add -s user
chrome-agent-bridge -- node <repo>\mcp\dist\index.js`; replace a different entry only with a flag; the doctor reports
an entry's `BRIDGE_TOKEN` that differs from `bridge.token`, compared by equality, never printed. S4 sets
`CLAUDE_CONFIG_DIR` to a scratch folder and stops if it does not isolate. Refines #424. **Why:** `claude mcp get`/`list`
start the server; `add` defaults to local scope; an env token wins over the file (Stage0.md M5, M6). **By:** Claude

### 2026-10-30 · Stage 0: the token goes to the clipboard by `clip.exe` on stdin and is cleared after the paste (#428)
**Decided:** the install copies `bridge.token` with `clip.exe` (stdin), says so, waits for Enter, then empties the
clipboard; no Options page is opened; a history-excluded copy is used only if S2 measures it. Settles #423. **Why:**
measured exact from Node with no profile; the extension is not loaded at install time; clipboard history is on here
(Stage0.md M4). **Instead of:** `Set-Clipboard -Value` on a command line. **By:** Claude

### 2026-10-30 · Stage 0: the three commands are Node scripts with non-lifecycle names; S2 in two slices (#427)
**Decided:** `npm run setup`, `npm run doctor`, `npm run bridge-update`, Node `.mjs` (the setup entry on Node built-ins
only, since it runs before `npm ci`; `npm ci --no-audit --no-fund`); PowerShell only through `spawnSync` for the
clipboard and the reload; a test pins that no root script takes an npm lifecycle name. S2 splits into S2a (setup and the
shared logic) and S2b (doctor and update); S4 needs S2b and S3. Changes #422; keeps #421, #426. **Why:** Stage0.md C1,
M3, 0.3; node, npm and git are on PATH in a profile-less shell (measured). **Instead of:** `.ps1` entry points; a script
named `install`. **Revisit if:** U.1 finds npm missing from a new shell. **By:** Claude

Entries #421–#426 record the phase doc's proposed decisions 0.2–0.7 (`docs/plans/2026-10-30-step14-phase-g-own-devices.md`
§ Decisions holds each in full) before Stage 0, so the audit can attack them (kickoff §4). Stage 0's `Stage0.md` keeps
or changes each; a change is a new entry.

### 2026-10-30 · Step 14 (0.7): what is not in Step 14 (#426)
**Decided:** a Web Store or signed build, macOS/Linux, a stable extension key, auto-update, R20-G2-1, the Phase F items
left out and the Run 20 helper proposals stay in Follow-ups. **Why:** #374 item 11, Phase G minimal. **By:** Claude (proposed)

### 2026-10-30 · Step 14 (0.6): scripts from any folder, one measured way (#425)
**Decided:** Stage 0 measures `npm link`, a `file:` dependency and importing `<repo>/sdk/dist`; one way is documented.
**Why:** one documented way is what a new device needs. **By:** Claude (proposed)

### 2026-10-30 · Step 14 (0.5): the MCP entry by `claude mcp add`, user scope, idempotent (#424)
**Decided:** an entry pointing at this checkout is left alone; one pointing elsewhere is reported and replaced only with
a flag; without the `claude` CLI the command says what to add and where. **Why:** no hand-edited `~/.claude.json`.
**By:** Claude (proposed)

### 2026-10-30 · Step 14 (0.4): the token reaches the extension unprinted (#423)
**Decided:** clipboard or the Options page opened; never the console, a log or a committed file; the MCP entry carries
no `BRIDGE_TOKEN`. Stage 0 decides the mechanism. **Why:** the token is a password (root `CLAUDE.md` invariants).
**By:** Claude (proposed)

### 2026-10-30 · Step 14 (0.3): Node first, PowerShell 5.1 only for Windows UI or the clipboard (#422)
**Decided:** `npm run <script>` calling Node where it can do the job; PowerShell with `-NoProfile -ExecutionPolicy Bypass
-File` otherwise; nothing changes the machine's execution policy. Stage 0 decides. **Why:** runs on a fresh Windows 11
with Node, git and Chrome only. **By:** Claude (proposed)

### 2026-10-30 · Step 14 (0.2): two levels; Stage 0, S1–S5 in order, S1 beside S2 (#421)
**Decided:** the session agent runs each stage with one builder and one verifier. **Why:** a small phase; three levels
cost more than they catch here. **By:** Claude (proposed)
