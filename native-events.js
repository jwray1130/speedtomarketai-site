(function(W){
 'use strict';
 const safeId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
 const id=el=>{const value=el.dataset.stmId;if(!safeId(value))throw new Error('Invalid control identifier');return value;};
 const invoke=(name,...args)=>{if(typeof W[name]!=='function')throw new Error('Control unavailable: '+name);return W[name](...args);};
 const stop=e=>e.stopPropagation();
 const actions={
  'manual-paste':['click',(el,e)=>invoke('openManualPasteModal',id(el))],
  'file-remove':['click',(el,e)=>{stop(e);return invoke('removeFile',id(el));}],
  'queue-status':['click',(el,e)=>invoke('toggleStatusMenu',id(el),el,e)],
  'queue-change':['click',(el,e)=>{stop(e);return invoke('changeSubmissionStatus',id(el),el.dataset.stmValue);}],
  'queue-stop':['click',(el,e)=>stop(e)],
  'feedback-close':['click',()=>invoke('closeAllFeedbackPopovers')],
  'feedback-chip':['click',(el)=>invoke('toggleFeedbackChip',el)],
  'feedback-submit':['click',(el)=>invoke('submitFeedbackFromPopover',el)],
  'card-refresh':['click',(el,e)=>{stop(e);return invoke('requestSectionRefresh8733',id(el),el);}],
  'card-revert':['click',(el,e)=>{stop(e);return invoke('revertCard',id(el));}],
  'card-toggle':['click',(el)=>invoke('toggleCard',el)],
  'card-positive':['click',(el,e)=>{stop(e);return invoke('feedbackQuickPositive',id(el));}],
  'card-negative':['click',(el,e)=>{stop(e);return invoke('feedbackOpenPopover',id(el),null,'negative',el);}],
  'card-suggest':['click',(el,e)=>{stop(e);return invoke('feedbackOpenPopover',id(el),null,'suggestion',el);}],
  'card-edit':['click',(el,e)=>{stop(e);return invoke('focusEditCard',id(el));}],
  'card-delete':['click',(el,e)=>{stop(e);return invoke('deleteCard',id(el));}],
  'classify-limit':['input',(el)=>invoke('queueReclassifyLimit',id(el),el.value)],
  'classify-queue':['change',(el)=>invoke('queueReclassify',id(el),el.value)],
  'classify-accept':['click',(el)=>invoke('acceptClassification',id(el))],
  'classify-apply':['click',()=>invoke('applyReclassifications')],
  'pending-refresh':['click',()=>invoke('confirmRefreshAllStale8733')],
  'audit-category':['change',(el)=>invoke('onAuditCategoryChange',el.value)],
  'audit-older':['click',()=>invoke('onAuditLoadOlder')]
 };
 // A function property is allowed by script-src-attr 'none'. It runs at the
 // original target/bubble phase and preserves currentTarget and this.
 // There is no source-text interpretation: attributes only choose this finite map.
 const bound=new WeakMap();
 // Existing dynamic snippets have no `return` statement: ignore callee return
 // values just as they did, rather than treating a returned false as cancellation.
 function dispatch(event){const action=bound.get(this);if(!action||event.type!==action[0])return;action[1](this,event);}
 function bind(root){
  if(!root)return;
  const nodes=[...(root.matches?.('[data-stm-action]')?[root]:[]),...root.querySelectorAll('[data-stm-action]')];
  for(const el of nodes){
   // Never turn rendered model/document bodies into application controls.
   if(el.closest('.sc-body,.sc-card-title-edit,.doc-thumb-word-page,.preview-word,.preview-excel'))continue;
   const entry=actions[el.dataset.stmAction];
   if(!entry)throw new Error('Unrecognized compiled control: '+el.dataset.stmAction);
   if(el.hasAttribute('data-stm-id'))id(el);
   bound.set(el,entry);el['on'+entry[0]]=dispatch;
  }
 }
 W.STMNativeEvents=Object.freeze({bind});
})(window);
