/* ════════════════════════════════════════════════════════════════
 * 학부모 페이지
 * - 인증: 아이 이름 + 전화번호 전체 → Cloud Function 검증
 * - 기능: 결석 마크 토글, 보강 요청
 * - 학부모 브라우저에는 검증된 학생 데이터만 전달
 * ════════════════════════════════════════════════════════════════ */

/* ── Firebase 설정 (메인 앱과 동일) ── */
const FIREBASE_CONFIG = window.SC_FIREBASE_CONFIG || {
  apiKey: "AIzaSyArHQQfHnVreH8gVamyl1e5IqUDfXUJ5F8",
  authDomain: "scswimming-schedule.firebaseapp.com",
  databaseURL: "https://scswimming-schedule-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "scswimming-schedule",
  storageBucket: "scswimming-schedule.firebasestorage.app",
  messagingSenderId: "45509278949",
  appId: "1:45509278949:web:f16989a9c416f06e25e80c"
};

let _fb=null, _fbReady=false, _parentFn=null, _parentSessionToken=null, _parentRefreshTimer=null;
let STUDENTS=[], INST_MAP={}, MARK_MAP={}, CLOSED_LIST=[], SCHEDULE_PERIODS=[], HYUWON_MAP={}, RESERVE_MAP={}, REQUESTS={};
const PARENT_SESSION_KEY='parent_session_token';

/* [v118] 지점 선택 (가경점/용암점) — 메인 앱과 동일 */
const SELECTED_BRANCH_KEY='selected_branch';
const BRANCH_CONTACTS={
  gagyeong:{label:'가경점',phone:'043-715-2019'},
  yongam:{label:'용암점',phone:'043-288-2016'},
};
function _branchParamFromUrl(){
  const qs=String((window.location&&window.location.search)||'');
  const m=qs.match(/[?&]branch=(gagyeong|yongam)(?=&|$)/);
  if(m) return m[1];
  try{return new URLSearchParams(qs).get('branch')||'';}catch(e){return '';}
}
let _selectedBranch=null;
try{
  const branchParam=_branchParamFromUrl();
  if(branchParam==='gagyeong'||branchParam==='yongam'){
    _selectedBranch=branchParam;
    try{window.localStorage.setItem(SELECTED_BRANCH_KEY,branchParam);}catch(e){}
  }
}catch(e){}
if(!_selectedBranch){
  try{ _selectedBranch=window.localStorage.getItem(SELECTED_BRANCH_KEY); }catch(e){}
}
try{ window.SC_SELECTED_BRANCH=_selectedBranch||''; }catch(e){}
function getBranchInfo(){
  const selected=_selectedBranch || (window.SC_SELECTED_BRANCH||'');
  if(selected==='yongam') return {id:'yongam', name:'용암점', fbPath:'schedule_yongam'};
  if(selected==='gagyeong') return {id:'gagyeong', name:'가경점', fbPath:'schedule'};
  return null;
}
function selectBranch(branch){
  if(branch!=='gagyeong' && branch!=='yongam') return;
  try{ window.localStorage.setItem(SELECTED_BRANCH_KEY, branch); }catch(e){}
  window.location.href='parent.html?branch='+branch;
}
function openBranchModal(){
  const m=document.getElementById('branch-modal');
  if(m) m.classList.add('show');
}
function closeBranchModal(){
  const m=document.getElementById('branch-modal');
  if(m) m.classList.remove('show');
}
function branchContactText(){
  const branch=getBranchInfo();
  const contact=BRANCH_CONTACTS[branch?.id]||BRANCH_CONTACTS.gagyeong;
  return `${contact.label} ${contact.phone}`;
}
function sameDayCancelMessage(){
  return `당일 결석취소 요청은 온라인 접수가 불가합니다.\n유선문의 부탁드립니다.\n${branchContactText()}`;
}
let _currentStudents=[];  // 로그인된 학생 그룹 (같은 이름+같은 전화번호)
// 하위 호환: 첫 학생을 _currentStudent로도 노출
let _currentStudent=null;
let _feedbackContext='로그인 화면';

// 기본 수업 기간 (Firebase에 swim_periods가 없을 때 fallback)
const _DEFAULT_PERIODS=[
  {month:2, start:'2026-02-02',end:'2026-03-04'},
  {month:3, start:'2026-03-05',end:'2026-04-01'},
  {month:4, start:'2026-04-02',end:'2026-04-29'},
  {month:5, start:'2026-05-06',end:'2026-06-02'},
  {month:6, start:'2026-06-03',end:'2026-06-30'},
  {month:7, start:'2026-07-06',end:'2026-08-01'},
  {month:8, start:'2026-08-03',end:'2026-08-29'},
  {month:9, start:'2026-08-31',end:'2026-10-02'},
  {month:10,start:'2026-10-05',end:'2026-10-31'},
  {month:11,start:'2026-11-02',end:'2026-11-28'},
  {month:12,start:'2026-11-30',end:'2026-12-26'},
];

/* ── 데이터 로드 ── */
function initFirebase(){
  const branch = getBranchInfo();
  if(!branch){
    // 지점 미선택 → 모달 띄우고 init 중단
    openBranchModal();
    return;
  }
  try{
    const app=(firebase.apps&&firebase.apps.length) ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
    const fnSvc=app.functions ? app.functions('asia-northeast3') : firebase.functions('asia-northeast3');
    _parentFn=fnSvc.httpsCallable('parentPortal');
    _fb=null; // 학부모 페이지는 DB 직접 접근 금지. Cloud Function만 사용.
    _fbReady=true;
    // 헤더 타이틀에 지점명 반영
    const brand=document.getElementById('parent-brand');
    if(brand) brand.textContent=(branch.id==='yongam'?'용암':'가경')+' 수영장';
  }catch(e){
    console.error('Firebase 초기화 실패:',e);
    toast('연결 실패','err');
  }
}

function loadAllData(){
  if(!_fbReady) return Promise.reject(new Error('not ready'));
  if(!_parentSessionToken) return Promise.resolve();
  return refreshParentBundle();
}

function parseJSON(v,def){
  if(!v) return def;
  try{return typeof v==='string'?JSON.parse(v):v;}catch(e){return def;}
}

function displayTimeForDay(day,t){
  if(window.SCScheduleTime&&typeof SCScheduleTime.displayTimeForDay==='function') return SCScheduleTime.displayTimeForDay(day,t);
  const sat={'1시':'9시','2시':'10시','3시':'11시','4시':'12시','5시':'1시','6시':'2시'};
  return String(day||'').replace('요일','')==='토' ? (sat[t]||t||'') : (t||'');
}
function displayStudentTime(s){
  return displayTimeForDay(s?.d,s?.t);
}
function displayTargetTime(t){
  return displayTimeForDay(t?.d||t?.day,t?.t);
}

function applyParentBundle(bundle){
  bundle=bundle||{};
  const norm=(key,val)=>window.SCScheduleTime&&typeof SCScheduleTime.normalizeStoredValue==='function'
    ? SCScheduleTime.normalizeStoredValue(key,val)
    : val;
  STUDENTS=norm('swim_students',Array.isArray(bundle.students)?bundle.students:[]);
  INST_MAP=norm('swim_inst',bundle.inst||{});
  MARK_MAP=norm('swim_mark',bundle.mark||{});
  CLOSED_LIST=Array.isArray(bundle.closed)?bundle.closed:[];
  const parsedPeriods=Array.isArray(bundle.periods)&&bundle.periods.length ? bundle.periods : null;
  SCHEDULE_PERIODS=parsedPeriods || JSON.parse(JSON.stringify(_DEFAULT_PERIODS));
  HYUWON_MAP=norm('swim_hyuwon',bundle.hyuwon||{});
  RESERVE_MAP={};
  REQUESTS=norm('swim_requests',bundle.requests||{});
}

function parentErrorMessage(error, fallback){
  const msg=error&&error.message ? String(error.message) : '';
  if(msg) return msg.replace(/^FirebaseError:\s*/,'');
  return fallback||'처리 실패';
}

async function callParent(action, payload){
  const branch=getBranchInfo();
  if(!branch) throw new Error('지점을 선택해주세요');
  if(!_parentFn) initFirebase();
  if(!_parentFn) throw new Error('연결 준비가 되지 않았습니다');
  const res=await _parentFn(Object.assign({action, branch:branch.id}, payload||{}));
  return res&&res.data ? res.data : {};
}

async function refreshParentBundle(options){
  options=options||{};
  if(!_parentSessionToken) return;
  const data=await callParent('refresh',{sessionToken:_parentSessionToken});
  applyParentBundle(data.bundle||{});
  if(options.render!==false && _currentStudents.length) renderDashboard();
}

function startParentRefresh(){
  stopParentRefresh();
  _parentRefreshTimer=setInterval(()=>{
    refreshParentBundle().catch(e=>console.warn('parent refresh failed',e));
  },45000);
}

function stopParentRefresh(){
  if(_parentRefreshTimer){
    clearInterval(_parentRefreshTimer);
    _parentRefreshTimer=null;
  }
}

function currentFeedbackStudent(){
  const student=_currentStudent || (_currentStudents&&_currentStudents[0]) || null;
  if(student){
    return {
      name:student.n||'',
      phone:normalizePhone(student.p||''),
      slotKey:[student.t,student.d,student.l,student.r].join('/'),
    };
  }
  return {
    name:String(document.getElementById('login-name')?.value||'').trim(),
    phone:normalizePhone(document.getElementById('login-phone')?.value||''),
    slotKey:'',
  };
}

function openFeedbackModal(context){
  _feedbackContext=context||'의견 제출';
  const modal=document.getElementById('feedback-modal');
  const ctx=document.getElementById('feedback-context');
  const msg=document.getElementById('feedback-message');
  const name=document.getElementById('feedback-name');
  const phone=document.getElementById('feedback-phone');
  const student=currentFeedbackStudent();
  if(ctx) ctx.textContent=`${_feedbackContext}에 대한 오류나 의견을 남겨주세요.`;
  if(msg) msg.value='';
  if(name) name.value=student.name||'';
  if(phone) phone.value=student.phone||'';
  if(modal) modal.style.display='flex';
  setTimeout(()=>msg&&msg.focus(),40);
}

function closeFeedbackModal(){
  const modal=document.getElementById('feedback-modal');
  if(modal) modal.style.display='none';
}

async function submitFeedback(){
  const btn=document.getElementById('feedback-submit');
  const msgEl=document.getElementById('feedback-message');
  const message=String(msgEl?.value||'').trim();
  if(!message){
    toast('내용을 입력해주세요','err');
    msgEl&&msgEl.focus();
    return;
  }
  const student=currentFeedbackStudent();
  const name=String(document.getElementById('feedback-name')?.value||student.name||'').trim();
  const phone=normalizePhone(document.getElementById('feedback-phone')?.value||student.phone||'');
  const original=btn?btn.textContent:'';
  try{
    if(btn){btn.disabled=true;btn.textContent='제출 중...';}
    await callParent('submitFeedback',{
      sessionToken:_parentSessionToken||'',
      context:_feedbackContext,
      message,
      name,
      phone,
      studentSlotKey:student.slotKey||'',
      page:location.pathname+location.search,
      userAgent:navigator.userAgent||'',
    });
    closeFeedbackModal();
    toast('의견이 접수되었습니다. 감사합니다!','ok');
  }catch(e){
    toast(parentErrorMessage(e,'의견 접수 실패'),'err');
    console.error(e);
  }finally{
    if(btn){btn.disabled=false;btn.textContent=original||'제출하기';}
  }
}

function instOfStudent(s){
  return s ? INST_MAP[s.t+'/'+s.d+'/'+s.l] : null;
}
function studentSlotKey(s){
  return s ? [s.t,s.d,s.l,s.r].join('/') : '';
}
function studentBySlotKey(slotKey){
  return (_currentStudents||[]).find(s=>studentSlotKey(s)===slotKey) || null;
}
function defaultVehicleModeForSlot(slotKey){
  const s=studentBySlotKey(slotKey);
  if(!s) return 'self';
  return [s.bus,s.vehicleName,s.car,s.route,s.loc].some(v=>String(v||'').trim()) ? 'bus' : 'self';
}
function instKind(inst){
  if(!inst) return null;
  if(inst.cls==='elma'||inst.cls==='elite'||inst.cls==='master') return inst.cls;
  if(inst.elma) return 'elma';
  return null;
}
function instClassTags(inst){
  const tags=[];
  if(inst?.youth) tags.push({key:'youth', label:'유아반'});
  const kind=instKind(inst);
  if(kind==='elma') tags.push({key:'elma', label:'엘/마반'});
  else if(kind==='elite') tags.push({key:'elite', label:'엘리트반'});
  else if(kind==='master') tags.push({key:'master', label:'마스터반'});
  return tags;
}
function instClassText(inst){
  return instClassTags(inst).map(t=>t.label).join(' · ');
}
function instClassBadgeHtml(inst){
  return instClassTags(inst).map(t=>`<span class="class-badge ${t.key}">${esc(t.label)}</span>`).join('');
}
function isNoMakeupInst(inst){
  const kind=instKind(inst);
  return kind==='elite'||kind==='master';
}

/* ── 실시간 sync ── */
function subscribeChanges(){
  // 학부모 페이지는 DB를 직접 구독하지 않는다.
}

/* ── Firebase 저장 ── */
function saveMark(){
  return Promise.reject(new Error('학부모 페이지에서는 직접 저장할 수 없습니다'));
}
function updateMarkTx(mutator){
  return Promise.reject(new Error('학부모 페이지에서는 직접 저장할 수 없습니다'));
}
function saveReserve(){
  return Promise.reject(new Error('학부모 페이지에서는 직접 저장할 수 없습니다'));
}
function saveRequests(){
  return Promise.reject(new Error('학부모 페이지에서는 직접 저장할 수 없습니다'));
}
function updateRequestsTx(mutator){
  return Promise.reject(new Error('학부모 페이지에서는 직접 저장할 수 없습니다'));
}
function addRequestEntries(entries){
  return updateRequestsTx((reqs,abort)=>{
    const pending=Object.values(reqs||{}).filter(req=>!req.status||req.status==='pending');
    const seenTargets=new Set();
    const seenSources=new Set();
    for(const entry of Object.values(entries||{})){
      if(entry.type==='bogang'){
        const t=entry.target||{};
        const key=[t.t,t.d,t.l,t.r,t.ds].join('/');
        if(seenTargets.has('bogang/'+key)){
          abort('같은 보강 자리가 중복 선택되었습니다');
          return;
        }
        seenTargets.add('bogang/'+key);
        const occupied=pending.some(req=>{
          if(req.type!=='bogang') return false;
          const rt=req.target||{};
          return [rt.t,rt.d,rt.l,rt.r,rt.ds].join('/')===key;
        });
        if(occupied){
          abort('이미 다른 학부모가 같은 보강 자리를 신청했습니다');
          return;
        }
        const sourceKey=[entry.parent?.studentSlotKey||'', entry.parent?.absentDs||''].join('/');
        if(entry.parent?.studentSlotKey && entry.parent?.absentDs){
          if(!seenSources.has(sourceKey)){
            const sourcePending=pending.some(req=>
              req.type==='bogang'
              && req.parent?.studentSlotKey===entry.parent?.studentSlotKey
              && req.parent?.absentDs===entry.parent?.absentDs
            );
            if(sourcePending){
              abort('이미 이 결석일에 대한 보강 신청이 접수되었습니다');
              return;
            }
            seenSources.add(sourceKey);
          }
        }
      }
      if(entry.type==='absent-cancel'){
        const key=(entry.parent?.studentSlotKey||'')+'/'+(entry.target?.ds||'');
        const exists=pending.some(req=>
          req.type==='absent-cancel'
          && req.parent?.studentSlotKey===entry.parent?.studentSlotKey
          && req.target?.ds===entry.target?.ds
        );
        if(exists){
          abort('이미 취소 신청이 접수되었습니다');
          return;
        }
        if(seenTargets.has('cancel/'+key)){
          abort('같은 결석 취소 신청이 중복되었습니다');
          return;
        }
        seenTargets.add('cancel/'+key);
      }
    }
    Object.assign(reqs, entries);
    return reqs;
  });
}
function makeReqId(){ return 'r_'+Date.now()+'_'+Math.random().toString(36).slice(2,6); }

/* ════════════════════════════════════════════════════════════════
 * 인증
 * ════════════════════════════════════════════════════════════════ */
function normalizePhone(v){
  return String(v||'').replace(/\D/g,'');
}
function findStudents(name, phoneInput){
  const nm=name.trim();
  const phone=normalizePhone(phoneInput);
  if(!nm||!phone) return [];
  return STUDENTS.filter(s=>{
    if(s.n!==nm) return false;
    if(!s.p) return false;
    return normalizePhone(s.p)===phone;
  });
}

// 같은 이름+같은 전체 전화번호 → 한 사람(그룹)으로 묶기
function groupByIdentity(students){
  const groups={};  // key: name|fullPhone → [student, ...]
  students.forEach(s=>{
    const k=s.n+'|'+(s.p||'');
    if(!groups[k]) groups[k]=[];
    groups[k].push(s);
  });
  return Object.values(groups);
}

async function handleLogin(){
  const name=document.getElementById('login-name').value;
  const phone=document.getElementById('login-phone').value;
  const btn=document.getElementById('login-btn');
  const errEl=document.getElementById('login-error');
  errEl.style.display='none';

  if(!name.trim()||!phone.trim()){
    errEl.textContent='이름과 전화번호를 입력해주세요';
    errEl.style.display='block';return;
  }
  const phoneDigits=normalizePhone(phone);
  if(!/^\d{9,11}$/.test(phoneDigits)){
    errEl.textContent='전화번호 전체를 숫자로 입력해주세요';
    errEl.style.display='block';return;
  }
  const originalText=btn?btn.textContent:'';
  if(btn){btn.disabled=true;btn.textContent='확인 중...';}
  try{
    const data=await callParent('login',{name:name.trim(),phone:phoneDigits});
    _parentSessionToken=data.sessionToken||null;
    if(!_parentSessionToken) throw new Error('로그인 세션을 만들지 못했습니다');
    try{sessionStorage.setItem(PARENT_SESSION_KEY,_parentSessionToken);}catch(e){}
    applyParentBundle(data.bundle||{});
    const groups=groupByIdentity(STUDENTS);
    if(groups.length===1){
      loginAs(groups[0]);
    } else if(groups.length>1){
      showStudentSelector(groups);
    } else {
      throw new Error('일치하는 정보가 없습니다. 이름 또는 전화번호를 확인해주세요');
    }
  }catch(e){
    errEl.textContent=parentErrorMessage(e,'일치하는 정보가 없습니다. 이름 또는 전화번호를 확인해주세요');
    errEl.style.display='block';
  }finally{
    if(btn){btn.disabled=false;btn.textContent=originalText||'로그인';}
  }
}

function showStudentSelector(groups){
  const container=document.getElementById('student-choices');
  container.innerHTML='';
  groups.forEach(grp=>{
    const s=grp[0];
    const div=document.createElement('div');
    div.className='choice-item';
    const slotCount=grp.length;
    const classList=grp.map(x=>{
      const label=instClassText(instOfStudent(x));
      return `${x.d} ${displayStudentTime(x)}${label?' · '+label:''}`;
    }).join(' · ');
    div.innerHTML=`<div class="cname">${esc(s.n)}${s.a?'('+s.a+'살)':''}${slotCount>1?` · ${slotCount}개 수업`:''}</div>
                   <div class="cinfo">${esc(classList)}</div>`;
    div.onclick=()=>loginAs(grp);
    container.appendChild(div);
  });
  document.getElementById('login-screen').style.display='none';
  document.getElementById('select-screen').style.display='flex';
}

function loginAs(students){
  // students: 배열 (같은 학생의 모든 슬롯)
  if(!Array.isArray(students)) students=[students];
  _currentStudents=students;
  _currentStudent=students[0];  // 하위 호환
  document.getElementById('login-screen').style.display='none';
  document.getElementById('select-screen').style.display='none';
  document.getElementById('dashboard').style.display='flex';
  // 세션 저장 (모든 슬롯 키)
  try{
    const keys=students.map(s=>s.t+'/'+s.d+'/'+s.l+'/'+s.r).join(',');
    sessionStorage.setItem('parent_stu_keys', keys);
    if(_parentSessionToken) sessionStorage.setItem(PARENT_SESSION_KEY,_parentSessionToken);
  }catch(e){}
  startParentRefresh();
  renderDashboard();
}

function logout(){
  stopParentRefresh();
  _currentStudents=[];
  _currentStudent=null;
  _parentSessionToken=null;
  try{
    sessionStorage.removeItem(PARENT_SESSION_KEY);
    sessionStorage.removeItem('parent_stu_keys');
    sessionStorage.removeItem('parent_stu_key');  // 이전 버전 호환
  }catch(e){}
  document.getElementById('dashboard').style.display='none';
  document.getElementById('select-screen').style.display='none';
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('login-name').value='';
  document.getElementById('login-phone').value='';
  document.getElementById('login-error').style.display='none';
}

/* ════════════════════════════════════════════════════════════════
 * 대시보드 (다중 슬롯 지원)
 * ════════════════════════════════════════════════════════════════ */
function renderDashboard(){
  if(!_currentStudents.length) return;

  // 최신 데이터 동기화 — 모든 슬롯에 학생이 살아있는지 확인
  const fresh=[];
  for(const s of _currentStudents){
    const found=STUDENTS.find(x=>x.t===s.t&&x.d===s.d&&x.l===s.l&&x.r===s.r);
    if(found) fresh.push(found);
  }
  if(!fresh.length){
    alert('등록 정보가 삭제되었습니다. 다시 로그인해주세요.');
    logout();return;
  }
  _currentStudents=fresh;
  _currentStudent=fresh[0];

  const s=fresh[0];
  // 헤더
  document.getElementById('child-display').textContent=s.n+(s.a?'('+s.a+'살)':'');
  const slotCount=fresh.length;
  const inst=instOfStudent(s);
  const classLabel=instClassText(inst);
  document.getElementById('class-info').textContent=
    slotCount===1
      ? `${s.d}요일 ${displayStudentTime(s)} · ${instNameOf(s)} 선생님${classLabel?' · '+classLabel:''}`
      : `총 ${slotCount}개 수업 · ${s.p?esc(s.p):''}`;

  // 이번달/다음달 수업일
  const curPi=getCurrentPeriod();
  const curP=SCHEDULE_PERIODS[curPi];
  const nxtP=SCHEDULE_PERIODS[curPi+1]||null;

  document.getElementById('period-label').textContent=curP?`${curP.month}월 수업`:'이번달 수업';
  document.getElementById('date-list').innerHTML=renderMultiSlots(fresh, curP);

  if(nxtP){
    document.getElementById('next-period-label').textContent=`${nxtP.month}월 수업`;
    document.getElementById('next-date-list').innerHTML=renderMultiSlots(fresh, nxtP);
    document.getElementById('next-period-wrap').style.display='block';
  } else {
    document.getElementById('next-period-wrap').style.display='none';
  }

  // [v118] 내 신청 내역
  renderMyRequests(fresh);
}

// [v118] 내 신청 내역 (결석 + 보강 요청)
function renderMyRequests(students){
  const wrap = document.getElementById('my-requests-list');
  if(!wrap) return;
  const todayStr = toDateStr(typeof getToday==='function' ? getToday() : new Date());
  const childName = students[0]?.n;
  const childPhone = students[0]?.p || '';
  const slotKeys = students.map(s => s.t+'/'+s.d+'/'+s.l+'/'+s.r);
  const items = [];

  // 1. 결석 (MARK_MAP에서 학생 slotKey의 absent 마크)
  Object.entries(MARK_MAP||{}).forEach(([key, mark])=>{
    if(!mark) return;
    const parts = key.split('/');
    if(parts.length !== 5) return;
    const slotKey = parts.slice(0,4).join('/');
    const ds = parts[4];
    if(!slotKeys.includes(slotKey)) return;
    if(ds < todayStr) return; // 과거 X
    if(mark.type === 'absent'){
      const stu = students.find(s => slotKey === s.t+'/'+s.d+'/'+s.l+'/'+s.r);
      const classLabel = instClassText(instOfStudent(stu));
      items.push({
        type: 'absent', ds,
        title: '❌ 결석',
        sub: `${stu?.d}요일 ${displayStudentTime(stu)}${classLabel?' · '+classLabel:''}`,
        status: mark.sub ? `보강 신청됨 (${mark.sub.n||''})` : '대기',
        color: '#EF4444'
      });
    }
  });

  // 2. 보강 요청 (REQUESTS에서 본인 자녀의 보강)
  const bogangReqs=[];
  Object.entries(REQUESTS||{}).forEach(([id, req])=>{
    if(!req || req.type !== 'bogang') return;
    if(req.parent?.name !== childName) return;
    if(childPhone && req.parent?.phone && req.parent.phone !== childPhone) return;
    bogangReqs.push([id,req]);
  });
  groupParentBogangRequests(bogangReqs).forEach(group=>{
    const accepted=group.items.find(([,req])=>req.status==='accepted');
    const pending=group.items.filter(([,req])=>!req.status || req.status==='pending');
    const rejected=group.items.filter(([,req])=>req.status==='rejected');
    const cancelled=group.items.filter(([,req])=>req.status==='cancelled');
    const visiblePair=accepted || pending[0] || rejected[0] || cancelled[0];
    if(!visiblePair) return;
    const req=visiblePair[1];
    const ds=req.target?.ds || req.parent?.absentDs || '';
    if(!ds || ds < todayStr) return;
    let status='⏳ 선생님 승인 대기';
    let sub='';
    if(accepted){
      status='✅ 확정';
      sub=`확정: ${formatParentBogangTarget(accepted[1])}`;
      if(group.items.length>1) sub+=` · 후보 ${group.items.length}개 중 선택`;
    }else if(pending.length){
      const labels=group.items.map(([,r])=>formatParentBogangTarget(r)).filter(Boolean);
      status='⏳ 선생님 승인 대기';
      sub=`후보 ${group.items.length}개: ${labels.slice(0,3).join(' / ')}${labels.length>3?' 외':''}`;
    }else if(cancelled.length){
      status='↩️ 신청 취소';
      sub=group.items.length>1 ? `후보 ${group.items.length}개 취소` : `${formatParentBogangTarget(req)} 취소`;
    }else{
      status='⛔ 거절';
      sub=group.items.length>1 ? `후보 ${group.items.length}개 거절` : `${formatParentBogangTarget(req)} 거절`;
    }
    items.push({
      type: 'bogang', ds,
      title: '📅 보강 신청',
      sub,
      status,
      color: '#7C3AED'
    });
  });

  // 3. 결석 취소 요청
  Object.entries(REQUESTS||{}).forEach(([id, req])=>{
    if(!req || req.type !== 'absent-cancel') return;
    if(req.parent?.name !== childName) return;
    if(childPhone && req.parent?.phone && req.parent.phone !== childPhone) return;
    const t = req.target;
    if(!t?.ds || t.ds < todayStr) return;
    const status = req.status === 'accepted' ? '✅ 취소 완료'
                 : req.status === 'rejected' ? '⛔ 거절'
                 : '⏳ 선생님 승인 대기';
    const classLabel = instClassText(INST_MAP[req.instKey]);
    items.push({
      type: 'absent-cancel', ds: t.ds,
      title: '✓ 결석 취소',
      sub: `${t.d}요일 ${displayTargetTime(t)}${classLabel?' · '+classLabel:''}`,
      status,
      color: '#10B981'
    });
  });

  // 4. 보강 취소 요청
  Object.entries(REQUESTS||{}).forEach(([id, req])=>{
    if(!req || req.type !== 'bogang-cancel') return;
    if(req.parent?.name !== childName) return;
    if(childPhone && req.parent?.phone && req.parent.phone !== childPhone) return;
    const ds = req.parent?.absentDs || req.target?.ds || '';
    if(!ds || ds < todayStr) return;
    const status = req.status === 'accepted' ? '✅ 보강 취소 완료'
                 : req.status === 'rejected' ? '⛔ 거절'
                 : '⏳ 선생님 승인 대기';
    items.push({
      type: 'bogang-cancel', ds,
      title: '↩️ 보강 취소',
      sub: formatParentBogangTarget(req),
      status,
      color: '#6B7280'
    });
  });

  // 정렬: 날짜순
  items.sort((a,b) => a.ds.localeCompare(b.ds));

  if(!items.length){
    wrap.innerHTML = '<div style="background:#fff;padding:20px;text-align:center;color:#9CA3AF;font-size:13px;border-radius:10px">아직 신청한 내역이 없습니다</div>';
    return;
  }
  const _fdate = ds => { const p=ds.split('-'); return `${parseInt(p[1])}/${parseInt(p[2])}`; };
  wrap.innerHTML = items.map(it => `
    <div style="background:#fff;padding:10px 14px;border-radius:10px;border-left:4px solid ${it.color};margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
        <span style="font-weight:800;font-size:13px;color:${it.color}">${it.title} · ${_fdate(it.ds)}</span>
        <span style="font-size:11px;color:#6B7280;font-weight:600">${esc(it.status)}</span>
      </div>
      <div style="font-size:11px;color:#6B7280">${esc(it.sub)}</div>
    </div>
  `).join('');
}

function parentBogangGroupKey(id, req){
  if(req?.choiceGroupId) return `group:${req.choiceGroupId}`;
  const p=req?.parent||{};
  const studentKey=p.studentSlotKey || [p.name||'',p.phone||''].join('/');
  const sourceDs=p.absentDs || req?.sourceDs || '';
  const requestedAt=req?.requestedAt || '';
  if(studentKey && requestedAt) return `legacy:${studentKey}|${sourceDs}|${requestedAt}`;
  return `single:${id}`;
}
function groupParentBogangRequests(reqs){
  const map=new Map();
  reqs.forEach(([id,req])=>{
    const key=parentBogangGroupKey(id,req);
    if(!map.has(key)) map.set(key,{key,items:[],requestedAt:req.requestedAt||''});
    const group=map.get(key);
    group.items.push([id,req]);
    if((req.requestedAt||'')>(group.requestedAt||'')) group.requestedAt=req.requestedAt||'';
  });
  const groups=[...map.values()];
  groups.forEach(group=>{
    group.items.sort((a,b)=>{
      const at=a[1].target||{}, bt=b[1].target||{};
      return [at.ds||'',at.d||'',at.t||''].join('|').localeCompare([bt.ds||'',bt.d||'',bt.t||''].join('|'));
    });
  });
  groups.sort((a,b)=>(b.requestedAt||'').localeCompare(a.requestedAt||''));
  return groups;
}
function formatParentBogangTarget(req){
  const t=req?.target||{};
  if(!t.ds && !t.d && !t.t) return '';
  const teacher=t.instName ? ` · ${t.instName} 선생님` : '';
  const classLabel=instClassText(INST_MAP[req.instKey]) || t.classLabel || '';
  return `${t.d||''}요일 ${displayTargetTime(t)}${teacher}${classLabel?' · '+classLabel:''}`;
}
function formatParentShortDate(ds){
  const parts=String(ds||'').split('-');
  if(parts.length<3) return String(ds||'');
  return `${parseInt(parts[1],10)}/${parseInt(parts[2],10)}`;
}
function parentAcceptedBogangFor(slotKey,ds){
  return Object.values(REQUESTS||{}).find(req=>
    req && req.type==='bogang' &&
    req.status==='accepted' &&
    req.parent?.studentSlotKey===slotKey &&
    req.parent?.absentDs===ds
  ) || null;
}
function formatParentBogangBookedButton(req){
  const date=formatParentShortDate(req?.target?.ds);
  return `${date||'보강'} 보강 잡힘`;
}

function instNameOf(s){
  const inst=INST_MAP[s.t+'/'+s.d+'/'+s.l];
  return inst?.n||'미정';
}

function renderMultiSlots(students, period){
  if(!period) return '<div style="padding:20px;text-align:center;color:#9CA3AF">수업일 없음</div>';
  if(students.length===1){
    const s=students[0];
    const slotKey=s.t+'/'+s.d+'/'+s.l+'/'+s.r;
    return renderDateList(slotKey,period,s.d);
  }
  // 여러 슬롯: 섹션별로 렌더
  return students.map(s=>{
    const slotKey=s.t+'/'+s.d+'/'+s.l+'/'+s.r;
    const inst=instOfStudent(s);
    const instName=instNameOf(s);
    return `<div class="slot-section">
      <div class="slot-title">📍 ${esc(s.d)}요일 ${esc(displayStudentTime(s))} · ${esc(instName)} 선생님${instClassBadgeHtml(inst)}</div>
      <div class="slot-dates">${renderDateList(slotKey,period,s.d)}</div>
    </div>`;
  }).join('');
}

function getCurrentPeriod(){
  const todayStr=toDateStr(new Date());
  for(let i=SCHEDULE_PERIODS.length-1;i>=0;i--){
    if(todayStr>=SCHEDULE_PERIODS[i].start) return i;
  }
  return 0;
}

function getClassDatesForDay(period,day){
  if(!period) return [];
  const DAY_INDEX={'월':1,'화':2,'수':3,'목':4,'금':5,'토':6,'일':0};
  const targetDows=[];
  const exact=DAY_INDEX[day];
  if(exact!==undefined) targetDows.push(exact);
  else String(day||'').split('').forEach(ch=>{
    const idx=DAY_INDEX[ch];
    if(idx!==undefined&&!targetDows.includes(idx)) targetDows.push(idx);
  });
  if(!targetDows.length) return [];
  const dates=[];
  const start=new Date(period.start);
  const end=new Date(period.end);
  const cur=new Date(start);
  while(cur<=end){
    if(targetDows.includes(cur.getDay())){
      const ds=toDateStr(cur);
      dates.push({ds, closed:isClosedDate(ds)});
    }
    cur.setDate(cur.getDate()+1);
  }
  return dates;
}

function isClosedDate(ds){
  for(const entry of CLOSED_LIST){
    const s=entry.start, e=entry.end||entry.start;
    if(ds>=s&&ds<=e) return entry.type||'휴관';
  }
  return null;
}

function renderDateList(slotKey,period,day){
  const dates=getClassDatesForDay(period,day);
  if(!dates.length) return '<div style="padding:20px;text-align:center;color:#9CA3AF">수업일 없음</div>';
  const todayStr=toDateStr(new Date());
  const [slotT,slotD,slotL]=slotKey.split('/');
  const sourceNoMakeup=isNoMakeupInst(INST_MAP[slotT+'/'+slotD+'/'+slotL]);

  return dates.map(d=>{
    const ds=d.ds;
    const isPast=ds<todayStr;
    const isToday=ds===todayStr;
    const closedLabel=d.closed;
    const markKey=slotKey+'/'+ds;
    const mark=MARK_MAP[markKey];

    // 휴원 체크
    const hy=HYUWON_MAP[slotKey];
    const isHyuwon=hy&&hy.dates&&hy.dates.includes(ds);

    let cls='date-item';
    if(isPast) cls+=' past';
    if(isToday) cls+=' today';
    if(closedLabel) cls+=' closed';
    if(isHyuwon) cls+=' hyuwon';
    if(mark?.type==='absent') cls+=' absent';
    if(mark?.type==='bogang'||(mark?.type==='absent'&&mark.sub?.type==='bogang')) cls+=' bogang';

    const [y,m,dd]=ds.split('-');
    const dowNames=['일','월','화','수','목','금','토'];
    const dow=dowNames[new Date(ds).getDay()];
    const dateStr=`${parseInt(m)}/${parseInt(dd)} (${dow})`;

    let status='';
    if(closedLabel) status=`🚫 ${closedLabel}`;
    else if(isHyuwon) status='🏥 휴원';
    else if(isToday) status='📍 오늘';
    else if(isPast) status='지난 수업';
    else status='수업 예정';

    if(mark?.type==='absent'){
      const vehicleLabel=mark.vehicleMode==='bus'?'차량이용':(mark.vehicleMode==='self'?'자가등하원':'');
      const vehicleText=vehicleLabel ? ` · ${vehicleLabel}` : '';
      if(mark.sub?.type==='bogang') status='❌ 결석 / 보강: '+esc(mark.sub.n||'')+vehicleText;
      else status='❌ 결석'+vehicleText;
    } else if(mark?.type==='bogang'){
      status='🟣 보강: '+esc(mark.n||'');
    }

    // 대기 중인 요청 체크
    const selfSlot=slotKey;
    let pendingCancel=false;     // 결석 취소 대기 중
    const pendingBogangGroups=new Set();    // 이 날짜에 학부모가 신청한 보강 묶음 수
    let acceptedBogang=null;
    let pendingBogangCancel=false;
    for(const [reqId,req] of Object.entries(REQUESTS)){
      if(req.type==='absent-cancel' && (!req.status || req.status==='pending') && req.parent?.studentSlotKey===selfSlot){
        if(req.target?.ds!==ds) continue;
        pendingCancel=true;
      }
      if(req.type==='bogang' && (!req.status || req.status==='pending') && req.parent?.studentSlotKey===selfSlot){
        const requestDs=req.parent?.absentDs || req.sourceDs || req.target?.ds;
        if(requestDs!==ds) continue;
        pendingBogangGroups.add(parentBogangGroupKey(reqId,req));
      }
      if(req.type==='bogang' && req.status==='accepted' && req.parent?.studentSlotKey===selfSlot && req.parent?.absentDs===ds){
        acceptedBogang=req;
      }
      if(req.type==='bogang-cancel' && (!req.status || req.status==='pending') && req.parent?.studentSlotKey===selfSlot && req.parent?.absentDs===ds){
        pendingBogangCancel=true;
      }
    }

    // 보강 대기 상태 표시
    const pendingBogangCount=pendingBogangGroups.size;
    if(pendingBogangCount>0){
      status=pendingBogangCount>1 ? `⏳ 보강 ${pendingBogangCount}건 승인 대기` : '⏳ 보강 승인 대기';
    } else if(pendingBogangCancel){
      status='⏳ 보강 취소 승인 대기';
    } else if(acceptedBogang){
      status=`✅ ${formatParentBogangBookedButton(acceptedBogang)}`;
    } else if(pendingCancel){
      status='⏳ 결석 취소 승인 대기';
    }

    // 버튼: 미래 수업일만 조작 가능, 휴관일/휴원일 제외
    let actions='';
    if(!isPast && !closedLabel && !isHyuwon){
      const absentOn=mark?.type==='absent';
      if(absentOn){
        const bogangDone = pendingBogangCount > 0 || mark.sub?.type === 'bogang';
        if(pendingCancel){
          actions=`<button class="btn-absent active is-disabled" type="button" disabled>결석 취소 요청중</button>
                   <span class="action-note wait">⏳ 승인 대기</span>`;
        } else {
          // [v118] 결석 누른 상태에서만 보강 신청 가능
          let bogangAction='';
          if(pendingBogangCancel){
            bogangAction=`<button class="btn-bogang done" type="button" disabled>${esc(formatParentBogangBookedButton(acceptedBogang))}</button>
                          <span class="action-note wait">보강 취소 승인 대기</span>`;
          } else if(acceptedBogang){
            bogangAction=`<button class="btn-bogang done" type="button" disabled>${esc(formatParentBogangBookedButton(acceptedBogang))}</button>
                          <button class="btn-bogang-cancel" data-action="cancel-bogang" data-ds="${ds}" data-slot="${slotKey}">보강 취소 요청</button>`;
          } else if(bogangDone){
            bogangAction=`<button class="btn-bogang done" type="button" disabled>보강 신청 완료</button>
                          ${pendingBogangCount>0 ? `<button class="btn-bogang-cancel" data-action="cancel-bogang" data-ds="${ds}" data-slot="${slotKey}">보강 신청 취소</button>` : ''}`;
          } else {
            bogangAction=`<button class="btn-bogang" data-action="request-bogang" data-ds="${ds}" data-slot="${slotKey}">보강 신청하기</button>`;
          }
          const cancelAction=isToday
            ? `<button class="btn-absent active is-disabled" type="button" disabled>당일 취소 유선문의</button>
               <span class="action-note muted">${esc(branchContactText())}</span>`
            : `<button class="btn-absent active" data-action="cancel-absent" data-ds="${ds}" data-slot="${slotKey}">결석 취소 요청</button>`;
          actions=sourceNoMakeup
            ? `${cancelAction}
               <span class="action-note muted">보강 불가</span>`
            : `${cancelAction}
               ${bogangAction}`;
        }
      } else {
        // [v118] 결석 안 한 상태 → 결석 버튼만 (보강 신청 X)
        actions=`<button class="btn-absent" data-action="request-absent" data-ds="${ds}" data-slot="${slotKey}">결석 신청</button>`;
      }
    }

    return `<div class="${cls}">
      <div>
        <div class="dstr">${dateStr}</div>
        <div class="dstatus">${status}</div>
      </div>
      <div class="dactions">${actions}</div>
    </div>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════════
 * 결석 (두 단계 확인 모달)
 * ════════════════════════════════════════════════════════════════ */
function openAbsentModal(ds, slotKey){
  const [y,m,d]=ds.split('-');
  const dowNames=['일','월','화','수','목','금','토'];
  const dow=dowNames[new Date(ds).getDay()];
  // 슬롯 정보 표시
  const [t,day,l,r]=slotKey.split('/');
  const slotInfo=`${day}요일 ${displayTimeForDay(day,t)}`;
  document.getElementById('ab-desc').innerHTML=
    `<strong>${esc(slotInfo)}</strong><br>${parseInt(m)}월 ${parseInt(d)}일(${dow}) 수업을 결석으로 신청하시겠습니까?`;
  const defaultVehicleMode=defaultVehicleModeForSlot(slotKey);
  const vehicleRadio=document.querySelector(`input[name="ab-vehicle-mode"][value="${defaultVehicleMode}"]`);
  if(vehicleRadio) vehicleRadio.checked=true;
  document.getElementById('ab-submit').dataset.ds=ds;
  document.getElementById('ab-submit').dataset.slot=slotKey;
  document.getElementById('ab-form').style.display='block';
  document.getElementById('ab-success').style.display='none';
  document.getElementById('absent-modal').style.display='flex';
}
function openAbsentCancelModal(ds, slotKey){
  if(ds===toDateStr(new Date())){
    alert(sameDayCancelMessage());
    return;
  }
  const [y,m,d]=ds.split('-');
  const dowNames=['일','월','화','수','목','금','토'];
  const dow=dowNames[new Date(ds).getDay()];
  const [t,day,l,r]=slotKey.split('/');
  const slotInfo=`${day}요일 ${displayTimeForDay(day,t)}`;
  document.getElementById('ac-desc').innerHTML=
    `<strong>${esc(slotInfo)}</strong><br>${parseInt(m)}월 ${parseInt(d)}일(${dow}) 결석 취소를 신청하시겠습니까?`;
  document.getElementById('ac-submit').dataset.ds=ds;
  document.getElementById('ac-submit').dataset.slot=slotKey;
  document.getElementById('ac-form').style.display='block';
  document.getElementById('ac-success').style.display='none';
  document.getElementById('absent-cancel-modal').style.display='flex';
}
function closeAbsentModal(){
  document.getElementById('absent-modal').style.display='none';
}
function closeAbsentCancelModal(){
  document.getElementById('absent-cancel-modal').style.display='none';
}

async function submitAbsent(){
  const btn=document.getElementById('ab-submit');
  const ds=btn.dataset.ds;
  const slotKey=btn.dataset.slot;
  if(!slotKey) return;
  const vehicleMode=document.querySelector('input[name="ab-vehicle-mode"]:checked')?.value==='bus' ? 'bus' : 'self';
  try{
    btn.disabled=true;
    const data=await callParent('submitAbsent',{sessionToken:_parentSessionToken,ds,slotKey,vehicleMode});
    applyParentBundle(data.bundle||{});
    document.getElementById('ab-form').style.display='none';
    document.getElementById('ab-success').style.display='block';
    renderDashboard();
  }catch(e){
    toast(parentErrorMessage(e,'저장 실패'),'err');
    console.error(e);
  }finally{
    btn.disabled=false;
  }
}

async function submitAbsentCancel(){
  const btn=document.getElementById('ac-submit');
  const ds=btn.dataset.ds;
  const slotKey=btn.dataset.slot;
  if(!slotKey) return;
  if(ds===toDateStr(new Date())){
    alert(sameDayCancelMessage());
    return;
  }
  try{
    btn.disabled=true;
    const data=await callParent('submitAbsentCancel',{sessionToken:_parentSessionToken,ds,slotKey});
    applyParentBundle(data.bundle||{});
    document.getElementById('ac-form').style.display='none';
    document.getElementById('ac-success').style.display='block';
    renderDashboard();
  }catch(e){
    toast(parentErrorMessage(e,'저장 실패'),'err');
    console.error(e);
  }finally{
    btn.disabled=false;
  }
}

/* ════════════════════════════════════════════════════════════════
 * 보강 신청 (날짜 선택 → 가능한 슬롯 다중 선택)
 * ════════════════════════════════════════════════════════════════ */
let _bgSelectedSlots=[];  // 배열로 변경 (다중 선택)

let _bgSourceSlotKey=null;  // 보강 요청하는 학생의 원래 슬롯
let _bgSourceDs=null;       // 결석한 원래 수업일
let _bgTeacherMode='mine';  // mine | other

function _periodIndexForDate(ds){
  if(!ds) return getCurrentPeriod();
  const idx=SCHEDULE_PERIODS.findIndex(p=>ds>=p.start && (!p.end || ds<=p.end));
  return idx>=0 ? idx : getCurrentPeriod();
}

function _addDaysStr(ds,days){
  const d=new Date(ds+'T12:00:00');
  d.setDate(d.getDate()+days);
  return toDateStr(d);
}

function _getBogangDateOptions(baseDs){
  const baseIdx=_periodIndexForDate(baseDs);
  const periods=[SCHEDULE_PERIODS[baseIdx], SCHEDULE_PERIODS[baseIdx+1]].filter(Boolean);
  const todayStr=toDateStr(new Date());
  const limitStr=_addDaysStr(todayStr,10);
  const dowNames=['일','월','화','수','목','금','토'];
  if(!periods.length){
    const fallback=[];
    for(let i=0;i<=10;i++){
      const d=new Date();
      d.setDate(d.getDate()+i);
      const ds=toDateStr(d);
      if(isClosedDate(ds)) continue;
      const dow=dowNames[d.getDay()];
      if(dow==='일') continue;
      fallback.push({ds,dow,m:d.getMonth()+1,d:d.getDate()});
    }
    return fallback;
  }
  const start=periods[0].start>todayStr ? periods[0].start : todayStr;
  const periodEnd=periods[periods.length-1].end || periods[periods.length-1].start;
  const end=periodEnd<limitStr ? periodEnd : limitStr;
  const dates=[];
  const cur=new Date(start);
  const last=new Date(end);
  while(cur<=last){
      const ds=toDateStr(cur);
      if(!isClosedDate(ds)){
        const dow=dowNames[cur.getDay()];
      if(dow!=='일') dates.push({ds,dow,m:cur.getMonth()+1,d:cur.getDate()});
    }
    cur.setDate(cur.getDate()+1);
  }
  return dates;
}

function _bgSourceStudent(){
  if(!_bgSourceSlotKey) return null;
  return _currentStudents.find(s=>s.t+'/'+s.d+'/'+s.l+'/'+s.r===_bgSourceSlotKey) || _currentStudent;
}

function _bgSourceTeacherName(){
  const s=_bgSourceStudent();
  if(!s) return '';
  return INST_MAP[s.t+'/'+s.d+'/'+s.l]?.n || '';
}

function _renderBgTeacherFilter(){
  const teacher=_bgSourceTeacherName();
  document.querySelectorAll('[data-bg-teacher]').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.bgTeacher===_bgTeacherMode);
  });
  const hint=document.getElementById('bg-teacher-hint');
  if(hint){
    hint.textContent=teacher
      ? (_bgTeacherMode==='mine' ? `${teacher} 선생님 수업만 표시 중입니다.` : `${teacher} 선생님을 제외한 시간표입니다.`)
      : '담당 선생님 정보가 없어 전체 시간표를 표시합니다.';
  }
}

function openBogangModal(ds, slotKey){
  _bgSelectedSlots=[];
  _bgSourceSlotKey=slotKey || (_currentStudent ? _currentStudent.t+'/'+_currentStudent.d+'/'+_currentStudent.l+'/'+_currentStudent.r : null);
  _bgSourceDs=ds||null;
  const src=_bgSourceStudent();
  if(isNoMakeupInst(instOfStudent(src))){
    toast('엘리트반/마스터반은 보강 신청이 불가합니다','err');
    return;
  }
  _bgTeacherMode='mine';
  // 폼/성공 화면 초기화
  document.getElementById('bg-form').style.display='block';
  document.getElementById('bg-success').style.display='none';

  const dateSel=document.getElementById('bg-date');
  dateSel.innerHTML='<option value="">날짜를 선택하세요</option>';
  const dates=_getBogangDateOptions(ds);
  dates.forEach(x=>{
    const opt=document.createElement('option');
    opt.value=x.ds;
    opt.textContent=`${x.m}/${x.d} (${x.dow})`;
    if(ds===x.ds) opt.selected=true;
    dateSel.appendChild(opt);
  });
  if(ds) dateSel.value=ds;

  document.getElementById('bg-slot-wrap').style.display='none';
  document.getElementById('bg-slots').innerHTML='';
  document.getElementById('bg-sel-count').textContent='';
  document.getElementById('bg-submit').disabled=true;
  document.getElementById('bg-submit').textContent='신청';
  _renderBgTeacherFilter();
  document.getElementById('bogang-modal').style.display='flex';

  dateSel.onchange=()=>refreshBogangSlots(dateSel.value);
  if(dateSel.value) refreshBogangSlots(dateSel.value);
}

function closeBogangModal(){
  document.getElementById('bogang-modal').style.display='none';
  _bgSelectedSlots=[];
  _bgSourceDs=null;
}

function setBogangTeacherMode(mode){
  _bgTeacherMode=mode==='other'?'other':'mine';
  _renderBgTeacherFilter();
  refreshBogangSlots(document.getElementById('bg-date')?.value||'');
}

function _bgSlotKey(slot){
  if(!slot) return '';
  return [slot.t,slot.day,slot.lane,slot.row,slot.ds].join('/');
}

function _bgSlotLabel(slot){
  if(!slot) return '';
  const [y,m,d]=(slot.ds||'').split('-');
  const dateLabel=m&&d ? `${parseInt(m)}/${parseInt(d)}` : '';
  return `${dateLabel} ${slot.day} ${displayTargetTime(slot)}`;
}

function _bgSlotSortValue(slot){
  if(window.SCScheduleTime&&typeof SCScheduleTime.sortTimeValue==='function'){
    return SCScheduleTime.sortTimeValue(slot?.day||slot?.d,slot?.t);
  }
  return parseInt(String(slot?.t||'').replace(/\D/g,''),10)||0;
}

function _sortBogangSlots(slots){
  return (Array.isArray(slots)?slots:[]).slice().sort((a,b)=>
    _bgSlotSortValue(a)-_bgSlotSortValue(b) ||
    String(a.instName||'').localeCompare(String(b.instName||''),'ko') ||
    Number(a.lane||0)-Number(b.lane||0) ||
    Number(a.row||0)-Number(b.row||0)
  );
}

function _renderBogangSlotOptions(slots){
  let html='';
  let lastTime='';
  slots.forEach((x,i)=>{
    const timeLabel=displayTargetTime(x);
    if(_bgTeacherMode==='other' && timeLabel!==lastTime){
      html+=`<div class="bg-slot-group-title">${esc(timeLabel)}</div>`;
      lastTime=timeLabel;
    }
    html+=`
      <div class="bg-slot-item ${_bgSelectedSlots.some(s=>_bgSlotKey(s)===_bgSlotKey(x))?'selected':''}" data-idx="${i}">
        <div>
          <div class="slot-main">${x.day}요일 · ${esc(timeLabel)}</div>
          <div class="slot-sub">${esc(x.instName)} 선생님${instClassBadgeHtml(x.inst)}</div>
        </div>
      </div>
    `;
  });
  return html;
}

// 해당 날짜에 자리 있는 슬롯 찾기 (기존 학생, 마크, 그리고 이미 대기중인 보강 요청 모두 제외)
function _parentSlotMaxRows(inst){
  if(window.SCScheduleTime&&typeof SCScheduleTime.isBangteukInst==='function'&&SCScheduleTime.isBangteukInst(inst)) return 6;
  if(inst && (inst.elma || inst.cls==='elma' || inst.cls==='elite' || inst.cls==='master')) return 8;
  return 5;
}

function findAvailableSlots(ds){
  if(!ds) return [];
  const dowNames=['일','월','화','수','목','금','토'];
  const day=dowNames[new Date(ds).getDay()];
  const s=_currentStudent;
  // 모든 내 슬롯 (여러 수업일 때 모두 제외)
  const mySlots=_currentStudents.map(x=>x.t+'/'+x.d+'/'+x.l+'/'+x.r);
  const sourceTeacher=_bgSourceTeacherName();

  // 대기중 요청에서 해당 날짜에 이미 잡힌 슬롯 수집
  const pendingOccupied=new Set();  // key: 'slotKey/ds'
  for(const req of Object.values(REQUESTS)){
    if(req.type!=='bogang') continue;
    if(req.status && req.status!=='pending') continue;
    if(req.target?.ds===ds){
      const k=req.target.t+'/'+req.target.d+'/'+req.target.l+'/'+req.target.r;
      pendingOccupied.add(k+'/'+ds);
    }
  }

  const slotCandidates={};
  for(const [instKey,inst] of Object.entries(INST_MAP)){
    const [t,d,l]=instKey.split('/');
    if(d!==day) continue;
    if(!inst || !inst.n) continue;
    if(isNoMakeupInst(inst)) continue;
    if(sourceTeacher){
      if(_bgTeacherMode==='mine' && inst.n!==sourceTeacher) continue;
      if(_bgTeacherMode==='other' && inst.n===sourceTeacher) continue;
    }
    const k=t+'/'+day+'/'+l;
    slotCandidates[k]={instName:inst.n, inst, classLabel:instClassText(inst), t, day, lane:parseInt(l)};
  }

  const available=[];
  for(const [k,info] of Object.entries(slotCandidates)){
    const maxRows=_parentSlotMaxRows(info.inst);
    let freeRow=null;
    for(let r=1;r<=maxRows;r++){
      const checkKey=info.t+'/'+info.day+'/'+info.lane+'/'+r;
      if(STUDENTS.find(x=>x.t===info.t&&x.d===info.day&&x.l===info.lane&&x.r===r)) continue;
      const mark=MARK_MAP[checkKey+'/'+ds];
      if(mark?.type==='bogang'||mark?.type==='sample') continue;
      if(mark?.type==='absent'&&mark.sub) continue;
      // 이미 대기중인 요청 자리도 제외
      if(pendingOccupied.has(checkKey+'/'+ds)) continue;
      freeRow=r;
      break;
    }
    // 본인이 이미 등록된 슬롯은 모두 제외 (여러 수업 중 하나라도 겹치면)
    const candidateKey=info.t+'/'+info.day+'/'+info.lane+'/'+freeRow;
    if(freeRow && !mySlots.includes(candidateKey)){
      available.push({...info, row:freeRow, ds});
    }
  }
  available.sort((a,b)=>{
    const ta=_bgSlotSortValue(a);const tb=_bgSlotSortValue(b);
    if(ta!==tb) return ta-tb;
    return String(a.instName||'').localeCompare(String(b.instName||''),'ko') || a.lane-b.lane;
  });
  return available;
}

async function refreshBogangSlots(ds){
  _renderBgTeacherFilter();
  const container=document.getElementById('bg-slots');
  const wrap=document.getElementById('bg-slot-wrap');
  wrap.style.display='block';
  if(!ds){
    container.innerHTML='<div class="bg-no-slots">날짜를 선택해주세요.</div>';
    updateBogangSelCount();
    return;
  }
  container.innerHTML='<div class="bg-no-slots">가능한 수업을 확인 중입니다...</div>';
  let slots=[];
  try{
    const data=await callParent('getBogangSlots',{
      sessionToken:_parentSessionToken,
      sourceSlotKey:_bgSourceSlotKey,
      sourceDs:_bgSourceDs,
      ds,
      teacherMode:_bgTeacherMode,
    });
    applyParentBundle(data.bundle||{});
    slots=_sortBogangSlots(data.slots);
  }catch(e){
    container.innerHTML=`<div class="bg-no-slots">${esc(parentErrorMessage(e,'가능한 수업을 불러오지 못했습니다'))}</div>`;
    updateBogangSelCount();
    return;
  }
  if(!slots.length){
    const sourceTeacher=_bgSourceTeacherName();
    const msg=_bgTeacherMode==='mine' && sourceTeacher
      ? '담당 선생님 수업에 가능한 자리가 없습니다.<br>다른 선생님 시간표를 확인해보세요.'
      : '이 날짜에는 가능한 수업이 없습니다.<br>다른 날짜를 선택해주세요.';
    container.innerHTML=`<div class="bg-no-slots">${msg}</div>`;
    updateBogangSelCount();
    return;
  }
  container.innerHTML=_renderBogangSlotOptions(slots);
  // 다중 선택
  container.querySelectorAll('.bg-slot-item').forEach((el,i)=>{
    el.onclick=()=>{
      const slot=slots[i];
      const key=_bgSlotKey(slot);
      const idx=_bgSelectedSlots.findIndex(s=>_bgSlotKey(s)===key);
      if(idx>=0){
        _bgSelectedSlots.splice(idx,1);
        el.classList.remove('selected');
      } else {
        _bgSelectedSlots.push(Object.assign({},slot,{teacherMode:_bgTeacherMode}));
        el.classList.add('selected');
      }
      updateBogangSelCount();
    };
  });
  updateBogangSelCount();
}

function updateBogangSelCount(){
  const n=_bgSelectedSlots.length;
  const count=document.getElementById('bg-sel-count');
  const submit=document.getElementById('bg-submit');
  if(n===0){
    count.textContent='';
    submit.disabled=true;
    submit.textContent='신청';
  } else {
    const labels=_bgSelectedSlots.map(_bgSlotLabel).filter(Boolean);
    count.textContent=`선택된 수업: ${n}개${labels.length?' · '+labels.join(', '):''}`;
    submit.disabled=false;
    submit.textContent=`${n}개 신청`;
  }
}

async function submitBogang(){
  const s=_currentStudent;
  if(!s||!_bgSelectedSlots.length){toast('수업을 선택해주세요','err');return;}
  if(isNoMakeupInst(instOfStudent(_bgSourceStudent()))){
    toast('엘리트반/마스터반은 보강 신청이 불가합니다','err');
    return;
  }
  if(_bgSelectedSlots.some(slot=>isNoMakeupInst(slot.inst))){
    toast('엘리트반/마스터반으로는 보강 신청이 불가합니다','err');
    return;
  }

  const selfSlotKey=_bgSourceSlotKey || (s.t+'/'+s.d+'/'+s.l+'/'+s.r);
  const slots=_bgSelectedSlots.map(slot=>({
    t:slot.t,
    day:slot.day,
    lane:slot.lane,
    row:slot.row,
    ds:slot.ds,
    teacherMode:slot.teacherMode||_bgTeacherMode,
  }));
  const btn=document.getElementById('bg-submit');
  try{
    btn.disabled=true;
    const data=await callParent('submitBogang',{
      sessionToken:_parentSessionToken,
      sourceSlotKey:selfSlotKey,
      sourceDs:_bgSourceDs,
      slots,
    });
    applyParentBundle(data.bundle||{});
    // 성공 화면 표시
    document.getElementById('bg-form').style.display='none';
    document.getElementById('bg-success').style.display='block';
    document.getElementById('bg-success-msg').innerHTML=
      `총 <strong>${_bgSelectedSlots.length}개</strong>의 후보를 보냈습니다.<br>담당 선생님이 이 중 하나를 확정합니다.`;
    renderDashboard();
  }catch(e){
    toast(parentErrorMessage(e,'신청 실패'),'err');
    console.error(e);
  }finally{
    btn.disabled=false;
  }
}

async function cancelBogangRequest(ds, slotKey){
  if(!ds || !slotKey) return;
  const accepted=parentAcceptedBogangFor(slotKey,ds);
  const msg=accepted
    ? `${formatParentBogangBookedButton(accepted)} 보강수업 취소를 요청하시겠습니까?`
    : '보강 신청을 취소하시겠습니까?';
  if(!confirm(msg)) return;
  try{
    const data=await callParent('cancelBogang',{
      sessionToken:_parentSessionToken,
      sourceSlotKey:slotKey,
      sourceDs:ds,
    });
    applyParentBundle(data.bundle||{});
    renderDashboard();
    toast(data.cancelStatus==='requested' ? '보강 취소 요청을 접수했습니다' : '보강 신청을 취소했습니다','ok');
  }catch(e){
    toast(parentErrorMessage(e,'보강 취소 실패'),'err');
    console.error(e);
  }
}

/* ════════════════════════════════════════════════════════════════
 * 유틸
 * ════════════════════════════════════════════════════════════════ */
function toDateStr(d){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const dd=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function toast(msg,type){
  const el=document.getElementById('toast');
  el.textContent=msg;
  el.className='toast show '+(type||'');
  clearTimeout(toast._t);
  toast._t=setTimeout(()=>{el.classList.remove('show');},2400);
}

/* ════════════════════════════════════════════════════════════════
 * 이벤트 바인딩 + 초기화
 * ════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async ()=>{
  initFirebase();

  // 세션 복구
  try{
    _parentSessionToken=sessionStorage.getItem(PARENT_SESSION_KEY);
    if(_parentSessionToken){
      await loadAllData();
      if(STUDENTS.length) loginAs(STUDENTS);
    }
  }catch(e){
    console.warn('세션 복구 실패:',e);
    try{sessionStorage.removeItem(PARENT_SESSION_KEY);}catch(_e){}
    _parentSessionToken=null;
  }

  // 로그인 버튼
  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('login-phone').addEventListener('keydown',e=>{
    if(e.key==='Enter') handleLogin();
  });
  document.getElementById('login-name').addEventListener('keydown',e=>{
    if(e.key==='Enter') document.getElementById('login-phone').focus();
  });

  // 학생 선택 → 로그인 돌아가기
  document.getElementById('back-to-login').addEventListener('click',()=>{
    document.getElementById('select-screen').style.display='none';
    document.getElementById('login-screen').style.display='flex';
  });

  // 로그아웃
  document.getElementById('logout-btn').addEventListener('click',()=>{
    if(confirm('로그아웃하시겠습니까?')) logout();
  });

  // 날짜 액션 (이벤트 위임)
  document.addEventListener('click',e=>{
    const btn=e.target.closest('[data-action]');
    if(!btn) return;
    const ds=btn.dataset.ds;
    const slotKey=btn.dataset.slot;
    const act=btn.dataset.action;
    if(act==='request-absent') openAbsentModal(ds, slotKey);
    else if(act==='cancel-absent') openAbsentCancelModal(ds, slotKey);
    else if(act==='request-bogang') openBogangModal(ds, slotKey);
    else if(act==='cancel-bogang') cancelBogangRequest(ds, slotKey);
  });

  // 결석 모달
  document.getElementById('ab-cancel').addEventListener('click', closeAbsentModal);
  document.getElementById('ab-submit').addEventListener('click', submitAbsent);
  document.getElementById('ab-success-close').addEventListener('click', closeAbsentModal);
  document.getElementById('absent-modal').addEventListener('click',e=>{
    if(e.target.id==='absent-modal') closeAbsentModal();
  });
  document.getElementById('ac-cancel').addEventListener('click', closeAbsentCancelModal);
  document.getElementById('ac-submit').addEventListener('click', submitAbsentCancel);
  document.getElementById('ac-success-close').addEventListener('click', closeAbsentCancelModal);
  document.getElementById('absent-cancel-modal').addEventListener('click',e=>{
    if(e.target.id==='absent-cancel-modal') closeAbsentCancelModal();
  });

  // 보강 모달
  document.getElementById('bg-cancel').addEventListener('click', closeBogangModal);
  document.getElementById('bg-submit').addEventListener('click', submitBogang);
  document.getElementById('bg-success-close').addEventListener('click', closeBogangModal);
  document.getElementById('bg-teacher-filter')?.addEventListener('click',e=>{
    const btn=e.target.closest('[data-bg-teacher]');
    if(btn) setBogangTeacherMode(btn.dataset.bgTeacher);
  });
  document.getElementById('bogang-modal').addEventListener('click',e=>{
    if(e.target.id==='bogang-modal') closeBogangModal();
  });

  // 오류 보고 / 의견 제출
  document.getElementById('open-feedback-login')?.addEventListener('click',()=>openFeedbackModal('로그인 화면'));
  document.querySelectorAll('[data-feedback-context]').forEach(btn=>{
    btn.addEventListener('click',()=>openFeedbackModal(btn.dataset.feedbackContext||'의견 제출'));
  });
  document.getElementById('feedback-cancel')?.addEventListener('click',closeFeedbackModal);
  document.getElementById('feedback-submit')?.addEventListener('click',submitFeedback);
  document.getElementById('feedback-modal')?.addEventListener('click',e=>{
    if(e.target.id==='feedback-modal') closeFeedbackModal();
  });
});
