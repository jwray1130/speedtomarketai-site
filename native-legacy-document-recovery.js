/* Migration proposal only. Supply the current native journal's validateEntry.
 * No application globals/data adapters are replaced by this module. */
(function (global) {
  'use strict';
  const LEGACY = 'stm-v94-documents:', NATIVE = 'stm-native-documents:v1:';
  const LIMIT = 10 * 1024 * 1024;
  const plain = value => !!value && Object.getPrototypeOf(value) === Object.prototype;
  const fail = (text, code = 'STM_DOC_MIGRATION_INVALID') => Object.assign(new Error(text), { code });
  const bytes = text => new TextEncoder().encode(text);
  // Synchronous SHA-256 keeps the journal's synchronous first-read contract.
  // No cryptographic authentication is inferred: this fingerprint only detects
  // whether the legacy source has changed since it was imported.
  function sha256(text) {
    const input = bytes(text), length = Math.ceil((input.length + 9) / 64) * 64;
    const buffer = new Uint8Array(length); buffer.set(input); buffer[input.length] = 128;
    const view = new DataView(buffer.buffer), bits = input.length * 8;
    view.setUint32(length - 8, Math.floor(bits / 4294967296)); view.setUint32(length - 4, bits >>> 0);
    const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const rotr = (x, n) => (x >>> n) | (x << (32 - n)), w = new Uint32Array(64);
    for (let offset = 0; offset < length; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15], y = w[i - 2];
        w[i] = w[i - 16] + (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) + w[i - 7] + (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10));
      }
      let [a,b,c,d,e,f,g,h] = hash;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e,6) ^ rotr(e,11) ^ rotr(e,25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((rotr(a,2) ^ rotr(a,13) ^ rotr(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
      }
      [a,b,c,d,e,f,g,h].forEach((value, i) => { hash[i] = (hash[i] + value) >>> 0; });
    }
    return [...hash].map(value => value.toString(16).padStart(8, '0')).join('');
  }
  function createLegacyDocumentRecovery({ storage, validateEntry, assertOwner, maxBytes = LIMIT }) {
    if (!storage || typeof validateEntry !== 'function' || typeof assertOwner !== 'function') throw fail('Document migration dependencies are missing.');
    const ownerId = token => {
      assertOwner(token);
      const id = typeof token === 'string' ? token : token?.userId;
      if (typeof id !== 'string' || !id.trim()) throw fail('Sign in before reading document recovery.');
      return id;
    };
    const keys = owner => ({ native: NATIVE + encodeURIComponent(owner), legacy: LEGACY + encodeURIComponent(owner) });
    function readJson(raw, description) {
      if (typeof raw !== 'string' || bytes(raw).length > maxBytes) throw fail(description + ' exceeds the 10 MiB recovery limit. Keep the original recovery data.', 'STM_DOC_MIGRATION_LIMIT');
      let value; try { value = JSON.parse(raw); } catch (_) { throw fail(description + ' is not valid JSON. Original recovery data has been retained.'); }
      return value;
    }
    function validateMeta(meta, owner) {
      if (!plain(meta) || meta.schema !== 1 || meta.sourceKey !== keys(owner).legacy || !/^[0-9a-f]{64}$/.test(meta.sourceSHA256 || '') || !Number.isSafeInteger(meta.sourceBytes) || meta.sourceBytes < 1 || meta.sourceBytes > maxBytes || !Number.isSafeInteger(meta.entryCount) || meta.entryCount < 0 || !['pending', 'acknowledged'].includes(meta.state) || (meta.notice !== undefined && typeof meta.notice !== 'string')) throw fail('Invalid legacy document migration receipt. Original recovery data has been retained.');
      return meta;
    }
    function validateEnvelope(envelope, owner, legacy = false) {
      if (!plain(envelope) || envelope.schema !== 1 || envelope.owner !== owner || !Array.isArray(envelope.pending)) throw fail('Document recovery has an invalid schema or owner. Original recovery data has been retained.');
      const seen = new Set(), entries = [];
      for (const old of envelope.pending) {
        if (!plain(old)) throw fail('Invalid legacy document change. Original recovery data has been retained.');
        // RC1 stash omits running/promise/timer. Its persistent args and record
        // use the same native shapes; normalize only optional record/error.
        const entry = legacy ? { seq: old.seq, id: old.id, owner: old.owner, sid: old.sid, kind: old.kind,
          args: old.args, record: old.record ?? null, error: old.error ?? 'Imported unsynced RC1 document change' } : old;
        validateEntry(entry, owner);
        if (seen.has(entry.seq)) throw fail('Duplicate legacy document sequence. Original recovery data has been retained.');
        seen.add(entry.seq); entries.push(entry);
      }
      if (envelope.legacyMigration !== undefined) validateMeta(envelope.legacyMigration, owner);
      return entries.sort((a, b) => a.seq - b.seq);
    }
    function stringify(envelope) {
      const raw = JSON.stringify(envelope);
      if (bytes(raw).length > maxBytes) throw fail('Converted document recovery exceeds the 10 MiB limit. Original recovery data has been retained.', 'STM_DOC_MIGRATION_LIMIT');
      return raw;
    }
    function prepare(token) {
      const owner = ownerId(token), names = keys(owner), current = storage.getItem(names.native);
      if (current !== null) return { kind: 'native-exists', key: names.native, raw: current };
      const sourceRaw = storage.getItem(names.legacy);
      if (sourceRaw === null) return { kind: 'none' };
      const legacy = readJson(sourceRaw, 'RC1 document recovery'), pending = validateEnvelope(legacy, owner, true);
      const migration = { schema: 1, sourceKey: names.legacy, sourceSHA256: sha256(sourceRaw), sourceBytes: bytes(sourceRaw).length, entryCount: pending.length, state: 'pending' };
      const envelope = { schema: 1, owner, pending, legacyMigration: migration }, raw = stringify(envelope);
      assertOwner(token);
      return { kind: 'import', key: names.native, legacyKey: names.legacy, owner, token, sourceRaw, raw, envelope };
    }
    function commit(candidate) {
      if (candidate?.kind !== 'import') return candidate;
      const owner = ownerId(candidate.token);
      if (candidate.owner !== owner || candidate.key !== keys(owner).native || candidate.legacyKey !== keys(owner).legacy) throw fail('Document migration owner changed.');
      if (storage.getItem(candidate.key) !== null) throw fail('Native document recovery appeared during migration. Re-read it; nothing was overwritten.', 'STM_DOC_MIGRATION_RETRY');
      if (storage.getItem(candidate.legacyKey) !== candidate.sourceRaw) throw fail('RC1 document recovery changed during migration. Re-read it; nothing was overwritten.', 'STM_DOC_MIGRATION_RETRY');
      const envelope = readJson(candidate.raw, 'Native document recovery'); validateEnvelope(envelope, owner);
      validateMeta(envelope.legacyMigration, owner);
      if (envelope.legacyMigration.sourceSHA256 !== sha256(candidate.sourceRaw)) throw fail('Legacy recovery fingerprint changed.');
      try { storage.setItem(candidate.key, candidate.raw); }
      catch (_) { throw fail('Local storage cannot hold the migrated recovery. Original RC1 recovery is intact. Keep this tab open and make space before retrying.', 'STM_DOC_MIGRATION_QUOTA'); }
      assertOwner(candidate.token);
      // Never remove the legacy source here. It protects failed initial writes.
      return { kind: 'imported', key: candidate.key, raw: candidate.raw, envelope };
    }
    function acknowledge(token, { removeLegacy = true } = {}) {
      const owner = ownerId(token), names = keys(owner), before = storage.getItem(names.native);
      if (before === null) throw fail('Migration receipt is missing; keep the original RC1 recovery.');
      const envelope = readJson(before, 'Native document recovery'); validateEnvelope(envelope, owner);
      const meta = validateMeta(envelope.legacyMigration, owner);
      if (envelope.pending.length) throw fail('Document changes are still pending. RC1 recovery must remain intact.', 'STM_DOC_MIGRATION_PENDING');
      const legacyRaw = storage.getItem(names.legacy);
      const same = legacyRaw === null || (bytes(legacyRaw).length === meta.sourceBytes && sha256(legacyRaw) === meta.sourceSHA256);
      const notice = same ? '' : 'RC1 document recovery changed after import. That original has been retained and will not be automatically replayed over native changes.';
      const receipt = stringify({ ...envelope, legacyMigration: { ...meta, state: 'acknowledged', notice } });
      assertOwner(token);
      if (storage.getItem(names.native) !== before) throw fail('Native recovery changed before acknowledgement. Retry after its writes settle.', 'STM_DOC_MIGRATION_RETRY');
      // Durable acknowledgement comes FIRST. If old-key removal fails, the small
      // receipt still prevents stale RC1 changes from being imported on reload.
      try { storage.setItem(names.native, receipt); }
      catch (_) { throw fail('Could not store the migration acknowledgement. RC1 recovery has been retained. Keep this tab open.', 'STM_DOC_MIGRATION_QUOTA'); }
      assertOwner(token);
      if (!same || !removeLegacy || legacyRaw === null) return { acknowledged: true, legacyRetained: legacyRaw !== null, notice, raw: receipt };
      if (storage.getItem(names.native) !== receipt || storage.getItem(names.legacy) !== legacyRaw) return { acknowledged: true, legacyRetained: true, notice: 'Recovery changed during cleanup; the RC1 original has been retained.', raw: receipt };
      try { storage.removeItem(names.legacy); }
      catch (_) { return { acknowledged: true, legacyRetained: true, notice: 'The saved RC1 recovery could not be removed. The native receipt prevents replay.', raw: receipt }; }
      return { acknowledged: true, legacyRetained: false, notice: '', raw: receipt };
    }
    return { prepare, commit, acknowledge, validateMeta, validateEnvelope, sha256, keys };
  }
  global.STMLegacyDocumentRecovery = createLegacyDocumentRecovery;
  if (typeof module === 'object' && module.exports) module.exports = createLegacyDocumentRecovery;
})(typeof globalThis === 'object' ? globalThis : window);
