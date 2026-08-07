"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const policy = require("../functions/schedule-v2-shadow-policy.js");

const NOW = new Date("2026-08-07T02:00:00.000Z");

test("decodes stored legacy keys and classifies only timetable-owned keys",()=>{
  assert.equal(policy.decodeLegacyKey("swim_students%2E2026"),"swim_students.2026");
  assert.equal(policy.decodeLegacyKey("%E3%85%87%EA%B0%80"),"\u3147\uac00");
  assert.deepEqual(policy.collectionsForKey("swim_students"),["people","enrollments","placements"]);
  assert.deepEqual(policy.collectionsForKey("swim_inst"),["teacherAssignments"]);
  assert.deepEqual(policy.collectionsForKey("swim_retire"),["reservations"]);
  assert.deepEqual(policy.collectionsForKey("swim_mark"),["classMarks"]);
  assert.equal(policy.isTrackedKey("swim_attendance"),false);
  assert.equal(policy.isTrackedKey("swim_day_snapshot"),false);
  assert.equal(policy.isTrackedKey("swim_audit_log"),false);
  assert.equal(policy.isTrackedKey("swim_restore_points"),false);
  assert.equal(policy.isTrackedKey("zz_swim_student_delete_index"),false);
});

test("coalesces keys, leases one revision, and leaves newer work pending",()=>{
  const queued=policy.mergePending({pendingKeys:["swim_inst"],requestedRevision:2},"swim_students",NOW);
  assert.deepEqual(queued.pendingKeys.sort(),["swim_inst","swim_students"]);
  assert.equal(queued.requestedRevision,3);

  const claim=policy.claimPending(queued,"lease-a",NOW);
  assert.deepEqual(claim.keys.sort(),["swim_inst","swim_students"]);
  assert.deepEqual(claim.next.pendingKeys,[]);
  assert.equal(claim.next.status,"processing");
  assert.equal(policy.claimPending(claim.next,"lease-b",NOW),null);

  const newer=policy.mergePending(claim.next,"swim_mark",new Date("2026-08-07T02:00:01.000Z"));
  const finished=policy.finishPending(newer,claim,{writes:4},new Date("2026-08-07T02:00:02.000Z"));
  assert.equal(finished.status,"pending");
  assert.deepEqual(finished.pendingKeys,["swim_mark"]);
  assert.equal(finished.appliedRevision,3);
  assert.equal(finished.writes,4);
});

test("redacts nested personal data from diagnostics",()=>{
  const name="PrivacyLeakName_Task2_20260807";
  const phone="01098765432";
  const diagnostic=policy.redactedError(
    {code:"internal",message:`failed for ${name} ${phone}`,details:{student:{name,phone}}},
    {
      branchId:"gagyeong",
      keys:["swim_students",{name,phone}],
      collections:["people","enrollments",{name,phone}],
      now:NOW,
      source:{name,phone},
    }
  );
  assert.deepEqual(Object.keys(diagnostic).sort(),[
    "branchId","code","collections","detectedAt","keys","messageClass",
  ]);
  assert.deepEqual(diagnostic.keys,["swim_students"]);
  assert.deepEqual(diagnostic.collections,["people","enrollments"]);
  assert.equal(diagnostic.code,"internal");
  assert.equal(diagnostic.messageClass,"internal");
  const serialized=JSON.stringify(diagnostic);
  assert.equal(serialized.includes(name),false);
  assert.equal(serialized.includes(phone),false);
});
