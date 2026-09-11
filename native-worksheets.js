/* The owning worksheets receive real gestures; all new figures are read-only. */
document.addEventListener('DOMContentLoaded',()=>{
 const $=id=>document.getElementById(id),p6=()=>window.__STM_WB_PHASE6,p9=()=>window.__STM_WB_PHASE9;
 const ids={gl_exposure:'classTerritoryTable',al_fleet:'autoExposuresTbl',primary:'primaryPoliciesTbl',tower:'towerLimitsTable',highex:'highExcessTable',auto:'autoTable'};
 const rows=kind=>[...$(ids[kind]).querySelectorAll('tbody > tr')];
 const num=v=>Number(String(v||'').replace(/[^\d.-]/g,''))||0,money=n=>'$ '+n.toLocaleString('en-US',{maximumFractionDigits:2});
 const text=(id,v)=>{const e=$(id);if(e&&e.textContent!==String(v))e.textContent=v;};
 const value=(row,attr,key)=>row.querySelector('['+attr+'="'+key+'"]')?.value||'';
 const bucket=v=>/general|\bgl\b/i.test(v)?'gl':/auto|\bal\b/i.test(v)?'auto':'other';
 const other=()=>rows('primary').filter(r=>bucket(value(r,'data-pp','coverage'))==='other');
 const pending=new Set(),touched=new WeakSet();let timer,refreshQueued=false;
 function report(err){const e=$('nativeWorksheetError');e.textContent=err.message;e.hidden=false;}
 const alert=document.createElement('p');alert.id='nativeWorksheetError';alert.className='worksheet-warning';alert.setAttribute('role','alert');alert.hidden=true;$('pageContent').prepend(alert);
 document.addEventListener('blur',e=>{
  const el=e.target;if(!el.matches('#page-renewal input')||!el.value.trim()||el.readOnly)return;
  const raw=el.value.replace(/[$,\s]/g,''),percent=el.dataset.type==='percent'||['splitGl','splitAl'].includes(el.dataset.erc);
  const valid=percent?/^-?(?:\d+\.?\d*|\.\d+)%?$/.test(raw):/^-?(?:\d+\.?\d*|\.\d+)$/.test(raw);
  if(!valid){el.value='';el.setAttribute('aria-invalid','true');report(new Error('Enter a full numeric amount in Renewal, such as 5,000,000. The invalid entry was cleared.'));el.dispatchEvent(new Event('input',{bubbles:true}));}
  else{const corrected=el.hasAttribute('aria-invalid');el.removeAttribute('aria-invalid');if(corrected&&!document.querySelector('#page-renewal [aria-invalid="true"]'))alert.hidden=true;if(['splitGl','splitAl'].includes(el.dataset.erc)){el.value=String(Math.min(100,Math.max(0,num(el.value))))+'%';el.dispatchEvent(new Event('input',{bubbles:true}));}}
 },true);
 function flush(){clearTimeout(timer);const kinds=[...pending];pending.clear();if(!kinds.length)return;try{if(kinds.includes('renewal'))p9()?.commitNative();const rating=kinds.filter(k=>k!=='renewal');if(rating.length)p6()?.commitNative(rating);}catch(e){report(e);}queueRefresh();}
 function begin(kinds,el){try{if(!p6()||!p9())return false;if(kinds.includes('renewal')&&!p9().beginNative(el))return false;const rating=kinds.filter(k=>k!=='renewal');if(rating.length&&!p6().beginNative(rating))return false;kinds.forEach(k=>pending.add(k));clearTimeout(timer);timer=setTimeout(flush,0);return true;}catch(e){report(e);return false;}}
 function kindsFor(el){for(const [k,id]of Object.entries(ids))if(el.closest('#'+id))return[k];if(el.id==='hazardGradeSelect')return['primary'];if(el.matches('.yoy-input,[data-erc],#glPer,#commentsTxt'))return['renewal'];if(el.closest('#risk-internal-rater'))return[];return null;}
 for(const event of ['input','change'])document.addEventListener(event,e=>{
  if(!e.isTrusted||window.__STM_NATIVE_SESSION_BLOCKED||e.target.readOnly||e.target.disabled)return;
  const kinds=kindsFor(e.target);if(!kinds)return;
  if(document.activeElement===e.target)touched.add(e.target);else if(event!=='change'||!touched.has(e.target))return;
  begin(kinds,e.target);
 },true);
 function stop(e,message){e.preventDefault();e.stopImmediatePropagation();if(message)report(new Error(message));}
 const additions={glRaterAddRow:['gl_exposure',1000],internalAddPrimary:['primary',1000],internalAddLayer:['tower',9],internalAddHighExcess:['highex',14]};
 document.addEventListener('click',e=>{
  if(e.target.closest('#saveBtn')){flush();return;}
  if(!e.isTrusted||window.__STM_NATIVE_SESSION_BLOCKED)return;
  const button=e.target.closest('button');if(!button)return;
  if(button.dataset.ratingAction){stop(e);try{flush();p6().action(window.__STM_WB.submissionId,button.dataset.ratingAction);queueRefresh();}catch(err){report(err);}return;}
  if(button.matches('[data-native-gl-remove]')){stop(e);try{flush();p6().beginNative(['gl_exposure']);p6().action(window.__STM_WB.submissionId,'gl_exposure:remove',{key:button.closest('tr').dataset.stmRatingKey});queueRefresh();}catch(err){report(err);}return;}
  const add=additions[button.id];
  if(add&&(rows(add[0]).length>=add[1]||button.id==='internalAddPrimary'&&other().length>=6)){stop(e,'This worksheet has reached its rated row capacity. Remove an unused row first.');return;}
  if(button.id==='clearSheetBtn'){
   if(!confirm('Clear the Internal Rater sheet? Primary policies, factors, tower layers and high-excess rows will reset. The rating driver fields stay as entered.')){stop(e);return;}
   e.__stmClearConfirmed=true;if(!begin(['primary','tower','highex']))stop(e);return;
  }
  const kinds=add?[add[0]]:button.id==='resetBtn'||button.id==='glRaterRemoveRow'?['gl_exposure']:button.id==='yoyReset'?['renewal']:button.matches('[data-pp-remove],[data-tw-remove],[data-he-remove]')?kindsFor(button):null;
  if(kinds&&!begin(kinds,button))stop(e);
 },true);
 // Block only a new unsupported activation. Existing saved data remains removable.
 document.addEventListener('click',e=>{const el=e.target;if(!e.isTrusted||!el.matches('[data-he="active"]'))return;if(rows('highex').indexOf(el.closest('tr'))>=14&&el.checked)stop(e,'Only the first 14 high-excess rows can be rated.');},true);
 function queueRefresh(){if(refreshQueued)return;refreshQueued=true;queueMicrotask(()=>{refreshQueued=false;refresh();});}
 function refresh(){
  if(!p6())return;
  const gl=rows('gl_exposure'),al=rows('al_fleet');let exposure=0,units=0,overrides=0,active=0;
  gl.forEach((row,i)=>{
   exposure+=num(value(row,'data-f','exposures'));
   if(!row.querySelector('[data-native-gl-remove]')){const cell=row.insertCell();const b=document.createElement('button');b.type='button';b.className='native-row-remove';b.dataset.nativeGlRemove='';b.textContent='×';cell.append(b);}
   const b=row.querySelector('[data-native-gl-remove]');b.setAttribute('aria-label','Remove GL class '+(i+1));b.disabled=gl.length<=1;
  });
  al.forEach(row=>{const u=num(value(row,'data-f','units'));units+=u;if(u>0)active++;if(num(value(row,'data-f','selRate'))>0)overrides++;});
  text('nativeGlPremium',$('totalPremium').textContent);text('nativeGlExposure',exposure.toLocaleString('en-US'));text('nativeGlExposureCaption',gl.filter(r=>num(value(r,'data-f','exposures'))>0).length+' classes with exposure');
  text('nativeGlBlended',exposure>0?(num($('totalPremium').textContent)/exposure*1000).toFixed(3):'—');text('nativeGlParts',$('totalPremOps').textContent+' · '+$('totalProducts').textContent);
  $('nativeGlQuoteNotice').hidden=!gl.some(r=>num(r.dataset.quotePremP)>0||num(r.dataset.quotePremG)>0);
  text('nativeAlPremium',$('autoTotalPremium').textContent);text('nativeAlUnits',units.toLocaleString('en-US'));text('nativeAlUnitsCaption',active+' of 15 vehicle categories');text('nativeAlAverage',units>0?money(num($('autoTotalPremium').textContent)/units):'—');text('nativeAlOverrides',overrides);
  const engine=window.__STM_NATIVE_RATING?.inspect(),primary=rows('primary'),tower=rows('tower'),high=rows('highex'),others=other(),issues=[];
  if(!engine?.ready)issues.push('The rating engine is unavailable.');
  if(others.length>6)issues.push('Only six Other primary policies are supported; remove or reclassify extra policies.');
  if(others.some(r=>num(value(r,'data-pp','limit'))<=0&&(num(value(r,'data-pp','ulPrem'))>0||num(value(r,'data-pp','manualPrem'))>0)))issues.push('Enter a positive limit for each Other policy with a premium.');
  if(tower.slice(9).some(r=>['limit','cPrem'].some(k=>num(value(r,'data-tw',k))!==0)))issues.push('Tower rows after row nine are outside the rating capacity; remove extra layers.');
  if(engine?.highVisible&&high.slice(14).some(r=>r.querySelector('[data-he="active"]').checked))issues.push('Deactivate or remove high-excess rows after row 14.');
  const warning=$('nativeRatingWarning');warning.hidden=!issues.length;const msg=issues.length?'Rating incomplete. '+issues.join(' ')+' Calculated previews are unavailable until this is resolved.':'';if(warning.textContent!==msg)warning.textContent=msg;
  $('risk-internal-rater').classList.toggle('native-rating-invalid',!!issues.length);
  text('nativeInternalRated',issues.length?'Unavailable':$('rsZurichPremium').value||'—');text('nativeInternalPerMillion',issues.length?'Unavailable':$('rsPerMillion').value||'—');text('nativeInternalPrimary',money(primary.reduce((n,r)=>n+num(value(r,'data-pp','ulPrem')),0)));text('nativeInternalTower',tower.length);
  for(const [key,config]of Object.entries(additions))$(key).disabled=rows(config[0]).length>=config[1]||key==='internalAddPrimary'&&others.length>=6;
  tower.forEach((r,i)=>{r.classList.toggle('native-unrated-row',i>=9);if(i>=9)r.querySelector('[data-tw="attach"]').value='Not rated';});
  high.forEach((r,i)=>{r.classList.toggle('native-unrated-row',i>=14);if(i>=14)r.querySelector('[data-he="attach"]').value='Not rated';const c=r.querySelector('[data-he="active"]');c.disabled=i>=14&&!c.checked;c.title=i>=14?'Outside the 14-row rating capacity':'';});
  for(const row of $('groundUpTbl').querySelectorAll('tbody tr[data-ground-top]')){let cell=row.querySelector('[data-native-al-premium]');if(!cell){cell=row.insertCell();cell.dataset.nativeAlPremium='';}const v=engine?.bands.find(b=>b.top===Number(row.dataset.groundTop))?.autoDisplay||'$0';if(cell.textContent!==v)cell.textContent=v;}
  text('nativeRenewalErc',$('ercPct').textContent);text('nativeRenewalExpiring',document.querySelector('[data-summary-out="expPrem"]')?.textContent||'—');text('nativeRenewalFlat',document.querySelector('[data-erc-out="flatTotal"]')?.textContent||'—');text('nativeRenewalPremium',document.querySelector('[data-summary-out="renPrem"]')?.textContent||'—');
  text('nativeRenewalLead',document.querySelector('.yoy-input[data-row="lead"][data-idx="0"]')?.value||'—');text('nativeRenewalFleetChange',$('autoChangeTotal').textContent);text('nativeRenewalFleetCaption',$('autoChangePct').textContent);
  text('nativeRenewalErcCaption',num(document.querySelector('[data-erc-out="flatTotal"]')?.textContent)>0?'Compared with flat renewal':'Comparison requires a positive flat renewal premium');
  for(const el of document.querySelectorAll('.yoy-input,[data-erc]'))el.maxLength=100;
  for(const [kind,id]of Object.entries(ids))rows(kind).forEach((r,i)=>r.querySelectorAll('input,select').forEach(el=>{const field=Object.values(p6().specs).find(s=>s.id===id)?.attr;el.setAttribute('aria-label',kind.replaceAll('_',' ')+' row '+(i+1)+' '+(el.getAttribute(field)||'value'));}));
  for(const kind of ['primary','tower','highex'])rows(kind).forEach((r,i)=>{const b=r.querySelector('[data-pp-remove],[data-tw-remove],[data-he-remove]');if(b){if(b.textContent!=='×')b.textContent='×';b.setAttribute('aria-label','Remove '+kind+' row '+(i+1));}});
 }
 for(const event of ['input','change','click'])document.addEventListener(event,queueRefresh);
 window.addEventListener('stm:workbench-loaded',queueRefresh);window.addEventListener('stm:worksheets-updated',queueRefresh);
 new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1)))queueRefresh();}).observe($('pageContent'),{childList:true,subtree:true});
 queueRefresh();
});
