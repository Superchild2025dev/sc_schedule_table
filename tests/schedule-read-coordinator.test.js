const test = require('node:test');
const assert = require('node:assert/strict');

const readCoordinator = require('../js/schedule-read-coordinator.js');

function createHarness(overrides){
  const cache={swim_students:'[{"n":"기존"}]'};
  const renders=[];
  const invalid=[];
  const errors=[];
  let blocked=false;
  let subscriber=null;
  let subscribeCount=0;
  let unsubscribeCount=0;
  const coordinator=readCoordinator.create(Object.assign({
    getRaw:key=>Object.prototype.hasOwnProperty.call(cache,key)?cache[key]:null,
    setRaw:(key,value)=>{ cache[key]=value; },
    removeRaw:key=>{ delete cache[key]; },
    validate:(key,value)=>{
      if(key!=='swim_students') return true;
      try{ return Array.isArray(JSON.parse(value)); }catch(e){ return false; }
    },
    isRenderBlocked:()=>blocked,
    onRender:(keys,meta)=>renders.push({keys:[...keys],meta}),
    onInvalid:(keys,meta)=>invalid.push({keys:[...keys],meta}),
    onError:(error,meta)=>errors.push({error,meta}),
  },overrides||{}));

  function subscribe(handlers){
    subscribeCount+=1;
    subscriber=handlers;
    return ()=>{ unsubscribeCount+=1; };
  }

  return {
    cache,
    renders,
    invalid,
    errors,
    coordinator,
    subscribe,
    emit:batch=>subscriber.next(batch),
    fail:error=>subscriber.error(error),
    setBlocked:value=>{ blocked=!!value; },
    subscribeCount:()=>subscribeCount,
    unsubscribeCount:()=>unsubscribeCount,
  };
}

test('initial batch resolves readiness without rendering a remote update', async () => {
  const h=createHarness();
  h.coordinator.start(h.subscribe);

  h.emit({initial:true,revision:1,values:{swim_inst:'{"1":"선생님"}'},removedKeys:[]});
  await h.coordinator.ready();

  assert.equal(h.cache.swim_inst,'{"1":"선생님"}');
  assert.equal(h.renders.length,0);
  assert.equal(h.subscribeCount(),1);
});

test('one batch commits every value and removal before rendering once', async () => {
  const h=createHarness();
  h.cache.old_key='old';
  h.coordinator.start(h.subscribe);
  h.emit({initial:true,revision:1,values:{},removedKeys:[]});
  await h.coordinator.ready();

  h.emit({
    initial:false,
    revision:2,
    values:{swim_inst:'{"1":"김선생"}',swim_mark:'{"a":1}'},
    removedKeys:['old_key'],
  });

  assert.equal(h.renders.length,1);
  assert.deepEqual(h.renders[0].keys.sort(),['old_key','swim_inst','swim_mark']);
  assert.equal(h.cache.old_key,undefined);
  assert.equal(h.cache.swim_inst,'{"1":"김선생"}');
  assert.equal(h.cache.swim_mark,'{"a":1}');
});

test('duplicate raw values do not trigger rendering', async () => {
  const h=createHarness();
  h.coordinator.start(h.subscribe);
  h.emit({initial:true,revision:1,values:{swim_mark:'{"a":1}'},removedKeys:[]});
  await h.coordinator.ready();

  h.emit({initial:false,revision:2,values:{swim_mark:'{"a":1}'},removedKeys:[]});

  assert.equal(h.renders.length,0);
});

test('a stale revision is ignored', async () => {
  const h=createHarness();
  h.coordinator.start(h.subscribe);
  h.emit({initial:true,revision:5,values:{swim_mark:'{"a":5}'},removedKeys:[]});
  await h.coordinator.ready();

  h.emit({initial:false,revision:4,values:{swim_mark:'{"a":4}'},removedKeys:[]});

  assert.equal(h.cache.swim_mark,'{"a":5}');
  assert.equal(h.renders.length,0);
});

test('a response outside the current branch tab and epoch preserves the visible cache', async () => {
  const current={branchId:'gagyeong',tabId:'regular',epoch:4};
  const h=createHarness({
    isCurrent:batch=>{
      const context=batch&&batch.context||{};
      return context.branchId===current.branchId
        &&context.tabId===current.tabId
        &&context.epoch===current.epoch;
    },
  });
  h.coordinator.start(h.subscribe);
  h.emit({
    initial:true,
    revision:1,
    context:{branchId:'gagyeong',tabId:'regular',epoch:4},
    values:{swim_students:'[{"n":"현재"}]'},
    removedKeys:[],
  });
  await h.coordinator.ready();

  current.tabId='summer';
  h.emit({
    initial:false,
    revision:2,
    context:{branchId:'gagyeong',tabId:'regular',epoch:4},
    values:{swim_students:'[{"n":"이전 탭"}]'},
    removedKeys:[],
  });

  assert.equal(h.cache.swim_students,'[{"n":"현재"}]');
  assert.equal(h.renders.length,0);
  assert.match(h.coordinator.diagnostics(1)[0].type,/stale-context/);
});

test('invalid student data preserves the previous value while valid siblings apply', async () => {
  const h=createHarness();
  h.coordinator.start(h.subscribe);
  h.emit({initial:true,revision:1,values:{},removedKeys:[]});
  await h.coordinator.ready();

  h.emit({
    initial:false,
    revision:2,
    values:{swim_students:'{"broken":true}',swim_inst:'{"1":"정상"}'},
    removedKeys:[],
  });

  assert.equal(h.cache.swim_students,'[{"n":"기존"}]');
  assert.equal(h.cache.swim_inst,'{"1":"정상"}');
  assert.deepEqual(h.renders[0].keys,['swim_inst']);
  assert.deepEqual(h.invalid[0].keys,['swim_students']);
});

test('blocked batches accumulate keys and flush them once', async () => {
  const h=createHarness();
  h.coordinator.start(h.subscribe);
  h.emit({initial:true,revision:1,values:{},removedKeys:[]});
  await h.coordinator.ready();
  h.setBlocked(true);

  h.emit({initial:false,revision:2,values:{swim_mark:'{"a":1}'},removedKeys:[]});
  h.emit({initial:false,revision:3,values:{swim_inst:'{"1":"선생님"}'},removedKeys:[]});
  assert.equal(h.renders.length,0);

  h.setBlocked(false);
  assert.equal(h.coordinator.flush(),true);
  assert.equal(h.renders.length,1);
  assert.deepEqual(h.renders[0].keys.sort(),['swim_inst','swim_mark']);
  assert.equal(h.coordinator.flush(),false);
});

test('start is idempotent and stop unsubscribes once', async () => {
  const h=createHarness();
  h.coordinator.start(h.subscribe);
  h.coordinator.start(h.subscribe);
  assert.equal(h.subscribeCount(),1);

  h.emit({initial:true,revision:1,values:{},removedKeys:[]});
  await h.coordinator.ready();
  h.coordinator.stop();
  h.coordinator.stop();

  assert.equal(h.unsubscribeCount(),1);
});

test('stop prevents queued subscribers from applying later batches', () => {
  const h=createHarness();
  h.coordinator.start(h.subscribe);
  h.coordinator.stop();

  h.emit({initial:false,revision:1,values:{swim_inst:'{"1":"늦은값"}'},removedKeys:[]});

  assert.equal(h.cache.swim_inst,undefined);
  assert.equal(h.renders.length,0);
});
