'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../integration-core.js');
const K = require('../submission-contracts.js');
const root = path.join(__dirname, '..');
const modules = {supplemental:{inputsFrom:'file',wave:1},losses:{inputsFrom:'file',wave:1},gl_quote:{inputsFrom:'file',wave:1},'summary-ops':{inputsFrom:'extractions',wave:2}};
const savedPdf = (extra={}) => ({id:'loss-file',name:'Losses.pdf',state:'parsed',text:'',textDropped:true,extractMeta:{pageTexts:['LOSS RUN\nPolicy 2024: paid 1200','Claim 42 reserve 300']},...extra});
const state = (extra={}) => ({activeSubmissionId:'SUB-A',pipelineRun:'PIPE-A',pipelineDone:true,pipelineRunning:false,files:[],extractions:{},edits:{},customCards:[],hiddenCards:{},handoff:{},audit:[],submissions:[],runTotalCost:0,...extra});

test('queue confidence uses percentage units while saved fractional records stay unchanged',()=>{
 const values = [[0.8266666667,83],[0,0],[1,100],[82.6667,83],['0.91',91],[null,null],[undefined,null],['',null],[' ',null],[NaN,null],[-1,null],[101,null],[true,null]];
 for(const [value,expected] of values){const record={id:'S',confidence:value,status:'QUOTED'};assert.equal(C.queueRecord(record,'S').conf,expected);assert.equal(record.confidence,value);assert.equal(C.queueRecord(record).status,'QUOTED');}
 assert.equal(C.queueRecord({id:'S',status:'LEGACY STATUS'}).status,'LEGACY STATUS');
});

test('pipeline confidence excludes missing observations and counts zero',()=>{
 const s=state({extractions:{supplemental:{text:'a',confidence:0},losses:{text:'b',confidence:null},gl_quote:{text:'c',confidence:.8}}});
 assert.equal(C.pipelineView(s,modules).confidence,40);
});

test('routes describe all combined-document destinations instead of classifier bucket names',()=>{
 assert.deepEqual(C.fileRoutes({classification:'QUOTES_UNDERLYING',routedToAll:['gl_quote','losses','gl_quote',null],routedTo:'gl_quote'}),['gl_quote','losses']);
 assert.deepEqual(C.fileRoutes({routedToAll:[],routedTo:'losses'}),['losses']);
 assert.deepEqual(C.fileRoutes({classification:'administration'}),[]);
});

test('nested saved evidence is restored lazily without mutating the persisted file',()=>{
 const f=savedPdf({extractMeta:{pageTexts:[{text:'page one'},{content:'page two'},'page three']}});
 const before=structuredClone(f),view=C.runtimeFileEvidence(f);
 assert.equal(view.text,'page one\n\npage two\n\npage three');assert.deepEqual(view.pageTexts,['page one','page two','page three']);assert.equal(view.available,true);assert.deepEqual(f,before);
 assert.equal(C.runtimeFileEvidence({text:'Manual transcription',extractMeta:{pageTexts:[]}}).text,'Manual transcription');
 assert.equal(C.runtimeFileEvidence({text:'',extractMeta:{pageTexts:['  ']}}).available,false);
});

test('workbench gets active-scoped file evidence once without raw bytes or duplicate page corpus',()=>{
 const f=savedPdf({_rawFile:{bytes:'not transferable'},pageTexts:['runtime page'],text:'runtime page',classification:'losses',routedTo:'losses'});
 const record={id:'SUB-A',account:'A',snapshot:{files:[savedPdf({id:'stale'})],extractions:{old:{text:'stale'}}}};
 const s=state({files:[f,savedPdf({id:'foreign',submissionId:'SUB-B'})],extractions:{losses:{text:'current'}}});
 const result=C.workbenchRecord(record,s);
 assert.equal(result.snapshot.files.length,1);assert.equal(result.snapshot.files[0].id,f.id);
 assert.deepEqual(result.snapshot.files[0].extractMeta.pageTexts,['runtime page']);assert.equal(result.snapshot.files[0].text,'');
 assert.equal(result.snapshot.files[0].pageTexts,undefined);assert.equal(result.snapshot.files[0]._rawFile,undefined);
 assert.deepEqual(result.snapshot.extractions,s.extractions);assert.notEqual(result.snapshot.files[0],f);
 assert.equal(f._rawFile.bytes,'not transferable');
 const inactive=C.workbenchRecord({id:'SUB-B',snapshot:{files:[savedPdf({id:'B'})]}},s);
 assert.equal(inactive.snapshot.files[0].id,'B');
});

test('workbench evidence revision detects same-length source corrections without embedding text',()=>{
 const f=savedPdf();const first=C.fileEvidenceRevision([f]);f.extractMeta.pageTexts[0]=f.extractMeta.pageTexts[0].replace('1200','9900');
 assert.notEqual(C.fileEvidenceRevision([f]),first);assert.equal(first.includes('LOSS RUN'),false);assert.ok(first.length<1000);
});

test('corrected archived loss evidence reaches a fresh workbench snapshot and invalidates identity caches',()=>{
 const f=savedPdf({classification:'losses',primaryTag:'Loss runs'}),s=state({files:[f]}),rec={id:'SUB-A',snapshot:{files:[]}};
 const first=C.workbenchRecord(rec,s),revision=C.fileEvidenceRevision(s.files);
 f.extractMeta.pageTexts[0]=f.extractMeta.pageTexts[0].replace('1200','9900');
 const second=C.workbenchRecord(rec,s);
 assert.notEqual(C.fileEvidenceRevision(s.files),revision);assert.notEqual(second,first);assert.notEqual(second.snapshot,first.snapshot);assert.notEqual(second.snapshot.files[0],first.snapshot.files[0]);
 assert.match(first.snapshot.files[0].extractMeta.pageTexts[0],/paid 1200/);assert.match(second.snapshot.files[0].extractMeta.pageTexts[0],/paid 9900/);
 assert.equal(second.snapshot.files[0].classification,'losses');assert.equal(second.snapshot.files[0].primaryTag,'Loss runs');
});

test('text-only loss documents reach the actual July fallback consumer as one nested evidence page',()=>{
 const source=fs.readFileSync(path.join(root,'workbench-rules.js'),'utf8'),start=source.indexOf('  function filePageTexts87('),end=source.indexOf('  function quoteFileText87(',start);
 assert.ok(start>=0&&end>start);const read=vm.runInNewContext(source.slice(start,end)+'\nfilePageTexts87');
 for(const pageTexts of [undefined,[],['  ']]){
  const f={id:'manual-loss',name:'Loss history.txt',classification:'losses',text:'Policy 2024: paid 1200; claim 42 reserve 300',extractMeta:{pageTexts}};
  const result=C.workbenchRecord({id:'SUB-A',snapshot:{}},state({files:[f]})),out=result.snapshot.files[0];
  assert.deepEqual(out.extractMeta.pageTexts,[f.text]);assert.equal(out.text,'');assert.equal(out.textDropped,true);
  assert.equal(read(result,{nameRe:/loss|claim/i,classRe:/loss|claim/i}),f.text);assert.equal(f.text,'Policy 2024: paid 1200; claim 42 reserve 300');
 }
});

test('email evidence transfer retains attachment metadata without cloning its binary payload',()=>{
 const content=new Uint8Array([12,34,56]),f=savedPdf({name:'broker.msg',extractMeta:{pageTexts:['Email body'],attachments:[{name:'loss.pdf',mimeType:'application/pdf',contentLength:3,content}]}});
 const out=C.workbenchRecord({id:'SUB-A',snapshot:{}},state({files:[f]})).snapshot.files[0];
 assert.deepEqual(out.extractMeta.attachments,[{name:'loss.pdf',mimeType:'application/pdf',contentLength:3}]);assert.equal(out.extractMeta.attachments[0].content,undefined);assert.equal(f.extractMeta.attachments[0].content,content);
});

test('visible guidelines pass the shared cleaner after machine-block transforms without modifying raw extraction',()=>{
 const source=fs.readFileSync(path.join(root,'pipeline-core.js'),'utf8'),start=source.indexOf('function cleanVisibleExtractionText99('),end=source.indexOf('\n// Display missing archived timing',start);
 assert.ok(start>=0&&end>start);const seen=[];
 const clean=vm.runInNewContext(source.slice(start,end)+'\ncleanVisibleExtractionText99',{window:{cleanGuidelinesVisibleText95:text=>{seen.push(text);return text.replace('ENGINE QC','');}}});
 const raw='Guideline result\n```json loss_history_structured hidden```\nENGINE QC';
 assert.equal(clean('guidelines',raw),'Guideline result');assert.equal(seen.length,1);assert.equal(seen[0].includes('hidden'),false);assert.match(raw,/hidden/);
 assert.match(clean('losses','ENGINE QC'),/ENGINE QC/);assert.equal(seen.length,1);
});

test('legacy six-file partial archive is pending despite completed flag',()=>{
 const ready=[1,2,3,4].map(n=>savedPdf({id:'pending-'+n}));const classified=[{id:'supp',state:'classified',routedTo:'supplemental'},{id:'acord',state:'classified',classification:'ACORD'}];
 const s=state({files:[...classified,...ready],extractions:{supplemental:{text:'saved output'}}});const p=C.processingState(s,modules);
 assert.equal(p.complete,false);assert.equal(p.pendingFiles.length,4);assert.equal(p.classifiedCount,2);assert.equal(p.routedCount,1);assert.equal(p.status,'pending');assert.equal(s.pipelineDone,true);
});

test('unrouted conditional modules do not force a 24-module rerun',()=>{
 const s=state({files:[{id:'supp',state:'classified',routedTo:'supplemental'},{id:'admin',state:'classified',classification:'administration'}],extractions:{supplemental:{text:'ok'}}});
 assert.equal(C.processingState(s,modules).complete,true);
 delete s.extractions.supplemental;
 assert.deepEqual(C.processingState(s,modules).missingModules,['supplemental']);
});

test('a historically skipped loss module becomes pending when newly classified loss evidence has no extraction',()=>{
 const s=state({files:[savedPdf({state:'classified',classification:'losses',routedTo:'losses'})],extractions:{supplemental:{text:'prior output'}}});
 const p=C.processingState(s,modules,null,{losses:{status:'skipped'}});
 assert.deepEqual(p.missingModules,['losses']);assert.equal(p.complete,false);assert.equal(p.needsRecovery,true);assert.equal(p.status,'pending');
});

test('source-unavailable and interrupted states remain visible without pretending to be complete',()=>{
 const p=C.processingState(state({files:[savedPdf({state:'parsing',text:'',extractMeta:{}})]}),modules,{status:'cancelled'});
 assert.equal(p.complete,false);assert.equal(p.sourceMissing.length,1);assert.equal(p.status,'attention');
 const cancelled=C.processingState(state({pipelineDone:false,extractions:{supplemental:{text:'retained'}}}),modules,{status:'cancelled'});
 assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.needsRecovery,true);
});

test('archived wall time is nullable and never synthesized from parallel module timing',()=>{
 assert.equal(C.archivedDuration(state({extractions:{a:{timing:10},b:{timing:10}}}),null),null);
 assert.equal(C.archivedDuration(state({pipelineElapsedSeconds:0}),null),0);
 assert.equal(C.archivedDuration(state({pipelineElapsedSeconds:12.3}),{kind:'runPipeline',started:1000,ended:99000}),12.3);
 assert.equal(C.archivedDuration(state(),{kind:'runPipeline',started:1000,ended:5500}),4.5);
 assert.equal(C.archivedDuration(state(),{kind:'resumePending',started:1000,ended:5500}),null);
});

function controllerHarness(overrides={}){
 const writes=[],calls=[];const S=state({files:[savedPdf()],extractions:{supplemental:{text:'KEEP ORIGINAL',confidence:.9}},...overrides.state});
 S.submissions=[{id:'SUB-A',status:'QUOTED',snapshot:{_stmOperation:overrides.operation||null}}];
 const local=new Map(),elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',classList:{toggle(){},remove(){}},replaceChildren(){}});return elements.get(id);};let timer=0;
 const sandbox={STATE:S,MODULES:modules,STMSubmissionContracts:K,STMIntegration:C,currentUser:{id:'USER-A'},CLASSIFIER_TYPES:[],RECLASSIFY_PENDING:new Map(),
  parent:{STMIntegration:C,STM_RUNTIME:{sync(){},toast(){},route:'sub-pipe',go(){}}},document:{getElementById:element,querySelector(){return null;},createTextNode:x=>x,createElement(){return {innerHTML:'',querySelector(){return null;}};}},
  localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)},
  setTimeout:()=>++timer,clearTimeout(){},addEventListener(){},console,crypto:{randomUUID:()=>String(++timer)},
  logAudit(){},toast(){},sanitizeModelHtml:x=>x,renderSummaryCards(){},updateRunButton(){},setNodeState(){},
  sbUser:async()=>({id:'USER-A'}),buildSubmissionPayload:(rec,snap)=>({...rec,snapshot:snap}),sbSaveSubmission:async payload=>{writes.push(structuredClone(payload));return true;},sbSaveAllEditsForSubmission:async()=>true,sbDeleteEdit:async()=>true,
  slimSnapshotFiles8799:()=>S.files.map(f=>{const copy=structuredClone(f);delete copy.pageTexts;delete copy._rawFile;if(copy.extractMeta?.pageTexts){copy.text='';copy.textDropped=true;}return copy;}),
  archiveCurrentSubmission:async()=>({cloudSaved:true}),rehydrateSubmission:async()=>{},startNewSubmission:async()=>{},
  docsView:{design:{adoptFile:async()=>{},flush:async()=>{}},relabelDocsForFile(){}},
  computePendingClosure8747:()=>({all:[],stale:[],newBatches:[]}),markSectionsStale8732(){},beginSpendPlan8762(){},endSpendPlan8762(){},
  showIncrementalPreflight8733:async()=>true,confirmRefreshAllPending8747:async()=>{},
  classifyFile:async()=>({type:'losses',tag:'Loss runs',classifications:[]}),docsViewMappingFor:()=>({color:'red',category:'loss-history'}),stmSectionClassificationsForDocs:x=>x,
  incrementalProcess:async files=>{calls.push({kind:'incremental',files:files.map(f=>({id:f.id,text:f.text,pages:f.pageTexts}))});for(const f of files){f.state='classified';f.classification='losses';f.routedTo='losses';}S.extractions.losses={text:'NEW LOSS OUTPUT',confidence:.95};},
  rerunModules:async ids=>{calls.push({kind:'rerun',ids:[...ids]});ids.forEach(id=>S.extractions[id]={text:'RECOVERED '+id});},
  runPipeline:async()=>{calls.push({kind:'full'});S.extractions={};},...overrides.globals};
 sandbox.window=sandbox;vm.runInNewContext(fs.readFileSync(path.join(root,'submission-controller.js'),'utf8'),sandbox,{filename:'submission-controller.js'});
 return {S,writes,calls,sandbox,api:sandbox.__STM_SUBMISSION};
}

test('summary projection exposes readable source and loss review messages without changing extraction or manual edits',()=>{
 const ext={text:'Original pipeline body',review_required:true,source_identity_conflicts:[{sourceModule:'supplemental',submissionInsured:'Example LLC',detectedInsureds:['Unrelated LLC']}],loss_integrity_warning95:'Annual tables do not agree.',loss_headline_reconciliation95:{original:'$99',corrected:'$120',source:'verified rows'}};
 const h=controllerHarness({state:{extractions:{losses:ext,guidelines:{text:'Guideline body',review_required:true}},edits:{losses:{htmlOverride:'<p>Underwriter edited body</p>'}},customCards:[{id:'note-1',title:'Note',html:'Keep my note'}]}});
 const before=JSON.stringify(h.S),view=h.api.project(),card=view.cards.find(c=>c.id==='losses');
 assert.equal(card.edited,true);assert.equal(card.reviewMessages.length,3);assert.match(card.reviewMessages[0],/Unrelated LLC.*Example LLC/);assert.match(card.reviewMessages[1],/Annual tables do not agree/);assert.match(card.reviewMessages[2],/\$99.*\$120/);
 assert.deepEqual(Array.from(view.cards.find(c=>c.id==='guidelines').reviewMessages),['Pipeline output requires underwriter review.']);assert.equal(view.cards.find(c=>c.note).reviewMessages.length,0);assert.equal(view.issues,2);assert.equal(JSON.stringify(h.S),before);assert.equal(view.visible.find(c=>c.id==='losses'),card);
});

test('saved output receives current integrity warnings without a model run and deduplicates stored messages',()=>{
 const calls=[],h=controllerHarness({state:{extractions:{al_quote:{text:'Conflicting unit counts',summary_integrity_warnings95:['Review fleet count.']}}},globals:{summaryIntegrityReview95:(id,text)=>{calls.push([id,text]);return ['Review fleet count.','Totals differ from the vehicle list.'];}}});
 const view=h.api.project();assert.deepEqual(Array.from(view.cards[0].reviewMessages),['Review fleet count.','Totals differ from the vehicle list.']);assert.deepEqual(calls,[['al_quote','Conflicting unit counts']]);assert.equal(view.issues,1);assert.equal(h.S.extractions.al_quote.text,'Conflicting unit counts');assert.equal(h.writes.length,0);
});

test('pending recovery passes real saved text to native incremental flow and preserves earlier outputs',async()=>{
 const h=controllerHarness();await h.api.resumePending();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].kind,'incremental');assert.match(h.calls[0].files[0].text,/paid 1200/);
 assert.equal(h.S.extractions.supplemental.text,'KEEP ORIGINAL');assert.equal(h.S.extractions.losses.text,'NEW LOSS OUTPUT');assert.equal(h.api.processing().complete,true);
 assert.ok(h.writes.length);assert.equal(h.writes.at(-1).snapshot._stmRunComplete,true);assert.equal(h.writes.at(-1).snapshot.files[0].pageTexts,undefined);
 assert.equal(h.writes.at(-1).status,'QUOTED');
});

test('source-unavailable pending recovery makes no model or persistence calls',async()=>{
 const h=controllerHarness({state:{files:[savedPdf({extractMeta:{},text:''})]}});
 await assert.rejects(h.api.resumePending(),/Restore source text/);assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);assert.equal(h.S.extractions.supplemental.text,'KEEP ORIGINAL');
});

test('failed pending classification remains retryable and retains prior output',async()=>{
 const h=controllerHarness({globals:{incrementalProcess:async files=>{files[0].state='parsing';}}});
 await assert.rejects(h.api.resumePending(),/Classification remains incomplete/);assert.equal(h.S.files[0].state,'parsed');assert.equal(h.api.processing().complete,false);assert.equal(h.S.extractions.supplemental.text,'KEEP ORIGINAL');assert.equal(h.api.lastOperation().status,'failed');
});

test('declining missing-section preflight leaves it pending without clearing other outputs',async()=>{
 const h=controllerHarness({state:{files:[savedPdf({state:'classified',classification:'losses',routedTo:'losses'})]},globals:{showIncrementalPreflight8733:async()=>false}});
 await h.api.resumePending();assert.equal(h.calls.length,0);assert.deepEqual(h.api.processing().missingModules,['losses']);assert.equal(h.S.extractions.supplemental.text,'KEEP ORIGINAL');assert.equal(h.writes.at(-1).snapshot._stmRunComplete,false);
});

test('cancelled incremental refresh keeps newly classified documents and all earlier output',async()=>{
 const h=controllerHarness({globals:{incrementalProcess:async files=>{for(const f of files){f.state='classified';f.classification='losses';f.routedTo='losses';}}}});
 await h.api.resumePending();assert.equal(h.S.files[0].state,'classified');assert.equal(h.S.extractions.supplemental.text,'KEEP ORIGINAL');assert.equal(h.S.extractions.losses,undefined);
 assert.equal(h.api.processing().complete,false);assert.deepEqual(h.api.processing().missingModules,['losses']);assert.equal(h.writes.at(-1).snapshot.files[0].classification,'losses');assert.equal(h.writes.at(-1).snapshot._stmRunComplete,false);
});

test('cancelling active recovery retains classified source evidence, prior output and manual edits for retry',async()=>{
 let release;const paused=new Promise(resolve=>release=resolve);
 const h=controllerHarness({state:{edits:{supplemental:{htmlOverride:'<p>Underwriter edit</p>'}}},globals:{incrementalProcess:async files=>{for(const f of files){f.state='classified';f.classification='losses';f.routedTo='losses';}await paused;}}});
 const pending=h.api.resumePending();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.api.cancel(),true);release();
 assert.equal((await pending).status,'cancelled');assert.equal(h.api.lastOperation().status,'cancelled');assert.equal(h.api.processing().complete,false);
 assert.equal(h.S.extractions.supplemental.text,'KEEP ORIGINAL');assert.equal(h.S.edits.supplemental.htmlOverride,'<p>Underwriter edit</p>');assert.match(h.S.files[0].text,/paid 1200/);assert.equal(h.S.files[0].state,'classified');
 assert.equal(h.writes.at(-1).snapshot._stmRunComplete,false);assert.equal(h.writes.at(-1).snapshot.files[0].classification,'losses');assert.equal(h.writes.at(-1).snapshot.edits.supplemental.htmlOverride,'<p>Underwriter edit</p>');
});

test('native snapshot restore honors explicit completion and clears timing from the previous submission',()=>{
 const source=fs.readFileSync(path.join(root,'pipeline-core.js'),'utf8');const start=source.indexOf('  // Load target snapshot'),end=source.indexOf('  // Phase 8.5 fix:',start);assert.ok(start>=0&&end>start);
 const hydrate=snap=>{const S=state({pipelineStart:9000,pipelineElapsedSeconds:999,pipelineRunning:true});vm.runInNewContext(source.slice(start,end),{STATE:S,rec:{snapshot:snap,pipelineRun:'PIPE-A'},submissionId:'SUB-A',deepClone:structuredClone});return S;};
 const partial=hydrate({files:[savedPdf()],extractions:{supplemental:{text:'KEEP'}},_stmRunComplete:false,pipelineElapsedSeconds:42.5});
 assert.equal(partial.pipelineDone,false);assert.equal(partial.pipelineRunning,false);assert.equal(partial.pipelineStart,0);assert.equal(partial.pipelineElapsedSeconds,42.5);assert.equal(partial.extractions.supplemental.text,'KEEP');
 const legacy=hydrate({files:[savedPdf()],extractions:{supplemental:{text:'KEEP'}}});assert.equal(legacy.pipelineDone,true);assert.equal(legacy.pipelineElapsedSeconds,null);assert.equal(C.processingState(legacy,modules).complete,false);
});

test('native Run wrapper recovers partial output instead of invoking clearing full-run path',async()=>{
 const h=controllerHarness();await h.sandbox.runPipeline();assert.equal(h.calls[0].kind,'incremental');assert.equal(h.calls.some(c=>c.kind==='full'),false);assert.equal(h.S.extractions.supplemental.text,'KEEP ORIGINAL');
});

test('native Run recovers a failed prior run with zero outputs but retains the fresh-draft full-run path',async()=>{
 const h=controllerHarness({state:{files:[savedPdf({state:'classified',classification:'losses',routedTo:'losses'})],extractions:{}}});
 await h.sandbox.runPipeline();assert.deepEqual(h.calls,[{kind:'rerun',ids:['losses']}]);assert.equal(h.api.processing().complete,true);
 const fresh=controllerHarness({state:{pipelineRun:null,pipelineDone:false,extractions:{}}});await fresh.sandbox.runPipeline();assert.deepEqual(fresh.calls,[{kind:'full'}]);
});

test('missing file-fed section restores selected evidence and uses native rerun',async()=>{
 const h=controllerHarness({state:{files:[savedPdf({state:'classified',classification:'losses',routedTo:'losses'})]}});
 await h.api.resumePending();assert.deepEqual(h.calls,[{kind:'rerun',ids:['losses']}]);assert.match(h.S.files[0].text,/Claim 42/);assert.equal(h.S.extractions.supplemental.text,'KEEP ORIGINAL');assert.equal(h.api.processing().complete,true);
});

test('snapshot completion ignores finished intake bookkeeping but never ignores unclassified sources',()=>{
 const h=controllerHarness({state:{files:[savedPdf({state:'classified',classification:'losses',routedTo:'losses'})],_stmIntakePending:1,extractions:{losses:{text:'ok'}}}});
 assert.equal(h.api.processing().complete,false);assert.equal(h.api.completionForSave(),true);
 h.S.files[0].state='parsing';assert.equal(h.api.completionForSave(),false);
});

function runtimeMethod(name,nextName,context){
 const source=fs.readFileSync(path.join(root,'redesign-runtime.js'),'utf8');
 const start=source.indexOf(' async '+name+'('),end=source.indexOf('\n '+nextName,start);
 assert.ok(start>=0&&end>start,'runtime method boundary exists');const method=source.slice(start,end).trim().replace(/,$/,'');
 return vm.runInNewContext('({'+method+'}).'+name,context,{filename:'redesign-runtime.js#'+name});
}

test('redesigned Run routes a prior zero-output failure to recovery before the native completed guard',async()=>{
 const calls=[],S=state({files:[savedPdf({state:'classified',classification:'losses',routedTo:'losses'})],extractions:{}});
 const p={STATE:S,__STM_SUBMISSION:{processing:()=>C.processingState(S,modules),resumePending:async()=>calls.push('resume')},runPipeline:async()=>calls.push('full')};
 const context={sessionEpoch:1,platform:p,runStarting:false,requireSession(){},ensureNotRunning(){},saveWorkbenchBeforeLeaving:async()=>{},R:{sync(){},navigate:async()=>calls.push('summary')}};
 await runtimeMethod('run','async website',context)();assert.deepEqual(calls,['resume']);assert.equal(context.runStarting,false);
});

test('same-submission intake batches queue through document registration and survive a failed earlier batch',async()=>{
 let release;const firstDone=new Promise(resolve=>release=resolve);const seen=[];
 const p={STATE:{},handleFiles:async batch=>{seen.push('parse '+batch[0]);if(batch[0]==='A')await firstDone;if(batch[0]==='B')throw new Error('bad B');},docsView:{design:{ingestIntake:async()=>seen.push('register')}}};
 const context={sessionEpoch:1,platform:p,intakeJobs:0,intakeGate:new C.SerialGate(),requireSession:()=>{},ensureNotRunning:allow=>{if(context.intakeJobs&&!allow)throw new Error('busy');},saveWorkbenchBeforeLeaving:async()=>{},R:{activeId:'SUB-A',sync(){}}};
 const add=runtimeMethod('addFiles','openManualPaste',context);
 const a=add(['A']),b=add(['B']),c=add(['C']);const rejected=assert.rejects(b,/bad B/);
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(seen,['parse A']);assert.equal(p.STATE._stmIntakePending,3);
 release();await Promise.all([a,rejected,c]);assert.deepEqual(seen,['parse A','register','parse B','parse C','register']);assert.equal(p.STATE._stmIntakePending,0);
});

test('queued intake cannot write into a changed submission',async()=>{
 let release;const firstDone=new Promise(resolve=>release=resolve);const seen=[];
 const p={STATE:{},handleFiles:async batch=>{seen.push(batch[0]);await firstDone;},docsView:{design:{ingestIntake:async()=>seen.push('register')}}};
 const context={sessionEpoch:1,platform:p,intakeJobs:0,intakeGate:new C.SerialGate(),requireSession:()=>{},ensureNotRunning:()=>{},saveWorkbenchBeforeLeaving:async()=>{},R:{activeId:'SUB-A',sync(){}}};
 const add=runtimeMethod('addFiles','openManualPaste',context),a=add(['A']),b=add(['B']);const failures=[assert.rejects(a,/previous submission/),assert.rejects(b,/previous submission/)];
 await new Promise(resolve=>setImmediate(resolve));context.R.activeId='SUB-B';release();await Promise.all(failures);assert.deepEqual(seen,['A']);assert.equal(p.STATE._stmIntakePending,0);
});
