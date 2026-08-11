const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const projectRoot=path.join(__dirname,'..');
const operational=require('../js/schedule-operational-gateway.js');
require('../js/schedule-v2-operational-model.js');
const model=global.SCV2OperationalModel;
const keySelection=require('../js/schedule-key-selection.js');

function loadFirebaseStore(authenticated){
  const calls=[];
  const legacyFallback={child(){return legacyFallback;},once(){return Promise.resolve({val:()=>({})});}};
  const kv={where(){return kv;},doc(){return {};}};
  const db={collection(){return {doc(){return {collection(){return kv;}};}};}};
  function firestore(){return db;}
  firestore.FieldPath={documentId(){return 'document-id';}};
  firestore.FieldValue={serverTimestamp(){return 'timestamp';}};
  const functions={httpsCallable(){return async()=>({data:{}});}};
  const context={console,Map,Set,Promise,Date,setTimeout,clearTimeout};
  context.window=context;
  context.globalThis=context;
  context.SC_DATA_BACKEND='firestore';
  context.SCAuth={};
  context.SC_SELECTED_BRANCH='gagyeong';
  context.SCV2OperationalModel=model;
  context.SCV2OperationalStore={create(options){calls.push({type:'store',options});return {marker:'v2-store'};}};
  context.SCOperationalSchedule={create(options){calls.push({type:'gateway',options});return {marker:'operational',options};}};
  context.firebase={
    firestore,
    database(){return {ref(){return legacyFallback;}};},
    auth(){return {currentUser:authenticated?{uid:'staff'}:null};},
    app(){return {functions(){return functions;}};},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot,'js','firebase-store.js'),'utf8'),context,{filename:'firebase-store.js'});
  return {context,calls,db,functions};
}

test('createBranchRef keeps V1 before auth and creates the operational root after auth and branch selection',()=>{
  const before=loadFirebaseStore(false);
  const legacy=before.context.SCFirebaseStore.createBranchRef({id:'gagyeong',fbPath:'schedule'});
  assert.equal(typeof legacy.transactionKeys,'function');
  assert.equal(before.calls.length,0);

  const after=loadFirebaseStore(true);
  const root=after.context.SCFirebaseStore.createBranchRef({id:'gagyeong',fbPath:'schedule'});
  assert.equal(root.marker,'operational');
  assert.equal(after.calls.filter(call=>call.type==='store').length,1);
  const gatewayCall=after.calls.find(call=>call.type==='gateway');
  assert.equal(gatewayCall.options.branchId,'gagyeong');
  assert.equal(gatewayCall.options.legacyRoot.branch.id,'gagyeong');
  assert.equal(gatewayCall.options.v2Store.marker,'v2-store');
  assert.equal(gatewayCall.options.functions,after.functions);
});

test('a mixed parent-request transaction never routes tracked schedule keys through V1 in V2 mode',async()=>{
  const calls=[];
  const legacyValues={swim_requests:'{"req":{"status":"pending"}}'};
  const legacyRoot={
    child(key){return {once(){return Promise.resolve({val:()=>legacyValues[key]??null});}};},
    transactionKeys(keys,updateFn){
      calls.push({authority:'v1',keys:[...keys]});
      const current={};
      keys.forEach(key=>{if(Object.prototype.hasOwnProperty.call(legacyValues,key)) current[key]=legacyValues[key];});
      const next=updateFn(current);
      Object.assign(legacyValues,next||{});
      return Promise.resolve({committed:next!==undefined,snapshot:{val:()=>next}});
    },
  };
  const trackedValues={swim_mark:'{}'};
  const operationalRoot={
    async ready(){return {mode:'v2-read'};},
    currentConfig(){return {mode:'v2-read'};},
    child(key){return {once(){return Promise.resolve({val:()=>trackedValues[key]??null});}};},
    transactionKeys(keys,updateFn,meta){
      calls.push({authority:'v2',keys:[...keys],meta});
      const current={};
      keys.forEach(key=>{if(Object.prototype.hasOwnProperty.call(trackedValues,key)) current[key]=trackedValues[key];});
      const next=updateFn(current);
      Object.assign(trackedValues,next||{});
      return Promise.resolve({committed:next!==undefined,snapshot:{val:()=>next},revision:3});
    },
  };
  const db={collection(){return {doc(){return {collection(){return {where(){return this;}};}};}};}};
  function firestore(){return db;}
  firestore.FieldPath={documentId(){return 'document-id';}};
  const context={console,Map,Set,Promise,Date,setTimeout,clearTimeout,Proxy,Reflect};
  context.window=context;
  context.globalThis=context;
  context.SC_DATA_BACKEND='rtdb';
  context.SCAuth={};
  context.SC_SELECTED_BRANCH='gagyeong';
  context.SCV2OperationalModel=model;
  context.SCV2OperationalStore={create(){return {};}};
  context.SCOperationalSchedule={create(){return operationalRoot;}};
  context.firebase={
    firestore,
    database(){return {ref(){return legacyRoot;}};},
    auth(){return {currentUser:{uid:'staff'}};},
    app(){return {functions(){return {};}};},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot,'js','firebase-store.js'),'utf8'),context,{filename:'firebase-store.js'});
  const root=context.SCFirebaseStore.createBranchRef({id:'gagyeong',fbPath:'schedule'});

  const result=await root.transactionKeys(['swim_requests','swim_mark'],current=>({
    ...current,
    swim_requests:'{"req":{"status":"accepted"}}',
    swim_mark:'{"slot":{"type":"absent"}}',
  }),{operationId:'95ecfe8a-7f08-42ef-9e99-f902d0ff6f5a',operationType:'absence-cancel'});

  assert.equal(result.committed,true);
  assert.deepEqual(calls.map(call=>({authority:call.authority,keys:call.keys})),[
    {authority:'v2',keys:['swim_mark']},
    {authority:'v1',keys:['swim_requests']},
  ]);
  assert.equal(calls[0].meta.operationId,'95ecfe8a-7f08-42ef-9e99-f902d0ff6f5a');
});

test('V2 selected startup returns legacy values without a full V1 root read',async()=>{
  let legacyFullReads=0;
  const selections=[];
  const v2Store={
    async readConfig(){return {branchId:'gagyeong',mode:'v2-read',generationId:'gen_4',epoch:7,revision:12,valid:true};},
    subscribeConfig(){return ()=>{};},
    async loadSelection(selection){
      selections.push(selection);
      const root={};
      for(const key of selection.keys||[]){
        if(key==='swim_tab_list') root[key]='[{"id":"regular","type":"regular"}]';
        else if(key==='swim_students') root[key]='[{"n":"홍길동"}]';
        else if(key==='swim_inst') root[key]='{"1시/월/1":{"n":"김선생"}}';
        else root[key]='{}';
      }
      return {root,loadedKeys:[...(selection.keys||[])],config:selection.config};
    },
    invalidate(){},
  };
  const legacyRoot={
    once(){legacyFullReads+=1;return Promise.resolve({val:()=>({swim_students:'V1'})});},
    transactionKeys(){throw new Error('V1 write must not run');},
  };
  const root=operational.create({
    branchId:'gagyeong',legacyRoot,v2Store,model,defaultTabIds:['regular'],
  });
  const batches=[];
  const controller=root.subscribeSelectedBatches({
    baseKeys:['swim_tab_list'],
    selectionForKeys:keySelection.selectionForKeys,
    resolveInitialActiveKeys:()=>['swim_students','swim_inst'],
    next:batch=>batches.push(batch),
  });

  await controller.ready;
  assert.equal(legacyFullReads,0);
  assert.equal(batches.length,1);
  assert.equal(typeof batches[0].values.swim_students,'string');
  assert.deepEqual(JSON.parse(batches[0].values.swim_students),[{n:'홍길동'}]);
  assert.ok(selections.every(selection=>!selection.domains.includes('attendance')));
  assert.ok(selections.every(selection=>!selection.domains.includes('history')));
  controller.stop();
});

test('startup key translation keeps attendance and history out of the initial V2 selection',()=>{
  const initial=keySelection.selectionForKeys(keySelection.initialBaseKeys(),{tabIds:['regular']});
  assert.deepEqual(initial.tabIds,['regular']);
  assert.deepEqual(initial.domains.sort(),['administration','calendar','roster','workflow']);
  assert.equal(initial.keys.includes('swim_attendance'),false);
  assert.equal(initial.keys.includes('swim_retire_history'),false);

  const attendance=keySelection.selectionForKeys(['swim_attendance'],{tabIds:['regular']});
  const history=keySelection.selectionForKeys(['swim_retire_history'],{tabIds:['regular']});
  assert.deepEqual(attendance.domains,['attendance']);
  assert.deepEqual(history.domains,['history']);
});
