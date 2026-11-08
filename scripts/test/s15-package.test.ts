// Step 15 S2: the generated npm package's manifest (scripts/package/manifest.mjs) and the CLI dispatcher's choice.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nativeHostPlan } from "../bridge/lib.mjs";
import { BUNDLE_ENTRIES, cliAction, packageManifest, PACKAGE_FILES } from "../package/manifest.mjs";

const root = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));

describe("packageManifest", () => {
  const m = packageManifest({ version: "0.2.0" }, { ws: "^8.18.0" });
  it("one public package, the ruled name and license expression (#449, #450)", () => {
    expect(m.name).toBe("browser-agent-bridge");
    expect(m.version).toBe("0.2.0");
    expect(m.license).toBe("AGPL-3.0-only AND Apache-2.0");
    expect(m).not.toHaveProperty("private");
    expect(m).not.toHaveProperty("workspaces");
    expect(m).not.toHaveProperty("devDependencies");
    expect(m.type).toBe("module");
  });
  it("the SDK is the main export, with its types", () => {
    expect(m.main).toBe("dist/index.js");
    expect(m.types).toBe("types/sdk/src/index.d.ts");
    expect(m.exports).toEqual({ ".": { types: "./types/sdk/src/index.d.ts", import: "./dist/index.js" }, "./package.json": "./package.json" });
  });
  it("bin: the MCP server (with the subcommands) and the doctor", () => {
    expect(m.bin).toEqual({ "browser-agent-bridge": "dist/cli.js", "browser-agent-bridge-doctor": "dist/doctor.js" });
  });
  it("ws is the only runtime dependency; Node 20 or newer", () => {
    expect(m.dependencies).toEqual({ ws: "^8.18.0" });
    expect(m.engines).toEqual({ node: ">=20" });
  });
  it("ships both license texts and the note", () => {
    for (const f of ["LICENSE", "LICENSE-APACHE", "LICENSES.md", "THIRD-PARTY-NOTICES.txt", "dist", "types"]) expect(PACKAGE_FILES).toContain(f);
    expect(m.files).toEqual(PACKAGE_FILES);
  });
  it("the root package stays private, so a stray npm publish at the root is refused", () => {
    expect(root.private).toBe(true);
  });
  it("Step 15 S4: dist/native-host.js is bundled from the host script, at the path the package's registration names", () => {
    expect(BUNDLE_ENTRIES.map((e) => e.out)).toEqual(["index.js", "mcp.js", "daemon.js", "doctor.js", "setup.js", "cli.js", "native-host.js"]);
    expect(BUNDLE_ENTRIES.find((e) => e.out === "native-host.js")).toEqual({ in: "scripts/native-host/host.mjs", out: "native-host.js" });
    const plan = nativeHostPlan({ platform: "linux", env: { HOME: "/h" }, home: "/h", mode: "package", root: "/pk", nodePath: "/n" })!;
    expect(plan.scriptPath).toBe("/pk/dist/native-host.js");
    expect(m.files).toContain("dist");
  });
});

describe("cliAction", () => {
  it("no argument → the MCP server; doctor → the doctor; setup → the bundled setup; else usage", () => {
    expect(cliAction([])).toEqual({ run: "mcp" });
    expect(cliAction(["mcp"])).toEqual({ run: "mcp" });
    expect(cliAction(["doctor"])).toEqual({ run: "doctor" });
    expect(cliAction(["setup", "--dry-run"])).toEqual({ run: "setup" });
    expect(cliAction(["--help"])).toMatchObject({ exit: 0, message: expect.stringMatching(/Usage/) });
    expect(cliAction(["nope"])).toMatchObject({ exit: 2, message: expect.stringMatching(/Usage/) });
  });
});
