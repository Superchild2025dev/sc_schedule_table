"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const modulePath = path.join(root, "scripts", "release-firestore-rules.js");
const releaseModule = fs.existsSync(modulePath) ? require(modulePath) : null;

test("the Firestore release gate exists", () => {
  assert.ok(releaseModule, "release-firestore-rules.js is missing");
});

test("release arguments require an explicit mode", {skip:!releaseModule}, () => {
  assert.throws(
    () => releaseModule.parseReleaseArgs([]),
    /--production 또는 --dry-run/
  );
});

test("dry run verifies without deploying production rules", {skip:!releaseModule}, async () => {
  const calls = [];
  let output = "";

  await releaseModule.release({
    dryRun:true,
    platform:"win32",
    comSpec:"cmd.exe",
    root,
    runner:async step=>{ calls.push(step); },
    write:text=>{ output += text; },
  });

  assert.deepEqual(calls, [
    {command:"node", args:["scripts/check-release-diff.js", "--range", "HEAD^..HEAD"]},
    {command:"cmd.exe", args:["/d", "/s", "/c", "npm.cmd run verify"]},
  ]);
  assert.match(output, /운영 규칙은 배포하지 않았습니다/);
  assert.match(output, /정규 출석/);
  assert.match(output, /방특 출석/);
});

test("Windows production uses the command interpreter for cmd shims", {skip:!releaseModule}, () => {
  const steps = releaseModule.buildReleaseSteps({
    production:true,
    platform:"win32",
    comSpec:"cmd.exe",
    root,
  });

  assert.equal(steps[1].command, "cmd.exe");
  assert.deepEqual(steps[1].args, ["/d", "/s", "/c", "npm.cmd run verify"]);
  assert.equal(steps[2].command, "cmd.exe");
  assert.match(steps[2].args[3], /firebase\.cmd.*deploy --only firestore:rules/);
});

test("production release verifies before one scoped rules deployment", {skip:!releaseModule}, async () => {
  const calls = [];

  await releaseModule.release({
    production:true,
    platform:"linux",
    root,
    isClean:()=>true,
    runner:async step=>{ calls.push(step); },
    write:()=>{},
  });

  assert.deepEqual(calls, [
    {command:"node", args:["scripts/check-release-diff.js", "--range", "HEAD^..HEAD"]},
    {command:"npm", args:["run", "verify"]},
    {
      command:path.join(root, "tools", "firebase-test", "node_modules", ".bin", "firebase"),
      args:[
        "deploy",
        "--only", "firestore:rules",
        "--project", "scswimming-schedule",
        "--non-interactive",
      ],
    },
  ]);
});

test("production release refuses uncommitted tracked changes", {skip:!releaseModule}, async () => {
  await assert.rejects(
    releaseModule.release({
      production:true,
      platform:"linux",
      root,
      isClean:()=>false,
      runner:async()=>{},
      write:()=>{},
    }),
    /커밋되지 않은 변경/
  );
});
