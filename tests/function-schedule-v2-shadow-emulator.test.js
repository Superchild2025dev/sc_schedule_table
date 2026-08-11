"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const {createRequire}=require("node:module");
const {isDeepStrictEqual}=require("node:util");

const emulatorEnabled=Boolean(process.env.FIRESTORE_EMULATOR_HOST);

test("Schedule V2 shadow emulator is available",{skip:!emulatorEnabled},()=>{
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
});

if(emulatorEnabled){
  const root=path.join(__dirname,"..");
  const requireFunctions=createRequire(path.join(root,"functions","package.json"));
  const functions=require(path.join(root,"functions","index.js"));
  const operationalModel=globalThis.SCV2OperationalModel;
  const {getFirestore}=requireFunctions("firebase-admin/firestore");
  const db=getFirestore();
  const developerAuth={uid:"schedule-v2-emulator",token:{email:"developer@scswim.local",email_verified:true}};
  let eventSequence=0;

  function kvRef(branchId,key){
    const docId=encodeURIComponent(key).replace(/\./g,"%2E");
    return db.collection("scheduleStores").doc(branchId).collection("kv").doc(docId);
  }

  function runtimeRef(branchId,documentId){
    return db.collection("scheduleV2").doc(branchId).collection("runtime").doc(documentId);
  }

  function generationRef(branchId,generationId){
    return db.collection("scheduleV2").doc(branchId).collection("generations").doc(generationId);
  }

  async function clearFirestore(){
    await db.recursiveDelete(db.collection("scheduleStores"));
    await db.recursiveDelete(db.collection("scheduleV2"));
  }

  async function writeLegacyValue(branchId,key,value,{chunked=false}={}){
    const ref=kvRef(branchId,key);
    const before=await ref.get();
    if(!chunked){
      await ref.set({key,value,chunked:false});
    }else{
      const text=JSON.stringify(value);
      const split=Math.max(1,Math.floor(text.length/2));
      const chunks=[text.slice(0,split),text.slice(split)];
      const batch=db.batch();
      chunks.forEach((part,index)=>{
        batch.set(ref.collection("chunks").doc(String(index).padStart(4,"0")),{text:part});
      });
      batch.set(ref,{key,chunked:true,chunkCount:chunks.length,valueType:"json"});
      await batch.commit();
    }
    return {ref,before,after:await ref.get()};
  }

  async function readLegacyValue(branchId,key){
    const ref=kvRef(branchId,key);
    const snapshot=await ref.get();
    const data=snapshot.data()||{};
    if(!data.chunked) return data.value??null;
    const chunks=[];
    for(let index=0;index<Number(data.chunkCount||0);index++){
      const chunk=await ref.collection("chunks").doc(String(index).padStart(4,"0")).get();
      chunks.push(String(chunk.get("text")||""));
    }
    return data.valueType==="json"?JSON.parse(chunks.join("")):chunks.join("");
  }

  async function snapshotLegacyDocuments(branchId){
    const rows=[];
    const roots=await db.collection("scheduleStores").doc(branchId).collection("kv").get();
    for(const rootSnapshot of roots.docs){
      rows.push({path:rootSnapshot.ref.path,value:rootSnapshot.data()});
      const chunks=await rootSnapshot.ref.collection("chunks").get();
      chunks.docs.forEach(chunkSnapshot=>{
        rows.push({path:chunkSnapshot.ref.path,value:chunkSnapshot.data()});
      });
    }
    return rows.sort((left,right)=>left.path.localeCompare(right.path));
  }

  async function canonicalMismatchKeys(branchId,generationId){
    const legacyRoot={};
    const roots=await db.collection("scheduleStores").doc(branchId).collection("kv").get();
    for(const doc of roots.docs){
      const key=decodeURIComponent(doc.id.replace(/%2E/gi,"."));
      if(operationalModel.domainForLegacyKey(key)) legacyRoot[key]=await readLegacyValue(branchId,key);
    }
    const collections={};
    const names=[...new Set(Object.values(operationalModel.DOMAIN_COLLECTIONS).flat())];
    for(const name of names){
      const snapshot=await generationRef(branchId,generationId).collection(name).get();
      collections[name]=snapshot.docs.map(doc=>{
        const row=doc.data()||{};
        delete row.branchId;
        delete row.generationId;
        delete row.operationalRevision;
        delete row.lastOperationId;
        if(name==="attendanceSnapshots") delete row.complete;
        if(!row.id) row.id=decodeURIComponent(doc.id.replace(/%2E/gi,"."));
        return row;
      });
    }
    const left=operationalModel.trackedLegacyView(legacyRoot);
    const right=operationalModel.trackedLegacyView(operationalModel.legacyRootFromCollections({
      branchId,generationId,collections,
    }));
    return [...new Set([...Object.keys(left),...Object.keys(right)])]
      .filter(key=>operationalModel.canonicalDigest(left[key])!==operationalModel.canonicalDigest(right[key]))
      .sort();
  }

  function assertLegacySnapshotUnchanged(before,after){
    assert.equal(
      isDeepStrictEqual(after,before),
      true,
      "complete V1 root and chunk document snapshot changed",
    );
  }

  async function seedBranch(branchId,{invalidStudents=false}={}){
    const students=invalidStudents?{invalid:true}:[{
      sid:`${branchId}_student_a`,n:"Fixture A",t:"4시",d:"월",l:1,r:1,
    }];
    await writeLegacyValue(branchId,"swim_tab_list",[{id:"regular",name:"Regular",type:"regular"}]);
    await writeLegacyValue(branchId,"swim_main_tab",{tabId:"regular"});
    await writeLegacyValue(branchId,"swim_students",students,{chunked:true});
    await writeLegacyValue(branchId,"swim_inst",{"4시/월/1/1":"Fixture Teacher"});
    await writeLegacyValue(branchId,"swim_retire",{});
    await writeLegacyValue(branchId,"swim_enroll",{});
    const defaults={
      swim_parent_tab:{tabId:"regular"},
      swim_closed:[],
      swim_periods:[{month:8,start:"2026-08-03",end:"2026-08-29"}],
      swim_reserve:{},swim_teachers:[],
      swim_tab_folders:[],swim_archived_tabs:[],swim_hyuwon:{},swim_move:{},
      swim_mark:{},swim_retire_history:[],swim_desk_notes:[],swim_disabled:{},
      swim_attendance:{},swim_att_guests:{},swim_day_snapshot:{},
    };
    for(const [key,defaultValue] of Object.entries(defaults)){
      await writeLegacyValue(branchId,key,defaultValue);
    }
  }

  async function control(branchId,action){
    const data={branchId,action};
    if(action!=="status"){
      const status=await functions.manageScheduleV2Shadow.run({
        data:{branchId,action:"status"},auth:developerAuth,
      });
      Object.assign(data,{
        expectedMode:status.mode,
        expectedGenerationId:status.generationId,
        expectedEpoch:status.epoch,
        expectedRevision:status.revision,
      });
    }
    return functions.manageScheduleV2Shadow.run({data,auth:developerAuth});
  }

  async function queueWrite(branchId,write){
    await functions.queueScheduleV2Shadow.run({
      id:`schedule-v2-emulator-${branchId}-${++eventSequence}`,
      params:{branchId,docId:write.ref.id},
      data:{before:write.before,after:write.after},
      time:new Date().toISOString(),
    });
  }

  async function processQueue(branchId){
    await functions.processScheduleV2Shadow.run({params:{branchId},data:{}});
  }

  async function collectionSize(ref,name){
    return (await ref.collection(name).get()).size;
  }

  test.beforeEach(clearFirestore);
  test.after(clearFirestore);

  test("both branches prepare and shadow chunked student instructor and reservation changes",async()=>{
    for(const branchId of ["gagyeong","yongam"]){
      await seedBranch(branchId);
      const baselineV1=await snapshotLegacyDocuments(branchId);
      let prepared=await control(branchId,"prepare");
      assertLegacySnapshotUnchanged(baselineV1,await snapshotLegacyDocuments(branchId));
      assert.equal(prepared.mode,"v1");
      assert.equal(prepared.generationStatus,"ready");
      const firstGenerationId=prepared.preparedGenerationId;
      const readyChange=await writeLegacyValue(branchId,"swim_mark",{});
      await queueWrite(branchId,readyChange);
      const invalidated=await control(branchId,"status");
      assert.equal(invalidated.generationStatus,"syncing");
      await assert.rejects(
        control(branchId,"set-shadow"),
        error=>error&&error.code==="failed-precondition",
      );
      prepared=await control(branchId,"prepare");
      assert.notEqual(prepared.preparedGenerationId,firstGenerationId);
      assert.equal(prepared.generationStatus,"ready");
      assert.equal((await generationRef(branchId,firstGenerationId).get()).exists,true);
      assert.equal((await kvRef(branchId,"swim_students").get()).get("chunked"),true);
      assert.equal(await collectionSize(generationRef(branchId,prepared.preparedGenerationId),"people"),1);
      const activated=await control(branchId,"set-shadow");
      assert.equal(activated.mode,"shadow");
      const activeGenerationId=activated.generationId;

      const students=[
        {sid:`${branchId}_student_a`,n:"Fixture A",t:"4시",d:"월",l:1,r:1},
        {sid:`${branchId}_student_b`,n:"Fixture B",t:"5시",d:"화",l:1,r:1},
      ];
      const studentWrite=await writeLegacyValue(branchId,"swim_students",students,{chunked:true});
      const instructorWrite=await writeLegacyValue(branchId,"swim_inst",{
        "4시/월/1/1":"Fixture Teacher","5시/화/1/1":"Fixture Teacher 2",
      });
      const moveId=`${branchId}_move_1`;
      const retireWrite=await writeLegacyValue(branchId,"swim_retire",{
        "4시/월/1/1":{
          sid:`${branchId}_student_a`,name:"Fixture A",ds:"2026-08-10",
          moveType:"reserve",moveId,pairKey:"5시/화/1/1",
        },
      });
      const enrollWrite=await writeLegacyValue(branchId,"swim_enroll",{
        "5시/화/1/1":{
          sid:`${branchId}_student_a`,name:"Fixture A",ds:"2026-08-11",
          moveType:"reserve",moveId,pairKey:"4시/월/1/1",
        },
      });
      const changedV1=await snapshotLegacyDocuments(branchId);

      await queueWrite(branchId,studentWrite);
      await queueWrite(branchId,instructorWrite);
      await queueWrite(branchId,retireWrite);
      await queueWrite(branchId,enrollWrite);
      await processQueue(branchId);
      assertLegacySnapshotUnchanged(changedV1,await snapshotLegacyDocuments(branchId));

      const sync=(await runtimeRef(branchId,"scheduleSync").get()).data();
      assert.equal(sync.status,"idle");
      assert.deepEqual(sync.pendingKeys,[]);
      assert.equal(sync.mismatchCount,0);
      assert.equal(sync.appliedRevision,sync.requestedRevision);
      assert.equal(await collectionSize(generationRef(branchId,activeGenerationId),"people"),2);
      assert.equal(await collectionSize(generationRef(branchId,activeGenerationId),"placements"),2);
      assert.equal(await collectionSize(generationRef(branchId,activeGenerationId),"teacherAssignments"),2);
      assert.equal(await collectionSize(generationRef(branchId,activeGenerationId),"reservations"),1);
      assert.equal((await readLegacyValue(branchId,"swim_students")).length,2);
      assert.equal(Object.keys(await readLegacyValue(branchId,"swim_inst")).length,2);
      assert.equal(Object.keys(await readLegacyValue(branchId,"swim_retire")).length,1);
      assert.equal((await generationRef(branchId,activeGenerationId).get()).get("status"),"ready");
      assert.deepEqual(await canonicalMismatchKeys(branchId,activeGenerationId),[]);

      const rolledBack=await control(branchId,"rollback");
      assert.equal(rolledBack.mode,"v1");
      const preservedCount=await collectionSize(generationRef(branchId,activeGenerationId),"placements");
      const afterRollback=await writeLegacyValue(branchId,"swim_inst",{
        "7시/금/1/1":"Post Rollback Fixture",
      });
      const beforeRevision=(await runtimeRef(branchId,"scheduleSync").get()).get("requestedRevision");
      await queueWrite(branchId,afterRollback);
      assert.equal((await runtimeRef(branchId,"scheduleSync").get()).get("requestedRevision"),beforeRevision);
      assert.equal(await collectionSize(generationRef(branchId,activeGenerationId),"placements"),preservedCount);
      await assert.rejects(
        control(branchId,"set-shadow"),
        error=>error&&error.code==="failed-precondition",
      );
    }
  });

  test("failed preparation is redacted recoverable and rollback stops later queueing",async()=>{
    const branchId="gagyeong";
    await seedBranch(branchId,{invalidStudents:true});
    const invalidV1=await snapshotLegacyDocuments(branchId);
    await assert.rejects(
      control(branchId,"prepare"),
      error=>error&&error.code==="failed-precondition",
    );
    assertLegacySnapshotUnchanged(invalidV1,await snapshotLegacyDocuments(branchId));

    const source=await readLegacyValue(branchId,"swim_students");
    assert.equal(source.invalid,true);
    const generations=await db.collection("scheduleV2").doc(branchId).collection("generations").get();
    assert.equal(generations.size,1);
    assert.equal(generations.docs[0].get("status"),"failed");
    assert.equal(generations.docs.some(doc=>doc.get("status")==="ready"),false);

    const failedSync=(await runtimeRef(branchId,"scheduleSync").get()).data();
    assert.ok(["error","pending"].includes(failedSync.status));
    const alerts=await db.collection("scheduleV2").doc(branchId).collection("alerts").get();
    assert.equal(alerts.size,1);
    const alert=alerts.docs[0].data();
    assert.equal(alert.branchId,branchId);
    assert.equal(alert.status,"open");
    assert.equal(alert.count,1);
    assert.equal(JSON.stringify(alert).includes("Fixture A"),false);
    assert.equal(JSON.stringify(alert).includes("invalid"),false);

    const failedStatus=await control(branchId,"status");
    assert.equal(failedStatus.mode,"v1");
    assert.equal(failedStatus.preparationStatus,"failed");
    const beforeRevision=(await runtimeRef(branchId,"scheduleSync").get()).get("requestedRevision");
    const laterWrite=await writeLegacyValue(branchId,"swim_inst",{"6시/수/1/1":"Later Fixture"});
    const rolledBackV1=await snapshotLegacyDocuments(branchId);
    await queueWrite(branchId,laterWrite);
    assertLegacySnapshotUnchanged(rolledBackV1,await snapshotLegacyDocuments(branchId));
    const afterRollbackSync=await runtimeRef(branchId,"scheduleSync").get();
    assert.equal(afterRollbackSync.get("requestedRevision"),beforeRevision);
    assert.equal((await readLegacyValue(branchId,"swim_inst"))["6시/수/1/1"],"Later Fixture");
  });
}
