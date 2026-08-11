"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {
  createOperationalSystem,model,parse,completeSelection,
}=require("./full-v2-operational-fixture.js");

function trackedDigest(root){return model.canonicalDigest(model.trackedLegacyView(root));}
function rows(root,key,fallback){return parse(root,key,fallback);}

async function assertParity(system,branchId){
  const legacy=await system.legacyValues(branchId);
  assert.equal(trackedDigest(system.reconstructV2(branchId)),trackedDigest(legacy));
}

for(const branchId of ["gagyeong","yongam"]){
  test(`${branchId} V2-read invokes production operational workflows for regular and bangteuk data`,async()=>{
    const system=createOperationalSystem({branches:[branchId]});
    const cutover=await system.transition(branchId,"set-v2-read");
    assert.equal(cutover.mode,"v2-read");
    const workflows=system.workflows(branchId);
    const gateway=system.gateway(branchId);
    await gateway.ready();
    const prefix=branchId==="gagyeong"?"G":"Y";
    let operation=0;
    const next=(name,operationType,tabIds)=>({
      operationId:`${branchId}_${String(++operation).padStart(2,"0")}_${name}`,
      operationType,tabIds,
    });

    await workflows.registerStudent({...next("register_regular","add-student",["regular"]),key:"swim_students",student:{sid:`${prefix}_r3`,n:`${prefix} Registered`,p:"01000000009",t:"6PM",d:"Wed",l:1,r:1}});
    await workflows.registerStudent({...next("register_bangteuk","add-student",["summer"]),key:"swim_bt_summer_stu",student:{sid:`${prefix}_b3`,n:`${prefix} Camp Registered`,p:"01000000010",t:"1PM",d:"Fri",l:1,r:1}});
    await workflows.replaceStudent({...next("replace","replace-student",["regular"]),key:"swim_students",sid:`${prefix}_r1`,replacement:{n:`${prefix} Replaced`}});
    await workflows.moveStudent({...next("move","move-student",["summer"]),key:"swim_bt_summer_stu",sid:`${prefix}_b2`,destination:{t:"12PM",d:"Fri"}});
    await workflows.updateTeachers({...next("teacher","update-teacher",["regular","summer"]),keys:["swim_inst","swim_bt_summer_inst"],assignments:{
      swim_inst:{"4PM/Mon/1":`${prefix} Teacher Updated`},
      swim_bt_summer_inst:{"10AM/MonWedFri/2":`${prefix} Camp Teacher Updated`},
    }});
    await workflows.setReservations({...next("reservations","update-reservation",["regular","summer"]),keys:["swim_retire","swim_enroll","swim_hyuwon"],values:{
      swim_retire:{"4PM/Mon/1/1":{n:`${prefix} Retire`,p:"01000000001",ds:"2026-08-11"},"11AM/TueThu/1/1":{moveId:`${prefix}_move`,pairKey:"12PM/Fri/1/1",n:`${prefix} Move`,p:"01000000004",ds:"2026-08-14",bangteuk:true}},
      swim_enroll:{"6PM/Wed/1/1":{n:`${prefix} Enroll`,p:"01000000009",ds:"2026-08-12"},"12PM/Fri/1/1":{moveId:`${prefix}_move`,pairKey:"11AM/TueThu/1/1",n:`${prefix} Move`,p:"01000000004",ds:"2026-08-14",bangteuk:true}},
      swim_hyuwon:{"5PM/Tue/1/1":{n:`${prefix} Leave`,p:"01000000002",ds:"2026-08-13"}},
    }});
    await workflows.addWaitlistEntry({...next("waitlist","update-waitlist",["regular"]),key:"swim_reserve",slotKey:"4PM/Mon/1",entry:{n:`${prefix} Waitlist`,p:"01000000011",date:"2026-08-14"}});
    await workflows.setClassMark({...next("absence","absence-confirmation",["regular"]),key:"swim_mark",markKey:"4PM/Mon/1/1/2026-08-11",mark:{type:"absent",n:`${prefix} Replaced`,p:"01000000001"}});
    await workflows.setClassMark({...next("bogang","makeup",["regular"]),key:"swim_mark",markKey:"4PM/Mon/1/1/2026-08-12",mark:{type:"bogang",n:`${prefix} Replaced`,p:"01000000001"}});
    await workflows.setClassMark({...next("sample","sample-makeup",["regular"]),key:"swim_mark",markKey:"4PM/Mon/1/1/2026-08-13",mark:{type:"sample",n:`${prefix} Sample`,p:"01000000001"}});
    await workflows.setClassMark({...next("mandatory_makeup","mandatory-makeup",["regular"]),key:"swim_mark",markKey:"4PM/Mon/1/1/2026-08-14",mark:{type:"bogang",mandatoryMakeup:true,n:`${prefix} Mandatory`,p:"01000000001"}});
    await workflows.clearClassMark({...next("absence_cancel","absence-cancel",["regular"]),key:"swim_mark",markKey:"4PM/Mon/1/1/2026-08-11"});
    await workflows.clearClassMark({...next("makeup_cancel","makeup-cancel",["regular"]),key:"swim_mark",markKey:"4PM/Mon/1/1/2026-08-12"});
    await workflows.updateAttendance({...next("attendance","attendance-batch",["regular","summer"]),keys:["swim_attendance","swim_att_guests","swim_bt_attendance_summer","swim_bt_att_guests_summer"],values:{
      swim_attendance:{"4PM/Mon/1/1/2026-08-11":{s:"present"}},
      swim_att_guests:{"4PM/Mon/1/2026-08-11":[{n:`${prefix} Guest`,p:"01000000012"}]},
      swim_bt_attendance_summer:{"10AM/MonWedFri/2/1/2026-08-11":{s:"present"}},
      swim_bt_att_guests_summer:{"10AM/MonWedFri/2/2026-08-11":[{n:`${prefix} Camp Guest`,p:"01000000013"}]},
    }});
    await workflows.createSnapshot({scope:"regular",date:"2026-08-11",tabId:"regular",creationIdentity:`${prefix}_regular_snapshot`,snapshot:{students:[{sid:`${prefix}_r1`,n:`${prefix} Replaced`}],inst:{"4PM/Mon/1":`${prefix} Teacher Updated`},createdAt:"2026-08-11T03:00:00.000Z"}});
    await workflows.createSnapshot({scope:"bt_summer",date:"2026-08-11",tabId:"summer",creationIdentity:`${prefix}_summer_snapshot`,snapshot:{students:[{sid:`${prefix}_b1`,n:`${prefix} Camp One`}],inst:{"10AM/MonWedFri/2":`${prefix} Camp Teacher Updated`},createdAt:"2026-08-11T03:00:00.000Z"}});
    await workflows.updateCalendar({...next("calendar","update-calendar",["regular","summer"]),keys:["swim_disabled","swim_closed"],values:{swim_disabled:{"4PM/Mon/1/1":true,"10AM/MonWedFri/2/1":true},swim_closed:[{start:"2026-08-15",type:"closed"}]}});
    await workflows.updateCalendar({...next("periods","update-periods",["regular","summer"]),keys:["swim_periods"],values:{swim_periods:[{month:8,start:"2026-08-03",end:"2026-08-28"},{month:9,start:"2026-09-01",end:"2026-09-30"}]}});
    await workflows.updateTabs({...next("tabs","update-tabs",["regular","summer"]),keys:["swim_tab_list","swim_main_tab","swim_parent_tab"],values:{
      swim_tab_list:[{id:"regular",name:`${prefix} Regular Updated`,type:"regular",periodMonth:"2026-08"},{id:"summer",name:`${prefix} Summer`,type:"bangteuk",periodMonth:"2026-08",seasonStart:"2026-08-03",seasonEnd:"2026-08-28"}],
      swim_main_tab:{tabId:"regular",month:"2026-08"},swim_parent_tab:{tabId:"regular"},
    }});
    await workflows.updateManualRecords({...next("manual_records","update-records",["regular","summer"]),keys:["swim_retire_history","swim_desk_notes"],values:{
      swim_retire_history:[{id:`${prefix}_history`,n:`${prefix} Retired`,p:"01000000014",retiredAt:"2026-08-11"}],
      swim_desk_notes:[{id:`${prefix}_desk`,n:`${prefix} Desk`,p:"01000000015",memo:"manual record"}],
    }});

    assert.equal(operation,18);
    assert.equal(system.runtime(branchId).revision,20);
    await assertParity(system,branchId);
    const exportView=await workflows.exportSelection({selection:completeSelection(await system.legacyValues(branchId))});
    assert.equal(exportView.primary,"v2");
    assert.equal(trackedDigest(exportView.root),trackedDigest(await system.legacyValues(branchId)));
    assert.deepEqual(rows(exportView.root,"swim_students",[]).map(student=>student.sid),[`${prefix}_r1`,`${prefix}_r2`,`${prefix}_r3`]);
    assert.deepEqual(rows(exportView.root,"swim_tab_list",[]).map(tab=>tab.id),["regular","summer"]);
    assert.deepEqual(rows(exportView.root,"swim_periods",[]).map(period=>period.month),[8,9]);
    assert.deepEqual(rows(exportView.root,"swim_reserve",{})["4PM/Mon/1"].map(entry=>entry.n),[`${prefix} Waitlist`]);
    assert.equal(rows(exportView.root,"swim_bt_summer_stu",[]).find(student=>student.sid===`${prefix}_b2`).t,"12PM");
    assert.equal(rows(exportView.root,"swim_retire",{})["11AM/TueThu/1/1"].moveId,`${prefix}_move`);
    assert.equal(rows(exportView.root,"swim_enroll",{})["12PM/Fri/1/1"].moveId,`${prefix}_move`);
  });
}
