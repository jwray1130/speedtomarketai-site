/* v9.9.2 - redesigned shell runtime over the July engine frames. */
(function(){'use strict';
const C=STMIntegration, F=STMFoundation, esc=C.escape;let gate=new C.SerialGate();
let platform=null,workbench=null,pframe=null,wframe=null,authenticated=false,actorId=null;
let busy=0,opening=false,routeSequence=0,wbGeneration=0,savePromise=null,workbenchWait=null,lastFingerprint='',lastError='',pendingDeepLink=null,wbLoadPromise=null,wbLoadSid=null,statusNotice=null,runStarting=false,wbSourceStamp=null,nativeDialogBorrow=null,documentEditor=null,intakeJobs=0;
const presentationDialogs=new Set();
let sessionEpoch=0,authHostSuffix="",historyPending=null,bootAuthError="";
const originalGo=go, originalFrameFor=frameFor;
const R=window.STM_RUNTIME={dealType:'New',freshTab:null,
 fonts:FONTS,get route(){return state.route;},get theme(){return state.theme;},get platformWindow(){return platform;},get workbenchWindow(){return workbench;},get activeId(){return platform?.STATE?.activeSubmissionId||null;},get user(){return platform?.currentUser||null;},navigatingNative:false,
 registerDialog(){const token={};presentationDialogs.add(token);let open=true;return ()=>{if(open){open=false;presentationDialogs.delete(token);}};},
 get dialogOpen(){return presentationDialogs.size>0||!!R.workbenchDialog||!!nativeDialogBorrow||!!documentEditor;},
 toast(message,type){toast(String(message));if(type==='error'){lastError=String(message);status('Attention: '+lastError,'error');}},
 workbenchChanged(){status('Unsaved workbench changes','dirty');},workbenchReady(w){if(w===wframe?.contentWindow){workbench=w;workbenchWait?.resolve(w);}},
 nativeDialogChanged(open){
  if(documentEditor)return;
  if(open){
   if(!authenticated||nativeDialogBorrow)return;
   if(pframe?.classList.contains('on'))return;
   nativeDialogBorrow={route:state.route,focus:document.activeElement?.contentDocument?.activeElement||document.activeElement};
   pframe.classList.add('stm-native-modal');platform.document.body.classList.add('stm-native-overlay');
   setTimeout(()=>platform.document.querySelector('.modal-backdrop.open input,.modal-backdrop.open textarea,#preflight8733 button,#docs-view-root .preview-modal.visible button')?.focus(),0);
  }else if(nativeDialogBorrow){
   const borrow=nativeDialogBorrow;nativeDialogBorrow=null;pframe?.classList.remove('stm-native-modal');platform?.document.body.classList.remove('stm-native-overlay');
   try{borrow.focus?.focus({preventScroll:true});}catch(_){}
  }
 },
 nativeNavigated(id){if(['wb-deal','wb-loss','wb-limits','wb-gl','wb-al','wb-internal','wb-forms','wb-subj','wb-uw','wb-renewal','wb-history'].includes(id)&&id!==state.route){R.go(id);return;}if(F.validRoute(id)&&id!==state.route){state.route=id;history.pushState(null,'',routeUrl(id));renderChrome();updateChrome();}},
 closeActions(){document.getElementById('stm-action-menu')?.remove();},
 async openDocumentEditor(id){
  requireAuth();ensureNotRunning();if(documentEditor)return;
  await platform.docsView.design.load(id);await R.navigate('sub-docs');
  const focus=document.activeElement?.contentDocument?.activeElement||document.activeElement;
  documentEditor={focus};platform.document.body.classList.add('stm-document-editor');pframe.classList.add('stm-native-modal');
  const bar=platform.document.createElement('div');bar.id='stm-document-editor-close';
  bar.innerHTML='<b>Document editor</b><span>Original annotation and page tools</span><button type="button" class="btn btn-primary">Save &amp; return to Index + Viewer</button><span role="status"></span>';
  platform.document.body.prepend(bar);bar.querySelector('button').onclick=()=>R.closeDocumentEditor().catch(e=>{bar.querySelector('[role=status]').textContent=e.message;});
  platform.docsView.design.tools(id);bar.querySelector('button').focus();
 },
 async closeDocumentEditor(){
  if(!documentEditor)return;await platform.docsView.design.flush();
  const old=documentEditor;documentEditor=null;platform.document.getElementById('stm-document-editor-close')?.remove();
  platform.document.body.classList.remove('stm-document-editor');pframe.classList.remove('stm-native-modal');try{old.focus?.focus();}catch(_){}R.sync();
 },
 async platformReady(w){
  if(w!==pframe?.contentWindow)return;platform=w;
  try{await w.stmAuth?.ready;}catch(_){}
  if(w!==pframe?.contentWindow)return;
  try{if(w.location.protocol!=='about:')w.history.replaceState(null,'',w.location.pathname);}catch(_){}
  R.sync();
 },
 sync(){
  if(!platform?.STATE)return;
  const user=platform.currentUser,overlay=platform.document.getElementById('authOverlay');
  const signed=!!user?.id && (!overlay||overlay.style.display==='none');
  if(!signed){if(authenticated){resetSessionHost();return;}showAuth();updateChrome();return;}
  if(actorId&&actorId!==user.id){resetSessionHost();return;}
  const first=!authenticated;if(first)sessionEpoch++;authenticated=true;actorId=user.id;
  document.getElementById('stm-auth-gate')?.remove();
  USER.name=user.display_name||user.user_metadata?.display_name||user.email?.split('@')[0]||'User';USER.initials=USER.name.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();USER.role=user.role==='admin'?'Administrator':'Underwriter';
  if(first){renderChrome();if(!pendingDeepLink)R.navigate(state.route||'queue',false).catch(showError);}
  const s=platform.STATE;
  if(documentEditor){const info=platform.docsView?.design?.status(),el=platform.document.querySelector('#stm-document-editor-close [role=status]');if(el)el.textContent=info?.error||info?.localError||(info?.dirty?'Changes pending cloud sync':'Document changes synced');}
  const fingerprint=JSON.stringify({active:s.activeSubmissionId,draft:s.newSubmissionDraftMode,sub:s.submissions.map(r=>C.queueRecord(r,s.activeSubmissionId)),files:s.files.map(f=>[f.id,f.name,f.state,f.status,f.parsed,f.classification,f.error,f.needsReview,(f.text||'').length]),running:s.pipelineRunning,done:s.pipelineDone,ext:Object.entries(s.extractions).map(([k,x])=>[k,x.text,x.confidence,x.timing,x.cost,x.rejected,x.staleInputs8732]),edits:s.edits,customCards:s.customCards,hiddenCards:s.hiddenCards,summarySave:platform.__STM_SUBMISSION?.status(),docSave:platform.docsView?.design?.status(),operation:platform.__STM_SUBMISSION?.busy,handoff:s.handoff,docs:platform.docsView?.design?.revision(),audit:s.audit.length,cost:s.runTotalCost,hydrating:s._queueHydrating});
  if(fingerprint!==lastFingerprint||s.pipelineRunning||platform.__STM_SUBMISSION?.busy){lastFingerprint=fingerprint;for(const id of ['queue','sub-pipe','sub-sum','sub-docs']){const f=frames[id];try{f?.contentWindow?.STMDesign?.refresh();}catch(e){showError(e);}}updateChrome();}R.syncDealType();
  if(pendingDeepLink&&!s._queueHydrating&&!opening){const deep=pendingDeepLink;pendingDeepLink=null;R.open(deep.id,deep.route,false).catch(async e=>{showError(e);if(authenticated){await R.navigate('queue',false);replaceCurrentLocation();}});}
 },
 async navigate(id,push=true){
  if(R.dialogOpen&&id!==state.route)throw new Error('Close the active dialog before navigating.');
  if(!F.validRoute(id))id='queue';const ticket=++routeSequence,epoch=sessionEpoch;R.closeActions();
  if(!authenticated){state.route=id;renderChrome();updateChrome();showAuth();return;}
  if(id==='admin'&&R.user?.role!=='admin'){R.toast('Administrator access is required.','error');return;}
  if(id.startsWith('wb-')){
   /* v9.9.5: the workbench opens without a submission too, blank, exactly as July's standalone workbench did */
    setBusy(true,'Opening workbench...');try{await ensureWorkbench();}catch(e){showError(e);throw e;}finally{setBusy(false,null,epoch);}if(ticket!==routeSequence||epoch!==sessionEpoch)return;
  }
  if(id==='sub-docs'&&!R.activeId){platform.STATE.newSubmissionDraftMode=true;}
  if(ticket!==routeSequence||epoch!==sessionEpoch)return;
  originalGo(id,false);if(push&&currentDestinationKey()!==destinationKey(id,R.activeId))history.pushState(null,'',routeUrl(id));
  if(id.startsWith('wb-')){
   R.navigatingNative=true;try{workbench.__STM_WB.navigate(id);}finally{R.navigatingNative=false;}
   setNativeTitle(workbench,id);
  } else if(['sub-sum','sub-docs','admin'].includes(id)){
   platform.document.body.dataset.integrationRoute=id;
   platform.switchView(id==='admin'?'admin':'submission');
   if(id!=='admin')platform.showStage(id==='sub-docs'?'docs':'sum');
   if(id==='sub-docs'){platform.initDocumentsView?.();if(R.activeId)platform.docsView?.setSubmissionContext(R.activeId,activeRecord()?.account||'');else platform.docsView?.setDraftSubmissionContext('New submission');}
  }
  setThemeOnHosts();updateChrome();
  if(frames[id]?.contentWindow?.STMDesign)frames[id].contentWindow.STMDesign.refresh();
 },
 setDealType(type){if(!workbench?.__STM_WB_PHASE9)throw new Error('Open a submission in the workbench before changing its deal type.');if(!['New','Renewal'].includes(type))throw new Error('Invalid deal type.');if(type===R.dealType)return;workbench.__STM_WB_PHASE9.setType(R.activeId,type);R.dealType=type;R.freshTab=type==='Renewal'?'Renewal':null;renderChrome();updateChrome();if(type==='Renewal')R.toast('Renewal chapter added to this deal');else if(state.route==='wb-renewal')R.navigate('wb-deal').catch(showError);setTimeout(()=>{R.freshTab=null;},900);},
 syncDealType(){const t=workbench?.__STM_WB_PHASE9?.type?.()||'New';if(t!==R.dealType){R.dealType=t;renderChrome();updateChrome();if(t!=='Renewal'&&state.route==='wb-renewal')R.navigate('wb-deal').catch(showError);}},
 go(id){return R.navigate(id).catch(showError);},
 open(id,target='sub-sum',push=true){
  const epoch=sessionEpoch;return gate.latest(async()=>{requireSession(epoch);ensureNotRunning();opening=true;setBusy(true,'Loading submission...');try{
   const rec=platform.STATE.submissions.find(s=>s.id===id);if(!rec)throw new Error('That submission is not in your current queue.');
   if(id!==R.activeId){await saveWorkbenchBeforeLeaving();await saveActiveSnapshot();requireSession(epoch);disposeWorkbench();await platform.rehydrateSubmission(id);requireSession(epoch);if(platform.STATE.activeSubmissionId!==id)throw new Error('The submission could not be loaded. The previous submission has not been replaced.');if(rec.snapshot?._stmRunComplete===false){platform.STATE.pipelineDone=false;platform.updateRunButton?.();}destroyDesignFrames();}
   await R.navigate(target,push);R.sync();return {id};
  }finally{if(epoch===sessionEpoch)opening=false;setBusy(false,null,epoch);}});
 },
 newSubmission(){const epoch=sessionEpoch;return gate.run(async()=>{requireSession(epoch);ensureNotRunning();opening=true;setBusy(true,'Starting new submission...');try{
  await saveWorkbenchBeforeLeaving();await saveActiveSnapshot();requireSession(epoch);disposeWorkbench();await platform.startNewSubmission();requireSession(epoch);destroyDesignFrames();
  platform.initDocumentsView?.();platform.docsView?.setDraftSubmissionContext('New submission');
  if(platform.STATE.files.length||Object.keys(platform.STATE.extractions).length||platform.STATE.activeSubmissionId)throw new Error('Fresh-submission reset failed; intake remains locked.');
  await R.navigate('sub-pipe');R.sync();return {draft:true};
 }finally{if(epoch===sessionEpoch)opening=false;setBusy(false,null,epoch);}});},
 async save(){if(savePromise)return savePromise;const epoch=sessionEpoch;const pendingSave=gate.run(async()=>{requireSession(epoch);ensureNotRunning();if(nativeDialogBorrow)throw new Error('Finish the active dialog before saving.');setBusy(true,'Saving...');try{
  let result=null;if(workbench?.__STM_WB?.submissionId===R.activeId){result=await workbench.__STM_WB.save();if(result.mode!=='cloud'){status('Saved on this browser only. Cloud sync failed; keep this tab open.','error');throw new Error(result.error?.message||'Workbench saved locally only. Cloud storage or its field-edits table is unavailable.');}}
  requireSession(epoch);await saveActiveSnapshot();requireSession(epoch);status('Saved to cloud','saved');R.toast('Saved to cloud.');return result||{mode:'cloud'};
 }finally{setBusy(false,null,epoch);}}).catch(e=>{if(epoch===sessionEpoch)showError(e);return {mode:'error',message:e.message};}).finally(()=>{if(savePromise===pendingSave)savePromise=null;});savePromise=pendingSave;return pendingSave;},
 status(id,value){const epoch=sessionEpoch;return gate.run(async()=>{requireSession(epoch);ensureNotRunning();C.validStatus(value);const rec=platform.STATE.submissions.find(s=>s.id===id);if(!rec)throw new Error('Submission not found.');if(!rec.snapshot){rec.snapshot=await platform.sbFetchSubmissionSnapshot(id);if(!rec.snapshot)throw new Error('Cannot save status because the submission snapshot did not load.');}requireSession(epoch);if(rec.status===value)return;if(id===R.activeId){await saveWorkbenchBeforeLeaving();await saveActiveSnapshot();requireSession(epoch);}const old=C.clone(rec);
  // Persist first: a failed write must not present an uncommitted underwriting decision.
  const next={...rec,status:value,statusHistory:[...(rec.statusHistory||[]),{from:rec.status,to:value,at:Date.now(),actor:R.user.display_name||R.user.email||'User'}],lastModifiedAt:Date.now()};
  const written=await platform.sbSaveSubmission(platform.buildSubmissionPayload(next,rec.snapshot||null));if(!written)throw new Error('Status was not saved. The record may have been deleted or the write rejected.');requireSession(epoch);Object.assign(rec,next);platform.renderQueueTable();platform.updateDecisionPane?.();platform.logAudit?.('Submissions',id+' status '+old.status+' to '+value,'ok');R.sync();R.toast('Status saved: '+value.toLowerCase());return value;
 });},
 deleteSubmission(id){const epoch=sessionEpoch;return gate.run(async()=>{requireSession(epoch);ensureNotRunning();const rec=platform.STATE.submissions.find(s=>s.id===id);if(!rec)return;if(!confirm('Delete '+(rec.account||id)+' and its associated submission records? This uses the existing permanent-deletion workflow.'))return;opening=true;try{
  const wasActive=id===R.activeId;if(wasActive){await saveWorkbenchBeforeLeaving();await saveActiveSnapshot();requireSession(epoch);}await platform.deleteSubmission(id,true);requireSession(epoch);if(platform.STATE.submissions.some(s=>s.id===id))throw new Error('Deletion was not confirmed. The submission remains open.');if(wasActive){disposeWorkbench();await platform.startNewSubmission();requireSession(epoch);destroyDesignFrames();platform.docsView?.setDraftSubmissionContext('New submission');}R.sync();await R.navigate('queue');replaceCurrentLocation();
 }finally{if(epoch===sessionEpoch)opening=false;}});},
 async addFiles(list){const epoch=sessionEpoch,p=platform;requireSession(epoch);ensureNotRunning();if(opening)throw new Error("Wait for the submission to finish opening.");if(!list?.length)return;intakeJobs++;try{await saveWorkbenchBeforeLeaving();requireSession(epoch);await p.handleFiles(list);requireSession(epoch);await p.docsView?.design?.ingestIntake();requireSession(epoch);}finally{if(epoch===sessionEpoch){intakeJobs--;R.sync();}}},
 openManualPaste(id){requireAuth();ensureNotRunning();platform.openManualPasteModal(id);},
 removeFile(id){requireAuth();ensureNotRunning();platform.removeFile(id);R.sync();},
 async run(){const epoch=sessionEpoch,p=platform;requireSession(epoch);ensureNotRunning();if(platform.STATE.pipelineDone){await R.navigate('sub-sum');return;}runStarting=true;try{await saveWorkbenchBeforeLeaving();requireSession(epoch);await p.runPipeline();requireSession(epoch);R.sync();}finally{if(epoch===sessionEpoch)runStarting=false;}},
 async website(mode,name,place,url){const epoch=sessionEpoch,p=platform;requireSession(epoch);ensureNotRunning();if(opening)throw new Error("Wait for the submission to finish opening.");intakeJobs++;try{await saveWorkbenchBeforeLeaving();requireSession(epoch);const d=p.document;const set=(id,v)=>{const e=d.getElementById(id);if(e)e.value=v||'';};set('webNameInput',name);set('webZipInput',place);set('webUrlInput',url);
  const result=mode==='url'?await p.scrapeWebsiteFromUrl():await p.findAndScrapeWebsite();requireSession(epoch);R.sync();return result;}finally{if(epoch===sessionEpoch){intakeJobs--;R.sync();}}
 },
 async nativeAction(action){requireAuth();const actionEpoch=sessionEpoch;R.closeActions();if(action==='signout'){
  const epoch=sessionEpoch;return gate.run(async()=>{requireSession(epoch);ensureNotRunning();opening=true;try{await saveWorkbenchBeforeLeaving();await saveActiveSnapshot();requireSession(epoch);const {error}=await platform.sb.auth.signOut();if(error)throw error;R.sync();}finally{if(epoch===sessionEpoch)opening=false;}});
 }
  if(action==='settings'){if(R.user?.role==='admin'){await R.navigate('admin');requireSession(actionEpoch);}platform.openSettings();return;}
  const map={assistant:'openSendToAssistantModal',return:'openReturnToUwModal',audit:'exportAudit',excel:'exportExcel',markdown:'exportMarkdown',referral:'copyReferralEmail',addcard:'addCustomCard',refresh:'confirmRefreshAllStale8733'};
  if(platform.__STM_SUBMISSION?.busy&&action!=='audit')throw new Error('Wait for the active pipeline operation.');
  const fn=map[action];if(!fn||typeof platform[fn]!=='function')throw new Error('This action is unavailable.');
  if(['assistant','return','addcard'].includes(action))await R.navigate('sub-sum');
  requireSession(actionEpoch);return await platform[fn]();
 },
 snapshot(){requireAuth();return {activeId:R.activeId,user:R.user,queue:platform.STATE.submissions.map(s=>C.queueRecord(s,R.activeId)),state:platform.STATE,modules:platform.MODULES,account:activeRecord()?.account||platform.deriveAccountName?.()||'New submission',nodes:nodeStates()};},
 showActions(){requireAuth();R.closeActions();const m=document.createElement('div');m.id='stm-action-menu';m.className='sysmenu open';m.style.cssText='position:fixed;right:24px;left:auto;top:76px;z-index:1000';m.innerHTML='<span class="k">Submission actions</span>'+[['assistant','Send to assistant'],['return','Return to underwriter'],['referral','Copy referral email'],['markdown','Export summary (Markdown)'],['excel','Export workbook'],['audit','Export audit'],['refresh','Refresh stale sections'],['settings',R.user?.role==='admin'?'Settings & guidelines':'Settings'],['signout','Sign out']].map(([a,t])=>'<button data-native-action="'+a+'">'+esc(t)+'</button>').join('');m.addEventListener('click',e=>{const a=e.target.closest('[data-native-action]');if(a)R.nativeAction(a.dataset.nativeAction).catch(showError);});document.body.appendChild(m);},
 async boot(){
  let remembered=null;try{remembered=JSON.parse(sessionStorage.getItem(F.AUTH_RETURN_KEY)||'null');}catch(_){}try{state.theme=F.theme(localStorage.getItem('stm-theme'));}catch(_){state.theme='light';}
  const parsed=F.readLocation(location.href,remembered);state.route=parsed.route;authHostSuffix=parsed.hostSuffix;bootAuthError=parsed.error;
  // Transfer recognized callback data once to the original auth SDK, then remove it from the shell.
  if(parsed.callback){try{history.replaceState(null,'',parsed.cleanUrl);sessionStorage.removeItem(F.AUTH_RETURN_KEY);}catch(_){}}
  document.documentElement.dataset.theme=state.theme;renderChrome();updateChrome();
  const params=new URLSearchParams(location.search),sid=parsed.submission||params.get('submission');pendingDeepLink=sid?{id:sid,route:state.route}:null;
  pframe=createHost('platform');frames['native-platform']=pframe;showAuth();
  setTimeout(()=>{if(!platform){showError(new Error('The application engine has not loaded. Serve the extracted folder over HTTP(S) and verify that its scripts and approved CDN dependencies are reachable.'));const message=document.getElementById('stm-auth-message');if(message)message.textContent='Engine unavailable. Check that every application file was deployed together, then reload.';}},20000);
 }

};
function activeRecord(){return platform?.STATE?.submissions.find(s=>s.id===R.activeId)||null;}
function requireAuth(){if(!authenticated||!R.user?.id)throw new Error('Sign in before using the application.');}
function requireSession(epoch){requireAuth();if(epoch!==sessionEpoch||R.user.id!==actorId)throw new Error('The signed-in session changed. Reopen the submission before continuing.');}
function destinationKey(route,sid){return JSON.stringify([route,sid||null]);}
function currentDestinationKey(){const d=F.destination(location.href);return destinationKey(d.route,d.submission);}
function replaceCurrentLocation(){try{history.replaceState(null,'',routeUrl(state.route||'queue'));}catch(_){}}
function resetSessionHost(){
 sessionEpoch++;routeSequence++;authenticated=false;actorId=null;pendingDeepLink=null;
 // A retired request must neither block the next owner nor unlock their active work.
 gate=new C.SerialGate();savePromise=null;opening=false;runStarting=false;intakeJobs=0;busy=0;setBusy(false);
 try{workbench?.__STM_WB?.stash?.();platform?.__STM_SUBMISSION?.retire();platform?.docsView?.design?.stash();}catch(_){}
 disposeWorkbench();destroyDesignFrames();R.closeActions();lastFingerprint='';statusNotice=null;nativeDialogBorrow=null;documentEditor=null;
 const old=pframe;platform=null;for(const key of Object.keys(frames))if(frames[key]===old)delete frames[key];old?.remove();
 presentationDialogs.clear();R.workbenchDialog=false;state.route='queue';pframe=createHost('platform');frames['native-platform']=pframe;renderChrome();replaceCurrentLocation();showAuth();
}
function ensureNotRunning(){if(platform?.__STM_SETTINGS_WRITE)throw new Error('Wait for configuration saving to finish.');if(R.workbenchDialog||presentationDialogs.size)throw new Error('Save or cancel the open dialog first.');if(nativeDialogBorrow)throw new Error('Finish the active dialog before changing submissions.');if(documentEditor)throw new Error('Save and close the document editor before changing submissions.');if(opening)throw new Error('Wait for the current submission transition to finish.');if(runStarting||intakeJobs||platform?.STATE?.pipelineRunning||platform?.__STM_SUBMISSION?.busy)throw new Error('Finish the active file intake or pipeline before changing submissions.');}
function routeUrl(id){const u=new URL(location.href);u.hash=C.ROUTES[id][2];if(R.activeId)u.searchParams.set('submission',R.activeId);else u.searchParams.delete('submission');return u.pathname+u.search+u.hash;}
function status(message,kind){if(['saved','error','dirty'].includes(kind))statusNotice={message,kind,sid:R.activeId};const el=document.getElementById('stm-save-state');if(el){el.textContent=message;el.title=message;el.dataset.kind=kind||'';}}
function setBusy(on,message,epoch=sessionEpoch){if(epoch!==sessionEpoch)return;busy=Math.max(0,busy+(on?1:-1));const el=document.getElementById('loading');el.classList.toggle('on',busy>0);if(message)el.textContent=message;document.body.dataset.busy=busy?'true':'false';}
function showError(e){const msg=e?.message||String(e);console.error('[STM integration]',e);R.toast(msg,'error');}
function updateChrome(){
 document.querySelectorAll('.tb-pill.in .t').forEach(el=>el.textContent=authenticated?'Signed in':'Sign in required');
 document.querySelectorAll('.tb-user .who b').forEach(el=>el.textContent=authenticated?USER.name:'Not signed in');document.querySelectorAll('.tb-user .who>span').forEach(el=>el.textContent=authenticated?USER.role:'Connect your existing account');document.querySelectorAll('.tb-user .av').forEach(el=>el.textContent=authenticated?USER.initials:'--');
 document.querySelectorAll('[data-label="Admin"],[data-go="admin"]').forEach(nav=>nav.hidden=R.user?.role!=='admin');
 const action=document.querySelector('.tb-right .acts');if(action){action.dataset.act='actions';delete action.dataset.msg;}
 const save=document.querySelector('.tb-right .save');if(save){save.dataset.act='save';delete save.dataset.msg;save.disabled=!authenticated||!R.activeId;}
 if(!document.getElementById('stm-save-state')){const s=document.createElement('span');s.id='stm-save-state';s.className='mono';s.setAttribute('role','status');document.querySelector('.tb-right')?.append(s);}
 if(statusNotice?.sid!==R.activeId)statusNotice=null;
 if(statusNotice)status(statusNotice.message,statusNotice.kind);else status(workbench?.__STM_WB?.dirty?'Unsaved changes':authenticated?(R.activeId?'Submission '+R.activeId:'Ready'):'Not connected',workbench?.__STM_WB?.dirty?'dirty':'');
}
function showAuth(){
 Object.values(frames).forEach(f=>f.classList.remove('on'));
 if(document.getElementById('stm-auth-gate'))return;
 const gate=document.createElement('section');gate.id='stm-auth-gate';gate.innerHTML='<div class="g"><span class="k">Speed to Market AI</span><h1>Your redesigned workspace</h1><p id="stm-auth-message">Sign in with the same account used by your July system. Your submissions, documents, and settings stay in the existing database.</p><form id="stm-login-form"><label for="stm-login-email">Work email</label><input id="stm-login-email" type="email" autocomplete="email" required placeholder="you@company.com"><button class="btn btn-primary" type="submit">Send sign-in link</button></form><p id="stm-login-result" role="status"></p><p class="mono">Live connection required. No demonstration account data is loaded.</p></div>';
 document.body.append(gate);if(bootAuthError)gate.querySelector('#stm-login-result').textContent=bootAuthError;gate.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const result=gate.querySelector('#stm-login-result'),btn=e.target.querySelector('button');try{if(!platform?.sb)throw new Error('The authentication library has not loaded. Check the application files and your connection.');btn.disabled=true;const email=gate.querySelector('input').value.trim();const dest={route:state.route||'queue',submission:pendingDeepLink?.id||R.activeId||null};try{sessionStorage.setItem(F.AUTH_RETURN_KEY,JSON.stringify(dest));}catch(_){}const redirect=F.loginRedirect(location.href,dest.route,dest.submission);const {error}=await platform.sb.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:redirect}});if(error)throw error;result.textContent='If that email is registered, you will receive a sign-in link shortly.';}catch(err){result.textContent=err.message;}finally{btn.disabled=false;}});
}
function createHost(kind){const f=document.createElement('iframe');setTimeout(()=>window.stmHookFrameMenus?.(f),0);f.className='stm-engine-host';f.id='engine-'+kind;f.title=kind==='platform'?'Submission engine':'Underwriting workbench';f.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads');document.getElementById('frames').append(f);const url='engine-'+kind+'.html';if(window.__STM_TEST_DOCUMENTS?.[url])f.srcdoc=window.__STM_TEST_DOCUMENTS[url];else {const suffix=kind==='platform'?authHostSuffix:'';if(kind==='platform')authHostSuffix='';f.src=url+suffix;}return f;}
function disposeWorkbench(){R.dealType='New';R.freshTab=null;R.workbenchDialog=false;wbGeneration++;if(workbenchWait){workbenchWait.reject(new Error('Workbench load was superseded by another submission.'));}workbench=null;workbenchWait=null;wbLoadPromise=null;wbLoadSid=null;wbSourceStamp=null;if(wframe)wframe.remove();wframe=null;for(const key of Object.keys(frames))if(key.startsWith('wb-')||key==='native-workbench'){frames[key]?.remove();delete frames[key];}}
function destroyDesignFrames(){for(const id of ['queue','sub-pipe','sub-sum','sub-docs']){frames[id]?.remove();delete frames[id];}}
async function ensureWorkbench(){
 const epoch=sessionEpoch,sid=R.activeId,stamp=JSON.stringify([sid,platform.STATE.extractions,platform.STATE.edits,platform.STATE.customCards,platform.STATE.hiddenCards]);
 if(wbLoadPromise&&wbLoadSid===sid)return wbLoadPromise;
 if(workbench?.__STM_WB?.submissionId===sid&&wbSourceStamp===stamp)return workbench;
 if(workbench?.__STM_WB?.submissionId===sid){
  const w=workbench;wbLoadSid=sid;
  wbLoadPromise=(async()=>{await saveWorkbenchBeforeLeaving();if(sid)await w.__STM_WB.load(C.workbenchRecord(activeRecord(),platform.STATE));requireSession(epoch);wbSourceStamp=stamp;return w;})();
  try{return await wbLoadPromise;}finally{wbLoadPromise=null;wbLoadSid=null;}
 }
 disposeWorkbench();const gen=wbGeneration;wbLoadSid=sid;
 wbLoadPromise=(async()=>{
  let timer;
  const ready=new Promise((resolve,reject)=>{workbenchWait={resolve,reject};timer=setTimeout(()=>reject(new Error('Workbench startup failed. Verify its script dependencies.')),15000);});
  wframe=createHost('workbench');frames['native-workbench']=wframe;
  let w;try{w=await ready;}finally{clearTimeout(timer);if(gen===wbGeneration)workbenchWait=null;}
  if(gen!==wbGeneration||sid!==R.activeId||epoch!==sessionEpoch)throw new Error('Submission changed while the workbench was loading.');
  if(sid)await w.__STM_WB.load(C.workbenchRecord(activeRecord(),platform.STATE));requireSession(epoch);wbSourceStamp=stamp;return w;
 })();
 try{return await wbLoadPromise;}finally{if(gen===wbGeneration){wbLoadPromise=null;wbLoadSid=null;}}
}
async function saveWorkbenchBeforeLeaving(){
 const epoch=sessionEpoch,w=workbench;
 if(w?.__STM_WB?.dirty){const result=await w.__STM_WB.save();requireSession(epoch);if(result.mode!=='cloud')throw new Error('Your workbench changes are saved locally but not synced. Retry Save before switching submissions.');}
}
async function saveActiveSnapshot(){
 const p=platform,sid=R.activeId,epoch=sessionEpoch,w=workbench;if(!sid){await p.flushEditsNow?.();await p.docsView?.design?.flush();return;}
 await p.flushEditsNow?.();await p.docsView?.design?.flush();requireSession(epoch);if(sid!==R.activeId||p!==platform)throw new Error('Submission changed before its snapshot could be saved.');
 const rec=p.STATE.submissions.find(r=>r.id===sid)||{id:sid,account:p.deriveAccountName?.()||'Incomplete submission',status:'AWAITING UW REVIEW',createdAt:Date.now(),statusHistory:[]};
 const snapshot={...C.clone(rec.snapshot||{}),files:typeof p.slimSnapshotFiles8799==='function'?p.slimSnapshotFiles8799():[],extractions:C.clone(p.STATE.extractions),edits:C.clone(p.STATE.edits),customCards:C.clone(p.STATE.customCards),hiddenCards:C.clone(p.STATE.hiddenCards),handoff:C.clone(p.STATE.handoff),audit:C.clone(p.STATE.audit),runTotalCost:p.STATE.runTotalCost||0,pipelineRun:p.STATE.pipelineRun,_stmRunComplete:!!p.STATE.pipelineDone};
 const nameField=w?.__STM_WB?.submissionId===sid?w.document.getElementById('dealName'):null;
 const updated=(nameField?.getAttribute('data-user-set')==='1'&&nameField.value.trim())?{...rec,account:nameField.value.trim()}:rec;
 const payload=p.buildSubmissionPayload(updated,snapshot);const written=await p.sbSaveSubmission(payload);if(!written)throw new Error('Submission save was rejected or the record was deleted.');requireSession(epoch);
 if(sid!==R.activeId||p!==platform)throw new Error('Submission changed while its snapshot was saving.');
 Object.assign(rec,updated,{snapshot});if(!p.STATE.submissions.some(r=>r.id===sid))p.STATE.submissions.unshift(rec);
}
function nodeStates(){const result={};for(const id of Object.keys(platform.MODULES||{})){const node=platform.document.querySelector('[data-module="'+id+'"],#node-'+id);if(!node)continue;let stat=['error','warn','running','done','skipped'].find(s=>node.classList.contains(s)||node.classList.contains('node-'+s)||node.classList.contains('st-'+s));if(stat)result[id]={status:stat};}return result;}
function setThemeOnHosts(){for(const w of [platform,workbench])if(w){w.document.documentElement.dataset.theme=state.theme;try{w.localStorage.setItem('stm-theme',state.theme);}catch(_){}}}
function setNativeTitle(w,id){const section=w.document.querySelector('.page-section.active');if(!section)return;let title=w.document.getElementById('stm-native-title');if(!title){title=w.document.createElement('div');title.id='stm-native-title';}title.innerHTML='<span class="stm-eyebrow">'+esc(C.ROUTES[id][3])+'</span><h1>'+esc(activeRecord()?.account||activeRecord()?.account_name||R.activeId)+'</h1><p>'+esc(R.activeId)+' / '+esc(activeRecord()?.status||'AWAITING UW REVIEW')+'</p>';section.prepend(title);}
frameFor=function(id){if(id.startsWith('wb-')&&!['wb-deal','wb-loss','wb-limits','wb-gl','wb-al','wb-internal','wb-forms','wb-subj','wb-uw','wb-renewal','wb-history'].includes(id)){frames[id]=wframe;return wframe;}return originalFrameFor(id);};
go=function(id,push=true){return R.navigate(id,push).catch(showError);};
const oldSetTheme=setTheme;setTheme=function(t){oldSetTheme(t==='dark'?'dark':'light');setThemeOnHosts();updateChrome();};
const oldRenderChrome=renderChrome;renderChrome=function(){
 const active=document.activeElement,focusKey=active?.closest('#chrome')?(active.id?['id',active.id]:active.dataset.act?['data-act',active.dataset.act]:active.dataset.go?['data-go',active.dataset.go]:active.dataset.label?['data-label',active.dataset.label]:null):null;
 oldRenderChrome();updateChrome();if(focusKey){const el=[...document.querySelectorAll('#chrome [id],#chrome [data-act],#chrome [data-go],#chrome [data-label]')].find(e=>e.getAttribute(focusKey[0])===focusKey[1]);el?.focus({preventScroll:true});}
};
document.getElementById('chrome').addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;if(b.dataset.act==='save'||b.dataset.act==='actions'||b.dataset.act==='dealtype'){e.preventDefault();e.stopImmediatePropagation();if(b.dataset.act==='save')R.save();else if(b.dataset.act==='dealtype'){try{R.setDealType(b.dataset.type);}catch(err){showError(err);}}else {try{R.showActions();}catch(err){showError(err);}}}},true);
document.addEventListener('click',e=>{if(!e.target.closest('#stm-action-menu,.acts'))R.closeActions();});
window.addEventListener('beforeunload',e=>{if(R.dialogOpen||workbench?.__STM_WB?.dirty||intakeJobs||runStarting||platform?.STATE?.pipelineRunning||platform?.__STM_SUBMISSION?.status().dirty||platform?.docsView?.design?.status().dirty){e.preventDefault();e.returnValue='';}});
function restoreHistory(){
 const requested=F.destination(location.href),key=destinationKey(requested.route,requested.submission);if(historyPending===key)return;
 if(!authenticated){state.route=requested.route;pendingDeepLink=requested.submission?{id:requested.submission,route:requested.route}:null;renderChrome();return;}
 historyPending=key;
 const action=requested.submission&&requested.submission!==R.activeId?R.open(requested.submission,requested.route,false):R.navigate(requested.route,false);
 Promise.resolve(action).catch(e=>{showError(e);replaceCurrentLocation();}).finally(()=>{if(historyPending===key)historyPending=null;});
}
window.addEventListener('popstate',restoreHistory);window.addEventListener('hashchange',restoreHistory);
R.boot();
})();
