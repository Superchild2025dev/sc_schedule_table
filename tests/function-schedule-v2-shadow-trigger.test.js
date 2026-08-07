"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const INDEX_PATH=path.join(__dirname,"..","functions","index.js");
const FUNCTIONS_DIR=path.dirname(INDEX_PATH);

function clone(value){
  return value===undefined?undefined:JSON.parse(JSON.stringify(value));
}

class FakeSnapshot{
  constructor(ref,value){
    this.ref=ref;
    this.exists=value!==undefined;
    this.value=clone(value);
  }
  data(){ return clone(this.value); }
  get(field){ return clone(this.value?.[field]); }
}

class FakeDocument{
  constructor(db,documentPath){ this.db=db;this.path=documentPath;this.id=documentPath.split("/").pop(); }
  collection(name){ return new FakeCollection(this.db,`${this.path}/${name}`); }
  async get(){ return new FakeSnapshot(this,this.db.docs.get(this.path)); }
}

class FakeCollection{
  constructor(db,collectionPath){ this.db=db;this.path=collectionPath; }
  doc(id){ return new FakeDocument(this.db,`${this.path}/${id}`); }
}

class FakeFirestore{
  constructor(initial={}){
    this.docs=new Map(Object.entries(initial).map(([key,value])=>[key,clone(value)]));
    this.transactions=[];
    this.transactionTail=Promise.resolve();
  }
  collection(name){ return new FakeCollection(this,String(name)); }
  value(documentPath){ return clone(this.docs.get(documentPath)); }
  async runTransaction(visitor){
    const prior=this.transactionTail;
    let release;
    this.transactionTail=new Promise(resolve=>{release=resolve;});
    await prior;
    if(typeof this.beforeTransaction==="function") await this.beforeTransaction(this);
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
        if(operation.type==="delete"){
          this.docs.delete(operation.ref.path);
          return;
        }
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

function triggerWrapper(options,handler){
  handler.__options=options;
  return handler;
}

function loadFunctions({initial={},runShadowSync=async()=>({}),now}={}){
  const db=new FakeFirestore(initial);
  const logs=[];
  const runnerCalls=[];
  const runner=async input=>{
    runnerCalls.push(input);
    return runShadowSync(input);
  };
  const firebaseFunctions={setGlobalOptions:()=>{}};
  const localRequire=request=>{
    if(request==="firebase-functions/v2/https") return {
      onCall:triggerWrapper,onRequest:triggerWrapper,
      HttpsError:class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}},
    };
    if(request==="firebase-functions/v2/firestore") return {onDocumentWritten:triggerWrapper};
    if(request==="firebase-functions/v2/scheduler") return {onSchedule:triggerWrapper};
    if(request==="firebase-functions/v2") return firebaseFunctions;
    if(request==="firebase-functions/logger") return {error:(...args)=>logs.push(args)};
    if(request==="firebase-admin/app") return {initializeApp:()=>{}};
    if(request==="firebase-admin/firestore") return {
      getFirestore:()=>db,
      FieldValue:{serverTimestamp:()=>"server-time",delete:()=>"delete",increment:value=>({increment:value})},
      Timestamp:{now:()=>({toDate:()=>new Date("2026-08-07T02:00:00.000Z")})},
    };
    if(request==="./regular-availability") return {buildRegularAvailability:()=>({})};
    if(request==="./schedule-v2-shadow-policy.js") return require(path.join(FUNCTIONS_DIR,"schedule-v2-shadow-policy.js"));
    if(request==="./schedule-v2-shadow-runner.js") return {runShadowSync:runner};
    if(request.startsWith("./")) return require(path.join(FUNCTIONS_DIR,request));
    return require(request);
  };
  const source=fs.readFileSync(INDEX_PATH,"utf8");
  const module={exports:{}};
  const evaluate=new Function("exports","require","module","__filename","__dirname",source);
  if(now){
    const OriginalDate=global.Date;
    global.Date=class extends OriginalDate{
      constructor(...args){ super(...(args.length?args:[now])); }
      static now(){ return new OriginalDate(now).getTime(); }
    };
    try{ evaluate(module.exports,localRequire,module,INDEX_PATH,FUNCTIONS_DIR); }
    finally{ global.Date=OriginalDate; }
  }else{
    evaluate(module.exports,localRequire,module,INDEX_PATH,FUNCTIONS_DIR);
  }
  return {db,exports:module.exports,logs,runnerCalls};
}

function schedulePath(branchId){ return `scheduleV2/${branchId}/runtime/schedule`; }
function syncPath(branchId){ return `scheduleV2/${branchId}/runtime/scheduleSync`; }
function sourceEvent(branchId,docId){ return {params:{branchId,docId}}; }
function alertEntries(db,branchId){
  const prefix=`scheduleV2/${branchId}/alerts/`;
  return [...db.docs.entries()].filter(([documentPath])=>documentPath.startsWith(prefix));
}

test("exports both shadow triggers on the exact source and queue paths",()=>{
  const source=fs.readFileSync(INDEX_PATH,"utf8");

  assert.match(source,/require\("\.\/schedule-v2-shadow-policy\.js"\)/);
  assert.match(source,/require\("\.\/schedule-v2-shadow-runner\.js"\)/);
  assert.match(source,/exports\.queueScheduleV2Shadow\s*=\s*onDocumentWritten\(\{/);
  assert.match(source,/document:\s*"scheduleStores\/\{branchId\}\/kv\/\{docId\}"/);
  assert.match(source,/exports\.processScheduleV2Shadow\s*=\s*onDocumentWritten\(\{/);
  assert.match(source,/document:\s*"scheduleV2\/\{branchId\}\/runtime\/scheduleSync"/);
  assert.match(source,/exports\.recoverScheduleV2ShadowLeases\s*=\s*onSchedule\(\{/);
  assert.match(source,/schedule:\s*"every 1 minutes"/);
  assert.match(source,/exports\.refreshRegularAvailability\s*=\s*onDocumentWritten\(\{/);
});

test("source writes queue tracked keys only for known branches in preparing shadow or verify mode",async()=>{
  for(const branchId of ["gagyeong","yongam"]){
    for(const mode of ["preparing","shadow","verify"]){
      const fixture=loadFunctions({initial:{[schedulePath(branchId)]:{mode,generationId:"gen_1"}}});
      await fixture.exports.queueScheduleV2Shadow(sourceEvent(branchId,"swim_students"));
      assert.deepEqual(fixture.db.value(syncPath(branchId)).pendingKeys,["swim_students"]);
    }
  }

  for(const mode of ["v1","ready"]){
    const fixture=loadFunctions({initial:{[schedulePath("gagyeong")]:{mode,generationId:"gen_1"}}});
    await fixture.exports.queueScheduleV2Shadow(sourceEvent("gagyeong","swim_students"));
    assert.equal(fixture.db.value(syncPath("gagyeong")),undefined,mode);
  }

  const unknown=loadFunctions({initial:{[schedulePath("other")]:{mode:"shadow",generationId:"gen_1"}}});
  await unknown.exports.queueScheduleV2Shadow(sourceEvent("other","swim_students"));
  assert.equal(unknown.db.value(syncPath("other")),undefined);
});

test("source writes never queue attendance audit restore or delete-source keys",async()=>{
  const excluded=[
    "swim_attendance","swim_bt_attendance_summer","swim_day_snapshot",
    "swim_audit_log","zz_swim_audit_entry__123","swim_restore_points",
    "swim_restore_point_123","zz_swim_student_delete_index","zz_swim_student_delete__123",
  ];
  const fixture=loadFunctions({initial:{[schedulePath("yongam")]:{mode:"shadow",generationId:"gen_1"}}});
  await fixture.exports.queueScheduleV2Shadow(sourceEvent("yongam","swim_students"));
  for(const key of excluded){
    await fixture.exports.queueScheduleV2Shadow(sourceEvent("yongam",encodeURIComponent(key)));
  }
  const queued=fixture.db.value(syncPath("yongam"));
  assert.deepEqual(queued.pendingKeys,["swim_students"]);
  assert.equal(queued.requestedRevision,1);
});

test("concurrent source writes transactionally merge both tracked keys",async()=>{
  const fixture=loadFunctions({initial:{[schedulePath("yongam")]:{mode:"shadow",generationId:"gen_1"}}});
  await Promise.all([
    fixture.exports.queueScheduleV2Shadow(sourceEvent("yongam","swim_students")),
    fixture.exports.queueScheduleV2Shadow(sourceEvent("yongam","swim_inst")),
  ]);

  const queued=fixture.db.value(syncPath("yongam"));
  assert.deepEqual(queued.pendingKeys.sort(),["swim_inst","swim_students"]);
  assert.equal(queued.requestedRevision,2);
  assert.equal(queued.status,"pending");
});

test("processor passes the claimed scheduleSync fence and chunk-safe legacy reader",async()=>{
  const sync=syncPath("yongam");
  const initial={
    [schedulePath("yongam")]:{mode:"shadow",generationId:"gen_chunked"},
    [sync]:{pendingKeys:["swim_students"],requestedRevision:4,status:"pending"},
    "scheduleStores/yongam/kv/swim_students":{chunked:true,chunkCount:2,valueType:"json"},
    "scheduleStores/yongam/kv/swim_students/chunks/0000":{text:"[{\"name\":\"Chunk"},
    "scheduleStores/yongam/kv/swim_students/chunks/0001":{text:" Reader\"}]"},
  };
  let legacyValue;
  const fixture=loadFunctions({initial,runShadowSync:async input=>{
    assert.equal(input.branchId,"yongam");
    assert.equal(input.generationId,"gen_chunked");
    assert.deepEqual(input.keys,["swim_students"]);
    assert.equal(input.fence.ref.path,sync);
    assert.equal(input.fence.leaseId,fixture.db.value(sync).leaseId);
    legacyValue=await input.readLegacyKey("swim_students");
    return {
      collections:["people","enrollments","placements"],
      writes:2,deletes:1,
      counts:{people:1,enrollments:1,placements:1},
      digests:{people:"people-digest",enrollments:"enrollment-digest",placements:"placement-digest"},
    };
  }});

  await fixture.exports.processScheduleV2Shadow({params:{branchId:"yongam"}});

  assert.deepEqual(legacyValue,[{name:"Chunk Reader"}]);
  const completed=fixture.db.value(sync);
  assert.equal(completed.status,"idle");
  assert.equal(completed.appliedRevision,4);
  assert.deepEqual(completed.pendingKeys,[]);
  assert.equal(completed.writes,2);
  assert.equal(completed.deletes,1);
  assert.deepEqual(completed.counts,{people:1,enrollments:1,placements:1});
  assert.deepEqual(completed.digests,{
    people:"people-digest",enrollments:"enrollment-digest",placements:"placement-digest",
  });
  assert.equal(typeof completed.lastSyncedAt,"string");
  assert.equal(completed.inFlightKeys,undefined);
  assert.equal(completed.leaseId,undefined);
});

test("an active lease and an unchanged runtime write do not run twice",async()=>{
  const sync=syncPath("gagyeong");
  let startRunner;
  const started=new Promise(resolve=>{startRunner=resolve;});
  let releaseRunner;
  const released=new Promise(resolve=>{releaseRunner=resolve;});
  const fixture=loadFunctions({
    initial:{
      [schedulePath("gagyeong")]:{mode:"verify",generationId:"gen_1"},
      [sync]:{pendingKeys:["swim_inst"],requestedRevision:1,status:"pending"},
    },
    runShadowSync:async()=>{
      startRunner();
      await released;
      return {collections:["teacherAssignments"],writes:0,deletes:0,counts:{},digests:{}};
    },
  });

  const first=fixture.exports.processScheduleV2Shadow({params:{branchId:"gagyeong"}});
  await Promise.race([started,first]);
  assert.equal(fixture.runnerCalls.length,1);
  assert.deepEqual(fixture.db.value(sync).inFlightKeys,["swim_inst"]);
  await fixture.exports.processScheduleV2Shadow({params:{branchId:"gagyeong"}});
  assert.equal(fixture.runnerCalls.length,1);
  releaseRunner();
  await first;

  await fixture.exports.processScheduleV2Shadow({params:{branchId:"gagyeong"}});
  assert.equal(fixture.runnerCalls.length,1);
});

test("a tracked key arriving during processing remains pending",async()=>{
  const sync=syncPath("yongam");
  let startRunner;
  const started=new Promise(resolve=>{startRunner=resolve;});
  let releaseRunner;
  const released=new Promise(resolve=>{releaseRunner=resolve;});
  const fixture=loadFunctions({
    initial:{
      [schedulePath("yongam")]:{mode:"shadow",generationId:"gen_1"},
      [sync]:{pendingKeys:["swim_students"],requestedRevision:1,status:"pending"},
    },
    runShadowSync:async()=>{
      startRunner();
      await released;
      return {collections:["people","enrollments","placements"],writes:1,deletes:0,counts:{},digests:{}};
    },
  });

  const processing=fixture.exports.processScheduleV2Shadow({params:{branchId:"yongam"}});
  await Promise.race([started,processing]);
  assert.equal(fixture.runnerCalls.length,1);
  await fixture.exports.queueScheduleV2Shadow(sourceEvent("yongam","swim_mark"));
  assert.deepEqual(fixture.db.value(sync).inFlightKeys,["swim_students"]);
  assert.deepEqual(fixture.db.value(sync).pendingKeys,["swim_mark"]);
  releaseRunner();
  await processing;

  const queued=fixture.db.value(sync);
  assert.equal(queued.status,"pending");
  assert.deepEqual(queued.pendingKeys,["swim_mark"]);
  assert.equal(queued.appliedRevision,1);
  assert.equal(queued.requestedRevision,2);
});

test("processor ignores unknown branches disallowed modes and excluded pending keys",async()=>{
  for(const mode of ["v1","preparing","ready"]){
    const fixture=loadFunctions({initial:{
      [schedulePath("yongam")]:{mode,generationId:"gen_1"},
      [syncPath("yongam")]:{pendingKeys:["swim_students"],requestedRevision:1},
    }});
    await fixture.exports.processScheduleV2Shadow({params:{branchId:"yongam"}});
    assert.equal(fixture.runnerCalls.length,0,mode);
  }

  const unknown=loadFunctions({initial:{
    [schedulePath("other")]:{mode:"shadow",generationId:"gen_1"},
    [syncPath("other")]:{pendingKeys:["swim_students"],requestedRevision:1},
  }});
  await unknown.exports.processScheduleV2Shadow({params:{branchId:"other"}});
  assert.equal(unknown.runnerCalls.length,0);

  const excluded=loadFunctions({initial:{
    [schedulePath("gagyeong")]:{mode:"shadow",generationId:"gen_1"},
    [syncPath("gagyeong")]:{
      pendingKeys:["swim_attendance","swim_audit_log","swim_restore_points","zz_swim_student_delete_index"],
      requestedRevision:4,
    },
  }});
  await excluded.exports.processScheduleV2Shadow({params:{branchId:"gagyeong"}});
  assert.equal(excluded.runnerCalls.length,0);
});

test("failure requeues safely and merges redacted alerts by error class and scope",async()=>{
  const privateName="Trigger Private Name 20260807";
  const privatePhone="01099998888";
  const sync=syncPath("yongam");
  let startRunner;
  const started=new Promise(resolve=>{startRunner=resolve;});
  let releaseRunner;
  const released=new Promise(resolve=>{releaseRunner=resolve;});
  const fixture=loadFunctions({
    initial:{
      [schedulePath("yongam")]:{mode:"shadow",generationId:"gen_1"},
      [sync]:{pendingKeys:["swim_students"],requestedRevision:1,status:"pending"},
    },
    runShadowSync:async()=>{
      startRunner();
      await released;
      throw Object.assign(new Error(`failed for ${privateName} ${privatePhone}`),{
        code:"internal",details:{student:{name:privateName,phone:privatePhone}},
      });
    },
  });

  const processing=fixture.exports.processScheduleV2Shadow({params:{branchId:"yongam"}});
  await Promise.race([started,processing]);
  assert.equal(fixture.runnerCalls.length,1);
  await fixture.exports.queueScheduleV2Shadow(sourceEvent("yongam","swim_mark"));
  releaseRunner();
  await processing;

  let queued=fixture.db.value(sync);
  assert.equal(queued.status,"pending");
  assert.deepEqual(queued.pendingKeys.sort(),["swim_mark","swim_students"]);
  assert.equal(queued.requestedRevision,2);
  assert.equal(queued.appliedRevision,undefined);
  assert.equal(queued.retryCount,1);
  assert.equal(queued.inFlightKeys,undefined);
  assert.equal(queued.leaseId,undefined);

  assert.equal(fixture.logs.length,1);
  assert.equal(fixture.logs[0][0],"schedule-v2-shadow-failed");
  const diagnostic=fixture.logs[0][1];
  assert.deepEqual(Object.keys(diagnostic).sort(),[
    "branchId","code","collections","detectedAt","keys","messageClass",
  ]);
  assert.deepEqual(diagnostic.keys,["swim_students"]);
  assert.deepEqual(diagnostic.collections,["people","enrollments","placements"]);

  let alerts=alertEntries(fixture.db,"yongam");
  assert.equal(alerts.length,1);
  assert.match(alerts[0][0],/\/alerts\/shadow_internal_/);
  assert.equal(alerts[0][1].count,1);
  assert.equal(alerts[0][1].status,"open");
  assert.equal(alerts[0][1].messageClass,"internal");
  assert.deepEqual(alerts[0][1].keys,diagnostic.keys);
  assert.deepEqual(alerts[0][1].collections,diagnostic.collections);

  const serialized=JSON.stringify({logs:fixture.logs,alerts});
  assert.equal(serialized.includes(privateName),false);
  assert.equal(serialized.includes(privatePhone),false);

  await fixture.exports.processScheduleV2Shadow({params:{branchId:"yongam"}});
  queued=fixture.db.value(sync);
  assert.equal(queued.retryCount,2);
  alerts=alertEntries(fixture.db,"yongam");
  assert.equal(alerts.length,2);
  assert.deepEqual(alerts.map(([,alert])=>alert.count).sort(),[1,1]);

  await fixture.exports.processScheduleV2Shadow({params:{branchId:"yongam"}});
  queued=fixture.db.value(sync);
  assert.equal(queued.retryCount,3);
  alerts=alertEntries(fixture.db,"yongam");
  assert.equal(alerts.length,2);
  assert.deepEqual(alerts.map(([,alert])=>alert.count).sort(),[1,2]);
});

test("retry count is bounded and a new source write restores the retry budget",async()=>{
  const sync=syncPath("gagyeong");
  const fixture=loadFunctions({initial:{
    [schedulePath("gagyeong")]:{mode:"verify",generationId:"gen_1"},
    [sync]:{pendingKeys:["swim_students"],requestedRevision:7,status:"pending",retryCount:10},
  }});

  await fixture.exports.processScheduleV2Shadow({params:{branchId:"gagyeong"}});
  assert.equal(fixture.runnerCalls.length,0);
  assert.equal(fixture.db.value(sync).retryCount,10);

  await fixture.exports.queueScheduleV2Shadow(sourceEvent("gagyeong","swim_inst"));
  assert.equal(fixture.db.value(sync).retryCount,0);
});

test("a stale failing worker cannot requeue over a replacement lease",async()=>{
  const sync=syncPath("yongam");
  let fixture;
  fixture=loadFunctions({
    initial:{
      [schedulePath("yongam")]:{mode:"shadow",generationId:"gen_1"},
      [sync]:{pendingKeys:["swim_students"],requestedRevision:1,status:"pending"},
    },
    runShadowSync:async()=>{
      fixture.db.docs.set(sync,{
        pendingKeys:[],requestedRevision:2,status:"processing",
        inFlightKeys:["swim_mark"],
        leaseId:"replacement-lease",leaseUntil:"2999-01-01T00:00:00.000Z",
      });
      throw Object.assign(new Error("stale"),{code:"stale-run"});
    },
  });

  await fixture.exports.processScheduleV2Shadow({params:{branchId:"yongam"}});

  const replacement=fixture.db.value(sync);
  assert.equal(replacement.leaseId,"replacement-lease");
  assert.equal(replacement.status,"processing");
  assert.deepEqual(replacement.pendingKeys,[]);
  assert.deepEqual(replacement.inFlightKeys,["swim_mark"]);
  assert.equal(alertEntries(fixture.db,"yongam").length,0);
});

test("source and processor transactions close a concurrent mode-change gap",async()=>{
  const sourceFixture=loadFunctions({initial:{
    [schedulePath("gagyeong")]:{mode:"shadow",generationId:"gen_1"},
  }});
  sourceFixture.db.beforeTransaction=async db=>{
    db.docs.set(schedulePath("gagyeong"),{mode:"v1",generationId:"gen_1"});
    db.beforeTransaction=null;
  };
  await sourceFixture.exports.queueScheduleV2Shadow(sourceEvent("gagyeong","swim_students"));
  assert.equal(sourceFixture.db.value(syncPath("gagyeong")),undefined);

  const processorFixture=loadFunctions({initial:{
    [schedulePath("yongam")]:{mode:"verify",generationId:"gen_1"},
    [syncPath("yongam")]:{pendingKeys:["swim_students"],requestedRevision:1,status:"pending"},
  }});
  processorFixture.db.beforeTransaction=async db=>{
    db.docs.set(schedulePath("yongam"),{mode:"ready",generationId:"gen_1"});
    db.beforeTransaction=null;
  };
  await processorFixture.exports.processScheduleV2Shadow({params:{branchId:"yongam"}});
  assert.equal(processorFixture.runnerCalls.length,0);
  assert.equal(processorFixture.db.value(syncPath("yongam")).status,"pending");
});

test("a failed run is not requeued after shadow mode is disabled",async()=>{
  const sync=syncPath("gagyeong");
  let fixture;
  fixture=loadFunctions({
    initial:{
      [schedulePath("gagyeong")]:{mode:"shadow",generationId:"gen_1"},
      [sync]:{pendingKeys:["swim_inst"],requestedRevision:1,status:"pending"},
    },
    runShadowSync:async()=>{
      fixture.db.docs.set(schedulePath("gagyeong"),{mode:"v1",generationId:"gen_1"});
      throw Object.assign(new Error("disabled"),{code:"unavailable"});
    },
  });

  await fixture.exports.processScheduleV2Shadow({params:{branchId:"gagyeong"}});

  const stopped=fixture.db.value(sync);
  assert.equal(stopped.status,"idle");
  assert.deepEqual(stopped.pendingKeys,[]);
  assert.deepEqual(stopped.inFlightKeys,["swim_inst"]);
  assert.equal(stopped.retryCount,undefined);
  assert.equal(stopped.leaseId,undefined);
  assert.equal(fixture.logs.length,0);
  assert.equal(alertEntries(fixture.db,"gagyeong").length,0);
});

test("scheduled recovery requeues expired partial work for both branches without a source write",async()=>{
  const gagyeongSync=syncPath("gagyeong");
  const yongamSync=syncPath("yongam");
  const partialPath="scheduleV2/gagyeong/generations/gen_1/placements/partial-row";
  const fixture=loadFunctions({
    initial:{
      [schedulePath("gagyeong")]:{mode:"shadow",generationId:"gen_1"},
      [gagyeongSync]:{
        pendingKeys:[],inFlightKeys:["swim_students"],requestedRevision:3,
        status:"processing",leaseId:"dead-gagyeong",leaseUntil:"2026-08-07T01:00:00.000Z",retryCount:2,
      },
      [schedulePath("yongam")]:{mode:"verify",generationId:"gen_2"},
      [yongamSync]:{
        pendingKeys:[],inFlightKeys:["swim_inst"],requestedRevision:4,
        status:"processing",leaseId:"dead-yongam",leaseUntil:"2026-08-07T01:00:00.000Z",retryCount:0,
      },
      [partialPath]:{id:"partial-row",time:"5pm"},
    },
    runShadowSync:async input=>({
      collections:input.keys.includes("swim_students")?["people","enrollments","placements"]:["teacherAssignments"],
      writes:0,deletes:0,counts:{},digests:{},
    }),
  });

  await fixture.exports.recoverScheduleV2ShadowLeases();

  const gagyeongRecovered=fixture.db.value(gagyeongSync);
  assert.deepEqual(gagyeongRecovered.pendingKeys,["swim_students"]);
  assert.equal(gagyeongRecovered.inFlightKeys,undefined);
  assert.equal(gagyeongRecovered.leaseId,undefined);
  assert.equal(gagyeongRecovered.status,"pending");
  assert.equal(gagyeongRecovered.retryCount,3);
  const yongamRecovered=fixture.db.value(yongamSync);
  assert.deepEqual(yongamRecovered.pendingKeys,["swim_inst"]);
  assert.equal(yongamRecovered.inFlightKeys,undefined);
  assert.equal(yongamRecovered.retryCount,1);
  assert.deepEqual(fixture.db.value(partialPath),{id:"partial-row",time:"5pm"});

  await fixture.exports.processScheduleV2Shadow({params:{branchId:"gagyeong"}});
  await fixture.exports.processScheduleV2Shadow({params:{branchId:"yongam"}});
  assert.deepEqual(fixture.runnerCalls.map(call=>[call.branchId,call.keys]),[
    ["gagyeong",["swim_students"]],
    ["yongam",["swim_inst"]],
  ]);
  assert.equal(fixture.db.value(gagyeongSync).status,"idle");
  assert.equal(fixture.db.value(gagyeongSync).inFlightKeys,undefined);
  assert.equal(fixture.db.value(yongamSync).status,"idle");
  assert.equal(fixture.db.value(yongamSync).inFlightKeys,undefined);
});

test("scheduled recovery skips disabled and active leases and respects the retry bound",async()=>{
  const disabledSync=syncPath("gagyeong");
  const boundedSync=syncPath("yongam");
  const disabled={
    pendingKeys:[],inFlightKeys:["swim_students"],requestedRevision:2,
    status:"processing",leaseId:"disabled-lease",leaseUntil:"2026-08-07T01:00:00.000Z",retryCount:2,
  };
  const fixture=loadFunctions({initial:{
    [schedulePath("gagyeong")]:{mode:"v1",generationId:"gen_1"},
    [disabledSync]:disabled,
    [schedulePath("yongam")]:{mode:"shadow",generationId:"gen_2"},
    [boundedSync]:{
      pendingKeys:[],inFlightKeys:["swim_inst"],requestedRevision:8,
      status:"processing",leaseId:"bounded-lease",leaseUntil:"2026-08-07T01:00:00.000Z",retryCount:10,
    },
  }});

  await fixture.exports.recoverScheduleV2ShadowLeases();

  assert.deepEqual(fixture.db.value(disabledSync),disabled);
  assert.deepEqual(fixture.db.value(boundedSync).pendingKeys,["swim_inst"]);
  assert.equal(fixture.db.value(boundedSync).retryCount,10);
  await fixture.exports.processScheduleV2Shadow({params:{branchId:"yongam"}});
  assert.equal(fixture.runnerCalls.length,0);

  const activeFixture=loadFunctions({initial:{
    [schedulePath("gagyeong")]:{mode:"verify",generationId:"gen_1"},
    [disabledSync]:{
      pendingKeys:[],inFlightKeys:["swim_students"],requestedRevision:2,
      status:"processing",leaseId:"active-lease",leaseUntil:"2999-01-01T00:00:00.000Z",retryCount:1,
    },
  }});
  const before=activeFixture.db.value(disabledSync);
  await activeFixture.exports.recoverScheduleV2ShadowLeases();
  assert.deepEqual(activeFixture.db.value(disabledSync),before);
});
