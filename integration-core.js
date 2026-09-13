/* STM redesign integration v9.0.0. Pure contracts; no rating formulas here. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.STMIntegration=api;})(typeof window!=='undefined'?window:globalThis,()=>{
'use strict';
const STATUSES=Object.freeze(['AWAITING UW REVIEW','INQUIRED','QUOTED','DECLINED','BOUND']);
const ROUTES=Object.freeze({
 queue:['platform','Queue','#/queue','Daily Pipeline'],
 'sub-pipe':['platform','Submission','#/submission/pipeline','Submission / Pipeline'],
 'sub-sum':['platform','Submission','#/submission/summary','Submission / Summary'],
 'sub-docs':['platform','Submission','#/submission/documents','Submission / Documents'],
 admin:['platform','Admin','#/admin','Admin'],
 'wb-deal':['workbench','Deal Information','#/workbench/deal-information','Deal Information'],
 'wb-loss':['workbench','Risk & Coverage','#/workbench/risk-coverage/loss-history','Loss History'],
 'wb-limits':['workbench','Risk & Coverage','#/workbench/risk-coverage/limits-premiums','Limits & Premiums'],
 'wb-gl':['workbench','Risk & Coverage','#/workbench/risk-coverage/gl-exposure-rater','GL Exposure Rater'],
 'wb-al':['workbench','Risk & Coverage','#/workbench/risk-coverage/al-fleet-rater','AL Fleet Rater'],
 'wb-internal':['workbench','Risk & Coverage','#/workbench/risk-coverage/internal-rater','Internal Rater'],
 'wb-forms':['workbench','Forms & Subjectivities','#/workbench/forms-subjectivities/forms-endorsements','Forms & Endorsements'],
 'wb-subj':['workbench','Forms & Subjectivities','#/workbench/forms-subjectivities/subjectivities-conditions','Subjectivities & Conditions'],
 'wb-uw':['workbench','Underwriting','#/workbench/underwriting','Underwriting'],
 'wb-renewal':['workbench','Renewal','#/workbench/renewal','Renewal'],
 'wb-history':['workbench','History','#/workbench/history','History']
});
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
function confidencePercent(value){if(value==null||!['number','string'].includes(typeof value)||(typeof value==='string'&&!value.trim())||!Number.isFinite(Number(value)))return null;const n=Number(value);return n<0||n>100?null:Math.round(n<=1?n*100:n);}
function fileRoutes(file){return [...new Set((Array.isArray(file?.routedToAll)&&file.routedToAll.length?file.routedToAll:[file?.routedTo]).filter(x=>typeof x==='string'&&x))];}
const pageText=p=>typeof p==='string'?p:String(p?.text??p?.content??p?.pageText??'');
function evidencePages(file){const nested=file?.extractMeta?.pageTexts;return Array.isArray(file?.pageTexts)&&file.pageTexts.length?file.pageTexts:Array.isArray(nested)?nested:[];}
function hasFileEvidence(file){return /\S/.test(file?.text||'')||evidencePages(file).some(p=>/\S/.test(pageText(p)));}
function runtimeFileEvidence(file){
 const pages=evidencePages(file);
 const normalized=pages.map(pageText),text=typeof file?.text==='string'&&file.text.trim()?file.text:normalized.join('\n\n');
 return {text,pageTexts:normalized,available:!!text.trim()};
}
function sourceFiles(files,sid){return (files||[]).filter(f=>f&&(!f.submissionId||String(f.submissionId)===String(sid)));}
function workbenchFiles(files,sid){return sourceFiles(files,sid).map(file=>{
 // Persisted page evidence is the single copy: never clone raw Files, canvases,
 // thumbnail bytes or the duplicate top-level page/text corpus into the workbench.
 let pages=evidencePages(file);
 // July fallback parsers consume nested pages even for TXT/DOCX/manual text.
 if(!pages.some(p=>/\S/.test(pageText(p)))&&typeof file.text==='string'&&file.text.trim())pages=[file.text];
 const hasPages=pages.length>0;
 const meta={...(file.extractMeta||{})};
 if(Array.isArray(meta.attachments))meta.attachments=meta.attachments.map(a=>({name:a.name||a.fileName||'',mimeType:a.mimeType||a.contentType||null,contentLength:a.contentLength??a.content?.byteLength??a.content?.length??0}));
 const out=JSON.parse(JSON.stringify({...file,extractMeta:meta,text:hasPages?'':file.text||''},(key,value)=>['_rawFile','pageTexts','pdfData','highResData','thumbnailData','nativeDataUrl'].includes(key)?undefined:value));
 if(hasPages){out.textDropped=true;out.extractMeta={...(out.extractMeta||{}),pageTexts:pages.map(pageText)};}
 return out;
});}
const evidenceIds=new WeakMap();let nextEvidenceId=0;
function evidenceId(value){if(!value||typeof value!=='object')return null;if(!evidenceIds.has(value))evidenceIds.set(value,++nextEvidenceId);return evidenceIds.get(value);}
function evidenceHash(file){let h=2166136261;const feed=text=>{for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619)>>>0;h=Math.imul(h^0,16777619)>>>0;};feed(String(file.text||''));evidencePages(file).forEach(p=>feed(pageText(p)));return h;}
function fileEvidenceRevision(files){return JSON.stringify((files||[]).map(f=>{
 const pages=f.pageTexts||f.extractMeta?.pageTexts;
 return [f.id,f.submissionId,f.storagePath||f._storagePath,f.state,f.classification,f.primaryTag,f.subType,f.routedTo,fileRoutes(f),f.classifications,evidenceId(f),evidenceId(pages),String(f.text||'').length,evidenceHash(f),Array.isArray(pages)?pages.length:0];
}));}
function processingState(s,modules={},lastOperation=null,nodes={}){
 const files=sourceFiles(s.files,s.activeSubmissionId).filter(f=>!f.cancelled&&f.state!=='duplicate');
 const running=!!s.pipelineRunning,ingesting=Number(s._stmIntakePending||0)>0;
 const classified=f=>f.state==='classified'||(!f.state&&!!f.classification);
 const blockedFiles=files.filter(f=>f.state==='error'||f.state==='needs_manual').map(f=>({id:f.id,name:f.name,state:f.state}));
 const pending=files.filter(f=>!classified(f)&&!['error','needs_manual'].includes(f.state)&&(!running&&!ingesting||f.state==='parsed'||f.state==='ready'));
 const pendingFiles=pending.map(f=>({id:f.id,name:f.name,state:f.state,available:hasFileEvidence(f)}));
 // A prior run may have skipped this module before its source was uploaded.
 // Current routed evidence requires an extraction regardless of historical node state.
 const missingModules=[...new Set(files.filter(classified).flatMap(fileRoutes))].filter(id=>modules[id]?.inputsFrom==='file'&&!Object.prototype.hasOwnProperty.call(s.extractions||{},id));
 const hasOutputs=Object.keys(s.extractions||{}).length>0;
 // A parsed upload is pending first analysis, not an interrupted run. Use the
 // same persisted provenance as Run dispatch; an early cost-confirmation cancel
 // has no run ID and must still take the full-run confirmation path next time.
 const hasRunHistory=!!s.pipelineRun||hasOutputs;
 const sourceMissing=pendingFiles.filter(f=>!f.available);
 const needsRecovery=hasRunHistory&&!!(pendingFiles.length||missingModules.length||(!s.pipelineDone&&hasOutputs));
 const complete=hasRunHistory&&!!s.pipelineDone&&!pendingFiles.length&&!missingModules.length&&!blockedFiles.length&&!running&&!ingesting;
 const status=running?'running':ingesting?'intake':blockedFiles.length||sourceMissing.length?'attention':pendingFiles.length||missingModules.length?'pending':!s.pipelineDone&&lastOperation?.status==='cancelled'?'cancelled':!s.pipelineDone&&lastOperation?.status==='failed'?'failed':complete?'finished':hasOutputs?'partial':'not-started';
 return {status,complete,needsRecovery,hasRunHistory,hasOutputs,pendingFiles,sourceMissing,blockedFiles,missingModules,intakeCount:files.length,classifiedCount:files.filter(classified).length,routedCount:files.filter(f=>classified(f)&&fileRoutes(f).length).length};
}
function archivedDuration(s,lastOperation){
 const value=s.pipelineElapsedSeconds;if(value!=null&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0)return Number(value);
 if(lastOperation?.kind==='runPipeline'&&Number.isFinite(lastOperation.started)&&Number.isFinite(lastOperation.ended)&&lastOperation.ended>=lastOperation.started)return (lastOperation.ended-lastOperation.started)/1000;
 return null;
}
function resolveRoute(hash){const exact=Object.keys(ROUTES).find(k=>ROUTES[k][2]===hash);return exact||({'#queue':'queue','#submission':'sub-pipe','#documents':'sub-docs','#summary':'sub-sum','#admin':'admin'}[hash])||'queue';}
function queueRecord(r,active){return {id:String(r.id),account:String(r.account||r.account_name||r.title||''),active:r.id===active,broker:String(r.broker||''),effective:String(r.effective||r.effectiveDate||r.effective_date||''),requested:String(r.requested||r.requestedLimits||''),modules:finite(r.modulesRun??r.modules_run),conf:confidencePercent(r.confidence??r.conf),missing:Array.isArray(r.missingInfo||r.missing_info)?clone(r.missingInfo||r.missing_info).map(String):[],status:typeof r.status==='string'&&r.status?r.status:STATUSES[0]};}
function workbenchRecord(rec,s){if(!rec?.id)throw new Error('A saved submission is required.');const {snapshot={},...record}=rec,active=rec.id===s.activeSubmissionId;const snap={...clone({...snapshot,files:[]}),files:workbenchFiles(active?(s.files||[]):snapshot.files,rec.id)};if(active)Object.assign(snap,{extractions:clone(s.extractions||{}),edits:clone(s.edits||{}),customCards:clone(s.customCards||[]),hiddenCards:clone(s.hiddenCards||{}),handoff:clone(s.handoff||{}),runTotalCost:s.runTotalCost||0});return {...clone(record),account_name:rec.account||rec.account_name||'',effective_date:rec.effective||rec.effectiveDate||rec.effective_date||'',missing_info:rec.missingInfo||[],modules_run:rec.modulesRun||rec.modules_run||0,snapshot:snap};}
function scopedDocs(docs,sid,draft){if(draft||!sid)return [];return docs.filter(d=>String(d.submissionId||'')===String(sid));}
function storageKey(user,sid){if(!user||!sid)throw new Error('User and submission identity are required.');return 'stm-v9:'+encodeURIComponent(String(user))+':'+encodeURIComponent(String(sid));}
class SerialGate{constructor(){this.tail=Promise.resolve();this.intent=0;}run(fn){const p=this.tail.then(fn);this.tail=p.catch(()=>{});return p;}latest(fn){const intent=++this.intent;return this.run(()=>intent===this.intent?fn(intent):{superseded:true});}}
function validStatus(s){if(!STATUSES.includes(s))throw new Error('Invalid underwriting status.');return s;}
function pipelineView(s,mods,nodeState){const list=Object.entries(mods||{}).map(([id,m])=>{const x=s.extractions?.[id],n=nodeState?.[id]||{};const status=n.status||(x?.status==='skipped'?'skipped':x?.status==='error'?'error':x&&x.text?'done':'queued');return {id,code:m.code||id,name:m.name||id,stage:finite(m.wave??m.stage,1),status,confidence:confidencePercent(x?.confidence),cost:finite(x?.cost),duration:x?.timing!=null?finite(x.timing):finite(x?.durationMs??x?.ms)/1000};});const completed=list.filter(m=>m.status==='done');return {modules:list,done:completed.length,running:list.filter(m=>m.status==='running').length,failed:list.filter(m=>m.status==='error').length,skipped:list.filter(m=>m.status==='skipped').length,confidence:completed.filter(m=>m.confidence!=null).length?Math.round(completed.filter(m=>m.confidence!=null).reduce((a,m)=>a+m.confidence,0)/completed.filter(m=>m.confidence!=null).length):null,cost:finite(s.runTotalCost),runningNow:!!s.pipelineRunning,complete:processingState(s,mods,null,nodeState).complete};}
return Object.freeze({STATUSES,ROUTES,escape,finite,clone,resolveRoute,queueRecord,workbenchRecord,scopedDocs,storageKey,SerialGate,validStatus,pipelineView,confidencePercent,fileRoutes,runtimeFileEvidence,fileEvidenceRevision,processingState,archivedDuration});
});
