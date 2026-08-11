(function(global){
  "use strict";

  const DOMAIN_COLLECTIONS=Object.freeze({
    roster:["tabs","people","enrollments","placements","teacherAssignments"],
    workflow:["reservations","waitlistEntries","classMarks"],
    attendance:["attendanceRecords","attendanceGuests","attendanceSnapshots","attendanceSnapshotStudents","attendanceSnapshotTeachers"],
    calendar:["disabledSlots","calendarClosures","schedulePeriods","scheduleSettings"],
    administration:["teacherProfiles","tabFolders","archivedTabs","systemMetadata"],
    history:["retirementRecords","deskStudentRecords"],
  });
  const COLLECTION_NAMES=Object.freeze(Object.values(DOMAIN_COLLECTIONS).flat());
  const FIXED_LEGACY_DOMAINS=Object.freeze({
    swim_tab_list:"roster",swim_students:"roster",swim_inst:"roster",
    swim_retire:"workflow",swim_enroll:"workflow",swim_hyuwon:"workflow",swim_move:"workflow",swim_reserve:"workflow",swim_mark:"workflow",
    swim_attendance:"attendance",swim_att_guests:"attendance",swim_day_snapshot:"attendance",
    swim_disabled:"calendar",swim_closed:"calendar",swim_periods:"calendar",swim_main_tab:"calendar",swim_parent_tab:"calendar",
    swim_teachers:"administration",swim_tab_folders:"administration",swim_archived_tabs:"administration",swim_age_year:"administration",swim_student_id_version:"administration",swim_ver:"administration",
    swim_retire_history:"history",swim_desk_notes:"history",
  });
  const DYNAMIC_LEGACY_DOMAINS=Object.freeze([
    [/^swim_stu_[A-Za-z0-9_-]+$/,"roster"],
    [/^swim_inst_[A-Za-z0-9_-]+$/,"roster"],
    [/^swim_bt_[A-Za-z0-9_-]+_(stu|inst)$/,"roster"],
    [/^swim_bt_attendance_[A-Za-z0-9_-]+$/,"attendance"],
    [/^swim_bt_att_guests_[A-Za-z0-9_-]+$/,"attendance"],
    [/^swim_bt_day_snapshot_[A-Za-z0-9_-]+$/,"attendance"],
    [/^zz_swim_day_snapshot__(regular|bt_[A-Za-z0-9_-]+)__\d{4}-\d{2}-\d{2}$/,"attendance"],
  ]);

  function text(value){ return String(value==null?"":value).trim(); }
  function clone(value){ return value==null?value:JSON.parse(JSON.stringify(value)); }
  function object(value){ return value&&typeof value==="object"&&!Array.isArray(value); }
  function collection(collections,name){ return Array.isArray(collections?.[name])?collections[name]:[]; }
  function withoutSchema(value){
    const result=clone(value)||{};
    delete result.schemaVersion;
    return result;
  }
  function serialized(value){ return JSON.stringify(value); }
  function byOrder(left,right){ return (Number(left?.order)||0)-(Number(right?.order)||0)||text(left?.id).localeCompare(text(right?.id)); }
  function grouped(rows,key){
    const result=new Map();
    rows.forEach(row=>{
      const value=text(row?.[key]);
      if(!value) return;
      if(!result.has(value)) result.set(value,[]);
      result.get(value).push(row);
    });
    return result;
  }
  function canonicalValue(value){
    if(Array.isArray(value)) return value.map(canonicalValue);
    if(!object(value)) return value;
    const result={};
    Object.keys(value).sort().forEach(key=>{
      if(value[key]!==undefined) result[key]=canonicalValue(value[key]);
    });
    return result;
  }
  function canonicalDigest(value){ return JSON.stringify(canonicalValue(value)); }
  function domainForLegacyKey(key){
    const normalized=text(key);
    if(FIXED_LEGACY_DOMAINS[normalized]) return FIXED_LEGACY_DOMAINS[normalized];
    const match=DYNAMIC_LEGACY_DOMAINS.find(([pattern])=>pattern.test(normalized));
    return match?match[1]:"";
  }
  function parseLegacyValue(value){
    if(typeof value!=="string") return clone(value);
    try{return JSON.parse(value);}catch(error){return value;}
  }
  function snapshotScopeForLegacyKey(key){
    if(key==="swim_day_snapshot") return "regular";
    const bundled=key.match(/^swim_bt_day_snapshot_([A-Za-z0-9_-]+)$/);
    if(bundled) return `bt_${bundled[1]}`;
    const daily=key.match(/^zz_swim_day_snapshot__(regular|bt_[A-Za-z0-9_-]+)__(\d{4}-\d{2}-\d{2})$/);
    return daily?daily[1]:"";
  }
  function trackedLegacyView(root){
    const view={};
    const snapshots=new Map();
    Object.keys(root||{}).sort().forEach(key=>{
      if(!domainForLegacyKey(key)) return;
      const scope=snapshotScopeForLegacyKey(key);
      if(!scope){
        view[key]=parseLegacyValue(root[key]);
        return;
      }
      const daily=key.match(/^zz_swim_day_snapshot__(?:regular|bt_[A-Za-z0-9_-]+)__(\d{4}-\d{2}-\d{2})$/);
      if(daily){
        snapshots.set(`${scope}|${daily[1]}`,parseLegacyValue(root[key]));
        return;
      }
      const bundled=parseLegacyValue(root[key]);
      if(!object(bundled)) return;
      Object.entries(bundled).forEach(([date,snapshot])=>{
        const snapshotKey=`${scope}|${date}`;
        if(!snapshots.has(snapshotKey)) snapshots.set(snapshotKey,snapshot);
      });
    });
    [...snapshots.keys()].sort().forEach(key=>{ view[`attendanceSnapshot:${key}`]=snapshots.get(key); });
    return view;
  }
  function changedLegacyKeys(before,after,allowedKeys){
    const allowed=new Set(Array.isArray(allowedKeys)?allowedKeys:Object.keys({...before,...after}));
    return [...allowed].filter(key=>domainForLegacyKey(key)&&canonicalDigest(parseLegacyValue(before?.[key]))!==canonicalDigest(parseLegacyValue(after?.[key]))).sort();
  }
  function legacyKeysForTab(tab){
    const id=text(tab?.id)||"regular";
    if(tab?.type==="bangteuk") return {students:`swim_bt_${id}_stu`,teachers:`swim_bt_${id}_inst`};
    return {students:id==="regular"?"swim_students":`swim_stu_${id}`,teachers:id==="regular"?"swim_inst":`swim_inst_${id}`};
  }
  function profileConflict(left,right){
    return text(left?.name)!==text(right?.name)
      ||text(left?.phone)!==text(right?.phone)
      ||canonicalDigest(left?.age??null)!==canonicalDigest(right?.age??null)
      ||text(left?.gender)!==text(right?.gender);
  }
  function collectionIssues(collections){
    const issues=[];
    COLLECTION_NAMES.forEach(name=>{
      if(Object.prototype.hasOwnProperty.call(collections||{},name)&&!Array.isArray(collections[name])){
        issues.push({type:"invalid-collection-shape",collection:name,actual:Array.isArray(collections[name])?"array":typeof collections[name]});
      }
      const ids=new Map();
      collection(collections,name).forEach((row,index)=>{
        const id=text(row?.id);
        if(!id){
          issues.push({type:"missing-id",collection:name,index});
          return;
        }
        if(ids.has(id)){
          issues.push({type:"duplicate-id",collection:name,id});
          if(name==="people"&&profileConflict(ids.get(id),row)) issues.push({type:"profile-conflict",personId:id});
          return;
        }
        ids.set(id,row);
      });
    });
    const tabsById=new Map(collection(collections,"tabs").map(row=>[text(row.id),row]));
    const peopleById=new Map(collection(collections,"people").map(row=>[text(row.id),row]));
    const enrollmentsById=new Map(collection(collections,"enrollments").map(row=>[text(row.id),row]));
    const classMarksById=new Map(collection(collections,"classMarks").map(row=>[text(row.id),row]));
    const snapshotsById=new Map(collection(collections,"attendanceSnapshots").map(row=>[text(row.id),row]));
    const courseTypeForTab=tab=>tab?.type==="bangteuk"?"bangteuk":"regular";
    const validateTabOwner=(row,collectionName)=>{
      const id=text(row?.id);
      const tabId=text(row?.tabId);
      const tab=tabsById.get(tabId);
      if(!tab) issues.push({type:"missing-tab-reference",collection:collectionName,id,tabId});
      else if(text(row?.courseType)&&text(row.courseType)!==courseTypeForTab(tab)){
        issues.push({type:"tab-owner-mismatch",collection:collectionName,id,tabId,courseType:text(row.courseType)});
      }
      return tab;
    };
    const validateEnrollmentOwner=(row,collectionName)=>{
      const id=text(row?.id);
      const enrollmentId=text(row?.enrollmentId);
      if(!enrollmentId) return;
      const enrollment=enrollmentsById.get(enrollmentId);
      if(!enrollment) issues.push({type:"missing-enrollment-reference",collection:collectionName,id,enrollmentId});
      else if(text(enrollment.personId)!==text(row?.personId)||text(enrollment.tabId)!==text(row?.tabId)){
        issues.push({type:"enrollment-owner-mismatch",collection:collectionName,id,enrollmentId});
      }
    };
    collection(collections,"enrollments").forEach(row=>{
      const id=text(row?.id);
      const tabId=text(row?.tabId);
      const personId=text(row?.personId);
      validateTabOwner(row,"enrollments");
      if(!peopleById.has(personId)) issues.push({type:"missing-person-reference",collection:"enrollments",id,personId});
    });
    const occupied=new Map();
    collection(collections,"placements").forEach(row=>{
      const id=text(row?.id);
      const tabId=text(row?.tabId);
      const personId=text(row?.personId);
      const enrollmentId=text(row?.enrollmentId);
      const slotKey=text(row?.slotKey);
      const enrollment=enrollmentsById.get(enrollmentId);
      validateTabOwner(row,"placements");
      if(!peopleById.has(personId)) issues.push({type:"missing-person-reference",collection:"placements",id,personId});
      if(!enrollment) issues.push({type:"missing-enrollment-reference",collection:"placements",id,enrollmentId});
      else if(text(enrollment.personId)!==personId||text(enrollment.tabId)!==tabId){
        issues.push({type:"placement-reference-mismatch",id,enrollmentId,tabId,personId});
      }
      if(!tabId||!slotKey) return;
      const key=`${tabId}|${slotKey}`;
      const previous=occupied.get(key);
      if(previous){
        issues.push({type:"slot-collision",tabId,slotKey,currentPersonId:text(previous.personId),incomingPersonId:personId});
      }else occupied.set(key,row);
    });
    collection(collections,"teacherAssignments").forEach(row=>{ validateTabOwner(row,"teacherAssignments"); });
    collection(collections,"attendanceRecords").forEach(row=>{
      const id=text(row?.id);
      const personId=text(row?.personId);
      const classMarkId=text(row?.classMarkId);
      validateTabOwner(row,"attendanceRecords");
      if(personId&&!peopleById.has(personId)) issues.push({type:"missing-person-reference",collection:"attendanceRecords",id,personId});
      validateEnrollmentOwner(row,"attendanceRecords");
      if(classMarkId){
        const mark=classMarksById.get(classMarkId);
        if(!mark) issues.push({type:"missing-class-mark-reference",collection:"attendanceRecords",id,classMarkId});
        else if(text(mark.tabId)!==text(row?.tabId)||text(mark.personId)!==personId){
          issues.push({type:"attendance-owner-mismatch",collection:"attendanceRecords",id,classMarkId});
        }
      }
    });
    collection(collections,"attendanceGuests").forEach(row=>{ validateTabOwner(row,"attendanceGuests"); });
    collection(collections,"attendanceSnapshots").forEach(row=>{ validateTabOwner(row,"attendanceSnapshots"); });
    ["attendanceSnapshotStudents","attendanceSnapshotTeachers"].forEach(collectionName=>{
      collection(collections,collectionName).forEach(row=>{
        const id=text(row?.id);
        const snapshotId=text(row?.snapshotId);
        const snapshot=snapshotsById.get(snapshotId);
        if(!snapshot) issues.push({type:"missing-snapshot-reference",collection:collectionName,id,snapshotId});
        else if(text(row?.tabId)!==text(snapshot.tabId)||text(row?.courseType)!==text(snapshot.courseType)||text(row?.date)!==text(snapshot.date)){
          issues.push({type:"snapshot-owner-mismatch",collection:collectionName,id,snapshotId});
        }
      });
    });
    return issues;
  }
  function studentFromPlacement(placement,person,enrollment,tab){
    const student=clone(placement.extra)||{};
    if(person?.id) student.sid=text(person.id);
    if(person?.name) student.n=(enrollment?.weekFive&&tab?.type==="bangteuk"?"*":"")+text(person.name);
    if(person?.phone) student.p=text(person.phone);
    if(person?.age!=null) student.a=person.age;
    if(person?.gender) student.g=text(person.gender);
    student.t=text(placement.time);
    student.d=text(placement.day);
    student.l=Number(placement.lane)||0;
    student.r=Number(placement.seat)||0;
    if(placement.transport?.usesVehicle===true) student.v=true;
    if(text(placement.transport?.location)) student.loc=text(placement.transport.location);
    if(text(placement.memo)) student.memo=text(placement.memo);
    if(enrollment?.paid===true) student.paid=true;
    if(enrollment?.newStudent===true) student[tab?.type==="bangteuk"?"btNew":"isNew"]=true;
    if(enrollment?.weekFive===true&&tab?.type==="bangteuk") student.btWeek5=true;
    if(enrollment?.reenroll===true) student.reenroll=true;
    if(placement.layoutAdded===true) student.layoutAdded=true;
    if(text(placement.startDate)) student.enrolled=text(placement.startDate);
    return student;
  }
  function selectedRegularTabId(collections){
    const tabs=collection(collections,"tabs");
    const settings=collection(collections,"scheduleSettings")[0]||{};
    const main=text(settings.mainTabId);
    if(tabs.some(tab=>tab.id===main&&tab.type!=="bangteuk")) return main;
    return text(tabs.find(tab=>tab.id==="regular")?.id||tabs.find(tab=>tab.type!=="bangteuk")?.id);
  }
  function attendanceKeys(tabId,regularTabId){
    if(tabId===regularTabId) return {records:"swim_attendance",guests:"swim_att_guests",snapshots:"swim_day_snapshot"};
    return {records:`swim_bt_attendance_${tabId}`,guests:`swim_bt_att_guests_${tabId}`,snapshots:`swim_bt_day_snapshot_${tabId}`};
  }
  function legacyRootFromCollections(input){
    const collections=input?.collections||{};
    if(collectionIssues(collections).length) return null;
    const root={};
    const tabs=collection(collections,"tabs").map(withoutSchema);
    const tabsById=new Map(tabs.map(tab=>[text(tab.id),tab]));
    const peopleById=new Map(collection(collections,"people").map(row=>[text(row.id),row]));
    const enrollmentsById=new Map(collection(collections,"enrollments").map(row=>[text(row.id),row]));

    root.swim_tab_list=serialized(tabs);
    const placementsByTab=grouped(collection(collections,"placements"),"tabId");
    tabs.forEach(tab=>{
      const keys=legacyKeysForTab(tab);
      const students=(placementsByTab.get(text(tab.id))||[]).map(placement=>{
        const enrollment=enrollmentsById.get(text(placement.enrollmentId));
        return studentFromPlacement(placement,peopleById.get(text(placement.personId)),enrollment,tab);
      });
      root[keys.students]=serialized(students);
      const teachers={};
      collection(collections,"teacherAssignments").filter(row=>text(row.tabId)===text(tab.id)).forEach(row=>{
        if(text(row.slotKey)) teachers[text(row.slotKey)]=clone(row.source??row.teacherName);
      });
      root[keys.teachers]=serialized(teachers);
    });

    const settings=collection(collections,"scheduleSettings")[0]||{};
    root.swim_main_tab=serialized(clone(settings.mainTab)||{tabId:text(settings.mainTabId)});
    root.swim_parent_tab=serialized(clone(settings.parentTab)||{tabId:text(settings.parentTabId)});

    const reservationMaps={retire:{},enroll:{},hyuwon:{},move:{}};
    collection(collections,"reservations").forEach(row=>{
      if(row.type==="move"){
        if(text(row.sourceSlotKey)&&row.source) reservationMaps.retire[text(row.sourceSlotKey)]=clone(row.source);
        if(text(row.targetSlotKey)&&row.target) reservationMaps.enroll[text(row.targetSlotKey)]=clone(row.target);
        return;
      }
      if(reservationMaps[row.type]&&text(row.slotKey)) reservationMaps[row.type][text(row.slotKey)]=clone(row.payload);
    });
    root.swim_retire=serialized(reservationMaps.retire);
    root.swim_enroll=serialized(reservationMaps.enroll);
    root.swim_hyuwon=serialized(reservationMaps.hyuwon);
    root.swim_move=serialized(reservationMaps.move);
    const waitlist={};
    grouped(collection(collections,"waitlistEntries").slice().sort(byOrder),"instKey").forEach((rows,key)=>{ waitlist[key]=rows.map(row=>clone(row.payload)); });
    root.swim_reserve=serialized(waitlist);
    const marks={};
    grouped(collection(collections,"classMarks"),"legacyKey").forEach((rows,key)=>{
      const primary=rows.find(row=>row.layer==="primary")||rows[0];
      const secondary=rows.find(row=>row.layer==="secondary");
      const value=clone(primary.payload)||{};
      if(secondary) value.sub=clone(secondary.payload)||{};
      marks[key]=value;
    });
    root.swim_mark=serialized(marks);

    const regularTabId=selectedRegularTabId(collections);
    const attendanceRoots=new Map();
    const attendanceFor=tabId=>{
      const keys=attendanceKeys(tabId,regularTabId);
      if(!attendanceRoots.has(tabId)) attendanceRoots.set(tabId,{keys,records:{},guests:{},snapshots:{}});
      return attendanceRoots.get(tabId);
    };
    collection(collections,"attendanceRecords").forEach(row=>{
      if(text(row.legacyKey)) attendanceFor(text(row.tabId)).records[text(row.legacyKey)]=clone(row.payload);
    });
    grouped(collection(collections,"attendanceGuests").slice().sort(byOrder),"legacyKey").forEach((rows,key)=>{
      const tabId=text(rows[0]?.tabId);
      attendanceFor(tabId).guests[key]=rows.map(row=>clone(row.payload));
    });
    const snapshotStudents=grouped(collection(collections,"attendanceSnapshotStudents").slice().sort(byOrder),"snapshotId");
    const snapshotTeachers=grouped(collection(collections,"attendanceSnapshotTeachers").slice().sort(byOrder),"snapshotId");
    collection(collections,"attendanceSnapshots").forEach(snapshot=>{
      const snapshotRoot=attendanceFor(text(snapshot.tabId));
      const inst={};
      (snapshotTeachers.get(text(snapshot.id))||[]).forEach(row=>{ if(text(row.slotKey)) inst[text(row.slotKey)]=clone(row.payload??row.teacherName); });
      snapshotRoot.snapshots[text(snapshot.date)]={
        date:text(snapshot.date),
        ...(text(snapshot.createdAt)?{createdAt:text(snapshot.createdAt)}:{}),
        students:(snapshotStudents.get(text(snapshot.id))||[]).map(row=>clone(row.payload)),
        inst,
      };
    });
    attendanceRoots.forEach(({keys,records,guests,snapshots})=>{
      root[keys.records]=serialized(records);
      root[keys.guests]=serialized(guests);
      root[keys.snapshots]=serialized(snapshots);
    });

    const disabled={};
    collection(collections,"disabledSlots").forEach(row=>{ if(text(row.legacyKey)) disabled[text(row.legacyKey)]=clone(row.payload); });
    root.swim_disabled=serialized(disabled);
    root.swim_closed=serialized(collection(collections,"calendarClosures").slice().sort(byOrder).map(row=>clone(row.payload)));
    root.swim_periods=serialized(collection(collections,"schedulePeriods").slice().sort(byOrder).map(row=>clone(row.payload)));
    root.swim_teachers=serialized(collection(collections,"teacherProfiles").slice().sort(byOrder).map(row=>clone(row.payload)));
    root.swim_tab_folders=serialized(collection(collections,"tabFolders").slice().sort(byOrder).map(row=>text(row.name)));
    root.swim_archived_tabs=serialized(collection(collections,"archivedTabs").slice().sort(byOrder).map(row=>clone(row.payload)));
    const metadata=new Map(collection(collections,"systemMetadata").map(row=>[text(row.key||row.id),row.value]));
    if(metadata.has("age_year")) root.swim_age_year=serialized(metadata.get("age_year"));
    if(metadata.has("student_id_version")) root.swim_student_id_version=serialized(metadata.get("student_id_version"));
    if(metadata.has("legacy_data_version")) root.swim_ver=serialized(metadata.get("legacy_data_version"));
    root.swim_retire_history=serialized(collection(collections,"retirementRecords").slice().sort(byOrder).map(row=>clone(row.payload)));
    root.swim_desk_notes=serialized(collection(collections,"deskStudentRecords").slice().sort(byOrder).map(row=>clone(row.payload)));
    return root;
  }
  function validateRoundTrip(input){
    const collections=input?.collections||{};
    const issues=collectionIssues(collections);
    if(issues.length) return {issues,root:null};
    const root=legacyRootFromCollections(input);
    const legacyRoot=input?.legacyRoot||input?.root;
    if(legacyRoot&&changedLegacyKeys(legacyRoot,root,Object.keys(legacyRoot)).length){
      return {issues:[{type:"round-trip-mismatch"}],root:null};
    }
    return {issues:[],root};
  }
  function collectionChanges(input){
    const before=input?.before||{};
    const after=input?.after||{};
    const issues=[...collectionIssues(before),...collectionIssues(after)];
    if(issues.length) return {issues,changes:[]};
    const changes=[];
    COLLECTION_NAMES.forEach(name=>{
      const beforeById=new Map(collection(before,name).map(row=>[text(row.id),row]));
      const afterById=new Map(collection(after,name).map(row=>[text(row.id),row]));
      [...new Set([...beforeById.keys(),...afterById.keys()])].sort().forEach(id=>{
        const previous=beforeById.get(id);
        const next=afterById.get(id);
        if(!next) changes.push({type:"delete",collection:name,id});
        else if(!previous||canonicalDigest(previous)!==canonicalDigest(next)) changes.push({type:"set",collection:name,id,value:clone(next)});
      });
    });
    return {issues:[],changes};
  }

  global.SCV2OperationalModel=Object.freeze({
    DOMAIN_COLLECTIONS,
    domainForLegacyKey,
    trackedLegacyView,
    legacyRootFromCollections,
    collectionChanges,
    validateRoundTrip,
    canonicalDigest,
    changedLegacyKeys,
  });
})(typeof window!=="undefined"?window:globalThis);
