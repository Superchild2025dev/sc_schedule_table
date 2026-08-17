"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {
  createOperationalSystem,parse,
}=require("./full-v2-operational-fixture.js");

function updateStudent(gateway,key,sid,name,operationId){
  return gateway.transactionKeys([key],root=>{
    const students=parse(root,key,[]);
    const student=students.find(item=>item.sid===sid);
    assert.ok(student,`missing fixture student ${sid}`);
    student.n=name;
    root[key]=JSON.stringify(students);
    return root;
  },{operationId,operationType:"update-student",tabIds:[key==="swim_students"?"regular":"summer"]});
}

function updateTeacher(gateway,slot,name,operationId){
  return gateway.transactionKeys(['swim_inst'],root=>{
    const teachers=parse(root,'swim_inst',{});
    teachers[slot]=name;
    root.swim_inst=JSON.stringify(teachers);
    return root;
  },{operationId,operationType:'update-teacher',tabIds:['regular']});
}

function studentName(value){return String(value).replace(/^\*/,"");}

for(const branchId of ["gagyeong","yongam"]){
  for(const course of [
    {name:"regular",key:"swim_students",suffixes:["r1","r2"]},
    {name:"bangteuk",key:"swim_bt_summer_stu",suffixes:["b1","b2"]},
  ]){
    test(`${branchId} ${course.name} initial different-document edits both survive the operational conflict rebase`,async()=>{
      const system=createOperationalSystem({branches:[branchId],mode:"v2-read",deriveBarrierCount:2});
      const first=system.gateway(branchId);
      const second=system.gateway(branchId);
      await Promise.all([first.ready(),second.ready()]);
      const prefix=branchId==="gagyeong"?"G":"Y";

      const results=await Promise.allSettled([
        updateStudent(first,course.key,`${prefix}_${course.suffixes[0]}`,`${prefix} Device One`,`different_${branchId}_${course.name}_1`),
        updateStudent(second,course.key,`${prefix}_${course.suffixes[1]}`,`${prefix} Device Two`,`different_${branchId}_${course.name}_2`),
      ]);

      assert.deepEqual(results.map(result=>result.status).sort(),["fulfilled","fulfilled"]);
      const students=parse(system.reconstructV2(branchId),course.key,[]);
      assert.equal(studentName(students.find(item=>item.sid===`${prefix}_${course.suffixes[0]}`).n),`${prefix} Device One`);
      assert.equal(studentName(students.find(item=>item.sid===`${prefix}_${course.suffixes[1]}`).n),`${prefix} Device Two`);
    });

    test(`${branchId} ${course.name} stale same-slot edit conflicts without overwriting the winner`,async()=>{
      const system=createOperationalSystem({branches:[branchId],mode:"v2-read",deriveBarrierCount:2});
      const first=system.gateway(branchId);
      const second=system.gateway(branchId);
      await Promise.all([first.ready(),second.ready()]);
      const prefix=branchId==="gagyeong"?"G":"Y";
      const sid=`${prefix}_${course.suffixes[0]}`;
      const results=await Promise.allSettled([
        updateStudent(first,course.key,sid,`${prefix} Winning Device`,`same_${branchId}_${course.name}_1`),
        updateStudent(second,course.key,sid,`${prefix} Stale Device`,`same_${branchId}_${course.name}_2`),
      ]);
      assert.deepEqual(results.map(result=>result.status).sort(),["fulfilled","rejected"]);
      assert.equal(results.find(result=>result.status==="rejected").reason.code,"aborted");
      const students=parse(system.reconstructV2(branchId),course.key,[]);
      assert.equal(studentName(students.find(student=>student.sid===sid).n),`${prefix} Winning Device`);
    });
  }
}

test('three concurrent independent schedule edits all survive bounded intent rebasing',async()=>{
  const system=createOperationalSystem({branches:['yongam'],mode:'v2-read',deriveBarrierCount:3});
  const gateways=[system.gateway('yongam'),system.gateway('yongam'),system.gateway('yongam')];
  await Promise.all(gateways.map(gateway=>gateway.ready()));

  const results=await Promise.allSettled([
    updateStudent(gateways[0],'swim_students','Y_r1','Y Three One','three_y_1'),
    updateStudent(gateways[1],'swim_students','Y_r2','Y Three Two','three_y_2'),
    updateTeacher(gateways[2],'4PM/Mon/1','Y Three Teacher','three_y_3'),
  ]);

  const outcomes=results.map(result=>result.status==='fulfilled'
    ?{status:'fulfilled'}
    :{status:'rejected',code:result.reason?.code,message:result.reason?.message});
  const evidence={
    outcomes,
    runtime:system.runtime('yongam'),
    manifests:['three_y_1','three_y_2','three_y_3'].map(id=>system.manifest('yongam',id)),
    diagnostics:gateways.map(gateway=>gateway.diagnostics()),
  };
  assert.deepEqual(results.map(result=>result.status),['fulfilled','fulfilled','fulfilled'],JSON.stringify(evidence));
  const root=system.reconstructV2('yongam');
  const students=parse(root,'swim_students',[]);
  const teachers=parse(root,'swim_inst',{});
  assert.equal(studentName(students.find(student=>student.sid==='Y_r1').n),'Y Three One');
  assert.equal(studentName(students.find(student=>student.sid==='Y_r2').n),'Y Three Two');
  assert.equal(teachers['4PM/Mon/1'],'Y Three Teacher');
});
