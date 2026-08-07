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
    'swim_requests',
    'swim_closed',
    'swim_teachers',
    'swim_periods',
    'swim_retire_history',
    'swim_desk_notes',
    'swim_age_year',
    'swim_student_id_version',
    'swim_ver',
  ]);

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

  function isTabOwnedKey(key){
    key=String(key||'');
    if(key==='swim_students'||key==='swim_inst') return true;
    if(/^swim_stu_.+/.test(key)||/^swim_inst_.+/.test(key)) return true;
    if(/^swim_bt_.+_(stu|inst)$/.test(key)) return true;
    if(/^swim_bt_attendance_.+/.test(key)||/^swim_bt_att_guests_.+/.test(key)) return true;
    return false;
  }

  function resolveMainTab(baseValues,fallbackTabId){
    const source=baseValues&&typeof baseValues==='object'?baseValues:{};
    const parsedTabs=parseStored(source.swim_tab_list,[]);
    const tabs=Array.isArray(parsedTabs)
      ?parsedTabs.map(tab=>normalizeTab(tab)).filter(tab=>tab.type!=='snapshot')
      :[];
    const parsedMain=parseStored(source.swim_main_tab,{});
    const mainId=String(parsedMain&&parsedMain.tabId||'');
    const fallbackId=String(fallbackTabId||'regular');
    const selected=tabs.find(tab=>tab.id===mainId)
      ||tabs.find(tab=>tab.id===fallbackId)
      ||tabs.find(tab=>tab.type==='regular')
      ||tabs[0];
    return selected||normalizeTab({id:fallbackId,type:'regular'},'regular');
  }

  return Object.freeze({
    bootstrapKeys,
    commonKeys,
    initialBaseKeys,
    tabKeys,
    attendanceKeys,
    isTabOwnedKey,
    resolveMainTab,
  });
});
