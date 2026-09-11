/* Structural persistence retained from RC1. No separate application document or UI projection. */
/* Phase 9: the Renewal chapter and the deal type switch.
 * July's renewal handlers (setupTypeSelector, setupYOY, setupERC, setupRenewalAutoRater)
 * stay the calculation and formatting authority. This module only maps their controls
 * to the redesigned page and records the year-over-year and effective-rate-change
 * worksheets in the existing workbench_field_edits store (July never persisted them).
 * The fleet comparison (July's #autoTable) is served through the Phase 6 adapter.
 */
(function (global) {
  'use strict';
  const clone = x => JSON.parse(JSON.stringify(x));
  const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
  const YOY_ROWS = ['gross', 'glPrem', 'glRate', 'alPrem', 'autoUnits', 'autoRates', 'comm', 'lead', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'];
  const COMPUTED = ['glRate', 'autoRates'];
  const ERC = ['expGlExp', 'expAlExp', 'expPrem', 'splitGl', 'splitAl', 'renGlExp', 'renAlExp', 'renPrem'];
  const ERC_OUT = ['premGl', 'premAl', 'premTotal', 'rateGl', 'rateAl', 'flatGl', 'flatAl', 'flatTotal', 'renGl', 'renAl'];
  const SUMMARY = ['expGlExp', 'expAlExp', 'expPrem', 'splitGl', 'splitAl', 'renGlExp', 'renAlExp', 'renPrem', 'erc'];
  const SCALARS = ['typeSelect', 'glPer', 'commentsTxt'];
  global.STMWorkbenchPhase9 = { install(ctx) {
    const { api, edits, markDirty, mirror, changed, recordHistory } = ctx;
    const doc = global.document, $ = id => doc.getElementById(id);
    const runtime = null;
    let dirty = false, mutating = false;
    const yoyEl = (row, i) => doc.querySelector('.yoy-input[data-row="' + row + '"][data-idx="' + i + '"]');
    const ercEl = k => doc.querySelector('[data-erc="' + k + '"]');
    function assertOwner(sid) {
      if(global.__STM_NATIVE_SESSION_BLOCKED || (api.ownerId && api.ownerId!==global.currentUser?.id))throw new Error('Session changed. Reopen the submission.');if (api.restoreError) throw new Error(api.restoreError);
      if (!global.currentUser || !sid || api.submissionId !== sid) throw new Error('This workbench session is no longer active. Reopen the submission.');
      const r = runtime;
      if (r && (r.activeId !== sid || r.workbenchWindow !== global || r.user?.id !== global.currentUser.id)) throw new Error('Stale renewal action rejected. Reopen the submission.');
    }
    function fire(el, final) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (final) { el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: false })); }
    }
    function touch() { dirty = true; capture(); changed(); mirror(); }
    function snapshot() {
      const yoy = {};
      doc.querySelectorAll('.yoy-input').forEach(el => { yoy[el.dataset.row + ':' + el.dataset.idx] = { v: String(el.value ?? ''), e: el.dataset.userEdited === '1' ? 1 : 0 }; });
      const erc = {};
      ERC.forEach(k => { const el = ercEl(k); if (el) erc[k] = { v: String(el.value ?? '') }; });
      return { v: 1, yoy, erc };
    }
    function capture() {
      if (!dirty && !edits.map.__phase9) return;
      const data = snapshot();
      const prev = edits.map.__phase9;
      if (!prev || JSON.stringify(prev.data) !== JSON.stringify(data)) edits.map.__phase9 = { data: clone(data), t: Date.now() };
    }
    function validate(rec) {
      if (!rec) return true;
      const fail = () => { throw new Error('Saved renewal structure is invalid. No renewal edits were applied. Keep the recovery data and reopen a valid version.'); };
      const s = rec.data;
      if (!object(s) || s.v !== 1 || !object(s.yoy) || !object(s.erc)) fail();
      if(Object.keys(s.yoy).length!==60||Object.keys(s.erc).length!==8)fail();
      for (const [k, val] of Object.entries(s.yoy)) {
        const p = k.split(':');
        if (p.length !== 2 || !YOY_ROWS.includes(p[0]) || !/^[0-3]$/.test(p[1]) || !object(val) || typeof val.v !== 'string' || val.v.length > 100 || ![0, 1].includes(val.e)) fail();
      }
      for (const [k, val] of Object.entries(s.erc)) {
        if (!ERC.includes(k) || !object(val) || typeof val.v !== 'string' || val.v.length > 100) fail();
      }
      return true;
    }
    function restore(rec) {
      if (!rec) return;
      validate(rec);
      const s = rec.data;
      for (const [k, val] of Object.entries(s.yoy)) {
        const [row, idx] = k.split(':');
        const el = yoyEl(row, idx);
        if (!el) continue;
        el.value = val.v;
        el.dataset.userEdited = val.e ? '1' : '0';
      }
      for (const [k, val] of Object.entries(s.erc)) { const el = ercEl(k); if (el) el.value = val.v; }
      // Recalculate through July's own listeners (one event per worksheet).
      const first = yoyEl('gross', 0); if (first) first.dispatchEvent(new Event('input', { bubbles: true }));
      const e0 = ercEl('expGlExp'); if (e0) e0.dispatchEvent(new Event('input', { bubbles: true }));
      dirty = true;
    }
    function describeCell(el) { return { v: el ? String(el.value ?? '') : '', edited: el?.dataset.userEdited === '1' }; }
    function years() {
      return Array.from(doc.querySelectorAll('#yoyTable thead th')).map(th => th.textContent.trim()).filter(t => /^\d{4}$/.test(t));
    }
    function readYoy() {
      const labels = {};
      doc.querySelectorAll('#yoyTable tbody tr').forEach(tr => { const el = tr.querySelector('.yoy-input'); if (el) labels[el.dataset.row] = tr.cells[0].textContent.trim(); });
      return YOY_ROWS.map(row => {
        const first = yoyEl(row, 0);
        const cells = [0, 1, 2, 3].map(i => describeCell(yoyEl(row, i)));
        const vars = [0, 1, 2].map(i => {
          const td = doc.querySelector('[data-var="' + row + '"][data-from="' + i + '"]');
          const c = td?.style.color || '';
          return { text: td ? td.textContent.trim() : '', dir: /success/.test(c) ? 'up' : /danger/.test(c) ? 'down' : '' };
        });
        return { id: row, label: labels[row] || row, type: first?.dataset.type || 'currency', computed: COMPUTED.includes(row), cells, vars };
      });
    }
    function readErc() {
      const inputs = {}; ERC.forEach(k => { const el = ercEl(k); inputs[k] = { v: el ? String(el.value ?? '') : '', placeholder: el?.placeholder || '' }; });
      const outputs = {}; ERC_OUT.forEach(k => { outputs[k] = doc.querySelector('[data-erc-out="' + k + '"]')?.textContent.trim() || ''; });
      const summary = {}; SUMMARY.forEach(k => { summary[k] = doc.querySelector('[data-summary-out="' + k + '"]')?.textContent.trim() || ''; });
      const badge = doc.querySelector('.erc-badge');
      const state = badge?.classList.contains('is-positive') ? 'pos' : badge?.classList.contains('is-negative') ? 'neg' : 'flat';
      return { inputs, outputs, summary, pct: $('ercPct')?.textContent.trim() || '', state, glPerEcho: $('glPerEcho')?.textContent.trim() || '' };
    }
    function readFleet(sid) {
      const p6 = global.__STM_WB_PHASE6;
      if (!p6?.ready) return { rows: [], text: {} };
      const m = p6.read(sid);
      return { rows: m.tables.auto || [], text: m.text || {} };
    }
    const bridge = {
      ready: true, capture, validate, restore,
      beginNative(el){assertOwner(api.submissionId);if(edits.restoring)return false;if(el?.matches('.yoy-input')&&COMPUTED.includes(el.dataset.row))el.dataset.userEdited='1';dirty=true;return true;},
      commitNative(){assertOwner(api.submissionId);if(!edits.restoring){const first=yoyEl('gross',0),erc=ercEl('expGlExp');first?.dispatchEvent(new Event('input',{bubbles:true}));erc?.dispatchEvent(new Event('input',{bubbles:true}));touch();global.dispatchEvent(new Event('stm:worksheets-updated'));}},
      type() { return $('typeSelect')?.value === 'Renewal' ? 'Renewal' : 'New'; },
      read(sid) {
        assertOwner(sid);
        return {
          id: sid, revision: api.revision, dirty: api.dirty,
          type: bridge.type(),
          years: years(),
          glPer: String($('glPer')?.value ?? ''),
          comments: String($('commentsTxt')?.value ?? ''),
          yoy: readYoy(),
          erc: readErc(),
          fleet: readFleet(sid),
          polEff: String($('polEff')?.value || $('polEff')?._flatpickr?.altInput?.value || '')
        };
      },
      set(sid, key, value, final = true) {
        assertOwner(sid);
        if (!['string', 'number'].includes(typeof value) || String(value).length > 100000) throw new Error('Invalid field value.');
        const p = String(key).split('|');
        if (p[0] === 'r' && p[1] === 'auto') {
          const result = global.__STM_WB_PHASE6.set(sid, key, value, final);
          return { v: result?.value ?? String(value) };
        }
        let el = null;
        if (p[0] === 's' && p.length === 2 && SCALARS.includes(p[1])) el = $(p[1]);
        else if (p[0] === 'y' && p.length === 3 && YOY_ROWS.includes(p[1]) && /^[0-3]$/.test(p[2])) el = yoyEl(p[1], p[2]);
        else if (p[0] === 'e' && p.length === 2 && ERC.includes(p[1])) el = ercEl(p[1]);
        if (!el) throw new Error('Unknown renewal field.');
        if (el.tagName === 'SELECT' && !Array.from(el.options).some(o => o.value === String(value))) throw new Error('Invalid deal type.');
        el.value = String(value);
        if (p[0] === 'y' && COMPUTED.includes(p[1])) el.dataset.userEdited = '1';
        fire(el, final);
        if (p[0] === 's') { markDirty(el); changed(); mirror(); }
        else touch();
        if (p[0] === 's' && p[1] === 'typeSelect' && final) recordHistory('Deal type set', String(value));
        return { v: String(el.value ?? '') };
      },
      setType(sid, type) {
        if (!['New', 'Renewal'].includes(type)) throw new Error('Invalid deal type.');
        return bridge.set(sid, 's|typeSelect', type, true);
      },
      action(sid, action) {
        assertOwner(sid);
        if (mutating) throw new Error('A renewal action is already in progress.');
        mutating = true;
        try {
          if (action === 'yoy:reset') { $('yoyReset')?.click(); touch(); recordHistory('Renewal metrics reset', 'Year-over-year metrics'); return true; }
          throw new Error('Unknown renewal action.');
        } finally { mutating = false; }
      }
    };
    global.__STM_WB_PHASE9 = bridge;
    return bridge;
  } };
})(window);

/* Phase 5: presentation adapter for the July workbench.
 * The DOM below remains the original application's calculation/input surface.
 * This adapter adds structural persistence, not a replacement rating engine.
 */
(function(global){
 'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x));
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
 const scalarIds=['dealName','polEff','polExp','homeState','admission','clearedFor','businessUnit','subBusinessUnit','layerType','underwriter','assistant','paper','subDate','quoteExp','targetDate','createDate'];
 const lossConfig={gl:{years:'glLossRows',large:'glLargeLossRows',add:'addGlYear',remove:'removeGlYear',addLarge:'addGlLargeLoss',removeLarge:'removeGlLargeLoss',noLoss:'noLossesGlChk'},auto:{years:'autoLossRows',large:'autoLargeLossRows',add:'addAutoYear',remove:'removeAutoYear',addLarge:'addAutoLargeLoss',removeLarge:'removeAutoLargeLoss',noLoss:'noLossesAutoChk'}};
 function controls(root){return root?Array.from(root.querySelectorAll('input,select,textarea')).filter(el=>!el.matches('.flatpickr-alt-input,.stm-date-alt-input')&&el.dataset.stmDateAlt!=='1'&&!(el.previousElementSibling?._flatpickr?.altInput===el)):[];}
 function dateControl(el){return !!el && (el.type==='date'||el.matches('.date,.limit-date,.loss-date-picker,.large-loss-date')||['polEff','polExp','subDate','quoteExp','targetDate','createDate'].includes(el.id));}
 function dateISO(v){v=String(v||'').trim();if(!v)return '';let m=v.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m){let a=v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);if(!a)return '';m=['',a[3].length===2?'20'+a[3]:a[3],a[1].padStart(2,'0'),a[2].padStart(2,'0')];}const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));return d.getFullYear()===+m[1]&&d.getMonth()===+m[2]-1&&d.getDate()===+m[3]?m.slice(1).join('-'):'';}
 global.STMWorkbenchPhase5={install(ctx){
  const {api,edits,applyEl,markDirty,mirror,changed,recordHistory,addCoverageEntry,coverageTypes,initDates,recalc,applyLayer}=ctx;
  const doc=global.document,$=id=>doc.getElementById(id);
  let extension={v:1,loss:{},coverage:null,coverageAll:false,touched:[],views:{},dialogs:{},blanks:[]};
  let mutation=false;
  const initialDefault=new Map(),initialDefaultGroups=new Map();
  function categoryNodes(){return Array.from(doc.querySelectorAll('#risk-limits .limits-category')).map(cat=>{const list=cat.querySelector('.limits-list')||cat;const id=list.id?.replace('-limits-list','')||(cat.dataset.visibility==='lead-only'?'lead':'');return {cat,list,id,name:cat.querySelector('h3,h4')?.textContent.trim()||id};}).filter(x=>x.id);}
  function entries(list){return Array.from(list.querySelectorAll('.limit-entry')).filter(e=>!e.closest('.limit-templates'));}
  function cleanClone(node){const n=node.cloneNode(true);n.querySelectorAll('.flatpickr-alt-input,.stm-date-alt-input,[data-stm-date-alt="1"]').forEach(e=>e.remove());n.querySelectorAll('input').forEach(e=>{if(dateControl(e)){e.type='text';e.classList.remove('flatpickr-input');delete e.dataset.stmDateHiddenCanonical;}});return n;}
  categoryNodes().forEach(g=>entries(g.list).forEach(e=>{const panel=e.querySelector('.limit-details-panel');if(e.classList.contains('default-entry')&&panel){initialDefault.set(panel.id,cleanClone(e));initialDefaultGroups.set(panel.id,g.id);}}));
  function assertOwner(sid){if(global.__STM_NATIVE_SESSION_BLOCKED || (api.ownerId && api.ownerId!==global.currentUser?.id))throw new Error('Session changed. Reopen the submission.');if(api.restoreError)throw new Error(api.restoreError);if(!api.submissionId||sid!==api.submissionId||!global.currentUser)throw new Error('This workbench session is no longer active. Reopen the submission.');}
  function descriptors(elements,prefix){return elements.map((el,i)=>describe(el,prefix+i));}
  function describe(el,key){if(!el)return null;let label=el.closest('label')?.cloneNode(true);label?.querySelectorAll('input,select,textarea,svg,button').forEach(n=>n.remove());return {key,id:el.id||'',label:label?.textContent.replace(/\s+/g,' ').trim()||el.getAttribute('aria-label')||el.placeholder||'',tag:el.tagName.toLowerCase(),value:el.type==='checkbox'?el.checked:dateControl(el)?dateISO(el.value):el.value,raw:el.value,date:dateControl(el),money:el.classList.contains('currency-input'),readonly:!!el.readOnly,disabled:!!el.disabled,type:el.type||'',placeholder:el.placeholder||'',required:!!el.required,maxLength:el.maxLength>0?el.maxLength:null,min:el.getAttribute('min'),max:el.getAttribute('max'),step:el.getAttribute('step'),options:el.options?Array.from(el.options).map(o=>({value:o.value,label:o.textContent,disabled:o.disabled,group:o.parentElement.tagName==='OPTGROUP'?o.parentElement.label:''})):null,policy:!!el.closest('.policy-options-panel'),filled:el.classList.contains('autofilled-from-platform'),warning:el.classList.contains('money-input-rejected')?'Invalid amount was cleared. Use a non-negative amount or K/M/B notation.':el.classList.contains('money-input-coerced')?'Amount was normalized by the original parser.':''};}
  function lossRows(line,kind){const c=lossConfig[line];if(!c)throw new Error('Unknown loss line');return Array.from($(kind==='large'?c.large:c.years).querySelectorAll(kind==='large'?'.large-loss-row':'.loss-row'));}
  function assignRowKeys(line,kind){return lossRows(line,kind).map(row=>{if(!row.dataset.phase5Key)row.dataset.phase5Key='r'+(global.crypto.randomUUID?.()||Array.from(global.crypto.getRandomValues(new Uint32Array(4))).join('-'));return row;});}
  function lossSnapshot(line){const c=lossConfig[line];return {noLoss:$(c.noLoss).checked,years:assignRowKeys(line,'years').map(row=>({key:row.dataset.phase5Key,cells:controls(row).map(api.serializeElement)})),large:assignRowKeys(line,'large').map(row=>({key:row.dataset.phase5Key,cells:controls(row).map(api.serializeElement)}))};}
  function panelId(entry){return entry.querySelector('.limit-details-panel')?.id||'';}
  function applyTitle(entry,title){entry.dataset.phase5Title=title;const input=entry.querySelector('[data-native-title]');if(input){input.value=title;return;}const el=entry.querySelector('.limit-entry-header .checkbox-label span,.limit-entry-name');if(el)el.textContent=title;}
  function normalizeEntry(entry){global.stmNormalizeCoverageNative(entry);}
  function coverageSnapshot(){return categoryNodes().map(g=>({id:g.id,items:entries(g.list).map((e,position)=>{const p=e.querySelector('.limit-details-panel');return {position,id:p.id,type:e.dataset.coverageType||'',defaultKey:e.dataset.phase5Default||(initialDefault.has(p.id)?p.id:null),title:e.dataset.phase5Title||null,included:!!e.querySelector('input[data-target]')?.checked,open:p.classList.contains('visible'),policyLayer:e.querySelector('input[data-policy-layer]')?.checked??null,fields:controls(p).map(api.serializeElement)};}).filter(e=>extension.coverageAll||extension.touched.includes(e.type))}));}
  function touchType(type){if(!extension.touched.includes(type))extension.touched.push(type);extension.coverage=coverageSnapshot();}
  function capture(){Object.keys(extension.loss).forEach(l=>extension.loss[l]=lossSnapshot(l));if(extension.coverage)extension.coverage=coverageSnapshot();if(Object.keys(extension.loss).length||extension.coverage||Object.keys(extension.dialogs).length||Object.keys(extension.views).length||extension.blanks.length){const prior=edits.map.__phase5;if(!prior||JSON.stringify(prior.data)!==JSON.stringify(extension))edits.map.__phase5={data:clone(extension),t:Date.now()};}}
  function persist(){capture();changed();mirror();}
  function setElement(el,value){if(!el||el.disabled||el.readOnly)throw new Error('This field is derived or unavailable.');if(el.tagName==='SELECT'&&!Array.from(el.options).some(o=>o.value===String(value)&&!o.disabled))throw new Error('Invalid selection.');if(dateControl(el)&&value&&!dateISO(value))throw new Error('Enter a valid calendar date.');el.dataset.stmExplicitEdit='1';applyEl(el,el.type==='checkbox'?{c:!!value}:{v:dateControl(el)?dateISO(value):String(value??'')},true);el.dataset.stmExplicitEdit='1';if(el.type!=='checkbox'&&el.value===''){const key=el.id||(el.name?'name:'+el.name:null);if(key&&!extension.blanks.includes(key))extension.blanks.push(key);}markDirty(el);return describe(el,el.id);}
  function restoreCells(root,values){const els=controls(root);values.forEach((v,i)=>{const el=els[i];if(!el)return;if(el.tagName==='SELECT'&&own(v,'v')&&!Array.from(el.options).some(o=>o.value===String(v.v))){const opt=doc.createElement('option');opt.value=String(v.v);opt.textContent=String(v.v);el.add(opt);}if(el.readOnly){if(own(v,'v'))el.value=v.v;return;}applyEl(el,v,false);el.dataset.stmExplicitEdit='1';});}
  function restoreLoss(line,saved){const c=lossConfig[line];for(const kind of ['years','large']){const rows=saved[kind];if(!Array.isArray(rows)||rows.length>1000||kind==='years'&&!rows.length)throw new Error('Invalid saved loss rows');let current=lossRows(line,kind);while(current.length>rows.length){current[current.length-1].remove();current.pop();}let count=0;while(current.length<rows.length){$(kind==='years'?c.add:c.addLarge).click();current=lossRows(line,kind);if(++count>rows.length+2)throw new Error('Loss table could not be restored');}rows.forEach((r,i)=>{current[i].dataset.phase5Key=r.key;restoreCells(current[i],r.cells);});if(kind==='large'&&!rows.length){$(c.large).querySelectorAll('.large-loss-header').forEach(n=>n.remove());const prev=$(c.large).previousElementSibling;if(prev?.classList.contains('large-losses-heading'))prev.remove();}}
   $(c.noLoss).checked=!!saved.noLoss;
  }
  function restoreCoverage(saved){if(!Array.isArray(saved))return;for(const g of categoryNodes()){const group=saved.find(x=>x.id===g.id);if(!group)continue;if(!Array.isArray(group.items)||group.items.length>500)throw new Error('Invalid coverage snapshot');entries(g.list).forEach((e,i)=>e.dataset.p5RestoreOrder=i);entries(g.list).filter(e=>extension.coverageAll||extension.touched.includes(e.dataset.coverageType)).forEach(e=>{controls(e).forEach(el=>{try{el._flatpickr?.destroy();}catch(_){}});e.remove();});for(const s of group.items){let e;if(s.defaultKey&&initialDefault.has(s.defaultKey)){e=cleanClone(initialDefault.get(s.defaultKey));g.list.appendChild(e);initDates(e);e.dataset.phase5Default=s.defaultKey;}else{if(!own(coverageTypes[g.id]||{},s.type))throw new Error('Unknown saved coverage type: '+s.type);e=addCoverageEntry(s.type,g.list);}if(!e)throw new Error('Unable to restore coverage');e.dataset.p5RestoreOrder=s.position??999;const p=e.querySelector('.limit-details-panel');p.id=s.id;const cb=e.querySelector('input[data-target]');if(cb){cb.dataset.target=s.id;cb.checked=!!s.included;}const cl=e.querySelector('input[data-policy-layer]');if(cl)cl.checked=!!s.policyLayer;e.querySelector('.policy-options-panel')?.classList.toggle('visible',!!s.policyLayer);p.classList.toggle('visible',!!s.open);e.querySelector('.collapse-arrow')?.classList.toggle('expanded',!!s.open);if(s.title)applyTitle(e,s.title);normalizeEntry(e);restoreCells(p,s.fields||[]);}entries(g.list).sort((a,b)=>Number(a.dataset.p5RestoreOrder)-Number(b.dataset.p5RestoreOrder)).forEach(e=>g.list.appendChild(e));}
   applyLayer();recalc();
  }
  function dialogConfig(which){return which==='insured'?{form:'insuredForm',button:'insuredSaveBtn',copy:'sameAsMailingChk'}:which==='broker'?{form:'brokerForm',button:'brokerSaveBtn'}:null;}
  function commitDialog(which,values,restore=false){const c=dialogConfig(which);if(!c)throw new Error('Unknown dialog');const form=$(c.form);const els=controls(form).filter(e=>e.name||e.id===c.copy);for(const el of els){const key=el.name||el.id;if(!own(values,key))continue;if(el.tagName==='SELECT'&&!Array.from(el.options).some(o=>o.value===String(values[key])))throw new Error('Invalid dialog selection');if(el.type==='checkbox')el.checked=!!values[key];else el.value=String(values[key]??'');}
   if(which==='insured'&&$(c.copy).checked){for(const suffix of ['Street','Suite','City','State','Zip']){const a=form.elements.namedItem('mail'+suffix),b=form.elements.namedItem('risk'+suffix);b.value=a.value;}}
   if(!restore&&!form.checkValidity())throw new Error('Complete the required address or broker fields.');
   // Call the existing commit handler directly, not a hidden dialog's default submit.
   $(c.button).onclick();
   for(const el of els){if(el.type!=='checkbox')el.dataset.stmExplicitEdit='1';if(!restore)markDirty(el);}
   extension.dialogs[which]=Object.fromEntries(els.map(e=>[e.name||e.id,e.type==='checkbox'?e.checked:e.value]));
  }

  function validate(saved){
   if(!saved)return true;
   const s=saved.data;
   const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
   const safe=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,180}$/.test(x)&&!['__proto__','prototype','constructor'].includes(x);
   const fail=()=>{throw new Error('Saved workbench structure could not be validated. No edits were applied. Keep the recovery data and reopen a valid saved version.');};
   if(!object(s)||s.v!==1||!object(s.loss||{})||!object(s.dialogs||{})||!object(s.views||{})||!Array.isArray(s.touched||[])||!Array.isArray(s.blanks||[]))fail();
   const knownTypes=new Set(Object.values(coverageTypes).flatMap(x=>Object.keys(x)));
   initialDefault.forEach(e=>knownTypes.add(e.dataset.coverageType));
   if((s.touched||[]).some(t=>!knownTypes.has(t))||(s.blanks||[]).some(k=>typeof k!=='string'||k.length>250||!/^([A-Za-z0-9_-]+|name:[A-Za-z0-9_-]+)$/.test(k)))fail();
   const cell=c=>object(c)&&((own(c,'v')&&(typeof c.v==='string'||typeof c.v==='number'))||(own(c,'c')&&typeof c.c==='boolean'));
   const keys=new Set();
   for(const [line,l] of Object.entries(s.loss||{})){
    if(!own(lossConfig,line)||!object(l)||typeof l.noLoss!=='boolean')fail();
    for(const kind of ['years','large']){
     if(!Array.isArray(l[kind])||l[kind].length>1000||(kind==='years'&&!l[kind].length))fail();
     for(const r of l[kind]){if(!object(r)||!safe(r.key)||keys.has(r.key)||!Array.isArray(r.cells)||r.cells.length!==(kind==='years'?7:5)||!r.cells.every(cell))fail();keys.add(r.key);}
    }
   }
   if(s.coverage!==null&&s.coverage!==undefined){
    if(!Array.isArray(s.coverage)||s.coverage.length>4)fail();
    const groups=new Set(),ids=new Set();
    for(const g of s.coverage){
     if(!object(g)||!categoryNodes().some(c=>c.id===g.id)||groups.has(g.id)||!Array.isArray(g.items)||g.items.length>500)fail();groups.add(g.id);
     for(const c of g.items){
      if(!object(c)||!safe(c.id)||ids.has(c.id)||!knownTypes.has(c.type)||typeof c.included!=='boolean'||typeof c.open!=='boolean'||!Array.isArray(c.fields)||c.fields.length>60||!c.fields.every(cell)||(!s.coverageAll&&!(s.touched||[]).includes(c.type)))fail();ids.add(c.id);
      if(c.defaultKey){const d=initialDefault.get(c.defaultKey);if(!d||d.dataset.coverageType!==c.type||initialDefaultGroups.get(c.defaultKey)!==g.id)fail();}
      else if(!own(coverageTypes[g.id]||{},c.type))fail();
      const expected=c.defaultKey?initialDefault.get(c.defaultKey):Array.from(doc.querySelectorAll('.limit-templates [data-template-key]')).find(e=>e.dataset.templateKey===c.type);
      const expectedFields=controls(expected?.querySelector('.limit-details-panel'));
      if(!expected||c.fields.length!==expectedFields.length||c.fields.some(f=>!own(f,'v')||own(f,'c'))||(c.policyLayer!==null&&typeof c.policyLayer!=='boolean'))fail();
      const hasCarrier=!!expected.querySelector('input[data-policy-layer]');if(hasCarrier?typeof c.policyLayer!=='boolean':c.policyLayer!==null)fail();
      if(c.position!==undefined&&(!Number.isInteger(c.position)||c.position<0||c.position>=500))fail();
      const existing=$(c.id);if(existing&&(!existing.matches('.limit-details-panel')||existing.closest('.limit-templates')||existing.closest('.limit-entry')?.dataset.coverageType!==c.type||existing.closest('.limits-category')?.dataset.group!==g.id))fail();
      if(c.title!==null&&c.title!==undefined&&(typeof c.title!=='string'||c.title.length>500))fail();
     }
    }
   }
   for(const [id,v]of Object.entries(s.views||{}))if(!safe(id)||!object(v)||(own(v,'open')&&typeof v.open!=='boolean')||(own(v,'title')&&(typeof v.title!=='string'||v.title.length>500)))fail();
   for(const [which,values]of Object.entries(s.dialogs||{})){
    const cfg=dialogConfig(which);if(!cfg||!object(values))fail();const els=controls($(cfg.form));
    for(const [key,value]of Object.entries(values)){const el=els.find(e=>(e.name||e.id)===key);if(!el||(el.type==='checkbox'?typeof value!=='boolean':typeof value!=='string'))fail();}
   }
   return true;
  }
  function locate(key){if(scalarIds.includes(key))return $(key);const p=key.split('|');if(p[0]==='loss'&&lossConfig[p[1]]&&['years','large'].includes(p[2]))return controls(assignRowKeys(p[1],p[2]).find(r=>r.dataset.phase5Key===p[3]))[+p[4]];if(p[0]==='cov'){const el=$(p[1]);if(!el?.matches('.limit-details-panel')||el.closest('.limit-templates'))return null;return controls(el)[+p[2]];}return null;}
  const bridge={
   ready:true,controls,dateISO,validate,
   beginNative(target){
    assertOwner(api.submissionId);
    if(edits.restoring)return false;
    const section=target.closest('[data-loss-line]');
    if(section){const line=section.dataset.lossLine,c=lossConfig[line];if((target.id===c.add&&lossRows(line,'years').length>=1000)||(target.id===c.addLarge&&lossRows(line,'large').length>=1000))throw new Error('This loss table has reached its 1,000-row capacity. Remove a row before adding another.');extension.loss[line]=lossSnapshot(line);}
    const entry=target.closest('.limit-entry');
    if(entry&&!entry.closest('.limit-templates')){normalizeEntry(entry);delete extension.views[panelId(entry)];touchType(entry.dataset.coverageType);}
    const choice=target.closest('[data-type-key]');if(choice){const group=choice.closest('.limits-category');if(group.querySelectorAll('.limits-list .limit-entry').length>=500)throw new Error('This coverage group has reached its 500-entry capacity. Remove a coverage before adding another.');touchType(choice.dataset.typeKey);}
    if(target.id==='layerType'){extension.coverageAll=true;extension.views={};extension.coverage=coverageSnapshot();}
    return true;
   },
   commitNative(target,final=false){
    assertOwner(api.submissionId);if(edits.restoring)return;
    if(target?.matches('[data-native-title]')){const entry=target.closest('.limit-entry');let title=target.value.slice(0,500);if(final)title=title.trim()||coverageTypes[entry.closest('.limits-category').dataset.group]?.[entry.dataset.coverageType]||'Lead coverage';applyTitle(entry,title);}
    categoryNodes().forEach(g=>entries(g.list).forEach(normalizeEntry));
    recalc();persist();global.dispatchEvent(new Event('stm:risk-updated'));
   },
   restoreNativeLead(){
    assertOwner(api.submissionId);const group=categoryNodes().find(g=>g.id==='lead');if(!group||entries(group.list).length)return;
    const original=[...initialDefault.values()].find(e=>e.dataset.coverageType==='lead-specific');if(!original)throw new Error('Lead coverage is unavailable.');
    touchType('lead-specific');const entry=cleanClone(original);group.list.append(entry);initDates(entry);normalizeEntry(entry);recordHistory('Coverage restored','Lead coverage');persist();applyLayer();global.dispatchEvent(new Event('stm:risk-updated'));
   },
   captureNativeDialog(which){const c=dialogConfig(which);if(!c)return;const els=controls($(c.form)).filter(e=>e.name||e.id===c.copy);extension.dialogs[which]=Object.fromEntries(els.map(e=>[e.name||e.id,e.type==='checkbox'?e.checked:e.value]));for(const el of els){el.dataset.stmExplicitEdit='1';markDirty(el);}persist();},
   ownsLoss(id){return Object.entries(lossConfig).some(([line,c])=>!!extension.loss[line]&&(c.years===id||c.large===id));},
   ownsCoverage(type){return !!extension.coverage&&(extension.coverageAll||extension.touched.includes(type));},
   ownsDialog(field){return field==='mailing_address'||field==='controlling_address'?!!extension.dialogs.insured:!!extension.dialogs.broker;},
   capture,
   restore(saved){if(!saved)return;validate(saved);const s=clone(saved.data);if(s.v!==1)throw new Error('Unsupported workbench structure version');extension={v:1,loss:s.loss||{},coverage:s.coverage||null,coverageAll:!!s.coverageAll,touched:s.touched||[],views:s.views||{},dialogs:s.dialogs||{},blanks:s.blanks||[]};for(const [line,v]of Object.entries(extension.loss)){if(!lossConfig[line])throw new Error('Unknown saved loss line');restoreLoss(line,v);}restoreCoverage(extension.coverage);for(const [id,v] of Object.entries(extension.views)){const p=$(id),e=p?.closest('.limit-entry');if(!e)continue;if(own(v,'open')){p.classList.toggle('visible',v.open);e.querySelector('.collapse-arrow')?.classList.toggle('expanded',v.open);}if(own(v,'title'))applyTitle(e,v.title);}for(const [which,v]of Object.entries(extension.dialogs))commitDialog(which,v,true);for(const key of extension.blanks){let el=key.startsWith('name:')?doc.querySelector('[name="'+CSS.escape(key.slice(5))+'"]'):$(key);if(el){el.dataset.stmExplicitEdit='1';el.dataset.userSet='1';}}capture();},
   read(sid){assertOwner(sid);const fields=Object.fromEntries(scalarIds.map(id=>[id,describe($(id),id)]));const texts={};['dealNum','dealType','dealStatus','mailingTxt','controllingTxt','brokerCoTxt','brokerTypeTxt','brokerAddrTxt','brokerNameTxt','regionTxt','statTermValue','statTermCaption','statQuoteValue','statQuoteCaption','statTargetValue','statTargetCaption','statAssignedValue','statAssignedCaption'].forEach(id=>texts[id]=$(id)?.textContent.trim()||'');const loss={};for(const [line,c]of Object.entries(lossConfig)){loss[line]={noLoss:$(c.noLoss).checked,years:assignRowKeys(line,'years').map(r=>({key:r.dataset.phase5Key,fields:descriptors(controls(r),'loss|'+line+'|years|'+r.dataset.phase5Key+'|')})),large:assignRowKeys(line,'large').map(r=>({key:r.dataset.phase5Key,fields:descriptors(controls(r),'loss|'+line+'|large|'+r.dataset.phase5Key+'|')}))};}
    const coverage=categoryNodes().filter(g=>!g.cat.classList.contains('is-hidden')&&g.cat.style.display!=='none').map(g=>({id:g.id,name:g.name,choices:coverageTypes[g.id]||{},items:entries(g.list).map(e=>{const p=e.querySelector('.limit-details-panel');return {id:p.id,type:e.dataset.coverageType,title:e.dataset.phase5Title||ctx.coverageName(e),included:!!e.querySelector('input[data-target]')?.checked,open:p.classList.contains('visible'),policyLayer:e.querySelector('input[data-policy-layer]')?.checked??null,fields:descriptors(controls(p),'cov|'+p.id+'|')};})}));return {id:sid,revision:api.revision,dirty:api.dirty,fields,texts,loss,coverage};},
   set(sid,key,value){assertOwner(sid);const el=locate(key);if(!el)throw new Error('Field no longer exists. Refresh the page.');const p=key.split('|');if(p[0]==='loss')extension.loss[p[1]]=lossSnapshot(p[1]);if(p[0]==='cov'&&!initialDefault.has(p[1]))touchType(el.closest('.limit-entry').dataset.coverageType);const oldLayer=$('layerType').value;const result=setElement(el,value);if(key==='layerType'&&oldLayer!==el.value){if(oldLayer.split(' ')[0]!==el.value.split(' ')[0]){extension.coverageAll=true;extension.views={};extension.coverage=coverageSnapshot();}recordHistory('Layer type edited',el.value);}persist();return result;},
   action(sid,action,data={}){assertOwner(sid);if(mutation)throw new Error('A workbench action is already in progress');mutation=true;try{if(action.startsWith('loss:')){const c=lossConfig[data.line];if(!c)throw new Error('Unknown loss line');const name=action.slice(5);if(!['noLoss','addYear','removeYear','addLarge','removeLarge'].includes(name))throw new Error('Unknown loss action');if((name==='addYear'||name==='addLarge')&&lossRows(data.line,name==='addYear'?'years':'large').length>=1000)throw new Error('This loss table has reached its supported 1,000-row capacity. Remove a row before adding another.');extension.loss[data.line]=lossSnapshot(data.line);if(name==='noLoss'){const cb=$(c.noLoss);applyEl(cb,{c:!cb.checked},true);markDirty(cb);}else{const button={addYear:c.add,removeYear:c.remove,addLarge:c.addLarge,removeLarge:c.removeLarge}[name];if(!button)throw new Error('Unknown loss action');$(button).click();}recordHistory('Loss history edited',data.line+' '+name);}else if(action.startsWith('coverage:')){const name=action.slice(9);if(name==='add'){const g=categoryNodes().find(g=>g.id===data.group);if(!g||!own(coverageTypes[g.id]||{},data.type))throw new Error('Unknown coverage type');if(entries(g.list).length>=500)throw new Error('This coverage group has reached its supported 500-entry capacity. Remove an entry before adding another.');touchType(data.type);const e=addCoverageEntry(data.type,g.list);normalizeEntry(e);const cb=e.querySelector('input[data-target]');if(cb)applyEl(cb,{c:true},true);}else{const p=$(data.id),e=p?.closest('.limit-entry');if(!e||e.closest('.limit-templates'))throw new Error('Coverage no longer exists');if(!['fold','title'].includes(name))touchType(e.dataset.coverageType);if(name==='delete'){e.remove();recordHistory('Coverage removed',ctx.coverageName(e));}else if(name==='toggle'){const cb=e.querySelector('input[data-target]');if(cb)applyEl(cb,{c:!cb.checked},true);}else if(name==='fold'){p.classList.toggle('visible');extension.views[p.id]={...(extension.views[p.id]||{}),open:p.classList.contains('visible')};e.querySelector('.collapse-arrow')?.classList.toggle('expanded',p.classList.contains('visible'));}else if(name==='carrier'){const cb=e.querySelector('input[data-policy-layer]');if(cb)applyEl(cb,{c:!cb.checked},true);}else if(name==='title'){applyTitle(e,String(data.value||'').trim().slice(0,500)||ctx.coverageName(e));extension.views[p.id]={...(extension.views[p.id]||{}),title:e.dataset.phase5Title};}else throw new Error('Unknown coverage action');}recalc();}else if(action==='dialog:save'){commitDialog(data.which,data.values);}else throw new Error('Unknown workbench action');persist();return true;}finally{mutation=false;}},
   dialog(sid,which){assertOwner(sid);const c=dialogConfig(which);if(!c)throw new Error('Unknown dialog');if(which==='insured'&&!extension.dialogs.insured)ctx.prefillInsured();return controls($(c.form)).filter(e=>e.name||e.id===c.copy).map(e=>({...describe(e,e.name||e.id),key:e.name||e.id}));}
  };
  global.__STM_WB_PHASE5=bridge;
  return bridge;
 }};
})(window);

/* Phase 6: native rating presentation / persistence boundary.
 * All premiums and factors are calculated by July's existing handlers and bundle.
 * This module maps controls, records row identity/metadata and protects user edits.
 */
(function (global) {
  'use strict';
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const clone = x => JSON.parse(JSON.stringify(x));
  const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
  const scalarIds = ['hazardGradeSelect', 'nonAdmittedLimit', 'quotaShareLimit', 'nonAdmittedAttachment', 'nonAdmittedPremium'];
  const specs = {
    gl_exposure: {id:'classTerritoryTable', attr:'data-f', fields:['code','desc','state','zip','exposures','base','rateP','rateG'], out:'data-out', add:'glRaterAddRow', min:1},
    al_fleet: {id:'autoExposuresTbl', attr:'data-f', fields:['selRate','units'], out:'data-out', fixed:15},
    primary: {id:'primaryPoliciesTbl', attr:'data-pp', fields:['coverage','carrier','limit','ulPrem','manualPrem','admit','dilFactor'], out:'data-pp-out', add:'internalAddPrimary', remove:'data-pp-remove', min:0},
    tower: {id:'towerLimitsTable', attr:'data-tw', fields:['limit','carrier','cPrem','target'], derived:['attach'], out:'data-tw-out', add:'internalAddLayer', remove:'data-tw-remove', min:0, rated:9},
    highex: {id:'highExcessTable', attr:'data-he', fields:['active','limit','admit','factor','applied','carrier','towerPrem'], derived:['attach'], out:'data-he-out', add:'internalAddHighExcess', remove:'data-he-remove', min:0, rated:14},
    auto: {id:'autoTable', attr:'data-a', fields:['units','rate','expUnits','expRate'], out:'data-a-out', fixed:15}
  };
  global.STMWorkbenchPhase6 = {install(ctx) {
    const {api, edits, markDirty, mirror, changed, recordHistory} = ctx;
    const doc = global.document, $ = id => doc.getElementById(id);
    // Keep the live coordinator even after an iframe is detached: window.parent
    // may no longer point at the original shell once the frame is removed.
    const runtime = null;
    let savedTables = Object.create(null), mutating = false, sourceAL = null, sequence = 0;
    function newKey() {
      if (typeof global.crypto?.randomUUID === 'function') return 'r'+global.crypto.randomUUID();
      const bytes = new Uint32Array(4);
      if (typeof global.crypto?.getRandomValues === 'function') {global.crypto.getRandomValues(bytes);return 'r'+Array.from(bytes,n=>n.toString(16)).join('-');}
      return 'r'+Date.now().toString(36)+'-'+(++sequence).toString(36);
    }
    function rows(kind) { return Array.from($(specs[kind].id).querySelectorAll('tbody > tr')); }
    function assignKeys(kind) {
      return rows(kind).map((row, i) => {
        if (!row.dataset.stmRatingKey) row.dataset.stmRatingKey = specs[kind].fixed ? kind+'-'+i : newKey();
        return row;
      });
    }
    function element(row, kind, field) { return row?.querySelector('['+specs[kind].attr+'="'+field+'"]'); }
    function allowed(kind, field) { return specs[kind]?.fields.includes(field); }
    function locked(kind) { return own(savedTables,kind) || edits.dirtyTables.has(kind); }
    function assertOwner(sid) {
      if(global.__STM_NATIVE_SESSION_BLOCKED || (api.ownerId && api.ownerId!==global.currentUser?.id))throw new Error('Session changed. Reopen the submission.');if (api.restoreError) throw new Error(api.restoreError);
      if (!global.currentUser || !sid || api.submissionId !== sid) throw new Error('This workbench session is no longer active. Reopen the submission.');
      const r = runtime;
      if (r && (r.activeId !== sid || r.workbenchWindow !== global || r.user?.id !== global.currentUser.id)) throw new Error('Stale rating action rejected. Reopen the submission.');
    }
    function ensureEngine() { global.__STM_NATIVE_RATING?.wire(); }
    function snapshotTable(kind) {
      const cfg=specs[kind];
      return assignKeys(kind).map(row => {
        const cells={}; cfg.fields.forEach(k => {const el=element(row,kind,k); if(el) cells[k]=api.serializeElement(el);});
        const result={key:row.dataset.stmRatingKey,cells};
        if(kind==='gl_exposure') result.meta={quotePremP:row.dataset.quotePremP||'',quotePremG:row.dataset.quotePremG||'',autoDesc:element(row,kind,'desc')?.dataset.autoDesc||'0',lookup:row.dataset.glClassCodeLookup||'',review:row.dataset.glClassCodeReview||''};
        if(kind==='tower') result.internal=row.classList.contains('is-internal-layer');
        return result;
      });
    }
    function capture() {
      for(const kind of Object.keys(specs)) if(locked(kind)) savedTables[kind]=snapshotTable(kind);
      if(Object.keys(savedTables).length) {
        const data={v:1,tables:savedTables};
        const prev=edits.map.__phase6;
        if(!prev || JSON.stringify(prev.data)!==JSON.stringify(data)) edits.map.__phase6={data:clone(data),t:Date.now()};
      }
    }
    function touch(kind) { edits.dirtyTables.add(kind); savedTables[kind]=snapshotTable(kind); }
    function finish() { capture(); changed(); mirror(); }
    function batch(fn, kinds=[]) {
      const gl=global.__stmBatchGlRater87104, ir=global.__stmBatchInternalRater87104;
      global.__stmBatchGlRater87104=true;global.__stmBatchInternalRater87104=true;
      try { return fn(); }
      finally {
        global.__stmBatchGlRater87104=gl===true;global.__stmBatchInternalRater87104=ir===true;
        if(kinds.includes('gl_exposure')&&!gl)global.__stmRecalcGLRater87104?.('phase6');
        if(kinds.includes('al_fleet'))global.__stmRecalcALFleet?.();
        if(kinds.includes('auto'))global.__stmRecalcAutoComparison?.();
        if(!ir)global.__stmRecalcInternalRater87104?.('phase6');
        global.__stmGlRaterDirty87104=false;global.__stmInternalRaterDirty87104=false;
      }
    }
    function describe(el,key,label='') {
      if(!el)return null;
      return {key,label,tag:el.tagName.toLowerCase(),type:el.type||'text',value:el.type==='checkbox'?el.checked:el.value,
        readonly:!!el.readOnly,disabled:!!el.disabled,placeholder:el.placeholder||'',maxLength:el.maxLength>0?el.maxLength:null,
        money:!!el.closest('.currency-wrap')||['nonAdmittedLimit','quotaShareLimit','nonAdmittedAttachment','nonAdmittedPremium'].includes(el.id),
        millions:el.classList.contains('convert-to-millions'),
        options:el.options?Array.from(el.options).map(o=>({value:o.value,label:o.textContent,disabled:o.disabled})):null,
        warning:el.classList.contains('money-input-coerced')?'The original input handler normalized this value.':el.classList.contains('money-input-rejected')?'The original parser rejected this value.':'',
        filled:el.classList.contains('autofilled-from-platform')};
    }
    function readTable(kind) {
      const cfg=specs[kind];
      return assignKeys(kind).map((row,index)=>{
        const fields={}; [...cfg.fields,...(cfg.derived||[])].forEach(k=>{fields[k]=describe(element(row,kind,k),'r|'+kind+'|'+row.dataset.stmRatingKey+'|'+k,k);});
        const outputs={};row.querySelectorAll('['+cfg.out+']').forEach(el=>outputs[el.getAttribute(cfg.out)]=el.textContent.trim());
        return {key:row.dataset.stmRatingKey,index,fields,outputs,label:cfg.fixed?row.cells[0]?.textContent.trim():'',
          quoted:kind==='gl_exposure'&&(Number(row.dataset.quotePremP)>0||Number(row.dataset.quotePremG)>0),
          lookup:row.dataset.glClassCodeLookup||'',review:row.classList.contains('class-code-review-required'),
          internal:row.classList.contains('is-internal-layer'),rated:!cfg.rated||index<cfg.rated};
      });
    }
    function locate(key) {
      const p=String(key).split('|');
      if(p.length===2&&p[0]==='s'&&scalarIds.includes(p[1]))return {el:$(p[1]),kind:null,field:p[1]};
      if(p.length!==4||p[0]!=='r'||!own(specs,p[1])||!allowed(p[1],p[3]))throw new Error('This is a calculated or unknown rating field.');
      const row=assignKeys(p[1]).find(r=>r.dataset.stmRatingKey===p[2]);
      const el=element(row,p[1],p[3]);if(!el)throw new Error('This rating row was removed. Refresh the page.');
      return {el,row,kind:p[1],field:p[3]};
    }
    function setValue(el,value,final) {
      if(!el||el.disabled||el.readOnly)throw new Error('This rating field is derived or unavailable.');
      if(el.tagName==='SELECT'&&!Array.from(el.options).some(o=>o.value===String(value)&&!o.disabled))throw new Error('Invalid rating selection.');
      if(el.type==='checkbox'){if(typeof value!=='boolean')throw new Error('Invalid checkbox value.');el.checked=value;}
      else{if(!['string','number'].includes(typeof value)||String(value).length>100000)throw new Error('Invalid field value.');el.value=String(value);}
      el.dataset.stmExplicitEdit='1';el.dataset.userSet='1';
      // INPUT alone while typing; July's millions conversion and rounding run
      // only on commit. Sending CHANGE per keystroke would change 12 into 1M2.
      el.dispatchEvent(new Event('input',{bubbles:true}));
      if(final){el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('blur',{bubbles:false}));}
      markDirty(el);
    }
    function validate(saved) {
      if(!saved)return true;
      const fail=()=>{throw new Error('Saved rating structure is invalid. No rating edits were applied. Keep the recovery data and reopen a valid version.');};
      const s=saved.data;if(!object(s)||s.v!==1||!object(s.tables))fail();
      const keys=new Set();
      for(const [kind,list] of Object.entries(s.tables)){
        if(!own(specs,kind)||!Array.isArray(list)||list.length>1000)fail();
        const cfg=specs[kind];if(cfg.fixed&&list.length!==cfg.fixed||list.length<(cfg.min||0))fail();
        for(const row of list){
          if(!object(row)||typeof row.key!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(row.key)||keys.has(row.key)||!object(row.cells))fail();keys.add(row.key);
          if(Object.keys(row.cells).length!==cfg.fields.length||cfg.fields.some(k=>!own(row.cells,k)))fail();
          for(const [field,val] of Object.entries(row.cells)){
            if(!allowed(kind,field)||!object(val))fail();
            if(val.n!==undefined&&![0,1].includes(val.n))fail();if(field==='active'){if(typeof val.c!=='boolean')fail();}
            else if(!own(val,'v')||!['string','number'].includes(typeof val.v)||String(val.v).length>100000||typeof val.v==='number'&&!Number.isFinite(val.v))fail();
            if(field==='base'&&!['1000','100','1','payroll'].includes(String(val.v)))fail();
            if(field==='admit'&&!['Non-Admitted','Admitted'].includes(String(val.v)))fail();
          }
          if(row.meta!==undefined){if(kind!=='gl_exposure'||!object(row.meta))fail();for(const [k,v]of Object.entries(row.meta)){if(!['quotePremP','quotePremG','autoDesc','lookup','review'].includes(k)||typeof v!=='string'||v.length>1000)fail();}}
          if(row.internal!==undefined&&(kind!=='tower'||typeof row.internal!=='boolean'))fail();
        }
      }
      return true;
    }
    function restoreTable(kind,list) {
      const cfg=specs[kind];let current=rows(kind);
      if(!cfg.fixed){while(current.length>list.length){current.pop().remove();}let guard=0;while(current.length<list.length){const before=current.length;$(cfg.add).click();current=rows(kind);if(current.length<=before||++guard>1000)throw new Error('Could not restore rating rows.');}}
      if(current.length!==list.length)throw new Error('Saved rating table size does not match its native template.');
      list.forEach((saved,i)=>{const row=current[i];row.dataset.stmRatingKey=saved.key;
        for(const field of cfg.fields){const el=element(row,kind,field);if(!el)throw new Error('The native rating template is missing '+field);const value=saved.cells[field];if(el.type==='checkbox')el.checked=value.c;else el.value=String(value.v??'');el.dataset.userSet='1';el.dataset.stmExplicitEdit='1';if(el.classList.contains('convert-to-millions')){if(value.n!==0&&/^[\d,.\s]*$/.test(el.value)){el._stmNormalizedAmount=el.value;el._stmAmountDraft=false;}else{delete el._stmNormalizedAmount;el.dispatchEvent(new Event('change',{bubbles:true}));}}}
        if(kind==='gl_exposure'){
          const m=saved.meta||{};for(const k of ['quotePremP','quotePremG']){if(m[k])row.dataset[k]=m[k];else delete row.dataset[k];}
          element(row,kind,'desc').dataset.autoDesc=m.autoDesc||'0';row.dataset.glClassCodeLookup=m.lookup||'';row.dataset.glClassCodeReview=m.review||'';row.classList.toggle('class-code-review-required',m.review==='1');
        }
        if(kind==='tower')row.classList.toggle('is-internal-layer',!!saved.internal);
      });
      ensureEngine();edits.dirtyTables.add(kind);
    }
    const bridge={
      ready:true,specs,owns:locked,capture,validate,
      beginNative(kinds){assertOwner(api.submissionId);if(edits.restoring)return false;ensureEngine();kinds.forEach(touch);return true;},
      commitNative(kinds){assertOwner(api.submissionId);if(edits.restoring)return;batch(()=>kinds.forEach(touch),kinds);finish();global.dispatchEvent(new Event('stm:worksheets-updated'));},
      hasSavedTable(saved,kind){return !!saved?.data?.tables&&own(saved.data.tables,kind);},
      rememberSource(){ensureEngine();if(!locked('al_fleet'))sourceAL=snapshotTable('al_fleet');},
      restore(saved){
        if(saved){validate(saved);savedTables=clone(saved.data.tables);batch(()=>{for(const [kind,list]of Object.entries(savedTables))restoreTable(kind,list);},Object.keys(savedTables));}
        // Upgrade pre-Phase-6 saved table formats without losing their semantics.
        for(const kind of Object.keys(specs))if(edits.dirtyTables.has(kind)&&!own(savedTables,kind))savedTables[kind]=snapshotTable(kind);
        ensureEngine();capture();
      },
      read(sid){assertOwner(sid);ensureEngine();const t={};for(const kind of Object.keys(specs))t[kind]=readTable(kind);
        const text={};['totalPremOps','totalProducts','totalPremium','autoTotalPremium','autoUnitsTotal','autoRenewalTotal','autoExpUnitsTotal','autoFleetChangeTotal','autoExpiringTotal','autoChangeTotal','autoChangePct'].forEach(id=>text[id]=$(id)?.textContent.trim()||'');
        const outputs={};['rsLayerPremium','rsQsPct','rsTotalLayerPrem','rsZurichPremium','rsPerMillion'].forEach(id=>outputs[id]=$(id)?.value||'');
        const engine=global.__STM_NATIVE_RATING?.inspect()||{ready:false,bands:[],highVisible:false};
        const ground=Array.from($('groundUpTbl').querySelectorAll('tbody tr[data-ground-top]')).map(row=>({top:Number(row.dataset.groundTop),cells:Array.from(row.cells).map(c=>c.textContent.trim()),inLayer:row.classList.contains('is-in-layer'),backfilled:row.classList.contains('is-backfilled'),auto:engine.bands.find(b=>b.top===Number(row.dataset.groundTop))?.autoDisplay||'$0'}));
        return {id:sid,revision:api.revision,dirty:api.dirty,fields:Object.fromEntries(scalarIds.map(id=>[id,describe($(id),'s|'+id,id)])),tables:t,text,outputs,engine,ground,owned:Object.keys(specs).filter(locked)};
      },
      set(sid,key,value,final=true){assertOwner(sid);ensureEngine();const {el,row,kind,field}=locate(key);
        if(kind==='highex'&&field==='active'&&value&&rows(kind).indexOf(row)>=14)throw new Error('The July engine prices only the first 14 high-excess rows. Remove an unused earlier row before activating this one.');
        const groups=kind?[kind]:field==='hazardGradeSelect'?['primary']:[];
        batch(()=>{setValue(el,value,final);if(kind)touch(kind);if(field==='hazardGradeSelect'&&final)touch('primary');},groups);
        finish();return describe(el,key,field);
      },
      action(sid,action,data={}){assertOwner(sid);ensureEngine();if(mutating)throw new Error('A rating action is already in progress.');mutating=true;
        try{
          const [kind,verb]=action.split(':');
          if(action==='gl:reset'){batch(()=>{$('resetBtn').click();touch('gl_exposure');},['gl_exposure']);}
          else if(kind==='al'&&['defaults','clear','reset'].includes(verb)){
            batch(()=>{if(verb==='reset'&&sourceAL)restoreTable('al_fleet',sourceAL);else rows('al_fleet').forEach(row=>{if(verb!=='clear')element(row,'al_fleet','selRate').value='';if(verb!=='defaults')element(row,'al_fleet','units').value='';});touch('al_fleet');},['al_fleet']);
          } else if(action==='internal:clear'){
            // The original confirmation and reset scope are retained; driver boxes
            // are not silently cleared because July's Clear Sheet leaves them.
            const before=JSON.stringify([snapshotTable('primary'),snapshotTable('tower'),snapshotTable('highex')]);
            batch(()=>{$('clearSheetBtn').click();},['primary','tower','highex']);
            const after=JSON.stringify([snapshotTable('primary'),snapshotTable('tower'),snapshotTable('highex')]);
            if(before===after)return false;
            ['primary','tower','highex'].forEach(touch);
          } else {
            if(!own(specs,kind)||!['add','remove'].includes(verb))throw new Error('Unknown rating action.');const cfg=specs[kind];
            if(cfg.fixed)throw new Error('Vehicle categories are fixed by the original worksheet.');
            if(verb==='add'){
              if(rows(kind).length>=(cfg.rated||1000))throw new Error('The native worksheet has reached its '+(cfg.rated||1000)+'-row capacity.');
              batch(()=>{$(cfg.add).click();touch(kind);},[kind]);
            }else{
              const row=assignKeys(kind).find(r=>r.dataset.stmRatingKey===data.key);if(!row)throw new Error('This rating row was already removed.');
              if(rows(kind).length<=(cfg.min||0))throw new Error('Keep at least '+cfg.min+' row in this worksheet.');
              batch(()=>{if(cfg.remove)row.querySelector('['+cfg.remove+']').click();else row.remove();touch(kind);},[kind]);
            }
          }
          finish();recordHistory('Rating worksheet edited',action);return true;
        }finally{mutating=false;}
      }
    };
    global.__STM_WB_PHASE6=bridge;
    ensureEngine();return bridge;
  }};
})(window);

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
 const SOURCES=['A6','A8','A9','A10','Underwriter'];
 global.STMWorkbenchPhase7={install(ctx){
  const {api,edits,markDirty,mirror,changed,recordHistory,replaceHistory}=ctx;
  const host=null,doc=global.document,$=id=>doc.getElementById(id),native=()=>global.__STM_NATIVE_FORMS;
  const standard=()=>Array.from(doc.querySelectorAll('#form-subjectivities .subjectivity-entry:not(.other-subjectivity)'));
  const customEls=()=>Array.from(doc.querySelectorAll('#form-subjectivities .other-input-group textarea'));
  const formRows=()=>Array.from(doc.querySelectorAll('#formsContainer .form-row'));
  let forms=null,subjects=null,historyOwned=false,restoring=false,busy=false,sourceUW=null,reviewStatus=null;
  const REVIEW_STATUSES=new Set(['Cleared','Inquired','Quoted','Bound','Issued','Cancelled','Dead']);
  function paintReviewStatus(value){const el=$('statusText');if(el){el.textContent=value;el.dataset.status=value;el.title='Workbench review status. This does not send a policy transaction or change the Queue status.';}}
  const editingBefore=new Map();
  function owner(sid){
   if(global.__STM_NATIVE_SESSION_BLOCKED || (api.ownerId && api.ownerId!==global.currentUser?.id))throw new Error('Session changed. Reopen the submission.');if(api.restoreError)throw new Error(api.restoreError);
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
   for(const item of items){const wrap=doc.createElement('div');wrap.className='other-input-group';const el=doc.createElement('textarea');el.rows=2;el.placeholder='Enter other subjectivity...';el.dataset.phase7Key=item.key;el.dataset.phase7On=item.on?'1':'0';el.value=item.text;el.disabled=false;wrap.append(el);panel.insertBefore(wrap,panel.querySelector('.add-other-btn'));}
   const cb=$('otherSubjectivityCheckbox');cb.checked=items.some(x=>x.on);cb.dispatchEvent(new Event('change',{bubbles:true}));
   // Empty native row is a draft, not an applied blank subjectivity.
   if(!items.length){const wrap=doc.createElement('div');wrap.className='other-input-group';const el=doc.createElement('textarea');el.rows=2;el.placeholder='Enter other subjectivity...';el.dataset.phase7On='0';wrap.append(el);panel.insertBefore(wrap,panel.querySelector('.add-other-btn'));}
  }
  function getHistory(){return api.history().map(e=>({...e,id:e.id||uid()})).slice(0,75);}
  function capture(){
   if(restoring||!api.submissionId)return;
   const data={v:1};if(forms){forms={...formsSnapshot(),layer:forms.layer};data.forms=clone(forms);}if(subjects){subjects=subjectsSnapshot();data.subjects=clone(subjects);}if(historyOwned)data.history=getHistory();if(reviewStatus!==null)data.reviewStatus=reviewStatus;
   if(Object.keys(data).length>1){const prev=edits.map.__phase7;if(!prev||JSON.stringify(prev.data)!==JSON.stringify(data))edits.map.__phase7={data,t:Date.now()};edits.removed.delete('__phase7');}else if(edits.map.__phase7){delete edits.map.__phase7;edits.removed.add('__phase7');}
  }
  function finish(){capture();changed();mirror();}
  function touchForms(){forms=formsSnapshot();edits.formsDirty=true;edits.removed.delete('__forms');}
  function findForm(key){const row=formRows().find(e=>formRead(e).key===key);if(!row)throw new Error('This form is no longer on the schedule.');return row;}
  function describe(el){if(!el)return null;return {key:el.id,value:el.value,tag:el.tagName.toLowerCase(),type:el.type||'text',readonly:!!el.readOnly,disabled:!!el.disabled,placeholder:el.placeholder||'',money:el.classList.contains('currency-input'),options:el.options?Array.from(el.options).map(o=>({value:o.value,label:o.textContent,disabled:o.disabled})):null,min:el.min||null,max:el.max||null,step:el.step||null,filled:el.classList.contains('autofilled-from-platform')};}
  function validate(saved){
   if(!saved)return true;const fail=()=>{throw new Error('Saved review-page structure is invalid. No edits were applied. Keep your recovery copy and reopen a valid version.');};
   const d=saved.data;if(!object(d)||d.v!==1||Object.keys(d).some(k=>!['v','forms','subjects','history','reviewStatus'].includes(k)))fail();
   if(own(d,'reviewStatus')&&!REVIEW_STATUSES.has(d.reviewStatus))fail();
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
   setReviewStatus(sid,value){owner(sid);if(busy||global.__STM_WB_RESETTING||global.__STM_WB_RESET_RETIRED)throw new Error('A review action is still running.');if(!REVIEW_STATUSES.has(value))throw new Error('Unknown Workbench review status.');if((reviewStatus??'Cleared')===value)return false;reviewStatus=value;paintReviewStatus(value);recordHistory('Workbench review status changed','Marked '+value+' in Workbench.');finish();global.dispatchEvent(new Event('stm:review-updated'));return true;},
    commitNativeForms(){owner(api.submissionId);if(restoring||edits.restoring)return;touchForms();finish();global.dispatchEvent(new Event('stm:review-updated'));},
    commitNativeSubjects(){owner(api.submissionId);if(restoring||edits.restoring)return;subjects=subjectsSnapshot();finish();global.dispatchEvent(new Event('stm:review-updated'));},
   historyRecorded(){
    if(restoring||edits.restoring||!api.submissionId||!api.localKey||global.__STM_NATIVE_SESSION_BLOCKED)return;
    historyOwned=true;capture();changed();mirror();
   },
   preserveForms(layer){if(!forms)return false;if(forms.layer===layer)return true;forms=null;edits.formsDirty=false;edits.removed.add('__forms');capture();return false;},
   rememberSource(){sourceUW=Object.fromEntries([...PROFILE,...NARRATIVE].map(id=>[id,$(id)?.value||'']));},
   restore(saved){if(!saved)return;validate(saved);const d=clone(saved.data);restoring=true;try{
    if(d.forms){if(d.forms.layer!==native().selection().key)throw new Error('Saved forms belong to another layer family. Restore the matching layer type before saving.');native().rebuild(d.forms.rows);formRows().forEach((row,i)=>row.dataset.phase7Key=d.forms.rows[i].key);forms=d.forms;edits.formsDirty=true;}
    if(d.subjects){subjects=d.subjects;for(const [id,on]of Object.entries(subjects.choices))$(id).checked=on;setCustom(subjects.items);}
    if(own(d,'reviewStatus')){reviewStatus=d.reviewStatus;paintReviewStatus(reviewStatus);}
    if(d.history){replaceHistory(d.history.slice().sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,75));historyOwned=true;}
   }finally{restoring=false;}capture();},
   read(sid){owner(sid);const fs=formRows().map(formRead),sub=standard().map(e=>{const cb=e.querySelector('input');return {key:cb.id,text:labelText(e),on:cb.checked,tag:e.classList.contains('subjectivity-strong')?'ind':e.classList.contains('subjectivity-suggested')?'sug':'std',reason:e.title||''};});
    return {id:sid,revision:api.revision,dirty:api.dirty,busy,layer:native().selection(),forms:fs,library:library(),subjects:sub,custom:subjectsSnapshot().items,profile:Object.fromEntries(PROFILE.map(id=>[id,describe($(id))])),narrative:NARRATIVE.map((id,i)=>({...describe($(id)),label:LABELS[i],source:SOURCES[i]})),history:getHistory(),reviewStatus:reviewStatus??'Cleared',owned:{forms:!!forms,subjects:!!subjects,underwriting:[...PROFILE,...NARRATIVE].some(id=>own(edits.map,id))}};
   },
   set(sid,key,value,final=true){owner(sid);if(busy)throw new Error('A review action is still running.');if(![...PROFILE,...NARRATIVE].includes(key))throw new Error('Unknown review field.');const el=$(key);if(!el||el.readOnly||el.disabled)throw new Error('This field is calculated by the original application.');if(!['string','number'].includes(typeof value)||String(value).length>100000)throw new Error('Invalid field value.');
    if(el.options&&!Array.from(el.options).some(o=>o.value===String(value)&&!o.disabled))throw new Error('Invalid selection.');
    if(['resConstPct','comConstPct'].includes(key)&&value!==''&&(!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100))throw new Error('Construction percentages must be between 0 and 100.');
    if(!editingBefore.has(key))editingBefore.set(key,el.value);const before=editingBefore.get(key);el.value=String(value);el.dataset.stmExplicitEdit='1';el.dataset.userSet='1';el.dispatchEvent(new Event('input',{bubbles:true}));if(final){el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('blur'));}
    markDirty(el);if(final){if(before!==el.value)recordHistory('Underwriting edited',key);editingBefore.delete(key);}finish();return describe(el);
   },
   async action(sid,act,data={}){owner(sid);if(busy)throw new Error('A review action is still running.');
    if(act==='uw:restore'){global.__STM_NATIVE_UW_SOURCE.restore(sid,data.key);editingBefore.delete(data.key);finish();return true;}
    if(act==='uw:reset'){busy=true;try{global.__STM_NATIVE_UW_SOURCE.reset(sid);editingBefore.clear();finish();return true;}finally{busy=false;}}
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
