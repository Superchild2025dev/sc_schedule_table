"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");

assert.doesNotMatch(
  source,
  /match \/scheduleStores[\s\S]*?allow read, write: if signedIn\(\)/,
  "schedule data must not be writable by every authenticated account"
);

[
  "gagyeong.desk@scswim.local",
  "gagyeong.son@scswim.local",
  "gagyeong.park@scswim.local",
  "gagyeong.lee1@scswim.local",
  "gagyeong.kimjy@scswim.local",
  "gagyeong.kimms@scswim.local",
  "gagyeong.yoo@scswim.local",
  "yongam.desk@scswim.local",
  "yongam.lee1@scswim.local",
  "yongam.jung@scswim.local",
  "yongam.kimsh@scswim.local",
  "yongam.kimey@scswim.local",
  "yongam.kimjs@scswim.local",
  "yongam.lee2@scswim.local",
].forEach(email => {
  assert.ok(source.includes(`"${email}"`), `${email} must remain authorized`);
});

[
  "swim_mark",
  "swim_requests",
  "swim_attendance",
  "swim_att_guests",
  "swim_day_snapshot",
  "zz_swim_audit_index",
  "zz_swim_day_snapshot__",
  "zz_swim_audit_entry__",
].forEach(key => {
  assert.ok(source.includes(key), `${key} must remain teacher-writable`);
});

const teacherWriteRule = source.match(
  /function isTeacherWritableScheduleKey\(docId\) \{[\s\S]*?\n    \}/
);
assert.ok(teacherWriteRule, "teacher write-key rule must exist");
[
  "swim_students",
  "swim_inst",
  "swim_retire",
  "swim_enroll",
  "swim_periods",
  "swim_teachers",
].forEach(key => {
  assert.doesNotMatch(
    teacherWriteRule[0],
    new RegExp(`"${key}"`),
    `${key} must not become teacher-writable`
  );
});

assert.match(source,
  /branch == "gagyeong" && \(isGagyeongDesk\(\) \|\| isGagyeongTeacher\(\)\)/,
  "gagyeong access must remain branch-scoped");
assert.match(source,
  /branch == "yongam" && \(isYongamDesk\(\) \|\| isYongamTeacher\(\)\)/,
  "yongam access must remain branch-scoped");

assert.match(
  source,
  /allow get: if branch in \["gagyeong", "yongam"\]/,
  "only the two public summary documents should be readable"
);
assert.match(source, /allow list: if false/, "public summary listing must stay blocked");
assert.match(
  source,
  /allow create, update, delete: if false/,
  "public summary writes must stay blocked"
);
