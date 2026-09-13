const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','workbench-rules.js'),'utf8');
function rules(){const window={};vm.runInNewContext(source,{window,console:{log(){},warn(){},info(){}},URLSearchParams});return window.WorkbenchRules;}
const text='EXAMPLE CARRIER\nNamed Insured: SYNTHETIC SUPPLY CO INC\nMailing Address: 100 EXAMPLE RD\nBroker: EXAMPLE & SAMPLE AGENCY, LLC\n120 SAMPLE ST STE 100\nAUSTIN, TX 78701-0000\n512-555-0100\nBroker Number: 0000123\nTransaction: QUOTE';
function submission(pages=[text]){return {id:'A',account_name:'Synthetic Supply Co Inc',snapshot:{extractions:{},files:[{id:'quote',submissionId:'A',name:'TEST 1 - QUOTE.pdf',classification:'QUOTES_UNDERLYING',extractMeta:{pageTexts:pages}}]}};}

test('matching quote broker block fills company and address without inventing a contact person',()=>{
 const r=rules(),s=submission();assert.equal(r.resolveField('broker_company',s).value,'EXAMPLE & SAMPLE AGENCY, LLC');assert.equal(r.resolveField('broker_address',s).value,'120 SAMPLE ST STE 100, AUSTIN, TX 78701-0000');assert.equal(r.resolveField('broker_name',s),null);assert.match(r.resolveField('broker_company',s).source,/TEST 1 - QUOTE/);
});
test('quote labels support wrapped lines and repeated consistent brokerage blocks',()=>{
 const r=rules(),s=submission([text,text.replace('Broker: EXAMPLE','Broker:\nEXAMPLE')]);assert.equal(r.resolveField('broker_company',s).value,'EXAMPLE & SAMPLE AGENCY, LLC');assert.match(r.resolveField('broker_address',s).value,/AUSTIN/);
});
test('native PDF space-joined page text preserves explicit quote insured and broker boundaries',()=>{
 const r=rules(),s=submission([text.replaceAll('\n',' ')]);assert.equal(r.resolveField('broker_company',s).value,'EXAMPLE & SAMPLE AGENCY, LLC');assert.equal(r.resolveField('broker_address',s).value,'120 SAMPLE ST STE 100 AUSTIN, TX 78701-0000');assert.equal(r.resolveField('broker_name',s),null);
});
test('missing, unrelated and conflicting broker evidence remains blank',()=>{
 const r=rules();
 for(const raw of [text.replace('Named Insured: SYNTHETIC SUPPLY CO INC','Named Insured: Unrelated LLC'),text.replace('Named Insured: SYNTHETIC SUPPLY CO INC',''),text.replace('Broker: EXAMPLE & SAMPLE AGENCY, LLC','A business article mentioned Example & Sample Agency.'),'Named Insured: SYNTHETIC SUPPLY CO INC\nBroker: Jane Smith'])assert.equal(r.resolveField('broker_company',submission([raw])),null);
 assert.equal(r.resolveField('broker_company',submission([text,text.replace('EXAMPLE & SAMPLE AGENCY, LLC','OTHER AGENCY, LLC')])),null);
 const conflict=submission([text,text.replace('EXAMPLE & SAMPLE AGENCY, LLC','OTHER AGENCY, LLC')]);conflict.snapshot.extractions['summary-ops']={text:'Brokerage: A guessed fallback agency'};assert.equal(r.resolveField('broker_company',conflict),null);
 const foreign=submission();foreign.snapshot.files[0].submissionId='B';assert.equal(r.resolveField('broker_company',foreign),null);
});

test('actual deal writer fills source broker fields and preserves an edited broker dialog including cleared values',()=>{
 const app=fs.readFileSync(path.join(__dirname,'..','workbench-app.js'),'utf8'),start=app.indexOf('        function applyDealInfoFromActiveSubmission('),end=app.indexOf('        // FIX-PHASE-4-GL-PRIMARY-COVERAGE-',start);assert.ok(start>=0&&end>start);
 const elements=new Map(['brokerCoTxt','brokerAddrTxt','brokerNameTxt'].map(id=>[id,{id,textContent:'',classList:{add(){}}}]));let owned=false;
 const window={WorkbenchRules:rules(),__STM_WB_PHASE5:{ownsDialog:()=>owned}};
 const context={window,document:{querySelector:sel=>elements.get(sel.slice(1))||null,getElementById:id=>elements.get(id)||null},console:{log(){}},applyResolvedToElement:(el,kind,value)=>{el.textContent=value;return true;},syncResolvedInsuredToQueue8741(){},setTimeout(){},stmFieldLocked:()=>false};
 vm.runInNewContext(app.slice(start,end),context);context.applyDealInfoFromActiveSubmission(submission());assert.equal(elements.get('brokerCoTxt').textContent,'EXAMPLE & SAMPLE AGENCY, LLC');assert.equal(elements.get('brokerNameTxt').textContent,'');
 owned=true;elements.get('brokerCoTxt').textContent='My chosen brokerage';elements.get('brokerAddrTxt').textContent='';context.applyDealInfoFromActiveSubmission(submission());assert.equal(elements.get('brokerCoTxt').textContent,'My chosen brokerage');assert.equal(elements.get('brokerAddrTxt').textContent,'');
});
test('explicit quote producer person and structured brokerage fields participate in normal resolver priority',()=>{
 const r=rules(),s=submission(['Named Insured: SYNTHETIC SUPPLY CO INC\nProducer Name: Jane Smith']);assert.equal(r.resolveField('broker_name',s).value,'Jane Smith');assert.equal(r.resolveField('broker_company',s),null);
 const structured=submission([]);structured.snapshot.extractions.gl_quote={text:JSON.stringify({broker_company:'Explicit Brokerage LLC',broker_name:'Jane Smith'}),confidence:.98};assert.equal(r.resolveField('broker_company',structured).value,'Explicit Brokerage LLC');assert.equal(r.resolveField('broker_name',structured).value,'Jane Smith');
});
