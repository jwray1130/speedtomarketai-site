const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {parseHTML}=require('linkedom');
const root=path.join(__dirname,'..');
const runtime=fs.readFileSync(path.join(root,'redesign-runtime.js'),'utf8');
const start=runtime.indexOf('function setBusy('),end=runtime.indexOf('\nfunction showError',start);
assert.ok(start>=0&&end>start,'actual loading state writer exists');
function harness(entry){
 const html=fs.readFileSync(path.join(root,entry),'utf8');
 const {document}=parseHTML(html);
 const context=vm.createContext({document,busy:0,sessionEpoch:1});
 vm.runInContext(runtime.slice(start,end),context);
 return {html,document,context,loading:document.getElementById('loading')};
}
test('both entrypoints hide the initial status from accessibility without changing its visual fade',()=>{
 for(const entry of ['platform.html','workbench.html']){
  const h=harness(entry);assert.equal(h.loading.getAttribute('aria-hidden'),'true');assert.equal(h.loading.getAttribute('role'),'status');assert.equal(h.loading.textContent,'Loading');assert.equal(h.loading.classList.contains('on'),false);
  assert.match(h.html,/#loading\{[^}]*opacity:0;[^}]*transition:opacity \.2s;/);assert.match(h.html,/#loading\.on\{opacity:1;\}/);
 }
});
test('actual busy lifecycle exposes current status only while work remains, retaining fading text offscreen',()=>{
 const h=harness('platform.html'),{context:c,loading:el}=h;
 c.setBusy(true,'Opening example submission');assert.equal(el.getAttribute('aria-hidden'),'false');assert.equal(el.textContent,'Opening example submission');assert.equal(el.classList.contains('on'),true);assert.equal(h.document.body.dataset.busy,'true');
 c.setBusy(true,'Preparing example workbench');c.setBusy(false,null,1);assert.equal(el.getAttribute('aria-hidden'),'false');assert.equal(el.classList.contains('on'),true);
 c.setBusy(false,null,1);assert.equal(el.getAttribute('aria-hidden'),'true');assert.equal(el.classList.contains('on'),false);assert.equal(h.document.body.dataset.busy,'false');assert.equal(el.textContent,'Preparing example workbench');
 c.setBusy(true,'New active task');c.setBusy(false,null,0);assert.equal(el.getAttribute('aria-hidden'),'false');assert.equal(el.classList.contains('on'),true);assert.equal(el.textContent,'New active task');
 c.setBusy(false,null,1);assert.equal(el.getAttribute('aria-hidden'),'true');
});
