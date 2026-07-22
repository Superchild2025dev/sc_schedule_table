(function(){
  const SETTINGS_KEY='swim_aligo_settings';
  const TEACHERS_KEY='swim_teachers';
  const FEEDBACK_KEY='swim_parent_feedback';
  const TAB_LIST_KEY='swim_tab_list';
  const MAIN_TAB_KEY='swim_main_tab';
  const STUDENTS_KEY='swim_students';
  const INST_KEY='swim_inst';
  const ENROLL_KEY='swim_enroll';
  const RETIRE_KEY='swim_retire';
  const DISABLED_KEY='swim_disabled';
  const MARK_KEY='swim_mark';
  const HYUWON_KEY='swim_hyuwon';
  const MOVE_KEY='swim_move';
  const REQUESTS_KEY='swim_requests';
  const PUBLIC_BASE_URL='https://schedule.adminsuperchild.cloud';
  const REG_BASE={
    days:['월','화','수','목','금','토'],
    times:['1시','2시','3시','4시','5시','6시','7시','8시'],
    lanes:5,
  };
  const BT_BASE={
    days:['월수금','화목'],
    times:['9시','10시','11시'],
    lanes:5,
  };
  const BRANCHES={
    gagyeong:{id:'gagyeong',name:'가경점',fbPath:'schedule',aligoBranch:'가경동'},
    yongam:{id:'yongam',name:'용암점',fbPath:'schedule_yongam',aligoBranch:'용암점'},
  };
  const DEFAULT_TEACHERS={
    gagyeong:['손용곤','박형진','이수성','김재용','김민승','유정희'],
    yongam:['이수재','정연재','김성현','김은영','김지수','이시종'],
  };
  const FIXED_RECIPIENTS=[
    {key:'desk',label:'슈퍼차일드 데스크',memo:'데스크 공용 알림'},
    {key:'bus1',label:'차량 1호차',memo:'차량/승하차 알림'},
    {key:'bus2',label:'차량 2호차',memo:'차량/승하차 알림'},
    {key:'bus3',label:'차량 3호차',memo:'차량/승하차 알림'},
  ];
  const TEMPLATE_DEFS=[
    {id:'parent_absent_done',title:'학부모 - 결석완료',target:'학부모',subtitle:'슈퍼차일드 #{지점명}',main:'#{학생명} 어린이 결석처리 완료입니다.',body:'[슈퍼차일드 #{지점명}]\n#{학생명} 어린이 #{수업일} #{요일} #{수업시간} #{담당선생님} 선생님 수업\n\n*결석처리 완료입니다.\n\n*결석 취소 시 꼭 요청이나 문의를 남겨주세요.',buttonName:'보강 신청 바로가기',link:'https://schedule.adminsuperchild.cloud/parent.html'},
    {id:'parent_makeup_rejected',title:'학부모 - 보강거절 / 보류',target:'학부모',subtitle:'슈퍼차일드 #{지점명}',main:'보강신청이 보류되었습니다.',body:'[슈퍼차일드 #{지점명}]\n*#{학생명} 어린이 보강요청이 일정 조정이 필요하여 보류되었습니다.\n\n*보류사유 : #{보류사유}',buttonName:'다른 일정 선택하기',link:'https://schedule.adminsuperchild.cloud/parent.html'},
    {id:'parent_absent_cancel_requested',title:'학부모 - 결석 취소 요청 완료',target:'학부모',subtitle:'슈퍼차일드 #{지점명}',main:'#{학생명} 결석취소 요청 접수',body:'#{학생명} 어린이 #{수업일} #{요일} #{수업시간} #{담당선생님} 선생님 수업\n\n\n\n결석 취소 요청을 접수하였습니다.\n\n\n\n취소 확정 시 알림톡이 전송됩니다.',buttonName:'',link:''},
    {id:'parent_absent_cancel',title:'학부모 - 결석취소',target:'학부모',subtitle:'슈퍼차일드 #{지점명}',main:'#{학생명} 어린이 결석취소 완료',body:'[슈퍼차일드 #{지점명}]\n#{학생명} 어린이 #{수업일} #{요일} #{수업시간} #{담당선생님} 선생님 수업\n\n*결석 요청이 취소되었습니다.',buttonName:'결석/보강 조회하기',link:'https://schedule.adminsuperchild.cloud/parent.html'},
    {id:'parent_makeup_pending',title:'학부모 - 보강접수',target:'학부모',subtitle:'슈퍼차일드 #{지점명}',main:'#{학생명} 어린이 보강 대기 상태입니다.',body:'[슈퍼차일드 #{지점명}]\n#{학생명} 어린이\n\n*보강 접수 대기 상태입니다.\n*선생님이 보강 요청을 확인 후 확정 도와드리겠습니다.\n*확정/보류 처리 시 알림톡이 발송됩니다.',buttonName:'보강 조회하기',link:'https://schedule.adminsuperchild.cloud/parent.html'},
    {id:'parent_makeup_cancelled',title:'학부모 - 보강취소',target:'학부모',subtitle:'슈퍼차일드 #{지점명}',main:'#{학생명} 어린이 보강 취소 완료입니다.',body:'[슈퍼차일드 #{지점명}]\n*#{학생명} 어린이\n*보강요청이 취소되었습니다.',buttonName:'결석/보강 조회하기',link:'https://schedule.adminsuperchild.cloud/parent.html'},
    {id:'parent_makeup_accepted',title:'학부모 - 보강완료',target:'학부모',subtitle:'슈퍼차일드 #{지점명}',main:'#{학생명} 어린이 보강수업이 확정되었습니다.',body:'[슈퍼차일드 #{지점명}]\n#{학생명} 어린이 #{수업일} #{요일} #{수업시간} #{담당선생님} 선생님 수업\n\n*보강수업이 확정되었습니다.\n\n보강수업 결석 시 자동 소진됩니다.\n수업시간 10분 전 방문 부탁드립니다.',buttonName:'결석/보강 조회하기',link:'https://schedule.adminsuperchild.cloud/parent.html'},
    {id:'staff_absent_done',title:'선생님, 데스크 - 결석완료',target:'선생님/데스크',subtitle:'슈퍼차일드 #{지점명}',main:'#{학생명} 결석 신청 접수',body:'[슈퍼차일드 #{지점명}]\n*#{학생명} 어린이\n*#{수업일} #{요일} #{수업시간} #{담당선생님} 선생님 수업\n*결석입니다.',buttonName:'',link:''},
    {id:'desk_absent_cancel_requested',title:'데스크 - 결석 취소 요청',target:'데스크',subtitle:'슈퍼차일드 #{지점명}',main:'#{학생명} 결석취소 요청 접수',body:'#{학생명} 어린이 #{수업일} #{요일} #{수업시간} #{담당선생님} 선생님 수업\n\n\n\n결석 취소 요청이 접수되었습니다. 확인해주세요.',buttonName:'',link:''},
    {id:'staff_absent_cancel',title:'선생님, 데스크 - 결석취소',target:'선생님/데스크',subtitle:'슈퍼차일드 #{지점명}',main:'#{학생명} 결석 취소',body:'[슈퍼차일드 #{지점명}]\n*#{학생명} 어린이\n*#{수업일} #{요일} #{수업시간} #{담당선생님} 선생님 수업\n*결석 요청이 취소되었습니다.',buttonName:'',link:''},
    {id:'teacher_makeup_pending',title:'선생님 - 보강접수',target:'선생님',subtitle:'슈퍼차일드 #{지점명}',main:'#{학생명} 보강대기 접수',body:'[슈퍼차일드 #{지점명}]\n*#{학생명} 어린이\n*보강 요청이 접수되었습니다.\n\n확인 후 등록해주세요.',buttonName:'조회',link:'https://schedule.adminsuperchild.cloud/teacher.html'},
    {id:'teacher_makeup_cancelled',title:'선생님 - 보강취소',target:'선생님',subtitle:'슈퍼차일드 #{지점명}',main:'#{학생명} 보강취소',body:'[슈퍼차일드 #{지점명}]\n*#{학생명} 어린이\n*#{수업일} #{요일} #{수업시간} #{담당선생님} 선생님 수업\n*보강수업이 취소되었습니다.',buttonName:'',link:''},
    {id:'vehicle_absent',title:'차량 - 결석',target:'차량',subtitle:'슈퍼차일드 #{지점명}',main:'#{차량명} #{학생명} 결석',body:'[슈퍼차일드 #{지점명}]\n#{차량명} #{요일} #{차량시간} #{학생명} #{수업일} 결석\n*차량이용 없습니다.',buttonName:'',link:''},
    {id:'vehicle_absent_cancel',title:'차량 - 결석취소',target:'차량',subtitle:'슈퍼차일드 #{지점명}',main:'#{차량명} #{학생명} 결석취소',body:'[슈퍼차일드 #{지점명}]\n#{차량명} #{차량시간} #{학생명} #{수업일} #{요일} 결석취소\n*#{학생명} 정상등원, 차량이용 합니다.',buttonName:'',link:''},
  ];
  const VARIABLE_GUIDE=[
    {name:'#{지점명}',label:'지점명',sample:'가경점'},
    {name:'#{학생명}',label:'원생 이름',sample:'홍길동'},
    {name:'#{수업일}',label:'수업/결석 날짜',sample:'5월21일'},
    {name:'#{요일}',label:'요일',sample:'화요일'},
    {name:'#{수업시간}',label:'수업 시간',sample:'7시'},
    {name:'#{담당선생님}',label:'담당 선생님',sample:'김슈차'},
    {name:'#{보류사유}',label:'보류/거절 사유',sample:'일정 조정 필요'},
    {name:'#{차량명}',label:'차량명',sample:'1호차'},
    {name:'#{차량시간}',label:'차량 시간',sample:'7시'},
  ];
  const PANEL_META={
    menu:{title:'운영 도구',section:'운영'},
    feedback:{title:'의견접수',section:'운영'},
    students:{title:'원생목록',section:'원생'},
    recipients:{title:'수신번호',section:'메시지'},
    templates:{title:'알림톡 템플릿',section:'메시지'},
    aligo:{title:'알림톡 연결',section:'메시지'},
    sms:{title:'문자 연결',section:'메시지'},
    backup:{title:'백업 관리',section:'시스템'},
  };

  let activeBranch='gagyeong';
  let activePanel='menu';
  let settingsByBranch={};
  let teacherNamesByBranch={};
  let feedbackByBranch={};
  let rootByBranch={};
  let settingsLoadFailedByBranch={};
  let studentDirectoryByBranch={};
  let studentDirectoryLoadingByBranch={};
  let summerLayoutState=null;

  function $(id){return document.getElementById(id);}
  function clone(obj){return JSON.parse(JSON.stringify(obj));}
  function toast(msg,type){
    const el=$('settings-toast');
    if(!el) return;
    el.textContent=msg;
    el.className='settings-toast show '+(type||'');
    clearTimeout(toast._t);
    toast._t=setTimeout(()=>{el.classList.remove('show');},2200);
  }
  function productionUrl(path){
    return PUBLIC_BASE_URL.replace(/\/$/,'')+'/'+String(path||'').replace(/^\//,'');
  }
  function aligoBranchValue(branchId){
    const branch=BRANCHES[branchId]||BRANCHES.gagyeong;
    return branch.aligoBranch||branch.name;
  }
  function defaultRecipients(){
    const fixed={};
    FIXED_RECIPIENTS.forEach(item=>{
      fixed[item.key]={label:item.label,phone:'',enabled:true,memo:item.memo};
    });
    return {teachers:{},fixed};
  }
  function defaultTestVars(branchId){
    const branch=BRANCHES[branchId]||BRANCHES.gagyeong;
    return [
      `지점명=${branch.name}`,
      '학생명=홍길동',
      '수업일=5월21일',
      '요일=화요일',
      '수업시간=7시',
      '담당선생님=김슈차',
      '보류사유=일정 조정 필요',
      '차량명=1호차',
      '차량시간=7시',
    ].join('\n');
  }
  function defaultTemplates(branchId){
    const branch=BRANCHES[branchId]||BRANCHES.gagyeong;
    return TEMPLATE_DEFS.reduce((acc,item)=>{
      acc[item.id]=Object.assign({},item,{
        enabled:true,
        code:'',
        subtitle:String(item.subtitle||'').replace('#{지점명}',branch.name),
        link:item.link ? item.link + (item.link.includes('?')?'&':'?') + 'branch=' + branch.id : '',
      });
      return acc;
    },{});
  }
  function defaultSettings(branchId){
    const branch=BRANCHES[branchId]||BRANCHES.gagyeong;
    return {
      branchId:branch.id,
      branchName:branch.name,
      pages:{
        parent:productionUrl('parent.html?branch='+branch.id),
        teacher:productionUrl('teacher.html?branch='+branch.id),
      },
      recipients:defaultRecipients(),
      templates:defaultTemplates(branch.id),
      aligo:{
        enabled:false,
        testMode:true,
        proxyUrl:'/aligo',
        senderKey:'',
        sender:'',
        remainPath:'/remain/',
        sendPath:'/alimtalk/send/',
        templateCode:'',
        testTemplateId:'',
        testReceiver:'',
        testRecvName:'',
        testSubject:'',
        testMessage:'',
        testButtonName:'',
        testLinkM:'',
        testLinkP:'',
        testLink:'',
        testVars:defaultTestVars(branch.id),
      },
      sms:{
        enabled:false,
        fallback:true,
        proxyUrl:'/aligo',
        userid:'',
        apiKeyEnv:'ALIGO_KEY',
        sender:'',
        sendPath:'/send/',
        remainPath:'/remain/',
        targets:{parent:true,teacher:true,desk:true},
      },
      updatedAt:'',
      updatedBy:'',
    };
  }
  function mergeRecipients(base,saved){
    const out=clone(base);
    saved=saved&&typeof saved==='object'?saved:{};
    out.teachers=Object.assign({},base.teachers,saved.teachers||{});
    out.fixed=Object.assign({},base.fixed,saved.fixed||{});
    FIXED_RECIPIENTS.forEach(item=>{
      out.fixed[item.key]=Object.assign({},base.fixed[item.key],out.fixed[item.key]||{},{
        label:item.label,
        memo:item.memo,
      });
    });
    return out;
  }
  function mergeSettings(base, saved){
    const out=clone(base);
    saved=saved&&typeof saved==='object'?saved:{};
    Object.assign(out,saved);
    out.pages=Object.assign({},base.pages,saved.pages||{});
    out.recipients=mergeRecipients(base.recipients,saved.recipients||{});
    out.templates=mergeTemplates(base.templates,saved.templates||{});
    out.aligo=Object.assign({},base.aligo,saved.aligo||{});
    out.sms=Object.assign({},base.sms,saved.sms||{});
    out.sms.targets=Object.assign({},base.sms.targets,(saved.sms||{}).targets||{});
    if(out.aligo.remainPath==='/akv10/heartinfo/') out.aligo.remainPath=base.aligo.remainPath;
    delete out.aligo.templates;
    delete out.sms.templates;
    return out;
  }
  function mergeTemplates(base,saved){
    const out=clone(base||{});
    saved=saved&&typeof saved==='object'?saved:{};
    TEMPLATE_DEFS.forEach(item=>{
      out[item.id]=Object.assign({},out[item.id]||item,saved[item.id]||{},{
        id:item.id,
        title:item.title,
        target:item.target,
      });
    });
    Object.keys(saved).forEach(id=>{
      if(!out[id]) out[id]=saved[id];
    });
    return out;
  }
  function parseStored(v){
    if(!v) return null;
    if(typeof v==='string'){
      try{return JSON.parse(v);}catch(e){return null;}
    }
    return v;
  }
  function normalizeFeedbackList(value){
    if(!Array.isArray(value)) return [];
    return value.filter(Boolean).map((item,index)=>Object.assign({
      id:'feedback_'+index,
      at:'',
      context:'의견 제출',
      message:'',
      name:'',
      phone:'',
      status:'new',
    },item)).sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')));
  }
  function feedbackList(branchId){
    return feedbackByBranch[branchId]||[];
  }
  function isNewFeedback(item){
    return String(item&&item.status||'new')!=='done';
  }
  function feedbackNewCount(branchId){
    return feedbackList(branchId).filter(isNewFeedback).length;
  }
  function formatFeedbackDate(iso){
    if(!iso) return '-';
    const date=new Date(iso);
    if(Number.isNaN(date.getTime())) return String(iso);
    return date.toLocaleString('ko-KR',{
      month:'2-digit',
      day:'2-digit',
      hour:'2-digit',
      minute:'2-digit',
      hour12:false,
    });
  }
  function updateFeedbackBadges(){
    const count=feedbackNewCount(activeBranch);
    ['feedback-nav-badge','feedback-quick-badge'].forEach(id=>{
      const el=$(id);
      if(!el) return;
      el.textContent=String(count);
      el.hidden=count<=0;
    });
  }
  function ensureFirebase(){
    if(!window.firebase) throw new Error('Firebase SDK가 로드되지 않았습니다');
    if(!firebase.apps.length) firebase.initializeApp(window.SC_FIREBASE_CONFIG);
    return firebase.app();
  }
  function branchRoot(branchId){
    if(rootByBranch[branchId]) return rootByBranch[branchId];
    ensureFirebase();
    const branch=BRANCHES[branchId]||BRANCHES.gagyeong;
    rootByBranch[branchId]=window.SCFirebaseStore
      ? SCFirebaseStore.createBranchRef(branch)
      : firebase.database().ref(branch.fbPath);
    return rootByBranch[branchId];
  }
  function backupDeferredKey(key){
    key=String(key||'');
    return key==='swim_audit_log'
      || key==='swim_restore_points'
      || key==='zz_swim_audit_index'
      || key==='zz_swim_restore_index'
      || key==='zz_swim_student_delete_index'
      || key==='swim_day_snapshot'
      || key.startsWith('swim_restore_point_')
      || key.startsWith('swim_bt_day_snapshot_')
      || key.startsWith('zz_swim_day_snapshot__')
      || key.startsWith('zz_swim_audit_entry__')
      || key.startsWith('zz_swim_restore_point__')
      || key.startsWith('zz_swim_student_delete__');
  }
  function backupStatus(message,type){
    const el=$('backup-status');
    if(!el) return;
    el.textContent=message;
    el.className='backup-status '+(type||'');
  }
  async function readBranchBackupData(branchId,includeHistory){
    const root=branchRoot(branchId);
    let data={};
    if(root && typeof root._list==='function'){
      data=await root._list({includeDeferred:!!includeHistory});
    }else{
      const snap=await root.once('value');
      data=snap.val()||{};
    }
    if(!includeHistory){
      const filtered={};
      Object.entries(data||{}).forEach(([key,value])=>{
        if(!backupDeferredKey(key)) filtered[key]=value;
      });
      return filtered;
    }
    return data||{};
  }
  function studentRootValue(root,key,fallback){
    const parsed=parseStored(root&&root[key]);
    return parsed===null||parsed===undefined ? fallback : parsed;
  }
  function normalizeStudentTabs(rawTabs){
    const tabs=Array.isArray(rawTabs)&&rawTabs.length ? rawTabs : [{id:'regular',name:'정규시간표',type:'regular'}];
    return tabs
      .filter(tab=>tab&&tab.type!=='snapshot')
      .map(tab=>Object.assign({id:'regular',name:'정규시간표',type:'regular'},tab));
  }
  function currentIsoDate(){
    const d=new Date();
    const p=n=>String(n).padStart(2,'0');
    return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
  }
  function selectStudentDirectoryTabs(rawTabs,mainSetting){
    const tabs=normalizeStudentTabs(rawTabs);
    const main=mainSetting&&typeof mainSetting==='object'?mainSetting:{};
    const regularTabs=tabs.filter(tab=>!tab.type||tab.type==='regular');
    const regularMain=regularTabs.find(tab=>tab.id===main.tabId)
      || regularTabs.find(tab=>tab.id==='regular')
      || regularTabs[0]
      || null;
    const selected=[];
    if(regularMain) selected.push(regularMain);
    const today=currentIsoDate();
    let hasBangteuk=false;
    tabs.filter(tab=>tab.type==='bangteuk').forEach(tab=>{
      const isMainBangteuk=main.tabId&&tab.id===main.tabId;
      const inSeason=tab.seasonStart&&tab.seasonEnd&&tab.seasonStart<=today&&tab.seasonEnd>=today;
      if((isMainBangteuk||inSeason)&&!selected.some(item=>item.id===tab.id)){
        selected.push(tab);
        hasBangteuk=true;
      }
    });
    if(!hasBangteuk){
      const fallbackBangteuk=tabs
        .filter(tab=>tab.type==='bangteuk')
        .sort((a,b)=>String(b.seasonStart||'').localeCompare(String(a.seasonStart||''))||String(b.id||'').localeCompare(String(a.id||'')))[0];
      if(fallbackBangteuk&&!selected.some(item=>item.id===fallbackBangteuk.id)) selected.push(fallbackBangteuk);
    }
    return selected.length?selected:(regularMain?[regularMain]:tabs.slice(0,1));
  }
  function studentTabConfig(tab){
    const id=tab&&tab.id||'regular';
    if(tab&&tab.type==='bangteuk'){
      return Object.assign({},BT_BASE,{
        tabId:id,
        tabName:tab.name||'방특 시간표',
        stuKey:'swim_bt_'+id+'_stu',
        instKey:'swim_bt_'+id+'_inst',
      });
    }
    const isDefault=id==='regular';
    return Object.assign({},REG_BASE,{
      tabId:id,
      tabName:(tab&&tab.name)||'정규시간표',
      stuKey:isDefault?STUDENTS_KEY:'swim_stu_'+id,
      instKey:isDefault?INST_KEY:'swim_inst_'+id,
    });
  }
  function studentInstExists(inst){
    if(!inst) return false;
    if(typeof inst==='string') return !!inst.trim();
    return !!String(inst.n||'').trim();
  }
  function studentInstClass(inst){
    if(!inst) return '';
    if(inst.cls==='elma'||inst.cls==='elite'||inst.cls==='master') return inst.cls;
    if(inst.elma) return 'elma';
    return '';
  }
  function studentRowsForInst(tab,inst){
    if(window.SCScheduleTime&&typeof window.SCScheduleTime.slotRowsForInst==='function') return window.SCScheduleTime.slotRowsForInst(inst,{bangteukTable:tab&&tab.type==='bangteuk'});
    return tab&&tab.type==='bangteuk' ? 6 : (studentInstClass(inst)?8:5);
  }
  function studentIsBangteukInst(inst){
    if(window.SCScheduleTime&&typeof window.SCScheduleTime.isBangteukInst==='function') return window.SCScheduleTime.isBangteukInst(inst);
    return !!(inst&&typeof inst==='object'&&(inst.bt||inst.bangteuk||inst.btGroup||inst.btTabId||inst.cls==='bt'||inst.cls==='bangteuk'));
  }
  function studentIsBangteukGroupDay(day){
    const text=String(day||'').replace(/[\/\s]/g,'');
    return text==='월수금'||text==='화목';
  }
  function studentIsBangteukSlot(ctx,slotKey){
    const p=String(slotKey||'').split('/');
    if(p.length<4||!ctx) return false;
    if(studentIsBangteukGroupDay(p[1])) return true;
    const inst=ctx.instMap&&ctx.instMap[p.slice(0,3).join('/')];
    if(window.SCScheduleTime&&typeof window.SCScheduleTime.isBangteukSlot==='function') return window.SCScheduleTime.isBangteukSlot(inst,p[3],{bangteukTable:ctx.tab&&ctx.tab.type==='bangteuk'});
    return studentIsBangteukInst(inst)&&parseInt(p[3],10)>=1&&parseInt(p[3],10)<=6;
  }
  function shortDate(ds){
    if(!ds) return '';
    const p=String(ds).slice(5).split('-');
    const m=parseInt(p[0],10), d=parseInt(p[1],10);
    if(!m||!d) return String(ds);
    return m+'/'+d;
  }
  function displayPhone(value){
    const d=normalizePhone(value);
    if(d.length===11) return d.slice(0,3)+'-'+d.slice(3,7)+'-'+d.slice(7);
    if(d.length===10) return d.slice(0,3)+'-'+d.slice(3,6)+'-'+d.slice(6);
    return String(value||'');
  }
  function studentPersonKey(stu){
    const name=String(stu&&(stu.n||stu.name)||'').trim();
    if(!name) return '';
    return name+'|'+normalizePhone(stu.p||stu.phone||stu.tel||'');
  }
  function studentPhoneGroupKey(stu){
    const personKey=studentPersonKey(stu);
    if(personKey) return 'person:'+personKey;
    const phone=normalizePhone(stu&&stu.p||stu&&stu.phone||stu&&stu.tel||'');
    if(phone) return 'phone:'+phone;
    const name=String(stu&&(stu.n||stu.name)||'').trim();
    return name ? 'no-phone:'+name : '';
  }
  function studentSlotKey(stu){
    return String(stu&&stu.t||'')+'/'+String(stu&&stu.d||'')+'/'+String(stu&&stu.l||'')+'/'+String(stu&&stu.r||'');
  }
  function studentTeacherName(inst){
    if(!inst) return '';
    if(typeof inst==='string') return inst.replace(/^[\d\)]+\s*/,'').replace(/\(유아\)/g,'').replace(/\(엘\/마\)/g,'').trim();
    return String(inst.n||'').trim();
  }
  function studentSlotInfo(slotKey,dateLabel,teacherName){
    const p=String(slotKey||'').split('/');
    const day=p[1]||'';
    let time=p[0]||'';
    try{
      if(window.SCScheduleTime&&typeof window.SCScheduleTime.displayTimeForDay==='function') time=window.SCScheduleTime.displayTimeForDay(day,time)||time;
    }catch(e){}
    const hour=String(time||p[0]||'').replace(/[^\d]/g,'')||String(time||p[0]||'');
    const badge=day&&hour ? day+hour : (p.length>=4 ? `${p[1]} ${p[0]}` : String(slotKey||''));
    const teacher=String(teacherName||'').trim();
    const date=String(dateLabel||'').trim();
    const text=[badge,teacher?teacher+' 선생님':'',date].filter(Boolean).join(' ');
    return {
      key:[slotKey,date,teacher].join('|'),
      slotKey,
      badge,
      teacher,
      date,
      text,
    };
  }
  function studentIsMoveEntry(entry){
    return !!(entry&&typeof entry==='object'&&entry.moveType==='reserve'&&entry.moveId&&entry.pairKey);
  }
  function studentRecordPerson(entry,fallback){
    const source=entry&&typeof entry==='object'?entry:{};
    const fb=fallback||{};
    const srcName=String(source.n||source.name||'').trim();
    const fbName=String(fb.n||fb.name||'').trim();
    const srcAge=String(source.a||source.age||'').trim();
    const fbAge=String(fb.a||fb.age||'').trim();
    const srcPhone=source.p||source.phone||source.tel||'';
    const fbPhone=fb.p||fb.phone||fb.tel||'';
    const legacyJoined=!!(srcName&&fbName&&fbAge&&srcName===fbName+fbAge);
    const preferFallback=!!(fbName&&(legacyJoined||(!normalizePhone(srcPhone)&&normalizePhone(fbPhone))));
    return {
      n:(preferFallback?fbName:srcName)||fbName,
      p:srcPhone||fbPhone,
      a:srcAge||fbAge,
    };
  }
  function studentRetireStatus(entry,isChange){
    return isChange||studentIsMoveEntry(entry) ? '제외예정' : '퇴원예정';
  }
  function studentEnrollStatus(entry){
    return '등록예정';
  }
  function studentPairFallback(entry,pairMap){
    if(!studentIsMoveEntry(entry)) return null;
    const pair=pairMap&&pairMap[entry.pairKey];
    if(!pair||typeof pair!=='object') return null;
    const person=studentRecordPerson(pair,entry);
    return {
      n:person.n,
      name:person.n,
      a:person.a,
      age:person.a,
      p:person.p,
      phone:person.p,
      tel:person.p,
    };
  }
  function studentStatusKey(status){
    if(status==='재원') return 'current';
    if(status==='등록예정') return 'enroll';
    if(status==='방특') return 'bangteuk';
    if(status==='제외예정') return 'exclude';
    if(status==='이동예정') return 'move';
    if(status==='숨김후보') return 'hidden';
    return 'retire';
  }
  function studentRecord(entry,status,tab,slotKey,dateLabel,fallback,teacherName,source){
    const person=studentRecordPerson(entry,fallback);
    const statusKey=studentStatusKey(status);
    return {
      n:person.n,
      a:person.a,
      p:person.p,
      status,
      statusKey,
      counted:statusKey==='current'||statusKey==='enroll',
      tabId:tab&&tab.id||'reservation',
      tabName:tab&&tab.name||'예약',
      slot:studentSlotInfo(slotKey,dateLabel,teacherName),
      source:source||null,
    };
  }
  function studentGroupName(record){
    return String(record&&(record.n||record.name)||'').trim();
  }
  function studentGroupPhone(record){
    return normalizePhone(record&&record.p||record&&record.phone||record&&record.tel||'');
  }
  function rewriteStudentGroupPersonKey(row,oldPersonKey,newPersonKey){
    if(!row||!oldPersonKey||!newPersonKey||oldPersonKey===newPersonKey) return;
    ['countedPeople','retirePeople','movePeople','bangteukPeople'].forEach(prop=>{
      const set=row[prop];
      if(set&&set.has(oldPersonKey)){
        set.delete(oldPersonKey);
        set.add(newPersonKey);
      }
    });
    const nextMembers=new Map();
    (row.members||new Map()).forEach((member,key)=>{
      const nextKey=String(key).startsWith(oldPersonKey+'|')
        ? newPersonKey+String(key).slice(oldPersonKey.length)
        : key;
      if(!nextMembers.has(nextKey)){
        nextMembers.set(nextKey,member);
        return;
      }
      const target=nextMembers.get(nextKey);
      if(!target.a&&member.a) target.a=member.a;
      (member.dates||new Set()).forEach(v=>target.dates.add(v));
      (member.slots||[]).forEach(slot=>{
        if(!target.slots.some(saved=>saved.key===slot.key)) target.slots.push(slot);
      });
    });
    row.members=nextMembers;
  }
  function mergeStudentGroups(map,fromKey,toKey){
    if(!fromKey||!toKey||fromKey===toKey||!map.has(fromKey)) return;
    const from=map.get(fromKey);
    const fromPerson=fromKey.startsWith('person:')?fromKey.slice('person:'.length):'';
    const toPerson=toKey.startsWith('person:')?toKey.slice('person:'.length):'';
    rewriteStudentGroupPersonKey(from,fromPerson,toPerson);
    if(!map.has(toKey)){
      from.key=toKey;
      map.delete(fromKey);
      map.set(toKey,from);
      return;
    }
    const to=map.get(toKey);
    if(!to.p&&from.p) to.p=from.p;
    ['countedPeople','retirePeople','movePeople','bangteukPeople','statusKeys','tabs'].forEach(prop=>{
      (from[prop]||new Set()).forEach(v=>to[prop].add(v));
    });
    (from.members||new Map()).forEach((member,key)=>{
      if(!to.members.has(key)){
        to.members.set(key,member);
        return;
      }
      const target=to.members.get(key);
      if(!target.a&&member.a) target.a=member.a;
      (member.dates||new Set()).forEach(v=>target.dates.add(v));
      (member.slots||[]).forEach(slot=>{
        if(!target.slots.some(saved=>saved.key===slot.key)) target.slots.push(slot);
      });
    });
    map.delete(fromKey);
  }
  function studentExistingPhoneGroupKey(map,name){
    if(!name) return '';
    const prefix='person:'+name+'|';
    const matches=[...map.keys()].filter(key=>key.startsWith(prefix)&&key!==prefix);
    return matches.length===1 ? matches[0] : '';
  }
  function addStudentGroup(map,record){
    const name=studentGroupName(record);
    const phone=studentGroupPhone(record);
    let key=studentPhoneGroupKey(record);
    if(!key) return;
    const noPhoneKey=name?'person:'+name+'|':'';
    if(name&&phone){
      mergeStudentGroups(map,noPhoneKey,key);
    }else if(name&&!phone){
      const existingPhoneKey=studentExistingPhoneGroupKey(map,name);
      if(existingPhoneKey) key=existingPhoneKey;
    }
    if(!map.has(key)){
      map.set(key,{
        key,
        p:displayPhone(record.p),
        countedPeople:new Set(),
        retirePeople:new Set(),
        movePeople:new Set(),
        bangteukPeople:new Set(),
        statusKeys:new Set(),
        tabs:new Set(),
        members:new Map(),
        phoneTargets:new Map(),
      });
    }
    const row=map.get(key);
    if(record.p&&!row.p) row.p=displayPhone(record.p);
    if(!studentGroupPhone(record)&&record.source&&(record.statusKey==='current'||record.statusKey==='enroll')){
      const targetKey=[record.source.kind,record.source.key,record.source.slotKey].join('|');
      row.phoneTargets.set(targetKey,Object.assign({},record.source,{
        name,
        age:record.a||record.age||'',
        tabName:record.tabName||'',
        label:(record.slot&&record.slot.text)||'',
      }));
    }
    const personKey=(name&&key.startsWith('person:')) ? key.slice('person:'.length) : studentPersonKey(record);
    if(personKey){
      if(record.counted) row.countedPeople.add(personKey);
      if(record.statusKey==='retire') row.retirePeople.add(personKey);
      if(record.statusKey==='exclude'||record.statusKey==='move') row.movePeople.add(personKey);
      if(record.statusKey==='bangteuk') row.bangteukPeople.add(personKey);
    }
    row.statusKeys.add(record.statusKey);
    if(record.tabId) row.tabs.add(record.tabId+'|'+record.tabName);

    const memberKey=(personKey||record.n)+'|'+record.statusKey+(record.statusKey==='move'?'':'|'+record.counted);
    if(!row.members.has(memberKey)){
      row.members.set(memberKey,{
        n:record.n||'',
        a:record.a||'',
        status:record.status,
        statusKey:record.statusKey,
        counted:record.counted,
        dates:new Set(),
        slots:[],
      });
    }
    const member=row.members.get(memberKey);
    if(!member.a&&record.a) member.a=record.a;
    if(record.slot&&record.slot.date) member.dates.add(record.slot.date);
    if(record.slot&&record.slot.text&&!member.slots.some(slot=>slot.key===record.slot.key)) member.slots.push(record.slot);
  }
  function studentEntryPersonKey(entry,fallback){
    const person=studentRecordPerson(entry,fallback);
    return studentPersonKey(person);
  }
  function studentEntryMatchesPerson(entry,fallback,target){
    const a=studentRecordPerson(entry,fallback);
    const b=studentRecordPerson(target,null);
    const aName=String(a.n||'').trim();
    const bName=String(b.n||'').trim();
    if(aName&&bName&&aName!==bName) return false;
    const aPhone=normalizePhone(a.p);
    const bPhone=normalizePhone(b.p);
    if(aPhone&&bPhone&&aPhone!==bPhone) return false;
    return !!(aName||bName);
  }
  function studentIsTemporaryOnly(entry){
    if(!entry||typeof entry!=='object') return false;
    if(entry.bogangOnly||entry.makeupOnly||entry.sampleOnly) return true;
    const kind=String(entry.type||entry.kind||entry.status||'').trim().toLowerCase();
    return kind==='bogang'||kind==='makeup'||kind==='보강'||kind==='sample'||kind==='샘플';
  }
  function studentDirectoryRowsFromRoot(root){
    const tabs=selectStudentDirectoryTabs(
      studentRootValue(root,TAB_LIST_KEY,[]),
      studentRootValue(root,MAIN_TAB_KEY,{})||{}
    );
    const enrollMap=studentRootValue(root,ENROLL_KEY,{})||{};
    const retireMap=studentRootValue(root,RETIRE_KEY,{})||{};
    const disabledMap=studentRootValue(root,DISABLED_KEY,{})||{};
    const activeRetireSlots=new Map();
    Object.entries(retireMap||{}).forEach(([slotKey,entry])=>{
      if(!entry) return;
      activeRetireSlots.set(slotKey,entry);
    });
    const enrollPersonKeys=new Set();
    Object.entries(enrollMap||{}).forEach(([slotKey,entry])=>{
      if(!entry||studentIsTemporaryOnly(entry)) return;
      const key=studentEntryPersonKey(entry,studentPairFallback(entry,retireMap));
      if(key) enrollPersonKeys.add(key);
    });

    const groups=new Map();
    const bangteukPeople=new Set();
    const bangteukSlots=new Set();
    const teacherByInstKey={};
    const handledRetireSlots=new Set();
    const tabOptions=[];
    const slotContexts=[];
    const isSaturdaySlot=slotKey=>{
      const p=String(slotKey||'').split('/');
      return p[1]==='토';
    };
    const checkSlotInContext=(ctx,slotKey)=>{
      const p=String(slotKey||'').split('/');
      if(p.length<4) return {visible:false,saturday:false,reason:'슬롯 형식 오류'};
      const saturday=p[1]==='토';
      if(studentIsBangteukGroupDay(p[1])) return {visible:false,saturday:false,bangteuk:true,reason:'방특반'};
      if(!ctx||!ctx.cfg||!ctx.cfg.days.includes(p[1])) return {visible:false,saturday,reason:'현재 시간표 요일 아님'};
      const baseTime=window.SCScheduleTime&&typeof window.SCScheduleTime.normalizeTimeBase==='function'
        ? window.SCScheduleTime.normalizeTimeBase(p[0])
        : p[0];
      const validSaturdayTime=!saturday||!window.SCScheduleTime||!window.SCScheduleTime.SAT_INTERNAL_TO_DISPLAY||!!window.SCScheduleTime.SAT_INTERNAL_TO_DISPLAY[baseTime];
      const lane=parseInt(p[2],10);
      if(!Number.isFinite(lane)||lane<1||lane>ctx.cfg.lanes) return {visible:false,saturday,reason:'현재 시간표 레인 밖'};
      const instKey=p[0]+'/'+p[1]+'/'+p[2];
      if(studentIsBangteukSlot(ctx,slotKey)) return {visible:false,saturday,bangteuk:true,reason:'방특반'};
      const cfgHasTime=ctx.cfg.times.includes(p[0])||ctx.cfg.times.includes(baseTime)||!!ctx.instRowsByKey[instKey];
      if(!cfgHasTime||!validSaturdayTime) return {visible:false,saturday,reason:'현재 시간표 시간 밖'};
      const maxRows=ctx.instRowsByKey[instKey];
      if(!maxRows) return {visible:false,saturday,reason:'담임 없는 칸'};
      const row=parseInt(p[3],10);
      if(!Number.isFinite(row)||row<1||row>maxRows) return {visible:false,saturday,reason:'현재 시간표 번호 밖'};
      if(disabledMap[instKey+'/'+row]) return {visible:false,saturday,reason:'비활성 칸'};
      return {visible:true,saturday,reason:''};
    };
    const checkSlotInAnyContext=slotKey=>{
      const p=String(slotKey||'').split('/');
      if(studentIsBangteukGroupDay(p[1])) return {visible:false,saturday:false,bangteuk:true,reason:'방특반'};
      let nonSaturdayFallback={visible:true,saturday:false,reason:''};
      let fallback={visible:false,saturday:true,reason:'토요일 운영 탭 없음'};
      for(const ctx of slotContexts){
        const res=checkSlotInContext(ctx,slotKey);
        if(res.bangteuk) return res;
        if(!res.saturday&&res.visible) return res;
        if(!res.saturday&&res.reason) nonSaturdayFallback=res;
        if(!res.saturday) continue;
        if(res.visible) return res;
        if(res.reason&&fallback.reason==='토요일 운영 탭 없음') fallback=res;
      }
      if(!isSaturdaySlot(slotKey)) return nonSaturdayFallback;
      return fallback;
    };
    const addHiddenSaturdayRecord=(entry,tab,slotKey,fallback,reason)=>{
      if(!isSaturdaySlot(slotKey)) return;
      const instKey=slotKey.split('/').slice(0,3).join('/');
      addStudentGroup(groups,studentRecord(entry,'숨김후보',tab||{id:'hidden',name:'숨김후보'},slotKey,reason||'시간표 밖',fallback,teacherByInstKey[instKey]||'',null));
    };
    const addBangteukPerson=(entry,tab,slotKey,fallback,teacherName,source)=>{
      const key=studentEntryPersonKey(entry,fallback);
      if(key) bangteukPeople.add(key);
      if(slotKey) bangteukSlots.add(slotKey);
      if(slotKey){
        addStudentGroup(groups,studentRecord(
          entry,
          '방특',
          tab||{id:'bangteuk',name:'방특'},
          slotKey,
          '',
          fallback,
          teacherName||'',
          source||null
        ));
      }
    };
    tabs.forEach(tab=>{
      const cfg=studentTabConfig(tab);
      tabOptions.push({id:cfg.tabId,name:cfg.tabName});
      const instMap=studentRootValue(root,cfg.instKey,{})||{};
      const students=studentRootValue(root,cfg.stuKey,[])||[];
      const instRowsByKey={};
      const timeSet=new Set(cfg.times);
      Object.keys(instMap||{}).forEach(key=>{
        const p=String(key||'').split('/');
        if(p.length>=3&&cfg.days.includes(p[1])) timeSet.add(p[0]);
      });
      [...timeSet].forEach(t=>{
        cfg.days.forEach(day=>{
          for(let lane=1;lane<=cfg.lanes;lane++){
            const instKey=t+'/'+day+'/'+lane;
            const inst=instMap[instKey];
            if(studentInstExists(inst)){
              if(!teacherByInstKey[instKey]) teacherByInstKey[instKey]=studentTeacherName(inst);
              if(studentIsBangteukInst(inst)) continue;
              instRowsByKey[instKey]=studentRowsForInst(tab,inst);
            }
          }
        });
      });
      const ctx={tab,cfg,instMap,instRowsByKey};
      slotContexts.push(ctx);
      const canCountSlot=slotKey=>{
        return checkSlotInContext(ctx,slotKey).visible;
      };
      const actualBySlot=new Map();
      (Array.isArray(students)?students:[]).forEach(stu=>{
        if(!stu||!stu.n||studentIsTemporaryOnly(stu)) return;
        const slotKey=studentSlotKey(stu);
        if(canCountSlot(slotKey)) actualBySlot.set(slotKey,stu);
        else {
          const hidden=checkSlotInContext(ctx,slotKey);
          if(hidden.bangteuk){
            const instKey=slotKey.split('/').slice(0,3).join('/');
            addBangteukPerson(stu,{id:cfg.tabId,name:cfg.tabName},slotKey,null,teacherByInstKey[instKey]||'',{kind:'student',key:cfg.stuKey,slotKey});
            return;
          }
          if(hidden.saturday) addHiddenSaturdayRecord(stu,{id:cfg.tabId,name:cfg.tabName},slotKey,null,hidden.reason);
        }
      });
      actualBySlot.forEach((stu,slotKey)=>{
        const retireEntry=activeRetireSlots.get(slotKey);
        const retire=retireEntry&&studentEntryMatchesPerson(retireEntry,stu,stu)?retireEntry:null;
        const enroll=enrollMap&&enrollMap[slotKey];
        if(enroll&&studentEntryMatchesPerson(enroll,null,stu)) return;
        if(retire){
          const ds=typeof retire==='string'?retire:retire.ds;
          const instKey=slotKey.split('/').slice(0,3).join('/');
          const isChange=enrollPersonKeys.has(studentEntryPersonKey(retire,stu));
          handledRetireSlots.add(slotKey);
          addStudentGroup(groups,studentRecord(retire,studentRetireStatus(retire,isChange),{id:cfg.tabId,name:cfg.tabName},slotKey,shortDate(ds)+'까지',stu,teacherByInstKey[instKey]||'',{kind:'retire',key:RETIRE_KEY,slotKey}));
        }else{
          const instKey=slotKey.split('/').slice(0,3).join('/');
          addStudentGroup(groups,studentRecord(stu,'재원',{id:cfg.tabId,name:cfg.tabName},slotKey,'',null,teacherByInstKey[instKey]||'',{kind:'student',key:cfg.stuKey,slotKey}));
        }
      });
    });

    const reservationTab={id:'reservation',name:'예약'};
    Object.entries(enrollMap||{}).forEach(([slotKey,entry])=>{
      if(!entry||studentIsTemporaryOnly(entry)) return;
      const hidden=checkSlotInAnyContext(slotKey);
      if(hidden.bangteuk){
        const instKey=slotKey.split('/').slice(0,3).join('/');
        addBangteukPerson(entry,reservationTab,slotKey,null,teacherByInstKey[instKey]||'',{kind:'enroll',key:ENROLL_KEY,slotKey});
        return;
      }
      if(hidden.saturday&&!hidden.visible){
        addHiddenSaturdayRecord(entry,reservationTab,slotKey,null,hidden.reason);
        return;
      }
      const ds=typeof entry==='string'?entry:entry.ds;
      const instKey=slotKey.split('/').slice(0,3).join('/');
      addStudentGroup(groups,studentRecord(entry,studentEnrollStatus(entry),reservationTab,slotKey,shortDate(ds)+'부터',null,teacherByInstKey[instKey]||'',{kind:'enroll',key:ENROLL_KEY,slotKey}));
    });
    activeRetireSlots.forEach((entry,slotKey)=>{
      if(handledRetireSlots.has(slotKey)) return;
      const hidden=checkSlotInAnyContext(slotKey);
      if(hidden.bangteuk) return;
      const ds=typeof entry==='string'?entry:entry.ds;
      const instKey=slotKey.split('/').slice(0,3).join('/');
      const fallback=studentPairFallback(entry,enrollMap);
      if(hidden.saturday&&!hidden.visible){
        addHiddenSaturdayRecord(entry,reservationTab,slotKey,fallback,hidden.reason);
        return;
      }
      const isChange=enrollPersonKeys.has(studentEntryPersonKey(entry,fallback));
      addStudentGroup(groups,studentRecord(entry,studentRetireStatus(entry,isChange),reservationTab,slotKey,shortDate(ds)+'까지',fallback,teacherByInstKey[instKey]||'',{kind:'retire',key:RETIRE_KEY,slotKey}));
    });

    const rows=[...groups.values()].map(row=>{
      const members=[...row.members.values()].sort((a,b)=>String(a.n).localeCompare(String(b.n),'ko')||String(a.status).localeCompare(String(b.status),'ko'));
      const names=members.map(m=>m.n).filter(Boolean);
      const slotText=members.map(m=>m.n+' '+m.status+' '+m.slots.map(slot=>slot.text).join(' / ')).join(' / ');
      const statusKeys=[...new Set(members.map(m=>m.statusKey).filter(Boolean))];
      const peopleKeys=new Set([
        ...row.countedPeople,
        ...row.retirePeople,
        ...row.movePeople,
        ...row.bangteukPeople,
      ]);
      if(!peopleKeys.size){
        members.forEach(m=>{
          const key=studentPersonKey(m);
          if(key) peopleKeys.add(key);
        });
      }
      const peopleCount=peopleKeys.size||0;
      const hasCountedStatus=row.countedPeople.size>0||statusKeys.includes('current')||statusKeys.includes('enroll');
      const countedSlotCount=[...new Set(members
        .filter(m=>m.statusKey==='current'||m.statusKey==='enroll')
        .flatMap(m=>(m.slots||[]).map(slot=>slot.key).filter(Boolean)))].length;
      return {
        key:row.key,
        p:row.p,
        peopleCount,
        counted:hasCountedStatus,
        countedCount:hasCountedStatus?(row.countedPeople.size||peopleCount):0,
        countedSlotCount,
        missingPhoneCount:row.phoneTargets&&row.phoneTargets.size?1:0,
        phoneTargets:[...(row.phoneTargets||new Map()).values()],
        retireCount:(!hasCountedStatus&&statusKeys.includes('retire'))?(row.retirePeople.size||peopleCount):0,
        hiddenCount:(!hasCountedStatus&&statusKeys.includes('hidden'))?peopleCount:0,
        bangteukCount:row.bangteukPeople.size||0,
        moveCount:statusKeys.includes('exclude')||statusKeys.includes('move')?(row.movePeople.size||peopleCount):0,
        statusKeys,
        tabIds:[...row.tabs].map(v=>v.split('|')[0]),
        tabs:[...row.tabs].map(v=>v.split('|')[1]).join(', '),
        members,
        names:names.join(', '),
        slots:slotText,
        search:[names.join(' '),row.p,[...row.statusKeys].join(' '),members.map(m=>m.status).join(' '),slotText].join(' ').toLowerCase(),
      };
    }).sort((a,b)=>String(a.p||a.names).localeCompare(String(b.p||b.names),'ko'));
    const counted=rows.reduce((sum,row)=>sum+(row.countedCount||0),0);
    const classHours=rows.reduce((sum,row)=>sum+(row.countedSlotCount||0),0);
    const averageHours=counted?classHours/counted:0;
    const retire=rows.reduce((sum,row)=>sum+(row.retireCount||0),0);
    const total=counted+retire;
    const move=rows.reduce((sum,row)=>sum+(row.moveCount||0),0);
    const hidden=rows.reduce((sum,row)=>sum+(row.hiddenCount||0),0);
    const missingPhone=rows.reduce((sum,row)=>sum+(row.missingPhoneCount||0),0);
    return {rows,tabs:[...tabOptions,{id:'reservation',name:'예약'}],total,counted,classHours,regularClassHours:classHours,bangteukClassHours:bangteukSlots.size,averageHours,retire,move,hidden,bangteuk:bangteukPeople.size,missingPhone,loadedAt:new Date().toISOString()};
  }
  async function loadStudentDirectory(force){
    const branchId=activeBranch;
    if(studentDirectoryLoadingByBranch[branchId]) return;
    if(studentDirectoryByBranch[branchId]&&!force){
      renderStudentDirectory();
      return;
    }
    studentDirectoryLoadingByBranch[branchId]=true;
    renderStudentDirectoryLoading();
    try{
      const root=await readBranchBackupData(branchId,false);
      studentDirectoryByBranch[branchId]=studentDirectoryRowsFromRoot(root);
    }catch(e){
      console.error(e);
      studentDirectoryByBranch[branchId]={rows:[],tabs:[],total:0,counted:0,classHours:0,regularClassHours:0,bangteukClassHours:0,averageHours:0,retire:0,move:0,hidden:0,bangteuk:0,missingPhone:0,error:e.message||String(e)};
      toast('원생목록 로드 실패','err');
    }finally{
      studentDirectoryLoadingByBranch[branchId]=false;
      if(activeBranch===branchId) renderStudentDirectory();
    }
  }
  function backupFileStamp(){
    const d=new Date();
    const p=n=>String(n).padStart(2,'0');
    return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());
  }
  function downloadJsonFile(filename,payload){
    const text=JSON.stringify(payload,null,2);
    const blob=new Blob([text],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    return blob.size;
  }
  function summerLayoutStatus(message,type){
    const el=$('summer-layout-status');
    if(!el) return;
    el.hidden=activeBranch!=='yongam';
    el.textContent=message;
    el.className='backup-status '+(type||'');
  }
  function updateSummerLayoutPanel(){
    const visible=activeBranch==='yongam'&&!!window.SCSummerLayout2026;
    const card=$('summer-layout-import');
    const status=$('summer-layout-status');
    if(card) card.hidden=!visible;
    if(status) status.hidden=!visible;
    const apply=$('summer-layout-apply');
    if(apply) apply.disabled=!visible||!summerLayoutState||!['source','marker'].includes(summerLayoutState.mode);
  }
  function summerCellToSlot(cell){
    const match=String(cell||'').match(/^([C-GJ-N])(\d{1,2})$/);
    if(!match) return null;
    const col=match[1].charCodeAt(0);
    const row=parseInt(match[2],10);
    const left=col>=67&&col<=71;
    const right=col>=74&&col<=78;
    if(!left&&!right) return null;
    let t='',r=0;
    if(row>=4&&row<=9){t='9시';r=row-3;}
    else if(row>=11&&row<=16){t='10시';r=row-10;}
    else if(row>=18&&row<=23){t='11시';r=row-17;}
    else return null;
    const d=left?'월수금':'화목';
    const l=left?col-66:col-73;
    return {t,d,l,r,slotKey:[t,d,l,r].join('/')};
  }
  function summerStudentCell(stu){
    if(!stu) return '';
    const day=String(stu.d||'');
    const lane=parseInt(stu.l,10);
    const row=parseInt(stu.r,10);
    if(!['월수금','화목'].includes(day)||lane<1||lane>5||row<1||row>6) return '';
    const bases={'9시':3,'10시':10,'11시':17};
    const base=bases[String(stu.t||'')];
    if(!base) return '';
    const col=String.fromCharCode((day==='월수금'?66:73)+lane);
    return col+String(base+row);
  }
  function summerStudentToken(stu){
    if(!stu) return '';
    return String(stu.n||'').trim()+String(stu.a||'').trim();
  }
  function summerLayoutIndex(students){
    const byCell=new Map();
    const invalid=[];
    const duplicate=[];
    (Array.isArray(students)?students:[]).forEach(stu=>{
      const cell=summerStudentCell(stu);
      if(!cell){invalid.push(stu);return;}
      if(byCell.has(cell)){duplicate.push(cell);return;}
      byCell.set(cell,stu);
    });
    return {byCell,invalid,duplicate};
  }
  function summerLayoutCanonical(index,useTargets){
    const manifest=window.SCSummerLayout2026;
    return manifest.moves.map(pair=>{
      const cell=useTargets?pair[1]:pair[0];
      return cell+'='+summerStudentToken(index.byCell.get(cell));
    }).join('|');
  }
  async function sha256Text(text){
    if(!window.crypto?.subtle) throw new Error('배치 검증을 지원하지 않는 브라우저입니다');
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
  }
  function summerMoveMap(){
    return new Map((window.SCSummerLayout2026?.moves||[]).map(([from,to])=>[
      summerCellToSlot(from)?.slotKey,
      summerCellToSlot(to)?.slotKey,
    ]).filter(pair=>pair[0]&&pair[1]));
  }
  function remapSummerString(value,moves){
    if(typeof value!=='string') return value;
    const parts=value.split('/');
    if(parts.length<4) return value;
    const source=parts.slice(0,4).join('/');
    const target=moves.get(source);
    if(!target) return value;
    return target+(parts.length>4?'/'+parts.slice(4).join('/'):'');
  }
  function remapSummerValue(value,moves){
    if(typeof value==='string') return remapSummerString(value,moves);
    if(Array.isArray(value)) return value.map(item=>remapSummerValue(item,moves));
    if(!value||typeof value!=='object') return value;
    const out={};
    Object.entries(value).forEach(([key,item])=>{
      out[remapSummerString(key,moves)]=remapSummerValue(item,moves);
    });
    const t=out.t||out.time;
    const d=out.d||out.day;
    const l=out.l||out.lane;
    const r=out.r||out.row;
    const target=moves.get([t,d,l,r].join('/'));
    if(target){
      const parts=target.split('/');
      if(Object.prototype.hasOwnProperty.call(out,'t')) out.t=parts[0];
      if(Object.prototype.hasOwnProperty.call(out,'time')) out.time=parts[0];
      if(Object.prototype.hasOwnProperty.call(out,'d')) out.d=parts[1];
      if(Object.prototype.hasOwnProperty.call(out,'day')) out.day=parts[1];
      if(Object.prototype.hasOwnProperty.call(out,'l')) out.l=parseInt(parts[2],10);
      if(Object.prototype.hasOwnProperty.call(out,'lane')) out.lane=parseInt(parts[2],10);
      if(Object.prototype.hasOwnProperty.call(out,'r')) out.r=parseInt(parts[3],10);
      if(Object.prototype.hasOwnProperty.call(out,'row')) out.row=parseInt(parts[3],10);
    }
    return out;
  }
  function summerReferenceCount(value,moves){
    let count=0;
    const scan=item=>{
      if(typeof item==='string'){
        if(remapSummerString(item,moves)!==item) count++;
        return;
      }
      if(Array.isArray(item)){item.forEach(scan);return;}
      if(!item||typeof item!=='object') return;
      const coord=[item.t||item.time,item.d||item.day,item.l||item.lane,item.r||item.row].join('/');
      if(moves.has(coord)) count++;
      Object.entries(item).forEach(([key,child])=>{
        if(remapSummerString(key,moves)!==key) count++;
        scan(child);
      });
    };
    scan(value);
    return count;
  }
  function summerLinkedKeys(tabId){
    return [
      MARK_KEY,RETIRE_KEY,ENROLL_KEY,HYUWON_KEY,DISABLED_KEY,MOVE_KEY,REQUESTS_KEY,
      'swim_bt_attendance_'+tabId,
    ];
  }
  async function readSummerLayoutBundle(){
    if(activeBranch!=='yongam') throw new Error('용암점에서만 실행할 수 있습니다');
    const root=branchRoot('yongam');
    const tabSnap=await root.child(TAB_LIST_KEY).once('value');
    const tabs=parseStored(tabSnap.val())||[];
    const wanted=String(window.SCSummerLayout2026.tabName||'').replace(/\s/g,'');
    const tab=(Array.isArray(tabs)?tabs:[]).find(item=>
      item&&item.type==='bangteuk'&&String(item.name||'').replace(/\s/g,'')===wanted
    );
    if(!tab) throw new Error('용암점 2026여름방특 탭을 찾지 못했습니다');
    const stuKey='swim_bt_'+tab.id+'_stu';
    const keys=[stuKey,...summerLinkedKeys(tab.id)];
    const snaps=await Promise.all(keys.map(key=>root.child(key).once('value')));
    const raw={};
    keys.forEach((key,index)=>{ raw[key]=snaps[index].val(); });
    const students=parseStored(raw[stuKey])||[];
    return {root,tab,stuKey,keys,raw,students};
  }
  async function analyzeSummerLayout(bundle){
    const manifest=window.SCSummerLayout2026;
    const index=summerLayoutIndex(bundle.students);
    const sourceCanonical=summerLayoutCanonical(index,false);
    const targetCanonical=summerLayoutCanonical(index,true);
    const [sourceHash,targetHash]=await Promise.all([
      sha256Text(sourceCanonical),sha256Text(targetCanonical),
    ]);
    let mode='mismatch';
    if(sourceHash===manifest.sourceHash) mode='source';
    else if(targetHash===manifest.targetHash) mode='applied';
    const addedTargets=new Set(manifest.moves
      .filter(pair=>manifest.addedSources.includes(pair[0]))
      .map(pair=>pair[1]));
    const markerCount=[...addedTargets].filter(cell=>
      index.byCell.get(cell)?.layoutAdded===manifest.marker
    ).length;
    if(mode==='applied'&&markerCount<manifest.addedSources.length) mode='marker';
    const moves=summerMoveMap();
    const linkedCount=bundle.keys.slice(1).reduce((sum,key)=>
      sum+summerReferenceCount(parseStored(bundle.raw[key]),moves),0
    );
    return Object.assign(bundle,{
      index,mode,sourceCanonical,targetCanonical,sourceHash,targetHash,
      markerCount,linkedCount,
    });
  }
  function summerLayoutStatusText(state){
    const manifest=window.SCSummerLayout2026;
    const problem=state.index.invalid.length||state.index.duplicate.length||state.students.length!==manifest.expectedStudents;
    if(problem){
      return `적용 중단\n원생 ${state.students.length}명 · 배치 밖 ${state.index.invalid.length}명 · 중복 자리 ${state.index.duplicate.length}칸\n현재 시간표가 엑셀 원본과 달라 확인이 필요합니다.`;
    }
    if(state.mode==='source'){
      return `적용 준비 완료\n원생 ${state.students.length}명 · 추가 표시 7명 · 연결 기록 ${state.linkedCount}건\n백업 후 좌표만 변경할 수 있습니다.`;
    }
    if(state.mode==='marker'){
      return `좌표 배치는 이미 반영되어 있습니다.\n(추가) 표시 ${state.markerCount}/7명 · 누락 표시만 보완할 수 있습니다.`;
    }
    if(state.mode==='applied'){
      return `적용 완료 상태입니다.\n원생 ${state.students.length}명 · (추가) 표시 ${state.markerCount}/7명`;
    }
    return `적용 중단\n원생 수는 ${state.students.length}명이지만 현재 자리 구성이 7/20 원본 또는 적용 완료 배치와 일치하지 않습니다.\n다른 수정사항을 덮어쓰지 않도록 자동 적용하지 않습니다.`;
  }
  async function checkSummerLayout(button){
    if(window.SCAuth&&!SCAuth.requirePermission('manageSettings','방특 배치 점검')) return;
    const label=button?.textContent||'';
    if(button){button.disabled=true;button.textContent='점검 중...';}
    const apply=$('summer-layout-apply');
    if(apply) apply.disabled=true;
    summerLayoutState=null;
    summerLayoutStatus('현재 용암점 방특 데이터를 확인하는 중입니다...');
    try{
      summerLayoutState=await analyzeSummerLayout(await readSummerLayoutBundle());
      const ok=['source','marker','applied'].includes(summerLayoutState.mode);
      summerLayoutStatus(summerLayoutStatusText(summerLayoutState),ok?'ok':'err');
    }catch(e){
      console.error(e);
      summerLayoutStatus('점검 실패\n'+(e.message||String(e)),'err');
      toast('방특 배치 점검 실패','err');
    }finally{
      if(button){button.disabled=false;button.textContent=label;}
      updateSummerLayoutPanel();
    }
  }
  function summerStudentDetails(stu){
    const copy=clone(stu||{});
    delete copy.t;delete copy.d;delete copy.l;delete copy.r;delete copy.layoutAdded;
    return JSON.stringify(copy);
  }
  function moveSummerStudents(students,mode){
    const manifest=window.SCSummerLayout2026;
    const moveByCell=new Map(manifest.moves);
    const addedSources=new Set(manifest.addedSources);
    const addedTargets=new Set(manifest.moves.filter(pair=>addedSources.has(pair[0])).map(pair=>pair[1]));
    const targets=new Set();
    const next=(Array.isArray(students)?students:[]).map(stu=>{
      const sourceCell=summerStudentCell(stu);
      const targetCell=mode==='source'?moveByCell.get(sourceCell):sourceCell;
      const target=summerCellToSlot(targetCell);
      if(!target) throw new Error('변경할 수 없는 방특 자리가 있습니다');
      if(targets.has(targetCell)) throw new Error('변경 후 자리가 중복됩니다: '+targetCell);
      targets.add(targetCell);
      const moved=Object.assign({},stu,{t:target.t,d:target.d,l:target.l,r:target.r});
      if((mode==='source'&&addedSources.has(sourceCell))||(mode!=='source'&&addedTargets.has(targetCell))){
        moved.layoutAdded=manifest.marker;
      }else if(moved.layoutAdded===manifest.marker){
        delete moved.layoutAdded;
      }
      return moved;
    });
    if(next.length!==students.length) throw new Error('원생 수가 변경되었습니다');
    for(let i=0;i<next.length;i++){
      if(summerStudentDetails(next[i])!==summerStudentDetails(students[i])){
        throw new Error('좌표 외 원생 상세정보 변경이 감지되었습니다');
      }
    }
    return next;
  }
  async function applySummerLayout(button){
    if(window.SCAuth&&!SCAuth.requirePermission('manageSettings','방특 배치 적용')) return;
    let state=summerLayoutState;
    if(!state||!['source','marker'].includes(state.mode)){
      toast('먼저 상태 점검을 실행해주세요','err');
      return;
    }
    const action=state.mode==='source'?'7/17 배치로 자리를 변경':'(추가) 표시를 보완';
    if(!confirm(`용암점 2026여름방특을 ${action}할까요?\n적용 직전 데이터는 JSON으로 자동 다운로드됩니다.`)) return;
    const label=button?.textContent||'';
    if(button){button.disabled=true;button.textContent='적용 중...';}
    summerLayoutStatus('적용 직전 백업을 만들고 있습니다...');
    try{
      const fresh=await analyzeSummerLayout(await readSummerLayoutBundle());
      if(fresh.mode!==state.mode){
        summerLayoutState=fresh;
        throw new Error(fresh.mode==='applied'?'다른 기기에서 이미 적용되었습니다':'점검 후 시간표가 변경되어 다시 점검이 필요합니다');
      }
      state=fresh;
      summerLayoutState=fresh;
      const backup={
        kind:'sc-schedule-layout-backup',version:1,
        branchId:'yongam',tabId:state.tab.id,tabName:state.tab.name,
        createdAt:new Date().toISOString(),studentKey:state.stuKey,
        keys:state.keys,data:state.raw,
      };
      downloadJsonFile('yongam-2026-summer-before-layout-'+backupFileStamp()+'.json',backup);
      const moves=summerMoveMap();
      let abortReason='';
      const res=await state.root.transactionKeys(state.keys,root=>{
        const students=parseStored(root[state.stuKey])||[];
        const index=summerLayoutIndex(students);
        const canonical=summerLayoutCanonical(index,state.mode!=='source');
        const expected=state.mode==='source'?state.sourceCanonical:state.targetCanonical;
        if(canonical!==expected){
          abortReason='점검 후 다른 수정이 발생하여 적용을 중단했습니다';
          return;
        }
        const nextStudents=moveSummerStudents(students,state.mode);
        root[state.stuKey]=JSON.stringify(nextStudents);
        if(state.mode==='source'){
          state.keys.slice(1).forEach(key=>{
            if(root[key]===undefined||root[key]===null) return;
            const value=parseStored(root[key]);
            root[key]=JSON.stringify(remapSummerValue(value,moves));
          });
        }
        return root;
      });
      if(!res.committed) throw new Error(abortReason||'배치 적용이 취소되었습니다');
      summerLayoutState=await analyzeSummerLayout(await readSummerLayoutBundle());
      if(summerLayoutState.mode!=='applied') throw new Error('저장 후 검증이 완료되지 않았습니다');
      summerLayoutStatus(summerLayoutStatusText(summerLayoutState),'ok');
      toast('2026 여름방특 배치 적용 완료','ok');
      studentDirectoryByBranch.yongam=null;
    }catch(e){
      console.error(e);
      summerLayoutStatus('적용 실패\n'+(e.message||String(e)),'err');
      toast('방특 배치 적용 실패','err');
    }finally{
      if(button){button.disabled=false;button.textContent=label;}
      updateSummerLayoutPanel();
    }
  }
  async function runBackup(scope,button){
    if(window.SCAuth && !SCAuth.requirePermission('manageSettings','백업 다운로드')) return;
    const includeHistory=!!$('backup-include-history')?.checked;
    const branchIds=(scope==='all'?Object.keys(BRANCHES):[activeBranch]).filter(canAccessBranch);
    if(!branchIds.length){
      toast('백업 가능한 지점이 없습니다','err');
      return;
    }
    const originalLabel=button?button.textContent:'';
    if(button){button.disabled=true;button.textContent='백업 생성 중...';}
    backupStatus('백업 데이터를 읽는 중입니다...\n대상: '+branchIds.map(id=>BRANCHES[id].name).join(', '));
    try{
      const startedAt=new Date().toISOString();
      const payload={
        version:1,
        kind:'sc-schedule-firestore-json-backup',
        exportedAt:startedAt,
        exportedBy:(window.SCAuth&&SCAuth.currentUser&&SCAuth.currentUser()?.email)||'',
        includeHistory,
        backend:String(window.SC_DATA_BACKEND||''),
        branches:{},
      };
      const summary=[];
      for(const branchId of branchIds){
        const branch=BRANCHES[branchId];
        const data=await readBranchBackupData(branchId,includeHistory);
        const keys=Object.keys(data||{}).sort();
        payload.branches[branchId]={
          id:branch.id,
          name:branch.name,
          fbPath:branch.fbPath,
          aligoBranch:branch.aligoBranch,
          keyCount:keys.length,
          keys,
          data,
        };
        summary.push(branch.name+' '+keys.length+'개 키');
      }
      const filename='sc-schedule-backup-'+(scope==='all'?'all':activeBranch)+'-'+backupFileStamp()+'.json';
      const bytes=downloadJsonFile(filename,payload);
      const sizeMb=(bytes/1024/1024).toFixed(2);
      backupStatus('백업 다운로드 완료\n파일: '+filename+'\n대상: '+summary.join(' / ')+'\n크기: '+sizeMb+' MB','ok');
      toast('백업 파일 다운로드 완료','ok');
    }catch(e){
      console.error(e);
      backupStatus('백업 실패\n'+(e.message||String(e)),'err');
      toast('백업 실패','err');
    }finally{
      if(button){button.disabled=false;button.textContent=originalLabel;}
    }
  }
  function can(permission){
    return !window.SCAuth || typeof SCAuth.can!=='function' || SCAuth.can(permission);
  }
  function canAccessBranch(branchId){
    return !window.SCAuth || typeof SCAuth.canAccessBranch!=='function' || SCAuth.canAccessBranch(branchId);
  }
  function setPermissionStates(){
    document.querySelectorAll('[data-perm]').forEach(el=>{
      const perms=String(el.getAttribute('data-perm')||'').split(/\s+/).filter(Boolean);
      const ok=!perms.length || perms.some(can);
      if('disabled' in el) el.disabled=!ok;
      el.classList.toggle('perm-disabled',!ok);
    });
  }
  function normalizeTeacherNames(list,branchId){
    const names=[];
    (Array.isArray(list)?list:[]).forEach(item=>{
      const name=String(item&&typeof item==='object'?item.n:item||'').trim();
      if(name&&!names.includes(name)) names.push(name);
    });
    if(!names.length) return clone(DEFAULT_TEACHERS[branchId]||[]);
    return names;
  }
  async function loadBranchBundle(branchId){
    const base=defaultSettings(branchId);
    try{
      const [settingsSnap,teachersSnap]=await Promise.all([
        branchRoot(branchId).child(SETTINGS_KEY).once('value'),
        branchRoot(branchId).child(TEACHERS_KEY).once('value'),
      ]);
      settingsByBranch[branchId]=mergeSettings(base,parseStored(settingsSnap.val()));
      teacherNamesByBranch[branchId]=normalizeTeacherNames(parseStored(teachersSnap.val()),branchId);
      settingsLoadFailedByBranch[branchId]=false;
      try{
        const feedbackSnap=await branchRoot(branchId).child(FEEDBACK_KEY).once('value');
        feedbackByBranch[branchId]=normalizeFeedbackList(parseStored(feedbackSnap.val()));
      }catch(feedbackError){
        console.warn('feedback load failed',feedbackError);
        feedbackByBranch[branchId]=[];
      }
    }catch(e){
      console.error(e);
      settingsByBranch[branchId]=base;
      teacherNamesByBranch[branchId]=clone(DEFAULT_TEACHERS[branchId]||[]);
      feedbackByBranch[branchId]=[];
      settingsLoadFailedByBranch[branchId]=true;
      toast('설정 로드 실패 — 저장은 차단됩니다','err');
    }
    renderAll();
  }
  async function saveSettings(kind){
    if(window.SCAuth && !SCAuth.requirePermission('manageSettings','설정 저장')) return;
    if(settingsLoadFailedByBranch[activeBranch]){
      toast('서버 설정 로드 실패 상태라 저장을 막았어요. 새로고침 후 다시 시도해주세요.','err');
      return;
    }
    const formData=collectCurrentSettings(kind);
    const user=window.SCAuth&&SCAuth.currentUser&&SCAuth.currentUser();
    const updatedAt=new Date().toISOString();
    const updatedBy=user&&user.email||'';
    try{
      const res=await branchRoot(activeBranch).child(SETTINGS_KEY).transaction(raw=>{
        const base=defaultSettings(activeBranch);
        const current=mergeSettings(base,parseStored(raw));
        current.branchId=activeBranch;
        current.branchName=BRANCHES[activeBranch].name;
        current.pages=formData.pages;
        if(!kind||kind==='recipients') current.recipients=formData.recipients;
        if(!kind||kind==='templates') current.templates=formData.templates;
        if(!kind||kind==='aligo') current.aligo=formData.aligo;
        if(!kind||kind==='sms') current.sms=formData.sms;
        current.updatedAt=updatedAt;
        current.updatedBy=updatedBy;
        delete current.aligo.templates;
        delete current.sms.templates;
        return JSON.stringify(current);
      });
      if(!res.committed) throw new Error('설정 저장이 취소되었습니다');
      settingsByBranch[activeBranch]=mergeSettings(defaultSettings(activeBranch),parseStored(res.snapshot.val()));
      renderAll();
      toast('설정 저장 완료','ok');
    }catch(e){
      console.error(e);
      toast('설정 저장 실패','err');
    }
  }
  function currentSettings(){
    if(!settingsByBranch[activeBranch]) settingsByBranch[activeBranch]=defaultSettings(activeBranch);
    return settingsByBranch[activeBranch];
  }
  function currentTeacherNames(){
    return teacherNamesByBranch[activeBranch]||clone(DEFAULT_TEACHERS[activeBranch]||[]);
  }
  function setPanel(panel){
    activePanel=PANEL_META[panel]?panel:'menu';
    document.querySelectorAll('.nav-btn').forEach(btn=>{
      const active=btn.dataset.panel===activePanel;
      btn.classList.toggle('active',active);
      if(active) btn.setAttribute('aria-current','page');
      else btn.removeAttribute('aria-current');
      btn.setAttribute('aria-controls','panel-'+btn.dataset.panel);
    });
    document.querySelectorAll('.settings-panel').forEach(panelEl=>{
      const active=panelEl.id==='panel-'+activePanel;
      panelEl.classList.toggle('active',active);
      panelEl.setAttribute('aria-hidden',active?'false':'true');
    });
    const meta=PANEL_META[activePanel];
    const panelTitle=$('settings-panel-title');
    if(panelTitle) panelTitle.textContent=meta.title;
    document.title=`${meta.title} - 슈퍼차일드 수영장`;
    try{
      const url=new URL(location.href);
      url.searchParams.set('panel',activePanel);
      history.replaceState(null,'',url.pathname+url.search+url.hash);
    }catch(e){}
    if(activePanel==='students') loadStudentDirectory(false);
    if(activePanel==='backup') updateSummerLayoutPanel();
  }
  function setBranch(branchId){
    if(!BRANCHES[branchId]||!canAccessBranch(branchId)) return;
    activeBranch=branchId;
    try{localStorage.setItem('selected_branch',branchId);}catch(e){}
    document.querySelectorAll('[data-sc-branch-select]').forEach(select=>{
      select.value=activeBranch;
    });
    $('settings-branch-title').textContent=BRANCHES[activeBranch].name;
    summerLayoutState=null;
    updateSummerLayoutPanel();
    if(settingsByBranch[activeBranch]&&teacherNamesByBranch[activeBranch]) renderAll();
    else loadBranchBundle(activeBranch);
    if(activePanel==='students') loadStudentDirectory(false);
  }
  function renderAll(){
    const data=currentSettings();
    $('settings-branch-title').textContent=BRANCHES[activeBranch].name;
    $('parent-page-link').textContent=data.pages.parent||'';
    $('teacher-page-link').textContent=data.pages.teacher||'';
    renderRecipients(data);
    renderTemplates(data);
    renderAligo(data);
    renderSms(data);
    renderFeedback();
    renderStudentDirectory();
    renderVariableGuide();
    updateFeedbackBadges();
    updateSummerLayoutPanel();
    setPermissionStates();
  }
  function setValue(id,value){
    const el=$(id);
    if(el) el.value=value||'';
  }
  function setChecked(id,value){
    const el=$(id);
    if(el) el.checked=!!value;
  }
  function renderRecipients(data){
    const recipients=data.recipients||defaultRecipients();
    const teachers=recipients.teachers||{};
    const teacherRows=currentTeacherNames().map(name=>{
      const saved=teachers[name]||{};
      return `<tr data-recipient-teacher="${escAttr(name)}">
        <td><input type="checkbox" data-field="enabled" ${saved.enabled===false?'':'checked'}></td>
        <td><strong>${esc(name)}</strong></td>
        <td><input type="tel" inputmode="numeric" autocomplete="off" data-field="phone" value="${escAttr(saved.phone||'')}" placeholder="01012345678"></td>
        <td>담당 선생님 알림</td>
      </tr>`;
    }).join('');
    $('recipient-teachers').innerHTML=teacherRows||'<tr><td colspan="4">선생님 목록이 없습니다.</td></tr>';

    const fixed=recipients.fixed||{};
    $('recipient-fixed').innerHTML=FIXED_RECIPIENTS.map(item=>{
      const saved=fixed[item.key]||{};
      return `<tr data-recipient-fixed="${escAttr(item.key)}">
        <td><input type="checkbox" data-field="enabled" ${saved.enabled===false?'':'checked'}></td>
        <td><strong>${esc(item.label)}</strong></td>
        <td><input type="tel" inputmode="numeric" autocomplete="off" data-field="phone" value="${escAttr(saved.phone||'')}" placeholder="01012345678"></td>
        <td><span class="recipient-key">${esc(item.key)}</span></td>
      </tr>`;
    }).join('');
  }
  function renderTemplates(data){
    const templates=mergeTemplates(defaultTemplates(activeBranch),(data&&data.templates)||{});
    const tbody=$('template-list');
    if(!tbody) return;
    tbody.innerHTML=TEMPLATE_DEFS.map(item=>{
      const tpl=templates[item.id]||item;
      return `<tr data-template-id="${escAttr(item.id)}">
        <td><input type="checkbox" data-field="enabled" ${tpl.enabled===false?'':'checked'}></td>
        <td>
          <strong>${esc(item.title)}</strong>
          <span class="template-target">${esc(item.target)}</span>
        </td>
        <td><input type="text" data-field="code" value="${escAttr(tpl.code||'')}" placeholder="승인 후 입력"></td>
        <td>
          <input type="text" data-field="subtitle" value="${escAttr(tpl.subtitle||'')}" placeholder="서브타이틀 미리보기">
          <input type="text" data-field="emtitle" value="${escAttr(tpl.emtitle||tpl.main||'')}" placeholder="강조표기 타이틀">
        </td>
        <td><textarea data-field="body" rows="5" placeholder="승인된 본문 그대로 입력">${esc(tpl.body||'')}</textarea></td>
        <td>
          <input type="text" data-field="buttonName" value="${escAttr(tpl.buttonName||'')}" placeholder="승인 버튼명">
          <input type="text" data-field="linkM" value="${escAttr(tpl.linkM||tpl.link||'')}" placeholder="모바일 링크 linkM">
          <input type="text" data-field="linkP" value="${escAttr(tpl.linkP||tpl.linkM||tpl.link||'')}" placeholder="PC 링크 linkP">
        </td>
      </tr>`;
    }).join('');
  }
  function getTemplatesForTest(){
    const hasRows=!!document.querySelector('#template-list tr[data-template-id]');
    if(hasRows) return collectTemplates();
    return mergeTemplates(defaultTemplates(activeBranch),currentSettings().templates||{});
  }
  function renderTestTemplateOptions(data){
    const select=$('aligo-test-template');
    if(!select) return;
    const templates=mergeTemplates(defaultTemplates(activeBranch),(data&&data.templates)||{});
    const selected=(data&&data.aligo&&data.aligo.testTemplateId)||'';
    select.innerHTML='<option value="">직접 입력</option>'+TEMPLATE_DEFS.map(item=>{
      const tpl=templates[item.id]||item;
      const codeText=tpl.code ? ' · 코드 있음' : ' · 코드 미입력';
      return `<option value="${escAttr(item.id)}">${esc(item.title+codeText)}</option>`;
    }).join('');
    select.value=templates[selected] ? selected : '';
  }
  function applyTestTemplate(templateId,force){
    if(!templateId) return;
    const templates=getTemplatesForTest();
    const tpl=templates[templateId];
    if(!tpl) return;
    if(force||!$('aligo-template-code').value.trim()) setValue('aligo-template-code',tpl.code||'');
    if(force||!$('aligo-test-subject').value.trim()) setValue('aligo-test-subject',tpl.emtitle||tpl.main||tpl.title||'');
    if(force||!$('aligo-test-message').value.trim()) setValue('aligo-test-message',tpl.body||'');
    if(force||!$('aligo-test-button-name').value.trim()) setValue('aligo-test-button-name',tpl.buttonName||'');
    if(force||!$('aligo-test-link-m').value.trim()) setValue('aligo-test-link-m',tpl.linkM||tpl.link||'');
    if(force||!$('aligo-test-link-p').value.trim()) setValue('aligo-test-link-p',tpl.linkP||tpl.linkM||tpl.link||'');
  }
  function renderAligo(data){
    const a=data.aligo||defaultSettings(activeBranch).aligo;
    renderTestTemplateOptions(data);
    setChecked('aligo-enabled',a.enabled);
    setChecked('aligo-test-mode',a.testMode);
    setValue('aligo-proxy-url',a.proxyUrl);
    setValue('aligo-sender-key',a.senderKey);
    setValue('aligo-sender',a.sender);
    setValue('aligo-remain-path',a.remainPath);
    setValue('aligo-send-path',a.sendPath);
    setValue('aligo-test-template',a.testTemplateId);
    setValue('aligo-template-code',a.templateCode);
    setValue('aligo-test-receiver',a.testReceiver);
    setValue('aligo-test-recvname',a.testRecvName);
    setValue('aligo-test-subject',a.testSubject);
    setValue('aligo-test-message',a.testMessage);
    setValue('aligo-test-button-name',a.testButtonName);
    setValue('aligo-test-link-m',a.testLinkM||a.testLink);
    setValue('aligo-test-link-p',a.testLinkP||a.testLinkM||a.testLink);
    setValue('aligo-test-vars',a.testVars||defaultTestVars(activeBranch));
    if(a.testTemplateId) applyTestTemplate(a.testTemplateId,false);
  }
  function renderSms(data){
    const s=data.sms||defaultSettings(activeBranch).sms;
    setChecked('sms-enabled',s.enabled);
    setChecked('sms-fallback',s.fallback);
    setValue('sms-proxy-url',s.proxyUrl);
    setValue('sms-userid',s.userid);
    setValue('sms-api-key-env',s.apiKeyEnv);
    setValue('sms-sender',s.sender);
    setValue('sms-send-path',s.sendPath);
    setValue('sms-remain-path',s.remainPath);
    setChecked('sms-target-parent',(s.targets||{}).parent);
    setChecked('sms-target-teacher',(s.targets||{}).teacher);
    setChecked('sms-target-desk',(s.targets||{}).desk);
  }
  function renderVariableGuide(){
    const container=$('variable-guide');
    if(!container||container.dataset.ready==='1') return;
    container.innerHTML=VARIABLE_GUIDE.map(item=>`
      <div class="variable-item">
        <code>${esc(item.name)}</code>
        <strong>${esc(item.label)}</strong>
        <span>예: ${esc(item.sample)}</span>
      </div>
    `).join('');
    container.dataset.ready='1';
  }
  function normalizePhone(value){
    return String(value||'').replace(/[^\d]/g,'');
  }
  function collectRecipients(){
    const recipients=defaultRecipients();
    document.querySelectorAll('#recipient-teachers tr[data-recipient-teacher]').forEach(row=>{
      const name=row.dataset.recipientTeacher;
      recipients.teachers[name]={
        phone:normalizePhone(row.querySelector('[data-field="phone"]')?.value),
        enabled:!!row.querySelector('[data-field="enabled"]')?.checked,
      };
    });
    document.querySelectorAll('#recipient-fixed tr[data-recipient-fixed]').forEach(row=>{
      const key=row.dataset.recipientFixed;
      const meta=FIXED_RECIPIENTS.find(item=>item.key===key);
      recipients.fixed[key]={
        label:meta?.label||key,
        memo:meta?.memo||'',
        phone:normalizePhone(row.querySelector('[data-field="phone"]')?.value),
        enabled:!!row.querySelector('[data-field="enabled"]')?.checked,
      };
    });
    return recipients;
  }
  function collectTemplates(){
    const templates=mergeTemplates(defaultTemplates(activeBranch),currentSettings().templates||{});
    document.querySelectorAll('#template-list tr[data-template-id]').forEach(row=>{
      const id=row.dataset.templateId;
      templates[id]=Object.assign({},templates[id]||{},{
        enabled:!!row.querySelector('[data-field="enabled"]')?.checked,
        code:row.querySelector('[data-field="code"]')?.value.trim()||'',
        subtitle:row.querySelector('[data-field="subtitle"]')?.value.trim()||'',
        emtitle:row.querySelector('[data-field="emtitle"]')?.value.trim()||'',
        main:row.querySelector('[data-field="emtitle"]')?.value.trim()||'',
        body:row.querySelector('[data-field="body"]')?.value||'',
        buttonName:row.querySelector('[data-field="buttonName"]')?.value.trim()||'',
        linkM:row.querySelector('[data-field="linkM"]')?.value.trim()||'',
        linkP:row.querySelector('[data-field="linkP"]')?.value.trim()||'',
        link:row.querySelector('[data-field="linkM"]')?.value.trim()||'',
      });
    });
    return templates;
  }
  function collectCurrentSettings(kind){
    const data=mergeSettings(defaultSettings(activeBranch),currentSettings());
    data.branchId=activeBranch;
    data.branchName=BRANCHES[activeBranch].name;
    data.pages={
      parent:$('parent-page-link').textContent||defaultSettings(activeBranch).pages.parent,
      teacher:$('teacher-page-link').textContent||defaultSettings(activeBranch).pages.teacher,
    };
    if(!kind||kind==='recipients'){
      data.recipients=collectRecipients();
    }
    if(!kind||kind==='templates'){
      data.templates=collectTemplates();
    }
    if(!kind||kind==='aligo'){
      data.aligo={
        enabled:$('aligo-enabled').checked,
        testMode:$('aligo-test-mode').checked,
        proxyUrl:$('aligo-proxy-url').value.trim()||'/aligo',
        senderKey:$('aligo-sender-key').value.trim(),
        sender:$('aligo-sender').value.trim(),
        remainPath:$('aligo-remain-path').value.trim()||'/remain/',
        sendPath:$('aligo-send-path').value.trim()||'/alimtalk/send/',
        testTemplateId:$('aligo-test-template').value,
        templateCode:$('aligo-template-code').value.trim(),
        testReceiver:normalizePhone($('aligo-test-receiver').value),
        testRecvName:$('aligo-test-recvname').value.trim(),
        testSubject:$('aligo-test-subject').value.trim(),
        testMessage:$('aligo-test-message').value,
        testButtonName:$('aligo-test-button-name').value.trim(),
        testLinkM:$('aligo-test-link-m').value.trim(),
        testLinkP:$('aligo-test-link-p').value.trim(),
        testLink:$('aligo-test-link-m').value.trim(),
        testVars:$('aligo-test-vars').value,
      };
    }
    if(!kind||kind==='sms'){
      data.sms={
        enabled:$('sms-enabled').checked,
        fallback:$('sms-fallback').checked,
        proxyUrl:$('sms-proxy-url').value.trim()||'/aligo',
        userid:$('sms-userid').value.trim(),
        apiKeyEnv:$('sms-api-key-env').value.trim()||'ALIGO_KEY',
        sender:$('sms-sender').value.trim(),
        sendPath:$('sms-send-path').value.trim()||'/send/',
        remainPath:$('sms-remain-path').value.trim()||'/remain/',
        targets:{
          parent:$('sms-target-parent').checked,
          teacher:$('sms-target-teacher').checked,
          desk:$('sms-target-desk').checked,
        },
      };
    }
    delete data.aligo.templates;
    delete data.sms.templates;
    return data;
  }
  function joinProxyUrl(base,path){
    let cleanBase=String(base||'/aligo').trim()||'/aligo';
    if(/^\/aligo(?:\/|$)/.test(cleanBase) && /^(localhost|127\.0\.0\.1)$/i.test(location.hostname)){
      cleanBase='https://adminsuperchild.cloud/aligo';
    }
    const cleanPath=String(path||'').trim();
    if(!cleanPath) return cleanBase;
    return cleanBase.replace(/\/+$/,'')+'/'+cleanPath.replace(/^\/+/,'');
  }
  function shouldUseOpaqueLocalProxy(url){
    try{
      const target=new URL(url,location.href);
      return /^(localhost|127\.0\.0\.1)$/i.test(location.hostname) && target.origin!==location.origin;
    }catch(e){
      return false;
    }
  }
  function testConfig(kind){
    if(kind==='sms'){
      return {
        resultId:'sms-test-result',
        proxyUrl:$('sms-proxy-url').value.trim()||'/aligo',
        remainPath:$('sms-remain-path').value.trim()||'/remain/',
        userid:$('sms-userid').value.trim(),
        sender:$('sms-sender').value.trim(),
      };
    }
    return {
      resultId:'aligo-test-result',
      proxyUrl:$('aligo-proxy-url').value.trim()||'/aligo',
      remainPath:$('aligo-remain-path').value.trim()||'/remain/',
      sendPath:$('aligo-send-path').value.trim()||'/alimtalk/send/',
      branch:aligoBranchValue(activeBranch),
      senderKey:$('aligo-sender-key').value.trim(),
      sender:$('aligo-sender').value.trim(),
      testTemplateId:$('aligo-test-template').value,
      templateCode:$('aligo-template-code').value.trim(),
      testReceiver:normalizePhone($('aligo-test-receiver').value),
      testRecvName:$('aligo-test-recvname').value.trim(),
      testSubject:$('aligo-test-subject').value.trim(),
      testMessage:$('aligo-test-message').value,
      buttonName:$('aligo-test-button-name').value.trim(),
      linkM:$('aligo-test-link-m').value.trim(),
      linkP:$('aligo-test-link-p').value.trim(),
      testVars:$('aligo-test-vars').value,
      testMode:$('aligo-test-mode').checked,
    };
  }
  function showTestResult(resultId,ok,title,data){
    const el=$(resultId);
    if(!el) return;
    const body=typeof data==='string' ? data : JSON.stringify(data,null,2);
    el.hidden=false;
    el.className='test-result '+(ok?'ok':'err');
    el.textContent=`${title}\n\n${body||'응답 본문 없음'}`;
  }
  async function readTestResponse(res){
    const text=await res.text();
    let body=text;
    if(text){
      try{body=JSON.parse(text);}catch(e){}
    }
    if(!res.ok){
      const msg=body&&typeof body==='object'&&(body.message||body.error)
        ? (body.message||body.error)
        : (typeof body==='string'&&body)||res.statusText||'요청 실패';
      const err=new Error(msg);
      err.body=body;
      err.status=res.status;
      throw err;
    }
    return body||{ok:true};
  }
  async function runProxyTest(kind,type,button){
    const cfg=testConfig(kind);
    const titlePrefix=kind==='sms'?'문자':'알림톡';
    const isHealth=type==='health';
    const url=joinProxyUrl(cfg.proxyUrl,isHealth?'health':cfg.remainPath);
    const body=new URLSearchParams();
    if(kind==='aligo') body.set('branch',aligoBranchValue(activeBranch));
    if(kind==='sms'&&cfg.userid) body.set('user_id',cfg.userid);
    if(kind==='sms'&&cfg.sender) body.set('sender',cfg.sender);
    const label=button&&button.textContent;
    if(button){
      button.disabled=true;
      button.textContent='확인 중';
    }
    try{
      if(shouldUseOpaqueLocalProxy(url)){
        showTestResult(cfg.resultId,false,`${titlePrefix} ${isHealth?'연결 확인':'잔여건수 조회'}는 운영 주소에서 확인해주세요: ${url}`,{
          message:'로컬 테스트 주소에서는 CORS 정책 때문에 프록시 응답을 읽을 수 없습니다. 발송 요청은 로컬에서도 보낼 수 있지만, 잔여건수/응답 확인은 운영 사이트에서 테스트해주세요.',
          local:true,
        });
        toast('운영 주소에서 확인해주세요','err');
        return;
      }
      const res=await fetch(url,isHealth?{method:'GET'}:{
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
        body,
      });
      const data=await readTestResponse(res);
      showTestResult(cfg.resultId,true,`${titlePrefix} ${isHealth?'연결 확인':'잔여건수 조회'} 성공: ${url}`,data);
      toast(`${titlePrefix} ${isHealth?'연결':'잔여건수'} 확인 완료`,'ok');
    }catch(e){
      showTestResult(cfg.resultId,false,`${titlePrefix} ${isHealth?'연결 확인':'잔여건수 조회'} 실패: ${url}`,{
        status:e.status||'',
        message:e.message||String(e),
        body:e.body||null,
      });
      toast(`${titlePrefix} 확인 실패`,'err');
    }finally{
      if(button){
        button.disabled=false;
        button.textContent=label;
      }
    }
  }
  function validateAlimtalkTest(cfg){
    const missing=[];
    if(!cfg.branch) missing.push('지점');
    if(!cfg.senderKey) missing.push('발신 프로파일 키');
    if(!cfg.sender) missing.push('발신번호');
    if(!cfg.templateCode) missing.push('템플릿 코드');
    if(!cfg.testReceiver) missing.push('테스트 수신번호');
    if(!cfg.testSubject) missing.push('강조표기 타이틀');
    if(!cfg.testMessage) missing.push('승인 본문');
    const hasButton = !!(cfg.buttonName || cfg.linkM || cfg.linkP);
    if(hasButton && !cfg.buttonName) missing.push('버튼명');
    if(hasButton && !cfg.linkM) missing.push('모바일 링크 linkM');
    if(hasButton && !cfg.linkP) missing.push('PC 링크 linkP');
    if(missing.length) throw new Error(missing.join(', ')+' 입력이 필요합니다');
  }
  function parseTestVars(text){
    const raw=String(text||'').trim();
    if(!raw) return {};
    if(raw.startsWith('{')){
      try{
        const parsed=JSON.parse(raw);
        return parsed&&typeof parsed==='object' ? parsed : {};
      }catch(e){}
    }
    return raw.split(/\r?\n/).reduce((acc,line)=>{
      const trimmed=line.trim();
      if(!trimmed||trimmed.startsWith('#')) return acc;
      const idx=trimmed.indexOf('=')>=0 ? trimmed.indexOf('=') : trimmed.indexOf(':');
      if(idx<0) return acc;
      const key=trimmed.slice(0,idx).trim().replace(/^#\{|\}$/g,'');
      if(!key) return acc;
      acc[key]=trimmed.slice(idx+1).trim();
      return acc;
    },{});
  }
  function renderTestVars(text,vars){
    return String(text||'').replace(/#\{([^}]+)\}/g,(all,name)=>{
      const key=String(name||'').trim();
      return vars[key]===undefined||vars[key]===null?'':String(vars[key]);
    });
  }
  async function runAlimtalkSend(button, live){
    const cfg=testConfig('aligo');
    const tpl=cfg.testTemplateId ? getTemplatesForTest()[cfg.testTemplateId] : null;
    if(tpl){
      cfg.templateCode=cfg.templateCode||tpl.code||'';
      cfg.testSubject=cfg.testSubject||tpl.emtitle||tpl.main||tpl.title||'';
      cfg.testMessage=cfg.testMessage||tpl.body||'';
      cfg.buttonName=cfg.buttonName||tpl.buttonName||'';
      cfg.linkM=cfg.linkM||tpl.linkM||tpl.link||'';
      cfg.linkP=cfg.linkP||tpl.linkP||tpl.linkM||tpl.link||'';
    }
    const vars=Object.assign({},parseTestVars(defaultTestVars(activeBranch)),parseTestVars(cfg.testVars));
    cfg.testSubject=renderTestVars(cfg.testSubject,vars);
    cfg.testMessage=renderTestVars(cfg.testMessage,vars);
    cfg.buttonName=renderTestVars(cfg.buttonName||'',vars);
    cfg.linkM=renderTestVars(cfg.linkM||'',vars);
    cfg.linkP=renderTestVars(cfg.linkP||'',vars);
    try{
      validateAlimtalkTest(cfg);
    }catch(e){
      showTestResult(cfg.resultId,false,'알림톡 테스트 발송 준비 실패',{message:e.message});
      toast('필수값을 확인해주세요','err');
      return;
    }
    const modeText=live?'실제 알림톡':'테스트 검증';
    if(!window.confirm(`${modeText} 1건을 발송할까요?`)) return;
    const url=joinProxyUrl(cfg.proxyUrl,cfg.sendPath);
    const body=new URLSearchParams();
    body.set('branch',cfg.branch);
    body.set('senderkey',cfg.senderKey);
    body.set('sender',normalizePhone(cfg.sender));
    body.set('tpl_code',cfg.templateCode);
    body.set('receiver_1',cfg.testReceiver);
    if(cfg.testRecvName) body.set('recvname_1',cfg.testRecvName);
    body.set('subject_1',cfg.testSubject);
    body.set('emtitle_1',cfg.testSubject);
    body.set('message_1',cfg.testMessage);
    body.set('testMode',live?'N':'Y');
    body.set('failover','N');
    if(cfg.buttonName&&cfg.linkM&&cfg.linkP){
      body.set('button_1',JSON.stringify({
        button:[{
          name:cfg.buttonName,
          linkType:'WL',
          linkTypeName:'웹링크',
          linkM:cfg.linkM,
          linkP:cfg.linkP,
        }],
      }));
    }
    const label=button&&button.textContent;
    if(button){
      button.disabled=true;
      button.textContent='발송 중';
    }
    try{
      const opaqueLocal=shouldUseOpaqueLocalProxy(url);
      const res=await fetch(url,opaqueLocal
        ? {method:'POST',mode:'no-cors',body}
        : {
          method:'POST',
          headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
          body,
        });
      if(opaqueLocal){
        showTestResult(cfg.resultId,true,`알림톡 ${modeText} 요청 완료: ${url}`,{
          message:'로컬 테스트에서는 CORS 정책 때문에 응답 내용을 읽을 수 없습니다. 알리고 발송내역에서 실제 도착 여부를 확인해주세요.',
          opaque:true,
        });
        toast(`알림톡 ${modeText} 요청 완료`,'ok');
        return;
      }
      const data=await readTestResponse(res);
      showTestResult(cfg.resultId,true,`알림톡 ${modeText} 응답: ${url}`,data);
      toast(`알림톡 ${modeText} 요청 완료`,'ok');
    }catch(e){
      showTestResult(cfg.resultId,false,`알림톡 ${modeText} 실패: ${url}`,{
        status:e.status||'',
        message:e.message||String(e),
        body:e.body||null,
      });
      toast(`알림톡 ${modeText} 실패`,'err');
    }finally{
      if(button){
        button.disabled=false;
        button.textContent=label;
      }
    }
  }
  function resetForm(kind){
    const fresh=defaultSettings(activeBranch);
    if(kind==='recipients') renderRecipients(fresh);
    if(kind==='templates') renderTemplates(fresh);
    if(kind==='aligo') renderAligo(fresh);
    if(kind==='sms') renderSms(fresh);
    toast('기본값을 불러왔어요. 저장을 누르면 반영됩니다.');
  }
  function esc(s){
    return String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function escAttr(s){return esc(s).replace(/`/g,'&#96;');}
  function actionUrl(action){
    if(action==='schedule') return `index.html?branch=${activeBranch}`;
    if(action==='teacherPage') return `teacher.html?branch=${activeBranch}`;
    if(action==='parentPage') return `parent.html?branch=${activeBranch}`;
    const returnsToSettings=['records','teachers','periods','closed'].includes(action);
    return `index.html?branch=${activeBranch}&settings=${action}${returnsToSettings?'&from=settings':''}`;
  }
  function openAction(action){
    if(!action) return;
    location.href=actionUrl(action);
  }
  async function copyLink(kind){
    const data=currentSettings();
    const link=kind==='teacher' ? data.pages.teacher : data.pages.parent;
    try{
      await navigator.clipboard.writeText(link);
      toast('링크 복사 완료');
    }catch(e){
      window.prompt('링크 복사',link);
    }
  }
  function renderFeedback(){
    const list=feedbackList(activeBranch);
    const wrap=$('feedback-list');
    if(!wrap) return;
    const newCount=list.filter(isNewFeedback).length;
    const newEl=$('feedback-new-count');
    const totalEl=$('feedback-total-count');
    if(newEl) newEl.textContent=String(newCount);
    if(totalEl) totalEl.textContent=String(list.length);
    if(!list.length){
      wrap.innerHTML='<div class="feedback-empty">아직 접수된 의견이 없습니다.</div>';
      return;
    }
    wrap.innerHTML=list.map(item=>{
      const isNew=isNewFeedback(item);
      const name=item.name||'이름 없음';
      const phone=item.phone ? ` · ${item.phone}` : '';
      const slot=item.studentSlotKey ? ` · ${item.studentSlotKey}` : '';
      const page=item.page ? ` · ${item.page}` : '';
      const actionLabel=isNew ? '확인완료' : '새 접수로';
      const actionStatus=isNew ? 'done' : 'new';
      return `<article class="feedback-card ${isNew?'is-new':''}">
        <div class="feedback-card-head">
          <div class="feedback-meta">
            <div class="feedback-title">
              <strong>${esc(item.context||'의견 제출')}</strong>
              <span class="feedback-status ${isNew?'':'done'}">${isNew?'새 접수':'확인완료'}</span>
            </div>
            <div class="feedback-sub">${esc(formatFeedbackDate(item.at))} · ${esc(name)}${esc(phone)}${esc(slot)}${esc(page)}</div>
          </div>
          <div class="feedback-actions">
            <button type="button" class="mini-btn" data-feedback-action="status" data-feedback-id="${escAttr(item.id||'')}" data-feedback-status="${actionStatus}">${actionLabel}</button>
          </div>
        </div>
        <div class="feedback-message">${esc(item.message||'')}</div>
      </article>`;
    }).join('');
  }
  function renderStudentDirectoryLoading(){
    const body=$('students-list-body');
    if(body) body.innerHTML='<tr><td colspan="5" class="student-empty">원생목록을 불러오는 중입니다...</td></tr>';
  }
  function currentStudentDirectory(){
    return studentDirectoryByBranch[activeBranch]||{rows:[],tabs:[],total:0,counted:0,classHours:0,regularClassHours:0,bangteukClassHours:0,averageHours:0,retire:0,move:0,hidden:0,bangteuk:0,missingPhone:0};
  }
  function studentRowTeachers(row){
    return [...new Set((row.members||[]).flatMap(member=>(member.slots||[]).map(slot=>slot.teacher).filter(Boolean)))];
  }
  function studentRowSlotBadges(row){
    return [...new Set((row.members||[]).flatMap(member=>(member.slots||[]).map(slot=>slot.badge).filter(Boolean)))];
  }
  function studentRowName(row){
    return (row.members||[]).map(member=>member.n).filter(Boolean).sort((a,b)=>String(a).localeCompare(String(b),'ko')).join(', ');
  }
  function studentRowStatusRank(row){
    const keys=row.statusKeys||[];
    if(keys.includes('current')) return 1;
    if(keys.includes('enroll')) return 2;
    if(keys.includes('exclude')) return 3;
    if(keys.includes('move')) return 4;
    if(keys.includes('retire')) return 5;
    if(keys.includes('bangteuk')) return 6;
    return 9;
  }
  function renderStudentTeacherOptions(dir){
    const select=$('students-teacher-filter');
    if(!select) return;
    const current=select.value||'all';
    const names=[...new Set((dir.rows||[]).flatMap(row=>studentRowTeachers(row)))].sort((a,b)=>String(a).localeCompare(String(b),'ko'));
    const options=['<option value="all">전체 선생님</option>',...names.map(name=>`<option value="${escAttr(name)}">${esc(name)} 선생님</option>`)];
    select.innerHTML=options.join('');
    select.value=[...select.options].some(opt=>opt.value===current)?current:'all';
  }
  function filteredStudentRows(){
    const dir=currentStudentDirectory();
    const q=String($('students-search')?.value||'').trim().toLowerCase();
    const status=$('students-status-filter')?.value||'all';
    const teacher=$('students-teacher-filter')?.value||'all';
    const sort=$('students-sort')?.value||'count';
    const rows=(dir.rows||[]).filter(row=>{
      if(status==='counted'&&!row.counted) return false;
      if(status==='current'&&!(row.statusKeys||[]).includes('current')) return false;
      if(status==='enroll'&&!(row.statusKeys||[]).includes('enroll')) return false;
      if(status==='exclude'&&!(row.statusKeys||[]).includes('exclude')) return false;
      if(status==='move'&&!(row.statusKeys||[]).includes('move')) return false;
      if(status==='retire'&&!(row.statusKeys||[]).includes('retire')) return false;
      if(status==='bangteuk'&&!(row.statusKeys||[]).includes('bangteuk')) return false;
      if(status==='hidden'&&!(row.statusKeys||[]).includes('hidden')) return false;
      if(status==='missing_phone'&&!(row.missingPhoneCount>0)) return false;
      if(teacher!=='all'&&!studentRowTeachers(row).includes(teacher)) return false;
      if(q&&!String(row.search||'').includes(q)) return false;
      return true;
    });
    return rows.sort((a,b)=>{
      const byName=()=>studentRowName(a).localeCompare(studentRowName(b),'ko') || String(a.p||'').localeCompare(String(b.p||''),'ko');
      if(sort==='phone') return String(a.p||'').localeCompare(String(b.p||''),'ko') || byName();
      if(sort==='name') return byName();
      if(sort==='status') return studentRowStatusRank(a)-studentRowStatusRank(b) || byName();
      if(sort==='teacher'){
        const at=studentRowTeachers(a).join(', ');
        const bt=studentRowTeachers(b).join(', ');
        return at.localeCompare(bt,'ko') || byName();
      }
      return (b.countedCount||0)-(a.countedCount||0) || (b.retireCount||0)-(a.retireCount||0) || byName();
    });
  }
  function studentStatusClass(statusKey){
    if(statusKey==='enroll') return 'enroll';
    if(statusKey==='exclude') return 'exclude';
    if(statusKey==='move') return 'move';
    if(statusKey==='retire') return 'retire';
    if(statusKey==='bangteuk') return 'bangteuk';
    if(statusKey==='hidden') return 'hidden';
    return '';
  }
  function studentPhoneCell(row){
    const hasMissing=(row.missingPhoneCount||0)>0;
    const digits=normalizePhone(row.p||'');
    if(!hasMissing) return row.p?esc(row.p):'<span class="student-muted">번호 없음</span>';
    const label=row.p
      ? `${esc(row.p)}<span class="student-phone-note">시간표 미입력 ${row.phoneTargets?.length||1}칸</span>`
      : `<span class="student-phone-note">전화번호 미입력</span>`;
    const buttonText=row.p?'빈칸에 적용':'저장';
    return `<div class="student-phone-editor">
      ${label}
      <input type="tel" inputmode="numeric" autocomplete="off" data-student-phone-input="${escAttr(row.key)}" value="${escAttr(digits)}" placeholder="01012345678">
      <button type="button" data-student-phone-save="${escAttr(row.key)}">${buttonText}</button>
    </div>`;
  }
  function entryName(entry){
    return String(entry&&typeof entry==='object'?(entry.n||entry.name):'').trim();
  }
  function entryAge(entry){
    return String(entry&&typeof entry==='object'?(entry.a||entry.age):'').trim();
  }
  function entryHasPhone(entry){
    return !!normalizePhone(entry&&typeof entry==='object'?(entry.p||entry.phone||entry.tel):'');
  }
  function studentPhoneTargetMatches(entry,target){
    if(!entry||typeof entry!=='object'||entryHasPhone(entry)) return false;
    const targetName=String(target&&target.name||'').trim();
    const name=entryName(entry);
    if(targetName&&name&&targetName!==name) return false;
    const targetAge=String(target&&target.age||'').trim();
    const age=entryAge(entry);
    if(targetAge&&age&&targetAge!==age) return false;
    return !!(targetName||name);
  }
  function setEntryPhone(entry,phone){
    if(!entry||typeof entry!=='object') return false;
    entry.p=phone;
    if(Object.prototype.hasOwnProperty.call(entry,'phone')) entry.phone=phone;
    if(Object.prototype.hasOwnProperty.call(entry,'tel')) entry.tel=phone;
    return true;
  }
  function studentPhoneInputFor(rowKey){
    return [...document.querySelectorAll('[data-student-phone-input]')]
      .find(el=>el.dataset.studentPhoneInput===String(rowKey));
  }
  function studentPhoneButtonFor(rowKey){
    return [...document.querySelectorAll('[data-student-phone-save]')]
      .find(el=>el.dataset.studentPhoneSave===String(rowKey));
  }
  function saveStudentPhoneForTargetMap(map,target,phone){
    if(!map||typeof map!=='object'||Array.isArray(map)) return 0;
    const entry=map[target.slotKey];
    if(!studentPhoneTargetMatches(entry,target)) return 0;
    setEntryPhone(entry,phone);
    map[target.slotKey]=entry;
    return 1;
  }
  async function saveStudentPhone(rowKey){
    if(window.SCAuth && !SCAuth.requirePermission('manageSettings','원생 전화번호 수정')) return;
    const dir=currentStudentDirectory();
    const row=(dir.rows||[]).find(item=>String(item.key)===String(rowKey));
    const targets=(row&&row.phoneTargets)||[];
    if(!row||!targets.length){
      toast('수정할 전화번호 미입력 항목이 없습니다','err');
      return;
    }
    const input=studentPhoneInputFor(rowKey);
    const button=studentPhoneButtonFor(rowKey);
    const phone=normalizePhone(input&&input.value||row.p||'');
    if(!phone||phone.length<9||phone.length>11){
      toast('전화번호 전체를 숫자로 입력해주세요','err');
      if(input) input.focus();
      return;
    }
    const keys=[...new Set(targets.map(target=>target&&target.key).filter(Boolean))];
    if(!keys.length){
      toast('수정할 저장 위치를 찾지 못했습니다','err');
      return;
    }
    const originalLabel=button&&button.textContent;
    if(button){
      button.disabled=true;
      button.textContent='저장 중';
    }
    let changedCount=0;
    try{
      const res=await branchRoot(activeBranch).transactionKeys(keys,root=>{
        root=root||{};
        let localChanged=0;
        targets.forEach(target=>{
          if(!target||!target.key||!target.slotKey) return;
          const current=parseStored(root[target.key]);
          if(target.kind==='student'){
            const list=Array.isArray(current)?current:[];
            let targetChanged=0;
            list.forEach(stu=>{
              if(studentSlotKey(stu)!==target.slotKey) return;
              if(!studentPhoneTargetMatches(stu,target)) return;
              if(setEntryPhone(stu,phone)) targetChanged++;
            });
            if(targetChanged){
              localChanged+=targetChanged;
              root[target.key]=JSON.stringify(list);
            }
            return;
          }
          if(target.kind==='enroll'){
            const map=current&&typeof current==='object'&&!Array.isArray(current)?current:{};
            const added=saveStudentPhoneForTargetMap(map,target,phone);
            if(added){
              localChanged+=added;
              root[target.key]=JSON.stringify(map);
            }
          }
        });
        if(!localChanged) return;
        changedCount=localChanged;
        return root;
      });
      if(!res||!res.committed||!changedCount){
        toast('이미 번호가 있거나 대상 원생을 찾지 못했습니다','err');
        return;
      }
      delete studentDirectoryByBranch[activeBranch];
      await loadStudentDirectory(true);
      toast(`전화번호 ${changedCount}칸 저장 완료`,'ok');
    }catch(e){
      console.error(e);
      toast(e.message||'전화번호 저장 실패','err');
    }finally{
      if(button){
        button.disabled=false;
        button.textContent=originalLabel||'저장';
      }
    }
  }
  function renderStudentDirectory(){
    const dir=currentStudentDirectory();
    renderStudentTeacherOptions(dir);
    const rows=filteredStudentRows();
    const totalEl=$('students-total-count');
    const classHoursEl=$('students-class-hours');
    const bangteukHoursEl=$('students-bangteuk-hours');
    const avgEl=$('students-average-hours');
    const retireEl=$('students-retire-count');
    const netEl=$('students-net-count');
    const bangteukEl=$('students-bangteuk-count');
    const missingPhoneEl=$('students-missing-phone-count');
    if(totalEl) totalEl.textContent=String(dir.total||0);
    if(classHoursEl) classHoursEl.textContent=String(dir.regularClassHours??dir.classHours??0);
    if(bangteukHoursEl) bangteukHoursEl.textContent=String(dir.bangteukClassHours||0);
    if(avgEl) avgEl.textContent=(Number(dir.averageHours||0)).toFixed(1);
    if(retireEl) retireEl.textContent=String(dir.retire||0);
    if(netEl) netEl.textContent=String(dir.counted||0);
    if(bangteukEl) bangteukEl.textContent=String(dir.bangteuk||0);
    if(missingPhoneEl) missingPhoneEl.textContent=String(dir.missingPhone||0);
    const hiddenWarning=$('students-hidden-warning');
    if(hiddenWarning){
      const hidden=Number(dir.hidden||0);
      hiddenWarning.hidden=!hidden;
      hiddenWarning.innerHTML=hidden
        ? `토요일 시간표 밖 숨김후보 <strong>${hidden}</strong>명이 있습니다. 실제 원생수/시수 집계에서는 제외했고, 상태 필터에서 <strong>숨김후보</strong>로 확인할 수 있습니다.`
        : '';
    }
    const body=$('students-list-body');
    if(!body) return;
    if(dir.error){
      body.innerHTML=`<tr><td colspan="5" class="student-empty">원생목록 로드 실패<br>${esc(dir.error)}</td></tr>`;
      return;
    }
    if(!rows.length){
      body.innerHTML='<tr><td colspan="5" class="student-empty">표시할 원생이 없습니다.</td></tr>';
      return;
    }
    body.innerHTML=rows.map(row=>{
      const pillHtml=[
        row.countedCount?`<span class="student-pill counted">포함 ${row.countedCount}</span>`:'',
        row.moveCount?`<span class="student-pill move">제외 ${row.moveCount}</span>`:'',
        row.retireCount?`<span class="student-pill excluded">퇴원 ${row.retireCount}</span>`:'',
        row.bangteukCount?`<span class="student-pill bangteuk">방특 ${row.bangteukCount}</span>`:'',
        row.hiddenCount?`<span class="student-pill hidden">숨김 ${row.hiddenCount}</span>`:'',
      ].filter(Boolean).join('');
      const memberHtml=(row.members||[]).map(member=>{
        const slotBits=[...new Set((member.slots||[]).map(slot=>slot.badge).filter(Boolean))]
          .map(badge=>`<span class="student-inline-slot">${esc(badge)}</span>`).join('');
        const dates=[...(member.dates||[])].map(date=>`<span class="student-date-chip">${esc(date)}</span>`).join('');
        return `<div class="student-member-line"><strong>${esc(member.n||'')}</strong>${slotBits}<span class="student-state ${studentStatusClass(member.statusKey)}">${esc(member.status||'')}</span>${dates}</div>`;
      }).join('');
      const teacherNames=studentRowTeachers(row);
      const teacherHtml=teacherNames.map(name=>`<span class="student-teacher-chip">${esc(name)}쌤</span>`).join('');
      const slotBadges=studentRowSlotBadges(row);
      const slotHtml=slotBadges.map(badge=>`<span class="student-slot-chip"><b>${esc(badge)}</b></span>`).join('');
      return `<tr>
        <td><div class="student-pill-stack">${pillHtml||'<span class="student-pill excluded">제외</span>'}</div></td>
        <td>${studentPhoneCell(row)}</td>
        <td><div class="student-member-list">${memberHtml}</div></td>
        <td><span class="student-teacher-chip-row">${teacherHtml||'<span class="student-muted">-</span>'}</span></td>
        <td class="student-slot-list"><span class="student-slot-chip-row">${slotHtml||'<span class="student-muted">-</span>'}</span></td>
      </tr>`;
    }).join('');
  }
  function addStudentExcelValue(set,value){
    const text=String(value||'').trim();
    if(text&&text!=='-') set.add(text);
  }
  function studentDirectoryExcelRows(){
    const rows=filteredStudentRows();
    const grouped=new Map();
    rows.forEach((row,rowIndex)=>{
      (row.members||[]).forEach((member,memberIndex)=>{
        const name=String(member.n||'').trim();
        const phone=normalizePhone(row.p||'');
        const key=(name||phone) ? `${name}|${phone}` : `unknown|${rowIndex}|${memberIndex}`;
        if(!grouped.has(key)){
          grouped.set(key,{
            name:name,
            age:member.a||'',
            phone:row.p||'',
            teachers:new Set(),
            classes:new Set(),
            statuses:new Set(),
            dates:new Set(),
          });
        }
        const item=grouped.get(key);
        if(!item.age&&member.a) item.age=member.a;
        if(!item.phone&&row.p) item.phone=row.p;
        const slots=(member.slots&&member.slots.length)?member.slots:[null];
        slots.forEach(slot=>{
          if(slot){
            addStudentExcelValue(item.teachers,slot.teacher);
            addStudentExcelValue(item.classes,slot.badge);
            addStudentExcelValue(item.dates,slot.date);
          }
        });
        addStudentExcelValue(item.statuses,member.status);
        (member.dates||[]).forEach(date=>addStudentExcelValue(item.dates,date));
      });
    });
    return [...grouped.values()].map(item=>({
      name:item.name,
      age:item.age,
      phone:item.phone,
      teacher:[...item.teachers].join(' / '),
      className:[...item.classes].join(' / '),
      status:[...item.statuses].join(' / '),
      date:[...item.dates].join(' / '),
    })).sort((a,b)=>
      String(a.name).localeCompare(String(b.name),'ko') ||
      String(a.phone).localeCompare(String(b.phone),'ko')
    );
  }
  function excelText(value){
    const text=String(value??'');
    return /^[=+\-@]/.test(text.trim()) ? "'"+text : text;
  }
  function excelCell(value){
    return `<td style="mso-number-format:'\\@';">${esc(excelText(value))}</td>`;
  }
  function downloadStudentDirectoryExcel(){
    const rows=studentDirectoryExcelRows();
    if(!rows.length){
      toast('다운로드할 원생이 없습니다','err');
      return;
    }
    const headers=['원생이름','나이','전화번호','선생님','반','상태','적용일'];
    const table=`<table>
      <thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(row=>`<tr>
        ${excelCell(row.name)}
        ${excelCell(row.age)}
        ${excelCell(row.phone)}
        ${excelCell(row.teacher)}
        ${excelCell(row.className)}
        ${excelCell(row.status)}
        ${excelCell(row.date)}
      </tr>`).join('')}</tbody>
    </table>`;
    const html=`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body{font-family:"맑은 고딕",Arial,sans-serif}
table{border-collapse:collapse}
th,td{border:1px solid #888;padding:6px 8px;font-size:11pt;white-space:nowrap}
th{background:#D9EAD3;font-weight:700}
</style>
</head>
<body>${table}</body>
</html>`;
    const blob=new Blob(['\ufeff'+html],{type:'application/vnd.ms-excel;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=`${activeBranch}_students_${new Date().toISOString().slice(0,10)}.xls`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function reloadFeedback(silent){
    try{
      const snap=await branchRoot(activeBranch).child(FEEDBACK_KEY).once('value');
      feedbackByBranch[activeBranch]=normalizeFeedbackList(parseStored(snap.val()));
      renderFeedback();
      updateFeedbackBadges();
      if(!silent) toast('의견접수 새로고침 완료','ok');
    }catch(e){
      console.error(e);
      if(!silent) toast('의견접수 로드 실패','err');
    }
  }
  async function updateFeedbackStatus(id,status){
    if(window.SCAuth && !SCAuth.requirePermission('manageSettings','의견접수 상태 변경')) return;
    id=String(id||'');
    if(!id) return;
    status=status==='done'?'done':'new';
    try{
      const res=await branchRoot(activeBranch).child(FEEDBACK_KEY).transaction(raw=>{
        const list=normalizeFeedbackList(parseStored(raw));
        const found=list.find(item=>String(item.id||'')===id);
        if(!found) return raw;
        found.status=status;
        found.checkedAt=status==='done' ? new Date().toISOString() : '';
        return JSON.stringify(list);
      });
      feedbackByBranch[activeBranch]=normalizeFeedbackList(parseStored(res.snapshot.val()));
      renderFeedback();
      updateFeedbackBadges();
      toast(status==='done'?'확인완료 처리했습니다':'새 접수로 되돌렸습니다','ok');
    }catch(e){
      console.error(e);
      toast('의견 상태 변경 실패','err');
    }
  }
  async function markAllFeedbackDone(){
    if(window.SCAuth && !SCAuth.requirePermission('manageSettings','의견접수 전체 확인')) return;
    const count=feedbackNewCount(activeBranch);
    if(!count){
      toast('새 접수 의견이 없습니다');
      return;
    }
    if(!confirm(`새 접수 ${count}건을 모두 확인완료로 바꿀까요?`)) return;
    try{
      const checkedAt=new Date().toISOString();
      const res=await branchRoot(activeBranch).child(FEEDBACK_KEY).transaction(raw=>{
        const list=normalizeFeedbackList(parseStored(raw));
        list.forEach(item=>{
          if(isNewFeedback(item)){
            item.status='done';
            item.checkedAt=checkedAt;
          }
        });
        return JSON.stringify(list);
      });
      feedbackByBranch[activeBranch]=normalizeFeedbackList(parseStored(res.snapshot.val()));
      renderFeedback();
      updateFeedbackBadges();
      toast('전체 확인완료 처리했습니다','ok');
    }catch(e){
      console.error(e);
      toast('전체 확인 처리 실패','err');
    }
  }
  function bindEvents(){
    document.querySelectorAll('.nav-btn').forEach(btn=>{
      btn.addEventListener('click',()=>setPanel(btn.dataset.panel));
    });
    document.querySelectorAll('[data-panel-jump]').forEach(btn=>{
      btn.addEventListener('click',()=>setPanel(btn.dataset.panelJump));
    });
    document.querySelectorAll('[data-open-action]').forEach(btn=>{
      btn.addEventListener('click',()=>openAction(btn.dataset.openAction));
    });
    document.querySelectorAll('[data-copy-link]').forEach(btn=>{
      btn.addEventListener('click',()=>copyLink(btn.dataset.copyLink));
    });
    $('recipients-save').addEventListener('click',()=>saveSettings('recipients'));
    $('templates-save').addEventListener('click',()=>saveSettings('templates'));
    $('aligo-save').addEventListener('click',()=>saveSettings('aligo'));
    $('sms-save').addEventListener('click',()=>saveSettings('sms'));
    $('recipients-reset').addEventListener('click',()=>resetForm('recipients'));
    $('templates-reset').addEventListener('click',()=>resetForm('templates'));
    $('aligo-reset').addEventListener('click',()=>resetForm('aligo'));
    $('sms-reset').addEventListener('click',()=>resetForm('sms'));
    $('aligo-health').addEventListener('click',e=>runProxyTest('aligo','health',e.currentTarget));
    $('aligo-remain').addEventListener('click',e=>runProxyTest('aligo','remain',e.currentTarget));
    $('aligo-save-test').addEventListener('click',()=>saveSettings('aligo'));
    $('aligo-send-test').addEventListener('click',e=>runAlimtalkSend(e.currentTarget,false));
    $('aligo-send-live').addEventListener('click',e=>runAlimtalkSend(e.currentTarget,true));
    $('aligo-test-template').addEventListener('change',e=>applyTestTemplate(e.currentTarget.value,true));
    $('sms-health').addEventListener('click',e=>runProxyTest('sms','health',e.currentTarget));
    $('sms-remain').addEventListener('click',e=>runProxyTest('sms','remain',e.currentTarget));
    $('backup-current')?.addEventListener('click',e=>runBackup('current',e.currentTarget));
    $('backup-all')?.addEventListener('click',e=>runBackup('all',e.currentTarget));
    $('summer-layout-check')?.addEventListener('click',e=>checkSummerLayout(e.currentTarget));
    $('summer-layout-apply')?.addEventListener('click',e=>applySummerLayout(e.currentTarget));
    $('students-refresh')?.addEventListener('click',()=>loadStudentDirectory(true));
    $('students-excel')?.addEventListener('click',downloadStudentDirectoryExcel);
    $('students-search')?.addEventListener('input',renderStudentDirectory);
    $('students-teacher-filter')?.addEventListener('change',renderStudentDirectory);
    $('students-status-filter')?.addEventListener('change',renderStudentDirectory);
    $('students-sort')?.addEventListener('change',renderStudentDirectory);
    $('students-list-body')?.addEventListener('click',e=>{
      const btn=e.target.closest('[data-student-phone-save]');
      if(!btn) return;
      saveStudentPhone(btn.dataset.studentPhoneSave);
    });
    $('students-list-body')?.addEventListener('keydown',e=>{
      const input=e.target.closest('[data-student-phone-input]');
      if(!input||e.key!=='Enter') return;
      e.preventDefault();
      saveStudentPhone(input.dataset.studentPhoneInput);
    });
    $('feedback-refresh').addEventListener('click',()=>reloadFeedback(false));
    $('feedback-mark-all').addEventListener('click',markAllFeedbackDone);
    $('feedback-list').addEventListener('click',e=>{
      const btn=e.target.closest('[data-feedback-action]');
      if(!btn) return;
      if(btn.dataset.feedbackAction==='status'){
        updateFeedbackStatus(btn.dataset.feedbackId,btn.dataset.feedbackStatus);
      }
    });
  }
  function initialBranch(){
    try{
      const p=new URLSearchParams(location.search).get('branch');
      if(BRANCHES[p]&&canAccessBranch(p)) return p;
      const saved=localStorage.getItem('selected_branch');
      if(BRANCHES[saved]&&canAccessBranch(saved)) return saved;
    }catch(e){}
    return canAccessBranch('gagyeong')?'gagyeong':'yongam';
  }
  function initialPanel(){
    try{
      const p=new URLSearchParams(location.search).get('panel');
      if(PANEL_META[p]) return p;
    }catch(e){}
    const hash=String(location.hash||'').replace('#','');
    return PANEL_META[hash]?hash:'menu';
  }
  document.addEventListener('DOMContentLoaded',()=>{
    const authReady=window.SCAuth&&typeof SCAuth.requireAuth==='function'
      ? SCAuth.requireAuth()
      : Promise.resolve();
    authReady.then(()=>{
      bindEvents();
      activePanel=initialPanel();
      setPanel(activePanel);
      activeBranch=initialBranch();
      setBranch(activeBranch);
      setInterval(()=>reloadFeedback(true),60000);
      if(window.SCAuth&&typeof SCAuth.applyPagePermissions==='function'){
        SCAuth.applyPagePermissions(document);
      }
      setPermissionStates();
    });
  });
})();
