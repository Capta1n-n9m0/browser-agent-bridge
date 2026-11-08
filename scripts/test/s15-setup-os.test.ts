// Step 15 S3: setup and doctor on three OSes. Every fact (platform, env, home, registry output) is injected.
import { describe, expect, it } from "vitest";
import { userTokenFile as sdkUserTokenFile } from "../../sdk/src/token.js";
import {
  ALLOWED_EXTENSION_IDS, chromeCandidates, checkPrereqs, claudeConfigPath, doctorLines, entryPath, EXTENSION_ID, EXTENSION_ORIGIN, isNpxEntry,
  manifestOrigins, mcpAddArgv, mcpDecision, nativeHostPlan, nextSteps, npmCli, NATIVE_HOST_NAME, parseRegDefault, regAddArgv, regQueryArgv, tokenPlan, userTokenFile,
} from "../bridge/lib.mjs";

describe("tokenPlan (#449)", () => {
  it.each([
    [{ user: "a\n", repo: null }, "keep"],
    [{ user: "a", repo: "" }, "keep"],
    [{ user: null, repo: "b\n" }, "move"],
    [{ user: "  ", repo: "b" }, "move"],
    [{ user: null, repo: null }, "create"],
    [{ user: "", repo: "  \n" }, "create"],
    [{ user: "a", repo: "b" }, "keep-both-differ"],
    [{ user: "a\n", repo: "a" }, "keep-remove-repo"],
  ])("%j → %s", (f, want) => expect(tokenPlan(f)).toBe(want));
});

describe("userTokenFile agrees with the SDK's", () => {
  const cases: [Record<string, string>, NodeJS.Platform][] = [
    [{ APPDATA: "C:\\Users\\x\\AppData\\Roaming" }, "win32"],
    [{ USERPROFILE: "C:\\Users\\x" }, "win32"],
    [{}, "win32"],
    [{ HOME: "/Users/x" }, "darwin"],
    [{}, "darwin"],
    [{ HOME: "/home/x" }, "linux"],
    [{ HOME: "/home/x", XDG_CONFIG_HOME: "/cfg" }, "linux"],
    [{ HOME: "/home/x", XDG_CONFIG_HOME: "rel" }, "linux"],
    [{ XDG_CONFIG_HOME: "/cfg" }, "linux"],
    [{ HOME: "  " }, "linux"],
  ];
  it.each(cases)("%j on %s", (env, platform) => expect(userTokenFile(env, platform)).toBe(sdkUserTokenFile(env, platform)));
});

describe("platform-aware paths", () => {
  it("claudeConfigPath", () => {
    expect(claudeConfigPath({}, "/home/x", "linux")).toBe("/home/x/.claude.json");
    expect(claudeConfigPath({ CLAUDE_CONFIG_DIR: "/c" }, "/Users/x", "darwin")).toBe("/c/.claude.json");
    expect(claudeConfigPath({}, "C:\\Users\\x", "win32")).toBe("C:\\Users\\x\\.claude.json");
  });
  it("entryPath, and the clone entry is case-sensitive off Windows only", () => {
    expect(entryPath("/r", "linux")).toBe("/r/mcp/dist/index.js");
    const cfg = (p: string) => ({ mcpServers: { "browser-agent-bridge": { command: "node", args: [p] } } });
    expect(mcpDecision(cfg("/R/mcp/dist/index.js"), "/r", { tokenFile: null, platform: "linux" }).action).toBe("report");
    expect(mcpDecision(cfg("/r/mcp/dist/index.js/"), "/r", { tokenFile: null, platform: "linux" }).action).toBe("leave");
    expect(mcpDecision(cfg("C:\\R\\mcp\\dist\\index.js"), "c:\\r", { tokenFile: null, platform: "win32" }).action).toBe("leave");
  });
  it("npmCli splits PATH by platform", () => {
    expect(npmCli({ PATH: "/a:/b" }, "/n/bin/node", (f) => f === "/b/node_modules/npm/bin/npm-cli.js", "linux")).toBe("/b/node_modules/npm/bin/npm-cli.js");
  });
  it("nextSteps names the platform's editor, paste key and the package's own texts", () => {
    expect(nextSteps("/r", { copied: false, platform: "linux", tokenFile: "/h/t" })).toMatch(/open \/h\/t in a text editor/);
    expect(nextSteps("/r", { copied: true, platform: "darwin" })).toContain("Cmd+V");
    const pkg = nextSteps("/r", { copied: false, platform: "linux", mode: "package", tokenFile: "/h/t" });
    expect(pkg).toContain("npx browser-agent-bridge setup");
    expect(pkg).not.toContain("npm run setup");
  });
});

describe("prerequisites per OS", () => {
  it("Chrome candidates", () => {
    expect(chromeCandidates("win32", { ProgramFiles: "C:\\PF", "ProgramFiles(x86)": "C:\\PF86", LOCALAPPDATA: "C:\\L" }).files).toEqual([
      "C:\\PF\\Google\\Chrome\\Application\\chrome.exe", "C:\\PF86\\Google\\Chrome\\Application\\chrome.exe", "C:\\L\\Google\\Chrome\\Application\\chrome.exe"]);
    expect(chromeCandidates("darwin", { HOME: "/Users/x" }).files).toEqual(["/Applications/Google Chrome.app", "/Users/x/Applications/Google Chrome.app"]);
    expect(chromeCandidates("linux", {})).toEqual({ files: [], onPath: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"] });
  });
  it("the package needs no git; the git fix is not Windows-only", () => {
    const found = { node: "22.0.0", npm: "10", git: null, chrome: true };
    expect(checkPrereqs(found, { mode: "package" }).map((l) => l.name)).toEqual(["Node.js", "npm", "Chrome"]);
    expect(checkPrereqs(found)[2].fix).not.toMatch(/Windows/);
  });
});

describe("MCP entry in the package", () => {
  it("argv: npx, with cmd /c only on win32", () => {
    expect(mcpAddArgv("", { mode: "package", platform: "linux" })).toEqual(["mcp", "add", "-s", "user", "browser-agent-bridge", "--", "npx", "-y", "browser-agent-bridge"]);
    expect(mcpAddArgv("", { mode: "package", platform: "win32" }).slice(5)).toEqual(["--", "cmd", "/c", "npx", "-y", "browser-agent-bridge"]);
    expect(mcpAddArgv("/r", { platform: "darwin" }).slice(5)).toEqual(["--", "node", "/r/mcp/dist/index.js"]);
  });
  it("leave for either npx form, report for a clone path, replace with the flag", () => {
    const e = (command: string, args: string[]) => ({ mcpServers: { "browser-agent-bridge": { command, args } } });
    const o = { tokenFile: null, mode: "package" as const, platform: "win32" };
    expect(mcpDecision(e("npx", ["-y", "browser-agent-bridge"]), "", o).action).toBe("leave");
    expect(mcpDecision(e("cmd", ["/c", "npx", "-y", "browser-agent-bridge"]), "", o).action).toBe("leave");
    const clone = e("node", ["C:\\r\\mcp\\dist\\index.js"]);
    expect(mcpDecision(clone, "", o).action).toBe("report");
    expect(mcpDecision(clone, "", { ...o, replace: true }).action).toBe("replace");
    expect(mcpDecision({ mcpServers: { "chrome-agent-bridge": { command: "node", args: ["x"] } } }, "", o).action).toBe("replace");
    expect(isNpxEntry({ command: "node", args: ["browser-agent-bridge"] })).toBe(false);
  });
});

describe("nativeHostPlan", () => {
  const base = { mode: "package" as const, nodePath: "/n/node" };
  it("linux: manifest under ~/.config/google-chrome, sh launcher beside the token, allowed_origins = the fixed ID only", () => {
    const p = nativeHostPlan({ ...base, platform: "linux", env: { HOME: "/home/x" }, home: "/home/x", root: "/pk" })!;
    expect(p.manifestPath).toBe(`/home/x/.config/google-chrome/NativeMessagingHosts/${NATIVE_HOST_NAME}.json`);
    expect(p.launcherPath).toBe("/home/x/.config/browser-agent-bridge/native-host.sh");
    expect(p.launcherText).toBe('#!/bin/sh\nexec "/n/node" "/pk/dist/native-host.js" "$@"\n');
    expect(p.launcherMode).toBe(0o755);
    expect(p.manifest).toEqual({ name: NATIVE_HOST_NAME, description: expect.any(String), path: p.launcherPath, type: "stdio", allowed_origins: ["chrome-extension://iifofgbdljchbdimlalhphmedfmocela/"] });
    expect(EXTENSION_ORIGIN).toBe(`chrome-extension://${EXTENSION_ID}/`);
    expect(ALLOWED_EXTENSION_IDS).toEqual([EXTENSION_ID]);
    expect(p.registry).toBeUndefined();
  });
  it("darwin: Application Support manifest; the clone's script is scripts/native-host/host.mjs", () => {
    const p = nativeHostPlan({ ...base, mode: "clone", platform: "darwin", env: { HOME: "/Users/x" }, home: "/Users/x", root: "/repo" })!;
    expect(p.manifestPath).toBe(`/Users/x/Library/Application Support/Google/Chrome/NativeMessagingHosts/${NATIVE_HOST_NAME}.json`);
    expect(p.launcherPath).toBe("/Users/x/Library/Application Support/browser-agent-bridge/native-host.sh");
    expect(p.scriptPath).toBe("/repo/scripts/native-host/host.mjs");
  });
  it("win32: manifest and bat in the per-user folder, CRLF launcher, registry key to the manifest", () => {
    const p = nativeHostPlan({ ...base, platform: "win32", env: { APPDATA: "C:\\A" }, home: null, root: "C:\\pk", nodePath: "C:\\n\\node.exe" })!;
    expect(p.manifestPath).toBe(`C:\\A\\browser-agent-bridge\\${NATIVE_HOST_NAME}.json`);
    expect(p.launcherPath).toBe("C:\\A\\browser-agent-bridge\\native-host.bat");
    expect(p.launcherText).toBe('@echo off\r\n"C:\\n\\node.exe" "C:\\pk\\dist\\native-host.js" %*\r\n');
    expect(p.registry).toEqual({ key: `HKCU\\SOFTWARE\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`, value: p.manifestPath });
    expect(regAddArgv(p.registry!)).toEqual(["add", p.registry!.key, "/ve", "/t", "REG_SZ", "/d", p.manifestPath, "/f"]);
    expect(regQueryArgv("K")).toEqual(["query", "K", "/ve"]);
  });
  it("no home → null", () => {
    expect(nativeHostPlan({ ...base, platform: "linux", env: {}, home: null, root: "/pk" })).toBeNull();
  });
  it("parseRegDefault", () => {
    expect(parseRegDefault("\r\nHKEY_CURRENT_USER\\X\r\n    (Default)    REG_SZ    C:\\A B\\m.json\r\n")).toBe("C:\\A B\\m.json");
    expect(parseRegDefault("")).toBeNull();
  });
});

describe("doctor lines per OS", () => {
  const base = {
    node: "22.0.0", build: { missing: false, stale: false }, token: "ok" as const, mode: "package" as const, pkgVersion: "0.2.0",
    mcp: mcpDecision({ mcpServers: { "browser-agent-bridge": { command: "npx", args: ["-y", "browser-agent-bridge"] } } }, "", { tokenFile: "T", mode: "package" }),
    shellToken: "none" as const, shellPort: "none" as const, daemon: { state: "up" as const, buildSame: true, extensionConnected: true },
    extensionOlder: null, port: "9234", tokenSource: "user" as const, userTokenFile: "/h/t",
  };
  const nh = (nativeHost: object, platform = "linux") => doctorLines({ ...base, platform, nativeHost } as never).find((l) => l.name === "Native host")!;
  const host = { manifest: true, manifestPath: "/m", launcher: true, script: true, origins: [`chrome-extension://${EXTENSION_ID}/`] };
  it("native host (S4): missing, registry missing/elsewhere, wrong origins, missing script or launcher, ok", () => {
    // Every problem is a hint: a token pasted in Options still works without the host.
    expect(nh({ ...host, manifest: false, origins: null })).toMatchObject({ level: "hint", detail: expect.stringMatching(/cannot pair/),
      fix: expect.stringMatching(/npx browser-agent-bridge setup.*paste the token/) });
    expect(nh({ ...host, registry: "missing" }, "win32")).toMatchObject({ level: "hint", detail: expect.stringMatching(/^registry key missing/) });
    expect(nh({ ...host, registry: "elsewhere" }, "win32")).toMatchObject({ level: "hint", detail: "registry key points at another manifest" });
    for (const origins of [[], null, ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"], [host.origins[0], "chrome-extension://x/"]])
      expect(nh({ ...host, origins }), JSON.stringify(origins)).toMatchObject({ level: "hint", detail: expect.stringMatching(/does not admit/) });
    expect(nh({ ...host, script: false })).toMatchObject({ level: "hint", detail: expect.stringMatching(/host script is missing/) });
    expect(nh({ ...host, launcher: false })).toMatchObject({ level: "hint", detail: expect.stringMatching(/launcher is missing/) });
    expect(nh({ ...host, registry: "ok" }, "win32")).toMatchObject({ level: "ok", detail: "registered for this extension's ID" });
    expect(nh(host).level).toBe("ok");
    for (const l of doctorLines({ ...base, platform: "linux", nativeHost: host } as never)) expect(l.detail).not.toMatch(/later version/);
  });
  it("manifestOrigins reads allowed_origins, null otherwise", () => {
    expect(manifestOrigins(JSON.stringify({ allowed_origins: ["a"] }))).toEqual(["a"]);
    expect(manifestOrigins(JSON.stringify({ allowed_origins: [] }))).toEqual([]);
    expect(manifestOrigins("{")).toBeNull();
    expect(manifestOrigins("null")).toBeNull();
    expect(manifestOrigins(JSON.stringify({ allowed_origins: [1] }))).toBeNull();
    expect(manifestOrigins(JSON.stringify({}))).toBeNull();
  });
  it("the port-holder hint and the add command follow the platform", () => {
    const d = { daemon: { state: "error" as const, detail: "x" } };
    expect(doctorLines({ ...base, ...d, platform: "linux" }).find((l) => l.name === "Daemon")!.fix).toContain("lsof -iTCP:9234 -sTCP:LISTEN");
    expect(doctorLines({ ...base, ...d, platform: "win32" }).find((l) => l.name === "Daemon")!.fix).toContain("netstat -ano | findstr 9234");
    const none = { mcp: mcpDecision({}, "", { tokenFile: "T", mode: "package" }) };
    expect(doctorLines({ ...base, ...none, platform: "win32" }).find((l) => l.name === "MCP entry")!.fix).toContain("-- cmd /c npx -y");
    expect(doctorLines({ ...base, ...none, platform: "linux" }).find((l) => l.name === "MCP entry")!.fix).not.toContain("cmd");
  });
  it("token line shows the per-user path; a clone-only token hints to move it; package fix says npx setup", () => {
    const tok = (f: object) => doctorLines({ ...base, platform: "linux", ...f } as never).find((l) => l.name === "Token file")!;
    expect(tok({}).detail).toContain("/h/t");
    expect(tok({ mode: "clone", tokenSource: "clone" })).toMatchObject({ level: "hint", fix: "run npm run setup to move it to /h/t" });
    expect(tok({ token: "missing", tokenSource: null }).fix).toContain("npx browser-agent-bridge setup");
  });
});
