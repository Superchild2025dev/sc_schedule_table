(function(global,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  global.SCScheduleOperationalWorkflows=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
  function parse(value,fallback){
    try{return JSON.parse(value);}catch(error){return clone(fallback);}
  }
  function stringify(value){return JSON.stringify(value);}
  function text(value){return String(value==null?'':value).trim();}
  function metadata(input){
    return {
      operationId:text(input.operationId),operationType:text(input.operationType),
      tabIds:Array.isArray(input.tabIds)?input.tabIds.slice():[],
      ...(input.requireOperationManifest?{requireOperationManifest:true}:{}),
    };
  }

  function create(options={}){
    const gateway=options.gateway;
    if(!gateway||typeof gateway.transactionKeys!=='function') throw new TypeError('operational gateway is required');
    const transaction=(keys,operation,mutator)=>gateway.transactionKeys(keys,mutator,metadata(operation));
    const mapUpdate=(key,operation,update)=>transaction([key],operation,root=>{
      const map=parse(root[key],{});
      update(map);
      root[key]=stringify(map);
      return root;
    });
    const listUpdate=(key,operation,update)=>transaction([key],operation,root=>{
      const list=parse(root[key],[]);
      update(list);
      root[key]=stringify(list);
      return root;
    });

    function registerStudent(input){
      return listUpdate(input.key,input,list=>list.push(clone(input.student)));
    }
    function replaceStudent(input){
      return listUpdate(input.key,input,list=>{
        const index=list.findIndex(student=>text(student?.sid)===text(input.sid));
        if(index<0) throw Object.assign(new Error('student not found'),{code:'not-found'});
        list[index]={...list[index],...clone(input.replacement)};
      });
    }
    function moveStudent(input){
      return listUpdate(input.key,input,list=>{
        const student=list.find(item=>text(item?.sid)===text(input.sid));
        if(!student) throw Object.assign(new Error('student not found'),{code:'not-found'});
        Object.assign(student,clone(input.destination));
      });
    }
    function updateTeachers(input){
      return transaction(input.keys,input,root=>{
        Object.entries(input.assignments||{}).forEach(([key,updates])=>{
          const teachers=parse(root[key],{});
          Object.entries(updates||{}).forEach(([slot,value])=>{teachers[slot]=clone(value);});
          root[key]=stringify(teachers);
        });
        return root;
      });
    }
    function setReservations(input){
      return transaction(input.keys,input,root=>{
        Object.entries(input.values||{}).forEach(([key,value])=>{root[key]=stringify(value);});
        return root;
      });
    }
    function addWaitlistEntry(input){
      return mapUpdate(input.key,input,map=>{
        const entries=Array.isArray(map[input.slotKey])?map[input.slotKey]:[];
        entries.push(clone(input.entry));
        map[input.slotKey]=entries;
      });
    }
    function setClassMark(input){return mapUpdate(input.key,input,map=>{map[input.markKey]=clone(input.mark);});}
    function clearClassMark(input){return mapUpdate(input.key,input,map=>{delete map[input.markKey];});}
    function updateAttendance(input){
      return transaction(input.keys,input,root=>{
        Object.entries(input.values||{}).forEach(([key,value])=>{root[key]=stringify(value);});
        return root;
      });
    }
    function createSnapshot(input){
      const writer=options.snapshotWriter;
      if(!writer||typeof writer.createOnly!=='function') throw new TypeError('attendance snapshot writer is required');
      return writer.createOnly(input);
    }
    function updateCalendar(input){return transaction(input.keys,input,root=>{
      Object.entries(input.values||{}).forEach(([key,value])=>{root[key]=stringify(value);});
      return root;
    });}
    function updateTabs(input){return updateCalendar(input);}
    function updateManualRecords(input){return updateCalendar(input);}
    function exportSelection(input){return gateway.loadSelection(clone(input.selection));}

    return Object.freeze({
      registerStudent,replaceStudent,moveStudent,updateTeachers,setReservations,addWaitlistEntry,
      setClassMark,clearClassMark,updateAttendance,createSnapshot,updateCalendar,updateTabs,
      updateManualRecords,exportSelection,
    });
  }
  return Object.freeze({create});
});
