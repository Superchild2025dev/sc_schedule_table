const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

function source(file){
  return fs.readFileSync(path.join(__dirname,'..',file),'utf8');
}

const permissionPolicy=JSON.parse(source('config/schedule-permissions.json'));

test('no staff browser starts timetable V2 shadow synchronization',()=>{
  assert.equal(fs.existsSync(path.join(__dirname,'..','js','schedule-v2-shadow.js')),false);
  for(const file of ['index.html','desk.html','teacher.html','settings.html']){
    assert.doesNotMatch(source(file),/schedule-v2-shadow\.js/,file);
  }
  assert.doesNotMatch(source('js/firebase-store.js'),/SCV2Shadow|_scheduleV2Shadow/);
});

test('the developer account has a separate full-access staff profile',()=>{
  const auth=source('js/auth-guard.js');
  const developers=permissionPolicy.accounts.filter(account=>account.role==='developer');
  assert.deepEqual(developers.map(account=>account.email),['developer@scswim.local']);
  assert.equal(developers[0].name,'시간표 개발자');
  assert.deepEqual(developers[0].branchIds,['gagyeong','yongam']);
  assert.match(auth,/developer: \['\*'\]/);
  assert.match(auth,/if\(role === 'developer'\) return '개발자'/);
});

test('Firestore blocks generic client V2 writes while retaining attendance paths',()=>{
  const rules=source('firestore.rules');
  assert.match(rules,/function isDeveloper\(\)/);
  assert.match(rules,/"developer@scswim\.local"/);
  assert.match(rules,/allow read: if isOwner\(\) \|\| isDeveloper\(\)/);
  assert.match(rules,/match \/scheduleV2\/\{document=\*\*\} \{[\s\S]*?allow write: if false;/);
  assert.match(rules,/match \/scheduleV2\/\{branch\}\/runtime\/attendance \{[\s\S]*?allow write: if isDeveloper\(\);/);
  assert.match(rules,/collection in \["attendanceRecords", "attendanceGuests"\]/);
});
