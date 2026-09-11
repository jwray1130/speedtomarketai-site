/* Native platform coordination. One document, one STATE, one authenticated owner. */
(function () {
  'use strict';
  const W = window;
  const statuses = ['AWAITING UW REVIEW', 'INQUIRED', 'QUOTED', 'DECLINED', 'BOUND'];
  const hashes = {queue:'#/queue', pipeline:'#/submission/pipeline', summary:'#/submission/summary', documents:'#/submission/documents', admin:'#/admin'};
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const S = () => W.STATE;
  let userId = null, epoch = 0, authSequence = 0, intent = 0, queued = 0;
  let tail = Promise.resolve(), drain = Promise.resolve(), profilePromise = null, hydratePromise = null;
  let ready = false, authenticated = false, lastError = '', route = 'queue', routePending = true;
  const initialApi = clone(S()?.api || {});
  const desiredAtBoot = destination();

  function captureOwner() { return Object.freeze({userId, epoch}); }
  function isOwner(owner) {
    const id = typeof owner === 'string' ? owner : owner?.userId;
    return !!id && id === userId && (typeof owner === 'string' || owner.epoch === epoch);
  }
  function stale() {
    const error = new Error('Your sign-in changed. Reopen this submission for the current account.');
    error.code = 'STM_STALE_OWNER';
    return error;
  }
  function assertOwner(owner) {
    const token = owner === undefined ? captureOwner() : owner;
    if (!isOwner(token) || (W.currentUser?.id && W.currentUser.id !== userId)) throw stale();
    return typeof token === 'string' ? captureOwner() : token;
  }
  function notify() { W.dispatchEvent(new CustomEvent('stm:platform-change', {detail: API.state})); }
  function render() {
    for (const name of ['renderQueueTable', 'updateQueueKpi', 'updateApiPillUI']) {
      try { W[name]?.(); } catch (e) { console.warn('[native platform] render', name, e.message); }
    }
    notify();
  }
  function report(error) {
    if (error?.code === 'STM_STALE_OWNER' || error?.code === 'STM_SUPERSEDED') return;
    lastError = error?.message || String(error);
    W.toast?.(lastError, 'error');
    notify();
  }
  function handle(promise) { return Promise.resolve(promise).catch(error => { report(error); return null; }); }
  function assertReady(owner) {
    assertOwner(owner);
    if (!authenticated) throw new Error('Finish signing in before opening a submission.');
    if (!ready) throw new Error(S()?._queueError || 'Wait for your saved submissions to finish loading.');
  }
  function ensureIdle() {
    if (W.__STM_DOCUMENT_IO?.busy || W.__STM_NATIVE_PIPELINE?.busy || S()?.pipelineRunning || W.__STM_SUBMISSION?.busy) {
      throw new Error('Finish or cancel the current upload or pipeline before changing submissions.');
    }
    if (W.__STM_NATIVE_CONFIG?.pending || W.__STM_SETTINGS_WRITE) throw new Error('Wait for the settings save to finish.');
  }
  function clearOwnerState() {
    W.__STM_SHARED_SETTINGS?.retire();
    W.__STM_NATIVE_ADMIN?.retire();
    const state = S();
    if (!state) return;
    state._rehydrateToken = (state._rehydrateToken || 0) + 1;
    state._uploadToken = (state._uploadToken || 0) + 1;
    Object.assign(state, {submissions:[], activeSubmissionId:null, files:[], extractions:{}, edits:{}, customCards:[], hiddenCards:{},
      handoff:{status:null, assignee:null, uwNote:null, assistantNote:null, sentAt:null, openedAt:null, returnedAt:null, viewAs:'uw', history:[]},
      audit:[], feedback:[], pipelineRun:null, pipelineStart:0, pipelineDone:false, pipelineRunning:false, runTotalCost:0, _pendingEdits:null,
      newSubmissionDraftMode:false, _nativeDocumentDraft:false, _deletedSubmissionIds:new Set(), _queueHydrating:!!userId, _queueError:null});
    state.api = clone(initialApi);
    W.__STM_NATIVE_CORE?.resetSettings?.();
    if (W.sbLogAuditEvent) {
      W.sbLogAuditEvent._submissionExistsCache = new Map();
      W.sbLogAuditEvent._buffer = new Map();
    }
    for (const name of ['renderFileList', 'renderSummaryCards', 'renderClassifierReview', 'renderHandoffState', 'updateDecisionPane']) {
      try { W[name]?.(); } catch (_) {}
    }
    for (const id of ['sh-name', 'sh-meta']) { const el = document.getElementById(id); if (el) el.textContent = id === 'sh-name' ? 'New submission' : ''; }
    document.body.classList.remove('pipeline-complete-mode', 'docs-fullwidth');
  }
  function acceptIdentity(nextId) {
    if (nextId === userId) return false;
    // Invalidate every outstanding token before invoking any retirement callbacks.
    epoch++; intent++; authSequence++; userId = nextId || null;
    W.__STM_SHARED_SETTINGS?.retire();
    W.__STM_NATIVE_ADMIN?.retire();
    authenticated = false; ready = false; lastError = ''; routePending = true;
    const oldTail = tail;
    tail = Promise.resolve(); queued = 0; hydratePromise = null; profilePromise = null;
    let pipelineDrain, summaryDrain, documentDrain;
    try { pipelineDrain = W.__STM_NATIVE_PIPELINE?.retire?.(); } catch (_) {}
    try { summaryDrain = W.__STM_SUBMISSION?.retire?.(); } catch (_) {}
    try { documentDrain = W.docsView?.design?.retire?.(); } catch (_) {}
    try {
      const ids = new Set((W.docsView?.getDocs?.() || []).map(doc => doc.submissionId).filter(Boolean));
      ids.forEach(id => W.docsView?.pruneSubmission?.(id));
      W.docsView?.setSubmissionContext?.('__stm_retired_' + epoch, '');
    } catch (_) {}
    W.currentUser = null;
    const overlay = document.getElementById('authOverlay');
    if (overlay) overlay.style.display = 'flex';
    // Unchanged engine finally blocks share STATE: let old work unwind before a new owner loads.
    const retiredEpoch = epoch;
    if (S()) { S()._queueHydrating = !!userId; S()._queueError = null; }
    drain = Promise.allSettled([drain, oldTail, Promise.resolve(pipelineDrain), Promise.resolve(summaryDrain), Promise.resolve(documentDrain)]).then(() => {
      if (retiredEpoch === epoch) { clearOwnerState(); render(); }
    });
    render();
    return true;
  }
  function authEvent(event, session) {
    const nextId = session?.user?.id || null;
    if (event === 'SIGNED_OUT' || !nextId) { acceptIdentity(null); return; }
    const changed = acceptIdentity(nextId);
    if (!changed && authenticated) return; // Token refresh must not reload an edited submission.
    const eventOwner = captureOwner();
    queueMicrotask(() => { if (isOwner(eventOwner)) handle(checkAuth(session)); });
  }
  function safeCallbackUrl() {
    const url = new URL(location.href);
    for (const key of ['code', 'access_token', 'refresh_token', 'token_type', 'expires_in', 'expires_at', 'error', 'error_code', 'error_description']) url.searchParams.delete(key);
    if (/access_token=|refresh_token=|error_description=/.test(url.hash)) url.hash = hashes[desiredAtBoot.target] || hashes.queue;
    url.searchParams.delete('stm_route');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  async function checkAuth(knownSession) {
    if (profilePromise) return profilePromise;
    const startSequence = authSequence;
    const task = (async () => {
      let session = knownSession;
      if (!session) {
        const result = await W.sb.auth.getSession();
        if (startSequence !== authSequence) return false;
        if (result.error) throw result.error;
        session = result.data?.session;
      }
      if (!session?.user?.id) { acceptIdentity(null); return false; }
      acceptIdentity(session.user.id);
      const owner = captureOwner();
      await drain; assertOwner(owner);
      if (authenticated && ready) return true;
      let profile = null;
      try {
        const result = await W.sb.from('users').select('id,email,display_name,role').eq('id', owner.userId).single();
        assertOwner(owner);
        if (!result.error && result.data?.id === owner.userId) profile = result.data;
      } catch (error) { assertOwner(owner); }
      assertOwner(owner);
      W.currentUser = profile || {id:owner.userId, email:session.user.email || '', display_name:session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'User', role:'user'};
      W.__STM_SUBMISSION?.abandonContext?.();
      authenticated = true;
      const overlay = document.getElementById('authOverlay');
      if (overlay) overlay.style.display = 'none';
      const name = document.querySelector('.avatar-name');
      if (name) name.textContent = W.currentUser.display_name || W.currentUser.email || 'User';
      const avatar = document.querySelector('.avatar-circle');
      if (avatar) avatar.textContent = (W.currentUser.display_name || 'User').split(/\s+/).map(part => part[0]).join('').slice(0,2).toUpperCase();
      safeCallbackUrl();
      await hydrate(); assertOwner(owner);
      return true;
    })();
    profilePromise = task;
    try { return await task; }
    catch (error) {
      if (error.code !== 'STM_STALE_OWNER') {
        const el = document.getElementById('authError'); if (el && !authenticated) el.textContent = error.message || 'Could not complete sign-in. Retry.';
      }
      throw error;
    } finally { if (profilePromise === task) profilePromise = null; }
  }
  function queueRecord(row) {
    const derived = row.snapshot?.derived || {}, ext = row.snapshot?.extractions || {}, keys = Object.keys(ext);
    const accountRaw = row.account_name || derived.account || null;
    const account = W.stripAddressTail99 ? W.stripAddressTail99(accountRaw) : accountRaw;
    const missing = Array.isArray(row.missing_info) ? row.missing_info : Array.isArray(derived.missingInfo) ? derived.missingInfo : [];
    return {id:String(row.id), pipelineRun:row.pipeline_run || null, status:statuses.includes(row.status) ? row.status : statuses[0],
      statusHistory:clone(row.status_history?.length ? row.status_history : row.snapshot?.statusHistory || []), title:row.title || null,
      lastModifiedAt:row.updated_at ? new Date(row.updated_at).getTime() : 0, createdAt:row.created_at ? new Date(row.created_at).getTime() : 0,
      snapshot:row.snapshot || null, account, broker:row.broker || derived.broker || null, effective:row.effective_date || derived.effectiveDate || null,
      requested:row.requested || derived.requestedLimits || null, missingInfo:clone(missing),
      modulesRun:typeof row.modules_run === 'number' ? row.modules_run : typeof derived.modulesRun === 'number' ? derived.modulesRun : keys.length,
      confidence:typeof row.confidence === 'number' ? row.confidence : typeof derived.confidence === 'number' ? derived.confidence : keys.length ? keys.reduce((sum,k) => sum + (+ext[k].confidence || 0),0) / keys.length : 0};
  }
  async function hydrate() {
    const owner = assertOwner();
    if (!authenticated) throw new Error('Finish signing in before loading your queue.');
    if (hydratePromise) return hydratePromise;
    if (queued || W.__STM_NATIVE_PIPELINE?.busy) throw new Error('Finish the current operation before refreshing the queue.');
    const task = (async () => {
      S()._queueHydrating = true; S()._queueError = null; lastError = ''; render();
      try {
        const rows = await W.sbLoadSubmissions(); assertOwner(owner);
        const previous = new Map(S().submissions.map(rec => [rec.id,rec]));
        const active = S().activeSubmissionId;
        S().submissions = rows.filter(row => !S()._deletedSubmissionIds?.has(String(row.id))).map(row => {
          const next = queueRecord(row), existing = previous.get(next.id);
          // Refreshing the list cannot replace the active submission's newer in-memory source.
          if (existing && existing.id === active) return existing;
          return next;
        });
        S()._queueHydrating = false; ready = true; render();
        try {
          const settings = await W.sbLoadSettings(); assertOwner(owner);
          W.__STM_NATIVE_CORE?.applySettings?.(settings);
        } catch (error) { assertOwner(owner); report(new Error('Your queue loaded, but settings could not be loaded. ' + (error.message || 'Retry later.'))); }
        if (routePending) {
          routePending = false;
          try { await restoreRoute(true); assertOwner(owner); }
          catch (error) { assertOwner(owner); report(error); show('queue',true); }
        }
        render();
        return S().submissions;
      } catch (error) {
        if (!isOwner(owner)) throw stale();
        S()._queueHydrating = false; S()._queueError = error.message || 'Your queue could not be loaded.';
        lastError = S()._queueError; render();
        throw error;
      }
    })();
    hydratePromise = task;
    try { return await task; } finally { if (hydratePromise === task) hydratePromise = null; }
  }
  function transition(fn, latest, allowUnready = false) {
    const owner = captureOwner(), ticket = latest ? ++intent : null;
    const check = () => {
      assertOwner(owner);
      if (ticket !== null && ticket !== intent) { const e = new Error('A newer navigation request replaced this one.'); e.code = 'STM_SUPERSEDED'; throw e; }
    };
    queued++; notify();
    const result = tail.catch(() => {}).then(async () => {
      check();
      if (allowUnready) { if (!authenticated) throw new Error('You are already signed out.'); }
      else assertReady(owner);
      ensureIdle(); lastError = ''; return fn(owner, check);
    }).catch(error => { if (!isOwner(owner)) throw stale(); throw error; });
    tail = result.catch(() => {});
    return result.finally(() => { if (isOwner(owner)) { queued = Math.max(0,queued - 1); notify(); } });
  }
  function slimFiles(files) {
    return (files || []).map(file => {
      const result = clone({...file, _rawFile:undefined});
      if (result.extractMeta?.pageTexts?.length) { result.text = ''; result.textDropped = true; }
      delete result.pageTexts; delete result._rawFile;
      return result;
    });
  }
  function hasDraft() {
    const state = S();
    return !!(state._nativeDocumentDraft || state.files.length || Object.keys(state.extractions).length || Object.keys(state.edits).length || state.customCards.length || Object.keys(state.hiddenCards).length);
  }
  async function saveActive(owner) {
    assertOwner(owner);
    const state = S();
    if (!state.activeSubmissionId && hasDraft()) {
      // Saving an incomplete intake gets a real submission identity before any context change.
      state.activeSubmissionId = 'SUB-' + (W.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)).toUpperCase();
      state.newSubmissionDraftMode = false; state._nativeDocumentDraft = false;
      W.__STM_SUBMISSION?.promoteDraft?.(state.activeSubmissionId,owner);
    }
    const id = state.activeSubmissionId;
    const summary = W.__STM_SUBMISSION;
    for (;;) {
      if (summary) await summary.flush(); else await W.flushEditsNow?.();
      assertOwner(owner);
      if (!id) { if (hasDraft()) return saveActive(owner); return {mode:'cloud', unchanged:true}; }
      await W.docsView?.design?.flush?.(); assertOwner(owner);
      if (state.activeSubmissionId !== id) throw new Error('Submission changed before Save finished.');
      const revision = summary?.status?.()?.revision;
      const old = state.submissions.find(rec => rec.id === id);
      const rec = old || {id, account:W.deriveAccountName?.() || 'Incomplete submission', status:statuses[0], statusHistory:[], createdAt:Date.now(), modulesRun:Object.keys(state.extractions).length, confidence:0, missingInfo:[]};
      const snapshot = {...clone(rec.snapshot || {}), files:slimFiles(state.files), extractions:clone(state.extractions), edits:clone(state.edits),
        customCards:clone(state.customCards), hiddenCards:clone(state.hiddenCards), handoff:clone(state.handoff), audit:clone(state.audit),
        runTotalCost:state.runTotalCost || 0, pipelineRun:state.pipelineRun, pipelineStart:Number(state.pipelineStart) || 0, _stmRunComplete:!!state.pipelineDone};
      snapshot.derived = {...snapshot.derived, account:rec.account || null, broker:rec.broker || null, effectiveDate:rec.effective || null,
        requestedLimits:rec.requested || null, missingInfo:clone(rec.missingInfo || [])};
      const candidate = {...rec, snapshot, pipelineRun:state.pipelineRun || rec.pipelineRun || null, lastModifiedAt:Date.now()};
      assertOwner(owner);
      const saved = await W.sbSaveSubmission(W.buildSubmissionPayload(candidate, snapshot)); assertOwner(owner);
      if (!saved) throw new Error('Submission was not saved. Retry Save before leaving.');
      if (state.activeSubmissionId !== id) throw new Error('Submission changed while Save was finishing.');
      if (old) Object.assign(old,candidate); else state.submissions.unshift(candidate);
      W.sbInvalidateSubmissionExistsCache?.(id);
      // Editing remains usable while a request is in flight. A later revision may
      // already have autosaved before this older full snapshot was acknowledged;
      // write current state again even when that newer revision is marked saved.
      const current = summary?.status?.();
      if (current && (current.revision !== revision || current.dirty || current.saving)) continue;
      render();
      return {mode:'cloud', id};
    }
  }
  async function openInside(id, target, owner, check, replace) {
    check();
    const rec = S().submissions.find(item => item.id === String(id));
    if (!rec) throw new Error('This submission is not in your signed-in queue.');
    if (S().activeSubmissionId !== rec.id) {
      await saveActive(owner); check();
      let snapshot = rec.snapshot;
      if (!snapshot) { snapshot = await W.sbFetchSubmissionSnapshot(rec.id); check(); }
      if (!snapshot) throw new Error('This submission has no saved source snapshot.');
      const [edits,feedback] = await Promise.all([W.sbLoadEdits(rec.id),W.sbLoadFeedbackForSubmission(rec.id)]); check();
      // A remains editable while B's source loads. Flush A again immediately
      // before retiring its editor so edits made during those reads are durable.
      ensureIdle(); await saveActive(owner); check(); ensureIdle();
      // Fetch first; only retire the current editor once the target is available.
      W.__STM_SUBMISSION?.abandonContext?.();
      rec.snapshot = snapshot;
      await W.__STM_NATIVE_CORE.hydrate(rec.id, owner, {edits,feedback}); check();
      if (S().activeSubmissionId !== rec.id) throw new Error('The selected submission did not finish opening.');
      W.__STM_SUBMISSION?.context?.();
    }
    check();
    show(target || (S().pipelineDone ? 'summary' : 'pipeline'), replace);
    return rec;
  }
  function open(id, target, replace) { return transition((owner,check) => openInside(id,target && normalize(target),owner,check,replace), true); }
  function newSubmission() {
    return transition(async (owner,check) => {
      await saveActive(owner); check();
      W.__STM_SUBMISSION?.abandonContext?.();
      await W.__STM_NATIVE_CORE.newSubmission(owner); check();
      W.docsView?.setSubmissionContext?.('__stm_draft_' + epoch, 'New submission');
      W.__STM_SUBMISSION?.context?.();
      show('pipeline');
      return true;
    }, true);
  }
  function changeStatus(id, value) {
    return transition(async (owner,check) => {
      if (!statuses.includes(value)) throw new Error('Choose a valid submission status.');
      let rec = S().submissions.find(item => item.id === String(id));
      if (!rec) throw new Error('This submission is no longer in your queue.');
      if (rec.status === value) { W.closeAllStatusMenus?.(); return rec; }
      if (rec.id === S().activeSubmissionId) { await saveActive(owner); check(); rec = S().submissions.find(item => item.id === String(id)); }
      let snapshot = rec.snapshot;
      if (!snapshot) { snapshot = await W.sbFetchSubmissionSnapshot(rec.id); check(); }
      if (!snapshot) throw new Error('Could not load the saved submission. Status was not changed.');
      const now = Date.now(), next = {...rec, snapshot, status:value, lastModifiedAt:now,
        statusHistory:[...(rec.statusHistory || []), {from:rec.status, to:value, at:now, actor:W.currentUser?.display_name || W.currentUser?.email || 'User'}]};
      const saved = await W.sbSaveSubmission(W.buildSubmissionPayload(next,snapshot)); check();
      if (!saved) throw new Error('Status was not saved. Retry the change.');
      Object.assign(rec,next);
      W.closeAllStatusMenus?.(); W.updateDecisionPane?.();
      W.logAudit?.('Submissions', rec.id + ' · status ' + value, 'ok');
      W.toast?.('Status saved · ' + value.toLowerCase(), 'success'); render();
      return rec;
    }, false);
  }
  function deleteSubmission(id, confirmAlready) {
    return transition(async (owner,check) => {
      const rec = S().submissions.find(item => item.id === String(id));
      if (!rec) throw new Error('This submission is no longer in your queue.');
      if (!confirmAlready && !W.confirm('Delete ' + (rec.account || rec.id) + ' from the queue? This cannot be undone.')) return false;
      const active = S().activeSubmissionId === rec.id;
      if (active) { await saveActive(owner); check(); }
      const deleted = await W.sbDeleteSubmission(rec.id); check();
      if (!Array.isArray(deleted) || !deleted.length) throw new Error('The cloud did not confirm deletion. Your queue was kept.');
      (S()._deletedSubmissionIds ||= new Set()).add(rec.id);
      S().submissions = S().submissions.filter(item => item.id !== rec.id);
      W.docsView?.pruneSubmission?.(rec.id);
      if (active) {
        W.__STM_SUBMISSION?.abandonContext?.({discardRecovery:true});
        await W.__STM_NATIVE_CORE.newSubmission(owner); check();
        W.docsView?.setSubmissionContext?.('__stm_draft_' + epoch, 'New submission');
      }
      show('queue'); render(); W.toast?.('Deleted · ' + (rec.account || rec.id), 'success');
      return true;
    }, false);
  }
  function normalize(value) {
    const key = String(value || '').replace(/^#\/?/,'').toLowerCase();
    return ({'sub-pipe':'pipeline','sub-sum':'summary','sub-docs':'documents',submission:'pipeline',pipe:'pipeline',sum:'summary',docs:'documents',filemanager:'documents',files:'documents',
      'submission/pipeline':'pipeline','submission/summary':'summary','submission/documents':'documents'})[key] || (hashes[key] || key === 'workbench' ? key : 'queue');
  }
  function destination() {
    const url = new URL(location.href);
    const requested = url.searchParams.get('stm_route') || url.hash;
    return {target:normalize(requested), id:url.searchParams.get('submissionId') || url.searchParams.get('submission') || null};
  }
  function writeLocation(target, replace) {
    const url = new URL(location.href);
    for (const key of ['submission','submissionId','stm_route']) url.searchParams.delete(key);
    if (S().activeSubmissionId) url.searchParams.set('submissionId',S().activeSubmissionId);
    url.hash = hashes[target] || hashes.queue;
    const next = url.pathname + url.search + url.hash;
    if (next !== location.pathname + location.search + location.hash) history[replace ? 'replaceState' : 'pushState']({stm:true},'',next);
  }
  function show(target, replace) {
    assertOwner(); target = normalize(target);
    if (target === 'admin' && W.currentUser?.role !== 'admin') throw new Error('Administrator access is required.');
    route = target;
    W.switchView(target === 'queue' || target === 'admin' ? target : 'submission');
    if (['pipeline','summary','documents'].includes(target)) W.showStage({pipeline:'pipe',summary:'sum',documents:'docs'}[target], {fastNav:true});
    writeLocation(target, replace); notify();
  }
  function navigate(target, replace) {
    target = normalize(target);
    return transition(async (owner,check) => {
      if (target === 'admin' && W.currentUser?.role !== 'admin') throw new Error('Administrator access is required.');
      if (target === 'workbench') {
        await saveActive(owner); check();
        const url = new URL('workbench.html',location.href);
        if (S().activeSubmissionId) url.searchParams.set('submissionId',S().activeSubmissionId);
        location.assign(url.href);
        return;
      }
      if ((target === 'queue' || target === 'admin') && (S().activeSubmissionId || hasDraft())) {
        await saveActive(owner); check();
      }
      if (S().activeSubmissionId || hasDraft()) await W.docsView?.design?.flush?.(); check(); show(target, replace);
    }, true);
  }
  async function restoreRoute(initial) {
    if (!ready || !authenticated) { routePending = true; return false; }
    const wanted = initial ? desiredAtBoot : destination();
    if (wanted.id && wanted.id !== S().activeSubmissionId) return open(wanted.id,wanted.target,true);
    return navigate(wanted.target,true);
  }
  function save() { return transition((owner) => saveActive(owner), false); }
  function signOut() {
    return transition(async (owner,check) => {
      await saveActive(owner); check();
      const result = await W.sb.auth.signOut();
      if (result.error) throw result.error;
      acceptIdentity(null);
      return true;
    }, false, true);
  }
  async function sendMagicLink() {
    const email = (document.getElementById('authEmail')?.value || '').trim();
    const errorEl = document.getElementById('authError'), okEl = document.getElementById('authSuccess'), button = document.getElementById('authSendBtn');
    if (errorEl) errorEl.textContent = ''; if (okEl) okEl.textContent = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { if (errorEl) errorEl.textContent = 'Enter a valid email address.'; return false; }
    const url = new URL('platform.html',location.href), wanted = destination();
    url.searchParams.set('stm_route',hashes[wanted.target] || hashes.queue);
    if (wanted.id) url.searchParams.set('submissionId',wanted.id);
    if (button) button.disabled = true;
    try {
      const result = await W.sb.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:url.href}});
      if (result.error) throw result.error;
      if (okEl) okEl.textContent = 'If that email is registered, you will receive a sign-in link shortly.';
      return true;
    } catch (error) { if (errorEl) errorEl.textContent = 'Could not send the sign-in link. Please retry.'; return false; }
    finally { if (button) button.disabled = false; }
  }
  const API = W.__STM_NATIVE_PLATFORM = {
    captureOwner, assertOwner, isOwner, authEvent, checkAuth, hydrate, open, newSubmission, status:changeStatus, deleteSubmission, navigate, restoreRoute, save, saveActive, signOut, sendMagicLink,
    handle, report, slimFiles, queueRecord, statuses:Object.freeze(statuses),
    get busy() { return queued > 0 || !!W.__STM_NATIVE_PIPELINE?.busy || !!W.__STM_SUBMISSION?.busy || !!S()?.pipelineRunning; },
    get epoch() { return epoch; }, get userId() { return userId; }, get ready() { return ready && authenticated; },
    get state() { return {userId,epoch,ready:ready && authenticated,authenticated,busy:queued > 0,route,error:lastError,loading:!!S()?._queueHydrating}; }
  };
  const subscribe = W.stmAuth?.onChange ? W.stmAuth.onChange.bind(W.stmAuth) : cb => W.sb.auth.onAuthStateChange(cb);
  subscribe(authEvent);
  W.addEventListener('popstate', () => handle(restoreRoute(false)));
  W.addEventListener('hashchange', () => handle(restoreRoute(false)));
  // Genuine existing navigation controls use the same coordinator as the redesigned shell.
  document.addEventListener('click', event => {
    const el = event.target.closest('button.tab[data-view],#stageTabPipe,#stageTabSum,#stageTabDocs,.topbar-workbench-btn');
    if (!el) return;
    const target = el.dataset.view || ({stageTabPipe:'pipeline',stageTabSum:'summary',stageTabDocs:'documents'})[el.id] || 'workbench';
    event.preventDefault(); event.stopImmediatePropagation(); handle(navigate(target));
  }, true);
  if (document.readyState !== 'loading') handle(checkAuth());
})();
