const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
function read(relativePath){return fs.readFileSync(path.join(root,relativePath),'utf8');}
function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function sourceFunction(relativePath,name){
  const source=read(relativePath);
  const start=source.indexOf(`async function ${name}(`);
  const open=source.indexOf('{',start);
  let depth=0;
  for(let index=open;index<source.length;index+=1){
    if(source[index]==='{') depth+=1;
    else if(source[index]==='}'){
      depth-=1;
      if(depth===0) return source.slice(start,index+1);
    }
  }
  throw new Error(`unterminated ${name}`);
}
function tick(){return new Promise(resolve=>setImmediate(resolve));}

async function settingsFeedbackRace(staleFeedback){
  const oldFeedback=deferred();
  const feedbackCalls={gagyeong:0,yongam:0};
  let renders=0;
  const context={
    Promise,console:{error(){},warn(){}},SETTINGS_KEY:'settings',TEACHERS_KEY:'teachers',FEEDBACK_KEY:'feedback',
    settingsLoadSeqByBranch:{},settingsByBranch:{},teacherNamesByBranch:{},feedbackByBranch:{},settingsLoadFailedByBranch:{},
    DEFAULT_TEACHERS:{gagyeong:[],yongam:[]},activeBranch:'gagyeong',
    defaultSettings:branchId=>({branchId}),mergeSettings:(base,value)=>({...base,...value}),
    parseStored:value=>typeof value==='string'?JSON.parse(value):value,
    normalizeTeacherNames:value=>value,normalizeFeedbackList:value=>value,
    clone:value=>JSON.parse(JSON.stringify(value)),toast(){},renderAll(){renders+=1;},
    branchRoot(branchId){
      return {child(key){return {once(){
        if(key==='settings') return Promise.resolve({val:()=>JSON.stringify({loaded:branchId})});
        if(key==='teachers') return Promise.resolve({val:()=>JSON.stringify([branchId])});
        feedbackCalls[branchId]+=1;
        if(branchId==='gagyeong'&&feedbackCalls[branchId]===1) return oldFeedback.promise;
        return Promise.resolve({val:()=>JSON.stringify([{id:`${branchId}-latest`}])});
      }};}};
    },
  };
  vm.createContext(context);
  vm.runInContext(`${sourceFunction('js/settings.js','loadBranchBundle')};this.loadBranchBundle=loadBranchBundle;`,context);

  const first=context.loadBranchBundle('gagyeong');
  await tick();
  await context.loadBranchBundle('yongam');
  await context.loadBranchBundle('gagyeong');
  const rendersBeforeStale=renders;
  if(staleFeedback instanceof Error) oldFeedback.reject(staleFeedback);
  else oldFeedback.resolve({val:()=>JSON.stringify(staleFeedback)});
  await first;
  return {context,renders,rendersBeforeStale};
}

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

test('browser recovery code persists no request queue or request payload',()=>{
  const source=read('js/firebase-store.js');
  assert.doesNotMatch(source,/sc_legacy_request_recovery|pendingLegacyRecoveries|retryPendingLegacyRecoveries/);
  assert.doesNotMatch(source,/localStorage\.(?:setItem|removeItem)\([^\n]*recovery/i);
  assert.match(source,/manageScheduleV2RequestRecovery/);
});

test('parent referral and voice runtimes remain outside the operational schedule bootstrap',()=>{
  const parent=read('parent.html');
  assert.doesNotMatch(parent,/schedule-v2-operational-store|schedule-operational-gateway/);
  assert.doesNotMatch(read('js/parent.js'),/SCOperationalSchedule|scheduleV2/);
  assert.doesNotMatch(read('js/referral.js'),/SCOperationalSchedule/);
});

test('rapid branch A to B to A ignores the first A feedback response after its await',async()=>{
  const result=await settingsFeedbackRace([{id:'gagyeong-stale'}]);
  assert.deepEqual(result.context.feedbackByBranch.gagyeong,[{id:'gagyeong-latest'}]);
  assert.equal(result.renders,result.rendersBeforeStale);
});

test('rapid branch A to B to A ignores the first A feedback failure before fallback or render',async()=>{
  const result=await settingsFeedbackRace(new Error('stale feedback failure'));
  assert.deepEqual(result.context.feedbackByBranch.gagyeong,[{id:'gagyeong-latest'}]);
  assert.equal(result.renders,result.rendersBeforeStale);
});
