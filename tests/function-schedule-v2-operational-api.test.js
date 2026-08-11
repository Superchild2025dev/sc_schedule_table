"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const INDEX_PATH=path.join(__dirname,"..","functions","index.js");
const FUNCTIONS_DIR=path.dirname(INDEX_PATH);

function triggerWrapper(options,handler){handler.__options=options;return handler;}

function loadFunctions(){
  const calls={mutate:[],recover:0,requestRecovery:[],recoverRequests:0};
  const writer={
    mutate:async request=>{calls.mutate.push(request);return {operationId:"op_api",committed:true};},
    recoverOperationalMirrors:async()=>{calls.recover+=1;return {applied:0,error:0};},
    manageRequestRecovery:async request=>{calls.requestRecovery.push(request);return {state:"staged",code:""};},
    recoverRequestPatches:async()=>{calls.recoverRequests+=1;return {completed:0,error:0};},
  };
  const db={collection(){return {doc(){return {collection(){return {doc(){return {};}};}};}};}};
  const localRequire=request=>{
    if(request==="firebase-functions/v2/https") return {
      onCall:triggerWrapper,onRequest:triggerWrapper,
      HttpsError:class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}},
    };
    if(request==="firebase-functions/v2/firestore") return {onDocumentWritten:triggerWrapper};
    if(request==="firebase-functions/v2/scheduler") return {onSchedule:triggerWrapper};
    if(request==="firebase-functions/v2") return {setGlobalOptions:()=>{}};
    if(request==="firebase-functions/logger") return {error:()=>{}};
    if(request==="firebase-admin/app") return {initializeApp:()=>{}};
    if(request==="firebase-admin/firestore") return {
      getFirestore:()=>db,
      FieldValue:{serverTimestamp:()=>"server-time",delete:()=>"delete",increment:value=>({increment:value})},
      Timestamp:{now:()=>({toDate:()=>new Date("2026-08-11T03:00:00.000Z")})},
    };
    if(request==="./schedule-v2-operational-writer.js") return {createOperationalWriter:options=>{
      calls.options=options;
      return writer;
    }};
    if(request==="./regular-availability") return {buildRegularAvailability:()=>({})};
    if(request.startsWith("./")) return require(path.join(FUNCTIONS_DIR,request));
    return require(request);
  };
  const source=fs.readFileSync(INDEX_PATH,"utf8");
  const module={exports:{}};
  new Function("exports","require","module","__filename","__dirname",source)(
    module.exports,localRequire,module,INDEX_PATH,FUNCTIONS_DIR,
  );
  return {exports:module.exports,calls};
}

test("exports the operational callable and bounded recovery schedule without changing existing paths",async()=>{
  const fixture=loadFunctions();
  const api=fixture.exports;

  assert.equal(typeof api.mutateScheduleV2Operational,"function");
  assert.equal(api.mutateScheduleV2Operational.__options.cors,true);
  assert.equal(typeof api.recoverScheduleV2OperationalMirrors,"function");
  assert.equal(typeof api.manageScheduleV2RequestRecovery,"function");
  assert.equal(api.recoverScheduleV2OperationalMirrors.__options.schedule,"every 5 minutes");
  assert.equal(api.recoverScheduleV2OperationalMirrors.__options.timeZone,"Asia/Seoul");

  for(const existing of [
    "parentPortal","customerVoice","purgeCustomerVoiceContacts","manageScheduleV2Shadow",
    "queueScheduleV2Shadow","processScheduleV2Shadow","recoverScheduleV2ShadowLeases",
    "refreshRegularAvailability","regularAvailability",
  ]) assert.equal(typeof api[existing],"function",existing);

  const request={auth:{uid:"uid"},data:{operationId:"op_api"}};
  assert.deepEqual(await api.mutateScheduleV2Operational(request),{operationId:"op_api",committed:true});
  assert.equal(fixture.calls.mutate[0],request);
  const recoveryRequest={auth:{uid:"uid"},data:{version:1,action:"drain",branchId:"yongam",operationId:""}};
  assert.deepEqual(await api.manageScheduleV2RequestRecovery(recoveryRequest),{state:"staged",code:""});
  assert.equal(fixture.calls.requestRecovery[0],recoveryRequest);
  await api.recoverScheduleV2OperationalMirrors();
  assert.equal(fixture.calls.recover,1);
  assert.equal(fixture.calls.recoverRequests,1);
});

test("loading function exports does not write or switch an operational runtime mode",()=>{
  const fixture=loadFunctions();
  assert.equal(fixture.calls.options.db!==undefined,true);
  assert.equal(fixture.calls.mutate.length,0);
  assert.equal(fixture.calls.recover,0);
  assert.equal(fixture.calls.requestRecovery.length,0);
  assert.equal(fixture.calls.recoverRequests,0);
});
