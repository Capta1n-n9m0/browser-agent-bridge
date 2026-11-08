/**
 * Step 9 S2b: the toolbar badge and title (decisions.md · 2026-10-24 · Badge and title (#143)) and the one
 * content-free log line per press (phase doc 0.7). `badgeOf` is pure; `BadgeModel` keeps a failed write
 * visible until the state moves on; `BadgeController` is the thin glue over an injected `chrome.action`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  BADGE_COLORS,
  BADGE_TITLES,
  BadgeController,
  BadgeModel,
  badgeOf,
  showBadge,
  toggleLogLine,
  type ActionApi,
  type PressResult,
} from "../src/badge.js";
import type { ToggleOutcome } from "../src/safety-state.js";

afterEach(() => vi.restoreAllMocks());

describe("badgeOf — #143's three states, OFF wins, fail closed", () => {
  it("disarmed → OFF red, the exact #143 title (JavaScript on or off: OFF wins, F37)", () => {
    for (const evaluate of [true, false]) {
      expect(badgeOf({ kind: "state", armed: false, evaluate })).toEqual({
        text: "OFF",
        color: BADGE_COLORS.off,
        title: "Browser Agent Bridge — OFF: agents are refused (click to turn on)",
      });
    }
  });

  it("armed + JavaScript off → JS amber, the exact #143 title", () => {
    expect(badgeOf({ kind: "state", armed: true, evaluate: false })).toEqual({
      text: "JS",
      color: BADGE_COLORS.js,
      title: "Browser Agent Bridge — armed, JavaScript off (click to turn off)",
    });
  });

  it("armed → no badge, the exact #143 title", () => {
    const b = badgeOf({ kind: "state", armed: true, evaluate: true });
    expect(b.text).toBe("");
    expect(b.title).toBe("Browser Agent Bridge — armed (click to turn off)");
  });

  it("an unreadable state → OFF, with a title saying it cannot be read", () => {
    const b = badgeOf({ kind: "unreadable" });
    expect(b.text).toBe("OFF");
    expect(b.color).toBe(BADGE_COLORS.off);
    expect(b.title).toBe(BADGE_TITLES.unreadable);
    expect(b.title).toMatch(/cannot be read/);
  });

  it('"write-failed" → OFF, with a title saying the OFF holds but was not saved', () => {
    const b = badgeOf({ kind: "write-failed" });
    expect(b.text).toBe("OFF");
    expect(b.color).toBe(BADGE_COLORS.off);
    expect(b.title).toBe(BADGE_TITLES.writeFailed);
    expect(b.title).toMatch(/not saved/);
    expect(b.title).toMatch(/agents are refused/);
  });

  it("a rejected arm → still OFF, with a title saying turning on failed", () => {
    const b = badgeOf({ kind: "arm-failed" });
    expect(b.text).toBe("OFF");
    expect(b.color).toBe(BADGE_COLORS.off);
    expect(b.title).toBe(BADGE_TITLES.armFailed);
    expect(b.title).toMatch(/turning on failed/i);
  });

  it("every title starts with the extension's name and the three #143 titles are distinct", () => {
    const all = Object.values(BADGE_TITLES);
    for (const t of all) expect(t.startsWith("Browser Agent Bridge — ")).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });

  it("colours are #rrggbb strings; OFF and JS differ", () => {
    for (const c of Object.values(BADGE_COLORS)) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    expect(BADGE_COLORS.off).not.toBe(BADGE_COLORS.js);
  });
});

describe("toggleLogLine — one content-free line per press (0.7)", () => {
  const cases: Array<[PressResult, string]> = [
    ["disarmed", "safety: disarmed by the user"],
    ["armed", "safety: armed by the user"],
    ["ignored", "safety: re-arm ignored (within 1 s of a disarm)"],
    ["write-failed", "safety: disarm not saved (storage write failed)"],
    ["arm-failed", "safety: arm failed (storage write failed)"],
  ];
  for (const [r, line] of cases) {
    it(`${r} → "${line}"`, () => {
      expect(toggleLogLine(r)).toBe(line);
    });
  }
});

describe("BadgeModel — a failed write stays visible until the state moves on", () => {
  const off = { armed: false, evaluate: true };
  const on = { armed: true, evaluate: true };

  it("a plain read maps to its state", () => {
    const m = new BadgeModel();
    expect(m.inputFor(off)).toEqual({ kind: "state", armed: false, evaluate: true });
    expect(m.inputFor("unreadable")).toEqual({ kind: "unreadable" });
  });

  it("write-failed holds while the read says disarmed, and clears once armed", () => {
    const m = new BadgeModel();
    m.note("write-failed");
    expect(m.inputFor(off)).toEqual({ kind: "write-failed" });
    expect(m.inputFor(off)).toEqual({ kind: "write-failed" });
    expect(m.inputFor(on)).toEqual({ kind: "state", armed: true, evaluate: true });
    expect(m.inputFor(off)).toEqual({ kind: "state", armed: false, evaluate: true });
  });

  it("an ignored re-arm keeps a write-failed note (the disarm is still unsaved)", () => {
    const m = new BadgeModel();
    m.note("write-failed");
    m.note("ignored");
    expect(m.inputFor(off)).toEqual({ kind: "write-failed" });
  });

  it("arm-failed holds while disarmed; a later saved disarm or arm clears it", () => {
    const m = new BadgeModel();
    m.note("arm-failed");
    expect(m.inputFor(off)).toEqual({ kind: "arm-failed" });
    m.note("disarmed");
    expect(m.inputFor(off)).toEqual({ kind: "state", armed: false, evaluate: true });
    m.note("arm-failed");
    m.note("armed");
    expect(m.inputFor(off)).toEqual({ kind: "state", armed: false, evaluate: true });
  });

  it("F5: write-failed clears once storage itself reads disarmed (the OFF was saved later, e.g. by the options page)", () => {
    const m = new BadgeModel();
    m.note("write-failed");
    expect(m.inputFor(off, true)).toEqual({ kind: "write-failed" });
    expect(m.inputFor(off, undefined)).toEqual({ kind: "write-failed" });
    expect(m.inputFor(off, false)).toEqual({ kind: "state", armed: false, evaluate: true });
    expect(m.inputFor(off, true)).toEqual({ kind: "state", armed: false, evaluate: true });
  });

  it("F5: a stored disarm does not clear arm-failed (storage disarmed is what that title says)", () => {
    const m = new BadgeModel();
    m.note("arm-failed");
    expect(m.inputFor(off, false)).toEqual({ kind: "arm-failed" });
  });

  it("unreadable wins over a note", () => {
    const m = new BadgeModel();
    m.note("write-failed");
    expect(m.inputFor("unreadable")).toEqual({ kind: "unreadable" });
  });
});

function fakeApi(): ActionApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    setBadgeText: vi.fn(async (d: { text: string }) => void calls.push(`text:${d.text}`)),
    setBadgeBackgroundColor: vi.fn(async (d: { color: string }) => void calls.push(`color:${d.color}`)),
    setTitle: vi.fn(async (d: { title: string }) => void calls.push(`title:${d.title}`)),
  };
}

describe("showBadge — never throws, synchronously or asynchronously", () => {
  it("sets text, colour and title", () => {
    const api = fakeApi();
    showBadge(api, { text: "OFF", color: "#d93025", title: "t" });
    expect(api.calls).toEqual(["text:OFF", "color:#d93025", "title:t"]);
  });

  it("a synchronous throw and a rejection are both swallowed, and the other calls still run", async () => {
    const api: ActionApi = {
      setBadgeText: () => {
        throw new Error("boom");
      },
      setBadgeBackgroundColor: () => Promise.reject(new Error("later")),
      setTitle: vi.fn(),
    };
    expect(() => showBadge(api, { text: "", color: "#000000", title: "x" })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.setTitle).toHaveBeenCalledWith({ title: "x" });
  });

  it("a missing api is a no-op", () => {
    expect(() => showBadge(undefined, { text: "", color: "#000000", title: "x" })).not.toThrow();
  });
});

describe("BadgeController — the press and the start-up re-derive", () => {
  const last = (api: ReturnType<typeof fakeApi>) => ({
    text: api.calls.filter((c) => c.startsWith("text:")).pop(),
    title: api.calls.filter((c) => c.startsWith("title:")).pop(),
  });

  it("refresh reads the state and shows it", async () => {
    const api = fakeApi();
    const c = new BadgeController({ api, read: async () => ({ armed: true, evaluate: false }) });
    await c.refresh();
    expect(last(api)).toEqual({ text: "text:JS", title: `title:${BADGE_TITLES.jsOff}` });
  });

  it("a read that rejects shows OFF (fail closed, F42)", async () => {
    const api = fakeApi();
    const c = new BadgeController({ api, read: async () => Promise.reject(new Error("unreadable")) });
    await c.refresh();
    expect(last(api)).toEqual({ text: "text:OFF", title: `title:${BADGE_TITLES.unreadable}` });
  });

  it("refreshes apply in order: a slow first read never overwrites a later one", async () => {
    const api = fakeApi();
    let n = 0;
    const read = async () => {
      n++;
      if (n === 1) {
        await new Promise((r) => setTimeout(r, 20));
        return { armed: false, evaluate: true };
      }
      return { armed: true, evaluate: true };
    };
    const c = new BadgeController({ api, read });
    const a = c.refresh();
    const b = c.refresh();
    await Promise.all([a, b]);
    expect(last(api).text).toBe("text:");
  });

  const presses: Array<[string, () => Promise<ToggleOutcome>, { armed: boolean; evaluate: boolean }, string, string, PressResult]> = [
    ["disarmed", async () => "disarmed", { armed: false, evaluate: true }, "OFF", BADGE_TITLES.off, "disarmed"],
    ["armed", async () => "armed", { armed: true, evaluate: true }, "", BADGE_TITLES.armed, "armed"],
    ["ignored", async () => "ignored", { armed: false, evaluate: true }, "OFF", BADGE_TITLES.off, "ignored"],
    ["write-failed", async () => "write-failed", { armed: false, evaluate: true }, "OFF", BADGE_TITLES.writeFailed, "write-failed"],
    ["a rejected arm", async () => Promise.reject(new Error("QUOTA")), { armed: false, evaluate: true }, "OFF", BADGE_TITLES.armFailed, "arm-failed"],
  ];
  for (const [name, toggle, state, text, title, result] of presses) {
    it(`press: ${name} → badge "${text}", one log line`, async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const api = fakeApi();
      const c = new BadgeController({ api, read: async () => state });
      expect(await c.press(toggle)).toBe(result);
      expect(last(api)).toEqual({ text: `text:${text}`, title: `title:${title}` });
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(toggleLogLine(result));
    });
  }

  it("F5: after a write-failed press, a refresh whose stored read says disarmed drops the not-saved title; OFF stays", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const api = fakeApi();
    let stored = true;
    const c = new BadgeController({ api, read: async () => ({ armed: false, evaluate: true }), storedArmed: async () => stored });
    expect(await c.press(async () => "write-failed")).toBe("write-failed");
    expect(last(api)).toEqual({ text: "text:OFF", title: `title:${BADGE_TITLES.writeFailed}` });
    stored = false; // the options page saved the OFF
    await c.refresh();
    expect(last(api)).toEqual({ text: "text:OFF", title: `title:${BADGE_TITLES.off}` });
  });

  it("F5: a stored read that rejects keeps the not-saved title (fail safe), still OFF", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const api = fakeApi();
    const c = new BadgeController({ api, read: async () => ({ armed: false, evaluate: true }), storedArmed: async () => Promise.reject(new Error("x")) });
    await c.press(async () => "write-failed");
    await c.refresh();
    expect(last(api)).toEqual({ text: "text:OFF", title: `title:${BADGE_TITLES.writeFailed}` });
  });

  it("a press never rejects, even when the read fails afterwards", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const api = fakeApi();
    const c = new BadgeController({ api, read: async () => Promise.reject(new Error("x")) });
    await expect(c.press(async () => "disarmed")).resolves.toBe("disarmed");
    expect(last(api).text).toBe("text:OFF");
  });
});
