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

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8');
const context = {
  _deskNoteRecordDateKey:note => note.dateKey || '',
  _recordLocalDateKey:() => '2026-07-28',
  _normalizeDeskNotesList:list => list,
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
const scheduleTimeSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'schedule-time.js'), 'utf8');
vm.runInContext(scheduleTimeSource, context, {filename:'schedule-time.js'});
vm.runInContext(
  sourceBetween(source, '_scheduleAuditSlotFromText', '_scheduleAuditNameFromSegment')
    + sourceBetween(source, '_deskNoteRetireProcessingKey', '_deskNoteAutomaticMovementKey')
    + sourceBetween(source, '_deskNoteAutomaticMovementKey', '_findDeskNote')
    + sourceBetween(source, '_deskNoteFindIndex', '_updateDeskNotesTx'),
  context
);

test('the direct and parsed audit versions of one movement display only once', () => {
  const direct = {
    id:'direct',
    tabId:'regular',
    student:'홍길동',
    change:'반변경',
    dateKey:'2026-07-28',
    teacher:'담당',
    source:'direct-move',
    detail:'즉시 이동: 홍길동 4시/월/1/1 → 4시/월/2/1',
  };
  const parsed = {
    id:'audit',
    tabId:'regular',
    student:'홍길동',
    change:'반변경',
    dateKey:'2026-07-28',
    teacher:'-',
    source:'audit',
    detail:'원생 이동: 홍길동(10) 4시 월 1레인 1번 → 4시 월 2레인 1번',
  };

  const result = context._deskNotesWithoutAutomaticMovementDuplicates([parsed, direct]);

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'direct');
});

test('manual records are never collapsed with automatic movement records', () => {
  const automatic = {
    id:'auto',
    tabId:'regular',
    student:'홍길동',
    dateKey:'2026-07-28',
    source:'direct-move',
    detail:'즉시 이동: 홍길동 4시/월/1/1 → 4시/월/2/1',
  };
  const manual = {...automatic, id:'manual', manual:true};

  const result = context._deskNotesWithoutAutomaticMovementDuplicates([automatic, manual]);

  assert.equal(result.length, 2);
});

test('transaction merging keeps one movement record and preserves the better direct record', () => {
  const direct = {
    id:'direct',
    sourceKey:'direct-key',
    tabId:'regular',
    student:'홍길동',
    dateKey:'2026-07-28',
    teacher:'담당',
    source:'direct-move',
    detail:'즉시 이동: 홍길동 4시/월/1/1 → 4시/월/2/1',
  };
  const parsed = {
    id:'audit',
    sourceKey:'audit-key',
    tabId:'regular',
    student:'홍길동',
    dateKey:'2026-07-28',
    teacher:'-',
    source:'audit',
    detail:'원생 이동: 홍길동 4시 월 1레인 1번 → 4시 월 2레인 1번',
  };

  const result = context._mergeDeskNote([direct], parsed);

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'direct');
});

test('retirement hides its automatic deletion and reduced-frequency duplicates', () => {
  const base = {
    tabId:'regular',
    day:'월',
    student:'이도윤',
    time:'5시',
    dateKey:'2026-07-30',
  };
  const retire = {...base, id:'retire', change:'퇴원', source:'visible-reservation'};
  const deletion = {...base, id:'delete', change:'삭제', source:'audit'};
  const reduction = {...base, id:'reduce', change:'횟수줄임', source:'visible-reservation'};

  const result = context._deskNotesWithoutRetireProcessingDuplicates([deletion, reduction, retire]);

  assert.deepEqual(Array.from(result, row => row.id), ['retire']);
});

test('manual records and real deletions without retirement remain visible', () => {
  const base = {
    tabId:'regular',
    day:'화',
    student:'연서윤',
    time:'7시',
    dateKey:'2026-07-30',
  };
  const retire = {...base, id:'retire', change:'퇴원'};
  const manualDeletion = {...base, id:'manual', change:'삭제', manual:true};
  const otherDeletion = {...base, id:'other', student:'다른원생', change:'삭제'};

  const result = context._deskNotesWithoutRetireProcessingDuplicates([retire, manualDeletion, otherDeletion]);

  assert.deepEqual(Array.from(result, row => row.id), ['retire', 'manual', 'other']);
});

test('an actual student deletion remains visible even beside a retirement row', () => {
  const base = {
    tabId:'regular',
    day:'화',
    student:'실제삭제원생',
    time:'6시',
  };
  const retire = {...base, id:'retire', change:'퇴원'};
  const directDelete = {
    ...base,
    id:'direct-delete',
    change:'삭제',
    source:'audit',
    operationLabel:'학생 직접 삭제',
    deleteReason:'manual-delete',
  };

  const result = context._deskNotesWithoutRetireProcessingDuplicates([retire, directDelete]);

  assert.deepEqual(Array.from(result, row => row.id), ['retire', 'direct-delete']);
});

test('same-day and future retirements stay as one retirement row before automatic removal', () => {
  const today = {
    id:'today',
    tabId:'regular',
    day:'수',
    student:'연정환',
    time:'7시',
    dateKey:'2026-07-30',
    effectiveDateKey:'2026-07-30',
    change:'퇴원',
  };
  const future = {
    ...today,
    id:'future',
    student:'미래원생',
    effectiveDateKey:'2026-08-05',
  };

  const result = context._deskNotesWithoutRetireProcessingDuplicates([today, future]);

  assert.deepEqual(Array.from(result, row => row.id), ['today', 'future']);
});

test('a genuine reduced-frequency record without retirement remains visible', () => {
  const reduction = {
    id:'reduce-only',
    tabId:'regular',
    day:'금',
    student:'횟수감소',
    time:'4시',
    change:'횟수줄임',
  };

  const result = context._deskNotesWithoutRetireProcessingDuplicates([reduction]);

  assert.deepEqual(Array.from(result, row => row.id), ['reduce-only']);
});

test('Saturday display time and internal time are treated as the same class', () => {
  const retire = {
    id:'sat-retire',
    tabId:'regular',
    day:'토요일',
    student:'이준오',
    time:'11시',
    change:'퇴원',
  };
  const deletion = {
    id:'sat-delete',
    tabId:'regular',
    day:'토',
    student:'이준오(10)',
    time:'3시',
    change:'삭제',
  };
  const reduction = {...deletion, id:'sat-reduce', change:'횟수줄임'};

  const result = context._deskNotesWithoutRetireProcessingDuplicates([deletion, reduction, retire]);

  assert.deepEqual(Array.from(result, row => row.id), ['sat-retire']);
});

test('Saturday afternoon display time also matches its internal storage time', () => {
  const retire = {
    id:'sat-one-retire',
    tabId:'regular',
    day:'토',
    student:'토요일원생',
    time:'1시',
    change:'퇴원',
  };
  const deletion = {
    ...retire,
    id:'sat-five-delete',
    time:'5시',
    change:'삭제',
  };

  const result = context._deskNotesWithoutRetireProcessingDuplicates([deletion, retire]);

  assert.deepEqual(Array.from(result, row => row.id), ['sat-one-retire']);
});

test('same name in another tab or another class is not hidden', () => {
  const retire = {
    id:'retire',
    tabId:'regular-july',
    day:'월',
    student:'이도윤',
    time:'5시',
    change:'퇴원',
  };
  const anotherTab = {...retire, id:'another-tab', tabId:'regular-august', change:'삭제'};
  const anotherTime = {...retire, id:'another-time', time:'6시', change:'삭제'};

  const result = context._deskNotesWithoutRetireProcessingDuplicates([retire, anotherTab, anotherTime]);

  assert.deepEqual(Array.from(result, row => row.id), ['retire', 'another-tab', 'another-time']);
});
