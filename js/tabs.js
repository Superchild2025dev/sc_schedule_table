/* ════════════════════════════════════════════════════════════════
 * SECTION: 탭 시스템 (정규반/방특반)
 * ════════════════════════════════════════════════════════════════ */
let _activeTab='regular';

const _REG_BASE={
  days:['월','화','수','목','금','토'],
  times:[{t:'1시'},{t:'2시'},{t:'3시'},{t:'4시'},{t:'5시'},{t:'6시'},{t:'7시'},{t:'8시'}],
  lanes:5, hasNum:['월','토'],
  satTimeLabel:(window.SCScheduleTime&&SCScheduleTime.SAT_INTERNAL_TO_DISPLAY)||{'1시':'9시','2시':'10시','3시':'11시','4시':'12시','5시':'1시','6시':'2시'},
};
const _BT_BASE={
  days:['월수금','화목'],
  times:[{t:'9시'},{t:'10시'},{t:'11시'}],
  lanes:5,
  hasNum:['월수금','화목'],
  satTimeLabel:{},
};
function _tabById(tabId){
  return (_tabList||[]).find(t=>t&&t.id===tabId)||null;
}
function _tabConfigFor(tab){
  if(!tab||tab.type==='regular'){
    const id=tab?.id||'regular';
    const isDefault=(!tab||id==='regular');
    return {
      ..._REG_BASE,
      stuKey:isDefault?'swim_students':'swim_stu_'+id,
      instKey:isDefault?'swim_inst':'swim_inst_'+id,
    };
  }
  if(tab.type==='bangteuk'){
    return {
      ..._BT_BASE,
      stuKey:'swim_bt_'+tab.id+'_stu',
      instKey:'swim_bt_'+tab.id+'_inst',
    };
  }
  return {..._REG_BASE, stuKey:'swim_students', instKey:'swim_inst'};
}
function getTabConfigById(tabId){
  return _tabConfigFor(_tabById(tabId)||{id:tabId||'regular',type:'regular'});
}
function getTabConfig(){
  const tab=_tabList.find(t=>t.id===_activeTab);
  return _tabConfigFor(tab);
}
function isBangteuk(){ return _tabList.find(t=>t.id===_activeTab)?.type==='bangteuk'; }
function isSnapshotTab(){ return _tabList.find(t=>t.id===_activeTab)?.type==='snapshot'; }
function getSnapshotCapturedAt(){
  const tab=_tabList.find(t=>t.id===_activeTab);
  return tab&&tab.type==='snapshot'?tab.capturedAt:null;
}
function getSnapshotSourceInfo(tabId){
  const tab=_tabById(tabId||_activeTab);
  if(!tab||tab.type!=='snapshot') return null;
  let data=null;
  try{ data=loadJSON(SNAP_KEY_PREFIX+tab.id, null); }catch(e){}
  return {
    snapshotId:tab.id,
    sourceTabId:tab.sourceTabId||data?.sourceTabId||'',
    sourceTabType:tab.sourceTabType||data?.sourceTabType||'regular',
    sourceTabName:tab.sourceTabName||data?.sourceTabName||'',
    periodMonth:tab.periodMonth||data?.periodMonth||'',
  };
}

/* ──── 탭 목록 관리 ──── */
let _tabList = loadJSON(STORAGE_KEYS.TAB_LIST, []);
if(!_tabList.length) _tabList=[{id:'regular',name:'정규시간표',type:'regular'}];
let _tabFolderList = loadJSON(STORAGE_KEYS.TAB_FOLDERS, []);
if(!Array.isArray(_tabFolderList)) _tabFolderList=[];
function _mainTabSetting(){
  return loadJSON(STORAGE_KEYS.MAIN_TAB||'swim_main_tab', null)||{};
}
function _mainTabId(list){
  const tabs=Array.isArray(list)?list:_tabList;
  const saved=_mainTabSetting();
  const found=tabs.find(t=>t&&t.id===saved.tabId&&t.type!=='snapshot');
  if(found) return found.id;
  const regular=tabs.find(t=>t&&t.id==='regular');
  if(regular) return regular.id;
  const live=tabs.find(t=>t&&t.type!=='snapshot');
  return live?.id||tabs[0]?.id||'regular';
}
_activeTab=_mainTabId(_tabList);
function _tabClone(value){
  return JSON.parse(JSON.stringify(value));
}
function _tabCloneSafe(value,fallback){
  const src=(value===undefined||value===null)?fallback:value;
  try{return JSON.parse(JSON.stringify(src));}
  catch(e){
    try{return JSON.parse(JSON.stringify(fallback));}
    catch(e2){return fallback;}
  }
}
function _pad2(n){
  return String(parseInt(n,10)).padStart(2,'0');
}
function _monthKeyFromPeriod(period){
  if(!period||!period.start||!period.month) return '';
  const year=String(period.start).slice(0,4);
  return year+'-'+_pad2(period.month);
}
function _normalizeMonthKey(value){
  const text=String(value||'').trim();
  const m=text.match(/^(\d{4})-(\d{1,2})/);
  if(m) return m[1]+'-'+_pad2(m[2]);
  return '';
}
function _periodMonthForDate(ds){
  const periods=(typeof SCHEDULE_PERIODS!=='undefined'&&Array.isArray(SCHEDULE_PERIODS))?SCHEDULE_PERIODS:[];
  const p=periods.find(x=>x&&x.start<=ds&&x.end>=ds);
  return _monthKeyFromPeriod(p)||_normalizeMonthKey(ds);
}
function _defaultPeriodMonth(){
  try{return _normalizeMonthKey(_periodMonthForDate(toDateStr(getToday())))||'2026-05';}catch(e){return '2026-05';}
}
function _addMonthsToMonthKey(monthKey,delta){
  const key=_normalizeMonthKey(monthKey)||_defaultPeriodMonth();
  const m=String(key||'').match(/^(\d{4})-(\d{2})$/);
  const base=m?new Date(Number(m[1]),Number(m[2])-1+delta,1):new Date(getToday().getFullYear(),getToday().getMonth()+delta,1);
  return base.getFullYear()+'-'+_pad2(base.getMonth()+1);
}
function _monthTabName(monthKey){
  const key=_normalizeMonthKey(monthKey)||_defaultPeriodMonth();
  const month=parseInt(String(key).slice(5,7),10)||1;
  return month+'월출석부';
}
function _tabPeriodMonth(tab){
  if(!tab) return '';
  if(tab.periodLocked&&tab.periodMonth) return _normalizeMonthKey(tab.periodMonth)||String(tab.periodMonth);
  const main=_mainTabSetting();
  if((!tab.type||tab.type==='regular') && (main.tabId===tab.id || (!main.tabId&&tab.id==='regular'))){
    return _defaultPeriodMonth();
  }
  if(tab.periodMonth) return _normalizeMonthKey(tab.periodMonth)||String(tab.periodMonth);
  const m=String(tab.name||'').match(/(?:(20\d{2})\s*년?\s*)?(\d{1,2})\s*월/);
  if(!m) return tab.id==='regular'?'2026-05':'';
  const year=m[1]||String(_defaultPeriodMonth()).slice(0,4);
  return year+'-'+_pad2(m[2]);
}
function _tabStoredPeriodMonth(tab){
  if(!tab) return '';
  if(tab.periodMonth) return _normalizeMonthKey(tab.periodMonth)||String(tab.periodMonth);
  const m=String(tab.name||'').match(/(?:(20\d{2})\s*년?\s*)?(\d{1,2})\s*월/);
  if(!m) return '';
  const year=m[1]||String(_defaultPeriodMonth()).slice(0,4);
  return year+'-'+_pad2(m[2]);
}
function _compareMonthKey(a,b){
  const aa=_normalizeMonthKey(a);
  const bb=_normalizeMonthKey(b);
  if(!aa||!bb) return 0;
  if(aa===bb) return 0;
  return aa<bb?-1:1;
}
function _tabContainsDate(tab,ds){
  if(!tab||!ds) return false;
  if(tab.type==='bangteuk'){
    return !!(tab.seasonStart&&tab.seasonEnd&&tab.seasonStart<=ds&&tab.seasonEnd>=ds);
  }
  return _tabPeriodMonth(tab)===_periodMonthForDate(ds);
}
function _bangteukPeriodLabel(tab){
  if(!tab||!tab.seasonStart||!tab.seasonEnd) return '';
  return tab.seasonStart.slice(5).replace('-','/')+'~'+tab.seasonEnd.slice(5).replace('-','/');
}
function getActiveBangteukBasisTab(tabId){
  const tabs=(_tabList||[]).filter(t=>t&&t.type==='bangteuk');
  if(!tabs.length) return null;
  if(tabId){
    const exact=tabs.find(t=>t.id===tabId);
    if(exact) return exact;
  }
  const active=_tabById(_activeTab);
  if(active?.type==='bangteuk') return active;
  let today='';
  try{ today=toDateStr(getToday()); }catch(e){}
  if(today){
    const current=tabs.find(t=>_tabContainsDate(t,today));
    if(current) return current;
  }
  const withPeriod=tabs
    .filter(t=>t.seasonStart&&t.seasonEnd)
    .sort((a,b)=>String(b.seasonStart||'').localeCompare(String(a.seasonStart||'')));
  return withPeriod[0]||tabs[0]||null;
}
function getBangteukGroupOptions(tabId){
  const tab=getActiveBangteukBasisTab(tabId);
  if(!tab||!tab.seasonStart||!tab.seasonEnd) return [];
  const label=_bangteukPeriodLabel(tab);
  return ['월수금','화목'].map(group=>({
    group,
    tabId:tab.id,
    tabName:tab.name||'방특 시간표',
    seasonStart:tab.seasonStart,
    seasonEnd:tab.seasonEnd,
    label:`${group} 방특`,
    periodLabel:label,
  }));
}
function getAttendanceBasisTabForDate(ds){
  const active=_tabById(_activeTab);
  if(active?.type==='bangteuk'){
    if(_tabContainsDate(active,ds) || !active.seasonStart || !active.seasonEnd) return active;
    return (_tabList||[]).find(t=>t&&t.type==='bangteuk'&&_tabContainsDate(t,ds))||active;
  }
  const monthKey=_periodMonthForDate(ds);
  const match=(_tabList||[]).find(t=>t&&(!t.type||t.type==='regular')&&_tabPeriodMonth(t)===monthKey);
  if(match) return match;
  if(active&&(!active.type||active.type==='regular')) return active;
  return _tabById('regular')||active||null;
}
function _attendanceReservationDate(entry){
  return typeof entry==='string'?String(entry||''):String(entry?.ds||'');
}
function _attendanceEntryPerson(entry,fallback){
  try{
    if(typeof _summaryRecordPerson==='function') return _summaryRecordPerson(entry,fallback);
  }catch(e){}
  const source=entry&&typeof entry==='object'?entry:{};
  const fb=fallback||{};
  return {
    n:String(source.n||source.name||fb.n||fb.name||'').trim(),
    a:source.a||source.age||fb.a||fb.age||null,
    p:source.p||source.phone||source.tel||fb.p||fb.phone||fb.tel||''
  };
}
function _attendanceEntryMatchesStudent(entry,stu){
  if(!entry||!stu) return false;
  const p=_attendanceEntryPerson(entry,stu);
  const name=String(p.n||'').trim();
  const stuName=String(stu.n||stu.name||'').trim();
  if(name&&stuName&&name!==stuName) return false;
  const phoneA=String(p.p||'').replace(/\D/g,'');
  const phoneB=String(stu.p||stu.phone||stu.tel||'').replace(/\D/g,'');
  if(phoneA&&phoneB&&phoneA!==phoneB) return false;
  return !!(name||phoneA);
}
function _attendanceStudentFromEnroll(slotKey,entry){
  const p=String(slotKey||'').split('/');
  if(p.length<4||!entry) return null;
  const person=_attendanceEntryPerson(entry,null);
  if(!person.n) return null;
  const obj={
    n:person.n,
    a:person.a||null,
    t:p[0],
    d:p[1],
    l:parseInt(p[2],10),
    r:parseInt(p[3],10),
    _attEnrollDs:String(entry.ds||'')
  };
  if(person.p) obj.p=person.p;
  if(entry.isNew) obj.isNew=entry.isNew;
  if(entry.reenroll) obj.reenroll=entry.reenroll;
  if(entry.enrolled) obj.enrolled=entry.ds;
  if(entry.v) obj.v=true;
  if(entry.loc) obj.loc=entry.loc;
  if(entry.memo) obj.memo=entry.memo;
  if(entry.g) obj.g=entry.g;
  return obj;
}
function _attendanceStudentsForDate(students,ds,hasSnapshot){
  const base=(Array.isArray(students)?students:[]).map(stu=>stu?Object.assign({},stu):stu).filter(Boolean);
  if(hasSnapshot||!ds) return base;
  const bySlot=new Map();
  base.forEach(stu=>{ bySlot.set([stu.t,stu.d,stu.l,stu.r].join('/'),stu); });
  try{
    Object.entries(typeof RETIRE_MAP!=='undefined'?(RETIRE_MAP||{}):{}).forEach(([slotKey,entry])=>{
      const retDs=_attendanceReservationDate(entry);
      if(!retDs) return;
      if(retDs<ds){
        bySlot.delete(slotKey);
      }else if(retDs===ds&&bySlot.has(slotKey)){
        bySlot.set(slotKey,Object.assign({},bySlot.get(slotKey),{_attRetireDs:retDs}));
      }
    });
  }catch(e){}
  try{
    Object.entries(typeof ENROLL_MAP!=='undefined'?(ENROLL_MAP||{}):{}).forEach(([slotKey,entry])=>{
      const enDs=String(entry?.ds||'');
      if(!enDs||enDs>ds) return;
      const existing=bySlot.get(slotKey);
      if(existing&&!_attendanceEntryMatchesStudent(entry,existing)) return;
      const next=existing?Object.assign({},existing,{_attEnrollDs:enDs}):_attendanceStudentFromEnroll(slotKey,entry);
      if(next) bySlot.set(slotKey,next);
    });
  }catch(e){}
  return [...bySlot.values()];
}
function getAttendanceBasisDataForDate(ds){
  const tab=getAttendanceBasisTabForDate(ds);
  const cfg=_tabConfigFor(tab);
  const todayStr=toDateStr(getToday());
  const loadedSnap=getLoadedAttendanceDaySnapshot(tab?.id,ds);
  const snap=(ds<todayStr&&loadedSnap&&Array.isArray(loadedSnap.students))?loadedSnap:null;
  const fallbackStu=(tab&&tab.id==='regular'&&typeof _DEFAULT_STU!=='undefined')?_DEFAULT_STU:[];
  const students=_attendanceStudentsForDate(snap?snap.students:loadJSON(cfg.stuKey,fallbackStu),ds,!!snap);
  const instMap=snap?(snap.inst||{}):loadJSON(cfg.instKey,{});
  const stuIdx={};
  (Array.isArray(students)?students:[]).forEach(s=>{
    if(!s) return;
    stuIdx[s.t+'/'+s.d+'/'+s.l+'/'+s.r]=s;
  });
  return {tab, cfg, students:Array.isArray(students)?students:[], instMap, stuIdx};
}
function getAttendanceStorageKeys(tabId){
  const tab=_tabById(tabId||_activeTab);
  if(tab?.type==='bangteuk'){
    return {
      attendance:'swim_bt_attendance_'+tab.id,
      attGuests:'swim_bt_att_guests_'+tab.id,
      daySnapshot:'swim_bt_day_snapshot_'+tab.id,
    };
  }
  return {
    attendance:STORAGE_KEYS.ATTENDANCE,
    attGuests:STORAGE_KEYS.ATT_GUESTS,
    daySnapshot:STORAGE_KEYS.DAY_SNAPSHOT,
  };
}
const ATTENDANCE_DAY_SNAPSHOT_PREFIX='zz_swim_day_snapshot__';
const ATTENDANCE_DAY_SNAPSHOT_CACHE_LIMIT=18;
const _attendanceDaySnapshotCache=new Map();
const _attendanceDaySnapshotLoads=new Map();
const _attendanceLegacySnapshotCache=new Map();
const _attendanceLegacySnapshotLoads=new Map();

function _attendanceSnapshotSourceTab(tabId){
  let tab=(tabId&&typeof tabId==='object')?tabId:_tabById(tabId||_activeTab);
  if(tab?.type==='snapshot'&&tab.sourceTabId){
    const source=_tabById(tab.sourceTabId);
    if(source) tab=source;
    else if(tab.sourceTabType==='bangteuk') tab={id:tab.sourceTabId,type:'bangteuk'};
  }
  return tab;
}
function _attendanceDaySnapshotScope(tabId){
  const tab=_attendanceSnapshotSourceTab(tabId);
  if(tab?.type==='bangteuk'){
    return 'bt_'+String(tab.id||'bangteuk').replace(/[^\w-]/g,'_');
  }
  return 'regular';
}
function getAttendanceDaySnapshotStorageKey(tabId,ds){
  return ATTENDANCE_DAY_SNAPSHOT_PREFIX+_attendanceDaySnapshotScope(tabId)+'__'+String(ds||'');
}
function _attendanceLegacySnapshotKey(tabId){
  const tab=_attendanceSnapshotSourceTab(tabId);
  return tab?.type==='bangteuk'?'swim_bt_day_snapshot_'+tab.id:STORAGE_KEYS.DAY_SNAPSHOT;
}
function _isAttendanceDaySnapshot(value){
  return !!(value&&typeof value==='object'&&!Array.isArray(value)&&Array.isArray(value.students));
}
function _syncAttendanceDaySnapshot(tabId,ds,snapshot){
  if(typeof DAY_SNAPSHOT==='undefined') return;
  if(typeof isSnapshotTab==='function'&&isSnapshotTab()) return;
  if(_attendanceDaySnapshotScope(_activeTab)!==_attendanceDaySnapshotScope(tabId)) return;
  if(snapshot) DAY_SNAPSHOT[ds]=snapshot;
  else delete DAY_SNAPSHOT[ds];
}
function cacheAttendanceDaySnapshot(tabId,ds,snapshot){
  const key=getAttendanceDaySnapshotStorageKey(tabId,ds);
  _attendanceDaySnapshotCache.delete(key);
  _attendanceDaySnapshotCache.set(key,snapshot||null);
  while(_attendanceDaySnapshotCache.size>ATTENDANCE_DAY_SNAPSHOT_CACHE_LIMIT){
    const oldest=_attendanceDaySnapshotCache.keys().next().value;
    const oldValue=_attendanceDaySnapshotCache.get(oldest);
    _attendanceDaySnapshotCache.delete(oldest);
    if(typeof releaseDeferredJSONMemory==='function') releaseDeferredJSONMemory(oldest);
    const split=String(oldest).lastIndexOf('__');
    const oldDs=split>=0?String(oldest).slice(split+2):'';
    if(oldDs&&typeof DAY_SNAPSHOT!=='undefined'&&DAY_SNAPSHOT[oldDs]===oldValue) delete DAY_SNAPSHOT[oldDs];
  }
  _syncAttendanceDaySnapshot(tabId,ds,snapshot||null);
  return snapshot||null;
}
function getLoadedAttendanceDaySnapshot(tabId,ds){
  const key=getAttendanceDaySnapshotStorageKey(tabId,ds);
  if(!_attendanceDaySnapshotCache.has(key)) return null;
  const value=_attendanceDaySnapshotCache.get(key);
  _attendanceDaySnapshotCache.delete(key);
  _attendanceDaySnapshotCache.set(key,value);
  return value||null;
}
function getLoadedAttendanceDaySnapshotMap(tabId){
  const prefix=ATTENDANCE_DAY_SNAPSHOT_PREFIX+_attendanceDaySnapshotScope(tabId)+'__';
  const out={};
  _attendanceDaySnapshotCache.forEach((snapshot,key)=>{
    if(snapshot&&key.startsWith(prefix)) out[key.slice(prefix.length)]=snapshot;
  });
  return out;
}
async function _loadLegacyAttendanceDaySnapshotMap(tabId){
  const legacyKey=_attendanceLegacySnapshotKey(tabId);
  if(_attendanceLegacySnapshotCache.has(legacyKey)) return _attendanceLegacySnapshotCache.get(legacyKey);
  if(_attendanceLegacySnapshotLoads.has(legacyKey)) return _attendanceLegacySnapshotLoads.get(legacyKey);
  const pending=loadDeferredJSON(legacyKey,{}).then(map=>{
    const value=(map&&typeof map==='object'&&!Array.isArray(map))?map:{};
    _attendanceLegacySnapshotCache.set(legacyKey,value);
    return value;
  }).catch(error=>{
    console.warn('legacy day snapshot load failed',legacyKey,error);
    _attendanceLegacySnapshotCache.set(legacyKey,{});
    return {};
  }).finally(()=>_attendanceLegacySnapshotLoads.delete(legacyKey));
  _attendanceLegacySnapshotLoads.set(legacyKey,pending);
  return pending;
}
async function ensureAttendanceDaySnapshotLoaded(ds,tabId,force){
  if(!ds) return null;
  const basisTab=tabId?_attendanceSnapshotSourceTab(tabId):getAttendanceBasisTabForDate(ds);
  const targetTabId=basisTab?.id||tabId||_activeTab;
  const key=getAttendanceDaySnapshotStorageKey(targetTabId,ds);
  if(force){
    if(_attendanceDaySnapshotLoads.has(key)) await _attendanceDaySnapshotLoads.get(key);
    _attendanceDaySnapshotCache.delete(key);
    if(typeof releaseDeferredJSONMemory==='function') releaseDeferredJSONMemory(key);
  }
  if(_attendanceDaySnapshotCache.has(key)) return getLoadedAttendanceDaySnapshot(targetTabId,ds);
  if(_attendanceDaySnapshotLoads.has(key)) return _attendanceDaySnapshotLoads.get(key);

  const pending=(async()=>{
    let snapshot=await loadDeferredJSON(key,null);
    if(!_isAttendanceDaySnapshot(snapshot)){
      const legacy=await _loadLegacyAttendanceDaySnapshotMap(targetTabId);
      const old=legacy&&legacy[ds];
      snapshot=_isAttendanceDaySnapshot(old)?_tabCloneSafe(old,null):null;
    }
    if(key!==getAttendanceDaySnapshotStorageKey(targetTabId,ds)) return snapshot||null;
    return cacheAttendanceDaySnapshot(targetTabId,ds,snapshot);
  })().catch(error=>{
    console.warn('day snapshot load failed',key,error);
    if(key!==getAttendanceDaySnapshotStorageKey(targetTabId,ds)) return null;
    return cacheAttendanceDaySnapshot(targetTabId,ds,null);
  }).finally(()=>_attendanceDaySnapshotLoads.delete(key));
  _attendanceDaySnapshotLoads.set(key,pending);
  return pending;
}
function ensureAttendanceDaySnapshotsLoaded(dates){
  return Promise.all([...new Set((dates||[]).filter(Boolean))].map(ds=>ensureAttendanceDaySnapshotLoaded(ds)));
}
function removeAttendanceDaySnapshotsForTab(tab){
  if(!tab||tab.type!=='bangteuk') return;
  const dates=new Set();
  const scope=_attendanceDaySnapshotScope(tab);
  const prefix=ATTENDANCE_DAY_SNAPSHOT_PREFIX+scope+'__';
  _attendanceDaySnapshotCache.forEach((value,key)=>{
    if(key.startsWith(prefix)) dates.add(key.slice(prefix.length));
  });
  if(tab.seasonStart&&tab.seasonEnd){
    const cur=new Date(tab.seasonStart+'T12:00:00');
    const end=new Date(tab.seasonEnd+'T12:00:00');
    for(let guard=0;cur<=end&&guard<370;guard++){
      dates.add(toDateStr(cur));
      cur.setDate(cur.getDate()+1);
    }
  }
  dates.forEach(ds=>{
    const key=ATTENDANCE_DAY_SNAPSHOT_PREFIX+scope+'__'+ds;
    _attendanceDaySnapshotCache.delete(key);
    dbRemove(key);
  });
  _attendanceLegacySnapshotCache.delete('swim_bt_day_snapshot_'+tab.id);
}
function _tabBasisBadge(tab){
  if(!tab||tab.type==='snapshot') return '';
  if(tab.type==='bangteuk'){
    if(tab.seasonStart&&tab.seasonEnd) return tab.seasonStart.slice(5).replace('-','/')+'~'+tab.seasonEnd.slice(5).replace('-','/');
    return '기간 미설정';
  }
  const main=_mainTabSetting();
  if(main.tabId===tab.id || (!main.tabId&&tab.id==='regular')) return '';
  return (_tabPeriodMonth(tab)||'월 미설정').replace('-','.');
}
function _parseTabStored(raw,fallback){
  if(raw===undefined||raw===null) return _tabClone(fallback);
  try{
    const parsed=typeof raw==='string'?JSON.parse(raw):raw;
    return parsed===undefined||parsed===null?_tabClone(fallback):parsed;
  }catch(e){
    return _tabClone(fallback);
  }
}
function _normalizeTabList(list){
  list=Array.isArray(list)?list:[];
  if(!list.length) list=[{id:'regular',name:'5월출석부',type:'regular',periodMonth:'2026-05'}];
  if(!list.some(t=>t&&t.id==='regular')){
    list.unshift({id:'regular',name:'5월출석부',type:'regular',periodMonth:'2026-05'});
  }
  return list.filter(tab=>tab&&tab.id).map(tab=>{
    if(tab.id==='regular'){
      if(!tab.periodMonth) tab.periodMonth='2026-05';
      if(tab.name==='정규시간표') tab.name='5월출석부';
    }
    return tab;
  });
}
function _normalizeTabFolders(list){
  return [...new Set((Array.isArray(list)?list:[])
    .map(f=>String(f||'').trim())
    .filter(Boolean))];
}
function _cacheTabValue(key,val){
  const json=JSON.stringify(val);
  _dbCache[key]=json;
  try{localStorage.setItem(_lsKey(key),json);}catch(e){}
}
function _tabStateFromRoot(root){
  return {
    tabs:_normalizeTabList(_parseTabStored(root?.[STORAGE_KEYS.TAB_LIST], _tabList)),
    folders:_normalizeTabFolders(_parseTabStored(root?.[STORAGE_KEYS.TAB_FOLDERS], _tabFolderList)),
    parent:_parseTabStored(root?.[STORAGE_KEYS.PARENT_TAB], loadJSON(STORAGE_KEYS.PARENT_TAB, null)||{}),
    main:_parseTabStored(root?.[STORAGE_KEYS.MAIN_TAB], loadJSON(STORAGE_KEYS.MAIN_TAB, null)||{}),
  };
}
function _applyTabState(state,keys){
  const set=new Set(keys||[]);
  if(set.has(STORAGE_KEYS.TAB_LIST)){
    _tabList=_normalizeTabList(state.tabs);
    _cacheTabValue(STORAGE_KEYS.TAB_LIST,_tabList);
  }
  if(set.has(STORAGE_KEYS.TAB_FOLDERS)){
    _tabFolderList=_normalizeTabFolders(state.folders);
    _cacheTabValue(STORAGE_KEYS.TAB_FOLDERS,_tabFolderList);
  }
  if(set.has(STORAGE_KEYS.PARENT_TAB)){
    _cacheTabValue(STORAGE_KEYS.PARENT_TAB,state.parent||{});
  }
  if(set.has(STORAGE_KEYS.MAIN_TAB)){
    _cacheTabValue(STORAGE_KEYS.MAIN_TAB,state.main||{});
  }
}
function updateTabSettingsTx(keys,mutator,meta){
  keys=[...new Set((keys||[]).filter(Boolean))];
  if(!keys.length) return Promise.resolve(false);
  if(typeof canPersistScheduleData==='function' && !canPersistScheduleData(keys[0],meta?.label||'시간표 탭 설정')){
    return Promise.reject(new Error('서버 데이터 로드 실패 상태라 저장이 차단되었습니다'));
  }
  const auditPoint=(typeof createAuditPoint==='function')
    ? createAuditPoint(keys,{type:'edit',label:meta?.label||'시간표 탭 설정'})
    : null;
  const applyLocal=()=>{
    const state={
      tabs:_normalizeTabList(_tabClone(_tabList)),
      folders:_normalizeTabFolders(_tabClone(_tabFolderList)),
      parent:loadJSON(STORAGE_KEYS.PARENT_TAB, null)||{},
      main:loadJSON(STORAGE_KEYS.MAIN_TAB, null)||{},
    };
    const result=mutator(state);
    if(result===undefined) return false;
    _applyTabState(state,keys);
    keys.forEach(key=>{
      if(key===STORAGE_KEYS.TAB_LIST) saveJSON(key,_tabList,true);
      else if(key===STORAGE_KEYS.TAB_FOLDERS) saveJSON(key,_tabFolderList,true);
      else if(key===STORAGE_KEYS.PARENT_TAB) saveJSON(key,state.parent||{},true);
      else if(key===STORAGE_KEYS.MAIN_TAB) saveJSON(key,state.main||{},true);
    });
    if(auditPoint&&typeof recordAuditPoint==='function') recordAuditPoint(auditPoint,keys,meta);
    return true;
  };
  if(!_fbReady||!_fb){
    return Promise.resolve(applyLocal());
  }
  const runTx=typeof _fb.transactionKeys==='function'
    ? fn=>_fb.transactionKeys(keys,fn)
    : fn=>_fb.transaction(fn);
  return runTx(root=>{
    root=root||{};
    const state=_tabStateFromRoot(root);
    const result=mutator(state);
    if(result===undefined) return;
    if(keys.includes(STORAGE_KEYS.TAB_LIST)) root[STORAGE_KEYS.TAB_LIST]=JSON.stringify(_normalizeTabList(state.tabs));
    if(keys.includes(STORAGE_KEYS.TAB_FOLDERS)) root[STORAGE_KEYS.TAB_FOLDERS]=JSON.stringify(_normalizeTabFolders(state.folders));
    if(keys.includes(STORAGE_KEYS.PARENT_TAB)) root[STORAGE_KEYS.PARENT_TAB]=JSON.stringify(state.parent||{});
    if(keys.includes(STORAGE_KEYS.MAIN_TAB)) root[STORAGE_KEYS.MAIN_TAB]=JSON.stringify(state.main||{});
    return root;
  }).then(res=>{
    if(!res.committed) throw new Error('탭 설정 저장이 취소되었습니다');
    const state=_tabStateFromRoot(res.snapshot.val()||{});
    _applyTabState(state,keys);
    if(auditPoint&&typeof recordAuditPoint==='function') recordAuditPoint(auditPoint,keys,meta);
    return true;
  });
}
function saveTabList(){
  return updateTabSettingsTx([STORAGE_KEYS.TAB_LIST],state=>{
    state.tabs=_normalizeTabList(_tabClone(_tabList));
    return state;
  },{label:'시간표 목록 저장'});
}
function saveTabFolders(){
  return updateTabSettingsTx([STORAGE_KEYS.TAB_FOLDERS],state=>{
    state.folders=_normalizeTabFolders(_tabClone(_tabFolderList));
    return state;
  },{label:'시간표 폴더 저장'});
}
function _tabEsc(s){
  return String(s??'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}
function _tabFolderStateKey(){
  return (typeof _lsKey==='function') ? _lsKey('tab_folder_collapsed') : 'tab_folder_collapsed';
}
function _loadCollapsedTabFolders(){
  try{return JSON.parse(localStorage.getItem(_tabFolderStateKey())||'{}')||{};}catch(e){return {};}
}
function _saveCollapsedTabFolders(){
  try{localStorage.setItem(_tabFolderStateKey(),JSON.stringify(_collapsedTabFolders));}catch(e){}
}
let _collapsedTabFolders=_loadCollapsedTabFolders();
function _tabFolderName(tab){
  const name=String(tab?.folder||'').trim();
  return name||'';
}
function _folderedTabGroups(){
  const groups=[];
  const folders={};
  (_tabFolderList||[]).forEach(folder=>{
    folder=String(folder||'').trim();
    if(!folder||folders[folder]) return;
    folders[folder]={folder,items:[]};
    groups.push(folders[folder]);
  });
  _tabList.forEach((tab,i)=>{
    const folder=_tabFolderName(tab);
    const item={tab,i};
    if(!folder){
      groups.push({folder:'',items:[item]});
      return;
    }
    if(!folders[folder]){
      folders[folder]={folder,items:[]};
      groups.push(folders[folder]);
    }
    folders[folder].items.push(item);
  });
  return groups;
}
async function renameTabFolder(oldName){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','폴더 이름 변경')) return;
  const name=prompt('폴더 이름:', oldName);
  if(name===null) return;
  const folder=name.trim();
  if(!folder) return;
  try{
    await updateTabSettingsTx([STORAGE_KEYS.TAB_LIST,STORAGE_KEYS.TAB_FOLDERS],state=>{
      state.tabs.forEach(tab=>{ if(_tabFolderName(tab)===oldName) tab.folder=folder; });
      state.folders=state.folders.map(f=>f===oldName?folder:f);
      if(!state.folders.includes(folder)) state.folders.push(folder);
      state.folders=_normalizeTabFolders(state.folders);
      return state;
    },{label:'폴더 이름 변경',target:folder,detail:`${oldName} → ${folder}`});
    if(_collapsedTabFolders[oldName]){
      delete _collapsedTabFolders[oldName];
      _collapsedTabFolders[folder]=true;
      _saveCollapsedTabFolders();
    }
    renderTabBar();
    toast('폴더 이름 변경: '+folder,'ok');
  }catch(e){
    console.error(e);
    toast('폴더 이름 변경 실패','err');
  }
}
async function deleteTabFolder(folder){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','폴더 삭제')) return;
  folder=String(folder||'').trim();
  if(!folder) return;
  const count=(_tabList||[]).filter(tab=>_tabFolderName(tab)===folder).length;
  if(count){
    toast('비어있는 폴더만 삭제할 수 있어요','err');
    return;
  }
  if(!confirm('빈 폴더를 삭제하시겠습니까?')) return;
  try{
    await updateTabSettingsTx([STORAGE_KEYS.TAB_FOLDERS],state=>{
      state.folders=state.folders.filter(f=>String(f||'').trim()!==folder);
      return state;
    },{label:'빈 폴더 삭제',target:folder});
    delete _collapsedTabFolders[folder];
    _saveCollapsedTabFolders();
    renderTabBar();
    toast('폴더 삭제 완료','ok');
  }catch(e){
    console.error(e);
    toast('폴더 삭제 실패','err');
  }
}
function _tabFolders(){
  return [...new Set([
    ...(_tabFolderList||[]),
    ...(_tabList||[]).map(_tabFolderName)
  ].map(f=>String(f||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
}
function _ensureTabFolder(folder){
  folder=String(folder||'').trim();
  if(!folder) return false;
  if(!_tabFolderList.includes(folder)){
    _tabFolderList.push(folder);
    return true;
  }
  return false;
}
let _newTabType='bangteuk';
function _syncNewTabPeriodFields(){
  const reg=document.querySelector('[data-tab-period-regular]');
  const bt=document.querySelector('[data-tab-period-bangteuk]');
  if(reg) reg.style.display=_newTabType==='regular'?'block':'none';
  if(bt) bt.style.display=_newTabType==='bangteuk'?'block':'none';
}
function openNewTabModal(){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','시간표 편집')) return;
  _newTabType='bangteuk';
  const modal=document.getElementById('tab-modal');
  const nameEl=document.getElementById('tab-new-name');
  const folderEl=document.getElementById('tab-new-folder');
  const folderNameEl=document.getElementById('tab-new-folder-name');
  if(!modal||!nameEl||!folderEl||!folderNameEl) return;

  modal.querySelectorAll('[data-tab-type]').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.tabType===_newTabType);
  });
  _syncNewTabPeriodFields();
  nameEl.value='';
  const pm=document.getElementById('tab-period-month');
  const ss=document.getElementById('tab-season-start');
  const se=document.getElementById('tab-season-end');
  if(pm) pm.value=_defaultPeriodMonth();
  if(ss) ss.value='';
  if(se) se.value='';
  const activeFolder=_tabFolderName(_tabList.find(t=>t.id===_activeTab));
  const folders=_tabFolders();
  let html='<option value="">폴더 없음</option>';
  if(activeFolder) html+='<option value="__active__">현재 폴더 ('+_tabEsc(activeFolder)+')</option>';
  folders.forEach(folder=>{
    if(folder===activeFolder) return;
    html+='<option value="'+_tabEsc(folder)+'">'+_tabEsc(folder)+'</option>';
  });
  html+='<option value="__new__">새 폴더 만들기</option>';
  folderEl.innerHTML=html;
  folderEl.value=activeFolder?'__active__':'';
  folderNameEl.value='';
  folderNameEl.style.display='none';
  modal.classList.add('show');
  setTimeout(()=>nameEl.focus(),30);
}
function _selectedNewTabFolder(){
  const folderEl=document.getElementById('tab-new-folder');
  const folderNameEl=document.getElementById('tab-new-folder-name');
  const val=folderEl?.value||'';
  if(val==='__active__') return _tabFolderName(_tabList.find(t=>t.id===_activeTab));
  if(val==='__new__') return (folderNameEl?.value||'').trim();
  return val.trim();
}
async function createTabFromModal(){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','시간표 편집')) return;
  const modal=document.getElementById('tab-modal');
  const name=(document.getElementById('tab-new-name')?.value||'').trim();
  const folderEl=document.getElementById('tab-new-folder');
  if(folderEl?.value==='__new__'&&!_selectedNewTabFolder()){
    toast('새 폴더 이름을 입력하세요','err');
    return;
  }
  const folder=_selectedNewTabFolder();
  if(!name&&folderEl?.value==='__new__'&&folder){
    try{
      await updateTabSettingsTx([STORAGE_KEYS.TAB_FOLDERS],state=>{
        if(!state.folders.includes(folder)) state.folders.push(folder);
        state.folders=_normalizeTabFolders(state.folders);
        return state;
      },{label:'폴더 생성',target:folder});
      _collapsedTabFolders[folder]=false;
      _saveCollapsedTabFolders();
      if(modal) modal.classList.remove('show');
      renderTabBar();
      toast('폴더 생성: '+folder,'ok');
    }catch(e){
      console.error(e);
      toast('폴더 생성 실패','err');
    }
    return;
  }
  if(!name){toast('시간표 이름을 입력하세요','err');return;}
  const type=_newTabType;
  if(type==='regular'){
    toast('정규 운영 시간표는 메인 1개만 사용하고, 저장본은 스냅샷으로 남겨주세요','err');
    return;
  }
  const id=(type==='regular'?'reg':'bt')+'_'+Date.now();
  const newTab={id,name,type};
  if(type==='regular'){
    const periodMonth=(document.getElementById('tab-period-month')?.value||'').trim();
    if(!periodMonth){toast('운영 월을 선택하세요','err');return;}
    newTab.periodMonth=periodMonth;
  } else if(type==='bangteuk'){
    const seasonStart=(document.getElementById('tab-season-start')?.value||'').trim();
    const seasonEnd=(document.getElementById('tab-season-end')?.value||'').trim();
    if((seasonStart&&!seasonEnd)||(!seasonStart&&seasonEnd)){toast('방특 시작일과 종료일을 모두 선택하세요','err');return;}
    if(seasonStart&&seasonEnd&&seasonStart>seasonEnd){toast('방특 시작일이 종료일보다 늦습니다','err');return;}
    if(seasonStart&&seasonEnd){newTab.seasonStart=seasonStart;newTab.seasonEnd=seasonEnd;}
  }
  if(folder) newTab.folder=folder;
  try{
    await updateTabSettingsTx([STORAGE_KEYS.TAB_LIST,STORAGE_KEYS.TAB_FOLDERS],state=>{
      state.tabs.push(newTab);
      if(folder&&!state.folders.includes(folder)) state.folders.push(folder);
      state.folders=_normalizeTabFolders(state.folders);
      return state;
    },{label:'시간표 생성',target:name,detail:folder?`폴더 ${folder}`:''});
    if(folder) _collapsedTabFolders[folder]=false;
    _saveCollapsedTabFolders();
    _activeTab=id;
    if(modal) modal.classList.remove('show');
    switchTabView();
  }catch(e){
    console.error(e);
    toast('시간표 생성 실패','err');
  }
}

let _tabActionMenu=null;
function _closeTabActionMenu(){
  if(_tabActionMenu){
    _tabActionMenu.remove();
    _tabActionMenu=null;
  }
}
function _openTabActionMenu(anchor, html){
  _closeTabActionMenu();
  const menu=document.createElement('div');
  menu.className='tab-action-menu';
  menu.innerHTML=html;
  document.body.appendChild(menu);
  _tabActionMenu=menu;
  const rect=anchor.getBoundingClientRect();
  const mw=menu.offsetWidth||170;
  const left=Math.min(Math.max(8, rect.right-mw), Math.max(8, window.innerWidth-mw-8));
  const top=Math.min(rect.bottom+6, window.innerHeight-(menu.offsetHeight||220)-8);
  menu.style.left=Math.round(left)+'px';
  menu.style.top=Math.round(Math.max(8, top))+'px';
}
function _menuBtn(action,id,label,extraCls='',attrs=''){
  return '<button type="button" class="'+extraCls+'" data-tab-menu-action="'+action+'" data-tab-menu-id="'+_tabEsc(id)+'" '+attrs+'>'+label+'</button>';
}
function _menuSep(){
  return '<div class="tab-menu-sep"></div>';
}
function _menuLabel(label){
  return '<div class="tab-menu-label">'+_tabEsc(label)+'</div>';
}
function _tabStorageKeys(tab){
  const id=String(tab?.id||'regular');
  if(tab?.type==='bangteuk'){
    return {tabId:id, tabName:tab.name||'', tabType:tab.type, stuKey:'swim_bt_'+id+'_stu', instKey:'swim_bt_'+id+'_inst'};
  }
  return {
    tabId:id,
    tabName:tab?.name||'',
    tabType:tab?.type||'regular',
    stuKey:id==='regular'?'swim_students':'swim_stu_'+id,
    instKey:id==='regular'?'swim_inst':'swim_inst_'+id,
  };
}
function _parentTabSetting(){
  return loadJSON(STORAGE_KEYS.PARENT_TAB||'swim_parent_tab', null)||{};
}
function activateMainTabForStartup(){
  const next=_mainTabId(_tabList);
  if(next) _activeTab=next;
  return _activeTab;
}
function _openSingleTabMenu(tabId, anchor){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','시간표 기능')) return;
  const tab=_tabList.find(t=>t.id===tabId);
  if(!tab) return;
  const i=_tabList.findIndex(t=>t.id===tabId);
  const isSnap=tab.type==='snapshot';
  const currentFolder=_tabFolderName(tab);
  const folders=_tabFolders();
  let html='';
  html+=_menuBtn('rename',tabId,'이름 변경');
  if(!isSnap && tab.type==='bangteuk') html+=_menuBtn('basis',tabId,'방특 기간 설정');
  html+=_menuSep();
  html+=_menuLabel('폴더 이동');
  if(currentFolder) html+=_menuBtn('folder-none',tabId,'폴더에서 꺼내기');
  folders.forEach(folder=>{
    if(folder===currentFolder) return;
    html+=_menuBtn('folder-set',tabId,_tabEsc(folder),'','data-tab-folder-target="'+_tabEsc(folder)+'"');
  });
  html+=_menuBtn('folder-new',tabId,'새 폴더로 이동');
  html+=_menuSep();
  if(i>0) html+=_menuBtn('left',tabId,'왼쪽으로 이동');
  if(i<_tabList.length-1) html+=_menuBtn('right',tabId,'오른쪽으로 이동');
  if(!isSnap){
    html+=_menuSep();
    html+=_menuBtn('main-public',tabId,'메인 시간표로 지정');
    html+=_menuBtn('parent-public',tabId,'학부모 공개로 지정');
    if(!tab.type||tab.type==='regular') html+=_menuBtn('rollover',tabId,'시간표 이월하기');
    html+=_menuBtn('snapshot',tabId,'스냅샷 만들기');
  }
  if(tab.id!=='regular'){
    html+=_menuSep();
    html+=_menuBtn('delete',tabId,'시간표 삭제','danger');
  }
  _openTabActionMenu(anchor, html);
}
function _openFolderActionMenu(folder, anchor){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','폴더 관리')) return;
  folder=String(folder||'').trim();
  if(!folder) return;
  const count=(_tabList||[]).filter(tab=>_tabFolderName(tab)===folder).length;
  const collapsed=!!_collapsedTabFolders[folder];
  let html='';
  html+='<button type="button" data-folder-menu-action="toggle" data-folder-name="'+_tabEsc(folder)+'">'+(collapsed?'폴더 펼치기':'폴더 접기')+'</button>';
  html+='<button type="button" data-folder-menu-action="rename" data-folder-name="'+_tabEsc(folder)+'">폴더 이름 변경</button>';
  if(!count){
    html+=_menuSep();
    html+='<button type="button" class="danger" data-folder-menu-action="delete" data-folder-name="'+_tabEsc(folder)+'">빈 폴더 삭제</button>';
  }
  _openTabActionMenu(anchor, html);
}
async function renameTab(tabId){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','시간표 이름 변경')) return;
  const tab=_tabList.find(t=>t.id===tabId);
  if(!tab) return;
  const name=prompt('탭 이름:', tab.name);
  if(name&&name.trim()){
    const nextName=name.trim();
    try{
      await updateTabSettingsTx([STORAGE_KEYS.TAB_LIST],state=>{
        const target=state.tabs.find(t=>t.id===tabId);
        if(!target) throw new Error('시간표를 찾을 수 없습니다');
        target.name=nextName;
        return state;
      },{label:'시간표 이름 변경',target:nextName});
      renderTabBar();
      toast('탭 이름 변경: '+nextName,'ok');
    }catch(e){
      console.error(e);
      toast(e.message||'탭 이름 변경 실패','err');
    }
  }
}
async function configureTabBasis(tabId){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','운영 기준 설정')) return;
  const tab=_tabList.find(t=>t.id===tabId);
  if(!tab||tab.type==='snapshot') return;
  const patch={};
  if(tab.type==='bangteuk'){
    const start=prompt('방특 시작일 (YYYY-MM-DD)', tab.seasonStart||'');
    if(start===null) return;
    const end=prompt('방특 종료일 (YYYY-MM-DD)', tab.seasonEnd||'');
    if(end===null) return;
    if((start&&!end)||(!start&&end)){toast('시작일과 종료일을 모두 입력하세요','err');return;}
    if(start&&end&&!/^\d{4}-\d{2}-\d{2}$/.test(start)){toast('시작일 형식은 YYYY-MM-DD 입니다','err');return;}
    if(start&&end&&!/^\d{4}-\d{2}-\d{2}$/.test(end)){toast('종료일 형식은 YYYY-MM-DD 입니다','err');return;}
    if(start&&end&&start>end){toast('시작일이 종료일보다 늦습니다','err');return;}
    patch.seasonStart=start||'';
    patch.seasonEnd=end||'';
  } else {
    const val=prompt('운영 월 (YYYY-MM)', _tabPeriodMonth(tab)||_defaultPeriodMonth());
    if(val===null) return;
    if(!/^\d{4}-\d{2}$/.test(val)){toast('운영 월 형식은 YYYY-MM 입니다','err');return;}
    patch.periodMonth=val;
    patch.periodLocked=true;
  }
  try{
    await updateTabSettingsTx([STORAGE_KEYS.TAB_LIST],state=>{
      const target=state.tabs.find(t=>t.id===tabId);
      if(!target) throw new Error('시간표를 찾을 수 없습니다');
      Object.assign(target,patch);
      return state;
    },{label:'운영 기준 설정',target:tab.name||tab.id});
    renderTabBar();
    if(typeof buildTable==='function') buildTable();
    toast('운영 기준 저장 완료','ok');
  }catch(e){
    console.error(e);
    toast(e.message||'운영 기준 저장 실패','err');
  }
}
async function setTabFolder(tabId, folder){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','시간표 폴더 이동')) return;
  const tab=_tabList.find(t=>t.id===tabId);
  if(!tab) return;
  folder=String(folder||'').trim();
  try{
    await updateTabSettingsTx([STORAGE_KEYS.TAB_LIST,STORAGE_KEYS.TAB_FOLDERS],state=>{
      const target=state.tabs.find(t=>t.id===tabId);
      if(!target) throw new Error('시간표를 찾을 수 없습니다');
      if(folder){
        target.folder=folder;
        if(!state.folders.includes(folder)) state.folders.push(folder);
      }else{
        delete target.folder;
      }
      state.folders=_normalizeTabFolders(state.folders);
      return state;
    },{label:'시간표 폴더 이동',target:tab.name||tabId,detail:folder?`폴더 ${folder}`:'폴더 없음'});
    if(folder){
      _collapsedTabFolders[folder]=false;
      toast('폴더 이동: '+folder,'ok');
    }else{
      toast('폴더에서 꺼냈어요','ok');
    }
    _saveCollapsedTabFolders();
    renderTabBar();
  }catch(e){
    console.error(e);
    toast(e.message||'폴더 이동 실패','err');
  }
}
function promptNewTabFolder(tabId){
  const name=prompt('새 폴더 이름:');
  if(name===null) return;
  const folder=name.trim();
  if(!folder) return;
  setTabFolder(tabId, folder);
}
async function moveTabOrder(tabId, delta){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','시간표 순서 변경')) return;
  const i=_tabList.findIndex(t=>t.id===tabId);
  const ni=i+delta;
  if(i<0||ni<0||ni>=_tabList.length) return;
  try{
    await updateTabSettingsTx([STORAGE_KEYS.TAB_LIST],state=>{
      const idx=state.tabs.findIndex(t=>t.id===tabId);
      const nextIdx=idx+delta;
      if(idx<0||nextIdx<0||nextIdx>=state.tabs.length) return;
      [state.tabs[idx],state.tabs[nextIdx]]=[state.tabs[nextIdx],state.tabs[idx]];
      return state;
    },{label:'시간표 순서 변경',target:_tabList[i]?.name||tabId});
    renderTabBar();
  }catch(e){
    console.error(e);
    toast('순서 변경 실패','err');
  }
}
async function setParentPublicTab(tabId){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','학부모 공개 시간표 지정')) return;
  const tab=_tabList.find(t=>t.id===tabId);
  if(!tab||tab.type==='snapshot'){
    toast('스냅샷은 학부모 공개 시간표로 지정할 수 없습니다','err');
    return;
  }
  try{
    let label=tab.name||tab.id;
    await updateTabSettingsTx([STORAGE_KEYS.TAB_LIST,STORAGE_KEYS.PARENT_TAB],state=>{
      const fresh=state.tabs.find(t=>t.id===tabId);
      if(!fresh||fresh.type==='snapshot') throw new Error('학부모 공개로 지정할 수 없습니다');
      label=fresh.name||fresh.id;
      state.parent={..._tabStorageKeys(fresh), setAt:new Date().toISOString()};
      return state;
    },{label:'학부모 공개 시간표 지정',target:label});
    renderTabBar();
    toast('학부모 공개 시간표: '+label,'ok');
  }catch(e){
    console.error(e);
    toast(e.message||'학부모 공개 지정 실패','err');
  }
}
async function setMainTab(tabId){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','메인 시간표 지정')) return;
  const tab=_tabList.find(t=>t.id===tabId);
  if(!tab||tab.type==='snapshot'){
    toast('스냅샷은 메인 시간표로 지정할 수 없습니다','err');
    return;
  }
  try{
    let label=tab.name||tab.id;
    await updateTabSettingsTx([STORAGE_KEYS.TAB_LIST,STORAGE_KEYS.MAIN_TAB],state=>{
      const fresh=state.tabs.find(t=>t.id===tabId);
      if(!fresh||fresh.type==='snapshot') throw new Error('메인 시간표로 지정할 수 없습니다');
      label=fresh.name||fresh.id;
      state.main={..._tabStorageKeys(fresh), setAt:new Date().toISOString()};
      return state;
    },{label:'메인 시간표 지정',target:label});
    _activeTab=tabId;
    switchTabView();
    toast('메인 시간표: '+label,'ok');
  }catch(e){
    console.error(e);
    toast(e.message||'메인 시간표 지정 실패','err');
  }
}
async function deleteTab(tabId){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','시간표 삭제')) return;
  const id=tabId;
  const tab=_tabList.find(t=>t.id===id);
  if(!tab) return;
  if(tab.id==='regular'){
    toast('정규시간표는 삭제할 수 없습니다','err');
    return;
  }
  const name=tab.name||tab.id;
  const kind=tab.type==='snapshot'?'스냅샷':'시간표';
  if(!confirm(`${name} ${kind}을 삭제하시겠습니까?\n\n학생/담임/출석부/날짜 스냅샷 데이터가 함께 정리됩니다.`)) return;
  try{
    await updateTabSettingsTx([STORAGE_KEYS.TAB_LIST,STORAGE_KEYS.PARENT_TAB,STORAGE_KEYS.MAIN_TAB],state=>{
      const target=state.tabs.find(t=>t.id===id);
      if(!target) throw new Error('시간표를 찾을 수 없습니다');
      if(target.id==='regular') throw new Error('정규시간표는 삭제할 수 없습니다');
      state.tabs=state.tabs.filter(t=>t.id!==id);
      if(state.parent?.tabId===id) state.parent={};
      if(state.main?.tabId===id) state.main={};
      return state;
    },{label:'시간표 삭제',target:tab.name||tab.id});
    if(tab.type==='snapshot'){
      dbRemove(SNAP_KEY_PREFIX+id);
      if(_activeTab===id) _origGlobalMaps=null;
    } else if(tab.type==='bangteuk'){
      dbRemove('swim_bt_'+id+'_stu');
      dbRemove('swim_bt_'+id+'_inst');
      dbRemove('swim_bt_attendance_'+id);
      dbRemove('swim_bt_att_guests_'+id);
      dbRemove('swim_bt_day_snapshot_'+id);
      removeAttendanceDaySnapshotsForTab(tab);
    } else {
      dbRemove('swim_stu_'+id);
      dbRemove('swim_inst_'+id);
    }
    if(_activeTab===id){_activeTab=_mainTabId(_tabList);}
    switchTabView();
    toast(kind+' 삭제 완료','ok');
  }catch(e){
    console.error(e);
    toast(e.message||'시간표 삭제 실패','err');
  }
}
function _handleTabMenuAction(action,id,targetFolder=''){
  _closeTabActionMenu();
  if(action==='rename') renameTab(id);
  else if(action==='basis') configureTabBasis(id);
  else if(action==='folder-none') setTabFolder(id,'');
  else if(action==='folder-set') setTabFolder(id, targetFolder);
  else if(action==='folder-new') promptNewTabFolder(id);
  else if(action==='left') moveTabOrder(id,-1);
  else if(action==='right') moveTabOrder(id,1);
  else if(action==='main-public') setMainTab(id);
  else if(action==='parent-public') setParentPublicTab(id);
  else if(action==='rollover') rolloverScheduleTab(id);
  else if(action==='copy') copyTab(id);
  else if(action==='snapshot') createSnapshot(id);
  else if(action==='delete') deleteTab(id);
}
function _handleFolderMenuAction(action,folder){
  _closeTabActionMenu();
  if(action==='toggle'){
    _collapsedTabFolders[folder]=!_collapsedTabFolders[folder];
    _saveCollapsedTabFolders();
    renderTabBar();
  }else if(action==='rename') renameTabFolder(folder);
  else if(action==='delete') deleteTabFolder(folder);
}

/* ──── 스냅샷: 운영 시간표 상태 동결 ────
   클릭 시 현재 탭의 데이터(학생/담임/출석/결석/등원/퇴원/휴원/이동/예약)를
   캡처해 새 탭으로 만든다. 스냅샷 탭 활성화 시 전역 맵을 백업 후 스냅샷 데이터로 교체.
   날짜별 출석 명단 스냅샷은 별도 문서이므로 월 스냅샷에 중복 저장하지 않는다.
   모든 변경(저장)은 saveJSON 가드로 차단된다. */
let _origGlobalMaps=null; // 스냅샷 진입 시 백업, 떠날 때 복원
const SNAP_KEY_PREFIX='swim_snap_';

function _snapshotDataForTab(srcTab,capturedAt){
  const keys=_tabStorageKeys(srcTab);
  const active=srcTab&&srcTab.id===_activeTab&&srcTab.type!=='snapshot';
  const attKeys=getAttendanceStorageKeys(srcTab?.id);
  return {
    students:_tabCloneSafe(active&&typeof STUDENTS!=='undefined'?STUDENTS:loadJSON(keys.stuKey, []), []),
    inst:_tabCloneSafe(active&&typeof INST_MAP!=='undefined'?INST_MAP:loadJSON(keys.instKey, {}), {}),
    retire:_tabCloneSafe(typeof RETIRE_MAP!=='undefined'?RETIRE_MAP:loadJSON(STORAGE_KEYS.RETIRE, {}), {}),
    enroll:_tabCloneSafe(typeof ENROLL_MAP!=='undefined'?ENROLL_MAP:loadJSON(STORAGE_KEYS.ENROLL, {}), {}),
    mark:_tabCloneSafe(typeof MARK_MAP!=='undefined'?MARK_MAP:loadJSON(STORAGE_KEYS.MARK, {}), {}),
    disabled:_tabCloneSafe(typeof DISABLED_MAP!=='undefined'?DISABLED_MAP:loadJSON(STORAGE_KEYS.DISABLED, {}), {}),
    reserve:_tabCloneSafe(typeof RESERVE_MAP!=='undefined'?RESERVE_MAP:loadJSON(STORAGE_KEYS.RESERVE, {}), {}),
    hyuwon:_tabCloneSafe(typeof HYUWON_MAP!=='undefined'?HYUWON_MAP:loadJSON(STORAGE_KEYS.休원, {}), {}),
    move:_tabCloneSafe(typeof MOVE_MAP!=='undefined'?MOVE_MAP:loadJSON(STORAGE_KEYS.MOVE, {}), {}),
    attendance:_tabCloneSafe(active&&typeof ATTENDANCE!=='undefined'?ATTENDANCE:loadJSON(attKeys.attendance, {}), {}),
    attGuests:_tabCloneSafe(active&&typeof ATT_GUESTS!=='undefined'?ATT_GUESTS:loadJSON(attKeys.attGuests, {}), {}),
    capturedAt,
    sourceTabId:srcTab.id,
    sourceTabType:srcTab.type,
    sourceTabName:srcTab.name,
    periodMonth:_tabPeriodMonth(srcTab)||'',
  };
}

async function rolloverScheduleTab(srcId){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','시간표 이월')) return;
  const srcTab=_tabList.find(t=>t.id===srcId);
  if(!srcTab) return;
  if(srcTab.type==='snapshot'){toast('스냅샷은 이월할 수 없습니다','err');return;}
  if(srcTab.type==='bangteuk'){toast('방특은 기간 설정/스냅샷으로 관리해주세요','err');return;}
  const currentMonth=_tabPeriodMonth(srcTab)||_defaultPeriodMonth();
  const nextDefault=_addMonthsToMonthKey(currentMonth,1);
  const nextInput=prompt('이월할 운영 월 (YYYY-MM):', nextDefault);
  if(nextInput===null) return;
  const nextMonth=_normalizeMonthKey(nextInput);
  if(!nextMonth){toast('운영 월 형식은 YYYY-MM 입니다','err');return;}
  const nextNameInput=prompt('이월 후 시간표 이름:', _monthTabName(nextMonth));
  if(nextNameInput===null) return;
  const nextName=nextNameInput.trim();
  if(!nextName){toast('시간표 이름을 입력하세요','err');return;}
  const snapshotName=(srcTab.name||_monthTabName(currentMonth))+' 박제';
  const msg=[
    '현재 시간표를 "'+snapshotName+'" 스냅샷으로 박제하고',
    '운영 시간표를 "'+nextName+'"로 이월할까요?',
    '',
    '메인/학부모 공개 딱지는 이 운영 시간표에 유지됩니다.'
  ].join('\n');
  if(!confirm(msg)) return;

  const today=toDateStr(getToday());
  const newId='snap_'+Date.now();
  const snapData=_snapshotDataForTab(srcTab,today);
  dbSet(SNAP_KEY_PREFIX+newId, JSON.stringify(snapData));
  const snapTab={
    id:newId,name:snapshotName,type:'snapshot',capturedAt:today,periodMonth:currentMonth,
    sourceTabId:srcTab.id,
    sourceTabType:srcTab.type||'regular',
    sourceTabName:srcTab.name||''
  };
  if(srcTab.folder) snapTab.folder=srcTab.folder;
  try{
    await updateTabSettingsTx([STORAGE_KEYS.TAB_LIST,STORAGE_KEYS.MAIN_TAB,STORAGE_KEYS.PARENT_TAB],state=>{
      const idx=state.tabs.findIndex(t=>t.id===srcId);
      if(idx<0) throw new Error('원본 시간표를 찾을 수 없습니다');
      const live=state.tabs[idx];
      if(live.type==='snapshot'||live.type==='bangteuk') throw new Error('정규 운영 시간표만 이월할 수 있습니다');
      state.tabs.splice(idx,0,snapTab);
      live.name=nextName;
      live.periodMonth=nextMonth;
      live.periodLocked=true;
      const liveKeys=_tabStorageKeys(live);
      state.main={...liveKeys,setAt:new Date().toISOString()};
      state.parent={...liveKeys,setAt:new Date().toISOString()};
      return state;
    },{label:'시간표 이월',target:nextName,detail:`${snapshotName} → ${nextName}`});
    _activeTab=srcId;
    switchTabView();
    toast('시간표 이월 완료: '+nextName,'ok');
  }catch(e){
    console.error(e);
    dbRemove(SNAP_KEY_PREFIX+newId);
    toast(e.message||'시간표 이월 실패','err');
  }
}

let _autoRolloverRunning=false;
function _autoRolloverAllowed(){
  if(isSnapshotTab()) return false;
  if(window.SCAuth && typeof SCAuth.can==='function' && !SCAuth.can('editSchedule')) return false;
  return true;
}
function _autoSnapshotId(srcId,monthKey){
  const id=String(srcId||'regular').replace(/[^A-Za-z0-9_-]/g,'_');
  const month=String(_normalizeMonthKey(monthKey)||monthKey||'').replace(/[^0-9]/g,'');
  return 'snap_auto_'+id+'_'+month;
}
function _liveRegularMainTab(){
  const mainId=_mainTabId(_tabList);
  const main=_tabById(mainId);
  if(main && (!main.type || main.type==='regular')) return main;
  return (_tabList||[]).find(t=>t&&(!t.type||t.type==='regular'))||null;
}
async function autoRolloverRegularScheduleIfNeeded(){
  if(_autoRolloverRunning || !_autoRolloverAllowed()) return false;
  const targetMonth=_defaultPeriodMonth();
  const srcTab=_liveRegularMainTab();
  if(!srcTab || srcTab.type==='snapshot' || srcTab.type==='bangteuk') return false;
  const storedMonth=_tabStoredPeriodMonth(srcTab);
  const currentMonth=storedMonth||targetMonth;
  if(!targetMonth || !currentMonth) return false;

  const needsSnapshot=_compareMonthKey(currentMonth,targetMonth)<0;
  const needsBind=!srcTab.periodLocked || _normalizeMonthKey(srcTab.periodMonth)!==targetMonth;
  if(!needsSnapshot && !needsBind) return false;

  _autoRolloverRunning=true;
  const today=toDateStr(getToday());
  const snapId=needsSnapshot?_autoSnapshotId(srcTab.id,currentMonth):'';
  const snapshotName=_monthTabName(currentMonth)+' 박제';
  const nextName=_monthTabName(targetMonth);
  let wroteSnapshot=false;
  if(needsSnapshot){
    const snapKey=SNAP_KEY_PREFIX+snapId;
    const hasSnapshotTab=_tabList.some(t=>t&&t.id===snapId&&t.type==='snapshot');
    if(!hasSnapshotTab){
      dbSet(snapKey, JSON.stringify(_snapshotDataForTab(srcTab,today)));
      wroteSnapshot=true;
    }
  }
  try{
    await updateTabSettingsTx([STORAGE_KEYS.TAB_LIST,STORAGE_KEYS.MAIN_TAB,STORAGE_KEYS.PARENT_TAB],state=>{
      const idx=state.tabs.findIndex(t=>t&&t.id===srcTab.id);
      if(idx<0) throw new Error('자동 이월할 정규 시간표를 찾을 수 없습니다');
      const live=state.tabs[idx];
      if(live.type==='snapshot'||live.type==='bangteuk') throw new Error('정규 운영 시간표만 자동 이월할 수 있습니다');
      const liveStored=_tabStoredPeriodMonth(live)||currentMonth;
      const txNeedsSnapshot=_compareMonthKey(liveStored,targetMonth)<0;
      const txSnapId=_autoSnapshotId(live.id,liveStored);
      if(txNeedsSnapshot && !state.tabs.some(t=>t&&t.id===txSnapId)){
        const snapTab={
          id:txSnapId,
          name:_monthTabName(liveStored)+' 박제',
          type:'snapshot',
          capturedAt:today,
          periodMonth:liveStored,
          sourceTabId:live.id,
          sourceTabType:live.type||'regular',
          sourceTabName:live.name||'',
          autoRollover:true
        };
        if(live.folder) snapTab.folder=live.folder;
        state.tabs.splice(idx,0,snapTab);
      }
      const liveName=String(live.name||'').trim();
      if(txNeedsSnapshot || !liveName || liveName==='정규시간표' || /^\d{1,2}월출석부$/.test(liveName)){
        live.name=nextName;
      }
      live.periodMonth=targetMonth;
      live.periodLocked=true;
      const liveKeys=_tabStorageKeys(live);
      state.main={...liveKeys,setAt:new Date().toISOString(),autoRollover:true};
      state.parent={...liveKeys,setAt:new Date().toISOString(),autoRollover:true};
      return state;
    },{label:needsSnapshot?'정규 시간표 자동 이월':'정규 시간표 운영월 자동 설정',target:nextName,detail:needsSnapshot?`${snapshotName} → ${nextName}`:nextName});
    _activeTab=srcTab.id;
    return true;
  }catch(e){
    if(wroteSnapshot) dbRemove(SNAP_KEY_PREFIX+snapId);
    throw e;
  }finally{
    _autoRolloverRunning=false;
  }
}

async function createSnapshot(srcId){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','스냅샷 만들기')) return;
  const srcTab=_tabList.find(t=>t.id===srcId);
  if(!srcTab) return;
  if(srcTab.type==='snapshot'){toast('스냅샷의 스냅샷은 만들 수 없음','err');return;}
  const today=toDateStr(getToday());
  const name=prompt('스냅샷 이름:', srcTab.name+' ('+today+')');
  if(!name) return;
  const newId='snap_'+Date.now();
  const snapData=_snapshotDataForTab(srcTab,today);
  // 직접 dbSet (saveJSON 가드 통과 위해)
  dbSet(SNAP_KEY_PREFIX+newId, JSON.stringify(snapData));
  const snapMonth=_tabPeriodMonth(srcTab);
  const newTab={
    id:newId,name,type:'snapshot',capturedAt:today,
    sourceTabId:srcTab.id,
    sourceTabType:srcTab.type||'regular',
    sourceTabName:srcTab.name||''
  };
  if(snapMonth) newTab.periodMonth=snapMonth;
  if(srcTab.folder) newTab.folder=srcTab.folder;
  try{
    await updateTabSettingsTx([STORAGE_KEYS.TAB_LIST],state=>{
      const srcIdx=state.tabs.findIndex(t=>t.id===srcId);
      if(srcIdx<0) throw new Error('원본 시간표를 찾을 수 없습니다');
      state.tabs.splice(srcIdx+1,0,newTab);
      return state;
    },{label:'스냅샷 생성',target:name});
    _activeTab=newId;
    switchTabView();
    toast('📷 스냅샷 생성: '+name,'ok');
  }catch(e){
    console.error(e);
    dbRemove(SNAP_KEY_PREFIX+newId);
    toast(e.message||'스냅샷 생성 실패','err');
  }
}

async function copyTab(srcId){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','시간표 복사')) return;
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
  const newTab={id:newId, name, type:srcTab.type};
  if(srcTab.periodMonth) newTab.periodMonth=srcTab.periodMonth;
  if(srcTab.periodLocked) newTab.periodLocked=true;
  if(srcTab.seasonStart) newTab.seasonStart=srcTab.seasonStart;
  if(srcTab.seasonEnd) newTab.seasonEnd=srcTab.seasonEnd;
  if(srcTab.folder) newTab.folder=srcTab.folder;
  try{
    await updateTabSettingsTx([STORAGE_KEYS.TAB_LIST],state=>{
      const srcIdx=state.tabs.findIndex(t=>t.id===srcId);
      if(srcIdx<0) throw new Error('원본 시간표를 찾을 수 없습니다');
      state.tabs.splice(srcIdx+1, 0, newTab);
      return state;
    },{label:'시간표 복사',target:name,detail:`원본 ${srcTab.name||srcId}`});
    _activeTab=newId;
    switchTabView();
    toast(srcTab.name+' 복사 완료','ok');
  }catch(e){
    console.error(e);
    dbRemove(newStuKey);
    dbRemove(newInstKey);
    toast(e.message||'시간표 복사 실패','err');
  }
}

function renderTabBar(){
  const bar=document.getElementById('tab-bar');
  let html='';
  const canEditTabs=!(window.SCAuth && !SCAuth.can('editSchedule'));
  const renderTab=(tab,i)=>{
    const isSnap=tab.type==='snapshot';
    const baseCls=isSnap?'tab-btn tab-snapshot':'tab-btn';
    const cls=tab.id===_activeTab?baseCls+' active':baseCls;
    const labelTitle=isSnap?` title="📷 ${tab.capturedAt||''} 스냅샷 — 읽기 전용"`:'';
    const mainBadge=_mainTabSetting().tabId===tab.id?'<span class="main-tab-badge">메인</span>':'';
    const parentBadge=_parentTabSetting().tabId===tab.id?'<span class="parent-tab-badge">학부모</span>':'';
    const basis=_tabBasisBadge(tab);
    const basisBadge=basis?'<span class="tab-basis-badge">'+_tabEsc(basis)+'</span>':'';
    const menu=canEditTabs?`<span class="tab-menu-trigger" data-tab-menu="${_tabEsc(tab.id)}" title="시간표 기능">⋯</span>`:'';
    return `<button class="${cls}" data-tab="${_tabEsc(tab.id)}"${labelTitle}><span data-tab-rename="${_tabEsc(tab.id)}">${isSnap?'📷 ':''}${_tabEsc(tab.name)}</span>${basisBadge}${mainBadge}${parentBadge}${menu}</button>`;
  };
  _folderedTabGroups().forEach(group=>{
    if(!group.folder){
      const item=group.items[0];
      html+=renderTab(item.tab,item.i);
      return;
    }
    const hasActive=group.items.some(item=>item.tab.id===_activeTab);
    const collapsed=!!_collapsedTabFolders[group.folder]&&!hasActive;
    const folderCls='tab-folder'+(collapsed?' collapsed':'')+(hasActive?' active':'');
    const folderName=_tabEsc(group.folder);
    html+=`<div class="${folderCls}" data-tab-folder="${folderName}">`;
    html+=`<button class="tab-folder-head" data-tab-folder-toggle="${folderName}" title="폴더 접기/펼치기"><span class="tab-folder-caret">${collapsed?'▸':'▾'}</span><span class="tab-folder-name">${folderName}</span><span class="tab-folder-count">${group.items.length}</span>${canEditTabs?`<span class="tab-folder-menu" data-tab-folder-menu="${folderName}" title="폴더 기능">⋯</span>`:''}</button>`;
    html+=`<div class="tab-folder-tabs">${group.items.map(item=>renderTab(item.tab,item.i)).join('')}</div>`;
    html+=`</div>`;
  });
  if(canEditTabs) html+=`<button class="tab-add" data-tab-add title="방특 시간표 추가">＋</button>`;
  bar.innerHTML=html;
}

document.getElementById('tab-bar').addEventListener('click',function(e){
  // 시간표 기능 메뉴
  const tabMenu=e.target.closest('[data-tab-menu]');
  if(tabMenu){
    e.stopPropagation();
    _openSingleTabMenu(tabMenu.dataset.tabMenu, tabMenu);
    return;
  }
  // 폴더 기능 메뉴
  const folderMenu=e.target.closest('[data-tab-folder-menu]');
  if(folderMenu){
    e.stopPropagation();
    _openFolderActionMenu(folderMenu.dataset.tabFolderMenu, folderMenu);
    return;
  }
  // 폴더 접기/펼치기
  const folderToggle=e.target.closest('[data-tab-folder-toggle]');
  if(folderToggle){
    e.stopPropagation();
    const folder=folderToggle.dataset.tabFolderToggle;
    _collapsedTabFolders[folder]=!_collapsedTabFolders[folder];
    _saveCollapsedTabFolders();
    renderTabBar();
    return;
  }
  // 탭 삭제
  const del=e.target.closest('[data-tab-del]');
  if(del){
    deleteTab(del.dataset.tabDel);
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
    renameTab(renameBtn.dataset.tabRenameBtn);
    return;
  }
  // 탭 순서 이동
  const left=e.target.closest('[data-tab-left]');
  if(left){
    moveTabOrder(left.dataset.tabLeft,-1);
    return;
  }
  const right=e.target.closest('[data-tab-right]');
  if(right){
    moveTabOrder(right.dataset.tabRight,1);
    return;
  }
  // 탭 추가 → 모달 열기
  if(e.target.closest('[data-tab-add]')){
    openNewTabModal();
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

document.addEventListener('click',function(e){
  const tabAction=e.target.closest('[data-tab-menu-action]');
  if(tabAction){
    e.preventDefault();
    _handleTabMenuAction(tabAction.dataset.tabMenuAction, tabAction.dataset.tabMenuId, tabAction.dataset.tabFolderTarget||'');
    return;
  }
  const folderAction=e.target.closest('[data-folder-menu-action]');
  if(folderAction){
    e.preventDefault();
    _handleFolderMenuAction(folderAction.dataset.folderMenuAction, folderAction.dataset.folderName);
    return;
  }
  if(_tabActionMenu&&!e.target.closest('.tab-action-menu')) _closeTabActionMenu();
});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape') _closeTabActionMenu();
});

// 탭 이름 편집 (더블클릭)
document.getElementById('tab-bar').addEventListener('dblclick',function(e){
  const rename=e.target.closest('[data-tab-rename]');
  if(!rename) return;
  renameTab(rename.dataset.tabRename);
});

// 탭 생성 모달
document.getElementById('tab-modal').addEventListener('click',function(e){
  if(e.target.id==='tab-modal'||e.target.closest('[data-tab-cancel]')){
    document.getElementById('tab-modal').classList.remove('show');
    return;
  }
  const typeBtn=e.target.closest('[data-tab-type]');
  if(typeBtn){
    _newTabType=typeBtn.dataset.tabType;
    document.querySelectorAll('#tab-modal [data-tab-type]').forEach(btn=>{
      btn.classList.toggle('active',btn.dataset.tabType===_newTabType);
    });
    _syncNewTabPeriodFields();
    const nameEl=document.getElementById('tab-new-name');
    if(nameEl&&!nameEl.value.trim()) nameEl.placeholder=_newTabType==='regular'?'예: 6월 정규반':'예: 여름 방특반';
    return;
  }
  if(e.target.closest('[data-tab-create]')){
    createTabFromModal();
  }
});
document.getElementById('tab-new-folder')?.addEventListener('change',function(){
  const input=document.getElementById('tab-new-folder-name');
  if(input){
    input.style.display=this.value==='__new__'?'block':'none';
    if(this.value==='__new__') setTimeout(()=>input.focus(),30);
  }
});
document.getElementById('tab-modal').addEventListener('keydown',function(e){
  if(e.key==='Enter'){
    e.preventDefault();
    createTabFromModal();
  }
  if(e.key==='Escape'){
    document.getElementById('tab-modal').classList.remove('show');
  }
});

let _snapshotSwitchSeq=0;
function _showSnapshotLoading(tab){
  const wrap=document.getElementById('tbl');
  if(wrap){
    const loading=document.createElement('div');
    loading.className='snapshot-loading';
    loading.textContent=(tab?.name||'스냅샷')+' 불러오는 중...';
    wrap.replaceChildren(loading);
  }
  renderTabBar();
}
function _snapshotFallbackTabId(){
  const mainId=typeof _mainTabId==='function' ? _mainTabId(_tabList) : '';
  if(mainId&&_tabList.some(t=>t&&t.id===mainId&&t.type!=='snapshot')) return mainId;
  return _tabList.find(t=>t&&t.type!=='snapshot')?.id||'regular';
}
function _cloneSnapshotView(data){
  const source=Object.assign({},data||{});
  delete source.daySnapshot;
  if(typeof structuredClone==='function'){
    try{return structuredClone(source);}catch(e){}
  }
  return JSON.parse(JSON.stringify(source));
}
async function switchTabView(){
  const switchSeq=++_snapshotSwitchSeq;
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
    const snapKey=SNAP_KEY_PREFIX+tab.id;
    let snapData=loadJSON(snapKey, null);
    if(!snapData){
      _showSnapshotLoading(tab);
      try{
        snapData=await loadDeferredJSON(snapKey, null);
      }catch(e){
        console.error('snapshot lazy load failed',tab.id,e);
      }
      // A를 불러오는 동안 B 탭을 눌렀다면 늦게 도착한 A는 버린다.
      if(switchSeq!==_snapshotSwitchSeq||_activeTab!==tab.id) return;
    }
    if(!snapData){
      toast('스냅샷을 불러오지 못했습니다 — 운영 시간표로 복귀','err');
      _activeTab=_snapshotFallbackTabId();
      switchTabView();
      return;
    }
    // 구버전 월 스냅샷에 들어 있던 중복 날짜 명단은 메모리에서도 즉시 제외한다.
    if(Object.prototype.hasOwnProperty.call(snapData,'daySnapshot')) delete snapData.daySnapshot;
    // 백업
    _origGlobalMaps={
      retire:RETIRE_MAP, enroll:ENROLL_MAP, mark:MARK_MAP,
      disabled:DISABLED_MAP, reserve:RESERVE_MAP, hyuwon:HYUWON_MAP,
      move:MOVE_MAP, attendance:ATTENDANCE, attGuests:ATT_GUESTS,
      daySnapshot:DAY_SNAPSHOT,
    };
    // 캐시 원본을 보호하면서 화면용 상태는 한 번만 복제한다.
    const view=_cloneSnapshotView(snapData);
    STUDENTS=Array.isArray(view.students)?view.students:[];
    INST_MAP=view.inst||{};
    RETIRE_MAP=view.retire||{};
    ENROLL_MAP=view.enroll||{};
    MARK_MAP=view.mark||{};
    DISABLED_MAP=view.disabled||{};
    RESERVE_MAP=view.reserve||{};
    HYUWON_MAP=view.hyuwon||{};
    MOVE_MAP=view.move||{};
    ATTENDANCE=view.attendance||{};
    ATT_GUESTS=view.attGuests||{};
    DAY_SNAPSHOT={};
    rebuildStuIdx();
    buildTable();
    renderTabBar();
    return;
  }

  loadTabData();
  if(typeof reloadBadgeMaps==='function') reloadBadgeMaps();
  buildTable();
  renderTabBar();
  if(typeof _attendanceMode!=='undefined'&&_attendanceMode&&typeof _queueAttendanceSnapshotRefresh==='function'){
    _queueAttendanceSnapshotRefresh();
  }
}
/* ──── [v118] 시간표 자체 줌 (CSS 변수 기반) ──── */
const TBL_ZOOM_KEY='tbl_zoom';
const TBL_ZOOM_USER_KEY='tbl_zoom_user_set';
const TBL_ZOOM_MIN=0.6, TBL_ZOOM_MAX=1.5, TBL_ZOOM_STEP=0.05;
function hasUserTableZoom(){
  try{ return localStorage.getItem(TBL_ZOOM_USER_KEY)==='1'; }catch(e){ return false; }
}
function getDefaultTableZoom(){
  const w=Math.min(window.innerWidth||9999, document.documentElement?.clientWidth||9999);
  if(w<=420) return 0.62;
  if(w<=720) return 0.7;
  return 1;
}
function getTableZoom(){
  try{
    const saved=localStorage.getItem(TBL_ZOOM_KEY);
    if(saved!==null){
      const v=parseFloat(saved);
      if(isFinite(v)&&v>0){
        const autoDefault=getDefaultTableZoom();
        if(!hasUserTableZoom() && autoDefault<1 && Math.abs(v-1)<0.001) return autoDefault;
        return v;
      }
    }
  }catch(e){}
  return getDefaultTableZoom();
}
function setTableZoom(scale, persist=true){
  scale=Math.min(TBL_ZOOM_MAX, Math.max(TBL_ZOOM_MIN, Math.round(scale*100)/100));
  document.documentElement.style.setProperty('--tbl-scale', scale);
  if(persist){
    try{
      localStorage.setItem(TBL_ZOOM_KEY, String(scale));
      localStorage.setItem(TBL_ZOOM_USER_KEY, '1');
    }catch(e){}
  }
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
document.addEventListener('DOMContentLoaded',()=>{ setTableZoom(getTableZoom(), hasUserTableZoom()); });

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
