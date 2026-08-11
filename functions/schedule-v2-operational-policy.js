"use strict";

const crypto=require("node:crypto");
const permissionManifest=require("../config/schedule-permissions.json");
require("./schedule-v2-operational-model.js");

const model=globalThis.SCV2OperationalModel;
const REQUEST_KEYS=Object.freeze([
  "branchId","generationId","expectedEpoch","operationId","operationType",
  "keys","beforeRevision","nextValues","removedKeys",
]);
const REQUEST_KEY_SET=new Set(REQUEST_KEYS);
const BRANCH_IDS=new Set((permissionManifest.branches||[]).map(branch=>String(branch.id||"")));
const ACCOUNT_BY_EMAIL=new Map((permissionManifest.accounts||[]).map(account=>[
  String(account.email||"").trim().toLowerCase(),account,
]));
function permissionActorId(email){
  return crypto.createHash("sha256").update(String(email||"").trim().toLowerCase()).digest("hex").slice(0,24);
}
const ACCOUNT_BY_ACTOR_ID=new Map((permissionManifest.accounts||[]).map(account=>[
  permissionActorId(account.email),account,
]));
const TEACHER_EXACT_KEYS=new Set(permissionManifest.teacherWritableExactKeys||[]);
const TEACHER_PATTERNS=(permissionManifest.teacherWritablePatterns||[]).map(pattern=>new RegExp(pattern));
const MAX_KEYS=64;
const MAX_DOCUMENT_ID_BYTES=1500;
const MAX_REQUEST_BYTES=8*1024*1024;
const MAX_VALUE_BYTES=6*1024*1024;
const TERMINAL_RECOVERY_STATES=Object.freeze({
  mirror:new Set(["error"]),
  request:new Set(["error","conflict","cancelled","rejected"]),
});
const SAFE_ERROR_CODES=new Set([
  "aborted","already-exists","cancelled","data-loss","deadline-exceeded",
  "failed-precondition","internal","invalid-argument","not-found","out-of-range",
  "permission-denied","resource-exhausted","unauthenticated","unavailable",
  "unimplemented","unknown",
]);

function rule(families,teacher=false){
  return Object.freeze({families:new Set(families),teacher});
}

const OPERATION_RULES=Object.freeze({
  "add-student":rule(["student-roster","mark","reservation","disabled","history"]),
  "update-student":rule(["student-roster","mark","reservation","disabled","history"]),
  "replace-student":rule(["student-roster","mark","reservation","disabled","history"]),
  "copy-student":rule(["student-roster","mark","disabled"]),
  "delete-student":rule(["student-roster","mark","reservation","disabled","history"]),
  "move-student":rule(["student-roster","mark","reservation","disabled","history"]),
  "change-student-class":rule(["student-roster","mark","reservation","disabled","history"]),
  "change-student-time":rule(["student-roster","mark","reservation","disabled","history"]),
  "update-teacher":rule(["teacher-roster","mark","disabled"]),
  "add-teacher":rule(["teacher-roster","mark","disabled"]),
  "remove-teacher":rule(["teacher-roster","mark","disabled"]),
  "sort-teachers":rule(["teacher-roster","teacher-profile"]),
  "update-reservation":rule(["reservation"]),
  "add-reservation":rule(["reservation"]),
  "remove-reservation":rule(["reservation"]),
  "update-waitlist":rule(["waitlist"]),
  "update-calendar":rule(["calendar","disabled"]),
  "update-periods":rule(["periods","reservation","waitlist","mark","history"]),
  "update-tabs":rule(["tabs","student-roster","teacher-roster","settings","administration"]),
  "update-settings":rule(["settings","administration"]),
  "update-records":rule(["history"]),
  "edit-schedule":rule([
    "tabs","student-roster","teacher-roster","mark","reservation","waitlist",
    "disabled","calendar","periods","settings","teacher-profile","administration","history",
  ]),
  "attendance":rule(["attendance"],true),
  "attendance-update":rule(["attendance"],true),
  "attendance-batch":rule(["attendance"],true),
  "attendance-guest":rule(["attendance"],true),
  "attendance-snapshot":rule(["attendance"],true),
  "mark-attendance":rule(["attendance"],true),
  "absence-confirmation":rule(["mark"],true),
  "confirm-absence":rule(["mark"],true),
  "absence-cancel":rule(["mark"],true),
  "makeup":rule(["mark"],true),
  "makeup-update":rule(["mark"],true),
  "makeup-cancel":rule(["mark"],true),
  "set-makeup":rule(["mark"],true),
  "sample-makeup":rule(["mark"],true),
  "mandatory-makeup":rule(["mark"],true),
});
const MAKEUP_OPERATION_TYPES=new Set([
  "makeup","makeup-update","makeup-cancel","set-makeup","sample-makeup","mandatory-makeup",
]);
const ABSENCE_OPERATION_TYPES=new Set([
  "absence-confirmation","confirm-absence","absence-cancel",
]);
const REQUEST_RECOVERY_VERSION=1;
const REQUEST_RECOVERY_OPERATION_TYPES=new Set(["absence-cancel","makeup-update","makeup-cancel","makeup"]);
const REQUEST_RECOVERY_EXPECTED_STATUSES=new Set(["pending","processing","accepted"]);
const REQUEST_RECOVERY_TARGET_STATUSES=new Set(["accepted","rejected","superseded","cancelled"]);
const REQUEST_RECOVERY_PATCH_KEYS=new Set([
  "status","processedAt","supersededBy","cancelledAt","cancelledBy","cancelledRequestId","clearProcessing",
]);
const MAX_REQUEST_RECOVERY_INTENTS=32;
const MAX_REQUEST_RECOVERY_BYTES=64*1024;

function fail(code){
  throw Object.assign(new Error(code),{code});
}

function text(value){
  return String(value==null?"":value).trim();
}

function safeInteger(value){
  return Number.isSafeInteger(value)&&value>=0;
}

function plainObject(value){
  if(!value||typeof value!=="object"||Array.isArray(value)) return false;
  const prototype=Object.getPrototypeOf(value);
  return prototype===Object.prototype||prototype===null;
}

function jsonBytes(value){
  try{return Buffer.byteLength(JSON.stringify(value),"utf8");}
  catch(error){fail("invalid-argument");}
}

function encodedDocumentIdBytes(value){
  return Buffer.byteLength(encodeURIComponent(value).replace(/\./g,"%2E"),"utf8");
}

function exactKeys(value,keys){
  const actual=Object.keys(value||{});
  return actual.length===keys.length&&actual.every(key=>keys.includes(key));
}

function requestId(value){
  return normalizeString(value,/^r_[0-9]{13}_[a-z0-9]{6}$/);
}

function recoveryOperationId(value){
  return normalizeString(value,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
}

function isoTimestamp(value){
  const normalized=text(value);
  if(normalized.length<20||normalized.length>40||!Number.isFinite(Date.parse(normalized))) fail("invalid-argument");
  return normalized;
}

function validateRequestRecoveryPatch(input){
  if(!plainObject(input)||!Object.keys(input).length||Object.keys(input).some(key=>!REQUEST_RECOVERY_PATCH_KEYS.has(key))){
    fail("invalid-argument");
  }
  const status=text(input.status);
  if(!REQUEST_RECOVERY_TARGET_STATUSES.has(status)) fail("invalid-argument");
  const requiredByStatus={
    accepted:["status","processedAt"],
    rejected:["status","processedAt"],
    superseded:["status","processedAt","supersededBy"],
    cancelled:["status","processedAt","cancelledAt","cancelledBy","cancelledRequestId"],
  };
  const allowed=new Set(requiredByStatus[status].concat(status==="cancelled"?[]:["clearProcessing"]));
  const actual=Object.keys(input);
  if(actual.some(key=>!allowed.has(key))||requiredByStatus[status].some(key=>!actual.includes(key))){
    fail("invalid-argument");
  }
  const patch={status};
  if(Object.prototype.hasOwnProperty.call(input,"processedAt")) patch.processedAt=isoTimestamp(input.processedAt);
  if(Object.prototype.hasOwnProperty.call(input,"supersededBy")) patch.supersededBy=requestId(input.supersededBy);
  if(Object.prototype.hasOwnProperty.call(input,"cancelledAt")) patch.cancelledAt=isoTimestamp(input.cancelledAt);
  if(Object.prototype.hasOwnProperty.call(input,"cancelledBy")){
    if(input.cancelledBy!=="parent-approved") fail("invalid-argument");
    patch.cancelledBy="parent-approved";
  }
  if(Object.prototype.hasOwnProperty.call(input,"cancelledRequestId")){
    patch.cancelledRequestId=requestId(input.cancelledRequestId);
  }
  if(Object.prototype.hasOwnProperty.call(input,"clearProcessing")){
    if(input.clearProcessing!==true) fail("invalid-argument");
    patch.clearProcessing=true;
  }
  if(!patch.processedAt) fail("invalid-argument");
  if(status==="superseded"&&!patch.supersededBy) fail("invalid-argument");
  if(status==="cancelled"&&(!patch.cancelledAt||patch.cancelledBy!=="parent-approved"||!patch.cancelledRequestId)){
    fail("invalid-argument");
  }
  if(status==="cancelled"&&patch.cancelledAt!==patch.processedAt) fail("invalid-argument");
  return Object.freeze(patch);
}

function validateRequestRecoveryCommand(input){
  if(!plainObject(input)||input.version!==REQUEST_RECOVERY_VERSION) fail("invalid-argument");
  const action=text(input.action);
  if(action==="drain"||action==="status"){
    if(!exactKeys(input,["version","action","branchId","operationId"])) fail("invalid-argument");
    const branchId=normalizeString(input.branchId,/^[A-Za-z0-9_-]{1,64}$/);
    if(!BRANCH_IDS.has(branchId)) fail("invalid-argument");
    const operationId=text(input.operationId);
    if(action==="status"&&operationId) fail("invalid-argument");
    if(operationId) recoveryOperationId(operationId);
    return Object.freeze({version:REQUEST_RECOVERY_VERSION,action,branchId,operationId});
  }
  if(action!=="stage"||!exactKeys(input,[
    "version","action","branchId","operationId","operationType","intents",
  ])) fail("invalid-argument");
  const branchId=normalizeString(input.branchId,/^[A-Za-z0-9_-]{1,64}$/);
  if(!BRANCH_IDS.has(branchId)) fail("invalid-argument");
  const operationId=recoveryOperationId(input.operationId);
  const operationType=text(input.operationType);
  if(!REQUEST_RECOVERY_OPERATION_TYPES.has(operationType)) fail("invalid-argument");
  if(!Array.isArray(input.intents)||!input.intents.length||input.intents.length>MAX_REQUEST_RECOVERY_INTENTS){
    fail("invalid-argument");
  }
  const seen=new Set();
  const intents=input.intents.map(intent=>{
    if(!plainObject(intent)||!exactKeys(intent,["requestId","expectedStatus","expectedVersion","patch"])){
      fail("invalid-argument");
    }
    const id=requestId(intent.requestId);
    if(seen.has(id)) fail("invalid-argument");
    seen.add(id);
    const expectedStatus=text(intent.expectedStatus)||"pending";
    if(!REQUEST_RECOVERY_EXPECTED_STATUSES.has(expectedStatus)) fail("invalid-argument");
    const expectedVersion=intent.expectedVersion;
    if(expectedVersion!==null&&!safeInteger(expectedVersion)) fail("invalid-argument");
    const patch=validateRequestRecoveryPatch(intent.patch);
    const expectedByTarget={
      accepted:new Set(["pending","processing"]),
      rejected:new Set(["pending","processing"]),
      superseded:new Set(["pending","processing"]),
      cancelled:new Set(["accepted"]),
    };
    if(!expectedByTarget[patch.status].has(expectedStatus)) fail("invalid-argument");
    if((patch.supersededBy&&patch.supersededBy===id)||
        (patch.cancelledRequestId&&patch.cancelledRequestId===id)) fail("invalid-argument");
    return Object.freeze({
      requestId:id,expectedStatus,expectedVersion,
      patch,
    });
  });
  const result={version:REQUEST_RECOVERY_VERSION,action,branchId,operationId,operationType,intents};
  if(jsonBytes(result)>MAX_REQUEST_RECOVERY_BYTES) fail("invalid-argument");
  return Object.freeze(result);
}

function validateTerminalRecoveryCommand(input){
  const keys=["version","action","branchId","kind","operationId","expectedState"];
  if(!plainObject(input)||input.version!==1||!exactKeys(input,keys)) fail("invalid-argument");
  const action=text(input.action);
  const branchId=normalizeString(input.branchId,/^[A-Za-z0-9_-]{1,64}$/);
  const kind=text(input.kind);
  const operationId=normalizeString(input.operationId,/^[A-Za-z0-9_-]{1,128}$/);
  const expectedState=text(input.expectedState);
  if(!["retry","resolve"].includes(action)||!BRANCH_IDS.has(branchId)||
      !Object.prototype.hasOwnProperty.call(TERMINAL_RECOVERY_STATES,kind)||
      !TERMINAL_RECOVERY_STATES[kind].has(expectedState)) fail("invalid-argument");
  if(kind==="request") recoveryOperationId(operationId);
  return Object.freeze({version:1,action,branchId,kind,operationId,expectedState});
}

function keyFamily(key){
  if(key==="swim_tab_list") return "tabs";
  if(key==="swim_students"||/^swim_stu_[A-Za-z0-9_-]+$/.test(key)||/^swim_bt_[A-Za-z0-9_-]+_stu$/.test(key)) return "student-roster";
  if(key==="swim_inst"||/^swim_inst_[A-Za-z0-9_-]+$/.test(key)||/^swim_bt_[A-Za-z0-9_-]+_inst$/.test(key)) return "teacher-roster";
  if(key==="swim_mark") return "mark";
  if(["swim_retire","swim_enroll","swim_hyuwon","swim_move"].includes(key)) return "reservation";
  if(key==="swim_reserve") return "waitlist";
  if(model.domainForLegacyKey(key)==="attendance") return "attendance";
  if(key==="swim_disabled") return "disabled";
  if(key==="swim_closed") return "calendar";
  if(key==="swim_periods") return "periods";
  if(["swim_main_tab","swim_parent_tab"].includes(key)) return "settings";
  if(key==="swim_teachers") return "teacher-profile";
  if(["swim_tab_folders","swim_archived_tabs","swim_age_year","swim_student_id_version","swim_ver"].includes(key)) return "administration";
  if(["swim_retire_history","swim_desk_notes"].includes(key)) return "history";
  return "";
}

function normalizeString(value,pattern){
  const normalized=text(value);
  if(!pattern.test(normalized)) fail("invalid-argument");
  return normalized;
}

function validateMutationRequest(input){
  if(!plainObject(input)) fail("invalid-argument");
  const actualKeys=Object.keys(input);
  if(actualKeys.length!==REQUEST_KEYS.length||actualKeys.some(key=>!REQUEST_KEY_SET.has(key))) fail("invalid-argument");
  if(REQUEST_KEYS.some(key=>!Object.prototype.hasOwnProperty.call(input,key))) fail("invalid-argument");

  const branchId=normalizeString(input.branchId,/^[A-Za-z0-9_-]{1,64}$/);
  if(!BRANCH_IDS.has(branchId)) fail("invalid-argument");
  const generationId=normalizeString(input.generationId,/^[A-Za-z0-9_-]{1,128}$/);
  const operationId=normalizeString(input.operationId,/^[A-Za-z0-9_-]{1,128}$/);
  const operationType=normalizeString(input.operationType,/^[a-z0-9-]{1,64}$/);
  const operationRule=OPERATION_RULES[operationType];
  if(!operationRule) fail("invalid-argument");
  if(!safeInteger(input.expectedEpoch)||!safeInteger(input.beforeRevision)) fail("invalid-argument");
  if(!Array.isArray(input.keys)||!input.keys.length||input.keys.length>MAX_KEYS) fail("invalid-argument");
  if(!Array.isArray(input.removedKeys)||!plainObject(input.nextValues)) fail("invalid-argument");

  const keys=input.keys.map(key=>text(key));
  const keySet=new Set(keys);
  if(keySet.size!==keys.length||keys.some(key=>!key||!model.domainForLegacyKey(key))) fail("invalid-argument");
  if(keys.some(key=>encodedDocumentIdBytes(key)>MAX_DOCUMENT_ID_BYTES)) fail("invalid-argument");
  if(keys.some(key=>!operationRule.families.has(keyFamily(key)))) fail("invalid-argument");
  const removedKeys=input.removedKeys.map(key=>text(key));
  if(new Set(removedKeys).size!==removedKeys.length||removedKeys.some(key=>!keySet.has(key))) fail("invalid-argument");
  const nextValueKeys=Object.keys(input.nextValues);
  if(nextValueKeys.some(key=>!keySet.has(key)||removedKeys.includes(key))) fail("invalid-argument");
  if(keys.some(key=>!removedKeys.includes(key)&&!Object.prototype.hasOwnProperty.call(input.nextValues,key))) fail("invalid-argument");
  if(nextValueKeys.some(key=>jsonBytes(input.nextValues[key])>MAX_VALUE_BYTES)) fail("invalid-argument");
  if(jsonBytes(input)>MAX_REQUEST_BYTES) fail("invalid-argument");

  return {
    branchId,generationId,expectedEpoch:input.expectedEpoch,operationId,operationType,
    keys:Object.freeze(keys.slice()),beforeRevision:input.beforeRevision,
    nextValues:Object.freeze({...input.nextValues}),removedKeys:Object.freeze(removedKeys.slice()),
  };
}

function parseMarkMap(value){
  let parsed=value;
  if(typeof value==="string"){
    try{parsed=JSON.parse(value);}
    catch(error){fail("invalid-argument");}
  }
  if(!plainObject(parsed)) fail("invalid-argument");
  return parsed;
}

function markSemanticProjections(value){
  if(!plainObject(value)) return {absence:null,makeup:null};
  if(value.type!=="absent") return {absence:null,makeup:value};
  const absence={...value};
  delete absence.sub;
  return {absence,makeup:plainObject(value.sub)?value.sub:null};
}

function validateMarkMutationSemantics(operationType,beforeValue,afterValue){
  const absenceOperation=ABSENCE_OPERATION_TYPES.has(operationType);
  const makeupOperation=MAKEUP_OPERATION_TYPES.has(operationType);
  if(!absenceOperation&&!makeupOperation) return;
  const before=parseMarkMap(beforeValue);
  const after=parseMarkMap(afterValue);
  const keys=new Set([...Object.keys(before),...Object.keys(after)]);
  for(const key of keys){
    const previous=markSemanticProjections(before[key]);
    const next=markSemanticProjections(after[key]);
    const protectedBefore=absenceOperation?previous.makeup:previous.absence;
    const protectedAfter=absenceOperation?next.makeup:next.absence;
    if(model.canonicalDigest(protectedBefore)!==model.canonicalDigest(protectedAfter)){
      fail("permission-denied");
    }
  }
}

function normalizeAuth(input){
  if(input?.auth) return input.auth;
  return input;
}

function authorizeBranchStaff(authInput,branchId){
  const auth=normalizeAuth(authInput);
  if(!auth?.uid) fail("unauthenticated");
  const email=text(auth.token?.email).toLowerCase();
  if(!email||auth.token?.email_verified!==true) fail("permission-denied");
  const account=ACCOUNT_BY_EMAIL.get(email);
  if(!account||account.active===false) fail("permission-denied");
  const role=text(account.role);
  const branchIds=Array.isArray(account.branchIds)?account.branchIds.map(text):[];
  const crossBranchTeacher=role==="teacher"&&permissionManifest.teacherCrossBranchAccess===true;
  if(!["developer","superAdmin"].includes(role)&&!crossBranchTeacher&&!branchIds.includes(branchId)){
    fail("permission-denied");
  }
  if(!["developer","superAdmin","desk","teacher"].includes(role)) fail("permission-denied");
  return Object.freeze({
    email,role,branchIds:Object.freeze(branchIds.slice()),
    teacherName:text(account.teacherName),permissions:Object.freeze((account.permissions||[]).slice()),
  });
}

function authorizeMutation(authInput,mutationInput){
  const mutation=mutationInput&&mutationInput.operationType?mutationInput:validateMutationRequest(mutationInput);
  const actor=authorizeBranchStaff(authInput,mutation.branchId);
  const role=actor.role;
  const accountPermissions=actor.permissions;
  if(role==="teacher"){
    const operationRule=OPERATION_RULES[mutation.operationType];
    if(!operationRule?.teacher) fail("permission-denied");
    if(MAKEUP_OPERATION_TYPES.has(mutation.operationType)&&!accountPermissions.includes("editMakeup")){
      fail("permission-denied");
    }
    const writable=mutation.keys.every(key=>
      (TEACHER_EXACT_KEYS.has(key)||TEACHER_PATTERNS.some(pattern=>pattern.test(key)))&&
      ["attendance","mark"].includes(keyFamily(key))
    );
    if(!writable) fail("permission-denied");
  }else if(!["developer","superAdmin","desk"].includes(role)){
    fail("permission-denied");
  }
  return actor;
}

function authorizeRequestRecovery(authInput,recoveryInput){
  const command=recoveryInput?.action?recoveryInput:validateRequestRecoveryCommand(recoveryInput);
  if(command.action==="drain"||command.action==="status") return authorizeBranchStaff(authInput,command.branchId);
  return authorizeMutation(authInput,{
    branchId:command.branchId,operationType:command.operationType,keys:["swim_mark"],
  });
}

function authorizeTerminalRecovery(authInput,recoveryInput){
  const command=recoveryInput?.kind?recoveryInput:validateTerminalRecoveryCommand(recoveryInput);
  const actor=authorizeBranchStaff(authInput,command.branchId);
  if(actor.role!=="developer") fail("permission-denied");
  return actor;
}

function requestRecoveryProcessorName(actorId){
  const normalized=text(actorId).toLowerCase();
  if(!/^[0-9a-f]{24}$/.test(normalized)) fail("failed-precondition");
  const account=ACCOUNT_BY_ACTOR_ID.get(normalized);
  if(!account||account.active===false) fail("failed-precondition");
  const name=text(account.teacherName)||text(account.name);
  if(!name) fail("failed-precondition");
  return name;
}

function errorCode(error){
  const code=text(error?.code).replace(/^functions\//,"").toLowerCase();
  return SAFE_ERROR_CODES.has(code)?code:"unknown";
}

function messageClass(code){
  if(["aborted","deadline-exceeded","resource-exhausted","unavailable"].includes(code)) return "transient";
  if(["permission-denied","unauthenticated"].includes(code)) return "authorization";
  if(["invalid-argument","failed-precondition","not-found","out-of-range","already-exists"].includes(code)) return "input";
  if(["internal","data-loss"].includes(code)) return "internal";
  return "unknown";
}

function boundedCount(value){
  const number=Number(value);
  return Number.isSafeInteger(number)&&number>=0?Math.min(number,1_000_000):0;
}

function timestamp(now){
  const value=now instanceof Date?now:new Date(now);
  return Number.isNaN(value.getTime())?new Date(0).toISOString():value.toISOString();
}

function redactedDiagnostic(error,input={}){
  const code=errorCode(error);
  return {
    branchId:BRANCH_IDS.has(text(input.branchId))?text(input.branchId):"",
    operationId:/^[A-Za-z0-9_-]{1,128}$/.test(text(input.operationId))?text(input.operationId):"",
    operationType:OPERATION_RULES[text(input.operationType)]?text(input.operationType):"",
    keyCount:boundedCount(input.keyCount),
    changeCount:boundedCount(input.changeCount),
    code,
    messageClass:messageClass(code),
    detectedAt:timestamp(input.now),
  };
}

module.exports={
  OPERATION_RULES,
  validateMutationRequest,
  validateMarkMutationSemantics,
  authorizeMutation,
  validateRequestRecoveryCommand,
  authorizeRequestRecovery,
  validateTerminalRecoveryCommand,
  authorizeTerminalRecovery,
  requestRecoveryProcessorName,
  redactedDiagnostic,
  keyFamily,
};
