// ============================================================================
// platform-auth.js — Speed to Market AI shared auth module   v8.7.61-phase3
//
// PHASE3-2026-06-09: single owner of the Supabase client + session events
// for BOTH app pages.
//   • Always (both pages): creates-or-adopts the one window.sb client,
//     subscribes onAuthStateChange once, maintains window.currentUser
//     (basic identity; pages with richer profiles overwrite it), and
//     exposes window.stmAuth { ready, onChange, signInWithMagicLink,
//     signOut, getClient }.
//   • Gate UI (overlay + magic-link form): ONLY on pages that opt in by
//     setting .stm-auth-pending on <html> before this script loads —
//     workbench.html does; platform.html keeps its own pipeline-core
//     overlay and consumes the shared events instead.
// Marketing index.html stays public (this file is simply not loaded there).
// ============================================================================
(function () {
  'use strict';

  const SUPABASE_URL = 'https://hscjnbolpxmiyujaxjyd.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_V0Vdf2RcNqR-UgZD3U_6CQ_Rmj-u4p5';

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function ensureClient() {
    if (!window.supabase || !window.supabase.createClient) return null;
    if (!window.stmAuthClient) {
      // PHASE3: adopt any pre-existing client first (legacy cached HTML where
      // pipeline-core created one) so there is never a second GoTrue instance.
      window.stmAuthClient = window.sb
        || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    window.sb = window.sb || window.stmAuthClient;
    return window.stmAuthClient;
  }

  // ── PHASE3: shared session core (runs immediately on BOTH pages) ──
  if (typeof window.STM_AUTH_UNIFIED === 'undefined') window.STM_AUTH_UNIFIED = true;
  const _authListeners = [];
  let _readyResolve;
  const _authReady = new Promise(r => { _readyResolve = r; });
  window.stmAuth = {
    ready: _authReady,
    getClient: ensureClient,
    onChange(cb) {
      if (typeof cb === 'function') _authListeners.push(cb);
      return () => { const i = _authListeners.indexOf(cb); if (i >= 0) _authListeners.splice(i, 1); };
    },
    async signInWithMagicLink(email) {
      const client = ensureClient();
      if (!client) return { error: new Error('Supabase library failed to load.') };
      return client.auth.signInWithOtp({
        email: String(email || '').trim(),
        options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + window.location.pathname }
      });
    },
    signOut() { return signOut(); }
  };
  (function initSharedSession() {
    const client = ensureClient();
    if (!client) { _readyResolve(null); return; }
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        window.currentUser = null;
      } else if (session && session.user && !window.currentUser) {
        // Basic identity only — pipeline-core's checkAuth overwrites this
        // with the richer users-table profile on the platform.
        window.currentUser = session.user;
      }
      for (const cb of _authListeners.slice()) { try { cb(event, session); } catch (e) {} }
    });
    client.auth.getSession()
      .then(({ data }) => _readyResolve((data && data.session) || null))
      .catch(() => _readyResolve(null));
  })();

  function buildOverlay() {
    if (document.getElementById('stmAuthOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'stmAuthOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:#0a0a0c;z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,sans-serif;';
    overlay.className = "ws-auth-overlay";
    overlay.innerHTML = `<div class="ws-auth-story">
  <a class="ws-brand" href="/platform"><span class="ws-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 7-7 7 7M5 19l7-7 7 7"/></svg></span><span>Speed to Market<span class="ws-brand-ai">AI WORKSPACE</span></span></a>
  <div class="ws-auth-story-main"><div class="ws-auth-eyebrow">BUILT AROUND THE UNDERWRITER</div><h1>From submission.<br>To decision.</h1><p>One connected workspace for your documents, analysis, and underwriting decisions.</p>
  <ol class="ws-auth-flow"><li><span>01</span><div><strong>Bring the account into focus</strong><small>Collect, classify, and organize every document.</small></div></li><li><span>02</span><div><strong>Turn information into insight</strong><small>Review extracted facts alongside their sources.</small></div></li><li><span>03</span><div><strong>Move forward with context</strong><small>Carry the submission into your underwriting workbench.</small></div></li></ol></div>
  <div class="ws-auth-footer">COMMERCIAL INSURANCE <span>ONE CONNECTED WORKSPACE</span></div>
 </div>
 <div class="ws-auth-form-side"><div class="ws-auth-card"><span class="ws-auth-kicker">YOUR WORKSPACE AWAITS</span><h2>Welcome back.</h2><p>Sign in to your underwriting workspace with your registered work email.</p>
 <label for="stmAuthEmail">Work email</label><input id="stmAuthEmail" type="email" placeholder="you@company.com" autocomplete="email" inputmode="email" required aria-describedby="stmAuthError stmAuthSuccess">
 <button id="stmAuthSendBtn" type="button">Send sign-in link <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></button>
 <div id="stmAuthError" role="alert"></div><div id="stmAuthSuccess" role="status" aria-live="polite"></div>
 <div class="ws-auth-note">No password needed. We’ll email you a link to sign in.</div>
 </div><span class="ws-auth-form-footer">Speed to Market AI · Underwriting operations</span></div>`;
    document.body.appendChild(overlay);
  }

  function updateSignedInUi(user) {
    const name = user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'User';
    const pill = document.querySelector('.topbar-pill--signal .topbar-pill-value');
    if (pill) pill.textContent = 'ACTIVE SESSION';
    const userName = document.querySelector('.topbar-user-name');
    if (userName) userName.textContent = name;
    const avatar = document.querySelector('.topbar-avatar');
    if (avatar) {
      avatar.textContent = String(name).split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() || 'UW';
    }
  }

  async function checkAuth() {
    buildOverlay();
    const err = document.getElementById('stmAuthError');
    const client = ensureClient();
    if (!client) {
      if (err) err.textContent = 'Supabase library failed to load.';
      return false;
    }
    const { data, error } = await client.auth.getSession();
    if (error) {
      if (err) err.textContent = error.message;
      return false;
    }
    if (!data.session) return false;
    window.currentUser = data.session.user;
    updateSignedInUi(data.session.user);
    const overlay = document.getElementById('stmAuthOverlay');
    if (overlay) overlay.remove();
    document.documentElement.classList.remove('stm-auth-pending');
    return true;
  }

  async function sendMagicLink() {
    const client = ensureClient();
    const email = (document.getElementById('stmAuthEmail')?.value || '').trim();
    const err = document.getElementById('stmAuthError');
    const ok = document.getElementById('stmAuthSuccess');
    if (err) err.textContent = '';
    if (ok) ok.textContent = '';
    if (!client) { if (err) err.textContent = 'Supabase library failed to load.'; return; }
    if (!email) { if (err) err.textContent = 'Enter your email.'; return; }
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.origin + window.location.pathname
      }
    });
    if (error) { console.warn('[auth] magic-link request did not complete:', error.message || error); }
    if (ok) ok.textContent = 'If that email is registered, you will receive a sign-in link shortly.';
  }

  async function signOut() {
    const client = ensureClient();
    if (client) await client.auth.signOut();
    window.location.reload();
  }

  window.stmCheckAuth = checkAuth;
  window.stmSendMagicLink = sendMagicLink;
  window.stmSignOut = signOut;

  document.addEventListener('DOMContentLoaded', () => {
    // PHASE3: the gate UI runs only on pages that opt in via .stm-auth-pending
    // (workbench.html sets it pre-load). platform.html provides its own
    // overlay in pipeline-core and consumes the shared events instead.
    if (!document.documentElement.classList.contains('stm-auth-pending')) return;
    buildOverlay();
    document.getElementById('stmAuthSendBtn')?.addEventListener('click', sendMagicLink);
    document.getElementById('stmAuthEmail')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); sendMagicLink(); }
    });
    checkAuth();
    // A magic-link session resolving AFTER first paint now dismisses the gate
    // without a manual refresh — same fix the platform overlay gets this phase.
    window.stmAuth.onChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') && session) checkAuth();
    });
  });
})();
