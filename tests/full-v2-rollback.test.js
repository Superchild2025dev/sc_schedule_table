"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {
  createOperationalSystem,model,parse,completeSelection,
}=require("./full-v2-operational-fixture.js");

function trackedDigest(root){return model.canonicalDigest(model.trackedLegacyView(root));}

for(const branchId of ["gagyeong","yongam"]){
  test(`${branchId} failed V1 mirror blocks rollback until complete regular and bangteuk parity is recovered`,async()=>{
    const system=createOperationalSystem({branches:[branchId]});
    const cutover=await system.transition(branchId,"set-v2-read");
    assert.equal(cutover.mode,"v2-read");
    const gateway=system.gateway(branchId);
    await gateway.ready();

    const first=await gateway.transactionKeys(["swim_students"],root=>{
      const students=parse(root,"swim_students",[]);
      students[0].memo="rollback-safe-local-edit";
      root.swim_students=JSON.stringify(students);
      return root;
    },{operationId:`${branchId}_rollback_revision_alignment`,operationType:"update-student",tabIds:["regular"]});
    assert.equal(first.recoveryState,"applied");
    system.db.failNextLegacyTransactions=1;
    const failedMirror=await gateway.transactionKeys(["swim_bt_summer_stu"],root=>{
      const students=parse(root,"swim_bt_summer_stu",[]);
      students[0].memo="must-recover-before-rollback";
      root.swim_bt_summer_stu=JSON.stringify(students);
      return root;
    },{operationId:`${branchId}_rollback_failed_mirror`,operationType:"update-student",tabIds:["summer"]});

    assert.equal(system.runtime(branchId).revision,2);
    assert.equal(system.runtime(branchId,"attendance").revision,2);
    assert.equal(failedMirror.recoveryState,"error");
    assert.equal(parse(system.reconstructV2(branchId),"swim_bt_summer_stu",[])[0].memo,"must-recover-before-rollback");
    assert.equal(parse(await system.legacyValues(branchId),"swim_bt_summer_stu",[])[0].memo,undefined);
    await assert.rejects(()=>system.transition(branchId,"rollback"),error=>error.code==="failed-precondition");

    const recovery=await system.writer.recoverOperationalMirrors({perBranchLimit:5});
    assert.deepEqual(recovery,{applied:1,error:0,skipped:0});
    const recoveredLegacy=await system.legacyValues(branchId);
    const rebuiltV2=system.reconstructV2(branchId);
    assert.equal(trackedDigest(rebuiltV2),trackedDigest(recoveredLegacy));
    assert.equal(parse(recoveredLegacy,"swim_students",[])[0].memo,"rollback-safe-local-edit");
    assert.equal(parse(recoveredLegacy,"swim_bt_summer_stu",[])[0].memo,"must-recover-before-rollback");

    const rollback=await system.transition(branchId,"rollback");
    assert.equal(rollback.mode,"v1");
    const freshPage=system.gateway(branchId);
    await freshPage.ready();
    const freshSource=await system.legacyValues(branchId);
    const rebuilt=await freshPage.loadSelection(completeSelection(freshSource));
    assert.equal(rebuilt.primary,"v1");
    assert.equal(trackedDigest(rebuilt.root),trackedDigest(freshSource));
    assert.equal(trackedDigest(rebuilt.root),trackedDigest(rebuiltV2));
  });
}
