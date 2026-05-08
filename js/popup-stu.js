/* ════════════════════════════════════════════════════════════════
 * SECTION: 학생 셀 팝업 (renderStuPopup ~200줄, 분할 대상)
 * ════════════════════════════════════════════════════════════════ */
let _stuPopup={key:null,td:null,t:null,day:null,lane:null,row:null,selDate:null,showEnroll:false,showBogang:false,showSample:false,showHyuwon:false};
let _stuBusy=false;
// _tabFocusTime → data.js (cross-file shared state)

function openStuPopup(td,t,day,lane,row){
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
function buildBogangFormHtml(existBo){
  const boOn = !!existBo;
  return `<div style="padding:6px 0;border-top:1px solid #E5E7EB;margin-top:4px">
    <div style="display:flex;gap:4px;margin-bottom:4px">
      <input class="fi" id="sp-bogang-name" placeholder="이름" value="${existBo?esc(existBo.n||''):''}" style="flex:1;margin:0;padding:4px 6px;font-size:11px">
      <input class="fi" id="sp-bogang-age" type="number" placeholder="나이" value="${existBo&&existBo.a?existBo.a:''}" style="width:55px;margin:0;padding:4px 6px;font-size:11px">
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
      <div class="sp-vt-col veh-col ${e.v?'on':''}" id="sp-enroll-vehicle">
        <span class="sp-vt-label">차량</span>
        <span class="sp-vt-toggle"></span>
      </div>
      <div class="sp-vt-col new-col ${e.isNew?'on':''}" id="sp-enroll-new">
        <span class="sp-vt-label">신규</span>
        <span class="sp-vt-toggle"></span>
      </div>
      <button type="button" class="sp-chip male ${e.g==='m'?'on':''}" id="sp-enroll-gender-m">남</button>
      <button type="button" class="sp-chip female ${e.g==='f'?'on':''}" id="sp-enroll-gender-f">여</button>
    </div>
    <textarea class="fi" id="sp-enroll-loc" placeholder="승하차 장소" style="margin:0 0 4px;padding:4px 6px;font-size:11px;min-height:28px">${e.loc?esc(e.loc):''}</textarea>
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

  // 폼 선택: 보강/샘플/등록/휴원 중 하나만 표시
  let formHtml='';
  if(_stuPopup.showBogang){
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
      <button class="btn" id="sp-retire-set"       style="${btnStyle(isRetire,'#333')}">제외</button>
      <button class="btn" id="sp-enroll-show"      style="${enrollBtnStyle}"${enrollLocked?' title="제외 예약 후 등록 가능"':''}>등록</button>
      <button class="btn" id="sp-hyuwon-show"      style="${btnStyle(hyOn,'#0EA5E9')}">${hyOn?'휴원중':'휴원'}</button>
    </div>
    ${formHtml}
  </div>`;
}

/**
 * 학생 팝업 좌측 컬럼: 이름/나이/전화/차량/성별/신규/메모/저장·삭제·이동 버튼
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
      <div class="sp-vt-col veh-col ${stu&&stu.v?'on':''}" id="sp-vehicle">
        <span class="sp-vt-label">차량</span>
        <span class="sp-vt-toggle"></span>
      </div>
      <div class="sp-vt-col new-col ${stu&&stu.isNew&&stu.isNew===curMonth?'on':''}" id="sp-new">
        <span class="sp-vt-label">신규</span>
        <span class="sp-vt-toggle"></span>
      </div>
      <button type="button" class="sp-chip male ${stu&&stu.g==='m'?'on':''}" id="sp-gender-m">남</button>
      <button type="button" class="sp-chip female ${stu&&stu.g==='f'?'on':''}" id="sp-gender-f">여</button>
    </div>
    <div style="margin-bottom:4px">
      <label class="fl">승하차 장소</label>
      <textarea class="fi" id="sp-loc" placeholder="예) 가경초 정문" style="margin-top:2px">${stu&&stu.loc?esc(stu.loc):''}</textarea>
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
 * 학생 팝업 우측 컬럼: 날짜 그리드 + 액션 패널 (방특반에선 숨김)
 */
function buildStuPopupRight(slotKey, selDate, classDates, curPeriod, nextPeriod, retireDate, retireName, enrollDate, enrollName, actionHtml){
  if(isBangteuk()) return '';
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
  return {
    name: name.value,
    age: get('sp-age')?.value || '',
    phone: get('sp-phone')?.value || '',
    loc: get('sp-loc')?.value || '',
    memo: get('sp-memo')?.value || '',
    vehicle: get('sp-vehicle')?.classList.contains('on') || false,
    gender: get('sp-gender-m')?.classList.contains('on') ? 'm'
          : get('sp-gender-f')?.classList.contains('on') ? 'f' : null,
    isNew: get('sp-new')?.classList.contains('on') || false,
  };
}
function restoreStuFormDraft(d){
  if(!d) return;
  const get = id => document.getElementById(id);
  const setVal = (id,v) => { const el=get(id); if(el && v!=null) el.value=v; };
  setVal('sp-name', d.name);
  setVal('sp-age',  d.age);
  setVal('sp-phone',d.phone);
  setVal('sp-loc',  d.loc);
  setVal('sp-memo', d.memo);
  if(d.vehicle) get('sp-vehicle')?.classList.add('on');
  if(d.gender==='m') get('sp-gender-m')?.classList.add('on');
  if(d.gender==='f') get('sp-gender-f')?.classList.add('on');
  if(d.isNew) get('sp-new')?.classList.add('on');
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
  const retireDate=retireEntry?.ds||null;
  const retireName=retireEntry?.name||'';
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

function handleVehicleToggle(e, ctx){
  const btn=e.target.closest('#sp-vehicle');
  if(!btn) return;
  btn.classList.toggle('on');
  // [v95 #3] 승하차 장소는 항상 입력 가능. 차량 토글은 데이터만 변경.
}

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
  if(btn) btn.classList.toggle('on');
}

function handleMoveAll(e, ctx){ startMove('all'); }
function handleMoveStu(e, ctx){ startMove('stu'); }
function handleCopyStu(e, ctx){ startMove('copy'); }
function handleEnrollMove(e, ctx){ startMove('enroll'); }
function handleMoveReserve(e, ctx){ startMove('reserve'); }
function handleSwap(e, ctx){ startMove('swap'); }

function handleDisable(e, ctx){
  const wasDis=isDisabled(ctx.slotKey);
  if(wasDis) delete DISABLED_MAP[ctx.slotKey];
  else DISABLED_MAP[ctx.slotKey]=true;
  saveDisabled();
  closeStuPopup();
  buildTable();
  toast(wasDis?'활성화 완료':'비활성화 완료','ok');
}

/* ── 저장/삭제/날짜박스 핸들러 ── */

function handleSave(e, ctx){
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
  const vehicle=document.getElementById('sp-vehicle')?.classList.contains('on')||false;
  const isNewCheck=document.getElementById('sp-new')?.classList.contains('on')||false;
  const gender=document.getElementById('sp-gender-m')?.classList.contains('on')?'m'
    :(document.getElementById('sp-gender-f')?.classList.contains('on')?'f':null);
  const loc=document.getElementById('sp-loc')?.value.trim()||'';
  const memo=document.getElementById('sp-memo')?.value.trim()||'';

  // 기존 데이터 제거
  const oldStu=getStu(t,day,lane,row);
  const idx=STUDENTS.findIndex(s=>s.t===t&&s.d===day&&s.l===lane&&s.r===row);
  if(idx>=0) STUDENTS.splice(idx,1);

  if(name){
    const obj={n:name,a:age,t,d:day,l:lane,r:row};
    if(phone) obj.p=phone;
    if(vehicle) obj.v=true;
    if(gender) obj.g=gender;
    if(isNewCheck) obj.isNew=oldStu&&oldStu.isNew?oldStu.isNew:SCHEDULE_PERIODS[getCurrentPeriod()].month;
    if(loc) obj.loc=loc;
    if(memo) obj.memo=memo;
    STUDENTS.push(obj);
    _stuIdx[key]=obj;
    // 비활성화 해제
    if(DISABLED_MAP[key]){delete DISABLED_MAP[key];saveDisabled();}
  } else {
    delete _stuIdx[key];
  }

  saveStudents();
  rebuildStuIdx();
  _flashKey=key;
  closeStuPopup();
  buildTable();
  toast(name?name+' 저장':'삭제 완료','ok');
}

function handleDelete(e, ctx){
  const {t, day, lane, row, key} = ctx;
  const idx=STUDENTS.findIndex(s=>s.t===t&&s.d===day&&s.l===lane&&s.r===row);
  if(idx>=0) STUDENTS.splice(idx,1);
  delete _stuIdx[key];
  saveStudents();
  _flashKey=key;
  closeStuPopup();
  buildTable();
  toast('학생 삭제','ok');
}

/**
 * 날짜 박스 클릭: 4가지 분기
 * 1) 제외일 클릭 → 제외 해제
 * 2) 등록일 클릭 → 등록 해제
 * 3) 같은 날짜 재클릭 → 선택 해제
 * 4) 새 날짜 → 선택 + 기존 마크 있으면 해당 폼 자동 열기
 */
function handleDateBoxClick(dateBox, ctx){
  const {slotKey} = ctx;
  const ds=dateBox.dataset.ds;

  // 0) 휴원 모드면 날짜 토글
  if(_stuPopup.showHyuwon){
    let hyuwon=HYUWON_MAP[slotKey];
    if(!hyuwon) hyuwon={dates:[]};
    // 구 형식(from/to) → 신 형식(dates) 변환
    if(hyuwon.from&&!hyuwon.dates){hyuwon={dates:[]};}
    const idx=hyuwon.dates.indexOf(ds);
    if(idx>=0){
      hyuwon.dates.splice(idx,1);
    } else {
      if(hyuwon.dates.length>=14){toast('최대 14일까지 선택 가능','err');renderStuPopup();return;}
      hyuwon.dates.push(ds);
    }
    if(hyuwon.dates.length) HYUWON_MAP[slotKey]=hyuwon;
    else delete HYUWON_MAP[slotKey];
    saveHyuwon();
    _stuPopup.selDate=ds;
    renderStuPopup();
    buildTable();
    return;
  }

  // 1) 제외일 클릭 → 해제
  if(RETIRE_MAP[slotKey]?.ds===ds){
    delete RETIRE_MAP[slotKey];
    saveRetire();
    _stuPopup.selDate=null;
    _stuPopup.showEnroll=false;
    _flashKey=slotKey;
    renderStuPopup();
    buildTable();
    toast('제외 해제','ok');
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
    renderStuPopup();
    return;
  }

  // 4) 새 날짜 선택 + 기존 마크에 따라 폼 자동 열기
  _stuPopup.selDate=ds;
  _stuPopup.showHyuwon=false;
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
  renderStuPopup();
  setTimeout(()=>document.getElementById('sp-bogang-name')?.focus(),30);
}

function handleBogangSet(e, ctx){
  const {slotKey} = ctx;
  const ds=_stuPopup.selDate;
  const n=document.getElementById('sp-bogang-name')?.value.trim();
  const a=parseInt(document.getElementById('sp-bogang-age')?.value)||null;
  if(!n){toast('이름을 입력하세요','err');return;}
  const cur=getMark(slotKey,ds);
  const subObj={type:'bogang',n,a};
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
  renderStuPopup();
}

// handleHyuwonSet 제거 — 날짜 클릭으로 즉시 토글됨

function handleHyuwonDel(e, ctx){
  const {slotKey} = ctx;
  delete HYUWON_MAP[slotKey];
  saveHyuwon();
  _stuPopup.showHyuwon=false;
  _flashKey=slotKey;
  renderStuPopup();
  buildTable();
  toast('휴원 해제','ok');
}

/* ── 예약(제외/등록) 핸들러 ── */

function handleRetireSet(e, ctx){
  const {t, day, lane, row, slotKey} = ctx;
  const ds=_stuPopup.selDate;
  // 같은 날짜 토글 → 해제
  if(RETIRE_MAP[slotKey]?.ds===ds){
    delete RETIRE_MAP[slotKey];
    saveRetire();
    renderStuPopup();
    _flashKey=slotKey;
    buildTable();
    toast('제외 해제','ok');
    return;
  }
  // [v118] 제외 종류 선택: 퇴원(기록 영구 보관) vs 단순 제외(이동 등 임시용, 기록 X)
  const stu=getStu(t,day,lane,row);
  _showRetireChoiceModal({stu, slotKey, ds});
}

// [v118] 제외 종류 선택 modal
function _showRetireChoiceModal({stu, slotKey, ds}){
  const existing = document.getElementById('retire-choice-modal');
  if(existing) existing.remove();
  const stuLabel = stu ? `${stu.n}${stu.a||''}` : '(빈 셀)';
  const html = `
    <div id="retire-choice-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center">
      <div style="background:#fff;padding:24px 28px;border-radius:14px;min-width:320px;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,.4)">
        <div style="font-weight:900;font-size:15px;margin-bottom:6px;color:#111">제외 종류 선택</div>
        <div style="font-size:12px;color:#666;margin-bottom:18px">${esc(stuLabel)} · ${ds}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button id="rc-retire" style="padding:14px;background:#EF4444;color:#fff;border:none;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;text-align:left;padding-left:18px">
            🚪 퇴원<div style="font-size:10px;font-weight:500;opacity:.9;margin-top:2px">기록을 영구 보관합니다</div>
          </button>
          <button id="rc-simple" style="padding:14px;background:#6B7280;color:#fff;border:none;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;text-align:left;padding-left:18px">
            ✂️ 단순 제외<div style="font-size:10px;font-weight:500;opacity:.9;margin-top:2px">이동 등 임시 처리 (기록 안 남음)</div>
          </button>
          <button id="rc-cancel" style="padding:8px;background:#fff;color:#666;border:1.5px solid #D1D5DB;border-radius:10px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;margin-top:4px">취소</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  const modal = document.getElementById('retire-choice-modal');
  const close = ()=>modal.remove();
  document.getElementById('rc-cancel').addEventListener('click', close);
  modal.addEventListener('click', (e)=>{ if(e.target===modal) close(); });
  // 공통: RETIRE_MAP 저장
  const _setRetire = (withHistory)=>{
    RETIRE_MAP[slotKey]={ds, name:stu?(stu.n+(stu.a||'')):''};
    saveRetire();
    if(withHistory && stu && typeof addRetireHistory==='function') addRetireHistory(stu, ds);
    renderStuPopup();
    _flashKey=slotKey;
    buildTable();
  };
  document.getElementById('rc-retire').addEventListener('click', ()=>{
    close();
    _setRetire(true);
    toast('🚪 퇴원 처리 완료 (기록 보관됨)','ok');
  });
  document.getElementById('rc-simple').addEventListener('click', ()=>{
    close();
    _setRetire(false);
    toast('✂️ 단순 제외 완료 (기록 X)','ok');
  });
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
    renderStuPopup();
    return;
  }
  _stuPopup.showEnroll=!_stuPopup.showEnroll;
  _stuPopup.showBogang=false;
  _stuPopup.showSample=false;
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
  const vehicle=g(prefix+'vehicle')?.classList.contains('on')||false;
  const gender=g(prefix+'gender-m')?.classList.contains('on')?'m'
    :(g(prefix+'gender-f')?.classList.contains('on')?'f':null);
  const loc=g(prefix+'loc')?.value.trim()||'';
  const memo=g(prefix+'memo')?.value.trim()||'';
  const isNew=g(prefix+'new')?.classList.contains('on')||false;
  return {name,age,phone,vehicle,gender,loc,memo,isNew};
}

function _commitEnroll(slotKey, form){
  if(!form.name){toast('이름을 입력하세요','err');return;}
  const ds=_stuPopup.selDate;
  const todayStr=toDateStr(getToday());
  let enrollMonth=null;
  if(form.isNew){
    // [FIX] ds가 학기 안에 들어가면 그 학기 month, 아니면 ds 이후 첫 학기 month.
    //   이전엔 "ds >= start"만 봐서 학기 사이 공백(예: 4/30~5/5)에 등록 예약하면
    //   isNew=4(이전 학기)로 저장됨 → 5월에 활성화돼도 신규 표시 안 됨.
    for(let i=0;i<SCHEDULE_PERIODS.length;i++){
      const p=SCHEDULE_PERIODS[i];
      // ds가 이 학기 안에 떨어짐 (start <= ds <= end), 또는 이 학기 시작 전 (다음에 들어갈 학기)
      const inPeriod = ds>=p.start && (!p.end || ds<=p.end);
      const beforePeriod = ds<p.start;
      if(inPeriod || beforePeriod){
        enrollMonth=p.month;
        break;
      }
    }
    // 모든 학기보다 뒤(예: 12월 학기 종료 후) → 마지막 학기 month
    if(enrollMonth===null && SCHEDULE_PERIODS.length){
      enrollMonth=SCHEDULE_PERIODS[SCHEDULE_PERIODS.length-1].month;
    }
  }

  // [FIX] 당일/과거 등록 → ENROLL_MAP 거치지 않고 즉시 STUDENTS에 등록
  if(ds<=todayStr){
    const [t,d,l,r]=slotKey.split('/');
    const li=parseInt(l), ri=parseInt(r);
    // 기존 학생 제거 (혹시 있다면)
    const existIdx=STUDENTS.findIndex(s=>s.t===t&&s.d===d&&s.l===li&&s.r===ri);
    if(existIdx>=0) STUDENTS.splice(existIdx,1);
    const obj={n:form.name, a:form.age||null, t, d, l:li, r:ri};
    if(form.phone) obj.p=form.phone;
    if(form.vehicle) obj.v=true;
    if(form.gender) obj.g=form.gender;
    if(form.loc) obj.loc=form.loc;
    if(form.memo) obj.memo=form.memo;
    if(enrollMonth) obj.isNew=enrollMonth;
    else obj.enrolled=ds;  // 등록 표시 (빨간 배경 시각 효과)
    STUDENTS.push(obj);
    _stuIdx[slotKey]=obj;
    if(DISABLED_MAP[slotKey]){delete DISABLED_MAP[slotKey];saveDisabled();}
    saveStudents();
    _stuPopup.selDate=null;
    _stuPopup.showEnroll=false;
    renderStuPopup(true);
    buildTable();
    toast(form.name+(form.age||'')+' 즉시 등록','ok');
    return;
  }

  // 미래 → ENROLL_MAP에 예약 저장
  ENROLL_MAP[slotKey]={
    ds,
    name:form.name, age:form.age,
    p:form.phone||undefined,
    isNew:enrollMonth||undefined,
    enrolled:true,
    v:form.vehicle||undefined,
    loc:form.loc||undefined,
    memo:form.memo||undefined,
    g:form.gender||undefined,
  };
  saveEnroll();
  _stuPopup.selDate=null;
  _stuPopup.showEnroll=false;
  renderStuPopup(true);
  buildTable();
  toast(form.name+(form.age||'')+' 등록 예약','ok');
}

function handleEnrollSet(e, ctx){
  _commitEnroll(ctx.slotKey, _readEnrollForm('sp-enroll-'));
}

function handleEnrollFromLeft(e, ctx){
  _commitEnroll(ctx.slotKey, _readEnrollForm('sp-'));
}

function handleEnrollDel(e, ctx){
  delete ENROLL_MAP[ctx.slotKey];
  saveEnroll();
  _stuPopup.selDate=null;
  _stuPopup.showEnroll=false;
  _flashKey=ctx.slotKey;
  renderStuPopup();
  buildTable();
  toast('등록 해제','ok');
}

function handleEnrollVehicleToggle(e, ctx){
  const btn=e.target.closest('#sp-enroll-vehicle');
  if(!btn) return;
  btn.classList.toggle('on');
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
  if(btn) btn.classList.toggle('on');
}

/**
 * 간단한 ID-셀렉터 → 핸들러 맵
 * (ctx만 받는 핸들러들)
 */
const STU_POPUP_SIMPLE_HANDLERS = [
  ['#sp-vehicle',         handleVehicleToggle],
  ['#sp-enroll-vehicle',  handleEnrollVehicleToggle],
  ['#sp-gender-m',        handleGenderM],
  ['#sp-gender-f',        handleGenderF],
  ['#sp-new',             handleNewToggle],
  ['#sp-enroll-gender-m', handleEnrollGenderM],
  ['#sp-enroll-gender-f', handleEnrollGenderF],
  ['#sp-enroll-new',      handleEnrollNewToggle],
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

  // [스냅샷] 읽기 전용 — 닫기 버튼만 허용, 변경 액션은 모두 차단
  const isSnap=typeof isSnapshotTab==='function'&&isSnapshotTab();
  if(isSnap){
    if(e.target.closest('#sp-close')){ closeStuPopup(); return; }
    // 다른 클릭은 무시 (보기 전용)
    return;
  }

  // 단순 핸들러 디스패치
  for(const [sel, fn] of STU_POPUP_SIMPLE_HANDLERS){
    if(e.target.closest(sel)){ fn(e, ctx); return; }
  }

  // 날짜 박스 클릭
  const dateBox=e.target.closest('.stu-date-box');
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

// [v96 #3] 승하차 장소에 입력하면 차량 토글 자동 ON
document.getElementById('stu-popup').addEventListener('input',function(e){
  if(e.target?.id==='sp-loc' && e.target.value.trim().length>0){
    const vBtn=document.getElementById('sp-vehicle');
    if(vBtn && !vBtn.classList.contains('on')){
      vBtn.classList.remove('off');
      vBtn.classList.add('on');
    }
  }
  // [v99] 등록 폼의 승하차도 동일하게
  if(e.target?.id==='sp-enroll-loc' && e.target.value.trim().length>0){
    const vBtn=document.getElementById('sp-enroll-vehicle');
    if(vBtn && !vBtn.classList.contains('on')){
      vBtn.classList.remove('off');
      vBtn.classList.add('on');
    }
  }
});

// _pendingSync → data.js (cross-file shared state)

function closeStuPopup(){
  document.getElementById('stu-popup').classList.remove('show');
  if(_stuPopup.td) _stuPopup.td.classList.remove('stu-active');
  _stuPopup.key=null;_stuPopup.selDate=null;_stuPopup.showEnroll=false;_stuPopup.showBogang=false;_stuPopup.showSample=false;
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
 */
function askDateForDay(day, callback){
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
  box.innerHTML=`<div style="font-weight:700;font-size:13px;margin-bottom:8px">📅 ${day}요일 날짜 선택</div>
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

function executeMove(dstT,dstDay,dstLane,dstRow){
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

    // 1) 학생 바꾸기 / 또는 한쪽으로 이동
    const srcIdx=STUDENTS.findIndex(s=>s.t===sT&&s.d===sD&&s.l===sLi&&s.r===sRi);
    if(srcIdx<0){toast('소스 학생 정보 오류','err');return;}
    if(dstStu){
      // 양쪽 모두 학생: 완전 교환
      const dstIdx=STUDENTS.findIndex(s=>s.t===dstT&&s.d===dstDay&&s.l===dstLane&&s.r===dstRow);
      STUDENTS[srcIdx]={...dstStu, t:sT, d:sD, l:sLi, r:sRi};
      STUDENTS[dstIdx]={...srcStu, t:dstT, d:dstDay, l:dstLane, r:dstRow};
      _stuIdx[srcKey]=STUDENTS[srcIdx];
      _stuIdx[dstKey]=STUDENTS[dstIdx];
    } else {
      // 도착지는 빈 셀 (뱃지만 있음): 소스 학생 → 도착지로 이동, 소스는 비게 됨 (뱃지만 남음)
      STUDENTS[srcIdx]={...srcStu, t:dstT, d:dstDay, l:dstLane, r:dstRow};
      _stuIdx[dstKey]=STUDENTS[srcIdx];
      delete _stuIdx[srcKey];
      // 도착지가 비활성화 셀이었다면 활성화
      if(DISABLED_MAP[dstKey]){delete DISABLED_MAP[dstKey];saveDisabled();}
    }

    // 2) RETIRE_MAP 교환
    const sR1=RETIRE_MAP[srcKey], dR1=RETIRE_MAP[dstKey];
    if(sR1||dR1){
      if(dR1) RETIRE_MAP[srcKey]=dR1; else delete RETIRE_MAP[srcKey];
      if(sR1) RETIRE_MAP[dstKey]=sR1; else delete RETIRE_MAP[dstKey];
      saveRetire();
    }
    // 3) ENROLL_MAP 교환
    const sE1=ENROLL_MAP[srcKey], dE1=ENROLL_MAP[dstKey];
    if(sE1||dE1){
      if(dE1) ENROLL_MAP[srcKey]=dE1; else delete ENROLL_MAP[srcKey];
      if(sE1) ENROLL_MAP[dstKey]=sE1; else delete ENROLL_MAP[dstKey];
      saveEnroll();
    }
    // 4) MARK_MAP 교환 — 미래 마크만 교환, 과거 마크는 원래 자리 유지 (히스토리 보존)
    const todayStr=toDateStr(getToday());
    const srcMarks={}, dstMarks={};
    for(const k of Object.keys(MARK_MAP)){
      if(k.startsWith(srcKey+'/')){
        const ds=k.slice(srcKey.length+1);  // 'YYYY-MM-DD'
        if(ds>=todayStr){srcMarks[k.slice(srcKey.length)]=MARK_MAP[k];delete MARK_MAP[k];}
      } else if(k.startsWith(dstKey+'/')){
        const ds=k.slice(dstKey.length+1);
        if(ds>=todayStr){dstMarks[k.slice(dstKey.length)]=MARK_MAP[k];delete MARK_MAP[k];}
      }
    }
    let markChanged=false;
    for(const suf of Object.keys(srcMarks)){MARK_MAP[dstKey+suf]=srcMarks[suf];markChanged=true;}
    for(const suf of Object.keys(dstMarks)){MARK_MAP[srcKey+suf]=dstMarks[suf];markChanged=true;}
    if(markChanged) saveMark();
    // 5) HYUWON_MAP 교환 — 미래 날짜만 교환
    const sH=HYUWON_MAP[srcKey], dH=HYUWON_MAP[dstKey];
    if(sH||dH){
      const splitByDate=(hy)=>{
        if(!hy||!hy.dates) return {past:null, future:null};
        const past=hy.dates.filter(d=>d<todayStr);
        const future=hy.dates.filter(d=>d>=todayStr);
        return {
          past: past.length?{dates:past}:null,
          future: future.length?{dates:future}:null,
        };
      };
      const sp=splitByDate(sH), dp=splitByDate(dH);
      // 원래 자리에 과거 + 교환된 미래
      const newSrc = mergeHyuwon(sp.past, dp.future);
      const newDst = mergeHyuwon(dp.past, sp.future);
      if(newSrc) HYUWON_MAP[srcKey]=newSrc; else delete HYUWON_MAP[srcKey];
      if(newDst) HYUWON_MAP[dstKey]=newDst; else delete HYUWON_MAP[dstKey];
      saveHyuwon();
    }
    saveStudents();
    _moveMode=null;
    document.getElementById('move-bar').style.display='none';
    buildTable();
    const srcLabel=srcStu.n+(srcStu.a||'');
    const dstLabel=dstStu?dstStu.n+(dstStu.a||''):'빈 셀';
    toast(`${srcLabel} ↔ ${dstLabel} 자리바꾸기 완료`,'ok');
    return;
  }

  // 보강/샘플 마크 이동
  if(type==='mark'){
    const {markData, markType, srcDs}=_moveMode;
    // 목적지에 학생이 있으면 차단
    if(getStu(dstT,dstDay,dstLane,dstRow)){toast('빈 셀에만 이동 가능합니다','err');return;}
    const [sT,sD,sL,sR]=srcKey.split('/');
    // 요일이 다르면 날짜 선택 모달
    if(sD!==dstDay){
      askDateForDay(dstDay, function(newDs){
        if(!newDs) return; // 취소
        const dstMark=getMark(dstKey,newDs);
        if(dstMark){toast('목적지에 같은 날짜 마크가 있습니다','err');return;}
        // 소스 제거
        const srcMark=getMark(srcKey,srcDs);
        if(srcMark?.type==='absent'&&srcMark.sub) setMark(srcKey,srcDs,{type:'absent'});
        else clearMark(srcKey,srcDs);
        // 목적지 설정
        setMark(dstKey,newDs,markData);
        _moveMode=null;
        document.getElementById('move-bar').style.display='none';
        buildTable();
        toast((markType==='bogang'?'보강':'샘플')+' 이동 완료 ('+newDs.slice(5)+')','ok');
      });
      return;
    }
    // 같은 요일 → 같은 날짜 유지
    const dstMark=getMark(dstKey,srcDs);
    if(dstMark){toast('목적지에 같은 날짜 마크가 있습니다','err');return;}
    const srcMark=getMark(srcKey,srcDs);
    if(srcMark?.type==='absent'&&srcMark.sub){
      setMark(srcKey,srcDs,{type:'absent'});
    } else {
      clearMark(srcKey,srcDs);
    }
    setMark(dstKey,srcDs,markData);
    _moveMode=null;
    document.getElementById('move-bar').style.display='none';
    buildTable();
    toast((markType==='bogang'?'보강':'샘플')+' 이동 완료','ok');
    return;
  }

  // 등록 예약 이동
  if(type==='enroll'){
    const {enrData}=_moveMode;
    if(getStu(dstT,dstDay,dstLane,dstRow)){toast('빈 셀에만 이동 가능합니다','err');return;}
    if(ENROLL_MAP[dstKey]){toast('목적지에 이미 등록 예약이 있습니다','err');return;}
    if(RETIRE_MAP[dstKey]){toast('목적지에 제외 예약이 있습니다','err');return;}
    const [sT,sD,sL,sR]=srcKey.split('/');
    // 요일이 다르면 날짜 선택
    if(sD!==dstDay){
      askDateForDay(dstDay, function(newDs){
        if(!newDs) return;
        delete ENROLL_MAP[srcKey];
        const newEnr={...enrData, ds:newDs};
        ENROLL_MAP[dstKey]=newEnr;
        saveEnroll();
        _moveMode=null;
        document.getElementById('move-bar').style.display='none';
        buildTable();
        toast('등록 예약 '+(enrData.name||'')+' 이동 완료 ('+newDs.slice(5)+')','ok');
      });
      return;
    }
    delete ENROLL_MAP[srcKey];
    ENROLL_MAP[dstKey]=enrData;
    saveEnroll();
    _moveMode=null;
    document.getElementById('move-bar').style.display='none';
    buildTable();
    toast('등록 예약 '+(enrData.name||'')+' 이동 완료','ok');
    return;
  }

  // 예약 이동 (전체) → RETIRE(출발) + ENROLL(도착) 조합
  if(type==='reserve'){
    const {stu}=_moveMode;
    if(getStu(dstT,dstDay,dstLane,dstRow)){toast('빈 셀에만 예약 가능합니다','err');return;}
    // 목적지에 기존 예약 있으면 차단
    if(RETIRE_MAP[dstKey]||ENROLL_MAP[dstKey]){
      toast('목적지에 기존 예약이 있습니다','err');return;
    }
    // 출발지에 기존 제외 예약 있으면 차단
    if(RETIRE_MAP[srcKey]){
      toast('출발지에 이미 제외 예약이 있습니다','err');return;
    }
    // 날짜 선택
    askDateForDay(dstDay, function(newDs){
      if(!newDs){return;}
      // 출발지 제외
      RETIRE_MAP[srcKey]={ds:newDs, name:stu.n};
      saveRetire();
      // 도착지 등록 (원생 정보만 이동 — 마크/등록 플래그 안 붙임)
      const enrollEntry={
        ds:newDs,
        name:stu.n,
        age:stu.a||null,
      };
      if(stu.p) enrollEntry.p=stu.p;
      if(stu.v) enrollEntry.v=true;
      if(stu.loc) enrollEntry.loc=stu.loc;
      if(stu.memo) enrollEntry.memo=stu.memo;
      if(stu.g) enrollEntry.g=stu.g;
      ENROLL_MAP[dstKey]=enrollEntry;
      saveEnroll();
      // 휴원은 자동 이동하지 않음 — 사용자가 도착지에서 새 날짜 기준으로 직접 설정
      // (출발지 휴원은 이동 실행 시점 RETIRE 처리에서 자동 정리됨)
      _moveMode=null;
      document.getElementById('move-bar').style.display='none';
      buildTable();
      const label=newDs.slice(5).replace('-','/');
      toast(stu.n+(stu.a||'')+' 예약 이동 ('+label+')','ok');
    });
    return;
  }

  // 원생 복사
  if(type==='copy'){
    const {stu}=_moveMode;
    if(getStu(dstT,dstDay,dstLane,dstRow)){toast('빈 셀에만 복사 가능합니다','err');return;}
    // 신규 학생 객체: 위치만 변경, isNew/movedUntil/enrolled 등 메타는 제외
    const newStu={n:stu.n,a:stu.a,t:dstT,d:dstDay,l:dstLane,r:dstRow};
    if(stu.p) newStu.p=stu.p;
    if(stu.v) newStu.v=true;
    if(stu.g) newStu.g=stu.g;
    if(stu.loc) newStu.loc=stu.loc;
    if(stu.memo) newStu.memo=stu.memo;
    STUDENTS.push(newStu);
    _stuIdx[dstKey]=newStu;
    if(DISABLED_MAP[dstKey]){delete DISABLED_MAP[dstKey];saveDisabled();}
    saveStudents();
    _moveMode=null;
    document.getElementById('move-bar').style.display='none';
    buildTable();
    toast(stu.n+(stu.a||'')+' 복사 완료','ok');
    return;
  }

  const {stu}=_moveMode;
  const [sT,sD,sL,sR]=srcKey.split('/');

  // [FIX] 목적지에 이미 학생이 있으면 이동 중단 (이전엔 사일런트 덮어쓰기 → STUDENTS 좀비)
  if(getStu(dstT,dstDay,dstLane,dstRow)){
    toast('목적지에 이미 학생이 있습니다','err');
    return;
  }
  // [FIX] 전체 이동 시 목적지에 기존 미래 예약/마크가 있으면 데이터 손실 방지를 위해 중단
  //   — 과거 마크는 허용 (목적지의 히스토리 데이터, 충돌 없음)
  if(type==='all'){
    const todayStr=toDateStr(getToday());
    const hasFutureMark=Object.keys(MARK_MAP).some(k=>{
      if(!k.startsWith(dstKey+'/')) return false;
      const ds=k.slice(dstKey.length+1);
      return ds>=todayStr;
    });
    const hasFutureHyuwon=HYUWON_MAP[dstKey]?.dates?.some(d=>d>=todayStr);
    if(RETIRE_MAP[dstKey]||ENROLL_MAP[dstKey]||hasFutureMark||hasFutureHyuwon){
      toast('목적지에 기존 미래 예약/마크가 있습니다','err');
      return;
    }
  }

  // 소스 학생 제거
  const sIdx=STUDENTS.findIndex(s=>s.t===sT&&s.d===sD&&s.l===parseInt(sL)&&s.r===parseInt(sR));
  if(sIdx>=0) STUDENTS.splice(sIdx,1);
  delete _stuIdx[srcKey];

  // 목적지에 학생 등록
  const newStu={...stu, t:dstT, d:dstDay, l:dstLane, r:dstRow};
  // 기존 movedUntil 필드가 있었다면 제거 (이전 구현 잔재)
  delete newStu.movedUntil;
  STUDENTS.push(newStu);
  _stuIdx[dstKey]=newStu;
  // [FIX] 비활성화된 목적지 셀이면 자동 활성화 (handleSave와 동일 동작)
  if(DISABLED_MAP[dstKey]){delete DISABLED_MAP[dstKey];saveDisabled();}
  saveStudents();

  // 전체 이동: 날짜 데이터도 이동 — 과거는 원 자리 유지, 미래만 이동
  if(type==='all'){
    const todayStr=toDateStr(getToday());
    // RETIRE_MAP (보통 미래만 존재)
    if(RETIRE_MAP[srcKey]){RETIRE_MAP[dstKey]=RETIRE_MAP[srcKey];delete RETIRE_MAP[srcKey];saveRetire();}
    // ENROLL_MAP (보통 미래만 존재)
    if(ENROLL_MAP[srcKey]){ENROLL_MAP[dstKey]=ENROLL_MAP[srcKey];delete ENROLL_MAP[srcKey];saveEnroll();}
    // MARK_MAP — 미래 마크만 이동, 과거는 원 자리(히스토리)에 유지
    let markMoved=false;
    for(const key of Object.keys(MARK_MAP)){
      if(key.startsWith(srcKey+'/')){
        const ds=key.slice(srcKey.length+1);
        if(ds<todayStr) continue;  // 과거 마크는 유지
        MARK_MAP[dstKey+'/'+ds]=MARK_MAP[key];
        delete MARK_MAP[key];
        markMoved=true;
      }
    }
    if(markMoved) saveMark();
    // HYUWON_MAP — 미래 날짜만 이동, 과거는 원 자리 유지
    if(HYUWON_MAP[srcKey]){
      const src=HYUWON_MAP[srcKey];
      if(src.dates){
        const past=src.dates.filter(d=>d<todayStr);
        const future=src.dates.filter(d=>d>=todayStr);
        if(future.length) HYUWON_MAP[dstKey]={dates:future};
        if(past.length) HYUWON_MAP[srcKey]={dates:past};
        else delete HYUWON_MAP[srcKey];
      } else {
        // 구 형식 호환: 날짜 구분 없이 이동
        HYUWON_MAP[dstKey]=src;
        delete HYUWON_MAP[srcKey];
      }
      saveHyuwon();
    }
  }

  _moveMode=null;
  document.getElementById('move-bar').style.display='none';
  buildTable();
  toast(newStu.n+' 이동 완료','ok');
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

