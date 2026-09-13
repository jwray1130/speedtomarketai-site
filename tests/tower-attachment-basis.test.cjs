const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({window: {}, console});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'workbench-rules.js'), 'utf8'), context);
const rules = context.window.WorkbenchRules;
const lead = () => ({id: 'lead', name: 'Lead Umbrella - Example Insurer', carrier: 'Example Insurer',
  decLimit: 4000000, statedAttachment: 1000000, schedulesPrimary: true,
  schedule_of_underlying: [{line: 'GL', each_occurrence: 1000000, general_aggregate: 2000000},
    {line: 'AL', csl: 1000000}, {line: 'EL', status: 'EXCLUDED'}]});
const submission = (docs, relabels = {}) => ({account_name: 'Example Insured LLC', snapshot: {
  extractions: {excess: {text: 'Named Insured: Example Insured LLC\n```json\n' + JSON.stringify({tower_documents: docs}) + '\n```'}},
  towerRelabels: relabels
}});

test('primary ground-up attachment on an explicit lead rebases to the excess tower without an invented intervening layer', () => {
  const s = submission([lead()]);
  const tower = rules.buildTowerFromExcessModule(s);
  assert.equal(tower.rungs.length, 1);
  assert.equal(tower.rungs[0].kind, 'lead');
  assert.equal(tower.rungs[0].attachment, 0);
  assert.equal(tower.totalTowerLimit, 4000000);
  assert.equal(tower.anyUncertain, false);
  assert.equal(tower.docs[0].groundUpAttachment, 1000000);
  const recs = rules.recommendSubjectivities(s).recommendations;
  assert.ok(recs.some(r => r.factSource === 'tower.lead'));
  assert.ok(!recs.some(r => r.factSource === 'tower.excess_rungs' || r.factSource === 'tower.uncertain'));
});

test('higher and mixed schedules retain their actual attachment', () => {
  for (const override of [
    {name: 'First Excess - Example Insurer'},
    {name: 'Excess over Lead Umbrella - Example Insurer'},
    {schedule_of_underlying: [{line: 'EXCESS', limit: 1000000}]},
    {schedule_of_underlying: [{line: 'GL', each_occurrence: 1000000}, {line: 'EXCESS', limit: 3000000}]},
    {schedule_of_underlying: []},
    {statedAttachment: 3000000},
    {statedAttachment: 2000000}, // aggregate is not primary occurrence attachment
    {schedulesPrimary: false}
  ]) {
    const doc = {...lead(), ...override};
    assert.equal(rules.buildTowerFromExcessModule(submission([doc])).docs[0].statedAttachment, doc.statedAttachment);
  }
});

test('relabel ownership survives normalization and cross-applicant tower data remains blocked', () => {
  const s = submission([lead()], {lead: {kind: 'excess', attachment: 9000000}});
  const tower = rules.buildTowerFromExcessModule(s);
  assert.equal(tower.rungs[0].kind, 'excess');
  assert.equal(tower.rungs[0].attachment, 9000000);
  s.account_name = 'Different Applicant Inc';
  assert.equal(rules.buildTowerFromExcessModule(s).blocked, true);
});
