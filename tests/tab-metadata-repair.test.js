const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const tabsSource=fs.readFileSync(path.join(__dirname,'..','js','tabs.js'),'utf8');
const initSource=fs.readFileSync(path.join(__dirname,'..','js','init.js'),'utf8');

function functionSource(source,name){
  const start=source.indexOf(`function ${name}`);
  assert.notEqual(start,-1,`${name} is missing`);
  const open=source.indexOf('{',start);
  let depth=0;
  for(let i=open;i<source.length;i++){
    if(source[i]==='{') depth++;
    else if(source[i]==='}'&&--depth===0) return source.slice(start,i+1);
  }
  throw new Error(`${name} body is incomplete`);
}

function createHarness(){
  const context={
    SCHEDULE_PERIODS:[{month:8,start:'2026-08-03',end:'2026-08-29'}],
    getToday:()=>new Date(2026,7,26),
    toDateStr:()=> '2026-08-26',
  };
  vm.createContext(context);
  [
    '_pad2',
    '_monthKeyFromPeriod',
    '_normalizeMonthKey',
    '_periodMonthForDate',
    '_defaultPeriodMonth',
    '_monthTabName',
    '_regularScheduleTabName',
    '_regularTabNameMonth',
    '_isMismatchedRegularMonthMetadata',
    '_normalizeTabList',
    '_tabStorageKeys',
    '_normalizeTabPointer',
  ].forEach(name=>vm.runInContext(functionSource(tabsSource,name),context,{filename:`${name}.js`}));
  return context;
}

test('missing tab metadata follows the current operating month instead of May 2026',()=>{
  const ctx=createHarness();
  const tabs=ctx._normalizeTabList([]);

  assert.equal(tabs.length,1);
  assert.equal(tabs[0].name,'8월 시간표');
  assert.equal(tabs[0].periodMonth,'2026-08');
  assert.equal(tabs[0].periodLocked,true);
});

test('normalization preserves a valid operating tab name without mutating the source',()=>{
  const ctx=createHarness();
  const source=[{id:'reg_aug',name:'8월 일정표',type:'regular',periodMonth:'2026-08',periodLocked:true}];
  const tabs=ctx._normalizeTabList(source);

  assert.equal(tabs[0].name,'8월 일정표');
  assert.equal(tabs[0].periodMonth,'2026-08');
  assert.notEqual(tabs[0],source[0]);
});

test('a legacy regular tab without an explicit type is preserved',()=>{
  const ctx=createHarness();
  const tabs=ctx._normalizeTabList([{id:'june',name:'6월 시간표',periodMonth:'2026-06'}]);

  assert.equal(tabs.length,1);
  assert.equal(tabs[0].id,'june');
  assert.equal(tabs[0].name,'6월 시간표');
  assert.equal(tabs[0].type,'regular');
});

test('a student-shaped object can never become the operating tab title',()=>{
  const ctx=createHarness();
  const tabs=ctx._normalizeTabList([{
    id:'student_1',name:'홍길동',n:'홍길동',p:'01012345678',d:'월',t:'2시',l:1,r:1,
  }]);

  assert.equal(tabs.length,1);
  assert.equal(tabs[0].id,'regular');
  assert.equal(tabs[0].name,'8월 시간표');
});

test('main and parent tab pointers take their display name from the actual tab list',()=>{
  const ctx=createHarness();
  const tabs=[{id:'reg_aug',name:'8월 일정표',type:'regular',periodMonth:'2026-08'}];
  const pointer=ctx._normalizeTabPointer({tabId:'reg_aug',tabName:'5월출석부'},tabs);

  assert.equal(pointer.tabName,'8월 일정표');
  assert.equal(pointer.tabType,'regular');
  assert.equal(pointer.stuKey,'swim_stu_reg_aug');
  assert.equal(pointer.instKey,'swim_inst_reg_aug');
});

test('a pointer to a missing tab falls back to an existing regular tab',()=>{
  const ctx=createHarness();
  const tabs=[
    {id:'reg_aug',name:'8월 시간표',type:'regular',periodMonth:'2026-08'},
    {id:'bt_summer',name:'여름방특',type:'bangteuk'},
  ];
  const pointer=ctx._normalizeTabPointer({tabId:'deleted',tabName:'5월출석부'},tabs);

  assert.equal(pointer.tabId,'reg_aug');
  assert.equal(pointer.tabName,'8월 시간표');
  assert.equal(pointer.tabType,'regular');
  assert.equal(pointer.stuKey,'swim_stu_reg_aug');
  assert.equal(pointer.instKey,'swim_inst_reg_aug');
});

test('an August-named live tab with a stale May month is repaired without a fake May snapshot',()=>{
  const ctx=createHarness();
  const tab={id:'reg_aug',name:'8월 시간표',type:'regular',periodMonth:'2026-05',periodLocked:true};

  assert.equal(ctx._isMismatchedRegularMonthMetadata(tab,'2026-08'),true);
  const rollover=functionSource(tabsSource,'autoRolloverRegularScheduleIfNeeded');
  assert.match(rollover,/!metadataMonthMismatch/);
});

test('the schedule page title is reset to the fixed service title on startup',()=>{
  const start=functionSource(initSource,'startScheduleApp');
  assert.match(start,/document\.title='슈퍼차일드 수영장 시간표'/);
});

test('every tab-list write also persists canonical main and parent pointers',()=>{
  const ctx=createHarness();
  vm.runInContext(functionSource(tabsSource,'_tabSettingsWriteKeys'),ctx,{filename:'_tabSettingsWriteKeys.js'});
  const keys=ctx._tabSettingsWriteKeys(['swim_tab_list']);

  assert.deepEqual(Array.from(keys),['swim_tab_list','swim_main_tab','swim_parent_tab']);
});

test('renaming a tab refreshes both duplicated pointers from the tab list',()=>{
  const ctx=createHarness();
  vm.runInContext(functionSource(tabsSource,'_syncTabPointers'),ctx,{filename:'_syncTabPointers.js'});
  const state={
    tabs:[{id:'reg_aug',name:'8월 시간표',type:'regular',periodMonth:'2026-08'}],
    main:{tabId:'reg_aug',tabName:'5월출석부',stuKey:'swim_students',instKey:'swim_inst'},
    parent:{tabId:'reg_aug',tabName:'5월출석부',stuKey:'swim_students',instKey:'swim_inst'},
  };

  ctx._syncTabPointers(state);

  for(const pointer of [state.main,state.parent]){
    assert.equal(pointer.tabName,'8월 시간표');
    assert.equal(pointer.stuKey,'swim_stu_reg_aug');
    assert.equal(pointer.instKey,'swim_inst_reg_aug');
  }
});
