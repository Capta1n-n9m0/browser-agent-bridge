import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { homeAsTilde, renderReport } from "../src/error.js";

const base = { code: "TIMEOUT", message: "slow", attachErrors: [] as string[], now: 0 };
const WIN = "C:\\Users\\someone";

describe("the Screenshot line shows the home folder as ~", () => {
  it("a Windows home path prints ~\\…, case-insensitively and with either separator", () => {
    expect(homeAsTilde(`${WIN}\\.browser-agent-bridge\\failures\\a.png`, WIN)).toBe("~\\.browser-agent-bridge\\failures\\a.png");
    expect(homeAsTilde("c:/users/SOMEONE/x/a.png", WIN)).toBe("~\\x\\a.png");
    expect(homeAsTilde(`${WIN}\\x.png`, `${WIN}\\`)).toBe("~\\x.png");
  });
  it("a home with a letter whose lower case is longer (U+0130) keeps the path's leading dot", () => {
    const home = "C:\\Users\\İlham";
    expect(homeAsTilde(`${home}\\.browser-agent-bridge\\failures\\a.png`, home)).toBe("~\\.browser-agent-bridge\\failures\\a.png");
    expect(homeAsTilde("c:/USERS/İlham/.x/a.png", home)).toBe("~\\.x\\a.png");
  });
  it("a POSIX home prints ~/… and is case-sensitive", () => {
    expect(homeAsTilde("/home/u/.x/a.png", "/home/u")).toBe("~/.x/a.png");
    expect(homeAsTilde("/HOME/u/a.png", "/home/u")).toBe("/HOME/u/a.png");
  });
  it("any other path is unchanged: elsewhere, a sibling prefix, the home itself, no home", () => {
    expect(homeAsTilde("D:\\shots\\a.png", WIN)).toBe("D:\\shots\\a.png");
    expect(homeAsTilde(`${WIN}2\\a.png`, WIN)).toBe(`${WIN}2\\a.png`);
    expect(homeAsTilde(WIN, WIN)).toBe(WIN);
    expect(homeAsTilde("p.png", undefined)).toBe("p.png");
  });
  it("a temp dir path with an injected home that is not its parent stays absolute in the report", () => {
    const shot = path.join(os.tmpdir(), "bridge-x", "a.png");
    const text = renderReport({ ...base, screenshotPath: shot, home: path.join(os.tmpdir(), "elsewhere") });
    expect(text).toContain(`Screenshot: ${shot}`);
  });
  it("renderReport prints ~ for a path under the injected home", () => {
    const text = renderReport({ ...base, screenshotPath: `${WIN}\\f\\a.png`, home: WIN });
    expect(text.split("\n")).toContain("Screenshot: ~\\f\\a.png");
  });
});
