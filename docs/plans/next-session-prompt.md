# Next session: Step 15 — the Chrome Web Store submission, then the closeout

You are the SESSION AGENT for Step 15 of Browser Agent Bridge. Follow the `long-run` skill (lean mode). The user is
around and watching; this session drives their real Chrome through the bridge, on the user's request.

**Resume:** read Current state in `CLAUDE.md` and the phase doc's § As built first. v0.2.0 is released on GitHub and npm;
only the store submission (U3) and the closeout are left.

**First checks**
1. `git status` is clean apart from the user's own untracked screenshots in the repo root (never commit them).
2. `npm test` and `npm run build` are green; quote the count (4334 at v0.2.0).
3. Only the daemon holds port 9234; `npm run doctor` shows the extension connected.
4. `browser_status` answers. If it says there is no token, the session's MCP server predates the per-user token: ask the
   user to run `/mcp` and reconnect.

**Set up the extension for the upload** (ask the user, numbered steps): on `chrome://extensions`, Browser Agent Bridge →
Details → "Allow access to file URLs" on; its Options → Upload folders gains
`C:\Users\aliev\Projects\chrome-remote-extention\build\store-upload` (the store zip without `key`, the 128 px icon, three
screenshots, the promo tile). If the folder is missing, rebuild it from `npm run release:build`, `extension/icons/`,
`assets/store/` and `assets/brand/`. After the submission the user may remove the folder again.

**The submission (U3):** on the developer dashboard's existing draft (ID `iifofgbdljchbdimlalhphmedfmocela`): upload the store
zip as a new package; fill the store listing, privacy practices (single purpose, one justification per permission, remote
code answered "Yes" with the reviewer note, data usage, the privacy policy URL), test instructions and distribution (public),
all from `docs/store-listing.md`. Stop before **Submit for review** and show the user a summary; click it only on their go.

**Read:** `docs/plans/2026-11-08-step15-distribution.md` (§ S10, § As built), `docs/store-listing.md`.

**Then:** the phase doc's exit checks in § As built, the `session-closeout` skill, and the user's choice of what comes next
(the Claude Desktop route, the doctor text). Ask before every push.
