"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {
  createOperationalSystem,model,parse,completeSelection,
}=require("./full-v2-operational-fixture.js");

function trackedDigest(root){
  return model.canonicalDigest(model.trackedLegacyView(root));
}

function valueDigest(root,key){
  return model.canonicalDigest(model.trackedLegacyView(root)[key]);
}

test("failed V1 mirror blocks rollback until recovery restores parity and a fresh V1 page",async()=>{
  const system=createOperationalSystem({branches:["gagyeong"]});
  const cutover=await system.transition("gagyeong","set-v2-read");
  assert.equal(cutover.mode,"v2-read");
  const gateway=system.gateway("gagyeong");
  await gateway.ready();

  const first=await gateway.transactionKeys(["swim_students"],root=>{
    const students=parse(root,"swim_students",[]);
    students[0].memo="rollback-safe-local-edit";
    root.swim_students=JSON.stringify(students);
    return root;
  },{operationId:"rollback_revision_alignment",operationType:"update-student",tabIds:["regular"]});
  assert.equal(first.recoveryState,"applied");
  system.db.failNextLegacyTransactions=1;
  const failedMirror=await gateway.transactionKeys(["swim_bt_summer_stu"],root=>{
    const students=parse(root,"swim_bt_summer_stu",[]);
    students[0].memo="must-recover-before-rollback";
    root.swim_bt_summer_stu=JSON.stringify(students);
    return root;
  },{operationId:"rollback_failed_mirror",operationType:"update-student",tabIds:["summer"]});

  assert.equal(system.runtime("gagyeong").revision,2);
  assert.equal(system.runtime("gagyeong","attendance").revision,2);
  assert.equal(failedMirror.recoveryState,"error");
  assert.equal(parse(system.reconstructV2("gagyeong"),"swim_bt_summer_stu",[])[0].memo,"must-recover-before-rollback");
  assert.equal(parse(await system.legacyValues("gagyeong"),"swim_bt_summer_stu",[])[0].memo,undefined);
  await assert.rejects(()=>system.transition("gagyeong","rollback"),error=>error.code==="failed-precondition");
  const recovery=await system.writer.recoverOperationalMirrors({perBranchLimit:5});
  assert.deepEqual(recovery,{applied:1,error:0,skipped:0});
  const legacy=await system.legacyValues("gagyeong");
  const rebuiltV2=system.reconstructV2("gagyeong");
  assert.equal(valueDigest(rebuiltV2,"swim_students"),valueDigest(legacy,"swim_students"));
  assert.equal(valueDigest(rebuiltV2,"swim_bt_summer_stu"),valueDigest(legacy,"swim_bt_summer_stu"));
  const rollback=await system.transition("gagyeong","rollback");
  assert.equal(rollback.mode,"v1");
  const freshPage=system.gateway("gagyeong");
  await freshPage.ready();
  const rebuilt=await freshPage.loadSelection(completeSelection(legacy));
  assert.equal(rebuilt.primary,"v1");
  assert.equal(trackedDigest(rebuilt.root),trackedDigest(legacy));
});
