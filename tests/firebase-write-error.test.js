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

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');

function makeContext(){
  const messages = [];
  const context = {
    navigator:{onLine:true},
    _firebaseWriteWarnedAt:0,
    offlineWarnings:0,
    messages,
    _showOfflineWarning:null,
    toast(message){ messages.push(message); },
    console:{warn(){}},
  };
  context._showOfflineWarning = () => { context.offlineWarnings++; };
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(source, '_firebaseErrorCode', '_showOfflineWarning'),
    context
  );
  return context;
}

test('failed-precondition is a storage error, not a connection outage', () => {
  const context = makeContext();

  context._reportFirebaseWriteFailure({code:'failed-precondition'}, 'audit-index');

  assert.equal(context.offlineWarnings, 0);
  assert.equal(context.messages.length, 1);
  assert.match(context.messages[0], /저장 조건 오류/);
});

test('unavailable still displays the connection warning', () => {
  const context = makeContext();

  context._reportFirebaseWriteFailure({code:'unavailable'}, 'schedule');

  assert.equal(context.offlineWarnings, 1);
  assert.equal(context.messages.length, 0);
});
