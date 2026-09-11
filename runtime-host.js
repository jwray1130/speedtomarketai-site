/* Host lifecycle: original UI controls and engine execute in their own document. */
(function(){'use strict';
const R=()=>{try{return parent!==window?parent.STM_RUNTIME:null;}catch(_){return null;}};
window.addEventListener('DOMContentLoaded',()=>{
 const r=R();if(!r)return;
 const fonts=document.createElement('style');fonts.textContent=r.fonts;document.head.appendChild(fonts);
 document.documentElement.dataset.theme=r.theme;
 if(document.body.dataset.runtime==='platform') {
  r.platformReady(window);
  window.toggleTheme=()=>parent.setTheme(r.theme==='dark'?'light':'dark');
  // Preserve the native entry points, route them through the single shell.
  window.openWorkbenchForActiveSubmission8706=()=>r.go('wb-deal');
  window.navigateSystem8706=system=>r.go(system==='workbench'?'wb-deal':'queue');
  const brand=document.getElementById('platformBrandNav');if(brand)brand.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();r.go('queue');},true);
  const oldToast=window.toast;
  window.toast=function(msg,type){if(window.__STM_SUBMISSION?.operation?.cancelled&&/complete|updated|finished/i.test(String(msg)))return;if(typeof oldToast==='function')oldToast(msg,type);r.toast(String(msg),type);};
  document.querySelectorAll('[id="stageTabPipe"],[id="stageTabSum"],[id="stageTabDocs"]').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();r.go(({stageTabPipe:'sub-pipe',stageTabSum:'sub-sum',stageTabDocs:'sub-docs'})[el.id]);},true));
  // Dialogs belong to the native engine document. Bring that live document
  // forward while a confirmation is open, then restore the prior presentation.
  // Moving the dialog across documents would break its original event closures.
  const dock=document.getElementById('pendingDock8747');
  const center=document.querySelector('#view-submission .center-pane');
  if(dock&&center){const head=center.querySelector('.pane-head');if(head)head.after(dock);else center.prepend(dock);}
  let scheduled=false,lastOpen=false;
  const watchDialogs=()=>{
   if(scheduled)return;scheduled=true;
   requestAnimationFrame(()=>{scheduled=false;
    const open=!!document.querySelector('.modal-backdrop.open,#preflight8733,#docs-view-root .preview-modal.visible,#docs-view-root .modal-overlay.visible,#docs-view-root .modal-backdrop.visible');
    if(open!==lastOpen){lastOpen=open;r.nativeDialogChanged(open);}
   });
  };
  new MutationObserver(watchDialogs).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  setInterval(()=>{r.sync();watchDialogs();},600);watchDialogs();
 } else {
  document.querySelectorAll('#riskNav li,#formsNav li,#mainNav li').forEach(el=>el.addEventListener('click',()=>{
   if(r.navigatingNative)return;
   const key=el.dataset.risk?'risk:'+el.dataset.risk:el.dataset.form?'form:'+el.dataset.form:'page:'+el.dataset.page;
   const map={'risk:loss':'wb-loss','risk:limits':'wb-limits','risk:gl-exposure-rater':'wb-gl','risk:al-fleet-rater':'wb-al','risk:internal-rater':'wb-internal','form:endorsements':'wb-forms','form:subjectivities':'wb-subj','page:deal':'wb-deal','page:underwriting':'wb-uw','page:history':'wb-history'};
   if(map[key])r.nativeNavigated(map[key]);
  }));
 }
 document.addEventListener('keydown',e=>{if(e.key==='Escape')r.closeActions();if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();r.save();}});
});
})();
