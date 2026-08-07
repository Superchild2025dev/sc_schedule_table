"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

function loadStore(){
  const context={window:{},console};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,"..","js","schedule-v2-store.js"),"utf8"),context);
  return context.window.SCScheduleV2Store;
}

function capability(status,appliedRevision,verifiedAt){
  return {status,appliedRevision,verifiedAt};
}

test("unsafe document ids are encoded deterministically",()=>{
  const store=loadStore();
  assert.equal(store.safeDocId("regular.2026"),"regular%2E2026");
  assert.equal(store.safeDocId("regular.2026"),store.safeDocId("regular.2026"));
});

test("schedule preview selects only a schedule-ready capability",()=>{
  const store=loadStore();
  const selected=store.latestScheduleReadyFromRows([
    {id:"generic",status:"ready",createdAt:"2026-08-07T04:00:00.000Z"},
    {
      id:"attendance-only",status:"ready",createdAt:"2026-08-07T03:00:00.000Z",
      capabilities:{attendance:capability("ready",7,"2026-08-07T03:00:00.000Z")},
    },
    {
      id:"schedule-old",status:"ready",createdAt:"2026-08-07T01:00:00.000Z",
      capabilities:{schedule:capability("ready",4,"2026-08-07T01:00:00.000Z")},
    },
    {
      id:"schedule-new",status:"ready",createdAt:"2026-08-07T02:00:00.000Z",
      capabilities:{schedule:capability("ready",5,"2026-08-07T02:00:00.000Z")},
    },
  ]);
  assert.equal(selected.id,"schedule-new");
});

test("attendance controls select only an attendance-verified capability",()=>{
  const store=loadStore();
  const selected=store.latestAttendanceReadyFromRows([
    {id:"generic",status:"ready",createdAt:"2026-08-07T05:00:00.000Z"},
    {
      id:"schedule-only",status:"ready",createdAt:"2026-08-07T04:00:00.000Z",
      capabilities:{schedule:capability("ready",9,"2026-08-07T04:00:00.000Z")},
    },
    {
      id:"attendance-invalid",status:"ready",createdAt:"2026-08-07T03:00:00.000Z",
      capabilities:{attendance:capability("ready",3,"")},
    },
    {
      id:"attendance-ready",status:"ready",createdAt:"2026-08-07T02:00:00.000Z",
      capabilities:{attendance:capability("ready",2,"2026-08-07T02:00:00.000Z")},
    },
  ]);
  assert.equal(selected.id,"attendance-ready");
});

test("legacy full-generation verification remains attendance-compatible without blessing schedule-only generations",()=>{
  const store=loadStore();
  const selected=store.latestAttendanceReadyFromRows([{
    id:"legacy-attendance",status:"ready",createdAt:"2026-08-06T02:00:00.000Z",
    verifiedAt:"2026-08-06T02:00:00.000Z",
    verification:{
      matches:true,countMatches:true,contentMatches:true,
      expected:{
        attendanceRecords:1,attendanceGuests:0,attendanceSnapshots:1,
        attendanceSnapshotStudents:1,attendanceSnapshotTeachers:1,
      },
    },
  },{
    id:"schedule-only",status:"ready",createdAt:"2026-08-07T02:00:00.000Z",
    capabilities:{schedule:capability("ready",9,"2026-08-07T02:00:00.000Z")},
  }]);
  assert.equal(selected.id,"legacy-attendance");
});

test("non-ready domain capabilities are never selected",()=>{
  const store=loadStore();
  const rows=[{
    id:"syncing",createdAt:"2026-08-07T02:00:00.000Z",
    capabilities:{
      schedule:capability("syncing",4,"2026-08-07T01:00:00.000Z"),
      attendance:capability("error",8,"2026-08-07T01:00:00.000Z"),
    },
  }];
  assert.equal(store.latestScheduleReadyFromRows(rows),null);
  assert.equal(store.latestAttendanceReadyFromRows(rows),null);
});

test("the schedule store has no generic browser mutation surface",()=>{
  const store=loadStore();
  for(const name of [
    "generationDocuments","expectedCounts","expectedCollectionDocuments","writeGeneration",
    "syncShadowGeneration","syncShadowSnapshotScopes","verifyGeneration","latestReadyGeneration",
    "latestUsableGeneration",
  ]) assert.equal(store[name],undefined,name);
  assert.equal(typeof store.readGenerationTabs,"function");
  assert.equal(typeof store.readGenerationTab,"function");
});

test("collection digests ignore key order and detect content changes",()=>{
  const store=loadStore();
  const left=store.collectionDigest([{id:"row",value:{a:1,b:{c:2,d:3}}}]);
  const reordered=store.collectionDigest([{id:"row",value:{b:{d:3,c:2},a:1}}]);
  const changed=store.collectionDigest([{id:"row",value:{a:1,b:{c:2,d:4}}}]);
  assert.equal(left,reordered);
  assert.notEqual(left,changed);
});
