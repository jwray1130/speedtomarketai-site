/* Direct native gestures and read-only summaries. No polling or replacement controls. */
document.addEventListener('DOMContentLoaded',()=>{
 const $=id=>document.getElementById(id),loss=$('risk-loss'),limits=$('risk-limits');
 const service=()=>window.__STM_WB_PHASE5;
 const controls=root=>service()?.controls(root)||[];
 const number=value=>window.stmNativeMoneyNumber?.(value)??(Number(String(value||'').replace(/[^\d.-]/g,''))||0);
 const money=value=>'$ '+value.toLocaleString('en-US',{maximumFractionDigits:2});
 const text=(id,value)=>{const el=$(id);if(el&&el.textContent!==String(value))el.textContent=value;};
 const hidden=(el,value)=>{if(el.hidden!==value)el.hidden=value;};
 let queued=false;const pendingCommits=new Map(),touchedInputs=new WeakSet();
 function queueRefresh(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;refresh();});}
 function refresh(){
  if(!service())return;
  let claims=0,incurred=0,largeCount=0,periods=0,dates=[];
  for(const [line,prefix]of [['gl','Gl'],['auto','Auto']]){
   const years=[...$(line+'LossRows').querySelectorAll('.loss-row')],large=[...$(line+'LargeLossRows').querySelectorAll('.large-loss-row')];
   const sums=[0,0,0,0];periods+=years.length;largeCount+=large.length;
   years.forEach((row,i)=>{
    row.setAttribute('role','row');const inputs=controls(row);
    for(let j=0;j<4;j++)sums[j]+=number(inputs[j+2].value);
    dates.push(inputs[6].value);
    const labels=['Policy period','Revenue / exposure','Claims','Total paid','Total reserve','Total incurred','Valuation date'];
    inputs.forEach((el,j)=>{const label=(line==='gl'?'GL':'Auto')+' year '+(i+1)+' '+labels[j];el.setAttribute('aria-label',label);el._flatpickr?.altInput?.setAttribute('aria-label',label);});
   });
   large.forEach((row,i)=>controls(row).forEach((el,j)=>{const label=(line==='gl'?'GL':'Auto')+' large loss '+(i+1)+' '+['Date of loss','Total incurred','Total paid','Status','Description of loss'][j];el.setAttribute('aria-label',label);el._flatpickr?.altInput?.setAttribute('aria-label',label);}));
   claims+=sums[0];incurred+=sums[3];
   for(const [id,value]of [['LossPeriodCount','Incurred · '+years.length+' years'],['LossIncurred',money(sums[3])],['LossTotalLabel','Total · '+years.length+' years'],['LossClaims',sums[0]],['LossPaid',money(sums[1])],['LossReserve',money(sums[2])],['LossTotalAmount',money(sums[3])]])text(line+id,value);
   const label=$('noLosses'+prefix+'Chk').parentElement.querySelector('span');if(label)label.textContent='No losses in '+years.length+' years';
   $('remove'+prefix+'Year').disabled=years.length<=1;$('remove'+prefix+'LargeLoss').disabled=!large.length;
   hidden($(line+'LargeEmpty'),large.length>0);
  }
  text('lossIncurredTotal',money(incurred));text('lossClaimsTotal',claims);text('lossLargeCount',largeCount);
  const unique=[...new Set(dates.filter(Boolean))];text('lossValuation',unique.length===1&&dates.every(Boolean)?unique[0]:unique.length?'Varies by period':'Not provided');text('lossValuationCaption',unique.length===1&&dates.every(Boolean)?'all periods':'see each row');
  text('lossIncurredTotalCaption','GL and Auto · '+periods+' periods');
  let total=0,count=0;
  for(const group of limits.querySelectorAll('.limits-category')){
   const groupId=group.dataset.group,visible=!group.classList.contains('is-hidden')&&group.style.display!=='none';let sum=0,includedCount=0;
   for(const entry of group.querySelectorAll('.limit-entry')){
    window.stmNormalizeCoverageNative?.(entry);
    const included=entry.querySelector('input[data-target]').checked,panel=entry.querySelector('.limit-details-panel'),open=panel.classList.contains('visible');
    const premium=controls(panel).filter(el=>el.classList.contains('currency-input')&&!el.readOnly&&/premium/i.test(el.closest('label')?.textContent||'')&&!/minimum|earned/i.test(el.closest('label')?.textContent||'')).reduce((n,el)=>n+number(el.value),0);
    if(included){sum+=premium;includedCount++;}
    entry.classList.toggle('off',!included);entry.classList.toggle('open',open);
    const caption=included?money(premium)+' premium':'Not included',output=entry.querySelector('[data-coverage-summary]');if(output.textContent!==caption)output.textContent=caption;
    const fold=entry.querySelector('.collapse-arrow');if(fold){fold.setAttribute('aria-expanded',String(open));fold.setAttribute('aria-label',open?'Collapse coverage':'Expand coverage');fold.setAttribute('aria-controls',panel.id);}
    const title=entry.querySelector('[data-native-title]').value;entry.querySelector('input[data-target]').setAttribute('aria-label','Include '+title);
   }
   text('coverageGroupTotal-'+groupId,money(sum));text('coverageTotal-'+groupId,money(sum));text('coverageTotal-'+groupId+'Caption',includedCount+' included');hidden($('coverageTotal-'+groupId).parentElement,!visible);
   if(visible){total+=sum;count+=includedCount;}
  }
  text('coverageProgramTotal',money(total));text('coverageProgramTotalCaption',count+' coverages included');
  hidden($('restoreLeadCoverage'),!!limits.querySelector('[data-group="lead"] .limit-entry'));
 }
 function report(error){let el=$('nativeRiskError');if(!el){el=document.createElement('p');el.id='nativeRiskError';el.setAttribute('role','alert');$('page-risk').prepend(el);}el.textContent=error.message;}
 function owned(target){return target?.closest('[data-loss-line],#risk-limits .limits-category,#risk-limits .coverage-dropdown')&&!target.closest('.limit-templates');}
 function begin(target){try{return service()?.beginNative(target);}catch(error){report(error);return false;}}
 function finish(target,final=false){try{service()?.commitNative(target,final);queueRefresh();}catch(error){report(error);}}
 function scheduleFinish(target,final=false){clearTimeout(pendingCommits.get(target));pendingCommits.set(target,setTimeout(()=>{pendingCommits.delete(target);finish(target,final);},0));}
 // Capture ownership before native handlers mutate; capture the final values afterward.
 for(const event of ['input','change'])document.addEventListener(event,e=>{
  if(!e.isTrusted||window.__STM_NATIVE_SESSION_BLOCKED||!owned(e.target))return;
  if(document.activeElement===e.target)touchedInputs.add(e.target);
  else if(event!=='change'||!touchedInputs.has(e.target))return;
  if(e.target.readOnly||e.target.disabled)return;
  if(begin(e.target))scheduleFinish(e.target,event==='change');
 },true);
 document.addEventListener('click',e=>{
  if(!e.isTrusted||window.__STM_NATIVE_SESSION_BLOCKED)return;
  const day=e.target.closest('.flatpickr-day:not(.flatpickr-disabled)');
  if(day){const calendar=day.closest('.flatpickr-calendar');const input=[...document.querySelectorAll('input')].find(el=>el._flatpickr?.calendarContainer===calendar);if(owned(input)&&begin(input))scheduleFinish(input);return;}
  const action=e.target.closest('.loss-controls button,.collapse-arrow,.delete-icon,[data-type-key]');
  if(action?.matches('.delete-icon')&&owned(action)){if(!confirm('Are you sure you want to delete this coverage entry?')){e.preventDefault();e.stopImmediatePropagation();return;}e.__stmDeleteConfirmed=true;}
  if(action&&owned(action)){if(begin(action))scheduleFinish(action);else{e.preventDefault();e.stopImmediatePropagation();}}
 },true);
 // Save must include the completed blur/change handler, including keyboard Save.
 document.addEventListener('click',e=>{if(!e.target.closest('#saveBtn'))return;for(const [target,timer]of pendingCommits){clearTimeout(timer);pendingCommits.delete(target);finish(target,true);}},true);
 // The original dropdown owns selection. Add keyboard access to that same action.
 limits.addEventListener('keydown',e=>{
  const choice=e.target.closest('[data-type-key]');if(!e.isTrusted||!choice)return;
  if(e.key==='Enter'||e.key===' '){e.preventDefault();if(begin(choice)){choice.click();finish(choice);}}
  if(e.key==='Escape'){choice.closest('.coverage-dropdown').classList.remove('visible');choice.closest('.add-coverage-wrapper').querySelector('button').focus();}
 });
 for(const menu of limits.querySelectorAll('.coverage-dropdown'))for(const li of menu.querySelectorAll('li')){li.tabIndex=0;li.setAttribute('role','button');}
 const layer=$('layerType');let previousLayer=layer.value;
 const family=value=>value.split(' ')[0].toLowerCase();
 layer.addEventListener('focus',()=>{previousLayer=layer.value;});
 document.addEventListener('change',e=>{
  if(e.target!==layer)return;
  if(!e.isTrusted){previousLayer=layer.value;queueRefresh();return;}
  if(family(previousLayer)!==family(layer.value)){
   if(previousLayer&&layer.value&&!confirm('Changing between Lead and Excess resets the coverage schedule. Continue?')){layer.value=previousLayer;e.stopImmediatePropagation();return;}
   if(begin(layer))scheduleFinish(layer);
  }
  previousLayer=layer.value;queueRefresh();
 },true);
 $('restoreLeadCoverage').addEventListener('click',()=>{try{service().restoreNativeLead();queueRefresh();}catch(error){report(error);}});
 for(const event of ['input','change','click'])document.addEventListener(event,queueRefresh);
 window.addEventListener('stm:workbench-loaded',()=>{previousLayer=layer.value;queueRefresh();});
 window.addEventListener('stm:risk-updated',queueRefresh);
 // Observe structural additions/restores only. Never rebuild a field during editing.
 new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1)))queueRefresh();}).observe($('riskPanels'),{childList:true,subtree:true});
 queueRefresh();
});
