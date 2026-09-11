/* Shared content-driven HTML paper layout for the viewer and PDF encoding. */
(function(W){
 'use strict';
 const PAPER_WIDTH=816,MIN_HEIGHT=1056,MAX_HEIGHT=32768;
 const clone=x=>JSON.parse(JSON.stringify(x,(k,v)=>k==='el'?undefined:v));
 function preparePaper(paper){
  Object.assign(paper.style,{position:'absolute',left:'0',top:'0',width:PAPER_WIDTH+'px',height:'auto',minHeight:MIN_HEIGHT+'px',maxHeight:'none',overflow:'visible',boxSizing:'border-box',transformOrigin:'0 0'});
  // Apply the SAME rules in the viewer and export. Long tokens/cells must
  // increase height rather than silently disappear outside the paper width.
  for(const pre of paper.querySelectorAll('pre'))Object.assign(pre.style,{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxWidth:'100%'});
  for(const table of paper.querySelectorAll('table'))Object.assign(table.style,{width:'100%',tableLayout:'fixed',maxWidth:'100%'});
  for(const cell of paper.querySelectorAll('td,th'))Object.assign(cell.style,{overflowWrap:'anywhere',wordBreak:'break-word'});
  for(const image of paper.querySelectorAll('img')){image.style.maxWidth='100%';image.style.height='auto';}
 }
 function layoutHtmlPaper(element){
  const paper=element?.matches?.('.doc-thumb-word-page')?element:element?.querySelector?.('.doc-thumb-word-page');
  if(!paper)return null;const wrap=paper.parentElement;
  if(!wrap?.isConnected||wrap.clientWidth<10)return null;
  preparePaper(paper);
  // offsetHeight/scrollHeight are untransformed CSS coordinates. A height:auto
  // paper can grow/shrink naturally; only its scaled wrapper has explicit height.
  const height=Math.max(MIN_HEIGHT,Math.ceil(paper.offsetHeight),Math.ceil(paper.scrollHeight));
  if(!Number.isFinite(height)||height>MAX_HEIGHT)throw Error('This document page is too tall to render completely. Split its content into additional pages before exporting.');
  const scale=wrap.clientWidth/PAPER_WIDTH;
  Object.assign(wrap.style,{position:'relative',aspectRatio:'auto',height:(height*scale)+'px',overflow:'visible'});
  paper.style.transform='scale('+scale+')';
  return {width:PAPER_WIDTH,height,scale,referenceWidth:wrap.clientWidth,referenceHeight:height*scale};
 }
 function bindHtmlPaper(element,onLayout,onError){
  const paper=element?.matches?.('.doc-thumb-word-page')?element:element?.querySelector?.('.doc-thumb-word-page');
  if(!paper)return()=>{};const wrap=paper.parentElement;let frame=0,disposed=false,last='';
  const schedule=()=>{if(frame||disposed)return;frame=requestAnimationFrame(()=>{frame=0;if(!wrap.isConnected){dispose();return;}try{const value=layoutHtmlPaper(paper);if(value){const key=value.width+':'+value.height+':'+value.scale;if(key!==last){last=key;onLayout?.(value);}}}catch(e){onError?.(e);}});};
  const ro=W.ResizeObserver?new ResizeObserver(schedule):null;ro?.observe(wrap);ro?.observe(paper);
  const mo=new MutationObserver(schedule);mo.observe(paper,{childList:true,subtree:true,characterData:true});
  const images=Array.from(paper.querySelectorAll('img'));for(const img of images){img.addEventListener('load',schedule);img.addEventListener('error',schedule);}
  document.fonts?.ready?.then(schedule);schedule();
  function dispose(){if(disposed)return;disposed=true;if(frame)cancelAnimationFrame(frame);ro?.disconnect();mo.disconnect();for(const img of images){img.removeEventListener('load',schedule);img.removeEventListener('error',schedule);}}
  return dispose;
 }
 async function renderHtmlBackground({root,doc,sanitize,assertCurrent,html2canvas=W.html2canvas}){
  if(!root?.isConnected||!root.getClientRects().length)throw Error('Open Documents before exporting this page.');
  if(typeof html2canvas!=='function')throw Error('The document PDF renderer is unavailable.');
  assertCurrent();
  const content=typeof doc.htmlContent==='string'?doc.htmlContent:'';
  const text=typeof doc.ocrText==='string'&&doc.ocrText?doc.ocrText:typeof doc.textContent==='string'?doc.textContent:'';
  if(!content&&!text.trim())throw Error('No readable content is available for '+(doc.displayName||'this page')+'. Download its original source or restore the page content.');
  // A temporary, inert encoder surface under the real CSS scope. It is removed
  // in finally. Never construct buildDocItem here: that installs editing and
  // loading handlers and would create a second application surface.
  const host=document.createElement('div');host.className='native-document-export-host';host.inert=true;host.setAttribute('aria-hidden','true');
  host.style.cssText='position:fixed;left:-20000px;top:0;width:816px;pointer-events:none;';
  const wrap=document.createElement('div');wrap.className='doc-thumb-word';wrap.style.width='816px';
  const paper=document.createElement('div');paper.className='doc-thumb-word-page'+(doc.type==='word'?'':' doc-thumb-'+String(doc.type||'text').replace(/[^a-z0-9-]/gi,''));
  if(content)paper.innerHTML=sanitize(content);else{const pre=document.createElement('pre');pre.textContent=text;paper.append(pre);}
  wrap.append(paper);host.append(wrap);root.append(host);
  try{
   preparePaper(paper);
   for(const image of paper.querySelectorAll('img')){
    const source=image.getAttribute('src')||'';
    if(!/^(data:image\/(?:png|jpeg|gif|webp|bmp);base64,|blob:)/i.test(source))throw Error('An image in '+(doc.displayName||'this page')+' is not embedded. Restore the source image before exporting.');
   }
   await Promise.all(Array.from(paper.querySelectorAll('img'),image=>image.complete&&image.naturalWidth?Promise.resolve():image.decode()));assertCurrent();
   if(document.fonts?.ready){await document.fonts.ready;assertCurrent();}
   const size=layoutHtmlPaper(paper);if(!size)throw Error('The document export page could not be measured.');
   // The 816px export wrapper produces scale=1. The CSS/type/padding/table
   // styles are identical to the actual viewer's underlying 816px paper.
   const canvas=await html2canvas(paper,{backgroundColor:'#ffffff',scale:1,width:size.width,height:size.height,logging:false,useCORS:false});assertCurrent();
   if(!canvas.width||!canvas.height)throw Error('The document export page is empty.');
   return canvas;
  }finally{host.remove();}
 }
 function snapshotPages(ids,requireDoc,stores,validateLayer){
  if(!Array.isArray(ids)||!ids.length)throw Error('Select at least one page.');
  if(new Set(ids).size!==ids.length)throw Error('The export contains duplicate page selections.');
  return ids.map(id=>{
   const original=requireDoc(id),doc={...original},raw=stores[id]||{layers:[],undone:[]},store=clone(raw);
   if(!Array.isArray(store.layers)||!Array.isArray(store.undone))throw Error('Invalid annotations for '+doc.displayName);
   store.layers.forEach(validateLayer);
   if(store.layers.length&&store.schema!==2)throw Error('Open '+doc.displayName+' and review its older annotation placement before exporting.');
   if(store.schema===2)for(const k of ['baseWidth','baseHeight'])if(typeof store[k]!=='number'||!Number.isFinite(store[k])||store[k]<1||store[k]>32768)throw Error('Invalid annotation dimensions for '+doc.displayName);
   // Source strings and metadata are captured together in one synchronous
   // turn. Background code may populate caches on this private doc object.
   return {id,doc,store};
  });
 }
 function revisionGuard(readRevision,assertCurrent){
  const revision=readRevision();
  return()=>{assertCurrent();if(readRevision()!==revision)throw Error('Documents changed while preparing the PDF. Finish the edit and export again.');};
 }
 function assertCompleteComposition(composed,doc){
  if(composed.warnings?.length){const types=[...new Set(composed.warnings.map(w=>w.type==='sticky'?'note':'text annotation'))].join(' or ');throw Error('A '+types+' on '+(doc.displayName||'this page')+' extends beyond the page. Move or shorten it, or enable annotation continuation pages, before exporting.');}
 }
 const api={layoutHtmlPaper,bindHtmlPaper,renderHtmlBackground,snapshotPages,revisionGuard,assertCompleteComposition};
 if(typeof module==='object'&&module.exports)module.exports=api;else W.STMDocumentExportLayout=api;
})(typeof globalThis==='object'?globalThis:window);
