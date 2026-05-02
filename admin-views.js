// ============================================================================
// admin-views.js — Altitude / Speed to Market AI
// ============================================================================
// Extracted from supabase-data.js (renderers) and app.html (refreshAudit) as
// Phase 8 step 4 (maintainability split). Pure view code: takes data fetched
// by sb* helpers and renders HTML for the admin operator console.
//
// Loaded via <script src="admin-views.js"> AFTER supabase-data.js (which
// defines the sb* helpers these renderers call) and AFTER the inline init
// script that creates window.sb / window.currentUser.
//
// External globals this file uses at CALL time:
//   window.sb              — Supabase client (via sb* helpers, not directly)
//   window.currentUser     — role-gating
//   STATE                  — STATE.adminAudit pagination state, STATE.audit
//   sbLoadAdminUsers       — Phase 6 step 2 admin Users data fetch
//   sbLoadFeedbackSummary, sbLoadFeedbackRecent — Phase 6 step 3 feedback data
//   sbLoadAuditEvents, sbLoadAuditCategories   — Phase 6 step 7 audit data
//   logAudit, toast        — diagnostic helpers
//   escapeHtml             — XSS sanitizer
//   updateFeedbackCount    — non-admin fallback for refreshFeedbackCard
//   renderAuditIfOpen      — non-admin fallback for refreshAudit
//
// All renderers and UI handlers are exported on window via the explicit
// footer block — the same lesson learned in step 3 (relying on automatic
// global attachment is fragile across script boundaries).
//
// Phase 8 design rule: byte-for-byte preservation of every function body.
// No logic changed. Only thing that moved is where the bytes live on disk.
// ============================================================================

// v8.6.14: structured-meta summarization for the audit log column.
// Several producers (LLM proxy, pipeline, classifier) emit JSON in the
// audit `meta` field with rich diagnostic data. The previous render
// truncated meta to 40 chars which produced useless slices like
// `{"status":200,"request_bytes":3492,"resp`. This helper detects JSON
// and renders a compact human-readable summary of the most diagnostic
// fields, falling back to text truncation for non-JSON meta.
//
// Recognized JSON fields (any subset OK, all optional):
//   status            HTTP status code
//   model             Anthropic model name (claude-3-5-sonnet, etc.)
//   latency_ms        Per-attempt latency in milliseconds
//   ray_id            Cloudflare Ray ID for support escalation
//   error_category    Categorized error (timeout, network, 5xx, etc.)
//   request_bytes     Outbound payload size
//   response_bytes    Inbound payload size
//   attempt           Retry attempt number
//   max_attempts      Configured retry ceiling
//
// Renders as e.g.:
//   200 · sonnet · 1843ms · ray:8a3f9 · req:3492 res:18204
//   ERR · timeout · 30000ms · attempt 3/4
function summarizeMeta(metaText) {
  if (metaText == null) return '—';
  const s = String(metaText).trim();
  if (!s || s === '—') return '—';

  // Fast-path: only attempt JSON parse if the string looks like an object.
  // Avoids try/catch overhead for the common case of non-JSON strings.
  let j = null;
  if (s.length > 1 && s.charAt(0) === '{') {
    try { j = JSON.parse(s); } catch { j = null; }
  }

  if (!j || typeof j !== 'object') {
    // Non-JSON meta — fall back to original 40-char truncation.
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  }

  const parts = [];

  // Status: highlight HTTP errors with ERR prefix
  if (j.status != null) {
    const st = Number(j.status);
    if (st === 0)              parts.push('NET·ERR');           // network/abort
    else if (st >= 200 && st < 300) parts.push(String(st));
    else                       parts.push('ERR·' + st);
  }

  // Error category (timeout, network, 5xx_with_retry, etc.)
  if (j.error_category) parts.push(String(j.error_category));

  // Model — strip the redundant "claude-" prefix for compactness
  if (j.model) {
    const m = String(j.model).replace(/^claude-/, '');
    parts.push(m);
  }

  // Latency
  if (j.latency_ms != null) parts.push(j.latency_ms + 'ms');

  // Cloudflare Ray ID — only the first 5 chars (enough to grep CF logs)
  if (j.ray_id) parts.push('ray:' + String(j.ray_id).slice(0, 5));

  // Byte sizes — combined into one segment for compactness
  if (j.request_bytes != null || j.response_bytes != null) {
    const reqK = j.request_bytes != null ? Math.round(j.request_bytes / 1024) : null;
    const resK = j.response_bytes != null ? Math.round(j.response_bytes / 1024) : null;
    const sizeBits = [];
    if (reqK != null) sizeBits.push('req:' + reqK + 'k');
    if (resK != null) sizeBits.push('res:' + resK + 'k');
    if (sizeBits.length) parts.push(sizeBits.join(' '));
  }

  // Retry attempt context
  if (j.attempt != null) {
    const max = j.max_attempts != null ? '/' + j.max_attempts : '';
    parts.push('try:' + j.attempt + max);
  }

  if (parts.length === 0) {
    // JSON had no recognized fields — fall back to text truncation.
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  }

  const summary = parts.join(' · ');
  // Cap the summary too — if too many fields are populated we don't want
  // the row growing unboundedly. The full meta is in the tooltip.
  return summary.length > 80 ? summary.slice(0, 80) + '…' : summary;
}

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
      // v8.6.14: structured-meta summarization. Several producers (LLM proxy,
      // pipeline, classifier) emit JSON in `meta` with status/model/latency/
      // ray_id/error_category/etc. The old code truncated to 40 chars which
      // showed `{"status":200,"request_bytes":3492,"resp` — useless for
      // forensic debugging. summarizeMeta() detects JSON, picks the most
      // diagnostic fields, and renders a compact human-readable summary.
      // Falls back to the same 40-char truncation for non-JSON meta.
      const metaShort = summarizeMeta(metaText);
      // Title tooltip reveals full timestamp, user_id prefix, submission_id
      // AND the raw meta JSON for deep-dive — useful forensic detail without
      // cluttering the row.
      const tooltipBits = [date + ' ' + time];
      if (r.user_id) tooltipBits.push('user:' + r.user_id.slice(0, 8));
      if (r.submission_id) tooltipBits.push('sub:' + r.submission_id);
      if (metaText && metaText !== '—' && metaText.length > 0) {
        tooltipBits.push('meta:' + (metaText.length > 400 ? metaText.slice(0, 400) + '…' : metaText));
      }
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

// ---- refreshAudit dispatcher (moved from app.html main block) ----------
// Phase 6 step 7: "Clear" was renamed to "Refresh" because the log is now
// cloud-persisted and "clearing" is misleading (nothing gets deleted). For
// admins, re-fetch page 1 under the active filter. For non-admins, just
// re-paint the session view (effectively a no-op but gives visual feedback).
function refreshAudit() {
  if (window.currentUser && window.currentUser.role === 'admin') {
    renderAdminAuditLog({ append: false });
    if (typeof toast === 'function') toast('Audit log refreshed');
  } else {
    renderAuditIfOpen();
    if (typeof toast === 'function') toast('View refreshed');
  }
}
window.refreshAudit = refreshAudit;

// ============================================================================
// Phase 8 step 4: explicit window-exports for every top-level declaration.
// Same pattern as supabase-data.js — never rely on implicit global attachment
// across script boundaries. Some of these were already exported inline above
// (Phase 6 era code), reassigning is idempotent and harmless.
// ============================================================================
window.renderAdminUsersCard = renderAdminUsersCard;
window.renderAdminFeedbackCard = renderAdminFeedbackCard;
window.refreshFeedbackCard = refreshFeedbackCard;
window.renderAdminAuditLog = renderAdminAuditLog;
window.onAuditCategoryChange = onAuditCategoryChange;
window.onAuditLoadOlder = onAuditLoadOlder;
window.refreshAudit = refreshAudit;
