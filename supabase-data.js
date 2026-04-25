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

// Bridge: the original `const sb = ...` declaration lives in app.html and
// is not visible to this file's scope. Re-bind `sb` here from window.sb
// (which app.html stashes immediately after creating the client). This
// preserves byte-for-byte equivalence in every function body below.
const sb = window.sb;

// ============================================================================
// SUPABASE DATA-ACCESS HELPERS  (Phase 4 — localStorage → Supabase migration)
// Every other function in the app calls THESE helpers; no other place talks to
// Supabase directly for data. Auth and LLM proxy paths are separate (above).
// ============================================================================

async function sbUser() {
  const { data: { user } } = await sb.auth.getUser();
  return user;   // null if signed out
}

// ---- Submissions ----------------------------------------------------------
// One row per submission. The whole per-submission object (files-lite,
// extractions, edits, etc.) goes into the `snapshot` jsonb column.
async function sbLoadSubmissions() {
  const { data, error } = await sb
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
  const { data, error } = await sb
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
  const { error } = await sb.from('submissions').delete().eq('id', id);
  if (error) throw error;
}

// ---- Edits / Custom cards / Hidden cards ---------------------------------
async function sbLoadEdits(submissionId) {
  const { data, error } = await sb
    .from('submission_edits')
    .select('module_key, edit_type, payload, updated_at')
    .eq('submission_id', submissionId);
  if (error) throw error;
  return data || [];
}

async function sbSaveEdit(submissionId, moduleKey, editType, payload, pipelineRun) {
  const u = await sbUser(); if (!u) throw new Error('not signed in');
  const { error } = await sb
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
  const { error } = await sb
    .from('submission_edits').delete()
    .eq('submission_id', submissionId).eq('module_key', moduleKey);
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
  const { error } = await sb.from('submission_edits')
    .upsert(rows, { onConflict: 'submission_id,module_key' });
  if (error) throw error;
}

// ---- Feedback ------------------------------------------------------------
// Load all feedback events for a given submission. Used on rehydrate so the
// UW sees their prior 👍/👎/💬 reactions on the same cards after refresh or
// when opening an archived submission. Empty array if none or on error.
async function sbLoadFeedbackForSubmission(submissionId) {
  if (!submissionId) return [];
  const { data, error } = await sb
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
  const { error } = await sb.from('feedback_events').insert({
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
    const { error } = await sb.from('audit_events').insert(row);
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
  const { data, error } = await sb
    .from('user_settings').select('*').eq('user_id', u.id).maybeSingle();
  if (error) throw error;
  return data;
}

async function sbSaveSettings(patch) {
  const u = await sbUser(); if (!u) throw new Error('not signed in');
  const row = { user_id: u.id, ...patch };
  const { error } = await sb
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
    sb.from('users').select('id, email, display_name, role, created_at'),
    sb.from('submissions').select('user_id')
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

// Render the real Users & roles admin card. Called when the Admin tab opens.
// Silent no-op for non-admins — they keep the static placeholder visuals.
// Errors are caught and surfaced in the card status; logAudit captures them
// for the audit trail.
async function renderAdminUsersCard() {
  if (!window.currentUser || window.currentUser.role !== 'admin') return;
  const statusEl = document.getElementById('usersAdminStatus');
  const listEl   = document.getElementById('usersAdminList');
  if (!statusEl || !listEl) return;

  statusEl.textContent = 'LOADING…';
  try {
    const users = await sbLoadAdminUsers();
    const roleCount = new Set(users.map(x => x.role)).size;
    statusEl.textContent =
      users.length + ' USER'  + (users.length === 1 ? '' : 'S') + ' · ' +
      roleCount    + ' ROLE'  + (roleCount    === 1 ? '' : 'S');

    listEl.style.display   = 'block';
    listEl.style.marginTop = '12px';
    listEl.style.maxHeight = '220px';
    listEl.style.overflowY = 'auto';

    if (users.length === 0) {
      listEl.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-3); font-size: 11px;">No users yet.</div>';
      return;
    }

    listEl.innerHTML = users.map(x => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line-warm); font-family: var(--font-mono); font-size: 11px;">
        <div style="min-width: 0; flex: 1;">
          <div style="color: var(--text); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(x.display_name || '(no name)')}</div>
          <div style="color: var(--text-3); font-size: 10px; letter-spacing: 0.03em; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(x.email || '')} · ${escapeHtml(x.role || '?')}</div>
        </div>
        <div style="color: var(--signal-ink); font-size: 10.5px; letter-spacing: 0.05em; padding-left: 12px; white-space: nowrap;">${x.submission_count} SUB${x.submission_count === 1 ? '' : 'S'}</div>
      </div>
    `).join('');
  } catch (e) {
    console.warn('[admin] users load failed:', e.message || e);
    statusEl.textContent = 'LOAD FAILED';
    listEl.style.display = 'none';
    if (typeof logAudit === 'function') {
      logAudit('Admin', 'Users panel load failed: ' + (e.message || e), 'error');
    }
  }
}
window.renderAdminUsersCard = renderAdminUsersCard;

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
  const { data, error } = await sb
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
  const { data, error } = await sb
    .from('feedback_events')
    .select('id, user_id, submission_id, module_key, rating, comment, context, created_at')
    .order('created_at', { ascending: false })
    .limit(limit || 10);
  if (error) throw error;
  return data || [];
}
window.sbLoadFeedbackRecent = sbLoadFeedbackRecent;

async function renderAdminFeedbackCard() {
  if (!window.currentUser || window.currentUser.role !== 'admin') return;
  const statusEl = document.getElementById('feedbackStatus');
  const listEl   = document.getElementById('feedbackAdminList');
  if (!statusEl) return;

  statusEl.textContent = 'LOADING…';
  try {
    const [summary, recent] = await Promise.all([
      sbLoadFeedbackSummary(),
      sbLoadFeedbackRecent(10)
    ]);

    if (summary.total === 0) {
      statusEl.textContent = 'NO EVENTS YET';
      if (listEl) listEl.style.display = 'none';
      return;
    }

    // Status line: "47 EVENTS · 32 👍 · 10 👎 · 5 💬 · 12 NEW"
    const parts = [summary.total + ' EVENT' + (summary.total === 1 ? '' : 'S')];
    if (summary.up)         parts.push(summary.up      + ' 👍');
    if (summary.down)       parts.push(summary.down    + ' 👎');
    if (summary.comment)    parts.push(summary.comment + ' 💬');
    if (summary.unexported && summary.unexported !== summary.total) {
      parts.push(summary.unexported + ' NEW');
    }
    statusEl.textContent = parts.join(' · ');

    if (!listEl) return;
    listEl.style.display   = 'block';
    listEl.style.marginTop = '12px';
    listEl.style.maxHeight = '260px';
    listEl.style.overflowY = 'auto';

    listEl.innerHTML = recent.map(r => {
      const icon = r.rating === 'up'      ? '👍'
                 : r.rating === 'down'    ? '👎'
                 : r.rating === 'comment' ? '💬' : '·';
      const when = r.created_at
        ? new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ')
        : '';
      // module_key is stored with a prefix (card:/custom:/level:) — strip for display.
      // Fall back to context.moduleName if the key is bare.
      const ctx = r.context || {};
      const moduleLabel = ctx.moduleName
                       || (r.module_key ? r.module_key.replace(/^card:|^custom:|^level:/, '') : '(no module)');
      const actor = ctx.actor || '';
      const bodyRaw = r.comment || ctx.reason || '—';
      const body = bodyRaw.length > 140 ? bodyRaw.slice(0, 140) + '…' : bodyRaw;
      return `
        <div style="padding: 8px 0; border-bottom: 1px solid var(--line-warm); font-family: var(--font-mono); font-size: 11px;">
          <div style="display: flex; justify-content: space-between; gap: 8px; margin-bottom: 3px;">
            <span style="color: var(--text); font-weight: 500;">${icon} ${escapeHtml(moduleLabel)}</span>
            <span style="color: var(--text-3); font-size: 10px; white-space: nowrap;">${escapeHtml(when)}</span>
          </div>
          <div style="color: var(--text-2); font-size: 10.5px; line-height: 1.4; margin-bottom: 2px;">${escapeHtml(body)}</div>
          ${actor ? `<div style="color: var(--text-3); font-size: 9.5px; letter-spacing: 0.04em;">${escapeHtml(actor)}</div>` : ''}
        </div>
      `;
    }).join('');
  } catch (e) {
    console.warn('[admin] feedback load failed:', e.message || e);
    statusEl.textContent = 'LOAD FAILED';
    if (listEl) listEl.style.display = 'none';
    if (typeof logAudit === 'function') {
      logAudit('Admin', 'Feedback panel load failed: ' + (e.message || e), 'error');
    }
  }
}
window.renderAdminFeedbackCard = renderAdminFeedbackCard;

// Refresh dispatcher wired to the Feedback card's Refresh button. Admins re-
// fetch cloud-truth. Non-admins fall back to updateFeedbackCount() so the
// button still does something meaningful in a session-local context.
async function refreshFeedbackCard() {
  if (window.currentUser?.role === 'admin') {
    await renderAdminFeedbackCard();
    if (typeof toast === 'function') toast('Feedback refreshed');
  } else if (typeof updateFeedbackCount === 'function') {
    updateFeedbackCount();
    if (typeof toast === 'function') toast('View refreshed');
  }
}
window.refreshFeedbackCard = refreshFeedbackCard;

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
  let q = sb.from('audit_events')
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
  const { data, error } = await sb
    .from('audit_events').select('category').limit(5000);
  if (error) throw error;
  const set = new Set((data || []).map(r => r.category).filter(Boolean));
  return Array.from(set).sort();
}
window.sbLoadAuditCategories = sbLoadAuditCategories;

// Render the cloud audit log into #auditEntries. Admin-gated. Two call
// shapes: { append: false } resets and loads page 1; { append: true } fetches
// the next page using the oldest loaded row's created_at as the cursor.
async function renderAdminAuditLog(opts) {
  if (!window.currentUser || window.currentUser.role !== 'admin') return;
  const el = document.getElementById('auditEntries');
  const countEl = document.getElementById('auditCount');
  if (!el) return;
  const append = !!(opts && opts.append);
  const state = STATE.adminAudit;

  if (!append) {
    el.innerHTML = '<div style="padding: 30px 18px; text-align: center; color: var(--text-3); font-size: 12px;">Loading cloud audit log…</div>';
  }

  try {
    // First-time load: fetch the category list for the filter dropdown. Stash
    // on state so we don't re-fetch on every page turn / filter change.
    if (!state.categories) {
      try { state.categories = await sbLoadAuditCategories(); }
      catch (e) { state.categories = []; console.warn('[admin] audit categories failed:', e.message || e); }
    }

    const rows = await sbLoadAuditEvents({
      category: state.category,
      beforeCreatedAt: (append && state.rows.length > 0)
        ? state.rows[state.rows.length - 1].created_at
        : null,
      limit: 50
    });
    state.hasMore = rows.length === 50;
    state.rows = append ? state.rows.concat(rows) : rows;

    if (countEl) {
      countEl.textContent = state.rows.length > 0
        ? '· ' + state.rows.length + ' event' + (state.rows.length === 1 ? '' : 's') + (state.hasMore ? '+' : '')
        : '';
    }

    // Controls row: category filter dropdown + scope label. Injected at the
    // top of #auditEntries so it's part of the scrollable area.
    const categoryOptions = ['<option value="all">All categories</option>']
      .concat((state.categories || []).map(c =>
        `<option value="${escapeHtml(c)}"${c === state.category ? ' selected' : ''}>${escapeHtml(c)}</option>`
      )).join('');
    const controls = `
      <div style="display: flex; align-items: center; gap: 10px; padding: 10px 18px; border-bottom: 1px solid var(--line-warm); background: var(--surface-2); font-family: var(--font-mono); font-size: 11px;">
        <span style="color: var(--text-3); letter-spacing: 0.04em;">FILTER:</span>
        <select id="auditCategorySelect" onchange="onAuditCategoryChange(this.value)" style="background: var(--surface); color: var(--text); border: 1px solid var(--line-warm); border-radius: 3px; padding: 4px 8px; font-family: var(--font-mono); font-size: 11px; cursor: pointer;">
          ${categoryOptions}
        </select>
        <span style="color: var(--text-3); margin-left: auto; letter-spacing: 0.04em;">CLOUD · ALL USERS · NEWEST FIRST</span>
      </div>
    `;

    if (state.rows.length === 0) {
      el.innerHTML = controls +
        '<div style="padding: 30px 18px; text-align: center; color: var(--text-3); font-size: 12px;">No events' +
        (state.category !== 'all' ? ' in category &quot;' + escapeHtml(state.category) + '&quot;' : '') +
        '.</div>';
      return;
    }

    const entriesHtml = state.rows.map(r => {
      const t = r.created_at ? new Date(r.created_at) : null;
      const time = t ? t.toISOString().slice(11, 19) : '';
      const date = t ? t.toISOString().slice(0, 10) : '';
      const metaText = r.meta || '—';
      const metaShort = metaText.length > 40 ? metaText.slice(0, 40) + '…' : metaText;
      // Title tooltip reveals full timestamp, user_id prefix, and submission_id
      // on hover — useful forensic detail without cluttering the row.
      const tooltipBits = [date + ' ' + time];
      if (r.user_id) tooltipBits.push('user:' + r.user_id.slice(0, 8));
      if (r.submission_id) tooltipBits.push('sub:' + r.submission_id);
      return `
        <div class="audit-entry" title="${escapeHtml(tooltipBits.join(' · '))}">
          <span class="audit-time">${escapeHtml(time)}</span>
          <span class="audit-actor">${escapeHtml(r.category || '')}</span>
          <span class="audit-action">${escapeHtml(r.message || '')}</span>
          <span class="audit-ver">${escapeHtml(metaShort)}</span>
        </div>
      `;
    }).join('');

    const loadMore = state.hasMore
      ? `<div style="padding: 14px 18px; text-align: center; border-top: 1px solid var(--line-warm);"><button onclick="onAuditLoadOlder()" style="background: transparent; color: var(--signal-ink); border: 1px solid var(--signal); border-radius: 999px; padding: 6px 18px; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.06em; font-weight: 600; text-transform: uppercase; cursor: pointer;">Load older ↓</button></div>`
      : `<div style="padding: 14px 18px; text-align: center; color: var(--text-3); font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.04em;">End of log</div>`;

    el.innerHTML = controls + entriesHtml + loadMore;
  } catch (e) {
    console.warn('[admin] audit log load failed:', e.message || e);
    el.innerHTML = '<div style="padding: 30px 18px; text-align: center; color: var(--text-3); font-size: 12px;">Failed to load cloud audit log: ' + escapeHtml(e.message || String(e)) + '</div>';
    if (typeof logAudit === 'function') {
      logAudit('Admin', 'Audit log load failed: ' + (e.message || e), 'error');
    }
  }
}
window.renderAdminAuditLog = renderAdminAuditLog;

// Filter dropdown change — reset pagination, reload page 1 under new filter.
function onAuditCategoryChange(cat) {
  STATE.adminAudit.category = cat || 'all';
  renderAdminAuditLog({ append: false });
}
window.onAuditCategoryChange = onAuditCategoryChange;

// Load-older button — fetch the next page using cursor on oldest loaded row.
function onAuditLoadOlder() {
  renderAdminAuditLog({ append: true });
}
window.onAuditLoadOlder = onAuditLoadOlder;

// ---- Master hydration: pull everything for the signed-in user -----------
// Called from checkAuth() once we have a session. Populates STATE.* from
// Supabase, replacing whatever the legacy localStorage loaders would have
// done. Safe to call multiple times.
async function sbHydrate() {
  if (typeof logAudit === 'function') logAudit('Supabase', 'Hydrate starting…', 'ok');
  try {
    // Defensive: if the session hasn't resolved yet, sbLoadSubmissions will
    // hit RLS and return 0 rows silently. Wait briefly for auth to settle.
    const sess = await sb.auth.getSession();
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
