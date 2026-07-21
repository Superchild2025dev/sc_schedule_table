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
  if(typeof returnToSettingsAfterToolClose==='function' && returnToSettingsAfterToolClose()) return;
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

function _normalizeBangteukGroup(group,fallbackDay){
  const g=String(group||'').replace(/[\/\s]/g,'');
  if(g==='월수금'||g==='화목') return g;
  const d=String(fallbackDay||'');
  if('월수금'.includes(d)) return '월수금';
  if('화목'.includes(d)) return '화목';
  return g||d;
}
function _bangteukTabForDates(opts){
  opts=opts||{};
  if(opts.bangteukTab&&opts.bangteukTab.type==='bangteuk') return opts.bangteukTab;
  if(opts.bangteukTabId&&typeof _tabById==='function'){
    const tab=_tabById(opts.bangteukTabId);
    if(tab&&tab.type==='bangteuk') return tab;
  }
  if(typeof getActiveBangteukBasisTab==='function') return getActiveBangteukBasisTab(opts.bangteukTabId||'');
  return null;
}
function getClassDatesForDay(dayName,opts){
  opts=opts||{};
  const forcedBtTab=opts.bangteukGroup||opts.bangteukTabId||opts.bangteukTab;
  const btTab=forcedBtTab?_bangteukTabForDates(opts):null;
  const basisDayName=(btTab&&btTab.seasonStart&&btTab.seasonEnd)
    ? _normalizeBangteukGroup(opts.bangteukGroup||dayName,dayName)
    : dayName;
  const dayIndexes=getDayIndexes(basisDayName); // 단일 요일 또는 방특 묶음 요일
  if(!dayIndexes.length) return {cur:[],next:[]};

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

  const activeTab=(typeof _tabById==='function')?_tabById(_activeTab):null;
  const dateTab=(btTab&&btTab.seasonStart&&btTab.seasonEnd)?btTab:activeTab;
  if(dateTab?.type==='bangteuk'&&dateTab.seasonStart&&dateTab.seasonEnd){
    const start=String(dateTab.seasonStart);
    const end=String(dateTab.seasonEnd);
    const period={start,end};
    const startLabel=start.slice(5).replace('-','/');
    const endLabel=end.slice(5).replace('-','/');
    return {
      cur:collectDates(period),
      next:[],
      label:`${basisDayName} 방특 ${startLabel}~${endLabel}`,
      mode:'bangteuk',
      tabId:dateTab.id||'',
      group:basisDayName,
      dateCols:dayIndexes.length,
    };
  }

  const pi=getCurrentPeriod();
  const curP=SCHEDULE_PERIODS[pi];
  const nextP=SCHEDULE_PERIODS[pi+1]||null;
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
let _studentSlotConflictSignature='';
function rebuildStuIdx(){
  for(const k in _stuIdx) delete _stuIdx[k];
  const counts=new Map();
  (Array.isArray(STUDENTS)?STUDENTS:[]).forEach(s=>{
    const slotKey=s.t+'/'+s.d+'/'+s.l+'/'+s.r;
    counts.set(slotKey,(counts.get(slotKey)||0)+1);
    _stuIdx[slotKey]=s;
  });
  const conflicts=[...counts.entries()]
    .filter(([,count])=>count>1)
    .map(([slotKey,count])=>({slotKey,count}));
  window.SC_STUDENT_SLOT_CONFLICTS=conflicts;
  const signature=conflicts.map(item=>item.slotKey+':'+item.count).join('|');
  if(signature&&signature!==_studentSlotConflictSignature){
    console.error('[DATA SAFETY] 같은 자리에 원생이 중복 저장되어 일부가 가려질 수 있습니다:',conflicts);
  }
  _studentSlotConflictSignature=signature;
}
function _lookupDayKeys(day){
  const keys=[String(day||'')].filter(Boolean);
  try{
    if(typeof getDayIndexes==='function'){
      const text=String(day||'');
      if(text.length>1){
        text.split('').forEach(ch=>{
          if(getDayIndexes(ch).length&&!keys.includes(ch)) keys.push(ch);
        });
      }else if(typeof isBangteuk==='function'&&isBangteuk()){
        (getTabConfig().days||[]).forEach(groupDay=>{
          if(groupDay!==text&&getDayIndexes(groupDay).includes(DAY_INDEX[text])&&!keys.includes(groupDay)) keys.push(groupDay);
        });
      }
    }
  }catch(e){}
  return keys;
}
function getStu(time,day,lane,row){
  for(const keyDay of _lookupDayKeys(day)){
    const found=_stuIdx[time+'/'+keyDay+'/'+lane+'/'+row];
    if(found) return found;
  }
  return null;
}
function getInst(time,day,lane){
  for(const keyDay of _lookupDayKeys(day)){
    const found=INST_MAP[time+'/'+keyDay+'/'+lane];
    if(found) return found;
  }
  return null;
}

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

function _liveStudentTabSources(){
  const sources=[];
  const seen=new Set();
  const tabs=Array.isArray(_tabList)?_tabList:[];
  const liveTabs=tabs.filter(tab=>tab&&tab.type!=='snapshot');
  if(!liveTabs.some(tab=>tab.id==='regular')){
    liveTabs.unshift({id:'regular',name:'정규시간표',type:'regular'});
  }
  liveTabs.forEach(tab=>{
    const cfg=typeof _tabConfigFor==='function'?_tabConfigFor(tab):null;
    if(!cfg?.stuKey||seen.has(cfg.stuKey)) return;
    seen.add(cfg.stuKey);
    sources.push({
      tabId:String(tab.id||'regular'),
      tabName:String(tab.name||(tab.type==='bangteuk'?'방학특강':'정규시간표')),
      tabType:tab.type==='bangteuk'?'bangteuk':'regular',
      stuKey:cfg.stuKey,
      instKey:cfg.instKey,
    });
  });
  return sources;
}

function getLiveStudentIdentityRows(options){
  const opts=options||{};
  const activeTabId=String(opts.activeTabId||_activeTab||'regular');
  const rows=[];
  _liveStudentTabSources().forEach(source=>{
    const students=source.tabId===activeTabId&&Array.isArray(opts.activeStudents)
      ? opts.activeStudents
      : loadJSON(source.stuKey,[]);
    const instMap=source.tabId===activeTabId&&opts.activeInstMap
      ? opts.activeInstMap
      : loadJSON(source.instKey,{});
    (Array.isArray(students)?students:[]).forEach(stu=>{
      if(!stu) return;
      const inst=instMap&&instMap[[stu.t,stu.d,stu.l].join('/')];
      let teacher='';
      if(inst){
        teacher=typeof instDisplay==='function'?instDisplay(inst):String(inst.name||inst.n||inst||'');
      }
      rows.push(Object.assign({},stu,{
        __tabId:source.tabId,
        __tabName:source.tabName,
        __tabType:source.tabType,
        __teacher:teacher,
        __identitySlotKey:source.tabId+'::'+[stu.t,stu.d,stu.l,stu.r].join('/'),
      }));
    });
  });
  return rows;
}

function findSharedStudentIdentity(name,phone,options){
  const normalizedPhone=window.SCScheduleTime?.normalizeIdentityPhone
    ? window.SCScheduleTime.normalizeIdentityPhone(phone)
    : String(phone||'').replace(/\D/g,'');
  const normalizedName=window.SCScheduleTime?.normalizeIdentityName
    ? window.SCScheduleTime.normalizeIdentityName(name)
    : String(name||'').trim().replace(/\s+/g,' ').toLowerCase();
  if(!normalizedName||!normalizedPhone) return {sid:'',groups:[],selected:null};
  const rows=getLiveStudentIdentityRows(options);
  const groups=window.SCScheduleTime?.findStudentIdentityGroups
    ? window.SCScheduleTime.findStudentIdentityGroups(rows,{n:name,p:phone})
    : [];
  const ranked=groups.slice().sort((a,b)=>{
    const aRegular=(a.entries||[]).filter(row=>row.__tabType==='regular').length;
    const bRegular=(b.entries||[]).filter(row=>row.__tabType==='regular').length;
    return bRegular-aRegular||(b.entries?.length||0)-(a.entries?.length||0)||String(a.sid).localeCompare(String(b.sid));
  });
  return {sid:ranked[0]?.sid||'',groups,selected:ranked[0]||null};
}

function applyAnnualAgeIncrement(){
  if(window.SC_READ_ONLY_PREVIEW) return Promise.resolve(false);
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
async function ensureStudentIdsPersisted(){
  if(window.SC_READ_ONLY_PREVIEW) return false;
  if(typeof isSnapshotTab==='function'&&isSnapshotTab()) return false;
  if(typeof _fakeDate!=='undefined'&&_fakeDate) return false;
  if(window.SCAuth&&typeof SCAuth.can==='function'&&!SCAuth.can('editSchedule')) return false;
  const targetVersion='v2-shared-course';
  if(String(loadJSON(STORAGE_KEYS.STUDENT_ID_VERSION,'')||'')===targetVersion) return false;

  const sources=_liveStudentTabSources();
  const studentKeys=[...new Set(sources.map(source=>source.stuKey))];
  const txKeys=[
    ...studentKeys,
    STORAGE_KEYS.ENROLL,
    STORAGE_KEYS.RETIRE,
    STORAGE_KEYS.RETIRE_HISTORY,
    STORAGE_KEYS.STUDENT_ID_VERSION,
  ];
  await updateScheduleTx(txKeys,ctx=>{
    const docs=new Map();
    const identityGroups=new Map();
    const identityKeyFor=value=>{
      const name=window.SCScheduleTime?.normalizeIdentityName
        ? window.SCScheduleTime.normalizeIdentityName(value?.n||value?.name)
        : String(value?.n||value?.name||'').trim().replace(/\s+/g,' ').toLowerCase();
      const phone=window.SCScheduleTime?.normalizeIdentityPhone
        ? window.SCScheduleTime.normalizeIdentityPhone(value?.p||value?.phone)
        : String(value?.p||value?.phone||'').replace(/\D/g,'');
      return name&&phone?name+'|'+phone:'';
    };
    const sourceByKey=new Map(sources.map(source=>[source.stuKey,source]));

    studentKeys.forEach(key=>{
      const students=ctx.get(key,[]);
      const list=Array.isArray(students)?students:[];
      docs.set(key,list);
      list.forEach(stu=>{
        if(window.SCScheduleTime?.ensureStudentId) window.SCScheduleTime.ensureStudentId(stu);
        const identityKey=identityKeyFor(stu);
        if(!identityKey) return;
        if(!identityGroups.has(identityKey)) identityGroups.set(identityKey,[]);
        identityGroups.get(identityKey).push({stu,source:sourceByKey.get(key)});
      });
    });

    const canonicalByIdentity=new Map();
    const canonicalBySid=new Map();
    const ambiguousOldSids=new Set();
    identityGroups.forEach((items,identityKey)=>{
      const counts=new Map();
      items.forEach(item=>{
        const sid=String(item.stu.sid||'');
        if(!sid) return;
        const score=counts.get(sid)||{regular:0,total:0};
        score.total++;
        if(item.source?.tabType==='regular') score.regular++;
        counts.set(sid,score);
      });
      const canonical=[...counts.entries()].sort((a,b)=>
        b[1].regular-a[1].regular||b[1].total-a[1].total||a[0].localeCompare(b[0])
      )[0]?.[0]||'';
      if(!canonical) return;
      canonicalByIdentity.set(identityKey,canonical);
      items.forEach(item=>{
        const oldSid=String(item.stu.sid||'');
        if(oldSid&&oldSid!==canonical){
          if(canonicalBySid.has(oldSid)&&canonicalBySid.get(oldSid)!==canonical){
            canonicalBySid.delete(oldSid);
            ambiguousOldSids.add(oldSid);
          }else if(!ambiguousOldSids.has(oldSid)){
            canonicalBySid.set(oldSid,canonical);
          }
        }
        item.stu.sid=canonical;
      });
    });

    const alignedSidFor=entry=>{
      const identityKey=identityKeyFor(entry);
      const byIdentity=canonicalByIdentity.get(identityKey);
      if(byIdentity) return byIdentity;
      const oldSid=String(entry?.sid||'');
      return canonicalBySid.get(oldSid)||oldSid;
    };
    const alignReservationIds=map=>{
      Object.values(map||{}).forEach(entry=>{
        if(!entry||typeof entry!=='object') return;
        const canonical=alignedSidFor(entry);
        if(canonical) entry.sid=canonical;
        else if(!entry.sid&&window.SCScheduleTime?.studentIdFor){
          const sid=window.SCScheduleTime.studentIdFor({n:entry.name,a:entry.age,p:entry.p,g:entry.g});
          if(sid) entry.sid=sid;
        }
      });
      return map;
    };

    studentKeys.forEach(key=>ctx.set(key,docs.get(key)||[]));
    ctx.set(STORAGE_KEYS.ENROLL,alignReservationIds(ctx.get(STORAGE_KEYS.ENROLL,{})));
    ctx.set(STORAGE_KEYS.RETIRE,alignReservationIds(ctx.get(STORAGE_KEYS.RETIRE,{})));
    const retireHistory=ctx.get(STORAGE_KEYS.RETIRE_HISTORY,[]);
    (Array.isArray(retireHistory)?retireHistory:[]).forEach(entry=>{
      const canonical=alignedSidFor(entry);
      if(canonical) entry.sid=canonical;
    });
    ctx.set(STORAGE_KEYS.RETIRE_HISTORY,Array.isArray(retireHistory)?retireHistory:[]);
    ctx.set(STORAGE_KEYS.STUDENT_ID_VERSION,targetVersion);
    return true;
  }, {skipAudit:true,skipUndo:true,skipDeleteSafety:true,label:'정규·방특 원생 ID 연결'});
  return true;
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
const SCHEDULE_UNDO_ENABLED=false;
let _undoLock=false;
let _lastUndoPush=0;
function pushUndo(){
  if(!SCHEDULE_UNDO_ENABLED) return;
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
function _undoTracksStorageKey(key){
  const k=String(key||'');
  return k===STORAGE_KEYS.STUDENTS
    || k===STORAGE_KEYS.INST
    || /^swim_stu_/.test(k)
    || /^swim_inst_/.test(k)
    || /^swim_bt_.*_(stu|inst)$/.test(k)
    || k===STORAGE_KEYS.RETIRE
    || k===STORAGE_KEYS.ENROLL
    || k===STORAGE_KEYS.MARK
    || k===STORAGE_KEYS.DISABLED
    || k===STORAGE_KEYS.RESERVE
    || k===STORAGE_KEYS.休원
    || k===STORAGE_KEYS.MOVE;
}
function pushUndoForKeys(keys){
  const list=Array.isArray(keys)?keys:[keys];
  if(list.some(_undoTracksStorageKey)) pushUndo();
}
function popUndo(){
  if(!SCHEDULE_UNDO_ENABLED){
    toast('동시 편집 보호를 위해 시간표 전체 되돌리기는 사용하지 않습니다','err');
    return;
  }
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

function _isAttendanceViewActive(){
  return typeof _attendanceMode!=='undefined' && !!_attendanceMode;
}
function getDays(){
  if(_isAttendanceViewActive() && typeof isBangteuk==='function' && isBangteuk()) return ['월','화','수','목','금'];
  return getTabConfig().days;
}
function getLanes(){ return getTabConfig().lanes; }
const TIMES_REG=[{t:'1시'},{t:'2시'},{t:'3시'},{t:'4시'},{t:'5시'},{t:'6시'},{t:'7시'},{t:'8시'}];
function getTimes(){ return _activeTab==='regular'?TIMES_REG:getTabConfig().times; }
function getTimeRows(t){ 
  const baseRows=isBangteuk()?6:5;
  const maxRows=isBangteuk()?6:8;
  let rows=hasElmaInTime(t)?maxRows:(hasBangteukInTime(t)?6:baseRows);
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
function getHasNum(){
  if(_isAttendanceViewActive() && typeof isBangteuk==='function' && isBangteuk()) return ['월'];
  return getTabConfig().hasNum;
}
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
  if(typeof returnToSettingsAfterToolClose==='function' && returnToSettingsAfterToolClose()) return;
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
function isBangteukInst(inst){
  if(window.SCScheduleTime&&typeof window.SCScheduleTime.isBangteukInst==='function') return window.SCScheduleTime.isBangteukInst(inst);
  return !!(inst&&typeof inst==='object'&&(inst.bt||inst.bangteuk||inst.btGroup||inst.btTabId||inst.cls==='bt'||inst.cls==='bangteuk'));
}
function _bangteukMetaFromRaw(raw,day){
  if(!raw) return null;
  const group=_normalizeBangteukGroup(raw.group||raw.btGroup||'',day);
  const tabId=raw.tabId||raw.btTabId||'';
  const tab=_bangteukTabForDates({bangteukTabId:tabId});
  const label=tab&&tab.seasonStart&&tab.seasonEnd
    ? `${group} 방특 ${tab.seasonStart.slice(5).replace('-','/')}~${tab.seasonEnd.slice(5).replace('-','/')}`
    : `${group} 방특`;
  return {
    group,
    tabId:tab?.id||tabId||'',
    tabName:tab?.name||raw.tabName||'',
    seasonStart:tab?.seasonStart||raw.seasonStart||'',
    seasonEnd:tab?.seasonEnd||raw.seasonEnd||'',
    label,
  };
}
function getBangteukSlotMeta(t,day,lane){
  const key=t+'/'+day+'/'+lane;
  const inst=typeof getInst==='function'?getInst(t,day,lane):null;
  if(isBangteukInst(inst)){
    return _bangteukMetaFromRaw(inst,day);
  }
  if(typeof getBtPreviewInst==='function'){
    const preview=getBtPreviewInst(key);
    if(preview) return _bangteukMetaFromRaw(preview===true?{}:preview,day);
  }
  return null;
}

function instDisplay(inst){
  if(!inst) return '';
  let s=inst.n;
  if(inst.lead) s='1)'+s;
  if(inst.youth) s+='(유아)';
  if(isBangteukInst(inst)) s+=inst.btGroup?`(${inst.btGroup} 방특)`:'(방특)';
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
function getElmaLanes(t,day,instMapOverride){
  const instSource=instMapOverride||INST_MAP;
  const elma=[];
  const names={};
  const clss={};
  for(let l=1;l<=getLanes();l++){
    const inst=instMapOverride?instSource[t+'/'+day+'/'+l]:getInst(t,day,l);
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
function hasBangteukInTime(t){
  for(const d of getDays()){
    for(let l=1;l<=getLanes();l++){
      if(isBangteukInst(getInst(t,d,l))) return true;
    }
  }
  return false;
}

function bogangSchedulePrefix(mark){
  const type=String(mark?.studentScheduleType||'');
  if(type==='regular') return '(정)';
  if(type==='bangteuk') return '(방)';
  return '';
}
function bogangDisplayName(mark){
  const raw=String(mark?.n||mark?.name||'').trim();
  const prefix=bogangSchedulePrefix(mark);
  if(!prefix) return raw;
  return prefix+' '+raw.replace(/^\((?:정|방)\)\s*/,'');
}

/* ══════════════════════════════════════════
   전역 STATE
   ══════════════════════════════════════════
   각 맵의 키는 'time/day/lane/row' 형식 (slotKey)
   예: '4시/월/2/3' = 4시 월요일 2레인 3번

   RETIRE_MAP[slotKey]    = { ds:'YYYY-MM-DD', name, age?, p? }                       // 제외/퇴원 예약
   ENROLL_MAP[slotKey]    = { ds, name, age, p?, isNew?, enrolled? }                   // 등원 예약
   MARK_MAP[slotKey/ds]   = { type:'absent'|'bogang'|'sample', n?, a?, p?, studentScheduleType?, sub? } // 결석/보강/샘플
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
let ATTENDANCE   = loadJSON(_attendanceStorageKey('attendance'), {});
// ATT_GUESTS[slotKey/date] = [{gid, n, a, p, s:'present'|'absent', at, by}]
let ATT_GUESTS   = loadJSON(_attendanceStorageKey('attGuests'), {});
// DAY_SNAPSHOT[date] = { date, students, inst } — 과거 날짜 동결용
// 날짜별 문서는 필요할 때만 불러오며, 이 맵에는 현재 세션에서 연 날짜만 둔다.
let DAY_SNAPSHOT = {};
// [v118] RETIRE_HISTORY = [{retiredAt, recordedAt, t, d, l, r, n, a, p, loc, memo, enrolledFrom}, ...] 퇴원 기록 (영구 보관)
let RETIRE_HISTORY = loadJSON(STORAGE_KEYS.RETIRE_HISTORY, []);
let DESK_NOTES = loadJSON(STORAGE_KEYS.DESK_NOTES, []);
if(!Array.isArray(DESK_NOTES)) DESK_NOTES=[];
let AUDIT_LOG = [];
let RESTORE_POINTS = [];
let STUDENT_DELETE_LOG = [];
const AUDIT_LOG_MAX=200;
const RESTORE_POINT_MAX=12;
const STUDENT_DELETE_LOG_MAX=500;
const AUDIT_STORAGE_LIMIT=8*1024*1024;
const RECORD_PAGE_SIZE=30;
let _auditLock=false;
let _recordPage=1;
let _auditPersistQueue=Promise.resolve();
let _studentDeletePersistQueue=Promise.resolve();
const _restorePayloadCache=new Map();
const RESTORE_PAYLOAD_CACHE_LIMIT=2;

function _attendanceStorageKeys(tabId){
  if(typeof getAttendanceStorageKeys==='function') return getAttendanceStorageKeys(tabId);
  return {attendance:STORAGE_KEYS.ATTENDANCE,attGuests:STORAGE_KEYS.ATT_GUESTS,daySnapshot:STORAGE_KEYS.DAY_SNAPSHOT};
}
function _attendanceStorageKey(kind,tabId){
  const keys=_attendanceStorageKeys(tabId);
  return keys[kind]||STORAGE_KEYS.ATTENDANCE;
}
function _currentAttendanceKeys(){
  return _attendanceStorageKeys(_activeTab);
}
function _isAttendanceStorageKey(key){
  if(key===STORAGE_KEYS.ATTENDANCE||key===STORAGE_KEYS.ATT_GUESTS||key===STORAGE_KEYS.DAY_SNAPSHOT) return true;
  return /^swim_bt_(attendance|att_guests|day_snapshot)_/.test(String(key||''))
      || /^zz_swim_day_snapshot__/.test(String(key||''));
}
let _auditStorageLoaded=false;
let _auditStorageLoading=null;
let _scheduleAuditLoaded=false;
let _scheduleAuditLoading=null;
let _scheduleAuditLoadRetryAt=0;

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
  if(key===STORAGE_KEYS.ATTENDANCE||/^swim_bt_attendance_/.test(key)) return '출석부 편집';
  if(key===STORAGE_KEYS.ATT_GUESTS||/^swim_bt_att_guests_/.test(key)) return '출석부 추가학생 편집';
  if(key===STORAGE_KEYS.DAY_SNAPSHOT||/^swim_bt_day_snapshot_/.test(key)||/^zz_swim_day_snapshot__/.test(key)) return '날짜 스냅샷 편집';
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
    STORAGE_KEYS.ATTENDANCE,STORAGE_KEYS.ATT_GUESTS,
    STORAGE_KEYS.CLOSED,STORAGE_KEYS.TAB_LIST,STORAGE_KEYS.TAB_FOLDERS,
    STORAGE_KEYS.TEACHERS,STORAGE_KEYS.PERIODS,STORAGE_KEYS.RETIRE_HISTORY,
    STORAGE_KEYS.AGE_YEAR,
  ]);
  (_tabList||[]).forEach(tab=>{
    if(!tab||tab.type==='snapshot') return;
    if(tab.type==='bangteuk'){
      keys.add('swim_bt_'+tab.id+'_stu');
      keys.add('swim_bt_'+tab.id+'_inst');
      const ak=_attendanceStorageKeys(tab.id);
      keys.add(ak.attendance);
      keys.add(ak.attGuests);
    }else{
      keys.add(tab.id==='regular'?'swim_students':'swim_stu_'+tab.id);
      keys.add(tab.id==='regular'?'swim_inst':'swim_inst_'+tab.id);
    }
  });
  try{
    const cfg=getTabConfig();
    if(cfg?.stuKey) keys.add(cfg.stuKey);
    if(cfg?.instKey) keys.add(cfg.instKey);
    const ak=_currentAttendanceKeys();
    keys.add(ak.attendance);
    keys.add(ak.attGuests);
  }catch(e){}
  return [...keys].filter(Boolean);
}
function _auditEditKeys(){
  const keys=new Set([
    STORAGE_KEYS.RETIRE,STORAGE_KEYS.ENROLL,STORAGE_KEYS.MARK,STORAGE_KEYS.DISABLED,
    STORAGE_KEYS.RESERVE,STORAGE_KEYS.休원,STORAGE_KEYS.MOVE,STORAGE_KEYS.REQUESTS,
    STORAGE_KEYS.CLOSED,STORAGE_KEYS.TEACHERS,STORAGE_KEYS.PERIODS,
    STORAGE_KEYS.RETIRE_HISTORY,STORAGE_KEYS.AGE_YEAR,
  ]);
  try{
    const cfg=getTabConfig();
    if(cfg?.stuKey) keys.add(cfg.stuKey);
    if(cfg?.instKey) keys.add(cfg.instKey);
    const ak=_currentAttendanceKeys();
    keys.add(ak.attendance);
    keys.add(ak.attGuests);
  }catch(e){}
  return [...keys].filter(Boolean);
}
function _captureRestoreState(extraKeys){
  const keys=[...new Set((extraKeys||[]).filter(Boolean))]
    .filter(key=>!_isAuditStorageKey(key));
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
    .filter(key=>!_isAuditStorageKey(key));
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
  if(stu.sid) return String(stu.sid);
  return [stu.n||'',stu.p||'',stu.a||'',stu.g||''].join('|');
}
function _studentOccurrenceKey(stu){
  return _auditStudentId(stu)+'@'+_auditStudentSlot(stu);
}
function _studentSidCounts(list){
  const counts=new Map();
  (Array.isArray(list)?list:[]).forEach(stu=>{
    const sid=_auditStudentId(stu);
    if(sid) counts.set(sid,(counts.get(sid)||0)+1);
  });
  return counts;
}
function _studentDeletionEvents(storageKey,beforeValue,afterValue,meta){
  if(!_auditIsStudentKey(String(storageKey||''))||meta?.skipDeleteSafety) return [];
  const before=Array.isArray(beforeValue)?beforeValue:[];
  const after=Array.isArray(afterValue)?afterValue:[];
  const remaining=new Map();
  after.forEach(stu=>{
    const key=_studentOccurrenceKey(stu);
    remaining.set(key,(remaining.get(key)||0)+1);
  });
  const beforeSidCounts=_studentSidCounts(before);
  const afterSidCounts=_studentSidCounts(after);
  const events=[];
  before.forEach(stu=>{
    const occurrenceKey=_studentOccurrenceKey(stu);
    const count=remaining.get(occurrenceKey)||0;
    if(count>0){
      remaining.set(occurrenceKey,count-1);
      return;
    }
    const sid=_auditStudentId(stu);
    const isRelocated=meta?.type==='move'&&sid&&(afterSidCounts.get(sid)||0)>=(beforeSidCounts.get(sid)||0);
    if(isRelocated) return;
    events.push({
      storageKey,
      sid,
      slotKey:_auditStudentSlot(stu),
      student:_cloneJSON(stu),
    });
  });
  return events;
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
  if(storageKey===STORAGE_KEYS.ATTENDANCE||/^swim_bt_attendance_/.test(storageKey)){
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
  if(!Array.isArray(STUDENT_DELETE_LOG)) STUDENT_DELETE_LOG=[];
  while(AUDIT_LOG.length>AUDIT_LOG_MAX){ AUDIT_LOG.shift(); changed=true; }
  while(RESTORE_POINTS.length>RESTORE_POINT_MAX){ RESTORE_POINTS.shift(); changed=true; }
  while(STUDENT_DELETE_LOG.length>STUDENT_DELETE_LOG_MAX){ STUDENT_DELETE_LOG.shift(); changed=true; }
  return changed;
}
function _auditEntryStorageKey(id){
  return 'zz_swim_audit_entry__'+String(id||'');
}
function _restoreEntryStorageKey(id){
  return 'zz_swim_restore_point__'+String(id||'');
}
function _studentDeleteEntryStorageKey(id){
  return 'zz_swim_student_delete__'+String(id||'');
}
function _auditSortValue(item){
  return String(item?.at||item?.recordedAt||'');
}
function _recordMergeKey(item,index){
  if(item?.id) return String(item.id);
  return ['legacy',_auditSortValue(item),item?.label||'',item?.target||'',item?.detail||'',index].join('|');
}
function _mergeRecordStorageLists(legacy,indexed,max){
  const merged=new Map();
  [...(Array.isArray(legacy)?legacy:[]),...(Array.isArray(indexed)?indexed:[])].forEach((item,idx)=>{
    if(!item||typeof item!=='object') return;
    const key=_recordMergeKey(item,idx);
    const previous=merged.get(key)||{};
    const next={...previous,...item};
    if(previous.before&&!item.before) next.before=previous.before;
    merged.set(key,next);
  });
  const list=[...merged.values()].sort((a,b)=>_auditSortValue(a).localeCompare(_auditSortValue(b)));
  return list.slice(Math.max(0,list.length-max));
}
function _prepareRestorePointForStorage(point){
  if(!point) return point;
  return _auditByteSize(point)>AUDIT_STORAGE_LIMIT ? _thinRestorePoint(point) : point;
}
function _auditIndexEntry(entry,entryKey){
  return {...entry,entryKey};
}
function _restoreIndexEntry(point,entryKey){
  const out={...point,entryKey,hasPayload:!point?.before?.skipped};
  delete out.before;
  return out;
}
function _studentDeleteIndexEntry(entry,entryKey){
  const out={...entry,entryKey};
  delete out.student;
  return out;
}
function _appendStorageIndex(raw,item,max){
  const parsed=_auditParseStored(raw,[]);
  let list=Array.isArray(parsed)?parsed.filter(row=>row&&row.id!==item.id):[];
  list.push(item);
  list.sort((a,b)=>_auditSortValue(a).localeCompare(_auditSortValue(b)));
  const removed=list.length>max?list.slice(0,list.length-max):[];
  list=list.slice(Math.max(0,list.length-max));
  return {list,removed};
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
    _readAuditRaw(STORAGE_KEYS.AUDIT_INDEX),
    _readAuditRaw(STORAGE_KEYS.RESTORE_INDEX),
    _readAuditRaw(STORAGE_KEYS.STUDENT_DELETE_INDEX),
  ]).then(([logRaw,restoreRaw,auditIndexRaw,restoreIndexRaw,studentDeleteIndexRaw])=>{
    if(logRaw===undefined||logRaw===null) logRaw=dbGet(STORAGE_KEYS.AUDIT_LOG);
    if(restoreRaw===undefined||restoreRaw===null) restoreRaw=dbGet(STORAGE_KEYS.RESTORE_POINTS);
    if(auditIndexRaw===undefined||auditIndexRaw===null) auditIndexRaw=dbGet(STORAGE_KEYS.AUDIT_INDEX);
    if(restoreIndexRaw===undefined||restoreIndexRaw===null) restoreIndexRaw=dbGet(STORAGE_KEYS.RESTORE_INDEX);
    if(studentDeleteIndexRaw===undefined||studentDeleteIndexRaw===null) studentDeleteIndexRaw=dbGet(STORAGE_KEYS.STUDENT_DELETE_INDEX);
    _cacheAuditRaw(STORAGE_KEYS.AUDIT_LOG,logRaw);
    _cacheAuditRaw(STORAGE_KEYS.RESTORE_POINTS,restoreRaw);
    _cacheAuditRaw(STORAGE_KEYS.AUDIT_INDEX,auditIndexRaw);
    _cacheAuditRaw(STORAGE_KEYS.RESTORE_INDEX,restoreIndexRaw);
    _cacheAuditRaw(STORAGE_KEYS.STUDENT_DELETE_INDEX,studentDeleteIndexRaw);
    AUDIT_LOG=_mergeRecordStorageLists(
      _auditParseStored(logRaw,[]),
      _auditParseStored(auditIndexRaw,[]),
      AUDIT_LOG_MAX
    );
    RESTORE_POINTS=_mergeRecordStorageLists(
      _auditParseStored(restoreRaw,[]),
      _auditParseStored(restoreIndexRaw,[]),
      RESTORE_POINT_MAX
    );
    STUDENT_DELETE_LOG=_mergeRecordStorageLists(
      STUDENT_DELETE_LOG,
      _auditParseStored(studentDeleteIndexRaw,[]),
      STUDENT_DELETE_LOG_MAX
    );
    _trimAuditStorage();
    _auditStorageLoaded=true;
  }).finally(()=>{
    _auditStorageLoading=null;
  });
  return _auditStorageLoading;
}
function _cleanupIncrementalRecordKeys(keys){
  if(!_fbReady||!_fb) return Promise.resolve();
  const unique=[...new Set((keys||[]).filter(key=>/^zz_swim_(audit_entry|restore_point|student_delete)__/.test(String(key||''))))];
  return Promise.all(unique.map(key=>_fb.child(key).remove().catch(err=>{
    console.warn('이전 개별 기록 정리 실패:',key,err);
  })));
}
function _cacheCommittedRecordIndexes(root){
  if(!root) return;
  if(root[STORAGE_KEYS.AUDIT_INDEX]!==undefined) _cacheAuditRaw(STORAGE_KEYS.AUDIT_INDEX,root[STORAGE_KEYS.AUDIT_INDEX]);
  if(root[STORAGE_KEYS.RESTORE_INDEX]!==undefined) _cacheAuditRaw(STORAGE_KEYS.RESTORE_INDEX,root[STORAGE_KEYS.RESTORE_INDEX]);
  if(root[STORAGE_KEYS.STUDENT_DELETE_INDEX]!==undefined) _cacheAuditRaw(STORAGE_KEYS.STUDENT_DELETE_INDEX,root[STORAGE_KEYS.STUDENT_DELETE_INDEX]);
}
function _persistIncrementalRecord(entry,restorePoint){
  if(!_fbReady||!_fb) return Promise.reject(new Error('기록 저장 서버가 연결되지 않았습니다'));
  const auditEntryKey=_auditEntryStorageKey(entry.id);
  const restoreEntryKey=restorePoint?_restoreEntryStorageKey(restorePoint.id):'';
  const auditSummary=_auditIndexEntry(entry,auditEntryKey);
  const restoreSummary=restorePoint?_restoreIndexEntry(restorePoint,restoreEntryKey):null;
  const txKeys=[STORAGE_KEYS.AUDIT_INDEX,auditEntryKey];
  if(restorePoint) txKeys.push(STORAGE_KEYS.RESTORE_INDEX,restoreEntryKey);

  const persist=()=>{
    let cleanupKeys=[];
    if(typeof _fb.transactionKeys==='function'&&!_fb.disabled){
      return _fb.transactionKeys(txKeys,root=>{
        root=root||{};
        cleanupKeys=[];
        const auditNext=_appendStorageIndex(root[STORAGE_KEYS.AUDIT_INDEX],auditSummary,AUDIT_LOG_MAX);
        root[STORAGE_KEYS.AUDIT_INDEX]=JSON.stringify(auditNext.list);
        root[auditEntryKey]=JSON.stringify(auditSummary);
        cleanupKeys.push(...auditNext.removed.map(row=>row.entryKey));
        if(restorePoint){
          const restoreNext=_appendStorageIndex(root[STORAGE_KEYS.RESTORE_INDEX],restoreSummary,RESTORE_POINT_MAX);
          root[STORAGE_KEYS.RESTORE_INDEX]=JSON.stringify(restoreNext.list);
          root[restoreEntryKey]=JSON.stringify(restorePoint);
          cleanupKeys.push(...restoreNext.removed.map(row=>row.entryKey));
        }
        return root;
      }).then(res=>{
        _cacheCommittedRecordIndexes(res?.snapshot?.val?.()||{});
        return _cleanupIncrementalRecordKeys(cleanupKeys);
      });
    }

    const writes=[_fb.child(auditEntryKey).set(JSON.stringify(auditSummary))];
    if(restorePoint) writes.push(_fb.child(restoreEntryKey).set(JSON.stringify(restorePoint)));
    return Promise.all(writes).then(()=>{
      const indexJobs=[];
      indexJobs.push(_fb.child(STORAGE_KEYS.AUDIT_INDEX).transaction(raw=>{
        const next=_appendStorageIndex(raw,auditSummary,AUDIT_LOG_MAX);
        cleanupKeys.push(...next.removed.map(row=>row.entryKey));
        return JSON.stringify(next.list);
      }).then(res=>_cacheAuditRaw(STORAGE_KEYS.AUDIT_INDEX,res.snapshot.val())));
      if(restorePoint){
        indexJobs.push(_fb.child(STORAGE_KEYS.RESTORE_INDEX).transaction(raw=>{
          const next=_appendStorageIndex(raw,restoreSummary,RESTORE_POINT_MAX);
          cleanupKeys.push(...next.removed.map(row=>row.entryKey));
          return JSON.stringify(next.list);
        }).then(res=>_cacheAuditRaw(STORAGE_KEYS.RESTORE_INDEX,res.snapshot.val())));
      }
      return Promise.all(indexJobs);
    }).then(()=>_cleanupIncrementalRecordKeys(cleanupKeys));
  };

  const run=_auditPersistQueue.then(persist,persist);
  _auditPersistQueue=run.catch(()=>{});
  return run;
}
function _persistStudentDeleteEntry(entry){
  if(!_fbReady||!_fb) return Promise.reject(new Error('삭제 안전기록 서버가 연결되지 않았습니다'));
  const entryKey=_studentDeleteEntryStorageKey(entry.id);
  const summary=_studentDeleteIndexEntry(entry,entryKey);
  const persist=()=>{
    let cleanupKeys=[];
    if(typeof _fb.transactionKeys==='function'&&!_fb.disabled){
      return _fb.transactionKeys([STORAGE_KEYS.STUDENT_DELETE_INDEX,entryKey],root=>{
        root=root||{};
        cleanupKeys=[];
        const next=_appendStorageIndex(root[STORAGE_KEYS.STUDENT_DELETE_INDEX],summary,STUDENT_DELETE_LOG_MAX);
        root[STORAGE_KEYS.STUDENT_DELETE_INDEX]=JSON.stringify(next.list);
        root[entryKey]=JSON.stringify(entry);
        cleanupKeys.push(...next.removed.map(row=>row.entryKey));
        return root;
      }).then(res=>{
        _cacheCommittedRecordIndexes(res?.snapshot?.val?.()||{});
        return _cleanupIncrementalRecordKeys(cleanupKeys);
      });
    }
    return _fb.child(entryKey).set(JSON.stringify(entry)).then(()=>{
      return _fb.child(STORAGE_KEYS.STUDENT_DELETE_INDEX).transaction(raw=>{
        const next=_appendStorageIndex(raw,summary,STUDENT_DELETE_LOG_MAX);
        cleanupKeys.push(...next.removed.map(row=>row.entryKey));
        return JSON.stringify(next.list);
      });
    }).then(res=>{
      _cacheAuditRaw(STORAGE_KEYS.STUDENT_DELETE_INDEX,res.snapshot.val());
      return _cleanupIncrementalRecordKeys(cleanupKeys);
    });
  };
  const run=_studentDeletePersistQueue.then(persist,persist);
  _studentDeletePersistQueue=run.catch(()=>{});
  return run;
}
function _studentDeleteReasonText(reason){
  const labels={
    'manual-delete':'사용자 직접 삭제',
    'auto-retire':'제외일 경과 자동 처리',
    'convert-to-enroll':'기존 원생을 등록 예약으로 전환',
    'enroll-cancel':'등록 예약 취소 중 원생 제거',
    'student-replace':'다른 원생으로 교체',
    'schedule-edit':'시간표 편집 중 원생 제거',
  };
  return labels[String(reason||'')]||String(reason||'시간표 편집 중 원생 제거');
}
function recordStudentDeletionSafety(events,meta){
  const list=Array.isArray(events)?events.filter(Boolean):[];
  if(!list.length) return Promise.resolve();
  const at=_auditNow();
  const user=_auditUser();
  const tabId=_activeTab;
  const tabName=_auditTabName();
  const reason=meta?.deleteReason||'schedule-edit';
  const entries=list.map(event=>{
    const stu=event.student||{};
    const target=_auditStudentName(stu);
    return {
      id:_auditId('student_delete'),
      at,
      type:'delete',
      label:meta?.label||'원생 삭제',
      target,
      detail:`${_auditSlotText(event.slotKey)} · ${_studentDeleteReasonText(reason)}`,
      reason,
      sid:event.sid||stu.sid||'',
      slotKey:event.slotKey||'',
      storageKey:event.storageKey||'',
      student:_cloneJSON(stu),
      tabId,
      tabName,
      user,
    };
  });
  const summaries=entries.map(entry=>_studentDeleteIndexEntry(entry,_studentDeleteEntryStorageKey(entry.id)));
  STUDENT_DELETE_LOG=_mergeRecordStorageLists(STUDENT_DELETE_LOG,summaries,STUDENT_DELETE_LOG_MAX);
  _trimAuditStorage();
  if(document.getElementById('record-manager-modal')?.style.display==='flex') renderRecordManager();
  return Promise.all(entries.map(entry=>_persistStudentDeleteEntry(entry).catch(err=>{
    console.error('원생 삭제 안전기록 저장 실패:',err);
    if(typeof _showOfflineWarning==='function') _showOfflineWarning();
  })));
}
function recordAuditPoint(point,touchedKeys,metaOverride){
  if(!point||_auditLock) return;
  if(!_auditStorageLoaded){
    return _loadAuditStorage().then(()=>{
      return recordAuditPoint(point,touchedKeys,metaOverride);
    }).catch(err=>{
      console.warn('기록 저장 전 기존 기록 로드 실패:',err);
      _auditStorageLoaded=true;
      return recordAuditPoint(point,touchedKeys,metaOverride);
    });
  }
  const keys=[...new Set((touchedKeys&&touchedKeys.length?touchedKeys:point.keys||[]).filter(Boolean))]
    .filter(key=>!_isAuditStorageKey(key));
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
  let restorePoint={
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
  };
  restorePoint=_prepareRestorePointForStorage(restorePoint);
  const restoreEntryKey=_restoreEntryStorageKey(restorePoint.id);
  const auditEntryKey=_auditEntryStorageKey(entry.id);
  entry.entryKey=auditEntryKey;
  entry.restoreAvailable=!restorePoint.before?.skipped;
  const restoreSummary=_restoreIndexEntry(restorePoint,restoreEntryKey);
  _cacheRestorePayload(restoreEntryKey,restorePoint);
  AUDIT_LOG=_mergeRecordStorageLists(AUDIT_LOG,[entry],AUDIT_LOG_MAX);
  RESTORE_POINTS=_mergeRecordStorageLists(RESTORE_POINTS,[restoreSummary],RESTORE_POINT_MAX);
  _trimAuditStorage();
  const saved=_persistIncrementalRecord(entry,restorePoint).catch(err=>{
    console.error('개별 기록 저장 실패:',err);
    if(typeof _showOfflineWarning==='function') _showOfflineWarning();
  });
  if(document.getElementById('record-manager-modal')?.style.display==='flex'){
    renderRecordManager();
  }
  if(typeof renderScheduleAuditSummary==='function') renderScheduleAuditSummary();
  return saved;
}
function _fmtAuditDate(iso){
  if(!iso) return '-';
  try{
    const d=new Date(iso);
    return (d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }catch(e){return '-';}
}
function _recordTypeLabel(type){
  return type==='move'?'이동':type==='retire'?'퇴원':type==='delete'?'삭제':type==='restore'?'복구':'편집';
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
  if(typeof returnToSettingsAfterToolClose==='function') returnToSettingsAfterToolClose();
}
function _recordItems(includeSafety){
  const withSafety=includeSafety!==false;
  const audit=(Array.isArray(AUDIT_LOG)?AUDIT_LOG:[]).map(r=>({...r,_source:'audit'}));
  const retire=(Array.isArray(RETIRE_HISTORY)?RETIRE_HISTORY:[]).map((r,idx)=>({
    id:'retire_'+idx,
    at:r.recordedAt,
    effectiveDate:r.retiredAt||'',
    type:'retire',
    label:(r.n||'')+' 퇴원',
    target:`${r.n||''}${r.a?`(${r.a})`:''}`,
    detail:`${r.retiredAt||'-'} · ${r.t||''} ${r.d||''} ${r.l||''}레인 ${r.r||''}번${r.inst?' · '+r.inst:''}`,
    user:'기록',
    tabName:'',
    _source:'retire',
  }));
  const safety=withSafety
    ? (Array.isArray(STUDENT_DELETE_LOG)?STUDENT_DELETE_LOG:[]).map(r=>({...r,type:'delete',_source:'student-delete'}))
    : [];
  return audit.concat(retire,safety);
}
function _loadScheduleAuditLog(){
  if(_auditStorageLoaded||_scheduleAuditLoaded) return Promise.resolve();
  if(_scheduleAuditLoading) return _scheduleAuditLoading;
  _scheduleAuditLoading=Promise.all([
    _readAuditRaw(STORAGE_KEYS.AUDIT_LOG),
    _readAuditRaw(STORAGE_KEYS.AUDIT_INDEX),
  ]).then(([legacyRaw,indexRaw])=>{
    if(legacyRaw===undefined||legacyRaw===null) legacyRaw=dbGet(STORAGE_KEYS.AUDIT_LOG);
    if(indexRaw===undefined||indexRaw===null) indexRaw=dbGet(STORAGE_KEYS.AUDIT_INDEX);
    _cacheAuditRaw(STORAGE_KEYS.AUDIT_LOG,legacyRaw);
    _cacheAuditRaw(STORAGE_KEYS.AUDIT_INDEX,indexRaw);
    AUDIT_LOG=_mergeRecordStorageLists(
      _auditParseStored(legacyRaw,[]),
      _auditParseStored(indexRaw,[]),
      AUDIT_LOG_MAX
    );
    _trimAuditStorage();
    _scheduleAuditLoaded=true;
  }).finally(()=>{
    _scheduleAuditLoading=null;
  });
  return _scheduleAuditLoading;
}
function _scheduleAuditMonthFromTabName(tab,fallbackMonth){
  const text=String(tab?.name||'').trim();
  const match=text.match(/(?:(20\d{2})\s*년?\s*)?(\d{1,2})\s*월/);
  if(!match) return '';
  const fallback=_scheduleAuditNormalizeMonthKey(fallbackMonth);
  let year=match[1]||String(fallback||'').slice(0,4);
  if(!/^20\d{2}$/.test(year)){
    try{ year=String(getToday().getFullYear()); }
    catch(e){ year=String(new Date().getFullYear()); }
  }
  const month=parseInt(match[2],10);
  if(!month||month<1||month>12) return '';
  return year+'-'+String(month).padStart(2,'0');
}
function _scheduleAuditMonthKey(){
  let month='';
  try{
    const tab=typeof _tabById==='function'?_tabById(_activeTab):null;
    if(tab?.type==='bangteuk'&&tab.seasonStart) month=String(tab.seasonStart).slice(0,7);
    else if(tab){
      const stored=typeof _tabPeriodMonth==='function'?_tabPeriodMonth(tab):tab.periodMonth;
      let liveMonth='';
      try{
        const main=typeof _mainTabSetting==='function'?_mainTabSetting():{};
        const isMainRegular=(!tab.type||tab.type==='regular')&&(main.tabId===tab.id||(!main.tabId&&tab.id==='regular'));
        if(isMainRegular&&typeof _defaultPeriodMonth==='function') liveMonth=_defaultPeriodMonth();
      }catch(e){}
      // 사용자가 보고 있는 탭 이름과 숨은 periodMonth가 다르면 탭 이름을 따른다.
      // 과거 이월/스냅샷에서 periodMonth가 복제된 경우에도 월별 기록이 섞이지 않는다.
      month=_scheduleAuditMonthFromTabName(tab,liveMonth||stored)||liveMonth||stored;
    }
  }catch(e){}
  try{ if(!month&&typeof _defaultPeriodMonth==='function') month=_defaultPeriodMonth(); }catch(e){}
  try{ if(!month) month=toDateStr(getToday()).slice(0,7); }catch(e){}
  return month||'';
}
function _scheduleAuditDays(){
  const order=['월','화','수','목','금','토','일'];
  const set=new Set();
  let raw=[];
  try{ raw=typeof getDays==='function'?getDays():[]; }catch(e){}
  (raw||[]).forEach(day=>{
    const text=String(day||'');
    order.forEach(d=>{ if(text.includes(d)) set.add(d); });
  });
  if(!set.size) ['월','화','수','목','금','토'].forEach(d=>set.add(d));
  return order.filter(d=>set.has(d));
}
function _scheduleAuditText(item){
  return [item?.label,item?.target,item?.detail,item?.tabName,item?.user].map(v=>String(v||'')).join(' ');
}
function _scheduleAuditExpandDay(token,visibleDays){
  const order=['월','화','수','목','금','토','일'];
  const allowed=new Set(visibleDays||order);
  const days=order.filter(d=>String(token||'').includes(d)&&allowed.has(d));
  return days.length?days:[String(token||'기타')];
}
function _scheduleAuditDayTokens(item,visibleDays){
  const text=_scheduleAuditText(item);
  const slot=text.match(/\d{1,2}시\s*(월수금|화목|[월화수목금토일])\s*\d+레인/);
  if(slot) return _scheduleAuditExpandDay(slot[1],visibleDays);
  const slashSlot=text.match(/\d{1,2}시\/(월수금|화목|[월화수목금토일])\/\d+\/\d+/);
  if(slashSlot) return _scheduleAuditExpandDay(slashSlot[1],visibleDays);
  const day=text.match(/(?:^|[\s·/])([월화수목금토일])(?:요일)?(?:$|[\s·/])/);
  if(day&&visibleDays.includes(day[1])) return [day[1]];
  return ['기타'];
}
function _scheduleAuditDateInfo(item,monthKey){
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(item?.effectiveDate||''))){
    const key=String(item.effectiveDate);
    return {key,label:parseInt(key.slice(5,7),10)+'/'+parseInt(key.slice(8,10),10)};
  }
  const text=_scheduleAuditText(item);
  const full=text.match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
  if(full){
    const key=full[1]+'-'+String(full[2]).padStart(2,'0')+'-'+String(full[3]).padStart(2,'0');
    return {key,label:parseInt(full[2],10)+'/'+parseInt(full[3],10)};
  }
  const md=text.match(/(?:^|[^\d])(\d{1,2})\/(\d{1,2})(?=$|[^\d])/);
  if(md){
    const year=String(monthKey||'').slice(0,4)||String(getToday().getFullYear());
    const key=year+'-'+String(md[1]).padStart(2,'0')+'-'+String(md[2]).padStart(2,'0');
    return {key,label:parseInt(md[1],10)+'/'+parseInt(md[2],10)};
  }
  const key=_recordLocalDateKey(item?.at);
  return {key,label:key?`${parseInt(key.slice(5,7),10)}/${parseInt(key.slice(8,10),10)}`:'-'};
}
function _scheduleAuditRecordedDateInfo(item){
  const key=_recordLocalDateKey(item?.at||item?.createdAt||item?.updatedAt);
  return {key,label:key?`${parseInt(key.slice(5,7),10)}/${parseInt(key.slice(8,10),10)}`:'-'};
}
function _scheduleAuditTime(item){
  const text=_scheduleAuditText(item);
  const m=text.match(/(\d{1,2})시/);
  return m?m[1]+'시':'-';
}
function _scheduleAuditSlotFromText(text){
  const src=String(text||'');
  const slash=src.match(/(\d{1,2}시)\/(월수금|화목|[월화수목금토일])\/(\d+)\/(\d+)/);
  if(slash) return {time:slash[1], dayToken:slash[2], lane:slash[3], row:slash[4]||'', text:slash[0]};
  const m=src.match(/(\d{1,2}시)\s*(월수금|화목|[월화수목금토일])\s*(\d+)레인(?:\s*(\d+)번)?/);
  if(!m) return null;
  return {time:m[1], dayToken:m[2], lane:m[3], row:m[4]||'', text:m[0]};
}
function _scheduleAuditNameFromSegment(segment,item){
  const hasSlot=/\d{1,2}시\s*(?:월수금|화목|[월화수목금토일])\s*\d+레인/.test(String(segment||''));
  const base=hasSlot ? String(segment||'') : String(item?.target||item?.label||'');
  const src=base.split(':').slice(1).join(':')||base;
  const beforeSlot=src.split(/\d{1,2}시\s*(?:월수금|화목|[월화수목금토일])\s*\d+레인/)[0]
    .replace(/[·\s]+$/,'')
    .trim();
  if(!beforeSlot||/^(추가|삭제|수정|\d{4})/.test(beforeSlot)) return _scheduleAuditTarget(item);
  return beforeSlot.replace(/\s*\(.+?\)\s*$/,'')||'-';
}
function _scheduleAuditDisappearanceReason(item,rowText,fromSlot,toSlot){
  const text=[rowText,_scheduleAuditText(item)].join(' ');
  if(/퇴원/.test(text)) return '퇴원';
  if(toSlot){
    const fromDays=_scheduleAuditExpandDay(fromSlot?.dayToken||'', ['월','화','수','목','금','토','일']).join('');
    const toDays=_scheduleAuditExpandDay(toSlot.dayToken||'', ['월','화','수','목','금','토','일']).join('');
    if(fromDays!==toDays) return '일정변경';
    if(fromSlot?.time!==toSlot.time) return '시간변경';
    if(fromSlot?.lane!==toSlot.lane||fromSlot?.row!==toSlot.row) return '반변경';
  }
  if(/삭제/.test(text)) return '삭제';
  return '횟수줄임';
}
function _scheduleAuditTarget(item){
  const target=String(item?.target||'').trim();
  if(target){
    const clean=target.split(/\d{1,2}시\s*(?:월수금|화목|[월화수목금토일])\s*\d+레인/)[0]
      .replace(/[·\s]+$/,'')
      .trim();
    return (clean||target).replace(/\s*\(.+?\)\s*$/,'');
  }
  const m=String(item?.detail||'').match(/:\s*([^·/]+)/);
  return (m?m[1]:'-').trim();
}
function _scheduleAuditTeacherFromSlot(slot,day,item){
  if(slot&&typeof getInst==='function'){
    const token=slot.dayToken||day;
    const lookupDay=token.includes(day)?token:day;
    const inst=getInst(slot.time,lookupDay,slot.lane)||getInst(slot.time,day,slot.lane);
    const name=typeof inst==='string'?inst:inst?.n;
    if(String(name||'').trim()) return String(name).trim();
  }
  const user=String(item?.user||'').trim();
  if(!user) return '-';
  return user.includes('@')?user.split('@')[0]:user;
}
function _scheduleAuditInstFromSlot(slot,day){
  if(!slot||typeof getInst!=='function') return null;
  const token=slot.dayToken||day;
  const lookupDay=String(token||'').includes(day)?token:day;
  return getInst(slot.time,lookupDay,slot.lane)||getInst(slot.time,day,slot.lane)||null;
}
function _scheduleAuditIsBangteukSlot(slot,day){
  const inst=_scheduleAuditInstFromSlot(slot,day);
  const row=slot?.row||'';
  try{
    if(window.SCScheduleTime&&typeof SCScheduleTime.isBangteukSlot==='function'&&SCScheduleTime.isBangteukSlot(inst,row,{bangteukTable:false})) return true;
  }catch(e){}
  try{
    if(typeof isBangteukInst==='function'&&isBangteukInst(inst)){
      const n=parseInt(row,10);
      if(!row||(Number.isFinite(n)&&n>=1&&n<=6)) return true;
    }
  }catch(e){}
  try{
    if(typeof btPreviewLaneActive==='function'&&btPreviewLaneActive(slot.time,day,slot.lane)) return true;
  }catch(e){}
  return false;
}
function _scheduleAuditIsSameTeacherClassMove(fromSlot,toSlot,day,item){
  if(!fromSlot||!toSlot) return false;
  const allDays=['월','화','수','목','금','토','일'];
  const fromDays=_scheduleAuditExpandDay(fromSlot.dayToken||day,allDays).join('');
  const toDays=_scheduleAuditExpandDay(toSlot.dayToken||day,allDays).join('');
  if(fromDays!==toDays) return false;
  if(String(fromSlot.time||'')!==String(toSlot.time||'')) return false;
  if(String(fromSlot.lane||'')!==String(toSlot.lane||'')) return false;
  const fromTeacher=_scheduleAuditTeacherFromSlot(fromSlot,day,item);
  const toTeacher=_scheduleAuditTeacherFromSlot(toSlot,day,item);
  return !!(fromTeacher&&toTeacher&&fromTeacher!=='-'&&fromTeacher===toTeacher);
}
function _scheduleAuditSlotFromKey(slotKey){
  const p=String(slotKey||'').split('/');
  if(p.length<4) return null;
  return {time:p[0], dayToken:p[1], lane:p[2], row:p[3]||'', text:`${p[0]} ${p[1]} ${p[2]}레인 ${p[3]||''}번`};
}
function _scheduleAuditStudentFromSlot(slot,slotKey,fallback){
  if(fallback&&(fallback.n||fallback.name)) return fallback;
  if(slotKey&&_stuIdx&&_stuIdx[slotKey]) return _stuIdx[slotKey];
  if(!slot) return fallback||null;
  const time=String(slot.time||'');
  const lane=String(slot.lane||'');
  const row=String(slot.row||'');
  const dayCandidates=[];
  const pushDay=d=>{ d=String(d||''); if(d&&!dayCandidates.includes(d)) dayCandidates.push(d); };
  pushDay(slot.dayToken);
  try{ _lookupDayKeys(slot.dayToken).forEach(pushDay); }catch(e){}
  try{ _scheduleAuditExpandDay(slot.dayToken,['월','화','수','목','금','토','일']).forEach(pushDay); }catch(e){}
  for(const day of dayCandidates){
    const found=typeof getStu==='function'?getStu(time,day,lane,row):null;
    if(found) return found;
    const directKey=[time,day,lane,row].join('/');
    if(_stuIdx&&_stuIdx[directKey]) return _stuIdx[directKey];
  }
  const list=Array.isArray(STUDENTS)?STUDENTS:[];
  return list.find(s=>{
    if(String(s?.t||'')!==time||String(s?.l||'')!==lane||String(s?.r||'')!==row) return false;
    const stuDay=String(s?.d||'');
    if(!stuDay) return false;
    return dayCandidates.some(day=>stuDay===day||stuDay.includes(day)||day.includes(stuDay));
  })||fallback||null;
}
function _scheduleAuditEntryNameFromSlot(entry,slot,slotKey,fallback){
  return _scheduleAuditEntryName(entry,_scheduleAuditStudentFromSlot(slot,slotKey,fallback));
}
function _scheduleAuditDateLabel(ds){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(ds||''))) return {key:'',label:'-'};
  return {key:ds,label:parseInt(ds.slice(5,7),10)+'/'+parseInt(ds.slice(8,10),10)};
}
function _scheduleAuditEntryDate(entry){
  return typeof entry==='string'?entry:String(entry?.ds||'');
}
function _scheduleAuditEntryName(entry,fallback){
  try{
    if(typeof _summaryRecordPerson==='function'){
      const p=_summaryRecordPerson(entry,fallback);
      if(String(p?.n||'').trim()) return String(p.n).trim();
    }
  }catch(e){}
  const source=entry&&typeof entry==='object'?entry:{};
  return String(source.n||source.name||fallback?.n||fallback?.name||'').trim();
}
function _scheduleAuditIsActualRetire(entry,slotKey,fallback){
  try{
    if(typeof _retireReservationIsActual==='function') return _retireReservationIsActual(entry,slotKey,fallback);
  }catch(e){}
  if(entry?.retireType==='retire') return true;
  if(entry?.retireType==='exclude'||entry?.moveType) return false;
  return false;
}
function _scheduleAuditVisibleReason(entry,slotKey,fromSlot,toSlot,fallback){
  if(_scheduleAuditIsActualRetire(entry,slotKey,fallback)) return '퇴원';
  if(entry?.retireType==='retire') return '퇴원';
  if(toSlot){
    const allDays=['월','화','수','목','금','토','일'];
    const fromDays=_scheduleAuditExpandDay(fromSlot?.dayToken||'',allDays).join('');
    const toDays=_scheduleAuditExpandDay(toSlot.dayToken||'',allDays).join('');
    if(fromDays!==toDays) return '일정변경';
    if(fromSlot?.time!==toSlot.time) return '시간변경';
    if(fromSlot?.lane!==toSlot.lane||fromSlot?.row!==toSlot.row) return '반변경';
  }
  if(entry?.excludeReason==='reduce') return '횟수줄임';
  if(entry?.excludeReason==='move'||entry?.moveType) return '반변경';
  if(entry?.retireType==='exclude') return '횟수줄임';
  return '퇴원';
}
function _scheduleAuditDisplayTime(slot,day){
  try{
    if(window.SCScheduleTime&&typeof SCScheduleTime.displayTimeForDay==='function'){
      return SCScheduleTime.displayTimeForDay(day,slot?.time)||slot?.time||'-';
    }
  }catch(e){}
  return slot?.time||'-';
}
function _scheduleAuditRowsFromVisibleReservations(monthKey,visibleDays){
  const rows=[];
  const scope=_scheduleAuditActiveScope();
  Object.entries(RETIRE_MAP||{}).forEach(([slotKey,entry])=>{
    const ds=_scheduleAuditEntryDate(entry);
    if(!ds) return;
    // 하단 기록의 월 구분은 수업 운영기간이 아니라 날짜의 달력 월을 따른다.
    if(monthKey&&_deskNoteMonthFromDateKey(ds)!==String(monthKey)) return;
    const fromSlot=_scheduleAuditSlotFromKey(slotKey);
    if(!fromSlot) return;
    const fallback=_scheduleAuditStudentFromSlot(fromSlot,slotKey);
    const pairKey=entry&&typeof entry==='object'?entry.pairKey:'';
    const pairEntry=pairKey?(ENROLL_MAP||{})[pairKey]:null;
    const toSlot=pairEntry?_scheduleAuditSlotFromKey(pairKey):null;
    const date=_scheduleAuditDateLabel(ds);
    const days=_scheduleAuditExpandDay(fromSlot.dayToken,visibleDays).filter(day=>visibleDays.includes(day));
    days.forEach(day=>{
      if(_scheduleAuditIsBangteukSlot(fromSlot,day)||_scheduleAuditIsBangteukSlot(toSlot,day)) return;
      if(_scheduleAuditIsSameTeacherClassMove(fromSlot,toSlot,day,{user:''})) return;
      const target=_scheduleAuditEntryNameFromSlot(entry,fromSlot,slotKey,fallback);
      if(!target) return;
      const reason=_scheduleAuditVisibleReason(entry,slotKey,fromSlot,toSlot,fallback);
      rows.push({
        day,
        teacher:_scheduleAuditTeacherFromSlot(fromSlot,day,{user:''}),
        target,
        reason,
        date:date.label,
        dateKey:date.key,
        time:_scheduleAuditDisplayTime(fromSlot,day),
        detail:`현재 시간표 표시: ${target} ${date.label} ${reason}`,
        at:date.key?date.key+'T00:00:00':'',
        source:'visible-reservation',
        tabId:scope.tabId,
        tabName:scope.tabName,
        tabType:scope.tabType,
      });
    });
  });
  return rows;
}
function _scheduleAuditRowKey(row){
  return [row.day,row.teacher,row.target,row.reason,row.date,row.time].map(v=>String(v||'').trim()).join('|');
}
function _scheduleAuditNormalizeMonthKey(value){
  const raw=String(value||'').trim();
  if(!raw) return '';
  try{
    if(typeof _normalizeMonthKey==='function') return _normalizeMonthKey(raw)||raw;
  }catch(e){}
  const m=raw.match(/^(20\d{2})[-./년\s]*(\d{1,2})/);
  if(m) return m[1]+'-'+String(m[2]).padStart(2,'0');
  return raw;
}
function _scheduleAuditActiveScope(){
  const tab=(typeof _tabById==='function')?_tabById(_activeTab):null;
  const type=tab?.type||'regular';
  if(type==='snapshot'){
    let info=null;
    try{ info=typeof getSnapshotSourceInfo==='function'?getSnapshotSourceInfo(tab.id):null; }catch(e){}
    const sourceType=info?.sourceTabType||tab?.sourceTabType||'regular';
    const sourceId=info?.sourceTabId||tab?.sourceTabId||tab?.id||_activeTab||'regular';
    return {
      tabId:String(sourceId),
      tabName:String(info?.sourceTabName||tab?.sourceTabName||tab?.name||''),
      tabType:sourceType==='bangteuk'?'bangteuk':'regular',
      snapshotId:String(info?.snapshotId||tab?.id||''),
      periodMonth:_scheduleAuditNormalizeMonthKey(info?.periodMonth||tab?.periodMonth||''),
    };
  }
  return {
    tabId:String(tab?.id||_activeTab||'regular'),
    tabName:String(tab?.name||''),
    tabType:type==='bangteuk'?'bangteuk':'regular',
    snapshotId:'',
    periodMonth:_scheduleAuditNormalizeMonthKey(tab?.periodMonth||''),
  };
}
function _scheduleAuditScopeFromItem(item){
  const active=_scheduleAuditActiveScope();
  const tabId=String(item?.tabId||'');
  const tab=tabId&&typeof _tabById==='function'?_tabById(tabId):null;
  const tabType=String(item?.tabType||tab?.type||'');
  return {
    tabId,
    tabName:String(item?.tabName||tab?.name||''),
    tabType:tabType==='bangteuk'?'bangteuk':(tabType?'regular':''),
    legacy:!tabId&&!tabType,
    active,
  };
}
function _scheduleAuditMatchesActiveScope(item){
  return true;
}
function _scheduleAuditRowDateOrder(row){
  // 표에 보이는 수정날짜와 정렬 기준을 반드시 같게 유지한다.
  const key=_deskNoteRecordDateKey(row,_scheduleAuditMonthKey());
  if(key) return key;
  return _recordLocalDateKey(row?.createdAt||row?.at||row?.updatedAt)||'9999-12-31';
}
function _scheduleAuditRowCreatedOrder(row){
  return String(row?.createdAt||row?.at||row?.updatedAt||row?.id||'');
}
function _scheduleAuditSortRows(rows){
  return (rows||[]).sort((a,b)=>{
    const ak=_scheduleAuditRowDateOrder(a);
    const bk=_scheduleAuditRowDateOrder(b);
    if(ak!==bk) return ak.localeCompare(bk);
    const ao=_scheduleAuditRowCreatedOrder(a);
    const bo=_scheduleAuditRowCreatedOrder(b);
    if(ao!==bo) return ao.localeCompare(bo);
    const at=a.time||'', bt=b.time||'';
    if(at!==bt) return at.localeCompare(bt,'ko',{numeric:true});
    return String(a.id||'').localeCompare(String(b.id||''));
  });
}
function _scheduleAuditAttr(s){
  return esc(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function _scheduleAuditShortDateFromKey(key){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(key||''))) return '';
  return parseInt(key.slice(5,7),10)+'/'+parseInt(key.slice(8,10),10);
}
function _scheduleAuditDateInputValue(note){
  if(String(note?.date||'').trim()&&String(note.date).trim()!=='-') return String(note.date).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(note?.dateKey||''))) return _scheduleAuditShortDateFromKey(note.dateKey);
  const label=String(note?.date||'').trim();
  const md=label.match(/^(\d{1,2})\/(\d{1,2})$/);
  if(md){
    return parseInt(md[1],10)+'/'+parseInt(md[2],10);
  }
  return '';
}
function _deskNoteMonthFromDateKey(key){
  const raw=String(key||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0,7);
  return '';
}
function _deskNoteMonthFromDateText(text,monthKey){
  const raw=String(text||'').trim();
  if(!raw||raw==='-') return '';
  let m=raw.match(/^(20\d{2})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})(?:일)?$/);
  if(m) return m[1]+'-'+String(m[2]).padStart(2,'0');
  m=raw.match(/^(\d{1,2})\s*(?:\/|\.|월)\s*(\d{1,2})(?:일)?$/);
  if(m){
    const year=String(monthKey||'').slice(0,4)||String(getToday().getFullYear());
    return year+'-'+String(m[1]).padStart(2,'0');
  }
  return '';
}
function _scheduleAuditParseDateText(text,monthKey){
  const raw=String(text||'').trim();
  if(!raw) return {key:'',label:'-'};
  let m=raw.match(/^(20\d{2})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})(?:일)?$/);
  if(m){
    const key=m[1]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0');
    return {key,label:_scheduleAuditShortDateFromKey(key)};
  }
  m=raw.match(/^(\d{1,2})\s*(?:\/|\.|월)\s*(\d{1,2})(?:일)?$/);
  if(m){
    const year=String(monthKey||'').slice(0,4)||String(getToday().getFullYear());
    const key=year+'-'+String(m[1]).padStart(2,'0')+'-'+String(m[2]).padStart(2,'0');
    return {key,label:parseInt(m[1],10)+'/'+parseInt(m[2],10)};
  }
  return {key:'',label:raw};
}
function _deskNoteDisplayDateText(note){
  if(!note||typeof note!=='object') return '';
  if(Object.prototype.hasOwnProperty.call(note,'date')){
    const current=String(note.date||'').trim();
    return current&&current!=='-'?current:'';
  }
  const original=String(note.original?.date||'').trim();
  return original&&original!=='-'?original:'';
}
function _deskNoteRecordDateKey(note,targetMonth){
  // 수정날짜 칸의 값이 월 필터의 단일 기준이다. dateKey는 표시값이 없는
  // 오래된 기록만 호환하기 위한 보조값으로 사용한다.
  const visibleDate=_deskNoteDisplayDateText(note);
  if(visibleDate){
    const parsed=_scheduleAuditParseDateText(visibleDate,targetMonth);
    if(/^\d{4}-\d{2}-\d{2}$/.test(String(parsed.key||''))) return parsed.key;
    return '';
  }
  const direct=String(note?.dateKey||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  return '';
}
function _deskNoteRecordPeriodMonth(note,targetMonth){
  const key=_deskNoteRecordDateKey(note,targetMonth);
  return key?_deskNoteMonthFromDateKey(key):'';
}
function _deskNoteCanSave(silent){
  if(window.SCAuth && typeof SCAuth.canWriteKey==='function' && !SCAuth.canWriteKey(STORAGE_KEYS.DESK_NOTES)){
    if(!silent && typeof toast==='function') toast('기록 수정 권한이 없습니다','err');
    return false;
  }
  if(typeof canPersistScheduleData==='function' && !canPersistScheduleData(STORAGE_KEYS.DESK_NOTES,'기록 저장')) return false;
  if(typeof isSnapshotTab==='function' && isSnapshotTab()){
    if(!silent && typeof toast==='function') toast('스냅샷에서는 기록을 수정할 수 없습니다','err');
    return false;
  }
  if(typeof _fakeDate !== 'undefined' && _fakeDate){
    if(!silent && typeof toast==='function') toast('타임머신 모드에서는 기록을 수정할 수 없습니다','err');
    return false;
  }
  return true;
}
function _deskNoteId(){
  return 'desk_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
}
function _deskNoteRecordedDate(row){
  let key='';
  if(row?.source==='visible-reservation'){
    try{ key=toDateStr(getToday()); }
    catch(e){ key=_recordLocalDateKey(new Date().toISOString()); }
  } else {
    key=_recordLocalDateKey(row?.at);
  }
  if(!key) key=row?.dateKey||'';
  return {key,label:_scheduleAuditShortDateFromKey(key)||row?.date||'-'};
}
function _deskNoteFromScheduleRow(row){
  const written=_deskNoteRecordedDate(row);
  const now=new Date().toISOString();
  const sourceKey=_deskNoteSourceKeyForRow(row);
  const scope=_scheduleAuditScopeFromItem(row);
  const tabId=scope.tabId||row.tabId||'global';
  const tabName=scope.tabName||row.tabName||'전체 기록';
  const tabType=scope.tabType||row.tabType||'regular';
  const recordMonthKey=/^\d{4}-\d{2}-\d{2}$/.test(String(written.key||'')) ? _deskNoteMonthFromDateKey(written.key) : '';
  return {
    id:_deskNoteId(),
    sourceKey,
    original:{
      teacher:row.teacher||'-',
      student:row.target||'-',
      change:row.reason||'-',
      date:row.date||'-',
      dateKey:row.dateKey||'',
      time:row.time||'-',
      day:row.day||'기타',
      detail:row.detail||'',
      at:row.at||'',
      source:row.source||'audit',
      tabId,
      tabName,
      tabType,
    },
    tabId,
    tabName,
    tabType,
    monthKey:row.monthKey||_scheduleAuditMonthKey(),
    day:row.day||'기타',
    effectiveDateKey:row.dateKey||'',
    teacher:row.teacher||'-',
    student:row.target||'-',
    change:row.reason||'-',
    date:written.label,
    dateKey:written.key,
    recordMonthKey,
    time:row.time||'-',
    detail:row.detail||'',
    at:row.source==='visible-reservation'?now:(row.at||now),
    source:row.source||'audit',
    deleted:false,
    createdAt:now,
    updatedAt:now,
  };
}
function ensureDeskNoteForRetireReservation(slotKey,entry,fallback){
  if(!slotKey||!entry) return Promise.resolve(false);
  const ds=_scheduleAuditEntryDate(entry);
  const fromSlot=_scheduleAuditSlotFromKey(slotKey);
  if(!ds||!fromSlot) return Promise.resolve(false);
  fallback=_scheduleAuditStudentFromSlot(fromSlot,slotKey,fallback);
  const scope=_scheduleAuditActiveScope();
  const monthKey=_scheduleAuditMonthKey();
  const visibleDays=_scheduleAuditDays();
  const days=_scheduleAuditExpandDay(fromSlot.dayToken,visibleDays).filter(day=>visibleDays.includes(day));
  if(!days.length) return Promise.resolve(false);
  const pairKey=entry&&typeof entry==='object'?entry.pairKey:'';
  const pairEntry=pairKey?(ENROLL_MAP||{})[pairKey]:null;
  const toSlot=pairEntry?_scheduleAuditSlotFromKey(pairKey):null;
  const date=_scheduleAuditDateLabel(ds);
  const target=_scheduleAuditEntryNameFromSlot(entry,fromSlot,slotKey,fallback);
  if(!target) return Promise.resolve(false);
  const additions=[];
  days.forEach(day=>{
    if(_scheduleAuditIsBangteukSlot(fromSlot,day)||_scheduleAuditIsBangteukSlot(toSlot,day)) return;
    if(_scheduleAuditIsSameTeacherClassMove(fromSlot,toSlot,day,{user:''})) return;
    const reason=_scheduleAuditVisibleReason(entry,slotKey,fromSlot,toSlot,fallback);
    additions.push(_deskNoteFromScheduleRow({
      day,
      teacher:_scheduleAuditTeacherFromSlot(fromSlot,day,{user:''}),
      target,
      reason,
      date:date.label,
      dateKey:date.key,
      time:_scheduleAuditDisplayTime(fromSlot,day),
      detail:`현재 시간표 표시: ${target} ${date.label} ${reason}`,
      at:date.key?date.key+'T00:00:00':'',
      source:'visible-reservation',
      monthKey,
      tabId:scope.tabId,
      tabName:scope.tabName,
      tabType:scope.tabType,
    }));
  });
  if(!additions.length) return Promise.resolve(false);
  return _updateDeskNotesTx(list=>{
    let next=_normalizeDeskNotesList(list).slice();
    additions.forEach(note=>{ next=_mergeDeskNote(next,note); });
    return next;
  },{type:'edit',label:'하단 기록 자동 추가'},true).then(()=>{
    additions.forEach(note=>{ DESK_NOTES=_mergeDeskNote(DESK_NOTES,note); });
    return true;
  });
}
function ensureDeskNoteForStudentMove(srcKey,dstKey,stu,moveType){
  const fromSlot=_scheduleAuditSlotFromKey(srcKey);
  const toSlot=_scheduleAuditSlotFromKey(dstKey);
  const sourceStu=_scheduleAuditStudentFromSlot(fromSlot,srcKey,stu);
  const target=String(sourceStu?.n||sourceStu?.name||stu?.n||stu?.name||'').trim();
  if(!fromSlot||!toSlot||!target) return Promise.resolve(false);
  const scope=_scheduleAuditActiveScope();
  const visibleDays=_scheduleAuditDays();
  const todayKey=toDateStr(getToday());
  const date=_scheduleAuditDateLabel(todayKey);
  const additions=[];
  _scheduleAuditExpandDay(fromSlot.dayToken,visibleDays).filter(day=>visibleDays.includes(day)).forEach(day=>{
    if(_scheduleAuditIsBangteukSlot(fromSlot,day)||_scheduleAuditIsBangteukSlot(toSlot,day)) return;
    const reason=_scheduleAuditVisibleReason({excludeReason:'move', moveType:moveType||'move'},srcKey,fromSlot,toSlot,sourceStu||stu);
    additions.push(_deskNoteFromScheduleRow({
      day,
      teacher:_scheduleAuditTeacherFromSlot(fromSlot,day,{user:''}),
      target,
      reason,
      date:date.label,
      dateKey:date.key,
      time:_scheduleAuditDisplayTime(fromSlot,day),
      detail:`즉시 이동: ${target} ${srcKey} → ${dstKey}`,
      at:new Date().toISOString(),
      source:'direct-move',
      monthKey:_scheduleAuditMonthKey(),
      tabId:scope.tabId,
      tabName:scope.tabName,
      tabType:scope.tabType,
    }));
  });
  if(!additions.length) return Promise.resolve(false);
  return _updateDeskNotesTx(list=>{
    let next=_normalizeDeskNotesList(list).slice();
    additions.forEach(note=>{ next=_mergeDeskNote(next,note); });
    return next;
  },{type:'edit',label:'하단 이동 기록 자동 추가'},true).then(()=>{
    additions.forEach(note=>{ DESK_NOTES=_mergeDeskNote(DESK_NOTES,note); });
    return true;
  });
}
function _normalizeDeskNoteForDisplay(note){
  if(!note||typeof note!=='object') return null;
  const original=note.original||{};
  const next={...note};
  next.teacher=String(next.teacher||original.teacher||'-').trim()||'-';
  next.student=String(next.student||next.target||original.student||'-').trim()||'-';
  next.change=String(next.change||next.reason||original.change||'메모').trim()||'메모';
  const ownDate=Object.prototype.hasOwnProperty.call(next,'date');
  const dateText=ownDate?String(next.date||'').trim():String(original.date||'').trim();
  next.date=dateText||'-';
  next.time=String(next.time||original.time||'-').trim()||'-';
  next.day=String(next.day||original.day||'기타').trim()||'기타';
  return next;
}
function _normalizeDeskNotesList(list){
  return Array.isArray(list)?list.map(_normalizeDeskNoteForDisplay).filter(Boolean):[];
}
function _deskNoteFindIndex(list,note){
  const id=String(note?.id||'');
  if(id){
    const idx=list.findIndex(n=>String(n?.id||'')===id);
    if(idx>=0) return idx;
  }
  const sourceKey=String(note?.sourceKey||'');
  if(sourceKey){
    return list.findIndex(n=>String(n?.sourceKey||'')===sourceKey);
  }
  return -1;
}
function _mergeDeskNote(list,note){
  const next=_normalizeDeskNotesList(list).slice();
  const idx=_deskNoteFindIndex(next,note);
  if(idx>=0){
    if(next[idx]?.deleted && note?.sourceKey && !note?.manual && !note?.deleted) return next;
    next[idx]={...next[idx],...note};
  }
  else next.push(note);
  return next;
}
function _updateDeskNotesTx(mutator,meta,silent){
  DESK_NOTES=_normalizeDeskNotesList(DESK_NOTES);
  if(!_deskNoteCanSave(!!silent)) return Promise.reject(new Error('기록 저장 권한이 없습니다'));
  const applyLocal=()=>{
    let abortReason='';
    const next=mutator(DESK_NOTES.slice(),reason=>{abortReason=reason||'';});
    if(next===undefined) return Promise.reject(new Error(abortReason||'기록 저장이 취소되었습니다'));
    DESK_NOTES=_normalizeDeskNotesList(next);
    if(dbSet(STORAGE_KEYS.DESK_NOTES, JSON.stringify(DESK_NOTES))===false){
      return Promise.reject(new Error('기록 저장 실패'));
    }
    return Promise.resolve(DESK_NOTES);
  };
  if(typeof updateScheduleTx!=='function') return applyLocal();
  return updateScheduleTx([STORAGE_KEYS.DESK_NOTES],ctx=>{
    const list=_normalizeDeskNotesList(ctx.get(STORAGE_KEYS.DESK_NOTES,[]));
    const next=mutator(list,reason=>ctx.abort(reason||'기록 저장이 취소되었습니다'));
    if(next===undefined) return;
    ctx.set(STORAGE_KEYS.DESK_NOTES,_normalizeDeskNotesList(next));
    return true;
  },meta||{type:'edit',label:'기록 편집'}).then(()=>DESK_NOTES);
}
function _saveDeskNotes(silent){
  DESK_NOTES=_normalizeDeskNotesList(DESK_NOTES);
  if(!_deskNoteCanSave(!!silent)) return false;
  return dbSet(STORAGE_KEYS.DESK_NOTES, JSON.stringify(DESK_NOTES))!==false;
}
function _upsertDeskNoteTx(note,expectedUpdatedAt,meta){
  const clean={...note};
  return _updateDeskNotesTx((list,abort)=>{
    const next=_normalizeDeskNotesList(list).slice();
    const idx=_deskNoteFindIndex(next,clean);
    if(expectedUpdatedAt&&idx>=0&&String(next[idx]?.updatedAt||'')!==String(expectedUpdatedAt)){
      abort('다른 사용자가 먼저 수정했습니다. 기록을 다시 열어 확인해주세요.');
      return;
    }
    if(idx>=0) next[idx]={...next[idx],...clean};
    else next.push(clean);
    return next;
  },meta||{type:'edit',label:'기록 편집'});
}
let _deskNotesAutoMergeInFlight=false;
let _deskNotesAutoMergeQueue=[];
function _queueDeskNotesAutoMerge(additions){
  if(!additions||!additions.length) return;
  if(!_deskNoteCanSave(true)) return;
  _deskNotesAutoMergeQueue=_deskNotesAutoMergeQueue.concat(additions.map(note=>({...note})));
  if(_deskNotesAutoMergeInFlight) return;
  _deskNotesAutoMergeInFlight=true;
  const flush=()=>{
    const batch=_deskNotesAutoMergeQueue.slice(0);
    if(!batch.length){
      _deskNotesAutoMergeInFlight=false;
      return;
    }
    _updateDeskNotesTx(list=>{
      let next=_normalizeDeskNotesList(list).slice();
      batch.forEach(note=>{ next=_mergeDeskNote(next,note); });
      return next;
    },{type:'edit',label:'하단 기록 자동 동기화'},true).then(()=>{
      _deskNotesAutoMergeQueue.splice(0,batch.length);
      flush();
    }).catch(err=>{
      console.warn('하단 기록 자동 동기화 실패:',err);
      _deskNotesAutoMergeInFlight=false;
      setTimeout(()=>{
        if(_deskNotesAutoMergeQueue.length&&!_deskNotesAutoMergeInFlight){
          _deskNotesAutoMergeInFlight=true;
          flush();
        }
      },2000);
    });
  };
  flush();
}
function _syncDeskNotesFromRows(rows){
  DESK_NOTES=_normalizeDeskNotesList(DESK_NOTES);
  const sourceKeys=new Set(DESK_NOTES.map(note=>String(note?.sourceKey||'')).filter(Boolean));
  const additions=[];
  (rows||[]).forEach(row=>{
    if(row?.bangteuk) return;
    const sourceKey=_deskNoteSourceKeyForRow(row);
    const legacyKey=_scheduleAuditRowKey(row);
    if(!sourceKey||sourceKeys.has(sourceKey)||sourceKeys.has(legacyKey)) return;
    sourceKeys.add(sourceKey);
    additions.push(_deskNoteFromScheduleRow(row));
  });
  if(!additions.length) return DESK_NOTES;
  const canSave=_deskNoteCanSave(true);
  if(canSave){
    additions.forEach(note=>{ DESK_NOTES=_mergeDeskNote(DESK_NOTES,note); });
    _queueDeskNotesAutoMerge(additions);
    return DESK_NOTES;
  }
  return DESK_NOTES.concat(additions);
}
function _deskNoteSourceKeyForRow(row){
  if(!row) return '';
  const scope=_scheduleAuditScopeFromItem(row);
  const tabId=scope.tabId||row.tabId||'global';
  const monthKey=_deskNoteMonthFromDateKey(row.dateKey)||_deskNoteMonthFromDateKey(_recordLocalDateKey(row.at))||row.recordMonthKey||row.monthKey||'all';
  const rowKey=_scheduleAuditRowKey(row);
  return [tabId,monthKey,rowKey].map(v=>String(v||'').trim()).join('|');
}
function _deskNoteVisible(note,monthKey,visibleDays){
  if(!note||note.deleted) return false;
  if(String(note.change||'').trim()==='휴원') return false;
  if(/휴원/.test(String(note.detail||'')+' '+String(note.original?.detail||''))) return false;
  const targetMonth=String(monthKey||'');
  if(!targetMonth) return true;
  const recordMonth=_deskNoteRecordPeriodMonth(note,targetMonth);
  return recordMonth===targetMonth;
}
function _findDeskNote(id){
  DESK_NOTES=Array.isArray(DESK_NOTES)?DESK_NOTES:[];
  return DESK_NOTES.find(note=>String(note.id)===String(id));
}
let _deskNoteOutsideCloseBound=false;
function _deskNoteModal(){
  let modal=document.getElementById('desk-note-modal');
  if(modal) return modal;
  modal=document.createElement('div');
  modal.id='desk-note-modal';
  modal.className='desk-note-popover';
  modal.style.display='none';
  modal.onclick=function(e){ e.stopPropagation(); };
  modal.innerHTML=`<div class="desk-note-card" onclick="event.stopPropagation()">
    <div class="desk-note-head">
      <h3 id="desk-note-title">기록 수정</h3>
      <button type="button" class="desk-note-x" onclick="closeDeskNoteModal()">×</button>
    </div>
    <input type="hidden" id="desk-note-id">
    <input type="hidden" id="desk-note-day">
    <input type="hidden" id="desk-note-version">
    <div class="desk-note-grid">
      <label>담당<input type="text" id="desk-note-teacher"></label>
      <label>원생<input type="text" id="desk-note-student"></label>
      <label>변동<input type="text" id="desk-note-change" list="desk-note-change-list" placeholder="삭제, 퇴원, 반변경 등"></label>
      <label>수정날짜<input type="text" id="desk-note-date" placeholder="6/5 또는 2026-06-05"></label>
      <label>시간<input type="text" id="desk-note-time" placeholder="4시 또는 4시 → 5시"></label>
    </div>
    <datalist id="desk-note-change-list">
      <option value="삭제"></option>
      <option value="퇴원"></option>
      <option value="반변경"></option>
      <option value="시간변경"></option>
      <option value="일정변경"></option>
      <option value="횟수줄임"></option>
      <option value="메모"></option>
    </datalist>
    <div class="desk-note-origin" id="desk-note-origin"></div>
    <div class="desk-note-actions">
      <button type="button" class="desk-note-delete" id="desk-note-delete-btn" onclick="deleteDeskNoteModal()">삭제</button>
      <span></span>
      <button type="button" class="desk-note-cancel" onclick="closeDeskNoteModal()">닫기</button>
      <button type="button" class="desk-note-save" onclick="saveDeskNoteModal()">저장</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  if(!_deskNoteOutsideCloseBound){
    _deskNoteOutsideCloseBound=true;
    document.addEventListener('mousedown',function(e){
      const pop=document.getElementById('desk-note-modal');
      if(!pop||pop.style.display==='none') return;
      if(pop.contains(e.target)) return;
      if(e.target?.closest&&e.target.closest('.schedule-audit-editable')) return;
      closeDeskNoteModal();
    });
  }
  return modal;
}
function _positionDeskNotePopover(anchor){
  const modal=document.getElementById('desk-note-modal');
  if(!modal) return;
  const rect=anchor&&anchor.getBoundingClientRect?anchor.getBoundingClientRect():null;
  const vw=document.documentElement.clientWidth||window.innerWidth||1280;
  const vh=document.documentElement.clientHeight||window.innerHeight||720;
  const sw=window.scrollX||window.pageXOffset||0;
  const sh=window.scrollY||window.pageYOffset||0;
  const width=modal.offsetWidth||560;
  const height=modal.offsetHeight||260;
  const centerX=rect ? sw+rect.left+(rect.width/2) : sw+(vw/2);
  let left=Math.round(centerX-(width/2));
  left=Math.max(sw+12,Math.min(left,sw+vw-width-12));
  let top=rect ? Math.round(sh+rect.bottom+10) : Math.round(sh+90);
  modal.classList.remove('above');
  if(rect&&top+height>sh+vh-12){
    top=Math.max(sh+12,Math.round(sh+rect.top-height-10));
    modal.classList.add('above');
  }
  modal.style.left=left+'px';
  modal.style.top=top+'px';
  const arrowLeft=Math.max(18,Math.min(width-18,centerX-left));
  modal.style.setProperty('--desk-note-arrow-left',arrowLeft+'px');
}
function openDeskNoteModal(id,anchor){
  if(window.SCAuth && !SCAuth.requirePermission('manageRecords','기록 수정')) return;
  const note=_findDeskNote(id);
  if(!note) return;
  const modal=_deskNoteModal();
  const popKey='edit|'+String(note.id||id);
  if(modal.style.display!=='none'&&modal.dataset.popKey===popKey){
    closeDeskNoteModal();
    return;
  }
  modal.dataset.popKey=popKey;
  document.getElementById('desk-note-title').textContent='기록 수정';
  document.getElementById('desk-note-id').value=note.id||'';
  document.getElementById('desk-note-day').value=note.day||'기타';
  document.getElementById('desk-note-version').value=note.updatedAt||'';
  document.getElementById('desk-note-teacher').value=note.teacher||'';
  document.getElementById('desk-note-student').value=note.student||'';
  document.getElementById('desk-note-change').value=note.change||'';
  document.getElementById('desk-note-date').value=_scheduleAuditDateInputValue(note);
  document.getElementById('desk-note-time').value=note.time||'';
  document.getElementById('desk-note-delete-btn').style.display='';
  const original=note.original||{};
  document.getElementById('desk-note-origin').textContent=[
    '원본:',
    original.teacher||note.teacher||'-',
    original.student||note.student||'-',
    original.change||'',
    original.date||'',
    original.time||''
  ].filter(Boolean).join(' ');
  modal.style.visibility='hidden';
  modal.style.display='block';
  _positionDeskNotePopover(anchor);
  modal.style.visibility='';
}
function openDeskNoteCreate(day,anchor){
  if(window.SCAuth && !SCAuth.requirePermission('manageRecords','기록 추가')) return;
  const modal=_deskNoteModal();
  const popKey='create|'+String(day||'기타');
  if(modal.style.display!=='none'&&modal.dataset.popKey===popKey){
    closeDeskNoteModal();
    return;
  }
  modal.dataset.popKey=popKey;
  document.getElementById('desk-note-title').textContent='기록 추가';
  document.getElementById('desk-note-id').value='';
  document.getElementById('desk-note-day').value=day||'기타';
  document.getElementById('desk-note-version').value='';
  document.getElementById('desk-note-teacher').value='';
  document.getElementById('desk-note-student').value='';
  document.getElementById('desk-note-change').value='';
  document.getElementById('desk-note-date').value=_scheduleAuditShortDateFromKey(toDateStr(getToday()));
  document.getElementById('desk-note-time').value='';
  document.getElementById('desk-note-delete-btn').style.display='none';
  document.getElementById('desk-note-origin').textContent='데스크가 직접 추가하는 기록입니다. 원본 감사기록에는 남지 않습니다.';
  modal.style.visibility='hidden';
  modal.style.display='block';
  _positionDeskNotePopover(anchor);
  modal.style.visibility='';
}
function closeDeskNoteModal(){
  const modal=document.getElementById('desk-note-modal');
  if(modal){
    modal.style.visibility='hidden';
    modal.style.display='none';
    delete modal.dataset.popKey;
  }
}
function _deskNoteCssSelector(id){
  const raw=String(id||'');
  const safe=(window.CSS&&typeof CSS.escape==='function')?CSS.escape(raw):raw.replace(/["\\]/g,'\\$&');
  return `[data-desk-note-id="${safe}"]`;
}
function _deskNoteTitle(row){
  return [
    row?.detail||'',
    row?.original?.detail ? '원본: '+row.original.detail : ''
  ].filter(Boolean).join('\n');
}
function _deskNoteRowHtml(row,day,editable){
  const onclick=editable?` onclick="openDeskNoteModal('${_scheduleAuditAttr(row.id)}',this)"`:'';
  return `<tr class="${editable?'schedule-audit-editable':''}" data-desk-note-id="${_scheduleAuditAttr(row.id)}"${onclick} title="${_scheduleAuditAttr(_deskNoteTitle(row))}">
    ${_scheduleAuditSpacerCells(day,'td')}
    <td>${esc(row.teacher)}</td>
    <td>${esc(row.student)}</td>
    <td class="${row.change==='퇴원'?'schedule-audit-retire':''}">${esc(row.change)}</td>
    <td>${esc(row.date)}</td>
    <td>${esc(row.time)}</td>
  </tr>`;
}
function _deskNoteDataCells(rowEl){
  return [...(rowEl?.children||[])].filter(td=>!td.classList.contains('schedule-audit-spacer'));
}
function _updateDeskNoteRowDom(note){
  const row=document.querySelector(_deskNoteCssSelector(note?.id));
  if(!row) return false;
  const cells=_deskNoteDataCells(row);
  if(cells.length<5) return false;
  cells[0].textContent=note.teacher||'-';
  cells[1].textContent=note.student||'-';
  cells[2].textContent=note.change||'-';
  cells[2].classList.toggle('schedule-audit-retire',note.change==='퇴원');
  cells[3].textContent=note.date||'-';
  cells[4].textContent=note.time||'-';
  row.title=_deskNoteTitle(note);
  return true;
}
function _insertDeskNoteRowDom(note){
  const day=note?.day||'기타';
  const section=document.querySelector(`.schedule-audit-day[data-schedule-audit-day="${_scheduleAuditAttr(day)}"]`);
  const tbody=section?.querySelector('tbody');
  if(!tbody) return false;
  const tmp=document.createElement('tbody');
  tmp.innerHTML=_deskNoteRowHtml(note,day,true);
  const row=tmp.firstElementChild;
  const empty=tbody.querySelector('tr .schedule-audit-empty')?.closest('tr');
  if(empty) empty.remove();
  const addRow=tbody.querySelector('.schedule-audit-add-row');
  if(addRow) tbody.insertBefore(row,addRow);
  else tbody.appendChild(row);
  return true;
}
function _removeDeskNoteRowDom(note){
  const row=document.querySelector(_deskNoteCssSelector(note?.id));
  if(!row) return false;
  const tbody=row.parentElement;
  const section=row.closest('.schedule-audit-day');
  const day=section?.getAttribute('data-schedule-audit-day')||note?.day||'기타';
  row.remove();
  if(tbody&&!tbody.querySelector('tr[data-desk-note-id]')){
    const addRow=tbody.querySelector('.schedule-audit-add-row');
    const empty=document.createElement('tr');
    empty.innerHTML=`<td colspan="${_scheduleAuditHasNum(day)?7:6}" class="schedule-audit-empty">기록 없음</td>`;
    if(addRow) tbody.insertBefore(empty,addRow);
    else tbody.appendChild(empty);
  }
  return true;
}
function saveDeskNoteModal(){
  const id=document.getElementById('desk-note-id')?.value||'';
  let note=_findDeskNote(id);
  const isNew=!note;
  if(!_deskNoteCanSave(false)) return;
  const now=new Date().toISOString();
  const scope=_scheduleAuditActiveScope();
  if(!note){
    note={
      id:_deskNoteId(),
      sourceKey:'',
      original:{source:'manual'},
      day:document.getElementById('desk-note-day')?.value||'기타',
      tabId:scope.tabId,
      tabName:scope.tabName,
      tabType:scope.tabType,
      monthKey:_scheduleAuditMonthKey(),
      manual:true,
      deleted:false,
      createdAt:now,
      updatedAt:now,
    };
    note.sourceKey='manual|'+note.id;
  } else {
    note={...note};
  }
  const dateText=document.getElementById('desk-note-date')?.value||'';
  const parsedDate=_scheduleAuditParseDateText(dateText,_scheduleAuditMonthKey());
  const expectedVersion=document.getElementById('desk-note-version')?.value||'';
  note.teacher=(document.getElementById('desk-note-teacher')?.value||'').trim()||'-';
  note.student=(document.getElementById('desk-note-student')?.value||'').trim()||'-';
  note.change=(document.getElementById('desk-note-change')?.value||'').trim()||'-';
  note.tabId=note.tabId||scope.tabId;
  note.tabName=note.tabName||scope.tabName;
  note.tabType=note.tabType||scope.tabType;
  note.dateKey=parsedDate.key;
  note.date=parsedDate.label||'-';
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(parsedDate.key||''))) note.recordMonthKey=_deskNoteMonthFromDateKey(parsedDate.key);
  else delete note.recordMonthKey;
  note.time=(document.getElementById('desk-note-time')?.value||'').trim()||'-';
  note.updatedAt=now;
  _upsertDeskNoteTx(note,isNew?'':expectedVersion,{type:'edit',label:isNew?'기록 추가':'기록 수정'}).then(()=>{
    DESK_NOTES=_mergeDeskNote(DESK_NOTES,note);
    closeDeskNoteModal();
    renderScheduleAuditSummary();
    if(typeof toast==='function') toast('기록을 저장했습니다','ok');
  }).catch(err=>{
    console.warn('기록 저장 실패:',err);
    if(typeof toast==='function') toast(err?.message||'기록 저장 실패','err');
  });
}
function deleteDeskNoteModal(){
  const id=document.getElementById('desk-note-id')?.value||'';
  const note=_findDeskNote(id);
  if(!note) return;
  if(!_deskNoteCanSave(false)) return;
  if(!confirm('이 기록을 삭제할까요?')) return;
  const next={...note,deleted:true,updatedAt:new Date().toISOString()};
  const expectedVersion=document.getElementById('desk-note-version')?.value||'';
  _upsertDeskNoteTx(next,expectedVersion,{type:'edit',label:'기록 삭제'}).then(()=>{
    DESK_NOTES=_mergeDeskNote(DESK_NOTES,next);
    closeDeskNoteModal();
    if(!_removeDeskNoteRowDom(next)) renderScheduleAuditSummary();
    if(typeof toast==='function') toast('기록을 삭제했습니다','ok');
  }).catch(err=>{
    console.warn('기록 삭제 실패:',err);
    if(typeof toast==='function') toast(err?.message||'기록 삭제 실패','err');
  });
}
function _scheduleAuditRowsForItem(item,monthKey,visibleDays){
  const scope=_scheduleAuditScopeFromItem(item);
  const detail=String(item?.detail||'');
  const parts=detail.split(/\s+\/\s+/).map(v=>v.trim()).filter(Boolean);
  const segments=parts.length?parts:[_scheduleAuditText(item)];
  const rows=[];
  segments.forEach(segment=>{
    const text=[item?.label,item?.target,segment].map(v=>String(v||'')).join(' ');
    if(/휴원/.test(text)) return;
    const isDisappear=/원생\s*(이동|삭제)|퇴원|제외|→/.test(text);
    if(!isDisappear) return;
    if(/등록/.test(text)&&!/원생\s*이동|→|퇴원|제외|삭제/.test(text)) return;
    const fromText=String(text).split('→')[0];
    const toText=String(text).split('→').slice(1).join('→');
    const fromSlot=_scheduleAuditSlotFromText(fromText)||_scheduleAuditSlotFromText(text);
    if(!fromSlot) return;
    const toSlot=_scheduleAuditSlotFromText(toText);
    const date=_scheduleAuditRecordedDateInfo(item);
    if(monthKey&&_deskNoteMonthFromDateKey(date.key)!==String(monthKey)) return;
    const days=_scheduleAuditExpandDay(fromSlot.dayToken,['월','화','수','목','금','토','일']);
    days.forEach(day=>{
      if(_scheduleAuditIsBangteukSlot(fromSlot,day)||_scheduleAuditIsBangteukSlot(toSlot,day)) return;
      if(_scheduleAuditIsSameTeacherClassMove(fromSlot,toSlot,day,item)) return;
      const reason=_scheduleAuditDisappearanceReason(item,text,fromSlot,toSlot);
      rows.push({
        day,
        teacher:_scheduleAuditTeacherFromSlot(fromSlot,day,item),
        target:_scheduleAuditNameFromSegment(segment,item),
        reason,
        date:date.label,
        dateKey:date.key,
        time:_scheduleAuditDisplayTime(fromSlot,day)||_scheduleAuditTime(item),
        detail:String(segment||item?.detail||item?.label||''),
        at:item?.at||'',
        source:item?._source||'audit',
        tabId:scope.tabId||'global',
        tabName:scope.tabName||'전체 기록',
        tabType:scope.tabType||'regular',
      });
    });
  });
  return rows;
}
function _scheduleAuditDayWidth(day){
  if(day==='기타') return 'calc(var(--w-time-col) + var(--w-cell) + var(--w-cell) + var(--w-cell))';
  let lanes=5;
  let hasNum=false;
  try{ lanes=typeof getLanes==='function'?getLanes():5; }catch(e){}
  try{ hasNum=(typeof getHasNum==='function'?getHasNum():[]).includes(day); }catch(e){}
  const parts=['var(--w-time-col)'];
  if(hasNum) parts.push('var(--w-num-col)');
  for(let i=0;i<lanes;i++) parts.push('var(--w-cell)');
  return 'calc('+parts.join(' + ')+')';
}
function _scheduleAuditHasNum(day){
  try{return (typeof getHasNum==='function'?getHasNum():[]).includes(day);}catch(e){return false;}
}
function _scheduleAuditColgroup(day){
  const hasNum=_scheduleAuditHasNum(day);
  const spacer=hasNum
    ? '<col class="schedule-audit-time-col"><col class="schedule-audit-num-col">'
    : '<col class="schedule-audit-time-col">';
  return `<colgroup>${spacer}<col><col><col><col><col></colgroup>`;
}
function _scheduleAuditSpacerCells(day,tag){
  const hasNum=_scheduleAuditHasNum(day);
  return `<${tag} class="schedule-audit-spacer"></${tag}>${hasNum?`<${tag} class="schedule-audit-spacer"></${tag}>`:''}`;
}
function _scheduleAuditVisibleForActiveTab(){
  return _scheduleAuditActiveScope().tabType!=='bangteuk';
}
function ensureScheduleAuditSummary(){
  const wrap=document.getElementById('tbl');
  if(!wrap) return false;
  let panel=document.getElementById('schedule-audit-summary');
  if(!_scheduleAuditVisibleForActiveTab()){
    if(panel) panel.remove();
    return false;
  }
  if(panel&&panel.parentElement!==wrap) panel.remove();
  panel=document.getElementById('schedule-audit-summary');
  if(!panel){
    panel=document.createElement('section');
    panel.id='schedule-audit-summary';
    panel.className='schedule-audit-summary';
    panel.setAttribute('aria-live','polite');
    panel.innerHTML=`<div id="schedule-audit-body" class="schedule-audit-body">
      <div class="schedule-audit-empty">기록을 불러오는 중입니다...</div>
    </div>`;
    wrap.appendChild(panel);
  }
  return true;
}
function renderScheduleAuditSummary(){
  if(!ensureScheduleAuditSummary()) return;
  const panel=document.getElementById('schedule-audit-summary');
  const body=document.getElementById('schedule-audit-body');
  if(!panel||!body) return;
  const monthKey=_scheduleAuditMonthKey();
  if(!_auditStorageLoaded&&!_scheduleAuditLoaded&&!_scheduleAuditLoading&&Date.now()>=_scheduleAuditLoadRetryAt){
    _scheduleAuditLoadRetryAt=Date.now()+10000;
    _loadScheduleAuditLog().then(renderScheduleAuditSummary).catch(err=>{
      console.warn('하단 변경 로그 로드 실패:',err);
      _scheduleAuditLoadRetryAt=Date.now()+10000;
      renderScheduleAuditSummary();
    });
  }
  const visibleDays=_scheduleAuditDays();
  const perDay={};
  visibleDays.forEach(day=>{ perDay[day]=[]; });
  const seenRows=new Set();
  const sourceRows=[];
  const addSourceRow=row=>{
    if(!row||!row.day) return;
    const key=_scheduleAuditRowKey(row);
    if(seenRows.has(key)) return;
    seenRows.add(key);
    sourceRows.push(row);
  };
  _scheduleAuditRowsFromVisibleReservations(monthKey,visibleDays).forEach(addSourceRow);
  const items=_recordItems(false).sort((a,b)=>(b.at||'').localeCompare(a.at||''));
  items.forEach(item=>{
    _scheduleAuditRowsForItem(item,monthKey,visibleDays).forEach(addSourceRow);
  });
  const notes=_syncDeskNotesFromRows(sourceRows);
  const visibleNoteKeys=new Set();
  notes.filter(note=>_deskNoteVisible(note,monthKey,visibleDays)).forEach(note=>{
    const noteKey=[note.day,note.teacher,note.student,note.change,note.date,note.time].map(v=>String(v||'').trim()).join('|');
    if(visibleNoteKeys.has(noteKey)) return;
    visibleNoteKeys.add(noteKey);
    const day=note.day||'기타';
    if(!perDay[day]) perDay[day]=[];
    perDay[day].push(note);
  });
  const dayOrder=['월','화','수','목','금','토','일','기타'];
  const days=[...visibleDays];
  Object.keys(perDay).forEach(day=>{
    if((perDay[day]||[]).length&&!days.includes(day)) days.push(day);
  });
  days.sort((a,b)=>{
    const ai=dayOrder.indexOf(a), bi=dayOrder.indexOf(b);
    return (ai<0?99:ai)-(bi<0?99:bi);
  });
  const hasRows=days.some(day=>(perDay[day]||[]).length);
  const editable=_deskNoteCanSave(true);
  if(!hasRows&&!editable){
    body.innerHTML='<div class="schedule-audit-empty">해당 월 이탈 기록이 없습니다</div>';
    return;
  }
  body.innerHTML=days.map(day=>{
    const rows=_scheduleAuditSortRows(perDay[day]||[]);
    const total=(perDay[day]||[]).length;
    const html=rows.length?rows.map(row=>_deskNoteRowHtml(row,day,editable)).join(''):`<tr><td colspan="${_scheduleAuditHasNum(day)?7:6}" class="schedule-audit-empty">기록 없음</td></tr>`;
    const addRow=editable?`<tr class="schedule-audit-editable schedule-audit-add-row" onclick="openDeskNoteCreate('${_scheduleAuditAttr(day)}',this)" title="${esc(day==='기타'?'기록 추가':day+'요일 기록 추가')}">
      ${_scheduleAuditSpacerCells(day,'td')}
      <td class="schedule-audit-add" colspan="5">+ 기록 추가</td>
    </tr>`:'';
    return `<section class="schedule-audit-day" data-schedule-audit-day="${_scheduleAuditAttr(day)}" style="width:${_scheduleAuditDayWidth(day)}" title="${esc(day==='기타'?'기타':day+'요일')} ${total}건">
      <table class="schedule-audit-table">
        ${_scheduleAuditColgroup(day)}
        <thead><tr>${_scheduleAuditSpacerCells(day,'th')}<th>담당</th><th>원생</th><th>변동</th><th>수정날짜</th><th>시간</th></tr></thead>
        <tbody>${html}${addRow}</tbody>
      </table>
    </section>`;
  }).join('');
}
function openScheduleAuditMore(){
  const monthKey=_scheduleAuditMonthKey();
  openRecordManagerModal();
  setTimeout(()=>{
    const month=document.getElementById('record-month');
    const date=document.getElementById('record-date');
    const type=document.getElementById('record-type');
    if(month) month.value=monthKey;
    if(date) date.value='';
    if(type) type.value='all';
    if(typeof changeRecordFilter==='function') changeRecordFilter();
  },120);
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
  const restoreById=new Map((Array.isArray(RESTORE_POINTS)?RESTORE_POINTS:[]).map(point=>[point.id,point]));
  const restoreCount=[...restoreById.values()].filter(point=>point&&point.hasPayload!==false&&!point.skipped&&!point.before?.skipped).length;
  const summary=document.getElementById('record-summary');
  const period=_recordActivePeriodLabel();
  const pages=Math.max(1, Math.ceil(list.length/RECORD_PAGE_SIZE));
  if(_recordPage>pages) _recordPage=pages;
  const start=(list.length?(_recordPage-1)*RECORD_PAGE_SIZE:0);
  const pageItems=list.slice(start,start+RECORD_PAGE_SIZE);
  const rangeText=list.length?`${start+1}-${Math.min(start+RECORD_PAGE_SIZE,list.length)}건 표시`:'0건';
  if(summary) summary.textContent=`전체 ${total}건${list.length!==total?` · 필터 결과 ${list.length}건`:''}${period?` · 기간 ${period}`:''} · ${rangeText}${restoreCount?` · 최근 ${restoreCount}개 작업은 해당 작업 직전으로 복구할 수 있습니다`:''}`;
  const wrap=document.getElementById('record-list');
  if(!wrap) return;
  if(!list.length){
    wrap.innerHTML='<div style="text-align:center;color:#888;padding:40px 12px;font-size:13px">기록이 없습니다</div>';
    return;
  }
  const rows=pageItems.map(item=>{
    const type=item.type||'edit';
    const restorePoint=item.restoreId?restoreById.get(item.restoreId):null;
    const restore=restorePoint&&restorePoint.hasPayload!==false&&!restorePoint.skipped&&!restorePoint.before?.skipped
      ? `<button class="btn btn-o" onclick="restoreRecordPoint('${esc(item.restoreId)}')">이 시점으로</button>`
      : '';
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
function _cacheRestorePayload(key,point){
  if(!key||!point) return point;
  _restorePayloadCache.delete(key);
  _restorePayloadCache.set(key,point);
  while(_restorePayloadCache.size>RESTORE_PAYLOAD_CACHE_LIMIT){
    const oldest=_restorePayloadCache.keys().next().value;
    _restorePayloadCache.delete(oldest);
    if(typeof releaseDeferredJSONMemory==='function') releaseDeferredJSONMemory(oldest);
  }
  return point;
}
async function _loadRestorePayload(summary){
  if(summary?.before) return summary;
  if(summary?.hasPayload===false||summary?.skipped){
    return {...summary,before:{keys:summary.keys||[],data:{},skipped:true,reason:'too-large'}};
  }
  const keys=[summary?.entryKey,_restoreEntryStorageKey(summary?.id),'swim_restore_point_'+String(summary?.id||'')]
    .filter((key,idx,list)=>key&&list.indexOf(key)===idx);
  for(const key of keys){
    if(_restorePayloadCache.has(key)){
      const cached=_restorePayloadCache.get(key);
      _restorePayloadCache.delete(key);
      _restorePayloadCache.set(key,cached);
      return cached;
    }
    const raw=await _readAuditRaw(key);
    const point=_auditParseStored(raw,null);
    if(point&&typeof point==='object'&&point.before) return _cacheRestorePayload(key,point);
  }
  return null;
}
async function restoreRecordPoint(restoreId){
  if(window.SCAuth && !SCAuth.requirePermission('manageRecords','기록 되돌리기')) return;
  const summary=(Array.isArray(RESTORE_POINTS)?RESTORE_POINTS:[]).find(p=>p.id===restoreId);
  if(!summary){toast('복구 지점을 찾을 수 없습니다','err');return;}
  let point=null;
  try{
    point=await _loadRestorePayload(summary);
  }catch(err){
    console.error('복구 데이터 로드 실패:',err);
    toast('복구 데이터를 불러오지 못했습니다','err');
    return;
  }
  if(!point||!point.before){toast('복구 지점을 찾을 수 없습니다','err');return;}
  if(point.before.skipped){toast('이 기록은 용량 제한으로 되돌리기 데이터가 없습니다','err');return;}
  if(!confirm(`"${point.label||'선택한 기록'}" 작업 직전 상태로 되돌릴까요?\n\n현재 상태는 복구 로그로 남겨둡니다.`)) return;
  const restoreKeys=[...new Set(point.before.keys||point.keys||[])]
    .filter(key=>!_isAuditStorageKey(key));
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
    sid: stu.sid||null,
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
function retireHistoryEntryForSlot(slotKey,fallback){
  const parts=String(slotKey||'').split('/');
  if(parts.length!==4||!Array.isArray(RETIRE_HISTORY)) return null;
  const [t,d,l,r]=parts.map(v=>String(v||''));
  const fallbackName=String(fallback?.n||fallback?.name||'').trim();
  const fallbackPhone=String(fallback?.p||fallback?.phone||'').replace(/\D/g,'');
  const fallbackSid=String(fallback?.sid||'').trim();
  const rows=RETIRE_HISTORY.filter(row=>{
    if(!row) return false;
    if(String(row.t||'')!==t||String(row.d||'')!==d||String(row.l||'')!==l||String(row.r||'')!==r) return false;
    if(fallbackSid&&row.sid&&String(row.sid)!==fallbackSid) return false;
    if(fallbackName&&String(row.n||'').trim()&&String(row.n||'').trim()!==fallbackName) return false;
    const rowPhone=String(row.p||'').replace(/\D/g,'');
    if(fallbackPhone&&rowPhone&&fallbackPhone!==rowPhone) return false;
    return !!row.retiredAt;
  }).sort((a,b)=>String(b.recordedAt||'').localeCompare(String(a.recordedAt||'')));
  const hit=rows[0];
  if(!hit) return null;
  return {
    ds:hit.retiredAt,
    sid:hit.sid||'',
    name:hit.n||'',
    age:hit.a||null,
    p:hit.p||'',
    retireType:'retire',
    _history:true,
  };
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
function saveAttendance(){ saveJSON(_attendanceStorageKey('attendance'), ATTENDANCE); }
function saveAttGuests(){ saveJSON(_attendanceStorageKey('attGuests'), ATT_GUESTS); }
function saveDaySnapshot(ds,tabId,snapshotValue){
  const date=String(ds||'');
  const snapshot=snapshotValue||DAY_SNAPSHOT[date];
  if(!date||!snapshot) return false;
  const basisTab=tabId
    ? (typeof _tabById==='function'?_tabById(tabId):null)
    : (typeof getAttendanceBasisTabForDate==='function'?getAttendanceBasisTabForDate(date):null);
  const targetTabId=basisTab?.id||tabId||_activeTab;
  if(typeof cacheAttendanceDaySnapshot==='function') cacheAttendanceDaySnapshot(targetTabId,date,snapshot);
  const key=typeof getAttendanceDaySnapshotStorageKey==='function'
    ? getAttendanceDaySnapshotStorageKey(targetTabId,date)
    : _attendanceStorageKey('daySnapshot',targetTabId);
  return saveJSON(key,snapshot);
}

function _cacheJSONOnly(key,val){
  val=normalizeStoredScheduleValue(key,val);
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
function _parseJSONValue(raw,fallback,storageKey){
  if(!raw) return _cloneJSON(fallback);
  try{
    const val=typeof raw==='string'?JSON.parse(raw):raw;
    const parsed=val===undefined||val===null?_cloneJSON(fallback):val;
    return storageKey?normalizeStoredScheduleValue(storageKey,parsed):parsed;
  }catch(e){
    const parsed=_cloneJSON(fallback);
    return storageKey?normalizeStoredScheduleValue(storageKey,parsed):parsed;
  }
}
function _txJSONValue(storageKey,currentValue,applyResult,mutator,fallback,meta){
  meta=meta||{};
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
  const runMutator=value=>mutator(normalizeStoredScheduleValue(storageKey,value), reason=>{abortReason=reason||'';});
  const auditPoint=!meta.skipAudit&&(typeof createAuditPoint==='function')
    ? createAuditPoint([storageKey], {type:describeStorageChangeType(storageKey), label:describeStorageChange(storageKey)})
    : null;
  if(!meta.skipUndo&&typeof pushUndoForKeys==='function') pushUndoForKeys(storageKey);
  if(!_fbReady){
    const value=normalizeStoredScheduleValue(storageKey,_cloneJSON(currentValue!==undefined?currentValue:fallback));
    const before=_cloneJSON(value);
    const next=runMutator(value);
    if(next===undefined) return Promise.reject(new Error(abortReason||'transaction aborted'));
    let deletionEvents=[];
    if(next!==undefined){
      const normalizedNext=normalizeStoredScheduleValue(storageKey,next);
      deletionEvents=_studentDeletionEvents(storageKey,before,normalizedNext,meta);
      applyResult(normalizedNext);
      saveJSON(storageKey,normalizedNext);
    }
    return recordStudentDeletionSafety(deletionEvents,meta).then(()=>next);
  }
  const sk=storageKey.replace(/[.#$/\[\]]/g,'_');
  let deletionEvents=[];
  return _fb.child(sk).transaction(raw=>{
    const value=_parseJSONValue(raw,fallback,storageKey);
    const before=_cloneJSON(value);
    const next=runMutator(value);
    if(next===undefined) return;
    const normalizedNext=normalizeStoredScheduleValue(storageKey,next);
    deletionEvents=_studentDeletionEvents(storageKey,before,normalizedNext,meta);
    return JSON.stringify(normalizedNext);
  }).then(res=>{
    if(!res.committed) throw new Error(abortReason||'transaction aborted');
    const next=_parseJSONValue(res.snapshot.val(),fallback,storageKey);
    applyResult(next);
    _cacheJSONOnly(storageKey,next);
    if(auditPoint) recordAuditPoint(auditPoint,[storageKey],meta);
    return recordStudentDeletionSafety(deletionEvents,meta).then(()=>next);
  });
}
function _txJSONMap(storageKey,currentMap,applyResult,mutator,meta){
  return _txJSONValue(storageKey,currentMap,applyResult,mutator,{},meta);
}
function _storageSafeKey(key){ return key.replace(/[.#$/\[\]]/g,'_'); }
function _applyStoredValue(key,val){
  val=normalizeStoredScheduleValue(key,val);
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
  else if(key===STORAGE_KEYS.RETIRE_HISTORY) RETIRE_HISTORY=Array.isArray(val)?val:[];
  else if(key===STORAGE_KEYS.TEACHERS && typeof TEACHERS!=='undefined'){
    TEACHERS=Array.isArray(val)?val:[];
    if(typeof updateTeacherStyles==='function') updateTeacherStyles();
  }
  else if(key===_attendanceStorageKey('attendance')) ATTENDANCE=val||{};
  else if(key===_attendanceStorageKey('attGuests')) ATT_GUESTS=val||{};
  else if(key===_attendanceStorageKey('daySnapshot')) DAY_SNAPSHOT=val||{};
  else if(key===STORAGE_KEYS.DESK_NOTES) DESK_NOTES=Array.isArray(val)?val:[];
  else if(key===STORAGE_KEYS.AUDIT_LOG) AUDIT_LOG=Array.isArray(val)?val:[];
  else if(key===STORAGE_KEYS.RESTORE_POINTS) RESTORE_POINTS=Array.isArray(val)?val:[];
}
function updateScheduleTx(keysOrMutator,mutatorOrMeta,metaArg){
  const hasExplicitKeys=Array.isArray(keysOrMutator);
  const txKeysRaw=hasExplicitKeys ? keysOrMutator : _auditEditKeys();
  const mutator=hasExplicitKeys ? mutatorOrMeta : keysOrMutator;
  const meta=(hasExplicitKeys ? metaArg : mutatorOrMeta)||{};
  const txKeys=[...new Set((txKeysRaw||[]).filter(Boolean))]
    .filter(key=>!_isAuditStorageKey(key));
  const txSafeKeys=[...new Set(txKeys.map(_storageSafeKey))];
  const txKeySet=new Set(txSafeKeys);
  const studentKeys=txKeys.filter(_auditIsStudentKey);
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
  const auditPoint=!meta.skipAudit&&(typeof createAuditPoint==='function')?createAuditPoint(txKeys, meta||{type:'edit', label:'시간표 편집'}):null;
  if(!meta.skipUndo&&typeof pushUndoForKeys==='function') pushUndoForKeys(txKeys);
  let deletionEvents=[];
  const captureStudents=root=>{
    const before={};
    studentKeys.forEach(key=>{
      before[key]=_cloneJSON(_parseJSONValue(root[_storageSafeKey(key)],[],key));
    });
    return before;
  };
  const collectStudentDeletions=(before,root)=>{
    const events=[];
    studentKeys.forEach(key=>{
      if(!touched.has(key)) return;
      const after=_parseJSONValue(root[_storageSafeKey(key)],[],key);
      events.push(..._studentDeletionEvents(key,before[key],after,meta));
    });
    return events;
  };
  const makeCtx=root=>({
    get(key,fallback){
      const safeKey=_storageSafeKey(key);
      if(!txKeySet.has(safeKey)) throw new Error('트랜잭션 키 누락: '+key);
      return _parseJSONValue(root[safeKey],fallback,key);
    },
    set(key,val){
      const safeKey=_storageSafeKey(key);
      if(!txKeySet.has(safeKey)) throw new Error('트랜잭션 키 누락: '+key);
      root[safeKey]=JSON.stringify(normalizeStoredScheduleValue(key,val));
      touched.add(key);
    },
    abort(reason){ abortReason=reason||''; },
  });
  if(!_fbReady){
    const localRoot={};
    txKeys.forEach(key=>{localRoot[_storageSafeKey(key)]=dbGet(key);});
    const beforeStudents=captureStudents(localRoot);
    const next=mutator(makeCtx(localRoot));
    if(next===undefined) return Promise.reject(new Error(abortReason||'transaction aborted'));
    deletionEvents=collectStudentDeletions(beforeStudents,localRoot);
    touched.forEach(key=>{
      const val=_parseJSONValue(localRoot[_storageSafeKey(key)],{},key);
      _applyStoredValue(key,val);
      saveJSON(key,val);
    });
    return recordStudentDeletionSafety(deletionEvents,meta);
  }
  const runTx=typeof _fb.transactionKeys==='function'
    ? updateFn=>_fb.transactionKeys(txSafeKeys, updateFn)
    : updateFn=>_fb.transaction(updateFn);
  return runTx(root=>{
    root=root||{};
    touched.clear();
    abortReason='';
    const beforeStudents=captureStudents(root);
    const result=mutator(makeCtx(root));
    if(result===undefined) return;
    deletionEvents=collectStudentDeletions(beforeStudents,root);
    return root;
  }).then(res=>{
    if(!res.committed) throw new Error(abortReason||'transaction aborted');
    const root=res.snapshot.val()||{};
    touched.forEach(key=>{
      const val=_parseJSONValue(root[_storageSafeKey(key)],{},key);
      _applyStoredValue(key,val);
      _cacheJSONOnly(key,val);
    });
    if(auditPoint&&touched.size) recordAuditPoint(auditPoint,Array.from(touched),meta);
    return recordStudentDeletionSafety(deletionEvents,meta);
  });
}
function updateStudentsTx(mutator,meta){
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
  },[],meta);
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
  return _txJSONMap(_attendanceStorageKey('attendance'),ATTENDANCE,next=>{ATTENDANCE=next;},mutator);
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
  return _txJSONMap(_attendanceStorageKey('attGuests'),ATT_GUESTS,next=>{ATT_GUESTS=next;},mutator);
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
      _origGlobalMaps.attendance = loadJSON(_attendanceStorageKey('attendance'), {});
      _origGlobalMaps.attGuests  = loadJSON(_attendanceStorageKey('attGuests'), {});
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
  ATTENDANCE   = loadJSON(_attendanceStorageKey('attendance'), {});
  ATT_GUESTS   = loadJSON(_attendanceStorageKey('attGuests'), {});
  DAY_SNAPSHOT = typeof getLoadedAttendanceDaySnapshotMap==='function'
    ? getLoadedAttendanceDaySnapshotMap(_activeTab)
    : {};
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
  _tabList=typeof _normalizeTabList==='function'
    ? _normalizeTabList(tl.length?tl:[{id:'regular',name:'정규시간표',type:'regular'}])
    : (tl.length?tl:[{id:'regular',name:'정규시간표',type:'regular'}]);
  if(typeof _tabFolderList!=='undefined'){
    const tf=loadJSON(STORAGE_KEYS.TAB_FOLDERS, []);
    _tabFolderList=Array.isArray(tf)?tf:[];
  }
  // 기록 데이터는 지연 로드되고 실시간 루트에도 포함되지 않는다.
  // reloadGlobalData 중 구형 배열만 다시 읽으면 새 증분 기록이 사라지므로 현재 병합본을 유지한다.
  DESK_NOTES=loadJSON(STORAGE_KEYS.DESK_NOTES, []);
  if(!Array.isArray(DESK_NOTES)) DESK_NOTES=[];
  RETIRE_HISTORY=loadJSON(STORAGE_KEYS.RETIRE_HISTORY, []);
  if(!Array.isArray(RETIRE_HISTORY)) RETIRE_HISTORY=[];
  // 현재 활성 탭이 삭제됐으면 첫 탭으로
  if(!_tabList.find(t=>t.id===_activeTab)){
    _activeTab=typeof _mainTabId==='function'?_mainTabId(_tabList):_tabList[0].id;
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
function updateReserve(instKey,idx,patch){
  idx=parseInt(idx,10);
  if(!RESERVE_MAP[instKey]||!RESERVE_MAP[instKey][idx]) return Promise.resolve(false);
  const obj={n:String(patch?.n||'').trim()};
  if(!obj.n) return Promise.reject(new Error('이름을 입력하세요'));
  if(patch?.p) obj.p=normPhone(String(patch.p));
  if(patch?.m) obj.m=String(patch.m).trim();
  if(patch?.d) obj.d=String(patch.d).trim();
  if(patch?.teacher) obj.teacher=String(patch.teacher).trim();
  RESERVE_MAP[instKey][idx]=obj;
  return updateReserveMapTx(reserve=>{
    if(!reserve[instKey]||!reserve[instKey][idx]) return reserve;
    reserve[instKey][idx]=obj;
    return reserve;
  }).catch(e=>{console.error(e);throw e;});
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
function isParentAbsentRequestMark(mark){
  if(!mark||mark.type!=='absent') return false;
  if(mark.status==='accepted'||mark.status==='confirmed'||mark.status==='processed') return false;
  return mark.requiresDeskApproval===true && (mark.status==='requested'||mark.status==='pending');
}
function absentMarkLabel(mark){
  return isParentAbsentRequestMark(mark)?'결석신청':'결석';
}
function absentMarkBadgeText(mark,dl){
  return isParentAbsentRequestMark(mark)?`⏳신청 ${dl}`:dl;
}
function setMark(slotKey,ds,val){ setMarkEntryTx(slotKey+'/'+ds,val).catch(e=>{toast('마크 저장 실패','err');console.error(e);}); }
function clearMark(slotKey,ds){ clearMarkEntryTx(slotKey+'/'+ds).catch(e=>{toast('마크 저장 실패','err');console.error(e);}); }

/* ──── Cross-file shared state ──── */
let _pendingSync=false;
let _tabFocusTime=0;
document.addEventListener('visibilitychange',()=>{if(!document.hidden)_tabFocusTime=Date.now();});
window.addEventListener('focus',()=>{_tabFocusTime=Date.now();});
