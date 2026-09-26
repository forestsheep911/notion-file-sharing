import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildPartPlan, evaluateRoutes, inferBlockType, isTransient, normalizeNotionId } from "./lib/core.mjs";
import { parseArgs } from "./notion-file-share.mjs";

test("normalizes a page URL to a UUID", () => {
  assert.equal(
    normalizeNotionId("https://app.notion.com/p/name-1234567890abcdef1234567890abcdef?source=copy_link"),
    "12345678-90ab-cdef-1234-567890abcdef"
  );
});

test("plans a single upload at 20 MiB and multipart above it", () => {
  assert.equal(buildPartPlan(20 * 1024 * 1024).mode, "single_part");
  const plan = buildPartPlan(41 * 1024 * 1024);
  assert.equal(plan.mode, "multi_part");
  assert.deepEqual(plan.parts.map(part => part.length), [20, 20, 1].map(value => value * 1024 * 1024));
});

test("rejects an oversized file and invalid part size", () => {
  assert.throws(() => buildPartPlan(5_000_000_001), /exceeds/iu);
  assert.throws(() => buildPartPlan(10, 4), /5 through 20/iu);
});

test("infers Notion block types without project-specific rules", () => {
  assert.equal(inferBlockType("movie.mp4"), "video");
  assert.equal(inferBlockType("paper.pdf"), "pdf");
  assert.equal(inferBlockType("archive.zip"), "file");
  assert.equal(inferBlockType("movie.mp4", "file"), "file");
});

test("accepts only the exact direct chain and rejects Match or mixed evidence", () => {
  const expected = ["DIRECT", "国内直连", "Notion"];
  assert.equal(evaluateRoutes([{ chains: expected }], expected).accepted, true);
  assert.equal(evaluateRoutes([{ chains: ["DIRECT", "Match"] }], expected).accepted, false);
  assert.equal(evaluateRoutes([{ chains: expected }, { chains: ["Proxy", "Notion"] }], expected).accepted, false);
  assert.equal(evaluateRoutes([], expected).reason, "no_route_evidence");
});

test("retries only bounded transport/server failures and the eligible 409", () => {
  assert.equal(isTransient({ status: 429 }), true);
  assert.equal(isTransient({ code: "ECONNRESET" }), true);
  assert.equal(isTransient({ status: 409, message: "Failed to upload file. Please try again later." }), true);
  assert.equal(isTransient({ status: 409, message: "Conflict" }), false);
  assert.equal(isTransient({ status: 403 }), false);
});

test("requires paired fixed-IP and local-address options", () => {
  const fixture = fileURLToPath(import.meta.url);
  assert.throws(() => parseArgs(["--file", fixture, "--resolve-ip", "1.1.1.1"]), /must be used together/iu);
});
