"use strict";

const ALL_COLLECTIONS=Object.freeze([
  "tabs","people","enrollments","placements","teacherAssignments","reservations",
  "waitlistEntries","classMarks","disabledSlots","calendarClosures","schedulePeriods",
  "scheduleSettings","teacherProfiles","tabFolders","archivedTabs","systemMetadata",
  "retirementRecords","deskStudentRecords","attendanceRecords","attendanceGuests",
  "attendanceSnapshots","attendanceSnapshotStudents","attendanceSnapshotTeachers"
]);
const LEASE_MS=60_000;
const COLLECTIONS=new Set(ALL_COLLECTIONS);
const ERROR_CODES=new Set([
  "aborted","already-exists","cancelled","data-loss","deadline-exceeded",
  "failed-precondition","internal","invalid-argument","not-found","out-of-range",
  "permission-denied","resource-exhausted","unauthenticated","unavailable",
  "unimplemented","unknown","conversion-mismatch","verification-mismatch","stale-run",
]);

function text(value){
  return String(value == null ? "" : value).trim();
}

function decodeLegacyKey(docId){
  const encoded=text(docId).replace(/%2E/gi,".");
  try{
    return decodeURIComponent(encoded);
  }catch(error){
    return encoded;
  }
}

function collectionsForKey(key){
  key=text(key);
  if(key==="swim_tab_list") return ALL_COLLECTIONS.slice();
  if(key==="swim_students"||/^swim_stu_/.test(key)||/^swim_bt_.+_stu$/.test(key)){
    return ["people","enrollments","placements","classMarks","disabledSlots"];
  }
  if(key==="swim_inst"||/^swim_inst_/.test(key)||/^swim_bt_.+_inst$/.test(key)){
    return ["teacherAssignments","classMarks","disabledSlots"];
  }
  if(["swim_retire","swim_enroll","swim_hyuwon","swim_move"].includes(key)) return ["reservations"];
  if(key==="swim_main_tab") return ["reservations","waitlistEntries","classMarks","scheduleSettings"];
  if(key==="swim_parent_tab") return ["scheduleSettings"];
  if(key==="swim_teachers") return ["teacherProfiles"];
  if(key==="swim_tab_folders") return ["tabFolders"];
  if(key==="swim_archived_tabs") return ["archivedTabs"];
  if(["swim_age_year","swim_student_id_version","swim_ver"].includes(key)) return ["systemMetadata"];
  if(key==="swim_reserve") return ["waitlistEntries"];
  if(key==="swim_mark") return ["classMarks"];
  if(key==="swim_disabled") return ["disabledSlots"];
  if(key==="swim_closed") return ["calendarClosures"];
  if(key==="swim_periods"){
    return [
      "reservations","waitlistEntries","classMarks","schedulePeriods",
      "retirementRecords","deskStudentRecords",
    ];
  }
  if(key==="swim_retire_history") return ["retirementRecords"];
  if(key==="swim_desk_notes") return ["deskStudentRecords"];
  if(key==="swim_attendance"||/^swim_bt_attendance_[A-Za-z0-9_-]+$/.test(key)){
    return ["attendanceRecords"];
  }
  if(key==="swim_att_guests"||/^swim_bt_att_guests_[A-Za-z0-9_-]+$/.test(key)){
    return ["attendanceGuests"];
  }
  if(key==="swim_day_snapshot"||/^swim_bt_day_snapshot_[A-Za-z0-9_-]+$/.test(key)
    ||/^zz_swim_day_snapshot__(regular|bt_[A-Za-z0-9_-]+)__\d{4}-\d{2}-\d{2}$/.test(key)){
    return ["attendanceSnapshots","attendanceSnapshotStudents","attendanceSnapshotTeachers"];
  }
  return [];
}

function isTrackedKey(key){
  return collectionsForKey(key).length>0;
}

function timestamp(now){
  const value=now instanceof Date ? now : new Date(now);
  return Number.isNaN(value.getTime()) ? new Date(0).toISOString() : value.toISOString();
}

function revision(value){
  const number=Number(value);
  return Number.isSafeInteger(number)&&number>=0 ? number : 0;
}

function pendingKeys(current){
  return [...new Set((Array.isArray(current?.pendingKeys)?current.pendingKeys:[])
    .map(text)
    .filter(isTrackedKey))];
}

function inFlightKeys(current){
  return [...new Set((Array.isArray(current?.inFlightKeys)?current.inFlightKeys:[])
    .map(text)
    .filter(isTrackedKey))];
}

function combinedKeys(...groups){
  return [...new Set(groups.flat().map(text).filter(isTrackedKey))];
}

function mergePending(current,key,now){
  const next=Object.assign({},current);
  const keys=pendingKeys(current);
  const normalized=text(key);
  if(isTrackedKey(normalized)&&!keys.includes(normalized)) keys.push(normalized);
  next.pendingKeys=keys;
  next.requestedRevision=revision(current?.requestedRevision)+1;
  next.requestedAt=timestamp(now);
  if(next.status!=="processing") next.status="pending";
  return next;
}

function claimPending(current,leaseId,now){
  const nowDate=now instanceof Date ? now : new Date(now);
  const nowMs=nowDate.getTime();
  const leaseUntil=Date.parse(current?.leaseUntil||"");
  if(Number.isFinite(leaseUntil)&&leaseUntil>nowMs) return null;
  const flight=inFlightKeys(current);
  const keys=combinedKeys(flight,pendingKeys(current));
  if(!keys.length) return null;
  const next=Object.assign({},current,{
    pendingKeys:[],
    inFlightKeys:keys,
    status:"processing",
    leaseId:text(leaseId),
    leaseUntil:new Date(nowMs+LEASE_MS).toISOString(),
    processingStartedAt:timestamp(now),
  });
  delete next.recoveryWakeAt;
  return {
    keys,leaseId:next.leaseId,recovered:flight.length>0,
    requestedRevision:revision(current?.requestedRevision),next,
  };
}

function renewLease(current,leaseId,now){
  const normalizedLeaseId=text(leaseId);
  const nowDate=now instanceof Date?now:new Date(now);
  const nowMs=nowDate.getTime();
  const leaseUntil=Date.parse(current?.leaseUntil||"");
  if(!normalizedLeaseId||text(current?.leaseId)!==normalizedLeaseId) return null;
  if(!Number.isFinite(nowMs)||!Number.isFinite(leaseUntil)||leaseUntil<=nowMs) return null;
  if(current?.status!=="processing"||!inFlightKeys(current).length) return null;
  return Object.assign({},current,{
    leaseUntil:new Date(nowMs+LEASE_MS).toISOString(),
    leaseHeartbeatAt:timestamp(nowDate),
  });
}

function finishPending(current,claim,result,now){
  if(!text(claim?.leaseId)||text(current?.leaseId)!==text(claim.leaseId)) return current;
  const next=Object.assign({},current,result&&typeof result==="object"?result:{});
  const claimedRevision=revision(claim?.requestedRevision);
  const hasNewerWork=pendingKeys(current).length>0||revision(current?.requestedRevision)>claimedRevision;
  next.pendingKeys=pendingKeys(current);
  next.appliedRevision=Math.max(revision(current?.appliedRevision),claimedRevision);
  next.status=hasNewerWork?"pending":"idle";
  next.lastSyncedAt=timestamp(now);
  delete next.inFlightKeys;
  delete next.leaseId;
  delete next.leaseUntil;
  delete next.processingStartedAt;
  delete next.leaseHeartbeatAt;
  delete next.recoveryWakeAt;
  return next;
}

function requeueClaim(current,claim){
  if(!text(claim?.leaseId)||text(current?.leaseId)!==text(claim.leaseId)) return current;
  const keys=combinedKeys(pendingKeys(current),inFlightKeys(current),Array.isArray(claim?.keys)?claim.keys:[]);
  const next=Object.assign({},current,{pendingKeys:keys,status:keys.length?"pending":"idle"});
  delete next.inFlightKeys;
  delete next.leaseId;
  delete next.leaseUntil;
  delete next.processingStartedAt;
  delete next.leaseHeartbeatAt;
  return next;
}

function recoverExpired(current,now){
  const nowDate=now instanceof Date ? now : new Date(now);
  const leaseUntil=Date.parse(current?.leaseUntil||"");
  if(Number.isFinite(leaseUntil)&&leaseUntil>nowDate.getTime()) return null;
  const flight=inFlightKeys(current);
  const pending=pendingKeys(current);
  if(!flight.length&&!pending.length) return null;
  const next=Object.assign({},current,{
    pendingKeys:combinedKeys(pending,flight),
    status:"pending",
    recoveryWakeAt:timestamp(nowDate),
  });
  delete next.inFlightKeys;
  delete next.leaseId;
  delete next.leaseUntil;
  delete next.processingStartedAt;
  delete next.leaseHeartbeatAt;
  return next;
}

function errorCode(error){
  let code="";
  try{code=text(error&&error.code).replace(/^functions\//,"").toLowerCase();}catch(ignore){}
  return ERROR_CODES.has(code)?code:"unknown";
}

function messageClass(code){
  if(code==="conversion-mismatch") return "conversion";
  if(code==="verification-mismatch") return "verification";
  if(code==="stale-run") return "stale";
  if(["aborted","deadline-exceeded","resource-exhausted","unavailable"].includes(code)) return "transient";
  if(["permission-denied","unauthenticated"].includes(code)) return "authorization";
  if(["invalid-argument","failed-precondition","not-found","out-of-range"].includes(code)) return "input";
  if(["internal","data-loss"].includes(code)) return "internal";
  return "unknown";
}

function diagnosticKeyFamily(key){
  key=text(key);
  if(key==="swim_students") return "students-regular";
  if(/^swim_stu_/.test(key)||/^swim_bt_.+_stu$/.test(key)) return "students-tab";
  if(key==="swim_inst") return "instructors-regular";
  if(/^swim_inst_/.test(key)||/^swim_bt_.+_inst$/.test(key)) return "instructors-tab";
  if(["swim_retire","swim_enroll","swim_hyuwon","swim_move"].includes(key)) return "reservations";
  const fixed={
    swim_tab_list:"tabs",swim_main_tab:"main-tab",swim_parent_tab:"parent-tab",
    swim_teachers:"teacher-profiles",swim_tab_folders:"tab-folders",
    swim_archived_tabs:"archived-tabs",swim_age_year:"system-metadata",
    swim_student_id_version:"system-metadata",swim_ver:"system-metadata",
    swim_reserve:"waitlist",swim_mark:"class-marks",swim_disabled:"disabled-slots",
    swim_closed:"calendar-closures",swim_periods:"schedule-periods",
    swim_retire_history:"retirement-history",swim_desk_notes:"desk-history",
    swim_attendance:"attendance-records",swim_att_guests:"attendance-guests",
    swim_day_snapshot:"attendance-snapshots",
  };
  if(/^swim_bt_attendance_/.test(key)) return "attendance-records-tab";
  if(/^swim_bt_att_guests_/.test(key)) return "attendance-guests-tab";
  if(/^swim_bt_day_snapshot_/.test(key)||/^zz_swim_day_snapshot__/.test(key)){
    return "attendance-snapshots-tab";
  }
  return fixed[key]||"schedule-key";
}

function redactedError(error,input){
  const safeInput=input&&typeof input==="object"?input:{};
  const code=errorCode(error);
  const branchId=["gagyeong","yongam"].includes(text(safeInput.branchId))?text(safeInput.branchId):"";
  const keys=[...new Set((Array.isArray(safeInput.keys)?safeInput.keys:[])
    .filter(key=>typeof key==="string"&&isTrackedKey(key))
    .map(diagnosticKeyFamily))];
  const collections=[...new Set((Array.isArray(safeInput.collections)?safeInput.collections:[])
    .filter(collection=>typeof collection==="string"&&COLLECTIONS.has(collection)))];
  return {branchId,keys,collections,code,messageClass:messageClass(code),detectedAt:timestamp(safeInput.now)};
}

module.exports={
  decodeLegacyKey,collectionsForKey,isTrackedKey,
  mergePending,claimPending,renewLease,finishPending,requeueClaim,recoverExpired,redactedError,
};
