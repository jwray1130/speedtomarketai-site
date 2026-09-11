/* Admin data stays in July's adapters. Unimplemented backend capabilities are
 * explicitly described, never represented by sample success notifications.
 */
(function(global){
 'use strict';const clone=x=>JSON.parse(JSON.stringify(x));let id=null,state=null,tickets={};
 function guard(){const u=global.currentUser,r=parent.STM_RUNTIME;if(!u||u.role!=='admin'||r&&(r.platformWindow!==global||r.user?.id!==u.id||r.user?.role!=='admin'))throw new Error('Administrator access required.');return u.id;}
 function init(){const now=guard();if(now!==id){id=now;tickets={};state={users:{status:'idle',rows:[]},feedback:{status:'idle',summary:null,rows:[]},audit:{status:'idle',rows:[],categories:[],category:'all',hasMore:false},lastRefresh:null};}return id;}
 function valid(owner,kind,ticket){return guard()===owner&&id===owner&&tickets[kind]===ticket;}
 async function refresh(kind='all',options={}){
  const owner=init(),kinds=kind==='all'?['users','feedback','audit']:[kind];if(kinds.some(k=>!['users','feedback','audit'].includes(k)))throw new Error('Unknown admin panel.');
  await Promise.all(kinds.map(async k=>{const token=(tickets[k]||0)+1;tickets[k]=token;state[k].status='loading';delete state[k].error;
   const category=options.category??state.audit.category;if(k==='audit'&&category!==state.audit.category){state.audit.rows=[];state.audit.category=category;options={...options,append:false};}
   try{let patch;
    if(k==='users')patch={rows:await global.sbLoadAdminUsers()};
    else if(k==='feedback'){const [summary,rows]=await Promise.all([global.sbLoadFeedbackSummary(),global.sbLoadFeedbackRecent(10)]);patch={summary,rows};}
    else{const prior=options.append?state.audit.rows:[],cursor=prior.at(-1)?.created_at||null;
     const [rows,categories]=await Promise.all([global.sbLoadAuditEvents({category,beforeCreatedAt:cursor,limit:50}),global.sbLoadAuditCategories()]);
     const seen=new Set(prior.map(r=>r.id));const merged=[...prior];for(const r of rows){if(!seen.has(r.id)){seen.add(r.id);merged.push(r);}}patch={rows:merged,categories,category,hasMore:rows.length===50&&(!options.append||merged.length>prior.length)};
    }
    if(valid(owner,k,token))state[k]={...state[k],...patch,status:'ready'};
   }catch(e){let current=false;try{current=valid(owner,k,token);}catch(_){}if(current)state[k]={...state[k],status:'error',error:e.message||String(e)};}
  }));if(guard()===owner&&id===owner)state.lastRefresh=new Date().toISOString();return read();
 }
 function read(){init();const cfg=global.__STM_ADMIN_CONFIG.read(),s=global.STATE;
  return {...clone(state),user:{id,displayName:global.currentUser.display_name||global.currentUser.email},config:cfg,prompts:Object.entries(global.PROMPTS||{}).map(([key,text])=>({key,characters:typeof text==='string'?text.length:0})),usage:{submission:s?.activeSubmissionId||null,cost:typeof s?.runTotalCost==='number'&&Number.isFinite(s.runTotalCost)?s.runTotalCost:null},unsupported:['User invitations and role changes require a privileged backend not supplied in July.','Versioned guideline publication/diff is not implemented in July; saved guideline overrides are per user.','Per-module STP/QA tuning and prompt override/evaluation have no persisted application contract in July.','Microsoft 365, SharePoint, OneDrive, Box, Guidewire and Duck Creek connectors are not implemented by these files.','SOC 2 certification/PDF and historical spend telemetry are not supplied by this application.']};
 }
 async function configure(data){const owner=init();const result=await global.__STM_ADMIN_CONFIG.commit(data);if(guard()!==owner)throw new Error('Administrator session changed.');return result;}
 async function parseGuide(file){const owner=init();if(!file||file.size>25*1024*1024)throw new Error('Choose a supported document up to 25 MB.');const text=await global.extractText(file);if(guard()!==owner)throw new Error('Administrator session changed.');if(typeof text!=='string'||!text.trim())throw new Error('No guideline text could be extracted.');return text;}
 function prompt(key){init();const raw=global.PROMPTS?.[key];if(typeof raw!=='string')throw new Error('This module has no text prompt in the supplied library.');return raw;}
 async function action(name){init();if(name==='feedback-export'){if(!global.XLSX)throw new Error('Excel export dependency is not loaded.');await global.exportFeedback({requireCloud:true});return;}if(name==='audit-export'){if(state.audit.status!=='ready')throw new Error('Load the audit log successfully before exporting.');global.STATE.adminAudit={...global.STATE.adminAudit,rows:clone(state.audit.rows),category:state.audit.category};await global.exportAudit();return;}throw new Error('Unsupported administrator action.');}
 global.__STM_ADMIN={read,refresh,configure,parseGuide,prompt,action};
})(window);
