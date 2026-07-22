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
  getToday(){ return new Date('2026-07-22T00:00:00+09:00'); },
  _recordLocalDateKey(){ return '2026-07-22'; },
};
vm.createContext(context);
vm.runInContext(sourceBetween(source, '_scheduleAuditText', '_scheduleAuditTarget'), context, {filename:'schedule-audit-reason.js'});
context._scheduleAuditIsActualRetire = () => false;
vm.runInContext(sourceBetween(source, '_scheduleAuditVisibleReason', '_scheduleAuditDisplayTime'), context, {filename:'schedule-audit-visible-reason.js'});

test('generic retire-map label does not turn a time move into retirement', () => {
  const item = {_source:'audit', label:'제외/퇴원 예약 편집'};
  const from = {dayToken:'월', time:'4시', lane:'1', row:'1'};
  const to = {dayToken:'월', time:'5시', lane:'1', row:'1'};
  assert.equal(context._scheduleAuditDisappearanceReason(item, item.label, from, to), '시간변경');
});

test('generic retire-map label alone is not an actual retirement', () => {
  const item = {_source:'audit', label:'제외/퇴원 예약 편집'};
  const from = {dayToken:'월', time:'4시', lane:'1', row:'1'};
  assert.equal(context._scheduleAuditDisappearanceReason(item, item.label, from, null), '횟수줄임');
  assert.equal(context._scheduleAuditIsGenericRetireEditSegment(item.label), true);
});

test('explicit retirement records remain retirement', () => {
  const item = {_source:'retire', type:'retire', label:'홍길동 퇴원'};
  const from = {dayToken:'월', time:'4시', lane:'1', row:'1'};
  assert.equal(context._scheduleAuditDisappearanceReason(item, item.label, from, null), '퇴원');
});

test('legacy exclusion without retirement evidence defaults to reduced frequency', () => {
  const from = {dayToken:'월', time:'4시', lane:'1', row:'1'};
  assert.equal(context._scheduleAuditVisibleReason({ds:'2026-07-22'}, '4시/월/1/1', from, null, {}), '횟수줄임');
});
