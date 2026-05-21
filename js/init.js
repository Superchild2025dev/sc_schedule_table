/* ════════════════════════════════════════════════════════════════
 * SECTION: 초기 로드 (Firebase fetch → loadTabData → buildTable)
 * ════════════════════════════════════════════════════════════════ */
function startScheduleApp(){
  // [지점] 선택 안 됐으면 모달만 띄우고 init 중단
  if(!_selectedBranch){
    const m=document.getElementById('branch-modal');
    if(m) m.classList.add('show');
    return;
  }

  // 헤더 타이틀에 지점명 반영
  const b=getBranchInfo();
  if(b){
    const h1Brand=document.getElementById('app-brand');
    if(h1Brand) h1Brand.textContent='🏊 '+(b.id==='yongam'?'용암':'가경')+' 수영장';
  }

  loadFromFirebase(function(){
    // [CRITICAL FIX] Firebase에서 받은 데이터로 모든 메모리 변수 재로드
    // (이전엔 STUDENTS/INST_MAP/TEACHERS만 재로드되고 뱃지/탭/기간/휴원일은 빈 초기값 유지 →
    //  사용자가 뭐든 저장하면 빈 데이터가 Firebase로 push되어 데이터 손실 발생)
    reloadBadgeMaps();    // RETIRE/ENROLL/MARK/DISABLED/RESERVE/HYUWON
    reloadGlobalData();   // SCHEDULE_PERIODS/closedList/TEACHERS/_tabList
    loadTabData();        // STUDENTS/INST_MAP
    const render=()=>{
      renderTabBar();
      buildTable();
      if(window.SCAuth && typeof SCAuth.applyPagePermissions==='function'){
        SCAuth.applyPagePermissions(document);
      }
      runSettingsActionFromUrl();
    };
    if(typeof applyAnnualAgeIncrement==='function'){
      applyAnnualAgeIncrement()
        .then(changed=>{
          if(changed){
            loadTabData();
            toast('새해 나이 +1 반영 완료','ok');
          }
        })
        .catch(err=>{
          if(String(err&&err.message||err).includes('permission_denied')){
            console.warn('나이 자동 증가 건너뜀:',err);
            return;
          }
          console.error('나이 자동 증가 실패:',err);
          toast(err?.message||'나이 자동 증가 실패','err');
        })
        .finally(render);
    } else {
      render();
    }
  });
}

function resetAllScheduleData(){
  if(window.SCAuth && !SCAuth.requirePermission('resetData','초기화')) return;
  if(!confirm('모든 데이터를 초기 상태로 되돌립니다. 계속?')) return;
  Object.keys(_dbCache).forEach(k=>dbRemove(k));
  try{localStorage.clear();}catch(e){}
  if(_fbReady)_fb.remove();
  location.reload();
}

function runSettingsActionFromUrl(){
  let action='';
  try{
    const params=new URLSearchParams(location.search);
    action=params.get('settings')||'';
  }catch(e){}
  if(!action) return;
  const openers={
    records:()=>openRecordManagerModal(),
    teachers:()=>openTeacherModal(),
    periods:()=>openPeriodModal(),
    closed:()=>openClosedModal(),
    export:()=>exportExcel(),
    print:()=>window.print(),
    reset:()=>resetAllScheduleData(),
  };
  const fn=openers[action];
  try{history.replaceState(null,'',location.pathname+(location.hash||''));}catch(e){}
  if(typeof fn==='function') setTimeout(fn,80);
}

document.addEventListener('DOMContentLoaded', () => {
  const authReady = window.SCAuth && typeof SCAuth.requireAuth === 'function'
    ? SCAuth.requireAuth()
    : Promise.resolve();
  authReady.then(startScheduleApp);
});

// [지점] 선택/변경 함수 (모달 → localStorage → reload)
function selectBranch(branch){
  if(branch!=='gagyeong' && branch!=='yongam') return;
  try{localStorage.setItem(SELECTED_BRANCH_KEY, branch);}catch(e){}
  location.reload();
}
function openBranchModal(){
  const m=document.getElementById('branch-modal');
  if(m) m.classList.add('show');
}
