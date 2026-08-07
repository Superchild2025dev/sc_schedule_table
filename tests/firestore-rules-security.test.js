"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "firebase.json"), "utf8"));
const indexesPath = path.join(__dirname, "..", "firestore.indexes.json");

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

assert.match(
  source,
  /match \/scheduleV2\/\{branch\}\/runtime\/attendance \{[\s\S]*?allow read: if canReadSchedule\(branch\);[\s\S]*?allow write: if isDeveloper\(\);[\s\S]*?\}/,
  "staff may read only their branch attendance runtime config while developers control writes"
);
assert.match(
  source,
  /match \/scheduleV2\/\{branch\}\/generations\/\{generationId\}\/\{collection\}\/\{recordId\} \{[\s\S]*?collection in \["attendanceRecords", "attendanceGuests"\][\s\S]*?canManageSchedule\(branch\) \|\| isTeacherForBranch\(branch\)[\s\S]*?\}/,
  "only branch staff may access V2 attendance record collections"
);

assert.equal(firebaseConfig.firestore.rules, "firestore.rules");
assert.equal(firebaseConfig.firestore.indexes, "firestore.indexes.json");
assert.ok(fs.existsSync(indexesPath), "Firestore attendance index file must exist");
if(fs.existsSync(indexesPath)){
  const indexes = JSON.parse(fs.readFileSync(indexesPath, "utf8"));
  ["attendanceRecords", "attendanceGuests"].forEach(collectionGroup=>{
    assert.ok(indexes.indexes.some(index=>
      index.collectionGroup === collectionGroup &&
      index.queryScope === "COLLECTION" &&
      JSON.stringify(index.fields) === JSON.stringify([
        {fieldPath:"tabId", order:"ASCENDING"},
        {fieldPath:"date", order:"ASCENDING"},
      ])
    ), `${collectionGroup} must have an exact tabId/date composite index`);
  });
}
