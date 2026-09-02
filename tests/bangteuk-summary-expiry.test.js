const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function sourceBetween(source, startText, endText){
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start, end);
}

const tableSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'table.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'settings.js'), 'utf8');
const settingsHtml = fs.readFileSync(path.join(__dirname, '..', 'settings.html'), 'utf8');

test('settings loads only a currently active vacation tab', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(settingsSource, 'function normalizeStudentTabs', 'function studentTabConfig'),
    context,
    {filename:'settings-active-bangteuk-summary.js'},
  );
  const regular = {id:'regular', name:'정규시간표', type:'regular'};
  const expired = {id:'summer-2026', name:'2026 여름방특', type:'bangteuk', seasonStart:'2026-07-01', seasonEnd:'2026-08-31'};
  const active = {id:'winter-2099', name:'2099 겨울방특', type:'bangteuk', seasonStart:'2000-01-01', seasonEnd:'2099-12-31'};

  assert.deepEqual(
    Array.from(context.selectStudentDirectoryTabs([regular, expired], {tabId:'regular'}), tab => tab.id),
    ['regular'],
  );
  assert.deepEqual(
    Array.from(context.selectStudentDirectoryTabs([regular, expired, active], {tabId:'regular'}), tab => tab.id),
    ['regular', 'winter-2099'],
  );
});

function createSummaryHarness(bangteukActive){
  const context = {
    window:{
      SCScheduleTime:{
        compareTimes:(day,a,b) => String(a).localeCompare(String(b)),
        normalizeTimeBase:value => String(value),
      },
    },
    INST_MAP:{'2시/월/1':{n:'방특선생님', bangteuk:true}},
    STUDENTS:[{n:'방특원생', p:'01012345678', t:'2시', d:'월', l:'1', r:'1'}],
    ENROLL_MAP:{},
    RETIRE_MAP:{},
    DISABLED_MAP:{},
    getDays:() => ['월'],
    getLanes:() => 1,
    getTimes:() => [{t:'2시'}],
    isBangteuk:() => false,
    _summaryBangteukStatsActive:() => bangteukActive,
    _summaryInstExists:inst => !!inst,
    _summaryIsBangteukGroupDay:() => false,
    _summaryIsBangteukInst:inst => !!inst?.bangteuk,
    _summaryIsBangteukSlotKey:() => true,
    _summaryRowsForInst:() => 5,
    _summaryIsTemporaryOnly:() => false,
    _summaryEntryPersonKey:() => '',
    _summaryEntryMatchesPerson:() => true,
    _summaryPairFallback:() => null,
    _summaryDate:value => String(value || ''),
    _retireReservationSuffix:() => '',
    _summaryRetireStatus:() => '퇴원예정',
    _summaryEnrollStatus:() => '등록예정',
    _summaryRecord:(entry,status,slotKey) => ({n:entry.n, p:entry.p, status, slot:{key:slotKey, text:slotKey}}),
    _summaryAddPerson:(map,record) => map.set(record.n, {key:record.n, n:record.n, p:record.p, counted:true, states:new Set([record.status]), slots:[record.slot]}),
    _summaryRowsFromMap:map => [...map.values()],
  };
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(tableSource, 'function getScheduleSummaryData', 'function updateScheduleSummary'),
    context,
    {filename:'table-expired-bangteuk-summary.js'},
  );
  return context;
}

test('main summary excludes vacation capacity students and hours after the season ends', () => {
  const expired = createSummaryHarness(false).getScheduleSummaryData();
  assert.equal(expired.bangteukActive, false);
  assert.equal(expired.bangteukCapacity, 0);
  assert.equal(expired.bangteukHours, 0);
  assert.equal(expired.bangteukRows.length, 0);

  const active = createSummaryHarness(true).getScheduleSummaryData();
  assert.equal(active.bangteukActive, true);
  assert.equal(active.bangteukCapacity, 6);
  assert.equal(active.bangteukHours, 1);
  assert.equal(active.bangteukRows.length, 1);
});

test('main summary hides vacation-only labels when no vacation season is active', () => {
  const wrappers = [{hidden:false}, {hidden:false}, {hidden:false}];
  const elements = {
    'schedule-class-hours':{textContent:''},
    'schedule-bangteuk-hours':{textContent:''},
    'schedule-student-total':{textContent:''},
    'schedule-bangteuk-total':{textContent:''},
  };
  const context = {
    document:{
      getElementById:id => elements[id] || null,
      querySelectorAll:selector => selector === '[data-summary-bangteuk]' ? wrappers : [],
    },
    getScheduleSummaryData:() => ({
      regularHours:10,
      regularCapacity:20,
      countedRows:[],
      bangteukActive:false,
      bangteukHours:0,
      bangteukCapacity:0,
      bangteukRows:[],
    }),
    _summaryNumber:value => String(value || 0),
  };
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(tableSource, 'function updateScheduleSummary', 'function _scheduleStudentRowsForModal'),
    context,
    {filename:'table-bangteuk-summary-visibility.js'},
  );

  context.updateScheduleSummary();
  assert.ok(wrappers.every(node => node.hidden));
});

test('settings hides vacation-only statistic cards after the season ends', () => {
  assert.equal((settingsHtml.match(/data-students-bangteuk-stat/g) || []).length, 2);
  const cards = [{hidden:false}, {hidden:false}];
  const context = {
    document:{querySelectorAll:selector => selector === '[data-students-bangteuk-stat]' ? cards : []},
  };
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(settingsSource, 'function setStudentBangteukStatsVisible', 'function renderStudentDirectory'),
    context,
    {filename:'settings-bangteuk-summary-visibility.js'},
  );

  context.setStudentBangteukStatsVisible(false);
  assert.ok(cards.every(card => card.hidden));
  context.setStudentBangteukStatsVisible(true);
  assert.ok(cards.every(card => !card.hidden));
});
