// Step 15 S2: the doctor inside the installed npm package (mode "package") and the token line's source. Facts are
// injected; no real bridge, config or token.
import { describe, expect, it } from "vitest";
import { doctorLines, mcpDecision } from "../bridge/lib.mjs";

const PKG = "C:\\proj\\node_modules\\browser-agent-bridge";
const USER_FILE = "C:\\Users\\x\\AppData\\Roaming\\browser-agent-bridge\\bridge.token";
const npxEntry = { mcpServers: { "browser-agent-bridge": { command: "npx", args: ["-y", "browser-agent-bridge"] } } };
const pkgGreen = {
  mode: "package" as const, pkgVersion: "0.2.0", userTokenFile: USER_FILE, tokenSource: "user" as const,
  node: "22.11.0", build: { missing: false, stale: false }, token: "ok" as const,
  mcp: mcpDecision(npxEntry, PKG, { tokenFile: "T1" }), shellToken: "none" as const, shellPort: "none" as const,
  daemon: { state: "up" as const, buildSame: true, extensionConnected: true }, extensionOlder: null, port: "9234",
};
const at = (f: Record<string, unknown>, name: string) =>
  doctorLines({ ...pkgGreen, ...f } as never).find((l) => l.name === name);

describe("doctor in the installed package", () => {
  it("every part working → every line ok; a Package line instead of Build; no extension-build heuristic", () => {
    const lines = doctorLines(pkgGreen);
    expect(lines.map((l) => l.name)).toEqual(["Node.js", "Package", "Token file", "MCP entry", "Daemon", "Extension"]);
    expect(lines.every((l) => l.level === "ok" && l.fix === "")).toBe(true);
    expect(lines[1].detail).toContain("0.2.0");
    expect(lines[2].detail).toMatch(/per-user.*not shown/);
  });
  it("any user-scope entry counts (its path is not this package's to judge); none → the npx command", () => {
    expect(at({}, "MCP entry")).toMatchObject({ level: "ok" });
    const none = at({ mcp: mcpDecision({}, PKG, { tokenFile: "T1" }) }, "MCP entry")!;
    expect(none.level).toBe("fail");
    expect(none.fix).toBe("claude mcp add -s user browser-agent-bridge -- npx -y browser-agent-bridge");
  });
  it("an old chrome-agent-bridge entry still fails", () => {
    const old = mcpDecision({ mcpServers: { "chrome-agent-bridge": npxEntry.mcpServers["browser-agent-bridge"] } }, PKG, { tokenFile: "T1" });
    expect(at({ mcp: old }, "MCP entry")).toMatchObject({ level: "fail", detail: expect.stringMatching(/old name/) });
  });
  it("no token → the fix names the per-user file and BRIDGE_TOKEN, never npm run setup", () => {
    const l = at({ token: "missing", tokenSource: null }, "Token file")!;
    expect(l.level).toBe("fail");
    expect(l.fix).toContain(USER_FILE);
    expect(l.fix).toContain("BRIDGE_TOKEN");
    expect(l.fix).not.toContain("npm run setup");
    expect(at({ daemon: { state: "notoken" } }, "Daemon")!.fix).not.toContain("npm run setup");
  });
});

describe("the token line names where the token was found", () => {
  it("clone mode: the per-user file or the checkout's bridge.token", () => {
    const base = { ...pkgGreen, mode: "clone" as const };
    expect(doctorLines({ ...base, tokenSource: "user" }).find((l) => l.name === "Token file")!.detail).toMatch(/per-user/);
    expect(doctorLines({ ...base, tokenSource: "clone" }).find((l) => l.name === "Token file")!.detail).toBe("bridge.token present (not shown)");
  });
});
