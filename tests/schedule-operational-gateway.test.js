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
  const calls={
    legacyReads:0,legacyWrites:0,v2Reads:0,mutationReads:0,parity:0,mutations:0,
    invalidations:0,reloads:0,configReads:0,configUnsubscribes:0,legacySubscriptions:0,delegateStops:0,order:[],
    reloadDetails:[],
  };
  let legacyData=plain(overrides.legacyData||{
    swim_students:JSON.stringify([{id:'student-1',name:'기존 이름',phone:'010-secret'}]),
  });
  let config={
    branchId:'yongam',mode,generationId:['v2-read','v2','shadow','verify'].includes(mode)?'gen_1':'',
    epoch:4,revision:31,valid:true,
  };
  let configListener=null;
  let configErrorListener=null;
  let legacySubscriber=null;
  const mutationRequests=[];
  const readSelections=[];
  const mutationSelections=[];
  const parityInputs=[];
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
      calls.legacySubscriptions+=1;
      calls.order.push('v1-subscribe');
      legacySubscriber=options;
      const values={};
      (options.baseKeys||[]).forEach(key=>{ if(legacyData[key]!==undefined) values[key]=legacyData[key]; });
      options.next({initial:true,revision:1,values,removedKeys:[],changedKeys:Object.keys(values)});
      return {ready:Promise.resolve({stale:false}),setActiveKeys:async()=>({stale:false}),setAuxiliaryKeys:async()=>({stale:false}),releaseAuxiliaryKeys(){},waitForActive:async()=>({stale:false}),stop(){calls.delegateStops+=1;}};
    },
  };
  const v2Store={
    async readConfig(){
      const readIndex=calls.configReads++;
      const configured=Array.isArray(overrides.configSequence)
        ?overrides.configSequence[Math.min(readIndex,overrides.configSequence.length-1)]
        :config;
      if(overrides.configReadPromise) return overrides.configReadPromise;
      if(overrides.configError) throw new Error('config unavailable secret');
      return plain(configured);
    },
    subscribeConfig(next,error){
      const initial=Array.isArray(overrides.configSequence)?overrides.configSequence[0]:config;
      configListener=next;
      if(overrides.configSubscriptionError){
        error(Object.assign(new Error('config subscription unavailable'),{code:'unavailable'}));
      }else next(plain(initial));
      configErrorListener=error;
      return ()=>{calls.configUnsubscribes+=1;configListener=null;configErrorListener=null;};
    },
    invalidate(){ calls.invalidations+=1; },
    async loadSelection(selection){
      calls.v2Reads+=1;calls.order.push('v2-read');
      readSelections.push(plain(selection));
      if(overrides.v2ReadError) throw new Error('v2 read secret-name 010-secret');
      if(overrides.v2ReadPromise) return overrides.v2ReadPromise;
      if(typeof overrides.loadSelection==='function') return overrides.loadSelection(plain(selection),plain(config));
      const tabId=selection.tabIds?.[0]||'regular';
      return {
        root:plain(loadedRoots[tabId]||{}),collections:{},config:plain(config),
        context:{branchId:config.branchId,generationId:config.generationId,epoch:config.epoch,revision:config.revision},
        selection:plain(selection),
      };
    },
    async loadMutation(selection){
      calls.v2Reads+=1;calls.mutationReads+=1;calls.order.push('v2-mutation-read');
      mutationSelections.push(plain(selection));
      if(typeof overrides.loadMutation==='function') return overrides.loadMutation(plain(selection),plain(config));
      const tabId=selection.tabIds?.[0]||'regular';
      return {
        root:plain(overrides.mutationRoot||loadedRoots[tabId]||{}),collections:{},config:plain(config),
        context:{branchId:config.branchId,generationId:config.generationId,epoch:config.epoch,revision:config.revision},
        selection:plain(selection),
      };
    },
    async readShadowState(){
      return plain(overrides.shadowState||{requestedRevision:8,appliedRevision:8,status:'idle'});
    },
    async verifyParity(input){
      calls.parity+=1;calls.order.push('v2-parity');
      parityInputs.push(plain(input));
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
    if(overrides.commitThenLoseResponse){
      if(mutationAttempt===1){
        config={...config,revision:request.beforeRevision+1};
        configListener?.(plain(config));
      }
      throw Object.assign(new Error('committed response lost'),{code:overrides.lostResponseCode||'functions/unavailable'});
    }
    if(Array.isArray(overrides.mutationErrors)&&overrides.mutationErrors[mutationAttempt-1]){
      throw overrides.mutationErrors[mutationAttempt-1];
    }
    if((overrides.transientMutationError||overrides.transientMutationCode)&&mutationAttempt===1){
      throw Object.assign(new Error('temporary secret'),{code:overrides.transientMutationCode||'unavailable'});
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
    getBranchId:typeof overrides.getBranchId==='function'?overrides.getBranchId:()=>overrides.currentBranchId||'yongam',
    onReloadRequired(details){ calls.reloads+=1;calls.reloadDetails.push(plain(details)); },
  });
  return {
    root,calls,mutationRequests,readSelections,mutationSelections,parityInputs,
    emitConfig(next){ config=plain(next);configListener?.(plain(config)); },
    emitConfigError(error){ configErrorListener?.(error); },
    emitLegacyBatch(batch){ legacySubscriber?.next(plain(batch)); },
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

test('an unreadable startup authority permits legacy reads but keeps schedule writes read only',async()=>{
  const env=createEnvironment('v1',{configError:true,configSubscriptionError:true});

  const loaded=await env.root.loadSelection(selection);
  assert.equal(loaded.primary,'v1');
  await assert.rejects(()=>env.root.transactionKeys(['swim_students'],draft=>draft,{
    operationType:'update-student',tabIds:['regular'],
  }),error=>error?.code==='operational-authority-unavailable');

  assert.equal(env.calls.legacyReads,1);
  assert.equal(env.calls.legacyWrites,0);
  assert.equal(env.root.currentConfig().valid,false);
});

test('a transient startup config read failure recovers from the live authority subscription',async()=>{
  const env=createEnvironment('v2-read',{configError:true});

  const authority=await env.root.ready();
  const loaded=await env.root.loadSelection(selection);

  assert.equal(authority.valid,true);
  assert.equal(authority.mode,'v2-read');
  assert.equal(loaded.primary,'v2');
  assert.equal(env.calls.configReads,1);
  assert.equal(env.calls.configUnsubscribes,0);
});

test('malformed runtime authority never becomes an implicit writable V1 pointer',async()=>{
  const invalidConfigs=[
    {branchId:'yongam',mode:'v1',generationId:'',epoch:4,revision:31,valid:false},
    {branchId:'yongam',mode:'unknown',generationId:'',epoch:4,revision:31,valid:true},
    {branchId:'gagyeong',mode:'v1',generationId:'',epoch:4,revision:31,valid:true},
    {branchId:'yongam',mode:'v1',generationId:'',epoch:-1,revision:31,valid:true},
    {branchId:'yongam',mode:'v1',generationId:'',epoch:null,revision:31,valid:true},
    {branchId:'yongam',mode:'v1',generationId:'',epoch:4,revision:null,valid:true},
    {branchId:'yongam',mode:'v1',generationId:'',epoch:'4',revision:31,valid:true},
    {branchId:' yongam ',mode:'v1',generationId:'',epoch:4,revision:31,valid:true},
    {branchId:'yongam',mode:' v1 ',generationId:'',epoch:4,revision:31,valid:true},
    {branchId:'yongam',mode:'v2-read',generationId:' gen_1 ',epoch:4,revision:31,valid:true},
    {branchId:'yongam',mode:'v2-read',generationId:'bad/gen',epoch:4,revision:31,valid:true},
    {branchId:'yongam',mode:'v2-read',generationId:'g'.repeat(129),epoch:4,revision:31,valid:true},
  ];
  for(const candidate of invalidConfigs){
    const env=createEnvironment('v1',{configSequence:[candidate]});
    await env.root.ready();
    await assert.rejects(()=>env.root.transactionKeys(['swim_students'],draft=>draft,{
      operationType:'update-student',tabIds:['regular'],
    }),error=>error?.code==='operational-authority-unavailable',JSON.stringify(candidate));
    assert.equal(env.calls.legacyWrites,0,JSON.stringify(candidate));
  }
});

test('losing a valid V1 runtime subscription revokes legacy write authority',async()=>{
  const env=createEnvironment('v1');
  await env.root.ready();
  env.emitConfigError(Object.assign(new Error('listener failed'),{code:'unavailable'}));

  await assert.rejects(()=>env.root.transactionKeys(['swim_students'],draft=>draft,{
    operationType:'update-student',tabIds:['regular'],
  }),error=>error?.code==='operational-authority-unavailable');
  assert.equal(env.calls.legacyWrites,0);
  assert.equal(env.root.currentConfig().valid,false);
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

test('functions-prefixed transient callable codes retry with the same operation id',async()=>{
  const env=createEnvironment('v2-read',{transientMutationCode:'functions/unavailable',operationId:'stable_prefixed_op'});
  await env.root.transactionKeys(['swim_students'],draft=>{
    draft.swim_students=JSON.stringify([{id:'student-1',name:'재시도'}]);
    return draft;
  },{operationType:'update-student',tabIds:['regular']});

  assert.equal(env.mutationRequests.length,2);
  assert.equal(env.mutationRequests[0].operationId,'stable_prefixed_op');
  assert.equal(env.mutationRequests[1].operationId,'stable_prefixed_op');
});

test('a committed write with every callable response lost re-reads revision without locking the page',async()=>{
  const env=createEnvironment('v2-read',{
    commitThenLoseResponse:true,
    operationId:'committed_lost_response',
  });

  await assert.rejects(
    env.root.transactionKeys(['swim_students'],draft=>{
      draft.swim_students=JSON.stringify([{id:'student-1',name:'서버에는 저장됨'}]);
      return draft;
    },{operationType:'update-student',tabIds:['regular']}),
    error=>error?.code==='functions/unavailable',
  );

  assert.equal(env.calls.mutations,2);
  assert.equal(env.calls.configReads,2);
  assert.equal(env.calls.reloads,0);
  assert.equal(env.calls.invalidations,0);
  assert.equal(env.root.currentConfig().revision,32);
  assert.deepEqual(env.mutationRequests[0],env.mutationRequests[1]);
  const next=await env.root.transactionKeys(['swim_students'],draft=>draft,{
    operationType:'update-student',tabIds:['regular'],
  });
  assert.equal(next.committed,true);
});

test('transaction preparation uses complete authoritative values for shared and global keys',async()=>{
  const full={
    swim_mark:JSON.stringify({regular:{color:'blue'},camp:{color:'red'}}),
    swim_enroll:JSON.stringify({'regular-slot':{state:'regular'},'camp-slot':{state:'camp'}}),
    swim_tab_list:JSON.stringify([{id:'regular',name:'정규반'},{id:'camp',name:'방학특강'}]),
    swim_students:JSON.stringify([{id:'regular-student',name:'정규 원생'}]),
    swim_disabled:JSON.stringify({'regular-slot':true,'camp-slot':true}),
  };
  const env=createEnvironment('v2-read',{
    mutationRoot:full,
    loadSelection(selection,config){
      return {root:{swim_mark:JSON.stringify({regular:{color:'blue'}})},collections:{},config,context:{...config},selection};
    },
  });
  await env.root.transactionKeys(Object.keys(full),draft=>{
    const marks=JSON.parse(draft.swim_mark);marks.regular.color='green';draft.swim_mark=JSON.stringify(marks);
    const reservations=JSON.parse(draft.swim_enroll);reservations['regular-slot'].state='changed';draft.swim_enroll=JSON.stringify(reservations);
    const tabs=JSON.parse(draft.swim_tab_list);tabs[0].name='정규 변경';draft.swim_tab_list=JSON.stringify(tabs);
    const students=JSON.parse(draft.swim_students);students[0].name='원생 변경';draft.swim_students=JSON.stringify(students);
    const disabled=JSON.parse(draft.swim_disabled);disabled['regular-slot']=false;draft.swim_disabled=JSON.stringify(disabled);
    return draft;
  },{operationType:'edit-schedule',tabIds:['regular']});

  assert.equal(env.calls.mutationReads,1);
  const next=env.mutationRequests[0].nextValues;
  assert.equal(JSON.parse(next.swim_mark).camp.color,'red');
  assert.equal(JSON.parse(next.swim_enroll)['camp-slot'].state,'camp');
  assert.equal(JSON.parse(next.swim_tab_list)[1].id,'camp');
  assert.equal(JSON.parse(next.swim_students).length,1);
  assert.equal(JSON.parse(next.swim_disabled)['camp-slot'],true);
});

test('cache merge ignores manufactured values outside the returned loaded-key projection',async()=>{
  const fullMark=JSON.stringify({regular:{color:'blue'},camp:{color:'red'}});
  let reads=0;
  const env=createEnvironment('v2-read',{
    loadSelection(selection,config){
      reads+=1;
      if(reads===1) return {root:{swim_mark:fullMark},loadedKeys:['swim_mark'],collections:{},config,context:{...config},selection};
      return {
        root:{swim_students:JSON.stringify([{id:'student-1'}]),swim_mark:'{}'},
        loadedKeys:['swim_students'],collections:{},config,context:{...config},selection,
      };
    },
  });
  await env.root.loadSelection({tabIds:['regular'],domains:['workflow'],keys:['swim_mark']});
  await env.root.loadSelection({tabIds:['regular'],domains:['roster'],keys:['swim_students']});
  const mark=await env.root.child('swim_mark').once('value');

  assert.equal(mark.val(),fullMark);
  assert.equal(reads,2);
});

test('an absent selected key is evicted without disturbing cached unread keys',async()=>{
  const tabList=JSON.stringify([{id:'regular'},{id:'camp'}]);
  let reads=0;
  const env=createEnvironment('v2-read',{
    loadSelection(selection,config){
      reads+=1;
      if(reads===1) return {
        root:{swim_mark:JSON.stringify({regular:{color:'blue'}}),swim_tab_list:tabList},
        loadedKeys:['swim_mark','swim_tab_list'],collections:{},config,context:{...config},selection,
      };
      return {root:{},loadedKeys:['swim_mark'],collections:{},config,context:{...config},selection};
    },
  });
  await env.root.loadSelection({tabIds:['regular'],domains:['roster','workflow'],keys:['swim_mark','swim_tab_list']});
  await env.root.loadSelection({tabIds:['regular'],domains:['workflow'],keys:['swim_mark']});

  const cachedTabs=await env.root.child('swim_tab_list').once('value');
  const removedMark=await env.root.child('swim_mark').once('value',{tabIds:['regular']});
  assert.equal(cachedTabs.val(),tabList);
  assert.equal(removedMark.val(),null);
  assert.equal(reads,3);
});

test('overlapping selected-tab loads surface a controlled stale result without publishing the old tab',async()=>{
  const regularGate=deferred();
  const env=createEnvironment('v2-read',{
    async loadSelection(selection,config){
      if(selection.tabIds.includes('regular')){
        await regularGate.promise;
        throw Object.assign(new Error('old selection'),{code:'stale-operational-selection'});
      }
      return {
        root:{swim_bt_camp_stu:JSON.stringify([{id:'camp-current'}])},loadedKeys:['swim_bt_camp_stu'],
        collections:{},config,context:{...config},selection,
      };
    },
  });
  const old=env.root.loadSelection({tabIds:['regular'],domains:['roster'],keys:['swim_students']});
  await new Promise(resolve=>setImmediate(resolve));
  const current=await env.root.loadSelection({tabIds:['camp'],domains:['roster'],keys:['swim_bt_camp_stu']});
  regularGate.resolve();

  assert.equal(JSON.parse(current.root.swim_bt_camp_stu)[0].id,'camp-current');
  await assert.rejects(old,error=>error.code==='stale-operational-response');
});

test('independent gateway selection owners can finish without cancelling each other',async()=>{
  const regularGate=deferred();
  const env=createEnvironment('v2-read',{
    async loadSelection(selection,config){
      if(selection.tabIds.includes('regular')) await regularGate.promise;
      const root=selection.tabIds.includes('camp')
        ?{swim_bt_camp_stu:JSON.stringify([{id:'camp-current'}])}
        :{swim_students:JSON.stringify([{id:'regular-current'}])};
      return {root,loadedKeys:Object.keys(root),collections:{},config,context:{...config},selection};
    },
  });

  const main=env.root.loadSelection({
    tabIds:['regular'],domains:['roster'],keys:['swim_students'],owner:'schedule-main',
  });
  await new Promise(resolve=>setImmediate(resolve));
  const modal=await env.root.loadSelection({
    tabIds:['camp'],domains:['roster'],keys:['swim_bt_camp_stu'],owner:'schedule-modal:student',
  });
  regularGate.resolve();
  const mainResult=await main;

  assert.equal(JSON.parse(modal.root.swim_bt_camp_stu)[0].id,'camp-current');
  assert.equal(JSON.parse(mainResult.root.swim_students)[0].id,'regular-current');
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

test('a committed save remains successful after a tab switch and invalidates the old tab cache',async()=>{
  const mutation=deferred();
  const env=createEnvironment('v2-read',{mutationPromise:mutation.promise});
  const pending=env.root.transactionKeys(['swim_students'],draft=>{
    draft.swim_students=JSON.stringify([{id:'student-1',name:'stale-tab'}]);
    return draft;
  },{operationType:'update-student',tabIds:['regular']});
  await new Promise(resolve=>setImmediate(resolve));
  await env.root.loadSelection({tabIds:['camp'],domains:['roster'],keys:['swim_bt_camp_stu']});
  mutation.resolve({operationId:'op_1',committed:true,revision:32,recoveryState:'applied'});

  const result=await pending;
  assert.equal(result.committed,true);
  assert.equal(env.root.currentConfig().revision,32);
  const readsBefore=env.calls.v2Reads;
  env.setLoaded('regular',{swim_students:JSON.stringify([{id:'student-1',name:'서버 저장 이름'}])});
  const regular=await env.root.child('swim_students').once('value',{owner:'schedule-modal:verify-save'});
  assert.equal(env.calls.v2Reads,readsBefore+1);
  assert.equal(JSON.parse(regular.val())[0].name,'서버 저장 이름');
});

test('a branch change while the callable is pending cannot update cache or revision',async()=>{
  const mutation=deferred();
  const branch={id:'yongam'};
  const env=createEnvironment('v2-read',{mutationPromise:mutation.promise,getBranchId:()=>branch.id});
  const pending=env.root.transactionKeys(['swim_students'],draft=>{
    draft.swim_students=JSON.stringify([{id:'student-1',name:'stale-branch'}]);
    return draft;
  },{operationType:'update-student',tabIds:['regular']});
  await new Promise(resolve=>setImmediate(resolve));
  branch.id='gagyeong';
  mutation.resolve({operationId:'op_1',committed:true,revision:32,recoveryState:'applied'});

  await assert.rejects(pending,error=>error.code==='stale-operational-response');
  assert.equal(env.root.currentConfig().revision,31);
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

test('active-key switching infers exact key-owned bangteuk tabs before the previous selection',async()=>{
  const batches=[];
  const env=createEnvironment('v2-read',{
    loadSelection(selection,config){
      const keys=selection.keys||[];
      const root={swim_tab_list:JSON.stringify([{id:'regular'},{id:'camp'}]),swim_students:'[]'};
      if(keys.includes('swim_bt_attendance_camp')) root.swim_bt_attendance_camp='{}';
      return {root,loadedKeys:keys,collections:{},config,context:{...config},selection};
    },
  });
  const controller=env.root.subscribeSelectedBatches({
    baseKeys:['swim_tab_list'],resolveInitialActiveKeys:()=>['swim_students'],next:batch=>batches.push(plain(batch)),
  });
  await controller.ready;
  await controller.setActiveKeys(['swim_bt_camp_stu']);
  assert.deepEqual(env.readSelections.at(-1).tabIds,['camp']);
  assert.deepEqual(batches.at(-1).removedKeys,['swim_bt_camp_stu']);

  await controller.setActiveKeys(['swim_bt_attendance_camp']);
  assert.deepEqual(env.readSelections.at(-1).tabIds,['camp']);
  assert.equal(batches.at(-1).values.swim_bt_attendance_camp,'{}');
  controller.stop();
});

test('active-key switching infers regular and bangteuk removals in both directions',async()=>{
  const batches=[];
  const env=createEnvironment('v2-read',{
    loadSelection(selection,config){
      const keys=selection.keys||[];
      return {
        root:keys.includes('swim_tab_list')?{swim_tab_list:JSON.stringify([{id:'regular'},{id:'camp'}])}:{},
        loadedKeys:keys,collections:{},config,context:{...config},selection,
      };
    },
  });
  const controller=env.root.subscribeSelectedBatches({
    baseKeys:['swim_tab_list'],resolveInitialActiveKeys:()=>['swim_students'],next:batch=>batches.push(plain(batch)),
  });
  await controller.ready;
  assert.deepEqual(env.readSelections.at(-1).tabIds,['regular']);
  assert.ok(batches.at(-1).removedKeys.includes('swim_students'));

  await controller.setActiveKeys(['swim_bt_camp_stu']);
  assert.deepEqual(env.readSelections.at(-1).tabIds,['camp']);
  assert.ok(batches.at(-1).removedKeys.includes('swim_bt_camp_stu'));

  await controller.setActiveKeys(['swim_students']);
  assert.deepEqual(env.readSelections.at(-1).tabIds,['regular']);
  assert.ok(batches.at(-1).removedKeys.includes('swim_students'));
  controller.stop();
});

test('verify compares only the selected projection and passes the pre-write shadow revision',async()=>{
  const env=createEnvironment('verify',{
    legacyData:{
      swim_students:JSON.stringify([{id:'student-1'}]),
      swim_mark:JSON.stringify({unrelated:{color:'red'}}),
    },
  });
  await env.root.loadSelection({tabIds:['regular'],domains:['roster'],keys:['swim_students']});
  await env.root.transactionKeys(['swim_students'],draft=>{
    draft.swim_students=JSON.stringify([{id:'student-1',name:'changed'}]);
    return draft;
  },{operationType:'update-student',tabIds:['regular']});

  assert.deepEqual(env.parityInputs[0].keys,['swim_students']);
  assert.deepEqual(Object.keys(env.parityInputs[0].values),['swim_students']);
  assert.equal(env.parityInputs[1].afterShadowRevision,8);
  assert.equal(env.parityInputs[1].requireShadowAdvance,true);
});

test('a no-op verify transaction checks current parity without requiring a shadow revision advance',async()=>{
  const env=createEnvironment('verify',{
    legacyData:{swim_students:JSON.stringify([{id:'student-1'}])},
    shadowState:{requestedRevision:8,appliedRevision:8,status:'idle'},
  });

  const result=await env.root.transactionKeys(
    ['swim_students'],draft=>draft,{operationType:'update-student',tabIds:['regular']},
  );

  assert.equal(result.committed,true);
  assert.equal(env.calls.parity,1);
  assert.equal(env.parityInputs[0].requireShadowAdvance,false);
  assert.equal(env.parityInputs[0].afterShadowRevision,8);
});

test('request recovery can require a committed manifest even when the tracked V2 value is unchanged',async()=>{
  const env=createEnvironment('v2-read');
  const result=await env.root.transactionKeys(
    ['swim_students'],draft=>draft,
    {operationId:'op_request_manifest',operationType:'update-student',requireOperationManifest:true,tabIds:['regular']},
  );

  assert.equal(result.committed,true);
  assert.equal(env.calls.mutations,1);
  assert.equal(env.mutationRequests[0].operationId,'op_request_manifest');
  assert.deepEqual(env.mutationRequests[0].keys,['swim_students']);
});

test('stopping a selected subscription before readiness prevents late V1 delegate creation',async()=>{
  const gate=deferred();
  const env=createEnvironment('v1',{configReadPromise:gate.promise});
  const controller=env.root.subscribeSelectedBatches({baseKeys:['swim_students'],next(){}});
  controller.stop();
  gate.resolve({branchId:'yongam',mode:'v1',generationId:'',epoch:4,revision:31,valid:true});
  const result=await controller.ready;

  assert.deepEqual(result,{stale:true});
  assert.equal(env.calls.legacySubscriptions,0);
});

test('a V1 to V2 authority change stops the live delegate and blocks its late batches',async()=>{
  const env=createEnvironment('v1',{legacyData:{swim_students:'[]'}});
  const batches=[];
  const controller=env.root.subscribeSelectedBatches({
    baseKeys:['swim_students'],next:batch=>batches.push(plain(batch)),
  });
  await controller.ready;
  assert.equal(batches.length,1);

  env.emitConfig({
    branchId:'yongam',mode:'v2-read',generationId:'gen_2',epoch:5,revision:40,valid:true,
  });
  env.emitLegacyBatch({
    initial:false,revision:2,values:{swim_students:'[{"id":"late-v1"}]'},
    removedKeys:[],changedKeys:['swim_students'],
  });

  assert.equal(env.calls.reloads,1);
  assert.equal(env.calls.delegateStops,1);
  assert.equal(env.calls.configUnsubscribes,1);
  assert.equal(batches.length,1);
  assert.deepEqual(await controller.setActiveKeys(['swim_students']),{stale:true});
});

test('external generation or epoch changes request one idempotent controlled reload',async()=>{
  const scenarios=[
    {generationId:'gen_2',epoch:4,revision:31},
    {generationId:'gen_1',epoch:5,revision:31},
  ];
  for(const next of scenarios){
    const env=createEnvironment('v2-read');
    await env.root.ready();
    const config={branchId:'yongam',mode:'v2-read',valid:true,...next};
    env.emitConfig(config);
    env.emitConfig(config);

    assert.equal(env.calls.reloads,1,JSON.stringify(next));
    assert.equal(env.calls.configUnsubscribes,1,JSON.stringify(next));
    assert.deepEqual(env.calls.reloadDetails,[{
      branchId:'yongam',mode:'v2-read',generationId:next.generationId,
      epoch:next.epoch,revision:next.revision,
    }]);
  }
});

test('an external revision-only update refreshes the runtime revision without reloading the page',async()=>{
  const env=createEnvironment('v2-read');
  await env.root.ready();

  env.emitConfig({
    branchId:'yongam',mode:'v2-read',generationId:'gen_1',epoch:4,revision:32,valid:true,
  });

  assert.equal(env.calls.reloads,0);
  assert.equal(env.calls.configUnsubscribes,0);
  assert.equal(env.root.currentConfig().revision,32);
});

test('dispose cancels listeners and config subscription once',async()=>{
  const env=createEnvironment('v1');
  const controller=env.root.subscribeSelectedBatches({baseKeys:['swim_students'],next(){}});
  await controller.ready;
  assert.equal(typeof env.root.dispose,'function');
  env.root.dispose();
  env.root.dispose();

  assert.equal(env.calls.delegateStops,1);
  assert.equal(env.calls.configUnsubscribes,1);
  await assert.rejects(env.root.loadSelection(selection),error=>error.code==='operational-disposed');
});

test('diagnostics retain safe operation metadata and redact payloads names phones and messages',async()=>{
  const env=createEnvironment('v2-read',{v2ReadError:true});
  await assert.rejects(env.root.loadSelection(selection));
  const encoded=JSON.stringify(env.root.diagnostics());

  assert.match(encoded,/v2-read-error/);
  assert.doesNotMatch(encoded,/기존 이름|secret-name|010-secret|payload|swim_students/);
});

test('an aborted retry awaits an async mutator and preserves unrelated fresh data',async()=>{
  let read=0;
  const env=createEnvironment('v2-read',{
    mutationErrors:[Object.assign(new Error('overlap'),{code:'aborted'})],
    loadMutation(){
      read+=1;
      const students=read===1
        ?[{id:'student-1',name:'before'},{id:'student-2',name:'unchanged'}]
        :[{id:'student-1',name:'before'},{id:'student-2',name:'fresh remote'}];
      return {
        root:{swim_students:JSON.stringify(students)},collections:{},
        config:{branchId:'yongam',mode:'v2-read',generationId:'gen_1',epoch:4,revision:31,valid:true},
        context:{branchId:'yongam',generationId:'gen_1',epoch:4,revision:31},selection,
      };
    },
  });

  await env.root.transactionKeys(['swim_students'],async draft=>{
    await Promise.resolve();
    const students=JSON.parse(draft.swim_students);
    students[0].name='local async';
    draft.swim_students=JSON.stringify(students);
    return draft;
  },{operationId:'async_rebase',operationType:'update-student',tabIds:['regular']});

  assert.equal(env.calls.mutations,2);
  assert.deepEqual(JSON.parse(env.mutationRequests[1].nextValues.swim_students),[
    {id:'student-1',name:'local async'},
    {id:'student-2',name:'fresh remote'},
  ]);
});

test('an aborted retry fails closed when operational authority changes',async()=>{
  const authorities=[
    {label:'mode',mode:'v1',generationId:'',epoch:4},
    {label:'generation',mode:'v2-read',generationId:'gen_2',epoch:4},
    {label:'epoch',mode:'v2-read',generationId:'gen_1',epoch:5},
  ];
  for(const authority of authorities){
    const initial={branchId:'yongam',mode:'v2-read',generationId:'gen_1',epoch:4,revision:31,valid:true};
    const env=createEnvironment('v2-read',{
      configSequence:[initial,{...initial,...authority}],
      mutationErrors:[Object.assign(new Error('overlap'),{code:'aborted'})],
    });
    await env.root.ready();

    await assert.rejects(
      env.root.transactionKeys(['swim_students'],draft=>{
        draft.swim_students=JSON.stringify([{id:'student-1',name:authority.label}]);
        return draft;
      },{operationId:`authority_${authority.label}`,operationType:'update-student',tabIds:['regular']}),
      error=>error?.code==='operational-reload-required',
      authority.label,
    );
    assert.equal(env.calls.mutations,1,authority.label);
    assert.equal(env.calls.reloads,1,authority.label);
  }
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
    assert.equal((source.match(/firebase-functions-compat\.js/g)||[]).length,1,`${page} loads Firebase Functions once`);
    assert.ok(source.indexOf('firebase-firestore-compat.js')<source.indexOf('firebase-functions-compat.js'),`${page} Functions follows Firestore`);
    assert.ok(source.indexOf('firebase-functions-compat.js')<source.indexOf("scJs('js/schedule-operational-gateway.js')"),`${page} Functions precedes gateway`);
  }
  for(const file of ['js/schedule-v2-operational-model.js','js/schedule-v2-operational-store.js','js/schedule-operational-gateway.js']){
    const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
    assert.doesNotMatch(source,/initializeApp\s*\(/);
  }
  const parent=fs.readFileSync(path.join(__dirname,'..','parent.html'),'utf8');
  assert.doesNotMatch(parent,/schedule-v2-operational|schedule-operational-gateway/);
});
