"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");

const fixture=require("./full-v2-operational-fixture.js");
const parity=require("../functions/schedule-v2-cutover-parity.js");

function convertedFixture(branchId="gagyeong"){
  const legacyRoot=fixture.legacyFixture(branchId);
  const report=fixture.schema.diagnoseLegacyRoot(branchId,legacyRoot);
  assert.equal(report.checks.ready,true);
  return {legacyRoot,collections:report.conversion};
}

test("canonical cutover parity accepts a complete V1 to V2 round trip",()=>{
  const input=convertedFixture();
  const result=parity.compareCanonicalParity(input);

  assert.equal(result.matches,true);
  assert.equal(result.v1Digest,result.v2Digest);
  assert.match(result.v1Digest,/^[a-f0-9]{64}$/);
  assert.ok(result.v1KeyCount>0);
  assert.ok(result.v2KeyCount>0);
  assert.doesNotMatch(JSON.stringify(result),/student|teacher|phone|payload/i);
});

test("canonical cutover parity rejects a V1 change that was not drained",()=>{
  const input=convertedFixture();
  input.legacyRoot.swim_mark=JSON.stringify([{id:"unmirrored-mark"}]);

  const result=parity.compareCanonicalParity(input);

  assert.equal(result.matches,false);
  assert.notEqual(result.v1Digest,result.v2Digest);
});

test("canonical cutover parity rejects V2 collection tampering",()=>{
  const input=convertedFixture();
  input.collections.tabs[0].name="tampered-tab";

  const result=parity.compareCanonicalParity(input);

  assert.equal(result.matches,false);
  assert.notEqual(result.v1Digest,result.v2Digest);
});

test("canonical cutover parity rejects an invalid V2 graph even when V1 is empty",()=>{
  assert.throws(()=>parity.compareCanonicalParity({
    branchId:"gagyeong",
    generationId:"gen_invalid",
    legacyRoot:{},
    collections:{
      attendanceRecords:[{
        id:"orphan-attendance",tabId:"missing-tab",courseType:"regular",
        legacyKey:"5pm/월/1/1/2026-08-01",personId:"missing-person",
      }],
    },
  }),error=>error.code==="failed-precondition"&&error.message==="invalid-v2-collection-graph");
});

test("canonical cutover parity reads chunked legacy strings by their persisted value type",async()=>{
  const chunkRef={
    collection(name){
      assert.equal(name,"chunks");
      return {get:async()=>({
        forEach(visitor){
          visitor({id:"0000",data:()=>({text:"legacy-version-without-json-quotes"})});
        },
      })};
    },
  };
  const legacyDocument={
    id:"swim_ver",ref:chunkRef,
    data:()=>({chunked:true,chunkCount:1,valueType:"string"}),
  };
  const emptySnapshot={docs:[]};
  const db={
    collection(name){
      if(name==="scheduleStores") return {doc:()=>({collection:()=>({get:async()=>({docs:[legacyDocument]})})})};
      if(name==="scheduleV2") return {doc:()=>({collection:()=>({doc:()=>({
        collection:()=>({get:async()=>emptySnapshot}),
      })})})};
      throw new Error(`unexpected collection ${name}`);
    },
  };

  const result=await parity.readCanonicalParity({db,branchId:"gagyeong",generationId:"gen_1"});

  assert.equal(result.matches,false);
  assert.equal(result.v1KeyCount,1);
  assert.match(result.v1Digest,/^[a-f0-9]{64}$/);
});
