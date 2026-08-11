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
const PERMISSION_MANIFEST=require(path.join(ROOT,"config","schedule-permissions.json"));

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

class FakeQuery{
  constructor(db,collectionPath,filters=[]){this.db=db;this.path=collectionPath;this.filters=filters;}
  where(field,operator,value){return new FakeQuery(this.db,this.path,[...this.filters,{field,operator,value}]);}
  matches(value,filter){
    const actual=value?.[filter.field];
    if(filter.operator==="==") return actual===filter.value;
    if(filter.operator==="in") return Array.isArray(filter.value)&&filter.value.includes(actual);
    throw new Error(`unsupported fake query operator: ${filter.operator}`);
  }
  async get(){
    const prefix=this.path+"/";
    const docs=[];
    for(const [documentPath,value] of this.db.docs){
      const suffix=documentPath.slice(prefix.length);
      if(documentPath.startsWith(prefix)&&suffix&&!suffix.includes("/")&&this.filters.every(filter=>this.matches(value,filter))){
        docs.push(new FakeSnapshot(new FakeDocument(this.db,documentPath),value));
      }
    }
    return new FakeQuerySnapshot(docs);
  }
  count(){
    return {get:async()=>{
      const snapshot=await this.get();
      return {data:()=>({count:snapshot.size})};
    }};
  }
}

class FakeDocument{
  constructor(db,documentPath){this.db=db;this.path=documentPath;this.id=documentPath.split("/").pop();}
  collection(name){return new FakeCollection(this.db,`${this.path}/${name}`);}
  async get(){return new FakeSnapshot(this,this.db.docs.get(this.path));}
}

class FakeCollection extends FakeQuery{
  constructor(db,collectionPath){super(db,collectionPath);}
  doc(id){return new FakeDocument(this.db,`${this.path}/${id}`);}
}

class FakeFirestore{
  constructor(initial={},options={}){
    this.docs=new Map(Object.entries(initial).map(([key,value])=>[key,clone(value)]));
    this.transactions=[];
    this.transactionTail=Promise.resolve();
    this.failTransactionForPath=String(options.failTransactionForPath||"");
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
        if(ref instanceof FakeQuery) return ref.get();
        return new FakeSnapshot(ref,this.docs.get(ref.path));
      },
      set:(ref,value,options)=>operations.push({type:"set",ref,value:clone(value),options}),
      delete:ref=>operations.push({type:"delete",ref}),
    };
    try{
      const result=await visitor(transaction);
      if(this.failTransactionForPath&&operations.some(operation=>
        operation.ref.path.includes(this.failTransactionForPath)
      )){
        throw Object.assign(new Error("transaction-commit-failure"),{code:"unavailable"});
      }
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
}),failTransactionForPath="",permissionManifest=null}={}){
  const db=new FakeFirestore(initial,{failTransactionForPath});
  const runnerCalls=[];
  const logs=[];
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
    if(request==="firebase-functions/logger") return {error:(...args)=>logs.push(clone(args))};
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
    if(request==="../config/schedule-permissions.json"&&permissionManifest) return permissionManifest;
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
  return {db,exports:module.exports,runnerCalls,logs};
}

function request(action,branchId,email="developer@scswim.local",data={}){
  return {data:{action,branchId,...data},auth:{uid:`uid-${email}`,token:{email,email_verified:true}}};
}
function schedulePath(branchId){return `scheduleV2/${branchId}/runtime/schedule`;}
function syncPath(branchId){return `scheduleV2/${branchId}/runtime/scheduleSync`;}
function operationalPath(branchId){return `scheduleV2/${branchId}/runtime/operational`;}
function attendancePath(branchId){return `scheduleV2/${branchId}/runtime/attendance`;}
function recoveryFencePath(branchId){return `scheduleV2/${branchId}/runtime/operationalRecovery`;}
function generationPath(branchId,generationId){return `scheduleV2/${branchId}/generations/${generationId}`;}
function mutationPath(branchId,operationId){return `scheduleV2/${branchId}/operationalMutations/${operationId}`;}
function requestRecoveryPath(branchId,operationId){return `scheduleV2/${branchId}/requestRecoveries/${operationId}`;}
function sourceEvent(branchId,docId,id){return {id,params:{branchId,docId}};}
function readyGeneration(branchId,generationId,revision=0){
  return {
    branchId,generationId,status:"ready",
    capabilities:{schedule:{
      status:"ready",appliedRevision:revision,requestedRevision:revision,
      verifiedAt:"2026-08-07T02:00:00.000Z",
    },attendance:{
      status:"ready",appliedRevision:revision,
      verifiedAt:"2026-08-07T02:00:00.000Z",
    }},
  };
}
function cutoverState(branchId="gagyeong",overrides={}){
  const generationId=overrides.generationId||"gen_ready";
  const revision=overrides.scheduleRevision??4;
  return {
    [schedulePath(branchId)]:{mode:"verify",generationId,branchId,requiresPrepare:false,...overrides.schedule},
    [syncPath(branchId)]:{
      pendingKeys:[],inFlightKeys:[],requestedRevision:revision,appliedRevision:revision,
      mismatchCount:0,status:"idle",...overrides.sync,
    },
    [generationPath(branchId,generationId)]:{
      ...readyGeneration(branchId,generationId,revision),...overrides.generation,
    },
    [operationalPath(branchId)]:{
      branchId,mode:"verify",generationId,epoch:3,revision:7,...overrides.operational,
    },
    [attendancePath(branchId)]:{
      branchId,mode:"verify",generationId,epoch:3,revision:7,...overrides.attendance,
    },
    ...overrides.extra,
  };
}
function preparedCandidateState(branchId="gagyeong",overrides={}){
  const activeGenerationId=overrides.activeGenerationId??"gen_old";
  const candidateGenerationId=overrides.candidateGenerationId??"gen_ready";
  const mode=overrides.mode??"v1";
  return {
    [schedulePath(branchId)]:{
      branchId,mode,generationId:activeGenerationId,requiresPrepare:false,
      preparationStatus:"ready",preparedGenerationId:candidateGenerationId,
      ...overrides.schedule,
    },
    [syncPath(branchId)]:{
      generationId:candidateGenerationId,pendingKeys:[],inFlightKeys:[],
      requestedRevision:4,appliedRevision:4,mismatchCount:0,status:"idle",...overrides.sync,
    },
    [generationPath(branchId,candidateGenerationId)]:{
      ...readyGeneration(branchId,candidateGenerationId,4),...overrides.generation,
    },
    [operationalPath(branchId)]:{
      branchId,mode,generationId:activeGenerationId,epoch:3,revision:7,...overrides.operational,
    },
    [attendancePath(branchId)]:{
      branchId,mode,generationId:activeGenerationId,epoch:3,revision:7,...overrides.attendance,
    },
    ...overrides.extra,
  };
}
function expectedStatus(overrides={}){
  return {
    expectedMode:"verify",expectedGenerationId:"gen_ready",expectedEpoch:3,expectedRevision:7,
    ...overrides,
  };
}
function expectedRuntime(mode,generationId,epoch=0,revision=0){
  return {expectedMode:mode,expectedGenerationId:generationId,expectedEpoch:epoch,expectedRevision:revision};
}

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
  assert.equal(policy.evaluate({
    profile:{role:"developer"},action:"prepare",
    status:{mode:"v1",transitionBlockerCount:3,preparationBlockerCount:0},
  }).allowed,true);
  assert.equal(policy.evaluate({
    profile:{role:"developer"},action:"prepare",
    status:{mode:"v1",transitionBlockerCount:3,preparationBlockerCount:1},
  }).allowed,false);
  assert.equal(policy.evaluate({profile:{role:"developer"},action:"set-shadow",status:{generationStatus:"failed"}}).allowed,false);
  assert.equal(policy.evaluate({
    profile:{role:"developer"},action:"set-shadow",
    status:{mode:"v1",generationStatus:"ready",pendingCount:0,inFlightCount:0,unresolvedMismatchCount:0},
  }).allowed,false);
  assert.equal(policy.evaluate({
    profile:{role:"developer"},action:"set-shadow",
    status:{
      mode:"v1",preparationStatus:"ready",preparedScheduleReady:true,preparedAttendanceReady:true,
      pendingCount:0,inFlightCount:0,unresolvedMismatchCount:0,
    },
  }).allowed,true);
  assert.equal(policy.evaluate({
    profile:{role:"developer"},action:"set-verify",
    status:{mode:"shadow",generationStatus:"ready",pendingCount:1,inFlightCount:0,unresolvedMismatchCount:0},
  }).allowed,false);
  assert.equal(policy.evaluate({
    profile:{role:"developer"},action:"set-verify",
    status:{generationStatus:"ready",pendingCount:0,inFlightCount:1,unresolvedMismatchCount:0},
  }).allowed,false);
  assert.equal(policy.evaluate({
    profile:{role:"developer"},action:"set-verify",
    status:{generationStatus:"ready",pendingCount:0,inFlightCount:0,unresolvedMismatchCount:1},
  }).allowed,false);
  assert.equal(policy.evaluate({
    profile:{role:"developer"},action:"set-v2-read",
    status:{
      mode:"verify",generationStatus:"ready",pointerConsistent:true,scheduleReady:true,attendanceReady:true,
      pendingCount:0,inFlightCount:0,recoveryPendingCount:0,recoveryErrorCount:0,
      requestedRevision:4,appliedRevision:4,unresolvedMismatchCount:0,
    },
  }).allowed,true);
  assert.equal(policy.evaluate({
    profile:{role:"developer"},action:"set-v2-read",
    status:{
      mode:"verify",generationStatus:"ready",pointerConsistent:true,scheduleReady:true,attendanceReady:true,
      pendingCount:0,inFlightCount:0,recoveryPendingCount:0,recoveryErrorCount:0,
      requestedRevision:4,appliedRevision:4,unresolvedMismatchCount:1,
    },
  }).allowed,false);
  assert.equal(policy.evaluate({
    profile:{role:"developer"},action:"set-v2",
    status:{
      mode:"v2-read",generationStatus:"ready",pointerConsistent:true,scheduleReady:true,attendanceReady:true,
      pendingCount:0,inFlightCount:0,recoveryPendingCount:1,recoveryErrorCount:0,
      requestedRevision:4,appliedRevision:4,unresolvedMismatchCount:0,
    },
  }).allowed,false);
  assert.equal(policy.evaluate({
    profile:{role:"developer"},action:"rollback",
    status:{
      mode:"v2-read",generationStatus:"ready",pointerConsistent:true,recoverySafe:true,
      pendingCount:0,inFlightCount:0,recoveryPendingCount:0,recoveryErrorCount:0,
      requestedRevision:4,appliedRevision:4,unresolvedMismatchCount:9,
    },
  }).allowed,false);
});

test("settings response gate rejects stale status and actions confirm only fresh state",()=>{
  const policy=loadPolicy();
  assert.equal(typeof policy.createResponseGate,"function");
  const gate=policy.createResponseGate();
  const staleStatus=gate.begin("gagyeong");
  const newerAction=gate.begin("gagyeong");
  assert.equal(gate.accept("gagyeong",newerAction,{mode:"v2-read",epoch:4}),true);
  assert.equal(gate.accept("gagyeong",staleStatus,{mode:"verify",epoch:3}),false);
  assert.deepEqual(gate.status("gagyeong"),{mode:"v2-read",epoch:4});

  const action=gate.begin("yongam","action");
  const racingStatus=gate.begin("yongam","status");
  assert.equal(gate.accept("yongam",racingStatus,{mode:"shadow",epoch:2}),false);
  assert.equal(gate.accept("yongam",action,{mode:"verify",epoch:3}),true);
  assert.deepEqual(gate.status("yongam"),{mode:"verify",epoch:3});

  const block=SETTINGS_SOURCE.match(
    /async function runScheduleV2Action\(action\)\{([\s\S]*?)\n  function attendanceParityMeta/,
  );
  assert.ok(block,"runScheduleV2Action must remain independently testable");
  const freshRead=block[1].indexOf("await loadScheduleV2Status(branchId,true)");
  const evaluate=block[1].indexOf("policy.evaluate({profile,action,status:current})");
  const confirmation=block[1].indexOf("window.confirm(confirmation)");
  assert.ok(freshRead>=0&&freshRead<evaluate&&evaluate<confirmation);
  assert.match(SETTINGS_SOURCE,/scheduleV2ResponseGate\.accept\(/);
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
  assert.match(SETTINGS_HTML,/id="v2-schedule-v2-read"[^>]*>V2 읽기 전환</);
  assert.match(SETTINGS_HTML,/id="v2-schedule-v2"[^>]*>V2 단독 전환</);
  assert.match(SETTINGS_HTML,/id="v2-schedule-rollback"[^>]*>V1으로 복귀</);
  assert.match(SETTINGS_HTML,/id="v2-schedule-epoch"/);
  assert.match(SETTINGS_HTML,/id="v2-schedule-revision"/);
  assert.match(SETTINGS_HTML,/id="v2-schedule-recovery-pending"/);
  assert.match(SETTINGS_HTML,/id="v2-schedule-recovery-error"/);
  assert.match(SETTINGS_HTML,/id="v2-attendance-cutover"[^>]*hidden/);
  assert.ok(SETTINGS_HTML.indexOf("js/schedule-v2-settings-policy.js")<SETTINGS_HTML.indexOf("js/settings.js"));
  assert.doesNotMatch(SETTINGS_HTML,/시간표 상단에 즉시 표시/);
  assert.match(SETTINGS_SOURCE,/SCAuth\.profile\(\)\.role==='developer'/);
  assert.match(SETTINGS_SOURCE,/httpsCallable\('manageScheduleV2Shadow'\)/);
  assert.match(SETTINGS_SOURCE,/const branchId=activeBranch;/);
  assert.match(SETTINGS_SOURCE,/코드 배포만으로 운영 모드는 전환되지 않습니다/);
  assert.match(SETTINGS_SOURCE,/대상 지점:/);
  assert.match(SETTINGS_SOURCE,/대상 모드:/);
  assert.match(SETTINGS_SOURCE,/대상 epoch:/);
  assert.match(SETTINGS_SOURCE,/expectedGenerationId/);
  assert.match(SETTINGS_SOURCE,/expectedEpoch/);
  assert.match(SETTINGS_SOURCE,/expectedRevision/);
  assert.doesNotMatch(SETTINGS_SOURCE,/attendanceControlStore\.setConfig\(/);
});

test("callable permits owner status but only the dedicated developer may mutate",async()=>{
  const fixture=loadFunctions();
  const callable=fixture.exports.manageScheduleV2Shadow;
  assert.equal(typeof callable,"function");
  assert.equal((await callable(request("status","gagyeong"))).branchId,"gagyeong");
  assert.equal((await callable(request("status","yongam","2025superchild@gmail.com"))).branchId,"yongam");
  await assert.rejects(()=>callable(request("rollback","gagyeong","2025superchild@gmail.com",expectedStatus())),error=>error.code==="permission-denied");
  await assert.rejects(()=>callable(request("set-v2-read","gagyeong","gagyeong.desk@scswim.local",expectedStatus())),error=>error.code==="permission-denied");
  await assert.rejects(()=>callable(request("set-v2","gagyeong","gagyeong.son@scswim.local",expectedStatus())),error=>error.code==="permission-denied");
  await assert.rejects(()=>callable(request("prepare","gagyeong","gagyeong.desk@scswim.local",expectedStatus())),error=>error.code==="permission-denied");
  await assert.rejects(()=>callable(request("status","unknown")),error=>error.code==="invalid-argument");
  await assert.rejects(()=>callable({data:{action:"status",branchId:"gagyeong"}}),error=>error.code==="unauthenticated");
});

test("callable rejects crafted schemas branches and non-manifest authorization",async()=>{
  const inactiveEmail="inactive.developer@scswim.local";
  const permissionManifest=clone(PERMISSION_MANIFEST);
  permissionManifest.accounts.push({
    email:inactiveEmail,name:"Inactive Developer",role:"developer",
    branchIds:["gagyeong","yongam"],teacherName:"",active:false,
  });
  const fixture=loadFunctions({permissionManifest});
  const callable=fixture.exports.manageScheduleV2Shadow;
  const verified=request("status","gagyeong");
  const unverified=request("status","gagyeong");
  unverified.auth.token.email_verified=false;
  const inherited=Object.create({action:"status",branchId:"gagyeong"});

  for(const crafted of [
    {...verified,data:{action:"status",branchId:"constructor"}},
    {...verified,data:{action:"status",branchId:"gagyeong",extra:true}},
    {...verified,data:{action:7,branchId:"gagyeong"}},
    {...verified,data:{action:"status",branchId:7}},
    {...verified,data:inherited},
  ]){
    await assert.rejects(()=>callable(crafted),error=>error.code==="invalid-argument");
  }
  await assert.rejects(()=>callable(unverified),error=>error.code==="permission-denied");
  await assert.rejects(
    ()=>callable(request("status","gagyeong","not-in-manifest@scswim.local")),
    error=>error.code==="permission-denied",
  );
  await assert.rejects(
    ()=>callable(request("status","gagyeong",inactiveEmail)),
    error=>error.code==="permission-denied",
  );
  await assert.rejects(
    ()=>callable(request("set-v2-read","gagyeong","developer@scswim.local",{
      ...expectedStatus(),extra:true,
    })),
    error=>error.code==="invalid-argument",
  );
});

test("prepare owns a valid fence, catches queued changes, verifies again, and marks a fresh generation ready",async()=>{
  const tabJson='[{"id":"regular","type":"regular"}]';
  const initial={
    [schedulePath("yongam")]:{mode:"v1",generationId:"gen_old",branchId:"yongam"},
    [operationalPath("yongam")]:{branchId:"yongam",mode:"v1",generationId:"gen_old",epoch:0,revision:0},
    [attendancePath("yongam")]:{branchId:"yongam",mode:"v1",generationId:"gen_old",epoch:0,revision:0},
    [syncPath("yongam")]:{pendingKeys:[],requestedRevision:7,appliedRevision:7,status:"idle"},
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
      collections:[
        "tabs","people","classMarks","attendanceRecords","attendanceGuests",
        "attendanceSnapshots","attendanceSnapshotStudents","attendanceSnapshotTeachers",
      ],writes:1,deletes:0,
      counts:{
        tabs:1,people:0,classMarks:0,attendanceRecords:0,attendanceGuests:0,
        attendanceSnapshots:0,attendanceSnapshotStudents:0,attendanceSnapshotTeachers:0,
      },
      digests:{
        tabs:"tabs",people:"people",classMarks:"marks",attendanceRecords:"records",
        attendanceGuests:"guests",attendanceSnapshots:"snapshots",
        attendanceSnapshotStudents:"students",attendanceSnapshotTeachers:"teachers",
      },
    };
  }});

  const result=await fixture.exports.manageScheduleV2Shadow(request(
    "prepare","yongam","developer@scswim.local",expectedRuntime("v1","gen_old",0,0),
  ));

  assert.deepEqual(tabValue,[{id:"regular",type:"regular"}]);
  assert.equal(result.generationId,"gen_old");
  assert.equal(result.mode,"v1");
  assert.notEqual(result.preparedGenerationId,"gen_old");
  assert.ok(fixture.runnerCalls.length>=3,"baseline, catch-up, and final full parity must all run");
  assert.ok(fixture.runnerCalls[0].keys.includes("swim_tab_list"));
  assert.deepEqual(fixture.runnerCalls[1].keys,["swim_mark"]);
  const config=fixture.db.value(schedulePath("yongam"));
  const sync=fixture.db.value(syncPath("yongam"));
  const generation=fixture.db.value(generationPath("yongam",result.preparedGenerationId));
  assert.equal(config.mode,"v1");
  assert.equal(config.generationId,"gen_old");
  assert.equal(config.preparationStatus,"ready");
  assert.equal(generation.status,"ready");
  assert.equal(generation.capabilities.schedule.status,"ready");
  assert.equal(generation.capabilities.schedule.appliedRevision,8);
  assert.equal(generation.capabilities.schedule.requestedRevision,8);
  assert.equal(generation.capabilities.attendance.status,"ready");
  assert.equal(sync.startingRevision,7);
  assert.equal(sync.requestedRevision,8);
  assert.equal(sync.appliedRevision,8);
  assert.deepEqual(sync.pendingKeys,[]);
  assert.equal(sync.inFlightKeys,undefined);
  assert.equal(sync.leaseId,undefined);
});

test("prepare preserves active v2 pointers and publishes a separate dual-ready candidate",async()=>{
  let started;
  const runnerStarted=new Promise(resolve=>{started=resolve;});
  let release;
  const runnerReleased=new Promise(resolve=>{release=resolve;});
  const initial=cutoverState("gagyeong",{
    schedule:{mode:"v2"},
    operational:{mode:"v2",recoverySafeRevision:7},
    attendance:{mode:"v2"},
    extra:{"scheduleStores/gagyeong/kv/swim_tab_list":{value:[{id:"regular",type:"regular"}]}},
  });
  const activeBefore={
    schedule:clone(initial[schedulePath("gagyeong")]),
    operational:clone(initial[operationalPath("gagyeong")]),
    attendance:clone(initial[attendancePath("gagyeong")]),
  };
  const fixture=loadFunctions({initial,runShadowSync:async()=>{
    started();
    await runnerReleased;
    return {
      collections:[
        "tabs","attendanceRecords","attendanceGuests","attendanceSnapshots",
        "attendanceSnapshotStudents","attendanceSnapshotTeachers",
      ],
      writes:1,deletes:0,
      counts:{tabs:1,attendanceRecords:0,attendanceGuests:0,attendanceSnapshots:0,
        attendanceSnapshotStudents:0,attendanceSnapshotTeachers:0},
      digests:{tabs:"tabs",attendanceRecords:"records",attendanceGuests:"guests",
        attendanceSnapshots:"snapshots",attendanceSnapshotStudents:"students",
        attendanceSnapshotTeachers:"teachers"},
    };
  }});

  const preparing=fixture.exports.manageScheduleV2Shadow(request(
    "prepare","gagyeong","developer@scswim.local",expectedStatus({expectedMode:"v2"}),
  ));
  await Promise.race([runnerStarted,preparing]);
  const during=fixture.db.value(schedulePath("gagyeong"));
  assert.equal(during.mode,"v2");
  assert.equal(during.generationId,"gen_ready");
  assert.equal(during.preparationStatus,"preparing");
  assert.notEqual(during.preparationGenerationId,"gen_ready");
  for(const [name,documentPath] of [
    ["operational",operationalPath("gagyeong")],
    ["attendance",attendancePath("gagyeong")],
  ]){
    const current=fixture.db.value(documentPath);
    assert.deepEqual(
      {mode:current.mode,generationId:current.generationId,epoch:current.epoch,revision:current.revision},
      {mode:activeBefore[name].mode,generationId:activeBefore[name].generationId,
        epoch:activeBefore[name].epoch,revision:activeBefore[name].revision},
    );
  }

  release();
  const status=await preparing;
  assert.equal(status.mode,"v2");
  assert.equal(status.generationId,"gen_ready");
  assert.equal(status.preparationStatus,"ready");
  assert.ok(status.preparedGenerationId);
  assert.notEqual(status.preparedGenerationId,status.generationId);
  assert.equal(status.preparedScheduleReady,true);
  assert.equal(status.preparedAttendanceReady,true);
  const candidate=fixture.db.value(generationPath("gagyeong",status.preparedGenerationId));
  assert.equal(candidate.capabilities.schedule.status,"ready");
  assert.equal(candidate.capabilities.attendance.status,"ready");
  assert.equal(fixture.db.value(operationalPath("gagyeong")).preparationLeaseId,undefined);
});

test("prepare through shadow verify and v2-read is fenced atomic and dual-ready",async()=>{
  const branchId="gagyeong";
  const oldGeneration="gen_old";
  const initial={
    [schedulePath(branchId)]:{mode:"v1",generationId:oldGeneration,branchId,requiresPrepare:true},
    [operationalPath(branchId)]:{branchId,mode:"v1",generationId:oldGeneration,epoch:1,revision:2},
    [attendancePath(branchId)]:{branchId,mode:"v1",generationId:oldGeneration,epoch:1,revision:2},
    [syncPath(branchId)]:{pendingKeys:[],requestedRevision:5,appliedRevision:5,status:"idle"},
    "scheduleStores/gagyeong/kv/swim_tab_list":{value:[{id:"regular",type:"regular"}]},
  };
  const fixture=loadFunctions({initial,runShadowSync:async()=>({
    collections:[
      "tabs","attendanceRecords","attendanceGuests","attendanceSnapshots",
      "attendanceSnapshotStudents","attendanceSnapshotTeachers",
    ],
    writes:1,deletes:0,
    counts:{tabs:1,attendanceRecords:0,attendanceGuests:0,attendanceSnapshots:0,
      attendanceSnapshotStudents:0,attendanceSnapshotTeachers:0},
    digests:{tabs:"tabs",attendanceRecords:"records",attendanceGuests:"guests",
      attendanceSnapshots:"snapshots",attendanceSnapshotStudents:"students",
      attendanceSnapshotTeachers:"teachers"},
  })});

  const prepared=await fixture.exports.manageScheduleV2Shadow(request(
    "prepare",branchId,"developer@scswim.local",expectedRuntime("v1",oldGeneration,1,2),
  ));
  assert.equal(prepared.mode,"v1");
  const candidate=prepared.preparedGenerationId;
  assert.ok(candidate&&candidate!==oldGeneration);

  const shadow=await fixture.exports.manageScheduleV2Shadow(request(
    "set-shadow",branchId,"developer@scswim.local",expectedRuntime("v1",oldGeneration,1,2),
  ));
  assert.equal(shadow.mode,"shadow");
  assert.equal(shadow.generationId,candidate);
  const verify=await fixture.exports.manageScheduleV2Shadow(request(
    "set-verify",branchId,"developer@scswim.local",expectedRuntime("shadow",candidate,2,2),
  ));
  assert.equal(verify.mode,"verify");
  const v2Read=await fixture.exports.manageScheduleV2Shadow(request(
    "set-v2-read",branchId,"developer@scswim.local",expectedRuntime("verify",candidate,3,2),
  ));
  assert.equal(v2Read.mode,"v2-read");
  assert.equal(v2Read.epoch,4);
  assert.equal(v2Read.scheduleReady,true);
  assert.equal(v2Read.attendanceReady,true);

  const pointerTransactions=fixture.db.transactions.filter(attempt=>
    attempt.operations.some(operation=>operation.ref.path===operationalPath(branchId)),
  ).filter(attempt=>attempt.operations.some(operation=>operation.value?.mode!=="v1"));
  assert.equal(pointerTransactions.length,3);
  pointerTransactions.forEach(attempt=>assert.deepEqual(
    new Set(attempt.operations.map(operation=>operation.ref.path)),
    new Set([schedulePath(branchId),operationalPath(branchId),attendancePath(branchId)]),
  ));
});

test("preparation refuses to publish attendance readiness without verified attendance collections",async()=>{
  const branchId="gagyeong";
  const initial={
    [schedulePath(branchId)]:{mode:"v1",generationId:"",branchId},
    [syncPath(branchId)]:{pendingKeys:[],requestedRevision:0,appliedRevision:0,status:"idle"},
    "scheduleStores/gagyeong/kv/swim_tab_list":{value:[{id:"regular",type:"regular"}]},
  };
  const fixture=loadFunctions({initial,runShadowSync:async()=>({
    collections:["tabs"],writes:1,deletes:0,counts:{tabs:1},digests:{tabs:"tabs"},
  })});
  await assert.rejects(
    ()=>fixture.exports.manageScheduleV2Shadow(request(
      "prepare",branchId,"developer@scswim.local",expectedRuntime("v1","",0,0),
    )),
    error=>error.code==="failed-precondition",
  );
  const config=fixture.db.value(schedulePath(branchId));
  const candidate=fixture.db.value(generationPath(branchId,config.preparationGenerationId));
  assert.equal(candidate.capabilities.attendance,undefined);
  assert.notEqual(config.preparationStatus,"ready");
});

test("prepare checks active pointers recovery queues and v2 recovery-safe revision",async()=>{
  const cases=[
    {name:"attendance pointer",attendance:{generationId:"gen_stale"}},
    {name:"recovery-safe revision",operational:{recoverySafeRevision:6}},
    {name:"request recovery",extra:{
      [requestRecoveryPath("gagyeong","prepare-blocker")]:{state:"error"},
    }},
  ];
  for(const row of cases){
    let runnerCalls=0;
    const initial=cutoverState("gagyeong",{
      schedule:{mode:"v2"},
      operational:{mode:"v2",recoverySafeRevision:7,...row.operational},
      attendance:{mode:"v2",...row.attendance},
      extra:{
        "scheduleStores/gagyeong/kv/swim_tab_list":{value:[{id:"regular",type:"regular"}]},
        ...(row.extra||{}),
      },
    });
    const fixture=loadFunctions({initial,runShadowSync:async()=>{
      runnerCalls+=1;
      return {collections:[],writes:0,deletes:0,counts:{},digests:{}};
    }});
    await assert.rejects(
      ()=>fixture.exports.manageScheduleV2Shadow(request(
        "prepare","gagyeong","developer@scswim.local",expectedStatus({expectedMode:"v2"}),
      )),
      error=>error.code==="failed-precondition",
      row.name,
    );
    assert.equal(runnerCalls,0,row.name);
    assert.equal(fixture.db.value(operationalPath("gagyeong")).mode,"v2",row.name);
    assert.equal(fixture.db.value(schedulePath("gagyeong")).generationId,"gen_ready",row.name);
  }
});

test("mode transitions refuse unsafe state and rollback revokes work without deleting V2",async()=>{
  const noGeneration=loadFunctions({initial:{
    [schedulePath("gagyeong")]:{mode:"v1",generationId:"",branchId:"gagyeong"},
  }});
  await assert.rejects(
    ()=>noGeneration.exports.manageScheduleV2Shadow(request(
      "set-shadow","gagyeong","developer@scswim.local",expectedRuntime("v1","",0,0),
    )),
    error=>error.code==="failed-precondition",
  );

  const blockedVerify=loadFunctions({initial:cutoverState("gagyeong",{
    scheduleRevision:2,
    schedule:{mode:"shadow"},operational:{mode:"shadow"},attendance:{mode:"shadow"},
    sync:{pendingKeys:["swim_inst"],requestedRevision:2,appliedRevision:1},
  })});
  await assert.rejects(
    ()=>blockedVerify.exports.manageScheduleV2Shadow(request(
      "set-verify","gagyeong","developer@scswim.local",expectedStatus({expectedMode:"shadow"}),
    )),
    error=>error.code==="failed-precondition",
  );

  const blockedRollback=loadFunctions({initial:{
    [schedulePath("gagyeong")]:{mode:"shadow",generationId:"gen_keep",branchId:"gagyeong"},
    [generationPath("gagyeong","gen_keep")]:{
      ...readyGeneration("gagyeong","gen_keep",3),sentinel:"preserve",
    },
    [operationalPath("gagyeong")]:{
      branchId:"gagyeong",mode:"shadow",generationId:"gen_keep",epoch:2,revision:0,
    },
    [attendancePath("gagyeong")]:{
      branchId:"gagyeong",mode:"shadow",generationId:"gen_keep",epoch:2,revision:0,
    },
    [syncPath("gagyeong")]:{
      pendingKeys:["swim_mark"],inFlightKeys:["swim_students"],requestedRevision:4,
      status:"processing",leaseId:"active",leaseUntil:"2999-01-01T00:00:00.000Z",
    },
  }});
  await assert.rejects(
    ()=>blockedRollback.exports.manageScheduleV2Shadow(request("rollback","gagyeong","developer@scswim.local",{
      expectedMode:"shadow",expectedGenerationId:"gen_keep",expectedEpoch:2,expectedRevision:0,
    })),
    error=>error.code==="failed-precondition",
  );

  const rollback=loadFunctions({initial:cutoverState("gagyeong",{
    schedule:{mode:"v2-read"},operational:{mode:"v2-read"},attendance:{mode:"v2-read"},
  })});
  const status=await rollback.exports.manageScheduleV2Shadow(request(
    "rollback","gagyeong","developer@scswim.local",
    expectedStatus({expectedMode:"v2-read"}),
  ));
  assert.equal(status.mode,"v1");
  assert.equal(status.generationId,"gen_ready");
  assert.equal(status.epoch,4);
  assert.equal(rollback.db.value(operationalPath("gagyeong")).mode,"v1");
  assert.equal(rollback.db.value(attendancePath("gagyeong")).mode,"v1");
  assert.equal(rollback.db.value(schedulePath("gagyeong")).mode,"v1");
  await rollback.exports.queueScheduleV2Shadow(sourceEvent("gagyeong","swim_inst","after-rollback-1"));
  await rollback.exports.processScheduleV2Shadow({params:{branchId:"gagyeong"}});
  assert.equal(rollback.runnerCalls.length,0);
  await assert.rejects(
    ()=>rollback.exports.manageScheduleV2Shadow(request(
      "set-shadow","gagyeong","developer@scswim.local",expectedRuntime("v1","gen_ready",4,7),
    )),
    error=>error.code==="failed-precondition",
  );
});

test("a source write invalidates a prepared candidate and blocks shadow activation",async()=>{
  const branchId="yongam";
  const fixture=loadFunctions({initial:preparedCandidateState(branchId)});

  await fixture.exports.queueScheduleV2Shadow(
    sourceEvent(branchId,"swim_students","ready-change-1"),
  );
  const status=await fixture.exports.manageScheduleV2Shadow(request("status",branchId));

  assert.equal(status.generationStatus,"syncing");
  assert.equal(status.preparationStatus,"syncing");
  assert.equal(status.requestedRevision,5);
  assert.equal(status.appliedRevision,4);
  assert.equal(status.pendingCount,1);
  await assert.rejects(
    ()=>fixture.exports.manageScheduleV2Shadow(request(
      "set-shadow",branchId,"developer@scswim.local",expectedRuntime("v1","gen_old",3,7),
    )),
    error=>error.code==="failed-precondition",
  );
});

test("shadow activation requires a fresh ready revision and verify refuses every unsafe queue state",async()=>{
  const stale=loadFunctions({initial:preparedCandidateState("yongam",{
    sync:{pendingKeys:["swim_mark"],requestedRevision:5,appliedRevision:4,status:"pending"},
  })});
  await assert.rejects(
    ()=>stale.exports.manageScheduleV2Shadow(request(
      "set-shadow","yongam","developer@scswim.local",expectedRuntime("v1","gen_old",3,7),
    )),
    error=>error.code==="failed-precondition",
  );

  const shadow=loadFunctions({initial:preparedCandidateState("yongam")});
  const shadowStatus=await shadow.exports.manageScheduleV2Shadow(request(
    "set-shadow","yongam","developer@scswim.local",expectedRuntime("v1","gen_old",3,7),
  ));
  assert.equal(shadowStatus.mode,"shadow");

  for(const unsafe of [
    {pendingKeys:["swim_inst"],inFlightKeys:[],mismatchCount:0},
    {pendingKeys:[],inFlightKeys:["swim_students"],mismatchCount:0},
    {pendingKeys:[],inFlightKeys:[],mismatchCount:1},
  ]){
    const fixture=loadFunctions({initial:cutoverState("gagyeong",{
      scheduleRevision:1,
      schedule:{mode:"shadow"},operational:{mode:"shadow"},attendance:{mode:"shadow"},
      sync:unsafe,
    })});
    await assert.rejects(
      ()=>fixture.exports.manageScheduleV2Shadow(request(
        "set-verify","gagyeong","developer@scswim.local",expectedStatus({expectedMode:"shadow"}),
      )),
      error=>error.code==="failed-precondition",
    );
  }

  const verify=loadFunctions({initial:cutoverState("gagyeong",{
    scheduleRevision:1,
    schedule:{mode:"shadow"},operational:{mode:"shadow"},attendance:{mode:"shadow"},
  })});
  assert.equal((await verify.exports.manageScheduleV2Shadow(request(
    "set-verify","gagyeong","developer@scswim.local",expectedStatus({expectedMode:"shadow"}),
  ))).mode,"verify");
});

test("set-v2-read atomically advances epoch and updates schedule operational and attendance pointers",async()=>{
  const fixture=loadFunctions({initial:cutoverState("gagyeong")});

  const status=await fixture.exports.manageScheduleV2Shadow(request(
    "set-v2-read","gagyeong","developer@scswim.local",expectedStatus(),
  ));

  assert.equal(status.mode,"v2-read");
  assert.equal(status.generationId,"gen_ready");
  assert.equal(status.epoch,4);
  assert.equal(status.revision,7);
  assert.equal(status.recoveryPendingCount,0);
  assert.equal(status.recoveryErrorCount,0);
  assert.equal(fixture.db.value(schedulePath("gagyeong")).mode,"v2-read");
  assert.deepEqual(
    {
      mode:fixture.db.value(operationalPath("gagyeong")).mode,
      generationId:fixture.db.value(operationalPath("gagyeong")).generationId,
      epoch:fixture.db.value(operationalPath("gagyeong")).epoch,
    },
    {mode:"v2-read",generationId:"gen_ready",epoch:4},
  );
  assert.deepEqual(
    {
      mode:fixture.db.value(attendancePath("gagyeong")).mode,
      generationId:fixture.db.value(attendancePath("gagyeong")).generationId,
      epoch:fixture.db.value(attendancePath("gagyeong")).epoch,
    },
    {mode:"v2-read",generationId:"gen_ready",epoch:4},
  );
  const transition=fixture.db.transactions.find(attempt=>
    attempt.operations.some(operation=>operation.ref.path===operationalPath("gagyeong")),
  );
  assert.ok(transition);
  assert.deepEqual(new Set(transition.operations.map(operation=>operation.ref.path)),new Set([
    schedulePath("gagyeong"),operationalPath("gagyeong"),attendancePath("gagyeong"),
  ]));
});

test("set-v2 and rollback each atomically advance epoch and update both runtime pointers",async()=>{
  const setV2=loadFunctions({initial:cutoverState("gagyeong",{
    schedule:{mode:"v2-read"},operational:{mode:"v2-read"},attendance:{mode:"v2-read"},
  })});
  const v2Status=await setV2.exports.manageScheduleV2Shadow(request(
    "set-v2","gagyeong","developer@scswim.local",expectedStatus({expectedMode:"v2-read"}),
  ));
  assert.equal(v2Status.mode,"v2");
  assert.equal(v2Status.epoch,4);
  assert.equal(setV2.db.value(operationalPath("gagyeong")).recoverySafeRevision,7);
  for(const path of [schedulePath("gagyeong"),operationalPath("gagyeong"),attendancePath("gagyeong")]){
    assert.equal(setV2.db.value(path).mode,"v2",path);
  }
  const setV2Transaction=setV2.db.transactions.find(attempt=>
    attempt.operations.some(operation=>operation.ref.path===operationalPath("gagyeong")),
  );
  assert.deepEqual(new Set(setV2Transaction.operations.map(operation=>operation.ref.path)),new Set([
    schedulePath("gagyeong"),operationalPath("gagyeong"),attendancePath("gagyeong"),
  ]));

  const rollback=loadFunctions({initial:cutoverState("gagyeong",{
    schedule:{mode:"v2"},operational:{mode:"v2",recoverySafeRevision:7},attendance:{mode:"v2"},
  })});
  const v1Status=await rollback.exports.manageScheduleV2Shadow(request(
    "rollback","gagyeong","developer@scswim.local",expectedStatus({expectedMode:"v2"}),
  ));
  assert.equal(v1Status.mode,"v1");
  assert.equal(v1Status.epoch,4);
  for(const path of [schedulePath("gagyeong"),operationalPath("gagyeong"),attendancePath("gagyeong")]){
    assert.equal(rollback.db.value(path).mode,"v1",path);
  }
  const rollbackTransaction=rollback.db.transactions.find(attempt=>
    attempt.operations.some(operation=>operation.ref.path===operationalPath("gagyeong")),
  );
  assert.deepEqual(new Set(rollbackTransaction.operations.map(operation=>operation.ref.path)),new Set([
    schedulePath("gagyeong"),operationalPath("gagyeong"),attendancePath("gagyeong"),
  ]));
});

test("every pointer-changing action requires a complete expected runtime fence",async()=>{
  const cases=[
    {action:"set-shadow",mode:"v1",generationId:"gen_old",candidate:true},
    {action:"set-verify",mode:"shadow"},
    {action:"set-v2-read",mode:"verify"},
    {action:"set-v2",mode:"v2-read"},
    {action:"rollback",mode:"v2-read"},
  ];
  for(const row of cases){
    const initial=row.candidate?{
      [schedulePath("gagyeong")]:{
        mode:"v1",generationId:"gen_old",branchId:"gagyeong",requiresPrepare:false,
        preparationStatus:"ready",preparedGenerationId:"gen_ready",
      },
      [syncPath("gagyeong")]:{
        pendingKeys:[],inFlightKeys:[],requestedRevision:4,appliedRevision:4,
        mismatchCount:0,status:"idle",generationId:"gen_ready",
      },
      [generationPath("gagyeong","gen_ready")]:readyGeneration("gagyeong","gen_ready",4),
      [operationalPath("gagyeong")]:{
        branchId:"gagyeong",mode:"v1",generationId:"gen_old",epoch:3,revision:7,
      },
      [attendancePath("gagyeong")]:{
        branchId:"gagyeong",mode:"v1",generationId:"gen_old",epoch:3,revision:7,
      },
    }:cutoverState("gagyeong",{
      schedule:{mode:row.mode},operational:{mode:row.mode},attendance:{mode:row.mode},
    });
    const fixture=loadFunctions({initial});
    await assert.rejects(
      ()=>fixture.exports.manageScheduleV2Shadow(request(row.action,"gagyeong")),
      error=>error.code==="invalid-argument",
      row.action,
    );
    assert.equal(fixture.db.value(operationalPath("gagyeong")).mode,row.mode,row.action);
  }
});

test("cutover rejects stale generations revisions mismatches and missing attendance readiness",async()=>{
  const cases=[
    {name:"pointer generation",state:{attendance:{generationId:"gen_stale"}}},
    {name:"generation branch",state:{generation:{branchId:"yongam"}}},
    {name:"pending schedule work",state:{sync:{pendingKeys:["swim_students"]}}},
    {name:"in-flight schedule work",state:{sync:{inFlightKeys:["swim_inst"]}}},
    {name:"schedule revision",state:{sync:{requestedRevision:5,appliedRevision:4}}},
    {name:"mismatch",state:{sync:{mismatchCount:1}}},
    {name:"attendance readiness",state:{generation:{capabilities:{
      schedule:{status:"ready",appliedRevision:4,requestedRevision:4,verifiedAt:"2026-08-07T02:00:00.000Z"},
    }}}},
  ];
  for(const row of cases){
    const fixture=loadFunctions({initial:cutoverState("gagyeong",row.state)});
    await assert.rejects(
      ()=>fixture.exports.manageScheduleV2Shadow(request(
        "set-v2-read","gagyeong","developer@scswim.local",expectedStatus(),
      )),
      error=>error.code==="failed-precondition",
      row.name,
    );
    assert.equal(fixture.db.value(operationalPath("gagyeong")).mode,"verify",row.name);
  }
});

test("cutover fails closed when both runtime pointers contain malformed epoch or revision values",async()=>{
  for(const malformed of [
    {operational:{epoch:"invalid"},attendance:{epoch:"invalid"}},
    {operational:{revision:"invalid"},attendance:{revision:"invalid"}},
  ]){
    const fixture=loadFunctions({initial:cutoverState("gagyeong",malformed)});
    await assert.rejects(
      ()=>fixture.exports.manageScheduleV2Shadow(request(
        "set-v2-read","gagyeong","developer@scswim.local",expectedStatus(),
      )),
      error=>error.code==="failed-precondition",
    );
    assert.equal(fixture.db.value(operationalPath("gagyeong")).mode,"verify");
  }
});

test("pending processing or error recovery work blocks set-v2 and rollback",async()=>{
  const blockers=[
    {path:mutationPath("gagyeong","mirror_pending"),value:{status:"committed",recoveryState:"pending"}},
    {path:mutationPath("gagyeong","mirror_processing"),value:{status:"committed",recoveryState:"processing"}},
    {path:mutationPath("gagyeong","mirror_error"),value:{status:"committed",recoveryState:"error"}},
    {path:requestRecoveryPath("gagyeong","request_pending"),value:{state:"waiting-primary"}},
    {path:requestRecoveryPath("gagyeong","request_processing"),value:{state:"processing"}},
    {path:requestRecoveryPath("gagyeong","request_error"),value:{state:"error"}},
  ];
  for(const blocker of blockers){
    for(const action of ["set-v2","rollback"]){
      const initial=cutoverState("gagyeong",{
        schedule:{mode:"v2-read"},operational:{mode:"v2-read"},attendance:{mode:"v2-read"},
        extra:{[blocker.path]:blocker.value},
      });
      const fixture=loadFunctions({initial});
      await assert.rejects(
        ()=>fixture.exports.manageScheduleV2Shadow(request(
          action,"gagyeong","developer@scswim.local",expectedStatus({expectedMode:"v2-read"}),
        )),
        error=>error.code==="failed-precondition",
        `${action} ${blocker.path}`,
      );
      assert.equal(fixture.db.value(operationalPath("gagyeong")).mode,"v2-read");
    }
  }
});

test("shadow and verify use the same recovery and in-flight transition gates",async()=>{
  const cleanShadow=loadFunctions({initial:preparedCandidateState("gagyeong")});
  const shadow=await cleanShadow.exports.manageScheduleV2Shadow(request(
    "set-shadow","gagyeong","developer@scswim.local",expectedRuntime("v1","gen_old",3,7),
  ));
  assert.equal(shadow.mode,"shadow");
  assert.equal(shadow.generationId,"gen_ready");

  const blockerCases=[
    {name:"committing mutation",extra:{
      [mutationPath("gagyeong","committing")]:{status:"committing",recoveryState:"blocked"},
    }},
    {name:"unresolved request conflict",extra:{
      [requestRecoveryPath("gagyeong","conflict")]:{state:"conflict"},
    }},
    {name:"active operation",operational:{activeOperationId:"active-operation"}},
    {name:"live recovery lease",extra:{
      [recoveryFencePath("gagyeong")]:{recoveryLeaseUntil:"2999-01-01T00:00:00.000Z"},
    }},
  ];
  for(const blocker of blockerCases){
    const initial=preparedCandidateState("gagyeong",blocker);
    const fixture=loadFunctions({initial});
    await assert.rejects(
      ()=>fixture.exports.manageScheduleV2Shadow(request(
        "set-shadow","gagyeong","developer@scswim.local",expectedRuntime("v1","gen_old",3,7),
      )),
      error=>error.code==="failed-precondition",
      `set-shadow: ${blocker.name}`,
    );
    assert.equal(fixture.db.value(operationalPath("gagyeong")).mode,"v1");
  }

  for(const blocker of blockerCases){
    const initial=cutoverState("gagyeong",{
      schedule:{mode:"shadow"},operational:{mode:"shadow",...(blocker.operational||{})},
      attendance:{mode:"shadow"},extra:blocker.extra||{},
    });
    const fixture=loadFunctions({initial});
    await assert.rejects(
      ()=>fixture.exports.manageScheduleV2Shadow(request(
        "set-verify","gagyeong","developer@scswim.local",expectedStatus({expectedMode:"shadow"}),
      )),
      error=>error.code==="failed-precondition",
      `set-verify: ${blocker.name}`,
    );
    assert.equal(fixture.db.value(operationalPath("gagyeong")).mode,"shadow");
  }
});

test("status returns aggregate recovery diagnostics without queue identifiers or payloads",async()=>{
  const fixture=loadFunctions({initial:cutoverState("gagyeong",{extra:{
    [mutationPath("gagyeong","op_private")]:{
      status:"committed",recoveryState:"error",operationId:"op_private",studentName:"홍길동",
    },
    [requestRecoveryPath("gagyeong","req_private")]:{
      state:"waiting-primary",operationId:"req_private",phone:"01012345678",
    },
  }})});
  const status=await fixture.exports.manageScheduleV2Shadow(request("status","gagyeong"));
  assert.equal(status.recoveryPendingCount,1);
  assert.equal(status.recoveryErrorCount,1);
  assert.equal(status.requestRecoveryPendingCount,1);
  assert.equal(status.requestRecoveryErrorCount,0);
  assert.doesNotMatch(JSON.stringify(status),/op_private|req_private|홍길동|01012345678/);
});

test("status includes redacted counts for every server transition blocker",async()=>{
  const fixture=loadFunctions({initial:cutoverState("gagyeong",{
    sync:{status:"error",leaseId:"schedule-private",leaseUntil:"2999-01-01T00:00:00.000Z"},
    operational:{activeOperationId:"operation-private"},
    extra:{
      [mutationPath("gagyeong","committing-private")]:{
        status:"committing",recoveryState:"blocked",payload:{name:"Private Student"},
      },
      [mutationPath("gagyeong","mirror-private")]:{
        status:"committed",recoveryState:"pending",phone:"01012345678",
      },
      [requestRecoveryPath("gagyeong","request-private")]:{state:"rejected",rawName:"Private Name"},
      [recoveryFencePath("gagyeong")]:{
        operationId:"recovery-private",recoveryLeaseUntil:"2999-01-01T00:00:00.000Z",
      },
    },
  })});

  const status=await fixture.exports.manageScheduleV2Shadow(request("status","gagyeong"));
  assert.equal(status.committingMutationCount,1);
  assert.equal(status.activeOperationCount,1);
  assert.equal(status.activeRecoveryLeaseCount,1);
  assert.equal(status.scheduleLeaseCount,1);
  assert.equal(status.scheduleStateBlockerCount,1);
  assert.equal(status.mirrorRecoveryPendingCount,1);
  assert.equal(status.requestRecoveryErrorCount,1);
  assert.equal(status.transitionBlockerCount,7);
  assert.doesNotMatch(
    JSON.stringify(status),
    /operation-private|committing-private|mirror-private|request-private|recovery-private|Private|01012345678/,
  );
});

test("stale status and concurrent transition attempts cannot advance the pointer twice",async()=>{
  const stale=loadFunctions({initial:cutoverState("gagyeong")});
  await assert.rejects(
    ()=>stale.exports.manageScheduleV2Shadow(request(
      "set-v2-read","gagyeong","developer@scswim.local",expectedStatus({expectedEpoch:2}),
    )),
    error=>error.code==="aborted",
  );
  assert.equal(stale.db.value(operationalPath("gagyeong")).epoch,3);

  const racing=loadFunctions({initial:cutoverState("gagyeong")});
  const results=await Promise.allSettled([
    racing.exports.manageScheduleV2Shadow(request(
      "set-v2-read","gagyeong","developer@scswim.local",expectedStatus(),
    )),
    racing.exports.manageScheduleV2Shadow(request(
      "set-v2-read","gagyeong","developer@scswim.local",expectedStatus(),
    )),
  ]);
  assert.deepEqual(results.map(result=>result.status).sort(),["fulfilled","rejected"]);
  assert.equal(results.find(result=>result.status==="rejected").reason.code,"aborted");
  assert.equal(racing.db.value(operationalPath("gagyeong")).epoch,4);
});

test("rollback from v2 requires the current revision to remain recovery-safe",async()=>{
  const unsafe=loadFunctions({initial:cutoverState("gagyeong",{
    schedule:{mode:"v2"},operational:{mode:"v2",recoverySafeRevision:6},attendance:{mode:"v2"},
  })});
  await assert.rejects(
    ()=>unsafe.exports.manageScheduleV2Shadow(request(
      "rollback","gagyeong","developer@scswim.local",expectedStatus({expectedMode:"v2"}),
    )),
    error=>error.code==="failed-precondition",
  );
  assert.equal(unsafe.db.value(operationalPath("gagyeong")).mode,"v2");
});

test("runner failure cannot publish a prepared generation as ready",async()=>{
  const initial={
    [schedulePath("gagyeong")]:{mode:"v1",generationId:"",branchId:"gagyeong"},
    [syncPath("gagyeong")]:{pendingKeys:[],requestedRevision:0,appliedRevision:0,status:"idle"},
    "scheduleStores/gagyeong/kv/swim_tab_list":{value:[{id:"regular",type:"regular"}]},
  };
  const fixture=loadFunctions({initial,runShadowSync:async()=>{
    throw Object.assign(new Error("partial-write-failure"),{code:"unavailable"});
  }});

  await assert.rejects(
    ()=>fixture.exports.manageScheduleV2Shadow(request(
      "prepare","gagyeong","developer@scswim.local",expectedRuntime("v1","",0,0),
    )),
    error=>error.code==="failed-precondition",
  );

  const config=fixture.db.value(schedulePath("gagyeong"));
  const generation=fixture.db.value(generationPath("gagyeong",config.preparationGenerationId));
  assert.equal(config.mode,"v1");
  assert.equal(generation.status,"failed");
  assert.equal(generation.capabilities.schedule.status,"error");
  assert.equal(generation.capabilities.attendance,undefined);
  assert.notEqual(generation.status,"ready");
  const alertPrefix="scheduleV2/gagyeong/alerts/";
  const alerts=[...fixture.db.docs.keys()].filter(documentPath=>documentPath.startsWith(alertPrefix));
  assert.equal(alerts.length,1);
  const failureTransaction=fixture.db.transactions.find(attempt=>
    attempt.operations.some(operation=>operation.ref.path.startsWith(alertPrefix))
  );
  assert.ok(failureTransaction);
  assert.deepEqual(new Set(failureTransaction.operations.map(operation=>operation.ref.path)),new Set([
    schedulePath("gagyeong"),syncPath("gagyeong"),
    generationPath("gagyeong",config.preparationGenerationId),alerts[0],
  ]));
  assert.equal(fixture.logs.length,1);
});

test("preparation alert commit failure leaves the fenced failure transition atomic",async()=>{
  const initial={
    [schedulePath("gagyeong")]:{mode:"v1",generationId:"",branchId:"gagyeong"},
    [syncPath("gagyeong")]:{pendingKeys:[],requestedRevision:0,appliedRevision:0,status:"idle"},
    "scheduleStores/gagyeong/kv/swim_tab_list":{value:[{id:"regular",type:"regular"}]},
  };
  const fixture=loadFunctions({
    initial,
    failTransactionForPath:"/alerts/",
    runShadowSync:async()=>{throw Object.assign(new Error("partial-write-failure"),{code:"unavailable"});},
  });

  let caught;
  await assert.rejects(
    ()=>fixture.exports.manageScheduleV2Shadow(request(
      "prepare","gagyeong","developer@scswim.local",expectedRuntime("v1","",0,0),
    )),
    error=>{caught=error;return true;},
  );
  assert.equal(caught.code,"failed-precondition");

  const config=fixture.db.value(schedulePath("gagyeong"));
  const sync=fixture.db.value(syncPath("gagyeong"));
  const generation=fixture.db.value(generationPath("gagyeong",config.preparationGenerationId));
  assert.equal(config.mode,"v1");
  assert.equal(config.preparationStatus,"preparing");
  assert.equal(sync.status,"processing");
  assert.ok(sync.leaseId);
  assert.equal(generation.status,"preparing");
  assert.equal([...fixture.db.docs.keys()].some(path=>path.includes("/alerts/")),false);
  assert.equal(fixture.logs.length,0);
});

test("rollback is blocked while preparation work is in flight",async()=>{
  let started;
  const runnerStarted=new Promise(resolve=>{started=resolve;});
  let release;
  const runnerReleased=new Promise(resolve=>{release=resolve;});
  const initial={
    [schedulePath("yongam")]:{mode:"v1",generationId:"",branchId:"yongam"},
    [syncPath("yongam")]:{pendingKeys:[],requestedRevision:0,appliedRevision:0,status:"idle"},
    "scheduleStores/yongam/kv/swim_tab_list":{value:[{id:"regular",type:"regular"}]},
  };
  const fixture=loadFunctions({initial,runShadowSync:async()=>{
    started();
    await runnerReleased;
    return {
      collections:[
        "tabs","attendanceRecords","attendanceGuests","attendanceSnapshots",
        "attendanceSnapshotStudents","attendanceSnapshotTeachers",
      ],writes:1,deletes:0,
      counts:{tabs:1,attendanceRecords:0,attendanceGuests:0,attendanceSnapshots:0,
        attendanceSnapshotStudents:0,attendanceSnapshotTeachers:0},
      digests:{tabs:"tabs",attendanceRecords:"records",attendanceGuests:"guests",
        attendanceSnapshots:"snapshots",attendanceSnapshotStudents:"students",
        attendanceSnapshotTeachers:"teachers"},
    };
  }});

  const preparing=fixture.exports.manageScheduleV2Shadow(request(
    "prepare","yongam","developer@scswim.local",expectedRuntime("v1","",0,0),
  ));
  await Promise.race([runnerStarted,preparing]);
  const preparingConfig=fixture.db.value(schedulePath("yongam"));
  assert.equal(preparingConfig.mode,"v1");
  assert.equal(preparingConfig.preparationStatus,"preparing");

  await assert.rejects(
    ()=>fixture.exports.manageScheduleV2Shadow(request("rollback","yongam","developer@scswim.local",{
      expectedMode:"v1",
      expectedGenerationId:"",
      expectedEpoch:0,
      expectedRevision:0,
    })),
    error=>error.code==="failed-precondition",
  );
  release();
  const prepared=await preparing;
  assert.equal(prepared.mode,"v1");

  const finalConfig=fixture.db.value(schedulePath("yongam"));
  const generation=fixture.db.value(generationPath("yongam",preparingConfig.preparationGenerationId));
  assert.equal(finalConfig.mode,"v1");
  assert.equal(finalConfig.preparationStatus,"ready");
  assert.equal(generation.status,"ready");
  assert.equal(fixture.db.value(syncPath("yongam")).leaseId,undefined);
  assert.equal([...fixture.db.docs.keys()].some(path=>path.includes("/alerts/")),false);
  assert.equal(fixture.logs.length,0);
});
