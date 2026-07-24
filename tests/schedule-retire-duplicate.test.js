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
const context = {STORAGE_KEYS:{RETIRE_HISTORY:'swim_retire_history'}};
vm.createContext(context);
vm.runInContext(
  sourceBetween(source, '_deskNoteIsRetireHistoryProjection', '_findDeskNote'),
  context,
  {filename:'schedule-retire-duplicate.js'}
);
vm.runInContext(
  sourceBetween(source, '_scheduleAuditRowsForItem', '_scheduleAuditDayWidth'),
  context,
  {filename:'schedule-retire-source-filter.js'}
);

function directRetire(){
  return {
    source:'visible-reservation',
    day:'금',
    student:'박연',
    change:'퇴원',
    date:'7/24',
    dateKey:'2026-07-24',
    effectiveDateKey:'2026-07-31',
    time:'5시',
    detail:'현재 시간표 표시: 박연 7/31 퇴원',
  };
}

test('retire history projection is hidden when the dated reservation record exists', () => {
  const direct = directRetire();
  const history = {
    source:'retire',
    day:'금',
    student:'박연',
    change:'퇴원',
    date:'7/24',
    dateKey:'2026-07-24',
    time:'5시',
    detail:'2026-07-31 · 5시 금 2레인 1번',
  };
  const result = context._deskNotesWithoutRetireHistoryDuplicates([direct, history]);

  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'visible-reservation');
});

test('retire history remains visible when no reservation record exists', () => {
  const history = {
    source:'retire',
    day:'금',
    student:'박연',
    change:'퇴원',
    time:'5시',
    detail:'2026-07-31 · 5시 금 2레인 1번',
  };
  const result = context._deskNotesWithoutRetireHistoryDuplicates([history]);

  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'retire');
});

test('different retirement dates are not collapsed', () => {
  const direct = directRetire();
  const olderHistory = {
    source:'retire',
    day:'금',
    student:'박연',
    change:'퇴원',
    time:'5시',
    detail:'2026-06-30 · 5시 금 2레인 1번',
  };
  const result = context._deskNotesWithoutRetireHistoryDuplicates([direct, olderHistory]);

  assert.equal(result.length, 2);
});

test('retire history sources do not create another schedule-bottom row', () => {
  assert.equal(context._scheduleAuditRowsForItem({_source:'retire'}, '2026-07', ['금']).length, 0);
  assert.equal(context._scheduleAuditRowsForItem({
    _source:'audit',
    type:'retire',
    keys:['swim_retire_history'],
    label:'퇴원 기록 추가',
  }, '2026-07', ['금']).length, 0);
});
