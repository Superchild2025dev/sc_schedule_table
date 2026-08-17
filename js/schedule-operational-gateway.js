(function(global,factory){
  'use strict';
  const api=factory(global);
  if(typeof module==='object'&&module.exports) module.exports=api;
  global.SCOperationalSchedule=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(global){
  'use strict';

  const V2_MODES=new Set(['v2-read','v2']);
  const V1_MODES=new Set(['v1','shadow','verify']);
  const GENERATION_ID_RE=/^[A-Za-z0-9_-]{1,128}$/;
  const AUTHORITY_MODES=new Set([...V1_MODES,...V2_MODES]);
  const RETRYABLE_CODES=new Set(['cancelled','deadline-exceeded','internal','resource-exhausted','unavailable']);
  const AMBIGUOUS_TERMINAL_CODES=new Set([...RETRYABLE_CODES,'data-loss','unknown']);
  const MAX_DIAGNOSTICS=80;
  let operationSequence=0;

  function text(value){ return String(value==null?'':value).trim(); }
  function clone(value){ return value==null?value:JSON.parse(JSON.stringify(value)); }
  function object(value){ return !!value&&typeof value==='object'&&!Array.isArray(value); }
  function owns(value,key){ return Object.prototype.hasOwnProperty.call(value,key); }
  function unique(values){ return [...new Set((Array.isArray(values)?values:[]).map(text).filter(Boolean))]; }
  function fail(code,message){ throw Object.assign(new Error(message||code),{code}); }
  function sameValue(left,right){
    try{return JSON.stringify(left)===JSON.stringify(right);}catch(error){return false;}
  }
  const MISSING=Object.freeze({});
  function parsedJson(value){
    if(typeof value!=='string') return {ok:false,value:null};
    try{return {ok:true,value:JSON.parse(value)};}catch(error){return {ok:false,value:null};}
  }
  function rebaseValue(before,after,fresh){
    if(before===MISSING&&after===MISSING) return MISSING;
    if(sameValue(before,after)) return fresh===MISSING?MISSING:clone(fresh);
    const parsedBefore=parsedJson(before);
    const parsedAfter=parsedJson(after);
    const parsedFresh=parsedJson(fresh);
    if(parsedBefore.ok&&parsedAfter.ok&&parsedFresh.ok){
      return JSON.stringify(rebaseValue(parsedBefore.value,parsedAfter.value,parsedFresh.value));
    }
    const beforeObject=object(before);
    const afterObject=object(after);
    const freshObject=object(fresh);
    if(beforeObject&&afterObject&&freshObject){
      const result=clone(fresh);
      const keys=new Set([...Object.keys(before),...Object.keys(after)]);
      for(const key of keys){
        const hasBefore=Object.prototype.hasOwnProperty.call(before,key);
        const hasAfter=Object.prototype.hasOwnProperty.call(after,key);
        const hasFresh=Object.prototype.hasOwnProperty.call(fresh,key);
        const next=rebaseValue(
          hasBefore?before[key]:MISSING,
          hasAfter?after[key]:MISSING,
          hasFresh?fresh[key]:MISSING,
        );
        if(next===MISSING) delete result[key];
        else result[key]=next;
      }
      return result;
    }
    if(Array.isArray(before)&&Array.isArray(after)&&Array.isArray(fresh)
      &&before.length===after.length&&before.length===fresh.length){
      return before.map((value,index)=>rebaseValue(value,after[index],fresh[index]));
    }
    if(sameValue(fresh,before)||sameValue(fresh,after)) return after===MISSING?MISSING:clone(after);
    fail('aborted','A newer operational edit overlaps this change.');
  }
  function rebaseRoot(before,after,fresh){
    return rebaseValue(before,after,fresh);
  }
  function authorityFingerprint(config){
    return [text(config?.branchId),text(config?.mode),text(config?.generationId),Number(config?.epoch)||0].join('|');
  }
  function callableCode(error){
    return text(error?.code).toLowerCase().replace(/^firebase\/functions\//,'').replace(/^functions\//,'');
  }
  function sameRebaseAuthority(left,right){
    return text(left?.branchId)===text(right?.branchId)
      &&text(left?.mode)===text(right?.mode)
      &&text(left?.generationId)===text(right?.generationId)
      &&Number(left?.epoch||0)===Number(right?.epoch||0);
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
    const maxConflictAttempts=Math.max(1,Math.min(3,Number(options.maxConflictAttempts||3)||3));
    const conflictRetryDelayMs=Math.max(0,Math.min(250,Number(options.conflictRetryDelayMs??30)||0));
    const sleep=typeof options.sleep==='function'
      ?options.sleep
      :milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
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
    const unknownConfig=()=>({branchId,mode:'unknown',generationId:'',epoch:0,revision:0,valid:false});
    let config=unknownConfig();
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
    const selectionOwners=new Map();
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
      if(!object(value)) fail('invalid-operational-config','운영 전환 설정을 확인할 수 없습니다.');
      const required=['branchId','mode','generationId','epoch','revision','valid'];
      if(required.some(key=>!owns(value,key))
        ||typeof value.branchId!=='string'||typeof value.mode!=='string'
        ||typeof value.generationId!=='string'
        ||typeof value.epoch!=='number'||typeof value.revision!=='number'
        ||typeof value.valid!=='boolean'
        ||value.branchId!==text(value.branchId)||value.mode!==text(value.mode)
        ||value.generationId!==text(value.generationId)
        ||(value.generationId!==''&&!GENERATION_ID_RE.test(value.generationId))){
        fail('invalid-operational-config','운영 전환 설정이 올바르지 않습니다.');
      }
      const next=clone(value);
      next.branchId=text(next.branchId);
      next.mode=text(next.mode);
      next.generationId=text(next.generationId);
      next.epoch=value.epoch;
      next.revision=value.revision;
      next.valid=next.valid===true;
      if(next.branchId!==branchId) fail('invalid-operational-config','선택한 지점과 운영 설정이 다릅니다.');
      if(!next.valid||!AUTHORITY_MODES.has(next.mode)
        ||!Number.isSafeInteger(next.epoch)||next.epoch<0
        ||!Number.isSafeInteger(next.revision)||next.revision<0
        ||(next.mode!=='v1'&&!next.generationId)){
        fail('invalid-operational-config','운영 전환 설정이 올바르지 않습니다.');
      }
      return next;
    }
    function revokeAuthority(error){
      const hadAuthority=config.valid===true;
      config=unknownConfig();
      pendingRuntimeConfig=null;
      record('config','authority-unavailable',{},error);
      if(hadAuthority) requestReload(config);
    }
    function assertReadableAuthority(){
      if(confirmedV2&&!config.valid){
        fail('v2-operational-config-failed','V2 운영 설정을 확인할 수 없어 작업을 중단했습니다.');
      }
    }
    function assertWriteAuthority(){
      if(!config.valid||!AUTHORITY_MODES.has(config.mode)){
        fail('operational-authority-unavailable','운영 저장 권한을 확인할 수 없어 읽기 전용으로 전환했습니다.');
      }
    }
    function requestReload(next){
      const fingerprint=authorityFingerprint(next);
      if(reloadRequired||fingerprint===lastConfigNotification) return;
      lastConfigNotification=fingerprint;
      reloadRequired=true;
      sessionVersion+=1;
      loadVersion+=1;
      selectionGeneration+=1;
      activeSelectionSignature='';
      cache={};
      currentSelection=null;
      selectionOwners.clear();
      pendingMutations.clear();
      pendingRuntimeConfig=null;
      [...activeControllers].forEach(controller=>controller.stop(true));
      activeControllers.clear();
      if(configUnsubscribe){
        const unsubscribe=configUnsubscribe;
        configUnsubscribe=null;
        unsubscribe();
      }
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
      const before=authorityFingerprint(config);
      const after=authorityFingerprint(next);
      const hadConfig=config.valid===true;
      if(hadConfig&&fromSubscription){
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
        if(before!==after){
          config=next;
          if(V2_MODES.has(config.mode)&&config.valid) confirmedV2=true;
          requestReload(next);
          return clone(config);
        }
        if(Number(config.revision)!==Number(next.revision)) cache={};
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
          catch(error){ if(!disposed) revokeAuthority(error); }
        },
        error=>{ if(!disposed) revokeAuthority(error); },
      );
    }
    async function ready(){
      assertActive();
      if(config.valid) return clone(config);
      if(readyPromise) return readyPromise;
      readyPromise=(async()=>{
        try{
          startConfigSubscription();
          const next=await v2Store.readConfig();
          assertActive();
          acceptConfig(next,false);
          return clone(config);
        }catch(error){
          if(error?.code==='operational-disposed') throw error;
          if(config.valid) return clone(config);
          if(confirmedV2) throw Object.assign(new Error('V2 운영 설정을 확인할 수 없어 작업을 중단했습니다.'),{code:'v2-operational-config-failed'});
          config=unknownConfig();
          record('config','read-only-fallback',{},error);
          return clone(config);
        }
      })();
      try{
        const result=await readyPromise;
        if(!result?.valid) readyPromise=null;
        return result;
      }catch(error){readyPromise=null;throw error;}
    }
    function normalizedSelection(input={}){
      return {
        tabIds:unique(input.tabIds),domains:unique(input.domains),keys:unique(input.keys),
        owner:text(input.owner)||'schedule-main',
        ...(object(input.dateRange)?{dateRange:clone(input.dateRange)}:{}),
      };
    }
    function selectionSignature(selection){
      return JSON.stringify({
        tabIds:selection.tabIds.slice().sort(),domains:selection.domains.slice().sort(),
        keys:selection.keys.slice().sort(),dateRange:selection.dateRange||null,
      });
    }
    function beginSelection(selection){
      const owner=text(selection?.owner)||'schedule-main';
      const state=selectionOwners.get(owner)||{version:0,signature:''};
      const next={version:state.version+1,signature:selectionSignature(selection)};
      selectionOwners.set(owner,next);
      return {owner,version:next.version,signature:next.signature};
    }
    function cancelSelection(owner){
      const key=text(owner)||'schedule-main';
      const state=selectionOwners.get(key)||{version:0,signature:''};
      selectionOwners.set(key,{...state,version:state.version+1});
    }
    function selectionIsCurrent(token){
      const state=selectionOwners.get(token.owner);
      return !!state&&state.version===token.version&&state.signature===token.signature;
    }
    function capture(selection,token){
      token=token||beginSelection(selection);
      return {
        branchId:text(getBranchId()),generationId:text(config.generationId),
        epoch:Number(config.epoch),revision:Number(config.revision),
        sessionVersion,selectionOwner:token.owner,selectionVersion:token.version,
        activeSelectionSignature:token.signature,
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
        ||!selectionIsCurrent({
          owner:context.selectionOwner,version:context.selectionVersion,
          signature:context.activeSelectionSignature,
        })
        ||selectionSignature(selection)!==context.selectionSignature){
        fail(code,'이전 지점 또는 탭의 운영 결과는 사용하지 않습니다.');
      }
    }
    function assertMutationAuthority(context){
      assertActive();
      if(text(getBranchId())!==context.branchId||context.branchId!==branchId
        ||text(config.generationId)!==context.generationId
        ||Number(config.epoch)!==context.epoch
        ||sessionVersion!==context.sessionVersion){
        fail('stale-operational-response','이전 지점 또는 운영 세대의 저장 결과는 현재 화면에 반영하지 않습니다.');
      }
    }
    function selectionMatchesVisibleTab(selection){
      if(!currentSelection?.tabIds?.length||!selection?.tabIds?.length) return true;
      return selection.tabIds.some(tabId=>currentSelection.tabIds.includes(tabId));
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
      assertReadableAuthority();
      if(reloadRequired) fail('operational-reload-required','운영 설정이 변경되어 화면을 새로고침해야 합니다.');
      const selection=normalizedSelection(input);
      const token=beginSelection(selection);
      const context=capture(selection,token);
      const started=nowDate().getTime();
      if(selection.owner==='schedule-main') currentSelection=clone(selection);
      if(V2_MODES.has(config.mode)){
        try{
          const result=await v2Store.loadSelection({...selection,config:clone(config)});
          if(!selectionIsCurrent(token)) fail('stale-operational-response');
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
      if(!selectionIsCurrent(token)) fail('stale-operational-response');
      assertCurrent(context,selection);
      const root=object(snapshot?.val?.())?snapshot.val():{};
      const verifyKeys=selection.keys.length?selection.keys:selectedKeysForRoot(root,selection);
      await verify(root,selection,verifyKeys);
      if(!selectionIsCurrent(token)) fail('stale-operational-response');
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
        const supplied=meta.selectionForKeys(keys.slice())||{};
        const selection=normalizedSelection({...supplied,owner:supplied.owner||meta.owner});
        return {...selection,keys:unique(selection.keys.length?selection.keys:keys)};
      }
      const domains=unique(keys.map(key=>model.domainForLegacyKey(key)));
      return normalizedSelection({
        tabIds:inferTabIds(keys,meta),domains,keys,dateRange:meta.dateRange,owner:meta.owner,
      });
    }
    async function runMutation(request,context,selection){
      let lastError;
      for(let attempt=0;attempt<maxMutationAttempts;attempt+=1){
        assertCurrent(context,selection);
        try{return await callable(clone(request));}
        catch(error){
          lastError=error;
          const code=callableCode(error);
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
      if(typeof mutator!=='function') throw new TypeError('transaction mutator is required');
      await ready();
      assertWriteAuthority();
      if(V1_MODES.has(config.mode)) return transactionKeysOnce(keys,mutator,meta);

      let originalBefore=null;
      let originalAfter=null;
      const stableOperationId=text(meta.operationId)||text(makeOperationId());
      const attemptMeta={
        ...meta,operationId:stableOperationId,
        owner:text(meta.owner)||`schedule-mutation:${stableOperationId}`,
        rebaseConflict:true,
      };
      const captureIntent=async root=>{
        originalBefore=clone(root);
        const returned=await mutator(root);
        if(returned===undefined) return undefined;
        originalAfter=object(returned)?clone(returned):clone(root);
        return returned;
      };
      let applyIntent=captureIntent;
      let previousRevision=Number(config.revision)||0;
      for(let attempt=0;attempt<maxConflictAttempts;attempt+=1){
        try{
          return await transactionKeysOnce(keys,applyIntent,attemptMeta);
        }catch(error){
          const code=callableCode(error);
          if(!['aborted','failed-precondition','stale-operational-selection'].includes(code)
            ||attempt+1>=maxConflictAttempts) throw error;
          let next=normalizeConfig(await v2Store.readConfig());
          if(!sameRebaseAuthority(config,next)){
            config=next;
            requestReload(next);
            fail('operational-reload-required','Operational authority changed before retry.');
          }
          if(code==='aborted'&&Number(next.revision)<=previousRevision){
            await sleep(conflictRetryDelayMs*(attempt+1));
            next=normalizeConfig(await v2Store.readConfig());
            if(!sameRebaseAuthority(config,next)){
              config=next;
              requestReload(next);
              fail('operational-reload-required','Operational authority changed before retry.');
            }
          }
          if(code==='failed-precondition'&&Number(next.revision)<=previousRevision) throw error;
          previousRevision=Math.max(previousRevision,Number(next.revision));
          pendingRuntimeConfig=null;
          acceptConfig(next,false);
          applyIntent=originalBefore===null||originalAfter===null
            ?captureIntent
            :root=>rebaseRoot(originalBefore,originalAfter,root);
        }
      }
      fail('aborted','The operational edit could not be rebased safely.');
    }
    async function transactionKeysOnce(keys,mutator,meta={}){
      keys=unique(keys);
      if(!keys.length) return {committed:false,snapshot:new Snapshot(null,{})};
      if(typeof mutator!=='function') throw new TypeError('transaction mutator is required');
      await ready();
      assertActive();
      assertWriteAuthority();
      if(reloadRequired) fail('operational-reload-required','운영 설정이 변경되어 화면을 새로고침해야 합니다.');
      if(V1_MODES.has(config.mode)){
        const selection=selectionForKeys(keys,meta);
        let shadowState=null;
        let transactionBefore=null;
        const trackedMutator=current=>{
          transactionBefore=clone(object(current)?current:{});
          return mutator(current);
        };
        if(config.mode==='verify'){
          if(typeof v2Store.readShadowState!=='function') fail('v2-parity-unavailable','V2 일치 검증 기능을 사용할 수 없습니다.');
          shadowState=await v2Store.readShadowState();
        }
        const result=await legacyRoot.transactionKeys(keys,config.mode==='verify'?trackedMutator:mutator);
        if(config.mode==='verify'&&result?.committed){
          const values=object(result.snapshot?.val?.())?result.snapshot.val():{};
          const changed=model.changedLegacyKeys(transactionBefore||{},values,keys);
          await verify(values,selection,keys,{
            afterShadowRevision:Math.max(0,Number(shadowState?.requestedRevision)||0),
            requireShadowAdvance:changed.length>0,
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
      const requireOperationManifest=meta.requireOperationManifest===true;
      if(!changed.length&&!requireOperationManifest) return {committed:true,snapshot:new Snapshot(null,after),revision:config.revision};
      const operationKeys=changed.length?changed:keys.slice();
      const operationId=text(meta.operationId)||text(makeOperationId());
      const operationType=text(meta.operationType)||'edit-schedule';
      if(!operationId||!operationType) fail('invalid-operational-operation','운영 작업 정보를 확인해 주세요.');
      const nextValues={};
      const removedKeys=[];
      operationKeys.forEach(key=>{
        if(!Object.prototype.hasOwnProperty.call(after,key)||after[key]===undefined||after[key]===null) removedKeys.push(key);
        else nextValues[key]=clone(after[key]);
      });
      const request={
        branchId,generationId:context.generationId,expectedEpoch:context.epoch,
        operationId,operationType,keys:operationKeys,beforeRevision:context.revision,
        nextValues,removedKeys,
      };
      const started=nowDate().getTime();
      const pendingRequest={...request,mode:config.mode};
      pendingMutations.set(operationId,pendingRequest);
      let responseReceived=false;
      try{
        const response=await runMutation(request,context,selection);
        responseReceived=true;
        if(!acceptedResponse(response,request)) fail('invalid-operational-response','서버 저장 결과의 버전을 확인할 수 없습니다.');
        assertMutationAuthority(context);
        if(selectionMatchesVisibleTab(selection)){
          changed.forEach(key=>{
            if(removedKeys.includes(key)) delete cache[key];
            else cache[key]=clone(nextValues[key]);
          });
        }else changed.forEach(key=>delete cache[key]);
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
        if(!responseReceived&&AMBIGUOUS_TERMINAL_CODES.has(callableCode(error))){
          pendingRuntimeConfig=null;
          try{
            const next=normalizeConfig(await v2Store.readConfig());
            pendingRuntimeConfig=null;
            const authorityChanged=authorityFingerprint(next)!==authorityFingerprint({
              branchId:pendingRequest.branchId,
              mode:pendingRequest.mode,
              generationId:pendingRequest.generationId,
              epoch:pendingRequest.expectedEpoch,
              revision:pendingRequest.beforeRevision,
            });
            acceptConfig(next,false);
            if(authorityChanged) requestReload(next);
          }catch(authorityError){
            revokeAuthority(authorityError);
          }
        }else if(pendingRuntimeConfig&&!meta.rebaseConflict){
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
          assertReadableAuthority();
          if(!V2_MODES.has(config.mode)&&typeof legacyRoot.child==='function') return legacyRoot.child(key).once(event);
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
      assertReadableAuthority();
      if(!V2_MODES.has(config.mode)) return legacyRoot.once(event);
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
      const subscriptionOwner=text(subscriber.owner)||'schedule-main';
      function allKeys(base){ return unique([...(base||[]),...activeKeys,...[...auxiliary.values()].flat()]); }
      function selectionForSubscription(keys){
        return selectionForKeys(keys,{...subscriber,owner:subscriptionOwner});
      }
      async function readBatch(keys){
        if(stopped||disposed||reloadRequired) return {stale:true};
        const loaded=await loadSelection(selectionForSubscription(keys));
        if(stopped||disposed||reloadRequired) return {stale:true};
        const values={};
        const removedKeys=[];
        keys.forEach(key=>{
          if(Object.prototype.hasOwnProperty.call(loaded.root,key)) values[key]=clone(loaded.root[key]);
          else removedKeys.push(key);
        });
        return {stale:false,values,removedKeys,changedKeys:keys.slice()};
      }
      function publish(batch,initial){
        if(batch.stale||stopped||disposed||reloadRequired) return {stale:true};
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
        if(stopped||disposed||reloadRequired) return {stale:true};
        assertReadableAuthority();
        if(!V2_MODES.has(config.mode)&&typeof legacyRoot.subscribeSelectedBatches==='function'){
          const guardedSubscriber={
            ...subscriber,
            next(batch){ if(!stopped&&!disposed&&!reloadRequired) subscriber.next(batch); },
            error(error){ if(!stopped&&!disposed&&!reloadRequired&&typeof subscriber.error==='function') subscriber.error(error); },
          };
          delegate=legacyRoot.subscribeSelectedBatches(guardedSubscriber);
          if(stopped||disposed||reloadRequired){ delegate?.stop?.();delegate=null;return {stale:true}; }
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
          if(stopped||disposed||reloadRequired||result?.stale) return {stale:true};
          return delegate&&typeof delegate[method]==='function'?delegate[method](...args):fallback(...args);
        });
      }
      const controller={
        ready:readyController,
        setActiveKeys:withDelegate('setActiveKeys',async keys=>{activeKeys=unique(keys);return emit(allKeys(baseKeys),false);}),
        setAuxiliaryKeys:withDelegate('setAuxiliaryKeys',async(owner,keys)=>{auxiliary.set(text(owner),unique(keys));return emit(allKeys(baseKeys),false);}),
        releaseAuxiliaryKeys(owner){
          if(stopped||disposed||reloadRequired) return;
          if(delegate?.releaseAuxiliaryKeys) return delegate.releaseAuxiliaryKeys(owner);
          auxiliary.delete(text(owner));
        },
        waitForActive:withDelegate('waitForActive',async keys=>emit(unique(keys),false)),
        stop(skipInvalidation){
          if(stopped) return;
          stopped=true;cancelSelection(subscriptionOwner);
          if(!skipInvalidation&&typeof v2Store.invalidate==='function') v2Store.invalidate(subscriptionOwner);
          if(delegate?.stop) delegate.stop();
          delegate=null;activeControllers.delete(controller);
        },
      };
      activeControllers.add(controller);
      readyController.catch(error=>{
        if(!stopped&&!reloadRequired&&typeof subscriber.error==='function') subscriber.error(error);
      });
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
      selectionOwners.clear();
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
