"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
require("../js/schedule-time.js");
require("../js/schedule-schema-v2.js");
const schema=globalThis.SCScheduleSchemaV2;
require("../js/schedule-v2-operational-model.js");
const model=globalThis.SCV2OperationalModel;
const {commitV2Mutation}=require("../functions/schedule-v2-operational-writer.js");

function plain(value){ return JSON.parse(JSON.stringify(value)); }

function fakeFirestore(seed={}){
  const docs=new Map(Object.entries(seed).map(([key,value])=>[key,plain(value)]));
  for(const [key,value] of docs){
    const attendanceKey=key.replace(/\/runtime\/operational$/,"/runtime/attendance");
    if(attendanceKey!==key&&!docs.has(attendanceKey)) docs.set(attendanceKey,plain(value));
  }
  let transactionCount=0;
  let failTransaction=0;
  function snapshot(ref){
    const exists=docs.has(ref.path);
    return {exists,id:ref.id,data(){return exists?plain(docs.get(ref.path)):undefined;}};
  }
  function document(path){
    return {
      path,id:path.split("/").pop(),
      collection(name){return collection(`${path}/${name}`);},
      async get(){return snapshot(this);},
    };
  }
  function collection(path){return {doc(id){return document(`${path}/${id}`);}};}
  const db={
    docs,
    collection,
    failOnTransaction(number){failTransaction=number;},
    async runTransaction(worker){
      transactionCount+=1;
      if(transactionCount===failTransaction) throw Object.assign(new Error("interrupted"),{code:"unavailable"});
      const operations=[];
      const tx={
        get(ref){return Promise.resolve(snapshot(ref));},
        set(ref,value,options){operations.push({type:"set",ref,value:plain(value),options});},
        delete(ref){operations.push({type:"delete",ref});},
      };
      const result=await worker(tx);
      operations.forEach(operation=>{
        if(operation.type==="delete") docs.delete(operation.ref.path);
        else if(operation.options?.merge) docs.set(operation.ref.path,{...(docs.get(operation.ref.path)||{}),...operation.value});
        else docs.set(operation.ref.path,operation.value);
      });
      return result;
    },
  };
  return db;
}

function runtimePath(){return "scheduleV2/yongam/runtime/operational";}
function mutationPath(id){return `scheduleV2/yongam/operationalMutations/${id}`;}
function generationPath(collection,id){return `scheduleV2/yongam/generations/gen_1/${collection}/${id}`;}
function snapshotRequest(operationId,beforeRevision=4){
  return {
    branchId:"yongam",generationId:"gen_1",expectedEpoch:2,operationId,
    operationType:"attendance-snapshot",keys:["zz_swim_day_snapshot__regular__2026-08-03"],
    beforeRevision,nextValues:{"zz_swim_day_snapshot__regular__2026-08-03":"{}"},removedKeys:[],
  };
}
function snapshotChanges(){
  return [
    {type:"set",collection:"attendanceSnapshots",id:"snapshot_1",value:{id:"snapshot_1",tabId:"regular",courseType:"regular",date:"2026-08-03"}},
    {type:"set",collection:"attendanceSnapshotStudents",id:"student_1",value:{id:"student_1",snapshotId:"snapshot_1",tabId:"regular",courseType:"regular",date:"2026-08-03",payload:{sid:"student"}}},
    {type:"set",collection:"attendanceSnapshotTeachers",id:"teacher_1",value:{id:"teacher_1",snapshotId:"snapshot_1",tabId:"regular",courseType:"regular",date:"2026-08-03",slotKey:"4PM/Mon/1",payload:{n:"Teacher"}}},
  ];
}

function rootWithMarks(marks){
  return {
    swim_tab_list:JSON.stringify([
      {id:"regular",type:"regular",name:"Regular"},
      {id:"summer",type:"bangteuk",name:"Summer"},
    ]),
    swim_main_tab:JSON.stringify({tabId:"regular"}),
    swim_parent_tab:JSON.stringify({tabId:"regular"}),
    swim_students:JSON.stringify([{sid:"same_person",n:"Student",t:"4PM",d:"Mon",l:1,r:1}]),
    swim_inst:JSON.stringify({"4PM/Mon/1":{n:"Teacher R"}}),
    swim_bt_summer_stu:JSON.stringify([{sid:"same_person",n:"Student",t:"9AM",d:"Mon",l:1,r:1}]),
    swim_bt_summer_inst:JSON.stringify({"9AM/Mon/1":{n:"Teacher B"}}),
    swim_mark:JSON.stringify(marks),
  };
}

function conversion(root){
  const report=schema.diagnoseLegacyRoot("yongam",root);
  assert.equal(report.checks.ready,true,JSON.stringify(report.issues));
  return report.conversion;
}

test("absence, cancel, regular makeup, sample, and mandatory makeup change only affected classMarks",()=>{
  const unrelated="9AM/Mon/1/1/2026-08-03";
  const affected="4PM/Mon/1/1/2026-08-03";
  const cases=[
    {name:"absence",before:null,value:{type:"absent"},want:"set"},
    {name:"absence cancel",before:{type:"absent"},value:null,want:"delete"},
    {name:"regular makeup",before:{type:"absent"},value:{type:"bogang",n:"Student"},want:"set"},
    {name:"sample",before:{type:"bogang",n:"Student"},value:{type:"sample",n:"Student"},want:"set"},
    {name:"mandatory makeup",before:{type:"bogang",n:"Student"},value:{type:"bogang",n:"Student",mandatory:true},want:"set"},
  ];
  for(const item of cases){
    const beforeMarks={
      [unrelated]:{type:"sample",n:"Other"},
    };
    if(item.before) beforeMarks[affected]=item.before;
    const afterMarks=plain(beforeMarks);
    if(item.value===null) delete afterMarks[affected];
    else afterMarks[affected]=item.value;
    const changes=model.collectionChanges({
      before:conversion(rootWithMarks(beforeMarks)),
      after:conversion(rootWithMarks(afterMarks)),
    }).changes;
    assert.deepEqual(
      changes.map(change=>[change.collection,change.value?.legacyKey||affected,change.value?.layer||"primary",change.type]),
      [["classMarks",affected,"primary",item.want]],
      item.name,
    );
  }
});

test("the same person remains in distinct regular and bangteuk placement domains",()=>{
  const converted=conversion(rootWithMarks({}));
  const placements=converted.placements.filter(row=>row.personId==="same_person");
  assert.deepEqual(placements.map(row=>[row.tabId,row.slotKey]).sort(),[
    ["regular","4PM/Mon/1/1"],
    ["summer","9AM/Mon/1/1"],
  ]);
  assert.equal(new Set(placements.map(row=>row.enrollmentId)).size,2);
});

test("snapshot interruption resumes the same fenced operation and marks completion last",async()=>{
  const request=snapshotRequest("snapshot_retry_1");
  const db=fakeFirestore({[runtimePath()]:{branchId:"yongam",mode:"v2",generationId:"gen_1",epoch:2,revision:4}});
  db.failOnTransaction(3);
  await assert.rejects(()=>commitV2Mutation({db,request,changes:snapshotChanges(),now:new Date("2026-08-03T00:00:00Z")}),/interrupted/);
  assert.equal(db.docs.get(generationPath("attendanceSnapshots","snapshot_1")).complete,false);
  assert.equal(db.docs.get(runtimePath()).revision,4);

  db.failOnTransaction(0);
  const result=await commitV2Mutation({db,request,changes:[],now:new Date("2026-08-03T00:01:00Z")});
  assert.equal(result.committed,true);
  assert.equal(db.docs.get(generationPath("attendanceSnapshots","snapshot_1")).complete,true);
  assert.equal(db.docs.get(runtimePath()).revision,5);
  assert.equal(db.docs.get("scheduleV2/yongam/runtime/attendance").revision,5);
  assert.equal(db.docs.get(mutationPath("snapshot_retry_1")).status,"committed");
});

test("a resumed snapshot header completion validates both runtime pointers before any header or manifest write",async()=>{
  const request=snapshotRequest("snapshot_pointer_resume");
  const db=fakeFirestore({[runtimePath()]:{branchId:"yongam",mode:"v2",generationId:"gen_1",epoch:2,revision:4}});
  db.failOnTransaction(3);
  await assert.rejects(()=>commitV2Mutation({db,request,changes:snapshotChanges(),now:new Date("2026-08-03T00:00:00Z")}),/interrupted/);

  const attendancePath="scheduleV2/yongam/runtime/attendance";
  db.docs.set(attendancePath,{branchId:"yongam",mode:"v2",generationId:"gen_1",epoch:2,revision:3});
  const beforeManifest=plain(db.docs.get(mutationPath("snapshot_pointer_resume")));
  db.failOnTransaction(0);
  await assert.rejects(
    ()=>commitV2Mutation({db,request,changes:[],now:new Date("2026-08-03T00:01:00Z")}),
    error=>error?.code==="failed-precondition",
  );

  assert.equal(db.docs.get(generationPath("attendanceSnapshots","snapshot_1")).complete,false);
  assert.deepEqual(db.docs.get(mutationPath("snapshot_pointer_resume")),beforeManifest);
  assert.equal(db.docs.get(runtimePath()).revision,4);
  assert.equal(db.docs.get(attendancePath).revision,3);
});

test("an explicit snapshot creation cannot replace an existing historical snapshot",async()=>{
  const existing={
    id:"snapshot_1",tabId:"regular",courseType:"regular",date:"2026-08-03",
    complete:true,operationalRevision:4,lastOperationId:"snapshot_original",
  };
  const db=fakeFirestore({
    [runtimePath()]:{branchId:"yongam",mode:"v2",generationId:"gen_1",epoch:2,revision:4},
    [generationPath("attendanceSnapshots","snapshot_1")]:existing,
  });
  await assert.rejects(()=>commitV2Mutation({
    db,request:snapshotRequest("snapshot_replace_1"),changes:snapshotChanges(),now:new Date("2026-08-03T00:00:00Z"),
  }),error=>error?.code==="failed-precondition");
  assert.deepEqual(db.docs.get(generationPath("attendanceSnapshots","snapshot_1")),existing);
});
