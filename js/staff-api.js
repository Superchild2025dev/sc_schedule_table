(function(){
  const STAFF_REGION='asia-northeast3';
  const STAFF_SESSION_PREFIX='scswim_staff_session_v1';
  const POLL_MS=4500;
  const TX_RETRIES=5;

  function normalizeKey(key){
    return String(key||'').replace(/[.#$/\[\]]/g,'_');
  }
  function clone(value){
    if(value===undefined||value===null) return value===undefined?null:null;
    return JSON.parse(JSON.stringify(value));
  }
  function sameRaw(a,b){
    return JSON.stringify(a===undefined?null:a)===JSON.stringify(b===undefined?null:b);
  }
  function makeSnapshot(key,value){
    return {key, val:function(){return value===undefined?null:value;}};
  }
  function roleLabel(role){
    return role==='admin'?'관리자':'선생님';
  }
  function authError(e){
    const code=String(e&&e.code||'');
    return code.indexOf('unauthenticated')>=0 || code.indexOf('permission-denied')>=0;
  }
  function errorMessage(e){
    return (e&&e.message) || String(e||'오류가 발생했습니다');
  }

  window.initStaffDatabase=function(config, branch, role, opts){
    opts=opts||{};
    if(!branch||!branch.id) throw new Error('지점을 먼저 선택해주세요');
    if(!window.firebase||!firebase.functions) throw new Error('Firebase Functions SDK가 필요합니다');
    const app=(firebase.apps&&firebase.apps.length)?firebase.app():firebase.initializeApp(config);
    const functions=app.functions(STAFF_REGION);
    const callableCache={};
    const sessionKey=STAFF_SESSION_PREFIX+':'+role+':'+branch.id;
    let token='';
    try{token=sessionStorage.getItem(sessionKey)||'';}catch(e){}

    const listeners={child_changed:[], child_removed:[]};
    let rootCache=null;
    let pollTimer=null;
    let pollBusy=false;

    function callable(name){
      if(!callableCache[name]) callableCache[name]=functions.httpsCallable(name);
      return callableCache[name];
    }
    async function callRaw(name,payload){
      const res=await callable(name)(payload||{});
      return res.data||{};
    }
    function clearToken(){
      token='';
      try{sessionStorage.removeItem(sessionKey);}catch(e){}
    }
    async function login(){
      const promptFn=opts.promptCode || function(ctx){
        return window.prompt((ctx.branch.name||'')+' '+roleLabel(ctx.role)+' 접근 코드를 입력해주세요');
      };
      const code=promptFn({role, branch});
      if(code===null || String(code).trim()==='') throw new Error(roleLabel(role)+' 접근 코드가 필요합니다');
      const data=await callRaw('staffLogin',{branch:branch.id,role,code:String(code).trim()});
      token=data.token||'';
      if(!token) throw new Error('접근 토큰을 발급받지 못했습니다');
      try{sessionStorage.setItem(sessionKey,token);}catch(e){}
      return token;
    }
    async function ensureToken(){
      return token || login();
    }
    async function callStaff(name,payload,retried){
      const tk=await ensureToken();
      try{
        return await callRaw(name,Object.assign({},payload||{},{branch:branch.id,token:tk}));
      }catch(e){
        if(!retried && authError(e)){
          clearToken();
          return callStaff(name,payload,true);
        }
        throw e;
      }
    }
    function emit(event,key,value){
      (listeners[event]||[]).forEach(cb=>{
        try{cb(makeSnapshot(key,value));}catch(e){setTimeout(()=>{throw e;},0);}
      });
    }
    function applyRoot(nextRoot, fireEvents){
      const clean=(nextRoot&&typeof nextRoot==='object')?clone(nextRoot):{};
      if(rootCache && fireEvents){
        const keys=new Set(Object.keys(rootCache).concat(Object.keys(clean)));
        keys.forEach(key=>{
          if(!(key in clean)){
            emit('child_removed',key,null);
          }else if(!(key in rootCache) || !sameRaw(rootCache[key],clean[key])){
            emit('child_changed',key,clean[key]);
          }
        });
      }
      rootCache=clean;
      return clean;
    }
    async function refresh(fireEvents){
      const data=await callStaff('staffGetData',{});
      return applyRoot(data.data||{}, !!fireEvents);
    }
    function startPolling(){
      if(pollTimer) return;
      pollTimer=setInterval(async ()=>{
        if(pollBusy) return;
        pollBusy=true;
        try{
          await refresh(true);
          if(opts.onPollOk) opts.onPollOk();
        }catch(e){
          if(opts.onPollError) opts.onPollError(e);
          else console.warn('[staff sync failed]',errorMessage(e));
        }finally{
          pollBusy=false;
        }
      },POLL_MS);
    }
    async function valueTransaction(key,mutator){
      let cur=(await callStaff('staffGetValue',{key})).value;
      for(let i=0;i<TX_RETRIES;i++){
        const expected=cur===undefined?null:cur;
        const next=mutator(expected);
        if(next===undefined) return {committed:false,snapshot:makeSnapshot(key,expected)};
        const res=await callStaff('staffCompareAndSetValue',{key,expected,value:next});
        cur=res.value;
        if(res.committed) return {committed:true,snapshot:makeSnapshot(key,cur)};
      }
      throw new Error('동시 수정이 많아 저장에 실패했습니다. 다시 시도해주세요');
    }
    async function rootTransaction(mutator){
      let cur=await refresh(false);
      for(let i=0;i<TX_RETRIES;i++){
        const expected=clone(cur)||{};
        const next=mutator(clone(expected)||{});
        if(next===undefined) return {committed:false,snapshot:makeSnapshot(null,expected)};
        const res=await callStaff('staffCompareAndSetRoot',{expected,value:next});
        cur=applyRoot(res.value||{}, false);
        if(res.committed) return {committed:true,snapshot:makeSnapshot(null,cur)};
      }
      throw new Error('동시 수정이 많아 저장에 실패했습니다. 다시 시도해주세요');
    }

    return {
      once:function(event){
        if(event!=='value') return Promise.reject(new Error('지원하지 않는 이벤트입니다'));
        return refresh(false).then(root=>makeSnapshot(null,root));
      },
      on:function(event,cb){
        if(!listeners[event]) return cb;
        listeners[event].push(cb);
        startPolling();
        return cb;
      },
      off:function(event,cb){
        if(!listeners[event]) return;
        if(!cb){listeners[event]=[];return;}
        listeners[event]=listeners[event].filter(fn=>fn!==cb);
      },
      child:function(key){
        const sk=normalizeKey(key);
        return {
          key:sk,
          set:function(value){return callStaff('staffSetValue',{key:sk,value});},
          remove:function(){return callStaff('staffRemoveValue',{key:sk});},
          transaction:function(mutator){return valueTransaction(sk,mutator);}
        };
      },
      transaction:function(mutator){
        return rootTransaction(mutator);
      },
      remove:function(){
        return callStaff('staffClearBranch',{});
      },
      clearSession:clearToken
    };
  };
})();
