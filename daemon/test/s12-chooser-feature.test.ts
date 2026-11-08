// Step 12 S5c (#355, in #332's form): the daemon answers `VERSION` with its own reload text, without forwarding, to
// an `uploadFiles` carrying the `chooser` key when the current socket's hello lacked `"uploadChooser"`. An
// `uploadFiles` without `chooser`, and every other call, is forwarded as before.
import { describe, it, expect } from "vitest";
import { FEATURE_UPLOAD_CHOOSER } from "@bridge/shared";
import { Bridge } from "../src/bridge.js";
import type { ExtensionConnection } from "../src/connection.js";
import { CHOOSER_RELOAD_HINT, TabLayer } from "../src/intercept.js";

function fakeConn(forwarded: Array<[string, unknown]>): ExtensionConnection {
  return {
    call: async (method: string, params: unknown) => {
      forwarded.push([method, params]);
      if (method === "listTabs") return { tabs: [{ id: 41, title: "", url: "", active: true, current: true }] };
      return { files: [] };
    },
  } as unknown as ExtensionConnection;
}

async function setUp(features: string[]) {
  const forwarded: Array<[string, unknown]> = [];
  const bridge = new Bridge();
  const layer = new TabLayer({ bridge, nameOf: () => "A", sendTo: () => {} });
  const A = { clientId: "a", name: "A" };
  const conn = fakeConn(forwarded);
  bridge.setConnection(conn);
  layer.extensionConnected(conn, true, undefined, features);
  expect(await layer.request(A, "tabs.claim", { active: true }, undefined)).toEqual({ tab: "T1" });
  forwarded.length = 0;
  return { forwarded, layer, A };
}

const upload = { tab: "T1", ref: "e1", paths: ["C:\\up\\secret-name.txt"] };

describe("S5c — the uploadChooser feature and the chooser VERSION rule", () => {
  it("the feature name is uploadChooser", () => {
    expect(FEATURE_UPLOAD_CHOOSER).toBe("uploadChooser");
  });

  it("a featureless hello: uploadFiles {chooser} is VERSION with the chooser text, nothing forwarded", async () => {
    const { forwarded, layer, A } = await setUp(["evaluateArgs"]);
    for (const chooser of [true, false, null]) {
      await expect(layer.request(A, "uploadFiles", { ...upload, chooser }, undefined)).rejects.toMatchObject({
        code: "VERSION",
        message: CHOOSER_RELOAD_HINT,
      });
    }
    expect(forwarded).toEqual([]);
  });

  it("a featureless hello: uploadFiles without chooser is forwarded unchanged", async () => {
    const { forwarded, layer, A } = await setUp([]);
    await layer.request(A, "uploadFiles", upload, undefined);
    expect(forwarded).toEqual([["uploadFiles", { tabId: 41, ref: "e1", paths: upload.paths }]]);
  });

  it("with the feature, uploadFiles {chooser} is forwarded", async () => {
    const { forwarded, layer, A } = await setUp(["evaluateArgs", FEATURE_UPLOAD_CHOOSER]);
    await layer.request(A, "uploadFiles", { ...upload, chooser: true }, undefined);
    expect(forwarded.map(([m]) => m)).toEqual(["uploadFiles"]);
  });

  it("the text names the file chooser and a reload, never a path", () => {
    expect(CHOOSER_RELOAD_HINT).toBe(
      "the Chrome extension is an older build without the file chooser upload — reload it at chrome://extensions (↻ on Browser Agent Bridge)",
    );
    expect(CHOOSER_RELOAD_HINT).not.toMatch(/[A-Za-z]:\\|\/Users\/|\/home\/|secret-name|\.txt/);
  });
});
