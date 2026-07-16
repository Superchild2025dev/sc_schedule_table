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

const time = loadScheduleTime();

test('regular and vacation rows use one deterministic person id', () => {
  const regular = time.studentIdFor({n:'홍길동', p:'010-1234-5678', t:'4시', d:'월'});
  const vacation = time.studentIdFor({n:'홍길동', p:'01012345678', t:'10시', d:'월수금', paid:true});
  assert.equal(regular, vacation);
});

test('course slot metadata stays outside the person identity', () => {
  const rows = [
    {sid:'stu_shared', n:'홍길동', p:'01012345678', t:'4시', d:'월', l:1, r:1, __identitySlotKey:'regular::4시/월/1/1'},
    {sid:'stu_shared', n:'홍길동', p:'01012345678', t:'10시', d:'월수금', l:3, r:2, __identitySlotKey:'summer::10시/월수금/3/2'},
  ];
  const groups = time.findStudentIdentityGroups(rows, {n:'홍길동', p:'010-1234-5678'});
  assert.equal(groups.length, 1);
  assert.equal(groups[0].entries.length, 2);
  assert.notEqual(time.studentSlotKey(groups[0].entries[0]), time.studentSlotKey(groups[0].entries[1]));
});

test('excluding a regular slot does not exclude the same-shaped vacation slot', () => {
  const rows = [
    {sid:'stu_shared', n:'홍길동', p:'01012345678', t:'4시', d:'월', l:1, r:1, __identitySlotKey:'regular::4시/월/1/1'},
    {sid:'stu_shared', n:'홍길동', p:'01012345678', t:'4시', d:'월', l:1, r:1, __identitySlotKey:'summer::4시/월/1/1'},
  ];
  const groups = time.findStudentIdentityGroups(rows, {n:'홍길동', p:'01012345678'}, {
    excludeSlotKeys:['regular::4시/월/1/1'],
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].entries.length, 1);
  assert.equal(groups[0].entries[0].__identitySlotKey, 'summer::4시/월/1/1');
});

test('siblings sharing a phone number keep different person ids', () => {
  const first = time.studentIdFor({n:'홍길동', p:'01012345678'});
  const sibling = time.studentIdFor({n:'홍길순', p:'01012345678'});
  assert.notEqual(first, sibling);
});
