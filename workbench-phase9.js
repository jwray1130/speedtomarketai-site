/* Phase 9: the Renewal chapter and the deal type switch.
 * July's renewal handlers (setupTypeSelector, setupYOY, setupERC, setupRenewalAutoRater)
 * stay the calculation and formatting authority. This module only maps their controls
 * to the redesigned page and records the year-over-year and effective-rate-change
 * worksheets in the existing workbench_field_edits store (July never persisted them).
 * The fleet comparison (July's #autoTable) is served through the Phase 6 adapter.
 */
(function (global) {
  'use strict';
  const clone = x => JSON.parse(JSON.stringify(x));
  const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
  const YOY_ROWS = ['gross', 'glPrem', 'glRate', 'alPrem', 'autoUnits', 'autoRates', 'comm', 'lead', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'];
  const COMPUTED = ['glRate', 'autoRates'];
  const ERC = ['expGlExp', 'expAlExp', 'expPrem', 'splitGl', 'splitAl', 'renGlExp', 'renAlExp', 'renPrem'];
  const ERC_OUT = ['premGl', 'premAl', 'premTotal', 'rateGl', 'rateAl', 'flatGl', 'flatAl', 'flatTotal', 'renGl', 'renAl'];
  const SUMMARY = ['expGlExp', 'expAlExp', 'expPrem', 'splitGl', 'splitAl', 'renGlExp', 'renAlExp', 'renPrem', 'erc'];
  const SCALARS = ['typeSelect', 'glPer', 'commentsTxt'];
  global.STMWorkbenchPhase9 = { install(ctx) {
    const { api, edits, markDirty, mirror, changed, recordHistory } = ctx;
    const doc = global.document, $ = id => doc.getElementById(id);
    const runtime = global.parent?.STM_RUNTIME || null;
    let dirty = false, mutating = false;
    const yoyEl = (row, i) => doc.querySelector('.yoy-input[data-row="' + row + '"][data-idx="' + i + '"]');
    const ercEl = k => doc.querySelector('[data-erc="' + k + '"]');
    function assertOwner(sid) {
      if (api.restoreError) throw new Error(api.restoreError);
      if (!global.currentUser || !sid || api.submissionId !== sid) throw new Error('This workbench session is no longer active. Reopen the submission.');
      const r = runtime;
      if (r && (r.activeId !== sid || r.workbenchWindow !== global || r.user?.id !== global.currentUser.id)) throw new Error('Stale renewal action rejected. Reopen the submission.');
    }
    function fire(el, final) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (final) { el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: false })); }
    }
    function touch() { dirty = true; capture(); changed(); mirror(); }
    function snapshot() {
      const yoy = {};
      doc.querySelectorAll('.yoy-input').forEach(el => { yoy[el.dataset.row + ':' + el.dataset.idx] = { v: String(el.value ?? ''), e: el.dataset.userEdited === '1' ? 1 : 0 }; });
      const erc = {};
      ERC.forEach(k => { const el = ercEl(k); if (el) erc[k] = { v: String(el.value ?? '') }; });
      return { v: 1, yoy, erc };
    }
    function capture() {
      if (!dirty && !edits.map.__phase9) return;
      const data = snapshot();
      const prev = edits.map.__phase9;
      if (!prev || JSON.stringify(prev.data) !== JSON.stringify(data)) edits.map.__phase9 = { data: clone(data), t: Date.now() };
    }
    function validate(rec) {
      if (!rec) return true;
      const fail = () => { throw new Error('Saved renewal structure is invalid. No renewal edits were applied. Keep the recovery data and reopen a valid version.'); };
      const s = rec.data;
      if (!object(s) || s.v !== 1 || !object(s.yoy) || !object(s.erc)) fail();
      for (const [k, val] of Object.entries(s.yoy)) {
        const p = k.split(':');
        if (p.length !== 2 || !YOY_ROWS.includes(p[0]) || !/^[0-3]$/.test(p[1]) || !object(val) || typeof val.v !== 'string' || val.v.length > 100 || ![0, 1].includes(val.e)) fail();
      }
      for (const [k, val] of Object.entries(s.erc)) {
        if (!ERC.includes(k) || !object(val) || typeof val.v !== 'string' || val.v.length > 100) fail();
      }
      return true;
    }
    function restore(rec) {
      if (!rec) return;
      validate(rec);
      const s = rec.data;
      for (const [k, val] of Object.entries(s.yoy)) {
        const [row, idx] = k.split(':');
        const el = yoyEl(row, idx);
        if (!el) continue;
        el.value = val.v;
        el.dataset.userEdited = val.e ? '1' : '0';
      }
      for (const [k, val] of Object.entries(s.erc)) { const el = ercEl(k); if (el) el.value = val.v; }
      // Recalculate through July's own listeners (one event per worksheet).
      const first = yoyEl('gross', 0); if (first) first.dispatchEvent(new Event('input', { bubbles: true }));
      const e0 = ercEl('expGlExp'); if (e0) e0.dispatchEvent(new Event('input', { bubbles: true }));
      dirty = true;
    }
    function describeCell(el) { return { v: el ? String(el.value ?? '') : '', edited: el?.dataset.userEdited === '1' }; }
    function years() {
      return Array.from(doc.querySelectorAll('#yoyTable thead th')).map(th => th.textContent.trim()).filter(t => /^\d{4}$/.test(t));
    }
    function readYoy() {
      const labels = {};
      doc.querySelectorAll('#yoyTable tbody tr').forEach(tr => { const el = tr.querySelector('.yoy-input'); if (el) labels[el.dataset.row] = tr.cells[0].textContent.trim(); });
      return YOY_ROWS.map(row => {
        const first = yoyEl(row, 0);
        const cells = [0, 1, 2, 3].map(i => describeCell(yoyEl(row, i)));
        const vars = [0, 1, 2].map(i => {
          const td = doc.querySelector('[data-var="' + row + '"][data-from="' + i + '"]');
          const c = td?.style.color || '';
          return { text: td ? td.textContent.trim() : '', dir: /success/.test(c) ? 'up' : /danger/.test(c) ? 'down' : '' };
        });
        return { id: row, label: labels[row] || row, type: first?.dataset.type || 'currency', computed: COMPUTED.includes(row), cells, vars };
      });
    }
    function readErc() {
      const inputs = {}; ERC.forEach(k => { const el = ercEl(k); inputs[k] = { v: el ? String(el.value ?? '') : '', placeholder: el?.placeholder || '' }; });
      const outputs = {}; ERC_OUT.forEach(k => { outputs[k] = doc.querySelector('[data-erc-out="' + k + '"]')?.textContent.trim() || ''; });
      const summary = {}; SUMMARY.forEach(k => { summary[k] = doc.querySelector('[data-summary-out="' + k + '"]')?.textContent.trim() || ''; });
      const badge = doc.querySelector('.erc-badge');
      const state = badge?.classList.contains('is-positive') ? 'pos' : badge?.classList.contains('is-negative') ? 'neg' : 'flat';
      return { inputs, outputs, summary, pct: $('ercPct')?.textContent.trim() || '', state, glPerEcho: $('glPerEcho')?.textContent.trim() || '' };
    }
    function readFleet(sid) {
      const p6 = global.__STM_WB_PHASE6;
      if (!p6?.ready) return { rows: [], text: {} };
      const m = p6.read(sid);
      return { rows: m.tables.auto || [], text: m.text || {} };
    }
    const bridge = {
      ready: true, capture, validate, restore,
      type() { return $('typeSelect')?.value === 'Renewal' ? 'Renewal' : 'New'; },
      read(sid) {
        assertOwner(sid);
        return {
          id: sid, revision: api.revision, dirty: api.dirty,
          type: bridge.type(),
          years: years(),
          glPer: String($('glPer')?.value ?? ''),
          comments: String($('commentsTxt')?.value ?? ''),
          yoy: readYoy(),
          erc: readErc(),
          fleet: readFleet(sid),
          polEff: String($('polEff')?.value || $('polEff')?._flatpickr?.altInput?.value || '')
        };
      },
      set(sid, key, value, final = true) {
        assertOwner(sid);
        if (!['string', 'number'].includes(typeof value) || String(value).length > 100000) throw new Error('Invalid field value.');
        const p = String(key).split('|');
        if (p[0] === 'r' && p[1] === 'auto') {
          const result = global.__STM_WB_PHASE6.set(sid, key, value, final);
          return { v: result?.value ?? String(value) };
        }
        let el = null;
        if (p[0] === 's' && p.length === 2 && SCALARS.includes(p[1])) el = $(p[1]);
        else if (p[0] === 'y' && p.length === 3 && YOY_ROWS.includes(p[1]) && /^[0-3]$/.test(p[2])) el = yoyEl(p[1], p[2]);
        else if (p[0] === 'e' && p.length === 2 && ERC.includes(p[1])) el = ercEl(p[1]);
        if (!el) throw new Error('Unknown renewal field.');
        if (el.tagName === 'SELECT' && !Array.from(el.options).some(o => o.value === String(value))) throw new Error('Invalid deal type.');
        el.value = String(value);
        if (p[0] === 'y' && COMPUTED.includes(p[1])) el.dataset.userEdited = '1';
        fire(el, final);
        if (p[0] === 's') { markDirty(el); changed(); mirror(); }
        else touch();
        if (p[0] === 's' && p[1] === 'typeSelect' && final) recordHistory('Deal type set', String(value));
        return { v: String(el.value ?? '') };
      },
      setType(sid, type) {
        if (!['New', 'Renewal'].includes(type)) throw new Error('Invalid deal type.');
        return bridge.set(sid, 's|typeSelect', type, true);
      },
      action(sid, action) {
        assertOwner(sid);
        if (mutating) throw new Error('A renewal action is already in progress.');
        mutating = true;
        try {
          if (action === 'yoy:reset') { $('yoyReset')?.click(); touch(); recordHistory('Renewal metrics reset', 'Year-over-year metrics'); return true; }
          throw new Error('Unknown renewal action.');
        } finally { mutating = false; }
      }
    };
    global.__STM_WB_PHASE9 = bridge;
    return bridge;
  } };
})(window);
