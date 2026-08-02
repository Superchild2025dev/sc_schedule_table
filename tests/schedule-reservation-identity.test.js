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

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'table.js'), 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(
  sourceBetween(source, '_scheduleReservationMatchesStudent', '_isBangteukTableActive'),
  context,
  {filename:'schedule-reservation-identity.js'}
);

test('a retirement reservation stays separate when another student occupies the slot', () => {
  const retired = {sid:'old-id', name:'기존원생', p:'01011112222', ds:'2026-08-10', retireType:'retire'};
  const replacement = {sid:'new-id', n:'신규원생', p:'01033334444'};

  assert.equal(context._scheduleReservationMatchesStudent(retired, replacement), false);
});

test('the reservation remains inline for the student it belongs to', () => {
  const retired = {sid:'same-id', name:'기존원생', p:'01011112222'};
  const student = {sid:'same-id', n:'기존원생', p:'01011112222'};

  assert.equal(context._scheduleReservationMatchesStudent(retired, student), true);
});

test('legacy date-only reservations keep their previous slot behavior', () => {
  assert.equal(context._scheduleReservationMatchesStudent('2026-08-10', {n:'기존원생'}), true);
});

test('desktop, attendance, and mobile rendering all use the identity guard', () => {
  const uses = source.match(/_scheduleReservationMatchesStudent\(/g)||[];
  assert.ok(uses.length>=4);
  assert.match(source, /const retireBelongsToStudent=/);
  assert.match(source, /retDs===ds&&_scheduleReservationMatchesStudent/);
});
