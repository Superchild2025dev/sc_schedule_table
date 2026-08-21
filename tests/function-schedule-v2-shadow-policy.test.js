"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const policy = require("../functions/schedule-v2-shadow-policy.js");

const NOW = new Date("2026-08-07T02:00:00.000Z");

test("decodes stored legacy keys and classifies only timetable-owned keys",()=>{
  assert.equal(policy.decodeLegacyKey("swim_students%2E2026"),"swim_students.2026");
  assert.equal(policy.decodeLegacyKey("%E3%85%87%EA%B0%80"),"\u3147\uac00");
  assert.deepEqual(policy.collectionsForKey("swim_students"),[
    "people","enrollments","placements","classMarks","disabledSlots",
  ]);
  assert.deepEqual(policy.collectionsForKey("swim_inst"),[
    "teacherAssignments","classMarks","disabledSlots",
  ]);
  assert.deepEqual(policy.collectionsForKey("swim_retire"),["reservations"]);
  assert.deepEqual(policy.collectionsForKey("swim_mark"),["classMarks"]);
  assert.deepEqual(policy.collectionsForKey("swim_main_tab"),[
    "reservations","waitlistEntries","classMarks","scheduleSettings",
  ]);
  assert.deepEqual(policy.collectionsForKey("swim_periods"),[
    "reservations","waitlistEntries","classMarks","schedulePeriods",
    "retirementRecords","deskStudentRecords",
  ]);
  assert.deepEqual(policy.collectionsForKey("swim_attendance"),["attendanceRecords"]);
  assert.deepEqual(policy.collectionsForKey("swim_att_guests"),["attendanceGuests"]);
  assert.deepEqual(policy.collectionsForKey("swim_day_snapshot"),[
    "attendanceSnapshots","attendanceSnapshotStudents","attendanceSnapshotTeachers",
  ]);
  assert.deepEqual(policy.collectionsForKey("swim_bt_attendance_summer"),["attendanceRecords"]);
  assert.deepEqual(policy.collectionsForKey("swim_bt_att_guests_summer"),["attendanceGuests"]);
  assert.deepEqual(policy.collectionsForKey("swim_bt_day_snapshot_summer"),[
    "attendanceSnapshots","attendanceSnapshotStudents","attendanceSnapshotTeachers",
  ]);
  assert.deepEqual(policy.collectionsForKey("zz_swim_day_snapshot__regular__2026-08-07"),[
    "attendanceSnapshots","attendanceSnapshotStudents","attendanceSnapshotTeachers",
  ]);
  assert.equal(policy.isTrackedKey("swim_attendance"),true);
  assert.equal(policy.isTrackedKey("swim_day_snapshot"),true);
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

test("scheduled recovery also wakes pending work stranded without a lease",()=>{
  const pending={pendingKeys:["swim_students"],requestedRevision:4,status:"pending"};
  const recovered=policy.recoverExpired(pending,new Date("2026-08-07T02:01:01.000Z"));
  assert.deepEqual(recovered.pendingKeys,["swim_students"]);
  assert.equal(recovered.status,"pending");
  assert.equal(recovered.recoveryWakeAt,"2026-08-07T02:01:01.000Z");
});

test("lease heartbeats preserve ownership across a long operation and fail closed after expiry",()=>{
  let state=policy.claimPending(
    policy.mergePending({},"swim_students",NOW),"lease-long",NOW,
  ).next;
  for(let minute=1;minute<=20;minute++){
    const pulse=new Date(NOW.getTime()+minute*50_000);
    state=policy.renewLease(state,"lease-long",pulse);
    assert.ok(state,`heartbeat ${minute} must retain ownership`);
    assert.equal(policy.claimPending(state,"lease-rival",new Date(pulse.getTime()+59_000)),null);
  }
  assert.equal(
    policy.renewLease(state,"lease-long",new Date(state.leaseUntil)),
    null,
  );
  const expiredAt=new Date(Date.parse(state.leaseUntil)+1);
  assert.equal(policy.renewLease(state,"lease-long",expiredAt),null);
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
  assert.deepEqual(diagnostic.keys,["students-regular"]);
  assert.deepEqual(diagnostic.collections,["people","enrollments"]);
  assert.equal(diagnostic.code,"internal");
  assert.equal(diagnostic.messageClass,"internal");
  const serialized=JSON.stringify(diagnostic);
  assert.equal(serialized.includes(name),false);
  assert.equal(serialized.includes(phone),false);
});

test("diagnostics normalize dynamic keys and preserve safe mismatch classes",()=>{
  const privateTab="Private_Tab_20260807";
  const input={
    branchId:"yongam",
    keys:[`swim_stu_${privateTab}`,`swim_bt_${privateTab}_inst`,"swim_periods"],
    collections:["people","classMarks"],
    now:NOW,
  };
  const conversion=policy.redactedError({code:"conversion-mismatch"},input);
  const verification=policy.redactedError({code:"verification-mismatch"},input);
  assert.deepEqual(conversion.keys,["students-tab","instructors-tab","schedule-periods"]);
  assert.equal(conversion.code,"conversion-mismatch");
  assert.equal(conversion.messageClass,"conversion");
  assert.equal(verification.code,"verification-mismatch");
  assert.equal(verification.messageClass,"verification");
  assert.equal(JSON.stringify({conversion,verification}).includes(privateTab),false);
});
