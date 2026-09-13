'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const layout=require('../source-layout-evidence.js'),root=path.join(__dirname,'..');
const item=(str,x,y=700,width=str.length*5)=>({str,width,transform:[10,0,0,10,x,y],fontName:'synthetic',hasEOL:false});
const content=()=>({items:[item('Payroll $',20),item('Subcontract cost $',180),item('Receipts $',380),item('240,000',90,700.4),item('310,000',280,700.4),item('900,000',445,700.4),item('Synthetic supporting text '.repeat(7),20,650)],styles:{synthetic:{vertical:false}}});
const viewport={width:612,height:792,transform:[1,0,0,-1,0,792]};
function source(data=content()){
 const meta={pageCount:1,pageTexts:[data.items.map(x=>x.str).join(' ')],layoutEvidenceV1:layout.createDocument(1,'PDF.js synthetic')};
 layout.addPage(meta.layoutEvidenceV1,layout.capturePage(1,data,viewport));
 return {id:'file-synthetic',name:'Application.pdf',submissionId:'submission-synthetic',extractMeta:meta,text:meta.pageTexts[0],type:'supplemental'};
}
test('positioned rows place late-filled values beside original labels and preserve every source fragment',()=>{
 const data=content(),before=JSON.stringify(data),file=source(data),row=file.extractMeta.layoutEvidenceV1.pages[0].rows[0];
 assert.deepEqual(row.cells.map(c=>c.text),['Payroll $','240,000','Subcontract cost $','310,000','Receipts $','900,000']);
 assert.deepEqual(row.cells.map(c=>c.i),[0,3,1,4,2,5]);assert.equal(JSON.stringify(data),before);
 const text=layout.fileBlock(file,'submission-synthetic');assert.match(text,/Payroll \$/);assert.ok(text.indexOf('240,000')<text.indexOf('Subcontract cost'));
 assert.match(text,/Blank or omitted cells are UNKNOWN, not 0/);
});
test('trade columns and row identities remain source geometry, including explicit zero versus absent cell',()=>{
 const data={items:[item('Trade A',20,700),item('Direct',120,700),item('Subbed',180,700),item('Trade B',240,700),item('Direct',340,700),item('Subbed',400,700),item('Excavation',20,680),item('0',125,680),item('Maintenance',240,680),item('37',345,680)],styles:{}};
 const file=source(data),rows=file.extractMeta.layoutEvidenceV1.pages[0].rows;
 assert.deepEqual(rows[1].cells.map(c=>c.text),['Excavation','0','Maintenance','37']);
 assert.equal(rows[1].cells.length,4,'blank subbed cells produce no invented zero/text');
 const block=layout.fileBlock(file,'submission-synthetic');assert.match(block,/\[x125 .*"0"/);assert.match(block,/Separate repeated side-by-side table groups/);
});
test('rotated/unreadable/oversized geometry fails closed without changing flat text',()=>{
 const rotated=content();rotated.items[0].transform=[0,10,-10,0,20,700];const file=source(rotated);
 assert.equal(file.extractMeta.layoutEvidenceV1.pages.length,0);assert.equal(file.extractMeta.layoutEvidenceV1.omittedPages.length,1);assert.equal(layout.fileBlock(file,'submission-synthetic'),'');
 assert.equal(layout.createDocument(16,'x').eligible,false);
 assert.deepEqual(layout.capturePage(1,{items:Array.from({length:1201},()=>item('x',1)),styles:{}},viewport).issues,['page_item_limit']);
});
test('source ownership, manual replacement and stale/corrupt metadata cannot inject unrelated rows',()=>{
 for(const change of [{submissionId:'other'},{excluded:true},{rejected:true},{refused:true},{cancelled:true},{manuallyPasted:true},{gateDetails:{proceed:false}}])assert.equal(layout.fileBlock({...source(),...change},'submission-synthetic'),'');
 const stale=source();stale.extractMeta.pageTexts[0]+=' edited';assert.equal(layout.fileBlock(stale,'submission-synthetic'),'');
 const corrupt=source();corrupt.extractMeta.layoutEvidenceV1.pages[0].rows=[{}];assert.equal(layout.fileBlock(corrupt,'submission-synthetic'),'');
});
test('model supplement honors hard budget and complete-row boundaries',()=>{
 const file=source();for(const budget of [10,899,1400,1800,24000])assert.ok(layout.fileBlock(file,'submission-synthetic',budget).length<=budget);
 const block=layout.fileBlock(file,'submission-synthetic',1800);if(block)assert.match(block,/=== END SUPPLEMENTAL SOURCE LAYOUT ===$/);
});
test('persisted geometry integrity rejects changed cell text/positions, duplicate IDs/pages and unbounded shapes',()=>{
 for(const corrupt of [
   file=>{file.extractMeta.layoutEvidenceV1.pages[0].rows[0].cells[0].text='Changed label';},
   file=>{file.extractMeta.layoutEvidenceV1.pages[0].rows[0].cells[0].x+=25;},
   file=>{file.extractMeta.layoutEvidenceV1.pages[0].rows[0].cells[0].w=-2;},
   file=>{file.extractMeta.layoutEvidenceV1.pages[0].rows[0].cells[1].i=0;},
   file=>{file.extractMeta.layoutEvidenceV1.pages.push(file.extractMeta.layoutEvidenceV1.pages[0]);},
   file=>{const page=file.extractMeta.layoutEvidenceV1.pages[0];page.rows=Array.from({length:1200},()=>page.rows[0]);},
   file=>{file.extractMeta.layoutEvidenceV1.pages[0].rows=[null];}
 ]){const file=source();corrupt(file);assert.equal(layout.fileBlock(file,'submission-synthetic'),'');}
});
function section(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a);return text.slice(a,b);}
test('actual PDF extractText returns identical legacy flat/page text while storing bounded geometry',async()=>{
 const data=content(),pdf={numPages:1,getPage:async()=>({getTextContent:async()=>data,getViewport:()=>viewport,cleanup(){}}),destroy:async()=>{}},metadata={};
 const context=vm.createContext({window:{STMSourceLayout:layout},pdfjsLib:{version:'synthetic',getDocument:()=>({promise:Promise.resolve(pdf)})},setTimeout,console});
 const core=fs.readFileSync(path.join(root,'pipeline-core.js'),'utf8');vm.runInContext(section(core,'async function extractText(','function buildAttachmentContext('),context);
 const text=await context.extractText({name:'Application.pdf',arrayBuffer:async()=>new ArrayBuffer(0)},metadata);
 assert.equal(text,data.items.map(i=>i.str).join(' ')+'\n\n');assert.deepEqual(Array.from(metadata.pageTexts),[data.items.map(i=>i.str).join(' ')]);
 assert.equal(metadata.layoutEvidenceV1.pages.length,1);assert.equal(metadata.pageCount,1);
 const noHelper=vm.createContext({window:{},pdfjsLib:context.pdfjsLib,setTimeout,console});vm.runInContext(section(core,'async function extractText(','function buildAttachmentContext('),noHelper);assert.equal(await noHelper.extractText({name:'Application.pdf',arrayBuffer:async()=>new ArrayBuffer(0)},{}),text);
});
test('actual A2 builder appends only same-source primary geometry and retains legacy fallback exactly',()=>{
 const context=vm.createContext({window:{STMSourceLayout:layout},STATE:{activeSubmissionId:'submission-synthetic'},splitSupplementalInputFiles8706:files=>({primary:files.filter(f=>f.type==='supplemental'),secondary:files.filter(f=>f.type!=='supplemental')}),sliceTextForModule:f=>f.text,buildCheckboxMarksBlock8708:()=>''});
 const engine=fs.readFileSync(path.join(root,'pipeline-engine.js'),'utf8');vm.runInContext(section(engine,'function buildSupplementalCombinedInput8706(','// v8.7.123: A5'),context);
 const file=source(),before=JSON.stringify(file),output=context.buildSupplementalCombinedInput8706([file]);assert.ok(output.includes(file.text));assert.match(output,/SOURCE LAYOUT/);assert.equal(JSON.stringify(file),before);
 const old={name:'Legacy.pdf',text:'Exact old text',type:'acord'};assert.equal(context.buildSupplementalCombinedInput8706([old]),'=== FILE: Legacy.pdf ===\n\nExact old text');
 const noMeta={...file,extractMeta:{pageTexts:file.extractMeta.pageTexts}};assert.equal(context.buildSupplementalCombinedInput8706([noMeta]),'=== SUPPLEMENTAL APPLICATION (PRIMARY SOURCE): Application.pdf ===\n\n'+file.text);
 const combined=context.buildSupplementalCombinedInput8706([file,{...source(),id:'other-file',type:'acord'}]);assert.equal((combined.match(/=== SUPPLEMENTAL SOURCE LAYOUT \(/g)||[]).length,1);
});
test('Workbench evidence transfer preserves the sidecar with its page text instead of binary content',()=>{
 const integration=require('../integration-core.js'),file=source(),original=JSON.stringify(file);const transfer=integration.workbenchRecord({id:'submission-synthetic',snapshot:{}},{activeSubmissionId:'submission-synthetic',files:[file]}).snapshot.files;
 assert.deepEqual(transfer[0].extractMeta.layoutEvidenceV1,file.extractMeta.layoutEvidenceV1);assert.deepEqual(transfer[0].extractMeta.pageTexts,file.extractMeta.pageTexts);assert.equal(JSON.stringify(file),original);
});
