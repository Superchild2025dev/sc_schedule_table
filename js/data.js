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
  if(window.SCAuth && !SCAuth.requirePermission('manageCalendar','기간 관리')) return;
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
  if(window.SCAuth && !SCAuth.requirePermission('manageCalendar','기간 관리')) return;
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
  const dayIndexes=getDayIndexes(dayName); // 단일 요일 또는 방특 묶음 요일
  if(!dayIndexes.length) return {cur:[],next:[]};
  const pi=getCurrentPeriod();
  const curP=SCHEDULE_PERIODS[pi];
  const nextP=SCHEDULE_PERIODS[pi+1]||null;

  function collectDates(period){
    if(!period) return [];
    const dates=[];
    const s=new Date(period.start+'T00:00:00');
    const e=new Date(period.end+'T00:00:00');
    const d=new Date(s);
    while(d<=e){
      if(dayIndexes.includes(d.getDay())){
        const ds=toDateStr(d);
        const closed=isClosedDateFull(d);
        dates.push({ds, m:d.getMonth()+1, d:d.getDate(), closed});
      }
      d.setDate(d.getDate()+1);
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

function _studentKeysForAnnualAgeUpdate(){
  const keys=new Set(['swim_students']);
  (_tabList||[]).forEach(tab=>{
    if(!tab||tab.type==='snapshot') return;
    if(tab.type==='bangteuk') keys.add('swim_bt_'+tab.id+'_stu');
    else keys.add(tab.id==='regular'?'swim_students':'swim_stu_'+tab.id);
  });
  return [...keys];
}

function applyAnnualAgeIncrement(){
  if(typeof isSnapshotTab==='function' && isSnapshotTab()) return Promise.resolve(false);
  if(typeof _fakeDate!=='undefined' && _fakeDate) return Promise.resolve(false);
  if(window.SCAuth && typeof SCAuth.role==='function' && SCAuth.role()!=='superAdmin') return Promise.resolve(false);
  const currentYear=getToday().getFullYear();
  if(!currentYear) return Promise.resolve(false);

  let changed=false;
  return updateScheduleTx([STORAGE_KEYS.AGE_YEAR,..._studentKeysForAnnualAgeUpdate()], ctx=>{
    const rawYear=ctx.get(STORAGE_KEYS.AGE_YEAR,null);
    const lastYear=parseInt(rawYear,10);
    if(!lastYear||lastYear>=currentYear){
      if(!lastYear) ctx.set(STORAGE_KEYS.AGE_YEAR,currentYear);
      return true;
    }

    const delta=currentYear-lastYear;
    _studentKeysForAnnualAgeUpdate().forEach(key=>{
      const students=ctx.get(key,[]);
      if(!Array.isArray(students)) return;
      let keyChanged=false;
      students.forEach(stu=>{
        if(!stu) return;
        const age=Number(stu.a);
        if(Number.isFinite(age)&&age>0){
          stu.a=age+delta;
          keyChanged=true;
        }
      });
      if(keyChanged){
        ctx.set(key,students);
        changed=true;
      }
    });
    ctx.set(STORAGE_KEYS.AGE_YEAR,currentYear);
    return true;
  }).then(()=>changed);
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
  if(typeof isSnapshotTab==='function' && isSnapshotTab()){
    toast('스냅샷은 읽기 전용 — 되돌리기를 사용할 수 없습니다','err');
    return;
  }
  if(typeof _fakeDate !== 'undefined' && _fakeDate){
    toast('타임머신 모드 — 되돌리기를 사용할 수 없습니다','err');
    return;
  }
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
  const maxRows=isBangteuk()?6:8;
  let rows=hasElmaInTime(t)?maxRows:baseRows;
  const useRow=row=>{
    const n=parseInt(row,10);
    if(Number.isFinite(n)&&n>rows) rows=n;
  };
  try{
    (STUDENTS||[]).forEach(s=>{ if(s&&s.t===t) useRow(s.r); });
    [RETIRE_MAP,ENROLL_MAP,DISABLED_MAP,HYUWON_MAP].forEach(map=>{
      Object.keys(map||{}).forEach(key=>{
        const p=String(key).split('/');
        if(p[0]===t) useRow(p[3]);
      });
    });
    Object.keys(MARK_MAP||{}).forEach(key=>{
      const p=String(key).split('/');
      if(p[0]===t) useRow(p[3]);
    });
  }catch(e){}
  return Math.min(maxRows, Math.max(baseRows, rows));
}
function getSatLabel(){ return getTabConfig().satTimeLabel; }
function getHasNum(){ return getTabConfig().hasNum; }
const DAY_NAMES=['일','월','화','수','목','금','토'];
const DAY_INDEX={'월':1,'화':2,'수':3,'목':4,'금':5,'토':6};
function getDayIndexes(dayName){
  const exact=DAY_INDEX[dayName];
  if(exact!==undefined) return [exact];
  const indexes=[];
  String(dayName||'').split('').forEach(ch=>{
    const idx=DAY_INDEX[ch];
    if(idx!==undefined&&!indexes.includes(idx)) indexes.push(idx);
  });
  return indexes;
}
function dayMatchesDate(dayName,dateObj){
  return getDayIndexes(dayName).includes(dateObj.getDay());
}
function getDateForDayInWeek(dayName,anchorDs){
  const indexes=getDayIndexes(dayName);
  const d=new Date((anchorDs||toDateStr(getToday()))+'T00:00:00');
  if(!indexes.length||Number.isNaN(d.getTime())) return d;
  if(indexes.includes(d.getDay())) return d;
  const dow=d.getDay();
  const off=dow===0?-6:1-dow;
  const mon=new Date(d);
  mon.setDate(mon.getDate()+off);
  for(let i=0;i<7;i++){
    const cur=new Date(mon);
    cur.setDate(cur.getDate()+i);
    if(indexes.includes(cur.getDay())) return cur;
  }
  return d;
}
function getNextDateForDayName(dayName,fromDate){
  const indexes=getDayIndexes(dayName);
  const d=new Date(fromDate);
  if(!indexes.length||Number.isNaN(d.getTime())) return d;
  for(let i=0;i<14;i++){
    if(indexes.includes(d.getDay())) return d;
    d.setDate(d.getDate()+1);
  }
  return d;
}
function formatDateHeaderLabel(dayName,dateObj){
  const m=dateObj.getMonth()+1;
  const dd=dateObj.getDate();
  const indexes=getDayIndexes(dayName);
  if(indexes.length>1){
    return `${m}/${dd} ${DAY_NAMES[dateObj.getDay()]} · ${dayName}`;
  }
  return `${m}/${dd} ${dayName}요일`;
}

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
  if(window.SCAuth && !SCAuth.requirePermission('manageCalendar','휴관일 관리')) return;
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
  if(window.SCAuth && !SCAuth.requirePermission('manageCalendar','휴관일 관리')) return;
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
  const headers={};
  getDays().forEach(day=>{
    const dayIndexes=getDayIndexes(day);
    if(!dayIndexes.length){
      headers[day]={label:day, closedLabel:null, ds:''};
      return;
    }
    let d;
    if(weekAnchor){
      // 해당 주의 요일 날짜. 방특 묶음 요일은 선택 날짜가 묶음 안에 있으면 그 날짜를 우선 사용.
      d=getDateForDayInWeek(day,_attendanceDate);
    } else {
      d=getNextDateForDayName(day,today);
    }
    const m=d.getMonth()+1;
    const dd=d.getDate();
    const closed=isClosedDateFull(d);

    if(closed){
      const next=new Date(d);
      let nextClosed=true;
      let nextLabel='';
      let nextDs='';
      let guard=0;
      while(nextClosed&&guard<90){
        next.setDate(next.getDate()+1);
        guard++;
        if(dayMatchesDate(day,next)&&!isClosedDateFull(next)){
          nextLabel=formatDateHeaderLabel(day,next);
          nextDs=toDateStr(next);
          nextClosed=false;
        }
      }
      if(!nextLabel){
        nextLabel=formatDateHeaderLabel(day,d);
        nextDs=toDateStr(d);
      }
      headers[day]={
        label: nextLabel,
        closedLabel: `${m}/${dd} ${closed}`,
        ds: nextDs,
      };
    } else {
      headers[day]={ label:formatDateHeaderLabel(day,d), closedLabel:null, ds:toDateStr(d) };
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
let AUDIT_LOG = [];
let RESTORE_POINTS = [];
const AUDIT_LOG_MAX=200;
const RESTORE_POINT_MAX=12;
const AUDIT_STORAGE_LIMIT=8*1024*1024;
const RECORD_PAGE_SIZE=30;
let _auditLock=false;
let _recordPage=1;
let _auditStorageLoaded=false;
let _auditStorageLoading=null;

function describeStorageChangeType(key){
  if(key===STORAGE_KEYS.MOVE) return 'move';
  if(key===STORAGE_KEYS.RETIRE_HISTORY) return 'retire';
  return 'edit';
}
function describeStorageChange(key){
  const cfg=(typeof getTabConfig==='function')?getTabConfig():{};
  if(key===cfg.stuKey) return '학생 명단 편집';
  if(key===cfg.instKey) return '담임 배정 편집';
  if(key===STORAGE_KEYS.RETIRE) return '제외/퇴원 예약 편집';
  if(key===STORAGE_KEYS.ENROLL) return '등록 예약 편집';
  if(key===STORAGE_KEYS.MARK) return '보강/샘플/결석 편집';
  if(key===STORAGE_KEYS.DISABLED) return '수업일 비활성 편집';
  if(key===STORAGE_KEYS.RESERVE) return '보강 가능 자리 편집';
  if(key===STORAGE_KEYS.休원) return '휴원 편집';
  if(key===STORAGE_KEYS.MOVE) return '이동 예약 편집';
  if(key===STORAGE_KEYS.REQUESTS) return '학부모 요청 편집';
  if(key===STORAGE_KEYS.ATTENDANCE) return '출석부 편집';
  if(key===STORAGE_KEYS.ATT_GUESTS) return '출석부 추가학생 편집';
  if(key===STORAGE_KEYS.DAY_SNAPSHOT) return '날짜 스냅샷 편집';
  if(key===STORAGE_KEYS.CLOSED) return '휴관일 편집';
  if(key===STORAGE_KEYS.TEACHERS) return '선생님 관리 편집';
  if(key===STORAGE_KEYS.PERIODS) return '수업 기간 편집';
  if(key===STORAGE_KEYS.RETIRE_HISTORY) return '퇴원 기록 편집';
  return '시간표 편집';
}
function _auditUser(){
  try{
    const user=firebase?.auth?.().currentUser;
    if(user?.email) return user.email;
  }catch(e){}
  const email=document.querySelector('[data-auth-email]')?.textContent?.trim();
  return email||'관리자';
}
function _auditNow(){ return new Date().toISOString(); }
function _auditId(prefix){ return prefix+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,7); }
function _auditTabName(){
  const tab=(_tabList||[]).find(t=>t.id===_activeTab);
  return tab?.name||_activeTab||'';
}
function _auditDataKeys(){
  const keys=new Set([
    STORAGE_KEYS.RETIRE,STORAGE_KEYS.ENROLL,STORAGE_KEYS.MARK,STORAGE_KEYS.DISABLED,
    STORAGE_KEYS.RESERVE,STORAGE_KEYS.休원,STORAGE_KEYS.MOVE,STORAGE_KEYS.REQUESTS,
    STORAGE_KEYS.ATTENDANCE,STORAGE_KEYS.ATT_GUESTS,STORAGE_KEYS.DAY_SNAPSHOT,
    STORAGE_KEYS.CLOSED,STORAGE_KEYS.TAB_LIST,STORAGE_KEYS.TAB_FOLDERS,
    STORAGE_KEYS.TEACHERS,STORAGE_KEYS.PERIODS,STORAGE_KEYS.RETIRE_HISTORY,
    STORAGE_KEYS.AGE_YEAR,
  ]);
  (_tabList||[]).forEach(tab=>{
    if(!tab||tab.type==='snapshot') return;
    if(tab.type==='bangteuk'){
      keys.add('swim_bt_'+tab.id+'_stu');
      keys.add('swim_bt_'+tab.id+'_inst');
    }else{
      keys.add(tab.id==='regular'?'swim_students':'swim_stu_'+tab.id);
      keys.add(tab.id==='regular'?'swim_inst':'swim_inst_'+tab.id);
    }
  });
  try{
    const cfg=getTabConfig();
    if(cfg?.stuKey) keys.add(cfg.stuKey);
    if(cfg?.instKey) keys.add(cfg.instKey);
  }catch(e){}
  return [...keys].filter(Boolean);
}
function _auditEditKeys(){
  const keys=new Set([
    STORAGE_KEYS.RETIRE,STORAGE_KEYS.ENROLL,STORAGE_KEYS.MARK,STORAGE_KEYS.DISABLED,
    STORAGE_KEYS.RESERVE,STORAGE_KEYS.休원,STORAGE_KEYS.MOVE,STORAGE_KEYS.REQUESTS,
    STORAGE_KEYS.ATTENDANCE,STORAGE_KEYS.ATT_GUESTS,STORAGE_KEYS.DAY_SNAPSHOT,
    STORAGE_KEYS.CLOSED,STORAGE_KEYS.TEACHERS,STORAGE_KEYS.PERIODS,
    STORAGE_KEYS.RETIRE_HISTORY,STORAGE_KEYS.AGE_YEAR,
  ]);
  try{
    const cfg=getTabConfig();
    if(cfg?.stuKey) keys.add(cfg.stuKey);
    if(cfg?.instKey) keys.add(cfg.instKey);
  }catch(e){}
  return [...keys].filter(Boolean);
}
function _captureRestoreState(extraKeys){
  const keys=[...new Set((extraKeys||[]).filter(Boolean))]
    .filter(key=>key!==STORAGE_KEYS.AUDIT_LOG&&key!==STORAGE_KEYS.RESTORE_POINTS);
  const data={};
  keys.forEach(key=>{
    const raw=dbGet(key);
    if(raw!==null&&raw!==undefined) data[key]=raw;
  });
  return {keys,data};
}
function createAuditPoint(keys,meta){
  if(_auditLock) return null;
  if(typeof isSnapshotTab==='function' && isSnapshotTab()) return null;
  if(typeof _fakeDate !== 'undefined' && _fakeDate) return null;
  const cleanKeys=[...new Set((keys||[]).filter(Boolean))]
    .filter(key=>key!==STORAGE_KEYS.AUDIT_LOG&&key!==STORAGE_KEYS.RESTORE_POINTS);
  if(!cleanKeys.length) return null;
  return {
    id:_auditId('rp'),
    at:_auditNow(),
    before:_captureRestoreState(cleanKeys),
    keys:cleanKeys,
    meta:meta||{},
    tabId:_activeTab,
    tabName:_auditTabName(),
    user:_auditUser(),
  };
}
function _auditLabelForKeys(keys){
  if(!keys||!keys.length) return '시간표 편집';
  if(keys.length===1) return describeStorageChange(keys[0]);
  const labels=[...new Set(keys.map(describeStorageChange))];
  if(labels.length<=2) return labels.join(' + ');
  return labels[0]+' 외 '+(labels.length-1)+'건';
}
function _auditTypeForKeys(keys){
  if((keys||[]).includes(STORAGE_KEYS.MOVE)) return 'move';
  if((keys||[]).includes(STORAGE_KEYS.RETIRE_HISTORY)) return 'retire';
  return 'edit';
}
function _auditParseStored(raw,fallback){
  if(raw===undefined||raw===null) return fallback;
  try{return typeof raw==='string'?JSON.parse(raw):raw;}catch(e){return fallback;}
}
function _auditStringify(val){
  try{return JSON.stringify(val??null);}catch(e){return String(val);}
}
function _auditIsStudentKey(key){
  return key==='swim_students'||key.startsWith('swim_stu_')||/^swim_bt_.+_stu$/.test(key);
}
function _auditIsInstKey(key){
  return key==='swim_inst'||key.startsWith('swim_inst_')||/^swim_bt_.+_inst$/.test(key);
}
function _auditSlotText(slotKey){
  if(!slotKey) return '-';
  const p=String(slotKey).split('/');
  if(p.length>=4) return `${p[0]||''} ${p[1]||''} ${p[2]||''}레인 ${p[3]||''}번`.trim();
  if(p.length>=3) return `${p[0]||''} ${p[1]||''} ${p[2]||''}레인`.trim();
  return slotKey;
}
function _auditStudentSlot(stu){
  return stu ? [stu.t,stu.d,stu.l,stu.r].join('/') : '';
}
function _auditStudentName(stu){
  if(!stu) return '-';
  return `${stu.n||'이름없음'}${stu.a?`(${stu.a})`:''}`;
}
function _auditStudentId(stu){
  if(!stu) return '';
  return [stu.n||'',stu.p||'',stu.a||'',stu.g||''].join('|');
}
function _auditFieldDiff(oldObj,newObj,fields){
  const labels={n:'이름',a:'나이',p:'전화',loc:'승하차',memo:'메모',v:'차량',g:'반',enrolled:'등록일'};
  const diffs=[];
  fields.forEach(f=>{
    const a=oldObj?.[f]??'';
    const b=newObj?.[f]??'';
    if(String(a)!==String(b)) diffs.push(`${labels[f]||f}: ${a||'-'} → ${b||'-'}`);
  });
  return diffs;
}
function _auditStudentDiff(oldVal,newVal){
  const oldList=Array.isArray(oldVal)?oldVal:[];
  const newList=Array.isArray(newVal)?newVal:[];
  const oldBySlot=new Map(oldList.map(stu=>[_auditStudentSlot(stu),stu]).filter(([k])=>k));
  const newBySlot=new Map(newList.map(stu=>[_auditStudentSlot(stu),stu]).filter(([k])=>k));
  const removed=[];
  const added=[];
  const changes=[];

  oldBySlot.forEach((stu,slot)=>{
    if(!newBySlot.has(slot)) removed.push({slot,stu});
  });
  newBySlot.forEach((stu,slot)=>{
    if(!oldBySlot.has(slot)) added.push({slot,stu});
  });

  const usedAdded=new Set();
  removed.forEach(rem=>{
    const idx=added.findIndex((add,i)=>!usedAdded.has(i)&&_auditStudentId(add.stu)===_auditStudentId(rem.stu));
    if(idx>=0){
      usedAdded.add(idx);
      const add=added[idx];
      changes.push({
        label:'원생 이동',
        target:_auditStudentName(rem.stu),
        detail:`${_auditSlotText(rem.slot)} → ${_auditSlotText(add.slot)}`,
      });
    }
  });
  removed.forEach(rem=>{
    if(added.some((add,i)=>usedAdded.has(i)&&_auditStudentId(add.stu)===_auditStudentId(rem.stu))) return;
    changes.push({
      label:'원생 삭제',
      target:_auditStudentName(rem.stu),
      detail:_auditSlotText(rem.slot),
    });
  });
  added.forEach((add,i)=>{
    if(usedAdded.has(i)) return;
    changes.push({
      label:'원생 추가',
      target:_auditStudentName(add.stu),
      detail:_auditSlotText(add.slot),
    });
  });
  oldBySlot.forEach((oldStu,slot)=>{
    const newStu=newBySlot.get(slot);
    if(!newStu) return;
    const diffs=_auditFieldDiff(oldStu,newStu,['n','a','p','loc','memo','v','g','enrolled']);
    if(diffs.length){
      changes.push({
        label:'원생 정보 수정',
        target:_auditStudentName(newStu),
        detail:`${_auditSlotText(slot)} · ${diffs.slice(0,3).join(', ')}${diffs.length>3?` 외 ${diffs.length-3}건`:''}`,
      });
    }
  });
  return changes;
}
function _auditMapEntryText(storageKey,key,val){
  const slot=key.includes('/')?_auditSlotText(key.split('/').slice(0,4).join('/')):'';
  if(storageKey===STORAGE_KEYS.RETIRE) return `${val?.name||'제외 예약'} · ${slot} · ${val?.ds||'-'}`;
  if(storageKey===STORAGE_KEYS.ENROLL) return `${val?.name||'등록 예약'} · ${slot} · ${val?.ds||'-'}`;
  if(storageKey===STORAGE_KEYS.MARK){
    const type=val?.type==='bogang'?'보강':val?.type==='sample'?'샘플':val?.type==='absent'?'결석':'마크';
    const date=String(key).split('/').pop();
    return `${type} · ${slot} · ${date||'-'}`;
  }
  if(storageKey===STORAGE_KEYS.ATTENDANCE){
    const state=val?.s==='present'?'출석':val?.s==='absent'?'결석':(val?.s||'출석부');
    const date=String(key).split('/').pop();
    return `${state} · ${slot} · ${date||'-'}`;
  }
  if(storageKey===STORAGE_KEYS.休원) return `휴원 · ${slot} · ${(val?.dates||[]).join(', ')||'-'}`;
  if(storageKey===STORAGE_KEYS.DISABLED) return `비활성 · ${slot||key}`;
  if(storageKey===STORAGE_KEYS.RESERVE) return `보강 가능 · ${slot||key}`;
  if(_auditIsInstKey(storageKey)) return `${val?.n||'담임'} · ${_auditSlotText(key)}`;
  return `${describeStorageChange(storageKey)} · ${slot||key}`;
}
function _auditMapDiff(storageKey,oldVal,newVal){
  const oldMap=(oldVal&&typeof oldVal==='object'&&!Array.isArray(oldVal))?oldVal:{};
  const newMap=(newVal&&typeof newVal==='object'&&!Array.isArray(newVal))?newVal:{};
  const changes=[];
  const keys=[...new Set([...Object.keys(oldMap),...Object.keys(newMap)])];
  keys.forEach(key=>{
    const hasOld=Object.prototype.hasOwnProperty.call(oldMap,key);
    const hasNew=Object.prototype.hasOwnProperty.call(newMap,key);
    if(!hasOld&&hasNew){
      changes.push({label:describeStorageChange(storageKey),target:_auditMapEntryText(storageKey,key,newMap[key]),detail:'추가'});
      return;
    }
    if(hasOld&&!hasNew){
      changes.push({label:describeStorageChange(storageKey),target:_auditMapEntryText(storageKey,key,oldMap[key]),detail:'삭제'});
      return;
    }
    if(_auditStringify(oldMap[key])!==_auditStringify(newMap[key])){
      changes.push({label:describeStorageChange(storageKey),target:_auditMapEntryText(storageKey,key,newMap[key]),detail:'수정'});
    }
  });
  return changes;
}
function _auditArrayDiff(storageKey,oldVal,newVal){
  const oldList=Array.isArray(oldVal)?oldVal:[];
  const newList=Array.isArray(newVal)?newVal:[];
  if(_auditStringify(oldList)===_auditStringify(newList)) return [];
  const delta=newList.length-oldList.length;
  let label=describeStorageChange(storageKey);
  let target=label;
  if(storageKey===STORAGE_KEYS.RETIRE_HISTORY&&delta>0){
    const r=newList[newList.length-1]||{};
    label='퇴원 기록 추가';
    target=`${r.n||'-'}${r.a?`(${r.a})`:''}`;
    return [{label,target,detail:`${r.retiredAt||'-'} · ${r.t||''} ${r.d||''} ${r.l||''}레인 ${r.r||''}번`}];
  }
  return [{label,target,detail:`${oldList.length}건 → ${newList.length}건${delta?` (${delta>0?'+':''}${delta})`:''}`}];
}
function _buildAuditSummary(point,keys,meta){
  const changes=[];
  const beforeData=point?.before?.data||{};
  keys.forEach(key=>{
    const oldVal=_auditParseStored(beforeData[key],undefined);
    const newVal=_auditParseStored(dbGet(key),undefined);
    if(_auditStringify(oldVal)===_auditStringify(newVal)) return;
    if(_auditIsStudentKey(key)) changes.push(..._auditStudentDiff(oldVal,newVal));
    else if(Array.isArray(oldVal)||Array.isArray(newVal)) changes.push(..._auditArrayDiff(key,oldVal,newVal));
    else changes.push(..._auditMapDiff(key,oldVal,newVal));
  });
  if(!changes.length){
    return {
      label:meta?.label||_auditLabelForKeys(keys),
      target:meta?.target||'',
      detail:meta?.detail||keys.map(describeStorageChange).join(', '),
    };
  }
  const first=changes[0];
  const detail=changes.slice(0,4).map(c=>{
    const action=c.detail?` ${c.detail}`:'';
    return `${c.label}: ${c.target}${action}`;
  }).join(' / ');
  return {
    label:meta?.label&&meta.label!=='시간표 편집'?meta.label:first.label,
    target:meta?.target||first.target,
    detail:detail+(changes.length>4?` / 외 ${changes.length-4}건`:''),
  };
}
function _auditByteSize(value){
  let text='';
  try{text=JSON.stringify(value??null);}catch(e){return AUDIT_STORAGE_LIMIT+1;}
  try{
    if(typeof TextEncoder!=='undefined') return new TextEncoder().encode(text).length;
  }catch(e){}
  return text.length;
}
function _thinRestorePoint(point){
  if(!point||!point.before?.data) return point;
  return {
    ...point,
    before:{
      keys:point.before.keys||point.keys||[],
      data:{},
      skipped:true,
      reason:'too-large',
    },
    detail:(point.detail||'')+' · 복구 데이터 용량 초과로 상세 복구 제외',
  };
}
function _trimAuditStorage(){
  let changed=false;
  if(!Array.isArray(AUDIT_LOG)) AUDIT_LOG=[];
  if(!Array.isArray(RESTORE_POINTS)) RESTORE_POINTS=[];
  while(AUDIT_LOG.length>AUDIT_LOG_MAX){ AUDIT_LOG.shift(); changed=true; }
  while(RESTORE_POINTS.length>RESTORE_POINT_MAX){ RESTORE_POINTS.shift(); changed=true; }
  while(RESTORE_POINTS.length>3&&_auditByteSize(RESTORE_POINTS)>AUDIT_STORAGE_LIMIT){
    RESTORE_POINTS.shift();
    changed=true;
  }
  let guard=0;
  while(_auditByteSize(RESTORE_POINTS)>AUDIT_STORAGE_LIMIT&&guard<RESTORE_POINTS.length){
    RESTORE_POINTS[guard]=_thinRestorePoint(RESTORE_POINTS[guard]);
    changed=true;
    guard++;
  }
  while(AUDIT_LOG.length>50&&_auditByteSize(AUDIT_LOG)>AUDIT_STORAGE_LIMIT){
    AUDIT_LOG.shift();
    changed=true;
  }
  return changed;
}
function _cacheAuditRaw(key,raw){
  if(raw===undefined||raw===null) return;
  const asStr=typeof raw==='string'?raw:JSON.stringify(raw);
  _dbCache[key]=asStr;
  try{localStorage.setItem(_lsKey(key),asStr);}catch(e){}
}
function _readAuditRaw(key){
  if(_fbReady&&_fb&&typeof _fb.child==='function'){
    return _fb.child(key).once('value').then(snap=>snap.val());
  }
  return Promise.resolve(dbGet(key));
}
function _loadAuditStorage(force){
  if(_auditStorageLoaded&&!force) return Promise.resolve();
  if(_auditStorageLoading&&!force) return _auditStorageLoading;
  _auditStorageLoading=Promise.all([
    _readAuditRaw(STORAGE_KEYS.AUDIT_LOG),
    _readAuditRaw(STORAGE_KEYS.RESTORE_POINTS),
  ]).then(([logRaw,restoreRaw])=>{
    if(logRaw===undefined||logRaw===null) logRaw=dbGet(STORAGE_KEYS.AUDIT_LOG);
    if(restoreRaw===undefined||restoreRaw===null) restoreRaw=dbGet(STORAGE_KEYS.RESTORE_POINTS);
    _cacheAuditRaw(STORAGE_KEYS.AUDIT_LOG,logRaw);
    _cacheAuditRaw(STORAGE_KEYS.RESTORE_POINTS,restoreRaw);
    AUDIT_LOG=_auditParseStored(logRaw,[]);
    if(!Array.isArray(AUDIT_LOG)) AUDIT_LOG=[];
    RESTORE_POINTS=_auditParseStored(restoreRaw,[]);
    if(!Array.isArray(RESTORE_POINTS)) RESTORE_POINTS=[];
    const trimmed=_trimAuditStorage();
    _auditStorageLoaded=true;
    if(trimmed&&_fbReady) _saveAuditRaw();
  }).finally(()=>{
    _auditStorageLoading=null;
  });
  return _auditStorageLoading;
}
function _saveAuditRaw(){
  _auditLock=true;
  try{
    _trimAuditStorage();
    dbSet(STORAGE_KEYS.AUDIT_LOG, JSON.stringify(AUDIT_LOG));
    dbSet(STORAGE_KEYS.RESTORE_POINTS, JSON.stringify(RESTORE_POINTS));
  }finally{
    _auditLock=false;
  }
}
function recordAuditPoint(point,touchedKeys,metaOverride){
  if(!point||_auditLock) return;
  if(!_auditStorageLoaded){
    _loadAuditStorage().then(()=>{
      recordAuditPoint(point,touchedKeys,metaOverride);
    }).catch(err=>{
      console.warn('기록 저장 전 기존 기록 로드 실패:',err);
      _auditStorageLoaded=true;
      recordAuditPoint(point,touchedKeys,metaOverride);
    });
    return;
  }
  const keys=[...new Set((touchedKeys&&touchedKeys.length?touchedKeys:point.keys||[]).filter(Boolean))]
    .filter(key=>key!==STORAGE_KEYS.AUDIT_LOG&&key!==STORAGE_KEYS.RESTORE_POINTS);
  if(!keys.length) return;
  const meta={...(point.meta||{}),...(metaOverride||{})};
  const summary=_buildAuditSummary(point,keys,meta);
  const entry={
    id:_auditId('log'),
    restoreId:point.id,
    at:_auditNow(),
    type:meta.type||_auditTypeForKeys(keys),
    label:summary.label,
    target:summary.target,
    detail:summary.detail,
    keys,
    tabId:point.tabId,
    tabName:point.tabName,
    user:point.user,
  };
  RESTORE_POINTS.push({
    id:point.id,
    at:entry.at,
    label:entry.label,
    target:entry.target,
    detail:entry.detail,
    type:entry.type,
    keys,
    before:point.before,
    tabId:point.tabId,
    tabName:point.tabName,
    user:point.user,
  });
  AUDIT_LOG.push(entry);
  _trimAuditStorage();
  _saveAuditRaw();
  if(document.getElementById('record-manager-modal')?.style.display==='flex'){
    renderRecordManager();
  }
}
function _fmtAuditDate(iso){
  if(!iso) return '-';
  try{
    const d=new Date(iso);
    return (d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }catch(e){return '-';}
}
function _recordTypeLabel(type){
  return type==='move'?'이동':type==='retire'?'퇴원':type==='restore'?'복구':'편집';
}
function _recordLocalDateKey(iso){
  if(!iso) return '';
  try{
    const d=new Date(iso);
    if(Number.isNaN(d.getTime())) return String(iso).slice(0,10);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }catch(e){
    return String(iso).slice(0,10);
  }
}
function _recordActivePeriodLabel(){
  const date=(document.getElementById('record-date')?.value||'').trim();
  const month=(document.getElementById('record-month')?.value||'').trim();
  if(date) return date;
  if(month) return month;
  return '';
}
function clearRecordDateFilters(){
  const month=document.getElementById('record-month');
  const date=document.getElementById('record-date');
  if(month) month.value='';
  if(date) date.value='';
  _recordPage=1;
  renderRecordManager();
}
function setRecordPage(page){
  _recordPage=Math.max(1, parseInt(page,10)||1);
  renderRecordManager();
}
function changeRecordFilter(){
  _recordPage=1;
  renderRecordManager();
}
function openRecordManagerModal(){
  document.getElementById('record-manager-modal').style.display='flex';
  const wrap=document.getElementById('record-list');
  if(wrap) wrap.innerHTML='<div style="text-align:center;color:#888;padding:40px 12px;font-size:13px">기록을 불러오는 중입니다...</div>';
  _loadAuditStorage().then(()=>{
    renderRecordManager();
  }).catch(err=>{
    console.error('기록관리 로드 실패:',err);
    toast('기록관리 로드 실패','err');
    renderRecordManager();
  });
}
function closeRecordManagerModal(){
  document.getElementById('record-manager-modal').style.display='none';
}
function _recordItems(){
  const audit=(Array.isArray(AUDIT_LOG)?AUDIT_LOG:[]).map(r=>({...r,_source:'audit'}));
  const retire=(Array.isArray(RETIRE_HISTORY)?RETIRE_HISTORY:[]).map((r,idx)=>({
    id:'retire_'+idx,
    at:r.recordedAt,
    type:'retire',
    label:(r.n||'')+' 퇴원',
    target:`${r.n||''}${r.a?`(${r.a})`:''}`,
    detail:`${r.retiredAt||'-'} · ${r.t||''} ${r.d||''} ${r.l||''}레인 ${r.r||''}번${r.inst?' · '+r.inst:''}`,
    user:'기록',
    tabName:'',
    _source:'retire',
  }));
  return audit.concat(retire);
}
function _filteredRecordItems(){
  const q=(document.getElementById('record-search')?.value||'').trim().toLowerCase();
  const type=(document.getElementById('record-type')?.value||'all');
  const month=(document.getElementById('record-month')?.value||'').trim();
  const date=(document.getElementById('record-date')?.value||'').trim();
  return _recordItems().filter(item=>{
    if(type!=='all'&&item.type!==type) return false;
    const itemDate=_recordLocalDateKey(item.at);
    if(date&&itemDate!==date) return false;
    if(!date&&month&&itemDate.slice(0,7)!==month) return false;
    if(!q) return true;
    return [item.label,item.target,item.detail,item.user,item.tabName].some(v=>String(v||'').toLowerCase().includes(q));
  }).sort((a,b)=>(b.at||'').localeCompare(a.at||''));
}
function renderRecordManager(){
  const list=_filteredRecordItems();
  const total=_recordItems().length;
  const summary=document.getElementById('record-summary');
  const period=_recordActivePeriodLabel();
  const pages=Math.max(1, Math.ceil(list.length/RECORD_PAGE_SIZE));
  if(_recordPage>pages) _recordPage=pages;
  const start=(list.length?(_recordPage-1)*RECORD_PAGE_SIZE:0);
  const pageItems=list.slice(start,start+RECORD_PAGE_SIZE);
  const rangeText=list.length?`${start+1}-${Math.min(start+RECORD_PAGE_SIZE,list.length)}건 표시`:'0건';
  if(summary) summary.textContent=`전체 ${total}건${list.length!==total?` · 필터 결과 ${list.length}건`:''}${period?` · 기간 ${period}`:''} · ${rangeText} · 최근 ${RESTORE_POINT_MAX}개 작업은 해당 작업 직전으로 복구할 수 있습니다`;
  const wrap=document.getElementById('record-list');
  if(!wrap) return;
  if(!list.length){
    wrap.innerHTML='<div style="text-align:center;color:#888;padding:40px 12px;font-size:13px">기록이 없습니다</div>';
    return;
  }
  const rows=pageItems.map(item=>{
    const type=item.type||'edit';
    const restore=item.restoreId?`<button class="btn btn-o" onclick="restoreRecordPoint('${esc(item.restoreId)}')">이 시점으로</button>`:'';
    return `<tr>
      <td class="record-time">${esc(_fmtAuditDate(item.at))}</td>
      <td><span class="record-kind ${esc(type)}">${_recordTypeLabel(type)}</span></td>
      <td class="record-label">${esc(item.label||'기록')}</td>
      <td class="record-target" title="${esc(item.target||item.label||'')}">${esc(item.target||item.label||'-')}</td>
      <td class="record-detail" title="${esc(item.detail||'')}">${esc(item.detail||'')}</td>
      <td class="record-tab">${esc(item.tabName||'-')}</td>
      <td class="record-user">${esc(item.user||'-')}</td>
      <td class="record-actions">${restore}</td>
    </tr>`;
  }).join('');
  wrap.innerHTML=`<div class="record-table-wrap"><table class="record-table">
    <thead><tr>
      <th>일시</th>
      <th>구분</th>
      <th>작업</th>
      <th>대상</th>
      <th>내용</th>
      <th>시간표</th>
      <th>사용자</th>
      <th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>${renderRecordPager(pages)}`;
}
function renderRecordPager(pages){
  if(pages<=1) return '';
  const nums=[];
  const start=Math.max(1,_recordPage-2);
  const end=Math.min(pages,start+4);
  const realStart=Math.max(1,Math.min(start,end-4));
  for(let i=realStart;i<=end;i++) nums.push(i);
  const btn=(page,label,disabled=false,active=false)=>`<button class="${active?'active':''}" onclick="setRecordPage(${page})" ${disabled?'disabled':''}>${label}</button>`;
  return `<div class="record-pager">
    ${btn(1,'처음',_recordPage===1)}
    ${btn(Math.max(1,_recordPage-1),'이전',_recordPage===1)}
    ${nums.map(n=>btn(n,n,false,n===_recordPage)).join('')}
    ${btn(Math.min(pages,_recordPage+1),'다음',_recordPage===pages)}
    ${btn(pages,'끝',_recordPage===pages)}
  </div>`;
}
function restoreRecordPoint(restoreId){
  if(window.SCAuth && !SCAuth.requirePermission('manageRecords','기록 되돌리기')) return;
  const point=(Array.isArray(RESTORE_POINTS)?RESTORE_POINTS:[]).find(p=>p.id===restoreId);
  if(!point||!point.before){toast('복구 지점을 찾을 수 없습니다','err');return;}
  if(point.before.skipped){toast('이 기록은 용량 제한으로 되돌리기 데이터가 없습니다','err');return;}
  if(!confirm(`"${point.label||'선택한 기록'}" 작업 직전 상태로 되돌릴까요?\n\n현재 상태는 복구 로그로 남겨둡니다.`)) return;
  const restoreKeys=[...new Set(point.before.keys||point.keys||[])]
    .filter(key=>key!==STORAGE_KEYS.AUDIT_LOG&&key!==STORAGE_KEYS.RESTORE_POINTS);
  const beforeRestore=createAuditPoint(restoreKeys, {
    type:'restore',
    label:'기록관리 되돌리기',
    detail:'복구 대상: '+(point.label||restoreId),
  });
  const data=point.before.data||{};
  const keys=restoreKeys;
  if(!keys.length){toast('복구할 데이터 키가 없습니다','err');return;}
  _auditLock=true;
  try{
    keys.forEach(key=>{
      if(Object.prototype.hasOwnProperty.call(data,key)) dbSet(key,data[key]);
      else dbRemove(key);
    });
  }finally{
    _auditLock=false;
  }
  reloadGlobalData();
  loadTabData();
  reloadBadgeMaps();
  closeStuPopup();
  closeInstPopup();
  buildTable();
  recordAuditPoint(beforeRestore,restoreKeys, {
    type:'restore',
    label:'기록관리 되돌리기',
    detail:'복구 대상: '+(point.label||restoreId),
  });
  renderRecordManager();
  toast('선택한 시점으로 되돌렸어요','ok');
}
function exportRecordManagerCsv(){
  const list=_filteredRecordItems();
  if(!list.length){toast('내보낼 기록이 없습니다','err');return;}
  const _csv=v=>`"${String(v==null?'':v).replace(/"/g,'""').replace(/\n/g,' ')}"`;
  const header=['일시','분류','작업','대상','내용','시간표','사용자'];
  const rows=list.map(r=>[r.at,_recordTypeLabel(r.type),r.label,r.target,r.detail,r.tabName,r.user].map(_csv).join(','));
  const csv='﻿'+[header.join(','),...rows].join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download='기록관리_'+toDateStr(getToday())+'.csv';
  document.body.appendChild(a);a.click();a.remove();
  URL.revokeObjectURL(url);
}
if(typeof window!=='undefined'){
  window.openRecordManagerModal=openRecordManagerModal;
  window.closeRecordManagerModal=closeRecordManagerModal;
  window.renderRecordManager=renderRecordManager;
  window.restoreRecordPoint=restoreRecordPoint;
  window.exportRecordManagerCsv=exportRecordManagerCsv;
  window.clearRecordDateFilters=clearRecordDateFilters;
  window.setRecordPage=setRecordPage;
  window.changeRecordFilter=changeRecordFilter;
}
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
  if(window.SCAuth && !SCAuth.requirePermission('manageRecords','퇴원 기록 삭제')) return;
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

function _cacheJSONOnly(key,val){
  const json=JSON.stringify(val||{});
  const sk=key.replace(/[.#$/\[\]]/g,'_');
  try{ _dbCache[sk]=json; }catch(e){}
  try{ localStorage.setItem(_lsKey(key),json); }catch(e){}
}
function _parseJSONMap(raw){
  if(!raw) return {};
  try{return typeof raw==='string'?JSON.parse(raw):raw;}catch(e){return {};}
}
function _cloneJSON(val){
  if(val===undefined||val===null) return val;
  try{return JSON.parse(JSON.stringify(val));}catch(e){return val;}
}
function _parseJSONValue(raw,fallback){
  if(!raw) return _cloneJSON(fallback);
  try{
    const val=typeof raw==='string'?JSON.parse(raw):raw;
    return val===undefined||val===null?_cloneJSON(fallback):val;
  }catch(e){
    return _cloneJSON(fallback);
  }
}
function _txJSONValue(storageKey,currentValue,applyResult,mutator,fallback){
  if(typeof canPersistScheduleData==='function' && !canPersistScheduleData(storageKey,'트랜잭션 저장')){
    return Promise.reject(new Error('서버 데이터 로드 실패 상태라 저장이 차단되었습니다'));
  }
  if(typeof canPersistScheduleData!=='function' && !_firebaseLoaded) return Promise.reject(new Error('Firebase 로드 전 저장이 차단되었습니다'));
  if(typeof isSnapshotTab==='function' && isSnapshotTab()
     && storageKey!==STORAGE_KEYS.TAB_LIST && !storageKey.startsWith('swim_snap_')){
    return Promise.reject(new Error('스냅샷은 읽기 전용입니다'));
  }
  if(typeof _fakeDate !== 'undefined' && _fakeDate
     && storageKey!==STORAGE_KEYS.TAB_LIST && !storageKey.startsWith('swim_snap_')){
    return Promise.reject(new Error('타임머신 모드에서는 저장되지 않습니다'));
  }
  let abortReason='';
  const runMutator=value=>mutator(value, reason=>{abortReason=reason||'';});
  const auditPoint=(typeof createAuditPoint==='function')
    ? createAuditPoint([storageKey], {type:describeStorageChangeType(storageKey), label:describeStorageChange(storageKey)})
    : null;
  if(!_fbReady){
    const next=runMutator(_cloneJSON(currentValue!==undefined?currentValue:fallback));
    if(next===undefined) return Promise.reject(new Error(abortReason||'transaction aborted'));
    if(next!==undefined){
      applyResult(next);
      saveJSON(storageKey,next);
    }
    return Promise.resolve(next);
  }
  const sk=storageKey.replace(/[.#$/\[\]]/g,'_');
  return _fb.child(sk).transaction(raw=>{
    const value=_parseJSONValue(raw,fallback);
    const next=runMutator(value);
    if(next===undefined) return;
    return JSON.stringify(next);
  }).then(res=>{
    if(!res.committed) throw new Error(abortReason||'transaction aborted');
    const next=_parseJSONValue(res.snapshot.val(),fallback);
    applyResult(next);
    _cacheJSONOnly(storageKey,next);
    if(auditPoint) recordAuditPoint(auditPoint,[storageKey]);
    return next;
  });
}
function _txJSONMap(storageKey,currentMap,applyResult,mutator){
  return _txJSONValue(storageKey,currentMap,applyResult,mutator,{});
}
function _storageSafeKey(key){ return key.replace(/[.#$/\[\]]/g,'_'); }
function _applyStoredValue(key,val){
  const tabCfg=getTabConfig();
  if(key===tabCfg.stuKey){
    STUDENTS=Array.isArray(val)?val:[];
    _lastSaveStuCount[key]=STUDENTS.length;
    rebuildStuIdx();
  } else if(key===tabCfg.instKey){
    INST_MAP=val||{};
  } else if(key===STORAGE_KEYS.RETIRE) RETIRE_MAP=val||{};
  else if(key===STORAGE_KEYS.ENROLL) ENROLL_MAP=val||{};
  else if(key===STORAGE_KEYS.MARK) MARK_MAP=val||{};
  else if(key===STORAGE_KEYS.DISABLED) DISABLED_MAP=val||{};
  else if(key===STORAGE_KEYS.RESERVE) RESERVE_MAP=val||{};
  else if(key===STORAGE_KEYS.休원) HYUWON_MAP=val||{};
  else if(key===STORAGE_KEYS.REQUESTS) REQUESTS=val||{};
  else if(key===STORAGE_KEYS.TEACHERS && typeof TEACHERS!=='undefined'){
    TEACHERS=Array.isArray(val)?val:[];
    if(typeof updateTeacherStyles==='function') updateTeacherStyles();
  }
  else if(key===STORAGE_KEYS.ATTENDANCE) ATTENDANCE=val||{};
  else if(key===STORAGE_KEYS.ATT_GUESTS) ATT_GUESTS=val||{};
  else if(key===STORAGE_KEYS.DAY_SNAPSHOT) DAY_SNAPSHOT=val||{};
  else if(key===STORAGE_KEYS.AUDIT_LOG) AUDIT_LOG=Array.isArray(val)?val:[];
  else if(key===STORAGE_KEYS.RESTORE_POINTS) RESTORE_POINTS=Array.isArray(val)?val:[];
}
function updateScheduleTx(keysOrMutator,mutatorOrMeta,metaArg){
  const hasExplicitKeys=Array.isArray(keysOrMutator);
  const txKeysRaw=hasExplicitKeys ? keysOrMutator : _auditEditKeys();
  const mutator=hasExplicitKeys ? mutatorOrMeta : keysOrMutator;
  const meta=hasExplicitKeys ? metaArg : mutatorOrMeta;
  const txKeys=[...new Set((txKeysRaw||[]).filter(Boolean))]
    .filter(key=>key!==STORAGE_KEYS.AUDIT_LOG&&key!==STORAGE_KEYS.RESTORE_POINTS);
  const txSafeKeys=[...new Set(txKeys.map(_storageSafeKey))];
  const txKeySet=new Set(txSafeKeys);
  if(typeof canPersistScheduleData==='function' && !canPersistScheduleData(txKeys[0]||'schedule','시간표 저장')){
    return Promise.reject(new Error('서버 데이터 로드 실패 상태라 저장이 차단되었습니다'));
  }
  if(typeof canPersistScheduleData!=='function' && !_firebaseLoaded) return Promise.reject(new Error('Firebase 로드 전 저장이 차단되었습니다'));
  if(typeof isSnapshotTab==='function' && isSnapshotTab()) return Promise.reject(new Error('스냅샷은 읽기 전용입니다'));
  if(typeof _fakeDate !== 'undefined' && _fakeDate) return Promise.reject(new Error('타임머신 모드에서는 저장되지 않습니다'));
  if(typeof mutator!=='function') return Promise.reject(new Error('transaction mutator is required'));
  if(!txKeys.length) return Promise.reject(new Error('transaction keys are required'));
  const touched=new Set();
  let abortReason='';
  const auditPoint=(typeof createAuditPoint==='function')?createAuditPoint(txKeys, meta||{type:'edit', label:'시간표 편집'}):null;
  const makeCtx=root=>({
    get(key,fallback){
      const safeKey=_storageSafeKey(key);
      if(!txKeySet.has(safeKey)) throw new Error('트랜잭션 키 누락: '+key);
      return _parseJSONValue(root[safeKey],fallback);
    },
    set(key,val){
      const safeKey=_storageSafeKey(key);
      if(!txKeySet.has(safeKey)) throw new Error('트랜잭션 키 누락: '+key);
      root[safeKey]=JSON.stringify(val);
      touched.add(key);
    },
    abort(reason){ abortReason=reason||''; },
  });
  if(!_fbReady){
    const localRoot={};
    txKeys.forEach(key=>{localRoot[_storageSafeKey(key)]=dbGet(key);});
    const next=mutator(makeCtx(localRoot));
    if(next===undefined) return Promise.reject(new Error(abortReason||'transaction aborted'));
    touched.forEach(key=>{
      const val=_parseJSONValue(localRoot[_storageSafeKey(key)],{});
      _applyStoredValue(key,val);
      saveJSON(key,val);
    });
    return Promise.resolve();
  }
  const runTx=typeof _fb.transactionKeys==='function'
    ? updateFn=>_fb.transactionKeys(txSafeKeys, updateFn)
    : updateFn=>_fb.transaction(updateFn);
  return runTx(root=>{
    root=root||{};
    touched.clear();
    abortReason='';
    const result=mutator(makeCtx(root));
    if(result===undefined) return;
    return root;
  }).then(res=>{
    if(!res.committed) throw new Error(abortReason||'transaction aborted');
    const root=res.snapshot.val()||{};
    touched.forEach(key=>{
      const val=_parseJSONValue(root[_storageSafeKey(key)],{});
      _applyStoredValue(key,val);
      _cacheJSONOnly(key,val);
    });
    if(auditPoint&&touched.size) recordAuditPoint(auditPoint,Array.from(touched),meta);
  });
}
function updateStudentsTx(mutator){
  const tabKey=getTabConfig().stuKey;
  return _txJSONValue(tabKey,STUDENTS,next=>{
    STUDENTS=Array.isArray(next)?next:[];
    _lastSaveStuCount[tabKey]=STUDENTS.length;
    rebuildStuIdx();
  },(students,abort)=>{
    const list=Array.isArray(students)?students:[];
    const next=mutator(list,abort);
    if(next===undefined) return;
    if(Array.isArray(next)&&next.length===0&&(_lastSaveStuCount[tabKey]||0)>=10){
      abort('학생 0명 저장 시도 차단');
      return;
    }
    return next;
  },[]);
}
function updateInstMapTx(mutator){
  return _txJSONMap(getTabConfig().instKey,INST_MAP,next=>{INST_MAP=next;},mutator);
}
function updateRetireMapTx(mutator){
  return _txJSONMap(STORAGE_KEYS.RETIRE,RETIRE_MAP,next=>{RETIRE_MAP=next;},mutator);
}
function updateEnrollMapTx(mutator){
  return _txJSONMap(STORAGE_KEYS.ENROLL,ENROLL_MAP,next=>{ENROLL_MAP=next;},mutator);
}
function updateDisabledMapTx(mutator){
  return _txJSONMap(STORAGE_KEYS.DISABLED,DISABLED_MAP,next=>{DISABLED_MAP=next;},mutator);
}
function updateReserveMapTx(mutator){
  return _txJSONMap(STORAGE_KEYS.RESERVE,RESERVE_MAP,next=>{RESERVE_MAP=next;},mutator);
}
function updateHyuwonMapTx(mutator){
  return _txJSONMap(STORAGE_KEYS.休원,HYUWON_MAP,next=>{HYUWON_MAP=next;},mutator);
}
function updateMarkMapTx(mutator){
  return _txJSONMap(STORAGE_KEYS.MARK,MARK_MAP,next=>{MARK_MAP=next;},mutator);
}
function setMarkEntryTx(markKey,val){
  MARK_MAP[markKey]=val;
  return updateMarkMapTx(marks=>{ marks[markKey]=val; return marks; });
}
function clearMarkEntryTx(markKey){
  delete MARK_MAP[markKey];
  return updateMarkMapTx(marks=>{ delete marks[markKey]; return marks; });
}
function updateAttendanceMapTx(mutator){
  return _txJSONMap(STORAGE_KEYS.ATTENDANCE,ATTENDANCE,next=>{ATTENDANCE=next;},mutator);
}
function setAttendanceEntryTx(attKey,val){
  if(val===undefined||val===null) delete ATTENDANCE[attKey];
  else ATTENDANCE[attKey]=val;
  return updateAttendanceMapTx(att=>{
    if(val===undefined||val===null) delete att[attKey];
    else att[attKey]=val;
    return att;
  });
}
function updateAttGuestsMapTx(mutator){
  return _txJSONMap(STORAGE_KEYS.ATT_GUESTS,ATT_GUESTS,next=>{ATT_GUESTS=next;},mutator);
}
function setAttGuestsEntryTx(guestKey,list){
  if(list&&list.length) ATT_GUESTS[guestKey]=list;
  else delete ATT_GUESTS[guestKey];
  return updateAttGuestsMapTx(guests=>{
    if(list&&list.length) guests[guestKey]=list;
    else delete guests[guestKey];
    return guests;
  });
}

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
  if(typeof _tabFolderList!=='undefined'){
    const tf=loadJSON(STORAGE_KEYS.TAB_FOLDERS, []);
    _tabFolderList=Array.isArray(tf)?tf:[];
  }
  if(_auditStorageLoaded){
    AUDIT_LOG=loadJSON(STORAGE_KEYS.AUDIT_LOG, []);
    if(!Array.isArray(AUDIT_LOG)) AUDIT_LOG=[];
    RESTORE_POINTS=loadJSON(STORAGE_KEYS.RESTORE_POINTS, []);
    if(!Array.isArray(RESTORE_POINTS)) RESTORE_POINTS=[];
  }
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
  return updateReserveMapTx(reserve=>{
    if(!reserve[instKey]) reserve[instKey]=[];
    reserve[instKey].push(obj);
    return reserve;
  }).catch(e=>{toast('예약 저장 실패','err');console.error(e);});
}
function removeReserve(instKey,idx){
  if(!RESERVE_MAP[instKey]) return;
  RESERVE_MAP[instKey].splice(idx,1);
  if(!RESERVE_MAP[instKey].length) delete RESERVE_MAP[instKey];
  return updateReserveMapTx(reserve=>{
    if(!reserve[instKey]) return reserve;
    reserve[instKey].splice(idx,1);
    if(!reserve[instKey].length) delete reserve[instKey];
    return reserve;
  }).catch(e=>{toast('예약 저장 실패','err');console.error(e);});
}
function getMark(slotKey,ds){
  const v=MARK_MAP[slotKey+'/'+ds];
  if(!v) return null;
  if(typeof v==='string') return {type:v}; // backward compat
  return v;
}
function setMark(slotKey,ds,val){ setMarkEntryTx(slotKey+'/'+ds,val).catch(e=>{toast('마크 저장 실패','err');console.error(e);}); }
function clearMark(slotKey,ds){ clearMarkEntryTx(slotKey+'/'+ds).catch(e=>{toast('마크 저장 실패','err');console.error(e);}); }

/* ──── Cross-file shared state ──── */
let _pendingSync=false;
let _tabFocusTime=0;
document.addEventListener('visibilitychange',()=>{if(!document.hidden)_tabFocusTime=Date.now();});
window.addEventListener('focus',()=>{_tabFocusTime=Date.now();});
