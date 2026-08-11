"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const modulePath = path.join(__dirname, "..", "js", "attendance-v2-settings-policy.js");
const settingsHtml = fs.readFileSync(path.join(__dirname, "..", "settings.html"), "utf8");
const settingsSource = fs.readFileSync(path.join(__dirname, "..", "js", "settings.js"), "utf8");
const moduleExists = fs.existsSync(modulePath);
let policy = null;

if(moduleExists){
  const context = {window:{}};
  context.globalThis = context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(modulePath, "utf8"), context, {filename:modulePath});
  policy = context.window.SCAttendanceV2SettingsPolicy;
}

test("V2 attendance settings policy is available", () => {
  assert.ok(moduleExists, "attendance-v2-settings-policy.js must exist");
  assert.ok(policy, "SCAttendanceV2SettingsPolicy must be exported");
});

test("only a developer can see attendance cutover controls", () => {
  assert.equal(policy?.canView({role:"developer"}), true);
  assert.equal(policy?.canView({role:"superAdmin"}), false);
  assert.equal(policy?.canView({role:"desk"}), false);
  assert.equal(policy?.canView({role:"teacher"}), false);
});

test("a developer can always roll back to v1", () => {
  const result = policy?.evaluate({
    profile:{role:"developer"},
    currentMode:"v2",
    targetMode:"v1",
    generationId:"",
    verifiedGenerationId:"",
    parityStatus:"mismatch",
    mismatchCount:12,
  });
  assert.equal(result?.allowed, true);
});

test("v2-read and v2 require a verified generation with zero mismatches", () => {
  for(const targetMode of ["v2-read", "v2"]){
    assert.equal(policy?.evaluate({
      profile:{role:"developer"}, targetMode,
      generationId:"gen_1", verifiedGenerationId:"gen_1",
      parityStatus:"mismatch", mismatchCount:1,
    }).allowed, false);
    assert.equal(policy?.evaluate({
      profile:{role:"developer"}, targetMode,
      generationId:"gen_1", verifiedGenerationId:"gen_1",
      parityStatus:"ok", mismatchCount:0,
    }).allowed, true);
  }
});

test("shadow and verify require a generation but do not auto-advance", () => {
  assert.equal(policy?.evaluate({
    profile:{role:"developer"}, targetMode:"shadow",
    generationId:"", verifiedGenerationId:"gen_1",
    parityStatus:"idle", mismatchCount:0,
  }).allowed, false);
  assert.equal(policy?.evaluate({
    profile:{role:"developer"}, targetMode:"verify",
    generationId:"gen_1", verifiedGenerationId:"gen_1",
    parityStatus:"idle", mismatchCount:0,
  }).allowed, true);
  assert.equal(policy?.nextMode?.("verify", {parityStatus:"ok", mismatchCount:0}), "verify");
});

test("every non-v1 mode requires the selected verified generation", () => {
  for(const targetMode of ["shadow", "verify", "v2-read", "v2"]){
    assert.equal(policy?.evaluate({
      profile:{role:"developer"}, targetMode,
      generationId:"gen_old", verifiedGenerationId:"gen_ready",
      parityStatus:"ok", mismatchCount:0,
    }).allowed, false);
  }
});

test("unknown modes and non-developers are rejected", () => {
  assert.equal(policy?.evaluate({
    profile:{role:"developer"}, targetMode:"future",
    generationId:"gen_1", verifiedGenerationId:"gen_1",
    parityStatus:"ok", mismatchCount:0,
  }).allowed, false);
  assert.equal(policy?.evaluate({
    profile:{role:"desk"}, targetMode:"v1",
    generationId:"", parityStatus:"ok", mismatchCount:0,
  }).allowed, false);
});

test("settings page contains a hidden developer-only attendance control", () => {
  assert.match(settingsHtml, /id="v2-attendance-cutover"[^>]*hidden/);
  assert.match(settingsHtml, /id="v2-attendance-mode"/);
  assert.match(settingsHtml, /id="v2-attendance-apply"/);
  assert.match(settingsHtml, /id="v2-attendance-rollback"/);
  const policyScript = settingsHtml.indexOf("js/attendance-v2-settings-policy.js");
  const settingsScript = settingsHtml.indexOf("js/settings.js");
  assert.ok(policyScript >= 0 && policyScript < settingsScript, "settings policy must load before settings.js");
});

test("settings runtime gates visibility and routes attendance transitions through the callable", () => {
  assert.match(settingsSource, /SCAttendanceV2SettingsPolicy\.canView\(profile\)/);
  assert.match(settingsSource, /SCAttendanceV2SettingsPolicy\.evaluate\(/);
  assert.match(settingsSource, /SCV2AttendanceStore\.create\(/);
  assert.doesNotMatch(settingsSource, /attendanceControlStore\.setConfig\(/);
  assert.match(settingsSource, /runScheduleV2Action\(action\)/);
  assert.match(settingsSource, /latestAttendanceReadyGeneration\(/);
});
