(function(){
  'use strict';

  const FIREBASE_CONFIG={
    apiKey:'AIzaSyArHQQfHnVreH8gVamyl1e5IqUDfXUJ5F8',
    authDomain:'scswimming-schedule.firebaseapp.com',
    projectId:'scswimming-schedule',
    storageBucket:'scswimming-schedule.firebasestorage.app',
    messagingSenderId:'45509278949',
    appId:'1:45509278949:web:f16989a9c416f06e25e80c'
  };
  let voiceFn=null;
  let startedAt=Date.now();

  function $(id){return document.getElementById(id);}
  function selected(name){return document.querySelector(`input[name="${name}"]:checked`)?.value||'';}
  function showError(message){
    const el=$('form-error');
    el.textContent=message;
    el.hidden=false;
    el.scrollIntoView({block:'center',behavior:'smooth'});
  }
  function clearError(){$('form-error').hidden=true;$('form-error').textContent='';}
  function normalizePhone(value){return String(value||'').replace(/\D/g,'').slice(0,11);}
  function formatPhone(value){
    const digits=normalizePhone(value);
    if(digits.length<4) return digits;
    if(digits.length<8) return `${digits.slice(0,3)}-${digits.slice(3)}`;
    return `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
  }
  function callable(){
    if(voiceFn) return voiceFn;
    if(!window.firebase) throw new Error('접수 서버 연결을 준비하지 못했습니다');
    const app=firebase.apps.length?firebase.app():firebase.initializeApp(FIREBASE_CONFIG);
    voiceFn=app.functions('asia-northeast3').httpsCallable('customerVoice');
    return voiceFn;
  }
  function functionError(error){
    const message=String(error&&error.message||'').replace(/^FirebaseError:\s*/, '').trim();
    if(message.includes('등록된 회원 정보를')) return '입력한 원생 이름과 전화번호가 등록 정보와 일치하지 않습니다.';
    if(message.includes('resource-exhausted')||message.includes('접수가 너무 많')) return '잠시 동안 접수가 많습니다. 한 시간 뒤 다시 시도해주세요.';
    return message||'접수 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
  }
  function updateMode(){
    const reply=selected('mode')==='reply';
    $('reply-section').hidden=!reply;
    $('submit-button').textContent=reply?'답변 요청 접수':'익명 의견 접수';
  }
  function applyQuery(){
    const params=new URLSearchParams(location.search);
    const branch=params.get('branch');
    const branchInput=document.querySelector(`input[name="branch"][value="${branch}"]`);
    if(branchInput) branchInput.checked=true;
    const context=String(params.get('context')||'').slice(0,80);
    if(context){
      if(/오류|불편|결석|보강/.test(context)) document.querySelector('input[name="category"][value="inconvenience"]').checked=true;
      $('message').placeholder=`${context} 과정에서 느낀 점을 적어주세요.`;
    }
  }
  function payload(){
    const reply=selected('mode')==='reply';
    return {
      action:'submit',
      branch:selected('branch'),
      mode:reply?'reply':'anonymous',
      category:selected('category'),
      classType:$('class-type').value,
      visitDate:$('visit-date').value,
      timeRange:$('time-range').value,
      teacherName:$('teacher-name').value.trim(),
      message:$('message').value.trim(),
      studentName:reply?$('student-name').value.trim():'',
      phone:reply?normalizePhone($('phone').value):'',
      privacyConsent:reply&&$('privacy-consent').checked,
      context:new URLSearchParams(location.search).get('context')||'',
      website:$('website').value,
      startedAt
    };
  }
  function validate(data){
    if(!data.branch) return '이용 지점을 선택해주세요.';
    if(!data.category) return '의견 유형을 선택해주세요.';
    if(data.message.length<10) return '의견 내용을 10자 이상 입력해주세요.';
    if(data.mode==='reply'){
      if(!data.studentName) return '원생 이름을 입력해주세요.';
      if(data.phone.length<10) return '보호자 전화번호를 확인해주세요.';
      if(!data.privacyConsent) return '개인정보 수집·이용 동의가 필요합니다.';
    }
    return '';
  }
  async function submit(event){
    event.preventDefault();
    clearError();
    const data=payload();
    const error=validate(data);
    if(error){showError(error);return;}
    const button=$('submit-button');
    const original=button.textContent;
    try{
      button.disabled=true;button.textContent='안전하게 접수 중입니다';
      const response=await callable()(data);
      const result=response.data||{};
      $('ticket-number').textContent=result.ticketNumber||'';
      $('success-copy').textContent=data.mode==='reply'
        ? '담당자가 확인한 뒤 필요한 경우 입력한 연락처로 안내드리겠습니다.'
        : '익명 의견은 개별 답변이 어렵지만 담당자가 모두 확인하여 개선에 반영합니다.';
      $('voice-form').hidden=true;
      $('success-panel').hidden=false;
      $('success-panel').scrollIntoView({block:'start',behavior:'smooth'});
    }catch(err){showError(functionError(err));}
    finally{button.disabled=false;button.textContent=original;}
  }
  function resetForm(){
    $('voice-form').reset();
    document.querySelector('input[name="mode"][value="anonymous"]').checked=true;
    applyQuery();
    updateMode();
    $('message-count').textContent='0';
    $('voice-form').hidden=false;
    $('success-panel').hidden=true;
    clearError();
    startedAt=Date.now();
    $('voice-main').scrollIntoView({block:'start',behavior:'smooth'});
  }
  function bind(){
    document.querySelectorAll('input[name="mode"]').forEach(input=>input.addEventListener('change',updateMode));
    $('message').addEventListener('input',()=>{$('message-count').textContent=String($('message').value.length);});
    $('phone').addEventListener('input',()=>{$('phone').value=formatPhone($('phone').value);});
    $('voice-form').addEventListener('submit',submit);
    $('new-ticket-button').addEventListener('click',resetForm);
  }
  document.addEventListener('DOMContentLoaded',()=>{
    applyQuery();
    updateMode();
    bind();
  });
})();
