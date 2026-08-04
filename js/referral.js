(function(){
  'use strict';

  const SETTINGS_KEY='swim_aligo_settings';
  const TAB_LIST_KEY='swim_tab_list';
  const MAIN_TAB_KEY='swim_main_tab';
  const LEGACY_TEMPLATE_ID='parent_referral_stamp';
  const TEMPLATE_ID_PREFIX='parent_referral_stamp_';
  const MAX_STAMPS=10;
  const BRANCHES={
    gagyeong:{id:'gagyeong',name:'가경점',fbPath:'schedule',aligoBranch:'가경동'},
    yongam:{id:'yongam',name:'용암점',fbPath:'schedule_yongam',aligoBranch:'용암점'},
  };
  const DEFAULT_TEMPLATE={
    id:TEMPLATE_ID_PREFIX+'1',
    title:'원생 - 친구추천 적립/현황',
    enabled:true,
    code:'',
    emtitle:'#{원생명} 어린이 친구추천 #{알림유형} 안내',
    main:'#{원생명} 어린이 친구추천 #{알림유형} 안내',
    body:'[슈퍼차일드 #{지점명}]\n#{원생명} 어린이 친구추천 #{알림유형} 안내입니다.\n\n#{도장표시} (#{현재도장}/10)\n총 누적 #{누적도장}개\n\n#{혜택안내}',
    buttonName:'',
    linkM:'',
    linkP:'',
    link:'',
  };
  function referralTemplateId(count){
    const value=Math.max(1,Math.min(MAX_STAMPS,Number(count)||1));
    return TEMPLATE_ID_PREFIX+value;
  }
  function defaultReferralTemplate(count){
    const value=Math.max(1,Math.min(MAX_STAMPS,Number(count)||1));
    const benefit=value===5?'1개월 수업 무료':value===10?'2개월 수업 무료':value>=6?'수강료 2만원 할인':'수강료 1만원 할인';
    const dots='●'.repeat(value)+'○'.repeat(MAX_STAMPS-value);
    return Object.assign({},DEFAULT_TEMPLATE,{
      id:referralTemplateId(value),
      title:`친구추천 - ${value}개 적립`,
      emtitle:`#{원생명} 어린이 친구추천 ${value}개 적립 안내`,
      main:`#{원생명} 어린이 친구추천 ${value}개 적립 안내`,
      body:`[슈퍼차일드 #{지점명}]\n#{원생명} 어린이 친구추천 적립 안내입니다.\n\n${dots} (${value}/10)\n총 누적 #{누적도장}개\n\n현재 혜택: ${benefit}`,
    });
  }

  const state={
    branchId:'gagyeong',
    db:null,
    root:null,
    directory:[],
    directoryLoaded:false,
    selectedStudentKey:'',
    phone:'',
    familyId:'',
    family:null,
    logs:[],
    settings:null,
    familyUnsubscribe:null,
    logsUnsubscribe:null,
    recentUnsubscribe:null,
  };

  function $(id){return document.getElementById(id);}
  function esc(value){
    return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function escAttr(value){return esc(value).replace(/`/g,'&#96;');}
  function parseStored(value,fallback){
    if(value===undefined||value===null||value==='') return fallback;
    if(typeof value!=='string') return value;
    try{return JSON.parse(value);}catch(e){return fallback;}
  }
  function normalizePhone(value){return String(value||'').replace(/\D/g,'');}
  function formatPhone(value){
    const phone=normalizePhone(value);
    if(phone.length===11) return phone.slice(0,3)+'-'+phone.slice(3,7)+'-'+phone.slice(7);
    if(phone.length===10) return phone.slice(0,3)+'-'+phone.slice(3,6)+'-'+phone.slice(6);
    return phone;
  }
  function cleanStudentName(value){return String(value||'').trim().replace(/^[*＊]+\s*/,'').trim();}
  function currentDate(){
    const d=new Date();
    const p=n=>String(n).padStart(2,'0');
    return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
  }
  function normalizeTabs(raw){
    const tabs=Array.isArray(raw)?raw:[];
    const active=tabs.filter(tab=>tab&&tab.type!=='snapshot'&&tab.archived!==true);
    return active.length?active:[{id:'regular',name:'정규시간표',type:'regular'}];
  }
  function selectDirectoryTabs(rawTabs,mainSetting,today){
    const tabs=normalizeTabs(rawTabs);
    const main=mainSetting&&typeof mainSetting==='object'?mainSetting:{};
    const regular=tabs.filter(tab=>tab.type!=='bangteuk');
    const regularMain=regular.find(tab=>tab.id===main.tabId)
      ||regular.find(tab=>tab.id==='regular')
      ||regular[0];
    const selected=regularMain?[regularMain]:[];
    const date=today||currentDate();
    let seasonal=tabs.filter(tab=>tab.type==='bangteuk'&&tab.seasonStart&&tab.seasonEnd&&tab.seasonStart<=date&&tab.seasonEnd>=date);
    if(!seasonal.length){
      const latest=tabs.filter(tab=>tab.type==='bangteuk').sort((a,b)=>String(b.seasonStart||'').localeCompare(String(a.seasonStart||'')))[0];
      if(latest) seasonal=[latest];
    }
    seasonal.forEach(tab=>{if(!selected.some(item=>item.id===tab.id)) selected.push(tab);});
    return selected;
  }
  function studentKeyForTab(tab){
    const id=String(tab&&tab.id||'regular');
    if(tab&&tab.type==='bangteuk') return 'swim_bt_'+id+'_stu';
    return id==='regular'?'swim_students':'swim_stu_'+id;
  }
  function isTemporaryStudent(student){
    if(!student||typeof student!=='object') return true;
    if(student.bogangOnly||student.makeupOnly||student.sampleOnly) return true;
    const kind=String(student.type||student.kind||student.status||'').trim().toLowerCase();
    return ['bogang','makeup','보강','sample','샘플'].includes(kind);
  }
  function directoryRows(tab,students){
    const courseType=tab&&tab.type==='bangteuk'?'bangteuk':'regular';
    const map=new Map();
    (Array.isArray(students)?students:[]).forEach((student,index)=>{
      if(!student||isTemporaryStudent(student)) return;
      const name=cleanStudentName(student.n||student.name);
      const phone=normalizePhone(student.p||student.phone||student.tel);
      if(!name||!phone) return;
      const sourceId=String(student.studentId||student.sid||student.uid||student.id||'').trim();
      const personKey=sourceId
        ? courseType+'|id:'+sourceId
        : courseType+'|person:'+name+'|'+phone;
      if(map.has(personKey)) return;
      map.set(personKey,{
        key:personKey,
        studentId:sourceId,
        name,
        phone,
        courseType,
        tabId:String(tab&&tab.id||'regular'),
        tabName:String(tab&&tab.name||(courseType==='bangteuk'?'방특':'정규')),
        sourceIndex:index,
      });
    });
    return [...map.values()];
  }
  function familyStudentName(family){
    const data=family&&typeof family==='object'?family:{};
    const linked=Array.isArray(data.linkedStudents)?data.linkedStudents:[];
    return cleanStudentName(data.studentName)
      ||cleanStudentName(linked[0]&&linked[0].name)
      ||cleanStudentName(data.parentName)
      ||'';
  }
  function searchDirectoryRows(directory,query,limit){
    const text=String(query||'').trim();
    if(!text) return [];
    const digits=normalizePhone(text);
    const phoneQuery=/^[\d\s-]+$/.test(text)&&digits.length>=3;
    const nameQuery=cleanStudentName(text).toLocaleLowerCase('ko-KR');
    const max=Math.max(1,Number(limit)||20);
    return (Array.isArray(directory)?directory:[])
      .filter(row=>phoneQuery
        ? normalizePhone(row&&row.phone).includes(digits)
        : cleanStudentName(row&&row.name).toLocaleLowerCase('ko-KR').includes(nameQuery))
      .sort((a,b)=>{
        const aExact=phoneQuery?normalizePhone(a.phone)===digits:cleanStudentName(a.name).toLocaleLowerCase('ko-KR')===nameQuery;
        const bExact=phoneQuery?normalizePhone(b.phone)===digits:cleanStudentName(b.name).toLocaleLowerCase('ko-KR')===nameQuery;
        if(aExact!==bExact) return aExact?-1:1;
        return String(a.name||'').localeCompare(String(b.name||''),'ko');
      })
      .slice(0,max);
  }
  function stampTransition(family,type,value){
    const beforeCurrent=Math.max(0,Math.min(MAX_STAMPS,Number(family&&family.currentStamps)||0));
    const beforeTotal=Math.max(0,Number(family&&family.totalStamps)||0);
    const beforeCycle=Math.max(1,Number(family&&family.cycle)||1);
    let afterCurrent=beforeCurrent;
    let afterTotal=beforeTotal;
    let afterCycle=beforeCycle;
    let reset=false;
    if(type==='add'){
      if(beforeCurrent>=MAX_STAMPS){
        afterCurrent=1;
        afterCycle=beforeCycle+1;
        reset=true;
      }else afterCurrent=beforeCurrent+1;
      afterTotal=beforeTotal+1;
    }else if(type==='remove'){
      if(beforeCurrent<=0) throw new Error('차감할 적립이 없습니다');
      afterCurrent=beforeCurrent-1;
    }else if(type==='set'){
      const count=Number(value);
      if(!Number.isInteger(count)||count<0||count>MAX_STAMPS) throw new Error('적립 수는 0~10 사이 정수로 입력해주세요');
      if(count===beforeCurrent) throw new Error('현재 적립 수와 같습니다');
      afterCurrent=count;
    }else{
      throw new Error('지원하지 않는 적립 처리입니다');
    }
    return {beforeCurrent,beforeTotal,beforeCycle,afterCurrent,afterTotal,afterCycle,reset};
  }
  function normalizeAppliedStamps(value,maxStamp){
    const max=Math.max(0,Math.min(MAX_STAMPS,Number(maxStamp)||0));
    return [...new Set((Array.isArray(value)?value:[])
      .map(Number)
      .filter(number=>Number.isInteger(number)&&number>=1&&number<=max))]
      .sort((a,b)=>a-b);
  }
  function appliedStampsAfterTransition(family,transition){
    if(transition&&transition.reset) return [];
    return normalizeAppliedStamps(family&&family.appliedStamps,transition&&transition.afterCurrent);
  }
  function stampDisplay(count){
    const value=Math.max(0,Math.min(MAX_STAMPS,Number(count)||0));
    return '●'.repeat(value)+'○'.repeat(MAX_STAMPS-value);
  }
  function benefitLines(count){
    const value=Math.max(0,Math.min(MAX_STAMPS,Number(count)||0));
    const rows=[
      {min:1,max:4,text:'[1~4개] 수강료 1만원 할인'},
      {min:5,max:5,text:'[5개] 1개월 수업 무료'},
      {min:6,max:9,text:'[6~9개] 수강료 2만원 할인'},
      {min:10,max:10,text:'[10개] 2개월 수업 무료'},
    ];
    return rows.map(row=>(value>=row.min&&value<=row.max?'현재 혜택: ':'')+row.text).join('\n');
  }
  function renderTemplate(text,vars){
    return String(text||'').replace(/#\{([^}]+)\}/g,(all,name)=>{
      const value=vars[String(name||'').trim()];
      return value===undefined||value===null?'':String(value);
    });
  }
  async function hashedId(namespace,value){
    const normalized=String(value||'').trim();
    if(!normalized) throw new Error('식별값이 필요합니다');
    if(!window.crypto||!window.crypto.subtle) throw new Error('안전한 전화번호 검색을 지원하지 않는 브라우저입니다');
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(namespace+':'+normalized));
    return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
  }
  async function familyIdForPhone(phone){
    const normalized=normalizePhone(phone);
    if(!normalized) throw new Error('전화번호가 필요합니다');
    return hashedId('sc-referral-v1',normalized);
  }
  async function familyIdForStudent(student){
    const studentId=String(student&&student.studentId||'').trim();
    if(studentId) return hashedId('sc-referral-account-v2',studentId);
    return familyIdForPhone(student&&student.phone);
  }
  async function studentIndexId(studentId){
    return hashedId('sc-referral-student-index-v1',String(studentId||'').trim());
  }
  function accountLookupStudentIds(student,directory){
    const phone=normalizePhone(student&&student.phone);
    const selectedId=String(student&&student.studentId||'').trim();
    const ids=[];
    if(selectedId) ids.push(selectedId);
    (Array.isArray(directory)?directory:[]).forEach(row=>{
      const id=String(row&&row.studentId||'').trim();
      if(id&&phone&&normalizePhone(row.phone)===phone&&!ids.includes(id)) ids.push(id);
    });
    return ids;
  }
  function linkedStudentIds(linkedStudents){
    return [...new Set((Array.isArray(linkedStudents)?linkedStudents:[])
      .map(item=>String(item&&item.studentId||'').trim())
      .filter(Boolean))];
  }
  function branchInfo(){return BRANCHES[state.branchId]||BRANCHES.gagyeong;}
  function actor(){
    const user=window.SCAuth&&SCAuth.currentUser&&SCAuth.currentUser();
    const profile=window.SCAuth&&SCAuth.profile&&SCAuth.profile();
    return {
      uid:String(user&&user.uid||''),
      email:String(user&&user.email||''),
      name:String(profile&&(profile.name||profile.teacherName)||user&&user.email||''),
    };
  }
  function serverTimestamp(){return firebase.firestore.FieldValue.serverTimestamp();}
  function familyCollection(){return state.db.collection('referralPrograms').doc(state.branchId).collection('families');}
  function familyRef(){return familyCollection().doc(state.familyId);}
  function logsCollection(){return familyRef().collection('logs');}
  function studentIndexCollection(){return state.db.collection('referralPrograms').doc(state.branchId).collection('studentAccounts');}
  async function resolveFamilyId(student){
    const phone=normalizePhone(student&&student.phone);
    const studentIds=accountLookupStudentIds(student,state.directory);
    if(studentIds.length){
      const indexIds=await Promise.all(studentIds.map(studentIndexId));
      const snapshots=await Promise.all(indexIds.map(id=>studentIndexCollection().doc(id).get()));
      const familyIds=[...new Set(snapshots.filter(doc=>doc.exists).map(doc=>String((doc.data()||{}).familyId||'')).filter(Boolean))];
      if(familyIds.length>1) throw new Error('형제 원생의 기존 적립계정이 여러 개입니다. 계정 병합이 필요합니다');
      if(familyIds.length===1) return familyIds[0];
    }
    if(phone){
      const phoneFamilyId=await resolveFamilyIdByPhone(phone);
      if(phoneFamilyId) return phoneFamilyId;
    }
    return familyIdForStudent(student);
  }
  async function resolveFamilyIdByPhone(phone){
    const normalized=normalizePhone(phone);
    if(!normalized) return '';
    const legacyId=await familyIdForPhone(normalized);
    const legacyDoc=await familyCollection().doc(legacyId).get();
    if(legacyDoc.exists) return legacyId;
    const matches=await familyCollection().where('phone','==',normalized).limit(2).get();
    if(matches.size>1) throw new Error('같은 전화번호의 적립계정이 여러 개입니다. 계정 병합이 필요합니다');
    return matches.empty?'':matches.docs[0].id;
  }
  async function buildStudentIndexRows(linkedStudents){
    return Promise.all(linkedStudentIds(linkedStudents).map(async studentId=>({studentId,indexId:await studentIndexId(studentId)})));
  }
  function writeStudentIndexes(transaction,familyId,indexRows,phone,who,now){
    (Array.isArray(indexRows)?indexRows:[]).forEach(row=>transaction.set(studentIndexCollection().doc(row.indexId),{
        familyId,studentId:row.studentId,phone:normalizePhone(phone),
        updatedAt:serverTimestamp(),updatedAtMs:now,updatedBy:who.email,
        schemaVersion:2,
      },{merge:true}));
  }
  function occupiedFamilyIds(indexDocs){
    return [...new Set((Array.isArray(indexDocs)?indexDocs:[])
      .filter(item=>item&&item.exists)
      .map(item=>String((item.data()||{}).familyId||'').trim())
      .filter(Boolean))];
  }
  function assertStudentIndexesAvailable(indexDocs,familyId,message){
    const occupied=occupiedFamilyIds(indexDocs);
    if(occupied.some(id=>id!==familyId)){
      throw new Error(message||'연결 원생이 다른 적립계정에 연결되어 있습니다');
    }
  }
  function showAlert(message,type){
    const el=$('referral-alert');
    if(!el) return;
    el.textContent=message||'';
    el.className='referral-alert '+(type||'');
    el.hidden=!message;
    clearTimeout(showAlert.timer);
    if(message) showAlert.timer=setTimeout(()=>{el.hidden=true;},4200);
  }
  function setBusy(button,busy,label){
    if(!button) return;
    if(busy){
      button.dataset.label=button.textContent;
      button.disabled=true;
      button.textContent=label||'처리 중';
    }else{
      button.disabled=false;
      button.textContent=button.dataset.label||button.textContent;
    }
  }
  function ensureFirebase(){
    if(!window.firebase) throw new Error('Firebase SDK가 로드되지 않았습니다');
    if(!firebase.apps.length) firebase.initializeApp(window.SC_FIREBASE_CONFIG);
    state.db=firebase.firestore();
    state.root=window.SCFirebaseStore
      ? SCFirebaseStore.createBranchRef(branchInfo())
      : firebase.database().ref(branchInfo().fbPath);
  }
  async function readScheduleKey(key){
    const snapshot=await state.root.child(key).once('value');
    return parseStored(snapshot.val(),null);
  }
  async function loadDirectory(force){
    if(state.directoryLoaded&&!force) return state.directory;
    const status=$('referral-directory-status');
    if(status) status.textContent='현재 시간표 원생정보를 불러오는 중입니다.';
    try{
      const [rawTabs,mainSetting]=await Promise.all([
        readScheduleKey(TAB_LIST_KEY),
        readScheduleKey(MAIN_TAB_KEY),
      ]);
      const tabs=selectDirectoryTabs(rawTabs,mainSetting||{},currentDate());
      const values=await Promise.all(tabs.map(tab=>readScheduleKey(studentKeyForTab(tab))));
      const rows=[];
      tabs.forEach((tab,index)=>rows.push(...directoryRows(tab,values[index])));
      const unique=new Map();
      rows.forEach(row=>{if(!unique.has(row.key)) unique.set(row.key,row);});
      state.directory=[...unique.values()];
      state.directoryLoaded=true;
      if(status) status.textContent=`현재 시간표 원생 ${state.directory.length}명을 연결할 수 있습니다.`;
      if(state.phone) renderCurrentView();
      return state.directory;
    }catch(error){
      console.error('[REFERRAL] student directory load failed',error);
      state.directory=[];
      state.directoryLoaded=true;
      if(status) status.textContent='원생정보를 불러오지 못했습니다. 적립정보는 계속 사용할 수 있습니다.';
      showAlert('시간표 원생정보 조회에 실패했습니다','err');
      return [];
    }
  }
  function phoneCandidates(){return state.directory.filter(row=>row.phone===state.phone);}
  function linkedStudentPool(){
    const map=new Map();
    phoneCandidates().forEach(student=>map.set(student.key,student));
    ((state.family&&state.family.linkedStudents)||[]).forEach(student=>{
      const key=String(student.key||student.courseType+'|person:'+cleanStudentName(student.name)+'|'+state.phone);
      if(!map.has(key)) map.set(key,Object.assign({key,phone:state.phone,missingFromSchedule:true},student));
    });
    return [...map.values()];
  }
  function candidateMarkup(student,checked){
    const kind=student.courseType==='bangteuk'?'방특':'정규';
    const missing=student.missingFromSchedule?' · 현재 시간표 없음':'';
    return `<label class="student-candidate"><input type="checkbox" data-student-key="${escAttr(student.key)}" ${checked?'checked':''}><span>${esc(student.name)}</span><em>${kind}${esc(missing)}</em></label>`;
  }
  function renderCandidateList(element,isNew){
    if(!element) return;
    const students=linkedStudentPool();
    if(!students.length){
      element.innerHTML='<span class="student-candidates-empty">같은 전화번호의 현재 원생을 찾지 못했습니다. 수동 등록은 가능합니다.</span>';
      return;
    }
    const linkedKeys=new Set(((state.family&&state.family.linkedStudents)||[]).map(item=>String(item.key||'')));
    const defaultAll=isNew||linkedKeys.size===0;
    element.innerHTML=students.map(student=>candidateMarkup(
      student,
      isNew
        ? true
        : state.selectedStudentKey
        ? student.key===state.selectedStudentKey||(!isNew&&linkedKeys.has(student.key))
        : defaultAll||linkedKeys.has(student.key)
    )).join('');
  }
  function collectLinkedStudents(container){
    if(!container) return [];
    const pool=new Map(linkedStudentPool().map(student=>[student.key,student]));
    return [...container.querySelectorAll('[data-student-key]:checked')].map(input=>{
      const item=pool.get(input.dataset.studentKey);
      if(!item) return null;
      return {
        key:item.key,
        studentId:item.studentId||'',
        name:item.name,
        courseType:item.courseType||'regular',
        tabId:item.tabId||'',
        tabName:item.tabName||'',
      };
    }).filter(Boolean);
  }
  function renderStampTrack(){
    const wrap=$('stamp-track');
    if(!wrap) return;
    const count=Number(state.family&&state.family.currentStamps)||0;
    const applied=new Set(normalizeAppliedStamps(state.family&&state.family.appliedStamps,count));
    wrap.innerHTML=Array.from({length:MAX_STAMPS},(_,index)=>{
      const n=index+1;
      const classes=['stamp-cell'];
      if(n<=count) classes.push('filled');
      if(applied.has(n)) classes.push('applied');
      if(n===5||n===10) classes.push('milestone');
      if(n>count) return `<span class="${classes.join(' ')}"><b>${n}</b><small>미적립</small></span>`;
      return `<label class="${classes.join(' ')}"><b>${n}</b><input type="checkbox" data-stamp-applied="${n}" ${applied.has(n)?'checked':''} aria-label="${n}번 스탬프 혜택 적용"><small>${applied.has(n)?'적용 완료':'미적용'}</small></label>`;
    }).join('');
  }
  function messageVars(kind){
    const family=state.family||{};
    const studentName=familyStudentName(family)||'원생';
    const referralName=String($('referral-student-name')&&$('referral-student-name').value||'').trim()
      ||String((state.logs.find(log=>log&&log.referralName)||{}).referralName||'');
    return {
      '지점명':branchInfo().name,
      '원생명':studentName,
      '학부모명':studentName,
      '추천원생명':referralName,
      '알림유형':kind==='earned'?'적립':'현황',
      '도장표시':stampDisplay(family.currentStamps),
      '현재도장':String(Number(family.currentStamps)||0),
      '누적도장':String(Number(family.totalStamps)||0),
      '혜택안내':benefitLines(family.currentStamps),
    };
  }
  function aligoTemplate(){
    const count=Math.max(1,Math.min(MAX_STAMPS,Number(state.family&&state.family.currentStamps)||1));
    const templates=state.settings&&state.settings.templates||{};
    const specific=templates[referralTemplateId(count)];
    const legacy=templates[LEGACY_TEMPLATE_ID];
    const template=Object.assign({},defaultReferralTemplate(count),legacy||{},specific||{});
    template.id=referralTemplateId(count);
    if(!(specific&&specific.code)&&legacy&&legacy.code) template.code=legacy.code;
    return template;
  }
  function renderMessagePreview(kind){
    const preview=$('alimtalk-preview');
    if(!preview||!state.family) return;
    const template=aligoTemplate();
    const vars=messageVars(kind||'status');
    const title=renderTemplate(template.emtitle||template.main||template.title,vars);
    const body=renderTemplate(template.body,vars);
    preview.textContent=[title,body].filter(Boolean).join('\n\n');
  }
  function renderAligoState(){
    const el=$('alimtalk-state');
    if(!el) return;
    const aligo=state.settings&&state.settings.aligo||{};
    const template=aligoTemplate();
    const ready=!!(aligo.enabled&&aligo.senderKey&&aligo.sender&&template.enabled!==false&&template.code);
    el.className='connection-state '+(ready?'ok':'err');
    const count=Math.max(1,Math.min(MAX_STAMPS,Number(state.family&&state.family.currentStamps)||1));
    el.textContent=ready?`${count}개 템플릿 준비 완료`:`${count}개 템플릿 코드 필요`;
    ['send-earned-message','send-status-message'].forEach(id=>{if($(id)) $(id).disabled=!ready||!state.family;});
  }
  function renderFamilyTags(){
    const wrap=$('family-students');
    if(!wrap) return;
    const students=state.family&&state.family.linkedStudents||[];
    wrap.innerHTML=students.length
      ? students.map(item=>`<span class="family-student-tag">${item.courseType==='bangteuk'?'방특':'정규'} · ${esc(item.name)}</span>`).join('')
      : '<span class="family-student-tag">연결 원생 없음</span>';
  }
  function renderCurrentView(){
    const hasPhone=!!state.phone;
    const hasFamily=!!state.family;
    $('referral-empty').hidden=hasPhone;
    $('referral-register-panel').hidden=!hasPhone||hasFamily;
    $('referral-family-panel').hidden=!hasFamily;
    $('referral-log-panel').hidden=!hasFamily;
    if(hasPhone&&!hasFamily){
      renderCandidateList($('new-student-candidates'),true);
      const selected=state.directory.find(row=>row.key===state.selectedStudentKey)
        ||(phoneCandidates().length===1?phoneCandidates()[0]:null);
      if(selected&&!$('new-student-name').value.trim()) $('new-student-name').value=selected.name;
      return;
    }
    if(!hasFamily) return;
    const studentName=familyStudentName(state.family);
    state.phone=normalizePhone(state.family.phone||state.phone);
    $('family-name').textContent=studentName||'이름 미입력';
    $('family-phone').textContent=formatPhone(state.family.phone||state.phone);
    $('family-current-stamps').textContent=String(Number(state.family.currentStamps)||0);
    $('family-total-stamps').textContent=String(Number(state.family.totalStamps)||0);
    $('family-cycle').textContent=String(Number(state.family.cycle)||1);
    $('family-student-name').value=studentName;
    $('family-phone-input').value=formatPhone(state.phone);
    renderFamilyTags();
    renderCandidateList($('family-student-candidates'),false);
    renderStampTrack();
    renderMessagePreview('status');
    renderAligoState();
    renderLogs();
  }
  function logLabel(log){
    if(log.status==='voided') return '취소됨';
    if(log.type==='register') return '신규';
    if(log.type==='add') return log.reset?'회차 전환':'적립';
    if(log.type==='remove') return '차감';
    if(log.type==='set') return '수 조정';
    if(log.type==='benefit_apply') return '혜택 적용';
    if(log.type==='benefit_unapply') return '적용 취소';
    if(log.type==='message') return '알림톡';
    if(log.type==='profile_update') return '정보 수정';
    return '처리';
  }
  function logClass(log){
    if(log.status==='voided') return 'voided';
    if(log.type==='remove') return 'remove';
    if(log.type==='set') return 'set';
    if(log.type==='benefit_apply') return 'apply';
    if(log.type==='benefit_unapply') return 'unapply';
    if(log.type==='message') return 'message';
    return '';
  }
  function formatLogDate(log){
    let date=null;
    if(log&&log.createdAt&&typeof log.createdAt.toDate==='function') date=log.createdAt.toDate();
    else if(log&&log.createdAtMs) date=new Date(log.createdAtMs);
    if(!date||Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  }
  function renderLogs(){
    const tbody=$('referral-log-body');
    if(!tbody) return;
    if(!state.logs.length){
      tbody.innerHTML='<tr><td colspan="6" class="log-empty">처리 기록이 없습니다.</td></tr>';
      return;
    }
    const latestId=state.family&&state.family.lastActiveLogId||'';
    tbody.innerHTML=state.logs.map(log=>{
      const before=Number(log.beforeCurrent)||0;
      const after=Number(log.afterCurrent)||0;
      const change=log.type==='message'
        ? (log.messageKind==='earned'?'적립 안내':'현황 안내')
        : log.type==='profile_update'
          ? (log.beforePhone!==log.afterPhone
            ? `${formatPhone(log.beforePhone)} → ${formatPhone(log.afterPhone)}`
            : '원생 정보 변경')
        : ['benefit_apply','benefit_unapply'].includes(log.type)
          ? `${Number(log.stampNumber)||'-'}번 스탬프`
          : `${before} → ${after}`;
      const canCancel=log.status==='active'&&log.id===latestId&&['register','add','remove','set'].includes(log.type);
      const memo=[log.memo,log.actorName||log.actorEmail].filter(Boolean).join(' · ');
      return `<tr>
        <td>${esc(formatLogDate(log))}</td>
        <td><span class="log-type ${logClass(log)}">${esc(logLabel(log))}</span></td>
        <td>${esc(log.referralName||'-')}</td>
        <td><span class="log-change">${esc(change)}</span></td>
        <td><span class="log-meta">${esc(memo||'-')}</span></td>
        <td style="text-align:center">${canCancel?`<button type="button" class="log-cancel" data-cancel-log="${escAttr(log.id)}">취소</button>`:'-'}</td>
      </tr>`;
    }).join('');
  }
  function stopFamilyListeners(){
    if(state.familyUnsubscribe) state.familyUnsubscribe();
    if(state.logsUnsubscribe) state.logsUnsubscribe();
    state.familyUnsubscribe=null;
    state.logsUnsubscribe=null;
  }
  function listenFamily(){
    stopFamilyListeners();
    state.family=null;
    state.logs=[];
    renderCurrentView();
    state.familyUnsubscribe=familyRef().onSnapshot(doc=>{
      state.family=doc.exists?Object.assign({id:doc.id},doc.data()||{}):null;
      renderCurrentView();
    },error=>{
      console.error('[REFERRAL] family listener failed',error);
      showAlert('추천 적립정보를 불러오지 못했습니다: '+(error.message||error),'err');
    });
    state.logsUnsubscribe=logsCollection().orderBy('createdAtMs','desc').limit(100).onSnapshot(snapshot=>{
      state.logs=snapshot.docs.map(doc=>Object.assign({id:doc.id},doc.data()||{}));
      renderLogs();
      renderMessagePreview('status');
    },error=>{
      console.error('[REFERRAL] log listener failed',error);
      showAlert('처리 기록을 불러오지 못했습니다','err');
    });
  }
  function hideSearchResults(){
    const wrap=$('referral-search-results');
    if(!wrap) return;
    wrap.hidden=true;
    wrap.innerHTML='';
  }
  function renderSearchResults(rows,query){
    const wrap=$('referral-search-results');
    if(!wrap) return;
    if(!rows.length){
      wrap.innerHTML=`<div class="search-result-empty"><strong>${esc(query)}</strong> 검색 결과가 없습니다.</div>`;
      wrap.hidden=false;
      return;
    }
    wrap.innerHTML=`<div class="search-result-title">검색 결과 ${rows.length}명</div><div class="search-result-list">${rows.map(row=>`
      <button type="button" class="search-result-btn" data-directory-key="${escAttr(row.key)}">
        <strong>${esc(row.name)}</strong>
        <span>${esc(formatPhone(row.phone))}</span>
        <em>${row.courseType==='bangteuk'?'방특':'정규'}</em>
      </button>`).join('')}</div>`;
    wrap.hidden=false;
  }
  function runSearch(){
    const query=String($('referral-query').value||'').trim();
    if(!query){
      showAlert('원생 이름이나 전화번호를 입력해주세요','err');
      $('referral-query').focus();
      return;
    }
    const phone=normalizePhone(query);
    if(/^[\d\s-]+$/.test(query)&&phone.length>=10&&phone.length<=11){
      const rows=searchDirectoryRows(state.directory,phone,30).filter(row=>row.phone===phone);
      if(rows.length===1) searchPhone(rows[0].phone,rows[0].key,rows[0].name);
      else if(rows.length>1) renderSearchResults(rows,query);
      else searchPhone(phone);
      return;
    }
    if(!/^[\d\s-]+$/.test(query)&&cleanStudentName(query).length<2){
      showAlert('원생 이름을 2글자 이상 입력해주세요','err');
      return;
    }
    const rows=searchDirectoryRows(state.directory,query,30);
    renderSearchResults(rows,query);
  }
  async function searchPhone(rawPhone,studentKey,studentName){
    const phone=normalizePhone(rawPhone);
    if(phone.length<10||phone.length>11){
      showAlert('전화번호 10~11자리를 입력해주세요','err');
      $('referral-query').focus();
      return;
    }
    try{
      const student=state.directory.find(row=>row.key===String(studentKey||''))||null;
      state.selectedStudentKey=String(studentKey||'');
      state.phone=phone;
      state.familyId=student?await resolveFamilyId(student):(await resolveFamilyIdByPhone(phone)||await familyIdForPhone(phone));
      $('referral-query').value=studentName||formatPhone(phone);
      $('new-student-name').value=studentName||'';
      hideSearchResults();
      listenFamily();
    }catch(error){
      console.error('[REFERRAL] account resolution failed',error);
      showAlert(error.message||'원생 적립계정을 찾지 못했습니다','err');
    }
  }
  function openFamilyById(familyId,phone,studentName){
    if(!familyId) return;
    state.selectedStudentKey='';
    state.phone=normalizePhone(phone);
    state.familyId=String(familyId);
    $('referral-query').value=studentName||formatPhone(state.phone);
    $('new-student-name').value='';
    hideSearchResults();
    listenFamily();
  }
  function resetSearch(){
    stopFamilyListeners();
    state.phone='';
    state.familyId='';
    state.family=null;
    state.logs=[];
    state.selectedStudentKey='';
    $('referral-query').value='';
    $('new-student-name').value='';
    hideSearchResults();
    $('referral-empty').hidden=false;
    $('referral-register-panel').hidden=true;
    $('referral-family-panel').hidden=true;
    $('referral-log-panel').hidden=true;
    $('referral-query').focus();
  }
  async function registerFamily(button){
    const studentName=cleanStudentName($('new-student-name').value);
    const referralName=String($('new-referral-name').value||'').trim();
    const memo=String($('new-referral-memo').value||'').trim();
    if(!studentName) return showAlert('원생 이름을 입력해주세요','err');
    if(!referralName) return showAlert('추천받은 원생 이름을 입력해주세요','err');
    const linkedStudents=collectLinkedStudents($('new-student-candidates'));
    const studentIds=linkedStudentIds(linkedStudents);
    const logRef=logsCollection().doc();
    const now=Date.now();
    const who=actor();
    setBusy(button,true,'등록 중');
    try{
      const indexRows=await buildStudentIndexRows(linkedStudents);
      await state.db.runTransaction(async tx=>{
        const ref=familyRef();
        const [doc,...indexDocs]=await Promise.all([
          tx.get(ref),
          ...indexRows.map(row=>tx.get(studentIndexCollection().doc(row.indexId))),
        ]);
        if(doc.exists) throw new Error('이미 등록된 원생 적립계정입니다');
        const occupied=occupiedFamilyIds(indexDocs);
        if(occupied.length) throw new Error('형제 원생 중 이미 연결된 적립계정이 있습니다. 다시 검색해주세요');
        tx.set(ref,{
          branchId:state.branchId,
          phone:state.phone,
          studentName,
          linkedStudents,
          primaryStudentId:studentIds[0]||'',
          studentIds,
          currentStamps:1,
          totalStamps:1,
          cycle:1,
          appliedStamps:[],
          lastActiveLogId:logRef.id,
          createdAt:serverTimestamp(),
          createdAtMs:now,
          updatedAt:serverTimestamp(),
          updatedAtMs:now,
          createdBy:who.email,
          updatedBy:who.email,
          schemaVersion:2,
        });
        writeStudentIndexes(tx,state.familyId,indexRows,state.phone,who,now);
        tx.set(logRef,{
          type:'register',status:'active',referralName,memo,
          beforeCurrent:0,beforeTotal:0,beforeCycle:1,
          afterCurrent:1,afterTotal:1,afterCycle:1,
          previousActiveLogId:'',
          createdAt:serverTimestamp(),createdAtMs:now,
          actorUid:who.uid,actorEmail:who.email,actorName:who.name,
          schemaVersion:1,
        });
      });
      $('new-student-name').value='';
      $('new-referral-name').value='';
      $('new-referral-memo').value='';
      showAlert('신규 등록과 첫 적립을 완료했습니다','ok');
    }catch(error){
      console.error('[REFERRAL] register failed',error);
      showAlert(error.message||'신규 등록에 실패했습니다','err');
    }finally{setBusy(button,false);}
  }
  async function mutateStamp(type,button){
    if(!state.family) return;
    const referralName=String($('referral-student-name').value||'').trim();
    const memo=String($('referral-memo').value||'').trim();
    const setValue=Number($('stamp-set-value').value);
    if(type==='add'&&!referralName) return showAlert('추천받은 원생 이름을 입력해주세요','err');
    const logRef=logsCollection().doc();
    const now=Date.now();
    const who=actor();
    setBusy(button,true,'저장 중');
    try{
      const linkedStudents=Array.isArray(state.family.linkedStudents)?state.family.linkedStudents:[];
      const studentIds=linkedStudentIds(linkedStudents);
      const indexRows=await buildStudentIndexRows(linkedStudents);
      let result=null;
      await state.db.runTransaction(async tx=>{
        const ref=familyRef();
        const [doc,...indexDocs]=await Promise.all([
          tx.get(ref),
          ...indexRows.map(row=>tx.get(studentIndexCollection().doc(row.indexId))),
        ]);
        if(!doc.exists) throw new Error('원생 적립정보를 찾지 못했습니다');
        assertStudentIndexesAvailable(indexDocs,state.familyId,'연결 원생이 다른 적립계정에 있어 적립을 중단했습니다');
        const family=doc.data()||{};
        result=stampTransition(family,type,setValue);
        const beforeAppliedStamps=normalizeAppliedStamps(family.appliedStamps,result.beforeCurrent);
        const afterAppliedStamps=appliedStampsAfterTransition(family,result);
        tx.update(ref,{
          currentStamps:result.afterCurrent,
          totalStamps:result.afterTotal,
          cycle:result.afterCycle,
          appliedStamps:afterAppliedStamps,
          primaryStudentId:family.primaryStudentId||studentIds[0]||'',
          studentIds,
          lastActiveLogId:logRef.id,
          updatedAt:serverTimestamp(),updatedAtMs:now,updatedBy:who.email,
        });
        tx.set(logRef,{
          type,status:'active',referralName:type==='add'?referralName:'',memo,
          beforeCurrent:result.beforeCurrent,beforeTotal:result.beforeTotal,beforeCycle:result.beforeCycle,
          afterCurrent:result.afterCurrent,afterTotal:result.afterTotal,afterCycle:result.afterCycle,
          beforeAppliedStamps,afterAppliedStamps,
          reset:result.reset,previousActiveLogId:String(family.lastActiveLogId||''),
          createdAt:serverTimestamp(),createdAtMs:now,
          actorUid:who.uid,actorEmail:who.email,actorName:who.name,
          schemaVersion:1,
        });
        writeStudentIndexes(tx,state.familyId,indexRows,family.phone||state.phone,who,now);
      });
      $('referral-student-name').value='';
      $('referral-memo').value='';
      $('stamp-set-value').value='';
      showAlert(result&&result.reset?'10개 달성 후 새 회차 1개로 적립했습니다':'적립정보를 저장했습니다','ok');
    }catch(error){
      console.error('[REFERRAL] stamp mutation failed',error);
      showAlert(error.message||'적립정보 저장에 실패했습니다','err');
    }finally{setBusy(button,false);}
  }
  async function cancelLog(logId,button){
    const log=state.logs.find(item=>item.id===logId);
    if(!log||!state.family) return;
    if(!confirm(`${logLabel(log)} 처리를 취소하고 적립 수를 ${log.beforeCurrent}개로 되돌릴까요?`)) return;
    const now=Date.now();
    const who=actor();
    setBusy(button,true,'취소 중');
    try{
      await state.db.runTransaction(async tx=>{
        const ref=familyRef();
        const logRef=logsCollection().doc(logId);
        const [familyDoc,logDoc]=await Promise.all([tx.get(ref),tx.get(logRef)]);
        if(!familyDoc.exists||!logDoc.exists) throw new Error('취소할 기록을 찾지 못했습니다');
        const family=familyDoc.data()||{};
        const saved=logDoc.data()||{};
        if(saved.status!=='active') throw new Error('이미 취소된 기록입니다');
        if(String(family.lastActiveLogId||'')!==logId) throw new Error('이후 적립 변경이 있어 마지막 처리부터 취소해야 합니다');
        tx.update(ref,{
          currentStamps:Number(saved.beforeCurrent)||0,
          totalStamps:Number(saved.beforeTotal)||0,
          cycle:Math.max(1,Number(saved.beforeCycle)||1),
          appliedStamps:normalizeAppliedStamps(saved.beforeAppliedStamps,Number(saved.beforeCurrent)||0),
          lastActiveLogId:String(saved.previousActiveLogId||''),
          updatedAt:serverTimestamp(),updatedAtMs:now,updatedBy:who.email,
        });
        tx.update(logRef,{
          status:'voided',voidedAt:serverTimestamp(),voidedAtMs:now,
          voidedBy:who.email,voidedByName:who.name,
        });
      });
      showAlert('마지막 처리를 안전하게 취소했습니다','ok');
    }catch(error){
      console.error('[REFERRAL] cancel failed',error);
      showAlert(error.message||'처리 취소에 실패했습니다','err');
    }finally{setBusy(button,false);}
  }
  async function setStampApplied(stampNumber,applied,input){
    if(!state.family) return;
    const number=Number(stampNumber);
    if(!Number.isInteger(number)||number<1||number>MAX_STAMPS) return;
    if(input) input.disabled=true;
    const now=Date.now();
    const who=actor();
    try{
      const linkedStudents=Array.isArray(state.family.linkedStudents)?state.family.linkedStudents:[];
      const studentIds=linkedStudentIds(linkedStudents);
      const indexRows=await buildStudentIndexRows(linkedStudents);
      await state.db.runTransaction(async tx=>{
        const ref=familyRef();
        const [doc,...indexDocs]=await Promise.all([
          tx.get(ref),
          ...indexRows.map(row=>tx.get(studentIndexCollection().doc(row.indexId))),
        ]);
        if(!doc.exists) throw new Error('원생 적립정보를 찾지 못했습니다');
        assertStudentIndexesAvailable(indexDocs,state.familyId,'연결 원생이 다른 적립계정에 있어 혜택 처리를 중단했습니다');
        const family=doc.data()||{};
        const current=Math.max(0,Math.min(MAX_STAMPS,Number(family.currentStamps)||0));
        if(number>current) throw new Error('아직 적립되지 않은 스탬프입니다');
        const before=normalizeAppliedStamps(family.appliedStamps,current);
        const set=new Set(before);
        if(applied) set.add(number); else set.delete(number);
        const after=[...set].sort((a,b)=>a-b);
        if(before.join(',')===after.join(',')) return;
        const logRef=logsCollection().doc();
        tx.update(ref,{
          appliedStamps:after,
          primaryStudentId:family.primaryStudentId||studentIds[0]||'',
          studentIds,
          updatedAt:serverTimestamp(),updatedAtMs:now,updatedBy:who.email,
        });
        writeStudentIndexes(tx,state.familyId,indexRows,family.phone||state.phone,who,now);
        tx.set(logRef,{
          type:applied?'benefit_apply':'benefit_unapply',status:'info',stampNumber:number,
          beforeCurrent:current,afterCurrent:current,beforeAppliedStamps:before,afterAppliedStamps:after,
          createdAt:serverTimestamp(),createdAtMs:now,
          actorUid:who.uid,actorEmail:who.email,actorName:who.name,
          schemaVersion:2,
        });
      });
      showAlert(`${number}번 스탬프 혜택을 ${applied?'적용 완료':'미적용'}로 변경했습니다`,'ok');
    }catch(error){
      console.error('[REFERRAL] benefit apply failed',error);
      if(input) input.checked=!applied;
      showAlert(error.message||'혜택 적용 상태 저장에 실패했습니다','err');
    }finally{
      if(input) input.disabled=false;
    }
  }
  async function saveFamilyInfo(button){
    if(!state.family) return;
    const studentName=cleanStudentName($('family-student-name').value);
    const phone=normalizePhone($('family-phone-input').value);
    if(!studentName) return showAlert('원생 이름을 입력해주세요','err');
    if(phone.length<10||phone.length>11) return showAlert('전화번호 10~11자리를 입력해주세요','err');
    const linkedStudents=collectLinkedStudents($('family-student-candidates'));
    const studentIds=linkedStudentIds(linkedStudents);
    const who=actor();
    setBusy(button,true,'저장 중');
    try{
      const now=Date.now();
      const indexRows=await buildStudentIndexRows(linkedStudents);
      const samePhoneAccounts=await familyCollection().where('phone','==',phone).limit(2).get();
      if(samePhoneAccounts.docs.some(doc=>doc.id!==state.familyId)){
        throw new Error('이 전화번호는 다른 적립계정에서 사용 중입니다. 먼저 계정을 병합해주세요');
      }
      const logRef=logsCollection().doc();
      await state.db.runTransaction(async tx=>{
        const [familyDoc,...indexDocs]=await Promise.all([
          tx.get(familyRef()),
          ...indexRows.map(row=>tx.get(studentIndexCollection().doc(row.indexId))),
        ]);
        if(!familyDoc.exists) throw new Error('원생 적립정보를 찾지 못했습니다');
        assertStudentIndexesAvailable(indexDocs,state.familyId,'선택한 형제 원생이 다른 적립계정에 연결되어 있습니다');
        const before=familyDoc.data()||{};
        const beforePhone=normalizePhone(before.phone||state.phone);
        const beforeName=familyStudentName(before);
        tx.update(familyRef(),{
          studentName,phone,linkedStudents,
          primaryStudentId:state.family.primaryStudentId||studentIds[0]||'',studentIds,schemaVersion:2,
          updatedAt:serverTimestamp(),updatedAtMs:now,updatedBy:who.email,
        });
        writeStudentIndexes(tx,state.familyId,indexRows,phone,who,now);
        if(beforePhone!==phone||beforeName!==studentName){
          tx.set(logRef,{
            type:'profile_update',status:'info',
            beforePhone,afterPhone:phone,beforeStudentName:beforeName,afterStudentName:studentName,
            createdAt:serverTimestamp(),createdAtMs:now,
            actorUid:who.uid,actorEmail:who.email,actorName:who.name,
            schemaVersion:2,
          });
        }
      });
      state.phone=phone;
      state.family=Object.assign({},state.family,{phone,studentName,linkedStudents,studentIds});
      $('referral-query').value=studentName;
      renderCurrentView();
      showAlert('기본정보를 저장했습니다','ok');
    }catch(error){
      console.error('[REFERRAL] family info save failed',error);
      showAlert(error.message||'기본정보 저장에 실패했습니다','err');
    }finally{setBusy(button,false);}
  }
  function joinProxyUrl(base,path){
    let cleanBase=String(base||'/aligo').trim()||'/aligo';
    if(/^\/aligo(?:\/|$)/.test(cleanBase)&&/^(localhost|127\.0\.0\.1)$/i.test(location.hostname)) cleanBase='https://adminsuperchild.cloud/aligo';
    return cleanBase.replace(/\/+$/,'')+'/'+String(path||'/alimtalk/send/').replace(/^\/+/, '');
  }
  function localOpaque(url){
    try{return /^(localhost|127\.0\.0\.1)$/i.test(location.hostname)&&new URL(url,location.href).origin!==location.origin;}
    catch(e){return false;}
  }
  async function readResponse(response){
    const text=await response.text();
    let body=text;
    try{body=text?JSON.parse(text):{};}catch(e){}
    if(!response.ok){
      const error=new Error(body&&typeof body==='object'&&(body.message||body.error)||text||response.statusText||'발송 실패');
      error.status=response.status;
      throw error;
    }
    return body||{};
  }
  async function logMessage(kind,status,response,templateId){
    const who=actor();
    await logsCollection().add({
      type:'message',status:'info',messageKind:kind,messageStatus:status,
      templateId:String(templateId||''),
      beforeCurrent:Number(state.family.currentStamps)||0,
      afterCurrent:Number(state.family.currentStamps)||0,
      referralName:'',memo:status==='requested'?'알림톡 발송 요청':'알림톡 발송 접수',
      responseSummary:response&&typeof response==='object'?JSON.stringify(response).slice(0,500):String(response||'').slice(0,500),
      createdAt:serverTimestamp(),createdAtMs:Date.now(),
      actorUid:who.uid,actorEmail:who.email,actorName:who.name,
      schemaVersion:1,
    });
  }
  async function sendAlimtalk(kind,button){
    if(!state.family) return;
    const aligo=state.settings&&state.settings.aligo||{};
    const template=aligoTemplate();
    const missing=[];
    if(!aligo.enabled) missing.push('알림톡 사용');
    if(!aligo.senderKey) missing.push('발신 프로파일 키');
    if(!aligo.sender) missing.push('발신번호');
    if(!template.code) missing.push(`${Number(state.family.currentStamps)||0}개 적립 템플릿 코드`);
    if(missing.length) return showAlert('설정에서 '+missing.join(', ')+'을 확인해주세요','err');
    const label=kind==='earned'?'적립 안내':'현황 안내';
    if(!confirm(`${formatPhone(state.phone)} 번호로 ${label} 알림톡을 발송할까요?`)) return;
    const vars=messageVars(kind);
    const subject=renderTemplate(template.emtitle||template.main||template.title,vars);
    const message=renderTemplate(template.body,vars);
    const url=joinProxyUrl(aligo.proxyUrl,aligo.sendPath||'/alimtalk/send/');
    const body=new URLSearchParams();
    body.set('branch',branchInfo().aligoBranch);
    body.set('senderkey',aligo.senderKey);
    body.set('sender',normalizePhone(aligo.sender));
    body.set('tpl_code',template.code);
    body.set('receiver_1',state.phone);
    body.set('recvname_1',familyStudentName(state.family)||'원생');
    body.set('subject_1',subject);
    body.set('emtitle_1',subject);
    body.set('message_1',message);
    body.set('testMode','N');
    body.set('failover','N');
    const buttonName=renderTemplate(template.buttonName||'',vars);
    const linkM=renderTemplate(template.linkM||template.link||'',vars);
    const linkP=renderTemplate(template.linkP||template.linkM||template.link||'',vars);
    if(buttonName&&linkM&&linkP){
      body.set('button_1',JSON.stringify({button:[{name:buttonName,linkType:'WL',linkTypeName:'웹링크',linkM,linkP}]}));
    }
    setBusy(button,true,'발송 중');
    try{
      const opaque=localOpaque(url);
      const response=await fetch(url,opaque
        ? {method:'POST',mode:'no-cors',body}
        : {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body});
      const result=opaque?{localOpaque:true}:await readResponse(response);
      await logMessage(kind,opaque?'requested':'accepted',result,template.id);
      showAlert(opaque?'발송을 요청했습니다. 알리고 발송내역에서 확인해주세요.':'알림톡 발송 요청이 접수되었습니다','ok');
    }catch(error){
      console.error('[REFERRAL] alimtalk send failed',error);
      showAlert('알림톡 발송 실패: '+(error.message||error),'err');
    }finally{setBusy(button,false);}
  }
  async function loadSettings(){
    try{
      state.settings=parseStored(await readScheduleKey(SETTINGS_KEY),{})||{};
    }catch(error){
      console.error('[REFERRAL] settings load failed',error);
      state.settings={};
    }
    renderAligoState();
    renderMessagePreview('status');
  }
  function listenRecentFamilies(){
    if(state.recentUnsubscribe) state.recentUnsubscribe();
    state.recentUnsubscribe=familyCollection().orderBy('updatedAtMs','desc').limit(20).onSnapshot(snapshot=>{
      const wrap=$('recent-family-list');
      const rows=snapshot.docs.map(doc=>Object.assign({id:doc.id},doc.data()||{}));
      wrap.innerHTML=rows.length?rows.map(row=>`<button type="button" class="recent-family-btn" data-recent-family-id="${escAttr(row.id)}" data-recent-phone="${escAttr(row.phone||'')}" data-recent-name="${escAttr(familyStudentName(row))}"><strong>${esc(familyStudentName(row)||'이름 미입력')} · ${Number(row.currentStamps)||0}/10</strong><span>${esc(formatPhone(row.phone||''))}</span></button>`).join(''):'<div class="empty-row">등록된 원생이 없습니다.</div>';
    },error=>{
      console.error('[REFERRAL] recent families load failed',error);
      $('recent-family-list').innerHTML='<div class="empty-row">최근 이용 정보를 불러오지 못했습니다.</div>';
    });
  }
  function bindEvents(){
    $('referral-search').addEventListener('click',runSearch);
    $('referral-query').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();runSearch();}});
    $('referral-search-results').addEventListener('click',event=>{
      const button=event.target.closest('[data-directory-key]');
      if(!button) return;
      const row=state.directory.find(item=>item.key===button.dataset.directoryKey);
      if(row) searchPhone(row.phone,row.key,row.name);
    });
    $('referral-reset').addEventListener('click',resetSearch);
    $('referral-refresh').addEventListener('click',async event=>{
      setBusy(event.currentTarget,true,'불러오는 중');
      await Promise.all([loadDirectory(true),loadSettings()]);
      setBusy(event.currentTarget,false);
      showAlert('원생정보와 알림톡 설정을 새로 불러왔습니다','ok');
    });
    $('recent-refresh').addEventListener('click',listenRecentFamilies);
    $('recent-family-list').addEventListener('click',event=>{
      const button=event.target.closest('[data-recent-family-id]');
      if(button) openFamilyById(button.dataset.recentFamilyId,button.dataset.recentPhone,button.dataset.recentName);
    });
    $('register-family').addEventListener('click',event=>registerFamily(event.currentTarget));
    $('family-info-save').addEventListener('click',event=>saveFamilyInfo(event.currentTarget));
    $('stamp-add').addEventListener('click',event=>mutateStamp('add',event.currentTarget));
    $('stamp-remove').addEventListener('click',event=>{
      if(confirm('현재 적립을 1개 차감할까요?')) mutateStamp('remove',event.currentTarget);
    });
    $('stamp-set').addEventListener('click',event=>{
      const value=$('stamp-set-value').value;
      if(confirm(`현재 적립 수를 ${value}개로 변경할까요?`)) mutateStamp('set',event.currentTarget);
    });
    $('stamp-track').addEventListener('change',event=>{
      const input=event.target.closest('[data-stamp-applied]');
      if(input) setStampApplied(input.dataset.stampApplied,input.checked,input);
    });
    $('referral-student-name').addEventListener('input',()=>renderMessagePreview('earned'));
    $('send-earned-message').addEventListener('click',event=>sendAlimtalk('earned',event.currentTarget));
    $('send-status-message').addEventListener('click',event=>sendAlimtalk('status',event.currentTarget));
    $('referral-log-body').addEventListener('click',event=>{
      const button=event.target.closest('[data-cancel-log]');
      if(button) cancelLog(button.dataset.cancelLog,button);
    });
  }
  function initialBranch(){
    const requested=window.SCNav&&SCNav.branch&&SCNav.branch();
    if(BRANCHES[requested]&&(!window.SCAuth||SCAuth.canAccessBranch(requested))) return requested;
    if(!window.SCAuth||SCAuth.canAccessBranch('gagyeong')) return 'gagyeong';
    return 'yongam';
  }
  async function init(){
    try{
      if(window.SCAuth&&typeof SCAuth.requireAuth==='function') await SCAuth.requireAuth();
      if(window.SCAuth&&!SCAuth.requirePermission('manageReferrals','친구추천 관리')){
        location.href='index.html?branch='+encodeURIComponent(initialBranch());
        return;
      }
      state.branchId=initialBranch();
      try{localStorage.setItem('selected_branch',state.branchId);}catch(e){}
      if($('referral-template-settings')) $('referral-template-settings').href='settings.html?branch='+encodeURIComponent(state.branchId)+'&panel=templates';
      ensureFirebase();
      if(window.SCNav&&SCNav.sync) SCNav.sync();
      bindEvents();
      listenRecentFamilies();
      await Promise.all([loadDirectory(false),loadSettings()]);
      $('referral-query').focus();
    }catch(error){
      console.error('[REFERRAL] init failed',error);
      showAlert('친구추천 화면을 준비하지 못했습니다: '+(error.message||error),'err');
    }
  }

  window.SCReferralProgram={
    normalizePhone,cleanStudentName,selectDirectoryTabs,studentKeyForTab,directoryRows,
    familyStudentName,searchDirectoryRows,referralTemplateId,defaultReferralTemplate,
    accountLookupStudentIds,linkedStudentIds,occupiedFamilyIds,
    stampTransition,normalizeAppliedStamps,appliedStampsAfterTransition,
    stampDisplay,benefitLines,renderTemplate,
  };
  if(typeof document!=='undefined'){
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
    else init();
  }
})();
