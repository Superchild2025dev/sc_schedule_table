const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const sourcePath=path.join(root,'functions','public-availability-source.js');

test('public availability derives regular keys from the actual tab list',()=>{
  assert.equal(fs.existsSync(sourcePath),true,'public availability source selector is missing');
  const source=require(sourcePath);
  const keys=source.publicAvailabilityKeys({
    tabId:'reg_aug',tabName:'5월출석부',stuKey:'swim_students',instKey:'swim_inst',
  },[
    {id:'reg_aug',type:'regular',name:'8월 시간표'},
    {id:'summer',type:'bangteuk',name:'여름방특'},
  ]);

  assert.deepEqual(keys,{
    tabId:'reg_aug',
    tabName:'8월 시간표',
    stuKey:'swim_stu_reg_aug',
    instKey:'swim_inst_reg_aug',
  });
});

test('public availability falls back to a real regular tab when main points to vacation',()=>{
  assert.equal(fs.existsSync(sourcePath),true,'public availability source selector is missing');
  const source=require(sourcePath);
  const keys=source.publicAvailabilityKeys({tabId:'summer'},[
    {id:'reg_aug',type:'regular',name:'8월 시간표'},
    {id:'summer',type:'bangteuk',name:'여름방특'},
  ]);

  assert.equal(keys.tabId,'reg_aug');
  assert.equal(keys.stuKey,'swim_stu_reg_aug');
});

test('availability refresh watches tab-list changes and passes tabs to the selector',()=>{
  const source=fs.readFileSync(path.join(root,'functions','index.js'),'utf8');
  assert.match(source,/PUBLIC_AVAILABILITY_SOURCE_KEYS[\s\S]*?"swim_tab_list"/);
  assert.match(source,/publicAvailabilityKeys\(mainSetting, tabs\)/);
});
