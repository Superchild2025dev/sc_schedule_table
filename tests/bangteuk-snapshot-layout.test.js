const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function sourceBetween(source,startText,endText){
  const start=source.indexOf(startText);
  const end=source.indexOf(endText,start);
  assert.notEqual(start,-1);
  assert.notEqual(end,-1);
  return source.slice(start,end);
}

const tabsSource=fs.readFileSync(path.join(__dirname,'..','js','tabs.js'),'utf8');

function createHarness(tab){
  const scheduleTime={SAT_INTERNAL_TO_DISPLAY:{}};
  const context={window:{SCScheduleTime:scheduleTime},SCScheduleTime:scheduleTime};
  vm.createContext(context);
  vm.runInContext(
    `var _tabList=[${JSON.stringify(tab)}]; var _activeTab=${JSON.stringify(tab.id)};\n`+
      sourceBetween(tabsSource,'const _REG_BASE=','/* ──── 탭 목록 관리'),
    context,
    {filename:'bangteuk-snapshot-layout.js'},
  );
  return context;
}

test('a vacation snapshot uses the vacation timetable layout and source storage scope',()=>{
  const context=createHarness({
    id:'snap-summer',
    type:'snapshot',
    sourceTabId:'summer-2026',
    sourceTabType:'bangteuk',
  });

  const config=context.getTabConfig();
  assert.deepEqual(Array.from(config.days),['월수금','화목']);
  assert.deepEqual(Array.from(config.times,item=>item.t),['9시','10시','11시']);
  assert.equal(config.stuKey,'swim_bt_summer-2026_stu');
  assert.equal(context.isBangteuk(),true);
});

test('an older snapshot recovers its vacation source type from stored snapshot data',()=>{
  const tab={id:'snap-legacy',type:'snapshot'};
  const context=createHarness(tab);

  context.hydrateSnapshotSourceMetadata(context._tabList[0],{
    sourceTabId:'winter-2026',
    sourceTabType:'bangteuk',
    sourceTabName:'2026 겨울방특',
  });

  assert.equal(context.isBangteuk(),true);
  assert.deepEqual(Array.from(context.getTabConfig().days),['월수금','화목']);
});
