const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {parseHTML}=require('linkedom');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'platform.html'),'utf8');
function section(from,to){const start=html.indexOf(from),end=html.indexOf(to,start);assert.ok(start>=0&&end>start,from);return html.slice(start,end);}
function sandbox(code,extra={}){const {document}=parseHTML('<html><body><div id="stage"></div></body></html>');const ctx={document,console,...extra};vm.createContext(ctx);vm.runInContext(code,ctx);return ctx;}
test('all executable scripts in every embedded design parse; both entry pages remain identical',()=>{
 assert.equal(html,fs.readFileSync(path.join(root,'workbench.html'),'utf8'));
 const {document}=parseHTML(html);let count=0;
 for(const script of document.querySelectorAll('script')){
  if(script.type==='text/plain'){
   const inner=parseHTML(script.textContent.replaceAll('<\\/script>','</script>')).document;
   for(const js of inner.querySelectorAll('script:not([src])')){if(!js.type||js.type==='text/javascript'){new vm.Script(js.textContent,{filename:script.id});count++;}}
  }else if(!script.src&&(!script.type||script.type==='text/javascript')){new vm.Script(script.textContent);count++;}
 }
 assert.ok(count>=10,'must check the real embedded pages');
});
const fileCode=section('const fileRenderSources=new WeakMap();','const fileFooter=');
const row=(id,name='document',disabled=true)=>`<div class="file" data-file-id="${id}"><b>${name}</b><button ${disabled?'disabled':''}>Remove</button></div>`;
test('progress ticks retain intake elements despite browser-normalized disabled attributes',()=>{
 const c=sandbox(fileCode);const host=c.document.getElementById('stage');const source=row('a')+row('b');
 host.innerHTML=source;const a=host.children[0],b=host.children[1];
 for(let i=0;i<100;i++)c.patchFileRows(host,source);
 assert.equal(host.children[0],a);assert.equal(host.children[1],b);
});
test('changing one file updates only that row; add/remove/reorder preserve other rows',()=>{
 const c=sandbox(fileCode);const h=c.document.getElementById('stage');c.patchFileRows(h,row('a')+row('b'));const a=h.children[0],b=h.children[1];
 c.patchFileRows(h,row('a','classified',false)+row('b')+row('c'));assert.notEqual(h.children[0],a);assert.equal(h.children[1],b);
 const changed=h.children[0],added=h.children[2];c.patchFileRows(h,row('c')+row('b')+row('a','classified',false));
 assert.equal(h.children[0],added);assert.equal(h.children[1],b);assert.equal(h.children[2],changed);
 c.patchFileRows(h,row('b'));assert.equal(h.children.length,1);assert.equal(h.children[0],b);
});
test('loss data distinguishes missing values, explicit zeros, partial periods and blank large-loss rows',()=>{
 const c=sandbox(section('function lossNumber(value)','function loss(){'));
 const year=values=>({fields:values.map(value=>({value}))});const blank=year(['25-26','','','','','','']);
 let t=c.lossTotals({years:[blank],large:[year(['','','','Closed',''])]});assert.equal(t.incurred,null);assert.equal(t.n,null);assert.equal(t.periods,0);assert.equal(t.large,0);
 t=c.lossTotals({years:[year(['25-26','',0,0,0,0,'2026-02-28'])],large:[]});assert.equal(t.incurred,0);assert.equal(t.n,0);assert.equal(t.periods,1);assert.equal(t.partial,false);
 t=c.lossTotals({years:[year(['25-26','',1,'460,278',0,'460,278','']),blank],large:[year(['2025-10-09',460278,460278,'Closed','Feed loss'])]});
 assert.equal(t.incurred,460278);assert.equal(t.periods,1);assert.equal(t.partial,true);assert.equal(t.large,1);
 assert.equal(c.sumLoss([null,null]),null);assert.equal(c.sumLoss([null,0]),0);assert.equal(c.lossNumber('Not provided'),null);
 t=c.lossTotals({years:[year(['25-26','',1,500,0,500,'']),year(['24-25','',1,'','','',''])],large:[]});assert.equal(t.periods,2);assert.equal(t.incurred,500);assert.equal(t.partial,true,'counts do not prove missing incurred amounts are zero');
});
test('intake keeps mutation controls busy even before an extraction operation starts',()=>{
 const c=sandbox(section('function active(){','function issueText()'),{live:{state:{_stmIntakePending:1}},projection:{processing:{status:'intake'}},api:()=>({busy:false})});
 assert.equal(c.active(),true);c.live.state._stmIntakePending=0;c.projection.processing.status='pending';assert.equal(c.active(),false);
});
test('parsed intake labels report text extraction without promising completed page preparation',()=>{
 const c=sandbox(section('function fileState(f){','window.STMDesign={'));
 for(const file of [{state:'parsed'},{state:'parsed',_pushedToDocsView:false},{state:'parsed',_pushedToDocsView:true}])assert.equal(c.fileState(file),'Text extracted');
 assert.equal(c.fileState({state:'parsing'}),'Parsing');assert.equal(c.fileState({state:'classified'}),'Classified');assert.equal(c.fileState({state:'classified',needsReview:true}),'Classification needs review');assert.equal(c.fileState({state:'parsed',error:'Example parse failure'}),'Error');assert.equal(c.fileState({state:'needs_manual'}),'Manual text required');assert.equal(c.fileState({state:'ready'}),'Ready');
});
test('fresh analysis uses the first-run status and button while interrupted analysis retains recovery labels',()=>{
 const C=require('../integration-core.js'),raw={activeSubmissionId:'SUB-EXAMPLE',pipelineRun:null,pipelineDone:false,files:[{id:'file-a',state:'parsed',text:'Example source'}],extractions:{}};
 const c=sandbox(section('function active(){','function fileState(f){')+section('function runLabel(){','const intakeHead=')+section('derived=function(){const raw=live?.state||{}','// Old demos remain unreachable'),{live:{state:raw},projection:{processing:C.processingState(raw),lastOperation:null},api:()=>({busy:false}),AMODS:[],STAGES:[],S:{phase:'loaded',files:raw.files,t:0},R:{platformWindow:{document:{getElementById:()=>null}}}});
 const stage=c.document.getElementById('stage');stage.innerHTML='<span data-f="run-label"></span>';c.stage=stage;
 const label=section("  stage.querySelectorAll('[data-f=\"run-label\"]')","  stage.querySelectorAll('[data-f=\"k-files-s\"]')");
 vm.runInContext(label,c);assert.equal(stage.textContent,'Run pipeline · 1 files');assert.equal(c.derived().ptext,'Ready for analysis');
 raw.pipelineRun='PIPE-EXAMPLE';c.projection.processing=C.processingState(raw);vm.runInContext(label,c);
 assert.equal(stage.textContent,'Resume pending processing');assert.equal(c.derived().ptext,'Processing incomplete — resume pending work');
});
test('file source labels use actual module routing, including multiple source files',()=>{
 const c=sandbox(section('function srcText(k)','function rosterCounts()'),{M:{cls:{stage:0},loss:{stage:1},gl:{stage:1}},S:{files:[{name:'loss1.pdf',routes:['loss']},{name:'loss2.pdf',routes:['loss','gl']},{name:'waiting.pdf',routes:[]}]}});
 assert.equal(c.srcText('cls'),'2 of 3 files routed');assert.equal(c.srcText('loss'),'loss1.pdf, loss2.pdf');assert.equal(c.srcText('gl'),'loss2.pdf');
});
test('save and hydration notifications do not replace the selected document preview or search input',()=>{
 const code=section('const documentRenderSources=new WeakMap();','function refresh(force=false)');
 const {document}=parseHTML('<html><body><div id="stage"></div></body></html>');
 let selected='a',indexText='first';const model={docs:[{id:'a',tagged:true}],save:{},categories:[]};
 const c=sandbox(code,{document,stage:document.getElementById('stage'),model,scrollY:0,scrollTo(){},fileGroups:()=>[[]],I:{search:''},wtabs:()=>'<button>Documents</button>',tools:()=>'',esc:String,query:'',category:'all',index:()=>indexText,header:()=>'<b>Selected</b>',content:()=>'<img data-page="'+selected+'">',expanded:false});
 c.render();const image=c.stage.querySelector('img'),search=c.stage.querySelector('input');
 for(let i=0;i<10;i++){model.save={dirty:!!(i%2),pending:i};c.render();assert.equal(c.stage.querySelector('img'),image);assert.equal(c.stage.querySelector('input'),search);}
 indexText='renamed unrelated file';c.render();assert.equal(c.stage.querySelector('img'),image);
 selected='b';c.render();assert.notEqual(c.stage.querySelector('img'),image);assert.equal(c.stage.querySelector('input'),search);
});
test('mixed-category pages retain their own category groups and filtered navigation stays in the visible set',()=>{
 const docs=[{id:'a',group:'file',category:'underlying',page:1},{id:'b',group:'file',category:'applications',page:2},{id:'c',group:'file',category:'underlying',page:3}];
 const c=sandbox(section('function fileGroups(docs','function wtabs(){'),{model:{docs},selected:'a',visible:()=>docs.filter(d=>d.category==='underlying')});
 assert.equal(c.fileGroups(docs).length,1,'one physical source');assert.equal(c.fileGroups(docs,true).length,2,'two category groups');
 assert.deepEqual(Array.from(c.siblings(),d=>d.id),['a','c']);
});
test('automatic marker review previews counts and applies only the reviewed preview',async()=>{
 const preview={changedPages:207,taggedBefore:220,taggedAfter:13,untouchedManualPages:2,skippedPages:0,files:[{name:'<source>.pdf',changedPages:207}]};
 const calls=[],buttons={'[type="submit"]':{},'[data-close]':{}};let review;
 const c=sandbox(section('async function reviewAutomaticMarkers(){','function act(a,el)'),{api:()=>({repairMarkers:async options=>{calls.push(options);return preview;}}),esc:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;'),R:{toast(){}},dialog:(title,html,apply)=>{review={title,html,apply};return{querySelector:s=>buttons[s]};}});
 await c.reviewAutomaticMarkers();assert.equal(calls.length,1);assert.equal(calls[0],undefined);assert.match(review.html,/220 → 13/);assert.match(review.html,/&lt;source&gt;.pdf/);assert.equal(buttons['[type="submit"]'].textContent,'Correct 207 page markers');
 await review.apply();assert.equal(calls.length,2);assert.equal(calls[1].apply,true);assert.equal(calls[1].preview,preview);
 preview.changedPages=0;await c.reviewAutomaticMarkers();assert.equal(review.apply,null,'no write action when already correct');
});
test('source review messages are visible text and do not become HTML',()=>{
 const c=sandbox(section('function reviewMessages(c)','function details(c)'),{esc:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;')});
 assert.equal(c.reviewMessages({}), '');assert.match(c.reviewMessages({reviewMessages:['Mismatched <insured>']}),/Mismatched &lt;insured&gt;/);
});
test('empty internal rating displays unavailable derived premiums while retaining carrier quotes and raw formulas',()=>{
 const model={engine:{hasRatingInputs:false},outputs:{rsZurichPremium:'$1,500'},tables:{tower:[{outputs:{internalPrem:'$1,500',internalPpm:'$750',cPpm:'$10,000',rel:'15%'}}]}};
 const c=sandbox(section('  function ratingDisplayValue(path){','  const value=ratingDisplayValue;'),{model,route:'wb-internal'});
 assert.equal(c.ratingDisplayValue('outputs.rsZurichPremium'),'Not rated');assert.equal(c.ratingDisplayValue('tables.tower.0.outputs.internalPrem'),'Not rated');assert.equal(c.ratingDisplayValue('tables.tower.0.outputs.rel'),'Not rated');assert.equal(c.ratingDisplayValue('tables.tower.0.outputs.cPpm'),'$10,000');
 assert.equal(model.outputs.rsZurichPremium,'$1,500','display must not change engine calculations');
 model.engine.hasRatingInputs=true;assert.equal(c.ratingDisplayValue('outputs.rsZurichPremium'),'$1,500');
 model.engine.hasRatingInputs=false;c.route='wb-al';assert.equal(c.ratingDisplayValue('outputs.rsZurichPremium'),'$1,500','other raters retain their independent display');
});

function glRenderers(model){
 const starts=Array.from(html.matchAll(/  function ratingNumber\(value\)\{/g),m=>m.index);
 assert.equal(starts.length,3,'check GL, AL and Internal Rater embedded copies');
 return starts.map(start=>{
  const helpers=html.slice(start,html.indexOf('  const value=ratingDisplayValue;',start));
  const stats=html.indexOf('  function stats(){',start);
  const numberStart=html.lastIndexOf('  const num=',start);
  const numbers=html.slice(numberStart,html.indexOf('  const icon=',numberStart));
  return sandbox(numbers+helpers+html.slice(stats,html.indexOf('  function fig(',stats)),{model:structuredClone(model),route:'wb-gl'});
 });
}
function glModel(rows,text={totalPremium:'$150',totalPremOps:'$100',totalProducts:'$50'}){
 return {tables:{gl_exposure:rows,al_fleet:[],primary:[],tower:[]},text,engine:{ready:true},dirty:false};
}
function glRow(exposure,premP='$100',premG='$50',totalRate='1.500'){
 return {fields:{exposures:{value:exposure}},outputs:{premP,premG,totalRate}};
}

test('GL renderers show unknown row and total outputs as Not rated without changing source values',()=>{
 const model=glModel([glRow('100,000','Not stated','$50','Not rated')],{totalPremium:'Not rated',totalPremOps:'Not stated',totalProducts:'$50'});
 for(const c of glRenderers(model)){
  const before=JSON.stringify(c.model);c.stats();
  assert.equal(c.model.display.glTotal,'Not rated');assert.equal(c.model.display.glBlended,'Not rated');assert.equal(c.model.display.glRated,'0 of 1 classes rated');
  assert.equal(c.model.display.glParts,'Not rated · $50');
  assert.equal(c.ratingDisplayValue('tables.gl_exposure.0.outputs.premP'),'Not rated');assert.equal(c.ratingDisplayValue('tables.gl_exposure.0.outputs.totalRate'),'Not rated');assert.equal(c.ratingDisplayValue('text.totalPremOps'),'Not rated');
  assert.equal(c.ratingDisplayValue('tables.gl_exposure.0.outputs.premG'),'$50');
  const {display,...unchanged}=c.model;assert.equal(JSON.stringify(unchanged),before,'presentation must preserve the native outputs');
 }
});

test('GL rated counts require complete numeric row outputs and positive exposure; partial schedules have no blended rate',()=>{
 const model=glModel([glRow('100,000'),glRow('200,000','Not stated','$0','Not rated'),glRow('0','$0','$0','0.000'),glRow('50,000','$0','$0','0.000')]);
 for(const c of glRenderers(model)){
  c.stats();assert.equal(c.model.display.glRated,'2 of 4 classes rated');assert.equal(c.model.display.glTotal,'Not rated');assert.equal(c.model.display.glBlended,'Not rated');
  assert.equal(c.ratingDisplayValue('tables.gl_exposure.3.outputs.premP'),'$0','explicit zero stays numeric');
  c.model.tables.gl_exposure[1]=glRow('200,000','$0','$0','0.000');c.stats();
  assert.equal(c.model.display.glRated,'3 of 4 classes rated');assert.equal(c.model.display.glTotal,'$150');assert.equal(c.model.display.glBlended,'0.429');
 }
});

test('GL missing totals never turn into zero rates, while an explicitly zero rated schedule remains zero',()=>{
 const model=glModel([glRow('100,000','$0','$0','0.000')],{totalPremium:'$0',totalPremOps:'$0',totalProducts:'$0'});
 for(const c of glRenderers(model)){
  c.stats();assert.equal(c.model.display.glRated,'1 of 1 classes rated');assert.equal(c.model.display.glTotal,'$0');assert.equal(c.model.display.glBlended,'0.000');
  for(const value of ['',null,'—','Not stated','Not rated','Pending 0']){
   c.model.text.totalPremium=value;c.stats();assert.equal(c.model.display.glTotal,'Not rated');assert.equal(c.model.display.glBlended,'Not rated');assert.equal(c.ratingDisplayValue('text.totalPremium'),'Not rated');
  }
  c.model=glModel([glRow('0','$0','$0','0.000')],{totalPremium:'$0',totalPremOps:'$0',totalProducts:'$0'});c.stats();
  assert.equal(c.model.display.glRated,'0 of 1 classes rated');assert.equal(c.model.display.glBlended,'Not rated');
 }
});

test('each GL renderer places recorded source review notices on the affected row and escapes the reason',()=>{
 const starts=Array.from(html.matchAll(/  function glSourceReview\(row\)\{/g),m=>m.index);assert.equal(starts.length,3);
 for(const start of starts){
  const rows=[{...glRow('100,000'),key:'reviewed',review:true,sourceReview:'Recorded mismatch: <name> "quoted"'}, {...glRow('100,000'),key:'clear',review:false}];
  const escStart=html.lastIndexOf('  const esc=',start),esc=html.slice(escStart,html.indexOf('  const num=',escStart));
  const c=sandbox(esc+html.slice(start,html.indexOf('  function alHalf(',start)),{model:{tables:{gl_exposure:rows},display:{}},num:Number,tabs:()=>'',figs:()=>'',fig:()=>'',cell:()=>'<input>',output:()=>'',button:()=>'',text:()=>'',icon:()=>'',foot:()=>''});
  const output=c.glView(),document=parseHTML(output).document;
  assert.equal(document.querySelectorAll('small').length,1);assert.equal(document.querySelector('[data-rating-row="reviewed"] small').textContent,'Source review required');assert.equal(document.querySelector('[data-rating-row="clear"] small'),null);
  assert.equal(document.querySelector('small').title,rows[0].sourceReview);assert.doesNotMatch(output,/<name>/);assert.match(output,/&lt;name&gt;/);
  rows[0].review=false;rows[0].sourceReview='';assert.equal(parseHTML(c.glView()).document.querySelector('small'),null,'no warning inferred from unflagged output');
 }
});

function focusedRatingRenderers(){
 const starts=Array.from(html.matchAll(/  function paintDerivedFields\(\)\{/g),m=>m.index);assert.equal(starts.length,3);
 return starts.map(start=>{
  const {document}=parseHTML('<html><body><div id="stage"><input type="text" data-rating-field="r|tower|target|limit" value="2."><input type="text" data-rating-field="r|tower|target|attach" readonly value="1,000,000"><input type="text" data-rating-field="r|highex|high|attach" readonly value="1,000,000"><input type="text" data-rating-field="missing" readonly value="Retain"><span data-rating-output="tables.tower.1.outputs.internalPrem">$7,500</span></div></body></html>');
  const stage=document.getElementById('stage'),editable=stage.querySelector('[data-rating-field="r|tower|target|limit"]'),derived=stage.querySelector('[data-rating-field="r|tower|target|attach"]'),high=stage.querySelector('[data-rating-field="r|highex|high|attach"]');
  let focused=editable;Object.defineProperty(document,'activeElement',{configurable:true,get:()=>focused});
  editable.selectionStart=2;editable.selectionEnd=2;editable.selectionDirection='none';
  const field=(key,value,readonly=false)=>({key,value,readonly});
  const next={fields:{},tables:{tower:[{key:'underlying',fields:{attach:field('r|tower|underlying|attach','0',true)},outputs:{}},{key:'target',fields:{limit:field('r|tower|target|limit','2,000,000'),attach:field('r|tower|target|attach','2,000,000',true)},outputs:{internalPrem:'$12,500'}}],highex:[{key:'high',fields:{attach:{...field('r|highex|high|attach','$2,000,000',true),money:true}}}]}};
  const w={__STM_WB_PHASE6:{}},R={activeId:'S',workbenchWindow:w,route:'wb-internal'};
  const displayStart=html.lastIndexOf('  const displayValue=',start),displayCode=html.slice(displayStart,html.indexOf('  function input(',displayStart));
  const c=sandbox(displayCode+html.slice(start,html.indexOf('  function commit(',start)),{document,stage,R,route:'wb-internal',bound:null,owner:null,model:null,signature:'old',service:()=>({read:()=>next}),stats(){},report(e){throw e;},internalView(){throw Error('focused refresh must not replace DOM');},scrollTo(){throw Error('focused refresh must not scroll');},scrollY:0});
  c.value=path=>path.split('.').reduce((o,k)=>o?.[k],c.model);
  return {c,document,stage,editable,derived,high,next,focus:el=>{focused=el;}};
 });
}

test('focused rating refresh updates readonly tower and high-excess attachments without replacing editable input or cursor',()=>{
 for(const {c,document,stage,editable,derived,high}of focusedRatingRenderers()){
  const children=Array.from(stage.children);c.refresh();
  assert.equal(derived.value,'2,000,000');assert.equal(derived.title,'2,000,000');assert.equal(high.value,'2,000,000','same formatting as full render');
  assert.equal(stage.querySelector('[data-rating-output]').textContent,'$12,500');
  assert.equal(editable.value,'2.','retain unfinished user input');assert.equal(document.activeElement,editable);assert.equal(editable.selectionStart,2);assert.equal(editable.selectionEnd,2);
  assert.deepEqual(Array.from(stage.children),children,'in-place synchronization preserves every node');assert.equal(stage.querySelector('[data-rating-field="missing"]').value,'Retain','unknown field identity must not bind by row index');
 }
});

test('focused readonly rating controls receive changed derived values and retain focus and text selection',()=>{
 for(const {c,document,derived,editable,focus,next}of focusedRatingRenderers()){
  focus(derived);derived.selectionStart=1;derived.selectionEnd=4;derived.selectionDirection='forward';let selections=0;
  derived.setSelectionRange=(start,end,direction)=>{selections++;derived.selectionStart=start;derived.selectionEnd=end;derived.selectionDirection=direction;};
  c.refresh();assert.equal(derived.value,'2,000,000');assert.equal(document.activeElement,derived);assert.equal(derived.selectionStart,1);assert.equal(derived.selectionEnd,4);assert.equal(derived.selectionDirection,'forward');assert.equal(selections,1);
  c.refresh();assert.equal(selections,1,'unchanged values do not reset selection');
  next.tables.tower[1].fields.attach.value='3,000,000';c.refresh();assert.equal(derived.value,'3,000,000');assert.equal(derived.title,'3,000,000');assert.equal(selections,2);assert.equal(editable.value,'2.');
 }
});

test('queue gap badges distinguish missing assessment from recorded gaps without inventing missing fields',()=>{
 const C=require('../integration-core.js');
 const c=sandbox(section('const gapChip=s=>','/* ---- render'),{esc:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;')});
 c.record=C.queueRecord({id:'PREMINT',modulesRun:0,missingInfo:[],snapshot:{_stub:true,extractions:{}}});
 let shown=vm.runInContext('gapChip(record)',c);assert.match(shown,/No extraction yet/);assert.doesNotMatch(shown,/complete|No recorded gaps/i);assert.deepEqual(c.record.missing,[]);
 c.record=C.queueRecord({id:'SAVED',modulesRun:12,missingInfo:[],snapshot:null});
 shown=vm.runInContext('gapChip(record)',c);assert.match(shown,/No recorded gaps/);assert.doesNotMatch(shown,/complete|No extraction yet/i);
 c.record=C.queueRecord({id:'PARTIAL',modulesRun:0,missingInfo:['Broker <name>']});
 shown=vm.runInContext('gapChip(record)',c);assert.match(shown,/1 missing/);assert.match(shown,/Broker &lt;name&gt;/);assert.doesNotMatch(shown,/No extraction yet/,'retain known missing items even before new outputs');
});

test('queue figure identifies its running count as local to this tab',()=>{
 const c=sandbox(section('function renderFigures(){','function renderQueue(first){'),{stats:()=>({total:4,awaiting:4,inProgress:0,avgConf:null,gaps:0,modsRun:0,modsCap:96}),D:{pipelineModules:24,formats:['PDF']}});
 c.document.body.insertAdjacentHTML('beforeend','<div id="figures"></div>');c.renderFigures();
 assert.match(c.document.getElementById('figures').textContent,/4 awaiting UW review, 0 running in this tab/);
 assert.doesNotMatch(c.document.getElementById('figures').textContent,/0 in progress/);
});
