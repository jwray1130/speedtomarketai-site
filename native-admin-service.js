/* RESEARCH PROPOSAL ONLY. Root must review, integrate and browser-test.
 * No frame bridge, account mutation, invitations, or invented admin backend.
 * Load after native session/config + original parsers. UI consumes this API;
 * it must replace original admin render hooks and call retire on identity loss.
 */
(function () {
  'use strict';
  const W = window, PAGE = 50, WALK = 500, MAX_ROWS = 100000;
  const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
  const fresh = () => ({users:{status:'idle',rows:[]},feedback:{status:'idle',rows:[],summary:null},audit:{status:'idle',rows:[],category:'all',categories:[],hasMore:false,cursor:null},lastRefresh:null});
  let state = fresh(), scope = null, generation = 0, tickets = {}, working = 0;
  const tasks = new Set();
  function denied(message, code) { return Object.assign(new Error(message), {code}); }
  function platform() { if (!W.__STM_NATIVE_PLATFORM) throw new Error('Session service is unavailable.'); return W.__STM_NATIVE_PLATFORM; }
  function capture() {
    const p = platform(), token = p.captureOwner(); p.assertOwner(token);
    if (!p.state.authenticated || !p.state.ready || W.currentUser?.id !== token.userId || W.currentUser?.role !== 'admin') throw denied('Administrator access is required.', 'STM_ADMIN_REQUIRED');
    return token;
  }
  function assert(token) {
    platform().assertOwner(token);
    if (!platform().state.authenticated || W.currentUser?.role !== 'admin') throw denied('Administrator access changed.', 'STM_ADMIN_REQUIRED');
  }
  function init() {
    const token = capture();
    if (!scope || scope.userId !== token.userId || scope.epoch !== token.epoch) { retire(false); scope = token; }
    return token;
  }
  function emit() { W.dispatchEvent(new CustomEvent('stm:admin-change')); }
  function ticket(kind, token) {
    const serial = tickets[kind] = (tickets[kind] || 0) + 1, gen = generation;
    return () => {
      assert(token);
      if (gen !== generation || tickets[kind] !== serial) throw denied('A newer request replaced this one.', 'STM_SUPERSEDED');
    };
  }
  async function query(check, make) {
    check(); let result;
    try { result = await make(); } catch (error) { check(); throw error; }
    check();
    if (result?.error) throw new Error(result.error.message || String(result.error));
    if (!result || !Array.isArray(result.data)) throw new Error('The server did not return a row list.');
    return result.data;
  }
  function track(task) { tasks.add(task); task.then(() => tasks.delete(task), () => tasks.delete(task)); return task; }
  // Walk until an EMPTY page, not a short page: actual Supabase row caps can be
  // lower than the requested limit. id is an immutable, ordered primary key.
  // This is a multi-query observation. Concurrent writes are not an atomic snapshot.
  async function allRows(table, columns, check) {
    const rows = [], seen = new Set(); let cursor = null;
    for (;;) {
      const page = await query(check, () => {
        let q = W.sb.from(table).select(columns).order('id', {ascending:true}).limit(WALK);
        if (cursor !== null) q = q.gt('id', cursor);
        return q;
      });
      if (!page.length) return rows;
      for (const row of page) {
        if (row.id == null || seen.has(String(row.id))) throw new Error('The server did not advance '+table+' pagination. No complete total is available.');
        seen.add(String(row.id)); rows.push(row);
        if (rows.length > MAX_ROWS) throw new Error(table+' exceeds the supported '+MAX_ROWS.toLocaleString()+' row read. No partial total/export was produced.');
      }
      cursor = page[page.length-1].id;
    }
  }
  const auditColumns = 'id,user_id,submission_id,category,message,meta,created_at';
  const auditCursor = row => row ? {created_at:row.created_at,id:row.id} : null;
  // Strict descending tuple cursor. First finish rows tied with the previous
  // timestamp, then get older timestamps. Separate filters avoid raw OR syntax.
  async function auditChunk(category, after, count, check) {
    const base = () => {
      let q = W.sb.from('audit_events').select(auditColumns).order('created_at',{ascending:false}).order('id',{ascending:false});
      if (category !== 'all') q = q.eq('category',category);
      return q;
    };
    if (!after) return query(check, () => base().limit(count));
    if (after.id == null || !after.created_at) throw new Error('Audit rows need both an ID and timestamp for safe pagination.');
    const tied = await query(check, () => base().eq('created_at',after.created_at).lt('id',after.id).limit(count));
    // Always return a nonempty tied group first. A short server-capped group
    // must be continued before moving to older timestamps.
    if (tied.length) return tied;
    return query(check, () => base().lt('created_at',after.created_at).limit(count));
  }
  async function auditPage(category, after, check) {
    const found = [], seen = new Set(); let cursor = after;
    while (found.length < PAGE + 1) {
      const part = await auditChunk(category,cursor,PAGE+1-found.length,check);
      if (!part.length) break;
      for (const row of part) {
        if (row.id == null || !row.created_at || seen.has(String(row.id)) || (cursor && row.id === cursor.id)) throw new Error('Audit pagination did not advance. Refresh the audit log.');
        seen.add(String(row.id)); found.push(row);
      }
      cursor = auditCursor(part[part.length-1]);
    }
    const rows = found.slice(0,PAGE);
    return {rows,hasMore:found.length>PAGE,cursor:auditCursor(rows[rows.length-1]) || after};
  }
  async function refreshOne(kind, options, owner) {
    const check = ticket(kind,owner), old = clone(state[kind]);
    const category = kind === 'audit' ? String(options.category ?? old.category ?? 'all') : null;
    const append = kind === 'audit' && !!options.append && category === old.category && old.status === 'ready';
    state[kind] = {...old,status:'loading',error:null};
    if (kind === 'audit' && !append) Object.assign(state.audit,{rows:[],cursor:null,hasMore:false,category});
    emit();
    try {
      let result;
      if (kind === 'users') {
        const [users,submissions] = await Promise.all([allRows('users','id,email,display_name,role,created_at',check),allRows('submissions','id,user_id',check)]);
        const counts = new Map(); submissions.forEach(r => counts.set(r.user_id,(counts.get(r.user_id)||0)+1));
        result = {rows:users.map(u=>({...u,submission_count:counts.get(u.id)||0})).sort((a,b)=>String(a.display_name||a.email||'').localeCompare(String(b.display_name||b.email||''))),observed:true};
      } else if (kind === 'feedback') {
        const all = await allRows('feedback_events','id,user_id,submission_id,module_key,rating,comment,context,created_at,exported_at',check);
        const summary = {total:all.length,up:0,down:0,comment:0,unexported:0};
        all.forEach(r=>{if (['up','down','comment'].includes(r.rating)) summary[r.rating]++; if(!r.exported_at) summary.unexported++;});
        all.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')) || String(b.id).localeCompare(String(a.id)));
        result = {rows:all.slice(0,10),summary,observed:true};
      } else {
        const [page,categories] = await Promise.all([auditPage(category,append?old.cursor:null,check),append?Promise.resolve(old.categories):allRows('audit_events','id,category',check).then(rows=>Array.from(new Set(rows.map(r=>r.category).filter(Boolean))).sort())]);
        const prior = append ? old.rows : [], unique = new Set(prior.map(r=>String(r.id)));
        if (page.rows.some(r=>unique.has(String(r.id)))) throw new Error('Audit pagination repeated a previously loaded event. Refresh the audit log.');
        result = {...page,rows:prior.concat(page.rows),category,categories,scope:'Loaded cloud events for the selected category; newer events appear after Refresh.'};
      }
      check(); state[kind] = {...result,status:'ready',error:null,loadedAt:new Date().toISOString()}; state.lastRefresh = state[kind].loadedAt; emit();
    } catch (error) {
      try { check(); } catch (_) { return; }
      state[kind] = {...state[kind],status:'error',error:error.message||String(error)}; emit();
    }
  }
  function refresh(kind='all', options={}) {
    const owner = init(), kinds = kind === 'all' ? ['users','feedback','audit'] : [kind];
    if (kinds.some(k=>!['users','feedback','audit'].includes(k))) throw new Error('Unknown administration panel.');
    if(kind==='audit' && options.append && state.audit.status==='loading' && (options.category==null || String(options.category)===state.audit.category)) throw new Error('Wait for the current audit request before loading older events.');
    return track(Promise.all(kinds.map(k=>refreshOne(k,{...options},owner))).then(()=>{assert(owner);return read();}));
  }
  function configService() { return W.__STM_NATIVE_CONFIG || W.__STM_ADMIN_CONFIG; }
  function read() {
    init();
    const prompts = Object.entries(W.PROMPTS||{}).filter(([,v])=>typeof v==='string').map(([key,text])=>({key,chars:text.length}));
    const s = W.STATE || {}, cost = Number(s.runTotalCost);
    return clone({...state,user:{id:W.currentUser.id,displayName:W.currentUser.display_name||W.currentUser.email},config:configService()?.read?.(),prompts,
      usage:{submissionId:s.activeSubmissionId||null,runId:s.pipelineRun||null,currentRunCost:s.pipelineRun && Number.isFinite(cost) ? cost : null},
      unsupported:{roles:'Invitations and role changes require a privileged backend that is not supplied.',guidelines:'The saved guideline is personal. Version history and carrier-wide publishing are not implemented.',thresholds:'Persisted per-module STP/QA controls are not implemented.',prompts:'The original prompt library is read-only; overrides, evaluation and publishing are not implemented.',integrations:'Microsoft 365, SharePoint, OneDrive, Box, Guidewire and Duck Creek are not connected by this application.',compliance:'Historical spend reporting, compliance certification and SOC 2 PDF export are not implemented.'}});
  }
  function configure(data) {
    const owner=init();
    if(working) throw new Error('Wait for the current administration operation.');
    const guide=String(data.guideline??'').trim();
    if(guide && guide.length<100) throw new Error('Use at least 100 guideline characters, or clear it to use the default.');
    const service=configService(); if(!service?.commit) throw new Error('Settings service is unavailable.');
    working++; emit();
    return track((async()=>{try{assert(owner);const result=await service.commit({...data,guideline:guide});assert(owner);emit();return result;}finally{working--;emit();}})());
  }
  function parseGuide(file) {
    const owner=init(), check=ticket('parse',owner);
    if(!file || !/\.(pdf|docx|doc|txt|md)$/i.test(file.name||'')) throw new Error('Choose PDF, DOCX, DOC, TXT or MD.');
    if(file.size>10*1024*1024) throw new Error('The guideline file must be 10 MB or smaller.');
    return track((async()=>{const metadata={};check();const text=String(await W.extractText(file,metadata)||'').trim();check();if(text.length<100)throw new Error('Fewer than 100 characters were extracted. Paste text or use a text-based PDF/DOCX.');if(text.length>2000000)throw new Error('The guideline exceeds 2,000,000 text characters.');return {text,metadata,warning:metadata.approximate?'Legacy DOC extraction is approximate. Review the text or save as DOCX.':null};})());
  }
  function prompt(key) { init(); if(typeof W.PROMPTS?.[key]!=='string')throw new Error('Prompt not found.'); return W.PROMPTS[key]; }
  function download(blob,name,owner) { assert(owner);const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
  function exportAudit(format='json') {
    const owner=init(); if(state.audit.status!=='ready')throw new Error('Load the audit log before exporting.');
    const rows=clone(state.audit.rows), stamp=new Date().toISOString(), name='stm_audit_loaded_'+rows.length+'_'+stamp.slice(0,10);
    if(format==='json') download(new Blob([JSON.stringify({source:'loaded_cloud_audit',filter_category:state.audit.category,generated_at:stamp,event_count:rows.length,has_more:state.audit.hasMore,scope:state.audit.scope,events:rows},null,2)],{type:'application/json'}),name+'.json',owner);
    else if(format==='csv') {
      const keys=['id','created_at','user_id','submission_id','category','message','meta'];
      const cell=value=>{let v=typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'');if(/^[\s\u0000-\u001f]*[=+@-]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';};
      const csv=[keys.map(cell).join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\r\n');
      download(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),name+'.csv',owner);
    } else throw new Error('Choose JSON or CSV.');
    return {rows:rows.length,scope:'loaded_filtered_cloud'};
  }
  function exportFeedback() {
    const owner=init(),check=ticket('feedback-export',owner);
    if(!W.XLSX)throw new Error('The spreadsheet library is unavailable.');
    return track((async()=>{
      const events=await allRows('feedback_events','*',check);check();
      if(!events.length)throw new Error('No cloud feedback is available to export.');
      events.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))||String(b.id).localeCompare(String(a.id)));
      const x=W.XLSX,wb=x.utils.book_new(),long=[['Event ID','Field','Part','Text']],modules=new Map();
      function value(raw,id,field){let text=typeof raw==='object'&&raw!==null?JSON.stringify(raw):String(raw??'');if(text.length<=30000)return text;let part=0;while(text.length){let end=Math.min(30000,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;long.push([id,field,++part,text.slice(0,end)]);text=text.slice(end);}return '[Full text in Long Text sheet: '+id+' / '+field+']';}
      const header=['Event ID','Timestamp (ISO)','Actor','User ID','Module','Sentiment','Reason(s)','Comment','Pipeline Run','Submission ID','Source Docs','Output Snapshot','Exported At'];
      const data=[header],counts={positive:0,negative:0,suggestion:0,other:0};
      events.forEach(r=>{const c=r.context||{},mod=String(c.moduleName||r.module_key||'(custom)'),sentiment=({up:'positive',down:'negative',comment:'suggestion'})[r.rating]||'other';counts[sentiment]++;
        const row=[r.id,r.created_at,c.actor||'unknown',r.user_id,mod,sentiment,c.reason,r.comment,r.pipeline_run,r.submission_id,Array.isArray(c.sourceDocNames)?c.sourceDocNames.join(' · '):c.sourceDocNames,c.outputSnapshot,r.exported_at].map((v,i)=>value(v,r.id,header[i]));
        data.push(row);if(!modules.has(mod))modules.set(mod,[]);modules.get(mod).push(row);
      });
      const summary=[['FEEDBACK EXPORT'],['Generated',new Date().toISOString()],['Total events',events.length],['Positive',counts.positive],['Negative',counts.negative],['Suggestions',counts.suggestion],['Other ratings',counts.other],['Scope','Cloud rows visible to the authenticated administrator, read in multiple pages.'],['Export status','Downloading does not change exported_at.'],['Long text','Values longer than 30,000 characters are preserved in numbered Long Text rows.'],[],['Module','Total']];
      for(const [name,rows]of modules)summary.push([value(name,'module','name'),rows.length]);
      x.utils.book_append_sheet(wb,x.utils.aoa_to_sheet(summary),'Summary');x.utils.book_append_sheet(wb,x.utils.aoa_to_sheet(data),'All Events');
      const used=new Set(['summary','all events','long text']);
      for(const [name,rows]of modules){let base=name.replace(/[\\/\[\]*?:]/g,'_').replace(/^'+|'+$/g,'').trim()||'Module',sheet=base.slice(0,31).replace(/^'+|'+$/g,'')||'Module',n=1;while(used.has(sheet.toLowerCase())){const tail='_'+n++;sheet=(base.slice(0,31-tail.length).replace(/^'+|'+$/g,'')||'Module')+tail;}used.add(sheet.toLowerCase());x.utils.book_append_sheet(wb,x.utils.aoa_to_sheet([header,...rows]),sheet);}
      if(long.length>1)x.utils.book_append_sheet(wb,x.utils.aoa_to_sheet(long),'Long Text');
      check();x.writeFile(wb,'stm_feedback_'+new Date().toISOString().slice(0,10)+'.xlsx');return {rows:events.length,scope:'cloud_observed',markedExported:false};
    })());
  }
  function retire(notify=true) {
    generation++;tickets={};scope=null;state=fresh();
    if(W.STATE)W.STATE.adminAudit={rows:[],category:'all',categories:null,hasMore:false};
    if(notify)emit();return Promise.allSettled([...tasks]);
  }
  W.__STM_NATIVE_ADMIN={read,refresh,configure,parseGuide,prompt,exportAudit,exportFeedback,retire,get busy(){return working>0;}};
})();
