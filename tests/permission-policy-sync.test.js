"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const manifestPath = path.join(root, "config", "schedule-permissions.json");
const generatorPath = path.join(root, "scripts", "sync-permission-policy.js");

test("one permission manifest owns both generated permission blocks", () => {
  assert.ok(fs.existsSync(manifestPath), "permission manifest is missing");
  assert.ok(fs.existsSync(generatorPath), "permission generator is missing");

  const generator = require(generatorPath);
  const result = generator.syncFiles({root, check:true});
  const authSource = fs.readFileSync(path.join(root, "js", "auth-guard.js"), "utf8");

  assert.deepEqual(result.changed, []);
  assert.match(authSource, /TEACHER_WRITABLE_EXACT_KEYS\.has\(key\)/);
  assert.match(authSource, /TEACHER_WRITABLE_PATTERNS\.some\(pattern=>pattern\.test\(key\)\)/);
});

test("teacher write policy contains attendance keys but no schedule rosters", () => {
  assert.ok(fs.existsSync(manifestPath), "permission manifest is missing");
  const policy = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.deepEqual(policy.teacherWritableExactKeys, [
    "swim_mark",
    "swim_requests",
    "swim_attendance",
    "swim_att_guests",
    "swim_day_snapshot",
    "zz_swim_audit_index",
  ]);
  assert.deepEqual(policy.teacherWritablePatterns, [
    "^swim_bt_attendance_.*$",
    "^swim_bt_att_guests_.*$",
    "^swim_bt_day_snapshot_.*$",
    "^zz_swim_day_snapshot__.*$",
    "^zz_swim_audit_entry__.*$",
  ]);
  assert.ok(!policy.teacherWritableExactKeys.includes("swim_students"));
  assert.ok(!policy.teacherWritableExactKeys.includes("swim_inst"));
});
