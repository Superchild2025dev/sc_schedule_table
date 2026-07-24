const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function sourceBetween(source, startName, endName){
  const start = source.indexOf(`function ${startName}`);
  const end = source.indexOf(`function ${endName}`, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start, end);
}

const context = {console};
context.window = context;
context.globalThis = context;
context._auditSlotText = value => value;
context._auditIsStudentKey = () => true;
context._cloneJSON = value => JSON.parse(JSON.stringify(value));
vm.createContext(context);

const scheduleTimeSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'schedule-time.js'), 'utf8');
vm.runInContext(scheduleTimeSource, context, {filename:'schedule-time.js'});

const dataSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8');
vm.runInContext(
  sourceBetween(dataSource, '_auditStudentSlot', '_auditMapEntryText'),
  context,
  {filename:'schedule-audit-move.js'}
);

test('moving a legacy student does not become delete plus add when an id is assigned', () => {
  const before = [{n:'홍길동', p:'010-1234-5678', t:'4시', d:'월', l:1, r:1}];
  const after = [{sid:'stu_new', n:'홍길동', p:'01012345678', t:'5시', d:'월', l:2, r:1}];
  const changes = context._auditStudentDiff(before, after);

  assert.deepEqual(Array.from(changes, row => row.label), ['원생 이동']);
  assert.equal(context._studentDeletionEvents('swim_students', before, after, {type:'move'}).length, 0);
});

test('siblings sharing a phone number are not matched as the same student', () => {
  const before = [{n:'홍길동', p:'01012345678', t:'4시', d:'월', l:1, r:1}];
  const after = [{n:'홍길순', p:'01012345678', t:'5시', d:'월', l:2, r:1}];
  const changes = context._auditStudentDiff(before, after);

  assert.deepEqual(Array.from(changes, row => row.label), ['원생 삭제', '원생 추가']);
  assert.equal(context._studentDeletionEvents('swim_students', before, after, {type:'move'}).length, 1);
});

test('swapping two students produces only movement rows', () => {
  const before = [
    {sid:'stu_a', n:'김가경', p:'01011112222', t:'4시', d:'월', l:1, r:1},
    {sid:'stu_b', n:'이용암', p:'01033334444', t:'4시', d:'월', l:2, r:1},
  ];
  const after = [
    {...before[0], l:2},
    {...before[1], l:1},
  ];
  const changes = context._auditStudentDiff(before, after);

  assert.equal(changes.length, 2);
  assert.ok(changes.every(row => row.label === '원생 이동'));
  assert.equal(context._studentDeletionEvents('swim_students', before, after, {type:'move'}).length, 0);
});
