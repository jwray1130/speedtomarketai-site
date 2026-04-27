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
  const { data, error } = await window.sb
    .from('submissions')
    .select('id, snapshot, status, status_history, account_name, broker, effective_date, requested, missing_info, modules_run, confidence, pipeline_run, title, updated_at, created_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function sbSaveSubmission(sub) {
  const u = await sbUser(); if (!u) throw new Error('not signed in');
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
  // Phase 8.5 Round 4 fix #1: defensively delete child rows BEFORE deleting
  // the parent submission. If the Supabase schema has ON DELETE CASCADE on
  // submission_edits.submission_id and feedback_events.submission_id, these
  // pre-deletes are redundant but harmless. If it doesn't have cascades,
  // these prevent orphan rows from accumulating forever in those tables.
  // Both are best-effort: if a child delete fails (e.g. RLS quirk), we still
  // proceed with the parent delete so the user-visible "delete" succeeds.
  if (!id) return;
  try {
    await window.sb.from('submission_edits').delete().eq('submission_id', id);
  } catch (e) { console.warn('Pre-delete of submission_edits failed (continuing)', id, e); }
  try {
    await window.sb.from('feedback_events').delete().eq('submission_id', id);
  } catch (e) { console.warn('Pre-delete of feedback_events failed (continuing)', id, e); }
  const { error } = await window.sb.from('submissions').delete().eq('id', id);
  if (error) throw error;
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

    const row = {
      user_id:       u.id,
      submission_id: submissionId
                  || (typeof STATE !== 'undefined' && STATE.activeSubmissionId)
                  || null,
      category:      cat,
      message:       msg,
      meta:          metaText
    };
    const { error } = await window.sb.from('audit_events').insert(row);
    if (error) {
      // rule 2 — DO NOT call logAudit() here. Console only.
      console.warn('[audit] cloud write failed:', error.message || error);
    }
  } catch (e) {
    // rule 2 again — same reason.
    console.warn('[audit] cloud write threw:', (e && e.message) || e);
  }
}
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
    const subRows = await sbLoadSubmissions();
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
const THUMB_PERSIST_MAX_BYTES = 120 * 1024;   // 120 KB cap on the data URL string
const THUMB_PERSIST_MAX_WIDTH = 600;          // downscale wider images. 600px is
                                              // 2.5x oversample for the 240px
                                              // thumbnail UI — plenty for Retina,
                                              // small enough that text-heavy pages
                                              // compress under the byte cap at
                                              // reasonable JPEG quality.
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
          Math.min(img.naturalWidth, THUMB_PERSIST_MAX_WIDTH),  // first attempt: 600px
          Math.min(img.naturalWidth, 400),                       // second: 400px
          Math.min(img.naturalWidth, 280),                       // last resort: 280px (still > UI display size)
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
    console.warn('sbInsertDocumentPage failed:', error.message);
    _noteCloudFail();
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
async function sbFetchDocumentPages() {
  const u = await sbUser(); if (!u) return [];
  const { data, error } = await window.sb
    .from(DOC_TABLE)
    .select('*')
    .eq('user_id', u.id)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('sbFetchDocumentPages failed:', error.message);
    _noteCloudFail();
    return [];
  }
  _noteCloudOk();
  return data || [];
}

// Bulk delete (used by clearAllDocs). One round-trip + one storage call.
async function sbDeleteAllDocumentPages() {
  const u = await sbUser(); if (!u) return null;
  // First gather storage_paths so we can clean the bucket.
  const { data: rows, error: selErr } = await window.sb
    .from(DOC_TABLE)
    .select('storage_path')
    .eq('user_id', u.id);
  if (selErr) {
    console.warn('sbDeleteAllDocumentPages select failed:', selErr.message);
    return null;
  }
  const paths = (rows || []).map(r => r.storage_path).filter(Boolean);
  if (paths.length > 0) {
    const { error: stErr } = await window.sb.storage
      .from(STORAGE_BUCKET)
      .remove(paths);
    if (stErr) console.warn('sbDeleteAllDocumentPages storage failed:', stErr.message);
  }
  const { error } = await window.sb
    .from(DOC_TABLE)
    .delete()
    .eq('user_id', u.id);
  if (error) {
    console.warn('sbDeleteAllDocumentPages failed:', error.message);
    _noteCloudFail();
    return null;
  }
  _noteCloudOk();
  return true;
}

// Phase 5 — cascade delete for a single submission. Removes every doc row
// linked to this submission_id plus its storage binaries. Called by
// app.js when an Altitude submission is deleted.
async function sbDeleteDocumentPagesForSubmission(submissionId) {
  if (!submissionId) return null;
  const u = await sbUser(); if (!u) return null;
  // Gather paths first.
  const { data: rows, error: selErr } = await window.sb
    .from(DOC_TABLE)
    .select('storage_path')
    .eq('user_id', u.id)
    .eq('submission_id', submissionId);
  if (selErr) {
    console.warn('sbDeleteDocumentPagesForSubmission select failed:', selErr.message);
    _noteCloudFail();
    return null;
  }
  const paths = (rows || []).map(r => r.storage_path).filter(Boolean);
  if (paths.length > 0) {
    const { error: stErr } = await window.sb.storage
      .from(STORAGE_BUCKET)
      .remove(paths);
    if (stErr) console.warn('sbDeleteDocumentPagesForSubmission storage failed:', stErr.message);
  }
  const { error } = await window.sb
    .from(DOC_TABLE)
    .delete()
    .eq('user_id', u.id)
    .eq('submission_id', submissionId);
  if (error) {
    console.warn('sbDeleteDocumentPagesForSubmission failed:', error.message);
    _noteCloudFail();
    return null;
  }
  _noteCloudOk();
  return true;
}

window.sbUploadDocumentFile             = sbUploadDocumentFile;
window.sbGetDocumentSignedUrl           = sbGetDocumentSignedUrl;
window.sbDeleteDocumentFile             = sbDeleteDocumentFile;
window.sbInsertDocumentPage             = sbInsertDocumentPage;
window.sbUpdateDocumentPage             = sbUpdateDocumentPage;
window.sbUpdateDocumentAnnotations      = sbUpdateDocumentAnnotations;
window.sbDeleteDocumentPage             = sbDeleteDocumentPage;
window.sbFetchDocumentPages             = sbFetchDocumentPages;
window.sbDeleteAllDocumentPages         = sbDeleteAllDocumentPages;
window.sbDeleteDocumentPagesForSubmission = sbDeleteDocumentPagesForSubmission;
