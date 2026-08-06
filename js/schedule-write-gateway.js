(function(global,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  global.SCScheduleWriteGateway=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  let operationSeq=0;

  function text(value){
    return String(value==null?'':value).trim();
  }

  function uniqueKeys(keys){
    return [...new Set((Array.isArray(keys)?keys:[keys]).map(text).filter(Boolean))];
  }

  function defaultId(){
    operationSeq=(operationSeq+1)%1000000;
    return `write_${Date.now().toString(36)}_${operationSeq.toString(36)}`;
  }

  function errorCode(error){
    return text(error&&(error.code||error.name))||'unknown';
  }

  function blockedError(reason){
    const error=reason instanceof Error?reason:new Error(text(reason)||'저장이 차단되었습니다');
    if(!error.code) error.code='write-blocked';
    return error;
  }

  function create(options){
    options=options||{};
    if(typeof options.getRoot!=='function') throw new TypeError('getRoot is required');

    const history=[];
    const maxRecent=Math.max(10,Math.min(500,Number(options.maxRecent||80)||80));
    const makeId=typeof options.makeId==='function'?options.makeId:defaultId;
    const now=typeof options.now==='function'?options.now:()=>new Date().toISOString();

    function remember(operation){
      history.push(operation);
      while(history.length>maxRecent) history.shift();
    }

    function permission(keys,meta){
      if(typeof options.canWrite!=='function') return null;
      try{
        const result=options.canWrite(keys.slice(),meta||{});
        if(result===false) return blockedError();
        if(typeof result==='string'||result instanceof Error) return blockedError(result);
        return null;
      }catch(error){
        return blockedError(error);
      }
    }

    function root(){
      const value=options.getRoot();
      if(value) return value;
      const error=new Error('Firebase 저장소가 준비되지 않았습니다');
      error.code='write-root-unavailable';
      throw error;
    }

    async function report(error,meta){
      if(typeof options.reportFailure==='function'){
        try{ options.reportFailure(error,meta); }catch(reportError){}
      }
      if(typeof options.refreshAfterFailure==='function'){
        try{ await options.refreshAfterFailure(meta.keys.slice(),meta,error); }catch(refreshError){}
      }
    }

    async function run(kind,keys,executor,meta){
      const normalizedKeys=uniqueKeys(keys);
      if(!normalizedKeys.length) throw new TypeError('at least one storage key is required');
      const operation={
        id:text(makeId())||defaultId(),
        kind,
        keys:normalizedKeys.slice(),
        label:text(meta&&meta.label),
        startedAt:now(),
        finishedAt:'',
        status:'pending',
        code:'',
      };
      remember(operation);

      const denied=permission(normalizedKeys,meta);
      if(denied){
        operation.status='failed';
        operation.finishedAt=now();
        operation.code=errorCode(denied);
        const reportMeta={...(meta||{}),operationId:operation.id,kind,keys:normalizedKeys.slice()};
        await report(denied,reportMeta);
        throw denied;
      }

      try{
        const result=await executor(root(),normalizedKeys);
        operation.status='success';
        operation.finishedAt=now();
        return result;
      }catch(error){
        operation.status='failed';
        operation.finishedAt=now();
        operation.code=errorCode(error);
        const reportMeta={...(meta||{}),operationId:operation.id,kind,keys:normalizedKeys.slice()};
        await report(error,reportMeta);
        throw error;
      }
    }

    function set(key,value,meta){
      return run('set',[key],storageRoot=>{
        const ref=storageRoot.child(key);
        if(!ref||typeof ref.set!=='function') throw new TypeError('storage set is unavailable');
        return ref.set(value);
      },meta);
    }

    function remove(key,meta){
      return run('remove',[key],storageRoot=>{
        const ref=storageRoot.child(key);
        if(!ref||typeof ref.remove!=='function') throw new TypeError('storage remove is unavailable');
        return ref.remove();
      },meta);
    }

    function transaction(keys,updateFn,meta){
      if(typeof updateFn!=='function') return Promise.reject(new TypeError('transaction update function is required'));
      return run('transaction',keys,(storageRoot,normalizedKeys)=>{
        if(typeof storageRoot.transactionKeys==='function'){
          return storageRoot.transactionKeys(normalizedKeys,updateFn);
        }
        if(typeof storageRoot.transaction==='function'){
          return storageRoot.transaction(updateFn);
        }
        throw new TypeError('storage transaction is unavailable');
      },meta);
    }

    function recent(limit){
      const size=Math.max(1,Math.min(maxRecent,Number(limit||20)||20));
      return history.slice(-size).map(item=>({...item,keys:item.keys.slice()}));
    }

    return {set,remove,transaction,recent};
  }

  return {create};
});
