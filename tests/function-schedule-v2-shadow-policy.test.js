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
  assert.equal(claim.recovered,false);
  assert.deepEqual(claim.keys.sort(),["swim_inst","swim_students"]);
  assert.deepEqual(claim.next.pendingKeys,[]);
  assert.deepEqual(claim.next.inFlightKeys.sort(),["swim_inst","swim_students"]);
  assert.equal(claim.next.status,"processing");
  assert.equal(policy.claimPending(claim.next,"lease-b",NOW),null);

  const newer=policy.mergePending(claim.next,"swim_mark",new Date("2026-08-07T02:00:01.000Z"));
  assert.deepEqual(newer.inFlightKeys.sort(),["swim_inst","swim_students"]);
  const finished=policy.finishPending(newer,claim,{writes:4},new Date("2026-08-07T02:00:02.000Z"));
  assert.equal(finished.status,"pending");
  assert.deepEqual(finished.pendingKeys,["swim_mark"]);
  assert.equal(finished.inFlightKeys,undefined);
  assert.equal(finished.appliedRevision,3);
  assert.equal(finished.writes,4);
});

test("worker termination leaves durable in-flight keys that an expired lease can reclaim",()=>{
  const queued=policy.mergePending({pendingKeys:["swim_inst"],requestedRevision:4},"swim_students",NOW);
  const abandoned=policy.claimPending(queued,"lease-dead",NOW);

  assert.deepEqual(abandoned.next.pendingKeys,[]);
  assert.deepEqual(abandoned.next.inFlightKeys.sort(),["swim_inst","swim_students"]);
  assert.equal(
    policy.claimPending(abandoned.next,"lease-early",new Date("2026-08-07T02:00:59.000Z")),
    null,
  );

  const reclaimed=policy.claimPending(
    abandoned.next,"lease-replacement",new Date("2026-08-07T02:01:01.000Z"),
  );
  assert.equal(reclaimed.recovered,true);
  assert.deepEqual(reclaimed.keys.sort(),["swim_inst","swim_students"]);
  assert.deepEqual(reclaimed.next.pendingKeys,[]);
  assert.deepEqual(reclaimed.next.inFlightKeys.sort(),["swim_inst","swim_students"]);
  assert.equal(reclaimed.next.leaseId,"lease-replacement");
});

test("expired recovery returns in-flight keys to pending without touching an active lease",()=>{
  const queued=policy.mergePending({},"swim_students",NOW);
  const claim=policy.claimPending(queued,"lease-a",NOW);
  const newer=policy.mergePending(claim.next,"swim_mark",new Date("2026-08-07T02:00:01.000Z"));

  assert.equal(
    policy.recoverExpired(newer,new Date("2026-08-07T02:00:59.000Z")),
    null,
  );
  const recovered=policy.recoverExpired(newer,new Date("2026-08-07T02:01:01.000Z"));
  assert.deepEqual(recovered.pendingKeys.sort(),["swim_mark","swim_students"]);
  assert.equal(recovered.inFlightKeys,undefined);
  assert.equal(recovered.leaseId,undefined);
  assert.equal(recovered.status,"pending");
});

test("catch recovery merges durable in-flight keys and protects a replacement lease",()=>{
  const queued=policy.mergePending({},"swim_students",NOW);
  const claimA=policy.claimPending(queued,"lease-a",NOW);
  const newer=policy.mergePending(claimA.next,"swim_mark",new Date("2026-08-07T02:00:01.000Z"));
  const recovered=policy.requeueClaim(newer,claimA);

  assert.deepEqual(recovered.pendingKeys.sort(),["swim_mark","swim_students"]);
  assert.equal(recovered.inFlightKeys,undefined);
  assert.equal(recovered.leaseId,undefined);
  assert.equal(recovered.status,"pending");

  const claimB=policy.claimPending(newer,"lease-b",new Date("2026-08-07T02:01:01.000Z"));
  assert.deepEqual(policy.requeueClaim(claimB.next,claimA),claimB.next);
});

test("does not let a stale finisher clear a replacement lease",()=>{
  const first=policy.mergePending({},"swim_students",NOW);
  const claimA=policy.claimPending(first,"lease-a",NOW);
  const queuedForB=policy.mergePending(claimA.next,"swim_mark",new Date("2026-08-07T02:00:01.000Z"));
  const claimB=policy.claimPending(queuedForB,"lease-b",new Date("2026-08-07T02:01:01.000Z"));

  assert.equal(claimB.next.status,"processing");
  assert.equal(claimB.next.leaseId,"lease-b");
  assert.deepEqual(claimB.next.pendingKeys,[]);
  assert.deepEqual(claimB.next.inFlightKeys.sort(),["swim_mark","swim_students"]);

  const staleFinish=policy.finishPending(claimB.next,claimA,{writes:99},new Date("2026-08-07T02:01:02.000Z"));
  assert.deepEqual(staleFinish,claimB.next);
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
