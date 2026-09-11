/* Shared canvas composition for the native editor and complete PDF exports. */
(function (scope) {
  'use strict';
  const TYPES = new Set(['pen','highlighter','eraser','rectangle','ellipse','arrow','line','text','sticky']);
  const MAX_PIXELS = 32 * 1024 * 1024;
  const num = (v, name, min = -1e7, max = 1e7) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error('Invalid annotation ' + name);
    return v;
  };
  function color(v) {
    if (typeof v !== 'string' || v.length > 80 || !v.trim()) throw new Error('Invalid annotation color');
    const valid = scope.CSS?.supports ? scope.CSS.supports('color', v) : /^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(v);
    if (!valid) throw new Error('Invalid annotation color');
    return v;
  }
  function validateLayer(l) {
    if (!l || typeof l !== 'object' || Array.isArray(l) || !TYPES.has(l.type)) throw new Error('Unsupported or malformed annotation layer');
    if (['pen','highlighter','eraser'].includes(l.type)) {
      if (!Array.isArray(l.path) || l.path.length > 100000) throw new Error('Invalid annotation path');
      for (const p of l.path) { if (!p || typeof p !== 'object') throw new Error('Invalid annotation point'); num(p.x,'path.x'); num(p.y,'path.y'); }
      if (l.type === 'eraser') num(l.radius,'radius',0.01,10000);
      else { color(l.color); num(l.width,'width',0.01,10000); if (l.opacity !== undefined) num(l.opacity,'opacity',0,1); }
    } else if (['rectangle','ellipse','arrow','line'].includes(l.type)) {
      for (const k of ['x1','y1','x2','y2']) num(l[k],k);
      color(l.color); num(l.width,'width',0.01,10000);
      if (l.fill !== undefined && typeof l.fill !== 'boolean') throw new Error('Invalid annotation fill');
    } else {
      num(l.x,'x'); num(l.y,'y');
      if (typeof l.text !== 'string' || l.text.length > 100000) throw new Error('Invalid annotation text');
      if (l.type === 'text') { color(l.color); num(l.width,'text width',0.01,32768); num(l.height,'text height',0.01,32768); num(l.fontSize,'font size',1,1000); }
    }
  }
  function arrow(c,l) {
    const angle=Math.atan2(l.y2-l.y1,l.x2-l.x1), head=Math.max(10,l.width*3);
    c.beginPath(); c.moveTo(l.x1,l.y1); c.lineTo(l.x2,l.y2); c.stroke();
    c.beginPath(); c.moveTo(l.x2,l.y2);
    c.lineTo(l.x2-head*Math.cos(angle-Math.PI/6),l.y2-head*Math.sin(angle-Math.PI/6));
    c.lineTo(l.x2-head*Math.cos(angle+Math.PI/6),l.y2-head*Math.sin(angle+Math.PI/6));
    c.closePath(); c.fill();
  }
  function drawing(c,l) {
    if (l.type === 'text' || l.type === 'sticky') return;
    c.save(); c.lineCap='round'; c.lineJoin='round';
    if (l.type === 'eraser') {
      c.globalCompositeOperation='destination-out';
      for(const p of l.path) { c.beginPath(); c.arc(p.x,p.y,l.radius,0,Math.PI*2); c.fill(); }
    } else if (l.type === 'pen' || l.type === 'highlighter') {
      c.strokeStyle=l.color; c.lineWidth=l.width; c.globalAlpha=l.opacity ?? 1;
      c.beginPath();
      if(l.path.length) { c.moveTo(l.path[0].x,l.path[0].y); for(const p of l.path.slice(1)) c.lineTo(p.x,p.y); }
      c.stroke();
    } else {
      c.strokeStyle=l.color; c.fillStyle=l.color; c.lineWidth=l.width;
      if(l.type==='rectangle') {
        const x=Math.min(l.x1,l.x2),y=Math.min(l.y1,l.y2),w=Math.abs(l.x2-l.x1),h=Math.abs(l.y2-l.y1);
        if(l.fill) { c.globalAlpha=.25; c.fillRect(x,y,w,h); c.globalAlpha=1; } c.strokeRect(x,y,w,h);
      } else if(l.type==='ellipse') {
        c.beginPath(); c.ellipse((l.x1+l.x2)/2,(l.y1+l.y2)/2,Math.abs(l.x2-l.x1)/2,Math.abs(l.y2-l.y1)/2,0,0,Math.PI*2);
        if(l.fill) { c.globalAlpha=.25; c.fill(); c.globalAlpha=1; } c.stroke();
      } else if(l.type==='arrow') arrow(c,l);
      else { c.beginPath(); c.moveTo(l.x1,l.y1); c.lineTo(l.x2,l.y2); c.stroke(); }
    }
    c.restore();
  }
  // Preserve explicit newlines and spaces, wrapping long tokens by grapheme.
  // This is deliberately independent from jsPDF's font/Unicode text support.
  function wrap(c,text,maxWidth) {
    const lines=[];
    const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined,{granularity:'grapheme'}) : null;
    for(const paragraph of text.replace(/\r\n?/g,'\n').split('\n')) {
      let line='';
      const chars=segmenter ? Array.from(segmenter.segment(paragraph),v=>v.segment) : Array.from(paragraph);
      for(const ch of chars) {
        if(line && c.measureText(line+ch).width > maxWidth) { lines.push(line); line=''; }
        line+=ch;
      }
      lines.push(line);
    }
    return lines;
  }
  function textOverlay(c,l,reference,warnings,index) {
    c.save(); c.textBaseline='top';
    let x,y,w,lines,step,bottom;
    if(l.type==='text') {
      // Border 2 + left padding 6; border 2 + committed strip 3 + top padding 4.
      c.fillStyle=l.color; c.font='500 '+l.fontSize+'px Arial, sans-serif';
      x=l.x+8; y=l.y+9; w=Math.max(1,l.width-16); step=l.fontSize*1.3;
      lines=wrap(c,l.text,w); bottom=y+lines.length*step;
    } else {
      c.font='11px Arial, sans-serif'; step=15.4; w=126;
      lines=wrap(c,l.text,w); x=l.x+7; y=l.y+27;
      const body=Math.min(120,Math.max(40,lines.length*step+12)),h=21+body;
      c.fillStyle='#FEF3C7'; c.fillRect(l.x,l.y,140,h);
      c.fillStyle='rgba(245,158,11,.2)'; c.fillRect(l.x,l.y,140,21);
      c.strokeStyle='#F59E0B'; c.lineWidth=1; c.strokeRect(l.x+.5,l.y+.5,139,h-1);
      c.fillStyle='#92400e'; c.font='700 9px monospace'; c.fillText('NOTE',l.x+7,l.y+6);
      c.fillStyle='#78350f'; c.font='11px Arial, sans-serif'; bottom=l.y+h;
    }
    for(let i=0;i<lines.length;i++)if(l.type!=='sticky'||i*step+step<=108)c.fillText(lines[i],x,y+i*step);
    if(l.x<0 || l.y<0 || x+Math.max(w,...lines.map(line=>c.measureText(line).width))>reference.width || bottom>reference.height || (l.type==='sticky'&&lines.length*step>108)) {
      warnings.push({layer:index,type:l.type,message:'Annotation text extends outside the exported page. Reposition it or provide a note continuation before calling the export complete.'});
    }
    c.restore();
  }
  function compose(options) {
    const {background,reference,layers}=options;
    if(!background || !reference) throw new Error('A prepared source page and explicit annotation reference plane are required');
    const rw=num(reference.width,'reference width',1,32768),rh=num(reference.height,'reference height',1,32768);
    if(!Array.isArray(layers) || layers.length>10000) throw new Error('Invalid annotation layer list');
    layers.forEach(validateLayer);
    const scale=num(options.scale ?? 2,'export scale',.1,8),width=Math.round(rw*scale),height=Math.round(rh*scale);
    if(!width || !height || width>16384 || height>16384 || width*height>MAX_PIXELS) throw new Error('Page raster exceeds the export size limit');
    const make=options.makeCanvas || (()=>scope.document.createElement('canvas'));
    const output=make(),overlay=make(); output.width=overlay.width=width; output.height=overlay.height=height;
    const out=output.getContext('2d'),draw=overlay.getContext('2d');
    if(!out || !draw) throw new Error('Canvas rendering is unavailable');
    const r=options.backgroundRect || {x:0,y:0,width:rw,height:rh};
    num(r.x,'background x'); num(r.y,'background y'); num(r.width,'background width',.01,32768); num(r.height,'background height',.01,32768);
    out.fillStyle='#ffffff'; out.fillRect(0,0,width,height);
    out.save(); out.scale(width/rw,height/rh); out.drawImage(background,r.x,r.y,r.width,r.height); out.restore();
    // Eraser touches only this transparent annotation plane, never the source.
    draw.scale(width/rw,height/rh); layers.forEach(l=>drawing(draw,l));
    out.drawImage(overlay,0,0);
    // DOM overlay ordering in July: every text/sticky is above every stroke.
    const warnings=[]; out.save(); out.scale(width/rw,height/rh);
    layers.forEach((l,i)=>{if(l.type==='text'||l.type==='sticky')textOverlay(out,l,reference,warnings,i);});
    out.restore(); overlay.width=overlay.height=1;
    return {canvas:output,warnings};
  }
  // Shared editor/export stroke renderer. The canvas's backing dimensions may
  // include DPR or export scale; reference coordinates remain unchanged.
  function paintDrawingLayers(canvas,layers,reference) {
    num(reference?.width,'reference width',1,32768); num(reference?.height,'reference height',1,32768);
    if(!Array.isArray(layers) || layers.length>10000) throw new Error('Invalid annotation layer list');
    layers.forEach(validateLayer);
    const c=canvas.getContext('2d'); if(!c) throw new Error('Canvas rendering is unavailable');
    c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,canvas.width,canvas.height);
    c.save(); c.scale(canvas.width/reference.width,canvas.height/reference.height);
    layers.forEach(l=>drawing(c,l)); c.restore();
    return canvas;
  }
  const api={compose,validateLayer,paintDrawingLayers};
  if(typeof module==='object' && module.exports) module.exports=api;
  else scope.STMAnnotationCompositor=api;
})(typeof globalThis==='object'?globalThis:window);
