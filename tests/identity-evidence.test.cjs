'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','pipeline-engine.js'),'utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
const ctx=vm.createContext({console});
vm.runInContext(section('function _gateNormalizeInsuredName(', '// Call the precheck LLM')+section('function detectNamedInsuredsLocal8718(', '// v8.7.55 - Deliberate test'),ctx);
const names=(text,module)=>Array.from(ctx.detectNamedInsuredsLocal8718(text,module));

test('identity detection retains explicit insured labels but excludes role controls and unknown answers',()=>{
 const text='Supplemental Application\n**Applicant Name:** Example Infrastructure LLC\nSubcontractor: N/A (per application)\nSubcontractor in Place: Yes\nNamed Insured: N/A (per application)\nCompany Name: Not provided\nContractor: Unrelated Owner LLC';
 assert.deepEqual(names(text,'supplemental'),['Example Infrastructure LLC']);
 assert.deepEqual(names('Named Insured: Example Cooperative Inc\nSubcontractor: Another Party LLC','subcontract'),['Example Cooperative Inc']);
 assert.equal(ctx._gateInsuredMatches(names(text,'supplemental')[0],'Example Cooperative Inc'),false,'a true unrelated insured still conflicts');
});

test('safety headings identify their company without treating program prose as names',()=>{
 const text='**Safety Program Review**\n**Example Infrastructure LLC**\n**1. Program Snapshot**\n- Document: Example Infrastructure LLC Safety Program, revised 01.02.2026\n- Program Type: The document is an "Employee Safety Program Acknowledgement Form" and states it is not all-inclusive\n- Safety Program: Review required\n- Prepared by Another Consulting LLC';
 assert.deepEqual(names(text,'safety'),['Example Infrastructure LLC']);
 assert.deepEqual(names('Written Safety Program Summary for Example Builders Inc','safety'),['Example Builders Inc']);
 assert.deepEqual(names('Safety Program Review\nSafety Program Acknowledgement Form\nThe manual was prepared by Another Consulting LLC','safety'),[]);
});

test('HTML and adjacent field boundaries do not contaminate explicit company values',()=>{
 assert.deepEqual(names('<p><strong>Company Name:</strong> Example Roadworks LLC</p><p>Policy Period: 01/01/2026 to 01/01/2027</p>','supplemental'),['Example Roadworks LLC']);
 assert.deepEqual(names('First Named Insured: Example Market Inc Policy Number: XX-123 Address: 1 Main Street','gl_quote'),['Example Market Inc']);
 assert.deepEqual(names('Insured Name:\nExample Builders\nAddress: 1 Main Street','supplemental'),['Example Builders']);
 assert.deepEqual(names('Contractor: Another Entity LLC\nSubcontractor: Example Builder Inc','subcontract'),[]);
});

test('actual PDF-style flat pages retain numbered applicant and named safety-heading boundaries',()=>{
 assert.deepEqual(names('FILE: questionnaire.pdf\nCONTRACTORS QUESTIONNAIRE ALL QUESTIONS MUST BE ANSWERED 1. Applicant: Example Infrastructure LLC A. Years in business under current name: 3 B. Describe your operations: civil contractor 2. Contractor’s license number: 123','supplemental'),['Example Infrastructure LLC']);
 assert.deepEqual(names('FILE: safety.pdf\nCOVER PAGE Written Safety Program Summary for Example Builders LLC Program Type: Acknowledgement Form Safety Program: Review required','safety'),['Example Builders LLC']);
});

test('post-extraction gate records only the real conflicting company and preserves source prose',()=>{
 const safety='**Safety Program Review**\n**Example Infrastructure LLC**\nProgram Type: Employee Safety Program Acknowledgement Form',supp='Applicant: Example Infrastructure LLC\nSubcontractor: N/A (per application)\nSubcontractor in Place: Yes';
 const local=vm.createContext({console,window:{},STATE:{extractions:{safety:{text:safety},supplemental:{text:supp}}},MODULES:{safety:{code:'A5'},supplemental:{code:'A2'}},applicantGateMode8737:()=> 'off',logAudit(){}});
 vm.runInContext(section('function _gateNormalizeInsuredName(', '// Call the precheck LLM')+section('function detectNamedInsuredsLocal8718(', '// v8.7.55 - Deliberate test')+section('function applyPostExtractionApplicantGate8723(', 'window.applyPostExtractionApplicantGate8723'),local);
 local.applyPostExtractionApplicantGate8723('Example Cooperative Inc');
 for(const [id,text] of [['safety',safety],['supplemental',supp]]){const ex=local.STATE.extractions[id];assert.deepEqual(Array.from(ex.detectedInsureds),['Example Infrastructure LLC']);assert.equal(ex.text,text);assert.equal(ex.applicantGate,'mismatch_noted_frankenstein_v8737');}
});
