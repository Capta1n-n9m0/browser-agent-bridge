// Step 14 S2b: the doctor's verdict lines (scripts/bridge/lib.mjs). Facts are injected; no real bridge, config or log.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { doctorLines, extensionOlder, formatLine, lastResyncMs, mcpDecision } from "../bridge/lib.mjs";

const REPO = "C:\\Users\\x\\Projects\\bridge";
const okEntry = { mcpServers: { "browser-agent-bridge": { command: "node", args: [`${REPO}\\mcp\\dist\\index.js`] } } };
const green = {
  node: "22.11.0", build: { missing: false, stale: false }, token: "ok" as const,
  mcp: mcpDecision(okEntry, REPO, { tokenFile: "T1" }), shellToken: "none" as const, shellPort: "none" as const,
  daemon: { state: "up" as const, buildSame: true, extensionConnected: true }, extensionOlder: false, port: "9234",
};
const at = (f: Record<string, unknown>, name: string) =>
  doctorLines({ ...green, ...f } as never).find((l) => l.name === name);

describe("doctor verdict lines", () => {
  it("every part working → every line ok, nothing to fix", () => {
    const lines = doctorLines(green);
    expect(lines.map((l) => l.name)).toEqual(["Node.js", "Build", "Token file", "MCP entry", "Daemon", "Extension",
      "Extension build (heuristic)"]);
    expect(lines.every((l) => l.level === "ok" && l.fix === "")).toBe(true);
  });
  it.each([
    ["Node.js", { node: "18.20.0" }, /Node\.js 20/],
    ["Build", { build: { missing: true, stale: true } }, /npm run build/],
    ["Build", { build: { missing: false, stale: true } }, /npm run build.*reload/],
    ["Token file", { token: "missing" }, /npm run setup/],
    ["MCP entry", { mcp: null }, /\.claude\.json/],
    ["MCP entry", { mcp: mcpDecision({}, REPO, { tokenFile: "T1" }) }, /npm run setup$/],
    ["MCP entry", { mcp: mcpDecision({ mcpServers: { "browser-agent-bridge": { command: "node", args: ["D:\\old\\i.js"] } } },
      REPO, { tokenFile: "T1" }) }, /--replace-mcp/],
    ["Daemon", { daemon: { state: "refused" } }, /token/],
    ["Daemon", { daemon: { state: "error", detail: "ETIMEDOUT" } }, /9234/],
    ["Extension", { daemon: { state: "up", buildSame: true, extensionConnected: false } }, /Options.*9234/],
  ])("%s fails with its fix (%#)", (name, f, fix) => {
    const l = at(f, name)!;
    expect(l.level).toBe("fail");
    expect(l.fix).toMatch(fix);
  });
  it("the entry's BRIDGE_TOKEN differing, a local-scope leftover, a shell token or port differing → fail lines with fixes", () => {
    const mcp = { ...green.mcp, envToken: "differs" as const, localLeftovers: ["C:/w"] };
    const lines = doctorLines({ ...green, mcp, shellToken: "differs", shellPort: "differs" });
    const bad = lines.filter((l) => l.level === "fail");
    expect(bad.map((l) => l.name)).toEqual(["MCP entry's token", "Local MCP entry", "Shell BRIDGE_TOKEN", "Shell BRIDGE_PORT"]);
    expect(bad.every((l) => l.fix.length > 0 && /differs|wins/.test(l.detail))).toBe(true);
    expect(bad[1].fix).toContain("claude mcp remove -s local browser-agent-bridge");
  });
  it("an old chrome-agent-bridge entry fails with setup as the fix; alone, it replaces the MCP entry line", () => {
    const old = mcpDecision({ mcpServers: { "chrome-agent-bridge": okEntry.mcpServers["browser-agent-bridge"] } }, REPO, { tokenFile: "T1" });
    const lines = doctorLines({ ...green, mcp: old });
    expect(lines.find((l) => l.name === "MCP entry")).toMatchObject({ level: "fail",
      detail: expect.stringMatching(/chrome-agent-bridge.*old name/), fix: expect.stringMatching(/npm run setup.*browser-agent-bridge/) });
    expect(lines.filter((l) => l.name === "MCP entry")).toHaveLength(1);
    const both = mcpDecision({ mcpServers: { ...okEntry.mcpServers, "chrome-agent-bridge": { command: "node", args: ["D:\\o.js"] } } },
      REPO, { tokenFile: "T1" });
    const l2 = doctorLines({ ...green, mcp: both });
    expect(l2.find((l) => l.name === "MCP entry")).toMatchObject({ level: "ok" });
    expect(l2.find((l) => l.name === "Old MCP entry")).toMatchObject({ level: "fail", fix: expect.stringMatching(/npm run setup/) });
    const local = mcpDecision({ ...okEntry, projects: { "C:/w": { mcpServers: { "chrome-agent-bridge": {} } } } }, REPO, { tokenFile: "T1" });
    expect(doctorLines({ ...green, mcp: local }).find((l) => l.name === "Local MCP entry")!.fix)
      .toContain("claude mcp remove -s local chrome-agent-bridge");
  });
  it("same-valued copies never fail; the entry's equal token is OK (R4.1), the env entry optional", () => {
    const lines = doctorLines({ ...green, mcp: { ...green.mcp, envToken: "same" }, shellToken: "same", shellPort: "same" });
    expect(lines.filter((l) => l.level === "fail")).toEqual([]);
    expect(lines.find((l) => l.name === "MCP entry's token")).toMatchObject({ level: "ok", detail: expect.stringMatching(/equals bridge\.token.*optional/) });
  });
  it("no bridge.token: the entry's token is used, never 'differs'; the fix is setup, not removing it", () => {
    const mcp = mcpDecision({ mcpServers: { "browser-agent-bridge": { ...okEntry.mcpServers["browser-agent-bridge"], env: { BRIDGE_TOKEN: "x" } } } },
      REPO, { tokenFile: null });
    expect(mcp.envToken).toBe("nofile");
    const l = at({ token: "missing", mcp }, "MCP entry's token")!;
    expect(l).toMatchObject({ level: "hint", detail: expect.stringMatching(/entry's own token is used/) });
    expect(l.fix).toMatch(/npm run setup.*only if/);
  });
  it("no token at all → the Daemon is not checked and the fix is setup, not netstat", () => {
    expect(at({ daemon: { state: "notoken" } }, "Daemon")).toMatchObject({ level: "hint", fix: "run npm run setup" });
  });
  it("the fixes name the port the MCP uses", () => {
    expect(at({ port: "9299", daemon: { state: "error", detail: "x" } }, "Daemon")!.fix).toMatch(/port 9299.*findstr 9299/);
    expect(at({ port: "9299", daemon: { state: "up", buildSame: true, extensionConnected: false } }, "Extension")!.fix).toMatch(/port 9299/);
  });
  it("no daemon → hint, never spawned; the extension is then not checked", () => {
    const lines = doctorLines({ ...green, daemon: { state: "down" } });
    expect(lines.find((l) => l.name === "Daemon")).toMatchObject({ level: "hint", detail: expect.stringMatching(/not running/) });
    expect(lines.find((l) => l.name === "Extension")!.level).toBe("hint");
    expect(lines.find((l) => l.name === "Extension build (heuristic)")).toBeUndefined();
  });
  it("a daemon on another build → hint: the next client hands it over (/mcp)", () => {
    expect(at({ daemon: { state: "up", buildSame: false, extensionConnected: true } }, "Daemon"))
      .toMatchObject({ level: "hint", fix: expect.stringMatching(/\/mcp/) });
  });
  it("#432: sw.js newer than the last resync, or no resync seen → 'may be older than the build — reload it'", () => {
    for (const older of [true, null]) {
      const l = at({ extensionOlder: older }, "Extension build (heuristic)")!;
      expect(l.level).toBe("hint");
      expect(l.detail).toMatch(/may be older than the build/);
      expect(l.fix).toMatch(/reload/);
    }
  });
  it("#432 OK claims only a resync after the build, not a reload", () => {
    expect(at({}, "Extension build (heuristic)")!.detail).toMatch(/resynced after the last build.*cannot tell/);
  });
  it("#432 direction: sw.js ≥ 1 s after the last resync → older; same second or before → not; unknown → null", () => {
    expect(extensionOlder(11_000, 10_000)).toBe(true);
    expect(extensionOlder(10_999, 10_000)).toBe(false);
    expect(extensionOlder(5_000, 10_000)).toBe(false);
    expect(extensionOlder(null, 10_000)).toBeNull();
    expect(extensionOlder(11_000, null)).toBeNull();
  });
  it("formatLine prints level, name, detail and the fix", () => {
    expect(formatLine({ name: "Build", level: "fail", detail: "stale", fix: "run x" })).toBe("FAIL Build: stale - run x");
    expect(formatLine({ name: "Node.js", level: "ok", detail: "v22", fix: "" })).toBe("OK   Node.js: v22");
  });
});

describe("the daemon log's last extension resync", () => {
  it("takes the last resync line's stamp; none → null", () => {
    const log = ["2026-10-30T10:00:00Z config pid=1", "2026-10-30T10:00:05Z extension resync: 3 tabs, 0 gone",
      "2026-10-30T11:00:07Z extension resync: 4 tabs, 1 gone", "2026-10-30T11:00:09Z client hello"].join("\r\n");
    expect(lastResyncMs(log)).toBe(Date.parse("2026-10-30T11:00:07Z"));
    expect(lastResyncMs("2026-10-30T10:00:00Z config\n")).toBeNull();
    expect(lastResyncMs("")).toBeNull();
  });
});

describe("the doctor never spawns or hands over a daemon (Stage0.md m4)", () => {
  it("its source has no connect(), knock, spawn or daemon.shutdown, and asks only daemon.status", () => {
    const src = readFileSync(path.join(__dirname, "..", "bridge", "doctor.ts"), "utf8");
    for (const bad of [/\bconnect\(/, /\bknock\(/, /spawnDaemon/, /daemon\.shutdown/, /claude(\.exe)?["'`]/]) expect(src).not.toMatch(bad);
    expect(src).toContain('"daemon.status"');
  });
});
