"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const runner=require("../functions/schedule-v2-shadow-runner.js");
const {requiredLegacyKeys}=runner;

const META=[
  {id:"regular",name:"Regular",type:"regular"},
  {id:"july",name:"July",type:"regular"},
  {id:"summer",name:"Summer",type:"bangteuk"},
];

function clone(value){
  return value===undefined?undefined:JSON.parse(JSON.stringify(value));
}

class FakeFirestore{
  constructor(initial={}){
    this.docs=new Map(Object.entries(initial).map(([path,value])=>[path,clone(value)]));
    this.commits=[];
    this.failCommitAt=0;
    this.commitError=null;
    this.failTransactionAt=0;
    this.transactionError=null;
    this.afterCommit=null;
    this.beforeTransaction=null;
    this.transactionAttempts=[];
  }
  collection(name){ return new FakeCollection(this,String(name)); }
  batch(){
    const operations=[];
    return {
      set:(ref,value)=>operations.push({type:"set",path:ref.path,value:clone(value)}),
      delete:ref=>operations.push({type:"delete",path:ref.path}),
      commit:async()=>{
        const number=this.commits.length+1;
        this.commits.push(operations.map(clone));
        if(this.failCommitAt===number){
          throw this.commitError||Object.assign(new Error("batch failed"),{code:"unavailable"});
        }
        operations.forEach(operation=>{
          if(operation.type==="delete") this.docs.delete(operation.path);
          else this.docs.set(operation.path,clone(operation.value));
        });
        if(typeof this.afterCommit==="function") this.afterCommit(number,operations,this);
      },
    };
  }
  async runTransaction(visitor){
    if(typeof this.beforeTransaction==="function") await this.beforeTransaction(this);
    const number=this.transactionAttempts.length+1;
    const attempt={reads:[],operations:[],committed:false};
    this.transactionAttempts.push(attempt);
    const transaction={
      get:async ref=>{
        attempt.reads.push(ref.path);
        return ref.get();
      },
      set:(ref,value)=>attempt.operations.push({type:"set",path:ref.path,value:clone(value)}),
      delete:ref=>attempt.operations.push({type:"delete",path:ref.path}),
    };
    const result=await visitor(transaction);
    if(this.failTransactionAt===number){
      throw this.transactionError||Object.assign(new Error("transaction failed"),{code:"unavailable"});
    }
    attempt.operations.forEach(operation=>{
      if(operation.type==="delete") this.docs.delete(operation.path);
      else this.docs.set(operation.path,clone(operation.value));
    });
    attempt.committed=true;
    if(typeof this.afterCommit==="function") this.afterCommit(number,attempt.operations,this);
    return result;
  }
}

class FakeCollection{
  constructor(db,path,filters=[]){ this.db=db;this.path=path;this.filters=filters; }
  doc(id){ return new FakeDocument(this.db,`${this.path}/${id}`); }
  where(field,operator,value){
    assert.equal(operator,"==");
    return new FakeCollection(this.db,this.path,this.filters.concat([[field,value]]));
  }
  async get(){
    const prefix=this.path+"/";
    const docs=[];
    this.db.docs.forEach((value,path)=>{
      const suffix=path.startsWith(prefix)?path.slice(prefix.length):"";
      if(!suffix||suffix.includes("/")) return;
      if(!this.filters.every(([field,expected])=>value?.[field]===expected)) return;
      docs.push(new FakeSnapshotDocument(suffix,value));
    });
    return new FakeQuerySnapshot(docs);
  }
}

class FakeDocument{
  constructor(db,path){ this.db=db;this.path=path;this.id=path.split("/").pop(); }
  collection(name){ return new FakeCollection(this.db,`${this.path}/${name}`); }
  async get(){
    const value=this.db.docs.get(this.path);
    return new FakeSnapshotDocument(this.id,value,value!==undefined);
  }
}

class FakeSnapshotDocument{
  constructor(id,value,exists=true){ this.id=id;this.exists=exists;this.value=clone(value); }
  data(){ return clone(this.value); }
}

class FakeQuerySnapshot{
  constructor(docs){ this.docs=docs;this.size=docs.length; }
  forEach(visitor){ this.docs.forEach(visitor); }
}

function legacyReader(root,calls=[]){
  return async key=>{
    calls.push(key);
    return Object.prototype.hasOwnProperty.call(root,key)?clone(root[key]):null;
  };
}

function generationRows(db,generationId,collection){
  const prefix=`scheduleV2/yongam/generations/${generationId}/${collection}/`;
  return [...db.docs.entries()]
    .filter(([path])=>path.startsWith(prefix))
    .map(([,value])=>clone(value));
}

function generationDocumentRows(db,generationId,collection){
  const prefix=`scheduleV2/yongam/generations/${generationId}/${collection}/`;
  return [...db.docs.entries()]
    .filter(([documentPath])=>documentPath.startsWith(prefix))
    .map(([documentPath,value])=>({id:documentPath.slice(prefix.length),value:clone(value)}));
}

function loadBrowserStore(){
  const context={window:{},console};
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname,"..","js","schedule-v2-store.js"),"utf8"),
    context,
  );
  return context.window.SCScheduleV2Store;
}

function fenceFor(db,leaseId){
  const ref=db.collection("scheduleV2").doc("yongam").collection("runtime").doc("scheduleSync");
  db.docs.set(ref.path,{leaseId});
  return {ref,leaseId};
}

function runFenced(input){
  if(input?.fence) return runner.runShadowSync(input);
  return runner.runShadowSync({
    ...input,fence:fenceFor(input.db,`test-${input.generationId}`),
  });
}

test("loads the exact tab context needed by an instructor change",()=>{
  assert.deepEqual(requiredLegacyKeys(["swim_inst"],META).sort(),[
    "swim_inst","swim_main_tab","swim_tab_list",
  ]);
});

test("keeps dynamic tab keys in required legacy context",()=>{
  assert.ok(requiredLegacyKeys(["swim_stu_july"],META).includes("swim_stu_july"));
});

test("loads reservation states together with current regular students",()=>{
  const required=requiredLegacyKeys(["swim_retire"],META);
  assert.ok(required.includes("swim_students"));
  assert.ok(required.includes("swim_periods"));
  for(const key of ["swim_retire","swim_enroll","swim_hyuwon","swim_move"]){
    assert.ok(required.includes(key));
  }
});

test("loads both schedule pointers when either pointer changes",()=>{
  const required=requiredLegacyKeys(["swim_main_tab"],META);
  assert.ok(required.includes("swim_main_tab"));
  assert.ok(required.includes("swim_parent_tab"));
});

test("loads metadata sibling keys together",()=>{
  assert.deepEqual(
    requiredLegacyKeys(["swim_age_year"],META).filter(key=>[
      "swim_age_year","swim_student_id_version","swim_ver",
    ].includes(key)).sort(),
    ["swim_age_year","swim_student_id_version","swim_ver"],
  );
});

test("full tab context includes course keys but excludes non-timetable data",()=>{
  const required=requiredLegacyKeys([
    "swim_tab_list","swim_attendance","swim_audit_log","swim_restore_points",
    "zz_swim_student_delete_index",
  ],META);
  for(const key of [
    "swim_students","swim_inst","swim_stu_july","swim_inst_july",
    "swim_bt_summer_stu","swim_bt_summer_inst","swim_teachers","swim_desk_notes",
  ]) assert.ok(required.includes(key),key);
  for(const key of [
    "swim_attendance","swim_audit_log","swim_restore_points","zz_swim_student_delete_index",
  ]) assert.equal(required.includes(key),false,key);
});

test("shares people across regular and vacation while retaining course-scoped records",async()=>{
  const db=new FakeFirestore();
  const root={
    swim_tab_list:META.filter(tab=>tab.id!=="july"),
    swim_main_tab:{tabId:"regular"},
    swim_students:[
      {sid:"stu_shared",n:"Alex Kim",p:"01012345678",t:"16:00",d:"mon",l:1,r:1},
    ],
    swim_bt_summer_stu:[
      {sid:"stu_shared",n:"Alex Kim",p:"01012345678",t:"10:00",d:"tue",l:2,r:1},
    ],
  };

  const result=await runFenced({
    db,branchId:"yongam",generationId:"gen_identity",
    keys:["swim_students","swim_bt_summer_stu"],
    readLegacyKey:legacyReader(root),now:new Date("2026-08-07T02:00:00.000Z"),
  });

  assert.deepEqual(result.collections,["people","enrollments","placements"]);
  assert.deepEqual(result.counts,{people:1,enrollments:2,placements:2});
  assert.equal(generationRows(db,"gen_identity","people").length,1);
  assert.equal(generationRows(db,"gen_identity","enrollments").length,2);
  assert.equal(generationRows(db,"gen_identity","placements").length,2);
  assert.deepEqual(
    new Set(generationRows(db,"gen_identity","enrollments").map(row=>row.courseType)),
    new Set(["regular","bangteuk"]),
  );
  assert.deepEqual(Object.keys(result.digests).sort(),["enrollments","people","placements"]);
  assert.equal(
    result.digests.people,
    loadBrowserStore().collectionDigest(generationDocumentRows(db,"gen_identity","people")),
  );
  assert.deepEqual(
    new Set(generationRows(db,"gen_identity","people").map(row=>row.generationId)),
    new Set(["gen_identity"]),
  );
});

test("keeps students with the same phone and different names as separate people",async()=>{
  const db=new FakeFirestore();
  const root={
    swim_tab_list:[META[0]],swim_main_tab:{tabId:"regular"},
    swim_students:[
      {n:"Alex Kim",p:"01099998888",t:"16:00",d:"mon",l:1,r:1},
      {n:"Jamie Kim",p:"01099998888",t:"17:00",d:"tue",l:1,r:1},
    ],
  };

  await runFenced({
    db,branchId:"yongam",generationId:"gen_siblings",keys:["swim_students"],
    readLegacyKey:legacyReader(root),now:new Date("2026-08-07T02:00:00.000Z"),
  });

  const people=generationRows(db,"gen_siblings","people");
  assert.equal(people.length,2);
  assert.notEqual(people[0].id,people[1].id);
});

test("moves a student by deleting the old placement and creating the new one atomically",async()=>{
  const db=new FakeFirestore();
  const root={
    swim_tab_list:[META[0]],swim_main_tab:{tabId:"regular"},
    swim_students:[
      {sid:"stu_move",n:"Move Student",p:"01011112222",t:"16:00",d:"mon",l:1,r:1},
    ],
  };
  const input={
    db,branchId:"yongam",generationId:"gen_move",keys:["swim_students"],
    readLegacyKey:legacyReader(root),now:new Date("2026-08-07T02:00:00.000Z"),
  };
  await runFenced(input);
  const oldPlacement=generationRows(db,"gen_move","placements")[0].id;
  root.swim_students[0]={...root.swim_students[0],t:"18:00",d:"wed",l:2,r:3};
  db.transactionAttempts=[];

  const result=await runFenced(input);

  const placements=generationRows(db,"gen_move","placements");
  assert.equal(placements.length,1);
  assert.notEqual(placements[0].id,oldPlacement);
  assert.equal(result.writes,1);
  assert.equal(result.deletes,1);
  const writeAttempts=db.transactionAttempts.filter(attempt=>attempt.operations.length>0);
  assert.equal(writeAttempts.length,1);
  assert.deepEqual(new Set(writeAttempts[0].operations.map(operation=>operation.type)),new Set(["set","delete"]));
});

test("updates instructor and student collection scopes in one request",async()=>{
  const db=new FakeFirestore();
  const root={
    swim_tab_list:[META[0]],swim_main_tab:{tabId:"regular"},
    swim_students:[
      {sid:"stu_both",n:"Both Student",p:"01022223333",t:"16:00",d:"mon",l:1,r:1},
    ],
    swim_inst:{"16:00/mon/1/1":"Teacher One"},
  };

  const result=await runFenced({
    db,branchId:"yongam",generationId:"gen_both",keys:["swim_inst","swim_students"],
    readLegacyKey:legacyReader(root),now:new Date("2026-08-07T02:00:00.000Z"),
  });

  assert.deepEqual(result.collections,[
    "teacherAssignments","people","enrollments","placements",
  ]);
  assert.equal(generationRows(db,"gen_both","teacherAssignments").length,1);
  assert.equal(generationRows(db,"gen_both","placements").length,1);
});

test("keeps student and instructor scopes isolated when changed tabs differ",async()=>{
  const db=new FakeFirestore();
  const root={
    swim_tab_list:[META[0],META[2]],swim_main_tab:{tabId:"regular"},
    swim_students:[
      {sid:"stu_regular",n:"Regular Student",p:"01011110000",t:"16:00",d:"mon",l:1,r:1},
    ],
    swim_inst:{"16:00/mon/1/1":"Regular Teacher"},
    swim_bt_summer_stu:[
      {sid:"stu_summer",n:"Summer Student",p:"01022220000",t:"10:00",d:"tue",l:2,r:1},
    ],
    swim_bt_summer_inst:{"10:00/tue/2/1":"Summer Teacher"},
  };
  const base={
    db,branchId:"yongam",generationId:"gen_split_scope",readLegacyKey:legacyReader(root),
    now:new Date("2026-08-07T02:00:00.000Z"),
  };
  await runFenced({
    ...base,
    keys:["swim_students","swim_inst","swim_bt_summer_stu","swim_bt_summer_inst"],
  });
  root.swim_inst={"17:00/wed/1/1":"Updated Regular Teacher"};
  root.swim_bt_summer_stu=[
    {...root.swim_bt_summer_stu[0],t:"11:00",d:"thu",l:3,r:2},
  ];

  await runFenced({
    ...base,keys:["swim_inst","swim_bt_summer_stu"],readLegacyKey:legacyReader(root),
  });

  const placements=generationRows(db,"gen_split_scope","placements");
  const assignments=generationRows(db,"gen_split_scope","teacherAssignments");
  assert.deepEqual(new Set(placements.map(row=>row.tabId)),new Set(["regular","summer"]));
  assert.deepEqual(new Set(assignments.map(row=>row.tabId)),new Set(["regular","summer"]));
  assert.equal(placements.find(row=>row.tabId==="summer").time,"11:00");
  assert.equal(assignments.find(row=>row.tabId==="regular").teacherName,"Updated Regular Teacher");
});

test("does not delete an unreferenced person during incremental sync",async()=>{
  const db=new FakeFirestore();
  const root={
    swim_tab_list:[META[0]],swim_main_tab:{tabId:"regular"},
    swim_students:[
      {sid:"stu_keep",n:"Keep Student",p:"01033334444",t:"16:00",d:"mon",l:1,r:1},
      {sid:"stu_orphan",n:"Orphan Student",p:"01055556666",t:"17:00",d:"tue",l:1,r:1},
    ],
  };
  const input={
    db,branchId:"yongam",generationId:"gen_orphan",keys:["swim_students"],
    readLegacyKey:legacyReader(root),now:new Date("2026-08-07T02:00:00.000Z"),
  };
  await runFenced(input);
  root.swim_students=root.swim_students.slice(0,1);

  await runFenced(input);

  assert.equal(generationRows(db,"gen_orphan","people").length,2);
  assert.equal(generationRows(db,"gen_orphan","enrollments").length,1);
  assert.equal(generationRows(db,"gen_orphan","placements").length,1);
});

test("full-generation reconciliation removes a person deleted between baseline and parity",async()=>{
  const db=new FakeFirestore();
  const root={
    swim_tab_list:[META[0]],swim_main_tab:{tabId:"regular"},
    swim_students:[
      {sid:"stu_keep",n:"Keep Student",p:"01011112222",t:"16:00",d:"mon",l:1,r:1},
      {sid:"stu_remove",n:"Remove Student",p:"01033334444",t:"17:00",d:"tue",l:1,r:1},
    ],
  };
  const input={
    db,branchId:"yongam",generationId:"gen_full_people",keys:["swim_students"],
    readLegacyKey:legacyReader(root),fullGeneration:true,
    now:new Date("2026-08-07T02:00:00.000Z"),
  };
  await runFenced(input);
  assert.equal(generationRows(db,"gen_full_people","people").length,2);
  root.swim_students=root.swim_students.slice(0,1);

  const parity=await runFenced({...input,readLegacyKey:legacyReader(root)});

  const people=generationRows(db,"gen_full_people","people");
  assert.equal(people.length,1);
  assert.equal(people[0].id,"stu_keep");
  assert.ok(parity.deletes>=1);
});

test("a failed second fenced transaction does not produce an applied result",async()=>{
  const db=new FakeFirestore();
  db.failTransactionAt=2;
  const students=Array.from({length:351},(_,index)=>({
    sid:`stu_${index}`,n:`Student ${index}`,p:`010${String(index).padStart(8,"0")}`,
    t:`time-${index}`,d:"mon",l:1,r:1,
  }));
  const root={swim_tab_list:[META[0]],swim_main_tab:{tabId:"regular"},swim_students:students};
  let applied=false;

  await assert.rejects(async()=>{
    await runFenced({
      db,branchId:"yongam",generationId:"gen_batch",keys:["swim_students"],
      readLegacyKey:legacyReader(root),now:new Date("2026-08-07T02:00:00.000Z"),
      fullGeneration:true,
    });
    applied=true;
  },error=>error.code==="unavailable");

  assert.equal(applied,false);
  assert.deepEqual(db.transactionAttempts.map(attempt=>attempt.operations.length),[350,1]);
  assert.deepEqual(db.transactionAttempts.map(attempt=>attempt.committed),[true,false]);
});

test("post-write verification rejects a mismatched scope",async()=>{
  const db=new FakeFirestore();
  db.afterCommit=(number,operations,firestore)=>{
    if(number===1) firestore.docs.delete(operations[0].path);
  };
  const root={
    swim_tab_list:[META[0]],swim_main_tab:{tabId:"regular"},
    swim_students:[
      {sid:"stu_tamper",n:"Tamper Student",p:"01077778888",t:"16:00",d:"mon",l:1,r:1},
    ],
  };

  await assert.rejects(()=>runFenced({
    db,branchId:"yongam",generationId:"gen_tamper",keys:["swim_students"],
    readLegacyKey:legacyReader(root),now:new Date("2026-08-07T02:00:00.000Z"),
  }),error=>error.code==="verification-mismatch");
});

test("conversion diagnostics never include source student fields",async()=>{
  const db=new FakeFirestore();
  const name="Private Student Name";
  const phone="01098765432";
  const root={
    swim_tab_list:[META[0]],swim_main_tab:{tabId:"regular"},
    swim_students:[
      {sid:"stu_private_a",n:name,p:phone,t:"16:00",d:"mon",l:1,r:1},
      {sid:"stu_private_b",n:"Other Private Name",p:"01012344321",t:"16:00",d:"mon",l:1,r:1},
    ],
  };

  await assert.rejects(()=>runFenced({
    db,branchId:"yongam",generationId:"gen_private",keys:["swim_students"],
    readLegacyKey:legacyReader(root),now:new Date("2026-08-07T02:00:00.000Z"),
  }),error=>{
    const serialized=JSON.stringify(error);
    return error.code==="conversion-mismatch"
      &&!serialized.includes(name)&&!serialized.includes(phone)
      &&!Object.prototype.hasOwnProperty.call(error,"report");
  });
});

test("legacy read failures are sanitized at the runner boundary",async()=>{
  const name="Read Failure Private Name";
  const phone="01045454545";
  const dependencyError=Object.assign(new Error(`read failed for ${name} ${phone}`),{
    code:"unavailable",details:{student:{name,phone}},sourceValue:{n:name,p:phone},
  });

  await assert.rejects(()=>runFenced({
    db:new FakeFirestore(),branchId:"yongam",generationId:"gen_read_error",
    keys:["swim_students"],readLegacyKey:async()=>{throw dependencyError;},
    now:new Date("2026-08-07T02:00:00.000Z"),
  }),error=>{
    const serialized=JSON.stringify(error);
    return error!==dependencyError&&error.code==="unavailable"&&error.message==="unavailable"
      &&assert.deepEqual(Object.keys(error),["code"])===undefined
      &&!serialized.includes(name)&&!serialized.includes(phone);
  });
});

test("commit failures are sanitized at the runner boundary",async()=>{
  const name="Commit Failure Private Name";
  const phone="01056565656";
  const db=new FakeFirestore();
  db.failTransactionAt=1;
  db.transactionError=Object.assign(new Error(`commit failed for ${name} ${phone}`),{
    code:"aborted",details:{student:{name,phone}},metadata:{sourceName:name},
  });
  const root={
    swim_tab_list:[META[0]],swim_main_tab:{tabId:"regular"},
    swim_students:[
      {sid:"stu_commit_private",n:name,p:phone,t:"16:00",d:"mon",l:1,r:1},
    ],
  };

  await assert.rejects(()=>runFenced({
    db,branchId:"yongam",generationId:"gen_commit_error",keys:["swim_students"],
    readLegacyKey:legacyReader(root),now:new Date("2026-08-07T02:00:00.000Z"),
  }),error=>{
    const serialized=JSON.stringify(error);
    return error!==db.transactionError&&error.code==="aborted"&&error.message==="aborted"
      &&assert.deepEqual(Object.keys(error),["code"])===undefined
      &&!serialized.includes(name)&&!serialized.includes(phone);
  });
});

test("excluded source keys do not trigger legacy reads or V2 writes",async()=>{
  const db=new FakeFirestore();
  const calls=[];
  const result=await runner.runShadowSync({
    db,branchId:"yongam",generationId:"gen_excluded",
    keys:["swim_attendance","swim_audit_log","swim_restore_points","zz_swim_student_delete_index"],
    readLegacyKey:legacyReader({},calls),now:new Date("2026-08-07T02:00:00.000Z"),
  });
  assert.deepEqual(result,{collections:[],writes:0,deletes:0,counts:{},digests:{}});
  assert.deepEqual(calls,[]);
  assert.equal(db.commits.length,0);
});

test("a mutating run without a fence fails closed before reads or writes",async()=>{
  const db=new FakeFirestore();
  const calls=[];

  await assert.rejects(()=>runner.runShadowSync({
    db,branchId:"yongam",generationId:"gen_missing_fence",keys:["swim_students"],
    readLegacyKey:legacyReader({
      swim_tab_list:[META[0]],swim_main_tab:{tabId:"regular"},swim_students:[],
    },calls),
    now:new Date("2026-08-07T02:00:00.000Z"),
  }),error=>error.code==="invalid-argument"&&error.message==="invalid-argument");

  assert.deepEqual(calls,[]);
  assert.equal(db.commits.length,0);
  assert.equal(db.transactionAttempts.length,0);
  assert.equal(generationRows(db,"gen_missing_fence","placements").length,0);
});

test("an unknown dynamic tab key cannot widen into a full collection delete",async()=>{
  const existingPath="scheduleV2/yongam/generations/gen_unknown/placements/existing";
  const db=new FakeFirestore({
    [existingPath]:{
      id:"existing",personId:"stu_existing",enrollmentId:"enr_existing",
      tabId:"regular",courseType:"regular",generationId:"gen_unknown",branchId:"yongam",
    },
  });
  const root={
    swim_tab_list:[META[0]],swim_main_tab:{tabId:"regular"},swim_stu_missing:[],
  };

  await assert.rejects(()=>runFenced({
    db,branchId:"yongam",generationId:"gen_unknown",keys:["swim_stu_missing"],
    readLegacyKey:legacyReader(root),now:new Date("2026-08-07T02:00:00.000Z"),
  }),error=>error.code==="conversion-mismatch");

  assert.equal(db.docs.has(existingPath),true);
  assert.equal(db.commits.length,0);
});

test("incremental metadata updates preserve sibling documents",async()=>{
  const db=new FakeFirestore();
  const root={
    swim_tab_list:[META[0]],swim_main_tab:{tabId:"regular"},
    swim_age_year:2026,swim_student_id_version:"sid-v1",swim_ver:"legacy-v1",
  };
  const base={
    db,branchId:"yongam",generationId:"gen_metadata",readLegacyKey:legacyReader(root),
    now:new Date("2026-08-07T02:00:00.000Z"),
  };
  await runFenced({
    ...base,keys:["swim_age_year","swim_student_id_version","swim_ver"],
  });

  for(const [key,value,id] of [
    ["swim_age_year",2027,"age_year"],
    ["swim_student_id_version","sid-v2","student_id_version"],
    ["swim_ver","legacy-v2","legacy_data_version"],
  ]){
    root[key]=value;
    await runFenced({...base,keys:[key],readLegacyKey:legacyReader(root)});
    const rows=generationRows(db,"gen_metadata","systemMetadata");
    assert.equal(rows.length,3,key);
    assert.equal(rows.find(row=>row.id===id).value,value,key);
  }
});

test("a stale run cannot overwrite or report success after a newer fenced run",async()=>{
  const db=new FakeFirestore();
  const fencePath="scheduleV2/yongam/runtime/scheduleSync";
  const staleRoot={
    swim_tab_list:[META[0]],swim_main_tab:{tabId:"regular"},
    swim_students:[
      {sid:"stu_fenced",n:"Fenced Student",p:"01010101010",t:"16:00",d:"mon",l:1,r:1},
    ],
  };
  const newerRoot={
    ...staleRoot,
    swim_students:[
      {...staleRoot.swim_students[0],t:"18:00",d:"wed",l:2,r:3},
    ],
  };
  const staleFence=fenceFor(db,"lease-a");
  let newerResult=null;
  db.beforeTransaction=async firestore=>{
    firestore.beforeTransaction=null;
    const newerFence=fenceFor(firestore,"lease-b");
    newerResult=await runner.runShadowSync({
      db:firestore,branchId:"yongam",generationId:"gen_fenced",keys:["swim_students"],
      readLegacyKey:legacyReader(newerRoot),fence:newerFence,
      now:new Date("2026-08-07T02:00:01.000Z"),
    });
  };

  await assert.rejects(()=>runner.runShadowSync({
    db,branchId:"yongam",generationId:"gen_fenced",keys:["swim_students"],
    readLegacyKey:legacyReader(staleRoot),fence:staleFence,
    now:new Date("2026-08-07T02:00:00.000Z"),
  }),error=>error.code==="stale-run");

  assert.ok(newerResult);
  assert.equal(generationRows(db,"gen_fenced","placements")[0].time,"18:00");
  assert.equal(db.commits.length,0);
  assert.ok(db.transactionAttempts.some(attempt=>attempt.committed&&attempt.operations.length===0));
  assert.ok(db.transactionAttempts.every(attempt=>attempt.reads.includes(fencePath)));
});
