(function(global,factory){
  'use strict';
  const api=factory(global);
  if(typeof module==='object'&&module.exports) module.exports=api;
  global.SCOperationalSchedule=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(global){
  'use strict';

  const V2_MODES=new Set(['v2-read','v2']);
  const V1_MODES=new Set(['v1','shadow','verify']);
  const RETRYABLE_CODES=new Set(['cancelled','deadline-exceeded','internal','resource-exhausted','unavailable']);
  const MAX_DIAGNOSTICS=80;
  let operationSequence=0;

  function text(value){ return String(value==null?'':value).trim(); }
  function clone(value){ return value==null?value:JSON.parse(JSON.stringify(value)); }
  function object(value){ return !!value&&typeof value==='object'&&!Array.isArray(value); }
  function unique(values){ return [...new Set((Array.isArray(values)?values:[]).map(text).filter(Boolean))]; }
  function fail(code,message){ throw Object.assign(new Error(message||code),{code}); }
  function sameValue(left,right){
    try{return JSON.stringify(left)===JSON.stringify(right);}catch(error){return false;}
  }
  function configFingerprint(config){
    return [text(config?.branchId),text(config?.mode),text(config?.generationId),Number(config?.epoch)||0,Number(config?.revision)||0].join('|');
  }
  function defaultOperationId(){
    if(global.crypto&&typeof global.crypto.randomUUID==='function') return global.crypto.randomUUID();
    operationSequence=(operationSequence+1)%1000000;
    return `op_${Date.now().toString(36)}_${operationSequence.toString(36)}`;
  }
  function Snapshot(key,value){ this.key=key||null;this._value=value; }
  Snapshot.prototype.val=function(){ return clone(this._value); };

  function create(options){
    options=options||{};
    const branchId=text(options.branchId);
    const legacyRoot=options.legacyRoot;
    const v2Store=options.v2Store;
    const model=options.model||global.SCV2OperationalModel;
    const now=typeof options.now==='function'?options.now:()=>new Date();
    const makeOperationId=typeof options.makeOperationId==='function'?options.makeOperationId:defaultOperationId;
    const getBranchId=typeof options.getBranchId==='function'?options.getBranchId:()=>branchId;
    const maxMutationAttempts=Math.max(1,Math.min(3,Number(options.maxMutationAttempts||2)||2));
    if(!branchId) throw new TypeError('branchId is required');
    if(!legacyRoot||typeof legacyRoot.once!=='function'||typeof legacyRoot.transactionKeys!=='function'){
      throw new TypeError('legacyRoot is required');
    }
    if(!v2Store||typeof v2Store.readConfig!=='function'||typeof v2Store.loadSelection!=='function'){
      throw new TypeError('v2Store is required');
    }
    if(!model||typeof model.domainForLegacyKey!=='function'||typeof model.changedLegacyKeys!=='function'){
      throw new TypeError('SCV2OperationalModel is required');
    }

    const callable=typeof options.mutate==='function'?options.mutate:createCallable(options);
    let config={branchId,mode:'v1',generationId:'',epoch:0,revision:0,valid:false};
    let readyPromise=null;
    let configUnsubscribe=null;
    let confirmedV2=false;
    let sessionVersion=0;
    let loadVersion=0;
    let selectionGeneration=0;
    let activeSelectionSignature='';
    let reloadRequired=false;
    let disposed=false;
    let cache={};
    let currentSelection=null;
    let lastConfigNotification='';
    const pendingMutations=new Map();
    let pendingRuntimeConfig=null;
    const diagnosticRows=[];
    const activeControllers=new Set();

    function assertActive(){
      if(disposed) fail('operational-disposed','운영 일정 연결이 종료되었습니다.');
    }

    function nowDate(){
      const value=now();
      return value instanceof Date?value:new Date(value||Date.now());
    }
    function record(kind,outcome,details,error){
      const row={
        at:nowDate().toISOString(),branchId,
        mode:text(config.mode),generationId:text(config.generationId),
        epoch:Math.max(0,Number(config.epoch)||0),revision:Math.max(0,Number(config.revision)||0),
        kind:text(kind),outcome:text(outcome),operationId:text(details?.operationId),
        operationType:text(details?.operationType),keyCount:Math.max(0,Number(details?.keyCount)||0),
        tabCount:Math.max(0,Number(details?.tabCount)||0),code:text(error?.code||details?.code),
      };
      diagnosticRows.push(row);
      if(diagnosticRows.length>MAX_DIAGNOSTICS) diagnosticRows.splice(0,diagnosticRows.length-MAX_DIAGNOSTICS);
      return row;
    }
    function createCallable(input){
      const functions=input.functions||(global.firebase&&typeof global.firebase.functions==='function'?global.firebase.functions():null);
      if(!functions||typeof functions.httpsCallable!=='function'){
        return async()=>fail('operational-callable-unavailable','V2 운영 저장 기능을 사용할 수 없습니다.');
      }
      const invoke=functions.httpsCallable('mutateScheduleV2Operational');
      return async request=>{
        const response=await invoke(request);
        return response?.data;
      };
    }
    function normalizeConfig(value){
      const next=object(value)?clone(value):{};
      next.branchId=text(next.branchId)||branchId;
      next.mode=text(next.mode)||'v1';
      next.generationId=text(next.generationId);
      next.epoch=Math.max(0,Number(next.epoch)||0);
      next.revision=Math.max(0,Number(next.revision)||0);
      next.valid=next.valid!==false;
      if(next.branchId!==branchId) fail('invalid-operational-config','선택한 지점과 운영 설정이 다릅니다.');
      return next;
    }
    function requestReload(next){
      const fingerprint=configFingerprint(next);
      if(fingerprint===lastConfigNotification) return;
      lastConfigNotification=fingerprint;
      reloadRequired=true;
      sessionVersion+=1;
      loadVersion+=1;
      selectionGeneration+=1;
      activeSelectionSignature='';
      cache={};
      currentSelection=null;
      if(typeof v2Store.invalidate==='function') v2Store.invalidate();
      if(typeof options.onReloadRequired==='function'){
        options.onReloadRequired({
          branchId,mode:text(next.mode),generationId:text(next.generationId),
          epoch:Math.max(0,Number(next.epoch)||0),revision:Math.max(0,Number(next.revision)||0),
        });
      }
    }
    function acceptConfig(value,fromSubscription){
      assertActive();
      const next=normalizeConfig(value);
      const before=configFingerprint(config);
      const after=configFingerprint(next);
      const hadConfig=config.valid===true;
      if(hadConfig&&fromSubscription&&before!==after){
        const expected=[...pendingMutations.values()].some(request=>
          next.branchId===request.branchId
          &&next.mode===request.mode
          &&next.generationId===request.generationId
          &&Number(next.epoch)===Number(request.expectedEpoch)
          &&Number(next.revision)===Number(request.beforeRevision)+1
        );
        if(expected){
          pendingRuntimeConfig=next;
          return clone(config);
        }
        requestReload(next);
      }
      config=next;
      if(V2_MODES.has(config.mode)&&config.valid) confirmedV2=true;
      return clone(config);
    }
    function startConfigSubscription(){
      if(disposed||configUnsubscribe||typeof v2Store.subscribeConfig!=='function') return;
      configUnsubscribe=v2Store.subscribeConfig(
        value=>{
          try{ if(!disposed) acceptConfig(value,true); }
          catch(error){ record('config','error',{},error); }
        },
        error=>record('config','error',{},error),
      );
    }
    async function ready(){
      assertActive();
      if(readyPromise) return readyPromise;
      readyPromise=(async()=>{
        try{
          const next=await v2Store.readConfig();
          assertActive();
          acceptConfig(next,false);
          startConfigSubscription();
          return clone(config);
        }catch(error){
          if(error?.code==='operational-disposed') throw error;
          if(confirmedV2) throw Object.assign(new Error('V2 운영 설정을 확인할 수 없어 작업을 중단했습니다.'),{code:'v2-operational-config-failed'});
          config={branchId,mode:'v1',generationId:'',epoch:0,revision:0,valid:false};
          record('config','v1-fallback',{},error);
          return clone(config);
        }
      })();
      try{return await readyPromise;}catch(error){readyPromise=null;throw error;}
    }
    function normalizedSelection(input={}){
      return {
        tabIds:unique(input.tabIds),domains:unique(input.domains),keys:unique(input.keys),
        ...(object(input.dateRange)?{dateRange:clone(input.dateRange)}:{}),
      };
    }
    function selectionSignature(selection){
      return JSON.stringify({
        tabIds:selection.tabIds.slice().sort(),domains:selection.domains.slice().sort(),
        keys:selection.keys.slice().sort(),dateRange:selection.dateRange||null,
      });
    }
    function capture(selection){
      return {
        branchId:text(getBranchId()),generationId:text(config.generationId),
        epoch:Number(config.epoch),revision:Number(config.revision),
        sessionVersion,selectionGeneration,activeSelectionSignature,
        selectionSignature:selectionSignature(selection),
      };
    }
    function assertCurrent(context,selection,code='stale-operational-response'){
      assertActive();
      if(text(getBranchId())!==context.branchId||context.branchId!==branchId
        ||text(config.generationId)!==context.generationId
        ||Number(config.epoch)!==context.epoch
        ||Number(config.revision)!==context.revision
        ||sessionVersion!==context.sessionVersion
        ||selectionGeneration!==context.selectionGeneration
        ||activeSelectionSignature!==context.activeSelectionSignature
        ||selectionSignature(selection)!==context.selectionSignature){
        fail(code,'이전 지점 또는 탭의 운영 결과는 사용하지 않습니다.');
      }
    }
    function mergeCache(values,loadedKeys){
      const allowed=unique(Array.isArray(loadedKeys)?loadedKeys:Object.keys(values||{}));
      allowed.forEach(key=>{
        const present=Object.prototype.hasOwnProperty.call(values||{},key);
        const value=present?values[key]:undefined;
        if(!present||value===undefined||value===null) delete cache[key];
        else cache[key]=clone(value);
      });
    }
    async function verify(values,selection,keys,extra={}){
      if(config.mode!=='verify') return null;
      if(typeof v2Store.verifyParity!=='function') fail('v2-parity-unavailable','V2 일치 검증 기능을 사용할 수 없습니다.');
      const selectedKeys=unique(keys);
      const projected={};
      selectedKeys.forEach(key=>{ if(Object.prototype.hasOwnProperty.call(values||{},key)) projected[key]=clone(values[key]); });
      return v2Store.verifyParity({
        values:projected,selection:{...clone(selection),keys:selectedKeys},keys:selectedKeys,config:clone(config),...clone(extra),
      });
    }
    async function loadSelection(input={}){
      await ready();
      assertActive();
      if(reloadRequired) fail('operational-reload-required','운영 설정이 변경되어 화면을 새로고침해야 합니다.');
      const selection=normalizedSelection(input);
      const token=++loadVersion;
      selectionGeneration+=1;
      activeSelectionSignature=selectionSignature(selection);
      const context=capture(selection);
      const started=nowDate().getTime();
      currentSelection=clone(selection);
      if(V2_MODES.has(config.mode)){
        try{
          const result=await v2Store.loadSelection({...selection,config:clone(config)});
          if(token!==loadVersion) fail('stale-operational-response');
          assertCurrent(context,selection);
          if(!object(result?.root)) fail('invalid-operational-response');
          mergeCache(result.root,result.loadedKeys);
          record('read','ok',{tabCount:selection.tabIds.length,durationMs:nowDate().getTime()-started});
          return {...result,root:clone(result.root),primary:'v2'};
        }catch(error){
          if(error?.code==='stale-operational-selection') fail('stale-operational-response','이전 탭의 운영 결과는 사용하지 않습니다.');
          if(['stale-operational-response','operational-reload-required','operational-disposed'].includes(error?.code)) throw error;
          record('read','v2-read-error',{tabCount:selection.tabIds.length},error);
          throw Object.assign(new Error('V2 운영 데이터를 불러오지 못했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.'),{
            code:'v2-operational-read-failed',cause:error,
          });
        }
      }
      const snapshot=await legacyRoot.once('value');
      if(token!==loadVersion) fail('stale-operational-response');
      assertCurrent(context,selection);
      const root=object(snapshot?.val?.())?snapshot.val():{};
      const verifyKeys=selection.keys.length?selection.keys:selectedKeysForRoot(root,selection);
      await verify(root,selection,verifyKeys);
      if(token!==loadVersion) fail('stale-operational-response');
      assertCurrent(context,selection);
      mergeCache(root,verifyKeys.length?verifyKeys:Object.keys(root));
      record('read','ok',{tabCount:selection.tabIds.length});
      return {root:clone(root),config:clone(config),context,selection:clone(selection),primary:'v1'};
    }
    function ownedTabIdsForKeys(keys){
      const inferred=[];
      keys.forEach(key=>{
        if(['swim_students','swim_inst','swim_attendance','swim_att_guests','swim_day_snapshot'].includes(key)){
          inferred.push('regular');return;
        }
        let match=key.match(/^swim_bt_([A-Za-z0-9_-]+)_(?:stu|inst)$/);
        if(match){ inferred.push(match[1]);return; }
        match=key.match(/^swim_(?:stu|inst)_([A-Za-z0-9_-]+)$/);
        if(match){ inferred.push(match[1]);return; }
        match=key.match(/^swim_bt_(?:attendance|att_guests|day_snapshot)_([A-Za-z0-9_-]+)$/);
        if(match){ inferred.push(match[1]);return; }
        match=key.match(/^zz_swim_day_snapshot__(regular|bt_([A-Za-z0-9_-]+))__\d{4}-\d{2}-\d{2}$/);
        if(match) inferred.push(match[2]||'regular');
      });
      return unique(inferred);
    }
    function inferTabIds(keys,meta){
      const supplied=unique(meta?.tabIds?.length?meta.tabIds:(meta?.tabId?[meta.tabId]:[]));
      if(supplied.length) return supplied;
      const inferred=ownedTabIdsForKeys(keys);
      if(inferred.length) return inferred;
      if(currentSelection?.tabIds?.length) return currentSelection.tabIds.slice();
      return unique(options.defaultTabIds);
    }
    function selectedKeysForRoot(root,selection){
      return Object.keys(root||{}).filter(key=>{
        const domain=model.domainForLegacyKey(key);
        if(!domain||!selection.domains.includes(domain)) return false;
        const owned=ownedTabIdsForKeys([key]);
        return !owned.length||owned.some(tabId=>selection.tabIds.includes(tabId));
      });
    }
    function selectionForKeys(keys,meta={}){
      if(typeof meta.selectionForKeys==='function'){
        const selection=normalizedSelection(meta.selectionForKeys(keys.slice()));
        return {...selection,keys:unique(selection.keys.length?selection.keys:keys)};
      }
      const domains=unique(keys.map(key=>model.domainForLegacyKey(key)));
      return normalizedSelection({tabIds:inferTabIds(keys,meta),domains,keys,dateRange:meta.dateRange});
    }
    async function runMutation(request,context,selection){
      let lastError;
      for(let attempt=0;attempt<maxMutationAttempts;attempt+=1){
        assertCurrent(context,selection);
        try{return await callable(clone(request));}
        catch(error){
          lastError=error;
          const code=text(error?.code).toLowerCase().replace(/^firebase\/functions\//,'').replace(/^functions\//,'');
          if(!RETRYABLE_CODES.has(code)||attempt+1>=maxMutationAttempts) throw error;
        }
      }
      throw lastError;
    }
    function acceptedResponse(response,request){
      return object(response)&&response.committed===true
        &&text(response.operationId)===request.operationId
        &&Number(response.revision)===request.beforeRevision+1;
    }
    async function transactionKeys(keys,mutator,meta={}){
      keys=unique(keys);
      if(!keys.length) return {committed:false,snapshot:new Snapshot(null,{})};
      if(typeof mutator!=='function') throw new TypeError('transaction mutator is required');
      await ready();
      assertActive();
      if(reloadRequired) fail('operational-reload-required','운영 설정이 변경되어 화면을 새로고침해야 합니다.');
      if(V1_MODES.has(config.mode)){
        const selection=selectionForKeys(keys,meta);
        let shadowState=null;
        if(config.mode==='verify'){
          if(typeof v2Store.readShadowState!=='function') fail('v2-parity-unavailable','V2 일치 검증 기능을 사용할 수 없습니다.');
          shadowState=await v2Store.readShadowState();
        }
        const result=await legacyRoot.transactionKeys(keys,mutator);
        if(config.mode==='verify'&&result?.committed){
          const values=object(result.snapshot?.val?.())?result.snapshot.val():{};
          await verify(values,selection,keys,{
            afterShadowRevision:Math.max(0,Number(shadowState?.requestedRevision)||0),requireShadowAdvance:true,
          });
        }
        return result;
      }

      const selection=selectionForKeys(keys,meta);
      const context=capture(selection);
      let loaded;
      try{
        loaded=await v2Store.loadMutation({...selection,keys,config:clone(config)});
      }catch(error){
        if(error?.code==='stale-operational-selection') fail('stale-operational-response','이전 탭의 운영 결과는 사용하지 않습니다.');
        throw error;
      }
      assertCurrent(context,selection);
      if(!object(loaded?.root)) fail('invalid-operational-response');
      const before={};
      keys.forEach(key=>{
        if(Object.prototype.hasOwnProperty.call(loaded.root,key)) before[key]=clone(loaded.root[key]);
      });
      const draft=clone(before);
      const returned=await mutator(draft);
      if(returned===undefined) return {committed:false,snapshot:new Snapshot(null,null)};
      const after=object(returned)?clone(returned):draft;
      const changed=model.changedLegacyKeys(before,after,keys);
      if(!changed.length) return {committed:true,snapshot:new Snapshot(null,after),revision:config.revision};
      const operationId=text(meta.operationId)||text(makeOperationId());
      const operationType=text(meta.operationType)||'edit-schedule';
      if(!operationId||!operationType) fail('invalid-operational-operation','운영 작업 정보를 확인해 주세요.');
      const nextValues={};
      const removedKeys=[];
      changed.forEach(key=>{
        if(!Object.prototype.hasOwnProperty.call(after,key)||after[key]===undefined||after[key]===null) removedKeys.push(key);
        else nextValues[key]=clone(after[key]);
      });
      const request={
        branchId,generationId:context.generationId,expectedEpoch:context.epoch,
        operationId,operationType,keys:changed,beforeRevision:context.revision,
        nextValues,removedKeys,
      };
      const started=nowDate().getTime();
      pendingMutations.set(operationId,{...request,mode:config.mode});
      try{
        const response=await runMutation(request,context,selection);
        assertCurrent(context,selection);
        if(!acceptedResponse(response,request)) fail('invalid-operational-response','서버 저장 결과의 버전을 확인할 수 없습니다.');
        assertCurrent(context,selection);
        changed.forEach(key=>{
          if(removedKeys.includes(key)) delete cache[key];
          else cache[key]=clone(nextValues[key]);
        });
        config={...config,revision:Number(response.revision)};
        pendingRuntimeConfig=null;
        pendingMutations.delete(operationId);
        const resultRoot={...before};
        changed.forEach(key=>{
          if(removedKeys.includes(key)) delete resultRoot[key];
          else resultRoot[key]=clone(nextValues[key]);
        });
        record('write','ok',{operationId,operationType,keyCount:changed.length,durationMs:nowDate().getTime()-started});
        return {
          ...clone(response),committed:true,
          snapshot:new Snapshot(null,resultRoot),
        };
      }catch(error){
        pendingMutations.delete(operationId);
        if(pendingRuntimeConfig){
          const next=pendingRuntimeConfig;
          pendingRuntimeConfig=null;
          requestReload(next);
        }
        record('write','error',{operationId,operationType,keyCount:changed.length},error);
        throw error;
      }
    }
    function child(key){
      key=text(key);
      if(!key) throw new TypeError('child key is required');
      return {
        async once(event,meta={}){
          if(event!=='value') fail('unsupported-event',`Unsupported event: ${event}`);
          await ready();
          if(V1_MODES.has(config.mode)&&typeof legacyRoot.child==='function') return legacyRoot.child(key).once(event);
          if(!Object.prototype.hasOwnProperty.call(cache,key)) await loadSelection(selectionForKeys([key],meta));
          return new Snapshot(key,Object.prototype.hasOwnProperty.call(cache,key)?cache[key]:null);
        },
        set(value,meta={}){ return transactionKeys([key],root=>({...root,[key]:value}),meta); },
        remove(meta={}){ return transactionKeys([key],root=>{ delete root[key];return root; },meta); },
        transaction(mutator,meta={}){
          return transactionKeys([key],root=>{
            const next=mutator(Object.prototype.hasOwnProperty.call(root,key)?clone(root[key]):null);
            if(next===undefined) return undefined;
            if(next===null) delete root[key];
            else root[key]=next;
            return root;
          },meta).then(result=>({
            ...result,
            snapshot:new Snapshot(key,result?.committed?result.snapshot?.val?.()?.[key]:null),
          }));
        },
      };
    }
    async function once(event){
      if(event!=='value') fail('unsupported-event',`Unsupported event: ${event}`);
      await ready();
      if(V1_MODES.has(config.mode)) return legacyRoot.once(event);
      const selection=currentSelection||options.initialSelection;
      if(!selection) fail('operational-selection-required','V2 운영 조회에는 선택한 탭과 데이터 범위가 필요합니다.');
      const loaded=await loadSelection(selection);
      return new Snapshot(null,loaded.root);
    }
    function subscribeSelectedBatches(subscriber={}){
      assertActive();
      if(typeof subscriber.next!=='function') throw new TypeError('batch next callback is required');
      let stopped=false;
      let delegate=null;
      let revision=0;
      let activeKeys=[];
      const auxiliary=new Map();
      function allKeys(base){ return unique([...(base||[]),...activeKeys,...[...auxiliary.values()].flat()]); }
      function selectionForSubscription(keys){
        return selectionForKeys(keys,subscriber);
      }
      async function readBatch(keys){
        if(stopped||disposed) return {stale:true};
        const loaded=await loadSelection(selectionForSubscription(keys));
        if(stopped||disposed) return {stale:true};
        const values={};
        const removedKeys=[];
        keys.forEach(key=>{
          if(Object.prototype.hasOwnProperty.call(loaded.root,key)) values[key]=clone(loaded.root[key]);
          else removedKeys.push(key);
        });
        return {stale:false,values,removedKeys,changedKeys:keys.slice()};
      }
      function publish(batch,initial){
        if(batch.stale||stopped||disposed) return {stale:true};
        subscriber.next({
          initial:!!initial,revision:++revision,values:batch.values,
          removedKeys:batch.removedKeys,changedKeys:batch.changedKeys,
        });
        return {stale:false};
      }
      async function emit(keys,initial){
        return publish(await readBatch(keys),initial);
      }
      const baseKeys=unique(subscriber.baseKeys);
      const readyController=(async()=>{
        await ready();
        if(stopped||disposed) return {stale:true};
        if(V1_MODES.has(config.mode)&&typeof legacyRoot.subscribeSelectedBatches==='function'){
          delegate=legacyRoot.subscribeSelectedBatches(subscriber);
          if(stopped||disposed){ delegate?.stop?.();delegate=null;return {stale:true}; }
          return delegate.ready;
        }
        const baseBatch=await readBatch(baseKeys);
        if(baseBatch.stale) return baseBatch;
        const baseValues=clone(baseBatch.values);
        activeKeys=unique(typeof subscriber.resolveInitialActiveKeys==='function'?subscriber.resolveInitialActiveKeys(baseValues):[]);
        const initialKeys=unique([...baseKeys,...activeKeys]);
        const initialBatch=activeKeys.length?await readBatch(initialKeys):baseBatch;
        return publish(initialBatch,true);
      })();
      function withDelegate(method,fallback){
        return (...args)=>readyController.then(result=>{
          if(stopped||disposed||result?.stale) return {stale:true};
          return delegate&&typeof delegate[method]==='function'?delegate[method](...args):fallback(...args);
        });
      }
      const controller={
        ready:readyController,
        setActiveKeys:withDelegate('setActiveKeys',async keys=>{activeKeys=unique(keys);return emit(allKeys(baseKeys),false);}),
        setAuxiliaryKeys:withDelegate('setAuxiliaryKeys',async(owner,keys)=>{auxiliary.set(text(owner),unique(keys));return emit(allKeys(baseKeys),false);}),
        releaseAuxiliaryKeys(owner){
          if(delegate?.releaseAuxiliaryKeys) return delegate.releaseAuxiliaryKeys(owner);
          auxiliary.delete(text(owner));
        },
        waitForActive:withDelegate('waitForActive',async keys=>emit(unique(keys),false)),
        stop(){
          if(stopped) return;
          stopped=true;loadVersion+=1;selectionGeneration+=1;
          if(typeof v2Store.invalidate==='function') v2Store.invalidate();
          if(delegate?.stop) delegate.stop();
          delegate=null;activeControllers.delete(controller);
        },
      };
      activeControllers.add(controller);
      readyController.catch(error=>{ if(!stopped&&typeof subscriber.error==='function') subscriber.error(error); });
      return controller;
    }
    function currentConfig(){ return clone(config); }
    function diagnostics(limit){
      const count=Math.max(0,Math.min(MAX_DIAGNOSTICS,Number(limit)||MAX_DIAGNOSTICS));
      return clone(diagnosticRows.slice(-count));
    }
    function dispose(){
      if(disposed) return;
      disposed=true;sessionVersion+=1;loadVersion+=1;selectionGeneration+=1;
      if(typeof v2Store.invalidate==='function') v2Store.invalidate();
      [...activeControllers].forEach(controller=>controller.stop());
      activeControllers.clear();
      if(configUnsubscribe){
        const unsubscribe=configUnsubscribe;configUnsubscribe=null;unsubscribe();
      }
      pendingMutations.clear();pendingRuntimeConfig=null;
    }

    return Object.freeze({
      ready,loadSelection,child,once,transactionKeys,subscribeSelectedBatches,currentConfig,diagnostics,dispose,
    });
  }

  return Object.freeze({create,MAX_DIAGNOSTICS});
});
