/* ════════════════════════════════════════════════════════════════
 * SECTION: 출석 모드 (시간표에 통합)
 * ════════════════════════════════════════════════════════════════ */
// [v118] 오늘 요일 판정 헬퍼 (day-sep-today 클래스 적용용)
function _isTodayDay(day){
  const t=getToday();
  if(typeof dayMatchesDate==='function') return dayMatchesDate(day,t);
  return ['일','월','화','수','목','금','토'][t.getDay()]===day;
}
function _tableLocUsesVehicle(loc){
  const txt=(loc||'').trim();
  if(!txt || /^(자가등하원|도보등하원)$/.test(txt)) return false;
  const lines=txt.split(/[\n\/|]/).map(s=>s.trim()).filter(Boolean);
  return lines.some(line=>{
    const m=line.match(/^(?:승하차|승차|하차)\s*[:：]?\s*(.+)$/);
    const val=(m?m[1]:line).trim();
    return !!val && !/^(자가|도보)/.test(val);
  });
}
let _attendanceMode=false;
let _attendanceDate=null;  // YYYY-MM-DD
let _attEditMode=false;     // true면 셀 클릭 시 출석체크 대신 편집
let _attBatchMode=false;    // true면 여러 칸 선택 후 일괄 처리
let _attBatchTargets=new Map();

function _updateAttEditUi(){
  const btn=document.getElementById('att-edit-btn');
  if(!btn) return;
  if(_attEditMode){
    btn.style.background='#F59E0B';
    btn.style.color='#fff';
    btn.textContent='✏️ 편집모드 종료';
  } else {
    btn.style.background='rgba(255,255,255,0.2)';
    btn.style.color='#fff';
    btn.textContent='✏️ 편집모드 켜기';
  }
}
function _attTargetId(slotKey, isSub, item, ds){
  if(item?.guest) return 'guest|'+item.sgk+'|'+item.gid;
  return 'att|'+slotKey+'|'+ds+'|'+(isSub?'sub':'primary');
}
function _attTargetFromItem(slotKey, isSub, item, ds){
  if(!item || item.hyuwon) return null;
  return {
    id:_attTargetId(slotKey,isSub,item,ds),
    slotKey,
    isSub:!!isSub,
    ds,
    isGuest:!!item.guest,
    sgk:item.sgk||'',
    gid:item.gid||'',
    name:item.n||''
  };
}
function _updateAttBatchUi(){
  const count=_attBatchTargets.size;
  const btn=document.getElementById('att-batch-btn');
  const counter=document.getElementById('att-batch-count');
  const actions=document.getElementById('att-batch-actions');
  document.body.classList.toggle('att-batch-on', !!_attBatchMode);
  if(btn){
    btn.textContent=_attBatchMode?'☑ 선택모드 종료':'☑ 선택모드 켜기';
    btn.style.background=_attBatchMode?'#2563EB':'rgba(255,255,255,0.2)';
    btn.style.color='#fff';
  }
  if(counter){
    counter.style.display=_attBatchMode?'inline-flex':'none';
    counter.textContent=count+'개 선택';
  }
  if(actions){
    actions.style.display=_attBatchMode&&count?'inline-flex':'none';
  }
}
function toggleAttBatchMode(){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석 일괄 체크')) return;
  _attBatchMode=!_attBatchMode;
  if(_attBatchMode && _attEditMode){
    _attEditMode=false;
    _updateAttEditUi();
  }
  if(!_attBatchMode) _attBatchTargets.clear();
  _updateAttBatchUi();
  buildTable();
}
function clearAttBatchSelection(){
  _attBatchTargets.clear();
  _updateAttBatchUi();
  buildTable();
}
function _toggleAttBatchTarget(target){
  if(!target) return false;
  if(_attBatchTargets.has(target.id)) _attBatchTargets.delete(target.id);
  else _attBatchTargets.set(target.id,target);
  _updateAttBatchUi();
  return true;
}
async function applyAttBatch(value){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석 일괄 체크')) return;
  const targets=[..._attBatchTargets.values()];
  if(!targets.length){toast('선택된 원생이 없습니다','err');return;}
  const regular=targets.filter(t=>!t.isGuest);
  const guests=targets.filter(t=>t.isGuest);
  try{
    const now=new Date().toISOString();
    if(regular.length){
      await updateAttendanceMapTx(att=>{
        regular.forEach(t=>{
          const key=t.slotKey+'/'+t.ds+(t.isSub?'#sub':'');
          if(value===null) delete att[key];
          else att[key]={s:value, at:now, by:null};
        });
        return att;
      });
    }
    if(guests.length){
      await updateAttGuestsMapTx(map=>{
        guests.forEach(t=>{
          const list=[...(map[t.sgk]||[])];
          const idx=list.findIndex(g=>g&&g.gid===t.gid);
          if(idx<0) return;
          list[idx]={...list[idx], s:value===null?'':value, at:now, by:null};
          map[t.sgk]=list;
        });
        return map;
      });
    }
    const label=value==='present'?'출석':value==='absent'?'결석':'미체크';
    const n=targets.length;
    _attBatchTargets.clear();
    _updateAttBatchUi();
    buildTable();
    _updateAttBarInfo();
    toast(n+'명 '+label+' 처리 완료','ok');
  }catch(e){
    toast('일괄 저장 실패','err');
    console.error(e);
  }
}

function toggleAttEditMode(){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석부 편집')) return;
  _attEditMode=!_attEditMode;
  if(_attEditMode && _attBatchMode){
    _attBatchMode=false;
    _attBatchTargets.clear();
  }
  _updateAttEditUi();
  _updateAttBatchUi();
  // 테이블 재렌더 — 모든 요일 셀에 편집 클릭 핸들러 새로 설치
  buildTable();
}

// 편집 모달 상태
let _editModalCtx=null;

// 원생 추가 모달 (출석부 + 버튼) - 특정 레인에서 첫 빈 row 찾아서 모달 열기
function _openAttAddModalForLane(t, day, lane, cellDs){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석부 원생 추가')) return;
  _openAttAddModal({t, d:day, l:parseInt(lane,10), cellDs, mode:'lane'});
}

// 원생 추가 모달 (출석부 + 버튼)
let _addModalCtx=null;
function _openAttAddModal(slotKeyOrCtx, cellDs){
  if(typeof slotKeyOrCtx==='object'&&slotKeyOrCtx){
    _addModalCtx=slotKeyOrCtx;
  } else {
    _addModalCtx={slotKey:slotKeyOrCtx, cellDs};
  }
  const ctx=_addModalCtx;
  const parts=ctx.slotKey?ctx.slotKey.split('/'):null;
  const t=parts?parts[0]:ctx.t;
  const d=parts?parts[1]:ctx.d;
  const l=parts?parts[2]:ctx.l;
  const r=parts?parts[3]:null;
  cellDs=ctx.cellDs;
  const [y,mm,dd]=cellDs.split('-');
  const dateObj=new Date(parseInt(y), parseInt(mm)-1, parseInt(dd));
  const dow=['일','월','화','수','목','금','토'][dateObj.getDay()];
  document.getElementById('att-add-sub').textContent=
    `${t} ${d}요일 ${l}레인${r?` ${r}번`:''} · ${parseInt(mm)}월 ${parseInt(dd)}일 (${dow})`;
  document.getElementById('att-add-name').value='';
  document.getElementById('att-add-age').value='';
  document.getElementById('att-add-modal').style.display='flex';
  setTimeout(()=>{document.getElementById('att-add-name').focus();},50);
}

function _attAddMaxRows(t){
  const base=typeof isBangteuk==='function'&&isBangteuk()?6:8;
  return Math.max(base, typeof getTimeRows==='function'?getTimeRows(t):base);
}

function _attGuestKey(t,d,l,ds){ return t+'/'+d+'/'+l+'/'+ds; }
function _attGuestsForSlot(t,d,l,slotKey,ds){
  return (ATT_GUESTS[_attGuestKey(t,d,l,ds)]||[]).filter(g=>g&&g.slotKey===slotKey);
}
function _attGuestAtSlot(t,d,l,slotKey,ds){
  return _attGuestsForSlot(t,d,l,slotKey,ds)[0]||null;
}
function _attGuestDisplay(g,t,d,l,slotKey,ds){
  if(!g) return null;
  return {
    type:g.type||'guest',
    n:g.n||'',
    a:g.a||null,
    guest:true,
    gid:g.gid,
    sgk:_attGuestKey(t,d,l,ds),
    slotKey,
    s:g.s||''
  };
}
function _attDisplayState(item,slotKey,ds,isSub){
  if(!item) return '';
  if(item.type==='hyuwon'||item.s==='hyuwon'||item.hyuwon) return 'hyuwon';
  if(item.absent) return 'absent';
  if(item.guest) return item.s||'';
  const a=ATTENDANCE[slotKey+'/'+ds+(isSub?'#sub':'')];
  return a?(typeof a==='string'?a:a.s):'';
}
function _attDisplayBg(item,state){
  if(!item) return 'att-unchecked';
  if(item.type==='hyuwon'||state==='hyuwon') return 'att-hyuwon';
  if(item.type==='bogang') return 'att-bogang';
  if(item.type==='sample') return 'att-sample';
  if(state==='present') return 'att-present';
  if(state==='absent') return 'att-absent';
  return 'att-unchecked';
}
function _attDisplayTag(item){
  if(!item) return '';
  if(item.type==='bogang') return '<span class="att-tag tag-bo">보</span>';
  if(item.type==='sample') return '<span class="att-tag tag-sa">샘</span>';
  if(item.type==='hyuwon') return '<span class="att-tag tag-hy">휴</span>';
  return '';
}
function _buildAttendanceBasisByDay(days){
  const map={};
  if(!_attendanceMode||!_attendanceDate||typeof getAttendanceBasisDataForDate!=='function') return map;
  days.forEach(day=>{
    const ds=_dayToCellDs(day);
    map[day]=getAttendanceBasisDataForDate(ds);
  });
  return map;
}
function _attendanceSourceDay(data,viewDay){
  const cfgDays=(data&&data.cfg&&Array.isArray(data.cfg.days))?data.cfg.days:[];
  if(!cfgDays.length||cfgDays.includes(viewDay)) return viewDay;
  const viewIndexes=typeof getDayIndexes==='function'?getDayIndexes(viewDay):[];
  const match=cfgDays.find(day=>{
    const indexes=typeof getDayIndexes==='function'?getDayIndexes(day):[];
    return indexes.some(idx=>viewIndexes.includes(idx));
  });
  return match||viewDay;
}
function _withAttendanceViewDay(stu,viewDay,sourceDay){
  if(!stu) return null;
  if(viewDay===sourceDay) return stu;
  return Object.assign({},stu,{d:viewDay,sourceDay});
}
function _ctxStu(ctx,t,day,lane,row){
  const data=ctx?.attendanceBasisByDay?.[day];
  if(data){
    const sourceDay=_attendanceSourceDay(data,day);
    return _withAttendanceViewDay(data.stuIdx?.[t+'/'+sourceDay+'/'+lane+'/'+row] || null,day,sourceDay);
  }
  return getStu(t,day,lane,row);
}
function _ctxInst(ctx,t,day,lane){
  const data=ctx?.attendanceBasisByDay?.[day];
  if(data){
    const sourceDay=_attendanceSourceDay(data,day);
    return data.instMap?.[t+'/'+sourceDay+'/'+lane] || null;
  }
  return getInst(t,day,lane);
}
function _ctxStudents(ctx,day){
  const data=ctx?.attendanceBasisByDay?.[day];
  if(data){
    const sourceDay=_attendanceSourceDay(data,day);
    if(sourceDay===day) return data.students;
    return (data.students||[])
      .filter(stu=>stu&&stu.d===sourceDay)
      .map(stu=>_withAttendanceViewDay(stu,day,sourceDay));
  }
  return STUDENTS;
}
function _ctxInstMap(ctx,day){
  const data=ctx?.attendanceBasisByDay?.[day];
  if(data){
    const sourceDay=_attendanceSourceDay(data,day);
    if(sourceDay===day) return data.instMap;
    const mapped={};
    Object.entries(data.instMap||{}).forEach(([key,inst])=>{
      const p=String(key).split('/');
      if(p.length===3&&p[1]===sourceDay) mapped[p[0]+'/'+day+'/'+p[2]]=inst;
    });
    return mapped;
  }
  return INST_MAP;
}

function _resolveAttAddSlot(status){
  const ctx=_addModalCtx;
  if(!ctx) return null;
  if(ctx.slotKey) return ctx.slotKey;
  const t=ctx.t, d=ctx.d, l=parseInt(ctx.l,10), cellDs=ctx.cellDs;
  const basis=(cellDs&&typeof getAttendanceBasisDataForDate==='function')?getAttendanceBasisDataForDate(cellDs):null;
  const sourceDay=basis?_attendanceSourceDay(basis,d):d;
  const stuAt=r=>basis?basis.stuIdx?.[t+'/'+sourceDay+'/'+l+'/'+r]:getStu(t,d,l,r);
  const maxRows=_attAddMaxRows(t);
  const slotAt=r=>t+'/'+d+'/'+l+'/'+r;
  if(status==='bogang'||status==='sample'){
    for(let r=1;r<=maxRows;r++){
      const sk=slotAt(r);
      const mk=MARK_MAP[sk+'/'+cellDs];
      if(stuAt(r)&&(!mk||(mk.type==='absent'&&!mk.sub))&&!_attGuestAtSlot(t,d,l,sk,cellDs)) return sk;
    }
  }
  for(let r=1;r<=maxRows;r++){
    const sk=slotAt(r);
    if(stuAt(r)) continue;
    if(MARK_MAP[sk+'/'+cellDs]) continue;
    if(_attGuestAtSlot(t,d,l,sk,cellDs)) continue;
    return sk;
  }
  return null;
}

function _closeAttAddModal(){
  _addModalCtx=null;
  document.getElementById('att-add-modal').style.display='none';
}

async function _saveAttAdd(status){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석부 원생 추가')) return;
  if(!_addModalCtx) return;
  const cellDs=_addModalCtx.cellDs;
  const slotKey=_resolveAttAddSlot(status);
  if(!slotKey){
    toast('빈 자리가 없습니다','err');
    return;
  }
  _addModalCtx.slotKey=slotKey;
  const name=document.getElementById('att-add-name').value.trim();
  const age=parseInt(document.getElementById('att-add-age').value)||null;
  if(!name){toast('이름을 입력하세요','err');return;}

  const [t,d,l,r]=slotKey.split('/');
  const li=parseInt(l);
  const guestKey=_attGuestKey(t,d,li,cellDs);
  const gid='g_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
  const guest={
    gid,
    n:name,
    a:age,
    slotKey,
    type:(status==='bogang'||status==='sample'||status==='hyuwon')?status:'guest',
    s:(status==='present'||status==='absent'||status==='hyuwon')?status:'',
    at:new Date().toISOString(),
    by:null
  };

  try{
    let duplicate=false;
    await updateAttGuestsMapTx(guests=>{
      const list=[...(guests[guestKey]||[])];
      if(list.some(g=>g&&g.slotKey===slotKey)){
        duplicate=true;
        return guests;
      }
      list.push(guest);
      guests[guestKey]=list;
      return guests;
    });
    if(duplicate){toast('이미 추가된 자리입니다','err');return;}
    const label=status==='bogang'?'보강':status==='sample'?'샘플':status==='hyuwon'?'휴원':status==='present'?'출석':'결석';
    toast(name+' 출석부 '+label+' 추가','ok');
    _closeAttAddModal();
    buildTable();
    _updateAttBarInfo();
  }catch(e){
    toast('저장 실패','err');
    console.error(e);
  }
}

// 과거 날짜 스냅샷 or 현재 STUDENTS 학생 편집 (모달)
function _editAttCell(slotKey, cellDs){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석부 학생 편집')) return;
  const [t,d,l,r]=slotKey.split('/');
  const li=parseInt(l), ri=parseInt(r);
  const targetDs=cellDs||_attendanceDate;
  const isPast=targetDs < toDateStr(getToday());
  const usingSnapshot=isPast && DAY_SNAPSHOT[targetDs];

  let curStu;
  if(usingSnapshot){
    curStu=(DAY_SNAPSHOT[targetDs].students||[]).find(s=>s.t===t&&s.d===d&&s.l===li&&s.r===ri);
  } else {
    const basis=(targetDs&&typeof getAttendanceBasisDataForDate==='function')?getAttendanceBasisDataForDate(targetDs):null;
    const sourceDay=basis?_attendanceSourceDay(basis,d):d;
    curStu=basis?_withAttendanceViewDay(basis.stuIdx?.[t+'/'+sourceDay+'/'+li+'/'+ri]||null,d,sourceDay):getStu(t,d,li,ri);
  }

  _editModalCtx={slotKey, usingSnapshot, exists:!!curStu, ds:targetDs};
  document.getElementById('att-edit-name').value=curStu?.n||'';
  document.getElementById('att-edit-age').value=curStu?.a||'';
  const infoLabel=`${t} ${d}요일 ${l}레인 ${r}번${isPast?' · '+targetDs+' 스냅샷':''}`;
  document.getElementById('att-edit-sub').textContent=infoLabel;
  document.getElementById('att-edit-delete').style.display=curStu?'inline-block':'none';
  document.getElementById('att-edit-modal').style.display='flex';
  setTimeout(()=>{document.getElementById('att-edit-name').focus();},50);
}

function _closeEditModal(){
  _editModalCtx=null;
  document.getElementById('att-edit-modal').style.display='none';
}

async function _saveEditModal(){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석부 학생 편집')) return;
  if(!_editModalCtx) return;
  const {slotKey, usingSnapshot, ds}=_editModalCtx;
  const [t,d,l,r]=slotKey.split('/');
  const li=parseInt(l), ri=parseInt(r);
  const newName=document.getElementById('att-edit-name').value.trim();
  const newAge=parseInt(document.getElementById('att-edit-age').value)||null;
  if(!newName){toast('이름을 입력하세요','err');return;}

  if(usingSnapshot){
    const arr=DAY_SNAPSHOT[ds].students||[];
    const idx=arr.findIndex(s=>s.t===t&&s.d===d&&s.l===li&&s.r===ri);
    if(idx>=0){arr[idx].n=newName; arr[idx].a=newAge;}
    else arr.push({n:newName, a:newAge, t, d, l:li, r:ri});
    DAY_SNAPSHOT[ds].students=arr;
    saveDaySnapshot();
    toast('과거 시간표 저장','ok');
  } else {
    toast('운영 시간표 원생 수정은 시간표에서 해주세요','err');
    return;
  }
  _closeEditModal();
  buildTable();
}

async function _deleteEditModal(){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석부 학생 삭제')) return;
  if(!_editModalCtx) return;
  if(!confirm('이 학생을 삭제하시겠습니까?')) return;
  const {slotKey, usingSnapshot, ds}=_editModalCtx;
  const [t,d,l,r]=slotKey.split('/');
  const li=parseInt(l), ri=parseInt(r);
  if(usingSnapshot){
    const arr=DAY_SNAPSHOT[ds].students||[];
    const idx=arr.findIndex(s=>s.t===t&&s.d===d&&s.l===li&&s.r===ri);
    if(idx>=0) arr.splice(idx,1);
    saveDaySnapshot();
  } else {
    toast('운영 시간표 원생 삭제는 시간표에서 해주세요','err');
    return;
  }
  _closeEditModal();
  buildTable();
  toast('삭제 완료','ok');
}

function toggleAttendanceMode(){
  _attendanceMode=!_attendanceMode;
  const bar=document.getElementById('attendance-bar');
  const btn=document.getElementById('attendance-toggle-btn');
  if(_attendanceMode){
    if(!_attendanceDate) _attendanceDate=toDateStr(getToday());
    document.getElementById('att-date-input').value=_attendanceDate;
    bar.style.display='flex';
    btn.style.background='rgba(255,255,255,0.3)';
    btn.style.fontWeight='900';
    // 오늘 스냅샷 저장
    _ensureTodaySnapshot();
  } else {
    bar.style.display='none';
    btn.style.background='';
    btn.style.fontWeight='';
    _attBatchMode=false;
    _attBatchTargets.clear();
    document.body.classList.remove('att-batch-on');
    _attEditMode=false;
  }
  _updateAttEditUi();
  _updateAttBatchUi();
  buildTable();
  _updateAttBarInfo();
}

function setAttendanceDate(ds){
  _attendanceDate=ds;
  _attBatchTargets.clear();
  _updateAttBatchUi();
  buildTable();
  _updateAttBarInfo();
}

function attDayShift(delta){
  const d=new Date(_attendanceDate);
  d.setDate(d.getDate()+delta);
  _attendanceDate=toDateStr(d);
  document.getElementById('att-date-input').value=_attendanceDate;
  _attBatchTargets.clear();
  _updateAttBatchUi();
  buildTable();
  _updateAttBarInfo();
}

function attWeekShift(delta){
  const d=new Date(_attendanceDate);
  d.setDate(d.getDate()+delta*7);
  _attendanceDate=toDateStr(d);
  document.getElementById('att-date-input').value=_attendanceDate;
  _attBatchTargets.clear();
  _updateAttBatchUi();
  buildTable();
  _updateAttBarInfo();
}

function setAttToday(){
  _attendanceDate=toDateStr(getToday());
  document.getElementById('att-date-input').value=_attendanceDate;
  _attBatchTargets.clear();
  _updateAttBatchUi();
  buildTable();
  _updateAttBarInfo();
}

function _updateAttBarInfo(){
  if(!_attendanceMode||!_attendanceDate) return;
  // 선택 주의 월요일~토요일 계산
  const weekMon=_getWeekMon(_attendanceDate);
  const satDate=new Date(weekMon);
  satDate.setDate(satDate.getDate()+5);
  const monStr=toDateStr(weekMon), satStr=toDateStr(satDate);
  const [,mm1,dd1]=monStr.split('-');
  const [,mm2,dd2]=satStr.split('-');
  const label=`📅 ${parseInt(mm1)}/${parseInt(dd1)} ~ ${parseInt(mm2)}/${parseInt(dd2)}`;
  const labelEl=document.getElementById('att-bar-date-label');
  if(labelEl) labelEl.textContent=label;

  // 통계: 주간 전체
  let total=0,present=0,absent=0;
  (DAYS||[]).forEach(day=>{
    const cellDs=_dayToCellDs(day);
    if(!cellDs) return;
    const data=(typeof getAttendanceBasisDataForDate==='function')?getAttendanceBasisDataForDate(cellDs):null;
    const list=data?.students||STUDENTS;
    (list||[]).forEach(stu=>{
      if(!stu||stu.d!==day) return;
      total++;
      const slotKey=stu.t+'/'+stu.d+'/'+stu.l+'/'+stu.r;
      const att=ATTENDANCE[slotKey+'/'+cellDs];
      const v=att?(typeof att==='string'?att:att.s):null;
      if(v==='present') present++;
      else if(v==='absent') absent++;
    });
  });
  Object.entries(ATT_GUESTS||{}).forEach(([guestKey,list])=>{
    const parts=guestKey.split('/');
    const ds=parts[3];
    if(!ds || ds<monStr || ds>satStr) return;
    (list||[]).forEach(g=>{
      if(!g) return;
      total++;
      if(g.s==='present') present++;
      else if(g.s==='absent') absent++;
    });
  });
  const statsEl=document.getElementById('att-bar-stats');
  if(statsEl) statsEl.innerHTML=`👥 ${total}명 · ✅ ${present} · ❌ ${absent} · ⚪ ${total-present-absent}`;
}

// 선택 주의 월요일 Date 객체
function _getWeekMon(ds){
  const [y,m,d]=ds.split('-');
  const date=new Date(parseInt(y), parseInt(m)-1, parseInt(d));
  const dow=date.getDay();
  const off=dow===0?-6:1-dow;
  date.setDate(date.getDate()+off);
  return date;
}

// 요일 → 선택 주의 해당 날짜 (YYYY-MM-DD)
function _dayToCellDs(day){
  if(typeof getDateForDayInWeek==='function'){
    return toDateStr(getDateForDayInWeek(day,_attendanceDate));
  }
  const dayOff={'월':0,'화':1,'수':2,'목':3,'금':4,'토':5,'일':6};
  const mon=_getWeekMon(_attendanceDate);
  const d=new Date(mon);
  d.setDate(d.getDate()+(dayOff[day]||0));
  return toDateStr(d);
}

// 출석 셀 클릭 (순환 토글)
async function _cycleAttendance(slotKey){
  if(!_attendanceDate) return;
  const key=slotKey+'/'+_attendanceDate;
  try{
    await updateAttendanceMapTx(att=>{
      const cur=att[key];
      const curVal=cur?(typeof cur==='string'?cur:cur.s):null;
      let next;
      if(!curVal) next='present';
      else if(curVal==='present') next='absent';
      else next=null;
      if(next===null) delete att[key];
      else att[key]={s:next, at:new Date().toISOString(), by:null};
      return att;
    });
    buildTable();
    _updateAttBarInfo();
  }catch(e){
    toast('출석 저장 실패','err');
    console.error(e);
  }
}

// Sub(보강/샘플 대체) 출석 체크
async function _cycleAttendanceSub(slotKey){
  if(!_attendanceDate) return;
  const key=slotKey+'/'+_attendanceDate+'#sub';
  try{
    await updateAttendanceMapTx(att=>{
      const cur=att[key];
      const curVal=cur?(typeof cur==='string'?cur:cur.s):null;
      let next;
      if(!curVal) next='present';
      else if(curVal==='present') next='absent';
      else next=null;
      if(next===null) delete att[key];
      else att[key]={s:next, at:new Date().toISOString(), by:null};
      return att;
    });
    buildTable();
    _updateAttBarInfo();
  }catch(e){
    toast('출석 저장 실패','err');
    console.error(e);
  }
}

// 출석 체크 모달
let _attModalCtx=null;  // {slotKey, isSub, stu, ds, isGuest?}
function _openAttModal(slotKey, isSub, stu, ds){
  const useDs=ds||_attendanceDate;
  _attModalCtx={slotKey, isSub, stu, ds:useDs, isGuest:!!stu.guest};
  const typeLabel=stu.type==='bogang'?' (보강)':
    stu.type==='sample'?' (샘플)':
    stu.type==='hyuwon'?' (휴원)':
    stu.guest?' (추가)':'';
  document.getElementById('att-modal-title').textContent=stu.n+(stu.a?'('+stu.a+')':'')+typeLabel;
  const [,m,d]=useDs.split('-');
  const [y,mm,dd]=useDs.split('-');
  const dateObj=new Date(parseInt(y), parseInt(mm)-1, parseInt(dd));
  const dow=['일','월','화','수','목','금','토'][dateObj.getDay()];
  document.getElementById('att-modal-sub').textContent=`${parseInt(m)}월 ${parseInt(d)}일 (${dow})`;
  document.getElementById('att-cell-modal').style.display='flex';
}
function _closeAttModal(){
  _attModalCtx=null;
  document.getElementById('att-cell-modal').style.display='none';
}
async function _setAttModal(value){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석 체크')) return;
  if(!_attModalCtx) return;
  try{
    const {slotKey, isSub, ds, stu, isGuest}=_attModalCtx;
    if(isGuest){
      await updateAttGuestsMapTx(guests=>{
        const key=stu.sgk;
        const list=[...(guests[key]||[])];
        const idx=list.findIndex(g=>g&&g.gid===stu.gid);
        if(idx<0) return guests;
        list[idx]={...list[idx], s:value===null?'':value, at:new Date().toISOString(), by:null};
        guests[key]=list;
        return guests;
      });
    } else {
      const key=slotKey+'/'+ds+(isSub?'#sub':'');
      await setAttendanceEntryTx(key,value===null?null:{s:value, at:new Date().toISOString(), by:null});
    }
    _closeAttModal();
    buildTable();
    _updateAttBarInfo();
  }catch(e){
    toast('출석 저장 실패','err');
    console.error(e);
  }
}

// 출석 모달에서 학생 삭제
async function _deleteFromAttModal(){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석부 학생 삭제')) return;
  if(!_attModalCtx) return;
  const {slotKey, isSub, ds, stu, isGuest}=_attModalCtx;
  if(!confirm('이 학생을 출석부에서 삭제하시겠습니까?')) return;

  try{
    if(isGuest){
      await updateAttGuestsMapTx(guests=>{
        const key=stu.sgk;
        const list=(guests[key]||[]).filter(g=>!(g&&g.gid===stu.gid));
        if(list.length) guests[key]=list;
        else delete guests[key];
        return guests;
      });
    } else {
      const key=slotKey+'/'+ds+(isSub?'#sub':'');
      await setAttendanceEntryTx(key,null);
    }

    toast(isGuest?'삭제 완료':'출석 체크 해제','ok');
    _closeAttModal();
    buildTable();
    _updateAttBarInfo();
  }catch(e){
    toast('삭제 실패','err');
    console.error(e);
  }
}

// 오늘 모두 출석
async function markAllPresentForDate(){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석 체크')) return;
  if(!_attendanceDate) return;
  const dow=['일','월','화','수','목','금','토'][new Date(_attendanceDate).getDay()];
  const now=new Date().toISOString();
  const basis=(typeof getAttendanceBasisDataForDate==='function')?getAttendanceBasisDataForDate(_attendanceDate):null;
  const studentsForDate=basis?_ctxStudents({attendanceBasisByDay:{[dow]:basis}},dow):STUDENTS;
  let cnt=0;
  try{
    await updateAttendanceMapTx(att=>{
      cnt=0;
      studentsForDate.forEach(stu=>{
        if(stu.d!==dow) return;
        const slotKey=stu.t+'/'+stu.d+'/'+stu.l+'/'+stu.r;
        const key=slotKey+'/'+_attendanceDate;
        const cur=att[key];
        const curVal=cur?(typeof cur==='string'?cur:cur.s):null;
        if(!curVal){
          att[key]={s:'present', at:now, by:null};
          cnt++;
        }
      });
      return att;
    });
    if(cnt===0){toast('체크할 학생이 없습니다','err');return;}
    buildTable();
    _updateAttBarInfo();
    toast(cnt+'명 출석 처리','ok');
  }catch(e){
    toast('출석 저장 실패','err');
    console.error(e);
  }
}

// 오늘 스냅샷 저장 (과거 날짜 동결용)
let _snapshotTimer=null;
function _ensureTodaySnapshot(){
  if(window.SCAuth && !SCAuth.can('editSchedule') && !SCAuth.can('attendanceCheck')) return;
  const today=toDateStr(getToday());
  if(_snapshotTimer) clearTimeout(_snapshotTimer);
  _snapshotTimer=setTimeout(()=>{
    const existing=DAY_SNAPSHOT[today];
    const nowStr=new Date().toISOString().slice(0,10);
    if(existing && existing.date===nowStr) return;
    DAY_SNAPSHOT[today]={
      date:nowStr,
      students:JSON.parse(JSON.stringify(STUDENTS)),
      inst:JSON.parse(JSON.stringify(INST_MAP)),
    };
    try{saveDaySnapshot();}catch(e){console.warn('snapshot save failed',e);}
  },500);
}

/* ════════════════════════════════════════════════════════════════
 * SECTION: 셀 툴팁 (마우스 hover)
 * ════════════════════════════════════════════════════════════════ */
let _tipTimer=null;
const _tip=document.getElementById('cell-tip');

function _showTip(el,html){
  _tip.innerHTML=html;
  _tip.style.left='-9999px';
  _tip.style.top='0';
  _tip.classList.add('show');
  const tw=_tip.offsetWidth, th=_tip.offsetHeight;
  const rect=el.getBoundingClientRect();
  let left=rect.right+6;
  let top=rect.top;
  if(left+tw>window.innerWidth) left=rect.left-tw-6;
  if(left<0) left=4;
  if(top+th>window.innerHeight) top=window.innerHeight-th-4;
  if(top<0) top=4;
  _tip.style.left=left+'px';
  _tip.style.top=top+'px';
}

document.addEventListener('mouseover',function(e){
  // 출석 모드면 툴팁 비활성화 (별개 데이터 뷰)
  if(_attendanceMode){ clearTimeout(_tipTimer); _tip.classList.remove('show'); return; }
  // 팝업 열려있으면 툴팁 안 보임
  if(document.getElementById('stu-popup').classList.contains('show')) return;
  if(document.getElementById('inst-popup').classList.contains('show')) return;

  // 대기자 뱃지 툴팁 (즉시)
  const rBadge=e.target.closest('.inst-reserve-badge');
  if(rBadge&&rBadge.dataset.reserveTip){
    clearTimeout(_tipTimer);
    _showTip(rBadge,`<div class="cell-tip-row" style="font-weight:700">대기자</div><div class="cell-tip-row">${rBadge.dataset.reserveTip}</div>`);
    return;
  }

  // 뱃지 툴팁 (즉시)
  const badge=e.target.closest('.cb');
  if(badge&&badge.dataset.tip){
    clearTimeout(_tipTimer);
    _showTip(badge,`<div class="cell-tip-row" style="font-weight:700">${badge.dataset.tip}</div>`);
    return;
  }

  // 셀 툴팁 (딜레이)
  const cell=e.target.closest('.stu-clickable');
  if(!cell) return;

  clearTimeout(_tipTimer);
  _tipTimer=setTimeout(()=>{
    const t=cell.dataset.t, day=cell.dataset.day;
    const lane=parseInt(cell.dataset.lane), ri=parseInt(cell.dataset.ri);
    let stu=getStu(t,day,lane,ri);
    if(_attendanceMode&&_attendanceDate&&typeof getAttendanceBasisDataForDate==='function'){
      const cellDs=_dayToCellDs(day);
      const basis=getAttendanceBasisDataForDate(cellDs);
      stu=basis?.stuIdx?.[t+'/'+day+'/'+lane+'/'+ri]||null;
    }
    if(!stu) return;

    let html=`<div class="cell-tip-name">${esc(stu.n)}${stu.a?'('+stu.a+')':''}${stu.g==='m'?' 👦':stu.g==='f'?' 👧':''}</div>`;
    if(stu.p) html+=`<div class="cell-tip-row"><b>📞</b> ${esc(stu.p)}</div>`;
    const nl2br = s => esc(s).replace(/\n/g,'<br>');
    const tipVehicle=stu.v||_tableLocUsesVehicle(stu.loc);
    if(tipVehicle) html+=`<div class="cell-tip-row"><b>🚐</b> ${stu.loc?nl2br(stu.loc):'차량 이용'}</div>`;
    if(stu.memo) html+=`<div class="cell-tip-row"><b>📝</b> ${nl2br(stu.memo)}</div>`;

    if(!stu.p&&!tipVehicle&&!stu.memo&&!stu.g) return;
    _showTip(cell,html);
  },400);
});

document.addEventListener('mouseout',function(e){
  if(e.target.closest('.stu-clickable')||e.target.closest('.cb')||e.target.closest('.inst-reserve-badge')){
    clearTimeout(_tipTimer);
    _tip.classList.remove('show');
  }
});

/* ════════════════════════════════════════════════════════════════
 * SECTION: 테이블 빌드 (buildTable ~350줄, 분할 대상)
 * ════════════════════════════════════════════════════════════════ */
/**
 * buildTable() 호출 직전 데이터 동기화
 * - 퇴원일 지난 학생 자동 삭제 (RETIRE_MAP은 유지)
 * - 등원일 된 학생 자동 등록 (ENROLL_MAP은 유지)
 * - 앱바 타이틀 갱신
 * - 만료된 isNew/enrolled 플래그 정리
 */
function syncStudentsBeforeRender(){
  // [v118] 타임머신 모드에서도 sync는 실행 (ENROLL_MAP→STUDENTS 옮겨야 미래 학생이 보임).
  //   영구 저장은 saveJSON 타임머신 가드로 차단됨.
  //   buildTable 끝에서 메모리 복원되므로 일반 모드 데이터 손상 X.
  let changed=false;
  let enrollChanged=false;
  let retireChanged=false;
  let hyuwonChanged=false;
  const todayStr=toDateStr(getToday());

  // 퇴원일 지난 학생 자동 삭제
  for(const [slotKey,entry] of Object.entries(RETIRE_MAP)){
    const retDs=entry?.ds||entry; // backward compat
    if(retDs<todayStr){
      const [t,d,l,r]=slotKey.split('/');
      const idx=STUDENTS.findIndex(s=>s.t===t&&s.d===d&&s.l===parseInt(l)&&s.r===parseInt(r));
      if(idx>=0){STUDENTS.splice(idx,1);changed=true;}
      delete _stuIdx[slotKey];

      // 같은 슬롯의 등원 항목이 퇴원일보다 이전이면(소비된 과거 등원) 같이 삭제
      // → 다음 enroll 패스에서 학생이 재등록되는 버그 방지
      const enr=ENROLL_MAP[slotKey];
      if(enr && enr.ds < retDs){
        delete ENROLL_MAP[slotKey];
        enrollChanged=true;
      }

      // [FIX #15] 퇴원 항목 소비 → 삭제 (재처리 방지).
      //  이전엔 RETIRE_MAP 항목이 영구히 남아, 같은 슬롯에 새 학생이 들어오면
      //  (등원 패스로 push되든 사용자가 직접 등록하든) 다음 render에서 슬롯키만 보고
      //  그 새 학생까지 splice해서 죽이는 race가 있었음.
      //  특히 "4/20 퇴원 + 4/27 신규 등원" 시나리오에서 4/27에 등원이 사라짐.
      delete RETIRE_MAP[slotKey];
      retireChanged=true;
      // 퇴원한 슬롯의 휴원도 정리 (orphan 방지 — 빈 셀에 휴원 뱃지 안 남음)
      if(HYUWON_MAP[slotKey]){
        delete HYUWON_MAP[slotKey];
        hyuwonChanged=true;
      }
    }
  }

  // 등원일 된 학생 자동 등록
  for(const [slotKey,entry] of Object.entries(ENROLL_MAP)){
    if(entry.ds<=todayStr){
      const [t,d,l,r]=slotKey.split('/');
      const li=parseInt(l),ri=parseInt(r);
      const existing=getStu(t,d,li,ri);
      if(!existing){
        const obj={n:entry.name,a:entry.age||null,t,d,l:li,r:ri};
        if(entry.p) obj.p=entry.p;
        if(entry.isNew) obj.isNew=entry.isNew;
        else if(entry.reenroll) obj.reenroll=entry.reenroll;
        else if(entry.enrolled){
          obj.enrolled=entry.ds;
        }
        // [v99] 등원 예약 시 입력한 차량/승하차/메모 적용
        if(entry.v) obj.v=true;
        if(entry.loc) obj.loc=entry.loc;
        if(entry.memo) obj.memo=entry.memo;
        // [v100] 성별도 적용
        if(entry.g) obj.g=entry.g;
        STUDENTS.push(obj);
        _stuIdx[slotKey]=obj;
        changed=true;
        // 등원 항목 소비 → 삭제 (재등록 방지)
        delete ENROLL_MAP[slotKey];
        enrollChanged=true;
      } else if(existing.n===entry.name){
        // 이미 등록된 같은 이름 → 과거 잔여 항목 정리
        delete ENROLL_MAP[slotKey];
        enrollChanged=true;
      }
    }
  }

  // 앱바 타이틀 업데이트
  const cp=SCHEDULE_PERIODS[getCurrentPeriod()];
  const yr=cp.start.split('-')[0];
  document.getElementById('app-period').textContent=yr+'년 '+cp.month+'월';

  // 만료된 신규/등원 플래그 정리
  // [FIX] 이전엔 in-memory만 mutate하고 저장하지 않아 새로고침/다른 디바이스에서 플래그가 부활했음.
  let flagChanged=false;
  STUDENTS.forEach(s=>{
    if(s.isNew&&s.isNew!==cp.month){ delete s.isNew; flagChanged=true; }
    if(s.reenroll&&s.reenroll!==cp.month){ delete s.reenroll; flagChanged=true; }
    if(s.enrolled&&s.enrolled<todayStr){ delete s.enrolled; flagChanged=true; }
  });
  if(changed||enrollChanged||retireChanged||hyuwonChanged||flagChanged){
    const periodMonth=cp.month;
    const stuKey=getTabConfig().stuKey;
    updateScheduleTx([stuKey,STORAGE_KEYS.ENROLL,STORAGE_KEYS.RETIRE,STORAGE_KEYS.休원], ctx=>{
      const students=ctx.get(stuKey,[]);
      const enroll=ctx.get(STORAGE_KEYS.ENROLL,{});
      const retire=ctx.get(STORAGE_KEYS.RETIRE,{});
      const hyuwon=ctx.get(STORAGE_KEYS.休원,{});
      let txStudentsChanged=false;
      let txEnrollChanged=false;
      let txRetireChanged=false;
      let txHyuwonChanged=false;

      const slotMatch=(s,slotKey)=>{
        const [t,d,l,r]=slotKey.split('/');
        return s.t===t&&s.d===d&&parseInt(s.l)===parseInt(l)&&parseInt(s.r)===parseInt(r);
      };

      for(const [slotKey,entry] of Object.entries(retire)){
        const retDs=entry?.ds||entry;
        if(retDs<todayStr){
          const idx=students.findIndex(s=>slotMatch(s,slotKey));
          if(idx>=0){students.splice(idx,1);txStudentsChanged=true;}
          const enr=enroll[slotKey];
          if(enr&&enr.ds<retDs){delete enroll[slotKey];txEnrollChanged=true;}
          delete retire[slotKey];
          txRetireChanged=true;
          if(hyuwon[slotKey]){delete hyuwon[slotKey];txHyuwonChanged=true;}
        }
      }

      for(const [slotKey,entry] of Object.entries(enroll)){
        if(entry.ds<=todayStr){
          const [t,d,l,r]=slotKey.split('/');
          const li=parseInt(l),ri=parseInt(r);
          const existing=students.find(s=>slotMatch(s,slotKey));
          if(!existing){
            const obj={n:entry.name,a:entry.age||null,t,d,l:li,r:ri};
            if(entry.p) obj.p=entry.p;
            if(entry.isNew) obj.isNew=entry.isNew;
            else if(entry.reenroll) obj.reenroll=entry.reenroll;
            else if(entry.enrolled) obj.enrolled=entry.ds;
            if(entry.v) obj.v=true;
            if(entry.loc) obj.loc=entry.loc;
            if(entry.memo) obj.memo=entry.memo;
            if(entry.g) obj.g=entry.g;
            students.push(obj);
            txStudentsChanged=true;
            delete enroll[slotKey];
            txEnrollChanged=true;
          } else if(existing.n===entry.name){
            delete enroll[slotKey];
            txEnrollChanged=true;
          }
        }
      }

      students.forEach(s=>{
        if(s.isNew&&s.isNew!==periodMonth){delete s.isNew;txStudentsChanged=true;}
        if(s.reenroll&&s.reenroll!==periodMonth){delete s.reenroll;txStudentsChanged=true;}
        if(s.enrolled&&s.enrolled<todayStr){delete s.enrolled;txStudentsChanged=true;}
      });

      if(txStudentsChanged) ctx.set(stuKey,students);
      if(txEnrollChanged) ctx.set(STORAGE_KEYS.ENROLL,enroll);
      if(txRetireChanged) ctx.set(STORAGE_KEYS.RETIRE,retire);
      if(txHyuwonChanged) ctx.set(STORAGE_KEYS.休원,hyuwon);
      return true;
    }).catch(e=>{console.error('syncStudentsBeforeRender transaction failed',e);});
  }
}

/**
 * <colgroup> 빌드: 요일별로 [시간열, (번호열?), 레인열×N]
 */
function buildColgroup(DAYS, HAS_NUM, LANE_COUNT){
  const colgroup=document.createElement('colgroup');
  // [v118] CSS 변수로 동적 줌 적용
  DAYS.forEach(day=>{
    const hasNum=HAS_NUM.includes(day);
    colgroup.appendChild(Object.assign(document.createElement('col'),{style:'width:var(--w-time-col)'}));
    if(hasNum) colgroup.appendChild(Object.assign(document.createElement('col'),{style:'width:var(--w-num-col)'}));
    for(let i=0;i<LANE_COUNT;i++) colgroup.appendChild(Object.assign(document.createElement('col'),{style:'width:var(--w-cell)'}));
  });
  return colgroup;
}

/**
 * <thead> 빌드: 2행 (날짜 헤더 + 레인 헤더)
 */
function buildThead(DAYS, HAS_NUM, LANE_COUNT, DATE_HDR){
  const thead=document.createElement('thead');
  const todayDs=toDateStr(getToday());

  // r1: 요일/날짜 헤더
  const r1=document.createElement('tr');r1.className='day-hdr-row';
  DAYS.forEach((day,di)=>{
    const th=document.createElement('th');
    th.colSpan=HAS_NUM.includes(day)?LANE_COUNT+2:LANE_COUNT+1;
    th.className='dh'+(day==='토'?' dh-sat':'')+(di<DAYS.length-1?(' day-sep'+(_isTodayDay(day)?' day-sep-today':'')):'');
    th.style.textAlign='center';
    const hdr=DATE_HDR[day];
    if(hdr.ds===todayDs) th.classList.add('dh-today');
    if(hdr.closedLabel){
      th.classList.add('dh-closed');
      th.innerHTML=`<span class="dh-closed-tag">${esc(hdr.closedLabel)}</span>${esc(hdr.label)}`;
    } else {
      th.textContent=hdr.label;
    }
    r1.appendChild(th);
  });
  thead.appendChild(r1);

  // r2: 시간/번/레인 헤더
  const r2=document.createElement('tr');r2.className='lh-row';
  DAYS.forEach((day,di)=>{
    const hasNum=HAS_NUM.includes(day);
    const thT=document.createElement('th');thT.className='col-time-day-hdr';thT.textContent='시간';r2.appendChild(thT);
    if(hasNum){const thN=document.createElement('th');thN.className='col-num-day-hdr';thN.textContent='번';r2.appendChild(thN);}
    for(let li=0;li<LANE_COUNT;li++){
      const th=document.createElement('th');th.className='lh dc';
      if(li===LANE_COUNT-1&&di<DAYS.length-1){ th.classList.add('day-sep'); if(_isTodayDay(day)) th.classList.add('day-sep-today'); }
      th.textContent=`${li+1}레인`;r2.appendChild(th);
    }
  });
  thead.appendChild(r2);
  return thead;
}

/**
 * 담임 행(instRow) 빌드: 한 시간대의 담임 정보 표시
 * - 시간 셀(rowspan), 담임 라벨(번호열), 레인별 담임 셀
 * - 엘마반 인접 합치기 처리
 */
function buildInstRow(t, rows, hasSat, DAYS, HAS_NUM, LANE_COUNT, SAT_TIME_LABEL, ctx){
  const instRow=document.createElement('tr');
  instRow.className='inst-hdr-row';

  DAYS.forEach((day,di)=>{
    const hasNum=HAS_NUM.includes(day);
    const isSat=day==='토';
    const satEmpty=isSat&&!hasSat;
    const dayInstMap=_ctxInstMap(ctx,day);
    const kimhs=getElmaLanes(t,day,dayInstMap);

    // 시간 셀 (rowspan으로 학생 행까지 덮음)
    const tdT=document.createElement('td');
    tdT.rowSpan=1+rows;
    tdT.className='col-time-day';
    if(satEmpty){tdT.textContent='';tdT.classList.add('cell-blocked');}
    else if(isSat){tdT.textContent=SAT_TIME_LABEL[t];}
    else{tdT.textContent=t;}
    instRow.appendChild(tdT);

    // 번호 열 라벨 ("담임")
    if(hasNum){
      const tdN=document.createElement('td');
      tdN.className='col-num-day inst-lbl';
      if(satEmpty){tdN.textContent='';tdN.classList.add('cell-blocked');}
      else{tdN.textContent='담임';}
      instRow.appendChild(tdN);
    }

    // 레인별 담임 셀
    let li=0;
    while(li<LANE_COUNT){
      const td=document.createElement('td');

      if(satEmpty){
        td.className='dc cell-blocked';
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        instRow.appendChild(td);
        li++;
        continue;
      }

      const inst=_ctxInst(ctx,t,day,li+1);
      const pairStart=getElmaPairStart(kimhs,li);
      const pairEnd=getElmaPairEnd(kimhs,li);
      const isElma=isElmaLane(kimhs,li);
      const _lane=li+1;

      // 출석 모드 + 이 요일에 해당하는 + 버튼을 inst 셀에 추가하는 헬퍼
      const _addAttPlusBtn=(td, laneNum)=>{
        if(!_attendanceMode || !_attendanceDate) return;
        if(window.SCAuth && !SCAuth.can('attendanceCheck')) return;
        const cellDs=_dayToCellDs(day);
        const btn=document.createElement('span');
        btn.className='att-add-inst';
        btn.textContent='＋';
        btn.title='원생 추가';
        btn.addEventListener('click',function(e){
          e.stopPropagation();
          _openAttAddModalForLane(t, day, laneNum, cellDs);
        });
        td.appendChild(btn);
      };

      if(pairStart){
        // 인접 엘마/엘리트/마스터 쌍 시작 → 합치기 (colspan=2)
        td.colSpan=2;
        const elmaInst=inst||_ctxInst(ctx,t,day,li+2);
        // [v117] 선생님 색상 클래스 추가 (지정되어 있으면 디폴트 보라 대신 선생님 색상 사용)
        const _tCls=elmaInst?teacherCssClass(elmaInst.n):'';
        td.className='dc inst-cell-kimhs inst-clickable'+(_tCls?' '+_tCls:'');
        if(pairStart[1]>=4&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        const iKey=t+'/'+day+'/'+(li+1);
        // [v117] cls(엘/마/엘리트/마스터)에 따라 라벨 동적
        const _cls=getInstCls(elmaInst);
        const _lbl=getInstClsLabel(_cls)||'(엘/마)';
        const _lblTextOnly=_lbl.replace(/[()]/g,'');
        td.innerHTML=instCellHTML(elmaInst?(elmaInst.n+_lbl):_lblTextOnly,iKey);
        td.style.fontWeight='700';td.style.fontSize='11px';
        td.addEventListener('click',function(){if(_attendanceMode) return; openInstPopup(this,t,day,_lane);});
        _addAttPlusBtn(td, _lane);
        instRow.appendChild(td);
        li+=2;
      } else if(pairEnd){
        // 인접 엘마 쌍의 두번째 → 이미 합쳐짐, 스킵
        li++;
      } else if(isElma){
        // 단독 엘마/엘리트/마스터 (합치기 없음)
        // [v117] 선생님 색상 클래스 추가
        const _tCls=inst?teacherCssClass(inst.n):'';
        td.className='dc inst-cell-kimhs inst-clickable'+(_tCls?' '+_tCls:'');
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        const iKey=t+'/'+day+'/'+(li+1);
        // [v117] cls(엘/마/엘리트/마스터)에 따라 라벨 동적
        const _cls=getInstCls(inst);
        const _lbl=getInstClsLabel(_cls)||'(엘/마)';
        const _lblTextOnly=_lbl.replace(/[()]/g,'');
        td.innerHTML=instCellHTML(inst?(inst.n+_lbl):_lblTextOnly,iKey);
        td.style.fontWeight='700';td.style.fontSize='11px';
        td.addEventListener('click',function(){if(_attendanceMode) return; openInstPopup(this,t,day,_lane);});
        _addAttPlusBtn(td, _lane);
        instRow.appendChild(td);
        li++;
      } else {
        // 일반 담임 셀
        td.className='dc '+instClass(inst)+' inst-clickable';
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        const iKey=t+'/'+day+'/'+(li+1);
        td.innerHTML=instCellHTML(instDisplay(inst),iKey);
        td.style.fontWeight='700';td.style.fontSize='11px';
        td.addEventListener('click',function(){if(_attendanceMode) return; openInstPopup(this,t,day,_lane);});
        if(inst && inst.n){
          _addAttPlusBtn(td, _lane);  // 담임 있을 때만
        }
        instRow.appendChild(td);
        li++;
      }
    }
  });

  return instRow;
}

/**
 * 학생 행(stuRow) 빌드: 한 시간대 한 줄(번호 ri)
 * - 4가지 셀 상태: satEmpty / satSkip(or dayBlocked) / disabled / 일반
 * - 일반 셀: 학생 + 뱃지(퇴원/등원/결석/보강/샘플) + 클래스(신규/등원/차량/보강전용)
 *
 * ctx: { DAYS, HAS_NUM, LANE_COUNT, DATE_HDR, classDatesCache, namePrefix, todayStr }
 */
function buildStuRow(t, ri, rows, hasSat, ctx){
  const {DAYS, HAS_NUM, LANE_COUNT, DATE_HDR, classDatesCache, namePrefix, todayStr} = ctx;
  const stuRow=document.createElement('tr');
  const isBangteukTable=typeof isBangteuk==='function'&&isBangteuk();
  const baseSlotRows=isBangteukTable?6:5;
  // 정규 5행(ri 0~4) 이후는 반칸 높이 (추가 학생용)
  // 단, 엘마 시간대는 6~8행도 엘마반 정규 자리이므로 풀 높이 유지
  if(ri>=baseSlotRows && !hasElmaInTime(t)) stuRow.classList.add('half-row');
  const curMonth=SCHEDULE_PERIODS[getCurrentPeriod()].month;

  const slotHasStoredContent=(day,lane,row)=>{
    const slotKey=t+'/'+day+'/'+lane+'/'+row;
    if(_ctxStu(ctx,t,day,lane,row)) return true;
    if(RETIRE_MAP[slotKey]||ENROLL_MAP[slotKey]||DISABLED_MAP[slotKey]||HYUWON_MAP[slotKey]) return true;
    if(_attendanceMode && _attendanceDate){
      const ds=_dayToCellDs(day);
      if(ds && _attGuestAtSlot(t,day,lane,slotKey,ds)) return true;
    }
    const markPrefix=slotKey+'/';
    return Object.keys(MARK_MAP||{}).some(k=>k.startsWith(markPrefix));
  };
  const rowHasStoredContent=(day,row)=>{
    for(let lane=1;lane<=LANE_COUNT;lane++){
      if(slotHasStoredContent(day,lane,row)) return true;
    }
    return false;
  };

  DAYS.forEach((day,di)=>{
    const hasNum=HAS_NUM.includes(day);
    const isSat=day==='토';
    const satEmpty=isSat&&!hasSat;
    const dayInstMap=_ctxInstMap(ctx,day);
    const kimhs=getElmaLanes(t,day,dayInstMap);
    const rowHasContent=rowHasStoredContent(day,ri+1);
    const satSkip=isSat&&!satEmpty&&rows>5&&!kimhs&&ri>=5&&!rowHasContent;
    const dayBlocked=!satSkip&&rows>baseSlotRows&&!kimhs&&ri>=baseSlotRows&&!rowHasContent;

    // 번호 셀
    if(hasNum){
      const tdNn=document.createElement('td');
      tdNn.className='col-num-day';
      if(satEmpty||satSkip||dayBlocked){tdNn.textContent='';tdNn.classList.add('cell-blocked');}
      else{tdNn.textContent=ri+1;}
      stuRow.appendChild(tdNn);
    }

    // 토요일 5행 초과 → 전체 막기
    if(satSkip){
      for(let li=0;li<LANE_COUNT;li++){
        const td=document.createElement('td');
        td.className='dc cell-blocked';
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        stuRow.appendChild(td);
      }
      return;
    }

    // 레인별 셀
    for(let li=0;li<LANE_COUNT;li++){
      const td=document.createElement('td');

      // 케이스 1: 토요일 시간 자체가 비어있음
      if(satEmpty){
        td.className='dc cell-blocked';
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        stuRow.appendChild(td);
        continue;
      }

      const isElma=isElmaLane(kimhs,li);
      const _l=li+1, _r=ri+1;
      const slotKey=t+'/'+day+'/'+_l+'/'+_r;
      // 일반 레인 5행 초과는 기본적으로 blocked
      // 단, 실제 저장 데이터가 있는 칸은 6~8번이어도 가리지 않는다.
      let isBlocked=rows>baseSlotRows&&!isElma&&ri>=baseSlotRows&&!slotHasStoredContent(day,_l,_r);
      if(isBlocked && _attendanceMode && _attendanceDate){
        const _cellDsChk=_dayToCellDs(day);
        const _hasContent=MARK_MAP[slotKey+'/'+_cellDsChk]
          || _attGuestAtSlot(t,day,_l,slotKey,_cellDsChk)
          || _ctxStudents(ctx,day).some(s=>s.t===t&&s.d===day&&s.l===_l&&s.r===_r);
        if(_hasContent) isBlocked=false;
      }

      // 케이스 2: 평일 5행 초과 (엘마 제외)
      if(isBlocked){
        td.className='dc cell-blocked';
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        stuRow.appendChild(td);
        continue;
      }

      // 케이스 3: 비활성화된 빈 셀 (회색이지만 클릭 가능)
      if(isDisabled(slotKey)&&!_ctxStu(ctx,t,day,_l,_r)){
        td.className='dc cell-blocked stu-clickable';
        td.style.cursor='pointer';
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        td.dataset.t=t;td.dataset.day=day;td.dataset.lane=_l;td.dataset.ri=_r;
        td.addEventListener('click',function(){openStuPopup(this,t,day,_l,_r);});
        stuRow.appendChild(td);
        continue;
      }

      // 케이스 4: 일반 학생 셀 ─────────────────────────────
      const stu=_ctxStu(ctx,t,day,_l,_r);

      td.className='stu-cell dc stu-clickable';
      // 출석 모드 상태 판단 (특수 배경 클래스 분기에 필요)
      const _attIsActive=_attendanceMode && _attendanceDate;
      // 출석 모드면 특수 배경/마크 클래스 적용 안 함 (흰 배경 유지)
      if(!_attIsActive){
        const stuVehicle=stu&&(stu.v||_tableLocUsesVehicle(stu.loc));
        if(stuVehicle) td.classList.add('stu-vehicle');
        if(stu&&stu.isNew&&stu.isNew===curMonth) td.classList.add('stu-new');
        if(stu&&(stu.memo||stuVehicle||stu.p||stu.g)) td.classList.add('stu-has-note');
      }
      if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
      td.dataset.t=t;td.dataset.day=day;td.dataset.lane=_l;td.dataset.ri=_r;
      // 출석 모드에서는 각 요일 셀이 해당 주의 그 날짜로 작동 (모든 요일 활성)
      const _attDayMatch=_attIsActive;
      const _cellDs=_attIsActive?_dayToCellDs(day):null;

      // 출석 모드 + 해당 요일이 휴관일이면 흐림 처리
      let _attDayClosed=false;
      if(_attIsActive){
        const _hdr=DATE_HDR?.[day];
        if(_hdr && _hdr.closedLabel){
          td.classList.add('att-closed-col');
          _attDayClosed=true;
        }
      }

      // 출석 모드 + 해당 요일 → 정규/보강/샘플/결석/휴원 혼합 상태 계산 (cellDs 기준)
      let _attPrimary=null, _attSub=null;
      if(_attDayMatch && !_attDayClosed){
        const _mark=MARK_MAP[slotKey+'/'+_cellDs];
        const _hy=HYUWON_MAP[slotKey];
        const _isHy=!!(_hy && _hy.dates && _hy.dates.includes(_cellDs));
        if(stu){
          _attPrimary={type:'regular', n:stu.n, a:stu.a, hyuwon:_isHy};
        }
        if(_mark){
          if(_mark.type==='absent'){
            if(_attPrimary) _attPrimary.absent=true;
            if(_mark.sub){
              _attSub={type:_mark.sub.type, n:_mark.sub.n, a:_mark.sub.a};
            }
          } else if(_mark.type==='bogang'||_mark.type==='sample'){
            if(_attPrimary){
              // 원생이 있으면 보강/샘플은 sub로 추가 표시
              _attSub={type:_mark.type, n:_mark.n, a:_mark.a};
            } else {
              // 원생 없으면 보강/샘플을 primary로
              _attPrimary={type:_mark.type, n:_mark.n, a:_mark.a};
            }
          }
        }
        const _guests=_attGuestsForSlot(t,day,_l,slotKey,_cellDs);
        _guests.forEach(g=>{
          const _guest=_attGuestDisplay(g,t,day,_l,slotKey,_cellDs);
          if(!_guest) return;
          if(!_attPrimary) _attPrimary=_guest;
          else if(!_attSub) _attSub=_guest;
        });
      }

      // 클릭 핸들러
      if(_attDayMatch){
        const cellDsCaptured=_cellDs;
        td.addEventListener('click',function(e){
          // 편집 모드면 셀 편집 (출석 모달 대신)
          if(_attEditMode){
            e.stopPropagation();
            _editAttCell(slotKey, cellDsCaptured);
            return;
          }
          if(_attDayClosed) return;
          if(_attBatchMode){
            const batchRowEl=e.target.closest('[data-pk]');
            let target=null;
            if(batchRowEl){
              const pk=batchRowEl.dataset.pk;
              if(pk==='sub' && _attSub) target=_attTargetFromItem(slotKey,true,_attSub,cellDsCaptured);
              else if(pk==='primary' && _attPrimary) target=_attTargetFromItem(slotKey,false,_attPrimary,cellDsCaptured);
            } else if(_attPrimary && !_attPrimary.hyuwon){
              target=_attTargetFromItem(slotKey,false,_attPrimary,cellDsCaptured);
            } else if(_attSub){
              target=_attTargetFromItem(slotKey,true,_attSub,cellDsCaptured);
            }
            e.stopPropagation();
            if(_toggleAttBatchTarget(target)) buildTable();
            else toast('선택할 원생이 없습니다','err');
            return;
          }
          // 2칸 분할: row 내부 data-pk로 분기
          const rowEl=e.target.closest('[data-pk]');
          if(rowEl){
            const pk=rowEl.dataset.pk;
            e.stopPropagation();
            if(pk==='sub' && _attSub){
              _openAttModal(slotKey, true, _attSub, cellDsCaptured);
            } else if(pk==='primary' && _attPrimary && !_attPrimary.hyuwon){
              _openAttModal(slotKey, false, _attPrimary, cellDsCaptured);
            }
            return;
          }
          // 단일 셀: primary 우선
          if(_attPrimary && !_attPrimary.hyuwon){
            e.stopPropagation();
            _openAttModal(slotKey, false, _attPrimary, cellDsCaptured);
          } else if(_attSub){
            e.stopPropagation();
            _openAttModal(slotKey, true, _attSub, cellDsCaptured);
          }
        });
      } else {
        td.addEventListener('click',function(){openStuPopup(this,t,day,_l,_r);});
      }

      // 등원(비신규) 빨간 배경 — 등원일까지만 (출석 모드에선 스킵)
      if(!_attIsActive && stu&&!td.classList.contains('stu-new')){
        if(stu.reenroll&&stu.reenroll===curMonth){
          td.classList.add('stu-enrolled');
        } else if(stu.enrolled&&stu.enrolled>=todayStr){
          td.classList.add('stu-enrolled');
        }
      }

      // ── 이벤트 수집 (그리드 뱃지) ──
      const classDates=classDatesCache[day];
      const allDates=[...classDates.cur,...classDates.next];
      const retEntry=RETIRE_MAP[slotKey];
      const retDs=retEntry?.ds||null;
      const enrEntry=ENROLL_MAP[slotKey];

      const badges=[];
      const _dl=ds=>{ const p=ds.slice(5).split('-'); return parseInt(p[0])+'/'+parseInt(p[1]); };

      // 출석 모드에서는 뱃지/마크 전부 숨김 (출석만 깔끔하게)
      const _skipBadges = _attendanceMode;

      // 휴원
      const hyuwon=HYUWON_MAP[slotKey];
      if(!_skipBadges && hyuwon){
        // 신 형식(dates 배열)
        if(hyuwon.dates&&hyuwon.dates.length){
          const futureDates=hyuwon.dates.filter(d=>d>=todayStr).sort();
          if(futureDates.length){
            const first=futureDates[0];
            const last=futureDates[futureDates.length-1];
            const labels=futureDates.map(d=>_dl(d)).join(',');
            // [v118] 휴원은 최대 2주 → 1일이면 단일 날짜, 여러 일이면 시작~종료
            const text = futureDates.length===1
              ? '휴 '+_dl(first)
              : '휴 '+_dl(first)+'~'+_dl(last);
            badges.push({type:'hyuwon', ds:first, text, tip:'휴원 '+labels});
          }
        }
        // 구 형식(from/to) 호환
        else if(hyuwon.from&&hyuwon.to>=todayStr){
          const fl=_dl(hyuwon.from), tl=_dl(hyuwon.to);
          badges.push({type:'hyuwon', ds:hyuwon.from, text:'휴 '+fl+'~'+tl, tip:'휴원 '+fl+' ~ '+tl});
        }
      }
      // 퇴원
      if(!_skipBadges && retDs&&retDs>=todayStr){
        const dl=_dl(retDs), nm=_scheduleReservationName(retEntry,stu);
        const label=nm?nm+'~'+dl+'까지':dl+'까지';
        badges.push({type:'retire', ds:retDs, text:label, tip:'제외 '+label});
      }
      // 등원
      if(!_skipBadges && enrEntry&&enrEntry.ds>todayStr){
        const dl=_dl(enrEntry.ds), nm=_scheduleReservationName(enrEntry);
        const label=nm?nm+' '+dl+'부터~':dl+'부터~';
        badges.push({type:'enroll', ds:enrEntry.ds, text:label, tip:'등록 '+label});
      }
      // 결석/보강/샘플
      if(!_skipBadges) allDates.forEach(d=>{
        if(d.closed||d.ds<todayStr) return;
        const mark=getMark(slotKey,d.ds);
        if(!mark) return;
        const dl=_dl(d.ds);
        if(mark.type==='absent'){
          badges.push({type:'absent', ds:d.ds, text:dl, tip:'결석 '+dl});
          if(mark.sub){
            const nm=mark.sub.n||'';
            let stip=(mark.sub.type==='bogang'?'보강 ':'샘플 ')+nm+(mark.sub.a?' '+mark.sub.a:'')+' '+dl;
            if(mark.sub.p) stip+='<br>'+esc(mark.sub.p);
            if(mark.sub.memo) stip+='<br>'+esc(mark.sub.memo);
            badges.push({type:mark.sub.type, ds:d.ds, text:nm+' '+dl, tip:stip});
          }
        } else if(mark.type==='bogang'||mark.type==='sample'){
          const nm=mark.n||'';
          let mtip=(mark.type==='bogang'?'보강 ':'샘플 ')+nm+(mark.a?' '+mark.a:'')+' '+dl;
          if(mark.p) mtip+='<br>'+esc(mark.p);
          if(mark.memo) mtip+='<br>'+esc(mark.memo);
          badges.push({type:mark.type, ds:d.ds, text:nm+' '+dl, tip:mtip});
        }
      });

      // 학부모가 신청한 대기중 보강 요청 (도착지 셀)
      if(!_skipBadges) for(const req of Object.values(REQUESTS||{})){
        if(req.type!=='bogang') continue;
        if(req.status && req.status!=='pending') continue;
        const tg=req.target;
        if(!tg) continue;
        if(tg.t!==t||tg.d!==day||parseInt(tg.l)!==_l||parseInt(tg.r)!==_r) continue;
        if(tg.ds<todayStr) continue;
        const nm=req.parent?.name||'';
        const dl=_dl(tg.ds);
        let ptip='보강 신청 (승인 대기) '+nm+(req.parent?.age?'('+req.parent.age+')':'')+' '+dl;
        if(req.parent?.phone) ptip+='<br>'+esc(req.parent.phone);
        badges.push({type:'pending-bogang', ds:tg.ds, text:'⏳'+nm+' '+dl, tip:ptip});
      }
      // 대기중 결석 취소 요청 (자기 슬롯)
      if(!_skipBadges) for(const req of Object.values(REQUESTS||{})){
        if(req.type!=='absent-cancel') continue;
        if(req.status && req.status!=='pending') continue;
        const p=req.parent;
        if(!p) continue;
        if(p.studentSlotKey!==slotKey) continue;
        const tg=req.target;
        if(!tg||tg.ds<todayStr) continue;
        const nm=p.name||'';
        const dl=_dl(tg.ds);
        let ptip='결석 취소 신청 (승인 대기) '+nm+' '+dl;
        badges.push({type:'pending-cancel', ds:tg.ds, text:'⏳취소 '+dl, tip:ptip});
      }

      // 등원 대기 → 빨간 테두리 (출석 모드에선 숨김)
      if(!_skipBadges && enrEntry&&enrEntry.ds>todayStr) td.classList.add('stu-enroll-pending');
      // 대기중 요청 있으면 주황 테두리
      if(badges.some(b=>b.type==='pending-bogang'||b.type==='pending-cancel')){
        td.classList.add('stu-req-pending');
      }

      // 뱃지 HTML (당일~다음주 → 상단, 그 외 → 하단 2x2)
      badges.sort((a,b)=>a.ds<b.ds?-1:a.ds>b.ds?1:0);
      const nearDates=new Set(allDates.filter(d=>!d.closed&&d.ds>=todayStr).map(d=>d.ds));
      const topBadges=badges.filter(b=>nearDates.has(b.ds));
      const btmBadges=badges.filter(b=>!nearDates.has(b.ds)).slice(0,4);
      let badgeHtml='';
      if(topBadges.length){
        const t=topBadges[0];
        badgeHtml+=`<span class="cb cb-top cb-${t.type}" data-tip="${esc(t.tip)}">${t.text}</span>`;
        // 상단 나머지도 하단으로
        topBadges.slice(1).forEach(b=>{ if(btmBadges.length<4) btmBadges.push(b); });
        btmBadges.sort((a,b)=>a.ds<b.ds?-1:a.ds>b.ds?1:0);
      }
      if(btmBadges.length){
        const items=btmBadges.map(b=>`<span class="cb cb-${b.type}" data-tip="${esc(b.tip)}">${b.text}</span>`).join('');
        badgeHtml+=`<span class="cell-badges">${items}</span>`;
      }

      // 셀 내용 그리기
      if(_attDayMatch){
        // 출석 모드: primary/sub 혼합 렌더링
        if(!_attPrimary && !_attSub){
          td.classList.add('stu-empty');
        } else {
          const renderIcon=(s)=> s==='present'?'<span class="att-icon att-icon-p">✓</span>'
            :s==='absent'?'<span class="att-icon att-icon-a">✗</span>'
            :s==='hyuwon'?'<span class="att-icon att-icon-h">휴</span>'
            :'<span class="att-icon att-icon-u">○</span>';

          // Primary + Sub 둘 다 있으면 2칸 분할 렌더링
          if(_attPrimary && _attSub){
            td.classList.add('att-split');
            // Primary row 상태
            const ps=_attDisplayState(_attPrimary,slotKey,_cellDs,false);
            const primaryBg=_attDisplayBg(_attPrimary,ps);
            const primaryTag=_attDisplayTag(_attPrimary);
            const primarySelected=_attBatchTargets.has(_attTargetId(slotKey,false,_attPrimary,_cellDs));

            // Sub row 상태
            const ss=_attDisplayState(_attSub,slotKey,_cellDs,true);
            const subBg=_attDisplayBg(_attSub,ss);
            const subTag=_attDisplayTag(_attSub);
            const subSelected=_attBatchTargets.has(_attTargetId(slotKey,true,_attSub,_cellDs));

            td.innerHTML=
              `<div class="att-row att-row-primary ${primaryBg}${primarySelected?' att-selected-row':''}" data-pk="primary">`+
                renderIcon(ps)+`<span class="att-nm">${esc(_attPrimary.n)}${_attPrimary.a||''}${primaryTag}</span>`+
              `</div>`+
              `<div class="att-row att-row-sub ${subBg}${subSelected?' att-selected-row':''}" data-pk="sub">`+
                renderIcon(ss)+`<span class="att-nm">${esc(_attSub.n)}${_attSub.a||''}${subTag}</span>`+
              `</div>`;
          } else {
            // 단일 렌더링 (Primary 또는 Sub 중 하나만)
            let html='';
            if(_attPrimary){
              const s=_attDisplayState(_attPrimary,slotKey,_cellDs,false);
              td.classList.add(_attDisplayBg(_attPrimary,s));
              if(_attBatchTargets.has(_attTargetId(slotKey,false,_attPrimary,_cellDs))) td.classList.add('att-selected-cell');
              const typeTag=_attDisplayTag(_attPrimary);
              html+=renderIcon(s)+`<span class="att-nm">${esc(_attPrimary.n)}${_attPrimary.a||''}${typeTag}</span>`;
            }
            if(_attSub){
              const ss=_attDisplayState(_attSub,slotKey,_cellDs,true);
              const subTypeTag=_attSub.type==='bogang'?'보':_attSub.type==='sample'?'샘':_attSub.type==='hyuwon'?'휴':'';
              if(!_attPrimary && _attBatchTargets.has(_attTargetId(slotKey,true,_attSub,_cellDs))) td.classList.add('att-selected-cell');
              html+=` <span class="att-sub" data-pk="sub">[${renderIcon(ss)}${esc(_attSub.n)}${_attSub.a||''}${subTypeTag}]</span>`;
            }
            td.innerHTML=html;
          }
        }
      } else if(stu){
        const prefix=namePrefix[slotKey]||'';
        const display=(prefix?prefix+'.':'')+stu.n+(stu.a||'');
        let html=`<span class="stu-name-text">${esc(display)}</span>`;
        if(badgeHtml) html+=badgeHtml;
        td.innerHTML=html;
      } else {
        if(badgeHtml){
          let hasMark=false, allBogang=true;
          allDates.forEach(d=>{
            const mk=getMark(slotKey,d.ds);
            if(mk){hasMark=true; if(mk.type!=='bogang')allBogang=false;}
          });
          if(hasMark&&allBogang) td.classList.add('stu-bogang-only');
          td.innerHTML=badgeHtml;
        } else {
          td.classList.add('stu-empty');
          // 출석 편집 모드 + 다른 요일 빈 셀에도 + 추가 힌트
          if(_attIsActive && _attEditMode){
            td.innerHTML='<span style="color:#D1D5DB;font-size:10px">+ 추가</span>';
          }
        }
      }

      stuRow.appendChild(td);
    }
  });

  return stuRow;
}

function buildTable(){
  const DAYS=getDays(),TIMES=getTimes(),SAT_TIME_LABEL=getSatLabel(),HAS_NUM=getHasNum(),LANE_COUNT=getLanes();

  // [v118] 타임머신 모드: sync로 메모리 변경되더라도 buildTable 끝에 복원 → 영구 손상 X
  let _tmBackup = null;
  if(typeof _fakeDate !== 'undefined' && _fakeDate){
    _tmBackup = {
      stu: STUDENTS.slice(),
      stuIdx: Object.assign({}, _stuIdx),
      enroll: JSON.parse(JSON.stringify(ENROLL_MAP)),
      retire: JSON.parse(JSON.stringify(RETIRE_MAP)),
    };
  }

  syncStudentsBeforeRender();
  const todayStr=toDateStr(getToday());

  // 출석 모드 + 과거 주 → 해당 주의 스냅샷 사용
  // (주 내의 각 날짜 스냅샷을 찾고, 없으면 가장 가까운 과거 스냅샷 사용)
  let _snapshotSwapped=false;
  let _origStudentsCopy=null, _origInstCopy=null, _origStuIdxKeys=null;
  let _snapRef=null;
  if(_attendanceMode && _attendanceDate && typeof getAttendanceBasisDataForDate!=='function'){
    // 선택 주의 월요일~토요일 중 가장 최근 날짜의 스냅샷 찾기 (주 전체가 과거일 때)
    const weekMon=_getWeekMon(_attendanceDate);
    const sat=new Date(weekMon); sat.setDate(sat.getDate()+5);
    const satStr=toDateStr(sat);
    if(satStr<todayStr){  // 주 전체가 과거
      // 주 내의 모든 날짜의 스냅샷 중 하나 선택
      for(let off=5; off>=0; off--){
        const d=new Date(weekMon); d.setDate(d.getDate()+off);
        const dsStr=toDateStr(d);
        if(DAY_SNAPSHOT[dsStr] && DAY_SNAPSHOT[dsStr].students){
          _snapRef=DAY_SNAPSHOT[dsStr];
          break;
        }
      }
    }
  }
  if(_snapRef){
    const snap=_snapRef;
    if(snap.students && snap.inst){
      // STUDENTS/INST_MAP 내용 교체 (참조 유지)
      _origStudentsCopy=STUDENTS.slice();
      _origInstCopy=Object.assign({},INST_MAP);
      _origStuIdxKeys=Object.keys(_stuIdx);
      // 기존 clear
      STUDENTS.length=0;
      Object.keys(INST_MAP).forEach(k=>delete INST_MAP[k]);
      Object.keys(_stuIdx).forEach(k=>delete _stuIdx[k]);
      // 스냅샷 주입
      snap.students.forEach(s=>STUDENTS.push(s));
      Object.assign(INST_MAP, snap.inst);
      STUDENTS.forEach(s=>{_stuIdx[s.t+'/'+s.d+'/'+s.l+'/'+s.r]=s;});
      _snapshotSwapped=true;
    }
  }

  const wrap=document.getElementById('tbl');
  const tbl=document.createElement('table');
  tbl.className='sched-tbl';

  const DATE_HDR=getDateHeaders();
  // 요일별 수업일 캐시 (학생 행에서도 사용)
  const _classDatesCache={};
  DAYS.forEach(day=>{_classDatesCache[day]=getClassDatesForDay(day);});
  const _attendanceBasisByDay=_buildAttendanceBasisByDay(DAYS);

  tbl.appendChild(buildColgroup(DAYS, HAS_NUM, LANE_COUNT));
  tbl.appendChild(buildThead(DAYS, HAS_NUM, LANE_COUNT, DATE_HDR));

  /* tbody */
  const tbody=document.createElement('tbody');

  // 같은 시간+요일 동명이인 접두어 계산
  const _namePrefix={};
  TIMES.forEach(({t})=>{
    DAYS.forEach(day=>{
      const nameSlots={};
      const maxRows=getTimeRows(t);
      for(let l=1;l<=LANE_COUNT;l++) for(let r=1;r<=maxRows;r++){
        const s=_ctxStu({attendanceBasisByDay:_attendanceBasisByDay},t,day,l,r);
        if(s){
          if(!nameSlots[s.n]) nameSlots[s.n]=[];
          nameSlots[s.n].push(t+'/'+day+'/'+l+'/'+r);
        }
      }
      for(const [name,slots] of Object.entries(nameSlots)){
        if(slots.length>1){
          const abc='abcdefghijklmnop';
          slots.forEach((key,i)=>{ _namePrefix[key]=abc[i]||''; });
        }
      }
    });
  });

  TIMES.forEach(({t})=>{
    let rows=getTimeRows(t);
    // 출석 모드: 해당 시간대의 해당 주에 추가된 row들(MARK_MAP)까지 확장
    if(_attendanceMode && _attendanceDate){
      let maxRi=rows;
      DAYS.forEach(ddKey=>{
        const dsStr=_dayToCellDs(ddKey);
        _ctxStudents({attendanceBasisByDay:_attendanceBasisByDay},ddKey).forEach(s=>{
          if(s&&s.t===t&&s.d===ddKey){
            const ri=parseInt(s.r);
            if(ri>maxRi) maxRi=ri;
          }
        });
        for(const mk of Object.keys(MARK_MAP)){
          if(!mk.startsWith(t+'/'+ddKey+'/')) continue;
          const parts=mk.split('/');
          if(parts.length!==5) continue;
          if(parts[4]!==dsStr) continue;
          const ri=parseInt(parts[3]);
          if(ri>maxRi) maxRi=ri;
        }
        for(const [guestKey, list] of Object.entries(ATT_GUESTS||{})){
          if(!guestKey.startsWith(t+'/'+ddKey+'/')) continue;
          const parts=guestKey.split('/');
          if(parts.length!==4 || parts[3]!==dsStr) continue;
          (list||[]).forEach(g=>{
            if(!g||!g.slotKey) return;
            const sp=g.slotKey.split('/');
            if(sp.length!==4) return;
            const ri=parseInt(sp[3]);
            if(ri>maxRi) maxRi=ri;
          });
        }
      });
      rows=Math.max(rows, maxRi);
    }
    const hasSat=!!SAT_TIME_LABEL[t];

    const basisCtx={attendanceBasisByDay:_attendanceBasisByDay};
    const instRow=buildInstRow(t, rows, hasSat, DAYS, HAS_NUM, LANE_COUNT, SAT_TIME_LABEL, basisCtx);
    tbody.appendChild(instRow);

    for(let ri=0;ri<rows;ri++){
      const stuRow=buildStuRow(t, ri, rows, hasSat, {
        DAYS, HAS_NUM, LANE_COUNT, DATE_HDR,
        classDatesCache: _classDatesCache,
        namePrefix: _namePrefix,
        todayStr,
        attendanceBasisByDay: _attendanceBasisByDay
      });
      tbody.appendChild(stuRow);
    }
  });
  tbl.appendChild(tbody);
  wrap.replaceChildren(tbl);

  // 팝업 열려있으면 활성 셀 하이라이트 복원
  if(_stuPopup.key&&document.getElementById('stu-popup').classList.contains('show')){
    const [st,sd,sl,sr]=_stuPopup.key.split('/');
    document.querySelectorAll('.stu-clickable').forEach(td=>{
      if(td.dataset.t===st&&td.dataset.day===sd&&td.dataset.lane===sl&&td.dataset.ri===sr){
        td.classList.add('stu-active');
        _stuPopup.td=td;
      }
    });
  }

  // 후처리: 스크롤 복원, 프록시, 오늘 컬럼 프레임, 플래시
  const savedScroll=_tblOuter?_tblOuter.scrollLeft:0;
  updateProxyPosition();
  drawTodayColFrame();
  if(_tblOuter&&savedScroll){
    _tblOuter.scrollLeft=savedScroll;
    _proxy.scrollLeft=savedScroll;
  }
  if(_flashKey){
    const fk=_flashKey;_flashKey=null;
    requestAnimationFrame(()=>{
      const [ft,fd,fl,fr]=fk.split('/');
      document.querySelectorAll('.stu-clickable').forEach(td=>{
        if(td.dataset.t===ft&&td.dataset.day===fd&&td.dataset.lane===fl&&td.dataset.ri===fr){
          td.classList.add('stu-flash');
          setTimeout(()=>td.classList.remove('stu-flash'),2000);
        }
      });
    });
  }

  // 학부모 요청 대기 카운트 업데이트
  try{ updateScheduleSummary(); }catch(e){ console.warn('[summary]', e); }
  updateParentReqCount();
  if(typeof renderScheduleAuditSummary==='function') renderScheduleAuditSummary();

  // 스냅샷 사용했다면 원복
  if(_snapshotSwapped){
    STUDENTS.length=0;
    _origStudentsCopy.forEach(s=>STUDENTS.push(s));
    Object.keys(INST_MAP).forEach(k=>delete INST_MAP[k]);
    Object.assign(INST_MAP, _origInstCopy);
    Object.keys(_stuIdx).forEach(k=>delete _stuIdx[k]);
    // 원래 _stuIdx 재구축
    STUDENTS.forEach(s=>{_stuIdx[s.t+'/'+s.d+'/'+s.l+'/'+s.r]=s;});
  }

  // [v118] 타임머신 모드: 화면용으로 sync한 메모리를 원본으로 복원
  if(_tmBackup){
    STUDENTS.length=0;
    _tmBackup.stu.forEach(s=>STUDENTS.push(s));
    Object.keys(_stuIdx).forEach(k=>delete _stuIdx[k]);
    Object.assign(_stuIdx, _tmBackup.stuIdx);
    Object.keys(ENROLL_MAP).forEach(k=>delete ENROLL_MAP[k]);
    Object.assign(ENROLL_MAP, _tmBackup.enroll);
    Object.keys(RETIRE_MAP).forEach(k=>delete RETIRE_MAP[k]);
    Object.assign(RETIRE_MAP, _tmBackup.retire);
  }
}

function updateParentReqCount(){
  const btn=document.getElementById('parent-req-cnt');
  if(!btn) return;
  const pending=Object.values(REQUESTS||{}).filter(r=>!r.status||r.status==='pending').length;
  if(pending>0){
    btn.textContent=pending;
    btn.style.display='inline-block';
  } else {
    btn.style.display='none';
  }
}

function _summaryNumber(n){
  return Number(n||0).toLocaleString('ko-KR');
}
function _summaryInstExists(inst){
  if(!inst) return false;
  if(typeof inst==='string') return !!inst.trim();
  return !!String(inst.n||'').trim();
}
function _summaryRowsForInst(inst){
  if(typeof isBangteuk==='function' && isBangteuk()) return 6;
  if(typeof getInstCls==='function' && getInstCls(inst)) return 8;
  return 5;
}
function _summaryStudentKey(stu){
  const person=_summaryRecordPerson(stu,null);
  const name=String(person.n||'').trim();
  if(!name) return '';
  return name+'|'+_summaryNormPhone(person.p);
}
function _summaryDate(ds){
  if(!ds) return '';
  const p=String(ds).slice(5).split('-');
  return parseInt(p[0],10)+'/'+parseInt(p[1],10);
}
function _summaryTeacherName(inst){
  if(!inst) return '';
  if(typeof inst==='string') return inst.replace(/^[\d\)]+\s*/,'').replace(/\(유아\)/g,'').replace(/\(엘\/마\)/g,'').trim();
  return String(inst.n||'').trim();
}
function _summarySlotTeacher(slotKey){
  const p=String(slotKey||'').split('/');
  if(p.length<3) return '';
  const inst=INST_MAP&&INST_MAP[p[0]+'/'+p[1]+'/'+p[2]];
  return _summaryTeacherName(inst);
}
function _summaryIsMoveEntry(entry){
  return !!(entry&&typeof entry==='object'&&entry.moveType==='reserve'&&entry.moveId&&entry.pairKey);
}
function _summaryNormPhone(value){
  const raw=String(value||'').trim();
  return (typeof normPhone==='function'?normPhone(raw):raw).replace(/\D/g,'');
}
function _summaryRecordPerson(entry,fallback){
  const source=entry&&typeof entry==='object'?entry:{};
  const fb=fallback||{};
  const srcName=String(source.n||source.name||'').trim();
  const fbName=String(fb.n||fb.name||'').trim();
  const srcAge=String(source.a||source.age||'').trim();
  const fbAge=String(fb.a||fb.age||'').trim();
  const srcPhone=source.p||source.phone||source.tel||'';
  const fbPhone=fb.p||fb.phone||fb.tel||'';
  const legacyJoined=!!(srcName&&fbName&&fbAge&&srcName===fbName+fbAge);
  const preferFallback=!!(fbName&&(legacyJoined||(!_summaryNormPhone(srcPhone)&&_summaryNormPhone(fbPhone))));
  return {
    n:(preferFallback?fbName:srcName)||fbName,
    p:srcPhone||fbPhone,
    a:srcAge||fbAge,
  };
}
function _scheduleReservationName(entry,fallback){
  return _summaryRecordPerson(entry,fallback).n||'';
}
function _summaryRetireStatus(entry,isChange){
  return isChange||_summaryIsMoveEntry(entry) ? '제외예정' : '퇴원예정';
}
function _summaryEnrollStatus(entry){
  return '등록예정';
}
function _summaryPairFallback(entry,pairMap){
  if(!_summaryIsMoveEntry(entry)) return null;
  const pair=pairMap&&pairMap[entry.pairKey];
  if(!pair||typeof pair!=='object') return null;
  const person=_summaryRecordPerson(pair,entry);
  return {
    n:person.n,
    name:person.n,
    a:person.a,
    age:person.a,
    p:person.p,
    phone:person.p,
    tel:person.p,
  };
}
function _summaryEntryPersonKey(entry,fallback){
  const person=_summaryRecordPerson(entry,fallback);
  const name=String(person.n||'').trim();
  if(!name) return '';
  return name+'|'+_summaryNormPhone(person.p);
}
function _summarySlotInfo(slotKey,dateText,teacherName){
  const p=String(slotKey||'').split('/');
  const day=p[1]||'';
  const hour=String(p[0]||'').replace(/[^\d]/g,'')||String(p[0]||'');
  const badge=day&&hour ? day+hour : (p.length>=4 ? `${p[1]} ${p[0]}` : String(slotKey||''));
  const teacher=String(teacherName||'').trim();
  const date=String(dateText||'').trim();
  const text=[badge,teacher?teacher+' 선생님':'',date].filter(Boolean).join(' ');
  return {
    key:[slotKey,date,teacher].join('|'),
    badge,
    teacher,
    date,
    text,
  };
}
function _summaryRecord(entry,status,slotKey,dateText,fallback){
  const person=_summaryRecordPerson(entry,fallback);
  return {
    n:person.n,
    p:person.p,
    status,
    slot:_summarySlotInfo(slotKey,dateText,_summarySlotTeacher(slotKey))
  };
}
function _summaryAddPerson(map,rec,counted){
  const key=_summaryStudentKey(rec);
  if(!key) return;
  if(!map.has(key)){
    map.set(key,{key,n:rec.n||'',p:rec.p||'',counted,states:new Set(),slots:[]});
  }
  const row=map.get(key);
  if(rec.n&&!row.n) row.n=rec.n;
  if(rec.p&&!row.p) row.p=rec.p;
  row.states.add(rec.status);
  if(rec.slot&&rec.slot.text&&!row.slots.some(slot=>slot.key===rec.slot.key)) row.slots.push(rec.slot);
}
function _summaryRowsFromMap(map){
  return [...map.values()].map(row=>({
    key:row.key,
    n:row.n,
    p:row.p,
    counted:row.counted,
    status:[...row.states].join(', '),
    slots:row.slots,
    slotText:row.slots.map(slot=>slot.text).join(' / ')
  })).sort((a,b)=>String(a.n).localeCompare(String(b.n),'ko') || String(a.p).localeCompare(String(b.p),'ko'));
}
function getScheduleSummaryData(){
  const instRowsByKey={};
  let capacity=0;
  const times=(typeof getTimes==='function'?getTimes():[]).map(v=>v&&v.t?v.t:String(v||'')).filter(Boolean);
  const days=typeof getDays==='function'?getDays():[];
  const lanes=typeof getLanes==='function'?getLanes():0;

  times.forEach(t=>{
    days.forEach(day=>{
      for(let lane=1;lane<=lanes;lane++){
        const instKey=t+'/'+day+'/'+lane;
        const inst=INST_MAP&&INST_MAP[instKey];
        if(!_summaryInstExists(inst)) continue;
        const rows=_summaryRowsForInst(inst);
        instRowsByKey[instKey]=rows;
        for(let row=1;row<=rows;row++){
          if(DISABLED_MAP&&DISABLED_MAP[instKey+'/'+row]) continue;
          capacity++;
        }
      }
    });
  });

  const slotCanCount=slotKey=>{
    const p=String(slotKey||'').split('/');
    if(p.length<4) return false;
    const instKey=p[0]+'/'+p[1]+'/'+p[2];
    const maxRows=instRowsByKey[instKey];
    if(!maxRows) return false;
    const row=parseInt(p[3],10);
    if(!Number.isFinite(row) || row<1 || row>maxRows) return false;
    if(DISABLED_MAP&&DISABLED_MAP[instKey+'/'+row]) return false;
    return true;
  };

  const today=typeof toDateStr==='function'&&typeof getToday==='function'?toDateStr(getToday()):'';
  const activeRetireSlots=new Map();
  Object.entries(RETIRE_MAP||{}).forEach(([slotKey,entry])=>{
    if(!entry) return;
    const ds=typeof entry==='string'?entry:entry.ds;
    if(today&&ds&&ds<today) return;
    activeRetireSlots.set(slotKey,entry);
  });
  const enrollPersonKeys=new Set();
  Object.entries(ENROLL_MAP||{}).forEach(([slotKey,entry])=>{
    if(!entry) return;
    const key=_summaryEntryPersonKey(entry,_summaryPairFallback(entry,RETIRE_MAP));
    if(key) enrollPersonKeys.add(key);
  });

  const actualBySlot=new Map();
  (Array.isArray(STUDENTS)?STUDENTS:[]).forEach(stu=>{
    if(!stu || !stu.n) return;
    const slotKey=String(stu.t||'')+'/'+String(stu.d||'')+'/'+String(stu.l||'')+'/'+String(stu.r||'');
    if(slotCanCount(slotKey)) actualBySlot.set(slotKey,stu);
  });

  const occupiedSlots=new Set();
  const countedPeople=new Map();
  const excludedPeople=new Map();

  actualBySlot.forEach((stu,slotKey)=>{
    const retire=activeRetireSlots.get(slotKey);
    if(retire){
      const ds=typeof retire==='string'?retire:retire.ds;
      const isChange=enrollPersonKeys.has(_summaryEntryPersonKey(retire,stu));
      _summaryAddPerson(excludedPeople,_summaryRecord(retire,_summaryRetireStatus(retire,isChange),slotKey,_summaryDate(ds)+'까지',stu),false);
      return;
    }
    occupiedSlots.add(slotKey);
    _summaryAddPerson(countedPeople,_summaryRecord(stu,'재원',slotKey,''),true);
  });

  Object.entries(ENROLL_MAP||{}).forEach(([slotKey,entry])=>{
    if(!entry) return;
    if(slotCanCount(slotKey)) occupiedSlots.add(slotKey);
    const ds=typeof entry==='string'?entry:entry.ds;
    _summaryAddPerson(countedPeople,_summaryRecord(entry,_summaryEnrollStatus(entry),slotKey,_summaryDate(ds)+'부터'),true);
  });

  activeRetireSlots.forEach((entry,slotKey)=>{
    if(actualBySlot.has(slotKey)) return;
    const ds=typeof entry==='string'?entry:entry.ds;
    const fallback=_summaryPairFallback(entry,ENROLL_MAP);
    const isChange=enrollPersonKeys.has(_summaryEntryPersonKey(entry,fallback));
    _summaryAddPerson(excludedPeople,_summaryRecord(entry,_summaryRetireStatus(entry,isChange),slotKey,_summaryDate(ds)+'까지',fallback),false);
  });

  const countedRows=_summaryRowsFromMap(countedPeople);
  const excludedRows=_summaryRowsFromMap(excludedPeople);
  const countedKeys=new Set(countedRows.map(row=>row.key));
  const excludedOnlyRows=excludedRows.filter(row=>!countedKeys.has(row.key));
  return {
    hours:occupiedSlots.size,
    capacity,
    countedRows,
    excludedRows,
    excludedOnlyRows,
    averageHours:countedRows.length ? occupiedSlots.size/countedRows.length : 0,
  };
}
function updateScheduleSummary(){
  const hoursEl=document.getElementById('schedule-class-hours');
  const studentsEl=document.getElementById('schedule-student-total');
  if(!hoursEl && !studentsEl) return;
  const data=getScheduleSummaryData();
  if(hoursEl) hoursEl.textContent=_summaryNumber(data.hours)+'/'+_summaryNumber(data.capacity);
  if(studentsEl) studentsEl.textContent=_summaryNumber(data.countedRows.length);
}

function _scheduleStudentRowsForModal(){
  const data=getScheduleSummaryData();
  const contactMap=new Map();
  const addRow=(row,counted)=>{
    const rawPhone=String(row.p||'').trim();
    const phone=(typeof normPhone==='function'?normPhone(rawPhone):rawPhone).replace(/\D/g,'');
    const name=String(row.n||'').trim();
    const key=name ? 'person:'+name+'|'+phone : (phone ? 'phone:'+phone : '');
    if(!key) return;
    if(!contactMap.has(key)){
      contactMap.set(key,{key,p:row.p||'',countedCount:0,excludedCount:0,members:new Map(),searchParts:[]});
    }
    const contact=contactMap.get(key);
    if(row.p&&!contact.p) contact.p=row.p;
    if(counted) contact.countedCount++;
    else contact.excludedCount++;
    const memberKey=String(row.key||row.n)+'|'+String(row.status||'')+'|'+(counted?'1':'0');
    if(!contact.members.has(memberKey)){
      contact.members.set(memberKey,{n:row.n||'',status:row.status||'',counted,dates:new Set(),slots:[]});
    }
    const member=contact.members.get(memberKey);
    const rowSlots=Array.isArray(row.slots)?row.slots:String(row.slots||'').split(' / ').filter(Boolean).map(text=>({key:text,badge:text,teacher:'',date:'',text}));
    rowSlots.forEach(slot=>{
      if(slot.date) member.dates.add(slot.date);
      if(!member.slots.some(saved=>saved.key===slot.key)) member.slots.push(slot);
    });
    contact.searchParts.push(row.n,row.p,row.status,row.slotText||'',counted?'집계포함':'집계제외');
  };
  data.countedRows.forEach(row=>addRow(row,true));
  data.excludedRows.forEach(row=>addRow(row,false));
  const rows=[...contactMap.values()].map(row=>{
    const members=[...row.members.values()].sort((a,b)=>String(a.n).localeCompare(String(b.n),'ko') || String(a.status).localeCompare(String(b.status),'ko'));
    const countedCount=row.countedCount||0;
    return {
      ...row,
      countedCount,
      excludedCount:countedCount?0:(row.excludedCount||0),
      members,
      search:row.searchParts.join(' ').toLowerCase()
    };
  }).sort((a,b)=>String(a.p||'').localeCompare(String(b.p||''),'ko') || String(a.key).localeCompare(String(b.key),'ko'));
  return {
    data,
    rows
  };
}
function openScheduleStudentList(){
  const modal=document.getElementById('schedule-student-modal');
  if(!modal) return;
  const search=document.getElementById('schedule-student-search');
  if(search) search.value='';
  modal.style.display='flex';
  renderScheduleStudentList();
}
function closeScheduleStudentList(){
  const modal=document.getElementById('schedule-student-modal');
  if(modal) modal.style.display='none';
}
function _scheduleStudentStatusClass(status,counted){
  if(String(status||'').includes('제외')) return 'exclude';
  if(String(status||'').includes('이동')) return 'move';
  if(!counted) return 'retire';
  return String(status||'').includes('등록')?'enroll':'';
}
function _scheduleNormalizeChangeMembers(members){
  return [...(members||[])];
}
function renderScheduleStudentList(){
  const body=document.getElementById('schedule-student-list-body');
  const summary=document.getElementById('schedule-student-list-summary');
  if(!body) return;
  const {data,rows}=_scheduleStudentRowsForModal();
  const q=String(document.getElementById('schedule-student-search')?.value||'').trim().toLowerCase();
  const filtered=rows.filter(row=>{
    if(!q) return true;
    return String(row.search||'').includes(q);
  });
  if(summary){
    summary.textContent=`집계 원생 ${_summaryNumber(data.countedRows.length)}명 · 평균시수 ${Number(data.averageHours||0).toFixed(1)} · 제외예정 ${_summaryNumber((data.excludedOnlyRows||data.excludedRows||[]).length)}명 · 표시 원생 ${_summaryNumber(filtered.length)}건`;
  }
  body.innerHTML=filtered.map(row=>{
    const badges=[
      row.countedCount?`<span class="schedule-student-badge counted">포함 ${_summaryNumber(row.countedCount)}</span>`:'',
      row.excludedCount?`<span class="schedule-student-badge excluded">제외 ${_summaryNumber(row.excludedCount)}</span>`:'',
    ].filter(Boolean).join('');
    const members=_scheduleNormalizeChangeMembers(row.members||[]).map(member=>{
      const statusCls=_scheduleStudentStatusClass(member.status,member.counted);
      const slotBits=[...new Set((member.slots||[]).map(slot=>slot.badge).filter(Boolean))]
        .map(badge=>`<span class="schedule-student-inline-slot">${esc(badge)}</span>`).join('');
      const dates=[...(member.dates||[])].map(date=>`<span class="schedule-student-date-chip">${esc(date)}</span>`).join('');
      return `<div class="schedule-student-member"><strong>${esc(member.n||'')}</strong>${slotBits}<span class="schedule-student-status ${statusCls}">${esc(member.status||'')}</span>${dates}</div>`;
    }).join('');
    const displayMembers=_scheduleNormalizeChangeMembers(row.members||[]);
    const teacherNames=[...new Set(displayMembers.flatMap(member=>(member.slots||[]).map(slot=>slot.teacher).filter(Boolean)))];
    const teachers=teacherNames.map(name=>`<span class="schedule-student-teacher-chip">${esc(name)}쌤</span>`).join('');
    const slotBadges=[...new Set(displayMembers.flatMap(member=>(member.slots||[]).map(slot=>slot.badge).filter(Boolean)))];
    const slots=slotBadges.map(badge=>`<span class="schedule-student-slot-chip"><b>${esc(badge)}</b></span>`).join('');
    return `<tr>
      <td><div class="schedule-student-badge-stack">${badges||'<span class="schedule-student-badge excluded">제외</span>'}</div></td>
      <td>${row.p?esc(row.p):'<span class="muted">-</span>'}</td>
      <td><div class="schedule-student-members">${members}</div></td>
      <td><span class="schedule-student-teacher-chip-row">${teachers||'<span class="muted">-</span>'}</span></td>
      <td class="schedule-student-slots"><span class="schedule-student-slot-chip-row">${slots||'<span class="muted">-</span>'}</span></td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="muted" style="text-align:center;padding:18px">표시할 원생이 없습니다</td></tr>';
}
function downloadScheduleStudentListCsv(){
  const {rows}=_scheduleStudentRowsForModal();
  const q=String(document.getElementById('schedule-student-search')?.value||'').trim().toLowerCase();
  const filtered=rows.filter(row=>!q||String(row.search||'').includes(q));
  const csvRows=[['집계','전화번호','원생/상태','선생님','수업 위치']];
  filtered.forEach(row=>{
    const countText=[row.countedCount?`포함 ${row.countedCount}`:'',row.excludedCount?`제외 ${row.excludedCount}`:''].filter(Boolean).join(' / ');
    const displayMembers=_scheduleNormalizeChangeMembers(row.members||[]);
    const memberText=displayMembers.map(m=>`${m.n}(${m.status}${[...(m.dates||[])].length?' '+[...m.dates].join(','):''})`).join(' / ');
    const teacherText=[...new Set(displayMembers.flatMap(m=>m.slots.map(slot=>slot.teacher).filter(Boolean)))].join(' / ');
    const slotText=[...new Set(displayMembers.flatMap(m=>m.slots.map(slot=>slot.badge).filter(Boolean)))].join(' / ');
    csvRows.push([countText,row.p||'',memberText,teacherText,slotText]);
  });
  const csv='\ufeff'+csvRows.map(cols=>cols.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const branch=(typeof getBranchInfo==='function'&&getBranchInfo()?.id)||'schedule';
  a.href=url;
  a.download=`${branch}_students_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/* ════════════════════════════════════════════════════════════════
 * SECTION: 하단 고정 스크롤 프록시 [v111]
 *   proxy는 tbl-outer 밖에 있는 sibling이고 항상 position:fixed.
 *   updateProxyPosition()가 display/width/left + inner width를 한 번에 갱신.
 * ════════════════════════════════════════════════════════════════ */
const _proxy=document.getElementById('scroll-proxy');
const _proxyInner=document.getElementById('scroll-proxy-inner');
const _tblOuter=document.getElementById('tab-regular');
let _proxySync=false;

function updateProxyPosition(){
  const tbl=_tblOuter.querySelector('table');
  if(!tbl){ _proxy.style.display='none'; return; }
  const needScroll = tbl.scrollWidth > _tblOuter.clientWidth;
  if(!needScroll){ _proxy.style.display='none'; return; }
  _proxyInner.style.width=tbl.scrollWidth+'px';
  const rect=_tblOuter.getBoundingClientRect();
  _proxy.style.display='block';
  _proxy.style.left=rect.left+'px';
  _proxy.style.width=rect.width+'px';
}

_proxy.addEventListener('scroll',function(){
  if(_proxySync) return;
  _proxySync=true;
  _tblOuter.scrollLeft=_proxy.scrollLeft;
  requestAnimationFrame(()=>{_proxySync=false;});
});

_tblOuter.addEventListener('scroll',function(){
  if(_proxySync) return;
  _proxySync=true;
  _proxy.scrollLeft=_tblOuter.scrollLeft;
  requestAnimationFrame(()=>{_proxySync=false;});
});

let _proxyRaf=0;
function _rafProxy(){cancelAnimationFrame(_proxyRaf);_proxyRaf=requestAnimationFrame(updateProxyPosition);}
window.addEventListener('scroll',_rafProxy,{passive:true});
window.addEventListener('resize',function(){_rafProxy();drawTodayColFrame();});

/* ════════════════════════════════════════════════════════════════
 * [v109] 오늘 날짜 column 사각형 테두리
 * tblWrap 안에 absolute-positioned overlay div를 그려 전체 column을 감쌈.
 * tblWrap이 scroll container 안에 있어서 가로/세로 스크롤 시 같이 움직임.
 * ════════════════════════════════════════════════════════════════ */
function drawTodayColFrame(){
  const tblWrap=document.getElementById('tbl');
  if(!tblWrap) return;
  // 기존 frame 제거
  tblWrap.querySelectorAll('.today-col-frame').forEach(el=>el.remove());

  const dhToday=tblWrap.querySelector('th.dh-today');
  if(!dhToday) return;
  const tbl=tblWrap.querySelector('table');
  if(!tbl) return;

  tblWrap.style.position='relative';

  const tblRect=tbl.getBoundingClientRect();
  const dhRect=dhToday.getBoundingClientRect();
  const left=dhRect.left - tblRect.left;
  const width=dhRect.width;
  const height=tbl.offsetHeight;

  const frame=document.createElement('div');
  frame.className='today-col-frame';
  frame.style.cssText='position:absolute;left:'+left+'px;top:0;width:'+width+'px;height:'+height+'px;border:3px solid #0F9D58;border-radius:4px;pointer-events:none;box-sizing:border-box;z-index:3;background:transparent';
  tblWrap.appendChild(frame);
}

let _flashKey=null;

/* ════════════════════════════════════════════════════════════════
 * 엑셀 저장 (SheetJS)
 * ════════════════════════════════════════════════════════════════ */
function exportExcel(){
  if(typeof XLSX==='undefined'){toast('엑셀 라이브러리 로드 실패','err');return;}

  const DAYS=getDays(),TIMES=getTimes(),LANE_COUNT=getLanes(),HAS_NUM=getHasNum();
  const DATE_HDR=getDateHeaders();
  const SAT_TIME_LABEL=getSatLabel();
  const wb=XLSX.utils.book_new();
  const data=[];

  // 1행: 요일 헤더
  const hdr1=[];
  DAYS.forEach(day=>{
    hdr1.push(DATE_HDR[day].label||day);
    for(let i=1;i<LANE_COUNT;i++) hdr1.push('');
  });
  data.push([''].concat(hdr1));

  // 2행: 레인 헤더
  const hdr2=[];
  DAYS.forEach(()=>{
    for(let l=1;l<=LANE_COUNT;l++) hdr2.push(l+'레인');
  });
  data.push([''].concat(hdr2));

  // 데이터 행
  TIMES.forEach(({t})=>{
    const rows=getTimeRows(t);
    const satLabel=SAT_TIME_LABEL[t];

    // 담임 행
    const instRow=[t+' 담임'];
    DAYS.forEach(day=>{
      const isSat=day==='토';
      for(let l=1;l<=LANE_COUNT;l++){
        if(isSat&&!satLabel){instRow.push('');continue;}
        const inst=getInst(t,day,l);
        instRow.push(inst?inst.n:'');
      }
    });
    data.push(instRow);

    // 학생 행
    for(let ri=0;ri<rows;ri++){
      const stuRow=[t+' '+(ri+1)+'번'];
      DAYS.forEach(day=>{
        const isSat=day==='토';
        for(let l=1;l<=LANE_COUNT;l++){
          if(isSat&&!satLabel){stuRow.push('');continue;}
          const _l=l,_r=ri+1;
          const stu=getStu(t,day,_l,_r);
          if(!stu){stuRow.push('');continue;}
          let txt=stu.n+(stu.a||'');
          // 이벤트 정보 추가
          const slotKey=t+'/'+day+'/'+_l+'/'+_r;
          const ret=RETIRE_MAP[slotKey];
          if(ret) txt+=' [퇴'+ret.ds.slice(5).replace('-','/')+']';
          const enr=ENROLL_MAP[slotKey];
          if(enr) txt+=' [등'+(enr.name||'')+' '+enr.ds.slice(5).replace('-','/')+']';
          const hyu=HYUWON_MAP[slotKey];
          if(hyu) txt+=' [휴원]';
          if(stu.v||_tableLocUsesVehicle(stu.loc)) txt+=' 🚐';
          if(stu.isNew) txt+=' (신규)';
          if(stu.reenroll) txt+=' (재등록)';
          stuRow.push(txt);
        }
      });
      data.push(stuRow);
    }
  });

  const ws=XLSX.utils.aoa_to_sheet(data);

  // 열 너비 설정
  const colWidths=[{wch:10}];
  for(let i=0;i<DAYS.length*LANE_COUNT;i++) colWidths.push({wch:14});
  ws['!cols']=colWidths;

  // 요일별 셀 병합 (1행)
  const merges=[];
  let col=1;
  DAYS.forEach(()=>{
    if(LANE_COUNT>1) merges.push({s:{r:0,c:col},e:{r:0,c:col+LANE_COUNT-1}});
    col+=LANE_COUNT;
  });
  ws['!merges']=merges;

  const today=getToday();
  const ds=today.getFullYear()+String(today.getMonth()+1).padStart(2,'0')+String(today.getDate()).padStart(2,'0');
  const tabName=getTabConfig().name||'시간표';
  XLSX.utils.book_append_sheet(wb,ws,tabName);
  XLSX.writeFile(wb,'가경수영장_'+tabName+'_'+ds+'.xlsx');
  toast('엑셀 저장 완료','ok');
}



// 출석 체크 모달 이벤트 (DOM 준비 후)
document.addEventListener("DOMContentLoaded",function(){
  const mp=document.getElementById("att-modal-present");
  const ma=document.getElementById("att-modal-absent");
  const mc=document.getElementById("att-modal-cancel");
  const mx=document.getElementById("att-modal-close");
  const md=document.getElementById("att-cell-modal");
  if(mp) mp.addEventListener("click",()=>_setAttModal("present"));
  if(ma) ma.addEventListener("click",()=>_setAttModal("absent"));
  if(mc) mc.addEventListener("click",()=>_setAttModal(null));
  if(mx) mx.addEventListener("click",_closeAttModal);
  if(md) md.addEventListener("click",function(e){if(e.target===md)_closeAttModal();});
  const mdel=document.getElementById("att-modal-delete");
  if(mdel) mdel.addEventListener("click",_deleteFromAttModal);

  // 편집 모달
  const es=document.getElementById("att-edit-save");
  const ec=document.getElementById("att-edit-cancel");
  const ed=document.getElementById("att-edit-delete");
  const em=document.getElementById("att-edit-modal");
  const en=document.getElementById("att-edit-name");
  if(es) es.addEventListener("click",_saveEditModal);
  if(ec) ec.addEventListener("click",_closeEditModal);
  if(ed) ed.addEventListener("click",_deleteEditModal);
  if(em) em.addEventListener("click",function(e){if(e.target===em)_closeEditModal();});
  if(en) en.addEventListener("keydown",function(e){
    if(e.key==="Enter"){e.preventDefault();_saveEditModal();}
  });

  // 원생 추가 모달
  const ap=document.getElementById("att-add-present");
  const aa=document.getElementById("att-add-absent");
  const ab=document.getElementById("att-add-bogang");
  const as=document.getElementById("att-add-sample");
  const ah=document.getElementById("att-add-hyuwon");
  const ax=document.getElementById("att-add-cancel");
  const am=document.getElementById("att-add-modal");
  if(ap) ap.addEventListener("click",()=>_saveAttAdd("present"));
  if(aa) aa.addEventListener("click",()=>_saveAttAdd("absent"));
  if(ab) ab.addEventListener("click",()=>_saveAttAdd("bogang"));
  if(as) as.addEventListener("click",()=>_saveAttAdd("sample"));
  if(ah) ah.addEventListener("click",()=>_saveAttAdd("hyuwon"));
  if(ax) ax.addEventListener("click",_closeAttAddModal);
  if(am) am.addEventListener("click",function(e){if(e.target===am)_closeAttAddModal();});
});
