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
const popupSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'popup-stu.js'), 'utf8');
const context = {
  getToday:() => new Date('2026-07-30T12:00:00+09:00'),
  toDateStr:() => '2026-07-30',
  _recordLocalDateKey:() => '2026-07-30',
  _scheduleAuditShortDateFromKey:key => {
    const parts = String(key || '').split('-');
    return parts.length === 3 ? `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}` : '';
  },
};
context.window = context;
context.globalThis = context;
vm.createContext(context);

const scheduleTimeSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'schedule-time.js'), 'utf8');
vm.runInContext(scheduleTimeSource, context, {filename:'schedule-time.js'});
vm.runInContext(
  sourceBetween(source, '_deskNoteRecordedDate', '_deskNoteFromScheduleRow')
    + sourceBetween(source, '_deskNoteMatchesRetireCancellation', 'removeDeskNotesForRetireReservation')
    + sourceBetween(source, '_deskNoteSourceKeyForRow', '_deskNoteVisible')
    + sourceBetween(source, '_scheduleAuditSlotFromText', '_scheduleAuditNameFromSegment')
    + sourceBetween(source, '_deskNoteRetireProcessingKey', '_deskNoteAutomaticMovementKey')
    + sourceBetween(source, '_deskNoteAutomaticMovementKey', '_findDeskNote')
    + sourceBetween(source, '_deskNoteAutomaticMovementReason', '_updateDeskNotesTx'),
  context,
  {filename:'retire-desk-note-lifecycle.js'}
);

test('future retirement uses today as the processing date', () => {
  const written = context._deskNoteRecordedDate({
    source:'visible-reservation',
    dateKey:'2026-08-10',
    date:'8/10',
    at:'2026-08-10T00:00:00',
  });

  assert.deepEqual({...written}, {key:'2026-07-30', label:'7/30'});
});

test('reservation source key stays stable when the effective date changes', () => {
  const keyBefore = context._deskNoteReservationSourceKey('regular-july', '5시/월/1/1', '월');
  const keyAfter = context._deskNoteReservationSourceKey('regular-july', '5시/월/1/1', '월');

  assert.equal(keyBefore, keyAfter);
  assert.equal(keyBefore, 'regular-july|retire-reservation|5시/월/1/1|월');
});

test('changing a retirement date updates one row instead of adding another', () => {
  const sourceKey = context._deskNoteReservationSourceKey('regular-july', '5시/월/1/1', '월');
  const before = {
    id:'old',
    sourceKey,
    source:'visible-reservation',
    reservationSlotKey:'5시/월/1/1',
    tabId:'regular-july',
    day:'월',
    student:'이도윤',
    time:'5시',
    date:'7/30',
    effectiveDateKey:'2026-08-05',
    detail:'이도윤 · 퇴원 적용일: 8/5',
  };
  const after = {
    ...before,
    id:'new',
    effectiveDateKey:'2026-08-12',
    detail:'이도윤 · 퇴원 적용일: 8/12',
  };

  const result = context._mergeDeskNote([before], after);

  assert.equal(result.length, 1);
  assert.equal(result[0].effectiveDateKey, '2026-08-12');
  assert.match(result[0].detail, /8\/12/);
});

test('cancelling a reservation removes its automatic row but keeps manual notes', () => {
  const exactKeys = new Set(['regular-july|retire-reservation|5시/월/1/1|월']);
  const identityKeys = new Set(
    context._deskNoteRetireProcessingKeys({
      tabId:'regular-july',
      day:'월',
      student:'이도윤',
      time:'5시',
    })
  );
  const automatic = {
    sourceKey:'regular-july|retire-reservation|5시/월/1/1|월',
    source:'visible-reservation',
    effectiveDateKey:'2026-08-12',
  };
  const manual = {...automatic, sourceKey:'manual', manual:true};

  assert.equal(
    context._deskNoteMatchesRetireCancellation(automatic, exactKeys, identityKeys, '2026-08-12'),
    true
  );
  assert.equal(
    context._deskNoteMatchesRetireCancellation(manual, exactKeys, identityKeys, '2026-08-12'),
    false
  );
});

test('cancelling one effective date does not remove another legacy reservation row', () => {
  const exactKeys = new Set();
  const candidate = {
    tabId:'regular-july',
    day:'월',
    student:'이도윤',
    time:'5시',
  };
  const identityKeys = new Set(context._deskNoteRetireProcessingKeys(candidate));
  const otherDate = {
    ...candidate,
    source:'visible-reservation',
    effectiveDateKey:'2026-08-19',
  };

  assert.equal(
    context._deskNoteMatchesRetireCancellation(otherDate, exactKeys, identityKeys, '2026-08-12'),
    false
  );
});

test('same-name retirement in another lane is not merged or cancelled', () => {
  const firstKey = context._deskNoteReservationSourceKey('regular-july', '5시/월/1/1', '월');
  const secondKey = context._deskNoteReservationSourceKey('regular-july', '5시/월/2/1', '월');
  const first = {
    id:'first',
    sourceKey:firstKey,
    source:'visible-reservation',
    reservationSlotKey:'5시/월/1/1',
    tabId:'regular-july',
    day:'월',
    student:'동명이인',
    time:'5시',
    effectiveDateKey:'2026-08-12',
  };
  const second = {
    ...first,
    id:'second',
    sourceKey:secondKey,
    reservationSlotKey:'5시/월/2/1',
  };
  const merged = context._mergeDeskNote([first], second);
  const exactKeys = new Set([firstKey]);
  const identityKeys = new Set(context._deskNoteRetireProcessingKeys(first));

  assert.equal(merged.length, 2);
  assert.equal(
    context._deskNoteMatchesRetireCancellation(second, exactKeys, identityKeys, '2026-08-12'),
    false
  );
});

test('atomic cancellation removes only the matching automatic row', () => {
  context._scheduleAuditSlotFromKey = key => {
    const [time, dayToken, lane, row] = String(key).split('/');
    return {time, dayToken, lane, row};
  };
  context._scheduleAuditActiveScope = () => ({
    tabId:'regular-july',
    tabName:'7월 시간표',
    tabType:'regular',
  });
  context._scheduleAuditRecordIsBangteuk = () => false;
  context._scheduleAuditDays = () => ['월'];
  context._scheduleAuditExpandDay = day => [day];
  context._scheduleAuditEntryNameFromSlot = entry => entry.name;
  context._scheduleAuditEntryDate = entry => entry.ds;
  context._scheduleAuditDisplayTime = slot => slot.time;
  context._normalizeDeskNotesList = list => Array.isArray(list) ? list : [];

  const matching = {
    id:'matching',
    sourceKey:'regular-july|retire-reservation|5시/월/1/1|월',
    source:'visible-reservation',
    reservationSlotKey:'5시/월/1/1',
  };
  const otherLane = {
    ...matching,
    id:'other-lane',
    sourceKey:'regular-july|retire-reservation|5시/월/2/1|월',
    reservationSlotKey:'5시/월/2/1',
  };
  const manual = {...matching, id:'manual', sourceKey:'manual', manual:true};
  const result = context._deskNotesAfterRetireReservationCancellation(
    [matching, otherLane, manual],
    '5시/월/1/1',
    {name:'동명이인', ds:'2026-08-12'},
    {n:'동명이인'},
    {}
  );

  assert.deepEqual(Array.from(result, row => row.id), ['other-lane', 'manual']);
});

test('live retirement cancellation writes reservation and lower record in one transaction', async () => {
  let txKeys = [];
  let txRoot = {
    retire:{'5시/월/1/1':{name:'이도윤', ds:'2026-08-12'}},
    enroll:{},
    notes:[{id:'retire-note'}],
  };
  const txContext = {
    RETIRE_MAP:txRoot.retire,
    STORAGE_KEYS:{RETIRE:'retire', ENROLL:'enroll', DESK_NOTES:'notes'},
    _slotParts:() => ({t:'5시', d:'월', l:1, r:1}),
    _isBangteukPopupSlot:() => false,
    _deskNotesAfterRetireReservationCancellation:() => [],
    _deleteReserveMovePair:(retire,enroll,kind,slotKey) => {
      delete retire[slotKey];
      return false;
    },
    updateScheduleTx:async (keys,mutator) => {
      txKeys = keys.slice();
      const ctx = {
        get:(key,fallback) => txRoot[key] ?? fallback,
        set:(key,value) => { txRoot[key] = value; },
        abort:reason => { throw new Error(reason); },
      };
      mutator(ctx);
    },
  };
  vm.createContext(txContext);
  const deleteRetireSource = sourceBetween(
    popupSource,
    'deleteRetireReservation',
    'deleteEnrollReservation'
  ).replace(/\s*async\s*$/, '');
  vm.runInContext(
    'async ' + deleteRetireSource,
    txContext
  );

  await txContext.deleteRetireReservation(
    '5시/월/1/1',
    {n:'이도윤'},
    {}
  );

  assert.deepEqual(Array.from(txKeys), ['retire', 'enroll', 'notes']);
  assert.deepEqual({...txRoot.retire}, {});
  assert.deepEqual(Array.from(txRoot.notes), []);
});
