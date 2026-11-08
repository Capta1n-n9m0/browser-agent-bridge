/**
 * Step 9 S2b: the manifest gains exactly `action` (no popup) and `commands` (the reserved `_execute_action`,
 * `Alt+Shift+K`) — decisions.md · 2026-10-24 · The shortcut is `_execute_action` (#142). Nothing else
 * changes: no new permission (the ESCALATION list allows only `action` and `commands`), the same host
 * permissions, the same other keys.
 *
 * Re-pinned 2026-10-26 (Step 11b S3a; phase doc `docs/plans/2026-10-26-step11b-block-list-redirects.md` 0.3; decisions.md
 * #290, ruled (A)): `permissions` gains exactly `declarativeNetRequestWithHostAccess` (session rules for the block
 * list; no install warning, as `<all_urls>` is already held). Nothing else changes, and there is no
 * `declarative_net_request` key (no static rule sets: session rules only, #291). S2b's tests below are unchanged
 * except the permission list they pin.
 *
 * Re-pinned 2026-10-29 (Step 13 S1; decisions.md · 2026-10-29 · The user rules Step 12's gate; Step 12 closes (#374),
 * item 1, which granted the permission; #393: no new warning, the extension stays enabled): `permissions` gains exactly
 * `webNavigation`, for `onCreatedNavigationTarget` (G1, #385). The earlier tests below pin the list through `NOW`.
 *
 * Re-pinned 2026-11-08 (Step 15 S4; phase doc `docs/plans/2026-11-08-step15-distribution.md` § S4; the native host
 * ruling #449): `permissions` gains exactly `nativeMessaging` (pairing with the local install), and the manifest gains
 * exactly the top-level `key` (the Web Store's public key, so an unpacked build has the store's fixed ID). The ID the
 * key derives equals `EXTENSION_ID` in `scripts/bridge/lib.mjs`, the one ID the native host admits.
 */
import { createHash } from "node:crypto";
import { EXTENSION_ID } from "../../scripts/bridge/lib.mjs";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../manifest.json", import.meta.url)), "utf8")) as Record<string, unknown>;

/** The manifest before Step 9 S2b (HEAD 55f4d6e), minus nothing. */
const BEFORE: Record<string, unknown> = {
  manifest_version: 3,
  name: "Browser Agent Bridge",
  version: "0.1.0",
  description: "Bridges your real Chrome profile to a local MCP server for AI agent control.",
  minimum_chrome_version: "116",
  background: { service_worker: "dist/sw.js", type: "module" },
  permissions: ["debugger", "tabs", "scripting", "activeTab", "alarms", "storage", "offscreen", "webRequest"],
  host_permissions: ["<all_urls>"],
  options_page: "options.html",
};

/** Step 11b S3a: the one permission added to S2b's list (0.3 (A), #290). */
const ADDED_11B = "declarativeNetRequestWithHostAccess";
/** Step 13 S1: the one permission added after Step 11b's (#374 item 1). */
const ADDED_13 = "webNavigation";
/** Step 15 S4: the one permission added after Step 13's (#449, the native host). */
const ADDED_15 = "nativeMessaging";
/** Today's list: S2b's, then 11b's, then Step 13's, then Step 15's, in that order. */
const NOW = [...(BEFORE.permissions as string[]), ADDED_11B, ADDED_13, ADDED_15];

/** Chrome's extension ID from a manifest `key`: sha256 of the DER, first 32 hex digits mapped 0-f → a-p. */
function idFromKey(key: string): string {
  const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

describe("manifest.json (Step 15 S4 re-pin, #449)", () => {
  it("permissions are Step 13's list plus exactly nativeMessaging, appended", () => {
    expect(manifest.permissions).toEqual(NOW);
    expect((manifest.permissions as string[]).at(-1)).toBe(ADDED_15);
    expect(manifest.host_permissions).toEqual(BEFORE.host_permissions);
  });

  it("the key is one base64 line whose derived ID is EXTENSION_ID (the store's)", () => {
    expect(typeof manifest.key).toBe("string");
    const key = manifest.key as string;
    expect(key).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(key).toHaveLength(392);
    expect(EXTENSION_ID).toBe("iifofgbdljchbdimlalhphmedfmocela");
    expect(idFromKey(key)).toBe(EXTENSION_ID);
  });

  it("the derivation is discriminating: one changed key character gives another ID", () => {
    const key = manifest.key as string;
    const i = 100;
    const changed = key.slice(0, i) + (key[i] === "A" ? "B" : "A") + key.slice(i + 1);
    expect(idFromKey(changed)).not.toBe(EXTENSION_ID);
  });
});

describe("manifest.json (Step 13 S1 re-pin, #374)", () => {
  it("permissions are Step 11b's list plus exactly webNavigation, appended (then Step 15's); nothing else changes", () => {
    expect(manifest.permissions).toEqual(NOW);
    const added = (manifest.permissions as string[]).filter((p) => ![...(BEFORE.permissions as string[]), ADDED_11B].includes(p));
    expect(added).toEqual([ADDED_13, ADDED_15]);
    expect(manifest.host_permissions).toEqual(BEFORE.host_permissions);
    expect(manifest).not.toHaveProperty("optional_permissions");
  });
});

describe("manifest.json (Step 11b S3a re-pin)", () => {
  it("permissions are S2b's list plus exactly one, appended", () => {
    expect(manifest.permissions).toEqual(NOW);
    const added = (manifest.permissions as string[]).filter((p) => !(BEFORE.permissions as string[]).includes(p));
    expect(added).toEqual([ADDED_11B, ADDED_13, ADDED_15]);
    for (const p of ["declarativeNetRequest", "declarativeNetRequestFeedback"]) expect(manifest.permissions).not.toContain(p);
  });

  it("no static rule sets: no declarative_net_request key; every other key as S2b pinned it", () => {
    expect(manifest).not.toHaveProperty("declarative_net_request");
    for (const [k, v] of Object.entries(BEFORE)) if (k !== "permissions") expect(manifest[k], k).toEqual(v);
  });
});

describe("manifest.json (S2b)", () => {
  it("the permissions are exactly today's (no new permission; since Step 11b S3a: plus the one above)", () => {
    expect(manifest.permissions).toEqual(NOW);
    expect(manifest.host_permissions).toEqual(BEFORE.host_permissions);
    expect(manifest).not.toHaveProperty("optional_permissions");
    expect(manifest).not.toHaveProperty("optional_host_permissions");
  });

  it("no new top-level key besides action and commands (and, since Step 15 S4, key; S8, icons); every old key unchanged", () => {
    const added = Object.keys(manifest).filter((k) => !(k in BEFORE)).sort();
    expect(added).toEqual(["action", "commands", "icons", "key"]);
    for (const [k, v] of Object.entries(BEFORE)) if (k !== "permissions") expect(manifest[k], k).toEqual(v);
  });

  it("commands is exactly #142's", () => {
    expect(manifest.commands).toEqual({ _execute_action: { suggested_key: { default: "Alt+Shift+K" } } });
  });

  it("action has no popup (a click must reach action.onClicked), and its title is the extension's name", () => {
    const action = manifest.action as Record<string, unknown>;
    expect(action).not.toHaveProperty("default_popup");
    expect(Object.keys(action).sort()).toEqual(["default_icon", "default_title"]);
    expect(action.default_title).toBe("Browser Agent Bridge");
  });
});
