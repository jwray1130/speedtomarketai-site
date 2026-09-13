const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'pipeline-core.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function extractionModels95('), source.indexOf('function exportExcel(')), context);
test('export provenance reports recorded module and verifier models instead of current global defaults', () => {
  assert.equal(context.exportModels95({a: {usage: {model: 'model-a'}}, b: {usage: {model: 'model-b'}, verify_usage: {model: 'model-b'}}}), 'model-a, model-b');
  assert.equal(context.exportModels95({a: {usage: {model: 'model-a'}, verify_usage: {model: 'verifier-c'}}}), 'model-a, verifier-c');
  assert.equal(context.exportModels95({a: {usage: {model: 'model-a'}}, legacy: {text: 'older output'}}), 'model-a (some module provenance not recorded)');
  assert.equal(context.exportModels95({legacy: {text: 'older output'}}), 'Not recorded');
});
