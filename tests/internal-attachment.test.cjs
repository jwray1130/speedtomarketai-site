const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'workbench-app.js'), 'utf8');
const start = app.indexOf('        function applyInternalRaterFromActiveSubmission(');
const end = app.indexOf('        // v8.6.88', start);
assert.ok(start >= 0 && end > start);

function hydrate(submission, {lead = 3000000, tower = 0, manual = false} = {}) {
  const inputs = {'#nonAdmittedLimit': {value: ''}, '#nonAdmittedAttachment': {value: manual ? '8,000,000' : ''}};
  const window = {};
  const context = vm.createContext({window, console: {log(){}, warn(){}},
    document: {querySelector: selector => inputs[selector] || null},
    setTimeout: callback => callback(),
    n85: value => Number(String(value || '').replace(/[^0-9.-]/g, '')) || 0,
    money85: value => Number(value).toLocaleString('en-US'),
    r85: key => key === 'underlying_lead_limit' ? lead : null,
    stmFieldLocked: element => manual && element === inputs['#nonAdmittedAttachment'],
    set85Silent87104: (element, value) => {element.value = value;}
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'workbench-rules.js'), 'utf8'), context);
  // The assembled layer table can be unavailable while A14 and source role
  // evidence remain usable. Exercise the real role detector and real writer.
  window.WorkbenchRules.buildTowerFromExcessModule = () => ({totalTowerLimit: tower, rungs: []});
  vm.runInContext(app.slice(start, end), context);
  context.applyInternalRaterFromActiveSubmission(submission);
  return inputs;
}

function suppliedLead() {
  return {snapshot: {files: [{name: 'Example quote.pdf', category: 'UNDERLYING', tag: 'Lead Umbrella'}],
    extractions: {excess: {text: 'Underlying Lead Umbrella\n```json\n{"tower_role":"lead","underlying_lead_limit":3000000}\n```'}}}};
}

test('a supplied underlying policy being the lead does not place our target at Primary', () => {
  const inputs = hydrate(suppliedLead());
  assert.equal(inputs['#nonAdmittedAttachment'].value, '3,000,000');
  assert.equal(inputs['#nonAdmittedLimit'].value, '1,000,000', 'retain existing default without inventing a requested limit');
});

test('assembled layers and manual ownership retain precedence over source role hydration', () => {
  assert.equal(hydrate(suppliedLead(), {tower: 7000000})['#nonAdmittedAttachment'].value, '7,000,000');
  assert.equal(hydrate(suppliedLead(), {manual: true})['#nonAdmittedAttachment'].value, '8,000,000');
});

test('an explicitly requested lead with no underlying excess remains Primary', () => {
  const submission = {snapshot: {files: [{name: 'Requested lead quote', tag: 'requested lead'}],
    extractions: {excess: {text: '```json\n{"tower_role":"lead"}\n```'}}}};
  assert.equal(hydrate(submission, {lead: 0})['#nonAdmittedAttachment'].value, 'Primary');
});
