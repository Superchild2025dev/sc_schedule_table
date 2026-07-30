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

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'firebase-store.js'), 'utf8');
const context = {
  CHUNK_THRESHOLD_BYTES:10,
  CHUNK_SIZE_BYTES:8,
};
vm.createContext(context);
vm.runInContext(
  sourceBetween(source, 'utf8CodePointBytes', 'encodeStoredValue'),
  context
);

test('chunk decision uses UTF-8 bytes instead of JavaScript character count', () => {
  assert.equal('가가가가'.length, 4);
  assert.equal(context.utf8ByteLength('가가가가'), 12);
  assert.equal(context.shouldChunkStoredText('가가가가'), true);
  assert.equal(context.shouldChunkStoredText('1234567890'), false);
});

test('Korean and emoji chunks stay below the byte limit and restore exactly', () => {
  const original = '가나다라마바사😀ABCDEFG';
  const chunks = context.splitChunks(original);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => context.utf8ByteLength(chunk) <= 8));
  assert.equal(chunks.join(''), original);
});
