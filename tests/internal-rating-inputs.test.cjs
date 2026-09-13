'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {parseHTML}=require('linkedom');

// Exercise the actual Phase6 public read/edit/restore adapter. The workbook
// result is a fixed sentinel: availability must never alter its calculations.
function harness(){
 const {document,window:dom}=parseHTML('<html><body></body></html>');
 Object.defineProperty(dom.HTMLElement.prototype,'cells',{configurable:true,get(){return Array.from(this.children).filter(x=>x.tagName==='TD');}});
 const engine=Object.freeze({ready:true,bands:[],highVisible:false,glBase:0,otherBase:0});
 const window={document,currentUser:{id:'test-user'},crypto:require('node:crypto').webcrypto,__STM_NATIVE_RATING:{wire(){},inspect:()=>engine}};
 const api={submissionId:'S',revision:0,serializeElement:el=>el.type==='checkbox'?{c:!!el.checked}:{v:el.value}};
 const edits={map:{},dirtyTables:new Set()};let bridge;
 const ctx={api,edits,changed(){api.revision++;},mirror(){},recordHistory(){},markDirty(el){bridge.recordElement(el);}};
 const sandbox=vm.createContext({window,document,Event:dom.Event,console});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','workbench-phase6.js'),'utf8'),sandbox);
 bridge=window.STMWorkbenchPhase6.install(ctx);
 for(const spec of Object.values(bridge.specs))document.body.insertAdjacentHTML('beforeend',`<table id="${spec.id}"><tbody></tbody></table>`);
 document.body.insertAdjacentHTML('beforeend','<table id="groundUpTbl"><tbody></tbody></table><button id="clearSheetBtn"></button>');
 for(const id of ['hazardGradeSelect','nonAdmittedLimit','quotaShareLimit','nonAdmittedAttachment','nonAdmittedPremium','rsLayerPremium','rsQsPct','rsTotalLayerPrem','rsZurichPremium','rsPerMillion'])document.body.insertAdjacentHTML('beforeend',`<input id="${id}" value="">`);
 const $=id=>document.getElementById(id);
 $('nonAdmittedLimit').value='5,000,000';$('nonAdmittedAttachment').value='0';$('rsZurichPremium').value='$1,500';$('rsPerMillion').value='$1,500';
 function row(kind,values={}){
  const spec=bridge.specs[kind],tr=document.createElement('tr');
  tr.innerHTML=spec.fields.map(k=>`<td><input ${spec.attr}="${k}" type="${k==='active'?'checkbox':'text'}" value=""></td>`).join('');
  for(const [k,v]of Object.entries(values)){const el=tr.querySelector(`[${spec.attr}="${k}"]`);if(k==='active')el.checked=v;else el.value=String(v);}
  if(kind==='tower')tr.insertAdjacentHTML('beforeend','<td data-tw-out="internalPrem">$1,500</td><td data-tw-out="cPpm">$2,200</td>');
  $(spec.id).querySelector('tbody').appendChild(tr);return tr;
 }
 const primary=row('primary',{coverage:'General Liability',carrier:'TBD',limit:'1,000,000',dilFactor:'0.75',admit:'Non-Admitted'});
 const tower=row('tower',{limit:'5,000,000',carrier:'Example carrier',cPrem:'11,000'});
 const fleet=Array.from({length:15},()=>row('auto',{units:'0',rate:''}));
 const al=row('al_fleet',{units:'0',selRate:''});
 const high=Array.from({length:15},()=>row('highex',{active:false,applied:'',admit:'Non-Admitted'}));
 const set=(tr,kind,k,v)=>{const el=tr.querySelector(`[${bridge.specs[kind].attr}="${k}"]`);if(k==='active')el.checked=v;else el.value=String(v);};
 $('clearSheetBtn').onclick=()=>{set(primary,'primary','ulPrem','');set(primary,'primary','manualPrem','');};
 return {bridge,api,edits,engine,$,primary,tower,fleet,al,high,set,row,read:()=>bridge.read('S')};
}

test('default rows, layer limits and carrier premiums do not turn an empty worksheet into rated evidence',()=>{
 const h=harness(),m=h.read();assert.equal(m.engine.ready,true);assert.equal(m.engine.hasRatingInputs,false);
 assert.equal(m.outputs.rsZurichPremium,'$1,500');assert.equal(m.tables.tower[0].outputs.internalPrem,'$1,500');
 assert.equal(m.tables.tower[0].fields.cPrem.value,'11,000');assert.equal(m.tables.tower[0].outputs.cPpm,'$2,200');
 assert.equal(Object.hasOwn(h.engine,'hasRatingInputs'),false,'read must not mutate native engine state');
});

test('explicit zero and manual primary premium remain available through public edits and saved restoration',()=>{
 for(const amount of ['0','$0.00','2,345.67']){
  const h=harness(),key=h.read().tables.primary[0].fields.manualPrem.key;
  h.bridge.set('S',key,amount);assert.equal(h.read().engine.hasRatingInputs,true);
  const r=harness();r.bridge.restore(JSON.parse(JSON.stringify(h.edits.map.__phase6)));
  assert.equal(r.read().engine.hasRatingInputs,true);assert.equal(r.read().tables.primary[0].fields.manualPrem.value,amount);
 }
});

test('current first-14 internal fleet rows permit default rates, while AL worksheet and unused HNO row do not',()=>{
 const h=harness();h.set(h.al,'al_fleet','units','4');assert.equal(h.read().engine.hasRatingInputs,false);
 h.set(h.fleet[14],'auto','units','4');assert.equal(h.read().engine.hasRatingInputs,false);
 h.set(h.fleet[13],'auto','units','4');assert.equal(h.read().engine.hasRatingInputs,true);
});

test('applied overrides are recognized without inventing primary evidence or using inactive high rows',()=>{
 const h=harness();h.$('nonAdmittedPremium').value='8,500';assert.equal(h.read().engine.hasRatingInputs,true);
 h.$('nonAdmittedPremium').value='';h.set(h.high[0],'highex','applied','8,500');assert.equal(h.read().engine.hasRatingInputs,false);
 h.set(h.high[14],'highex','active',true);h.set(h.high[14],'highex','applied','8,500');assert.equal(h.read().engine.hasRatingInputs,false);
 h.set(h.high[0],'highex','active',true);assert.equal(h.read().engine.hasRatingInputs,true);
});

test('source removal, explicit clear and native empty reset recompute presence without stale ownership',()=>{
 const h=harness();h.set(h.primary,'primary','ulPrem','4,000');assert.equal(h.read().engine.hasRatingInputs,true);
 h.set(h.primary,'primary','ulPrem','');assert.equal(h.read().engine.hasRatingInputs,false);
 const key=h.read().tables.primary[0].fields.manualPrem.key;h.bridge.set('S',key,'3000');assert.equal(h.read().engine.hasRatingInputs,true);
 h.bridge.set('S',key,'');assert.equal(h.read().engine.hasRatingInputs,false);
 h.bridge.set('S',key,'3000');h.bridge.action('S','internal:clear');assert.equal(h.read().engine.hasRatingInputs,false);
 assert.equal(h.bridge.owns('primary'),true,'saved ownership alone must not count as inputs');
 h.set(h.primary,'primary','ulPrem','Not stated');assert.equal(h.read().engine.hasRatingInputs,false);
});

test('GL quoted status recognizes explicitly stated zero premiums without counting blank or invalid metadata',()=>{
 const h=harness(),row=h.row('gl_exposure',{code:'54321',exposures:'100000',base:'1000'});
 assert.equal(h.read().tables.gl_exposure[0].quoted,false);
 for(const value of ['', ' ', 'Not stated', 'Infinity', '0x10', '-1']){
  row.dataset.quotePremP=value;assert.equal(h.read().tables.gl_exposure[0].quoted,false,value);
 }
 for(const value of ['0','0.00','125.50']){
  row.dataset.quotePremP=value;assert.equal(h.read().tables.gl_exposure[0].quoted,true,value);
 }
 delete row.dataset.quotePremP;row.dataset.quotePremG='0';assert.equal(h.read().tables.gl_exposure[0].quoted,true);
});

test('GL source review relays only recorded schedule or row metadata independently of rating availability',()=>{
 const h=harness(),row=h.row('gl_exposure',{code:'54321',desc:'Unrelated-looking name',exposures:'100000',base:'1000'}),table=h.$('classTerritoryTable');
 row.insertAdjacentHTML('beforeend','<td data-out="totalRate">0.000</td><td data-out="premP">$0</td><td data-out="premG">$0</td>');
 assert.equal(h.read().tables.gl_exposure[0].review,false);
 table.dataset.glSourceReview='Recorded applicant mismatch.';row.dataset.glSourceReview='Review source schedule.';
 let shown=h.read().tables.gl_exposure[0];assert.equal(shown.review,true);assert.equal(shown.sourceReview,'Recorded applicant mismatch. Review source schedule.');assert.equal(shown.outputs.premP,'$0');
 delete row.dataset.glSourceReview;assert.equal(h.read().tables.gl_exposure[0].sourceReview,'Recorded applicant mismatch.');
 delete table.dataset.glSourceReview;shown=h.read().tables.gl_exposure[0];assert.equal(shown.review,false);assert.equal(shown.sourceReview,'','no review inferred from description');
 row.classList.add('class-code-review-required');assert.equal(h.read().tables.gl_exposure[0].review,true,'existing reference review remains visible');
});

test('GL row source review and zero quoted premiums survive saved-table restoration, including older optional metadata',()=>{
 const h=harness(),row=h.row('gl_exposure',{code:'54321',exposures:'100000',base:'1000'});
 row.dataset.quotePremP='0';row.dataset.glSourceReview='Source premium columns require review.';
 h.edits.dirtyTables.add('gl_exposure');h.bridge.capture();const saved=JSON.parse(JSON.stringify(h.edits.map.__phase6));
 assert.equal(saved.data.tables.gl_exposure[0].meta.sourceReview,row.dataset.glSourceReview);
 const r=harness();r.row('gl_exposure',{base:'1000'});r.$('classTerritoryTable').dataset.glSourceReview='Current extraction has a recorded mismatch.';r.bridge.restore(saved);
 const restored=r.read().tables.gl_exposure[0];assert.equal(restored.quoted,true);assert.equal(restored.review,true);assert.match(restored.sourceReview,/Source premium columns require review/);assert.match(restored.sourceReview,/Current extraction has a recorded mismatch/);
 delete saved.data.tables.gl_exposure[0].meta.sourceReview;assert.equal(r.bridge.validate(saved),true,'older snapshots remain valid');
});
