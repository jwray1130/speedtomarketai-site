/* Complete annotation text on clearly announced continuation pages. */
(function(W){
 'use strict';
 const WIDTH=816,HEIGHT=1056,MARGIN=40,LINE=20,BODY_START=110,BODY_END=985;
 function wrapped(ctx,text,width){
  const result=[],segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
  for(const paragraph of text.replace(/\r\n?/g,'\n').split('\n')){
   let line='';const chars=segmenter?Array.from(segmenter.segment(paragraph),x=>x.segment):Array.from(paragraph);
   for(const c of chars){if(line&&ctx.measureText(line+c).width>width){result.push(line);line='';}line+=c;}result.push(line);
  }return result;
 }
 function plan({doc,layers,warnings,maxPages=100,makeCanvas=()=>document.createElement('canvas')}){
  if(!Array.isArray(warnings))throw Error('Invalid export warnings');
  const indexes=[...new Set(warnings.map(w=>w.layer))];
  const measure=makeCanvas(),ctx=measure.getContext('2d');if(!ctx)throw Error('Annotation continuation renderer unavailable');ctx.font='14px Arial, sans-serif';
  const pages=[],capacity=Math.floor((BODY_END-BODY_START)/LINE);
  for(const index of indexes){
   const layer=layers[index];if(!Number.isInteger(index)||!layer||!['text','sticky'].includes(layer.type)||typeof layer.text!=='string')throw Error('An export warning cannot be resolved to annotation text');
   const lines=wrapped(ctx,layer.text,WIDTH-2*MARGIN);
   const count=Math.max(1,Math.ceil(lines.length/capacity));
   if(pages.length+count>maxPages)throw Error('Full annotation text needs more than '+maxPages+' continuation pages. Export fewer source pages at a time.');
   for(let part=0;part<count;part++)pages.push({sourcePage:doc.pageNumber||1,sourceName:String(doc.displayName||doc.name||'Document'),layerIndex:index,kind:layer.type==='sticky'?'Note':'Text annotation',part:part+1,parts:count,lines:lines.slice(part*capacity,(part+1)*capacity)});
  }
  measure.width=measure.height=1;return pages;
 }
 function render(page,{makeCanvas=()=>document.createElement('canvas'),scale=1.5}={}){
  const canvas=makeCanvas();canvas.width=Math.round(WIDTH*scale);canvas.height=Math.round(HEIGHT*scale);const c=canvas.getContext('2d');if(!c)throw Error('Annotation continuation renderer unavailable');c.scale(scale,scale);c.fillStyle='#fff';c.fillRect(0,0,WIDTH,HEIGHT);c.fillStyle='#1b2430';c.textBaseline='top';
  c.font='700 17px Arial, sans-serif';c.fillText('Complete annotation text',MARGIN,32);
  c.font='12px Arial, sans-serif';const titles=wrapped(c,page.sourceName,WIDTH-2*MARGIN);c.fillText(titles[0]||'Document',MARGIN,59);
  // Long filenames are metadata, not annotation content. Preserve a clear
  // source-page and annotation identity even when only first title line fits.
  c.fillText('Source page '+page.sourcePage+' · '+page.kind+' '+(page.layerIndex+1)+' · part '+page.part+' of '+page.parts,MARGIN,79);
  c.font='14px Arial, sans-serif';for(let i=0;i<page.lines.length;i++)c.fillText(page.lines[i],MARGIN,BODY_START+i*LINE);
  c.font='11px Arial, sans-serif';c.fillStyle='#596171';c.fillText('Full text from an annotation that extends beyond its source page.',MARGIN,1015);
  return canvas;
 }
 async function appendToPdf(pdf,pages,{assertCurrent=()=>{},makeCanvas,scale=1.5}={}){
  for(const page of pages){
   assertCurrent();const canvas=render(page,{makeCanvas,scale});
   try{pdf.addPage([612,792],'portrait');pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,612,792);}finally{canvas.width=canvas.height=1;}
   // Yield to actual input/auth events between pages, then validate ownership.
   await new Promise(requestAnimationFrame);assertCurrent();
  }return pages.length;
 }
 const api={plan,render,appendToPdf};if(typeof module==='object'&&module.exports)module.exports=api;else W.STMAnnotationContinuations=api;
})(typeof globalThis==='object'?globalThis:window);
