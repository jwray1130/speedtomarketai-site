/* Shared presentation adapter. No submission writes, requests or rating changes. */
(() => {
  'use strict';
  window.STM_UI_BUILD = 'workspace-2026.09.08.1';
  const root = document.documentElement;
  const isWorkbench = root.dataset.workspace === 'workbench';
  const names = { queue: 'Queue', submission: 'Submission Pipeline', documents: 'File Manager', workbench: 'Underwriting Workbench', admin: 'Admin' };
  let savedTheme;
  try { savedTheme = localStorage.getItem('stm-theme'); } catch (_) {}
  root.dataset.theme = savedTheme === 'dark' ? 'dark' : 'light';
  new MutationObserver(() => {
    // The legacy pages have opposite absent-attribute defaults. Canonicalize
    // only that representation while retaining their existing toggle handlers.
    if (!root.hasAttribute('data-theme')) root.dataset.theme = isWorkbench ? 'light' : 'dark';
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  function init() {
    const rail = document.getElementById('workspaceRail');
    const topbar = document.querySelector('.ws-topbar');
    if (!rail || !topbar) return;
    const leading = topbar.firstElementChild;
    const crumb = document.createElement('div');
    crumb.className = 'ws-breadcrumb';
    crumb.innerHTML = '<button class="ws-mobile-toggle" type="button" aria-label="Open workspace navigation" aria-controls="workspaceRail" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><span>Workspace</span><span class="ws-breadcrumb-separator" aria-hidden="true">/</span><strong id="wsCurrentView"></strong>';
    leading.prepend(crumb);
    const mobileToggle = crumb.querySelector('button');
    const mq = window.matchMedia('(max-width: 760px)');
    function setRail(open, restoreFocus = false) {
      document.body.classList.toggle('ws-nav-open', open);
      mobileToggle.setAttribute('aria-expanded', String(open));
      rail.inert = mq.matches && !open;
      if (mq.matches) rail.setAttribute('aria-hidden', String(!open));
      else rail.removeAttribute('aria-hidden');
      if (restoreFocus) mobileToggle.focus();
    }
    mobileToggle.addEventListener('click', () => {
      const open = !document.body.classList.contains('ws-nav-open');
      setRail(open);
      if (open) rail.querySelector('.ws-nav-item.active, .ws-nav-item')?.focus();
    });
    document.querySelector('.ws-rail-dismiss')?.addEventListener('click', () => setRail(false, true));
    rail.addEventListener('click', event => { if (event.target.closest('[data-system-target]') && mq.matches) setRail(false, true); }, true);
    rail.querySelector('.ws-brand')?.addEventListener('click', event => {
      if (!isWorkbench && typeof window.navigateSystem8706 === 'function') {
        event.preventDefault(); window.navigateSystem8706('queue'); setRail(false);
      }
    });
    document.addEventListener('keydown', event => {
      if (!mq.matches || !document.body.classList.contains('ws-nav-open')) return;
      if (event.key === 'Escape') { event.preventDefault(); setRail(false, true); }
      if (event.key === 'Tab') {
        const items = [...rail.querySelectorAll('a[href],button:not(:disabled),[tabindex="0"]')].filter(el => el.getClientRects().length);
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    mq.addEventListener('change', () => setRail(false));
    setRail(false);

    // Move the original nodes, preserving handlers and IDs. Do not clone forms.
    const build = topbar.querySelector('#versionBadge');
    const user = topbar.querySelector('.avatar,.topbar-user');
    if (build) document.getElementById('wsBuildSlot')?.append(build);
    const uiBuild = document.createElement('div');
    uiBuild.className = 'ws-ui-build'; uiBuild.textContent = 'Workspace · 2026.09';
    document.getElementById('wsBuildSlot')?.prepend(uiBuild);
    if (user) document.getElementById('wsUserSlot')?.append(user);
    const mainNav = document.getElementById('mainNav');
    if (mainNav) {
      const sections = document.createElement('nav');
      sections.className = 'ws-section-nav';
      sections.setAttribute('aria-label', 'Underwriting sections');
      sections.append(mainNav);
      topbar.after(sections);
    }
    if (isWorkbench) {
      // Long, dynamically generated review warnings belong above the form.
      const placeWarning = () => {
        const warning = topbar.querySelector('#stmLayerTypeConflictWarn');
        if (warning) document.getElementById('wsMain')?.before(warning);
      };
      new MutationObserver(placeWarning).observe(topbar, {childList:true,subtree:true});
      placeWarning();
    }
    const rootBrand = document.getElementById('docsBackToAltitude');
    if (rootBrand) {
      rootBrand.querySelector('.brand-name').textContent = 'File Manager';
      rootBrand.querySelector('.brand-sub').textContent = 'Documents, organized around the account';
      rootBrand.setAttribute('title', 'Return to submission analysis');
    }
    const docs = document.getElementById('docs-view-root');
    if (docs) {
      const tags = docs.querySelector('.tags-panel');
      if (tags) {
        tags.id = 'wsTaggedPagesPanel';
        const toggle = document.createElement('button');
        toggle.type = 'button'; toggle.className = 'ws-tags-toggle';
        toggle.textContent = 'Tagged pages'; toggle.setAttribute('aria-expanded','false');
        toggle.setAttribute('aria-controls', tags.id);
        docs.querySelector('.topbar-utils')?.append(toggle);
        const close = document.createElement('button');
        close.type = 'button'; close.className = 'ws-tags-close';
        close.textContent = 'Close'; close.setAttribute('aria-label','Close tagged pages');
        tags.querySelector('.tags-header')?.append(close);
        function setTags(open) {
          docs.classList.toggle('ws-tags-open',open);
          toggle.setAttribute('aria-expanded',String(open));
          if(open) close.focus(); else toggle.focus();
        }
        toggle.addEventListener('click',()=>setTags(!docs.classList.contains('ws-tags-open')));
        close.addEventListener('click',()=>setTags(false));
        tags.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();setTags(false);}});
      }
    }
    // Make the existing drag-and-drop control usable with a keyboard.
    const dropzone = document.getElementById('dropzone');
    if (dropzone) {
      dropzone.setAttribute('tabindex', '0');
      dropzone.setAttribute('role', 'button');
      dropzone.setAttribute('aria-label', 'Upload submission documents');
      dropzone.addEventListener('keydown', e => {
        if (e.target === dropzone && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault(); document.getElementById('fileInput')?.click();
        }
      });
    }
    for (const id of ['webNameInput','webZipInput','webUrlInput','searchInput']) {
      const input = document.getElementById(id);
      if (input && !input.hasAttribute('aria-label')) input.setAttribute('aria-label', {webNameInput:'Insured business name',webZipInput:'ZIP code or city',webUrlInput:'Insured website address',searchInput:'Search documents'}[id]);
    }
    for (const id of ['apiPill','settingsModal','authSendBtn','stmAuthSendBtn']) {
      const el = document.getElementById(id);
      if (el && el.tagName === 'BUTTON' && !el.getAttribute('type')) el.type = 'button';
    }
    for (const id of ['authError','authSuccess','stmAuthError','stmAuthSuccess']) {
      document.getElementById(id)?.setAttribute('aria-live', id.endsWith('Error') ? 'assertive' : 'polite');
    }

    let scheduled = false;
    function setText(id, text) {
      const el = document.getElementById(id);
      if (el && el.textContent !== String(text)) el.textContent = String(text);
    }
    function sync() {
      scheduled = false;
      const active = isWorkbench ? 'workbench' : document.body.classList.contains('docs-fullwidth') ? 'documents' : document.getElementById('view-admin')?.classList.contains('active') ? 'admin' : document.getElementById('view-submission')?.classList.contains('active') ? 'submission' : 'queue';
      setText('wsCurrentView', names[active]);
      for (const item of rail.querySelectorAll('[data-system-target]')) {
        const selected = item.dataset.systemTarget === active;
        if (item.classList.contains('active') !== selected) item.classList.toggle('active', selected);
        if (selected) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
      }
      const title = isWorkbench ? document.getElementById('heroInsuredName')?.textContent : document.getElementById('sh-name')?.textContent;
      const state = window.STATE;
      const hasContext = isWorkbench || state?.activeSubmissionId || state?.newSubmissionDraftMode || state?.files?.length;
      setText('wsContextName', hasContext && title ? title : 'No submission selected');
      setText('wsContextDetail', isWorkbench ? 'Underwriting workbench' : state?.pipelineRunning ? 'Analysis in progress' : state?.activeSubmissionId ? 'Account context follows your workspace' : state?.newSubmissionDraftMode ? 'Add documents to get started' : 'Open an account from your queue');
      if (state?.submissions) setText('wsQueueCount', state.submissions.length);
      if (window.MODULES) setText('wsModuleCount', Object.keys(window.MODULES).length);
      // Preserve existing record handlers while adding a keyboard equivalent.
      document.querySelectorAll('#queueBody tr.sub-row').forEach(row => {
        if (row.dataset.wsAccessible) return;
        row.dataset.wsAccessible = 'true'; row.tabIndex = 0;
        row.setAttribute('aria-label', 'Open submission: ' + (row.querySelector('.acct-name')?.textContent || 'Account').replace(/ACTIVE|×/g,'').trim());
        row.addEventListener('keydown', event => {
          if (event.target === row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); row.click(); }
        });
      });
    }
    function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(sync); } }
    const watcher = new MutationObserver(schedule);
    watcher.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    for (const id of ['view-queue','view-submission','view-admin']) {
      const el = document.getElementById(id); if (el) watcher.observe(el, { attributes: true, attributeFilter: ['class'] });
    }
    for (const id of ['sh-name','sh-meta','queueBody','heroInsuredName','workbenchSubmissionBadge']) {
      const el = document.getElementById(id); if (el) watcher.observe(el, { childList: true, subtree: true, characterData: true });
    }
    document.addEventListener('change', schedule);
    window.addEventListener('hashchange', schedule);
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();
