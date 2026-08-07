"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const ROOT=path.join(__dirname,"..");
const INDEX_PATH=path.join(ROOT,"functions","index.js");
const FUNCTIONS_DIR=path.dirname(INDEX_PATH);
const POLICY_PATH=path.join(ROOT,"js","schedule-v2-settings-policy.js");
const SETTINGS_HTML=fs.readFileSync(path.join(ROOT,"settings.html"),"utf8");
const SETTINGS_SOURCE=fs.readFileSync(path.join(ROOT,"js","settings.js"),"utf8");

function clone(value){
  return value===undefined?undefined:JSON.parse(JSON.stringify(value));
}

class FakeSnapshot{
  constructor(ref,value){
    this.ref=ref;
    this.id=ref.id;
    this.exists=value!==undefined;
    this.value=clone(value);
  }
  data(){return clone(this.value);}
  get(field){return clone(this.value?.[field]);}
}

class FakeQuerySnapshot{
  constructor(docs){this.docs=docs;this.size=docs.length;this.empty=!docs.length;}
  forEach(visitor){this.docs.forEach(visitor);}
}

class FakeDocument{
  constructor(db,documentPath){this.db=db;this.path=documentPath;this.id=documentPath.split("/").pop();}
  collection(name){return new FakeCollection(this.db,`${this.path}/${name}`);}
  async get(){return new FakeSnapshot(this,this.db.docs.get(this.path));}
}

class FakeCollection{
  constructor(db,collectionPath){this.db=db;this.path=collectionPath;}
  doc(id){return new FakeDocument(this.db,`${this.path}/${id}`);}
  async get(){
    const prefix=this.path+"/";
    const docs=[];
    for(const [documentPath,value] of this.db.docs){
      const suffix=documentPath.slice(prefix.length);
      if(documentPath.startsWith(prefix)&&suffix&&!suffix.includes("/")){
        docs.push(new FakeSnapshot(new FakeDocument(this.db,documentPath),value));
      }
    }
    return new FakeQuerySnapshot(docs);
  }
}

class FakeFirestore{
  constructor(initial={}){
    this.docs=new Map(Object.entries(initial).map(([key,value])=>[key,clone(value)]));
    this.transactions=[];
    this.transactionTail=Promise.resolve();
  }
  collection(name){return new FakeCollection(this,String(name));}
  value(documentPath){return clone(this.docs.get(documentPath));}
  async runTransaction(visitor){
    const prior=this.transactionTail;
    let release;
    this.transactionTail=new Promise(resolve=>{release=resolve;});
    await prior;
    const operations=[];
    const attempt={reads:[],operations};
    this.transactions.push(attempt);
    const transaction={
      get:async ref=>{
        attempt.reads.push(ref.path);
        return new FakeSnapshot(ref,this.docs.get(ref.path));
      },
      set:(ref,value,options)=>operations.push({type:"set",ref,value:clone(value),options}),
      delete:ref=>operations.push({type:"delete",ref}),
    };
    try{
      const result=await visitor(transaction);
      operations.forEach(operation=>{
        if(operation.type==="delete") return this.docs.delete(operation.ref.path);
        const current=this.docs.get(operation.ref.path);
        const next=operation.options?.merge&&current&&typeof current==="object"
          ?{...clone(current),...clone(operation.value)}
          :clone(operation.value);
        this.docs.set(operation.ref.path,next);
      });
      return result;
    }finally{
      release();
    }
  }
}

function functionWrapper(options,handler){
  handler.__options=options;
  return handler;
}

function loadFunctions({initial={},runShadowSync=async()=>({
  collections:[],writes:0,deletes:0,counts:{},digests:{},
})}={}){
  const db=new FakeFirestore(initial);
  const runnerCalls=[];
  const runner=async input=>{
    runnerCalls.push(input);
    return runShadowSync(input);
  };
  class HttpsError extends Error{
    constructor(code,message){super(message);this.code=code;}
  }
  const localRequire=request=>{
    if(request==="firebase-functions/v2/https") return {onCall:functionWrapper,onRequest:functionWrapper,HttpsError};
    if(request==="firebase-functions/v2/firestore") return {onDocumentWritten:functionWrapper};
    if(request==="firebase-functions/v2/scheduler") return {onSchedule:functionWrapper};
    if(request==="firebase-functions/v2") return {setGlobalOptions:()=>{}};
    if(request==="firebase-functions/logger") return {error:()=>{}};
    if(request==="firebase-admin/app") return {initializeApp:()=>{}};
    if(request==="firebase-admin/firestore") return {
      getFirestore:()=>db,
      FieldValue:{serverTimestamp:()=>"server-time",delete:()=>"delete",increment:value=>({increment:value})},
      Timestamp:{
        now:()=>({toDate:()=>new Date("2026-08-07T02:00:00.000Z")}),
        fromMillis:value=>({toDate:()=>new Date(value)}),
      },
    };
    if(request==="./regular-availability") return {buildRegularAvailability:()=>({})};
    if(request==="./schedule-v2-shadow-policy.js") return require(path.join(FUNCTIONS_DIR,"schedule-v2-shadow-policy.js"));
    if(request==="./schedule-v2-shadow-runner.js") return {runShadowSync:runner};
    if(request.startsWith("./")) return require(path.join(FUNCTIONS_DIR,request));
    return require(request);
  };
  const source=fs.readFileSync(INDEX_PATH,"utf8");
  const module={exports:{}};
  new Function("exports","require","module","__filename","__dirname",source)(
    module.exports,localRequire,module,INDEX_PATH,FUNCTIONS_DIR,
  );
  return {db,exports:module.exports,runnerCalls};
}

function request(action,branchId,email="developer@scswim.local"){
  return {data:{action,branchId},auth:{uid:`uid-${email}`,token:{email}}};
}
function schedulePath(branchId){return `scheduleV2/${branchId}/runtime/schedule`;}
function syncPath(branchId){return `scheduleV2/${branchId}/runtime/scheduleSync`;}
function generationPath(branchId,generationId){return `scheduleV2/${branchId}/generations/${generationId}`;}
function sourceEvent(branchId,docId){return {params:{branchId,docId}};}

function loadPolicy(){
  if(!fs.existsSync(POLICY_PATH)) return null;
  const context={window:{}};
  context.globalThis=context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(POLICY_PATH,"utf8"),context,{filename:POLICY_PATH});
  return context.window.SCScheduleV2SettingsPolicy;
}

test("browser policy gates controls and refuses unsafe transitions",()=>{
  const policy=loadPolicy();
  assert.ok(policy,"SCScheduleV2SettingsPolicy must be exported");
  assert.equal(policy.canView({role:"developer"}),true);
  assert.equal(policy.canView({role:"superAdmin"}),false);
  assert.equal(policy.canView({role:"desk"}),false);
  assert.equal(policy.evaluate({profile:{role:"superAdmin"},action:"status",status:{}}).allowed,true);
  assert.equal(policy.evaluate({profile:{role:"superAdmin"},action:"rollback",status:{}}).allowed,false);
  assert.equal(policy.evaluate({profile:{role:"developer"},action:"set-shadow",status:{generationStatus:"failed"}}).allowed,false);
  assert.equal(policy.evaluate({
    profile:{role:"developer"},action:"set-verify",
    status:{generationStatus:"ready",pendingCount:1,inFlightCount:0,unresolvedMismatchCount:0},
  }).allowed,false);
  assert.equal(policy.evaluate({
    profile:{role:"developer"},action:"set-verify",
    status:{generationStatus:"ready",pendingCount:0,inFlightCount:1,unresolvedMismatchCount:0},
  }).allowed,false);
  assert.equal(policy.evaluate({
    profile:{role:"developer"},action:"set-verify",
    status:{generationStatus:"ready",pendingCount:0,inFlightCount:0,unresolvedMismatchCount:1},
  }).allowed,false);
  assert.equal(policy.evaluate({profile:{role:"developer"},action:"rollback",status:{unresolvedMismatchCount:9}}).allowed,true);
});

test("settings integrates compact schedule controls into the existing V2 panel",()=>{
  assert.equal((SETTINGS_HTML.match(/id="panel-dataV2"/g)||[]).length,1);
  const panelStart=SETTINGS_HTML.indexOf('id="panel-dataV2"');
  const panelEnd=SETTINGS_HTML.indexOf('id="panel-recipients"');
  const controls=SETTINGS_HTML.indexOf('id="v2-schedule-controls"');
  assert.ok(panelStart>=0&&controls>panelStart&&controls<panelEnd,"schedule controls must stay in panel-dataV2");
  assert.match(SETTINGS_HTML,/id="v2-schedule-controls"[^>]*hidden/);
  assert.match(SETTINGS_HTML,/id="v2-schedule-prepare"[^>]*>기준점 새로 만들기</);
  assert.match(SETTINGS_HTML,/id="v2-schedule-shadow"[^>]*>그림자 복사 시작</);
  assert.match(SETTINGS_HTML,/id="v2-schedule-verify"[^>]*>검증 모드</);
  assert.match(SETTINGS_HTML,/id="v2-schedule-rollback"[^>]*>V1으로 복귀</);
  assert.match(SETTINGS_HTML,/id="v2-attendance-cutover"[^>]*hidden/);
  assert.ok(SETTINGS_HTML.indexOf("js/schedule-v2-settings-policy.js")<SETTINGS_HTML.indexOf("js/settings.js"));
  assert.doesNotMatch(SETTINGS_HTML,/시간표 상단에 즉시 표시/);
  assert.match(SETTINGS_SOURCE,/SCAuth\.profile\(\)\.role==='developer'/);
  assert.match(SETTINGS_SOURCE,/httpsCallable\('manageScheduleV2Shadow'\)/);
  assert.match(SETTINGS_SOURCE,/const branchId=activeBranch;/);
});

test("callable permits owner status but only the dedicated developer may mutate",async()=>{
  const fixture=loadFunctions();
  const callable=fixture.exports.manageScheduleV2Shadow;
  assert.equal(typeof callable,"function");
  assert.equal((await callable(request("status","gagyeong"))).branchId,"gagyeong");
  assert.equal((await callable(request("status","yongam","2025superchild@gmail.com"))).branchId,"yongam");
  await assert.rejects(()=>callable(request("rollback","gagyeong","2025superchild@gmail.com")),error=>error.code==="permission-denied");
  await assert.rejects(()=>callable(request("prepare","gagyeong","gagyeong.desk@scswim.local")),error=>error.code==="permission-denied");
  await assert.rejects(()=>callable(request("status","unknown")),error=>error.code==="invalid-argument");
  await assert.rejects(()=>callable({data:{action:"status",branchId:"gagyeong"}}),error=>error.code==="unauthenticated");
});

test("prepare owns a valid fence, catches queued changes, verifies again, and marks a fresh generation ready",async()=>{
  const tabJson='[{"id":"regular","type":"regular"}]';
  const initial={
    [schedulePath("yongam")]:{mode:"v1",generationId:"gen_old",branchId:"yongam"},
    [syncPath("yongam")]:{pendingKeys:[],requestedRevision:7,status:"idle"},
    "scheduleStores/yongam/kv/swim_tab_list":{chunked:true,chunkCount:2,valueType:"json"},
    "scheduleStores/yongam/kv/swim_tab_list/chunks/0000":{text:tabJson.slice(0,18)},
    "scheduleStores/yongam/kv/swim_tab_list/chunks/0001":{text:tabJson.slice(18)},
    "scheduleStores/yongam/kv/swim_students":{value:[]},
  };
  let fixture;
  let queuedDuringBaseline=false;
  let tabValue;
  fixture=loadFunctions({initial,runShadowSync:async input=>{
    const sync=fixture.db.value(syncPath("yongam"));
    assert.equal(input.fence.ref.path,syncPath("yongam"));
    assert.equal(input.fence.leaseId,sync.leaseId);
    if(!queuedDuringBaseline){
      queuedDuringBaseline=true;
      tabValue=await input.readLegacyKey("swim_tab_list");
      await fixture.exports.queueScheduleV2Shadow(sourceEvent("yongam","swim_mark"));
      await fixture.exports.processScheduleV2Shadow({params:{branchId:"yongam"}});
    }
    return {
      collections:["tabs","people","classMarks"],writes:1,deletes:0,
      counts:{tabs:1,people:0,classMarks:0},digests:{tabs:"tabs",people:"people",classMarks:"marks"},
    };
  }});

  const result=await fixture.exports.manageScheduleV2Shadow(request("prepare","yongam"));

  assert.deepEqual(tabValue,[{id:"regular",type:"regular"}]);
  assert.notEqual(result.generationId,"gen_old");
  assert.equal(result.mode,"ready");
  assert.ok(fixture.runnerCalls.length>=3,"baseline, catch-up, and final full parity must all run");
  assert.ok(fixture.runnerCalls[0].keys.includes("swim_tab_list"));
  assert.deepEqual(fixture.runnerCalls[1].keys,["swim_mark"]);
  const config=fixture.db.value(schedulePath("yongam"));
  const sync=fixture.db.value(syncPath("yongam"));
  const generation=fixture.db.value(generationPath("yongam",result.generationId));
  assert.equal(config.mode,"ready");
  assert.equal(config.generationId,result.generationId);
  assert.equal(generation.status,"ready");
  assert.equal(sync.startingRevision,7);
  assert.equal(sync.requestedRevision,8);
  assert.equal(sync.appliedRevision,8);
  assert.deepEqual(sync.pendingKeys,[]);
  assert.equal(sync.inFlightKeys,undefined);
  assert.equal(sync.leaseId,undefined);
});

test("mode transitions refuse unsafe state and rollback revokes work without deleting V2",async()=>{
  const noGeneration=loadFunctions({initial:{
    [schedulePath("gagyeong")]:{mode:"v1",generationId:"",branchId:"gagyeong"},
  }});
  await assert.rejects(
    ()=>noGeneration.exports.manageScheduleV2Shadow(request("set-shadow","gagyeong")),
    error=>error.code==="failed-precondition",
  );

  const blockedVerify=loadFunctions({initial:{
    [schedulePath("gagyeong")]:{mode:"ready",generationId:"gen_ready",branchId:"gagyeong"},
    [generationPath("gagyeong","gen_ready")]:{status:"ready"},
    [syncPath("gagyeong")]:{pendingKeys:["swim_inst"],inFlightKeys:[],mismatchCount:0},
  }});
  await assert.rejects(
    ()=>blockedVerify.exports.manageScheduleV2Shadow(request("set-verify","gagyeong")),
    error=>error.code==="failed-precondition",
  );

  const rollback=loadFunctions({initial:{
    [schedulePath("gagyeong")]:{mode:"shadow",generationId:"gen_keep",branchId:"gagyeong"},
    [generationPath("gagyeong","gen_keep")]:{status:"ready",sentinel:"preserve"},
    [syncPath("gagyeong")]:{
      pendingKeys:["swim_mark"],inFlightKeys:["swim_students"],requestedRevision:4,
      status:"processing",leaseId:"active",leaseUntil:"2999-01-01T00:00:00.000Z",
    },
  }});
  const status=await rollback.exports.manageScheduleV2Shadow(request("rollback","gagyeong"));
  assert.equal(status.mode,"v1");
  assert.equal(status.generationId,"gen_keep");
  assert.equal(rollback.db.value(generationPath("gagyeong","gen_keep")).sentinel,"preserve");
  assert.deepEqual(rollback.db.value(syncPath("gagyeong")).pendingKeys.sort(),["swim_mark","swim_students"]);
  assert.equal(rollback.db.value(syncPath("gagyeong")).leaseId,undefined);
  await rollback.exports.queueScheduleV2Shadow(sourceEvent("gagyeong","swim_inst"));
  await rollback.exports.processScheduleV2Shadow({params:{branchId:"gagyeong"}});
  assert.equal(rollback.runnerCalls.length,0);
});

test("shadow activation wakes preserved work and verify refuses every unsafe queue state",async()=>{
  const readyGeneration={status:"ready"};
  const shadow=loadFunctions({initial:{
    [schedulePath("yongam")]:{mode:"ready",generationId:"gen_ready",branchId:"yongam"},
    [generationPath("yongam","gen_ready")]:readyGeneration,
    [syncPath("yongam")]:{pendingKeys:["swim_mark"],requestedRevision:3,status:"pending",mismatchCount:4},
  }});
  const shadowStatus=await shadow.exports.manageScheduleV2Shadow(request("set-shadow","yongam"));
  assert.equal(shadowStatus.mode,"shadow");
  assert.equal(typeof shadow.db.value(syncPath("yongam")).activationRequestedAt,"string");

  for(const unsafe of [
    {pendingKeys:["swim_inst"],inFlightKeys:[],mismatchCount:0},
    {pendingKeys:[],inFlightKeys:["swim_students"],mismatchCount:0},
    {pendingKeys:[],inFlightKeys:[],mismatchCount:1},
  ]){
    const fixture=loadFunctions({initial:{
      [schedulePath("gagyeong")]:{mode:"ready",generationId:"gen_ready",branchId:"gagyeong"},
      [generationPath("gagyeong","gen_ready")]:readyGeneration,
      [syncPath("gagyeong")]:unsafe,
    }});
    await assert.rejects(
      ()=>fixture.exports.manageScheduleV2Shadow(request("set-verify","gagyeong")),
      error=>error.code==="failed-precondition",
    );
  }

  const verify=loadFunctions({initial:{
    [schedulePath("gagyeong")]:{mode:"ready",generationId:"gen_ready",branchId:"gagyeong"},
    [generationPath("gagyeong","gen_ready")]:readyGeneration,
    [syncPath("gagyeong")]:{pendingKeys:[],inFlightKeys:[],mismatchCount:0,status:"idle"},
  }});
  assert.equal((await verify.exports.manageScheduleV2Shadow(request("set-verify","gagyeong"))).mode,"verify");
});

test("runner failure cannot publish a prepared generation as ready",async()=>{
  const initial={
    [schedulePath("gagyeong")]:{mode:"v1",generationId:"",branchId:"gagyeong"},
    [syncPath("gagyeong")]:{pendingKeys:[],requestedRevision:0,status:"idle"},
    "scheduleStores/gagyeong/kv/swim_tab_list":{value:[{id:"regular",type:"regular"}]},
  };
  const fixture=loadFunctions({initial,runShadowSync:async()=>{
    throw Object.assign(new Error("partial-write-failure"),{code:"unavailable"});
  }});

  await assert.rejects(
    ()=>fixture.exports.manageScheduleV2Shadow(request("prepare","gagyeong")),
    error=>error.code==="failed-precondition",
  );

  const config=fixture.db.value(schedulePath("gagyeong"));
  const generation=fixture.db.value(generationPath("gagyeong",config.generationId));
  assert.equal(config.mode,"v1");
  assert.equal(generation.status,"failed");
  assert.notEqual(generation.status,"ready");
});

test("rollback while preparation is blocked revokes the fence and prevents stale readiness",async()=>{
  let started;
  const runnerStarted=new Promise(resolve=>{started=resolve;});
  let release;
  const runnerReleased=new Promise(resolve=>{release=resolve;});
  const initial={
    [schedulePath("yongam")]:{mode:"v1",generationId:"",branchId:"yongam"},
    [syncPath("yongam")]:{pendingKeys:[],requestedRevision:0,status:"idle"},
    "scheduleStores/yongam/kv/swim_tab_list":{value:[{id:"regular",type:"regular"}]},
  };
  const fixture=loadFunctions({initial,runShadowSync:async()=>{
    started();
    await runnerReleased;
    return {collections:["tabs"],writes:1,deletes:0,counts:{tabs:1},digests:{tabs:"tabs"}};
  }});

  const preparing=fixture.exports.manageScheduleV2Shadow(request("prepare","yongam"));
  await Promise.race([runnerStarted,preparing]);
  const preparingConfig=fixture.db.value(schedulePath("yongam"));
  assert.equal(preparingConfig.mode,"preparing");

  const rolledBack=await fixture.exports.manageScheduleV2Shadow(request("rollback","yongam"));
  assert.equal(rolledBack.mode,"v1");
  release();
  await assert.rejects(preparing,error=>error.code==="aborted");

  const finalConfig=fixture.db.value(schedulePath("yongam"));
  const generation=fixture.db.value(generationPath("yongam",preparingConfig.generationId));
  assert.equal(finalConfig.mode,"v1");
  assert.notEqual(generation.status,"ready");
  assert.equal(fixture.db.value(syncPath("yongam")).leaseId,undefined);
});
