'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'workbench-app.js'),'utf8');
const copy=x=>JSON.parse(JSON.stringify(x));let sequence=0;
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
function harness(db=new Map(),storage=new Map()){
 const {document}=parseHTML('<html><body><span id="dealNum"></span><div id="workbenchLoadStatus"></div><div id="historyLog"></div></body></html>');
 let clock=Date.parse('2026-01-02T10:00:00Z'),failLoad=false;
 class TestDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const edits={submissionId:null,map:{},removed:new Set(),dirtyTables:new Set(),formsDirty:false,restoring:false};
 const c={document,console,Date:TestDate,STM_EDITS:edits,STM_EDIT_TABLES:[],integrationRevision:0,integrationDirty:false,integrationLocalKey:null,Event:document.defaultView.Event,
  currentUser:{id:'USER-A',display_name:'Example Underwriter'},crypto:{randomUUID:()=> 'event-'+(++sequence)},escapeHtml:s=>String(s),stmInjectEditsUi(){},stmRefreshEditsPill(){},stmWorkbenchDealNumber:()=> '123456',
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  sb:{from(table){assert.equal(table,'workbench_field_edits');return{select(){return{eq:async(field,sid)=>({data:copy(db.get(sid)||[])})};},upsert:async rows=>{for(const row of rows){const previous=db.get(row.submission_id)||[],next=previous.filter(r=>r.field_key!==row.field_key);next.push(copy(row));db.set(row.submission_id,next);}return{};}};}}
 };c.window=c;vm.createContext(c);
 vm.runInContext(section('    const APP_EVENTS = [];','    /* ═════════')+'\nthis.historySnapshot=()=>APP_EVENTS.slice();this.replaceHistory=rows=>{APP_EVENTS.splice(0,APP_EVENTS.length,...rows);renderHistoryLog();};',c);
 vm.runInContext(section('    function stmLocalKey()','    window.restoreWorkbenchEdits8760 ='),c);
 const api={get submissionId(){return edits.submissionId;},get restoreError(){return edits.restoreError;},history:()=>c.historySnapshot()};
 c.__STM_WB=api;
 vm.runInContext('this.methods=({'+section('        async load(data){','        setField(id,value){')+'});',c);
 api.load=c.methods.load;api.save=c.methods.save;
 c.__stmApplyPhasePipeline=async()=>{for(const action of ['Layer Type changed','Forms loaded','Coverage selected'])c.recordHistory(action,'Source initialization');if(failLoad)throw new Error('Synthetic source load failure');};
 vm.runInContext(fs.readFileSync(path.join(root,'workbench-phase7.js'),'utf8'),c);
 const p7=c.STMWorkbenchPhase7.install({api,edits,markDirty(){},mirror:c.stmWriteLocalMirror,changed(){c.integrationRevision++;c.integrationDirty=true;},recordHistory:c.recordHistory,replaceHistory:c.replaceHistory});
 return{c,api,p7,edits,db,storage,now:n=>{clock=Date.parse(n);},fail:on=>{failLoad=on;},history:()=>copy(c.historySnapshot()),saved:()=>copy(db.get('SUB-A')||[])};
}

test('source population and restore do not generate user History entries on first load or reopen',async()=>{
 const h=harness();await h.api.load({id:'SUB-A'});assert.deepEqual(h.history(),[]);
 await h.api.save();assert.equal(h.saved().some(row=>row.field_key==='__phase7'),false,'no fabricated initialization history is persisted');
 assert.equal(h.history()[0].action,'Saved to cloud','the newest save result remains session-only');
 const r=harness(h.db,h.storage);r.now('2026-01-02T11:00:00Z');await r.api.load({id:'SUB-A'});assert.deepEqual(r.history(),[]);
});

test('actual user events retain original IDs, timestamps, actor and order through save and reopened restore',async()=>{
 const h=harness();await h.api.load({id:'SUB-A'});
 h.p7.record('SUB-A','Underwriting edited','pricingRationale');h.now('2026-01-02T10:02:00Z');h.p7.record('SUB-A','Subjectivities edited','Custom condition');
 const original=h.history();assert.equal(original.length,2);assert.notEqual(original[0].id,original[1].id);
 const result=await h.api.save();assert.equal(result.mode,'cloud');assert.deepEqual(h.saved().find(row=>row.field_key==='__phase7').value.data.history,original);
 const reopened=harness(h.db,h.storage);reopened.now('2026-01-02T11:00:00Z');await reopened.api.load({id:'SUB-A'});
 assert.deepEqual(reopened.history(),original,'hydration does not restamp or add synthetic entries');
 h.now('2026-01-02T10:03:00Z');const beforeSecondSave=h.history();await h.api.save();
 const twice=harness(h.db,h.storage);twice.now('2026-01-02T12:00:00Z');await twice.api.load({id:'SUB-A'});
 assert.deepEqual(twice.history(),beforeSecondSave,'the following save persists the earlier save result with its original time');
});

test('a failed source refresh releases suppression and real subsequent actions are still saved',async()=>{
 const h=harness();await h.api.load({id:'SUB-A'});h.p7.record('SUB-A','Underwriting edited','Existing review');const original=h.history();
 h.fail(true);await assert.rejects(h.api.load({id:'SUB-A'}),/Synthetic source load failure/);assert.deepEqual(h.history(),original);
 h.now('2026-01-02T10:05:00Z');h.p7.record('SUB-A','Underwriting edited','Later review');await h.api.save();
 assert.equal(h.saved().find(row=>row.field_key==='__phase7').value.data.history.length,2);
});

test('failed cloud save retains user history locally without recording a false cloud-success event',async()=>{
 const h=harness();await h.api.load({id:'SUB-A'});h.p7.record('SUB-A','Underwriting edited','Review before failed save');const original=h.history();
 h.c.console={warn(){}};h.c.sb.from=()=>({upsert:async()=>({error:{message:'Synthetic unavailable storage'}})});
 const result=await h.api.save();assert.equal(result.mode,'local-fail');assert.equal(h.history().some(e=>e.action==='Saved to cloud'),false);
 const reopened=harness(h.db,h.storage);await reopened.api.load({id:'SUB-A'});assert.deepEqual(reopened.history(),original);
});
