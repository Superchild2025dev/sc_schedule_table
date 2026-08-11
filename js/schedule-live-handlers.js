(function(global,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  global.SCScheduleLiveHandlers=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
  function parse(value,fallback){try{return JSON.parse(value);}catch(error){return clone(fallback);}}
  function text(value){return String(value==null?'':value).trim();}
  function rootValue(root,key,fallback){
    const value=root?.[key];
    if(value==null) return clone(fallback);
    if(typeof value==='string') return parse(value,fallback);
    return clone(value);
  }
  function tabKeys(tab){
    const id=text(tab?.id)||'regular';
    if(tab?.type==='bangteuk') return {students:`swim_bt_${id}_stu`,instructors:`swim_bt_${id}_inst`};
    return {students:id==='regular'?'swim_students':`swim_stu_${id}`,instructors:id==='regular'?'swim_inst':`swim_inst_${id}`};
  }
  function slotKey(value){return [value?.t,value?.d,value?.l,value?.r].map(text).join('/');}
  function studentDisplay(student,enroll){
    if(student){
      const raw=text(student.n||student.name);
      const weekFive=student.btWeek5===true||/^[*＊]+\s*/.test(raw);
      const name=raw.replace(/^[*＊]+\s*/, '').trim();
      return `${student.layoutAdded?'(추가) ':''}${weekFive?'*':''}${name}${student.a||student.age||''}`;
    }
    return enroll?`${text(enroll.name||enroll.n)}${enroll.age||enroll.a||''}`:'';
  }
  function instructorDisplay(instructor){
    if(typeof instructor==='string') return text(instructor);
    if(!instructor||typeof instructor!=='object') return '';
    let value=text(instructor.n||instructor.name);
    if(instructor.lead) value='1)'+value;
    if(instructor.youth) value+='(유아)';
    if(instructor.btGroup) value+=`(${text(instructor.btGroup)} 방특)`;
    else if(instructor.bt||instructor.bangteuk||instructor.btTabId||instructor.cls==='bt'||instructor.cls==='bangteuk') value+='(방특)';
    if(instructor.cls==='elma'||instructor.elma) value+='(엘/마)';
    else if(instructor.cls==='elite') value+='(엘리트)';
    else if(instructor.cls==='master') value+='(마스터)';
    return value;
  }
  function metadata(input){
    const supplied=input?.transactionMetadata;
    if(supplied!=null&&(typeof supplied!=='object'||Array.isArray(supplied))){
      throw new TypeError('transaction metadata must be an object');
    }
    return {
      ...(supplied||{}),
      operationId:text(input?.operationId),operationType:text(input?.operationType),
      tabIds:Array.isArray(input?.tabIds)?input.tabIds.slice():[],
      ...(input?.requireOperationManifest?{requireOperationManifest:true}:{}),
    };
  }
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
    const contextTransaction=(keys,operation,mutator)=>{
      if(typeof options.transactionContext!=='function'){
        return Promise.reject(new TypeError('live transaction context is required'));
      }
      if(typeof mutator!=='function'){
        return Promise.reject(new TypeError('live transaction context mutator is required'));
      }
      return options.transactionContext(keys,mutator,metadata(operation));
    };
    function registerStudent(input){return contextTransaction([input.key],input,input.mutateContext);}
    function replaceScheduledStudents(input){
      return contextTransaction(input.keys,input,input.mutateContext);
    }
    function moveStudent(input){return contextTransaction([input.key],input,input.mutateContext);}
    function updateTeachers(input){return contextTransaction(input.keys,input,input.mutateContext);}
    function setReservations(input){
      return contextTransaction(input.keys||[input.key],input,input.mutateContext);
    }
    function addWaitlistEntry(input){
      return contextTransaction([input.key],input,input.mutateContext);
    }
    function setClassMark(input){return contextTransaction([input.key],input,input.mutateContext);}
    function clearClassMark(input){return contextTransaction([input.key],input,input.mutateContext);}
    function updateAttendance(input){
      const context=input?.context||{};
      const runtime=typeof options.getAttendanceRuntime==='function'?options.getAttendanceRuntime(context):null;
      if(!runtime||typeof runtime.updateAttendance!=='function'||typeof runtime.updateGuests!=='function'){
        return Promise.reject(new TypeError('live attendance runtime is required'));
      }
      if(typeof input.mutator!=='function'){
        return Promise.reject(new TypeError('live attendance runtime mutator is required'));
      }
      return input.guests===true
        ?runtime.updateGuests(input.mutator,context)
        :runtime.updateAttendance(input.mutator,context);
    }
    function createSnapshot(input){
      const writer=options.snapshotWriter;if(!writer||typeof writer.createOnly!=='function') throw new TypeError('attendance snapshot writer is required');
      return writer.createOnly(input);
    }
    function updateCalendar(input){return contextTransaction(input.keys,input,input.mutateContext);}
    function updateTabs(input){
      return contextTransaction(input.keys,input,input.mutateContext);
    }
    function updateManualRecords(input){
      return contextTransaction(input.keys,input,input.mutateContext);
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
      const tab=view.exportTab||rootValue(view.root,'swim_tab_list',[]).find(item=>text(item?.id)===text(view.tabId))||{id:view.tabId,type:'regular'};
      const keys=tabKeys(tab);
      const students=rootValue(view.root,keys.students,[]);
      const studentsBySlot={};
      students.forEach(student=>{const key=slotKey(student);if(key!=='///') studentsBySlot[key]=clone(student);});
      const exportData={
        studentsBySlot,
        instructors:rootValue(view.root,keys.instructors,{}),
        enroll:rootValue(view.root,'swim_enroll',{}),
        retire:rootValue(view.root,'swim_retire',{}),
        hyuwon:rootValue(view.root,'swim_hyuwon',{}),
        marks:rootValue(view.root,'swim_mark',{}),
        requests:rootValue(view.root,'swim_requests',{}),
        waitlist:rootValue(view.root,'swim_reserve',{}),
      };
      Array.from(table.querySelectorAll('[data-t][data-day][data-lane][data-ri]')).forEach(cell=>{
        const key=[cell.dataset.t,cell.dataset.day,cell.dataset.lane,cell.dataset.ri].map(text).join('/');
        const value=studentDisplay(exportData.studentsBySlot[key],exportData.enroll[key]);
        cell.textContent=value;
        cell.setAttribute('data-operational-export-text',value);
      });
      Array.from(table.querySelectorAll('[data-inst-key]')).forEach(cell=>{
        const value=instructorDisplay(exportData.instructors[text(cell.dataset.instKey)]);
        cell.textContent=value;
        cell.setAttribute('data-operational-export-text',value);
      });
      table.setAttribute('data-operational-export-primary',text(view.primary));
      table.setAttribute('data-operational-export-tab',text(view.tabId));
      return {table,tab:clone(tab),root:clone(view.root),primary:text(view.primary),exportData};
    }
    return Object.freeze({registerStudent,replaceScheduledStudents,moveStudent,updateTeachers,setReservations,addWaitlistEntry,
      setClassMark,clearClassMark,updateAttendance,createSnapshot,updateCalendar,updateTabs,updateManualRecords,prepareExportView,renderExportTable});
  }
  return Object.freeze({applyFutureStudentState,clearReplacementFutureState,create});
});
