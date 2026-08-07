"use strict";

const ALL_COLLECTIONS=Object.freeze([
  "tabs","people","enrollments","placements","teacherAssignments","reservations",
  "waitlistEntries","classMarks","disabledSlots","calendarClosures","schedulePeriods",
  "scheduleSettings","teacherProfiles","tabFolders","archivedTabs","systemMetadata",
  "retirementRecords","deskStudentRecords"
]);
const LEASE_MS=60_000;
const COLLECTIONS=new Set(ALL_COLLECTIONS);
const ERROR_CODES=new Set([
  "aborted","already-exists","cancelled","data-loss","deadline-exceeded",
  "failed-precondition","internal","invalid-argument","not-found","out-of-range",
  "permission-denied","resource-exhausted","unauthenticated","unavailable",
  "unimplemented","unknown",
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
    return ["people","enrollments","placements"];
  }
  if(key==="swim_inst"||/^swim_inst_/.test(key)||/^swim_bt_.+_inst$/.test(key)) return ["teacherAssignments"];
  if(["swim_retire","swim_enroll","swim_hyuwon","swim_move"].includes(key)) return ["reservations"];
  if(key==="swim_main_tab") return ["reservations","scheduleSettings"];
  if(key==="swim_parent_tab") return ["scheduleSettings"];
  if(key==="swim_teachers") return ["teacherProfiles"];
  if(key==="swim_tab_folders") return ["tabFolders"];
  if(key==="swim_archived_tabs") return ["archivedTabs"];
  if(["swim_age_year","swim_student_id_version","swim_ver"].includes(key)) return ["systemMetadata"];
  if(key==="swim_reserve") return ["waitlistEntries"];
  if(key==="swim_mark") return ["classMarks"];
  if(key==="swim_disabled") return ["disabledSlots"];
  if(key==="swim_closed") return ["calendarClosures"];
  if(key==="swim_periods") return ["schedulePeriods"];
  if(key==="swim_retire_history") return ["retirementRecords"];
  if(key==="swim_desk_notes") return ["deskStudentRecords"];
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
  const keys=pendingKeys(current);
  if(!keys.length||(Number.isFinite(leaseUntil)&&leaseUntil>nowMs)) return null;
  const next=Object.assign({},current,{
    pendingKeys:[],
    status:"processing",
    leaseId:text(leaseId),
    leaseUntil:new Date(nowMs+LEASE_MS).toISOString(),
    processingStartedAt:timestamp(now),
  });
  return {keys,leaseId:next.leaseId,requestedRevision:revision(current?.requestedRevision),next};
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
  delete next.leaseId;
  delete next.leaseUntil;
  delete next.processingStartedAt;
  return next;
}

function errorCode(error){
  let code="";
  try{code=text(error&&error.code).replace(/^functions\//,"").toLowerCase();}catch(ignore){}
  return ERROR_CODES.has(code)?code:"unknown";
}

function messageClass(code){
  if(["aborted","deadline-exceeded","resource-exhausted","unavailable"].includes(code)) return "transient";
  if(["permission-denied","unauthenticated"].includes(code)) return "authorization";
  if(["invalid-argument","failed-precondition","not-found","out-of-range"].includes(code)) return "input";
  if(["internal","data-loss"].includes(code)) return "internal";
  return "unknown";
}

function redactedError(error,input){
  const safeInput=input&&typeof input==="object"?input:{};
  const code=errorCode(error);
  const branchId=["gagyeong","yongam"].includes(text(safeInput.branchId))?text(safeInput.branchId):"";
  const keys=[...new Set((Array.isArray(safeInput.keys)?safeInput.keys:[])
    .filter(key=>typeof key==="string"&&isTrackedKey(key))
    .map(text))];
  const collections=[...new Set((Array.isArray(safeInput.collections)?safeInput.collections:[])
    .filter(collection=>typeof collection==="string"&&COLLECTIONS.has(collection)))];
  return {branchId,keys,collections,code,messageClass:messageClass(code),detectedAt:timestamp(safeInput.now)};
}

module.exports={
  decodeLegacyKey,collectionsForKey,isTrackedKey,
  mergePending,claimPending,finishPending,redactedError,
};
