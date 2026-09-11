/* Apply the PDF.js advisory workaround to every document opened by this app. */
(function(W){
 'use strict';const library=W.pdfjsLib;if(!library)return;
 const original=library.getDocument;
 W.pdfjsLib={...library,getDocument(source){
  const options=typeof source==='string'?{url:source}:source instanceof ArrayBuffer||ArrayBuffer.isView(source)?{data:source}:{...source};
  const task=original.call(library,{cMapUrl:new URL('vendor/pdfjs/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('vendor/pdfjs/standard_fonts/',location.href).href,wasmUrl:new URL('vendor/pdfjs/wasm/',location.href).href,iccUrl:new URL('vendor/pdfjs/iccs/',location.href).href,...options,isEvalSupported:false});
  // PDF6 moved document destruction to its loading task. Preserve the existing
  // cleanup contract so every parser/preview finally block releases its worker.
  if(task?.promise?.then)task.promise.then(doc=>{if(typeof doc.destroy!=="function")Object.defineProperty(doc,"destroy",{value:()=>task.destroy()});},()=>{});
  return task;
 }};
})(window);
