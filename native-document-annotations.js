/* Native annotation editor using the shared page compositor. */
(function(global){
  'use strict';
  const TOOLS=new Set(['pointer','pen','highlighter','rectangle','ellipse','arrow','line','text','sticky','eraser']);
  const KEYS={v:'pointer',p:'pen',h:'highlighter',u:'rectangle',o:'ellipse',a:'arrow',l:'line',t:'text',n:'sticky',e:'eraser'};
  const isObject=v=>v && typeof v==='object' && !Array.isArray(v);
  const clone=v=>JSON.parse(JSON.stringify(v,(k,x)=>k==='el'?undefined:x));
  function STMNativeAnnotations({state,root,activeDoc,requireDoc,persist,preview,notify}){
    if(!state || !root || typeof activeDoc!=='function' || typeof requireDoc!=='function' || typeof persist!=='function') throw new Error('Annotation adapters are incomplete');
    const renderer=global.STMAnnotationCompositor;
    if(!renderer?.paintDrawingLayers || !renderer?.validateLayer) throw new Error('The annotation renderer is unavailable');
    const a=state.annotations ||= {};
    a.store ||= {}; a.tool=TOOLS.has(a.tool)?a.tool:'pointer'; a.color ||= '#F87171';
    a.strokeWidth ||= 4; a.opacity ??= .15; a.fontSize ||= 18; a.fill=!!a.fill;
    let mounted=null,gesture=null,selected=null,retired=false,destroyed=false,sequence=0;
    const unlisten=[],pending=new Set(),dirty=new Map(),failures=new Map(),revisions=new Map(),warned=new Set();
    const history=new Map(),future=new Map();
    let textHistory=null;
    const $=id=>root.querySelector('#'+id), $$=s=>Array.from(root.querySelectorAll(s));
    const editableText=el=>el.innerText??el.textContent??'';
    const docId=()=>{const d=activeDoc();return typeof d==='string'?d:d?.id||null;};
    function emit(type,id,message){try{notify?.({type,docId:id||null,message:message||'',status:status()});}catch(e){console.warn('Annotation notification failed',e);}}
    function owned(id){if(retired||destroyed)throw new Error('The annotation editor is retired');if(!id||id!==docId())throw new Error('Select this page before editing it');requireDoc(id);return id;}
    function visible(){return !retired&&!destroyed&&root.isConnected&&root.getClientRects().length>0&&!!docId();}
    function listen(el,name,handler,opts){if(!el)return;el.addEventListener(name,handler,opts);unlisten.push(()=>el.removeEventListener(name,handler,opts));}
    function uid(){return global.crypto?.randomUUID?.() || 'annotation-'+Date.now()+'-'+(++sequence);}
    function dimensions(thumb){const w=thumb.clientWidth,h=thumb.clientHeight;if(w<10||h<10)throw new Error('The page must be visible before annotating');return {width:Math.round(w),height:Math.round(h)};}
    function normalize(id,reference){
      let s=a.store[id];
      if(s===undefined)s={layers:[],undone:[]};
      if(!isObject(s)||!Array.isArray(s.layers)||!Array.isArray(s.undone)||s.layers.length+s.undone.length>10000)throw new Error('This page has malformed annotation data');
      [...s.layers,...s.undone].forEach(renderer.validateLayer);
      if(s.schema!==undefined&&s.schema!==1&&s.schema!==2)throw new Error('This page has an unsupported annotation schema');
      if(s.schema===2){
        for(const k of ['baseWidth','baseHeight'])if(typeof s[k]!=='number'||!Number.isFinite(s[k])||s[k]<1||s[k]>32768)throw new Error('This page has invalid annotation geometry');
      }else{
        if(!reference)throw new Error('Legacy annotations require a visible reference plane');
        s={...clone(s),schema:2,baseWidth:reference.width,baseHeight:reference.height,legacyGeometryAssumed:!!(s.layers.length||s.undone.length)};
      }
      // Persistable state never retains a detached DOM element reference.
      for(const l of [...s.layers,...s.undone]){delete l.el;if(!l.id)l.id=uid();}
      a.store[id]=s;
      if(s.legacyGeometryAssumed&&!warned.has(id)){
        warned.add(id);queueMicrotask(()=>{if(!destroyed&&id===docId())emit('warning',id,'These older annotations did not store page dimensions. Their placement uses the first visible page size; review it before exporting.');});
      }
      return s;
    }
    function store(id){owned(id);return normalize(id,a.store[id]?.schema===2?null:mounted?.id===id?dimensions(mounted.thumb):null);}
    function remember(id){const list=history.get(id)||[];list.push(clone(store(id).layers));if(list.length>50)list.shift();history.set(id,list);future.set(id,[]);textHistory=null;}
    function changed(id){
      owned(id);return journalSnapshot(id,clone(store(id)));
    }
    function journalSnapshot(id,snapshot){
      if(retired||destroyed)throw new Error('The annotation editor is retired');
      // Retry may concern another page in the SAME owned scope. Its immutable
      // dirty snapshot is authoritative; it must not select or mount that page.
      requireDoc(id);const rev=(revisions.get(id)||0)+1;
      revisions.set(id,rev);dirty.set(id,snapshot);failures.delete(id);updateIndicator(id);
      let result;
      // Deliberately invoke now, not from a debounce or promise callback. The
      // adapter journals this immutable snapshot before returning its promise.
      try{result=persist(id,snapshot);}catch(e){result=Promise.reject(e);}
      let p;
      p=Promise.resolve(result).then(ack=>{
        if(ack===false||ack===null)throw new Error('Annotation save was not acknowledged');
        if(revisions.get(id)===rev){dirty.delete(id);failures.delete(id);}
      }).catch(error=>{
        if(revisions.get(id)===rev)failures.set(id,error);
        if(revisions.get(id)===rev&&!retired&&!destroyed&&id===docId())emit('error',id,error?.message||'Annotation changes are unsaved');
      }).finally(()=>{pending.delete(p);if(!retired&&!destroyed&&id===docId())emit('save',id);});
      pending.add(p);emit('change',id);return p;
    }
    function status(){
      const errors=Array.from(failures,([id,e])=>({id,message:e?.message||String(e)}));
      const warnings=Array.from(warned,id=>({id,message:'Older annotations use assumed page dimensions. Review placement before exporting.'}));
      return {dirty:dirty.size>0||!!gesture,saving:pending.size>0,pending:pending.size,errors,warnings,
        error:(errors.find(x=>x.id===docId())||errors[0])?.message||'',
        warning:warnings.find(x=>x.id===docId())?.message||'',retired:retired||destroyed};
    }
    function updateIndicator(id){
      const item=mounted?.id===id?mounted.thumb.closest('[data-doc-id]'):null,thumb=item?.querySelector('.doc-thumb')||mounted?.thumb;
      if(!thumb||mounted?.id!==id)return;
      let indicator=thumb.querySelector('.anno-indicator');
      if(a.store[id]?.layers?.length){if(!indicator){indicator=document.createElement('span');indicator.className='anno-indicator';indicator.textContent='Edited';thumb.appendChild(indicator);}}
      else indicator?.remove();
    }
    function draw(extra){
      if(!mounted||!mounted.wrap.isConnected)return;
      const s=store(mounted.id),layers=extra?[...s.layers,extra]:s.layers;
      renderer.paintDrawingLayers(mounted.canvas,layers,{width:s.baseWidth,height:s.baseHeight});
    }
    function resize(){
      if(!mounted||!mounted.wrap.isConnected||!visible())return;
      const {canvas,wrap,plane,id}=mounted,s=store(id),w=wrap.clientWidth,h=wrap.clientHeight;if(w<10||h<10)return;
      const dpr=Math.min(global.devicePixelRatio||1,3);
      canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
      canvas.style.width='100%';canvas.style.height='100%';
      plane.style.width=s.baseWidth+'px';plane.style.height=s.baseHeight+'px';
      plane.style.transform='scale('+(w/s.baseWidth)+','+(h/s.baseHeight)+')';
      const extra=gesture?.kind==='draw'?(gesture.tool==='text'?{...gesture.layer,type:'rectangle',fill:false}:gesture.layer):null;draw(extra);
    }
    function point(event){const r=mounted.canvas.getBoundingClientRect(),s=store(mounted.id);return{x:(event.clientX-r.left)*s.baseWidth/r.width,y:(event.clientY-r.top)*s.baseHeight/r.height};}
    function setSelection(layer){selected=layer?.id||null;for(const [id,node]of mounted?.objects||[])node.classList.toggle('selected',id===selected);}
    function removeLayer(id,layer){owned(id);remember(id);const s=store(id);s.layers=s.layers.filter(l=>l.id!==layer.id);s.undone=[];setSelection(null);changed(id);renderObjects();draw();}
    function moveStart(event,layer){
      if(a.tool!=='pointer'||event.button!==0||event.target.closest('button'))return;
      owned(mounted.id);event.preventDefault();event.stopPropagation();const p=point(event);
      remember(mounted.id);gesture={kind:'move',id:mounted.id,pointerId:event.pointerId,layer,start:p,x:layer.x,y:layer.y};
      a.currentDocId=mounted.id;setSelection(layer);mounted.wrap.setPointerCapture(event.pointerId);
    }
    function renderObjects(){
      if(!mounted)return;const s=store(mounted.id),wanted=new Set();
      for(const layer of s.layers){
        if(layer.type!=='text'&&layer.type!=='sticky')continue;wanted.add(layer.id);
        let node=mounted.objects.get(layer.id);
        if(node&&node.__annotationLayer!==layer){node.remove();mounted.objects.delete(layer.id);node=null;}
        if(!node){
          node=document.createElement('div');node.className=layer.type==='text'?'anno-text-input committed':'anno-sticky';node.dataset.layerId=layer.id;
          node.__annotationLayer=layer;
          Object.assign(node.style,{position:'absolute',pointerEvents:'auto',boxSizing:'border-box'});
          const handle=document.createElement('div');handle.className=layer.type==='text'?'anno-text-dragbar':'anno-sticky-header';handle.style.touchAction='none';
          if(layer.type==='sticky'){const title=document.createElement('span');title.className='anno-sticky-label';title.textContent='Note';handle.appendChild(title);}
          const close=document.createElement('button');close.type='button';close.className=layer.type==='text'?'anno-text-close':'anno-sticky-close';close.setAttribute('aria-label','Delete '+(layer.type==='text'?'text annotation':'note'));close.textContent='×';handle.appendChild(close);
          const edit=document.createElement('div');edit.className=layer.type==='text'?'anno-text-editable':'anno-sticky-body';edit.contentEditable='true';edit.spellcheck=true;edit.setAttribute('role','textbox');edit.setAttribute('aria-label',layer.type==='text'?'Annotation text':'Note text');edit.setAttribute('aria-multiline','true');edit.textContent=layer.text;
          Object.assign(edit.style,{whiteSpace:'pre-wrap',overflowWrap:'anywhere'});
          node.append(handle,edit);mounted.plane.appendChild(node);mounted.objects.set(layer.id,node);
          handle.addEventListener('pointerdown',e=>moveStart(e,layer));
          close.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();safe(()=>removeLayer(mounted.id,layer));});
          node.addEventListener('pointerdown',e=>{e.stopPropagation();if(a.tool==='pointer'){setSelection(layer);a.currentDocId=mounted.id;}});
          edit.addEventListener('focus',()=>{setSelection(layer);node.classList.remove('committed');textHistory=null;});
          edit.addEventListener('input',()=>safe(()=>{
            const id=mounted.id;owned(id);if(textHistory!==layer.id){remember(id);textHistory=layer.id;}
            const value=editableText(edit);if(value.length>100000){edit.textContent=layer.text;throw new Error('This annotation exceeds the 100,000-character limit');}
            layer.text=value;store(id).undone=[];changed(id);
          }));
          edit.addEventListener('paste',e=>{
            e.preventDefault();const value=e.clipboardData?.getData('text/plain')||'';
            const selection=global.getSelection();if(!selection?.rangeCount)return;
            const range=selection.getRangeAt(0);if(!edit.contains(range.commonAncestorContainer))return;
            range.deleteContents();const text=document.createTextNode(value);range.insertNode(text);range.setStartAfter(text);range.collapse(true);selection.removeAllRanges();selection.addRange(range);
            edit.dispatchEvent(new Event('input',{bubbles:true}));
          });
          edit.addEventListener('blur',()=>safe(()=>{textHistory=null;node.classList.add('committed');if(layer.type==='text'&&!layer.text.trim())removeLayer(mounted.id,layer);}));
          edit.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'||(layer.type==='text'&&e.key==='Enter'&&!e.shiftKey)){e.preventDefault();edit.blur();}});
        }
        node.style.left=layer.x+'px';node.style.top=layer.y+'px';
        if(layer.type==='text'){node.style.width=layer.width+'px';node.style.minHeight=layer.height+'px';node.style.color=layer.color;node.querySelector('.anno-text-editable').style.fontSize=layer.fontSize+'px';}
        else node.style.width='140px';
        const edit=node.querySelector('[contenteditable]');if(document.activeElement!==edit&&editableText(edit)!==layer.text)edit.textContent=layer.text;
      }
      for(const[id,node]of mounted.objects)if(!wanted.has(id)){node.remove();mounted.objects.delete(id);}
      setSelection(s.layers.find(l=>l.id===selected));
    }
    function addLayer(id,layer){remember(id);const s=store(id);layer.id=uid();renderer.validateLayer(layer);s.layers.push(layer);s.undone=[];changed(id);renderObjects();draw();return layer;}
    function down(event){
      if(event.button!==0||!mounted||event.target.closest('.anno-text-input,.anno-sticky'))return;
      safe(()=>{owned(mounted.id);a.currentDocId=mounted.id;if(a.tool==='pointer'){setSelection(null);return;}
        event.preventDefault();event.stopPropagation();const p=point(event),tool=a.tool;
        if(tool==='sticky'){
          const l=addLayer(mounted.id,{type:'sticky',x:p.x,y:p.y,text:''});setTool('pointer');setSelection(l);mounted.objects.get(l.id)?.querySelector('[contenteditable]')?.focus();return;
        }
        const layer=['pen','highlighter','eraser'].includes(tool)?{type:tool,path:[p]}:{type:tool,x1:p.x,y1:p.y,x2:p.x,y2:p.y};
        if(tool==='eraser')layer.radius=a.strokeWidth*2.5;
        else Object.assign(layer,{color:a.color,width:tool==='highlighter'?a.strokeWidth*4:a.strokeWidth,opacity:tool==='highlighter'?a.opacity:1,fill:a.fill});
        gesture={kind:'draw',id:mounted.id,pointerId:event.pointerId,layer,tool,start:p};a.isDrawing=true;mounted.wrap.setPointerCapture(event.pointerId);
      });
    }
    function move(event){
      if(!gesture||event.pointerId!==gesture.pointerId||!mounted)return;
      safe(()=>{owned(gesture.id);event.preventDefault();const p=point(event);
        if(gesture.kind==='move'){
          const s=store(gesture.id),l=gesture.layer,node=mounted.objects.get(l.id);
          l.x=Math.max(0,Math.min(s.baseWidth-(node?.offsetWidth||0),gesture.x+p.x-gesture.start.x));
          l.y=Math.max(0,Math.min(s.baseHeight-(node?.offsetHeight||0),gesture.y+p.y-gesture.start.y));
          if(node){node.style.left=l.x+'px';node.style.top=l.y+'px';}
        }else{
          const l=gesture.layer;if(l.path)l.path.push(p);else {l.x2=p.x;l.y2=p.y;}
          if(gesture.tool==='text'){
            const outline={...l,type:'rectangle',fill:false};draw(outline);
          }else draw(l);
        }
      });
    }
    function finish(cancel=false){
      if(!gesture)return;const g=gesture;gesture=null;a.isDrawing=false;
      try{mounted?.wrap.releasePointerCapture(g.pointerId);}catch(e){}
      if(cancel){if(g.kind==='move'){g.layer.x=g.x;g.layer.y=g.y;}draw();renderObjects();return;}
      owned(g.id);
      if(g.kind==='move'){store(g.id).undone=[];changed(g.id);return;}
      let l=g.layer;
      if(g.tool==='text'){
        l={type:'text',x:Math.min(l.x1,l.x2),y:Math.min(l.y1,l.y2),width:Math.abs(l.x2-l.x1)>15?Math.abs(l.x2-l.x1):180,height:Math.abs(l.y2-l.y1)>15?Math.abs(l.y2-l.y1):50,text:'',color:a.color,fontSize:a.fontSize};
      }
      const added=addLayer(g.id,l);
      if(g.tool==='text'){setTool('pointer');setSelection(added);mounted.objects.get(added.id)?.querySelector('[contenteditable]')?.focus();}
    }
    function safe(fn){try{return fn();}catch(e){emit('error',mounted?.id,e?.message||String(e));return undefined;}}
    function unmount(){
      if(!mounted)return;mounted.observer?.disconnect();mounted.wrap.remove();mounted=null;gesture=null;selected=null;textHistory=null;
      a.currentCanvas=null;a.currentCtx=null;a.currentDocId=null;a.isDrawing=false;a.currentPath=[];
    }
    function ensureCanvas(thumb,id){
      // July buildDocItem schedules this call 30ms later. A page may already
      // have been replaced/hidden/retired by then; ignore those stale mounts.
      if(retired||destroyed||!thumb?.isConnected||!root.contains(thumb)||id!==docId()||thumb.clientWidth<10||thumb.clientHeight<10)return null;
      owned(id);
      if(mounted?.thumb===thumb&&mounted.id===id){resize();renderObjects();return mounted.wrap;}
      if(mounted){
        if(mounted.id===docId())commit();
        else if(gesture)throw new Error('Finish the current annotation gesture before changing the selected page');
        unmount();
      }
      const ref=dimensions(thumb);normalize(id,ref);
      thumb.querySelectorAll('.anno-canvas-wrap').forEach(x=>x.remove());
      const wrap=document.createElement('div');wrap.className='anno-canvas-wrap';wrap.dataset.docId=id;
      Object.assign(wrap.style,{position:'absolute',inset:'0',zIndex:'5',touchAction:'none'});
      const canvas=document.createElement('canvas');canvas.className='anno-canvas';canvas.style.display='block';
      const plane=document.createElement('div');plane.className='anno-object-plane';Object.assign(plane.style,{position:'absolute',left:'0',top:'0',transformOrigin:'0 0',pointerEvents:'none'});
      wrap.append(canvas,plane);thumb.appendChild(wrap);
      mounted={id,thumb,wrap,canvas,plane,objects:new Map(),observer:null};a.currentDocId=id;a.currentCanvas=canvas;a.currentCtx=canvas.getContext('2d');
      wrap.addEventListener('pointerdown',down);wrap.addEventListener('pointermove',move);
      wrap.addEventListener('click',e=>e.stopPropagation());
      wrap.addEventListener('dblclick',e=>e.stopPropagation());
      wrap.addEventListener('pointerup',e=>{if(gesture&&e.pointerId===gesture.pointerId)safe(()=>finish());});
      wrap.addEventListener('pointercancel',()=>safe(()=>finish(true)));
      wrap.addEventListener('lostpointercapture',()=>{if(gesture)safe(()=>finish());});
      if(global.ResizeObserver){mounted.observer=new ResizeObserver(()=>safe(resize));mounted.observer.observe(thumb);}
      renderObjects();setTool(a.tool);resize();updateIndicator(id);return wrap;
    }
    function setTool(tool){
      if(retired||destroyed)throw new Error('The annotation editor is retired');
      if(!TOOLS.has(tool))throw new Error('Unknown annotation tool');if(gesture)finish();a.tool=tool;a.previewBlocked=tool!=='pointer';
      $$('.anno-btn[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));
      $('opacityGroup')?.classList.toggle('visible',tool==='highlighter');$('fontSizeGroup')?.classList.toggle('visible',tool==='text'||tool==='sticky');$('fillGroup')?.classList.toggle('visible',tool==='rectangle'||tool==='ellipse');
      if(mounted){mounted.wrap.classList.toggle('drawing',tool!=='pointer');mounted.wrap.dataset.tool=tool;mounted.wrap.style.pointerEvents='auto';}
      $('toolsBtn')?.classList.toggle('tool-active',tool!=='pointer');if($('toolsBtnActive'))$('toolsBtnActive').style.color=a.color;
    }
    function replaceLayers(id,layers){const s=store(id);s.layers=clone(layers);s.undone=[];selected=null;textHistory=null;if(mounted?.id===id){for(const n of mounted.objects.values())n.remove();mounted.objects.clear();}changed(id);renderObjects();draw();}
    function undo(){const id=owned(docId());commit();const s=store(id),h=history.get(id)||[];
      if(h.length){const f=future.get(id)||[];f.push(clone(s.layers));future.set(id,f);replaceLayers(id,h.pop());}
      else if(s.layers.length){const l=s.layers.pop();s.undone.push(l);changed(id);renderObjects();draw();}
    }
    function redo(){const id=owned(docId());commit();const s=store(id),f=future.get(id)||[];
      if(f.length){const h=history.get(id)||[];h.push(clone(s.layers));history.set(id,h);replaceLayers(id,f.pop());}
      else if(s.undone.length){s.layers.push(s.undone.pop());changed(id);renderObjects();draw();}
    }
    function clearAnnotations(){const id=owned(docId());commit();if(!store(id).layers.length)return;remember(id);replaceLayers(id,[]);}
    function commit(){if(gesture)finish();if(!mounted)return;owned(mounted.id);
      // Normal typing already updates state. This protects programmatic DOM
      // edits and export/navigation boundaries without depending on blur.
      let modified=false;
      for(const l of store(mounted.id).layers){const edit=mounted.objects.get(l.id)?.querySelector('[contenteditable]');if(edit&&l.text!==editableText(edit)){if(!modified)remember(mounted.id);l.text=editableText(edit);modified=true;}}
      if(modified)changed(mounted.id);
    }
    async function flush(options={}){if(options.retry)return retryAll();if(!retired&&!destroyed)commit();while(pending.size)await Promise.all(Array.from(pending));if(failures.size)throw new Error(Array.from(failures.values())[0]?.message||'Annotation changes remain unsaved');return true;}
    async function retry(){if(!retired&&!destroyed)commit();const id=owned(docId());if(dirty.has(id))changed(id);return flush();}
    async function retryAll(){
      if(retired||destroyed)throw new Error('The annotation editor is retired');commit();
      // Validate all IDs before queueing any retry. Out-of-scope data remains
      // dirty and causes an explicit error rather than writing another scope.
      const entries=Array.from(dirty,([id,snapshot])=>[id,clone(snapshot)]);
      for(const[id]of entries)requireDoc(id);
      for(const[id,snapshot]of entries)journalSnapshot(id,snapshot);
      return flush();
    }
    function cancelPersist(id){
      // This is an explicit acknowledged-delete cleanup hook, not network
      // cancellation. The journal owns in-flight ordering and cancellation.
      dirty.delete(id);failures.delete(id);history.delete(id);future.delete(id);revisions.set(id,(revisions.get(id)||0)+1);
      if(mounted?.id===id)unmount();
    }
    function activate(thumb,id){return ensureCanvas(thumb,id);}
    function deactivate(){commit();unmount();return flush();}
    function retire(){if(retired)return flush();commit();retired=true;unmount();unlisten.splice(0).forEach(fn=>fn());return flush();}
    function destroy(){if(destroyed)return;safe(commit);destroyed=true;unmount();unlisten.splice(0).forEach(fn=>fn());}
    $$('.anno-btn[data-tool]').forEach(b=>listen(b,'click',()=>safe(()=>setTool(b.dataset.tool))));
    $$('.anno-swatch[data-color]').forEach(b=>listen(b,'click',()=>{a.color=b.dataset.color;$$('.anno-swatch').forEach(x=>x.classList.toggle('active',x===b));setTool(a.tool);}));
    $$('.anno-stroke-btn[data-width]').forEach(b=>listen(b,'click',()=>{a.strokeWidth=Number(b.dataset.width);$$('.anno-stroke-btn').forEach(x=>x.classList.toggle('active',x===b));}));
    $$('.anno-fontsize-btn[data-size]').forEach(b=>listen(b,'click',()=>{a.fontSize=Number(b.dataset.size);$$('.anno-fontsize-btn').forEach(x=>x.classList.toggle('active',x===b));}));
    listen($('opacitySlider'),'input',e=>{a.opacity=Number(e.target.value)/100;});
    listen($('fillToggle'),'click',()=>{a.fill=!a.fill;$('fillToggle').classList.toggle('active',a.fill);});
    listen($('undoBtn'),'click',()=>safe(undo));listen($('redoBtn'),'click',()=>safe(redo));listen($('clearAnnoBtn'),'click',()=>safe(clearAnnotations));
    listen($('fullscreenBtn'),'click',()=>safe(()=>{const id=owned(docId());commit();preview?.(id);}));
    listen(document,'keydown',e=>{
      if(!visible()||e.defaultPrevented)return;const target=document.activeElement;
      if(target?.matches('input,textarea,select')||target?.isContentEditable)return;
      if(Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some(dialog=>!dialog.hidden&&dialog.getClientRects().length>0))return;
      if(e.altKey)return;
      if(e.ctrlKey||e.metaKey){if(e.key.toLowerCase()==='z'){e.preventDefault();safe(e.shiftKey?redo:undo);}else if(e.key.toLowerCase()==='y'){e.preventDefault();safe(redo);}return;}
      if(KEYS[e.key.toLowerCase()]){e.preventDefault();safe(()=>setTool(KEYS[e.key.toLowerCase()]));}
      if((e.key==='Delete'||e.key==='Backspace')&&selected&&mounted){e.preventDefault();safe(()=>{const l=store(mounted.id).layers.find(l=>l.id===selected);if(l)removeLayer(mounted.id,l);});}
      if(e.key==='Escape'){if(gesture)safe(()=>finish(true));setSelection(null);safe(()=>setTool('pointer'));}
    });
    listen(global,'resize',()=>safe(resize));setTool(a.tool);
    return {ensureCanvas,activate,deactivate,setTool,undo,redo,clearAnnotations,updateIndicator,commit,flush,retry,retryAll,status,cancelPersist,retire,destroy,
      snapshot(id=docId()){return clone(store(id));},
      get currentDocId(){return mounted?.id||null;}
    };
  }
  global.STMNativeAnnotations=STMNativeAnnotations;
  if(typeof module==='object'&&module.exports)module.exports=STMNativeAnnotations;
})(typeof globalThis==='object'?globalThis:window);
