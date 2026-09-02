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

function createHarness(tab, options){
  const settings = options || {};
  const context = {
    _activeTab:tab.id,
    _tabById:() => tab,
    _tabPeriodMonth:() => settings.storedMonth || tab.periodMonth || '',
    _mainTabSetting:() => ({tabId:settings.mainTabId || 'regular'}),
    _defaultPeriodMonth:() => settings.liveMonth || '2026-09',
    _scheduleAuditNormalizeMonthKey:value => String(value || ''),
    getDateHeaders:() => settings.dateHeaders || {},
    _periodMonthForDate:ds => (settings.periodByDate || {})[ds] || String(ds || '').slice(0, 7),
    getToday:() => new Date(2026, 8, 7),
    toDateStr:() => '2026-09-07',
  };
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(dataSource, '_scheduleAuditMonthFromTabName', '_scheduleAuditText'),
    context,
    {filename:'schedule-audit-operating-month.js'},
  );
  return context;
}

test('the live regular schedule uses its operating month instead of a stale tab name', () => {
  const context = createHarness(
    {id:'regular', type:'regular', name:'8월 시간표', periodMonth:'2026-08'},
    {liveMonth:'2026-09', storedMonth:'2026-08'},
  );

  assert.equal(context._scheduleAuditMonthKey(), '2026-09');
});

test('a historical snapshot still uses the month shown in its tab name', () => {
  const context = createHarness(
    {id:'snapshot-august', type:'snapshot', name:'8월출석부 박제', periodMonth:'2026-09'},
    {liveMonth:'2026-09', storedMonth:'2026-09'},
  );

  assert.equal(context._scheduleAuditMonthKey(), '2026-08');
});

test('each weekday uses the operating month of its displayed class date', () => {
  const context = createHarness(
    {id:'regular', type:'regular', name:'8월 시간표', periodMonth:'2026-08'},
    {
      liveMonth:'2026-08',
      dateHeaders:{
        월:{ds:'2026-09-07'},
        화:{ds:'2026-09-01'},
        수:{ds:'2026-09-02'},
      },
      periodByDate:{
        '2026-09-07':'2026-09',
        '2026-09-01':'2026-08',
        '2026-09-02':'2026-08',
      },
    },
  );

  assert.deepEqual(
    {...context._scheduleAuditMonthKeysByDay(['월', '화', '수'], context._scheduleAuditMonthKey())},
    {월:'2026-09', 화:'2026-08', 수:'2026-08'},
  );
});

test('record dates are classified by the configured operating period at a month boundary', () => {
  const context = {
    _periodMonthForDate:ds => ({
      '2026-09-01':'2026-08',
      '2026-09-07':'2026-09',
    })[ds] || '',
    _scheduleAuditNormalizeMonthKey:value => String(value || ''),
  };
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(dataSource, '_deskNoteMonthFromDateKey', '_deskNoteMonthFromDateText'),
    context,
    {filename:'schedule-audit-record-operating-month.js'},
  );

  assert.equal(context._scheduleAuditPeriodMonthFromDateKey('2026-09-01'), '2026-08');
  assert.equal(context._scheduleAuditPeriodMonthFromDateKey('2026-09-07'), '2026-09');
});

test('lower records use a different operating month for each weekday', () => {
  const context = {
    _periodMonthForDate:ds => ds === '2026-09-07' ? '2026-09' : '2026-08',
    _scheduleAuditNormalizeMonthKey:value => String(value || ''),
    _scheduleAuditRecordIsBangteuk:() => false,
    getToday:() => new Date(2026, 8, 7),
  };
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(dataSource, '_scheduleAuditMonthFromTabName', '_scheduleAuditText')
      + sourceBetween(dataSource, '_deskNoteMonthFromDateKey', '_deskNoteCanSave')
      + sourceBetween(dataSource, '_deskNoteVisible', '_deskNoteIsRetireHistoryProjection'),
    context,
    {filename:'schedule-audit-weekday-filter.js'},
  );
  const monthKeys={월:'2026-09', 화:'2026-08', 수:'2026-08'};

  assert.equal(context._deskNoteVisible({day:'월', date:'9/7'}, monthKeys, ['월', '화', '수'], '2026-08'), true);
  assert.equal(context._deskNoteVisible({day:'화', date:'9/1'}, monthKeys, ['월', '화', '수'], '2026-08'), true);
  assert.equal(context._deskNoteVisible({day:'수', date:'9/7'}, monthKeys, ['월', '화', '수'], '2026-08'), false);
});

test('an automatic row keeps its weekday operating month even when the clicked date belongs to the prior period', () => {
  const context = {
    _periodMonthForDate:ds => ds === '2026-09-02' ? '2026-08' : String(ds || '').slice(0, 7),
    _scheduleAuditNormalizeMonthKey:value => String(value || ''),
    _scheduleAuditRecordIsBangteuk:() => false,
    getToday:() => new Date(2026, 8, 2),
  };
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(dataSource, '_scheduleAuditMonthFromTabName', '_scheduleAuditText')
      + sourceBetween(dataSource, '_deskNoteMonthFromDateKey', '_deskNoteCanSave')
      + sourceBetween(dataSource, '_deskNoteVisible', '_deskNoteIsRetireHistoryProjection'),
    context,
    {filename:'schedule-audit-explicit-period.js'},
  );
  const monthKeys={월:'2026-09', 화:'2026-08'};
  const note={day:'월', date:'9/2', dateKey:'2026-09-02', recordMonthKey:'2026-09'};

  assert.equal(context._deskNoteVisible(note, monthKeys, ['월', '화'], '2026-08'), true);
});

test('generated notes store the weekday operating month separately from the clicked date', () => {
  const context = {
    _deskNoteRecordedDate:() => ({key:'2026-09-02',label:'9/2'}),
    _deskNoteSourceKeyForRow:() => 'regular|2026-08|row',
    _scheduleAuditScopeFromItem:() => ({tabId:'regular',tabName:'운영 시간표',tabType:'regular'}),
    _scheduleAuditRecordIsBangteuk:() => false,
    _scheduleAuditPeriodMonthFromDateKey:() => '2026-08',
    _scheduleAuditNormalizeMonthKey:value => String(value || ''),
    _scheduleAuditMonthKey:() => '2026-08',
    _deskNoteId:() => 'desk_test',
  };
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(dataSource, '_deskNoteFromScheduleRow', 'ensureDeskNoteForRetireReservation'),
    context,
    {filename:'schedule-audit-generated-period.js'},
  );
  const note=context._deskNoteFromScheduleRow({
    day:'월',
    teacher:'김선생',
    target:'홍길동',
    reason:'삭제',
    date:'9/2',
    dateKey:'2026-09-02',
    time:'4시',
    at:'2026-09-02T10:00:00',
    source:'audit',
    recordMonthKey:'2026-09',
    monthKey:'2026-09',
  });

  assert.equal(note.date, '9/2');
  assert.equal(note.recordMonthKey, '2026-09');
});

test('an untouched automatic note can repair a stale operating month', () => {
  const context = {
    _scheduleAuditNormalizeMonthKey:value => String(value || ''),
  };
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(dataSource, '_deskNoteNeedsGeneratedMonthRepair', '_syncDeskNotesFromRows'),
    context,
    {filename:'schedule-audit-month-repair.js'},
  );

  assert.equal(context._deskNoteNeedsGeneratedMonthRepair(
    {recordMonthKey:'2026-08', source:'audit', createdAt:'same', updatedAt:'same'},
    {recordMonthKey:'2026-09'},
  ), true);
});

test('a desk-edited note never has its operating month repaired automatically', () => {
  const context = {
    _scheduleAuditNormalizeMonthKey:value => String(value || ''),
  };
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(dataSource, '_deskNoteNeedsGeneratedMonthRepair', '_syncDeskNotesFromRows'),
    context,
    {filename:'schedule-audit-month-repair-guard.js'},
  );

  assert.equal(context._deskNoteNeedsGeneratedMonthRepair(
    {recordMonthKey:'2026-08', source:'audit', createdAt:'before', updatedAt:'after'},
    {recordMonthKey:'2026-09'},
  ), false);
  assert.equal(context._deskNoteNeedsGeneratedMonthRepair(
    {recordMonthKey:'2026-08', manual:true},
    {recordMonthKey:'2026-09'},
  ), false);
});

test('audit rows use their captured weekday month without pulling old history into the current month', () => {
  const context = {
    _scheduleAuditNormalizeMonthKey:value => String(value || ''),
    _scheduleAuditPeriodMonthFromDateKey:key => ({
      '2026-06-15':'2026-06',
      '2026-08-31':'2026-08',
      '2026-09-02':'2026-08',
    })[key] || String(key || '').slice(0, 7),
  };
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(dataSource, '_scheduleAuditRecordMonthForDay', '_scheduleAuditRowsForItem'),
    context,
    {filename:'schedule-audit-row-month.js'},
  );

  assert.equal(context._scheduleAuditRecordMonthForDay(
    {operatingMonthsByDay:{월:'2026-09'}},
    '2026-08-31',
    '월',
    '2026-09',
  ), '2026-09');
  assert.equal(context._scheduleAuditRecordMonthForDay(
    {},
    '2026-09-02',
    '월',
    '2026-09',
  ), '2026-09');
  assert.equal(context._scheduleAuditRecordMonthForDay(
    {},
    '2026-06-15',
    '월',
    '2026-09',
  ), '2026-06');
});
