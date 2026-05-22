(function(){
  const SETTINGS_KEY='swim_aligo_settings';
  const TEACHERS_KEY='swim_teachers';
  const PUBLIC_BASE_URL='https://schedule.adminsuperchild.cloud';
  const BRANCHES={
    gagyeong:{id:'gagyeong',name:'가경점',fbPath:'schedule'},
    yongam:{id:'yongam',name:'용암점',fbPath:'schedule_yongam'},
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
    {id:'parent_absent_cancel',title:'학부모 - 결석취소',target:'학부모',subtitle:'슈퍼차일드 #{지점명}',main:'#{학생명} 어린이 결석취소 완료',body:'[슈퍼차일드 #{지점명}]\n#{학생명} 어린이 #{수업일} #{요일} #{수업시간} #{담당선생님} 선생님 수업\n\n*결석 요청이 취소되었습니다.',buttonName:'결석/보강 조회하기',link:'https://schedule.adminsuperchild.cloud/parent.html'},
    {id:'parent_makeup_pending',title:'학부모 - 보강접수',target:'학부모',subtitle:'슈퍼차일드 #{지점명}',main:'#{학생명} 어린이 보강 대기 상태입니다.',body:'[슈퍼차일드 #{지점명}]\n#{학생명} 어린이\n\n*보강 접수 대기 상태입니다.\n*선생님이 보강 요청을 확인 후 확정 도와드리겠습니다.\n*확정/보류 처리 시 알림톡이 발송됩니다.',buttonName:'보강 조회하기',link:'https://schedule.adminsuperchild.cloud/parent.html'},
    {id:'parent_makeup_cancelled',title:'학부모 - 보강취소',target:'학부모',subtitle:'슈퍼차일드 #{지점명}',main:'#{학생명} 어린이 보강 취소 완료입니다.',body:'[슈퍼차일드 #{지점명}]\n*#{학생명} 어린이\n*보강요청이 취소되었습니다.',buttonName:'결석/보강 조회하기',link:'https://schedule.adminsuperchild.cloud/parent.html'},
    {id:'parent_makeup_accepted',title:'학부모 - 보강완료',target:'학부모',subtitle:'슈퍼차일드 #{지점명}',main:'#{학생명} 어린이 보강수업이 확정되었습니다.',body:'[슈퍼차일드 #{지점명}]\n#{학생명} 어린이 #{수업일} #{요일} #{수업시간} #{담당선생님} 선생님 수업\n\n*보강수업이 확정되었습니다.\n\n보강수업 결석 시 자동 소진됩니다.\n수업시간 10분 전 방문 부탁드립니다.',buttonName:'결석/보강 조회하기',link:'https://schedule.adminsuperchild.cloud/parent.html'},
    {id:'staff_absent_done',title:'선생님, 데스크 - 결석완료',target:'선생님/데스크',subtitle:'슈퍼차일드 #{지점명}',main:'#{학생명} 결석 신청 접수',body:'[슈퍼차일드 #{지점명}]\n*#{학생명} 어린이\n*#{수업일} #{요일} #{수업시간} #{담당선생님} 선생님 수업\n*결석입니다.',buttonName:'',link:''},
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

  let activeBranch='gagyeong';
  let activePanel='menu';
  let settingsByBranch={};
  let teacherNamesByBranch={};
  let rootByBranch={};

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
  function defaultRecipients(){
    const fixed={};
    FIXED_RECIPIENTS.forEach(item=>{
      fixed[item.key]={label:item.label,phone:'',enabled:true,memo:item.memo};
    });
    return {teachers:{},fixed};
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
        userid:'',
        apiKeyEnv:'ALIGO_KEY',
        senderKey:'',
        sender:'',
        remainPath:'/remain/',
        sendPath:'/alimtalk/send/',
        templateCode:'',
        testReceiver:'',
        testRecvName:'',
        testSubject:'',
        testMessage:'',
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
    }catch(e){
      console.error(e);
      settingsByBranch[branchId]=base;
      teacherNamesByBranch[branchId]=clone(DEFAULT_TEACHERS[branchId]||[]);
      toast('설정 로드 실패','err');
    }
    renderAll();
  }
  async function saveSettings(kind){
    if(window.SCAuth && !SCAuth.requirePermission('manageSettings','설정 저장')) return;
    const data=collectCurrentSettings(kind);
    const user=window.SCAuth&&SCAuth.currentUser&&SCAuth.currentUser();
    data.updatedAt=new Date().toISOString();
    data.updatedBy=user&&user.email||'';
    settingsByBranch[activeBranch]=data;
    try{
      await branchRoot(activeBranch).child(SETTINGS_KEY).set(JSON.stringify(data));
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
    activePanel=panel||'menu';
    document.querySelectorAll('.nav-btn').forEach(btn=>{
      btn.classList.toggle('active',btn.dataset.panel===activePanel);
    });
    document.querySelectorAll('.settings-panel').forEach(panelEl=>{
      panelEl.classList.toggle('active',panelEl.id==='panel-'+activePanel);
    });
  }
  function setBranch(branchId){
    if(!BRANCHES[branchId]||!canAccessBranch(branchId)) return;
    activeBranch=branchId;
    try{localStorage.setItem('selected_branch',branchId);}catch(e){}
    document.querySelectorAll('.branch-tab').forEach(btn=>{
      btn.classList.toggle('active',btn.dataset.branch===activeBranch);
      btn.disabled=!canAccessBranch(btn.dataset.branch);
    });
    $('settings-branch-title').textContent=BRANCHES[activeBranch].name;
    if(settingsByBranch[activeBranch]&&teacherNamesByBranch[activeBranch]) renderAll();
    else loadBranchBundle(activeBranch);
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
    renderVariableGuide();
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
          <input type="text" data-field="subtitle" value="${escAttr(tpl.subtitle||'')}" placeholder="서브텍스트">
          <input type="text" data-field="main" value="${escAttr(tpl.main||'')}" placeholder="메인텍스트">
        </td>
        <td><textarea data-field="body" rows="5">${esc(tpl.body||'')}</textarea></td>
        <td>
          <input type="text" data-field="buttonName" value="${escAttr(tpl.buttonName||'')}" placeholder="버튼명">
          <input type="text" data-field="link" value="${escAttr(tpl.link||'')}" placeholder="링크">
        </td>
      </tr>`;
    }).join('');
  }
  function renderAligo(data){
    const a=data.aligo||defaultSettings(activeBranch).aligo;
    setChecked('aligo-enabled',a.enabled);
    setChecked('aligo-test-mode',a.testMode);
    setValue('aligo-proxy-url',a.proxyUrl);
    setValue('aligo-userid',a.userid);
    setValue('aligo-api-key-env',a.apiKeyEnv);
    setValue('aligo-sender-key',a.senderKey);
    setValue('aligo-sender',a.sender);
    setValue('aligo-remain-path',a.remainPath);
    setValue('aligo-send-path',a.sendPath);
    setValue('aligo-template-code',a.templateCode);
    setValue('aligo-test-receiver',a.testReceiver);
    setValue('aligo-test-recvname',a.testRecvName);
    setValue('aligo-test-subject',a.testSubject);
    setValue('aligo-test-message',a.testMessage);
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
        main:row.querySelector('[data-field="main"]')?.value.trim()||'',
        body:row.querySelector('[data-field="body"]')?.value||'',
        buttonName:row.querySelector('[data-field="buttonName"]')?.value.trim()||'',
        link:row.querySelector('[data-field="link"]')?.value.trim()||'',
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
        userid:$('aligo-userid').value.trim(),
        apiKeyEnv:$('aligo-api-key-env').value.trim()||'ALIGO_KEY',
        senderKey:$('aligo-sender-key').value.trim(),
        sender:$('aligo-sender').value.trim(),
        remainPath:$('aligo-remain-path').value.trim()||'/remain/',
        sendPath:$('aligo-send-path').value.trim()||'/alimtalk/send/',
        templateCode:$('aligo-template-code').value.trim(),
        testReceiver:normalizePhone($('aligo-test-receiver').value),
        testRecvName:$('aligo-test-recvname').value.trim(),
        testSubject:$('aligo-test-subject').value.trim(),
        testMessage:$('aligo-test-message').value.trim(),
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
    const cleanBase=String(base||'/aligo').trim()||'/aligo';
    const cleanPath=String(path||'').trim();
    if(!cleanPath) return cleanBase;
    return cleanBase.replace(/\/+$/,'')+'/'+cleanPath.replace(/^\/+/,'');
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
      userid:$('aligo-userid').value.trim(),
      sender:$('aligo-sender').value.trim(),
      senderKey:$('aligo-sender-key').value.trim(),
      templateCode:$('aligo-template-code').value.trim(),
      testReceiver:normalizePhone($('aligo-test-receiver').value),
      testRecvName:$('aligo-test-recvname').value.trim(),
      testSubject:$('aligo-test-subject').value.trim(),
      testMessage:$('aligo-test-message').value.trim(),
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
    if(cfg.userid) body.set('user_id',cfg.userid);
    if(cfg.sender) body.set('sender',cfg.sender);
    if(cfg.senderKey) body.set('senderkey',cfg.senderKey);
    const label=button&&button.textContent;
    if(button){
      button.disabled=true;
      button.textContent='확인 중';
    }
    try{
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
    if(!cfg.senderKey) missing.push('발신 프로파일 키');
    if(!cfg.sender) missing.push('발신번호');
    if(!cfg.templateCode) missing.push('템플릿 코드');
    if(!cfg.testReceiver) missing.push('테스트 수신번호');
    if(!cfg.testSubject) missing.push('알림톡 제목');
    if(!cfg.testMessage) missing.push('알림톡 내용');
    if(missing.length) throw new Error(missing.join(', ')+' 입력이 필요합니다');
  }
  async function runAlimtalkSendTest(button){
    const cfg=testConfig('aligo');
    try{
      validateAlimtalkTest(cfg);
    }catch(e){
      showTestResult(cfg.resultId,false,'알림톡 테스트 발송 준비 실패',{message:e.message});
      toast('필수값을 확인해주세요','err');
      return;
    }
    if(!window.confirm('테스트 알림톡 1건을 발송할까요?')) return;
    const url=joinProxyUrl(cfg.proxyUrl,cfg.sendPath);
    const body=new URLSearchParams();
    body.set('senderkey',cfg.senderKey);
    body.set('tpl_code',cfg.templateCode);
    body.set('sender',normalizePhone(cfg.sender));
    body.set('receiver_1',cfg.testReceiver);
    if(cfg.testRecvName) body.set('recvname_1',cfg.testRecvName);
    body.set('subject_1',cfg.testSubject);
    body.set('message_1',cfg.testMessage);
    body.set('testMode',cfg.testMode?'Y':'N');
    body.set('failover','N');
    const label=button&&button.textContent;
    if(button){
      button.disabled=true;
      button.textContent='발송 중';
    }
    try{
      const res=await fetch(url,{
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
        body,
      });
      const data=await readTestResponse(res);
      showTestResult(cfg.resultId,true,`알림톡 테스트 발송 응답: ${url}`,data);
      toast('알림톡 테스트 발송 요청 완료','ok');
    }catch(e){
      showTestResult(cfg.resultId,false,`알림톡 테스트 발송 실패: ${url}`,{
        status:e.status||'',
        message:e.message||String(e),
        body:e.body||null,
      });
      toast('알림톡 테스트 발송 실패','err');
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
    return `index.html?branch=${activeBranch}&settings=${action}`;
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
  function bindEvents(){
    document.querySelectorAll('.nav-btn').forEach(btn=>{
      btn.addEventListener('click',()=>setPanel(btn.dataset.panel));
    });
    document.querySelectorAll('[data-panel-jump]').forEach(btn=>{
      btn.addEventListener('click',()=>setPanel(btn.dataset.panelJump));
    });
    document.querySelectorAll('.branch-tab').forEach(btn=>{
      btn.addEventListener('click',()=>setBranch(btn.dataset.branch));
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
    $('aligo-send-test').addEventListener('click',e=>runAlimtalkSendTest(e.currentTarget));
    $('sms-health').addEventListener('click',e=>runProxyTest('sms','health',e.currentTarget));
    $('sms-remain').addEventListener('click',e=>runProxyTest('sms','remain',e.currentTarget));
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
      if(p==='recipients'||p==='templates'||p==='aligo'||p==='sms'||p==='menu') return p;
    }catch(e){}
    const hash=String(location.hash||'').replace('#','');
    return hash==='recipients'||hash==='templates'||hash==='aligo'||hash==='sms'?hash:'menu';
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
      document.querySelectorAll('.branch-tab').forEach(btn=>{
        btn.disabled=!canAccessBranch(btn.dataset.branch);
      });
      setBranch(activeBranch);
      if(window.SCAuth&&typeof SCAuth.applyPagePermissions==='function'){
        SCAuth.applyPagePermissions(document);
      }
      setPermissionStates();
    });
  });
})();
