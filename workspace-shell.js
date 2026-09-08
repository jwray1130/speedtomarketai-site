/* Shared interface only. No submission, document, rating or account writes. */
(() => {
  'use strict';
  const root = document.documentElement;
  if (!root.dataset.workspace) return;
  window.STM_UI_BUILD = 'workspace-2026.09.08.4';
  const isWorkbench = root.dataset.workspace === 'workbench';
  const validTheme = value => value === 'light' || value === 'dark';
  function savedTheme() { try { return localStorage.getItem('stm-theme'); } catch (_) { return null; } }
  let theme = validTheme(savedTheme()) ? savedTheme() : 'dark';
  function applyTheme(value, persist = true) {
    if (!validTheme(value)) return;
    theme = value;
    if (window.requestAnimationFrame) {
      root.dataset.themeSwitching='true';
      window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>delete root.dataset.themeSwitching));
    }
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
    for(const id of ['mainNav','riskNav','formsNav'])$(id)?.addEventListener('click',()=>{if($('wsMain'))$('wsMain').scrollTop=0;});
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
      // A system viewport must not inherit a transformed or filtered pipeline ancestor.
      if(docs.parentElement!==document.body)document.body.append(docs);
      const brand=$('docsBackToAltitude');
      if(brand){brand.querySelector('.brand-name').textContent='Evidence library';brand.querySelector('.brand-sub').textContent='File Manager / Source documents & annotated pages';brand.title='Return to submission analysis';}
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
    let queueFilter='all',selectedModule=null,selectedContext=null,blueprintBuilt=false,indexSignature='',sourceContext;
    function selectMapWave(wave){root.dataset.mapWave=String(wave);document.querySelectorAll('[data-map-wave]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mapWave===String(wave))));}
    document.querySelectorAll('[data-map-wave]').forEach(button=>button.addEventListener('click',()=>selectMapWave(button.dataset.mapWave)));
    const filterStatuses={review:'AWAITING UW REVIEW',progress:'IN PROGRESS',bound:'BOUND'};
    function filterQueue(){
      if(!$('wsQueueSearch'))return;
      const query=$('wsQueueSearch').value.trim().toLowerCase();let visible=0;
      const rows=[...document.querySelectorAll('#queueBody tr.sub-row')];
      rows.forEach(row=>{const matches=(!query||row.textContent.toLowerCase().includes(query))&&(queueFilter==='all'||row.querySelector('.status-pill')?.textContent.trim()===filterStatuses[queueFilter]);row.hidden=!matches;if(matches)visible++;});
      setText('wsQueueMatches',query||queueFilter!=='all'?visible+' of '+rows.length:'');
      $('wsQueueNoMatches').hidden=visible>0||!rows.length;
    }
    $('wsQueueSearch')?.addEventListener('input',filterQueue);
    document.querySelectorAll('[data-queue-filter]').forEach(button=>button.addEventListener('click',()=>{queueFilter=button.dataset.queueFilter;document.querySelectorAll('[data-queue-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));filterQueue();}));
    function sourcesOpen(open){document.body.classList.toggle('ws-sources-open',open);document.body.classList.toggle('ws-sources-collapsed',!open);$('wsSourcesToggle')?.setAttribute('aria-expanded',String(open));}
    $('wsSourcesToggle')?.addEventListener('click',()=>{const open=!document.body.classList.contains('ws-sources-open');sourcesOpen(open);if(open&&$('wsSourcesToggle')?.dataset.pending==='true')requestAnimationFrame(()=>$('pendingDock8747')?.scrollIntoView({block:'nearest'}));});
    const sourceHeading=document.querySelector('.ws-source-pane .pane-head');
    if(sourceHeading){const close=document.createElement('button');close.type='button';close.className='ws-source-close';close.setAttribute('aria-label','Close source intake');close.textContent='×';close.addEventListener('click',()=>{sourcesOpen(false);$('wsSourcesToggle')?.focus();});sourceHeading.append(close);}
    function inspectorOpen(open){document.body.classList.toggle('ws-inspector-open',open);$('wsInspectorToggle')?.setAttribute('aria-expanded',String(open));setText('wsDrawerTitle',selectedModule?'Result detail':'Account tools');}
    $('wsInspectorToggle')?.addEventListener('click',()=>{if(selectedModule){closeInspector();inspectorOpen(true);}else inspectorOpen(!document.body.classList.contains('ws-inspector-open'));});
    function closeInspector(){selectedModule=null;if($('wsModuleInspector'))$('wsModuleInspector').hidden=true;inspectorOpen(false);document.querySelectorAll('.ws-selected,.ws-upstream').forEach(n=>n.classList.remove('ws-selected','ws-upstream'));document.querySelectorAll('.ws-network-edges').forEach(n=>n.remove());}
    $('wsInspectorClose')?.addEventListener('click',closeInspector);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('ws-inspector-open')){closeInspector();$('wsInspectorToggle')?.focus();}else if(e.key==='Escape'&&document.body.classList.contains('ws-sources-open')){sourcesOpen(false);$('wsSourcesToggle')?.focus();}});
    function moduleStatus(id,live){
      const state=window.STATE||{},ex=state.extractions?.[id];
      const node=[...document.querySelectorAll('#pipelineFlow .pipe-node[data-module]')].find(n=>n.dataset.module===id);
      if(live&&node){for(const s of ['running','error','warn','skipped','done'])if(node.classList.contains(s))return s;}
      if(ex?.rerunFailed||ex?.staleFromRerun||ex?.staleInputs8732||ex?.review_required||ex?.groundingWarning8721)return 'warn';
      return String(ex?.text||'').trim()?'done':state.pipelineDone?'unavailable':'planned';
    }
    function refreshInspector(live){
      const host=$('wsModuleInspector');if(!host||!selectedModule)return;
      const m=window.MODULES?.[selectedModule];if(!m){closeInspector();return;}
      host.hidden=false;setText('wsModuleCode',m.code);setText('wsModuleName',m.name);
      const status=moduleStatus(selectedModule,live);
      setText('wsModuleState',({done:'OUTPUT AVAILABLE',warn:'REVIEW REQUIRED',error:'ANALYSIS FAILED',running:'ANALYSIS IN PROGRESS',skipped:'SKIPPED',unavailable:'NO STORED OUTPUT',planned:'AWAITING ANALYSIS'})[status]);
      const upstream=[...(m.deps||[]),...(m.optionalDeps||[])];
      const deps=$('wsModuleDependencies'),signature=selectedModule+JSON.stringify(upstream.map(id=>[id,moduleStatus(id,live)]));
      if(deps.dataset.signature!==signature){deps.dataset.signature=signature;deps.replaceChildren();
        if(!upstream.length){const p=document.createElement('p');p.textContent='Uploaded source documents';p.className='ws-module-dependency';deps.append(p);}
        for(const id of upstream){const line=document.createElement('div');line.className='ws-module-dependency';const name=document.createElement('span');name.textContent=window.MODULES[id]?.name||id;const kind=document.createElement('small');kind.textContent=(m.deps||[]).includes(id)?'CORE':'SUPPORTING';line.append(name,kind);deps.append(line);}
      }
      const output=String(window.STATE?.extractions?.[selectedModule]?.text||'').trim();
      setText('wsModulePreview',output?(output.slice(0,1100)+(output.length>1100?'\n…':'')):'This module has no stored output. Its result will appear here after a successful analysis.');
      $('wsReviewModule').disabled=!output;
      document.querySelectorAll('.pipe-node[data-module],.pipe-node[data-inspect-module]').forEach(node=>{const id=node.dataset.module||node.dataset.inspectModule;for(const [name,on]of[['ws-selected',id===selectedModule],['ws-upstream',upstream.includes(id)]])if(node.classList.contains(name)!==on)node.classList.toggle(name,on);});
    }
    document.addEventListener('click',e=>{
      const node=e.target.closest?.('.pipe-node[data-module],.pipe-node[data-inspect-module]');if(!node)return;
      selectedModule=node.dataset.module||node.dataset.inspectModule;selectedContext=window.STATE?.activeSubmissionId;inspectorOpen(true);refreshInspector(!!window.STATE?.pipelineRunning);drawDependencies();$('wsInspectorClose')?.focus();
    });
    document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('.pipe-node[data-module],.pipe-node[data-inspect-module]')){e.preventDefault();e.target.click();}});
    $('wsReviewModule')?.addEventListener('click',()=>{
      if(!selectedModule)return;const id=selectedModule;
      window.showStage?.('sum');closeInspector();
      requestAnimationFrame(()=>{const card=[...document.querySelectorAll('#summaryCards [data-mid]')].find(el=>el.dataset.mid===id);if(card){revealCard(card);}else $('summaryStage')?.scrollIntoView({block:'start'});});
    });
    function revealCard(card){if(card.classList.contains('collapsed')){const head=card.querySelector('.sc-head');if(head&&window.toggleCard)window.toggleCard(head);else card.classList.remove('collapsed');}card.scrollIntoView({block:'start',behavior:'auto'});card.tabIndex=-1;card.focus({preventScroll:true});}
    function blueprint(){
      const host=$('wsBlueprint');if(!host||blueprintBuilt||!Object.keys(window.MODULES||{}).length)return;blueprintBuilt=true;
      for(const [wave,title,caption]of[[0,'Classify','Document routing'],[1,'Extract','Source intelligence'],[2,'Synthesize','Account context'],[3,'Analyze','Underwriting insight']]){
        const lane=document.createElement('section');lane.className='pipe-stage';lane.dataset.wave=String(wave);const head=document.createElement('div');head.className='pipe-stage-label';head.textContent='0'+(wave+1)+' / '+title;const description=document.createElement('em');description.textContent=caption;head.append(description);lane.append(head);
        const nodes=document.createElement('div');nodes.className='pipe-nodes';if(wave===1)nodes.style.gridTemplateColumns='repeat(2,minmax(0,1fr))';
        const modules=wave===0?[['classifier',{code:'CLS',name:'Document routing'}]]:Object.entries(window.MODULES).filter(([id,m])=>m.wave===wave);
        for(const [id,m]of modules){const node=document.createElement('div');node.className='pipe-node';if(id!=='classifier')node.dataset.inspectModule=id;const h=document.createElement('div');h.className='pipe-node-head';const code=document.createElement('span');code.className='pipe-node-tag';code.textContent=m.code;const status=document.createElement('span');status.className='pipe-node-status';status.textContent='PLANNED';h.append(code,status);const name=document.createElement('div');name.className='pipe-node-name';name.textContent=m.name;node.append(h,name);
          if(wave===2){const detail=document.createElement('p');detail.className='ws-node-description';detail.textContent=id==='summary-ops'?'Operations, controls and business context.':'Underlying policies and the excess structure.';node.append(detail);}
          nodes.append(node);}
        lane.append(nodes);host.append(lane);
      }
    }
    function storedBoard(live){
      if(!$('wsBlueprint'))return;
      root.dataset.pipelineMode=live?'live':'stored';
      if(live)return;
      const state=window.STATE||{};
      if(state.pipelineDone){setText('pipelineEmptyHeading','Account intelligence, connected.');setText('pipelineEmptyBody','Select a module to inspect its sources, dependencies, and saved output. Modules without saved outputs are clearly marked.');}
      document.querySelectorAll('#wsBlueprint [data-inspect-module]').forEach(node=>{
        const status=moduleStatus(node.dataset.inspectModule,false),label=({done:'AVAILABLE',warn:'REVIEW',unavailable:'NO OUTPUT',planned:'PLANNED'})[status]||status.toUpperCase();
        if(node.dataset.status!==status){node.dataset.status=status;node.classList.remove('done','warn','error','running','skipped');if(status==='done'||status==='warn')node.classList.add(status);const badge=node.querySelector('.pipe-node-status');badge.textContent=label;badge.className='pipe-node-status '+status;}
      });
    }
    function drawDependencies(){
      const boards=[$('pipelineFlow'),$('wsBlueprint')].filter(Boolean);
      for(const board of boards){
        const previous=board.querySelector('.ws-network-edges');
        if(!board.getBoundingClientRect?.().width){previous?.remove();continue;}
        const nodes=[...board.querySelectorAll('[data-module],[data-inspect-module]')];
        const rect=board.getBoundingClientRect();
        const paths=[];
        const targets=selectedModule?nodes.filter(n=>(n.dataset.module||n.dataset.inspectModule)===selectedModule):nodes.filter(n=>window.MODULES[n.dataset.module||n.dataset.inspectModule]?.wave>=2);
        for(const target of targets){
          const m=window.MODULES[target.dataset.module||target.dataset.inspectModule],targetRect=target.getBoundingClientRect();if(!m)continue;
          for(const id of [...(m.deps||[]),...(selectedModule?m.optionalDeps||[]:[])]){
            const source=nodes.find(n=>(n.dataset.module||n.dataset.inspectModule)===id);if(!source)continue;const r=source.getBoundingClientRect();
            const x1=r.right-rect.left,y1=r.top-rect.top+r.height/2,x2=targetRect.left-rect.left,y2=targetRect.top-rect.top+targetRect.height/2;
            const dx=Math.max(24,(x2-x1)*.52);paths.push({d:`M${x1},${y1} C${x1+dx},${y1} ${x2-dx},${y2} ${x2},${y2}`,support:!(m.deps||[]).includes(id)});
          }
        }
        const signature=JSON.stringify(paths);if(previous?.dataset.signature===signature)continue;previous?.remove();
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('ws-network-edges');svg.dataset.signature=signature;svg.dataset.focused=String(!!selectedModule);svg.setAttribute('aria-hidden','true');svg.setAttribute('width',String(board.scrollWidth));svg.setAttribute('height',String(board.scrollHeight));
        for(const item of paths){const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',item.d);path.setAttribute('class',item.support?'supporting':'core');svg.append(path);}board.append(svg);
      }
    }
    window.addEventListener('resize',()=>requestAnimationFrame(drawDependencies));
    function summaryIndex(){
      const index=$('wsSummaryIndex');if(!index)return;
      const cards=[...document.querySelectorAll('#summaryCards .sc-card[data-mid]')];
      const signature=cards.map(c=>c.dataset.mid+'|'+(c.querySelector('h3')?.textContent||'')).join('|');if(signature===indexSignature)return;indexSignature=signature;index.replaceChildren();
      for(const card of cards){const id=card.dataset.mid;const button=document.createElement('button');button.type='button';button.textContent=window.MODULES?.[id]?.name||card.querySelector('h3')?.textContent||'Custom note';button.addEventListener('click',()=>{const current=[...document.querySelectorAll('#summaryCards .sc-card[data-mid]')].find(c=>c.dataset.mid===id);if(current)revealCard(current);});index.append(button);}
    }
    let scheduled=false, observedRun=null;
    function sync() {
      scheduled=false;
      const active=isWorkbench?'workbench':document.body.classList.contains('docs-fullwidth')?'documents':$('view-admin')?.classList.contains('active')?'admin':$('view-submission')?.classList.contains('active')?'submission':'queue';
      const previous=root.dataset.activeSystem;
      root.dataset.activeSystem=active;
      $('wsSourcesToggle')?.setAttribute('aria-expanded',String(document.body.classList.contains('ws-sources-open')));
      if(previous&&previous!==active){const main=$('wsMain');if(main)main.scrollTop=0;closeInspector();}
      if($('wsMain'))$('wsMain').inert=active==='documents';
      nav.querySelectorAll('[data-system-target]').forEach(item=>{const selected=item.dataset.systemTarget===active;item.classList.toggle('active',selected);if(selected)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');});
      const title=isWorkbench?$('heroInsuredName')?.textContent:$('sh-name')?.textContent;
      const state=window.STATE;
      const contextKey=String(state?.activeSubmissionId||'draft');
      if(sourceContext!==contextKey){sourceContext=contextKey;sourcesOpen(!(state?.pipelineDone||state?.pipelineRunning));selectMapWave(state?.pipelineDone?3:1);}
      root.dataset.analysisComplete=String(!!state?.pipelineDone);
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
      for(const wave of [1,2,3])setText('wsWave'+wave+'Count',moduleIds.filter(id=>window.MODULES[id].wave===wave).length);
      const total=moduleIds.length||24;
      const running=!!state?.pipelineRunning;
      // Old nodes stay mounted after account changes; current STATE owns the readout.
      if(running&&state?.pipelineRun&&observedRun!==state.pipelineRun){observedRun=state.pipelineRun;sourcesOpen(false);}
      const liveNodes=!!(state?.pipelineRun&&state.pipelineRun===observedRun);
      const extractions=state?.extractions||{};
      const done=moduleIds.filter(id=>extractions[id]&&String(extractions[id].text||'').trim()).length;
      const needsReview=new Set(moduleIds.filter(id=>extractions[id]?.rerunFailed||extractions[id]?.staleFromRerun||extractions[id]?.staleInputs8732||extractions[id]?.review_required||extractions[id]?.groundingWarning8721));
      if(liveNodes)nodes.filter(n=>n.classList.contains('error')||n.classList.contains('warn')).forEach(n=>needsReview.add(n.dataset.module));
      const errors=needsReview.size;
      setText('wsReviewFlags',errors?errors+' to review':'');
      const allSettled=!!state?.pipelineDone;
      setText('wsAnalysisCount',done);setText('wsAnalysisTotal','/ '+total);
      const orbit=document.querySelector('.ws-orbit');
      if(orbit){orbit.style.setProperty('--progress',((done/total)*360)+'deg');orbit.setAttribute('aria-valuemax',String(total));orbit.setAttribute('aria-valuenow',String(done));}
      setText('wsPipelineState',running?'ANALYSIS IN PROGRESS':errors?'REVIEW REQUIRED':allSettled?'ANALYSIS COMPLETE':state?.files?.length?'READY TO ANALYZE':'AWAITING DOCUMENTS');
      setText('wsPipelineTitle',running?'Building your account intelligence.':errors?'Some modules need attention.':allSettled?'The account, brought into focus.':'Your next decision starts here.');
      setText('wsPipelineDetail',running?done+' outputs available.':errors?errors+' module'+(errors===1?' needs':'s need')+' review.':allSettled?'Review results against source evidence.':'Classify → Extract → Synthesize → Analyze');
      document.querySelectorAll('[data-stage-source]').forEach(item=>{
        const stageNodes=[...($(item.dataset.stageSource)?.querySelectorAll('.pipe-node')||[])];
        const status=liveNodes?(stageNodes.some(n=>n.classList.contains('error')||n.classList.contains('warn'))?'error':stageNodes.some(n=>n.classList.contains('running'))?'running':stageNodes.length&&stageNodes.every(n=>n.classList.contains('done')||n.classList.contains('skipped'))?'done':'queued'):(allSettled?'done':'queued');
        item.dataset.status=status;item.title=item.querySelector('strong').textContent+': '+status;
      });
      document.querySelectorAll('#queueBody tr.sub-row').forEach(row=>{
        if(row.dataset.wsAccessible)return;row.dataset.wsAccessible='true';row.tabIndex=0;row.setAttribute('aria-label','Open submission: '+(row.querySelector('.acct-name')?.textContent||'Account').replace(/ACTIVE|×/g,'').trim());row.addEventListener('keydown',e=>{if(e.target===row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();row.click();}});
      });
      blueprint();storedBoard(liveNodes);summaryIndex();filterQueue();
      for(const [id,wave] of [['stageClassifier',0],['wave1',1],['wave2',2],['wave3',3]]){const lane=$(id)?.closest('.pipe-stage');if(lane)lane.dataset.wave=String(wave);}
      const dock=$('pendingDock8747'),pending=!!dock&&(dock.classList.contains('pd-pending')||!!dock.querySelector('.sb-a8'))&&dock.style.display!=='none';
      if($('wsSourcesToggle')){$('wsSourcesToggle').dataset.pending=String(pending);setText('wsSourcesToggle',pending?'Sources · refresh pending':'Sources');}
      setText('wsMapAvailability',done+' of '+total+' outputs available'+(errors?' · '+errors+' need review':'')+(pending?' · Refresh pending':''));
      if($('wsBlueprint')){
        $('wsBlueprint').setAttribute('aria-label',state?.pipelineDone?'Stored analysis modules':'Planned analysis modules');
        const classifier=$('wsBlueprint').querySelector('.pipe-stage:first-child .pipe-node-status');if(classifier)classifier.textContent=state?.pipelineDone?'INTAKE':'PLANNED';
      }
      document.querySelectorAll('.pipe-node[data-module],.pipe-node[data-inspect-module]').forEach(node=>{const id=node.dataset.module||node.dataset.inspectModule,status=moduleStatus(id,liveNodes),label=({done:'Output available',warn:'Review required',error:'Analysis failed',running:'Analysis in progress',skipped:'Skipped',unavailable:'No stored output',planned:'Awaiting analysis'})[status]||status;node.tabIndex=0;node.setAttribute('role','button');node.setAttribute('aria-label','Inspect '+(window.MODULES?.[id]?.name||id)+' — '+label);node.setAttribute('title',(window.MODULES?.[id]?.name||id)+': '+label);});
      if(selectedModule&&selectedContext!==state?.activeSubmissionId)closeInspector();
      refreshInspector(liveNodes);
      drawDependencies();
    }
    function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(sync);}}
    const watcher=new MutationObserver(schedule);
    watcher.observe(document.body,{attributes:true,attributeFilter:['class']});
    for(const id of ['view-queue','view-submission','view-admin']){const el=$(id);if(el)watcher.observe(el,{attributes:true,attributeFilter:['class']});}
    for(const id of ['sh-name','sh-meta','queueBody','heroInsuredName','fileList','pipelineFlow','summaryCards']){const el=$(id);if(el)watcher.observe(el,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class']});}
    if($('pendingDock8747'))watcher.observe($('pendingDock8747'),{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','style']});
    document.addEventListener('change',schedule);window.addEventListener('hashchange',schedule);
    nav.addEventListener('click',()=>{const main=$('wsMain');if(main)main.scrollTop=0;},true);
    applyTheme(theme,false);sync();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
