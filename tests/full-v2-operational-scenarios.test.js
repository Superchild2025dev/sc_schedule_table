"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {
  createOperationalSystem,model,parse,completeSelection,
}=require("./full-v2-operational-fixture.js");

function trackedDigest(root){
  const normalize=value=>{
    if(Array.isArray(value)) return value.map(normalize)
      .sort((left,right)=>model.canonicalDigest(left).localeCompare(model.canonicalDigest(right)));
    if(!value||typeof value!=="object") return value;
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,normalize(item)]));
  };
  return model.canonicalDigest(normalize(model.trackedLegacyView(root)));
}

function rows(root,key,fallback){return parse(root,key,fallback);}

async function mutate(gateway,keys,operationId,operationType,change,tabIds){
  const result=await gateway.transactionKeys(keys,root=>{
    change(root);
    return root;
  },{operationId,operationType,tabIds});
  assert.equal(result.committed,true,operationId);
  assert.equal(result.recoveryState,"applied",operationId);
  return result;
}

async function assertParity(system,branchId){
  const legacy=await system.legacyValues(branchId);
  assert.equal(trackedDigest(system.reconstructV2(branchId)),trackedDigest(legacy));
}

for(const branchId of ["gagyeong","yongam"]){
  test(`${branchId} V2-read executes regular and bangteuk operational workflows with V1 parity`,async()=>{
    const system=createOperationalSystem({branches:[branchId]});
    const cutover=await system.transition(branchId,"set-v2-read");
    assert.equal(cutover.mode,"v2-read");
    const gateway=system.gateway(branchId);
    await gateway.ready();
    const prefix=branchId==="gagyeong"?"G":"Y";
    const regular="swim_students";
    const bangteuk="swim_bt_summer_stu";
    let operation=0;
    const next=name=>`${branchId}_${String(++operation).padStart(2,"0")}_${name}`;

    await mutate(gateway,[regular],next("register_regular"),"add-student",root=>{
      const students=rows(root,regular,[]);
      students.push({sid:`${prefix}_r3`,n:`${prefix} Registered`,p:"01000000009",t:"6PM",d:"Wed",l:1,r:1});
      root[regular]=JSON.stringify(students);
    },["regular"]);
    await mutate(gateway,[bangteuk],next("register_bangteuk"),"add-student",root=>{
      const students=rows(root,bangteuk,[]);
      students.push({sid:`${prefix}_b3`,n:`${prefix} Camp Registered`,p:"01000000010",t:"1PM",d:"Fri",l:1,r:1});
      root[bangteuk]=JSON.stringify(students);
    },["summer"]);
    await mutate(gateway,[regular],next("replace"),"replace-student",root=>{
      const students=rows(root,regular,[]);
      students.find(student=>student.sid===`${prefix}_r1`).n=`${prefix} Replaced`;
      root[regular]=JSON.stringify(students);
    },["regular"]);
    await mutate(gateway,[bangteuk],next("move"),"move-student",root=>{
      const students=rows(root,bangteuk,[]);
      const student=students.find(item=>item.sid===`${prefix}_b2`);
      student.t="12PM";
      student.d="Fri";
      root[bangteuk]=JSON.stringify(students);
    },["summer"]);
    await mutate(gateway,["swim_inst","swim_bt_summer_inst"],next("teacher"),"update-teacher",root=>{
      const regularTeachers=rows(root,"swim_inst",{});
      const campTeachers=rows(root,"swim_bt_summer_inst",{});
      regularTeachers["4PM/Mon/1"]=`${prefix} Teacher Updated`;
      campTeachers["10AM/MonWedFri/2"]=`${prefix} Camp Teacher Updated`;
      root.swim_inst=JSON.stringify(regularTeachers);
      root.swim_bt_summer_inst=JSON.stringify(campTeachers);
    },["regular","summer"]);
    await mutate(gateway,["swim_retire","swim_enroll","swim_hyuwon"],next("reservations"),"update-reservation",root=>{
      root.swim_retire=JSON.stringify({
        "4PM/Mon/1/1":{n:`${prefix} Retire`,p:"01000000001",ds:"2026-08-11"},
        "11AM/TueThu/1/1":{moveId:`${prefix}_move`,pairKey:"12PM/Fri/1/1",n:`${prefix} Move`,p:"01000000004",ds:"2026-08-14",bangteuk:true},
      });
      root.swim_enroll=JSON.stringify({
        "6PM/Wed/1/1":{n:`${prefix} Enroll`,p:"01000000009",ds:"2026-08-12"},
        "12PM/Fri/1/1":{moveId:`${prefix}_move`,pairKey:"11AM/TueThu/1/1",n:`${prefix} Move`,p:"01000000004",ds:"2026-08-14",bangteuk:true},
      });
      root.swim_hyuwon=JSON.stringify({"5PM/Tue/1/1":{n:`${prefix} Leave`,p:"01000000002",ds:"2026-08-13"}});
    },["regular","summer"]);
    await mutate(gateway,["swim_reserve"],next("waitlist"),"update-waitlist",root=>{
      root.swim_reserve=JSON.stringify({"4PM/Mon/1":[{n:`${prefix} Waitlist`,p:"01000000011",date:"2026-08-14"}]});
    },["regular"]);
    await mutate(gateway,["swim_mark"],next("absence"),"absence-confirmation",root=>{
      root.swim_mark=JSON.stringify({"4PM/Mon/1/1/2026-08-11":{type:"absent",n:`${prefix} Replaced`,p:"01000000001"}});
    },["regular"]);
    await mutate(gateway,["swim_mark"],next("makeup"),"makeup",root=>{
      const marks=rows(root,"swim_mark",{});
      marks["4PM/Mon/1/1/2026-08-11"].sub={type:"makeup",n:`${prefix} Replaced`,p:"01000000001"};
      root.swim_mark=JSON.stringify(marks);
    },["regular"]);
    await mutate(gateway,["swim_mark"],next("absence_cancel"),"absence-cancel",root=>{
      const marks=rows(root,"swim_mark",{});
      marks["4PM/Mon/1/1/2026-08-11"]=marks["4PM/Mon/1/1/2026-08-11"].sub;
      root.swim_mark=JSON.stringify(marks);
    },["regular"]);
    await mutate(gateway,["swim_mark"],next("makeup_cancel"),"makeup-cancel",root=>{
      root.swim_mark=JSON.stringify({});
    },["regular"]);
    await mutate(gateway,["swim_attendance","swim_att_guests","swim_bt_attendance_summer","swim_bt_att_guests_summer"],next("attendance"),"attendance-batch",root=>{
      root.swim_attendance=JSON.stringify({"4PM/Mon/1/1/2026-08-11":{s:"present"}});
      root.swim_att_guests=JSON.stringify({"4PM/Mon/1/2026-08-11":[{n:`${prefix} Guest`,p:"01000000012"}]});
      root.swim_bt_attendance_summer=JSON.stringify({"10AM/MonWedFri/2/1/2026-08-11":{s:"present"}});
      root.swim_bt_att_guests_summer=JSON.stringify({"10AM/MonWedFri/2/2026-08-11":[{n:`${prefix} Camp Guest`,p:"01000000013"}]});
    },["regular","summer"]);
    await mutate(gateway,["swim_day_snapshot","swim_bt_day_snapshot_summer"],next("snapshots"),"attendance-snapshot",root=>{
      root.swim_day_snapshot=JSON.stringify({"2026-08-11":{students:[{sid:`${prefix}_r1`,n:`${prefix} Replaced`}],inst:{"4PM/Mon/1":`${prefix} Teacher Updated`},createdAt:"2026-08-11T03:00:00.000Z"}});
      root.swim_bt_day_snapshot_summer=JSON.stringify({"2026-08-11":{students:[{sid:`${prefix}_b1`,n:`${prefix} Camp One`}],inst:{"10AM/MonWedFri/2":`${prefix} Camp Teacher Updated`},createdAt:"2026-08-11T03:00:00.000Z"}});
    },["regular","summer"]);
    await mutate(gateway,["swim_disabled","swim_closed"],next("calendar"),"update-calendar",root=>{
      root.swim_disabled=JSON.stringify({"4PM/Mon/1/1":true,"10AM/MonWedFri/2/1":true});
      root.swim_closed=JSON.stringify([{start:"2026-08-15",type:"closed"}]);
    },["regular","summer"]);
    await mutate(gateway,["swim_periods"],next("periods"),"update-periods",root=>{
      root.swim_periods=JSON.stringify([{month:8,start:"2026-08-03",end:"2026-08-28"},{month:9,start:"2026-09-01",end:"2026-09-30"}]);
    },["regular","summer"]);
    await mutate(gateway,["swim_tab_list","swim_main_tab","swim_parent_tab"],next("tabs"),"update-tabs",root=>{
      const tabs=rows(root,"swim_tab_list",[]);
      tabs.find(tab=>tab.id==="regular").name=`${prefix} Regular Updated`;
      root.swim_tab_list=JSON.stringify(tabs);
      root.swim_main_tab=JSON.stringify({tabId:"regular",month:"2026-08"});
      root.swim_parent_tab=JSON.stringify({tabId:"regular"});
    },["regular","summer"]);
    await mutate(gateway,["swim_retire_history","swim_desk_notes"],next("manual_records"),"update-records",root=>{
      root.swim_retire_history=JSON.stringify([{id:`${prefix}_history`,n:`${prefix} Retired`,p:"01000000014",retiredAt:"2026-08-11"}]);
      root.swim_desk_notes=JSON.stringify([{id:`${prefix}_desk`,n:`${prefix} Desk`,p:"01000000015",memo:"manual record"}]);
    },["regular","summer"]);

    assert.equal(operation,17);
    assert.equal(system.runtime(branchId).revision,operation);
    await assertParity(system,branchId);
    const exportView=await gateway.loadSelection(completeSelection(await system.legacyValues(branchId)));
    assert.equal(exportView.primary,"v2");
    assert.equal(trackedDigest(exportView.root),trackedDigest(await system.legacyValues(branchId)));
    assert.equal(rows(exportView.root,regular,[]).find(student=>student.sid===`${prefix}_r1`).n,`${prefix} Replaced`);
    assert.equal(rows(exportView.root,bangteuk,[]).find(student=>student.sid===`${prefix}_b2`).t,"12PM");
    assert.equal(rows(exportView.root,"swim_retire",{})["11AM/TueThu/1/1"].moveId,`${prefix}_move`);
    assert.equal(rows(exportView.root,"swim_enroll",{})["12PM/Fri/1/1"].moveId,`${prefix}_move`);
  });
}
