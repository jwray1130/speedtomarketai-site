/* Awaited, identity-scoped journal around the unchanged July document data adapter. */
(function(){'use strict';
 const originals={insert:window.sbInsertDocumentPage,patch:window.sbUpdateDocumentPage,remove:window.sbDeleteDocumentPage};
 const pending=new Map();let owner=null,seq=0,rev=0,localError='',recoveryError='';
 const key=u=>'stm-v94-documents:'+encodeURIComponent(u);
 const copy=x=>x==null?x:JSON.parse(JSON.stringify(x,(k,v)=>k==='el'||k==='pdfData'||k==='highResData'||k==='nativeDataUrl'?undefined:v));
 const plain=o=>!!o&&typeof o==='object'&&!Array.isArray(o);
 const str=s=>typeof s==='string'&&s.trim().length>0;
 function validateRecovery(data,u){
  if(!plain(data)||data.schema!==1||data.owner!==u||!Array.isArray(data.pending))throw new Error('Invalid document recovery envelope.');
  const seen=new Set();
  for(const x of data.pending){
   if(!plain(x)||!Number.isSafeInteger(x.seq)||x.seq<1||seen.has(x.seq)||!str(x.id)||x.owner!==u||!(x.sid==null||str(x.sid))||!['insert','patch','remove'].includes(x.kind)||!Array.isArray(x.args))throw new Error('Invalid document recovery entry.');
   seen.add(x.seq);
   if(x.kind==='insert'&&(x.args.length!==1||!plain(x.args[0])||x.args[0].id!==x.id))throw new Error('Invalid document insertion recovery.');
   if(x.kind==='patch'&&(x.args.length!==2||x.args[0]!==x.id||!plain(x.args[1])))throw new Error('Invalid document patch recovery.');
   if(x.kind==='remove'&&(x.args.length!==2||x.args[0]!==x.id||!(x.args[1]==null||typeof x.args[1]==='string')))throw new Error('Invalid document deletion recovery.');
   if(x.record!=null&&(!plain(x.record)||x.record.id!==x.id))throw new Error('Mismatched document recovery record.');
  }
  return data.pending;
 }
 function init(){const u=window.currentUser?.id;if(!u)return;if(owner&&owner!==u)throw new Error('Document journal belongs to another session.');if(owner)return;owner=u;
  try{const raw=localStorage.getItem(key(owner));if(raw!=null){const items=validateRecovery(JSON.parse(raw),owner);for(const item of items){item.error=item.error||'Recovered unsynced document change';item.promise=null;item.running=false;pending.set(item.seq,item);seq=Math.max(seq,item.seq);}}}
  catch(e){recoveryError='Document recovery could not be read: '+e.message+' Original recovery data has been retained; do not discard it.';localError=recoveryError;}
 }
 function stash(){if(!owner||recoveryError)return;try{if(pending.size)localStorage.setItem(key(owner),JSON.stringify({schema:1,owner,pending:[...pending.values()].map(({promise,running,timer,...v})=>v)}));else localStorage.removeItem(key(owner));localError='';}catch(e){localError='Local document recovery storage is unavailable. Keep this tab open.';}}
 function status(){init();return {dirty:pending.size>0||!!recoveryError,recoveryBlocked:!!recoveryError,pending:pending.size,inFlight:[...pending.values()].filter(p=>p.running).length,error:recoveryError||[...pending.values()].find(p=>p.error)?.error||'',localError,owner,revision:rev};}
 function notify(){rev++;stash();try{parent.STM_RUNTIME?.sync();}catch(_){}}
 function assertOwner(item){if(window.currentUser?.id!==item.owner)throw new Error('Session changed. Document changes are retained under their original owner.');}
 function record(id){return window.docsView?.design?.record(id)||window.docsView?.getDocs().find(d=>d.id===id)||null;}
 async function attempt(item){
  if(!pending.has(item.seq))return true;if(item.promise)return item.promise;if(item.timer){clearTimeout(item.timer);item.timer=null;}
  const task=async()=>{
   try{assertOwner(item);const earlier=[...pending.values()].find(p=>p.id===item.id&&p.seq<item.seq);
   if(earlier)await attempt(earlier);
   assertOwner(item);item.running=true;notify();
   const result=await originals[item.kind].apply(window,item.args);assertOwner(item);
    if(result===null||result===false||result===undefined)throw new Error('Cloud rejected document '+item.kind+'. Retry sync; local changes are retained.');
    pending.delete(item.seq);item.error='';notify();return result;
   }catch(e){item.error=e.message||String(e);notify();throw e;}
   finally{item.running=false;item.promise=null;}
  };
  item.promise=task();return item.promise;
 }
 function queue(kind,args){
  init();if(recoveryError)return Promise.reject(new Error(recoveryError));if(!owner||window.currentUser?.id!==owner)return Promise.reject(new Error('Sign in before changing documents.'));
  const id=kind==='insert'?args[0].id:args[0],doc=kind==='insert'?args[0]:record(id);
  const item={seq:++seq,id,owner,sid:doc?.submissionId||null,kind,args:copy(args),record:copy(doc),error:'',running:false,promise:null};
  pending.set(item.seq,item);notify();return attempt(item);
 }
 async function flush(){init();if(recoveryError)throw new Error(recoveryError);while(pending.size){const item=[...pending.values()].sort((a,b)=>a.seq-b.seq)[0];await attempt(item);}return {mode:'cloud'};}
 window.sbInsertDocumentPage=doc=>queue('insert',[doc]);
 window.sbUpdateDocumentPage=(id,patch)=>queue('patch',[id,patch]);
 window.sbDeleteDocumentPage=(id,path)=>queue('remove',[id,path]);
 window.__STM_DOC_JOURNAL={status,stash,flush,revision:()=>rev,entries:()=>{init();return copy([...pending.values()].map(({promise,running,timer,...v})=>v));},has:id=>[...pending.values()].some(p=>p.id===id),
  pendingFor:id=>[...pending.values()].filter(p=>p.id===id).map(p=>({kind:p.kind,error:p.error})),
  async settleInserts(){for(const p of [...pending.values()].filter(p=>p.kind==='insert'))await attempt(p);}
 };
 window.addEventListener('beforeunload',stash);
})();
