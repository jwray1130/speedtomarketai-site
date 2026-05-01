// ============================================================================
// supabase-data.js — Altitude / Speed to Market AI
// ============================================================================
// Extracted from app.html as Phase 8 step 3 (maintainability split).
// All Supabase data-access helpers live here: every read, write, hydrate,
// admin query. Loaded via <script src="supabase-data.js"> AFTER the inline
// init script that creates window.sb (the Supabase client).
//
// External globals this file uses at CALL time (must exist by then):
//   window.sb          — Supabase client (created in app.html init script)
//   STATE              — global app state
//   logAudit, toast    — diagnostic helpers
//   escapeHtml         — XSS sanitizer
//   window.currentUser — signed-in user profile
//   renderQueueTable, updateFeedbackCount — render hooks (used in sbHydrate)
//
// All sb* helpers and admin renderers are exported on window so other
// inline code in app.html finds them unchanged.
//
// Phase 8 design rule: byte-for-byte preservation of every function body.
// The ONLY structural change is the bridge line below pointing `sb` at
// `window.sb` so the function bodies (which reference plain `sb`) work
// when this file's scope can't see app.html's `const sb` declaration.
// ============================================================================

// Phase 8 step 3 fix #2: dropped the `const sb = window.sb` bridge entirely.
// Reason: the previous app.html inline init already declares `const sb` at
// top-level AND assigns `window.sb = sb`. Declaring another top-level `const
// sb` in this file races into a SyntaxError ("Identifier 'sb' has already
// been declared") because the global object already has the property. The
// SyntaxError aborts the entire script before any function declarations
// register — which is why all 26 helpers showed up undefined on first
// deploy. Fix: reference `window.sb` directly in every helper body. No
// shadowing, no collision, robust regardless of how the browser scopes us.

// ============================================================================
// SUPABASE DATA-ACCESS HELPERS  (Phase 4 — localStorage → Supabase migration)
// Every other function in the app calls THESE helpers; no other place talks to
// Supabase directly for data. Auth and LLM proxy paths are separate (above).
// ============================================================================

async function sbUser() {
  const { data: { user } } = await window.sb.auth.getUser();
  return user;   // null if signed out
}

// ---- Submissions ----------------------------------------------------------
// One row per submission. The whole per-submission object (files-lite,
// extractions, edits, etc.) goes into the `snapshot` jsonb column.
async function sbLoadSubmissions() {
  // v8.6.1: explicit user_id scope. Previously this relied entirely on
  // RLS to filter results by current user, which is correct in theory
  // but fragile in practice — any RLS policy regression or admin-mode
  // session would silently return other users' rows. Hard-scoping here
  // is defense in depth: even if RLS is misconfigured, the WHERE clause
  // protects the user's view. Per GPT's external audit recommendation.
  const u = await sbUser();
  if (!u) throw new Error('not signed in');
  const { data, error } = await window.sb
    .from('submissions')
    .select('id, snapshot, status, status_history, account_name, broker, effective_date, requested, missing_info, modules_run, confidence, pipeline_run, title, updated_at, created_at')
    .eq('user_id', u.id)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function sbSaveSubmission(sub) {
  const u = await sbUser(); if (!u) throw new Error('not signed in');
  // v8.5.6: tombstone check. If this submission was just deleted in the
  // local UI, refuse to save — otherwise an in-flight save fired before
  // delete propagated would upsert the row right back. Set is populated
  // by deleteSubmission() in app.js. Returns null to match the no-op
  // contract callers already handle gracefully.
  if (sub && sub.id && typeof window !== 'undefined' && window.STATE &&
      window.STATE._deletedSubmissionIds && window.STATE._deletedSubmissionIds.has(sub.id)) {
    console.warn('sbSaveSubmission blocked — submission was deleted: ' + sub.id);
    return null;
  }
  const row = {
    user_id: u.id,
    snapshot: sub.snapshot || null,
    status: sub.status || 'AWAITING UW REVIEW',
    // Phase 7 step 5: status_history is a flat jsonb column on submissions
    // (NOT NULL default '[]'), separate from snapshot, so admin queries can
    // reach into transition history without drilling into the snapshot blob.
    status_history: Array.isArray(sub.statusHistory) ? sub.statusHistory : [],
    // Phase 7 step 6: mirror display/query fields to flat columns. account_name,
    // broker, effective_date, requested, missing_info, modules_run, confidence —
    // all queryable now without JSONB drilling. Sources are sub.* (from rec
    // via buildSubmissionPayload) with sensible defaults for missing/typo'd
    // field names from older callers.
    account_name:   sub.account     || null,
    broker:         sub.broker      || null,
    effective_date: sub.effective   || sub.effectiveDate   || null,
    requested:      sub.requested   || sub.requestedLimits || null,
    missing_info:   Array.isArray(sub.missingInfo) ? sub.missingInfo : [],
    modules_run:    typeof sub.modulesRun === 'number' ? sub.modulesRun : null,
    confidence:     typeof sub.confidence === 'number' ? sub.confidence : null,
    pipeline_run: sub.pipelineRun || sub.pipeline_run || null,
    title: sub.title || sub.account || null
  };
  if (sub.id) row.id = sub.id;   // omit on insert so DB generates uuid
  // v8.6.9 (per GPT external audit): second tombstone check immediately
  // before upsert. The check at the top of this function can race with a
  // delete that fires while sbUser() is awaiting. Row construction is
  // synchronous so there's no actual yield between the first check and
  // the upsert call, but defense-in-depth costs nothing and protects
  // against future async additions to the row-build path.
  if (row.id && typeof window !== 'undefined' && window.STATE &&
      window.STATE._deletedSubmissionIds && window.STATE._deletedSubmissionIds.has(row.id)) {
    console.warn('sbSaveSubmission blocked at upsert — submission was deleted: ' + row.id);
    return null;
  }
  const { data, error } = await window.sb
    .from('submissions')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Phase 7 step 6: builds a sbSaveSubmission payload from an in-memory rec.
// Centralizing this here means the 4 live callers don't each have to
// remember which 12 fields to plumb through (id, status, statusHistory,
// pipelineRun, title, account, broker, effective, requested, missingInfo,
// modulesRun, confidence). When we add another flat column, we update one
// place — not five.
function buildSubmissionPayload(rec, liteSnapshot) {
  return {
    id:            rec.id,
    snapshot:      liteSnapshot,
    status:        rec.status || 'AWAITING UW REVIEW',
    statusHistory: rec.statusHistory || [],
    pipelineRun:   rec.pipelineRun || null,
    title:         rec.account || rec.title || null,
    // Display/query fields — also written to flat columns by sbSaveSubmission
    account:     rec.account || null,
    broker:      rec.broker  || null,
    effective:   rec.effective   || rec.effectiveDate   || null,
    requested:   rec.requested   || rec.requestedLimits || null,
    missingInfo: Array.isArray(rec.missingInfo) ? rec.missingInfo : [],
    modulesRun:  typeof rec.modulesRun === 'number' ? rec.modulesRun : null,
    confidence:  typeof rec.confidence === 'number' ? rec.confidence : null
  };
}
window.buildSubmissionPayload = buildSubmissionPayload;

async function sbDeleteSubmission(id) {
  // Pre-delete child tables BEFORE deleting the parent submission, where the
  // FK behavior calls for it. Verified FK behavior across child tables:
  //
  //   table             FK on_delete   action here
  //   ────────────────  ─────────────  ─────────────────────────────────────
  //   submission_edits  CASCADE        no pre-delete (kept for legacy reasons,
  //                                    redundant-but-harmless under cascade)
  //   document_pages    CASCADE        handled separately by
  //                                    sbDeleteDocumentPagesForSubmission for
  //                                    storage-binary cleanup ordering
  //   feedback_events   SET NULL       pre-deleted here — UW review feedback
  //                                    is tied to a specific submission and
  //                                    is not separately useful when orphaned
  //   audit_events      SET NULL       NOT pre-deleted — see explanation below
  //
  // ─── audit_events policy decision ───
  // audit_events.submission_id is intentionally SET NULL (not CASCADE). The
  // schema designer made this choice so the audit trail SURVIVES submission
  // deletion: when a submission is deleted, audit rows remain with
  // submission_id NULL'd, which is the right compliance posture for proving
  // "who deleted submission X and when" after the fact. Each audit row is
  // self-contained:
  //   • user_id  — who performed the action
  //   • category — what kind of event
  //   • message  — human-readable description (typically includes the
  //                submission ID denormalized, e.g. "Deleted SUB-XYZ123…")
  //   • created_at — timestamp
  // So a row with submission_id=NULL is still fully useful for audit/forensics.
  //
  // Pre-deleting audit_events here would defeat that intent — it would nuke
  // the audit history at exactly the moment audit history matters most. So
  // we explicitly do NOT pre-delete audit_events. The SET NULL FK does its
  // job and the trail is preserved.
  //
  // (Additional note: the audit_events RLS policies grant authenticated
  // users INSERT and SELECT on their own rows but NOT DELETE. Only the
  // postgres / service_role can delete audit rows. So even if we tried to
  // pre-delete from the client, RLS would silently no-op the operation.
  // That alone makes a client-side audit_events delete the wrong primitive.)
  if (!id) return;
  try {
    await window.sb.from('submission_edits').delete().eq('submission_id', id);
  } catch (e) { console.warn('Pre-delete of submission_edits failed (continuing)', id, e); }
  try {
    await window.sb.from('feedback_events').delete().eq('submission_id', id);
  } catch (e) { console.warn('Pre-delete of feedback_events failed (continuing)', id, e); }
  // audit_events: deliberately NOT pre-deleted. SET NULL preserves the trail.

  // v8.5.6: explicit user_id scoping + return-row verification.
  //
  // Justin reported that deleted submissions reappear after refresh. Two
  // failure modes were possible with the old code (`.delete().eq('id', id)`):
  //
  //   A) RLS allows DELETE but only on rows where user_id = auth.uid().
  //      Without `.eq('user_id', u.id)` in the query, PostgREST sends a
  //      DELETE matching only on id — and RLS silently filters to zero
  //      rows affected. PostgREST returns 200/204 with empty data, no
  //      error. The UI thinks success; the row is still in the database.
  //
  //   B) The id matches but a save-after-delete race recreates the row
  //      via upsert in another code path before the next reload.
  //
  // Adding .eq('user_id', u.id) AND .select() catches case A by:
  //   - Making the WHERE clause explicit (RLS becomes a redundant safety
  //     net, not the only filter)
  //   - Forcing PostgREST to return the deleted rows. Zero returned rows
  //     means delete didn't match, and we throw — bubbling to the UI's
  //     error toast at the call site.
  //
  // Case B (save-after-delete) is addressed separately in deleteSubmission
  // (app.js) which now sets a tombstone in STATE._deletedSubmissionIds so
  // any in-flight saves that fire AFTER delete will skip the upsert.
  const u = await sbUser();
  if (!u) throw new Error('not signed in');
  const { data, error } = await window.sb
    .from('submissions')
    .delete()
    .eq('id', id)
    .eq('user_id', u.id)
    .select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(
      'Delete affected 0 rows for ' + id + '. Either RLS blocked the delete, ' +
      'the row belongs to a different user, or the row was already gone. ' +
      'Check Supabase RLS policy on public.submissions and verify ownership.'
    );
  }
}

// ---- Edits / Custom cards / Hidden cards ---------------------------------
async function sbLoadEdits(submissionId) {
  const { data, error } = await window.sb
    .from('submission_edits')
    .select('module_key, edit_type, payload, updated_at')
    .eq('submission_id', submissionId);
  if (error) throw error;
  return data || [];
}

async function sbSaveEdit(submissionId, moduleKey, editType, payload, pipelineRun) {
  const u = await sbUser(); if (!u) throw new Error('not signed in');
  const { error } = await window.sb
    .from('submission_edits')
    .upsert({
      user_id: u.id,
      submission_id: submissionId,
      module_key: moduleKey,
      edit_type: editType,            // 'edit' | 'custom' | 'hidden'
      payload: payload || {},
      pipeline_run: pipelineRun || null
    }, { onConflict: 'submission_id,module_key' });
  if (error) throw error;
}

async function sbDeleteEdit(submissionId, moduleKey) {
  const { error } = await window.sb
    .from('submission_edits').delete()
    .eq('submission_id', submissionId).eq('module_key', moduleKey);
  if (error) throw error;
}

// Phase 8.5 fix: bulk-delete every submission_edits row for a given submission.
// Used by clearAllEdits() to ensure remote cleanup matches local cleanup.
// Without this, a "Reset All Edits" click would clear local state but leave
// orphan rows in Supabase — which would then come back on next rehydrate
// once the rehydrate path properly reads from submission_edits.
async function sbDeleteAllEditsForSubmission(submissionId) {
  if (!submissionId) return;
  const { error } = await window.sb
    .from('submission_edits').delete()
    .eq('submission_id', submissionId);
  if (error) throw error;
}

// Helper: flatten the in-memory edits/customCards/hiddenCards maps into a single
// upsert batch for the given submission. Called from saveEditsNow().
async function sbSaveAllEditsForSubmission(submissionId, pipelineRun, edits, customCards, hiddenCards) {
  if (!submissionId) return;   // no active submission → nothing to persist
  const u = await sbUser(); if (!u) return;
  const rows = [];
  // edits: { [moduleId]: { text: ..., ... } }
  if (edits && typeof edits === 'object') {
    for (const k of Object.keys(edits)) {
      rows.push({
        user_id: u.id, submission_id: submissionId, pipeline_run: pipelineRun || null,
        module_key: 'card:' + k, edit_type: 'edit', payload: edits[k] || {}
      });
    }
  }
  // customCards: [ { id, title, body/html, ... } ]
  if (Array.isArray(customCards)) {
    for (const cc of customCards) {
      if (!cc || !cc.id) continue;
      rows.push({
        user_id: u.id, submission_id: submissionId, pipeline_run: pipelineRun || null,
        module_key: 'custom:' + cc.id, edit_type: 'custom', payload: cc
      });
    }
  }
  // hiddenCards: { [moduleId]: true }
  if (hiddenCards && typeof hiddenCards === 'object') {
    for (const k of Object.keys(hiddenCards)) {
      if (!hiddenCards[k]) continue;
      rows.push({
        user_id: u.id, submission_id: submissionId, pipeline_run: pipelineRun || null,
        module_key: 'hidden:' + k, edit_type: 'hidden', payload: {}
      });
    }
  }
  if (!rows.length) return;
  const { error } = await window.sb.from('submission_edits')
    .upsert(rows, { onConflict: 'submission_id,module_key' });
  if (error) throw error;
}

// ---- Feedback ------------------------------------------------------------
// Load all feedback events for a given submission. Used on rehydrate so the
// UW sees their prior 👍/👎/💬 reactions on the same cards after refresh or
// when opening an archived submission. Empty array if none or on error.
async function sbLoadFeedbackForSubmission(submissionId) {
  if (!submissionId) return [];
  const { data, error } = await window.sb
    .from('feedback_events')
    .select('*')
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: true });
  if (error) { console.warn('sbLoadFeedbackForSubmission failed', error); return []; }
  // Translate DB rows back into the STATE.feedback event shape the app's
  // existing UI code expects (sentiment, moduleId, moduleName, text, etc).
  return (data || []).map(row => {
    const ctx = row.context || {};
    // rating → sentiment
    const sentiment = row.rating === 'up'   ? 'positive'
                    : row.rating === 'down' ? 'negative'
                    : row.rating === 'comment' ? 'suggestion' : null;
    // module_key → moduleId / customCardId / level
    let moduleId = null, customCardId = null, level = null;
    if (row.module_key) {
      if      (row.module_key.startsWith('card:'))   moduleId     = row.module_key.slice(5);
      else if (row.module_key.startsWith('custom:')) customCardId = row.module_key.slice(7);
      else if (row.module_key.startsWith('level:'))  level        = row.module_key.slice(6);
    }
    return {
      id: row.id,
      timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      actor: ctx.actor || 'unknown',
      pipelineRun: row.pipeline_run || null,
      submissionId: row.submission_id || null,
      sentiment: sentiment,
      moduleId: moduleId,
      customCardId: customCardId,
      level: level,
      moduleName: ctx.moduleName || null,
      reason: ctx.reason || null,
      text: row.comment || null,
      outputSnapshot: ctx.outputSnapshot || null,
      outputConfidence: ctx.outputConfidence || null,
      sourceDocNames: ctx.sourceDocNames || null,
      exportedAt: null
    };
  });
}

// ---- Feedback (write) ----------------------------------------------------
// Each click of 👍 / 👎 / 💬 becomes one insert. No batch read — Phase 6
// admin view will query Supabase directly.
async function sbLogFeedback(event) {
  const u = await sbUser(); if (!u) throw new Error('not signed in');
  // Map the app's existing feedback event shape onto the feedback_events row.
  const rating =
    event.sentiment === 'positive'   ? 'up'      :
    event.sentiment === 'negative'   ? 'down'    :
    event.sentiment === 'suggestion' ? 'comment' : null;
  const moduleKey = event.moduleId   ? 'card:'   + event.moduleId
                  : event.customCardId ? 'custom:' + event.customCardId
                  : event.level       ? ('level:' + event.level) : null;
  const { error } = await window.sb.from('feedback_events').insert({
    user_id: u.id,
    submission_id: event.submissionId || null,
    pipeline_run: event.pipelineRun || null,
    module_key: moduleKey,
    rating: rating,
    comment: event.text || null,
    context: {
      moduleName: event.moduleName || null,
      reason: event.reason || null,
      outputSnapshot: event.outputSnapshot || null,
      outputConfidence: event.outputConfidence || null,
      sourceDocNames: event.sourceDocNames || null,
      actor: event.actor || null
    }
  });
  if (error) throw error;
}

// ---- Audit events (cloud mirror of in-app logAudit) ----------------------
// Phase 6 step 1: every logAudit() call also writes one row to public.audit_events
// so admin views (Phase 6 step 7) can read history across all users and devices.
//
// Hard rules this helper must obey:
//   1. Fire-and-forget. Never blocks the caller, never throws upward.
//   2. NEVER call logAudit() from inside this function — would create an
//      infinite recursive loop if the cloud write itself fails.
//   3. Skip the write entirely when there's no signed-in session. RLS would
//      reject it anyway and we don't want anonymous rows in the audit table.
//   4. category and message are NOT NULL in Postgres — default them.
//   5. meta is text (not jsonb), so any object meta gets JSON.stringify'd
//      before insert; otherwise Postgres throws a type error and the audit
//      write fails silently — exactly the foundational silent-failure class
//      of bug we're trying to prevent in this layer.
async function sbLogAuditEvent(category, message, meta, submissionId) {
  try {
    const u = await sbUser(); if (!u) return;   // rule 3

    // rule 4 — guard NOT NULL columns
    const cat = (category != null && String(category).trim()) || 'info';
    const msg = (message  != null && String(message).trim())  || '(no message)';

    // rule 5 — meta is text. '—' is the legacy "no meta" placeholder used by
    // many existing logAudit call sites; treat it as null in the cloud row
    // so the column reflects "absent" rather than a literal em-dash.
    let metaText = null;
    if (meta != null && meta !== '—') {
      metaText = (typeof meta === 'string') ? meta : JSON.stringify(meta);
    }

    const effectiveSid = submissionId
                      || (typeof STATE !== 'undefined' && STATE.activeSubmissionId)
                      || null;

    // FK PRE-CHECK: audit_events.submission_id has a FK constraint to
    // submissions.id. Pipeline runs that fire dozens of audit events
    // before recordSubmission persists the parent row will all violate
    // the FK. Suppress these inserts when we know the parent doesn't
    // exist yet — track a per-submission-id "known unsaved" flag locally,
    // refresh it once per session, and let through inserts that have
    // a confirmed-saved parent.
    //
    // First-write fallback: if we don't yet know whether the parent
    // exists, do a single existence check and cache the result. Cheap
    // (PK lookup), prevents 115 redundant FK violations per pipeline run.
    if (effectiveSid) {
      if (!sbLogAuditEvent._submissionExistsCache) {
        sbLogAuditEvent._submissionExistsCache = new Map();
      }
      const cache = sbLogAuditEvent._submissionExistsCache;
      let exists = cache.get(effectiveSid);
      if (exists === undefined) {
        try {
          const { data, error: chkErr } = await window.sb
            .from('submissions')
            .select('id')
            .eq('id', effectiveSid)
            .maybeSingle();
          exists = !chkErr && !!data;
          cache.set(effectiveSid, exists);
        } catch (e) {
          // If existence check fails, default to "exists=true" so we
          // attempt the insert; if it fails with FK, we'll catch below
          // and learn from the error.
          exists = true;
        }
      }
      if (!exists) {
        // Skip the insert silently. The audit event won't reach the cloud
        // for this submission until its parent row lands. Local audit log
        // (state.audit) still has the entry, so nothing's truly lost.
        //
        // BUFFER FOR REPLAY: queue these skipped events so they can be
        // replayed once the parent submission row lands. Without buffering,
        // any audit events fired during the brief window between
        // pre-mint-id-set and stub-row-saved would be silently dropped
        // from the cloud audit (still visible locally, but not mirrored).
        if (!sbLogAuditEvent._buffer) sbLogAuditEvent._buffer = new Map();
        let queue = sbLogAuditEvent._buffer.get(effectiveSid);
        if (!queue) { queue = []; sbLogAuditEvent._buffer.set(effectiveSid, queue); }
        // Cap the buffer at 100 events per submission to prevent runaway
        // memory if a submission never lands. Most pipeline runs queue a
        // handful before pre-mint completes, so 100 is comfortable.
        if (queue.length < 100) {
          queue.push({ user_id: u.id, submission_id: effectiveSid, category: cat, message: msg, meta: metaText });
        }
        return;
      }
    }

    const row = {
      user_id:       u.id,
      submission_id: effectiveSid,
      category:      cat,
      message:       msg,
      meta:          metaText
    };
    const { error } = await window.sb.from('audit_events').insert(row);
    if (error) {
      // rule 2 — DO NOT call logAudit() here. Console only.
      // FK violations: cache "doesn't exist yet" for this submission so
      // the next call short-circuits without retrying. Updates flip to
      // "exists" once recordSubmission persists the parent.
      if (error.code === '23503' && effectiveSid) {
        if (!sbLogAuditEvent._submissionExistsCache) {
          sbLogAuditEvent._submissionExistsCache = new Map();
        }
        sbLogAuditEvent._submissionExistsCache.set(effectiveSid, false);
        // Buffer THIS event too so it gets replayed when submission lands.
        // Otherwise the very first event that hit the FK race is silently
        // dropped while subsequent ones get queued.
        if (!sbLogAuditEvent._buffer) sbLogAuditEvent._buffer = new Map();
        let queue = sbLogAuditEvent._buffer.get(effectiveSid);
        if (!queue) { queue = []; sbLogAuditEvent._buffer.set(effectiveSid, queue); }
        if (queue.length < 100) queue.push(row);
        // Log the FK violation once per submission, not per event.
        if (!sbLogAuditEvent._fkLoggedFor) sbLogAuditEvent._fkLoggedFor = new Set();
        if (!sbLogAuditEvent._fkLoggedFor.has(effectiveSid)) {
          sbLogAuditEvent._fkLoggedFor.add(effectiveSid);
          console.warn('[audit] FK violation for submission ' + effectiveSid + ' — parent row not yet persisted; events buffered for replay when it lands.');
        }
        return;
      }
      console.warn('[audit] cloud write failed:', error.message || error);
    }
  } catch (e) {
    // rule 2 again — same reason.
    console.warn('[audit] cloud write threw:', (e && e.message) || e);
  }
}
// Public hook: when a submission is finally saved (recordSubmission), call
// this to flip the cache so subsequent audit events go through. Without it,
// every audit event after recordSubmission would still skip until the
// per-session cache TTL expired (which we don't have).
function sbInvalidateSubmissionExistsCache(submissionId) {
  if (!submissionId) return;
  if (!sbLogAuditEvent._submissionExistsCache) return;
  // Mark as definitely existing — pipeline pre-mint or recordSubmission
  // both call this after a successful upsert.
  sbLogAuditEvent._submissionExistsCache.set(submissionId, true);
  if (sbLogAuditEvent._fkLoggedFor) {
    sbLogAuditEvent._fkLoggedFor.delete(submissionId);
  }
  // Replay any audit events that were buffered while this submission
  // was in the "doesn't exist yet" state. Without this, audit events
  // fired during the pipeline-pre-mint → stub-saved window would
  // never reach the cloud audit_events table — they'd live only in
  // the local state.audit array.
  if (sbLogAuditEvent._buffer && sbLogAuditEvent._buffer.has(submissionId)) {
    const queue = sbLogAuditEvent._buffer.get(submissionId);
    sbLogAuditEvent._buffer.delete(submissionId);
    if (queue && queue.length > 0 && window.sb) {
      // Fire-and-forget — don't block the caller. If the replay insert
      // fails, the events are already in local state.audit so the loss
      // is the same as if the buffer hadn't existed.
      (async () => {
        try {
          const { error } = await window.sb.from('audit_events').insert(queue);
          if (error) {
            console.warn('[audit] replay of ' + queue.length + ' buffered events failed:', error.message);
          }
        } catch (e) {
          console.warn('[audit] replay threw:', (e && e.message) || e);
        }
      })();
    }
  }
}
window.sbInvalidateSubmissionExistsCache = sbInvalidateSubmissionExistsCache;
window.sbLogAuditEvent = sbLogAuditEvent;

// ---- User settings (carrier guideline, model pref, etc.) -----------------
async function sbLoadSettings() {
  const u = await sbUser(); if (!u) return null;
  const { data, error } = await window.sb
    .from('user_settings').select('*').eq('user_id', u.id).maybeSingle();
  if (error) throw error;
  return data;
}

async function sbSaveSettings(patch) {
  const u = await sbUser(); if (!u) throw new Error('not signed in');
  const row = { user_id: u.id, ...patch };
  const { error } = await window.sb
    .from('user_settings').upsert(row, { onConflict: 'user_id' });
  if (error) throw error;
}

// ---- Admin: real Users & roles card (Phase 6 step 2) ---------------------
// Reads public.users + counts submissions per user. Two RLS policies make
// this work for admin role only:
//   - "admins read all users" on public.users (SELECT, qual: is_admin())
//   - "admins select all submissions" on public.submissions (SELECT)
// Non-admins running this would see only themselves (RLS limits each user
// to their own row), so the renderer also gates on currentUser.role to
// avoid showing a half-broken view.
//
// Returns: array of { id, email, display_name, role, created_at, submission_count }
// sorted by display_name (case-insensitive, A→Z).
async function sbLoadAdminUsers() {
  const u = await sbUser(); if (!u) throw new Error('not signed in');

  // Run both queries in parallel — neither depends on the other.
  // For submissions we only need user_id; pulling the whole row would be
  // wasted bandwidth for what is just a per-user count.
  const [usersRes, subsRes] = await Promise.all([
    window.sb.from('users').select('id, email, display_name, role, created_at'),
    window.sb.from('submissions').select('user_id')
  ]);
  if (usersRes.error) throw usersRes.error;
  if (subsRes.error)  throw subsRes.error;

  // Group submissions by user_id for per-user counts. Skip null user_ids.
  const counts = new Map();
  (subsRes.data || []).forEach(r => {
    if (!r.user_id) return;
    counts.set(r.user_id, (counts.get(r.user_id) || 0) + 1);
  });

  return (usersRes.data || [])
    .map(row => ({ ...row, submission_count: counts.get(row.id) || 0 }))
    .sort((a, b) => (a.display_name || '').toLowerCase()
                  .localeCompare((b.display_name || '').toLowerCase()));
}
window.sbLoadAdminUsers = sbLoadAdminUsers;

// renderAdminUsersCard moved to admin-views.js (Phase 8 step 4).

// ---- Admin: real Feedback Loop card (Phase 6 step 3+4+5) -----------------
// Step 3: reads public.feedback_events for totals, by-rating breakdown, and
//         a recent-events list — replaces the session-only counter.
// Step 4: fixes the deferred bug where #feedbackStatus showed STATE.feedback
//         (current session) instead of cloud-truth count.
// Step 5: Clear button was replaced with Refresh (just re-fetches). The old
//         Clear wiped STATE.feedback only, which after Phase 4 is empty for
//         admins anyway (sbHydrate doesn't populate it). Nothing destructive
//         in this patch — cloud data is never touched by the admin card.
//
// RLS note: "admins read all feedback" policy (is_admin()) gives admin role
// full read access. Non-admins only see their own rows via "users read own
// feedback" — which is why renderAdminFeedbackCard gates on role and skips
// for non-admins (they'd see a half-broken "my own rows only" view).
async function sbLoadFeedbackSummary() {
  const u = await sbUser(); if (!u) throw new Error('not signed in');
  const { data, error } = await window.sb
    .from('feedback_events')
    .select('rating, exported_at');
  if (error) throw error;
  const rows = data || [];
  let up = 0, down = 0, comment = 0, unexported = 0;
  rows.forEach(r => {
    if      (r.rating === 'up')      up++;
    else if (r.rating === 'down')    down++;
    else if (r.rating === 'comment') comment++;
    if (!r.exported_at) unexported++;
  });
  return { total: rows.length, up, down, comment, unexported };
}
window.sbLoadFeedbackSummary = sbLoadFeedbackSummary;

async function sbLoadFeedbackRecent(limit) {
  const u = await sbUser(); if (!u) throw new Error('not signed in');
  const { data, error } = await window.sb
    .from('feedback_events')
    .select('id, user_id, submission_id, module_key, rating, comment, context, created_at')
    .order('created_at', { ascending: false })
    .limit(limit || 10);
  if (error) throw error;
  return data || [];
}
window.sbLoadFeedbackRecent = sbLoadFeedbackRecent;

// renderAdminFeedbackCard + refreshFeedbackCard moved to admin-views.js
// (Phase 8 step 4).

// ---- Admin: cloud-backed Live Audit Log (Phase 6 step 7) ----------------
// Payoff of step 1: every logAudit() call since 21:13:35 has been writing to
// audit_events. Admins can now browse that history here across all users
// and devices, filtered by category, with cursor-based pagination.
//
// Cursor (not offset) pagination — beforeCreatedAt filters older rows, so
// loading page 5 is still O(log n) and new rows arriving during browsing
// don't shift the pagination boundary.
async function sbLoadAuditEvents(options) {
  const u = await sbUser(); if (!u) throw new Error('not signed in');
  const opts = options || {};
  const limit = opts.limit || 50;
  let q = window.sb.from('audit_events')
    .select('id, user_id, submission_id, category, message, meta, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (opts.category && opts.category !== 'all') {
    q = q.eq('category', opts.category);
  }
  if (opts.beforeCreatedAt) {
    q = q.lt('created_at', opts.beforeCreatedAt);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
window.sbLoadAuditEvents = sbLoadAuditEvents;

// Client-side distinct. At modest volumes (< ~5k rows) this is fine; above
// that we'd migrate to an RPC doing `select distinct category` server-side.
async function sbLoadAuditCategories() {
  const u = await sbUser(); if (!u) throw new Error('not signed in');
  const { data, error } = await window.sb
    .from('audit_events').select('category').limit(5000);
  if (error) throw error;
  const set = new Set((data || []).map(r => r.category).filter(Boolean));
  return Array.from(set).sort();
}
window.sbLoadAuditCategories = sbLoadAuditCategories;

// renderAdminAuditLog + onAuditCategoryChange + onAuditLoadOlder moved to
// admin-views.js (Phase 8 step 4).

// ---- Master hydration: pull everything for the signed-in user -----------
// Called from checkAuth() once we have a session. Populates STATE.* from
// Supabase, replacing whatever the legacy localStorage loaders would have
// done. Safe to call multiple times.
async function sbHydrate() {
  if (typeof logAudit === 'function') logAudit('Supabase', 'Hydrate starting…', 'ok');
  try {
    // Defensive: if the session hasn't resolved yet, sbLoadSubmissions will
    // hit RLS and return 0 rows silently. Wait briefly for auth to settle.
    const sess = await window.sb.auth.getSession();
    if (!sess.data.session) {
      if (typeof logAudit === 'function') logAudit('Supabase', 'Hydrate skipped — no session yet', 'warn');
      return;
    }
    // Submissions. Each DB row's `snapshot` holds the per-submission object;
    // we flatten it back into the shape the rest of the app expects so the
    // Queue / rehydrate paths keep working unchanged.
    const subRowsRaw = await sbLoadSubmissions();
    // v8.6.10 (per GPT external audit): filter out tombstoned IDs.
    // If a hydrate fires while a delete is in flight (e.g. user clicks
    // delete then immediately switches submissions, triggering hydrate),
    // the cloud row may still exist briefly. Without this filter, that
    // hydrate would re-add the deleted row to STATE.submissions and the
    // UI would show it again. The tombstone is in-memory only, so this
    // filter only protects the in-session window — across page refresh,
    // tombstone is gone but cloud delete should also be complete by then.
    const tombstones =
      (typeof STATE !== 'undefined' && STATE._deletedSubmissionIds && STATE._deletedSubmissionIds.size)
        ? STATE._deletedSubmissionIds
        : null;
    const subRows = tombstones
      ? subRowsRaw.filter(r => !tombstones.has(r.id))
      : subRowsRaw;
    if (tombstones && subRows.length < subRowsRaw.length) {
      console.warn('[hydrate] filtered ' + (subRowsRaw.length - subRows.length) +
        ' tombstoned submission(s) from cloud response');
    }
    STATE.submissions = subRows.map(r => {
      const d = (r.snapshot && r.snapshot.derived) || {};   // fallback for pre-step-6 rows
      // Phase 7 step 6 (post-test fix): recompute modulesRun/confidence from
      // snapshot.extractions when the flat columns are NULL and snapshot.derived
      // doesn't carry them either (which is the case for every row saved before
      // step 6 — liteSnapshot.derived only ever stuffed 5 of the 7 fields).
      const ext = (r.snapshot && r.snapshot.extractions) || {};
      const extIds = Object.keys(ext);
      const computedModulesRun = extIds.length > 0 ? extIds.length : null;
      const computedConfidence = extIds.length > 0
        ? extIds.reduce((sum, k) => sum + (ext[k].confidence || 0), 0) / extIds.length
        : null;

      // Compute display-field values once so the missingInfo fallback can
      // reference them without redundant work.
      const accountVal   = r.account_name   || d.account         || null;
      const brokerVal    = r.broker         || d.broker          || null;
      const effectiveVal = r.effective_date || d.effectiveDate   || null;
      const requestedVal = r.requested      || d.requestedLimits || null;

      // Phase 7 step 6 (post-test fix #2): missing_info clobber-recovery.
      // Earlier saves with the broken empty-array hydrate path overwrote
      // BOTH the flat column AND snapshot.derived.missingInfo to []. When
      // both sources are empty, recompute by mirroring computeMissingInfo()
      // logic: check which extraction keys are present + which derived
      // fields are populated. This heals clobbered rows on next save.
      const computedMissingInfo = [];
      if (!accountVal)               computedMissingInfo.push('Named Insured');
      if (!brokerVal)                computedMissingInfo.push('Broker');
      if (!effectiveVal)             computedMissingInfo.push('Effective date');
      if (!ext.losses)               computedMissingInfo.push('Loss runs');
      if (!ext.gl_quote)             computedMissingInfo.push('Primary GL');
      if (!ext.al_quote)             computedMissingInfo.push('Primary AL');
      if (requestedVal && !ext.excess) computedMissingInfo.push('Underlying excess schedule');
      if (!ext.supplemental)         computedMissingInfo.push('Supplemental application');
      if (!ext.safety)               computedMissingInfo.push('Safety program');
      if (!ext.email_intel)          computedMissingInfo.push('Broker email');

      return {
        id: r.id,
        pipelineRun: r.pipeline_run,
        status: r.status,
        // Phase 7 step 5: status_history flat column → in-memory statusHistory.
        // Old rows saved before the patch may have empty arrays; in that case
        // fall back to whatever the snapshot happened to carry (usually nothing,
        // since pre-patch saves didn't persist it either — but safe fallback).
        statusHistory: (r.status_history && r.status_history.length > 0)
          ? r.status_history
          : ((r.snapshot && r.snapshot.statusHistory) || []),
        title: r.title,
        lastModifiedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
        createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
        snapshot: r.snapshot || null,
        // Phase 7 step 6: prefer flat columns (NEW source of truth) but fall
        // back to snapshot.derived for rows saved before the migration. Field
        // names match the in-memory rec convention (effective, not effectiveDate).
        // missingInfo: empty-array short-circuit is a real bug — a NOT NULL
        // DEFAULT '[]' column will be truthy & is-array but EMPTY, so we have
        // to length-check before using it as the source of truth.
        account:     accountVal,
        broker:      brokerVal,
        effective:   effectiveVal,
        requested:   requestedVal,
        missingInfo: (Array.isArray(r.missing_info) && r.missing_info.length > 0)
          ? r.missing_info
          : ((Array.isArray(d.missingInfo) && d.missingInfo.length > 0)
            ? d.missingInfo
            : computedMissingInfo),
        modulesRun:  (typeof r.modules_run === 'number') ? r.modules_run
                   : (typeof d.modulesRun === 'number') ? d.modulesRun
                   : computedModulesRun,
        confidence:  (typeof r.confidence === 'number')  ? r.confidence
                   : (typeof d.confidence === 'number')  ? d.confidence
                   : computedConfidence
      };
    });
    if (typeof logAudit === 'function') logAudit('Supabase', 'Hydrated ' + STATE.submissions.length + ' submissions', 'ok');
    // Rerender the Queue table. The function is `renderQueueTable` in this
    // codebase (not renderSubmissionsTable — an earlier version had the wrong
    // name, which is why refreshes appeared to wipe the Queue visually even
    // when STATE was populated).
    if (typeof renderQueueTable === 'function') renderQueueTable();
    if (typeof updateQueueKpi === 'function') updateQueueKpi();

    // Settings → carrier guideline + model prefs.
    const settings = await sbLoadSettings();
    if (settings) {
      if (settings.carrier_guideline && settings.carrier_guideline.length > 100) {
        ACTIVE_GUIDELINE = settings.carrier_guideline;
      }
      if (settings.default_model && STATE.api) STATE.api.model = settings.default_model;
      if (settings.max_tokens && STATE.api)    STATE.api.maxTokens = settings.max_tokens;
      // Round 5 fix #1: read force_global_model. When true, callLLM in pipeline.js
      // routes every LLM call through STATE.api.model regardless of per-module preference.
      if (typeof settings.force_global_model === 'boolean' && STATE.api) STATE.api.forceGlobal = settings.force_global_model;
      // Phase 8.5 fix #5: refresh the visible model pill in the top bar so it
      // shows the just-loaded model name immediately, not the original default.
      // Without this the pill keeps showing the pre-hydrate model until some
      // other UI action triggers updateApiPillUI() (e.g. opening Settings).
      if (typeof updateApiPillUI === 'function') updateApiPillUI();
    }

    // Feedback is write-only from the app's perspective now. The admin view
    // (Phase 6) reads directly from Supabase. STATE.feedback stays empty.
    STATE.feedback = [];
    if (typeof updateFeedbackCount === 'function') updateFeedbackCount();
  } catch (e) {
    console.warn('sbHydrate failed', e);
    if (typeof logAudit === 'function') {
      logAudit('Supabase', 'Hydrate FAILED: ' + (e.message || e), 'warn');
    }
  }
}
window.sbHydrate = sbHydrate;

// ============================================================================
// Phase 8 step 3 fix: explicit window-exports for every top-level declaration.
// When a script contains `const` at top level (like our `const sb = window.sb`
// bridge), browsers treat the whole script as a lexical scope and function
// declarations DO NOT auto-attach to window. Some helpers had explicit
// `window.X = X` lines from Phase 4/6, others relied on the legacy auto-
// attach behavior. With the bridge in place, we now need EVERY export to
// be explicit. Reassigning is idempotent and harmless for ones that already
// had a `window.X = X` earlier in the file.
// ============================================================================
window.sbUser = sbUser;
window.sbLoadSubmissions = sbLoadSubmissions;
window.sbSaveSubmission = sbSaveSubmission;
window.buildSubmissionPayload = buildSubmissionPayload;
window.sbDeleteSubmission = sbDeleteSubmission;
window.sbLoadEdits = sbLoadEdits;
window.sbSaveEdit = sbSaveEdit;
window.sbDeleteEdit = sbDeleteEdit;
window.sbDeleteAllEditsForSubmission = sbDeleteAllEditsForSubmission;
window.sbSaveAllEditsForSubmission = sbSaveAllEditsForSubmission;
window.sbLoadFeedbackForSubmission = sbLoadFeedbackForSubmission;
window.sbLogFeedback = sbLogFeedback;
window.sbLogAuditEvent = sbLogAuditEvent;
window.sbLoadSettings = sbLoadSettings;
window.sbSaveSettings = sbSaveSettings;
window.sbLoadAdminUsers = sbLoadAdminUsers;
window.sbLoadFeedbackSummary = sbLoadFeedbackSummary;
window.sbLoadFeedbackRecent = sbLoadFeedbackRecent;
window.sbLoadAuditEvents = sbLoadAuditEvents;
window.sbLoadAuditCategories = sbLoadAuditCategories;
window.sbHydrate = sbHydrate;

// ════════════════════════════════════════════════════════════════════════
// DOCUMENT PAGES — persistence for the Documents view (Phase 3)
//
// One row per page (or per native file). The original binary lives in the
// 'submission-files' storage bucket at path '{user_id}/{file_id}.{ext}'.
// The row holds metadata + thumbnail + extracted text + annotations JSONB.
//
// Auth: every helper checks sbUser() first and short-circuits if signed out
// so that the docs view continues to function in pure-local mode (no
// persistence) for unauthenticated demo sessions.
//
// Phase 5: every helper bumps a window.docsCloudHealth counter on failure
// so the docs view can surface a sync-paused indicator to the user. The
// counter resets to 0 on the next successful call.
// ════════════════════════════════════════════════════════════════════════

const STORAGE_BUCKET = 'submission-files';
const DOC_TABLE      = 'document_pages';

// Lightweight cloud-health tracker. Every doc helper marks success/failure
// here so the UI can show a sync-paused badge after consecutive failures.
// The counter is intentionally dumb (no rolling window) — a single success
// resets it, so a temporary blip clears immediately while a real outage
// stays visible.
window.docsCloudHealth = window.docsCloudHealth || { consecutiveFailures: 0 };
function _noteCloudOk() {
  if (window.docsCloudHealth.consecutiveFailures > 0) {
    window.docsCloudHealth.consecutiveFailures = 0;
    if (typeof window.docsCloudHealthChanged === 'function') window.docsCloudHealthChanged(0);
  }
}
function _noteCloudFail() {
  window.docsCloudHealth.consecutiveFailures++;
  if (typeof window.docsCloudHealthChanged === 'function') {
    window.docsCloudHealthChanged(window.docsCloudHealth.consecutiveFailures);
  }
}

// ---- Storage helpers ---------------------------------------------------

// Upload a File or Blob to storage at '{user_id}/{file_id}.{ext}'. Returns
// the storage path, or null on failure.
//
// Content-type handling: browsers return inconsistent MIME types across
// platforms — Firefox might give 'application/octet-stream' for a .pptx
// while Chrome gives the proper presentationml type. Storage's MIME
// allowlist is strict, so we normalize: trust file.type if present, else
// derive from extension via EXTENSION_TO_MIME, else fall through to
// 'application/octet-stream' which is always allowlisted.
const EXTENSION_TO_MIME = {
  pdf:  'application/pdf',
  doc:  'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:  'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xlsb: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  xltm: 'application/vnd.ms-excel.template.macroEnabled.12',
  ppt:  'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  potx: 'application/vnd.openxmlformats-officedocument.presentationml.template',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  potm: 'application/vnd.ms-powerpoint.template.macroEnabled.12',
  rtf:  'application/rtf',
  eml:  'message/rfc822',
  msg:  'application/vnd.ms-outlook',
  oft:  'application/vnd.ms-office.outlook.template',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
  gif:  'image/gif',
  webp: 'image/webp',
  bmp:  'image/bmp',
  tif:  'image/tiff',
  tiff: 'image/tiff',
  txt:  'text/plain',
  log:  'text/plain',
  csv:  'text/csv',
  tsv:  'text/tab-separated-values',
  md:   'text/markdown',
  zip:  'application/zip',
  rar:  'application/x-rar-compressed',
  '7z': 'application/x-7z-compressed',
  tar:  'application/x-tar',
  gz:   'application/gzip',
};
const STORAGE_ALLOWED_MIME = new Set(Object.values(EXTENSION_TO_MIME).concat([
  'application/octet-stream',
  'text/html',
  'image/heic',
  'image/heif',
  'text/rtf',
  'application/vnd.ms-powerpoint.slideshow.macroEnabled.12',
]));
async function sbUploadDocumentFile(file, fileId) {
  const u = await sbUser(); if (!u) return null;
  // Derive a safe extension from the original name. We do this defensively:
  // raw filenames can contain path separators ('../../etc/passwd' yields
  // ext='/etc/passwd' under a naive regex), unicode, control chars, or
  // arbitrary length junk. Only [a-z0-9_-] up to 10 chars; everything else
  // falls through to 'bin'. The actual display name is preserved in the
  // file_name column on the row — only the storage path is sanitized.
  const rawMatch = String(file.name || '').match(/\.([^.]+)$/);
  let ext = rawMatch ? rawMatch[1].toLowerCase() : 'bin';
  if (!/^[a-z0-9_-]{1,10}$/.test(ext)) ext = 'bin';
  const path = `${u.id}/${fileId}.${ext}`;
  // Pick the safest content type: browser-provided if allowlisted, else
  // extension-derived if known, else octet-stream as the universal fallback.
  let contentType = file.type;
  if (!contentType || !STORAGE_ALLOWED_MIME.has(contentType)) {
    contentType = EXTENSION_TO_MIME[ext] || 'application/octet-stream';
  }
  const { error } = await window.sb.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: true,
      contentType,
    });
  if (error) {
    console.warn('sbUploadDocumentFile failed:', error.message);
    _noteCloudFail();
    return null;
  }
  _noteCloudOk();
  return path;
}

// Get a time-limited signed URL so the browser can fetch the binary.
// Default: 1 hour; long enough for a preview/OCR session, short enough
// that links emailed by accident expire fast.
async function sbGetDocumentSignedUrl(storagePath, expiresInSeconds) {
  if (!storagePath) return null;
  const expires = expiresInSeconds || 3600;
  const { data, error } = await window.sb.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, expires);
  if (error) {
    console.warn('sbGetDocumentSignedUrl failed:', error.message);
    _noteCloudFail();
    return null;
  }
  _noteCloudOk();
  return data?.signedUrl || null;
}

async function sbDeleteDocumentFile(storagePath) {
  if (!storagePath) return;
  const { error } = await window.sb.storage
    .from(STORAGE_BUCKET)
    .remove([storagePath]);
  if (error) console.warn('sbDeleteDocumentFile failed:', error.message);
}

// ---- document_pages table helpers --------------------------------------

// Build the DB row from a state.docs entry. Only persistable fields go in;
// the large in-memory blobs (pdfData arrayBuffer, highResData URL,
// nativeDataUrl) stay in memory because their source-of-truth is storage.
function buildDocPageRow(doc, userId) {
  return {
    id:                       doc.id,                  // app-generated UUID-like string
    user_id:                  userId,
    submission_id:            doc.submissionId || null,
    file_id:                  doc.id,                  // same as id for now; reserved if we later split per-file vs per-page rows
    file_name:                doc.workbookFileName || (doc.displayName + '.bin'),
    file_size:                doc.fileSize || null,
    file_mime_type:           doc.nativeMimeType || null,
    storage_path:             doc.storagePath || null,
    page_number:              doc.pageNumber || 1,
    total_pages:              doc.totalPages || 1,
    display_name:             doc.displayName || doc.name || 'Untitled',
    category:                 doc.category || 'all',
    color:                    doc.color || null,
    tagged:                   !!doc.tagged,
    pipeline_classification:  doc.pipelineClassification || null,
    pipeline_routed_to:       doc.pipelineRoutedTo || null,
    // v8.4 fields — require migration to be applied (ALTER TABLE adds
    // pipeline_tag, primary_bucket, relabeled_by_user columns).
    pipeline_tag:             doc.pipelineTag || null,
    primary_bucket:           doc.primaryBucket || null,
    relabeled_by_user:        !!doc.relabeledByUser,
    extracted_text:           (doc.textContent || '').slice(0, 500000),  // hard cap 500k chars
    thumbnail_data_url:       doc.thumbnailData || null,
    html_content:             doc.htmlContent || null,
    annotations:              doc._annotationsForDb || { layers: [], undone: [] },
  };
}

// ──── PHASE 5 · THUMBNAIL COMPRESSION ────
// PDF thumbnails are rendered at 3.0x scale for crisp display, which puts
// each page at 1-2 MB as a base64 PNG. Stored verbatim, a 100-page policy
// schedule would push 100-200 MB into the document_pages.thumbnail_data_url
// column. We cap at ~120 KB by re-encoding through a canvas: PNG → JPEG
// quality 0.85, downscaling to 1200px wide if the source is larger, then
// stepping quality down until under the cap. The full-resolution thumb
// stays in memory for the active session — only the persisted copy shrinks.
//
// JPEG vs PNG: thumbnails are previews of mostly-photographic-or-text page
// rasters; JPEG with white background fill compresses 8-15x better than
// PNG with negligible visual cost at the small render size.
const THUMB_PERSIST_MAX_BYTES = 500 * 1024;   // 500 KB cap per persisted thumb.
                                              // Larger than minimal but small
                                              // enough to keep DB row sizes
                                              // reasonable. Tradeoff: hydrate
                                              // pulls every row's thumb on
                                              // load, so this multiplies the
                                              // initial fetch time by however
                                              // many docs the user has.
const THUMB_PERSIST_MAX_WIDTH = 1200;         // downscale wider images. 1200px
                                              // is the natural width of the
                                              // doc-thumb at common panel
                                              // sizes — the thumb fills any
                                              // reasonable panel resize
                                              // without empty space.
async function compressThumbForPersist(dataUrl) {
  if (!dataUrl) return null;
  // Already small enough? Skip the canvas round-trip.
  if (dataUrl.length <= THUMB_PERSIST_MAX_BYTES) return dataUrl;
  // Headless / non-browser environment can't compress; just truncate by
  // returning null so we don't store oversized rows. The doc still works
  // on hydrate (falls back to the file-type icon).
  if (typeof Image === 'undefined' || typeof document === 'undefined') return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        // Try progressively smaller sizes if quality stepdown alone can't fit.
        // Width-halving is more effective than quality cuts for text-heavy
        // pages (text edges are detail JPEG fights to preserve).
        const widths = [
          Math.min(img.naturalWidth, THUMB_PERSIST_MAX_WIDTH),  // first attempt: 1200px
          Math.min(img.naturalWidth, 800),                       // second: 800px
          Math.min(img.naturalWidth, 500),                       // last resort: 500px (still > minimal UI display size)
        ];
        for (const targetW of widths) {
          const canvas = document.createElement('canvas');
          const scale = targetW / img.naturalWidth;
          canvas.width  = Math.max(1, Math.round(img.naturalWidth  * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const ctx = canvas.getContext('2d');
          // White background so transparent PNGs (rare for our thumbs but
          // possible) don't end up black inside JPEG.
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          // Step quality down at this width.
          let q = 0.85;
          let out = canvas.toDataURL('image/jpeg', q);
          while (out.length > THUMB_PERSIST_MAX_BYTES && q > 0.3) {
            q -= 0.1;
            out = canvas.toDataURL('image/jpeg', q);
          }
          if (out.length <= THUMB_PERSIST_MAX_BYTES) {
            resolve(out);
            return;
          }
        }
        // All three widths × all quality steps couldn't fit. Take the
        // smallest+lowest-quality output anyway — a slightly-oversized
        // thumb is better than a blank one. Cap cap at 200KB absolute
        // ceiling to prevent runaway sizes.
        const finalCanvas = document.createElement('canvas');
        const finalScale = Math.min(280 / img.naturalWidth, 1);
        finalCanvas.width  = Math.max(1, Math.round(img.naturalWidth  * finalScale));
        finalCanvas.height = Math.max(1, Math.round(img.naturalHeight * finalScale));
        const fctx = finalCanvas.getContext('2d');
        fctx.fillStyle = '#FFFFFF';
        fctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
        fctx.drawImage(img, 0, 0, finalCanvas.width, finalCanvas.height);
        const fallback = finalCanvas.toDataURL('image/jpeg', 0.3);
        resolve(fallback.length <= 200 * 1024 ? fallback : null);
      } catch (err) {
        console.warn('compressThumbForPersist failed:', err);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// Insert (or upsert) a single doc page. Used right after addDoc() in the
// view fires, so the row appears in the database within a second of upload.
async function sbInsertDocumentPage(doc) {
  const u = await sbUser(); if (!u) return null;
  const row = buildDocPageRow(doc, u.id);
  // Compress oversized thumbnail before sending to Postgres.
  if (row.thumbnail_data_url) {
    row.thumbnail_data_url = await compressThumbForPersist(row.thumbnail_data_url);
  }
  // Hard cap on html_content too — 1 MB is plenty for Word page HTML and
  // keeps row size manageable for queries.
  if (row.html_content && row.html_content.length > 1024 * 1024) {
    row.html_content = row.html_content.slice(0, 1024 * 1024);
  }
  const { data, error } = await window.sb
    .from(DOC_TABLE)
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();
  if (error) {
    // Detailed failure log — without this, batch failures (constraint
    // violations on color or category, RLS blocks, FK errors) drop pages
    // silently and the user sees no thumbnail with no explanation. Log
    // includes the doc id + page number + the Postgres error code & detail
    // so root cause is obvious in the console. Also surfaces the SQL hint
    // when present, which Postgres uses to guide CHECK constraint failures.
    console.warn(
      'sbInsertDocumentPage failed for ' + (doc.id || '?') +
      ' page ' + (doc.pageNumber || '?') + '/' + (doc.totalPages || '?') + ': ' +
      (error.message || 'unknown') +
      (error.code ? ' [code=' + error.code + ']' : '') +
      (error.details ? ' [details=' + error.details + ']' : '') +
      (error.hint ? ' [hint=' + error.hint + ']' : '')
    );
    _noteCloudFail();
    // v8.5.3 Issue #2: surface the failure to the user. Without this,
    // a missing schema migration or RLS misconfiguration drops every
    // upload silently — local docs work in this session but vanish on
    // the next refresh because they never persisted. The toast doesn't
    // fire on every failure (would spam during batch failures), only
    // once per session per error code so the user sees ONE actionable
    // signal, not 100 duplicates.
    if (!window._sbInsertErrorReported) window._sbInsertErrorReported = new Set();
    const errKey = (error.code || 'unknown') + ':' + (error.message || '').slice(0, 40);
    if (!window._sbInsertErrorReported.has(errKey)) {
      window._sbInsertErrorReported.add(errKey);
      // Best-effort toast; if no toast available, the console.warn above
      // is the next-best signal.
      if (typeof window.toast === 'function') {
        try {
          window.toast(
            'Cloud save failed',
            'Doc upload not persisted: ' + (error.message || 'unknown') +
            (error.code ? ' (' + error.code + ')' : '') +
            ' — refresh may lose this doc.',
            'warning'
          );
        } catch(e) {}
      }
      if (typeof window.logAudit === 'function') {
        try {
          window.logAudit(
            'Cloud',
            'Doc insert failed · ' + (error.message || 'unknown') +
            (error.code ? ' (code ' + error.code + ')' : ''),
            'error'
          );
        } catch(e) {}
      }
    }
    // NOTE: Storage cleanup deliberately NOT done here. A previous attempt
    // to remove the storage binary on insert failure had a race: when
    // page 1 of a multi-page PDF fails first, pages 2..99 inserts may
    // still be in flight. The "are any other rows referencing this
    // storage_path" check would return 0, the binary would be deleted,
    // and pages 2..99 would commit successfully — pointing at a missing
    // binary. Result: visible-broken docs (worst failure mode).
    //
    // The correct cleanup point is the batch-level finalizer in the
    // docs view after all pending inserts have settled. See the call
    // site in processFileFromPipeline / _runUploadBatch for that logic.
    // Per-page failures here just return null and let the binary stay
    // in storage. Worst case: orphan binary (harmless cosmetic residue,
    // protected by the protect_delete trigger anyway).
    return null;
  }
  _noteCloudOk();
  return data;
}

// Patch a subset of columns on an existing doc. Used for the small-grain
// mutations: tag toggle, color change, rename, recategorize.
async function sbUpdateDocumentPage(docId, patch) {
  const u = await sbUser(); if (!u) return null;
  const { error } = await window.sb
    .from(DOC_TABLE)
    .update(patch)
    .eq('id', docId)
    .eq('user_id', u.id);  // belt-and-braces; RLS already enforces this
  if (error) {
    console.warn('sbUpdateDocumentPage failed:', error.message);
    _noteCloudFail();
    return null;
  }
  _noteCloudOk();
  return true;
}

// Persist annotations JSON only — used by the debounced auto-save inside
// the annotation engine. Strips DOM `el` references before saving so the
// payload is JSON-serializable.
async function sbUpdateDocumentAnnotations(docId, annoStore) {
  const safe = {
    layers: (annoStore?.layers || []).map(stripElFromLayer),
    undone: (annoStore?.undone || []).map(stripElFromLayer),
  };
  return sbUpdateDocumentPage(docId, { annotations: safe });
}

function stripElFromLayer(layer) {
  if (!layer || typeof layer !== 'object') return layer;
  // Copy without the `el` (DOM element ref) which can't serialize.
  const { el, ...rest } = layer;
  return rest;
}

// Delete a doc + its storage object.
async function sbDeleteDocumentPage(docId, storagePath) {
  const u = await sbUser(); if (!u) return null;
  // CRITICAL: a single storage object is shared by every page row from
  // one source (e.g. all 50 pages of a PDF point to the same .pdf upload).
  // Deleting the storage binary unconditionally would orphan every other
  // page that still points at it. Order:
  //   1. delete this row first
  //   2. count remaining rows with the same storage_path
  //   3. only delete the binary if no rows remain that reference it
  const { error } = await window.sb
    .from(DOC_TABLE)
    .delete()
    .eq('id', docId)
    .eq('user_id', u.id);
  if (error) {
    console.warn('sbDeleteDocumentPage failed:', error.message);
    _noteCloudFail();
    return null;
  }
  _noteCloudOk();
  if (storagePath) {
    // Count surviving rows that still need this binary. Use HEAD to
    // avoid pulling row data — we only need the count.
    const { count, error: countErr } = await window.sb
      .from(DOC_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', u.id)
      .eq('storage_path', storagePath);
    if (countErr) {
      // Conservative: if the count query fails, leave the binary alone
      // rather than risk orphaning sibling pages. Storage will be reaped
      // by sbDeleteAllDocumentPages or the submission cascade later.
      console.warn('sbDeleteDocumentPage ref-count failed; leaving binary in place:', countErr.message);
      return true;
    }
    if ((count || 0) === 0) {
      await sbDeleteDocumentFile(storagePath);
    }
  }
  return true;
}

// Pull every doc for the current user. Ordered newest-first so the view's
// default sort matches the DB result without a re-sort.
// ════════════════════════════════════════════════════════════════════
// v8.5.2 — METADATA-ONLY FETCH (slim + lazy thumbnails)
//
// v8.5.1 dropped extracted_text, html_content, and annotations from the
// hydrate query, but kept thumbnail_data_url. Even with the slim list,
// 223 rows × ~150KB thumbnail = ~33MB per fetch, which still hits the
// Postgres statement timeout (error 57014) on the SUB-MOMDRPB8 dataset.
//
// The Extension's empirical evidence:
//   • select=id,submission_id,page_number,created_at...     → 0.4s ✓
//   • select=*                                              → timeout ✗
//   • select=* with submission_id scope (still has thumb)   → timeout ✗
//
// Conclusion: thumbnail_data_url is the bottleneck. Drop it from hydrate
// and lazy-load per-doc as thumbnails come into view, same pattern used
// for extracted_text/html_content via sbFetchDocumentPageFull.
//
// Result: hydrate row size drops from ~150KB to <500 bytes per row.
// 223 rows = ~110KB total. Should complete in <1 second.
// ════════════════════════════════════════════════════════════════════
const DOC_HYDRATE_COLUMNS = [
  'id', 'user_id', 'submission_id',
  'file_name', 'file_size', 'file_mime_type',
  'storage_path', 'page_number', 'total_pages',
  'display_name', 'category', 'color', 'tagged',
  'pipeline_classification', 'pipeline_routed_to',
  'pipeline_tag', 'primary_bucket', 'relabeled_by_user',
  'created_at',
].join(',');

// v8.5.2: pagination. Even with the metadata-only column list, paginate
// in case the user has thousands of pages over time. PostgREST default
// limit is 1000 and the server can also enforce its own cap, so explicit
// pagination via .range() is more predictable than relying on defaults.
const DOC_HYDRATE_PAGE_SIZE = 500;

async function sbFetchDocumentPages(opts) {
  opts = opts || {};
  const u = await sbUser();
  // v8.6: throw instead of returning [] when not signed in. The previous
  // behavior masked auth-not-ready as "0 docs found", which made debugging
  // confusing — the UI showed "No documents yet" with no signal that auth
  // was the actual problem. The hydrate caller (hydrateFromCloud) already
  // calls waitForAuth(5000) earlier, so this throw path only fires if the
  // data layer is called directly from a code path that didn't wait.
  if (!u) {
    const err = new Error('Not signed in / auth not ready');
    err.supabaseCode = 'AUTH_NOT_READY';
    throw err;
  }

  // Single-page fetch helper. Used by the loop below for pagination.
  // Throws on error (no silent empty return).
  async function fetchPage(offset) {
    let q = window.sb
      .from(DOC_TABLE)
      .select(DOC_HYDRATE_COLUMNS);
    if (opts.submissionId) {
      q = q.eq('submission_id', opts.submissionId);
    } else {
      q = q.eq('user_id', u.id);
    }
    // Order matters for pagination consistency. file_name + page_number
    // groups pages of the same source file together (matches Rule 3
    // sortDocs grouping). created_at as tiebreaker.
    q = q.order('file_name',   { ascending: true })
         .order('page_number', { ascending: true })
         .order('created_at',  { ascending: false })
         .range(offset, offset + DOC_HYDRATE_PAGE_SIZE - 1);
    const { data, error } = await q;
    if (error) {
      const err = new Error(
        'document_pages fetch failed: ' + (error.message || 'unknown') +
        (error.code ? ' (code ' + error.code + ')' : '')
      );
      err.supabaseCode = error.code;
      err.supabaseMessage = error.message;
      err.supabaseDetails = error.details || null;
      err.supabaseHint = error.hint || null;
      throw err;
    }
    return data || [];
  }

  // Paginate until we get a short page (< page size). For most users
  // this is a single round-trip; the loop only kicks in beyond 500
  // docs per submission.
  const all = [];
  let offset = 0;
  let safety = 20;  // hard cap = 10,000 docs per submission
  while (safety-- > 0) {
    let page;
    try {
      page = await fetchPage(offset);
    } catch (err) {
      console.warn('sbFetchDocumentPages failed:', err.message, err.supabaseCode || '');
      _noteCloudFail();
      throw err;
    }
    all.push(...page);
    if (page.length < DOC_HYDRATE_PAGE_SIZE) break;
    offset += DOC_HYDRATE_PAGE_SIZE;
  }
  // v8.5.3 Issue #3: warn loudly if we hit the safety limit. Silent
  // truncation at 10,000 rows would mean the user has more docs than
  // we returned, but no signal anywhere — they'd see "all" their docs
  // and not know some are missing. With this warning, the cause shows
  // up in console and audit log so we can grow the limit if it ever
  // becomes a real problem.
  if (safety <= 0) {
    const msg = 'sbFetchDocumentPages safety cap hit at offset=' + offset +
                ' (returned ' + all.length + ' rows; more may exist). ' +
                'Increase DOC_HYDRATE_PAGE_SIZE or the safety counter if ' +
                'this is real production load, not a bug.';
    console.warn('[hydrate]', msg);
    if (typeof window.logAudit === 'function') {
      try { window.logAudit('Cloud', 'Hydrate truncated · ' + msg, 'warning'); } catch(e) {}
    }
  }
  _noteCloudOk();
  return all;
}

// v8.5.2: lazy thumbnail loader. Fetches thumbnail_data_url for one doc
// on demand. Used by the thumbnail enrichment pass that runs after
// hydrate, and by any feature that needs a thumbnail right now (e.g.,
// when a doc scrolls into view).
async function sbFetchDocumentPageThumbnail(docId) {
  const u = await sbUser(); if (!u) return null;
  if (!docId) return null;
  const { data, error } = await window.sb
    .from(DOC_TABLE)
    .select('id, thumbnail_data_url')
    .eq('user_id', u.id)
    .eq('id', docId)
    .maybeSingle();
  if (error) {
    console.warn('sbFetchDocumentPageThumbnail failed for ' + docId + ':', error.message);
    return null;
  }
  return data || null;
}

// Lazy-load the heavy fields for a single document on demand.
// Used by: OCR re-run (needs extracted_text), search (needs extracted_text),
// preview enlarge (needs html_content), annotation overlay (needs annotations).
// v8.5.2: also includes thumbnail_data_url since hydrate no longer fetches it.
async function sbFetchDocumentPageFull(docId) {
  const u = await sbUser(); if (!u) return null;
  if (!docId) return null;
  const { data, error } = await window.sb
    .from(DOC_TABLE)
    .select('id, extracted_text, html_content, annotations, thumbnail_data_url')
    .eq('user_id', u.id)
    .eq('id', docId)
    .maybeSingle();
  if (error) {
    console.warn('sbFetchDocumentPageFull failed for ' + docId + ':', error.message);
    return null;
  }
  return data || null;
}

// Bulk delete (used by clearAllDocs). One round-trip + one storage call.
//
// FIX #5 — DELETE ORDER REVERSED. Previously this function deleted storage
// objects FIRST and then deleted the database rows. If row deletion failed
// after storage succeeded, the rows would remain in the table but their
// preview/download links pointed at missing binaries — the worst failure
// mode (visible-but-broken docs). The safer order is: delete rows first,
// then storage. If storage fails after rows succeeded, you get harmless
// orphan binaries (already a known cosmetic issue protected by the
// protect_delete trigger), not visible-broken docs.
async function sbDeleteAllDocumentPages() {
  const u = await sbUser(); if (!u) return null;
  // Gather storage_paths first so we know what to clean. We don't delete
  // the binaries yet — we'll do that after the row deletion succeeds.
  const { data: rows, error: selErr } = await window.sb
    .from(DOC_TABLE)
    .select('storage_path')
    .eq('user_id', u.id);
  if (selErr) {
    console.warn('sbDeleteAllDocumentPages select failed:', selErr.message);
    return null;
  }
  const paths = (rows || []).map(r => r.storage_path).filter(Boolean);
  // STEP 1: Delete the database rows. If this fails, we abort — never
  // delete storage when we don't know if the rows are gone.
  const { error } = await window.sb
    .from(DOC_TABLE)
    .delete()
    .eq('user_id', u.id);
  if (error) {
    console.warn('sbDeleteAllDocumentPages row delete failed:', error.message);
    _noteCloudFail();
    return null;
  }
  // STEP 2: Now that rows are gone, clean up the storage binaries. A
  // failure here is non-fatal — orphan binaries are harmless cosmetic
  // residue and the protect_delete trigger blocks accidental cascades.
  // Log so future cleanup-via-Storage-UI knows what to expect.
  if (paths.length > 0) {
    const { error: stErr } = await window.sb.storage
      .from(STORAGE_BUCKET)
      .remove(paths);
    if (stErr) console.warn('sbDeleteAllDocumentPages storage cleanup (non-fatal):', stErr.message);
  }
  _noteCloudOk();
  return true;
}

// Phase 5 — cascade delete for a single submission. Removes every doc row
// linked to this submission_id plus its storage binaries. Called by
// app.js when an Altitude submission is deleted.
// ============================================================================
// v8.6.9 (per Justin's diagnostic + GPT external audit, round N+1):
// REMOVED the explicit document_pages DELETE entirely.
//
// HISTORY:
//   v8.5.7: chained child + parent delete in single try, child throws blocked
//           parent (revealed by Justin's "items don't stay deleted")
//   v8.6.8: changed child error path from "throw" to "log and continue"
//           so parent delete still runs after child error. BUT: still
//           awaited the explicit child DELETE first, which timed out at ~10s
//           on submissions with many pages (Carroll County: 223 pages).
//           User waiting 10s before parent delete starts → tab close /
//           navigation → parent never runs → row stays in cloud.
//   v8.6.9: don't issue the client-side document_pages DELETE at all.
//           Just collect storage paths (fast SELECT) for binary cleanup
//           later. Parent submission DELETE then triggers ON DELETE
//           CASCADE which Postgres executes server-side as part of the
//           parent transaction — empirically faster than the equivalent
//           client-issued DELETE (probably because the server-side cascade
//           runs as a single SQL statement with all locks already held).
//
// CONTRACT: this function returns the array of storage_paths so the caller
// (deleteSubmission in app.js) can clean up storage binaries AFTER the
// parent delete succeeds. Failure to collect paths means binaries become
// orphans in the storage bucket — cosmetic only, not a correctness issue.
// ============================================================================
async function sbCollectDocumentStoragePathsForSubmission(submissionId) {
  if (!submissionId) return [];
  const u = await sbUser();
  if (!u) return [];
  try {
    const { data: rows, error } = await window.sb
      .from(DOC_TABLE)
      .select('storage_path')
      .eq('user_id', u.id)
      .eq('submission_id', submissionId);
    if (error) {
      console.warn('[delete] storage_path collect failed; parent cascade will still delete rows:',
        error.code || '', error.message);
      _noteCloudFail();
      return [];
    }
    return (rows || []).map(r => r.storage_path).filter(Boolean);
  } catch (e) {
    console.warn('[delete] storage_path collect threw; parent cascade will still delete rows:', e.message);
    return [];
  }
}

// v8.6.9: helper for post-parent-delete storage cleanup. Centralizes
// access to STORAGE_BUCKET so app.js doesn't need a direct reference.
// Returns void; errors are logged but do not throw — orphan binaries
// are cosmetic only.
async function sbDeleteStoragePaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return;
  try {
    const { error } = await window.sb.storage.from(STORAGE_BUCKET).remove(paths);
    if (error) {
      console.warn('[delete] storage cleanup (non-fatal):', error.message);
    }
  } catch (e) {
    console.warn('[delete] storage cleanup threw (non-fatal):', e.message);
  }
}

// Backwards-compatibility shim: any callers still invoking the old name
// get the path-collection behavior, which is the only piece of work that
// actually needed to happen client-side. The explicit DELETE is gone.
// Returns true (matching old "ok" semantics) so callers that don't read
// the return value continue to work.
async function sbDeleteDocumentPagesForSubmission(submissionId) {
  // This function is now a thin wrapper — it just collects paths and
  // schedules a best-effort storage cleanup. The actual document_pages
  // row deletion happens via ON DELETE CASCADE when the parent
  // submission is deleted.
  const paths = await sbCollectDocumentStoragePathsForSubmission(submissionId);
  // Note: deletion of storage binaries is now handled by deleteSubmission
  // in app.js AFTER the parent delete succeeds. We don't fire the storage
  // remove() here because if the parent delete fails, we'd have stranded
  // the binaries while their referencing rows are still in the database.
  return paths;
}

window.sbUploadDocumentFile             = sbUploadDocumentFile;
window.sbGetDocumentSignedUrl           = sbGetDocumentSignedUrl;
window.sbDeleteDocumentFile             = sbDeleteDocumentFile;
window.sbInsertDocumentPage             = sbInsertDocumentPage;
window.sbUpdateDocumentPage             = sbUpdateDocumentPage;
window.sbUpdateDocumentAnnotations      = sbUpdateDocumentAnnotations;
window.sbDeleteDocumentPage             = sbDeleteDocumentPage;
window.sbFetchDocumentPages             = sbFetchDocumentPages;
window.sbFetchDocumentPageFull          = sbFetchDocumentPageFull;
window.sbFetchDocumentPageThumbnail     = sbFetchDocumentPageThumbnail;
window.sbDeleteAllDocumentPages         = sbDeleteAllDocumentPages;
window.sbDeleteDocumentPagesForSubmission = sbDeleteDocumentPagesForSubmission;
window.sbCollectDocumentStoragePathsForSubmission = sbCollectDocumentStoragePathsForSubmission;
window.sbDeleteStoragePaths = sbDeleteStoragePaths;
