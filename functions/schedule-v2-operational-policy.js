"use strict";

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
const TEACHER_EXACT_KEYS=new Set(permissionManifest.teacherWritableExactKeys||[]);
const TEACHER_PATTERNS=(permissionManifest.teacherWritablePatterns||[]).map(pattern=>new RegExp(pattern));
const MAX_KEYS=64;
const MAX_REQUEST_BYTES=8*1024*1024;
const MAX_VALUE_BYTES=6*1024*1024;
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

function normalizeAuth(input){
  if(input?.auth) return input.auth;
  return input;
}

function authorizeMutation(authInput,mutationInput){
  const auth=normalizeAuth(authInput);
  if(!auth?.uid) fail("unauthenticated");
  const email=text(auth.token?.email).toLowerCase();
  if(!email||auth.token?.email_verified!==true) fail("permission-denied");
  const account=ACCOUNT_BY_EMAIL.get(email);
  if(!account||account.active===false) fail("permission-denied");
  const mutation=mutationInput&&mutationInput.operationType?mutationInput:validateMutationRequest(mutationInput);
  const role=text(account.role);
  const branchIds=Array.isArray(account.branchIds)?account.branchIds.map(text):[];
  const crossBranchTeacher=role==="teacher"&&permissionManifest.teacherCrossBranchAccess===true;
  if(!["developer","superAdmin"].includes(role)&&!crossBranchTeacher&&!branchIds.includes(mutation.branchId)){
    fail("permission-denied");
  }
  if(role==="teacher"){
    const operationRule=OPERATION_RULES[mutation.operationType];
    if(!operationRule?.teacher) fail("permission-denied");
    const permissions=Array.isArray(account.permissions)?account.permissions.map(text):[];
    if(MAKEUP_OPERATION_TYPES.has(mutation.operationType)&&!permissions.includes("editMakeup")){
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
  return Object.freeze({
    email,role,branchIds:Object.freeze(branchIds.slice()),
    teacherName:text(account.teacherName),permissions:Object.freeze((account.permissions||[]).slice()),
  });
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
  authorizeMutation,
  redactedDiagnostic,
  keyFamily,
};
