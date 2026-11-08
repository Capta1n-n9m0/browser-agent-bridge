/**
 * Step 9 S2b — S2.3 as #141 words it, first half: the 0.7 scan enumerates every `console.*` and injected-logger
 * call site in `extension/src`, `daemon/src`, `sdk/src`, `mcp/src` (TypeScript compiler API, `log-scan.ts`) and
 * compares the multiset with the committed allowlist (`log-allowlist.ts`). It fails on a site not listed and on
 * a listed site no longer found. The sentinel half is `log-sentinel.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { allLogSites, compareWithAllowlist, logSitesIn, scannedSources, SCANNED_ROOTS } from "./log-scan.js";
import { LOG_ALLOWLIST } from "./log-allowlist.js";

describe("0.7 log scan — every log call site is allowlisted", () => {
  const files = scannedSources();
  const found = allLogSites(files);

  it("the scan reads all four packages and the npm package's commands", () => {
    for (const root of SCANNED_ROOTS) expect([...files.keys()].some((f) => f.startsWith(`${root}/`)), root).toBe(true);
    expect(files.has("extension/src/sw.ts")).toBe(true);
    expect(files.has("daemon/src/main.ts")).toBe(true);
    expect(files.has("mcp/src/index.ts")).toBe(true);
    expect(files.has("sdk/src/client.ts")).toBe(true);
    expect(files.has("scripts/package/cli.mjs")).toBe(true);
    expect(files.has("scripts/bridge/doctor.ts")).toBe(true);
    expect(files.has("scripts/native-host/host.mjs")).toBe(true);
    expect(files.has("scripts/native-host/pair.mjs")).toBe(true);
  });

  it("found sites = the allowlist, both ways", () => {
    const { unlisted, stale } = compareWithAllowlist(found, LOG_ALLOWLIST);
    expect(unlisted, "log call sites not in extension/test/log-allowlist.ts").toEqual([]);
    expect(stale, "allowlist entries no longer found in the source").toEqual([]);
  });

  it("every entry says what it may print", () => {
    for (const e of LOG_ALLOWLIST) expect(e.prints.trim().length, `${e.file} | ${e.call}`).toBeGreaterThanOrEqual(5);
  });

  it("sizes per package (extension 16, daemon 34, sdk 0, mcp 6, scripts 6)", () => {
    const per = (root: string) => LOG_ALLOWLIST.filter((e) => e.file.startsWith(`${root}/`)).length;
    expect([per("extension/src"), per("daemon/src"), per("sdk/src"), per("mcp/src"), per("scripts")]).toEqual([16, 34, 0, 6, 6]);
  });

  describe("the scan is discriminating (in-memory mutations of real files)", () => {
    const withExtra = (file: string, extra: string) => {
      const m = new Map(files);
      m.set(file, files.get(file)! + "\n" + extra + "\n");
      return compareWithAllowlist(allLogSites(m), LOG_ALLOWLIST);
    };

    it('a new console.log("x", url) is unlisted', () => {
      const r = withExtra("extension/src/handlers/navigate.ts", 'const url = "u"; console.log("x", url);');
      expect(r.unlisted).toEqual(['extension/src/handlers/navigate.ts | console.log("x", url)']);
      expect(r.stale).toEqual([]);
    });

    it("an allowlisted text with a changed argument is unlisted, and its entry is stale", () => {
      const m = new Map(files);
      const sw = files.get("extension/src/handlers/evaluate.ts")!;
      const mutated = sw.replace('console.log("[bridge] evaluate", expression.length, "chars")', 'console.log("[bridge] evaluate", expression, "chars")');
      expect(mutated).not.toBe(sw);
      m.set("extension/src/handlers/evaluate.ts", mutated);
      const r = compareWithAllowlist(allLogSites(m), LOG_ALLOWLIST);
      expect(r.unlisted).toEqual(['extension/src/handlers/evaluate.ts | console.log("[bridge] evaluate", expression, "chars")']);
      expect(r.stale).toEqual(['extension/src/handlers/evaluate.ts | console.log("[bridge] evaluate", expression.length, "chars")']);
    });

    it("a second copy of an allowlisted line counts (multiset)", () => {
      const r = withExtra("extension/src/sw.ts", 'console.log("[bridge] connection: up");');
      expect(r.unlisted).toEqual(['extension/src/sw.ts | console.log("[bridge] connection: up")']);
    });

    it("a removed site leaves a stale entry", () => {
      const m = new Map(files);
      m.set("extension/src/sw.ts", files.get("extension/src/sw.ts")!.replace('console.log("[bridge] connection: up");', ""));
      expect(compareWithAllowlist(allLogSites(m), LOG_ALLOWLIST).stale).toEqual(['extension/src/sw.ts | console.log("[bridge] connection: up")']);
    });

    it("the daemon's injected loggers are seen: deps.log, options.log, this.deps.log?.(), a bare log(), logger.log", () => {
      const src = [
        "deps.log(`tab ${url}`);",
        "options.log?.(title);",
        "this.deps.log?.(pattern);",
        "log(token);",
        "logger.log(x);",
      ].join("\n");
      expect(logSitesIn("daemon/src/x.ts", src).map((s) => s.call)).toEqual([
        "deps.log(`tab ${url}`)",
        "options.log?.(title)",
        "this.deps.log?.(pattern)",
        "log(token)",
        "logger.log(x)",
      ]);
    });

    it("console in any form: element access, optional call, aliased or passed as a value", () => {
      const src = ['console["log"](u);', "console.error?.(u);", "const c = console; c.log(u);", "f(console);"].join("\n");
      const calls = logSitesIn("mcp/src/x.ts", src).map((s) => s.call);
      expect(calls).toContain('console["log"](u)');
      expect(calls).toContain("console.error?.(u)");
      expect(calls).toContain("console (as a value): c = console");
      expect(calls).toContain("console (as a value): f(console)");
      expect(calls).toContain("c.log(u)");
    });

    // S2b fixer r1 (verifier F2): the forms the first scan missed.
    it("process streams in any use: .write, aliased, destructured, process itself as a value", () => {
      const src = [
        "process.stderr.write(url);",
        "process.stdout.write(url);",
        'process["stderr"].write(url);',
        "const e = process.stderr; e.write(url);",
        "const { stdout } = process;",
        "const p = process; p.stdout.write(url);",
        "const ok = process.env.X; void process.pid;",
      ].join("\n");
      expect(logSitesIn("mcp/src/x.ts", src).map((s) => s.call)).toEqual([
        "process.stderr.write(url)",
        "process.stdout.write(url)",
        'process["stderr"].write(url)',
        "process.stderr (as a value): e = process.stderr",
        "process (as a value): { stdout } = process",
        "process (as a value): p = process",
      ]);
    });

    it("a logger used as a value: copied under another name, passed, returned, shorthand, destructured", () => {
      const src = [
        "const say = o.log; say(url);",
        "f(log);",
        "const g = () => deps.log;",
        "new T({ log });",
        "const { log: w } = options;",
        "function h({ log }: { log: (m: string) => void }) { void log; }",
      ].join("\n");
      expect(logSitesIn("daemon/src/x.ts", src).map((s) => s.call)).toEqual([
        "log (as a value): say = o.log",
        "log (as a value): f(log)",
        "log (as a value): () => deps.log",
        "log (as a value): { log }",
        "log (destructured): { log: w }",
        "log (destructured): { log }",
        "log (as a value): void log",
      ]);
    });

    it(".call / .apply / .bind on a logger, called or passed", () => {
      const src = ["log.call(null, url);", "this.deps.log.apply(null, [url]);", "log.bind(null)(url);", "const b = log.bind;"].join("\n");
      expect(logSitesIn("daemon/src/x.ts", src).map((s) => s.call)).toEqual([
        "log.call(null, url)",
        "this.deps.log.apply(null, [url])",
        "log.bind(null)",
        "log (as a value): log.bind",
      ]);
    });

    it("a logger injected under a level name: deps.warn?.(), options.error(), a bare debug(), warn.call()", () => {
      const src = ["this.deps.warn?.(url);", "options.error(url);", "debug(url);", "deps.info.call(null, url);"].join("\n");
      expect(logSitesIn("daemon/src/x.ts", src).map((s) => s.call)).toEqual([
        "this.deps.warn?.(url)",
        "options.error(url)",
        "debug(url)",
        "deps.info.call(null, url)",
      ]);
    });

    it("not sites: another object named log (the network log's log.query), names in declarations and imports", () => {
      const src = [
        'import { log } from "./network-state.js";',
        "log.query({});",
        "log.clear(scope);",
        "interface D { log?: (m: string) => void }",
        "const o = { log: 1 };",
        "console.log.length;",
      ].join("\n");
      expect(logSitesIn("extension/src/x.ts", src).map((s) => s.call)).toEqual(["console (as a value): console.log"]);
    });

    it("whitespace and line breaks do not change a site's text", () => {
      const a = logSitesIn("f.ts", 'console.warn(\n  "a",\n    b,\n)').map((s) => s.call);
      expect(a).toEqual(['console.warn( "a", b, )']);
    });
  });
});
