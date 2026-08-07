"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const ROOT=path.join(__dirname,"..");

function source(file){
  return fs.readFileSync(path.join(ROOT,file),"utf8");
}

function loadScheduleStore(){
  const context={window:{},console};
  vm.createContext(context);
  vm.runInContext(source("js/schedule-v2-store.js"),context);
  return context.window.SCScheduleV2Store;
}

test("staff pages do not load a browser timetable V2 writer",()=>{
  for(const file of ["index.html","desk.html","teacher.html","settings.html"]){
    assert.doesNotMatch(source(file),/schedule-v2-shadow\.js/,file);
  }
  assert.equal(fs.existsSync(path.join(ROOT,"js","schedule-v2-shadow.js")),false);
});

test("Firebase V1 mutations do not invoke browser timetable synchronization",()=>{
  const firebaseStore=source("js/firebase-store.js");
  assert.doesNotMatch(firebaseStore,/_scheduleV2Shadow/);
  assert.doesNotMatch(firebaseStore,/SCV2Shadow/);
});

test("the browser schedule V2 store exposes reads and no generic writes",()=>{
  const store=loadScheduleStore();
  assert.equal(typeof store.latestScheduleReadyGeneration,"function");
  assert.equal(typeof store.latestAttendanceReadyGeneration,"function");
  assert.equal(typeof store.readGenerationTabs,"function");
  assert.equal(typeof store.readGenerationTab,"function");
  for(const name of [
    "writeGeneration","syncShadowGeneration","syncShadowSnapshotScopes","verifyGeneration",
  ]) assert.equal(store[name],undefined,name);
});

test("Settings timetable mutations use only the authenticated callable",()=>{
  const settings=source("js/settings.js");
  assert.match(settings,/httpsCallable\('manageScheduleV2Shadow'\)/);
  assert.doesNotMatch(settings,/SCV2Shadow/);
  assert.doesNotMatch(settings,/SCScheduleV2Store\.writeGeneration/);
  assert.doesNotMatch(settings,/function runDataV2Build/);
});
