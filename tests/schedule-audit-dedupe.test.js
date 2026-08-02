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
vm.createContext(context);
vm.runInContext(
  sourceBetween(source, '_scheduleAuditSlotFromText', '_scheduleAuditNameFromSegment')
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

test('automatic retirement and reduced-frequency operations hide only their generic deletion copy', () => {
  const retire = {
    id:'retire',
    source:'visible-reservation',
    student:'홍길동',
    change:'퇴원',
  };
  const reduce = {
    id:'reduce',
    source:'visible-reservation',
    student:'김가경',
    change:'횟수줄임',
  };
  const autoDelete = {
    id:'auto-delete',
    source:'audit',
    student:'홍길동',
    change:'삭제',
    operationLabel:'자동 등록·제외 처리',
    deleteReason:'auto-retire',
  };
  const result = context._deskNotesWithoutGenericDeletesFromSpecificOperations([
    retire,
    autoDelete,
    reduce,
    {...autoDelete, id:'reduce-delete', student:'김가경'},
  ]);

  assert.deepEqual(Array.from(result, row => row.id), ['retire', 'reduce']);
});

test('time changes cannot leave a generic deletion but a real manual deletion remains', () => {
  const timeChangeDelete = {
    id:'move-delete',
    source:'audit',
    change:'삭제',
    operationType:'move',
    operationLabel:'원생 이동',
  };
  const manualDelete = {
    id:'manual-delete',
    source:'audit',
    change:'삭제',
    operationLabel:'학생 직접 삭제',
    deleteReason:'manual-delete',
  };
  const result = context._deskNotesWithoutGenericDeletesFromSpecificOperations([
    timeChangeDelete,
    manualDelete,
  ]);

  assert.deepEqual(Array.from(result, row => row.id), ['manual-delete']);
});
