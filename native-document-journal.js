/* Owner-scoped document recovery and ordered, acknowledged cloud writes. */
(function () {
  'use strict';
  if (window.__STM_DOC_JOURNAL?.native) return;
  const originals = {
    insert: window.sbInsertDocumentPage,
    patch: window.sbUpdateDocumentPage,
    remove: window.sbDeleteDocumentPage,
  };
  const LIMIT = 10 * 1024 * 1024;
  const PREFIX = 'stm-native-documents:v1:';
  const OMIT = new Set(['el', 'pdfData', 'highResData', 'nativeDataUrl', '_rawFile', '_persistPromise']);
  const PATCH_FIELDS = new Set(['submission_id', 'display_name', 'category', 'color', 'tagged',
    'pipeline_classification', 'pipeline_routed_to', 'pipeline_tag', 'primary_bucket',
    'relabeled_by_user', 'extracted_text', 'html_content', 'thumbnail_data_url', 'annotations']);
  const bags = new Map();
  let active = null, generation = 0, retired = false, tail = Promise.resolve(), queued = 0;
  const platform = () => window.__STM_NATIVE_PLATFORM;
  const plain = value => !!value && Object.getPrototypeOf(value) === Object.prototype;
  const nonempty = value => typeof value === 'string' && value.trim().length > 0;
  const nullableId = value => value === null || nonempty(value);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const storageKey = owner => PREFIX + encodeURIComponent(owner);
  const size = value => new TextEncoder().encode(value).byteLength;
  const message = error => error?.message || String(error);
  function error(text, code) { return Object.assign(new Error(text), { code }); }
  function safe(value) {
    return JSON.parse(JSON.stringify(value, (key, v) => {
      if (OMIT.has(key)) return undefined;
      if (typeof v === 'number' && !Number.isFinite(v)) throw error('Document recovery contains an invalid number.', 'STM_DOC_INVALID');
      return v;
    }));
  }
  function assertTree(value, depth = 0) {
    if (depth > 40) throw error('Document recovery is nested too deeply.', 'STM_DOC_INVALID');
    if (value === null || ['string', 'boolean'].includes(typeof value)) return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (Array.isArray(value)) { value.forEach(x => assertTree(x, depth + 1)); return; }
    if (!plain(value)) throw error('Invalid document recovery value.', 'STM_DOC_INVALID');
    for (const [key, val] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || OMIT.has(key)) throw error('Unsafe document recovery field.', 'STM_DOC_INVALID');
      assertTree(val, depth + 1);
    }
  }
  function validatePatch(patch) {
    if (!plain(patch) || !Object.keys(patch).length) throw error('A document patch is required.', 'STM_DOC_INVALID');
    for (const [key, value] of Object.entries(patch)) {
      if (!PATCH_FIELDS.has(key)) throw error('Unsupported document field: ' + key, 'STM_DOC_INVALID');
      if (key === 'submission_id' && !nullableId(value)) throw error('Invalid submission reference.', 'STM_DOC_INVALID');
      if (['tagged', 'relabeled_by_user'].includes(key) && typeof value !== 'boolean') throw error('Invalid document flag.', 'STM_DOC_INVALID');
      if (key === 'annotations') {
        if (!plain(value) || !Array.isArray(value.layers) || !Array.isArray(value.undone)) throw error('Invalid document annotations.', 'STM_DOC_INVALID');
      } else if (!['tagged', 'relabeled_by_user', 'submission_id'].includes(key) && !(value === null || typeof value === 'string')) {
        throw error('Invalid document field value: ' + key, 'STM_DOC_INVALID');
      }
    }
  }
  function validRecord(record, id, owner) {
    if (!plain(record) || record.id !== id || !nullableId(record.submissionId ?? null)) throw error('Mismatched document recovery record.', 'STM_DOC_INVALID');
    if (record.user_id != null && record.user_id !== owner) throw error('Document recovery belongs to another owner.', 'STM_DOC_INVALID');
    if (record.storagePath != null && (!nonempty(record.storagePath) || !record.storagePath.startsWith(owner + '/'))) throw error('Document source belongs to another owner.', 'STM_DOC_INVALID');
    for (const key of ['pageNumber', 'totalPages']) if (record[key] != null && (!Number.isSafeInteger(record[key]) || record[key] < 1)) throw error('Invalid recovered page number.', 'STM_DOC_INVALID');
  }
  function validateEntry(item, owner) {
    assertTree(item);
    if (!plain(item) || !Number.isSafeInteger(item.seq) || item.seq < 1 || !nonempty(item.id) || item.owner !== owner || !nullableId(item.sid) || !['insert', 'patch', 'remove'].includes(item.kind) || !Array.isArray(item.args)) throw error('Invalid document recovery entry.', 'STM_DOC_INVALID');
    if (item.kind === 'insert') {
      if (item.args.length !== 1) throw error('Invalid insertion recovery.', 'STM_DOC_INVALID');
      validRecord(item.args[0], item.id, owner);
      if ((item.args[0].submissionId ?? null) !== item.sid) throw error('Mismatched insertion submission.', 'STM_DOC_INVALID');
    } else if (item.kind === 'patch') {
      if (item.args.length !== 2 || item.args[0] !== item.id) throw error('Invalid patch recovery.', 'STM_DOC_INVALID');
      validatePatch(item.args[1]);
      if (own(item.args[1], 'submission_id') && item.args[1].submission_id !== item.sid) throw error('Mismatched promotion recovery.', 'STM_DOC_INVALID');
    } else if (item.args.length !== 2 || item.args[0] !== item.id || !(item.args[1] === null || (nonempty(item.args[1]) && item.args[1].startsWith(owner + '/')))) throw error('Invalid deletion recovery.', 'STM_DOC_INVALID');
    if (item.record !== null) validRecord(item.record, item.id, owner);
    if (item.record && (item.record.submissionId ?? null) !== item.sid) throw error('Mismatched document recovery scope.', 'STM_DOC_INVALID');
    if (typeof item.error !== 'string') throw error('Invalid recovery status.', 'STM_DOC_INVALID');
  }
  function persisted(item) {
    return { seq: item.seq, id: item.id, owner: item.owner, sid: item.sid, kind: item.kind,
      args: safe(item.args), record: item.record ? safe(item.record) : null, error: item.error || '' };
  }
  const legacyRecovery = window.STMLegacyDocumentRecovery({ storage: localStorage, validateEntry,
    assertOwner: token => platform().assertOwner(token), maxBytes: LIMIT });
  function loadBag(ownerToken) {
    const owner = ownerToken.userId;
    if (bags.has(owner)) return bags.get(owner);
    const bag = { owner, pending: new Map(), sequence: 0, revision: 0, localError: '', recoveryError: '' };
    bags.set(owner, bag);
    try {
      const migration = legacyRecovery.prepare(ownerToken);
      if (migration.kind === 'import') legacyRecovery.commit(migration);
      const raw = localStorage.getItem(storageKey(owner));
      if (raw === null) return bag;
      if (size(raw) > LIMIT) throw error('Document recovery exceeds the 10 MiB limit.', 'STM_DOC_RECOVERY_LIMIT');
      const envelope = JSON.parse(raw);
      if (!plain(envelope) || envelope.schema !== 1 || envelope.owner !== owner || !Array.isArray(envelope.pending)) throw error('Invalid document recovery envelope.', 'STM_DOC_INVALID');
      assertTree(envelope);
      if (envelope.legacyMigration) {
        legacyRecovery.validateMeta(envelope.legacyMigration, owner);
        bag.legacyMigration = safe(envelope.legacyMigration);
      }
      const items = new Map();
      for (const item of envelope.pending) {
        validateEntry(item, owner);
        if (items.has(item.seq)) throw error('Duplicate document recovery revision.', 'STM_DOC_INVALID');
        items.set(item.seq, { ...item, error: item.error || 'Recovered document change awaiting cloud sync.', running: false });
      }
      bag.pending = items;
      bag.sequence = Math.max(0, ...items.keys());
    } catch (cause) {
      bag.recoveryError = 'Document recovery could not be read: ' + message(cause) + ' Original recovery data has been retained.';
    }
    return bag;
  }
  function stashBag(bag) {
    if (!bag || bag.recoveryError) return false;
    try {
      if (bag.pending.size || bag.legacyMigration) {
        const pending = [...bag.pending.values()].sort((a, b) => a.seq - b.seq).map(persisted);
        for (const item of pending) validateEntry(item, bag.owner);
        const raw = JSON.stringify({ schema: 1, owner: bag.owner, pending,
          ...(bag.legacyMigration ? { legacyMigration: bag.legacyMigration } : {}) });
        if (size(raw) > LIMIT) throw error('Document recovery exceeds 10 MiB.', 'STM_DOC_RECOVERY_LIMIT');
        localStorage.setItem(storageKey(bag.owner), raw);
      } else localStorage.removeItem(storageKey(bag.owner));
      bag.localError = '';
      return true;
    } catch (cause) {
      bag.localError = message(cause) + ' Local document recovery is unavailable. Keep this tab open and retry cloud sync.';
      return false;
    }
  }
  function notify(bag) {
    if (bag) { bag.revision++; stashBag(bag); }
    window.dispatchEvent(new CustomEvent('stm:documents-change'));
  }
  function currentOwner() {
    const p = platform();
    if (!p) throw error('Platform session is not ready.', 'STM_DOC_NOT_READY');
    const owner = p.captureOwner();
    p.assertOwner(owner);
    if (!owner?.userId || window.currentUser?.id !== owner.userId) throw error('Sign in before changing documents.', 'STM_DOC_NOT_READY');
    return owner;
  }
  function ensure() {
    if (retired) throw error('Document session was retired. Reopen the current submission.', 'STM_STALE_OWNER');
    const owner = currentOwner();
    if (!active) active = { owner, generation: ++generation, bag: loadBag(owner) };
    platform().assertOwner(active.owner);
    if (active.owner.userId !== owner.userId || active.owner.epoch !== owner.epoch) throw error('Document session belongs to a previous sign-in.', 'STM_STALE_OWNER');
    return active;
  }
  function capture() { const ctx = ensure(); return Object.freeze({ owner: ctx.owner, generation: ctx.generation }); }
  function assertContext(token) {
    platform().assertOwner(token.owner);
    if (retired || !active || active.generation !== token.generation || active.owner.epoch !== token.owner.epoch) throw error('Document operation belongs to a previous session.', 'STM_STALE_OWNER');
    return active.bag;
  }
  function lookup(id) { return window.docsView?.design?.record(id) || window.docsView?.getDocs?.().find(d => d.id === id) || null; }
  async function perform(item, token, bag) {
    assertContext(token);
    if (!bag.pending.has(item.seq)) return;
    item.running = true;
    notify(bag);
    try {
      if (typeof originals[item.kind] !== 'function') throw error('Document cloud adapter is unavailable.', 'STM_DOC_NOT_READY');
      const result = await originals[item.kind].apply(window, item.args);
      assertContext(token);
      if (result === null || result === false || result === undefined) throw error('Cloud did not acknowledge document ' + item.kind + '. Retry sync; the change is retained.', 'STM_DOC_UNACKNOWLEDGED');
      bag.pending.delete(item.seq);
      notify(bag);
      return result;
    } catch (cause) {
      item.error = message(cause);
      notify(bag);
      throw cause;
    } finally { item.running = false; notify(bag); }
  }
  function schedule(token, through = Infinity) {
    const bag = assertContext(token);
    queued++;
    const next = tail.catch(() => {}).then(async () => {
      assertContext(token);
      if (bag.recoveryError) throw error(bag.recoveryError, 'STM_DOC_RECOVERY_BLOCKED');
      for (;;) {
        const item = [...bag.pending.values()].sort((a, b) => a.seq - b.seq).find(x => x.seq <= through);
        if (!item) break;
        await perform(item, token, bag);
      }
      assertContext(token);
      if (!stashBag(bag)) throw error(bag.localError, 'STM_DOC_RECOVERY_UNAVAILABLE');
      if (!bag.pending.size && bag.legacyMigration) {
        try {
          const receipt = legacyRecovery.acknowledge(token.owner, { removeLegacy: false });
          bag.legacyMigration = JSON.parse(receipt.raw).legacyMigration;
        } catch (cause) {
          bag.localError = message(cause) + ' Keep this tab open and retry saving document recovery.';
          throw cause;
        }
      }
      return { mode: 'cloud' };
    }).finally(() => { queued--; window.dispatchEvent(new CustomEvent('stm:documents-change')); });
    tail = next.catch(() => {});
    return next;
  }
  function enqueue(kind, args, token = capture()) {
    const bag = assertContext(token);
    if (bag.recoveryError) return Promise.reject(error(bag.recoveryError, 'STM_DOC_RECOVERY_BLOCKED'));
    const copied = safe(args), id = kind === 'insert' ? copied[0]?.id : copied[0];
    const record = kind === 'insert' ? copied[0] : safe(lookup(id));
    if (!record && kind !== 'remove') return Promise.reject(error('Document is unavailable in the current session.', 'STM_DOC_NOT_FOUND'));
    const sid = kind === 'patch' && own(copied[1], 'submission_id') ? copied[1].submission_id : record?.submissionId ?? null;
    if (record) record.submissionId = sid;
    const item = { seq: ++bag.sequence, id, owner: bag.owner, sid, kind, args: copied, record, error: '', running: false };
    validateEntry(persisted(item), bag.owner);
    // Adjacent pending annotation/metadata changes can share one acknowledged update.
    const last = [...bag.pending.values()].at(-1);
    if (kind === 'patch' && last?.kind === 'patch' && last.id === id && last.sid === sid && !last.running) {
      last.args[1] = { ...last.args[1], ...copied[1] }; last.record = record; last.error = '';
      notify(bag);
      return schedule(token, last.seq);
    }
    bag.pending.set(item.seq, item);
    notify(bag);
    return schedule(token, item.seq);
  }
  function status() {
    try { if (!active && !retired) ensure(); } catch (_) {}
    const bag = active?.bag;
    return { owner: bag?.owner || null, dirty: !!(bag?.pending.size || bag?.recoveryError || bag?.localError),
      pending: bag?.pending.size || 0, inFlight: [...(bag?.pending.values() || [])].filter(x => x.running).length,
      error: bag?.recoveryError || [...(bag?.pending.values() || [])].find(x => x.error)?.error || '',
      localError: bag?.localError || '', recoveryBlocked: !!bag?.recoveryError, revision: bag?.revision || 0,
      recoveryNotice: bag?.legacyMigration?.notice || '',
      retired, busy: queued > 0 };
  }
  async function retire() {
    retired = true;
    generation++;
    stashBag(active?.bag);
    // In-flight requests may complete for their captured owner. Never apply their result
    // to a later epoch, and never let a queued request begin under that later epoch.
    await tail;
    stashBag(active?.bag);
  }
  async function resume() {
    const owner = currentOwner();
    await tail;
    platform().assertOwner(owner);
    active = { owner, generation: ++generation, bag: loadBag(owner) };
    retired = false;
    notify(active.bag);
    return status();
  }
  async function promoteDraft(sid, ids, ownerToken) {
    if (!nonempty(sid) || !Array.isArray(ids)) throw error('Draft promotion needs a submission and exact page IDs.', 'STM_DOC_INVALID');
    if (ownerToken) platform().assertOwner(ownerToken);
    const token = capture(), bag = assertContext(token);
    await tail;
    assertContext(token);
    // Parent submission must already exist in the cloud (document_pages FK).
    const unique = [...new Set(ids)];
    for (const id of unique) {
      const doc = lookup(id);
      if (!doc || (doc.submissionId != null && doc.submissionId !== sid)) throw error('Draft page belongs to another submission.', 'STM_DOC_INVALID');
      for (const item of bag.pending.values()) if (item.id === id) {
        if (item.sid != null && item.sid !== sid) throw error('Pending document belongs to another submission.', 'STM_DOC_INVALID');
        item.sid = sid;
        if (item.record) item.record.submissionId = sid;
        if (item.kind === 'insert') item.args[0].submissionId = sid;
        if (item.kind === 'patch' && own(item.args[1], 'submission_id')) item.args[1].submission_id = sid;
      }
    }
    notify(bag);
    for (const id of unique) await enqueue('patch', [id, { submission_id: sid }], token);
    return schedule(token);
  }
  window.sbInsertDocumentPage = doc => enqueue('insert', [doc]);
  window.sbUpdateDocumentPage = (id, patch) => enqueue('patch', [id, patch]);
  window.sbDeleteDocumentPage = (id, path) => enqueue('remove', [id, path ?? null]);
  // The July annotation helper may close over its original lexical update function.
  // Wrap it explicitly so no annotation write bypasses the journal.
  window.sbUpdateDocumentAnnotations = (id, store) => enqueue('patch', [id, { annotations: safe(store || {layers:[],undone:[]}) }]);
  window.__STM_DOC_JOURNAL = {
    native: true, status, capture, assertContext, retire, resume, promoteDraft,
    stash: () => stashBag(active?.bag), flush: () => schedule(capture()),
    revision: () => active?.bag.revision || 0,
    entries: () => { const bag = ensure().bag; return [...bag.pending.values()].sort((a, b) => a.seq - b.seq).map(persisted); },
    has: id => !!active?.bag && [...active.bag.pending.values()].some(x => x.id === id),
    pendingFor: id => [...(active?.bag.pending.values() || [])].filter(x => x.id === id).map(x => ({ kind: x.kind, error: x.error })),
    settleInserts: async () => {
      const token = capture(), bag = assertContext(token);
      const max = Math.max(0, ...[...bag.pending.values()].filter(x => x.kind === 'insert').map(x => x.seq));
      if (max) await schedule(token, max);
    },
  };
  window.addEventListener('beforeunload', () => stashBag(active?.bag));
})();
