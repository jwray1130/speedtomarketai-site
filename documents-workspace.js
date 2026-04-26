/* ══════════════════════════════════════════════════════════════════════════════
   SPEED TO MARKET AI · DOCUMENT WORKSPACE — JavaScript
   Paste into CodePen's JS pane. Order: this file + part 2 (annotation engine).
   ══════════════════════════════════════════════════════════════════════════════ */

(function(){
  'use strict';

  // ══════ CONFIGURATION ══════
  const CONFIG = {
    // Thumbnails now render at 3.0x (supports panels up to ~1200px wide without pixelation).
    // High-res scale 3.5x used for preview modal and download fidelity.
    pdf:   { thumbnailScale: 3.0, highResScale: 3.5, ocrScale: 3.5 },
    preview: { minZoom: 0.4, maxZoom: 4.0, zoomStep: 0.25 },
    toast: { duration: 3000 },
    tagColors: ['red','maroon','blue','green','yellow','purple','orange','pink','black'],
    tagColorLabels: {
      red: 'Loss History',
      maroon: 'Cancellations',
      blue: 'Policy',
      green: 'Applications',
      yellow: 'Underlying',
      purple: 'Project',
      orange: 'Subjectivity',
      pink: 'Quote / Indication',
      black: 'Underwriting',
    },
    categories: [
      { id: 'all',             name: 'All Documents',   desc: 'View all uploaded files',        iconId: 'folder-open' },
      { id: 'correspondence',  name: 'Correspondence',  desc: 'Letters and emails',             iconId: 'mail' },
      { id: 'applications',    name: 'Applications',    desc: 'New insurance applications',     iconId: 'file-sig' },
      { id: 'loss-history',    name: 'Loss History',    desc: 'Claims and losses',              iconId: 'trend-down' },
      { id: 'pricing',         name: 'Pricing',         desc: 'Rate calculations',              iconId: 'dollar' },
      { id: 'quotes',          name: 'Quotes',          desc: 'Insurance quotations',           iconId: 'file-invoice' },
      { id: 'binders',         name: 'Binders',         desc: 'Policy binders',                 iconId: 'folder-plus' },
      { id: 'policies',        name: 'Policies',        desc: 'Active insurance policies',      iconId: 'shield' },
      { id: 'endorsements',    name: 'Endorsements',    desc: 'Policy modifications',           iconId: 'file-edit' },
      { id: 'subjectivities',  name: 'Subjectivities',  desc: 'Pending requirements',           iconId: 'alert' },
      { id: 'surplus-lines',   name: 'Surplus Lines',   desc: 'Non-admitted policies',          iconId: 'file-plus' },
    ],
    storageKeys: { theme: 'stm_docs_theme', view: 'stm_docs_view' },
  };

  const ICONS = {
    'folder-open': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14L3 20a2 2 0 002 2h13a2 2 0 002-2l-3-6"/><path d="M3 20V5a2 2 0 012-2h4l2 3h8a2 2 0 012 2v4"/></svg>',
    'mail': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    'file-sig': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 18a4 4 0 006 0"/></svg>',
    'trend-down': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>',
    'dollar': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
    'file-invoice': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>',
    'folder-plus': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>',
    'shield': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    'file-edit': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h8"/><polyline points="14 2 14 8 20 8"/><path d="M18.4 14.6a2 2 0 012.8 2.8L16 22H13v-3z"/></svg>',
    'alert': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    'file-plus': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
  };

  // ══════ STATE ══════
  const state = {
    docs: [],
    nextId: 1,
    currentCategory: 'all',
    currentColorFilter: 'all',
    currentView: 'thumbnail',
    searchQuery: '',
    searchResults: [],   // IDs of docs that match current query
    searchIndex: 0,      // which result is currently focused (Next/Prev)
    searchTotalMatches: 0, // total match count across all docs
    sortOrder: 'newest',
    selectedIds: new Set(),
    pendingUpload: null,
    preview: { open: false, docId: null, index: 0, filteredIds: [], zoom: 1, rotation: 0 },
    annotations: {
      tool: 'pointer', color: '#F87171', strokeWidth: 4, opacity: 0.15,
      fontSize: 18, fill: false, store: {},
      isDrawing: false, startX: 0, startY: 0,
      currentCanvas: null, currentCtx: null, currentDocId: null, currentPath: [],
      previewBlocked: false,
    },
    contextDoc: null,
    ocrLoaded: false,
  };

  // Expose for part 2 (annotation engine)
  window.STM_DOC_STATE = state;
  window.STM_DOC_CONFIG = CONFIG;

  // ══════ HELPERS ══════
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const $id = (id) => document.getElementById(id);

  const escapeHtml = (s) => String(s||'').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const stripExt = (n) => n.replace(/\.[^/.]+$/, '');
  const formatDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Wrap matches of `query` with <mark class="search-hl"> tags inside HTML, without
  // breaking HTML tag structure. Walks DOM text nodes only so we don't match inside attributes.
  function highlightHtmlMatches(html, query) {
    if (!query || !html) return html;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const re = new RegExp(escapeRegex(query), 'gi');
    const walker = document.createTreeWalker(wrap, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        // Skip text inside <mark>, <script>, <style>
        if (node.parentElement && ['MARK','SCRIPT','STYLE'].includes(node.parentElement.tagName))
          return NodeFilter.FILTER_REJECT;
        return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);
    textNodes.forEach(node => {
      const text = node.nodeValue;
      if (!re.test(text)) return;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const mark = document.createElement('mark');
        mark.className = 'search-hl';
        mark.textContent = m[0];
        frag.appendChild(mark);
        last = m.index + m[0].length;
        if (m[0].length === 0) break;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
    return wrap.innerHTML;
  }

  // Expose helpers for part 2
  window.STM_DOC_HELPERS = { $, $$, $id, escapeHtml, stripExt, formatDate, delay };

  // ══════ TOAST ══════
  function toast(title, msg, kind = 'info') {
    const stack = $id('toastStack');
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    const body = document.createElement('div');
    body.className = 'toast-body';
    body.innerHTML = '<div class="toast-title">' + escapeHtml(title) + '</div>' +
                     (msg ? '<div class="toast-msg">' + escapeHtml(msg) + '</div>' : '');
    el.appendChild(body);
    const close = document.createElement('button');
    close.className = 'toast-close';
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    close.onclick = dismiss;
    el.appendChild(close);
    stack.appendChild(el);
    const timer = setTimeout(dismiss, CONFIG.toast.duration);
    function dismiss() {
      clearTimeout(timer);
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(() => el.remove(), 200);
    }
  }
  window.STM_toast = toast;

  // ══════ LOADING ══════
  function showLoading(title) {
    $id('loadingTitle').textContent = title || 'Processing';
    $id('loadingSub').textContent = 'Starting…';
    $id('loadingFill').style.width = '0%';
    $id('loadingPct').textContent = '0%';
    $id('loadingOverlay').classList.add('visible');
  }
  function updateLoading(pct, sub) {
    $id('loadingFill').style.width = pct + '%';
    $id('loadingPct').textContent = pct + '%';
    if (sub) $id('loadingSub').textContent = sub;
  }
  function hideLoading() {
    $id('loadingOverlay').classList.remove('visible');
  }

  // ══════ THEME ══════
  function applyTheme(theme) {
    const root = document.documentElement;
    root.classList.add('no-transitions');
    if (theme === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('no-transitions')));
  }
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(CONFIG.storageKeys.theme, next); } catch(e) {}
    toast('Theme', 'Switched to ' + next + ' mode', 'info');
  }

  // Restore theme on load
  try {
    const saved = localStorage.getItem(CONFIG.storageKeys.theme);
    if (saved === 'light') applyTheme('light');
  } catch(e) {}

  // ══════ CATEGORIES ══════
  function renderCategoryGrid() {
    const grid = $id('catGrid');
    grid.innerHTML = '';
    CONFIG.categories.forEach(cat => {
      const card = document.createElement('div');
      card.className = 'cat-card' + (cat.id === state.currentCategory ? ' active' : '');
      card.dataset.cat = cat.id;
      const count = cat.id === 'all'
        ? state.docs.length
        : state.docs.filter(d => d.category === cat.id).length;
      card.innerHTML = `
        <div class="cat-icon">${ICONS[cat.iconId] || ''}</div>
        <div class="cat-body">
          <div class="cat-name">${escapeHtml(cat.name)}</div>
          <div class="cat-desc">${escapeHtml(cat.desc)}</div>
        </div>
        <div class="cat-count">${count}</div>
      `;
      card.onclick = () => selectCategory(cat.id);
      grid.appendChild(card);
    });
  }

  function renderModalCategoryGrid() {
    const grid = $id('modalCatGrid');
    grid.innerHTML = '';
    const active = state.pendingUpload?.category || 'all';
    CONFIG.categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'modal-cat-opt' + (cat.id === active ? ' active' : '');
      btn.dataset.cat = cat.id;
      btn.innerHTML = `${ICONS[cat.iconId] || ''}<span>${escapeHtml(cat.name)}</span>`;
      btn.onclick = () => selectModalCategory(cat.id);
      grid.appendChild(btn);
    });
  }

  function selectCategory(id) {
    state.currentCategory = id;
    const cat = CONFIG.categories.find(c => c.id === id);
    $id('activeCategoryLabel').textContent = cat ? cat.name : id;
    renderCategoryGrid();
    renderDocsList();
  }

  function selectModalCategory(id) {
    if (state.pendingUpload) state.pendingUpload.category = id;
    $$('#modalCatGrid .modal-cat-opt').forEach(b => b.classList.toggle('active', b.dataset.cat === id));
  }

  // ══════ FILTER / SORT / RENDER DOC LIST ══════
  function filterDocs() {
    let docs = [...state.docs];
    if (state.currentCategory !== 'all') {
      docs = docs.filter(d => d.category === state.currentCategory);
    }
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const qEscaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(qEscaped, 'gi');
      let total = 0;
      docs = docs.filter(d => {
        const name = (d.displayName || '');
        const text = (d.textContent || '');
        const nameHits = (name.match(re) || []).length;
        const textHits = (text.match(re) || []).length;
        const hits = nameHits + textHits;
        if (hits > 0) {
          d._searchMatches = hits;
          total += hits;
          return true;
        }
        delete d._searchMatches;
        return false;
      });
      state.searchTotalMatches = total;
    } else {
      state.docs.forEach(d => { delete d._searchMatches; });
      state.searchTotalMatches = 0;
    }
    const sorted = sortDocs(docs);
    // Keep searchResults in sync with current filtered + sorted state
    if (state.searchQuery) {
      state.searchResults = sorted.map(d => d.id);
    } else {
      state.searchResults = [];
    }
    return sorted;
  }

  // Per-type visual accent for native-tile cards: color + icon + CTA text.
  // Keeps card rendering one reusable function.
  function nativeAccentForType(doc) {
    if (doc.type === 'excel') return {
      cls: 'excel',
      actionLabel: 'Click to open in Excel',
      iconSvg: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M28 4H10a2 2 0 0 0-2 2v36a2 2 0 0 0 2 2h28a2 2 0 0 0 2-2V16z"/><polyline points="28 4 28 16 40 16"/><line x1="16" y1="26" x2="32" y2="26"/><line x1="16" y1="32" x2="32" y2="32"/><line x1="16" y1="38" x2="32" y2="38"/><line x1="24" y1="22" x2="24" y2="42"/></svg>',
    };
    if (doc.type === 'csv') return {
      cls: 'csv',
      actionLabel: 'Click to open',
      iconSvg: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M28 4H10a2 2 0 0 0-2 2v36a2 2 0 0 0 2 2h28a2 2 0 0 0 2-2V16z"/><polyline points="28 4 28 16 40 16"/><text x="14" y="36" font-family="monospace" font-size="10" fill="currentColor" stroke="none">CSV</text></svg>',
    };
    if (doc.type === 'archive') return {
      cls: 'archive',
      actionLabel: 'Click to download',
      iconSvg: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="6" width="32" height="38" rx="2"/><line x1="24" y1="6" x2="24" y2="18"/><rect x="22" y="20" width="4" height="6"/></svg>',
    };
    if (doc.type === 'email' && doc.emailMeta?.format === 'msg') return {
      cls: 'email',
      actionLabel: 'Click to open in Outlook',
      iconSvg: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="10" width="36" height="28" rx="2"/><polyline points="6 14 24 28 42 14"/></svg>',
    };
    if (doc.type === 'powerpoint') return {
      cls: 'powerpoint',
      actionLabel: 'Click to open in PowerPoint',
      iconSvg: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="8" width="36" height="26" rx="2"/><path d="M14 16h14a4 4 0 0 1 0 8H14z"/><line x1="24" y1="34" x2="24" y2="42"/><line x1="18" y1="42" x2="30" y2="42"/></svg>',
    };
    // Generic native/unknown
    return {
      cls: 'native',
      actionLabel: 'Click to download · ' + (doc.nativeExt || 'file').toUpperCase(),
      iconSvg: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M28 4H10a2 2 0 0 0-2 2v36a2 2 0 0 0 2 2h28a2 2 0 0 0 2-2V16z"/><polyline points="28 4 28 16 40 16"/></svg>',
    };
  }

  // ══════ NATIVE FILE ACCESS (Excel) ══════
  // When a workbook has multiple sheets, we attach the original file bytes to only
  // the first sheet's doc to avoid N-fold memory bloat. This finds whichever doc
  // actually carries the nativeDataUrl for a given sheet-doc.
  function findNativeWorkbookDoc(doc) {
    if (doc.nativeDataUrl) return doc;
    if (!doc.workbookFileName) return null;
    return state.docs.find(d =>
      d.workbookFileName === doc.workbookFileName &&
      d.nativeDataUrl
    );
  }

  // Download the original file — user's OS will open it in the default app
  // (Excel, Numbers, LibreOffice, etc.) preserving formulas and formatting.
  function openNativeFile(doc) {
    const src = findNativeWorkbookDoc(doc);
    if (!src || !src.nativeDataUrl) {
      toast('Not available', 'Native file data not found', 'warning');
      return;
    }
    const a = document.createElement('a');
    a.href = src.nativeDataUrl;
    a.download = src.nativeFileName || (doc.displayName + '.xlsx');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast('Downloaded', src.nativeFileName + ' — open to edit in Excel', 'success');
  }

  // ══════ SEARCH NAVIGATION (like Ctrl+F in Word) ══════
  function runSearch() {
    // renderDocsList calls filteredDocs internally which updates
    // state.searchResults + state.searchTotalMatches + per-doc _searchMatches
    renderDocsList();
    state.searchIndex = 0;
    updateSearchCounter();
    scrollToFocusedMatch();
    // Re-render so the focused doc gets its search-focused class
    if (state.searchResults.length > 0) renderDocsList();
  }

  function searchNext() {
    if (state.searchResults.length === 0) return;
    state.searchIndex = (state.searchIndex + 1) % state.searchResults.length;
    updateSearchCounter();
    scrollToFocusedMatch();
    renderDocsList();
  }

  function searchPrev() {
    if (state.searchResults.length === 0) return;
    state.searchIndex = (state.searchIndex - 1 + state.searchResults.length) % state.searchResults.length;
    updateSearchCounter();
    scrollToFocusedMatch();
    renderDocsList();
  }

  function clearSearch() {
    $id('searchInput').value = '';
    state.searchQuery = '';
    state.searchResults = [];
    state.searchIndex = 0;
    state.searchTotalMatches = 0;
    $id('searchClear').classList.remove('visible');
    updateSearchCounter();
    renderDocsList();
  }

  function updateSearchCounter() {
    const counter = $id('searchCounter');
    const prev = $id('searchPrev');
    const next = $id('searchNext');
    const wrap = document.querySelector('.topbar-search');
    if (!counter) return;
    const total = state.searchResults.length;
    if (!state.searchQuery) {
      counter.textContent = '';
      counter.classList.remove('visible', 'no-match');
      wrap && wrap.classList.remove('has-results');
      if (prev) prev.disabled = true;
      if (next) next.disabled = true;
      return;
    }
    if (total === 0) {
      counter.textContent = '0 of 0';
      counter.classList.add('visible', 'no-match');
      wrap && wrap.classList.add('has-results');
      if (prev) prev.disabled = true;
      if (next) next.disabled = true;
      return;
    }
    counter.textContent = (state.searchIndex + 1) + ' of ' + total;
    counter.classList.add('visible');
    counter.classList.remove('no-match');
    wrap && wrap.classList.add('has-results');
    if (prev) prev.disabled = false;
    if (next) next.disabled = false;
  }

  function scrollToFocusedMatch() {
    if (state.searchResults.length === 0) return;
    const focusedId = state.searchResults[state.searchIndex];
    setTimeout(() => {
      const el = document.querySelector('[data-doc-id="' + focusedId + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }

  function sortDocs(docs) {
    const order = state.sortOrder;
    return [...docs].sort((a, b) => {
      switch (order) {
        case 'newest': return b.addedAt - a.addedAt;
        case 'oldest': return a.addedAt - b.addedAt;
        case 'name-asc': return a.displayName.localeCompare(b.displayName);
        case 'name-desc': return b.displayName.localeCompare(a.displayName);
        case 'type': return (a.type || '').localeCompare(b.type || '');
        default: return 0;
      }
    });
  }

  function renderDocsList() {
    const list = $id('docsList');
    const empty = $id('docsEmpty');
    const docs = filterDocs();

    // Remove non-empty children
    Array.from(list.children).forEach(c => { if (c !== empty) c.remove(); });

    if (docs.length === 0) {
      empty.style.display = '';
    } else {
      empty.style.display = 'none';
      docs.forEach(doc => list.appendChild(buildDocItem(doc)));
    }

    $id('docsCount').textContent = docs.length;
    $id('totalDocs').textContent = state.docs.length;
    updateTagsCount();
    renderCategoryGrid();
  }

  function buildDocItem(doc) {
    const item = document.createElement('div');
    item.className = 'doc-item';
    item.dataset.docId = doc.id;
    if (state.selectedIds.has(doc.id)) item.classList.add('selected');
    if (doc.color) { item.classList.add('has-color', 'tag-' + doc.color); }

    const colorBar = document.createElement('div');
    colorBar.className = 'doc-color-bar';
    item.appendChild(colorBar);

    const thumb = document.createElement('div');
    thumb.className = 'doc-thumb';

    if ((doc.type === 'pdf' || doc.type === 'image') && doc.thumbnailData) {
      const img = document.createElement('img');
      img.src = doc.thumbnailData;
      img.loading = 'lazy';
      img.alt = doc.displayName;
      thumb.appendChild(img);
    } else if (doc.type === 'excel' || doc.type === 'archive' || doc.type === 'native' || doc.type === 'csv' ||
               (doc.type === 'email' && doc.emailMeta?.format === 'msg') ||
               (doc.type === 'powerpoint' && !doc.htmlContent)) {
      // NATIVE-TILE types — no inline preview, click to open in OS default app.
      // Covers: Excel, archives, unknown/binary files, CSVs, Outlook .msg files,
      // legacy .ppt (where we couldn't parse slides).
      const card = document.createElement('div');
      const accent = nativeAccentForType(doc);
      card.className = 'doc-thumb-native doc-thumb-native-' + accent.cls;
      const fileSizeKB = doc.fileSize ? Math.round(doc.fileSize / 1024) : null;
      const sizeLabel = fileSizeKB
        ? (fileSizeKB > 1024 ? (fileSizeKB / 1024).toFixed(1) + ' MB' : fileSizeKB + ' KB')
        : '';
      const metaParts = [];
      if (doc.type === 'excel') {
        const sheetsLabel = doc.sheetCount > 1 ? doc.sheetCount + ' sheets'
          : (doc.sheetNames && doc.sheetNames[0] ? doc.sheetNames[0] : '1 sheet');
        metaParts.push(sheetsLabel);
        if (doc.dimensions) metaParts.push(doc.dimensions);
      } else if (doc.type === 'csv' && doc.dimensions) {
        metaParts.push(doc.dimensions);
      } else if (doc.type === 'email' && doc.emailMeta?.format === 'msg') {
        metaParts.push('Outlook message');
      } else if (doc.type === 'archive') {
        metaParts.push((doc.nativeExt || 'archive').toUpperCase() + ' archive');
      } else if (doc.type === 'powerpoint' && !doc.htmlContent) {
        metaParts.push('Presentation');
      }
      if (sizeLabel) metaParts.push(sizeLabel);
      const metaHtml = metaParts.map(p => '<span>' + escapeHtml(p) + '</span>')
                                 .join('<span>·</span>');
      card.innerHTML = `
        <div class="native-card-icon">${accent.iconSvg}</div>
        <div class="native-card-body">
          <div class="native-card-name">${escapeHtml(doc.workbookFileName || doc.displayName)}</div>
          <div class="native-card-meta">${metaHtml}</div>
          <div class="native-card-action">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>${accent.actionLabel}</span>
          </div>
        </div>
      `;
      thumb.appendChild(card);
    } else if (doc.type === 'word' && doc.htmlContent) {
      // Render Word pages as miniature US-Letter pages using CSS transform.
      // A ResizeObserver keeps the scale in sync with the thumb container width
      // so the page thumbnail stays sharp and proportional at any panel width.
      const pageWrap = document.createElement('div');
      pageWrap.className = 'doc-thumb-word';
      const page = document.createElement('div');
      page.className = 'doc-thumb-word-page';
      // Apply search highlights if query is active
      page.innerHTML = state.searchQuery
        ? highlightHtmlMatches(doc.htmlContent, state.searchQuery)
        : doc.htmlContent;
      pageWrap.appendChild(page);
      thumb.appendChild(pageWrap);

      // Scale the inner page to fit the outer wrap width (US Letter = 816px).
      const applyScale = () => {
        const w = pageWrap.clientWidth;
        if (w > 0) {
          const scale = w / 816;
          page.style.transform = 'scale(' + scale + ')';
        }
      };
      applyScale();
      requestAnimationFrame(applyScale);
      setTimeout(applyScale, 50);

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(applyScale);
        ro.observe(pageWrap);
      }
    } else if ((doc.type === 'email' || doc.type === 'powerpoint' || doc.type === 'text') && doc.htmlContent) {
      // Paginated content types that render as miniature pages (same approach as Word)
      const pageWrap = document.createElement('div');
      pageWrap.className = 'doc-thumb-word';
      const page = document.createElement('div');
      page.className = 'doc-thumb-word-page doc-thumb-' + doc.type;
      page.innerHTML = state.searchQuery
        ? highlightHtmlMatches(doc.htmlContent, state.searchQuery)
        : doc.htmlContent;
      pageWrap.appendChild(page);
      thumb.appendChild(pageWrap);

      const applyScale = () => {
        const w = pageWrap.clientWidth;
        if (w > 0) {
          const scale = w / 816;
          page.style.transform = 'scale(' + scale + ')';
        }
      };
      applyScale();
      requestAnimationFrame(applyScale);
      setTimeout(applyScale, 50);

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(applyScale);
        ro.observe(pageWrap);
      }
    } else if (doc.htmlContent) {
      const content = document.createElement('div');
      content.className = 'doc-thumb-content';
      const snippet = doc.htmlContent.substring(0, 1500);
      content.innerHTML = state.searchQuery
        ? highlightHtmlMatches(snippet, state.searchQuery)
        : snippet;
      thumb.appendChild(content);
    }

    const typeBadge = document.createElement('span');
    typeBadge.className = 'doc-badge';
    typeBadge.textContent = doc.type.toUpperCase();
    thumb.appendChild(typeBadge);

    // Page badge — only for true paginated types (PDF pages, Word pages, email pages, etc.)
    const isNativeOnlyRender = (doc.type === 'excel' || doc.type === 'archive' || doc.type === 'native' ||
                                doc.type === 'csv' ||
                                (doc.type === 'email' && doc.emailMeta?.format === 'msg') ||
                                (doc.type === 'powerpoint' && !doc.htmlContent));
    if (!isNativeOnlyRender && (doc.totalPages > 1 || doc.type === 'pdf')) {
      const pageBadge = document.createElement('span');
      pageBadge.className = 'doc-page-badge';
      pageBadge.textContent = 'p. ' + doc.pageNumber + '/' + doc.totalPages;
      thumb.appendChild(pageBadge);
    }

    // Search match count badge — appears on docs that contain the active query.
    // For image thumbnails (PDFs) this is the only visual cue since we can't easily
    // highlight text on a rasterized page.
    if (state.searchQuery && doc._searchMatches > 0) {
      const matchBadge = document.createElement('span');
      matchBadge.className = 'doc-search-badge';
      matchBadge.textContent = doc._searchMatches + ' match' + (doc._searchMatches === 1 ? '' : 'es');
      thumb.appendChild(matchBadge);
      item.classList.add('has-search-match');
      // Mark the doc currently focused by the Next/Prev navigator
      const focusedId = state.searchResults[state.searchIndex];
      if (doc.id === focusedId) item.classList.add('search-focused');
    }

    // Annotation indicator (if annotations exist on this doc)
    const annoStore = state.annotations.store[doc.id];
    if (annoStore && annoStore.layers && annoStore.layers.length > 0) {
      const ind = document.createElement('div');
      ind.className = 'anno-indicator';
      ind.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 19l7-7 3 3-7 7-3-3z"/></svg>';
      thumb.appendChild(ind);
    }

    item.appendChild(thumb);

    const info = document.createElement('div');
    info.className = 'doc-info';
    info.innerHTML = `
      <div class="doc-name" data-doc-name title="Double-click to rename">${escapeHtml(doc.displayName)}</div>
      <div class="doc-meta">
        <span class="doc-date">${doc.uploadDate}</span>
        <div class="doc-actions">
          <button class="doc-mini-btn doc-color-btn" title="Color tag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg></button>
          <button class="doc-mini-btn doc-tag-btn ${doc.tagged ? 'active' : ''}" title="Toggle tag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button>
          <button class="doc-mini-btn doc-preview-btn" title="Preview"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
        </div>
      </div>
    `;
    item.appendChild(info);

    // Event bindings
    // A doc is "native-tile" (click → download) vs "preview-able" (click → modal).
    // Native-tile = Excel, archives, unknowns, CSVs, .msg emails, .ppt (legacy binary),
    // and .pptx where slide parsing failed (no htmlContent).
    const isNativeTileType = (d) => (
      d.type === 'excel' || d.type === 'archive' || d.type === 'native' || d.type === 'csv' ||
      (d.type === 'email' && d.emailMeta?.format === 'msg') ||
      (d.type === 'powerpoint' && !d.htmlContent)
    );

    thumb.onclick = (e) => {
      e.stopPropagation();
      if (state.annotations.tool !== 'pointer') return;
      if (state.annotations.previewBlocked) return;
      if (e.target.closest('.anno-text-input, .anno-sticky')) return;
      if (isNativeTileType(doc)) { openNativeFile(doc); return; }
      openPreview(doc.id);
    };
    info.querySelector('.doc-tag-btn').onclick = (e) => { e.stopPropagation(); toggleTag(doc.id); };
    info.querySelector('.doc-preview-btn').onclick = (e) => {
      e.stopPropagation();
      if (isNativeTileType(doc)) { openNativeFile(doc); return; }
      openPreview(doc.id);
    };
    info.querySelector('.doc-color-btn').onclick = (e) => {
      e.stopPropagation();
      showDocColorMenu(info.querySelector('.doc-color-btn'), doc.id);
    };
    item.onclick = (e) => {
      if (state.annotations.tool !== 'pointer') return;
      if (state.annotations.previewBlocked) return;
      if (e.target.closest('.doc-actions, .color-picker-menu, .doc-name, .doc-name-input, .anno-text-input, .anno-sticky')) return;
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); toggleSelectDoc(doc.id); return; }
      if (e.shiftKey && state.selectedIds.size > 0) { e.preventDefault(); rangeSelectDoc(doc.id); return; }
      if (isNativeTileType(doc)) { openNativeFile(doc); return; }
      openPreview(doc.id);
    };
    item.oncontextmenu = (e) => {
      e.preventDefault();
      state.contextDoc = doc.id;
      showContextMenu(e.clientX, e.clientY);
    };
    info.querySelector('[data-doc-name]').ondblclick = (e) => { e.stopPropagation(); startRename(doc.id, item); };

    // Attach annotation canvas after thumb has dimensions
    setTimeout(() => {
      if (window.STM_ANNO && typeof window.STM_ANNO.ensureCanvas === 'function') {
        window.STM_ANNO.ensureCanvas(thumb, doc.id);
      }
    }, 30);

    return item;
  }

  // ══════ FILE UPLOAD ══════
  function promptCategoryAssign(files) {
    state.pendingUpload = {
      files,
      category: state.currentCategory !== 'all' ? state.currentCategory : 'all'
    };
    $id('modalSub').textContent = files.length + ' file' + (files.length > 1 ? 's' : '') + ' ready to upload';
    $id('modalConfirmLabel').textContent = 'Upload';
    renderModalCategoryGrid();
    $id('categoryModal').classList.add('visible');
  }

  function closeCategoryModal() {
    $id('categoryModal').classList.remove('visible');
    state.pendingUpload = null;
  }

  async function confirmUpload() {
    if (!state.pendingUpload) return;

    // Bulk-move flow
    if (state.pendingUpload.bulkMoveIds) {
      const ids = state.pendingUpload.bulkMoveIds;
      const cat = state.pendingUpload.category;
      ids.forEach(id => { const d = state.docs.find(x => x.id === id); if (d) d.category = cat; });
      closeCategoryModal();
      clearSelection();
      renderDocsList();
      toast('Moved', ids.length + ' documents → ' + cat, 'success');
      return;
    }
    // Single-move flow
    if (state.pendingUpload.singleMoveId) {
      const id = state.pendingUpload.singleMoveId;
      const cat = state.pendingUpload.category;
      const doc = state.docs.find(d => d.id === id);
      if (doc) { doc.category = cat; toast('Moved', doc.displayName + ' → ' + cat, 'success'); }
      closeCategoryModal();
      renderDocsList();
      return;
    }

    const { files, category } = state.pendingUpload;
    if (files && files.length) parentPost('stm-docs-files-added', { files: Array.from(files), category: category || 'all' });
    closeCategoryModal();

    showLoading('Processing documents');
    let success = 0, errors = 0;
    const errorDetails = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pct = Math.round((i / files.length) * 100);
      updateLoading(pct, file.name);
      try {
        await processFile(file, category);
        success++;
      } catch (err) {
        console.error('Failed to process', file.name, err);
        errors++;
        errorDetails.push(file.name + ': ' + (err.message || 'unknown error'));
      }
    }

    updateLoading(100, 'Done');
    await delay(200);
    hideLoading();

    if (errors > 0) {
      // Show the first error message so user knows WHY it failed
      const msg = success > 0
        ? success + ' processed, ' + errors + ' failed — ' + errorDetails[0]
        : errorDetails[0];
      toast('Upload issue', msg, success > 0 ? 'warning' : 'error');
    } else {
      toast('Upload complete', success + ' file' + (success !== 1 ? 's' : '') + ' ready', 'success');
    }

    if (category !== 'all' && state.currentCategory === 'all') selectCategory(category);
    else renderDocsList();
  }

  async function processFile(file, category) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) return processPDF(file, category);
    if (/\.(xlsx|xlsm|xls|xltx|xltm|xlsb)$/.test(name)) return processExcel(file, category);
    if (/\.(docx|doc)$/.test(name)) return processWord(file, category);
    if (name.endsWith('.rtf')) return processRtf(file, category);
    if (/\.(jpe?g|png|tiff?|gif|webp|bmp)$/i.test(name)) return processImage(file, category);
    if (/\.(eml|msg|oft)$/.test(name)) return processEmail(file, category);
    if (/\.(pptx|ppt|ppsx|potx|potm|pptm)$/.test(name)) return processPowerPoint(file, category);
    if (/\.(csv|tsv)$/.test(name)) return processCsv(file, category);
    if (/\.(txt|log|md)$/.test(name)) return processText(file, category);
    if (/\.(zip|rar|7z|tar|gz)$/.test(name)) return processArchive(file, category);
    // Catch-all: unknown types get a native tile so user can still tag/organize/open
    return processNativeOnly(file, category);
  }

  // RTF — strip control codes to plain text, then paginate like a text file.
  // The real .rtf bytes are preserved so user can download and open in Word.
  async function processRtf(file, category) {
    const nativeDataUrl = await cacheNativeFile(file);
    let raw = '';
    try {
      raw = await file.text();
    } catch (e) {
      throw new Error('Could not read RTF: ' + e.message);
    }
    // Very simple RTF stripper: remove control words \wordN, groups {}, and hex escapes
    const plain = raw
      .replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u-?\d+\??/g, '')
      .replace(/\\par[d]?\b/g, '\n')
      .replace(/\\tab\b/g, '\t')
      .replace(/\\[a-zA-Z]+-?\d*\s?/g, '')
      .replace(/[{}]/g, '')
      .replace(/\\\\/g, '\\')
      .replace(/\\([{}])/g, '$1')
      .trim();

    const base = stripExt(file.name);
    const LINES_PER_PAGE = 55;
    const lines = plain.split(/\r?\n/);

    if (lines.length <= LINES_PER_PAGE) {
      addDoc({
        name: base,
        type: 'text',  // rendered like text — same pre block
        category,
        htmlContent: '<pre>' + escapeHtml(plain) + '</pre>',
        textContent: plain,
        nativeDataUrl,
        nativeFileName: file.name,
        nativeMimeType: file.type || 'application/rtf',
        workbookFileName: file.name,
        fileSize: file.size,
        nativeExt: 'rtf',
      });
      return;
    }
    const totalPages = Math.ceil(lines.length / LINES_PER_PAGE);
    for (let i = 0; i < totalPages; i++) {
      const chunk = lines.slice(i * LINES_PER_PAGE, (i + 1) * LINES_PER_PAGE).join('\n');
      addDoc({
        name: `${base} — Page ${i + 1}`,
        type: 'text',
        category,
        htmlContent: '<pre>' + escapeHtml(chunk) + '</pre>',
        textContent: chunk,
        pageNumber: i + 1,
        totalPages,
        nativeDataUrl: i === 0 ? nativeDataUrl : null,
        nativeFileName: file.name,
        nativeMimeType: file.type || 'application/rtf',
        workbookFileName: file.name,
        fileSize: file.size,
        nativeExt: 'rtf',
      });
      if (i < totalPages - 1 && i % 10 === 9) await delay(5);
    }
  }

  // ════════ UNIVERSAL NATIVE-FILE PROCESSOR ════════
  // Reads file bytes, caches as data URL for re-download, creates a single "native" tile.
  // Used for archives, unknown types, and as a helper for other processors.
  async function cacheNativeFile(file) {
    const MAX_NATIVE_BYTES = 40 * 1024 * 1024;
    if (file.size > MAX_NATIVE_BYTES) {
      console.warn(file.name + ' is ' + (file.size/1024/1024).toFixed(1) + ' MB — skipping native cache');
      return null;
    }
    try {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.readAsDataURL(file);
      });
    } catch (err) {
      console.warn('Could not cache native bytes for', file.name, err);
      return null;
    }
  }

  // Generic "native-only" fallback for unknown/archive/binary types
  async function processNativeOnly(file, category) {
    const nativeDataUrl = await cacheNativeFile(file);
    const ext = (file.name.match(/\.([^.]+)$/) || [,'file'])[1].toLowerCase();
    addDoc({
      name: stripExt(file.name),
      type: 'native',
      category,
      nativeDataUrl,
      nativeFileName: file.name,
      nativeMimeType: file.type || 'application/octet-stream',
      workbookFileName: file.name,
      fileSize: file.size,
      nativeExt: ext,
      textContent: '',
    });
  }

  // Archives — single native tile with archive icon
  async function processArchive(file, category) {
    const nativeDataUrl = await cacheNativeFile(file);
    const ext = (file.name.match(/\.([^.]+)$/) || [,'zip'])[1].toLowerCase();
    addDoc({
      name: stripExt(file.name),
      type: 'archive',
      category,
      nativeDataUrl,
      nativeFileName: file.name,
      nativeMimeType: file.type || 'application/zip',
      workbookFileName: file.name,
      fileSize: file.size,
      nativeExt: ext,
      textContent: '',
    });
  }

  // CSV/TSV — single tile like Excel, readable as text for search
  async function processCsv(file, category) {
    const nativeDataUrl = await cacheNativeFile(file);
    let textContent = '';
    try {
      textContent = await file.text();
    } catch (e) { /* empty ok */ }
    // Count rows/cols for badge info
    const lines = textContent.split(/\r?\n/).filter(l => l.trim());
    const firstLine = lines[0] || '';
    const delim = file.name.toLowerCase().endsWith('.tsv') ? '\t' : ',';
    const colCount = firstLine.split(delim).length;
    addDoc({
      name: stripExt(file.name),
      type: 'csv',
      category,
      nativeDataUrl,
      nativeFileName: file.name,
      nativeMimeType: file.type || 'text/csv',
      workbookFileName: file.name,
      fileSize: file.size,
      nativeExt: file.name.toLowerCase().endsWith('.tsv') ? 'tsv' : 'csv',
      textContent: textContent.substring(0, 100000),  // cap for memory
      dimensions: lines.length + ' rows × ' + colCount + ' cols',
    });
  }

  // Plain text — paginated if long enough, ~60 lines per "page"
  async function processText(file, category) {
    const nativeDataUrl = await cacheNativeFile(file);
    let text = '';
    try {
      text = await file.text();
    } catch (e) {
      throw new Error('Could not read text file: ' + e.message);
    }
    const base = stripExt(file.name);
    const ext = (file.name.match(/\.([^.]+)$/) || [,'txt'])[1].toLowerCase();
    const LINES_PER_PAGE = 55;
    const lines = text.split(/\r?\n/);

    if (lines.length <= LINES_PER_PAGE) {
      // Fits on one "page"
      addDoc({
        name: base,
        type: 'text',
        category,
        htmlContent: '<pre>' + escapeHtml(text) + '</pre>',
        textContent: text,
        nativeDataUrl,
        nativeFileName: file.name,
        nativeMimeType: file.type || 'text/plain',
        workbookFileName: file.name,
        fileSize: file.size,
        nativeExt: ext,
      });
      return;
    }

    // Split into pages
    const totalPages = Math.ceil(lines.length / LINES_PER_PAGE);
    for (let i = 0; i < totalPages; i++) {
      const chunk = lines.slice(i * LINES_PER_PAGE, (i + 1) * LINES_PER_PAGE).join('\n');
      addDoc({
        name: `${base} — Page ${i + 1}`,
        type: 'text',
        category,
        htmlContent: '<pre>' + escapeHtml(chunk) + '</pre>',
        textContent: chunk,
        pageNumber: i + 1,
        totalPages,
        // Native file attached only to first page
        nativeDataUrl: i === 0 ? nativeDataUrl : null,
        nativeFileName: file.name,
        nativeMimeType: file.type || 'text/plain',
        workbookFileName: file.name,
        fileSize: file.size,
        nativeExt: ext,
      });
      if (i < totalPages - 1 && i % 10 === 9) await delay(5);
    }
  }

  // Email (.eml) — RFC 5322 format, parse headers + body + attachments.
  // .msg (Outlook binary) requires a dedicated library; we fall back to native-only
  // tile for .msg so user can still open it in Outlook.
  async function processEmail(file, category) {
    const lowerName = file.name.toLowerCase();
    const nativeDataUrl = await cacheNativeFile(file);
    const baseName = stripExt(file.name);

    if (lowerName.endsWith('.msg') || lowerName.endsWith('.oft')) {
      // Outlook binary format — no reliable browser parser. Tile + native open.
      addDoc({
        name: baseName,
        type: 'email',
        category,
        nativeDataUrl,
        nativeFileName: file.name,
        nativeMimeType: file.type || 'application/vnd.ms-outlook',
        workbookFileName: file.name,
        fileSize: file.size,
        nativeExt: lowerName.endsWith('.oft') ? 'oft' : 'msg',
        textContent: '',
        emailMeta: { format: 'msg' },
      });
      return;
    }

    // .eml: RFC 5322 format. Parse headers and body.
    let raw = '';
    try {
      raw = await file.text();
    } catch (e) {
      throw new Error('Could not read email file: ' + e.message);
    }

    const parsed = parseEml(raw);
    // Paginate body by chunks of text
    const bodyText = parsed.bodyText || '';
    const bodyHtml = parsed.bodyHtml || '';

    // Build header block HTML
    const headerHtml = buildEmailHeaderHtml(parsed.headers);

    // Combine: header on every page, body split into chunks
    const fullHtml = headerHtml + (bodyHtml || '<pre>' + escapeHtml(bodyText) + '</pre>');

    // For pagination, we re-use the Word pagination helper since emails are basically HTML
    let pages;
    try {
      pages = paginateWordHtml(fullHtml);
    } catch (e) {
      pages = [fullHtml];
    }

    const totalPages = pages.length;
    const fromText = parsed.headers.from || '';
    const subjectText = parsed.headers.subject || baseName;

    for (let i = 0; i < totalPages; i++) {
      addDoc({
        name: totalPages > 1 ? `${baseName} — Page ${i + 1}` : baseName,
        type: 'email',
        category,
        htmlContent: pages[i],
        textContent: (parsed.headers.subject || '') + '\n' +
                     (parsed.headers.from || '') + '\n' +
                     (parsed.headers.to || '') + '\n\n' +
                     bodyText,
        pageNumber: i + 1,
        totalPages,
        nativeDataUrl: i === 0 ? nativeDataUrl : null,
        nativeFileName: file.name,
        nativeMimeType: file.type || 'message/rfc822',
        workbookFileName: file.name,
        fileSize: file.size,
        nativeExt: 'eml',
        emailMeta: {
          format: 'eml',
          from: fromText,
          subject: subjectText,
          date: parsed.headers.date,
          attachmentCount: parsed.attachments.length,
        },
      });
      if (i < totalPages - 1 && i % 10 === 9) await delay(5);
    }

    // Extract attachments as their own docs
    for (const att of parsed.attachments) {
      try {
        const attFile = new File([att.bytes], att.filename, { type: att.contentType || 'application/octet-stream' });
        await processFile(attFile, category);
      } catch (err) {
        console.warn('Could not process attachment', att.filename, err);
      }
    }
  }

  // Very lightweight RFC 5322 / MIME parser. Handles single-part and simple multipart.
  // Not a full implementation — good enough for broker forwards and standard .eml files.
  function parseEml(raw) {
    const result = { headers: {}, bodyText: '', bodyHtml: '', attachments: [] };
    // Split headers from body
    const headerEnd = raw.search(/\r?\n\r?\n/);
    if (headerEnd === -1) {
      result.bodyText = raw;
      return result;
    }
    const headerBlock = raw.substring(0, headerEnd);
    const body = raw.substring(headerEnd).replace(/^\r?\n\r?\n/, '');

    // Parse headers (fold continuation lines first)
    const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, ' ');
    unfolded.split(/\r?\n/).forEach(line => {
      const m = line.match(/^([^:]+):\s*(.*)$/);
      if (m) {
        const key = m[1].toLowerCase().trim();
        result.headers[key] = decodeMimeWord(m[2].trim());
      }
    });

    const contentType = (result.headers['content-type'] || '').toLowerCase();
    const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/i);

    if (boundaryMatch) {
      // Multipart — split by boundary
      const boundary = '--' + boundaryMatch[1];
      const parts = body.split(boundary).slice(1, -1);
      for (const part of parts) {
        const pHeadEnd = part.search(/\r?\n\r?\n/);
        if (pHeadEnd === -1) continue;
        const pHeaders = {};
        part.substring(0, pHeadEnd).replace(/\r?\n[ \t]+/g, ' ')
          .split(/\r?\n/).forEach(line => {
            const m = line.match(/^([^:]+):\s*(.*)$/);
            if (m) pHeaders[m[1].toLowerCase().trim()] = m[2].trim();
          });
        const pBody = part.substring(pHeadEnd).replace(/^\r?\n\r?\n/, '').replace(/\r?\n$/, '');
        const pCT = (pHeaders['content-type'] || '').toLowerCase();
        const enc = (pHeaders['content-transfer-encoding'] || '').toLowerCase();
        const disposition = (pHeaders['content-disposition'] || '').toLowerCase();

        if (disposition.includes('attachment') || disposition.includes('filename')) {
          // Attachment
          const filenameMatch = disposition.match(/filename="?([^";]+)"?/i) ||
                                pCT.match(/name="?([^";]+)"?/i);
          if (filenameMatch) {
            try {
              const filename = decodeMimeWord(filenameMatch[1]);
              const bytes = enc === 'base64'
                ? base64ToUint8(pBody.replace(/\s/g, ''))
                : new TextEncoder().encode(pBody);
              result.attachments.push({
                filename,
                contentType: pCT.split(';')[0].trim(),
                bytes,
              });
            } catch (e) { /* skip bad attachment */ }
          }
        } else if (pCT.startsWith('text/html')) {
          result.bodyHtml = decodeBody(pBody, enc, pCT);
        } else if (pCT.startsWith('text/plain') || pCT === '') {
          if (!result.bodyText) result.bodyText = decodeBody(pBody, enc, pCT);
        }
      }
    } else {
      // Single-part
      const enc = (result.headers['content-transfer-encoding'] || '').toLowerCase();
      const decoded = decodeBody(body, enc, contentType);
      if (contentType.startsWith('text/html')) result.bodyHtml = decoded;
      else result.bodyText = decoded;
    }

    return result;
  }

  function decodeBody(body, encoding, contentType) {
    if (encoding === 'base64') {
      try {
        const bytes = base64ToUint8(body.replace(/\s/g, ''));
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      } catch (e) { return body; }
    }
    if (encoding === 'quoted-printable') {
      return body.replace(/=\r?\n/g, '')
                 .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    }
    return body;
  }

  function base64ToUint8(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Decode =?UTF-8?B?...?= encoded words in headers
  function decodeMimeWord(s) {
    return String(s).replace(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi, (_, charset, enc, data) => {
      try {
        if (enc.toUpperCase() === 'B') {
          const bytes = base64ToUint8(data);
          return new TextDecoder(charset.toLowerCase()).decode(bytes);
        } else {
          // Q-encoding
          return data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_, h) =>
            String.fromCharCode(parseInt(h, 16)));
        }
      } catch (e) { return data; }
    });
  }

  function buildEmailHeaderHtml(headers) {
    const rows = [];
    const keys = ['from', 'to', 'cc', 'subject', 'date'];
    for (const k of keys) {
      if (headers[k]) {
        rows.push(
          '<div class="eml-header-row">' +
            '<span class="eml-header-key">' + k.charAt(0).toUpperCase() + k.slice(1) + ':</span>' +
            '<span class="eml-header-val">' + escapeHtml(headers[k]) + '</span>' +
          '</div>'
        );
      }
    }
    return '<div class="eml-header">' + rows.join('') + '</div>';
  }

  // PowerPoint — .pptx is a zip containing slide XML. We extract slide notes and
  // metadata for search, and render each slide as a simple HTML representation.
  // True visual fidelity requires a dedicated library; this gives the user a
  // per-slide thumbnail they can tag, with the real file one click away.
  async function processPowerPoint(file, category) {
    const lowerName = file.name.toLowerCase();
    const nativeDataUrl = await cacheNativeFile(file);
    const baseName = stripExt(file.name);
    const ext = (lowerName.match(/\.([^.]+)$/) || [,'pptx'])[1];

    // .ppt (legacy binary) can't be unzipped — native-only tile
    if (lowerName.endsWith('.ppt')) {
      addDoc({
        name: baseName,
        type: 'powerpoint',
        category,
        nativeDataUrl,
        nativeFileName: file.name,
        nativeMimeType: file.type || 'application/vnd.ms-powerpoint',
        workbookFileName: file.name,
        fileSize: file.size,
        nativeExt: 'ppt',
        textContent: '',
      });
      return;
    }

    // Modern .pptx / .ppsx / .potx — these are zip archives
    let slides = [];
    let slideCount = 0;
    try {
      const buf = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      // Find all slide XML files (word/slides/slideN.xml)
      const slideFiles = Object.keys(zip.files)
        .filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k))
        .sort((a, b) => {
          const na = parseInt(a.match(/slide(\d+)/)[1], 10);
          const nb = parseInt(b.match(/slide(\d+)/)[1], 10);
          return na - nb;
        });
      slideCount = slideFiles.length;

      for (const slidePath of slideFiles) {
        const xmlStr = await zip.file(slidePath).async('string');
        // Extract all <a:t> text runs — that's where slide text lives
        const textMatches = xmlStr.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
        const textRuns = textMatches.map(m => {
          const inner = m.replace(/<a:t[^>]*>/, '').replace(/<\/a:t>/, '');
          // Decode basic HTML entities
          return inner.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                       .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
        });
        const slideText = textRuns.join('\n');
        slides.push({ text: slideText, runs: textRuns });
      }
    } catch (err) {
      console.warn('PowerPoint parse failed, falling back to native tile:', err);
      // Fall back to native-only
      addDoc({
        name: baseName,
        type: 'powerpoint',
        category,
        nativeDataUrl,
        nativeFileName: file.name,
        nativeMimeType: file.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        workbookFileName: file.name,
        fileSize: file.size,
        nativeExt: ext,
        textContent: '',
      });
      return;
    }

    if (slides.length === 0) {
      addDoc({
        name: baseName,
        type: 'powerpoint',
        category,
        nativeDataUrl,
        nativeFileName: file.name,
        workbookFileName: file.name,
        fileSize: file.size,
        nativeExt: ext,
      });
      return;
    }

    // Create one doc per slide. First slide carries the native file bytes.
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      // Build a simple slide HTML: first run as title, rest as body
      const titleText = slide.runs[0] || '';
      const bodyRuns = slide.runs.slice(1);
      const slideHtml =
        '<div class="ppt-slide">' +
          (titleText ? '<h1 class="ppt-slide-title">' + escapeHtml(titleText) + '</h1>' : '') +
          bodyRuns.map(r => '<p class="ppt-slide-body">' + escapeHtml(r) + '</p>').join('') +
        '</div>';

      addDoc({
        name: `${baseName} — Slide ${i + 1}`,
        type: 'powerpoint',
        category,
        htmlContent: slideHtml,
        textContent: slide.text,
        pageNumber: i + 1,
        totalPages: slides.length,
        nativeDataUrl: i === 0 ? nativeDataUrl : null,
        nativeFileName: file.name,
        nativeMimeType: file.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        workbookFileName: file.name,
        fileSize: file.size,
        nativeExt: ext,
      });
      if (i < slides.length - 1 && i % 10 === 9) await delay(5);
    }
  }

  // PDF processor — SPLITS EVERY PAGE into its own document object
  async function processPDF(file, category) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const total = pdf.numPages;
    const baseName = stripExt(file.name);

    for (let n = 1; n <= total; n++) {
      updateLoading(
        Math.round(((n - 1) / total) * 100),
        file.name + ' — page ' + n + '/' + total
      );
      const page = await pdf.getPage(n);
      const thumbData = await renderPdfPage(page, CONFIG.pdf.thumbnailScale);
      const highResData = await renderPdfPage(page, CONFIG.pdf.highResScale);
      let pageText = '';
      try {
        const tc = await page.getTextContent();
        pageText = tc.items.map(it => it.str).join(' ');
      } catch(e) {}
      addDoc({
        name: total > 1 ? `${baseName} — Page ${n}` : baseName,
        type: 'pdf',
        category,
        thumbnailData: thumbData,
        highResData: highResData,
        textContent: pageText,
        pageNumber: n,
        totalPages: total,
        pdfData: buf,
      });
    }
  }

  async function renderPdfPage(page, scale) {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/png');
  }

  async function processExcel(file, category) {
    const base = stripExt(file.name);
    const originalFileName = file.name;
    const lowerName = file.name.toLowerCase();
    const mimeType = file.type || (
      lowerName.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
      lowerName.endsWith('.xlsm') ? 'application/vnd.ms-excel.sheet.macroEnabled.12' :
      lowerName.endsWith('.xlsb') ? 'application/vnd.ms-excel.sheet.binary.macroEnabled.12' :
      lowerName.endsWith('.xltx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.template' :
      lowerName.endsWith('.xltm') ? 'application/vnd.ms-excel.template.macroEnabled.12' :
      'application/vnd.ms-excel'  // .xls fallback
    );

    // Step 1: read the bytes
    let buf;
    try {
      buf = await file.arrayBuffer();
    } catch (err) {
      throw new Error('Could not read file bytes: ' + err.message);
    }

    // Step 2: parse workbook just to grab sheet names + dimensions for the tile info.
    // We do NOT create separate docs per sheet — the single doc represents the whole file.
    let sheetNames = [];
    let totalRows = 0;
    let totalCols = 0;
    let searchText = '';
    try {
      const wb = XLSX.read(buf, { type: 'array', cellStyles: false });
      sheetNames = wb.SheetNames || [];
      // Use the first sheet's dimensions for the tile badge (most common: one main sheet)
      // For multi-sheet workbooks we show "N sheets" separately.
      if (sheetNames.length > 0) {
        const ws = wb.Sheets[sheetNames[0]];
        try {
          const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
          totalRows = range.e.r - range.s.r + 1;
          totalCols = range.e.c - range.s.c + 1;
        } catch (e) { /* keep zeros */ }
        // Gather searchable text from ALL sheets so content-search still works
        try {
          searchText = sheetNames.map(name => {
            try { return XLSX.utils.sheet_to_txt(wb.Sheets[name]); } catch (e) { return ''; }
          }).join('\n\n');
        } catch (e) { /* empty text is fine */ }
      }
    } catch (err) {
      throw new Error('Not a valid Excel file: ' + err.message);
    }

    // Step 3: preserve native bytes as a data URL (for "Open in Excel"). Skip on very
    // large files to avoid crashing the tab.
    let nativeDataUrl = null;
    const MAX_NATIVE_BYTES = 40 * 1024 * 1024;
    if (file.size <= MAX_NATIVE_BYTES) {
      try {
        nativeDataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
          reader.readAsDataURL(file);
        });
      } catch (err) {
        console.warn('Could not cache native Excel bytes:', err);
        nativeDataUrl = null;
      }
    } else {
      console.warn('Excel file ' + (file.size / 1024 / 1024).toFixed(1) + ' MB — skipping native cache');
    }

    // Step 4: create ONE doc for the entire file — no sheet splitting, no pagination.
    // The tile shows a native-file card; clicking it downloads the real .xlsx.
    addDoc({
      name: base,
      type: 'excel',
      category,
      htmlContent: null,   // no preview HTML — tile shows a native-card thumbnail instead
      textContent: searchText,  // still searchable
      sheetName: null,
      nativeDataUrl,
      nativeFileName: originalFileName,
      nativeMimeType: mimeType,
      workbookFileName: originalFileName,
      sheetCount: sheetNames.length,
      sheetNames: sheetNames,  // so the tile can list them
      dimensions: totalRows > 0 ? (totalRows + ' rows × ' + totalCols + ' cols') : null,
      fileSize: file.size,
    });
  }

  async function processWord(file, category) {
    const buf = await file.arrayBuffer();
    const baseName = stripExt(file.name);

    let pages = null;
    let plainText = '';

    // Try the exact XML-based paginator first (matches Word's page count 1:1)
    try {
      const result = await paginateDocxByXml(buf);
      pages = result.pages;
      plainText = result.plainText;
    } catch (err) {
      console.warn('XML pagination failed, falling back to height-based', err);
      const mammothResult = await mammoth.convertToHtml({ arrayBuffer: buf });
      const textResult = await mammoth.extractRawText({ arrayBuffer: buf });
      pages = paginateWordHtml(mammothResult.value);
      plainText = textResult.value;
    }

    const totalPages = pages.length;
    const totalHtmlLength = pages.reduce((sum, h) => sum + h.length, 0) || 1;
    let textCursor = 0;

    for (let i = 0; i < totalPages; i++) {
      updateLoading(
        Math.round((i / totalPages) * 100),
        file.name + ' — page ' + (i + 1) + '/' + totalPages
      );
      const pageHtml = pages[i];
      const pageTextLen = Math.round((pageHtml.length / totalHtmlLength) * plainText.length);
      const pageText = plainText.substring(textCursor, textCursor + pageTextLen);
      textCursor += pageTextLen;

      addDoc({
        name: totalPages > 1 ? `${baseName} — Page ${i + 1}` : baseName,
        type: 'word',
        category,
        htmlContent: pageHtml,
        textContent: pageText,
        pageNumber: i + 1,
        totalPages: totalPages,
      });

      if (i < totalPages - 1 && i % 10 === 9) await delay(5);
    }
  }

  // ──── XML-BASED PAGINATION (exact match to Word's page count) ────
  // A .docx is a zip. Inside, word/document.xml has the content in order,
  // and Word inserts <w:lastRenderedPageBreak/> (inside <w:r>) at every point
  // where its layout engine broke a page on last save, plus hard breaks
  // <w:br w:type="page"/>. Counting these gives us Word's exact page layout.
  async function paginateDocxByXml(arrayBuf) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip not loaded');
    }
    const zip = await JSZip.loadAsync(arrayBuf);
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) throw new Error('word/document.xml not found');
    const xmlStr = await docXmlFile.async('string');

    // Parse XML. We can't use namespace-aware selectors reliably in browser DOMParser,
    // so we match on localName (strip the 'w:' prefix) when iterating.
    const xml = new DOMParser().parseFromString(xmlStr, 'application/xml');
    const perr = xml.querySelector('parsererror');
    if (perr) throw new Error('XML parse error');

    const body = xml.getElementsByTagNameNS('*', 'body')[0];
    if (!body) throw new Error('No body element');

    // Run mammoth in parallel for HTML rendering
    const [mammothResult, textResult] = await Promise.all([
      mammoth.convertToHtml({ arrayBuffer: arrayBuf }),
      mammoth.extractRawText({ arrayBuffer: arrayBuf }),
    ]);
    const htmlStr = mammothResult.value;
    const htmlDoc = new DOMParser().parseFromString('<div>' + htmlStr + '</div>', 'text/html');
    const htmlRoot = htmlDoc.body.firstElementChild;
    const htmlChildren = Array.from(htmlRoot.childNodes).filter(n =>
      n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim())
    );

    // Walk body children (<w:p> paragraphs and <w:tbl> tables) in order.
    // For each, determine whether it contains a page break marker.
    // Count breaks so we can map block-index → page-number.
    const bodyBlocks = Array.from(body.children).filter(c =>
      c.localName === 'p' || c.localName === 'tbl'
    );

    // For each block, count how many page breaks are "before" the end of it.
    // We split INCLUSIVELY: a block that contains (or ends in) a page break
    // belongs to the page that was just broken, and subsequent blocks start a new page.
    // Word inserts <w:lastRenderedPageBreak/> at the FIRST run of a new page,
    // so encountering it means "this block starts a new page".
    const pageOfBlock = [];   // pageOfBlock[i] = 1-based page number for bodyBlocks[i]
    let currentPage = 1;
    for (let i = 0; i < bodyBlocks.length; i++) {
      const block = bodyBlocks[i];
      // Look for lastRenderedPageBreak or hard page break anywhere inside this block.
      // Use getElementsByTagNameNS to be namespace-robust.
      const lastRendered = block.getElementsByTagNameNS('*', 'lastRenderedPageBreak');
      const brs = block.getElementsByTagNameNS('*', 'br');
      let pageBreakBefore = false; // lastRenderedPageBreak found
      let pageBreakAfter = false;  // hard <w:br w:type="page"/> found
      if (lastRendered.length > 0) pageBreakBefore = true;
      for (const br of Array.from(brs)) {
        // <w:br w:type="page"/> — both 'type' and 'w:type' depending on how parsed
        const t = br.getAttribute('type') || br.getAttributeNS('*', 'type') ||
                  br.getAttribute('w:type');
        if (t === 'page') pageBreakAfter = true;
      }

      if (pageBreakBefore && i > 0) {
        // This block is the first of a new page
        currentPage++;
      }
      pageOfBlock[i] = currentPage;
      if (pageBreakAfter) {
        // Next block starts a new page
        currentPage++;
      }
    }

    const totalPages = currentPage;
    if (totalPages === 1) {
      // No breaks detected at all — fall back to height-based splitting
      const fallback = paginateWordHtml(htmlStr);
      return { pages: fallback, plainText: textResult.value };
    }

    // Now map HTML children → page number. Ideally bodyBlocks.length === htmlChildren.length,
    // but mammoth may drop empty paragraphs or merge elements. Use length-proportional mapping.
    const htmlN = htmlChildren.length;
    const xmlN = bodyBlocks.length;
    const pages = Array(totalPages).fill(null).map(() => []);

    if (htmlN === xmlN) {
      // Perfect 1:1
      htmlChildren.forEach((node, i) => {
        const p = pageOfBlock[i];
        pages[p - 1].push(node);
      });
    } else {
      // Map proportionally: htmlChildren[i] → bodyBlocks[Math.round(i * xmlN / htmlN)]
      htmlChildren.forEach((node, i) => {
        const xmlIdx = Math.min(xmlN - 1, Math.round(i * xmlN / htmlN));
        const p = pageOfBlock[xmlIdx];
        pages[p - 1].push(node);
      });
    }

    // Serialize each page's children to HTML
    const pagesHtml = pages.map(children => {
      const wrap = document.createElement('div');
      children.forEach(c => wrap.appendChild(c.cloneNode(true)));
      return wrap.innerHTML;
    }).filter(h => h.trim());

    return {
      pages: pagesHtml.length > 0 ? pagesHtml : [htmlStr],
      plainText: textResult.value,
    };
  }

  // ──── HEIGHT-BASED PAGINATION (fallback only) ────
  // Used when XML parsing fails or there are no page break markers in the doc.
  function paginateWordHtml(html) {
    const PAGE_WIDTH_PX = 816;   // 8.5" × 96dpi
    const PAGE_HEIGHT_PX = 1056; // 11.0" × 96dpi
    const PAGE_PADDING_PX = 72;  // 0.75" margins
    const USABLE_H = PAGE_HEIGHT_PX - (PAGE_PADDING_PX * 2);

    // Offscreen measurement container
    const measure = document.createElement('div');
    measure.style.cssText = `
      position: absolute; left: -10000px; top: 0;
      width: ${PAGE_WIDTH_PX - PAGE_PADDING_PX * 2}px;
      font-family: Calibri, 'Segoe UI', Arial, sans-serif;
      font-size: 14px; line-height: 1.5; color: #1a1a1a;
      visibility: hidden;
    `;
    document.body.appendChild(measure);

    // Measure an element's rendered height in our fixed-width offscreen container
    const measureHeight = (node) => {
      measure.innerHTML = '';
      measure.appendChild(node.cloneNode(true));
      const h = measure.scrollHeight;
      measure.innerHTML = '';
      return h;
    };

    // Split a too-tall TABLE into several smaller tables — each a valid <table>
    // containing its share of <tr> rows. The <thead> (if any) is repeated on each slice.
    const splitTable = (tableEl) => {
      const allRows = Array.from(tableEl.querySelectorAll(':scope > tr, :scope > tbody > tr, :scope > thead > tr'));
      // Separate header rows from body rows
      const thead = tableEl.querySelector(':scope > thead');
      const headerRows = thead ? Array.from(thead.querySelectorAll(':scope > tr')) : [];
      const bodyRows = allRows.filter(r => !headerRows.includes(r));
      if (bodyRows.length === 0) return [tableEl];

      const buildSlice = (rows) => {
        const t = tableEl.cloneNode(false); // shallow clone preserves attributes
        if (headerRows.length > 0) {
          const newThead = document.createElement('thead');
          headerRows.forEach(r => newThead.appendChild(r.cloneNode(true)));
          t.appendChild(newThead);
        }
        const newTbody = document.createElement('tbody');
        rows.forEach(r => newTbody.appendChild(r.cloneNode(true)));
        t.appendChild(newTbody);
        return t;
      };

      const slices = [];
      let currentRows = [];
      for (const row of bodyRows) {
        currentRows.push(row);
        const probe = buildSlice(currentRows);
        if (measureHeight(probe) > USABLE_H && currentRows.length > 1) {
          // Last added row tipped it over — emit slice WITHOUT the last row, then start fresh with it
          currentRows.pop();
          slices.push(buildSlice(currentRows));
          currentRows = [row];
        }
      }
      if (currentRows.length > 0) slices.push(buildSlice(currentRows));
      return slices;
    };

    // Split a too-tall list (UL/OL) into smaller lists
    const splitList = (listEl) => {
      const items = Array.from(listEl.children).filter(c => c.tagName === 'LI');
      if (items.length <= 1) return [listEl];
      const buildSlice = (liItems) => {
        const l = listEl.cloneNode(false);
        liItems.forEach(li => l.appendChild(li.cloneNode(true)));
        return l;
      };
      const slices = [];
      let currentItems = [];
      for (const li of items) {
        currentItems.push(li);
        const probe = buildSlice(currentItems);
        if (measureHeight(probe) > USABLE_H && currentItems.length > 1) {
          currentItems.pop();
          slices.push(buildSlice(currentItems));
          currentItems = [li];
        }
      }
      if (currentItems.length > 0) slices.push(buildSlice(currentItems));
      return slices;
    };

    // Pre-process: walk top-level children and replace any single child that's too tall
    // with its split pieces (tables → multiple tables, lists → multiple lists).
    const rawChildren = Array.from(new DOMParser().parseFromString(html, 'text/html').body.childNodes);
    const flatChildren = [];
    for (const c of rawChildren) {
      if (c.nodeType === 3 && !c.textContent.trim()) continue;
      if (c.nodeType !== 1) { flatChildren.push(c); continue; }
      const h = measureHeight(c);
      if (h <= USABLE_H) {
        flatChildren.push(c);
        continue;
      }
      const tag = c.tagName;
      if (tag === 'TABLE') {
        flatChildren.push(...splitTable(c));
      } else if (tag === 'UL' || tag === 'OL') {
        flatChildren.push(...splitList(c));
      } else {
        // Can't split — keep as-is (will overflow but that's rare for prose)
        flatChildren.push(c);
      }
    }

    // Now run the standard pagination loop — every "child" is guaranteed to fit
    // on a page by itself (unless it's an unsplittable element larger than the page).
    const pages = [];
    measure.innerHTML = '';
    for (const child of flatChildren) {
      const probe = child.cloneNode(true);
      measure.appendChild(probe);
      const totalHeight = measure.scrollHeight;
      if (totalHeight > USABLE_H && measure.children.length > 1) {
        measure.removeChild(probe);
        pages.push(measure.innerHTML);
        measure.innerHTML = '';
        measure.appendChild(child.cloneNode(true));
      }
    }
    if (measure.innerHTML.trim()) pages.push(measure.innerHTML);

    document.body.removeChild(measure);
    return pages.length > 0 ? pages : [html];
  }

  function processImage(file, category) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        addDoc({
          name: stripExt(file.name),
          type: 'image',
          category,
          thumbnailData: e.target.result,
          highResData: e.target.result,
          textContent: '',
        });
        resolve();
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function addDoc(opts) {
    const now = Date.now();
    const doc = {
      id: 'doc-' + (state.nextId++) + '-' + now,
      name: opts.name,
      displayName: opts.name,
      type: opts.type || 'unknown',
      category: opts.category || 'all',
      thumbnailData: opts.thumbnailData || null,
      highResData: opts.highResData || null,
      htmlContent: opts.htmlContent || null,
      textContent: opts.textContent || '',
      pageNumber: opts.pageNumber || 1,
      totalPages: opts.totalPages || 1,
      pdfData: opts.pdfData || null,
      sheetName: opts.sheetName || null,
      // Native file preservation (Excel keeps its original bytes)
      nativeDataUrl: opts.nativeDataUrl || null,
      nativeFileName: opts.nativeFileName || null,
      nativeMimeType: opts.nativeMimeType || null,
      workbookFileName: opts.workbookFileName || null,
      sheetCount: opts.sheetCount || 1,
      sheetNames: opts.sheetNames || null,
      dimensions: opts.dimensions || null,
      fileSize: opts.fileSize || null,
      nativeExt: opts.nativeExt || null,
      emailMeta: opts.emailMeta || null,
      color: null,
      tagged: false,
      uploadDate: formatDate(new Date()),
      addedAt: now,
      ocrText: null,
      ocrConfidence: null,
    };
    state.docs.push(doc);
    return doc;
  }

  // ══════ TAGGING + COLORING ══════
  function toggleTag(docId) {
    const doc = state.docs.find(d => d.id === docId);
    if (!doc) return;
    doc.tagged = !doc.tagged;
    renderDocsList();
    renderTagsList();
  }

  function setColor(docId, color) {
    const doc = state.docs.find(d => d.id === docId);
    if (!doc) return;
    doc.color = color;
    if (color && !doc.tagged) doc.tagged = true;
    renderDocsList();
    renderTagsList();
  }

  function clearColor(docId) {
    const doc = state.docs.find(d => d.id === docId);
    if (!doc) return;
    doc.color = null;
    renderDocsList();
    renderTagsList();
  }

  function updateTagsCount() {
    const tagged = state.docs.filter(d => d.tagged);
    $id('tagsCount').textContent = tagged.length;
    $id('totalTagged').textContent = tagged.length;
  }

  function renderTagsList() {
    const list = $id('tagsList');
    const empty = $id('tagsEmpty');
    const tagged = state.docs.filter(d => d.tagged);
    const filtered = state.currentColorFilter === 'all'
      ? tagged
      : tagged.filter(d => d.color === state.currentColorFilter);

    Array.from(list.children).forEach(c => { if (c !== empty) c.remove(); });

    if (filtered.length === 0) {
      empty.style.display = '';
    } else {
      empty.style.display = 'none';
      const colorOrder = [...CONFIG.tagColors, null];
      const sorted = [];
      colorOrder.forEach(c => filtered.forEach(d => { if ((d.color || null) === c) sorted.push(d); }));
      sorted.forEach(doc => list.appendChild(buildTaggedItem(doc)));
    }
    updateTagsCount();
  }

  function buildTaggedItem(doc) {
    const item = document.createElement('div');
    item.className = 'tagged-item' + (doc.color ? ' tag-' + doc.color : '');
    const labelText = doc.color ? CONFIG.tagColorLabels[doc.color] : '';
    item.innerHTML = `
      <div class="tagged-body">
        <div class="tagged-name">${escapeHtml(doc.displayName)}</div>
        ${labelText ? `<span class="tagged-label">${escapeHtml(labelText)}</span>` : ''}
      </div>
      <div class="tagged-actions">
        <button class="doc-mini-btn tagged-remove" title="Remove tag">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `;
    item.onclick = (e) => {
      if (e.target.closest('.tagged-actions')) return;
      scrollToDoc(doc.id);
    };
    item.querySelector('.tagged-remove').onclick = (e) => {
      e.stopPropagation();
      toggleTag(doc.id);
    };
    return item;
  }

  function scrollToDoc(docId) {
    const doc = state.docs.find(d => d.id === docId);
    if (!doc) return;
    if (state.currentCategory !== 'all' && state.currentCategory !== doc.category) {
      selectCategory('all');
    }
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-doc-id="${docId}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.outline = '2px solid var(--signal)';
      setTimeout(() => { el.style.outline = ''; }, 1500);
    });
  }

  // ══════ RENAME ══════
  function startRename(docId, itemEl) {
    const doc = state.docs.find(d => d.id === docId);
    if (!doc) return;
    const nameEl = itemEl.querySelector('[data-doc-name]');
    const input = document.createElement('input');
    input.className = 'doc-name-input';
    input.type = 'text';
    input.value = doc.displayName;
    nameEl.replaceWith(input);
    input.focus(); input.select();
    const finish = (commit) => {
      const v = input.value.trim();
      if (commit && v) { doc.displayName = v; doc.name = v; }
      renderDocsList(); renderTagsList();
    };
    input.onblur = () => finish(true);
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') finish(false);
    };
  }

  // ══════ MULTI-SELECT ══════
  function toggleSelectDoc(docId) {
    if (state.selectedIds.has(docId)) state.selectedIds.delete(docId);
    else state.selectedIds.add(docId);
    updateBulkBar();
    renderDocsList();
  }

  function rangeSelectDoc(docId) {
    const items = Array.from(document.querySelectorAll('.doc-item')).map(i => i.dataset.docId);
    const last = Array.from(state.selectedIds).pop();
    const a = items.indexOf(last);
    const b = items.indexOf(docId);
    if (a < 0 || b < 0) return;
    const [lo, hi] = [Math.min(a,b), Math.max(a,b)];
    for (let i = lo; i <= hi; i++) state.selectedIds.add(items[i]);
    updateBulkBar();
    renderDocsList();
  }

  function clearSelection() {
    state.selectedIds.clear();
    updateBulkBar();
    renderDocsList();
  }

  function updateBulkBar() {
    const bar = $id('bulkBar');
    $id('bulkCount').textContent = state.selectedIds.size;
    bar.classList.toggle('visible', state.selectedIds.size > 0);
  }

  function bulkAction(act) {
    const ids = Array.from(state.selectedIds);
    if (ids.length === 0) return;
    if (act === 'tag') {
      ids.forEach(id => { const d = state.docs.find(x => x.id === id); if (d) d.tagged = true; });
      toast('Tagged', ids.length + ' documents', 'success');
    } else if (act.startsWith('color-')) {
      const color = act.replace('color-', '');
      ids.forEach(id => { const d = state.docs.find(x => x.id === id); if (d) { d.color = color; if (!d.tagged) d.tagged = true; } });
      toast('Colored', ids.length + ' · ' + CONFIG.tagColorLabels[color], 'success');
    } else if (act === 'delete') {
      if (!confirm('Delete ' + ids.length + ' documents?')) return;
      state.docs = state.docs.filter(d => !state.selectedIds.has(d.id));
      toast('Deleted', ids.length + ' documents', 'success');
    } else if (act === 'move') {
      state.pendingUpload = { bulkMoveIds: ids, category: 'all' };
      $id('modalSub').textContent = 'Move ' + ids.length + ' document' + (ids.length > 1 ? 's' : '') + ' to:';
      $id('modalConfirmLabel').textContent = 'Move';
      renderModalCategoryGrid();
      $id('categoryModal').classList.add('visible');
      return;
    }
    clearSelection();
    renderDocsList();
    renderTagsList();
  }

  // ══════ CONTEXT MENU ══════
  function showContextMenu(x, y) {
    const menu = $id('contextMenu');
    menu.classList.add('visible');
    const rect = menu.getBoundingClientRect();
    const w = rect.width || 220;
    const h = rect.height || 380;
    if (x + w > window.innerWidth) x = window.innerWidth - w - 8;
    if (y + h > window.innerHeight) y = window.innerHeight - h - 8;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  }
  function hideContextMenu() {
    $id('contextMenu').classList.remove('visible');
    state.contextDoc = null;
  }
  function contextAction(act) {
    const id = state.contextDoc;
    hideContextMenu();
    if (!id) return;
    if (act === 'preview') openPreview(id);
    else if (act === 'tag') toggleTag(id);
    else if (act === 'rename') {
      const item = document.querySelector(`[data-doc-id="${id}"]`);
      if (item) startRename(id, item);
    }
    else if (act === 'download') {
      openPreview(id);
      setTimeout(() => downloadPreview(), 300);
    }
    else if (act === 'move') {
      const doc = state.docs.find(d => d.id === id);
      if (!doc) return;
      state.pendingUpload = { singleMoveId: id, category: doc.category };
      $id('modalSub').textContent = 'Move "' + doc.displayName + '" to:';
      $id('modalConfirmLabel').textContent = 'Move';
      renderModalCategoryGrid();
      $id('categoryModal').classList.add('visible');
    }
    else if (act === 'delete') {
      const doc = state.docs.find(d => d.id === id);
      if (doc && confirm('Delete "' + doc.displayName + '"?')) {
        state.docs = state.docs.filter(d => d.id !== id);
        renderDocsList(); renderTagsList();
        toast('Deleted', doc.displayName, 'success');
      }
    }
    else if (act.startsWith('color-')) {
      const color = act.replace('color-', '');
      if (color === 'clear') clearColor(id);
      else setColor(id, color);
    }
  }

  // ══════ DOC COLOR MENU (per-item) ══════
  let openColorMenu = null;
  function showDocColorMenu(btn, docId) {
    if (openColorMenu) openColorMenu.remove();
    const menu = document.createElement('div');
    menu.className = 'color-picker-menu visible';
    const grid = document.createElement('div');
    grid.className = 'color-grid';
    CONFIG.tagColors.forEach(c => {
      const b = document.createElement('button');
      b.className = 'color-grid-btn' + (c === 'black' ? ' tag-black' : '');
      b.style.background = `var(--tag-${c})`;
      b.title = CONFIG.tagColorLabels[c];
      b.onclick = (e) => { e.stopPropagation(); setColor(docId, c); menu.remove(); openColorMenu = null; };
      grid.appendChild(b);
    });
    menu.appendChild(grid);
    const clear = document.createElement('button');
    clear.className = 'color-clear-btn';
    clear.textContent = 'Clear';
    clear.onclick = (e) => { e.stopPropagation(); clearColor(docId); menu.remove(); openColorMenu = null; };
    menu.appendChild(clear);
    btn.parentElement.style.position = 'relative';
    btn.parentElement.appendChild(menu);
    openColorMenu = menu;
    setTimeout(() => {
      const outside = (ev) => {
        if (!menu.contains(ev.target)) { menu.remove(); openColorMenu = null; document.removeEventListener('click', outside); }
      };
      document.addEventListener('click', outside);
    }, 10);
  }

  // ══════ PREVIEW MODAL ══════
  function openPreview(docId) {
    const doc = state.docs.find(d => d.id === docId);
    if (!doc) return;
    // Blur whatever has focus (text boxes, sticky notes) so keyboard shortcuts work
    try { document.activeElement?.blur?.(); } catch(e) {}
    state.preview.open = true;
    state.preview.docId = docId;
    state.preview.filteredIds = filterDocs().map(d => d.id);
    state.preview.index = state.preview.filteredIds.indexOf(docId);
    if (state.preview.index < 0) {
      state.preview.filteredIds = state.docs.map(d => d.id);
      state.preview.index = state.preview.filteredIds.indexOf(docId);
    }
    state.preview.zoom = 1;
    state.preview.rotation = 0;
    $id('previewTitle').value = doc.displayName;
    $id('previewTitle').setAttribute('readonly', 'true');
    $id('previewTitle').classList.remove('editable');
    renderPreview();
    $id('previewModal').classList.add('visible');
    document.body.style.overflow = 'hidden';
  }

  function closePreview() {
    state.preview.open = false;
    $id('previewModal').classList.remove('visible');
    document.body.style.overflow = '';
    $id('previewColorMenu').classList.remove('visible');
  }

  function currentPreviewDoc() {
    const id = state.preview.filteredIds[state.preview.index];
    return state.docs.find(d => d.id === id);
  }

  function renderPreview() {
    const doc = currentPreviewDoc();
    if (!doc) return;
    $id('previewTitle').value = doc.displayName;
    $id('previewCounter').textContent = (state.preview.index + 1) + ' / ' + state.preview.filteredIds.length;
    $id('previewPrev').disabled = state.preview.index <= 0;
    $id('previewNext').disabled = state.preview.index >= state.preview.filteredIds.length - 1;
    $id('previewTag').classList.toggle('active', doc.tagged);

    const body = $id('previewBody');
    body.innerHTML = '';

    if (doc.ocrText && (doc.type === 'pdf' || doc.type === 'image')) {
      renderOcrSplit(doc, body);
      return;
    }

    const canvas = document.createElement('div');
    canvas.id = 'previewCanvas';

    if ((doc.type === 'pdf' || doc.type === 'image') && (doc.highResData || doc.thumbnailData)) {
      const img = document.createElement('img');
      img.src = doc.highResData || doc.thumbnailData;
      img.alt = doc.displayName;
      canvas.appendChild(img);
    } else if (doc.type === 'excel') {
      const wrap = document.createElement('div');
      wrap.className = 'preview-excel-wrap';

      // Native file banner — lets the user download/open the original .xlsx
      // which preserves formulas, formatting, charts, etc.
      const banner = document.createElement('div');
      banner.className = 'preview-native-banner';
      const nativeDoc = findNativeWorkbookDoc(doc);
      const hasNative = !!(nativeDoc && nativeDoc.nativeDataUrl);
      banner.innerHTML = `
        <div class="preview-native-info">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <div>
            <div class="preview-native-title">${escapeHtml(doc.workbookFileName || doc.displayName)}</div>
            <div class="preview-native-sub">
              ${doc.sheetName ? 'Sheet: <b>' + escapeHtml(doc.sheetName) + '</b>' : ''}
              ${doc.dimensions ? ' · ' + escapeHtml(doc.dimensions) : ''}
              ${doc.sheetCount > 1 ? ' · ' + doc.sheetCount + ' sheets' : ''}
            </div>
          </div>
        </div>
        <button class="btn btn-primary preview-native-btn" id="openNativeBtn" ${hasNative ? '' : 'disabled'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Open in Excel
        </button>
      `;
      wrap.appendChild(banner);

      const div = document.createElement('div');
      div.className = 'preview-excel';
      div.innerHTML = (state.searchQuery ? highlightHtmlMatches(doc.htmlContent, state.searchQuery) : doc.htmlContent) || '<p>No content</p>';
      wrap.appendChild(div);
      canvas.appendChild(wrap);

      // Wire the open-native button
      setTimeout(() => {
        const btn = $id('openNativeBtn');
        if (btn) btn.onclick = () => openNativeFile(doc);
      }, 10);
    } else if (doc.type === 'word') {
      const div = document.createElement('div');
      div.className = 'preview-word';
      div.innerHTML = doc.htmlContent || '<p>No content</p>';
      canvas.appendChild(div);
    } else {
      canvas.innerHTML = '<div style="color:white; text-align:center;">No preview available</div>';
    }

    body.appendChild(canvas);
    applyPreviewTransform();
  }

  function renderOcrSplit(doc, body) {
    const conf = doc.ocrConfidence || 0;
    let confCls = 'low';
    if (conf >= 80) confCls = 'high';
    else if (conf >= 50) confCls = 'medium';
    body.innerHTML = `
      <div class="ocr-split">
        <div class="ocr-image"><img src="${doc.highResData || doc.thumbnailData}" alt="${escapeHtml(doc.displayName)}"></div>
        <div class="ocr-text">
          <div class="ocr-text-header"><h3>Extracted Text</h3><div class="ocr-confidence ${confCls}">${conf}% confidence</div></div>
          <pre class="ocr-content">${escapeHtml(doc.ocrText || 'No text extracted')}</pre>
        </div>
      </div>
    `;
  }

  function applyPreviewTransform() {
    const canvas = $id('previewCanvas');
    if (!canvas) return;
    canvas.style.transform = `scale(${state.preview.zoom}) rotate(${state.preview.rotation}deg)`;
  }

  function previewPrev() {
    if (state.preview.index > 0) {
      state.preview.index--;
      state.preview.zoom = 1; state.preview.rotation = 0;
      renderPreview();
    }
  }
  function previewNext() {
    if (state.preview.index < state.preview.filteredIds.length - 1) {
      state.preview.index++;
      state.preview.zoom = 1; state.preview.rotation = 0;
      renderPreview();
    }
  }
  function previewZoomIn() {
    state.preview.zoom = Math.min(CONFIG.preview.maxZoom, state.preview.zoom + CONFIG.preview.zoomStep);
    applyPreviewTransform();
  }
  function previewZoomOut() {
    state.preview.zoom = Math.max(CONFIG.preview.minZoom, state.preview.zoom - CONFIG.preview.zoomStep);
    applyPreviewTransform();
  }
  function previewRotate() {
    state.preview.rotation = (state.preview.rotation + 90) % 360;
    applyPreviewTransform();
  }

  // ══════ OCR ══════
  async function runOCR() {
    const doc = currentPreviewDoc();
    if (!doc) return;
    if (doc.type !== 'pdf' && doc.type !== 'image') {
      toast('OCR unavailable', 'OCR works on images and PDFs only', 'warning');
      return;
    }
    $id('previewOCR').classList.add('active');
    $id('ocrLabel').textContent = '…';
    try {
      if (doc.type === 'pdf' && doc.pdfData && doc.textContent && doc.textContent.trim().length > 30) {
        doc.ocrText = doc.textContent;
        doc.ocrConfidence = 99;
        renderPreview();
        toast('Text extracted', '99% confidence (embedded text layer)', 'success');
        return;
      }
      if (!state.ocrLoaded) await loadTesseract();
      if (typeof Tesseract === 'undefined') { toast('OCR failed', 'Could not load OCR engine', 'error'); return; }
      let imgSrc = doc.highResData || doc.thumbnailData;
      if (doc.type === 'pdf' && doc.pdfData) {
        const pdf = await pdfjsLib.getDocument({ data: doc.pdfData }).promise;
        const page = await pdf.getPage(doc.pageNumber);
        imgSrc = await renderPdfPage(page, CONFIG.pdf.ocrScale);
      }
      imgSrc = await preprocessForOCR(imgSrc);
      const result = await Tesseract.recognize(imgSrc, 'eng', {
        logger: (info) => {
          if (info.status === 'recognizing text') {
            $id('ocrLabel').textContent = Math.round(info.progress * 100) + '%';
          }
        },
      });
      doc.ocrText = result.data.text;
      doc.ocrConfidence = Math.round(result.data.confidence);
      renderPreview();
      toast('OCR complete', doc.ocrConfidence + '% confidence', 'success');
    } catch (err) {
      console.error('OCR error:', err);
      toast('OCR failed', err.message || 'Unknown error', 'error');
    } finally {
      $id('previewOCR').classList.remove('active');
      $id('ocrLabel').textContent = 'OCR';
    }
  }

  async function loadTesseract() {
    return new Promise((resolve, reject) => {
      if (typeof Tesseract !== 'undefined') { state.ocrLoaded = true; resolve(); return; }
      toast('Loading OCR', 'Downloading OCR engine…', 'info');
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = () => { state.ocrLoaded = true; resolve(); };
      s.onerror = () => reject(new Error('Failed to load OCR engine'));
      document.head.appendChild(s);
    });
  }

  function preprocessForOCR(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const up = (img.width < 1000 || img.height < 1000) ? 2 : 1;
        canvas.width = img.width * up;
        canvas.height = img.height * up;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;
        let sum = 0, count = 0;
        for (let i = 0; i < d.length; i += 4) {
          const g = Math.round(0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]);
          d[i] = d[i+1] = d[i+2] = g; sum += g; count++;
        }
        const mean = sum / count;
        for (let i = 0; i < d.length; i += 4) {
          let v = d[i];
          v = ((v - mean) * 1.5) + mean;
          v = Math.max(0, Math.min(255, Math.round(v)));
          d[i] = d[i+1] = d[i+2] = v;
        }
        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(src);
      img.src = src;
    });
  }

  async function copyPreviewText() {
    const doc = currentPreviewDoc();
    if (!doc) return;
    const sel = window.getSelection();
    let text = sel && sel.toString().trim();
    if (!text) text = doc.ocrText || doc.textContent || '';
    if (!text) { toast('No text', 'No text available', 'warning'); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied', text.length + ' characters', 'success');
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Copied', text.length + ' characters', 'success'); }
      catch(e) { toast('Copy failed', 'Please copy manually', 'error'); }
      document.body.removeChild(ta);
    }
  }

  function downloadPreview() {
    const doc = currentPreviewDoc();
    if (!doc) return;
    // Excel: hand user the original .xlsx so formulas/formatting stay intact
    if (doc.type === 'excel') {
      openNativeFile(doc);
      return;
    }
    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const m = 10;
      if ((doc.type === 'pdf' || doc.type === 'image') && (doc.highResData || doc.thumbnailData)) {
        pdf.addImage(doc.highResData || doc.thumbnailData, 'PNG', m, m, pw - 2*m, ph - 2*m);
      } else if (doc.textContent) {
        pdf.setFontSize(11);
        const lines = pdf.splitTextToSize(doc.textContent, pw - 2*m);
        let y = m + 5;
        for (const line of lines) {
          if (y > ph - m) { pdf.addPage(); y = m + 5; }
          pdf.text(line, m, y); y += 5;
        }
      }
      pdf.save((doc.displayName || 'document') + '.pdf');
      toast('Downloaded', doc.displayName + '.pdf', 'success');
    } catch(err) {
      console.error(err); toast('Download failed', err.message, 'error');
    }
  }

  function exportTagged() {
    const tagged = state.docs.filter(d => d.tagged);
    if (tagged.length === 0) { toast('No tagged pages', 'Tag pages before exporting', 'warning'); return; }
    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const m = 10;
      let first = true;
      tagged.forEach(doc => {
        if (!first) pdf.addPage(); first = false;
        if ((doc.type === 'pdf' || doc.type === 'image') && (doc.highResData || doc.thumbnailData)) {
          pdf.addImage(doc.highResData || doc.thumbnailData, 'PNG', m, m, pw - 2*m, ph - 2*m);
        } else if (doc.textContent) {
          pdf.setFontSize(13); pdf.setFont(undefined, 'bold');
          pdf.text(doc.displayName, m, m + 5);
          pdf.setFontSize(10); pdf.setFont(undefined, 'normal');
          const lines = pdf.splitTextToSize(doc.textContent, pw - 2*m);
          let y = m + 15;
          for (const line of lines) {
            if (y > ph - m) { pdf.addPage(); y = m; }
            pdf.text(line, m, y); y += 4.5;
          }
        }
      });
      const ts = new Date().toISOString().slice(0,10);
      pdf.save('Tagged-Export-' + ts + '.pdf');
      toast('Exported', tagged.length + ' pages', 'success');
    } catch(err) {
      console.error(err); toast('Export failed', err.message, 'error');
    }
  }

  function clearAllDocs() {
    if (state.docs.length === 0) { toast('Nothing to clear', '', 'info'); return; }
    if (!confirm('Delete ALL ' + state.docs.length + ' documents?')) return;
    state.docs = [];
    state.selectedIds.clear();
    state.annotations.store = {};
    renderDocsList(); renderTagsList(); updateBulkBar();
    toast('Cleared', 'All documents removed', 'success');
  }

  function clearTagged() {
    const tagged = state.docs.filter(d => d.tagged);
    if (tagged.length === 0) { toast('No tags', '', 'info'); return; }
    if (!confirm('Remove tags from ' + tagged.length + ' documents?')) return;
    tagged.forEach(d => { d.tagged = false; d.color = null; });
    renderDocsList(); renderTagsList();
    toast('Tags cleared', tagged.length + ' documents', 'success');
  }

  // ══════ COLOR FILTER (tags sidebar) ══════
  function selectColorFilter(filter) {
    state.currentColorFilter = filter;
    const label = filter === 'all' ? 'All Colors' : CONFIG.tagColorLabels[filter];
    $id('colorFilterLabel').textContent = label;
    const dot = document.querySelector('.color-filter-display .color-dot');
    dot.className = 'color-dot ' + filter;
    $$('#colorFilterMenu .color-option').forEach(o => o.classList.toggle('active', o.dataset.filter === filter));
    $id('colorFilterMenu').classList.remove('visible');
    renderTagsList();
  }

  // ══════ DRAG & DROP ══════
  let dragCounter = 0;
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    $id('dropOverlay').classList.add('visible');
  });
  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      $id('dropOverlay').classList.remove('visible');
    }
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    $id('dropOverlay').classList.remove('visible');
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) promptCategoryAssign(files);
  });

  // ══════ RESIZERS ══════
  function attachResizer(elId, sideCol, isLeft) {
    const el = $id(elId);
    if (!el) return;
    let startX, startW;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      el.classList.add('active');
      startX = e.clientX;
      const wsEl = document.querySelector('.workspace');
      const cs = getComputedStyle(wsEl);
      const cols = cs.gridTemplateColumns.split(' ');
      startW = parseFloat(cols[sideCol]);

      const onMove = (ev) => {
        const delta = ev.clientX - startX;
        const newW = isLeft ? (startW + delta) : (startW - delta);
        // Allow the panel to drag as far as viewport allows.
        // Minimum 220px on each panel; center (categories) keeps at least 200px.
        const vw = window.innerWidth;
        const otherPanelW = isLeft
          ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tags-panel-w')) || 280
          : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--docs-panel-w')) || 300;
        // 8px = resizer gutters (2 × 4px)
        const maxW = vw - otherPanelW - 200 - 8;
        const clamped = Math.max(220, Math.min(maxW, newW));
        document.documentElement.style.setProperty(
          isLeft ? '--docs-panel-w' : '--tags-panel-w',
          clamped + 'px'
        );
        // Signal to the thumbnail system to re-render at new resolution
        state._panelResized = true;
      };
      const onUp = () => {
        el.classList.remove('active');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
  attachResizer('resizer1', 0, true);
  attachResizer('resizer2', 4, false);

  // ══════ VIEW MODE ══════
  function setViewMode(mode) {
    state.currentView = mode;
    $id('docsList').dataset.view = mode;
    $$('.view-toggle button').forEach(b => b.classList.toggle('active', b.dataset.view === mode));
    try { localStorage.setItem(CONFIG.storageKeys.view, mode); } catch(e) {}
  }
  try {
    const v = localStorage.getItem(CONFIG.storageKeys.view);
    if (v === 'list' || v === 'thumbnail') state.currentView = v;
  } catch(e) {}

  // ══════ EVENT WIRING ══════
  function initEvents() {
    $id('uploadBtn').onclick = () => $id('fileInput').click();
    $id('fileInput').addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      promptCategoryAssign(files);
      try { e.target.value = ''; } catch(err){}
    });

    $id('themeToggle').onclick = toggleTheme;
    $id('clearAllBtn').onclick = clearAllDocs;
    $id('clearTaggedBtn').onclick = clearTagged;
    $id('exportTaggedBtn').onclick = exportTagged;

    // View toggle
    $$('.view-toggle button').forEach(b => {
      b.onclick = () => setViewMode(b.dataset.view);
    });
    setViewMode(state.currentView);

    // Search — debounced content search with highlight tracking
    let searchTimer;
    $id('searchInput').addEventListener('input', (e) => {
      const val = e.target.value;
      state.searchQuery = val;
      $id('searchClear').classList.toggle('visible', !!val);
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        runSearch();
      }, 120);
    });
    $id('searchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (state.searchResults.length === 0) return;
        if (e.shiftKey) searchPrev();
        else searchNext();
      } else if (e.key === 'Escape') {
        clearSearch();
      }
    });
    $id('searchClear').onclick = () => { clearSearch(); };

    // Prev / Next buttons
    $id('searchPrev').onclick = searchPrev;
    $id('searchNext').onclick = searchNext;

    // Global Ctrl/Cmd+F → focus the search
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        // Only intercept if search input exists and no modal is open
        if (document.getElementById('previewModal')?.classList.contains('visible')) return;
        const si = $id('searchInput');
        if (si) {
          e.preventDefault();
          si.focus();
          si.select();
        }
      }
    });

    // Sort menu
    $id('sortBtn').onclick = (e) => { e.stopPropagation(); $id('sortMenu').classList.toggle('visible'); };
    $$('.sort-option').forEach(o => {
      o.onclick = () => {
        state.sortOrder = o.dataset.sort;
        $$('.sort-option').forEach(x => x.classList.toggle('active', x.dataset.sort === o.dataset.sort));
        $id('sortMenu').classList.remove('visible');
        renderDocsList();
      };
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.sort-wrap')) $id('sortMenu').classList.remove('visible');
      if (!e.target.closest('.color-filter')) $id('colorFilterMenu').classList.remove('visible');
      if (!e.target.closest('.context-menu, .doc-item')) hideContextMenu();
      if (!e.target.closest('.preview-color-wrap')) $id('previewColorMenu').classList.remove('visible');
      // Deselect text boxes
      if (!e.target.closest('.anno-text-input')) {
        $$('.anno-text-input.selected').forEach(el => el.classList.remove('selected'));
      }
    });

    // Color filter
    $id('colorFilterBtn').onclick = (e) => {
      e.stopPropagation();
      $id('colorFilterMenu').classList.toggle('visible');
    };
    $$('.color-filter-menu .color-option').forEach(o => {
      o.onclick = () => selectColorFilter(o.dataset.filter);
    });

    // Bulk bar
    $$('.bulk-btn[data-bulk]').forEach(b => {
      b.onclick = () => bulkAction(b.dataset.bulk);
    });
    $id('bulkClose').onclick = clearSelection;

    // Context menu
    $$('.ctx-item').forEach(c => {
      c.onclick = () => contextAction(c.dataset.act);
    });

    // Modal
    $id('modalCancel').onclick = closeCategoryModal;
    $id('modalConfirm').onclick = confirmUpload;

    // Preview modal
    $id('previewClose').onclick = closePreview;
    $id('previewPrev').onclick = previewPrev;
    $id('previewNext').onclick = previewNext;
    $id('previewZoomIn').onclick = previewZoomIn;
    $id('previewZoomOut').onclick = previewZoomOut;
    $id('previewRotate').onclick = previewRotate;
    $id('previewOCR').onclick = runOCR;
    $id('previewCopy').onclick = copyPreviewText;
    $id('previewDownload').onclick = downloadPreview;
    $id('previewTag').onclick = () => {
      const doc = currentPreviewDoc();
      if (doc) toggleTag(doc.id);
      setTimeout(renderPreview, 10);
    };
    $id('previewTitleEdit').onclick = () => {
      const input = $id('previewTitle');
      const isEdit = input.classList.toggle('editable');
      if (isEdit) {
        input.removeAttribute('readonly');
        input.focus(); input.select();
      } else {
        const v = input.value.trim();
        const doc = currentPreviewDoc();
        if (doc && v) { doc.displayName = v; doc.name = v; renderDocsList(); renderTagsList(); }
        input.setAttribute('readonly', 'true');
      }
    };

    // Preview color picker
    $id('previewColorBtn').onclick = (e) => {
      e.stopPropagation();
      $id('previewColorMenu').classList.toggle('visible');
    };
    const pGrid = $id('previewColorGrid');
    pGrid.innerHTML = '';
    CONFIG.tagColors.forEach(c => {
      const b = document.createElement('button');
      b.className = 'color-grid-btn' + (c === 'black' ? ' tag-black' : '');
      b.style.background = `var(--tag-${c})`;
      b.title = CONFIG.tagColorLabels[c];
      b.onclick = (e) => {
        e.stopPropagation();
        const doc = currentPreviewDoc();
        if (doc) { setColor(doc.id, c); renderPreview(); }
        $id('previewColorMenu').classList.remove('visible');
      };
      pGrid.appendChild(b);
    });
    $id('previewColorClear').onclick = (e) => {
      e.stopPropagation();
      const doc = currentPreviewDoc();
      if (doc) { clearColor(doc.id); renderPreview(); }
      $id('previewColorMenu').classList.remove('visible');
    };

    // Keyboard
    document.addEventListener('keydown', (e) => {
      const isInput = ['INPUT','TEXTAREA'].includes(document.activeElement.tagName) ||
                      document.activeElement.contentEditable === 'true';

      // Preview-open shortcuts
      if (state.preview.open) {
        if (e.key === 'Escape') { closePreview(); return; }
        if (isInput) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); previewPrev(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); previewNext(); }
        else if (e.key === '+' || e.key === '=') { e.preventDefault(); previewZoomIn(); }
        else if (e.key === '-') { e.preventDefault(); previewZoomOut(); }
        else if (e.key === 'r' || e.key === 'R') { if (!e.ctrlKey) { e.preventDefault(); previewRotate(); } }
        return;
      }

      // Category modal escape
      if ($id('categoryModal').classList.contains('visible') && e.key === 'Escape') {
        closeCategoryModal();
      }
    });
  }



  // ══════ PARENT APP BRIDGE (Altitude / Speed to Market split app) ══════
  // Keeps the workspace visually 1:1 while letting the parent underwriting app
  // hydrate already-uploaded files and receive new uploads for the pipeline.
  function parentPost(type, payload) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(Object.assign({ type }, payload || {}), '*');
      }
    } catch (e) { /* no-op when standalone */ }
  }

  function inferParentCategory(f) {
    const key = String(f.routedTo || f.classification || f.primary_type || '').toLowerCase();
    if (key.includes('email')) return 'correspondence';
    if (key.includes('loss')) return 'loss-history';
    if (key.includes('quote') || key.includes('excess') || key.includes('policy') || key.includes('gl_') || key.includes('al_')) return 'quotes';
    if (key.includes('supplemental') || key.includes('acord')) return 'applications';
    if (key.includes('subcontract') || key.includes('vendor')) return 'subjectivities';
    return 'all';
  }

  function inferParentColor(f) {
    const key = String(f.routedTo || f.classification || f.primary_type || '').toLowerCase();
    if (key.includes('loss')) return 'red';
    if (key.includes('quote') || key.includes('excess') || key.includes('policy') || key.includes('gl_') || key.includes('al_')) return 'yellow';
    if (key.includes('supplemental') || key.includes('acord')) return 'green';
    if (key.includes('email')) return 'pink';
    if (key.includes('subcontract') || key.includes('vendor')) return 'orange';
    return null;
  }

  function parentFileType(f) {
    const n = String(f.name || '').toLowerCase();
    if (/\.pdf$/.test(n)) return 'pdf';
    if (/\.(docx?|rtf)$/.test(n)) return 'word';
    if (/\.(xlsx?|xlsm|xlsb|csv|tsv)$/.test(n)) return 'text';
    if (/\.(eml|msg|oft)$/.test(n)) return 'email';
    if (/\.(pptx?|ppsx|potx|pptm|potm)$/.test(n)) return 'powerpoint';
    if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/.test(n)) return 'image';
    return 'text';
  }

  function htmlForParentFile(f) {
    const title = escapeHtml(f.name || 'Document');
    const stateLabel = escapeHtml(f.state || 'uploaded');
    const cls = escapeHtml(f.classification || f.routedTo || 'unclassified');
    const text = escapeHtml(f.text || f.warning || f.error || 'No extracted text is available for this file yet.');
    return '<div class="parent-file-page">' +
      '<h1>' + title + '</h1>' +
      '<div style="font-family:var(--font-mono);font-size:11px;color:#5A6478;margin-bottom:18px;text-transform:uppercase;letter-spacing:.08em;">' + stateLabel + ' · ' + cls + '</div>' +
      '<pre style="white-space:pre-wrap;font-family:var(--font-mono);font-size:12px;line-height:1.55;">' + text + '</pre>' +
      '</div>';
  }

  function hasDocForParentFile(f) {
    const name = String(f.name || '').trim();
    const base = stripExt(name);
    const externalId = 'parent:' + (f.id || name);
    return state.docs.some(d => d.externalId === externalId ||
      d.nativeFileName === name || d.workbookFileName === name ||
      d.name === name || d.displayName === name ||
      (base && String(d.name || '').startsWith(base + ' —')));
  }

  function importParentFiles(files) {
    if (!Array.isArray(files)) return;
    let added = 0;
    for (const f of files) {
      if (!f || !f.name || hasDocForParentFile(f)) continue;
      const doc = addDoc({
        name: f.name,
        type: parentFileType(f),
        category: inferParentCategory(f),
        htmlContent: htmlForParentFile(f),
        textContent: f.text || f.warning || f.error || '',
        fileSize: f.size || null,
        nativeFileName: f.name,
        nativeMimeType: f.type || '',
        totalPages: 1,
        pageNumber: 1,
      });
      doc.externalId = 'parent:' + (f.id || f.name);
      doc.parentState = f.state || null;
      const color = inferParentColor(f);
      if (color) { doc.color = color; doc.tagged = true; }
      added++;
    }
    if (added) {
      renderDocsList();
      renderTagsList();
      renderCategoryGrid();
      updateTagsCount();
      toast('Synced from submission', added + ' document' + (added === 1 ? '' : 's') + ' added', 'success');
    }
    parentPost('stm-docs-synced', { count: state.docs.length });
  }

  // ══════ EXPOSE API for part 2 ══════
  window.STM_DOC_API = {
    state, CONFIG,
    renderDocsList, renderTagsList, renderCategoryGrid,
    toast, filterDocs, toggleTag, setColor, clearColor,
    openPreview, closePreview, currentPreviewDoc,
    addDoc, processFile, clearAllDocs, importParentFiles,
  };

  // ══════ INIT ══════
  function init() {
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    renderCategoryGrid();
    renderDocsList();
    renderTagsList();
    initEvents();
    initToolsDropdown();
    console.log('%c✓ Speed to Market · Document Workspace ready',
      'color: #C6F432; font-weight: bold; font-size: 12px;');
  }

  // ══════ TOOLS DROPDOWN (topbar button → annotation panel) ══════
  function initToolsDropdown() {
    const btn = $id('toolsBtn');
    const toolbox = $id('annoToolbox');
    if (!btn || !toolbox) return;

    // Toggle open/close on TOOLS button click
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = toolbox.classList.toggle('open');
      btn.classList.toggle('open', isOpen);
    });

    // Close when clicking outside the toolbox or button
    document.addEventListener('click', (e) => {
      if (!toolbox.classList.contains('open')) return;
      if (toolbox.contains(e.target)) return;
      if (btn.contains(e.target)) return;
      toolbox.classList.remove('open');
      btn.classList.remove('open');
    });

    // Close on ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && toolbox.classList.contains('open')) {
        // Don't steal ESC from preview modal if open
        if (document.getElementById('previewModal')?.classList.contains('visible')) return;
        toolbox.classList.remove('open');
        btn.classList.remove('open');
      }
    });

    // Auto-close when a TOOL button is clicked (pen, rect, arrow, etc.)
    // Leave open when picking a color, stroke width, or option so user can adjust.
    toolbox.addEventListener('click', (e) => {
      if (e.target.closest('.anno-btn')) {
        // Small delay so the tool switch registers before closing
        setTimeout(() => {
          toolbox.classList.remove('open');
          btn.classList.remove('open');
        }, 120);
      }
    });

    // Keep the TOOLS button's "active indicator" dot in sync with current tool
    refreshToolsBtnIndicator();
    // Poll state changes (lightweight; called from anno tool switches too)
    window.STM_REFRESH_TOOLS_BTN = refreshToolsBtnIndicator;
  }

  function refreshToolsBtnIndicator() {
    const btn = $id('toolsBtn');
    const dot = $id('toolsBtnActive');
    if (!btn || !dot) return;
    const tool = state.annotations?.tool;
    const color = state.annotations?.color || '#C6F432';
    if (tool && tool !== 'pointer') {
      btn.classList.add('tool-active');
      dot.style.color = color;
      btn.title = 'Tools (active: ' + tool + ')';
    } else {
      btn.classList.remove('tool-active');
      btn.title = 'Open annotation tools';
    }
  }

  function wireParentBridge() {
    const brand = document.querySelector('.brand');
    if (brand) {
      brand.title = 'Back to submission workbench';
      brand.addEventListener('click', (e) => {
        e.preventDefault();
        parentPost('stm-docs-close');
      });
    }
    window.addEventListener('message', (event) => {
      const msg = event.data || {};
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'stm-docs-hydrate') {
        if (msg.theme) applyTheme(msg.theme === 'light' ? 'light' : 'dark');
        importParentFiles(msg.files || []);
      }
    });
    parentPost('stm-docs-ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); wireParentBridge(); });
  } else {
    init();
    wireParentBridge();
  }

})();

/* ══════════════════════════════════════════════════════════════════════════════
   SPEED TO MARKET AI · DOCUMENT WORKSPACE — ANNOTATION ENGINE (Part 2)
   Must be loaded AFTER app.js. Attaches to window.STM_ANNO.
   ══════════════════════════════════════════════════════════════════════════════ */

(function(){
  'use strict';

  // Wait for part 1 to have registered globals
  function boot() {
    if (!window.STM_DOC_STATE || !window.STM_DOC_API) {
      return setTimeout(boot, 30);
    }

    const state = window.STM_DOC_STATE;
    const API = window.STM_DOC_API;
    const { $, $$, $id } = window.STM_DOC_HELPERS;
    const toast = window.STM_toast;

    // ══════ STORE ══════
    function getStore(docId) {
      if (!state.annotations.store[docId]) {
        state.annotations.store[docId] = { layers: [], undone: [] };
      }
      return state.annotations.store[docId];
    }

    function saveLayer(docId, layer) {
      const store = getStore(docId);
      store.layers.push(layer);
      store.undone = [];
      updateAnnoIndicator(docId);
    }

    function updateAnnoIndicator(docId) {
      const item = document.querySelector(`[data-doc-id="${docId}"]`);
      if (!item) return;
      const thumb = item.querySelector('.doc-thumb');
      if (!thumb) return;
      let ind = thumb.querySelector('.anno-indicator');
      const store = getStore(docId);
      if (store.layers.length > 0) {
        if (!ind) {
          ind = document.createElement('div');
          ind.className = 'anno-indicator';
          ind.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 19l7-7 3 3-7 7-3-3z"/></svg>';
          thumb.appendChild(ind);
        }
      } else if (ind) {
        ind.remove();
      }
    }

    // ══════ TOOL SELECTION ══════
    function setTool(tool) {
      state.annotations.tool = tool;
      state.annotations.previewBlocked = (tool !== 'pointer');

      $$('.anno-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
      $id('opacityGroup').classList.toggle('visible', tool === 'highlighter');
      $id('fontSizeGroup').classList.toggle('visible', tool === 'text' || tool === 'sticky');
      $id('fillGroup').classList.toggle('visible', tool === 'rectangle' || tool === 'ellipse');

      $$('.anno-canvas-wrap').forEach(wrap => {
        if (tool === 'pointer') {
          wrap.classList.remove('drawing');
          wrap.removeAttribute('data-tool');
        } else {
          wrap.classList.add('drawing');
          wrap.setAttribute('data-tool', tool);
        }
      });

      // Update the TOOLS button indicator in the topbar
      if (typeof window.STM_REFRESH_TOOLS_BTN === 'function') {
        window.STM_REFRESH_TOOLS_BTN();
      }
    }

    // ══════ CANVAS MANAGEMENT ══════
    function ensureCanvas(thumbEl, docId) {
      if (!thumbEl) return;
      let wrap = thumbEl.querySelector('.anno-canvas-wrap');
      if (wrap) {
        const canvas = wrap.querySelector('.anno-canvas');
        if (canvas && thumbEl.offsetWidth > 0) {
          resizeCanvas(canvas, thumbEl);
          redrawLayers(docId, canvas);
        }
        return wrap;
      }

      wrap = document.createElement('div');
      wrap.className = 'anno-canvas-wrap';
      if (state.annotations.tool !== 'pointer') {
        wrap.classList.add('drawing');
        wrap.setAttribute('data-tool', state.annotations.tool);
      }
      wrap.dataset.docId = docId;

      const canvas = document.createElement('canvas');
      canvas.className = 'anno-canvas';
      wrap.appendChild(canvas);
      thumbEl.appendChild(wrap);

      // If dimensions not ready yet, retry on next frame
      if (thumbEl.offsetWidth > 0) {
        resizeCanvas(canvas, thumbEl);
        redrawLayers(docId, canvas);
      } else {
        requestAnimationFrame(() => {
          if (thumbEl.offsetWidth > 0) {
            resizeCanvas(canvas, thumbEl);
            redrawLayers(docId, canvas);
          }
        });
      }
      attachEvents(wrap, canvas, docId);
      restoreTextAndStickyLayers(wrap, docId);
      return wrap;
    }

    function resizeCanvas(canvas, container) {
      const rect = container.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }

    // ══════ EVENTS ══════
    function attachEvents(wrap, canvas, docId) {
      const getPos = (e) => {
        const r = canvas.getBoundingClientRect();
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        const cy = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: cx - r.left, y: cy - r.top };
      };

      const onStart = (e) => {
        if (state.annotations.tool === 'pointer') return;
        // Don't start drawing if clicking on an existing text/sticky
        if (e.target.closest('.anno-text-input, .anno-sticky')) return;
        e.preventDefault(); e.stopPropagation();
        const pos = getPos(e);
        const a = state.annotations;
        a.isDrawing = true;
        a.startX = pos.x; a.startY = pos.y;
        a.currentCanvas = canvas;
        a.currentCtx = canvas.getContext('2d');
        a.currentDocId = docId;
        a.currentPath = [pos];

        if (a.tool === 'sticky') {
          a.isDrawing = false;
          createSticky(wrap, pos.x, pos.y, docId);
          // Delay setTool so the click event that follows mouseup won't
          // bubble to thumb.onclick with previewBlocked=false and open preview
          setTimeout(() => setTool('pointer'), 100);
          return;
        }
        if (a.tool === 'text') {
          // Handled at onEnd
          return;
        }
        if (a.tool === 'pen' || a.tool === 'highlighter' || a.tool === 'eraser') {
          beginFreehand(pos);
        }
      };

      const onMove = (e) => {
        const a = state.annotations;
        if (!a.isDrawing || a.currentCanvas !== canvas) return;
        e.preventDefault(); e.stopPropagation();
        const pos = getPos(e);
        a.currentPath.push(pos);
        if (a.tool === 'pen' || a.tool === 'highlighter') drawFreehandSegment(pos);
        else if (a.tool === 'eraser') eraseAt(pos);
        else if (['rectangle','ellipse','arrow','line','text'].includes(a.tool)) drawShapePreview(pos);
      };

      const onEnd = (e) => {
        const a = state.annotations;
        if (!a.isDrawing || a.currentCanvas !== canvas) return;
        if (e) e.preventDefault();
        a.isDrawing = false;

        if (a.tool === 'pen' || a.tool === 'highlighter') finishFreehand(docId);
        else if (a.tool === 'eraser') finishErase(docId);
        else if (['rectangle','ellipse','arrow','line'].includes(a.tool)) {
          const pos = a.currentPath[a.currentPath.length - 1] || { x: a.startX, y: a.startY };
          finishShape(pos, docId);
        } else if (a.tool === 'text') {
          const pos = a.currentPath[a.currentPath.length - 1] || { x: a.startX + 180, y: a.startY + 40 };
          const sx = a.startX, sy = a.startY;
          const bx = Math.min(sx, pos.x);
          const by = Math.min(sy, pos.y);
          const bw = Math.abs(pos.x - sx) > 15 ? Math.abs(pos.x - sx) : 180;
          const bh = Math.abs(pos.y - sy) > 15 ? Math.abs(pos.y - sy) : 50;
          redrawLayers(docId, canvas);
          createTextInput(wrap, bx, by, bw, bh, docId);
          // Delay setTool so the click event doesn't bubble and open preview
          setTimeout(() => setTool('pointer'), 100);
        }
        a.currentPath = [];
      };

      wrap.addEventListener('mousedown', onStart);
      document.addEventListener('mousemove', (e) => {
        if (state.annotations.currentCanvas === canvas) onMove(e);
      });
      document.addEventListener('mouseup', (e) => {
        if (state.annotations.currentCanvas === canvas) onEnd(e);
      });
      wrap.addEventListener('touchstart', onStart, { passive: false });
      wrap.addEventListener('touchmove', onMove, { passive: false });
      wrap.addEventListener('touchend', onEnd);
    }

    // ══════ FREEHAND (pen + highlighter) ══════
    function beginFreehand(pos) {
      const a = state.annotations;
      const ctx = a.currentCtx;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.tool === 'highlighter' ? a.strokeWidth * 4 : a.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 1;
      if (a.tool !== 'highlighter') {
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
      }
    }

    function drawFreehandSegment(pos) {
      const a = state.annotations;
      const ctx = a.currentCtx;
      if (a.tool === 'highlighter') {
        // Redraw all layers + current path (prevents alpha compounding)
        redrawLayers(a.currentDocId, a.currentCanvas);
        ctx.save();
        ctx.strokeStyle = a.color;
        ctx.lineWidth = a.strokeWidth * 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = a.opacity;
        ctx.beginPath();
        const p = a.currentPath;
        if (p.length > 0) {
          ctx.moveTo(p[0].x, p[0].y);
          for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
        }
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      }
    }

    function finishFreehand(docId) {
      const a = state.annotations;
      saveLayer(docId, {
        type: a.tool,
        path: [...a.currentPath],
        color: a.color,
        width: a.tool === 'highlighter' ? a.strokeWidth * 4 : a.strokeWidth,
        opacity: a.tool === 'highlighter' ? a.opacity : 1,
      });
      a.currentCtx.globalAlpha = 1;
      a.currentCtx.globalCompositeOperation = 'source-over';
      redrawLayers(docId, a.currentCanvas);
    }

    // ══════ ERASER ══════
    function eraseAt(pos) {
      const a = state.annotations;
      const ctx = a.currentCtx;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, a.strokeWidth * 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function finishErase(docId) {
      const a = state.annotations;
      saveLayer(docId, {
        type: 'eraser',
        path: [...a.currentPath],
        radius: a.strokeWidth * 2.5,
      });
      a.currentCtx.globalCompositeOperation = 'source-over';
    }

    // ══════ SHAPES (rect/ellipse/arrow/line) ══════
    function drawShapePreview(pos) {
      const a = state.annotations;
      const ctx = a.currentCtx;
      const canvas = a.currentCanvas;
      redrawLayers(a.currentDocId, canvas);
      ctx.save();
      ctx.strokeStyle = a.color;
      ctx.fillStyle = a.color;
      ctx.lineWidth = a.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 1;

      if (a.tool === 'rectangle') {
        const x = Math.min(a.startX, pos.x);
        const y = Math.min(a.startY, pos.y);
        const w = Math.abs(pos.x - a.startX);
        const h = Math.abs(pos.y - a.startY);
        if (a.fill) {
          ctx.globalAlpha = 0.25;
          ctx.fillRect(x, y, w, h);
          ctx.globalAlpha = 1;
        }
        ctx.strokeRect(x, y, w, h);
      } else if (a.tool === 'ellipse') {
        const cx = (a.startX + pos.x) / 2;
        const cy = (a.startY + pos.y) / 2;
        const rx = Math.abs(pos.x - a.startX) / 2;
        const ry = Math.abs(pos.y - a.startY) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        if (a.fill) {
          ctx.globalAlpha = 0.25;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.stroke();
      } else if (a.tool === 'arrow') {
        drawArrow(ctx, a.startX, a.startY, pos.x, pos.y, a.strokeWidth);
      } else if (a.tool === 'line') {
        ctx.beginPath();
        ctx.moveTo(a.startX, a.startY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      } else if (a.tool === 'text') {
        // Preview the text box frame while dragging
        const x = Math.min(a.startX, pos.x);
        const y = Math.min(a.startY, pos.y);
        const w = Math.abs(pos.x - a.startX);
        const h = Math.abs(pos.y - a.startY);
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    function drawArrow(ctx, x1, y1, x2, y2, lw) {
      const headLen = Math.max(10, lw * 3);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }

    function finishShape(pos, docId) {
      const a = state.annotations;
      saveLayer(docId, {
        type: a.tool,
        x1: a.startX, y1: a.startY, x2: pos.x, y2: pos.y,
        color: a.color, width: a.strokeWidth, fill: a.fill,
      });
      redrawLayers(docId, a.currentCanvas);
    }

    // ══════ TEXT BOX ══════
    function createTextInput(wrap, x, y, w, h, docId, existing) {
      const a = state.annotations;
      const container = document.createElement('div');
      container.className = 'anno-text-input';
      container.style.left = x + 'px';
      container.style.top = y + 'px';
      container.style.width = w + 'px';
      container.style.minHeight = h + 'px';
      const color = existing?.color || a.color;
      container.style.color = color;

      const dragbar = document.createElement('div');
      dragbar.className = 'anno-text-dragbar';
      container.appendChild(dragbar);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'anno-text-close';
      closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      dragbar.appendChild(closeBtn);

      const edit = document.createElement('div');
      edit.className = 'anno-text-editable';
      edit.contentEditable = 'true';
      edit.style.fontSize = (existing?.fontSize || a.fontSize) + 'px';
      edit.style.color = color;
      edit.textContent = existing?.text || '';
      container.appendChild(edit);

      wrap.appendChild(container);

      // Layer object
      const layer = existing || {
        type: 'text',
        x, y, width: w, height: h,
        text: '',
        color,
        fontSize: a.fontSize,
        el: container,
      };
      layer.el = container;

      if (!existing) {
        // New layer — add to store
        saveLayer(docId, layer);
        edit.focus();
      } else {
        container.classList.add('committed');
      }

      // Commit on blur
      edit.addEventListener('blur', () => {
        layer.text = edit.textContent;
        if (!layer.text.trim()) {
          // Remove empty text boxes
          removeLayer(docId, layer);
          container.remove();
        } else {
          container.classList.add('committed');
        }
        updateAnnoIndicator(docId);
      });

      // Enter commits
      edit.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          edit.blur();
        } else if (e.key === 'Escape') {
          edit.blur();
        }
      });

      // Click to select (while in pointer mode)
      container.addEventListener('click', (e) => {
        if (state.annotations.tool !== 'pointer') return;
        e.stopPropagation();
        $$('.anno-text-input.selected').forEach(el => { if (el !== container) el.classList.remove('selected'); });
        if (container.classList.contains('committed')) {
          container.classList.toggle('selected');
        }
      });

      // Double-click to re-edit
      container.addEventListener('dblclick', (e) => {
        if (state.annotations.tool !== 'pointer') return;
        e.stopPropagation();
        container.classList.remove('committed');
        edit.focus();
        const range = document.createRange();
        range.selectNodeContents(edit);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
      });

      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeLayer(docId, layer);
        container.remove();
        updateAnnoIndicator(docId);
      });

      // Drag via header
      makeDraggable(container, dragbar, wrap, layer);
    }

    // ══════ STICKY NOTE ══════
    function createSticky(wrap, x, y, docId, existing) {
      const container = document.createElement('div');
      container.className = 'anno-sticky';
      container.style.left = x + 'px';
      container.style.top = y + 'px';

      const header = document.createElement('div');
      header.className = 'anno-sticky-header';
      header.innerHTML = '<div class="anno-sticky-label">Note</div>';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'anno-sticky-close';
      closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      header.appendChild(closeBtn);
      container.appendChild(header);

      const body = document.createElement('div');
      body.className = 'anno-sticky-body';
      body.contentEditable = 'true';
      body.textContent = existing?.text || '';
      container.appendChild(body);

      wrap.appendChild(container);

      const layer = existing || {
        type: 'sticky',
        x, y,
        text: '',
        el: container,
      };
      layer.el = container;

      if (!existing) {
        saveLayer(docId, layer);
        body.focus();
      }

      body.addEventListener('blur', () => {
        layer.text = body.textContent;
        updateAnnoIndicator(docId);
      });
      body.addEventListener('keydown', (e) => e.stopPropagation());

      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeLayer(docId, layer);
        container.remove();
        updateAnnoIndicator(docId);
      });

      makeDraggable(container, header, wrap, layer);
    }

    // ══════ DRAG HELPER ══════
    function makeDraggable(el, handle, bounds, layer) {
      let startX, startY, origLeft, origTop;
      const onStart = (e) => {
        if (e.target.closest('.anno-text-close, .anno-sticky-close')) return;
        if (e.target.classList.contains('anno-text-editable') || e.target.classList.contains('anno-sticky-body')) return;
        e.preventDefault(); e.stopPropagation();
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        const cy = e.touches ? e.touches[0].clientY : e.clientY;
        startX = cx; startY = cy;
        origLeft = parseFloat(el.style.left) || 0;
        origTop = parseFloat(el.style.top) || 0;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
      };
      const onMove = (e) => {
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        const cy = e.touches ? e.touches[0].clientY : e.clientY;
        const dx = cx - startX;
        const dy = cy - startY;
        const b = bounds.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const newX = Math.max(0, Math.min(b.width - r.width, origLeft + dx));
        const newY = Math.max(0, Math.min(b.height - r.height, origTop + dy));
        el.style.left = newX + 'px';
        el.style.top = newY + 'px';
        layer.x = newX;
        layer.y = newY;
      };
      const onEnd = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
      };
      handle.addEventListener('mousedown', onStart);
      handle.addEventListener('touchstart', onStart, { passive: false });
    }

    // ══════ LAYER REMOVAL ══════
    function removeLayer(docId, layer) {
      const store = getStore(docId);
      const idx = store.layers.indexOf(layer);
      if (idx >= 0) store.layers.splice(idx, 1);
    }

    // ══════ REDRAW ══════
    function redrawLayers(docId, canvas) {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      const store = getStore(docId);
      store.layers.forEach(layer => {
        if (layer.type === 'text' || layer.type === 'sticky') return;  // DOM elements, not canvas
        ctx.save();
        if (layer.type === 'pen' || layer.type === 'highlighter') {
          ctx.strokeStyle = layer.color;
          ctx.lineWidth = layer.width;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.globalAlpha = layer.opacity || 1;
          ctx.beginPath();
          const p = layer.path;
          if (p && p.length > 0) {
            ctx.moveTo(p[0].x, p[0].y);
            for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
          }
          ctx.stroke();
        } else if (layer.type === 'eraser') {
          ctx.globalCompositeOperation = 'destination-out';
          const p = layer.path;
          if (p) p.forEach(pt => {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, layer.radius || 10, 0, Math.PI * 2);
            ctx.fill();
          });
        } else if (layer.type === 'rectangle') {
          ctx.strokeStyle = layer.color;
          ctx.fillStyle = layer.color;
          ctx.lineWidth = layer.width;
          const x = Math.min(layer.x1, layer.x2);
          const y = Math.min(layer.y1, layer.y2);
          const w = Math.abs(layer.x2 - layer.x1);
          const h = Math.abs(layer.y2 - layer.y1);
          if (layer.fill) {
            ctx.globalAlpha = 0.25;
            ctx.fillRect(x, y, w, h);
            ctx.globalAlpha = 1;
          }
          ctx.strokeRect(x, y, w, h);
        } else if (layer.type === 'ellipse') {
          ctx.strokeStyle = layer.color;
          ctx.fillStyle = layer.color;
          ctx.lineWidth = layer.width;
          const cx = (layer.x1 + layer.x2) / 2;
          const cy = (layer.y1 + layer.y2) / 2;
          const rx = Math.abs(layer.x2 - layer.x1) / 2;
          const ry = Math.abs(layer.y2 - layer.y1) / 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          if (layer.fill) {
            ctx.globalAlpha = 0.25;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          ctx.stroke();
        } else if (layer.type === 'arrow') {
          ctx.strokeStyle = layer.color;
          ctx.fillStyle = layer.color;
          ctx.lineWidth = layer.width;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          drawArrow(ctx, layer.x1, layer.y1, layer.x2, layer.y2, layer.width);
        } else if (layer.type === 'line') {
          ctx.strokeStyle = layer.color;
          ctx.lineWidth = layer.width;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(layer.x1, layer.y1);
          ctx.lineTo(layer.x2, layer.y2);
          ctx.stroke();
        }
        ctx.restore();
      });
    }

    // Restore text boxes and sticky notes as DOM elements from the store
    function restoreTextAndStickyLayers(wrap, docId) {
      const store = getStore(docId);
      store.layers.forEach(layer => {
        if (layer.type === 'text' && !layer.el) {
          createTextInput(wrap, layer.x, layer.y, layer.width, layer.height, docId, layer);
        } else if (layer.type === 'sticky' && !layer.el) {
          createSticky(wrap, layer.x, layer.y, docId, layer);
        }
      });
    }

    // ══════ UNDO / REDO ══════
    function undo() {
      // Find the doc currently under focus (most recent canvas or the last interacted one)
      let docId = state.annotations.currentDocId;
      if (!docId) {
        // Fall back to most recently annotated
        for (const id in state.annotations.store) {
          if (state.annotations.store[id].layers.length > 0) docId = id;
        }
      }
      if (!docId) { toast('Nothing to undo', '', 'info'); return; }
      const store = getStore(docId);
      if (store.layers.length === 0) { toast('Nothing to undo', '', 'info'); return; }
      const layer = store.layers.pop();
      store.undone.push(layer);
      // If text/sticky, also remove DOM element
      if (layer.el && layer.el.parentElement) layer.el.remove();
      // Redraw canvas
      const item = document.querySelector(`[data-doc-id="${docId}"]`);
      if (item) {
        const canvas = item.querySelector('.anno-canvas');
        if (canvas) redrawLayers(docId, canvas);
      }
      updateAnnoIndicator(docId);
    }

    function redo() {
      let docId = state.annotations.currentDocId;
      if (!docId) {
        for (const id in state.annotations.store) {
          if (state.annotations.store[id].undone && state.annotations.store[id].undone.length > 0) docId = id;
        }
      }
      if (!docId) { toast('Nothing to redo', '', 'info'); return; }
      const store = getStore(docId);
      if (!store.undone || store.undone.length === 0) { toast('Nothing to redo', '', 'info'); return; }
      const layer = store.undone.pop();
      store.layers.push(layer);
      const item = document.querySelector(`[data-doc-id="${docId}"]`);
      if (item) {
        const canvas = item.querySelector('.anno-canvas');
        if (canvas) redrawLayers(docId, canvas);
        const wrap = item.querySelector('.anno-canvas-wrap');
        if (wrap && (layer.type === 'text' || layer.type === 'sticky')) {
          if (layer.type === 'text') createTextInput(wrap, layer.x, layer.y, layer.width, layer.height, docId, layer);
          else createSticky(wrap, layer.x, layer.y, docId, layer);
        }
      }
      updateAnnoIndicator(docId);
    }

    function clearAnnotations() {
      let docId = state.annotations.currentDocId;
      if (!docId) {
        const ids = Object.keys(state.annotations.store).filter(id => state.annotations.store[id].layers.length > 0);
        if (ids.length === 0) { toast('Nothing to clear', '', 'info'); return; }
        if (!confirm('Clear annotations from ' + ids.length + ' document(s)?')) return;
        ids.forEach(id => clearDocAnnotations(id));
        toast('Cleared', 'All annotations removed', 'success');
        return;
      }
      clearDocAnnotations(docId);
      toast('Cleared', 'Annotations removed', 'success');
    }

    function clearDocAnnotations(docId) {
      const store = getStore(docId);
      store.layers = [];
      store.undone = [];
      const item = document.querySelector(`[data-doc-id="${docId}"]`);
      if (item) {
        const wrap = item.querySelector('.anno-canvas-wrap');
        if (wrap) {
          // Remove all text/sticky DOM elements
          wrap.querySelectorAll('.anno-text-input, .anno-sticky').forEach(el => el.remove());
          const canvas = wrap.querySelector('.anno-canvas');
          if (canvas) redrawLayers(docId, canvas);
        }
      }
      updateAnnoIndicator(docId);
    }

    // ══════ TOOL UI WIRING ══════
    function initToolbar() {
      // Tool buttons
      $$('.anno-btn').forEach(b => {
        b.onclick = () => setTool(b.dataset.tool);
      });

      // Color swatches
      $$('.anno-swatch').forEach(s => {
        s.onclick = () => {
          state.annotations.color = s.dataset.color;
          $$('.anno-swatch').forEach(x => x.classList.remove('active'));
          s.classList.add('active');
          if (typeof window.STM_REFRESH_TOOLS_BTN === 'function') window.STM_REFRESH_TOOLS_BTN();
        };
      });

      // Stroke widths
      $$('.anno-stroke-btn').forEach(s => {
        s.onclick = () => {
          state.annotations.strokeWidth = parseInt(s.dataset.width);
          $$('.anno-stroke-btn').forEach(x => x.classList.remove('active'));
          s.classList.add('active');
        };
      });

      // Opacity slider
      $id('opacitySlider').addEventListener('input', (e) => {
        state.annotations.opacity = parseInt(e.target.value) / 100;
      });

      // Font size
      $$('.anno-fontsize-btn').forEach(b => {
        b.onclick = () => {
          state.annotations.fontSize = parseInt(b.dataset.size);
          $$('.anno-fontsize-btn').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
        };
      });

      // Fill toggle
      $id('fillToggle').onclick = () => {
        state.annotations.fill = !state.annotations.fill;
        $id('fillToggle').classList.toggle('active', state.annotations.fill);
      };

      // Action buttons
      $id('undoBtn').onclick = undo;
      $id('redoBtn').onclick = redo;
      $id('clearAnnoBtn').onclick = clearAnnotations;

      // Preview button — open preview of first visible doc
      $id('fullscreenBtn').onclick = () => {
        const visible = API.filterDocs();
        if (visible.length === 0) { toast('No documents', 'Upload files first', 'info'); return; }
        // If there's a recently-annotated doc, prefer that
        let targetId = null;
        for (const id in state.annotations.store) {
          if (state.annotations.store[id].layers.length > 0) targetId = id;
        }
        if (!targetId && visible[0]) targetId = visible[0].id;
        if (targetId) API.openPreview(targetId);
      };
    }

    // ══════ KEYBOARD SHORTCUTS ══════
    function initKeyboard() {
      const toolKeys = {
        'v': 'pointer', 'V': 'pointer',
        'p': 'pen', 'P': 'pen',
        'h': 'highlighter', 'H': 'highlighter',
        'u': 'rectangle', 'U': 'rectangle',
        'o': 'ellipse', 'O': 'ellipse',
        'a': 'arrow', 'A': 'arrow',
        'l': 'line', 'L': 'line',
        't': 'text', 'T': 'text',
        'n': 'sticky', 'N': 'sticky',
        'e': 'eraser', 'E': 'eraser',
      };

      document.addEventListener('keydown', (e) => {
        const isInput = ['INPUT','TEXTAREA'].includes(document.activeElement.tagName) ||
                        document.activeElement.contentEditable === 'true';
        if (isInput) return;
        if (state.preview.open) return;
        if (e.ctrlKey || e.metaKey) {
          if (e.key === 'z' || e.key === 'Z') {
            if (e.shiftKey) { e.preventDefault(); redo(); }
            else { e.preventDefault(); undo(); }
          } else if (e.key === 'y' || e.key === 'Y') {
            e.preventDefault();
            redo();
          }
          return;
        }

        // Tool shortcuts
        if (toolKeys[e.key]) {
          e.preventDefault();
          setTool(toolKeys[e.key]);
        }

        // Delete selected text boxes
        if (e.key === 'Delete' || e.key === 'Backspace') {
          const selected = $$('.anno-text-input.selected');
          if (selected.length > 0) {
            e.preventDefault();
            selected.forEach(el => {
              // Find layer and remove
              const wrap = el.closest('.anno-canvas-wrap');
              if (!wrap) return;
              const docId = wrap.dataset.docId;
              const store = getStore(docId);
              const idx = store.layers.findIndex(l => l.el === el);
              if (idx >= 0) store.layers.splice(idx, 1);
              el.remove();
              updateAnnoIndicator(docId);
            });
          }
        }
      });
    }

    // ══════ WINDOW RESIZE ══════
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        $$('.anno-canvas-wrap').forEach(wrap => {
          const canvas = wrap.querySelector('.anno-canvas');
          const thumb = wrap.parentElement;
          if (canvas && thumb) {
            resizeCanvas(canvas, thumb);
            const docId = wrap.dataset.docId;
            if (docId) redrawLayers(docId, canvas);
          }
        });
      }, 150);
    });

    // ══════ EXPOSE API ══════
    window.STM_ANNO = {
      ensureCanvas,
      setTool,
      undo, redo,
      clearAnnotations,
      updateIndicator: updateAnnoIndicator,
    };

    // Initialize toolbar + keyboard
    initToolbar();
    initKeyboard();

    // Track which canvas was most recently interacted with (for undo/redo scope)
    document.addEventListener('mousedown', (e) => {
      const wrap = e.target.closest('.anno-canvas-wrap');
      if (wrap) {
        state.annotations.currentDocId = wrap.dataset.docId;
      }
    });

    console.log('%c✓ Annotation engine ready',
      'color: #C6F432; font-weight: bold; font-size: 11px;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
