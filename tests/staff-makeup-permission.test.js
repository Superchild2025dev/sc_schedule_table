const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const popupSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'popup-stu.js'), 'utf8');
const permissionPolicy = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'config', 'schedule-permissions.json'),
  'utf8'
));

test('all gagyeong teachers receive the makeup edit exception', () => {
  const teachers = permissionPolicy.accounts.filter(account =>
    account.role === 'teacher' && account.branchIds.includes('gagyeong')
  );
  assert.equal(teachers.length, 6);
  [
    'gagyeong.son@scswim.local',
    'gagyeong.park@scswim.local',
    'gagyeong.lee1@scswim.local',
    'gagyeong.kimjy@scswim.local',
    'gagyeong.kimms@scswim.local',
    'gagyeong.yoo@scswim.local',
  ].forEach(email=>{
    assert.ok(teachers.some(account=>account.email === email), email);
  });
  assert.ok(teachers.every(account=>account.permissions.includes('editMakeup')));
  assert.ok(teachers.every(account=>account.branchIds.length === 1));
  assert.ok(teachers.every(account=>!account.email.startsWith('yongam.')));
});

test('makeup-only popup exposes only makeup mutation handlers', () => {
  const handlerBlock = popupSource.match(/const STU_POPUP_MAKEUP_HANDLERS = \[([\s\S]*?)\n\];/);
  assert.ok(handlerBlock);
  assert.match(handlerBlock[1], /sp-mark-absent/);
  assert.match(handlerBlock[1], /sp-mark-bogang-show/);
  assert.match(handlerBlock[1], /sp-mark-bogang-del/);
  assert.match(handlerBlock[1], /sp-mark-bogang/);
  assert.doesNotMatch(handlerBlock[1], /sample|retire|enroll|hyuwon/);
});

test('makeup save and delete enforce the dedicated permission', () => {
  assert.match(popupSource, /function handleBogangSet[\s\S]*?requireStuPopupBogangEdit\(\)/);
  assert.match(popupSource, /function handleBogangDel[\s\S]*?requireStuPopupBogangEdit\(\)/);
});

test('limited popup keeps absence editing behind attendance permission', () => {
  assert.match(popupSource, /function handleMarkAbsent[\s\S]*?requireStuPopupAbsenceEdit\(\)/);
  assert.match(popupSource, /stuPopupCanEditAbsence\(\)\?`<button class="btn" id="sp-mark-absent"/);
});
