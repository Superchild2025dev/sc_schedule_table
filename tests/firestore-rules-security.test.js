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
  /branch == "gagyeong" && \(isGagyeongDesk\(\) \|\| isAnyTeacher\(\)\)/,
  "gagyeong teachers must be able to follow a branch transfer");
assert.match(source,
  /branch == "yongam" && \(isYongamDesk\(\) \|\| isAnyTeacher\(\)\)/,
  "yongam teachers must be able to follow a branch transfer");
assert.match(source,
  /function isTeacherForBranch\(branch\) \{[\s\S]*?branch in \["gagyeong",\s*"yongam"\][\s\S]*?isAnyTeacher\(\)/,
  "teacher attendance writes must work at either known branch");

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

const v2Rules = source.slice(source.indexOf("match /scheduleV2/"), source.indexOf("match /scheduleStores/"));
assert.ok(v2Rules, "Schedule V2 rules must exist before scheduleStores");
assert.match(
  v2Rules,
  /match \/scheduleV2\/\{branch\}\/runtime\/\{documentId\} \{[\s\S]*?allow read: if canReadSchedule\(branch\)[\s\S]*?canReadScheduleV2Runtime\(documentId\);[\s\S]*?allow write: if false;/,
  "staff may read only allowlisted V2 runtime status documents"
);
assert.match(
  v2Rules,
  /match \/scheduleV2\/\{branch\}\/generations\/\{generationId\} \{[\s\S]*?allow read: if canReadSchedule\(branch\);[\s\S]*?allow write: if false;/,
  "staff may read an allowed generation header"
);
assert.match(
  v2Rules,
  /match \/scheduleV2\/\{branch\}\/generations\/\{generationId\}\/\{collection\}\/\{recordId\} \{[\s\S]*?canReadScheduleV2GenerationCollection\(collection\)[\s\S]*?allow write: if false;/,
  "staff may read only allowlisted operational generation collections"
);
assert.match(
  v2Rules,
  /match \/scheduleV2\/\{branch\}\/requestRecoveries\/\{document=\*\*\} \{[\s\S]*?allow read, write: if false;/,
  "request recovery documents must remain server-only"
);
assert.match(
  v2Rules,
  /match \/scheduleV2\/\{branch\}\/operationalMutations\/\{document=\*\*\} \{[\s\S]*?allow read, write: if false;/,
  "operational mutation manifests must remain server-only"
);
assert.match(
  v2Rules,
  /match \/scheduleV2\/\{branch\}\/recoveryResolutions\/\{document=\*\*\} \{[\s\S]*?allow read, write: if false;/,
  "terminal recovery resolutions must remain server-only"
);
assert.match(
  v2Rules,
  /match \/scheduleV2\/\{branch\}\/runtime\/operationalRecovery \{[\s\S]*?allow read, write: if false;/,
  "mirror recovery queues must remain server-only"
);
assert.doesNotMatch(v2Rules, /allow write: if (?!false)/, "no Schedule V2 browser write may be authorized");

assert.match(
  source,
  /function hasLegacyScheduleAuthority\(branch\)[\s\S]*?runtime\/operational[\s\S]*?\.data\.branchId == branch[\s\S]*?\.data\.mode in \["v1", "shadow", "verify"\]/,
  "tracked V1 writes require an explicit branch-scoped V1-family authority pointer"
);
assert.match(
  source,
  /function canWriteLegacyScheduleKey\(branch, docId\)[\s\S]*?!isTrackedLegacyScheduleKey\(docId\)[\s\S]*?hasLegacyScheduleAuthority\(branch\)[\s\S]*?activationFreezeAllowsLegacyWrites\(branch\)/,
  "tracked V1 writes must be fenced by authority and activation freeze"
);
assert.match(
  source,
  /match \/scheduleStores\/\{branch\}\/\{document=\*\*\} \{[\s\S]*?allow write: if false;/,
  "the recursive scheduleStores rule must not bypass the tracked-key fence"
);
assert.match(
  source,
  /match \/scheduleStores\/\{branch\}\/kv\/\{docId\} \{[\s\S]*?canWriteLegacyScheduleKey\(branch, docId\)[\s\S]*?match \/chunks\/\{chunkId\} \{[\s\S]*?canWriteLegacyScheduleKey\(branch, docId\)/,
  "parent and chunk writes must use the same V1 fence"
);
assert.match(source,/runtime\/activationFreeze \{[\s\S]*?allow read, write: if false;/);
assert.match(source,/runtime\/canonicalParity \{[\s\S]*?allow read, write: if false;/);

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
