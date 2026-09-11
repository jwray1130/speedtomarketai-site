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
function resolveRoute(hash){const exact=Object.keys(ROUTES).find(k=>ROUTES[k][2]===hash);return exact||({'#queue':'queue','#submission':'sub-pipe','#documents':'sub-docs','#summary':'sub-sum','#admin':'admin'}[hash])||'queue';}
function queueRecord(r,active){return {id:String(r.id),account:String(r.account||r.account_name||r.title||''),active:r.id===active,broker:String(r.broker||''),effective:String(r.effective||r.effectiveDate||r.effective_date||''),requested:String(r.requested||r.requestedLimits||''),modules:finite(r.modulesRun??r.modules_run),conf:finite(r.confidence??r.conf),missing:Array.isArray(r.missingInfo||r.missing_info)?clone(r.missingInfo||r.missing_info).map(String):[],status:STATUSES.includes(r.status)?r.status:STATUSES[0]};}
function workbenchRecord(rec,s){if(!rec?.id)throw new Error('A saved submission is required.');const snap=rec.id===s.activeSubmissionId?{...clone(rec.snapshot||{}),extractions:clone(s.extractions||{}),edits:clone(s.edits||{}),customCards:clone(s.customCards||[]),hiddenCards:clone(s.hiddenCards||{}),handoff:clone(s.handoff||{}),files:[],runTotalCost:s.runTotalCost||0}:clone(rec.snapshot||{});return {...clone(rec),account_name:rec.account||rec.account_name||'',effective_date:rec.effective||rec.effectiveDate||rec.effective_date||'',missing_info:rec.missingInfo||[],modules_run:rec.modulesRun||rec.modules_run||0,snapshot:snap};}
function scopedDocs(docs,sid,draft){if(draft||!sid)return [];return docs.filter(d=>String(d.submissionId||'')===String(sid));}
function storageKey(user,sid){if(!user||!sid)throw new Error('User and submission identity are required.');return 'stm-v9:'+encodeURIComponent(String(user))+':'+encodeURIComponent(String(sid));}
class SerialGate{constructor(){this.tail=Promise.resolve();this.intent=0;}run(fn){const p=this.tail.then(fn);this.tail=p.catch(()=>{});return p;}latest(fn){const intent=++this.intent;return this.run(()=>intent===this.intent?fn(intent):{superseded:true});}}
function validStatus(s){if(!STATUSES.includes(s))throw new Error('Invalid underwriting status.');return s;}
function pipelineView(s,mods,nodeState){const list=Object.entries(mods||{}).map(([id,m])=>{const x=s.extractions?.[id],n=nodeState?.[id]||{};const status=n.status||(x?.status==='skipped'?'skipped':x?.status==='error'?'error':x&&x.text?'done':'queued');return {id,code:m.code||id,name:m.name||id,stage:finite(m.wave??m.stage,1),status,confidence:x?.confidence!=null&&x?.confidence!==''&&Number.isFinite(Number(x.confidence))?Number(x.confidence):null,cost:finite(x?.cost),duration:x?.timing!=null?finite(x.timing):finite(x?.durationMs??x?.ms)/1000};});const completed=list.filter(m=>m.status==='done');return {modules:list,done:completed.length,running:list.filter(m=>m.status==='running').length,failed:list.filter(m=>m.status==='error').length,skipped:list.filter(m=>m.status==='skipped').length,confidence:completed.filter(m=>m.confidence!=null).length?Math.round(completed.filter(m=>m.confidence!=null).reduce((a,m)=>a+m.confidence,0)/completed.filter(m=>m.confidence!=null).length):null,cost:finite(s.runTotalCost),runningNow:!!s.pipelineRunning,complete:!!s.pipelineDone};}
return Object.freeze({STATUSES,ROUTES,escape,finite,clone,resolveRoute,queueRecord,workbenchRecord,scopedDocs,storageKey,SerialGate,validStatus,pipelineView});
});
