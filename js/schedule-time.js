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
    let text=String(value||'').trim();
    text=text.replace(/#BT(?:_PREVIEW)?/ig,'').replace(/\(?\s*방특(?:반|테스트)?\s*\)?/g,'').replace(/\bBT\b/ig,'');
    text=text.replace(/\s+/g,'').trim();
    const m=text.match(/^0(\d)시$/);
    return m?m[1]+'시':text;
  }
  function normalizeTimeBase(value){
    return normalizeTimeText(value);
  }
  function sameBaseTime(a,b){
    return normalizeTimeBase(a)===normalizeTimeBase(b);
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
  function compareTimes(day,a,b){
    return sortTimeValue(day,a)-sortTimeValue(day,b)||String(a||'').localeCompare(String(b||''),'ko');
  }
  function isBangteukInst(inst){
    return !!(inst&&typeof inst==='object'&&(inst.bt||inst.bangteuk||inst.btGroup||inst.btTabId||inst.cls==='bt'||inst.cls==='bangteuk'));
  }
  function isElmaLikeInst(inst){
    return !!(inst&&typeof inst==='object'&&(inst.elma||inst.cls==='elma'||inst.cls==='elite'||inst.cls==='master'));
  }
  function slotRowsForInst(inst,opts){
    const options=opts||{};
    if(options.bangteukTable||isBangteukInst(inst)) return 6;
    if(isElmaLikeInst(inst)) return 8;
    return 5;
  }
  function isBangteukSlot(inst,row,opts){
    const n=parseInt(row,10);
    return Number.isFinite(n)&&n>=1&&n<=6&&(opts&&opts.bangteukTable||isBangteukInst(inst));
  }
  function isBangteukSlotKey(slotKey,instMap,opts){
    const p=String(slotKey||'').split('/');
    if(p.length<4) return false;
    const instKey=p.slice(0,3).join('/');
    return isBangteukSlot(instMap&&instMap[instKey],p[3],opts);
  }
  function normalizeIdentityName(value){
    return String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
  }
  function normalizeIdentityPhone(value){
    return String(value||'').replace(/\D/g,'');
  }
  function studentIdentitySeed(stu){
    if(!stu||typeof stu!=='object') return '';
    const name=normalizeIdentityName(stu.n||stu.name);
    const phone=normalizeIdentityPhone(stu.p||stu.phone);
    if(name&&phone) return 'np|'+name+'|'+phone;
    if(name){
      const age=stu.a==null?(stu.age==null?'':String(stu.age)):String(stu.a);
      const gender=String(stu.g||stu.gender||'').trim().toLowerCase();
      return 'nag|'+name+'|'+age+'|'+gender;
    }
    const slot=[stu.t||'',stu.d||'',stu.l||'',stu.r||''].join('|');
    return slot?'slot|'+slot:'';
  }
  function stableStudentHash(value){
    const text=String(value||'');
    let h1=0xdeadbeef^text.length;
    let h2=0x41c6ce57^text.length;
    for(let i=0;i<text.length;i++){
      const ch=text.charCodeAt(i);
      h1=Math.imul(h1^ch,2654435761);
      h2=Math.imul(h2^ch,1597334677);
    }
    h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
    h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
    return (h2>>>0).toString(36).padStart(7,'0')+(h1>>>0).toString(36).padStart(7,'0');
  }
  function studentIdFor(stu){
    const existing=String(stu&&stu.sid||'').trim();
    if(existing) return existing;
    const seed=studentIdentitySeed(stu);
    return seed?'stu_'+stableStudentHash(seed):'';
  }
  function createStudentId(){
    try{
      if(global.crypto&&typeof global.crypto.randomUUID==='function'){
        return 'stu_'+global.crypto.randomUUID().replace(/-/g,'');
      }
    }catch(e){}
    return 'stu_'+Date.now().toString(36)+Math.random().toString(36).slice(2,12);
  }
  function ensureStudentId(stu){
    if(!stu||typeof stu!=='object') return stu;
    if(!String(stu.sid||'').trim()){
      const sid=studentIdFor(stu);
      if(sid) stu.sid=sid;
    }
    return stu;
  }
  function studentSlotKey(stu){
    if(!stu||typeof stu!=='object') return '';
    return [stu.t||'',normalizeDayText(stu.d),stu.l||'',stu.r||''].join('/');
  }
  function findStudentIdentityGroups(list,target,opts){
    const name=normalizeIdentityName(target&&(target.n||target.name));
    const phone=normalizeIdentityPhone(target&&(target.p||target.phone));
    if(!name||!phone) return [];
    const excluded=new Set(((opts&&opts.excludeSlotKeys)||[]).map(v=>String(v||'')));
    const groups=new Map();
    (Array.isArray(list)?list:[]).forEach(stu=>{
      if(!stu||excluded.has(studentSlotKey(stu))) return;
      if(normalizeIdentityName(stu.n||stu.name)!==name) return;
      if(normalizeIdentityPhone(stu.p||stu.phone)!==phone) return;
      const sid=studentIdFor(stu);
      if(!sid) return;
      if(!groups.has(sid)) groups.set(sid,{sid,entries:[]});
      groups.get(sid).entries.push(stu);
    });
    return [...groups.values()].sort((a,b)=>b.entries.length-a.entries.length||a.sid.localeCompare(b.sid));
  }
  function analyzeStudentIdentity(list,target,opts){
    const options=opts||{};
    const name=normalizeIdentityName(target&&(target.n||target.name));
    const phone=normalizeIdentityPhone(target&&(target.p||target.phone));
    const old=options.oldStudent||null;
    const oldName=normalizeIdentityName(old&&(old.n||old.name));
    const oldPhone=normalizeIdentityPhone(old&&(old.p||old.phone));
    const oldSid=String(old&&old.sid||'').trim();
    const excluded=new Set((options.excludeSlotKeys||[]).map(v=>String(v||'')));
    const rows=(Array.isArray(list)?list:[]).filter(stu=>stu&&!excluded.has(studentSlotKey(stu)));
    const groups=findStudentIdentityGroups(rows,{n:name,p:phone});
    const selectedSid=String(options.selectedSid||'').trim();
    const selected=groups.length===1?groups[0]:(groups.find(group=>group.sid===selectedSid)||null);
    const sameCurrent=!!(name&&(
      (oldName===name&&oldPhone===phone) ||
      (oldSid&&groups.some(group=>group.sid===oldSid))
    ));
    const uniqueBySid=matches=>{
      const seen=new Set();
      return matches.filter(stu=>{
        const sid=studentIdFor(stu)||studentSlotKey(stu);
        if(!sid||seen.has(sid)) return false;
        seen.add(sid);
        return true;
      });
    };
    const sameName=uniqueBySid(rows.filter(stu=>{
      if(!name||normalizeIdentityName(stu.n||stu.name)!==name) return false;
      return !phone||normalizeIdentityPhone(stu.p||stu.phone)!==phone;
    }));
    const samePhone=uniqueBySid(rows.filter(stu=>{
      if(!phone||normalizeIdentityPhone(stu.p||stu.phone)!==phone) return false;
      return normalizeIdentityName(stu.n||stu.name)!==name;
    }));
    let status='new';
    if(!name) status='incomplete-name';
    else if(sameCurrent) status='same-current';
    else if(!phone) status='incomplete-phone';
    else if(groups.length>1&&!selected) status='conflict';
    else if(selected) status='linked';
    return {status,name,phone,groups,selected,sameName,samePhone};
  }
  function sameStudentIdentity(a,b){
    if(!a||!b) return false;
    const aid=String(a.sid||'').trim();
    const bid=String(b.sid||'').trim();
    if(aid&&bid) return aid===bid;
    const an=normalizeIdentityName(a.n||a.name);
    const bn=normalizeIdentityName(b.n||b.name);
    if(an&&bn&&an!==bn) return false;
    const ap=normalizeIdentityPhone(a.p||a.phone);
    const bp=normalizeIdentityPhone(b.p||b.phone);
    if(ap&&bp&&ap!==bp) return false;
    const aa=a.a==null?(a.age==null?'':String(a.age)):String(a.a);
    const ba=b.a==null?(b.age==null?'':String(b.age)):String(b.a);
    if(aa&&ba&&aa!==ba) return false;
    return !!(an||bn);
  }
  function normalizeStudent(stu){
    if(stu&&isSaturday(stu.d)) stu.t=internalTimeForDay(stu.d,stu.t);
    return ensureStudentId(stu);
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
  function normalizeDaySnapshot(snap){
    if(!snap||typeof snap!=='object'||Array.isArray(snap)) return null;
    return Object.assign({},snap,{
      students:normalizeStudents(Array.isArray(snap.students)?snap.students:[]),
      inst:normalizeSlotMap(snap.inst||{})
    });
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
    if(/^zz_swim_day_snapshot__/.test(k)) return normalizeDaySnapshot(value);
    if(k==='swim_day_snapshot'||/^swim_bt_day_snapshot_/.test(k)) return normalizeDaySnapshotMap(value);
    if(k==='swim_retire_history') return normalizeRetireHistory(value);
    return value;
  }

  global.SCScheduleTime={
    SAT_INTERNAL_TO_DISPLAY,
    SAT_DISPLAY_TO_INTERNAL,
    normalizeTimeText,
    normalizeTimeBase,
    sameBaseTime,
    normalizeDayText,
    isSaturday,
    displayTimeForDay,
    internalTimeForDay,
    sortTimeValue,
    compareTimes,
    isBangteukInst,
    isElmaLikeInst,
    slotRowsForInst,
    isBangteukSlot,
    isBangteukSlotKey,
    normalizeIdentityName,
    normalizeIdentityPhone,
    studentIdentitySeed,
    studentIdFor,
    createStudentId,
    ensureStudentId,
    studentSlotKey,
    findStudentIdentityGroups,
    analyzeStudentIdentity,
    sameStudentIdentity,
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
