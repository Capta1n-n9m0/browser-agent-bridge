# Decisions — Browser Agent Bridge

Newest first. Only what the user ruled or what the product promises (`docs/agent-rules.md` §8). Format:
[`docs-writing-guide.md`](docs-writing-guide.md#decisions). Cite an entry by date + title.

Entries #1–#442 (Steps 6–14) live in tag `archive/dev-history`: the `decisions-archive/stepN.md` files named below
and that tag's `docs/decisions.md` (Step 14). Read one with `git show archive/dev-history:docs/decisions-archive/step9.md`.
Earlier decisions are in `docs/specs/`.

## Open decisions

None.

## Standing decisions

**How we work**
- 2026-11-08 · v1.0.0 is our goal (#448) — below; `docs/plans/2026-11-08-step15-distribution.md` § v1
- 2026-11-08 · Lean mode: checks by risk, hand-backs instead of report files, records archived (#446) — below; `docs/agent-rules.md`
- 2026-10-22 · Live E2E waves are run by Claude end to end (#33) — `decisions-archive/step6.md`
- 2026-10-23 · Later extension reloads use `recipes/reload-extension.ps1` (#65) — `decisions-archive/step7.md`
- 2026-10-25 · Fresh agents instead of resumed ones (#225) — `decisions-archive/step10.md`
- 2026-10-25 · Commits carry exactly one trailer and no Claude-Session line (#231) — `decisions-archive/step11.md`
- 2026-10-25 · Gotchas follow the code they bind (#232) — `decisions-archive/step11.md`
- 2026-10-26 · Agents never end their turn on a running child (#286) — `decisions-archive/step11.md`
- 2026-10-29 · No local path or user name in new committed docs (#374) — `decisions-archive/step12.md`

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

## Log

The next entry is 452.

### 2026-11-08 · The extension drops the `activeTab` permission (#451)
**Decided (user):** `activeTab` leaves `extension/manifest.json`. Nothing in the code uses it, the toolbar button is only the
kill switch, and `<all_urls>` already gives every access `activeTab` would. **Why:** the Web Store asks for the narrowest
permissions; an unused one is a question a reviewer may ask. No behaviour changes and no install warning changes.
`extension/test/manifest.test.ts` pins its absence. **By:** user

### 2026-11-08 · The license moves from MIT to AGPL-3.0, with the SDK under Apache-2.0 (#450)
**Decided (user):** the daemon, the extension, the MCP server, the scripts and the repo root are `AGPL-3.0-only`
(`LICENSE`); `sdk/` and `shared/` (which the SDK imports) are `Apache-2.0` (`sdk/LICENSE`, `shared/LICENSE`). The README
gains a trademark note: the licenses cover the code, not the name "Browser Agent Bridge". Versions released before
2026-11-08 stay MIT. The second contributor on `main` (`start-bridge.sh`) gave their consent, as the user reports, and confirmed it in writing in GitHub issue #2 (2026-11-08), from the same
GitHub account that authored their commit.
**For S2:** the one npm package (#449) bundles both parts, so its `license` field is the SPDX expression
`AGPL-3.0-only AND Apache-2.0`, and it ships both texts and says which files fall under which. **Why:** the user wants
more protection than MIT, so no one can take the product closed. An Apache-2.0 SDK keeps users' scripts free of AGPL
duties. **Instead of:** Apache-2.0 everywhere (little more than MIT); AGPL everywhere (would bind scripts that import
the SDK); FSL or BUSL (source-available, not open source); PolyForm Noncommercial (it would block the v1 goal, #448).
**Revisit if:** a company wants a commercial license (dual licensing would need every contributor's consent).
**By:** user

### 2026-11-08 · The user rules Step 15's proposals (#449)
**Decided (user):** (1) one npm package, `browser-agent-bridge`, not several; (2) the token lives in a per-user folder,
and a clone's `bridge.token` keeps working; (3) the `.mcpb` in Step 15, signed standalone installers later; (4) the
pairing program ships in the npm package, answers only the extension's fixed ID and returns only the token and port;
(5) npm releases by trusted publishing from GitHub Actions; (6) the Web Store gets the full version, `browser_evaluate`
included, and a rejection is handled when it comes; (7) every task only the user can do is asked for when its stage
needs it, with numbered step-by-step instructions. Claude Desktop is installed on the user's machine.
**Why:** the user's rulings on the phase doc's proposals. **By:** user

### 2026-11-08 · v1.0.0 is our goal (#448)
**Decided (user):** v1.0.0 is a promise we work towards: a stranger installs it on Windows, macOS or Linux without
help and without typing a token; the public surface (MCP tools and schemas, the SDK's API, the wire protocol, the error
codes) is stable, and breaking it after v1 means v2; the security model is written and reviewed once by fresh eyes; CI
on all three OSes builds every release; no known safety bug is open and known issues are fixed or documented; signed
standalone installers are taken up on the way. Until then releases are v0.x. **Why:** a version number should tell a
user what we promise. **By:** user

### 2026-11-08 · Versions are tagged vX.Y.Z (#447)
**Decided (user):** releases are tagged `vX.Y.Z` (semantic versioning). The npm package, the extension manifest, the
`.mcpb` and the tag carry the same number. `v0.1.0` marks the state after Steps 1–14 (pushed 2026-11-08); Step 15
releases `v0.2.0`; v1.0.0 waits for #448. **Why:** one number tells a user which pieces belong together.
**By:** user

### 2026-11-08 · Lean mode: checks by risk, hand-backs instead of report files, records archived (#446)
**Decided (user):** from Step 15 on, checking follows risk (`docs/agent-rules.md` §4): safety code keeps a builder,
one independent verifier and at most one fix round; ordinary code is tested and the diff read, with no verifier; docs
get one writer; Chrome-only behaviour gets one short live checklist at the end of a step. Agents hand back ~20 lines in
chat instead of writing report and evidence files. `decisions.md` keeps only the user's rulings and product promises.
The chain session agent → step agent → executor stays, leaner; the skills were rewritten to match. The step folders,
decision archives, cleanup reports, old phase docs and past live-run helpers moved to tag `archive/dev-history`;
`docs/history.md` and `docs/roadmap.md` are the condensed versions.
**Why:** Steps 12–14 produced ~100,000 lines of reports for small changes (Step 14: 117 files, 46 verifier reports for
~500 lines of scripts); late verifier rounds found minor issues and nits, not defects. **Instead of:** the per-stage builder,
verifier and up to three fix rounds for every change. **Revisit if:** a defect reaches the user that the dropped checks
would have caught. **By:** user

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
