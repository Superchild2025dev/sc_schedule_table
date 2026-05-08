/* ════════════════════════════════════════════════════════════════
 * SECTION: 도메인 모델 (수업 기간/요일/시간/STUDENTS/INST_MAP)
 * ════════════════════════════════════════════════════════════════ */
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
let SCHEDULE_PERIODS=loadJSON(STORAGE_KEYS.PERIODS, null);
if(!SCHEDULE_PERIODS||!Array.isArray(SCHEDULE_PERIODS)||!SCHEDULE_PERIODS.length){
  SCHEDULE_PERIODS=JSON.parse(JSON.stringify(_DEFAULT_PERIODS));
}
function savePeriods(){ saveJSON(STORAGE_KEYS.PERIODS, SCHEDULE_PERIODS, true); }

function openPeriodModal(){
  document.getElementById('period-modal').style.display='flex';
  const sel=document.getElementById('pm-year');
  sel.innerHTML='';
  const curYear=getToday().getFullYear();
  const years=new Set();
  for(let y=curYear;y<=curYear+2;y++) years.add(y);
  SCHEDULE_PERIODS.forEach(p=>{years.add(parseInt(p.start.split('-')[0]));});
  [...years].sort().forEach(y=>{
    const opt=document.createElement('option');
    opt.value=y;opt.textContent=y+'년';
    if(y===curYear) opt.selected=true;
    sel.appendChild(opt);
  });
  document.getElementById('pm-month').value='';
  document.getElementById('pm-start').value='';
  document.getElementById('pm-end').value='';
  renderPeriodList();
}
function closePeriodModal(){
  document.getElementById('period-modal').style.display='none';
  buildTable();
}
function addPeriodEntry(){
  const month=parseInt(document.getElementById('pm-month').value);
  const start=document.getElementById('pm-start').value;
  const end=document.getElementById('pm-end').value;
  if(!month||month<1||month>12){toast('월을 입력하세요 (1~12)','err');return;}
  if(!start||!end){toast('시작일과 종료일을 모두 입력하세요','err');return;}
  if(start>end){toast('시작일이 종료일보다 늦습니다','err');return;}
  // 같은 연도+월 중복 검사
  const yr=start.split('-')[0];
  if(SCHEDULE_PERIODS.some(p=>p.month===month&&p.start.startsWith(yr))){
    toast(yr+'년 '+month+'월 기간이 이미 존재합니다','err');return;
  }
  SCHEDULE_PERIODS.push({month,start,end});
  SCHEDULE_PERIODS.sort((a,b)=>a.start.localeCompare(b.start));
  savePeriods();
  document.getElementById('pm-month').value='';
  document.getElementById('pm-start').value='';
  document.getElementById('pm-end').value='';
  renderPeriodList();
  toast(month+'월 기간 추가 완료','ok');
}
function removePeriodEntry(idx){
  const p=SCHEDULE_PERIODS[idx];
  if(!confirm(p.month+'월 ('+p.start+' ~ '+p.end+') 삭제?')) return;
  SCHEDULE_PERIODS.splice(idx,1);
  savePeriods();
  renderPeriodList();
  toast('삭제 완료','ok');
}
function renderPeriodList(){
  const ul=document.getElementById('pm-list');
  const year=parseInt(document.getElementById('pm-year').value);
  ul.innerHTML='';
  SCHEDULE_PERIODS.forEach((p,idx)=>{
    const sy=parseInt(p.start.split('-')[0]);
    if(sy!==year) return;
    const li=document.createElement('li');
    li.className='closed-item';
    const startLabel=p.start.replace(/^\d{4}-/,'').replace('-','/');
    const endLabel=p.end.replace(/^\d{4}-/,'').replace('-','/');
    li.innerHTML=`
      <span class="closed-type t-single" style="background:#DBEAFE;color:#1D4ED8">${p.month}월</span>
      <span class="closed-dates">${startLabel} ~ ${endLabel}</span>
      <button class="btn btn-d" data-period-del="${idx}">삭제</button>
    `;
    li.querySelector('[data-period-del]').addEventListener('click',function(){removePeriodEntry(idx);});
    ul.appendChild(li);
  });
  if(!ul.children.length) ul.innerHTML='<li style="color:#aaa;font-size:11px;padding:8px 0">등록된 기간이 없습니다</li>';
}

function getCurrentPeriod(){
  const today=getToday();
  const ds=toDateStr(today);
  for(let i=SCHEDULE_PERIODS.length-1;i>=0;i--){
    if(ds>=SCHEDULE_PERIODS[i].start) return i;
  }
  return 0;
}

function getClassDatesForDay(dayName){
  const dayIdx=DAY_INDEX[dayName]; // 1=월...6=토
  if(dayIdx===undefined) return {cur:[],next:[]}; // 방특 요일
  const pi=getCurrentPeriod();
  const curP=SCHEDULE_PERIODS[pi];
  const nextP=SCHEDULE_PERIODS[pi+1]||null;

  function collectDates(period){
    if(!period) return [];
    const dates=[];
    const s=new Date(period.start+'T00:00:00');
    const e=new Date(period.end+'T00:00:00');
    const d=new Date(s);
    // 첫 번째 해당 요일 찾기
    while(d.getDay()!==dayIdx&&d<=e) d.setDate(d.getDate()+1);
    while(d<=e){
      const ds=toDateStr(d);
      const closed=isClosedDateFull(d);
      dates.push({ds, m:d.getMonth()+1, d:d.getDate(), closed});
      d.setDate(d.getDate()+7);
    }
    return dates;
  }

  return { cur: collectDates(curP), next: nextP?collectDates(nextP):[] };
}

// 데이터 로드 (Firebase/메모리 캐시) (없으면 기본값)
// [v98 #100] ⚠️ 이전 버전 체크는 Firebase 데이터를 영구 삭제하는 시한폭탄이었음.
//   - 새 디바이스/캐시 비운 디바이스에서 페이지 첫 로드 시 dbGet(VERSION)이 null
//   - 스크립트 로드 시점엔 _dbCache가 아직 비어있음 (loadFromFirebase는 비동기)
//   - 결과: dbRemove가 Firebase에서 학생/담임 데이터를 통째로 삭제
//   - 모든 다른 디바이스 sync → 운영 시간표 통째로 사라짐
//  파괴적 분기를 제거하고 버전만 silently bump.
const _DATA_VER='2026-04-v4-safe';
if(dbGet(STORAGE_KEYS.VERSION)!==_DATA_VER){
  // 데이터는 절대 건드리지 않음. 시드 데이터 fallback은 loadTabData가 처리.
  dbSet(STORAGE_KEYS.VERSION,_DATA_VER);
}
let STUDENTS,INST_MAP;

// 조회 헬퍼
const _stuIdx={};
function rebuildStuIdx(){for(const k in _stuIdx)delete _stuIdx[k];STUDENTS.forEach(s=>{_stuIdx[s.t+'/'+s.d+'/'+s.l+'/'+s.r]=s;});}
function getStu(time,day,lane,row){ return _stuIdx[time+'/'+day+'/'+lane+'/'+row]||null; }
function getInst(time,day,lane){ return INST_MAP[time+'/'+day+'/'+lane]||null; }

function loadTabData(){
  // [스냅샷 보호] 활성 탭이 스냅샷이면 메모리에 swap된 스냅샷 데이터를 보호
  // (다른 디바이스의 child_changed 동기화로 호출될 수 있음)
  if(typeof isSnapshotTab==='function' && isSnapshotTab()) return;
  const cfg=getTabConfig();
  const isDefault=(_activeTab==='regular');
  // [지점] 가경점만 디폴트 시드(_DEFAULT_STU/INST)를 사용. 용암점/그 외 지점은 빈 시간표로 시작.
  const isGagyeong = (typeof getBranchInfo==='function') ? (getBranchInfo()?.id==='gagyeong') : true;
  const useSeed = isDefault && isGagyeong;
  const defStu  = useSeed ? JSON.parse(JSON.stringify(_DEFAULT_STU))  : [];
  const defInst = useSeed ? JSON.parse(JSON.stringify(_DEFAULT_INST)) : {};
  STUDENTS = loadJSON(cfg.stuKey,  defStu);
  INST_MAP = loadJSON(cfg.instKey, defInst);
  // [v98] 안전 가드 baseline 갱신 — 로드된 학생 수를 기준선으로 기억
  _lastSaveStuCount[cfg.stuKey] = STUDENTS ? STUDENTS.length : 0;
  rebuildStuIdx();
}
function saveStudents(){
  // [v98 SAFETY] 갑작스러운 학생 수 급감 차단 — 자동 데이터 손실 방지
  const tabKey = getTabConfig().stuKey;
  const curCount = STUDENTS ? STUDENTS.length : 0;
  const lastCount = _lastSaveStuCount[tabKey] || 0;
  // 직전에 10명 이상 있었는데 갑자기 0이 되면 차단 (사용자가 수동으로 한 명씩 지운 경우는 점진적이라 통과)
  if(curCount===0 && lastCount>=10){
    console.error('[v98 SAFETY] saveStudents 차단 — 직전', lastCount, '명에서 0명으로 급감. 의도된 작업이면 콘솔에서 _lastSaveStuCount[\''+tabKey+'\']=0; saveStudents();');
    toast('⚠️ 학생 0명 저장 시도 차단 (콘솔 확인)','err');
    return;
  }
  _lastSaveStuCount[tabKey] = curCount;
  saveJSON(tabKey, STUDENTS);
}
function saveInst()    { saveJSON(getTabConfig().instKey, INST_MAP); }

/* ════════════════════════════════════════════════════════════════
 * SECTION: Undo 시스템 (Ctrl+Z, 30단계)
 * ════════════════════════════════════════════════════════════════ */
const _undoStack=[];
const _UNDO_MAX=30;
let _undoLock=false;
let _lastUndoPush=0;
function pushUndo(){
  if(_undoLock) return;
  const now=Date.now();
  if(now-_lastUndoPush<200) return; // 같은 액션 중복 방지
  _lastUndoPush=now;
  _undoStack.push({
    stu:JSON.stringify(STUDENTS),
    inst:JSON.stringify(INST_MAP),
    retire:JSON.stringify(RETIRE_MAP),
    enroll:JSON.stringify(ENROLL_MAP),
    mark:JSON.stringify(MARK_MAP),
    disabled:JSON.stringify(DISABLED_MAP),
    reserve:JSON.stringify(RESERVE_MAP),
    hyuwon:JSON.stringify(HYUWON_MAP),
    move:JSON.stringify(MOVE_MAP),
    stuKey:getTabConfig().stuKey,
    instKey:getTabConfig().instKey,
  });
  if(_undoStack.length>_UNDO_MAX) _undoStack.shift();
}
function popUndo(){
  if(!_undoStack.length){toast('되돌릴 내역 없음','err');return;}
  const s=_undoStack.pop();
  _undoLock=true;
  STUDENTS=JSON.parse(s.stu);INST_MAP=JSON.parse(s.inst);
  RETIRE_MAP=JSON.parse(s.retire);ENROLL_MAP=JSON.parse(s.enroll);
  MARK_MAP=JSON.parse(s.mark);DISABLED_MAP=JSON.parse(s.disabled);
  RESERVE_MAP=JSON.parse(s.reserve||'{}');
  HYUWON_MAP=JSON.parse(s.hyuwon||'{}');
  MOVE_MAP=JSON.parse(s.move||'{}');
  rebuildStuIdx();
  dbSet(s.stuKey,s.stu);dbSet(s.instKey,s.inst);
  dbSet(STORAGE_KEYS.RETIRE,   s.retire);
  dbSet(STORAGE_KEYS.ENROLL,   s.enroll);
  dbSet(STORAGE_KEYS.MARK,     s.mark);
  dbSet(STORAGE_KEYS.DISABLED, s.disabled);
  dbSet(STORAGE_KEYS.RESERVE,  s.reserve||'{}');
  dbSet(STORAGE_KEYS.休원,     s.hyuwon||'{}');
  dbSet(STORAGE_KEYS.MOVE,     s.move||'{}');
  _undoLock=false;
  closeStuPopup();closeInstPopup();
  buildTable();
  toast('되돌리기 완료','ok');
}
document.addEventListener('keydown',function(e){
  if((e.ctrlKey||e.metaKey)&&e.key==='z'){
    // [FIX] 입력 필드 포커스 중이면 텍스트 되돌리기 (앱 undo 차단)
    const t=e.target, tag=t&&t.tagName;
    if(tag==='INPUT'||tag==='TEXTAREA'||t?.isContentEditable) return;
    e.preventDefault();popUndo();
  }
  // [v95 #5] 입력 필드 밖에서 백스페이스로 페이지 뒤로가기 방지
  if(e.key==='Backspace'){
    const t=e.target;
    const tag=t&&t.tagName;
    const editable = tag==='INPUT' || tag==='TEXTAREA' || (t&&t.isContentEditable);
    if(!editable) e.preventDefault();
  }
});

// [v95 #7] mousedown 원점 추적 — 텍스트 드래그 선택 중 mouseup이 팝업 밖에서 발생해도 닫히지 않게.
//   click 이벤트의 target은 mouseup 위치라서, 드래그-아웃 시 외부 클릭으로 오인됨.
//   해결: mousedown 시점의 target을 별도로 기억해 두고, 외부 클릭 핸들러에서 그 시점도 함께 검사.
let _mouseDownTarget=null;
document.addEventListener('mousedown',e=>{ _mouseDownTarget=e.target; }, true);

function getDays(){ return getTabConfig().days; }
function getLanes(){ return getTabConfig().lanes; }
const TIMES_REG=[{t:'1시'},{t:'2시'},{t:'3시'},{t:'4시'},{t:'5시'},{t:'6시'},{t:'7시'},{t:'8시'}];
function getTimes(){ return _activeTab==='regular'?TIMES_REG:getTabConfig().times; }
function getTimeRows(t){ 
  const baseRows=isBangteuk()?6:5;
  return hasElmaInTime(t)?8:baseRows;
}
function getSatLabel(){ return getTabConfig().satTimeLabel; }
function getHasNum(){ return getTabConfig().hasNum; }
const DAY_NAMES=['일','월','화','수','목','금','토'];
const DAY_INDEX={'월':1,'화':2,'수':3,'목':4,'금':5,'토':6};

/* ════════════════════════════════════════════════════════════════
 * SECTION: 휴관일/마크/퇴원/등원/비활성화/예약 (Maps)
 * ════════════════════════════════════════════════════════════════ */
const DEFAULT_CLOSED=[
  {start:'2026-02-16',end:'2026-02-18',type:'휴관',memo:'설 연휴'},
  {start:'2026-03-02',end:null,type:'의무보강',memo:'대체휴일'},
  {start:'2026-04-30',end:'2026-05-05',type:'휴관',memo:''},
  {start:'2026-07-01',end:'2026-07-04',type:'휴관',memo:''},
  {start:'2026-08-15',end:null,type:'의무보강',memo:'광복절'},
  {start:'2026-09-24',end:'2026-09-30',type:'휴관',memo:'추석 연휴'},
  {start:'2026-10-03',end:null,type:'의무보강',memo:'개천절'},
  {start:'2026-10-09',end:null,type:'의무보강',memo:'한글날'},
  {start:'2026-12-25',end:null,type:'의무보강',memo:'성탄절'},
  {start:'2026-12-28',end:'2026-12-31',type:'휴관',memo:''},
];

function loadClosed(){
  return loadJSON(STORAGE_KEYS.CLOSED, JSON.parse(JSON.stringify(DEFAULT_CLOSED)));
}
function saveClosed(list){
  saveJSON(STORAGE_KEYS.CLOSED, list, true);
}

let closedList=loadClosed();

// 정확한 날짜 비교 (연도 포함, 문자열 기반)
function toDateStr(dateObj){
  const y=dateObj.getFullYear();
  const m=String(dateObj.getMonth()+1).padStart(2,'0');
  const d=String(dateObj.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function isClosedDateFull(dateObj){
  const ds=toDateStr(dateObj);
  for(const entry of closedList){
    const s=entry.start;
    const e=entry.end||entry.start;
    if(ds>=s&&ds<=e) return entry.type;
  }
  return null;
}

/* ════════════════════════════════════════════════════════════════
 * SECTION: 모달 공통 (탭 추가/시간머신/휴관일 등)
 * ════════════════════════════════════════════════════════════════ */
function openClosedModal(){
  document.getElementById('closed-modal').style.display='flex';
  const sel=document.getElementById('cm-year');
  sel.innerHTML='';
  const curYear=getToday().getFullYear();
  // 등록된 데이터의 연도 + 현재~+5년
  const years=new Set();
  for(let y=curYear;y<=curYear+5;y++) years.add(y);
  closedList.forEach(e=>{years.add(parseInt(e.start.split('-')[0]));if(e.end)years.add(parseInt(e.end.split('-')[0]));});
  [...years].sort().forEach(y=>{
    const opt=document.createElement('option');
    opt.value=y;opt.textContent=y+'년';
    if(y===curYear) opt.selected=true;
    sel.appendChild(opt);
  });
  // 시작일 기본값
  const t=getToday();
  document.getElementById('cm-start').value=toDateStr(t);
  document.getElementById('cm-end').value='';
  document.getElementById('cm-memo').value='';
  renderClosedList();
}
function closeClosedModal(){
  document.getElementById('closed-modal').style.display='none';
  buildTable(); // 변경사항 반영
}
function addClosedEntry(){
  const start=document.getElementById('cm-start').value;
  const end=document.getElementById('cm-end').value||null;
  const type=document.getElementById('cm-type').value;
  const memo=document.getElementById('cm-memo').value.trim();
  if(!start){toast('시작일을 입력하세요','err');return;}
  closedList.push({start,end,type,memo});
  closedList.sort((a,b)=>a.start.localeCompare(b.start));
  saveClosed(closedList);
  document.getElementById('cm-start').value='';
  document.getElementById('cm-end').value='';
  document.getElementById('cm-memo').value='';
  renderClosedList();
  buildTable();
  toast('추가 완료','ok');
}
function removeClosedEntry(idx){
  closedList.splice(idx,1);
  saveClosed(closedList);
  renderClosedList();
  buildTable();
  toast('삭제 완료','ok');
}
function renderClosedList(){
  const ul=document.getElementById('cm-list');
  const year=parseInt(document.getElementById('cm-year').value);
  ul.innerHTML='';
  closedList.forEach((entry,idx)=>{
    const sy=parseInt(entry.start.split('-')[0]);
    const ey=entry.end?parseInt(entry.end.split('-')[0]):sy;
    if(sy!==year&&ey!==year) return;
    const li=document.createElement('li');
    li.className='closed-item';
    const isRange=!!entry.end&&entry.end!==entry.start;
    const typeCls=isRange||entry.type==='휴관'?'t-range':'t-single';
    const startLabel=entry.start.replace(/^\d{4}-/,'').replace('-','/');
    const endLabel=entry.end?entry.end.replace(/^\d{4}-/,'').replace('-','/'):'';
    const dateStr=isRange?`${startLabel} ~ ${endLabel}`:startLabel;
    li.innerHTML=`
      <span class="closed-type ${typeCls}">${entry.type}</span>
      <span class="closed-dates">${dateStr}</span>
      <span class="closed-memo">${esc(entry.memo)}</span>
      <button class="btn btn-d" data-closed-del="${idx}">삭제</button>
    `;
    li.querySelector('[data-closed-del]').addEventListener('click',function(){removeClosedEntry(idx);});
    ul.appendChild(li);
  });
  if(!ul.children.length) ul.innerHTML='<li style="color:#aaa;font-size:11px;padding:8px 0">등록된 항목이 없습니다</li>';
}

function getDateHeaders(){
  // 출석 모드일 때는 선택 날짜가 속한 주(월요일 기준) 표시, 아니면 오늘 기준으로 이번주
  let weekAnchor;  // 주의 월요일
  const isAttMode = typeof _attendanceMode!=='undefined' && _attendanceMode && typeof _attendanceDate!=='undefined' && _attendanceDate;
  if(isAttMode){
    const [y,m,d]=_attendanceDate.split('-');
    const sel=new Date(parseInt(y), parseInt(m)-1, parseInt(d));
    const dow=sel.getDay();
    const offsetToMon = dow===0?-6:1-dow;  // 일요일이면 전주 월요일
    weekAnchor=new Date(sel);
    weekAnchor.setDate(weekAnchor.getDate()+offsetToMon);
  } else {
    // 기존 동작: 오늘 날짜 기준으로 각 요일의 다음 발생일
    weekAnchor=null;
  }
  const today=getToday();
  const todayDay=today.getDay();
  const headers={};
  getDays().forEach(day=>{
    const target=DAY_INDEX[day];
    if(target===undefined){
      // 방특 요일 (월수금, 화목 등) - 날짜 없이 라벨만
      headers[day]={label:day, closedLabel:null, ds:''};
      return;
    }
    let d;
    if(weekAnchor){
      // 해당 주의 요일 날짜
      d=new Date(weekAnchor);
      d.setDate(d.getDate()+(target===0?6:target-1));  // 월=0, 화=1,...,토=5
    } else {
      let diff=target-todayDay;
      if(diff<0) diff+=7;
      d=new Date(today);
      d.setDate(d.getDate()+diff);
    }
    const m=d.getMonth()+1;
    const dd=d.getDate();
    const closed=isClosedDateFull(d);

    if(closed){
      const next=new Date(d);
      let nextClosed=true;
      let nextLabel='';
      while(nextClosed){
        next.setDate(next.getDate()+7);
        if(!isClosedDateFull(next)){
          nextLabel=`${next.getMonth()+1}/${next.getDate()} ${day}요일`;
          nextClosed=false;
        }
      }
      headers[day]={
        label: nextLabel,
        closedLabel: `${m}/${dd} ${closed}`,
        ds: toDateStr(next),
      };
    } else {
      headers[day]={ label:`${m}/${dd} ${day}요일`, closedLabel:null, ds:toDateStr(d) };
    }
  });
  return headers;
}

/* ════════════════════════════════════════════════════════════════
 * SECTION: 공통 유틸 (esc, normPhone, toast 등)
 * ════════════════════════════════════════════════════════════════ */
function instClass(inst){
  if(!inst) return 'i-none';
  const name = typeof inst==='string' ? inst.replace(/^[\d\)]+\s*/,'').replace(/\(유아\)/,'').replace(/\(엘\/마\)/,'').trim() : inst.n;
  // [v115] TEACHERS에 등록된 이름이면 동적 클래스, 아니면 폴백
  if(TEACHERS.some(t=>t.n===name)) return teacherCssClass(name);
  return 'i-none';
}

// [v117] 반 분류: 'elma'(엘/마 합반) | 'elite' | 'master'
//   기존 inst.elma=true 데이터는 'elma'로 해석 (마이그레이션 없이 호환)
function getInstCls(inst){
  if(!inst) return null;
  if(inst.cls==='elma'||inst.cls==='elite'||inst.cls==='master') return inst.cls;
  if(inst.elma) return 'elma'; // 구버전 호환
  return null;
}
function getInstClsLabel(cls){
  return cls==='elma'?'(엘/마)':cls==='elite'?'(엘리트)':cls==='master'?'(마스터)':'';
}

function instDisplay(inst){
  if(!inst) return '';
  let s=inst.n;
  if(inst.lead) s='1)'+s;
  if(inst.youth) s+='(유아)';
  const cls=getInstCls(inst);
  if(cls) s+=getInstClsLabel(cls);
  return s;
}
function instCellHTML(text,instKey){
  const reserves=getReserves(instKey);
  const cnt=reserves.length;
  if(!cnt) return esc(text);
  const _dl=ds=>{if(!ds)return'';const p=ds.slice(5).split('-');return parseInt(p[0])+'/'+parseInt(p[1]);};
  const tipLines=reserves.map(r=>{
    let s=esc(r.n);
    if(r.p) s+=' '+esc(r.p);
    if(r.d) s+=' '+_dl(r.d);
    if(r.m) s+=' '+esc(r.m);
    if(r.teacher) s+=' ['+esc(r.teacher)+']';
    return s;
  });
  const tip=tipLines.join('<br>');
  return esc(text)+`<span class="inst-reserve-badge" data-reserve-tip="${esc(tip)}">${cnt}</span>`;
}

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function normPhone(v){
  if(!v) return '';
  const d=v.replace(/\D/g,'');
  if(!d) return '';
  // 4자리 (뒷번호만) → 그대로
  if(d.length<=4) return d;
  // 8자리 → 010 붙이기
  if(d.length===8) return '010-'+d.slice(0,4)+'-'+d.slice(4);
  // 010으로 시작하는 10~11자리
  if(d.length>=10){
    const n=d.startsWith('010')?d:'010'+d.slice(-8);
    return n.slice(0,3)+'-'+n.slice(3,7)+'-'+n.slice(7,11);
  }
  return d;
}

function toast(msg,type='info'){
  const w=document.getElementById('toasts');
  const el=document.createElement('div');
  el.className=`toast-item ${type}`;
  el.textContent=(type==='ok'?'✅ ':type==='err'?'❌ ':'ℹ️ ')+msg;
  w.appendChild(el);
  setTimeout(()=>el.remove(),2800);
}

// 엘마반(엘/마/엘리트/마스터) 레인 동적 계산
//   — cls 종류 무관하게 8행 자리 확보 + 라벨/색상은 별도 처리
function getElmaLanes(t,day){
  const elma=[];
  const names={};
  const clss={};
  for(let l=1;l<=getLanes();l++){
    const inst=INST_MAP[t+'/'+day+'/'+l];
    const cls=getInstCls(inst);
    if(cls){ elma.push(l-1); names[l-1]=inst.n; clss[l-1]=cls; }
  }
  if(!elma.length) return null;
  // 인접 레인 + 같은 선생님 + 같은 cls일 때만 합치기 (엘리트와 마스터는 합반 X)
  const pairs=[];
  for(let i=0;i<elma.length-1;i++){
    if(elma[i+1]===elma[i]+1
       && names[elma[i]]===names[elma[i+1]]
       && clss[elma[i]]===clss[elma[i+1]]){
      pairs.push([elma[i],elma[i+1]]);
    }
  }
  return {lanes:elma, pairs};
}
function isElmaLane(elma,li){ return elma&&elma.lanes.includes(li); }
function getElmaPairStart(elma,li){ return elma&&elma.pairs.find(p=>p[0]===li); }
function getElmaPairEnd(elma,li){ return elma&&elma.pairs.find(p=>p[1]===li); }
// 시간대에 엘마가 있는지
function hasElmaInTime(t){
  for(const d of getDays()){ if(getElmaLanes(t,d)) return true; }
  return false;
}

/* ══════════════════════════════════════════
   전역 STATE
   ══════════════════════════════════════════
   각 맵의 키는 'time/day/lane/row' 형식 (slotKey)
   예: '4시/월/2/3' = 4시 월요일 2레인 3번

   RETIRE_MAP[slotKey]    = { ds:'YYYY-MM-DD' }                                       // 퇴원일
   ENROLL_MAP[slotKey]    = { ds, name, age, p?, isNew?, enrolled? }                   // 등원 예약
   MARK_MAP[slotKey/ds]   = { type:'absent'|'bogang'|'sample', n?, a?, p?, sub? }      // 결석/보강/샘플
   DISABLED_MAP[slotKey]  = true                                                       // 비활성화 셀
   RESERVE_MAP[instKey]   = [{ n, p?, m?, d? }, ...]                                   // 담임 예약 (instKey='time/day/lane')
   ══════════════════════════════════════════ */
let RETIRE_MAP   = loadJSON(STORAGE_KEYS.RETIRE,   {});
let ENROLL_MAP   = loadJSON(STORAGE_KEYS.ENROLL,   {});
let MARK_MAP     = loadJSON(STORAGE_KEYS.MARK,     {});
let DISABLED_MAP = loadJSON(STORAGE_KEYS.DISABLED, {});
let RESERVE_MAP  = loadJSON(STORAGE_KEYS.RESERVE,  {});
let HYUWON_MAP   = loadJSON(STORAGE_KEYS.休원,     {});
// MOVE_MAP[srcKey] = { dstKey, ds, type:'all'|'stu' } — 예약 이동
let MOVE_MAP     = loadJSON(STORAGE_KEYS.MOVE,     {});
// REQUESTS[reqId] = { type:'bogang'|'absent-cancel', parent:{...}, target:{...}, instKey, requestedAt }
// 학부모 요청 → 선생님 수락/거절 대기
let REQUESTS     = loadJSON(STORAGE_KEYS.REQUESTS, {});
// ATTENDANCE[slotKey/date] = { s:'present'|'absent', at:ISO, by?:teacherName }
let ATTENDANCE   = loadJSON(STORAGE_KEYS.ATTENDANCE, {});
// ATT_GUESTS[slotKey/date] = [{gid, n, a, p, s:'present'|'absent', at, by}]
let ATT_GUESTS   = loadJSON(STORAGE_KEYS.ATT_GUESTS, {});
// DAY_SNAPSHOT[date] = { date, students, inst } — 과거 날짜 동결용
let DAY_SNAPSHOT = loadJSON(STORAGE_KEYS.DAY_SNAPSHOT, {});
// [v118] RETIRE_HISTORY = [{retiredAt, recordedAt, t, d, l, r, n, a, p, loc, memo, enrolledFrom}, ...] 퇴원 기록 (영구 보관)
let RETIRE_HISTORY = loadJSON(STORAGE_KEYS.RETIRE_HISTORY, []);
function saveRetireHistory(){ saveJSON(STORAGE_KEYS.RETIRE_HISTORY, RETIRE_HISTORY); }
function addRetireHistory(stu, retiredAt){
  if(!stu) return;
  // [v118] 담임 이름도 같이 저장
  const inst = INST_MAP[stu.t+'/'+stu.d+'/'+stu.l] || null;
  const rec = {
    retiredAt: retiredAt,
    recordedAt: new Date().toISOString(),
    t: stu.t, d: stu.d, l: stu.l, r: stu.r,
    n: stu.n, a: stu.a||null,
    p: stu.p||null, loc: stu.loc||null, memo: stu.memo||null,
    enrolledFrom: stu.enrolled||null,
    inst: inst?.n || null,  // 담임 이름
  };
  if(!Array.isArray(RETIRE_HISTORY)) RETIRE_HISTORY=[];
  RETIRE_HISTORY.push(rec);
  saveRetireHistory();
}

/* ════════════════════════════════════════════════════════════════
 * SECTION: 퇴원 기록 모달 (조회/검색/CSV)
 * ════════════════════════════════════════════════════════════════ */
function openRetireHistoryModal(){
  document.getElementById('retire-history-modal').style.display='flex';
  renderRetireHistoryList();
}
function closeRetireHistoryModal(){
  document.getElementById('retire-history-modal').style.display='none';
}
function _rhFiltered(){
  const q = (document.getElementById('rh-search')?.value || '').trim().toLowerCase();
  const list = (Array.isArray(RETIRE_HISTORY) ? RETIRE_HISTORY.slice() : []);
  const filtered = q
    ? list.filter(r => (r.n||'').toLowerCase().includes(q) || (r.memo||'').toLowerCase().includes(q))
    : list;
  const sort = document.getElementById('rh-sort')?.value || 'recent';
  if(sort === 'recent')      filtered.sort((a,b) => (b.recordedAt||'').localeCompare(a.recordedAt||''));
  else if(sort === 'oldest') filtered.sort((a,b) => (a.recordedAt||'').localeCompare(b.recordedAt||''));
  else if(sort === 'retired')filtered.sort((a,b) => (b.retiredAt||'').localeCompare(a.retiredAt||''));
  return filtered;
}
function renderRetireHistoryList(){
  const list = _rhFiltered();
  const total = (Array.isArray(RETIRE_HISTORY) ? RETIRE_HISTORY.length : 0);
  const sumEl = document.getElementById('rh-summary');
  if(sumEl) sumEl.textContent = `전체 ${total}건${list.length!==total?` · 검색 결과 ${list.length}건`:''}`;
  const wrap = document.getElementById('rh-list');
  if(!wrap) return;
  if(!list.length){
    wrap.innerHTML = '<div style="text-align:center;color:#888;padding:40px 12px;font-size:13px">퇴원 기록이 없습니다</div>';
    return;
  }
  const _fdate = ds => ds ? ds.slice(2).replace(/-/g,'.') : '-';
  const _fdt = iso => { try { const d=new Date(iso); return (d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); } catch(e){ return '-'; } };
  let html = `<table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="background:#F3F4F6;text-align:left">
      <th style="padding:8px 6px;border-bottom:2px solid #D1D5DB">이름(나이)</th>
      <th style="padding:8px 6px;border-bottom:2px solid #D1D5DB">담임</th>
      <th style="padding:8px 6px;border-bottom:2px solid #D1D5DB">자리</th>
      <th style="padding:8px 6px;border-bottom:2px solid #D1D5DB">퇴원일</th>
      <th style="padding:8px 6px;border-bottom:2px solid #D1D5DB">전화</th>
      <th style="padding:8px 6px;border-bottom:2px solid #D1D5DB">승하차/메모</th>
      <th style="padding:8px 6px;border-bottom:2px solid #D1D5DB">기록</th>
      <th style="padding:8px 6px;border-bottom:2px solid #D1D5DB"></th>
    </tr></thead><tbody>`;
  list.forEach((r, idx) => {
    const realIdx = RETIRE_HISTORY.indexOf(r);
    const seat = `${esc(r.t||'')} ${esc(r.d||'')} ${r.l||''}레인 ${r.r||''}번`;
    const memoLoc = [r.loc, r.memo].filter(Boolean).map(s=>esc(s).replace(/\n/g,' / ')).join(' · ');
    html += `<tr style="border-bottom:1px solid #E5E7EB">
      <td style="padding:7px 6px;font-weight:700">${esc(r.n||'')}${r.a?`(${r.a})`:''}</td>
      <td style="padding:7px 6px;color:#3B82F6;font-weight:600">${esc(r.inst||'-')}</td>
      <td style="padding:7px 6px;color:#666">${seat}</td>
      <td style="padding:7px 6px;font-weight:600;color:#DC2626">${_fdate(r.retiredAt)}</td>
      <td style="padding:7px 6px">${esc(r.p||'-')}</td>
      <td style="padding:7px 6px;font-size:11px;color:#444;max-width:220px">${memoLoc||'-'}</td>
      <td style="padding:7px 6px;font-size:10px;color:#888">${_fdt(r.recordedAt)}</td>
      <td style="padding:7px 6px;text-align:right">
        <button class="btn btn-d" onclick="deleteRetireHistory(${realIdx})" style="padding:3px 8px;font-size:10px" title="이 기록 삭제">✕</button>
      </td>
    </tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}
function deleteRetireHistory(idx){
  if(!Array.isArray(RETIRE_HISTORY)||idx<0||idx>=RETIRE_HISTORY.length) return;
  const r = RETIRE_HISTORY[idx];
  if(!confirm(`${r.n||''} 학생의 퇴원 기록을 삭제하시겠습니까?\n\n(${r.retiredAt} 퇴원)`)) return;
  RETIRE_HISTORY.splice(idx,1);
  saveRetireHistory();
  renderRetireHistoryList();
  toast('기록 삭제됨','ok');
}
function exportRetireHistoryCsv(){
  const list = _rhFiltered();
  if(!list.length){ toast('내보낼 기록이 없습니다','err'); return; }
  const header = ['이름','나이','담임','시간','요일','레인','번호','퇴원일','전화','승하차','메모','기록일'];
  const _csv = v => `"${String(v==null?'':v).replace(/"/g,'""').replace(/\n/g,' ')}"`;
  const rows = list.map(r => [r.n,r.a,r.inst,r.t,r.d,r.l,r.r,r.retiredAt,r.p,r.loc,r.memo,r.recordedAt].map(_csv).join(','));
  const csv = '﻿' + [header.join(','), ...rows].join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const today = (new Date()).toISOString().slice(0,10);
  a.href = url; a.download = `퇴원기록_${today}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function saveRetire()   { saveJSON(STORAGE_KEYS.RETIRE,   RETIRE_MAP); }
function saveEnroll()   { saveJSON(STORAGE_KEYS.ENROLL,   ENROLL_MAP); }
function saveMark()     { saveJSON(STORAGE_KEYS.MARK,     MARK_MAP); }
function saveDisabled() { saveJSON(STORAGE_KEYS.DISABLED, DISABLED_MAP); }
function saveReserve()  { saveJSON(STORAGE_KEYS.RESERVE,  RESERVE_MAP); }
function saveHyuwon()   { saveJSON(STORAGE_KEYS.休원,     HYUWON_MAP); }
function saveMove()     { saveJSON(STORAGE_KEYS.MOVE,     MOVE_MAP); }
function saveRequests() { saveJSON(STORAGE_KEYS.REQUESTS, REQUESTS); }
function saveAttendance(){ saveJSON(STORAGE_KEYS.ATTENDANCE, ATTENDANCE); }
function saveAttGuests(){ saveJSON(STORAGE_KEYS.ATT_GUESTS, ATT_GUESTS); }
function saveDaySnapshot(){ saveJSON(STORAGE_KEYS.DAY_SNAPSHOT, DAY_SNAPSHOT); }

// [FIX] Firebase child_changed 시 뱃지 맵도 메모리에 갱신
function reloadBadgeMaps(){
  // [스냅샷 보호] 활성 탭이 스냅샷이면 화면용 메모리는 그대로 두고
  // 백업본(_origGlobalMaps)만 갱신 — 다른 탭으로 갔을 때 최신 데이터 보임
  if(typeof isSnapshotTab==='function' && isSnapshotTab()){
    if(typeof _origGlobalMaps !== 'undefined' && _origGlobalMaps){
      _origGlobalMaps.retire     = loadJSON(STORAGE_KEYS.RETIRE,   {});
      _origGlobalMaps.enroll     = loadJSON(STORAGE_KEYS.ENROLL,   {});
      _origGlobalMaps.mark       = loadJSON(STORAGE_KEYS.MARK,     {});
      _origGlobalMaps.disabled   = loadJSON(STORAGE_KEYS.DISABLED, {});
      _origGlobalMaps.reserve    = loadJSON(STORAGE_KEYS.RESERVE,  {});
      _origGlobalMaps.hyuwon     = loadJSON(STORAGE_KEYS.休원,     {});
      _origGlobalMaps.move       = loadJSON(STORAGE_KEYS.MOVE,     {});
      _origGlobalMaps.attendance = loadJSON(STORAGE_KEYS.ATTENDANCE, {});
      _origGlobalMaps.attGuests  = loadJSON(STORAGE_KEYS.ATT_GUESTS, {});
      _origGlobalMaps.daySnapshot= loadJSON(STORAGE_KEYS.DAY_SNAPSHOT, {});
    }
    // REQUESTS는 글로벌이라 갱신 (스냅샷에 포함 안 됨 — 학부모 요청은 항상 라이브)
    REQUESTS = loadJSON(STORAGE_KEYS.REQUESTS, {});
    return;
  }
  RETIRE_MAP   = loadJSON(STORAGE_KEYS.RETIRE,   {});
  ENROLL_MAP   = loadJSON(STORAGE_KEYS.ENROLL,   {});
  MARK_MAP     = loadJSON(STORAGE_KEYS.MARK,     {});
  DISABLED_MAP = loadJSON(STORAGE_KEYS.DISABLED, {});
  RESERVE_MAP  = loadJSON(STORAGE_KEYS.RESERVE,  {});
  HYUWON_MAP   = loadJSON(STORAGE_KEYS.休원,     {});
  MOVE_MAP     = loadJSON(STORAGE_KEYS.MOVE,     {});
  REQUESTS     = loadJSON(STORAGE_KEYS.REQUESTS, {});
  ATTENDANCE   = loadJSON(STORAGE_KEYS.ATTENDANCE, {});
  ATT_GUESTS   = loadJSON(STORAGE_KEYS.ATT_GUESTS, {});
  DAY_SNAPSHOT = loadJSON(STORAGE_KEYS.DAY_SNAPSHOT, {});
}

// [FIX] Firebase child_changed 시 글로벌 데이터도 메모리에 갱신
function reloadGlobalData(){
  // 수업 기간
  const sp=loadJSON(STORAGE_KEYS.PERIODS, null);
  SCHEDULE_PERIODS=(sp&&Array.isArray(sp)&&sp.length)?sp:JSON.parse(JSON.stringify(_DEFAULT_PERIODS));
  // 휴원일
  closedList=loadClosed();
  // 선생님 (CSS 스타일도 갱신)
  loadTeachers();
  // 탭 목록
  const tl=loadJSON(STORAGE_KEYS.TAB_LIST, []);
  _tabList=tl.length?tl:[{id:'regular',name:'정규시간표',type:'regular'}];
  // 현재 활성 탭이 삭제됐으면 첫 탭으로
  if(!_tabList.find(t=>t.id===_activeTab)){
    _activeTab=_tabList[0].id;
    loadTabData();
  }
  renderTabBar();
}

function isDisabled(slotKey){ return !!DISABLED_MAP[slotKey]; }

/* ──── 예약 헬퍼 ──── */
function getReserves(instKey){ return RESERVE_MAP[instKey]||[]; }
function addReserve(instKey,name,phone,memo,date,teacher){
  if(!RESERVE_MAP[instKey]) RESERVE_MAP[instKey]=[];
  const obj={n:name};
  if(phone) obj.p=normPhone(phone);
  if(memo) obj.m=memo;
  if(date) obj.d=date;
  if(teacher) obj.teacher=teacher;
  RESERVE_MAP[instKey].push(obj);
  saveReserve();
}
function removeReserve(instKey,idx){
  if(!RESERVE_MAP[instKey]) return;
  RESERVE_MAP[instKey].splice(idx,1);
  if(!RESERVE_MAP[instKey].length) delete RESERVE_MAP[instKey];
  saveReserve();
}
function getMark(slotKey,ds){
  const v=MARK_MAP[slotKey+'/'+ds];
  if(!v) return null;
  if(typeof v==='string') return {type:v}; // backward compat
  return v;
}
function setMark(slotKey,ds,val){ MARK_MAP[slotKey+'/'+ds]=val; saveMark(); }
function clearMark(slotKey,ds){ delete MARK_MAP[slotKey+'/'+ds]; saveMark(); }

/* ──── Cross-file shared state ──── */
let _pendingSync=false;
let _tabFocusTime=0;
document.addEventListener('visibilitychange',()=>{if(!document.hidden)_tabFocusTime=Date.now();});
window.addEventListener('focus',()=>{_tabFocusTime=Date.now();});

