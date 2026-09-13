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
