const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the actual document module and public APIs. Only visual startup/rendering
// is replaced: no browser, account, remote service, or fixture parser is needed
// to exercise classification, persistence patches, scope and hydration races.
function harness() {
  const sourcePath = path.join(__dirname, '..', 'pipeline-documents-view.js');
  let source = fs.readFileSync(sourcePath, 'utf8');
  const entry = '\n  init();\n';
  assert.equal(source.split(entry).length, 2, 'unique visual startup seam');
  source = source.replace(entry, `
  window.__testDocs = {state, addDoc, toggleTag, setColor, clearColor, bulkAction, clearTagged,
    hydrateFromCloud, _parsePageRangeForChip, _resolvePerPageTag, manualTaggedDisplayName8753};
  renderDocsList=()=>window.__renders.push('docs');
  renderTagsList=()=>window.__renders.push('tags');
  renderCategoryGrid=()=>window.__renders.push('categories');
  updateSubmissionChip=()=>{};
  toast=()=>{};
  return;
`);
  const inserts = [], writes = [], renders = [];
  const window = {
    STATE: {activeSubmissionId: 'submission-a', files: []},
    currentUser: {id: 'test-user'}, __renders: renders,
    sbInsertDocumentPage: async doc => { inserts.push({...doc}); },
    sbUpdateDocumentPage: async (id, patch) => { writes.push({id, patch: {...patch}}); },
    sb: {auth: {getSession: async () => ({data: {session: {user: {id: 'test-user'}}}})}},
  };
  const context = vm.createContext({window, console, setTimeout, clearTimeout,
    document: {addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }},
    localStorage: {getItem() { return null; }}, confirm: () => true,
    Blob, URL, Map, Set, Date});
  vm.runInContext(source, context, {filename: sourcePath});
  window.initDocumentsView();
  const api = window.docsView;
  const helpers = window.__testDocs;
  function file(id='source-a', name='Combined.pdf') {
    const f = {id, name, submissionId: 'submission-a', classification: 'APPLICATIONS', routedTo: 'applications', tag: 'Package'};
    window.STATE.files.push(f);
    return f;
  }
  function page(file, number, total=200, overrides={}) {
    return helpers.addDoc({name: file.name.replace(/\.[^.]+$/, '') + ' — Page ' + number,
      workbookFileName: file.name, sourceFileId: file.id, submissionId: file.submissionId,
      pageNumber: number, totalPages: total, type: 'pdf', ...overrides});
  }
  return {window, api, helpers, inserts, writes, renders, file, page};
}
const sections = [
  {tag: 'ACORD 125', section_hint: 'pages 1–4'},
  {tag: 'ACORD 126', section_hint: 'pages 5-120'},
  {tag: 'Loss runs', section_hint: 'pages 121 to 200'},
];
function classificationPatch(extra={}) {
  return {pipelineTag: 'Package', primaryBucket: 'APPLICATIONS', category: 'applications',
    color: 'green', sectionClassifications: sections, relabeledByUser: false, ...extra};
}
function markerValues(doc) {
  return [doc.pipelineTag, doc.color, doc.tagged];
}

test('first ingest and cached relabel mark only section starts of a 200-page file', async () => {
  const h = harness(), f = h.file();
  const fresh = Array.from({length: 200}, (_, i) => h.page(f, i+1, 200, classificationPatch()));
  assert.deepEqual(fresh.filter(d => d.tagged).map(d => d.pageNumber), [1, 5, 121]);
  const expected = fresh.map(markerValues);
  // Reproduce the saved all-page-color defect without changing the labels.
  fresh.forEach(d => { d.color='green'; d.tagged=true; });
  await Promise.resolve();
  h.api.relabelDocsForFile(f.id, classificationPatch());
  assert.deepEqual(fresh.map(markerValues), expected);
  assert.equal(h.writes.filter(w => w.patch.tagged === false).length, 197);
  assert.ok(h.writes.every(w => w.patch.color !== 'green' || [1,5,121].includes(fresh.find(d => d.id === w.id).pageNumber)));
  const saved = h.writes.length, rendered = h.renders.length;
  assert.equal(h.api.relabelDocsForFile(f.id, classificationPatch()), 0);
  assert.equal(h.writes.length, saved, 'identical cached relabel performs no cloud writes');
  assert.equal(h.renders.length, rendered, 'identical cached relabel performs no DOM rebuilds');
});

test('pipeline context and direct insertion apply the same page marker rules', () => {
  const h = harness(), f = h.file();
  h.helpers.state._pipelineCtx = {...classificationPatch(), pipelineClassification: 'APPLICATIONS'};
  const contextPages = [1,2,5,121,200].map(n => h.page(f,n));
  h.helpers.state._pipelineCtx = null;
  const directPages = [1,2,5,121,200].map(n => h.page(f,n,200,classificationPatch()));
  assert.deepEqual(contextPages.map(markerValues), directPages.map(markerValues));
  assert.equal(h.page(f, 32, 200, {color:'blue'}).tagged, true, 'manual page insertion keeps its explicit color');
  assert.equal(h.page(f, 32, 200, {...classificationPatch(), relabeledByUser:true, color:'blue'}).color, 'blue', 'explicit manual marking also wins on a classified inserted page');
});

test('multiple distinct labels on one start page produce one marker; duplicates are removed', () => {
  const h = harness(), f=h.file();
  const page = h.page(f, 5, 200, classificationPatch({sectionClassifications: [
    {tag:'GL Quote', section_hint:'page 5'}, {tag:'AL Quote', section_hint:'pages 5–8'},
    {tag:'GL Quote', section_hint:'page 5'}, {tag:'Later', section_hint:'pages 9–12'},
  ]}));
  assert.equal(page.pipelineTag, 'GL Quote · AL Quote');
  assert.equal(page.tagged, true);
  assert.equal(h.helpers.state.docs.length, 1);
});

test('unknown/invalid ranges retain one file marker and never mark arbitrary continuation pages', () => {
  const h=harness(), f=h.file();
  const patch=classificationPatch({sectionClassifications:[
    {tag:'Invalid',section_hint:'pages 0–3'}, {tag:'Reverse',section_hint:'pages 9–2'},
    {tag:'Outside',section_hint:'page 999'}, {tag:'Unlocated',section_hint:'GL coverage section'},
  ]});
  assert.equal(h.page(f,1,200,patch).pipelineTag,'Package');
  assert.equal(h.page(f,2,200,patch).tagged,false);
  assert.deepEqual(Array.from(h.helpers._parsePageRangeForChip('pages 199—999',200)),[199,200]);
});

test('manual color, removal, rename and category choices survive automatic rerouting', async () => {
  const h=harness(), f=h.file();
  const pages=[1,2,5,6].map(n=>h.page(f,n,200,classificationPatch()));
  await h.api.design.patch(pages[0].id,{tagged:false});
  h.helpers.setColor(pages[1].id,'blue');
  h.helpers.clearColor(pages[2].id);
  await h.api.design.patch(pages[3].id,{display_name:'Reviewed source',category:'underwriting'});
  const expected=pages.map(d=>[d.pipelineTag,d.color,d.tagged,d.displayName,d.category]);
  const writes=h.writes.length;
  h.api.relabelDocsForFile(f.id,classificationPatch({pipelineTag:'New automatic result',color:'red',category:'loss-history'}));
  assert.deepEqual(pages.map(d=>[d.pipelineTag,d.color,d.tagged,d.displayName,d.category]),expected);
  assert.equal(h.writes.length,writes);
  assert.ok(pages.every(d=>d.relabeledByUser));
  assert.ok(h.writes.every(w=>w.patch.relabeled_by_user === true));
});

test('explicit user file reclassification updates category/color and replaces prior automatic sections', () => {
  const h=harness(), f=h.file();
  const pages=[1,2,5].map(n=>h.page(f,n,200,classificationPatch()));
  h.window.docsViewMappingFor=(bucket)=>bucket==='LOSS_HISTORY'?{category:'loss-history',color:'red'}:{category:'all',color:null};
  h.api.relabelDocsForFile(f.id,{pipelineTag:'Loss History',primaryBucket:'LOSS_HISTORY',relabeledByUser:true});
  assert.deepEqual(pages.map(markerValues),[['Loss History','red',true],[null,null,false],[null,null,false]]);
  assert.ok(pages.every(d=>d.category==='loss-history'&&d.relabeledByUser));
});

test('relabel matching uses source identity and submission scope, including duplicate filenames', () => {
  const h=harness(), f=h.file(), duplicate=h.file('source-b',f.name);
  const linked=h.page(f,1), otherFile=h.page(duplicate,1), otherSubmission=h.page(f,1,200,{submissionId:'submission-b'});
  const ambiguous=h.page(f,1,200,{sourceFileId:null});
  linked.name='User-changed internal name'; linked.workbookFileName=null; linked.nativeFileName=null;
  h.api.relabelDocsForFile(f.id,classificationPatch());
  assert.equal(linked.pipelineTag,'ACORD 125');
  assert.equal(otherFile.pipelineTag,null);
  assert.equal(otherSubmission.pipelineTag,null);
  assert.equal(ambiguous.pipelineTag,null);
});

test('display revision is stable across save/hydrate bookkeeping and unrelated submissions', () => {
  const h=harness(), f=h.file();
  const page=h.page(f,1,200,classificationPatch());
  const before=h.api.design.revision();
  h.helpers.state._lastHydratedAt=Date.now(); h.helpers.state._hydrating=true;
  h.window.__STM_DOC_JOURNAL={revision:()=>42};
  h.page(f,2,200,{submissionId:'submission-b'});
  assert.equal(h.api.design.revision(),before);
  page.pipelineTag='Changed';
  assert.notEqual(h.api.design.revision(),before);
});

test('a late hydrate cannot overwrite a manual change made while its request was running', async () => {
  const h=harness(), f=h.file(), page=h.page(f,1,200,classificationPatch());
  await Promise.resolve(); await Promise.resolve();
  let resolveRows, started;
  const ready=new Promise(resolve=>started=resolve);
  h.window.sbFetchDocumentPages=()=>{started();return new Promise(resolve=>resolveRows=resolve);};
  const hydrate=h.api.refreshFromCloud({submissionId:'submission-a'});
  await ready;
  await h.api.design.patch(page.id,{display_name:'My reviewed name',tagged:false});
  resolveRows([{id:page.id,submission_id:'submission-a',display_name:'Old cloud name',tagged:true,color:'green',pipeline_tag:'ACORD 125'}]);
  await hydrate;
  assert.equal(page.displayName,'My reviewed name');
  assert.equal(page.tagged,false);
  assert.equal(page.relabeledByUser,true);
});

test('concurrent hydrate requests for different submissions each fetch their own scope', async () => {
  const h=harness();
  const requests=[];
  let release, started;
  const ready=new Promise(resolve=>started=resolve);
  h.window.sbFetchDocumentPages=async options=>{
    requests.push(options.submissionId);
    if(options.submissionId==='submission-a')await new Promise(resolve=>{release=resolve;started();});
    return [];
  };
  const a=h.api.refreshFromCloud({submissionId:'submission-a'});
  await ready;
  const b=h.api.refreshFromCloud({submissionId:'submission-b'});
  release();
  await Promise.all([a,b]);
  assert.deepEqual(requests,['submission-a','submission-b']);
});

test('intake reconciles a restored pushed flag with stored source pages before ingesting again', async () => {
  const h=harness(), f=h.file();
  f._rawFile={name:f.name}; f._pushedToDocsView=true; f.storagePath='owner/source.pdf';
  h.window.sbFetchDocumentPages=async()=>[{id:'stored-page',submission_id:'submission-a',display_name:'Renamed page',
    file_name:f.name,file_mime_type:'application/pdf',storage_path:f.storagePath,page_number:1,total_pages:1}];
  let ingested=0;
  h.api.processFileFromPipeline=async()=>{ingested++;return [];};
  await h.api.design.ingestIntake();
  assert.equal(ingested,0);
  assert.deepEqual(Array.from(f._stmDocIds),['stored-page']);
});

test('an actually missing source is re-ingested even if its old pushed flag was true', async () => {
  const h=harness(), f=h.file();
  f._rawFile={name:f.name}; f._pushedToDocsView=true;
  h.window.sbFetchDocumentPages=async()=>[];
  let ingested=0;
  h.api.processFileFromPipeline=async()=>{ingested++;return [h.page(f,1,1).id];};
  await h.api.design.ingestIntake();
  assert.equal(ingested,1);
  await h.api.design.ingestIntake();
  assert.equal(ingested,1,'subsequent scan reuses actual source rows');
});

test('manual tag coloring retains the classifier label, while an explicit rename supplies the label', async () => {
  const h=harness(),f=h.file(),page=h.page(f,1,200,classificationPatch());
  h.helpers.setColor(page.id,'blue');
  assert.equal(h.helpers.manualTaggedDisplayName8753(page),'');
  await h.api.design.patch(page.id,{display_name:'Reviewed GL quote'});
  assert.equal(h.helpers.manualTaggedDisplayName8753(page),'Reviewed GL quote');
});

test('manual ownership survives cloud reopen and protects a deliberately removed marker', async () => {
  const h=harness(),f=h.file();
  h.window.sbFetchDocumentPages=async()=>[{id:'manual-page',submission_id:f.submissionId,
    display_name:'Reviewed page',file_name:f.name,page_number:1,total_pages:200,
    pipeline_tag:'ACORD 125',color:null,tagged:false,relabeled_by_user:true}];
  await h.api.refreshFromCloud({submissionId:f.submissionId});
  assert.equal(h.api.relabelDocsForFile(f.id,classificationPatch()),0);
  const page=h.helpers.state.docs[0];
  assert.equal(page.tagged,false);
  assert.equal(page.color,null);
  assert.equal(page.relabeledByUser,true);
});

test('preview revision detects changed same-length content and stays stable for the same response', async () => {
  const h=harness(),f=h.file(),page=h.page(f,1,200,{textContent:'old'});
  const before=h.api.design.revision();
  h.window.sbFetchDocumentPageFull=async()=>({id:page.id,extracted_text:'new'});
  await h.api.design.load(page.id,true);
  assert.equal(h.api.design.page(page.id).text,'new');
  assert.notEqual(h.api.design.revision(),before);
  const loaded=h.api.design.revision();
  await h.api.design.load(page.id,true);
  assert.equal(h.api.design.revision(),loaded);
});
