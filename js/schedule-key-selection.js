(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.SCScheduleKeySelection=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const BOOTSTRAP_KEYS=Object.freeze([
    'swim_tab_list',
    'swim_archived_tabs',
    'swim_tab_folders',
    'swim_main_tab',
    'swim_parent_tab',
  ]);

  const COMMON_KEYS=Object.freeze([
    'swim_retire',
    'swim_enroll',
    'swim_mark',
    'swim_disabled',
    'swim_reserve',
    'swim_hyuwon',
    'swim_move',
    'swim_closed',
    'swim_teachers',
    'swim_periods',
    'swim_age_year',
    'swim_student_id_version',
    'swim_ver',
  ]);

  const FIXED_DOMAINS=Object.freeze({
    swim_tab_list:'roster',swim_students:'roster',swim_inst:'roster',
    swim_retire:'workflow',swim_enroll:'workflow',swim_mark:'workflow',swim_disabled:'calendar',
    swim_reserve:'workflow',swim_hyuwon:'workflow',swim_move:'workflow',
    swim_closed:'calendar',swim_periods:'calendar',swim_main_tab:'calendar',swim_parent_tab:'calendar',
    swim_teachers:'administration',swim_tab_folders:'administration',swim_archived_tabs:'administration',
    swim_age_year:'administration',swim_student_id_version:'administration',swim_ver:'administration',
    swim_attendance:'attendance',swim_att_guests:'attendance',swim_day_snapshot:'attendance',
    swim_retire_history:'history',swim_desk_notes:'history',
  });

  function unique(values){
    return [...new Set((values||[]).map(value=>String(value||'').trim()).filter(Boolean))];
  }

  function parseStored(value,fallback){
    if(value===undefined||value===null||value==='') return fallback;
    if(typeof value!=='string') return value;
    try{return JSON.parse(value);}catch(error){return fallback;}
  }

  function normalizeTab(tab,fallbackId){
    const source=tab&&typeof tab==='object'?tab:{};
    const id=String(source.id||fallbackId||'regular').trim()||'regular';
    return Object.assign({},source,{
      id,
      type:String(source.type||'regular'),
    });
  }

  function bootstrapKeys(){
    return BOOTSTRAP_KEYS.slice();
  }

  function commonKeys(){
    return COMMON_KEYS.slice();
  }

  function initialBaseKeys(){
    return unique(BOOTSTRAP_KEYS.concat(COMMON_KEYS));
  }

  function tabKeys(tab){
    const source=normalizeTab(tab,'regular');
    if(source.type==='snapshot') return [];
    const isBangteuk=source.type==='bangteuk';
    const isDefault=source.id==='regular';
    const stuKey=String(source.stuKey||(
      isBangteuk
        ?'swim_bt_'+source.id+'_stu'
        :(isDefault?'swim_students':'swim_stu_'+source.id)
    ));
    const instKey=String(source.instKey||(
      isBangteuk
        ?'swim_bt_'+source.id+'_inst'
        :(isDefault?'swim_inst':'swim_inst_'+source.id)
    ));
    return unique([stuKey,instKey]);
  }

  function attendanceKeys(tab){
    const source=normalizeTab(tab,'regular');
    if(source.type==='snapshot') return [];
    if(source.type==='bangteuk'){
      return [
        'swim_bt_attendance_'+source.id,
        'swim_bt_att_guests_'+source.id,
      ];
    }
    return ['swim_attendance','swim_att_guests'];
  }

  function domainForKey(key){
    key=String(key||'');
    if(FIXED_DOMAINS[key]) return FIXED_DOMAINS[key];
    if(/^swim_(?:stu|inst)_[A-Za-z0-9_-]+$/.test(key)||/^swim_bt_[A-Za-z0-9_-]+_(?:stu|inst)$/.test(key)) return 'roster';
    if(/^swim_bt_(?:attendance|att_guests|day_snapshot)_[A-Za-z0-9_-]+$/.test(key)
      ||/^zz_swim_day_snapshot__(?:regular|bt_[A-Za-z0-9_-]+)__\d{4}-\d{2}-\d{2}$/.test(key)) return 'attendance';
    return '';
  }

  function tabIdForKey(key){
    key=String(key||'');
    if(['swim_students','swim_inst','swim_attendance','swim_att_guests','swim_day_snapshot'].includes(key)) return 'regular';
    let match=key.match(/^swim_(?:stu|inst)_([A-Za-z0-9_-]+)$/);
    if(match) return match[1];
    match=key.match(/^swim_bt_([A-Za-z0-9_-]+)_(?:stu|inst)$/);
    if(match) return match[1];
    match=key.match(/^swim_bt_(?:attendance|att_guests|day_snapshot)_([A-Za-z0-9_-]+)$/);
    if(match) return match[1];
    match=key.match(/^zz_swim_day_snapshot__(?:regular|bt_([A-Za-z0-9_-]+))__\d{4}-\d{2}-\d{2}$/);
    if(match) return match[1]||'regular';
    return '';
  }

  function selectionForKeys(keys,options){
    const selectedKeys=unique(keys);
    const opts=options&&typeof options==='object'?options:{};
    const inferredTabs=unique(selectedKeys.map(tabIdForKey));
    return {
      keys:selectedKeys,
      tabIds:inferredTabs.length?inferredTabs:unique(opts.tabIds),
      domains:unique(selectedKeys.map(domainForKey)),
      ...(opts.dateRange&&typeof opts.dateRange==='object'?{dateRange:opts.dateRange}:{}),
    };
  }

  function isTabOwnedKey(key){
    key=String(key||'');
    if(key==='swim_students'||key==='swim_inst') return true;
    if(/^swim_stu_.+/.test(key)||/^swim_inst_.+/.test(key)) return true;
    if(/^swim_bt_.+_(stu|inst)$/.test(key)) return true;
    if(/^swim_bt_attendance_.+/.test(key)||/^swim_bt_att_guests_.+/.test(key)) return true;
    return false;
  }

  function resolveMainTab(baseValues,fallbackTabId){
    return resolveTabPointer(baseValues,'swim_main_tab',fallbackTabId);
  }

  function resolveTabPointer(baseValues,pointerKey,fallbackTabId){
    const source=baseValues&&typeof baseValues==='object'?baseValues:{};
    const parsedTabs=parseStored(source.swim_tab_list,[]);
    const tabs=Array.isArray(parsedTabs)
      ?parsedTabs.map(tab=>normalizeTab(tab)).filter(tab=>tab.type!=='snapshot')
      :[];
    const parsedPointer=parseStored(source[String(pointerKey||'')],{});
    const pointer=parsedPointer&&typeof parsedPointer==='object'?parsedPointer:{};
    const pointerId=String(pointer.tabId||'');
    const fallbackId=String(fallbackTabId||'regular');
    const selected=tabs.find(tab=>tab.id===pointerId)
      ||tabs.find(tab=>tab.id===fallbackId)
      ||tabs.find(tab=>tab.type==='regular')
      ||tabs[0];
    const tab=selected||normalizeTab({id:fallbackId,type:'regular'},'regular');
    const keys=tabKeys(tab);
    return Object.assign({},pointer,tab,{
      id:tab.id,
      tabId:tab.id,
      tabName:String(tab.name||''),
      tabType:tab.type,
      stuKey:keys[0]||'',
      instKey:keys[1]||'',
    });
  }

  return Object.freeze({
    bootstrapKeys,
    commonKeys,
    initialBaseKeys,
    tabKeys,
    attendanceKeys,
    domainForKey,
    selectionForKeys,
    isTabOwnedKey,
    resolveTabPointer,
    resolveMainTab,
  });
});
