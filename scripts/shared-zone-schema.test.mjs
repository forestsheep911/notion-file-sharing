import assert from "node:assert/strict";
import test from "node:test";
import { compareSchema, parseSchemaArgs, SHARED_ZONE_DATABASES } from "./shared-zone-schema.mjs";

test("defines physically separate private and public database contracts", () => {
  assert.deepEqual(SHARED_ZONE_DATABASES.map(item => item.title), ["共享文件｜私人库", "共享文件｜公开库"]);
  const privateNames = Object.keys(SHARED_ZONE_DATABASES[0].properties);
  const publicNames = Object.keys(SHARED_ZONE_DATABASES[1].properties);
  assert(privateNames.includes("公开批准"));
  assert(privateNames.includes("内部备注"));
  assert(!publicNames.includes("公开批准"));
  assert(!publicNames.includes("内部备注"));
});

test("parses safe modes and credential identifier overrides", () => {
  assert.equal(parseSchemaArgs([]).mode, "dry-run");
  assert.equal(parseSchemaArgs(["--apply"]).mode, "apply");
  assert.deepEqual(parseSchemaArgs(["--verify-only", "--state", "safe.json"]), { mode: "verify-only", statePath: "safe.json" });
});

test("schema comparison checks exact property names, types, and required options", () => {
  const expected = { "名称": { title: {} }, "状态": { select: { options: [{ name: "可用" }] } } };
  const actual = {
    "名称": { type: "title", title: {} },
    "状态": { type: "select", select: { options: [{ name: "可用" }] } }
  };
  assert.deepEqual(compareSchema(actual, expected), []);
  assert.match(compareSchema({ ...actual, "额外": { type: "rich_text", rich_text: {} } }, expected).join(" "), /unexpected property/iu);
  assert.match(compareSchema({ ...actual, "状态": { type: "select", select: { options: [] } } }, expected).join(" "), /missing option/iu);
});
