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
function _layoutStudentName(stu){
  if(!stu) return '';
  const marker=stu.layoutAdded?'(추가) ':'';
  return marker+String(stu.n||stu.name||'');
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
function _attMd(ds){
  const p=String(ds||'').slice(5).split('-');
  if(p.length<2) return '';
  return parseInt(p[0],10)+'/'+parseInt(p[1],10);
}
function _attReservationNameMatches(entry,item){
  if(!entry||!item) return false;
  try{
    if(typeof _summaryEntryMatchesPerson==='function') return _summaryEntryMatchesPerson(entry,item,item);
  }catch(e){}
  const name=String(entry.n||entry.name||'').trim();
  if(name&&name!==String(item.n||item.name||'').trim()) return false;
  const pa=String(entry.p||entry.phone||entry.tel||'').replace(/\D/g,'');
  const pb=String(item.p||item.phone||item.tel||'').replace(/\D/g,'');
  if(pa&&pb&&pa!==pb) return false;
  return !!(name||pa||pb);
}
function _isBangteukTableActive(){
  try{return typeof isBangteuk==='function'&&isBangteuk();}catch(e){return false;}
}
function _isBangteukSlotKey(slotKey){
  const p=String(slotKey||'').split('/');
  if(p.length<4) return false;
  const t=p[0], day=p[1], lane=parseInt(p[2],10), row=parseInt(p[3],10);
  if(_isBangteukTableActive()){
    try{
      const cfg=typeof getTabConfig==='function'?getTabConfig():null;
      const days=Array.isArray(cfg?.days)?cfg.days:[];
      const times=Array.isArray(cfg?.times)?cfg.times.map(x=>x&&x.t):[];
      const laneMax=parseInt(cfg?.lanes||5,10);
      return !!(days.includes(day)&&times.includes(t)&&lane>=1&&lane<=laneMax&&row>=1&&row<=6);
    }catch(e){return false;}
  }
  try{
    if(typeof getBangteukSlotMeta==='function'&&getBangteukSlotMeta(t,day,lane)) return true;
    const inst=typeof getInst==='function'?getInst(t,day,lane):null;
    if(window.SCScheduleTime&&typeof window.SCScheduleTime.isBangteukSlot==='function'){
      return window.SCScheduleTime.isBangteukSlot(inst,row,{bangteukTable:false});
    }
  }catch(e){}
  return false;
}
function _bangteukMetaForSlotKey(slotKey){
  const p=String(slotKey||'').split('/');
  if(p.length<3) return null;
  const [t,day,lane]=p;
  try{
    const meta=typeof getBangteukSlotMeta==='function'?getBangteukSlotMeta(t,day,parseInt(lane,10)):null;
    if(meta&&(meta.seasonStart||meta.seasonEnd)) return meta;
  }catch(e){}
  if(_isBangteukTableActive()){
    try{
      const tab=typeof getActiveBangteukBasisTab==='function'?getActiveBangteukBasisTab():null;
      if(tab) return {seasonStart:tab.seasonStart||'', seasonEnd:tab.seasonEnd||'', tabId:tab.id||''};
    }catch(e){}
  }
  return null;
}
function _bangteukInfoVisible(slotKey,basisDs){
  const meta=_bangteukMetaForSlotKey(slotKey);
  if(!meta||!meta.seasonStart) return true;
  let basis=basisDs||'';
  if(!basis){
    try{ basis=toDateStr(getToday()); }catch(e){ basis=''; }
  }
  if(!basis) return true;
  return basis<meta.seasonStart;
}
function _bangteukClassActive(slotKey,basisDs){
  const meta=_bangteukMetaForSlotKey(slotKey);
  if(!meta||!meta.seasonStart||!meta.seasonEnd) return true;
  let basis=basisDs||'';
  if(!basis){
    try{ basis=toDateStr(getToday()); }catch(e){ basis=''; }
  }
  if(!basis) return true;
  return meta.seasonStart<=basis&&basis<=meta.seasonEnd;
}
function _attDisplayName(item,slotKey,ds){
  if(!item) return '';
  const name=item.type==='bogang'&&typeof bogangDisplayName==='function'
    ? bogangDisplayName(item)
    : _layoutStudentName(item);
  const age=item.a||item.age||'';
  const isBt=_isBangteukSlotKey(slotKey);
  if(item.type&&item.type!=='regular') return name+age;
  const suffixes=[];
  const ret=RETIRE_MAP&&RETIRE_MAP[slotKey];
  const retDs=(typeof ret==='string'?ret:ret?.ds)||item._attRetireDs||'';
  if(retDs&&retDs===ds){
    const suffix=(typeof _retireReservationSuffix==='function')?_retireReservationSuffix(ret,slotKey,item):'까지';
    suffixes.push('~'+_attMd(retDs)+suffix);
  }
  const enr=!isBt&&ENROLL_MAP&&ENROLL_MAP[slotKey];
  const enDs=isBt?'':String(item._attEnrollDs||item.enrolled||enr?.ds||'');
  if(enDs&&enDs===ds&&(!enr||_attReservationNameMatches(enr,item)||item._attEnrollDs===enDs)){
    suffixes.push(_attMd(enDs)+'부터~');
  }
  return suffixes.length ? [name].concat(suffixes).filter(Boolean).join(' ') : name+age;
}
function _buildAttendanceBasisByDay(days){
  const map={};
  if(!_attendanceMode||!_attendanceDate||typeof getAttendanceBasisDataForDate!=='function') return map;
  days.forEach(day=>{
    const ds=_dayToCellDs(day);
    const basis=getAttendanceBasisDataForDate(ds);
    if(basis) basis._basisDate=ds;
    map[day]=basis;
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
function _btPreviewSourceParts(t,day,lane){
  if(typeof getBtPreviewSourceKey!=='function') return null;
  if(!_btPreviewLaneVisible(t,day,lane)) return null;
  const sourceKey=getBtPreviewSourceKey(t+'/'+day+'/'+lane);
  if(!sourceKey) return null;
  const p=sourceKey.split('/');
  if(p.length<3) return null;
  return {t:p[0],day:p[1],lane:p[2],key:sourceKey};
}
function _btPreviewDateAllows(meta){
  if(!meta||!meta.seasonStart||!meta.seasonEnd) return true;
  // 일반 시간표의 방특 토글은 배치 테스트용이므로 즉시 보여준다.
  // 실제 날짜가 중요한 출석부 화면에서는 선택 날짜가 기간 안일 때만 표시한다.
  if(!(_attendanceMode&&_attendanceDate)) return true;
  let basis='';
  try{
    basis=_attendanceDate;
  }catch(e){
    basis=_attendanceDate||'';
  }
  if(!basis) return true;
  return meta.seasonStart<=basis&&basis<=meta.seasonEnd;
}
function _btPreviewLaneVisible(t,day,lane){
  if(typeof btPreviewLaneActive!=='function'||!btPreviewLaneActive(t,day,lane)) return false;
  if(typeof getBtPreviewInst!=='function') return true;
  return _btPreviewDateAllows(getBtPreviewInst(t+'/'+day+'/'+lane));
}
function _btPreviewTimeVisible(t){
  if(typeof hasBtPreviewForTime!=='function'||!hasBtPreviewForTime(t)) return false;
  const days=(typeof getDays==='function'?getDays():['월','화','수','목','금','토']);
  const lanes=(typeof getLanes==='function'?getLanes():5);
  return days.some(day=>{
    for(let lane=1;lane<=lanes;lane++){
      if(_btPreviewLaneVisible(t,day,lane)) return true;
    }
    return false;
  });
}
function _withBtPreviewSlot(stu,t,day,lane,row,source){
  if(!stu||!source) return null;
  if(source.t===t&&source.day===day&&String(source.lane)===String(lane)) return stu;
  return Object.assign({},stu,{t,d:day,l:parseInt(lane,10),r:parseInt(row,10),sourceDay:source.day,_btPreviewGhost:true});
}
function _ctxStu(ctx,t,day,lane,row){
  const data=ctx?.attendanceBasisByDay?.[day];
  if(data){
    const sourceDay=_attendanceSourceDay(data,day);
    const exactKey=t+'/'+sourceDay+'/'+lane+'/'+row;
    const exact=_bangteukClassActive(exactKey,data._basisDate)
      ? _withAttendanceViewDay(data.stuIdx?.[exactKey] || null,day,sourceDay)
      : null;
    if(exact) return exact;
    const btSource=_btPreviewSourceParts(t,day,lane);
    if(btSource){
      const btKey=btSource.t+'/'+btSource.day+'/'+btSource.lane+'/'+row;
      if(!_bangteukClassActive(btKey,data._basisDate)) return null;
      return _withBtPreviewSlot(data.stuIdx?.[btKey] || null,t,day,lane,row,btSource);
    }
    return null;
  }
  const exact=getStu(t,day,lane,row);
  if(exact) return exact;
  const btSource=_btPreviewSourceParts(t,day,lane);
  if(btSource){
    return _withBtPreviewSlot(getStu(btSource.t,btSource.day,btSource.lane,row),t,day,lane,row,btSource);
  }
  return null;
}
function _ctxInst(ctx,t,day,lane){
  const data=ctx?.attendanceBasisByDay?.[day];
  if(data){
    const sourceDay=_attendanceSourceDay(data,day);
    const exactKey=t+'/'+sourceDay+'/'+lane;
    const exact=_bangteukClassActive(exactKey+'/1',data._basisDate)
      ? (data.instMap?.[exactKey] || null)
      : null;
    if(exact) return exact;
    const btSource=_btPreviewSourceParts(t,day,lane);
    if(btSource){
      const btKey=btSource.t+'/'+btSource.day+'/'+btSource.lane;
      if(!_bangteukClassActive(btKey+'/1',data._basisDate)) return null;
      const inst=data.instMap?.[btKey] || null;
      return inst?Object.assign({},inst,{_btPreviewGhost:true,sourceDay:btSource.day}):null;
    }
    return null;
  }
  const exact=getInst(t,day,lane);
  if(exact) return exact;
  const btSource=_btPreviewSourceParts(t,day,lane);
  if(btSource){
    const inst=getInst(btSource.t,btSource.day,btSource.lane);
    return inst?Object.assign({},inst,{_btPreviewGhost:true,sourceDay:btSource.day}):null;
  }
  return null;
}
function _ctxStudents(ctx,day){
  const data=ctx?.attendanceBasisByDay?.[day];
  if(data){
    const sourceDay=_attendanceSourceDay(data,day);
    const list=sourceDay===day
      ? (data.students||[])
      : (data.students||[])
        .filter(stu=>stu&&stu.d===sourceDay)
        .map(stu=>_withAttendanceViewDay(stu,day,sourceDay));
    return list.filter(stu=>stu&&_bangteukClassActive(stu.t+'/'+stu.d+'/'+stu.l+'/'+stu.r,data._basisDate));
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
async function _editAttCell(slotKey, cellDs){
  if(window.SCAuth && !SCAuth.requirePermission('attendanceCheck','출석부 학생 편집')) return;
  const [t,d,l,r]=slotKey.split('/');
  const li=parseInt(l), ri=parseInt(r);
  const targetDs=cellDs||_attendanceDate;
  const isPast=targetDs < toDateStr(getToday());
  const basisTab=typeof getAttendanceBasisTabForDate==='function'?getAttendanceBasisTabForDate(targetDs):null;
  let snapshotForDate=null;
  if(isPast&&typeof ensureAttendanceDaySnapshotLoaded==='function'){
    snapshotForDate=await ensureAttendanceDaySnapshotLoaded(targetDs,basisTab?.id,true);
  }
  const usingSnapshot=!!(isPast&&snapshotForDate);

  let curStu;
  if(usingSnapshot){
    curStu=(snapshotForDate.students||[]).find(s=>s.t===t&&s.d===d&&s.l===li&&s.r===ri);
  } else {
    const basis=(targetDs&&typeof getAttendanceBasisDataForDate==='function')?getAttendanceBasisDataForDate(targetDs):null;
    const sourceDay=basis?_attendanceSourceDay(basis,d):d;
    curStu=basis?_withAttendanceViewDay(basis.stuIdx?.[t+'/'+sourceDay+'/'+li+'/'+ri]||null,d,sourceDay):getStu(t,d,li,ri);
  }

  _editModalCtx={slotKey, usingSnapshot, snapshot:snapshotForDate, exists:!!curStu, ds:targetDs, tabId:basisTab?.id||_activeTab};
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
  const {slotKey, usingSnapshot, snapshot, ds, tabId}=_editModalCtx;
  const [t,d,l,r]=slotKey.split('/');
  const li=parseInt(l), ri=parseInt(r);
  const newName=document.getElementById('att-edit-name').value.trim();
  const newAge=parseInt(document.getElementById('att-edit-age').value)||null;
  if(!newName){toast('이름을 입력하세요','err');return;}

  if(usingSnapshot){
    const arr=snapshot.students||[];
    const idx=arr.findIndex(s=>s.t===t&&s.d===d&&s.l===li&&s.r===ri);
    if(idx>=0){arr[idx].n=newName; arr[idx].a=newAge;}
    else arr.push({n:newName, a:newAge, t, d, l:li, r:ri});
    snapshot.students=arr;
    saveDaySnapshot(ds,tabId,snapshot);
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
  const {slotKey, usingSnapshot, snapshot, ds, tabId}=_editModalCtx;
  const [t,d,l,r]=slotKey.split('/');
  const li=parseInt(l), ri=parseInt(r);
  if(usingSnapshot){
    const arr=snapshot.students||[];
    const idx=arr.findIndex(s=>s.t===t&&s.d===d&&s.l===li&&s.r===ri);
    if(idx>=0) arr.splice(idx,1);
    snapshot.students=arr;
    saveDaySnapshot(ds,tabId,snapshot);
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
  const buttons=[document.getElementById('attendance-toggle-btn'),document.getElementById('attendance-mobile-btn')].filter(Boolean);
  if(_attendanceMode){
    if(!_attendanceDate) _attendanceDate=toDateStr(getToday());
    document.getElementById('att-date-input').value=_attendanceDate;
    bar.style.display='flex';
    buttons.forEach(btn=>{
      btn.classList.add('active');
      btn.style.fontWeight='900';
      btn.setAttribute('aria-pressed','true');
      if(btn.id==='attendance-mobile-btn') btn.textContent='출석부 닫기';
    });
    // 오늘 스냅샷 저장
    _ensureTodaySnapshot();
  } else {
    _attSnapshotRefreshSeq++;
    bar.style.display='none';
    buttons.forEach(btn=>{
      btn.classList.remove('active');
      btn.style.fontWeight='';
      btn.setAttribute('aria-pressed','false');
      if(btn.id==='attendance-mobile-btn') btn.textContent='출석부';
    });
    _attBatchMode=false;
    _attBatchTargets.clear();
    document.body.classList.remove('att-batch-on');
    _attEditMode=false;
  }
  _updateAttEditUi();
  _updateAttBatchUi();
  buildTable();
  _updateAttBarInfo();
  if(_attendanceMode) _queueAttendanceSnapshotRefresh();
}

function setAttendanceDate(ds){
  _attendanceDate=ds;
  _attBatchTargets.clear();
  _updateAttBatchUi();
  buildTable();
  _updateAttBarInfo();
  _queueAttendanceSnapshotRefresh();
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
  _queueAttendanceSnapshotRefresh();
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
  _queueAttendanceSnapshotRefresh();
}

function setAttToday(){
  _attendanceDate=toDateStr(getToday());
  document.getElementById('att-date-input').value=_attendanceDate;
  _attBatchTargets.clear();
  _updateAttBatchUi();
  buildTable();
  _updateAttBarInfo();
  _queueAttendanceSnapshotRefresh();
}

let _attSnapshotRefreshSeq=0;
function _attendanceSnapshotDatesForView(){
  if(!_attendanceDate) return [];
  const mon=_getWeekMon(_attendanceDate);
  const count=(typeof isBangteuk==='function'&&isBangteuk())?5:6;
  const today=toDateStr(getToday());
  const dates=[];
  for(let i=0;i<count;i++){
    const d=new Date(mon);
    d.setDate(d.getDate()+i);
    const ds=toDateStr(d);
    if(ds<today) dates.push(ds);
  }
  return dates;
}
function _queueAttendanceSnapshotRefresh(){
  if(!_attendanceMode||typeof ensureAttendanceDaySnapshotsLoaded!=='function') return Promise.resolve();
  const seq=++_attSnapshotRefreshSeq;
  const anchor=_attendanceDate;
  const dates=_attendanceSnapshotDatesForView();
  if(!dates.length) return Promise.resolve();
  return ensureAttendanceDaySnapshotsLoaded(dates).then(()=>{
    if(seq!==_attSnapshotRefreshSeq||!_attendanceMode||anchor!==_attendanceDate) return;
    buildTable();
    _updateAttBarInfo();
  }).catch(error=>console.warn('attendance snapshot refresh failed',error));
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
  const days=(typeof getDays==='function'?getDays():['월','화','수','목','금','토']);
  (days||[]).forEach(day=>{
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
  if(typeof isSnapshotTab==='function'&&isSnapshotTab()) return;
  const today=toDateStr(getToday());
  const activeTabId=_activeTab;
  if(_snapshotTimer) clearTimeout(_snapshotTimer);
  _snapshotTimer=setTimeout(async()=>{
    const basisTab=typeof getAttendanceBasisTabForDate==='function'?getAttendanceBasisTabForDate(today):null;
    const targetTabId=basisTab?.id||activeTabId;
    const existing=typeof ensureAttendanceDaySnapshotLoaded==='function'
      ? await ensureAttendanceDaySnapshotLoaded(today,targetTabId)
      : DAY_SNAPSHOT[today];
    if(existing&&existing.date===today) return;
    if(activeTabId!==_activeTab) return;
    DAY_SNAPSHOT[today]={
      date:today,
      students:JSON.parse(JSON.stringify(STUDENTS)),
      inst:JSON.parse(JSON.stringify(INST_MAP)),
    };
    try{saveDaySnapshot(today,targetTabId);}catch(e){console.warn('snapshot save failed',e);}
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
function _buildStudentDatePreview(todayStr,cp){
  const students=JSON.parse(JSON.stringify(STUDENTS||[]));
  const enroll=JSON.parse(JSON.stringify(ENROLL_MAP||{}));
  const retire=JSON.parse(JSON.stringify(RETIRE_MAP||{}));
  const hyuwon=JSON.parse(JSON.stringify(HYUWON_MAP||{}));
  const identityMatches=(student,entry)=>{
    if(!student||!entry||typeof entry!=='object') return false;
    if(window.SCScheduleTime&&typeof window.SCScheduleTime.sameStudentIdentity==='function'){
      return window.SCScheduleTime.sameStudentIdentity(student,entry);
    }
    return String(student.n||'').trim()===String(entry.name||entry.n||'').trim();
  };
  const slotMatch=(s,slotKey)=>{
    const [t,d,l,r]=String(slotKey||'').split('/');
    return s.t===t&&s.d===d&&parseInt(s.l,10)===parseInt(l,10)&&parseInt(s.r,10)===parseInt(r,10);
  };

  for(const [slotKey,entry] of Object.entries(retire)){
    const retDs=entry?.ds||entry;
    if(entry?.blocked||!retDs||retDs>=todayStr) continue;
    const idx=students.findIndex(s=>slotMatch(s,slotKey));
    const current=idx>=0?students[idx]:null;
    if(current&&!identityMatches(current,entry)) continue;
    if(current) students.splice(idx,1);
    if(enroll[slotKey]&&enroll[slotKey].ds<retDs) delete enroll[slotKey];
    delete retire[slotKey];
    delete hyuwon[slotKey];
  }
  for(const [slotKey,entry] of Object.entries(enroll)){
    if(!entry||typeof entry!=='object') continue;
    const isBtEnroll=_isBangteukSlotKey(slotKey);
    if(!isBtEnroll){
      delete entry.paid;
      delete entry.btNew;
      if(entry.ds>todayStr) continue;
    }
    const existing=students.find(s=>slotMatch(s,slotKey));
    if(existing&&!identityMatches(existing,entry)) continue;
    if(!existing){
      const [t,d,l,r]=slotKey.split('/');
      const obj={sid:entry.sid||undefined,n:entry.name,a:entry.age||null,t,d,l:parseInt(l,10),r:parseInt(r,10)};
      if(entry.p) obj.p=entry.p;
      if(isBtEnroll&&(entry.btNew||entry.isNew)) obj.btNew=true;
      else if(entry.isNew) obj.isNew=entry.isNew;
      else if(!isBtEnroll&&entry.reenroll) obj.reenroll=entry.reenroll;
      if(!isBtEnroll&&(entry.enrolled||entry.isNew||entry.reenroll)) obj.enrolled=entry.ds;
      if(entry.v) obj.v=true;
      if(entry.paid) obj.paid=true;
      if(entry.loc) obj.loc=entry.loc;
      if(entry.memo) obj.memo=entry.memo;
      if(entry.g) obj.g=entry.g;
      students.push(obj);
    }
    delete enroll[slotKey];
  }
  students.forEach(s=>{
    const isBtStu=_isBangteukSlotKey(s.t+'/'+s.d+'/'+s.l+'/'+s.r);
    if(!isBtStu&&s.paid) delete s.paid;
    if(isBtStu&&s.isNew){s.btNew=true;delete s.isNew;}
    if(s.isNew&&!isBtStu&&s.isNew!==cp.month) delete s.isNew;
    if(s.reenroll&&(isBtStu||s.reenroll!==cp.month)) delete s.reenroll;
    if(s.enrolled&&(isBtStu||s.enrolled<todayStr)) delete s.enrolled;
  });
  if(window.SCScheduleTime&&typeof window.SCScheduleTime.normalizeStudents==='function'){
    window.SCScheduleTime.normalizeStudents(students);
  }
  return {students,enroll,retire,hyuwon};
}
let _studentSyncInFlight=null;
function syncStudentsBeforeRender(){
  const cp=SCHEDULE_PERIODS[getCurrentPeriod()];
  if(cp){
    const period=document.getElementById('app-period');
    if(period) period.textContent=String(cp.start||'').split('-')[0]+'년 '+cp.month+'월';
  }
  if(_studentSyncInFlight||!cp) return;
  if(window.SC_READ_ONLY_PREVIEW) return;
  if(typeof isSnapshotTab==='function'&&isSnapshotTab()) return;
  if(typeof _fakeDate!=='undefined'&&_fakeDate) return;
  if(window.SCAuth&&typeof SCAuth.can==='function'&&!SCAuth.can('editSchedule')) return;

  const todayStr=toDateStr(getToday());
  const identityMatches=(student,entry)=>{
    if(!student||!entry||typeof entry!=='object') return false;
    if(window.SCScheduleTime&&typeof window.SCScheduleTime.sameStudentIdentity==='function'){
      return window.SCScheduleTime.sameStudentIdentity(student,entry);
    }
    return String(student.n||'').trim()===String(entry.name||entry.n||'').trim();
  };
  const localStudentAt=slotKey=>{
    const [t,d,l,r]=String(slotKey||'').split('/');
    return (STUDENTS||[]).find(s=>s.t===t&&s.d===d&&parseInt(s.l,10)===parseInt(l,10)&&parseInt(s.r,10)===parseInt(r,10));
  };
  let needsSync=false;
  Object.entries(RETIRE_MAP||{}).some(([slotKey,entry])=>{
    const retDs=entry?.ds||entry;
    if(entry?.blocked||!retDs||retDs>=todayStr) return false;
    needsSync=true;
    return true;
  });
  if(!needsSync){
    Object.entries(ENROLL_MAP||{}).some(([slotKey,entry])=>{
      if(!entry||typeof entry!=='object') return false;
      const isBtEnroll=_isBangteukSlotKey(slotKey);
      if(!isBtEnroll&&(entry.paid||entry.btNew)){
        needsSync=true;
        return true;
      }
      if(!isBtEnroll&&entry.ds>todayStr) return false;
      const existing=localStudentAt(slotKey);
      if(!existing||identityMatches(existing,entry)){
        needsSync=true;
        return true;
      }
      return false;
    });
  }
  if(!needsSync){
    (STUDENTS||[]).some(s=>{
      const isBtStu=_isBangteukSlotKey(s.t+'/'+s.d+'/'+s.l+'/'+s.r);
      needsSync=!!(
        (!isBtStu&&s.paid)
        || (isBtStu&&s.isNew)
        || (s.isNew&&!isBtStu&&s.isNew!==cp.month)
        || (s.reenroll&&(isBtStu||s.reenroll!==cp.month))
        || (s.enrolled&&(isBtStu||s.enrolled<todayStr))
      );
      return needsSync;
    });
  }
  if(!needsSync) return;

  const stuKey=getTabConfig().stuKey;
  let committedChange=false;
  let blockedRetireCount=0;
  _studentSyncInFlight=updateScheduleTx([stuKey,STORAGE_KEYS.ENROLL,STORAGE_KEYS.RETIRE,STORAGE_KEYS.休원],ctx=>{
    committedChange=false;
    blockedRetireCount=0;
    const students=ctx.get(stuKey,[]);
    const enroll=ctx.get(STORAGE_KEYS.ENROLL,{});
    const retire=ctx.get(STORAGE_KEYS.RETIRE,{});
    const hyuwon=ctx.get(STORAGE_KEYS.休원,{});
    let studentsChanged=false;
    let enrollChanged=false;
    let retireChanged=false;
    let hyuwonChanged=false;
    const slotMatch=(s,slotKey)=>{
      const [t,d,l,r]=String(slotKey||'').split('/');
      return s.t===t&&s.d===d&&parseInt(s.l,10)===parseInt(l,10)&&parseInt(s.r,10)===parseInt(r,10);
    };

    for(const [slotKey,entry] of Object.entries(retire)){
      const retDs=entry?.ds||entry;
      if(entry?.blocked||!retDs||retDs>=todayStr) continue;
      const idx=students.findIndex(s=>slotMatch(s,slotKey));
      const current=idx>=0?students[idx]:null;
      if(current&&!identityMatches(current,entry)){
        retire[slotKey]={
          ...(entry&&typeof entry==='object'?entry:{ds:retDs}),
          blocked:true,
          blockedReason:'student-mismatch',
          blockedAt:new Date().toISOString(),
          blockedStudentSid:current.sid||'',
          blockedStudentName:current.n||'',
        };
        retireChanged=true;
        blockedRetireCount++;
        console.warn('[자동 제외 차단] 예약 원생과 현재 원생이 다릅니다:',slotKey,entry,current);
        continue;
      }
      if(current){
        students.splice(idx,1);
        studentsChanged=true;
      }
      const pendingEnroll=enroll[slotKey];
      if(pendingEnroll&&pendingEnroll.ds<retDs){
        delete enroll[slotKey];
        enrollChanged=true;
      }
      delete retire[slotKey];
      retireChanged=true;
      if(hyuwon[slotKey]){
        delete hyuwon[slotKey];
        hyuwonChanged=true;
      }
    }

    for(const [slotKey,entry] of Object.entries(enroll)){
      if(!entry||typeof entry!=='object') continue;
      const isBtEnroll=_isBangteukSlotKey(slotKey);
      if(!isBtEnroll&&(entry.paid||entry.btNew)){
        delete entry.paid;
        delete entry.btNew;
        enrollChanged=true;
      }
      if(!isBtEnroll&&entry.ds>todayStr) continue;
      const [t,d,l,r]=slotKey.split('/');
      const li=parseInt(l,10),ri=parseInt(r,10);
      const existing=students.find(s=>slotMatch(s,slotKey));
      if(existing&&!identityMatches(existing,entry)) continue;
      if(!existing){
        const obj={sid:entry.sid||undefined,n:entry.name,a:entry.age||null,t,d,l:li,r:ri};
        if(entry.p) obj.p=entry.p;
        if(isBtEnroll&&(entry.btNew||entry.isNew)) obj.btNew=true;
        else if(entry.isNew) obj.isNew=entry.isNew;
        else if(!isBtEnroll&&entry.reenroll) obj.reenroll=entry.reenroll;
        if(!isBtEnroll&&(entry.enrolled||entry.isNew||entry.reenroll)) obj.enrolled=entry.ds;
        if(entry.v) obj.v=true;
        if(entry.paid) obj.paid=true;
        if(entry.loc) obj.loc=entry.loc;
        if(entry.memo) obj.memo=entry.memo;
        if(entry.g) obj.g=entry.g;
        students.push(obj);
        studentsChanged=true;
      }
      delete enroll[slotKey];
      enrollChanged=true;
    }

    students.forEach(s=>{
      const isBtStu=_isBangteukSlotKey(s.t+'/'+s.d+'/'+s.l+'/'+s.r);
      if(!isBtStu&&s.paid){delete s.paid;studentsChanged=true;}
      if(isBtStu&&s.isNew){s.btNew=true;delete s.isNew;studentsChanged=true;}
      if(s.isNew&&!isBtStu&&s.isNew!==cp.month){delete s.isNew;studentsChanged=true;}
      if(s.reenroll&&(isBtStu||s.reenroll!==cp.month)){delete s.reenroll;studentsChanged=true;}
      if(s.enrolled&&(isBtStu||s.enrolled<todayStr)){delete s.enrolled;studentsChanged=true;}
    });

    if(studentsChanged) ctx.set(stuKey,students);
    if(enrollChanged) ctx.set(STORAGE_KEYS.ENROLL,enroll);
    if(retireChanged) ctx.set(STORAGE_KEYS.RETIRE,retire);
    if(hyuwonChanged) ctx.set(STORAGE_KEYS.休원,hyuwon);
    committedChange=studentsChanged||enrollChanged||retireChanged||hyuwonChanged;
    return true;
  }, {type:'edit',label:'자동 등록·제외 처리',deleteReason:'auto-retire',skipUndo:true})
    .then(()=>{
      if(blockedRetireCount&&typeof toast==='function'){
        toast('예약 원생과 현재 원생이 달라 자동 제외 '+blockedRetireCount+'건을 차단했습니다','err');
      }
      if(committedChange) buildTable();
    })
    .catch(err=>{console.error('syncStudentsBeforeRender transaction failed',err);})
    .finally(()=>{_studentSyncInFlight=null;});
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
      const _btPreviewInst=_btPreviewLaneVisible(t,day,_lane);
      const _btPreviewLabel=(_btPreviewInst&&typeof btPreviewLabelForInst==='function')?btPreviewLabelForInst(t+'/'+day+'/'+_lane):(_btPreviewInst?'(방특)':'');

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
        const _btPairPreview=_btPreviewInst||_btPreviewLaneVisible(t,day,li+2);
        // [v117] 선생님 색상 클래스 추가 (지정되어 있으면 디폴트 보라 대신 선생님 색상 사용)
        const _tCls=elmaInst?teacherCssClass(elmaInst.n):'';
        td.className='dc inst-cell-kimhs inst-clickable'+(_tCls?' '+_tCls:'');
        if(_btPairPreview) td.classList.add('bt-preview-active');
        if(pairStart[1]>=4&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        const iKey=t+'/'+day+'/'+(li+1);
        // [v117] cls(엘/마/엘리트/마스터)에 따라 라벨 동적
        const _cls=getInstCls(elmaInst);
        const _lbl=getInstClsLabel(_cls)||'(엘/마)';
        const _lblTextOnly=_lbl.replace(/[()]/g,'');
        const _pairBtLabel=(_btPairPreview&&typeof btPreviewLabelForInst==='function')?(btPreviewLabelForInst(iKey)||btPreviewLabelForInst(t+'/'+day+'/'+(li+2))||'(방특)'):_btPairPreview?'(방특)':'';
        td.innerHTML=instCellHTML(elmaInst?(elmaInst.n+_lbl+_pairBtLabel):_lblTextOnly,iKey);
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
        if(_btPreviewInst) td.classList.add('bt-preview-active');
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        const iKey=t+'/'+day+'/'+(li+1);
        // [v117] cls(엘/마/엘리트/마스터)에 따라 라벨 동적
        const _cls=getInstCls(inst);
        const _lbl=getInstClsLabel(_cls)||'(엘/마)';
        const _lblTextOnly=_lbl.replace(/[()]/g,'');
        td.innerHTML=instCellHTML(inst?(inst.n+_lbl+_btPreviewLabel):_lblTextOnly,iKey);
        td.style.fontWeight='700';td.style.fontSize='11px';
        td.addEventListener('click',function(){if(_attendanceMode) return; openInstPopup(this,t,day,_lane);});
        _addAttPlusBtn(td, _lane);
        instRow.appendChild(td);
        li++;
      } else {
        // 일반 담임 셀
        td.className='dc '+instClass(inst)+' inst-clickable';
        if(_btPreviewInst) td.classList.add('bt-preview-active');
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        const iKey=t+'/'+day+'/'+(li+1);
        td.innerHTML=instCellHTML(instDisplay(inst)+(_btPreviewInst&&inst?_btPreviewLabel:''),iKey);
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
  const storedBtTime=!isBangteukTable&&typeof hasBangteukInTime==='function'&&hasBangteukInTime(t);
  const storedBtExtraRow=storedBtTime&&ri>=baseSlotRows&&ri<6;
  const btPreviewTime=!isBangteukTable&&_btPreviewTimeVisible(t);
  const btPreviewExtraRow=btPreviewTime&&ri===baseSlotRows;
  const rowHasBangteukSlot=()=>{
    if((isBangteukTable&&ri<6)||storedBtExtraRow||btPreviewExtraRow) return true;
    if(ri<baseSlotRows||ri>=6) return false;
    const row=ri+1;
    for(const day of DAYS){
      for(let lane=1;lane<=LANE_COUNT;lane++){
        const inst=_ctxInst(ctx,t,day,lane);
        if(window.SCScheduleTime&&typeof window.SCScheduleTime.isBangteukSlot==='function'&&window.SCScheduleTime.isBangteukSlot(inst,row,{bangteukTable:isBangteukTable})) return true;
        if(typeof _isBangteukSlotKey==='function'&&_isBangteukSlotKey(t+'/'+day+'/'+lane+'/'+row)) return true;
      }
    }
    return false;
  };
  const isBangteukExtraRow=rowHasBangteukSlot();
  const btPreviewDayActive=day=>{
    if(!btPreviewExtraRow||typeof btPreviewLaneActive!=='function') return false;
    for(let lane=1;lane<=LANE_COUNT;lane++) if(_btPreviewLaneVisible(t,day,lane)) return true;
    return false;
  };
  // 정규 5행(ri 0~4) 이후는 반칸 높이 (추가 학생용)
  // 단, 엘마/방특 시간대의 정규 확장 줄은 풀 높이 유지
  if(ri>=baseSlotRows && !hasElmaInTime(t) && !isBangteukExtraRow) stuRow.classList.add('half-row');
  if(isBangteukExtraRow) stuRow.classList.add('bt-full-row');
  const curMonth=SCHEDULE_PERIODS[getCurrentPeriod()].month;

  const slotHasStoredContent=(day,lane,row)=>{
    const slotKey=t+'/'+day+'/'+lane+'/'+row;
    if(_attendanceMode&&_attendanceDate&&_isBangteukSlotKey(slotKey)&&!_bangteukClassActive(slotKey,_dayToCellDs(day))) return false;
    const inst=_ctxInst(ctx,t,day,lane);
    if(window.SCScheduleTime&&typeof window.SCScheduleTime.isBangteukSlot==='function'&&window.SCScheduleTime.isBangteukSlot(inst,row,{bangteukTable:isBangteukTable})) return true;
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
    const previewDayActive=btPreviewDayActive(day);
    const satSkip=isSat&&!satEmpty&&rows>5&&!kimhs&&ri>=5&&!rowHasContent&&!previewDayActive;
    const dayBlocked=!satSkip&&rows>baseSlotRows&&!kimhs&&ri>=baseSlotRows&&!rowHasContent&&!previewDayActive;

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
      const btSlotInst=_ctxInst(ctx,t,day,_l);
      const btStoredSlot=window.SCScheduleTime&&typeof window.SCScheduleTime.isBangteukSlot==='function'
        ? window.SCScheduleTime.isBangteukSlot(btSlotInst,_r,{bangteukTable:isBangteukTable})
        : false;
      const isBtCell=isBangteukTable||btStoredSlot||_isBangteukSlotKey(slotKey);
      const previewCellActive=btPreviewTime&&ri<6&&_btPreviewLaneVisible(t,day,_l);
      // 일반 레인 5행 초과는 기본적으로 blocked
      // 단, 실제 저장 데이터가 있는 칸은 6~8번이어도 가리지 않는다.
      let isBlocked=rows>baseSlotRows&&!isElma&&ri>=baseSlotRows&&!btStoredSlot&&!slotHasStoredContent(day,_l,_r);
      if(btPreviewExtraRow) isBlocked=!previewCellActive;
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
        if(storedBtExtraRow) td.classList.add('bt-slot-blocked');
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        stuRow.appendChild(td);
        continue;
      }

      if(previewCellActive&&ri>=baseSlotRows&&!slotHasStoredContent(day,_l,_r)){
        td.className='stu-cell dc bt-preview-active bt-preview-slot';
        td.innerHTML='<span class="bt-preview-chip">+ 방특</span>';
        td.dataset.t=t;
        td.dataset.day=day;
        td.dataset.lane=_l;
        td.dataset.ri=_r;
        if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
        td.addEventListener('click',function(e){
          e.stopPropagation();
          if(typeof toast==='function') toast('화면 테스트 전용입니다. 저장되지 않습니다.','ok');
        });
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
      const exactStu=getStu(t,day,_l,_r);
      const isBtGhost=!!(stu&&stu._btPreviewGhost);

      td.className='stu-cell dc stu-clickable';
      if(previewCellActive) td.classList.add('bt-preview-active','bt-preview-slot');
      if(isBtGhost) td.classList.add('bt-preview-ghost');
      // 출석 모드 상태 판단 (특수 배경 클래스 분기에 필요)
      const _attIsActive=_attendanceMode && _attendanceDate;
      const _cellDs=_attIsActive?_dayToCellDs(day):null;
      const btInfoVisible=isBtCell&&_bangteukInfoVisible(slotKey,_cellDs);
      // 출석 모드면 특수 배경/마크 클래스 적용 안 함 (흰 배경 유지)
      if(!_attIsActive){
        // 방특 묶음 미리보기 원생은 이름만 공유하고, 차량/신규/등원 배경은 현재 칸 데이터만 사용한다.
        const slotVisualStu=isBtGhost?exactStu:stu;
        const stuVehicle=slotVisualStu&&(slotVisualStu.v||_tableLocUsesVehicle(slotVisualStu.loc));
        if(stuVehicle) td.classList.add('stu-vehicle');
        if(btInfoVisible&&slotVisualStu&&slotVisualStu.paid) td.classList.add('stu-paid');
        if(!isBtCell&&slotVisualStu&&slotVisualStu.isNew&&slotVisualStu.isNew===curMonth) td.classList.add('stu-new');
        if(slotVisualStu&&(slotVisualStu.memo||stuVehicle||slotVisualStu.p||slotVisualStu.g)) td.classList.add('stu-has-note');
      }
      if(li===LANE_COUNT-1&&di<DAYS.length-1){td.classList.add('day-sep');if(_isTodayDay(day))td.classList.add('day-sep-today');}
      td.dataset.t=t;td.dataset.day=day;td.dataset.lane=_l;td.dataset.ri=_r;
      // 출석 모드에서는 각 요일 셀이 해당 주의 그 날짜로 작동 (모든 요일 활성)
      const _attDayMatch=_attIsActive;

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
              _attSub={type:_mark.sub.type, n:_mark.sub.n, a:_mark.sub.a,studentScheduleType:_mark.sub.studentScheduleType};
            }
          } else if(_mark.type==='bogang'||_mark.type==='sample'){
            if(_attPrimary){
              // 원생이 있으면 보강/샘플은 sub로 추가 표시
              _attSub={type:_mark.type, n:_mark.n, a:_mark.a,studentScheduleType:_mark.studentScheduleType};
            } else {
              // 원생 없으면 보강/샘플을 primary로
              _attPrimary={type:_mark.type, n:_mark.n, a:_mark.a,studentScheduleType:_mark.studentScheduleType};
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
        td.addEventListener('click',function(){
          if(isBtGhost){
            const src=stu.sourceDay?stu.sourceDay+'요일 원본 칸에서 수정해주세요.':'원본 칸에서 수정해주세요.';
            if(typeof toast==='function') toast('방특 묶음 미리보기입니다. '+src,'ok');
            return;
          }
          openStuPopup(this,t,day,_l,_r);
        });
      }

      // 등원(비신규) 빨간 배경 — 등원일까지만 (출석 모드에선 스킵)
      if(!isBtCell&&!_attIsActive && exactStu&&!td.classList.contains('stu-new')){
        if(exactStu.reenroll&&exactStu.reenroll===curMonth){
          td.classList.add('stu-enrolled');
        } else if(exactStu.enrolled&&exactStu.enrolled>=todayStr){
          td.classList.add('stu-enrolled');
        }
      }

      // ── 이벤트 수집 (그리드 뱃지) ──
      const btSlotMeta=typeof getBangteukSlotMeta==='function'?getBangteukSlotMeta(t,day,_l):null;
      const classDates=btSlotMeta&&typeof getClassDatesForDay==='function'
        ? getClassDatesForDay(btSlotMeta.group||day,{bangteukGroup:btSlotMeta.group,bangteukTabId:btSlotMeta.tabId})
        : classDatesCache[day];
      const allDates=[...classDates.cur,...classDates.next];
      const retEntry=RETIRE_MAP[slotKey];
      const retDs=(typeof retEntry==='string'?retEntry:retEntry?.ds)||null;
      const enrEntry=isBtCell?null:ENROLL_MAP[slotKey];
      const hasFutureRetire=!!(retDs&&retDs>=todayStr);
      const hasFutureEnroll=!!(enrEntry&&enrEntry.ds>todayStr);

      const badges=[];
      const _dl=ds=>{ const p=ds.slice(5).split('-'); return parseInt(p[0])+'/'+parseInt(p[1]); };

      // 출석 모드에서는 뱃지/마크 전부 숨김 (출석만 깔끔하게)
      const _skipBadges = _attendanceMode;
      const retireInline=!_skipBadges&&!!exactStu&&hasFutureRetire;
      const enrollInline=!_skipBadges&&!isBtGhost&&hasFutureEnroll&&!hasFutureRetire;

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
      if(!_skipBadges && hasFutureRetire && !retireInline){
        const dl=_dl(retDs), nm=_scheduleReservationName(retEntry,stu);
        const suffix=_retireReservationSuffix(retEntry,slotKey,stu);
        const label=nm?nm+'~'+dl+suffix:dl+suffix;
        badges.push({type:'retire', ds:retDs, text:label, tip:_retireReservationKindLabel(retEntry,slotKey,stu)+' '+label});
      }
      // 등원
      if(!_skipBadges && hasFutureEnroll && !enrollInline){
        const dl=_dl(enrEntry.ds), nm=_scheduleReservationName(enrEntry);
        const label=nm?nm+' '+dl+'부터~':dl+'부터~';
        badges.push({type:enrEntry.isNew?'enroll-new':'enroll', ds:enrEntry.ds, text:label, tip:'등록 '+label});
      }
      // 결석/보강/샘플
      if(!_skipBadges) allDates.forEach(d=>{
        if(d.closed||d.ds<todayStr) return;
        const mark=getMark(slotKey,d.ds);
        if(!mark) return;
        const dl=_dl(d.ds);
        if(mark.type==='absent'){
          const isAbsentRequest=typeof isParentAbsentRequestMark==='function'&&isParentAbsentRequestMark(mark);
          const label=typeof absentMarkLabel==='function'?absentMarkLabel(mark):'결석';
          const text=typeof absentMarkBadgeText==='function'?absentMarkBadgeText(mark,dl):dl;
          badges.push({type:isAbsentRequest?'pending-absent':'absent', ds:d.ds, text, tip:label+' '+dl});
          if(mark.sub){
            const nm=typeof bogangDisplayName==='function'&&mark.sub.type==='bogang'?bogangDisplayName(mark.sub):(mark.sub.n||'');
            let stip=(mark.sub.type==='bogang'?'보강 ':'샘플 ')+nm+(mark.sub.a?' '+mark.sub.a:'')+' '+dl;
            if(mark.sub.p) stip+='<br>'+esc(mark.sub.p);
            if(mark.sub.memo) stip+='<br>'+esc(mark.sub.memo);
            badges.push({type:mark.sub.type, ds:d.ds, text:nm+' '+dl, tip:stip});
          }
        } else if(mark.type==='bogang'||mark.type==='sample'){
          const nm=typeof bogangDisplayName==='function'&&mark.type==='bogang'?bogangDisplayName(mark):(mark.n||'');
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
      if(badges.some(b=>b.type==='pending-bogang'||b.type==='pending-cancel'||b.type==='pending-absent')){
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
                renderIcon(ps)+`<span class="att-nm">${esc(_attDisplayName(_attPrimary,slotKey,_cellDs))}${primaryTag}</span>`+
              `</div>`+
              `<div class="att-row att-row-sub ${subBg}${subSelected?' att-selected-row':''}" data-pk="sub">`+
                renderIcon(ss)+`<span class="att-nm">${esc(_attDisplayName(_attSub,slotKey,_cellDs))}${subTag}</span>`+
              `</div>`;
          } else {
            // 단일 렌더링 (Primary 또는 Sub 중 하나만)
            let html='';
            if(_attPrimary){
              const s=_attDisplayState(_attPrimary,slotKey,_cellDs,false);
              td.classList.add(_attDisplayBg(_attPrimary,s));
              if(_attBatchTargets.has(_attTargetId(slotKey,false,_attPrimary,_cellDs))) td.classList.add('att-selected-cell');
              const typeTag=_attDisplayTag(_attPrimary);
              html+=renderIcon(s)+`<span class="att-nm">${esc(_attDisplayName(_attPrimary,slotKey,_cellDs))}${typeTag}</span>`;
            }
            if(_attSub){
              const ss=_attDisplayState(_attSub,slotKey,_cellDs,true);
              const subTypeTag=_attSub.type==='bogang'?'보':_attSub.type==='sample'?'샘':_attSub.type==='hyuwon'?'휴':'';
              if(!_attPrimary && _attBatchTargets.has(_attTargetId(slotKey,true,_attSub,_cellDs))) td.classList.add('att-selected-cell');
              html+=` <span class="att-sub" data-pk="sub">[${renderIcon(ss)}${esc(_attDisplayName(_attSub,slotKey,_cellDs))}${subTypeTag}]</span>`;
            }
            td.innerHTML=html;
          }
        }
      } else if(stu){
        const prefix=namePrefix[slotKey]||'';
        const hideAgeForReservation=retireInline||enrollInline;
        let display=(prefix?prefix+'.':'')+_layoutStudentName(stu)+(hideAgeForReservation?'':(stu.a||''));
        if(retireInline) display+=' ~'+_dl(retDs)+_retireReservationSuffix(retEntry,slotKey,stu);
        let html=`<span class="stu-name-text${btInfoVisible&&(stu.btNew||stu.isNew)?' stu-bt-new-text':''}">${esc(display)}</span>`;
        if(enrollInline) html+=` <span class="stu-enroll-inline${enrEntry.isNew?' stu-enroll-inline-new':''}">${esc(_dl(enrEntry.ds)+'부터~')}</span>`;
        if(badgeHtml) html+=badgeHtml;
        td.innerHTML=html;
      } else if(enrollInline){
        const displayName=_scheduleReservationName(enrEntry)||'등록';
        const display=displayName+' '+_dl(enrEntry.ds)+'부터~';
        let html=`<span class="stu-name-text stu-enroll-inline${enrEntry.isNew?' stu-enroll-inline-new':''}">${esc(display)}</span>`;
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

function _rowHasRenderableContent(t,row,DAYS,LANE_COUNT,ctx){
  const isBangteukTable=typeof isBangteuk==='function'&&isBangteuk();
  for(const day of DAYS){
    for(let lane=1;lane<=LANE_COUNT;lane++){
      const slotKey=t+'/'+day+'/'+lane+'/'+row;
      if(_attendanceMode&&_attendanceDate&&_isBangteukSlotKey(slotKey)&&!_bangteukClassActive(slotKey,_dayToCellDs(day))) continue;
      const inst=_ctxInst(ctx,t,day,lane);
      if(window.SCScheduleTime&&typeof window.SCScheduleTime.isBangteukSlot==='function'&&window.SCScheduleTime.isBangteukSlot(inst,row,{bangteukTable:isBangteukTable})) return true;
      if(_ctxStu(ctx,t,day,lane,row)) return true;
      if(RETIRE_MAP[slotKey]||ENROLL_MAP[slotKey]||HYUWON_MAP[slotKey]) return true;
      if(_attendanceMode && _attendanceDate){
        const ds=_dayToCellDs(day);
        if(ds && _attGuestAtSlot(t,day,lane,slotKey,ds)) return true;
      }
      const markPrefix=slotKey+'/';
      if(Object.keys(MARK_MAP||{}).some(k=>k.startsWith(markPrefix))) return true;
    }
  }
  return false;
}
function _trimEmptyTrailingRows(t,rows,DAYS,LANE_COUNT,ctx){
  const baseRows=(typeof isBangteuk==='function'&&isBangteuk())?6:5;
  if(typeof hasElmaInTime==='function'&&hasElmaInTime(t)) return rows;
  if(typeof _btPreviewTimeVisible==='function'&&_btPreviewTimeVisible(t)) return rows;
  let next=rows;
  while(next>baseRows&&!_rowHasRenderableContent(t,next,DAYS,LANE_COUNT,ctx)){
    next--;
  }
  return next;
}

function buildTable(){
  const DAYS=getDays(),TIMES=getTimes(),SAT_TIME_LABEL=getSatLabel(),HAS_NUM=getHasNum(),LANE_COUNT=getLanes();

  // 타임머신은 실제 원본이 아닌 복제본만 계산해 화면에 사용한다.
  let _tmBackup = null;
  if(typeof _fakeDate !== 'undefined' && _fakeDate){
    _tmBackup = {
      stu:STUDENTS,
      enroll:ENROLL_MAP,
      retire:RETIRE_MAP,
      hyuwon:HYUWON_MAP,
    };
    const preview=_buildStudentDatePreview(toDateStr(getToday()),SCHEDULE_PERIODS[getCurrentPeriod()]);
    STUDENTS=preview.students;
    ENROLL_MAP=preview.enroll;
    RETIRE_MAP=preview.retire;
    HYUWON_MAP=preview.hyuwon;
    rebuildStuIdx();
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
  const savedScrollLeft=_tblOuter?_tblOuter.scrollLeft:0;
  const savedScrollTop=_tblOuter?_tblOuter.scrollTop:0;
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
    if(_btPreviewTimeVisible(t)){
      rows=Math.max(rows,6);
    }
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
    rows=_trimEmptyTrailingRows(t,rows,DAYS,LANE_COUNT,{attendanceBasisByDay:_attendanceBasisByDay});
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

  // 후처리: 기록 영역까지 다시 붙인 뒤 스크롤 복원, 프록시, 오늘 컬럼 프레임, 플래시
  updateProxyPosition();
  drawTodayColFrame();
  if(typeof renderScheduleAuditSummary==='function') renderScheduleAuditSummary();
  if(_tblOuter){
    const maxTop=Math.max(0,_tblOuter.scrollHeight-_tblOuter.clientHeight);
    _tblOuter.scrollTop=Math.min(savedScrollTop,maxTop);
    _tblOuter.scrollLeft=savedScrollLeft;
    if(_proxy) _proxy.scrollLeft=savedScrollLeft;
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
  try{ renderMobileScheduleView({attendanceBasisByDay:_attendanceBasisByDay}); }catch(e){ console.warn('[mobile schedule]', e); }
  updateParentReqCount();

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

  // 타임머신 화면용 복제본을 버리고 실제 원본 참조를 복원
  if(_tmBackup){
    STUDENTS=_tmBackup.stu;
    ENROLL_MAP=_tmBackup.enroll;
    RETIRE_MAP=_tmBackup.retire;
    HYUWON_MAP=_tmBackup.hyuwon;
    rebuildStuIdx();
  }
}

let _mobileScheduleDay='';
function _mobileSlotKey(t,day,lane,row){
  return [t,day,lane,row].join('/');
}
function _mobileShortDate(ds){
  if(!ds) return '';
  const p=String(ds).slice(5).split('-');
  const m=parseInt(p[0],10);
  const d=parseInt(p[1],10);
  return m&&d ? `${m}/${d}` : String(ds);
}
function _mobileTimeLabel(day,time){
  try{
    if(window.SCScheduleTime&&typeof window.SCScheduleTime.displayTimeForDay==='function'){
      return window.SCScheduleTime.displayTimeForDay(day,time)||time;
    }
  }catch(e){}
  return time;
}
function _mobileTabLabel(){
  try{
    const tab=(_tabList||[]).find(t=>t&&t.id===_activeTab);
    if(!tab) return '';
    if(tab.type==='bangteuk'&&tab.seasonStart&&tab.seasonEnd){
      return `${tab.name||'방특 시간표'} · ${_mobileShortDate(tab.seasonStart)}~${_mobileShortDate(tab.seasonEnd)}`;
    }
    return tab.name||'정규시간표';
  }catch(e){return '';}
}
function _mobileInstText(inst){
  const text=instDisplay(inst);
  return text ? text.replace(/^\d\)/,'') : '';
}
function _mobileInstClass(inst){
  try{
    if(typeof instClass==='function') return instClass(inst);
  }catch(e){}
  return 'i-none';
}
function _mobileSlotBadges(slotKey,day){
  const badges=[];
  const todayStr=toDateStr(getToday());
  const dates=typeof getClassDatesForDay==='function' ? getClassDatesForDay(day) : {cur:[],next:[]};
  const allDates=[...(dates.cur||[]),...(dates.next||[])];
  const hyuwon=HYUWON_MAP&&HYUWON_MAP[slotKey];
  if(hyuwon&&Array.isArray(hyuwon.dates)){
    hyuwon.dates
      .filter(ds=>ds>=todayStr)
      .slice(0,2)
      .forEach(ds=>badges.push({type:'hyuwon',text:`휴 ${_mobileShortDate(ds)}`}));
  }
  allDates.forEach(d=>{
    if(!d||d.closed||d.ds<todayStr) return;
    const mark=typeof getMark==='function'?getMark(slotKey,d.ds):null;
    if(!mark) return;
    const dl=_mobileShortDate(d.ds);
    if(mark.type==='absent'){
      const label=typeof absentMarkLabel==='function'?absentMarkLabel(mark):'결석';
      const isAbsentRequest=typeof isParentAbsentRequestMark==='function'&&isParentAbsentRequestMark(mark);
      badges.push({type:isAbsentRequest?'pending-absent':'absent',text:`${isAbsentRequest?'⏳ ':''}${label} ${dl}`,name:mark.n||mark.name||''});
      if(mark.sub){
        const subType=mark.sub.type==='sample'?'sample':'bogang';
        const subName=subType==='bogang'&&typeof bogangDisplayName==='function'?bogangDisplayName(mark.sub):(mark.sub.n||'');
        badges.push({type:subType,text:`${subType==='sample'?'샘':'보'} ${subName} ${dl}`.trim(),name:subName});
      }
    }else if(mark.type==='bogang'||mark.type==='sample'){
      const markName=mark.type==='bogang'&&typeof bogangDisplayName==='function'?bogangDisplayName(mark):(mark.n||mark.name||'');
      badges.push({type:mark.type,text:`${mark.type==='sample'?'샘':'보'} ${markName} ${dl}`.trim(),name:markName});
    }
  });
  return badges.slice(0,4);
}
function _mobileBadgeLabel(badges){
  const names=[];
  (badges||[]).forEach(b=>{
    const nm=(b&&b.name?String(b.name):'').trim();
    if(nm&&!names.includes(nm)) names.push(nm);
  });
  return names.join(', ');
}
function _mobileStudentText(stu){
  if(!stu) return '';
  return `${_layoutStudentName(stu)}${stu.a||''}`.trim();
}
function _mobileStudentType(stu,enroll,badges,todayStr){
    if(stu){
    const classes=[];
    const slotKey=stu.t+'/'+stu.d+'/'+stu.l+'/'+stu.r;
    const isBt=_isBangteukSlotKey(stu.t+'/'+stu.d+'/'+stu.l+'/'+stu.r);
    const btInfoVisible=isBt&&_bangteukInfoVisible(slotKey,todayStr);
    if(btInfoVisible&&stu.paid) classes.push('paid');
    if(stu.v||_tableLocUsesVehicle(stu.loc)) classes.push('vehicle');
    if(btInfoVisible&&(stu.btNew||stu.isNew)){
      classes.push('bt-new');
      return classes.join(' ')||'bt-new';
    }
    if(!isBt){
      try{
        const curMonth=(SCHEDULE_PERIODS[getCurrentPeriod()]||{}).month;
        if(stu.isNew&&stu.isNew===curMonth){classes.push('new');return classes.join(' ');}
        if(stu.reenroll&&stu.reenroll===curMonth){classes.push('enrolled');return classes.join(' ');}
      }catch(e){}
      if(stu.enrolled&&stu.enrolled>=todayStr){classes.push('enrolled');return classes.join(' ');}
    }
    return classes.join(' ')||'student';
  }
  if(badges&&badges.length&&badges.every(b=>b.type==='bogang')) return 'bogang-only';
  if(enroll) return enroll.isNew?'enroll-new':'enroll';
  return 'badge-only';
}
function _mobileCellItems(ctx,t,day,lane,row){
  const slotKey=_mobileSlotKey(t,day,lane,row);
  const isBtCell=_isBangteukSlotKey(slotKey);
  const stu=_ctxStu(ctx,t,day,lane,row);
  const enroll=!isBtCell&&ENROLL_MAP&&ENROLL_MAP[slotKey];
  const retire=RETIRE_MAP&&RETIRE_MAP[slotKey];
  const badges=_mobileSlotBadges(slotKey,day);
  const items=[];
  const todayStr=toDateStr(getToday());
  if(stu){
    const chips=[...badges];
    const retDs=(typeof retire==='string'?retire:retire?.ds)||'';
    if(retDs&&retDs>=todayStr) chips.unshift({type:'retire',text:`~${_mobileShortDate(retDs)}까지`});
    const enrDs=enroll&&enroll.ds;
    if(enrDs&&enrDs>todayStr) chips.unshift({type:enroll.isNew?'enroll-new':'enroll',text:`${_mobileShortDate(enrDs)}부터`});
    items.push({row,label:_mobileStudentText(stu),type:_mobileStudentType(stu,enroll,chips,todayStr),chips});
  }else if(enroll&&enroll.ds>=todayStr){
    items.push({
      row,
      label:`${enroll.name||'등록'}${enroll.age||''}`.trim(),
      type:enroll.isNew?'enroll-new':'enroll',
      chips:[{type:enroll.isNew?'enroll-new':'enroll',text:`${_mobileShortDate(enroll.ds)}부터`},...badges]
    });
  }else if(retire){
    const retDs=(typeof retire==='string'?retire:retire?.ds)||'';
    const nm=_scheduleReservationName(retire,null)||'제외';
    if(retDs>=todayStr){
      items.push({row,label:nm,type:'retire',chips:[{type:'retire',text:`~${_mobileShortDate(retDs)}까지`},...badges]});
    }
  }else if(badges.length){
    items.push({row,label:_mobileBadgeLabel(badges),type:_mobileStudentType(null,null,badges,todayStr),chips:badges});
  }
  return items;
}
function _mobileRenderTimeCard(ctx,t,day,lanes){
  const rows=getTimeRows(t);
  const laneHtml=[];
  for(let lane=1;lane<=lanes;lane++){
    const inst=_ctxInst(ctx,t,day,lane);
    const teacher=_mobileInstText(inst);
    const teacherClass=_mobileInstClass(inst);
    const items=[];
    for(let row=1;row<=rows;row++){
      items.push(..._mobileCellItems(ctx,t,day,lane,row));
    }
    if(!teacher&&!items.length) continue;
    const itemHtml=items.map(item=>{
      const chips=(item.chips||[]).map(chip=>`<span class="mobile-schedule-chip ${esc(chip.type||'')}">${esc(chip.text||'')}</span>`).join('');
      const label=item.label?`<b>${esc(item.label)}</b>`:'';
      return `<div class="mobile-schedule-student ${esc(item.type||'')}">${label}${chips}</div>`;
    }).join('');
    laneHtml.push(`<section class="mobile-schedule-lane">
      <div class="mobile-schedule-lane-head"><strong class="${esc(teacherClass)}">${teacher?esc(teacher):`${lane}레인`}</strong></div>
      <div class="mobile-schedule-students">${itemHtml||'<span class="mobile-schedule-empty">원생 없음</span>'}</div>
    </section>`);
  }
  if(!laneHtml.length) return '';
  return `<article class="mobile-schedule-time">
    <h3>${esc(`${day} ${_mobileTimeLabel(day,t)}`)}</h3>
    <div class="mobile-schedule-lanes">${laneHtml.join('')}</div>
  </article>`;
}
function _updateMobileTableButton(){
  const btn=document.getElementById('mobile-schedule-table-toggle');
  if(!btn) return;
  const tableMode=document.body.classList.contains('mobile-table-mode');
  btn.textContent=tableMode?'모바일뷰':'표 보기';
  btn.setAttribute('aria-pressed',tableMode?'true':'false');
}
function toggleMobileTableView(){
  document.body.classList.toggle('mobile-table-mode');
  _updateMobileTableButton();
  try{ updateProxyPosition(); }catch(e){}
}
function setMobileScheduleDay(day){
  _mobileScheduleDay=day;
  renderMobileScheduleView();
}
function renderMobileScheduleView(ctx){
  const root=document.getElementById('mobile-schedule-view');
  if(!root) return;
  const days=typeof getDays==='function'?getDays():[];
  if(!days.length){
    root.classList.add('is-empty');
    return;
  }
  if(!_mobileScheduleDay||!days.includes(_mobileScheduleDay)) _mobileScheduleDay=days[0];
  const day=_mobileScheduleDay;
  const title=document.getElementById('mobile-schedule-title');
  const sub=document.getElementById('mobile-schedule-sub');
  const daysEl=document.getElementById('mobile-schedule-days');
  const body=document.getElementById('mobile-schedule-body');
  const dateHeaders=typeof getDateHeaders==='function'?getDateHeaders():{};
  if(title) title.textContent=_mobileTabLabel()||'모바일 시간표';
  if(sub) sub.textContent=(dateHeaders[day]&&dateHeaders[day].label)?dateHeaders[day].label:day;
  if(daysEl){
    daysEl.innerHTML=days.map(d=>`<button type="button" class="${d===day?'active':''}" data-mobile-day="${esc(d)}" aria-pressed="${d===day?'true':'false'}">${esc(d)}</button>`).join('');
    daysEl.querySelectorAll('[data-mobile-day]').forEach(btn=>{
      btn.onclick=()=>setMobileScheduleDay(btn.dataset.mobileDay||'');
    });
  }
  if(body){
    const renderCtx=ctx||{};
    const times=(typeof getTimes==='function'?getTimes():[]).map(v=>v&&v.t?v.t:String(v||'')).filter(Boolean);
    const lanes=typeof getLanes==='function'?getLanes():5;
    const html=times.map(t=>_mobileRenderTimeCard(renderCtx,t,day,lanes)).filter(Boolean).join('');
    body.innerHTML=html||'<div class="mobile-schedule-none">표시할 수업이 없습니다.</div>';
  }
  _updateMobileTableButton();
}

function updateParentReqCount(){
  const btn=document.getElementById('parent-req-cnt');
  if(!btn) return;
  const pending=Object.values(REQUESTS||{}).filter(r=>!r.status||r.status==='pending').length;
  if(pending>0){
    btn.textContent=pending;
    btn.hidden=false;
  } else {
    btn.hidden=true;
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
function _summaryRowsForInst(inst,time){
  if(window.SCScheduleTime&&typeof window.SCScheduleTime.slotRowsForInst==='function') return window.SCScheduleTime.slotRowsForInst(inst,{bangteukTable:typeof isBangteuk==='function'&&isBangteuk()});
  if(typeof isBangteuk==='function' && isBangteuk()) return 6;
  if(typeof getInstCls==='function' && getInstCls(inst)) return 8;
  return 5;
}
function _summaryIsBangteukInst(inst){
  if(window.SCScheduleTime&&typeof window.SCScheduleTime.isBangteukInst==='function') return window.SCScheduleTime.isBangteukInst(inst);
  return typeof isBangteukInst==='function'&&isBangteukInst(inst);
}
function _summaryIsBangteukPreviewSlot(t,day,lane,row){
  const n=parseInt(row,10);
  return Number.isFinite(n)&&n>=1&&n<=6&&typeof btPreviewLaneActive==='function'&&btPreviewLaneActive(t,day,lane);
}
function _summaryIsBangteukGroupDay(day){
  const text=String(day||'').replace(/[\/\s]/g,'');
  return text==='월수금'||text==='화목';
}
function _summaryIsBangteukSlotKey(slotKey){
  const p=String(slotKey||'').split('/');
  if(p.length<4) return false;
  if(_summaryIsBangteukGroupDay(p[1])) return true;
  if(_summaryIsBangteukPreviewSlot(p[0],p[1],parseInt(p[2],10),p[3])) return true;
  const inst=INST_MAP&&INST_MAP[p.slice(0,3).join('/')];
  if(window.SCScheduleTime&&typeof window.SCScheduleTime.isBangteukSlot==='function') return window.SCScheduleTime.isBangteukSlot(inst,p[3],{bangteukTable:typeof isBangteuk==='function'&&isBangteuk()});
  return _summaryIsBangteukInst(inst)&&parseInt(p[3],10)>=1&&parseInt(p[3],10)<=6;
}
function _summaryIsTemporaryOnly(entry){
  if(!entry||typeof entry!=='object') return false;
  if(entry.bogangOnly||entry.makeupOnly||entry.sampleOnly) return true;
  const kind=String(entry.type||entry.kind||entry.status||'').trim().toLowerCase();
  return kind==='bogang'||kind==='makeup'||kind==='보강'||kind==='sample'||kind==='샘플';
}
function _summaryStudentKey(stu){
  const person=_summaryRecordPerson(stu,null);
  const name=String(person.n||'').trim();
  if(!name) return '';
  return name+'|'+_summaryNormPhone(person.p);
}
function _summaryMergeRows(map,fromKey,toKey){
  if(!fromKey||!toKey||fromKey===toKey||!map.has(fromKey)) return;
  const from=map.get(fromKey);
  if(!map.has(toKey)){
    from.key=toKey;
    map.delete(fromKey);
    map.set(toKey,from);
    return;
  }
  const to=map.get(toKey);
  if(!to.n&&from.n) to.n=from.n;
  if(!to.p&&from.p) to.p=from.p;
  to.counted=!!(to.counted||from.counted);
  (from.states||new Set()).forEach(v=>to.states.add(v));
  (from.slots||[]).forEach(slot=>{
    if(!to.slots.some(saved=>saved.key===slot.key)) to.slots.push(slot);
  });
  map.delete(fromKey);
}
function _summaryExistingPhoneKey(map,name){
  if(!name) return '';
  const prefix=name+'|';
  const matches=[...map.keys()].filter(key=>key.startsWith(prefix)&&key!==prefix);
  return matches.length===1 ? matches[0] : '';
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
function _retireReservationIsActual(entry,slotKey,fallback){
  if(!entry) return false;
  if(entry.retireType==='retire') return true;
  if(entry.retireType==='exclude') return false;
  if(_summaryIsMoveEntry(entry)) return false;
  const ds=typeof entry==='string'?entry:entry.ds;
  const person=_summaryRecordPerson(entry,fallback);
  const name=String(person.n||'').trim();
  const phone=_summaryNormPhone(person.p);
  return Array.isArray(RETIRE_HISTORY)&&RETIRE_HISTORY.some(r=>{
    if((r.retiredAt||'')!==ds) return false;
    if(name&&String(r.n||'').trim()!==name) return false;
    const rPhone=_summaryNormPhone(r.p);
    if(phone&&rPhone&&phone!==rPhone) return false;
    if(slotKey){
      const rSlot=[r.t,r.d,r.l,r.r].map(v=>String(v||'')).join('/');
      if(rSlot&&rSlot!==slotKey) return false;
    }
    return true;
  });
}
function _retireReservationSuffix(entry,slotKey,fallback){
  return _retireReservationIsActual(entry,slotKey,fallback)?'퇴원':'까지';
}
function _retireReservationReason(entry){
  if(!entry||typeof entry!=='object') return '';
  if(entry.excludeReason==='reduce') return 'reduce';
  if(entry.excludeReason==='move'||_summaryIsMoveEntry(entry)) return 'move';
  return '';
}
function _retireReservationKindLabel(entry,slotKey,fallback){
  if(_retireReservationIsActual(entry,slotKey,fallback)) return '퇴원';
  const reason=_retireReservationReason(entry);
  if(reason==='reduce') return '횟수줄임';
  if(reason==='move') return '이동';
  return '제외';
}
function _summaryRetireStatus(entry,isChange){
  if(entry?.retireType==='exclude'||isChange||_summaryIsMoveEntry(entry)){
    const reason=_retireReservationReason(entry);
    if(reason==='reduce') return '횟수줄임예정';
    if(reason==='move'||isChange||_summaryIsMoveEntry(entry)) return '이동예정';
    return '제외예정';
  }
  return '퇴원예정';
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
function _summaryEntryMatchesPerson(entry,fallback,target){
  const a=_summaryRecordPerson(entry,fallback);
  const b=_summaryRecordPerson(target,null);
  const aName=String(a.n||'').trim();
  const bName=String(b.n||'').trim();
  if(aName&&bName&&aName!==bName) return false;
  const aPhone=_summaryNormPhone(a.p);
  const bPhone=_summaryNormPhone(b.p);
  if(aPhone&&bPhone&&aPhone!==bPhone) return false;
  return !!(aName||bName);
}
function _summaryDisplayTimeForDay(day,time){
  try{
    if(window.SCScheduleTime&&typeof window.SCScheduleTime.displayTimeForDay==='function'){
      return window.SCScheduleTime.displayTimeForDay(day,time)||time;
    }
  }catch(e){}
  return time;
}
function _summarySlotInfo(slotKey,dateText,teacherName){
  const p=String(slotKey||'').split('/');
  const day=p[1]||'';
  const displayTime=_summaryDisplayTimeForDay(day,p[0]||'');
  const hour=String(displayTime||p[0]||'').replace(/[^\d]/g,'')||String(displayTime||p[0]||'');
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
  const person=_summaryRecordPerson(rec,null);
  const name=String(person.n||'').trim();
  const phone=_summaryNormPhone(person.p);
  let key=_summaryStudentKey(rec);
  if(!key) return;
  const noPhoneKey=name?name+'|':'';
  if(name&&phone){
    _summaryMergeRows(map,noPhoneKey,key);
  }else if(name&&!phone){
    const existingPhoneKey=_summaryExistingPhoneKey(map,name);
    if(existingPhoneKey) key=existingPhoneKey;
  }
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
  const regularInstRowsByKey={};
  const bangteukInstRowsByKey={};
  let regularCapacity=0;
  let bangteukCapacity=0;
  const bangteukTable=typeof isBangteuk==='function'&&isBangteuk();
  const days=typeof getDays==='function'?getDays():[];
  const lanes=typeof getLanes==='function'?getLanes():0;
  const timeSet=new Set((typeof getTimes==='function'?getTimes():[]).map(v=>v&&v.t?v.t:String(v||'')).filter(Boolean));
  Object.keys(INST_MAP||{}).forEach(key=>{
    const p=String(key||'').split('/');
    if(p.length>=3&&days.includes(p[1])) timeSet.add(p[0]);
  });
  const times=[...timeSet].sort((a,b)=>{
    if(window.SCScheduleTime&&typeof window.SCScheduleTime.compareTimes==='function') return window.SCScheduleTime.compareTimes('',a,b);
    return parseInt(a,10)-parseInt(b,10);
  });

  times.forEach(t=>{
    days.forEach(day=>{
      for(let lane=1;lane<=lanes;lane++){
        const instKey=t+'/'+day+'/'+lane;
        const inst=INST_MAP&&INST_MAP[instKey];
        if(!_summaryInstExists(inst)) continue;
        const isBangteukClass=bangteukTable
          || _summaryIsBangteukGroupDay(day)
          || _summaryIsBangteukInst(inst)
          || (typeof btPreviewLaneActive==='function'&&btPreviewLaneActive(t,day,lane));
        const rows=isBangteukClass?6:_summaryRowsForInst(inst,t);
        const rowsByKey=isBangteukClass?bangteukInstRowsByKey:regularInstRowsByKey;
        rowsByKey[instKey]=rows;
        for(let row=1;row<=rows;row++){
          if(DISABLED_MAP&&DISABLED_MAP[instKey+'/'+row]) continue;
          if(isBangteukClass) bangteukCapacity++;
          else regularCapacity++;
        }
      }
    });
  });

  const isSaturdaySlot=slotKey=>String(slotKey||'').split('/')[1]==='토';
  const validSaturdayTime=time=>{
    if(!window.SCScheduleTime||!window.SCScheduleTime.SAT_INTERNAL_TO_DISPLAY) return true;
    const base=typeof window.SCScheduleTime.normalizeTimeBase==='function'?window.SCScheduleTime.normalizeTimeBase(time):String(time||'');
    return !!window.SCScheduleTime.SAT_INTERNAL_TO_DISPLAY[base];
  };
  const slotVisibility=slotKey=>{
    const p=String(slotKey||'').split('/');
    const saturday=p[1]==='토';
    if(p.length<4) return {visible:false,saturday,reason:'슬롯 형식 오류'};
    const bangteuk=_summaryIsBangteukGroupDay(p[1])||_summaryIsBangteukSlotKey(slotKey);
    if(!days.includes(p[1])) return {visible:false,saturday,reason:'현재 시간표 요일 아님'};
    if(!times.includes(p[0]) || (saturday&&!validSaturdayTime(p[0]))) return {visible:false,saturday,reason:'현재 시간표 시간 밖'};
    const lane=parseInt(p[2],10);
    if(!Number.isFinite(lane)||lane<1||lane>lanes) return {visible:false,saturday,reason:'현재 시간표 레인 밖'};
    const instKey=p[0]+'/'+p[1]+'/'+p[2];
    const maxRows=(bangteuk?bangteukInstRowsByKey:regularInstRowsByKey)[instKey];
    if(!maxRows) return {visible:false,saturday,bangteuk,reason:'담임 없는 칸'};
    const row=parseInt(p[3],10);
    if(!Number.isFinite(row) || row<1 || row>maxRows) return {visible:false,saturday,bangteuk,reason:'현재 시간표 번호 밖'};
    if(DISABLED_MAP&&DISABLED_MAP[instKey+'/'+row]) return {visible:false,saturday,bangteuk,reason:'비활성 칸'};
    return {visible:true,saturday,bangteuk,reason:''};
  };
  const activeRetireSlots=new Map();
  Object.entries(RETIRE_MAP||{}).forEach(([slotKey,entry])=>{
    if(!entry) return;
    activeRetireSlots.set(slotKey,entry);
  });
  const enrollPersonKeys=new Set();
  Object.entries(ENROLL_MAP||{}).forEach(([slotKey,entry])=>{
    if(!entry||_summaryIsTemporaryOnly(entry)) return;
    const key=_summaryEntryPersonKey(entry,_summaryPairFallback(entry,RETIRE_MAP));
    if(key) enrollPersonKeys.add(key);
  });

  const hiddenPeople=new Map();
  const bangteukPeople=new Map();
  const bangteukOccupiedSlots=new Set();
  const addBangteukPerson=(entry,slotKey,fallback,visible)=>{
    _summaryAddPerson(bangteukPeople,_summaryRecord(entry,'방특',slotKey,'',fallback),true);
    if(visible) bangteukOccupiedSlots.add(slotKey);
  };
  const addHiddenSaturday=(entry,slotKey,fallback,reason)=>{
    if(!isSaturdaySlot(slotKey)) return;
    _summaryAddPerson(hiddenPeople,_summaryRecord(entry,'숨김후보',slotKey,reason||'시간표 밖',fallback),false);
  };
  const actualBySlot=new Map();
  (Array.isArray(STUDENTS)?STUDENTS:[]).forEach(stu=>{
    if(!stu || !stu.n || _summaryIsTemporaryOnly(stu)) return;
    const slotKey=String(stu.t||'')+'/'+String(stu.d||'')+'/'+String(stu.l||'')+'/'+String(stu.r||'');
    const visibility=slotVisibility(slotKey);
    if(visibility.bangteuk){
      if(visibility.visible) addBangteukPerson(stu,slotKey,null,true);
      return;
    }
    if(visibility.visible) actualBySlot.set(slotKey,stu);
    else if(visibility.saturday) addHiddenSaturday(stu,slotKey,null,visibility.reason);
  });

  const occupiedSlots=new Set();
  const countedPeople=new Map();
  const excludedPeople=new Map();

  actualBySlot.forEach((stu,slotKey)=>{
    const retireEntry=activeRetireSlots.get(slotKey);
    const retire=retireEntry&&_summaryEntryMatchesPerson(retireEntry,stu,stu)?retireEntry:null;
    const enroll=ENROLL_MAP&&ENROLL_MAP[slotKey];
    if(enroll&&_summaryEntryMatchesPerson(enroll,null,stu)) return;
    if(retire){
      const ds=typeof retire==='string'?retire:retire.ds;
      const isChange=enrollPersonKeys.has(_summaryEntryPersonKey(retire,stu));
      _summaryAddPerson(excludedPeople,_summaryRecord(retire,_summaryRetireStatus(retire,isChange),slotKey,_summaryDate(ds)+_retireReservationSuffix(retire,slotKey,stu),stu),false);
      return;
    }
    occupiedSlots.add(slotKey);
    _summaryAddPerson(countedPeople,_summaryRecord(stu,'재원',slotKey,''),true);
  });

  Object.entries(ENROLL_MAP||{}).forEach(([slotKey,entry])=>{
    if(!entry||_summaryIsTemporaryOnly(entry)) return;
    const visibility=slotVisibility(slotKey);
    if(visibility.bangteuk){
      if(visibility.visible) addBangteukPerson(entry,slotKey,null,true);
      return;
    }
    if(visibility.saturday&&!visibility.visible){
      addHiddenSaturday(entry,slotKey,null,visibility.reason);
      return;
    }
    if(visibility.visible) occupiedSlots.add(slotKey);
    const ds=typeof entry==='string'?entry:entry.ds;
    _summaryAddPerson(countedPeople,_summaryRecord(entry,_summaryEnrollStatus(entry),slotKey,_summaryDate(ds)+'부터'),true);
  });

  activeRetireSlots.forEach((entry,slotKey)=>{
    if(actualBySlot.has(slotKey)) return;
    const visibility=slotVisibility(slotKey);
    if(visibility.bangteuk) return;
    const ds=typeof entry==='string'?entry:entry.ds;
    const fallback=_summaryPairFallback(entry,ENROLL_MAP);
    if(visibility.saturday&&!visibility.visible){
      addHiddenSaturday(entry,slotKey,fallback,visibility.reason);
      return;
    }
    const isChange=enrollPersonKeys.has(_summaryEntryPersonKey(entry,fallback));
    _summaryAddPerson(excludedPeople,_summaryRecord(entry,_summaryRetireStatus(entry,isChange),slotKey,_summaryDate(ds)+_retireReservationSuffix(entry,slotKey,fallback),fallback),false);
  });

  const countedRows=_summaryRowsFromMap(countedPeople);
  const excludedRows=_summaryRowsFromMap(excludedPeople);
  const hiddenRows=_summaryRowsFromMap(hiddenPeople);
  const bangteukRows=_summaryRowsFromMap(bangteukPeople);
  const countedKeys=new Set(countedRows.map(row=>row.key));
  const excludedOnlyRows=excludedRows.filter(row=>!countedKeys.has(row.key));
  const regularHours=occupiedSlots.size;
  const bangteukHours=bangteukOccupiedSlots.size;
  return {
    hours:regularHours,
    capacity:regularCapacity,
    regularHours,
    regularCapacity,
    bangteukHours,
    bangteukCapacity,
    countedRows,
    excludedRows,
    hiddenRows,
    bangteukRows,
    excludedOnlyRows,
    averageHours:countedRows.length ? occupiedSlots.size/countedRows.length : 0,
  };
}
function updateScheduleSummary(){
  const hoursEl=document.getElementById('schedule-class-hours');
  const bangteukHoursEl=document.getElementById('schedule-bangteuk-hours');
  const studentsEl=document.getElementById('schedule-student-total');
  const bangteukEl=document.getElementById('schedule-bangteuk-total');
  if(!hoursEl && !bangteukHoursEl && !studentsEl && !bangteukEl) return;
  const data=getScheduleSummaryData();
  if(hoursEl) hoursEl.textContent=_summaryNumber(data.regularHours)+'/'+_summaryNumber(data.regularCapacity);
  if(bangteukHoursEl) bangteukHoursEl.textContent=_summaryNumber(data.bangteukHours)+'/'+_summaryNumber(data.bangteukCapacity);
  if(studentsEl) studentsEl.textContent=_summaryNumber(data.countedRows.length);
  if(bangteukEl) bangteukEl.textContent=_summaryNumber((data.bangteukRows||[]).length);
}

function _scheduleStudentRowsForModal(){
  const data=getScheduleSummaryData();
  const contactMap=new Map();
  const rewriteContactMemberKeys=(row,oldPersonKey,newPersonKey)=>{
    if(!row||!oldPersonKey||!newPersonKey||oldPersonKey===newPersonKey) return;
    const nextMembers=new Map();
    (row.members||new Map()).forEach((member,key)=>{
      const nextKey=String(key).startsWith(oldPersonKey+'|')
        ? newPersonKey+String(key).slice(oldPersonKey.length)
        : key;
      if(!nextMembers.has(nextKey)){
        nextMembers.set(nextKey,member);
        return;
      }
      const target=nextMembers.get(nextKey);
      (member.dates||new Set()).forEach(v=>target.dates.add(v));
      (member.slots||[]).forEach(slot=>{
        if(!target.slots.some(saved=>saved.key===slot.key)) target.slots.push(slot);
      });
    });
    row.members=nextMembers;
  };
  const mergeContacts=(fromKey,toKey)=>{
    if(!fromKey||!toKey||fromKey===toKey||!contactMap.has(fromKey)) return;
    const from=contactMap.get(fromKey);
    const fromPerson=fromKey.startsWith('person:')?fromKey.slice('person:'.length):'';
    const toPerson=toKey.startsWith('person:')?toKey.slice('person:'.length):'';
    rewriteContactMemberKeys(from,fromPerson,toPerson);
    if(!contactMap.has(toKey)){
      from.key=toKey;
      contactMap.delete(fromKey);
      contactMap.set(toKey,from);
      return;
    }
    const to=contactMap.get(toKey);
    if(!to.p&&from.p) to.p=from.p;
    to.countedCount+=from.countedCount||0;
    to.excludedCount+=from.excludedCount||0;
    to.hiddenCount+=from.hiddenCount||0;
    to.bangteukCount+=from.bangteukCount||0;
    (from.members||new Map()).forEach((member,key)=>{
      if(!to.members.has(key)){
        to.members.set(key,member);
        return;
      }
      const target=to.members.get(key);
      (member.dates||new Set()).forEach(v=>target.dates.add(v));
      (member.slots||[]).forEach(slot=>{
        if(!target.slots.some(saved=>saved.key===slot.key)) target.slots.push(slot);
      });
    });
    to.searchParts.push(...(from.searchParts||[]));
    contactMap.delete(fromKey);
  };
  const existingContactPhoneKey=name=>{
    const prefix='person:'+name+'|';
    const matches=[...contactMap.keys()].filter(key=>key.startsWith(prefix)&&key!==prefix);
    return matches.length===1 ? matches[0] : '';
  };
  const addRow=(row,counted,kind)=>{
    const rawPhone=String(row.p||'').trim();
    const phone=(typeof normPhone==='function'?normPhone(rawPhone):rawPhone).replace(/\D/g,'');
    const name=String(row.n||'').trim();
    let key=name ? 'person:'+name+'|'+phone : (phone ? 'phone:'+phone : '');
    if(!key) return;
    const noPhoneKey=name?'person:'+name+'|':'';
    if(name&&phone){
      mergeContacts(noPhoneKey,key);
    }else if(name&&!phone){
      const existingPhoneKey=existingContactPhoneKey(name);
      if(existingPhoneKey) key=existingPhoneKey;
    }
    if(!contactMap.has(key)){
      contactMap.set(key,{key,p:row.p||'',countedCount:0,excludedCount:0,hiddenCount:0,bangteukCount:0,members:new Map(),searchParts:[]});
    }
    const contact=contactMap.get(key);
    if(row.p&&!contact.p) contact.p=row.p;
    if(counted) contact.countedCount++;
    else if(kind==='bangteuk') contact.bangteukCount++;
    else if(kind==='hidden') contact.hiddenCount++;
    else contact.excludedCount++;
    const memberKey=String(row.key||row.n)+'|'+String(row.status||'')+'|'+(kind||'normal')+'|'+(counted?'1':'0');
    if(!contact.members.has(memberKey)){
      contact.members.set(memberKey,{n:row.n||'',status:row.status||'',counted,kind:kind||'',dates:new Set(),slots:[]});
    }
    const member=contact.members.get(memberKey);
    const rowSlots=Array.isArray(row.slots)?row.slots:String(row.slots||'').split(' / ').filter(Boolean).map(text=>({key:text,badge:text,teacher:'',date:'',text}));
    rowSlots.forEach(slot=>{
      if(slot.date) member.dates.add(slot.date);
      if(!member.slots.some(saved=>saved.key===slot.key)) member.slots.push(slot);
    });
    contact.searchParts.push(row.n,row.p,row.status,row.slotText||'',kind==='bangteuk'?'방특':(kind==='hidden'?'숨김후보':(counted?'집계포함':'집계제외')));
  };
  data.countedRows.forEach(row=>addRow(row,true,'counted'));
  data.excludedRows.forEach(row=>addRow(row,false,'excluded'));
  (data.bangteukRows||[]).forEach(row=>addRow(row,false,'bangteuk'));
  (data.hiddenRows||[]).forEach(row=>addRow(row,false,'hidden'));
  const rows=[...contactMap.values()].map(row=>{
    const members=[...row.members.values()].sort((a,b)=>String(a.n).localeCompare(String(b.n),'ko') || String(a.status).localeCompare(String(b.status),'ko'));
    const countedCount=row.countedCount||0;
    return {
      ...row,
      countedCount,
      excludedCount:countedCount?0:(row.excludedCount||0),
      hiddenCount:row.hiddenCount||0,
      bangteukCount:row.bangteukCount||0,
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
  if(String(status||'').includes('방특')) return 'bangteuk';
  if(String(status||'').includes('숨김')) return 'hidden';
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
    summary.textContent=`정규 원생 ${_summaryNumber(data.countedRows.length)}명 · 정규 시수 ${_summaryNumber(data.regularHours)} · 방특 원생 ${_summaryNumber((data.bangteukRows||[]).length)}명 · 방특 시수 ${_summaryNumber(data.bangteukHours)} · 정규 평균시수 ${Number(data.averageHours||0).toFixed(1)} · 제외예정 ${_summaryNumber((data.excludedOnlyRows||data.excludedRows||[]).length)}명 · 숨김후보 ${_summaryNumber((data.hiddenRows||[]).length)}명 · 표시 원생 ${_summaryNumber(filtered.length)}건`;
  }
  body.innerHTML=filtered.map(row=>{
    const badges=[
      row.countedCount?`<span class="schedule-student-badge counted">포함 ${_summaryNumber(row.countedCount)}</span>`:'',
      row.excludedCount?`<span class="schedule-student-badge excluded">제외 ${_summaryNumber(row.excludedCount)}</span>`:'',
      row.bangteukCount?`<span class="schedule-student-badge bangteuk">방특 ${_summaryNumber(row.bangteukCount)}</span>`:'',
      row.hiddenCount?`<span class="schedule-student-badge hidden">숨김 ${_summaryNumber(row.hiddenCount)}</span>`:'',
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
    const countText=[row.countedCount?`포함 ${row.countedCount}`:'',row.excludedCount?`제외 ${row.excludedCount}`:'',row.bangteukCount?`방특 ${row.bangteukCount}`:'',row.hiddenCount?`숨김 ${row.hiddenCount}`:''].filter(Boolean).join(' / ');
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
function _excelTextFromHtml(html){
  const div=document.createElement('div');
  div.innerHTML=String(html||'').replace(/<br\s*\/?>/gi,'\n');
  return div.textContent.replace(/\n\s+/g,'\n').trim();
}
function _excelMd(ds){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(ds||''))) return '';
  return parseInt(ds.slice(5,7),10)+'/'+parseInt(ds.slice(8,10),10);
}
function _excelRgbFromCss(value){
  const text=String(value||'').trim();
  if(!text||text==='transparent') return '';
  let m=text.match(/^#?([0-9a-f]{6})$/i);
  if(m) return m[1].toUpperCase();
  m=text.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([.\d]+))?\)$/i);
  if(!m) return '';
  if(m[4]!==undefined&&parseFloat(m[4])===0) return '';
  return [m[1],m[2],m[3]].map(n=>Math.max(0,Math.min(255,parseInt(n,10)||0)).toString(16).padStart(2,'0')).join('').toUpperCase();
}
function _excelArgb(hex){
  hex=String(hex||'').replace(/^#/,'').toUpperCase();
  if(!/^[0-9A-F]{6}$/.test(hex)) return '';
  return 'FF'+hex;
}
function _excelStyleFromCell(cell){
  const cs=window.getComputedStyle?getComputedStyle(cell):null;
  const bg=_excelRgbFromCss(cs?.backgroundColor);
  const btName=cell.querySelector?.('.stu-bt-new-text');
  const textCs=btName&&window.getComputedStyle?getComputedStyle(btName):cs;
  const color=_excelRgbFromCss(textCs?.color)||_excelRgbFromCss(cs?.color)||'111111';
  const bold=parseInt(cs?.fontWeight||'400',10)>=700 || cell.tagName==='TH';
  const style={
    alignment:{horizontal:'center',vertical:'center',wrapText:true},
    font:{name:'맑은 고딕',sz:9,color:{rgb:_excelArgb(color)||'FF111111'},bold},
    border:{
      top:{style:'thin',color:{rgb:'FF666666'}},
      bottom:{style:'thin',color:{rgb:'FF666666'}},
      left:{style:'thin',color:{rgb:'FF666666'}},
      right:{style:'thin',color:{rgb:'FF666666'}},
    }
  };
  if(bg) style.fill={patternType:'solid',fgColor:{rgb:_excelArgb(bg)}};
  return style;
}
function _excelAddLine(lines,text){
  text=String(text||'').replace(/\s+\n/g,'\n').replace(/\n\s+/g,'\n').trim();
  if(text&&!lines.includes(text)) lines.push(text);
}
function _excelStudentDisplayForSlot(slotKey){
  const p=String(slotKey||'').split('/');
  if(p.length<4) return '';
  const [t,day,l,r]=p;
  const stu=(typeof getStu==='function')?getStu(t,day,l,r):null;
  if(stu) return _layoutStudentName(stu)+String(stu.a||'');
  const enr=ENROLL_MAP&&ENROLL_MAP[slotKey];
  if(enr) return String(enr.name||enr.n||'')+String(enr.age||enr.a||'');
  return '';
}
function _excelBadgeTag(kind){
  if(kind==='sample') return '(샘)';
  if(kind==='bogang'||kind==='pending-bogang') return '(보)';
  return '';
}
function _excelBadgeText(kind,name,ds){
  name=String(name||'').trim();
  const md=_excelMd(ds);
  if((kind==='bogang'||kind==='sample'||kind==='pending-bogang')&&name&&md) return name+md+_excelBadgeTag(kind);
  if(kind==='absent'&&md) return '결석'+md;
  if(kind==='absent-request'&&md) return '결석신청'+md;
  if(kind==='pending-cancel'&&md) return '취소요청'+md;
  return '';
}
function _excelSlotBadgeEntries(slotKey,day,todayStr){
  const p=String(slotKey||'').split('/');
  if(p.length<4) return [];
  const [t,d,l,r]=p;
  const rows=[];
  const add=(kind,name,ds)=>{
    const text=_excelBadgeText(kind,name,ds);
    if(text&&!rows.some(row=>row.text===text)) rows.push({kind,text,ds});
  };
  try{
    const classDates=typeof getClassDatesForDay==='function'?getClassDatesForDay(day||d):{cur:[],next:[]};
    const allDates=[...(classDates.cur||[]),...(classDates.next||[])];
    allDates.forEach(date=>{
      if(date.closed||date.ds<todayStr) return;
      const mark=typeof getMark==='function'?getMark(slotKey,date.ds):(MARK_MAP&&MARK_MAP[slotKey+'/'+date.ds]);
      if(!mark) return;
      if(mark.type==='bogang'||mark.type==='sample') add(mark.type,mark.type==='bogang'&&typeof bogangDisplayName==='function'?bogangDisplayName(mark):mark.n,date.ds);
      else if(mark.type==='absent'){
        add(typeof isParentAbsentRequestMark==='function'&&isParentAbsentRequestMark(mark)?'absent-request':'absent','',date.ds);
        if(mark.sub?.type==='bogang'||mark.sub?.type==='sample') add(mark.sub.type,mark.sub.type==='bogang'&&typeof bogangDisplayName==='function'?bogangDisplayName(mark.sub):mark.sub.n,date.ds);
      }
    });
  }catch(e){}
  Object.values(REQUESTS||{}).forEach(req=>{
    if(req.type!=='bogang') return;
    if(req.status&&req.status!=='pending') return;
    const tg=req.target;
    if(!tg||tg.ds<todayStr) return;
    if(tg.t===t&&tg.d===d&&parseInt(tg.l,10)===parseInt(l,10)&&parseInt(tg.r,10)===parseInt(r,10)){
      add('pending-bogang',req.parent?.name,tg.ds);
    }
  });
  return rows.sort((a,b)=>(a.ds||'').localeCompare(b.ds||''));
}
function _excelBadgeDisplayForSlot(slotKey,day,todayStr){
  return _excelSlotBadgeEntries(slotKey,day,todayStr).map(row=>row.text).join('\n');
}
function _excelBadgeFillKind(slotKey,day,todayStr){
  const entries=_excelSlotBadgeEntries(slotKey,day,todayStr);
  const colored=entries.find(row=>row.kind==='bogang'||row.kind==='sample'||row.kind==='pending-bogang'||row.kind==='absent-request');
  if(!colored) return '';
  if(colored.kind==='absent-request') return 'pending';
  return colored.kind==='sample'?'sample':'bogang';
}
function _excelApplyBadgeOnlyStyle(style,kind){
  if(kind==='bogang'){
    return {...style,fill:{patternType:'solid',fgColor:{rgb:'FF7C3AED'}},font:{...style.font,bold:true,color:{rgb:'FFFFFFFF'}}};
  }
  if(kind==='sample'){
    return {...style,fill:{patternType:'solid',fgColor:{rgb:'FFF59E0B'}},font:{...style.font,bold:true,color:{rgb:'FF111111'}}};
  }
  if(kind==='pending'){
    return {...style,fill:{patternType:'solid',fgColor:{rgb:'FFF59E0B'}},font:{...style.font,bold:true,color:{rgb:'FFFFFFFF'}}};
  }
  return style;
}
function _excelSlotMemoLines(slotKey,day,todayStr){
  const lines=[];
  if(!slotKey) return lines;
  const p=String(slotKey).split('/');
  const [t,d,l,r]=p;
  const stu=(p.length>=4&&typeof getStu==='function')?getStu(t,d,l,r):null;
  if(stu){
    if(stu.p) _excelAddLine(lines,'전화: '+stu.p);
    if(stu.g) _excelAddLine(lines,'반: '+stu.g);
    if(stu.loc) _excelAddLine(lines,'승하차: '+stu.loc);
    if(stu.memo) _excelAddLine(lines,'메모: '+stu.memo);
    if(stu.v||_tableLocUsesVehicle(stu.loc)) _excelAddLine(lines,'차량이용');
    if(stu.isNew) _excelAddLine(lines,'신규');
    if(stu.reenroll) _excelAddLine(lines,'재등록');
  }
  const ret=RETIRE_MAP&&RETIRE_MAP[slotKey];
  const retDs=typeof ret==='string'?ret:ret?.ds;
  if(retDs){
    const kind=(typeof _retireReservationKindLabel==='function')?_retireReservationKindLabel(ret,slotKey,stu):'제외/퇴원';
    const name=(typeof _scheduleReservationName==='function')?_scheduleReservationName(ret,stu):(ret?.name||stu?.n||'');
    _excelAddLine(lines,kind+': '+[name,_excelMd(retDs)].filter(Boolean).join(' '));
  }
  const enr=ENROLL_MAP&&ENROLL_MAP[slotKey];
  if(enr){
    const name=(typeof _scheduleReservationName==='function')?_scheduleReservationName(enr):(enr.name||enr.n||'');
    _excelAddLine(lines,'등록: '+[name,_excelMd(enr.ds)+'부터'].filter(Boolean).join(' ')+(enr.isNew?' / 신규':''));
  }
  const hy=HYUWON_MAP&&HYUWON_MAP[slotKey];
  if(hy){
    if(Array.isArray(hy.dates)&&hy.dates.length) _excelAddLine(lines,'휴원: '+hy.dates.map(_excelMd).filter(Boolean).join(', '));
    else if(hy.from||hy.to) _excelAddLine(lines,'휴원: '+[_excelMd(hy.from),_excelMd(hy.to)].filter(Boolean).join('~'));
  }
  try{
    const classDates=typeof getClassDatesForDay==='function'?getClassDatesForDay(day||d):{cur:[],next:[]};
    const allDates=[...(classDates.cur||[]),...(classDates.next||[])];
    allDates.forEach(date=>{
      if(date.closed||date.ds<todayStr) return;
      const mark=typeof getMark==='function'?getMark(slotKey,date.ds):(MARK_MAP&&MARK_MAP[slotKey+'/'+date.ds]);
      if(!mark) return;
      const dl=_excelMd(date.ds);
      if(mark.type==='absent'){
        const label=typeof absentMarkLabel==='function'?absentMarkLabel(mark):'결석';
        _excelAddLine(lines,label+': '+dl);
        if(mark.sub){
          const type=mark.sub.type==='sample'?'샘플':'보강';
          const subName=mark.sub.type==='bogang'&&typeof bogangDisplayName==='function'?bogangDisplayName(mark.sub):mark.sub.n;
          _excelAddLine(lines,type+': '+[subName,String(mark.sub.a||''),dl,mark.sub.p,mark.sub.memo].filter(Boolean).join(' '));
        }
      } else if(mark.type==='bogang'||mark.type==='sample'){
        const type=mark.type==='sample'?'샘플':'보강';
        const markName=mark.type==='bogang'&&typeof bogangDisplayName==='function'?bogangDisplayName(mark):mark.n;
        _excelAddLine(lines,type+': '+[markName,String(mark.a||''),dl,mark.p,mark.memo].filter(Boolean).join(' '));
      }
    });
  }catch(e){}
  Object.values(REQUESTS||{}).forEach(req=>{
    if(req.type==='bogang'&&(!req.status||req.status==='pending')){
      const tg=req.target;
      if(tg&&tg.t===t&&tg.d===d&&parseInt(tg.l,10)===parseInt(l,10)&&parseInt(tg.r,10)===parseInt(r,10)&&tg.ds>=todayStr){
        _excelAddLine(lines,'보강 신청 대기: '+[req.parent?.name,_excelMd(tg.ds),req.parent?.phone].filter(Boolean).join(' '));
      }
    }
    if(req.type==='absent-cancel'&&(!req.status||req.status==='pending')){
      const parent=req.parent;
      const tg=req.target;
      if(parent?.studentSlotKey===slotKey&&tg&&tg.ds>=todayStr){
        _excelAddLine(lines,'결석 취소 대기: '+[parent.name,_excelMd(tg.ds)].filter(Boolean).join(' '));
      }
    }
  });
  return lines;
}
function _excelCellMemoLines(origCell,todayStr){
  const lines=[];
  origCell.querySelectorAll('.cb').forEach(badge=>{
    const label=badge.textContent.trim();
    const tip=_excelTextFromHtml(badge.dataset.tip||'');
    _excelAddLine(lines,tip&&tip!==label?`${label}: ${tip}`:label);
  });
  origCell.querySelectorAll('.inst-reserve-badge').forEach(badge=>{
    const tip=_excelTextFromHtml(badge.dataset.reserveTip||'');
    _excelAddLine(lines,tip?'대기자: '+tip:'대기자 '+badge.textContent.trim());
  });
  if(origCell.classList.contains('stu-cell')||origCell.classList.contains('stu-clickable')){
    const {t,day,lane,ri}=origCell.dataset||{};
    if(t&&day&&lane&&ri){
      _excelSlotMemoLines(`${t}/${day}/${lane}/${ri}`,day,todayStr).forEach(line=>_excelAddLine(lines,line));
    }
  }
  return lines;
}
function _excelCleanCellForExport(cloneCell,origCell,todayStr){
  cloneCell.querySelectorAll('.cb,.cell-badges,.inst-reserve-badge,.att-add-inst,.att-icon,.att-tag').forEach(el=>el.remove());
  if(origCell.classList.contains('stu-cell')||origCell.classList.contains('stu-clickable')){
    const {t,day,lane,ri}=origCell.dataset||{};
    if(t&&day&&lane&&ri){
      const slotKey=`${t}/${day}/${lane}/${ri}`;
      const base=_excelStudentDisplayForSlot(slotKey);
      const badges=_excelBadgeDisplayForSlot(slotKey,day,todayStr);
      cloneCell.textContent=[base,badges].filter(Boolean).join('\n');
      if(!base&&badges){
        const fillKind=_excelBadgeFillKind(slotKey,day,todayStr);
        if(fillKind) cloneCell.setAttribute('data-excel-badge-fill',fillKind);
      }
      return;
    }
  }
  cloneCell.textContent=cloneCell.textContent.replace(/\s+/g,' ').trim();
}
function _excelWalkTableCells(table,handler){
  const occupied={};
  Array.from(table.rows).forEach((tr,r)=>{
    let c=0;
    Array.from(tr.cells).forEach(cell=>{
      while(occupied[r+','+c]) c++;
      const rs=cell.rowSpan||1, cs=cell.colSpan||1;
      handler(cell,r,c,rs,cs);
      for(let rr=r;rr<r+rs;rr++){
        for(let cc=c;cc<c+cs;cc++) occupied[rr+','+cc]=true;
      }
      c+=cs;
    });
  });
}
function _excelSafeSheetName(name){
  return String(name||'시간표').replace(/[\\/?*\[\]:]/g,' ').slice(0,31)||'시간표';
}
function _excelSafeFilePart(name){
  return String(name||'시간표').replace(/[\\/:*?"<>|]/g,'_').replace(/\s+/g,'_').slice(0,60)||'시간표';
}
function _excelSheetMaxRow(ws){
  const ref=ws['!ref'];
  if(!ref) return 0;
  return XLSX.utils.decode_range(ref).e.r;
}
function _excelRecordGroups(){
  const groups={};
  const panel=document.getElementById('schedule-audit-summary');
  if(!panel) return groups;
  const sections=Array.from(panel.querySelectorAll('.schedule-audit-day'));
  sections.forEach(section=>{
    const day=section.getAttribute('data-schedule-audit-day')||'기록';
    const dataRows=Array.from(section.querySelectorAll('tbody tr[data-desk-note-id]')).map(tr=>
      Array.from(tr.children)
        .filter(td=>!td.classList.contains('schedule-audit-spacer'))
        .slice(0,5)
        .map(td=>td.textContent.trim())
    ).filter(cols=>cols.some(Boolean));
    if(!dataRows.length) return;
    groups[day]=dataRows;
  });
  return groups;
}
function _excelDayColumnMap(table){
  const map={};
  const days=(typeof getDays==='function')?getDays():['월','화','수','목','금'];
  const row=table?.querySelector('thead .day-hdr-row');
  const cells=row?Array.from(row.cells):[];
  let col=0;
  days.forEach((day,i)=>{
    const cell=cells[i];
    const width=cell?(cell.colSpan||1):1;
    map[day]={start:col,width};
    col+=width;
  });
  return map;
}
function _excelExpandRef(ws,r,c){
  const addr=XLSX.utils.encode_cell({r,c});
  if(!ws['!ref']){
    ws['!ref']=addr+':'+addr;
    return;
  }
  const range=XLSX.utils.decode_range(ws['!ref']);
  range.s.r=Math.min(range.s.r,r);
  range.s.c=Math.min(range.s.c,c);
  range.e.r=Math.max(range.e.r,r);
  range.e.c=Math.max(range.e.c,c);
  ws['!ref']=XLSX.utils.encode_range(range);
}
function _excelSetCell(ws,r,c,value,style){
  const addr=XLSX.utils.encode_cell({r,c});
  ws[addr]={t:'s',v:String(value||'')};
  if(style) ws[addr].s=style;
  _excelExpandRef(ws,r,c);
}
function _excelRecordStyle(kind){
  const base={
    alignment:{horizontal:'center',vertical:'center',wrapText:true},
    font:{name:'맑은 고딕',sz:9,color:{rgb:'FF111111'}},
    border:{
      top:{style:'thin',color:{rgb:'FF888888'}},
      bottom:{style:'thin',color:{rgb:'FF888888'}},
      left:{style:'thin',color:{rgb:'FF888888'}},
      right:{style:'thin',color:{rgb:'FF888888'}},
    }
  };
  if(kind==='title') return {...base,font:{...base.font,sz:12,bold:true},fill:{patternType:'solid',fgColor:{rgb:'FFE5E7EB'}}};
  if(kind==='day') return {...base,font:{...base.font,bold:true},fill:{patternType:'solid',fgColor:{rgb:'FFF3F4F6'}}};
  if(kind==='head') return {...base,font:{...base.font,bold:true},fill:{patternType:'solid',fgColor:{rgb:'FFD1D5DB'}}};
  return base;
}
function _excelAppendRecords(ws,table,rowHeights){
  const groups=_excelRecordGroups();
  const days=Object.keys(groups);
  if(!days.length) return;
  const dayMap=_excelDayColumnMap(table);
  const hasNums=(typeof getHasNum==='function')?getHasNum():[];
  const startRow=_excelSheetMaxRow(ws)+3;
  const headers=['담당','원생','변동','수정날짜','시간'];
  const writeGroup=(day,rows,baseRow,info)=>{
    const isKnownDay=!!info;
    info=info||{start:0,width:Math.max(6,headers.length+1)};
    const spacer=(hasNums||[]).includes(day)?2:1;
    const blockStart=info.start;
    const blockWidth=Math.max(info.width,spacer+headers.length);
    const blockEnd=blockStart+blockWidth-1;
    const dataStart=Math.min(blockStart+spacer, Math.max(blockStart, blockEnd-headers.length+1));
    const totalRows=rows.length+1;
    for(let ri=0;ri<totalRows;ri++){
      const sheetRow=baseRow+ri;
      rowHeights[sheetRow]=rowHeights[sheetRow]||{hpt:20};
      for(let c=blockStart;c<=blockEnd;c++){
        const dataIdx=c-dataStart;
        const isData=dataIdx>=0&&dataIdx<headers.length;
        let value='';
        let style=_excelRecordStyle(ri===0&&isData?'head':'body');
        if(ri===0){
          if(!isKnownDay&&c===blockStart) value=day;
          else value=isData?headers[dataIdx]:'';
        } else if(isData){
          value=rows[ri-1][dataIdx]||'';
          if(dataIdx===2&&String(value)==='퇴원'){
            style={...style,fill:{patternType:'solid',fgColor:{rgb:'FFF97316'}},font:{...style.font,bold:true,color:{rgb:'FF111111'}}};
          }
        }
        _excelSetCell(ws,sheetRow,c,value,style);
      }
    }
    return totalRows;
  };
  let maxKnownRows=0;
  const unknownDays=[];
  days.forEach(day=>{
    const rows=groups[day]||[];
    if(dayMap[day]) maxKnownRows=Math.max(maxKnownRows,writeGroup(day,rows,startRow,dayMap[day]));
    else unknownDays.push(day);
  });
  let extraRow=startRow+Math.max(maxKnownRows,1)+1;
  unknownDays.forEach(day=>{
    extraRow+=writeGroup(day,groups[day]||[],extraRow,null)+1;
  });
}
function exportExcel(){
  if(typeof XLSX==='undefined'){toast('엑셀 라이브러리 로드 실패','err');return;}
  const source=document.querySelector('#tbl table');
  if(!source){toast('내보낼 시간표가 없습니다','err');return;}
  const todayStr=toDateStr(getToday());
  const wb=XLSX.utils.book_new();
  const clone=source.cloneNode(true);
  const origCells=Array.from(source.querySelectorAll('th,td'));
  const cloneCells=Array.from(clone.querySelectorAll('th,td'));
  cloneCells.forEach((cell,i)=>{
    const orig=origCells[i]||cell;
    const comments=_excelCellMemoLines(orig,todayStr);
    if(comments.length) cell.setAttribute('data-excel-comment',comments.join('\n'));
    _excelCleanCellForExport(cell,orig,todayStr);
  });
  const ws=XLSX.utils.table_to_sheet(clone,{raw:true});
  const colWidths=[];
  const rowHeights=[];
  let serial=0;
  _excelWalkTableCells(clone,(cell,r,c)=>{
    const orig=origCells[serial++]||cell;
    const addr=XLSX.utils.encode_cell({r,c});
    if(!ws[addr]) ws[addr]={t:'s',v:''};
    ws[addr].s=_excelApplyBadgeOnlyStyle(_excelStyleFromCell(orig),cell.getAttribute('data-excel-badge-fill'));
    const comment=cell.getAttribute('data-excel-comment');
    if(comment){
      ws[addr].c=[{a:'슈퍼차일드',t:comment}];
      ws[addr].c.hidden=true;
    }
    const cls=orig.className||'';
    const text=String(ws[addr].v||'');
    const width=cls.includes('col-time')?7:cls.includes('col-num')?4:Math.min(18,Math.max(10,text.length+4));
    colWidths[c]={wch:Math.max(colWidths[c]?.wch||0,width)};
    rowHeights[r]={hpt:cls.includes('inst')?18:20};
  });
  _excelAppendRecords(ws,clone,rowHeights);
  ws['!cols']=Array.from({length:colWidths.length},(_,i)=>colWidths[i]||{wch:10});
  ws['!rows']=Array.from({length:_excelSheetMaxRow(ws)+1},(_,i)=>rowHeights[i]||{hpt:18});
  ws['!freeze']={xSplit:0,ySplit:2};
  wb.Workbook=wb.Workbook||{};
  wb.Workbook.Views=[{RTL:false}];
  const today=getToday();
  const ds=today.getFullYear()+String(today.getMonth()+1).padStart(2,'0')+String(today.getDate()).padStart(2,'0');
  const activeTab=(typeof _tabById==='function')?_tabById(_activeTab):null;
  const tabName=activeTab?.name||'시간표';
  XLSX.utils.book_append_sheet(wb,ws,_excelSafeSheetName(tabName));
  XLSX.writeFile(wb,'슈퍼차일드_'+_excelSafeFilePart(tabName)+'_'+ds+'.xlsx',{cellStyles:true,bookSST:true});
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
