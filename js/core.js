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
const SC_READ_ONLY_PREVIEW=(()=>{
  try{return new URLSearchParams(window.location.search||'').get('preview')==='1';}
  catch(e){return false;}
})();
window.SC_READ_ONLY_PREVIEW=SC_READ_ONLY_PREVIEW;

/* ════════════════════════════════════════════════════════════════
 * SECTION: 지점(브랜치) 선택 — 가경점 vs 용암점
 *  - 가경점: Firebase path 'schedule' (기존 데이터 유지)
 *  - 용암점: Firebase path 'schedule_yongam' (빈 상태로 시작)
 *  - localStorage 키도 'yongam_' prefix로 분리 → 같은 브라우저에서 충돌 X
 * ════════════════════════════════════════════════════════════════ */
const SELECTED_BRANCH_KEY='selected_branch';
function _branchParamFromUrl(){
  const qs=String((window.location&&window.location.search)||'');
  const m=qs.match(/[?&]branch=(gagyeong|yongam)(?=&|$)/);
  if(m) return m[1];
  try{return new URLSearchParams(qs).get('branch')||'';}catch(e){return '';}
}
let _selectedBranch=null;
try{
  const branchParam=_branchParamFromUrl();
  if(branchParam==='gagyeong'||branchParam==='yongam'){
    _selectedBranch=branchParam;
    try{window.localStorage.setItem(SELECTED_BRANCH_KEY,branchParam);}catch(e){}
  }
}catch(e){}
if(!_selectedBranch){
  try{ _selectedBranch=window.localStorage.getItem(SELECTED_BRANCH_KEY); }catch(e){}
}
try{ window.SC_SELECTED_BRANCH=_selectedBranch||''; }catch(e){}
function getBranchInfo(){
  const selected=_selectedBranch || (window.SC_SELECTED_BRANCH||'');
  if(selected==='yongam') return {id:'yongam', name:'용암점', fbPath:'schedule_yongam', lsPrefix:'yongam_'};
  if(selected==='gagyeong') return {id:'gagyeong', name:'가경점', fbPath:'schedule', lsPrefix:''};
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
let _firebaseWriteWarnedAt=0;
let _firebaseUsingLocalFallback=false;
let _writeBlockedWarnedAt=0;
const _dbCache={};
const _snapshotParsedCache=new Map();
const SNAPSHOT_PARSED_CACHE_LIMIT=3;
const _scheduleWrites=window.SCScheduleWriteGateway
  ? window.SCScheduleWriteGateway.create({
      getRoot:()=>_fb,
      reportFailure:(error,meta)=>{
        const label=meta?.label||meta?.originalKey||meta?.keys?.[0]||'시간표 저장';
        _reportFirebaseWriteFailure(error,label);
      },
      refreshAfterFailure:(keys,meta,error)=>_refreshFailedScheduleWrites(keys,meta,error),
    })
  : null;
window.SCWriteDiagnostics={
  recent(limit){ return _scheduleWrites?_scheduleWrites.recent(limit):[]; },
};

function _isSnapshotStorageKey(key){
  return String(key||'').startsWith('swim_snap_');
}
function _isEphemeralDeferredStorageKey(key){
  key=String(key||'');
  return key.startsWith('zz_swim_day_snapshot__')
      || key.startsWith('zz_swim_restore_point__');
}
function releaseDeferredJSONMemory(key){
  if(!_isEphemeralDeferredStorageKey(key)) return;
  delete _dbCache[key];
  try{ localStorage.removeItem(_lsKey(key)); }catch(e){}
}
function _getParsedSnapshotCache(key){
  if(!_isSnapshotStorageKey(key)||!_snapshotParsedCache.has(key)) return null;
  const value=_snapshotParsedCache.get(key);
  // Map insertion order is used as a small LRU queue.
  _snapshotParsedCache.delete(key);
  _snapshotParsedCache.set(key,value);
  return value;
}
function _setParsedSnapshotCache(key,value){
  if(!_isSnapshotStorageKey(key)||!value) return value;
  _snapshotParsedCache.delete(key);
  _snapshotParsedCache.set(key,value);
  while(_snapshotParsedCache.size>SNAPSHOT_PARSED_CACHE_LIMIT){
    const oldest=_snapshotParsedCache.keys().next().value;
    _snapshotParsedCache.delete(oldest);
  }
  return value;
}
function _dropParsedSnapshotCache(key){
  if(_isSnapshotStorageKey(key)) _snapshotParsedCache.delete(key);
}

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

function _trackWritePromise(promise){
  if(promise&&typeof promise.catch==='function') promise.catch(()=>{});
  return promise;
}
function _cacheScheduleRaw(key,json){
  _dropParsedSnapshotCache(key);
  _dbCache[key]=json;
  try{
    if(_isEphemeralDeferredStorageKey(key)) localStorage.removeItem(_lsKey(key));
    else localStorage.setItem(_lsKey(key),json);
  }catch(e){}
}
function _removeQueuedLocalEcho(key,json){
  const queue=_localWriteQueue[key];
  if(!queue||!queue.length) return;
  const index=queue.indexOf(json);
  if(index>=0) queue.splice(index,1);
  if(!queue.length) delete _localWriteQueue[key];
}
async function _refreshFailedScheduleWrites(keys,meta){
  if(!_fbReady||!_fb) return;
  await Promise.all((keys||[]).map(async key=>{
    const originalKey=meta?.originalKey||key;
    try{
      const snap=await _fb.child(key).once('value');
      const raw=snap?snap.val():null;
      if(raw===null||raw===undefined){
        delete _dbCache[originalKey];
        try{localStorage.removeItem(_lsKey(originalKey));}catch(e){}
      }else{
        const asStr=typeof raw==='string'?raw:JSON.stringify(raw);
        _cacheScheduleRaw(originalKey,asStr);
      }
      if(typeof _queueRemoteScheduleRefresh==='function') _queueRemoteScheduleRefresh(originalKey);
    }catch(refreshError){
      delete _dbCache[originalKey];
      try{localStorage.removeItem(_lsKey(originalKey));}catch(e){}
    }
  }));
}
function dbSet(key,val,meta){
  if(_firebaseUsingLocalFallback){
    _warnBlockedWrite(key,'서버 데이터 로드 실패 상태');
    return false;
  }
  const json=typeof val==='string'?val:JSON.stringify(val);
  _cacheScheduleRaw(key,json);
  if(_fbReady&&_scheduleWrites){
    // Firebase SDK가 자체 큐잉을 지원 — _fbConnected 무관하게 시도
    // (오프라인이면 SDK가 큐에 쌓아뒀다가 재연결시 자동 push)
    const sk=key.replace(/[.#$/\[\]]/g,'_');
    if(typeof _isDeferredStorageKey!=='function'||!_isDeferredStorageKey(sk)){
      (_localWriteQueue[sk]=_localWriteQueue[sk]||[]).push(json);
    }
    const write=_scheduleWrites.set(sk,json,{...(meta||{}),originalKey:key,label:meta?.label||key});
    write.catch(e=>{
      _removeQueuedLocalEcho(sk,json);
      console.error('[FB SAVE FAIL]',key,e);
    });
    return _trackWritePromise(write);
  }
  return true;
}

function _firebaseErrorCode(error){
  return String(error?.code||error?.name||'')
    .toLowerCase()
    .replace(/^firestore\//,'');
}
function _isFirebaseConnectivityError(error){
  try{
    if(typeof navigator!=='undefined'&&navigator.onLine===false) return true;
  }catch(e){}
  const code=_firebaseErrorCode(error);
  return [
    'unavailable',
    'deadline-exceeded',
    'network-request-failed',
    'disconnected',
    'timeout',
  ].includes(code);
}
function _reportFirebaseWriteFailure(error,key){
  if(_isFirebaseConnectivityError(error)){
    _showOfflineWarning();
    return;
  }
  const now=Date.now();
  if(now-_firebaseWriteWarnedAt<3000) return;
  _firebaseWriteWarnedAt=now;
  const code=_firebaseErrorCode(error);
  let message='서버 저장 중 오류가 발생했습니다. 새로고침 후 다시 시도해주세요.';
  if(code==='failed-precondition'){
    message='서버 저장 조건 오류가 발생했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.';
  }else if(code==='resource-exhausted'){
    message='저장 데이터 용량 제한에 도달했습니다. 관리자에게 알려주세요.';
  }else if(code==='permission-denied'){
    message='저장 권한이 없습니다. 로그인 계정을 확인해주세요.';
  }
  console.warn('[FIREBASE WRITE ERROR]',key||'',code||'unknown',error);
  if(typeof toast==='function') toast(message,'err');
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
function _warnBlockedWrite(key,reason){
  console.warn('[DATA SAFETY] 저장 차단:', key, reason||'');
  const now=Date.now();
  if(now-_writeBlockedWarnedAt>2000){
    _writeBlockedWarnedAt=now;
    if(typeof toast==='function'){
      toast('서버 데이터 로드 실패 상태라 저장을 막았어요. 새로고침 후 다시 시도해주세요.','err');
    }
  }
}
function canPersistScheduleData(key,label){
  if(SC_READ_ONLY_PREVIEW){
    console.warn('[READ ONLY PREVIEW] 저장 차단:',key,label||'');
    const now=Date.now();
    if(now-_writeBlockedWarnedAt>1500){
      _writeBlockedWarnedAt=now;
      if(typeof toast==='function') toast('안전 미리보기에서는 운영 데이터가 저장되지 않습니다','err');
    }
    return false;
  }
  if(!_firebaseLoaded){
    console.warn('[v98 SAFETY] Firebase 로드 전 저장 차단:', key);
    return false;
  }
  if(isScheduleDataTransitioning()){
    const now=Date.now();
    if(now-_writeBlockedWarnedAt>1500){
      _writeBlockedWarnedAt=now;
      if(typeof toast==='function') toast('시간표 데이터를 불러오는 중입니다. 잠시만 기다려주세요.','err');
    }
    return false;
  }
  if(_firebaseUsingLocalFallback){
    _warnBlockedWrite(key,label||'로컬 fallback 읽기 전용');
    return false;
  }
  return true;
}
function dbGet(key){
  if(_dbCache[key]) return _dbCache[key];
  try{return localStorage.getItem(_lsKey(key));}catch(e){return null;}
}
function dbRemove(key){
  _dropParsedSnapshotCache(key);
  delete _dbCache[key];
  try{localStorage.removeItem(_lsKey(key));}catch(e){}
  if(_fbReady&&_scheduleWrites){
    const sk=key.replace(/[.#$/\[\]]/g,'_');
    return _trackWritePromise(_scheduleWrites.remove(sk,{originalKey:key,label:key}));
  }
  return true;
}

// [FIX] 자기 echo 식별용 큐. key별로 보낸 순서대로 쌓고, echo가 head와 일치하면 shift.
const _localWriteQueue={};

function _isDeferredStorageKey(key){
  return _isAuditStorageKey(key)
      || key===STORAGE_KEYS.DAY_SNAPSHOT
      || String(key||'').startsWith('swim_snap_')
      || String(key||'').startsWith('swim_bt_day_snapshot_')
      || String(key||'').startsWith('zz_swim_day_snapshot__');
}
function _isAuditStorageKey(key){
  key=String(key||'');
  return key==='swim_audit_log'
      || key==='swim_restore_points'
      || key==='zz_swim_audit_index'
      || key==='zz_swim_restore_index'
      || key==='zz_swim_student_delete_index'
      || key.startsWith('swim_restore_point_')
      || key.startsWith('zz_swim_audit_entry__')
      || key.startsWith('zz_swim_restore_point__')
      || key.startsWith('zz_swim_student_delete__');
}
function _localStorageKeyToStorageKey(lsKey){
  const b=typeof getBranchInfo==='function' ? getBranchInfo() : null;
  const prefix=b?.lsPrefix||'';
  if(prefix){
    if(!String(lsKey).startsWith(prefix)) return '';
    return String(lsKey).slice(prefix.length);
  }
  if(String(lsKey).startsWith('yongam_')) return '';
  return String(lsKey);
}
function _pruneMissingRemoteLocalKeys(remoteKeys){
  const remoteSet=new Set(remoteKeys||[]);
  try{
    const remove=[];
    for(let i=0;i<localStorage.length;i++){
      const lsKey=localStorage.key(i);
      const storageKey=_localStorageKeyToStorageKey(lsKey);
      if(!storageKey || !storageKey.startsWith('swim_')) continue;
      if(_isDeferredStorageKey(storageKey)) continue;
      if(!remoteSet.has(storageKey)) remove.push(lsKey);
    }
    remove.forEach(lsKey=>localStorage.removeItem(lsKey));
  }catch(e){
    console.warn('localStorage stale cleanup failed',e);
  }
}

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
  ARCHIVED_TABS: 'swim_archived_tabs', // 화면에서 제거한 과거 정규표의 출석부 기준 정보
  TAB_FOLDERS: 'swim_tab_folders',
  PARENT_TAB: 'swim_parent_tab', // 학부모 페이지가 기준으로 삼을 운영 시간표 탭
  MAIN_TAB: 'swim_main_tab',     // 관리자 새로고침 시 기본으로 열 운영 시간표 탭
  TEACHERS: 'swim_teachers',     // [v115] 선생님 목록 (이름+색)
  PERIODS:  'swim_periods',     // 수업 기간 목록
  RETIRE_HISTORY: 'swim_retire_history', // [v118] 퇴원 기록 보관 (영구)
  AUDIT_LOG: 'swim_audit_log',   // 기록관리: 이동/편집 로그
  AUDIT_INDEX: 'zz_swim_audit_index', // 증분 기록 인덱스 (표시용 요약만 저장)
  DESK_NOTES: 'swim_desk_notes', // 하단 전달사항: 원본 기록에서 분리된 데스크 편집용 표
  RESTORE_POINTS: 'swim_restore_points', // 기록관리: 특정 시점 복구 포인트
  RESTORE_INDEX: 'zz_swim_restore_index', // 증분 복원점 인덱스 (본문은 개별 키에 저장)
  STUDENT_DELETE_INDEX: 'zz_swim_student_delete_index', // 원생 삭제 안전기록 인덱스
  AGE_YEAR: 'swim_age_year',     // 학생 나이 자동 증가 마지막 반영 연도
  STUDENT_ID_VERSION: 'swim_student_id_version', // 정규·방특 공통 원생 ID 마이그레이션 버전
  VERSION:  'swim_ver',
};

function normalizeStoredScheduleValue(key,val){
  try{
    if(window.SCScheduleTime&&typeof SCScheduleTime.normalizeStoredValue==='function'){
      return SCScheduleTime.normalizeStoredValue(key,val);
    }
  }catch(e){
    console.warn('schedule time normalize failed',key,e);
  }
  return val;
}

/* JSON 로드/저장 헬퍼 (try/catch + Undo 푸시 통합) */
function loadJSON(key, defaultVal){
  try{
    const parsedSnapshot=_getParsedSnapshotCache(key);
    if(parsedSnapshot) return parsedSnapshot;
    const r = dbGet(key);
    const val = r ? JSON.parse(r) : (defaultVal!==undefined ? defaultVal : null);
    const normalized=normalizeStoredScheduleValue(key,val);
    return _setParsedSnapshotCache(key,normalized);
  }catch(e){
    return defaultVal!==undefined ? defaultVal : null;
  }
}

// Initial sync skips large deferred values such as snapshots. Fetch one value
// only when the user opens it, then keep the raw JSON in the existing cache.
async function loadDeferredJSON(key, defaultVal){
  const fallback=defaultVal!==undefined ? defaultVal : null;
  const parsedSnapshot=_getParsedSnapshotCache(key);
  if(parsedSnapshot) return parsedSnapshot;
  const cached=dbGet(key);
  if(cached!==null&&cached!==undefined&&cached!==''){
    try{
      const val=typeof cached==='string' ? JSON.parse(cached) : cached;
      const normalized=normalizeStoredScheduleValue(key,val);
      return _setParsedSnapshotCache(key,normalized);
    }catch(e){
      console.warn('deferred cache parse failed; refetching',key,e);
    }
  }

  if(!_fbReady&&_selectedBranch) initFirebaseStore();
  if(!_fbReady) return fallback;

  const safeKey=String(key||'').replace(/[.#$/\[\]]/g,'_');
  const snap=await _fb.child(safeKey).once('value');
  const raw=snap?snap.val():null;
  if(raw===null||raw===undefined) return fallback;

  const asStr=typeof raw==='string' ? raw : JSON.stringify(raw);
  _dbCache[key]=asStr;
  try{
    if(_isEphemeralDeferredStorageKey(key)) localStorage.removeItem(_lsKey(key));
    else localStorage.setItem(_lsKey(key),asStr);
  }catch(e){}

  try{
    const val=typeof raw==='string' ? JSON.parse(raw) : raw;
    const normalized=normalizeStoredScheduleValue(key,val);
    return _setParsedSnapshotCache(key,normalized);
  }catch(e){
    console.error('deferred data parse failed',key,e);
    return fallback;
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
  if(!canPersistScheduleData(key,'saveJSON')) return;
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
  val=normalizeStoredScheduleValue(key,val);
  let auditPoint=null;
  if(!_isAuditStorageKey(key) && typeof createAuditPoint==='function'){
    auditPoint=createAuditPoint([key], {
      type:(typeof describeStorageChangeType==='function')?describeStorageChangeType(key):'edit',
      label:(typeof describeStorageChange==='function')?describeStorageChange(key):'편집'
    });
  }
  if(!skipUndo) pushUndo();
  const write=dbSet(key, JSON.stringify(val),{label:key});
  if(write===false) return false;
  const completed=Promise.resolve(write).then(()=>{
    if(auditPoint && typeof recordAuditPoint==='function'){
      return recordAuditPoint(auditPoint, [key]);
    }
    return true;
  });
  return _trackWritePromise(completed);
}

const DATA_SYNC_DIAGNOSTIC_KEY='sc_data_sync_diagnostics';
const _dataSyncDiagnostics=(()=>{
  try{
    const saved=JSON.parse(sessionStorage.getItem(DATA_SYNC_DIAGNOSTIC_KEY)||'[]');
    return Array.isArray(saved)?saved.slice(-80):[];
  }catch(e){return [];}
})();
const _remoteSyncKeys=new Set();
let _remoteSyncTimer=null;
let _remoteSyncBeforeCount=0;
let _firebaseDataListenersAttached=false;
let _scheduleReadCoordinator=null;
let _scheduleSelectedController=null;
let _scheduleReadUsesSelectedKeys=false;
let _scheduleReadInitialRemoteKeys=[];
let _scheduleReadPendingBeforeCount=null;
let _scheduleReadInitialInvalid=false;
let _scheduleSelectedActiveTabId='';
let _scheduleTabTransitionSeq=0;
let _scheduleTabTransitioning=false;
const _scheduleTabReadiness=new Map();
const _scheduleReadInvalidKeys=new Set();
const _scheduleAuxiliaryLoadingOwners=new Set();
const _scheduleAuxiliaryLoadSeq=new Map();

function _activeStudentCount(){
  return Array.isArray(STUDENTS)?STUDENTS.length:0;
}
function _recordDataSyncDiagnostic(kind,keys,beforeCount,afterCount,details){
  const cfg=typeof getTabConfig==='function'?getTabConfig():null;
  const meta=details&&typeof details==='object'?details:{};
  _dataSyncDiagnostics.push({
    at:new Date().toISOString(),
    kind:String(kind||'sync'),
    branch:typeof getBranchInfo==='function'?(getBranchInfo()?.id||''):'',
    tab:typeof _activeTab!=='undefined'?String(_activeTab||''):'',
    studentKey:cfg?.stuKey||'',
    keys:(keys||[]).slice(0,30),
    before:Number(beforeCount||0),
    after:Number(afterCount||0),
    outcome:String(meta.outcome||''),
    durationMs:Math.max(0,Number(meta.durationMs||0)||0),
    owner:String(meta.owner||''),
    keyCount:Math.max(0,Number(meta.keyCount||(keys||[]).length)||0),
    slotConflicts:Array.isArray(window.SC_STUDENT_SLOT_CONFLICTS)?window.SC_STUDENT_SLOT_CONFLICTS.length:0,
  });
  while(_dataSyncDiagnostics.length>80) _dataSyncDiagnostics.shift();
  try{sessionStorage.setItem(DATA_SYNC_DIAGNOSTIC_KEY,JSON.stringify(_dataSyncDiagnostics));}catch(e){}
}
window.SCDataDiagnostics={
  recent(limit){
    const size=Math.max(1,Math.min(80,Number(limit||20)||20));
    return _dataSyncDiagnostics.slice(-size);
  },
  clear(){
    _dataSyncDiagnostics.length=0;
    try{sessionStorage.removeItem(DATA_SYNC_DIAGNOSTIC_KEY);}catch(e){}
  },
};

function _isStudentPayloadKey(key){
  key=String(key||'');
  return key==='swim_students'
      || key.startsWith('swim_stu_')
      || (key.startsWith('swim_bt_')&&key.endsWith('_stu'));
}
function _validStudentPayload(key,value){
  if(!_isStudentPayloadKey(key)) return true;
  try{
    const parsed=typeof value==='string'?JSON.parse(value):value;
    return Array.isArray(parsed);
  }catch(e){
    return false;
  }
}

function _applyScheduleReadBatchValue(key,raw){
  const asStr=typeof raw==='string'?raw:JSON.stringify(raw);
  _cacheScheduleRaw(String(key||''),asStr===undefined?'null':asStr);
}
function _removeScheduleReadBatchValue(key){
  key=String(key||'');
  _dropParsedSnapshotCache(key);
  delete _dbCache[key];
  try{localStorage.removeItem(_lsKey(key));}catch(e){}
}
function _consumeScheduleReadLocalEchoes(batch){
  const values=batch&&batch.values&&typeof batch.values==='object'?batch.values:{};
  Object.entries(values).forEach(([key,value])=>{
    const raw=typeof value==='string'?value:JSON.stringify(value);
    const queue=_localWriteQueue[key];
    if(!queue||!queue.length||queue[0]!==raw) return;
    queue.shift();
    if(!queue.length) delete _localWriteQueue[key];
  });
}
function _handleScheduleReadError(error){
  _firebaseUsingLocalFallback=true;
  console.warn('[FIREBASE READ ERROR]',_firebaseErrorCode(error)||'unknown',error);
  if(_isFirebaseConnectivityError(error)) _showOfflineWarning();
}
function _canUseScheduleReadCoordinator(){
  return !!(
    window.SCScheduleReadCoordinator
    &&typeof SCScheduleReadCoordinator.create==='function'
    &&window.SCFirebaseStore
    &&typeof SCFirebaseStore.subscribeSelectedRootBatches==='function'
    &&window.SCScheduleKeySelection
    &&typeof SCScheduleKeySelection.initialBaseKeys==='function'
    &&typeof SCScheduleKeySelection.resolveMainTab==='function'
    &&typeof SCScheduleKeySelection.tabKeys==='function'
  );
}
function _ensureScheduleReadCoordinator(){
  if(_scheduleReadCoordinator||!_canUseScheduleReadCoordinator()) return _scheduleReadCoordinator;
  _scheduleReadCoordinator=SCScheduleReadCoordinator.create({
    getRaw:key=>Object.prototype.hasOwnProperty.call(_dbCache,key)?_dbCache[key]:null,
    setRaw:_applyScheduleReadBatchValue,
    removeRaw:_removeScheduleReadBatchValue,
    validate:(key,raw)=>_validStudentPayload(key,raw),
    isRenderBlocked:()=>isScheduleDataTransitioning()
      ||_scheduleAuxiliaryLoadingOwners.size>0
      ||(typeof _popupOpen==='function'&&_popupOpen()),
    onRender:(keys,meta)=>_renderRemoteScheduleBatch(keys,meta),
    onInvalid:(keys,meta)=>{
      keys.forEach(key=>_scheduleReadInvalidKeys.add(String(key||'')));
      if(meta&&meta.initial) _scheduleReadInitialInvalid=true;
      else _firebaseUsingLocalFallback=true;
      console.error('[DATA SAFETY] 불완전한 원생 데이터 수신을 무시했습니다:',keys.join(','));
      _recordDataSyncDiagnostic('ignored-invalid-students',keys,_activeStudentCount(),_activeStudentCount());
    },
    onError:_handleScheduleReadError,
  });
  return _scheduleReadCoordinator;
}

async function ensureScheduleTabLoaded(tabId,options){
  const opts=options||{};
  const id=String(tabId||'').trim();
  const tab=(typeof _tabById==='function'?_tabById(id):null)
    ||(_tabList||[]).find(item=>item&&item.id===id);
  if(!tab) throw new Error('시간표를 찾을 수 없습니다');
  if(tab.type==='snapshot') return {stale:false,tabId:id,snapshot:true};
  if(!_scheduleSelectedController||typeof _scheduleSelectedController.setActiveKeys!=='function'){
    return {stale:false,tabId:id,compatibility:true};
  }

  const keys=SCScheduleKeySelection.tabKeys(tab);
  const studentKeys=keys.filter(_isStudentPayloadKey);
  const seq=++_scheduleTabTransitionSeq;
  const startedAt=Date.now();
  _scheduleTabTransitioning=true;
  keys.forEach(key=>_scheduleReadInvalidKeys.delete(key));
  _recordDataSyncDiagnostic('tab-load-start',keys,_activeStudentCount(),_activeStudentCount(),{
    outcome:'loading',durationMs:0,keyCount:keys.length,
  });
  try{
    if(_scheduleSelectedController.ready) await _scheduleSelectedController.ready;
    const result=await _scheduleSelectedController.setActiveKeys(keys);
    if(seq!==_scheduleTabTransitionSeq||(result&&result.stale)){
      _recordDataSyncDiagnostic('tab-load-stale',keys,_activeStudentCount(),_activeStudentCount(),{
        outcome:'stale',durationMs:Date.now()-startedAt,keyCount:keys.length,
      });
      return {stale:true,tabId:id};
    }
    const invalid=studentKeys.filter(key=>{
      if(_scheduleReadInvalidKeys.has(key)) return true;
      const raw=Object.prototype.hasOwnProperty.call(_dbCache,key)?_dbCache[key]:null;
      return raw!==null&&!_validStudentPayload(key,raw);
    });
    if(invalid.length) throw new Error('원생 데이터가 올바르지 않아 시간표를 열 수 없습니다');
    _scheduleSelectedActiveTabId=id;
    _scheduleTabReadiness.set(id,{
      keys:keys.slice(),
      readyAt:Date.now(),
      durationMs:Date.now()-startedAt,
    });
    _recordDataSyncDiagnostic('tab-load-ready',keys,_activeStudentCount(),_activeStudentCount(),{
      outcome:'ready',durationMs:Date.now()-startedAt,keyCount:keys.length,
    });
    return {stale:false,tabId:id,keys:keys.slice()};
  }catch(error){
    if(seq===_scheduleTabTransitionSeq){
      _recordDataSyncDiagnostic('tab-load-failed',keys,_activeStudentCount(),_activeStudentCount(),{
        outcome:'failed',durationMs:Date.now()-startedAt,keyCount:keys.length,
      });
    }
    if(opts.silent!==true) console.error('시간표 데이터 로드 실패:',id,error);
    throw error;
  }finally{
    if(seq===_scheduleTabTransitionSeq) _scheduleTabTransitioning=false;
  }
}
function isScheduleTabDataReady(tabId){
  const id=String(tabId||'').trim();
  return !!(id&&_scheduleSelectedActiveTabId===id&&_scheduleTabReadiness.has(id));
}
function isScheduleDataTransitioning(){
  return !!_scheduleTabTransitioning;
}
function cancelScheduleTabLoad(){
  ++_scheduleTabTransitionSeq;
  _scheduleTabTransitioning=false;
  const id=_scheduleSelectedActiveTabId;
  const tab=id&&((typeof _tabById==='function'?_tabById(id):null)
    ||(_tabList||[]).find(item=>item&&item.id===id));
  if(tab&&_scheduleSelectedController&&typeof _scheduleSelectedController.setActiveKeys==='function'){
    _scheduleSelectedController.setActiveKeys(SCScheduleKeySelection.tabKeys(tab)).catch(()=>{});
  }
}
async function ensureScheduleAuxiliaryKeysLoaded(owner,keys){
  owner=String(owner||'').trim();
  if(!owner) throw new Error('보조 데이터 소유자가 필요합니다');
  const selected=[...new Set((keys||[]).map(key=>String(key||'').trim()).filter(Boolean))];
  if(!_scheduleSelectedController||typeof _scheduleSelectedController.setAuxiliaryKeys!=='function'){
    return {stale:false,keys:selected,compatibility:true};
  }
  const seq=(_scheduleAuxiliaryLoadSeq.get(owner)||0)+1;
  const startedAt=Date.now();
  _scheduleAuxiliaryLoadSeq.set(owner,seq);
  _scheduleAuxiliaryLoadingOwners.add(owner);
  selected.forEach(key=>_scheduleReadInvalidKeys.delete(key));
  _recordDataSyncDiagnostic('auxiliary-load-start',selected,_activeStudentCount(),_activeStudentCount(),{
    outcome:'loading',durationMs:0,owner,keyCount:selected.length,
  });
  try{
    if(_scheduleSelectedController.ready) await _scheduleSelectedController.ready;
    const result=await _scheduleSelectedController.setAuxiliaryKeys(owner,selected);
    if(_scheduleAuxiliaryLoadSeq.get(owner)!==seq||(result&&result.stale)){
      _recordDataSyncDiagnostic('auxiliary-load-stale',selected,_activeStudentCount(),_activeStudentCount(),{
        outcome:'stale',durationMs:Date.now()-startedAt,owner,keyCount:selected.length,
      });
      return {stale:true,keys:selected};
    }
    const invalid=selected.filter(key=>{
      if(!_isStudentPayloadKey(key)) return false;
      if(_scheduleReadInvalidKeys.has(key)) return true;
      const raw=Object.prototype.hasOwnProperty.call(_dbCache,key)?_dbCache[key]:null;
      return raw!==null&&!_validStudentPayload(key,raw);
    });
    if(invalid.length) throw new Error('출석부 원생 데이터가 올바르지 않습니다');
    _recordDataSyncDiagnostic('auxiliary-load-ready',selected,_activeStudentCount(),_activeStudentCount(),{
      outcome:'ready',durationMs:Date.now()-startedAt,owner,keyCount:selected.length,
    });
    return {stale:false,keys:selected};
  }catch(error){
    if(_scheduleAuxiliaryLoadSeq.get(owner)===seq){
      _recordDataSyncDiagnostic('auxiliary-load-failed',selected,_activeStudentCount(),_activeStudentCount(),{
        outcome:'failed',durationMs:Date.now()-startedAt,owner,keyCount:selected.length,
      });
    }
    throw error;
  }finally{
    if(_scheduleAuxiliaryLoadSeq.get(owner)===seq) _scheduleAuxiliaryLoadingOwners.delete(owner);
  }
}
function releaseScheduleAuxiliaryKeys(owner){
  owner=String(owner||'').trim();
  if(!owner) return;
  _scheduleAuxiliaryLoadSeq.set(owner,(_scheduleAuxiliaryLoadSeq.get(owner)||0)+1);
  _scheduleAuxiliaryLoadingOwners.delete(owner);
  if(_scheduleSelectedController&&typeof _scheduleSelectedController.releaseAuxiliaryKeys==='function'){
    _scheduleSelectedController.releaseAuxiliaryKeys(owner);
  }
}

function _renderRemoteScheduleBatch(keys,meta){
  keys=[...new Set((keys||[]).map(key=>String(key||'')).filter(Boolean))];
  if(!keys.length) return;
  const beforeCount=_scheduleReadPendingBeforeCount==null
    ?_activeStudentCount()
    :_scheduleReadPendingBeforeCount;
  _scheduleReadPendingBeforeCount=null;
  if(typeof isSnapshotTab==='function'&&isSnapshotTab()){
    const snapshotKey='swim_snap_'+String(_activeTab||'');
    if(keys.includes(snapshotKey)&&typeof switchTabView==='function') switchTabView();
    _recordDataSyncDiagnostic('snapshot',keys,beforeCount,_activeStudentCount());
    return;
  }
  const tabBefore=typeof _activeTab!=='undefined'?String(_activeTab||''):'';
  const cfgBefore=typeof getTabConfig==='function'?getTabConfig():null;
  reloadGlobalData();
  const cfgAfter=typeof getTabConfig==='function'?getTabConfig():null;
  const activeTabDataChanged=tabBefore!==String(_activeTab||'')
    ||keys.includes(cfgBefore?.stuKey)
    ||keys.includes(cfgBefore?.instKey)
    ||keys.includes(cfgAfter?.stuKey)
    ||keys.includes(cfgAfter?.instKey);
  if(activeTabDataChanged) loadTabData();
  reloadBadgeMaps();
  buildTable();
  _recordDataSyncDiagnostic(
    activeTabDataChanged?'remote-tab-data':'remote-maps',
    keys,
    beforeCount,
    _activeStudentCount()
  );
}

function _flushRemoteScheduleRefresh(){
  _remoteSyncTimer=null;
  const keys=[..._remoteSyncKeys];
  const beforeCount=_remoteSyncBeforeCount;
  if(!keys.length) return;
  if(typeof _popupOpen==='function'&&_popupOpen()){
    _pendingSync=true;
    _recordDataSyncDiagnostic('deferred-popup',keys,beforeCount,_activeStudentCount());
    return;
  }
  _remoteSyncKeys.clear();
  _scheduleReadPendingBeforeCount=beforeCount;
  _renderRemoteScheduleBatch(keys,{source:'compatibility-queue'});
}
function flushPendingScheduleReads(){
  let flushed=false;
  const hadLegacyPending=!!_pendingSync;
  if(_scheduleReadCoordinator&&typeof _scheduleReadCoordinator.flush==='function'){
    flushed=_scheduleReadCoordinator.flush()||flushed;
  }
  if(_remoteSyncKeys.size){
    if(_remoteSyncTimer){
      clearTimeout(_remoteSyncTimer);
      _remoteSyncTimer=null;
    }
    _flushRemoteScheduleRefresh();
    flushed=true;
  }
  if(!flushed&&hadLegacyPending){
    reloadGlobalData();
    loadTabData();
    reloadBadgeMaps();
    buildTable();
    flushed=true;
  }
  if(flushed||hadLegacyPending) _pendingSync=false;
  return flushed;
}
function _queueRemoteScheduleRefresh(key){
  if(!_remoteSyncKeys.size) _remoteSyncBeforeCount=_activeStudentCount();
  _remoteSyncKeys.add(String(key||''));
  if(_remoteSyncTimer) clearTimeout(_remoteSyncTimer);
  _remoteSyncTimer=setTimeout(_flushRemoteScheduleRefresh,60);
}
function _attachLegacyFirebaseDataListeners(){
  _fb.on('child_changed',snap=>{
    if(_isDeferredStorageKey(snap.key)) return;
    const value=snap.val();
    if(!_validStudentPayload(snap.key,value)){
      _firebaseUsingLocalFallback=true;
      _recordDataSyncDiagnostic('ignored-invalid-students',[snap.key],_activeStudentCount(),_activeStudentCount());
      return;
    }
    const raw=typeof value==='string'?value:JSON.stringify(value);
    const queue=_localWriteQueue[snap.key];
    if(queue&&queue.length&&queue[0]===raw){
      queue.shift();
      if(!queue.length) delete _localWriteQueue[snap.key];
      return;
    }
    if(_dbCache[snap.key]===raw) return;
    _applyScheduleReadBatchValue(snap.key,raw);
    _queueRemoteScheduleRefresh(snap.key);
  });
  _fb.on('child_removed',snap=>{
    if(_isDeferredStorageKey(snap.key)) return;
    const existed=Object.prototype.hasOwnProperty.call(_dbCache,snap.key)||dbGet(snap.key)!==null;
    _removeScheduleReadBatchValue(snap.key);
    if(existed) _queueRemoteScheduleRefresh(snap.key);
  });
}
function _attachFirebaseDataListeners(){
  if(_firebaseDataListenersAttached||!_fbReady||!_fb) return;
  if(!_canUseScheduleReadCoordinator()){
    _firebaseDataListenersAttached=true;
    _attachLegacyFirebaseDataListeners();
    return;
  }
  _ensureScheduleReadCoordinator();
  _firebaseDataListenersAttached=true;
  _scheduleReadUsesSelectedKeys=true;
  _scheduleReadCoordinator.start(handlers=>{
    const selected=SCFirebaseStore.subscribeSelectedRootBatches(_fb,{
      baseKeys:SCScheduleKeySelection.initialBaseKeys(),
      resolveInitialActiveKeys:baseValues=>{
        const tab=SCScheduleKeySelection.resolveMainTab(
          baseValues,
          typeof _activeTab!=='undefined'?_activeTab:'regular'
        );
        _scheduleSelectedActiveTabId=String(tab.id||'regular');
        return SCScheduleKeySelection.tabKeys(tab);
      },
      next:batch=>{
        _consumeScheduleReadLocalEchoes(batch);
        if(batch&&batch.initial){
          _scheduleReadInitialRemoteKeys=Object.keys(batch.values||{});
        }else if(_scheduleReadPendingBeforeCount==null){
          _scheduleReadPendingBeforeCount=_activeStudentCount();
        }
        handlers.next(batch);
      },
      error:handlers.error,
    });
    _scheduleSelectedController=selected;
    if(selected&&selected.ready&&typeof selected.ready.then==='function'){
      selected.ready.then(()=>{
        const id=_scheduleSelectedActiveTabId;
        if(!id) return;
        const tab=(typeof _tabById==='function'?_tabById(id):null)
          ||(_tabList||[]).find(item=>item&&item.id===id);
        const keys=tab?SCScheduleKeySelection.tabKeys(tab):[];
        _scheduleTabReadiness.set(id,{keys,readyAt:Date.now(),durationMs:0});
        _recordDataSyncDiagnostic('selected-initial',keys,_activeStudentCount(),_activeStudentCount());
      }).catch(()=>{});
    }
    return ()=>{
      if(selected&&typeof selected.stop==='function') selected.stop();
      if(_scheduleSelectedController===selected) _scheduleSelectedController=null;
    };
  });
}

function loadFromFirebase(callback){
  if(_selectedBranch && !_fbReady) initFirebaseStore();
  // 콜백 래퍼: 서버 로드 성공 여부와 별도로 렌더는 진행하되, 실패 시 저장은 읽기 전용으로 막는다.
  const wrappedCallback=()=>{
    _firebaseLoaded=true;
    callback();
  };
  if(!_fbReady){
    _firebaseUsingLocalFallback=true;
    wrappedCallback();
    return;
  }
  if(_canUseScheduleReadCoordinator()){
    _attachFirebaseDataListeners();
    _scheduleReadCoordinator.ready().then(()=>{
      if(_scheduleReadInitialInvalid){
        _firebaseUsingLocalFallback=true;
        toast('원생 데이터 일부가 올바르지 않아 읽기 전용으로 열었습니다','err');
      }else{
        _firebaseUsingLocalFallback=false;
        if(!_scheduleReadUsesSelectedKeys) _pruneMissingRemoteLocalKeys(_scheduleReadInitialRemoteKeys);
      }
      wrappedCallback();
    }).catch(err=>{
      console.error('Firebase 데이터 로드 실패:',err);
      _firebaseUsingLocalFallback=true;
      toast('Firebase 데이터 로드 실패 — 로컬 데이터는 읽기 전용입니다','err');
      wrappedCallback();
    });
    return;
  }
  _fb.once('value').then(snap=>{
    const data=snap.val();
    const remoteKeys=data?Object.keys(data):[];
    _firebaseUsingLocalFallback=false;
    if(data) for(const [k,v] of Object.entries(data)){
      if(_isDeferredStorageKey(k)) continue;
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
    _pruneMissingRemoteLocalKeys(remoteKeys);
    wrappedCallback();
  }).catch(err=>{
    console.error('Firebase 데이터 로드 실패:',err);
    _firebaseUsingLocalFallback=true;
    toast('Firebase 데이터 로드 실패 — 로컬 데이터는 읽기 전용입니다','err');
    wrappedCallback();
  }).finally(_attachFirebaseDataListeners);
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

