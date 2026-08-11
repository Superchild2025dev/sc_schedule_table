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

function studentName(value){return String(value).replace(/^\*/,"");}

for(const branchId of ["gagyeong","yongam"]){
  for(const course of [
    {name:"regular",key:"swim_students",suffixes:["r1","r2"]},
    {name:"bangteuk",key:"swim_bt_summer_stu",suffixes:["b1","b2"]},
  ]){
    test(`${branchId} ${course.name} different-document edits survive a fenced-device retry`,async()=>{
      const system=createOperationalSystem({branches:[branchId],mode:"v2-read",deriveBarrierCount:2});
      const first=system.gateway(branchId);
      const second=system.gateway(branchId);
      await Promise.all([first.ready(),second.ready()]);
      const prefix=branchId==="gagyeong"?"G":"Y";

      const results=await Promise.allSettled([
        updateStudent(first,course.key,`${prefix}_${course.suffixes[0]}`,`${prefix} Device One`,`different_${branchId}_${course.name}_1`),
        updateStudent(second,course.key,`${prefix}_${course.suffixes[1]}`,`${prefix} Device Two`,`different_${branchId}_${course.name}_2`),
      ]);

      assert.deepEqual(results.map(result=>result.status).sort(),["fulfilled","rejected"]);
      assert.equal(results.find(result=>result.status==="rejected").reason.code,"aborted");
      const retried=system.gateway(branchId);
      await retried.ready();
      const retryIndex=results[0].status==="rejected"?0:1;
      const labels=["One","Two"];
      await updateStudent(
        retried,course.key,`${prefix}_${course.suffixes[retryIndex]}`,
        `${prefix} Device ${labels[retryIndex]}`,`different_${branchId}_${course.name}_retry`,
      );
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
