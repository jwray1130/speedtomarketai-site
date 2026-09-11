/* Review projection for the original Workbench rules. The saved extraction and
   Summary override remain separate in cloud storage; manual Workbench edits win. */
(function(W){
 'use strict';
 function textFromHTML(value){
  const d=new DOMParser().parseFromString(String(value??''),'text/html');
  for(const el of d.querySelectorAll('script,style,iframe,object,embed,template,noscript'))el.remove();
  function walk(node){
   if(node.nodeType===3)return node.nodeValue||'';
   if(node.nodeType!==1)return '';
   if(node.tagName==='BR')return '\n';
   if(node.tagName==='TABLE'){
    const rows=Array.from(node.querySelectorAll('tr')).filter(r=>r.closest('table')===node).map(r=>Array.from(r.children).filter(c=>/^(TD|TH)$/.test(c.tagName)).map(c=>Array.from(c.childNodes).map(walk).join('').trim().replace(/\|/g,'\\|').replace(/\s*\n\s*/g,' ')));
    if(!rows.length)return '';
    const width=Math.max(...rows.map(r=>r.length));const row=r=>'| '+Array.from({length:width},(_,i)=>r[i]||'').join(' | ')+' |';
    return '\n'+[row(rows[0]),row(Array(width).fill('---')),...rows.slice(1).map(row)].join('\n')+'\n';
   }
   const content=Array.from(node.childNodes).map(walk).join('');
   if(node.tagName==='LI')return '\n- '+content.trim()+'\n';
   return /^(P|DIV|H[1-6]|UL|OL|PRE|BLOCKQUOTE|SECTION|ARTICLE|TR)$/.test(node.tagName)?'\n'+content+'\n':content;
  }
  return Array.from(d.body.childNodes).map(walk).join('').replace(/\n{3,}/g,'\n\n').trim();
 }
 function project(data){
  if(!data?.snapshot?.edits||!data.snapshot.extractions)return data;
  const extractions={...data.snapshot.extractions};let count=0;
  for(const [id,edit]of Object.entries(data.snapshot.edits)){
   if(!edit||!Object.prototype.hasOwnProperty.call(edit,'htmlOverride')||!extractions[id])continue;
   extractions[id]={...extractions[id],text:textFromHTML(edit.htmlOverride),reviewedInSummary:true};count++;
  }
  return count?{...data,snapshot:{...data.snapshot,extractions}}:data;
 }
 W.__STM_REVIEW_SOURCE=project;W.__STM_REVIEW_TEXT=textFromHTML;
})(window);
