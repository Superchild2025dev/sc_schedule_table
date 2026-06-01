/* ════════════════════════════════════════════════════════════════
 * SECTION: 학생 셀 팝업 (renderStuPopup ~200줄, 분할 대상)
 * ════════════════════════════════════════════════════════════════ */
let _stuPopup={key:null,td:null,t:null,day:null,lane:null,row:null,selDate:null,showEnroll:false,showBogang:false,showSample:false,showHyuwon:false,showRetire:false};
let _stuBusy=false;

function stuPopupCanEdit(){
  return !(window.SCAuth && !SCAuth.can('editSchedule'));
}
function stuPopupCanView(){
  return !(window.SCAuth && !SCAuth.can('viewSchedule'));
}
function isStuPopupReadOnly(){
  return !stuPopupCanEdit();
}

function applyStuPopupReadOnlyState(){
  if(!isStuPopupReadOnly()) return;
  const popup=document.getElementById('stu-popup');
  if(!popup) return;
  popup.classList.add('stu-popup-readonly');
  popup.querySelectorAll('input, textarea, select').forEach(el=>{
    if(el.type==='checkbox' || el.tagName==='SELECT') el.disabled=true;
    else el.readOnly=true;
  });
  popup.querySelectorAll('.sp-vt-col').forEach(el=>{
    el.classList.add('readonly');
    el.style.pointerEvents='none';
  });
  popup.querySelectorAll('button').forEach(btn=>{
    btn.disabled=true;
  });
}

function handleReadOnlyDateBoxClick(dateBox){
  const ds=dateBox.dataset.ds;
  const {t,day,lane,row}= _stuPopup;
  const slotKey=t+'/'+day+'/'+lane+'/'+row;
  if(_stuPopup.selDate===ds){
    _stuPopup.selDate=null;
    _stuPopup.showEnroll=false;
    _stuPopup.showBogang=false;
    _stuPopup.showSample=false;
    _stuPopup.showHyuwon=false;
    _stuPopup.showRetire=false;
    renderStuPopup();
    return;
  }
  _stuPopup.selDate=ds;
  _stuPopup.showEnroll=false;
  _stuPopup.showBogang=false;
  _stuPopup.showSample=false;
  _stuPopup.showHyuwon=false;
  _stuPopup.showRetire=false;

  const mark=getMark(slotKey,ds);
  const sub=mark?.sub||null;
  const hyuwon=HYUWON_MAP[slotKey];
  const isHyuwon=!!(hyuwon && (
    (hyuwon.dates && hyuwon.dates.includes(ds)) ||
    (hyuwon.from && !hyuwon.dates && ds>=hyuwon.from && ds<=hyuwon.to)
  ));
  if(ENROLL_MAP[slotKey]?.ds===ds){
    _stuPopup.showEnroll=true;
  } else if(mark?.type==='bogang'||(mark?.type==='absent'&&sub?.type==='bogang')){
    _stuPopup.showBogang=true;
  } else if(mark?.type==='sample'||(mark?.type==='absent'&&sub?.type==='sample')){
    _stuPopup.showSample=true;
  } else if(isHyuwon){
    _stuPopup.showHyuwon=true;
  }
  renderStuPopup();
}

// [v118] 승하차 장소: 승차/하차/자가등하원 분리 입출력 헬퍼
//   기존 loc 문자열과 호환 (UI만 분리, 저장은 loc 한 줄로 합침)
function _parseLoc(loc){
  if(!loc) return { pickUp:'', dropOff:'', pickSelf:false, dropSelf:false };
  const txt = String(loc).trim();
  // 전체 자가등하원/도보 → 둘 다 자가
  if(/^(자가등하원|도보등하원)$/.test(txt)) return { pickUp:'', dropOff:'', pickSelf:true, dropSelf:true };
  // 줄바꿈 + 슬래시 + 파이프 구분자로 분리
  const segments = txt.split(/[\n\/|]/);
  let pickUp='', dropOff='', pickSelf=false, dropSelf=false, other=[];
  for(const raw of segments){
    const t = raw.trim();
    if(!t) continue;
    let m;
    if(m = t.match(/^승하차\s*[:：]?\s*(.+)/)) {
      const v = m[1].trim();
      if(/^(자가|도보)/.test(v)) { pickSelf=true; dropSelf=true; }
      else { pickUp = pickUp||v; dropOff = dropOff||v; }
    }
    else if(m = t.match(/^승차만?\s*[:：]?\s*(.+)/)) {
      const v = m[1].trim();
      if(/^(자가|도보)/.test(v)) pickSelf=true;
      else pickUp = pickUp||v;
    }
    else if(m = t.match(/^하차만?\s*[:：]?\s*(.+)/)) {
      const v = m[1].trim();
      if(/^(자가|도보)/.test(v)) dropSelf=true;
      else dropOff = dropOff||v;
    }
    else if(/^(자가|도보)/.test(t)) { pickSelf=true; dropSelf=true; }
    else other.push(t);
  }
  if(!pickUp && !dropOff && !pickSelf && !dropSelf && other.length){
    pickUp = dropOff = other.join(' ');
  }
  return { pickUp, dropOff, pickSelf, dropSelf };
}
function _buildLoc(pickUp, dropOff, pickSelf, dropSelf){
  pickUp = (pickUp||'').trim(); dropOff = (dropOff||'').trim();
  // 둘 다 자가 → "자가등하원"
  if(pickSelf && dropSelf) return '자가등하원';
  // 한쪽만 자가
  const pVal = pickSelf ? '자가' : pickUp;
  const dVal = dropSelf ? '자가' : dropOff;
  if(!pVal && !dVal) return '';
  if(pVal === dVal && pVal && !pickSelf && !dropSelf) return '승하차: ' + pVal;
  const parts = [];
  if(pVal) parts.push('승차: ' + pVal);
  if(dVal) parts.push('하차: ' + dVal);
  return parts.join('\n');
}
function _locUsesVehicle(loc){
  const txt=(loc||'').trim();
  if(!txt || /^(자가등하원|도보등하원)$/.test(txt)) return false;
  const lines=txt.split(/[\n\/|]/).map(s=>s.trim()).filter(Boolean);
  return lines.some(line=>{
    const m=line.match(/^(?:승하차|승차|하차)\s*[:：]?\s*(.+)$/);
    const val=(m?m[1]:line).trim();
    return !!val && !/^(자가|도보)/.test(val);
  });
}
// _tabFocusTime → data.js (cross-file shared state)

function openStuPopup(td,t,day,lane,row){
  if(window.SCAuth && !SCAuth.requirePermission('viewSchedule','인원 조회')) return;
  if((_instSwapMode || _moveMode) && !stuPopupCanEdit()){
    if(typeof toast==='function') toast('편집 권한이 없습니다','err');
    return;
  }
  // 담임 교환 모드면 해당 레인의 담임 교환으로 처리
  if(_instSwapMode){
    executeInstSwap(t,day,lane);
    return;
  }
  // 이동 모드면 목적지로 처리
  if(_moveMode){
    executeMove(t,day,lane,row);
    return;
  }

  const popup=document.getElementById('stu-popup');
  const key=t+'/'+day+'/'+lane+'/'+row;

  // 툴팁 숨기기
  clearTimeout(_tipTimer);
  _tip.classList.remove('show');

  // 팝업 열린 상태 → 닫기만
  if(popup.classList.contains('show')){
    closeStuPopup();
    if(_stuPopup.key===key) return;
    return;
  }

  // inst 팝업 열려있으면 닫기만
  if(document.getElementById('inst-popup').classList.contains('show')){
    closeInstPopup();
    return;
  }

  // 이전 하이라이트 제거 + 새 하이라이트
  if(_stuPopup.td) _stuPopup.td.classList.remove('stu-active');
  td.classList.add('stu-active');

  _stuPopup.key=key;
  _stuPopup.td=td;
  _stuPopup.t=t;_stuPopup.day=day;_stuPopup.lane=lane;_stuPopup.row=row;
  _stuPopup.selDate=null;
  _stuPopup.showEnroll=false;
  _stuPopup.showBogang=false;
  _stuPopup.showSample=false;
  _stuPopup.showHyuwon=false;

  renderStuPopup(true); // [v105] freshOpen — 이전 슬롯의 폼 draft 무시

  // [v113] 팝업 실제 높이를 측정해서 viewport 안에 확실히 들어오게 배치
  //   기존엔 350px 하드코딩이라 폼이 커진 후엔 실제 높이와 어긋나서 하단 셀 클릭 시 잘림
  popup.style.visibility='hidden';
  popup.classList.add('show');
  const popupH = popup.offsetHeight || 400;
  const popupW = popup.offsetWidth || 470;
  popup.classList.remove('show');
  popup.style.visibility='';

  const rect=td.getBoundingClientRect();
  const margin=8;
  let left=rect.left;
  let top=rect.bottom+4;
  // 수평: 오른쪽으로 튀어나가면 왼쪽으로 당김
  if(left+popupW>window.innerWidth-margin) left=window.innerWidth-popupW-margin;
  if(left<margin) left=margin;
  // 수직: 아래 공간 부족하면 셀 위쪽 시도, 위도 부족하면 셀 좌/우측으로 배치 (셀 안 가리게)
  if(top+popupH>window.innerHeight-margin){
    const aboveTop = rect.top - popupH - 4;
    if(aboveTop >= margin){
      top = aboveTop;
    } else {
      // [v118] 위아래 모두 부족 → 셀 가리지 않게 좌/우측 배치
      const rightSpace = window.innerWidth - rect.right - margin;
      const leftSpace  = rect.left - margin;
      if(rightSpace >= popupW + 4){
        left = rect.right + 4;
        top  = Math.max(margin, Math.min(rect.top, window.innerHeight - popupH - margin));
      } else if(leftSpace >= popupW + 4){
        left = rect.left - popupW - 4;
        top  = Math.max(margin, Math.min(rect.top, window.innerHeight - popupH - margin));
      } else {
        // 진짜 모든 공간 부족 → 폴백 클램프 (셀 가릴 가능성)
        top = Math.max(margin, window.innerHeight - popupH - margin);
      }
    }
  }
  if(top<margin) top=margin;
  popup.style.left=left+'px';
  popup.style.top=top+'px';
  popup.classList.add('show');
  // [v97] 팝업 열림 직후 이름 input에 자동 포커스 (v95 동작 복원)
  setTimeout(()=>{
    if(!stuPopupCanEdit()) return;
    const nameInput=document.getElementById('sp-name');
    if(nameInput && document.getElementById('stu-popup').classList.contains('show')){
      nameInput.focus();
      const len=nameInput.value.length;
      try{ nameInput.setSelectionRange(len,len); }catch(e){}
    }
  },30);
}

/**
 * 수업 날짜 박스 한 줄 렌더링 (renderStuPopup에서 사용)
 * @param {Array} dates  - [{ds, m, d, closed}, ...]
 * @param {string} slotKey
 * @param {string|null} selDate - 현재 선택된 날짜
 * @param {string|null} retireDate - 제외 예약일
 * @param {string} retireName - 제외 학생 이름
 * @param {string|null} enrollDate - 등록 예약일
 * @param {string} enrollName - 등록 학생 이름+나이
 */
function renderDateBoxes(dates, slotKey, selDate, retireDate, retireName, enrollDate, enrollName){
  const todayStr=toDateStr(getToday());
  return dates.map(d=>{
    let cls=d.closed?'closed':(d.ds===todayStr?'today':(d.ds<todayStr?'past':'future'));
    if(retireDate&&d.ds===retireDate) cls+=' retire-set';
    if(enrollDate&&d.ds===enrollDate) cls+=' enroll-set';

    const mark=getMark(slotKey,d.ds);
    const isAbsent=mark?.type==='absent';
    const sub=mark?.sub||null;
    const isBogangOnly=mark?.type==='bogang';
    const isSampleOnly=mark?.type==='sample';
    if(isAbsent) cls+=' absent-set';
    if(sub?.type==='bogang'||isBogangOnly) cls+=(isAbsent?'':' bogang-set');
    if(sub?.type==='sample'||isSampleOnly) cls+=(isAbsent?'':' sample-set');
    const hyuwon=HYUWON_MAP[slotKey];
    if(hyuwon&&hyuwon.dates&&hyuwon.dates.includes(d.ds)) cls+=' hyuwon-set';
    // 구 형식 호환
    if(hyuwon&&hyuwon.from&&!hyuwon.dates&&d.ds>=hyuwon.from&&d.ds<=hyuwon.to) cls+=' hyuwon-set';
    if(selDate&&d.ds===selDate) cls+=' selected';

    const retLabel=(retireDate&&d.ds===retireDate)?`<span class="date-retire-label">${esc(retireName)}</span>`:'';
    const enrLabel=(enrollDate&&d.ds===enrollDate)?`<span class="date-enroll-label">${esc(enrollName)}</span>`:'';
    let markLabel='';
    if(isAbsent&&!sub) markLabel='<span class="date-absent-label">결석</span>';
    if(isAbsent&&sub) markLabel=`<span class="date-absent-label">결석/${esc((sub.n||'')+(sub.a||''))}</span>`;
    if(isBogangOnly) markLabel=`<span class="date-bogang-label">${esc((mark.n||'')+(mark.a||''))}</span>`;
    if(isSampleOnly) markLabel=`<span class="date-sample-label">${esc((mark.n||'')+(mark.a||''))}</span>`;

    return `<div class="stu-date-box ${cls}" data-ds="${d.ds}">${d.m}/${d.d}${retLabel}${enrLabel}${markLabel}</div>`;
  }).join('');
}

/* ── 학생 팝업 폼 빌더 (보강/샘플/등록) ── */

/**
 * 보강 폼 HTML
 * @param existBo 기존 보강 데이터({n,a}) 또는 null → 수정 모드 vs 등록 모드 토글
 */
function _spAttr(s){
  return esc(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/`/g,'&#96;');
}
function _bogangCleanTeacherName(inst){
  if(!inst) return '';
  const name=typeof inst==='string'?inst:(inst.n||'');
  return String(name||'').replace(/^[\d\)]+\s*/,'').replace(/\(유아\)/g,'').replace(/\(엘\/마\)/g,'').trim();
}
function _bogangStudentSlotKey(stu){
  return [stu&&stu.t,stu&&stu.d,stu&&stu.l,stu&&stu.r].map(v=>String(v||'')).join('/');
}
function _bogangNormPhone(value){
  const raw=String(value||'');
  return (typeof normPhone==='function'?normPhone(raw):raw).replace(/\D/g,'');
}
function _bogangStudentCandidate(stu){
  const slotKey=_bogangStudentSlotKey(stu);
  const inst=getInst(stu.t,stu.d,stu.l);
  const teacher=_bogangCleanTeacherName(inst);
  const time=String(stu.t||'');
  const day=String(stu.d||'');
  const slotLabel=[day+(time?time.replace('시',''):''),teacher?teacher+'쌤':''].filter(Boolean).join(' ');
  return {
    key:slotKey+'|'+(stu.p||'')+'|'+(stu.n||'')+'|'+(stu.a||''),
    slotKey,
    slotKeys:slotKey,
    n:stu.n||'',
    a:stu.a||'',
    p:stu.p||'',
    teacher,
    day,
    time,
    slotLabel,
    label:slotLabel||[day,time,teacher?teacher+'쌤':''].filter(Boolean).join(' · '),
  };
}
function _bogangSearchText(c){
  return [c.n,c.n+c.a,c.p,c.p?String(c.p).slice(-4):'',c.teacher,c.day,c.time,c.label].join(' ').toLowerCase();
}
function _bogangGroupCandidates(list){
  const map=new Map();
  list.forEach(c=>{
    const phone=_bogangNormPhone(c.p);
    const key=phone ? `${c.n}|${phone}` : `${c.n}|${c.a}|${c.slotKey}`;
    if(!map.has(key)){
      map.set(key,Object.assign({},c,{
        key,
        p:phone||c.p||'',
        slots:[],
        teachers:new Set(),
        days:new Set(),
        times:new Set(),
      }));
    }
    const row=map.get(key);
    if(c.a&&!row.a) row.a=c.a;
    if(c.p&&!row.p) row.p=c.p;
    row.slots.push({slotKey:c.slotKey,label:c.slotLabel||c.label,teacher:c.teacher,day:c.day,time:c.time});
    if(c.teacher) row.teachers.add(c.teacher);
    if(c.day) row.days.add(c.day);
    if(c.time) row.times.add(c.time);
  });
  return [...map.values()].map(row=>{
    const slots=row.slots.filter((slot,idx,arr)=>arr.findIndex(v=>v.slotKey===slot.slotKey)===idx);
    const label=slots.map(slot=>slot.label).filter(Boolean).join(' / ');
    return Object.assign(row,{
      slotKey:slots[0]?.slotKey||row.slotKey,
      slotKeys:slots.map(slot=>slot.slotKey).join('|'),
      teacher:[...row.teachers].join(', '),
      day:[...row.days].join(', '),
      time:[...row.times].join(', '),
      label,
    });
  });
}
function _bogangStudentCandidates(query){
  const q=String(query||'').trim().toLowerCase().replace(/\s+/g,'');
  if(!q) return [];
  const list=(Array.isArray(STUDENTS)?STUDENTS:[])
    .filter(stu=>stu&&stu.n)
    .map(_bogangStudentCandidate)
    .filter(c=>_bogangSearchText(c).replace(/\s+/g,'').includes(q));
  return _bogangGroupCandidates(list).sort((a,b)=>{
    const an=String(a.n||'').toLowerCase();
    const bn=String(b.n||'').toLowerCase();
    const ae=an===q?0:an.startsWith(q)?1:2;
    const be=bn===q?0:bn.startsWith(q)?1:2;
    return ae-be || an.localeCompare(bn,'ko') || String(a.label).localeCompare(String(b.label),'ko');
  }).slice(0,8);
}
function _bogangSelectedSummary(data){
  if(!data||!data.slotKey) return '';
  if(data.label) return data.label;
  return [data.day,data.time,data.teacher?data.teacher+'쌤':''].filter(Boolean).join(' · ');
}
function _renderBogangCandidates(){
  const input=document.getElementById('sp-bogang-name');
  const box=document.getElementById('sp-bogang-candidates');
  if(!input||!box) return;
  const candidates=_bogangStudentCandidates(input.value);
  if(!input.value.trim()){
    box.innerHTML='<div style="padding:5px 6px;color:#9CA3AF;font-size:10px">이름을 입력하면 원생 후보가 표시됩니다.</div>';
    return;
  }
  if(!candidates.length){
    box.innerHTML='<div style="padding:5px 6px;color:#9CA3AF;font-size:10px">일치하는 원생이 없습니다. 직접 입력도 가능합니다.</div>';
    return;
  }
  box.innerHTML=candidates.map(c=>`<button type="button" class="sp-bogang-candidate"
    data-key="${_spAttr(c.key)}" data-slot-key="${_spAttr(c.slotKey)}" data-name="${_spAttr(c.n)}" data-age="${_spAttr(c.a)}"
    data-slot-keys="${_spAttr(c.slotKeys)}" data-phone="${_spAttr(c.p)}" data-teacher="${_spAttr(c.teacher)}" data-day="${_spAttr(c.day)}" data-time="${_spAttr(c.time)}" data-label="${_spAttr(c.label)}"
    style="width:100%;display:flex;justify-content:space-between;gap:6px;align-items:center;padding:5px 6px;border:0;border-bottom:1px solid #E5E7EB;background:#fff;cursor:pointer;text-align:left;font-family:inherit">
      <span style="font-size:11px;font-weight:800;color:#111">${esc(c.n)}${c.a?esc(c.a):''}</span>
      <span style="font-size:10px;color:#4B5563;white-space:nowrap">${esc(c.label||'-')}</span>
    </button>`).join('');
}
function _setBogangSelected(data){
  const fields={
    key:'sp-bogang-student-key',
    slotKey:'sp-bogang-student-slot',
    slotKeys:'sp-bogang-student-slots',
    p:'sp-bogang-phone',
    a:'sp-bogang-age',
    teacher:'sp-bogang-teacher',
    day:'sp-bogang-day',
    time:'sp-bogang-time',
  };
  Object.entries(fields).forEach(([k,id])=>{
    const el=document.getElementById(id);
    if(el) el.value=data&&data[k]||'';
  });
  const selected=document.getElementById('sp-bogang-selected');
  if(selected){
    const summary=_bogangSelectedSummary(data);
    selected.textContent=summary?'선택됨 · '+summary:'원생을 선택하면 요일/담당쌤이 함께 저장됩니다.';
    selected.style.color=summary?'#5B21B6':'#9CA3AF';
  }
}
function _readBogangSelected(){
  const slotKey=document.getElementById('sp-bogang-student-slot')?.value||'';
  if(!slotKey) return null;
  return {
    slotKey,
    slotKeys:document.getElementById('sp-bogang-student-slots')?.value||slotKey,
    p:document.getElementById('sp-bogang-phone')?.value||'',
    teacher:document.getElementById('sp-bogang-teacher')?.value||'',
    day:document.getElementById('sp-bogang-day')?.value||'',
    time:document.getElementById('sp-bogang-time')?.value||'',
  };
}
function buildBogangFormHtml(existBo){
  const boOn = !!existBo;
  const selected={
    key:'',
    slotKey:existBo?.studentSlotKey||'',
    slotKeys:Array.isArray(existBo?.studentSlotKeys)?existBo.studentSlotKeys.join('|'):(existBo?.studentSlotKey||''),
    p:existBo?.p||'',
    a:existBo?.a||'',
    teacher:existBo?.studentTeacher||'',
    day:existBo?.studentDay||'',
    time:existBo?.studentTime||'',
  };
  const selectedSummary=_bogangSelectedSummary(selected);
  return `<div style="padding:6px 0;border-top:1px solid #E5E7EB;margin-top:4px">
    <input class="fi" id="sp-bogang-name" placeholder="이름" value="${existBo?esc(existBo.n||''):''}" style="margin:0 0 4px;padding:4px 6px;font-size:11px">
    <input type="hidden" id="sp-bogang-student-key" value="">
    <input type="hidden" id="sp-bogang-student-slot" value="${_spAttr(selected.slotKey)}">
    <input type="hidden" id="sp-bogang-student-slots" value="${_spAttr(selected.slotKeys)}">
    <input type="hidden" id="sp-bogang-phone" value="${_spAttr(selected.p)}">
    <input type="hidden" id="sp-bogang-age" value="${_spAttr(selected.a)}">
    <input type="hidden" id="sp-bogang-teacher" value="${_spAttr(selected.teacher)}">
    <input type="hidden" id="sp-bogang-day" value="${_spAttr(selected.day)}">
    <input type="hidden" id="sp-bogang-time" value="${_spAttr(selected.time)}">
    <div id="sp-bogang-selected" style="font-size:10px;color:${selectedSummary?'#5B21B6':'#9CA3AF'};font-weight:700;margin:-1px 0 4px;min-height:14px">
      ${selectedSummary?'선택됨 · '+esc(selectedSummary):'원생을 선택하면 요일/담당쌤이 함께 저장됩니다.'}
    </div>
    <div id="sp-bogang-candidates" style="max-height:132px;overflow:auto;border:1px solid #E5E7EB;border-radius:7px;margin:0 0 4px;background:#fff">
      <div style="padding:5px 6px;color:#9CA3AF;font-size:10px">이름을 입력하면 원생 후보가 표시됩니다.</div>
    </div>
    <div style="display:flex;gap:4px">
      <button class="btn btn-p" id="sp-mark-bogang" style="flex:1;padding:4px;font-size:10px;background:#7C3AED">${boOn?'보강 수정':'보강 등록'}</button>
      ${boOn?'<button class="btn btn-o" id="sp-mark-move" style="padding:4px 6px;font-size:10px;color:#7C3AED;border-color:#7C3AED">이동</button>':''}
      ${boOn?'<button class="btn btn-d" id="sp-mark-bogang-del" style="padding:4px 8px;font-size:10px">삭제</button>':''}
    </div>
  </div>`;
}

/**
 * 샘플 폼 HTML
 * @param existSa 기존 샘플 데이터({n,a,p}) 또는 null
 */
function buildSampleFormHtml(existSa){
  const saOn = !!existSa;
  return `<div style="padding:6px 0;border-top:1px solid #E5E7EB;margin-top:4px">
    <div style="display:flex;gap:4px;margin-bottom:4px">
      <input class="fi" id="sp-sample-name" placeholder="이름" value="${existSa?esc(existSa.n||''):''}" style="flex:1;margin:0;padding:4px 6px;font-size:11px">
      <input class="fi" id="sp-sample-age" type="number" placeholder="나이" value="${existSa&&existSa.a?existSa.a:''}" style="width:55px;margin:0;padding:4px 6px;font-size:11px">
    </div>
    <input class="fi" id="sp-sample-phone" placeholder="010-0000-0000" value="${existSa&&existSa.p?esc(existSa.p):''}" style="margin:0 0 4px;padding:4px 6px;font-size:11px">
    <input class="fi" id="sp-sample-memo" placeholder="메모 (선택)" value="${existSa&&existSa.memo?esc(existSa.memo):''}" style="margin:0 0 4px;padding:4px 6px;font-size:11px">
    <div style="display:flex;gap:4px">
      <button class="btn btn-p" id="sp-mark-sample" style="flex:1;padding:4px;font-size:10px;background:#F59E0B">${saOn?'샘플 수정':'샘플 등록'}</button>
      ${saOn?'<button class="btn btn-o" id="sp-mark-move" style="padding:4px 6px;font-size:10px;color:#F59E0B;border-color:#F59E0B">이동</button>':''}
      ${saOn?'<button class="btn btn-d" id="sp-mark-sample-del" style="padding:4px 8px;font-size:10px">삭제</button>':''}
    </div>
  </div>`;
}

/**
 * 휴원 폼 HTML
 * @param existing 기존 휴원 데이터({from,to}) 또는 null
 */
function buildHyuwonFormHtml(existing){
  const dates=(existing&&existing.dates)?existing.dates:[];
  const _dl=ds=>{const p=ds.slice(5).split('-');return parseInt(p[0])+'/'+parseInt(p[1]);};
  const dateLabels=dates.slice().sort().map(d=>_dl(d)).join(', ');
  return `<div style="padding:6px 0;border-top:1px solid #E5E7EB;margin-top:4px">
    <div style="font-size:10px;font-weight:700;color:#0EA5E9;margin-bottom:4px">
      휴원 날짜 클릭 선택 (최대 14일)${dates.length?' · '+dates.length+'일':''}
    </div>
    ${dateLabels?`<div style="font-size:9px;color:#0369A1;margin-bottom:4px;line-height:1.4;word-break:break-all">${dateLabels}</div>`:'<div style="font-size:9px;color:#9CA3AF;margin-bottom:4px">위 날짜를 클릭하세요</div>'}
    ${dates.length?'<button class="btn btn-d" id="sp-hyuwon-del" style="width:100%;padding:4px;font-size:10px">전체 해제</button>':''}
  </div>`;
}

/**
 * 등록 폼 HTML (신규 학생 등록 예약)
 * [v99] 차량/승하차 장소/메모도 한 번에 입력
 * [v102] 성별도 입력
 */
function buildEnrollFormHtml(existing){
  const e=existing||{};
  return `<div style="padding:6px 0;border-top:1px solid #E5E7EB;margin-top:4px">
    <div style="display:flex;gap:4px;margin-bottom:4px">
      <input class="fi" id="sp-enroll-name" placeholder="이름" value="${e.name?esc(e.name):''}" style="flex:1;margin:0;padding:4px 6px;font-size:11px">
      <input class="fi" id="sp-enroll-age" type="number" placeholder="나이" value="${e.age||''}" style="width:55px;margin:0;padding:4px 6px;font-size:11px">
    </div>
    <input class="fi" id="sp-enroll-phone" placeholder="010-0000-0000" value="${e.p?esc(e.p):''}" style="margin:0 0 4px;padding:4px 6px;font-size:11px">
    <div class="sp-chip-row" style="margin-bottom:4px">
      <div class="sp-vt-col new-col ${e.isNew?'on':''}" id="sp-enroll-new">
        <span class="sp-vt-label">신규</span>
        <span class="sp-vt-toggle"></span>
      </div>
      <div class="sp-vt-col reenroll-col ${e.reenroll?'on':''}" id="sp-enroll-reenroll">
        <span class="sp-vt-label">재등록</span>
        <span class="sp-vt-toggle"></span>
      </div>
      <button type="button" class="sp-chip male ${e.g==='m'?'on':''}" id="sp-enroll-gender-m">남</button>
      <button type="button" class="sp-chip female ${e.g==='f'?'on':''}" id="sp-enroll-gender-f">여</button>
    </div>
    ${(()=>{ const p=_parseLoc(e.loc); return `
    <div style="margin:0 0 4px;padding:4px 6px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px">
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:2px">
        <input class="fi" id="sp-enroll-pickup" placeholder="승차 장소" style="flex:1;margin:0;padding:3px 6px;font-size:11px" value="${esc(p.pickUp||'')}" ${p.pickSelf?'disabled':''}>
        <label style="display:flex;align-items:center;gap:2px;font-size:10px;font-weight:600;cursor:pointer;white-space:nowrap"><input type="checkbox" id="sp-enroll-pick-self" ${p.pickSelf?'checked':''}> 자가</label>
      </div>
      <div style="display:flex;gap:4px;align-items:center">
        <input class="fi" id="sp-enroll-dropoff" placeholder="하차 장소" style="flex:1;margin:0;padding:3px 6px;font-size:11px" value="${esc(p.dropOff||'')}" ${p.dropSelf?'disabled':''}>
        <label style="display:flex;align-items:center;gap:2px;font-size:10px;font-weight:600;cursor:pointer;white-space:nowrap"><input type="checkbox" id="sp-enroll-drop-self" ${p.dropSelf?'checked':''}> 자가</label>
      </div>
    </div>
    `;})()}
    <textarea class="fi" id="sp-enroll-memo" placeholder="메모" style="margin:0 0 4px;padding:4px 6px;font-size:11px;min-height:28px">${e.memo?esc(e.memo):''}</textarea>
    <div style="display:flex;gap:4px">
      <button class="btn btn-p" id="sp-enroll-set" style="flex:1;padding:4px;font-size:10px;background:#3B82F6">${existing?'등록 수정':'등록 예약'}</button>
      ${existing?'<button class="btn btn-o" id="sp-enroll-move" style="padding:4px 6px;font-size:10px;color:#3B82F6;border-color:#3B82F6">이동</button>':''}
      ${existing?'<button class="btn btn-d" id="sp-enroll-del" style="padding:4px 8px;font-size:10px">해제</button>':''}
    </div>
  </div>`;
}

/**
 * 선택된 날짜의 액션 패널 (결석/보강/샘플/제외/등록 버튼 + 폼)
 * @returns {string} HTML, selDate가 없으면 빈 문자열
 */
function renderActionPanel(slotKey, selDate, retireDate, enrollDate, enrollMode, hasStu){
  if(!selDate) return '';

  const curMark=getMark(slotKey,selDate);
  const retireEntry=RETIRE_MAP[slotKey]||null;
  const isRetire=retireDate===selDate;
  const isEnroll=enrollDate===selDate;

  const abOn=curMark?.type==='absent';
  const sub=curMark?.sub||null;
  const boOn=curMark?.type==='bogang'||(abOn&&sub?.type==='bogang');
  const saOn=curMark?.type==='sample'||(abOn&&sub?.type==='sample');

  // 휴원 상태
  const hyuwon=HYUWON_MAP[slotKey];
  const hyOn=!!hyuwon;

  // [v114] 원생이 있고 제외 예약이 없으면 등록 버튼 잠금
  const enrollLocked = hasStu && !retireDate;

  // 폼 선택: 제외/보강/샘플/등록/휴원 중 하나만 표시
  let formHtml='';
  if(_stuPopup.showRetire){
    const stu=getStu(_stuPopup.t,_stuPopup.day,_stuPopup.lane,_stuPopup.row);
    formHtml=buildRetireChoiceFormHtml(slotKey,selDate,stu,isRetire?retireEntry:null);
  } else if(_stuPopup.showBogang){
    const existBo=boOn?(sub?.type==='bogang'?sub:(curMark?.type==='bogang'?curMark:null)):null;
    formHtml=buildBogangFormHtml(existBo);
  } else if(_stuPopup.showSample){
    const existSa=saOn?(sub?.type==='sample'?sub:(curMark?.type==='sample'?curMark:null)):null;
    formHtml=buildSampleFormHtml(existSa);
  } else if(_stuPopup.showEnroll&&isEnroll&&!enrollMode){
    // 등록일 클릭 → 수정 폼 (기존 데이터 채움)
    formHtml=buildEnrollFormHtml(ENROLL_MAP[slotKey]);
  } else if(_stuPopup.showEnroll&&!isEnroll&&!enrollMode&&!enrollLocked){
    formHtml=buildEnrollFormHtml();
  } else if(_stuPopup.showHyuwon){
    formHtml=buildHyuwonFormHtml(hyuwon);
  }

  // [v118] 6개 액션 버튼 (결석/보강/샘플/제외/등록/휴원). 제외 → 제외, 등원 → 등록.
  const bs=`font-size:10px;padding:4px 0;flex:1;`;
  const btnStyle=(on,color)=>on
    ? `${bs}background:${color};color:#fff;border:none`
    : `${bs}background:#fff;border:1.5px solid ${color};color:${color}`;
  const enrollBtnStyle = enrollLocked
    ? `${bs}background:#F3F4F6;border:1.5px solid #D1D5DB;color:#9CA3AF;cursor:not-allowed`
    : btnStyle(isEnroll,'#3B82F6');

  return `<div style="margin-top:6px;padding:6px;border:1.5px solid #E5E7EB;border-radius:8px">
    <div style="display:flex;gap:3px;margin-bottom:3px">
      <button class="btn" id="sp-mark-absent"      style="${btnStyle(abOn,'#EF4444')}">${abOn?'결석 해제':'결석'}</button>
      <button class="btn" id="sp-mark-bogang-show" style="${btnStyle(boOn,'#7C3AED')}">보강</button>
      <button class="btn" id="sp-mark-sample-show" style="${btnStyle(saOn,'#F59E0B')}">샘플</button>
    </div>
    <div style="display:flex;gap:3px">
      <button class="btn" id="sp-retire-set"       style="${btnStyle(isRetire||_stuPopup.showRetire,'#333')}">제외</button>
      <button class="btn" id="sp-enroll-show"      style="${enrollBtnStyle}"${enrollLocked?' title="제외 예약 후 등록 가능"':''}>등록</button>
      <button class="btn" id="sp-hyuwon-show"      style="${btnStyle(hyOn,'#0EA5E9')}">${hyOn?'휴원중':'휴원'}</button>
    </div>
    ${formHtml}
  </div>`;
}

function buildRetireChoiceFormHtml(slotKey, ds, stu, existingEntry){
  const current=_retireChoiceKind(existingEntry,stu,slotKey);
  const isReserveMove=_isReserveMoveEntry(existingEntry);
  const item=(kind,title,desc,color,disabled)=>{
    const on=current===kind;
    return `<button type="button" class="sp-retire-choice ${on?'on':''}" data-kind="${kind}" ${disabled?'disabled':''} style="--rc:${color}">
      <b>${title}</b><span>${desc}</span>
    </button>`;
  };
  const deleteButton=existingEntry?`<button type="button" id="sp-retire-del" class="sp-retire-delete">제외 예약 삭제</button>`:'';
  const dateLabel=ds?ds.slice(5).replace('-','/'):'';
  return `<div class="sp-retire-panel">
    <div class="sp-retire-panel-title">${existingEntry?'제외 종류 변경':'제외 종류 선택'} <span>${esc(dateLabel)}</span></div>
    ${item('retire','퇴원','퇴원 기록에 남깁니다','#EF4444',isReserveMove)}
    ${item('move','이동','반/요일/시간 변경으로 빠지는 경우','#6B7280',false)}
    ${item('reduce','횟수줄임','특정 요일 시수만 줄어드는 경우','#4B5563',isReserveMove)}
    ${deleteButton}
  </div>`;
}

/**
 * 학생 팝업 좌측 컬럼: 이름/나이/전화/성별/신규/메모/저장·삭제·이동 버튼
 * [v100] enrollMode=true일 때: 빈 셀에서 날짜+등록 클릭 후. 같은 폼을 등록 예약 입력에 재활용.
 *   - 저장 버튼이 "등록 예약" 버튼으로 바뀜
 *   - 삭제/비활성화/이동 버튼은 숨김
 */
function buildStuPopupLeft(stu, slotKey, enrollMode){
  const curMonth = SCHEDULE_PERIODS[getCurrentPeriod()].month;
  return `<div class="stu-popup-left">
    <div class="stu-popup-row">
      <div style="flex:1">
        <label class="fl">이름</label>
        <input class="fi" id="sp-name" value="${stu?esc(stu.n):''}" placeholder="이름">
      </div>
      <div style="width:60px">
        <label class="fl">나이</label>
        <input class="fi" id="sp-age" type="number" value="${stu&&stu.a?stu.a:''}" placeholder="" style="width:100%">
      </div>
    </div>
    <div style="margin-bottom:4px">
      <label class="fl">전화번호</label>
      <input class="fi" id="sp-phone" value="${stu&&stu.p?esc(stu.p):''}" placeholder="010-0000-0000" style="margin-top:2px">
    </div>
    <div class="sp-chip-row">
      <div class="sp-vt-col new-col ${stu&&stu.isNew&&stu.isNew===curMonth?'on':''}" id="sp-new">
        <span class="sp-vt-label">신규</span>
        <span class="sp-vt-toggle"></span>
      </div>
      ${enrollMode?`<div class="sp-vt-col reenroll-col" id="sp-reenroll">
        <span class="sp-vt-label">재등록</span>
        <span class="sp-vt-toggle"></span>
      </div>`:''}
      <button type="button" class="sp-chip male ${stu&&stu.g==='m'?'on':''}" id="sp-gender-m">남</button>
      <button type="button" class="sp-chip female ${stu&&stu.g==='f'?'on':''}" id="sp-gender-f">여</button>
    </div>
    <div style="margin-bottom:4px">
      <label class="fl">승하차</label>
      ${(()=>{ const p=_parseLoc(stu&&stu.loc); return `
        <div style="display:flex;gap:4px;align-items:center;margin-top:2px">
          <input class="fi" id="sp-pickup" placeholder="승차 장소" style="flex:1;margin:0;padding:4px 6px;font-size:11px" value="${esc(p.pickUp||'')}" ${p.pickSelf?'disabled':''}>
          <label style="display:flex;align-items:center;gap:2px;font-size:10px;font-weight:600;cursor:pointer;white-space:nowrap"><input type="checkbox" id="sp-pick-self" ${p.pickSelf?'checked':''}> 자가</label>
        </div>
        <div style="display:flex;gap:4px;align-items:center;margin-top:2px">
          <input class="fi" id="sp-dropoff" placeholder="하차 장소" style="flex:1;margin:0;padding:4px 6px;font-size:11px" value="${esc(p.dropOff||'')}" ${p.dropSelf?'disabled':''}>
          <label style="display:flex;align-items:center;gap:2px;font-size:10px;font-weight:600;cursor:pointer;white-space:nowrap"><input type="checkbox" id="sp-drop-self" ${p.dropSelf?'checked':''}> 자가</label>
        </div>
      `; })()}
    </div>
    <div style="margin-bottom:4px">
      <label class="fl">메모</label>
      <textarea class="fi" id="sp-memo" placeholder="메모" style="margin-top:2px">${stu&&stu.memo?esc(stu.memo):''}</textarea>
    </div>
    ${enrollMode
      ? `<div class="stu-popup-actions">
          <button class="btn btn-p" id="sp-enroll-from-left" style="flex:1;background:#3B82F6">📅 등록 예약</button>
        </div>
        <div style="font-size:10px;color:#3B82F6;text-align:center;margin-top:4px;font-weight:700">${_stuPopup.selDate?_stuPopup.selDate.slice(5).replace('-','/')+' 등록 예약 입력 중':''}</div>`
      : `<div class="stu-popup-actions">
          <button class="btn btn-p" id="sp-save" style="flex:1">저장</button>
          ${stu?'<button class="btn btn-d" id="sp-del">삭제</button>':''}
          ${!stu?`<button class="btn btn-o" id="sp-disable" style="font-size:10px;padding:4px 8px;color:#888;border-color:#888">${isDisabled(slotKey)?'활성화':'비활성화'}</button>`:''}
        </div>
        ${stu?`<div style="display:flex;gap:4px;margin-top:4px">
          <button class="btn btn-o" id="sp-move-all" style="flex:1;font-size:10px;padding:4px;color:#F59E0B;border-color:#F59E0B">📦 전체 이동</button>
          <button class="btn btn-o" id="sp-move-stu" style="flex:1;font-size:10px;padding:4px;color:#F59E0B;border-color:#F59E0B">👤 원생만 이동</button>
          <button class="btn btn-o" id="sp-copy-stu" style="flex:1;font-size:10px;padding:4px;color:#10B981;border-color:#10B981">📋 복사</button>
        </div>
        <div style="display:flex;gap:4px;margin-top:4px">
          <button class="btn btn-o" id="sp-swap" style="flex:1;font-size:10px;padding:4px;color:#8B5CF6;border-color:#8B5CF6">🔄 자리바꾸기</button>
          <button class="btn btn-o" id="sp-move-reserve" style="flex:1;font-size:10px;padding:4px;color:#EC4899;border-color:#EC4899">📅 예약 이동 (전체)</button>
        </div>`:''}`
    }
  </div>`;
}

/**
 * 학생 팝업 우측 컬럼: 날짜 그리드 + 액션 패널
 */
function buildStuPopupRight(slotKey, selDate, classDates, curPeriod, nextPeriod, retireDate, retireName, enrollDate, enrollName, actionHtml){
  return `<div class="stu-popup-right">
    <div class="stu-dates-label">${curPeriod.month}월 수업</div>
    <div class="stu-dates-row">${renderDateBoxes(classDates.cur, slotKey, selDate, retireDate, retireName, enrollDate, enrollName)}</div>
    ${classDates.next.length?`
      <div class="stu-dates-label" style="margin-top:6px">${nextPeriod.month}월 수업</div>
      <div class="stu-dates-row">${renderDateBoxes(classDates.next, slotKey, selDate, retireDate, retireName, enrollDate, enrollName)}</div>
    `:''}
    ${actionHtml}
  </div>`;
}

/**
 * [v105] 좌측 폼 입력값 캡처/복원
 * renderStuPopup이 popup.innerHTML을 통째로 다시 그려서 사용자 입력이 사라지는 걸 방지.
 * 우측 버튼(등록/결석/날짜 등)을 눌러 re-render되어도 좌측에 타이핑한 내용이 살아남음.
 */
function captureStuFormDraft(){
  const get = id => document.getElementById(id);
  const name=get('sp-name');
  if(!name) return null; // 폼이 아직 없음
  // [v118] 승차/하차 각각 자가 체크
  const pickUp   = get('sp-pickup')?.value || '';
  const dropOff  = get('sp-dropoff')?.value || '';
  const pickSelf = get('sp-pick-self')?.checked || false;
  const dropSelf = get('sp-drop-self')?.checked || false;
  return {
    name: name.value,
    age: get('sp-age')?.value || '',
    phone: get('sp-phone')?.value || '',
    loc: _buildLoc(pickUp, dropOff, pickSelf, dropSelf),
    memo: get('sp-memo')?.value || '',
    gender: get('sp-gender-m')?.classList.contains('on') ? 'm'
          : get('sp-gender-f')?.classList.contains('on') ? 'f' : null,
    isNew: get('sp-new')?.classList.contains('on') || false,
    reenroll: get('sp-reenroll')?.classList.contains('on') || false,
  };
}
function restoreStuFormDraft(d){
  if(!d) return;
  const get = id => document.getElementById(id);
  const setVal = (id,v) => { const el=get(id); if(el && v!=null) el.value=v; };
  setVal('sp-name', d.name);
  setVal('sp-age',  d.age);
  setVal('sp-phone',d.phone);
  // [v118] loc → 승차/하차/각각 자가 분리
  const _p = _parseLoc(d.loc);
  setVal('sp-pickup',  _p.pickUp);
  setVal('sp-dropoff', _p.dropOff);
  if(_p.pickSelf) { const el=get('sp-pick-self'); if(el){el.checked=true;} const inp=get('sp-pickup'); if(inp){inp.disabled=true;} }
  if(_p.dropSelf) { const el=get('sp-drop-self'); if(el){el.checked=true;} const inp=get('sp-dropoff'); if(inp){inp.disabled=true;} }
  setVal('sp-memo', d.memo);
  if(d.gender==='m') get('sp-gender-m')?.classList.add('on');
  if(d.gender==='f') get('sp-gender-f')?.classList.add('on');
  if(d.isNew) get('sp-new')?.classList.add('on');
  if(d.reenroll) get('sp-reenroll')?.classList.add('on');
}

function renderStuPopup(freshOpen){
  // [v105] 첫 렌더가 아니면 좌측 폼 입력값을 보존 (re-render 시 텍스트 손실 방지)
  const draft = freshOpen ? null : captureStuFormDraft();

  const popup=document.getElementById('stu-popup');
  const {t,day,lane,row,selDate}=_stuPopup;
  const stu=getStu(t,day,lane,row);
  const inst=getInst(t,day,lane);
  const slotKey=t+'/'+day+'/'+lane+'/'+row;
  const retireEntry=RETIRE_MAP[slotKey]||null;
  const retireDate=(typeof retireEntry==='string'?retireEntry:retireEntry?.ds)||null;
  const retireName=retireEntry?_popupRetireDateLabel(retireEntry,stu,slotKey):'';
  const enrollEntry=ENROLL_MAP[slotKey]||null;
  const enrollDate=enrollEntry?.ds||null;
  const enrollName=enrollEntry?((enrollEntry.name||'')+(enrollEntry.age||'')):'';

  const classDates=getClassDatesForDay(day);

  const curPeriod=SCHEDULE_PERIODS[getCurrentPeriod()];
  const nextPeriod=SCHEDULE_PERIODS[getCurrentPeriod()+1]||null;

  // [v100] 빈 셀 + 등록 폼 활성 = 좌측 폼이 등록 입력 모드로 동작
  const enrollMode = !stu && _stuPopup.showEnroll && !!selDate && enrollDate!==selDate;

  const actionHtml=renderActionPanel(slotKey, selDate, retireDate, enrollDate, enrollMode, !!stu);

  popup.innerHTML=`
    <div class="stu-popup-hd">${day} ${t} ${lane}레인 ${row}번${inst?' · '+instDisplay(inst):''}<span style="margin-left:auto;cursor:pointer;opacity:.5;font-size:16px" onclick="closeStuPopup()">✕</span></div>
    <div class="stu-popup-body">
      ${buildStuPopupLeft(stu, slotKey, enrollMode)}
      ${buildStuPopupRight(slotKey, selDate, classDates, curPeriod, nextPeriod, retireDate, retireName, enrollDate, enrollName, actionHtml)}
    </div>
  `;
  // [v105] 입력값 복원
  if(draft) restoreStuFormDraft(draft);
  applyStuPopupReadOnlyState();
}

// 이벤트 위임 (학생 팝업)
/* ──── 학생 팝업 클릭 핸들러 (분기별 함수 분리) ──── */

/**
 * 클릭 이벤트에 대한 컨텍스트 생성
 * @returns {Object|null} ctx = {t, day, lane, row, key, slotKey} or null if popup not active
 */
function makeStuPopupCtx(){
  const {t,day,lane,row,key}=_stuPopup;
  if(!key) return null;
  return {t, day, lane, row, key, slotKey: t+'/'+day+'/'+lane+'/'+row};
}

/* ── 단순 토글 핸들러 ── */

function handleGenderM(e, ctx){
  const btn=document.getElementById('sp-gender-m');
  const other=document.getElementById('sp-gender-f');
  btn.classList.toggle('on');
  other.classList.remove('on');
}

function handleGenderF(e, ctx){
  const btn=document.getElementById('sp-gender-f');
  const other=document.getElementById('sp-gender-m');
  btn.classList.toggle('on');
  other.classList.remove('on');
}

// [v104] 신규 chip 토글 (이전엔 checkbox였음)
function handleNewToggle(e, ctx){
  const btn=document.getElementById('sp-new');
  if(btn){
    btn.classList.toggle('on');
    if(btn.classList.contains('on')) document.getElementById('sp-reenroll')?.classList.remove('on');
  }
}

function handleReenrollToggle(e, ctx){
  const btn=document.getElementById('sp-reenroll');
  if(btn){
    btn.classList.toggle('on');
    if(btn.classList.contains('on')) document.getElementById('sp-new')?.classList.remove('on');
  }
}

function handleMoveAll(e, ctx){ startMove('all'); }
function handleMoveStu(e, ctx){ startMove('stu'); }
function handleCopyStu(e, ctx){ startMove('copy'); }
function handleEnrollMove(e, ctx){ startMove('enroll'); }
function handleMoveReserve(e, ctx){ startMove('reserve'); }
function handleSwap(e, ctx){ startMove('swap'); }

async function handleDisable(e, ctx){
  const wasDis=isDisabled(ctx.slotKey);
  try{
    await updateDisabledMapTx(disabled=>{
      if(wasDis) delete disabled[ctx.slotKey];
      else disabled[ctx.slotKey]=true;
      return disabled;
    });
    closeStuPopup();
    buildTable();
    toast(wasDis?'활성화 완료':'비활성화 완료','ok');
  }catch(err){
    toast(err?.message||'저장 실패','err');
    console.error(err);
  }
}

/* ── 저장/삭제/날짜박스 핸들러 ── */

async function handleSave(e, ctx){
  const {t, day, lane, row, key} = ctx;
  const slotKey=t+'/'+day+'/'+lane+'/'+row;

  // [FIX] 미래 등록 예약이 있는 빈 셀에서 저장 차단 → 등록일에 자동 등록됨
  const pendingEnroll=ENROLL_MAP[slotKey];
  if(pendingEnroll && pendingEnroll.ds>toDateStr(getToday()) && !getStu(t,day,lane,row)){
    toast('등록 예약이 있습니다 ('+pendingEnroll.name+'). 등록일에 자동 등록됩니다.','err');
    return;
  }

  const name=document.getElementById('sp-name').value.trim();
  const age=parseInt(document.getElementById('sp-age').value)||null;
  const phone=normPhone(document.getElementById('sp-phone').value);
  const isNewCheck=document.getElementById('sp-new')?.classList.contains('on')||false;
  const gender=document.getElementById('sp-gender-m')?.classList.contains('on')?'m'
    :(document.getElementById('sp-gender-f')?.classList.contains('on')?'f':null);
  // [v118] 승차/하차 각각 자가 → loc 합성
  const _pickUp = document.getElementById('sp-pickup')?.value.trim() || '';
  const _dropOff = document.getElementById('sp-dropoff')?.value.trim() || '';
  const _pickSelf = document.getElementById('sp-pick-self')?.checked || false;
  const _dropSelf = document.getElementById('sp-drop-self')?.checked || false;
  const loc = _buildLoc(_pickUp, _dropOff, _pickSelf, _dropSelf);
  const vehicle=_locUsesVehicle(loc);
  const memo=document.getElementById('sp-memo')?.value.trim()||'';

  const oldStu=getStu(t,day,lane,row);
  try{
    await updateStudentsTx((students,abort)=>{
      const idx=students.findIndex(s=>s.t===t&&s.d===day&&s.l===lane&&s.r===row);
      const remoteOld=idx>=0?students[idx]:null;
      if(!oldStu && remoteOld && name){
        abort('이미 다른 학생이 등록된 자리입니다');
        return;
      }
      if(oldStu && remoteOld && (remoteOld.n!==oldStu.n || remoteOld.a!==oldStu.a)){
        abort('다른 기기에서 먼저 변경된 자리입니다');
        return;
      }
      if(idx>=0) students.splice(idx,1);
      if(name){
        const obj={n:name,a:age,t,d:day,l:lane,r:row};
        if(phone) obj.p=phone;
        if(vehicle) obj.v=true;
        if(gender) obj.g=gender;
        if(isNewCheck) obj.isNew=oldStu&&oldStu.isNew?oldStu.isNew:SCHEDULE_PERIODS[getCurrentPeriod()].month;
        if(loc) obj.loc=loc;
        if(memo) obj.memo=memo;
        students.push(obj);
      }
      return students;
    });
    // 비활성화 해제
    if(name&&DISABLED_MAP[key]){
      await updateDisabledMapTx(disabled=>{delete disabled[key];return disabled;});
    }
    _flashKey=key;
    closeStuPopup();
    buildTable();
    toast(name?name+' 저장':'삭제 완료','ok');
  }catch(err){
    toast(err?.message||'저장 실패','err');
    console.error(err);
  }
}

async function handleDelete(e, ctx){
  const {t, day, lane, row, key} = ctx;
  const oldStu=getStu(t,day,lane,row);
  try{
    await updateStudentsTx((students,abort)=>{
      const idx=students.findIndex(s=>s.t===t&&s.d===day&&s.l===lane&&s.r===row);
      const remoteOld=idx>=0?students[idx]:null;
      if(oldStu && remoteOld && (remoteOld.n!==oldStu.n || remoteOld.a!==oldStu.a)){
        abort('다른 기기에서 먼저 변경된 자리입니다');
        return;
      }
      if(idx>=0) students.splice(idx,1);
      return students;
    });
    _flashKey=key;
    closeStuPopup();
    buildTable();
    toast('학생 삭제','ok');
  }catch(err){
    toast(err?.message||'삭제 실패','err');
    console.error(err);
  }
}

/**
 * 날짜 박스 클릭: 4가지 분기
 * 1) 제외일 클릭 → 제외 해제
 * 2) 등록일 클릭 → 등록 해제
 * 3) 같은 날짜 재클릭 → 선택 해제
 * 4) 새 날짜 → 선택 + 기존 마크 있으면 해당 폼 자동 열기
 */
async function handleDateBoxClick(dateBox, ctx){
  const {slotKey} = ctx;
  const ds=dateBox.dataset.ds;

  // 0) 휴원 모드면 날짜 토글
  if(_stuPopup.showHyuwon){
    const curHyuwon=HYUWON_MAP[slotKey];
    const isHyuwonOn=!!(curHyuwon&&curHyuwon.dates&&curHyuwon.dates.includes(ds));
    if(isHyuwonOn&&!confirm('삭제하시겠습니까?')) return;
    try{
      await updateHyuwonMapTx(map=>{
        let hyuwon=map[slotKey];
        if(!hyuwon) hyuwon={dates:[]};
        // 구 형식(from/to) → 신 형식(dates) 변환
        if(hyuwon.from&&!hyuwon.dates){hyuwon={dates:[]};}
        hyuwon={dates:[...(hyuwon.dates||[])]};
        const idx=hyuwon.dates.indexOf(ds);
        if(idx>=0){
          hyuwon.dates.splice(idx,1);
        } else {
          if(hyuwon.dates.length>=14){toast('최대 14일까지 선택 가능','err');return map;}
          hyuwon.dates.push(ds);
        }
        if(hyuwon.dates.length) map[slotKey]=hyuwon;
        else delete map[slotKey];
        return map;
      });
      _stuPopup.selDate=ds;
      renderStuPopup();
      buildTable();
    }catch(err){
      toast(err?.message||'휴원 저장 실패','err');
      console.error(err);
    }
    return;
  }

  // 1) 제외일 클릭 → 종류 변경/삭제 모달
  if(_retireEntryDate(RETIRE_MAP[slotKey])===ds){
    _openRetireChoiceInline(ds);
    return;
  }

  // 2) 등록일 클릭 → 수정 폼 열기
  if(ENROLL_MAP[slotKey]?.ds===ds){
    _stuPopup.selDate=ds;
    _stuPopup.showEnroll=true;
    _stuPopup.showBogang=false;
    _stuPopup.showSample=false;
    _stuPopup.showHyuwon=false;
    renderStuPopup();
    setTimeout(()=>{
      const el=document.getElementById('sp-enroll-name');
      if(el){el.focus();try{el.setSelectionRange(el.value.length,el.value.length);}catch(e){}}
    },30);
    return;
  }

  // 3) 같은 날짜 재클릭 → 선택 해제
  if(_stuPopup.selDate===ds){
    _stuPopup.selDate=null;
    _stuPopup.showEnroll=false;
    _stuPopup.showBogang=false;
    _stuPopup.showSample=false;
    _stuPopup.showHyuwon=false;
    _stuPopup.showRetire=false;
    renderStuPopup();
    return;
  }

  // 4) 새 날짜 선택 + 기존 마크에 따라 폼 자동 열기
  _stuPopup.selDate=ds;
  _stuPopup.showHyuwon=false;
  _stuPopup.showRetire=false;
  const selMark=getMark(slotKey,ds);
  const selSub=selMark?.sub||null;
  if(selMark?.type==='bogang'||(selMark?.type==='absent'&&selSub?.type==='bogang')){
    _stuPopup.showBogang=true;
    _stuPopup.showSample=false;
    _stuPopup.showEnroll=false;
  } else if(selMark?.type==='sample'||(selMark?.type==='absent'&&selSub?.type==='sample')){
    _stuPopup.showSample=true;
    _stuPopup.showBogang=false;
    _stuPopup.showEnroll=false;
  }
  // 기존 폼이 열려있으면 유지 (날짜 바꿔도 닫히지 않음)
  renderStuPopup();
}

/* ── 마크(결석/보강/샘플) 핸들러 ── */

function handleMarkAbsent(e, ctx){
  const {slotKey} = ctx;
  const ds=_stuPopup.selDate;
  const cur=getMark(slotKey,ds);
  if(cur?.type==='absent'){
    // 결석 해제: sub가 있으면 sub를 최상위로 복원
    if(cur.sub) setMark(slotKey,ds,cur.sub);
    else clearMark(slotKey,ds);
  } else {
    // 결석 설정: 기존 bogang/sample이면 sub로 보존
    if(cur?.type==='bogang'||cur?.type==='sample') setMark(slotKey,ds,{type:'absent',sub:cur});
    else setMark(slotKey,ds,{type:'absent'});
  }
  _stuPopup.showBogang=false;
  _stuPopup.showSample=false;
  _stuPopup.showRetire=false;
  _flashKey=slotKey;
  renderStuPopup();
  buildTable();
}

function handleBogangShow(e, ctx){
  if(_stuPopup.showBogang){
    _stuPopup.showBogang=false;
    renderStuPopup();
    return;
  }
  _stuPopup.showBogang=true;
  _stuPopup.showSample=false;
  _stuPopup.showEnroll=false;
  _stuPopup.showHyuwon=false;
  _stuPopup.showRetire=false;
  renderStuPopup();
  setTimeout(()=>{
    document.getElementById('sp-bogang-name')?.focus();
    _renderBogangCandidates();
  },30);
}

function handleBogangSet(e, ctx){
  const {slotKey} = ctx;
  const ds=_stuPopup.selDate;
  const n=document.getElementById('sp-bogang-name')?.value.trim();
  const a=parseInt(document.getElementById('sp-bogang-age')?.value)||null;
  if(!n){toast('이름을 입력하세요','err');return;}
  const cur=getMark(slotKey,ds);
  const selected=_readBogangSelected();
  const subObj={type:'bogang',n,a};
  if(selected){
    if(selected.p) subObj.p=selected.p;
    subObj.studentSlotKey=selected.slotKey;
    if(selected.slotKeys) subObj.studentSlotKeys=selected.slotKeys.split('|').filter(Boolean);
    if(selected.teacher) subObj.studentTeacher=selected.teacher;
    if(selected.day) subObj.studentDay=selected.day;
    if(selected.time) subObj.studentTime=selected.time;
  }
  if(cur?.type==='absent') setMark(slotKey,ds,{type:'absent',sub:subObj});
  else setMark(slotKey,ds,subObj);
  const hasBo=cur?.type==='bogang'||(cur?.type==='absent'&&cur?.sub?.type==='bogang');
  _stuPopup.showBogang=false;
  _flashKey=slotKey;
  renderStuPopup();
  buildTable();
  toast(n+' 보강 '+(hasBo?'수정':'등록'),'ok');
}

function handleBogangDel(e, ctx){
  const {slotKey} = ctx;
  const ds=_stuPopup.selDate;
  const cur=getMark(slotKey,ds);
  if(cur?.type==='absent'&&cur?.sub?.type==='bogang') setMark(slotKey,ds,{type:'absent'});
  else if(cur?.type==='bogang') clearMark(slotKey,ds);
  _stuPopup.showBogang=false;
  _flashKey=slotKey;
  renderStuPopup();
  buildTable();
  toast('보강 삭제','ok');
}

function handleSampleShow(e, ctx){
  if(_stuPopup.showSample){
    _stuPopup.showSample=false;
    renderStuPopup();
    return;
  }
  _stuPopup.showSample=true;
  _stuPopup.showBogang=false;
  _stuPopup.showEnroll=false;
  _stuPopup.showHyuwon=false;
  _stuPopup.showRetire=false;
  renderStuPopup();
  setTimeout(()=>document.getElementById('sp-sample-name')?.focus(),30);
}

function handleSampleSet(e, ctx){
  const {slotKey} = ctx;
  const ds=_stuPopup.selDate;
  const n=document.getElementById('sp-sample-name')?.value.trim();
  const a=parseInt(document.getElementById('sp-sample-age')?.value)||null;
  const p=normPhone(document.getElementById('sp-sample-phone')?.value)||'';
  const memo=document.getElementById('sp-sample-memo')?.value.trim()||undefined;
  if(!n){toast('이름을 입력하세요','err');return;}
  const cur=getMark(slotKey,ds);
  const subObj={type:'sample',n,a,p:p||undefined,memo};
  if(cur?.type==='absent') setMark(slotKey,ds,{type:'absent',sub:subObj});
  else setMark(slotKey,ds,subObj);
  const hasSa=cur?.type==='sample'||(cur?.type==='absent'&&cur?.sub?.type==='sample');
  _stuPopup.showSample=false;
  _flashKey=slotKey;
  renderStuPopup();
  buildTable();
  toast(n+' 샘플 '+(hasSa?'수정':'등록'),'ok');
}

function handleSampleDel(e, ctx){
  const {slotKey} = ctx;
  const ds=_stuPopup.selDate;
  const cur=getMark(slotKey,ds);
  if(cur?.type==='absent'&&cur?.sub?.type==='sample') setMark(slotKey,ds,{type:'absent'});
  else if(cur?.type==='sample') clearMark(slotKey,ds);
  _stuPopup.showSample=false;
  _flashKey=slotKey;
  renderStuPopup();
  buildTable();
  toast('샘플 삭제','ok');
}

/* ── 휴원 핸들러 ── */

function handleHyuwonShow(e, ctx){
  _stuPopup.showHyuwon=!_stuPopup.showHyuwon;
  _stuPopup.showBogang=false;
  _stuPopup.showSample=false;
  _stuPopup.showEnroll=false;
  _stuPopup.showRetire=false;
  renderStuPopup();
}

// handleHyuwonSet 제거 — 날짜 클릭으로 즉시 토글됨

async function handleHyuwonDel(e, ctx){
  const {slotKey} = ctx;
  try{
    await updateHyuwonMapTx(map=>{delete map[slotKey];return map;});
    _stuPopup.showHyuwon=false;
    _flashKey=slotKey;
    renderStuPopup();
    buildTable();
    toast('휴원 해제','ok');
  }catch(err){
    toast(err?.message||'휴원 해제 실패','err');
    console.error(err);
  }
}

/* ── 예약(제외/등록) 핸들러 ── */

async function handleRetireSet(e, ctx){
  const {t, day, lane, row, slotKey} = ctx;
  const ds=_stuPopup.selDate;
  _stuPopup.showRetire=!_stuPopup.showRetire;
  _stuPopup.showEnroll=false;
  _stuPopup.showBogang=false;
  _stuPopup.showSample=false;
  _stuPopup.showHyuwon=false;
  renderStuPopup();
}

function _openRetireChoiceInline(ds){
  _stuPopup.selDate=ds;
  _stuPopup.showRetire=true;
  _stuPopup.showEnroll=false;
  _stuPopup.showBogang=false;
  _stuPopup.showSample=false;
  _stuPopup.showHyuwon=false;
  renderStuPopup();
}

async function _setRetireChoice(slotKey,ds,stu,existingEntry,kind){
  if(_isReserveMoveEntry(existingEntry)&&kind!=='move'){
    toast('예약 이동 제외는 이동으로 고정됩니다','err');
    return;
  }
  await updateRetireMapTx(retire=>{
    const extra=kind==='retire'
      ? {retireType:'retire'}
      : {retireType:'exclude', excludeReason:kind};
    retire[slotKey]=_reservationEntryFromStudent(stu,ds,extra);
    return retire;
  });
  if(kind==='retire'){
    if(stu && typeof addRetireHistory==='function'&&!_hasMatchingRetireHistory(stu,ds,slotKey)) addRetireHistory(stu,ds);
  } else {
    _removeMatchingRetireHistory(stu,ds,slotKey);
  }
  _flashKey=slotKey;
  renderStuPopup();
  buildTable();
}

async function handleRetireChoiceSet(e,ctx){
  const btn=e.target.closest('.sp-retire-choice');
  if(!btn||btn.disabled) return;
  const kind=btn.dataset.kind||'move';
  const {slotKey,t,day,lane,row}=ctx;
  const ds=_stuPopup.selDate;
  const stu=getStu(t,day,lane,row);
  const existingEntry=RETIRE_MAP[slotKey]||null;
  try{
    await _setRetireChoice(slotKey,ds,stu,existingEntry,kind);
    toast(kind==='retire'?'퇴원 제외로 저장':kind==='reduce'?'횟수줄임 제외로 저장':'이동 제외로 저장','ok');
  }catch(err){
    toast(err?.message||'제외 종류 저장 실패','err');
    console.error(err);
  }
}

async function handleRetireDelete(e,ctx){
  const {slotKey,t,day,lane,row}=ctx;
  const ds=_stuPopup.selDate;
  const existingEntry=RETIRE_MAP[slotKey]||null;
  if(!existingEntry) return;
  if(!confirm(_reserveMoveDeleteMessage(existingEntry))) return;
  const stu=getStu(t,day,lane,row);
  try{
    const paired=await deleteRetireReservation(slotKey);
    _removeMatchingRetireHistory(stu,ds,slotKey);
    _stuPopup.selDate=null;
    _stuPopup.showRetire=false;
    _stuPopup.showEnroll=false;
    _flashKey=slotKey;
    renderStuPopup();
    buildTable();
    toast(paired?'예약 이동 취소':'제외 해제','ok');
  }catch(err){
    toast(err?.message||'제외 해제 실패','err');
    console.error(err);
  }
}

function handleEnrollShow(e, ctx){
  const {slotKey,t,day,lane,row} = ctx;
  // [v114] 원생이 있고 제외 예약이 없으면 등록 불가
  const existingStu=getStu(t,day,lane,row);
  const hasRetire=!!RETIRE_MAP[slotKey];
  if(existingStu && !hasRetire){
    toast('제외 예약 후 등록 가능','err');
    return;
  }
  const ds=_stuPopup.selDate;
  // 같은 날짜 → 수정 폼 열기 (토글)
  if(ENROLL_MAP[slotKey]?.ds===ds){
    _stuPopup.showEnroll=!_stuPopup.showEnroll;
    _stuPopup.showBogang=false;
    _stuPopup.showSample=false;
    _stuPopup.showHyuwon=false;
    _stuPopup.showRetire=false;
    renderStuPopup();
    return;
  }
  _stuPopup.showEnroll=!_stuPopup.showEnroll;
  _stuPopup.showBogang=false;
  _stuPopup.showSample=false;
  _stuPopup.showHyuwon=false;
  _stuPopup.showRetire=false;
  renderStuPopup();
  // [v100] enrollMode면 좌측 sp-name로 포커스. 그 외엔 우측 sp-enroll-name.
  setTimeout(()=>{
    const stu=getStu(ctx.t,ctx.day,ctx.lane,ctx.row);
    const target=(!stu && _stuPopup.showEnroll)
      ? document.getElementById('sp-name')
      : document.getElementById('sp-enroll-name');
    if(target){
      target.focus();
      try{ target.setSelectionRange(target.value.length, target.value.length); }catch(e){}
    }
  },30);
}

/**
 * 등록 폼 값 읽기 공통 함수
 * @param {string} prefix - 'sp-enroll-' (우측 폼) 또는 'sp-' (좌측 폼)
 */
function _readEnrollForm(prefix){
  const g=id=>document.getElementById(id);
  const name=g(prefix+'name')?.value.trim();
  const age=parseInt(g(prefix+'age')?.value)||null;
  const phone=normPhone(g(prefix+'phone')?.value)||'';
  const gender=g(prefix+'gender-m')?.classList.contains('on')?'m'
    :(g(prefix+'gender-f')?.classList.contains('on')?'f':null);
  // [v118] 승차/하차 각각 자가 (좌측 sp- 또는 우측 sp-enroll-)
  const _pickUp = g(prefix+'pickup')?.value.trim() || '';
  const _dropOff = g(prefix+'dropoff')?.value.trim() || '';
  const _pickSelf = g(prefix+'pick-self')?.checked || false;
  const _dropSelf = g(prefix+'drop-self')?.checked || false;
  const hasSplitInputs = g(prefix+'pickup') || g(prefix+'dropoff') || g(prefix+'pick-self');
  const loc = hasSplitInputs
    ? _buildLoc(_pickUp, _dropOff, _pickSelf, _dropSelf)
    : (g(prefix+'loc')?.value.trim() || '');
  const memo=g(prefix+'memo')?.value.trim()||'';
  const isNew=g(prefix+'new')?.classList.contains('on')||false;
  const reenroll=!isNew && (g(prefix+'reenroll')?.classList.contains('on')||false);
  const vehicle=_locUsesVehicle(loc);
  return {name,age,phone,vehicle,gender,loc,memo,isNew,reenroll};
}

function _periodMonthForDate(ds){
  let month=null;
  for(let i=0;i<SCHEDULE_PERIODS.length;i++){
    const p=SCHEDULE_PERIODS[i];
    const inPeriod = ds>=p.start && (!p.end || ds<=p.end);
    const beforePeriod = ds<p.start;
    if(inPeriod || beforePeriod){
      month=p.month;
      break;
    }
  }
  if(month===null && SCHEDULE_PERIODS.length){
    month=SCHEDULE_PERIODS[SCHEDULE_PERIODS.length-1].month;
  }
  return month;
}

async function _commitEnroll(slotKey, form){
  if(!form.name){toast('이름을 입력하세요','err');return;}
  const ds=_stuPopup.selDate;
  const todayStr=toDateStr(getToday());
  const enrollMonth=(form.isNew||form.reenroll) ? _periodMonthForDate(ds) : null;

  // [FIX] 당일/과거 등록 → ENROLL_MAP 거치지 않고 즉시 STUDENTS에 등록
  if(ds<=todayStr){
    const [t,d,l,r]=slotKey.split('/');
    const li=parseInt(l), ri=parseInt(r);
    try{
      await updateStudentsTx(students=>{
        const existIdx=students.findIndex(s=>s.t===t&&s.d===d&&s.l===li&&s.r===ri);
        if(existIdx>=0) students.splice(existIdx,1);
        const obj={n:form.name, a:form.age||null, t, d, l:li, r:ri};
        if(form.phone) obj.p=form.phone;
        if(form.vehicle) obj.v=true;
        if(form.gender) obj.g=form.gender;
        if(form.loc) obj.loc=form.loc;
        if(form.memo) obj.memo=form.memo;
        if(form.isNew&&enrollMonth) obj.isNew=enrollMonth;
        else if(form.reenroll&&enrollMonth) obj.reenroll=enrollMonth;
        else obj.enrolled=ds;  // 등록 표시 (빨간 배경 시각 효과)
        students.push(obj);
        return students;
      });
      if(DISABLED_MAP[slotKey]){
        await updateDisabledMapTx(disabled=>{delete disabled[slotKey];return disabled;});
      }
      _stuPopup.selDate=null;
      _stuPopup.showEnroll=false;
      renderStuPopup(true);
      buildTable();
      toast(form.name+(form.age||'')+' 즉시 등록','ok');
    }catch(err){
      toast(err?.message||'등록 실패','err');
      console.error(err);
    }
    return;
  }

  // 미래 → ENROLL_MAP에 예약 저장
  const entry={
    ds,
    name:form.name, age:form.age,
    p:form.phone||undefined,
    isNew:form.isNew ? enrollMonth||undefined : undefined,
    reenroll:form.reenroll ? enrollMonth||undefined : undefined,
    enrolled:(!form.isNew&&!form.reenroll) ? true : undefined,
    v:form.vehicle||undefined,
    loc:form.loc||undefined,
    memo:form.memo||undefined,
    g:form.gender||undefined,
  };
  try{
    await updateEnrollMapTx(enroll=>{
      enroll[slotKey]=entry;
      return enroll;
    });
    _stuPopup.selDate=null;
    _stuPopup.showEnroll=false;
    renderStuPopup(true);
    buildTable();
    toast(form.name+(form.age||'')+' 등록 예약','ok');
  }catch(err){
    toast(err?.message||'등록 예약 실패','err');
    console.error(err);
  }
}

function handleEnrollSet(e, ctx){
  _commitEnroll(ctx.slotKey, _readEnrollForm('sp-enroll-'));
}

function handleEnrollFromLeft(e, ctx){
  _commitEnroll(ctx.slotKey, _readEnrollForm('sp-'));
}

async function handleEnrollDel(e, ctx){
  if(!confirm(_reserveMoveDeleteMessage(ENROLL_MAP[ctx.slotKey]))) return;
  try{
    const paired=await deleteEnrollReservation(ctx.slotKey);
    _stuPopup.selDate=null;
    _stuPopup.showEnroll=false;
    _flashKey=ctx.slotKey;
    renderStuPopup();
    buildTable();
    toast(paired?'예약 이동 취소':'등록 해제','ok');
  }catch(err){
    toast(err?.message||'등록 해제 실패','err');
    console.error(err);
  }
}

// [v102] 우측 등록 폼 성별 토글
function handleEnrollGenderM(e, ctx){
  const btn=document.getElementById('sp-enroll-gender-m');
  const other=document.getElementById('sp-enroll-gender-f');
  btn.classList.toggle('on');
  other.classList.remove('on');
}
function handleEnrollGenderF(e, ctx){
  const btn=document.getElementById('sp-enroll-gender-f');
  const other=document.getElementById('sp-enroll-gender-m');
  btn.classList.toggle('on');
  other.classList.remove('on');
}

// [v104] 우측 등록 폼 신규 chip 토글
function handleEnrollNewToggle(e, ctx){
  const btn=document.getElementById('sp-enroll-new');
  if(btn){
    btn.classList.toggle('on');
    if(btn.classList.contains('on')) document.getElementById('sp-enroll-reenroll')?.classList.remove('on');
  }
}

function handleEnrollReenrollToggle(e, ctx){
  const btn=document.getElementById('sp-enroll-reenroll');
  if(btn){
    btn.classList.toggle('on');
    if(btn.classList.contains('on')) document.getElementById('sp-enroll-new')?.classList.remove('on');
  }
}

/**
 * 간단한 ID-셀렉터 → 핸들러 맵
 * (ctx만 받는 핸들러들)
 */
const STU_POPUP_SIMPLE_HANDLERS = [
  ['#sp-gender-m',        handleGenderM],
  ['#sp-gender-f',        handleGenderF],
  ['#sp-new',             handleNewToggle],
  ['#sp-reenroll',        handleReenrollToggle],
  ['#sp-enroll-gender-m', handleEnrollGenderM],
  ['#sp-enroll-gender-f', handleEnrollGenderF],
  ['#sp-enroll-new',      handleEnrollNewToggle],
  ['#sp-enroll-reenroll', handleEnrollReenrollToggle],
  ['#sp-move-all',        handleMoveAll],
  ['#sp-move-stu',        handleMoveStu],
  ['#sp-copy-stu',        handleCopyStu],
  ['#sp-enroll-move',     handleEnrollMove],
  ['#sp-move-reserve',    handleMoveReserve],
  ['#sp-swap',            handleSwap],
  ['#sp-disable',         handleDisable],
];

/**
 * 마크(결석/보강/샘플) 핸들러 맵
 * 모두 _stuPopup.selDate가 필요
 */
const STU_POPUP_MARK_HANDLERS = [
  ['#sp-mark-absent',      handleMarkAbsent],
  ['#sp-mark-bogang-show', handleBogangShow],
  ['#sp-mark-bogang-del',  handleBogangDel],
  ['#sp-mark-bogang',      handleBogangSet],
  ['#sp-mark-sample-show', handleSampleShow],
  ['#sp-mark-sample-del',  handleSampleDel],
  ['#sp-mark-sample',      handleSampleSet],
  ['#sp-mark-move',        function(e,ctx){startMove('mark');}],
  ['#sp-hyuwon-show',      handleHyuwonShow],
  ['#sp-hyuwon-del',       handleHyuwonDel],
];

/**
 * 예약(제외/등록) 핸들러 맵
 * retire-set, enroll-show: _stuPopup.selDate 필요
 * enroll-set: 폼 안에서 호출되므로 selDate는 이미 보장됨
 */
/**
 * 예약(제외/등록) + 저장/삭제 핸들러 맵
 * needsDate=true: _stuPopup.selDate가 set돼야 동작
 */
const STU_POPUP_RESERVE_HANDLERS = [
  ['#sp-retire-set',  handleRetireSet,  true],
  ['.sp-retire-choice', handleRetireChoiceSet, true],
  ['#sp-retire-del', handleRetireDelete, true],
  ['#sp-enroll-show', handleEnrollShow, true],
  // [FIX] handleEnrollSet은 _stuPopup.selDate를 ENROLL_MAP.ds에 저장하므로 needsDate=true여야 함.
  //  이전엔 false라서 selDate=null인 상태로 호출되면 ds:null인 좀비 entry가 영구 저장됨.
  ['#sp-enroll-set',  handleEnrollSet,  true],
  ['#sp-enroll-del',  handleEnrollDel,  false],
  // [v100] 좌측 폼에서 등록 예약
  ['#sp-enroll-from-left', handleEnrollFromLeft, true],
  ['#sp-save',        handleSave,       false],
  ['#sp-del',         handleDelete,     false],
];

document.getElementById('stu-popup').addEventListener('click',function(e){
  e.stopPropagation();
  const ctx=makeStuPopupCtx();
  if(!ctx) return;

  const dateBox=e.target.closest('.stu-date-box');

  // [스냅샷] 읽기 전용 — 닫기 버튼만 허용, 변경 액션은 모두 차단
  const isSnap=typeof isSnapshotTab==='function'&&isSnapshotTab();
  if(isSnap){
    if(e.target.closest('#sp-close')){ closeStuPopup(); return; }
    // 다른 클릭은 무시 (보기 전용)
    return;
  }

  if(isStuPopupReadOnly()){
    if(dateBox&&!dateBox.classList.contains('closed')){
      handleReadOnlyDateBoxClick(dateBox);
    }
    return;
  }

  const bogangCandidate=e.target.closest('.sp-bogang-candidate');
  if(bogangCandidate){
    const data={
      key:bogangCandidate.dataset.key||'',
      slotKey:bogangCandidate.dataset.slotKey||'',
      slotKeys:bogangCandidate.dataset.slotKeys||bogangCandidate.dataset.slotKey||'',
      n:bogangCandidate.dataset.name||'',
      a:bogangCandidate.dataset.age||'',
      p:bogangCandidate.dataset.phone||'',
      teacher:bogangCandidate.dataset.teacher||'',
      day:bogangCandidate.dataset.day||'',
      time:bogangCandidate.dataset.time||'',
      label:bogangCandidate.dataset.label||'',
    };
    const nameEl=document.getElementById('sp-bogang-name');
    const ageEl=document.getElementById('sp-bogang-age');
    if(nameEl) nameEl.value=data.n;
    if(ageEl) ageEl.value=data.a||'';
    _setBogangSelected(data);
    const box=document.getElementById('sp-bogang-candidates');
    if(box) box.innerHTML='';
    return;
  }

  // 단순 핸들러 디스패치
  for(const [sel, fn] of STU_POPUP_SIMPLE_HANDLERS){
    if(e.target.closest(sel)){ fn(e, ctx); return; }
  }

  // 날짜 박스 클릭
  if(dateBox&&!dateBox.classList.contains('closed')){
    handleDateBoxClick(dateBox, ctx);
    return;
  }

  // 마크 핸들러 디스패치 (selDate 필요)
  if(_stuPopup.selDate){
    for(const [sel, fn] of STU_POPUP_MARK_HANDLERS){
      if(e.target.closest(sel)){ fn(e, ctx); return; }
    }
  }

  // 예약/저장/삭제 핸들러 디스패치
  for(const [sel, fn, needsDate] of STU_POPUP_RESERVE_HANDLERS){
    if(e.target.closest(sel)){
      if(needsDate && !_stuPopup.selDate) return;
      fn(e, ctx);
      return;
    }
  }
});

// Enter 키 저장
document.getElementById('stu-popup').addEventListener('keydown',function(e){
  if(isStuPopupReadOnly()) return;
  if(e.key==='Enter'){
    // [v96 #2] textarea에서 Enter는 항상 줄바꿈. 저장은 저장 버튼 클릭만.
    //   (이전엔 plain Enter가 저장+팝업닫힘으로 동작해서 사용자가 텍스트 사라진 것처럼 느꼈음)
    const ae=document.activeElement;
    if(ae&&ae.tagName==='TEXTAREA') return;
    e.preventDefault();
    // 등록 입력 필드에 포커스 있으면 등록 버튼
    if(ae?.id==='sp-enroll-name'||ae?.id==='sp-enroll-age'||ae?.id==='sp-enroll-phone'){
      document.getElementById('sp-enroll-set')?.click();
    } else if(ae?.id==='sp-bogang-name'||ae?.id==='sp-bogang-age'){
      document.getElementById('sp-mark-bogang')?.click();
    } else if(ae?.id==='sp-sample-name'||ae?.id==='sp-sample-age'||ae?.id==='sp-sample-phone'||ae?.id==='sp-sample-memo'){
      document.getElementById('sp-mark-sample')?.click();
    } else if(ae?.id==='sp-name'||ae?.id==='sp-age'||ae?.id==='sp-phone'){
      // [v100] 좌측 폼이 등록 모드면 등록 버튼, 아니면 저장 버튼
      const enrollBtn=document.getElementById('sp-enroll-from-left');
      if(enrollBtn) enrollBtn.click();
      else document.getElementById('sp-save')?.click();
    }
  }
});

document.getElementById('stu-popup').addEventListener('input',function(e){
  if(isStuPopupReadOnly()) return;
  if(e.target?.id==='sp-bogang-name'){
    _setBogangSelected(null);
    _renderBogangCandidates();
  }
});

// [v118] 승차/하차 각각 자가 체크 → 해당 input 비활성/활성
document.getElementById('stu-popup').addEventListener('change',function(e){
  const id = e.target?.id;
  // 좌측 폼
  if(id==='sp-pick-self'){
    const inp=document.getElementById('sp-pickup');
    if(inp){ inp.disabled=e.target.checked; if(e.target.checked) inp.value=''; }
  }
  if(id==='sp-drop-self'){
    const inp=document.getElementById('sp-dropoff');
    if(inp){ inp.disabled=e.target.checked; if(e.target.checked) inp.value=''; }
  }
  // 우측 등록 폼
  if(id==='sp-enroll-pick-self'){
    const inp=document.getElementById('sp-enroll-pickup');
    if(inp){ inp.disabled=e.target.checked; if(e.target.checked) inp.value=''; }
  }
  if(id==='sp-enroll-drop-self'){
    const inp=document.getElementById('sp-enroll-dropoff');
    if(inp){ inp.disabled=e.target.checked; if(e.target.checked) inp.value=''; }
  }
});

// _pendingSync → data.js (cross-file shared state)

function closeStuPopup(){
  document.getElementById('stu-popup').classList.remove('show');
  if(_stuPopup.td) _stuPopup.td.classList.remove('stu-active');
  _stuPopup.key=null;_stuPopup.selDate=null;_stuPopup.showEnroll=false;_stuPopup.showBogang=false;_stuPopup.showSample=false;_stuPopup.showHyuwon=false;_stuPopup.showRetire=false;
  if(_pendingSync){_pendingSync=false;reloadGlobalData();loadTabData();reloadBadgeMaps();buildTable();}
}

/* ════════════════════════════════════════════════════════════════
 * [v97] Esc로 팝업 닫기 (방향키 셀 이동은 v97에서 제거)
 * ════════════════════════════════════════════════════════════════ */
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    const stuP=document.getElementById('stu-popup');
    const instP=document.getElementById('inst-popup');
    if(stuP.classList.contains('show')){ closeStuPopup(); e.preventDefault(); return; }
    if(instP.classList.contains('show')){ closeInstPopup(); e.preventDefault(); return; }
  }
});

/* ════════════════════════════════════════════════════════════════
 * SECTION: 이동 모드 (전체 이동/원생만 이동)
 * ════════════════════════════════════════════════════════════════ */
let _moveMode=null; // {srcKey, type:'all'|'stu', stuData, srcTd}

function startMove(type){
  const {t,day,lane,row}=_stuPopup;
  const srcKey=t+'/'+day+'/'+lane+'/'+row;
  if(_blockReserveMoveLockedSlot(type,srcKey)) return;

  // 보강/샘플 이동 모드
  if(type==='mark'){
    const ds=_stuPopup.selDate;
    if(!ds){toast('날짜를 선택하세요','err');return;}
    const mark=getMark(srcKey,ds);
    if(!mark){toast('이동할 보강/샘플이 없습니다','err');return;}
    // 독립 보강/샘플 또는 결석 sub
    let markData,markType;
    if(mark.type==='bogang'||mark.type==='sample'){
      markData=JSON.parse(JSON.stringify(mark));
      markType=mark.type;
    } else if(mark.type==='absent'&&mark.sub){
      markData=JSON.parse(JSON.stringify(mark.sub));
      markType=mark.sub.type;
    } else {toast('보강/샘플만 이동 가능','err');return;}
    _moveMode={srcKey, type:'mark', markData, markType, srcDs:ds};
    closeStuPopup();
    document.getElementById('move-bar').style.display='flex';
    document.getElementById('move-msg').textContent=
      `📦 ${markType==='bogang'?'보강':'샘플'} ${markData.n||''} 이동 중 — 빈 셀을 클릭하세요`;
    buildTable();
    return;
  }

  // 등록 예약 이동 모드
  if(type==='enroll'){
    const enrEntry=ENROLL_MAP[srcKey];
    if(!enrEntry){toast('이동할 등록 예약이 없습니다','err');return;}
    _moveMode={srcKey, type:'enroll', enrData:JSON.parse(JSON.stringify(enrEntry))};
    closeStuPopup();
    document.getElementById('move-bar').style.display='flex';
    document.getElementById('move-msg').textContent=
      `📅 등록 예약 ${enrEntry.name||''} 이동 중 — 빈 셀을 클릭하세요`;
    buildTable();
    return;
  }

  const stu=getStu(t,day,lane,row);
  if(!stu) return;
  // 자리바꾸기 모드
  if(type==='swap'){
    _moveMode={srcKey, type:'swap', stu:JSON.parse(JSON.stringify(stu))};
    closeStuPopup();
    document.getElementById('move-bar').style.display='flex';
    document.getElementById('move-msg').textContent=
      `🔄 ${stu.n}${stu.a||''} 자리바꾸기 — 바꿀 셀을 클릭하세요 (빈 셀도 가능)`;
    buildTable();
    document.querySelectorAll('.stu-clickable').forEach(td=>{
      if(td.dataset.t===t&&td.dataset.day===day&&parseInt(td.dataset.lane)===lane&&parseInt(td.dataset.ri)===row){
        td.classList.add('stu-move-src');
      }
    });
    return;
  }
  // 예약 이동 모드 (날짜 지정 → 그날 자동 이동)
  if(type==='reserve'){
    _moveMode={srcKey, type:'reserve', stu:JSON.parse(JSON.stringify(stu))};
    closeStuPopup();
    document.getElementById('move-bar').style.display='flex';
    document.getElementById('move-msg').textContent=
      `📅 ${stu.n}${stu.a||''} 예약 이동 — 목적지 빈 셀 클릭`;
    buildTable();
    document.querySelectorAll('.stu-clickable').forEach(td=>{
      if(td.dataset.t===t&&td.dataset.day===day&&parseInt(td.dataset.lane)===lane&&parseInt(td.dataset.ri)===row){
        td.classList.add('stu-move-src');
      }
    });
    return;
  }
  // 복사 모드
  if(type==='copy'){
    _moveMode={srcKey, type:'copy', stu:JSON.parse(JSON.stringify(stu))};
    closeStuPopup();
    document.getElementById('move-bar').style.display='flex';
    document.getElementById('move-msg').textContent=
      `📋 ${stu.n}${stu.a||''} 복사 중 — 목적지 빈 셀을 클릭하세요 (원본 유지)`;
    buildTable();
    document.querySelectorAll('.stu-clickable').forEach(td=>{
      if(td.dataset.t===t&&td.dataset.day===day&&parseInt(td.dataset.lane)===lane&&parseInt(td.dataset.ri)===row){
        td.classList.add('stu-move-src');
      }
    });
    return;
  }
  _moveMode={srcKey, type, stu:JSON.parse(JSON.stringify(stu))};
  closeStuPopup();
  document.getElementById('move-bar').style.display='flex';
  document.getElementById('move-msg').textContent=
    `📦 ${stu.n}${stu.a||''} 이동 중 — 목적지 셀을 클릭하세요 (${type==='all'?'전체 이동':'원생만'})`;
  buildTable();
  // 소스 셀 하이라이트
  document.querySelectorAll('.stu-clickable').forEach(td=>{
    if(td.dataset.t===t&&td.dataset.day===day&&parseInt(td.dataset.lane)===lane&&parseInt(td.dataset.ri)===row){
      td.classList.add('stu-move-src');
    }
  });
}

function cancelMove(){
  _moveMode=null;
  document.getElementById('move-bar').style.display='none';
  buildTable();
}

// 두 휴원 조각을 합치기 (중복 제거)
function mergeHyuwon(a, b){
  const dates=new Set();
  if(a&&a.dates) a.dates.forEach(d=>dates.add(d));
  if(b&&b.dates) b.dates.forEach(d=>dates.add(d));
  if(!dates.size) return null;
  return {dates:[...dates].sort()};
}

/**
 * 특정 요일의 수업일 중 하나를 선택하는 모달
 * @param {string} day - '월'|'화'|...
 * @param {Function} callback - (selectedDs|null) => void
 * @param {Object=} opts - {title?:string, subtitle?:string}
 */
function askDateForDay(day, callback, opts){
  opts=opts||{};
  const classDates=getClassDatesForDay(day);
  const allDates=[...classDates.cur,...classDates.next].filter(d=>!d.closed);
  if(!allDates.length){
    toast(day+'요일에 수업일이 없습니다','err');
    callback(null);
    return;
  }
  const todayStr=toDateStr(getToday());
  // 모달 생성
  let backdrop=document.getElementById('date-pick-modal');
  if(backdrop) backdrop.remove();
  backdrop=document.createElement('div');
  backdrop.id='date-pick-modal';
  backdrop.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:99998;display:flex;align-items:center;justify-content:center';
  const box=document.createElement('div');
  box.style.cssText='background:#fff;padding:14px;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.2);max-width:320px;width:90%';
  const dayTitle=(typeof getDayIndexes==='function'&&getDayIndexes(day).length>1)?day:(day+'요일');
  const title=opts.title||`📅 ${dayTitle} 날짜 선택`;
  const subtitle=opts.subtitle?`<div style="font-size:11px;color:#6B7280;line-height:1.4;margin:-2px 0 8px">${esc(opts.subtitle)}</div>`:'';
  box.innerHTML=`<div style="font-weight:700;font-size:13px;margin-bottom:8px">${esc(title)}</div>
    ${subtitle}
    <div id="dpm-dates" style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;max-height:300px;overflow-y:auto"></div>
    <div style="margin-top:10px;display:flex;gap:4px">
      <button id="dpm-cancel" class="btn btn-o" style="flex:1;padding:6px;font-size:11px">취소</button>
    </div>`;
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
  const grid=box.querySelector('#dpm-dates');
  allDates.forEach(d=>{
    const btn=document.createElement('button');
    const mo=parseInt(d.ds.slice(5,7)),da=parseInt(d.ds.slice(8,10));
    const isPast=d.ds<todayStr;
    const isToday=d.ds===todayStr;
    btn.textContent=mo+'/'+da;
    btn.className='btn';
    btn.style.cssText=`padding:6px;font-size:11px;border:1px solid ${isToday?'#3B82F6':isPast?'#D1D5DB':'#9CA3AF'};background:${isToday?'#DBEAFE':isPast?'#F3F4F6':'#fff'};color:${isPast?'#9CA3AF':'#111'};font-weight:${isToday?'700':'500'}`;
    btn.onclick=()=>{backdrop.remove();callback(d.ds);};
    grid.appendChild(btn);
  });
  box.querySelector('#dpm-cancel').onclick=()=>{backdrop.remove();callback(null);};
  backdrop.onclick=(e)=>{if(e.target===backdrop){backdrop.remove();callback(null);}};
}

function _moveDisplayTime(day,t){
  if(window.SCScheduleTime&&typeof SCScheduleTime.displayTimeForDay==='function') return SCScheduleTime.displayTimeForDay(day,t);
  const cfg=typeof getTabConfig==='function'?getTabConfig():null;
  const satLabel=cfg&&cfg.satTimeLabel||{};
  return String(day||'')==='토' ? (satLabel[t]||t||'') : (t||'');
}

function _isReserveMoveEntry(entry){
  return !!(entry&&entry.moveType==='reserve'&&entry.moveId&&entry.pairKey);
}

function _reserveMoveDeleteMessage(entry){
  return _isReserveMoveEntry(entry)
    ? '예약 이동을 취소하면 짝으로 연결된 등록/제외 예약도 함께 삭제됩니다. 삭제하시겠습니까?'
    : '삭제하시겠습니까?';
}

function _reservationEntryFromStudent(stu, ds, extra){
  const entry=Object.assign({ds, name:stu?(stu.n||''):''}, extra||{});
  if(stu){
    if(stu.a) entry.age=stu.a;
    if(stu.p) entry.p=stu.p;
    if(stu.v) entry.v=true;
    if(stu.loc) entry.loc=stu.loc;
    if(stu.memo) entry.memo=stu.memo;
    if(stu.g) entry.g=stu.g;
  }
  return entry;
}

function _retireEntryDate(entry){
  return typeof entry==='string'?entry:(entry?.ds||null);
}

function _retireChoiceKind(entry,stu,slotKey){
  if(!entry) return 'move';
  if(entry.retireType==='retire') return 'retire';
  if(entry.excludeReason==='reduce') return 'reduce';
  if(entry.excludeReason==='move'||entry.retireType==='exclude'||_isReserveMoveEntry(entry)) return 'move';
  return _popupRetireIsActual(entry,stu,slotKey)?'retire':'move';
}

function _popupRetireIsActual(entry,stu,slotKey){
  if(!entry) return false;
  if(entry.retireType==='retire') return true;
  if(entry.retireType==='exclude') return false;
  if(entry.moveType) return false;
  const ds=entry.ds||entry;
  const name=String(entry.name||stu?.n||'').trim();
  const phone=String(entry.p||stu?.p||'').replace(/\D/g,'');
  return Array.isArray(RETIRE_HISTORY)&&RETIRE_HISTORY.some(r=>{
    if((r.retiredAt||'')!==ds) return false;
    if(name&&String(r.n||'').trim()!==name) return false;
    const rPhone=String(r.p||'').replace(/\D/g,'');
    if(phone&&rPhone&&phone!==rPhone) return false;
    if(slotKey){
      const rSlot=[r.t,r.d,r.l,r.r].map(v=>String(v||'')).join('/');
      if(rSlot&&rSlot!==slotKey) return false;
    }
    return true;
  });
}

function _popupRetireDateLabel(entry,stu,slotKey){
  const name=entry?.name||stu?.n||'';
  return [name,_popupRetireIsActual(entry,stu,slotKey)?'퇴원':_popupRetireReasonText(entry)].filter(Boolean).join(' ');
}

function _popupRetireReasonText(entry){
  if(!entry||entry.retireType==='retire') return '';
  if(entry.excludeReason==='reduce') return '횟수줄임';
  if(entry.excludeReason==='move'||_isReserveMoveEntry(entry)) return '이동';
  return '까지';
}

function _retireHistoryMatches(r,stu,ds,slotKey){
  if(!r||(r.retiredAt||'')!==ds) return false;
  const name=String(stu?.n||'').trim();
  if(name&&String(r.n||'').trim()!==name) return false;
  const phone=String(stu?.p||'').replace(/\D/g,'');
  const rPhone=String(r.p||'').replace(/\D/g,'');
  if(phone&&rPhone&&phone!==rPhone) return false;
  if(slotKey){
    const rSlot=[r.t,r.d,r.l,r.r].map(v=>String(v||'')).join('/');
    if(rSlot&&rSlot!==slotKey) return false;
  }
  return true;
}

function _hasMatchingRetireHistory(stu,ds,slotKey){
  return Array.isArray(RETIRE_HISTORY)&&RETIRE_HISTORY.some(r=>_retireHistoryMatches(r,stu,ds,slotKey));
}

function _removeMatchingRetireHistory(stu,ds,slotKey){
  if(!Array.isArray(RETIRE_HISTORY)) return false;
  const before=RETIRE_HISTORY.length;
  RETIRE_HISTORY=RETIRE_HISTORY.filter(r=>!_retireHistoryMatches(r,stu,ds,slotKey));
  if(RETIRE_HISTORY.length!==before){
    if(typeof saveRetireHistory==='function') saveRetireHistory();
    return true;
  }
  return false;
}

function _reserveMoveAtSlot(slotKey,retire,enroll){
  const r=retire||RETIRE_MAP||{};
  const e=enroll||ENROLL_MAP||{};
  return _isReserveMoveEntry(r[slotKey])||_isReserveMoveEntry(e[slotKey]);
}

function _isReserveMoveLockedMoveType(type){
  return type==='all'||type==='stu'||type==='swap'||type==='reserve'||type==='enroll';
}

function _reserveMoveLockedMessage(){
  return '예약 이동이 걸린 칸입니다. 먼저 예약 이동을 취소한 뒤 다시 이동해주세요.';
}

function _blockReserveMoveLockedSlot(type,slotKey){
  if(!_isReserveMoveLockedMoveType(type)) return false;
  if(!_reserveMoveAtSlot(slotKey)) return false;
  toast(_reserveMoveLockedMessage(),'err');
  return true;
}

function _deleteReserveMovePair(retire,enroll,kind,slotKey){
  const entry=kind==='retire'?retire[slotKey]:enroll[slotKey];
  if(kind==='retire') delete retire[slotKey];
  else delete enroll[slotKey];
  if(!_isReserveMoveEntry(entry)) return false;

  const pairMap=kind==='retire'?enroll:retire;
  const pair=pairMap[entry.pairKey];
  if(pair&&pair.moveId===entry.moveId){
    delete pairMap[entry.pairKey];
    return true;
  }
  return false;
}

async function deleteRetireReservation(slotKey){
  let paired=false;
  await updateScheduleTx([STORAGE_KEYS.RETIRE,STORAGE_KEYS.ENROLL], ctx=>{
    const retire=ctx.get(STORAGE_KEYS.RETIRE,{});
    const enroll=ctx.get(STORAGE_KEYS.ENROLL,{});
    if(!retire[slotKey]){ctx.abort('제외 예약이 이미 없습니다');return;}
    paired=_deleteReserveMovePair(retire,enroll,'retire',slotKey);
    ctx.set(STORAGE_KEYS.RETIRE,retire);
    if(paired) ctx.set(STORAGE_KEYS.ENROLL,enroll);
    return true;
  });
  return paired;
}

async function deleteEnrollReservation(slotKey){
  let paired=false;
  await updateScheduleTx([STORAGE_KEYS.RETIRE,STORAGE_KEYS.ENROLL], ctx=>{
    const retire=ctx.get(STORAGE_KEYS.RETIRE,{});
    const enroll=ctx.get(STORAGE_KEYS.ENROLL,{});
    if(!enroll[slotKey]){ctx.abort('등록 예약이 이미 없습니다');return;}
    paired=_deleteReserveMovePair(retire,enroll,'enroll',slotKey);
    if(paired) ctx.set(STORAGE_KEYS.RETIRE,retire);
    ctx.set(STORAGE_KEYS.ENROLL,enroll);
    return true;
  });
  return paired;
}

function _slotParts(slotKey){
  const [t,d,l,r]=slotKey.split('/');
  return {t,d,l:parseInt(l),r:parseInt(r)};
}
function _findStudentIndexAt(students,slotKey){
  const p=_slotParts(slotKey);
  return students.findIndex(s=>s.t===p.t&&s.d===p.d&&parseInt(s.l)===p.l&&parseInt(s.r)===p.r);
}
function _studentForSlot(stu,t,d,l,r){
  const next={...stu,t,d,l:parseInt(l),r:parseInt(r)};
  delete next.movedUntil;
  return next;
}
function _swapMapKey(map,srcKey,dstKey){
  const src=map[srcKey], dst=map[dstKey];
  if(dst) map[srcKey]=dst; else delete map[srcKey];
  if(src) map[dstKey]=src; else delete map[dstKey];
}
function _swapFutureMarks(marks,srcKey,dstKey,todayStr){
  const srcMarks={}, dstMarks={};
  for(const key of Object.keys(marks)){
    if(key.startsWith(srcKey+'/')){
      const ds=key.slice(srcKey.length+1);
      if(ds>=todayStr){srcMarks[key.slice(srcKey.length)]=marks[key];delete marks[key];}
    } else if(key.startsWith(dstKey+'/')){
      const ds=key.slice(dstKey.length+1);
      if(ds>=todayStr){dstMarks[key.slice(dstKey.length)]=marks[key];delete marks[key];}
    }
  }
  for(const suf of Object.keys(srcMarks)) marks[dstKey+suf]=srcMarks[suf];
  for(const suf of Object.keys(dstMarks)) marks[srcKey+suf]=dstMarks[suf];
}
function _moveFutureMarks(marks,srcKey,dstKey,todayStr){
  for(const key of Object.keys(marks)){
    if(!key.startsWith(srcKey+'/')) continue;
    const ds=key.slice(srcKey.length+1);
    if(ds<todayStr) continue;
    marks[dstKey+'/'+ds]=marks[key];
    delete marks[key];
  }
}
function _splitHyuwonByDate(hyuwon,todayStr){
  if(!hyuwon||!hyuwon.dates) return {past:null,future:null};
  const past=hyuwon.dates.filter(d=>d<todayStr);
  const future=hyuwon.dates.filter(d=>d>=todayStr);
  return {
    past:past.length?{dates:past}:null,
    future:future.length?{dates:future}:null,
  };
}
function _swapFutureHyuwon(map,srcKey,dstKey,todayStr){
  const src=_splitHyuwonByDate(map[srcKey],todayStr);
  const dst=_splitHyuwonByDate(map[dstKey],todayStr);
  const nextSrc=mergeHyuwon(src.past,dst.future);
  const nextDst=mergeHyuwon(dst.past,src.future);
  if(nextSrc) map[srcKey]=nextSrc; else delete map[srcKey];
  if(nextDst) map[dstKey]=nextDst; else delete map[dstKey];
}
function _moveFutureHyuwon(map,srcKey,dstKey,todayStr){
  const src=map[srcKey];
  if(!src) return;
  if(src.dates){
    const past=src.dates.filter(d=>d<todayStr);
    const future=src.dates.filter(d=>d>=todayStr);
    if(future.length) map[dstKey]=mergeHyuwon(map[dstKey],{dates:future});
    if(past.length) map[srcKey]={dates:past};
    else delete map[srcKey];
  } else {
    map[dstKey]=src;
    delete map[srcKey];
  }
}
function _requestSourceDate(req){
  const p=req?.parent||{};
  return p.absentDs || req?.sourceDs || req?.target?.ds || '';
}
function _isActiveRequestStatus(status){
  return !status || status==='pending' || status==='processing' || status==='accepted';
}
function _isActiveFutureRequestForSlot(req,slotKey,todayStr){
  if(!req || req.parent?.studentSlotKey!==slotKey) return false;
  if(!_isActiveRequestStatus(req.status)) return false;
  const ds=_requestSourceDate(req);
  return !ds || ds>=todayStr;
}
function _slotInstSnapshot(instMap,slotKey){
  const [t,d,l]=String(slotKey||'').split('/');
  const instKey=t&&d&&l ? t+'/'+d+'/'+l : '';
  const inst=instKey ? instMap[instKey] : null;
  return {
    instKey,
    inst,
    instName: inst?.n || '',
    classLabel: typeof instClassText==='function' ? instClassText(inst) : '',
  };
}
function _rememberOriginalRequestSlot(parent,slotKey){
  if(!parent) return;
  if(!parent.originalSlotKey) parent.originalSlotKey=slotKey;
  parent.previousSlotKey=slotKey;
  parent.slotUpdatedAt=new Date().toISOString();
}
function _rewriteRequestSourceSlot(req,oldKey,newKey,instMap){
  if(!req || req.parent?.studentSlotKey!==oldKey) return false;
  const parent=req.parent || (req.parent={});
  _rememberOriginalRequestSlot(parent,oldKey);
  parent.studentSlotKey=newKey;
  const snap=_slotInstSnapshot(instMap,newKey);
  if(req.type==='bogang' || req.type==='bogang-cancel'){
    parent.sourceInstKey=snap.instKey;
    parent.sourceInstName=snap.instName;
    parent.sourceClassLabel=snap.classLabel;
  } else if(req.type==='absent-cancel'){
    const [t,d,l,r]=newKey.split('/');
    req.target=Object.assign({},req.target||{},{
      t,d,l:parseInt(l,10),r:parseInt(r,10),
      instName:snap.instName,
      classLabel:snap.classLabel,
    });
    req.instKey=snap.instKey;
  }
  return true;
}
function _moveActiveFutureRequests(requests,srcKey,dstKey,todayStr,instMap){
  let moved=0;
  Object.values(requests||{}).forEach(req=>{
    if(!_isActiveFutureRequestForSlot(req,srcKey,todayStr)) return;
    if(_rewriteRequestSourceSlot(req,srcKey,dstKey,instMap)) moved++;
  });
  return moved;
}
function _swapActiveFutureRequests(requests,srcKey,dstKey,todayStr,instMap){
  let changed=0;
  Object.values(requests||{}).forEach(req=>{
    if(_isActiveFutureRequestForSlot(req,srcKey,todayStr)){
      if(_rewriteRequestSourceSlot(req,srcKey,dstKey,instMap)) changed++;
    } else if(_isActiveFutureRequestForSlot(req,dstKey,todayStr)){
      if(_rewriteRequestSourceSlot(req,dstKey,srcKey,instMap)) changed++;
    }
  });
  return changed;
}
function _hasActiveFutureRequest(requests,slotKey,todayStr){
  return Object.values(requests||{}).some(req=>_isActiveFutureRequestForSlot(req,slotKey,todayStr));
}
function _finishMove(msg){
  _moveMode=null;
  document.getElementById('move-bar').style.display='none';
  buildTable();
  toast(msg,'ok');
}

async function executeMove(dstT,dstDay,dstLane,dstRow){
  if(!_moveMode) return;
  const {srcKey, type}=_moveMode;
  const dstKey=dstT+'/'+dstDay+'/'+dstLane+'/'+dstRow;

  // 같은 자리면 취소
  if(srcKey===dstKey){cancelMove();return;}

  // 자리바꾸기 (빈 셀 + 뱃지만 있는 경우도 허용)
  if(type==='swap'){
    const {stu:srcStu}=_moveMode;
    const dstStu=getStu(dstT,dstDay,dstLane,dstRow);
    const [sT,sD,sL,sR]=srcKey.split('/');
    const sLi=parseInt(sL),sRi=parseInt(sR);
    try{
      const stuKey=getTabConfig().stuKey;
      const instKey=getTabConfig().instKey;
      await updateScheduleTx([stuKey,instKey,STORAGE_KEYS.DISABLED,STORAGE_KEYS.RETIRE,STORAGE_KEYS.ENROLL,STORAGE_KEYS.MARK,STORAGE_KEYS.休원,STORAGE_KEYS.REQUESTS], ctx=>{
        const students=ctx.get(stuKey,[]);
        const instMap=ctx.get(instKey,{});
        const srcIdx=_findStudentIndexAt(students,srcKey);
        if(srcIdx<0){ctx.abort('소스 학생 정보 오류');return;}
        const dstIdx=_findStudentIndexAt(students,dstKey);
        if(dstStu && dstIdx<0){ctx.abort('목적지 학생이 다른 기기에서 변경되었습니다');return;}
        if(!dstStu && dstIdx>=0){ctx.abort('목적지에 이미 학생이 있습니다');return;}
        const remoteSrc=students[srcIdx];
        if(dstIdx>=0){
          const remoteDst=students[dstIdx];
          students[srcIdx]=_studentForSlot(remoteDst,sT,sD,sLi,sRi);
          students[dstIdx]=_studentForSlot(remoteSrc,dstT,dstDay,dstLane,dstRow);
        } else {
          students[srcIdx]=_studentForSlot(remoteSrc,dstT,dstDay,dstLane,dstRow);
        }
        ctx.set(stuKey,students);

        const disabled=ctx.get(STORAGE_KEYS.DISABLED,{});
        if(dstIdx<0) delete disabled[dstKey];
        ctx.set(STORAGE_KEYS.DISABLED,disabled);

        const retire=ctx.get(STORAGE_KEYS.RETIRE,{});
        const enroll=ctx.get(STORAGE_KEYS.ENROLL,{});
        if(_reserveMoveAtSlot(srcKey,retire,enroll)||_reserveMoveAtSlot(dstKey,retire,enroll)){
          ctx.abort(_reserveMoveLockedMessage());
          return;
        }
        _swapMapKey(retire,srcKey,dstKey);
        ctx.set(STORAGE_KEYS.RETIRE,retire);

        _swapMapKey(enroll,srcKey,dstKey);
        ctx.set(STORAGE_KEYS.ENROLL,enroll);

        const todayStr=toDateStr(getToday());
        const marks=ctx.get(STORAGE_KEYS.MARK,{});
        _swapFutureMarks(marks,srcKey,dstKey,todayStr);
        ctx.set(STORAGE_KEYS.MARK,marks);

        const hyuwon=ctx.get(STORAGE_KEYS.休원,{});
        _swapFutureHyuwon(hyuwon,srcKey,dstKey,todayStr);
        ctx.set(STORAGE_KEYS.休원,hyuwon);

        const requests=ctx.get(STORAGE_KEYS.REQUESTS,{});
        if(_swapActiveFutureRequests(requests,srcKey,dstKey,todayStr,instMap)){
          ctx.set(STORAGE_KEYS.REQUESTS,requests);
        }
        return true;
      }, {type:'move', label:'자리바꾸기', detail:`${srcKey} → ${dstKey}`});
      const srcLabel=srcStu.n+(srcStu.a||'');
      const dstLabel=dstStu?dstStu.n+(dstStu.a||''):'빈 셀';
      _finishMove(`${srcLabel} ↔ ${dstLabel} 자리바꾸기 완료`);
    }catch(err){
      toast(err?.message||'자리바꾸기 실패','err');
      console.error(err);
    }
    return;
  }

  // 보강/샘플 마크 이동
  if(type==='mark'){
    const {markData, markType, srcDs}=_moveMode;
    const [sT,sD,sL,sR]=srcKey.split('/');
    const moveMarkTo=async(newDs)=>{
      const stuKey=getTabConfig().stuKey;
      await updateScheduleTx([stuKey,STORAGE_KEYS.MARK], ctx=>{
        const students=ctx.get(stuKey,[]);
        if(_findStudentIndexAt(students,dstKey)>=0){ctx.abort('빈 셀에만 이동 가능합니다');return;}
        const marks=ctx.get(STORAGE_KEYS.MARK,{});
        const srcMark=marks[srcKey+'/'+srcDs];
        if(!srcMark){ctx.abort('원본 마크가 이미 변경되었습니다');return;}
        if(marks[dstKey+'/'+newDs]){ctx.abort('목적지에 같은 날짜 마크가 있습니다');return;}
        if(srcMark?.type==='absent'&&srcMark.sub){
          const nextSrc={...srcMark};
          delete nextSrc.sub;
          marks[srcKey+'/'+srcDs]=nextSrc;
        } else {
          delete marks[srcKey+'/'+srcDs];
        }
        marks[dstKey+'/'+newDs]=markData;
        ctx.set(STORAGE_KEYS.MARK,marks);
        return true;
      }, {type:'move', label:(markType==='bogang'?'보강 이동':'샘플 이동'), detail:`${srcKey}/${srcDs} → ${dstKey}/${newDs}`});
    };
    // 요일이 다르면 날짜 선택 모달
    if(sD!==dstDay){
      askDateForDay(dstDay, async function(newDs){
        if(!newDs) return; // 취소
        try{
          await moveMarkTo(newDs);
          _finishMove((markType==='bogang'?'보강':'샘플')+' 이동 완료 ('+newDs.slice(5)+')');
        }catch(err){
          toast(err?.message||'마크 이동 실패','err');
          console.error(err);
        }
      });
      return;
    }
    // 같은 요일 → 같은 날짜 유지
    try{
      await moveMarkTo(srcDs);
      _finishMove((markType==='bogang'?'보강':'샘플')+' 이동 완료');
    }catch(err){
      toast(err?.message||'마크 이동 실패','err');
      console.error(err);
    }
    return;
  }

  // 등록 예약 이동
  if(type==='enroll'){
    const {enrData}=_moveMode;
    const [sT,sD,sL,sR]=srcKey.split('/');
    const moveEnrollTo=async(newDs)=>{
      const stuKey=getTabConfig().stuKey;
      await updateScheduleTx([stuKey,STORAGE_KEYS.ENROLL,STORAGE_KEYS.RETIRE], ctx=>{
        const students=ctx.get(stuKey,[]);
        const enroll=ctx.get(STORAGE_KEYS.ENROLL,{});
        const retire=ctx.get(STORAGE_KEYS.RETIRE,{});
        if(_findStudentIndexAt(students,dstKey)>=0){ctx.abort('빈 셀에만 이동 가능합니다');return;}
        if(enroll[dstKey]){ctx.abort('목적지에 이미 등록 예약이 있습니다');return;}
        if(retire[dstKey]){ctx.abort('목적지에 제외 예약이 있습니다');return;}
        const srcEnroll=enroll[srcKey];
        if(!srcEnroll){ctx.abort('원본 등록 예약이 이미 변경되었습니다');return;}
        if(_isReserveMoveEntry(srcEnroll)){ctx.abort(_reserveMoveLockedMessage());return;}
        delete enroll[srcKey];
        enroll[dstKey]={...srcEnroll, ...enrData, ds:newDs};
        ctx.set(STORAGE_KEYS.ENROLL,enroll);
        return true;
      }, {type:'move', label:'등록 예약 이동', detail:`${srcKey} → ${dstKey}`});
    };
    // 요일이 다르면 날짜 선택
    if(sD!==dstDay){
      askDateForDay(dstDay, async function(newDs){
        if(!newDs) return;
        try{
          await moveEnrollTo(newDs);
          _finishMove('등록 예약 '+(enrData.name||'')+' 이동 완료 ('+newDs.slice(5)+')');
        }catch(err){
          toast(err?.message||'등록 예약 이동 실패','err');
          console.error(err);
        }
      });
      return;
    }
    try{
      await moveEnrollTo(enrData.ds);
      _finishMove('등록 예약 '+(enrData.name||'')+' 이동 완료');
    }catch(err){
      toast(err?.message||'등록 예약 이동 실패','err');
      console.error(err);
    }
    return;
  }

  // 예약 이동 (전체) → RETIRE(출발) + ENROLL(도착) 조합
  if(type==='reserve'){
    const {stu}=_moveMode;
    const [srcT,srcDay]=srcKey.split('/');
    const srcTime=_moveDisplayTime(srcDay,srcT);
    const dstTime=_moveDisplayTime(dstDay,dstT);
    askDateForDay(srcDay, function(sourceDs){
      if(!sourceDs){return;}
      askDateForDay(dstDay, async function(newDs){
        if(!newDs){return;}
        const moveId='reserve-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
        const enrollEntry={
          ds:newDs,
          name:stu.n,
          age:stu.a||null,
          moveType:'reserve',
          moveId,
          pairKey:srcKey,
        };
        if(stu.p) enrollEntry.p=stu.p;
        if(stu.v) enrollEntry.v=true;
        if(stu.loc) enrollEntry.loc=stu.loc;
        if(stu.memo) enrollEntry.memo=stu.memo;
        if(stu.g) enrollEntry.g=stu.g;
        try{
          const stuKey=getTabConfig().stuKey;
          await updateScheduleTx([stuKey,STORAGE_KEYS.RETIRE,STORAGE_KEYS.ENROLL], ctx=>{
            const students=ctx.get(stuKey,[]);
            const retire=ctx.get(STORAGE_KEYS.RETIRE,{});
            const enroll=ctx.get(STORAGE_KEYS.ENROLL,{});
            if(_findStudentIndexAt(students,dstKey)>=0){ctx.abort('빈 셀에만 예약 가능합니다');return;}
            if(retire[dstKey]||enroll[dstKey]){ctx.abort('목적지에 기존 예약이 있습니다');return;}
            if(_reserveMoveAtSlot(srcKey,retire,enroll)){ctx.abort(_reserveMoveLockedMessage());return;}
            if(retire[srcKey]){ctx.abort('출발지에 이미 제외 예약이 있습니다');return;}
            retire[srcKey]=_reservationEntryFromStudent(stu,sourceDs,{retireType:'exclude', excludeReason:'move', moveType:'reserve', moveId, pairKey:dstKey});
            enroll[dstKey]=enrollEntry;
            ctx.set(STORAGE_KEYS.RETIRE,retire);
            ctx.set(STORAGE_KEYS.ENROLL,enroll);
            return true;
          }, {type:'move', label:'예약 이동', detail:`${srcKey} → ${dstKey} (${sourceDs} / ${newDs})`});
          const label=newDs.slice(5).replace('-','/');
          const sourceLabel=sourceDs.slice(5).replace('-','/');
          _finishMove(stu.n+(stu.a||'')+' 예약 이동 (삭제 '+sourceLabel+' / 등록 '+label+')');
        }catch(err){
          toast(err?.message||'예약 이동 실패','err');
          console.error(err);
        }
      }, {
        title:`📘 등록일 선택 (${dstDay}요일 ${dstTime})`,
        subtitle:'새 자리에서 시작할 날짜를 선택해주세요.'
      });
    }, {
      title:`🗑️ 삭제일 선택 (${srcDay}요일 ${srcTime})`,
      subtitle:'기존 자리에서 빠질 날짜를 먼저 선택해주세요.'
    });
    return;
  }

  // 원생 복사
  if(type==='copy'){
    const {stu}=_moveMode;
    // 신규 학생 객체: 위치만 변경, isNew/movedUntil/enrolled 등 메타는 제외
    const newStu={n:stu.n,a:stu.a,t:dstT,d:dstDay,l:dstLane,r:dstRow};
    if(stu.p) newStu.p=stu.p;
    if(stu.v) newStu.v=true;
    if(stu.g) newStu.g=stu.g;
    if(stu.loc) newStu.loc=stu.loc;
    if(stu.memo) newStu.memo=stu.memo;
    try{
      const stuKey=getTabConfig().stuKey;
      await updateScheduleTx([stuKey,STORAGE_KEYS.DISABLED], ctx=>{
        const students=ctx.get(stuKey,[]);
        if(_findStudentIndexAt(students,dstKey)>=0){ctx.abort('빈 셀에만 복사 가능합니다');return;}
        students.push(newStu);
        ctx.set(stuKey,students);
        const disabled=ctx.get(STORAGE_KEYS.DISABLED,{});
        delete disabled[dstKey];
        ctx.set(STORAGE_KEYS.DISABLED,disabled);
        return true;
      }, {type:'edit', label:'원생 복사', detail:`${srcKey} → ${dstKey}`});
      _finishMove(stu.n+(stu.a||'')+' 복사 완료');
    }catch(err){
      toast(err?.message||'복사 실패','err');
      console.error(err);
    }
    return;
  }

  const {stu}=_moveMode;
  const [sT,sD,sL,sR]=srcKey.split('/');

  try{
    let movedName=stu.n;
    const stuKey=getTabConfig().stuKey;
    const instKey=getTabConfig().instKey;
    await updateScheduleTx([stuKey,instKey,STORAGE_KEYS.RETIRE,STORAGE_KEYS.ENROLL,STORAGE_KEYS.MARK,STORAGE_KEYS.休원,STORAGE_KEYS.DISABLED,STORAGE_KEYS.REQUESTS], ctx=>{
      const students=ctx.get(stuKey,[]);
      if(_findStudentIndexAt(students,dstKey)>=0){ctx.abort('목적지에 이미 학생이 있습니다');return;}

      const todayStr=toDateStr(getToday());
      const retire=ctx.get(STORAGE_KEYS.RETIRE,{});
      const enroll=ctx.get(STORAGE_KEYS.ENROLL,{});
      const marks=ctx.get(STORAGE_KEYS.MARK,{});
      const hyuwon=ctx.get(STORAGE_KEYS.休원,{});
      const requests=ctx.get(STORAGE_KEYS.REQUESTS,{});
      const instMap=ctx.get(instKey,{});
      if(_isReserveMoveLockedMoveType(type)&&(_reserveMoveAtSlot(srcKey,retire,enroll)||_reserveMoveAtSlot(dstKey,retire,enroll))){
        ctx.abort(_reserveMoveLockedMessage());
        return;
      }

      if(type==='all'){
        const hasFutureMark=Object.keys(marks).some(k=>{
          if(!k.startsWith(dstKey+'/')) return false;
          const ds=k.slice(dstKey.length+1);
          return ds>=todayStr;
        });
        const hasFutureHyuwon=hyuwon[dstKey]?.dates?.some(d=>d>=todayStr);
        if(retire[dstKey]||enroll[dstKey]||hasFutureMark||hasFutureHyuwon){
          ctx.abort('목적지에 기존 미래 예약/마크가 있습니다');
          return;
        }
      }
      if(type!=='all' && _hasActiveFutureRequest(requests,srcKey,todayStr)){
        ctx.abort('학부모 요청이 있는 원생은 전체 이동으로 처리해주세요');
        return;
      }
      if(type==='all' && _hasActiveFutureRequest(requests,dstKey,todayStr)){
        ctx.abort('목적지에 연결된 학부모 요청이 있어 이동할 수 없습니다');
        return;
      }

      const sIdx=_findStudentIndexAt(students,srcKey);
      if(sIdx<0){ctx.abort('소스 학생 정보 오류');return;}
      const remoteStu=students[sIdx];
      movedName=remoteStu.n||stu.n;
      students.splice(sIdx,1);
      students.push(_studentForSlot(remoteStu,dstT,dstDay,dstLane,dstRow));
      ctx.set(stuKey,students);

      const disabled=ctx.get(STORAGE_KEYS.DISABLED,{});
      delete disabled[dstKey];
      ctx.set(STORAGE_KEYS.DISABLED,disabled);

      if(type==='all'){
        if(retire[srcKey]){retire[dstKey]=retire[srcKey];delete retire[srcKey];}
        if(enroll[srcKey]){enroll[dstKey]=enroll[srcKey];delete enroll[srcKey];}
        _moveFutureMarks(marks,srcKey,dstKey,todayStr);
        _moveFutureHyuwon(hyuwon,srcKey,dstKey,todayStr);
        _moveActiveFutureRequests(requests,srcKey,dstKey,todayStr,instMap);
        ctx.set(STORAGE_KEYS.RETIRE,retire);
        ctx.set(STORAGE_KEYS.ENROLL,enroll);
        ctx.set(STORAGE_KEYS.MARK,marks);
        ctx.set(STORAGE_KEYS.休원,hyuwon);
        ctx.set(STORAGE_KEYS.REQUESTS,requests);
      }
      return true;
    }, {type:'move', label:type==='all'?'전체 이동':'원생 이동', detail:`${srcKey} → ${dstKey}`});
    _finishMove(movedName+' 이동 완료');
  }catch(err){
    toast(err?.message||'이동 실패','err');
    console.error(err);
  }
}

document.addEventListener('click',e=>{
  if(_stuBusy) return;
  if(Date.now()-_tabFocusTime<300) return;
  const popup=document.getElementById('stu-popup');
  if(!popup.classList.contains('show')) return;
  if(popup.contains(e.target)) return;
  if(e.target.closest('.stu-clickable')) return;
  // [v95 #7] mousedown이 팝업 안에서 시작됐으면 닫지 않음 (드래그-아웃 보호)
  if(_mouseDownTarget && popup.contains(_mouseDownTarget)) return;
  closeStuPopup();
});
