"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {
  createOperationalSystem,model,parse,completeSelection,
}=require("./full-v2-operational-fixture.js");
const liveHandlersApi=require("../js/schedule-live-handlers.js");

function trackedDigest(root){return model.canonicalDigest(model.trackedLegacyView(root));}
function rows(root,key,fallback){return parse(root,key,fallback);}
function withValueContext(input){
  return {...input,mutateContext:ctx=>{
    Object.entries(input.values||{}).forEach(([key,value])=>ctx.set(key,value));
    return true;
  }};
}
function withWaitlistContext(input){
  return {...input,mutateContext:ctx=>{
    const reserve=ctx.get(input.key,{});
    const entries=Array.isArray(reserve[input.slotKey])?reserve[input.slotKey]:[];
    entries.push(input.entry);
    reserve[input.slotKey]=entries;
    ctx.set(input.key,reserve);
    return true;
  }};
}
function withStudentRegistrationContext(input){
  return {...input,mutateContext:ctx=>{
    const students=ctx.get(input.key,[]);
    students.push(input.student);
    ctx.set(input.key,students);
    return true;
  }};
}
function withStudentMoveContext(input){
  return {...input,mutateContext:ctx=>{
    const students=ctx.get(input.key,[]);
    const student=students.find(item=>item.sid===input.sid);
    assert.ok(student,"student to move must exist");
    Object.assign(student,input.destination);
    ctx.set(input.key,students);
    return true;
  }};
}
function withTeacherContext(input){
  return {...input,mutateContext:ctx=>{
    Object.entries(input.assignments||{}).forEach(([key,updates])=>{
      const teachers=ctx.get(key,{});
      Object.assign(teachers,updates);
      ctx.set(key,teachers);
    });
    return true;
  }};
}
function withMarkContext(input,remove=false){
  return {...input,mutateContext:ctx=>{
    const marks=ctx.get(input.key,{});
    if(remove) delete marks[input.markKey];
    else marks[input.markKey]=input.mark;
    ctx.set(input.key,marks);
    return true;
  }};
}

async function assertParity(system,branchId){
  const legacy=await system.legacyValues(branchId);
  assert.equal(trackedDigest(system.reconstructV2(branchId)),trackedDigest(legacy));
}

for(const branchId of ["gagyeong","yongam"]){
  test(`${branchId} V2-read invokes live operational handlers for regular and bangteuk data`,async()=>{
    const system=createOperationalSystem({branches:[branchId]});
    const cutover=await system.transition(branchId,"set-v2-read");
    assert.equal(cutover.mode,"v2-read");
    let handlers=system.liveHandlers(branchId);
    const gateway=system.gateway(branchId);
    await gateway.ready();
    const prefix=branchId==="gagyeong"?"G":"Y";
    let operation=0;
    const next=(name,operationType,tabIds)=>({
      operationId:`${branchId}_${String(++operation).padStart(2,"0")}_${name}`,
      operationType,tabIds,
    });

    await handlers.registerStudent(withStudentRegistrationContext({...next("register_regular","add-student",["regular"]),key:"swim_students",student:{sid:`${prefix}_r3`,n:`${prefix} Registered`,p:"01000000009",t:"6PM",d:"Wed",l:1,r:1}}));
    await handlers.registerStudent(withStudentRegistrationContext({...next("register_bangteuk","add-student",["summer"]),key:"swim_bt_summer_stu",student:{sid:`${prefix}_b3`,n:`${prefix} Camp Registered`,p:"01000000010",t:"1PM",d:"Fri",l:1,r:1}}));
    await handlers.setReservations(withValueContext({...next("replacement_state","update-reservation",["regular"]),keys:["swim_hyuwon"],values:{
      swim_hyuwon:{"4PM/Mon/1/1":{dates:["2026-08-12"]}},
    }}));
    await handlers.updateCalendar(withValueContext({...next("replacement_disabled","update-calendar",["regular"]),keys:["swim_disabled"],values:{
      swim_disabled:{"4PM/Mon/1/1":true},
    }}));
    await handlers.setClassMark(withMarkContext({...next("replacement_mark","absence-confirmation",["regular"]),key:"swim_mark",markKey:"4PM/Mon/1/1/2026-08-12",mark:{type:"absent",n:`${prefix} Regular One`,p:"01000000001"}}));
    await handlers.replaceScheduledStudents({...next("replace","replace-student",["regular"]),
      keys:["swim_students","swim_enroll","swim_retire","swim_hyuwon","swim_mark","swim_disabled","swim_requests","swim_attendance"],studentKey:"swim_students",
      enrollKey:"swim_enroll",retireKey:"swim_retire",hyuwonKey:"swim_hyuwon",slotKey:"4PM/Mon/1/1",
      slotKeys:["4PM/Mon/1/1"],cleanupKeys:["swim_mark","swim_disabled"],
      todayStr:"2026-08-11",periodMonth:8,
      retireEntry:{sid:`${prefix}_r1`,n:`${prefix} Regular One`,p:"01000000001",ds:"2026-08-10"},
      enrollEntry:{sid:`${prefix}_replacement`,name:`${prefix} Replaced`,p:"01000000001",age:10,ds:"2026-08-10"},
      transactionMetadata:{
        type:"edit",label:"원생 교체",target:`${prefix} Regular One -> ${prefix} Replaced`,
        detail:"4PM/Mon/1/1 replacement",deleteReason:"student-replace",skipUndo:true,bangteuk:false,
      },
      mutateContext:ctx=>{
        const students=ctx.get("swim_students",[]);
        const index=students.findIndex(student=>student.t==="4PM"&&student.d==="Mon"&&student.l===1&&student.r===1);
        assert.notEqual(index,-1);
        students.splice(index,1);
        students.push({sid:`${prefix}_replacement`,n:`${prefix} Replaced`,p:"01000000001",a:10,t:"4PM",d:"Mon",l:1,r:1});
        const state={
          retire:ctx.get("swim_retire",{}),enroll:ctx.get("swim_enroll",{}),
          marks:ctx.get("swim_mark",{}),hyuwon:ctx.get("swim_hyuwon",{}),
          disabled:ctx.get("swim_disabled",{}),requests:ctx.get("swim_requests",{}),
          attendance:ctx.get("swim_attendance",{}),
        };
        liveHandlersApi.clearReplacementFutureState(state,["4PM/Mon/1/1"],"2026-08-11");
        ctx.set("swim_students",students);
        ctx.set("swim_retire",state.retire);ctx.set("swim_enroll",state.enroll);
        ctx.set("swim_mark",state.marks);ctx.set("swim_hyuwon",state.hyuwon);
        ctx.set("swim_disabled",state.disabled);ctx.set("swim_requests",state.requests);
        ctx.set("swim_attendance",state.attendance);
        return true;
      },
    });
    const replaced=await system.legacyValues(branchId);
    assert.deepEqual(rows(replaced,"swim_students",[]).map(student=>student.sid),[`${prefix}_r2`,`${prefix}_r3`,`${prefix}_replacement`]);
    assert.deepEqual(rows(replaced,"swim_enroll",{}),{});
    assert.deepEqual(rows(replaced,"swim_retire",{}),{});
    assert.deepEqual(rows(replaced,"swim_hyuwon",{}),{});
    assert.deepEqual(rows(replaced,"swim_mark",{}),{});
    assert.deepEqual(rows(replaced,"swim_disabled",{}),{});
    await handlers.moveStudent(withStudentMoveContext({...next("move","move-student",["summer"]),key:"swim_bt_summer_stu",sid:`${prefix}_b2`,destination:{t:"12PM",d:"Fri"}}));
    await handlers.updateTeachers(withTeacherContext({...next("teacher","update-teacher",["regular","summer"]),keys:["swim_inst","swim_bt_summer_inst"],assignments:{
      swim_inst:{"4PM/Mon/1":`${prefix} Teacher Updated`},
      swim_bt_summer_inst:{"10AM/MonWedFri/2":`${prefix} Camp Teacher Updated`},
    }}));
    await handlers.setReservations(withValueContext({...next("reservations","update-reservation",["regular","summer"]),keys:["swim_retire","swim_enroll","swim_hyuwon"],values:{
      swim_retire:{"4PM/Mon/1/1":{n:`${prefix} Retire`,p:"01000000001",ds:"2026-08-11"},"11AM/TueThu/1/1":{moveId:`${prefix}_move`,pairKey:"12PM/Fri/1/1",n:`${prefix} Move`,p:"01000000004",ds:"2026-08-14",bangteuk:true}},
      swim_enroll:{"6PM/Wed/1/1":{n:`${prefix} Enroll`,p:"01000000009",ds:"2026-08-12"},"12PM/Fri/1/1":{moveId:`${prefix}_move`,pairKey:"11AM/TueThu/1/1",n:`${prefix} Move`,p:"01000000004",ds:"2026-08-14",bangteuk:true}},
      swim_hyuwon:{"5PM/Tue/1/1":{n:`${prefix} Leave`,p:"01000000002",ds:"2026-08-13"}},
    }}));
    await handlers.addWaitlistEntry(withWaitlistContext({...next("waitlist","update-waitlist",["regular"]),key:"swim_reserve",slotKey:"4PM/Mon/1",entry:{n:`${prefix} Waitlist A`,p:"01000000011",date:"2026-08-14"}}));
    await handlers.addWaitlistEntry(withWaitlistContext({...next("waitlist_second","update-waitlist",["regular"]),key:"swim_reserve",slotKey:"4PM/Mon/1",entry:{n:`${prefix} Waitlist B`,p:"01000000016",date:"2026-08-15"}}));
    await handlers.setClassMark(withMarkContext({...next("absence","absence-confirmation",["regular"]),key:"swim_mark",markKey:"4PM/Mon/1/1/2026-08-11",mark:{type:"absent",n:`${prefix} Replaced`,p:"01000000001"}}));
    await handlers.setClassMark(withMarkContext({...next("bogang","makeup",["regular"]),key:"swim_mark",markKey:"4PM/Mon/1/1/2026-08-12",mark:{type:"bogang",n:`${prefix} Replaced`,p:"01000000001"}}));
    await handlers.setClassMark(withMarkContext({...next("sample","sample-makeup",["regular"]),key:"swim_mark",markKey:"4PM/Mon/1/1/2026-08-13",mark:{type:"sample",n:`${prefix} Sample`,p:"01000000001"}}));
    await handlers.setClassMark(withMarkContext({...next("mandatory_makeup","mandatory-makeup",["regular"]),key:"swim_mark",markKey:"4PM/Mon/1/1/2026-08-14",mark:{type:"bogang",mandatoryMakeup:true,n:`${prefix} Mandatory`,p:"01000000001"}}));
    await handlers.clearClassMark(withMarkContext({...next("absence_cancel","absence-cancel",["regular"]),key:"swim_mark",markKey:"4PM/Mon/1/1/2026-08-11"},true));
    await handlers.clearClassMark(withMarkContext({...next("makeup_cancel","makeup-cancel",["regular"]),key:"swim_mark",markKey:"4PM/Mon/1/1/2026-08-12"},true));
    const regularAttendance=next("attendance_regular","attendance-update",["regular"]);
    await handlers.updateAttendance({
      mutator:attendance=>({...attendance,"4PM/Mon/1/1/2026-08-11":{s:"present"}}),
      context:{owner:`task7_${branchId}_regular`,tabId:"regular",courseType:"regular",dates:["2026-08-11"],...regularAttendance},
    });
    const regularGuests=next("attendance_regular_guests","attendance-guest",["regular"]);
    await handlers.updateAttendance({
      guests:true,
      mutator:guests=>({...guests,"4PM/Mon/1/2026-08-11":[{n:`${prefix} Guest`,p:"01000000012"}]}),
      context:{owner:`task7_${branchId}_regular`,tabId:"regular",courseType:"regular",dates:["2026-08-11"],...regularGuests},
    });
    const summerAttendance=next("attendance_summer","attendance-update",["summer"]);
    await handlers.updateAttendance({
      mutator:attendance=>({...attendance,"10AM/MonWedFri/2/1/2026-08-11":{s:"present"}}),
      context:{owner:`task7_${branchId}_summer`,tabId:"summer",courseType:"bangteuk",dates:["2026-08-11"],...summerAttendance},
    });
    const summerGuests=next("attendance_summer_guests","attendance-guest",["summer"]);
    await handlers.updateAttendance({
      guests:true,
      mutator:guests=>({...guests,"10AM/MonWedFri/2/2026-08-11":[{n:`${prefix} Camp Guest`,p:"01000000013"}]}),
      context:{owner:`task7_${branchId}_summer`,tabId:"summer",courseType:"bangteuk",dates:["2026-08-11"],...summerGuests},
    });
    handlers=system.liveHandlers(branchId);
    await handlers.createSnapshot({scope:"regular",date:"2026-08-11",tabId:"regular",creationIdentity:`${prefix}_regular_snapshot`,snapshot:{students:[{sid:`${prefix}_replacement`,n:`${prefix} Replaced`}],inst:{"4PM/Mon/1":`${prefix} Teacher Updated`},createdAt:"2026-08-11T03:00:00.000Z"}});
    await handlers.createSnapshot({scope:"bt_summer",date:"2026-08-11",tabId:"summer",creationIdentity:`${prefix}_summer_snapshot`,snapshot:{students:[{sid:`${prefix}_b1`,n:`${prefix} Camp One`}],inst:{"10AM/MonWedFri/2":`${prefix} Camp Teacher Updated`},createdAt:"2026-08-11T03:00:00.000Z"}});
    await handlers.updateCalendar(withValueContext({...next("calendar","update-calendar",["regular","summer"]),keys:["swim_disabled","swim_closed"],values:{swim_disabled:{"4PM/Mon/1/1":true,"10AM/MonWedFri/2/1":true},swim_closed:[{start:"2026-08-15",type:"closed"}]}}));
    await handlers.updateCalendar(withValueContext({...next("periods","update-periods",["regular","summer"]),keys:["swim_periods"],values:{swim_periods:[{month:8,start:"2026-08-03",end:"2026-08-28"},{month:9,start:"2026-09-01",end:"2026-09-30"}]}}));
    await handlers.updateTabs(withValueContext({...next("tabs","update-tabs",["regular","summer"]),keys:["swim_tab_list","swim_main_tab","swim_parent_tab"],values:{
      swim_tab_list:[{id:"regular",name:`${prefix} Regular Updated`,type:"regular",periodMonth:"2026-08"},{id:"summer",name:`${prefix} Summer`,type:"bangteuk",periodMonth:"2026-08",seasonStart:"2026-08-03",seasonEnd:"2026-08-28"}],
      swim_main_tab:{tabId:"regular",month:"2026-08"},swim_parent_tab:{tabId:"regular"},
    }}));
    await handlers.updateManualRecords(withValueContext({...next("manual_records","update-records",["regular","summer"]),keys:["swim_retire_history","swim_desk_notes"],values:{
      swim_retire_history:[{id:`${prefix}_history`,n:`${prefix} Retired`,p:"01000000014",retiredAt:"2026-08-11"}],
      swim_desk_notes:[{id:`${prefix}_desk`,n:`${prefix} Desk`,p:"01000000015",memo:"manual record"}],
    }}));

    assert.equal(operation,25);
    assert.equal(system.runtime(branchId).revision,27);
    const coordination=system.coordinationTrace(branchId);
    assert.deepEqual(
      coordination.filter(event=>event.branch==="transaction-context").map(event=>event.operationType),
      [
        "add-student","add-student","update-reservation","update-calendar","absence-confirmation",
        "replace-student","move-student","update-teacher","update-reservation","update-waitlist",
        "update-waitlist","absence-confirmation","makeup","sample-makeup","mandatory-makeup",
        "absence-cancel","makeup-cancel","update-calendar","update-periods","update-tabs","update-records",
      ],
    );
    assert.deepEqual(
      coordination.filter(event=>event.branch==="attendance-runtime").map(event=>event.operationType),
      ["attendance-update","attendance-guest","attendance-update","attendance-guest"],
    );
    const replacementCoordination=coordination.find(event=>event.operationType==="replace-student");
    assert.equal(replacementCoordination.metadata.label,"원생 교체");
    assert.equal(replacementCoordination.metadata.deleteReason,"student-replace");
    assert.equal(replacementCoordination.metadata.skipUndo,true);
    assert.equal(replacementCoordination.metadata.bangteuk,false);
    await assertParity(system,branchId);
    const exportView=await handlers.prepareExportView({tabId:"regular",selection:completeSelection(await system.legacyValues(branchId))});
    assert.equal(exportView.primary,"v2");
    assert.equal(trackedDigest(exportView.root),trackedDigest(await system.legacyValues(branchId)));
    assert.equal(exportView.preparedFor,"schedule-export");
    const exportAttributes={};
    const rendered=handlers.renderExportTable({view:exportView,source:{cloneNode:()=>({
      setAttribute:(key,value)=>{exportAttributes[key]=value;},
      querySelectorAll:()=>[],
    })}});
    assert.equal(rendered.primary,"v2");
    assert.equal(rendered.tab.name,`${prefix} Regular Updated`);
    assert.equal(exportAttributes["data-operational-export-primary"],"v2");
    assert.equal(trackedDigest(rendered.root),trackedDigest(exportView.root));
    assert.deepEqual(rows(exportView.root,"swim_students",[]).map(student=>student.sid),[`${prefix}_r2`,`${prefix}_r3`,`${prefix}_replacement`]);
    assert.deepEqual(rows(exportView.root,"swim_tab_list",[]).map(tab=>tab.id),["regular","summer"]);
    assert.deepEqual(rows(exportView.root,"swim_periods",[]).map(period=>period.month),[8,9]);
    assert.deepEqual(rows(exportView.root,"swim_reserve",{})["4PM/Mon/1"].map(entry=>entry.n),[`${prefix} Waitlist A`,`${prefix} Waitlist B`]);
    assert.equal(rows(exportView.root,"swim_bt_summer_stu",[]).find(student=>student.sid===`${prefix}_b2`).t,"12PM");
    assert.equal(rows(exportView.root,"swim_retire",{})["11AM/TueThu/1/1"].moveId,`${prefix}_move`);
    assert.equal(rows(exportView.root,"swim_enroll",{})["12PM/Fri/1/1"].moveId,`${prefix}_move`);
  });
}
