const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadScheduleTime(){
  const context = {console};
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'schedule-time.js'), 'utf8');
  vm.runInContext(source, context, {filename:'schedule-time.js'});
  return context.SCScheduleTime;
}

const scheduleTime = loadScheduleTime();

test('regular teacher blocks have five seats', () => {
  assert.equal(scheduleTime.slotRowsForInst({n:'Teacher'}, {bangteukTable:false}), 5);
});

test('elite and master teacher blocks keep eight seats', () => {
  assert.equal(scheduleTime.slotRowsForInst({n:'Elite', cls:'elite'}, {bangteukTable:false}), 8);
  assert.equal(scheduleTime.slotRowsForInst({n:'Master', cls:'master'}, {bangteukTable:false}), 8);
});

test('vacation-class teacher blocks have six seats', () => {
  assert.equal(scheduleTime.slotRowsForInst({n:'Vacation', bt:true}, {bangteukTable:false}), 6);
  assert.equal(scheduleTime.slotRowsForInst({n:'Vacation'}, {bangteukTable:true}), 6);
});
