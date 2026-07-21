(function(){
  'use strict';

  const currentVersion=String(window.SC_BUILD_VERSION||'').trim();
  if(!currentVersion||typeof fetch!=='function') return;

  const checkIntervalMs=10000;
  let pendingVersion='';
  let checking=false;
  let reloading=false;
  let timer=null;

  function visibleModal(){
    if(document.body.classList.contains('sc-modal-open')) return true;
    return Array.from(document.querySelectorAll('[data-sc-modal],.stu-popup,.inst-popup')).some(el=>{
      if(el.hidden) return false;
      const style=getComputedStyle(el);
      return style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0';
    });
  }

  function editingNow(){
    if(document.visibilityState==='hidden') return true;
    const active=document.activeElement;
    if(active&&(/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)||active.isContentEditable)) return true;
    return visibleModal();
  }

  function banner(){
    let el=document.getElementById('sc-version-banner');
    if(el) return el;
    el=document.createElement('div');
    el.id='sc-version-banner';
    el.setAttribute('role','status');
    el.setAttribute('aria-live','polite');
    el.innerHTML='<span>새 버전이 준비되었습니다. 작업을 마치면 자동으로 적용됩니다.</span><button type="button">지금 적용</button>';
    Object.assign(el.style,{
      position:'fixed',left:'50%',top:'10px',zIndex:'100000',display:'none',
      alignItems:'center',gap:'10px',maxWidth:'calc(100vw - 24px)',padding:'9px 12px',
      border:'1px solid #2563EB',borderRadius:'7px',background:'#EFF6FF',color:'#1E3A8A',
      boxShadow:'0 4px 16px rgba(15,23,42,.18)',fontFamily:'inherit',fontSize:'12px',fontWeight:'800',
      transform:'translateX(-50%)'
    });
    const button=el.querySelector('button');
    Object.assign(button.style,{
      flex:'none',minHeight:'30px',padding:'4px 9px',border:'0',borderRadius:'5px',
      background:'#2563EB',color:'#fff',fontFamily:'inherit',fontSize:'11px',fontWeight:'800',cursor:'pointer'
    });
    button.addEventListener('click',()=>applyVersion(true));
    document.body.appendChild(el);
    return el;
  }

  function showPending(){
    const el=banner();
    el.style.display='flex';
  }

  function applyVersion(force){
    if(reloading||!pendingVersion) return;
    if(!force&&editingNow()){
      showPending();
      return;
    }
    reloading=true;
    const el=banner();
    el.querySelector('span').textContent='새 버전을 적용하고 있습니다.';
    el.style.display='flex';
    setTimeout(()=>location.reload(),350);
  }

  async function checkVersion(){
    if(checking||reloading||document.visibilityState==='hidden') return;
    checking=true;
    try{
      const response=await fetch('version.json?_='+Date.now(),{
        cache:'no-store',
        credentials:'same-origin',
        headers:{Accept:'application/json'}
      });
      if(!response.ok) return;
      const data=await response.json();
      const next=String(data&&data.version||'').trim();
      if(next&&next!==currentVersion){
        pendingVersion=next;
        applyVersion(false);
      }
    }catch(e){
      // 네트워크가 잠시 끊기면 다음 확인 주기에 다시 시도한다.
    }finally{
      checking=false;
    }
  }

  function start(){
    checkVersion();
    timer=setInterval(checkVersion,checkIntervalMs);
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible'){
        if(pendingVersion) applyVersion(false);
        checkVersion();
      }
    });
    window.addEventListener('focus',()=>{
      if(pendingVersion) applyVersion(false);
      checkVersion();
    });
    document.addEventListener('focusout',()=>{
      if(pendingVersion) setTimeout(()=>applyVersion(false),150);
    });
    document.addEventListener('click',()=>{
      if(pendingVersion) setTimeout(()=>applyVersion(false),150);
    });
    window.addEventListener('beforeunload',()=>{
      if(timer) clearInterval(timer);
    },{once:true});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
