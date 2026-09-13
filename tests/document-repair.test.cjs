const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function harness(){
 const filePath=path.join(__dirname,'..','pipeline-documents-view.js');let source=fs.readFileSync(filePath,'utf8');
 const seam='\n  init();\n';assert.equal(source.split(seam).length,2);
 source=source.replace(seam,`\n  window.__testDocs={state,addDoc};renderDocsList=()=>{};renderTagsList=()=>{};renderCategoryGrid=()=>{};updateSubmissionChip=()=>{};toast=()=>{};return;\n`);
 const writes=[],pending=[];let fail=false;
 const window={STATE:{activeSubmissionId:'A',files:[]},currentUser:{id:'user'},
  sbInsertDocumentPage:async()=>{},sbUpdateDocumentPage:(id,patch)=>{writes.push({id,patch:{...patch}});const task=fail?Promise.reject(new Error('Document sync failed')):Promise.resolve();pending.push(task);return task;},
  sb:{auth:{getSession:async()=>({data:{session:{user:{id:'user'}}}})}},
  docsViewMappingFor:()=>({color:'green',category:'applications'}),
  __STM_DOC_JOURNAL:{entries:()=>[],flush:async()=>{await Promise.all(pending);return {mode:'cloud'};},status:()=>({dirty:false,pending:0,error:''})}};
 const context=vm.createContext({window,console:{warn(){}},setTimeout,clearTimeout,document:{addEventListener(){},getElementById(){return null;},querySelector(){return null;},querySelectorAll(){return[];}},localStorage:{getItem(){return null;}},confirm:()=>true,Blob,URL,Map,Set,Date});
 vm.runInContext(source,context,{filename:filePath});window.initDocumentsView();
 const api=window.docsView,helpers=window.__testDocs;
 const file=(extra={})=>{const f={id:'source',name:'Package.pdf',submissionId:'A',state:'classified',classification:'APPLICATIONS',tag:'Package',classifications:[{tag:'ACORD 125',section_hint:'pages 1-4'},{tag:'ACORD 126',section_hint:'pages 5-120'},{tag:'Loss runs',section_hint:'pages 121-200'}],...extra};window.STATE.files.push(f);return f;};
 const page=(f,n,total=200,extra={})=>helpers.addDoc({name:f.name+' — Page '+n,workbookFileName:f.name,sourceFileId:f.id,submissionId:f.submissionId,pageNumber:n,totalPages:total,type:'pdf',pipelineClassification:f.classification,pipelineTag:'Package',color:'green',...extra});
 return {window,api,helpers,writes,file,page,failWrites:()=>fail=true};
}

test('repair preview performs no writes; apply repairs only automatic continuation flags and is idempotent',async()=>{
 const h=harness(),f=h.file(),pages=Array.from({length:200},(_,i)=>h.page(f,i+1));
 for(const d of pages){d.pipelineTag=[1,5,121].includes(d.pageNumber)?({1:'ACORD 125',5:'ACORD 126',121:'Loss runs'})[d.pageNumber]:null;d.color='green';d.tagged=true;}
 const manual=pages[8];manual.relabeledByUser=true;manual.color='blue';manual.displayName='My reviewed page';manual.category='underwriting';h.helpers.state.annotations.store[manual.id]={layers:[{id:'note',text:'Keep annotation'}]};
 const before=JSON.stringify(pages),preview=await h.api.design.repairMarkers();
 assert.equal(preview.changedPages,196);assert.equal(preview.untouchedManualPages,1);assert.equal(preview.taggedBefore,200);assert.equal(preview.taggedAfter,4);assert.equal(h.writes.length,0);assert.equal(JSON.stringify(pages),before);
 const result=await h.api.design.repairMarkers({apply:true,preview});assert.equal(result.saved,true);assert.equal(result.appliedPages,196);assert.equal(h.writes.length,196);
 assert.deepEqual(pages.filter(d=>d.tagged).map(d=>d.pageNumber),[1,5,9,121]);assert.equal(manual.color,'blue');assert.equal(manual.displayName,'My reviewed page');assert.equal(manual.category,'underwriting');assert.equal(h.helpers.state.annotations.store[manual.id].layers[0].text,'Keep annotation');
 assert.ok(h.writes.every(w=>Object.keys(w.patch).every(k=>['pipeline_tag','tagged','color'].includes(k))));
 const again=await h.api.design.repairMarkers();assert.equal(again.changedPages,0);await h.api.design.repairMarkers({apply:true,preview:again});assert.equal(h.writes.length,196);
});

test('repair keeps recorded section chips when an older source snapshot omitted section ranges',async()=>{
 const h=harness(),f=h.file({classifications:[]}),pages=[1,2,5,6].map(n=>h.page(f,n,6));
 pages.forEach(d=>{d.pipelineTag=d.pageNumber===1?'ACORD 125':d.pageNumber===5?'ACORD 126':null;d.color='green';d.tagged=true;});
 const preview=await h.api.design.repairMarkers();assert.equal(preview.changedPages,2);await h.api.design.repairMarkers({apply:true,preview});assert.deepEqual(pages.filter(d=>d.tagged).map(d=>d.pageNumber),[1,5]);assert.equal(pages[2].pipelineTag,'ACORD 126');
});

test('repair respects source identity, ambiguous filenames and submission boundaries',async()=>{
 const h=harness(),f=h.file(),other=h.file({id:'other',name:f.name}),foreign=h.file({id:'foreign',submissionId:'B'});
 const a=h.page(f,2),b=h.page(other,2),out=h.page(foreign,2),ambiguous=h.page(f,2,200,{sourceFileId:null});
 for(const d of [a,b,out,ambiguous]){d.pipelineTag=null;d.color='green';d.tagged=true;}
 const preview=await h.api.design.repairMarkers();assert.equal(preview.changedPages,2);assert.equal(preview.skippedPages,1);await h.api.design.repairMarkers({apply:true,preview});
 assert.equal(a.tagged,false);assert.equal(b.tagged,false);assert.equal(out.tagged,true);assert.equal(ambiguous.tagged,true);assert.ok(h.writes.every(w=>[a.id,b.id].includes(w.id)));
});

test('repair refuses a stale preview after a manual edit, source correction or submission switch',async()=>{
 for(const change of ['manual','source','scope']){
  const h=harness(),f=h.file(),d=h.page(f,2);d.color='green';d.tagged=true;const preview=await h.api.design.repairMarkers();
  if(change==='manual')d.relabeledByUser=true;else if(change==='source')f.classifications[0].section_hint='pages 2-4';else h.window.STATE.activeSubmissionId='B';
  await assert.rejects(h.api.design.repairMarkers({apply:true,preview}),/changed since/);assert.equal(h.writes.length,0);
 }
});

test('repair requires idle successfully hydrated document metadata and acknowledged saving',async()=>{
 const h=harness(),f=h.file(),d=h.page(f,2);d.color='green';d.tagged=true;
 h.window.STATE._stmIntakePending=1;await assert.rejects(h.api.design.repairMarkers(),/intake/);h.window.STATE._stmIntakePending=0;
 h.helpers.state._lastHydrateError='timeout';await assert.rejects(h.api.design.repairMarkers(),/Refresh saved documents/);h.helpers.state._lastHydrateError=null;
 const preview=await h.api.design.repairMarkers();h.failWrites();await assert.rejects(h.api.design.repairMarkers({apply:true,preview}),/Document sync failed/);assert.equal(h.writes.length,1);
});
