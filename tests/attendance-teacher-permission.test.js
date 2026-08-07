"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const auth = fs.readFileSync(path.join(root, "js", "auth-guard.js"), "utf8");
const data = fs.readFileSync(path.join(root, "js", "data.js"), "utf8");
const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
const policy = JSON.parse(fs.readFileSync(
  path.join(root, "config", "schedule-permissions.json"),
  "utf8"
));

test("teacher permissions include vacation attendance keys only", () => {
  assert.deepEqual(policy.teacherWritablePatterns.slice(0, 3), [
    "^swim_bt_attendance_.*$",
    "^swim_bt_att_guests_.*$",
    "^swim_bt_day_snapshot_.*$",
  ]);
  assert.match(auth, /TEACHER_WRITABLE_EXACT_KEYS\.has\(key\)/);
  assert.match(auth, /TEACHER_WRITABLE_PATTERNS\.some\(pattern=>pattern\.test\(key\)\)/);
  assert.match(rules, /\^swim_bt_attendance_\.\*\$/);
  assert.match(rules, /\^swim_bt_att_guests_\.\*\$/);
  assert.match(rules, /\^swim_bt_day_snapshot_\.\*\$/);

  const teacherRule = rules.match(/function isTeacherWritableScheduleKey\(docId\) \{[\s\S]*?\n    \}/);
  assert.ok(teacherRule);
  assert.doesNotMatch(teacherRule[0], /swim_bt_.*_(stu|inst)/);
});

test("attendance transactions do not create schedule restore records", () => {
  assert.match(data,
    /const ATTENDANCE_TX_META=\{skipAudit:true,skipUndo:true,skipDeleteSafety:true\}/);
  assert.match(data,
    /function _updateLegacyAttendanceMapTx[\s\S]*?mutator,ATTENDANCE_TX_META\)/);
  assert.match(data,
    /function _updateLegacyAttGuestsMapTx[\s\S]*?mutator,ATTENDANCE_TX_META\)/);
  assert.match(data,/function updateAttendanceMapTx[\s\S]*?runtime\.updateAttendance/);
  assert.match(data,/function updateAttGuestsMapTx[\s\S]*?runtime\.updateGuests/);
});
