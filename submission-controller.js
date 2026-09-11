/* v9.8.0: native state adapter. Uses July renderers, orchestration and data-access functions. */
(function(){'use strict';
 const K=window.STMSubmissionContracts;
 if(!K||!window.STATE)throw new Error('Submission adapter loaded before its dependencies.');
 const original={};const S=window.STATE;
 let ctx=null,revision=0,savedRevision=0,pendingSave=null,debounce=null,saveError='',localError='',saving=false,lastSaved=null,noteSequence=0;
 let tombstones=new Set(),operation=null,lastOperation=null,nodes={},generation=0;
 const R=()=>{try{return parent.STM_RUNTIME;}catch(_){return null;}};
 const uid=()=>window.currentUser?.id||null;
 const clone=K.copy;
 function audit(message,type='ok'){window.logAudit?.('Interface',message,type);}
 function identity(){return {owner:uid(),sid:S.activeSubmissionId||null};}
 function matching(c){return !!c&&c.owner===uid()&&c.sid===(S.activeSubmissionId||null);}
 function assertContext(c){if(!matching(c))throw new Error('Session or submission changed. Reopen this submission before saving.');}
 function context(){
  const c=identity();if(!c.owner)throw new Error('Sign in before changing this submission.');
  if(ctx&&ctx.owner===c.owner&&ctx.sid===null&&c.sid&&operation){const old=ctx;ctx=c;try{localStorage.removeItem(K.recoveryKey(old.owner,old.sid));}catch(_){}stash();return {...ctx};}
  if(!ctx||ctx.owner!==c.owner||ctx.sid!==c.sid){
   if(ctx&&revision>savedRevision){stash();if(ctx.owner===c.owner&&ctx.sid===null&&c.sid){localStorage.removeItem(K.recoveryKey(ctx.owner,null));}else throw new Error('Unsynced summary changes remain in the previous submission.');}
   ctx=c;generation++;revision=0;savedRevision=0;tombstones=new Set();saveError='';lastSaved=null;nodes={};
   lastOperation=S.submissions.find(r=>r.id===c.sid)?.snapshot?._stmOperation||null;nodes=clone(lastOperation?.nodes||{});if(typeof RECLASSIFY_PENDING!=='undefined')RECLASSIFY_PENDING.clear();
   try{const raw=localStorage.getItem(K.recoveryKey(c.owner,c.sid)),rec=raw?JSON.parse(raw):null;
    if(K.recoveryMatches(rec,c.owner,c.sid)){Object.assign(S,clone(rec.state));tombstones=new Set(rec.tombstones||[]);revision=1;saveError='Recovered unsynced changes. Save to sync this submission.';audit('Recovered local summary changes for '+(c.sid||'draft'),'warn');}
   }catch(e){localError='Local recovery could not be read: '+e.message;}
  }
  return {...ctx};
 }
 function stash(){
  if(!ctx||revision===savedRevision)return true;
  const rec={schema:1,owner:ctx.owner,sid:ctx.sid,at:Date.now(),revision,state:{...K.editState(S),handoff:clone(S.handoff)},tombstones:[...tombstones]};
  try{localStorage.setItem(K.recoveryKey(ctx.owner,ctx.sid),JSON.stringify(rec));localError='';return true;}
  catch(e){localError='Browser recovery storage failed. Keep this tab open until a cloud save succeeds.';return false;}
 }
 function notify(){try{R()?.sync();}catch(_){}renderSaveIndicator();}
 function renderSaveIndicator(){const t=document.getElementById('saveIndicatorText'),ind=document.getElementById('saveIndicator');if(t)t.textContent=status().label;if(ind){ind.classList.toggle('saving',saving);ind.classList.toggle('saved',!saving&&revision===savedRevision&&!saveError);}}
 function status(){
  let label=saveError?'Not synced - retry Save':saving?'Saving changes...':revision>savedRevision?(ctx?.sid?'Unsaved changes':'Draft saved in this browser'):lastSaved?'Saved to cloud':'No unsaved summary changes';
  if(localError)label=localError;
  return {dirty:revision>savedRevision,saving,error:saveError,localError,label,lastSaved,revision,savedRevision,owner:ctx?.owner||null,sid:ctx?.sid||null};
 }
 function dirty(){context();revision++;saveError='';stash();clearTimeout(debounce);debounce=setTimeout(()=>flush().catch(e=>{R()?.toast(e.message,'error');}),500);notify();}
 function snapshot(){
  const rec=S.submissions.find(r=>r.id===S.activeSubmissionId)||{id:S.activeSubmissionId,account:window.deriveAccountName?.()||'Submission',status:'AWAITING UW REVIEW',createdAt:Date.now(),statusHistory:[]};
  const snap={...clone(rec.snapshot||{}),files:window.slimSnapshotFiles8799?window.slimSnapshotFiles8799():[],extractions:clone(S.extractions),...K.editState(S),handoff:clone(S.handoff),audit:clone(S.audit),runTotalCost:S.runTotalCost||0,pipelineRun:S.pipelineRun,_stmRunComplete:!!S.pipelineDone,_stmOperation:clone(lastOperation)};
  return {rec,snap};
 }
 async function flush(){
  clearTimeout(debounce);debounce=null;const c=context();
  if(!c.sid){stash();return {mode:'local',dirty:revision>savedRevision};}
  if(pendingSave){await pendingSave;assertContext(c);if(revision>savedRevision)return flush();return {mode:'cloud'};}
  if(revision===savedRevision&&!saveError)return {mode:'cloud',unchanged:true};
  const gen=generation;
  pendingSave=(async()=>{saving=true;notify();try{
   while(revision>savedRevision){
    assertContext(c);const user=await window.sbUser();if(!user||user.id!==c.owner)throw new Error('Session expired. Your changes remain saved in this browser.');assertContext(c);
    const rev=revision,es=K.editState(S),deleted=[...tombstones],{rec,snap}=snapshot();
    // Snapshot and edit rows both have to succeed. Deletions are retryable tombstones,
    // not a delete-all pass that could erase an unrelated editor's new row.
    const written=await window.sbSaveSubmission(window.buildSubmissionPayload(rec,snap));if(!written)throw new Error('Submission save was rejected or the record was deleted.');assertContext(c);
    await window.sbSaveAllEditsForSubmission(c.sid,S.pipelineRun||null,es.edits,es.customCards,es.hiddenCards);assertContext(c);
    for(const key of deleted){await window.sbDeleteEdit(c.sid,key);assertContext(c);}
    if(gen!==generation)throw new Error('Save belongs to a retired session.');
    rec.snapshot=snap;deleted.forEach(k=>tombstones.delete(k));savedRevision=rev;lastSaved=Date.now();saveError='';
    if(savedRevision===revision){localStorage.removeItem(K.recoveryKey(c.owner,c.sid));}else stash();
   }
   return {mode:'cloud'};
  }catch(e){saveError=e.message||String(e);stash();throw new Error('Summary save failed: '+saveError);}finally{saving=false;notify();}})();
  try{return await pendingSave;}finally{pendingSave=null;}
 }
 function safe(html){return window.sanitizeModelHtml(String(html??''));}
 function change(event){
  context();if(operation)throw new Error('Wait for the active pipeline operation before editing its summary.');
  const before=K.editState(S);if(K.own(event,'html'))event={...event,html:safe(event.html)};
  const next=K.reduce(before,{...event,at:Date.now()});
  for(const key of K.removedKeys(before,next))tombstones.add(key);
  for(const key of K.rowKeys(next))tombstones.delete(key);
  Object.assign(S,next);dirty();return next;
 }
 function body(id){
  const cc=S.customCards.find(c=>c.id===id);if(cc)return safe(cc.html||'');
  if(K.own(S.edits?.[id],'htmlOverride'))return safe(S.edits[id].htmlOverride);
  if(!S.extractions[id])return '';if(!window.MODULES[id]){const p=document.createElement('p');p.textContent=S.extractions[id].text||'';return p.outerHTML;}
  const holder=document.createElement('div');holder.innerHTML=window.renderExtractionCard(id);
  return safe(holder.querySelector('.sc-body')?.innerHTML||'');
 }
 function project(){context();return {...K.project(S,window.MODULES||{},nodes),save:status(),operation:operation?{kind:operation.kind,cancelled:operation.cancelled,finishing:!!operation.finishing,started:operation.started}:null,lastOperation:clone(lastOperation),nodes:clone(nodes),handoff:clone(S.handoff),pending:window.computePendingClosure8747?.()||{all:[],stale:[],newBatches:[]},fileCount:S.files.length};}
 function assertNotCancelled(){if(operation?.cancelled){const e=new Error('Operation cancelled by the underwriter.');e.name='AbortError';e.stmCancelled=true;throw e;}}
 function cancel(){if(!operation||operation.finishing)return false;operation.cancelled=true;for(const ctrl of operation.controllers)ctrl.abort();audit('Cancellation requested. Already submitted requests may still be billed.','warn');notify();return true;}
 async function execute(kind,fn){
  if(operation)throw new Error('A pipeline operation is already active.');context();
  const token={kind,started:Date.now(),cancelled:false,controllers:new Set(),owner:uid(),sid:S.activeSubmissionId};operation=token;
  let thrown=null,result;
  try{await flush();assertNotCancelled();result=await fn();}catch(e){thrown=e;}
  finally{
   if(token.cancelled){S.pipelineRunning=false;S.pipelineDone=false;document.getElementById('pipeStatus')?.replaceChildren(document.createTextNode('Cancelled - partial results retained'));window.updateRunButton?.();}
   const errors=Object.values(nodes).filter(n=>['error','warn','cancelled'].includes(n.status)).length;
   lastOperation={kind,started:token.started,ended:Date.now(),status:token.cancelled?'cancelled':thrown?'failed':kind==='runPipeline'&&!S.pipelineDone?'not-completed':errors?'finished-with-issues':'finished',issues:errors,nodes:clone(nodes)};
   token.finishing=true;
   // A full run mints its submission ID; retain local edits under that same owner.
   if(ctx&&ctx.owner===uid()&&ctx.sid!==S.activeSubmissionId&&ctx.sid===null){const old=ctx;ctx={owner:ctx.owner,sid:S.activeSubmissionId||null};generation++;try{localStorage.removeItem(K.recoveryKey(old.owner,old.sid));}catch(_){}}
   if(uid()===token.owner){try{for(const f of S.files)await window.docsView?.design?.adoptFile(f);}catch(e){R()?.toast(e.message,'error');}revision++;stash();try{await flush();}catch(e){R()?.toast(e.message,'error');}}
   operation=null;notify();
  }
  if(thrown&&!token.cancelled)throw thrown;
  if(kind==='runPipeline'&&S.pipelineDone&&R()?.route==='sub-pipe')R().go('sub-sum');
  return token.cancelled?{status:'cancelled'}:result;
 }
 // Instrument presentation state while retaining the original scheduling logic.
 original.setNodeState=window.setNodeState;
 window.setNodeState=function(selector,value,timing){
  const match=String(selector).match(/data-module=["']([^"']+)/);if(match)nodes[match[1]]={status:operation?.cancelled?'cancelled':value,timing:timing||null,at:Date.now()};
  try{document.querySelector(selector)?.classList.remove('warn');}catch(_){}
  return original.setNodeState.apply(this,arguments);
 };
 original.classifyFile=window.classifyFile;
 window.classifyFile=async function(file){
  await window.docsView?.design?.adoptFile(file);assertNotCancelled();
  const result=await original.classifyFile.apply(this,arguments);assertNotCancelled();
  if(file._stmDocIds?.length){
   const mapping=window.docsViewMappingFor(result.primary_bucket||result.type,result.tag);
   window.docsView.relabelDocsForFile(file.id,{pipelineTag:result.tag||result.subType||result.type,primaryBucket:result.primary_bucket||null,pipelineClassification:result.type||null,pipelineRoutedTo:(typeof window.classifierToRoute==='function'?window.classifierToRoute(result.type,result.subType,result.tag):null),color:mapping.color,category:mapping.category,sectionClassifications:window.stmSectionClassificationsForDocs(result.classifications||[]),relabeledByUser:false});
   await window.docsView.design.flush();
  }
  return result;
 };
 original.callLLM=window.callLLM;
 window.callLLM=async function(){assertNotCancelled();const result=await original.callLLM.apply(this,arguments);assertNotCancelled();return result;};
 original.runModule=window.runModule;
 window.runModule=async function(id){
  if(operation?.cancelled){nodes[id]={status:'cancelled'};return false;}
  const token=operation,previous=clone(S.extractions[id]);const value=await original.runModule.apply(this,arguments);
  if(token?.cancelled){if(previous)S.extractions[id]=previous;else delete S.extractions[id];nodes[id]={status:'cancelled'};return false;}
  return value;
 };
 for(const name of ['runPipeline','incrementalProcess','rerunGuidelines','rerunModules','applyReclassifications']){
  original[name]=window[name];if(typeof original[name]!=='function')continue;
  window[name]=async function(){const args=arguments;if(operation){assertNotCancelled();return original[name].apply(this,args);}return execute(name,()=>original[name].apply(this,args));};
 }
 original.archive=window.archiveCurrentSubmission;
 window.archiveCurrentSubmission=async function(){if(operation?.cancelled)S.pipelineDone=false;const result=await original.archive.apply(this,arguments);if(result?.cloudSaved===false){revision++;saveError='Pipeline snapshot is not synced.';stash();}return result;};
 original.rehydrate=window.rehydrateSubmission;
 window.rehydrateSubmission=async function(){const result=await original.rehydrate.apply(this,arguments);context();window.renderSummaryCards?.();notify();return result;};
 original.newSubmission=window.startNewSubmission;
 window.startNewSubmission=async function(){const result=await original.newSubmission.apply(this,arguments);context();notify();return result;};
 window.markDirty=dirty;window.saveEditsNow=flush;window.flushEditsNow=flush;
 window.resyncActiveSnapshot=async()=>{dirty();return flush();};window.updateSaveIndicator=renderSaveIndicator;
 window.revertCard=async id=>{if(!confirm('Revert this card to the pipeline output?'))return;change({type:'revert',id});window.renderSummaryCards();audit('Reverted card '+id);await flush();};
 window.deleteCard=id=>{change({type:'hide',id});window.renderSummaryCards();audit('Hidden card '+id);};
 window.restoreAllCards=async()=>{change({type:'restore'});window.renderSummaryCards();audit('Restored hidden cards');await flush();};
 window.clearAllEdits=async()=>{if(!confirm('Reset all summary edits, remove custom notes and restore hidden cards? Pipeline outputs are retained.'))return;change({type:'reset'});window.renderSummaryCards();audit('Reset summary edits, notes and hidden cards');await flush();};
 window.addCustomCard=()=>{const id='custom_'+(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'_'+(++noteSequence));change({type:'note',id,title:'Custom Note',html:'<p></p>'});window.renderSummaryCards();audit('Added custom note '+id);return id;};
 // Handoffs use the same durable submission write and report success only after it commits.
 let handingOff=false;
 window.persistHandoffState=async reason=>{dirty();await flush();audit('Persisted handoff transition: '+reason);};
 async function handoff(to){
  if(handingOff)return;context();if(operation)throw new Error('Wait for the pipeline to finish.');
  if(to==='assistant'&&!S.pipelineDone)return;
  const field=document.getElementById(to==='assistant'?'handoffUwNote':'handoffAssistantNote'),note=field?.value.trim();
  if(!note){window.toast('Write a review note before sending.','warn');return;}
  if(to==='assistant'&&!window.staleGuard8733('Send to Assistant'))return;
  handingOff=true;
  try{
   const now=Date.now(),assignee=document.getElementById('handoffAssignee')?.value||'Assistant';
   if(to==='assistant')Object.assign(S.handoff,{status:'awaiting_assistant',assignee,uwNote:note,sentAt:now});
   else Object.assign(S.handoff,{status:'returned_to_uw',assistantNote:note,returnedAt:now,viewAs:'uw'});
   S.handoff.history=S.handoff.history||[];const transition=to==='assistant'?'uw-to-assistant':'assistant-to-uw';const previous=S.handoff.history.at(-1);if(!previous||previous.transition!==transition||previous.noteText!==note||!saveError)S.handoff.history.push({transition,at:now,actor:window.currentActor?.()||uid(),noteLength:note.length,noteText:note});
   await window.persistHandoffState(to);window.renderHandoffState();
   if(to==='assistant')window.closeSendToAssistantModal();else window.closeReturnToUwModal();
   window.toast(to==='assistant'?'Sent to '+assignee+' for review':'Returned to underwriter with review notes','success');
  }catch(e){window.renderHandoffState();window.toast('Handoff not synced. Retry Save before leaving: '+e.message,'error');R()?.toast(e.message,'error');}
  finally{handingOff=false;notify();}
 }
 window.confirmSendToAssistant=()=>handoff('assistant');window.confirmReturnToUw=()=>handoff('uw');
 window.__STM_SUBMISSION={context,project,body,change,flush,status,stash,cancel,assertNotCancelled,execute,
  classifications(){const c=context();return {identity:c,types:clone(CLASSIFIER_TYPES),files:S.files.filter(f=>f.needsReview||f.classification==='unknown'||f.state==='needs_manual'||RECLASSIFY_PENDING.has(f.id)).map(f=>({id:f.id,name:f.name,tag:f.tag||f.classification||'',reason:f.reasoning||'',manual:f.state==='needs_manual',pending:clone(RECLASSIFY_PENDING.get(f.id)||null)})),pending:RECLASSIFY_PENDING.size};},
  queueClassification(c,id,tag,limit){assertContext(c);if(operation)throw new Error('Wait for the current pipeline.');if(!S.files.some(f=>f.id===id))throw new Error('File is no longer in this submission.');if(!CLASSIFIER_TYPES.some(t=>t.value===tag))throw new Error('Choose a valid classification.');window.queueReclassify(id,tag);if(limit!==undefined)window.queueReclassifyLimit(id,String(limit));notify();},
  async acceptClassification(c,id){assertContext(c);if(operation)throw new Error('Wait for the current pipeline.');if(!S.files.some(f=>f.id===id))throw new Error('File is no longer in this submission.');window.acceptClassification(id);dirty();await flush();},
  async applyClassifications(c){assertContext(c);if(operation)throw new Error('Wait for the current pipeline.');await window.applyReclassifications();await window.docsView?.design?.flush();dirty();await flush();},
  lastOperation:()=>clone(lastOperation),get busy(){return !!operation;},get operation(){return operation;},
  registerAbort(controller){assertNotCancelled();const token=operation;token?.controllers.add(controller);return ()=>token?.controllers.delete(controller);},
  edit(id,html){const cc=S.customCards.find(c=>c.id===id);return change(cc?{type:'note-edit',id,html}:{type:'edit',id,html,originalText:S.extractions[id]?.text||''});},
  rename(id,title){return change({type:'note-edit',id,title});},
  retire(){stash();cancel();},
  async action(name,id){
   const fn={revert:()=>window.revertCard(id),hide:()=>window.deleteCard(id),restore:()=>window.restoreAllCards(),reset:()=>window.clearAllEdits(),note:()=>window.addCustomCard(),refresh:()=>window.requestSectionRefresh8733(id),pending:()=>window.confirmRefreshAllPending8747(),guidelines:()=>window.rerunGuidelines()}[name];
   if(!fn)throw new Error('Unknown summary operation.');if(operation)throw new Error('Wait for the active pipeline operation.');return fn();
  },
  async feedback(id,sentiment,comment){
   const feedbackContext=context();const custom=S.customCards.some(c=>c.id===id);if(!custom&&!S.extractions[id])throw new Error('Card no longer exists.');
   if(!['positive','negative','suggestion'].includes(sentiment))throw new Error('Invalid feedback type.');
   if(!S.activeSubmissionId)throw new Error('Save or run this submission before sending feedback.');
   const event={id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),submissionId:S.activeSubmissionId,moduleId:custom?null:id,customCardId:custom?id:null,level:'card',moduleName:custom?(S.customCards.find(c=>c.id===id)?.title||'Custom Note'):(window.MODULES?.[id]?.name||id),sentiment,text:String(comment||''),timestamp:Date.now(),outputSnapshot:(S.extractions[id]?.text||S.customCards.find(c=>c.id===id)?.html||'').slice(0,2000),outputConfidence:S.extractions[id]?.confidence??null,sourceDocNames:window.getSourceDocNamesForModule?.(custom?null:id)||[],pipelineRun:S.pipelineRun,actor:window.currentActor?.()||uid(),model:window.MODULES?.[id]?.model||null};
   await window.sbLogFeedback(event);assertContext(feedbackContext);S.feedback.push(event);audit('Feedback '+sentiment+' for '+id);notify();return event;
  }
 };
 window.addEventListener('beforeunload',stash);
})();
