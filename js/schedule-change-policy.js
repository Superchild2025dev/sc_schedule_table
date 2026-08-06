(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.SCScheduleChangePolicy=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const DAY_ORDER=['월','화','수','목','금','토','일'];
  const LABELS=Object.freeze({
    retire:'퇴원',
    reduce:'횟수줄임',
    move:'이동',
    exclude:'제외',
  });
  const STATUSES=Object.freeze({
    retire:'퇴원예정',
    reduce:'횟수줄임예정',
    move:'이동예정',
    exclude:'제외예정',
  });

  function text(value){
    return String(value==null?'':value).trim();
  }

  function normalizedPhone(value){
    return text(value).replace(/\D/g,'');
  }

  function normalizedName(value){
    return text(value).replace(/\s+/g,' ');
  }

  function entryDate(entry){
    return typeof entry==='string'?text(entry):text(entry&&entry.ds||entry&&entry.retiredAt);
  }

  function entryPerson(entry,fallback){
    const source=entry&&typeof entry==='object'?entry:{};
    const base=fallback&&typeof fallback==='object'?fallback:{};
    return {
      sid:text(source.sid||base.sid),
      name:normalizedName(source.n||source.name||base.n||base.name),
      phone:normalizedPhone(source.p||source.phone||source.tel||base.p||base.phone||base.tel),
    };
  }

  function slotKeyFromHistory(record){
    if(!record||typeof record!=='object') return '';
    const values=[record.t,record.d,record.l,record.r];
    if(!values.some(value=>text(value))) return '';
    return values.map(text).join('/');
  }

  function isMoveEntry(entry,context){
    if(!entry||typeof entry!=='object') return false;
    if(text(entry.excludeReason)==='move'||text(entry.moveType)||text(entry.pairKey)) return true;
    if(context&&typeof context.isMoveEntry==='function'){
      try{ return !!context.isMoveEntry(entry); }catch(e){ return false; }
    }
    return false;
  }

  function historyMatches(entry,context){
    const history=Array.isArray(context&&context.history)?context.history:[];
    const date=entryDate(entry);
    if(!date||!history.length) return false;
    const person=entryPerson(entry,context&&context.student);
    const slotKey=text(context&&context.slotKey);
    return history.some(record=>{
      if(text(record&&record.retiredAt)!==date) return false;
      const recordSid=text(record&&record.sid);
      if(person.sid&&recordSid&&person.sid!==recordSid) return false;
      const recordName=normalizedName(record&&record.n||record&&record.name);
      if(person.name&&recordName!==person.name) return false;
      const recordPhone=normalizedPhone(record&&record.p||record&&record.phone||record&&record.tel);
      if(person.phone&&recordPhone&&person.phone!==recordPhone) return false;
      const recordSlot=slotKeyFromHistory(record);
      if(slotKey&&recordSlot&&slotKey!==recordSlot) return false;
      return true;
    });
  }

  function normalizedDayToken(slot){
    const raw=text(slot&&(
      slot.dayToken!=null?slot.dayToken:
      slot.d!=null?slot.d:
      slot.day
    ));
    if(!raw) return '';
    const days=DAY_ORDER.filter(day=>raw.includes(day));
    return days.length?days.join(''):raw;
  }

  function slotValue(slot,longKey,shortKey){
    if(!slot) return '';
    return text(slot[longKey]!=null?slot[longKey]:slot[shortKey]);
  }

  function movementReason(fromSlot,toSlot){
    if(!fromSlot||!toSlot) return '';
    if(normalizedDayToken(fromSlot)!==normalizedDayToken(toSlot)) return '일정변경';
    if(slotValue(fromSlot,'time','t')!==slotValue(toSlot,'time','t')) return '시간변경';
    if(slotValue(fromSlot,'lane','l')!==slotValue(toSlot,'lane','l')
      ||slotValue(fromSlot,'row','r')!==slotValue(toSlot,'row','r')) return '반변경';
    return '';
  }

  function isActualRetirement(entry,context){
    if(!entry) return false;
    if(entry&&typeof entry==='object'){
      if(text(entry.retireType)==='retire') return true;
      if(text(entry.retireType)==='exclude'||isMoveEntry(entry,context)) return false;
    }
    return historyMatches(entry,context||{});
  }

  function reservationKind(entry,context){
    const options=context&&typeof context==='object'?context:{};
    if(options.forceMove){
      if(entry&&typeof entry==='object'&&text(entry.excludeReason)==='reduce') return 'reduce';
      return 'move';
    }
    if(isActualRetirement(entry,context)) return 'retire';
    if(entry&&typeof entry==='object'){
      if(text(entry.excludeReason)==='reduce') return 'reduce';
      if(isMoveEntry(entry,context)) return 'move';
      if(text(entry.retireType)==='exclude') return 'exclude';
    }
    const defaultKind=text(options.defaultKind);
    if(Object.prototype.hasOwnProperty.call(LABELS,defaultKind)) return defaultKind;
    return 'exclude';
  }

  function reservationLabel(entry,context){
    return LABELS[reservationKind(entry,context)];
  }

  function reservationStatus(entry,context){
    return STATUSES[reservationKind(entry,context)];
  }

  function visibleChangeReason(input){
    const value=input&&typeof input==='object'?input:{};
    const kind=reservationKind(value.entry,value.context);
    if(kind==='retire') return LABELS.retire;
    const movement=movementReason(value.fromSlot,value.toSlot);
    if(movement) return movement;
    if(kind==='reduce') return LABELS.reduce;
    if(kind==='move') return '반변경';
    return LABELS.reduce;
  }

  function shouldSuppressGenericDelete(note){
    if(!note||typeof note!=='object'||note.manual||note.deleted) return false;
    const original=note.original&&typeof note.original==='object'?note.original:{};
    const change=text(note.change||note.reason||original.change||original.reason);
    if(change!=='삭제') return false;
    const source=text(note._source||note.source||original._source||original.source);
    if(source!=='audit') return false;
    const deleteReason=text(note.deleteReason||original.deleteReason);
    const operationType=text(note.operationType||note.type||original.operationType||original.type);
    const operationLabel=text(note.operationLabel||note.label||original.operationLabel||original.label);
    if(deleteReason==='auto-retire'||operationType==='move') return true;
    if(operationLabel==='자동 등록·제외 처리') return true;
    return /예약 이동|원생 이동|시간변경|반변경|일정변경|횟수줄임|퇴원/.test(operationLabel);
  }

  return Object.freeze({
    movementReason,
    isActualRetirement,
    reservationKind,
    reservationLabel,
    reservationStatus,
    visibleChangeReason,
    shouldSuppressGenericDelete,
  });
});
