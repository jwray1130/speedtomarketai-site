
/* ============================================================
   Speed to Market AI · unified shell. One top bar, one router, one
   theme; every page is its own document in a frame, so nothing in one
   page can collide with another. Pages talk to the shell by message:
   nav (a tab or link inside a page), theme-toggle, ready.
   ============================================================ */
const USER={name:'Not signed in',role:'',initials:'--'};
const ROUTES=STMFoundation.shellRoutes();
const LABELS={'Queue':'queue','Submission':'sub-pipe','Admin':'admin','Pipeline':'sub-pipe','Summary':'sub-sum','Documents':'sub-docs','Deal Information':'wb-deal','Risk & Coverage':'wb-loss','Forms & Subjectivities':'wb-forms','Underwriting':'wb-uw','History':'wb-history','Renewal':'wb-renewal','Loss History':'wb-loss','Limits & Premiums':'wb-limits','GL Exposure/Rater':'wb-gl','AL Fleet/Rater':'wb-al','Internal Rater':'wb-internal','Forms & Endorsements':'wb-forms','Subjectivities & Conditions':'wb-subj','Workbench':'wb-deal','Platform':'queue'};
const PLATFORM=['Queue','Submission','Admin'],CHAPTERS=['Deal Information','Risk & Coverage','Forms & Subjectivities','Underwriting','History'];
function chapterList(){const r=window.STM_RUNTIME;const list=CHAPTERS.slice();if(r&&r.dealType==='Renewal')list.splice(list.indexOf('History'),0,'Renewal');return list}
function dealTypeSwitch(){const r=window.STM_RUNTIME;if(!r||!r.activeId)return '';const dt=r.dealType==='Renewal'?'Renewal':'New';return `<span class="deal-type" role="group" aria-label="Deal type"><b>Type</b><button class="${dt==='New'?'on':''}" data-act="dealtype" data-type="New" title="Set the deal type to New">New</button><button class="${dt==='Renewal'?'on':''}" data-act="dealtype" data-type="Renewal" title="Set the deal type to Renewal">Renewal</button></span>`}
const I={chev:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 10 5l6 6"/><path d="M4 15 10 9l6 6" opacity=".55"/></svg>',moon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',sun:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',sys:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8h13l-3-3M17 16H4l3 3"/></svg>',save:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg>',wb:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v14H4z"/><path d="M4 10h16M9 10v9"/></svg>',back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>'};
const state={route:null,theme:'light',lastSub:'sub-pipe',lastRc:'wb-loss',lastFs:'wb-forms',menu:false};
const FONTS=document.getElementById('fonts').textContent;
const TYPOGRAPHY=document.getElementById('stm-typography').textContent;
const EDITORIAL_CSS=document.getElementById('stm-editorial-accents').textContent;
const EDITORIAL_JS=document.getElementById('stm-editorial-script').textContent;
const themeIcon=()=>state.theme==='dark'?I.sun:I.moon;
function topbar(){const r=ROUTES[state.route];const wb=r.surface==='workbench';
 const brand=`<a class="brand" href="#/queue" data-go="queue"><span class="mark">${I.chev}</span><span>Speed to Market <em>AI</em></span></a>`;
 const nav=wb?`<nav class="chapters">${chapterList().map(c=>`<button class="${r.nav===c?'on':''} ${c==='Renewal'&&window.STM_RUNTIME?.freshTab==='Renewal'?'fresh':''}" data-label="${c}">${c}</button>`).join('')}${dealTypeSwitch()}</nav>`:`<nav class="nav">${PLATFORM.map(c=>`<button class="${r.nav===c?'on':''}" data-label="${c}">${c}</button>`).join('')}</nav>`;
 const right=`<div class="tb-right">${wb?`<button class="tb-pill sw" data-label="Queue" title="Back to the queue">${I.back}<span class="t">Queue</span></button>`:`<button class="tb-pill sw" data-label="Workbench" title="Open the workbench">${I.wb}<span class="t">Workbench</span></button>`}<button class="tb-pill" data-act="menu" id="sysBtn" aria-haspopup="menu" aria-expanded="${state.menu}">${I.sys}<span>Systems</span><span class="car"></span></button>${wb?`<button class="tb-pill acts" data-act="actions" aria-haspopup="menu">Actions<span class="car"></span></button><button class="btn btn-primary save" data-act="save">${I.save}Save</button>`:''}<span class="tb-pill in"><i></i><span class="t">Signed in · Active session</span></span><button class="tb-icon" data-act="theme" title="Toggle theme (T)">${themeIcon()}</button><span class="tb-user"><span class="av">${STMIntegration.escape(USER.initials)}</span><span class="who"><b>${STMIntegration.escape(USER.name)}</b><span>${STMIntegration.escape(USER.role)}</span></span></span></div>`;
 return `<header class="topbar g ${wb?'wb':''}">${brand}${nav}${right}</header>`}
function sysmenu(){const groups=[['Platform',['queue','sub-pipe','sub-sum','sub-docs','admin']],['Workbench',['wb-deal','wb-loss','wb-limits','wb-gl','wb-al','wb-internal','wb-forms','wb-subj','wb-uw','wb-renewal','wb-history']]];return `<div class="sysmenu ${state.menu?'open':''}" id="sysmenu">${groups.map(([g,ids])=>`<span class="k">${g}</span>${ids.map(id=>`<button class="${state.route===id?'on':''}" data-go="${id}"><span>${ROUTES[id].title}</span><small>${ROUTES[id].hash.replace('#/','')}</small></button>`).join('')}`).join('')}</div>`}
function renderChrome(){document.getElementById('chrome').innerHTML=topbar()+sysmenu();const b=document.getElementById('sysBtn'),m=document.getElementById('sysmenu');if(b&&m){const r=b.getBoundingClientRect();m.style.left=Math.max(12,Math.min(window.innerWidth-320,r.left))+'px'}document.title='Speed to Market AI / '+ROUTES[state.route].title}
const frames={};
const PAGE_SHORTCUTS="(function(){window.addEventListener('keydown',function(e){if(String(e.key).toLowerCase()!=='t'||e.ctrlKey||e.metaKey||e.altKey||e.isComposing||parent.STMFoundation.isEditable(e.target))return;e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)parent.setTheme(parent.STM_RUNTIME.theme==='dark'?'light':'dark');},true);})();";
function pageSource(id){
 const t=document.getElementById('page-'+id);if(!t)return null;
 return t.textContent.replace(/<\\\/script/g,'</script')
  .replace('/*__FONTS__*/',FONTS)
  .replace(/<html(?=[\s>])/i,'<html data-stm-page="'+id+'"')
  .replace(/<\/head>/i,'<style id="stm-typography">'+TYPOGRAPHY+'</style><style id="stm-editorial-accents">'+EDITORIAL_CSS+'</style><script>'+PAGE_SHORTCUTS+'<'+'/script></head>')
  .replace(/<\/body>/i,'<script>'+EDITORIAL_JS+'<'+'/script></body>');
}
function frameFor(id){if(frames[id])return frames[id];const f=document.createElement('iframe');f.id='frame-'+id;f.title=ROUTES[id].title;f.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads');const src=pageSource(id);frames[id]=f;document.getElementById('frames').appendChild(f);document.getElementById('loading').classList.add('on');f.addEventListener('load',()=>{if(document.body.dataset.busy!=='true')document.getElementById('loading').classList.remove('on');post(f,{type:'theme',theme:state.theme})});f.srcdoc=src;return f}
function post(f,m){m.stm=1;try{f.contentWindow.postMessage(m,location.origin==='null'?'*':location.origin)}catch(_){}}
function go(id,push=true){if(!STMFoundation.validRoute(id))id='queue';state.route=id;const r=ROUTES[id];if(id.startsWith('sub-'))state.lastSub=id;if(['wb-loss','wb-limits','wb-gl','wb-al','wb-internal'].includes(id))state.lastRc=id;if(['wb-forms','wb-subj'].includes(id))state.lastFs=id;state.menu=false;
 Object.values(frames).forEach(f=>f.classList.remove('on'));const f=frameFor(id);f.classList.add('on');renderChrome();if(push&&location.hash!==r.hash)history.pushState(null,'',r.hash);try{localStorage.setItem('stm-route',id)}catch(_){}}
function goLabel(label){let id=Object.hasOwn(LABELS,label)?LABELS[label]:null;if(!id)return toast(label+' is not a page in this build');if(label==='Submission')id=state.lastSub;if(label==='Risk & Coverage')id=state.lastRc;if(label==='Forms & Subjectivities')id=state.lastFs;go(id)}
function fromHash(){const h=location.hash;const hit=Object.entries(ROUTES).find(([id,r])=>r.hash===h);return hit?hit[0]:null}
function setTheme(t){state.theme=t;document.documentElement.dataset.theme=t;try{localStorage.setItem('stm-theme',t)}catch(_){}Object.values(frames).forEach(f=>post(f,{type:'theme',theme:t}));renderChrome()}
function toast(msg){const w=document.getElementById('toasts');const t=document.createElement('div');t.className='toast';const dot=document.createElement('i');t.append(dot,document.createTextNode(String(msg)));w.appendChild(t);setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),400)},2600)}
document.getElementById('chrome').addEventListener('click',e=>{const el=e.target.closest('[data-go],[data-label],[data-act]');if(!el)return;e.preventDefault();
 if(el.dataset.go){go(el.dataset.go);return}if(el.dataset.label){goLabel(el.dataset.label);return}
 const a=el.dataset.act;if(a==='menu'){state.menu=!state.menu;renderChrome();return}if(a==='theme'){setTheme(state.theme==='dark'?'light':'dark');return}if(a==='toast'){toast((el.dataset.msg||'That')+' runs in the live app');return}});
document.addEventListener('click',e=>{if(state.menu&&!e.target.closest('#sysmenu,#sysBtn')){state.menu=false;renderChrome()}});
window.addEventListener('message',e=>{const d=e.data||{};if(!d.stm||!Object.values(frames).some(f=>f.contentWindow===e.source))return;if(d.type==='nav')goLabel(d.label);else if(d.type==='theme-toggle')setTheme(state.theme==='dark'?'light':'dark')});


document.addEventListener('keydown',e=>{if(STMFoundation.isEditable(e.target))return;if((e.key==='t'||e.key==='T')&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.repeat&&!e.isComposing)setTheme(state.theme==='dark'?'light':'dark');if(e.key==='Escape'&&state.menu){state.menu=false;renderChrome();document.getElementById('sysBtn')?.focus()}});
window.addEventListener('resize',()=>{if(state.menu)renderChrome()});

