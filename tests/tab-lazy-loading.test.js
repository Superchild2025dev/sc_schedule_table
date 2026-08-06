const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','js','tabs.js'),'utf8');

function functionSource(name,nextName){
  const start=source.indexOf(`function ${name}`);
  assert.notEqual(start,-1,`${name} is missing`);
  const end=source.indexOf(`function ${nextName}`,start+1);
  assert.notEqual(end,-1,`${name} boundary is missing`);
  return source.slice(start,end);
}

test('live tab clicks request a prepared switch before changing the active tab',()=>{
  const clickStart=source.indexOf("document.getElementById('tab-bar').addEventListener('click'");
  const clickEnd=source.indexOf("document.addEventListener('click'",clickStart+1);
  const click=source.slice(clickStart,clickEnd);

  assert.match(click,/requestTabSwitch\(tab\)/);
  assert.doesNotMatch(click,/_activeTab\s*=\s*tab/);
  assert.match(click,/closeStuPopup\(\);closeInstPopup\(\)/);
});

test('live tab switch preserves the current table until selected data is ready',()=>{
  const request=functionSource('requestTabSwitch','switchTabView');
  const awaitIndex=request.indexOf('await ensureScheduleTabLoaded');
  const activateIndex=request.lastIndexOf('_activeTab=tabId');

  assert.match(request,/_showLiveTabLoading/);
  assert.doesNotMatch(request,/replaceChildren/);
  assert.ok(awaitIndex>=0,'selected tab readiness must be awaited');
  assert.ok(activateIndex>awaitIndex,'active tab may change only after readiness');
  assert.match(request,/switchSeq!==_liveTabSwitchSeq/);
  assert.match(request,/flushPendingScheduleReads\(\)/);
  assert.match(request,/catch\(error\)/);
  assert.match(request,/시간표를 불러오지 못했습니다/);
});

test('snapshot tabs keep their deferred snapshot loading path',()=>{
  const request=functionSource('requestTabSwitch','switchTabView');
  const render=functionSource('switchTabView','hasUserTableZoom');

  assert.match(request,/tab\.type==='snapshot'/);
  assert.match(request,/switchTabView\(\)/);
  assert.match(render,/loadDeferredJSON\(snapKey/);
});

test('live activation helpers route through requestTabSwitch',()=>{
  const create=functionSource('createTabFromModal','_closeTabActionMenu');
  const main=functionSource('setMainTab','deleteTab');
  const copy=functionSource('copyTab','renderTabBar');

  assert.match(create,/requestTabSwitch\(id\)/);
  assert.match(main,/requestTabSwitch\(tabId\)/);
  assert.match(copy,/requestTabSwitch\(newId\)/);
});
