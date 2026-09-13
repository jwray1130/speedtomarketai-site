'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const engine = fs.readFileSync(path.join(root, 'pipeline-engine.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'pipeline-core.js'), 'utf8');
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'source seam exists: ' + start);
  return source.slice(a, b);
}

// Execute production builders, reconciliation and runModule. Only the LLM,
// cache transport, costs and visual status updates are faked: no backend or
// customer fixture is needed to exercise the actual processing boundary.
function harness(options = {}) {
  const calls = [], cacheKeys = [], cacheWrites = [], audit = [];
  const window = {};
  const STATE = {api: {model: 'test'}, extractions: options.extractions || {}, pipelineRun: 'test-run'};
  const ctx = vm.createContext({window, STATE, console, Date, Map, Set,
    setNodeState() {}, logAudit(...args) {audit.push(args);}, toast(...args) {audit.push(args);},
    gateModuleByApplicant: async () => ({proceed: true, reason: 'not_applicant_gated'}),
    shouldNeutralizeApplicantFilter8706: () => false, applicantGateMode8737: () => 'off',
    substitutePromptVars: s => s, moduleMaxTokens: () => 1000,
    cacheable8760: () => true, MODULE_CACHE_CONTRACT_8765: {},
    PROMPTS: {strengths_verify: 'Verify arithmetic. Return complete Strengths of the Account.'},
    cacheKey8760: async (...args) => {cacheKeys.push(args); return 'test-key';},
    extractionCacheGet8760: async () => options.cached || null,
    extractionCachePut8760(...args) {cacheWrites.push(args);},
    callLLM: async (...args) => {
      calls.push(args);
      return options.respond ? options.respond(calls.length, args) : {text: options.output || 'Complete model output', usage: {input_tokens: 4, output_tokens: 4, model: 'test'}};
    },
    getActiveGuideline: () => guideline,
    isModelTruncationError: err => err && err.code === 'MODEL_TRUNCATED',
    calcCost: () => 0, fmtCost: () => '$0', estimateExtractionConfidence: () => 0.8,
  });
  vm.runInContext(between(engine, 'const MODULES = {', '// v8.7.155 SUPPORT-ONLY DIRECT RUN LOCK') + '\nthis.MODULES_TEST=MODULES;', ctx);
  vm.runInContext(between(engine, 'function htmlEscapeLoss96(', '// v8.6.98 - archive A11'), ctx);
  vm.runInContext(between(engine, 'function a8HtmlEscape8749(', '// v8.7.23 - after Wave 1'), ctx);
  vm.runInContext(between(core, 'function cleanVisibleExtractionText99(', '// Display missing archived timing'), ctx);
  vm.runInContext(between(engine, 'async function runModule(', '// v8.7.84 PHASE 6'), ctx);
  vm.runInContext(between(engine, 'async function verifyStrengthsNumericPass8784(', '// v8.7.90 GL CLASS CODE GROUNDING'), ctx);
  vm.runInContext(between(engine, 'let _glCodeMap8790 = null;', '// v8.7.162 SPEND CIRCUIT BREAKER'), ctx);
  return {ctx, STATE, calls, cacheKeys, cacheWrites, audit};
}
const summary = 'Example Contractor operates in Texas. It performs road and bridge construction. No residential work is performed.';
const guideline = 'Section 1.5 Attachment Point Strategy requires a calculation.\nSnow and ice removal contractors require review.\nWaste haulers require review.\nAll bridge contractors require a minimum $5m attachment point.\nThese are carrier reference rules.';
const plain = value => JSON.parse(JSON.stringify(value));
const money = n => '$' + n.toLocaleString('en-US', {maximumFractionDigits: 2});

function lossFixture({incurred = 118470, rows, editHtml = s => s, editData = () => {}} = {}) {
  rows = rows || [
    {policy_year: '2024-25', lob: 'GL', claims: 7, paid: 90000, reserve: 20000, incurred: 110000},
    {policy_year: '2024-25', lob: 'AL', claims: 3, paid: 3020, reserve: 5000, incurred: 8020}
  ];
  const fields = ['claims', 'paid', 'reserve', 'incurred'];
  const data = {policy_years: structuredClone(rows), coverage_totals: {}, large_losses: []};
  let html = '<div class="loss-output"><p class="loss-summary-text"><strong>10 claims over 1 year</strong> (7 GL + 3 AL). Combined incurred ' + money(incurred) + '. Largest loss $2,000,000. APD $450 is excluded. Other commentary stays.</p>';
  for (const lob of ['GL', 'AL']) {
    const selected = rows.filter(r => r.lob === lob);
    const totals = Object.fromEntries(fields.map(k => [k, selected.reduce((s,r) => s + r[k], 0)]));
    data.coverage_totals[lob === 'GL' ? 'gl' : 'auto'] = totals;
    const cells = row => fields.map(k => '<td>' + (k === 'claims' ? row[k] : money(row[k])) + '</td>').join('');
    html += '<div class="loss-section-title">' + (lob === 'GL' ? 'General' : 'Auto') + ' Liability Loss Information</div><table class="loss-tbl"><thead><tr><th>Policy Year</th><th>Claims</th><th>Paid</th><th>Reserve</th><th>Incurred</th></tr></thead><tbody>' + selected.map(r => '<tr><td>' + r.policy_year + '</td>' + cells(r) + '</tr>').join('') + '</tbody><tfoot><tr><td>TOTAL</td>' + cells(totals) + '</tr></tfoot></table>';
  }
  editData(data);
  return editHtml(html + '</div>') + '\n```json loss_history_structured\n' + JSON.stringify(data) + '\n```';
}

test('current A8 normal/compact/retry boundaries keep carrier scout text out of account operations', () => {
  const {ctx} = harness();
  for (const mode of ['normal', 'compact', 'ultra']) {
    const input = ctx.buildGuidelinesInput8749(summary, guideline, mode);
    assert.ok(input.includes('Waste haulers'));
    assert.equal(ctx.a8SplitInput8750(input, guideline).summary, summary);
    const triggers = plain(ctx.a8BuildDeterministicData8750(input, guideline, '').triggers).map(t => t.key);
    assert.ok(triggers.includes('bridge'));
    assert.ok(triggers.includes('section_1_5'));
    assert.ok(!triggers.includes('waste_hauler'));
    assert.ok(!triggers.includes('snow_ice'));
  }
});

test('legacy A8 inputs and empty operations cannot fall back to carrier reference as source narrative', () => {
  const {ctx} = harness();
  const legacy = ctx.buildGuidelinesInput8749(summary, guideline).replace('\n\nEND ACCOUNT OPERATIONS', '');
  assert.equal(ctx.a8SplitInput8750(legacy, guideline).summary, summary);
  assert.equal(ctx.a8SplitInput8750(ctx.buildGuidelinesInput8749('', guideline), guideline).summary, '');
  const input = ctx.buildGuidelinesInput8749('A'.repeat(30000), guideline, 'ultra');
  const split = ctx.a8SplitInput8750(input, guideline);
  assert.match(split.summary, /chars omitted/);
  assert.equal(split.summary.includes('candidate guideline'), false);
});

test('explicit local negative operations are suppressed while thresholds and later affirmative clauses survive', () => {
  const {ctx} = harness();
  const negative = ctx.a8OpsData8750('No residential work is performed. No snow or ice removal. No blasting or explosives. Does not perform dredging. Not involved in tunneling.');
  for (const flag of ['residential', 'snowIce', 'blasting', 'dredging', 'tunneling']) assert.equal(negative.flags[flag], false, flag);
  assert.equal(ctx.a8OpsData8750('No more than 10% residential work.').flags.residential, true);
  assert.equal(ctx.a8OpsData8750('Not only snow removal; road work too.').flags.snowIce, true);
  assert.equal(ctx.a8OpsData8750('No residential work, but snow removal is performed.').flags.snowIce, true);
  assert.equal(ctx.a8OpsData8750('No claims while performing bridge construction.').flags.bridge, true);
});

test('a long OCR guideline line returns a bounded exact excerpt with omissions marked', () => {
  const {ctx} = harness();
  const line = 'Before '.repeat(900) + 'Section 1.5 Attachment Point Strategy: exact grid wording. ' + 'After '.repeat(1300);
  const quote = ctx.a8GuidelineQuote8750(line, ['Section\\s*1\\.5']);
  assert.ok(quote.length <= 1804);
  assert.match(quote, /Section 1\.5 Attachment Point Strategy: exact grid wording\./);
  assert.ok(quote.startsWith('… ') && quote.endsWith(' …'));
  assert.ok(line.includes(quote.slice(2, -2)));
  assert.equal(ctx.a8GuidelineQuote8750('Bridge contractors require review.', ['Bridge']), 'Bridge contractors require review.');
});

test('missing guideline wording never appears as a made-up exact carrier quote', () => {
  const {ctx} = harness();
  const quote = ctx.a8GuidelineQuote8750('A different carrier guideline.', ['snow'], 'Snow requires $5M attachment.');
  assert.match(quote, /not found.*review required/);
  assert.equal(quote.includes('$5M'), false);
});

test('guideline display removes only machine data and known QC appendices, preserving later final sections', () => {
  const {ctx} = harness();
  const raw = '**Operational Detail/Product/Service:** Bridge construction\nActual carrier quote and explanation.\n\n**Source Narrative Operational Details and Listed Products & Services (verbatim):**\nDuplicate source text.\n\n**Checklist — Did Every Item Appear in the Analysis or Clean List?**\nDraft checkmarks.\n\n**Second QC Question — Did I Apply The Wide Trigger Net?**\nDraft discussion.\n\n**Final Decision:**\nRetain every word of this final decision.\n\n**Engine QC Addendum - deterministic guideline triggers added:**\n**Engine Detail:** Model omitted an item.\n\n**Operational Detail/Product/Service:** Required attachment review\nSubstantive late trigger.\n\n**Checklist for underwriter:**\nObtain signed application.\n```json guideline_conflicts_structured\n{"review_required":true,"reason":"QC details"}\n```';
  const visible = ctx.cleanVisibleExtractionText99('guidelines', raw);
  for (const phrase of ['Actual carrier quote', 'Retain every word', 'Substantive late trigger', 'Obtain signed application', 'Additional guideline items requiring review']) assert.ok(visible.includes(phrase), phrase);
  for (const phrase of ['guideline_conflicts_structured', 'Draft checkmarks', 'Draft discussion', 'Duplicate source', 'Engine Detail:', 'Engine QC Addendum']) assert.equal(visible.includes(phrase), false, phrase);
  assert.ok(raw.includes('guideline_conflicts_structured'));
  assert.equal(ctx.cleanVisibleExtractionText99('guidelines', visible), visible);
  assert.equal(ctx.cleanVisibleExtractionText99('guidelines', 'Final result\n```json\n{"guideline_conflicts":[]}\n```'), 'Final result');
  assert.match(ctx.cleanVisibleExtractionText99('guidelines', '```json\n{"customer_field":"retain"}\n```'), /customer_field/);
});

test('deterministic addenda add missing triggers once without duplicating full reports or source narrative', () => {
  const {ctx} = harness();
  const model = '**Clean Items:**\n' + 'Useful final analysis. '.repeat(40) + '\n**Referral Triggers:** None\n**Prohibited Exposures:** None\n**Minimum Attachment Requirements:** Verify.';
  const input = ctx.buildGuidelinesInput8749(summary, guideline);
  const first = ctx.a8EnsureGuidelinesOutput8750(model, input, guideline);
  assert.equal(first.appended, true);
  assert.ok(first.text.startsWith(model));
  assert.equal((first.text.match(/\*\*Clean Items/g) || []).length, 1);
  assert.equal(first.text.includes('Source Narrative Operational Details'), false);
  const second = ctx.a8EnsureGuidelinesOutput8750(first.text, input, guideline);
  assert.equal(second.text, first.text);
  assert.equal(second.appended, false);
});

test('incomplete live guideline content survives both runModule validation and deterministic supplementation', async () => {
  const original = '**Final finding:** A source-specific endorsement needs review; retain this unique result.';
  const h = harness({output: original});
  const input = h.ctx.buildGuidelinesInput8749(summary, guideline);
  assert.equal(await h.ctx.runModule('guidelines', 'System', input, 'test', {}), true, JSON.stringify(h.audit));
  const saved = h.STATE.extractions.guidelines;
  assert.ok(saved.text.startsWith(original));
  assert.equal(saved.review_required, true);
  assert.equal(h.ctx.a8EnsureGuidelinesOutput8750(saved.text, input, guideline).text, saved.text);
  assert.ok(h.ctx.cleanVisibleExtractionText99('guidelines', saved.text).includes('unique result'));
});

test('A11 headline uses agreeing GL+AL annual values and excludes unrelated APD without changing other content', () => {
  const {ctx} = harness(), raw = lossFixture();
  const result = ctx.reconcileLossHeadline95(raw);
  assert.equal(result.changed, true);
  assert.equal(result.text, raw.replace('Combined incurred $118,470', 'Combined incurred $118,020'));
  assert.equal(result.reconciliation.original, '$118,470');
  assert.equal(result.reviewRequired, false);
  assert.equal(ctx.reconcileLossHeadline95(result.text).changed, false);
});

test('A11 conflicting values, missing figures and duplicate years retain raw content and require review', () => {
  const {ctx} = harness();
  const cases = [
    {editData: d => {d.coverage_totals.gl.incurred++;}},
    {editData: d => {d.policy_years[0].incurred = null;}},
    {editData: d => {d.policy_years.push({...d.policy_years[0]});}},
    {editHtml: s => s.replace('<td>$110,000</td>', '<td>$1,000</td>')},
    {editHtml: s => s.replace('<td>$20,000</td>', '<td>—</td>')},
    {editHtml: s => s.replace('<th>Paid</th><th>Reserve</th>', '<th>Reserve</th><th>Paid</th>')}
  ];
  for (const fixture of cases) {
    const raw = lossFixture(fixture), result = ctx.reconcileLossHeadline95(raw);
    assert.equal(result.text, raw);
    assert.equal(result.changed, false);
    assert.equal(result.reviewRequired, true);
    assert.ok(result.reason);
  }
});

test('A11 complete explicit zeros and cents stay valid; absent and legacy data do not fabricate totals', () => {
  const {ctx} = harness();
  for (const value of [0, 12.34]) {
    const rows = ['GL','AL'].map(lob => ({policy_year: '2024-25', lob, claims: 0, paid: value, reserve: 0, incurred: value}));
    const raw = lossFixture({incurred: 100, rows}), result = ctx.reconcileLossHeadline95(raw);
    assert.equal(result.changed, true);
    assert.equal(result.reconciliation.corrected, money(value * 2));
  }
  for (const raw of ['No information provided.', '<p class="loss-summary-text">Combined incurred $100.</p>', '<p class="loss-summary-text">Combined incurred $100.</p>\n```json loss_history_structured\n{"loss_history_gl":[],"fallback":true}\n```']) {
    const result = ctx.reconcileLossHeadline95(raw);
    assert.equal(result.text, raw);
    assert.equal(result.changed, false);
  }
});

function conflict() {
  return {text: 'A loss narrative with a foreign insured.', applicantGate: 'mismatch_noted_frankenstein_v8737',
    gateDetails: {mismatchAllowed: true, submissionInsured: 'Applicant A', detectedInsureds: ['Other B'], matchedInsureds: []}};
}
test('synthesis ownership guard uses recorded scoped source metadata without reading names from arbitrary prose', () => {
  const {ctx} = harness();
  const extracts = {losses: conflict(), supplemental: {text: 'Applicant C, no relationship metadata.'}, safety: {...conflict(), excluded: true}, unused: conflict()};
  const before = structuredClone(extracts);
  const conflicts = plain(ctx.synthesisSourceIdentity95('summary-ops', extracts, ctx.MODULES_TEST));
  assert.deepEqual(conflicts, [{sourceModule: 'losses', submissionInsured: 'Applicant A', detectedInsureds: ['Other B'], matchedInsureds: []}]);
  assert.deepEqual(extracts, before);
  assert.deepEqual(plain(ctx.synthesisSourceIdentity95('losses', extracts, ctx.MODULES_TEST)), []);
  const next = {'summary-ops': {text: 'Derived summary', source_identity_conflicts: conflicts}};
  assert.deepEqual(plain(ctx.synthesisSourceIdentity95('guidelines', next, ctx.MODULES_TEST)), conflicts);
});

test('ownership metadata retains source filenames, ignores explicit matches and unrelated statuses', () => {
  const {ctx} = harness();
  const matched = {text: 'Source data', sourceInfo: 'Losses.pdf', applicantGate: 'mismatch_noted_frankenstein_v8737',
    gateDetails: {detectedInsureds: [], allDetected: ['Applicant A', 'Other B'], matchedInsureds: ['Applicant A']}};
  const values = plain(ctx.synthesisSourceIdentity95('summary-ops', {losses: matched}, ctx.MODULES_TEST));
  assert.deepEqual(values[0].detectedInsureds, ['Other B']);
  assert.equal(values[0].sourceInfo, 'Losses.pdf');
  matched.gateDetails.allDetected = ['APPLICANT A'];
  assert.deepEqual(plain(ctx.synthesisSourceIdentity95('summary-ops', {losses: matched}, ctx.MODULES_TEST)), []);
  matched.applicantGate = 'no_mismatch_detected';
  matched.gateDetails.allDetected = ['Other B'];
  assert.deepEqual(plain(ctx.synthesisSourceIdentity95('summary-ops', {losses: matched}, ctx.MODULES_TEST)), []);
});

test('runModule carries source-owner context into calls/cache keys and refreshes review metadata on cache hits', async () => {
  for (const cached of [null, {payload: {text: 'Previously computed derived output'}, created_run: 'prior'}]) {
    const h = harness({extractions: {losses: conflict()}, cached});
    const raw = 'All source facts remain here.';
    assert.equal(await h.ctx.runModule('summary-ops', 'System', raw, 'test', {}), true, JSON.stringify(h.audit));
    const record = h.STATE.extractions['summary-ops'];
    assert.equal(record.review_required, true);
    assert.equal(record.source_identity_conflicts[0].detectedInsureds[0], 'Other B');
    assert.ok(h.cacheKeys[0][1].includes('SOURCE IDENTITY BOUNDARY'));
    assert.ok(h.cacheKeys[0][2].startsWith(raw));
    assert.ok(h.cacheKeys[0][2].includes('Other B'));
    if (cached) assert.equal(h.calls.length, 0);
    else {
      assert.equal(h.calls.length, 1);
      assert.equal(h.calls[0][0].includes('Other B'), false, 'source names stay data, out of system instructions');
      assert.ok(h.calls[0][1].includes('Other B'));
    }
  }
  const clean = harness({extractions: {losses: {text: 'Mention of Other B only, no gate metadata'}}});
  assert.equal(await clean.ctx.runModule('exposure', 'System', 'Unchanged source', 'test', {}), true);
  assert.equal(clean.calls[0][0], 'System' + clean.ctx.sourceLabelInstruction95('exposure'));
  assert.equal(clean.calls[0][1], 'Unchanged source');
  assert.equal(clean.STATE.extractions.exposure.review_required, false);
});

test('A11 runModule archives the original response and replays reconciliation metadata through cache', async () => {
  const raw = lossFixture(), live = harness({output: raw});
  assert.equal(await live.ctx.runModule('losses', 'System', 'Source document', 'test', {}), true, JSON.stringify(live.audit));
  const record = live.STATE.extractions.losses;
  assert.equal(record.original_response_text95, raw);
  assert.match(record.text, /Combined incurred \$118,020/);
  assert.equal(record.loss_history_structured.coverage_totals.gl.incurred, 110000);
  assert.equal(live.cacheWrites.length, 1);
  const payload = live.cacheWrites[0][3], replay = harness({cached: {payload}});
  assert.equal(await replay.ctx.runModule('losses', 'System', 'Source document', 'test', {}), true);
  assert.equal(replay.STATE.extractions.losses.original_response_text95, raw);
  assert.deepEqual(plain(replay.STATE.extractions.losses.loss_headline_reconciliation95), plain(record.loss_headline_reconciliation95));
  assert.equal(replay.calls.length, 0);
});

test('A8 input-budget retry retains the recorded source-owner metadata outside operations', async () => {
  const h = harness({extractions: {'summary-ops': {text: summary, source_identity_conflicts: [{sourceModule: 'losses', submissionInsured: 'Applicant A', detectedInsureds: ['Other B']}] }},
    respond: n => {
      if (n === 1) throw new Error('413 request too large');
      return {text: 'A useful partial model finding.'};
    }});
  assert.equal(await h.ctx.runModule('guidelines', 'System', h.ctx.buildGuidelinesInput8749(summary, guideline), 'test', {}), true, JSON.stringify(h.audit));
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls[1][1].includes('Other B'));
  assert.equal(h.ctx.a8SplitInput8750(h.calls[1][1], guideline).summary, summary);
  assert.equal(h.STATE.extractions.guidelines.review_required, true);
});

test('Strengths hides an explicit verifier draft only when the complete final section follows', () => {
  const {ctx} = harness();
  const preamble = 'Now let me verify the numbers.\n\nLoss History checks:\nDraft says $200; correct to $100.\n\nAttachment checks:\nDraft arithmetic.\n\n';
  for (const heading of ['Strengths of the Account:', '**Strengths of the Account:**', '**Strengths of the Account**:', '## Strengths of the Account']) {
    const final = heading + '\n\n**Loss History:**\n- Full final facts remain $100.\n\n**Attachment Point and Program Structure:**\n- Full final limits remain $1,000,000.';
    const raw = preamble + final;
    assert.equal(ctx.cleanVisibleExtractionText99('strengths', raw), final);
    assert.ok(raw.includes('Draft arithmetic'));
    assert.equal(ctx.cleanVisibleExtractionText99('strengths', final), final);
  }
  assert.equal(ctx.cleanVisibleExtractionText99('strengths', preamble), preamble.trim());
  const introductoryFinding = 'Important final source-specific finding.\n\nStrengths of the Account:\nRetain everything.';
  assert.equal(ctx.cleanVisibleExtractionText99('strengths', introductoryFinding), introductoryFinding);
});

const conflictingFleet = 'Fleet Composition:\nMedium: 6 (units 101, 102, 103, 104, 105, 106, 107)\nHeavy (Local): 10 (units 501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511)\nTruck Tractors (Local): 15 (units 901, 902, 903, 904, 905, 906, 907, 908, 909, 910, 911, 912, 913, 914, 915, 916, 917, 918)\nFleet Composition (corrected counts):\nMedium: 7\nHeavy (Local): 11\nTruck Tractors (Local): 18\nTotal power units: 39';
test('AL contradictory counts and explicit unit rosters receive a review warning without rewriting evidence', () => {
  const {ctx} = harness();
  const warnings = ctx.summaryIntegrityReview95('al_quote', conflictingFleet);
  assert.equal(warnings.length, 1);
  for (const field of ['Medium', 'Heavy (Local)', 'Truck Tractors (Local)']) assert.ok(warnings[0].includes(field));
  assert.ok(conflictingFleet.includes('Medium: 6'));
  assert.deepEqual(plain(ctx.summaryIntegrityReview95('al_quote', 'Fleet Composition:\nMedium: 2 (units 11, 33)\nLight: 0')), []);
  assert.deepEqual(plain(ctx.summaryIntegrityReview95('losses', conflictingFleet)), []);
  assert.deepEqual(plain(ctx.summaryIntegrityReview95('al_quote', 'Fleet Composition:\nMedium: 2 (units 11-20)')), [], 'ranges are ambiguous and not guessed');
});

test('assumed-primary penetration is flagged as an assumption, without inferring historical limits or rewriting prose', () => {
  const {ctx} = harness();
  const text = 'Attachment Penetration. The 2025 $125K feed loss would penetrate most primaries.';
  const warnings = ctx.summaryIntegrityReview95('losses', text);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Verify the applicable loss-date primary limits/);
  assert.equal(warnings[0].includes('did not penetrate'), false);
  assert.deepEqual(plain(ctx.summaryIntegrityReview95('losses', 'The $125,000 loss does not reach the stated $1M attachment.')), []);
  assert.deepEqual(plain(ctx.summaryIntegrityReview95('exposure', 'Future catastrophic losses may exhaust the stated primary.')), []);
});

test('runModule saves contradictory fleet output intact with actionable review metadata', async () => {
  const h = harness({output: conflictingFleet});
  assert.equal(await h.ctx.runModule('al_quote', 'System', 'Vehicle schedule', 'Schedule.pdf', {account_name: 'Applicant A'}), true);
  const rec = h.STATE.extractions.al_quote;
  assert.equal(rec.text, conflictingFleet);
  assert.equal(rec.review_required, true);
  assert.equal(rec.summary_integrity_warnings95.length, 1);
  assert.equal(rec.submissionInsured, 'Applicant A');
});

test('the separate Strengths numeric verifier carries recorded ownership through its request and result', async () => {
  const final = '**Strengths of the Account:**\n- Retain useful source facts with ownership explicit.';
  const h = harness({output: final, extractions: {strengths: {text: 'Draft to verify with useful source facts.'}, losses: {...conflict(), sourceInfo: 'Foreign Losses.pdf'}}});
  assert.equal(await h.ctx.verifyStrengthsNumericPass8784('test'), true, JSON.stringify(h.audit));
  assert.equal(h.calls.length, 1);
  assert.ok(h.calls[0][0].includes('SOURCE IDENTITY BOUNDARY'));
  assert.ok(h.calls[0][0].includes('applies during numeric verification'));
  assert.ok(h.calls[0][1].includes('Other B'));
  const rec = h.STATE.extractions.strengths;
  assert.equal(rec.text, final);
  assert.equal(rec.review_required, true);
  assert.equal(rec.source_identity_conflicts[0].sourceInfo, 'Foreign Losses.pdf');
});

test('loss fallback excludes APD/ambiguous coverage and never turns claim identifiers into incurred', () => {
  const {ctx} = harness();
  for (const line of [
    '05/01/2025 Auto Physical Damage claim 987654 paid $600',
    '05/01/2025 APD claim 987654 paid $600',
    '05/01/2025 Auto Liability APD claim 987654 incurred $600 paid $600 reserve $0',
    '05/01/2025 Vehicle collision claim 987654 incurred $600 paid $600 reserve $0',
    '05/01/2025 Location Birmingham AL claim 987654 paid $600',
    '05/01/2025 GL and Auto Liability claim 987654 incurred $600'
  ]) assert.deepEqual(plain(ctx.parseLossLinesFallback96(line)), [], line);
  const rows = ctx.parseLossLinesFallback96('05/01/2025 Auto Liability claim 987654 paid $600');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].claim_number, '987654');
  assert.equal(rows[0].paid, 600);
  assert.equal(rows[0].incurred, null);
  assert.equal(rows[0].reserve, null);
  assert.equal(rows[0].year, '');
});

test('loss fallback preserves explicitly labeled money, cents, zeros and recoveries without deriving missing fields', () => {
  const {ctx} = harness();
  const rows = ctx.parseLossLinesFallback96('DOL: 05/01/2025 Coverage: AL claim #987654 incurred $1,100.25, paid $600.25, outstanding reserves $500. Closed.\n05/02/2025 GL claim 99999 incurred $0 paid $0 reserve $0.\n05/03/2025 GL claim 14 paid ($125.25)');
  assert.equal(rows.length, 3);
  assert.deepEqual(plain(rows[0]).incurred, 1100.25);
  assert.equal(rows[0].paid, 600.25);
  assert.equal(rows[0].reserve, 500);
  assert.equal(rows[0].status, 'Closed');
  assert.equal(rows[1].incurred, 0);
  assert.equal(rows[1].paid, 0);
  assert.equal(rows[2].paid, -125.25);
  assert.equal(rows[2].incurred, null);
  const onlyComponents = ctx.parseLossLinesFallback96('05/01/2025 GL claim 987654 paid $600 reserve $400');
  assert.equal(onlyComponents[0].incurred, null, 'paid plus reserve is not substituted for an unstated incurred');
});

test('loss fallback rejects unlabeled figures, invalid dates, summaries, ranges and conflicting amount labels', () => {
  const {ctx} = harness();
  for (const line of [
    '05/01/2025 GL claim 987654 $600 $200',
    '02/30/2025 GL claim 987654 incurred $600',
    '05/01/2025 GL summary total losses incurred $600',
    'Policy effective 05/01/2025 GL premium $600',
    '05/01/2025 GL claim 987654 paid $1,000 to $2,000',
    '05/01/2025 GL claim 987654 paid $1 million',
    '05/01/2025 GL claim 987654 paid $1,2',
    '05/01/2025 GL claim 987654 paid $100 paid $200'
  ]) assert.deepEqual(plain(ctx.parseLossLinesFallback96(line)), [], line);
  assert.equal(ctx.moneyNumber96(''), null);
  assert.equal(ctx.moneyNumber96('unknown'), null);
  assert.equal(ctx.moneyNumber96('claim 987654'), null);
  assert.equal(ctx.fmtMoney96(null), 'Unknown');
});

test('loss fallback annual data requires explicit policy years and complete amounts, never DOL calendar year', () => {
  const {ctx} = harness();
  const line = '05/01/2025 GL claim 987654 incurred $1,100.25 paid $600.25 reserve $500 policy year: 2024-25';
  const rows = ctx.parseLossLinesFallback96(line + '\n' + line);
  assert.equal(rows.length, 1, 'identical repeated source row counted once');
  const annual = ctx.aggregateLossRows96(rows, 'GL');
  assert.equal(annual.length, 1);
  assert.equal(annual[0].policy_year, '2024-25');
  assert.equal(annual[0].claims, 1);
  assert.equal(annual[0].incurred, 1100.25);
  assert.equal(annual[0].paid, 600.25);
  assert.equal(annual[0].reserve, 500);
  for (const incomplete of [line.replace(' policy year: 2024-25', ''), line.replace(' reserve $500', ''), line.replace('2024-25', '2024-28')]) {
    assert.deepEqual(plain(ctx.aggregateLossRows96(ctx.parseLossLinesFallback96(incomplete), 'GL')), []);
  }
  const changingClaim = ctx.parseLossLinesFallback96(line + '\n' + line.replace('incurred $1,100.25', 'incurred $1,500.25'));
  assert.deepEqual(plain(ctx.aggregateLossRows96(changingClaim, 'GL')), [], 'two snapshots of one claim cannot inflate annual counts');
  const repeatLarge = line.replace('incurred $1,100.25', 'incurred $301,100.25');
  const ambiguous = ctx.buildLossFallbackExtraction96(repeatLarge + '\n' + repeatLarge.replace('$301,100.25', '$401,100.25'));
  assert.ok(ambiguous.includes('incurred sum of parsed rows: Unknown'));
  assert.deepEqual(plain(ctx.parseLossStructuredForArchive98(ambiguous).large_losses), []);
});

test('loss fallback exposes partial evidence and unknowns without inserting incomplete annual or large-loss form rows', () => {
  const {ctx} = harness();
  const raw = ctx.buildLossFallbackExtraction96('05/01/2025 AL claim 987654 paid $600\n05/02/2025 GL claim 44 incurred $300,000', 'MODEL_TRUNCATED');
  const data = ctx.parseLossStructuredForArchive98(raw);
  assert.equal(data.fallback, true);
  assert.equal(data.review_required, true);
  assert.equal(data.fallback_loss_rows.length, 2);
  assert.deepEqual(plain(data.loss_history_by_year), []);
  assert.deepEqual(plain(data.large_losses), []);
  assert.equal(data.fallback_loss_rows[0].incurred, null);
  assert.ok(raw.includes('incurred sum of parsed rows: Unknown'));
  assert.ok(raw.includes('partial evidence, not a complete loss history'));
  assert.ok(raw.includes('Parsed GL/AL evidence'));
  assert.equal(raw.includes('$987,654'), false);
  const empty = ctx.buildLossFallbackExtraction96('05/01/2025 APD claim 987654 paid $600');
  assert.ok(empty.includes('incurred sum of parsed rows: Unknown'));
  assert.equal(empty.includes('incurred sum of parsed rows: $0'), false);
});

test('two truncated A11 requests invoke the actual conservative fallback, persist review state and never cache it', async () => {
  const h = harness({respond: () => {const e = new Error('Response truncated'); e.code = 'MODEL_TRUNCATED'; throw e;}});
  const source = '05/01/2025 APD claim 987654 paid $600\n05/02/2025 Auto Liability claim 123456 paid $150';
  assert.equal(await h.ctx.runModule('losses', 'System', source, 'Losses.pdf', {}), true, JSON.stringify(h.audit));
  assert.equal(h.calls.length, 2);
  const rec = h.STATE.extractions.losses;
  assert.equal(rec.fallback, true);
  assert.equal(rec.review_required, true);
  assert.match(rec.loss_integrity_warning95, /partial parsed evidence/);
  assert.equal(rec.loss_history_structured.fallback_loss_rows.length, 1);
  assert.equal(rec.loss_history_structured.fallback_loss_rows[0].incurred, null);
  assert.deepEqual(plain(rec.loss_history_structured.loss_history_by_year), []);
  assert.equal(h.cacheWrites.length, 0);
});

test('role-to-work relabeling receives a precise warning; independently labeled role/work splits do not', () => {
  const {ctx} = harness();
  for (const [mid, text] of [
    ['supplemental', 'GC / Subcontractor Split: 73% General Contractor, 27% Subcontractor\nDirect / Self-Performed: 73% of operations (as GC)'],
    ['strengths', 'The account is predominantly self-performing, operating as general contractor on 73 percent of engagements and subcontracting only 27 percent.']
  ]) {
    const warnings = ctx.summaryIntegrityReview95(mid, text);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Verify GC\/subcontractor roles separately/);
    assert.ok(text.includes('73'));
  }
  for (const text of [
    'The applicant operates as general contractor on 73% of engagements, with a subcontractor role in 27%.',
    'GC / Subcontractor Split: 73% / 27%\nDirect / Self-Performed: 40% of work\nSubcontracted to others: 60% of work',
    'Direct / Self-Performed: 73% of work. Subcontracted to others: 27% of work.'
  ]) assert.deepEqual(plain(ctx.summaryIntegrityReview95('supplemental', text)), []);
});

test('class-code review detects an explicit source-versus-model attribution conflict without deciding code validity', () => {
  const {ctx} = harness();
  const text = '- 54321 - Source description - Source: Source-provided - review\n- NEEDS MANUAL CODE - Verify original schedule. [model produced invalid code 54321 - not in authoritative table]';
  const warnings = ctx.summaryIntegrityReview95('classcode', text);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /provenance conflicts for 54321/);
  assert.match(warnings[0], /absence alone does not establish origin or validity/);
  assert.deepEqual(plain(ctx.summaryIntegrityReview95('classcode', '- 54321 - Source description - Source: GL Quote [code not in reference table - review]')), []);
  assert.deepEqual(plain(ctx.summaryIntegrityReview95('classcode', '- NEEDS MANUAL CODE [model produced invalid code 54321 - not in authoritative table]')), []);
});

test('GL validator preserves explicit source provenance across review lines and retains source descriptions', () => {
  const h = harness();
  h.ctx.window.GL_CLASS_CODES = [['11111', 'Reference description']];
  const source = '- 54321 - Carrier wording - Source: GL Quote\n- 54321 - not found in reference table; verify carrier schedule\n- 11111 - Different carrier wording - Source: ACORD 126';
  h.STATE.extractions.classcode = {text: source};
  h.ctx.validateGlClasscodeOutput8790('test');
  const rec = h.STATE.extractions.classcode;
  assert.equal(rec.classcode_prevalidation_text95, source);
  assert.ok(rec.text.includes('- 54321 - Carrier wording - Source: GL Quote'));
  assert.ok(rec.text.includes('- 54321 - not found in reference table; verify carrier schedule'));
  assert.ok(rec.text.includes('- 11111 - Different carrier wording - Source: ACORD 126'));
  assert.equal(rec.text.includes('model produced invalid'), false);
  assert.equal(rec.text.includes('NEEDS MANUAL CODE'), false);
  assert.equal(rec.review_required, true);
  const once = rec.text;
  h.ctx.validateGlClasscodeOutput8790('repeat');
  assert.equal(rec.text, once);
});

test('GL validator still rejects unsupported model selections without inventing provenance for unlabeled codes', () => {
  const h = harness();
  h.ctx.window.GL_CLASS_CODES = [['11111', 'Reference description']];
  h.STATE.extractions.classcode = {text: '- 54321 - Guessed class - Source: AI-selected from reference table\n- 65432 - Unlabeled class\n- 11111 - Wrong description - Source: AI-selected from reference table'};
  h.ctx.validateGlClasscodeOutput8790('test');
  const text = h.STATE.extractions.classcode.text;
  assert.match(text, /NEEDS MANUAL CODE - Guessed class/);
  assert.match(text, /model-selected code 54321 is not in the provided reference table/);
  assert.match(text, /code 65432.*source provenance is unspecified/);
  assert.match(text, /11111 - Reference description - Source: AI-selected/);
});

test('cross-line source provenance never overrides an explicit AI or other source label on the same code', () => {
  const h = harness();
  h.ctx.window.GL_CLASS_CODES = [['11111', 'Reference description']];
  const source = '- 54321 - Carrier wording - Source: GL Quote\n- 54321 - Model guess - Source: AI-selected from reference table\n- 54321 - Other input - Source: Unverified note';
  h.STATE.extractions.classcode = {text: source};
  h.ctx.validateGlClasscodeOutput8790('test');
  const rec = h.STATE.extractions.classcode;
  assert.equal(rec.classcode_prevalidation_text95, source);
  assert.match(rec.text, /54321 - Carrier wording - Source: GL Quote \[code not in reference table - source-provided, review\]/);
  assert.match(rec.text, /NEEDS MANUAL CODE - Model guess.*model-selected code 54321/);
  assert.match(rec.text, /NEEDS MANUAL CODE - Other input - Source: Unverified note.*source provenance is unverified/);
});

test('source-label fidelity is sent through generation/cache keys and preserved by the Strengths verifier', async () => {
  for (const mid of ['supplemental', 'summary-ops', 'strengths', 'exposure', 'classcode']) {
    const h = harness();
    assert.equal(await h.ctx.runModule(mid, 'Original template', 'Source fields', 'test', {}), true, JSON.stringify(h.audit));
    assert.ok(h.calls[0][0].includes('SOURCE LABEL FIDELITY'));
    assert.ok(h.calls[0][0].includes('leave it unknown'));
    assert.ok(h.cacheKeys[0][1].includes('SOURCE LABEL FIDELITY'));
    assert.equal(h.calls[0][1], 'Source fields');
    assert.equal(h.STATE.extractions[mid].summary_integrity_warnings95.length, 0);
    if (mid === 'classcode') assert.ok(h.calls[0][0].includes('CLASS-CODE PROVENANCE FIDELITY'));
  }
  const h = harness({output: 'A complete verified strengths section preserving every source label and fact.', extractions: {strengths: {text: 'A complete draft of strengths for verification.'}, losses: {text: 'Loss source'}}});
  assert.equal(await h.ctx.verifyStrengthsNumericPass8784('test'), true);
  assert.ok(h.calls[0][0].includes('SOURCE LABEL FIDELITY'));
  assert.equal(h.ctx.sourceLabelInstruction95('al_quote'), '');
});
