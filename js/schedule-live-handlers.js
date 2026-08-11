(function(global,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  global.SCScheduleLiveHandlers=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
  function parse(value,fallback){try{return JSON.parse(value);}catch(error){return clone(fallback);}}
  function stringify(value){return JSON.stringify(value);}
  function text(value){return String(value==null?'':value).trim();}
  function metadata(input){return {
    operationId:text(input.operationId),operationType:text(input.operationType),
    tabIds:Array.isArray(input.tabIds)?input.tabIds.slice():[],
    ...(input.requireOperationManifest?{requireOperationManifest:true}:{}),
  };}
  function slotMatches(student,slotKey){
    const [time,day,lane,seat]=text(slotKey).split('/');
    return student?.t===time&&student?.d===day
      &&Number(student?.l)===Number(lane)&&Number(student?.r)===Number(seat);
  }
  function defaultIdentity(left,right){
    return text(left?.sid)&&text(left?.sid)===text(right?.sid)
      ||(text(left?.n||left?.name)===text(right?.n||right?.name)
        &&text(left?.p||left?.phone)===text(right?.p||right?.phone));
  }
  function deleteReservationPair(retire,enroll,kind,slotKey){
    const source=kind==='retire'?retire:enroll;
    const other=kind==='retire'?enroll:retire;
    const entry=source[slotKey];
    if(entry?.moveId&&entry?.pairKey){
      const paired=other[entry.pairKey];
      if(paired?.moveId===entry.moveId) delete other[entry.pairKey];
    }
    delete source[slotKey];
  }
  function clearReplacementFutureState(state,groupSlots,todayStr,options={}){
    const {retire,enroll,marks,hyuwon,disabled,requests,attendance}=state;
    const groupKeys=new Set((groupSlots||[]).map(slot=>text(slot?.slotKey||slot)));
    const preserveRetire=options.preserveRetire===true;
    const shouldPreserveRetire=typeof options.shouldPreserveRetire==='function'
      ?options.shouldPreserveRetire:()=>false;
    groupKeys.forEach(groupKey=>{
      const keepRetire=preserveRetire&&shouldPreserveRetire(retire[groupKey],groupKey);
      if(retire[groupKey]&&!keepRetire) deleteReservationPair(retire,enroll,'retire',groupKey);
      if(enroll[groupKey]) deleteReservationPair(retire,enroll,'enroll',groupKey);
      if(!keepRetire) delete retire[groupKey];
      delete enroll[groupKey];delete hyuwon[groupKey];delete disabled[groupKey];
      Object.keys(marks).forEach(markKey=>{
        const date=text(markKey.split('/').pop());
        if(markKey.startsWith(groupKey+'/')&&(!date||date>=todayStr)) delete marks[markKey];
      });
      Object.keys(attendance).forEach(attendanceKey=>{
        const date=text(attendanceKey.split('/').pop());
        if(attendanceKey.startsWith(groupKey+'/')&&(!date||date>=todayStr)) delete attendance[attendanceKey];
      });
    });
    const activeRequest=typeof options.isActiveFutureRequest==='function'?options.isActiveFutureRequest:()=>false;
    Object.values(requests).forEach(request=>{
      if(![...groupKeys].some(groupKey=>activeRequest(request,groupKey,todayStr))) return;
      request.status='cancelled';request.cancelReason='student-replaced';request.cancelledAt=options.cancelledAt||new Date().toISOString();
    });
    return state;
  }

  // This is the table's real pre-render replacement and cleanup rule. It stays
  // data-only so the live table and the V2 operation adapter share one behavior.
  function applyFutureStudentState(input={}){
    const students=clone(Array.isArray(input.students)?input.students:[]);
    const enroll=clone(input.enroll&&typeof input.enroll==='object'?input.enroll:{});
    const retire=clone(input.retire&&typeof input.retire==='object'?input.retire:{});
    const hyuwon=clone(input.hyuwon&&typeof input.hyuwon==='object'?input.hyuwon:{});
    const todayStr=text(input.todayStr);
    const periodMonth=input.periodMonth;
    const isBangteukSlotKey=typeof input.isBangteukSlotKey==='function'?input.isBangteukSlotKey:()=>false;
    const sameStudent=typeof input.sameStudent==='function'?input.sameStudent:defaultIdentity;
    const normalizeBangteukStudent=typeof input.normalizeBangteukStudent==='function'?input.normalizeBangteukStudent:null;
    const parseBangteukWeek5Name=typeof input.parseBangteukWeek5Name==='function'?input.parseBangteukWeek5Name:null;
    let blockedRetireCount=0;

    for(const [slotKey,entry] of Object.entries(retire)){
      const retirementDate=text(entry?.ds||entry);
      if(entry?.blocked||!retirementDate||retirementDate>=todayStr) continue;
      const index=students.findIndex(student=>slotMatches(student,slotKey));
      const current=index>=0?students[index]:null;
      if(current&&!sameStudent(current,entry)){
        retire[slotKey]={...(entry&&typeof entry==='object'?entry:{ds:retirementDate}),blocked:true,
          blockedReason:'student-mismatch',blockedStudentSid:current.sid||'',blockedStudentName:current.n||''};
        blockedRetireCount+=1;
        continue;
      }
      if(current) students.splice(index,1);
      if(enroll[slotKey]&&text(enroll[slotKey].ds)<retirementDate) delete enroll[slotKey];
      delete retire[slotKey];
      delete hyuwon[slotKey];
    }

    for(const [slotKey,entry] of Object.entries(enroll)){
      if(!entry||typeof entry!=='object') continue;
      const bangteuk=isBangteukSlotKey(slotKey);
      if(!bangteuk){delete entry.paid;delete entry.btNew;delete entry.btWeek5;}
      if(!bangteuk&&text(entry.ds)>todayStr) continue;
      const existing=students.find(student=>slotMatches(student,slotKey));
      if(existing&&!sameStudent(existing,entry)) continue;
      if(!existing){
        const [t,d,l,r]=slotKey.split('/');
        const student={sid:entry.sid||undefined,n:entry.name,a:entry.age||null,t,d,l:Number(l),r:Number(r)};
        ['p','v','paid','loc','memo','g'].forEach(key=>{if(entry[key]) student[key]=entry[key];});
        if(bangteuk&&(entry.btNew||entry.isNew)) student.btNew=true;
        else if(entry.isNew) student.isNew=entry.isNew;
        else if(!bangteuk&&entry.reenroll) student.reenroll=entry.reenroll;
        if(!bangteuk&&(entry.enrolled||entry.isNew||entry.reenroll)) student.enrolled=entry.ds;
        if(bangteuk&&entry.btWeek5) student.btWeek5=true;
        students.push(student);
      }
      delete enroll[slotKey];
    }

    students.forEach(student=>{
      const bangteuk=isBangteukSlotKey([student.t,student.d,student.l,student.r].join('/'));
      if(!bangteuk){delete student.paid;delete student.btWeek5;}
      if(bangteuk&&parseBangteukWeek5Name){
        const parsed=parseBangteukWeek5Name(student.n||student.name);
        if(parsed?.week5){if(student.n!=null) student.n=parsed.name;else student.name=parsed.name;student.btWeek5=true;}
      }
      if(bangteuk&&student.isNew){student.btNew=true;delete student.isNew;}
      if(student.isNew&&!bangteuk&&student.isNew!==periodMonth) delete student.isNew;
      if(student.reenroll&&(bangteuk||student.reenroll!==periodMonth)) delete student.reenroll;
      if(student.enrolled&&(bangteuk||student.enrolled<todayStr)) delete student.enrolled;
      if(bangteuk&&normalizeBangteukStudent) normalizeBangteukStudent(student);
    });
    return {students,enroll,retire,hyuwon,blockedRetireCount};
  }

  function create(options={}){
    const gateway=options.gateway;
    if(!gateway||typeof gateway.transactionKeys!=='function') throw new TypeError('operational gateway is required');
    const transaction=(keys,operation,mutator)=>gateway.transactionKeys(keys,mutator,metadata(operation));
    const contextTransaction=(keys,operation,mutator)=>{
      if(typeof options.transactionContext!=='function'||typeof mutator!=='function') return null;
      return options.transactionContext(keys,mutator,metadata(operation));
    };
    const mapUpdate=(key,operation,update)=>transaction([key],operation,root=>{
      const map=parse(root[key],{});update(map);root[key]=stringify(map);return root;
    });
    const listUpdate=(key,operation,update)=>transaction([key],operation,root=>{
      const list=parse(root[key],[]);update(list);root[key]=stringify(list);return root;
    });
    function registerStudent(input){return listUpdate(input.key,input,list=>list.push(clone(input.student)));}
    function replaceScheduledStudents(input){
      const contextual=contextTransaction(input.keys,input,input.mutateContext);
      if(contextual) return contextual;
      return transaction(input.keys,input,root=>{
      const enroll=parse(root[input.enrollKey],{});
      const retire=parse(root[input.retireKey],{});
      if(input.slotKey&&input.retireEntry) retire[input.slotKey]=clone(input.retireEntry);
      if(input.slotKey&&input.enrollEntry) enroll[input.slotKey]=clone(input.enrollEntry);
      const next=applyFutureStudentState({
        students:parse(root[input.studentKey],[]),enroll,retire,
        hyuwon:parse(root[input.hyuwonKey],{}),
        todayStr:input.todayStr,periodMonth:input.periodMonth,
        isBangteukSlotKey:input.isBangteukSlotKey,sameStudent:input.sameStudent,
        normalizeBangteukStudent:input.normalizeBangteukStudent,
        parseBangteukWeek5Name:input.parseBangteukWeek5Name,
      });
      root[input.studentKey]=stringify(next.students);root[input.enrollKey]=stringify(next.enroll);
      root[input.retireKey]=stringify(next.retire);root[input.hyuwonKey]=stringify(next.hyuwon);
      const cleanupKeys=Array.isArray(input.cleanupKeys)?input.cleanupKeys:[];
      const slotKeys=Array.isArray(input.slotKeys)&&input.slotKeys.length?input.slotKeys:[input.slotKey];
      cleanupKeys.forEach(key=>{
        const values=parse(root[key],{});
        Object.keys(values).forEach(entryKey=>{
          const matches=slotKeys.some(slotKey=>text(slotKey)&&(entryKey===text(slotKey)||entryKey.startsWith(text(slotKey)+'/')));
          const date=text(entryKey.split('/').pop());
          const directSlot=slotKeys.some(slotKey=>entryKey===text(slotKey));
          if(matches&&(directSlot||!date||date>=text(input.todayStr))) delete values[entryKey];
        });
        root[key]=stringify(values);
      });
      return root;
    });}
    function moveStudent(input){return listUpdate(input.key,input,list=>{
      const student=list.find(item=>text(item?.sid)===text(input.sid));
      if(!student) throw Object.assign(new Error('student not found'),{code:'not-found'});
      Object.assign(student,clone(input.destination));
    });}
    function updateTeachers(input){return transaction(input.keys,input,root=>{
      Object.entries(input.assignments||{}).forEach(([key,updates])=>{
        const teachers=parse(root[key],{});Object.entries(updates||{}).forEach(([slot,value])=>{teachers[slot]=clone(value);});root[key]=stringify(teachers);
      });return root;
    });}
    function setReservations(input){
      const contextual=contextTransaction(input.keys||[input.key],input,input.mutateContext);
      if(contextual) return contextual;
      let changedValue;
      return transaction(input.keys||[input.key],input,root=>{
        if(typeof input.mutate==='function'){
          const key=input.key||input.keys?.[0];
          const value=parse(root[key],input.fallback||{});
          const next=input.mutate(value);
          if(next===undefined) return undefined;
          changedValue=clone(next);
          root[key]=stringify(next);
          return root;
        }
      Object.entries(input.values||{}).forEach(([key,value])=>{root[key]=stringify(value);});return root;
      }).then(result=>changedValue===undefined?result:changedValue);
    }
    function addWaitlistEntry(input){
      const contextual=contextTransaction([input.key],input,input.mutateContext);
      if(contextual) return contextual;
      return mapUpdate(input.key,input,map=>{
      const entries=Array.isArray(map[input.slotKey])?map[input.slotKey]:[];entries.push(clone(input.entry));map[input.slotKey]=entries;
      });
    }
    function setClassMark(input){return mapUpdate(input.key,input,map=>{map[input.markKey]=clone(input.mark);});}
    function clearClassMark(input){return mapUpdate(input.key,input,map=>{delete map[input.markKey];});}
    function updateAttendance(input){
      const runtime=typeof options.getAttendanceRuntime==='function'?options.getAttendanceRuntime():null;
      if(runtime&&typeof input.mutator==='function'){
        return input.guests===true
          ?runtime.updateGuests(input.mutator,input.context||{})
          :runtime.updateAttendance(input.mutator,input.context||{});
      }
      const contextual=contextTransaction(input.keys||[input.key],input,input.mutateContext);
      if(contextual) return contextual;
      return transaction(input.keys,input,root=>{
      Object.entries(input.values||{}).forEach(([key,value])=>{root[key]=stringify(value);});return root;
      });
    }
    function createSnapshot(input){
      const writer=options.snapshotWriter;if(!writer||typeof writer.createOnly!=='function') throw new TypeError('attendance snapshot writer is required');
      return writer.createOnly(input);
    }
    function updateCalendar(input){return transaction(input.keys,input,root=>{
      Object.entries(input.values||{}).forEach(([key,value])=>{root[key]=stringify(value);});return root;
    });}
    function updateTabs(input){
      const contextual=contextTransaction(input.keys,input,input.mutateContext);
      return contextual||updateCalendar(input);
    }
    function updateManualRecords(input){
      const contextual=contextTransaction(input.keys,input,input.mutateContext);
      return contextual||updateCalendar(input);
    }
    async function prepareExportView(input){
      const loaded=await gateway.loadSelection(clone(input.selection));
      const tabId=text(input.tabId);
      const tabs=parse(loaded.root?.swim_tab_list,[]);
      return {...loaded,tabId,exportTab:clone(tabs.find(tab=>text(tab?.id)===tabId)||null),preparedFor:'schedule-export'};
    }
    function renderExportTable(input){
      const view=input?.view;
      const source=input?.source;
      if(!view?.root||!source||typeof source.cloneNode!=='function') throw new TypeError('prepared operational export view is required');
      const table=source.cloneNode(true);
      table.setAttribute('data-operational-export-primary',text(view.primary));
      table.setAttribute('data-operational-export-tab',text(view.tabId));
      return {table,tab:clone(view.exportTab),root:clone(view.root),primary:text(view.primary)};
    }
    return Object.freeze({registerStudent,replaceScheduledStudents,moveStudent,updateTeachers,setReservations,addWaitlistEntry,
      setClassMark,clearClassMark,updateAttendance,createSnapshot,updateCalendar,updateTabs,updateManualRecords,prepareExportView,renderExportTable});
  }
  return Object.freeze({applyFutureStudentState,clearReplacementFutureState,create});
});
