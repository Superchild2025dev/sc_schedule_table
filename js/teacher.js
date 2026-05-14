/* ════════════════════════════════════════════════════════════════
 * 선생님 승인 페이지
 * - 각 선생님별로 대기 중인 보강/결석취소 요청 리스트
 * - 수락 → MARK_MAP에 실제 반영
 * - 거절 → 요청 삭제
 * ════════════════════════════════════════════════════════════════ */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyArHQQfHnVreH8gVamyl1e5IqUDfXUJ5F8",
  authDomain: "scswimming-schedule.firebaseapp.com",
  databaseURL: "https://scswimming-schedule-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "scswimming-schedule",
  storageBucket: "scswimming-schedule.firebasestorage.app",
  messagingSenderId: "45509278949",
  appId: "1:45509278949:web:f16989a9c416f06e25e80c"
};

let _fb=null, _fbReady=false;
let STUDENTS=[], INST_MAP={}, MARK_MAP={}, REQUESTS={}, TEACHERS=[], ATTENDANCE={}, ATT_GUESTS={}, DAY_SNAPSHOT={};
let _currentTeacher=null;
let _activeTab='bogang';
let _attWeekStart=null;
const UNASSIGNED_TEACHER_LABEL='담당 미확인';

/* [v118] 지점 선택 (가경/용암) — 메인 앱과 동일 */
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

function parseJSON(v,def){
  if(!v) return def;
  try{return typeof v==='string'?JSON.parse(v):v;}catch(e){return def;}
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
function instClassBadgeHtml(inst, fallbackText=''){
  const tags=instClassTags(inst);
  if(tags.length) return tags.map(t=>`<span class="class-badge ${t.key}">${esc(t.label)}</span>`).join('');
  if(!fallbackText) return '';
  return String(fallbackText).split(' · ').filter(Boolean).map(label=>`<span class="class-badge neutral">${esc(label)}</span>`).join('');
}
function reqTargetInst(req){
  const t=req?.target||{};
  return INST_MAP[req?.instKey] || INST_MAP[t.t+'/'+t.d+'/'+t.l] || null;
}
function reqSnapshotTeacherName(req){
  return req?.target?.instName || req?.targetInstName || '';
}
function reqAssignedTeacherName(req){
  const inst=reqTargetInst(req);
  return inst?.n || reqSnapshotTeacherName(req) || UNASSIGNED_TEACHER_LABEL;
}
function reqTeacherWarningHtml(req){
  const inst=reqTargetInst(req);
  const currentName=inst?.n || '';
  const snapshotName=reqSnapshotTeacherName(req);
  if(!currentName){
    const saved=snapshotName ? `${esc(snapshotName)} 선생님` : '요청 당시 담당자';
    return `<div class="req-warning">현재 시간표에서 담당 선생님을 찾을 수 없어 ${saved} 기준으로 표시 중입니다.</div>`;
  }
  if(snapshotName && snapshotName!==currentName){
    return `<div class="req-warning">요청 당시 담당은 ${esc(snapshotName)} 선생님, 현재 시간표 담당은 ${esc(currentName)} 선생님입니다.</div>`;
  }
  return '';
}

function initFirebase(){
  const branch=getBranchInfo();
  if(!branch){ openBranchModal(); return; }
  try{
    firebase.initializeApp(FIREBASE_CONFIG);
    _fb=firebase.database().ref(branch.fbPath);
    _fbReady=true;
    // 헤더 타이틀에 지점명 반영
    const brand=document.querySelector('#teacher-select-screen h1');
    if(brand) brand.textContent=(branch.id==='yongam'?'용암':'가경')+' 수영장';
  }catch(e){ console.error('Firebase 실패:',e); }
}

function loadAllData(){
  return new Promise((resolve,reject)=>{
    if(!_fbReady){reject('not ready');return;}
    _fb.once('value').then(snap=>{
      const data=snap.val()||{};
      STUDENTS=parseJSON(data.swim_students,[]);
      INST_MAP=parseJSON(data.swim_inst,{});
      MARK_MAP=parseJSON(data.swim_mark,{});
      REQUESTS=parseJSON(data.swim_requests,{});
      TEACHERS=parseJSON(data.swim_teachers,[]);
      ATTENDANCE=parseJSON(data.swim_attendance,{});
      ATT_GUESTS=parseJSON(data.swim_att_guests,{});
      DAY_SNAPSHOT=parseJSON(data.swim_day_snapshot,{});
      resolve();
    }).catch(reject);
  });
}

function subscribeChanges(){
  if(!_fbReady) return;
  _fb.on('child_changed',snap=>{
    const asStr=typeof snap.val()==='string'?snap.val():JSON.stringify(snap.val());
    if(snap.key==='swim_requests') REQUESTS=parseJSON(asStr,{});
    else if(snap.key==='swim_mark') MARK_MAP=parseJSON(asStr,{});
    else if(snap.key==='swim_students') STUDENTS=parseJSON(asStr,[]);
    else if(snap.key==='swim_inst') INST_MAP=parseJSON(asStr,{});
    else if(snap.key==='swim_teachers') TEACHERS=parseJSON(asStr,[]);
    else if(snap.key==='swim_attendance') ATTENDANCE=parseJSON(asStr,{});
    else if(snap.key==='swim_att_guests') ATT_GUESTS=parseJSON(asStr,{});
    else if(snap.key==='swim_day_snapshot') DAY_SNAPSHOT=parseJSON(asStr,{});
    if(_currentTeacher!==null) render();
    // [v118] 선생님 선택 화면이 보이는 중이면 빨간 배지 갱신 (REQUESTS / INST_MAP / TEACHERS 변경 반응)
    const selScreen = document.getElementById('teacher-select-screen');
    if(selScreen && selScreen.style.display !== 'none' && (snap.key==='swim_requests' || snap.key==='swim_inst' || snap.key==='swim_teachers')){
      if(typeof populateTeachers === 'function') populateTeachers();
    }
  });
}

function saveMark(){ return _fb.child('swim_mark').set(JSON.stringify(MARK_MAP)); }
function saveRequests(){ return _fb.child('swim_requests').set(JSON.stringify(REQUESTS)); }
function saveAttendance(){ return _fb.child('swim_attendance').set(JSON.stringify(ATTENDANCE)); }
function saveAttGuests(){ return _fb.child('swim_att_guests').set(JSON.stringify(ATT_GUESTS)); }
function saveDaySnapshot(){ return _fb.child('swim_day_snapshot').set(JSON.stringify(DAY_SNAPSHOT)); }
function updateAttendanceMapTx(mutator){
  if(!_fbReady) return Promise.reject('not ready');
  return _fb.child('swim_attendance').transaction(raw=>{
    const att=parseJSON(raw,{});
    const next=mutator(att);
    if(next===undefined) return;
    return JSON.stringify(next||{});
  }).then(res=>{
    if(!res.committed) throw new Error('attendance transaction aborted');
    ATTENDANCE=parseJSON(res.snapshot.val(),{});
    return ATTENDANCE;
  });
}
function updateAttGuestsMapTx(mutator){
  if(!_fbReady) return Promise.reject('not ready');
  return _fb.child('swim_att_guests').transaction(raw=>{
    const guests=parseJSON(raw,{});
    const next=mutator(guests);
    if(next===undefined) return;
    return JSON.stringify(next||{});
  }).then(res=>{
    if(!res.committed) throw new Error('guest transaction aborted');
    ATT_GUESTS=parseJSON(res.snapshot.val(),{});
    return ATT_GUESTS;
  });
}
function updateMarkTx(mutator){
  if(!_fbReady) return Promise.reject('not ready');
  let abortReason='';
  return _fb.child('swim_mark').transaction(raw=>{
    const marks=parseJSON(raw,{});
    const next=mutator(marks, reason=>{abortReason=reason||'';});
    if(next===undefined) return;
    return JSON.stringify(next);
  }).then(res=>{
    if(!res.committed) throw new Error(abortReason||'mark transaction aborted');
    MARK_MAP=parseJSON(res.snapshot.val(),{});
    return MARK_MAP;
  });
}
function updateRequestsTx(mutator){
  if(!_fbReady) return Promise.reject('not ready');
  let abortReason='';
  return _fb.child('swim_requests').transaction(raw=>{
    const reqs=parseJSON(raw,{});
    const next=mutator(reqs, reason=>{abortReason=reason||'';});
    if(next===undefined) return;
    return JSON.stringify(next);
  }).then(res=>{
    if(!res.committed) throw new Error(abortReason||'request transaction aborted');
    REQUESTS=parseJSON(res.snapshot.val(),{});
    return REQUESTS;
  });
}
function claimRequest(reqId){
  const processingAt=new Date().toISOString();
  const processingBy=_currentTeacher||'관리자';
  return updateRequestsTx((reqs,abort)=>{
    const req=reqs[reqId];
    if(!req){abort('요청을 찾을 수 없습니다');return;}
    if(req.status && req.status!=='pending'){
      abort('이미 다른 곳에서 처리 중이거나 완료된 요청입니다');
      return;
    }
    req.status='processing';
    req.processingAt=processingAt;
    req.processingBy=processingBy;
    return reqs;
  });
}
function releaseRequest(reqId){
  return updateRequestsTx(reqs=>{
    const req=reqs[reqId];
    if(req&&req.status==='processing'){
      req.status='pending';
      delete req.processingAt;
      delete req.processingBy;
    }
    return reqs;
  });
}
function setRequestStatus(reqId,status){
  const processedAt=new Date().toISOString();
  const processedBy=_currentTeacher||'관리자';
  return updateRequestsTx((reqs,abort)=>{
    if(!reqs[reqId]){abort('요청을 찾을 수 없습니다');return;}
    const curStatus=reqs[reqId].status;
    if(status==='accepted'){
      if(curStatus && curStatus!=='pending' && curStatus!=='processing'){
        abort('이미 처리된 요청입니다');
        return;
      }
    } else if(status==='rejected'){
      if(curStatus && curStatus!=='pending'){
        abort('이미 처리 중이거나 완료된 요청입니다');
        return;
      }
    }
    reqs[reqId].status=status;
    reqs[reqId].processedAt=processedAt;
    reqs[reqId].processedBy=processedBy;
    delete reqs[reqId].processingAt;
    delete reqs[reqId].processingBy;
    return reqs;
  });
}

/* ── 선생님 선택 ── */
function populateTeachers(){
  const sel=document.getElementById('teacher-pick');
  sel.innerHTML='<option value="">선택하세요</option>';
  // INST_MAP에서 이름 수집 (중복 제거)
  const names=new Set();
  Object.values(INST_MAP).forEach(inst=>{
    if(inst?.n) names.add(inst.n);
  });
  // TEACHERS 목록에서도 추가
  TEACHERS.forEach(t=>{ if(t?.n) names.add(t.n); });
  // [v118] 선생님별 대기 요청 카운트 (REQUESTS 중 status==='pending' or 없음)
  const pendingCounts = _countPendingByTeacher();
  Object.keys(pendingCounts).forEach(n=>names.add(n));
  [...names].sort().forEach(n=>{
    const opt=document.createElement('option');
    opt.value=n;
    const cnt = pendingCounts[n] || 0;
    opt.textContent = cnt > 0 ? `${n}  🔴 ${cnt}건` : n;
    sel.appendChild(opt);
  });
  _renderPendingTeacherChips(pendingCounts);
}

function _countPendingByTeacher(){
  const counts = {};
  Object.values(REQUESTS||{}).forEach(r => {
    if(r.status && r.status !== 'pending') return;
    const name = reqAssignedTeacherName(r);
    if(name) counts[name] = (counts[name]||0) + 1;
  });
  return counts;
}

function _renderPendingTeacherChips(counts){
  const wrap = document.getElementById('pending-teachers');
  if(!wrap) return;
  const entries = Object.entries(counts).filter(([n,c]) => c > 0).sort((a,b)=>b[1]-a[1]);
  if(!entries.length){ wrap.innerHTML=''; return; }
  let html = `<div class="pending-label">🔔 대기 요청 있는 선생님 (${entries.reduce((s,[,c])=>s+c,0)}건)</div>`;
  entries.forEach(([name, cnt]) => {
    const safe = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    html += `<button class="pending-chip" onclick="enterAsTeacher('${safe}')">${esc(name)}<span class="pending-chip-badge">${cnt}</span></button>`;
  });
  wrap.innerHTML = html;
}

function enterAsTeacher(teacherName){
  _currentTeacher=teacherName;  // '' = 전체
  try{sessionStorage.setItem('teacher_name',teacherName);}catch(e){}
  document.getElementById('teacher-select-screen').style.display='none';
  document.getElementById('teacher-dashboard').style.display='flex';
  document.getElementById('teacher-display').textContent=
    teacherName ? (teacherName===UNASSIGNED_TEACHER_LABEL ? '담당 미확인 요청' : `${teacherName} 선생님`) : '전체 관리자';
  render();
}

function logout(){
  _currentTeacher=null;
  try{sessionStorage.removeItem('teacher_name');}catch(e){}
  document.getElementById('teacher-dashboard').style.display='none';
  document.getElementById('teacher-select-screen').style.display='flex';
}

/* ── 요청 필터링 ── */
function getMyRequests(type){
  // _currentTeacher가 '' (전체)이면 모두 보기
  const results=[];
  for(const [reqId,req] of Object.entries(REQUESTS)){
    if(req.type!==type) continue;
    if(req.status==='pending' || !req.status){
      // 선생님 필터
      if(_currentTeacher){
        // bogang: target의 선생님이 내 이름이어야 함
        // absent-cancel: 원생의 담임 선생님이 내 이름이어야 함
        if(reqAssignedTeacherName(req) !== _currentTeacher) continue;
      }
      results.push([reqId,req]);
    }
  }
  // 최신순
  results.sort((a,b)=>(b[1].requestedAt||'').localeCompare(a[1].requestedAt||''));
  return results;
}

function render(){
  if(_activeTab==='attendance'){
    renderAttendanceTimetable();
  }
  const bogangReqs=getMyRequests('bogang');
  const cancelReqs=getMyRequests('absent-cancel');

  document.getElementById('cnt-bogang').textContent=bogangReqs.length;
  document.getElementById('cnt-bogang').dataset.n=bogangReqs.length;
  document.getElementById('cnt-cancel').textContent=cancelReqs.length;
  document.getElementById('cnt-cancel').dataset.n=cancelReqs.length;

  document.getElementById('teacher-stats').textContent=
    `승인 대기 — 보강 ${bogangReqs.length}건 · 결석취소 ${cancelReqs.length}건`;

  renderBogangList(bogangReqs);
  renderCancelList(cancelReqs);
}

function fmtDate(ds){
  if(!ds) return '';
  const dow=['일','월','화','수','목','금','토'][new Date(ds).getDay()];
  const [y,m,d]=ds.split('-');
  return `${parseInt(m)}/${parseInt(d)}(${dow})`;
}
function fmtTime(iso){
  if(!iso) return '';
  const d=new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function renderBogangList(reqs){
  const container=document.getElementById('bogang-list');
  if(!reqs.length){
    container.innerHTML='<div class="req-empty">승인 대기 중인 보강 신청이 없습니다.</div>';
    return;
  }
  container.innerHTML=reqs.map(([id,r])=>{
    const p=r.parent, t=r.target;
    const parentInfo=`${p.name}${p.age?'('+p.age+'살)':''}`;
    const [ot,od,ol,or2]=(p.studentSlotKey||'').split('/');
    const originInst=INST_MAP[ot+'/'+od+'/'+ol];
    const originLabel=instClassText(originInst);
    const origin=p.studentSlotKey ? `${od}요일 ${ot} ${ol}레인 ${or2}번${originLabel?' · '+originLabel:''}` : '';
    const targetInst=reqTargetInst(r);
    const targetClass=instClassBadgeHtml(targetInst, t.classLabel||'');
    const targetTeacher=reqAssignedTeacherName(r);
    const warning=reqTeacherWarningHtml(r);
    // [v118] 보강 받는 반의 다른 학생들 표시 (시간표 셀 스타일)
    const classmatesHtml = _renderClassmates(t.t, t.d, t.l, t.ds, t.r);
    return `<div class="req-card">
      <div class="req-hdr">
        <span class="req-type">보강 신청</span>
        <span class="req-time">${fmtTime(r.requestedAt)}</span>
      </div>
      <div class="req-main">
        <div class="parent-name">${esc(parentInfo)}${p.phone?'  '+esc(p.phone):''}</div>
        <div class="sub-info">원래 수업: ${esc(origin)}</div>
        <div class="target">📅 ${fmtDate(t.ds)} ${esc(t.d)}요일 ${esc(t.t)} · ${t.l}레인 ${t.r}번 · ${esc(targetTeacher)}${targetClass}</div>
        ${warning}
      </div>
      ${classmatesHtml}
      <div class="req-actions">
        <button class="btn-reject" data-act="reject" data-id="${id}">거절</button>
        <button class="btn-accept" data-act="accept" data-id="${id}">수락</button>
      </div>
    </div>`;
  }).join('');
}

// [v118] 같은 반(t/d/l)의 학생들을 시간표 셀 스타일로 렌더 (해당 날짜 결석/보강 표시)
function _renderClassmates(t, d, l, ds, targetR){
  if(!t||!d||!l||!ds) return '';
  const li = parseInt(l);
  // 그 시간대의 학생들 (r=1~8)
  const cells = [];
  for(let r=1; r<=8; r++){
    const stu = STUDENTS.find(s => s.t===t && s.d===d && s.l===li && s.r===r);
    const markKey = `${t}/${d}/${l}/${r}/${ds}`;
    const mark = MARK_MAP[markKey] || null;
    cells.push({ r, stu, mark, isTarget: r==targetR });
  }
  // 끝에 빈 칸이면 trim (정규 학생 위치까지만 + 보강 받는 자리는 무조건 포함)
  let lastIdx = cells.findIndex((c,i)=>{
    if(i<targetR-1) return false;
    return cells.slice(i).every(x => !x.stu && !x.mark && !x.isTarget);
  });
  if(lastIdx<0) lastIdx=cells.length;
  const visible = cells.slice(0, Math.max(targetR, lastIdx, 5));
  const classBadge=instClassBadgeHtml(INST_MAP[t+'/'+d+'/'+l]);
  let html = `<div class="classmates-wrap">
    <div class="classmates-label">🏊 같은 반 학생들 — ${esc(t)} ${esc(d)}요일 ${l}레인${classBadge} (${fmtDate(ds)} 기준)</div>
    <div class="classmates-grid">`;
  visible.forEach(c=>{
    const isAbsent = c.mark?.type==='absent';
    const isBogang = c.mark?.type==='bogang' || c.mark?.sub?.type==='bogang';
    const isSample = c.mark?.type==='sample' || c.mark?.sub?.type==='sample';
    const subN = c.mark?.sub?.n || (c.mark?.type==='bogang'||c.mark?.type==='sample' ? c.mark?.n : null);
    let cls = 'cm-cell';
    if(c.isTarget) cls += ' cm-target';
    if(!c.stu && !c.mark && !c.isTarget) cls += ' cm-empty';
    if(isAbsent) cls += ' cm-absent';
    let text = '';
    if(c.isTarget) text = `<span class="cm-tag">📅 보강 신청</span>`;
    else if(c.stu) text = `<span class="cm-name">${esc(c.stu.n)}${c.stu.a?c.stu.a:''}</span>`;
    else text = `<span class="cm-empty-txt">-</span>`;
    let sub = '';
    if(isAbsent) sub = `<span class="cm-sub cm-sub-absent">결석</span>`;
    if(subN && (isBogang||isSample)) sub = `<span class="cm-sub cm-sub-bg">${isBogang?'보강':'샘플'} ${esc(subN)}</span>`;
    html += `<div class="${cls}">
      <div class="cm-rownum">${c.r}번</div>
      <div class="cm-content">${text}</div>
      ${sub}
    </div>`;
  });
  html += `</div></div>`;
  return html;
}

function renderCancelList(reqs){
  const container=document.getElementById('cancel-list');
  if(!reqs.length){
    container.innerHTML='<div class="req-empty">승인 대기 중인 결석 취소 신청이 없습니다.</div>';
    return;
  }
  container.innerHTML=reqs.map(([id,r])=>{
    const p=r.parent, t=r.target;
    const parentInfo=`${p.name}${p.age?'('+p.age+'살)':''}`;
    const targetInst=reqTargetInst(r);
    const targetClass=instClassBadgeHtml(targetInst, t.classLabel||'');
    const targetTeacher=reqAssignedTeacherName(r);
    const warning=reqTeacherWarningHtml(r);
    return `<div class="req-card cancel">
      <div class="req-hdr">
        <span class="req-type cancel">결석 취소 요청</span>
        <span class="req-time">${fmtTime(r.requestedAt)}</span>
      </div>
      <div class="req-main">
        <div class="parent-name">${esc(parentInfo)}${p.phone?'  '+esc(p.phone):''}</div>
        <div class="target">❌ ${fmtDate(t.ds)} ${esc(t.d)}요일 ${esc(t.t)} · ${t.l}레인 ${t.r}번 · ${esc(targetTeacher)}${targetClass} 결석 취소</div>
        ${warning}
      </div>
      <div class="req-actions">
        <button class="btn-reject" data-act="reject" data-id="${id}">거절 (결석 유지)</button>
        <button class="btn-accept" data-act="accept" data-id="${id}">수락 (결석 해제)</button>
      </div>
    </div>`;
  }).join('');
}

/* ── 수락/거절 액션 ── */
async function acceptRequest(reqId){
  const req=REQUESTS[reqId];
  if(!req) return;
  let claimed=false;
  let markApplied=false;
  try{
    await claimRequest(reqId);
    claimed=true;
    if(req.type==='bogang'){
      const t=req.target;
      const occupied=STUDENTS.some(s=>
        s.t===t.t && s.d===t.d
        && parseInt(s.l)===parseInt(t.l)
        && parseInt(s.r)===parseInt(t.r)
      );
      if(occupied) throw new Error('현재 시간표에서 이미 찬 자리입니다');
      const markKey=`${t.t}/${t.d}/${t.l}/${t.r}/${t.ds}`;
      const bogangObj={type:'bogang', n:req.parent.name, a:req.parent.age||null};
      if(req.parent.phone) bogangObj.p=req.parent.phone;

      await updateMarkTx((marks, abort)=>{
        const existing=marks[markKey];
        if(existing?.type==='absent'&&existing.sub){abort('이미 다른 마크가 있습니다');return;}
        if(existing&&existing.type!=='absent'){abort('이미 다른 마크가 있습니다');return;}
        // 결석이 있으면 sub로 붙임
        if(existing?.type==='absent'){
          marks[markKey]={type:'absent', sub:bogangObj};
        } else {
          marks[markKey]=bogangObj;
        }
        return marks;
      });
      markApplied=true;
      // 학부모 쪽 원래 슬롯은 자동 결석 처리 안 함 (학부모가 직접 결석 신청해야 함)
    } else if(req.type==='absent-cancel'){
      const t=req.target;
      const markKey=`${t.t}/${t.d}/${t.l}/${t.r}/${t.ds}`;
      await updateMarkTx(marks=>{
        const cur=marks[markKey];
        if(cur?.type==='absent'){
          if(cur.sub) marks[markKey]=cur.sub;
          else delete marks[markKey];
        }
        return marks;
      });
      markApplied=true;
    }
    await setRequestStatus(reqId,'accepted');
    toast('수락 완료','ok');
    render();
  }catch(e){
    if(claimed && !markApplied) await releaseRequest(reqId).catch(()=>{});
    toast(e?.message==='이미 다른 마크가 있습니다' || e?.message==='현재 시간표에서 이미 찬 자리입니다' ? e.message : (e?.message||'처리 실패'),'err');
    console.error(e);
  }
}

async function rejectRequest(reqId){
  const req=REQUESTS[reqId];
  if(!req) return;
  if(!confirm('이 요청을 거절하시겠습니까?')) return;
  try{
    await setRequestStatus(reqId,'rejected');
    toast('거절 완료','ok');
    render();
  }catch(e){
    toast('처리 실패','err');
    console.error(e);
  }
}

/* ════════════════════════════════════════════════════════════════
 * 출석 (시간표 스타일)
 * ════════════════════════════════════════════════════════════════ */
function toDateStr(d){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const dd=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}
function getMondayOf(date){
  const d=new Date(date);
  const dow=d.getDay();
  const offset=dow===0?-6:1-dow;
  d.setDate(d.getDate()+offset);
  return toDateStr(d);
}
function getWeekDates(monday){
  const out=[];
  const d=new Date(monday);
  for(let i=0;i<6;i++){
    out.push({ds:toDateStr(d), dow:['일','월','화','수','목','금','토'][d.getDay()]});
    d.setDate(d.getDate()+1);
  }
  return out;
}

// 해당 날짜에 사용할 STUDENTS + INST_MAP (과거: 스냅샷, 현재/미래: 라이브)
function getDataForDate(ds){
  const todayStr=toDateStr(new Date());
  if(ds<todayStr && DAY_SNAPSHOT[ds]){
    const snap=DAY_SNAPSHOT[ds];
    return {students:snap.students||[], inst:snap.inst||{}};
  }
  return {students:STUDENTS, inst:INST_MAP};
}

// 오늘 스냅샷 저장 (디바운스)
let _snapshotTimer=null;
function ensureTodaySnapshot(){
  const today=toDateStr(new Date());
  if(_snapshotTimer) clearTimeout(_snapshotTimer);
  _snapshotTimer=setTimeout(async ()=>{
    const existing=DAY_SNAPSHOT[today];
    const nowStr=new Date().toISOString().slice(0,10);
    if(existing && existing.date===nowStr) return;
    DAY_SNAPSHOT[today]={
      date:nowStr,
      students:JSON.parse(JSON.stringify(STUDENTS)),
      inst:JSON.parse(JSON.stringify(INST_MAP)),
    };
    try{await saveDaySnapshot();}catch(e){console.warn('snapshot save failed',e);}
  },500);
}

function getAllTimes(inst){
  const set=new Set();
  for(const k of Object.keys(inst||{})){
    const [t]=k.split('/');
    set.add(t);
  }
  return [...set].sort((a,b)=>parseInt(a)-parseInt(b));
}

function renderAttendanceTimetable(){
  if(!_attWeekStart) _attWeekStart=getMondayOf(new Date());
  const weekDates=getWeekDates(_attWeekStart);
  const todayStr=toDateStr(new Date());

  const start=weekDates[0].ds, end=weekDates[weekDates.length-1].ds;
  const [,sm,sd]=start.split('-');
  const [,em,ed]=end.split('-');
  document.getElementById('att-week-label').textContent=
    `${parseInt(sm)}/${parseInt(sd)} ~ ${parseInt(em)}/${parseInt(ed)}`;

  let total=0, present=0, absent=0, unchecked=0;
  const countSt=(s)=>{
    total++;
    if(s==='present') present++;
    else if(s==='absent') absent++;
    else unchecked++;
  };

  const perDay=weekDates.map(({ds,dow})=>{
    const {students, inst}=getDataForDate(ds);
    return {ds, dow, students, inst};
  });

  const allTimes=getAllTimes(INST_MAP);
  const LANE_COUNT=5;

  const hasTeacherAt=(inst, t, day, l)=>{
    const o=inst[t+'/'+day+'/'+l];
    if(!o||!o.n) return false;
    if(!_currentTeacher) return true;
    return o.n===_currentTeacher;
  };
  const timeHasClass=(t)=>{
    return perDay.some(pd=>{
      for(let l=1;l<=LANE_COUNT;l++){
        if(hasTeacherAt(pd.inst, t, pd.dow, l)) return true;
      }
      return false;
    });
  };
  const times=allTimes.filter(timeHasClass);

  if(!times.length){
    document.getElementById('att-tt-view').innerHTML=
      '<div class="att-empty">담당 수업이 없습니다.</div>';
    document.getElementById('att-stats').innerHTML='';
    return;
  }

  let html='<div class="att-tt-wrap"><table class="att-tt"><thead>';
  html+='<tr class="att-tt-day-row"><th class="att-tt-time-hdr">시간</th>';
  weekDates.forEach(({ds,dow})=>{
    const [,m,d]=ds.split('-');
    const isToday=ds===todayStr;
    const past=ds<todayStr;
    html+=`<th colspan="${LANE_COUNT}" class="att-tt-day${isToday?' today':''}${past?' past':''}">${dow} <span class="att-tt-date">${parseInt(m)}/${parseInt(d)}</span></th>`;
  });
  html+='</tr>';
  html+='<tr class="att-tt-lane-row"><th class="att-tt-time-hdr"></th>';
  weekDates.forEach(()=>{
    for(let l=1;l<=LANE_COUNT;l++){
      html+=`<th class="att-tt-lane">${l}</th>`;
    }
  });
  html+='</tr></thead><tbody>';

  times.forEach(t=>{
    let maxRows=5;
    perDay.forEach(pd=>{
      for(let l=1;l<=LANE_COUNT;l++){
        if(!hasTeacherAt(pd.inst, t, pd.dow, l)) continue;
        pd.students.forEach(s=>{
          if(s.t===t && s.d===pd.dow && s.l===l && s.r>maxRows) maxRows=s.r;
        });
      }
    });

    for(let r=1;r<=maxRows;r++){
      html+='<tr class="att-tt-stu-row">';
      if(r===1){
        html+=`<td class="att-tt-time" rowspan="${maxRows}">${esc(t)}</td>`;
      }
      perDay.forEach(pd=>{
        const past=pd.ds<todayStr;
        for(let l=1;l<=LANE_COUNT;l++){
          if(!hasTeacherAt(pd.inst, t, pd.dow, l)){
            html+=`<td class="att-tt-cell blocked"></td>`;
            continue;
          }
          const stu=pd.students.find(s=>s.t===t && s.d===pd.dow && s.l===l && s.r===r);
          const slotKey=t+'/'+pd.dow+'/'+l+'/'+r;
          let altStu=null;
          const mk=MARK_MAP[slotKey+'/'+pd.ds];
          if(mk){
            const sub=mk.type==='absent'?mk.sub:mk;
            if(sub && (sub.type==='bogang'||sub.type==='sample')){
              altStu={n:sub.n, a:sub.a, type:sub.type};
            }
          }
          const displayStu = stu ? {n:stu.n, a:stu.a, type:'regular'} : altStu;
          if(!displayStu){
            html+=`<td class="att-tt-cell empty"></td>`;
            continue;
          }
          const att=ATTENDANCE[slotKey+'/'+pd.ds];
          const v=att?(typeof att==='string'?att:att.s):'';
          countSt(v);
          const sCls=v==='present'?' att-p':v==='absent'?' att-a':'';
          const mark=v==='present'?'✓':v==='absent'?'✗':'';
          const typeCls=displayStu.type==='bogang'?' stu-bogang':displayStu.type==='sample'?' stu-sample':'';
          html+=`<td class="att-tt-cell${sCls}${typeCls}${past?' past':''}" data-act="att-toggle" data-slot="${esc(slotKey)}" data-ds="${pd.ds}">
            <span class="mark">${mark}</span><span class="nm">${esc(displayStu.n)}${displayStu.a||''}</span>
          </td>`;
        }
      });
      html+='</tr>';
    }

    // 게스트 + 추가 row
    const guestsByDayLane={};
    let maxGuests=0;
    perDay.forEach(pd=>{
      for(let l=1;l<=LANE_COUNT;l++){
        const sgk=t+'/'+pd.dow+'/'+l;
        const gl=ATT_GUESTS[sgk+'/'+pd.ds]||[];
        if(gl.length){
          guestsByDayLane[pd.ds+'/'+l]=gl;
          if(gl.length>maxGuests) maxGuests=gl.length;
        }
      }
    });
    for(let gi=0;gi<maxGuests;gi++){
      html+='<tr class="att-tt-guest-row">';
      if(gi===0) html+=`<td class="att-tt-time-sub" rowspan="${maxGuests+1}">+추가</td>`;
      perDay.forEach(pd=>{
        const past=pd.ds<todayStr;
        for(let l=1;l<=LANE_COUNT;l++){
          if(!hasTeacherAt(pd.inst, t, pd.dow, l)){
            html+=`<td class="att-tt-cell blocked"></td>`;
            continue;
          }
          const sgk=t+'/'+pd.dow+'/'+l;
          const gl=ATT_GUESTS[sgk+'/'+pd.ds]||[];
          const g=gl[gi];
          if(!g){html+=`<td class="att-tt-cell empty"></td>`;continue;}
          countSt(g.s);
          const v=g.s||'';
          const sCls=v==='present'?' att-p':v==='absent'?' att-a':'';
          const mark=v==='present'?'✓':v==='absent'?'✗':'';
          html+=`<td class="att-tt-cell guest${sCls}${past?' past':''}" data-act="att-toggle-guest" data-sgk="${esc(sgk)}" data-ds="${pd.ds}" data-gid="${esc(g.gid)}">
            <span class="mark">${mark}</span><span class="nm">${esc(g.n)}${g.a||''}</span>
            <span class="del-x" data-act="att-del-guest" data-sgk="${esc(sgk)}" data-ds="${pd.ds}" data-gid="${esc(g.gid)}">✕</span>
          </td>`;
        }
      });
      html+='</tr>';
    }
    // +추가 row
    html+='<tr class="att-tt-add-row">';
    if(maxGuests===0) html+=`<td class="att-tt-time-sub">+추가</td>`;
    perDay.forEach(pd=>{
      for(let l=1;l<=LANE_COUNT;l++){
        if(!hasTeacherAt(pd.inst, t, pd.dow, l)){
          html+=`<td class="att-tt-cell blocked"></td>`;
          continue;
        }
        const sgk=t+'/'+pd.dow+'/'+l;
        html+=`<td class="att-tt-cell add-cell" data-act="att-add" data-sgk="${esc(sgk)}" data-ds="${pd.ds}"><span class="add-plus">＋</span></td>`;
      }
    });
    html+='</tr>';
  });

  html+='</tbody></table></div>';
  document.getElementById('att-tt-view').innerHTML=html;

  document.getElementById('att-stats').innerHTML=
    `<span class="st">👥 총 ${total}명</span>`+
    `<span class="st">✅ 출석 ${present}</span>`+
    `<span class="st">❌ 결석 ${absent}</span>`+
    (unchecked>0?`<span class="st" style="color:#9CA3AF">⚪ 미체크 ${unchecked}</span>`:'');
}

async function cycleAttendance(slotKey, ds){
  const key=slotKey+'/'+ds;
  try{
    await updateAttendanceMapTx(att=>{
      const cur=att[key];
      const curVal=cur?(typeof cur==='string'?cur:cur.s):null;
      let next;
      if(!curVal) next='present';
      else if(curVal==='present') next='absent';
      else next=null;
      if(next===null) delete att[key];
      else att[key]={s:next, at:new Date().toISOString(), by:_currentTeacher||null};
      return att;
    });
    renderAttendanceTimetable();
  }
  catch(e){toast('저장 실패','err');}
}

async function cycleGuestAttendance(sgk, ds, gid){
  const key=sgk+'/'+ds;
  try{
    await updateAttGuestsMapTx(guests=>{
      const list=[...(guests[key]||[])];
      const idx=list.findIndex(g=>g.gid===gid);
      if(idx<0) return guests;
      const cur=list[idx].s;
      let next;
      if(!cur) next='present';
      else if(cur==='present') next='absent';
      else next=null;
      list[idx]={...list[idx], s:next, at:new Date().toISOString(), by:_currentTeacher||null};
      guests[key]=list;
      return guests;
    });
    renderAttendanceTimetable();
  }
  catch(e){toast('저장 실패','err');}
}

async function addGuest(sgk, ds){
  const name=prompt('추가할 학생 이름');
  if(!name||!name.trim()) return;
  const ageStr=prompt('나이 (선택)')||'';
  const age=parseInt(ageStr)||null;
  const key=sgk+'/'+ds;
  const gid='g_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
  try{
    await updateAttGuestsMapTx(guests=>{
      const list=[...(guests[key]||[])];
      list.push({
        gid, n:name.trim(), a:age, s:'present',
        at:new Date().toISOString(), by:_currentTeacher||null,
      });
      guests[key]=list;
      return guests;
    });
    toast(name+' 추가','ok'); renderAttendanceTimetable();
  }
  catch(e){toast('저장 실패','err');}
}

async function deleteGuest(sgk, ds, gid){
  if(!confirm('이 학생을 삭제하시겠습니까?')) return;
  const key=sgk+'/'+ds;
  try{
    await updateAttGuestsMapTx(guests=>{
      const list=(guests[key]||[]).filter(g=>g.gid!==gid);
      if(list.length) guests[key]=list;
      else delete guests[key];
      return guests;
    });
    renderAttendanceTimetable();
  }
  catch(e){toast('저장 실패','err');}
}

async function markAllPresentToday(){
  const today=toDateStr(new Date());
  const {students, inst}=getDataForDate(today);
  const dow=['일','월','화','수','목','금','토'][new Date().getDay()];
  const now=new Date().toISOString();
  let cnt=0;
  try{
    await updateAttendanceMapTx(att=>{
      cnt=0;
      students.forEach(s=>{
        if(s.d!==dow) return;
        const instKey=s.t+'/'+s.d+'/'+s.l;
        if(_currentTeacher){
          const io=inst[instKey];
          if(!io||io.n!==_currentTeacher) return;
        }
        const slotKey=s.t+'/'+s.d+'/'+s.l+'/'+s.r;
        const key=slotKey+'/'+today;
        const cur=att[key];
        const curVal=cur?(typeof cur==='string'?cur:cur.s):null;
        if(!curVal){
          att[key]={s:'present', at:now, by:_currentTeacher||null};
          cnt++;
        }
      });
      return att;
    });
    if(cnt===0){toast('체크할 학생이 없습니다','err');return;}
    toast(cnt+'명 출석','ok'); renderAttendanceTimetable();
  }
  catch(e){toast('저장 실패','err');}
}



function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function toast(msg,type){
  const el=document.getElementById('toast');
  el.textContent=msg;
  el.className='toast show '+(type||'');
  clearTimeout(toast._t);
  toast._t=setTimeout(()=>{el.classList.remove('show');},2400);
}

document.addEventListener('DOMContentLoaded', async ()=>{
  initFirebase();
  try{
    await loadAllData();
    subscribeChanges();
  }catch(e){toast('연결 실패','err');return;}

  populateTeachers();

  // 세션 복구
  try{
    const saved=sessionStorage.getItem('teacher_name');
    if(saved!==null) enterAsTeacher(saved);
  }catch(e){}

  // 이벤트
  document.getElementById('teacher-enter').addEventListener('click',()=>{
    const name=document.getElementById('teacher-pick').value;
    if(!name){toast('선생님을 선택해주세요','err');return;}
    enterAsTeacher(name);
  });
  document.getElementById('teacher-all').addEventListener('click',()=>enterAsTeacher(''));
  document.getElementById('teacher-logout').addEventListener('click',()=>{
    if(confirm('로그아웃하시겠습니까?')) logout();
  });

  // 탭 전환
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      _activeTab=btn.dataset.tab;
      document.getElementById('bogang-list').style.display=_activeTab==='bogang'?'flex':'none';
      document.getElementById('cancel-list').style.display=_activeTab==='cancel'?'flex':'none';
      document.getElementById('attendance-panel').style.display=_activeTab==='attendance'?'block':'none';
      if(_activeTab==='attendance'){
        if(!_attWeekStart) _attWeekStart=getMondayOf(new Date());
        ensureTodaySnapshot();
        renderAttendanceTimetable();
      }
    });
  });

  // 출석 버튼 위임
  document.addEventListener('click',e=>{
    const btn=e.target.closest('[data-act]');
    if(!btn) return;
    const act=btn.dataset.act;
    const ds=btn.dataset.ds;
    if(act==='att-toggle'){
      cycleAttendance(btn.dataset.slot, ds);
    } else if(act==='att-toggle-guest'){
      cycleGuestAttendance(btn.dataset.sgk, ds, btn.dataset.gid);
    } else if(act==='att-add'){
      addGuest(btn.dataset.sgk, ds);
    } else if(act==='att-del-guest'){
      e.stopPropagation();
      deleteGuest(btn.dataset.sgk, ds, btn.dataset.gid);
    }
  });

  // 주간 네비게이션 (출석 탭 제거 후엔 요소 없으므로 옵셔널 체이닝)
  document.getElementById('att-week-prev')?.addEventListener('click',()=>{
    const d=new Date(_attWeekStart);d.setDate(d.getDate()-7);
    _attWeekStart=toDateStr(d);renderAttendanceTimetable();
  });
  document.getElementById('att-week-next')?.addEventListener('click',()=>{
    const d=new Date(_attWeekStart);d.setDate(d.getDate()+7);
    _attWeekStart=toDateStr(d);renderAttendanceTimetable();
  });
  document.getElementById('att-week-today')?.addEventListener('click',()=>{
    _attWeekStart=getMondayOf(new Date());renderAttendanceTimetable();
  });
  // 오늘 모두 출석 버튼
  document.getElementById('att-save-all')?.addEventListener('click',markAllPresentToday);

  // 수락/거절 위임
  document.addEventListener('click',e=>{
    const btn=e.target.closest('[data-act]');
    if(!btn) return;
    const act=btn.dataset.act;
    const id=btn.dataset.id;
    if(act==='accept') acceptRequest(id);
    else if(act==='reject') rejectRequest(id);
  });
});
