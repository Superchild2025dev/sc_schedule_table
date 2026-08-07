"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function read(relativePath){
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("function V2 shared files match browser sources",()=>{
  for(const name of ["schedule-time.js","schedule-schema-v2.js"]){
    assert.equal(read(`functions/shared/${name}`),read(`js/${name}`));
  }
});

test("function V2 shared files expose the converter in Node",()=>{
  delete globalThis.SCScheduleTime;
  delete globalThis.SCScheduleSchemaV2;
  delete globalThis.window;

  for(const name of ["schedule-time.js","schedule-schema-v2.js"]){
    const file = path.join(root, "functions", "shared", name);
    delete require.cache[require.resolve(file)];
    require(file);
  }

  assert.equal(typeof globalThis.SCScheduleSchemaV2.diagnoseLegacyRoot,"function");
  assert.equal(typeof globalThis.SCScheduleSchemaV2.convertLegacySchedule,"function");
});
