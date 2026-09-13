'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const root=path.join(__dirname,'..');
const normalize=text=>String(text).replace(/\r\n?/g,'\n');
const hash=text=>"'sha256-"+crypto.createHash('sha256').update(normalize(text),'utf8').digest('base64')+"'";
const directives=value=>value.split(';').map(x=>x.trim()).filter(Boolean).map(x=>x.split(/\s+/));
const hashToken=value=>/^'sha(?:256|384|512)-[^']+'$/.test(value);
function inlineScripts(html,label){
 const document=parseHTML(normalize(html)).document;
 return Array.from(document.querySelectorAll('script')).filter(script=>{
  const type=(script.getAttribute('type')||'').trim().toLowerCase();
  return !script.hasAttribute('src')&&['','module','text/javascript','application/javascript','importmap'].includes(type)&&script.textContent.trim();
 }).map((script,index)=>({label:label+'#'+(script.id||index),text:script.textContent,hash:hash(script.textContent)}));
}
function collect(){
 const files=fs.readdirSync(root,{withFileTypes:true}).filter(x=>x.isFile()&&x.name.endsWith('.html')).map(x=>x.name).sort();
 const scripts=[],pages=[];
 const shell=normalize(fs.readFileSync(path.join(root,'redesign-shell.js'),'utf8'));
 const start=shell.indexOf('const PAGE_SHORTCUTS='),end=shell.indexOf('function frameFor(',start);
 assert.ok(start>=0&&end>start,'production srcdoc builder seam exists');
 for(const file of files){
  const html=normalize(fs.readFileSync(path.join(root,file),'utf8'));
  scripts.push(...inlineScripts(html,file));
  const document=parseHTML(html).document;
  const templates=Array.from(document.querySelectorAll('script[type="text/plain"][id^="page-"]'));
  if(!templates.length)continue;
  const text=id=>{const node=document.getElementById(id);assert.ok(node,'missing shell asset '+id);return node.textContent;};
  const context=vm.createContext({document,FONTS:text('fonts'),TYPOGRAPHY:text('stm-typography'),EDITORIAL_CSS:text('stm-editorial-accents'),EDITORIAL_JS:text('stm-editorial-script')});
  // Run only the repository's string builder, never application startup,
  // generated scripts, authentication or network transports.
  vm.runInContext(shell.slice(start,end),context);
  for(const template of templates){
   const id=template.id.slice(5),source=context.pageSource(id);assert.ok(source,'generated page '+id);
   pages.push({file,id,source});scripts.push(...inlineScripts(source,file+'/'+id));
  }
 }
 return {files,pages,scripts,hashes:[...new Set(scripts.map(x=>x.hash))].sort()};
}
function policyHeaders(config){return config.headers.flatMap(rule=>rule.headers.filter(h=>/^Content-Security-Policy(?:-Report-Only)?$/i.test(h.key)).map(header=>({source:rule.source,header})));}
function stripHashes(config){
 const copy=structuredClone(config);
 for(const {header}of policyHeaders(copy))header.value=directives(header.value).map(d=>d.filter(t=>!hashToken(t)).join(' ')).join('; ');
 return copy;
}
function policyDigest(config){return crypto.createHash('sha256').update(JSON.stringify(stripHashes(config))).digest('hex');}
function update(){
 const file=path.join(root,'vercel.json'),config=JSON.parse(fs.readFileSync(file,'utf8')),before=policyDigest(config),inventory=collect();
 const headers=policyHeaders(config);
 assert.equal(headers.length,1,'review scope before changing additional CSP policies');
 assert.equal(headers[0].source,'/(.*)');assert.equal(headers[0].header.key,'Content-Security-Policy-Report-Only');
 const parts=directives(headers[0].header.value),script=parts.find(d=>d[0]==='script-src');assert.ok(script);
 script.splice(0,script.length,...script.filter(t=>!hashToken(t)),...inventory.hashes);
 headers[0].header.value=parts.map(d=>d.join(' ')).join('; ');
 assert.equal(policyDigest(config),before,'only inline script hashes may change');
 fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n');
 return {htmlFiles:inventory.files.length,renderedPages:inventory.pages.length,inlineScripts:inventory.scripts.length,uniqueHashes:inventory.hashes.length,policyDigest:before};
}
module.exports={normalize,hash,inlineScripts,collect,policyHeaders,stripHashes,policyDigest,update};
if(require.main===module){assert.equal(process.argv[2],'--write','Usage: node tests/csp-hashes.cjs --write');console.log(JSON.stringify(update()));}
