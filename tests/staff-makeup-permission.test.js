const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const authSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'auth-guard.js'), 'utf8');
const popupSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'popup-stu.js'), 'utf8');

test('all gagyeong teachers receive the makeup edit exception', () => {
  const staffBlock = authSource.match(/const STAFF_EMAIL_PROFILES = \{([\s\S]*?)\n  \};/);
  assert.ok(staffBlock);
  const permissionRows = staffBlock[1]
    .split('\n')
    .filter(line => line.includes("permissions:['editMakeup']"));

  assert.equal(permissionRows.length, 6);
  [
    'gagyeong.son@scswim.local',
    'gagyeong.park@scswim.local',
    'gagyeong.lee1@scswim.local',
    'gagyeong.kimjy@scswim.local',
    'gagyeong.kimms@scswim.local',
    'gagyeong.yoo@scswim.local',
  ].forEach(email=>{
    assert.ok(permissionRows.some(line=>line.includes(email)), email);
  });
  assert.ok(permissionRows.every(line=>line.includes("branchIds:['gagyeong']")));
  assert.ok(permissionRows.every(line=>line.includes("role:'teacher'")));
  assert.ok(permissionRows.every(line=>!line.includes('yongam.')));
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
