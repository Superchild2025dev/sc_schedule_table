"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

function plain(value){ return JSON.parse(JSON.stringify(value)); }
function loadModules(){
  const context={window:{},console,Date,Promise,setTimeout,clearTimeout};
  vm.createContext(context);
  for(const file of [
    "schedule-time.js","schedule-schema-v2.js","attendance-v2-model.js",
    "attendance-operational-gateway.js","attendance-main-runtime.js",
  ]){
    vm.runInContext(
      fs.readFileSync(path.join(__dirname,"..","js",file),"utf8"),
      context,{filename:file}
    );
  }
  return {
    model:context.window.SCV2AttendanceModel,
    gateway:context.window.SCOperationalAttendance,
    runtime:context.window.SCMainAttendanceRuntime,
  };
}

const modules=loadModules();

function emptyTab(){ return {attendance:{},guests:{}}; }
function courseType(tabId){ return tabId==="regular"?"regular":"bangteuk"; }
function dateOfRecord(key){ return modules.model.parseRecordKey(key)?.value?.date||""; }
function dateOfGuest(key){ return modules.model.parseGuestKey(key)?.value?.date||""; }
function selected(map,dates,parser){
  const allowed=new Set(dates||[]);
  return Object.fromEntries(Object.entries(map||{}).filter(([key])=>allowed.has(parser(key))));
}

function createSystem(options={}){
  const branchId=options.branchId||"yongam";
  let mode=options.mode||"v1";
  let failV2Read=false;
  const operations=[];
  const state={legacy:{},v2:{}};
  for(const layer of ["legacy","v2"]){
    for(const tabId of ["regular","summer"]){
      state[layer][tabId]=plain(options[layer]?.[tabId]||emptyTab());
    }
  }

  function tab(layer,tabId){
    if(!state[layer][tabId]) state[layer][tabId]=emptyTab();
    return state[layer][tabId];
  }
  async function mutateLegacy(kind,mutator,input){
    const current=tab("legacy",input.tabId)[kind];
    const draft=plain(current);
    const returned=await mutator(draft);
    tab("legacy",input.tabId)[kind]=plain(returned&&typeof returned==="object"?returned:draft);
    return {[kind]:plain(tab("legacy",input.tabId)[kind])};
  }
  const legacy={
    async loadRange(input){
      const current=tab("legacy",input.tabId);
      return {
        attendance:selected(current.attendance,input.dates,dateOfRecord),
        guests:selected(current.guests,input.dates,dateOfGuest),
      };
    },
    updateAttendance(mutator,input){ return mutateLegacy("attendance",mutator,input); },
    updateGuests(mutator,input){ return mutateLegacy("guests",mutator,input); },
  };
  function v2Rows(tabId,dates){
    const current=tab("v2",tabId);
    const attendance=selected(current.attendance,dates,dateOfRecord);
    const guestsMap=selected(current.guests,dates,dateOfGuest);
    const records=Object.entries(attendance).map(([legacyKey,raw])=>modules.model.recordFromLegacy({
      tabId,courseType:courseType(tabId),legacyKey,raw,
    }));
    const guests=[];
    Object.entries(guestsMap).forEach(([legacyKey,list])=>{
      (Array.isArray(list)?list:[]).forEach((raw,index)=>guests.push(modules.model.guestFromLegacy({
        tabId,courseType:courseType(tabId),legacyKey,raw,index,
      })));
    });
    return {records,guests,maps:modules.model.mapsFromRows(records,guests)};
  }
  const v2Store={
    async readConfig(){
      return {mode,generationId:mode==="v1"?"":"gen_ready",branchId,epoch:3,revision:9,valid:true,compatibilityValid:true};
    },
    async readRange(input){
      if(failV2Read) throw new Error("forced V2 read failure");
      return v2Rows(input.tabId,input.dates);
    },
    async writeRecordBatch(changes){
      for(const change of changes){
        const tabId=change.row?.tabId||change.tabId||"regular";
        const target=tab("v2",tabId).attendance;
        if(change.type==="delete") delete target[change.legacyKey];
        else target[change.legacyKey]=plain(change.row.payload);
      }
      return {written:changes.length};
    },
    async replaceGuestGroup(input){
      const tabId=input.rows[0]?.tabId||input.existingRows[0]?.tabId||input.tabId||"regular";
      const target=tab("v2",tabId).guests;
      target[input.legacyKey]=input.rows.map(row=>plain(row.payload));
      if(!input.rows.length) delete target[input.legacyKey];
      return {written:input.rows.length};
    },
    async mutateMap(input){
      operations.push(plain(input));
      const target=tab("v2",input.tabId)[input.kind];
      const diff=modules.model.diffLegacyMaps(input.before,input.after);
      diff.upserts.forEach(change=>{target[change.legacyKey]=plain(change.raw);});
      diff.deletes.forEach(legacyKey=>{delete target[legacyKey];});
      if(mode==="v2-read"){
        const backup=tab("legacy",input.tabId)[input.kind];
        diff.upserts.forEach(change=>{backup[change.legacyKey]=plain(change.raw);});
        diff.deletes.forEach(legacyKey=>{delete backup[legacyKey];});
      }
      return {operationId:input.operationId,committed:true,revision:10,recoveryState:"applied"};
    },
    compareRange(input){
      const comparison=modules.model.compareLegacyRows({
        attendance:input.legacyAttendance,
        guests:input.legacyGuests,
        records:input.records,
        guestRows:input.guests,
      });
      return {...comparison,diagnostic:{ready:comparison.ready,mismatchCount:comparison.mismatchCount}};
    },
  };
  function gateway(){
    return modules.gateway.create({branchId,legacy,v2Store,model:modules.model});
  }
  return {
    branchId,state,gateway,operations,
    setMode(next){ mode=next; },
    failReads(value){ failV2Read=!!value; },
    snapshot(){ return plain(state); },
  };
}

const mondayKey="4시/월/1/1/2026-08-03";
const mondayOtherKey="4시/월/1/2/2026-08-03";
const summerKey="9시/월/1/1/2026-08-03";
const mondayRange={owner:"main",tabId:"regular",courseType:"regular",dates:["2026-08-03"]};

test("V1 attendance converts to V2 with exact parity",()=>{
  const attendance={[mondayKey]:{s:"present",at:"2026-08-03T09:00:00.000Z"}};
  const guestKey="4시/월/1/2026-08-03";
  const guests={[guestKey]:[{gid:"guest_1",n:"추가 원생",s:"present"}]};
  const records=Object.entries(attendance).map(([legacyKey,raw])=>modules.model.recordFromLegacy({
    tabId:"regular",courseType:"regular",legacyKey,raw,
  }));
  const guestRows=guests[guestKey].map((raw,index)=>modules.model.guestFromLegacy({
    tabId:"regular",courseType:"regular",legacyKey:guestKey,raw,index,
  }));
  const result=modules.model.compareLegacyRows({attendance,guests,records,guestRows});
  assert.equal(result.ready,true);
  assert.equal(result.mismatchCount,0);
});

test("shadow mode writes V1 without a direct browser V2 mirror",async()=>{
  const system=createSystem({mode:"shadow",legacy:{regular:{attendance:{[mondayKey]:{s:"absent"}},guests:{}}}});
  const gateway=system.gateway();
  await gateway.ready();
  await gateway.updateAttendance(map=>({...map,[mondayKey]:{s:"present"}}),{
    ...mondayRange,before:{[mondayKey]:{s:"absent"}},
  });
  assert.equal(system.state.legacy.regular.attendance[mondayKey].s,"present");
  assert.deepEqual(system.state.v2.regular.attendance,{});
  assert.equal(system.operations.length,0);
});

test("bangteuk batch checks never modify regular attendance",async()=>{
  const regular={[mondayKey]:{s:"present"}};
  const system=createSystem({
    mode:"v2",
    legacy:{
      regular:{attendance:regular,guests:{}},
      summer:{attendance:{[summerKey]:{s:"absent"}},guests:{}},
    },
    v2:{regular:{attendance:regular,guests:{}}},
  });
  const gateway=system.gateway();
  await gateway.ready();
  await gateway.setManyAttendance({
    owner:"teacher",tabId:"summer",courseType:"bangteuk",dates:["2026-08-03"],
    before:{[summerKey]:{s:"absent"}},after:{[summerKey]:{s:"present"}},
  });
  assert.deepEqual(system.state.legacy.regular.attendance,regular);
  assert.deepEqual(system.state.v2.regular.attendance,regular);
  assert.equal(system.state.v2.summer.attendance[summerKey].s,"present");
});

test("regular and bangteuk individual and batch writes stay in distinct operational domains",async()=>{
  const regular={[mondayKey]:{s:"absent"}};
  const summer={[summerKey]:{s:"absent"}};
  const system=createSystem({mode:"v2",v2:{regular:{attendance:regular,guests:{}},summer:{attendance:summer,guests:{}}}});
  const gateway=system.gateway();
  await gateway.ready();
  await gateway.updateAttendance(map=>({...map,[mondayKey]:{s:"present"}}),{
    ...mondayRange,before:regular,operationId:"regular_one",
  });
  await gateway.setManyAttendance({
    owner:"teacher",tabId:"summer",courseType:"bangteuk",dates:["2026-08-03"],
    before:summer,after:{[summerKey]:{s:"present"}},operationId:"bangteuk_batch",
  });

  assert.equal(system.state.v2.regular.attendance[mondayKey].s,"present");
  assert.equal(system.state.v2.summer.attendance[summerKey].s,"present");
  assert.deepEqual(system.operations.map(item=>[item.tabId,item.courseType,item.operationType]),[
    ["regular","regular","attendance-update"],
    ["summer","bangteuk","attendance-batch"],
  ]);
});

test("two devices checking different students preserve both changes",async()=>{
  const initial={[mondayKey]:{s:"absent"},[mondayOtherKey]:{s:"absent"}};
  const system=createSystem({mode:"v2",v2:{regular:{attendance:initial,guests:{}}}});
  const first=system.gateway();
  const second=system.gateway();
  await Promise.all([first.ready(),second.ready()]);
  await first.updateAttendance(map=>({...map,[mondayKey]:{s:"present"}}),{
    ...mondayRange,before:plain(initial),
  });
  await second.updateAttendance(map=>({...map,[mondayOtherKey]:{s:"present"}}),{
    ...mondayRange,before:plain(initial),
  });
  assert.equal(system.state.v2.regular.attendance[mondayKey].s,"present");
  assert.equal(system.state.v2.regular.attendance[mondayOtherKey].s,"present");
  assert.deepEqual(system.state.legacy.regular.attendance,{});
});

test("guest attendance can be added, checked, and deleted in both stores",async()=>{
  const guestKey="4시/월/1/2026-08-03";
  const system=createSystem({mode:"shadow"});
  const gateway=system.gateway();
  await gateway.ready();
  await gateway.updateGuests(map=>({...map,[guestKey]:[{gid:"g1",n:"추가 원생"}]}),{
    ...mondayRange,before:{},
  });
  await gateway.updateGuests(map=>({...map,[guestKey]:map[guestKey].map(row=>({...row,s:"present"}))}),{
    ...mondayRange,before:plain(system.state.legacy.regular.guests),
  });
  await gateway.updateGuests(map=>{delete map[guestKey];return map;} ,{
    ...mondayRange,before:plain(system.state.legacy.regular.guests),
  });
  assert.deepEqual(system.state.legacy.regular.guests,{});
  assert.deepEqual(system.state.v2.regular.guests,{});
});

test("one attendance range may cross two calendar months",async()=>{
  const august="4시/월/1/1/2026-08-31";
  const september="4시/화/1/1/2026-09-01";
  const attendance={[august]:{s:"present"},[september]:{s:"absent"}};
  const system=createSystem({mode:"v2-read",v2:{regular:{attendance,guests:{}}}});
  const gateway=system.gateway();
  await gateway.ready();
  const loaded=await gateway.loadRange({
    owner:"month-boundary",tabId:"regular",courseType:"regular",
    dates:["2026-08-31","2026-09-01"],
  });
  assert.deepEqual(plain(loaded.attendance),attendance);
});

test("historical attendance remains queryable by its original date",async()=>{
  const historical="5시/토/1/1/2026-05-30";
  const system=createSystem({mode:"v2-read",v2:{regular:{attendance:{[historical]:{s:"present"}},guests:{}}}});
  const gateway=system.gateway();
  await gateway.ready();
  const loaded=await gateway.loadRange({
    owner:"history",tabId:"regular",courseType:"regular",dates:["2026-05-30"],
  });
  assert.equal(loaded.attendance[historical].s,"present");
});

test("a V2 read failure leaves the currently visible attendance untouched",async()=>{
  const system=createSystem({mode:"v2-read",v2:{regular:{attendance:{[mondayKey]:{s:"present"}},guests:{}}}});
  const gateway=system.gateway();
  let visible={attendance:{"기존/표시/키/2026-08-02":{s:"present"}},guests:{}};
  const runtime=modules.runtime.create({
    branchId:"yongam",gateway,
    async prepareKeys(){},
    getMaps(){ return plain(visible); },
    setMaps(next){ visible=plain(next); },
  });
  system.failReads(true);
  await assert.rejects(()=>runtime.loadRanges({owner:"main",ranges:[{
    tabId:"regular",courseType:"regular",dates:["2026-08-03"],baseKeys:[],attendanceKeys:[],
  }]}),/V2 출석 데이터를 불러오지 못했습니다/);
  assert.deepEqual(visible,{attendance:{"기존/표시/키/2026-08-02":{s:"present"}},guests:{}});
});

test("rollback from v2-read reloads the V1 backup with the latest check",async()=>{
  const initial={[mondayKey]:{s:"absent"}};
  const system=createSystem({
    mode:"v2-read",
    legacy:{regular:{attendance:initial,guests:{}}},
    v2:{regular:{attendance:initial,guests:{}}},
  });
  const v2Gateway=system.gateway();
  await v2Gateway.ready();
  await v2Gateway.updateAttendance(map=>({...map,[mondayKey]:{s:"present"}}),{
    ...mondayRange,before:initial,
  });
  system.setMode("v1");
  const v1Gateway=system.gateway();
  await v1Gateway.ready();
  const loaded=await v1Gateway.loadRange(mondayRange);
  assert.equal(loaded.primary,"v1");
  assert.equal(loaded.attendance[mondayKey].s,"present");
});

test("branch-scoped attendance systems never share changes",async()=>{
  const gagyeong=createSystem({branchId:"gagyeong",mode:"v2"});
  const yongam=createSystem({branchId:"yongam",mode:"v2"});
  const gateway=gagyeong.gateway();
  await gateway.ready();
  await gateway.updateAttendance(map=>({...map,[mondayKey]:{s:"present"}}),{
    ...mondayRange,before:{},
  });
  assert.equal(gagyeong.state.v2.regular.attendance[mondayKey].s,"present");
  assert.deepEqual(yongam.state.v2.regular.attendance,{});
});
