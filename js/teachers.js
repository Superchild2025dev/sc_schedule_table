/* ════════════════════════════════════════════════════════════════
 * SECTION: 담임 선택 팝업
 * ════════════════════════════════════════════════════════════════ */
// [v115] TEACHERS는 이제 Firebase에 저장되는 동적 목록
//   기본값(처음 로드 시): 기존 하드코딩 6명
const _DEFAULT_TEACHERS=[
  {n:'김민승',color:'#93C5FD'},
  {n:'박형진',color:'#86EFAC'},
  {n:'이수성',color:'#FCD34D'},
  {n:'김재용',color:'#F9A8D4'},
  {n:'손용곤',color:'#C4B5FD'},
  {n:'김형수',color:'#6EE7B7'},
];
let TEACHERS = [];

function loadTeachers(){
  const saved=loadJSON(STORAGE_KEYS.TEACHERS, null);
  // saved===null → 처음 로드, 기본값 사용
  // saved===[] → 사용자가 모두 삭제한 상태, 그대로 유지
  // [지점] 가경점만 디폴트 선생님 시드 사용. 용암점/그 외 지점은 빈 목록으로 시작.
  const isGagyeong = (typeof getBranchInfo==='function') ? (getBranchInfo()?.id==='gagyeong') : true;
  TEACHERS = (saved && Array.isArray(saved))
    ? saved
    : (isGagyeong ? JSON.parse(JSON.stringify(_DEFAULT_TEACHERS)) : []);
  updateTeacherStyles();
}
function saveTeachers(){
  saveJSON(STORAGE_KEYS.TEACHERS, TEACHERS);
  updateTeacherStyles();
}
function updateTeachersTx(mutator){
  return _txJSONValue(STORAGE_KEYS.TEACHERS,TEACHERS,next=>{
    TEACHERS=Array.isArray(next)?next:[];
    updateTeacherStyles();
  },(teachers,abort)=>{
    const list=Array.isArray(teachers)?teachers:[];
    return mutator(list,abort);
  },[]);
}

// [v115] 선생님 이름을 CSS-safe 클래스명으로 변환
//   한글/영숫자/언더스코어만 허용, 그 외는 언더스코어로 치환
function teacherCssClass(name){
  return 'i-' + String(name||'').replace(/[^a-zA-Z0-9가-힣_]/g,'_');
}

// [v115] 선생님 색상을 동적 CSS로 주입 — 이름 변경 시 자동 재생성
function updateTeacherStyles(){
  let style=document.getElementById('teacher-styles');
  if(!style){
    style=document.createElement('style');
    style.id='teacher-styles';
    document.head.appendChild(style);
  }
  let css='';
  TEACHERS.forEach(t=>{
    css += `.${teacherCssClass(t.n)}{background:${t.color}!important;color:#111!important}\n`;
  });
  style.textContent=css;
}

/* [v115] 선생님 관리 모달 */
function openTeacherModal(){
  document.getElementById('teacher-modal').style.display='flex';
  renderTeacherList();
}
function closeTeacherModal(){
  document.getElementById('teacher-modal').style.display='none';
}
function renderTeacherList(){
  const list=document.getElementById('tm-list');
  if(!list) return;
  if(TEACHERS.length===0){
    list.innerHTML='<div style="color:#888;font-size:12px;text-align:center;padding:12px">등록된 선생님이 없습니다</div>';
    return;
  }
  list.innerHTML=TEACHERS.map((t,i)=>`
    <div class="tm-row" data-idx="${i}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1.5px solid #E5E7EB;border-radius:8px;background:#fff">
      <input type="color" class="tm-color" value="${t.color}" data-idx="${i}" style="width:32px;height:32px;border:none;border-radius:6px;cursor:pointer;padding:0;background:none">
      <input type="text" class="tm-name fi" value="${esc(t.n)}" data-idx="${i}" data-orig="${esc(t.n)}" style="flex:1;margin:0;padding:6px 10px;font-size:13px">
      <button class="btn btn-d tm-del" data-idx="${i}" style="padding:5px 10px;font-size:10px">삭제</button>
    </div>
  `).join('');

  // 이벤트 위임
  list.querySelectorAll('.tm-color').forEach(el=>{
    el.addEventListener('change',e=>{
      const idx=parseInt(e.target.dataset.idx);
      handleTeacherColorChange(idx, e.target.value);
    });
  });
  list.querySelectorAll('.tm-name').forEach(el=>{
    const commit=()=>{
      const idx=parseInt(el.dataset.idx);
      const orig=el.dataset.orig;
      const nv=el.value.trim();
      if(!nv || nv===orig){ el.value=orig; return; }
      handleTeacherNameEdit(idx, orig, nv);
    };
    el.addEventListener('blur',commit);
    el.addEventListener('keydown',e=>{
      if(e.key==='Enter'){ e.preventDefault(); el.blur(); }
      if(e.key==='Escape'){ el.value=el.dataset.orig; el.blur(); }
    });
  });
  list.querySelectorAll('.tm-del').forEach(el=>{
    el.addEventListener('click',e=>{
      const idx=parseInt(e.target.dataset.idx);
      handleTeacherDelete(idx);
    });
  });
}
async function addTeacher(){
  if(window.SCAuth && !SCAuth.requirePermission('manageTeachers','선생님 관리')) return;
  // 중복 안 나는 기본 이름 찾기
  let createdName='';
  try{
    await updateTeachersTx(teachers=>{
      let i=1, name='선생님'+i;
      while(teachers.some(t=>t.n===name)){ i++; name='선생님'+i; }
      // 팔레트 순환해서 기본색 지정
      const palette=['#93C5FD','#86EFAC','#FCD34D','#F9A8D4','#C4B5FD','#6EE7B7','#FCA5A5','#FDBA74','#A5F3FC','#D8B4FE'];
      const color=palette[teachers.length % palette.length];
      teachers.push({n:name, color});
      createdName=name;
      return teachers;
    });
    renderTeacherList();
    // 새로 추가한 행의 이름 input에 포커스 + 전체 선택
    setTimeout(()=>{
      const input=[...document.querySelectorAll('#tm-list .tm-name')].find(el=>el.value===createdName);
      if(input){ input.focus(); input.select(); }
    },30);
  }catch(err){
    toast(err?.message||'선생님 추가 실패','err');
    console.error(err);
  }
}
async function handleTeacherColorChange(idx, newColor){
  if(window.SCAuth && !SCAuth.requirePermission('manageTeachers','선생님 관리')) return;
  if(!TEACHERS[idx]) return;
  const targetName=TEACHERS[idx].n;
  try{
    await updateTeachersTx((teachers,abort)=>{
      const i=teachers.findIndex(t=>t.n===targetName);
      if(i<0){abort('선생님 정보가 먼저 변경되었습니다');return;}
      teachers[i].color=newColor;
      return teachers;
    });
    buildTable();
  }catch(err){
    toast(err?.message||'색상 저장 실패','err');
    console.error(err);
  }
}
async function handleTeacherNameEdit(idx, oldName, newName){
  if(window.SCAuth && !SCAuth.requirePermission('manageTeachers','선생님 관리')) return;
  if(!TEACHERS[idx]) return;
  // 중복 검사
  if(TEACHERS.some((t,i)=>i!==idx && t.n===newName)){
    toast('같은 이름의 선생님이 이미 있습니다','err');
    renderTeacherList(); // 원복
    return;
  }
  let renameCount=0;
  try{
    const txKeys=new Set([STORAGE_KEYS.TEACHERS,getTabConfig().instKey]);
    _tabList.forEach(tab=>{
      if(!tab||tab.type==='snapshot') return;
      const iKey = tab.type==='bangteuk'
        ? 'swim_bt_'+tab.id+'_inst'
        : (tab.id==='regular' ? 'swim_inst' : 'swim_inst_'+tab.id);
      txKeys.add(iKey);
    });
    await updateScheduleTx([...txKeys], ctx=>{
      const teachers=ctx.get(STORAGE_KEYS.TEACHERS,[]);
      const tIdx=teachers.findIndex(t=>t.n===oldName);
      if(tIdx<0){ctx.abort('선생님 정보가 먼저 변경되었습니다');return;}
      if(teachers.some((t,i)=>i!==tIdx && t.n===newName)){
        ctx.abort('같은 이름의 선생님이 이미 있습니다');
        return;
      }
      teachers[tIdx].n=newName;
      ctx.set(STORAGE_KEYS.TEACHERS,teachers);

      txKeys.forEach(iKey=>{
        if(iKey===STORAGE_KEYS.TEACHERS) return;
        const inst=ctx.get(iKey,{});
        let changed=false;
        for(const k in inst){
          if(inst[k] && inst[k].n===oldName){
            inst[k].n=newName;
            renameCount++;
            changed=true;
          }
        }
        if(changed) ctx.set(iKey,inst);
      });
      return true;
    });
    renderTeacherList();
    buildTable();
    toast(`"${oldName}" → "${newName}" (${renameCount}개 셀 갱신)`,'ok');
  }catch(err){
    toast(err?.message||'선생님 이름 변경 실패','err');
    renderTeacherList();
    console.error(err);
  }
}
async function handleTeacherDelete(idx){
  if(window.SCAuth && !SCAuth.requirePermission('manageTeachers','선생님 관리')) return;
  const t=TEACHERS[idx];
  if(!t) return;
  // 사용 중인지 확인
  let useCount=0;
  for(const k in INST_MAP){
    if(INST_MAP[k] && INST_MAP[k].n===t.n) useCount++;
  }
  if(useCount>0){
    toast(`${t.n} 선생님이 ${useCount}개 셀에 배정되어 삭제 불가`,'err');
    return;
  }
  if(!confirm(`${t.n} 선생님을 삭제하시겠습니까?`)) return;
  try{
    await updateTeachersTx((teachers,abort)=>{
      const i=teachers.findIndex(x=>x.n===t.n);
      if(i<0){abort('선생님 정보가 먼저 변경되었습니다');return;}
      teachers.splice(i,1);
      return teachers;
    });
    renderTeacherList();
    buildTable();
    toast('삭제 완료','ok');
  }catch(err){
    toast(err?.message||'삭제 실패','err');
    console.error(err);
  }
}

let _instPopup={el:null,key:null};

function _btPreviewStore(){
  if(!window.SC_BT_PREVIEW_INST) window.SC_BT_PREVIEW_INST={};
  return window.SC_BT_PREVIEW_INST;
}
function _btPreviewDefaultMeta(key){
  const p=String(key||'').split('/');
  const day=p[1]||'';
  const group=typeof _normalizeBangteukGroup==='function'
    ? _normalizeBangteukGroup('',day)
    : ('화목'.includes(day)?'화목':'월수금');
  const option=(typeof getBangteukGroupOptions==='function'?getBangteukGroupOptions():[]).find(o=>o.group===group)||null;
  return option?{...option}:{group};
}
function _btPreviewResolveMeta(raw,key){
  const base=raw===true?_btPreviewDefaultMeta(key):(raw||{});
  const p=String(key||'').split('/');
  const day=p[1]||'';
  const group=typeof _normalizeBangteukGroup==='function'
    ? _normalizeBangteukGroup(base.group||base.btGroup||'',day)
    : (base.group||base.btGroup||('화목'.includes(day)?'화목':'월수금'));
  const option=(typeof getBangteukGroupOptions==='function'?getBangteukGroupOptions():[]).find(o=>o.group===group)||null;
  return option?Object.assign({},option,{sourceKey:base.sourceKey||key}):Object.assign({},base,{group,sourceKey:base.sourceKey||key});
}
function _btPreviewDayInGroup(day,group){
  const g=String(group||'');
  if(!g) return day==='월'||day==='수'||day==='금';
  return g.includes(String(day||''));
}
function getBtPreviewSourceKey(key){
  const p=String(key||'').split('/');
  if(p.length<3) return '';
  const [t,day,lane]=p;
  const store=_btPreviewStore();
  if(store[key]){
    return key;
  }
  const order={'월':1,'화':2,'수':3,'목':4,'금':5,'토':6};
  return Object.keys(store).sort((a,b)=>{
    const ap=a.split('/'), bp=b.split('/');
    return (order[ap[1]]||99)-(order[bp[1]]||99)||a.localeCompare(b,'ko');
  }).find(src=>{
    const sp=src.split('/');
    if(sp.length<3||sp[0]!==t||String(sp[2])!==String(lane)) return false;
    const raw=store[src];
    const meta=_btPreviewResolveMeta(raw,src);
    return _btPreviewDayInGroup(day,meta.group||meta.btGroup);
  })||'';
}
function getBtPreviewInst(key){
  const sourceKey=getBtPreviewSourceKey(key)||key;
  const raw=_btPreviewStore()[sourceKey];
  if(!raw) return null;
  return _btPreviewResolveMeta(raw,sourceKey);
}
function isBtPreviewInst(key){
  return !!getBtPreviewInst(key);
}
function btPreviewLabelForInst(key){
  const meta=getBtPreviewInst(key);
  if(!meta) return '';
  const group=meta.group||meta.btGroup||'';
  return group?`(${group} 방특)`:'(방특)';
}
function hasBtPreviewForTime(t){
  return Object.keys(_btPreviewStore()).some(key=>key.startsWith(t+'/'));
}
function btPreviewLaneActive(t,day,lane){
  return !!getBtPreviewSourceKey(t+'/'+day+'/'+lane);
}
function toggleBtPreviewInst(key,on,meta){
  const store=_btPreviewStore();
  if(on){
    const resolved=meta||_btPreviewDefaultMeta(key);
    store[key]={group:resolved.group||resolved.btGroup||''};
  }
  else delete store[getBtPreviewSourceKey(key)||key];
}

function instPopupCanEdit(){
  return !(window.SCAuth && !SCAuth.can('editSchedule'));
}
let _lastBtPreviewApply={sig:'',at:0};
function _applyBtPreviewSelection(input){
  if(!input||input.name!=='ip-bt-preview-group'||!instPopupCanEdit()) return false;
  const key=_instPopup.key;
  if(!key) return true;
  const group=input.value||'';
  const sig=key+'|'+group;
  const now=Date.now();
  if(_lastBtPreviewApply.sig===sig && now-_lastBtPreviewApply.at<120) return true;
  _lastBtPreviewApply={sig,at:now};
  if(group){
    const option=(typeof getBangteukGroupOptions==='function'?getBangteukGroupOptions():[]).find(o=>o.group===group)||{group};
    toggleBtPreviewInst(key,true,option);
  } else {
    toggleBtPreviewInst(key,false);
  }
  buildTable();
  renderInstPopup();
  toast(group?group+' 방특 화면 테스트 표시':'방특반 화면 테스트 해제','ok');
  return true;
}

function openInstPopup(td,t,day,lane){
  if(window.SCAuth && !SCAuth.requirePermission('viewSchedule','담임/대기자 조회')) return;
  // 출석부 모드면 담임 팝업 무반응 (+ 버튼만 동작)
  if(typeof _attendanceMode!=='undefined' && _attendanceMode) return;
  if(_instSwapMode && !instPopupCanEdit()){
    if(typeof toast==='function') toast('담임 편집 권한이 없습니다','err');
    return;
  }
  // 교환 모드 → 목적지로 실행
  if(_instSwapMode){
    executeInstSwap(t,day,lane);
    return;
  }
  // 학생 팝업 열려있으면 닫기만
  if(document.getElementById('stu-popup').classList.contains('show')){
    closeStuPopup();
    return;
  }
  const popup=document.getElementById('inst-popup');
  const key=t+'/'+day+'/'+lane;

  // 팝업 열린 상태에서 클릭 → 무조건 닫기
  if(popup.classList.contains('show')){
    closeInstPopup();
    // 같은 셀이면 닫기만
    if(_instPopup.key===key) return;
    // 다른 셀이면 닫기만 (다음 클릭에 열림)
    return;
  }

  // stu 팝업 열려있으면 닫기
  closeStuPopup();

  _instPopup.key=key;
  _instPopup.td=td;
  _instPopup.t=t;_instPopup.day=day;_instPopup.lane=lane;

  renderInstPopup();
  popup.classList.add('show');

  // 위치 (show 후에 offsetHeight 계산 가능)
  const rect=td.getBoundingClientRect();
  const margin=8;
  let left=rect.left;
  let top=rect.bottom+4;
  const pw=popup.offsetWidth||280;
  const ph=popup.offsetHeight||200;
  if(left+pw>window.innerWidth-margin) left=window.innerWidth-pw-margin;
  if(left<margin) left=margin;
  // [v118] 아래 부족 → 위 시도 → 좌/우측 (셀 안 가리게) → 폴백 클램프
  if(top+ph>window.innerHeight-margin){
    const aboveTop = rect.top - ph - 4;
    if(aboveTop >= margin){
      top = aboveTop;
    } else {
      const rightSpace = window.innerWidth - rect.right - margin;
      const leftSpace  = rect.left - margin;
      if(rightSpace >= pw + 4){
        left = rect.right + 4;
        top  = Math.max(margin, Math.min(rect.top, window.innerHeight - ph - margin));
      } else if(leftSpace >= pw + 4){
        left = rect.left - pw - 4;
        top  = Math.max(margin, Math.min(rect.top, window.innerHeight - ph - margin));
      } else {
        top = Math.max(margin, window.innerHeight - ph - margin);
      }
    }
  }
  if(top<margin) top=margin;
  popup.style.left=left+'px';
  popup.style.top=top+'px';
}

function renderInstPopup(){
  const popup=document.getElementById('inst-popup');
  const key=_instPopup.key;
  if(!key) return;
  const cur=INST_MAP[key]||null;
  const canEdit=instPopupCanEdit();

  let html=`<div class="inst-popup-hd">${_instPopup.day} ${_instPopup.t} ${_instPopup.lane}레인 담임<span style="margin-left:auto;cursor:pointer;opacity:.5;font-size:16px" onclick="closeInstPopup()">✕</span></div>`;
  if(canEdit){
    html+=`<div class="inst-btn-grid">`;
    TEACHERS.forEach(teacher=>{
      const isActive=cur&&cur.n===teacher.n;
      html+=`<button class="inst-btn${isActive?' active':''}" data-name="${teacher.n}" style="background:${teacher.color}">
        ${teacher.n}
      </button>`;
    });
    html+=`</div>`;

    html+=`<div class="inst-popup-bottom">`;
    html+=`<label><input type="checkbox" id="ip-lead" ${cur?.lead?'checked':''}> 1번레인</label>`;
    html+=`<label><input type="checkbox" id="ip-youth" ${cur?.youth?'checked':''}> 유아</label>`;
    // [v117] 반 분류: 엘/마, 엘리트, 마스터 (셋 중 하나만)
    const _curCls = (typeof getInstCls==='function') ? getInstCls(cur) : (cur?.elma?'elma':null);
    html+=`<label><input type="checkbox" id="ip-elma" ${_curCls==='elma'?'checked':''}> 엘/마</label>`;
    html+=`<label><input type="checkbox" id="ip-elite" ${_curCls==='elite'?'checked':''}> 엘리트</label>`;
    html+=`<label><input type="checkbox" id="ip-master" ${_curCls==='master'?'checked':''}> 마스터</label>`;
    if(typeof isBangteuk==='function'&&!isBangteuk()){
      const btMeta=getBtPreviewInst(key)||(cur&&(cur.btGroup||cur.btTabId||cur.bt||cur.bangteuk)?{group:cur.btGroup,tabId:cur.btTabId}:null);
      const btOptions=typeof getBangteukGroupOptions==='function'?getBangteukGroupOptions(btMeta?.tabId||cur?.btTabId||''):[];
      html+=`<div class="inst-bt-options" title="화면 테스트 전용: 새로고침하면 사라지고 저장되지 않습니다">`;
      html+=`<span class="inst-bt-title">방특반 테스트</span>`;
      if(btOptions.length){
        html+=`<label><input type="radio" name="ip-bt-preview-group" value="" ${btMeta?'':'checked'}> 해제</label>`;
        btOptions.forEach(opt=>{
          const checked=btMeta&&btMeta.group===opt.group?'checked':'';
          html+=`<label><input type="radio" name="ip-bt-preview-group" value="${esc(opt.group)}" ${checked}> ${esc(opt.label)} <small>${esc(opt.periodLabel)}</small></label>`;
        });
      } else {
        html+=`<span class="inst-bt-empty">방특 기간 설정 필요</span>`;
      }
      html+=`</div>`;
    }
    if(cur) html+=`<button class="inst-btn-clear" data-name="__clear__">선생님 삭제</button>`;
    html+=`</div>`;
    html+=`<div class="inst-tool-row">`;
    html+=`<button class="btn btn-o inst-tool-btn sort" id="ip-compact">빈칸 정렬</button>`;
    html+=`<button class="btn btn-o inst-tool-btn swap" id="ip-swap">↔ 위치 교환</button>`;
    html+=`</div>`;
  } else {
    html+=`<div style="padding:8px 2px 6px;font-size:11px;color:#6B7280;border-bottom:1px solid #E5E7EB">
      <b style="color:#111">${cur?esc(instDisplay(cur)):'담임 없음'}</b>
    </div>`;
  }

  // 예약 목록
  const reserves=getReserves(key);
  html+=`<div class="inst-reserve-list">`;
  html+=`<div style="font-weight:700;font-size:11px;margin-bottom:4px">대기자 (${reserves.length})</div>`;
  reserves.forEach((r,i)=>{
    const dateLabel=r.d?`<span style="font-size:9px;color:#0F9D58;margin-left:auto">${parseInt(r.d.split('-')[1])}/${parseInt(r.d.split('-')[2])}</span>`:'';
    const teacherLabel=r.teacher?`<span style="font-size:9px;color:#3B82F6;margin-left:4px">[${esc(r.teacher)}]</span>`:'';
    html+=`<div class="inst-reserve-item"><span class="rname">${esc(r.n)}</span><span class="rphone">${esc(r.p||'')}</span>${teacherLabel}${dateLabel}${canEdit?`<span class="rdel" data-rdel="${i}">✕</span>`:''}</div>`;
    if(r.m) html+=`<div style="font-size:9px;color:#888;padding-left:4px;margin-top:-2px;margin-bottom:2px">📝 ${esc(r.m)}</div>`;
  });
  if(canEdit){
    html+=`<div style="display:flex;gap:4px;margin-top:4px">`;
    const todayVal=toDateStr(getToday());
    html+=`<input class="fi" id="ip-rname" placeholder="이름" style="width:70px;margin:0;padding:3px 6px;font-size:11px">`;
    html+=`<input class="fi" id="ip-rphone" placeholder="전화번호" style="flex:1;margin:0;padding:3px 6px;font-size:11px">`;
    html+=`<label style="font-size:10px;font-weight:600;display:flex;align-items:center;gap:2px;white-space:nowrap"><input type="checkbox" id="ip-rtoday" checked> 오늘</label>`;
    html+=`<input class="fi" id="ip-rdate" type="date" value="${todayVal}" style="width:100px;margin:0;padding:3px 4px;font-size:10px;display:none">`;
    html+=`</div>`;
    html+=`<div style="display:flex;gap:4px;margin-top:3px;align-items:center">`;
    html+=`<input class="fi" id="ip-rmemo" placeholder="메모" style="flex:1;margin:0;padding:3px 6px;font-size:11px">`;
    html+=`</div>`;
    // 선생님 지정/무관
    const teacherOpts=TEACHERS.map(t=>`<option value="${esc(t.n)}">${esc(t.n)}</option>`).join('');
    html+=`<div style="display:flex;gap:4px;margin-top:3px;align-items:center">`;
    html+=`<label style="font-size:10px;font-weight:600;display:flex;align-items:center;gap:2px;white-space:nowrap"><input type="checkbox" id="ip-rany" checked> 무관</label>`;
    html+=`<select class="fi" id="ip-rteacher" style="flex:1;margin:0;padding:3px 4px;font-size:10px;display:none"><option value="">선생님 선택</option>${teacherOpts}</select>`;
    html+=`<button class="btn btn-p" id="ip-radd" style="padding:3px 8px;font-size:10px">대기 추가</button>`;
    html+=`</div>`;
  } else if(!reserves.length){
    html+=`<div style="font-size:10px;color:#9CA3AF;padding:4px 0">등록된 대기자가 없습니다</div>`;
  }
  html+=`</div>`;

  popup.innerHTML=html;
}

let _instBusy=false;

// 이벤트 위임 (팝업 내부)
document.getElementById('inst-popup').addEventListener('click',async function(e){
  // [스냅샷] 읽기 전용 — 닫기만 허용
  if(typeof isSnapshotTab==='function'&&isSnapshotTab()){
    if(e.target.closest('#ip-close')){ e.stopPropagation(); closeInstPopup(); return; }
    return;
  }
  if(!instPopupCanEdit()) return;
  const btOption=e.target.closest('.inst-bt-options label');
  const btInput=e.target.matches('input[name="ip-bt-preview-group"]')
    ? e.target
    : btOption?.querySelector('input[name="ip-bt-preview-group"]');
  if(btInput){
    e.stopPropagation();
    setTimeout(()=>_applyBtPreviewSelection(btInput),0);
    return;
  }
  // 예약 삭제
  const rdel=e.target.closest('[data-rdel]');
  if(rdel){
    e.stopPropagation();
    await removeReserve(_instPopup.key,parseInt(rdel.dataset.rdel));
    renderInstPopup();buildTable();
    return;
  }
  // 위치 교환
  if(e.target.closest('#ip-swap')){
    e.stopPropagation();
    startInstSwap();
    return;
  }
  // 빈칸 정렬
  if(e.target.closest('#ip-compact')){
    e.stopPropagation();
    await compactInstLaneRows();
    return;
  }
  // 무관 체크박스 토글 → 선생님 선택 표시/숨김
  if(e.target.closest('#ip-rany')){
    const sel=document.getElementById('ip-rteacher');
    if(sel) sel.style.display=document.getElementById('ip-rany').checked?'none':'';
    return;
  }
  // 예약 추가
  if(e.target.closest('#ip-radd')){
    e.stopPropagation();
    const n=document.getElementById('ip-rname')?.value.trim();
    if(!n){toast('이름을 입력하세요','err');return;}
    const p=document.getElementById('ip-rphone')?.value.trim()||'';
    const m=document.getElementById('ip-rmemo')?.value.trim()||'';
    const isToday=document.getElementById('ip-rtoday')?.checked;
    const d=isToday?toDateStr(getToday()):(document.getElementById('ip-rdate')?.value||toDateStr(getToday()));
    const isAny=document.getElementById('ip-rany')?.checked;
    const teacher=isAny?'':(document.getElementById('ip-rteacher')?.value||'');
    await addReserve(_instPopup.key,n,p,m,d,teacher);
    renderInstPopup();buildTable();
    setTimeout(()=>document.getElementById('ip-rname')?.focus(),50);
    return;
  }
  const btn=e.target.closest('.inst-btn,.inst-btn-clear');
  if(!btn) return;
  e.stopPropagation();

  const key=_instPopup.key;
  if(!key) return;
  const name=btn.dataset.name;

  try{
    await updateInstMapTx(inst=>{
      const cur=inst[key]||null;
      if(name==='__clear__'){
        delete inst[key];
      } else if(cur&&cur.n===name){
        delete inst[key];
      } else {
        // [v117] 선생님 변경 시 기존 cls(엘/마/엘리트/마스터) 보존
        const oldCls=getInstCls(cur);
        const obj={n:name};
        if(oldCls) obj.cls=oldCls;
        inst[key]=obj;
      }
      return inst;
    });
  }catch(err){
    toast(err?.message||'담임 저장 실패','err');
    console.error(err);
    return;
  }

  if(name==='__clear__'){
    closeInstPopup();
    buildTable();
    return;
  }
  _instBusy=true;
  buildTable();
  renderInstPopup();
  setTimeout(()=>{_instBusy=false;},50);
});

document.getElementById('inst-popup').addEventListener('keydown',function(e){
  if(!instPopupCanEdit()) return;
  if(e.key==='Enter'&&(e.target.id==='ip-rname'||e.target.id==='ip-rphone'||e.target.id==='ip-rmemo'||e.target.id==='ip-rdate')){
    e.preventDefault();
    document.getElementById('ip-radd')?.click();
  }
});

document.getElementById('inst-popup').addEventListener('change',async function(e){
  if(!instPopupCanEdit()) return;
  if(e.target.name==='ip-bt-preview-group'){
    _applyBtPreviewSelection(e.target);
    return;
  }
  if(e.target.id==='ip-rtoday'){
    const datePicker=document.getElementById('ip-rdate');
    if(datePicker){
      datePicker.style.display=e.target.checked?'none':'';
      if(e.target.checked) datePicker.value=toDateStr(getToday());
    }
    return;
  }
  if(!e.target.matches('#ip-lead,#ip-youth,#ip-elma,#ip-elite,#ip-master')) return;
  const key=_instPopup.key;
  if(!key||!INST_MAP[key]) return;
  const flag=e.target.id.replace('ip-','');
  const checked=e.target.checked;
  try{
    await updateInstMapTx(inst=>{
      if(!inst[key]) return inst;
      // [v117] elma/elite/master는 셋 중 하나만 (XOR). cls 필드로 통합 저장.
      if(flag==='elma'||flag==='elite'||flag==='master'){
        if(checked){
          inst[key].cls=flag;
          delete inst[key].elma; // 구버전 필드 제거 (마이그레이션)
        } else {
          // 같은 cls 해제 시에만 cls 제거
          if(inst[key].cls===flag) delete inst[key].cls;
          delete inst[key].elma;
        }
      } else {
        if(checked) inst[key][flag]=true;
        else delete inst[key][flag];
      }
      return inst;
    });
  }catch(err){
    toast(err?.message||'담임 저장 실패','err');
    console.error(err);
    if(e.target) e.target.checked=!checked;
    return;
  }
  _instBusy=true;
  buildTable();
  renderInstPopup();
  setTimeout(()=>{_instBusy=false;},50);
});

/* ──── 담임 위치 교환 모드 ──── */
let _instSwapMode=null; // {srcT, srcDay, srcLane, label}

function startInstSwap(){
  const {t,day,lane}=_instPopup;
  const inst=getInst(t,day,lane);
  const label=inst?instDisplay(inst):(t+'/'+day+'/'+lane+'레인');
  _instSwapMode={srcT:t, srcDay:day, srcLane:lane, label};
  closeInstPopup();
  document.getElementById('move-bar').style.display='flex';
  document.getElementById('move-msg').textContent=
    `↔ ${label} (${day} ${t} ${lane}레인) 위치 교환 — 목적지 담임 셀을 클릭하세요`;
  buildTable();
}

function cancelInstSwap(){
  _instSwapMode=null;
  document.getElementById('move-bar').style.display='none';
  buildTable();
}

function _instSwapMapKey(map,srcKey,dstKey){
  const src=map[srcKey], dst=map[dstKey];
  if(dst) map[srcKey]=dst; else delete map[srcKey];
  if(src) map[dstKey]=src; else delete map[dstKey];
}
function _instFindStudentIndex(students,t,day,lane,row){
  return students.findIndex(s=>s.t===t&&s.d===day&&parseInt(s.l)===parseInt(lane)&&parseInt(s.r)===parseInt(row));
}
function _instStudentAt(stu,t,day,lane){
  return {...stu,t,d:day,l:parseInt(lane)};
}
function _instSwapMarkKeys(marks,srcSK,dstSK){
  const srcMarks={}, dstMarks={};
  for(const mk of Object.keys(marks)){
    if(mk.startsWith(srcSK+'/')){srcMarks[mk.slice(srcSK.length+1)]=marks[mk];delete marks[mk];}
    else if(mk.startsWith(dstSK+'/')){dstMarks[mk.slice(dstSK.length+1)]=marks[mk];delete marks[mk];}
  }
  for(const [ds,v] of Object.entries(dstMarks)) marks[srcSK+'/'+ds]=v;
  for(const [ds,v] of Object.entries(srcMarks)) marks[dstSK+'/'+ds]=v;
}

function _instSlotKey(t,day,lane,row){
  return t+'/'+day+'/'+lane+'/'+row;
}

function _instSlotRowFromKey(key,t,day,lane){
  const p=String(key||'').split('/');
  if(p.length<4) return null;
  if(p[0]!==t||p[1]!==day||String(p[2])!==String(lane)) return null;
  const r=parseInt(p[3],10);
  return Number.isFinite(r)&&r>0?r:null;
}

function _instRequestRows(requests,t,day,lane){
  const rows=new Set();
  for(const req of Object.values(requests||{})){
    const target=req?.target||{};
    if(target.t===t&&target.d===day&&String(target.l)===String(lane)){
      const r=parseInt(target.r,10);
      if(Number.isFinite(r)&&r>0) rows.add(r);
    }
    const slotKeys=[
      req?.parent?.studentSlotKey,
      req?.parent?.sourceSlotKey,
      req?.parent?.previousSlotKey,
      req?.parent?.originalSlotKey,
      req?.sourceSlotKey,
    ].filter(Boolean);
    slotKeys.forEach(sk=>{
      const r=_instSlotRowFromKey(sk,t,day,lane);
      if(r) rows.add(r);
    });
  }
  return rows;
}

function _instCollectLaneRows({students,retire,enroll,disabled,marks,hyuwon,attendance,attGuests,requests},t,day,lane){
  const rows=new Set();
  (students||[]).forEach(s=>{
    if(s&&s.t===t&&s.d===day&&String(s.l)===String(lane)){
      const r=parseInt(s.r,10);
      if(Number.isFinite(r)&&r>0) rows.add(r);
    }
  });
  [retire,enroll,disabled,hyuwon].forEach(map=>{
    Object.keys(map||{}).forEach(k=>{
      const r=_instSlotRowFromKey(k,t,day,lane);
      if(r) rows.add(r);
    });
  });
  [marks,attendance].forEach(map=>{
    Object.keys(map||{}).forEach(k=>{
      const r=_instSlotRowFromKey(k,t,day,lane);
      if(r) rows.add(r);
    });
  });
  Object.entries(attGuests||{}).forEach(([,list])=>{
    (list||[]).forEach(g=>{
      const r=_instSlotRowFromKey(g?.slotKey,t,day,lane);
      if(r) rows.add(r);
    });
  });
  _instRequestRows(requests,t,day,lane).forEach(r=>rows.add(r));
  return rows;
}

function _instExtractPrefixMap(map,slotKey){
  const result={};
  const prefix=slotKey+'/';
  Object.keys(map||{}).forEach(k=>{
    if(k.startsWith(prefix)){
      result[k.slice(prefix.length)]=map[k];
      delete map[k];
    }
  });
  return result;
}

function _instWritePrefixMap(map,slotKey,entries){
  for(const [suffix,val] of Object.entries(entries||{})){
    map[slotKey+'/'+suffix]=val;
  }
}

function _instHasGuestSlotRow(attGuests,t,day,lane,row){
  const slotKey=_instSlotKey(t,day,lane,row);
  return Object.values(attGuests||{}).some(list=>(list||[]).some(g=>g&&g.slotKey===slotKey));
}

function _instReassignRequestSlotKey(req,oldKey,newKey){
  if(!req) return;
  if(req.parent){
    ['studentSlotKey','sourceSlotKey','previousSlotKey','originalSlotKey'].forEach(prop=>{
      if(req.parent[prop]===oldKey) req.parent[prop]=newKey;
    });
  }
  if(req.sourceSlotKey===oldKey) req.sourceSlotKey=newKey;
}

function _instReassignRequests(requests,t,day,lane,rowMap){
  for(const req of Object.values(requests||{})){
    const target=req?.target;
    if(target&&target.t===t&&target.d===day&&String(target.l)===String(lane)){
      const oldR=parseInt(target.r,10);
      const newR=rowMap[oldR];
      if(newR) target.r=newR;
    }
    for(const [oldR,newR] of Object.entries(rowMap)){
      const oldKey=_instSlotKey(t,day,lane,oldR);
      const newKey=_instSlotKey(t,day,lane,newR);
      _instReassignRequestSlotKey(req,oldKey,newKey);
    }
  }
}

function _instMoveGuestSlotKeys(attGuests,t,day,lane,rowMap){
  Object.entries(attGuests||{}).forEach(([,list])=>{
    (list||[]).forEach(g=>{
      const r=_instSlotRowFromKey(g?.slotKey,t,day,lane);
      if(r&&rowMap[r]) g.slotKey=_instSlotKey(t,day,lane,rowMap[r]);
    });
  });
}

async function compactInstLaneRows(){
  const {t,day,lane}= _instPopup||{};
  if(!t||!day||!lane) return;
  if(!confirm(`${day} ${t} ${lane}레인 빈칸을 위로 정렬할까요?\n학생, 뱃지, 결석/보강, 등록/제외 예약이 같이 이동합니다.`)) return;

  const stuKey=getTabConfig().stuKey;
  const attKey=typeof _attendanceStorageKey==='function'?_attendanceStorageKey('attendance'):STORAGE_KEYS.ATTENDANCE;
  const guestKey=typeof _attendanceStorageKey==='function'?_attendanceStorageKey('attGuests'):STORAGE_KEYS.ATT_GUESTS;
  const txKeys=[
    stuKey,
    STORAGE_KEYS.RETIRE,
    STORAGE_KEYS.ENROLL,
    STORAGE_KEYS.DISABLED,
    STORAGE_KEYS.MARK,
    STORAGE_KEYS.休원,
    STORAGE_KEYS.REQUESTS,
    attKey,
    guestKey,
  ];

  try{
    let moved=0;
    await updateScheduleTx(txKeys, ctx=>{
      const students=ctx.get(stuKey,[]);
      const retire=ctx.get(STORAGE_KEYS.RETIRE,{});
      const enroll=ctx.get(STORAGE_KEYS.ENROLL,{});
      const disabled=ctx.get(STORAGE_KEYS.DISABLED,{});
      const marks=ctx.get(STORAGE_KEYS.MARK,{});
      const hyuwon=ctx.get(STORAGE_KEYS.休원,{});
      const requests=ctx.get(STORAGE_KEYS.REQUESTS,{});
      const attendance=ctx.get(attKey,{});
      const attGuests=ctx.get(guestKey,{});
      const rowSet=_instCollectLaneRows({students,retire,enroll,disabled,marks,hyuwon,attendance,attGuests,requests},t,day,lane);
      const maxRow=Math.max(getTimeRows(t),0,...Array.from(rowSet));
      const rowData=[];
      for(let r=1;r<=maxRow;r++){
        const slotKey=_instSlotKey(t,day,lane,r);
        const stuIdx=students.findIndex(s=>s&&s.t===t&&s.d===day&&String(s.l)===String(lane)&&parseInt(s.r,10)===r);
        const data={
          row:r,
          stu:stuIdx>=0?JSON.parse(JSON.stringify(students[stuIdx])):null,
          retire:retire[slotKey],
          enroll:enroll[slotKey],
          disabled:disabled[slotKey],
          hyuwon:hyuwon[slotKey],
          marks:_instExtractPrefixMap(marks,slotKey),
          attendance:_instExtractPrefixMap(attendance,slotKey),
          hasGuest:_instHasGuestSlotRow(attGuests,t,day,lane,r),
        };
        if(stuIdx>=0) students.splice(stuIdx,1);
        delete retire[slotKey];
        delete enroll[slotKey];
        delete disabled[slotKey];
        delete hyuwon[slotKey];
        if(data.stu||data.retire||data.enroll||data.disabled||data.hyuwon||data.hasGuest||Object.keys(data.marks).length||Object.keys(data.attendance).length){
          rowData.push(data);
        }
      }
      const rowMap={};
      rowData.forEach((data,i)=>{
        const newRow=i+1;
        rowMap[data.row]=newRow;
        if(data.row!==newRow) moved++;
        const dstKey=_instSlotKey(t,day,lane,newRow);
        if(data.stu){
          data.stu.t=t; data.stu.d=day; data.stu.l=parseInt(lane,10); data.stu.r=newRow;
          students.push(data.stu);
        }
        if(data.retire!==undefined) retire[dstKey]=data.retire;
        if(data.enroll!==undefined) enroll[dstKey]=data.enroll;
        if(data.disabled!==undefined) disabled[dstKey]=data.disabled;
        if(data.hyuwon!==undefined) hyuwon[dstKey]=data.hyuwon;
        _instWritePrefixMap(marks,dstKey,data.marks);
        _instWritePrefixMap(attendance,dstKey,data.attendance);
      });
      _instMoveGuestSlotKeys(attGuests,t,day,lane,rowMap);
      _instReassignRequests(requests,t,day,lane,rowMap);

      ctx.set(stuKey,students);
      ctx.set(STORAGE_KEYS.RETIRE,retire);
      ctx.set(STORAGE_KEYS.ENROLL,enroll);
      ctx.set(STORAGE_KEYS.DISABLED,disabled);
      ctx.set(STORAGE_KEYS.MARK,marks);
      ctx.set(STORAGE_KEYS.休원,hyuwon);
      ctx.set(STORAGE_KEYS.REQUESTS,requests);
      ctx.set(attKey,attendance);
      ctx.set(guestKey,attGuests);
      return true;
    }, {type:'move', label:'반 빈칸 정렬', detail:`${t}/${day}/${lane}레인`});
    closeInstPopup();
    buildTable();
    toast(moved?`빈칸 정렬 완료 (${moved}칸 이동)`:'정렬할 빈칸이 없습니다','ok');
  }catch(err){
    toast(err?.message||'빈칸 정렬 실패','err');
    console.error(err);
  }
}

async function executeInstSwap(dstT,dstDay,dstLane){
  if(!_instSwapMode) return;
  const {srcT,srcDay,srcLane}=_instSwapMode;
  if(srcT===dstT&&srcDay===dstDay&&srcLane===dstLane){cancelInstSwap();return;}

  pushUndo();
  const maxRows=Math.max(getTimeRows(srcT),getTimeRows(dstT));
  const srcIK=srcT+'/'+srcDay+'/'+srcLane;
  const dstIK=dstT+'/'+dstDay+'/'+dstLane;
  try{
    const stuKey=getTabConfig().stuKey;
    const instKey=getTabConfig().instKey;
    await updateScheduleTx([stuKey,instKey,STORAGE_KEYS.RESERVE,STORAGE_KEYS.RETIRE,STORAGE_KEYS.ENROLL,STORAGE_KEYS.DISABLED,STORAGE_KEYS.MARK], ctx=>{
      const inst=ctx.get(instKey,{});
      const reserve=ctx.get(STORAGE_KEYS.RESERVE,{});
      const students=ctx.get(stuKey,[]);
      const retire=ctx.get(STORAGE_KEYS.RETIRE,{});
      const enroll=ctx.get(STORAGE_KEYS.ENROLL,{});
      const disabled=ctx.get(STORAGE_KEYS.DISABLED,{});
      const marks=ctx.get(STORAGE_KEYS.MARK,{});

      _instSwapMapKey(inst,srcIK,dstIK);
      _instSwapMapKey(reserve,srcIK,dstIK);

      for(let r=1;r<=maxRows;r++){
        const srcSK=srcT+'/'+srcDay+'/'+srcLane+'/'+r;
        const dstSK=dstT+'/'+dstDay+'/'+dstLane+'/'+r;
        const srcIdx=_instFindStudentIndex(students,srcT,srcDay,srcLane,r);
        const dstIdx=_instFindStudentIndex(students,dstT,dstDay,dstLane,r);
        if(srcIdx>=0&&dstIdx>=0){
          const srcStu=students[srcIdx], dstStu=students[dstIdx];
          students[srcIdx]=_instStudentAt(dstStu,srcT,srcDay,srcLane);
          students[dstIdx]=_instStudentAt(srcStu,dstT,dstDay,dstLane);
        } else if(srcIdx>=0){
          students[srcIdx]=_instStudentAt(students[srcIdx],dstT,dstDay,dstLane);
        } else if(dstIdx>=0){
          students[dstIdx]=_instStudentAt(students[dstIdx],srcT,srcDay,srcLane);
        }

        _instSwapMapKey(retire,srcSK,dstSK);
        _instSwapMapKey(enroll,srcSK,dstSK);
        _instSwapMapKey(disabled,srcSK,dstSK);
        _instSwapMarkKeys(marks,srcSK,dstSK);
      }

      ctx.set(instKey,inst);
      ctx.set(STORAGE_KEYS.RESERVE,reserve);
      ctx.set(stuKey,students);
      ctx.set(STORAGE_KEYS.RETIRE,retire);
      ctx.set(STORAGE_KEYS.ENROLL,enroll);
      ctx.set(STORAGE_KEYS.DISABLED,disabled);
      ctx.set(STORAGE_KEYS.MARK,marks);
      return true;
    });
    _instSwapMode=null;
    document.getElementById('move-bar').style.display='none';
    buildTable();
    toast('위치 교환 완료','ok');
  }catch(err){
    toast(err?.message||'위치 교환 실패','err');
    console.error(err);
  }
}

function closeInstPopup(){
  document.getElementById('inst-popup').classList.remove('show');
  _instPopup.key=null;
  if(_pendingSync){_pendingSync=false;reloadGlobalData();loadTabData();reloadBadgeMaps();buildTable();}
}

document.addEventListener('click',e=>{
  if(_instBusy) return;
  if(Date.now()-_tabFocusTime<300) return;
  const popup=document.getElementById('inst-popup');
  if(!popup.classList.contains('show')) return;
  if(popup.contains(e.target)) return;
  if(e.target.closest('.inst-clickable')) return;
  // [v95 #7] mousedown이 팝업 안에서 시작됐으면 닫지 않음 (드래그-아웃 보호)
  if(_mouseDownTarget && popup.contains(_mouseDownTarget)) return;
  closeInstPopup();
});
