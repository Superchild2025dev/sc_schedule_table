/* ════════════════════════════════════════════════════════════════
 * 학부모 페이지
 * - 인증: 아이 이름 + 전화번호 전체 → STUDENTS 매칭
 * - 기능: 결석 마크 토글, 보강 요청
 * - Cloud Functions를 통해 본인 데이터만 로드
 * ════════════════════════════════════════════════════════════════ */

/* ── Firebase 설정 (메인 앱과 동일) ── */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyArHQQfHnVreH8gVamyl1e5IqUDfXUJ5F8",
  authDomain: "scswimming-schedule.firebaseapp.com",
  databaseURL: "https://scswimming-schedule-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "scswimming-schedule",
  storageBucket: "scswimming-schedule.firebasestorage.app",
  messagingSenderId: "45509278949",
  appId: "1:45509278949:web:f16989a9c416f06e25e80c"
};

const FUNCTIONS_REGION='asia-northeast3';
const PARENT_SESSION_KEY='parent_session_token';
const PARENT_SESSION_BRANCH_KEY='parent_session_branch';
let _functions=null, _fbReady=false, _parentSessionToken=null, _parentRefreshTimer=null;
let STUDENTS=[], INST_MAP={}, MARK_MAP={}, CLOSED_LIST=[], SCHEDULE_PERIODS=[], HYUWON_MAP={}, RESERVE_MAP={}, REQUESTS={};

/* [v118] 지점 선택 (가경점/용암점) — 메인 앱과 동일 */
const SELECTED_BRANCH_KEY='selected_branch';
let _selectedBranch=null;
try{ _selectedBranch=localStorage.getItem(SELECTED_BRANCH_KEY); }catch(e){}
function getBranchInfo(){
  if(_selectedBranch==='yongam') return {id:'yongam', name:'용암점', fbPath:'schedule_yongam'};
  if(_selectedBranch==='gagyeong') return {id:'gagyeong', name:'가경점', fbPath:'schedule'};
  return null;
}
function selectBranch(branch){
  if(branch!=='gagyeong' && branch!=='yongam') return;
  try{ localStorage.setItem(SELECTED_BRANCH_KEY, branch); }catch(e){}
  location.reload();
}
function openBranchModal(){
  const m=document.getElementById('branch-modal');
  if(m) m.classList.add('show');
}
function closeBranchModal(){
  const m=document.getElementById('branch-modal');
  if(m) m.classList.remove('show');
}
let _currentStudents=[];  // 로그인된 학생 그룹 (같은 이름+같은 전화번호)
// 하위 호환: 첫 학생을 _currentStudent로도 노출
let _currentStudent=null;

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
    firebase.initializeApp(FIREBASE_CONFIG);
    _functions=firebase.app().functions(FUNCTIONS_REGION);
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
  return _fbReady ? Promise.resolve() : Promise.reject('not ready');
}

function parseJSON(v,def){
  if(!v) return def;
  try{return typeof v==='string'?JSON.parse(v):v;}catch(e){return def;}
}

function instOfStudent(s){
  return s ? INST_MAP[s.t+'/'+s.d+'/'+s.l] : null;
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

function applyParentPayload(data){
  STUDENTS=Array.isArray(data?.students)?data.students:[];
  INST_MAP=data?.inst||{};
  MARK_MAP=data?.mark||{};
  CLOSED_LIST=data?.closed||[];
  SCHEDULE_PERIODS=Array.isArray(data?.periods)&&data.periods.length
    ? data.periods
    : JSON.parse(JSON.stringify(_DEFAULT_PERIODS));
  HYUWON_MAP=data?.hyuwon||{};
  REQUESTS=data?.requests||{};
}
function parentFunctionPayload(extra={}){
  const branch=getBranchInfo();
  if(!branch) throw new Error('지점을 선택해주세요');
  return {...extra, branch:branch.id, token:_parentSessionToken||null};
}
function callParentFunction(name, extra={}){
  if(!_fbReady||!_functions) return Promise.reject(new Error('연결 준비 중입니다'));
  const fn=_functions.httpsCallable(name);
  return fn(parentFunctionPayload(extra)).then(res=>res.data||{});
}
function functionErrorMessage(e, fallback='처리 실패'){
  return e?.message || e?.details?.message || fallback;
}
async function refreshParentData(){
  if(!_parentSessionToken) return;
  const data=await callParentFunction('parentGetData');
  applyParentPayload(data);
  if(_currentStudent) renderDashboard();
}
function startParentRefresh(){
  clearInterval(_parentRefreshTimer);
  _parentRefreshTimer=setInterval(()=>refreshParentData().catch(()=>{}),60000);
}
function stopParentRefresh(){
  clearInterval(_parentRefreshTimer);
  _parentRefreshTimer=null;
}

/* ════════════════════════════════════════════════════════════════
 * 인증
 * ════════════════════════════════════════════════════════════════ */
function normalizePhone(v){
  return String(v||'').replace(/\D/g,'');
}
async function handleLogin(){
  const name=document.getElementById('login-name').value;
  const phone=document.getElementById('login-phone').value;
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
  try{
    const result=await callParentFunction('parentLogin',{name:name.trim(), phone:phoneDigits});
    _parentSessionToken=result.token;
    try{
      sessionStorage.setItem(PARENT_SESSION_KEY,_parentSessionToken);
      sessionStorage.setItem(PARENT_SESSION_BRANCH_KEY,getBranchInfo()?.id||'');
    }catch(e){}
    applyParentPayload(result);
    loginAs(STUDENTS);
  }catch(e){
    errEl.textContent=functionErrorMessage(e,'일치하는 정보가 없습니다. 이름 또는 전화번호를 확인해주세요');
    errEl.style.display='block';
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
      return `${x.d} ${x.t}${label?' · '+label:''}`;
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
  startParentRefresh();
  renderDashboard();
}

function logout(){
  _currentStudents=[];
  _currentStudent=null;
  _parentSessionToken=null;
  stopParentRefresh();
  try{
    sessionStorage.removeItem(PARENT_SESSION_KEY);
    sessionStorage.removeItem(PARENT_SESSION_BRANCH_KEY);
    sessionStorage.removeItem('parent_stu_keys'); // 이전 버전 호환
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
      ? `${s.d}요일 ${s.t} · ${instNameOf(s)} 선생님${classLabel?' · '+classLabel:''}`
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
        sub: `${stu?.d}요일 ${stu?.t}${classLabel?' · '+classLabel:''}`,
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
    const visiblePair=accepted || pending[0] || rejected[0];
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
      sub: `${t.d}요일 ${t.t}${classLabel?' · '+classLabel:''}`,
      status,
      color: '#10B981'
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
  return `${t.d||''}요일 ${t.t||''}${teacher}${classLabel?' · '+classLabel:''}`;
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
      <div class="slot-title">📍 ${esc(s.d)}요일 ${esc(s.t)} · ${esc(instName)} 선생님${instClassBadgeHtml(inst)}</div>
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
  const targetDow=DAY_INDEX[day];
  if(targetDow===undefined) return [];
  const dates=[];
  const start=new Date(period.start);
  const end=new Date(period.end);
  const cur=new Date(start);
  while(cur<=end){
    if(cur.getDay()===targetDow){
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
      if(mark.sub?.type==='bogang') status='❌ 결석 / 보강 배정';
      else status='❌ 결석';
    } else if(mark?.type==='bogang'){
      status=mark.n ? '🟣 보강: '+esc(mark.n) : '🟣 보강';
    }

    // 대기 중인 요청 체크
    const selfSlot=slotKey;
    let pendingCancel=false;     // 결석 취소 대기 중
    const pendingBogangGroups=new Set();    // 이 날짜에 학부모가 신청한 보강 묶음 수
    for(const [reqId,req] of Object.entries(REQUESTS)){
      if(req.status && req.status!=='pending') continue;
      if(req.type==='absent-cancel' && req.parent?.studentSlotKey===selfSlot){
        if(req.target?.ds!==ds) continue;
        pendingCancel=true;
      }
      if(req.type==='bogang' && req.parent?.studentSlotKey===selfSlot){
        const requestDs=req.parent?.absentDs || req.sourceDs || req.target?.ds;
        if(requestDs!==ds) continue;
        pendingBogangGroups.add(parentBogangGroupKey(reqId,req));
      }
    }

    // 보강 대기 상태 표시
    const pendingBogangCount=pendingBogangGroups.size;
    if(pendingBogangCount>0){
      status=pendingBogangCount>1 ? `⏳ 보강 ${pendingBogangCount}건 승인 대기` : '⏳ 보강 승인 대기';
    } else if(pendingCancel){
      status='⏳ 결석 취소 승인 대기';
    }

    // 버튼: 미래 수업일만 조작 가능, 휴관일/휴원일 제외
    let actions='';
    if(!isPast && !closedLabel && !isHyuwon){
      const absentOn=mark?.type==='absent';
      if(absentOn){
        if(pendingCancel){
          actions=`<span style="font-size:10px;color:#F59E0B;font-weight:700">⏳ 승인 대기</span>`;
        } else {
          // [v118] 결석 누른 상태에서만 보강 신청 가능
          actions=sourceNoMakeup
            ? `<button class="btn-absent active" data-action="cancel-absent" data-ds="${ds}" data-slot="${slotKey}">✓ 결석 · 취소</button>
               <span style="font-size:10px;color:#9CA3AF;font-weight:700">보강 불가</span>`
            : `<button class="btn-absent active" data-action="cancel-absent" data-ds="${ds}" data-slot="${slotKey}">✓ 결석 · 취소</button>
               <button class="btn-bogang" data-action="request-bogang" data-ds="${ds}" data-slot="${slotKey}">보강 신청</button>`;
        }
      } else {
        // [v118] 결석 안 한 상태 → 결석 버튼만 (보강 신청 X)
        actions=`<button class="btn-absent" data-action="request-absent" data-ds="${ds}" data-slot="${slotKey}">결석</button>`;
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
  const slotInfo=`${day}요일 ${t}`;
  document.getElementById('ab-desc').innerHTML=
    `<strong>${esc(slotInfo)}</strong><br>${parseInt(m)}월 ${parseInt(d)}일(${dow}) 수업을 결석으로 신청하시겠습니까?`;
  document.getElementById('ab-submit').dataset.ds=ds;
  document.getElementById('ab-submit').dataset.slot=slotKey;
  document.getElementById('ab-form').style.display='block';
  document.getElementById('ab-success').style.display='none';
  document.getElementById('absent-modal').style.display='flex';
}
function openAbsentCancelModal(ds, slotKey){
  const [y,m,d]=ds.split('-');
  const dowNames=['일','월','화','수','목','금','토'];
  const dow=dowNames[new Date(ds).getDay()];
  const [t,day,l,r]=slotKey.split('/');
  const slotInfo=`${day}요일 ${t}`;
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
  const ds=document.getElementById('ab-submit').dataset.ds;
  const slotKey=document.getElementById('ab-submit').dataset.slot;
  if(!slotKey) return;
  try{
    const data=await callParentFunction('parentSubmitAbsent',{slotKey, ds});
    applyParentPayload(data);
    document.getElementById('ab-form').style.display='none';
    document.getElementById('ab-success').style.display='block';
    renderDashboard();
  }catch(e){
    toast(functionErrorMessage(e,'저장 실패'),'err');
    console.error(e);
  }
}

async function submitAbsentCancel(){
  const ds=document.getElementById('ac-submit').dataset.ds;
  const slotKey=document.getElementById('ac-submit').dataset.slot;
  if(!slotKey) return;
  try{
    const data=await callParentFunction('parentSubmitAbsentCancel',{slotKey, ds});
    applyParentPayload(data);
    document.getElementById('ac-form').style.display='none';
    document.getElementById('ac-success').style.display='block';
    renderDashboard();
  }catch(e){
    toast(functionErrorMessage(e,'저장 실패'),'err');
    console.error(e);
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

function _getBogangDateOptions(baseDs){
  const baseIdx=_periodIndexForDate(baseDs);
  const periods=[SCHEDULE_PERIODS[baseIdx], SCHEDULE_PERIODS[baseIdx+1]].filter(Boolean);
  const todayStr=toDateStr(new Date());
  const dowNames=['일','월','화','수','목','금','토'];
  if(!periods.length){
    const fallback=[];
    for(let i=0;i<60;i++){
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
  const end=periods[periods.length-1].end || periods[periods.length-1].start;
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
  return `${dateLabel} ${slot.day} ${slot.t}`;
}

// 해당 날짜에 자리 있는 슬롯 찾기 (기존 학생, 마크, 그리고 이미 대기중인 보강 요청 모두 제외)
function _parentSlotMaxRows(inst){
  if(inst && (inst.elma || inst.cls==='elma' || inst.cls==='elite' || inst.cls==='master')) return 8;
  return 5;
}

async function findAvailableSlots(ds){
  if(!ds) return [];
  const result=await callParentFunction('parentFindBogangSlots',{
    ds,
    sourceSlotKey:_bgSourceSlotKey,
    teacherMode:_bgTeacherMode,
  });
  return result.slots||[];
}

async function refreshBogangSlots(ds){
  _renderBgTeacherFilter();
  const container=document.getElementById('bg-slots');
  const wrap=document.getElementById('bg-slot-wrap');
  wrap.style.display='block';
  container.innerHTML='<div class="bg-no-slots">가능한 수업을 확인 중입니다.</div>';
  let slots=[];
  try{
    slots=await findAvailableSlots(ds);
  }catch(e){
    container.innerHTML=`<div class="bg-no-slots">${esc(functionErrorMessage(e,'가능한 수업을 불러오지 못했습니다'))}</div>`;
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
  container.innerHTML=slots.map((x,i)=>`
    <div class="bg-slot-item ${_bgSelectedSlots.some(s=>_bgSlotKey(s)===_bgSlotKey(x))?'selected':''}" data-idx="${i}">
      <div>
        <div class="slot-main">${x.day}요일 · ${esc(x.t)}</div>
        <div class="slot-sub">${esc(x.instName)} 선생님${instClassBadgeHtml(x.inst)}</div>
      </div>
    </div>
  `).join('');
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
        _bgSelectedSlots.push(slot);
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
  try{
    const data=await callParentFunction('parentSubmitBogang',{
      sourceSlotKey:selfSlotKey,
      sourceDs:_bgSourceDs||null,
      targets:_bgSelectedSlots.map(slot=>({
        t:slot.t,
        day:slot.day,
        lane:slot.lane,
        row:slot.row,
        ds:slot.ds,
      })),
    });
    applyParentPayload(data);
    // 성공 화면 표시
    document.getElementById('bg-form').style.display='none';
    document.getElementById('bg-success').style.display='block';
    document.getElementById('bg-success-msg').innerHTML=
      `총 <strong>${_bgSelectedSlots.length}개</strong>의 후보를 보냈습니다.<br>담당 선생님이 이 중 하나를 확정합니다.`;
    renderDashboard();
  }catch(e){
    toast(functionErrorMessage(e,'신청 실패'),'err');
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
  try{
    await loadAllData();
  }catch(e){
    console.error('데이터 로드 실패:',e);
    toast('연결 실패 — 새로고침 해주세요','err');
    return;
  }

  // 세션 복구
  try{
    const branchId=getBranchInfo()?.id||'';
    const savedBranch=sessionStorage.getItem(PARENT_SESSION_BRANCH_KEY);
    const savedToken=sessionStorage.getItem(PARENT_SESSION_KEY);
    if(savedToken && savedBranch===branchId){
      _parentSessionToken=savedToken;
      const data=await callParentFunction('parentGetData');
      applyParentPayload(data);
      loginAs(STUDENTS);
    }
  }catch(e){
    _parentSessionToken=null;
    try{
      sessionStorage.removeItem(PARENT_SESSION_KEY);
      sessionStorage.removeItem(PARENT_SESSION_BRANCH_KEY);
      sessionStorage.removeItem('parent_stu_keys');
      sessionStorage.removeItem('parent_stu_key');
    }catch(_e){}
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
});
