'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
function library(){const window={location:{search:''}},ctx=vm.createContext({window,console:{info(){},warn(){},log(){}},URLSearchParams,Map,Set});vm.runInContext(read('fleet-source.js'),ctx);return {api:window.STMFleetSource,window,ctx};}
// Synthetic schedules keep the original PDF extractor's separate tables and
// repeated coverage-grid identifiers. Unit IDs have gaps and are not counts.
const vehicles=[
  ['12','HEAVY'],['17','LIGHT'],['24','MEDIUM'],['29','EX HVY TRK-TRACT'],
  ['35','TRK-TRACTOR'],['41','HEAVY'],['58','MEDIUM'],['72','TRAILER']
].map(([unit,size],i)=>({unit,size,radius:'LOCAL',identifier:'1TESTABC'+String(700000000+i)}));
function page(rows,quote='SYNTH-4321'){
  return 'Quote Number: '+quote+' Account Number: DECLARATIONS: BUSINESS AUTOMOBILE COVERAGE INFORMATION ITEM THREE - SCHEDULE OF COVERAGE AUTOS YOU OWN '+
  'AUTO YEAR MAKE MODEL VEHICLE ID NO. COST NEW PLACE OF GARAGING '+rows.map(r=>`${r.unit} 2020 EXAMPLE MODEL ${r.identifier} 99,000 EXAMPLE TX`).join(' ')+
  ' AUTO RADIUS BUSINESS USE TRUCK SIZE AGE LOSS PAYEE '+rows.map(r=>`${r.unit} ${r.radius} ${r.size==='EX HVY TRK-TRACT'?'EXTRA HVY TRUCK':'COMMERCIAL'} ${r.size} 6`).join(' ')+
  ' The following coverages and premiums apply to the above described covered autos. Refer to ITEM TWO for applicable limits and coverage information. '+
  '-------- COVERAGES(S) ---- VEHICLE NUMBER(S) -------- '+rows.map(r=>r.unit).join(' ')+' LIABILITY '+rows.map(()=>123).join(' ')+' Other Coverage Information:';
}
function file(rows=vehicles){return {id:'FILE-SYNTH',name:'Synthetic quote.pdf',submissionId:'SUB-SYNTH',routedToAll:['al_quote'],extractMeta:{pageCount:4,pageTexts:['DECLARATIONS: BUSINESS AUTOMOBILE POLICY FORMS',page(rows.slice(0,4)),page(rows.slice(4)),'DECLARATIONS: COMMERCIAL LIABILITY UMBRELLA']}};}
function submission(f=file(),record={text:'Fleet Composition (corrected counts):\nLight: 99',sourceInfo:'Synthetic quote.pdf'}){return {id:'SUB-SYNTH',snapshot:{files:[f],extractions:{al_quote:record}}};}

test('complete source joins each unit to its own printed type/radius and coverage-grid ID',()=>{
  const {api}=library(),r=api.parseFile(file());assert.equal(r.complete,true);assert.equal(r.total,7);
  assert.deepEqual(clone(r.counts),{fleet_private_passenger:0,fleet_light:1,fleet_medium:2,fleet_heavy_local:2,fleet_heavy_other:0,fleet_extra_heavy_local:0,fleet_extra_heavy_intermediate:0,fleet_extra_heavy_long:0,fleet_truck_tractors_local:2,fleet_truck_tractors_intermediate:0,fleet_truck_tractors_long:0});
  assert.equal(r.units.find(r=>r.unit==='29').field,'fleet_truck_tractors_local');assert.equal(r.units.find(r=>r.unit==='72').field,'trailer');
  assert.deepEqual(clone(r.pages),[2,3]);assert.equal(api.validRoster(r),true);
  // The printed identifier can be16characters, but is not decoded or declared
  // a valid VIN. Numeric make/model/cost values do not affect the class.
  const shorter=file(vehicles.map((v,i)=>i===2?{...v,identifier:v.identifier.slice(0,16)}:v));assert.equal(api.parseFile(shorter).total,7);
});

test('radius is explicit and source category recognition precedes extra-heavy business-use text',()=>{
  const rows=clone(vehicles);rows[3].radius='INTERMEDIATE';rows[4].radius='LONG HAUL';rows[5].radius='INTERMEDIATE';rows[6].size='EXTRA HEAVY';
  const r=library().api.parseFile(file(rows));assert.equal(r.counts.fleet_truck_tractors_intermediate,1);assert.equal(r.counts.fleet_truck_tractors_long,1);assert.equal(r.counts.fleet_heavy_other,1);assert.equal(r.counts.fleet_extra_heavy_local,1);
});

test('partial, sparse, unknown, duplicate and conflicting source schedules cannot become a total',()=>{
  const {api}=library();
  const mutations=[
    f=>f.extractMeta.pageTexts.pop(),f=>delete f.extractMeta.pageTexts[1],f=>f.extractMeta.pageTexts[1]=null,
    f=>f.extractMeta.pageTexts[1]=f.extractMeta.pageTexts[1].replace('29 LOCAL EXTRA HVY TRUCK EX HVY TRK-TRACT 6',''),
    f=>f.extractMeta.pageTexts[1]=f.extractMeta.pageTexts[1].replace('24 LOCAL COMMERCIAL MEDIUM','24 LOCAL COMMERCIAL UNKNOWN'),
    f=>f.extractMeta.pageTexts[1]=f.extractMeta.pageTexts[1].replace('17 LOCAL','17 UNKNOWN'),
    f=>f.extractMeta.pageTexts[1]=f.extractMeta.pageTexts[1].replace('12 17 24 29 LIABILITY','12 17 29 LIABILITY'),
    f=>f.extractMeta.pageTexts[2]=page(vehicles.slice(4),'SYNTH-OTHER'),
    f=>f.extractMeta.pageTexts[2]=page([vehicles[0],...vehicles.slice(5)]),
    f=>f.extractMeta.pageTexts[1]=f.extractMeta.pageTexts[1].replace(vehicles[0].identifier,'XXXXXXXXXXXXXXXXX'),
    f=>f.extractMeta.pageTexts[1]=f.extractMeta.pageTexts[1].replace(vehicles[0].identifier,'00000000000000000'),
    f=>{f.extractMeta.pageTexts=[page(vehicles), 'DECLARATIONS: END'];f.extractMeta.pageCount=2;},
    f=>{f.extractMeta.pageTexts.splice(2,0,'');f.extractMeta.pageCount++;}
  ];
  for(const mutate of mutations){const f=file();mutate(f);assert.ok(!api.parseFile(f)?.complete,mutate.toString());}
});

test('source selection uses submission/file identity and explicit exclusion gates; quotes never cross-pair',()=>{
  const {api}=library(),s=submission();assert.equal(api.fromSubmission(s).total,7);
  for(const property of ['rejected','refused','excluded']){const q=clone(s);q.snapshot.extractions.al_quote[property]=true;assert.ok(!api.fromSubmission(q)?.complete);}
  const gate=clone(s);gate.snapshot.extractions.al_quote.gateDetails={proceed:false};assert.ok(!api.fromSubmission(gate)?.complete);
  const mismatch=clone(s);mismatch.snapshot.extractions.al_quote.applicantGate='mismatch';assert.equal(api.fromSubmission(mismatch).total,7);assert.ok(!api.fromSubmission(mismatch,{strict:true})?.complete);
  const foreign=clone(s);foreign.snapshot.files[0].submissionId='OTHER';assert.ok(!api.fromSubmission(foreign)?.complete);
  const wrong=clone(s);wrong.snapshot.extractions.al_quote.sourceFileIds95=['OTHER'];assert.ok(!api.fromSubmission(wrong)?.complete);
  const ambiguous=clone(s);ambiguous.snapshot.files.push({...clone(file()),id:'SECOND'});assert.ok(api.fromSubmission(ambiguous).blocked);
  ambiguous.snapshot.extractions.al_quote.sourceFileIds95=['FILE-SYNTH'];assert.equal(api.fromSubmission(ambiguous).total,7);
  ambiguous.snapshot.files[1].name='Second quote.pdf';ambiguous.snapshot.extractions.al_quote.sourceFileIds95.push('SECOND');assert.ok(api.fromSubmission(ambiguous).blocked);
});

const draft='Named Insured: Example Contractor\n**Fleet Composition:**\n- Light: 99 (units 999)\n- Medium: 2\n- Heavy (Local): 3\n- Truck Tractors (Local): 1\n- Total power units: 105\n\nNote: "Heavy (Local)" line lists 3 units. Correcting count.\nLet me recount carefully:\nHeavy units (TRUCK SIZE = HEAVY): 12, 29, 41 = 3 units\nTruck-Tractor / EX HVY TRK-TRACT units: 35 = 1 units\nLight: 17 = 1\nMedium: 24, 58 = 2\nTotal: 3 + 1 + 1 + 2 = 7\n**Fleet Composition (corrected):**\n- Light: 1\n- Medium: 2\n- Heavy (Local): 3\n- Truck Tractors (Local): 1\n- Vehicle code evidence: Draft inferred roster\n- Garaging: Example, TX\n- Radius: All Local\n- Total power units: 7\n\n**Premium:**\n- AL Annual Premium: $12,345\n**Endorsements:**\nRetain every coverage term.';
test('bounded A13 reconciliation replaces both contradictory rosters and fleet recount, preserving other source details',()=>{
  const {api}=library(),r=api.parseFile(file()),text=api.reconcileText(draft,r);
  assert.equal((text.match(/Fleet Composition/g)||[]).length,1);assert.match(text,/Heavy \(Local\): 2 \(units 12, 41\)/);assert.match(text,/Truck Tractors \(Local\): 2 \(units 29, 35\)/);
  for(const stale of ['999','Draft inferred','Let me recount','Correcting count','Heavy units','Total: 3 +'])assert.ok(!text.includes(stale),stale);
  for(const retained of ['Example Contractor','Garaging: Example, TX','Radius: All Local','$12,345','Retain every coverage term.'])assert.ok(text.includes(retained),retained);
  assert.equal(api.reconcileText(text,r),text,'idempotent replay');
});

test('Workbench uses original source ahead of wrong model JSON; unknown is null and explicit source zero survives',()=>{
  const {api,ctx,window}=library();vm.runInContext(read('workbench-rules.js'),ctx);
  const rec={text:'```json\n{"fleet_heavy_local":99,"fleet_truck_tractors_local":88}\n```',sourceInfo:'Synthetic quote.pdf',review_required:true};
  const s=submission(file(),rec),r=window.WorkbenchRules.resolveField('fleet_heavy_local',s);
  assert.equal(r.value,'2');assert.equal(r.source,'al_quote:source_roster');assert.equal(r.sourceFileId,'FILE-SYNTH');assert.equal(r.review_required,true);
  assert.equal(window.WorkbenchRules.resolveField('fleet_extra_heavy_local',s).value,'0');
  const partial=clone(s);partial.snapshot.files[0].extractMeta.pageTexts.pop();assert.equal(window.WorkbenchRules.resolveField('fleet_heavy_local',partial),null);
  const saved=clone(s);saved.snapshot.extractions.al_quote.fleet_source95=clone(api.parseFile(file()));saved.snapshot.extractions.al_quote.sourceFileIds95=['FILE-SYNTH'];saved.snapshot.files=[];
  assert.equal(window.WorkbenchRules.resolveField('fleet_heavy_local',saved).value,'2','lightweight hydration keeps validated source result');
  saved.snapshot.extractions.al_quote.fleet_source95.counts.fleet_heavy_local=999;
  assert.equal(api.fromSubmission(saved),null,'invalid persisted source metadata is never authoritative');
});

test('explicit fleet JSON counts agree with the source while unrelated fields and later plain sections survive',()=>{
  const {api}=library(),r=api.parseFile(file());
  const raw=draft.replace('**Premium:**','Premium:')+'\nTotal units: 999\n```json al_structured\n'+JSON.stringify({fleet_heavy_local:99,fleet_truck_tractors_local:'1',total_power_units:999,policy:{limit:123456,fleet_heavy_local:55},unrelated:{heavy:99,total:88},notes:'Source text stays'})+'\n```';
  const text=api.reconcileText(raw,r),data=JSON.parse(/```json al_structured\n([^]*?)\n```/.exec(text)[1]);
  assert.equal(data.fleet_heavy_local,2);assert.equal(data.fleet_truck_tractors_local,'2');assert.equal(data.total_power_units,7);assert.equal(data.policy.limit,123456);assert.equal(data.policy.fleet_heavy_local,55,'nested owner/scenario is not assumed');assert.deepEqual(data.unrelated,{heavy:99,total:88});assert.equal(data.notes,'Source text stays');
  assert.ok(text.includes('Total units: 999'),'outside the bounded fleet section is not silently rewritten');
});

function engineHarness(output=draft,cached=null){
  const {api,window,ctx}=library(),calls=[],writes=[],STATE={activeSubmissionId:'SUB-SYNTH',files:[file()],api:{model:'synthetic-model'},extractions:{},edits:{al_quote:'Manual summary override'},pipelineRun:'synthetic-run'};
  Object.assign(ctx,{STATE,Date,Map,Set,MODULES:{al_quote:{code:'A13',model:'synthetic-model'},'summary-ops':{code:'A6'},exposure:{code:'A9'},strengths:{code:'A10'}},PROMPTS:{},MODULE_CACHE_CONTRACT_8765:{},
    setNodeState(){},logAudit(){},toast(){},gateModuleByApplicant:async()=>({proceed:true}),shouldNeutralizeApplicantFilter8706:()=>false,applicantGateMode8737:()=> 'off',
    substitutePromptVars:s=>s,synthesisSourceIdentity95:()=>[],sourceIdentityInstruction95:()=>'',sourceLabelInstruction95:()=>'',appendSourceIdentity95:s=>s,
    sourceCoverageEvidence95:()=>[],appendSourceCoverage95:s=>s,sourceCoverageInstruction95:()=>'',sourceNarrativeReview95:()=>[],
    cacheable8760:()=>true,cacheKey8760:async()=> 'synthetic-key',extractionCacheGet8760:async()=>cached,extractionCachePut8760(...args){writes.push(args);},
    callLLM:async(prompt,input)=>{calls.push({prompt,input});return {text:output,usage:{input_tokens:1,output_tokens:1,model:'synthetic-model'}};},moduleMaxTokens:()=>1000,
    summaryIntegrityReview95:()=>[],calcCost:()=>0,fmtCost:()=>'$0',estimateExtractionConfidence:()=>0.8});
  const engine=read('pipeline-engine.js');vm.runInContext(between(engine,'function sourceFleetForRun95(','// v8.7.84 PHASE 6'),ctx);
  return {ctx,STATE,calls,writes,api};
}
test('real A13 processing boundary preserves original/manual text and feeds corrected counts to dependency inputs',async()=>{
  const h=engineHarness();assert.equal(await h.ctx.runModule('al_quote','Extract AL', 'Raw source input','Synthetic quote.pdf',{sourceFiles95:h.STATE.files}),true);
  const r=h.STATE.extractions.al_quote;assert.equal(r.fleet_source95.total,7);assert.deepEqual(clone(r.sourceFileIds95),['FILE-SYNTH']);assert.equal(r.original_response_text95,draft);
  assert.equal(h.STATE.edits.al_quote,'Manual summary override');assert.match(h.calls[0].input,/COMPLETE ORIGINAL QUOTE VEHICLE ROSTER/);assert.match(h.calls[0].prompt,/do not reclassify/);
  assert.equal(h.writes[0][3].text,r.text,'cache stores corrected source text');
  for(const module of ['summary-ops','exposure','strengths']){await h.ctx.runModule(module,'Synthesize','=== A13 ===\n'+r.text,'A13',{});assert.match(h.calls.at(-1).input,/Truck Tractors \(Local\): 2 \(units 29, 35\)/);}
});
test('cached A13 replay is reconciled against the same eligible source without another model call',async()=>{
  const h=engineHarness(draft,{payload:{text:draft},created_run:'older-run'});assert.equal(await h.ctx.runModule('al_quote','Extract AL','Raw','Synthetic quote.pdf',{sourceFiles95:h.STATE.files}),true);
  assert.equal(h.calls.length,0);assert.equal(h.STATE.extractions.al_quote.fleet_source95.total,7);assert.equal(h.STATE.extractions.al_quote.original_response_text95,draft);
});
test('both engine entrypoints load the same fleet parser before its consumer',()=>{
  for(const [entry,consumer]of [['engine-platform.html','pipeline-engine.js'],['engine-workbench.html','workbench-rules.js']]){const html=read(entry);assert.ok(html.indexOf('src="fleet-source.js')>=0);assert.ok(html.indexOf('src="fleet-source.js')<html.indexOf('src="'+consumer));}
});
