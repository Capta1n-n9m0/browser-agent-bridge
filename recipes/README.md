# recipes/

Claude-written scripts that drive the real Chrome through the bridge's TypeScript SDK (`@bridge/sdk`),
Each script's header comment says what it does, what it needs
open, and how it fails (Step 8 phase doc 0.7).

Run one with `tsx` from the repo root:

```bash
npm run recipe -- recipes/<file>.ts [args]      # the same as: npx tsx recipes/<file>.ts [args]
```

The SDK finds, starts or hands over the daemon itself; the token comes from `BRIDGE_TOKEN`, else
`bridge.token` at the repo root, and no recipe reads or prints it. The fixture rows need
`python -m http.server 8080 --directory test-fixtures` (`docs/e2e-test-plan.md` §1 item 7). A script outside
the repo imports the SDK by a `file:` dependency: `docs/setup.md` → Scripts from any folder (`examples/list-tabs.ts`).

## Scripts

| File | What it does |
|---|---|
| `hello.ts` | The smallest SDK script: connect, `daemon.status`, `listTabs`, optional hold. The instrument of rows MUX-3/5/6/8/10 — its output is pinned by those rows, so do not change it. |
| `sdk-login.ts` | Row SDK-1: `newTab` to the fixture → `locate({role:"button", name:"Sign in"})` → `click` → `waitFor({text})` → print the page's status line → close. |
| `s6-rules.ts` | The pure pass rules `s6.ts` and `sdk-login.ts` print (tested in `test/s6-rules.test.ts`). |
| `blackboard/boot-bb.ts` | Row SDK-6: open the named course in its own tab, load the blackboard-ultra skill's `bb.js` by `evaluate`, print `bb.VERSION`. |
| `blackboard/export-grades.ts` | Row SDK-7: the course gradebook, read-only, into `exports/<course>-<date>.json` (gitignored); prints counts and sha256 only. `--hold` keeps the export in its tab's page memory for the MCP leg, `--drop-held <T#>` drops it after both reads. `--mcp-plan` prints the MCP leg's expressions; the MCP leg reads the held export with one `browser_evaluate {saveTo}`, never in chunks (Run 15's PP1 row). |
| `blackboard/guard.ts`, `readonly.ts`, `export-file.ts`, `held.ts` | Pure parts of the Blackboard recipes: course argument and origin guard, the read-only allowlist and page code, file names and hashes, the held-export plan (tested in `test/blackboard-*.test.ts`). `session.ts` holds the shared open-and-boot steps. |
| `blackboard/stub-bb.js` | A fake `bb.js` with invented data, for `--dry-run` on the localhost fixture. |
| `reload-extension.ps1` | Reloads the unpacked extension by UI Automation and proves it (exit 0; exit 2 = pressed nothing). |
| `bb-login.ps1` | SDK-6/SDK-7's login step (Windows PowerShell 5.1): its own window on ada, Chrome's autofill, at most one invoke in a run — Blackboard's own sign-in button, or (since 2026-10-23, #99) the one allowlisted submit button of ADA's SSO page, only on a host on its SSO host allowlist (`ada.edu.az` and hosts under it, or exactly `login.microsoftonline.com`); counts, yes/no and an allowlisted host only, never reads or types a field. After the one press it polls up to `-WaitSec` (default 90) from the press until it is back on Blackboard with no sign-in control and the address stable 4 s (exit 0, window closed); else exit 4 at the bound (or at once if its window is gone), window left open, nothing more pressed (exit 2: nothing touched). `-DryRunBase http://127.0.0.1:<port>/ [-DryRunPage <page>]` runs it against the loopback stand-ins in `fixtures/` (`bb-standin.html` good, `-bad`, `-otherhost`, and since Step 10 S5 `-delayed` (exit 0 after a 12 s redirect), `-stuck` and `-elsewhere` (exit 4 at the bound)). *Updated 2026-10-25 (Step 10 S5, #215): the condition wait and `-WaitSec`; was "exit 0 logged in, 4 waits for the user, 2 nothing touched" after a fixed wait.* |
| `t5-lib.ts` | Small SDK helpers (`listTabs`, fixture URL checks) the Blackboard recipes and `s6-rules.ts` import. |

The live-wave helpers of Steps 7–13 (`s6`…`s13`, `t5`, `fe`, `bgf`) are in tag `archive/dev-history`.

## The Blackboard recipes' rules

- They run only on `https://ada.blackboard.com`, on the course given on the command line (an id such as
  `_12345_1`, its course URL, or a short course key such as `pp1`, which they resolve on ada by one
  read-only GET and then print and file under the key: the resolved id is never printed or written). With no course they refuse; they never pick a course or claim a tab
  they did not open. After the page loads they check its origin and course again (a login redirect is
  refused, and the recipe's own tab closed).
- `--dry-run` opens the localhost fixture and loads `blackboard/stub-bb.js`; it refuses any page but
  `http://localhost:<port>` / `http://127.0.0.1:<port>`. A real run refuses the stub.
- They are read-only by construction: `export-grades.ts` sends only page code built from the allowlist
  in `blackboard/readonly.ts` (`bb.all` on the gradebook read paths); any other op throws before
  anything reaches the page. Failure reports are off (`failureReports: false`), so no screenshot or
  snapshot of a Blackboard page is saved.
- Output is counts, sizes, sha256 and file paths — never a grade, a name or a Blackboard URL. Exports go
  to `exports/` (gitignored) and are never committed.

## Typecheck and tests

```bash
npx tsc --noEmit -p recipes/tsconfig.json   # every recipe and its tests
npx vitest run recipes/                     # recipes/test/*.test.ts (part of `npm test`)
```
