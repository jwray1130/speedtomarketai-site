/* ============================================================================
   ALTITUDE · DOCUMENTS VIEW — full file management workspace
   ----------------------------------------------------------------------------
   Self-contained module. Ported from Justin's Speed File Manager prototype
   with adaptations for Altitude:
   - Reads files from STATE.activeSubmissionId's snapshot.files
   - Per-submission categorization persisted to localStorage
   - Hooks into Altitude's existing toast(), escapeHtml(), pdf.js, mammoth.js
   - body.docs-fullwidth class hides Altitude chrome when active

   Public API (exposed on window.DocumentsView):
     activate()   - Called by showStage('docs'). Renders/refreshes the view.
     refresh()    - Re-render everything from current STATE (after upload)
     deactivate() - Called when leaving the docs view

   Architecture: single IIFE with private state. All DOM IDs are 'docs*' or
   'docsXxx' to avoid collisions with Altitude's main app.
   ============================================================================ */

(function () {
  'use strict';

  // ── CONSTANTS ────────────────────────────────────────────────────────────
  const CATEGORIES = [
    { id: 'all',                name: 'All Documents',     desc: 'View every uploaded file',           svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>' },
    { id: 'correspondence',     name: 'Correspondence',    desc: 'Broker emails and letters',          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>' },
    { id: 'applications',       name: 'Applications',      desc: 'ACORDs and supplementals',           svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>' },
    { id: 'loss_history',       name: 'Loss History',      desc: 'Loss runs and claims data',          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>' },
    { id: 'underlying_quotes',  name: 'Underlying Quotes', desc: 'GL · AL · EL · lead · excess',       svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/></svg>' },
    { id: 'cancellations',      name: 'Cancellations',     desc: 'Cancellation notices',               svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' },
    { id: 'pricing',            name: 'Pricing',           desc: 'Rate calculations and worksheets',   svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>' },
    { id: 'quotes',             name: 'Quotes',            desc: 'Outgoing Zurich quotations',         svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' },
    { id: 'binders',            name: 'Binders',           desc: 'Policy binders',                     svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="9" cy="14" r="1"/><circle cx="9" cy="18" r="1"/></svg>' },
    { id: 'policies',           name: 'Policies',          desc: 'Active insurance policies',          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' },
    { id: 'endorsements',       name: 'Endorsements',      desc: 'Policy modifications',               svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' },
    { id: 'subjectivities',     name: 'Subjectivities',    desc: 'Pending requirements',               svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' },
    { id: 'surplus_lines',      name: 'Surplus Lines',     desc: 'Non-admitted policy paperwork',      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>' },
    { id: 'project',            name: 'Project',           desc: 'Project-specific documents',         svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' },
    { id: 'underwriting',       name: 'Underwriting',      desc: 'Internal UW workpapers',             svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/><polyline points="2 8.5 12 15.5 22 8.5"/><line x1="12" y1="22" x2="12" y2="15.5"/></svg>' },
  ];
  const CAT_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

  const COLORS = ['red', 'maroon', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'black'];
  const COLOR_HEX = {
    red: '#DC2626', maroon: '#7F1D1D', blue: '#2563EB', green: '#16A34A',
    yellow: '#EAB308', purple: '#7C3AED', orange: '#EA580C', pink: '#F472B6', black: '#6B7280',
  };
  const COLOR_LABEL = {
    red: 'Loss History', maroon: 'Cancellations', blue: 'Policy', green: 'Applications',
    yellow: 'Underlying', purple: 'Project', orange: 'Subjectivity',
    pink: 'Quote / Indication', black: 'Underwriting',
  };
  // Keyboard shortcuts for annotation tools
  const TOOL_SHORTCUTS = { v: 'pointer', p: 'pen', h: 'highlighter', u: 'rectangle', o: 'ellipse', a: 'arrow', l: 'line', t: 'text', n: 'sticky', e: 'eraser' };

  const LS_PREFIX = 'altitude_docs_';
  const LS_VIEW = LS_PREFIX + 'view_mode';
  const LS_PANEL_W = LS_PREFIX + 'panel_widths';

  // Pending file registry: keyed by file.name. Stores the underlying File
  // object for newly uploaded files (this session only) so we can generate
  // thumbnails, OCR, native-download, etc. Does not persist across reloads.
  const pendingFileBlobs = {};

  // ── PRIVATE STATE ───────────────────────────────────────────────────────
  // pages[]: each item is one "page" (a PDF page, a Word page, an Excel sheet,
  // a PPT slide, a single image, etc). Built from snapshot.files at render time.
  const state = {
    submissionId: null,
    pages: [],            // array of page records (see pageFromFile below)
    nativeBytes: {},      // cache of native file bytes for download/open
    activeCategory: 'all',
    colorFilter: 'all',
    view: localStorage.getItem(LS_VIEW) || 'thumbnail',
    sort: 'newest',
    search: '',
    searchMatches: [],    // ids that match current search
    searchIdx: 0,         // current position in searchMatches
    selected: new Set(),  // multi-select for bulk actions
    activated: false,
    eventsWired: false,
    contextPage: null,    // page for right-click context menu
    annotations: {},      // map: pageId -> array of annotation objects
    activeTool: 'pointer',
    activeColor: '#EAB308',
    activeStroke: 3,
    activeFontSize: 16,
    activeOpacity: 0.4,
    activeFill: false,
    annoUndoStack: [],    // for global undo (last action across all pages)
    annoRedoStack: [],
    previewIdx: 0,        // index in current filtered list when preview is open
    previewZoom: 1,
    previewRotate: 0,
    previewOcrCache: {},  // pageId -> { text, confidence }
  };

  // ── HELPERS ─────────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function lsKey(suffix) { return LS_PREFIX + suffix + '_' + (state.submissionId || 'global'); }
  function escapeHtml(s) {
    if (window.escapeHtml) return window.escapeHtml(s);
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
  function toast(msg) { if (window.toast) window.toast(msg); else console.log('[docs]', msg); }
  function genId() { return 'pg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function formatBytes(b) {
    if (b == null) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }
  function fileExt(name) {
    const m = (name || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/);
    return m ? m[1] : '';
  }

  // ── DATA LAYER: build pages[] from active submission ───────────────────
  // Each Altitude file becomes one or more "pages" depending on type. For now
  // (visual phase) we treat each file as a single page; per-page splitting at
  // ingestion happens in the upload handler when new files come in.
  //
  // We read from STATE.files (the live working set) rather than snapshot.files
  // because (a) STATE.files is rehydrated from the active submission's snapshot
  // when opened, and (b) new uploads append to STATE.files BEFORE the snapshot
  // gets rebuilt — so STATE.files is always the freshest source of truth.
  function buildPagesFromActiveSubmission() {
    const sid = window.STATE && window.STATE.activeSubmissionId;
    state.submissionId = sid;
    if (!sid || !window.STATE.files) { state.pages = []; return; }
    const meta = loadMeta();
    state.pages = window.STATE.files.map((f, idx) => {
      // Meta key: file name. Within a single submission Altitude's dedup
      // prevents duplicate names, so name is a stable identifier across
      // upload → pipeline run → snapshot commit cycles. Falls back to id if
      // the name is somehow empty.
      const metaKey = f.name || f.id || ('file_' + idx);
      const m = meta[metaKey] || {};
      return {
        id: f.id || metaKey + '__' + idx,
        metaKey,
        srcFile: f,
        name: m.name || f.name || ('File ' + (idx + 1)),
        size: f.size || 0,
        type: f.type || 'application/octet-stream',
        ext: fileExt(f.name),
        kind: detectKind(f),
        pageNum: 1,
        totalPages: 1,
        category: m.category || null,
        color: m.color || null,
        thumbDataUrl: m.thumbDataUrl || null,
        thumbHtml: m.thumbHtml || null,
        text: f.text || m.text || '',
        classification: f.classification || null,
        routedTo: f.routedTo || null,
        addedAt: m.addedAt || idx,
        // Legacy = file existed in old submission with no underlying File bytes
        // available in this session. For new uploads we'll have the File for
        // thumbnail generation; for legacy ones the blob is gone forever.
        legacy: !f.storage_path && !pendingFileBlobs[metaKey],
      };
    });
    state.annotations = loadAnnotations();
  }
  function detectKind(f) {
    const t = (f.type || '').toLowerCase();
    const n = (f.name || '').toLowerCase();
    if (t.includes('pdf') || n.endsWith('.pdf')) return 'pdf';
    if (t.includes('word') || n.endsWith('.docx') || n.endsWith('.doc')) return 'word';
    if (t.includes('sheet') || t.includes('excel') || /\.(xlsx?|csv)$/.test(n)) return /\.csv$/.test(n) ? 'csv' : 'excel';
    if (/^image\//.test(t) || /\.(jpe?g|png|tiff?|gif|webp|bmp)$/.test(n)) return 'image';
    if (t.includes('powerpoint') || /\.(pptx?)$/.test(n)) return 'powerpoint';
    if (/\.(eml|msg)$/.test(n)) return 'email';
    if (/\.rtf$/.test(n)) return 'rtf';
    if (/\.(txt|html?|md|log)$/.test(n) || t.startsWith('text/')) return 'text';
    if (/\.(zip|tar|gz|7z|rar)$/.test(n)) return 'archive';
    return 'native';
  }

  // localStorage: per-submission metadata (category/color/name/thumb)
  function loadMeta() {
    if (!state.submissionId) return {};
    try { return JSON.parse(localStorage.getItem(lsKey('meta')) || '{}'); }
    catch { return {}; }
  }
  function saveMeta(meta) {
    if (!state.submissionId) return;
    try { localStorage.setItem(lsKey('meta'), JSON.stringify(meta)); }
    catch (e) { console.warn('[docs] save failed', e); }
  }
  function patchMeta(pageId, patch) {
    const meta = loadMeta();
    meta[pageId] = { ...(meta[pageId] || {}), ...patch };
    Object.keys(meta[pageId]).forEach(k => {
      if (meta[pageId][k] == null || meta[pageId][k] === '') delete meta[pageId][k];
    });
    if (Object.keys(meta[pageId]).length === 0) delete meta[pageId];
    saveMeta(meta);
  }
  function loadAnnotations() {
    if (!state.submissionId) return {};
    try { return JSON.parse(localStorage.getItem(lsKey('anno')) || '{}'); }
    catch { return {}; }
  }
  function saveAnnotations() {
    if (!state.submissionId) return;
    try { localStorage.setItem(lsKey('anno'), JSON.stringify(state.annotations)); }
    catch (e) { console.warn('[docs] anno save failed', e); }
  }

  // ── FILTER + SORT ──────────────────────────────────────────────────────
  function getFilteredPages() {
    let out = state.pages.slice();
    if (state.activeCategory !== 'all') {
      out = out.filter(p => p.category === state.activeCategory);
    }
    if (state.search) {
      const q = state.search.toLowerCase();
      const matches = [];
      out = out.filter(p => {
        const inName = (p.name || '').toLowerCase().includes(q);
        const inText = (p.text || '').toLowerCase().includes(q);
        if (inName || inText) { matches.push(p.id); return true; }
        return false;
      });
      state.searchMatches = matches;
    } else {
      state.searchMatches = [];
    }
    // Sort
    out.sort((a, b) => {
      switch (state.sort) {
        case 'oldest':    return a.addedAt - b.addedAt;
        case 'name-asc':  return a.name.localeCompare(b.name);
        case 'name-desc': return b.name.localeCompare(a.name);
        case 'type':      return (a.kind || '').localeCompare(b.kind || '');
        default:          return b.addedAt - a.addedAt;  // newest
      }
    });
    return out;
  }
  function getTaggedPages() {
    let out = state.pages.filter(p => p.color);
    if (state.colorFilter !== 'all') out = out.filter(p => p.color === state.colorFilter);
    // Group by color (red first, then maroon, etc per COLORS array)
    return out.sort((a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color));
  }

  // ── RENDER ENTRY ────────────────────────────────────────────────────────
  function render() {
    renderCategories();
    renderDocsList();
    renderTagsList();
    renderHeaderCounts();
  }

  function renderHeaderCounts() {
    $('docsCount') && ($('docsCount').textContent = state.pages.length);
    $('docsTotalAll') && ($('docsTotalAll').textContent = state.pages.length);
    $('docsTotalTagged') && ($('docsTotalTagged').textContent = state.pages.filter(p => p.color).length);
    const taggedPages = getTaggedPages();
    $('docsTagsCount') && ($('docsTagsCount').textContent = taggedPages.length);
  }

  function renderCategories() {
    const grid = $('docsCatGrid');
    if (!grid) return;
    grid.innerHTML = '';
    CATEGORIES.forEach(cat => {
      const count = cat.id === 'all' ? state.pages.length : state.pages.filter(p => p.category === cat.id).length;
      const card = document.createElement('div');
      card.className = 'cat-card' + (cat.id === state.activeCategory ? ' active' : '');
      card.dataset.cat = cat.id;
      card.innerHTML =
        '<div class="cat-icon">' + cat.svg + '</div>' +
        '<div class="cat-body">' +
          '<div class="cat-name">' + escapeHtml(cat.name) + '</div>' +
          '<div class="cat-desc">' + escapeHtml(cat.desc) + '</div>' +
        '</div>' +
        '<div class="cat-count">' + count + '</div>';
      card.addEventListener('click', () => selectCategory(cat.id));
      grid.appendChild(card);
    });
  }

  function selectCategory(catId) {
    state.activeCategory = catId;
    const cat = CAT_BY_ID[catId];
    $('docsListTitle') && ($('docsListTitle').textContent = cat ? cat.name : catId);
    $('docsTopbarCatLabel') && ($('docsTopbarCatLabel').textContent = catId === 'all' ? '' : (cat ? cat.name.toUpperCase() : ''));
    render();
  }

  // ── DOC TILES ────────────────────────────────────────────────────────────
  function renderDocsList() {
    const list = $('docsList');
    const empty = $('docsEmpty');
    if (!list) return;
    Array.from(list.children).forEach(c => { if (c !== empty) c.remove(); });
    list.dataset.view = state.view;

    const pages = getFilteredPages();
    $('docsListCount') && ($('docsListCount').textContent = pages.length);

    if (pages.length === 0) {
      if (empty) {
        empty.style.display = '';
        const t = empty.querySelector('.docs-empty-title');
        const s = empty.querySelector('.docs-empty-sub');
        if (state.pages.length === 0) {
          if (t) t.textContent = 'No documents';
          if (s) s.textContent = 'Upload via button or drag & drop anywhere';
        } else {
          if (t) t.textContent = 'No documents in this view';
          if (s) s.textContent = 'Try a different category or clear the search';
        }
      }
      return;
    }
    if (empty) empty.style.display = 'none';

    pages.forEach(p => list.appendChild(buildTile(p)));
  }

  function buildTile(p) {
    const item = document.createElement('div');
    item.className = 'doc-item';
    if (state.selected.has(p.id)) item.classList.add('selected');
    if (p.color) item.classList.add('has-color', 'tag-' + p.color);
    if (state.searchMatches.length && state.searchMatches.includes(p.id)) item.classList.add('has-search-match');
    if (state.searchMatches.length && state.searchMatches[state.searchIdx] === p.id) item.classList.add('search-focused');
    item.dataset.id = p.id;
    item.draggable = false;

    // Color bar
    const bar = document.createElement('div');
    bar.className = 'doc-color-bar';
    item.appendChild(bar);

    // Thumb area
    const thumb = document.createElement('div');
    thumb.className = 'doc-thumb';
    thumb.appendChild(buildThumbContent(p));

    // Type badge
    const tb = document.createElement('span');
    tb.className = 'doc-badge';
    tb.textContent = (p.ext || (p.kind || 'file').slice(0, 4)).toUpperCase();
    thumb.appendChild(tb);

    // Page badge if multi-page
    if (p.totalPages && p.totalPages > 1) {
      const pb = document.createElement('span');
      pb.className = 'doc-page-badge';
      pb.textContent = 'p. ' + p.pageNum + '/' + p.totalPages;
      thumb.appendChild(pb);
    }
    // Search-match badge
    if (state.searchMatches.length && state.searchMatches.includes(p.id)) {
      const sb = document.createElement('span');
      sb.className = 'doc-search-badge';
      sb.textContent = 'MATCH';
      thumb.appendChild(sb);
    }
    // Annotation indicator
    if (state.annotations[p.id] && state.annotations[p.id].length) {
      const ind = document.createElement('span');
      ind.className = 'anno-indicator';
      ind.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>';
      thumb.appendChild(ind);
    }

    item.appendChild(thumb);

    // Info row
    const info = document.createElement('div');
    info.className = 'doc-info';
    const name = document.createElement('div');
    name.className = 'doc-name';
    name.textContent = p.name;
    name.title = p.name;
    name.addEventListener('dblclick', e => { e.stopPropagation(); startRename(p.id); });
    info.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'doc-meta';
    const date = document.createElement('span');
    date.className = 'doc-date';
    date.textContent = formatBytes(p.size);
    meta.appendChild(date);

    const acts = document.createElement('div');
    acts.className = 'doc-actions';
    acts.innerHTML =
      '<button class="doc-mini-btn" data-act="color" title="Color tag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg></button>' +
      '<button class="doc-mini-btn" data-act="cat" title="Category"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>' +
      '<button class="doc-mini-btn" data-act="preview" title="Preview"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>';
    acts.addEventListener('click', e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'color') openColorPicker(p, btn);
      else if (act === 'cat') openCategoryModal([p.id]);
      else if (act === 'preview') openPreview(p);
    });
    meta.appendChild(acts);
    info.appendChild(meta);
    item.appendChild(info);

    // Click + context behaviors
    item.addEventListener('click', e => {
      if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSelect(p.id);
      else openPreview(p);
    });
    item.addEventListener('contextmenu', e => {
      e.preventDefault();
      state.contextPage = p;
      showContextMenu(e.clientX, e.clientY);
    });
    return item;
  }

  function buildThumbContent(p) {
    if (p.thumbDataUrl) {
      const img = document.createElement('img');
      img.src = p.thumbDataUrl;
      img.alt = p.name;
      return img;
    }
    if (p.thumbHtml) {
      const wrap = document.createElement('div');
      wrap.className = 'doc-thumb-' + p.kind;
      wrap.innerHTML = p.thumbHtml;
      return wrap;
    }
    // Fallback: native-card-style placeholder per kind
    return buildNativeCard(p);
  }

  function buildNativeCard(p) {
    const wrap = document.createElement('div');
    const kind = p.kind || 'native';
    wrap.className = 'doc-thumb-native doc-thumb-native-' + kind;
    const ICON = {
      excel: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" opacity="0.2"/><path d="M14 2v6h6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 13l2 3 4-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      csv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
      email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>',
      powerpoint: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
      archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
      native: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    };
    wrap.innerHTML =
      '<div class="native-card-icon">' + (ICON[kind] || ICON.native) + '</div>' +
      '<div class="native-card-body">' +
        '<div class="native-card-name">' + escapeHtml(p.name) + '</div>' +
        '<div class="native-card-meta">' +
          '<span>' + (p.ext || kind).toUpperCase() + '</span>' +
          '<span>·</span>' +
          '<span>' + formatBytes(p.size) + '</span>' +
        '</div>' +
      '</div>' +
      (p.legacy
        ? '<div class="native-card-action"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> NO PREVIEW · LEGACY</div>'
        : '<div class="native-card-action"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> OPEN NATIVELY</div>');
    return wrap;
  }

  // ── TAGS LIST ──────────────────────────────────────────────────────────
  function renderTagsList() {
    const list = $('docsTagsList');
    const empty = $('docsTagsEmpty');
    if (!list) return;
    Array.from(list.children).forEach(c => { if (c !== empty) c.remove(); });

    const tagged = getTaggedPages();
    if (tagged.length === 0) {
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    tagged.forEach(p => {
      const item = document.createElement('div');
      item.className = 'tagged-item tag-' + p.color;
      item.innerHTML =
        '<div class="tagged-body">' +
          '<div class="tagged-name">' + escapeHtml(p.name) + '</div>' +
          '<span class="tagged-label">' + escapeHtml(COLOR_LABEL[p.color] || p.color) + '</span>' +
        '</div>' +
        '<div class="tagged-actions">' +
          '<button class="doc-mini-btn" data-act="preview" title="Preview"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>' +
          '<button class="doc-mini-btn" data-act="remove" title="Remove tag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
        '</div>';
      item.addEventListener('click', e => {
        const btn = e.target.closest('button[data-act]');
        if (btn) {
          e.stopPropagation();
          if (btn.dataset.act === 'remove') setColor(p.id, null);
          else openPreview(p);
        } else openPreview(p);
      });
      list.appendChild(item);
    });
  }

  // ── COLOR / CATEGORY ACTIONS ───────────────────────────────────────────
  function setCategory(pageId, catId) {
    const p = state.pages.find(x => x.id === pageId);
    if (!p) return;
    p.category = catId;
    patchMeta(p.metaKey, { category: catId });
    render();
  }
  function setColor(pageId, color) {
    const p = state.pages.find(x => x.id === pageId);
    if (!p) return;
    p.color = color;
    patchMeta(p.metaKey, { color: color });
    render();
  }
  function clearAllForPage(pageId) {
    const p = state.pages.find(x => x.id === pageId);
    if (!p) return;
    p.category = null;
    p.color = null;
    patchMeta(p.metaKey, { category: null, color: null });
    render();
  }
  function startRename(pageId) {
    const tile = document.querySelector('.doc-item[data-id="' + pageId + '"]');
    if (!tile) return;
    const nameEl = tile.querySelector('.doc-name');
    if (!nameEl) return;
    const p = state.pages.find(x => x.id === pageId);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'doc-name-input';
    input.value = p.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    function commit() {
      const v = input.value.trim() || p.name;
      p.name = v;
      patchMeta(p.metaKey, { name: v });
      render();
    }
    function cancel() { render(); }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { input.removeEventListener('blur', commit); cancel(); }
    });
  }

  function toggleSelect(pageId) {
    if (state.selected.has(pageId)) state.selected.delete(pageId);
    else state.selected.add(pageId);
    updateBulkBar();
    render();
  }
  function clearSelection() { state.selected.clear(); updateBulkBar(); render(); }
  function updateBulkBar() {
    const bar = $('docsBulkBar');
    const count = $('docsBulkCount');
    if (!bar) return;
    if (state.selected.size > 0) {
      bar.classList.add('visible');
      if (count) count.textContent = state.selected.size + ' selected';
    } else bar.classList.remove('visible');
  }

  // ── SEARCH ─────────────────────────────────────────────────────────────
  let searchTimer = null;
  function setSearchValue(v) {
    state.search = v;
    state.searchIdx = 0;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      render();
      updateSearchUI();
    }, 100);
  }
  function updateSearchUI() {
    const wrap = $('docsTopbarSearch');
    const counter = $('docsSearchCounter');
    const prevBtn = $('docsSearchPrev');
    const nextBtn = $('docsSearchNext');
    const clear = $('docsSearchClear');
    if (!wrap) return;
    const n = state.searchMatches.length;
    if (state.search) {
      clear && clear.classList.add('visible');
      if (n > 0) {
        wrap.classList.add('has-results');
        counter && counter.classList.add('visible');
        if (counter) {
          counter.textContent = (state.searchIdx + 1) + ' / ' + n;
          counter.classList.remove('no-match');
        }
        prevBtn && (prevBtn.disabled = false);
        nextBtn && (nextBtn.disabled = false);
      } else {
        wrap.classList.remove('has-results');
        counter && counter.classList.add('visible');
        if (counter) {
          counter.textContent = 'No matches';
          counter.classList.add('no-match');
        }
        prevBtn && (prevBtn.disabled = true);
        nextBtn && (nextBtn.disabled = true);
      }
    } else {
      clear && clear.classList.remove('visible');
      wrap.classList.remove('has-results');
      counter && counter.classList.remove('visible');
      prevBtn && (prevBtn.disabled = true);
      nextBtn && (nextBtn.disabled = true);
    }
  }
  function searchNext(dir) {
    const n = state.searchMatches.length;
    if (n === 0) return;
    state.searchIdx = (state.searchIdx + dir + n) % n;
    render();
    updateSearchUI();
    // Scroll the focused match into view
    const id = state.searchMatches[state.searchIdx];
    const el = document.querySelector('.doc-item[data-id="' + id + '"]');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── CONTEXT MENU ───────────────────────────────────────────────────────
  function buildContextMenuHtml() {
    let html = '';
    // Categories
    CATEGORIES.filter(c => c.id !== 'all').forEach(c => {
      html += '<button class="ctx-item" data-act="cat-' + c.id + '">'
           + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>'
           + escapeHtml(c.name) + '</button>';
    });
    html += '<div class="ctx-sep"></div>';
    // Colors
    COLORS.forEach(col => {
      html += '<button class="ctx-item" data-act="color-' + col + '">'
           + '<span class="docs-mini-dot ' + col + '" style="margin-right:4px"></span>'
           + 'Tag ' + col.charAt(0).toUpperCase() + col.slice(1) + ' — ' + escapeHtml(COLOR_LABEL[col]) + '</button>';
    });
    html += '<div class="ctx-sep"></div>';
    html += '<button class="ctx-item" data-act="rename"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Rename<kbd>F2</kbd></button>';
    html += '<button class="ctx-item" data-act="preview"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>Preview</button>';
    html += '<button class="ctx-item danger" data-act="clear">Clear category &amp; color</button>';
    return html;
  }
  function showContextMenu(x, y) {
    const m = $('docsContextMenu');
    if (!m) return;
    m.innerHTML = buildContextMenuHtml();
    m.querySelectorAll('.ctx-item').forEach(b => {
      b.addEventListener('click', () => contextAction(b.dataset.act));
    });
    m.classList.add('visible');
    const r = m.getBoundingClientRect();
    if (x + r.width > window.innerWidth) x = window.innerWidth - r.width - 8;
    if (y + r.height > window.innerHeight) y = window.innerHeight - r.height - 8;
    m.style.left = x + 'px';
    m.style.top = y + 'px';
  }
  function hideContextMenu() {
    $('docsContextMenu')?.classList.remove('visible');
    state.contextPage = null;
  }
  function contextAction(act) {
    const p = state.contextPage;
    hideContextMenu();
    if (!p) return;
    if (act === 'rename') startRename(p.id);
    else if (act === 'preview') openPreview(p);
    else if (act === 'clear') clearAllForPage(p.id);
    else if (act.startsWith('cat-')) setCategory(p.id, act.slice(4));
    else if (act.startsWith('color-')) setColor(p.id, act.slice(6));
  }

  // ── COLOR PICKER MENU ──────────────────────────────────────────────────
  function openColorPicker(p, anchor) {
    const m = $('docsColorPickerMenu');
    if (!m) return;
    let html = '<div class="color-grid">';
    COLORS.forEach(col => {
      const active = p.color === col ? ' active' : '';
      html += '<button class="color-grid-btn tag-' + col + active + '" style="background:' + COLOR_HEX[col] + '" data-col="' + col + '" title="' + COLOR_LABEL[col] + '"></button>';
    });
    html += '</div>';
    html += '<button class="color-clear-btn" data-col="">Clear color</button>';
    m.innerHTML = html;
    m.querySelectorAll('button[data-col]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        const c = b.dataset.col || null;
        setColor(p.id, c);
        m.classList.remove('visible');
      });
    });
    const r = anchor.getBoundingClientRect();
    let left = r.left;
    let top = r.bottom + 6;
    m.classList.add('visible');
    const mr = m.getBoundingClientRect();
    if (left + mr.width > window.innerWidth - 8) left = window.innerWidth - mr.width - 8;
    if (top + mr.height > window.innerHeight - 8) top = r.top - mr.height - 6;
    m.style.left = left + 'px';
    m.style.top = top + 'px';
  }
  function hideColorPicker() {
    $('docsColorPickerMenu')?.classList.remove('visible');
  }

  // ── CATEGORY MODAL (bulk recategorize + upload-routing) ────────────────
  let pendingCatTargets = [];  // page ids to apply category to (bulk recategorize)
  let pendingCatChoice = null;
  let pendingUploadFiles = null;  // File objects waiting for category selection
  function openCategoryModal(targets, opts) {
    pendingCatTargets = targets || [];
    pendingCatChoice = null;
    pendingUploadFiles = (opts && opts.uploadFiles) || null;
    const grid = $('docsCatModalGrid');
    const sub = $('docsCatModalSub');
    const titleEl = $('docsCatModal').querySelector('.docs-modal-title');
    if (!grid) return;
    grid.innerHTML = '';
    CATEGORIES.filter(c => c.id !== 'all').forEach(c => {
      const opt = document.createElement('button');
      opt.className = 'docs-modal-cat-opt';
      opt.dataset.cat = c.id;
      opt.innerHTML = c.svg + '<span>' + escapeHtml(c.name) + '</span>';
      opt.addEventListener('click', () => {
        grid.querySelectorAll('.docs-modal-cat-opt').forEach(x => x.classList.remove('active'));
        opt.classList.add('active');
        pendingCatChoice = c.id;
      });
      grid.appendChild(opt);
    });
    // Title differs based on context: upload vs bulk recategorize
    if (titleEl) titleEl.textContent = pendingUploadFiles ? 'File Upload' : 'Categorize';
    if (sub) sub.textContent = (opts && opts.subText) || ('Assign a category to ' + targets.length + ' document(s).');
    $('docsCatModal').classList.add('visible');
  }
  function applyCategoryModal() {
    if (!pendingCatChoice) { toast('Pick a category first'); return; }
    if (pendingUploadFiles) {
      // Upload flow: route the chosen files through Altitude pipeline + apply
      // category in the docs view
      const files = pendingUploadFiles;
      const cat = pendingCatChoice;
      closeCategoryModal();
      applyUploadWithCategory(files, cat);
    } else {
      // Bulk recategorize flow
      pendingCatTargets.forEach(id => setCategory(id, pendingCatChoice));
      closeCategoryModal();
      clearSelection();
    }
  }
  function closeCategoryModal() {
    $('docsCatModal').classList.remove('visible');
    pendingCatTargets = [];
    pendingCatChoice = null;
    pendingUploadFiles = null;
  }

  // ── COLOR FILTER (right pane dropdown) ─────────────────────────────────
  function selectColorFilter(filter) {
    state.colorFilter = filter;
    const labelEl = $('docsColorFilterLabel');
    if (labelEl) labelEl.textContent = filter === 'all' ? 'All Colors' : COLOR_LABEL[filter];
    const dot = document.querySelector('.color-filter-display .color-dot');
    if (dot) dot.className = 'color-dot ' + filter;
    document.querySelectorAll('#docsColorFilterMenu .color-option').forEach(o => {
      o.classList.toggle('active', o.dataset.filter === filter);
    });
    $('docsColorFilterMenu')?.classList.remove('visible');
    render();
  }

  // ── PREVIEW MODAL ──────────────────────────────────────────────────────
  let previewPage = null;
  function openPreview(p) {
    previewPage = p;
    const filtered = getFilteredPages();
    state.previewIdx = filtered.findIndex(x => x.id === p.id);
    if (state.previewIdx < 0) state.previewIdx = 0;
    state.previewZoom = 1;
    state.previewRotate = 0;
    renderPreview();
    $('docsPreviewModal').classList.add('visible');
  }
  function closePreview() {
    $('docsPreviewModal').classList.remove('visible');
    previewPage = null;
  }
  function previewNav(dir) {
    const filtered = getFilteredPages();
    if (filtered.length === 0) return;
    state.previewIdx = (state.previewIdx + dir + filtered.length) % filtered.length;
    previewPage = filtered[state.previewIdx];
    state.previewZoom = 1;
    state.previewRotate = 0;
    renderPreview();
  }
  function renderPreview() {
    if (!previewPage) return;
    const titleInput = $('docsPreviewTitle');
    if (titleInput) {
      titleInput.value = previewPage.name;
      titleInput.readOnly = true;
      titleInput.classList.remove('editable');
    }
    const filtered = getFilteredPages();
    $('docsPreviewCounter').textContent = (state.previewIdx + 1) + ' / ' + filtered.length;
    $('docsPreviewPrev').disabled = filtered.length <= 1;
    $('docsPreviewNext').disabled = filtered.length <= 1;

    const canvas = $('docsPreviewCanvas');
    canvas.innerHTML = '';
    canvas.style.transform = 'scale(' + state.previewZoom + ') rotate(' + state.previewRotate + 'deg)';

    const p = previewPage;
    const ocr = state.previewOcrCache[p.id];

    if (ocr) {
      // Show OCR split view
      const split = document.createElement('div');
      split.className = 'ocr-split';
      const left = document.createElement('div');
      left.className = 'ocr-image';
      const leftContent = buildPreviewBody(p);
      left.appendChild(leftContent);
      const right = document.createElement('div');
      right.className = 'ocr-text';
      const cls = ocr.confidence >= 80 ? 'high' : (ocr.confidence >= 60 ? 'medium' : 'low');
      right.innerHTML = '<div class="ocr-text-header"><h3>OCR Result</h3><span class="ocr-confidence ' + cls + '">' + Math.round(ocr.confidence) + '%</span></div><div class="ocr-content">' + escapeHtml(ocr.text) + '</div>';
      split.appendChild(left);
      split.appendChild(right);
      canvas.appendChild(split);
      canvas.style.transform = 'none';
    } else {
      canvas.appendChild(buildPreviewBody(p));
    }
  }
  function buildPreviewBody(p) {
    if (p.thumbDataUrl) {
      const img = document.createElement('img');
      img.src = p.thumbDataUrl;
      img.alt = p.name;
      return img;
    }
    if (p.thumbHtml) {
      const wrap = document.createElement('div');
      wrap.className = 'preview-' + (p.kind === 'word' ? 'word' : 'excel');
      wrap.innerHTML = p.thumbHtml;
      return wrap;
    }
    // Native banner for files we can't render
    const wrap = document.createElement('div');
    wrap.className = 'preview-excel-wrap';
    const banner = document.createElement('div');
    banner.className = 'preview-native-banner';
    banner.innerHTML =
      '<div class="preview-native-info">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
        '<div>' +
          '<div class="preview-native-title">' + escapeHtml(p.name) + '</div>' +
          '<div class="preview-native-sub">' + (p.legacy ? '<b>Legacy file</b> — uploaded before storage was enabled. No native bytes available.' : '<b>' + (p.ext || p.kind).toUpperCase() + '</b> · ' + formatBytes(p.size) + ' · open in native app') + '</div>' +
        '</div>' +
      '</div>' +
      (p.legacy
        ? ''
        : '<button class="preview-btn preview-native-btn" data-act="download"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download</button>');
    if (!p.legacy) banner.querySelector('button').addEventListener('click', e => { e.stopPropagation(); downloadPage(p); });
    wrap.appendChild(banner);
    if (p.text) {
      const tx = document.createElement('div');
      tx.className = 'preview-word';
      tx.style.maxHeight = 'calc(100vh - 240px)';
      tx.style.whiteSpace = 'pre-wrap';
      tx.style.fontSize = '13px';
      tx.style.lineHeight = '1.6';
      tx.style.fontFamily = 'monospace';
      tx.textContent = p.text;
      wrap.appendChild(tx);
    }
    return wrap;
  }

  function downloadPage(p) {
    // Prefer the in-memory blob if it's a new upload from this session
    const blob = pendingFileBlobs[p.metaKey];
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = p.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    // Fall back to thumbnail data URL (for image-only thumbnails)
    if (p.thumbDataUrl) {
      const a = document.createElement('a');
      a.href = p.thumbDataUrl;
      a.download = p.name;
      a.click();
      return;
    }
    if (p.legacy) { toast('Legacy file — original bytes not stored'); return; }
    toast('Download not available for this file');
  }

  // ── OCR (loads tesseract on demand) ────────────────────────────────────
  let _tesseractLoading = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (_tesseractLoading) return _tesseractLoading;
    _tesseractLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => reject(new Error('Failed to load Tesseract'));
      document.head.appendChild(s);
    });
    return _tesseractLoading;
  }
  async function runOcr() {
    const p = previewPage;
    if (!p) return;
    if (state.previewOcrCache[p.id]) { renderPreview(); return; }
    if (!p.thumbDataUrl) { toast('OCR needs an image — not available for this file'); return; }
    showLoading('Running OCR…', 'Analyzing ' + p.name);
    try {
      const T = await loadTesseract();
      const result = await T.recognize(p.thumbDataUrl, 'eng', {
        logger: m => {
          if (m.status === 'recognizing text') {
            updateLoadingProgress(Math.round(m.progress * 100));
          }
        }
      });
      state.previewOcrCache[p.id] = {
        text: result.data.text || '',
        confidence: result.data.confidence || 0,
      };
      hideLoading();
      renderPreview();
      toast('OCR complete · ' + Math.round(result.data.confidence) + '% confidence');
    } catch (e) {
      hideLoading();
      toast('OCR failed: ' + e.message);
    }
  }
  function copyPreviewText() {
    const p = previewPage;
    if (!p) return;
    const txt = (state.previewOcrCache[p.id]?.text) || p.text || '';
    if (!txt) { toast('No text to copy'); return; }
    navigator.clipboard.writeText(txt).then(() => toast('Text copied'));
  }

  // ── LOADING OVERLAY ────────────────────────────────────────────────────
  function showLoading(title, sub) {
    $('docsLoadingTitle').textContent = title || 'Processing…';
    $('docsLoadingSub').textContent = sub || '';
    $('docsLoadingFill').style.width = '0%';
    $('docsLoadingPct').textContent = '0%';
    $('docsLoadingOverlay').classList.add('visible');
  }
  function updateLoadingProgress(pct) {
    pct = Math.min(100, Math.max(0, pct));
    $('docsLoadingFill').style.width = pct + '%';
    $('docsLoadingPct').textContent = pct + '%';
  }
  function updateLoadingSub(sub) { $('docsLoadingSub').textContent = sub || ''; }
  function hideLoading() { $('docsLoadingOverlay').classList.remove('visible'); }

  // ── UPLOAD (drag-drop + file input) ────────────────────────────────────
  let dragDepth = 0;
  function wireDropOverlay() {
    document.addEventListener('dragenter', e => {
      if (!document.body.classList.contains('docs-fullwidth')) return;
      if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      dragDepth++;
      $('docsDropOverlay')?.classList.add('visible');
    });
    document.addEventListener('dragover', e => {
      if (!document.body.classList.contains('docs-fullwidth')) return;
      if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
    });
    document.addEventListener('dragleave', e => {
      if (!document.body.classList.contains('docs-fullwidth')) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) $('docsDropOverlay')?.classList.remove('visible');
    });
    document.addEventListener('drop', e => {
      if (!document.body.classList.contains('docs-fullwidth')) return;
      dragDepth = 0;
      $('docsDropOverlay')?.classList.remove('visible');
      if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      handleUpload(Array.from(e.dataTransfer.files));
    });
  }

  // Hook into Altitude's main upload pipeline. The flow is:
  //   1. User picks files
  //   2. Category modal opens — UW chooses where to file them on the docs side
  //      (this is independent of where Altitude's classifier routes them)
  //   3. Apply: store pending category in localStorage meta keyed by file name,
  //      stash the File blobs in pendingFileBlobs for thumbnail generation,
  //      then call window.handleFiles() so Altitude does its thing in parallel
  //   4. Thumbnails generate in the background (PDFs via pdf.js, images via
  //      FileReader). Each refresh re-renders tiles with whatever's ready.
  //   5. Watch STATE.files for new entries; when they appear, trigger a refresh
  //      so the docs view reflects the new files immediately
  function handleUpload(files) {
    if (!window.STATE || !window.STATE.activeSubmissionId) {
      toast('Open a submission first');
      return;
    }
    if (!files || !files.length) return;
    // Show the category-pick modal with the file list, capture the chosen
    // category, then proceed to upload + thumbnail.
    const fileNames = files.map(f => f.name);
    const subText = files.length === 1
      ? 'Where to file "' + escapeHtml(files[0].name) + '"?'
      : 'Where to file these ' + files.length + ' documents? · ' + fileNames.slice(0, 3).map(escapeHtml).join(', ') + (fileNames.length > 3 ? ' · +' + (fileNames.length - 3) + ' more' : '');
    openCategoryModal([], { subText, uploadFiles: files });
  }

  // Apply uploaded files: triggered from the category modal's Apply button
  // when uploadFiles were passed in. Sets pending category, stashes blobs,
  // kicks off Altitude pipeline + thumbnail generation in parallel.
  function applyUploadWithCategory(files, category) {
    files.forEach(file => {
      // Stash the actual File blob so we can generate thumbnails / preview /
      // download later this session
      pendingFileBlobs[file.name] = file;
      // Pre-populate meta with the chosen category. Files will appear in
      // All Documents AND in the chosen folder once they hit STATE.files.
      patchMeta(file.name, { category });
      // Kick off thumbnail generation in the background. Each completion
      // triggers a refresh of the docs view.
      generateThumbnail(file).then(thumbDataUrl => {
        if (thumbDataUrl) {
          patchMeta(file.name, { thumbDataUrl });
          if (state.activated) { buildPagesFromActiveSubmission(); render(); }
        }
      }).catch(e => console.warn('[docs] thumb fail', file.name, e));
    });

    // Hand off to Altitude's pipeline — classifier, modules, etc. run normally.
    if (typeof window.handleFiles === 'function') {
      window.handleFiles(files);
      // Watch for STATE.files to update with the new entries, then refresh the
      // docs view so the tiles appear. Polling for ~2.5s is enough for the
      // upload entry to land in STATE.files (text extraction is async but the
      // entry itself is added immediately).
      let attempts = 0;
      const watcher = setInterval(() => {
        attempts++;
        if (state.activated) { buildPagesFromActiveSubmission(); render(); }
        if (attempts >= 25) clearInterval(watcher);
      }, 100);
    } else {
      toast('Upload pipeline not available');
    }

    toast(files.length === 1
      ? 'Filed "' + files[0].name + '" under ' + (CAT_BY_ID[category]?.name || category)
      : 'Filed ' + files.length + ' documents under ' + (CAT_BY_ID[category]?.name || category)
    );
  }

  // Generate a thumbnail data URL for a File. Returns null if the type is not
  // renderable (in which case the native-card placeholder will show instead).
  // Thumbnails are sized small (~300px wide) to keep localStorage usage low.
  async function generateThumbnail(file) {
    const t = (file.type || '').toLowerCase();
    const n = (file.name || '').toLowerCase();
    try {
      if (t.includes('pdf') || n.endsWith('.pdf')) return await renderPdfThumb(file);
      if (/^image\//.test(t) || /\.(jpe?g|png|gif|webp|bmp)$/.test(n)) return await renderImageThumb(file);
    } catch (e) {
      console.warn('[docs] thumb generation error', file.name, e);
    }
    return null;
  }

  async function renderPdfThumb(file) {
    if (typeof pdfjsLib === 'undefined') return null;
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);
    // Target ~300px width thumbnail; compute scale from the page's natural size
    const baseViewport = page.getViewport({ scale: 1 });
    const targetWidth = 360;
    const scale = targetWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    // JPEG 0.85 quality is a good balance between size and visual fidelity for thumbnails
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  async function renderImageThumb(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          // Resize to max 360px wide
          const maxW = 360;
          const scale = Math.min(1, maxW / img.width);
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── BULK OPERATIONS ────────────────────────────────────────────────────
  function bulkColor() {
    if (state.selected.size === 0) return;
    const m = $('docsColorPickerMenu');
    if (!m) return;
    let html = '<div class="color-grid">';
    COLORS.forEach(col => {
      html += '<button class="color-grid-btn tag-' + col + '" style="background:' + COLOR_HEX[col] + '" data-col="' + col + '" title="' + COLOR_LABEL[col] + '"></button>';
    });
    html += '</div>';
    html += '<button class="color-clear-btn" data-col="">Clear color</button>';
    m.innerHTML = html;
    m.querySelectorAll('button[data-col]').forEach(b => {
      b.addEventListener('click', () => {
        const c = b.dataset.col || null;
        state.selected.forEach(id => setColor(id, c));
        m.classList.remove('visible');
        clearSelection();
      });
    });
    const anchor = $('docsBulkColor');
    const r = anchor.getBoundingClientRect();
    m.classList.add('visible');
    m.style.left = r.left + 'px';
    m.style.top = (r.bottom + 6) + 'px';
  }
  function bulkCategory() {
    if (state.selected.size === 0) return;
    openCategoryModal(Array.from(state.selected));
  }
  function bulkDelete() {
    if (state.selected.size === 0) return;
    if (!confirm('Remove ' + state.selected.size + ' document(s) from view? (This only clears their categorization, not the underlying file.)')) return;
    state.selected.forEach(id => clearAllForPage(id));
    clearSelection();
  }

  // ── ANNOTATION ENGINE (preview-only for now) ───────────────────────────
  // Tools: pointer/pen/highlighter/rectangle/ellipse/arrow/line/text/sticky/eraser
  // Annotations array: each item is { type, color, stroke, opacity, fontSize, fill, points, x, y, w, h, text }
  function setActiveTool(tool) {
    state.activeTool = tool;
    document.querySelectorAll('#docsAnnoToolbox .anno-btn[data-tool]').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
    // Show/hide option groups based on tool
    const showStroke = ['pen', 'rectangle', 'ellipse', 'arrow', 'line'].includes(tool);
    const showOpacity = tool === 'highlighter';
    const showFontSize = ['text', 'sticky'].includes(tool);
    const showFill = ['rectangle', 'ellipse'].includes(tool);
    $('docsStrokeGroup')?.classList.toggle('visible', showStroke);
    $('docsHighlighterGroup')?.classList.toggle('visible', showOpacity);
    $('docsFontSizeGroup')?.classList.toggle('visible', showFontSize);
    $('docsFillGroup')?.classList.toggle('visible', showFill);
    // Update the active-tool dot in TOOLS button
    const dot = $('docsToolsActiveDot');
    const btn = $('docsToolsBtn');
    if (tool === 'pointer') {
      btn?.classList.remove('tool-active');
    } else {
      btn?.classList.add('tool-active');
      if (dot) dot.style.color = state.activeColor;
    }
  }
  function setActiveColor(c) {
    state.activeColor = c;
    document.querySelectorAll('#docsColorSwatches .anno-swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.color === c);
    });
    if (state.activeTool !== 'pointer') {
      const dot = $('docsToolsActiveDot');
      if (dot) dot.style.color = c;
    }
  }
  function setActiveStroke(s) {
    state.activeStroke = parseInt(s, 10);
    document.querySelectorAll('#docsStrokeGroup .anno-stroke-btn').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.stroke, 10) === state.activeStroke);
    });
  }
  function setActiveFontSize(s) {
    state.activeFontSize = parseInt(s, 10);
    document.querySelectorAll('#docsFontSizeGroup .anno-fontsize-btn').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.fontsize, 10) === state.activeFontSize);
    });
  }
  function toggleAnnoToolbox() {
    const tb = $('docsAnnoToolbox');
    const btn = $('docsToolsBtn');
    if (!tb) return;
    const open = tb.classList.toggle('open');
    btn?.classList.toggle('open', open);
  }
  function clearAnnotationsForPreview() {
    if (!previewPage) return;
    if (!state.annotations[previewPage.id] || state.annotations[previewPage.id].length === 0) return;
    if (!confirm('Clear all annotations for this page?')) return;
    state.annotations[previewPage.id] = [];
    saveAnnotations();
    render();
  }

  // ── EXPORT TAGGED PAGES AS PDF ─────────────────────────────────────────
  async function exportTaggedAsPdf() {
    const tagged = state.pages.filter(p => p.color);
    if (tagged.length === 0) { toast('No tagged pages to export'); return; }
    if (!window.jspdf && !window.jsPDF) {
      // Load jsPDF on demand
      showLoading('Loading PDF library', 'jsPDF · ~150KB');
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      }).catch(() => { hideLoading(); toast('Failed to load PDF library'); return; });
    }
    hideLoading();
    showLoading('Building PDF', 'Tagged pages · ' + tagged.length);
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) { hideLoading(); toast('PDF lib unavailable'); return; }
    try {
      const pdf = new jsPDF();
      // Cover page
      pdf.setFontSize(20);
      pdf.text('Altitude — Tagged Pages', 20, 30);
      pdf.setFontSize(11);
      const sid = state.submissionId || '—';
      pdf.text('Submission: ' + sid, 20, 42);
      pdf.text('Total tagged: ' + tagged.length, 20, 50);
      pdf.text('Generated: ' + new Date().toLocaleString(), 20, 58);
      // Group by color
      let y = 76;
      COLORS.forEach(col => {
        const items = tagged.filter(p => p.color === col);
        if (items.length === 0) return;
        pdf.setFontSize(13);
        pdf.text(COLOR_LABEL[col] + ' (' + items.length + ')', 20, y);
        y += 8;
        pdf.setFontSize(10);
        items.forEach(p => {
          if (y > 270) { pdf.addPage(); y = 20; }
          pdf.text('· ' + p.name, 24, y);
          y += 6;
        });
        y += 4;
      });
      // Image pages
      let i = 0;
      for (const p of tagged) {
        i++;
        updateLoadingProgress(Math.round((i / tagged.length) * 100));
        if (p.thumbDataUrl) {
          pdf.addPage();
          try {
            pdf.addImage(p.thumbDataUrl, 'JPEG', 10, 14, 190, 0);
            pdf.setFontSize(9);
            pdf.text(p.name + ' · ' + COLOR_LABEL[p.color], 10, 10);
          } catch (e) { /* ignore image errors */ }
        }
      }
      pdf.save('altitude-tagged-' + (state.submissionId || 'export') + '.pdf');
      hideLoading();
      toast('Exported ' + tagged.length + ' tagged pages');
    } catch (e) {
      hideLoading();
      toast('PDF export failed: ' + e.message);
    }
  }
  function clearAllTags() {
    const tagged = state.pages.filter(p => p.color);
    if (tagged.length === 0) return;
    if (!confirm('Clear color tags from ' + tagged.length + ' pages?')) return;
    tagged.forEach(p => setColor(p.id, null));
  }

  // ── RESIZABLE PANELS ───────────────────────────────────────────────────
  function loadPanelWidths() {
    try {
      const w = JSON.parse(localStorage.getItem(LS_PANEL_W) || '{}');
      if (w.docs) document.documentElement.style.setProperty('--docs-panel-w', w.docs + 'px');
      if (w.tags) document.documentElement.style.setProperty('--tags-panel-w', w.tags + 'px');
    } catch {}
  }
  function savePanelWidths() {
    const docs = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--docs-panel-w'), 10) || 300;
    const tags = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tags-panel-w'), 10) || 280;
    localStorage.setItem(LS_PANEL_W, JSON.stringify({ docs, tags }));
  }
  function wireResizers() {
    function attach(id, varName, getDelta) {
      const el = $(id);
      if (!el) return;
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        el.classList.add('active');
        const startX = e.clientX;
        const startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue(varName), 10) || 280;
        // Max width: 80% of viewport so the docs panel can dominate the screen
        // while still leaving room for the resizer to be grabbable on the other side.
        const maxW = Math.floor(window.innerWidth * 0.8);
        function move(ev) {
          const newW = Math.max(180, Math.min(maxW, getDelta(startW, startX, ev.clientX)));
          document.documentElement.style.setProperty(varName, newW + 'px');
        }
        function up() {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          el.classList.remove('active');
          savePanelWidths();
        }
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    }
    attach('docsResizer1', '--docs-panel-w', (sw, sx, x) => sw + (x - sx));
    attach('docsResizer2', '--tags-panel-w', (sw, sx, x) => sw - (x - sx));
  }

  // ── KEYBOARD SHORTCUTS ─────────────────────────────────────────────────
  function wireKeyboard() {
    document.addEventListener('keydown', e => {
      if (!document.body.classList.contains('docs-fullwidth')) return;
      // Don't intercept when typing in inputs
      const tag = (e.target.tagName || '').toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

      // Preview navigation
      const previewOpen = $('docsPreviewModal')?.classList.contains('visible');
      if (previewOpen) {
        if (e.key === 'Escape') { closePreview(); return; }
        if (e.key === 'ArrowLeft' && !isInput) { previewNav(-1); return; }
        if (e.key === 'ArrowRight' && !isInput) { previewNav(1); return; }
      }

      if (isInput) return;

      // Tool shortcuts
      const k = e.key.toLowerCase();
      if (TOOL_SHORTCUTS[k] && !e.ctrlKey && !e.metaKey) {
        setActiveTool(TOOL_SHORTCUTS[k]);
        e.preventDefault();
        return;
      }

      // Esc closes overlays
      if (e.key === 'Escape') {
        hideContextMenu();
        hideColorPicker();
        $('docsAnnoToolbox')?.classList.remove('open');
        $('docsToolsBtn')?.classList.remove('open');
        $('docsCatModal')?.classList.remove('visible');
        $('docsSortMenu')?.classList.remove('visible');
        $('docsColorFilterMenu')?.classList.remove('visible');
        if (state.selected.size > 0) clearSelection();
      }

      // F2 to rename focused doc
      if (e.key === 'F2' && state.selected.size === 1) {
        const id = Array.from(state.selected)[0];
        startRename(id);
      }

      // Search shortcut: '/' or Ctrl+F
      if ((k === '/' && !e.ctrlKey && !e.metaKey) || ((e.ctrlKey || e.metaKey) && k === 'f')) {
        e.preventDefault();
        $('docsSearchInput')?.focus();
      }

      // Undo/redo
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); /* undo annotation */ }
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || (e.shiftKey && k === 'z'))) { e.preventDefault(); /* redo */ }
    });
  }

  // ── EVENT WIRING (one-time) ────────────────────────────────────────────
  function wireEvents() {
    if (state.eventsWired) return;
    state.eventsWired = true;

    // Brand & back
    $('docsBrand')?.addEventListener('click', () => window.showStage && window.showStage('pipe'));
    $('docsBackBtn')?.addEventListener('click', () => window.showStage && window.showStage('pipe'));

    // Tools dropdown
    $('docsToolsBtn')?.addEventListener('click', e => { e.stopPropagation(); toggleAnnoToolbox(); });
    document.querySelectorAll('#docsAnnoToolbox .anno-btn[data-tool]').forEach(b => {
      b.addEventListener('click', () => setActiveTool(b.dataset.tool));
    });
    document.querySelectorAll('#docsColorSwatches .anno-swatch').forEach(s => {
      s.addEventListener('click', () => setActiveColor(s.dataset.color));
    });
    document.querySelectorAll('#docsStrokeGroup .anno-stroke-btn').forEach(b => {
      b.addEventListener('click', () => setActiveStroke(b.dataset.stroke));
    });
    document.querySelectorAll('#docsFontSizeGroup .anno-fontsize-btn').forEach(b => {
      b.addEventListener('click', () => setActiveFontSize(b.dataset.fontsize));
    });
    $('docsOpacitySlider')?.addEventListener('input', e => state.activeOpacity = e.target.value / 100);
    $('docsFillToggle')?.addEventListener('click', e => {
      state.activeFill = !state.activeFill;
      e.currentTarget.classList.toggle('active', state.activeFill);
    });
    $('docsClearAnnoBtn')?.addEventListener('click', clearAnnotationsForPreview);
    $('docsAnnoPreviewBtn')?.addEventListener('click', () => {
      // Open preview for first selected or first filtered page
      const first = state.selected.size > 0
        ? state.pages.find(p => state.selected.has(p.id))
        : getFilteredPages()[0];
      if (first) openPreview(first);
    });

    // Search
    const si = $('docsSearchInput');
    if (si) {
      si.addEventListener('input', e => setSearchValue(e.target.value));
      si.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          searchNext(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
          si.value = '';
          setSearchValue('');
        }
      });
    }
    $('docsSearchClear')?.addEventListener('click', () => {
      if (si) si.value = '';
      setSearchValue('');
      si?.focus();
    });
    $('docsSearchPrev')?.addEventListener('click', () => searchNext(-1));
    $('docsSearchNext')?.addEventListener('click', () => searchNext(1));

    // Sort menu
    $('docsSortBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      $('docsSortMenu')?.classList.toggle('visible');
    });
    document.querySelectorAll('#docsSortMenu .docs-sort-option').forEach(o => {
      o.addEventListener('click', () => {
        state.sort = o.dataset.sort;
        document.querySelectorAll('#docsSortMenu .docs-sort-option').forEach(x => {
          x.classList.toggle('active', x.dataset.sort === o.dataset.sort);
        });
        $('docsSortMenu')?.classList.remove('visible');
        render();
      });
    });

    // View toggle
    document.querySelectorAll('#docsViewToggle button').forEach(b => {
      b.addEventListener('click', () => {
        state.view = b.dataset.view;
        localStorage.setItem(LS_VIEW, state.view);
        document.querySelectorAll('#docsViewToggle button').forEach(x => {
          x.classList.toggle('active', x.dataset.view === b.dataset.view);
        });
        render();
      });
    });

    // Clear selection button
    $('docsClearBtn')?.addEventListener('click', () => clearSelection());

    // Upload button + file input
    $('docsUploadBtn')?.addEventListener('click', () => $('docsFileInput')?.click());
    $('docsFileInput')?.addEventListener('change', e => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length) handleUpload(files);
    });

    // Color filter
    $('docsColorFilterBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      $('docsColorFilterMenu')?.classList.toggle('visible');
    });
    document.querySelectorAll('#docsColorFilterMenu .color-option').forEach(o => {
      o.addEventListener('click', () => selectColorFilter(o.dataset.filter));
    });

    // Tags footer buttons
    $('docsExportPdfBtn')?.addEventListener('click', exportTaggedAsPdf);
    $('docsClearTagsBtn')?.addEventListener('click', clearAllTags);

    // Bulk
    $('docsBulkColor')?.addEventListener('click', bulkColor);
    $('docsBulkCategory')?.addEventListener('click', bulkCategory);
    $('docsBulkDelete')?.addEventListener('click', bulkDelete);

    // Cat modal
    $('docsCatModalCancel')?.addEventListener('click', closeCategoryModal);
    $('docsCatModalApply')?.addEventListener('click', applyCategoryModal);
    $('docsCatModal')?.addEventListener('click', e => { if (e.target === $('docsCatModal')) closeCategoryModal(); });

    // Preview modal
    $('docsPreviewClose')?.addEventListener('click', closePreview);
    $('docsPreviewPrev')?.addEventListener('click', () => previewNav(-1));
    $('docsPreviewNext')?.addEventListener('click', () => previewNav(1));
    $('docsPreviewZoomIn')?.addEventListener('click', () => { state.previewZoom = Math.min(4, state.previewZoom * 1.2); renderPreview(); });
    $('docsPreviewZoomOut')?.addEventListener('click', () => { state.previewZoom = Math.max(0.25, state.previewZoom / 1.2); renderPreview(); });
    $('docsPreviewRotate')?.addEventListener('click', () => { state.previewRotate = (state.previewRotate + 90) % 360; renderPreview(); });
    $('docsPreviewDownload')?.addEventListener('click', () => previewPage && downloadPage(previewPage));
    $('docsPreviewOcrBtn')?.addEventListener('click', runOcr);
    $('docsPreviewCopyBtn')?.addEventListener('click', copyPreviewText);
    $('docsPreviewColorBtn')?.addEventListener('click', e => previewPage && openColorPicker(previewPage, e.currentTarget));
    $('docsPreviewRenameBtn')?.addEventListener('click', () => {
      const t = $('docsPreviewTitle');
      if (!t || !previewPage) return;
      t.readOnly = false;
      t.classList.add('editable');
      t.focus();
      t.select();
      const commit = () => {
        const v = t.value.trim() || previewPage.name;
        previewPage.name = v;
        patchMeta(previewPage.metaKey, { name: v });
        t.readOnly = true;
        t.classList.remove('editable');
        render();
      };
      t.addEventListener('blur', commit, { once: true });
      t.addEventListener('keydown', function onk(ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); t.blur(); }
        else if (ev.key === 'Escape') { t.value = previewPage.name; t.blur(); }
      }, { once: true });
    });

    // Global click-to-close for menus
    document.addEventListener('click', e => {
      if (!document.body.classList.contains('docs-fullwidth')) return;
      if (!e.target.closest('#docsToolsBtn, #docsAnnoToolbox')) {
        $('docsAnnoToolbox')?.classList.remove('open');
        $('docsToolsBtn')?.classList.remove('open');
      }
      if (!e.target.closest('#docsSortBtn, #docsSortMenu')) $('docsSortMenu')?.classList.remove('visible');
      if (!e.target.closest('#docsColorFilterBtn, #docsColorFilterMenu')) $('docsColorFilterMenu')?.classList.remove('visible');
      if (!e.target.closest('#docsContextMenu, .doc-item')) hideContextMenu();
      if (!e.target.closest('#docsColorPickerMenu, .doc-mini-btn[data-act="color"], #docsBulkColor, #docsPreviewColorBtn')) hideColorPicker();
    });

    // Resizers + drop overlay + keyboard
    wireResizers();
    wireDropOverlay();
    wireKeyboard();
  }

  // ── PUBLIC API ─────────────────────────────────────────────────────────
  function activate() {
    state.activated = true;
    loadPanelWidths();
    buildPagesFromActiveSubmission();
    render();
    wireEvents();
  }
  function refresh() {
    if (!state.activated) return;
    buildPagesFromActiveSubmission();
    render();
  }
  function deactivate() {
    state.activated = false;
    hideContextMenu();
    hideColorPicker();
    $('docsAnnoToolbox')?.classList.remove('open');
    $('docsToolsBtn')?.classList.remove('open');
  }

  window.DocumentsView = { activate, refresh, deactivate };

  // Auto-init on DOMContentLoaded so events are wired before user clicks Documents tab
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // No-op until activate() is called
    });
  }

})();
