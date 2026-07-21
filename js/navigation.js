(function(){
  'use strict';

  const PAGE_PATHS={
    schedule:'index.html',
    requests:'teacher.html',
    desk:'desk.html',
    settings:'settings.html',
    parent:'parent.html',
  };
  const PAGE_BY_FILE={
    'index.html':'schedule',
    'teacher.html':'requests',
    'desk.html':'desk',
    'settings.html':'settings',
    'parent.html':'parent',
  };

  function validBranch(value){
    return value==='gagyeong'||value==='yongam' ? value : '';
  }
  function branch(){
    const query=validBranch(new URLSearchParams(location.search).get('branch'));
    if(query) return query;
    try{return validBranch(localStorage.getItem('selected_branch'));}catch(e){return '';}
  }
  function currentPage(){
    const file=(location.pathname.split('/').pop()||'index.html').toLowerCase();
    return PAGE_BY_FILE[file]||'';
  }
  function href(page){
    const path=PAGE_PATHS[page]||PAGE_PATHS.schedule;
    const selected=branch();
    return path+(selected?'?branch='+encodeURIComponent(selected):'');
  }
  function go(page){
    const target=PAGE_PATHS[page] ? page : 'schedule';
    if(target===currentPage()) return;
    location.href=href(target);
  }
  function changeBranch(next){
    next=validBranch(next);
    if(!next) return;
    try{localStorage.setItem('selected_branch',next);}catch(e){}
    const url=new URL(location.href);
    url.searchParams.set('branch',next);
    url.searchParams.delete('cb');
    location.href=url.pathname+url.search+url.hash;
  }
  function sync(){
    const selected=branch();
    const page=currentPage();
    document.querySelectorAll('[data-sc-nav]').forEach(function(el){
      const active=el.getAttribute('data-sc-nav')===page;
      el.classList.toggle('active',active);
      if(active) el.setAttribute('aria-current','page');
      else el.removeAttribute('aria-current');
      if('disabled' in el) el.disabled=active;
    });
    document.querySelectorAll('[data-sc-branch-select]').forEach(function(el){
      if(selected) el.value=selected;
    });
    document.querySelectorAll('[data-sc-branch-label]').forEach(function(el){
      el.textContent=selected==='yongam'?'용암점':'가경점';
    });
  }

  window.SCNav={branch,currentPage,href,go,changeBranch,sync};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',sync);
  else sync();
})();
