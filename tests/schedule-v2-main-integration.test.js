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
  const kv={where(){return kv;},doc(){return {get:async()=>({exists:true,data:()=>({value:'{}',chunked:false})})};}};
  const db={collection(){return {doc(){return {collection(){return kv;}};}};}};
  function firestore(){return db;}
  firestore.FieldPath={documentId(){return 'document-id';}};
  firestore.FieldValue={serverTimestamp(){return 'timestamp';}};
  const functions={httpsCallable(name){return async data=>{
    calls.push({type:'callable',name,data:JSON.parse(JSON.stringify(data||{}))});
    return {data:{state:'idle',code:''}};
  };}};
  const reloads=[];
  const sessionValues=new Map();
  const context={console,Map,Set,Promise,Date,setTimeout,clearTimeout};
  context.window=context;
  context.globalThis=context;
  context.SC_DATA_BACKEND='firestore';
  context.SCAuth={};
  context.SC_SELECTED_BRANCH='gagyeong';
  context.SCV2OperationalModel=model;
  context.SCV2OperationalStore={create(options){calls.push({type:'store',options});return {marker:'v2-store'};}};
  context.SCOperationalSchedule={create(options){
    calls.push({type:'gateway',options});
    return {
      marker:'operational',options,
      subscribeSelectedBatches(){
        return {ready:Promise.resolve({stale:false}),stop(){},setActiveKeys(){return Promise.resolve({stale:false});}};
      },
    };
  }};
  context.sessionStorage={
    getItem:key=>sessionValues.has(key)?sessionValues.get(key):null,
    setItem:(key,value)=>sessionValues.set(key,String(value)),
  };
  context.location={reload(){reloads.push('reload');}};
  context.firebase={
    firestore,
    database(){return {ref(){return legacyFallback;}};},
    auth(){return {currentUser:authenticated?{uid:'staff'}:null};},
    app(){return {functions(){return functions;}};},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot,'js','firebase-store.js'),'utf8'),context,{filename:'firebase-store.js'});
  return {context,calls,db,functions,reloads};
}

function memoryStorage(values=new Map()){
  return {
    getItem:key=>values.has(String(key))?values.get(String(key)):null,
    setItem:(key,value)=>values.set(String(key),String(value)),
    removeItem:key=>values.delete(String(key)),
    key:index=>[...values.keys()][index]??null,
    get length(){return values.size;},
    values,
  };
}

function sourceFunction(relativePath,name){
  const source=fs.readFileSync(path.join(projectRoot,relativePath),'utf8');
  const asyncStart=source.indexOf(`async function ${name}(`);
  const start=asyncStart>=0?asyncStart:source.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`${name} source`);
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

test('createBranchRef wires a one-shot controlled reload for each runtime authority fingerprint',()=>{
  const env=loadFirebaseStore(true);
  env.context.SCFirebaseStore.createBranchRef({id:'gagyeong',fbPath:'schedule'});
  const onReloadRequired=env.calls.find(call=>call.type==='gateway').options.onReloadRequired;
  assert.equal(typeof onReloadRequired,'function');
  const revision={branchId:'gagyeong',mode:'v2-read',generationId:'gen_4',epoch:7,revision:13};

  onReloadRequired(revision);
  onReloadRequired(revision);
  onReloadRequired({...revision,revision:14});

  assert.equal(env.reloads.length,2);
});

test('authenticated teacher and desk selected startup drain server recovery without calling ready',async()=>{
  for(const [page,file] of [['teacher','js/teacher.js'],['desk','js/desk.js']]){
    const env=loadFirebaseStore(true);
    const root=env.context.SCFirebaseStore.createBranchRef({id:'gagyeong',fbPath:'schedule'});
    Object.assign(env.context,{
      _fb:root,_fbReady:true,_teacherAttendanceRootValues:{},REQUESTS:{},
      parseStoredJSON:(key,value,fallback)=>value&&typeof value==='string'?JSON.parse(value):fallback,
      teacherAttendanceStorageKeys:()=>({attendance:'swim_attendance',attGuests:'swim_att_guests'}),
    });
    env.context.SCFirebaseStore.subscribeSelectedRootBatches=(selectedRoot,options)=>
      selectedRoot.subscribeSelectedBatches(options);
    vm.runInContext(`${sourceFunction(file,'loadAllData')};this.startStaffData=loadAllData;`,env.context);
    await env.context.startStaffData();
    await new Promise(resolve=>setImmediate(resolve));

    const request=env.calls.find(call=>call.type==='callable'&&call.name==='manageScheduleV2RequestRecovery');
    assert.deepEqual(request.data,{
      version:1,action:'drain',branchId:'gagyeong',operationId:'',
    },page);
  }
});

test('a mixed request transaction stages only non-PII intent before V2 and drains without a browser V1 write',async()=>{
  const calls=[];
  const storage=memoryStorage();
  const legacyValues={swim_requests:'{"req":{"status":"pending","parent":{"name":"민감한이름","phone":"010-secret"}}}'};
  let staged=null;
  const legacyRoot={
    child(key){return {once(){return Promise.resolve({val:()=>legacyValues[key]??null});}};},
    transactionKeys(keys,updateFn){
      calls.push({authority:'v1',keys:[...keys]});
      throw new Error('browser must not write the request recovery phase');
    },
  };
  const trackedValues={swim_mark:'{"slot":{"type":"absent"}}'};
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
      return Promise.resolve({committed:next!==undefined,snapshot:{val:()=>next},revision:3,operationId:meta.operationId});
    },
    subscribeSelectedBatches(){return {ready:Promise.resolve({stale:false}),stop(){}};},
  };
  const db={collection(){return {doc(){return {collection(){return {where(){return this;}};}};}};}};
  function firestore(){return db;}
  firestore.FieldPath={documentId(){return 'document-id';}};
  const context={console,Map,Set,Promise,Date,setTimeout,clearTimeout,Proxy,Reflect,localStorage:storage};
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
    app(){return {functions(){return {httpsCallable(name){return async data=>{
      assert.equal(name,'manageScheduleV2RequestRecovery');
      calls.push({authority:'server-recovery',action:data.action,data:JSON.parse(JSON.stringify(data))});
      if(data.action==='stage') staged=JSON.parse(JSON.stringify(data));
      if(data.action==='drain'){
        const requests=JSON.parse(legacyValues.swim_requests);
        requests.req.status='accepted';
        legacyValues.swim_requests=JSON.stringify(requests);
        return {data:{operationId:data.operationId,state:'completed',attempts:1,code:''}};
      }
      return {data:{operationId:data.operationId,state:'staged',attempts:0,code:''}};
    };}};}};},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot,'js','firebase-store.js'),'utf8'),context,{filename:'firebase-store.js'});
  const root=context.SCFirebaseStore.createBranchRef({id:'gagyeong',fbPath:'schedule'});

  const result=await root.transactionKeys(['swim_requests','swim_mark'],current=>({
    ...current,
    swim_requests:'{"req":{"status":"accepted","processedAt":"2026-08-11T03:00:00.000Z","parent":{"name":"민감한이름","phone":"010-secret"}}}',
    swim_mark:'{}',
  }),{operationId:'95ecfe8a-7f08-42ef-9e99-f902d0ff6f5a',operationType:'absence-cancel'});

  assert.equal(result.committed,true);
  assert.deepEqual(calls.map(call=>call.action||call.authority),[
    'stage','v2','drain',
  ]);
  assert.equal(staged.operationId,'95ecfe8a-7f08-42ef-9e99-f902d0ff6f5a');
  assert.deepEqual(staged.intents,[{
    requestId:'req',expectedStatus:'pending',expectedVersion:null,
    patch:{status:'accepted',processedAt:'2026-08-11T03:00:00.000Z'},
  }]);
  assert.equal(JSON.stringify(staged).includes('민감한이름'),false);
  assert.equal(JSON.stringify(staged).includes('010-secret'),false);
  assert.equal([...storage.values.values()].some(value=>/민감한이름|010-secret|swim_requests/.test(value)),false);
  assert.equal(JSON.parse(result.snapshot.val().swim_requests).req.status,'accepted');
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

test('failed authoritative refresh preserves the last good memory and local cache',async()=>{
  const storage=memoryStorage(new Map([['cache:swim_students','last-good']]));
  const context={
    Promise,_fbReady:true,_dbCache:{swim_students:'last-good'},localStorage:storage,
    _fb:{child(){return {once(){return Promise.reject(new Error('refresh failed'));}};}},
    _lsKey:key=>`cache:${key}`,_cacheScheduleRaw(){throw new Error('must not replace cache');},
    _queueRemoteScheduleRefresh(){throw new Error('must not render after failed refresh');},
  };
  vm.createContext(context);
  vm.runInContext(`${sourceFunction('js/core.js','_refreshFailedScheduleWrites')};this.refresh=_refreshFailedScheduleWrites;`,context);

  await context.refresh(['swim_students'],{originalKey:'swim_students'});

  assert.equal(context._dbCache.swim_students,'last-good');
  assert.equal(storage.getItem('cache:swim_students'),'last-good');
});

test('successful authoritative absence removes the cached value and queues a visible refresh',async()=>{
  const storage=memoryStorage(new Map([['cache:swim_students','last-good']]));
  let refreshes=0;
  const context={
    Promise,_fbReady:true,_dbCache:{swim_students:'last-good'},localStorage:storage,
    _fb:{child(){return {once(){return Promise.resolve({val:()=>null});}};}},
    _lsKey:key=>`cache:${key}`,_cacheScheduleRaw(){throw new Error('absence must not cache');},
    _queueRemoteScheduleRefresh(){refreshes+=1;},
  };
  vm.createContext(context);
  vm.runInContext(`${sourceFunction('js/core.js','_refreshFailedScheduleWrites')};this.refresh=_refreshFailedScheduleWrites;`,context);

  await context.refresh(['swim_students'],{originalKey:'swim_students'});

  assert.equal(Object.prototype.hasOwnProperty.call(context._dbCache,'swim_students'),false);
  assert.equal(storage.getItem('cache:swim_students'),null);
  assert.equal(refreshes,1);
});
