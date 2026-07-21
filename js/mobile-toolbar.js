(function(){
  'use strict';

  function byId(id){return document.getElementById(id);}
  function setOpen(open){
    const menu=byId('mobile-tools-menu');
    const toggle=byId('mobile-tools-toggle');
    if(!menu||!toggle) return;
    menu.hidden=!open;
    toggle.setAttribute('aria-expanded',open?'true':'false');
    document.body.classList.toggle('mobile-tools-open',open);
  }
  function runAction(action,event){
    if(event) event.stopPropagation();
    setOpen(false);
    if(action==='excel'&&typeof exportExcel==='function') return exportExcel();
    if(action==='print'&&typeof openSchedulePrintModal==='function') return openSchedulePrintModal();
    if(action==='zoomOut'&&typeof tblZoomOut==='function') return tblZoomOut();
    if(action==='zoomReset'&&typeof tblZoomReset==='function') return tblZoomReset();
    if(action==='zoomIn'&&typeof tblZoomIn==='function') return tblZoomIn();
    if(action==='today'&&typeof resetTimeMachine==='function') return resetTimeMachine();
    if(action==='logout'&&window.SCAuth) return SCAuth.signOut();
  }
  function toggle(event){
    if(event) event.stopPropagation();
    const button=byId('mobile-tools-toggle');
    if(button) setOpen(button.getAttribute('aria-expanded')!=='true');
  }
  function init(){
    document.addEventListener('click',function(){setOpen(false);});
    document.addEventListener('keydown',function(event){
      if(event.key==='Escape') setOpen(false);
    });
    window.addEventListener('resize',function(){
      if(window.innerWidth>720) setOpen(false);
    });
  }

  window.SCMobileTools={toggle,run:runAction,close:function(){setOpen(false);}};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
