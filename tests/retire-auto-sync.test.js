const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'table.js'), 'utf8');
const start = source.indexOf('function _retireReservationDueForAutoApply');
const end = source.indexOf('function syncStudentsBeforeRender', start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

const context = {};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context, {filename:'retire-auto-sync.js'});

test('only a past retirement date is automatically applied', () => {
  const today = '2026-07-30';

  assert.equal(context._retireReservationDueForAutoApply({ds:'2026-07-29'}, today), true);
  assert.equal(context._retireReservationDueForAutoApply({ds:'2026-07-30'}, today), false);
  assert.equal(context._retireReservationDueForAutoApply({ds:'2026-07-31'}, today), false);
});

test('blocked, missing, and legacy reservation values are handled safely', () => {
  const today = '2026-07-30';

  assert.equal(context._retireReservationDueForAutoApply({ds:'2026-07-29', blocked:true}, today), false);
  assert.equal(context._retireReservationDueForAutoApply({}, today), false);
  assert.equal(context._retireReservationDueForAutoApply('2026-07-29', today), true);
});
