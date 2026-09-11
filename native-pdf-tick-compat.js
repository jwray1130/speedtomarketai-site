/* PDF drawing representation adapter for the unchanged July tick detector. */
window.__STM_NORMALIZE_PDF_TICKS=function normalizeTickOperatorList(list, OPS){
 if(!list||!Array.isArray(list.fnArray)||!Array.isArray(list.argsArray)||list.fnArray.length!==list.argsArray.length)throw Error('Unsupported PDF operator-list structure.');
 const seq=v=>Array.isArray(v)||(ArrayBuffer.isView(v)&&typeof v.length==='number');
 const numeric=v=>typeof v==='number'&&Number.isFinite(v);
 const closedPaint=new Set([OPS.closeStroke,OPS.closeFillStroke,OPS.closeEOFillStroke].filter(Number.isInteger));
 const argsArray=list.argsArray.map((args,index)=>{
  if(list.fnArray[index]!==OPS.constructPath)return args;
  if(!Array.isArray(args)||args.length<2)throw Error('Unsupported PDF path arguments.');
  // Preserve July representation; the detector itself owns its old semantics.
  if(seq(args[0])&&seq(args[1]))return args;
  if(!Number.isInteger(args[0])||!Array.isArray(args[1])||args[1].length!==1)throw Error('Unsupported PDF.js drawing representation.');
  const paint=args[0],stream=args[1][0];
  if(stream===null&&args[2]===null)return [[],[],null];
  // The canvas renderer can replace stream with Path2D. Reject such opaque
  // data rather than inventing checkmarks from a bounding rectangle.
  if(!seq(stream))throw Error('PDF path data is unavailable after rendering.');
  const codes=[],coords=[];
  for(let i=0;i<stream.length;){
   const code=stream[i++];let count,old;
   if(code===0){count=2;old=OPS.moveTo;}
   else if(code===1){count=2;old=OPS.lineTo;}
   else if(code===2){count=6;old=OPS.curveTo;}
   // July ignores curve coordinates and marks the subpath non-linear.
   // curveTo2 has the same four-value arity; this is analysis-only encoding.
   else if(code===3){count=4;old=OPS.curveTo2;}
   else if(code===4){count=0;old=OPS.closePath;}
   else throw Error('Unknown PDF.js draw opcode.');
   if(!Number.isInteger(old)||i+count>stream.length)throw Error('Truncated PDF.js draw command.');
   codes.push(old);
   for(let k=0;k<count;k++){const value=stream[i++];if(!numeric(value))throw Error('Non-finite PDF.js path coordinate.');coords.push(value);}
  }
  // PDF.js6 materializes the implicit close from s/b/b*. July ignores paint
  // operators, so remove exactly that synthetic terminal close for parity.
  // An explicit h preceding s survives as the previous close and is rejected.
  if(closedPaint.has(paint)&&codes.at(-1)===OPS.closePath)codes.pop();
  return [codes,coords,args[2]];
 });
 return {...list,argsArray};
};
