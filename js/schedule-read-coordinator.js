(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.SCScheduleReadCoordinator=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function asFunction(value,fallback){
    return typeof value==='function'?value:fallback;
  }

  function rawValue(value){
    if(typeof value==='string') return value;
    const encoded=JSON.stringify(value);
    return encoded===undefined?'null':encoded;
  }

  function create(options){
    const opts=options&&typeof options==='object'?options:{};
    const getRaw=asFunction(opts.getRaw,()=>null);
    const setRaw=asFunction(opts.setRaw,()=>{});
    const removeRaw=asFunction(opts.removeRaw,()=>{});
    const validate=asFunction(opts.validate,()=>true);
    const isRenderBlocked=asFunction(opts.isRenderBlocked,()=>false);
    const onRender=asFunction(opts.onRender,()=>{});
    const onInvalid=asFunction(opts.onInvalid,()=>{});
    const onError=asFunction(opts.onError,()=>{});
    const isCurrent=asFunction(opts.isCurrent,()=>true);
    const state={
      started:false,
      stopped:false,
      unsubscribe:null,
      lastAppliedRevision:0,
      pendingRenderKeys:new Set(),
      readyResolved:false,
      readyRejected:false,
      diagnostics:[],
    };
    let resolveReady;
    let rejectReady;
    const readyPromise=new Promise((resolve,reject)=>{
      resolveReady=resolve;
      rejectReady=reject;
    });

    function record(type,details){
      state.diagnostics.push(Object.assign({type,at:Date.now()},details||{}));
      if(state.diagnostics.length>100) state.diagnostics.splice(0,state.diagnostics.length-100);
    }

    function reportError(error,meta){
      const actual=error instanceof Error?error:new Error(String(error||'Schedule read failed'));
      record('error',{message:actual.message,revision:meta&&meta.revision||0});
      try{ onError(actual,meta||{}); }catch(ignored){}
      if(!state.readyResolved&&!state.readyRejected){
        state.readyRejected=true;
        rejectReady(actual);
      }
    }

    function accept(batch){
      if(state.stopped) return false;
      const source=batch&&typeof batch==='object'?batch:{};
      let current=false;
      try{ current=isCurrent(source)!==false; }catch(error){ current=false; }
      if(!current){
        record('stale-context',{revision:Number(source.revision)||0});
        return false;
      }
      const revision=Number(source.revision);
      const nextRevision=Number.isFinite(revision)&&revision>0
        ?revision
        :state.lastAppliedRevision+1;
      if(nextRevision<=state.lastAppliedRevision){
        record('stale',{revision:nextRevision,lastAppliedRevision:state.lastAppliedRevision});
        return false;
      }

      const values=source.values&&typeof source.values==='object'?source.values:{};
      const removedKeys=Array.isArray(source.removedKeys)?source.removedKeys:[];
      const validValues=[];
      const invalidKeys=[];
      Object.keys(values).forEach(key=>{
        const raw=rawValue(values[key]);
        let valid=false;
        try{ valid=validate(key,raw)!==false; }catch(error){ valid=false; }
        if(valid) validValues.push([key,raw]);
        else invalidKeys.push(key);
      });

      const changedKeys=new Set();
      try{
        validValues.forEach(([key,raw])=>{
          if(getRaw(key)===raw) return;
          setRaw(key,raw);
          changedKeys.add(key);
        });
        removedKeys.forEach(value=>{
          const key=String(value==null?'':value);
          if(!key||getRaw(key)==null) return;
          removeRaw(key);
          changedKeys.add(key);
        });
      }catch(error){
        reportError(error,{phase:'apply',revision:nextRevision,initial:!!source.initial});
        return false;
      }

      state.lastAppliedRevision=nextRevision;
      const meta={
        initial:!!source.initial,
        revision:nextRevision,
        invalidKeys:invalidKeys.slice(),
      };
      if(invalidKeys.length){
        record('invalid',{revision:nextRevision,keys:invalidKeys.slice()});
        try{ onInvalid(invalidKeys.slice(),meta); }catch(error){ reportError(error,meta); }
      }

      if(source.initial&&!state.readyResolved&&!state.readyRejected){
        state.readyResolved=true;
        resolveReady(meta);
      }

      if(!source.initial&&changedKeys.size){
        changedKeys.forEach(key=>state.pendingRenderKeys.add(key));
        if(!isRenderBlocked()) flush(meta);
      }
      record('applied',{
        revision:nextRevision,
        initial:!!source.initial,
        changedKeys:[...changedKeys],
        invalidKeys:invalidKeys.slice(),
      });
      return true;
    }

    function flush(meta){
      if(state.stopped||!state.pendingRenderKeys.size||isRenderBlocked()) return false;
      const keys=[...state.pendingRenderKeys];
      state.pendingRenderKeys.clear();
      const renderMeta=Object.assign({
        initial:false,
        revision:state.lastAppliedRevision,
        flushed:true,
      },meta||{});
      try{
        onRender(keys,renderMeta);
        record('rendered',{revision:renderMeta.revision,keys:keys.slice()});
        return true;
      }catch(error){
        keys.forEach(key=>state.pendingRenderKeys.add(key));
        reportError(error,Object.assign({phase:'render'},renderMeta));
        return false;
      }
    }

    function start(subscribe){
      if(state.started||state.stopped) return api;
      if(typeof subscribe!=='function') throw new TypeError('subscribe must be a function');
      state.started=true;
      try{
        const unsubscribe=subscribe({next:accept,error:error=>reportError(error,{phase:'subscribe'})});
        state.unsubscribe=typeof unsubscribe==='function'?unsubscribe:null;
      }catch(error){
        reportError(error,{phase:'subscribe'});
      }
      return api;
    }

    function stop(){
      if(state.stopped) return;
      state.stopped=true;
      if(state.unsubscribe){
        const unsubscribe=state.unsubscribe;
        state.unsubscribe=null;
        try{ unsubscribe(); }catch(error){ reportError(error,{phase:'unsubscribe'}); }
      }
      state.pendingRenderKeys.clear();
      record('stopped');
    }

    const api={
      start,
      accept,
      flush,
      stop,
      ready:()=>readyPromise,
      diagnostics:limit=>{
        const count=Number(limit);
        const rows=Number.isFinite(count)&&count>=0?state.diagnostics.slice(-count):state.diagnostics.slice();
        return rows.map(row=>Object.assign({},row));
      },
    };
    return api;
  }

  return Object.freeze({create});
});
