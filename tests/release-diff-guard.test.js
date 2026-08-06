"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const modulePath = path.join(root, "scripts", "check-release-diff.js");
const guard = fs.existsSync(modulePath) ? require(modulePath) : null;

test("the release diff guard exists", () => {
  assert.ok(guard, "check-release-diff.js is missing");
});

test("a focused change is allowed", {skip:!guard}, () => {
  const result = guard.evaluateDiff([
    {path:"js/core.js", status:"M", added:35, deleted:4},
    {path:"tests/firebase-write-error.test.js", status:"A", added:90, deleted:0},
  ], {});

  assert.equal(result.allowed, true);
  assert.deepEqual(result.reasons, []);
});

test("deleting a test file is blocked", {skip:!guard}, () => {
  const result = guard.evaluateDiff([
    {path:"tests/firebase-write-error.test.js", status:"D", added:0, deleted:54},
  ], {});

  assert.equal(result.allowed, false);
  assert.match(result.reasons.join("\n"), /테스트 파일 삭제/);
});

test("deleting the guard or CI workflow is blocked", {skip:!guard}, () => {
  const result = guard.evaluateDiff([
    {path:"scripts/check-release-diff.js", status:"D", added:0, deleted:10},
    {path:".github/workflows/verify.yml", status:"D", added:0, deleted:20},
  ], {});

  assert.equal(result.allowed, false);
  assert.match(result.reasons.join("\n"), /안전장치 파일 삭제/);
});

test("a broad multi-file rollback is blocked", {skip:!guard}, () => {
  const result = guard.evaluateDiff([
    {path:"js/core.js", status:"M", added:1, deleted:90},
    {path:"js/data.js", status:"M", added:4, deleted:120},
    {path:"js/table.js", status:"M", added:0, deleted:70},
  ], {});

  assert.equal(result.allowed, false);
  assert.match(result.reasons.join("\n"), /280줄/);
});

test("an explicit override with a reason allows an intentional rollback", {skip:!guard}, () => {
  const result = guard.evaluateDiff([
    {path:"tests/obsolete.test.js", status:"D", added:0, deleted:300},
  ], {
    SC_ALLOW_BROAD_ROLLBACK:"1",
    SC_ROLLBACK_REASON:"obsolete test replaced by emulator coverage",
  });

  assert.equal(result.allowed, true);
  assert.equal(result.overridden, true);
});

test("an override without a reason remains blocked", {skip:!guard}, () => {
  const result = guard.evaluateDiff([
    {path:"tests/obsolete.test.js", status:"D", added:0, deleted:300},
  ], {
    SC_ALLOW_BROAD_ROLLBACK:"1",
    SC_ROLLBACK_REASON:"",
  });

  assert.equal(result.allowed, false);
  assert.match(result.reasons.join("\n"), /사유/);
});

test("numstat parser preserves paths and line counts", {skip:!guard}, () => {
  assert.deepEqual(guard.parseNumstat("12\t3\tjs/core.js\n-\t-\tfavicon.png\n"), [
    {path:"js/core.js", added:12, deleted:3},
    {path:"favicon.png", added:0, deleted:0},
  ]);
});

test("the complete verification command includes the staged diff guard", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(pkg.scripts.verify, /verify:diff/);
});

test("CI checks the complete pushed or pull-request range", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "verify.yml"), "utf8");
  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /github\.event\.before/);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/);
  assert.match(workflow, /github\.event\.pull_request\.head\.sha/);
});
