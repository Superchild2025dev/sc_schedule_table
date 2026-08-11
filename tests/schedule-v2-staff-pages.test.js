const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
function read(relativePath){return fs.readFileSync(path.join(root,relativePath),'utf8');}

test('teacher and desk startup use selected schedule batches instead of whole V1 roots',()=>{
  for(const file of ['js/teacher.js','js/desk.js']){
    const source=read(file);
    assert.match(source,/SCFirebaseStore\.subscribeSelectedRootBatches\(/,`${file} must use selected batches`);
    assert.doesNotMatch(source,/_fb\.once\('value'\)/,`${file} must not full-read V1 at startup`);
  }
});

test('staff roots are created only inside authenticated startup paths',()=>{
  const teacher=read('js/teacher.js');
  const desk=read('js/desk.js');
  const settings=read('js/settings.js');

  assert.ok(teacher.indexOf('await SCAuth.requireAuth()')<teacher.lastIndexOf('initFirebase();'));
  assert.ok(desk.indexOf('await SCAuth.requireAuth()')<desk.lastIndexOf('if(!initFirebase()) return;'));
  assert.ok(settings.indexOf('SCAuth.requireAuth()')<settings.lastIndexOf('setBranch(activeBranch);'));
});

test('staff pages mutate schedules only through the shared write boundary',()=>{
  for(const file of ['js/core.js','js/data.js','js/teacher.js','js/desk.js','js/settings.js']){
    const source=read(file);
    assert.doesNotMatch(source,/scheduleV2[^\r\n]*\.(?:set|update|delete)\s*\(/,`${file} writes scheduleV2 directly`);
  }
  assert.match(read('js/data.js'),/_scheduleWrites\.transaction\(/);
  assert.match(read('js/teacher.js'),/_teacherWrites\.(?:set|transaction)\(/);
  assert.match(read('js/desk.js'),/_deskWrites\.transaction\(/);
  assert.match(read('js/settings.js'),/_settingsWrites\([^)]*\)\.transaction\(/);
});

test('parent referral and voice runtimes remain outside the operational schedule bootstrap',()=>{
  const parent=read('parent.html');
  assert.doesNotMatch(parent,/schedule-v2-operational-store|schedule-operational-gateway/);
  assert.doesNotMatch(read('js/parent.js'),/SCOperationalSchedule|scheduleV2/);
  assert.doesNotMatch(read('js/referral.js'),/SCOperationalSchedule/);
});
