/* Durable Summary service in the owning platform document. */
(function () {
  'use strict';
  const K = window.STMSubmissionContracts, S = window.STATE;
  if (!K || !S) throw new Error('Summary service loaded before its dependencies.');
  const clone = K.copy, uid = () => window.currentUser?.id || null;
  let ctx = null, revision = 0, savedRevision = 0, generation = 0, pendingSave = null, debounce = null;
  let saveError = '', localError = '', restoreError = '', saving = false, lastSaved = null, recovery = null, retired = false;
  let tombstones = new Map(), operation = null, lastOperation = null, nodes = {}, noteSequence = 0, handingOff = false;
  const modalScopes = new Map();
  const emit = () => window.dispatchEvent(new CustomEvent('stm:submission-change', { detail: { revision, sid: ctx?.sid || null } }));
  const toast = (message, type = 'error') => window.toast?.(String(message), type);
  const audit = (message, type = 'ok') => window.logAudit?.('Interface', message, type);
  function snapshotFiles() {
    if (typeof window.slimSnapshotFiles8799 !== 'function') {
      if (S.files?.length) throw new Error('Source-text persistence is unavailable. Keep this page open and reload the complete application before saving.');
      return [];
    }
    return window.slimSnapshotFiles8799();
  }
  function captureOwner() {
    const native = window.__STM_NATIVE_PLATFORM;
    if (native?.captureOwner) return native.captureOwner();
    if (!uid()) throw new Error('Sign in before changing this submission.');
    return { userId: uid() };
  }
  function assertOwner(token) {
    if (window.__STM_NATIVE_PLATFORM?.assertOwner) window.__STM_NATIVE_PLATFORM.assertOwner(token);
    if (retired || !token || token.userId !== uid()) throw new Error('Session changed. Reopen this submission before continuing.');
  }
  const identityMatches = c => !!c && c.owner === uid() && c.sid === (S.activeSubmissionId || null);
  function assertContext(c) {
    assertOwner(c?.platformOwner);
    if (!identityMatches(c) || c.generation !== generation) throw new Error('Submission changed. Reopen this submission before continuing.');
    if (restoreError) throw new Error(restoreError);
  }
  function promotionAllowed() {
    return operation && operation.generation === generation && operation.owner === uid() && operation.sid === null && ctx?.sid === null && !!S.activeSubmissionId;
  }
  function promoteDraft(id, ownerToken) {
    const owner = ownerToken || captureOwner(); assertOwner(owner);
    if (!K.safeId(id) || S.activeSubmissionId !== id) throw new Error('The new submission identity is invalid.');
    if (!ctx) return context();
    if (ctx.owner !== uid() || ctx.generation !== generation || ctx.sid !== null || pendingSave || restoreError) throw new Error('This draft cannot be moved to the selected submission.');
    const oldKey = K.recoveryKey(ctx.owner, null);
    ctx = { ...ctx, sid: id }; rememberRecovery();
    if (stash()) { try { localStorage.removeItem(oldKey); } catch (_) {} }
    return { ...ctx };
  }
  function rememberRecovery() {
    if (!ctx || restoreError || !identityMatches(ctx)) return false;
    try {
      const activeOperation = operation && !operation.finishing ? { kind: operation.kind, started: operation.started, ended: null, status: operation.cancelled ? 'cancelled' : 'interrupted', nodes: clone(nodes) } : clone(lastOperation);
      const pipeline = { files: snapshotFiles(), extractions: clone(S.extractions || {}), pipelineRun: S.pipelineRun || null, pipelineStart: S.pipelineStart || 0, runTotalCost: S.runTotalCost || 0, audit: clone(S.audit || []), _stmRunComplete: operation && !operation.finishing ? false : !!S.pipelineDone, _stmOperation: activeOperation };
      const candidate = { schema: 1, owner: ctx.owner, sid: ctx.sid, at: Date.now(), revision: Math.max(1, revision), state: { ...K.editState(S), handoff: clone(S.handoff || { status: null, viewAs: 'uw', history: [] }), pipeline }, tombstones: [...tombstones.keys()] };
      K.validateRecovery(candidate, ctx.owner, ctx.sid); recovery = candidate; return true;
    } catch (e) { localError = 'Current source text and outputs could not be saved for browser recovery. Keep this page open until the cloud save succeeds. ' + e.message; return false; }
  }
  function stash() {
    if (!ctx || (revision === savedRevision && !operation) || restoreError) return !restoreError;
    if (identityMatches(ctx) && !rememberRecovery()) return false;
    if (!recovery) return false;
    try { localStorage.setItem(K.recoveryKey(recovery.owner, recovery.sid), JSON.stringify(recovery)); localError = ''; return true; }
    catch (_) { localError = 'Browser recovery storage failed. Keep this tab open until a cloud save succeeds.'; return false; }
  }
  function context() {
    const platformOwner = captureOwner(); assertOwner(platformOwner);
    if (promotionAllowed()) {
      promoteDraft(S.activeSubmissionId, platformOwner);
    }
    if (!ctx || !identityMatches(ctx)) {
      if (ctx && (revision > savedRevision || pendingSave || restoreError)) {
        stash(); throw new Error('Unsynced summary changes remain in the previous submission. Save them before switching.');
      }
      ctx = { owner: uid(), sid: S.activeSubmissionId || null, platformOwner, generation: ++generation };
      revision = savedRevision = 0; tombstones = new Map(); saveError = localError = restoreError = ''; lastSaved = null; recovery = null;
      try {
        K.validateEditState(S);
        if (S.handoff) K.validateHandoff(S.handoff);
        const raw = localStorage.getItem(K.recoveryKey(ctx.owner, ctx.sid));
        if (raw !== null) {
          if (K.serializedBytes(raw) > K.MAX_RECOVERY_BYTES) throw new Error('Recovery data exceeds 10 MiB. Keep this page open and retain this browser recovery data.');
          const saved = JSON.parse(raw); K.validateRecovery(saved, ctx.owner, ctx.sid);
          const state = clone(saved.state);
          for (const key of ['edits', 'customCards', 'hiddenCards']) S[key] = state[key];
          if (state.handoff) S.handoff = state.handoff;
          if (state.pipeline) {
            const p = state.pipeline;
            Object.assign(S, { files: p.files, extractions: p.extractions, pipelineRun: p.pipelineRun, pipelineStart: p.pipelineStart, runTotalCost: p.runTotalCost, audit: p.audit, pipelineDone: p._stmRunComplete, pipelineRunning: false });
            lastOperation = clone(p._stmOperation); nodes = K.object(lastOperation?.nodes) ? clone(lastOperation.nodes) : {};
          }
          revision = Math.max(1, saved.revision); tombstones = new Map(saved.tombstones.map(key => [key, revision])); recovery = saved;
          saveError = 'Recovered unsynced changes. Save to sync this submission.';
        }
      } catch (e) {
        restoreError = 'Summary restore failed. ' + e.message; saveError = restoreError;
      }
      lastOperation = clone(recovery?.state?.pipeline ? recovery.state.pipeline._stmOperation : S.submissions?.find(r => r.id === ctx.sid)?.snapshot?._stmOperation || null);
      nodes = K.object(lastOperation?.nodes) ? clone(lastOperation.nodes) : {};
    }
    assertContext(ctx); return { ...ctx };
  }
  function status() {
    let label = restoreError ? 'Summary recovery needs attention' : saveError ? 'Not synced — retry Save' : saving ? 'Saving changes…' : revision > savedRevision ? (ctx?.sid ? 'Unsaved changes' : 'Draft saved in this browser') : lastSaved ? 'Saved to cloud' : 'No unsaved summary changes';
    if (localError) label = localError;
    return { dirty: revision > savedRevision, saving, error: saveError, restoreError, localError, label, lastSaved, revision, savedRevision, owner: ctx?.owner || null, sid: ctx?.sid || null };
  }
  function renderSaveIndicator() {
    const info = status(), text = document.getElementById('saveIndicatorText'), indicator = document.getElementById('saveIndicator');
    if (text) text.textContent = info.label;
    if (indicator) { indicator.classList.toggle('saving', saving); indicator.classList.toggle('saved', !info.dirty && !saving && !saveError && !restoreError); }
  }
  function notify() { renderSaveIndicator(); emit(); }
  function dirty() {
    context(); revision++; saveError = ''; stash(); clearTimeout(debounce);
    const c = { ...ctx };
    debounce = setTimeout(() => { try { assertContext(c); flush().catch(e => { if (identityMatches(c) && !retired) toast(e.message); }); } catch (_) {} }, 500);
    notify();
  }
  function snapshot() {
    const rec = S.submissions.find(r => r.id === ctx.sid) || { id: ctx.sid, account: window.deriveAccountName?.() || 'Submission', status: 'AWAITING UW REVIEW', createdAt: Date.now(), statusHistory: [] };
    const snap = { ...clone(rec.snapshot || {}), files: snapshotFiles(), extractions: clone(S.extractions), ...K.editState(S), handoff: clone(S.handoff), audit: clone(S.audit), runTotalCost: S.runTotalCost || 0, pipelineRun: S.pipelineRun, pipelineStart: S.pipelineStart || 0, _stmRunComplete: !!S.pipelineDone, _stmOperation: clone(lastOperation) };
    return { rec, snap };
  }
  async function flush() {
    clearTimeout(debounce); debounce = null; const c = context();
    if (!c.sid) { stash(); return { mode: 'local', dirty: revision > savedRevision }; }
    if (pendingSave) { await pendingSave; assertContext(c); return revision > savedRevision ? flush() : { mode: 'cloud' }; }
    if (revision === savedRevision && !saveError) {
      if (localError && recovery) {
        try { localStorage.removeItem(K.recoveryKey(c.owner, c.sid)); recovery = null; localError = ''; notify(); }
        catch (_) { /* The cloud result remains valid; keep the cleanup warning. */ }
      }
      return { mode: 'cloud', unchanged: true };
    }
    const task = (async () => {
      saving = true; notify();
      try {
        while (revision > savedRevision) {
          assertContext(c); K.validateEditState(S); K.validateHandoff(S.handoff || {});
          const user = await window.sbUser(); assertContext(c);
          if (!user || user.id !== c.owner) throw new Error('Session expired. Your changes remain saved in this browser.');
          const rev = revision, es = K.editState(S), deleted = [...tombstones.entries()], run = S.pipelineRun || null, { rec, snap } = snapshot();
          assertContext(c);
          const written = await window.sbSaveSubmission(window.buildSubmissionPayload(rec, snap)); assertContext(c);
          if (!written) throw new Error('Submission save was rejected or the record was deleted.');
          await window.sbSaveAllEditsForSubmission(c.sid, run, es.edits, es.customCards, es.hiddenCards); assertContext(c);
          for (const [key] of deleted) { assertContext(c); await window.sbDeleteEdit(c.sid, key); assertContext(c); }
          rec.snapshot = snap;
          // A later remove of the same key must survive this earlier write.
          for (const [key, stamp] of deleted) if (tombstones.get(key) === stamp) tombstones.delete(key);
          savedRevision = rev; lastSaved = Date.now(); saveError = '';
          if (savedRevision === revision) {
            try { localStorage.removeItem(K.recoveryKey(c.owner, c.sid)); recovery = null; localError = ''; }
            catch (_) { localError = 'Cloud save succeeded, but browser recovery cleanup failed. Keep this page open and retry Save.'; }
          } else stash();
        }
        return { mode: 'cloud' };
      } catch (e) {
        if (c.generation === generation && ctx?.owner === c.owner && ctx?.sid === c.sid) { saveError = e.message || String(e); stash(); }
        throw new Error('Summary save failed: ' + (e.message || e));
      } finally { if (c.generation === generation) { saving = false; notify(); } }
    })();
    pendingSave = task;
    try { return await task; } finally { if (pendingSave === task) pendingSave = null; }
  }
  const safe = html => window.sanitizeModelHtml(String(html ?? ''));
  const exists = id => K.own(S.extractions, id) || S.customCards.some(c => c.id === id);
  function change(event) {
    context(); if (operation) throw new Error('Wait for the active pipeline operation before editing its summary.');
    if (['edit', 'hide', 'revert', 'note-edit'].includes(event.type) && !exists(event.id)) throw new Error('This card is no longer in the submission.');
    if (event.type === 'note' && exists(event.id)) throw new Error('Duplicate card identifier.');
    if (event.type === 'revert' && S.customCards.some(c => c.id === event.id)) throw new Error('Custom notes have no original pipeline output.');
    const before = K.editState(S);
    if (K.own(event, 'html')) event = { ...event, html: safe(event.html) };
    const next = K.reduce(before, { ...event, at: Date.now() });
    for (const key of K.removedKeys(before, next)) tombstones.set(key, revision + 1);
    for (const key of K.rowKeys(next)) tombstones.delete(key);
    Object.assign(S, next); dirty(); return next;
  }
  function body(id) {
    context(); const note = S.customCards.find(c => c.id === id);
    if (note) return safe(note.html);
    if (K.own(S.edits?.[id], 'htmlOverride')) return safe(S.edits[id].htmlOverride);
    if (!S.extractions[id]) return '';
    if (!window.MODULES[id]) { const p = document.createElement('p'); p.textContent = S.extractions[id].text || ''; return p.outerHTML; }
    const holder = document.createElement('div'); holder.innerHTML = window.renderExtractionCard(id);
    return safe(holder.querySelector('.sc-body')?.innerHTML || '');
  }
  function project() {
    context(); return { ...K.project(S, window.MODULES || {}, nodes), save: status(), operation: operation ? { kind: operation.kind, cancelled: operation.cancelled, finishing: !!operation.finishing, started: operation.started } : null, lastOperation: clone(lastOperation), nodes: clone(nodes), handoff: clone(S.handoff), pending: window.computePendingClosure8747?.() || { all: [], stale: [], newBatches: [] }, fileCount: S.files.length };
  }
  function assertActive(token = operation) {
    if (!token) return assertContext(context());
    assertOwner(token.platformOwner);
    if (token.generation !== generation || token.owner !== uid() || (token.sid !== null && token.sid !== (S.activeSubmissionId || null))) throw new Error('This operation belongs to a previous submission.');
    if (token.sid === null && ctx?.sid && ctx.sid !== S.activeSubmissionId) throw new Error('The draft submission changed during this operation.');
    if (restoreError) throw new Error(restoreError);
  }
  function assertNotCancelled() {
    assertActive();
    if (operation?.cancelled) { const e = new Error('Operation cancelled by the underwriter.'); e.name = 'AbortError'; e.stmCancelled = true; throw e; }
  }
  function cancel() {
    if (!operation || operation.finishing) return false;
    operation.cancelled = true;
    for (const controller of operation.controllers) controller.abort();
    // The intake preflight promise otherwise stays pending after cancellation.
    document.querySelector('#preflight8733 .pf-cancel')?.click();
    if (!retired && operation.owner === uid()) { audit('Cancellation requested. In-flight work is being stopped.', 'warn'); notify(); }
    return true;
  }
  async function execute(kind, fn) {
    if(window.__STM_NATIVE_CONFIG?.pending||window.__STM_SETTINGS_WRITE)throw new Error("Wait for the settings save to finish before starting Pipeline or file intake.");
    if (operation) throw new Error('A pipeline operation is already active.');
    const c = context(), token = { kind, started: Date.now(), cancelled: false, finishing: false, controllers: new Set(), owner: c.owner, sid: c.sid, platformOwner: c.platformOwner, generation };
    let settleOperation; token.settled = new Promise(resolve => { settleOperation = resolve; });
    operation = token; nodes = {}; notify(); let thrown = null, result;
    try { await flush(); assertNotCancelled(); result = await fn(); assertActive(token); }
    catch (e) { thrown = e; }
    finally {
      try {
        assertActive(token); context();
        if (token.cancelled) { S.pipelineRunning = false; S.pipelineDone = false; document.getElementById('pipeStatus')?.replaceChildren(document.createTextNode('Cancelled — partial results retained')); window.updateRunButton?.(); }
        const errors = Object.values(nodes).filter(n => ['error', 'warn', 'cancelled'].includes(n.status)).length;
        lastOperation = { kind, started: token.started, ended: Date.now(), status: token.cancelled ? 'cancelled' : thrown ? 'failed' : kind === 'runPipeline' && !S.pipelineDone ? 'not-completed' : errors ? 'finished-with-issues' : 'finished', issues: errors, nodes: clone(nodes) };
        token.finishing = true; dirty(); await flush(); assertActive(token);
      } catch (e) { if (!thrown) thrown = e; }
      finally { if (operation === token) operation = null; if (!retired && token.generation === generation) notify(); settleOperation(); }
    }
    if (thrown && !token.cancelled) throw thrown;
    return token.cancelled ? { status: 'cancelled' } : result;
  }
  function recordNode(id, value, timing) {
    assertActive(); if (!K.safeId(id)) return;
    nodes[id] = { status: operation?.cancelled ? 'cancelled' : value, timing: timing ?? null, at: Date.now() }; notify();
  }
  function abandonContext(options = {}) {
    if (pendingSave || operation) throw new Error('Wait for the active save or operation before changing submissions.');
    if (options.discardRecovery && ctx) localStorage.removeItem(K.recoveryKey(ctx.owner, ctx.sid)); else stash();
    clearTimeout(debounce); generation++; ctx = null; recovery = null; revision = savedRevision = 0; tombstones = new Map();
    saveError = localError = restoreError = ''; saving = false; lastSaved = null; nodes = {}; lastOperation = null; modalScopes.clear(); retired = false;
  }
  const redraw = () => { window.renderSummaryCards?.(); notify(); };
  window.markDirty = dirty; window.saveEditsNow = window.flushEditsNow = flush; window.updateSaveIndicator = renderSaveIndicator;
  window.resyncActiveSnapshot = async () => { dirty(); return flush(); };
  window.revertCard = async id => { const c = context(); if (!confirm('Revert this card to the pipeline output?')) return false; assertContext(c); change({ type: 'revert', id }); audit('Reverted card ' + id); redraw(); await flush(); assertContext(c); return true; };
  window.deleteCard = id => { change({ type: 'hide', id }); audit('Hidden card ' + id); redraw(); return true; };
  window.restoreAllCards = async () => { const c = context(); change({ type: 'restore' }); audit('Restored hidden cards'); redraw(); await flush(); assertContext(c); return true; };
  window.clearAllEdits = async () => { const c = context(); if (!confirm('Reset all summary edits, remove custom notes and restore hidden cards? Pipeline outputs are retained.')) return false; assertContext(c); change({ type: 'reset' }); audit('Reset summary edits, notes and hidden cards'); redraw(); await flush(); assertContext(c); return true; };
  window.addCustomCard = () => { const id = 'custom_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '_' + (++noteSequence)); change({ type: 'note', id, title: 'Custom Note', html: '<p></p>' }); audit('Added custom note ' + id); redraw(); return id; };
  for (const [target, openName, closeName] of [['assistant', 'openSendToAssistantModal', 'closeSendToAssistantModal'], ['uw', 'openReturnToUwModal', 'closeReturnToUwModal']]) {
    const open = window[openName], close = window[closeName];
    window[openName] = function () { const c = context(); if (operation) throw new Error('Wait for the pipeline to finish.'); modalScopes.set(target, c); return open?.apply(this, arguments); };
    window[closeName] = function () { modalScopes.delete(target); return close?.apply(this, arguments); };
  }
  window.persistHandoffState = async reason => { const c = context(); dirty(); const result = await flush(); assertContext(c); if (result.mode !== 'cloud') throw new Error('Save a submission before recording a handoff.'); audit('Persisted handoff transition: ' + reason); return result; };
  async function handoff(to) {
    if (handingOff) return false;
    const c = modalScopes.get(to); if (!c) throw new Error('Reopen the review dialog before sending.'); assertContext(c);
    if (operation) throw new Error('Wait for the pipeline to finish.');
    if (!c.sid || (to === 'assistant' && !S.pipelineDone)) throw new Error('Complete and save the submission before sending it for review.');
    const returningAgain = to === 'uw' && S.handoff.status === 'returned_to_uw' && S.handoff.history?.at(-1)?.transition === 'assistant-to-uw';
    if (to === 'uw' && !returningAgain && (S.handoff.viewAs !== 'assistant' || !['awaiting_assistant', 'in_review'].includes(S.handoff.status))) throw new Error('Open Assistant view before returning the review.');
    const note = document.getElementById(to === 'assistant' ? 'handoffUwNote' : 'handoffAssistantNote')?.value.trim() || '';
    if (!note || note.length > 100000) { toast('Write a review note of 100,000 characters or fewer before sending.', 'warn'); return false; }
    if (to === 'assistant' && !window.staleGuard8733('Send to Assistant')) return false;
    assertContext(c); handingOff = true;
    try {
      const now = Date.now(), assignee = document.getElementById('handoffAssignee')?.value || 'Assistant', transition = to === 'assistant' ? 'uw-to-assistant' : 'assistant-to-uw';
      const prior = S.handoff.history?.at(-1), retry = prior?.transition === transition && prior.noteText === note && (to === 'assistant' ? S.handoff.status === 'awaiting_assistant' && S.handoff.assignee === assignee : S.handoff.status === 'returned_to_uw');
      if (to === 'assistant') Object.assign(S.handoff, { status: 'awaiting_assistant', assignee, uwNote: note, sentAt: retry ? S.handoff.sentAt : now });
      else Object.assign(S.handoff, { status: 'returned_to_uw', assistantNote: note, returnedAt: retry ? S.handoff.returnedAt : now, viewAs: 'uw' });
      S.handoff.history = S.handoff.history || [];
      if (!retry) S.handoff.history.push({ transition, at: now, actor: window.currentActor?.() || c.owner, assignee, noteLength: note.length, noteText: note });
      await window.persistHandoffState(to); assertContext(c); window.renderHandoffState?.();
      if (to === 'assistant') window.closeSendToAssistantModal(); else window.closeReturnToUwModal();
      toast(to === 'assistant' ? 'Review assignment saved for ' + assignee : 'Review return saved for the underwriter', 'success'); return true;
    } catch (e) { if (identityMatches(c) && !retired) { window.renderHandoffState?.(); toast('Handoff not synced. Retry Save before leaving: ' + e.message); } return false; }
    finally { handingOff = false; if (!retired && identityMatches(c)) notify(); }
  }
  window.confirmSendToAssistant = () => handoff('assistant'); window.confirmReturnToUw = () => handoff('uw');
  window.toggleAssistantView = async () => {
    const c = context(); if (operation || handingOff) throw new Error('Wait for the active operation.');
    if (!S.handoff.status) { toast('Record a review assignment first.', 'warn'); return false; }
    S.handoff.viewAs = S.handoff.viewAs === 'assistant' ? 'uw' : 'assistant';
    if (S.handoff.viewAs === 'assistant' && S.handoff.status === 'awaiting_assistant') {
      const now = Date.now(); S.handoff.status = 'in_review'; S.handoff.openedAt = now; S.handoff.history = S.handoff.history || [];
      S.handoff.history.push({ transition: 'assistant_opened', at: now, actor: window.currentActor?.() || c.owner });
      dirty(); await flush(); assertContext(c);
    }
    window.renderHandoffState?.(); notify(); return true;
  };
  window.__STM_SUBMISSION = {
    context, assertContext, assertActive, project, body, change, flush, status, stash, dirty, touch: dirty, cancel, assertNotCancelled, execute, recordNode, abandonContext, promoteDraft,
    lastOperation: () => clone(lastOperation), get busy() { return !!operation || handingOff; }, get operation() { return operation; },
    registerAbort(controller) { assertNotCancelled(); const token = operation; token?.controllers.add(controller); return () => token?.controllers.delete(controller); },
    edit(id, html) { const custom = S.customCards.some(c => c.id === id); return change(custom ? { type: 'note-edit', id, html } : { type: 'edit', id, html, originalText: S.extractions[id]?.text || '' }); },
    rename(id, title) { return change({ type: 'note-edit', id, title }); },
    retire() { stash(); clearTimeout(debounce); const draining = [pendingSave, operation?.settled].filter(Boolean); retired = true; cancel(); generation++; modalScopes.clear(); return Promise.allSettled(draining); },
    async action(name, id) {
      context(); if (operation) throw new Error('Wait for the active pipeline operation.');
      const fn = { revert: () => window.revertCard(id), hide: () => window.deleteCard(id), restore: () => window.restoreAllCards(), reset: () => window.clearAllEdits(), note: () => window.addCustomCard(), refresh: () => window.requestSectionRefresh8733(id), pending: () => window.confirmRefreshAllPending8747(), guidelines: () => window.rerunGuidelines(), perspective: () => window.toggleAssistantView() }[name];
      if (!fn) throw new Error('Unknown summary operation.'); return fn();
    },
    classifications() {
      const c = context(), pending = window.RECLASSIFY_PENDING || (typeof RECLASSIFY_PENDING !== 'undefined' ? RECLASSIFY_PENDING : new Map());
      return { identity: c, types: clone(window.CLASSIFIER_TYPES || []), files: S.files.filter(f => f.needsReview || f.classification === 'unknown' || f.state === 'needs_manual' || pending.has(f.id)).map(f => ({ id: f.id, name: f.name, tag: f.tag || f.classification || '', reason: f.reasoning || '', manual: f.state === 'needs_manual', pending: clone(pending.get(f.id) || null) })), pending: pending.size };
    },
    queueClassification(c, id, tag, limit) {
      assertContext(c); if (operation) throw new Error('Wait for the current pipeline.');
      if (!S.files.some(f => f.id === id)) throw new Error('File is no longer in this submission.');
      if (!(window.CLASSIFIER_TYPES || []).some(t => t.value === tag)) throw new Error('Choose a valid classification.');
      window.queueReclassify(id, tag); if (limit !== undefined) window.queueReclassifyLimit(id, String(limit)); notify();
    },
    async acceptClassification(c, id) {
      assertContext(c); if (operation) throw new Error('Wait for the current pipeline.');
      if (!S.files.some(f => f.id === id)) throw new Error('File is no longer in this submission.');
      await window.acceptClassification(id); assertContext(c); dirty(); await flush(); assertContext(c);
    },
    async applyClassifications(c) { assertContext(c); if (operation) throw new Error('Wait for the current pipeline.'); await window.applyReclassifications(); assertContext(c); await window.docsView?.design?.flush(); assertContext(c); dirty(); await flush(); assertContext(c); },
    async feedback(id, sentiment, comment, options = {}) {
      const c = context(), custom = S.customCards.find(note => note.id === id);
      if (options.identity) assertContext(options.identity);
      if (!custom && !S.extractions[id]) throw new Error('Card no longer exists.');
      const text = String(comment || '').trim();
      const reasons = options.reason ? String(options.reason).split(',').filter(Boolean) : [], allowed = sentiment === 'negative' ? ['missed_fact', 'hallucinated', 'wrong_structure', 'wrong_emphasis', 'other'] : sentiment === 'suggestion' ? ['add_detail', 'add_section', 'add_comparison', 'add_citation', 'other'] : [];
      if (!['positive', 'negative', 'suggestion'].includes(sentiment) || text.length > 12000 || reasons.length > 5 || new Set(reasons).size !== reasons.length || reasons.some(reason => !allowed.includes(reason)) || (sentiment !== 'positive' && !text && !reasons.length)) throw new Error('Choose a feedback reason or write a comment of 12,000 characters or fewer.');
      if (!c.sid) throw new Error('Save or run this submission before sending feedback.');
      const event = { id: crypto.randomUUID ? crypto.randomUUID() : Date.now() + '_' + (++noteSequence), submissionId: c.sid, moduleId: custom ? null : id, customCardId: custom ? id : null, level: 'card', moduleName: custom ? custom.title || 'Custom Note' : window.MODULES?.[id]?.name || id, sentiment, reason: reasons.length ? reasons.join(',') : null, text, timestamp: Date.now(), outputSnapshot: (custom ? window.getCustomText?.(custom) ?? custom.html : window.getEffectiveText?.(id) ?? S.extractions[id]?.text ?? '').slice(0, 2000), outputConfidence: S.extractions[id]?.confidence ?? null, sourceDocNames: window.getSourceDocNamesForModule?.(custom ? null : id) || [], pipelineRun: S.pipelineRun, actor: window.currentActor?.() || c.owner, model: window.MODULES?.[id]?.model || null };
      assertContext(c); await window.sbLogFeedback(event); assertContext(c); S.feedback = S.feedback || []; S.feedback.push(event); audit('Feedback ' + sentiment + ' for ' + id); notify(); return event;
    }
  };
  window.addEventListener('beforeunload', stash);
})();
