/* Shared interface only. No submission, document, rating or account writes. */
(() => {
  'use strict';
  const root = document.documentElement;
  if (!root.dataset.workspace) return;
  window.STM_UI_BUILD = 'atelier-2026.09.08.2';
  const isWorkbench = root.dataset.workspace === 'workbench';
  const validTheme = value => value === 'light' || value === 'dark';
  function savedTheme() { try { return localStorage.getItem('stm-theme'); } catch (_) { return null; } }
  let theme = validTheme(savedTheme()) ? savedTheme() : 'dark';
  function applyTheme(value, persist = true) {
    if (!validTheme(value)) return;
    theme = value;
    root.dataset.theme = value;
    root.style.colorScheme = value;
    if (persist) { try { localStorage.setItem('stm-theme', value); } catch (_) {} }
    document.querySelectorAll('.theme-toggle,#themeToggle,[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-label', value === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      button.setAttribute('title', value === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      button.setAttribute('aria-pressed', String(value === 'dark'));
      if (button.tagName === 'BUTTON') button.type = 'button';
    });
    window.dispatchEvent(new CustomEvent('stm:themechange', {detail:{theme:value}}));
  }
  function toggleTheme() { applyTheme(theme === 'dark' ? 'light' : 'dark'); }
  window.STMTheme = Object.freeze({get:() => theme, apply:applyTheme, toggle:toggleTheme});
  applyTheme(theme, false);
  // Own only theme clicks, before the opposite legacy handlers can toggle twice.
  document.addEventListener('click', event => {
    if (!event.target.closest?.('.theme-toggle,#themeToggle,[data-theme-toggle]')) return;
    event.preventDefault(); event.stopImmediatePropagation(); toggleTheme();
  }, true);
  window.addEventListener('storage', event => {
    if (event.key === 'stm-theme') applyTheme(validTheme(event.newValue) ? event.newValue : 'dark', false);
  });
  const $ = id => document.getElementById(id);
  function setText(id,value) { const el=$(id); if(el && el.textContent!==String(value))el.textContent=String(value); }
  function init() {
    applyTheme(theme,false);
    window.toggleTheme = toggleTheme;
    const nav = $('workspaceRail');
    const topbar = document.querySelector('.ws-topbar');
    if (!nav || !topbar) return;
    const badge = $('versionBadge'); if(badge)$('wsBuildSlot')?.append(badge);
    const brand = topbar.querySelector('.brand,.topbar-brand');
    if (brand && !brand.querySelector('.ws-brand-caption')) {
      const caption=document.createElement('span');caption.className='ws-brand-caption';caption.textContent='UNDERWRITING WORKSPACE';brand.append(caption);
    }
    const mainNav = $('mainNav');
    if(mainNav) {
      const sections=document.createElement('nav');sections.className='ws-section-nav';sections.setAttribute('aria-label','Underwriting sections');sections.append(mainNav);nav.after(sections);
    }
    const authTheme = document.createElement('button');authTheme.className='ws-auth-theme';authTheme.type='button';authTheme.dataset.themeToggle='';authTheme.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/></svg>';
    function decorateAuth() {
      const overlay=$('authOverlay') || $('stmAuthOverlay');
      if(overlay&&!overlay.querySelector('[data-theme-toggle]')){
        overlay.append(authTheme);
        authTheme.setAttribute('aria-label',theme==='dark'?'Switch to light mode':'Switch to dark mode');
        authTheme.title=authTheme.getAttribute('aria-label');authTheme.setAttribute('aria-pressed',String(theme==='dark'));
      }
    }
    decorateAuth();
    if(isWorkbench) {
      const authWatcher=new MutationObserver(()=>{decorateAuth();if($('stmAuthOverlay'))authWatcher.disconnect();});
      if(!$('stmAuthOverlay'))authWatcher.observe(document.body,{childList:true});
      const placeWarning=()=>{const warning=topbar.querySelector('#stmLayerTypeConflictWarn');if(warning)$('wsMain')?.before(warning);};
      new MutationObserver(placeWarning).observe(topbar,{childList:true,subtree:true});placeWarning();
    }
    const docs=$('docs-view-root');
    if(docs) {
      const brand=$('docsBackToAltitude');
      if(brand){brand.querySelector('.brand-name').textContent='File Manager';brand.querySelector('.brand-sub').textContent='Your account. Every source.';brand.title='Return to submission analysis';}
      const tags=docs.querySelector('.tags-panel');
      if(tags) {
        tags.id='wsTaggedPagesPanel';
        const toggle=document.createElement('button');toggle.type='button';toggle.className='ws-tags-toggle';toggle.textContent='Tagged pages';toggle.setAttribute('aria-controls',tags.id);toggle.setAttribute('aria-expanded','false');
        docs.querySelector('.topbar-utils')?.append(toggle);
        const close=document.createElement('button');close.type='button';close.className='ws-tags-close';close.textContent='Close';close.setAttribute('aria-label','Close tagged pages');tags.querySelector('.tags-header')?.append(close);
        function openTags(open){docs.classList.toggle('ws-tags-open',open);toggle.setAttribute('aria-expanded',String(open));(open?close:toggle).focus();}
        toggle.addEventListener('click',()=>openTags(!docs.classList.contains('ws-tags-open')));close.addEventListener('click',()=>openTags(false));tags.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();openTags(false);}});
      }
    }
    const dropzone=$('dropzone');
    if(dropzone){dropzone.tabIndex=0;dropzone.setAttribute('role','button');dropzone.setAttribute('aria-label','Upload submission documents');dropzone.addEventListener('keydown',e=>{if(e.target===dropzone&&(e.key==='Enter'||e.key===' ')){e.preventDefault();$('fileInput')?.click();}});}
    for(const [id,label] of Object.entries({webNameInput:'Insured business name',webZipInput:'ZIP code or city',webUrlInput:'Insured website address',searchInput:'Search documents'}))$(id)?.setAttribute('aria-label',label);
    for(const id of ['authError','authSuccess','stmAuthError','stmAuthSuccess'])$(id)?.setAttribute('aria-live',id.endsWith('Error')?'assertive':'polite');
    let scheduled=false, observedRun=null;
    function sync() {
      scheduled=false;
      const active=isWorkbench?'workbench':document.body.classList.contains('docs-fullwidth')?'documents':$('view-admin')?.classList.contains('active')?'admin':$('view-submission')?.classList.contains('active')?'submission':'queue';
      root.dataset.activeSystem=active;
      nav.querySelectorAll('[data-system-target]').forEach(item=>{const selected=item.dataset.systemTarget===active;item.classList.toggle('active',selected);if(selected)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');});
      const title=isWorkbench?$('heroInsuredName')?.textContent:$('sh-name')?.textContent;
      const state=window.STATE;
      const hasContext=isWorkbench||state?.activeSubmissionId||state?.newSubmissionDraftMode||state?.files?.length;
      setText('wsContextName',hasContext&&title?title:'No submission selected');
      setText('wsContextDetail',state?.pipelineRunning?'Analysis in progress':isWorkbench?'Underwriting workbench':state?.newSubmissionDraftMode?'New submission':'Account context');
      if(Array.isArray(state?.submissions)) {
        const list=state.submissions;
        const count=status=>list.filter(item=>item.status===status).length;
        setText('wsQueueCount',list.length);setText('wsReviewCount',count('AWAITING UW REVIEW'));setText('wsProgressCount',count('IN PROGRESS'));setText('wsBoundCount',count('BOUND'));
        const track=$('wsQueueDistribution');
        if(track){const signature=list.map(x=>x.status).join('|');if(track.dataset.signature!==signature){track.dataset.signature=signature;track.replaceChildren();for(const [status,cls] of [['AWAITING UW REVIEW','review'],['IN PROGRESS','progress'],['BOUND','bound']]){const span=document.createElement('span');span.className=cls;span.style.width=(list.length?count(status)/list.length*100:0)+'%';track.append(span);}}}
      }
      const nodes=[...document.querySelectorAll('#pipelineFlow [data-module].pipe-node')];
      const moduleIds=Object.keys(window.MODULES||{});
      const total=moduleIds.length||24;
      const running=!!state?.pipelineRunning;
      // Old nodes stay mounted after account changes; current STATE owns the readout.
      if(running&&state?.pipelineRun)observedRun=state.pipelineRun;
      const liveNodes=!!(state?.pipelineRun&&state.pipelineRun===observedRun);
      const extractions=state?.extractions||{};
      const done=moduleIds.filter(id=>extractions[id]&&String(extractions[id].text||'').trim()).length;
      const needsReview=new Set(moduleIds.filter(id=>extractions[id]?.rerunFailed||extractions[id]?.staleFromRerun||extractions[id]?.staleInputs8732||extractions[id]?.review_required||extractions[id]?.groundingWarning8721));
      if(liveNodes)nodes.filter(n=>n.classList.contains('error')||n.classList.contains('warn')).forEach(n=>needsReview.add(n.dataset.module));
      const errors=needsReview.size;
      const allSettled=!!state?.pipelineDone;
      setText('wsAnalysisCount',done);setText('wsAnalysisTotal','/ '+total);
      const orbit=document.querySelector('.ws-orbit');
      if(orbit){orbit.style.setProperty('--progress',((done/total)*360)+'deg');orbit.setAttribute('aria-valuemax',String(total));orbit.setAttribute('aria-valuenow',String(done));}
      setText('wsPipelineState',running?'ANALYSIS IN PROGRESS':errors?'REVIEW REQUIRED':allSettled?'ANALYSIS COMPLETE':state?.files?.length?'READY TO ANALYZE':'AWAITING DOCUMENTS');
      setText('wsPipelineTitle',running?'Building your account intelligence.':errors?'Some modules need attention.':allSettled?'The account, brought into focus.':'Your next decision starts here.');
      setText('wsPipelineDetail',running?done+' of '+total+' modules completed.':errors?errors+' module'+(errors===1?' needs':'s need')+' review.':allSettled?'Review the results alongside their sources.':'Classify. Extract. Synthesize. Analyze.');
      document.querySelectorAll('[data-stage-source]').forEach(item=>{
        const stageNodes=[...($(item.dataset.stageSource)?.querySelectorAll('.pipe-node')||[])];
        const status=liveNodes?(stageNodes.some(n=>n.classList.contains('error')||n.classList.contains('warn'))?'error':stageNodes.some(n=>n.classList.contains('running'))?'running':stageNodes.length&&stageNodes.every(n=>n.classList.contains('done')||n.classList.contains('skipped'))?'done':'queued'):(allSettled?'done':'queued');
        item.dataset.status=status;item.title=item.querySelector('strong').textContent+': '+status;
      });
      document.querySelectorAll('#queueBody tr.sub-row').forEach(row=>{
        if(row.dataset.wsAccessible)return;row.dataset.wsAccessible='true';row.tabIndex=0;row.setAttribute('aria-label','Open submission: '+(row.querySelector('.acct-name')?.textContent||'Account').replace(/ACTIVE|×/g,'').trim());row.addEventListener('keydown',e=>{if(e.target===row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();row.click();}});
      });
    }
    function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(sync);}}
    const watcher=new MutationObserver(schedule);
    watcher.observe(document.body,{attributes:true,attributeFilter:['class']});
    for(const id of ['view-queue','view-submission','view-admin']){const el=$(id);if(el)watcher.observe(el,{attributes:true,attributeFilter:['class']});}
    for(const id of ['sh-name','sh-meta','queueBody','heroInsuredName','fileList','pipelineFlow']){const el=$(id);if(el)watcher.observe(el,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class']});}
    document.addEventListener('change',schedule);window.addEventListener('hashchange',schedule);
    nav.addEventListener('click',event=>{const item=event.target.closest('[data-system-target]');if(item&&innerWidth<900)item.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});},true);
    applyTheme(theme,false);sync();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
