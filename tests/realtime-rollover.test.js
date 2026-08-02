const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function sourceBetween(source,startText,endText){
  const start=source.indexOf(startText);
  const end=source.indexOf(endText,start);
  assert.notEqual(start,-1);
  assert.notEqual(end,-1);
  return source.slice(start,end);
}

function createHarness(){
  const source=fs.readFileSync(path.join(__dirname,'..','js','tabs.js'),'utf8');
  let intervalCount=0;
  let renderCount=0;
  let buildCount=0;
  let permissionCount=0;
  let rolloverOptions=null;
  const listeners={};
  const context={
    console,
    Promise,
    window:{
      SC_READ_ONLY_PREVIEW:false,
      SCAuth:{applyPagePermissions:()=>{permissionCount++;}},
      addEventListener:(name,fn)=>{listeners['window:'+name]=fn;},
    },
    document:{
      hidden:false,
      addEventListener:(name,fn)=>{listeners['document:'+name]=fn;},
    },
    setInterval:()=>{intervalCount++;return intervalCount;},
    clearInterval:()=>{},
    autoRolloverRegularScheduleIfNeeded:async options=>{
      rolloverOptions=options;
      return true;
    },
    renderTabBar:()=>{renderCount++;},
    buildTable:()=>{buildCount++;},
    toast:()=>{},
  };
  vm.createContext(context);
  vm.runInContext(
    sourceBetween(
      source,
      'let _realtimeRolloverTimer=null;',
      'async function createSnapshot',
    ),
    context,
    {filename:'realtime-rollover.js'},
  );
  return {
    context,
    listeners,
    counts:()=>({intervalCount,renderCount,buildCount,permissionCount}),
    options:()=>rolloverOptions,
  };
}

test('a realtime month change refreshes the open screen without changing the active tab',async()=>{
  const harness=createHarness();

  const changed=await harness.context._runRealtimeScheduleRolloverCheck();

  assert.equal(changed,true);
  assert.deepEqual({...harness.options()},{background:true,preserveActiveTab:true});
  assert.deepEqual(harness.counts(),{
    intervalCount:0,
    renderCount:1,
    buildCount:1,
    permissionCount:1,
  });
});

test('the realtime watcher binds one timer and rechecks when the screen becomes active',async()=>{
  const harness=createHarness();

  assert.equal(harness.context.startRealtimeScheduleRollover(),true);
  assert.equal(harness.context.startRealtimeScheduleRollover(),true);
  assert.equal(harness.counts().intervalCount,2);
  assert.equal(typeof harness.listeners['document:visibilitychange'],'function');
  assert.equal(typeof harness.listeners['window:online'],'function');

  harness.listeners['document:visibilitychange']();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(harness.counts().renderCount>=1);
});

test('the manual rollover menu is no longer exposed',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','js','tabs.js'),'utf8');
  assert.doesNotMatch(source, /_menuBtn\('rollover'/);
});
