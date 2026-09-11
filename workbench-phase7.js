/* Phase 7: map the review pages to July controls. No rating/rule replacement.
 * The existing workbench_field_edits table holds the optional __phase7 record.
 * Actual form wording is not present in the source: previews/exports are schedules.
 */
(function(global){
 'use strict';
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k),clone=x=>JSON.parse(JSON.stringify(x));
 const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
 const uid=()=> 'p7-'+(global.crypto.randomUUID?.()||Array.from(global.crypto.getRandomValues(new Uint32Array(4))).join('-'));
 const PROFILE=['projIndicator','projAddress','statRepose','isoClass','isoDesc','hazardGrade','exposureAmt','exposureBasis','dramScore','resConstPct','comConstPct','punitveDmg','website'];
 const NARRATIVE=['descOps','guidelineConflicts','expLoss','acctStrengths','pricingRationale'];
 const LABELS=['Summary of operations','Guideline conflicts','Exposure to loss','Strengths of the account','Underwriting narrative / pricing rationale'];
 const SOURCES=['A6','A8','A15','A16','Underwriter'];
 global.STMWorkbenchPhase7={install(ctx){
  const {api,edits,markDirty,mirror,changed,recordHistory,replaceHistory}=ctx;
  const host=global.parent?.STM_RUNTIME,doc=global.document,$=id=>doc.getElementById(id),native=()=>global.__STM_NATIVE_FORMS;
  const standard=()=>Array.from(doc.querySelectorAll('#form-subjectivities .subjectivity-entry:not(.other-subjectivity)'));
  const customEls=()=>Array.from(doc.querySelectorAll('#form-subjectivities .other-input-group textarea'));
  const formRows=()=>Array.from(doc.querySelectorAll('#formsContainer .form-row'));
  let forms=null,subjects=null,historyOwned=false,restoring=false,busy=false,sourceUW=null;
  const editingBefore=new Map();
  function owner(sid){
   if(api.restoreError)throw new Error(api.restoreError);
   if(sid==null&&!api.submissionId&&global.currentUser){const r0=host;if(r0&&(r0.workbenchWindow!==global||r0.activeId))throw new Error('Stale workbench action rejected.');return;}
   if(!sid||api.submissionId!==sid||!global.currentUser)throw new Error('The submission is no longer active. Reopen it.');
   const r=host;if(r&&(r.activeId!==sid||r.workbenchWindow!==global||r.user?.id!==global.currentUser.id))throw new Error('Stale workbench action rejected.');
  }
  function nativeCheck(cb,on){cb.checked=on;cb.dataset.stmExplicitEdit='1';cb.dispatchEvent(new Event('change',{bubbles:true}));markDirty(cb);}
  function labelText(entry){const n=entry.querySelector('.checkbox-label')?.cloneNode(true);n?.querySelectorAll('input,.subjectivity-suggest-chip').forEach(x=>x.remove());return n?.textContent.trim()||'';}
  function formRead(row){
   row.dataset.phase7Key ||= uid();
   return {key:row.dataset.phase7Key,num:row.dataset.formNum||'',name:row.querySelector('.form-name')?.childNodes[0]?.textContent.trim()||'',category:row.dataset.category||row.closest('.form-category-section')?.querySelector('h4')?.textContent||'Custom forms',def:row.dataset.default==='true',on:!!row.querySelector('input')?.checked,ind:row.classList.contains('form-row--indicated'),reason:row.title||''};
  }
  function formsSnapshot(){return {layer:native().selection().key,rows:formRows().map(row=>{const {ind,reason,...r}=formRead(row);return r;})};}
  function subjectsSnapshot(){
   return {choices:Object.fromEntries(standard().map(e=>{const cb=e.querySelector('input');return [cb.id,cb.checked];})),items:customEls().map(el=>{
    el.dataset.phase7Key ||= uid();return {key:el.dataset.phase7Key,text:el.value,on:el.dataset.phase7On!==undefined?el.dataset.phase7On==='1':!!$('otherSubjectivityCheckbox').checked};
   }).filter(x=>x.text.trim())};
  }
  function setCustom(items){
   const panel=doc.querySelector('.other-details-panel');panel.querySelectorAll('.other-input-group').forEach(e=>e.remove());
   for(const item of items){const wrap=doc.createElement('div');wrap.className='other-input-group';const el=doc.createElement('textarea');el.rows=2;el.placeholder='Enter other subjectivity...';el.dataset.phase7Key=item.key;el.dataset.phase7On=item.on?'1':'0';el.value=item.text;el.disabled=!item.on;wrap.append(el);panel.insertBefore(wrap,panel.querySelector('.add-other-btn'));}
   const cb=$('otherSubjectivityCheckbox');cb.checked=items.some(x=>x.on);cb.dispatchEvent(new Event('change',{bubbles:true}));
   // Empty native row is a draft, not an applied blank subjectivity.
   if(!items.length){const wrap=doc.createElement('div');wrap.className='other-input-group';const el=doc.createElement('textarea');el.rows=2;el.placeholder='Enter other subjectivity...';el.dataset.phase7On='0';wrap.append(el);panel.insertBefore(wrap,panel.querySelector('.add-other-btn'));}
  }
  function getHistory(){return api.history().map(e=>({...e,id:e.id||uid()})).slice(0,75);}
  function capture(){
   if(restoring||!api.submissionId)return;
   const data={v:1};if(forms){forms=formsSnapshot();data.forms=clone(forms);}if(subjects){subjects=subjectsSnapshot();data.subjects=clone(subjects);}if(historyOwned)data.history=getHistory();
   if(Object.keys(data).length>1){const prev=edits.map.__phase7;if(!prev||JSON.stringify(prev.data)!==JSON.stringify(data))edits.map.__phase7={data,t:Date.now()};}
  }
  function finish(){capture();changed();mirror();}
  function touchForms(){forms=formsSnapshot();edits.formsDirty=true;edits.removed.delete('__forms');}
  function findForm(key){const row=formRows().find(e=>formRead(e).key===key);if(!row)throw new Error('This form is no longer on the schedule.');return row;}
  function describe(el){if(!el)return null;return {key:el.id,value:el.value,tag:el.tagName.toLowerCase(),type:el.type||'text',readonly:!!el.readOnly,disabled:!!el.disabled,placeholder:el.placeholder||'',money:el.classList.contains('currency-input'),options:el.options?Array.from(el.options).map(o=>({value:o.value,label:o.textContent,disabled:o.disabled})):null,min:el.min||null,max:el.max||null,step:el.step||null,filled:el.classList.contains('autofilled-from-platform')};}
  function validate(saved){
   if(!saved)return true;const fail=()=>{throw new Error('Saved review-page structure is invalid. No edits were applied. Keep your recovery copy and reopen a valid version.');};
   const d=saved.data;if(!object(d)||d.v!==1||Object.keys(d).some(k=>!['v','forms','subjects','history'].includes(k)))fail();
   const str=(s,max,empty=true)=>typeof s==='string'&&s.length<=max&&(empty||s.trim().length>0);
   if(own(d,'forms')){const f=d.forms;if(!object(f)||!['Lead','Excess',null].includes(f.layer)||!Array.isArray(f.rows)||f.rows.length>500||!f.layer&&f.rows.length)fail();const keys=new Set(),numbers=new Set();
    for(const r of f.rows){if(!object(r)||!str(r.key,100,false)||!/^[a-zA-Z0-9_-]+$/.test(r.key)||keys.has(r.key)||!str(r.num,200,false)||numbers.has(r.num.trim().toUpperCase())||!str(r.name,1000,false)||!str(r.category,200,false)||typeof r.def!=='boolean'||typeof r.on!=='boolean')fail();keys.add(r.key);numbers.add(r.num.trim().toUpperCase());}}
   if(own(d,'subjects')){const s=d.subjects;if(!object(s)||!object(s.choices)||!Array.isArray(s.items)||s.items.length>500)fail();const ids=new Set(standard().map(e=>e.querySelector('input').id)),keys=new Set();for(const [k,v]of Object.entries(s.choices))if(!ids.has(k)||typeof v!=='boolean')fail();for(const i of s.items){if(!object(i)||!str(i.key,100,false)||!/^[a-zA-Z0-9_-]+$/.test(i.key)||keys.has(i.key)||!str(i.text,20000,false)||typeof i.on!=='boolean')fail();keys.add(i.key);}}
   if(own(d,'history')){if(!Array.isArray(d.history)||d.history.length>75)fail();const keys=new Set();for(const e of d.history){if(!object(e)||!str(e.id,150,false)||keys.has(e.id)||!str(e.at,60,false)||!Number.isFinite(Date.parse(e.at))||!str(e.action,1000)||!str(e.detail,100000)||e.actor!==undefined&&!str(e.actor,1000)||e.userId!=null&&!str(e.userId,200))fail();keys.add(e.id);}}
   return true;
  }
  function library(){const layer=native().selection().key;return Object.entries(native().catalog()[layer]||{}).flatMap(([category,rows])=>rows.map(r=>({num:r.num,name:r.name,def:!!r.def,category})));}
  function append(form){if(formRows().length>=500)throw new Error('The form schedule is limited to 500 entries.');if(formRows().some(r=>String(r.dataset.formNum).trim().toUpperCase()===String(form.num).trim().toUpperCase()))throw new Error('That form number is already on the schedule.');const row=native().append(form);row.dataset.phase7Key=form.key||uid();return row;}
  const bridge={ready:true,capture,validate,
   historyRecorded(){if(!restoring&&!edits.restoring&&api.submissionId)historyOwned=true;},
   preserveForms(layer){if(!forms)return false;if(forms.layer===layer)return true;forms=null;edits.formsDirty=false;edits.removed.add('__forms');return false;},
   rememberSource(){sourceUW=Object.fromEntries([...PROFILE,...NARRATIVE].map(id=>[id,$(id)?.value||'']));},
   restore(saved){if(!saved)return;validate(saved);const d=clone(saved.data);restoring=true;try{
    if(d.forms){if(d.forms.layer!==native().selection().key)throw new Error('Saved forms belong to another layer family. Restore the matching layer type before saving.');native().rebuild(d.forms.rows);formRows().forEach((row,i)=>row.dataset.phase7Key=d.forms.rows[i].key);forms=d.forms;edits.formsDirty=true;}
    if(d.subjects){subjects=d.subjects;for(const [id,on]of Object.entries(subjects.choices))$(id).checked=on;setCustom(subjects.items);}
    if(d.history){replaceHistory(d.history.slice().sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,75));historyOwned=true;}
   }finally{restoring=false;}capture();},
   read(sid){owner(sid);const fs=formRows().map(formRead),sub=standard().map(e=>{const cb=e.querySelector('input');return {key:cb.id,text:labelText(e),on:cb.checked,tag:e.classList.contains('subjectivity-strong')?'ind':e.classList.contains('subjectivity-suggested')?'sug':'std',reason:e.title||''};});
    return {id:sid,revision:api.revision,dirty:api.dirty,busy,layer:native().selection(),forms:fs,library:library(),subjects:sub,custom:subjectsSnapshot().items,profile:Object.fromEntries(PROFILE.map(id=>[id,describe($(id))])),narrative:NARRATIVE.map((id,i)=>({...describe($(id)),label:LABELS[i],source:SOURCES[i]})),history:getHistory(),owned:{forms:!!forms,subjects:!!subjects,underwriting:[...PROFILE,...NARRATIVE].some(id=>own(edits.map,id))}};
   },
   set(sid,key,value,final=true){owner(sid);if(busy)throw new Error('A review action is still running.');if(![...PROFILE,...NARRATIVE].includes(key))throw new Error('Unknown review field.');const el=$(key);if(!el||el.readOnly||el.disabled)throw new Error('This field is calculated by the original application.');if(!['string','number'].includes(typeof value)||String(value).length>100000)throw new Error('Invalid field value.');
    if(el.options&&!Array.from(el.options).some(o=>o.value===String(value)&&!o.disabled))throw new Error('Invalid selection.');
    if(['resConstPct','comConstPct'].includes(key)&&value!==''&&(!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100))throw new Error('Construction percentages must be between 0 and 100.');
    if(!editingBefore.has(key))editingBefore.set(key,el.value);const before=editingBefore.get(key);el.value=String(value);el.dataset.stmExplicitEdit='1';el.dataset.userSet='1';el.dispatchEvent(new Event('input',{bubbles:true}));if(final){el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('blur'));}
    markDirty(el);if(final){if(before!==el.value)recordHistory('Underwriting edited',key);editingBefore.delete(key);}finish();return describe(el);
   },
   async action(sid,act,data={}){owner(sid);if(busy)throw new Error('A review action is still running.');
    if(act==='uw:restore'){
     if(!NARRATIVE.includes(data.key))throw new Error('Unknown narrative.');const el=$(data.key);delete edits.map[data.key];edits.removed.add(data.key);delete el.dataset.userSet;delete el.dataset.stmExplicitEdit;const sourceFields={descOps:'description_operations',guidelineConflicts:'guideline_conflicts_text',expLoss:'exposure_to_loss',acctStrengths:'account_strengths'};const resolved=data.key==='pricingRationale'?null:global.WorkbenchRules.resolveField(sourceFields[data.key],global.workbenchActiveSubmission);el.value=resolved?.value==null?'':String(resolved.value);editingBefore.delete(data.key);recordHistory('Narrative restored',data.key);finish();return true;
    }
    if(act==='uw:reset'){
     busy=true;try{for(const id of [...PROFILE,...NARRATIVE]){const el=$(id);if(!el||el.readOnly)continue;delete edits.map[id];edits.removed.add(id);delete el.dataset.userSet;delete el.dataset.stmExplicitEdit;el.value=sourceUW?.[id]||'';}
      editingBefore.clear();await global.__stmApplyPhasePipeline(global.workbenchActiveSubmission);owner(sid);recordHistory('Underwriting reset','Pipeline risk profile and narratives restored; pricing rationale cleared.');finish();return true;
     }finally{busy=false;}}
    if(act.startsWith('forms:')){
     if(act==='forms:toggle'){const row=findForm(data.key),cb=row.querySelector('input');nativeCheck(cb,!cb.checked);recordHistory('Form selection changed',row.dataset.formNum);}
     else if(act==='forms:all'){const check=doc.querySelector('#formsContainer .select-all-forms');if(!check||check.disabled)throw new Error('Choose a layer before selecting forms.');check.checked=typeof data.on==='boolean'?data.on:!formRows().every(r=>r.querySelector('input').checked);check.dispatchEvent(new Event('change',{bubbles:true}));}
     else if(act==='forms:remove'){findForm(data.key).querySelector('[data-form-action="remove"]').click();}
     else if(act==='forms:reset'){const l=native().selection().key;if(!l)throw new Error('Choose a layer first.');native().populate(l);recordHistory('Forms reset',l+' default schedule restored');}
     else if(act==='forms:add'){
      const picks=Array.isArray(data.nums)?data.nums:[];const available=library();if(!picks.length||new Set(picks).size!==picks.length||formRows().length+picks.length>500)throw new Error('Choose valid distinct library forms.');const rows=picks.map(n=>available.find(r=>r.num===n));if(rows.some(r=>!r)||rows.some(r=>formRows().some(e=>e.dataset.formNum.trim().toUpperCase()===r.num.trim().toUpperCase())))throw new Error('One of the selected forms is unavailable or already present.');rows.forEach(r=>append({...r,on:true}));recordHistory('Library forms added',picks.join(', '));
     }else if(act==='forms:custom'){const num=String(data.num||'').trim(),name=String(data.name||'').trim();if(!num||!name||num.length>200||name.length>1000)throw new Error('Enter a form number (up to 200 characters) and name (up to 1,000 characters).');append({num,name,category:'Custom forms',def:false,on:true});recordHistory('Form added',num+' - '+name);}
     else throw new Error('Unsupported form action.');touchForms();finish();return true;
    }
    if(act.startsWith('subj:')){
     let next=subjectsSnapshot();
     if(act==='subj:toggle'){const cb=$(data.key);if(!cb||!standard().some(e=>e.contains(cb)))throw new Error('This condition is no longer available.');nativeCheck(cb,!cb.checked);}
     else if(act==='subj:all'){const on=typeof data.on==='boolean'?data.on:!([...standard().map(e=>e.querySelector('input').checked),...next.items.map(i=>i.on)].every(Boolean));standard().forEach(e=>nativeCheck(e.querySelector('input'),on));next.items.forEach(i=>i.on=on);setCustom(next.items);}
     else if(act==='subj:add'){const text=String(data.text||'').trim();if(!text||text.length>20000)throw new Error('Enter a condition up to 20,000 characters.');if(next.items.length>=500)throw new Error('At most 500 custom conditions are supported.');next.items.push({key:uid(),text,on:true});setCustom(next.items);}
     else if(act==='subj:reset'){standard().forEach(e=>nativeCheck(e.querySelector('input'),false));setCustom([]);}
     else if(['subj:custom-toggle','subj:remove','subj:edit'].includes(act)){const item=next.items.find(i=>i.key===data.key);if(!item)throw new Error('This custom condition was removed.');if(act==='subj:custom-toggle')item.on=!item.on;else if(act==='subj:remove')next.items=next.items.filter(i=>i.key!==data.key);else{const text=String(data.text??'').trim();if(!text||text.length>20000)throw new Error('Enter a condition up to 20,000 characters.');item.text=text;}setCustom(next.items);}
     else throw new Error('Unsupported subjectivity action.');subjects=subjectsSnapshot();recordHistory('Subjectivities edited',act.slice(5));finish();return true;
    }
    throw new Error('Unsupported review action.');
   },
   record(sid,action,detail){owner(sid);recordHistory(action,detail);finish();},
   schedule(sid,keys=null){owner(sid);return formRows().map(formRead).filter(r=>keys?keys.includes(r.key):r.on).map(({num,name,category,on})=>({num,name,category,on}));}
  };
  global.__STM_WB_PHASE7=bridge;return bridge;
 }};
})(window);
