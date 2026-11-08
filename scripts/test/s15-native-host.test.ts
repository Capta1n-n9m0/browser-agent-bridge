// Step 15 S4 (#449): the native host. Pure logic (scripts/native-host/pair.mjs) with injected files, then the real
// host script as a child process with a throwaway token under a scratch home (never the real APPDATA/HOME).
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findPackageRoot, findWorkspaceRoot } from "../../sdk/src/token.js";
import { TOKEN_RE as EXT_TOKEN_RE, NATIVE_HOST_NAME as EXT_HOST_NAME } from "../../extension/src/pairing.js";
import { EXTENSION_ID, EXTENSION_ORIGIN, NATIVE_HOST_NAME, userTokenFile } from "../bridge/lib.mjs";
import {
  cloneRoot, encodeFrame, ERRORS, errorReply, FrameReader, lookupPairing, MAX_REQUEST_BYTES, originAllowed, pairPort, parseRequest, respond,
  TOKEN_RE,
} from "../native-host/pair.mjs";

const TOKEN = "sentinel0token0native0host0Q7Z9".padEnd(64, "a"); // throwaway, matches TOKEN_RE
const ORIGIN = `chrome-extension://${EXTENSION_ID}/`;
const json = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8");

describe("constants agree across the host, setup and the extension", () => {
  it("origin, host name and token pattern", () => {
    expect(EXTENSION_ORIGIN).toBe(ORIGIN);
    expect(EXT_HOST_NAME).toBe(NATIVE_HOST_NAME);
    expect(EXT_TOKEN_RE.source).toBe(TOKEN_RE.source);
    expect(EXT_TOKEN_RE.flags).toBe(TOKEN_RE.flags);
    expect(TOKEN_RE.test("ab".repeat(32))).toBe(true); // what setup writes: 64 hex digits
  });
});

describe("originAllowed: exactly the extension's origin, as the first argument", () => {
  it.each([
    [[ORIGIN], true],
    [[ORIGIN, "--parent-window=0"], true],
    [[], false],
    [[""], false],
    [[`chrome-extension://${EXTENSION_ID}`], false],
    [[`${ORIGIN}x`], false],
    [[ORIGIN.toUpperCase()], false],
    [[` ${ORIGIN}`], false],
    [["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"], false],
    [["chrome-extension://*/"], false],
    [["--parent-window=0", ORIGIN], false],
  ])("%j → %s", (args, ok) => expect(originAllowed(args)).toBe(ok));
});

describe("respond: origin first, request second, token lookup last", () => {
  const good = { ok: true as const, token: TOKEN, port: 9234 };
  it("a wrong origin is refused and the lookup is never called, whatever the request", () => {
    for (const req of [null, { ok: true as const }, { ok: false as const, error: ERRORS.malformed }]) {
      const lookup = vi.fn(() => good);
      expect(respond(["chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/"], req, lookup)).toEqual({ ok: false, error: "forbidden-origin" });
      expect(lookup).not.toHaveBeenCalled();
    }
  });
  it("a bad request is refused with its fixed code and no lookup", () => {
    for (const error of [ERRORS.tooLarge, ERRORS.malformed, ERRORS.unknownType, ERRORS.timeout]) {
      const lookup = vi.fn(() => good);
      expect(respond([ORIGIN], { ok: false, error }, lookup)).toEqual({ ok: false, error });
      expect(lookup).not.toHaveBeenCalled();
    }
    const lookup = vi.fn(() => good);
    expect(respond([ORIGIN], null, lookup)).toEqual({ ok: false, error: "malformed" });
    expect(lookup).not.toHaveBeenCalled();
  });
  it("the right origin and request get the lookup's reply", () => {
    expect(respond([ORIGIN, "--parent-window=0"], { ok: true }, () => good)).toEqual(good);
  });
  it("every error reply is exactly {ok:false, error} with a fixed code: no token, no echo", () => {
    for (const code of Object.values(ERRORS)) {
      const r = errorReply(code);
      expect(Object.keys(r).sort()).toEqual(["error", "ok"]);
      expect(JSON.stringify(r)).not.toContain(TOKEN);
    }
  });
});

describe("FrameReader", () => {
  it("decodes a frame in either byte order, split across chunks", () => {
    for (const endian of ["LE", "BE"] as const) {
      const f = encodeFrame({ type: "pair" }, endian);
      const r = new FrameReader(endian);
      expect(r.push(f.subarray(0, 2))).toEqual({ state: "need" });
      expect(r.push(f.subarray(2, 7))).toEqual({ state: "need" });
      const done = r.push(f.subarray(7));
      expect(done.state).toBe("frame");
      expect(JSON.parse((done as { body: Buffer }).body.toString("utf8"))).toEqual({ type: "pair" });
    }
  });
  it("refuses a declared length over the cap as soon as the 4 length bytes are in", () => {
    const head = Buffer.alloc(4);
    head.writeUInt32LE(MAX_REQUEST_BYTES + 1, 0);
    expect(new FrameReader("LE").push(head)).toEqual({ state: "error", error: "too-large" });
    head.writeUInt32LE(0xffffffff, 0);
    expect(new FrameReader("LE").push(head)).toEqual({ state: "error", error: "too-large" });
    head.writeUInt32LE(MAX_REQUEST_BYTES, 0);
    expect(new FrameReader("LE").push(head)).toEqual({ state: "need" });
  });
  it("a zero length is malformed; bytes after the frame are ignored; nothing after done", () => {
    expect(new FrameReader("LE").push(Buffer.alloc(4))).toEqual({ state: "error", error: "malformed" });
    const r = new FrameReader("LE");
    const out = r.push(Buffer.concat([encodeFrame({ type: "pair" }, "LE"), Buffer.from("trailing")]));
    expect(out.state).toBe("frame");
    expect(r.push(encodeFrame({ type: "pair" }, "LE"))).toEqual({ state: "need" });
  });
  it("encodeFrame writes the length in the given order", () => {
    const le = encodeFrame({ a: 1 }, "LE"), be = encodeFrame({ a: 1 }, "BE");
    expect(le.readUInt32LE(0)).toBe(7);
    expect(be.readUInt32BE(0)).toBe(7);
    expect(le.subarray(4).toString()).toBe('{"a":1}');
  });
});

describe("parseRequest: exactly {type:\"pair\"}", () => {
  it.each([
    [json({ type: "pair" }), { ok: true }],
    [json({ type: "token" }), { ok: false, error: "unknown-type" }],
    [json({ type: "pair", extra: 1 }), { ok: false, error: "malformed" }],
    [json({}), { ok: false, error: "malformed" }],
    [json({ type: 1 }), { ok: false, error: "malformed" }],
    [json([{ type: "pair" }]), { ok: false, error: "malformed" }],
    [json(null), { ok: false, error: "malformed" }],
    [json("pair"), { ok: false, error: "malformed" }],
    [Buffer.from("{type:pair}"), { ok: false, error: "malformed" }],
    [Buffer.from([0x7b, 0xff, 0x7d]), { ok: false, error: "malformed" }],
  ])("%s → %j", (body, want) => expect(parseRequest(body)).toEqual(want));
});

describe("lookupPairing: the ruled order (#449), port rule", () => {
  const files = (m: Record<string, string>) => (f: string) => {
    const k = f.replace(/\\/g, "/").replace(/^[A-Z]:/i, ""); // path.resolve adds a drive on Windows
    if (k in m) return m[k]!;
    throw new Error("ENOENT");
  };
  const env = { HOME: "/h" };
  const userFile = userTokenFile(env, "linux")!;
  const clonePkg = JSON.stringify({ name: "browser-agent-bridge-dev", workspaces: ["sdk"] });
  const base = { env, platform: "linux", startDir: "/repo/scripts/native-host" };
  it("BRIDGE_TOKEN wins, then the per-user file, then a clone's bridge.token", () => {
    const fs = files({ [userFile]: "user-token-0000000000\n", "/repo/package.json": clonePkg, "/repo/bridge.token": "clone-token-000000000\n" });
    expect(lookupPairing({ ...base, env: { ...env, BRIDGE_TOKEN: " env-token-0000000000 " }, readFile: fs })).toEqual({ ok: true, token: "env-token-0000000000", port: 9234 });
    expect(lookupPairing({ ...base, readFile: fs })).toEqual({ ok: true, token: "user-token-0000000000", port: 9234 });
    const noUser = files({ "/repo/package.json": clonePkg, "/repo/bridge.token": "clone-token-000000000\n" });
    expect(lookupPairing({ ...base, readFile: noUser })).toEqual({ ok: true, token: "clone-token-000000000", port: 9234 });
  });
  it("inside the installed package a project's bridge.token is never read", () => {
    const readFile = vi.fn(files({ "/proj/node_modules/browser-agent-bridge/package.json": JSON.stringify({ name: "browser-agent-bridge" }),
      "/proj/package.json": JSON.stringify({ workspaces: [] }), "/proj/bridge.token": "project-token-00000000" }));
    expect(lookupPairing({ ...base, startDir: "/proj/node_modules/browser-agent-bridge/dist", readFile })).toEqual({ ok: false, error: "no-token" });
    const read = readFile.mock.calls.map(([f]) => f.replace(/\\/g, "/").replace(/^[A-Z]:/i, ""));
    expect(read).toContain("/proj/node_modules/browser-agent-bridge/package.json"); // the walk did run
    expect(read).not.toContain("/proj/bridge.token");
  });
  it("no token anywhere → no-token; a token outside the pattern → bad-token, never echoed", () => {
    expect(lookupPairing({ ...base, readFile: files({}) })).toEqual({ ok: false, error: "no-token" });
    for (const bad of ["short", "has space in the token 0000", 'quote"0000000000000000', "x".repeat(257)]) {
      const r = lookupPairing({ ...base, readFile: files({ [userFile]: bad }) });
      expect(r).toEqual({ ok: false, error: "bad-token" });
      expect(JSON.stringify(r)).not.toContain(bad);
    }
  });
  it("port: BRIDGE_PORT when 1-65535, else 9234", () => {
    expect(pairPort(undefined)).toBe(9234);
    expect(pairPort("9300")).toBe(9300);
    for (const raw of ["", " ", "0", "65536", "9.5", "abc", "-1"]) expect(pairPort(raw), raw).toBe(9234);
    expect(lookupPairing({ ...base, env: { ...env, BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: "9301" }, readFile: files({}) })).toEqual({ ok: true, token: TOKEN, port: 9301 });
  });
  it("cloneRoot agrees with the SDK's package/workspace walk", () => {
    const trees: [Record<string, string>, string, string | null][] = [
      [{ "/repo/package.json": clonePkg }, "/repo/scripts/native-host", "/repo"],
      [{ "/pk/package.json": JSON.stringify({ name: "browser-agent-bridge" }) }, "/pk/dist", null],
      [{ "/a/package.json": JSON.stringify({ name: "app" }), "/package.json": JSON.stringify({ workspaces: [] }) }, "/a/b", "/"],
      [{ "/a/package.json": "not json", "/package.json": JSON.stringify({ workspaces: [] }) }, "/a/b", "/"],
      [{ "/a/package.json": JSON.stringify({ name: "browser-agent-bridge" }), "/package.json": clonePkg }, "/a/b", null],
      [{}, "/x/y", null],
    ];
    const norm = (p: string | null) => (p === null ? null : p.replace(/\\/g, "/").replace(/^[A-Z]:/i, ""));
    for (const [tree, start, want] of trees) {
      const rf = files(tree);
      const sdk = findPackageRoot(start, rf) !== null ? null : findWorkspaceRoot(start, rf);
      expect(norm(cloneRoot(start, rf)), JSON.stringify(tree)).toBe(want);
      expect(norm(sdk), JSON.stringify(tree)).toBe(want);
    }
  });
});

describe("the real host process (scratch home, throwaway token)", () => {
  const REPO = path.resolve(__dirname, "..", "..");
  let tmp: string, scratchEnv: Record<string, string | undefined>, pkgHost: string;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "bab-native-host-"));
    const home = path.join(tmp, "home");
    mkdirSync(home);
    scratchEnv = { ...process.env, APPDATA: path.join(home, "AppData", "Roaming"), USERPROFILE: home, HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"), BRIDGE_TOKEN: undefined, BRIDGE_PORT: "9317" };
    const file = userTokenFile(scratchEnv, process.platform)!;
    expect(file.startsWith(tmp)).toBe(true);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${TOKEN}\n`);
    // A package-layout copy (no clone above it), for the no-token case: a clone's own bridge.token is never reached.
    const pkg = path.join(tmp, "pkg");
    mkdirSync(path.join(pkg, "scripts", "native-host"), { recursive: true });
    mkdirSync(path.join(pkg, "scripts", "bridge"), { recursive: true });
    writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "browser-agent-bridge", type: "module" }));
    for (const f of ["host.mjs", "pair.mjs"]) cpSync(path.join(REPO, "scripts", "native-host", f), path.join(pkg, "scripts", "native-host", f));
    cpSync(path.join(REPO, "scripts", "bridge", "lib.mjs"), path.join(pkg, "scripts", "bridge", "lib.mjs"));
    pkgHost = path.join(pkg, "scripts", "native-host", "host.mjs");
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  const endian = os.endianness();
  function run(script: string, args: string[], input: Buffer | null, env = scratchEnv) {
    return new Promise<{ code: number | null; stdout: Buffer; stderr: string }>((resolve, reject) => {
      const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as NodeJS.ProcessEnv;
      const child = spawn(process.execPath, [script, ...args], { env: clean, stdio: ["pipe", "pipe", "pipe"] });
      const out: Buffer[] = [], err: Buffer[] = [];
      child.stdout.on("data", (d) => out.push(d));
      child.stderr.on("data", (d) => err.push(d));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() }));
      child.stdin.on("error", () => {});
      if (input) child.stdin.write(input);
      // keep stdin open (as Chrome does) unless no input is given
      if (!input) child.stdin.end();
    });
  }
  const reply = (stdout: Buffer) => {
    const r = new FrameReader(endian, 1024 * 1024).push(stdout);
    expect(r.state).toBe("frame");
    const body = (r as { body: Buffer }).body;
    expect(stdout.length).toBe(4 + body.length); // one frame, nothing else on stdout
    return JSON.parse(body.toString("utf8"));
  };
  const host = () => path.join(REPO, "scripts", "native-host", "host.mjs");

  it("the right origin gets {ok:true, token, port} in one frame; stderr is empty", async () => {
    const r = await run(host(), [ORIGIN, "--parent-window=0"], encodeFrame({ type: "pair" }, endian));
    expect(r.code).toBe(0);
    expect(reply(r.stdout)).toEqual({ ok: true, token: TOKEN, port: 9317 });
    expect(r.stderr).toBe("");
  }, 20_000);

  it("a wrong origin gets forbidden-origin, without the token anywhere", async () => {
    for (const origin of ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/", `chrome-extension://${EXTENSION_ID}`]) {
      const r = await run(host(), [origin, "--parent-window=0"], encodeFrame({ type: "pair" }, endian));
      expect(r.code).toBe(0);
      expect(reply(r.stdout)).toEqual({ ok: false, error: "forbidden-origin" });
      expect(r.stdout.toString("latin1")).not.toContain(TOKEN);
      expect(r.stderr).toBe("");
    }
    const none = await run(host(), [], null);
    expect(reply(none.stdout)).toEqual({ ok: false, error: "forbidden-origin" });
  }, 30_000);

  it("oversize, malformed and unknown requests get their fixed codes, never the token", async () => {
    const big = Buffer.alloc(4);
    big.writeUInt32LE(1024 * 1024, 0);
    const cases: [Buffer, string][] = [
      [endian === "LE" ? big : Buffer.from(big).reverse(), "too-large"],
      [encodeFrame({ type: "steal" }, endian), "unknown-type"],
      [encodeFrame({ type: "pair", token: TOKEN }, endian), "malformed"],
      [Buffer.concat([Buffer.from([3, 0, 0, 0].map((b, i, a) => (endian === "LE" ? b : a[3 - i]!))), Buffer.from("{x}")]), "malformed"],
    ];
    for (const [input, code] of cases) {
      const r = await run(host(), [ORIGIN], input);
      expect(reply(r.stdout), code).toEqual({ ok: false, error: code });
      expect(r.stderr).toBe("");
    }
    const partial = await run(host(), [ORIGIN], Buffer.from([1, 0])); // stdin left open: the 5 s read timeout answers
    expect(reply(partial.stdout)).toEqual({ ok: false, error: "timeout" });
    expect(partial.stderr).toBe("");
  }, 40_000);

  it("in the package layout with no token anywhere: no-token", async () => {
    const env = { ...scratchEnv, APPDATA: path.join(tmp, "empty"), USERPROFILE: path.join(tmp, "empty"), HOME: path.join(tmp, "empty"),
      XDG_CONFIG_HOME: path.join(tmp, "empty") };
    const r = await run(pkgHost, [ORIGIN], encodeFrame({ type: "pair" }, endian), env);
    expect(reply(r.stdout)).toEqual({ ok: false, error: "no-token" });
    expect(r.stderr).toBe("");
  }, 20_000);
});
