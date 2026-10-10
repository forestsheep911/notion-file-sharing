import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildPartPlan, evaluateRoutes, inferBlockType, isNotionConnectionTarget, isTransient, normalizeNotionId, notionApiAddressCandidates, usesPhysicalDirectEvidence } from "./lib/core.mjs";
import { parseArgs } from "./notion-file-share.mjs";

test("CLI runs through a linked skill directory", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "notion-entry-"));
  try {
    const link = path.join(directory, "scripts");
    fs.symlinkSync(path.dirname(fileURLToPath(import.meta.url)), link, process.platform === "win32" ? "junction" : "dir");
    const result = spawnSync(process.execPath, [path.join(link, "notion-file-share.mjs"), "--help"], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: node scripts\/notion-file-share.mjs/u);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("normalizes a page URL to a UUID", () => {
  assert.equal(
    normalizeNotionId("https://app.notion.com/p/name-1234567890abcdef1234567890abcdef?source=copy_link"),
    "12345678-90ab-cdef-1234-567890abcdef"
  );
  assert.equal(
    normalizeNotionId("12345678-90ab-cdef-1234-567890abcdef"),
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

test("matches Notion connections by the exact host or freshly resolved destination IP", () => {
  assert.equal(isNotionConnectionTarget({ host: "api.notion.com" }, "api.notion.com"), true);
  assert.equal(isNotionConnectionTarget({ destinationIP: "198.18.0.65" }, "api.notion.com", "", ["198.18.0.65"]), true);
  assert.equal(isNotionConnectionTarget({ destinationIP: "::ffff:198.18.0.65" }, "api.notion.com", "", ["198.18.0.65"]), true);
  assert.equal(isNotionConnectionTarget({ destinationIP: "192.0.2.5" }, "api.notion.com", "", ["198.18.0.65"]), false);
});

test("includes configured real Notion address alongside Clash Fake-IP DNS answers", () => {
  const candidates = notionApiAddressCandidates(["198.18.0.7"], "208.103.161.2");
  assert.deepEqual(candidates, ["198.18.0.7", "208.103.161.2"]);
  assert.equal(isNotionConnectionTarget({ destinationIP: "208.103.161.2" }, "api.notion.com", "", candidates), true);
});

test("physical direct evidence is scoped to the upload socket, not unrelated Clash connections", () => {
  assert.equal(usesPhysicalDirectEvidence({ resolveIp: "208.103.161.17", localAddress: "192.168.1.22" }), true);
  assert.equal(usesPhysicalDirectEvidence({ resolveIp: "208.103.161.17" }), false);
  assert.equal(usesPhysicalDirectEvidence({ localAddress: "192.168.1.22" }), false);
  assert.equal(usesPhysicalDirectEvidence({}), false);
});

test("retries only bounded transport/server failures and the eligible 409", () => {
  assert.equal(isTransient({ status: 429 }), true);
  assert.equal(isTransient({ code: "ECONNRESET" }), true);
  assert.equal(isTransient({ message: "Client network socket disconnected before secure TLS connection was established" }), true);
  assert.equal(isTransient({ status: 409, message: "Failed to upload file. Please try again later." }), true);
  assert.equal(isTransient({ status: 409, message: "Conflict" }), false);
  assert.equal(isTransient({ status: 403 }), false);
});

test("requires paired fixed-IP and local-address options", () => {
  const fixture = fileURLToPath(import.meta.url);
  assert.throws(() => parseArgs(["--file", fixture, "--resolve-ip", "1.1.1.1"]), /must be used together/iu);
});

test("accepts an explicit local proxy for observable route enforcement", () => {
  const fixture = fileURLToPath(import.meta.url);
  assert.equal(parseArgs(["--file", fixture, "--proxy-url", "http://127.0.0.1:7897"]).proxyUrl, "http://127.0.0.1:7897");
});
