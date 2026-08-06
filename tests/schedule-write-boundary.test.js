const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OPERATIONAL_FILES = [
  'js/core.js',
  'js/data.js',
  'js/tabs.js',
  'js/init.js',
  'js/popup-stu.js',
  'js/teachers.js',
  'js/table.js',
  'js/teacher.js',
  'js/desk.js',
  'js/settings.js',
];

test('operational schedule code cannot write through Firebase roots directly', () => {
  const violations = [];
  const directRootWrite = /_fb(?:\.child\([^\r\n]+?\))?\.(?:set|remove|transaction|transactionKeys)\s*\(/g;
  const directBranchWrite = /branchRoot\([^\r\n]+?\)(?:\.child\([^\r\n]+?\))?\.(?:set|remove|transaction|transactionKeys)\s*\(/g;

  for(const relativePath of OPERATIONAL_FILES){
    const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    for(const pattern of [directRootWrite, directBranchWrite]){
      pattern.lastIndex = 0;
      for(const match of source.matchAll(pattern)){
        const line = source.slice(0, match.index).split(/\r?\n/).length;
        violations.push(`${relativePath}:${line} ${match[0]}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
