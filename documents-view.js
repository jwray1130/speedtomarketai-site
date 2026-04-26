/* ============================================================================
   documents-view.js — parent bridge for the 1:1 Document Workspace
   ----------------------------------------------------------------------------
   Public API preserved for app.js:
     window.DocumentsView.activate()
     window.DocumentsView.refresh()
     window.DocumentsView.deactivate()

   The actual file manager UI/logic is untouched in documents-workspace.html,
   documents-workspace.css, and documents-workspace.js. This bridge only:
   - hydrates the workspace with STATE.files from the active submission
   - forwards new workspace uploads into Altitude's existing handleFiles()
   - closes the workspace when the user clicks the workspace brand
   ============================================================================ */
(function () {
  'use strict';

  const FRAME_ID = 'documentsWorkspaceFrame';
  let frameReady = false;
  let lastHydrateAt = 0;

  function $(id) { return document.getElementById(id); }

  function frame() { return $(FRAME_ID); }

  function sameFrameSource(event) {
    const f = frame();
    return f && event.source === f.contentWindow;
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function serializeFiles() {
    const files = (window.STATE && Array.isArray(window.STATE.files)) ? window.STATE.files : [];
    return files.map(f => ({
      id: f.id || null,
      name: f.name || 'Untitled',
      size: f.size || 0,
      type: f.type || '',
      text: f.text || '',
      state: f.state || '',
      classification: f.classification || '',
      routedTo: f.routedTo || '',
      confidence: typeof f.confidence === 'number' ? f.confidence : null,
      error: f.error || '',
      warning: f.warning || '',
      manualReason: f.manualReason || '',
      parentEmailName: f.parentEmailName || '',
      emailSubject: f.emailSubject || '',
      extractMeta: f.extractMeta || null
    }));
  }

  function updateTabCount() {
    const el = $('docsCount');
    if (el && window.STATE && Array.isArray(window.STATE.files)) {
      el.textContent = String(window.STATE.files.length);
    }
  }

  function hydrate() {
    updateTabCount();
    const f = frame();
    if (!f || !f.contentWindow) return;
    const payload = {
      type: 'stm-docs-hydrate',
      theme: currentTheme(),
      files: serializeFiles(),
      activeSubmissionId: window.STATE ? window.STATE.activeSubmissionId : null,
      sentAt: Date.now()
    };
    f.contentWindow.postMessage(payload, '*');
    lastHydrateAt = Date.now();
  }

  function activate() {
    updateTabCount();
    const f = frame();
    if (!f) return;
    if (!f.dataset.wired) {
      f.dataset.wired = '1';
      f.addEventListener('load', () => {
        frameReady = true;
        hydrate();
      });
    }
    if (frameReady) hydrate();
  }

  function refresh() { hydrate(); }

  function deactivate() {
    // Keep iframe state warm; no teardown required.
  }

  window.addEventListener('message', async (event) => {
    const msg = event.data || {};
    if (!sameFrameSource(event) || !msg || typeof msg !== 'object') return;

    if (msg.type === 'stm-docs-ready') {
      frameReady = true;
      hydrate();
      return;
    }

    if (msg.type === 'stm-docs-close') {
      if (typeof window.showStage === 'function') window.showStage('pipe');
      else document.body.classList.remove('docs-fullwidth');
      return;
    }

    if (msg.type === 'stm-docs-files-added') {
      const files = Array.isArray(msg.files) ? msg.files : [];
      if (files.length && typeof window.handleFiles === 'function') {
        try {
          await window.handleFiles(files);
          updateTabCount();
          if (typeof window.toast === 'function') {
            window.toast(files.length + ' document' + (files.length === 1 ? '' : 's') + ' added to the underwriting pipeline', 'success');
          }
          // Do not immediately hydrate back into the iframe; the 1:1 workspace
          // already rendered the uploaded native files. Hydrating later when the
          // user reopens the workspace will dedupe by filename.
        } catch (err) {
          console.error('[documents bridge] parent handleFiles failed', err);
          if (typeof window.toast === 'function') window.toast('Document upload failed · ' + (err.message || err), 'error');
        }
      }
      return;
    }

    if (msg.type === 'stm-docs-synced') {
      updateTabCount();
    }
  });

  // Keep count/theme reasonably current if the user toggles theme while docs are open.
  const themeObserver = new MutationObserver(() => {
    if (document.body.classList.contains('docs-fullwidth') && Date.now() - lastHydrateAt > 200) hydrate();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  window.DocumentsView = { activate, refresh, deactivate };
})();
