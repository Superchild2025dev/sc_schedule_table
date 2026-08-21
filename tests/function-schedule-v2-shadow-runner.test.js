"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const runner=require("../functions/schedule-v2-shadow-runner.js");
const shadowPolicy=require("../functions/schedule-v2-shadow-policy.js");
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
    if(typeof this.db.beforeCollectionRead==="function") await this.db.beforeCollectionRead(this,this.db);
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

function seedReferenceTabs(input){
  const branchId=encodeURIComponent(input.branchId).replace(/\./g,"%2E");
  const generationId=encodeURIComponent(input.generationId).replace(/\./g,"%2E");
  const prefix=`scheduleV2/${branchId}/generations/${generationId}/tabs/`;
  if([...input.db.docs.keys()].some(documentPath=>documentPath.startsWith(prefix))) return;
  META.forEach(tab=>input.db.docs.set(`${prefix}${tab.id}`,clone(tab)));
}

function runFenced(input){
  seedReferenceTabs(input);
  if(input?.fence) return runner.runShadowSync(input);
  return runner.runShadowSync({
    ...input,fence:fenceFor(input.db,`test-${input.generationId}`),
  });
}

test("instructor changes load mark and disabled-slot dependencies for every tab",()=>{
  const required=requiredLegacyKeys(["swim_inst"],META);
  for(const key of [
    "swim_inst","swim_mark","swim_disabled","swim_periods",
    "swim_students","swim_stu_july","swim_bt_summer_stu",
    "swim_inst_july","swim_bt_summer_inst",
  ]) assert.ok(required.includes(key),key);
});

test("student changes load every identity tab while keeping the changed key explicit",()=>{
  const required=requiredLegacyKeys(["swim_stu_july"],META);
  for(const key of [
    "swim_stu_july","swim_students","swim_bt_summer_stu","swim_mark","swim_disabled",
  ]) assert.ok(required.includes(key),key);
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
  for(const key of ["swim_reserve","swim_mark","swim_periods"]){
    assert.ok(required.includes(key),key);
  }
});

test("period changes load every date-scoped dependent source",()=>{
  const required=requiredLegacyKeys(["swim_periods"],META);
  for(const key of [
    "swim_retire","swim_enroll","swim_hyuwon","swim_move","swim_reserve","swim_mark",
    "swim_retire_history","swim_desk_notes","swim_periods",
  ]) assert.ok(required.includes(key),key);
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
    "swim_attendance","swim_att_guests","swim_day_snapshot",
    "swim_bt_attendance_summer","swim_bt_att_guests_summer","swim_bt_day_snapshot_summer",
  ]) assert.ok(required.includes(key),key);
  for(const key of [
    "swim_audit_log","swim_restore_points","zz_swim_student_delete_index",
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

  assert.deepEqual(result.collections,[
    "people","enrollments","placements","classMarks","disabledSlots",
  ]);
  assert.deepEqual(result.counts,{
    people:1,enrollments:2,placements:2,classMarks:0,disabledSlots:0,
  });
  assert.equal(generationRows(db,"gen_identity","people").length,1);
  assert.equal(generationRows(db,"gen_identity","enrollments").length,2);
  assert.equal(generationRows(db,"gen_identity","placements").length,2);
  assert.deepEqual(
    new Set(generationRows(db,"gen_identity","enrollments").map(row=>row.courseType)),
    new Set(["regular","bangteuk"]),
  );
  assert.deepEqual(Object.keys(result.digests).sort(),[
    "classMarks","disabledSlots","enrollments","people","placements",
  ]);
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

test("a single-tab student update loads cross-tab identity without widening course placements",async()=>{
  const db=new FakeFirestore();
  const root={
    swim_tab_list:[META[0],META[2]],swim_main_tab:{tabId:"regular"},
    swim_students:[
      {sid:"stu_shared",n:"Shared Student",p:"01011112222",t:"16:00",d:"mon",l:1,r:1},
    ],
    swim_inst:{},
    swim_bt_summer_stu:[
      {sid:"stu_shared",n:"Shared Student",p:"01011112222",t:"10:00",d:"tue",l:2,r:1},
    ],
    swim_bt_summer_inst:{},
  };
  const base={
    db,branchId:"yongam",generationId:"gen_cross_tab",now:new Date("2026-08-07T02:00:00.000Z"),
  };
  await runFenced({...base,keys:["swim_tab_list"],readLegacyKey:legacyReader(root),fullGeneration:true});
  const vacationBefore=generationRows(db,"gen_cross_tab","placements").find(row=>row.tabId==="summer");
  const reads=[];
  root.swim_students=[{...root.swim_students[0],t:"18:00",d:"wed",l:3,r:2}];

  await runFenced({
    ...base,keys:["swim_students"],readLegacyKey:legacyReader(root,reads),
  });

  assert.ok(reads.includes("swim_bt_summer_stu"));
  assert.equal(generationRows(db,"gen_cross_tab","people").length,1);
  assert.equal(generationRows(db,"gen_cross_tab","enrollments").length,2);
  const vacationAfter=generationRows(db,"gen_cross_tab","placements").find(row=>row.tabId==="summer");
  assert.deepEqual(vacationAfter,vacationBefore);
  assert.equal(generationRows(db,"gen_cross_tab","placements").find(row=>row.tabId==="regular").time,"18:00");
});

test("same phone with different names remains separate across regular and vacation tabs",async()=>{
  const db=new FakeFirestore();
  const root={
    swim_tab_list:[META[0],META[2]],swim_main_tab:{tabId:"regular"},
    swim_students:[
      {n:"First Student",p:"01033334444",t:"16:00",d:"mon",l:1,r:1},
    ],
    swim_inst:{},
    swim_bt_summer_stu:[
      {n:"Second Student",p:"01033334444",t:"10:00",d:"tue",l:2,r:1},
    ],
    swim_bt_summer_inst:{},
  };

  await runFenced({
    db,branchId:"yongam",generationId:"gen_cross_tab_phone",keys:["swim_tab_list"],
    readLegacyKey:legacyReader(root),fullGeneration:true,
  });

  const people=generationRows(db,"gen_cross_tab_phone","people");
  assert.equal(people.length,2);
  assert.notEqual(people[0].id,people[1].id);
});

test("a student dependency change replaces a cross-key disabled-slot document",async()=>{
  const db=new FakeFirestore();
  const root={
    swim_tab_list:[META[0]],swim_main_tab:{tabId:"regular"},
    swim_students:[],swim_inst:{},
    swim_disabled:{"16:00/mon/1/1":true},
  };
  const base={
    db,branchId:"yongam",generationId:"gen_disabled_dependency",
    now:new Date("2026-08-07T02:00:00.000Z"),
  };
  await runFenced({...base,keys:["swim_tab_list"],readLegacyKey:legacyReader(root),fullGeneration:true});
  const oldId=generationRows(db,"gen_disabled_dependency","disabledSlots")[0].id;
  root.swim_students=[
    {sid:"stu_disabled",n:"Disabled Slot Student",p:"01055556666",t:"16:00",d:"mon",l:1,r:1},
  ];

  await runFenced({...base,keys:["swim_students"],readLegacyKey:legacyReader(root)});

  const rows=generationRows(db,"gen_disabled_dependency","disabledSlots");
  assert.equal(rows.length,1);
  assert.equal(rows[0].tabId,"regular");
  assert.notEqual(rows[0].id,oldId);
});

test("period boundary changes rewrite and delete every date-scoped dependent document",async()=>{
  const db=new FakeFirestore();
  const tabs=[
    {id:"july",name:"July",type:"bangteuk",periodMonth:"2026-07"},
    {id:"august",name:"August",type:"bangteuk",periodMonth:"2026-08"},
  ];
  const root={
    swim_tab_list:tabs,swim_main_tab:{tabId:"july"},
    swim_bt_july_stu:[],swim_bt_july_inst:{},swim_bt_august_stu:[],swim_bt_august_inst:{},
    swim_periods:[
      {month:7,start:"2026-07-01",end:"2026-08-01"},
      {month:8,start:"2026-08-02",end:"2026-08-31"},
    ],
    swim_retire:{"10:00/mon/1/1":{n:"Boundary Student",p:"01077778888",bangteuk:true,ds:"2026-08-01"}},
    swim_enroll:{},swim_hyuwon:{},swim_move:{},
    swim_reserve:{"10:00/mon/1":[{n:"Boundary Student",p:"01077778888",bangteuk:true,date:"2026-08-01"}]},
    swim_mark:{"10:00/mon/1/1/2026-08-01":{studentScheduleType:"bangteuk",n:"Boundary Student",p:"01077778888"}},
    swim_retire_history:[{id:"history-boundary",n:"Boundary Student",p:"01077778888",bangteuk:true,retiredAt:"2026-08-01"}],
    swim_desk_notes:[{id:"desk-boundary",student:"Boundary Student",phone:"01077778888",bangteuk:true,dateKey:"2026-08-01"}],
  };
  const base={
    db,branchId:"yongam",generationId:"gen_period_boundary",
    now:new Date("2026-08-07T02:00:00.000Z"),
  };
  await runFenced({...base,keys:["swim_tab_list"],readLegacyKey:legacyReader(root),fullGeneration:true});
  const oldWaitlistId=generationRows(db,"gen_period_boundary","waitlistEntries")[0].id;
  root.swim_periods=[
    {month:7,start:"2026-07-01",end:"2026-07-31"},
    {month:8,start:"2026-08-01",end:"2026-08-31"},
  ];

  await runFenced({...base,keys:["swim_periods"],readLegacyKey:legacyReader(root)});

  for(const collection of [
    "reservations","waitlistEntries","classMarks","retirementRecords","deskStudentRecords",
  ]){
    const rows=generationRows(db,"gen_period_boundary",collection);
    assert.ok(rows.length,collection);
    assert.ok(rows.every(row=>row.tabId==="august"),collection);
  }
  assert.equal(generationRows(db,"gen_period_boundary","waitlistEntries").some(row=>row.id===oldWaitlistId),false);
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
    "teacherAssignments","classMarks","disabledSlots","people","enrollments","placements",
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

test("a production-scale multi-batch run keeps its lease through heartbeat checkpoints",async()=>{
  const db=new FakeFirestore();
  const leaseId="scale-lease";
  const syncRef=db.collection("scheduleV2").doc("yongam").collection("runtime").doc("scheduleSync");
  let clockMs=Date.parse("2026-08-07T02:00:00.000Z");
  db.docs.set(syncRef.path,{
    pendingKeys:[],inFlightKeys:["swim_students"],requestedRevision:1,
    status:"processing",leaseId,leaseUntil:new Date(clockMs+60_000).toISOString(),
  });
  const students=Array.from({length:701},(_,index)=>({
    sid:`scale_${index}`,n:`Scale ${index}`,p:`011${String(index).padStart(8,"0")}`,
    t:`time-${index}`,d:"mon",l:1,r:1,
  }));
  const heartbeat=async()=>{
    clockMs+=5_000;
    const renewed=shadowPolicy.renewLease(db.docs.get(syncRef.path),leaseId,new Date(clockMs));
    assert.ok(renewed,"lease renewal must fail closed before writes when ownership expires");
    db.docs.set(syncRef.path,renewed);
  };

  const result=await runFenced({
    db,branchId:"yongam",generationId:"gen_scale",keys:["swim_students"],
    readLegacyKey:legacyReader({
      swim_tab_list:[META[0]],swim_main_tab:{tabId:"regular"},swim_students:students,
    }),
    fence:{ref:syncRef,leaseId},heartbeat,fullGeneration:true,
  });

  assert.ok(clockMs>Date.parse("2026-08-07T02:01:00.000Z"));
  assert.equal(result.counts.people,701);
  assert.equal(result.counts.enrollments,701);
  assert.equal(result.counts.placements,701);
  assert.equal(db.docs.get(syncRef.path).leaseId,leaseId);
  assert.ok(Date.parse(db.docs.get(syncRef.path).leaseUntil)>clockMs);
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

test("post-write verification rejects tampered person enrollment and tab references",async()=>{
  const tamperCases=[
    ["person",(db)=>{
      const row=[...db.docs.entries()].find(([documentPath])=>documentPath.includes("/enrollments/"));
      row[1].personId="missing-person";
      db.docs.set(row[0],row[1]);
    }],
    ["enrollment",(db)=>{
      const row=[...db.docs.entries()].find(([documentPath])=>documentPath.includes("/placements/"));
      row[1].enrollmentId="missing-enrollment";
      db.docs.set(row[0],row[1]);
    }],
    ["placement-tab",(db)=>{
      const row=[...db.docs.entries()].find(([documentPath])=>documentPath.includes("/placements/"));
      row[1].tabId="missing-tab";
      db.docs.set(row[0],row[1]);
    }],
    ["assignment-tab",(db)=>{
      const row=[...db.docs.entries()].find(([documentPath])=>documentPath.includes("/teacherAssignments/"));
      row[1].tabId="missing-tab";
      db.docs.set(row[0],row[1]);
    }],
  ];

  for(const [caseName,tamper] of tamperCases){
    const db=new FakeFirestore();
    const root={
      swim_tab_list:[META[0]],swim_main_tab:{tabId:"regular"},
      swim_students:[
        {sid:"stu_reference",n:"Reference Student",p:"01088889999",t:"16:00",d:"mon",l:1,r:1},
      ],
      swim_inst:{"16:00/mon/1/1":"Reference Teacher"},
    };
    const base={
      db,branchId:"yongam",generationId:`gen_reference_${caseName}`,
      now:new Date("2026-08-07T02:00:00.000Z"),
    };
    await runFenced({...base,keys:["swim_tab_list"],readLegacyKey:legacyReader(root),fullGeneration:true});
    let tampered=false;
    db.beforeCollectionRead=async collection=>{
      if(tampered||!collection.path.endsWith("/tabs")) return;
      tamper(db);
      tampered=true;
    };

    await assert.rejects(()=>runFenced({
      ...base,keys:["swim_students","swim_inst"],readLegacyKey:legacyReader(root),
    }),error=>error.code==="verification-mismatch",caseName);
    assert.equal(tampered,true,caseName);
  }
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

test("attendance reconciliation removes only the changed canonical owner scope",async()=>{
  const db=new FakeFirestore();
  const root={
    swim_tab_list:[META[0],META[2]],swim_main_tab:{tabId:"regular"},
    swim_students:[{sid:"regular_student",n:"Regular",t:"16:00",d:"mon",l:1,r:1}],
    swim_bt_summer_stu:[{sid:"summer_student",n:"Summer",t:"10:00",d:"tue",l:1,r:1}],
    swim_attendance:{"16:00/mon/1/1/2026-08-07":{s:"present"}},
    swim_bt_attendance_summer:{"10:00/tue/1/1/2026-08-07":{s:"present"}},
  };

  await runFenced({
    db,branchId:"yongam",generationId:"gen_attendance_scope",
    keys:["swim_attendance","swim_bt_attendance_summer"],
    readLegacyKey:legacyReader(root),
  });
  assert.equal(generationRows(db,"gen_attendance_scope","attendanceRecords").length,2);

  root.swim_attendance={};
  await runFenced({
    db,branchId:"yongam",generationId:"gen_attendance_scope",
    keys:["swim_attendance"],readLegacyKey:legacyReader(root),
  });
  const rows=generationRows(db,"gen_attendance_scope","attendanceRecords");
  assert.equal(rows.length,1);
  assert.equal(rows[0].courseType,"bangteuk");
  assert.equal(rows[0].tabId,"summer");
});

test("excluded source keys do not trigger legacy reads or V2 writes",async()=>{
  const db=new FakeFirestore();
  const calls=[];
  const result=await runner.runShadowSync({
    db,branchId:"yongam",generationId:"gen_excluded",
    keys:["swim_audit_log","swim_restore_points","zz_swim_student_delete_index"],
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

  await assert.rejects(()=>runFenced({
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
