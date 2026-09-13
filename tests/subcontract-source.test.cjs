'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),engine=fs.readFileSync(path.join(root,'pipeline-engine.js'),'utf8');
const slice=(start,end)=>{const a=engine.indexOf(start),b=engine.indexOf(end,a);assert.ok(a>=0&&b>a,start);return engine.slice(a,b);};
function harness(){const logs=[],ctx=vm.createContext({window:{},console,logAudit:(...args)=>logs.push(args)});vm.runInContext(slice('function _subClean8754(','function supplementalNoInfoText8754('),ctx);vm.runInContext(slice('function sourceLabelInstruction95(','// Status belongs to a source document'),ctx);return {ctx,logs};}
const cgl='Commercial General Liability (CGL) with policy limits not less than $750,000 each occurrence, $1,500,000 general aggregate, and $1,5 00,000 on products/completed operations aggregate.';

test('A3 preserves a complete model insurance bullet when only other coverage matches the source',()=>{
 const {ctx}=harness(),bullet='GL $750,000 each occurrence / $1,500,000 general aggregate / $1,500,000 products/completed operations aggregate; AL $900,000; WC statutory / EL $600,000 each accident and each employee; Umbrella $3,000,000';
 const source=cgl+' Automobile Liability insurance with $900,000 Combined Single Limit.';
 const result=ctx.normalizeSubcontractOutput8754('- Insurance requirements: '+bullet,source);
 assert.ok(result.includes('- Insurance requirements: '+bullet+'\n'));
 assert.equal(ctx._subInsurance8754('', '- Insurance requirements: Bespoke $825,000 limited coverage; obtain complete schedule.'),'Bespoke $825,000 limited coverage; obtain complete schedule.');
});
test('A3 backfills an omitted CGL from generic labeled amounts including split thousands and explicit zero',()=>{
 const {ctx}=harness();const result=ctx._subInsurance8754(cgl,'- Insurance requirements: AL $900,000');
 assert.match(result,/^AL \$900,000; GL \$750,000 each occurrence \/ \$1,500,000 general aggregate \/ \$1,500,000 products\/completed operations aggregate$/);
 const zero=ctx._subInsurance8754('Commercial General Liability: $0 each occurrence, $2.25M general aggregate.','');
 assert.match(zero,/GL \$0 each occurrence \/ \$2,250,000 general aggregate/);
 assert.equal(ctx._subMoneyValue95('1 2',null),null);assert.equal(ctx._subMoneyValue95('1,2 3',null),null);
});
test('A3 does not overwrite a differing model limit or manufacture an absent EL policy limit',()=>{
 const {ctx}=harness();const bullet='GL $850,000 per occurrence (review the differing schedule).';
 assert.equal(ctx._subInsurance8754(cgl,'- Insurance requirements: '+bullet),bullet);
 const el=ctx._subInsurance8754("Employer's Liability Insurance limits of at least $400,000 each accident and $500,000 each employee.",'');
 assert.equal(el,'EL $400,000 each accident / $500,000 each employee');assert.equal(el.includes('policy limit'),false);
 assert.equal(ctx._subInsurance8754('Commercial General Liability limits unclear. Professional Liability $700,000 each occurrence.',''),'No Information Provided.');
 const separate='=== FILE: one.pdf ===\n'+cgl+'\n=== FILE: two.pdf ===\nAutomobile Liability $900,000 Combined Single Limit.';
 assert.equal(ctx._subInsurance8754(separate,'- Insurance requirements: Review separate agreements.'),'Review separate agreements.');
});
test('A3 standalone umbrella amounts reject malformed or partial numeric tokens',()=>{
 const {ctx}=harness();
 for(const value of ['$1.250 million','$2,500,0000','$900,000junk','$900,000 00junk','$1.25Mfoo']) {
   assert.equal(ctx._subInsurance8754('Commercial Umbrella limits must be at least '+value+'.',''),'No Information Provided.',value);
 }
 assert.equal(ctx._subInsurance8754('Commercial Umbrella limits must be at least $3.25 million.',''),'Umbrella/Excess $3,250,000');
});
test('A3 preserves explicit contract direction through normalization and A6 reuse without joining separate files',()=>{
 const {ctx}=harness(),source='CONTRACTOR: Example Prime LLC PROJECT: Civic Works\nSUBCONTRACTOR: Example Trade LLC PROJECT NO.: P-27\n'+cgl;
 const a3=ctx.normalizeSubcontractOutput8754('- Insurance requirements: AL $900,000',source);
 assert.match(a3,/Contract parties and direction: Contractor: Example Prime LLC; Subcontractor: Example Trade LLC\./);
 assert.match(a3,/do not establish its requirements for its own subcontractors/);
 const a6=ctx.replaceSummarySubcontractBlock8754('**Operations:**\nApplication controls remain separate.',a3);
 assert.ok(a6.includes('- Contract parties and direction: Contractor: Example Prime LLC; Subcontractor: Example Trade LLC.'));
 assert.equal(ctx._subContractParties95('=== FILE: one.pdf ===\nCONTRACTOR: Example Prime LLC\n=== FILE: two.pdf ===\nSUBCONTRACTOR: Example Trade LLC\n'),'');
 for(const mid of ['subcontract','summary-ops','strengths','exposure','guidelines'])assert.match(ctx.sourceLabelInstruction95(mid),/do not prove the applicant requires those same terms/);
});
function packet(owner='Example Trade LLC'){
 return [
  'Contract cover. CONTRACTOR: Example Prime LLC\nSUBCONTRACTOR: Example Trade LLC\n',
  'ARTICLE 3 SCOPE OF WORK\nThe work is in Attachment A - Work Items and Special Conditions. Contractor will furnish project access. '+ 'Contract conditions. '.repeat(100),
  'ARTICLE 10 INSURANCE\n'+cgl+' Automobile Liability insurance: $900,000 Combined Single Limit. '+ 'Insurance terms. '.repeat(100),
  'ARTICLE 11 INDEMNIFICATION\nSubcontractor shall defend and indemnify Contractor. '+'Indemnity terms. '.repeat(100),
  'End of main agreement.',
  'Subcontractor '+owner+' Address 10 Example Road\nItem No. Description Quantity Unit Price Total\n101 Installed steel rails 35 LF $80 $2,800\n102 Drainage channels 10 LF $90 $900\nSpecial Conditions ATTACHMENT "A" Work Items',
  'ATTACHMENT B Billing instructions.',
  'ARTICLE 7 SCOPE OF WORK\nAn unrelated appended supplier policy requires foreign facility work. '+ 'perform project furnish work '.repeat(180)
 ];
}
test('A3 finds the actual work table when its caption follows the rows and excludes appended contract scope',()=>{
 const {ctx}=harness(),pages=packet(),file={name:'Contract.pdf',pageTexts:pages,text:pages.join('\n\n')};
 const result=ctx.buildSubcontractFocusedInput8754(file,file.text);
 assert.match(result,/ATTACHMENT A \/ WORK ITEMS TABLE/);
 assert.ok(result.includes(pages[5]),'source table page is retained verbatim');
 assert.ok(result.includes(cgl));assert.ok(result.includes('CONTRACTOR: Example Prime LLC'));assert.ok(result.includes('SUBCONTRACTOR: Example Trade LLC'));
 assert.equal(result.includes('foreign facility work'),false);assert.ok(result.length<=62500);
 const before=JSON.stringify(file);ctx.buildSubcontractFocusedInput8754(file,file.text);assert.equal(JSON.stringify(file),before);
});
test('A3 populated work-table selection refuses an explicitly different subcontractor and blank table',()=>{
 const {ctx}=harness();
 for(const pages of [packet('Different Company Inc'),packet().map((p,i)=>i===5?p.replace(/101 Installed[\s\S]*?Special Conditions/,'Special Conditions'):p)]) {
   const out=ctx.buildSubcontractFocusedInput8754({pageTexts:pages,text:pages.join('\n')},'');
   assert.equal(out.includes('ATTACHMENT A / WORK ITEMS TABLE'),false);
 }
});
