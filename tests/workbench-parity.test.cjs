const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {parseHTML} = require('linkedom');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'workbench-app.js'), 'utf8');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const clone = x => JSON.parse(JSON.stringify(x));
function section(start,end) {
  const from=app.indexOf(start),to=app.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from, 'production hydration seam exists');
  return app.slice(from,to);
}

// DOM only: public adapters and the actual July source parsers/writers execute
// unchanged. Network/cloud, PDF extraction and visual startup are not simulated.
function harness(realGlSource=false) {
  const dom=parseHTML('<html><body></body></html>'),document=dom.document;
  const window={document,Event:dom.window.Event,HTMLSelectElement:dom.window.HTMLSelectElement,HTMLElement:dom.window.HTMLElement};
  Object.defineProperties(window.HTMLSelectElement.prototype,{
    value:{configurable:true,get(){return Array.from(this.options).find(o=>o.hasAttribute('selected'))?.getAttribute('value')??this.options[0]?.getAttribute('value')??'';},set(v){Array.from(this.options).forEach(o=>{if((o.getAttribute('value')??o.textContent)===String(v))o.setAttribute('selected','');else o.removeAttribute('selected');});}},
    selectedIndex:{configurable:true,get(){return Array.from(this.options).findIndex(o=>o.hasAttribute('selected'));}}
  });
  window.HTMLSelectElement.prototype.add=function(o){this.appendChild(o);};
  Object.defineProperty(window.HTMLElement.prototype,'cells',{configurable:true,get(){return Array.from(this.children).filter(n=>/^(TD|TH)$/.test(n.tagName));}});
  document.body.innerHTML='<select id="layerType"><option value="Lead">Lead</option></select><div id="risk-limits"></div><table id="groundUpTbl"><tbody></tbody></table><div id="totalPremOps"></div><div id="totalProducts"></div><div id="totalPremium"></div>';
  const $=id=>document.getElementById(id);
  const input=(name,value='',extra='')=>`<input type="text" ${name} value="${value}" ${extra}>`;
  function year(line,period='2025') {
    const row=document.createElement('div');row.className='loss-row';
    row.innerHTML=`<select class="policy-select">${['2025','2024','2023','2022','2021','2020'].map(y=>`<option value="${y}" ${y===period?'selected':''}>${y}</option>`).join('')}</select>`+
      ['exposure','claims','paid','reserve','incurred'].map(f=>input(`data-loss="${f}"`,'',f==='claims'?'':'class="currency-input"')).join('')+input('class="loss-date-picker"');
    $(line+'LossRows').appendChild(row);return row;
  }
  function large(line) {const row=document.createElement('div');row.className='large-loss-row';row.innerHTML=input('class="large-loss-date"')+'<div class="currency-wrap">'+input('data-loss="incurred"')+'</div><div class="currency-wrap">'+input('data-loss="paid"')+'</div><select><option value="Open">Open</option><option value="Closed">Closed</option></select><textarea></textarea>';$(line+'LargeLossRows').appendChild(row);return row;}
  for(const line of ['gl','auto']){
    const cap=line==='gl'?'Gl':'Auto';
    document.body.insertAdjacentHTML('beforeend',`<div id="${line}LossRows"></div><div id="${line}LargeLossRows"></div><input type="checkbox" id="noLosses${cap}Chk">`+['add','remove'].flatMap(op=>['Year','LargeLoss'].map(kind=>`<button id="${op}${cap}${kind}"></button>`)).join(''));
    $('noLosses'+cap+'Chk').checked=false;year(line);year(line,'2024');large(line);
    $('add'+cap+'Year').onclick=()=>year(line,'2023');
    $('remove'+cap+'Year').onclick=()=>$(line+'LossRows').lastElementChild?.remove();
    $('add'+cap+'LargeLoss').onclick=()=>large(line);
    $('remove'+cap+'LargeLoss').onclick=()=>$(line+'LargeLossRows').lastElementChild?.remove();
    $(line+'LossRows').addEventListener('change',e=>{const selects=Array.from($(line+'LossRows').querySelectorAll('.policy-select'));if(e.target===selects[0]){let year=+e.target.value;selects.slice(1).forEach(el=>el.value=String(--year));}});
  }
  const configs={gl_exposure:['classTerritoryTable','data-f',['code','desc','state','zip','exposures','base','rateP','rateG'],'glRaterAddRow',2],al_fleet:['autoExposuresTbl','data-f',['selRate','units'],null,15],primary:['primaryPoliciesTbl','data-pp',['coverage','carrier','limit','ulPrem','manualPrem','admit','dilFactor'],'internalAddPrimary',2],tower:['towerLimitsTable','data-tw',['limit','carrier','cPrem','target'],'internalAddLayer',2],highex:['highExcessTable','data-he',['active','limit','admit','factor','applied','carrier','towerPrem'],'internalAddHighExcess',2],auto:['autoTable','data-a',['units','rate','expUnits','expRate'],null,15]};
  function ratingRow(kind){const [id,attr,fields]=configs[kind],row=document.createElement('tr');row.innerHTML=(kind==='al_fleet'||kind==='auto'?'<td>Category</td>':'')+fields.map(f=>'<td>'+(f==='base'?`<select ${attr}="base">${['1000','100','1','payroll'].map(v=>`<option value="${v}">${v}</option>`).join('')}</select>`:f==='admit'?`<select ${attr}="admit"><option value="Non-Admitted">Non-Admitted</option><option value="Admitted">Admitted</option></select>`:input(`${attr}="${f}"`,'',f==='active'?'type="checkbox"':''))+'</td>').join('')+(kind==='gl_exposure'?'<td data-out="totalRate"></td><td data-out="premP"></td><td data-out="premG"></td>':'');$(id).querySelector('tbody').appendChild(row);if(kind==='primary'){row.querySelector('[data-pp="coverage"]').value=$(id).querySelectorAll('tr').length===1?'General Liability':'Auto Liability';}return row;}
  for(const [kind,[id,,fields,add,count]]of Object.entries(configs)){
    document.body.insertAdjacentHTML('beforeend',`<table id="${id}"><tbody></tbody></table>`+(add?`<button id="${add}"></button>`:''));
    for(let i=0;i<count;i++)ratingRow(kind);if(add)$(add).onclick=()=>ratingRow(kind);
  }
  const logs={info(){},log(){},warn(){}};
  const context=vm.createContext({window,document,console:logs,Event:window.Event,URLSearchParams,Date,Map,Set,Uint32Array,localStorage:{},sessionStorage:{},parent:window,CSS:{escape:x=>x}});
  window.crypto=require('node:crypto').webcrypto;window.currentUser={id:'test-user'};window.location={search:''};
  const api={submissionId:'SUB-A',revision:0,serializeElement:el=>el.type==='checkbox'?{c:!!el.checked}:{v:el.value}};
  const edits={map:{},dirtyTables:new Set()};
  const ctx={api,edits,mirror(){},changed(){api.revision++;},recordHistory(){},coverageTypes:{},coverageName(){return '';},initDates(){},recalc(){},applyLayer(){},addCoverageEntry(){},prefillInsured(){},applyEl(el,v,fire){if('c'in v)el.checked=v.c;else el.value=String(v.v??'');if(el._flatpickr)el._flatpickr.setDate(el.value,false);if(fire){el.dispatchEvent(new window.Event('input',{bubbles:true}));el.dispatchEvent(new window.Event('change',{bubbles:true}));}},markDirty(el){if(window.__STM_WB_PHASE5?.recordElement(el)||window.__STM_WB_PHASE6?.recordElement(el))return;if(el.id)edits.map[el.id]=api.serializeElement(el);}};
  vm.runInContext(read('workbench-phase5.js'),context);const p5=window.STMWorkbenchPhase5.install(ctx);
  vm.runInContext(read('workbench-phase6.js'),context);const p6=window.STMWorkbenchPhase6.install(ctx);
  Object.assign(context,{n85:v=>Number(String(v??'').replace(/[^0-9.-]/g,''))||0,formatCurrency(){},stmSetDateField8772(el,v){if(el&&v)el.value=p5.dateISO(v);},set85(el,v){if(el&&v!=null&&v!==''){el.value=String(v);return true;}return false;}});
  vm.runInContext(section('        function parseLossTables85(', '        // v8.7.20: public no-cost rebind hook'),context);
  vm.runInContext(section('        function applyGLExposureRaterFromActiveSubmission(', '        // v8.6.87 — section population hardening'),context);
  const tbody=$('classTerritoryTable').querySelector('tbody');
  Object.assign(context,{parseGLClassRows89:s=>s.classes||[],glSourceReview89:()=>'',stateZipFromSubmission89:()=>({state:'TX',zip:'77001'}),normalizeBasisForSelect:()=> '1000',unlockGlRaterRows94(){},syncUnderwritingRiskProfileFromGlRater8702(){},parseNumber:v=>Number(String(v||'').replace(/[^0-9.-]/g,''))||0,fmt:{money:v=>'$'+Math.round(v).toLocaleString('en-US')},tbody,totPremOpsEl:$('totalPremOps'),totProductsEl:$('totalProducts'),totalDisplayEl:$('totalPremium')});
  window.WorkbenchRules={resolveField(){return null;}};
  if(realGlSource){
    vm.runInContext(read('workbench-rules.js'),context);
    vm.runInContext(section('        function normalizeBasisForSelect(', '        function normalizeExposureBasisOption('),context);
    vm.runInContext(section('        const _csft89Memo =', '        // v8.6.87 — section population hardening'),context);
    vm.runInContext(section('        function r85(', '        function parseLossTables85('),context);
  }
  vm.runInContext(section('            function recalcGLRater() {','            window.__stmRecalcGLRater87104 ='),context);
  window.__stmRecalcGLRater87104=context.recalcGLRater;
  return {window,document,$,api,edits,p5,p6,context,year,large,ratingRow,fillLoss:context.applyLossHistoryFromActiveSubmission,fillGL:context.applyGLExposureRaterFromActiveSubmission};
}
function losses(paid=100,claims=2){return {id:'SUB-A',snapshot:{extractions:{losses:{text:JSON.stringify({policy_years:[{policy_year:'25-26',gl_claims:claims,gl_paid:paid,gl_reserve:20,gl_incurred:paid+20,al_claims:1,al_paid:9,al_reserve:0,al_incurred:9},{policy_year:'24-25',gl_claims:3,gl_paid:200,gl_reserve:30,gl_incurred:230}],large_losses:[{lob:'GL',dol:'01/02/2025',incurred:120,paid:100,description:'Claim A',status:'Open'}]})}}}};}
const glClasses=exposure=>({classes:[{code:'11111',desc:'One',exposure,base:'1000',rateP:'2',rateG:'1',quotePremP:'700',quotePremG:'100'},{code:'22222',desc:'Two',exposure:2000,base:'1000',rateP:'3',rateG:'0'}]});
const glSchedule=(rows,flatten=false)=>('COMMERCIAL GENERAL LIABILITY\nRATE PREM/ PROD/COMP\nCLASSIFICATION CODE# PREMIUM BASIS BASIS OPS OPS\n'+rows.join('\n')+'\nRATE BASIS: 1 - SALES PER $1,000\nADDITIONAL COVERAGES\nOther coverage $99,999').replace(flatten?/\n/g:/$^/g,' ');
const glSource=(text,extra={})=>({id:'SUB-A',home_state:'TX',snapshot:{files:[{id:'QUOTE-A',name:'Quote.pdf',submissionId:'SUB-A',routedToAll:['gl_quote'],extractMeta:{pageTexts:[{page:4,text}]},...extra}]}});

test('actual flattened PDF-style class schedule carries arbitrary exposure and printed premiums into native calculation',()=>{
  for(const flattened of [false,true]){
    const h=harness(true),sub=glSource(glSchedule(['Hardware Stores 13716 2,345,000 (001) $1,234 $2,345','Feed Dealers 12583 75,000 (001) $0 $45'],flattened));
    const parsed=h.context.parseGLClassRows89(sub);assert.equal(parsed.length,2);assert.equal(parsed[0].sourcePage,4);assert.equal(parsed[1].quotePremP,0);
    h.fillGL(sub);const rows=h.p6.read('SUB-A').tables.gl_exposure;
    assert.equal(rows[0].fields.exposures.value,'2,345,000');assert.equal(rows[1].fields.exposures.value,'75,000');assert.equal(rows[1].fields.rateP.value,'0');
    assert.equal(h.$('totalPremium').textContent,'$3,624');assert.equal(h.$('totalPremOps').textContent,'$1,234');assert.equal(h.$('totalProducts').textContent,'$2,390');
  }
});

test('missing or ambiguous class premiums never borrow another row/page/file amount or retain stale rates',()=>{
  const h=harness(true),complete=glSchedule(['Hardware Stores 13716 2,345,000 (001) $1,234 $2,345']);h.fillGL(glSource(complete));
  for(const row of ['Hardware Stores 13716 2,345,000 (001) $99','Hardware Stores 13716 2,345,000 (001) $99 $88 $77','Hardware Stores 13716 2,345,000 (001)']){
    const sub=glSource(glSchedule([row]));sub.snapshot.files[0].extractMeta.pageTexts.push({page:5,text:'$1,234 $2,345'});sub.snapshot.files.push({name:'Other Quote.pdf',routedToAll:['gl_quote'],extractMeta:{pageTexts:['$1,234 $2,345']}});
    h.fillGL(sub);const result=h.p6.read('SUB-A').tables.gl_exposure[0];assert.equal(result.fields.rateP.value,'');assert.equal(result.fields.rateG.value,'');assert.equal(result.outputs.premP,'Not stated');assert.equal(result.outputs.premG,'Not stated');assert.equal(result.review,true);assert.equal(h.$('totalPremium').textContent,'Not rated');
  }
  const noHeading=glSource('COMMERCIAL GENERAL LIABILITY\nHardware Stores 13716 2,345,000 (001) $1,234 $2,345');assert.equal(h.context.parseGLClassRows89(noHeading).length,0);
  const unrelated=glSource('Property value 7,654,000\nReference 13716\nVehicle value 3,210,000');assert.equal(h.context.parseGLClassRows89(unrelated).length,0);
});

test('GL source eligibility honors snapshot gates, explicit file scope and current evidence without a stale memo',()=>{
  const h=harness(true),text=glSchedule(['Hardware Stores 13716 2,345,000 (001) $12 $34']);
  for(const metadata of [{submissionId:'SUB-B'},{cancelled:true},{state:'duplicate'},{state:'error'},{routedToAll:['al_quote']}])assert.equal(h.context.parseGLClassRows89(glSource(text,metadata)).length,0);
  for(const record of [{rejected:true},{refused:true},{excluded:true},{gateDetails:{proceed:false}}]){const s=glSource(text);s.snapshot.extractions={gl_quote:record};assert.equal(h.context.parseGLClassRows89(s).length,0);}
  const strict=glSource(text);strict.snapshot.extractions={gl_quote:{applicantGate:'mismatch',text:JSON.stringify({class_codes:[{code:'13716',premium_basis:999000,rate_basis:'001',prem_ops_premium:90,prod_comp_premium:10}]})}};
  h.window.STM_APPLICANT_GATE_MODE='strict';assert.equal(h.context.parseGLClassRows89(strict).length,0);
  h.fillGL(strict);assert.match(h.$('classTerritoryTable').dataset.glSourceReview,/applicant mismatch/);
  h.window.STM_APPLICANT_GATE_MODE='off';assert.equal(h.context.parseGLClassRows89(strict)[0].quotePremP,90);
  assert.match(h.context.parseGLClassRows89(strict)[0].sourceReview,/applicant mismatch/);
  const review=glSource(text);review.snapshot.extractions={gl_quote:{text:JSON.stringify({review_required:true,source_identity_conflicts:[{sourceModule:'gl_quote',detectedInsureds:['Other Example'],submissionInsured:'Current Example'}]})}};h.fillGL(review);assert.match(h.$('classTerritoryTable').dataset.glSourceReview,/identity conflict/);
  const fresh=glSource(text);assert.equal(h.context.parseGLClassRows89(fresh)[0].quotePremP,12);fresh.snapshot.files[0].extractMeta.pageTexts[0].text=text.replace('$12','$56');assert.equal(h.context.parseGLClassRows89(fresh)[0].quotePremP,56);
});

test('conflicting class schedules remain unrated while structured A12 remains authoritative, including zero',()=>{
  const h=harness(true),text=glSchedule(['Hardware Stores 13716 2,345,000 (001) $12 $34']),sub=glSource(text);
  sub.snapshot.files.push({...clone(sub.snapshot.files[0]),id:'QUOTE-B',extractMeta:{pageTexts:[text.replace('$12','$99')]}});
  sub.snapshot.files.push({...clone(sub.snapshot.files[0]),id:'QUOTE-C'});
  h.fillGL(sub);assert.equal(h.$('totalPremium').textContent,'Not rated');assert.match(h.context.parseGLClassRows89(sub)[0].reviewReason,/Conflicting/);
  sub.snapshot.extractions={gl_quote:{text:JSON.stringify({class_codes:[{code:'13716',premium_basis:80000,rate_basis:'001',prem_ops_premium:0,prod_comp_premium:70}]})}};
  h.fillGL(sub);const rows=h.p6.read('SUB-A').tables.gl_exposure;assert.equal(rows[0].fields.exposures.value,'80,000');assert.equal(rows[0].fields.rateP.value,'0');assert.equal(rows[0].outputs.premP,'$0');assert.equal(h.$('totalPremium').textContent,'$70');
});

test('raw column fallback requires exact alignment and numbered descriptions cannot shift premium cells',()=>{
  const h=harness(true),column=glSource('COMMERCIAL GENERAL LIABILITY\nCLASSIFICATION\nCODE#\nPREMIUM BASIS\nPREM/OPS\nPROD/COMP OPS\nHardware Stores\nFeed Dealers\n13716\n12583\n1,234,000\n54,000\n(001)\n(001)\n$12\n$34\n$56\n$78\nRATE BASIS: 1 - SALES PER $1,000');
  const rows=h.context.parseGLClassRows89(column);assert.equal(rows.length,2);assert.ok(rows.every(r=>r.quotePremP===''&&r.quotePremG===''));
  const odd=glSource(glSchedule(['Hardware Stores 13716 2,345,000 (001) $12 $34','Feed Dealer Location 2 12583 75,000 (001) $56 $78'],true));
  const parsed=h.context.parseGLClassRows89(odd);assert.equal(parsed.length,2);assert.equal(parsed[0].quotePremP,'');assert.equal(parsed[1].quotePremP,56);
  const bad=clone(column);bad.snapshot.files[0].extractMeta.pageTexts[0].text=column.snapshot.files[0].extractMeta.pageTexts[0].text.replace('54,000\n','');assert.equal(h.context.parseGLClassRows89(bad).length,0);
});

test('actual raw class feed preserves manual cells and explicit clears through new source and saved reload',()=>{
  const h=harness(true),first=glSource(glSchedule(['Hardware Stores 13716 2,000,000 (001) $1,000 $2,000']));h.fillGL(first);
  let row=h.p6.read('SUB-A').tables.gl_exposure[0];h.p6.set('SUB-A',row.fields.rateP.key,'3');const saved=clone(h.edits.map.__phase6);
  const later=glSource(glSchedule(['Hardware Stores 13716 3,000,000 (001) $1,100 $2,500']));h.fillGL(later);row=h.p6.read('SUB-A').tables.gl_exposure[0];assert.equal(row.fields.rateP.value,'3');assert.equal(row.fields.exposures.value,'3,000,000');assert.equal(h.$('totalPremium').textContent,'$11,500');
  const reopened=harness(true);reopened.fillGL(later);reopened.p6.restore(saved);assert.equal(reopened.$('totalPremium').textContent,'$11,500');
  row=reopened.p6.read('SUB-A').tables.gl_exposure[0];reopened.p6.set('SUB-A',row.fields.rateP.key,'');const cleared=clone(reopened.edits.map.__phase6);reopened.fillGL(first);assert.equal(reopened.$('totalPremium').textContent,'Not rated');
  const again=harness(true);again.fillGL(later);again.p6.restore(cleared);assert.equal(again.p6.read('SUB-A').tables.gl_exposure[0].fields.rateP.value,'');assert.equal(again.$('totalPremium').textContent,'Not rated');
});

test('manual whole-table GL ownership retains values but refreshes current extraction review evidence',()=>{
  const h=harness(true),sub=glSource(glSchedule(['Hardware Stores 13716 2,000,000 (001) $1,000 $2,000']));h.fillGL(sub);h.p6.action('SUB-A','gl_exposure:add',{});
  assert.equal(h.p6.owns('gl_exposure'),true);const before=h.p6.read('SUB-A').tables.gl_exposure[0].fields.exposures.value;
  sub.snapshot.extractions={gl_quote:{applicantGate:'mismatch'}};h.fillGL(sub);let row=h.p6.read('SUB-A').tables.gl_exposure[0];assert.equal(row.fields.exposures.value,before);assert.match(row.sourceReview,/applicant mismatch/);
  sub.snapshot.extractions={gl_quote:{text:JSON.stringify({review_required:true})}};h.fillGL(sub);row=h.p6.read('SUB-A').tables.gl_exposure[0];assert.match(row.sourceReview,/requires review/);assert.doesNotMatch(row.sourceReview,/mismatch/);
  sub.snapshot.extractions={};h.fillGL(sub);assert.equal(h.p6.read('SUB-A').tables.gl_exposure[0].sourceReview,'');
});

test('partial structured GL fills only absent premiums from an exact eligible raw match without adding classes',()=>{
  const h=harness(true),sub=glSource(glSchedule(['Hardware Stores 13716 2,345,000 (001) $12 $34','Feed Dealers 12583 75,000 (001) $56 $78'],true));
  const structured={code:'13716',premium_basis:2345000,rate_basis:'001',prem_ops_premium:0};sub.snapshot.extractions={gl_quote:{text:JSON.stringify({class_codes:[structured]})}};
  let rows=h.context.parseGLClassRows89(sub);assert.equal(rows.length,1);assert.equal(rows[0].quotePremP,0);assert.equal(rows[0].quotePremG,34);assert.equal(rows[0].premiumSourceG.page,4);assert.equal(rows[0].premiumSourceP,undefined);
  h.fillGL(sub);assert.equal(h.$('totalPremium').textContent,'$34');
  for(const change of [{code:'13716oops'},{code:'13716 / 12583'},{premium_basis:2345001},{premium_basis:2345000.25},{premium_basis:'2345000oops'},{rate_basis:'payroll'},{rate_basis:''},{rate_basis:'unknown'},{rate_basis:'N/A'},{rate_basis:'bogus'},{prod_comp_premium:'unknown'},{prod_comp_rate:'invalid'}]){
    const other=clone(sub);other.snapshot.extractions.gl_quote.text=JSON.stringify({class_codes:[{...structured,...change}]});rows=h.context.parseGLClassRows89(other);assert.equal(rows.length,1);assert.equal(rows[0].quotePremG,'');assert.equal(rows[0].premiumSourceG,undefined);
  }
  const explicit=clone(sub);explicit.snapshot.extractions.gl_quote.text=JSON.stringify({class_codes:[{...structured,prod_comp_rate:0.5}]});rows=h.context.parseGLClassRows89(explicit);assert.equal(rows[0].rateG,'0.5');assert.equal(rows[0].quotePremG,'');
  const conflicts=clone(sub);conflicts.snapshot.files.push({...clone(sub.snapshot.files[0]),id:'OTHER',extractMeta:{pageTexts:[glSchedule(['Hardware Stores 13716 2,345,000 (001) $12 $99'])]}});rows=h.context.parseGLClassRows89(conflicts);assert.equal(rows[0].quotePremP,0);assert.equal(rows[0].quotePremG,'');assert.match(rows[0].reviewReason,/Conflicting/);
});

test('underlying lead summary resolves its occurrence limit before package primary GL without inventing our target',()=>{
  const h=harness(true),primary='DECLARATIONS: COMMERCIAL GENERAL LIABILITY\nEach Occurrence Limit $1,000,000',umbrella='DECLARATIONS: COMMERCIAL LIABILITY UMBRELLA COVERAGE INFORMATION\nEach Occurrence Limit (Liability Coverage) $3,000,000\nSCHEDULE OF UNDERLYING INSURANCE\nGeneral Liability Each Occurrence Limit $1,000,000';
  const sub={id:'SUB-A',snapshot:{extractions:{excess:{text:'Underlying Excess Program Tower\nLayer 1 - Lead Umbrella - Example Carrier\nLimits: Each Occurrence $3,000,000 / Aggregate $3,000,000\nSchedule of Underlying: GL $1,000,000 / Auto $1,000,000\nPremium: $12,345'}},files:[{name:'Package.pdf',submissionId:'SUB-A',routedToAll:['gl_quote','excess'],extractMeta:{pageTexts:[primary,umbrella]}}]}};
  assert.equal(h.window.WorkbenchRules.resolveField('underlying_lead_limit',sub).value,'3,000,000');assert.equal(h.window.WorkbenchRules.resolveField('requested_limit',sub),null);
  const structured=clone(sub);structured.snapshot.extractions.excess.text+='\n```json\n'+JSON.stringify({underlying_lead_limit:4000000})+'\n```';assert.equal(h.window.WorkbenchRules.resolveField('underlying_lead_limit',structured).value,4000000);
  const raw=clone(sub);raw.snapshot.extractions.excess.text='No module limit supplied.';assert.equal(h.window.WorkbenchRules.resolveField('underlying_lead_limit',raw).value,'3,000,000');
  for(const pages of [[primary],[primary,'SCHEDULE OF UNDERLYING INSURANCE\nEach Occurrence Limit $1,000,000']]){const onlyPrimary=clone(raw);onlyPrimary.snapshot.files[0].extractMeta.pageTexts=pages;assert.equal(h.window.WorkbenchRules.resolveField('underlying_lead_limit',onlyPrimary),null);}
  const foreign=clone(raw);foreign.snapshot.files[0].submissionId='SUB-B';assert.equal(h.window.WorkbenchRules.resolveField('underlying_lead_limit',foreign),null);
  const conflicting=clone(raw);conflicting.snapshot.files[0].extractMeta.pageTexts.push(umbrella.replace('$3,000,000','$5,000,000'));assert.equal(h.window.WorkbenchRules.resolveField('underlying_lead_limit',conflicting),null);
});

test('underlying lead fallback excludes rejected and hypothetical/nonlead sources without borrowing later layer amounts',()=>{
  const h=harness(true),make=text=>({id:'SUB-A',snapshot:{extractions:{excess:{text}},files:[]}});
  for(const text of ['Layer 2 - Second Excess - Example Carrier\nLimits: Each Occurrence $5,000,000','Layer 2 - Second Excess\nEXCESS LIABILITY COVERAGE\nEach Occurrence Limit $5,000,000','Layer 2 - Second Excess\n$5M xs $3M','Ask vs Offer\nA typical Lead $5M could be added.','Layer 1 - Lead Umbrella\nLimits not stated\nLayer 2 - Second Excess\nLimits: Each Occurrence $5,000,000'])assert.equal(h.window.WorkbenchRules.resolveField('underlying_lead_limit',make(text)),null);
  const text='Layer 1 - Lead Umbrella - Example Carrier\nLimits: Each Occurrence $3,000,000';
  assert.equal(h.window.WorkbenchRules.resolveField('underlying_lead_limit',make(text+'\nLayer 2 - Second Excess\nLimits: $5M xs $3M')).value,'3,000,000');
  for(const flags of [{rejected:true},{refused:true},{excluded:true},{gateDetails:{proceed:false}}]){const sub=make(text);Object.assign(sub.snapshot.extractions.excess,flags);assert.equal(h.window.WorkbenchRules.resolveField('underlying_lead_limit',sub),null);}
  const mismatch=make(text);mismatch.snapshot.extractions.excess.applicantGate='mismatch';h.window.STM_APPLICANT_GATE_MODE='strict';assert.equal(h.window.WorkbenchRules.resolveField('underlying_lead_limit',mismatch),null);h.window.STM_APPLICANT_GATE_MODE='off';assert.equal(h.window.WorkbenchRules.resolveField('underlying_lead_limit',mismatch).value,'3,000,000');
  const refused=make('No matching underlying excess policies found for this insured.\n'+text);assert.equal(h.window.WorkbenchRules.resolveField('underlying_lead_limit',refused),null);
});

test('loaded submission identity uses July convention, with distinct known IDs',()=>{
  const window={};vm.runInNewContext(app,{window,console:{log(){}},document:{addEventListener(){}}});
  assert.equal(window.stmWorkbenchDealNumber('STM'),'966735');
  assert.notEqual(window.stmWorkbenchDealNumber('SUB-EXAMPLE-A'),window.stmWorkbenchDealNumber('SUB-EXAMPLE-B'));
  assert.match(section('        async load(data){','        async save(){'),/dealNum.*stmWorkbenchDealNumber\(data.id\)/);
});

test('actual loss parser + source writer retain one edited cell and refresh untouched cells on reload',()=>{
  const h=harness();h.fillLoss(losses());
  const row=h.p5.read('SUB-A').loss.gl.years[0];
  assert.equal(row.fields[3].value,'100');
  h.p5.set('SUB-A',row.fields[3].key,'777');
  assert.equal(h.p5.ownsLoss('glLossRows'),false);
  const saved=clone(h.edits.map.__phase5);assert.equal(saved.data.lossCells.length,1);assert.deepEqual(saved.data.loss,{});
  h.fillLoss(losses(500,8));
  assert.equal(h.p5.read('SUB-A').loss.gl.years[0].fields[3].value,'777');
  assert.equal(h.p5.read('SUB-A').loss.gl.years[0].fields[2].value,'8');
  assert.equal(h.p5.read('SUB-A').loss.gl.years[0].fields[5].value,'520');
  const reopened=harness();reopened.fillLoss(losses(600,9));reopened.p5.restore(saved);
  assert.equal(reopened.p5.read('SUB-A').loss.gl.years[0].fields[3].value,'777');
  assert.equal(reopened.p5.read('SUB-A').loss.gl.years[0].fields[2].value,'9');
});

test('restored scoped file page evidence fills losses without module output or global caches',()=>{
  const h=harness(),sub={id:'SUB-A',snapshot:{files:[{name:'Loss Run.pdf',classification:'LOSS',extractMeta:{pageTexts:[{page:1,text:'12345 400000 0 400000 6/1/2024 Excavation claim Closed General Liability'}]}}]}};
  const parsed=h.context.parseLossTables85(sub);assert.equal(parsed.gl.length,1);assert.equal(parsed.gl[0].paid,'400,000');assert.equal(parsed.largeGl[0].incurred,'400,000');
  h.fillLoss(sub);assert.equal(h.p5.read('SUB-A').loss.gl.large[0].fields[2].value,'400,000');
  const other=h.context.parseLossTables85({id:'SUB-B',snapshot:{files:[]}});assert.equal(other.gl.length,0);assert.equal(other.largeGl.length,0);
});

test('loss explicit clears, large-loss cell edits and source period identity survive hydration',()=>{
  const h=harness();h.fillLoss(losses());let data=h.p5.read('SUB-A').loss.gl;
  h.p5.set('SUB-A',data.years[0].fields[3].key,'');
  h.p5.set('SUB-A',data.years[0].fields[0].key,'2023');
  h.p5.set('SUB-A',data.large[0].fields[2].key,'66');
  h.fillLoss(losses(450,7));data=h.p5.read('SUB-A').loss.gl;
  assert.equal(data.years[0].fields[3].value,'');assert.equal(data.years[0].fields[0].value,'2023');assert.equal(data.years[1].fields[0].value,'2022');assert.equal(data.years[1].fields[3].value,'200');assert.equal(data.years[0].fields[2].value,'7');
  assert.equal(data.large[0].fields[2].value,'66');assert.equal(data.large[0].fields[1].value,'120');
  const saved=clone(h.edits.map.__phase5),r=harness();r.fillLoss(losses(999,6));r.p5.restore(saved);
  assert.equal(r.p5.read('SUB-A').loss.gl.years[0].fields[3].value,'');
  assert.equal(r.p5.read('SUB-A').loss.gl.large[0].fields[2].value,'66');
});

test('loss row add/remove and legacy snapshots retain explicit whole-line ownership',()=>{
  const h=harness();h.fillLoss(losses());h.p5.action('SUB-A','loss:addYear',{line:'gl'});h.p5.action('SUB-A','loss:removeLarge',{line:'gl'});
  const saved=clone(h.edits.map.__phase5);delete saved.data.lossCells;
  assert.equal(saved.data.loss.gl.years.length,3);assert.equal(saved.data.loss.gl.large.length,0);
  const r=harness();r.fillLoss(losses(400,9));r.p5.restore(saved);r.fillLoss(losses(900,10));
  const data=r.p5.read('SUB-A').loss.gl;assert.equal(r.p5.ownsLoss('glLossRows'),true);assert.equal(data.years.length,3);assert.equal(data.large.length,0);assert.equal(data.years[0].fields[3].value,'100');
});

test('GL one-cell edit preserves class source rates/exposures and uses native calculator after reload',()=>{
  const h=harness();h.fillGL(glClasses(1000));
  let row=h.p6.read('SUB-A').tables.gl_exposure[0];h.p6.set('SUB-A',row.fields.rateP.key,'4');
  assert.equal(h.p6.owns('gl_exposure'),false);assert.equal(h.$('totalPremium').textContent,'$110');
  h.fillGL(glClasses(2000));row=h.p6.read('SUB-A').tables.gl_exposure[0];assert.equal(row.fields.rateP.value,'4');assert.equal(row.fields.exposures.value,'2000');assert.equal(row.fields.rateG.value,'1');assert.equal(h.$('totalPremium').textContent,'$114');
  const saved=clone(h.edits.map.__phase6);assert.equal(saved.data.cells.gl_exposure.length,1);assert.deepEqual(saved.data.tables,{});
  const r=harness();r.fillGL(glClasses(3000));r.p6.restore(saved);assert.equal(r.p6.read('SUB-A').tables.gl_exposure[0].fields.rateP.value,'4');assert.equal(r.$('totalPremium').textContent,'$118');
});

test('rating overlays follow class identity through reordering and preserve explicit blanks',()=>{
  const h=harness();h.fillGL(glClasses(1000));const first=h.p6.read('SUB-A').tables.gl_exposure[0];h.p6.set('SUB-A',first.fields.rateP.key,'');
  const updated=glClasses(6000);updated.classes.reverse();h.fillGL(updated);
  const rows=h.p6.read('SUB-A').tables.gl_exposure;assert.equal(rows[1].fields.code.value,'11111');assert.equal(rows[1].fields.rateP.value,'');assert.equal(rows[0].fields.rateP.value,'3');
  const r=harness();r.fillGL(updated);r.p6.restore(clone(h.edits.map.__phase6));assert.equal(r.p6.read('SUB-A').tables.gl_exposure[1].fields.rateP.value,'');
});

test('edited GL code replays native lookup and respects separately edited description and basis',()=>{
  const h=harness();h.fillGL(glClasses(1000));
  const row=h.$('classTerritoryTable').querySelector('tbody tr');
  const wire=()=>{
    h.window.WorkbenchRules.lookupGlClassCode=()=>({description:'Lookup description',ratingBasis:'Payroll'});
    const ctx=vm.createContext({...h.context,window:h.window,document:h.document,tr:row,codeInp:row.querySelector('[data-f="code"]'),descInp:row.querySelector('[data-f="desc"]'),baseSel:row.querySelector('[data-f="base"]'),ISO_CLASS_DESC:{},basisToSelectValue:()=> 'payroll',stmFieldLocked:el=>el.dataset.stmExplicitEdit==='1'});
    vm.runInContext(section('                const applyClassCodeReference = () => {', "                descInp.addEventListener('input'"),ctx);
  };
  wire();let data=h.p6.read('SUB-A').tables.gl_exposure[0];
  h.p6.set('SUB-A',data.fields.code.key,'33333');assert.equal(row.querySelector('[data-f="desc"]').value,'Lookup description');assert.equal(row.querySelector('[data-f="base"]').value,'payroll');
  h.p6.set('SUB-A',data.fields.desc.key,'Reviewed description');h.p6.set('SUB-A',data.fields.base.key,'1000');
  h.fillGL(glClasses(5000));data=h.p6.read('SUB-A').tables.gl_exposure[0];assert.equal(data.fields.code.value,'33333');assert.equal(data.fields.desc.value,'Reviewed description');assert.equal(data.fields.base.value,'1000');assert.equal(data.fields.exposures.value,'5000');
});

test('Phase6 fixed fleet and reconstructed primary rows merge only the saved cells',()=>{
  const h=harness();h.p6.rememberSource();let t=h.p6.read('SUB-A').tables;
  h.p6.set('SUB-A',t.al_fleet[0].fields.units.key,'7');h.p6.set('SUB-A',t.primary[0].fields.manualPrem.key,'1234');
  const saved=clone(h.edits.map.__phase6),r=harness();r.$('autoExposuresTbl').querySelector('[data-f="selRate"]').value='450';r.$('primaryPoliciesTbl').querySelector('[data-pp="ulPrem"]').value='20000';r.p6.rememberSource();r.p6.restore(saved);
  t=r.p6.read('SUB-A').tables;assert.equal(t.al_fleet[0].fields.units.value,'7');assert.equal(t.al_fleet[0].fields.selRate.value,'450');assert.equal(t.primary[0].fields.manualPrem.value,'1234');assert.equal(t.primary[0].fields.ulPrem.value,'20000');assert.equal(r.p6.owns('primary'),false);
});

test('fleet source reset restores latest extraction instead of capturing the manual overlay as source',()=>{
  const h=harness();const units=h.$('autoExposuresTbl').querySelector('[data-f="units"]');units.value='3';h.p6.reapplyCells('al_fleet',true);h.p6.rememberSource();
  h.p6.set('SUB-A',h.p6.read('SUB-A').tables.al_fleet[0].fields.units.key,'7');
  units.value='4';h.p6.reapplyCells('al_fleet',true);h.p6.rememberSource();assert.equal(units.value,'7');
  h.p6.action('SUB-A','al:reset');assert.equal(units.value,'4');
});

test('rating row actions and legacy saved tables retain broad ownership',()=>{
  const h=harness();h.fillGL(glClasses(1000));h.p6.action('SUB-A','gl_exposure:add');
  const key=h.p6.read('SUB-A').tables.gl_exposure[1].key;h.p6.action('SUB-A','gl_exposure:remove',{key});
  const saved=clone(h.edits.map.__phase6);delete saved.data.cells;
  const r=harness();r.fillGL(glClasses(5000));r.p6.restore(saved);r.fillGL(glClasses(9000));
  assert.equal(r.p6.owns('gl_exposure'),true);assert.equal(r.p6.read('SUB-A').tables.gl_exposure.length,2);assert.equal(r.p6.read('SUB-A').tables.gl_exposure[0].fields.exposures.value,'1000');
});

test('invalid granular saves and actions for another submission are rejected',()=>{
  const h=harness();assert.throws(()=>h.p5.set('SUB-B','layerType','Lead'),/no longer active/);
  assert.throws(()=>h.p6.set('SUB-B','s|hazardGradeSelect','A'),/no longer active/);
  assert.throws(()=>h.p5.validate({data:{v:1,loss:{},lossCells:[{line:'gl',kind:'years',source:'x',cell:9,value:{v:'bad'}}]}}),/validated/);
  assert.throws(()=>h.p6.validate({data:{v:1,tables:{},cells:{gl_exposure:[{source:'x',field:'derived',value:{v:'bad'}}]}}}),/invalid/);
});

test('guideline resolver shows reviewed JSON text, full prose, and structured conflicts instead of status markers',()=>{
  const window={location:{search:''}},context=vm.createContext({window,console:{info(){},log(){}},URLSearchParams});vm.runInContext(read('workbench-rules.js'),context);
  const resolve=text=>window.WorkbenchRules.resolveField('guideline_conflicts_text',{id:'G-'+Math.random(),snapshot:{extractions:{guidelines:{text}}}})?.value;
  const status='A8 deterministic engine QC output. Review required before binding.';
  assert.equal(resolve(JSON.stringify({guideline_conflicts_text:'Underwriter reviewed conflicts: retain this exact conclusion.'})),'Underwriter reviewed conflicts: retain this exact conclusion.');
  const prose='Operational review\n\n'+('Evidence for the relevant jurisdiction. '.repeat(650));
  const shown=resolve(prose+'\n\n``json\n'+JSON.stringify({guideline_conflicts_text:status,review_required:true})+'\n``');assert.ok(shown.length>20000);assert.match(shown,/Evidence for the relevant jurisdiction/);assert.doesNotMatch(shown,/deterministic engine|guideline_conflicts_text/);
  const structured=resolve(JSON.stringify({guideline_conflicts_text:status,guideline_conflicts:[{operational_detail:'Underground utilities',severity:'Referral',guideline_conflict:'Review excavation work',explanation:'Document states work at depth.'}],review_required:true}));assert.match(structured,/Underground utilities/);assert.match(structured,/Document states work at depth/);assert.doesNotMatch(structured,/deterministic engine/);
  assert.match(resolve(JSON.stringify({data:{guideline_conflicts_text:status,guideline_conflicts:[],clean_items:['Reviewed operation has supporting evidence.'],review_required:false}})),/Reviewed operation has supporting evidence/);
});

test('production field writer preserves manually reviewed guideline text and an explicit clear',()=>{
  const h=harness();h.document.body.insertAdjacentHTML('beforeend','<textarea id="guidelineConflicts"></textarea>');
  vm.runInContext(section('    function stmFieldLocked(el) {','    const STM_EDITS ='),h.context);
  vm.runInContext(section('        function applyResolvedToElement(',"        setupTextareaAutoScroll('#descOps');"),h.context);
  const el=h.$('guidelineConflicts');el.dataset.stmExplicitEdit='1';el.value='Reviewed by underwriter';
  assert.equal(h.context.applyResolvedToElement(el,'value','Fresh engine analysis'),false);assert.equal(el.value,'Reviewed by underwriter');
  el.value='';assert.equal(h.context.applyResolvedToElement(el,'value','Fresh engine analysis'),false);assert.equal(el.value,'');
  delete el.dataset.stmExplicitEdit;assert.equal(h.context.applyResolvedToElement(el,'value','Fresh engine analysis'),true);assert.equal(el.value,'Fresh engine analysis');
});

test('TRIA requires explicit election on the matching underlying policy, without a default acceptance',()=>{
  const window={location:{search:''}},context=vm.createContext({window,console:{info(){},log(){}},URLSearchParams});vm.runInContext(read('workbench-rules.js'),context);
  const r=window.WorkbenchRules,layer={carrier:'Example Umbrella Company',limit:'2,000,000'};
  const source=terms=>({snapshot:{extractions:{excess:{text:'Layer 1 - Lead Umbrella:\nCarrier: Example Umbrella Company (NAIC 12345)\nLimits: Each Occurrence $2,000,000 / Aggregate $2,000,000\nTerms: '+terms}}}});
  const resolve=terms=>r.resolveUnderlyingTriaElection(source(terms),layer)?.value;
  assert.equal(resolve('Terrorism (TRIA) offered at $0.00 premium, not elected on routed pages.'),'Declined');
  assert.equal(resolve('TRIA: Accepted.'),'Accepted');
  for(const text of ['Terrorism offered at $0 premium.','TRIA 1%.','If TRIA is accepted, an additional premium applies.','TRIA election not stated.','TRIA not declined.'])assert.equal(resolve(text),undefined,text);
  assert.equal(r.resolveUnderlyingTriaElection(source('TRIA: Accepted.'),{carrier:'Other Carrier',limit:2000000}),null);
  assert.equal(r.resolveUnderlyingTriaElection(source('TRIA: Accepted.'),{carrier:layer.carrier,limit:5000000}),null);
  const multiple=source('TRIA: Accepted.');multiple.snapshot.extractions.excess.text+='\nLayer 2 - Excess:\nCarrier: Example Umbrella Company\nLimits: $5,000,000\nTRIA: Declined.';
  assert.equal(r.resolveUnderlyingTriaElection(multiple,layer)?.value,'Accepted');
  assert.equal(r.resolveUnderlyingTriaElection(multiple,{carrier:layer.carrier}),null);
  const json={snapshot:{extractions:{excess:{text:JSON.stringify({tower_documents:[{carrier:layer.carrier,decLimit:2000000,tria_status:'Declined'}]})}}}};
  assert.equal(r.resolveUnderlyingTriaElection(json,layer)?.value,'Declined');
  assert.equal(r.GUIDELINE_CAPS.tria_default_status,'');
  const html=parseHTML(read('engine-workbench.html')).document;
  assert.equal(html.querySelectorAll('.policy-tria-status').length,4);for(const el of html.querySelectorAll('.policy-tria-status'))assert.equal(el.options[0].getAttribute('value'),'');
});

test('underlying TRIA writer protects the proposed layer, manual elections, clears and legacy coverage ownership',()=>{
  const h=harness();vm.runInContext(read('workbench-rules.js'),h.context);
  const source={snapshot:{extractions:{excess:{text:'Layer 1 - Lead Umbrella:\nCarrier: Example Umbrella Company\nLimits: $2,000,000\nTerrorism (TRIA) not elected.'}}}};
  const add=(id,type)=>{const e=h.document.createElement('div');e.className='limit-entry';e.dataset.coverageType=type;e.innerHTML=`<div id="${id}" class="limit-details-panel"><input value="Example Umbrella Company"><input class="limit-value" value="2000000"><select class="policy-tria-status"><option value="">Not stated</option><option value="Accepted">Accepted</option><option value="Declined">Declined</option></select></div>`;h.$('risk-limits').appendChild(e);return e.querySelector('select');};
  const proposed=add('details-lead-specific','lead-specific'),underlying=add('details-lead-excess','lead-excess');
  vm.runInContext(section('    function stmFieldLocked(el) {','    const STM_EDITS ='),h.context);
  vm.runInContext(section('        function applyUnderlyingTriaElections(', '        function applyV8685PopulationPass('),h.context);
  h.context.applyUnderlyingTriaElections(source);assert.equal(underlying.value,'Declined');assert.equal(proposed.value,'');
  h.p5.set('SUB-A','cov|details-lead-excess|2','Accepted');h.context.applyUnderlyingTriaElections(source);assert.equal(underlying.value,'Accepted');
  h.p5.set('SUB-A','cov|details-lead-excess|2','');h.context.applyUnderlyingTriaElections(source);assert.equal(underlying.value,'');
  delete underlying.dataset.stmExplicitEdit;h.window.__STM_WB_PHASE5.ownsCoverage=()=>true;underlying.value='Accepted';h.context.applyUnderlyingTriaElections(source);assert.equal(underlying.value,'Accepted');
  h.window.__STM_WB_PHASE5.ownsCoverage=()=>false;h.context.applyUnderlyingTriaElections({snapshot:{extractions:{}}});assert.equal(underlying.value,'');
});

test('TRIA rejects explicitly foreign insured layers and excluded extraction records',()=>{
  const window={location:{search:''}},context=vm.createContext({window,console:{info(){},log(){}},URLSearchParams});vm.runInContext(read('workbench-rules.js'),context);
  const r=window.WorkbenchRules,layer={carrier:'Example Carrier',limit:2000000};
  const source=(name='Other Insured LLC')=>({account_name:'Selected Insured LLC',snapshot:{extractions:{excess:{text:'Layer 1 - Lead Umbrella:\nCarrier: Example Carrier\nNamed Insured: '+name+'\nLimits: $2,000,000\nTRIA declined.'}}}});
  assert.equal(r.resolveUnderlyingTriaElection(source(),layer),null);
  assert.equal(r.resolveUnderlyingTriaElection(source('Selected Insured LLC'),layer)?.value,'Declined');
  assert.equal(r.resolveUnderlyingTriaElection(source('Not stated on routed pages'),layer)?.value,'Declined');
  for(const flag of ['excluded','rejected','refused']){const s=source('Selected Insured LLC');s.snapshot.extractions.excess[flag]=true;assert.equal(r.resolveUnderlyingTriaElection(s,layer),null);}
  const s=source();s.snapshot.extractions.excess.text=JSON.stringify({tower_documents:[{named_insured:'Other Insured LLC',carrier:layer.carrier,decLimit:2000000,tria_status:'Declined'}]});assert.equal(r.resolveUnderlyingTriaElection(s,layer),null);
  s.snapshot.extractions.excess.text=JSON.stringify({named_insured:'Other Insured LLC',tower_documents:[{carrier:layer.carrier,decLimit:2000000,tria_status:'Declined'}]});assert.equal(r.resolveUnderlyingTriaElection(s,layer),null);
  s.snapshot.extractions.excess.text+='\nLayer 1 - Lead Umbrella:\nCarrier: Example Carrier\nNamed Insured: Other Insured LLC\nLimits: $2,000,000\nTRIA declined.';assert.equal(r.resolveUnderlyingTriaElection(s,layer),null);
});

const fleetLabels=['Private Passenger','Light','Medium','Heavy (Local)','Heavy (Other than Local)','Extra Heavy (Local)','Extra Heavy (Intermediate)','Extra Heavy (Long Haul)','Truck Tractors (Local)','Truck Tractor (Intermediate)','Truck Tractors (Long Haul)'];
function fleetRoster(values,corrected=false){return 'Fleet Composition'+(corrected?' (corrected counts)':'')+':\n\n'+fleetLabels.map((label,i)=>label+': '+values[i]).join('\n')+'\nTotal power units: '+values.reduce((a,b)=>a+b,0)+'\n\n';}
function fleetSource(text){return {id:'SUB-A',account_name:'Example Insured LLC',snapshot:{extractions:{al_quote:{text}}}};}
test('fleet narrative uses only a unique complete explicit correction, including zero counts',()=>{
  const window={location:{search:''}},context=vm.createContext({window,console:{info(){},log(){}},URLSearchParams});vm.runInContext(read('workbench-rules.js'),context);
  const r=window.WorkbenchRules,initial=[0,1,2,3,0,0,0,0,4,0,0],updated=[0,2,3,4,0,0,0,0,5,0,0];
  const resolve=(text,field='fleet_medium')=>r.resolveField(field,fleetSource(text));
  assert.equal(resolve(fleetRoster(initial)+fleetRoster(updated,true))?.value,'3');
  assert.equal(resolve(fleetRoster(initial)+fleetRoster(updated,true),'fleet_truck_tractors_local')?.value,'5');
  assert.equal(resolve(fleetRoster(initial)+fleetRoster(Array(11).fill(0),true))?.value,'0');
  assert.equal(resolve(fleetRoster(initial)+fleetRoster(updated)),null,'conflicting unlabeled rosters require review');
  assert.equal(resolve(fleetRoster(initial)+fleetRoster(updated,true)+fleetRoster(initial,true)),null,'multiple differing corrections do not choose by order');
  assert.equal(resolve(fleetRoster(initial)+'Fleet Composition (corrected counts):\nLight: 8\nMedium: 9\n'),null,'incomplete correction does not silently become authoritative');
  assert.equal(resolve(fleetRoster(initial)+fleetRoster(updated,true).replace('Total power units: 14','Total power units: 999')),null,'correction total must reconcile');
  assert.equal(resolve(fleetRoster(initial))?.value,'2','single ordinary roster retains existing behavior');
  const structured=fleetSource(fleetRoster(initial)+fleetRoster(updated,true)+'\n```json\n'+JSON.stringify({fleet_medium:8})+'\n```');
  assert.equal(r.resolveField('fleet_medium',structured)?.value,8,'existing structured source authority is retained');
});

test('actual fleet source writer refreshes corrected counts while preserving one manual count and reload',()=>{
  const initial=[0,1,2,3,0,0,0,0,4,0,0],updated=[0,2,3,4,0,0,0,0,5,0,0],latest=[0,4,5,6,0,0,0,0,7,0,0];
  const setup=()=>{const h=harness();vm.runInContext(read('workbench-rules.js'),h.context);Array.from(h.$('autoExposuresTbl').querySelectorAll('tbody tr')).slice(0,11).forEach((row,i)=>row.cells[0].textContent=fleetLabels[i]);h.context.r85=(field,submission)=>h.window.WorkbenchRules.resolveField(field,submission)?.value;vm.runInContext(section('        function applyALFleetFromActiveSubmission(', '        function applyInternalRaterFromActiveSubmission('),h.context);return h;};
  const h=setup();h.context.applyALFleetFromActiveSubmission(fleetSource(fleetRoster(initial)+fleetRoster(updated,true)));h.p6.rememberSource();
  let table=h.p6.read('SUB-A').tables.al_fleet;assert.equal(table[2].fields.units.value,'3');
  h.p6.set('SUB-A',table[1].fields.units.key,'99');const saved=clone(h.edits.map.__phase6);
  h.context.applyALFleetFromActiveSubmission(fleetSource(fleetRoster(initial)+fleetRoster(latest,true)));table=h.p6.read('SUB-A').tables.al_fleet;
  assert.equal(table[1].fields.units.value,'99');assert.equal(table[2].fields.units.value,'5');
  const reload=setup();reload.context.applyALFleetFromActiveSubmission(fleetSource(fleetRoster(initial)+fleetRoster(latest,true)));reload.p6.rememberSource();reload.p6.restore(saved);table=reload.p6.read('SUB-A').tables.al_fleet;
  assert.equal(table[1].fields.units.value,'99');assert.equal(table[2].fields.units.value,'5');assert.equal(reload.p6.owns('al_fleet'),false);
});

test('Strengths display removes only the bounded verifier draft and preserves raw source/manual edits',()=>{
  const h=harness();vm.runInContext(read('workbench-rules.js'),h.context);const r=h.window.WorkbenchRules;
  const prefix='Now let me verify the numbers.\n\nDraft calculations remain in source.\n\n';
  for(const heading of ['Strengths of the Account:','**Strengths of the Account:**','**Strengths of the Account**:','## Strengths of the Account']){
    const final=heading+'\n\nFinal supported strength.\nSecond final paragraph.',raw=prefix+final,source={snapshot:{extractions:{strengths:{text:raw}}}};
    const value=r.resolveField('account_strengths',source).value;
    assert.ok(value.startsWith('Strengths of the Account'));assert.match(value,/Final supported strength/);assert.match(value,/Second final paragraph/);assert.doesNotMatch(value,/verify the numbers|Draft calculations/);assert.equal(source.snapshot.extractions.strengths.text,raw);
    const json={snapshot:{extractions:{strengths:{text:JSON.stringify({account_strengths:raw})}}}};
    assert.doesNotMatch(r.resolveField('account_strengths',json).value,/verify the numbers|Draft calculations/);
  }
  const resolve=text=>r.resolveField('account_strengths',{snapshot:{extractions:{strengths:{text}}}}).value;
  assert.match(resolve(prefix),/Now let me verify the numbers/,'no final boundary preserves original');
  assert.match(resolve('Source-specific introduction.\n\nStrengths of the Account:\nFinal fact.'),/^Source-specific introduction/);
  h.document.body.insertAdjacentHTML('beforeend','<textarea id="acctStrengths"></textarea>');vm.runInContext(section('    function stmFieldLocked(el) {','    const STM_EDITS ='),h.context);vm.runInContext(section('        function applyResolvedToElement(',"        setupTextareaAutoScroll('#descOps');"),h.context);
  const el=h.$('acctStrengths');el.dataset.stmExplicitEdit='1';el.value=prefix+'Manual review.';h.context.applyResolvedToElement(el,'value',resolve(prefix+'Strengths of the Account:\nSource strength.'));assert.equal(el.value,prefix+'Manual review.');el.value='';h.context.applyResolvedToElement(el,'value','Source strength.');assert.equal(el.value,'');
});

test('Workbench preserves explicit source review metadata without creating conflicts from prose',()=>{
  const window={location:{search:''}},context=vm.createContext({window,console:{info(){},log(){},warn(){}},URLSearchParams});vm.runInContext(read('workbench-rules.js'),context);const r=window.WorkbenchRules;
  const conflicts=[{sourceModule:'supplemental',submissionInsured:'Selected Insured LLC',detectedInsureds:['Other Insured LLC'],matchedInsureds:[],sourceInfo:'Other source.pdf'}];
  const text='Strengths of the Account:\nHistorical mixed prose remains exactly as recorded.';
  const source={id:'SOURCE-REVIEW',account_name:'Selected Insured LLC',snapshot:{extractions:{strengths:{text,review_required:true,source_identity_conflicts:conflicts}}}};
  const before=JSON.stringify(source),value=r.resolveField('account_strengths',source);
  assert.equal(value.review_required,true);assert.equal(value.source_identity_conflicts[0].sourceModule,'supplemental');assert.match(value.value,/Historical mixed prose remains exactly/);
  value.source_identity_conflicts[0].detectedInsureds.push('Changed response only');assert.equal(JSON.stringify(source),before);
  const report=r.buildFieldCoverageReport(source),row=report.rows.find(x=>x.field==='account_strengths');assert.equal(row.status,'review');assert.equal(row.review_required,true);assert.equal(row.source_identity_conflicts[0].detectedInsureds.length,1);assert.ok(report.summary.review>=1);assert.equal(report.modules.find(x=>x.module==='strengths').review_required,true);
  const unrecorded={id:'NO-RECORDED-REVIEW',account_name:'Selected Insured LLC',snapshot:{extractions:{strengths:{text:'Named Insured: Other Insured LLC\nHistorical mixed prose.'}}}};
  const plain=r.resolveField('account_strengths',unrecorded);assert.equal(plain.review_required,undefined);assert.equal(plain.source_identity_conflicts,undefined,'no new metadata is inferred from names');
  const structured={snapshot:{extractions:{strengths:{text:JSON.stringify({account_strengths:'Final fact.',review_required:true,source_identity_conflicts:conflicts})}}}};
  assert.equal(r.resolveField('account_strengths',structured).review_required,true);assert.equal(JSON.stringify(source),before);
});
