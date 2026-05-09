/* ============ codepen.js ============ */
/* ============================================================================
   topbar.js · Speed to Market AI · RQBI Platform
   ============================================================================
   Wires the new topbar features. PURELY ADDITIVE — does not replace any
   existing event handlers from the original v2.20 JS. The existing
   setupActionsMenu() still runs and updates #statusText as before. This
   module adds:

     • Theme toggle (sun/moon icon swap; localStorage persistence)
     • Lifecycle progress strip — advances via actions menu clicks
     • KPI strip — bound to existing form fields, updates live
     • ARIA wiring for the actions dropdown

   All public functions are exposed via window.RQBI for debug/manual use.
   ============================================================================ */

(function () {
  'use strict';

  /* ──────────────────────────────────────────────────────────────────────
     1. THEME TOGGLE — light is default; dark is opt-in via data-theme.
     ────────────────────────────────────────────────────────────────────── */

  function applyTheme(theme) {
    const html = document.documentElement;
    html.classList.add('no-transitions');
    if (theme === 'dark') html.setAttribute('data-theme', 'dark');
    else html.removeAttribute('data-theme');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => html.classList.remove('no-transitions'));
    });
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = cur === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem('stm-theme', next); } catch (e) { /* private mode */ }
  }

  function initTheme() {
    let stored = null;
    try { stored = localStorage.getItem('stm-theme'); } catch (e) {}
    if (stored === 'dark') applyTheme('dark');
    const btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', toggleTheme);
  }


  /* ──────────────────────────────────────────────────────────────────────
     2. LIFECYCLE PROGRESS STRIP
     ──────────────────────────────────────────────────────────────────────
     Stage order matches the strip's visual order. Each stage in
     STAGE_ORDER becomes "done" when the deal advances PAST it and
     "active" when the deal arrives AT it. "Cancelled" is special — it
     doesn't sit on the main path; instead it forces the strip into a
     muted state with the Cancelled status pill.
     ────────────────────────────────────────────────────────────────────── */

  const STAGE_ORDER = ['Submission', 'Cleared', 'Inquired', 'Quoted', 'Bound', 'Issued'];

  function statusToStage(status) {
    if (!status) return 'Submission';
    if (status === 'Cleared')   return 'Cleared';
    if (status === 'Inquired')  return 'Inquired';
    if (status === 'Quoted')    return 'Quoted';
    if (status === 'Bound')     return 'Bound';
    if (status === 'Issued')    return 'Issued';
    if (status === 'Cancelled') return 'Cancelled';
    return 'Submission';
  }

  function statusPillClass(status) {
    return 'status-' + (status || 'submission').toLowerCase();
  }

  function advanceLifecycle(stage) {
    const stages = document.querySelectorAll('#lifecycleStages .lifecycle-stage');
    const connectors = document.querySelectorAll('#lifecycleStages .lifecycle-connector');
    const pill = document.getElementById('lifecycleStatusPill');

    /* Cancelled — off-path. Strip becomes muted; pill turns red. */
    if (stage === 'Cancelled') {
      stages.forEach(s => s.classList.remove('active', 'done'));
      connectors.forEach(c => c.classList.remove('done'));
      if (pill) {
        pill.className = 'status-pill status-cancelled';
        pill.textContent = 'Cancelled';
      }
      return;
    }

    const targetIndex = STAGE_ORDER.indexOf(stage);
    if (targetIndex === -1) return;   /* unknown stage */

    stages.forEach((stageEl, i) => {
      stageEl.classList.remove('active', 'done');
      if (i < targetIndex) stageEl.classList.add('done');
      else if (i === targetIndex) stageEl.classList.add('active');
    });

    connectors.forEach((connectorEl, i) => {
      connectorEl.classList.toggle('done', i < targetIndex);
    });

    if (pill) {
      pill.className = 'status-pill ' + statusPillClass(stage);
      pill.textContent = stage;
    }
  }

  function wireLifecycleToActions() {
    const actionsMenu = document.getElementById('actionsMenu');
    if (!actionsMenu) return;

    /* Listen for clicks WITHOUT replacing the existing handler — this fires
       in addition to whatever the original setupActionsMenu() does.        */
    actionsMenu.addEventListener('click', function (e) {
      const li = e.target.closest('li[data-status]');
      if (!li) return;
      advanceLifecycle(li.dataset.status);
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     3. KPI STRIP
     ──────────────────────────────────────────────────────────────────────
     Reads existing form fields and renders into the KPI cells. Sources:
        Premium       → sum of all .premium-value inputs in the limits section
        Program Limit → sum of all .limit-value inputs (excludes primary GL/AL)
        Attachment    → lowest attachment point in the excess tower
        Target Date   → #targetDate value, formatted

     Each is computed live via input/change event delegation. Empty values
     render as em-dash. When a value changes, the cell briefly glows.       */

  function fmtCurrency(n) {
    if (!isFinite(n) || n <= 0) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function parseInputCurrency(input) {
    if (!input || !input.value) return 0;
    const cleaned = input.value.replace(/[^0-9.]/g, '');
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : 0;
  }

  function updateKPI(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.textContent === value) return;
    el.textContent = value;
    el.classList.remove('updated');
    /* Force reflow so the animation re-fires every update */
    void el.offsetWidth;
    el.classList.add('updated');
  }

  function recomputeKPIs() {
    /* Premium = sum of every .premium-value input across the limits section */
    let premiumTotal = 0;
    document.querySelectorAll('.premium-value').forEach(i => {
      premiumTotal += parseInputCurrency(i);
    });
    updateKPI('kpiPremium', fmtCurrency(premiumTotal));

    /* Program Limit = sum of all .limit-value inputs (excess layers).
       Primary GL/AL inputs aren't .limit-value, so they're excluded.       */
    let limitTotal = 0;
    document.querySelectorAll('.limit-value').forEach(i => {
      limitTotal += parseInputCurrency(i);
    });
    updateKPI('kpiLimit', fmtCurrency(limitTotal));

    /* Attachment = lowest non-zero attachment found.
       For now we infer it from the excess layer; refined wiring in
       session 5 when the limits section is fully restyled.                 */
    /* Placeholder: leave as-is; will be wired more precisely later */

    /* Target Date — read from the form field if present */
    const td = document.getElementById('targetDate');
    if (td) {
      const formatted = td._flatpickr && td._flatpickr.altInput
        ? td._flatpickr.altInput.value
        : td.value;
      updateKPI('kpiTargetDate', formatted || '—');
    }
  }

  function wireKPISources() {
    /* Listen broadly for any input event in the page content; cheap to
       recompute, accurate, no manual binding per field. */
    const root = document.getElementById('pageContent');
    if (!root) return;
    let pending = false;
    root.addEventListener('input', function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        recomputeKPIs();
      });
    });
    root.addEventListener('change', function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        recomputeKPIs();
      });
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     4. ARIA — actions dropdown expanded state
     ────────────────────────────────────────────────────────────────────── */

  function wireActionsAria() {
    const btn = document.getElementById('actionsBtn');
    const menu = document.getElementById('actionsMenu');
    if (!btn || !menu) return;

    /* Whenever the original handler toggles .visible, mirror it to ARIA */
    const observer = new MutationObserver(function () {
      const isOpen = menu.classList.contains('visible');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    observer.observe(menu, { attributes: true, attributeFilter: ['class'] });
  }


  /* ──────────────────────────────────────────────────────────────────────
     5. INIT
     ────────────────────────────────────────────────────────────────────── */

  function init() {
    initTheme();
    wireLifecycleToActions();
    wireKPISources();
    wireActionsAria();
    /* First compute on next frame (after the original v2.20 init has run) */
    requestAnimationFrame(recomputeKPIs);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }


  /* ──────────────────────────────────────────────────────────────────────
     6. PUBLIC API — for debug + manual control
     ────────────────────────────────────────────────────────────────────── */

  window.RQBI = window.RQBI || {};
  window.RQBI.advanceLifecycle = advanceLifecycle;
  window.RQBI.updateKPI = updateKPI;
  window.RQBI.recomputeKPIs = recomputeKPIs;
  window.RQBI.toggleTheme = toggleTheme;
  window.RQBI.applyTheme = applyTheme;
})();


/* ============================================================================
   risk.js · Speed to Market AI · RQBI Platform
   ============================================================================
   Adds a computed 5-year totals row beneath each loss table (GL + Auto).
   Reads from the existing loss-row inputs that the v2.20 setupLossTable()
   factory creates. Purely additive — does not touch the factory itself.

   How it works
   ------------
   1. On every input/change in #glLossRows or #autoLossRows, recompute the
      column sums (Total Claims · Total Paid · Total Reserve · Total
      Incurred) and render them into the .loss-totals row.
   2. The totals row is hidden by default; first non-zero sum reveals it.
   3. Currency values get formatted with comma thousands separators.

   Why this is useful
   ------------------
   Underwriters mentally sum loss columns when reviewing a 5-year loss run
   — frequency × severity, ratio of paid to reserve, etc. Showing the sums
   live saves cognitive load and surfaces obvious data-entry errors (e.g.
   total paid > total incurred).
   ============================================================================ */

(function () {
  'use strict';

  /* The 4 inputs we sum, in column order:
       col[2] = # Total Claims    (integer)
       col[3] = Total Paid $      (currency)
       col[4] = Total Reserve $   (currency)
       col[5] = Total Incurred $  (currency)
     The other 3 columns (Policy Period, Revenue, Valuation Date) aren't
     summable — they get em-dashes in the totals row.                       */

  const TABLES = [
    { rowsId: 'glLossRows',    totalsId: 'glLossTotals'   },
    { rowsId: 'autoLossRows',  totalsId: 'autoLossTotals' }
  ];

  function parseNum(input) {
    if (!input || !input.value) return 0;
    /* Strip everything except digits, dot, minus.
       Handles "$1,234,567" and "1,234,567" alike.                          */
    const cleaned = String(input.value).replace(/[^0-9.-]/g, '');
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : 0;
  }

  function fmtCurrency(n) {
    if (n === 0) return '$0';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function fmtCount(n) {
    return Math.round(n).toLocaleString('en-US');
  }

  function recompute(table) {
    const rowsContainer = document.getElementById(table.rowsId);
    const totalsRow = document.getElementById(table.totalsId);
    if (!rowsContainer || !totalsRow) return;

    let totalClaims = 0,
        totalPaid = 0,
        totalReserve = 0,
        totalIncurred = 0;

    /* Walk each .loss-row inside this table.
       Within a row, the inputs sit at column positions 2-5 (zero-indexed).
       The factory uses `numInp()` for claims (no class), and three
       `money()` wrappers for paid/reserve/incurred.                         */
    const rows = rowsContainer.querySelectorAll('.loss-row');
    rows.forEach(function (row) {
      const inputs = row.querySelectorAll('input');
      /* inputs ordered: revenue (1), claims (2), paid (3), reserve (4), incurred (5), valuation-date (6).
         (Index 0 is .policy-select, which is a SELECT not an INPUT — so the
         input list naturally starts at the 2nd column.)                     */
      if (inputs.length >= 5) {
        totalClaims    += parseNum(inputs[1]);
        totalPaid      += parseNum(inputs[2]);
        totalReserve   += parseNum(inputs[3]);
        totalIncurred  += parseNum(inputs[4]);
      }
    });

    /* Render into totals row */
    const claimsCell   = totalsRow.querySelector('[data-totals="claims"]');
    const paidCell     = totalsRow.querySelector('[data-totals="paid"]');
    const reserveCell  = totalsRow.querySelector('[data-totals="reserve"]');
    const incurredCell = totalsRow.querySelector('[data-totals="incurred"]');

    if (claimsCell)   claimsCell.textContent   = fmtCount(totalClaims);
    if (paidCell)     paidCell.textContent     = fmtCurrency(totalPaid);
    if (reserveCell)  reserveCell.textContent  = fmtCurrency(totalReserve);
    if (incurredCell) incurredCell.textContent = fmtCurrency(totalIncurred);

    /* Show/hide based on whether there's any data to sum.
       If all four totals are zero, leave hidden — keeps the UI quiet
       until the underwriter actually starts entering data.                  */
    const hasData = totalClaims + totalPaid + totalReserve + totalIncurred > 0;
    if (hasData) totalsRow.removeAttribute('hidden');
    else totalsRow.setAttribute('hidden', '');
  }

  function recomputeAll() {
    TABLES.forEach(recompute);
  }

  function wire() {
    /* Event delegation on the page-content root — catches input/change
       events from any loss-row input regardless of when they were added.   */
    const root = document.getElementById('pageContent') || document.body;
    let pending = false;
    function schedule() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        recomputeAll();
      });
    }
    root.addEventListener('input',  schedule);
    root.addEventListener('change', schedule);

    /* Initial compute after the page-deal init has run */
    requestAnimationFrame(recomputeAll);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }


  /* Public API */
  window.RQBI = window.RQBI || {};
  window.RQBI.recomputeLossTotals = recomputeAll;
})();


/* ============================================================================
   limits.js · Speed to Market AI · RQBI Platform
   ============================================================================
   The Limits & Premiums section interactive layer. This is a clean rewrite
   will integrate this into the main JS module; in the meantime it can run
   standalone (the v2.20 setupAddCoverageDropdowns() and the related
   unchanged).

   What it handles
   ---------------
     • Coverage entry collapse/expand (click checkbox or arrow)
     • Coverage entry delete (with confirm dialog)
     • "Our Layer" toggle:
         - reveals .layer-options-panel
         - adds .our-layer-active to .limit-entry (gold edge stripe)
         - auto-populates Carrier from #paper, dates from #polEff/#polExp
     • Min Earned Premium computation:
         - listens on .premium-value and .layer-mep-pct
         - writes to .layer-mep-premium

   Selector renames vs v2.20
   -------------------------
   ============================================================================ */

(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }

  function parseCurrency(input) {
    if (!input || !input.value) return 0;
    const cleaned = String(input.value).replace(/[^0-9.-]/g, '');
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : 0;
  }

  function formatCurrencyDisplay(n) {
    if (!isFinite(n) || n <= 0) return '0';
    return Math.round(n).toLocaleString('en-US');
  }

  /* ──────────────────────────────────────────────────────────────────────
     Collapse / expand handlers
     ────────────────────────────────────────────────────────────────────── */

  function bindCollapse(root) {
    root.addEventListener('click', function (e) {
      const arrow = e.target.closest('.collapse-arrow');
      const del = e.target.closest('.delete-icon');

      if (arrow) {
        const header = arrow.closest('.limit-entry-header');
        const panel = header && header.nextElementSibling;
        if (panel && panel.classList.contains('limit-details-panel')) {
          const isOpen = panel.classList.toggle('visible');
          arrow.classList.toggle('expanded', isOpen);
        }
        return;
      }

      if (del) {
        if (confirm('Are you sure you want to delete this coverage entry?')) {
          const entry = del.closest('.limit-entry');
          if (entry) entry.remove();
        }
      }
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     Coverage-toggle checkboxes (the main "show this coverage" check)
     ────────────────────────────────────────────────────────────────────── */

  function bindCoverageToggle(root) {
    root.addEventListener('change', function (e) {
      const cb = e.target;
      if (!cb.matches('.limit-entry-header input[type="checkbox"][data-target]')) return;

      const header = cb.closest('.limit-entry-header');
      const panel = header && header.nextElementSibling;
      const arrow = header.querySelector('.collapse-arrow');

      if (panel) panel.classList.toggle('visible', cb.checked);
      if (arrow) arrow.classList.toggle('expanded', cb.checked);
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     "Our Layer" toggle — reveals the layer options panel + auto-populates
     ────────────────────────────────────────────────────────────────────── */

  function bindOurLayerToggle(root) {
    root.addEventListener('change', function (e) {
      const cb = e.target;
      if (!cb.matches('input[data-our-layer]')) return;

      const entry = cb.closest('.limit-entry');
      if (!entry) return;

      const panel = entry.querySelector('.layer-options-panel');
      if (panel) panel.classList.toggle('visible', cb.checked);

      entry.classList.toggle('our-layer-active', cb.checked);

      /* Auto-populate Carrier and dates from the deal-level fields when
         the user marks this layer as their carrier's quoted layer.        */
      if (cb.checked) {
        const paperVal = ($('#paper') && $('#paper').value) || '';
        const polEffVal = ($('#polEff') && $('#polEff').value) || '';
        const polExpVal = ($('#polExp') && $('#polExp').value) || '';

        const carrierInput = entry.querySelector('.limit-details-panel input[placeholder="Carrier Name"]');
        const dateInputs = entry.querySelectorAll('.limit-details-panel .limit-date');
        const effDate = dateInputs[0];
        const expDate = dateInputs[1];

        if (carrierInput && !carrierInput.value) {
          carrierInput.value = paperVal;
        }
        if (effDate) {
          if (effDate._flatpickr) effDate._flatpickr.setDate(polEffVal, true);
          else if (!effDate.value) effDate.value = polEffVal;
        }
        if (expDate) {
          if (expDate._flatpickr) expDate._flatpickr.setDate(polExpVal, true);
          else if (!expDate.value) expDate.value = polExpVal;
        }
      }
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     Min Earned Premium computation
     ────────────────────────────────────────────────────────────────────── */

  function bindMEPComputation(root) {
    root.addEventListener('input', function (e) {
      if (!e.target.matches('.premium-value, .layer-mep-pct')) return;

      const entry = e.target.closest('.limit-entry');
      if (!entry) return;

      const ourLayerCb = entry.querySelector('input[data-our-layer]');
      if (!ourLayerCb || !ourLayerCb.checked) return;     /* only compute if layer is "ours" */

      const premiumInput = entry.querySelector('.premium-value');
      const mepPctInput = entry.querySelector('.layer-mep-pct');
      const mepOutput = entry.querySelector('.layer-mep-premium');
      if (!premiumInput || !mepPctInput || !mepOutput) return;

      const premium = parseCurrency(premiumInput);
      const mepPct = parseFloat(mepPctInput.value) || 0;
      const mep = (premium * mepPct) / 100;
      mepOutput.value = formatCurrencyDisplay(mep);
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     INIT
     ────────────────────────────────────────────────────────────────────── */

  function init() {
    const root = document.getElementById('risk-limits');
    if (!root) return;
    bindCollapse(root);
    bindCoverageToggle(root);
    bindOurLayerToggle(root);
    bindMEPComputation(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }


  /* Public API */
  window.RQBI = window.RQBI || {};
  window.RQBI.bindLimits = init;
})();


/* ============================================================================
   forms.js · Speed to Market AI · RQBI Platform
   ============================================================================
   Forms & Endorsements + Subjectivities setup.

   Replacement for the original setupFormsAndEndorsements() in v2.20. The
   shape of formsData is unchanged — Layer Type → categories → items{num,
   name} — but every form number / name has been replaced with a generic
   placeholder. **Replace these with your carrier's actual form schedule
   when integrating.**

   Why placeholders
   ----------------
   U-SXS-* and STF-SXS-* prefixes, etc.). Per the explicit "remove anything
   demonstrated below with obviously-fictional form numbers (FORM-001-A
   etc.) so the UI can be exercised end-to-end. Swap them out per layer
   type when wiring this into your environment.
   ============================================================================ */

(function () {
  'use strict';


  /* ──────────────────────────────────────────────────────────────────────
     1. FORMS DATA — REPLACE WITH YOUR CARRIER'S ACTUAL SCHEDULE
     ──────────────────────────────────────────────────────────────────────
     Shape: { [layerType]: [{ category, items: [{ num, name }] }] }       */

  const formsData = {
    'Lead Practice Construction': [
      {
        category: 'Mandatory Forms',
        items: [
          { num: 'POL-001 (09/26)',     name: 'Excess Liability Policy Form' },
          { num: 'DEC-001 (09/26)',     name: 'Excess Liability Policy Declarations' },
          { num: 'POL-002 (09/26)',     name: 'Schedule of Underlying Insurance' }
        ]
      },
      {
        category: 'Limits & Conditions',
        items: [
          { num: 'END-100 (09/26)',     name: 'Anti-Stacking of Limits Endorsement' },
          { num: 'END-101 (09/26)',     name: 'Notice of Cancellation Endorsement' },
          { num: 'END-102 (09/26)',     name: 'Knowledge of Occurrence Endorsement' }
        ]
      },
      {
        category: 'Optional Endorsements',
        items: [
          { num: 'END-200 (09/26)',     name: 'Construction Project Specific' },
          { num: 'END-201 (09/26)',     name: 'Designated Insured Operations' }
        ]
      }
    ],

    'Excess Practice Construction': [
      {
        category: 'Mandatory Forms',
        items: [
          { num: 'POL-010 (09/26)',     name: 'Excess Liability Policy Form (Excess)' },
          { num: 'DEC-010 (09/26)',     name: 'Excess Liability Declarations (Excess)' },
          { num: 'POL-011 (09/26)',     name: 'Schedule of Underlying Insurance' }
        ]
      },
      {
        category: 'Limits & Conditions',
        items: [
          { num: 'END-110 (09/26)',     name: 'Anti-Stacking of Limits Endorsement' },
          { num: 'END-111 (09/26)',     name: 'Notice of Cancellation Endorsement' }
        ]
      },
      {
        category: 'State-Specific',
        items: [
          { num: 'ST-FL (09/26)',       name: 'Florida Amendatory Endorsement' },
          { num: 'ST-CA (09/26)',       name: 'California Amendatory Endorsement' }
        ]
      },
      {
        category: 'Optional Endorsements',
        items: [
          { num: 'END-210 (09/26)',     name: 'Construction Project Specific' }
        ]
      }
    ],

    'Excess Hospitality': [
      {
        category: 'Mandatory Forms',
        items: [
          { num: 'POL-020 (09/26)',     name: 'Excess Liability Policy Form (Hospitality)' },
          { num: 'DEC-020 (09/26)',     name: 'Excess Liability Declarations (Hospitality)' }
        ]
      },
      {
        category: 'Limits & Conditions',
        items: [
          { num: 'END-120 (09/26)',     name: 'Liquor Liability Sub-Limit Endorsement' },
          { num: 'END-121 (09/26)',     name: 'Assault & Battery Sub-Limit Endorsement' }
        ]
      }
    ]

    /* Add other layer types here:
       'Lead Hospitality':              [...]
       'Lead Manufacturing':            [...]
       'Lead Mercantile':               [...]
       'Lead Project':                  [...]
       'Lead Real Estate - Hab':        [...]
       'Lead Other':                    [...]
       'Excess Manufacturing':          [...]
       'Excess Mercantile':             [...]
       'Excess Project':                [...]
       'Excess Real Estate - Hab':      [...]
       'Excess Other':                  [...]                              */
  };


  /* ──────────────────────────────────────────────────────────────────────
     2. RENDERING — populate the forms list from formsData
     ────────────────────────────────────────────────────────────────────── */

  function renderEmpty(listEl, message) {
    listEl.innerHTML =
      '<div class="forms-empty">' +
        (message || 'Select a Layer Type on the Deal Information page to load the form schedule.') +
      '</div>';
  }

  function buildFormRow(item) {
    const row = document.createElement('div');
    row.className = 'form-row';
    row.innerHTML =
      '<label class="checkbox-label"><input type="checkbox" checked></label>' +
      '<span>' + escapeHtml(item.num) + '</span>' +
      '<span>' + escapeHtml(item.name) + '</span>' +
      '<div class="form-actions-icons">' +
        '<svg class="form-action-view" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="View"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
        '<svg class="form-action-delete" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Delete"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
      '</div>';
    return row;
  }

  function buildCategoryHeader(categoryName) {
    const el = document.createElement('div');
    el.className = 'form-category-header';
    el.textContent = categoryName;
    return el;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderFormsForLayer(layerType) {
    const list = document.querySelector('#formsContainer .forms-list');
    if (!list) return;
    list.innerHTML = '';

    if (!layerType || !formsData[layerType]) {
      renderEmpty(list);
      return;
    }

    formsData[layerType].forEach(function (cat) {
      list.appendChild(buildCategoryHeader(cat.category));
      cat.items.forEach(function (item) {
        list.appendChild(buildFormRow(item));
      });
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     3. SUBJECTIVITIES — "Other?" toggle + Add Another button
     ────────────────────────────────────────────────────────────────────── */

  function setupSubjectivities() {
    const otherCb = document.getElementById('otherSubjectivityCheckbox');
    if (!otherCb) return;

    const panel = otherCb.closest('.other-subjectivity').querySelector('.other-details-panel');

    otherCb.addEventListener('change', function () {
      if (panel) panel.classList.toggle('visible', otherCb.checked);
    });

    /* Add Another button — clones an input group */
    const addBtn = document.querySelector('.add-other-btn');
    if (addBtn && panel) {
      addBtn.addEventListener('click', function () {
        const group = document.createElement('div');
        group.className = 'other-input-group';
        group.innerHTML = '<textarea rows="2" placeholder="Enter other subjectivity..."></textarea>';
        panel.insertBefore(group, addBtn);
      });
    }
  }


  /* ──────────────────────────────────────────────────────────────────────
     4. DELETE / VIEW HANDLERS for form rows
     ────────────────────────────────────────────────────────────────────── */

  function setupRowActions() {
    const list = document.querySelector('#formsContainer .forms-list');
    if (!list) return;

    list.addEventListener('click', function (e) {
      const del = e.target.closest('.form-action-delete');
      if (del) {
        if (confirm('Remove this form from the schedule?')) {
          const row = del.closest('.form-row');
          if (row) row.remove();
        }
        return;
      }
      const view = e.target.closest('.form-action-view');
      if (view) {
        /* Hook for opening a form preview dialog. Wire to your viewer. */
        const num = view.closest('.form-row').children[1].textContent;
        console.log('[forms] preview requested for', num);
      }
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     5. SELECT-ALL CHECKBOX
     ────────────────────────────────────────────────────────────────────── */

  function setupSelectAll() {
    const selectAll = document.querySelector('.select-all-forms');
    const list = document.querySelector('#formsContainer .forms-list');
    if (!selectAll || !list) return;

    selectAll.addEventListener('change', function () {
      list.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
        cb.checked = selectAll.checked;
      });
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     6. RESET / PREVIEW / ADD buttons in the forms header
     ────────────────────────────────────────────────────────────────────── */

  function setupHeaderButtons() {
    const layerTypeSelect = document.getElementById('layerType');
    const resetBtn = document.getElementById('formsReset');
    const previewBtn = document.getElementById('formsPreview');
    const addBtn = document.getElementById('formsAdd');

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        const layer = layerTypeSelect ? layerTypeSelect.value : '';
        renderFormsForLayer(layer);
      });
    }

    if (previewBtn) {
      previewBtn.addEventListener('click', function () {
        /* Hook: open a preview window with all checked forms. */
        const checked = document.querySelectorAll('#formsContainer .forms-list .form-row input:checked');
        console.log('[forms] preview ' + checked.length + ' forms');
      });
    }

    if (addBtn) {
      addBtn.addEventListener('click', function () {
        /* Hook: open an "add custom form" dialog. Wire to your dialog. */
        const num = prompt('Form number:');
        if (!num) return;
        const name = prompt('Form name:');
        if (!name) return;
        const list = document.querySelector('#formsContainer .forms-list');
        if (list) list.appendChild(buildFormRow({ num: num, name: name }));
      });
    }
  }


  /* ──────────────────────────────────────────────────────────────────────
     7. LAYER-TYPE LISTENER — re-renders schedule when layer type changes
     ────────────────────────────────────────────────────────────────────── */

  function setupLayerTypeListener() {
    const select = document.getElementById('layerType');
    if (!select) return;
    select.addEventListener('change', function () {
      renderFormsForLayer(select.value);
    });
    /* Initial render based on current selection */
    renderFormsForLayer(select.value);
  }


  /* ──────────────────────────────────────────────────────────────────────
     8. INIT
     ────────────────────────────────────────────────────────────────────── */

  function init() {
    setupSubjectivities();
    setupRowActions();
    setupSelectAll();
    setupHeaderButtons();
    setupLayerTypeListener();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }


  /* Public API */
  window.RQBI = window.RQBI || {};
  window.RQBI.renderForms = renderFormsForLayer;
  window.RQBI.formsData = formsData;
})();


/* ============================================================================
   shell.js · Speed to Market AI · RQBI Platform
   ============================================================================
   App-shell behaviours:
     1. Sidebar — updates premium / dates / insured / layer from form fields
     2. Dialog enhancements — ESC, click-outside, focus trap, return focus
     3. Theme-color meta sync — flips with light/dark theme toggle
     4. Keyboard navigation — arrow keys for tabs

   This file is purely additive. Existing v2.20 dialog open/close handlers
   continue to work unchanged.
   ============================================================================ */

(function () {
  'use strict';

  /* ──────────────────────────────────────────────────────────────────────
     1. SIDEBAR UPDATERS — keep stat blocks in sync with the form
     ────────────────────────────────────────────────────────────────────── */

  function updateSidebar() {
    /* Premium = sum of all .premium-value inputs (same as KPI logic) */
    let premiumTotal = 0;
    document.querySelectorAll('.premium-value').forEach(function (i) {
      const cleaned = (i.value || '').replace(/[^0-9.-]/g, '');
      const n = parseFloat(cleaned);
      if (isFinite(n)) premiumTotal += n;
    });

    setStat('premiumTxt', premiumTotal > 0
      ? '$' + Math.round(premiumTotal).toLocaleString('en-US')
      : '—');

    /* Inception / Expiration from the deal page fields */
    const polEff = document.getElementById('polEff');
    const polExp = document.getElementById('polExp');
    setStat('incepTxt', (polEff && polEff.value) || '—');
    setStat('expTxt', (polExp && polExp.value) || '—');

    /* Insured from #dealName */
    const dealName = document.getElementById('dealName');
    setStat('insuredTxt', (dealName && dealName.value) || '—');

    /* Layer summary — first "Our Layer" entry's limit + attachment */
    const ourLayer = document.querySelector('.limit-entry.our-layer-active');
    if (ourLayer) {
      const limitInput = ourLayer.querySelector('.limit-value');
      const limitVal = (limitInput && limitInput.value) || '—';
      setStat('layerSummary', '$' + limitVal);
    } else {
      setStat('layerSummary', '—');
    }
  }

  function setStat(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.classList.contains('status-pill')) return;   /* status pill handled elsewhere */
    if (el.textContent === value) return;
    el.textContent = value;
    if (value === '—') el.setAttribute('data-empty', 'true');
    else el.removeAttribute('data-empty');
  }

  function bindSidebarSources() {
    const root = document.getElementById('pageContent');
    if (!root) return;
    let pending = false;
    function schedule() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        updateSidebar();
      });
    }
    root.addEventListener('input', schedule);
    root.addEventListener('change', schedule);
  }


  /* ──────────────────────────────────────────────────────────────────────
     2. DIALOG ENHANCEMENTS — focus trap + ESC + click-outside + return
     ────────────────────────────────────────────────────────────────────── */

  let lastFocusedBeforeDialog = null;

  function getFocusableInside(container) {
    return Array.from(container.querySelectorAll(
      'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(function (el) {
      return !el.disabled && el.offsetParent !== null;
    });
  }

  function trapTab(e, dialog) {
    if (e.key !== 'Tab') return;
    const focusables = getFocusableInside(dialog);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === 'function') dialog.close();
    if (lastFocusedBeforeDialog) {
      try { lastFocusedBeforeDialog.focus(); } catch (e) {}
      lastFocusedBeforeDialog = null;
    }
  }

  function bindDialogs() {
    document.querySelectorAll('dialog.app-dialog').forEach(function (dialog) {
      /* ESC + Tab trap */
      dialog.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeDialog(dialog);
        }
        trapTab(e, dialog);
      });

      /* Click-outside backdrop closes (native <dialog> shows backdrop, click
         on the dialog element itself outside its content fires here)        */
      dialog.addEventListener('click', function (e) {
        if (e.target === dialog) closeDialog(dialog);
      });

      /* All [data-dialog-close] elements close the parent dialog */
      dialog.querySelectorAll('[data-dialog-close]').forEach(function (btn) {
        btn.addEventListener('click', function () { closeDialog(dialog); });
      });

      /* Focus first input on open */
      const observer = new MutationObserver(function () {
        if (dialog.open) {
          lastFocusedBeforeDialog = document.activeElement;
          requestAnimationFrame(function () {
            const first = getFocusableInside(dialog)[0];
            if (first) first.focus();
          });
        }
      });
      observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     3. THEME-COLOR SYNC — flip mobile address bar color with theme
     ────────────────────────────────────────────────────────────────────── */

  function syncThemeColor() {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    meta.setAttribute('content', isDark ? '#0a1428' : '#0e46a3');
  }

  function bindThemeColorSync() {
    syncThemeColor();
    const observer = new MutationObserver(syncThemeColor);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     4. KEYBOARD NAVIGATION — arrow keys for tab lists
     ────────────────────────────────────────────────────────────────────── */

  function bindTabArrowKeys() {
    document.querySelectorAll('[role="tablist"]').forEach(function (list) {
      list.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
        const current = tabs.indexOf(document.activeElement);
        if (current === -1) return;
        e.preventDefault();
        const next = e.key === 'ArrowRight'
          ? (current + 1) % tabs.length
          : (current - 1 + tabs.length) % tabs.length;
        tabs[current].setAttribute('tabindex', '-1');
        tabs[next].setAttribute('tabindex', '0');
        tabs[next].focus();
      });
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     5. SIDEBAR FOOTER BUTTONS
     ────────────────────────────────────────────────────────────────────── */

  function bindSidebarFooter() {
    const printBtn = document.getElementById('sidebarPrintBtn');
    if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

    const exportBtn = document.getElementById('sidebarExportBtn');
    if (exportBtn) exportBtn.addEventListener('click', function () {
      /* Hook for export-to-PDF integration. Logs for now. */
      console.log('[shell] export summary requested');
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     INIT
     ────────────────────────────────────────────────────────────────────── */

  function init() {
    bindSidebarSources();
    bindDialogs();
    bindThemeColorSync();
    bindTabArrowKeys();
    bindSidebarFooter();
    requestAnimationFrame(updateSidebar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }


  /* Public API */
  window.RQBI = window.RQBI || {};
  window.RQBI.updateSidebar = updateSidebar;
})();


/* ============================================================================
   app.js · Speed to Market AI · RQBI Platform
   ============================================================================
   Top-level coordinator. Loaded LAST in the script chain. Handles:

     1. Build label              — prints version banner to console
     2. Toast notifications      — RQBI.toast(message, opts)
     3. Save button indicator    — saving spinner → saved checkmark
     4. Dialog-save card pulse   — visual feedback on the affected card
     5. KPI attachment compute   — derives from lowest "Our Layer" attachment
     6. KPI emphasis sync        — amber accent when our-layer is active
     7. Action menu focus-out    — closes when keyboard tabs away
     8. Lifecycle → toast        — fires a toast when status advances
     9. Limits summary footer    — recomputes totals across all entries

   All behaviour is purely additive. No existing module is modified; this
   file orchestrates them and fills the gaps between them.
   ============================================================================ */

(function () {
  'use strict';

  const BUILD = 'RQBI v9 · Speed to Market AI · build 2026.05.09';

  /* ──────────────────────────────────────────────────────────────────────
     1. BUILD LABEL — version banner in DevTools console
     ────────────────────────────────────────────────────────────────────── */

  function logBuildLabel() {
    const css = 'background: linear-gradient(90deg,#0e46a3,#1454c4);' +
                'color:#fff;padding:6px 12px;border-radius:4px;font-weight:700;' +
                'font-family:Geist Mono,monospace;letter-spacing:0.04em;';
    console.log('%c ' + BUILD + ' ', css);
  }


  /* ──────────────────────────────────────────────────────────────────────
     2. TOAST SYSTEM
     ────────────────────────────────────────────────────────────────────── */

  function ensureToastStack() {
    let stack = document.getElementById('toastStack');
    if (stack) return stack;
    stack = document.createElement('div');
    stack.id = 'toastStack';
    stack.className = 'toast-stack';
    stack.setAttribute('role', 'region');
    stack.setAttribute('aria-label', 'Notifications');
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
    return stack;
  }

  const TOAST_ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
  };

  function toast(message, opts) {
    opts = opts || {};
    const kind = opts.kind || 'info';
    const duration = opts.duration != null ? opts.duration : 3500;

    const stack = ensureToastStack();
    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.innerHTML =
      '<span class="toast-icon">' + (TOAST_ICONS[kind] || TOAST_ICONS.info) + '</span>' +
      '<div class="toast-body"></div>' +
      '<button class="toast-close" type="button" aria-label="Dismiss">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>';
    el.querySelector('.toast-body').textContent = message;

    stack.appendChild(el);

    function dismiss() {
      el.classList.add('toast-leaving');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 240);
    }

    el.querySelector('.toast-close').addEventListener('click', dismiss);

    if (duration > 0) setTimeout(dismiss, duration);

    return { dismiss: dismiss, element: el };
  }


  /* ──────────────────────────────────────────────────────────────────────
     3. SAVE BUTTON INDICATOR
     ────────────────────────────────────────────────────────────────────── */

  function decorateSaveButton() {
    const btn = document.getElementById('saveBtn');
    if (!btn) return;

    /* Only decorate once */
    if (btn.querySelector('.save-label')) return;

    btn.innerHTML =
      '<span class="save-label">' +
        '<svg class="save-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M21 12a9 9 0 1 1-6.2-8.55" opacity="0.85"/>' +
        '</svg>' +
        '<svg class="save-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<polyline points="20 6 9 17 4 12"/>' +
        '</svg>' +
        '<span class="save-label-text">Save</span>' +
      '</span>';

    btn.addEventListener('click', function () {
      if (btn.dataset.state === 'saving' || btn.dataset.state === 'saved') return;
      btn.dataset.state = 'saving';
      /* Simulate a network call. Real apps replace this with the actual save promise. */
      setTimeout(function () {
        btn.dataset.state = 'saved';
        toast('Deal saved', { kind: 'success', duration: 2500 });
        setTimeout(function () { delete btn.dataset.state; }, 1600);
      }, 700);
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     4. DIALOG-SAVE → CARD PULSE
     ────────────────────────────────────────────────────────────────────── */

  function bindDialogCardPulse() {
    document.querySelectorAll('dialog.app-dialog').forEach(function (dialog) {
      const saveBtn = dialog.querySelector('.btn-action');
      if (!saveBtn) return;
      saveBtn.addEventListener('click', function () {
        /* Identify the affected card by dialog id → button data-target match */
        const dialogId = dialog.id;
        const trigger = document.querySelector('[data-target="' + dialogId + '"]');
        if (!trigger) return;
        const card = trigger.closest('.card');
        if (!card) return;

        card.classList.add('card--just-updated');
        setTimeout(function () {
          card.classList.remove('card--just-updated');
        }, 1700);
      });
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     5. KPI ATTACHMENT COMPUTE — lowest non-zero our-layer attachment
     ──────────────────────────────────────────────────────────────────────
     The "attachment" point is implicit — it's the limit BELOW the our-layer
     entry in the program structure. For now we read the FIRST our-layer
     entry's limit-value above it as the floor, falling back to a default
     ladder (10M, 25M, 50M).                                                */

  function computeKPIAttachment() {
    const ourEntries = document.querySelectorAll('.limit-entry.our-layer-active');
    if (ourEntries.length === 0) return;

    /* Take the first our-layer entry. Real attachment logic would walk
       upstream entries, but for the v9 baseline this is a reasonable
       approximation that reads from one consistent place.                  */
    const first = ourEntries[0];
    const aggInput = first.querySelector('.aggregate-value');
    /* If the aggregate of underlying program is set, that's our attachment. */
    if (aggInput && aggInput.value) {
      const cleaned = aggInput.value.replace(/[^0-9.-]/g, '');
      const n = parseFloat(cleaned);
      if (isFinite(n) && n > 0) {
        const formatted = '$' + Math.round(n).toLocaleString('en-US');
        if (window.RQBI && window.RQBI.updateKPI) {
          window.RQBI.updateKPI('kpiAttachment', formatted);
        }
      }
    }
  }


  /* ──────────────────────────────────────────────────────────────────────
     6. KPI EMPHASIS — amber accent when our-layer-active exists
     ────────────────────────────────────────────────────────────────────── */

  function syncKPIEmphasis() {
    const strip = document.querySelector('.kpi-strip');
    if (!strip) return;
    const hasOurLayer = document.querySelector('.limit-entry.our-layer-active') !== null;
    strip.setAttribute('data-our-layer-active', hasOurLayer ? 'true' : 'false');
  }


  /* ──────────────────────────────────────────────────────────────────────
     7. ACTION MENU — close on focusout
     ────────────────────────────────────────────────────────────────────── */

  function bindActionMenuFocusOut() {
    const menu = document.getElementById('actionsMenu');
    const btn = document.getElementById('actionsBtn');
    if (!menu || !btn) return;

    /* When focus leaves the menu/button container entirely, close. */
    const container = btn.closest('.action-dropdown');
    if (!container) return;
    container.addEventListener('focusout', function (e) {
      /* relatedTarget is the new focus owner. If still inside container, ignore. */
      if (container.contains(e.relatedTarget)) return;
      menu.classList.remove('visible');
      btn.classList.remove('open');
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     8. LIFECYCLE → TOAST
     ────────────────────────────────────────────────────────────────────── */

  function bindLifecycleToToast() {
    const actionsMenu = document.getElementById('actionsMenu');
    if (!actionsMenu) return;
    actionsMenu.addEventListener('click', function (e) {
      const li = e.target.closest('li[data-status]');
      if (!li) return;
      const status = li.dataset.status;
      const verb = li.textContent.trim();
      const kind = status === 'Cancelled' ? 'warning' : 'info';
      toast(verb + ' — deal status set to ' + status, { kind: kind, duration: 2400 });
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     9. LIMITS SUMMARY FOOTER — totals across all entries
     ────────────────────────────────────────────────────────────────────── */

  function ensureLimitsSummaryFooter() {
    const card = document.querySelector('#risk-limits .card');
    if (!card) return null;
    let footer = card.querySelector('.limits-summary-footer');
    if (footer) return footer;
    footer = document.createElement('div');
    footer.className = 'limits-summary-footer';
    footer.innerHTML =
      '<div class="summary-cell"><span class="summary-label">Total Premium</span><span class="summary-value tabular" id="summaryTotalPremium">$0</span></div>' +
      '<div class="summary-cell"><span class="summary-label">Total Program Limit</span><span class="summary-value tabular" id="summaryTotalLimit">$0</span></div>' +
      '<div class="summary-cell summary-cell--our"><span class="summary-label">Our Premium</span><span class="summary-value tabular" id="summaryOurPremium">$0</span></div>' +
      '<div class="summary-cell summary-cell--our"><span class="summary-label">Our Layers</span><span class="summary-value tabular" id="summaryOurCount">0</span></div>';
    card.appendChild(footer);
    return footer;
  }

  function recomputeLimitsSummary() {
    ensureLimitsSummaryFooter();
    const fmt = function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };
    let totalPremium = 0, totalLimit = 0, ourPremium = 0, ourCount = 0;

    document.querySelectorAll('#risk-limits .limit-entry').forEach(function (entry) {
      const isOur = entry.classList.contains('our-layer-active');
      const premInputs = entry.querySelectorAll('.premium-value');
      const limitInputs = entry.querySelectorAll('.limit-value');

      premInputs.forEach(function (i) {
        const cleaned = (i.value || '').replace(/[^0-9.-]/g, '');
        const n = parseFloat(cleaned);
        if (isFinite(n)) {
          totalPremium += n;
          if (isOur) ourPremium += n;
        }
      });
      limitInputs.forEach(function (i) {
        const cleaned = (i.value || '').replace(/[^0-9.-]/g, '');
        const n = parseFloat(cleaned);
        if (isFinite(n)) totalLimit += n;
      });
      if (isOur) ourCount += 1;
    });

    const setText = function (id, txt) {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };
    setText('summaryTotalPremium', fmt(totalPremium));
    setText('summaryTotalLimit', fmt(totalLimit));
    setText('summaryOurPremium', fmt(ourPremium));
    setText('summaryOurCount', ourCount);
  }


  /* ──────────────────────────────────────────────────────────────────────
     10. CROSS-SECTION RECOMPUTE — debounced
     ────────────────────────────────────────────────────────────────────── */

  function bindCrossSectionRecompute() {
    const root = document.getElementById('pageContent');
    if (!root) return;
    let pending = false;
    function schedule() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        computeKPIAttachment();
        syncKPIEmphasis();
        recomputeLimitsSummary();
      });
    }
    root.addEventListener('input', schedule);
    root.addEventListener('change', schedule);
    /* First compute */
    requestAnimationFrame(schedule);
  }


  /* ──────────────────────────────────────────────────────────────────────
     INIT
     ────────────────────────────────────────────────────────────────────── */

  function init() {
    logBuildLabel();
    decorateSaveButton();
    bindDialogCardPulse();
    bindActionMenuFocusOut();
    bindLifecycleToToast();
    bindCrossSectionRecompute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }


  /* ──────────────────────────────────────────────────────────────────────
     PUBLIC API
     ────────────────────────────────────────────────────────────────────── */

  window.RQBI = window.RQBI || {};
  window.RQBI.BUILD = BUILD;
  window.RQBI.toast = toast;
  window.RQBI.recomputeLimitsSummary = recomputeLimitsSummary;
})();


/* ============================================================================
   parity.js · Speed to Market AI · RQBI Platform
   ============================================================================
   Restores v2.20 functionality that the v9 re-skin pass left behind.

   The session-1-through-9 modules built the visual + UX layer. This module
   plugs back in the WORKING-CLASS plumbing that the original underwriting
   workflow depends on:

     1. Loss table factory          — builds GL + Auto loss rows
     2. Year add/remove buttons     — for both loss tables
     3. Large-loss add/remove       — with header reveal/hide logic
     4. No-Losses checkbox          — disables all inputs in that table
     5. HomeState dropdown          — populated with 50 states + DC + 5 territories
     6. Add-coverage dropdowns      — populated from coverageTypes map
     7. Coverage cloning            — builds new entries on dropdown click
     8. updateLimitsVisibility      — Lead/Excess category visibility
     9. ISO class lookup            — sample map; populate with your full table
    10. State map (statute, dram)   — all 50 states with reasonable defaults
    11. Date auto-fills             — polEff→polExp (+1yr), subDate→today
    12. admission → paper           — Admitted vs Non-Admitted carrier names
    13. Currency formatter          — format-on-blur with commas
    14. Number formatter            — claim counts and similar
    15. Sidebar status sync         — pill class + text follows lifecycle

   Loaded LAST in the script chain, after every other module is wired.
   ============================================================================ */

(function () {
  'use strict';

  /* ──────────────────────────────────────────────────────────────────────
     1. LOSS TABLE FACTORY
     ────────────────────────────────────────────────────────────────────── */

  const CURRENT_YEAR = new Date().getFullYear();

  function makeYearOptions(selectedYear) {
    const opts = [];
    for (let y = CURRENT_YEAR; y >= CURRENT_YEAR - 10; y--) {
      const period = y + '-' + (y + 1);
      const sel = (y === selectedYear) ? ' selected' : '';
      opts.push('<option' + sel + '>' + period + '</option>');
    }
    return opts.join('');
  }

  function makeLossRow(yearOffset) {
    const year = CURRENT_YEAR - 1 - yearOffset;
    const div = document.createElement('div');
    div.className = 'loss-row';
    div.innerHTML =
      '<select class="policy-select">' + makeYearOptions(year) + '</select>' +
      '<div class="currency-wrap"><input type="text" class="currency-input" placeholder="0"></div>' +
      '<input type="text" placeholder="0">' +
      '<div class="currency-wrap"><input type="text" class="currency-input" placeholder="0"></div>' +
      '<div class="currency-wrap"><input type="text" class="currency-input" placeholder="0"></div>' +
      '<div class="currency-wrap"><input type="text" class="currency-input" placeholder="0"></div>' +
      '<input type="text" class="loss-date-picker" placeholder="Select date...">';
    return div;
  }

  function makeLargeLossRow() {
    const div = document.createElement('div');
    div.className = 'large-loss-row';
    div.innerHTML =
      '<select class="policy-select">' + makeYearOptions(CURRENT_YEAR - 1) + '</select>' +
      '<div class="currency-wrap"><input type="text" class="currency-input" placeholder="0"></div>' +
      '<div class="currency-wrap"><input type="text" class="currency-input" placeholder="0"></div>' +
      '<div class="currency-wrap"><input type="text" class="currency-input" placeholder="0"></div>' +
      '<textarea rows="2" placeholder="Description of loss..."></textarea>';
    return div;
  }

  function ensureLargeLossHeader(container) {
    /* Insert a header row before the first .large-loss-row if none exists */
    let header = container.querySelector('.large-loss-header');
    if (!header) {
      header = document.createElement('div');
      header.className = 'large-loss-header';
      header.innerHTML =
        '<span>Year</span><span>Paid $</span><span>Reserve $</span>' +
        '<span>Incurred $</span><span>Description</span>';
      container.insertBefore(header, container.firstChild);
    }
  }

  function setupLossTable(rowsId, largeRowsId, addYearId, removeYearId, addLargeId, removeLargeId, noLossesId) {
    const rowsContainer = document.getElementById(rowsId);
    const largeContainer = document.getElementById(largeRowsId);
    if (!rowsContainer) return;

    /* Build initial 5 rows if empty */
    if (!rowsContainer.querySelector('.loss-row')) {
      for (let i = 0; i < 5; i++) {
        rowsContainer.appendChild(makeLossRow(i));
      }
    }

    /* Add Year — prepends new row at the top with most-recent year selected */
    const addBtn = document.getElementById(addYearId);
    if (addBtn) addBtn.addEventListener('click', function () {
      const newRow = makeLossRow(-1);   /* CURRENT_YEAR */
      rowsContainer.insertBefore(newRow, rowsContainer.firstChild);
      initFlatpickrOn(newRow);
    });

    /* Remove Year — removes last row */
    const removeBtn = document.getElementById(removeYearId);
    if (removeBtn) removeBtn.addEventListener('click', function () {
      const last = rowsContainer.querySelector('.loss-row:last-child');
      if (last) last.remove();
    });

    /* Add Large Loss */
    const addLargeBtn = document.getElementById(addLargeId);
    if (addLargeBtn && largeContainer) addLargeBtn.addEventListener('click', function () {
      ensureLargeLossHeader(largeContainer);
      const row = makeLargeLossRow();
      largeContainer.appendChild(row);
      initFlatpickrOn(row);
    });

    /* Remove Large Loss — also removes header when zero rows remain */
    const removeLargeBtn = document.getElementById(removeLargeId);
    if (removeLargeBtn && largeContainer) removeLargeBtn.addEventListener('click', function () {
      const lastRow = largeContainer.querySelector('.large-loss-row:last-child');
      if (lastRow) lastRow.remove();
      if (!largeContainer.querySelector('.large-loss-row')) {
        const hdr = largeContainer.querySelector('.large-loss-header');
        if (hdr) hdr.remove();
      }
    });

    /* No-Losses checkbox — disables all inputs/selects in this table */
    const noLossesCb = document.getElementById(noLossesId);
    if (noLossesCb) noLossesCb.addEventListener('change', function () {
      rowsContainer.querySelectorAll('input, select').forEach(function (el) {
        el.disabled = noLossesCb.checked;
      });
      if (largeContainer) {
        largeContainer.querySelectorAll('input, select, textarea').forEach(function (el) {
          el.disabled = noLossesCb.checked;
        });
      }
    });

    /* Initialize flatpickr on existing dates */
    initFlatpickrOn(rowsContainer);
    if (largeContainer) initFlatpickrOn(largeContainer);
  }

  function initFlatpickrOn(root) {
    if (typeof flatpickr === 'undefined') return;
    root.querySelectorAll('input.loss-date-picker, input.large-loss-date, input.limit-date, input.date')
      .forEach(function (el) {
        if (el._flatpickr) return;
        flatpickr(el, { dateFormat: 'm/d/Y', allowInput: true, disableMobile: true });
      });
  }


  /* ──────────────────────────────────────────────────────────────────────
     5. HOMESTATE DROPDOWN POPULATION
     ────────────────────────────────────────────────────────────────────── */

  const STATES = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL',
    'IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE',
    'NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD',
    'TN','TX','UT','VT','VA','WA','WV','WI','WY',
    'PR','VI','GU','AS','MP'
  ];

  function populateHomeState() {
    const sel = document.getElementById('homeState');
    if (!sel || sel.options.length > 1) return;
    sel.innerHTML = '<option value="" disabled selected>— Select —</option>' +
      STATES.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join('');
  }


  /* ──────────────────────────────────────────────────────────────────────
     6. COVERAGE DROPDOWNS — populate + handle clone-on-click
     ────────────────────────────────────────────────────────────────────── */

  const COVERAGE_TYPES = {
    primary: [
      { key: 'gl',          label: 'General Liability' },
      { key: 'al',          label: 'Auto Liability' },
      { key: 'el',          label: 'Employers Liability' },
      { key: 'aircraft',    label: 'Aircraft Liability' },
      { key: 'ebl',         label: 'Employee Benefits Liability' },
      { key: 'garage',      label: 'Garage Liability' },
      { key: 'liquor',      label: 'Liquor Liability' },
      { key: 'stop-gap',    label: 'Stop Gap (EL)' },
      { key: 'watercraft',  label: 'Watercraft Liability' },
      { key: 'other',       label: 'Other Primary' }
    ],
    foreign: [
      { key: 'fgl',         label: 'Foreign General Liability' },
      { key: 'fal',         label: 'Foreign Auto Liability' },
      { key: 'fl-ebl',      label: 'Foreign EBL' },
      { key: 'fl-el',       label: 'Foreign Employers Liability' },
      { key: 'fl-products', label: 'Foreign Products' },
      { key: 'fl-prem',     label: 'Foreign Premises' },
      { key: 'fl-prodops',  label: 'Foreign Products/CompOps' }
    ],
    excess: [
      { key: 'lead-excess', label: 'Lead Excess' },
      { key: 'excess',      label: 'Excess' }
    ]
  };

  let cloneCounter = 0;

  /* Build a coverage entry programmatically. Generates a generic shape
     (Carrier + Dates + Limit/Aggregate/Premium); for excess types adds
     the layer-options-panel with Our-Layer checkbox.                       */
  function buildCoverageEntry(key, label, isExcess) {
    cloneCounter++;
    const detailsId = 'details-' + key + '-' + cloneCounter;
    const ourLayerHtml = isExcess
      ? '<label class="checkbox-label"><input type="checkbox" data-our-layer="' + key + '-' + cloneCounter + '"><span>Our Layer</span></label>'
      : '';
    const layerOptsHtml = isExcess
      ? '<div class="layer-options-panel">' +
          '<div class="grid grid-4">' +
            '<label>Commission (%)<input type="number" class="layer-commission" min="0" max="100" step="0.01" placeholder="0.00"></label>' +
            '<label>Adj. / Flat<select class="layer-adj-flat"><option>Adjustable</option><option>Flat</option></select></label>' +
            '<label>TRIA<select class="layer-tria-status"><option>Accepted</option><option>Declined</option></select></label>' +
            '<label>TRIA %<input type="number" class="layer-tria-pct" min="0" max="100" step="0.01" placeholder="0.00"></label>' +
          '</div>' +
          '<div class="grid grid-2">' +
            '<label>Min. Earned (%)<input type="number" class="layer-mep-pct" min="0" max="100" step="1" placeholder="0"></label>' +
            '<label>Min. Earned Premium<div class="currency-wrap"><input type="text" class="currency-input layer-mep-premium" readonly placeholder="0"></div></label>' +
          '</div>' +
        '</div>'
      : '';

    const entry = document.createElement('div');
    entry.className = 'limit-entry';
    entry.setAttribute('data-coverage-type', key);
    entry.innerHTML =
      '<div class="limit-entry-header">' +
        '<label class="checkbox-label"><input type="checkbox" data-target="' + detailsId + '"><span>' + label + '</span></label>' +
        '<div class="limit-entry-actions">' +
          ourLayerHtml +
          '<svg class="collapse-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>' +
          '<svg class="delete-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
        '</div>' +
      '</div>' +
      '<div id="' + detailsId + '" class="limit-details-panel">' +
        '<div class="grid grid-3">' +
          '<label>Carrier <input type="text" placeholder="Carrier Name"></label>' +
          '<label>Effective Date <input type="text" class="limit-date" placeholder="Select Date..."></label>' +
          '<label>Expiration Date <input type="text" class="limit-date" placeholder="Select Date..."></label>' +
        '</div>' +
        '<div class="grid grid-3">' +
          '<label>Limit <div class="currency-wrap"><input type="text" class="currency-input limit-value" placeholder="0"></div></label>' +
          '<label>Aggregate <div class="currency-wrap"><input type="text" class="currency-input aggregate-value" placeholder="0"></div></label>' +
          '<label>Premium <div class="currency-wrap"><input type="text" class="currency-input premium-value" placeholder="0"></div></label>' +
        '</div>' +
        layerOptsHtml +
      '</div>';
    return entry;
  }

  function setupAddCoverageDropdowns() {
    document.querySelectorAll('.add-coverage-wrapper').forEach(function (wrapper) {
      const category = wrapper.dataset.buttonType || wrapper.querySelector('.add-limit-btn').dataset.category;
      const targetListId = wrapper.dataset.targetListId;
      const targetList = document.getElementById(targetListId);
      const dropdown = wrapper.querySelector('.coverage-dropdown');
      const button = wrapper.querySelector('.add-limit-btn');
      if (!dropdown || !button || !targetList) return;

      /* Populate dropdown items */
      const items = COVERAGE_TYPES[category] || [];
      dropdown.innerHTML = items.map(function (it) {
        return '<li data-key="' + it.key + '" data-label="' + it.label + '">' + it.label + '</li>';
      }).join('');

      /* Toggle dropdown on button click */
      button.addEventListener('click', function (e) {
        e.stopPropagation();
        /* Close other open dropdowns */
        document.querySelectorAll('.coverage-dropdown.visible').forEach(function (d) {
          if (d !== dropdown) d.classList.remove('visible');
        });
        dropdown.classList.toggle('visible');
      });

      /* Click an item: clone-build entry, append to target list */
      dropdown.addEventListener('click', function (e) {
        const li = e.target.closest('li[data-key]');
        if (!li) return;
        const isExcess = (category === 'excess');
        const entry = buildCoverageEntry(li.dataset.key, li.dataset.label, isExcess);
        targetList.appendChild(entry);
        dropdown.classList.remove('visible');
        initFlatpickrOn(entry);
      });
    });

    /* Click outside any dropdown closes them all */
    document.addEventListener('click', function () {
      document.querySelectorAll('.coverage-dropdown.visible').forEach(function (d) {
        d.classList.remove('visible');
      });
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     8. updateLimitsVisibility — show/hide Lead/Excess categories
     ────────────────────────────────────────────────────────────────────── */

  function updateLimitsVisibility() {
    const sel = document.getElementById('layerType');
    if (!sel) return;
    const v = sel.value || '';
    const isLead = v.indexOf('Lead') === 0;
    const isExcess = v.indexOf('Excess') === 0;

    document.querySelectorAll('[data-visibility]').forEach(function (cat) {
      const mode = cat.dataset.visibility;
      let show = false;
      if (mode === 'lead-only')        show = isLead;
      else if (mode === 'lead-and-excess') show = isLead || isExcess;
      else if (mode === 'excess')       show = isExcess;
      else                              show = true;
      cat.style.display = show ? '' : 'none';
    });
  }

  function bindLimitsVisibility() {
    const sel = document.getElementById('layerType');
    if (!sel) return;
    sel.addEventListener('change', updateLimitsVisibility);
    updateLimitsVisibility();   /* initial */
  }


  /* ──────────────────────────────────────────────────────────────────────
     9. ISO CLASS LOOKUP
     ──────────────────────────────────────────────────────────────────────
     Sample data — populate with your full lookup when integrating.        */

  const ISO_LOOKUP = {
    /* construction / contractor classes — sample */
    '91577': { desc: 'Carpentry NOC',                      grade: '4' },
    '91585': { desc: 'Concrete Construction',              grade: '5' },
    '91746': { desc: 'Excavation NOC',                     grade: '5' },
    '95622': { desc: 'Plumbing - Commercial',              grade: '3' },
    '95625': { desc: 'Plumbing - Residential',             grade: '3' },
    '92215': { desc: 'General Contractor - Commercial',    grade: '5' },
    '92216': { desc: 'General Contractor - Residential',   grade: '6' },
    /* hospitality */
    '41668': { desc: 'Restaurants - Full Service',         grade: '3' },
    '41670': { desc: 'Restaurants - Fast Food',            grade: '2' },
    '45192': { desc: 'Hotels - Full Service',              grade: '3' },
    /* manufacturing */
    '55090': { desc: 'Manufacturing - Metal Goods',        grade: '4' },
    '55320': { desc: 'Manufacturing - Plastic Products',   grade: '4' }
    /* Add your full ISO class code map here */
  };

  function bindISOLookup() {
    const isoIn = document.getElementById('isoClass');
    const descIn = document.getElementById('isoDesc');
    const gradeIn = document.getElementById('hazardGrade');
    if (!isoIn) return;

    function lookup() {
      const code = (isoIn.value || '').trim();
      const hit = ISO_LOOKUP[code];
      if (hit) {
        if (descIn) descIn.value = hit.desc;
        if (gradeIn) gradeIn.value = hit.grade;
      }
    }
    isoIn.addEventListener('blur', lookup);
    isoIn.addEventListener('change', lookup);
  }


  /* ──────────────────────────────────────────────────────────────────────
     10. STATE MAPS — statute of repose + dram score
     ──────────────────────────────────────────────────────────────────────
     Reasonable defaults. Verify against your underwriting guidelines and
     adjust when integrating.                                                */

  const STATE_REPOSE = {
    AL: 7, AK: 10, AZ: 8, AR: 4, CA: 10, CO: 6, CT: 7, DE: 6, DC: 10,
    FL: 10, GA: 8, HI: 10, ID: 8, IL: 10, IN: 10, IA: 15, KS: 10, KY: 7,
    LA: 5, ME: 10, MD: 10, MA: 6, MI: 6, MN: 10, MS: 6, MO: 10, MT: 10,
    NE: 10, NV: 6, NH: 8, NJ: 10, NM: 10, NY: 10, NC: 6, ND: 10, OH: 10,
    OK: 10, OR: 10, PA: 12, RI: 10, SC: 8, SD: 10, TN: 4, TX: 10, UT: 9,
    VT: 6, VA: 5, WA: 6, WV: 10, WI: 7, WY: 10
  };

  const STATE_DRAM = {
    AL: 'High', AK: 'High', AZ: 'Medium', AR: 'Medium', CA: 'Low', CO: 'Medium',
    CT: 'High', DE: 'Low', FL: 'High', GA: 'Medium', IA: 'High', IL: 'High',
    LA: 'Medium', MA: 'High', NJ: 'High', NM: 'High', NY: 'High', OH: 'Medium',
    PA: 'High', TX: 'Low' /* Texas has limited dram shop */
    /* Default to "Medium" for any state not explicitly listed */
  };

  function bindStateAutoFills() {
    /* When mailingState OR homeState changes, update statRepose + dramScore */
    function applyState(state) {
      if (!state) return;
      const repose = STATE_REPOSE[state.toUpperCase()];
      const dram = STATE_DRAM[state.toUpperCase()] || 'Medium';
      const reposeIn = document.getElementById('statRepose');
      const dramIn = document.getElementById('dramScore');
      if (reposeIn && repose != null && !reposeIn.value) reposeIn.value = repose;
      if (dramIn && !dramIn.value) dramIn.value = dram;
    }
    const mailingState = document.getElementById('mailingState');
    const homeState = document.getElementById('homeState');
    if (mailingState) mailingState.addEventListener('change', function () { applyState(mailingState.value); });
    if (homeState) homeState.addEventListener('change', function () { applyState(homeState.value); });
  }


  /* ──────────────────────────────────────────────────────────────────────
     11. DATE AUTO-FILLS — polEff → polExp (+1yr), subDate → today
     ────────────────────────────────────────────────────────────────────── */

  function fmtDate(d) {
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
  }

  function bindDateAutoFills() {
    const polEff = document.getElementById('polEff');
    const polExp = document.getElementById('polExp');
    if (polEff && polExp) {
      polEff.addEventListener('change', function () {
        if (polExp.value) return;   /* respect existing value */
        const v = polEff.value;
        if (!v) return;
        const d = new Date(v);
        if (isNaN(d)) return;
        d.setFullYear(d.getFullYear() + 1);
        if (polExp._flatpickr) polExp._flatpickr.setDate(d, true);
        else polExp.value = fmtDate(d);
      });
    }

    const subDate = document.getElementById('subDate');
    if (subDate && !subDate.value) {
      const today = new Date();
      const todayStr = fmtDate(today);
      if (subDate._flatpickr) subDate._flatpickr.setDate(today, true);
      else subDate.value = todayStr;
    }

    const createDate = document.getElementById('createDate');
    if (createDate && !createDate.value) {
      const today = new Date();
      if (createDate._flatpickr) createDate._flatpickr.setDate(today, true);
      else createDate.value = fmtDate(today);
    }
  }


  /* ──────────────────────────────────────────────────────────────────────
     12. admission → paper auto-fill
     ──────────────────────────────────────────────────────────────────────
     Toggling between Admitted and Non-Admitted swaps the carrier name.
     Generic placeholders — replace with your actual carrier names.        */

  const PAPER_NAMES = {
    admitted: 'Admitted Carrier Name',         /* replace with your admitted paper */
    nonAdmitted: 'Non-Admitted Carrier Name'   /* replace with your non-admitted paper */
  };

  function bindAdmissionAutoFill() {
    const adm = document.getElementById('admission');
    const paper = document.getElementById('paper');
    if (!adm || !paper) return;
    adm.addEventListener('change', function () {
      const v = adm.value;
      if (PAPER_NAMES[v]) paper.value = PAPER_NAMES[v];
    });
  }


  /* ──────────────────────────────────────────────────────────────────────
     13. CURRENCY + 14. NUMBER FORMATTERS
     ──────────────────────────────────────────────────────────────────────
     Format on blur; strip commas on focus so user can edit cleanly.       */

  function fmtNumber(s) {
    const cleaned = String(s).replace(/[^0-9.-]/g, '');
    if (cleaned === '' || cleaned === '-') return '';
    const n = parseFloat(cleaned);
    if (!isFinite(n)) return '';
    /* Preserve decimals if present */
    if (cleaned.indexOf('.') >= 0) {
      return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
    }
    return n.toLocaleString('en-US');
  }

  function bindCurrencyFormatter() {
    const root = document.body;
    /* Format on blur */
    root.addEventListener('blur', function (e) {
      if (!e.target.matches('.currency-input, .loss-row input[type="text"]:not(.policy-select):not(.loss-date-picker)')) return;
      if (e.target.classList.contains('loss-date-picker')) return;
      e.target.value = fmtNumber(e.target.value);
    }, true);

    /* Optional: strip commas on focus for easier editing */
    root.addEventListener('focus', function (e) {
      if (!e.target.matches('.currency-input')) return;
      const v = e.target.value || '';
      if (v.indexOf(',') >= 0) {
        e.target.value = v.replace(/,/g, '');
      }
    }, true);
  }


  /* ──────────────────────────────────────────────────────────────────────
     15. SIDEBAR STATUS SYNC — pill class + text follow lifecycle
     ────────────────────────────────────────────────────────────────────── */

  function bindSidebarStatusSync() {
    const lifecyclePill = document.getElementById('lifecycleStatusPill');
    const sidebarStatus = document.getElementById('statusText');
    if (!lifecyclePill || !sidebarStatus) return;

    /* Mirror the lifecycle pill into the sidebar pill — same class + text */
    function sync() {
      sidebarStatus.textContent = lifecyclePill.textContent;
      sidebarStatus.className = lifecyclePill.className.replace('lifecycle-status-pill', '') + ' sidebar-stat-value';
    }

    /* Initial */
    sync();

    /* Watch lifecycle pill for class/text changes */
    const observer = new MutationObserver(sync);
    observer.observe(lifecyclePill, { attributes: true, childList: true, characterData: true, subtree: true });
  }


  /* ──────────────────────────────────────────────────────────────────────
     INIT
     ────────────────────────────────────────────────────────────────────── */

  function init() {
    /* Build loss tables */
    setupLossTable('glLossRows',   'glLargeLossRows',   'addGlYear',   'removeGlYear',   'addGlLargeLoss',   'removeGlLargeLoss',   'noLossesGlChk');
    setupLossTable('autoLossRows', 'autoLargeLossRows', 'addAutoYear', 'removeAutoYear', 'addAutoLargeLoss', 'removeAutoLargeLoss', 'noLossesAutoChk');

    populateHomeState();
    setupAddCoverageDropdowns();
    bindLimitsVisibility();
    bindISOLookup();
    bindStateAutoFills();
    bindDateAutoFills();
    bindAdmissionAutoFill();
    bindCurrencyFormatter();
    bindSidebarStatusSync();

    /* Recompute KPIs and loss totals once tables are populated */
    requestAnimationFrame(function () {
      if (window.RQBI && window.RQBI.recomputeKPIs) window.RQBI.recomputeKPIs();
      if (window.RQBI && window.RQBI.recomputeLossTotals) window.RQBI.recomputeLossTotals();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    /* Small delay so flatpickr (loaded via CDN script) has time to define itself */
    setTimeout(init, 50);
  }


  /* Public API */
  window.RQBI = window.RQBI || {};
  window.RQBI.updateLimitsVisibility = updateLimitsVisibility;
  window.RQBI.populateHomeState = populateHomeState;
  window.RQBI.STATES = STATES;
  window.RQBI.COVERAGE_TYPES = COVERAGE_TYPES;
  window.RQBI.ISO_LOOKUP = ISO_LOOKUP;
  window.RQBI.STATE_REPOSE = STATE_REPOSE;
  window.RQBI.STATE_DRAM = STATE_DRAM;
})();


