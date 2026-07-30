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

const dataSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8');

test('bangteuk audit markers are recognized without hiding regular records', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(dataSource, '_scheduleAuditRecordIsBangteuk', '_scheduleAuditIsSameTeacherClassMove'),
    context
  );

  assert.equal(context._scheduleAuditRecordIsBangteuk({tabType:'regular'}), false);
  assert.equal(context._scheduleAuditRecordIsBangteuk({tabType:'bangteuk'}), true);
  assert.equal(context._scheduleAuditRecordIsBangteuk({bangteuk:true}), true);
  assert.equal(context._scheduleAuditRecordIsBangteuk({original:{tabType:'bangteuk'}}), true);
});

test('retire desk notes are written for regular students and skipped for bangteuk students', async () => {
  let writes = 0;
  const context = {
    ENROLL_MAP:{},
    DESK_NOTES:[],
    _scheduleAuditEntryDate:entry => entry.ds,
    _scheduleAuditSlotFromKey:() => ({time:'4시', dayToken:'월', lane:'1', row:'1'}),
    _scheduleAuditStudentFromSlot:(slot,key,fallback) => fallback,
    _scheduleAuditActiveScope:() => ({tabId:'regular', tabName:'정규', tabType:'regular'}),
    _scheduleAuditMonthKey:() => '2026-07',
    _scheduleAuditDays:() => ['월'],
    _scheduleAuditExpandDay:() => ['월'],
    _scheduleAuditDateLabel:key => ({key,label:'7/31'}),
    _scheduleAuditEntryNameFromSlot:entry => entry.name,
    _scheduleAuditIsBangteukSlot:() => false,
    _scheduleAuditIsSameTeacherClassMove:() => false,
    _scheduleAuditVisibleReason:() => '퇴원',
    _scheduleAuditTeacherFromSlot:() => '담당',
    _scheduleAuditDisplayTime:() => '4시',
    _deskNoteFromScheduleRow:row => row,
    _normalizeDeskNotesList:list => list,
    _mergeDeskNote:(list,note) => list.concat(note),
    _updateDeskNotesTx:mutator => {
      writes++;
      context.DESK_NOTES = mutator(context.DESK_NOTES);
      return Promise.resolve(context.DESK_NOTES);
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(dataSource, '_scheduleAuditRecordIsBangteuk', '_scheduleAuditIsSameTeacherClassMove')
      + sourceBetween(dataSource, 'ensureDeskNoteForRetireReservation', 'ensureDeskNoteForStudentMove'),
    context
  );

  const regular = await context.ensureDeskNoteForRetireReservation(
    '4시/월/1/1',
    {ds:'2026-07-31', name:'정규원생'},
    {n:'정규원생'}
  );
  const bangteuk = await context.ensureDeskNoteForRetireReservation(
    '4시/월/1/1',
    {ds:'2026-07-31', name:'방특원생', bangteuk:true},
    {n:'방특원생'},
    {bangteuk:true}
  );

  assert.equal(regular, true);
  assert.equal(bangteuk, false);
  assert.equal(writes, 1);
  assert.ok(context.DESK_NOTES.length >= 1);
  assert.ok(context.DESK_NOTES.every(row => row.target === '정규원생'));
});

test('moving within the same teacher class does not create a lower record', async () => {
  let writes = 0;
  const context = {
    DESK_NOTES:[],
    _scheduleAuditSlotFromKey:key => {
      const [time,dayToken,lane,row] = key.split('/');
      return {time,dayToken,lane,row};
    },
    _scheduleAuditStudentFromSlot:(slot,key,fallback) => fallback,
    _scheduleAuditActiveScope:() => ({tabId:'regular', tabName:'정규', tabType:'regular'}),
    _scheduleAuditDays:() => ['월'],
    _scheduleAuditExpandDay:() => ['월'],
    _scheduleAuditIsBangteukSlot:() => false,
    _scheduleAuditIsSameTeacherClassMove:() => true,
    getToday:() => new Date('2026-07-28T00:00:00+09:00'),
    toDateStr:() => '2026-07-28',
    _scheduleAuditDateLabel:key => ({key,label:'7/28'}),
    _updateDeskNotesTx:() => {
      writes++;
      return Promise.resolve();
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(dataSource, 'ensureDeskNoteForStudentMove', '_normalizeDeskNoteForDisplay'),
    context
  );

  const result = await context.ensureDeskNoteForStudentMove(
    '4시/월/1/1',
    '4시/월/1/2',
    {n:'같은반원생'},
    'stu'
  );

  assert.equal(result, false);
  assert.equal(writes, 0);
});
