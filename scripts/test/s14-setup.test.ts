// Step 14 S2a: the pure logic of `npm run setup` (scripts/bridge/lib.mjs). No real config, no real CLI.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILD_INPUTS, BUILD_OUTPUTS, LIFECYCLE_NAMES, buildNeeded, checkPrereqs, claudeConfigPath, finish, installNeeded,
  LEGACY_SERVER_NAMES, mcpAddArgv, mcpDecision, mcpEntry, mcpRemoveArgv, nextSteps, tokenDecision,
} from "../bridge/lib.mjs";

const REPO = "C:\\Users\\x\\Projects\\bridge";
const ENTRY = `${REPO}\\mcp\\dist\\index.js`;
const entry = (arg: string, env?: Record<string, string>) => ({ command: "node", args: [arg], ...(env ? { env } : {}) });

describe("prerequisites", () => {
  const ok = { node: "22.11.0", npm: "10.9.0", git: "git version 2.52.0", chrome: true };
  it("all present → every line ok; Node 20.0.0 is the floor", () => {
    expect(checkPrereqs(ok).every((l) => l.level === "ok")).toBe(true);
    expect(checkPrereqs({ ...ok, node: "20.0.0" })[0].level).toBe("ok");
    expect(checkPrereqs({ ...ok, node: "19.9.0" })[0].level).toBe("fail");
  });
  it("old Node, missing npm or git → fail with a fix; missing Chrome → hint only", () => {
    const lines = checkPrereqs({ node: "18.20.0", npm: null, git: null, chrome: false });
    expect(lines.map((l) => [l.name, l.level])).toEqual([
      ["Node.js", "fail"], ["npm", "fail"], ["git", "fail"], ["Chrome", "hint"],
    ]);
    expect(lines.every((l) => l.level === "ok" || l.fix.length > 0)).toBe(true);
  });
});

describe("token file, npm ci, config path", () => {
  it("keeps a non-empty token, creates when missing or blank", () => {
    expect(tokenDecision("abc\n")).toBe("keep");
    expect(tokenDecision(null)).toBe("create");
    expect(tokenDecision("  \r\n")).toBe("create");
  });
  it("npm ci only when the installed tree is missing or older than package-lock.json", () => {
    expect([installNeeded(100, null), installNeeded(100, 50), installNeeded(100, 100), installNeeded(100, 200)])
      .toEqual([true, true, false, false]);
  });
  it("build skipped only when every output exists and is strictly newer than every input (S2a F1)", () => {
    expect(buildNeeded([300, 400], [100, 200])).toBe(false);
    expect([buildNeeded([300, null], [100]), buildNeeded([300, 400], [100, 300]), buildNeeded([300, 400], [500]),
      buildNeeded([], [100]), buildNeeded([300], [])]).toEqual([true, true, true, true, true]);
  });
  it("the build's inputs cover every workspace's sources and configs and the lock; outputs are the six bundles", () => {
    for (const w of ["shared", "daemon", "sdk", "mcp", "extension"])
      for (const f of ["src", "package.json", "tsconfig.json", "build.mjs"]) expect(BUILD_INPUTS).toContain(`${w}/${f}`);
    expect(BUILD_INPUTS).toEqual(expect.arrayContaining(["package-lock.json", "node_modules/.package-lock.json", "tsconfig.base.json"]));
    expect(BUILD_OUTPUTS.sort()).toEqual(["daemon/dist/index.js", "extension/dist/content.js", "extension/dist/offscreen.js",
      "extension/dist/options.js", "extension/dist/sw.js", "mcp/dist/index.js"]);
  });
  it("a failed part ends setup with exit 2 and names it; none → 0 (S2a F2)", () => {
    expect(finish([])).toEqual({ code: 0, line: "" });
    const f = finish(["MCP registration", "claude add"]);
    expect(f.code).toBe(2);
    expect(f.line).toContain("MCP registration; claude add");
  });
  it("default ~\\.claude.json, else <CLAUDE_CONFIG_DIR>\\.claude.json (as the CLI)", () => {
    expect(claudeConfigPath({}, "C:\\Users\\x")).toBe("C:\\Users\\x\\.claude.json");
    expect(claudeConfigPath({ CLAUDE_CONFIG_DIR: "D:\\cfg" }, "C:\\Users\\x")).toBe("D:\\cfg\\.claude.json");
  });
});

describe("MCP entry decision", () => {
  const tok = { tokenFile: "T1" };
  it("no entry → add", () => {
    expect(mcpDecision({}, REPO, tok).action).toBe("add");
    expect(mcpDecision({ mcpServers: {} }, REPO, tok).action).toBe("add");
  });
  it("same path, normalized (case, slashes, trailing slash) → leave", () => {
    const cfg = { mcpServers: { "browser-agent-bridge": entry("c:/users/X/projects/bridge/mcp/dist/index.js/") } };
    expect(mcpDecision(cfg, REPO, tok).action).toBe("leave");
  });
  it("this checkout's path under a command that is not node → report (S2a F7)", () => {
    const cfg = { mcpServers: { "browser-agent-bridge": { command: "npx", args: [ENTRY] } } };
    expect(mcpDecision(cfg, REPO, tok).action).toBe("report");
    const full = { mcpServers: { "browser-agent-bridge": { command: "C:\\Program Files\\nodejs\\NODE.EXE", args: [ENTRY] } } };
    expect(mcpDecision(full, REPO, tok).action).toBe("leave");
  });
  it("different path → report; replace only with the flag", () => {
    const cfg = { mcpServers: { "browser-agent-bridge": entry("D:\\old\\server\\dist\\index.js") } };
    expect(mcpDecision(cfg, REPO, tok)).toMatchObject({ action: "report", existing: "D:\\old\\server\\dist\\index.js" });
    expect(mcpDecision(cfg, REPO, { ...tok, replace: true }).action).toBe("replace");
  });
  it("a local-scope leftover under projects is reported", () => {
    const cfg = { projects: { "C:/w": { mcpServers: { "browser-agent-bridge": entry(ENTRY) } }, "C:/v": {} } };
    expect(mcpDecision(cfg, REPO, tok)).toMatchObject({ action: "add", localLeftovers: ["C:/w"] });
  });
  it("the entry's BRIDGE_TOKEN is compared by equality only, never returned", () => {
    const at = (t: string) => ({ mcpServers: { "browser-agent-bridge": entry(ENTRY, { BRIDGE_TOKEN: t }) } });
    expect(mcpDecision(at("T1"), REPO, tok).envToken).toBe("same");
    const d = mcpDecision(at("SECRET-OTHER"), REPO, tok);
    expect(d.envToken).toBe("differs");
    expect(JSON.stringify(d)).not.toContain("SECRET-OTHER");
    expect(mcpDecision({}, REPO, tok).envToken).toBe("none");
  });
});

describe("the old chrome-agent-bridge entry (Step 15 S1 rename)", () => {
  const tok = { tokenFile: "T1" };
  it("an old user-scope entry alone → replace (even without the flag), the old name listed for removal", () => {
    const cfg = { mcpServers: { "chrome-agent-bridge": entry(ENTRY) } };
    expect(mcpDecision(cfg, REPO, tok)).toMatchObject({ action: "replace", current: false, legacy: ["chrome-agent-bridge"] });
  });
  it("the old entry's token is judged like the current entry's", () => {
    const cfg = { mcpServers: { "chrome-agent-bridge": entry(ENTRY, { BRIDGE_TOKEN: "SECRET-OTHER" }) } };
    const d = mcpDecision(cfg, REPO, tok);
    expect(d.envToken).toBe("differs");
    expect(JSON.stringify(d)).not.toContain("SECRET-OTHER");
    expect(mcpEntry(cfg)).toBe(cfg.mcpServers["chrome-agent-bridge"]);
  });
  it("both names → the current entry decides, the old one is still listed for removal", () => {
    const cfg = { mcpServers: { "browser-agent-bridge": entry(ENTRY), "chrome-agent-bridge": entry("D:\\old\\i.js") } };
    expect(mcpDecision(cfg, REPO, tok)).toMatchObject({ action: "leave", current: true, legacy: ["chrome-agent-bridge"] });
    expect(mcpEntry(cfg)).toBe(cfg.mcpServers["browser-agent-bridge"]);
  });
  it("no old entry → legacy is empty and current says whether the entry exists", () => {
    expect(mcpDecision({}, REPO, tok)).toMatchObject({ action: "add", current: false, legacy: [], legacyLocal: [] });
  });
  it("an old local-scope entry is reported with its name", () => {
    const cfg = { projects: { "C:/w": { mcpServers: { "chrome-agent-bridge": entry(ENTRY) } } } };
    expect(mcpDecision(cfg, REPO, tok)).toMatchObject({ localLeftovers: [], legacyLocal: [{ dir: "C:/w", name: "chrome-agent-bridge" }] });
  });
  it("the remove argv names the server at user scope", () => {
    expect(mcpRemoveArgv("chrome-agent-bridge")).toEqual(["mcp", "remove", "-s", "user", "chrome-agent-bridge"]);
    expect(LEGACY_SERVER_NAMES).toEqual(["chrome-agent-bridge"]);
  });
});

describe("the claude mcp add argv", () => {
  it("is exactly user scope, node <repo>\\mcp\\dist\\index.js, no -e", () => {
    expect(mcpAddArgv(REPO)).toEqual(["mcp", "add", "-s", "user", "browser-agent-bridge", "--", "node", ENTRY]);
  });
});

describe("next steps", () => {
  it("names the folder to load, the port and where to paste", () => {
    const text = nextSteps(REPO, { copied: false });
    expect(text).toMatch(/choose the folder C:\\Users\\x\\Projects\\bridge\\extension$/m);
    expect(text).toMatch(/Pin the extension's toolbar button.*kill switch.*Alt\+Shift\+K/);
    expect(text).toContain("9234");
    expect(text).toContain("chrome://extensions");
    expect(text).toMatch(/Options/);
    expect(text).toContain("bridge.token");
    expect(nextSteps(REPO, { copied: true })).toMatch(/clipboard/);
  });
});

describe("root package.json", () => {
  it("no script takes an npm lifecycle name (npm ci would run it)", () => {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
    const names = Object.keys(pkg.scripts);
    expect(names).toContain("setup");
    expect(names.filter((n) => LIFECYCLE_NAMES.includes(n))).toEqual([]);
  });
});
