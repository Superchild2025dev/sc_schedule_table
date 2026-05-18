(function(){
  const STAFF_REGION='asia-northeast3';
  const POLL_MS=4500;
  const TX_RETRIES=5;

  function normalizeKey(key){
    return String(key||'').replace(/[.#$/\[\]]/g,'_');
  }
  function clone(value){
    if(value===undefined||value===null) return null;
    return JSON.parse(JSON.stringify(value));
  }
  function sameRaw(a,b){
    return JSON.stringify(a===undefined?null:a)===JSON.stringify(b===undefined?null:b);
  }
  function makeSnapshot(key,value){
    return {key, val:function(){return value===undefined?null:value;}};
  }
  function authError(e){
    const code=String(e&&e.code||'');
    return code.indexOf('unauthenticated')>=0 || code.indexOf('permission-denied')>=0;
  }
  function errorMessage(e){
    return (e&&e.message) || String(e||'오류가 발생했습니다');
  }
  function waitAuthReady(auth){
    return new Promise(resolve=>{
      const off=auth.onAuthStateChanged(user=>{off();resolve(user||null);});
    });
  }
  function modalHtml(branch){
    const branchName=branch&&branch.name?branch.name:'';
    return `
      <div style="position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:100000;display:flex;align-items:center;justify-content:center;padding:18px">
        <form id="staff-auth-form" style="width:min(420px,100%);background:#fff;border-radius:12px;box-shadow:0 24px 70px rgba(15,23,42,.35);padding:24px;font-family:inherit">
          <div style="font-size:13px;font-weight:800;color:#2563EB;margin-bottom:6px">${branchName}</div>
          <div style="font-size:24px;font-weight:900;color:#111827;margin-bottom:6px">관리자 로그인</div>
          <div style="font-size:13px;color:#6B7280;margin-bottom:18px">등록된 관리자 계정으로 접속해주세요.</div>
          <label style="display:block;font-size:12px;font-weight:800;color:#374151;margin-bottom:6px">이메일</label>
          <input id="staff-auth-email" type="email" autocomplete="username" required style="width:100%;box-sizing:border-box;border:1.5px solid #D1D5DB;border-radius:8px;padding:11px 12px;font-size:15px;margin-bottom:12px">
          <label style="display:block;font-size:12px;font-weight:800;color:#374151;margin-bottom:6px">비밀번호</label>
          <input id="staff-auth-pass" type="password" autocomplete="current-password" required style="width:100%;box-sizing:border-box;border:1.5px solid #D1D5DB;border-radius:8px;padding:11px 12px;font-size:15px;margin-bottom:10px">
          <div id="staff-auth-error" style="display:none;color:#DC2626;font-size:12px;font-weight:800;margin:4px 0 12px"></div>
          <button type="submit" style="width:100%;border:0;border-radius:8px;background:#111827;color:#fff;padding:12px 14px;font-size:15px;font-weight:900;cursor:pointer">로그인</button>
        </form>
      </div>`;
  }
  function showLoginModal(auth, branch){
    return new Promise((resolve,reject)=>{
      let wrap=document.getElementById('staff-auth-modal');
      if(wrap) wrap.remove();
      wrap=document.createElement('div');
      wrap.id='staff-auth-modal';
      wrap.innerHTML=modalHtml(branch);
      document.body.appendChild(wrap);
      const form=document.getElementById('staff-auth-form');
      const emailEl=document.getElementById('staff-auth-email');
      const passEl=document.getElementById('staff-auth-pass');
      const errEl=document.getElementById('staff-auth-error');
      setTimeout(()=>emailEl.focus(),0);
      form.addEventListener('submit',async e=>{
        e.preventDefault();
        errEl.style.display='none';
        const btn=form.querySelector('button[type="submit"]');
        btn.disabled=true;
        btn.textContent='확인 중...';
        try{
          const cred=await auth.signInWithEmailAndPassword(emailEl.value.trim(),passEl.value);
          wrap.remove();
          resolve(cred.user);
        }catch(err){
          errEl.textContent='로그인 정보 또는 권한을 확인해주세요';
          errEl.style.display='block';
          btn.disabled=false;
          btn.textContent='로그인';
          passEl.select();
        }
      });
    });
  }

  window.initStaffDatabase=function(config, branch, role, opts){
    opts=opts||{};
    if(!branch||!branch.id) throw new Error('지점을 먼저 선택해주세요');
    if(!window.firebase||!firebase.functions||!firebase.auth) throw new Error('Firebase Auth/Functions SDK가 필요합니다');
    const app=(firebase.apps&&firebase.apps.length)?firebase.app():firebase.initializeApp(config);
    const functions=app.functions(STAFF_REGION);
    const auth=firebase.auth();
    try{auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);}catch(e){}
    const callableCache={};

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
    async function ensureUser(){
      const current=auth.currentUser || await waitAuthReady(auth);
      const user=current || await showLoginModal(auth, branch);
      if(!user) throw new Error('관리자 로그인이 필요합니다');
      await user.getIdToken();
      return user;
    }
    async function callStaff(name,payload,retried){
      await ensureUser();
      try{
        return await callRaw(name,Object.assign({},payload||{},{branch:branch.id}));
      }catch(e){
        if(!retried && authError(e)){
          try{await auth.signOut();}catch(ignore){}
          await showLoginModal(auth, branch);
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

    window.staffSignOut=function(){return auth.signOut();};

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
      signOut:function(){
        return auth.signOut();
      },
      clearSession:function(){
        return auth.signOut();
      }
    };
  };
})();
