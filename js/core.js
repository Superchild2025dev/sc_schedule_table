/* ══════════════════════════════════════════
   Firebase 설정 - 아래 값을 본인 프로젝트로 교체!
   Firebase Console → 프로젝트 설정 → 웹앱 추가 → config 복사
   ══════════════════════════════════════════ */
const FIREBASE_CONFIG = window.SC_FIREBASE_CONFIG || {
  apiKey: "AIzaSyArHQQfHnVreH8gVamyl1e5IqUDfXUJ5F8",
  authDomain: "scswimming-schedule.firebaseapp.com",
  databaseURL: "https://scswimming-schedule-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "scswimming-schedule",
  storageBucket: "scswimming-schedule.firebasestorage.app",
  messagingSenderId: "45509278949",
  appId: "1:45509278949:web:f16989a9c416f06e25e80c"
};

/* ════════════════════════════════════════════════════════════════
 * SECTION: 지점(브랜치) 선택 — 가경점 vs 용암점
 *  - 가경점: Firebase path 'schedule' (기존 데이터 유지)
 *  - 용암점: Firebase path 'schedule_yongam' (빈 상태로 시작)
 *  - localStorage 키도 'yongam_' prefix로 분리 → 같은 브라우저에서 충돌 X
 * ════════════════════════════════════════════════════════════════ */
const SELECTED_BRANCH_KEY='selected_branch';
let _selectedBranch=null;
try{ _selectedBranch=localStorage.getItem(SELECTED_BRANCH_KEY); }catch(e){}
function getBranchInfo(){
  if(_selectedBranch==='yongam') return {id:'yongam', name:'용암점', fbPath:'schedule_yongam', lsPrefix:'yongam_'};
  if(_selectedBranch==='gagyeong') return {id:'gagyeong', name:'가경점', fbPath:'schedule', lsPrefix:''};
  return null;
}
function _lsKey(key){
  const b=getBranchInfo();
  return b ? b.lsPrefix+key : key;
}

/* ════════════════════════════════════════════════════════════════
 * SECTION: 데이터 저장소 (Firebase + localStorage + 메모리 캐시)
 * ════════════════════════════════════════════════════════════════ */
let _fb=null;
let _fbReady=false;
let _fbConnected=true;
let _offlineWarningShown=false;
const _dbCache={};

function initFirebaseStore(){
  if(_fbReady) return true;
  // 지점 선택 안 됐으면 Firebase 초기화 안 함 (모달이 열림 → 사용자 선택 후 reload)
  if(!_selectedBranch || !FIREBASE_CONFIG.apiKey) return false;
  try{
    if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    _fb=window.SCFirebaseStore
      ? SCFirebaseStore.createBranchRef(getBranchInfo())
      : firebase.database().ref(getBranchInfo().fbPath);
    _fbReady=true;
    console.log('✅ Firebase 연결됨');
    // 실시간 연결 상태 모니터링 (5초 이상 끊겼을 때만 경고)
    let _disconnectTimer=null;
    if(!window.SCFirebaseStore || !SCFirebaseStore.useFirestore()){
      firebase.database().ref('.info/connected').on('value',snap=>{
        _fbConnected=!!snap.val();
        if(_fbConnected){
          console.log('🟢 Firebase 온라인');
          if(_disconnectTimer){clearTimeout(_disconnectTimer);_disconnectTimer=null;}
          _hideOfflineWarning();
        } else {
          console.warn('🔴 Firebase 일시적 끊김 (5초 후 확인)');
          if(_disconnectTimer) clearTimeout(_disconnectTimer);
          _disconnectTimer=setTimeout(()=>{
            if(!_fbConnected){
              console.error('🔴 Firebase 5초 이상 끊김 — 경고 표시');
              _showOfflineWarning();
            }
          },5000);
        }
      });
    }
  }catch(e){
    console.warn('Firebase 초기화 실패:',e);
    _fbReady=false;
    setTimeout(()=>{toast('Firebase 연결 실패 — 오프라인 모드','err');_showOfflineWarning();},500);
  }
  return _fbReady;
}

// Auth 가드가 없는 환경에서는 기존처럼 즉시 초기화하고, 직원 페이지에서는 로그인 후 초기화한다.
if(!window.SCAuth){
  initFirebaseStore();
}

function dbSet(key,val){
  const json=typeof val==='string'?val:JSON.stringify(val);
  _dbCache[key]=json;
  try{localStorage.setItem(_lsKey(key),json);}catch(e){}
  if(_fbReady){
    // Firebase SDK가 자체 큐잉을 지원 — _fbConnected 무관하게 시도
    // (오프라인이면 SDK가 큐에 쌓아뒀다가 재연결시 자동 push)
    const sk=key.replace(/[.#$/\[\]]/g,'_');
    (_localWriteQueue[sk]=_localWriteQueue[sk]||[]).push(json);
    _fb.child(sk).set(json).catch(e=>{
      console.error('[FB SAVE FAIL]',key,e);
      _showOfflineWarning();
    });
  }
}

function _showOfflineWarning(){
  if(_offlineWarningShown) return;
  _offlineWarningShown=true;
  // 화면 상단 빨간 배너
  let banner=document.getElementById('fb-offline-banner');
  if(!banner){
    banner=document.createElement('div');
    banner.id='fb-offline-banner';
    banner.style.cssText='position:fixed;top:0;left:0;right:0;background:#DC2626;color:#fff;text-align:center;padding:8px;font-weight:700;font-size:14px;z-index:99999;box-shadow:0 2px 8px rgba(0,0,0,0.3)';
    banner.innerHTML='⚠️ Firebase 연결 끊김 — 변경사항이 다른 기기에 동기화되지 않습니다! 인터넷 확인 후 새로고침';
    document.body.appendChild(banner);
  }
}
function _hideOfflineWarning(){
  _offlineWarningShown=false;
  const banner=document.getElementById('fb-offline-banner');
  if(banner) banner.remove();
}
function dbGet(key){
  if(_dbCache[key]) return _dbCache[key];
  try{return localStorage.getItem(_lsKey(key));}catch(e){return null;}
}
function dbRemove(key){
  delete _dbCache[key];
  try{localStorage.removeItem(_lsKey(key));}catch(e){}
  if(_fbReady) _fb.child(key.replace(/[.#$/\[\]]/g,'_')).remove();
}

// [FIX] 자기 echo 식별용 큐. key별로 보낸 순서대로 쌓고, echo가 head와 일치하면 shift.
const _localWriteQueue={};

/* 팝업이 열려있는지 (rebuild 보류 판정용) */
function _popupOpen(){
  return document.getElementById('stu-popup').classList.contains('show')
      || document.getElementById('inst-popup').classList.contains('show');
}

/* ══════════════════════════════════════════
   저장 키 (한 곳에서 관리)
   ══════════════════════════════════════════ */
const STORAGE_KEYS = {
  STUDENTS: 'swim_students',     // 탭별 학생 (cfg.stuKey로 동적 사용)
  INST:     'swim_inst',         // 탭별 담임 (cfg.instKey로 동적 사용)
  RETIRE:   'swim_retire',
  ENROLL:   'swim_enroll',
  MARK:     'swim_mark',
  DISABLED: 'swim_disabled',
  RESERVE:  'swim_reserve',
  休원:     'swim_hyuwon',
  MOVE:     'swim_move',
  REQUESTS: 'swim_requests',   // 학부모 요청 (보강/결석취소)
  ATTENDANCE: 'swim_attendance', // 출석 (slotKey/date → 'present'|'absent')
  ATT_GUESTS: 'swim_att_guests', // 출석 게스트 (slotKey/date → [{gid,n,a,p,s,at,by}])
  DAY_SNAPSHOT: 'swim_day_snapshot', // 날짜별 학생/담임 스냅샷 (date → {students, inst})
  CLOSED:   'swim_closed',
  TAB_LIST: 'swim_tab_list',
  TAB_FOLDERS: 'swim_tab_folders',
  TEACHERS: 'swim_teachers',     // [v115] 선생님 목록 (이름+색)
  PERIODS:  'swim_periods',     // 수업 기간 목록
  RETIRE_HISTORY: 'swim_retire_history', // [v118] 퇴원 기록 보관 (영구)
  AUDIT_LOG: 'swim_audit_log',   // 기록관리: 이동/편집 로그
  RESTORE_POINTS: 'swim_restore_points', // 기록관리: 특정 시점 복구 포인트
  AGE_YEAR: 'swim_age_year',     // 학생 나이 자동 증가 마지막 반영 연도
  VERSION:  'swim_ver',
};

/* JSON 로드/저장 헬퍼 (try/catch + Undo 푸시 통합) */
function loadJSON(key, defaultVal){
  try{
    const r = dbGet(key);
    return r ? JSON.parse(r) : (defaultVal!==undefined ? defaultVal : null);
  }catch(e){
    return defaultVal!==undefined ? defaultVal : null;
  }
}
// [v98] 데이터 안전 가드
//  1) Firebase 로드 완료 전엔 어떤 저장도 차단 (init 중 빈 데이터 덮어쓰기 방지)
//  2) saveStudents가 갑자기 비거나 급감하면 차단 (자동 데이터 손실 방지)
let _firebaseLoaded=false;
let _lastSaveStuCount={}; // tabKey → 마지막 안전 학생 수

// [스냅샷/타임머신] 읽기 전용 보호용 (반복 토스트 억제)
let _snapshotWarnedAt=0;
let _timeMachineWarnedAt=0;

function saveJSON(key, val, skipUndo){
  // [v98 SAFETY] Firebase 로드 전 저장 차단
  if(!_firebaseLoaded){
    console.warn('[v98 SAFETY] Firebase 로드 전 saveJSON 차단:', key);
    return;
  }
  // [스냅샷] 스냅샷 탭에서는 일반 저장 차단. 단 탭 목록 / 스냅샷 자체 키는 허용.
  if(typeof isSnapshotTab==='function' && isSnapshotTab()
     && key!==STORAGE_KEYS.TAB_LIST && !key.startsWith('swim_snap_')){
    const now=Date.now();
    if(now-_snapshotWarnedAt>2000){
      _snapshotWarnedAt=now;
      if(typeof toast==='function') toast('📷 스냅샷은 읽기 전용 — 변경 사항이 저장되지 않습니다','err');
    }
    return;
  }
  // [타임머신] _fakeDate 설정 시 모든 저장 차단 (테스트 기능이라 실제 데이터 변경 금지).
  //   sync가 자동으로 ENROLL_MAP→STUDENTS 옮긴 것도 영구화되면 안 됨.
  //   단 탭 목록 / 스냅샷 키는 허용 (UI 조작용).
  if(typeof _fakeDate !== 'undefined' && _fakeDate
     && key!==STORAGE_KEYS.TAB_LIST && !key.startsWith('swim_snap_')){
    const now=Date.now();
    if(now-_timeMachineWarnedAt>2000){
      _timeMachineWarnedAt=now;
      if(typeof toast==='function') toast('🕐 타임머신 모드 — 변경 사항이 저장되지 않습니다','err');
    }
    return;
  }
  let auditPoint=null;
  if(key!==STORAGE_KEYS.AUDIT_LOG && key!==STORAGE_KEYS.RESTORE_POINTS && typeof createAuditPoint==='function'){
    auditPoint=createAuditPoint([key], {
      type:(typeof describeStorageChangeType==='function')?describeStorageChangeType(key):'edit',
      label:(typeof describeStorageChange==='function')?describeStorageChange(key):'편집'
    });
  }
  if(!skipUndo) pushUndo();
  dbSet(key, JSON.stringify(val));
  if(auditPoint && typeof recordAuditPoint==='function'){
    recordAuditPoint(auditPoint, [key]);
  }
}

function loadFromFirebase(callback){
  if(_selectedBranch && !_fbReady) initFirebaseStore();
  // 콜백 래퍼: 로드 완료/실패 후 _firebaseLoaded=true
  const wrappedCallback=()=>{
    _firebaseLoaded=true;
    callback();
  };
  if(!_fbReady){wrappedCallback();return;}
  _fb.once('value').then(snap=>{
    const data=snap.val();
    if(data) for(const [k,v] of Object.entries(data)){
      const asStr=typeof v==='string'?v:JSON.stringify(v);
      _dbCache[k]=asStr;
      // [FIX] localStorage 백업 — Firebase에 더 큰 데이터가 있을 때만 덮어쓰기
      // (localStorage가 Firebase보다 큰 경우 = 로컬 변경사항 보호)
      try{
        const lsk=_lsKey(k);
        const ls=localStorage.getItem(lsk);
        if(!ls||ls.length<asStr.length){
          localStorage.setItem(lsk,asStr);
        }
      }catch(e){}
    }
    wrappedCallback();
  }).catch(()=>{toast('Firebase 데이터 로드 실패 — 로컬 데이터 사용','err');wrappedCallback();});
  _fb.on('child_changed',(snap)=>{
    const newVal=snap.val();
    // [FIX] setItem은 비-문자열을 강제 변환하므로 방어적 직렬화
    const asStr=typeof newVal==='string'?newVal:JSON.stringify(newVal);
    _dbCache[snap.key]=asStr;
    try{localStorage.setItem(_lsKey(snap.key),asStr);}catch(e){}
    // [FIX] 자기 echo면 캐시만 갱신하고 재렌더 스킵 (불필요한 buildTable + 진행중 변경 덮어쓰기 방지)
    const q=_localWriteQueue[snap.key];
    if(q&&q.length&&q[0]===asStr){
      q.shift();
      if(!q.length) delete _localWriteQueue[snap.key];
      return;
    }
    // [스냅샷] 활성 스냅샷이 외부에서 변경됐으면 다시 swap (예: 같은 스냅샷을 다른 디바이스에서 갱신)
    if(typeof isSnapshotTab==='function' && isSnapshotTab()
       && snap.key === 'swim_snap_'+_activeTab){
      if(_popupOpen()){ _pendingSync=true; return; }
      switchTabView();
      return;
    }
    // 팝업 열려있으면 보류
    if(_popupOpen()){ _pendingSync=true; return; }
    reloadGlobalData();loadTabData();reloadBadgeMaps();buildTable();
  });
  _fb.on('child_removed',(snap)=>{
    delete _dbCache[snap.key];
    // [FIX] localStorage도 같이 정리 (이전엔 새로고침 시 좀비 데이터 부활)
    try{localStorage.removeItem(_lsKey(snap.key));}catch(e){}
    // [FIX] 다른 디바이스의 삭제도 화면에 반영 (이전엔 stale UI)
    if(_popupOpen()){ _pendingSync=true; return; }
    reloadGlobalData();loadTabData();reloadBadgeMaps();buildTable();
  });
}

/* ════════════════════════════════════════════════════════════════
 * SECTION: 타임머신 (개발용 가짜 날짜)
 * ════════════════════════════════════════════════════════════════ */
let _fakeDate = null;
function getToday(){
  // 스냅샷 탭이면 캡처 시점으로 시간 고정
  if(typeof isSnapshotTab==='function' && isSnapshotTab()){
    const cap=getSnapshotCapturedAt();
    if(cap) return new Date(cap+'T12:00:00');
  }
  return _fakeDate ? new Date(_fakeDate) : new Date();
}

