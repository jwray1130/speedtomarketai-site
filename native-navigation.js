/* Direct page navigation and save guards for the native workbench. No mirror DOM. */
document.addEventListener('DOMContentLoaded', () => {
  const routeMap = {'deal':'wb-deal','loss-history':'wb-loss','limits-premiums':'wb-limits','gl-exposure-rater':'wb-gl','al-fleet-rater':'wb-al','internal-rater':'wb-internal','forms':'wb-forms','subjectivities':'wb-subj','underwriting':'wb-uw','renewal':'wb-renewal','history':'wb-history'};
  const reverse = Object.fromEntries(Object.entries(routeMap).map(([k,v])=>[v,k]));
  // Flatpickr closes before some onChange callbacks. Record the real user gesture,
  // then serialize the canonical input after the datepicker has committed it.
  document.addEventListener('click',e=>{
    const day=e.target.closest('.flatpickr-day:not(.flatpickr-disabled)');if(!e.isTrusted||!day)return;
    const calendar=day.closest('.flatpickr-calendar');
    const input=Array.from(document.querySelectorAll('input')).find(el=>el._flatpickr?.calendarContainer===calendar);
    if(input)queueMicrotask(()=>window.__STM_WB?.markDirty(input));
  },true);
  for(const [which,id]of [['insured','insuredSaveBtn'],['broker','brokerSaveBtn']]){
    const dialog=document.getElementById(which+'Dialog');let before=[];
    const rollback=()=>{for(const [el,value,checked]of before){el.value=value;el.checked=checked;}};
    const cancel=dialog.querySelector('button[value="cancel"]');cancel.type='button';cancel.onclick=()=>{rollback();dialog.close('cancel');};
    document.addEventListener('click',e=>{
      if(e.target.closest('[data-target="'+which+'Dialog"]')){dialog.returnValue='';before=Array.from(dialog.querySelectorAll('input,select')).map(el=>[el,el.value,el.checked]);}
    });
    dialog.addEventListener('cancel',rollback);
    dialog.addEventListener('close',()=>{if(dialog.returnValue!=='default')rollback();});
    document.getElementById(id).addEventListener('click',e=>{if(!e.target.form.checkValidity()){e.preventDefault();e.stopImmediatePropagation();e.target.form.reportValidity();}},true);
    document.getElementById(id).addEventListener('click',e=>{
      if(e.isTrusted&&e.target.form.checkValidity())window.__STM_WB_PHASE5.captureNativeDialog(which);
    });
  }
  window.addEventListener('pagehide',()=>window.__STM_WB?.stash());
  window.stmAuth?.onChange((event,session)=>{
    const owner=window.__STM_WB?.ownerId;
    if(!owner || (event!=='SIGNED_OUT'&&(!session?.user||session.user.id===owner)))return;
    window.__STM_WB.stash();window.__STM_NATIVE_SESSION_BLOCKED=true;
    document.documentElement.setAttribute('data-stm-session-blocked','');
    let gate=document.getElementById('nativeSessionGate');
    if(!gate){gate=document.createElement('div');gate.id='nativeSessionGate';gate.setAttribute('role','alert');gate.innerHTML='<h1>Your session changed</h1><p>Reopen this page to continue with your current account. Unsaved changes were kept with the account that opened this submission.</p><button type="button">Reopen page</button>';gate.querySelector('button').onclick=()=>location.reload();document.body.append(gate);}
  });
  window.addEventListener('beforeunload',e=>{if(window.__STM_WB?.dirty){window.__STM_WB.stash();e.preventDefault();e.returnValue='';}});
  document.addEventListener('click',async e=>{const link=e.target.closest('a[href^="platform.html"]');if(!link||!window.__STM_WB?.dirty)return;e.preventDefault();document.activeElement?.blur();try{const saved=await window.__STM_WB.save();if(saved?.mode!=='cloud')throw new Error(saved?.summary||'Your changes are kept on this device but have not reached the cloud.');if(window.__STM_WB.dirty)throw new Error('Newer edits are still waiting to save. Retry before leaving.');location.href=link.href;}catch(error){alert('Save failed. Stay on this page and retry: '+error.message);}});
  function restoreRoute(){
    const slug=location.hash.replace(/^#\/?workbench\//,'').replace(/^#/,'');
    const route=routeMap[slug]||'wb-deal';
    if(route==='wb-renewal'&&document.getElementById('typeSelect').value!=='Renewal')return;
    window.__STM_WB?.navigate(route);
  }
  window.addEventListener('stm:workbench-loaded',restoreRoute);
  window.addEventListener('hashchange',restoreRoute);
  document.getElementById('mainNav').addEventListener('click',e=>{
    const tab=e.target.closest('[data-page]');if(!e.isTrusted||!tab)return;
    const pages={deal:'deal',risk:'loss-history',forms:'forms',underwriting:'underwriting',renewal:'renewal',history:'history'};
    history.replaceState(null,'','#/workbench/'+pages[tab.dataset.page]);
  });
  document.addEventListener('click',e=>{
    const tab=e.target.closest('[data-risk],[data-form]');if(!e.isTrusted||!tab)return;
    const keys={loss:'loss-history',limits:'limits-premiums','gl-exposure-rater':'gl-exposure-rater','al-fleet-rater':'al-fleet-rater','internal-rater':'internal-rater',endorsements:'forms',subjectivities:'subjectivities'};
    const slug=keys[tab.dataset.risk||tab.dataset.form];if(slug)history.replaceState(null,'','#/workbench/'+slug);
  });
  document.getElementById('typeSelect').addEventListener('change',()=>{
    if(document.getElementById('typeSelect').value==='New'&&location.hash.endsWith('/renewal'))history.replaceState(null,'','#/workbench/deal');
  });
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();document.activeElement?.blur();document.getElementById('saveBtn').click();}
  });
});
