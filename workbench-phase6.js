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
    const runtime = global.parent?.STM_RUNTIME || null;
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
      if (api.restoreError) throw new Error(api.restoreError);
      if (sid == null && !api.submissionId && global.currentUser) { const r0 = runtime; if (r0 && (r0.workbenchWindow !== global || r0.activeId)) throw new Error('Stale rating action rejected. Reopen the submission.'); return; }
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
            if(field==='active'){if(typeof val.c!=='boolean')fail();}
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
        for(const field of cfg.fields){const el=element(row,kind,field);if(!el)throw new Error('The native rating template is missing '+field);const value=saved.cells[field];if(el.type==='checkbox')el.checked=value.c;else el.value=String(value.v??'');el.dataset.userSet='1';el.dataset.stmExplicitEdit='1';}
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
