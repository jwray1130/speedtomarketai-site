/* The index selects the one real document page and its annotation canvas. */
window.STMNativeDocumentsUI=function(api){
 'use strict';const {state,config}=api,root=document.getElementById('docs-view-root'),$=id=>document.getElementById(id),esc=window.escapeHtml;
 let signature='',scheduled=false,loading=null,lastError='',expanded=false;
 const put=(id,text)=>{const e=$(id);if(e&&e.textContent!==String(text))e.textContent=String(text);};
 const design=()=>window.docsView.design;
 const attempt=fn=>Promise.resolve().then(fn).catch(e=>{lastError=e.message||String(e);renderStatus();window.toast?.(lastError,'error');});
 const group=d=>d.storagePath||d.sourceFileId||d.id;
 const active=()=>state.docs.find(d=>d.id===state.nativeSelectedId&&api.inScope(d))||null;
 const siblings=()=>{const doc=active();return doc?state.docs.filter(d=>api.inScope(d)&&group(d)===group(doc)).sort((a,b)=>(a.pageNumber||1)-(b.pageNumber||1)):[];};
 function renderStatus(){
  const s=design()?.status?.()||{},busy=window.__STM_DOCUMENT_IO?.busy;
  let text=lastError||s.error||s.localError||(busy?'Working on documents…':s.dirty?'Document changes waiting to sync':'Document changes saved');
  if(s.localError&&!text.includes(s.localError))text+=' · '+s.localError;
  if(s.recoveryNotice)text+=' · '+s.recoveryNotice;
  put('nativeDocSaveStatus',text);$('nativeDocSaveStatus').classList.toggle('error',!!(lastError||s.error||s.localError));
  $('nativeDocSave').disabled=!!busy||s.inFlight>0;$('nativeDocRefresh').disabled=!!busy||s.inFlight>0;
  const doc=active();for(const id of ['nativeDocSource','nativeDocPDF','nativeDocReload','nativeDocExpand'])$(id).disabled=!doc||!!busy;
  $('toolsBtn').disabled=!doc;const note=window.__docsAnno?.status?.();const warning=note?.warning||note?.error||'';$('nativeDocGeometryNotice').hidden=!warning;if(warning)put('nativeDocGeometryNotice',warning);
 }
 function renderTags(){const docs=state.docs.filter(d=>api.inScope(d)&&d.tagged&&(state.currentColorFilter==='all'||d.color===state.currentColorFilter));const list=$('tagsList');list.replaceChildren();for(const d of docs){const b=document.createElement('button');b.className='native-tag-row';b.type='button';b.dataset.nativePage=d.id;b.innerHTML='<span>'+esc(d.pipelineTag||d.displayName)+'</span><b>p. '+(d.pageNumber||1)+'</b>';list.append(b);}if(!docs.length)list.textContent='No tagged pages in this filter.';put('nativeTaggedCount',docs.length);put('tagsCount',docs.length);}
 function render(){
  const scoped=state.docs.filter(api.inScope),docs=api.filterDocs().filter(api.inScope);state.selectedIds=new Set([...state.selectedIds].filter(id=>scoped.some(d=>d.id===id)));
  if(state.searchQuery&&state.searchResults[state.searchIndex])state.nativeSelectedId=state.searchResults[state.searchIndex];
  if(!docs.some(d=>d.id===state.nativeSelectedId))state.nativeSelectedId=docs[0]?.id||null;
  const groups=new Map();for(const doc of docs){const key=(doc.category||'all')+':'+group(doc);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(doc);}
  const cats=[...new Set(docs.map(d=>d.category||'all'))];
  $('nativeDocIndex').innerHTML=cats.map(cat=>'<section class="native-index-section"><h3>'+esc(config.categories.find(c=>c.id===cat)?.name||cat)+'</h3>'+[...groups.values()].filter(g=>(g[0].category||'all')===cat).map(g=>'<div class="native-index-file"><div class="native-file-title">'+esc(g[0].workbookFileName||g[0].nativeFileName||g[0].displayName)+'</div><div class="native-index-pages">'+g.sort((a,b)=>(a.pageNumber||1)-(b.pageNumber||1)).map(d=>'<div class="native-index-page"><input type="checkbox" aria-label="Select '+esc(d.displayName)+'" data-native-select="'+esc(d.id)+'" '+(state.selectedIds.has(d.id)?'checked':'')+'><button type="button" data-native-page="'+esc(d.id)+'" class="'+(d.id===state.nativeSelectedId?'active':'')+'"><span>'+esc(d.pipelineTag||d.displayName)+(d.tagged?' · Tagged':'')+'</span><i></i><b>p. '+(d.pageNumber||1)+'</b></button></div>').join('')+'</div></div>').join('')+'</section>').join('')||'<div class="native-index-empty">'+esc(state._lastHydrateError?'Documents could not be loaded. Use Refresh from cloud to retry.':state._hydrating?'Loading documents…':state.searchQuery?'No documents match this search.':'No documents in this submission. Upload a file to begin.')+'</div>';
  const files=new Set(scoped.map(group)).size;put('nativeDocCounts',files+' files · '+scoped.length+' pages · '+scoped.filter(d=>d.tagged).length+' tagged pages');put('dvDocsCount',docs.length);put('totalDocs',scoped.length);put('totalTagged',scoped.filter(d=>d.tagged).length);api.renderCategories();api.updateTagsCount();api.updateBulkBar();renderTags();
  const doc=active(),sibs=siblings(),pos=sibs.findIndex(d=>d.id===doc?.id);put('nativeDocPageTitle',doc?.displayName||'Select a document');put('nativeDocPageTag',doc?(doc.pipelineTag||config.categories.find(c=>c.id===doc.category)?.name||'Document'):'Selected page');put('nativeDocPageNumber',doc?(doc.pageNumber||1)+' / '+(doc.totalPages||sibs.length):'0 / 0');$('nativeDocPrevious').disabled=pos<=0;$('nativeDocNext').disabled=pos<0||pos>=sibs.length-1;
  const next=doc?[doc.id,doc.highResData||doc.thumbnailData||'',doc.htmlContent||'',doc.textContent||''].join('\u0001'):'';
  if(next!==signature||!$('docsList').querySelector('.doc-item')&&doc){
   if(window.__docsAnno?.currentDocId===doc?.id)window.__docsAnno?.commit?.();signature=next;const list=$('docsList'),empty=$('docsEmpty');list.replaceChildren(empty);empty.style.display=doc?'none':'';
   if(doc){const item=api.buildDocItem(doc);list.append(item);requestAnimationFrame(()=>window.__docsAnno?.ensureCanvas?.(item.querySelector('.doc-thumb'),doc.id));}
  }else if(doc){const name=$('docsList').querySelector('[data-doc-name]');if(name&&!name.querySelector('input'))name.textContent=doc.displayName;$('docsList').querySelector('.doc-tag-btn')?.classList.toggle('active',!!doc.tagged);}
  window.refreshActiveSubmissionDocsCount?.();renderStatus();
  if(doc&&!doc._nativeFullLoaded&&!doc._nativeLoadAttempted&&!loading&&window.currentUser)void load(doc.id,false);
 }
 async function load(id,force){loading=id;try{await design().load(id,force);lastError='';}catch(e){lastError=e.message||String(e);}finally{if(loading===id)loading=null;if(active()?.id===id){const doc=active();if(doc&&!doc._nativeFullLoaded)doc._nativeLoadAttempted=true;renderStatus();if(!lastError)render();}}}
 async function open(id){const doc=api.requireDoc(id);window.__docsAnno?.commit?.();state.nativeSelectedId=doc.id;const i=state.searchResults.indexOf(id);if(i>=0)state.searchIndex=i;lastError='';render();if(!doc._nativeFullLoaded)await load(id,false);}
 function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;renderStatus();});}
 root.addEventListener('click',e=>{const p=e.target.closest('[data-native-page]');if(p){e.preventDefault();attempt(()=>open(p.dataset.nativePage));}const nav=e.target.closest('[data-native-doc-route]');if(nav)attempt(()=>window.__STM_NATIVE_PLATFORM.navigate(nav.dataset.nativeDocRoute));});
 root.addEventListener('change',e=>{if(e.target.matches('[data-native-select]')){const id=e.target.dataset.nativeSelect;api.requireDoc(id);if(e.target.checked)state.selectedIds.add(id);else state.selectedIds.delete(id);api.updateBulkBar();}});
 $('nativeDocPrevious').onclick=()=>attempt(()=>{const ds=siblings(),i=ds.findIndex(d=>d.id===active()?.id);if(i>0)return open(ds[i-1].id);});
 $('nativeDocNext').onclick=()=>attempt(()=>{const ds=siblings(),i=ds.findIndex(d=>d.id===active()?.id);if(i>=0&&i<ds.length-1)return open(ds[i+1].id);});
 $('nativeDocExpand').onclick=()=>{expanded=!expanded;root.querySelector('.native-doc-viewer').classList.toggle('expanded',expanded);$('nativeDocExpand').ariaLabel=expanded?'Close expanded viewer':'Expand viewer';requestAnimationFrame(()=>window.__docsAnno?.ensureCanvas?.($('docsList').querySelector('.doc-thumb'),active()?.id));};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&expanded){expanded=false;root.querySelector('.native-doc-viewer').classList.remove('expanded');}});
 $('nativeDocReload').onclick=()=>attempt(async()=>{if(active())await load(active().id,true);});
 $('nativeDocSource').onclick=()=>attempt(()=>design().download([active().id]));
 $('nativeDocPDF').onclick=()=>attempt(()=>design().exportPages([active().id]));
 $('nativeDocSave').onclick=()=>attempt(async()=>{lastError='';await window.__STM_NATIVE_PLATFORM.save();renderStatus();});
 $('nativeDocRefresh').onclick=()=>attempt(async()=>{lastError='';await design().refresh();render();});
 window.addEventListener('stm:documents-change',schedule);window.addEventListener('stm:platform-change',schedule);
 return {render,renderTags,renderStatus,open,active,refreshPage(){signature='';render();},clear(){loading=null;lastError='';signature='';state.nativeSelectedId=null;render();}};
};
