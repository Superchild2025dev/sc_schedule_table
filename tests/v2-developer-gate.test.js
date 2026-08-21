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

test('Firestore grants manifest-owned staff V2 reads and blocks every browser V2 write',()=>{
  const rules=source('firestore.rules');
  const v2Rules=rules.slice(rules.indexOf('match /scheduleV2/'),rules.indexOf('match /scheduleStores/'));
  assert.match(rules,/function isDeveloper\(\)/);
  assert.match(rules,/"developer@scswim\.local"/);
  assert.match(rules,/function canReadScheduleV2Runtime\(documentId\)/);
  assert.match(v2Rules,/match \/scheduleV2\/\{branch\}\/runtime\/\{documentId\} \{[\s\S]*?canReadSchedule\(branch\)[\s\S]*?allow write: if false;/);
  assert.match(v2Rules,/match \/scheduleV2\/\{branch\}\/generations\/\{generationId\}\/\{collection\}\/\{recordId\} \{[\s\S]*?canReadScheduleV2GenerationCollection\(collection\)[\s\S]*?allow write: if false;/);
  assert.match(v2Rules,/match \/scheduleV2\/\{branch\}\/requestRecoveries\/\{document=\*\*\} \{[\s\S]*?allow read, write: if false;/);
  assert.doesNotMatch(v2Rules,/allow write: if (?!false)/);
});
