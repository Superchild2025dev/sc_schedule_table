/* ════════════════════════════════════════════════════════════════
 * SECTION: 탭 시스템 (정규반/방특반)
 * ════════════════════════════════════════════════════════════════ */
let _activeTab='regular';

const _REG_BASE={
  days:['월','화','수','목','금','토'],
  times:[{t:'1시'},{t:'2시'},{t:'3시'},{t:'4시'},{t:'5시'},{t:'6시'},{t:'7시'},{t:'8시'}],
  lanes:5, hasNum:['월','토'],
  satTimeLabel:{'1시':'9시','2시':'10시','3시':'11시','4시':'12시','5시':'13시','6시':'14시'},
};
function getTabConfig(){
  const tab=_tabList.find(t=>t.id===_activeTab);
  if(!tab||tab.type==='regular'){
    const isDefault=(!tab||tab.id==='regular');
    return {
      ..._REG_BASE,
      stuKey:isDefault?'swim_students':'swim_stu_'+tab.id,
      instKey:isDefault?'swim_inst':'swim_inst_'+tab.id,
    };
  }
  if(tab.type==='bangteuk'){
    return {
      days:['월수금','화목'], times:[{t:'10시'},{t:'11시'}], lanes:5,
      hasNum:['월수금'], satTimeLabel:{},
      stuKey:'swim_bt_'+tab.id+'_stu', instKey:'swim_bt_'+tab.id+'_inst',
    };
  }
  return {..._REG_BASE, stuKey:'swim_students', instKey:'swim_inst'};
}
function isBangteuk(){ return _tabList.find(t=>t.id===_activeTab)?.type==='bangteuk'; }
function isSnapshotTab(){ return _tabList.find(t=>t.id===_activeTab)?.type==='snapshot'; }
function getSnapshotCapturedAt(){
  const tab=_tabList.find(t=>t.id===_activeTab);
  return tab&&tab.type==='snapshot'?tab.capturedAt:null;
}

/* ──── 탭 목록 관리 ──── */
let _tabList = loadJSON(STORAGE_KEYS.TAB_LIST, []);
if(!_tabList.length) _tabList=[{id:'regular',name:'정규시간표',type:'regular'}];
function saveTabList(){ saveJSON(STORAGE_KEYS.TAB_LIST, _tabList, true); }

/* ──── 스냅샷: 전체 상태 동결 ────
   클릭 시 현재 탭의 모든 데이터(학생/담임/출석/결석/등원/퇴원/휴원/이동/예약/스냅샷맵)를
   캡처해 새 탭으로 만든다. 스냅샷 탭 활성화 시 전역 맵을 백업 후 스냅샷 데이터로 교체.
   모든 변경(저장)은 saveJSON 가드로 차단된다. */
let _origGlobalMaps=null; // 스냅샷 진입 시 백업, 떠날 때 복원
const SNAP_KEY_PREFIX='swim_snap_';

function createSnapshot(srcId){
  const srcTab=_tabList.find(t=>t.id===srcId);
  if(!srcTab) return;
  if(srcTab.type==='snapshot'){toast('스냅샷의 스냅샷은 만들 수 없음','err');return;}
  const today=toDateStr(getToday());
  const name=prompt('스냅샷 이름:', srcTab.name+' ('+today+')');
  if(!name) return;
  const newId='snap_'+Date.now();
  // 현재 탭 데이터(STUDENTS/INST_MAP은 이미 활성 탭의 것)와 전역 맵을 deep clone
  const snapData={
    students:JSON.parse(JSON.stringify(STUDENTS||[])),
    inst:JSON.parse(JSON.stringify(INST_MAP||{})),
    retire:JSON.parse(JSON.stringify(RETIRE_MAP||{})),
    enroll:JSON.parse(JSON.stringify(ENROLL_MAP||{})),
    mark:JSON.parse(JSON.stringify(MARK_MAP||{})),
    disabled:JSON.parse(JSON.stringify(DISABLED_MAP||{})),
    reserve:JSON.parse(JSON.stringify(RESERVE_MAP||{})),
    hyuwon:JSON.parse(JSON.stringify(HYUWON_MAP||{})),
    move:JSON.parse(JSON.stringify(MOVE_MAP||{})),
    attendance:JSON.parse(JSON.stringify(ATTENDANCE||{})),
    attGuests:JSON.parse(JSON.stringify(ATT_GUESTS||{})),
    daySnapshot:JSON.parse(JSON.stringify(DAY_SNAPSHOT||{})),
    capturedAt:today,
    sourceTabId:srcId,
    sourceTabType:srcTab.type,
    sourceTabName:srcTab.name,
  };
  // 직접 dbSet (saveJSON 가드 통과 위해)
  dbSet(SNAP_KEY_PREFIX+newId, JSON.stringify(snapData));
  // 탭 목록에 추가 (원본 바로 뒤)
  const srcIdx=_tabList.findIndex(t=>t.id===srcId);
  _tabList.splice(srcIdx+1,0,{id:newId,name,type:'snapshot',capturedAt:today});
  // tab-list만 별도로 저장 (saveTabList는 skipUndo로 직접 저장)
  saveTabList();
  _activeTab=newId;
  switchTabView();
  toast('📷 스냅샷 생성: '+name,'ok');
}

function copyTab(srcId){
  const srcTab=_tabList.find(t=>t.id===srcId);
  if(!srcTab) return;
  const name=prompt('복사할 탭 이름:', srcTab.name+' (사본)');
  if(!name) return;
  const newId=(srcTab.type==='bangteuk'?'bt':'reg')+'_'+Date.now();

  // 원본 탭의 저장 키 계산
  let srcStuKey, srcInstKey;
  if(srcTab.type==='bangteuk'){
    srcStuKey='swim_bt_'+srcId+'_stu';
    srcInstKey='swim_bt_'+srcId+'_inst';
  } else {
    srcStuKey=srcId==='regular'?'swim_students':'swim_stu_'+srcId;
    srcInstKey=srcId==='regular'?'swim_inst':'swim_inst_'+srcId;
  }

  // 새 탭의 저장 키 계산
  let newStuKey, newInstKey;
  if(srcTab.type==='bangteuk'){
    newStuKey='swim_bt_'+newId+'_stu';
    newInstKey='swim_bt_'+newId+'_inst';
  } else {
    newStuKey='swim_stu_'+newId;
    newInstKey='swim_inst_'+newId;
  }

  // 데이터 복사
  const stuData=loadJSON(srcStuKey, []);
  const instData=loadJSON(srcInstKey, {});
  saveJSON(newStuKey, JSON.parse(JSON.stringify(stuData)), true);
  saveJSON(newInstKey, JSON.parse(JSON.stringify(instData)), true);

  // 탭 목록에 추가 (원본 바로 뒤에 삽입)
  const srcIdx=_tabList.findIndex(t=>t.id===srcId);
  _tabList.splice(srcIdx+1, 0, {id:newId, name, type:srcTab.type});
  saveTabList();
  _activeTab=newId;
  switchTabView();
  toast(srcTab.name+' 복사 완료','ok');
}

function renderTabBar(){
  const bar=document.getElementById('tab-bar');
  let html='';
  _tabList.forEach((tab,i)=>{
    const isSnap=tab.type==='snapshot';
    const baseCls=isSnap?'tab-btn tab-snapshot':'tab-btn';
    const cls=tab.id===_activeTab?baseCls+' active':baseCls;
    const arrows=_tabList.length>1?`<span class="tab-arrows">${i>0?`<span data-tab-left="${tab.id}">◀</span>`:''}${i<_tabList.length-1?`<span data-tab-right="${tab.id}">▶</span>`:''}</span>`:'';
    // 이름 변경 ✎ 버튼 (모든 탭에 표시)
    const renameBtn=`<span class="tab-close" data-tab-rename-btn="${tab.id}" title="이름 변경 (또는 더블클릭)" style="opacity:.4;margin-left:2px">✎</span>`;
    // 스냅샷은 "복사" 대신 보호 아이콘. 일반 탭은 복사+스냅샷 두 버튼.
    const actions=isSnap
      ? `<span class="tab-snap-icon" title="📷 스냅샷 (읽기 전용 · ${tab.capturedAt||''})" style="margin-left:2px">📷</span>`
      : `<span class="tab-close" data-tab-copy="${tab.id}" title="탭 복사" style="opacity:.3;margin-left:2px">⧉</span>`
       +`<span class="tab-close" data-tab-snap="${tab.id}" title="📷 스냅샷 만들기" style="opacity:.5;margin-left:2px">📷</span>`;
    const close=tab.id!=='regular'?`<span class="tab-close" data-tab-del="${tab.id}">✕</span>`:'';
    const labelTitle=isSnap?` title="📷 ${tab.capturedAt||''} 스냅샷 — 읽기 전용"`:'';
    html+=`<button class="${cls}" data-tab="${tab.id}"${labelTitle}><span data-tab-rename="${tab.id}">${isSnap?'📷 ':''}${tab.name}</span>${arrows}${renameBtn}${actions}${close}</button>`;
  });
  html+=`<button class="tab-add" data-tab-add title="새 탭 추가">＋</button>`;
  bar.innerHTML=html;
}

document.getElementById('tab-bar').addEventListener('click',function(e){
  // 탭 삭제
  const del=e.target.closest('[data-tab-del]');
  if(del){
    if(!confirm('이 탭을 삭제하시겠습니까?')) return;
    const id=del.dataset.tabDel;
    const tab=_tabList.find(t=>t.id===id);
    // 탭 타입에 맞는 저장 키로 삭제 (탭 제거 전에 조회)
    if(tab&&tab.type==='snapshot'){
      dbRemove(SNAP_KEY_PREFIX+id);
      // 스냅샷 탭에서 떠날 때 메모리 백업도 정리
      if(_activeTab===id) _origGlobalMaps=null;
    } else if(tab&&tab.type==='bangteuk'){
      dbRemove('swim_bt_'+id+'_stu');
      dbRemove('swim_bt_'+id+'_inst');
    } else if(tab){
      dbRemove('swim_stu_'+id);
      dbRemove('swim_inst_'+id);
    }
    _tabList=_tabList.filter(t=>t.id!==id);
    saveTabList();
    if(_activeTab===id){_activeTab='regular';}
    switchTabView();
    return;
  }
  // 탭 복사
  const copy=e.target.closest('[data-tab-copy]');
  if(copy){
    const srcId=copy.dataset.tabCopy;
    copyTab(srcId);
    return;
  }
  // 📷 스냅샷 만들기
  const snap=e.target.closest('[data-tab-snap]');
  if(snap){
    e.stopPropagation();
    const srcId=snap.dataset.tabSnap;
    createSnapshot(srcId);
    return;
  }
  // ✎ 탭 이름 변경 (버튼 클릭)
  const renameBtn=e.target.closest('[data-tab-rename-btn]');
  if(renameBtn){
    e.stopPropagation();
    const id=renameBtn.dataset.tabRenameBtn;
    const tab=_tabList.find(t=>t.id===id);
    if(!tab) return;
    const name=prompt('탭 이름:', tab.name);
    if(name&&name.trim()){
      tab.name=name.trim();
      saveTabList();
      renderTabBar();
      toast('탭 이름 변경: '+tab.name,'ok');
    }
    return;
  }
  // 탭 순서 이동
  const left=e.target.closest('[data-tab-left]');
  if(left){
    const id=left.dataset.tabLeft;
    const i=_tabList.findIndex(t=>t.id===id);
    if(i>0){[_tabList[i-1],_tabList[i]]=[_tabList[i],_tabList[i-1]];saveTabList();renderTabBar();}
    return;
  }
  const right=e.target.closest('[data-tab-right]');
  if(right){
    const id=right.dataset.tabRight;
    const i=_tabList.findIndex(t=>t.id===id);
    if(i<_tabList.length-1){[_tabList[i],_tabList[i+1]]=[_tabList[i+1],_tabList[i]];saveTabList();renderTabBar();}
    return;
  }
  // 탭 추가 → 모달 열기
  if(e.target.closest('[data-tab-add]')){
    document.getElementById('tab-modal').classList.add('show');
    return;
  }
  // 탭 전환
  const btn=e.target.closest('[data-tab]');
  if(!btn) return;
  const tab=btn.dataset.tab;
  if(tab===_activeTab) return;
  closeStuPopup();closeInstPopup();
  _activeTab=tab;
  switchTabView();
});

// 탭 이름 편집 (더블클릭)
document.getElementById('tab-bar').addEventListener('dblclick',function(e){
  const rename=e.target.closest('[data-tab-rename]');
  if(!rename) return;
  const id=rename.dataset.tabRename;
  const tab=_tabList.find(t=>t.id===id);
  if(!tab) return;
  const name=prompt('탭 이름:',tab.name);
  if(name&&name.trim()){tab.name=name.trim();saveTabList();renderTabBar();}
});

// 탭 타입 선택 모달
document.getElementById('tab-modal').addEventListener('click',function(e){
  const btn=e.target.closest('[data-new-type]');
  if(!btn) return;
  const type=btn.dataset.newType;
  document.getElementById('tab-modal').classList.remove('show');
  const isReg=type==='regular';
  const name=prompt('탭 이름:',isReg?'정규시간표':'방특시간표');
  if(!name) return;
  const id=(isReg?'reg':'bt')+'_'+Date.now();
  _tabList.push({id,name,type});
  saveTabList();
  _activeTab=id;
  switchTabView();
});

function switchTabView(){
  // 이전 탭이 스냅샷이었다면 전역 맵을 백업본으로 복원
  if(_origGlobalMaps){
    RETIRE_MAP=_origGlobalMaps.retire;
    ENROLL_MAP=_origGlobalMaps.enroll;
    MARK_MAP=_origGlobalMaps.mark;
    DISABLED_MAP=_origGlobalMaps.disabled;
    RESERVE_MAP=_origGlobalMaps.reserve;
    HYUWON_MAP=_origGlobalMaps.hyuwon;
    MOVE_MAP=_origGlobalMaps.move;
    ATTENDANCE=_origGlobalMaps.attendance;
    ATT_GUESTS=_origGlobalMaps.attGuests;
    DAY_SNAPSHOT=_origGlobalMaps.daySnapshot;
    _origGlobalMaps=null;
  }

  const tab=_tabList.find(t=>t.id===_activeTab)||_tabList[0];
  _activeTab=tab.id;

  // body 클래스 토글로 스냅샷 시각 표시 on/off
  const isSnap=tab.type==='snapshot';
  document.body.classList.toggle('is-snapshot', isSnap);
  if(isSnap){
    const banner=document.getElementById('snap-banner');
    if(banner) banner.textContent='📷 ' + (tab.capturedAt||'') + ' 스냅샷 — 읽기 전용 (캡처 시점 그대로 고정)';
  }

  if(tab.type==='snapshot'){
    const snapData=loadJSON(SNAP_KEY_PREFIX+tab.id, null);
    if(!snapData){
      toast('스냅샷 데이터 없음 — 정규 탭으로 복귀','err');
      _activeTab='regular';
      switchTabView();
      return;
    }
    // 백업
    _origGlobalMaps={
      retire:RETIRE_MAP, enroll:ENROLL_MAP, mark:MARK_MAP,
      disabled:DISABLED_MAP, reserve:RESERVE_MAP, hyuwon:HYUWON_MAP,
      move:MOVE_MAP, attendance:ATTENDANCE, attGuests:ATT_GUESTS,
      daySnapshot:DAY_SNAPSHOT,
    };
    // 스냅샷 데이터 주입 (deep clone — 메모리 변경이 원본에 새지 않게)
    STUDENTS=JSON.parse(JSON.stringify(snapData.students||[]));
    INST_MAP=JSON.parse(JSON.stringify(snapData.inst||{}));
    RETIRE_MAP=JSON.parse(JSON.stringify(snapData.retire||{}));
    ENROLL_MAP=JSON.parse(JSON.stringify(snapData.enroll||{}));
    MARK_MAP=JSON.parse(JSON.stringify(snapData.mark||{}));
    DISABLED_MAP=JSON.parse(JSON.stringify(snapData.disabled||{}));
    RESERVE_MAP=JSON.parse(JSON.stringify(snapData.reserve||{}));
    HYUWON_MAP=JSON.parse(JSON.stringify(snapData.hyuwon||{}));
    MOVE_MAP=JSON.parse(JSON.stringify(snapData.move||{}));
    ATTENDANCE=JSON.parse(JSON.stringify(snapData.attendance||{}));
    ATT_GUESTS=JSON.parse(JSON.stringify(snapData.attGuests||{}));
    DAY_SNAPSHOT=JSON.parse(JSON.stringify(snapData.daySnapshot||{}));
    rebuildStuIdx();
    buildTable();
    renderTabBar();
    return;
  }

  loadTabData();
  buildTable();
  renderTabBar();
}
/* ──── [v118] 시간표 자체 줌 (CSS 변수 기반) ──── */
const TBL_ZOOM_KEY='tbl_zoom';
const TBL_ZOOM_MIN=0.6, TBL_ZOOM_MAX=1.5, TBL_ZOOM_STEP=0.05;
function getTableZoom(){
  try{ const v=parseFloat(localStorage.getItem(TBL_ZOOM_KEY)); return isFinite(v)&&v>0?v:1; }catch(e){ return 1; }
}
function setTableZoom(scale){
  scale=Math.min(TBL_ZOOM_MAX, Math.max(TBL_ZOOM_MIN, Math.round(scale*100)/100));
  document.documentElement.style.setProperty('--tbl-scale', scale);
  try{ localStorage.setItem(TBL_ZOOM_KEY, String(scale)); }catch(e){}
  const lbl=document.getElementById('tbl-zoom-pct');
  if(lbl) lbl.textContent=Math.round(scale*100)+'%';
  // [잔상/보더 fix] 셀 너비는 CSS 변수로 즉시 갱신되지만,
  //   table-layout:fixed의 컬럼 보더 위치는 캐시 → 강제 재빌드로 보더도 새 위치
  if(typeof STUDENTS !== 'undefined' && STUDENTS && STUDENTS.length && typeof buildTable === 'function'){
    buildTable();
  } else {
    // 페이지 첫 로드 시엔 reflow trick만 (buildTable 호출 시점 아님)
    const tbl=document.querySelector('.sched-tbl');
    if(tbl){
      tbl.style.tableLayout='auto';
      void tbl.offsetHeight;
      tbl.style.tableLayout='fixed';
    }
  }
}
function tblZoomIn(){ setTableZoom(getTableZoom()+TBL_ZOOM_STEP); }
function tblZoomOut(){ setTableZoom(getTableZoom()-TBL_ZOOM_STEP); }
function tblZoomReset(){ setTableZoom(1); }
// 페이지 로드 시 저장된 줌 적용
document.addEventListener('DOMContentLoaded',()=>{ setTableZoom(getTableZoom()); });

function setTimeMachine(val){
  if(!val){resetTimeMachine();return;}
  _fakeDate = val+'T12:00:00';
  document.getElementById('tm-reset').style.display='inline-flex';
  document.getElementById('tm-date').style.border='2px solid #FCD34D';
  document.body.classList.add('is-timemachine');
  buildTable();
  toast('🕐 타임머신: '+val+' (읽기 전용)','ok');
}
function resetTimeMachine(){
  _fakeDate=null;
  document.getElementById('tm-date').value='';
  document.getElementById('tm-reset').style.display='none';
  document.getElementById('tm-date').style.border='';
  document.body.classList.remove('is-timemachine');
  buildTable();
  toast('현재 시간으로 복원','ok');
}


/* 기본 데이터(_DEFAULT_STU, _DEFAULT_INST)는 파일 하단 「DEFAULTS」 섹션 참고 */

