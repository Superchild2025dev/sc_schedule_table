(function(){
  const FIREBASE_CONFIG = window.SC_FIREBASE_CONFIG || {
    apiKey: "AIzaSyArHQQfHnVreH8gVamyl1e5IqUDfXUJ5F8",
    authDomain: "scswimming-schedule.firebaseapp.com",
    databaseURL: "https://scswimming-schedule-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "scswimming-schedule",
    storageBucket: "scswimming-schedule.firebasestorage.app",
    messagingSenderId: "45509278949",
    appId: "1:45509278949:web:f16989a9c416f06e25e80c"
  };

  const SELECTED_BRANCH_KEY='selected_branch';
  let _selectedBranch=null;
  let _fb=null;
  let _fbReady=false;
  let _stuKey='swim_students';
  let _instKey='swim_inst';
  let STUDENTS=[];
  let INST_MAP={};
  let MARK_MAP={};
  let REQUESTS={};
  let _staffNotifyFn=null;

  try{
    const branchParam=new URLSearchParams(location.search).get('branch');
    if(branchParam==='gagyeong'||branchParam==='yongam') localStorage.setItem(SELECTED_BRANCH_KEY,branchParam);
    _selectedBranch=localStorage.getItem(SELECTED_BRANCH_KEY);
  }catch(e){}

  function getBranchInfo(){
    if(_selectedBranch==='yongam') return {id:'yongam', name:'용암점', fbPath:'schedule_yongam', aligoBranch:'용암점'};
    if(_selectedBranch==='gagyeong') return {id:'gagyeong', name:'가경점', fbPath:'schedule', aligoBranch:'가경동'};
    return null;
  }

  window.selectBranch=function(branch){
    if(branch!=='gagyeong'&&branch!=='yongam') return;
    if(window.SCAuth&&typeof SCAuth.canAccessBranch==='function'&&!SCAuth.canAccessBranch(branch)){
      toast('이 지점 접근 권한이 없습니다','err');
      return;
    }
    try{localStorage.setItem(SELECTED_BRANCH_KEY,branch);}catch(e){}
    _selectedBranch=branch;
    try{window.SC_SELECTED_BRANCH=branch;}catch(e){}
    window.location.href='desk.html?branch='+branch;
  };

  window.openBranchModal=function(){
    const m=document.getElementById('branch-modal');
    if(m) m.classList.add('show');
  };

  function esc(s){
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function parseJSON(v,def){
    if(!v) return def;
    try{return typeof v==='string'?JSON.parse(v):v;}catch(e){return def;}
  }
  function normalizeStoredValue(key,val){
    return window.SCScheduleTime&&typeof SCScheduleTime.normalizeStoredValue==='function'
      ? SCScheduleTime.normalizeStoredValue(key,val)
      : val;
  }
  function parseStoredJSON(key,v,def){
    return normalizeStoredValue(key,parseJSON(v,def));
  }
  function toDateStr(d){
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,'0');
    const dd=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }
  function fmtDate(ds){
    const p=String(ds||'').split('-');
    if(p.length<3) return {md:'-', dow:''};
    const d=new Date(ds+'T12:00:00');
    const dows=['일','월','화','수','목','금','토'];
    return {md:`${parseInt(p[1],10)}/${parseInt(p[2],10)}`, dow:dows[d.getDay()]||''};
  }
  function fmtTime(ts){
    if(!ts) return '';
    const d=new Date(ts);
    if(Number.isNaN(d.getTime())) return '';
    const mm=String(d.getMonth()+1).padStart(2,'0');
    const dd=String(d.getDate()).padStart(2,'0');
    const hh=String(d.getHours()).padStart(2,'0');
    const mi=String(d.getMinutes()).padStart(2,'0');
    return `${mm}/${dd} ${hh}:${mi}`;
  }
  function displayTime(day,t){
    if(window.SCScheduleTime&&typeof SCScheduleTime.displayTimeForDay==='function') return SCScheduleTime.displayTimeForDay(day,t);
    const sat={'1시':'9시','2시':'10시','3시':'11시','4시':'12시','5시':'1시','6시':'2시'};
    return String(day||'').replace('요일','')==='토' ? (sat[t]||t||'') : (t||'');
  }
  function normalizeSlotKeyParts(slotKey){
    const parts=String(slotKey||'').split('/');
    return {t:parts[0]||'', d:parts[1]||'', l:parts[2]||'', r:parts[3]||''};
  }
  function slotKeyOf(stu){
    return stu ? [stu.t,stu.d,stu.l,stu.r].join('/') : '';
  }
  function studentBySlot(slotKey){
    return STUDENTS.find(s=>slotKeyOf(s)===slotKey) || null;
  }
  function instBySlot(slotKey){
    const s=normalizeSlotKeyParts(slotKey);
    return INST_MAP[[s.t,s.d,s.l].join('/')] || null;
  }
  function dataKeys(data){
    const setting=parseJSON(data&&data.swim_parent_tab,null);
    _stuKey=setting&&setting.stuKey ? setting.stuKey : 'swim_students';
    _instKey=setting&&setting.instKey ? setting.instKey : 'swim_inst';
  }
  function classLabel(inst, fallback){
    const labels=[];
    if(inst&&inst.youth) labels.push('유아반');
    const cls=inst&&((inst.cls)|| (inst.elma?'elma':''));
    if(cls==='elma') labels.push('엘/마반');
    else if(cls==='elite') labels.push('엘리트반');
    else if(cls==='master') labels.push('마스터반');
    return labels.join(' · ') || fallback || '';
  }
  function classText(slotKey, ds, reqTarget){
    const s=normalizeSlotKeyParts(slotKey);
    const inst=instBySlot(slotKey) || {};
    const teacher=inst.n || reqTarget?.instName || '';
    const label=classLabel(inst, reqTarget?.classLabel || '');
    return [
      ds ? `${fmtDate(ds).md} ${fmtDate(ds).dow}요일` : '',
      displayTime(s.d || reqTarget?.d, s.t || reqTarget?.t),
      teacher ? `${teacher} 선생님` : '',
      label
    ].filter(Boolean).join(' · ');
  }
  function setSync(text){
    const el=document.getElementById('desk-sync');
    if(el) el.textContent=text;
  }
  function toast(msg,type){
    const el=document.getElementById('toast');
    if(!el) return;
    el.textContent=msg;
    el.className='toast show '+(type||'');
    clearTimeout(toast._t);
    toast._t=setTimeout(()=>el.classList.remove('show'),2200);
  }
  function staffNotifyFn(){
    if(_staffNotifyFn) return _staffNotifyFn;
    if(!firebase.functions) throw new Error('Firebase Functions SDK가 로드되지 않았습니다');
    if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    const app=firebase.app();
    const fnSvc=app.functions ? app.functions('asia-northeast3') : firebase.functions('asia-northeast3');
    _staffNotifyFn=fnSvc.httpsCallable('parentPortal');
    return _staffNotifyFn;
  }
  async function callStaffNotification(req,status){
    const branch=getBranchInfo();
    if(!branch) throw new Error('지점을 선택해주세요');
    const res=await staffNotifyFn()({
      action:'notifyStaffRequestProcessed',
      branch:branch.id,
      status,
      request:req,
    });
    return res&&res.data ? res.data : {};
  }
  async function notifyAbsentCancelAccepted(req){
    const data=await callStaffNotification(req,'accepted');
    return data.results||[];
  }
  function canProcessRequests(){
    if(window.SCAuth&&typeof SCAuth.requirePermission==='function'){
      return SCAuth.requirePermission('teacherRequests','결석취소 요청 처리');
    }
    return true;
  }
  function canWriteKey(key,label){
    if(window.SCAuth&&typeof SCAuth.requireWriteKey==='function'){
      return SCAuth.requireWriteKey(key,label||'저장');
    }
    return true;
  }
  function updateDeskKeysTx(keys,mutator){
    if(!_fbReady) return Promise.reject(new Error('not ready'));
    let abortReason='';
    const makeCtx=root=>({
      get(key,fallback){
        const raw=root&&Object.prototype.hasOwnProperty.call(root,key)?root[key]:undefined;
        return parseStoredJSON(key,raw,fallback);
      },
      set(key,val){
        root[key]=JSON.stringify(normalizeStoredValue(key,val));
      },
      abort(reason){ abortReason=reason||''; },
    });
    const runTx=typeof _fb.transactionKeys==='function'
      ? updateFn=>_fb.transactionKeys(keys,updateFn)
      : updateFn=>_fb.transaction(updateFn);
    return runTx(root=>{
      root=root||{};
      const result=mutator(makeCtx(root));
      if(result===undefined) return;
      return root;
    }).then(res=>{
      if(!res.committed) throw new Error(abortReason||'transaction aborted');
      const root=res.snapshot.val()||{};
      keys.forEach(key=>applyChangedKey(key,root[key]));
      return root;
    });
  }
  function requestTargetSlotKey(req){
    const t=req&&req.target||{};
    if(t.t&&t.d&&t.l&&t.r) return [t.t,t.d,t.l,t.r].join('/');
    const p=req&&req.parent||{};
    return p.studentSlotKey||'';
  }
  function acceptCancelRequest(id){
    if(!id) return;
    if(!canProcessRequests()) return;
    if(!canWriteKey('swim_requests','요청 처리')) return;
    if(!canWriteKey('swim_mark','결석 해제')) return;
    const req=REQUESTS[id];
    if(!req||req.type!=='absent-cancel'){
      toast('요청을 찾을 수 없습니다','err');
      return;
    }
    const p=req.parent||{};
    const name=p.name||'원생';
    if(!confirm(`${name} 결석취소 요청을 확인하고 결석을 해제할까요?`)) return;
    const processedAt=new Date().toISOString();
    const profile=window.SCAuth&&typeof SCAuth.profile==='function'?SCAuth.profile():null;
    const processedBy=profile?.name||'데스크';
    let saved=false;
    updateDeskKeysTx(['swim_requests','swim_mark'],ctx=>{
      const reqs=ctx.get('swim_requests',{});
      const marks=ctx.get('swim_mark',{});
      const curReq=reqs[id];
      if(!curReq){ctx.abort('요청을 찾을 수 없습니다');return;}
      if(curReq.status&&curReq.status!=='pending'&&curReq.status!=='processing'){
        ctx.abort('이미 처리된 요청입니다');
        return;
      }
      const slotKey=requestTargetSlotKey(curReq);
      const ds=curReq.target?.ds||curReq.parent?.absentDs||'';
      if(!slotKey||!ds){ctx.abort('결석 날짜 정보를 찾을 수 없습니다');return;}
      const markKey=slotKey+'/'+ds;
      const mark=marks[markKey];
      if(mark?.type==='absent'){
        if(mark.sub) marks[markKey]=mark.sub;
        else delete marks[markKey];
      }
      curReq.status='accepted';
      curReq.processedAt=processedAt;
      curReq.processedBy=processedBy;
      delete curReq.processingAt;
      delete curReq.processingBy;
      ctx.set('swim_mark',marks);
      ctx.set('swim_requests',reqs);
      return true;
    }).then(()=>{
      saved=true;
      render();
      return notifyAbsentCancelAccepted(req);
    }).then(results=>{
      const parentResult=(results||[]).find(r=>r&&r.templateId==='parent_absent_cancel');
      if(parentResult&&parentResult.ok){
        toast('결석취소 확인 및 학부모 알림톡 발송 완료','ok');
      }else if(parentResult){
        toast(`결석취소 완료 / 학부모 알림톡 미발송: ${parentResult.reason||parentResult.status||parentResult.error||'확인 필요'}`,'err');
      }else{
        toast('결석취소 확인 완료','ok');
      }
    }).catch(e=>{
      if(saved){
        console.warn('desk absent cancel notify failed',e);
        toast('결석취소는 완료 / 알림톡 발송 확인 필요','err');
        return;
      }
      console.error(e);
      toast(e?.message||'처리 실패','err');
    });
  }
  function initFirebase(){
    const branch=getBranchInfo();
    if(!branch){ openBranchModal(); return false; }
    if(window.SCAuth&&typeof SCAuth.canAccessBranch==='function'&&!SCAuth.canAccessBranch(branch.id)){
      try{localStorage.removeItem(SELECTED_BRANCH_KEY);}catch(e){}
      _selectedBranch=null;
      openBranchModal();
      toast('이 지점 접근 권한이 없습니다','err');
      return false;
    }
    if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    _fb=window.SCFirebaseStore
      ? SCFirebaseStore.createBranchRef(branch)
      : firebase.database().ref(branch.fbPath);
    _fbReady=true;
    const title=document.getElementById('desk-title');
    if(title) title.textContent=`${branch.name} 데스크 요청 현황`;
    return true;
  }

  function loadAllData(){
    if(!_fbReady) return Promise.reject(new Error('not ready'));
    return _fb.once('value').then(snap=>{
      const data=snap.val()||{};
      dataKeys(data);
      STUDENTS=parseStoredJSON(_stuKey,data[_stuKey],[]);
      INST_MAP=parseStoredJSON(_instKey,data[_instKey],{});
      MARK_MAP=parseStoredJSON('swim_mark',data.swim_mark,{});
      REQUESTS=parseStoredJSON('swim_requests',data.swim_requests,{});
    });
  }

  function applyChangedKey(key,value){
    const asStr=typeof value==='string'?value:JSON.stringify(value);
    if(key==='swim_parent_tab'){
      loadAllData().then(render).catch(e=>console.warn('desk reload failed',e));
      return;
    }
    if(key===_stuKey) STUDENTS=parseStoredJSON(_stuKey,asStr,[]);
    else if(key===_instKey) INST_MAP=parseStoredJSON(_instKey,asStr,{});
    else if(key==='swim_mark') MARK_MAP=parseStoredJSON('swim_mark',asStr,{});
    else if(key==='swim_requests') REQUESTS=parseStoredJSON('swim_requests',asStr,{});
    render();
  }

  function subscribeChanges(){
    if(!_fbReady) return;
    _fb.on('child_changed',snap=>applyChangedKey(snap.key,snap.val()));
  }

  function getAbsences(){
    const today=toDateStr(new Date());
    const list=[];
    Object.entries(MARK_MAP||{}).forEach(([key,mark])=>{
      if(!mark||mark.type!=='absent') return;
      const parts=key.split('/');
      if(parts.length<5) return;
      const ds=parts.slice(4).join('/');
      if(ds<today) return;
      const slotKey=parts.slice(0,4).join('/');
      const stu=studentBySlot(slotKey);
      const inst=instBySlot(slotKey);
      list.push({slotKey, ds, stu, inst, mark});
    });
    list.sort((a,b)=>{
      const pa=normalizeSlotKeyParts(a.slotKey);
      const pb=normalizeSlotKeyParts(b.slotKey);
      const ta=window.SCScheduleTime&&typeof SCScheduleTime.sortTimeValue==='function'?SCScheduleTime.sortTimeValue(pa.d,pa.t):Number(pa.t.replace(/\D/g,''));
      const tb=window.SCScheduleTime&&typeof SCScheduleTime.sortTimeValue==='function'?SCScheduleTime.sortTimeValue(pb.d,pb.t):Number(pb.t.replace(/\D/g,''));
      return a.ds.localeCompare(b.ds)||ta-tb;
    });
    return list.slice(0,200);
  }

  function getCancelRequests(){
    const list=[];
    Object.entries(REQUESTS||{}).forEach(([id,req])=>{
      if(!req||req.type!=='absent-cancel') return;
      if(req.status&&req.status!=='pending'&&req.status!=='processing') return;
      list.push({id, req});
    });
    list.sort((a,b)=>(b.req.requestedAt||'').localeCompare(a.req.requestedAt||''));
    return list;
  }

  function renderAbsentCard(item){
    const date=fmtDate(item.ds);
    const p=item.stu || {};
    const s=normalizeSlotKeyParts(item.slotKey);
    const name=p.n ? `${p.n}${p.a||''}` : '원생 미확인';
    const phone=p.p || '';
    const hasMakeup=item.mark&&item.mark.sub&&item.mark.sub.type==='bogang';
    const vehicle=item.mark?.vehicleLabel ? ` · ${item.mark.vehicleLabel}` : '';
    return `<div class="desk-card">
      <div class="desk-date"><span class="md">${esc(date.md)}</span><span class="dow">${esc(date.dow)}요일</span></div>
      <div class="desk-main">
        <div class="desk-line">
          <span class="desk-name">${esc(name)}</span>
          ${phone?`<span class="desk-phone">${esc(phone)}</span>`:''}
          <span class="desk-badge ${hasMakeup?'done':''}">${hasMakeup?'보강 있음':'결석'}</span>
        </div>
        <div class="desk-class">${esc(classText(item.slotKey,item.ds))}</div>
        <div class="desk-meta">${esc(s.l)}레인 ${esc(s.r)}번${esc(vehicle)}</div>
      </div>
    </div>`;
  }

  function renderCancelCard(item){
    const req=item.req;
    const target=req.target||{};
    const p=req.parent||{};
    const ds=target.ds||'';
    const date=fmtDate(ds);
    const slotKey=p.studentSlotKey || [target.t,target.d,target.l,target.r].join('/');
    const name=`${p.name||'이름 미확인'}${p.age||''}`;
    return `<div class="desk-card cancel">
      <div class="desk-date"><span class="md">${esc(date.md)}</span><span class="dow">${esc(date.dow)}요일</span></div>
      <div class="desk-main">
        <div class="desk-line">
          <span class="desk-name">${esc(name)}</span>
          ${p.phone?`<span class="desk-phone">${esc(p.phone)}</span>`:''}
          <span class="desk-badge cancel">취소 요청</span>
        </div>
        <div class="desk-class">${esc(classText(slotKey,ds,target))}</div>
        <div class="desk-meta">접수 ${esc(fmtTime(req.requestedAt))}</div>
        <div class="desk-note">확인 버튼을 누르면 결석이 바로 해제됩니다.</div>
        <div class="desk-card-actions">
          <button type="button" class="desk-confirm-btn" data-desk-act="accept-cancel" data-id="${esc(item.id)}">확인 (결석 해제)</button>
        </div>
      </div>
    </div>`;
  }

  function render(){
    const absences=getAbsences();
    const cancels=getCancelRequests();
    document.getElementById('absent-count').textContent=String(absences.length);
    document.getElementById('cancel-count').textContent=String(cancels.length);
    const absentList=document.getElementById('absent-list');
    const cancelList=document.getElementById('cancel-list');
    absentList.innerHTML=absences.length ? absences.map(renderAbsentCard).join('') : '<div class="desk-empty">오늘 이후 결석이 없습니다.</div>';
    cancelList.innerHTML=cancels.length ? cancels.map(renderCancelCard).join('') : '<div class="desk-empty">확인 대기 중인 결석 취소 요청이 없습니다.</div>';
    setSync('실시간 연결됨 · '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}));
  }

  async function start(){
    if(window.SCAuth&&typeof SCAuth.requireAuth==='function'){
      await SCAuth.requireAuth();
      if(typeof SCAuth.applyPagePermissions==='function') SCAuth.applyPagePermissions(document);
      const p=SCAuth.profile&&SCAuth.profile();
      if(!_selectedBranch&&p&&Array.isArray(p.branchIds)&&p.branchIds.length===1){
        _selectedBranch=p.branchIds[0];
        try{localStorage.setItem(SELECTED_BRANCH_KEY,_selectedBranch);}catch(e){}
      }
      const role=SCAuth.role&&SCAuth.role();
      if(role!=='desk'&&role!=='superAdmin'){
        document.body.innerHTML='<div class="desk-denied">데스크 계정으로 로그인해주세요.</div>';
        return;
      }
    }
    if(!initFirebase()) return;
    document.getElementById('desk-app').style.display='block';
    setSync('데이터 불러오는 중');
    try{
      await loadAllData();
      render();
      subscribeChanges();
    }catch(e){
      console.error(e);
      setSync('데이터를 불러오지 못했습니다');
      toast('데이터 로드 실패','err');
    }
  }

  document.addEventListener('click',e=>{
    const btn=e.target.closest('[data-desk-act]');
    if(!btn) return;
    const act=btn.dataset.deskAct;
    if(act==='accept-cancel') acceptCancelRequest(btn.dataset.id);
  });

  document.addEventListener('DOMContentLoaded',start);
})();
