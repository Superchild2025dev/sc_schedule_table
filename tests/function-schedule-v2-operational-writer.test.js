"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const policy=require("../functions/schedule-v2-operational-policy.js");
const operational=require("../functions/schedule-v2-operational-writer.js");

function clone(value){
  return value===undefined?undefined:JSON.parse(JSON.stringify(value));
}

class Snapshot{
  constructor(ref,value){this.ref=ref;this.id=ref.id;this.exists=value!==undefined;this.value=clone(value);}
  data(){return clone(this.value);}
  get(field){return clone(this.value?.[field]);}
}

class DocumentRef{
  constructor(db,documentPath){this.db=db;this.path=documentPath;this.id=documentPath.split("/").pop();}
  collection(name){return new CollectionRef(this.db,`${this.path}/${name}`);}
  async get(){return new Snapshot(this,this.db.docs.get(this.path));}
}

class QueryRef{
  constructor(collection,filters=[],order=null,maximum=Infinity,after=null){
    this.collection=collection;this.filters=filters;this.order=order;this.maximum=maximum;this.after=after;
  }
  where(field,operator,value){return new QueryRef(this.collection,this.filters.concat([[field,operator,value]]),this.order,this.maximum,this.after);}
  orderBy(field,direction="asc"){return new QueryRef(this.collection,this.filters,[field,direction],this.maximum,this.after);}
  limit(maximum){return new QueryRef(this.collection,this.filters,this.order,maximum,this.after);}
  startAfter(snapshot){return new QueryRef(this.collection,this.filters,this.order,this.maximum,snapshot);}
  async get(){
    let docs=this.collection.directDocs().filter(doc=>this.filters.every(([field,operator,want])=>{
      const actual=doc.data()?.[field];
      if(operator==="==") return actual===want;
      if(operator==="in") return Array.isArray(want)&&want.includes(actual);
      if(operator==="<="){
        const actualTime=Date.parse(String(actual??""));
        const wantedTime=want instanceof Date?want.getTime():Date.parse(String(want??""));
        return Number.isFinite(actualTime)&&Number.isFinite(wantedTime)&&actualTime<=wantedTime;
      }
      throw new Error(`unsupported query operator ${operator}`);
    }));
    if(this.order){
      const [field,direction]=this.order;
      docs.sort((left,right)=>String(left.data()?.[field]??"").localeCompare(String(right.data()?.[field]??""))*(direction==="desc"?-1:1));
    }
    if(this.after){
      const index=docs.findIndex(doc=>doc.id===this.after.id);
      if(index>=0) docs=docs.slice(index+1);
    }
    docs=docs.slice(0,this.maximum);
    return {docs,size:docs.length,empty:docs.length===0,forEach(visitor){docs.forEach(visitor);}};
  }
}

class CollectionRef extends QueryRef{
  constructor(db,collectionPath){super(null);this.db=db;this.path=collectionPath;this.collection=this;}
  doc(id){return new DocumentRef(this.db,`${this.path}/${id}`);}
  directDocs(){
    const prefix=this.path+"/";
    const docs=[];
    for(const [documentPath,value] of this.db.docs){
      const suffix=documentPath.startsWith(prefix)?documentPath.slice(prefix.length):"";
      if(suffix&&!suffix.includes("/")) docs.push(new Snapshot(new DocumentRef(this.db,documentPath),value));
    }
    return docs;
  }
}

class FakeFirestore{
  constructor(initial={}){
    this.docs=new Map(Object.entries(initial).map(([key,value])=>[key,clone(value)]));
    this.transactions=[];
    this.batches=[];
    this.failBatchAt=0;
    this.failTransactionAt=0;
    this.failLegacyTransactionAt=0;
    this.legacyTransactions=0;
    this.afterTransaction=null;
  }
  collection(name){return new CollectionRef(this,String(name));}
  batch(){
    const operations=[];
    return {
      set:(ref,value,options)=>operations.push({type:"set",ref,value:clone(value),options}),
      delete:ref=>operations.push({type:"delete",ref}),
      commit:async()=>{
        this.batches.push(operations);
        if(this.failBatchAt===this.batches.length) throw Object.assign(new Error("private payload must not leak"),{code:"unavailable"});
        this.apply(operations);
      },
    };
  }
  apply(operations){
    operations.forEach(operation=>{
      if(operation.type==="delete") return this.docs.delete(operation.ref.path);
      const current=this.docs.get(operation.ref.path);
      this.docs.set(operation.ref.path,operation.options?.merge&&current?{...clone(current),...clone(operation.value)}:clone(operation.value));
    });
  }
  async runTransaction(visitor){
    const operations=[];
    const attempt={reads:[],operations};
    const tx={
      get:async ref=>{attempt.reads.push(ref.path);return new Snapshot(ref,this.docs.get(ref.path));},
      set:(ref,value,options)=>operations.push({type:"set",ref,value:clone(value),options}),
      delete:ref=>operations.push({type:"delete",ref}),
    };
    this.transactions.push(attempt);
    const result=await visitor(tx);
    if(operations.some(operation=>operation.ref.path.startsWith("scheduleStores/"))){
      this.legacyTransactions+=1;
      if(this.failLegacyTransactionAt===this.legacyTransactions){
        throw Object.assign(new Error("private payload must not leak"),{code:"unavailable"});
      }
    }
    if(this.failTransactionAt===this.transactions.length){
      throw Object.assign(new Error("transaction interrupted"),{code:"unavailable"});
    }
    this.apply(operations);
    if(typeof this.afterTransaction==="function") await this.afterTransaction(attempt);
    return result;
  }
  value(path){return clone(this.docs.get(path));}
  writeCountFor(operationId){
    return [...this.docs.values()].filter(value=>value?.lastOperationId===operationId).length;
  }
}

const NOW=new Date("2026-08-11T03:00:00.000Z");
const BRANCH="yongam";
const GENERATION="gen_1";
const REQUEST_ID="r_1723350000000_ab12cd";
const OTHER_REQUEST_ID="r_1723350000001_cd34ef";
function operationUuid(value){return `10000000-0000-4000-8000-${String(value).padStart(12,"0")}`;}
function productionRequestId(value){return `r_${1723350000000+value}_${String(value).padStart(6,"a")}`;}
function accountActorId(email){return crypto.createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0,24);}

function runtimePath(branchId=BRANCH){return `scheduleV2/${branchId}/runtime/operational`;}
function manifestPath(operationId,branchId=BRANCH){return `scheduleV2/${branchId}/operationalMutations/${operationId}`;}
function requestRecoveryPath(operationId,branchId=BRANCH){return `scheduleV2/${branchId}/requestRecoveries/${operationId}`;}
function recoveryFencePath(branchId=BRANCH){return `scheduleV2/${branchId}/runtime/operationalRecovery`;}
function legacyPath(key,branchId=BRANCH){
  return `scheduleStores/${branchId}/kv/${encodeURIComponent(key).replace(/\./g,"%2E")}`;
}
function generationPath(collection,id,branchId=BRANCH,generationId=GENERATION){
  return `scheduleV2/${branchId}/generations/${generationId}/${collection}/${id}`;
}
function runtime(overrides={}){
  return {branchId:BRANCH,mode:"v2-read",generationId:GENERATION,epoch:4,revision:31,...overrides};
}
function mutableClock(start=NOW){
  let current=start.getTime();
  return {
    now:()=>new Date(current),
    advance:milliseconds=>{current+=milliseconds;return new Date(current);},
  };
}
function auth(email="developer@scswim.local",extra={}){
  return {auth:{uid:`uid:${email}`,token:{email,email_verified:true,...extra}}};
}
function request(overrides={}){
  return {
    ...auth(),
    data:{
      branchId:BRANCH,generationId:GENERATION,expectedEpoch:4,
      operationId:"op_1",operationType:"move-student",keys:["swim_students"],
      beforeRevision:31,nextValues:{swim_students:[]},removedKeys:[],
      ...overrides,
    },
  };
}
function requestRecoveryCommand(action="stage",overrides={}){
  const base=action==="stage"?{
    version:1,action,branchId:BRANCH,operationId:operationUuid(1),operationType:"absence-cancel",
    intents:[{
      requestId:REQUEST_ID,expectedStatus:"pending",expectedVersion:null,
      patch:{status:"accepted",processedAt:"2026-08-11T03:00:00.000Z",clearProcessing:true},
    }],
  }:{version:1,action,branchId:BRANCH,operationId:""};
  return {...auth("yongam.desk@scswim.local"),data:{...base,...overrides}};
}
function committedManifest(operationId=operationUuid(1),overrides={}){
  return {
    operationId,branchId:BRANCH,generationId:GENERATION,status:"committed",
    operationType:"absence-cancel",resultingRevision:32,
    actorId:accountActorId("yongam.desk@scswim.local"),...overrides,
  };
}
function legacyRequests(requests,branchId=BRANCH){
  return {key:"swim_requests",value:JSON.stringify(requests),chunked:false,branchId};
}
function change(id="placement-new"){
  return {type:"set",collection:"placements",id,value:{id,personId:"person-1",enrollmentId:"enrollment-1",tabId:"regular"}};
}
function createWriter(db,overrides={}){
  return operational.createOperationalWriter({
    db,now:()=>NOW,serverTimestamp:()=>"server-time",
    deriveChanges:async()=>({changes:[change()],collections:{},legacyValues:{swim_students:"[]"}}),
    resolveRecoveryValues:async()=>({swim_students:"[]"}),
    ...overrides,
  });
}

test("permission manifest keeps developer and desk boundaries while limiting teachers",()=>{
  assert.equal(policy.authorizeMutation(auth().auth,request().data).role,"developer");
  assert.equal(policy.authorizeMutation(auth("yongam.desk@scswim.local").auth,request().data).role,"desk");
  assert.throws(()=>policy.authorizeMutation(
    auth("yongam.desk@scswim.local").auth,
    request({branchId:"gagyeong"}).data,
  ),error=>error.code==="permission-denied");

  const teacher=auth("gagyeong.son@scswim.local").auth;
  assert.equal(policy.authorizeMutation(teacher,request({
    operationType:"attendance",keys:["swim_attendance"],
    nextValues:{swim_attendance:{}},
  }).data).role,"teacher");
  assert.equal(policy.authorizeMutation(teacher,request({
    operationType:"absence-confirmation",keys:["swim_mark"],nextValues:{swim_mark:{}},
  }).data).role,"teacher");
  const makeupOperations=[
    "makeup","makeup-update","makeup-cancel","set-makeup","sample-makeup","mandatory-makeup",
  ];
  for(const operationType of makeupOperations){
    assert.equal(policy.authorizeMutation(teacher,request({
      operationType,keys:["swim_mark"],nextValues:{swim_mark:{}},
    }).data).role,"teacher");
  }
  const yongamTeacher=auth("yongam.lee1@scswim.local").auth;
  assert.equal(policy.authorizeMutation(yongamTeacher,request({
    branchId:"gagyeong",operationType:"attendance",keys:["swim_attendance"],
    nextValues:{swim_attendance:{}},
  }).data).role,"teacher");
  assert.equal(policy.authorizeMutation(yongamTeacher,request({
    branchId:"gagyeong",operationType:"absence-confirmation",keys:["swim_mark"],
    nextValues:{swim_mark:{}},
  }).data).role,"teacher");
  for(const branchId of ["yongam","gagyeong"]){
    for(const operationType of makeupOperations){
      assert.throws(()=>policy.authorizeMutation(yongamTeacher,request({
        branchId,operationType,keys:["swim_mark"],nextValues:{swim_mark:{}},
      }).data),error=>error.code==="permission-denied");
    }
  }
  assert.throws(()=>policy.authorizeMutation(teacher,request().data),error=>error.code==="permission-denied");
  assert.throws(()=>policy.authorizeMutation(null,request().data),error=>error.code==="unauthenticated");
});

test("strict request schema rejects unknown fields operations keys and unverified identities",()=>{
  assert.throws(()=>policy.validateMutationRequest({...request().data,payload:{name:"private"}}),error=>error.code==="invalid-argument");
  assert.throws(()=>policy.validateMutationRequest({...request().data,operationType:"invented"}),error=>error.code==="invalid-argument");
  assert.throws(()=>policy.validateMutationRequest({...request().data,keys:["customerVoice"],nextValues:{customerVoice:{}}}),error=>error.code==="invalid-argument");
  assert.throws(()=>policy.validateMutationRequest({...request().data,keys:["swim_closed"]}),error=>error.code==="invalid-argument");
  assert.throws(()=>policy.authorizeMutation(auth("developer@scswim.local",{email_verified:false}).auth,request().data),error=>error.code==="permission-denied");
  const missingVerification=auth().auth;
  delete missingVerification.token.email_verified;
  assert.throws(()=>policy.authorizeMutation(missingVerification,request().data),error=>error.code==="permission-denied");
  assert.equal(policy.authorizeMutation(auth().auth,request().data).role,"developer");
});

test("request recovery commands use an exact non-PII versioned schema",()=>{
  const command=policy.validateRequestRecoveryCommand(requestRecoveryCommand().data);
  assert.equal(command.version,1);
  assert.equal(command.intents[0].requestId,REQUEST_ID);
  assert.equal(JSON.stringify(command).includes("name"),false);
  for(const invalid of [
    {...requestRecoveryCommand().data,version:2},
    {...requestRecoveryCommand().data,rawRequest:{name:"private"}},
    {...requestRecoveryCommand().data,intents:[{
      requestId:REQUEST_ID,expectedStatus:"pending",expectedVersion:null,
      patch:{status:"accepted",processedBy:"Private Name"},
    }]},
    {...requestRecoveryCommand().data,intents:[{
      requestId:"../unsafe",expectedStatus:"pending",expectedVersion:null,patch:{status:"accepted"},
    }]},
    {...requestRecoveryCommand().data,intents:[{
      requestId:REQUEST_ID,expectedStatus:"invented",expectedVersion:null,patch:{status:"accepted"},
    }]},
    {...requestRecoveryCommand().data,intents:[{
      requestId:REQUEST_ID,expectedStatus:"pending",expectedVersion:null,patch:{status:"accepted"},
    }]},
    {...requestRecoveryCommand().data,intents:[{
      requestId:REQUEST_ID,expectedStatus:"pending",expectedVersion:null,
      patch:{status:"cancelled",processedAt:"2026-08-11T03:00:00.000Z",cancelledRequestId:OTHER_REQUEST_ID},
    }]},
  ]) assert.throws(()=>policy.validateRequestRecoveryCommand(invalid),error=>error.code==="invalid-argument");
  assert.equal(policy.authorizeRequestRecovery(
    requestRecoveryCommand().auth,command,
  ).role,"desk");
});

test("request recovery accepts production IDs and rejects phone or name-like identifiers",()=>{
  assert.equal(policy.validateRequestRecoveryCommand(requestRecoveryCommand().data).operationId,operationUuid(1));
  for(const data of [
    {...requestRecoveryCommand().data,operationId:"01012345678"},
    {...requestRecoveryCommand().data,operationId:"staff-name"},
    {...requestRecoveryCommand().data,intents:[{
      ...requestRecoveryCommand().data.intents[0],requestId:"01012345678",
    }]},
    {...requestRecoveryCommand().data,intents:[{
      ...requestRecoveryCommand().data.intents[0],requestId:"teacher_name",
    }]},
  ]) assert.throws(()=>policy.validateRequestRecoveryCommand(data),error=>error.code==="invalid-argument");
  assert.throws(()=>policy.validateRequestRecoveryCommand({
    ...requestRecoveryCommand("status").data,operationId:operationUuid(30),
  }),error=>error.code==="invalid-argument");
});

test("target-status schemas reject every contradictory transition field combination",()=>{
  const base=requestRecoveryCommand().data;
  const invalidPatches=[
    {status:"accepted",processedAt:NOW.toISOString(),supersededBy:OTHER_REQUEST_ID},
    {status:"accepted",processedAt:NOW.toISOString(),cancelledAt:NOW.toISOString()},
    {status:"rejected",processedAt:NOW.toISOString(),cancelledRequestId:OTHER_REQUEST_ID},
    {status:"superseded",processedAt:NOW.toISOString(),supersededBy:OTHER_REQUEST_ID,cancelledBy:"parent-approved"},
    {status:"cancelled",processedAt:NOW.toISOString(),cancelledAt:NOW.toISOString(),cancelledBy:"parent-approved",cancelledRequestId:OTHER_REQUEST_ID,supersededBy:OTHER_REQUEST_ID},
    {status:"cancelled",processedAt:NOW.toISOString(),cancelledAt:"2026-08-11T03:00:01.000Z",cancelledBy:"parent-approved",cancelledRequestId:OTHER_REQUEST_ID},
    {status:"accepted",processedAt:NOW.toISOString(),clearProcessing:false},
  ];
  for(const patch of invalidPatches){
    assert.throws(()=>policy.validateRequestRecoveryCommand({
      ...base,intents:[{requestId:REQUEST_ID,expectedStatus:"pending",expectedVersion:null,patch}],
    }),error=>error.code==="invalid-argument");
  }
  for(const intent of [
    {requestId:REQUEST_ID,expectedStatus:"pending",expectedVersion:null,patch:{status:"cancelled",processedAt:NOW.toISOString(),cancelledAt:NOW.toISOString(),cancelledBy:"parent-approved",cancelledRequestId:OTHER_REQUEST_ID}},
    {requestId:REQUEST_ID,expectedStatus:"accepted",expectedVersion:null,patch:{status:"superseded",processedAt:NOW.toISOString(),supersededBy:OTHER_REQUEST_ID}},
    {requestId:REQUEST_ID,expectedStatus:"pending",expectedVersion:null,patch:{status:"superseded",processedAt:NOW.toISOString(),supersededBy:REQUEST_ID}},
  ]) assert.throws(()=>policy.validateRequestRecoveryCommand({...base,intents:[intent]}),error=>error.code==="invalid-argument");
});

test("an exact same-status recovery is idempotent only when patch version processor and clearing match",async()=>{
  const operationId=operationUuid(10);
  const before={
    status:"accepted",requestVersion:7,processedAt:NOW.toISOString(),processedBy:"용암점 데스크",memo:"keep",
  };
  const db=new FakeFirestore({
    [manifestPath(operationId)]:committedManifest(operationId),
    [legacyPath("swim_requests")]:legacyRequests({[REQUEST_ID]:before}),
  });
  const command=requestRecoveryCommand("stage",{
    operationId,intents:[{requestId:REQUEST_ID,expectedStatus:"pending",expectedVersion:7,
      patch:{status:"accepted",processedAt:NOW.toISOString(),clearProcessing:true}}],
  });
  const writer=createWriter(db);
  await writer.manageRequestRecovery(command);
  const result=await writer.manageRequestRecovery(requestRecoveryCommand("drain",{operationId}));

  assert.equal(result.state,"completed");
  assert.deepEqual(JSON.parse(db.value(legacyPath("swim_requests")).value)[REQUEST_ID],before);
});

test("same-status supersession with different linkage returns conflict",async()=>{
  const operationId=operationUuid(11);
  const intendedLink=productionRequestId(11);
  const currentLink=productionRequestId(12);
  const db=new FakeFirestore({
    [manifestPath(operationId)]:committedManifest(operationId,{operationType:"makeup"}),
    [legacyPath("swim_requests")]:legacyRequests({[REQUEST_ID]:{
      status:"superseded",processedAt:NOW.toISOString(),processedBy:"용암점 데스크",supersededBy:currentLink,
    }}),
  });
  const writer=createWriter(db);
  await writer.manageRequestRecovery(requestRecoveryCommand("stage",{
    operationId,operationType:"makeup",intents:[{
      requestId:REQUEST_ID,expectedStatus:"pending",expectedVersion:null,
      patch:{status:"superseded",processedAt:NOW.toISOString(),supersededBy:intendedLink},
    }],
  }));
  const result=await writer.manageRequestRecovery(requestRecoveryCommand("drain",{operationId}));
  assert.equal(result.state,"conflict");
});

test("same-status recovery with a newer request version returns conflict",async()=>{
  const operationId=operationUuid(12);
  const db=new FakeFirestore({
    [manifestPath(operationId)]:committedManifest(operationId),
    [legacyPath("swim_requests")]:legacyRequests({[REQUEST_ID]:{
      status:"accepted",requestVersion:8,processedAt:NOW.toISOString(),processedBy:"용암점 데스크",
    }}),
  });
  const writer=createWriter(db);
  await writer.manageRequestRecovery(requestRecoveryCommand("stage",{
    operationId,intents:[{requestId:REQUEST_ID,expectedStatus:"pending",expectedVersion:7,
      patch:{status:"accepted",processedAt:NOW.toISOString()}}],
  }));
  assert.equal((await writer.manageRequestRecovery(requestRecoveryCommand("drain",{operationId}))).state,"conflict");
});

test("same-status acceptance with a contradictory persisted transition field returns conflict",async()=>{
  const operationId=operationUuid(18);
  const db=new FakeFirestore({
    [manifestPath(operationId)]:committedManifest(operationId),
    [legacyPath("swim_requests")]:legacyRequests({[REQUEST_ID]:{
      status:"accepted",processedAt:NOW.toISOString(),processedBy:"용암점 데스크",
      supersededBy:OTHER_REQUEST_ID,
    }}),
  });
  const writer=createWriter(db);
  await writer.manageRequestRecovery(requestRecoveryCommand("stage",{operationId}));
  assert.equal((await writer.manageRequestRecovery(requestRecoveryCommand("drain",{operationId}))).state,"conflict");
});

test("same-status stale cancellation never marks a newer cancellation idempotent",async()=>{
  const operationId=operationUuid(13);
  const staleCancel=productionRequestId(13);
  const newerCancel=productionRequestId(14);
  const db=new FakeFirestore({
    [manifestPath(operationId)]:committedManifest(operationId,{operationType:"makeup-cancel"}),
    [legacyPath("swim_requests")]:legacyRequests({[REQUEST_ID]:{
      status:"cancelled",processedAt:NOW.toISOString(),processedBy:"용암점 데스크",
      cancelledAt:NOW.toISOString(),cancelledBy:"parent-approved",cancelledRequestId:newerCancel,
    }}),
  });
  const writer=createWriter(db);
  await writer.manageRequestRecovery(requestRecoveryCommand("stage",{
    operationId,operationType:"makeup-cancel",intents:[{
      requestId:REQUEST_ID,expectedStatus:"accepted",expectedVersion:null,
      patch:{status:"cancelled",processedAt:NOW.toISOString(),cancelledAt:NOW.toISOString(),cancelledBy:"parent-approved",cancelledRequestId:staleCancel},
    }],
  }));
  assert.equal((await writer.manageRequestRecovery(requestRecoveryCommand("drain",{operationId}))).state,"conflict");
});

test("teacher and desk V2 recovery derive the same trusted processedBy as V1 without queue PII",async()=>{
  for(const [index,email,processedBy] of [
    [14,"yongam.lee1@scswim.local","이수재"],
    [15,"yongam.desk@scswim.local","용암점 데스크"],
  ]){
    const operationId=operationUuid(index);
    const db=new FakeFirestore({
      [manifestPath(operationId)]:committedManifest(operationId,{actorId:accountActorId(email)}),
      [legacyPath("swim_requests")]:legacyRequests({[REQUEST_ID]:{status:"pending"}}),
    });
    const writer=createWriter(db);
    const command=requestRecoveryCommand("stage",{operationId});
    command.auth=auth(email).auth;
    await writer.manageRequestRecovery(command);
    await writer.manageRequestRecovery({...requestRecoveryCommand("drain",{operationId}),auth:auth(email).auth});
    const stored=JSON.parse(db.value(legacyPath("swim_requests")).value)[REQUEST_ID];
    assert.equal(stored.processedBy,processedBy);
    assert.equal(JSON.stringify(db.value(requestRecoveryPath(operationId))).includes(processedBy),false);
  }
});

test("same-status recovery with a different committed operation linkage conflicts explicitly",async()=>{
  const operationId=operationUuid(16);
  const db=new FakeFirestore({
    [manifestPath(operationId)]:committedManifest(operationId,{operationId:operationUuid(17)}),
    [legacyPath("swim_requests")]:legacyRequests({[REQUEST_ID]:{
      status:"accepted",processedAt:NOW.toISOString(),processedBy:"용암점 데스크",
    }}),
  });
  const writer=createWriter(db);
  await writer.manageRequestRecovery(requestRecoveryCommand("stage",{operationId}));
  assert.equal((await writer.manageRequestRecovery(requestRecoveryCommand("drain",{operationId}))).state,"conflict");
});

test("committed linked recovery patches one request and preserves concurrent fields and unrelated requests",async()=>{
  const operationId=operationUuid(2);
  const db=new FakeFirestore({
    [manifestPath(operationId)]:committedManifest(operationId),
    [legacyPath("swim_requests")]:legacyRequests({
      [REQUEST_ID]:{status:"pending",memo:"newer parent field",parent:{name:"Private Student"}},
      req_2:{status:"pending",memo:"unrelated"},
    }),
  });
  const writer=createWriter(db);
  await writer.manageRequestRecovery(requestRecoveryCommand("stage",{operationId}));
  const result=await writer.manageRequestRecovery(requestRecoveryCommand("drain",{operationId}));
  const stored=JSON.parse(db.value(legacyPath("swim_requests")).value);

  assert.equal(result.state,"completed");
  assert.equal(stored[REQUEST_ID].status,"accepted");
  assert.equal(stored[REQUEST_ID].memo,"newer parent field");
  assert.equal(stored[REQUEST_ID].parent.name,"Private Student");
  assert.deepEqual(stored.req_2,{status:"pending",memo:"unrelated"});
  assert.equal(JSON.stringify(db.value(requestRecoveryPath(operationId))).includes("Private Student"),false);
});

test("a newer request status wins over a stale recovery precondition",async()=>{
  const operationId=operationUuid(3);
  const db=new FakeFirestore({
    [manifestPath(operationId)]:committedManifest(operationId),
    [legacyPath("swim_requests")]:legacyRequests({[REQUEST_ID]:{status:"rejected",memo:"newer staff update"}}),
  });
  const writer=createWriter(db);
  await writer.manageRequestRecovery(requestRecoveryCommand("stage",{operationId}));
  const result=await writer.manageRequestRecovery(requestRecoveryCommand("drain",{operationId}));

  assert.equal(result.state,"conflict");
  assert.deepEqual(JSON.parse(db.value(legacyPath("swim_requests")).value)[REQUEST_ID],{
    status:"rejected",memo:"newer staff update",
  });
});

test("an ambiguous client response resumes from a committed V2 manifest",async()=>{
  const operationId=operationUuid(4);
  const db=new FakeFirestore({
    [legacyPath("swim_requests")]:legacyRequests({[REQUEST_ID]:{status:"pending"}}),
  });
  const writer=createWriter(db);
  await writer.manageRequestRecovery(requestRecoveryCommand("stage",{operationId}));
  db.docs.set(manifestPath(operationId),committedManifest(operationId));

  const resumed=await createWriter(db).manageRequestRecovery(requestRecoveryCommand("drain",{operationId}));

  assert.equal(resumed.state,"completed");
  assert.equal(JSON.parse(db.value(legacyPath("swim_requests")).value)[REQUEST_ID].status,"accepted");
});

test("an incomplete or absent V2 manifest never applies the V1 request patch",async()=>{
  for(const manifest of [undefined,committedManifest(operationUuid(5),{status:"committing"})]){
    const operationId=operationUuid(5);
    const initial={
      [legacyPath("swim_requests")]:legacyRequests({[REQUEST_ID]:{status:"pending"}}),
      ...(manifest?{[manifestPath(operationId)]:manifest}:{}),
    };
    const db=new FakeFirestore(initial);
    const writer=createWriter(db);
    await writer.manageRequestRecovery(requestRecoveryCommand("stage",{operationId}));
    const result=await writer.manageRequestRecovery(requestRecoveryCommand("drain",{operationId}));

    assert.equal(result.state,"waiting-primary");
    assert.equal(JSON.parse(db.value(legacyPath("swim_requests")).value)[REQUEST_ID].status,"pending");
  }
});

test("v2 to v1 rollback still drains a recovery whose linked manifest committed",async()=>{
  const operationId=operationUuid(6);
  const db=new FakeFirestore({
    [runtimePath()]:runtime({mode:"v1",generationId:"",revision:32}),
    [manifestPath(operationId)]:committedManifest(operationId),
    [legacyPath("swim_requests")]:legacyRequests({[REQUEST_ID]:{status:"pending"}}),
  });
  const writer=createWriter(db);
  await writer.manageRequestRecovery(requestRecoveryCommand("stage",{operationId}));
  const result=await writer.manageRequestRecovery(requestRecoveryCommand("drain",{operationId}));

  assert.equal(result.state,"completed");
  assert.equal(JSON.parse(db.value(legacyPath("swim_requests")).value)[REQUEST_ID].status,"accepted");
});

test("a failed atomic completion retries after lease expiry without duplicating the patch",async()=>{
  const operationId=operationUuid(7);
  const clock=mutableClock();
  const db=new FakeFirestore({
    [manifestPath(operationId)]:committedManifest(operationId),
    [legacyPath("swim_requests")]:legacyRequests({[REQUEST_ID]:{status:"pending",counter:1}}),
  });
  const writer=createWriter(db,{now:clock.now});
  await writer.manageRequestRecovery(requestRecoveryCommand("stage",{operationId}));
  db.failLegacyTransactionAt=1;
  const first=await writer.manageRequestRecovery(requestRecoveryCommand("drain",{operationId}));
  assert.equal(first.state,"processing");
  assert.equal(JSON.parse(db.value(legacyPath("swim_requests")).value)[REQUEST_ID].status,"pending");

  db.failLegacyTransactionAt=0;
  clock.advance(5*60*1000);
  const second=await writer.manageRequestRecovery(requestRecoveryCommand("drain",{operationId}));
  const third=await writer.manageRequestRecovery(requestRecoveryCommand("drain",{operationId}));
  const requestValue=JSON.parse(db.value(legacyPath("swim_requests")).value)[REQUEST_ID];
  assert.equal(second.state,"completed");
  assert.equal(third.state,"completed");
  assert.equal(requestValue.status,"accepted");
  assert.equal(requestValue.counter,1);
  assert.equal(db.value(requestRecoveryPath(operationId)).attempts,2);
});

test("concurrent drain calls respect one live lease and one logical completion",async()=>{
  const operationId=operationUuid(8);
  const db=new FakeFirestore({
    [manifestPath(operationId)]:committedManifest(operationId),
    [legacyPath("swim_requests")]:legacyRequests({[REQUEST_ID]:{status:"pending"}}),
  });
  const writer=createWriter(db);
  await writer.manageRequestRecovery(requestRecoveryCommand("stage",{operationId}));
  const [left,right]=await Promise.all([
    writer.manageRequestRecovery(requestRecoveryCommand("drain",{operationId})),
    writer.manageRequestRecovery(requestRecoveryCommand("drain",{operationId})),
  ]);

  assert.ok([left.state,right.state].includes("completed"));
  assert.equal(db.value(requestRecoveryPath(operationId)).attempts,1);
  assert.equal(JSON.parse(db.value(legacyPath("swim_requests")).value)[REQUEST_ID].status,"accepted");
});

test("malformed stored request recovery records are rejected and scrubbed server-side",async()=>{
  const operationId=operationUuid(9);
  const db=new FakeFirestore({
    [requestRecoveryPath(operationId)]:{
      version:1,branchId:BRANCH,operationId,state:"staged",attempts:0,
      intents:[{requestId:REQUEST_ID,patch:{status:"accepted",name:"Private Name"}}],
    },
  });
  const summary=await createWriter(db).recoverRequestPatches({branchId:BRANCH});
  const stored=db.value(requestRecoveryPath(operationId));

  assert.equal(summary.rejected,1);
  assert.equal(stored.state,"rejected");
  assert.equal(stored.code,"invalid-record");
  assert.equal(JSON.stringify(stored).includes("Private Name"),false);

  const repeated=await createWriter(db).manageRequestRecovery(requestRecoveryCommand("drain",{operationId}));
  assert.equal(repeated.state,"rejected");
  assert.deepEqual(db.value(requestRecoveryPath(operationId)),stored);
});

test("a corrupt queue document with a noncanonical operation key is removed",async()=>{
  const operationId="01012345678";
  const db=new FakeFirestore({
    [requestRecoveryPath(operationId)]:{
      version:1,branchId:BRANCH,operationId,linkedV2OperationId:operationId,
      operationType:"absence-cancel",intents:[],intentFingerprint:"corrupt",
      state:"staged",attempts:0,primaryChecks:0,createdAt:NOW.toISOString(),
      updatedAt:NOW.toISOString(),expiresAt:new Date(NOW.getTime()+60000),code:"",
    },
  });

  const summary=await createWriter(db).recoverRequestPatches({branchId:BRANCH});

  assert.equal(summary.rejected,1);
  assert.equal(db.value(requestRecoveryPath(operationId)),undefined);
});

test("queue state validation rejects impossible completed and processing records",async()=>{
  for(const [index,state] of [[20,"completed"],[21,"processing"]]){
    const operationId=operationUuid(index);
    const db=new FakeFirestore();
    const writer=createWriter(db);
    await writer.manageRequestRecovery(requestRecoveryCommand("stage",{operationId}));
    const corrupt=db.value(requestRecoveryPath(operationId));
    corrupt.state=state;
    if(state==="completed") corrupt.completedAt="";
    if(state==="processing"){corrupt.leaseId="";corrupt.leaseUntil="";}
    db.docs.set(requestRecoveryPath(operationId),corrupt);

    const result=await writer.manageRequestRecovery(requestRecoveryCommand("drain",{operationId}));
    assert.equal(result.state,"rejected");
    assert.equal(db.value(requestRecoveryPath(operationId)).code,"invalid-record");
  }
});

test("rejected queue state still enforces bounded counters and complete timestamps",async()=>{
  const operationId=operationUuid(24);
  const db=new FakeFirestore({
    [requestRecoveryPath(operationId)]:{
      version:1,branchId:BRANCH,operationId,linkedV2OperationId:operationId,state:"rejected",
      attempts:99,primaryChecks:0,createdAt:"not-a-time",updatedAt:NOW.toISOString(),
      expiresAt:"2026-08-18T03:00:00.000Z",rejectedAt:NOW.toISOString(),code:"invalid-record",
    },
  });
  await createWriter(db).manageRequestRecovery(requestRecoveryCommand("drain",{operationId}));
  const scrubbed=db.value(requestRecoveryPath(operationId));
  assert.equal(scrubbed.attempts,0);
  assert.equal(Number.isFinite(Date.parse(scrubbed.createdAt)),true);
});

test("terminal exhausted errors cannot starve active recovery candidates",async()=>{
  const exhaustedId=operationUuid(22);
  const activeId=operationUuid(23);
  const db=new FakeFirestore({
    [manifestPath(activeId)]:committedManifest(activeId),
    [legacyPath("swim_requests")]:legacyRequests({[REQUEST_ID]:{status:"pending"}}),
  });
  const writer=createWriter(db);
  await writer.manageRequestRecovery(requestRecoveryCommand("stage",{operationId:exhaustedId}));
  await writer.manageRequestRecovery(requestRecoveryCommand("stage",{operationId:activeId}));
  const exhausted=db.value(requestRecoveryPath(exhaustedId));
  exhausted.state="error";
  exhausted.attempts=5;
  exhausted.code="retry-exhausted";
  exhausted.failedAt=NOW.toISOString();
  exhausted.updatedAt="2026-08-11T02:00:00.000Z";
  delete exhausted.leaseId;
  delete exhausted.leaseUntil;
  delete exhausted.completedAt;
  delete exhausted.conflictAt;
  delete exhausted.cancelledAt;
  db.docs.set(requestRecoveryPath(exhaustedId),exhausted);

  const summary=await writer.recoverRequestPatches({branchId:BRANCH,limit:1});
  assert.equal(summary.completed,1);
  assert.equal(db.value(requestRecoveryPath(activeId)).state,"completed");
  assert.equal(db.value(requestRecoveryPath(exhaustedId)).attempts,5);
});

test("request recovery uses ordered pagination instead of leaving later active records stranded",async()=>{
  const requests={};
  const db=new FakeFirestore({[legacyPath("swim_requests")]:legacyRequests(requests)});
  const writer=createWriter(db);
  for(let index=0;index<5;index+=1){
    const operationId=operationUuid(30+index);
    const requestId=productionRequestId(30+index);
    requests[requestId]={status:"pending"};
    db.docs.set(legacyPath("swim_requests"),legacyRequests(requests));
    db.docs.set(manifestPath(operationId),committedManifest(operationId));
    await writer.manageRequestRecovery(requestRecoveryCommand("stage",{
      operationId,intents:[{requestId,expectedStatus:"pending",expectedVersion:null,
        patch:{status:"accepted",processedAt:NOW.toISOString()}}],
    }));
  }

  const summary=await writer.recoverRequestPatches({branchId:BRANCH,limit:2});
  const stored=JSON.parse(db.value(legacyPath("swim_requests")).value);
  assert.equal(summary.completed,5);
  assert.equal(Object.values(stored).every(request=>request.status==="accepted"),true);
});

test("expired terminal recovery records are cleaned in bounded retention batches",async()=>{
  const expiredId=operationUuid(40);
  const retainedId=operationUuid(41);
  const db=new FakeFirestore();
  const writer=createWriter(db);
  for(const operationId of [expiredId,retainedId]){
    await writer.manageRequestRecovery(requestRecoveryCommand("stage",{operationId}));
    const record=db.value(requestRecoveryPath(operationId));
    record.state="completed";
    record.code="";
    record.completedAt=NOW.toISOString();
    record.expiresAt=operationId===expiredId?"2026-08-11T02:59:59.000Z":"2026-08-12T03:00:00.000Z";
    delete record.leaseId;
    delete record.leaseUntil;
    delete record.conflictAt;
    delete record.cancelledAt;
    db.docs.set(requestRecoveryPath(operationId),record);
  }

  const summary=await writer.recoverRequestPatches({branchId:BRANCH,cleanupLimit:1});
  assert.equal(summary.cleaned,1);
  assert.equal(db.value(requestRecoveryPath(expiredId)),undefined);
  assert.equal(db.value(requestRecoveryPath(retainedId)).state,"completed");
});

test("operational status exposes bounded request recovery counts by active and terminal state",async()=>{
  const stagedId=operationUuid(42);
  const completedId=operationUuid(43);
  const db=new FakeFirestore({[runtimePath()]:runtime()});
  const writer=createWriter(db);
  await writer.manageRequestRecovery(requestRecoveryCommand("stage",{operationId:stagedId}));
  await writer.manageRequestRecovery(requestRecoveryCommand("stage",{operationId:completedId}));
  const completed=db.value(requestRecoveryPath(completedId));
  completed.state="completed";
  completed.completedAt=NOW.toISOString();
  delete completed.leaseId;
  delete completed.leaseUntil;
  delete completed.conflictAt;
  delete completed.cancelledAt;
  db.docs.set(requestRecoveryPath(completedId),completed);

  const status=await writer.readOperationalStatus(BRANCH);
  assert.equal(status.requestRecoveryPendingCount,1);
  assert.equal(status.requestRecoveryStagedCount,1);
  assert.equal(status.requestRecoveryWaitingCount,0);
  assert.equal(status.requestRecoveryProcessingCount,0);
  assert.equal(status.requestRecoveryCompletedCount,1);
  assert.equal(status.requestRecoveryErrorCount,0);
  assert.equal(status.requestRecoveryConflictCount,0);
  assert.equal(status.requestRecoveryCancelledCount,0);
  assert.equal(status.requestRecoveryRejectedCount,0);
});

test("authenticated recovery status action exposes counts without queue payloads",async()=>{
  const operationId=operationUuid(44);
  const db=new FakeFirestore({[runtimePath()]:runtime()});
  const writer=createWriter(db);
  await writer.manageRequestRecovery(requestRecoveryCommand("stage",{operationId}));

  const status=await writer.manageRequestRecovery(requestRecoveryCommand("status"));
  assert.equal(status.state,"status");
  assert.equal(status.counts.pending,1);
  assert.deepEqual(status.counts,{
    staged:1,waiting:0,processing:0,pending:1,error:0,completed:0,conflict:0,cancelled:0,rejected:0,
  });
  assert.equal(JSON.stringify(status).includes(REQUEST_ID),false);
});

test("a duplicate operation id returns the stored result without applying twice",async()=>{
  const db=new FakeFirestore({[runtimePath()]:runtime()});
  const writer=createWriter(db);
  const first=await writer.mutate(request());
  const second=await writer.mutate(request());

  assert.equal(first.operationId,"op_1");
  assert.deepEqual(second,first);
  assert.equal(db.writeCountFor("op_1"),1);
  assert.equal(db.value(runtimePath()).revision,32);
});

test("epoch generation and revision preconditions fail before V2 writes",async()=>{
  for(const [name,stored] of [
    ["epoch",runtime({epoch:5})],
    ["generation",runtime({generationId:"gen_2"})],
    ["revision",runtime({revision:32})],
  ]){
    const db=new FakeFirestore({[runtimePath()]:stored});
    await assert.rejects(()=>createWriter(db).mutate(request()),error=>error.code==="failed-precondition",name);
    assert.equal(db.value(generationPath("placements","placement-new")),undefined,name);
  }
});

test("a target document newer than beforeRevision is rejected",async()=>{
  const target=generationPath("placements","placement-new");
  const db=new FakeFirestore({
    [runtimePath()]:runtime(),
    [target]:{...change().value,operationalRevision:32},
  });
  await assert.rejects(()=>createWriter(db).mutate(request()),error=>error.code==="failed-precondition");
  assert.equal(db.value(runtimePath()).revision,31);
  assert.equal(db.value(target).operationalRevision,32);
});

test("real model planning ignores storage metadata and changes only the requested legacy view",async()=>{
  const model=globalThis.SCV2OperationalModel;
  const schema=globalThis.SCScheduleSchemaV2;
  const emptyCollections={};
  Object.values(model.DOMAIN_COLLECTIONS).flat().forEach(name=>{emptyCollections[name]=[];});
  const emptyRoot=model.legacyRootFromCollections({
    branchId:BRANCH,generationId:GENERATION,collections:emptyCollections,
  });
  const baseline=schema.diagnoseLegacyRoot(BRANCH,emptyRoot).conversion;
  const initial={[runtimePath()]:runtime()};
  Object.entries(baseline).filter(([,rows])=>Array.isArray(rows)).forEach(([collection,rows])=>{
    rows.forEach(row=>{
      initial[generationPath(collection,row.id)]={
        ...clone(row),branchId:BRANCH,generationId:GENERATION,
        operationalRevision:31,lastOperationId:"baseline",
      };
    });
  });
  const db=new FakeFirestore(initial);
  const mutation=policy.validateMutationRequest(request({
    operationId:"op_real_plan",operationType:"sort-teachers",keys:["swim_teachers"],
    nextValues:{swim_teachers:[{name:"Teacher One"}]},
  }).data);

  const plan=await operational.deriveChanges({db,request:mutation});

  assert.equal(plan.changes.length,1);
  assert.equal(plan.changes[0].collection,"teacherProfiles");
  assert.equal(plan.changes[0].type,"set");
});

test("more than 400 document changes use fenced chunks of at most 400 changes",async()=>{
  const oldPath=generationPath("placements","placement-old");
  const db=new FakeFirestore({
    [runtimePath()]:runtime(),
    [oldPath]:{id:"placement-old",operationalRevision:31},
  });
  const changes=Array.from({length:801},(_,index)=>change(`placement-${index}`));
  changes[800]={type:"delete",collection:"placements",id:"placement-old"};
  const result=await operational.commitV2Mutation({
    db,request:request({operationId:"op_chunks"}).data,
    actor:{email:"developer@scswim.local",role:"developer"},changes,
    now:NOW,serverTimestamp:()=>"server-time",fingerprint:"fingerprint-chunks",
  });

  assert.equal(result.changeCount,801);
  assert.equal(result.setCount,800);
  assert.equal(result.deleteCount,1);
  const chunks=db.transactions.filter(attempt=>attempt.operations.some(operation=>operation.ref.path.includes("/placements/")));
  assert.deepEqual(chunks.map(attempt=>attempt.operations.filter(operation=>operation.ref.path.includes("/placements/")).length),[400,400,1]);
  const manifest=db.value(manifestPath("op_chunks"));
  assert.equal(manifest.status,"committed");
  assert.equal(manifest.completedChunks,3);
  assert.equal(manifest.changedDocumentRefs.length,800);
  assert.deepEqual(manifest.deletedDocumentRefs,["placements/placement-old"]);
  assert.equal(db.value(oldPath),undefined);
});

test("a resumed fenced operation preserves its original manifest counts",async()=>{
  const operationId="op_resume";
  const fingerprint="fingerprint-resume";
  const db=new FakeFirestore({
    [runtimePath()]:runtime({activeOperationId:operationId,activeOperationRevision:32}),
    [manifestPath(operationId)]:{
      operationId,branchId:BRANCH,generationId:GENERATION,
      expectedEpoch:4,beforeRevision:31,resultingRevision:32,
      operationType:"move-student",keys:["swim_students"],removedKeys:[],
      requestFingerprint:fingerprint,status:"committing",recoveryState:"blocked",
      changeCount:801,setCount:800,deleteCount:1,
      changedDocumentRefs:["placements/already-written"],
      deletedDocumentRefs:["placements/already-deleted"],
      chunkCount:3,completedChunks:2,
    },
  });

  const result=await operational.commitV2Mutation({
    db,request:request({operationId}).data,
    actor:{email:"developer@scswim.local",role:"developer"},
    changes:[change("remaining")],now:NOW,serverTimestamp:()=>"server-time",fingerprint,
  });

  assert.equal(result.changeCount,801);
  assert.equal(result.setCount,800);
  assert.equal(result.deleteCount,1);
  assert.deepEqual(db.value(manifestPath(operationId)).deletedDocumentRefs,["placements/already-deleted"]);
});

test("retry after the last V2 chunk preserves the original immutable manifest summary",async()=>{
  const operationId="op_finalize_retry";
  const fingerprint="fingerprint-finalize-retry";
  const db=new FakeFirestore({[runtimePath()]:runtime()});
  db.failTransactionAt=2;

  await assert.rejects(()=>operational.commitV2Mutation({
    db,request:request({operationId}).data,
    actor:{email:"developer@scswim.local",role:"developer"},
    changes:[change("written-before-finalize")],now:NOW,
    serverTimestamp:()=>"server-time",fingerprint,
  }),error=>error.code==="unavailable");
  const interrupted=db.value(manifestPath(operationId));
  assert.equal(interrupted.status,"committing");
  assert.equal(interrupted.completedChunks,1);
  assert.equal(interrupted.chunkCount,1);

  db.failTransactionAt=0;
  const result=await operational.commitV2Mutation({
    db,request:request({operationId}).data,
    actor:{email:"developer@scswim.local",role:"developer"},changes:[],now:NOW,
    serverTimestamp:()=>"server-time",fingerprint,
  });
  const manifest=db.value(manifestPath(operationId));
  assert.equal(result.changeCount,1);
  assert.equal(result.setCount,1);
  assert.equal(manifest.chunkCount,1);
  assert.equal(manifest.completedChunks,1);
  assert.deepEqual(manifest.changedDocumentRefs,["placements/written-before-finalize"]);
});

test("oversized V2 document IDs values and manifests fail before the first write",async()=>{
  const cases=[
    ["document-id",[change("가".repeat(200))]],
    ["document-value",[{...change("oversized-value"),value:{payload:"x".repeat(950000)}}]],
    ["manifest",Array.from({length:2000},(_,index)=>change(`${String(index).padStart(4,"0")}-${"x".repeat(470)}`))],
  ];
  for(const [name,changes] of cases){
    const db=new FakeFirestore({[runtimePath()]:runtime()});
    await assert.rejects(()=>operational.commitV2Mutation({
      db,request:request({operationId:`op_size_${name}`}).data,
      actor:{email:"developer@scswim.local",role:"developer"},changes,now:NOW,
      serverTimestamp:()=>"server-time",fingerprint:`fingerprint-${name}`,
    }),error=>["invalid-argument","resource-exhausted"].includes(error.code),name);
    assert.equal(db.transactions.length,0,name);
    assert.equal(db.writeCountFor(`op_size_${name}`),0,name);
  }
});

test("a 1609-byte encoded legacy key is rejected before planning or any V2 write",async()=>{
  const key=`swim_bt_attendance_${"a".repeat(1590)}`;
  assert.equal(Buffer.byteLength(encodeURIComponent(key).replace(/\./g,"%2E"),"utf8"),1609);
  const db=new FakeFirestore({[runtimePath()]:runtime()});
  let planningCalls=0;
  const writer=createWriter(db,{
    deriveChanges:async()=>{
      planningCalls+=1;
      return {changes:[change("must-not-write")],collections:{},legacyValues:{[key]:{}}};
    },
  });

  await assert.rejects(()=>writer.mutate(request({
    operationId:"op_oversized_legacy_key",operationType:"attendance",
    keys:[key],nextValues:{[key]:{}},
  })),error=>error.code==="invalid-argument");
  assert.equal(planningCalls,0);
  assert.equal(db.transactions.length,0);
  assert.equal(db.value(manifestPath("op_oversized_legacy_key")),undefined);
  assert.equal(db.value(generationPath("placements","must-not-write")),undefined);
});

test("V1 mirror failure preserves the V2 commit and leaves recoverable redacted state",async()=>{
  const privateName="Private Student Name";
  const privatePhone="01012345678";
  const db=new FakeFirestore({[runtimePath()]:runtime()});
  db.failLegacyTransactionAt=1;
  const writer=createWriter(db,{resolveRecoveryValues:async()=>({swim_students:JSON.stringify([{n:privateName,p:privatePhone}])})});
  const result=await writer.mutate(request({operationId:"op_mirror_error"}));

  assert.equal(result.committed,true);
  assert.equal(result.recoveryState,"error");
  assert.equal(db.value(runtimePath()).revision,32);
  assert.equal(db.value(generationPath("placements","placement-new")).lastOperationId,"op_mirror_error");
  const manifest=db.value(manifestPath("op_mirror_error"));
  assert.equal(manifest.status,"committed");
  assert.equal(manifest.recoveryState,"error");
  assert.equal(manifest.recoveryAttempts,1);
  const serialized=JSON.stringify(manifest.diagnostic);
  assert.equal(serialized.includes(privateName),false);
  assert.equal(serialized.includes(privatePhone),false);
});

test("recovery retries update V1 with FirestoreKVRoot encoding and delete stale chunks",async()=>{
  const operationId="op_recover";
  const db=new FakeFirestore({
    [runtimePath()]:runtime({revision:32}),
    [manifestPath(operationId)]:{
      operationId,branchId:BRANCH,generationId:GENERATION,status:"committed",
      resultingRevision:32,keys:["swim_students"],removedKeys:[],recoveryState:"error",recoveryAttempts:1,
    },
    "scheduleStores/yongam/kv/swim_students":{key:"swim_students",chunked:true,chunkCount:3,valueType:"string"},
    "scheduleStores/yongam/kv/swim_students/chunks/0000":{text:"old-a"},
    "scheduleStores/yongam/kv/swim_students/chunks/0001":{text:"old-b"},
    "scheduleStores/yongam/kv/swim_students/chunks/0002":{text:"old-c"},
  });
  const writer=createWriter(db);
  const summary=await writer.recoverOperationalMirrors({perBranchLimit:5});

  assert.equal(summary.applied,1);
  assert.deepEqual(db.value("scheduleStores/yongam/kv/swim_students"),{
    key:"swim_students",value:"[]",chunked:false,updatedAt:"server-time",
  });
  assert.equal(db.value("scheduleStores/yongam/kv/swim_students/chunks/0000"),undefined);
  assert.equal(db.value("scheduleStores/yongam/kv/swim_students/chunks/0002"),undefined);
  assert.equal(db.value(manifestPath(operationId)).recoveryState,"applied");
});

test("out-of-order recovery never applies an older revision over a newer branch mirror",async()=>{
  const db=new FakeFirestore({
    [runtimePath()]:runtime({revision:33}),
    [manifestPath("op_old")]:{
      operationId:"op_old",branchId:BRANCH,generationId:GENERATION,status:"committed",
      resultingRevision:32,keys:["swim_students"],removedKeys:[],recoveryState:"pending",recoveryAttempts:0,
    },
    [manifestPath("op_new")]:{
      operationId:"op_new",branchId:BRANCH,generationId:GENERATION,status:"committed",
      resultingRevision:33,keys:["swim_students"],removedKeys:[],recoveryState:"pending",recoveryAttempts:0,
    },
  });
  const recover=operationId=>operational.applyV1Recovery({
    db,branchId:BRANCH,operationId,now:NOW,serverTimestamp:()=>"server-time",
    clock:()=>NOW,resolveRecoveryValues:async()=>({swim_students:"op_new"}),
  });

  assert.equal((await recover("op_new")).recoveryState,"applied");
  const stale=await recover("op_old");

  assert.notEqual(stale.recoveryState,"applied");
  assert.equal(db.value("scheduleStores/yongam/kv/swim_students").value,"op_new");
  assert.equal(db.value(manifestPath("op_old")).recoveryState,"superseded");
  assert.equal(db.value(recoveryFencePath()).appliedRevision,33);
});

test("a newer disjoint-key mirror does not discard older pending key coverage",async()=>{
  const db=new FakeFirestore({
    [runtimePath()]:runtime({revision:33}),
    [manifestPath("op_key_a_old")]:{
      operationId:"op_key_a_old",branchId:BRANCH,generationId:GENERATION,status:"committed",
      resultingRevision:32,keys:["swim_students"],removedKeys:[],recoveryState:"error",recoveryAttempts:1,
    },
    [manifestPath("op_key_b_new")]:{
      operationId:"op_key_b_new",branchId:BRANCH,generationId:GENERATION,status:"committed",
      resultingRevision:33,keys:["swim_mark"],removedKeys:[],recoveryState:"pending",recoveryAttempts:0,
    },
  });
  const clock=mutableClock();
  const recover=(operationId,values)=>operational.applyV1Recovery({
    db,branchId:BRANCH,operationId,clock:clock.now,now:clock.now(),
    serverTimestamp:()=>"server-time",resolveRecoveryValues:async()=>values,
  });

  assert.equal((await recover("op_key_b_new",{swim_mark:"B-current"})).recoveryState,"applied");
  const older=await recover("op_key_a_old",{swim_students:"A-current"});

  assert.equal(older.recoveryState,"superseded");
  assert.equal(db.value(legacyPath("swim_students")).value,"A-current");
  assert.equal(db.value(legacyPath("swim_mark")).value,"B-current");
  assert.equal(db.value(manifestPath("op_key_a_old")).recoveryCoveredAtRevision,33);
});

test("overlapping older coverage is rebuilt from the current fenced V2 revision",async()=>{
  const db=new FakeFirestore({
    [runtimePath()]:runtime({revision:33}),
    [manifestPath("op_overlap_old")]:{
      operationId:"op_overlap_old",branchId:BRANCH,generationId:GENERATION,status:"committed",
      resultingRevision:32,keys:["swim_students"],removedKeys:[],recoveryState:"error",recoveryAttempts:1,
    },
    [manifestPath("op_overlap_new")]:{
      operationId:"op_overlap_new",branchId:BRANCH,generationId:GENERATION,status:"committed",
      resultingRevision:33,keys:["swim_students"],removedKeys:[],recoveryState:"pending",recoveryAttempts:0,
    },
  });
  const clock=mutableClock();
  const recover=(operationId,legacyValues)=>operational.applyV1Recovery({
    db,branchId:BRANCH,operationId,clock:clock.now,now:clock.now(),
    serverTimestamp:()=>"server-time",...(legacyValues?{legacyValues}:{}),
    resolveRecoveryValues:async()=>({swim_students:"current-revision-value"}),
  });
  await recover("op_overlap_new");
  const writesBeforeOlder=db.legacyTransactions;

  const older=await recover("op_overlap_old",{swim_students:"stale-planned-value"});

  assert.equal(older.recoveryState,"superseded");
  assert.equal(db.legacyTransactions,writesBeforeOlder+1);
  assert.equal(db.value(legacyPath("swim_students")).value,"current-revision-value");
  assert.equal(db.value(manifestPath("op_overlap_old")).recoveryCoveredAtRevision,33);
});

test("multi-key partial failure retries every uncovered key from the current revision",async()=>{
  const oldOperation="op_partial_old";
  const db=new FakeFirestore({
    [runtimePath()]:runtime({revision:32}),
    [manifestPath(oldOperation)]:{
      operationId:oldOperation,branchId:BRANCH,generationId:GENERATION,status:"committed",
      resultingRevision:32,keys:["swim_students","swim_mark"],removedKeys:[],
      recoveryState:"pending",recoveryAttempts:0,
    },
  });
  const clock=mutableClock();
  db.failLegacyTransactionAt=2;
  const first=await operational.applyV1Recovery({
    db,branchId:BRANCH,operationId:oldOperation,clock:clock.now,now:clock.now(),
    serverTimestamp:()=>"server-time",
    resolveRecoveryValues:async()=>({swim_students:"A-old",swim_mark:"B-old"}),
  });
  assert.equal(first.recoveryState,"error");
  assert.equal(db.value(legacyPath("swim_students")).value,"A-old");
  assert.equal(db.value(legacyPath("swim_mark")),undefined);

  db.failLegacyTransactionAt=0;
  db.docs.set(runtimePath(),runtime({revision:33}));
  db.docs.set(manifestPath("op_partial_new"),{
    operationId:"op_partial_new",branchId:BRANCH,generationId:GENERATION,status:"committed",
    resultingRevision:33,keys:["swim_students"],removedKeys:[],recoveryState:"pending",recoveryAttempts:0,
  });
  await operational.applyV1Recovery({
    db,branchId:BRANCH,operationId:"op_partial_new",clock:clock.now,now:clock.now(),
    serverTimestamp:()=>"server-time",
    resolveRecoveryValues:async()=>({swim_students:"A-current"}),
  });

  const retried=await operational.applyV1Recovery({
    db,branchId:BRANCH,operationId:oldOperation,clock:clock.now,now:clock.now(),
    serverTimestamp:()=>"server-time",
    resolveRecoveryValues:async()=>({swim_students:"A-current",swim_mark:"B-current"}),
  });
  assert.equal(retried.recoveryState,"superseded");
  assert.equal(db.value(legacyPath("swim_students")).value,"A-current");
  assert.equal(db.value(legacyPath("swim_mark")).value,"B-current");
  assert.equal(db.value(manifestPath(oldOperation)).recoveryCoveredAtRevision,33);
});

test("a live worker renews both leases and cannot be reclaimed after the original expiry",async()=>{
  const operationId="op_live_lease";
  const db=new FakeFirestore({
    [runtimePath()]:runtime({revision:32}),
    [manifestPath(operationId)]:{
      operationId,branchId:BRANCH,generationId:GENERATION,status:"committed",resultingRevision:32,
      keys:["swim_students","swim_mark"],removedKeys:[],recoveryState:"pending",recoveryAttempts:0,
    },
  });
  const clock=mutableClock();
  let releaseFirstKey;
  let firstKeyReached;
  const firstKey=new Promise(resolve=>{firstKeyReached=resolve;});
  const waitForRelease=new Promise(resolve=>{releaseFirstKey=resolve;});
  let paused=false;
  db.afterTransaction=async attempt=>{
    if(!paused&&attempt.operations.some(operation=>operation.ref.path.startsWith("scheduleStores/"))){
      paused=true;
      firstKeyReached();
      await waitForRelease;
    }
  };
  const firstPromise=operational.applyV1Recovery({
    db,branchId:BRANCH,operationId,clock:clock.now,now:clock.now(),serverTimestamp:()=>"server-time",
    resolveRecoveryValues:async()=>{
      clock.advance(3*60*1000);
      return {swim_students:"worker",swim_mark:"worker"};
    },
  });
  await firstKey;
  assert.equal(Date.parse(db.value(manifestPath(operationId)).recoveryLeaseUntil),NOW.getTime()+7*60*1000);
  assert.equal(Date.parse(db.value(recoveryFencePath()).recoveryLeaseUntil),NOW.getTime()+7*60*1000);
  clock.advance(2*60*1000);

  const contender=await operational.applyV1Recovery({
    db,branchId:BRANCH,operationId,clock:clock.now,now:clock.now(),serverTimestamp:()=>"server-time",
    resolveRecoveryValues:async()=>({swim_students:"intruder",swim_mark:"intruder"}),
  });
  releaseFirstKey();
  const firstResult=await firstPromise;

  assert.equal(contender.recoveryState,"processing");
  assert.equal(firstResult.recoveryState,"applied");
  assert.equal(db.value(legacyPath("swim_students")).value,"worker");
  assert.equal(db.value(legacyPath("swim_mark")).value,"worker");
  const renewalTransactions=db.transactions.filter(attempt=>{
    const paths=attempt.operations.map(operation=>operation.ref.path);
    return paths.includes(manifestPath(operationId))&&paths.includes(recoveryFencePath())&&
      attempt.operations.some(operation=>operation.value?.recoveryState==="processing"&&operation.value?.recoveryLeaseUntil);
  });
  assert.ok(renewalTransactions.length>=4);
});

test("lease ownership loss aborts remaining keys and finalization without stale writes",async()=>{
  const operationId="op_lost_lease";
  const db=new FakeFirestore({
    [runtimePath()]:runtime({revision:32}),
    [manifestPath(operationId)]:{
      operationId,branchId:BRANCH,generationId:GENERATION,status:"committed",resultingRevision:32,
      keys:["swim_students","swim_mark"],removedKeys:[],recoveryState:"pending",recoveryAttempts:0,
    },
  });
  const clock=mutableClock();
  let replaced=false;
  db.afterTransaction=async attempt=>{
    if(replaced||!attempt.operations.some(operation=>operation.ref.path.startsWith("scheduleStores/"))) return;
    replaced=true;
    const leaseUntil=new Date(clock.now().getTime()+4*60*1000).toISOString();
    db.docs.set(manifestPath(operationId),{
      ...db.value(manifestPath(operationId)),recoveryState:"processing",
      recoveryLeaseId:"replacement-lease",recoveryLeaseUntil:leaseUntil,
    });
    db.docs.set(recoveryFencePath(),{
      ...db.value(recoveryFencePath()),operationId,recoveryLeaseId:"replacement-lease",
      recoveryLeaseUntil:leaseUntil,
    });
  };

  const result=await operational.applyV1Recovery({
    db,branchId:BRANCH,operationId,clock:clock.now,now:clock.now(),serverTimestamp:()=>"server-time",
    resolveRecoveryValues:async()=>({swim_students:"first",swim_mark:"must-not-write"}),
  });

  assert.equal(result.recoveryState,"processing");
  assert.equal(db.value(legacyPath("swim_students")).value,"first");
  assert.equal(db.value(legacyPath("swim_mark")),undefined);
  const manifest=db.value(manifestPath(operationId));
  assert.equal(manifest.recoveryLeaseId,"replacement-lease");
  assert.equal(manifest.recoveryState,"processing");
  assert.equal(manifest.recoveryAppliedAt,undefined);
});

test("a concurrent stale recovery revalidates the runtime before any V1 write or finalize",async()=>{
  let releaseOld;
  let oldResolved;
  const oldReachedResolver=new Promise(resolve=>{oldResolved=resolve;});
  const waitForRelease=new Promise(resolve=>{releaseOld=resolve;});
  const db=new FakeFirestore({
    [runtimePath()]:runtime({revision:32}),
    [manifestPath("op_old_concurrent")]:{
      operationId:"op_old_concurrent",branchId:BRANCH,generationId:GENERATION,status:"committed",
      resultingRevision:32,keys:["swim_students"],removedKeys:[],recoveryState:"pending",recoveryAttempts:0,
    },
  });
  const oldPromise=operational.applyV1Recovery({
    db,branchId:BRANCH,operationId:"op_old_concurrent",now:NOW,serverTimestamp:()=>"server-time",
    resolveRecoveryValues:async()=>{oldResolved();await waitForRelease;return {swim_students:"old"};},
  });
  await oldReachedResolver;
  db.docs.set(runtimePath(),runtime({revision:33}));
  db.docs.set(manifestPath("op_new_concurrent"),{
    operationId:"op_new_concurrent",branchId:BRANCH,generationId:GENERATION,status:"committed",
    resultingRevision:33,keys:["swim_students"],removedKeys:[],recoveryState:"pending",recoveryAttempts:0,
  });
  const blocked=await operational.applyV1Recovery({
    db,branchId:BRANCH,operationId:"op_new_concurrent",now:NOW,serverTimestamp:()=>"server-time",
    resolveRecoveryValues:async()=>({swim_students:"new"}),
  });
  assert.equal(blocked.recoveryState,"pending");
  releaseOld();
  const stale=await oldPromise;
  assert.notEqual(stale.recoveryState,"applied");
  assert.equal(db.value("scheduleStores/yongam/kv/swim_students"),undefined);
  assert.notEqual(db.value(manifestPath("op_old_concurrent")).recoveryState,"applied");
});

test("an active branch recovery fence blocks a new V2 mutation before document writes",async()=>{
  const db=new FakeFirestore({
    [runtimePath()]:runtime({revision:32}),
    [recoveryFencePath()]:{
      branchId:BRANCH,operationId:"op_recovering",resultingRevision:32,
      recoveryLeaseId:"persistent-lease",
      recoveryLeaseUntil:new Date(NOW.getTime()+60000).toISOString(),
    },
  });
  await assert.rejects(()=>operational.commitV2Mutation({
    db,request:request({operationId:"op_blocked_by_recovery",beforeRevision:32}).data,
    actor:{email:"developer@scswim.local",role:"developer"},changes:[change("blocked")],
    now:NOW,serverTimestamp:()=>"server-time",fingerprint:"fingerprint-blocked",
  }),error=>error.code==="aborted");
  assert.equal(db.value(generationPath("placements","blocked")),undefined);
  assert.equal(db.value(runtimePath()).revision,32);
});

test("expired processing recovery leases are reclaimed and remain bounded",async()=>{
  const expired=new Date(NOW.getTime()-1000).toISOString();
  const future=new Date(NOW.getTime()+60000).toISOString();
  const db=new FakeFirestore({
    [runtimePath()]:runtime({revision:32}),
    [manifestPath("expired-processing")]:{
      operationId:"expired-processing",branchId:BRANCH,generationId:GENERATION,status:"committed",
      resultingRevision:32,keys:["swim_students"],removedKeys:[],recoveryState:"processing",
      recoveryLeaseId:"dead-worker",recoveryLeaseUntil:expired,recoveryAttempts:2,
    },
    [manifestPath("active-processing")]:{
      operationId:"active-processing",branchId:BRANCH,generationId:GENERATION,status:"committed",
      resultingRevision:32,keys:["swim_students"],removedKeys:[],recoveryState:"processing",
      recoveryLeaseId:"live-worker",recoveryLeaseUntil:future,recoveryAttempts:2,
    },
  });
  const writer=createWriter(db);
  const status=await writer.readOperationalStatus(BRANCH);
  assert.equal(status.recoveryProcessingCount,2);

  const summary=await writer.recoverOperationalMirrors({perBranchLimit:5});
  assert.equal(summary.applied,1);
  assert.equal(db.value(manifestPath("expired-processing")).recoveryState,"applied");
  assert.equal(db.value(manifestPath("expired-processing")).recoveryAttempts,3);
  assert.equal(db.value(manifestPath("active-processing")).recoveryState,"processing");

  const cappedDb=new FakeFirestore({
    [runtimePath()]:runtime({revision:32}),
    [manifestPath("capped-processing")]:{
      operationId:"capped-processing",branchId:BRANCH,generationId:GENERATION,status:"committed",
      resultingRevision:32,keys:["swim_students"],removedKeys:[],recoveryState:"processing",
      recoveryLeaseId:"last-dead-worker",recoveryLeaseUntil:expired,recoveryAttempts:9,
    },
  });
  const capped=await createWriter(cappedDb).recoverOperationalMirrors({perBranchLimit:5});
  assert.equal(capped.applied,0);
  assert.equal(cappedDb.value(manifestPath("capped-processing")).recoveryState,"error");
  assert.equal(cappedDb.value(manifestPath("capped-processing")).recoveryAttempts,10);
});

test("recovery is bounded per branch and never infers from incomplete operations",async()=>{
  const initial={[runtimePath()]:runtime({revision:38})};
  for(let index=0;index<7;index+=1){
    initial[manifestPath(`pending-${index}`)]={
      operationId:`pending-${index}`,branchId:BRANCH,generationId:GENERATION,
      status:"committed",resultingRevision:32+index,keys:["swim_students"],removedKeys:[],
      recoveryState:"pending",recoveryAttempts:0,
    };
  }
  initial[manifestPath("incomplete")]={
    operationId:"incomplete",branchId:BRANCH,generationId:GENERATION,
    status:"committing",resultingRevision:41,keys:["swim_students"],removedKeys:[],recoveryState:"pending",
  };
  const db=new FakeFirestore(initial);
  const summary=await createWriter(db).recoverOperationalMirrors({perBranchLimit:5});

  assert.deepEqual(summary,{applied:0,error:0,skipped:5});
  assert.equal(db.value(manifestPath("incomplete")).status,"committing");
  assert.equal(db.value(manifestPath("incomplete")).recoveryState,"pending");
  assert.equal([...db.docs.values()].filter(value=>
    ["applied","superseded"].includes(value?.recoveryState)
  ).length,5);
});

test("recovery skips a committed mirror while a newer V2 operation is incomplete",async()=>{
  const operationId="op_wait_for_fence";
  const db=new FakeFirestore({
    [runtimePath()]:runtime({revision:32,activeOperationId:"op_incomplete",activeOperationRevision:33}),
    [manifestPath(operationId)]:{
      operationId,branchId:BRANCH,generationId:GENERATION,status:"committed",
      resultingRevision:32,operationType:"move-student",keys:["swim_students"],
      removedKeys:[],recoveryState:"pending",recoveryAttempts:0,
    },
    [manifestPath("op_incomplete")]:{
      operationId:"op_incomplete",branchId:BRANCH,generationId:GENERATION,
      status:"committing",resultingRevision:33,recoveryState:"blocked",
    },
  });

  const summary=await operational.createOperationalWriter({
    db,now:()=>NOW,serverTimestamp:()=>"server-time",
  }).recoverOperationalMirrors({perBranchLimit:5});

  assert.deepEqual(summary,{applied:0,error:0,skipped:1});
  assert.equal(db.value(manifestPath(operationId)).recoveryState,"pending");
  assert.equal(db.value(manifestPath(operationId)).recoveryAttempts,0);
});

test("operational status reports complete pending and error recovery counts",async()=>{
  const initial={[runtimePath()]:runtime({revision:50})};
  for(let index=0;index<12;index+=1){
    initial[manifestPath(`status-pending-${index}`)]={
      status:"committed",recoveryState:"pending",resultingRevision:index,
    };
  }
  for(let index=0;index<3;index+=1){
    initial[manifestPath(`status-error-${index}`)]={
      status:"committed",recoveryState:"error",resultingRevision:20+index,
    };
  }
  for(let index=0;index<2;index+=1){
    initial[manifestPath(`status-processing-${index}`)]={
      status:"committed",recoveryState:"processing",resultingRevision:30+index,
    };
  }
  const status=await operational.readOperationalStatus({db:new FakeFirestore(initial),branchId:BRANCH});

  assert.equal(status.recoveryPendingCount,12);
  assert.equal(status.recoveryErrorCount,3);
  assert.equal(status.recoveryProcessingCount,2);
  assert.equal(status.revision,50);
});

test("diagnostics expose counts and safe classes but never request payload bodies",()=>{
  const name="Diagnostic Private Name";
  const phone="01099998888";
  const diagnostic=policy.redactedDiagnostic(
    Object.assign(new Error(`${name} ${phone}`),{code:"internal",details:{name,phone}}),
    {branchId:BRANCH,operationId:"op_redacted",operationType:"move-student",keyCount:2,changeCount:4,now:NOW,payload:{name,phone}},
  );
  assert.deepEqual(Object.keys(diagnostic).sort(),[
    "branchId","changeCount","code","detectedAt","keyCount","messageClass","operationId","operationType",
  ]);
  const serialized=JSON.stringify(diagnostic);
  assert.equal(serialized.includes(name),false);
  assert.equal(serialized.includes(phone),false);
});
