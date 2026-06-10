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
    overlay.innerHTML = `
      <div style="position:absolute;inset:0;background:radial-gradient(circle at 30% 20%,rgba(158,196,255,.25),transparent 35%),radial-gradient(circle at 75% 60%,rgba(255,97,171,.18),transparent 34%),#0a0a0c;"></div>
      <div style="position:absolute;top:24px;left:32px;z-index:2;display:flex;align-items:center;gap:10px;color:#fafafa;font-size:14px;font-weight:600;">
        <span style="display:inline-flex;width:26px;height:26px;border-radius:6px;border:1.5px solid #9ec4ff;align-items:center;justify-content:center;color:#9ec4ff;">⌃</span>
        Speed to Market <em style="font-style:italic;color:#9ec4ff;margin-left:2px;">AI</em>
      </div>
      <div style="position:relative;z-index:1;background:rgba(20,20,23,.70);backdrop-filter:blur(28px) saturate(150%);-webkit-backdrop-filter:blur(28px) saturate(150%);padding:42px 38px 36px;border-radius:18px;width:420px;max-width:90%;box-shadow:0 30px 80px -30px rgba(0,0,0,.85),0 0 0 1px rgba(255,255,255,.10);text-align:left;">
        <div style="font-family:'Geist Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.18em;color:#9ec4ff;text-transform:uppercase;margin-bottom:14px;display:inline-flex;align-items:center;gap:8px;"><span style="display:inline-block;width:14px;height:1px;background:#9ec4ff;"></span>Sign in</div>
        <div style="font-size:30px;color:#fafafa;font-weight:650;letter-spacing:-.025em;line-height:1.1;margin-bottom:10px;">Open the <em style="font-style:italic;font-weight:500;background:linear-gradient(180deg,#FF61AB 0%,#C8A2FF 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;">workbench</em>.</div>
        <div style="font-size:13.5px;color:#a0a0a8;line-height:1.5;margin-bottom:24px;">Enter your work email. We’ll send a magic link — no password, no setup.</div>
        <input id="stmAuthEmail" type="email" placeholder="you@company.com" autocomplete="email" style="width:100%;box-sizing:border-box;padding:13px 15px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(10,10,12,.55);color:#fafafa;font-size:14px;font-family:inherit;margin-bottom:12px;outline:none;" />
        <button id="stmAuthSendBtn" type="button" style="width:100%;padding:13px 18px;border-radius:999px;border:0;background:linear-gradient(180deg,#c0d8ff 0%,#9ec4ff 100%);color:#0a0a0c;font-weight:700;font-size:13.5px;font-family:inherit;cursor:pointer;box-shadow:0 1px 0 rgba(255,255,255,.25) inset,0 6px 18px -6px rgba(158,196,255,.5);">Send magic link →</button>
        <div id="stmAuthError" style="color:#ff7a7a;font-size:11.5px;margin-top:14px;min-height:14px;font-family:'Geist Mono',ui-monospace,monospace;letter-spacing:.04em;"></div>
        <div id="stmAuthSuccess" style="color:#9ec4ff;font-size:11.5px;margin-top:4px;min-height:14px;font-family:'Geist Mono',ui-monospace,monospace;letter-spacing:.04em;"></div>
      </div>`;
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
