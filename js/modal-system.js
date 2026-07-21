(function(){
  'use strict';

  const selector='[data-sc-modal]';
  const state=new WeakMap();

  function visible(el){
    if(!el||el.hidden) return false;
    const style=getComputedStyle(el);
    return style.display!=='none'&&style.visibility!=='hidden';
  }

  function dialogs(){
    return Array.from(document.querySelectorAll(selector)).filter(visible);
  }

  function topModal(){
    return dialogs().sort((a,b)=>{
      const az=parseInt(getComputedStyle(a).zIndex,10)||0;
      const bz=parseInt(getComputedStyle(b).zIndex,10)||0;
      return az===bz
        ? Array.from(document.querySelectorAll(selector)).indexOf(a)-Array.from(document.querySelectorAll(selector)).indexOf(b)
        : az-bz;
    }).pop()||null;
  }

  function focusables(modal){
    return Array.from(modal.querySelectorAll(
      'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter(el=>el.offsetParent!==null&&!el.hidden);
  }

  function syncOne(modal){
    const open=visible(modal);
    const previous=state.get(modal)||{open:false,returnFocus:null};
    modal.setAttribute('aria-hidden',open?'false':'true');

    if(open&&!previous.open){
      previous.returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
      requestAnimationFrame(()=>{
        if(!visible(modal)) return;
        const target=modal.querySelector('[autofocus]')||focusables(modal)[0]||modal.querySelector('.sc-modal-dialog');
        if(target instanceof HTMLElement) target.focus({preventScroll:true});
      });
    }

    if(!open&&previous.open&&previous.returnFocus instanceof HTMLElement&&document.contains(previous.returnFocus)){
      requestAnimationFrame(()=>previous.returnFocus.focus({preventScroll:true}));
    }

    previous.open=open;
    state.set(modal,previous);
  }

  function syncAll(){
    document.querySelectorAll(selector).forEach(syncOne);
    document.body.classList.toggle('sc-modal-open',dialogs().length>0);
  }

  function closeModal(modal){
    if(!modal||modal.dataset.scModalRequired==='true') return;
    const fnName=modal.dataset.scCloseFunction;
    if(fnName&&typeof window[fnName]==='function'){
      window[fnName]();
      return;
    }
    if(modal.classList.contains('show')) modal.classList.remove('show');
    else modal.style.display='none';
  }

  document.addEventListener('keydown',event=>{
    const modal=topModal();
    if(!modal) return;

    if(event.key==='Escape'){
      if(modal.dataset.scModalRequired==='true') return;
      if(modal.dataset.scCloseFunction){
        event.preventDefault();
        closeModal(modal);
      }
      return;
    }

    if(event.key!=='Tab') return;
    const items=focusables(modal);
    if(!items.length){
      event.preventDefault();
      modal.querySelector('.sc-modal-dialog')?.focus({preventScroll:true});
      return;
    }
    const first=items[0];
    const last=items[items.length-1];
    if(event.shiftKey&&document.activeElement===first){
      event.preventDefault();
      last.focus();
    }else if(!event.shiftKey&&document.activeElement===last){
      event.preventDefault();
      first.focus();
    }
  });

  const observer=new MutationObserver(syncAll);
  observer.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['class','style','hidden']});
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',syncAll,{once:true});
  else syncAll();

  window.SCModal={sync:syncAll,close:closeModal};
})();
