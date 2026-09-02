const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const runtimePath = path.join(root, 'js', 'preliminary-record.js');
const runtimeSource = fs.existsSync(runtimePath) ? fs.readFileSync(runtimePath, 'utf8') : '';

function loadRuntime(globals){
  const injected=globals||{};
  const window = {...injected};
  const context = { ...injected, window, globalThis: window };
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

test('participant labels keep age beside the name and mark makeup students', () => {
  const runtime = loadRuntime();
  assert.equal(runtime.formatParticipantLabel({type:'regular', n:'신준호', a:7}), '신준호7');
  assert.equal(runtime.formatParticipantLabel({type:'bogang', n:'신준호', a:7}), '신준호7(보강)');
  assert.equal(runtime.formatParticipantLabel({type:'bogang', n:'신준호'}), '신준호(보강)');
});

test('Gagyeong Saturday splits the inherited large areas into normal teacher blocks', () => {
  const runtime = loadRuntime();
  assert.deepEqual(Object.keys(runtime.SATURDAY_LAYOUT), ['9시','10시','11시','12시','1시','2시']);
  assert.deepEqual(
    Object.values(runtime.SATURDAY_LAYOUT).map(blocks=>blocks.length),
    [5,5,5,6,5,6],
  );
  assert.equal(runtime.SATURDAY_TEMPLATE_PATH, 'assets/templates/preliminary-record-saturday-template.xlsx');
});

test('Yongam Saturday keeps only noon expanded for elite and masters classes', () => {
  const runtime=loadRuntime();
  assert.deepEqual(
    Object.values(runtime.YONGAM_SATURDAY_LAYOUT).map(blocks=>blocks.length),
    [5,5,5,4,5,6],
  );
  assert.equal(
    runtime.saturdayTemplateForBranch('yongam'),
    'assets/templates/preliminary-record-saturday-yongam-template.xlsx',
  );
  assert.equal(runtime.saturdayTemplateForBranch('gagyeong'), runtime.SATURDAY_TEMPLATE_PATH);
  assert.equal(runtime.saturdayLayoutForBranch('yongam'), runtime.YONGAM_SATURDAY_LAYOUT);
  assert.equal(runtime.saturdayLayoutForBranch('gagyeong'), runtime.SATURDAY_LAYOUT);
});

test('Saturday display times map back to the timetable storage times', () => {
  const runtime = loadRuntime();
  assert.deepEqual(
    ['9시','10시','11시','12시','1시','2시'].map(time=>runtime.sourceTimeForDay(time,'토')),
    ['1시','2시','3시','4시','5시','6시'],
  );
  assert.equal(runtime.sourceTimeForDay('4시','월'), '4시');
});

test('Saturday afternoon labels use explicit storage times even when the shared mapper leaves them unchanged', () => {
  const runtime=loadRuntime({
    SCScheduleTime:{internalTimeForDay:(day,time)=>time},
  });
  assert.equal(runtime.sourceTimeForDay('1시','토'), '5시');
  assert.equal(runtime.sourceTimeForDay('2시','토'), '6시');
});

test('large-class names follow the visible row order across both lanes', () => {
  const runtime = loadRuntime();
  assert.deepEqual(
    Array.from(runtime.seatCoordinatesForGroup({large:true,lanes:[2,3]}), seat=>({...seat})).slice(0,4),
    [
      {lane:2,row:1},
      {lane:3,row:1},
      {lane:2,row:2},
      {lane:3,row:2},
    ],
  );
});

test('a normal teacher block keeps five roster rows and one empty reserve row', () => {
  const runtime = loadRuntime();
  assert.ok(runtime, 'preliminary record runtime should exist');
  const rows = runtime.normalBlockValues(['가','나','다','라','마','넘침']);
  assert.deepEqual(Array.from(rows), ['가','나','다','라','마','']);
});

test('empty seats are compacted upward inside each teacher block', () => {
  const runtime=loadRuntime();
  assert.deepEqual(
    Array.from(runtime.normalBlockValues(['가','','나',null,'다'])),
    ['가','나','다','','',''],
  );
  assert.deepEqual(
    Array.from(runtime.largeBlockValues(['가','','나'])).slice(0,4),
    ['가','나','',''],
  );
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

test('worksheet relationship paths support both relative and package-absolute targets', () => {
  const runtime=loadRuntime();
  assert.equal(runtime.normalizeZipPath('xl','worksheets/sheet1.xml'),'xl/worksheets/sheet1.xml');
  assert.equal(runtime.normalizeZipPath('xl','/xl/worksheets/sheet1.xml'),'xl/worksheets/sheet1.xml');
});

test('Saturday export keeps every used worksheet row at one fixed height', () => {
  const runtime=loadRuntime();
  const rows=[1,15,29,58,70].map(number=>{
    const attributes={r:String(number)};
    return {
      getAttribute:name=>attributes[name]||null,
      setAttribute:(name,value)=>{ attributes[name]=String(value); },
      attributes,
    };
  });
  const sheetDoc={
    getElementsByTagNameNS:(_namespace,name)=>name==='row'?rows:[],
  };

  runtime.normalizeWorksheetRowHeights(sheetDoc,1,70,15.75);

  rows.forEach(row=>{
    assert.equal(row.attributes.ht,'15.75');
    assert.equal(row.attributes.customHeight,'1');
  });
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
  assert.ok(
    fs.existsSync(path.join(root, 'assets', 'templates', 'preliminary-record-saturday-template.xlsx')),
    'the Saturday workbook template should be bundled'
  );
  assert.ok(
    fs.existsSync(path.join(root, 'assets', 'templates', 'preliminary-record-saturday-yongam-template.xlsx')),
    'the Yongam Saturday workbook template should be bundled'
  );
  assert.match(runtimeSource, /assets\/templates\/preliminary-record-template\.xlsx/);
  assert.match(runtimeSource, /JSZip\.loadAsync/);
  assert.doesNotMatch(runtimeSource, /XLSX\.writeFile/);
});
