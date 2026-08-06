const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const policy = require('../js/schedule-change-policy.js');

const repoRoot = path.join(__dirname, '..');

function readRepoFile(file){
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

function functionSource(source,name,nextName){
  const start=source.indexOf(`function ${name}`);
  assert.notEqual(start,-1,`${name} is missing`);
  const end=nextName?source.indexOf(`function ${nextName}`,start+1):source.indexOf('\nfunction ',start+1);
  assert.notEqual(end,-1,`${name} boundary is missing`);
  return source.slice(start,end);
}

test('movement reason follows day, time, then class priority', () => {
  const from = {dayToken:'월수금', time:'4시', lane:'1', row:'1'};

  assert.equal(policy.movementReason(from, {...from, dayToken:'화목'}), '일정변경');
  assert.equal(policy.movementReason(from, {...from, time:'5시'}), '시간변경');
  assert.equal(policy.movementReason(from, {...from, lane:'2'}), '반변경');
  assert.equal(policy.movementReason(from, {...from, row:'2'}), '반변경');
  assert.equal(policy.movementReason(from, {...from}), '');
});

test('explicit reservation type wins over legacy retirement history', () => {
  const history = [{retiredAt:'2026-08-31', n:'홍길동', p:'01012345678', t:'4시', d:'월', l:1, r:1}];
  const context = {
    history,
    slotKey:'4시/월/1/1',
    student:{n:'홍길동', p:'010-1234-5678'},
  };

  assert.equal(policy.isActualRetirement({ds:'2026-08-31', retireType:'retire'}, context), true);
  assert.equal(policy.isActualRetirement({ds:'2026-08-31', retireType:'exclude'}, context), false);
  assert.equal(policy.reservationKind({ds:'2026-08-31', retireType:'retire'}, context), 'retire');
  assert.equal(policy.reservationKind({ds:'2026-08-31', retireType:'exclude'}, context), 'exclude');
});

test('legacy reservation becomes retirement only with matching retirement evidence', () => {
  const entry = {ds:'2026-08-31', name:'홍길동', p:'01012345678'};
  const matching = {
    history:[{retiredAt:'2026-08-31', n:'홍길동', p:'010-1234-5678', t:'4시', d:'월', l:1, r:1}],
    slotKey:'4시/월/1/1',
  };

  assert.equal(policy.isActualRetirement(entry, matching), true);
  assert.equal(policy.isActualRetirement(entry, {...matching, slotKey:'5시/월/1/1'}), false);
  assert.equal(policy.isActualRetirement(entry, {history:[]}), false);
});

test('reservation kinds distinguish reduced frequency, move, and general exclusion', () => {
  const movePredicate = entry => entry && entry.pairKey === 'paired';

  assert.equal(policy.reservationKind({retireType:'exclude', excludeReason:'reduce'}), 'reduce');
  assert.equal(policy.reservationKind({retireType:'exclude', excludeReason:'move'}), 'move');
  assert.equal(policy.reservationKind({retireType:'exclude', pairKey:'paired'}, {isMoveEntry:movePredicate}), 'move');
  assert.equal(policy.reservationKind({retireType:'exclude'}), 'exclude');
  assert.equal(policy.reservationKind({ds:'2026-08-31'}), 'exclude');
});

test('reservation labels and statuses share the same classification', () => {
  assert.equal(policy.reservationLabel({retireType:'retire'}), '퇴원');
  assert.equal(policy.reservationStatus({retireType:'retire'}), '퇴원예정');
  assert.equal(policy.reservationLabel({retireType:'exclude', excludeReason:'reduce'}), '횟수줄임');
  assert.equal(policy.reservationStatus({retireType:'exclude', excludeReason:'reduce'}), '횟수줄임예정');
  assert.equal(policy.reservationLabel({retireType:'exclude', excludeReason:'move'}), '이동');
  assert.equal(policy.reservationStatus({retireType:'exclude', excludeReason:'move'}), '이동예정');
  assert.equal(policy.reservationLabel({retireType:'exclude'}), '제외');
  assert.equal(policy.reservationStatus({retireType:'exclude'}), '제외예정');
});

test('visible lower-record reason prioritizes retirement and movement', () => {
  const from = {dayToken:'월', time:'4시', lane:'1', row:'1'};

  assert.equal(policy.visibleChangeReason({entry:{retireType:'retire'}, fromSlot:from}), '퇴원');
  assert.equal(policy.visibleChangeReason({
    entry:{retireType:'exclude', excludeReason:'reduce'},
    fromSlot:from,
    toSlot:{...from, time:'5시'},
  }), '시간변경');
  assert.equal(policy.visibleChangeReason({entry:{retireType:'exclude', excludeReason:'reduce'}}), '횟수줄임');
  assert.equal(policy.visibleChangeReason({entry:{retireType:'exclude', excludeReason:'move'}}), '반변경');
  assert.equal(policy.visibleChangeReason({entry:{retireType:'exclude'}}), '횟수줄임');
});

test('generated generic deletions are suppressed but manual deletions remain', () => {
  assert.equal(policy.shouldSuppressGenericDelete({
    _source:'audit',
    change:'삭제',
    operationLabel:'자동 등록·제외 처리',
    deleteReason:'auto-retire',
  }), true);
  assert.equal(policy.shouldSuppressGenericDelete({
    _source:'audit',
    change:'삭제',
    operationType:'move',
    operationLabel:'원생 이동',
  }), true);
  assert.equal(policy.shouldSuppressGenericDelete({
    _source:'audit',
    change:'삭제',
    operationLabel:'퇴원 예약 처리',
  }), true);
  assert.equal(policy.shouldSuppressGenericDelete({
    _source:'manual',
    manual:true,
    change:'삭제',
    operationLabel:'학생 직접 삭제',
    deleteReason:'manual-delete',
  }), false);
  assert.equal(policy.shouldSuppressGenericDelete({_source:'audit', change:'퇴원'}), false);
});

test('policy does not mutate entry, context, or slot inputs', () => {
  const entry = Object.freeze({ds:'2026-08-31', retireType:'exclude', excludeReason:'move'});
  const from = Object.freeze({dayToken:'월', time:'4시', lane:'1', row:'1'});
  const to = Object.freeze({dayToken:'수', time:'4시', lane:'1', row:'1'});
  const history = Object.freeze([]);
  const context = Object.freeze({history});

  assert.doesNotThrow(() => policy.reservationKind(entry, context));
  assert.doesNotThrow(() => policy.visibleChangeReason({entry, context, fromSlot:from, toSlot:to}));
  assert.equal(entry.excludeReason, 'move');
});

test('main page loads the change policy before schedule data', () => {
  const html=readRepoFile('index.html');
  const policyIndex=html.indexOf("scJs('js/schedule-change-policy.js')");
  const dataIndex=html.indexOf("scJs('js/data.js')");

  assert.notEqual(policyIndex,-1,'change policy script is missing');
  assert.ok(policyIndex<dataIndex,'change policy must load before schedule data');
});

test('table reservation display delegates to the shared policy', () => {
  const source=readRepoFile(path.join('js','table.js'));
  const actual=functionSource(source,'_retireReservationIsActual','_retireReservationSuffix');
  const label=functionSource(source,'_retireReservationKindLabel','_summaryRetireStatus');
  const status=functionSource(source,'_summaryRetireStatus','_summaryEnrollStatus');

  assert.match(actual,/SCScheduleChangePolicy\.isActualRetirement/);
  assert.match(label,/SCScheduleChangePolicy\.reservationLabel/);
  assert.match(status,/SCScheduleChangePolicy\.reservationStatus/);
});

test('student popup reservation display delegates to the shared policy', () => {
  const source=readRepoFile(path.join('js','popup-stu.js'));
  const kind=functionSource(source,'_retireChoiceKind','_popupRetireIsActual');
  const actual=functionSource(source,'_popupRetireIsActual','_popupRetireDateLabel');
  const reason=functionSource(source,'_popupRetireReasonText','_retireHistoryMatches');

  assert.match(kind,/SCScheduleChangePolicy\.reservationKind/);
  assert.match(actual,/SCScheduleChangePolicy\.isActualRetirement/);
  assert.match(reason,/SCScheduleChangePolicy\.reservationLabel/);
});

test('lower schedule records delegate classification to the shared policy', () => {
  const source=readRepoFile(path.join('js','data.js'));
  const movement=functionSource(source,'_scheduleAuditMovementReason','_scheduleAuditDisappearanceReason');
  const actual=functionSource(source,'_scheduleAuditIsActualRetire','_scheduleAuditVisibleReason');
  const visible=functionSource(source,'_scheduleAuditVisibleReason','_scheduleAuditDisplayTime');
  const suppress=functionSource(
    source,
    '_deskNoteIsGenericDeleteFromSpecificOperation',
    '_deskNotesWithoutGenericDeletesFromSpecificOperations'
  );

  assert.match(movement,/SCScheduleChangePolicy\.movementReason/);
  assert.match(actual,/SCScheduleChangePolicy\.isActualRetirement/);
  assert.match(visible,/SCScheduleChangePolicy\.visibleChangeReason/);
  assert.match(suppress,/SCScheduleChangePolicy\.shouldSuppressGenericDelete/);
  assert.doesNotMatch(suppress,/예약\\s\*|시간변경\|반변경\|일정변경/);
});
