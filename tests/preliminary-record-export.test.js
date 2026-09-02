const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const runtimePath = path.join(root, 'js', 'preliminary-record.js');
const runtimeSource = fs.existsSync(runtimePath) ? fs.readFileSync(runtimePath, 'utf8') : '';

function loadRuntime(){
  const window = {};
  const context = { window, globalThis: window };
  if(runtimeSource) vm.runInNewContext(runtimeSource, context, { filename: 'preliminary-record.js' });
  return window.SCPreliminaryRecord;
}

test('a date-specific makeup replaces the regular student in the same slot', () => {
  const runtime = loadRuntime();
  assert.ok(runtime, 'preliminary record runtime should exist');
  const selected = runtime.selectDisplayedOccupant([
    { type: 'regular', n: '정규원생' },
    { type: 'bogang', n: '보강원생' },
  ]);
  assert.equal(selected.n, '보강원생');
  assert.equal(selected.type, 'bogang');
});

test('a normal teacher block keeps five roster rows and one empty reserve row', () => {
  const runtime = loadRuntime();
  assert.ok(runtime, 'preliminary record runtime should exist');
  const rows = runtime.normalBlockValues(['가','나','다','라','마','넘침']);
  assert.deepEqual(Array.from(rows), ['가','나','다','라','마','']);
});

test('master and elite blocks keep their original eighteen-row area', () => {
  const runtime = loadRuntime();
  assert.ok(runtime, 'preliminary record runtime should exist');
  const names = Array.from({ length: 20 }, (_, i) => `원생${i + 1}`);
  const rows = runtime.largeBlockValues(names);
  assert.equal(rows.length, 18);
  assert.equal(rows[0], '원생1');
  assert.equal(rows[17], '원생18');
});

test('grade events records and division stay blank in generated participant rows', () => {
  const runtime = loadRuntime();
  assert.ok(runtime, 'preliminary record runtime should exist');
  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.participantRow('홍길동'))),
    { name:'홍길동', grade:'', event1:'', record1:'', event2:'', record2:'', division:'' }
  );
});

test('export waits until timetable data has been loaded', () => {
  const runtime = loadRuntime();
  assert.equal(runtime.isScheduleDataReady(undefined, undefined), false);
  assert.equal(runtime.isScheduleDataReady([], {}), true);
});

test('template cell addresses are generated without the spreadsheet writer', () => {
  const runtime = loadRuntime();
  assert.equal(runtime.decodeColumn('A'), 0);
  assert.equal(runtime.decodeColumn('AC'), 28);
  assert.equal(runtime.encodeColumn(0), 'A');
  assert.equal(runtime.encodeColumn(28), 'AC');
});

test('serialized workbook XML keeps exactly one declaration', () => {
  const runtime = loadRuntime();
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  assert.equal(runtime.ensureXmlDeclaration('<workbook/>'), declaration+'<workbook/>');
  assert.equal(runtime.ensureXmlDeclaration(declaration+'<workbook/>'), declaration+'<workbook/>');
});

test('the timetable page exposes a dated preliminary-record export backed by the template', () => {
  const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(indexSource, /id="preliminary-record-btn"/);
  assert.match(indexSource, /jszip/i);
  assert.match(indexSource, /js\/preliminary-record\.js/);
  assert.ok(
    fs.existsSync(path.join(root, 'assets', 'templates', 'preliminary-record-template.xlsx')),
    'the original workbook template should be bundled'
  );
  assert.match(runtimeSource, /assets\/templates\/preliminary-record-template\.xlsx/);
  assert.match(runtimeSource, /JSZip\.loadAsync/);
  assert.doesNotMatch(runtimeSource, /XLSX\.writeFile/);
});
