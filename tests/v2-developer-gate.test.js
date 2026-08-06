const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

function source(file){
  return fs.readFileSync(path.join(__dirname,'..',file),'utf8');
}

const permissionPolicy=JSON.parse(source('config/schedule-permissions.json'));

test('only the dedicated developer account starts V2 shadow synchronization',()=>{
  const shadow=source('js/schedule-v2-shadow.js');
  assert.match(shadow,/SC_DEVELOPER_EMAILS/);
  assert.match(shadow,/if\(!developerSignedIn\(\)\) return/);
  assert.match(shadow,/isDeveloperSession:developerSignedIn/);
  assert.doesNotMatch(shadow,/const OWNER_EMAIL=/);
  assert.doesNotMatch(shadow,/const DEVELOPER_EMAIL=/);
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

test('Firestore permits V2 writes only to the developer account',()=>{
  const rules=source('firestore.rules');
  assert.match(rules,/function isDeveloper\(\)/);
  assert.match(rules,/"developer@scswim\.local"/);
  assert.match(rules,/allow read: if isOwner\(\) \|\| isDeveloper\(\)/);
  assert.match(rules,/allow write: if isDeveloper\(\)/);
});
