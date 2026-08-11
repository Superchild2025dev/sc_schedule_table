(function(global){
  'use strict';

  const SCHEMA_VERSION=2;
  const LEGACY_DEFAULT_PERIODS=[
    {month:2,start:'2026-02-02',end:'2026-03-04'},
    {month:3,start:'2026-03-05',end:'2026-04-01'},
    {month:4,start:'2026-04-02',end:'2026-04-29'},
    {month:5,start:'2026-05-06',end:'2026-06-02'},
    {month:6,start:'2026-06-03',end:'2026-06-30'},
    {month:7,start:'2026-07-06',end:'2026-08-01'},
    {month:8,start:'2026-08-03',end:'2026-08-29'},
    {month:9,start:'2026-08-31',end:'2026-10-02'},
    {month:10,start:'2026-10-05',end:'2026-10-31'},
    {month:11,start:'2026-11-02',end:'2026-11-28'},
    {month:12,start:'2026-11-30',end:'2026-12-26'},
  ];
  const LEGACY_DEFAULT_CLOSED=[
    {start:'2026-02-16',end:'2026-02-18',type:'휴관',memo:'설 연휴'},
    {start:'2026-03-02',end:null,type:'의무보강',memo:'대체휴일'},
    {start:'2026-04-30',end:'2026-05-05',type:'휴관',memo:''},
    {start:'2026-07-01',end:'2026-07-04',type:'휴관',memo:''},
    {start:'2026-08-15',end:null,type:'의무보강',memo:'광복절'},
    {start:'2026-09-24',end:'2026-09-30',type:'휴관',memo:'추석 연휴'},
    {start:'2026-10-03',end:null,type:'의무보강',memo:'개천절'},
    {start:'2026-10-09',end:null,type:'의무보강',memo:'한글날'},
    {start:'2026-12-25',end:null,type:'의무보강',memo:'성탄절'},
    {start:'2026-12-28',end:'2026-12-31',type:'휴관',memo:''},
  ];
  const KNOWN_STUDENT_FIELDS=new Set([
    'sid','n','name','a','age','p','phone','g','gender','t','d','l','r',
    'v','loc','memo','paid','btNew','btWeek5','layoutAdded','isNew','reenroll','enrolled',
    '__identitySlotKey','__tabId','__tabType'
  ]);

  function text(value){ return String(value==null?'':value).trim(); }
  function digits(value){ return text(value).replace(/\D/g,''); }
  function clone(value){
    if(value==null) return value;
    return JSON.parse(JSON.stringify(value));
  }
  function stableHash(value){
    const input=String(value||'');
    let h1=0xdeadbeef^input.length;
    let h2=0x41c6ce57^input.length;
    for(let i=0;i<input.length;i++){
      const ch=input.charCodeAt(i);
      h1=Math.imul(h1^ch,2654435761);
      h2=Math.imul(h2^ch,1597334677);
    }
    h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
    h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
    return (h2>>>0).toString(36).padStart(7,'0')+(h1>>>0).toString(36).padStart(7,'0');
  }
  function id(prefix,seed){ return prefix+'_'+stableHash(seed); }
  function parsedBangteukName(student){
    const raw=text(student?.n||student?.name);
    const helper=global.SCScheduleTime;
    if(helper&&typeof helper.parseBangteukWeek5Name==='function'){
      return helper.parseBangteukWeek5Name(raw);
    }
    const week5=/^[*＊]+\s*/.test(raw);
    return {name:week5?raw.replace(/^[*＊]+\s*/,'').trim():raw,week5};
  }
  function courseTypeForTab(tab){ return tab?.type==='bangteuk'?'bangteuk':'regular'; }
  function attendanceOwner(tabId,tab){
    const courseType=courseTypeForTab(tab);
    return {tabId:courseType==='regular'?'regular':text(tabId),courseType};
  }
  function personIdFor(student){
    const existing=text(student?.sid);
    if(existing) return existing;
    const helper=global.SCScheduleTime;
    if(helper&&typeof helper.studentIdFor==='function'){
      const generated=text(helper.studentIdFor(student));
      if(generated) return generated;
    }
    const name=parsedBangteukName(student).name.toLowerCase();
    const phone=digits(student?.p||student?.phone);
    const age=text(student?.a??student?.age);
    const gender=text(student?.g||student?.gender).toLowerCase();
    const seed=phone?`np|${name}|${phone}`:`nag|${name}|${age}|${gender}`;
    return name?id('stu',seed):'';
  }
  function enrollmentIdFor(personId,tabId){
    return id('enr',`${personId}|${tabId}`);
  }
  function slotKeyFor(student){
    return [text(student?.t),text(student?.d),text(student?.l),text(student?.r)].join('/');
  }
  function placementIdFor(enrollmentId,slotKey){
    return id('plc',`${enrollmentId}|${slotKey}`);
  }
  function assignmentIdFor(tabId,slotKey){
    return id('asg',`${tabId}|${slotKey}`);
  }
  function unknownStudentFields(student){
    const extra={};
    Object.keys(student||{}).forEach(key=>{
      if(!KNOWN_STUDENT_FIELDS.has(key)) extra[key]=clone(student[key]);
    });
    return extra;
  }
  function personFromStudent(student){
    const personId=personIdFor(student);
    return {
      id:personId,
      name:parsedBangteukName(student).name,
      phone:digits(student?.p||student?.phone),
      age:student?.a??student?.age??null,
      gender:text(student?.g||student?.gender),
      schemaVersion:SCHEMA_VERSION,
    };
  }
  function enrollmentFromStudent(student,tab){
    const personId=personIdFor(student);
    const tabId=text(tab?.id)||'regular';
    return {
      id:enrollmentIdFor(personId,tabId),
      personId,
      tabId,
      courseType:courseTypeForTab(tab),
      paid:student?.paid===true,
      newStudent:student?.isNew||student?.btNew||false,
      weekFive:student?.btWeek5===true||parsedBangteukName(student).week5,
      reenroll:student?.reenroll||false,
      schemaVersion:SCHEMA_VERSION,
    };
  }
  function placementFromStudent(student,tab,order){
    const personId=personIdFor(student);
    const tabId=text(tab?.id)||'regular';
    const enrollmentId=enrollmentIdFor(personId,tabId);
    const slotKey=slotKeyFor(student);
    return {
      id:placementIdFor(enrollmentId,slotKey),
      personId,
      enrollmentId,
      tabId,
      courseType:courseTypeForTab(tab),
      slotKey,
      time:text(student?.t),
      day:text(student?.d),
      lane:Number(student?.l)||0,
      seat:Number(student?.r)||0,
      transport:{
        usesVehicle:student?.v===true,
        location:text(student?.loc),
      },
      memo:text(student?.memo),
      startDate:text(student?.enrolled),
      layoutAdded:student?.layoutAdded||false,
      order:Number(order)||0,
      extra:unknownStudentFields(student),
      schemaVersion:SCHEMA_VERSION,
    };
  }
  function profilesConflict(a,b){
    const aName=text(a?.name).toLowerCase();
    const bName=text(b?.name).toLowerCase();
    const aPhone=digits(a?.phone);
    const bPhone=digits(b?.phone);
    return !!((aName&&bName&&aName!==bName)||(aPhone&&bPhone&&aPhone!==bPhone));
  }
  function mergePerson(current,next){
    if(!current) return next;
    return {
      ...current,
      name:current.name||next.name,
      phone:current.phone||next.phone,
      age:current.age??next.age,
      gender:current.gender||next.gender,
    };
  }
  function tabDocument(tab,sourceOrder){
    const copy=clone(tab||{});
    const rawType=text(copy.type);
    return {
      ...copy,
      id:text(copy.id)||'regular',
      type:rawType==='snapshot'?'snapshot':(rawType==='bangteuk'?'bangteuk':'regular'),
      sourceOrder:Math.max(0,Number(sourceOrder)||0),
      schemaVersion:SCHEMA_VERSION,
    };
  }
  function parseStored(value,fallback){
    if(value==null) return fallback;
    if(typeof value!=='string') return value;
    try{return JSON.parse(value);}catch(e){return fallback;}
  }
  function isPlainObject(value){
    return !!value&&typeof value==='object'&&!Array.isArray(value);
  }
  function sourceValueType(value){
    if(Array.isArray(value)) return 'array';
    if(value===null) return 'null';
    return typeof value;
  }
  function readLegacySource(data,key,fallback,validator,issues,issueType,options){
    if(!Object.prototype.hasOwnProperty.call(data||{},key)) return clone(fallback);
    const raw=data[key];
    let parsed=raw;
    if(typeof raw==='string'){
      try{parsed=JSON.parse(raw);}
      catch(error){
        if(options?.allowRawString) parsed=raw;
        else{
        issues.push({type:'invalid-json',key,expected:issueType||'valid-json'});
        return clone(fallback);
        }
      }
    }else{
      parsed=clone(raw);
    }
    if(typeof validator==='function'&&!validator(parsed)){
      issues.push({type:issueType||'invalid-source-structure',key,actual:sourceValueType(parsed)});
      return clone(fallback);
    }
    return parsed;
  }
  function legacyTabKeys(tab){
    const tabId=text(tab?.id)||'regular';
    if(tab?.type==='bangteuk'){
      return {students:`swim_bt_${tabId}_stu`,teachers:`swim_bt_${tabId}_inst`};
    }
    return {
      students:tabId==='regular'?'swim_students':`swim_stu_${tabId}`,
      teachers:tabId==='regular'?'swim_inst':`swim_inst_${tabId}`,
    };
  }
  function attendanceSnapshotScope(tab){
    if(tab?.type==='bangteuk') return 'bt_'+text(tab.id||'bangteuk').replace(/[^\w-]/g,'_');
    return 'regular';
  }
  function legacyBundleFromRoot(branchId,root){
    const data=root||{};
    const sourceIssues=[];
    let tabs=readLegacySource(data,'swim_tab_list',[],Array.isArray,sourceIssues,'invalid-tab-list');
    if(!tabs.length){
      tabs=[{id:'regular',name:'정규시간표',type:'regular'}];
    }
    const seenTabIds=new Set();
    tabs=tabs.filter((tab,index)=>{
      if(!isPlainObject(tab)||!text(tab.id)){
        sourceIssues.push({type:'invalid-tab-entry',key:'swim_tab_list',index});
        return false;
      }
      const tabId=text(tab.id);
      if(seenTabIds.has(tabId)){
        sourceIssues.push({type:'duplicate-tab-id',key:'swim_tab_list',index,tabId});
        return false;
      }
      seenTabIds.add(tabId);
      return tab.type!=='snapshot';
    }).map(tab=>tabDocument(tab));
    if(!tabs.length) tabs=[{id:'regular',name:'정규시간표',type:'regular',schemaVersion:SCHEMA_VERSION}];
    const mainTab=readLegacySource(data,'swim_main_tab',{},isPlainObject,sourceIssues,'invalid-main-tab');
    const parentTab=readLegacySource(data,'swim_parent_tab',{},isPlainObject,sourceIssues,'invalid-parent-tab');
    const studentsByTab={};
    const instByTab={};
    const attendanceByTab={};
    const attendanceGuestsByTab={};
    const attendanceSnapshotsByTab={};
    const regularTabs=tabs.filter(tab=>courseTypeForTab(tab)==='regular');
    const attendanceRegularTab=regularTabs.find(tab=>tab.id===text(mainTab.tabId))
      ||regularTabs.find(tab=>tab.id==='regular')
      ||regularTabs[0]
      ||null;
    tabs.forEach(tab=>{
      const keys=legacyTabKeys(tab);
      const students=readLegacySource(data,keys.students,[],Array.isArray,sourceIssues,'invalid-student-list');
      const teachers=readLegacySource(data,keys.teachers,{},isPlainObject,sourceIssues,'invalid-teacher-map');
      students.forEach((student,index)=>{
        if(!isPlainObject(student)) sourceIssues.push({type:'invalid-student-entry',key:keys.students,index,tabId:tab.id});
      });
      studentsByTab[tab.id]=students.filter(isPlainObject);
      instByTab[tab.id]=teachers;
      if(tab.type==='bangteuk'){
        const attendanceKey=`swim_bt_attendance_${tab.id}`;
        const guestsKey=`swim_bt_att_guests_${tab.id}`;
        const attendance=readLegacySource(data,attendanceKey,{},isPlainObject,sourceIssues,'invalid-attendance-map');
        const guests=readLegacySource(data,guestsKey,{},isPlainObject,sourceIssues,'invalid-attendance-guest-map');
        Object.entries(guests).forEach(([slotKey,list])=>{
          if(!Array.isArray(list)) sourceIssues.push({type:'invalid-attendance-guest-list',key:guestsKey,slotKey});
        });
        attendanceByTab[tab.id]=attendance;
        attendanceGuestsByTab[tab.id]=guests;
        const snapshotKey=`swim_bt_day_snapshot_${tab.id}`;
        const snapshots=readLegacySource(data,snapshotKey,{},isPlainObject,sourceIssues,'invalid-attendance-snapshot-map');
        attendanceSnapshotsByTab[tab.id]=snapshots;
      }
    });
    if(attendanceRegularTab){
      const attendance=readLegacySource(data,'swim_attendance',{},isPlainObject,sourceIssues,'invalid-attendance-map');
      const guests=readLegacySource(data,'swim_att_guests',{},isPlainObject,sourceIssues,'invalid-attendance-guest-map');
      Object.entries(guests).forEach(([slotKey,list])=>{
        if(!Array.isArray(list)) sourceIssues.push({type:'invalid-attendance-guest-list',key:'swim_att_guests',slotKey});
      });
      attendanceByTab[attendanceRegularTab.id]=attendance;
      attendanceGuestsByTab[attendanceRegularTab.id]=guests;
      const snapshots=readLegacySource(data,'swim_day_snapshot',{},isPlainObject,sourceIssues,'invalid-attendance-snapshot-map');
      attendanceSnapshotsByTab[attendanceRegularTab.id]=snapshots;
    }
    Object.entries(data).forEach(([key,raw])=>{
      const match=text(key).match(/^zz_swim_day_snapshot__(.+)__(\d{4}-\d{2}-\d{2})$/);
      if(!match) return;
      const scope=match[1];
      const date=match[2];
      const tab=scope==='regular'
        ?attendanceRegularTab
        :tabs.find(item=>attendanceSnapshotScope(item)===scope);
      if(!tab) return;
      const snapshot=readLegacySource(data,key,null,isPlainObject,sourceIssues,'invalid-attendance-snapshot');
      if(!snapshot) return;
      if(!attendanceSnapshotsByTab[tab.id]) attendanceSnapshotsByTab[tab.id]={};
      attendanceSnapshotsByTab[tab.id][date]=snapshot;
    });
    const hasClosed=data.swim_closed!==undefined&&data.swim_closed!==null;
    const parsedClosed=readLegacySource(data,'swim_closed',clone(LEGACY_DEFAULT_CLOSED),Array.isArray,sourceIssues,'invalid-calendar-closure-list');
    const hasPeriods=data.swim_periods!==undefined&&data.swim_periods!==null;
    const parsedPeriods=readLegacySource(data,'swim_periods',clone(LEGACY_DEFAULT_PERIODS),Array.isArray,sourceIssues,'invalid-schedule-period-list');
    const effectivePeriods=Array.isArray(parsedPeriods)&&parsedPeriods.length
      ?parsedPeriods
      :(Array.isArray(parsedPeriods)?clone(LEGACY_DEFAULT_PERIODS):parsedPeriods);
    const waitlist=readLegacySource(data,'swim_reserve',{},isPlainObject,sourceIssues,'invalid-waitlist-map');
    Object.entries(waitlist).forEach(([instKey,list])=>{
      if(!Array.isArray(list)) sourceIssues.push({type:'invalid-waitlist-list',key:'swim_reserve',instKey});
    });
    const teachers=readLegacySource(data,'swim_teachers',[],Array.isArray,sourceIssues,'invalid-teacher-list');
    teachers.forEach((teacher,index)=>{
      if(!(typeof teacher==='string'||isPlainObject(teacher))||!text(isPlainObject(teacher)?(teacher.n||teacher.name):teacher)){
        sourceIssues.push({type:'invalid-teacher-entry',key:'swim_teachers',index});
      }
    });
    const tabFolders=readLegacySource(data,'swim_tab_folders',[],Array.isArray,sourceIssues,'invalid-tab-folder-list');
    tabFolders.forEach((folder,index)=>{
      if(!text(folder)) sourceIssues.push({type:'invalid-tab-folder-entry',key:'swim_tab_folders',index});
    });
    const archivedTabs=readLegacySource(data,'swim_archived_tabs',[],Array.isArray,sourceIssues,'invalid-archived-tab-list');
    archivedTabs.forEach((tab,index)=>{
      if(!isPlainObject(tab)||!text(tab.id)) sourceIssues.push({type:'invalid-archived-tab-entry',key:'swim_archived_tabs',index});
    });
    const metadataPresent={
      ageYear:Object.prototype.hasOwnProperty.call(data,'swim_age_year'),
      studentIdVersion:Object.prototype.hasOwnProperty.call(data,'swim_student_id_version'),
      legacyVersion:Object.prototype.hasOwnProperty.call(data,'swim_ver'),
    };
    const scalarSource=value=>value===null||['string','number','boolean'].includes(typeof value);
    const ageYear=metadataPresent.ageYear
      ?readLegacySource(data,'swim_age_year',null,scalarSource,sourceIssues,'invalid-age-year',{allowRawString:true})
      :null;
    const studentIdVersion=metadataPresent.studentIdVersion
      ?readLegacySource(data,'swim_student_id_version',null,scalarSource,sourceIssues,'invalid-student-id-version',{allowRawString:true})
      :null;
    const legacyVersion=metadataPresent.legacyVersion
      ?readLegacySource(data,'swim_ver',null,scalarSource,sourceIssues,'invalid-legacy-version',{allowRawString:true})
      :null;
    return {
      branchId:text(branchId),
      sourceIssues,
      tabs,
      studentsByTab,
      instByTab,
      attendanceByTab,
      attendanceGuestsByTab,
      attendanceSnapshotsByTab,
      mainTab,
      parentTab,
      calendar:{
        disabled:parseStored(data.swim_disabled,{})||{},
        closed:parsedClosed,
        periods:effectivePeriods,
      },
      state:{
        retire:readLegacySource(data,'swim_retire',{},isPlainObject,sourceIssues,'invalid-retire-map'),
        enroll:readLegacySource(data,'swim_enroll',{},isPlainObject,sourceIssues,'invalid-enroll-map'),
        hyuwon:readLegacySource(data,'swim_hyuwon',{},isPlainObject,sourceIssues,'invalid-hyuwon-map'),
        move:readLegacySource(data,'swim_move',{},isPlainObject,sourceIssues,'invalid-move-map'),
        waitlist,
        marks:readLegacySource(data,'swim_mark',{},isPlainObject,sourceIssues,'invalid-mark-map'),
      },
      history:{
        retirements:readLegacySource(data,'swim_retire_history',[],Array.isArray,sourceIssues,'invalid-retirement-history-list'),
        deskRecords:readLegacySource(data,'swim_desk_notes',[],Array.isArray,sourceIssues,'invalid-desk-record-list'),
      },
      operational:{
        teachers,
        tabFolders,
        archivedTabs,
        metadataPresent,
        ageYear,
        studentIdVersion,
        legacyVersion,
      },
    };
  }
  function identityProfileKey(student){
    const parsed=parsedBangteukName(student);
    const name=text(parsed.name).replace(/\s+/g,' ').toLowerCase();
    const phone=digits(student?.p||student?.phone);
    const age=text(student?.a??student?.age);
    const gender=text(student?.g||student?.gender).toLowerCase();
    return [name,phone,age,gender].join('|');
  }
  function legacyIdentityConflicts(bundle){
    const byPersonId=new Map();
    const tabs=Array.isArray(bundle?.tabs)?bundle.tabs:[];
    tabs.forEach(tab=>{
      const tabId=text(tab?.id)||'regular';
      const tabType=courseTypeForTab(tab);
      const tabName=text(tab?.name)||(tabType==='bangteuk'?'방학특강':'정규시간표');
      const stuKey=legacyTabKeys(tab).students;
      const students=Array.isArray(bundle?.studentsByTab?.[tabId])?bundle.studentsByTab[tabId]:[];
      students.forEach((student,index)=>{
        const personId=text(student?.sid);
        if(!personId) return;
        const person=personFromStudent(student);
        const profileKey=identityProfileKey(student);
        if(!byPersonId.has(personId)) byPersonId.set(personId,new Map());
        const profiles=byPersonId.get(personId);
        if(!profiles.has(profileKey)){
          profiles.set(profileKey,{
            key:profileKey,
            name:person.name,
            phone:person.phone,
            age:person.age,
            gender:person.gender,
            expectedPersonId:personIdFor({...student,sid:''}),
            occurrences:[],
          });
        }
        profiles.get(profileKey).occurrences.push({
          tabId,tabName,tabType,stuKey,index,
          slotKey:slotKeyFor(student),
          time:text(student?.t),day:text(student?.d),lane:Number(student?.l)||0,seat:Number(student?.r)||0,
        });
      });
    });
    const conflicts=[];
    byPersonId.forEach((profileMap,personId)=>{
      const profiles=[...profileMap.values()];
      const hasConflict=profiles.some((profile,index)=>profiles.slice(index+1).some(other=>profilesConflict(profile,other)));
      if(!hasConflict) return;
      profiles.forEach(profile=>{
        profile.regularCount=profile.occurrences.filter(item=>item.tabType==='regular').length;
        profile.bangteukCount=profile.occurrences.filter(item=>item.tabType==='bangteuk').length;
      });
      profiles.sort((a,b)=>{
        const aExpected=a.expectedPersonId===personId?1:0;
        const bExpected=b.expectedPersonId===personId?1:0;
        return bExpected-aExpected||b.regularCount-a.regularCount||b.occurrences.length-a.occurrences.length||a.key.localeCompare(b.key);
      });
      conflicts.push({
        personId,
        suggestedKeepKey:profiles[0]?.key||'',
        profiles,
        occurrenceCount:profiles.reduce((sum,profile)=>sum+profile.occurrences.length,0),
      });
    });
    return conflicts.sort((a,b)=>a.personId.localeCompare(b.personId));
  }
  function diagnoseLegacyRoot(branchId,root){
    const bundle=legacyBundleFromRoot(branchId,root);
    const conversion=convertLegacySchedule(bundle);
    // 열려 있던 화면이 새 스키마를 받는 순간에도 새 컬렉션이 아직 없는
    // 이전 변환 결과는 빈 배열로 취급한다. 운영 V1 데이터에는 손대지 않는다.
    const retirementRecords=Array.isArray(conversion.retirementRecords)?conversion.retirementRecords:[];
    const deskStudentRecords=Array.isArray(conversion.deskStudentRecords)?conversion.deskStudentRecords:[];
    const identityConflicts=legacyIdentityConflicts(bundle);
    const legacyPlacements=Object.values(bundle.studentsByTab)
      .reduce((sum,students)=>sum+(Array.isArray(students)?students.length:0),0);
    const legacyMarks=Object.values(bundle.state?.marks||{}).reduce((sum,raw)=>{
      const value=raw&&typeof raw==='object'?raw:null;
      return sum+1+(value&&value.sub!=null?1:0);
    },0);
    const legacyAttendanceRecords=Object.values(bundle.attendanceByTab||{})
      .reduce((sum,map)=>sum+Object.keys(map&&typeof map==='object'&&!Array.isArray(map)?map:{}).length,0);
    const legacyAttendanceGuests=Object.values(bundle.attendanceGuestsByTab||{}).reduce((sum,map)=>{
      return sum+Object.values(map&&typeof map==='object'&&!Array.isArray(map)?map:{}).reduce((count,list)=>{
        return count+(Array.isArray(list)?list.length:1);
      },0);
    },0);
    const legacyAttendanceSnapshots=Object.values(bundle.attendanceSnapshotsByTab||{})
      .reduce((sum,map)=>sum+Object.keys(map&&typeof map==='object'&&!Array.isArray(map)?map:{}).length,0);
    const legacyAttendanceSnapshotStudents=Object.values(bundle.attendanceSnapshotsByTab||{}).reduce((sum,map)=>{
      return sum+Object.values(map&&typeof map==='object'&&!Array.isArray(map)?map:{}).reduce((count,snapshot)=>{
        return count+(Array.isArray(snapshot?.students)?snapshot.students.length:(snapshot?.students==null?0:1));
      },0);
    },0);
    const legacyAttendanceSnapshotTeachers=Object.values(bundle.attendanceSnapshotsByTab||{}).reduce((sum,map)=>{
      return sum+Object.values(map&&typeof map==='object'&&!Array.isArray(map)?map:{}).reduce((count,snapshot)=>{
        const inst=snapshot?.inst;
        return count+(inst&&typeof inst==='object'&&!Array.isArray(inst)?Object.keys(inst).length:(inst==null?0:1));
      },0);
    },0);
    const legacyDisabledSlots=Object.keys(bundle.calendar?.disabled&&typeof bundle.calendar.disabled==='object'&&!Array.isArray(bundle.calendar.disabled)
      ?bundle.calendar.disabled:{}).length;
    const legacyCalendarClosures=Array.isArray(bundle.calendar?.closed)?bundle.calendar.closed.length:(bundle.calendar?.closed==null?0:1);
    const legacySchedulePeriods=Array.isArray(bundle.calendar?.periods)?bundle.calendar.periods.length:(bundle.calendar?.periods==null?0:1);
    const legacyTeacherProfiles=Array.isArray(bundle.operational?.teachers)?bundle.operational.teachers.length:(bundle.operational?.teachers==null?0:1);
    const legacyTabFolders=Array.isArray(bundle.operational?.tabFolders)?bundle.operational.tabFolders.length:(bundle.operational?.tabFolders==null?0:1);
    const legacyArchivedTabs=Array.isArray(bundle.operational?.archivedTabs)?bundle.operational.archivedTabs.length:(bundle.operational?.archivedTabs==null?0:1);
    const metadataPresent=bundle.operational?.metadataPresent||{};
    const legacySystemMetadata=['ageYear','studentIdVersion','legacyVersion'].filter(key=>metadataPresent[key]).length;
    const legacyRetirementRecords=Array.isArray(bundle.history?.retirements)?bundle.history.retirements.length:(bundle.history?.retirements==null?0:1);
    const legacyDeskStudentRecords=Array.isArray(bundle.history?.deskRecords)?bundle.history.deskRecords.length:(bundle.history?.deskRecords==null?0:1);
    const conversionBlocking=conversion.issues.filter(issue=>[
      'missing-person-id','person-profile-conflict','slot-conflict','ambiguous-tab-scope',
      'ambiguous-fallback-identity'
    ].includes(issue.type));
    const blockingIssues=[...(Array.isArray(bundle.sourceIssues)?bundle.sourceIssues:[]),...conversionBlocking];
    const report={
      branchId:text(branchId),
      checks:{
        legacyPlacements,
        convertedPlacements:conversion.placements.length,
        placementCountMatches:legacyPlacements===conversion.placements.length,
        legacyMarks,
        convertedMarks:conversion.classMarks.length,
        markCountMatches:legacyMarks===conversion.classMarks.length,
        legacyAttendanceRecords,
        convertedAttendanceRecords:conversion.attendanceRecords.length,
        attendanceRecordCountMatches:legacyAttendanceRecords===conversion.attendanceRecords.length,
        legacyAttendanceGuests,
        convertedAttendanceGuests:conversion.attendanceGuests.length,
        attendanceGuestCountMatches:legacyAttendanceGuests===conversion.attendanceGuests.length,
        legacyAttendanceSnapshots,
        convertedAttendanceSnapshots:conversion.attendanceSnapshots.length,
        attendanceSnapshotCountMatches:legacyAttendanceSnapshots===conversion.attendanceSnapshots.length,
        legacyAttendanceSnapshotStudents,
        convertedAttendanceSnapshotStudents:conversion.attendanceSnapshotStudents.length,
        attendanceSnapshotStudentCountMatches:legacyAttendanceSnapshotStudents===conversion.attendanceSnapshotStudents.length,
        legacyAttendanceSnapshotTeachers,
        convertedAttendanceSnapshotTeachers:conversion.attendanceSnapshotTeachers.length,
        attendanceSnapshotTeacherCountMatches:legacyAttendanceSnapshotTeachers===conversion.attendanceSnapshotTeachers.length,
        legacyDisabledSlots,
        convertedDisabledSlots:conversion.disabledSlots.length,
        disabledSlotCountMatches:legacyDisabledSlots===conversion.disabledSlots.length,
        legacyCalendarClosures,
        convertedCalendarClosures:conversion.calendarClosures.length,
        calendarClosureCountMatches:legacyCalendarClosures===conversion.calendarClosures.length,
        legacySchedulePeriods,
        convertedSchedulePeriods:conversion.schedulePeriods.length,
        schedulePeriodCountMatches:legacySchedulePeriods===conversion.schedulePeriods.length,
        legacyTeacherProfiles,
        convertedTeacherProfiles:conversion.teacherProfiles.length,
        teacherProfileCountMatches:legacyTeacherProfiles===conversion.teacherProfiles.length,
        legacyTabFolders,
        convertedTabFolders:conversion.tabFolders.length,
        tabFolderCountMatches:legacyTabFolders===conversion.tabFolders.length,
        legacyArchivedTabs,
        convertedArchivedTabs:conversion.archivedTabs.length,
        archivedTabCountMatches:legacyArchivedTabs===conversion.archivedTabs.length,
        legacySystemMetadata,
        convertedSystemMetadata:conversion.systemMetadata.length,
        systemMetadataCountMatches:legacySystemMetadata===conversion.systemMetadata.length,
        legacyRetirementRecords,
        convertedRetirementRecords:retirementRecords.length,
        retirementRecordCountMatches:legacyRetirementRecords===retirementRecords.length,
        legacyDeskStudentRecords,
        convertedDeskStudentRecords:deskStudentRecords.length,
        deskStudentRecordCountMatches:legacyDeskStudentRecords===deskStudentRecords.length,
        hasBlockingIssues:blockingIssues.length>0,
        ready:legacyPlacements===conversion.placements.length
          &&legacyMarks===conversion.classMarks.length
          &&legacyAttendanceRecords===conversion.attendanceRecords.length
          &&legacyAttendanceGuests===conversion.attendanceGuests.length
          &&legacyAttendanceSnapshots===conversion.attendanceSnapshots.length
          &&legacyAttendanceSnapshotStudents===conversion.attendanceSnapshotStudents.length
          &&legacyAttendanceSnapshotTeachers===conversion.attendanceSnapshotTeachers.length
          &&legacyDisabledSlots===conversion.disabledSlots.length
          &&legacyCalendarClosures===conversion.calendarClosures.length
          &&legacySchedulePeriods===conversion.schedulePeriods.length
          &&legacyTeacherProfiles===conversion.teacherProfiles.length
          &&legacyTabFolders===conversion.tabFolders.length
          &&legacyArchivedTabs===conversion.archivedTabs.length
          &&legacySystemMetadata===conversion.systemMetadata.length
          &&legacyRetirementRecords===retirementRecords.length
          &&legacyDeskStudentRecords===deskStudentRecords.length
          &&!blockingIssues.length,
      },
    };
    Object.defineProperties(report,{
      bundle:{value:bundle,writable:true,configurable:true,enumerable:false},
      conversion:{value:conversion,writable:true,configurable:true,enumerable:false},
      identityConflicts:{value:identityConflicts,writable:true,configurable:true,enumerable:false},
      blockingIssues:{value:blockingIssues,writable:true,configurable:true,enumerable:false},
    });
    return report;
  }
  function entryDate(entry){
    if(!entry||typeof entry!=='object') return '';
    return text(entry.ds||entry.date||entry.startDate||entry.retiredAt||entry.retirementDate||entry.dateKey||(Array.isArray(entry.dates)?entry.dates[0]:''));
  }
  function tabContainsDate(tab,date,periods){
    if(!date) return false;
    const start=text(tab?.seasonStart||tab?.periodStart||tab?.start);
    const end=text(tab?.seasonEnd||tab?.periodEnd||tab?.end);
    if(start&&date<start) return false;
    if(end&&date>end) return false;
    if(start||end) return true;
    const periodMonth=text(tab?.periodMonth);
    if(/^\d{4}-\d{2}$/.test(periodMonth)){
      const month=Number(periodMonth.slice(5,7));
      const year=Number(periodMonth.slice(0,4));
      const period=(Array.isArray(periods)?periods:[]).find(item=>{
        const periodStart=text(item?.start||item?.startDate);
        return Number(item?.month)===month&&(!periodStart||Number(periodStart.slice(0,4))===year);
      });
      if(period){
        const periodStart=text(period.start||period.startDate);
        const periodEnd=text(period.end||period.endDate);
        return (!periodStart||date>=periodStart)&&(!periodEnd||date<=periodEnd);
      }
      return date.slice(0,7)===periodMonth;
    }
    return false;
  }
  function resolveEventTab(bundle,entry,issues,context){
    const explicit=text(entry?.tabId||entry?.sourceTabId);
    if(explicit&&bundle.tabs.some(tab=>tab.id===explicit)) return explicit;
    const courseType=entry?.bangteuk===true?'bangteuk':'regular';
    let candidates=bundle.tabs.filter(tab=>courseTypeForTab(tab)===courseType);
    const date=entryDate(entry);
    const dated=candidates.filter(tab=>tabContainsDate(tab,date,bundle.calendar?.periods));
    if(dated.length===1) return dated[0].id;
    if(courseType==='regular'&&context?.allowMainFallback!==false){
      const mainId=text(bundle.mainTab?.tabId);
      const main=candidates.find(tab=>tab.id===mainId)||candidates.find(tab=>tab.id==='regular');
      if(main) return main.id;
    }
    if(candidates.length===1) return candidates[0].id;
    issues.push({
      type:'ambiguous-tab-scope',
      tabId:'',
      slotKey:text(context?.slotKey||context?.instKey),
      eventType:text(context?.eventType),
      candidateTabIds:candidates.map(tab=>tab.id),
      date,
    });
    return '';
  }
  function eventPersonId(entry){
    if(!entry||typeof entry!=='object') return '';
    return personIdFor({
      sid:entry.sid,
      n:entry.name||entry.n,
      p:entry.p||entry.phone,
      a:entry.age||entry.a,
      g:entry.g||entry.gender,
    });
  }
  function legacyReservationId(type,tabId,slotKey,entry,index){
    const moveId=text(entry?.moveId);
    if(moveId) return id('res',`move|${moveId}`);
    const date=entryDate(entry);
    const personId=eventPersonId(entry);
    return id('res',`${type}|${tabId}|${slotKey}|${date}|${personId}|${index||0}`);
  }
  function legacyMarkParts(markKey){
    const parts=text(markKey).split('/');
    if(parts.length<5) return null;
    const date=parts.pop();
    const time=parts.shift()||'';
    const day=parts.shift()||'';
    const lane=Number(parts.shift())||0;
    const seat=Number(parts.shift())||0;
    if(!time||!day||!lane||!seat||!date) return null;
    return {time,day,lane,seat,date,slotKey:[time,day,lane,seat].join('/')};
  }
  function markPayload(raw){
    if(raw&&typeof raw==='object'&&!Array.isArray(raw)) return clone(raw);
    return {type:text(raw)||'unknown'};
  }
  function markTabId(bundle,parts,payload,context){
    const tabs=Array.isArray(bundle?.tabs)?bundle.tabs:[];
    const explicit=text(payload?.targetTabId||payload?.tabId||payload?.scheduleTabId);
    if(explicit&&tabs.some(tab=>tab.id===explicit)) return explicit;
    const requestedType=text(payload?.studentScheduleType).toLowerCase();
    const requestedCourse=requestedType==='bangteuk'||requestedType==='방특'
      ?'bangteuk'
      :(requestedType==='regular'||requestedType==='정규'?'regular':'');
    const candidates=new Set();
    (context?.placements||[]).forEach(item=>{
      if(item?.slotKey===parts.slotKey&&item.tabId) candidates.add(item.tabId);
    });
    (context?.teacherAssignments||[]).forEach(item=>{
      if(item?.slotKey===parts.slotKey&&item.tabId) candidates.add(item.tabId);
    });
    let possible=tabs.filter(tab=>candidates.has(tab.id));
    if(requestedCourse) possible=possible.filter(tab=>courseTypeForTab(tab)===requestedCourse);
    const dated=possible.filter(tab=>tabContainsDate(tab,parts.date,bundle.calendar?.periods));
    if(dated.length===1) return dated[0].id;
    if(possible.length===1) return possible[0].id;
    const typeTabs=requestedCourse?tabs.filter(tab=>courseTypeForTab(tab)===requestedCourse):tabs;
    const allDated=typeTabs.filter(tab=>tabContainsDate(tab,parts.date,bundle.calendar?.periods));
    if(allDated.length===1) return allDated[0].id;
    if(typeTabs.length===1) return typeTabs[0].id;
    if(requestedCourse==='bangteuk') return '';
    const mainId=text(bundle?.mainTab?.tabId);
    const main=typeTabs.find(tab=>tab.id===mainId)||typeTabs.find(tab=>tab.id==='regular');
    return main?.id||'';
  }
  function markPersonId(parts,payload,tabId,context){
    const hasDirectIdentity=text(payload?.sid||payload?.name||payload?.n||payload?.phone||payload?.p);
    const direct=hasDirectIdentity?eventPersonId(payload):'';
    if(direct) return direct;
    const candidates=(context?.placements||[]).filter(item=>
      item?.slotKey===parts.slotKey&&(!tabId||item.tabId===tabId)
    );
    const ids=[...new Set(candidates.map(item=>text(item.personId)).filter(Boolean))];
    return ids.length===1?ids[0]:'';
  }
  function convertLegacyMarks(bundle,context){
    const source=bundle?.state?.marks;
    const helper=global.SCScheduleTime;
    const marks=helper&&typeof helper.normalizeStoredValue==='function'
      ? helper.normalizeStoredValue('swim_mark',clone(source||{}))
      : (source&&typeof source==='object'&&!Array.isArray(source)?source:{});
    const rows=[];
    Object.entries(marks||{}).forEach(([legacyKey,raw])=>{
      const parts=legacyMarkParts(legacyKey);
      if(!parts) return;
      const primary=markPayload(raw);
      const secondary=primary.sub==null?null:markPayload(primary.sub);
      delete primary.sub;
      const add=(layer,payload)=>{
        const tabId=markTabId(bundle,parts,payload,context);
        const tab=(bundle.tabs||[]).find(item=>item.id===tabId)||null;
        rows.push({
          id:id('mark',`${legacyKey}|${layer}`),
          legacyKey,
          layer,
          tabId,
          scope:tabId?'tab':'legacy-global',
          courseType:tab?courseTypeForTab(tab):'',
          slotKey:parts.slotKey,
          time:parts.time,
          day:parts.day,
          lane:parts.lane,
          seat:parts.seat,
          date:parts.date,
          type:text(payload.type)||'unknown',
          personId:markPersonId(parts,payload,tabId,context),
          name:text(payload.n||payload.name),
          phone:digits(payload.p||payload.phone),
          payload:clone(payload),
          schemaVersion:SCHEMA_VERSION,
        });
      };
      add('primary',primary);
      if(secondary) add('secondary',secondary);
    });
    return rows;
  }
  function legacyAttendanceParts(attendanceKey){
    const raw=text(attendanceKey);
    const isSub=raw.endsWith('#sub');
    const baseKey=isSub?raw.slice(0,-4):raw;
    const parts=baseKey.split('/');
    if(parts.length!==5) return null;
    const [time,day,laneRaw,seatRaw,date]=parts;
    const lane=Number(laneRaw)||0;
    const seat=Number(seatRaw)||0;
    if(!time||!day||!lane||!seat||!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return {
      time,day,lane,seat,date,isSub,
      slotKey:[time,day,lane,seat].join('/'),
    };
  }
  function legacyAttendanceGuestParts(guestKey){
    const parts=text(guestKey).split('/');
    if(parts.length!==4) return null;
    const [time,day,laneRaw,date]=parts;
    const lane=Number(laneRaw)||0;
    if(!time||!day||!lane||!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return {time,day,lane,date,slotGroupKey:[time,day,lane].join('/')};
  }
  function normalizedAttendanceMap(tabId,map,kind){
    const helper=global.SCScheduleTime;
    const key=kind==='guests'
      ?(tabId==='regular'?'swim_att_guests':`swim_bt_att_guests_${tabId}`)
      :(tabId==='regular'?'swim_attendance':`swim_bt_attendance_${tabId}`);
    if(helper&&typeof helper.normalizeStoredValue==='function'){
      return helper.normalizeStoredValue(key,clone(map||{}));
    }
    return map&&typeof map==='object'&&!Array.isArray(map)?map:{};
  }
  function placementForAttendance(tabId,slotKey,context){
    const matches=(context?.placements||[]).filter(item=>item?.tabId===tabId&&item?.slotKey===slotKey);
    return matches.length===1?matches[0]:null;
  }
  function classMarkForAttendance(tabId,parts,context){
    const layer=parts.isSub?'secondary':'primary';
    const matches=(context?.classMarks||[]).filter(item=>
      item?.tabId===tabId&&item?.slotKey===parts.slotKey&&item?.date===parts.date&&item?.layer===layer
    );
    return matches.length===1?matches[0]:null;
  }
  function attendanceValue(raw){
    if(raw&&typeof raw==='object'&&!Array.isArray(raw)) return clone(raw);
    return {s:text(raw)};
  }
  function convertLegacyAttendance(bundle,context){
    const attendanceRecords=[];
    const attendanceGuests=[];
    const tabsById=new Map((bundle.tabs||[]).map(tab=>[tab.id,tab]));

    Object.entries(bundle.attendanceByTab||{}).forEach(([tabId,source])=>{
      const tab=tabsById.get(tabId)||null;
      const owner=attendanceOwner(tabId,tab);
      const map=normalizedAttendanceMap(tabId,source,'records');
      Object.entries(map||{}).forEach(([legacyKey,raw])=>{
        const parts=legacyAttendanceParts(legacyKey);
        if(!parts) return;
        const payload=attendanceValue(raw);
        const mark=classMarkForAttendance(tabId,parts,context);
        const placement=parts.isSub?null:placementForAttendance(tabId,parts.slotKey,context);
        const personId=text(mark?.personId||placement?.personId);
        attendanceRecords.push({
          id:id('att',`${owner.tabId}|${legacyKey}`),
          legacyKey,
          tabId:owner.tabId,
          courseType:owner.courseType,
          recordType:parts.isSub?'marked-student':'scheduled-student',
          slotKey:parts.slotKey,
          time:parts.time,
          day:parts.day,
          lane:parts.lane,
          seat:parts.seat,
          date:parts.date,
          personId,
          enrollmentId:personId?enrollmentIdFor(personId,tabId):'',
          classMarkId:text(mark?.id),
          status:text(payload.s||payload.status),
          checkedAt:text(payload.at),
          checkedBy:text(payload.by),
          payload,
          schemaVersion:SCHEMA_VERSION,
        });
      });
    });

    Object.entries(bundle.attendanceGuestsByTab||{}).forEach(([tabId,source])=>{
      const tab=tabsById.get(tabId)||null;
      const owner=attendanceOwner(tabId,tab);
      const map=normalizedAttendanceMap(tabId,source,'guests');
      Object.entries(map||{}).forEach(([legacyKey,list])=>{
        const group=legacyAttendanceGuestParts(legacyKey);
        if(!group||!Array.isArray(list)) return;
        list.forEach((raw,index)=>{
          if(!raw||typeof raw!=='object') return;
          const payload=clone(raw);
          const slotParts=text(payload.slotKey).split('/');
          const hasSlot=slotParts.length===4;
          const slotKey=hasSlot?slotParts.join('/'):group.slotGroupKey;
          const lane=hasSlot?(Number(slotParts[2])||group.lane):group.lane;
          const seat=hasSlot?(Number(slotParts[3])||0):0;
          const guestId=text(payload.gid);
          const personId=text(payload.sid)||personIdFor({
            n:payload.n||payload.name,
            p:payload.p||payload.phone,
            a:payload.a||payload.age,
            g:payload.g||payload.gender,
          });
          attendanceGuests.push({
            id:id('guest',`${owner.tabId}|${legacyKey}|${guestId||index}`),
            legacyKey,
            guestId,
            tabId:owner.tabId,
            courseType:owner.courseType,
            slotGroupKey:group.slotGroupKey,
            slotKey,
            time:group.time,
            day:group.day,
            lane,
            seat,
            date:group.date,
            personId,
            name:text(payload.n||payload.name),
            phone:digits(payload.p||payload.phone),
            age:payload.a??payload.age??null,
            entryType:text(payload.type)||'guest',
            status:text(payload.s||payload.status),
            checkedAt:text(payload.at),
            checkedBy:text(payload.by),
            order:index,
            payload,
            schemaVersion:SCHEMA_VERSION,
          });
        });
      });
    });
    return {attendanceRecords,attendanceGuests};
  }
  function convertLegacyAttendanceSnapshots(bundle){
    const attendanceSnapshots=[];
    const attendanceSnapshotStudents=[];
    const attendanceSnapshotTeachers=[];
    const tabsById=new Map((bundle.tabs||[]).map(tab=>[tab.id,tab]));
    const helper=global.SCScheduleTime;
    Object.entries(bundle.attendanceSnapshotsByTab||{}).forEach(([tabId,map])=>{
      const tab=tabsById.get(tabId)||null;
      const owner=attendanceOwner(tabId,tab);
      Object.entries(map&&typeof map==='object'&&!Array.isArray(map)?map:{}).forEach(([date,raw])=>{
        if(!/^\d{4}-\d{2}-\d{2}$/.test(text(date))) return;
        const storageKey=`zz_swim_day_snapshot__${attendanceSnapshotScope(tab)}__${date}`;
        const snapshot=helper&&typeof helper.normalizeStoredValue==='function'
          ?helper.normalizeStoredValue(storageKey,clone(raw))
          :clone(raw);
        if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||!Array.isArray(snapshot.students)) return;
        const inst=snapshot.inst&&typeof snapshot.inst==='object'&&!Array.isArray(snapshot.inst)?snapshot.inst:{};
        const snapshotId=id('ats',`${owner.tabId}|${date}`);
        attendanceSnapshots.push({
          id:snapshotId,
          tabId:owner.tabId,
          courseType:owner.courseType,
          date,
          studentCount:snapshot.students.length,
          teacherCount:Object.keys(inst).length,
          createdAt:text(snapshot.createdAt||snapshot.at),
          schemaVersion:SCHEMA_VERSION,
        });
        snapshot.students.forEach((student,index)=>{
          if(!student||typeof student!=='object') return;
          const person=personFromStudent(student);
          const slotKey=slotKeyFor(student);
          attendanceSnapshotStudents.push({
            id:id('atstu',`${owner.tabId}|${date}|${slotKey}|${person.id}|${index}`),
            snapshotId,
            tabId:owner.tabId,
            courseType:owner.courseType,
            date,
            personId:person.id,
            name:person.name,
            phone:person.phone,
            age:person.age,
            gender:person.gender,
            slotKey,
            time:text(student.t),
            day:text(student.d),
            lane:Number(student.l)||0,
            seat:Number(student.r)||0,
            order:index,
            payload:clone(student),
            schemaVersion:SCHEMA_VERSION,
          });
        });
        Object.entries(inst).forEach(([slotKey,teacher],index)=>{
          const teacherName=text(typeof teacher==='object'?(teacher.name||teacher.n):teacher);
          if(!teacherName) return;
          attendanceSnapshotTeachers.push({
            id:id('atinst',`${owner.tabId}|${date}|${slotKey}`),
            snapshotId,
            tabId:owner.tabId,
            courseType:owner.courseType,
            date,
            slotKey:text(slotKey),
            teacherName,
            order:index,
            payload:clone(teacher),
            schemaVersion:SCHEMA_VERSION,
          });
        });
      });
    });
    return {attendanceSnapshots,attendanceSnapshotStudents,attendanceSnapshotTeachers};
  }
  function legacySlotParts(slotKey){
    const parts=text(slotKey).split('/');
    if(parts.length!==4) return null;
    const [time,day,laneRaw,seatRaw]=parts;
    const lane=Number(laneRaw)||0;
    const seat=Number(seatRaw)||0;
    if(!time||!day||!lane||!seat) return null;
    return {time,day,lane,seat,slotKey:[time,day,lane,seat].join('/')};
  }
  function convertLegacyCalendar(bundle,context){
    const calendar=bundle.calendar||{};
    const tabsById=new Map((bundle.tabs||[]).map(tab=>[tab.id,tab]));
    const disabledSource=calendar.disabled&&typeof calendar.disabled==='object'&&!Array.isArray(calendar.disabled)
      ?calendar.disabled:{};
    const helper=global.SCScheduleTime;
    const disabled=helper&&typeof helper.normalizeStoredValue==='function'
      ?helper.normalizeStoredValue('swim_disabled',clone(disabledSource))
      :clone(disabledSource);
    const disabledSlots=[];
    Object.entries(disabled||{}).forEach(([legacyKey,value])=>{
      const parts=legacySlotParts(legacyKey);
      if(!parts) return;
      const candidateTabIds=[...new Set([
        ...(context?.placements||[]).filter(item=>item?.slotKey===parts.slotKey).map(item=>text(item.tabId)),
        ...(context?.teacherAssignments||[]).filter(item=>item?.slotKey===parts.slotKey).map(item=>text(item.tabId)),
      ].filter(Boolean))];
      const tabId=candidateTabIds.length===1?candidateTabIds[0]:'';
      const tab=tabsById.get(tabId)||null;
      disabledSlots.push({
        id:id('disabled',`${tabId||'legacy-global'}|${legacyKey}`),
        legacyKey,
        tabId,
        scope:tabId?'tab':'legacy-global',
        candidateTabIds,
        courseType:tab?courseTypeForTab(tab):'',
        slotKey:parts.slotKey,
        time:parts.time,
        day:parts.day,
        lane:parts.lane,
        seat:parts.seat,
        disabled:value!==false,
        payload:clone(value),
        schemaVersion:SCHEMA_VERSION,
      });
    });
    const calendarClosures=[];
    (Array.isArray(calendar.closed)?calendar.closed:[]).forEach((raw,index)=>{
      if(!raw||typeof raw!=='object') return;
      const start=text(raw.start);
      const end=text(raw.end)||start;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)) return;
      calendarClosures.push({
        id:id('closed',`${start}|${end}|${text(raw.type)}|${index}`),
        startDate:start,
        endDate:end,
        type:text(raw.type)||'휴관',
        memo:text(raw.memo),
        order:index,
        payload:clone(raw),
        schemaVersion:SCHEMA_VERSION,
      });
    });
    const schedulePeriods=[];
    (Array.isArray(calendar.periods)?calendar.periods:[]).forEach((raw,index)=>{
      if(!raw||typeof raw!=='object') return;
      const start=text(raw.start);
      const end=text(raw.end);
      const month=Number(raw.month)||0;
      if(!month||!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)) return;
      schedulePeriods.push({
        id:id('period',`${start}|${end}|${month}|${index}`),
        year:Number(start.slice(0,4))||0,
        month,
        startDate:start,
        endDate:end,
        order:index,
        payload:clone(raw),
        schemaVersion:SCHEMA_VERSION,
      });
    });
    const main=bundle.mainTab&&typeof bundle.mainTab==='object'?clone(bundle.mainTab):{};
    const parent=bundle.parentTab&&typeof bundle.parentTab==='object'?clone(bundle.parentTab):{};
    const scheduleSettings=[{
      id:'branch_schedule_settings',
      mainTabId:text(main.tabId),
      parentTabId:text(parent.tabId),
      mainTab:main,
      parentTab:parent,
      schemaVersion:SCHEMA_VERSION,
    }];
    return {disabledSlots,calendarClosures,schedulePeriods,scheduleSettings};
  }
  function convertLegacyOperational(bundle){
    const operational=bundle.operational||{};
    const teacherProfiles=(Array.isArray(operational.teachers)?operational.teachers:[]).map((raw,index)=>{
      const value=isPlainObject(raw)?clone(raw):{n:text(raw)};
      const name=text(value.n||value.name);
      return {
        id:id('teacher',`${text(value.id)||name}|${index}`),
        sourceId:text(value.id),
        name,
        color:text(value.color||value.c),
        order:index,
        payload:value,
        schemaVersion:SCHEMA_VERSION,
      };
    }).filter(row=>row.name);
    const tabFolders=(Array.isArray(operational.tabFolders)?operational.tabFolders:[]).map((raw,index)=>({
      id:id('folder',`${text(raw)}|${index}`),
      name:text(raw),
      order:index,
      schemaVersion:SCHEMA_VERSION,
    })).filter(row=>row.name);
    const archivedTabs=(Array.isArray(operational.archivedTabs)?operational.archivedTabs:[]).map((raw,index)=>({
      id:id('archived-tab',text(raw?.id)||String(index)),
      sourceTabId:text(raw?.id),
      name:text(raw?.name),
      type:text(raw?.type)||'regular',
      periodMonth:text(raw?.periodMonth),
      archivedAt:text(raw?.archivedAt),
      studentKey:text(raw?.stuKey),
      teacherKey:text(raw?.instKey),
      payload:clone(raw),
      schemaVersion:SCHEMA_VERSION,
    })).filter(row=>row.sourceTabId);
    const present=operational.metadataPresent||{};
    const systemMetadata=[];
    const addMetadata=(key,value)=>{
      systemMetadata.push({id:key,key,value:clone(value),schemaVersion:SCHEMA_VERSION});
    };
    if(present.ageYear) addMetadata('age_year',operational.ageYear);
    if(present.studentIdVersion) addMetadata('student_id_version',operational.studentIdVersion);
    if(present.legacyVersion) addMetadata('legacy_data_version',operational.legacyVersion);
    return {teacherProfiles,tabFolders,archivedTabs,systemMetadata};
  }
  function historyRowId(prefix,raw,occurrences,stableSeed){
    const sourceId=text(raw?.id);
    const sourceKey=text(raw?.sourceKey);
    const fingerprint=sourceId
      ?`source|${sourceId}`
      :(sourceKey?`source-key|${sourceKey}`:`stable|${text(stableSeed)}`);
    const duplicateIndex=occurrences.get(fingerprint)||0;
    occurrences.set(fingerprint,duplicateIndex+1);
    return id(prefix,`${fingerprint}|${duplicateIndex}`);
  }
  function historyTabId(bundle,raw,issues,eventType){
    const entry={...raw};
    if(entry.bangteuk==null) entry.bangteuk=text(entry.tabType)==='bangteuk';
    return resolveEventTab(bundle,entry,issues,{
      slotKey:text(raw?.slotKey),eventType,allowMainFallback:false,
    });
  }
  function historyPersonId(raw){
    const sid=text(raw?.sid||raw?.personId);
    if(sid) return sid;
    const name=text(raw?.n||raw?.name||raw?.student||raw?.target);
    const phone=digits(raw?.p||raw?.phone);
    return name&&phone?eventPersonId({n:name,p:phone,a:raw?.a||raw?.age,g:raw?.g||raw?.gender}):'';
  }
  function convertLegacyHistory(bundle,issues){
    const retirementRecords=[];
    const deskStudentRecords=[];
    const retirementOccurrences=new Map();
    const deskOccurrences=new Map();
    (Array.isArray(bundle.history?.retirements)?bundle.history.retirements:[]).forEach((raw,index)=>{
      if(!raw||typeof raw!=='object'||Array.isArray(raw)) return;
      const payload=clone(raw);
      const slotKey=text(raw.slotKey)||[text(raw.t),text(raw.d),text(raw.l),text(raw.r)].join('/');
      const tabId=historyTabId(bundle,raw,issues,'retirement-record');
      const stableSeed=[
        text(raw.recordedAt||raw.createdAt),
        text(raw.sid||raw.personId),text(raw.n||raw.name),digits(raw.p||raw.phone),
        slotKey,text(raw.retiredAt||raw.retirementDate),index,
      ].join('|');
      retirementRecords.push({
        id:historyRowId('retrec',raw,retirementOccurrences,stableSeed),
        sourceId:text(raw.id),
        tabId,
        courseType:raw.bangteuk===true||text(raw.tabType)==='bangteuk'?'bangteuk':'regular',
        personId:historyPersonId(raw),
        name:text(raw.n||raw.name),
        phone:digits(raw.p||raw.phone),
        age:raw.a??raw.age??null,
        teacherName:text(raw.inst||raw.teacher),
        slotKey,
        time:text(raw.t||raw.time),
        day:text(raw.d||raw.day),
        lane:Number(raw.l||raw.lane)||0,
        seat:Number(raw.r||raw.seat)||0,
        retirementDate:text(raw.retiredAt||raw.retirementDate),
        recordedAt:text(raw.recordedAt||raw.createdAt),
        enrolledFrom:text(raw.enrolledFrom||raw.enrolled),
        location:text(raw.loc||raw.location),
        memo:text(raw.memo),
        order:index,
        payload,
        schemaVersion:SCHEMA_VERSION,
      });
    });
    (Array.isArray(bundle.history?.deskRecords)?bundle.history.deskRecords:[]).forEach((raw,index)=>{
      if(!raw||typeof raw!=='object'||Array.isArray(raw)) return;
      const payload=clone(raw);
      const original=raw.original&&typeof raw.original==='object'&&!Array.isArray(raw.original)?clone(raw.original):{};
      const tabId=historyTabId(bundle,raw,issues,'desk-student-record');
      const time=text(raw.time||original.time);
      const day=text(raw.day||original.day)||'기타';
      const lane=Number(raw.l||raw.lane)||0;
      const seat=Number(raw.r||raw.seat)||0;
      const stableSeed=[
        text(raw.at||raw.createdAt||original.at),
        text(raw.sid||raw.personId),text(raw.student||raw.target||original.student),
        time,day,lane,seat,text(raw.dateKey||original.dateKey),index,
      ].join('|');
      deskStudentRecords.push({
        id:historyRowId('deskrec',raw,deskOccurrences,stableSeed),
        sourceId:text(raw.id),
        sourceKey:text(raw.sourceKey),
        tabId,
        tabName:text(raw.tabName||original.tabName),
        courseType:raw.bangteuk===true||text(raw.tabType||original.tabType)==='bangteuk'?'bangteuk':'regular',
        personId:historyPersonId(raw),
        studentName:text(raw.student||raw.target||original.student),
        teacherName:text(raw.teacher||original.teacher),
        changeType:text(raw.change||raw.reason||original.change),
        displayDate:text(raw.date||original.date),
        dateKey:text(raw.dateKey||original.dateKey),
        recordMonthKey:text(raw.recordMonthKey),
        monthKey:text(raw.monthKey),
        time,
        day,
        lane,
        seat,
        slotKey:text(raw.slotKey)||(time&&day&&lane&&seat?[time,day,lane,seat].join('/'):''),
        detail:text(raw.detail||original.detail),
        operationType:text(raw.operationType||original.operationType),
        operationLabel:text(raw.operationLabel||original.operationLabel),
        operationDetail:text(raw.operationDetail||original.operationDetail),
        deleteReason:text(raw.deleteReason||original.deleteReason),
        source:text(raw.source||original.source),
        manual:raw.manual===true,
        deleted:raw.deleted===true,
        recordedAt:text(raw.at||raw.createdAt),
        updatedAt:text(raw.updatedAt),
        order:index,
        original,
        payload,
        schemaVersion:SCHEMA_VERSION,
      });
    });
    return {retirementRecords,deskStudentRecords};
  }
  function convertLegacyState(bundle,issues,context){
    const state=bundle.state||{};
    const reservations=new Map();
    const waitlistEntries=[];
    const addSlotMap=(kind,map)=>{
      Object.entries(map&&typeof map==='object'?map:{}).forEach(([slotKey,raw],index)=>{
        const entry=raw&&typeof raw==='object'?clone(raw):{value:clone(raw)};
        const tabId=resolveEventTab(bundle,entry,issues,{slotKey,eventType:kind});
        const moveId=text(entry.moveId);
        const reservationId=legacyReservationId(kind,tabId,slotKey,entry,index);
        if(moveId){
          const current=reservations.get(reservationId)||{
            id:reservationId,
            type:'move',
            moveId,
            tabId,
            courseType:entry.bangteuk===true?'bangteuk':'regular',
            personId:eventPersonId(entry),
            status:'scheduled',
            sourceSlotKey:'',
            targetSlotKey:'',
            sourceDate:'',
            targetDate:'',
            source:null,
            target:null,
            schemaVersion:SCHEMA_VERSION,
          };
          if(kind==='retire'){
            current.sourceSlotKey=slotKey;
            current.targetSlotKey=text(entry.pairKey)||current.targetSlotKey;
            current.sourceDate=entryDate(entry);
            current.source=entry;
          }else{
            current.targetSlotKey=slotKey;
            current.sourceSlotKey=text(entry.pairKey)||current.sourceSlotKey;
            current.targetDate=entryDate(entry);
            current.target=entry;
          }
          if(!current.tabId&&tabId) current.tabId=tabId;
          if(!current.personId) current.personId=eventPersonId(entry);
          reservations.set(reservationId,current);
          return;
        }
        reservations.set(reservationId,{
          id:reservationId,
          type:kind,
          tabId,
          courseType:entry.bangteuk===true?'bangteuk':'regular',
          personId:eventPersonId(entry),
          slotKey,
          date:entryDate(entry),
          status:'scheduled',
          payload:entry,
          schemaVersion:SCHEMA_VERSION,
        });
      });
    };
    addSlotMap('retire',state.retire);
    addSlotMap('enroll',state.enroll);
    addSlotMap('hyuwon',state.hyuwon);
    addSlotMap('move',state.move);

    Object.entries(state.waitlist&&typeof state.waitlist==='object'?state.waitlist:{}).forEach(([instKey,list])=>{
      (Array.isArray(list)?list:[]).forEach((raw,index)=>{
        const entry=raw&&typeof raw==='object'?clone(raw):{n:text(raw)};
        const tabId=resolveEventTab(bundle,entry,issues,{instKey,eventType:'waitlist'});
        waitlistEntries.push({
          id:id('wait',`${tabId}|${instKey}|${index}|${text(entry.n||entry.name)}|${digits(entry.p||entry.phone)}`),
          tabId,
          courseType:entry.bangteuk===true?'bangteuk':'regular',
          instKey,
          personId:eventPersonId(entry),
          name:text(entry.n||entry.name),
          phone:digits(entry.p||entry.phone),
          memo:text(entry.m||entry.memo),
          requestedDate:text(entry.d||entry.date),
          teacherName:text(entry.teacher),
          order:index,
          payload:entry,
          schemaVersion:SCHEMA_VERSION,
        });
      });
    });
    const classMarks=convertLegacyMarks(bundle,context);
    const attendance=convertLegacyAttendance(bundle,{...context,classMarks});
    return {
      reservations:[...reservations.values()],
      waitlistEntries,
      classMarks,
      attendanceRecords:attendance.attendanceRecords,
      attendanceGuests:attendance.attendanceGuests,
    };
  }
  function convertLegacySchedule(input){
    const source=input||{};
    const branchId=text(source.branchId);
    const tabs=Array.isArray(source.tabs)?source.tabs:[];
    const studentsByTab=source.studentsByTab||{};
    const instByTab=source.instByTab||{};
    const people=new Map();
    const enrollments=new Map();
    const placements=new Map();
    const assignments=new Map();
    const occupiedPositions=new Map();
    const fallbackIdentities=new Map();
    const issues=[];
    const tabDocs=[];

    tabs.forEach((rawTab,index)=>{
      const tab=tabDocument(rawTab,index);
      if(tab.type==='snapshot') return;
      tabDocs.push(tab);
      const students=Array.isArray(studentsByTab[tab.id])?studentsByTab[tab.id]:[];
      students.forEach((student,index)=>{
        const person=personFromStudent(student);
        if(!person.id){
          issues.push({type:'missing-person-id',tabId:tab.id,index,slotKey:slotKeyFor(student)});
          return;
        }
        if(!text(student?.sid)&&!digits(student?.p||student?.phone)){
          if(!fallbackIdentities.has(person.id)) fallbackIdentities.set(person.id,[]);
          fallbackIdentities.get(person.id).push({
            tabId:tab.id,index,slotKey:slotKeyFor(student),name:person.name,age:person.age,gender:person.gender,
          });
        }
        const existingPerson=people.get(person.id);
        if(existingPerson&&profilesConflict(existingPerson,person)){
          issues.push({
            type:'person-profile-conflict',
            personId:person.id,
            current:clone(existingPerson),
            incoming:clone(person),
          });
        }
        people.set(person.id,mergePerson(existingPerson,person));
        const enrollment=enrollmentFromStudent(student,tab);
        const existingEnrollment=enrollments.get(enrollment.id);
        enrollments.set(enrollment.id,existingEnrollment?{
          ...existingEnrollment,
          paid:existingEnrollment.paid||enrollment.paid,
          newStudent:existingEnrollment.newStudent||enrollment.newStudent,
          reenroll:existingEnrollment.reenroll||enrollment.reenroll,
        }:enrollment);
        const placement=placementFromStudent(student,tab,index);
        const positionKey=`${tab.id}|${placement.slotKey}`;
        const occupying=occupiedPositions.get(positionKey);
        if(occupying&&occupying.personId!==placement.personId){
          issues.push({
            type:'slot-conflict',
            tabId:tab.id,
            slotKey:placement.slotKey,
            currentPersonId:occupying.personId,
            incomingPersonId:placement.personId,
          });
        }else{
          placements.set(placement.id,placement);
          occupiedPositions.set(positionKey,placement);
        }
      });
      const inst=instByTab[tab.id]||{};
      Object.entries(inst).forEach(([slotKey,teacher])=>{
        const teacherName=text(typeof teacher==='object'?(teacher.name||teacher.n):teacher);
        if(!teacherName) return;
        const assignment={
          id:assignmentIdFor(tab.id,slotKey),
          tabId:tab.id,
          courseType:tab.type,
          slotKey:text(slotKey),
          teacherName,
          source:clone(teacher),
          schemaVersion:SCHEMA_VERSION,
        };
        assignments.set(assignment.id,assignment);
      });
    });

    fallbackIdentities.forEach((occurrences,personId)=>{
      if(occurrences.length<2) return;
      issues.push({
        type:'ambiguous-fallback-identity',personId,
        message:'전화번호나 고유 ID가 없는 같은 이름 원생을 한 사람으로 확정할 수 없습니다.',
        occurrences:clone(occurrences),
      });
    });

    const stateConversion=convertLegacyState(source,issues,{
      placements:[...placements.values()],
      teacherAssignments:[...assignments.values()],
    });
    const snapshotConversion=convertLegacyAttendanceSnapshots(source);
    const calendarConversion=convertLegacyCalendar(source,{
      placements:[...placements.values()],
      teacherAssignments:[...assignments.values()],
    });
    const operationalConversion=convertLegacyOperational(source);
    const historyConversion=convertLegacyHistory(source,issues);

    return {
      schemaVersion:SCHEMA_VERSION,
      branchId,
      tabs:tabDocs,
      people:[...people.values()],
      enrollments:[...enrollments.values()],
      placements:[...placements.values()],
      teacherAssignments:[...assignments.values()],
      reservations:stateConversion.reservations,
      waitlistEntries:stateConversion.waitlistEntries,
      classMarks:stateConversion.classMarks,
      attendanceRecords:stateConversion.attendanceRecords,
      attendanceGuests:stateConversion.attendanceGuests,
      attendanceSnapshots:snapshotConversion.attendanceSnapshots,
      attendanceSnapshotStudents:snapshotConversion.attendanceSnapshotStudents,
      attendanceSnapshotTeachers:snapshotConversion.attendanceSnapshotTeachers,
      disabledSlots:calendarConversion.disabledSlots,
      calendarClosures:calendarConversion.calendarClosures,
      schedulePeriods:calendarConversion.schedulePeriods,
      scheduleSettings:calendarConversion.scheduleSettings,
      teacherProfiles:operationalConversion.teacherProfiles,
      tabFolders:operationalConversion.tabFolders,
      archivedTabs:operationalConversion.archivedTabs,
      systemMetadata:operationalConversion.systemMetadata,
      retirementRecords:historyConversion.retirementRecords,
      deskStudentRecords:historyConversion.deskStudentRecords,
      issues,
      stats:{
        tabs:tabDocs.length,
        people:people.size,
        enrollments:enrollments.size,
        placements:placements.size,
        teacherAssignments:assignments.size,
        reservations:stateConversion.reservations.length,
        waitlistEntries:stateConversion.waitlistEntries.length,
        classMarks:stateConversion.classMarks.length,
        attendanceRecords:stateConversion.attendanceRecords.length,
        attendanceGuests:stateConversion.attendanceGuests.length,
        attendanceSnapshots:snapshotConversion.attendanceSnapshots.length,
        attendanceSnapshotStudents:snapshotConversion.attendanceSnapshotStudents.length,
        attendanceSnapshotTeachers:snapshotConversion.attendanceSnapshotTeachers.length,
        disabledSlots:calendarConversion.disabledSlots.length,
        calendarClosures:calendarConversion.calendarClosures.length,
        schedulePeriods:calendarConversion.schedulePeriods.length,
        scheduleSettings:calendarConversion.scheduleSettings.length,
        teacherProfiles:operationalConversion.teacherProfiles.length,
        tabFolders:operationalConversion.tabFolders.length,
        archivedTabs:operationalConversion.archivedTabs.length,
        systemMetadata:operationalConversion.systemMetadata.length,
        retirementRecords:historyConversion.retirementRecords.length,
        deskStudentRecords:historyConversion.deskStudentRecords.length,
        issues:issues.length,
      },
    };
  }

  global.SCScheduleSchemaV2=Object.freeze({
    SCHEMA_VERSION,
    stableHash,
    personIdFor,
    enrollmentIdFor,
    placementIdFor,
    assignmentIdFor,
    slotKeyFor,
    courseTypeForTab,
    personFromStudent,
    enrollmentFromStudent,
    placementFromStudent,
    legacyTabKeys,
    legacyBundleFromRoot,
    identityProfileKey,
    legacyIdentityConflicts,
    diagnoseLegacyRoot,
    convertLegacySchedule,
  });
})(typeof window!=='undefined'?window:globalThis);
