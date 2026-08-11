const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

require(path.join(__dirname,'..','js','schedule-v2-operational-model.js'));
const model=globalThis.SCV2OperationalModel;
const gatewayApi=require(path.join(__dirname,'..','js','schedule-operational-gateway.js'));

function plain(value){ return JSON.parse(JSON.stringify(value)); }
function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{ resolve=yes;reject=no; });
  return {promise,resolve,reject};
}
function snapshot(key,value){ return {key:key||null,val:()=>plain(value)}; }

function createEnvironment(mode,overrides={}){
  const calls={legacyReads:0,legacyWrites:0,v2Reads:0,parity:0,mutations:0,invalidations:0,reloads:0,order:[]};
  let legacyData={swim_students:JSON.stringify([{id:'student-1',name:'기존 이름',phone:'010-secret'}])};
  let config={
    branchId:'yongam',mode,generationId:['v2-read','v2','shadow','verify'].includes(mode)?'gen_1':'',
    epoch:4,revision:31,valid:true,
  };
  let configListener=null;
  const mutationRequests=[];
  const loadedRoots={
    regular:{
      swim_tab_list:JSON.stringify([{id:'regular',type:'regular'}]),
      swim_students:legacyData.swim_students,
    },
    camp:{swim_bt_camp_stu:JSON.stringify([{id:'camp-1',name:'방특 원생'}])},
  };

  const legacyRoot={
    async once(event){
      assert.equal(event,'value');
      calls.legacyReads+=1;calls.order.push('v1-read');
      if(overrides.legacyReadError) throw new Error('legacy read secret');
      return snapshot(null,legacyData);
    },
    child(key){
      return {
        async once(event){ assert.equal(event,'value');calls.legacyReads+=1;calls.order.push('v1-read');return snapshot(key,legacyData[key]??null); },
      };
    },
    async transactionKeys(keys,mutator){
      calls.legacyWrites+=1;calls.order.push('v1-write');
      const before={};
      keys.forEach(key=>{ if(Object.prototype.hasOwnProperty.call(legacyData,key)) before[key]=legacyData[key]; });
      const draft=plain(before);
      const returned=await mutator(draft);
      if(returned===undefined) return {committed:false,snapshot:snapshot(null,null)};
      const after=returned||draft;
      keys.forEach(key=>{
        if(after[key]===undefined||after[key]===null) delete legacyData[key];
        else legacyData[key]=plain(after[key]);
      });
      return {committed:true,snapshot:snapshot(null,after)};
    },
    subscribeSelectedBatches(options){
      calls.order.push('v1-subscribe');
      const values={};
      (options.baseKeys||[]).forEach(key=>{ if(legacyData[key]!==undefined) values[key]=legacyData[key]; });
      options.next({initial:true,revision:1,values,removedKeys:[],changedKeys:Object.keys(values)});
      return {ready:Promise.resolve({stale:false}),setActiveKeys:async()=>({stale:false}),setAuxiliaryKeys:async()=>({stale:false}),releaseAuxiliaryKeys(){},waitForActive:async()=>({stale:false}),stop(){}};
    },
  };
  const v2Store={
    async readConfig(){
      if(overrides.configError) throw new Error('config unavailable secret');
      return plain(config);
    },
    subscribeConfig(next){ configListener=next;next(plain(config));return ()=>{configListener=null;}; },
    invalidate(){ calls.invalidations+=1; },
    async loadSelection(selection){
      calls.v2Reads+=1;calls.order.push('v2-read');
      if(overrides.v2ReadError) throw new Error('v2 read secret-name 010-secret');
      if(overrides.v2ReadPromise) return overrides.v2ReadPromise;
      const tabId=selection.tabIds?.[0]||'regular';
      return {
        root:plain(loadedRoots[tabId]||{}),collections:{},config:plain(config),
        context:{branchId:config.branchId,generationId:config.generationId,epoch:config.epoch,revision:config.revision},
        selection:plain(selection),
      };
    },
    async verifyParity(input){
      calls.parity+=1;calls.order.push('v2-parity');
      if(overrides.parityPromise) await overrides.parityPromise;
      if(overrides.parityError) throw new Error('parity mismatch');
      return {matches:true,keyCount:Object.keys(input.values||{}).length};
    },
  };
  let mutationAttempt=0;
  async function mutate(request){
    mutationAttempt+=1;
    calls.mutations+=1;calls.order.push('v2-write');
    mutationRequests.push(plain(request));
    if(overrides.mutationPromise) return overrides.mutationPromise;
    if(overrides.transientMutationError&&mutationAttempt===1){
      throw Object.assign(new Error('temporary secret'),{code:'unavailable'});
    }
    if(overrides.mutationError) throw overrides.mutationError;
    return {
      operationId:request.operationId,committed:true,
      revision:overrides.responseRevision??request.beforeRevision+1,
      changeCount:1,setCount:1,deleteCount:0,
      recoveryState:mode==='v2-read'?'applied':'not-required',
    };
  }
  const root=gatewayApi.create({
    branchId:'yongam',legacyRoot,v2Store,model,mutate,
    makeOperationId:()=>overrides.operationId||'op_1',
    now:()=>new Date('2026-08-11T03:00:00.000Z'),
    getBranchId:()=>overrides.currentBranchId||'yongam',
    onReloadRequired(){ calls.reloads+=1; },
  });
  return {
    root,calls,mutationRequests,
    emitConfig(next){ config=plain(next);configListener?.(plain(config)); },
    setLoaded(tabId,value){ loadedRoots[tabId]=plain(value); },
    legacyData:()=>plain(legacyData),
  };
}

const selection={tabIds:['regular'],domains:['roster']};

test('mode matrix preserves each read write and recovery authority',async()=>{
  const expected={
    v1:{legacyReads:1,legacyWrites:1,v2Reads:0,parity:0,mutations:0,recovery:null},
    shadow:{legacyReads:1,legacyWrites:1,v2Reads:0,parity:0,mutations:0,recovery:null},
    verify:{legacyReads:1,legacyWrites:1,v2Reads:0,parity:2,mutations:0,recovery:null},
    'v2-read':{legacyReads:0,legacyWrites:0,v2Reads:2,parity:0,mutations:1,recovery:'applied'},
    v2:{legacyReads:0,legacyWrites:0,v2Reads:2,parity:0,mutations:1,recovery:'not-required'},
  };
  for(const mode of Object.keys(expected)){
    const env=createEnvironment(mode);
    await env.root.loadSelection(selection);
    const result=await env.root.transactionKeys(['swim_students'],draft=>{
      draft.swim_students=JSON.stringify([{id:'student-1',name:'변경 이름'}]);
      return draft;
    },{operationType:'update-student',tabIds:['regular']});
    const want=expected[mode];
    assert.equal(env.calls.legacyReads,want.legacyReads,`${mode} legacy reads`);
    assert.equal(env.calls.legacyWrites,want.legacyWrites,`${mode} legacy writes`);
    assert.equal(env.calls.v2Reads,want.v2Reads,`${mode} V2 reads`);
    assert.equal(env.calls.parity,want.parity,`${mode} parity`);
    assert.equal(env.calls.mutations,want.mutations,`${mode} callable writes`);
    assert.equal(result.recoveryState??null,want.recovery,`${mode} recovery state`);
  }
});

test('verify mode awaits V2 parity after both reads and V1 writes',async()=>{
  const gate=deferred();
  const env=createEnvironment('verify',{parityPromise:gate.promise});
  let settled=false;
  const load=env.root.loadSelection(selection).then(()=>{ settled=true; });
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false);
  gate.resolve();
  await load;
  await env.root.transactionKeys(['swim_students'],draft=>draft,{
    operationType:'update-student',tabIds:['regular'],
  });
  assert.deepEqual(env.calls.order,['v1-read','v2-parity','v1-write','v2-parity']);
});

test('a confirmed V2 session never falls back to V1 after a V2 read error',async()=>{
  const env=createEnvironment('v2-read',{v2ReadError:true});
  await env.root.ready();
  await assert.rejects(env.root.loadSelection(selection),error=>error.code==='v2-operational-read-failed');
  assert.equal(env.calls.legacyReads,0);
  assert.equal(env.calls.v2Reads,1);
});

test('transactionKeys sends only the strict Task 2 request and keeps one operation id across retry',async()=>{
  const env=createEnvironment('v2-read',{transientMutationError:true,operationId:'stable_op_1'});
  await env.root.ready();
  const result=await env.root.transactionKeys(['swim_students'],draft=>{
    draft.swim_students=JSON.stringify([{id:'student-1',name:'새 이름'}]);
    return draft;
  },{operationType:'update-student',tabIds:['regular']});

  assert.equal(result.committed,true);
  assert.equal(env.mutationRequests.length,2);
  assert.deepEqual(env.mutationRequests[0],env.mutationRequests[1]);
  assert.deepEqual(Object.keys(env.mutationRequests[0]).sort(),[
    'beforeRevision','branchId','expectedEpoch','generationId','keys',
    'nextValues','operationId','operationType','removedKeys',
  ]);
  assert.deepEqual(env.mutationRequests[0],{
    branchId:'yongam',generationId:'gen_1',expectedEpoch:4,
    operationId:'stable_op_1',operationType:'update-student',
    keys:['swim_students'],beforeRevision:31,
    nextValues:{swim_students:JSON.stringify([{id:'student-1',name:'새 이름'}])},
    removedKeys:[],
  });
  assert.equal(env.root.currentConfig().revision,32);
});

test('cache changes only after an accepted matching server revision',async()=>{
  const env=createEnvironment('v2',{responseRevision:99});
  await env.root.ready();
  await assert.rejects(
    env.root.transactionKeys(['swim_students'],draft=>{
      draft.swim_students=JSON.stringify([{id:'student-1',name:'거절된 이름'}]);
      return draft;
    },{operationType:'update-student',tabIds:['regular']}),
    error=>error.code==='invalid-operational-response',
  );

  assert.equal(env.root.currentConfig().revision,31);
  const child=await env.root.child('swim_students').once('value',{tabIds:['regular']});
  assert.equal(JSON.parse(child.val())[0].name,'기존 이름');
});

test('tab and config changes fence pending responses and request one controlled reload',async()=>{
  const mutation=deferred();
  const env=createEnvironment('v2-read',{mutationPromise:mutation.promise});
  await env.root.loadSelection(selection);
  const pending=env.root.transactionKeys(['swim_students'],draft=>{
    draft.swim_students=JSON.stringify([{id:'student-1',name:'오래된 응답'}]);
    return draft;
  },{operationType:'update-student',tabIds:['regular']});
  await new Promise(resolve=>setImmediate(resolve));
  env.emitConfig({
    branchId:'yongam',mode:'v2-read',generationId:'gen_1',epoch:5,revision:32,valid:true,
  });
  mutation.resolve({
    operationId:'op_1',committed:true,revision:32,changeCount:1,setCount:1,deleteCount:0,recoveryState:'applied',
  });

  await assert.rejects(pending,error=>error.code==='stale-operational-response');
  assert.equal(env.calls.invalidations,1);
  assert.equal(env.calls.reloads,1);
  assert.equal(env.root.currentConfig().epoch,5);
});

test('the expected runtime revision notification waits for the accepted callable response',async()=>{
  const mutation=deferred();
  const env=createEnvironment('v2-read',{mutationPromise:mutation.promise});
  await env.root.loadSelection(selection);
  const pending=env.root.transactionKeys(['swim_students'],draft=>{
    draft.swim_students=JSON.stringify([{id:'student-1',name:'승인된 응답'}]);
    return draft;
  },{operationType:'update-student',tabIds:['regular']});
  await new Promise(resolve=>setImmediate(resolve));
  env.emitConfig({
    branchId:'yongam',mode:'v2-read',generationId:'gen_1',epoch:4,revision:32,valid:true,
  });
  mutation.resolve({
    operationId:'op_1',committed:true,revision:32,changeCount:1,setCount:1,deleteCount:0,recoveryState:'applied',
  });
  const result=await pending;

  assert.equal(result.committed,true);
  assert.equal(env.calls.invalidations,0);
  assert.equal(env.calls.reloads,0);
  assert.equal(env.root.currentConfig().revision,32);
  const child=await env.root.child('swim_students').once('value',{tabIds:['regular']});
  assert.equal(JSON.parse(child.val())[0].name,'승인된 응답');
});

test('root-compatible child once transaction and selected subscription use snapshots',async()=>{
  const env=createEnvironment('v2-read');
  await env.root.ready();
  const batches=[];
  const controller=env.root.subscribeSelectedBatches({
    baseKeys:['swim_tab_list'],
    resolveInitialActiveKeys:()=>['swim_students'],
    selectionForKeys:()=>selection,
    next:batch=>batches.push(plain(batch)),
  });
  await controller.ready;
  const child=await env.root.child('swim_students').once('value',{tabIds:['regular']});
  const tx=await env.root.child('swim_students').transaction(value=>{
    const rows=JSON.parse(value);rows[0].name='자식 변경';return JSON.stringify(rows);
  },{operationType:'update-student',tabIds:['regular']});

  assert.equal(child.key,'swim_students');
  assert.equal(JSON.parse(child.val())[0].name,'기존 이름');
  assert.equal(tx.committed,true);
  assert.equal(JSON.parse(tx.snapshot.val())[0].name,'자식 변경');
  assert.equal(batches.length,1);
  assert.equal(batches[0].initial,true);
  assert.deepEqual(Object.keys(batches[0].values).sort(),['swim_students','swim_tab_list']);
  for(const method of ['setActiveKeys','setAuxiliaryKeys','releaseAuxiliaryKeys','waitForActive','stop']){
    assert.equal(typeof controller[method],'function');
  }
  controller.stop();
});

test('diagnostics retain safe operation metadata and redact payloads names phones and messages',async()=>{
  const env=createEnvironment('v2-read',{v2ReadError:true});
  await assert.rejects(env.root.loadSelection(selection));
  const encoded=JSON.stringify(env.root.diagnostics());

  assert.match(encoded,/v2-read-error/);
  assert.doesNotMatch(encoded,/기존 이름|secret-name|010-secret|payload|swim_students/);
});

test('staff pages load operational modules once in exact dependency order without Firebase reinitialization',()=>{
  const pages={
    'index.html':'js/core.js',
    'teacher.html':'js/teacher.js',
    'desk.html':'js/desk.js',
    'settings.html':'js/settings.js',
  };
  const modules=[
    'js/schedule-schema-v2.js','js/schedule-v2-store.js','js/schedule-v2-operational-model.js',
    'js/schedule-v2-operational-store.js','js/schedule-operational-gateway.js',
  ];
  for(const [page,runtime] of Object.entries(pages)){
    const source=fs.readFileSync(path.join(__dirname,'..',page),'utf8');
    const indexes=modules.map(file=>source.indexOf(`scJs('${file}')`));
    indexes.push(source.indexOf(`scJs('${runtime}')`));
    assert.ok(indexes.every(index=>index>=0),`${page} contains every operational dependency`);
    assert.deepEqual(indexes,indexes.slice().sort((a,b)=>a-b),`${page} dependency order`);
    for(const file of modules.slice(2)){
      assert.equal(source.split(`scJs('${file}')`).length-1,1,`${page} loads ${file} once`);
    }
    assert.equal((source.match(/firebase-app-compat\.js/g)||[]).length,1,`${page} loads Firebase app once`);
  }
  for(const file of ['js/schedule-v2-operational-model.js','js/schedule-v2-operational-store.js','js/schedule-operational-gateway.js']){
    const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
    assert.doesNotMatch(source,/initializeApp\s*\(/);
  }
  const parent=fs.readFileSync(path.join(__dirname,'..','parent.html'),'utf8');
  assert.doesNotMatch(parent,/schedule-v2-operational|schedule-operational-gateway/);
});
