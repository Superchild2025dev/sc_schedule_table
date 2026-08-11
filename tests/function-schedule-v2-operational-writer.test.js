"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
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
  constructor(collection,filters=[],order=null,maximum=Infinity){
    this.collection=collection;this.filters=filters;this.order=order;this.maximum=maximum;
  }
  where(field,operator,value){return new QueryRef(this.collection,this.filters.concat([[field,operator,value]]),this.order,this.maximum);}
  orderBy(field,direction="asc"){return new QueryRef(this.collection,this.filters,[field,direction],this.maximum);}
  limit(maximum){return new QueryRef(this.collection,this.filters,this.order,maximum);}
  async get(){
    let docs=this.collection.directDocs().filter(doc=>this.filters.every(([field,operator,want])=>{
      const actual=doc.data()?.[field];
      if(operator==="==") return actual===want;
      if(operator==="in") return Array.isArray(want)&&want.includes(actual);
      throw new Error(`unsupported query operator ${operator}`);
    }));
    if(this.order){
      const [field,direction]=this.order;
      docs.sort((left,right)=>String(left.data()?.[field]??"").localeCompare(String(right.data()?.[field]??""))*(direction==="desc"?-1:1));
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
    this.apply(operations);
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

function runtimePath(branchId=BRANCH){return `scheduleV2/${branchId}/runtime/operational`;}
function manifestPath(operationId,branchId=BRANCH){return `scheduleV2/${branchId}/operationalMutations/${operationId}`;}
function generationPath(collection,id,branchId=BRANCH,generationId=GENERATION){
  return `scheduleV2/${branchId}/generations/${generationId}/${collection}/${id}`;
}
function runtime(overrides={}){
  return {branchId:BRANCH,mode:"v2-read",generationId:GENERATION,epoch:4,revision:31,...overrides};
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
  assert.equal(policy.authorizeMutation(teacher,request({
    operationType:"makeup",keys:["swim_mark"],nextValues:{swim_mark:{}},
  }).data).role,"teacher");
  assert.throws(()=>policy.authorizeMutation(teacher,request().data),error=>error.code==="permission-denied");
  assert.throws(()=>policy.authorizeMutation(null,request().data),error=>error.code==="unauthenticated");
});

test("strict request schema rejects unknown fields operations keys and unverified identities",()=>{
  assert.throws(()=>policy.validateMutationRequest({...request().data,payload:{name:"private"}}),error=>error.code==="invalid-argument");
  assert.throws(()=>policy.validateMutationRequest({...request().data,operationType:"invented"}),error=>error.code==="invalid-argument");
  assert.throws(()=>policy.validateMutationRequest({...request().data,keys:["customerVoice"],nextValues:{customerVoice:{}}}),error=>error.code==="invalid-argument");
  assert.throws(()=>policy.validateMutationRequest({...request().data,keys:["swim_closed"]}),error=>error.code==="invalid-argument");
  assert.throws(()=>policy.authorizeMutation(auth("developer@scswim.local",{email_verified:false}).auth,request().data),error=>error.code==="permission-denied");
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

test("V1 mirror failure preserves the V2 commit and leaves recoverable redacted state",async()=>{
  const privateName="Private Student Name";
  const privatePhone="01012345678";
  const db=new FakeFirestore({[runtimePath()]:runtime()});
  db.failBatchAt=1;
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

test("recovery is bounded per branch and never infers from incomplete operations",async()=>{
  const initial={[runtimePath()]:runtime({revision:40})};
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

  assert.equal(summary.applied,5);
  assert.equal(db.value(manifestPath("incomplete")).status,"committing");
  assert.equal(db.value(manifestPath("incomplete")).recoveryState,"pending");
  assert.equal([...db.docs.values()].filter(value=>value?.recoveryState==="applied").length,5);
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
  const status=await operational.readOperationalStatus({db:new FakeFirestore(initial),branchId:BRANCH});

  assert.equal(status.recoveryPendingCount,12);
  assert.equal(status.recoveryErrorCount,3);
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
