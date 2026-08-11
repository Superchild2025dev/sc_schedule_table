(function(global,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  global.SCMarkMapTransaction=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function clone(value){ return value==null?value:JSON.parse(JSON.stringify(value)); }
  function staleError(){
    return Object.assign(new Error('이전 마크 저장 결과는 현재 화면에 적용하지 않습니다.'),{
      code:'stale-mark-response',
    });
  }
  function create(options={}){
    if(typeof options.read!=='function'||typeof options.transact!=='function'||typeof options.apply!=='function'){
      throw new TypeError('read, transact, and apply are required');
    }
    let sequence=0;
    async function mutate(mutator,meta){
      const token=++sequence;
      const visible=options.read();
      const committed=await options.transact(mutator,meta);
      if(token!==sequence||options.read()!==visible){
        const error=staleError();
        if(typeof options.refresh==='function') await options.refresh(error,meta);
        throw error;
      }
      options.apply(clone(committed));
      return clone(committed);
    }
    function invalidate(){ sequence+=1; }
    return Object.freeze({mutate,invalidate});
  }
  return Object.freeze({create});
});
