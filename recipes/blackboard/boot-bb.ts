// recipes/blackboard/boot-bb.ts — Step 8 row SDK-6 (docs/e2e-test-plan.md §4.19; phase doc 0.7 item 1):
// open the course named on the command line in a tab of this recipe's own, `evaluate` the bb.js source
// read from ~/.claude/skills/blackboard-ultra/scripts/bb.js, print `bb.VERSION`. This replaces steps 1–3
// of the blackboard-ultra skill's boot sequence (no 8765 server, no `(0, eval)(await fetch…)`).
// Written 2026-10-23 before any run; read-only: it loads the helper and reads its VERSION, nothing else.
//
// What it needs open: Chrome logged in to https://ada.blackboard.com with the Browser Agent Bridge
// extension (any Step 7+ build); the course id (or its URL) as the argument. It never picks a course or
// claims a tab itself: it opens its own tab and closes it at the end (`--keep-open` leaves it open and
// prints its handle).
// Dry run: `--dry-run` opens the localhost fixture (served on 8080) and loads recipes/blackboard/stub-bb.js
// (fake data) instead; it refuses any page but http://localhost:<port> / http://127.0.0.1:<port>.
//
// How it fails: `REFUSED — …` and exit 2 before anything is done (no course, a non-ada course URL, a
// real run on a non-ada page or with the stub, a login redirect, another course); `FAILED — <code>:
// <message>` and exit 1 on a bridge error; `SDK-6 FAIL — …` and exit 1 when the page's VERSION is
// missing or differs from the one the source declares.
//
//   npm run recipe -- recipes/blackboard/boot-bb.ts <course-id|course-url|course-key> [--keep-open] [--bbjs <path>]
//   npm run recipe -- recipes/blackboard/boot-bb.ts <course-id> --dry-run [--fixture-origin http://localhost:8080]
import { BridgeError, connect, type Tab } from "@bridge/sdk";
import { parseBbArgs, Refusal } from "./guard.js";
import { bootBb, describeSource, openCourse, prepare, resolveCourse } from "./session.js";

const NAME = "boot-bb";
const say = (msg: string): void => console.log(`${new Date().toISOString()} ${NAME}: ${msg}`);
const HELP = `recipes/blackboard/boot-bb.ts <course-id|course-url|course-key> [--keep-open] [--bbjs <path>]
recipes/blackboard/boot-bb.ts <course-id> --dry-run [--fixture-origin http://localhost:<port>] [--bbjs <path>]
Opens the course in its own background tab, evaluates bb.js there, prints bb.VERSION. Read-only.`;

async function main(): Promise<void> {
  const args = parseBbArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  for (const flag of ["overwrite", "mcpPlan"] as const) if (args[flag]) throw new Refusal(`boot-bb takes no --${flag === "mcpPlan" ? "mcp-plan" : flag}`);
  const p = prepare(args);
  say(`course ${p.label}; source ${describeSource(p)}${p.dryRun ? "; DRY RUN" : ""}`);
  // failureReports off: a report would save a screenshot and a snapshot of a Blackboard page.
  const client = await connect({ name: NAME, failureReports: false });
  let tab: Tab | undefined;
  try {
    const courseId = await resolveCourse(client, p, say);
    tab = await openCourse(client, p, courseId, say);
    const version = await bootBb(tab, p, courseId, say);
    say(`bb.VERSION = ${version ?? "(none)"}`);
    if (version !== null && version === p.declared) {
      say(`SDK-6${p.dryRun ? " (dry run)" : ""} PASS — bb.VERSION ${version} from ${p.dryRun ? "the stub" : "the skill's bb.js"}, loaded by evaluate (no 8765 server)`);
    } else {
      say(`SDK-6${p.dryRun ? " (dry run)" : ""} FAIL — the page reports ${version ?? "no bb.VERSION"}, the source declares ${p.declared ?? "none"}`);
      process.exitCode = 1;
    }
    if (args.keepOpen) {
      say(`kept ${tab.handle} open (bb loaded there); it is released when this script exits`);
      tab = undefined;
    }
  } finally {
    if (tab) {
      await tab.close().catch(() => {});
      say(`closed ${tab.handle}`);
    }
    client.close();
  }
}

main().catch((err: unknown) => {
  if (err instanceof Refusal) {
    say(`REFUSED — ${err.message}`);
    process.exitCode = 2;
  } else if (err instanceof BridgeError) {
    say(`FAILED — ${err.code}: ${err.message}`);
    process.exitCode = 1;
  } else {
    say(`FAILED — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
});
