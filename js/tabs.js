/* ════════════════════════════════════════════════════════════════
 * SECTION: 탭 시스템 (정규반/방특반)
 * ════════════════════════════════════════════════════════════════ */
let _activeTab='regular';

const _REG_BASE={
  days:['월','화','수','목','금','토'],
  times:[{t:'1시'},{t:'2시'},{t:'3시'},{t:'4시'},{t:'5시'},{t:'6시'},{t:'7시'},{t:'8시'}],
  lanes:5, hasNum:['월','토'],
  satTimeLabel:{'1시':'9시','2시':'10시','3시':'11시','4시':'12시','5시':'1시','6시':'2시'},
};
const _BT_BASE={
  days:['월','화','수','목','금'],
  times:[{t:'9시'},{t:'10시'},{t:'11시'},{t:'14시'},{t:'15시'}],
  lanes:5,
  hasNum:['월'],
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

/* ──── 탭 목록 관리 ──── */
let _tabList = loadJSON(STORAGE_KEYS.TAB_LIST, []);
if(!_tabList.length) _tabList=[{id:'regular',name:'정규시간표',type:'regular'}];
let _tabFolderList = loadJSON(STORAGE_KEYS.TAB_FOLDERS, []);
if(!Array.isArray(_tabFolderList)) _tabFolderList=[];
function _tabClone(value){
  return JSON.parse(JSON.stringify(value));
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
function _tabPeriodMonth(tab){
  if(!tab) return '';
  if(tab.periodMonth) return _normalizeMonthKey(tab.periodMonth)||String(tab.periodMonth);
  const m=String(tab.name||'').match(/(?:(20\d{2})\s*년?\s*)?(\d{1,2})\s*월/);
  if(!m) return tab.id==='regular'?'2026-05':'';
  const year=m[1]||String(_defaultPeriodMonth()).slice(0,4);
  return year+'-'+_pad2(m[2]);
}
function _tabContainsDate(tab,ds){
  if(!tab||!ds) return false;
  if(tab.type==='bangteuk'){
    return !!(tab.seasonStart&&tab.seasonEnd&&tab.seasonStart<=ds&&tab.seasonEnd>=ds);
  }
  return _tabPeriodMonth(tab)===_periodMonthForDate(ds);
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
function getAttendanceBasisDataForDate(ds){
  const tab=getAttendanceBasisTabForDate(ds);
  const cfg=_tabConfigFor(tab);
  const snapKey=getAttendanceStorageKeys(tab?.id).daySnapshot;
  const snapMap=loadJSON(snapKey,{});
  const todayStr=toDateStr(getToday());
  const snap=(ds<todayStr&&snapMap&&snapMap[ds]&&Array.isArray(snapMap[ds].students))?snapMap[ds]:null;
  const fallbackStu=(tab&&tab.id==='regular'&&typeof _DEFAULT_STU!=='undefined')?_DEFAULT_STU:[];
  const students=snap?snap.students:loadJSON(cfg.stuKey,fallbackStu);
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
function _tabBasisBadge(tab){
  if(!tab||tab.type==='snapshot') return '';
  if(tab.type==='bangteuk'){
    if(tab.seasonStart&&tab.seasonEnd) return tab.seasonStart.slice(5).replace('-','/')+'~'+tab.seasonEnd.slice(5).replace('-','/');
    return '기간 미설정';
  }
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
    };
    const result=mutator(state);
    if(result===undefined) return false;
    _applyTabState(state,keys);
    keys.forEach(key=>{
      if(key===STORAGE_KEYS.TAB_LIST) saveJSON(key,_tabList,true);
      else if(key===STORAGE_KEYS.TAB_FOLDERS) saveJSON(key,_tabFolderList,true);
      else if(key===STORAGE_KEYS.PARENT_TAB) saveJSON(key,state.parent||{},true);
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
let _newTabType='regular';
function _syncNewTabPeriodFields(){
  const reg=document.querySelector('[data-tab-period-regular]');
  const bt=document.querySelector('[data-tab-period-bangteuk]');
  if(reg) reg.style.display=_newTabType==='regular'?'block':'none';
  if(bt) bt.style.display=_newTabType==='bangteuk'?'block':'none';
}
function openNewTabModal(){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','시간표 편집')) return;
  _newTabType='regular';
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
  if(!isSnap) html+=_menuBtn('basis',tabId,tab.type==='bangteuk'?'방특 기간 설정':'운영 월 설정');
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
    html+=_menuBtn('parent-public',tabId,'학부모 공개로 지정');
    html+=_menuBtn('copy',tabId,'시간표 복사');
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
async function deleteTab(tabId){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','시간표 삭제')) return;
  if(!confirm('이 탭을 삭제하시겠습니까?')) return;
  const id=tabId;
  const tab=_tabList.find(t=>t.id===id);
  if(!tab) return;
  try{
    await updateTabSettingsTx([STORAGE_KEYS.TAB_LIST,STORAGE_KEYS.PARENT_TAB],state=>{
      const target=state.tabs.find(t=>t.id===id);
      if(!target) throw new Error('시간표를 찾을 수 없습니다');
      if(target.id==='regular') throw new Error('정규시간표는 삭제할 수 없습니다');
      state.tabs=state.tabs.filter(t=>t.id!==id);
      if(state.parent?.tabId===id) state.parent={};
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
    } else {
      dbRemove('swim_stu_'+id);
      dbRemove('swim_inst_'+id);
    }
    if(_activeTab===id){_activeTab='regular';}
    switchTabView();
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
  else if(action==='parent-public') setParentPublicTab(id);
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

/* ──── 스냅샷: 전체 상태 동결 ────
   클릭 시 현재 탭의 모든 데이터(학생/담임/출석/결석/등원/퇴원/휴원/이동/예약/스냅샷맵)를
   캡처해 새 탭으로 만든다. 스냅샷 탭 활성화 시 전역 맵을 백업 후 스냅샷 데이터로 교체.
   모든 변경(저장)은 saveJSON 가드로 차단된다. */
let _origGlobalMaps=null; // 스냅샷 진입 시 백업, 떠날 때 복원
const SNAP_KEY_PREFIX='swim_snap_';

async function createSnapshot(srcId){
  if(window.SCAuth && !SCAuth.requirePermission('editSchedule','스냅샷 만들기')) return;
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
  const newTab={id:newId,name,type:'snapshot',capturedAt:today};
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
    const parentBadge=_parentTabSetting().tabId===tab.id?'<span class="parent-tab-badge">학부모</span>':'';
    const basis=_tabBasisBadge(tab);
    const basisBadge=basis?'<span class="tab-basis-badge">'+_tabEsc(basis)+'</span>':'';
    const menu=canEditTabs?`<span class="tab-menu-trigger" data-tab-menu="${_tabEsc(tab.id)}" title="시간표 기능">⋯</span>`:'';
    return `<button class="${cls}" data-tab="${_tabEsc(tab.id)}"${labelTitle}><span data-tab-rename="${_tabEsc(tab.id)}">${isSnap?'📷 ':''}${_tabEsc(tab.name)}</span>${basisBadge}${parentBadge}${menu}</button>`;
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
  if(canEditTabs) html+=`<button class="tab-add" data-tab-add title="새 탭 추가">＋</button>`;
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
  if(typeof reloadBadgeMaps==='function') reloadBadgeMaps();
  buildTable();
  renderTabBar();
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
