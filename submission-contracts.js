/* Summary state contracts. No rendering, orchestration or rating formulas. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.STMSubmissionContracts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
  const object = o => !!o && typeof o === 'object' && !Array.isArray(o);
  const copy = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const safeId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(id) && !['__proto__', 'prototype', 'constructor'].includes(id);
  const finite = n => n !== null && n !== '' && n !== undefined && Number.isFinite(Number(n));
  const timestamp = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const text = (v, max = 2000000) => typeof v === 'string' && v.length <= max;
  const MAX_RECOVERY_BYTES = 10 * 1024 * 1024;
  const serializedBytes = value => { const json = typeof value === 'string' ? value : JSON.stringify(value); return typeof TextEncoder === 'function' ? new TextEncoder().encode(json).length : json.length * 2; };
  function fail() { throw new Error('Saved summary data is invalid. Keep the recovery data and reopen a valid version before saving.'); }
  function validateJson(value, depth = 0, budget = { nodes: 0 }) {
    if (depth > 40 || ++budget.nodes > 200000) fail();
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail(); return; }
    if (typeof value === 'string') { if (value.length > MAX_RECOVERY_BYTES) fail(); return; }
    if (!object(value) && !Array.isArray(value)) fail();
    if (!Array.isArray(value) && Object.prototype.toString.call(value) !== '[object Object]') fail();
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor', '_rawFile'].includes(key)) fail();
      validateJson(child, depth + 1, budget);
    }
  }
  function validatePipeline(p) {
    if (!object(p) || !Array.isArray(p.files) || p.files.length > 5000 || !object(p.extractions) || Object.keys(p.extractions).length > 2000) fail();
    if (typeof p._stmRunComplete !== 'boolean' || !(p.pipelineRun === null || text(p.pipelineRun, 1000)) || !timestamp(p.pipelineStart) || !timestamp(p.runTotalCost) || !Array.isArray(p.audit) || p.audit.length > 50000) fail();
    validateOperation(p._stmOperation);
    const ids = new Set();
    for (const f of p.files) {
      if (!object(f) || !safeId(f.id) || ids.has(f.id) || !text(f.name, 10000) || (own(f, 'text') && !text(f.text, MAX_RECOVERY_BYTES))) fail();
      ids.add(f.id);
    }
    for (const [id, extraction] of Object.entries(p.extractions)) if (!safeId(id) || !object(extraction) || (own(extraction, 'text') && !text(extraction.text, MAX_RECOVERY_BYTES))) fail();
    validateJson(p); return true;
  }
  function validateOperation(operation) {
    if (operation === null) return true;
    if (!object(operation) || !text(operation.kind, 200) || !operation.kind || !timestamp(operation.started) || !(operation.ended === null || timestamp(operation.ended))) fail();
    if (!['interrupted', 'cancelled', 'failed', 'not-completed', 'finished-with-issues', 'finished'].includes(operation.status)) fail();
    if (own(operation, 'issues') && (!Number.isInteger(operation.issues) || operation.issues < 0)) fail();
    if (!object(operation.nodes) || Object.keys(operation.nodes).length > 2000) fail();
    for (const [id, node] of Object.entries(operation.nodes)) {
      if (!safeId(id) || !object(node) || !['queued', 'running', 'done', 'warn', 'error', 'skipped', 'cancelled'].includes(node.status)) fail();
      if (own(node, 'at') && !timestamp(node.at)) fail();
      // The July engine emits labels such as "1.2s · gated" and "no input".
      if (own(node, 'timing') && !(node.timing === null || timestamp(node.timing) || text(node.timing, 10000))) fail();
    }
    return true;
  }
  function validateHandoff(h) {
    if (!object(h)) fail();
    if (own(h, 'status') && ![null, 'awaiting_assistant', 'in_review', 'returned_to_uw'].includes(h.status)) fail();
    if (own(h, 'viewAs') && !['uw', 'assistant'].includes(h.viewAs)) fail();
    for (const k of ['assignee', 'uwNote', 'assistantNote']) if (own(h, k) && h[k] !== null && !text(h[k], 100000)) fail();
    for (const k of ['sentAt', 'openedAt', 'returnedAt']) if (own(h, k) && h[k] !== null && !timestamp(h[k])) fail();
    if (own(h, 'history')) {
      if (!Array.isArray(h.history) || h.history.length > 10000) fail();
      for (const e of h.history) {
        if (!object(e) || !text(e.transition, 200) || !timestamp(e.at)) fail();
        for (const k of ['actor', 'assignee', 'noteText']) if (own(e, k) && !text(e[k], 100000)) fail();
        if (own(e, 'noteLength') && (!Number.isInteger(e.noteLength) || e.noteLength < 0)) fail();
      }
    }
    return true;
  }
  function validateEditState(s) {
    if (!object(s) || !object(s.edits) || !Array.isArray(s.customCards) || !object(s.hiddenCards)) fail();
    if (Object.keys(s.edits).length > 2000 || s.customCards.length > 2000 || Object.keys(s.hiddenCards).length > 4000) fail();
    const noteIds = new Set();
    for (const [id, e] of Object.entries(s.edits)) {
      if (!safeId(id) || !object(e) || !own(e, 'htmlOverride') || !text(e.htmlOverride)) fail();
      if (own(e, 'originalText') && !text(e.originalText)) fail();
      if (own(e, 'editedAt') && !timestamp(e.editedAt)) fail();
    }
    for (const c of s.customCards) {
      if (!object(c) || !safeId(c.id) || noteIds.has(c.id) || own(s.edits, c.id) || !text(c.title, 10000) || !text(c.html)) fail();
      for (const k of ['createdAt', 'editedAt']) if (own(c, k) && !timestamp(c[k])) fail();
      noteIds.add(c.id);
    }
    for (const [id, hidden] of Object.entries(s.hiddenCards)) if (!safeId(id) || typeof hidden !== 'boolean') fail();
    if (own(s, 'handoff')) validateHandoff(s.handoff);
    if (own(s, 'pipeline')) validatePipeline(s.pipeline);
    return true;
  }
  function editState(s) { return copy({ edits: s.edits || {}, customCards: s.customCards || [], hiddenCards: s.hiddenCards || {} }); }
  function rowKeys(s) {
    return new Set([...Object.keys(s.edits || {}).map(k => 'card:' + k), ...(s.customCards || []).map(c => 'custom:' + c.id), ...Object.keys(s.hiddenCards || {}).filter(k => s.hiddenCards[k]).map(k => 'hidden:' + k)]);
  }
  function removedKeys(before, after) { const keys = rowKeys(after); return [...rowKeys(before)].filter(k => !keys.has(k)); }
  function recoveryKey(owner, sid) {
    if (!owner || typeof owner !== 'string') throw new Error('A signed-in owner is required.');
    return 'stm-v94-summary:' + encodeURIComponent(owner) + ':' + encodeURIComponent(sid || 'draft');
  }
  function recoveryMatches(rec, owner, sid) { return object(rec) && rec.schema === 1 && text(rec.owner, 1000) && rec.owner === owner && (rec.sid === null || safeId(rec.sid)) && rec.sid === (sid || null); }
  function validateRecovery(rec, owner, sid) {
    if (serializedBytes(rec) > MAX_RECOVERY_BYTES) throw new Error('Recovery data exceeds 10 MiB. Keep this page open until its cloud save succeeds.');
    if (!recoveryMatches(rec, owner, sid) || !timestamp(rec.at) || !Number.isInteger(rec.revision) || rec.revision < 0) fail();
    validateEditState(rec.state);
    validateJson(rec);
    if (!Array.isArray(rec.tombstones) || rec.tombstones.length > 8000) fail();
    const keys = rowKeys(rec.state), seen = new Set();
    for (const key of rec.tombstones) {
      if (typeof key !== 'string') fail();
      const m = key.match(/^(card|custom|hidden):(.+)$/);
      if (!m || !safeId(m[2]) || seen.has(key) || keys.has(key)) fail();
      seen.add(key);
    }
    return true;
  }
  function confidence(n) { if (!finite(n)) return null; const x = Number(n); return x < 0 || x > 100 ? null : Math.round(x <= 1 ? x * 100 : x); }
  function stage(module) { const w = Number(module?.wave); return w === 1 ? 1 : w === 2 ? 2 : 3; }
  function outcome(ext, node) {
    if (ext?.rejected || ext?.refused || ext?.excluded || ext?.applicant_match === 'mismatch') return 'refused';
    if (node === 'running') return 'running';
    if (node === 'cancelled') return 'cancelled';
    if (node === 'error' || ext?.rerunFailed) return ext && own(ext, 'text') ? 'previous-output' : 'failed';
    if (ext?.staleInputs8732 || ext?.staleFromRerun || node === 'warn') return 'stale';
    if (ext && own(ext, 'text')) return ext.cached8760 || ext.cached || ext.cacheHit || ext.fromCache ? 'cached' : 'available';
    return node === 'skipped' ? 'skipped' : 'waiting';
  }
  function project(s, modules, nodes) {
    const cards = Object.entries(s.extractions || {}).map(([id, ext]) => ({ id, code: modules[id]?.code || id, name: modules[id]?.name || modules[id]?.label || id, stage: stage(modules[id]), status: outcome(ext, nodes?.[id]?.status), confidence: confidence(ext.confidence), seconds: finite(ext.timing) && Number(ext.timing) >= 0 ? Number(ext.timing) : null, source: typeof ext.sourceInfo === 'string' ? ext.sourceInfo : '', edited: own(s.edits?.[id], 'htmlOverride'), hidden: !!s.hiddenCards?.[id], note: false }));
    for (const c of s.customCards || []) cards.push({ id: c.id, code: 'NOTE', name: c.title || 'Custom Note', stage: 2, status: 'note', confidence: null, seconds: null, source: 'Underwriter note', edited: true, hidden: !!s.hiddenCards?.[c.id], note: true });
    const cs = cards.filter(c => !c.note), valid = cs.map(c => c.confidence).filter(n => n !== null);
    return { cards, total: cs.length, visible: cards.filter(c => !c.hidden), hidden: cards.filter(c => c.hidden), confidence: valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null, seconds: cs.reduce((a, c) => a + (c.seconds || 0), 0), edited: cards.filter(c => c.edited).length, issues: cs.filter(c => ['refused', 'failed', 'stale', 'previous-output', 'cancelled'].includes(c.status)).length };
  }
  function reduce(s, event) {
    validateEditState(s);
    const n = editState(s), id = event.id;
    if (['edit', 'revert', 'hide', 'note', 'note-edit'].includes(event.type) && !safeId(id)) throw new Error('Invalid card identifier.');
    if (event.type === 'edit') n.edits[id] = { htmlOverride: String(event.html ?? ''), originalText: String(event.originalText ?? ''), editedAt: event.at || 0 };
    else if (event.type === 'revert') delete n.edits[id];
    else if (event.type === 'hide') n.hiddenCards[id] = true;
    else if (event.type === 'restore') n.hiddenCards = {};
    else if (event.type === 'note') {
      if (n.customCards.some(c => c.id === id) || own(n.edits, id)) throw new Error('Duplicate note identifier.');
      n.customCards.push({ id, title: String(event.title ?? 'Custom Note'), html: String(event.html ?? ''), createdAt: event.at || 0, editedAt: event.at || 0 });
    } else if (event.type === 'note-edit') {
      const c = n.customCards.find(c => c.id === id); if (!c) throw new Error('Note not found.');
      if (own(event, 'html')) c.html = String(event.html ?? '');
      if (own(event, 'title')) c.title = String(event.title ?? '');
      c.editedAt = event.at || 0;
    } else if (event.type === 'reset') { n.edits = {}; n.customCards = []; n.hiddenCards = {}; }
    else throw new Error('Unsupported summary action.');
    validateEditState(n); return n;
  }
  return Object.freeze({ own, object, copy, safeId, confidence, stage, outcome, project, editState, rowKeys, removedKeys, recoveryKey, recoveryMatches, validateRecovery, validateEditState, validateHandoff, validatePipeline, validateOperation, serializedBytes, MAX_RECOVERY_BYTES, reduce });
});
