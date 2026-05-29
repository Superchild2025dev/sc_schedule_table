(function(global){
  const SAT_INTERNAL_TO_DISPLAY=Object.freeze({
    '1시':'9시',
    '2시':'10시',
    '3시':'11시',
    '4시':'12시',
    '5시':'1시',
    '6시':'2시'
  });
  const SAT_DISPLAY_TO_INTERNAL=Object.freeze({
    '9시':'1시',
    '09시':'1시',
    '10시':'2시',
    '11시':'3시',
    '12시':'4시',
    '13시':'5시',
    '14시':'6시',
    '오후1시':'5시',
    '오후2시':'6시',
    '오후 1시':'5시',
    '오후 2시':'6시'
  });

  function normalizeTimeText(value){
    const text=String(value||'').trim();
    const m=text.match(/^0(\d)시$/);
    return m?m[1]+'시':text;
  }
  function normalizeDayText(value){
    return String(value||'').replace(/요일/g,'').trim();
  }
  function isSaturday(day){
    return normalizeDayText(day)==='토';
  }
  function displayTimeForDay(day,time){
    const t=normalizeTimeText(time);
    return isSaturday(day) ? (SAT_INTERNAL_TO_DISPLAY[t]||t) : t;
  }
  function internalTimeForDay(day,time){
    const t=normalizeTimeText(time);
    return isSaturday(day) ? (SAT_DISPLAY_TO_INTERNAL[t]||t) : t;
  }
  function sortTimeValue(day,time){
    const internal=internalTimeForDay(day,time);
    const n=parseInt(String(internal).replace(/[^\d]/g,''),10);
    return Number.isFinite(n)?n:999;
  }
  function normalizeStudent(stu){
    if(stu&&isSaturday(stu.d)) stu.t=internalTimeForDay(stu.d,stu.t);
    return stu;
  }
  function normalizeStudents(list){
    if(!Array.isArray(list)) return [];
    return list.map(stu=>normalizeStudent(stu));
  }
  function normalizeSlotKey(key){
    const parts=String(key||'').split('/');
    if(parts.length>=2&&isSaturday(parts[1])) parts[0]=internalTimeForDay(parts[1],parts[0]);
    return parts.join('/');
  }
  function normalizeSlotMap(map){
    if(!map||typeof map!=='object'||Array.isArray(map)) return {};
    const out={};
    const entries=Object.entries(map);
    entries.forEach(([key,val])=>{
      const nk=normalizeSlotKey(key);
      if(nk!==key&&out[nk]===undefined) out[nk]=val;
    });
    entries.forEach(([key,val])=>{
      const nk=normalizeSlotKey(key);
      if(nk===key||out[nk]===undefined) out[nk]=val;
    });
    return out;
  }
  function normalizeMoveMap(map){
    const out=normalizeSlotMap(map);
    Object.keys(out).forEach(key=>{
      const v=out[key];
      if(v&&typeof v==='object'){
        if(v.dstKey) v.dstKey=normalizeSlotKey(v.dstKey);
        if(v.srcKey) v.srcKey=normalizeSlotKey(v.srcKey);
      }
    });
    return out;
  }
  function normalizeAttGuestsMap(map){
    const out=normalizeSlotMap(map);
    Object.keys(out).forEach(key=>{
      const list=Array.isArray(out[key])?out[key]:[];
      out[key]=list.map(item=>{
        if(item&&item.slotKey) item.slotKey=normalizeSlotKey(item.slotKey);
        return item;
      });
    });
    return out;
  }
  function normalizeRequest(req){
    if(!req||typeof req!=='object') return req;
    if(req.instKey) req.instKey=normalizeSlotKey(req.instKey);
    if(req.sourceInstKey) req.sourceInstKey=normalizeSlotKey(req.sourceInstKey);
    if(req.slotKey) req.slotKey=normalizeSlotKey(req.slotKey);
    if(req.sourceSlotKey) req.sourceSlotKey=normalizeSlotKey(req.sourceSlotKey);
    if(req.targetSlotKey) req.targetSlotKey=normalizeSlotKey(req.targetSlotKey);
    if(req.parent&&typeof req.parent==='object'){
      ['studentSlotKey','originalSlotKey','previousSlotKey','sourceSlotKey','sourceInstKey'].forEach(k=>{
        if(req.parent[k]) req.parent[k]=normalizeSlotKey(req.parent[k]);
      });
    }
    if(req.target&&typeof req.target==='object'){
      const day=req.target.d||req.target.day;
      if(isSaturday(day)) req.target.t=internalTimeForDay(day,req.target.t);
      if(req.target.slotKey) req.target.slotKey=normalizeSlotKey(req.target.slotKey);
    }
    return req;
  }
  function normalizeRequests(map){
    if(!map||typeof map!=='object'||Array.isArray(map)) return {};
    const out={};
    Object.entries(map).forEach(([key,val])=>{ out[key]=normalizeRequest(val); });
    return out;
  }
  function normalizeDaySnapshotMap(map){
    if(!map||typeof map!=='object'||Array.isArray(map)) return {};
    const out={};
    Object.entries(map).forEach(([ds,snap])=>{
      if(snap&&typeof snap==='object'){
        out[ds]=Object.assign({},snap,{
          students:normalizeStudents(Array.isArray(snap.students)?snap.students:[]),
          inst:normalizeSlotMap(snap.inst||{})
        });
      }else{
        out[ds]=snap;
      }
    });
    return out;
  }
  function normalizeRetireHistory(list){
    if(!Array.isArray(list)) return [];
    return list.map(item=>{
      if(item&&isSaturday(item.d)) item.t=internalTimeForDay(item.d,item.t);
      return item;
    });
  }
  function normalizeStoredValue(key,value){
    const k=String(key||'');
    if(k==='swim_students'||/^swim_stu_/.test(k)||/^swim_bt_.*_stu$/.test(k)) return normalizeStudents(value);
    if(k==='swim_inst'||/^swim_inst_/.test(k)||/^swim_bt_.*_inst$/.test(k)) return normalizeSlotMap(value);
    if(k==='swim_retire'||k==='swim_enroll'||k==='swim_mark'||k==='swim_disabled'||k==='swim_reserve'||k==='swim_hyuwon'||k==='swim_attendance'||/^swim_bt_attendance_/.test(k)) return normalizeSlotMap(value);
    if(k==='swim_move') return normalizeMoveMap(value);
    if(k==='swim_requests') return normalizeRequests(value);
    if(k==='swim_att_guests'||/^swim_bt_att_guests_/.test(k)) return normalizeAttGuestsMap(value);
    if(k==='swim_day_snapshot'||/^swim_bt_day_snapshot_/.test(k)) return normalizeDaySnapshotMap(value);
    if(k==='swim_retire_history') return normalizeRetireHistory(value);
    return value;
  }

  global.SCScheduleTime={
    SAT_INTERNAL_TO_DISPLAY,
    SAT_DISPLAY_TO_INTERNAL,
    normalizeTimeText,
    normalizeDayText,
    isSaturday,
    displayTimeForDay,
    internalTimeForDay,
    sortTimeValue,
    normalizeStudent,
    normalizeStudents,
    normalizeSlotKey,
    normalizeSlotMap,
    normalizeMoveMap,
    normalizeAttGuestsMap,
    normalizeRequest,
    normalizeRequests,
    normalizeDaySnapshotMap,
    normalizeRetireHistory,
    normalizeStoredValue
  };
})(window);
