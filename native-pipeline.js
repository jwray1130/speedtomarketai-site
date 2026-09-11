/* The visible native inputs call the original July Pipeline. No alternate engine. */
(function(){'use strict';
 const original={},jobs=new Set(),requestControllers=new Set();
 let generation=0,intakeGeneration=0,intakeTail=Promise.resolve(),queued=0,scope=null,manualOwner=null;
 const platform=()=>window.__STM_NATIVE_PLATFORM,service=()=>window.__STM_SUBMISSION,state=()=>window.STATE;
 const abortError=message=>Object.assign(new Error(message||'Pipeline operation cancelled.'),{name:'AbortError',stmCancelled:true});
 function stale(message){return Object.assign(new Error(message||'Session or submission changed. Reopen it before continuing.'),{code:'STM_STALE_OWNER',name:'AbortError',stmCancelled:true});}
 function captureRaw(){return{owner:platform().captureOwner(),sid:state().activeSubmissionId||null,uploadToken:state()._uploadToken||0,generation,operation:service()?.operation||null};}
 function assertToken(token,allowCancelled=false){
  if(!token)throw stale('Pipeline ownership is unavailable. Reload before continuing.');
  platform().assertOwner(token.owner);
  if(token.generation!==generation||(state()._uploadToken||0)!==token.uploadToken)throw stale();
  const sid=state().activeSubmissionId||null;
  if(token.sid!==sid){
   // A first run may mint its draft ID. Session transitions remain blocked while busy.
   if(token.sid===null&&sid&&scope&&scope.token.owner.userId===token.owner.userId)token.sid=sid;
   else throw stale();
  }
  if(!allowCancelled){if(token.operation?.cancelled)throw abortError();service().assertNotCancelled();}
  return token;
 }
 function assertCurrent(){if(scope)return assertToken(scope.token);platform().assertOwner();service().assertNotCancelled();}
 function capture(){assertCurrent();return captureRaw();}
 function notify(){window.dispatchEvent(new Event('stm:pipeline-updated'));}
 function track(promise,child=false){const p=Promise.resolve(promise),group=child?scope:null;jobs.add(p);group?.children.add(p);const done=()=>{jobs.delete(p);group?.children.delete(p);};p.then(done,done);return p;}
 async function within(kind,fn,token){
  const active=scope;
  if(active){assertToken(active.token);return fn(active.token);}
  if(window.__STM_NATIVE_CONFIG?.pending||window.__STM_SETTINGS_WRITE)throw new Error("Wait for the settings save to finish before starting Pipeline or file intake.");
  const next={kind,token:token||captureRaw(),children:new Set()};scope=next;notify();
  try{return await service().execute(kind,async()=>{
   next.token.operation=service().operation;assertToken(next.token);let result;
   try{result=await fn(next.token);}finally{while(next.children.size)await Promise.allSettled([...next.children]);}
   assertToken(next.token);return result;
  });}
  finally{if(scope===next)scope=null;for(const c of requestControllers)c.abort();notify();}
 }
 function requireIdle(){platform().assertOwner();if(window.__STM_NATIVE_CONFIG?.pending||window.__STM_SETTINGS_WRITE)throw new Error("Wait for the settings save to finish before starting Pipeline or file intake.");if(scope||queued||service().busy)throw new Error('Finish the active file intake or Pipeline operation first.');}
 function top(name,kind=name){
  const fn=original[name]=window[name];if(typeof fn!=='function')return;
  window[name]=function(...args){requireIdle();return track(within(kind,()=>fn.apply(this,args)));};
 }
 function nested(name,allowed){
  const fn=original[name]=window[name];if(typeof fn!=='function')return;
  window[name]=function(...args){
   if(scope){assertCurrent();if(!allowed.includes(scope.kind))throw new Error('Another Pipeline operation is active.');return fn.apply(this,args);}
   requireIdle();return track(within(name,()=>fn.apply(this,args)));
  };
 }
 function checkpoint(name){
  const fn=original[name]=window[name];if(typeof fn!=='function')return;
  window[name]=function(...args){const token=capture();return track((async()=>{const result=await fn.apply(this,args);assertToken(token);return result;})(),true);};
 }
 original.toast=window.toast;
 window.toast=function(message,...args){
  if(scope){try{assertToken(scope.token,true);}catch(_){return;}}
  if(service()?.operation?.cancelled&&/complete|updated|finished/i.test(String(message)))return;
  return original.toast?.apply(this,[message,...args]);
 };
 // Keep timer/projection notifications separate from DOM replacement.
 original.setNodeState=window.setNodeState;
 window.setNodeState=function(selector,value,timing){
  if(scope){try{assertToken(scope.token,true);}catch(_){return;}}
  const match=String(selector).match(/data-module=["']([^"']+)/);
  const status=service().operation?.cancelled?'cancelled':value;
  if(match)service().recordNode?.(match[1],status,timing);
  const result=original.setNodeState.apply(this,[selector,status,timing]);notify();return result;
 };
 for(const name of ['updateProgress','updateTimer','renderFileList']){
  const fn=original[name]=window[name];if(typeof fn!=='function')continue;
  window[name]=function(...args){if(scope){try{assertToken(scope.token,true);}catch(_){return;}}const result=fn.apply(this,args);notify();return result;};
 }
 // Every provider/cache/classifier return checks its initiating owner before use.
 for(const name of ['callLLM','extractionCacheGet8760','gateModuleByApplicant','detectNamedInsureds','findWebsiteViaClaude','scrapeUrl','scrapeUrlViaClaude'])checkpoint(name);
 original.classifyFile=window.classifyFile;
 window.classifyFile=function(file){
  const token=capture();if(!state().files.includes(file)||file.cancelled)throw stale('This source document was removed.');
  return track((async()=>{const result=await original.classifyFile.call(this,file);assertToken(token);
   if(!state().files.includes(file)||file.cancelled)throw stale('This source document was removed.');
   return result;
  })(),true);
 };
 original.runModule=window.runModule;
 window.runModule=function(id,...args){
  if(scope)assertToken(scope.token,true);const token=captureRaw();
  if(service().operation?.cancelled){service().recordNode?.(id,'cancelled');return Promise.resolve(false);}
  const previous=state().extractions[id]===undefined?undefined:structuredClone(state().extractions[id]);
  return track((async()=>{const result=await original.runModule.apply(this,[id,...args]);
   try{assertToken(token);}catch(e){
    // Return the scheduler's failure signal so its parallel wave drains normally.
    assertToken(token,true);if(previous===undefined)delete state().extractions[id];else state().extractions[id]=previous;service().recordNode?.(id,'cancelled');
    return false;
   }
   return result;
  })(),true);
 };
 top('runPipeline');nested('rerunGuidelines',['section-refresh']);top('applyReclassifications');
 top('requestSectionRefresh8733','section-refresh');top('confirmRefreshAllPending8747','pending-refresh');
 // This legacy alias enters the same single top-level pending operation.
 window.confirmRefreshAllStale8733=(...args)=>window.confirmRefreshAllPending8747(...args);
 nested('rerunModules',['runPipeline','rerunGuidelines','applyReclassifications','incrementalProcess','upload','website','manual-paste','pending-refresh','section-refresh']);
 nested('incrementalProcess',['upload','website','manual-paste']);
 // The old queue is safe within one intake operation; ownership cannot drift while waiting.
 original.queueIncrementalProcess=window.queueIncrementalProcess;
 window.queueIncrementalProcess=function(files){
  if(!files?.length)return Promise.resolve();
  const token=capture();
  return original.queueIncrementalProcess.call(this,files).then(result=>{assertToken(token);return result;});
 };
 original.handleFiles=window.handleFiles;
 window.handleFiles=function(files){
  platform().assertOwner();if(!files?.length)return Promise.resolve();if(window.__STM_NATIVE_CONFIG?.pending||window.__STM_SETTINGS_WRITE)throw new Error("Wait for the settings save to finish before starting Pipeline or file intake.");
  if(scope&&scope.kind!=='upload')throw new Error('Finish the active Pipeline operation before adding files.');
  const token=captureRaw(),ticket=intakeGeneration,list=Array.from(files);queued++;notify();
  const task=intakeTail.catch(()=>{}).then(async()=>{
   if(ticket!==intakeGeneration)throw abortError('Queued intake was cancelled. Add those files again when ready.');
   assertToken(token);return within('upload',()=>original.handleFiles(list),token);
  }).finally(()=>{queued--;notify();});
  intakeTail=task;return track(task);
 };
 for(const name of ['scrapeWebsiteFromUrl','findAndScrapeWebsite'])top(name,'website');
 original.openManualPasteModal=window.openManualPasteModal;
 window.openManualPasteModal=function(id){requireIdle();manualOwner=captureRaw();return original.openManualPasteModal(id);};
 original.closeManualPasteModal=window.closeManualPasteModal;
 window.closeManualPasteModal=function(){const result=original.closeManualPasteModal();manualOwner=null;return result;};
 original.confirmManualPaste=window.confirmManualPaste;
 window.confirmManualPaste=function(){requireIdle();const token=manualOwner;if(!token)return Promise.resolve();assertToken(token);return track(within('manual-paste',()=>original.confirmManualPaste(),token));};
 original.removeFile=window.removeFile;
 window.removeFile=function(id){requireIdle();const token=capture();const result=original.removeFile(id);assertToken(token);service().touch?.();notify();return result;};
 // Preserve the original preflight content and approval buttons. Its Promise
 // now also settles when the operation/session is cancelled, exactly once.
 original.showIncrementalPreflight8733=window.showIncrementalPreflight8733;
 window.showIncrementalPreflight8733=function(...args){
  const token=capture(),controller=new AbortController();const release=service().registerAbort(controller);
  const cancelDialog=()=>document.querySelector('#preflight8733 .pf-cancel')?.click();
  controller.signal.addEventListener('abort',cancelDialog,{once:true});
  let p;
  try{p=original.showIncrementalPreflight8733.apply(this,args);if(controller.signal.aborted)cancelDialog();}
  catch(e){release?.();throw e;}
  return Promise.resolve(p).then(result=>{assertToken(token,true);return result;}).finally(()=>{controller.signal.removeEventListener('abort',cancelDialog);release?.();});
 };
 function wait(ms){
  const token=capture(),controller=new AbortController();const release=service().registerAbort(controller);
  return new Promise((resolve,reject)=>{
   let timer;const stop=()=>{clearTimeout(timer);release?.();reject(abortError());};
   controller.signal.addEventListener('abort',stop,{once:true});
   timer=setTimeout(()=>{controller.signal.removeEventListener('abort',stop);release?.();try{assertToken(token);resolve();}catch(e){reject(e);}},ms);
   if(controller.signal.aborted)stop();
  });
 }
 async function ownedFetch(url,options={}){
  const token=capture(),controller=new AbortController(),inputSignal=options.signal;
  const abort=()=>controller.abort();inputSignal?.addEventListener('abort',abort,{once:true});if(inputSignal?.aborted)abort();
  requestControllers.add(controller);const release=service().registerAbort(controller);
  let released=false;
  const cleanup=()=>{if(released)return;released=true;inputSignal?.removeEventListener('abort',abort);requestControllers.delete(controller);release?.();};
  controller.signal.addEventListener('abort',cleanup,{once:true});
  try{
   const response=await window.fetch(url,{...options,signal:controller.signal});assertToken(token);
   return new Proxy(response,{get(target,key){
    const value=Reflect.get(target,key,target);
    if(['text','json','arrayBuffer','blob','formData'].includes(key))return async(...args)=>{try{const result=await value.apply(target,args);assertToken(token);return result;}finally{cleanup();}};
    return typeof value==='function'?value.bind(target):value;
   }});
  }catch(e){cleanup();throw e;}
 }
 function cancel(){const result=service().cancel();if(result)intakeGeneration++;document.querySelector('#preflight8733 .pf-cancel')?.click();notify();return result;}
 async function retire(){generation++;intakeGeneration++;service().cancel();document.querySelector('#preflight8733 .pf-cancel')?.click();for(const c of requestControllers)c.abort();manualOwner=null;while(jobs.size)await Promise.allSettled([...jobs]);}
 window.__STM_NATIVE_PIPELINE={capture,assertToken,assertCurrent,wait,fetch:ownedFetch,cancel,retire,get busy(){return !!scope||queued>0||!!service()?.busy;}};
})();
