'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8'),clone=x=>JSON.parse(JSON.stringify(x));
function between(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a,start);return text.slice(a,b);}
function harness(){
 const ctx=vm.createContext({window:{},console}),engine=read('pipeline-engine.js');
 vm.runInContext(between(engine,'function stmClassifierTextBlob(','// DETERMINISTIC DOCUMENT DETECTOR LIBRARY')+'\n'+between(engine,'function stmSectionClassificationsForDocs(','// v8.6.85'),ctx);
 vm.runInContext(between(read('pipeline-documents-view.js'),'  function _parsePageRangeForChip(','  function _hasPipelineClassification('),ctx);
 return ctx;
}
const guard=(tag)=>({type:'QUOTES_UNDERLYING',tag,section_hint:'entire document',confidence:.96,reasoning:'Surgical guard: '+tag+' schedule detected.'});
const gl='COMMERCIAL GENERAL LIABILITY RATE PREM/ PROD/COMP CLASSIFICATION CODE# PREMIUM BASIS BASIS OPS OPS Example Store 12345 345,000 (001) $700 $800';
const acordGl='COMMERCIAL GENERAL LIABILITY SECTION SCHEDULE OF HAZARDS CLASSIFICATION CLASS PREMIUM EXPOSURE CODE BASIS PREM/OPS PRODUCTS Example Store 12345 S 345000';
const al='VEHICLE DESCRIPTION VEH# YEAR MAKE: Example MODEL: Truck V.I.N.: 1TESTABC123456789 LOCAL';
function source(pages){return {id:'synthetic-source',name:'Application.pdf',text:pages.join('\n\n'),extractMeta:{pageCount:pages.length,pageTexts:pages}};}
function markers(ctx,classes,file){const sections=ctx.stmSectionClassificationsForDocs(classes,file);return file.extractMeta.pageTexts.map((_,i)=>ctx._resolvePerPageTag({pageNumber:i+1,totalPages:file.extractMeta.pageCount,pipelineTag:'Package',sectionClassifications:sections},{}));}

test('whole-file numbers and insurance prose cannot put an unrelated exposure marker on a contract cover',()=>{
 const c=harness(),f=source(['SUBCONTRACT AGREEMENT General Liability premium required.','Project12345, postal54321 and total cost $1,234,567.']),base={type:'APPLICATIONS',tag:'Sub Agreement',section_hint:'pages 1-2'};
 const parsed=c.stmApplyClassifierGuards({classifications:[base],primary_type:'APPLICATIONS'},f);
 const aux=parsed.classifications.find(x=>x.tag==='GL Exposure');assert.ok(aux,'legacy routing hint is retained');assert.equal(aux.section_hint,'entire document');assert.equal(aux.document_marker95,false);
 assert.deepEqual(clone(markers(c,parsed.classifications,f)),['Sub Agreement',null]);
});

test('application exposure and fleet tags move to populated source pages without changing extraction ranges',()=>{
 const c=harness(),f=source(['ACORD 125 form cover',al,'Vehicle continuation',acordGl,'GL continuation']);
 const input=[{type:'APPLICATIONS',tag:'ACORD 125',section_hint:'pages 1-3'},{type:'APPLICATIONS',tag:'ACORD 126',section_hint:'pages 4-5'},guard('GL Exposure'),guard('AL Fleet')];
 const before=clone(input),out=c.stmApplyClassifierGuards({classifications:input,primary_type:'APPLICATIONS'},f);
 assert.deepEqual(input,before,'source classification input is not mutated');
 assert.deepEqual(clone(markers(c,out.classifications,f)),['ACORD 125','AL Fleet',null,'ACORD 126 · GL Exposure',null]);
 for(const tag of ['GL Exposure','AL Fleet'])assert.equal(out.classifications.find(x=>x.tag===tag).section_hint,'entire document','routing text slice remains unchanged');
});

test('carrier and ACORD table formats require a filled row on the same page; blank forms and split terms do not qualify',()=>{
 const c=harness();for(const text of [gl,acordGl])assert.equal(c.stmAuxiliaryMarkerPage95(source(['Cover',text]),'GL Exposure'),2);
 const blanks=['CLASSIFICATION PREMIUM BASIS EXPOSURE','12345 S 345000'];assert.equal(c.stmAuxiliaryMarkerPage95(source(blanks),'GL Exposure'),null);
 assert.equal(c.stmAuxiliaryMarkerPage95(source(['VEHICLE DESCRIPTION YEAR MAKE MODEL VIN','1TESTABC123456789']),'AL Fleet'),null);
  assert.equal(c.stmAuxiliaryMarkerPage95(source([al]),'AL Fleet'),1);
  for(const placeholder of ['XXXXXXXXXXXXXXXXX','00000000000000000','ABCDEFGHIJKLMNOPR'])assert.equal(c.stmAuxiliaryMarkerPage95(source([al.replace('1TESTABC123456789',placeholder)]),'AL Fleet'),null,'blank-form identifier placeholder is not a vehicle');
});

test('saved guard classifications are relocated with current page evidence and duplicate display spellings count once',()=>{
 const c=harness(),f=source(['ACORD125',gl,al]);
 const classes=[{tag:'ACORD 125',section_hint:'page 1'},guard('GL Exposure'),guard('AL Fleet'),{tag:'gl   exposure',section_hint:'page 2'}];
 assert.deepEqual(clone(markers(c,classes,f)),['ACORD 125','GL Exposure','AL Fleet']);
 assert.deepEqual(clone(markers(c,[guard('GL Exposure')],source(['No table here']))),[null],'suppressed-only evidence never falls back to a page1 chip');
 const explicit={tag:'GL Exposure',section_hint:'page 1',reasoning:'Manually reviewed source'};assert.equal(markers(c,[explicit],source(['Manual source']))[0],'GL Exposure');
});

test('missing source page evidence cannot reuse a saved guard location as current proof',()=>{
 const c=harness(),saved={...guard('AL Fleet'),document_marker95:true,document_section_hint95:'page 4'};
 const projected=c.stmSectionClassificationsForDocs([saved],{name:'Saved.pdf',text:'VEHICLE SCHEDULE with a VIN'});
  assert.equal(projected[0].document_marker95,false);assert.equal(projected[0].section_hint,null);
  const unknown=c.stmSectionClassificationsForDocs([{tag:'Sub Agreement',section_hint:'unknown'},saved],{name:'Saved.pdf'});
  assert.equal(c._resolvePerPageTag({pageNumber:1,totalPages:10,pipelineTag:'AL Fleet',sectionClassifications:unknown},{}),'Sub Agreement','suppressed auxiliary cannot resurface through primary fallback');
});
