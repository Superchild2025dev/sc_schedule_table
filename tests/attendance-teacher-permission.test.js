"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const auth = fs.readFileSync(path.join(root, "js", "auth-guard.js"), "utf8");
const data = fs.readFileSync(path.join(root, "js", "data.js"), "utf8");
const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");

test("teacher permissions include vacation attendance keys only", () => {
  assert.match(auth, /\^swim_bt_\(attendance\|att_guests\|day_snapshot\)_\.\+/);
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
    /function updateAttendanceMapTx[\s\S]*?mutator,ATTENDANCE_TX_META\)/);
  assert.match(data,
    /function updateAttGuestsMapTx[\s\S]*?mutator,ATTENDANCE_TX_META\)/);
});
