'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const C=require('./csp-hashes.cjs');
const root=path.join(__dirname,'..');
const config=()=>JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));

test('deployment hashes cover current HTML and actual srcdoc script blocks with no stale allowlist',()=>{
 const inventory=C.collect(),headers=C.policyHeaders(config());
 assert.deepEqual(inventory.files,['engine-platform.html','engine-workbench.html','index.html','platform.html','workbench.html']);
 assert.ok(inventory.pages.length>=30,'both entry pages generate every design');
 for(const entry of ['platform.html','workbench.html']){
  assert.ok(inventory.pages.some(x=>x.file===entry&&x.id==='wb-internal'));
  assert.ok(inventory.pages.some(x=>x.file===entry&&x.id==='sub-docs'));
 }
 const expected=new Set(inventory.hashes);
 for(const {header}of headers){
  const script=header.value.split(';').find(x=>x.trim().startsWith('script-src '));
  const allowed=new Set(script.match(/'sha256-[^']+'/g)||[]);
  assert.deepEqual([...allowed].sort(),[...expected].sort(),'run node tests/csp-hashes.cjs --write after approved inline changes');
  for(const item of inventory.scripts)assert.ok(allowed.has(item.hash),item.label);
 }
 const sample=inventory.pages.find(x=>x.id==='sub-docs');
 const emitted=C.inlineScripts(sample.source,'actual-documents-srcdoc');
 assert.ok(emitted.some(x=>x.text.includes('stopImmediatePropagation')),'runtime-injected shortcut script is included');
 assert.ok(emitted.some(x=>x.text.includes('stm-editorial')),'runtime-injected editorial script is included');
});

test('CSP hashes follow browser newline normalization without trimming or entity-decoding script text',()=>{
 const lf='<script>\nwindow.example = "&amp;";\n</script>',crlf=lf.replace(/\n/g,'\r\n');
 const a=C.inlineScripts(lf,'LF')[0],b=C.inlineScripts(crlf,'CRLF')[0];
 assert.equal(a.hash,b.hash);assert.equal(a.text,'\nwindow.example = "&amp;";\n');
 assert.notEqual(a.hash,C.hash(a.text.trim()),'boundary whitespace is significant');
 assert.notEqual(a.hash,C.hash(a.text.replace('&amp;','&')),'script raw text is not HTML entity-decoded');
 assert.equal(C.inlineScripts('<script type="application/ld+json">{}</script><script src="x.js"></script><script type="text/plain">ignored</script>','data').length,0);
 assert.equal(C.inlineScripts('<script type="module">import "x";</script><script type="importmap">{}</script>','modules').length,2);
});

test('hash refresh preserves report-only mode and every non-hash deployment directive',()=>{
 const current=config(),headers=C.policyHeaders(current);
 assert.equal(headers.length,1);assert.equal(headers[0].header.key,'Content-Security-Policy-Report-Only');
 assert.equal(C.policyDigest(current),'fbdb4367286475bf2651af97e1b0e2c9a9d6be5404c819c94f628f8101d748e5');
 const script=headers[0].header.value.split(';').find(x=>x.trim().startsWith('script-src '));
 assert.equal(script.includes("'unsafe-inline'"),false);assert.equal(script.includes("'unsafe-hashes'"),false);
});
