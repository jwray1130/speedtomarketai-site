/* Presentation contracts only. July business rules and calculations are not replaced. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.STMSubmissionContracts=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
 const copy=o=>o==null?o:JSON.parse(JSON.stringify(o));
 const finite=n=>n!==null&&n!==''&&n!==undefined&&Number.isFinite(Number(n));
 function confidence(n){if(!finite(n))return null;const x=Number(n);if(x<0||x>100)return null;return Math.round(x<=1?x*100:x);}
 function stage(module){const w=Number(module?.wave);return w===1?1:w===2?2:3;}
 function outcome(ext,node){
  if(ext?.rejected||ext?.refused||ext?.excluded||ext?.applicant_match==='mismatch')return 'refused';
  if(node==='running')return 'running';if(node==='cancelled')return 'cancelled';
  if(node==='error'||ext?.rerunFailed)return ext&&own(ext,'text')?'previous-output':'failed';
  if(ext?.staleInputs8732||ext?.staleFromRerun||node==='warn')return 'stale';
  if(ext&&own(ext,'text'))return ext.cached8760||ext.cached||ext.cacheHit||ext.fromCache?'cached':'available';
  return node==='skipped'?'skipped':'waiting';
 }
 function project(s,modules,nodes){
  const cards=Object.entries(s.extractions||{}).map(([id,ext])=>({id,code:modules[id]?.code||id,name:modules[id]?.name||modules[id]?.label||id,stage:stage(modules[id]),status:outcome(ext,nodes?.[id]?.status),confidence:confidence(ext.confidence),seconds:finite(ext.timing)?Number(ext.timing):null,source:typeof ext.sourceInfo==='string'?ext.sourceInfo:'',edited:own(s.edits?.[id],'htmlOverride'),hidden:!!s.hiddenCards?.[id],note:false}));
  for(const c of s.customCards||[])cards.push({id:c.id,code:'NOTE',name:c.title||'Custom Note',stage:2,status:'note',confidence:null,seconds:null,source:'Underwriter note',edited:true,hidden:!!s.hiddenCards?.[c.id],note:true});
  const cs=cards.filter(c=>!c.note),valid=cs.map(c=>c.confidence).filter(n=>n!==null);
  return {cards,total:cs.length,visible:cards.filter(c=>!c.hidden),hidden:cards.filter(c=>c.hidden),confidence:valid.length?Math.round(valid.reduce((a,b)=>a+b,0)/valid.length):null,seconds:cs.reduce((a,c)=>a+(c.seconds||0),0),edited:cards.filter(c=>c.edited).length,issues:cs.filter(c=>['refused','failed','stale','previous-output','cancelled'].includes(c.status)).length};
 }
 function editState(s){return copy({edits:s.edits||{},customCards:s.customCards||[],hiddenCards:s.hiddenCards||{}});}
 function rowKeys(s){return new Set([...Object.keys(s.edits||{}).map(k=>'card:'+k),...(s.customCards||[]).map(c=>'custom:'+c.id),...Object.keys(s.hiddenCards||{}).filter(k=>s.hiddenCards[k]).map(k=>'hidden:'+k)]);}
 function removedKeys(before,after){const keys=rowKeys(after);return [...rowKeys(before)].filter(k=>!keys.has(k));}
 function recoveryKey(owner,sid){if(!owner)throw new Error('A signed-in owner is required.');return 'stm-v94-summary:'+encodeURIComponent(owner)+':'+encodeURIComponent(sid||'draft');}
 function recoveryMatches(record,owner,sid){return !!record&&record.schema===1&&record.owner===owner&&(record.sid||null)===(sid||null)&&record.state&&typeof record.state.edits==='object'&&Array.isArray(record.state.customCards)&&typeof record.state.hiddenCards==='object';}
 function reduce(s,event){
  const n=editState(s);const id=String(event.id||'');
  if(event.type==='edit'){if(!id)throw new Error('Missing card identifier');n.edits[id]={htmlOverride:String(event.html??''),originalText:String(event.originalText??''),editedAt:event.at||0};}
  else if(event.type==='revert'){delete n.edits[id];}
  else if(event.type==='hide'){n.hiddenCards[id]=true;}
  else if(event.type==='restore'){n.hiddenCards={};}
  else if(event.type==='note'){if(!id||n.customCards.some(c=>c.id===id))throw new Error('Duplicate or missing note identifier');n.customCards.push({id,title:String(event.title||'Custom Note'),html:String(event.html??''),createdAt:event.at||0,editedAt:event.at||0});}
  else if(event.type==='note-edit'){const c=n.customCards.find(c=>c.id===id);if(!c)throw new Error('Note not found');if(own(event,'html'))c.html=String(event.html??'');if(own(event,'title'))c.title=String(event.title??'');c.editedAt=event.at||0;}
  else if(event.type==='reset'){n.edits={};n.customCards=[];n.hiddenCards={};}
  else throw new Error('Unsupported summary action');
  return n;
 }
 return Object.freeze({own,copy,confidence,stage,outcome,project,editState,rowKeys,removedKeys,recoveryKey,recoveryMatches,reduce});
});
