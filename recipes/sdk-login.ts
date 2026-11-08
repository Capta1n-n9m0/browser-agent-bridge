// recipes/sdk-login.ts — Step 8 row SDK-1 (docs/e2e-test-plan.md §4.19): the typed SDK end to end on
// the fixture page. Written 2026-10-23 before the S6 build was loaded (S6 stage-local ruling: SDK-1's
// recipe file is this one; recipes/hello.ts stays the instrument of MUX-3/5/6/8/10, decision #85).
//
// What it does: connect → newTab(the fixture, a fresh `?s6=sdk1` query, in the background) →
// locate({role: "button", name: "Sign in"}) → click(that ref) → waitFor({text: "form submitted"}) →
// read the page's status line → print → close the tab → close the client.
//
// What it needs open: Chrome with the Browser Agent Bridge extension (S2-or-later build), the fixture
// served on http://localhost:8080 (`python -m http.server 8080 --directory test-fixtures`). It touches
// only the tab it opens; the human's tabs are never read or switched. It prints no URL or title but the
// fixture's, and never the token (the SDK resolves it).
//
// How it fails: a `FAILED — <code>: <message>` line and exit 1 (a bridge error, e.g. NOT_CONNECTED with
// no Chrome, UNKNOWN_METHOD from a stale extension); `SDK-1 FAIL — …` and exit 1 when a pass condition
// is not met. A failed locate/click/waitFor carries the SDK's failure report (printed under it).
//
//   npm run recipe -- recipes/sdk-login.ts          (or: npx tsx recipes/sdk-login.ts)
// Environment: RECIPE_NAME (client name, default "sdk-login"); S6_FIXTURE_ORIGIN (default
// http://localhost:8080); BRIDGE_PORT / BRIDGE_TOKEN are read by the SDK.
import { BridgeError, connect, type Tab } from "@bridge/sdk";
import { s6Url, sdk1Verdict } from "./s6-rules.js";

const name = process.env.RECIPE_NAME?.trim() || "sdk-login";
const started = Date.now();
const say = (msg: string): void => console.log(`${new Date().toISOString()} ${name}: ${msg}`);

async function main(): Promise<void> {
  const client = await connect({ name });
  let tab: Tab | undefined;
  try {
    say(`connected — daemon build ${client.welcome?.build.slice(0, 12) ?? "?"}…, extension ${client.extensionConnected ? "connected" : "not connected"}`);
    const url = s6Url("sdk1");
    tab = await client.newTab(url);
    say(`opened ${tab.handle} (background) at ${url}`);
    const located = await tab.locate({ role: "button", name: "Sign in" });
    say(`locate {role:"button", name:"Sign in"} → ${located.ref} ${located.role} ${JSON.stringify(located.name)}`);
    await tab.click(located.ref);
    say(`click ${located.ref} → ok`);
    const t0 = Date.now();
    await tab.waitFor({ text: "form submitted" });
    say(`waitFor {text:"form submitted"} → ok after ${Date.now() - t0} ms`);
    const status = await tab.evaluate<string>("document.getElementById('status').textContent");
    say(`status line: ${JSON.stringify(status)}`);
    const v = sdk1Verdict({ located, status });
    await tab.close();
    say(`closed ${tab.handle}`);
    tab = undefined;
    if (v.pass) say(`SDK-1 PASS — located button "Sign in", clicked, the page says "${status}" (${Date.now() - started} ms in all)`);
    else {
      say(`SDK-1 FAIL — ${v.why.join("; ")}`);
      process.exitCode = 1;
    }
  } finally {
    if (tab) await tab.close().catch(() => {});
    client.close();
  }
}

main().catch((err: unknown) => {
  if (err instanceof BridgeError) {
    say(`FAILED — ${err.code}: ${err.message}`);
    if (typeof err.report === "function") console.log(err.report());
  } else say(`FAILED — ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
