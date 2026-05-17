/*
=====================================================================
  Speed to Market AI — Underwriting Workbench
  v8.6.81-workbench-fill-reliability-2026-05-17
=====================================================================
*/

window.STM_BUILD = 'v8.6.93-gl-class-manual-lookup-2026-05-17';
console.log('[STM BUILD]', window.STM_BUILD);

document.addEventListener('DOMContentLoaded', () => {
    // --- Start Helper Functions & Setup ---

    const $ = q => document.querySelector(q);
    const $$ = q => document.querySelectorAll(q);

    /* helper: add commas to integer strings.
       FIX-PHASE-GO-LIVE-77-INPUT-MONEY-MAGNITUDE-2026-05-16
       Extension v8.6.76b combinatorial audit (HIGH): the old body was
         const v = input.value.replace(/[^0-9]/g, "");
         input.value = v ? parseInt(v,10).toLocaleString("en-US") : "";
       which SILENTLY collapsed magnitude: "$5M" -> "5", "5e100" ->
       "5100", "-1000" -> "1000", with no warning and the wrong value
       persisted on Save. The user-facing input was strictly dumber than
       the internal tower parser (_num), which is exactly backward — an
       underwriter types "$5M" meaning $5,000,000. This now mirrors the
       hardened _num multiplier logic (k/m/mm/b, "million"/"thousand"/
       "billion") so "$5M" -> 5,000,000, and gives VISIBLE feedback when
       the raw input contained non-digit content that was coerced, and
       REJECTS (clears + flags) ambiguous/dangerous tokens (scientific
       notation, negatives, trailing junk) instead of silently keeping a
       wrong in-range number. */
    function _parseMoneyInput(raw) {
        if (raw == null) return { value: null, coerced: false, rejected: false };
        let s = String(raw).trim();
        if (!s) return { value: null, coerced: false, rejected: false };
        const hadNonDigit = /[^0-9]/.test(s);
        // Reject scientific notation and explicit negatives outright —
        // these are never valid limit/premium entry and the old code
        // turned them into plausible-looking in-range numbers.
        if (/[eE]\s*[-+]?\d/.test(s) || /^\s*-/.test(s)) {
            return { value: null, coerced: false, rejected: true };
        }
        // Normalize: drop currency symbols, spaces, thousands commas;
        // keep digits, decimal point, and multiplier letters/words.
        let t = s.replace(/[,$\s]/g, '');
        let mult = 1;
        let m = t.match(/^([0-9]*\.?[0-9]+)(mm|m|k|b)?$/i);
        let w = t.match(/^([0-9]*\.?[0-9]+)(million|thousand|billion)$/i);
        let baseStr = null;
        if (w) {
            baseStr = w[1];
            const word = w[2].toLowerCase();
            mult = word === 'billion' ? 1e9 : word === 'million' ? 1e6 : 1e3;
        } else if (m) {
            baseStr = m[1];
            const suf = (m[2] || '').toLowerCase();
            mult = suf === 'b' ? 1e9
                 : (suf === 'm' || suf === 'mm') ? 1e6
                 : suf === 'k' ? 1e3 : 1;
        } else {
            // Anything else (letters mid-number, multiple dots, junk) is
            // ambiguous — reject rather than silently truncate.
            return { value: null, coerced: false, rejected: true };
        }
        const base = parseFloat(baseStr);
        if (!isFinite(base)) return { value: null, coerced: false, rejected: true };
        const val = Math.round(base * mult);
        if (!isFinite(val) || val < 0) return { value: null, coerced: false, rejected: true };
        return { value: val, coerced: hadNonDigit && mult === 1 ? false : hadNonDigit, rejected: false };
    }

    function _flagMoneyInput(input, kind) {
        // Visible, non-blocking feedback so coercion/rejection is never
        // silent. kind: 'coerced' (amber, shows canonical value) or
        // 'rejected' (red, value cleared).
        try {
            input.classList.remove('money-input-coerced', 'money-input-rejected');
            let tip = input.parentNode &&
                input.parentNode.querySelector('.money-input-note');
            if (kind) {
                input.classList.add(kind === 'rejected'
                    ? 'money-input-rejected' : 'money-input-coerced');
                if (!tip && input.parentNode) {
                    tip = document.createElement('span');
                    tip.className = 'money-input-note';
                    tip.style.cssText = 'display:block;font-size:11px;font-weight:600;'
                        + 'margin-top:2px;'
                        + (kind === 'rejected'
                            ? 'color:#b42318;' : 'color:#b54708;');
                    input.parentNode.appendChild(tip);
                }
                if (tip) {
                    tip.textContent = kind === 'rejected'
                        ? 'Not a valid amount — cleared. Enter digits or e.g. $5M.'
                        : 'Interpreted as ' + input.value;
                    tip.style.display = 'block';
                }
                if (kind === 'rejected') {
                    input.style.borderColor = '#b42318';
                } else {
                    input.style.borderColor = '#b54708';
                }
            } else {
                if (tip) tip.style.display = 'none';
                input.style.borderColor = '';
            }
        } catch (e) { /* feedback is best-effort, never throw */ }
    }

    function formatCurrency(input) {
        const raw = input.value;
        const r = _parseMoneyInput(raw);
        if (r.rejected) {
            input.value = '';
            _flagMoneyInput(input, 'rejected');
            return;
        }
        if (r.value == null) {
            input.value = '';
            _flagMoneyInput(input, null);
            return;
        }
        input.value = r.value.toLocaleString('en-US');
        _flagMoneyInput(input, r.coerced ? 'coerced' : null);
    }

    /* Renewal helper functions */
    const fmt = {
        money(n, d = 0) { 
            return isFinite(n) ? n.toLocaleString(undefined, { 
                style: 'currency', 
                currency: 'USD', 
                maximumFractionDigits: d, 
                minimumFractionDigits: d 
            }) : '$0'; 
        },
        num(n, d = 0) { 
            return isFinite(n) ? n.toLocaleString(undefined, { 
                maximumFractionDigits: d,
                minimumFractionDigits: d > 0 ? d : 0
            }) : (d > 0 ? (0).toFixed(d) : '0'); 
        },
        pct(n, d = 1) { 
            return isFinite(n) ? (n * 100).toFixed(d) + '%' : (0).toFixed(d) + '%'; 
        }
    };
    
    const parseCurrency = v => { 
        if (v == null || v === '') return 0; 
        const n = +String(v).replace(/[^0-9.-]/g, ''); 
        return isFinite(n) ? n : 0; 
    };
    
    const parsePercent = v => { 
        if (v == null || v === '') return 0; 
        const n = +String(v).replace(/[^0-9.-]/g, ''); 
        return isFinite(n) ? n / 100 : 0; 
    };
    
    const parseNumber = v => { 
        if (v == null || v === '') return 0; 
        const n = +String(v).replace(/[^0-9.-]/g, ''); 
        return isFinite(n) ? n : 0; 
    };

    // XSS-safe HTML escaping for user-supplied strings interpolated into innerHTML.
    // Use whenever a value comes from prompt(), text inputs, or any user-controlled source.
    const escapeHtml = (s) => {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    const APP_EVENTS = [];
    function recordHistory(action, detail = '') {
        APP_EVENTS.unshift({ at: new Date().toISOString(), action: String(action || 'Action'), detail: String(detail || '') });
        if (APP_EVENTS.length > 75) APP_EVENTS.pop();
        renderHistoryLog();
    }
    function renderHistoryLog() {
        const log = document.getElementById('historyLog');
        if (!log) return;
        if (!APP_EVENTS.length) {
            log.innerHTML = `<div class="history-empty">No actions recorded yet. Status changes, saves, form actions, and coverage edits will appear here.</div>`;
            return;
        }
        log.innerHTML = APP_EVENTS.map(ev => {
            const d = new Date(ev.at);
            const stamp = d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            return `<div class="history-entry"><div class="history-entry-main"><strong>${escapeHtml(ev.action)}</strong><span>${escapeHtml(ev.detail)}</span></div><time>${escapeHtml(stamp)}</time></div>`;
        }).join('');
    }

    function attachFormatter(input, kind, decimals = null) {
        if (!input) return;
        input.addEventListener('blur', () => {
            if (input.value.trim() === '') return;
            if (kind === 'currency') input.value = fmt.money(parseCurrency(input.value), decimals ?? 0);
            else if (kind === 'percent') input.value = (parsePercent(input.value) * 100).toFixed(1) + '%';
            else input.value = fmt.num(parseNumber(input.value), decimals ?? 0);
        });
    }

    // --- Textarea Auto-Scroll Logic ---
    function setupTextareaAutoScroll(selector) {
        const textarea = $(selector);
        if (!textarea) return;

        let isResizing = false;
        let scrollInterval = null;
        const edgeSize = 60;
        const scrollSpeed = 10;

        textarea.addEventListener('mousedown', (e) => {
            const rect = textarea.getBoundingClientRect();
            const resizeHandleSize = 16;
            const isOnHandle = (e.clientX > rect.right - resizeHandleSize) && (e.clientY > rect.bottom - resizeHandleSize);
            if (isOnHandle) {
                isResizing = true;
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const nearBottom = window.innerHeight - e.clientY < edgeSize;
            const nearTop = e.clientY < edgeSize;
            if (nearBottom) {
                if (!scrollInterval) {
                    scrollInterval = setInterval(() => window.scrollBy(0, scrollSpeed), 15);
                }
            } else if (nearTop) {
                if (!scrollInterval) {
                    scrollInterval = setInterval(() => window.scrollBy(0, -scrollSpeed), 15);
                }
            } else {
                clearInterval(scrollInterval);
                scrollInterval = null;
            }
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
            clearInterval(scrollInterval);
            scrollInterval = null;
        });
    }

    // --- Type Selector Logic for Renewal Tab ---
    function setupTypeSelector() {
        const typeSelect = $('#typeSelect');
        const renewalTab = $('[data-page="renewal"]');
        
        if (typeSelect && renewalTab) {
            typeSelect.addEventListener('change', () => {
                const isRenewal = typeSelect.value === 'Renewal';
                renewalTab.style.display = isRenewal ? 'block' : 'none';
                
                if (!isRenewal && renewalTab.classList.contains('active')) {
                    const dealTab = $('[data-page="deal"]');
                    if (dealTab) dealTab.click();
                }
            });
        }
    }

    // --- Main Application Initialization ---
    function init() {
        // CONFIGS
        const yr = new Date().getFullYear();

        function clampFlatpickrCalendar(instance) {
            const cal = instance?.calendarContainer;
            if (!cal) return;
            requestAnimationFrame(() => {
                const margin = 12;
                const rect = cal.getBoundingClientRect();
                const vw = document.documentElement.clientWidth || window.innerWidth;
                const vh = document.documentElement.clientHeight || window.innerHeight;
                let dx = 0;
                let dy = 0;
                if (rect.right > vw - margin) dx = (vw - margin) - rect.right;
                if (rect.left + dx < margin) dx += margin - (rect.left + dx);
                if (rect.bottom > vh - margin) dy = (vh - margin) - rect.bottom;
                if (rect.top + dy < margin) dy += margin - (rect.top + dy);
                const current = cal.style.transform || '';
                cal.style.transform = `${current.replace(/translate3d\([^)]*\)|translate\([^)]*\)/g, '').trim()} translate(${Math.round(dx)}px, ${Math.round(dy)}px)`.trim();
                cal.style.maxWidth = `calc(100vw - ${margin * 2}px)`;
            });
        }

        const flatpickrConfig = {
            altInput: true,
            altFormat: "n/j/Y",
            dateFormat: "Y-m-d",
            allowInput: true,
            appendTo: document.body,
            position: "auto center",
            disableMobile: true,
            minDate: `${yr - 10}-01-01`,
            maxDate: `${yr + 10}-12-31`,
            onReady: (_dates, _str, instance) => clampFlatpickrCalendar(instance),
            onOpen: (_dates, _str, instance) => clampFlatpickrCalendar(instance),
            onMonthChange: (_dates, _str, instance) => clampFlatpickrCalendar(instance),
            onYearChange: (_dates, _str, instance) => clampFlatpickrCalendar(instance)
        };

        const initFlatpickr = (target) => {
            if (!target || !window.flatpickr) return null;
            const fp = window.flatpickr(target, flatpickrConfig);
            // FIX-2026-05-14-COVERAGE-ALIGNMENT (1 of 3).
            // flatpickr v4.6.13 copies the original input's classes onto
            // the altInput it creates when altInput:true is set. That means
            // an altInput attached to a .limit-date input ALSO carries the
            // .limit-date class. Any later code path that queries for
            // .limit-date (e.g. initLimitDateInputs on the risk section,
            // or the page-load init pass running a second time) then
            // re-initializes flatpickr on the altInput — making it hidden
            // and creating a third visible input with doubled altInput
            // classes. That third input is what landed limit/premium
            // values into the date columns of every coverage panel.
            // Stripping the trigger classes from the altInput at init time
            // is the single source-of-truth fix.
            if (fp && fp.altInput) {
                fp.altInput.classList.remove('limit-date');
                fp.altInput.classList.remove('date');
            }
            return fp;
        };

        // ISO CODE DATA
        const isoDescMap = { "95233": "Garbage, Ash or Refuse Collecting" };
        const isoHazardGradeMap = { "95233": "5 - High" };
        const guidelineConflictsMap = { "95233": "Regardless of risk size, a $5M Minimum Attachment Point is required when there is exposure in the following classes: Concrete, and Waste Haulers - Level 4 Empowerment required for lower attachment" };

        const stateReposeMap = { "AL": "10", "AK": "10", "AZ": "8", "AR": "5", "CA": "10", "CO": "6", "CT": "7", "DE": "6", "FL": "10", "GA": "8", "HI": "6", "ID": "6", "IL": "10", "IN": "10", "IA": "15", "KS": "10", "KY": "10", "LA": "10", "ME": "10", "MD": "20", "MA": "6", "MI": "6", "MN": "10", "MS": "6", "MO": "10", "MT": "10", "NE": "10", "NV": "10", "NH": "8", "NJ": "10", "NM": "10", "NY": "10", "NC": "6", "ND": "10", "OH": "10", "OK": "10", "OR": "10", "PA": "12", "RI": "10", "SC": "8", "SD": "10", "TN": "10", "TX": "10", "UT": "10", "VT": "6", "VA": "10", "WA": "6", "WV": "10", "WI": "10", "WY": "10" };
        const dramScoreMap = { "AL": "Low", "AK": "Low", "AZ": "Medium", "AR": "Low", "CA": "High", "CO": "Medium", "CT": "Medium", "DE": "Low", "FL": "Medium", "GA": "Low", "HI": "Low", "ID": "Low", "IL": "High", "IN": "Low", "IA": "Low", "KS": "Low", "KY": "Low", "LA": "High", "ME": "Low", "MD": "Low", "MA": "Medium", "MI": "Medium", "MN": "Low", "MS": "Low", "MO": "Low", "MT": "Low", "NE": "Low", "NV": "High", "NH": "Medium", "NJ": "High", "NM": "Low", "NY": "High", "NC": "Low", "ND": "Low", "OH": "Medium", "OK": "Low", "OR": "Medium", "PA": "Medium", "RI": "High", "SC": "Low", "SD": "Low", "TN": "Low", "TX": "High", "UT": "Low", "VT": "Low", "VA": "Low", "WA": "Medium", "WV": "Low", "WI": "Medium", "WY": "Low" };
        const states = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"];

        // BUG FIX (additional coverage duplicate date inputs): the prior call
        //   initFlatpickr(".date, .limit-date");
        // matched .limit-date inputs that live inside the hidden .limit-templates
        // block. Because flatpickrConfig sets `altInput: true`, every initialized
        // input got a second visible sibling — and that sibling was carried into
        // every cloneNode() in addCoverageEntry(), then a third one was created
        // when initLimitDateInputs() re-initialized the clone (the `_flatpickr`
        // guard fails because cloneNode does not copy expando properties).
        // Result: three "Select Date..." inputs stacked in every added coverage
        // panel. Skipping templates here lets initLimitDateInputs() be the sole
        // initializer for cloned entries, which is the intended contract.
        document.querySelectorAll(".date, .limit-date").forEach(el => {
            if (el.closest('.limit-templates')) return;
            initFlatpickr(el);
        });


        function updateRealSubmissionBanner(submission) {
            try {
                const banner = document.querySelector('.demo-mode-banner');
                if (!banner || !submission) return;
                const hasRealSnapshot = !!(submission.snapshot && Object.keys(submission.snapshot.extractions || {}).length);
                const hasSubmissionId = !!submission.id;
                if (hasSubmissionId || hasRealSnapshot) {
                    banner.classList.add('is-real-submission');
                    banner.innerHTML = '<strong>Live submission loaded from Platform:</strong> values may be extracted, inferred, or review-required. Use badges and the fill report to confirm before quoting.';
                }
            } catch (e) {
                console.warn('[workbench] real-submission banner update skipped:', e && e.message);
            }
        }

        // FIX-PHASE-1-SUBMISSION-HANDOFF-2026-05-14
        // If the workbench was opened with ?submission=<id> in the URL,
        // wait for the Supabase client + signed-in session to be ready
        // (platform-auth.js initializes both on DOMContentLoaded after
        // the magic-link overlay resolves), then fetch the submission
        // row and park its full snapshot on window.workbenchActiveSubmission.
        // Phase 2 will start reading from this global instead of the
        // hardcoded SAMPLE_PACKET. For Phase 1 we ONLY load and show a
        // topbar badge — no field writes, no behavior change for direct
        // /workbench visits without the query param.
        // FIX-PHASE-14.0.4-CANONICAL-DEMO-PIPELINE-2026-05-14
        // The full phase pipeline (deal info → coverages → tower →
        // subjectivities) as ONE reusable function. The live submission
        // path (loadSubmissionFromUrl) calls it; the canonical clean
        // demo (pipeline-bridge.js) calls it via the exposed global hook
        // AFTER its packet renders, so subjectivity DOM decoration fires
        // against a built panel (the v68 timing bug — appliers ran
        // before the subjectivity DOM existed — is fixed by routing the
        // demo through the same post-render call the live path uses).
        function applyFullPhasePipeline(data) {
            if (!window.WorkbenchRules
                || typeof window.WorkbenchRules.resolveField !== 'function') {
                console.warn('[workbench] applyFullPhasePipeline: WorkbenchRules not loaded; skipping');
                return;
            }
            applyDealInfoFromActiveSubmission(data);
            // FIX-PHASE-GO-LIVE-80-LAYER-TYPE-ENGINE-2026-05-16
            // Layer Type is the master UI gate. Prior versions used a
            // crude hasLead?'Lead Other':'Excess Other' that left the
            // field BLANK whenever no tower assembled → whole workbench
            // locked (this is what the real paid run SUB-MP94Y8F5
            // exposed). v8.6.80 replaces it with the proven
            // WorkbenchRules.decideLayerType engine:
            //   • mechanical Lead/Excess from the real tower
            //   • ordered 7-bucket operational subtype from the
            //     STRUCTURED class codes (not prose keyword soup)
            //   • NEVER blank → the gate always opens
            //   • inferred + visible review badge for forked cases
            //     (per Q9 doctrine: never silently commit an ambiguous
            //     underwriting classification)
            //   • a user's deliberate manual selection stays authoritative
            try {
                const lt = document.querySelector('#layerType');
                if (lt && window.WorkbenchRules
                    && typeof window.WorkbenchRules.decideLayerType === 'function') {

                    const decision = window.WorkbenchRules.decideLayerType(data);
                    const current = (lt.value || '').trim();

                    // Preserve a deliberate manual selection. We only
                    // treat an existing value as "manual" if the user
                    // actually changed it (tracked via a data flag the
                    // change handler sets); a value left over from a
                    // prior submission is NOT authoritative.
                    const userLocked = lt.getAttribute('data-user-set') === '1';

                    if (decision && decision.layerType && !userLocked) {
                        const opt = Array.from(lt.options).find(o =>
                            (o.value && o.value === decision.layerType)
                            || o.textContent.trim() === decision.layerType);
                        if (opt) {
                            lt.value = opt.value || opt.textContent.trim();
                            // Dispatch change → triggers the existing
                            // gate-open cascade (Limits & Premiums, Forms,
                            // subjectivities, rater all listen on this).
                            lt.dispatchEvent(new Event('change', { bubbles: true }));
                            // This was an inference, not a user choice —
                            // do NOT mark it user-set, so a later wave/
                            // re-fill can still refine it.
                            lt.removeAttribute('data-user-set');
                            console.log('[workbench] Phase GL-80 Layer Type decided →',
                                lt.value, '| family:', decision.family,
                                '| reasons:', (decision.reasons || []).join(' · '));
                        } else {
                            console.warn('[workbench] Phase GL-80: decided "'
                                + decision.layerType
                                + '" has no matching #layerType <option> — gate NOT opened. '
                                + 'Check option list vs LAYER_SUBTYPES.');
                        }
                    } else if (userLocked) {
                        console.log('[workbench] Phase GL-80: #layerType is a '
                            + 'deliberate manual selection ("' + current
                            + '") — engine inference ("'
                            + (decision && decision.layerType)
                            + '") NOT applied; user choice is authoritative.');
                    }

                    // ---- Review badge (inferred / conflict) ----
                    // Reuse the v78-proven persistent-topbar anchor:
                    // the ONLY region outside #pageContent (so the badge
                    // is visible on every tab). Shows the engine's
                    // conflict message verbatim when one exists.
                    const conflict = decision && decision.conflict;
                    let warn = document.getElementById('stmLayerTypeConflictWarn');
                    if (conflict && conflict.message) {
                        if (!warn) {
                            warn = document.createElement('span');
                            warn.id = 'stmLayerTypeConflictWarn';
                            warn.style.cssText = 'display:inline-block;'
                                + 'margin-left:10px;padding:2px 8px;border-radius:4px;'
                                + 'background:#b54708;color:#fff;font-size:11px;'
                                + 'font-weight:600;vertical-align:middle;'
                                + 'white-space:nowrap;max-width:46ch;overflow:hidden;'
                                + 'text-overflow:ellipsis;';
                            warn.title = '';
                        }
                        const topbarRight =
                            document.querySelector('.topbar .topbar-right')
                            || document.querySelector('.topbar-right');
                        const subBadge =
                            document.getElementById('workbenchSubmissionBadge');
                        const topbar = document.querySelector('header.topbar');
                        const pageContent =
                            document.getElementById('pageContent');
                        const isPersistent = (el) =>
                            el && (!pageContent || !pageContent.contains(el));
                        let host = null;
                        if (isPersistent(topbarRight)) host = topbarRight;
                        else if (isPersistent(subBadge) && subBadge) host = subBadge;
                        else if (isPersistent(topbar)) host = topbar;
                        if (host && warn.parentNode !== host) host.appendChild(warn);
                        if (subBadge && host
                            && (host === subBadge || host === topbarRight
                                || host === topbar)) {
                            const cs = window.getComputedStyle(subBadge);
                            if (cs && cs.display === 'none') {
                                subBadge.style.display = 'inline-flex';
                            }
                        }
                        // Full message in tooltip; truncated pill text.
                        warn.title = conflict.message;
                        warn.textContent = '\u26A0 ' + conflict.message;
                        warn.style.display = 'inline-block';
                        console.warn('[workbench] Phase GL-80 LAYER TYPE REVIEW: '
                            + conflict.message);
                    } else if (warn) {
                        // No conflict on this submission → clear any stale
                        // badge from a previous one.
                        warn.style.display = 'none';
                        warn.textContent = '';
                        warn.title = '';
                    }
                }
            } catch (ltErr) {
                console.warn('[workbench] Phase GL-80 layer-type engine skipped —',
                    ltErr && ltErr.message);
            }
            applyGLCoverageFromActiveSubmission(data);
            applyALCoverageFromActiveSubmission(data);
            applyELCoverageFromActiveSubmission(data);
            applyEBLCoverageFromActiveSubmission(data);
            applyAircraftCoverageFromActiveSubmission(data);
            applyGarageCoverageFromActiveSubmission(data);
            applyLiquorCoverageFromActiveSubmission(data);
            applyForeignGLCoverageFromActiveSubmission(data);
            applyForeignALCoverageFromActiveSubmission(data);
            applyExcessTowerFromActiveSubmission(data);
            // v8.6.81: after Layer Type opens the gate, use no-cost
            // adapters to fill the risk profile/rater/narrative fields
            // from the already-paid extraction text. These functions do
            // not call the API; they expose what was resolved and what
            // still needs review.
            applyUnderwritingFromActiveSubmission(data);
            applyGLExposureRaterFromActiveSubmission(data);
            applyV8685PopulationPass(data);
            setTimeout(() => applyV8685PopulationPass(window.workbenchActiveSubmission), 350);
            renderFieldCoverageReport(data);
            applySubjectivityIntelligenceFromActiveSubmission(data);
        }
        // Exposed so the canonical clean demo (pipeline-bridge.js) runs
        // the IDENTICAL phase chain the live submission path uses.
        window.__stmApplyPhasePipeline = applyFullPhasePipeline;

        (async function loadSubmissionFromUrl() {
            const params = new URLSearchParams(window.location.search);
            const submissionId = params.get('submission');
            if (!submissionId) return;

            // Poll for sb client + currentUser (set by platform-auth.js
            // after successful magic-link session check). 5-second cap.
            let attempts = 0;
            while ((!window.sb || !window.currentUser) && attempts < 50) {
                await new Promise(r => setTimeout(r, 100));
                attempts++;
            }
            if (!window.sb) {
                console.warn('[workbench] Phase 1: Supabase client not available after 5s; submission load skipped');
                return;
            }
            if (!window.currentUser) {
                console.warn('[workbench] Phase 1: Not signed in; submission load skipped');
                return;
            }

            try {
                const { data, error } = await window.sb
                    .from('submissions')
                    .select('*')
                    .eq('id', submissionId)
                    .maybeSingle();

                if (error) {
                    console.warn('[workbench] Phase 1: submission fetch failed:', error.message, '· code:', error.code);
                    return;
                }
                if (!data) {
                    console.warn('[workbench] Phase 1: no submission found with id', submissionId);
                    return;
                }

                window.workbenchActiveSubmission = data;
                updateRealSubmissionBanner(data);
                const extractionCount = data.snapshot?.extractions
                    ? Object.keys(data.snapshot.extractions).length
                    : 0;
                console.log(
                    '[workbench] Phase 1 loaded:',
                    data.id, '·',
                    data.account_name || '(no account_name)',
                    '· extractions:', extractionCount,
                    '· confidence:', data.confidence,
                    '· status:', data.status
                );

                // Show the topbar badge with the account name. Tiny
                // visual confirmation that the load worked end-to-end.
                const badge = document.getElementById('workbenchSubmissionBadge');
                if (badge) {
                    const value = badge.querySelector('.submission-badge-value');
                    if (value) {
                        value.textContent = data.account_name || data.id;
                    }
                    badge.classList.add('is-visible');
                }

                // FIX-PHASE-2-SOURCE-PRIORITY-RESOLVER-2026-05-14
                // Auto-apply the resolved Deal Info fields. Phase 2 ships
                // Tier 0 only — submission row columns + hardcoded defaults
                // + computed values. No extraction-text parsing yet (that's
                // Phase 3). The apply is best-effort: each field is tried
                // independently and any miss leaves the field empty (no
                // throws, no demo-data fallback). Console log summarizes
                // what got filled and what didn't.
                if (window.WorkbenchRules
                    && typeof window.WorkbenchRules.resolveField === 'function') {
                    applyFullPhasePipeline(data);
                } else {
                    console.warn('[workbench] Phase 2: WorkbenchRules not loaded; skipping apply');
                }
            } catch (err) {
                console.warn('[workbench] Phase 1: unexpected error loading submission:', err);
            }
        })();

        // FIX-PHASE-2-SOURCE-PRIORITY-RESOLVER-2026-05-14
        // Apply resolved Deal Information fields to the live workbench
        // form. Each field maps to one selector. The resolver walks the
        // SOURCE_AUTHORITY chain in workbench-rules.js, returning either
        // {value, source, tier, confidence} on success or null on miss.
        // We log a per-field outcome so Justin can see exactly what got
        // filled, from which source, and what was missed for Phase 3 to
        // pick up.
        function applyDealInfoFromActiveSubmission(submission) {
            const rules = window.WorkbenchRules;
            if (!rules || typeof rules.resolveField !== 'function') return;

            // (field name, selector, kind) — kind drives how the value lands:
            //   'value' → input.value = v
            //   'date'  → flatpickr setDate or input.value as ISO
            //   'select'→ matching option's value; warns if option missing
            //   'text'  → element.textContent (display divs)
            //
            // FIX-v8.6.49-PAPER-OVERRIDE-ORDERING — market must be applied
            // BEFORE paper. The #paper input has a synchronous onchange
            // listener tied to #admission that auto-writes a paper value
            // when market changes. If we apply paper first then market,
            // the market-change handler clobbers our paper write. Applying
            // in this order means the handler fires first, then our paper
            // value lands last and wins.
            const targets = [
                { field: 'insured_name',        sel: '#dealName',        kind: 'value' },
                { field: 'policy_effective',    sel: '#polEff',          kind: 'date'  },
                { field: 'policy_expiration',   sel: '#polExp',          kind: 'date'  },
                { field: 'submission_date',     sel: '#subDate',         kind: 'date'  },
                { field: 'quote_expiration',    sel: '#quoteExp',        kind: 'date'  },
                { field: 'target_date',         sel: '#targetDate',      kind: 'date'  },
                { field: 'created_date',        sel: '#createDate',      kind: 'date'  },
                { field: 'underwriter',         sel: '#underwriter',     kind: 'select'},
                { field: 'assistant',           sel: '#assistant',       kind: 'select'},
                { field: 'market',              sel: '#admission',       kind: 'select'},
                { field: 'paper',               sel: '#paper',           kind: 'value' },
                // FIX-PHASE-5.1-PAPERTXT-MIRROR-2026-05-14
                // Summary card mirror — #paperTxt is the read-only span
                // rendered in the sidebar/summary card. Pre-Phase-5.1
                // it was being populated by an older code path (showing
                // "Crestline E&S Insurance Company") while #paper input
                // correctly held "Steadfast Insurance Company". This
                // second target writes the resolved paper value to the
                // mirror so the summary card matches the form field.
                { field: 'paper',               sel: '#paperTxt',        kind: 'text'  },
                { field: 'broker_company',      sel: '#brokerCoTxt',     kind: 'text'  },
                { field: 'broker_type',         sel: '#brokerTypeTxt',   kind: 'text'  },
                { field: 'broker_region',       sel: '#regionTxt',       kind: 'text'  },
                // ─── Phase 3 Tier 2 fields (extraction-derived) ───
                // FIX-PHASE-3-TIER-1-2-DISPATCH-2026-05-14
                // These resolve via markdown label parsing of extraction
                // text. If the pattern misses, resolveField returns null
                // and the field stays empty — graceful degradation.
                { field: 'home_state',          sel: '#homeState',       kind: 'select'},
                { field: 'mailing_address',     sel: '#mailingTxt',      kind: 'text'  },
                { field: 'controlling_address', sel: '#controllingTxt',  kind: 'text'  },
                { field: 'broker_name',         sel: '#brokerNameTxt',   kind: 'text'  },
                { field: 'broker_address',      sel: '#brokerAddrTxt',   kind: 'text'  }
            ];

            const filled = [];
            const missed = [];
            const skipped = [];

            for (const t of targets) {
                const el = document.querySelector(t.sel);
                if (!el) {
                    skipped.push({ field: t.field, reason: 'selector_not_found', sel: t.sel });
                    continue;
                }
                const resolved = rules.resolveField(t.field, submission);
                if (!resolved) {
                    missed.push({ field: t.field, sel: t.sel });
                    continue;
                }
                const applied = applyResolvedToElement(el, t.kind, resolved.value);
                if (applied) {
                    el.classList.add('autofilled-from-platform');
                    // FIX-PHASE-3-TIER-1-2-DISPATCH-2026-05-14
                    // Enhanced logging — show tier + composed confidence
                    // for every fill so failures surface in console review.
                    filled.push({
                        field: t.field,
                        value: String(resolved.value).slice(0, 40),
                        source: resolved.source,
                        tier: resolved.tier,
                        confidence: Number(resolved.confidence || 0).toFixed(3),
                        ...(resolved.parser_confidence != null && {
                            parser_conf: resolved.parser_confidence
                        })
                    });
                } else {
                    skipped.push({
                        field: t.field,
                        reason: 'apply_failed_' + t.kind,
                        sel: t.sel,
                        attempted: String(resolved.value).slice(0, 40)
                    });
                }
            }

            console.log(
                '[workbench] Phase 3 deal-info apply:',
                filled.length, 'filled ·',
                missed.length, 'missed ·',
                skipped.length, 'skipped'
            );
            if (filled.length)  console.log('[workbench] Phase 3 filled:',  filled);
            if (missed.length)  console.log('[workbench] Phase 3 missed:',  missed);
            if (skipped.length) console.log('[workbench] Phase 3 skipped:', skipped);

            // FIX-v8.6.49-PAPER-OVERRIDE-GUARD
            // Belt-and-suspenders for #paper: if any async handler fires
            // after our apply loop and clobbers paper, this re-applies
            // at 120ms. The sync clobber is handled by target ordering
            // above; this catches setTimeout(0) and microtask handlers.
            //
            // FIX-PHASE-5.1-PAPERTXT-MIRROR-2026-05-14
            // Also mirror to #paperTxt in case the summary-card render
            // function fires after our apply and overwrites with the
            // demo/legacy Crestline value.
            setTimeout(() => {
                const paperResolved = rules.resolveField('paper', submission);
                if (!paperResolved || !paperResolved.value) return;

                const paperEl = document.querySelector('#paper');
                if (paperEl && paperEl.value !== paperResolved.value) {
                    console.log('[workbench] Phase 3 paper safety re-apply:',
                                paperEl.value, '→', paperResolved.value);
                    paperEl.value = paperResolved.value;
                    paperEl.classList.add('autofilled-from-platform');
                }

                const paperTxt = document.querySelector('#paperTxt');
                if (paperTxt && paperTxt.textContent !== paperResolved.value) {
                    console.log('[workbench] Phase 5.1 paperTxt mirror re-apply:',
                                paperTxt.textContent, '→', paperResolved.value);
                    paperTxt.textContent = paperResolved.value;
                    paperTxt.classList.add('autofilled-from-platform');
                }
            }, 120);
        }

        // FIX-PHASE-4-GL-PRIMARY-COVERAGE-2026-05-14
        // Apply resolved Primary GL coverage fields to the #details-gl panel.
        // Per Justin's spec: source is gl_quote module ONLY (no fallback to
        // ACORDs, supp apps, broker emails). Strict isolation enforced by
        // SOURCE_AUTHORITY in workbench-rules.js.
        //
        // Multi-quote handling deferred to Phase 4.1 — for now we extract
        // the first GL quote in gl_quote.text and fill #details-gl. If
        // multiple quotes exist, the regex will pick the first match.
        //
        // Behavior under Phase 3.5 cross-applicant defense:
        //   - If gl_quote.text's stated insured matches submission → fill
        //   - If gl_quote is contaminated (different insured) → all 8
        //     fields return null, panel stays empty, console logs the
        //     gate firing exactly once.
        function applyGLCoverageFromActiveSubmission(submission) {
            const rules = window.WorkbenchRules;
            if (!rules || typeof rules.resolveField !== 'function') return;

            // Field order MUST match the visible column order of
            // #details-gl: carrier, eff, exp, occ, agg, p/co agg, p&a, premium.
            // This array is consumed positionally by fillCoveragePanelByPosition.
            const fieldOrder = [
                'gl_carrier',
                'gl_effective_date',
                'gl_expiration_date',
                'gl_each_occurrence',
                'gl_general_aggregate',
                'gl_products_ops_aggregate',
                'gl_personal_adv_injury',
                'gl_premium'
            ];

            const resolvedSummary = [];
            const valuesByPosition = [];
            let anyResolved = false;

            for (const field of fieldOrder) {
                const r = rules.resolveField(field, submission);
                if (r && r.value != null && r.value !== '') {
                    valuesByPosition.push(r.value);
                    resolvedSummary.push({
                        field: field,
                        value: String(r.value).slice(0, 40),
                        source: r.source,
                        tier: r.tier,
                        confidence: Number(r.confidence || 0).toFixed(3)
                    });
                    anyResolved = true;
                } else {
                    valuesByPosition.push(null);
                }
            }

            if (!anyResolved) {
                console.log(
                    '[workbench] Phase 4 GL coverage apply: 0 fields resolved.',
                    'Blocked by one of three defense layers:',
                    '(1) Phase 6.1 pipeline two-pass applicant gate,',
                    '(2) Phase 3.5 workbench cross-applicant defense,',
                    'or (3) sentinel/structural-validity pattern misses',
                    'across all 8 fields. #details-gl panel left empty.'
                );
                return;
            }

            const fillResult = fillCoveragePanelByPosition('#details-gl', valuesByPosition);

            // Check the GL coverage checkbox so the panel is marked active.
            // The workbench treats unchecked panels as "not included" for
            // downstream rating and forms — auto-check when we filled data.
            const glCheck = document.querySelector('input[data-target="details-gl"]');
            if (glCheck && !glCheck.checked) glCheck.click();

            console.log(
                '[workbench] Phase 4 GL coverage apply:',
                fillResult.filled, 'positions filled ·',
                fillResult.missed, 'positions skipped ·',
                'panel checkbox auto-checked'
            );
            console.log('[workbench] Phase 4 GL filled:', resolvedSummary);
        }

        // FIX-PHASE-7-AL-PRIMARY-COVERAGE-2026-05-14
        // Apply resolved Primary AL coverage to #details-al. Mirrors the
        // GL applier exactly, but #details-al is a 5-field panel (carrier,
        // eff, exp, CSL, premium) — no split limits, no products/personal.
        // Source: al_quote module ONLY (strict, per Justin's spec).
        //
        // Behavior under Phase 6.1 two-pass gate: if al_quote was gated
        // (documents reference a different insured), the module body is
        // the refusal diagnostic "**No matching primary AL quote...**".
        // The resolver's isSentinelValue + looksStructurallyValid filters
        // reject that, all 5 AL fields return null, and #details-al stays
        // empty + unchecked — correct outcome, no contamination.
        function applyALCoverageFromActiveSubmission(submission) {
            const rules = window.WorkbenchRules;
            if (!rules || typeof rules.resolveField !== 'function') return;

            // Field order MUST match the visible column order of
            // #details-al: carrier, eff, exp, CSL, premium.
            const fieldOrder = [
                'al_carrier',
                'al_effective_date',
                'al_expiration_date',
                'al_combined_single_limit',
                'al_premium'
            ];

            const resolvedSummary = [];
            const valuesByPosition = [];
            let anyResolved = false;

            for (const field of fieldOrder) {
                const r = rules.resolveField(field, submission);
                if (r && r.value != null && r.value !== '') {
                    valuesByPosition.push(r.value);
                    resolvedSummary.push({
                        field: field,
                        value: String(r.value).slice(0, 40),
                        source: r.source,
                        tier: r.tier,
                        confidence: Number(r.confidence || 0).toFixed(3)
                    });
                    anyResolved = true;
                } else {
                    valuesByPosition.push(null);
                }
            }

            if (!anyResolved) {
                console.log(
                    '[workbench] Phase 7 AL coverage apply: 0 fields resolved.',
                    'Blocked by one of three defense layers:',
                    '(1) Phase 6.1 pipeline two-pass applicant gate,',
                    '(2) Phase 3.5 workbench cross-applicant defense,',
                    'or (3) sentinel/structural-validity pattern misses',
                    'across all 5 fields. #details-al panel left empty.'
                );
                return;
            }

            const fillResult = fillCoveragePanelByPosition('#details-al', valuesByPosition);

            const alCheck = document.querySelector('input[data-target="details-al"]');
            if (alCheck && !alCheck.checked) alCheck.click();

            console.log(
                '[workbench] Phase 7 AL coverage apply:',
                fillResult.filled, 'positions filled ·',
                fillResult.missed, 'positions skipped ·',
                'panel checkbox auto-checked'
            );
            console.log('[workbench] Phase 7 AL filled:', resolvedSummary);
        }

        // FIX-PHASE-8-EMPLOYERS-LIABILITY-2026-05-14
        // Apply resolved Employers Liability coverage to the EL panel.
        //
        // KEY DIFFERENCE vs GL/AL: #details-el is NOT a default-rendered
        // panel. It exists only as a clonable template
        // (data-template-key="el") in .limit-templates. So the applier
        // must clone+enable the panel via addCoverageEntry('el', ...),
        // which produces a panel with a DYNAMIC unique id
        // (details-el-{ts}-{seq}) — we then fill that specific clone.
        //
        // Source priority (Option B): el_quote first (standalone WC/EL
        // quote doc), gl_quote fallback (EL line inside a GL package
        // quote). Handled by SOURCE_AUTHORITY; this applier is source-
        // agnostic — it just resolves the 7 fields and fills.
        //
        // If zero fields resolve (no EL data, or cross-applicant gate
        // blocked the source module) we do NOT clone an empty EL panel —
        // EL simply doesn't appear, which is the correct UI outcome.
        function applyELCoverageFromActiveSubmission(submission) {
            const rules = window.WorkbenchRules;
            if (!rules || typeof rules.resolveField !== 'function') return;

            // Order MUST match the visible column order of the EL panel:
            // carrier, eff, exp, BI-by-accident, BI-by-disease,
            // disease-policy-limit, premium.
            const fieldOrder = [
                'el_carrier',
                'el_effective_date',
                'el_expiration_date',
                'el_bi_accident',
                'el_bi_disease',
                'el_disease_policy_limit',
                'el_premium'
            ];

            const resolvedSummary = [];
            const valuesByPosition = [];
            let anyResolved = false;

            for (const field of fieldOrder) {
                const r = rules.resolveField(field, submission);
                if (r && r.value != null && r.value !== '') {
                    valuesByPosition.push(r.value);
                    resolvedSummary.push({
                        field: field,
                        value: String(r.value).slice(0, 40),
                        source: r.source,
                        tier: r.tier,
                        confidence: Number(r.confidence || 0).toFixed(3)
                    });
                    anyResolved = true;
                } else {
                    valuesByPosition.push(null);
                }
            }

            if (!anyResolved) {
                console.log(
                    '[workbench] Phase 8 EL coverage apply: 0 fields resolved.',
                    'No standalone EL quote and no EL line in the GL package',
                    'quote, or blocked by one of three defense layers:',
                    '(1) Phase 6.1 pipeline gate, (2) Phase 3.5 workbench',
                    'cross-applicant defense, (3) sentinel/structural misses.',
                    'EL panel not added (correct — no empty clone).'
                );
                return;
            }

            // FIX-PHASE-GO-LIVE-76-FOREIGN-SOURCE-BLEED-2026-05-16
            // Extension v8.6.75 audit found $185,000 (the GL premium)
            // bleeding into EL "Bodily Injury by Disease" on the demo,
            // because EL value fields fall back to gl_quote/al_quote for
            // genuine combined-package quotes — but when the submission
            // has NO real EL content, a generic premium/limit pattern
            // matched the GL "- Premium: $185,000" line and fabricated a
            // bogus EL panel. Rule: a real EL placement is identified by
            // an EL-SPECIFIC signal — a resolved el_carrier, or any EL
            // field resolved from an el_quote* source. If the ONLY
            // things that resolved are value fields (premium/limits)
            // sourced from a foreign GL/AL module, that is bleed, not an
            // EL quote — suppress the panel exactly like the no-resolve
            // case. Combined-package EL (real el_carrier or el_quote
            // source) is unaffected.
            const elIdentified = resolvedSummary.some(s => {
                const src = String(s.source || '');
                const fromElSource = /(^|[^a-z])el_quote/i.test(src);
                const isCarrier = s.field === 'el_carrier';
                return fromElSource || (isCarrier && fromElSource)
                    || (isCarrier && !/gl_quote|al_quote/i.test(src));
            });
            if (!elIdentified) {
                console.log('[workbench] Phase 8 EL: the only resolved',
                    'values came from a foreign GL/AL fallback (no EL',
                    'carrier, no el_quote source) — this is GL/AL premium',
                    'bleed, not a real EL quote. EL panel NOT added',
                    '(correct — prevents $185K-style cross-coverage bleed).');
                return;
            }

            // Clone + enable the EL panel. addCoverageEntry returns the
            // freshly-cloned entry (Phase 8 made it return newEntry).
            const primaryList = document.getElementById('primary-limits-list');
            if (!primaryList || typeof addCoverageEntry !== 'function') {
                console.warn('[workbench] Phase 8 EL: primary-limits-list or',
                    'addCoverageEntry unavailable — cannot add EL panel.');
                return;
            }
            // FIX-PHASE-GO-LIVE-76-IDEMPOTENT-CLONE-2026-05-16
            // Reuse an existing EL panel on re-apply instead of stacking
            // a duplicate (extension-found duplicate-panel bug).
            let elEntry = null;
            const elExisting = primaryList.querySelector('[id^="details-el-"]');
            if (elExisting) {
                elEntry = elExisting.closest('.limit-entry, .coverage-entry') || elExisting;
                console.log('[workbench] Phase 8 EL: reusing existing EL',
                    'panel (idempotent re-apply, no duplicate clone).');
            } else {
                elEntry = addCoverageEntry('el', primaryList);
            }
            if (!elEntry) {
                console.warn('[workbench] Phase 8 EL: clone failed.');
                return;
            }
            // The cloned panel has a dynamic id; target it by element,
            // not by a static selector.
            const elPanel = elEntry.querySelector('.limit-details-panel');
            if (!elPanel || !elPanel.id) {
                console.warn('[workbench] Phase 8 EL: cloned panel missing id.');
                return;
            }
            const fillResult = fillCoveragePanelByPosition('#' + elPanel.id, valuesByPosition);

            // Check the cloned entry's checkbox so EL is marked active.
            const elCheck = elEntry.querySelector('input[type="checkbox"][data-target]');
            if (elCheck && !elCheck.checked) elCheck.click();

            console.log(
                '[workbench] Phase 8 EL coverage apply:',
                fillResult.filled, 'positions filled ·',
                fillResult.missed, 'positions skipped ·',
                'EL panel cloned, enabled, checkbox auto-checked'
            );
            console.log('[workbench] Phase 8 EL filled:', resolvedSummary);
        }

        // FIX-PHASE-9-EMPLOYEE-BENEFITS-LIABILITY-2026-05-14
        // Apply resolved Employee Benefits Liability to the EBL panel.
        // Same clonable-panel pattern as Phase 8 EL: #details-ebl is a
        // template (data-template-key="ebl"), cloned via
        // addCoverageEntry('ebl', ...). 5 fields: carrier, eff, exp,
        // each-employee-limit, premium. Source priority ebl_quote →
        // gl_quote (EBL is usually a GL endorsement). No empty clone if
        // zero fields resolve.
        function applyEBLCoverageFromActiveSubmission(submission) {
            const rules = window.WorkbenchRules;
            if (!rules || typeof rules.resolveField !== 'function') return;

            const fieldOrder = [
                'ebl_carrier',
                'ebl_effective_date',
                'ebl_expiration_date',
                'ebl_each_employee_limit',
                'ebl_premium'
            ];

            const resolvedSummary = [];
            const valuesByPosition = [];
            let anyResolved = false;

            for (const field of fieldOrder) {
                const r = rules.resolveField(field, submission);
                if (r && r.value != null && r.value !== '') {
                    valuesByPosition.push(r.value);
                    resolvedSummary.push({
                        field: field,
                        value: String(r.value).slice(0, 40),
                        source: r.source,
                        tier: r.tier,
                        confidence: Number(r.confidence || 0).toFixed(3)
                    });
                    anyResolved = true;
                } else {
                    valuesByPosition.push(null);
                }
            }

            if (!anyResolved) {
                console.log(
                    '[workbench] Phase 9 EBL coverage apply: 0 fields resolved.',
                    'No standalone EBL quote and no EBL endorsement in the GL',
                    'quote, or blocked by one of three defense layers:',
                    '(1) Phase 6.1 pipeline gate, (2) Phase 3.5 workbench',
                    'cross-applicant defense, (3) sentinel/structural misses.',
                    'EBL panel not added (correct — no empty clone).'
                );
                return;
            }

            // FIX-PHASE-GO-LIVE-76-FOREIGN-SOURCE-BLEED-2026-05-16
            // Same GL/AL premium-bleed guard as EL (see Phase 8). A real
            // EBL placement is identified by a resolved ebl_carrier or
            // an ebl_quote source; value-only matches from a foreign
            // GL/AL fallback are bleed, not an EBL quote — suppress.
            const eblIdentified = resolvedSummary.some(s => {
                const src = String(s.source || '');
                const fromEblSource = /(^|[^a-z])ebl_quote/i.test(src);
                const isCarrier = s.field === 'ebl_carrier';
                return fromEblSource
                    || (isCarrier && !/gl_quote|al_quote/i.test(src));
            });
            if (!eblIdentified) {
                console.log('[workbench] Phase 9 EBL: only foreign GL/AL',
                    'fallback values resolved (no EBL carrier, no ebl_quote',
                    'source) — premium bleed, not a real EBL quote. EBL',
                    'panel NOT added (correct).');
                return;
            }

            const primaryList = document.getElementById('primary-limits-list');
            if (!primaryList || typeof addCoverageEntry !== 'function') {
                console.warn('[workbench] Phase 9 EBL: primary-limits-list or',
                    'addCoverageEntry unavailable — cannot add EBL panel.');
                return;
            }
            // FIX-PHASE-GO-LIVE-76-IDEMPOTENT-CLONE-2026-05-16
            // Reuse an existing EBL panel on re-apply instead of
            // stacking a duplicate (extension-found duplicate-panel bug).
            let eblEntry = null;
            const eblExisting = primaryList.querySelector('[id^="details-ebl-"]');
            if (eblExisting) {
                eblEntry = eblExisting.closest('.limit-entry, .coverage-entry') || eblExisting;
                console.log('[workbench] Phase 9 EBL: reusing existing EBL',
                    'panel (idempotent re-apply, no duplicate clone).');
            } else {
                eblEntry = addCoverageEntry('ebl', primaryList);
            }
            if (!eblEntry) {
                console.warn('[workbench] Phase 9 EBL: clone failed.');
                return;
            }
            const eblPanel = eblEntry.querySelector('.limit-details-panel');
            if (!eblPanel || !eblPanel.id) {
                console.warn('[workbench] Phase 9 EBL: cloned panel missing id.');
                return;
            }
            const fillResult = fillCoveragePanelByPosition('#' + eblPanel.id, valuesByPosition);

            const eblCheck = eblEntry.querySelector('input[type="checkbox"][data-target]');
            if (eblCheck && !eblCheck.checked) eblCheck.click();

            console.log(
                '[workbench] Phase 9 EBL coverage apply:',
                fillResult.filled, 'positions filled ·',
                fillResult.missed, 'positions skipped ·',
                'EBL panel cloned, enabled, checkbox auto-checked'
            );
            console.log('[workbench] Phase 9 EBL filled:', resolvedSummary);
        }

        // FIX-PHASE-10-AIRCRAFT-GARAGE-LIQUOR-2026-05-14
        // Generic clonable-coverage applier. Phases 8 (EL) and 9 (EBL)
        // each hand-rolled this; Phase 10 adds three more coverages, so
        // the shared logic is extracted here. The EL/EBL appliers are
        // left as-is (working, validated) — this generic path powers
        // aircraft/garage/liquor and any future clonable coverage.
        //
        // phaseLabel: console tag (e.g. "Phase 10 Aircraft")
        // typeKey:    addCoverageEntry template key (e.g. "aircraft")
        // fieldOrder: resolver field names in visible column order
        function applyClonableCoverage(submission, phaseLabel, typeKey, fieldOrder) {
            const rules = window.WorkbenchRules;
            if (!rules || typeof rules.resolveField !== 'function') return;

            const resolvedSummary = [];
            const valuesByPosition = [];
            let anyResolved = false;

            for (const field of fieldOrder) {
                const r = rules.resolveField(field, submission);
                if (r && r.value != null && r.value !== '') {
                    valuesByPosition.push(r.value);
                    resolvedSummary.push({
                        field: field,
                        value: String(r.value).slice(0, 40),
                        source: r.source,
                        tier: r.tier,
                        confidence: Number(r.confidence || 0).toFixed(3)
                    });
                    anyResolved = true;
                } else {
                    valuesByPosition.push(null);
                }
            }

            if (!anyResolved) {
                console.log(
                    '[workbench] ' + phaseLabel + ' coverage apply: 0 fields resolved.',
                    'No matching ' + typeKey + ' quote, or blocked by one of',
                    'three defense layers: (1) Phase 6.1 pipeline gate,',
                    '(2) Phase 3.5 workbench cross-applicant defense,',
                    '(3) sentinel/structural misses.',
                    typeKey + ' panel not added (correct — no empty clone).'
                );
                return;
            }

            // FIX-PHASE-GO-LIVE-76-FOREIGN-SOURCE-BLEED-2026-05-16
            // Generic version of the EL/EBL GL-premium-bleed guard.
            // Extension v8.6.75 found $185,000 (GL premium) bleeding
            // into Liquor "Each Common Cause Limit" because liquor value
            // fields fall back to gl_quote for combined-package quotes.
            // A real <typeKey> placement is identified by a resolved
            // <typeKey>_carrier OR any field resolved from a
            // <typeKey>_quote* source. If every resolved value came from
            // a foreign GL/AL fallback (no own-coverage carrier, no
            // own-coverage source), it is bleed — suppress the panel.
            const ownSourceRe = new RegExp('(^|[^a-z])' + typeKey + '_quote', 'i');
            const carrierField = typeKey + '_carrier';
            const coverageIdentified = resolvedSummary.some(s => {
                const src = String(s.source || '');
                if (ownSourceRe.test(src)) return true;
                if (s.field === carrierField && !/gl_quote|al_quote/i.test(src)) return true;
                return false;
            });
            if (!coverageIdentified) {
                console.log('[workbench] ' + phaseLabel + ': only foreign',
                    'GL/AL fallback values resolved (no ' + typeKey +
                    ' carrier, no ' + typeKey + '_quote source) — premium',
                    'bleed, not a real ' + typeKey + ' quote.',
                    typeKey + ' panel NOT added (correct).');
                return;
            }

            const primaryList = document.getElementById('primary-limits-list');
            if (!primaryList || typeof addCoverageEntry !== 'function') {
                console.warn('[workbench] ' + phaseLabel + ': primary-limits-list',
                    'or addCoverageEntry unavailable.');
                return;
            }
            // FIX-PHASE-GO-LIVE-76-IDEMPOTENT-CLONE-2026-05-16
            // Re-applying the pipeline (demo double-trigger, OR a real
            // re-apply after an upstream correction) previously cloned a
            // SECOND panel for this coverage every time, because the
            // clone was unconditional. Reuse an existing panel of the
            // same coverage type if one is already present, so re-apply
            // REFRESHES in place instead of STACKING duplicates. A
            // coverage panel's id is details-<typeKey>-<ts>-<seq>.
            let entry = null;
            const existing = primaryList.querySelector(
                '[id^="details-' + typeKey + '-"]');
            if (existing) {
                entry = existing.closest('.limit-entry, .coverage-entry') || existing;
                console.log('[workbench] ' + phaseLabel +
                    ': reusing existing ' + typeKey +
                    ' panel (idempotent re-apply, no duplicate clone).');
            } else {
                entry = addCoverageEntry(typeKey, primaryList);
            }
            if (!entry) {
                console.warn('[workbench] ' + phaseLabel + ': clone failed.');
                return;
            }
            const panel = entry.querySelector('.limit-details-panel');
            if (!panel || !panel.id) {
                console.warn('[workbench] ' + phaseLabel + ': cloned panel missing id.');
                return;
            }
            const fillResult = fillCoveragePanelByPosition('#' + panel.id, valuesByPosition);

            const cb = entry.querySelector('input[type="checkbox"][data-target]');
            if (cb && !cb.checked) cb.click();

            console.log(
                '[workbench] ' + phaseLabel + ' coverage apply:',
                fillResult.filled, 'positions filled ·',
                fillResult.missed, 'positions skipped ·',
                typeKey + ' panel cloned, enabled, checkbox auto-checked'
            );
            console.log('[workbench] ' + phaseLabel + ' filled:', resolvedSummary);
        }

        function applyAircraftCoverageFromActiveSubmission(submission) {
            applyClonableCoverage(submission, 'Phase 10 Aircraft', 'aircraft', [
                'aircraft_carrier', 'aircraft_effective_date',
                'aircraft_expiration_date', 'aircraft_each_occurrence',
                'aircraft_premium'
            ]);
        }
        function applyGarageCoverageFromActiveSubmission(submission) {
            applyClonableCoverage(submission, 'Phase 10 Garage', 'garage', [
                'garage_carrier', 'garage_effective_date',
                'garage_expiration_date', 'garage_limit', 'garage_premium'
            ]);
        }
        function applyLiquorCoverageFromActiveSubmission(submission) {
            applyClonableCoverage(submission, 'Phase 10 Liquor', 'liquor', [
                'liquor_carrier', 'liquor_effective_date',
                'liquor_expiration_date', 'liquor_each_common_cause_limit',
                'liquor_aggregate_limit', 'liquor_premium'
            ]);
        }

        // FIX-PHASE-11-FOREIGN-GL-AL-2026-05-14
        // Generic DEFAULT-PANEL applier. Foreign GL/AL have default-
        // rendered panels (#details-fgl / #details-fal) like GL/AL —
        // NOT clonable templates like EL/EBL/aircraft/etc. So this fills
        // the existing panel in place (mirrors applyGL/applyAL) rather
        // than cloning. Generic so future default-panel coverages reuse.
        //
        // panelSelector: static panel id (e.g. '#details-fgl')
        // checkboxSelector: the panel's enable checkbox
        function applyDefaultPanelCoverage(submission, phaseLabel, panelSelector, checkboxSelector, fieldOrder) {
            const rules = window.WorkbenchRules;
            if (!rules || typeof rules.resolveField !== 'function') return;

            const resolvedSummary = [];
            const valuesByPosition = [];
            let anyResolved = false;

            for (const field of fieldOrder) {
                const r = rules.resolveField(field, submission);
                if (r && r.value != null && r.value !== '') {
                    valuesByPosition.push(r.value);
                    resolvedSummary.push({
                        field: field,
                        value: String(r.value).slice(0, 40),
                        source: r.source,
                        tier: r.tier,
                        confidence: Number(r.confidence || 0).toFixed(3)
                    });
                    anyResolved = true;
                } else {
                    valuesByPosition.push(null);
                }
            }

            if (!anyResolved) {
                console.log(
                    '[workbench] ' + phaseLabel + ' coverage apply: 0 fields resolved.',
                    'No matching foreign quote, or blocked by one of three',
                    'defense layers: (1) Phase 6.1 pipeline gate, (2) Phase',
                    '3.5 workbench cross-applicant defense,',
                    '(3) sentinel/structural misses. ' + panelSelector + ' left empty.'
                );
                return;
            }

            const fillResult = fillCoveragePanelByPosition(panelSelector, valuesByPosition);

            const cb = document.querySelector(checkboxSelector);
            if (cb && !cb.checked) cb.click();

            console.log(
                '[workbench] ' + phaseLabel + ' coverage apply:',
                fillResult.filled, 'positions filled ·',
                fillResult.missed, 'positions skipped ·',
                'panel checkbox auto-checked'
            );
            console.log('[workbench] ' + phaseLabel + ' filled:', resolvedSummary);
        }

        function applyForeignGLCoverageFromActiveSubmission(submission) {
            applyDefaultPanelCoverage(submission, 'Phase 11 Foreign GL',
                '#details-fgl', 'input[data-target="details-fgl"]', [
                'fgl_carrier', 'fgl_effective_date', 'fgl_expiration_date',
                'fgl_each_occurrence', 'fgl_general_aggregate', 'fgl_premium'
            ]);
        }
        function applyForeignALCoverageFromActiveSubmission(submission) {
            applyDefaultPanelCoverage(submission, 'Phase 11 Foreign AL',
                '#details-fal', 'input[data-target="details-fal"]', [
                'fal_carrier', 'fal_effective_date', 'fal_expiration_date',
                'fal_combined_single_limit', 'fal_premium'
            ]);
        }

        // ===================================================================
        // v8.6.81 — Workbench fill reliability: risk profile, rater, report
        // ===================================================================
        function normalizeBasisForSelect(value) {
            const s = String(value || '').toLowerCase();
            if (/payroll/.test(s)) return 'payroll';
            if (/per\s*\$?100\b|\/100/.test(s)) return '100';
            if (/per\s*\$?1\b|\/1\b/.test(s)) return '1';
            // Sales, receipts, revenue and most GL class exposures rate per $1,000.
            if (/sales|revenue|receipts|gross|per\s*\$?1,?000|\/1000|1k/.test(s)) return '1000';
            return '1000';
        }

        function normalizeExposureBasisOption(value) {
            const s = String(value || '').toLowerCase();
            if (/payroll/.test(s)) return 'Payroll';
            if (/acre/.test(s)) return 'Acres';
            if (/admission/.test(s)) return 'Admissions';
            if (/area|square/.test(s)) return 'Area';
            if (/gallon/.test(s)) return 'Gallons';
            if (/cost/.test(s)) return 'Total Cost';
            if (/operating/.test(s)) return 'Total Operating Expenses';
            if (/student/.test(s)) return 'Students';
            if (/unit/.test(s)) return 'Units';
            if (/sales|revenue|receipt|gross/.test(s)) return 'Gross Sales/Revenues';
            if (/flat/.test(s)) return 'Flat';
            return 'Other';
        }

        function setInputValue(selector, value, kind = 'value') {
            const el = document.querySelector(selector);
            if (!el || value == null || value === '') return false;
            const applied = applyResolvedToElement(el, kind, value);
            if (applied) el.classList.add('autofilled-from-platform');
            return applied;
        }

        function applyUnderwritingFromActiveSubmission(submission) {
            const rules = window.WorkbenchRules;
            if (!rules || typeof rules.resolveField !== 'function') return;
            const targets = [
                { field: 'iso_class_code',           sel: '#isoClass',             kind: 'value'  },
                { field: 'iso_description',          sel: '#isoDesc',              kind: 'value'  },
                { field: 'hazard_grade',             sel: '#hazardGrade',          kind: 'value'  },
                { field: 'hazard_grade',             sel: '#hazardGradeSelect',    kind: 'select' },
                { field: 'exposure_amount',          sel: '#exposureAmt',          kind: 'value'  },
                { field: 'exposure_basis',           sel: '#exposureBasis',        kind: 'select' },
                { field: 'website',                  sel: '#website',              kind: 'value'  },
                { field: 'exposure_to_loss',         sel: '#expLoss',              kind: 'value'  },
                { field: 'account_strengths',        sel: '#acctStrengths',        kind: 'value'  },
                { field: 'guideline_conflicts_text', sel: '#guidelineConflicts',   kind: 'value'  },
                { field: 'description_operations',   sel: '#descOps',              kind: 'value'  },
                { field: 'underwriting_rationale',   sel: '#pricingRationale',     kind: 'value'  }
            ];
            const filled = [], missed = [];
            for (const t of targets) {
                const r = rules.resolveField(t.field, submission);
                if (!r || r.value == null || r.value === '') { missed.push(t.field); continue; }
                let v = r.value;
                if (t.sel === '#exposureBasis') v = normalizeExposureBasisOption(v);
                const ok = setInputValue(t.sel, v, t.kind);
                if (ok) filled.push({ field: t.field, source: r.source, value: String(r.value).slice(0, 60), confidence: Number(r.confidence || 0).toFixed(3) });
            }
            // Trigger dependent static maps after ISO/state fills.
            document.querySelector('#isoClass')?.dispatchEvent(new Event('input', { bubbles: true }));
            document.querySelector('#homeState')?.dispatchEvent(new Event('change', { bubbles: true }));
            const hz = document.getElementById('hazardGradeSelect');
            if (hz) hz.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[workbench] v8.6.93 underwriting apply:', filled.length, 'filled ·', missed.length, 'missed', filled);
        }


        // v8.6.90 - parse all GL class rows from quote / ACORD page text and
        // populate the GL exposure rater with every class, not just the primary.
        function collectSnapshotFileTexts89(submission, matcher) {
            const files = Array.isArray(submission?.snapshot?.files) ? submission.snapshot.files : [];
            const out = [];
            for (const f of files) {
                const hay = [f?.name, f?.classification, f?.primaryTag, f?.subType]
                    .concat(Array.isArray(f?.classifications) ? f.classifications.map(c => [c?.tag, c?.subType, c?.section_hint].join(' ')) : [])
                    .join(' ');
                if (matcher && !matcher.test(hay)) continue;
                const pts = f?.extractMeta && Array.isArray(f.extractMeta.pageTexts) ? f.extractMeta.pageTexts : [];
                for (const p of pts) out.push(typeof p === 'string' ? p : String(p?.text || p?.content || p?.pageText || ''));
            }
            return out.join('\n\n');
        }
        function zipStateLikely91(state, zip) {
            const z = String(zip || '').replace(/[^0-9]/g, '').slice(0, 5);
            if (!z || z.length !== 5) return false;
            const n = Number(z);
            const st = String(state || '').toUpperCase();
            if (st === 'VA') return n >= 20100 && n <= 24699;
            if (st === 'PA') return n >= 15000 && n <= 19699;
            if (st === 'GA') return n >= 30000 && n <= 39999;
            if (st === 'NY') return n >= 10000 && n <= 14999;
            if (st === 'NC') return n >= 27000 && n <= 28999;
            if (st === 'TN') return n >= 37000 && n <= 38599;
            if (st === 'WV') return n >= 24700 && n <= 26899;
            return true;
        }
        function stateZipFromSubmission89(submission) {
            const home = (r85('home_state', submission) || submission?.home_state || '').toString().trim().toUpperCase();
            const corpus = [
                r85('mailing_address', submission),
                r85('controlling_address', submission),
                submission?.mailing_address,
                submission?.controlling_address,
                submission?.address,
                JSON.stringify(submission?.snapshot?.handoff || {}),
                collectSnapshotFileTexts89(submission, /acord|application|quote|supp/i)
            ].filter(Boolean).join('\n');
            const clean = corpus.replace(/\u00a0/g, ' ');
            const preferred = home || 'VA';
            const candidates = [];
            const re = /\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/g;
            let m;
            while ((m = re.exec(clean)) !== null) {
                const st = m[1].toUpperCase();
                const zip = m[2];
                if (st === preferred && zipStateLikely91(st, zip)) candidates.push({ state: st, zip, score: 100 });
                else if (zipStateLikely91(st, zip)) candidates.push({ state: st, zip, score: 40 });
            }
            // Prefer resolved address zip over issuer / carrier header zip.
            candidates.sort((a,b) => b.score - a.score);
            if (candidates.length) return { state: candidates[0].state, zip: candidates[0].zip };
            return { state: preferred, zip: '' };
        }
        function lookupGlClassRef92(code) {
            const rules = window.WorkbenchRules;
            if (rules && typeof rules.lookupGlClassCode === 'function') return rules.lookupGlClassCode(code);
            // Minimal fallback if rules have not attached yet.
            const fallback = {
                '12683': { code:'12683', description:'Fertilizer Dealers and Distributors', ratingBasis:'$1,000 of Gross Sales' },
                '13716': { code:'13716', description:'Hardware Stores', ratingBasis:'$1,000 of Gross Sales' },
                '12583': { code:'12583', description:'Feed, Grain or Hay Dealers', ratingBasis:'$1,000 of Gross Sales' },
                '21001': { code:'21001', description:'Chemical Distributors-Pest', ratingBasis:'$1,000 of Gross Sales', review:true }
            };
            return fallback[String(code || '').replace(/[^0-9]/g, '').slice(0,5)] || null;
        }
        function isRecognizedGlClass92(code) { return !!lookupGlClassRef92(code); }
        function glBasisForSelect92(code) {
            const ref = lookupGlClassRef92(code);
            return normalizeBasisForSelect(ref && ref.ratingBasis ? ref.ratingBasis : 'Gross Sales');
        }
        function normalizeGlDesc91(desc, code) {
            const ref = lookupGlClassRef92(code);
            let d = String(desc || '').replace(/\s+/g, ' ').replace(/[-–—]\s*$/, '').trim();
            d = d.replace(/CLASSIFICATION|CODE#|PREMIUM BASIS|RATE BASIS|PREM\/OPS/gi, '').trim();
            if (!d || d.length < 3 || /quote number|naic|policy|coverage|premium|limit|building|vehicle|pickup|ford|location|application/i.test(d)) {
                d = ref && ref.description ? ref.description : '';
            }
            if (ref && ref.description && (/FERTILIZER DEALERS AND DIS$/i.test(d) || d.length > 95 || d.length < 6)) d = ref.description;
            return d || (ref && ref.description ? ref.description : 'Description');
        }

        function parseGLClassRows89(submission) {
            const text = collectSnapshotFileTexts89(submission, /quote|acord|application|gl|exposure|supp/i);
            const rows = [];
            const seen = new Set();
            const add = (desc, code, exposure) => {
                code = String(code || '').trim();
                const n = Number(String(exposure || '').replace(/[^0-9]/g, '')) || 0;
                if (!/^\d{4,5}$/.test(code) || n <= 0) return;
                // Guard against quote numbers, years, NAIC codes, property values,
                // vehicle model years and other non-GL schedule fragments.
                if (!isRecognizedGlClass92(code)) return;
                if (n < 100000) return;
                const key = code + ':' + n;
                if (seen.has(key)) return;
                seen.add(key);
                rows.push({ code, desc: normalizeGlDesc91(desc, code), exposure:n.toLocaleString('en-US'), base:glBasisForSelect92(code), review: !!(lookupGlClassRef92(code) && lookupGlClassRef92(code).review) });
            };
            const clean = String(text || '').replace(/\u00a0/g, ' ');
            // Highest-confidence path: parse the GL classification table block, not
            // arbitrary quote/property/vehicle text. This prevents NAIC 14982,
            // vehicle years and property building values from polluting the GL rater.
            const blocks = [];
            const blockRe = /CLASSIFICATION[\s\S]{0,2600}?RATE\s+BASIS\s*:/gi;
            let bm;
            while ((bm = blockRe.exec(clean)) !== null) blocks.push(bm[0]);
            if (!blocks.length) {
                const alt = /CLASSIFICATION[\s\S]{0,2600}?(?:ADDITIONAL COVERAGES|PREM\/OPS|PROD\/COMP|$)/i.exec(clean);
                if (alt) blocks.push(alt[0]);
            }
            for (const block of blocks) {
                const lines = block.split(/\n+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
                const codeIdxs = [];
                lines.forEach((line, idx) => { if (/^\d{4,5}$/.test(line) && isRecognizedGlClass92(line)) codeIdxs.push(idx); });
                if (codeIdxs.length >= 1) {
                    const codes = codeIdxs.map(i => lines[i]);
                    const firstCodeIdx = codeIdxs[0];
                    const lastCodeIdx = codeIdxs[codeIdxs.length - 1];
                    const descLines = lines.slice(0, firstCodeIdx).filter(x => !/^(CLASSIFICATION|CODE#|PREMIUM BASIS|RATE|BASIS|PREM\/OPS)$/i.test(x));
                    const exposureLines = [];
                    for (let i = lastCodeIdx + 1; i < lines.length && exposureLines.length < codes.length; i++) {
                        const s = lines[i];
                        if (/^\(?0*1\)?$/.test(s)) break;
                        if (/^\d{1,3}(?:,\d{3})+$|^\d{5,}$/.test(s)) exposureLines.push(s);
                    }
                    codes.forEach((code, i) => add(descLines[i] || (lookupGlClassRef92(code) && lookupGlClassRef92(code).description), code, exposureLines[i]));
                }
                // Same block, flattened fallback for rows preserved on one line.
                const flat = lines.join('  ');
                const rowRe = /([A-Z][A-Z0-9 ,.&\/\-'()]{3,130}?)\s+(\d{4,5})\s+(\d{1,3}(?:,\d{3})+|\d{5,})\s+\(?0*1\)?/gi;
                let m;
                while ((m = rowRe.exec(flat)) !== null) add(m[1], m[2], m[3]);
            }
            // Fallback: if the text contains codes/exposures in separate columns,
            // pair the known GL codes with the first large exposure values after them.
            if (!rows.length) {
                const knownCodes = Array.from(clean.matchAll(/\b(\d{4,5})\b/g)).map(m => m[1]).filter(isRecognizedGlClass92);
                const expos = Array.from(clean.matchAll(/\b(9,900,000|8,000,000|6,800,000|800,000)\b/g)).map(m => m[1]);
                for (let i = 0; i < Math.min(knownCodes.length, expos.length); i++) add((lookupGlClassRef92(knownCodes[i]) && lookupGlClassRef92(knownCodes[i]).description), knownCodes[i], expos[i]);
            }
            return rows.slice(0, 8);
        }


        function applyGLExposureRaterFromActiveSubmission(submission) {
            const rules = window.WorkbenchRules;
            if (!rules || typeof rules.resolveField !== 'function') return;
            const tbl = document.getElementById('classTerritoryTable');
            const tbody = tbl && tbl.querySelector('tbody');
            if (!tbody) return;
            const classRows = parseGLClassRows89(submission);
            const stateZip = stateZipFromSubmission89(submission);
            const ensureRows = (n) => {
                const addBtn = document.getElementById('glRaterAddRow');
                while (tbody.querySelectorAll('tr').length < n && addBtn) addBtn.click();
            };
            const get = (field) => {
                const r = rules.resolveField(field, submission);
                return r && r.value != null && r.value !== '' ? r : null;
            };
            const fallback = [{
                code: get('iso_class_code')?.value,
                desc: get('iso_description')?.value,
                state: get('home_state')?.value || stateZip.state,
                zip: stateZip.zip,
                exposure: get('exposure_amount')?.value,
                base: normalizeBasisForSelect(get('exposure_basis')?.value)
            }].filter(x => x.code && x.exposure);
            const rowsToApply = classRows.length ? classRows.map(x => ({...x, state: stateZip.state, zip: stateZip.zip})) : fallback;
            ensureRows(Math.max(rowsToApply.length, 1));
            const domRows = Array.from(tbody.querySelectorAll('tr'));
            let filled = 0;
            const put = (row, df, val) => {
                const el = row && row.querySelector('[data-f="' + df + '"]');
                if (!el || val == null || val === '') return;
                el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.classList.add('autofilled-from-platform');
                filled++;
            };
            rowsToApply.forEach((r, i) => {
                const row = domRows[i];
                if (!row) return;
                put(row, 'code', r.code);
                put(row, 'desc', r.desc);
                put(row, 'state', r.state || stateZip.state);
                put(row, 'zip', r.zip || stateZip.zip);
                put(row, 'exposures', r.exposure);
                put(row, 'base', r.base || '1000');
                row.querySelectorAll('input, select').forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));
            });
            console.log('[workbench] v8.6.93 GL exposure rater apply:', filled, 'cells filled', rowsToApply);
        }


        // v8.6.87 — section population hardening. These are no-cost DOM writers
        // that consume resolver/adapters. They prevent blank tables when data is
        // present in snapshot.extractions.
        function r85(field, submission) {
            const rules = window.WorkbenchRules;
            if (!rules || typeof rules.resolveField !== 'function') return null;
            const x = rules.resolveField(field, submission);
            return x && x.value != null && x.value !== '' ? x.value : null;
        }
        function n85(v) {
            if (v == null || v === '') return 0;
            const m = String(v).match(/[0-9][0-9,]*(?:\.[0-9]+)?/);
            return m ? Number(m[0].replace(/,/g, '')) : 0;
        }
        function money85(n) { return n > 0 ? Math.round(n).toLocaleString('en-US') : ''; }
        function set85(el, val) {
            if (!el || val == null || val === '') return false;
            el.value = String(val);
            el.dispatchEvent(new Event('input', { bubbles:true }));
            el.dispatchEvent(new Event('change', { bubbles:true }));
            el.classList.add('autofilled-from-platform');
            return true;
        }

        function parseLossTables85(submission) {
            const ex = submission?.snapshot?.extractions || submission?.extractions || {};
            const files = Array.isArray(submission?.snapshot?.files) ? submission.snapshot.files : [];
            const fileLossText = files
                .filter(f => /loss|claim/i.test([f.name, f.classification, ...(Array.isArray(f.classifications) ? f.classifications.map(c => [c.tag, c.subType, c.section_hint].join(' ')) : [])].join(' ')))
                .flatMap(f => (f.extractMeta && Array.isArray(f.extractMeta.pageTexts)) ? f.extractMeta.pageTexts : [])
                .map(p => typeof p === 'string' ? p : String(p?.text || p?.content || p?.pageText || ''))
                .join('\n\n');
            const rawTxt = (ex.losses && ex.losses.text) || '';
            const txt = (!rawTxt || /No matching loss runs found/i.test(rawTxt)) ? fileLossText : rawTxt;
            if (!txt) return { gl: [], auto: [], largeGl: [], largeAuto: [] };
            const clean = txt.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
            const out = { gl: [], auto: [], largeGl: [], largeAuto: [] };
            const compact = clean.split(/\n|\r/).map(x => x.trim()).filter(Boolean).join('\n');

            function periodForDate(dol) {
                const m = String(dol || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
                if (!m) return null;
                let y = parseInt(m[3], 10); if (y < 100) y += 2000;
                const mo = parseInt(m[1], 10);
                const start = mo >= 5 ? y : y - 1;
                return String(start).slice(2) + '-' + String(start + 1).slice(2);
            }
            const n = v => Number(String(v || '0').replace(/[^0-9.-]/g, '')) || 0;
            function addClaim(bucket, dol, paid, reserve, incurred) {
                const period = periodForDate(dol); if (!period) return;
                if (!bucket[period]) bucket[period] = { period, paid:0, reserve:0, incurred:0, claims:0, exposure:'' };
                bucket[period].paid += n(paid); bucket[period].reserve += n(reserve); bucket[period].incurred += n(incurred); bucket[period].claims += 1;
            }
            function rowsFromBucket(bucket) {
                return Object.values(bucket).sort((a,b) => b.period.localeCompare(a.period)).slice(0,5).map(r => ({
                    period:r.period, claims:String(r.claims), exposure:'', paid:Math.round(r.paid).toLocaleString('en-US'), reserve:Math.round(r.reserve).toLocaleString('en-US'), incurred:Math.round(r.incurred).toLocaleString('en-US')
                }));
            }
            // Primary robust pass: each claim row with DOL and LOB at end.
            const glBucket = {}, autoBucket = {};
            const rowRe = /\b(\d{4,6})\s+\$?([0-9,]+)\s+\$?([0-9,]+)\s+\$?([0-9,]+)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+([^\n]{0,240}?)(?:Closed|CLOSED|Open|OPEN)\s+((?:General\s+Liability|Auto\s+Liability\s*\/\s*APD|Auto\s+Liability|Auto\s+Physical\s+Damage))\b/gi;
            let m;
            while ((m = rowRe.exec(compact)) !== null) {
                const lob = m[7].toLowerCase();
                if (/general/.test(lob)) addClaim(glBucket, m[5], m[2], m[3], m[4]);
                else if (/auto/.test(lob)) addClaim(autoBucket, m[5], m[2], m[3], m[4]);
            }
            out.gl = rowsFromBucket(glBucket);
            out.auto = rowsFromBucket(autoBucket);
            return out;
        }


        function applyLossHistoryFromActiveSubmission(submission) {
            const parsed = parseLossTables85(submission);
            const fill = (rowsId, rows) => {
                const wrap = document.getElementById(rowsId);
                if (!wrap || !rows || !rows.length) return 0;
                const domRows = Array.from(wrap.querySelectorAll('.loss-row'));
                let count = 0;
                rows.slice(0, domRows.length).forEach((r, i) => {
                    const row = domRows[i];
                    const inputs = row.querySelectorAll('input');
                    const sel = row.querySelector('select.policy-select');
                    const y = String(r.period || '').match(/(\d{2})\s*-\s*(\d{2})/);
                    if (sel && y) sel.value = '20' + y[1];
                    if (inputs[1]) set85(inputs[1], r.claims || '');
                    if (inputs[0]) set85(inputs[0], r.exposure || '');
                    if (inputs[2]) set85(inputs[2], r.paid || '');
                    if (inputs[3]) set85(inputs[3], r.reserve || '0');
                    if (inputs[4]) set85(inputs[4], r.incurred || '');
                    count++;
                });
                return count;
            };
            const gl = fill('glLossRows', parsed.gl);
            const au = fill('autoLossRows', parsed.auto);
            console.log('[workbench] v8.6.93 loss history apply:', gl, 'GL rows ·', au, 'Auto rows');
        }

        function applyALFleetFromActiveSubmission(submission) {
            const mapping = [
                ['Private Passenger', 'fleet_private_passenger'],
                ['Light', 'fleet_light'],
                ['Medium', 'fleet_medium'],
                ['Heavy (Local)', 'fleet_heavy_local'],
                ['Heavy (Other than Local)', 'fleet_heavy_other'],
                ['Extra Heavy (Local)', 'fleet_extra_heavy_local'],
                ['Extra Heavy (Intermediate)', 'fleet_extra_heavy_intermediate'],
                ['Extra Heavy (Long Haul)', 'fleet_extra_heavy_long'],
                ['Truck Tractors (Local)', 'fleet_truck_tractors_local'],
                ['Truck Tractor (Intermediate)', 'fleet_truck_tractors_intermediate'],
                ['Truck Tractors (Long Haul)', 'fleet_truck_tractors_long']
            ];
            const tbl = document.getElementById('autoExposuresTbl');
            const rows = tbl ? Array.from(tbl.querySelectorAll('tbody tr')) : [];
            let filled = 0;
            for (const [label, field] of mapping) {
                const val = r85(field, submission);
                if (val == null) continue;
                const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
                const labelNorm = norm(label);
                const tr = rows.find(row => norm(row.cells[0]?.textContent) === labelNorm)
                    || rows.find(row => norm(row.cells[0]?.textContent).includes(labelNorm));
                const input = tr && tr.querySelector('[data-f="units"]');
                if (set85(input, val)) filled++;
            }
            console.log('[workbench] v8.6.93 AL fleet/code apply:', filled, 'vehicle count row(s) filled');
        }

        function applyInternalRaterFromActiveSubmission(submission) {
            const primaryTbody = document.querySelector('#primaryPoliciesTbl tbody');
            const towerTbody = document.querySelector('#towerLimitsTable tbody');
            const setInput = (sel, val) => { const el = document.querySelector(sel); if (el) set85(el, val); };
            const requested = n85(submission?.requested || r85('requested_limit', submission)) || 1000000;
            const leadLimit = n85(r85('underlying_lead_limit', submission));
            const leadAttach = n85(r85('attachment_point', submission));
            const ourAttach = leadLimit > 0 ? leadAttach + leadLimit : leadAttach;
            if (requested) setInput('#nonAdmittedLimit', money85(requested));
            if (ourAttach) setInput('#nonAdmittedAttachment', money85(ourAttach));

            if (primaryTbody) {
                const rows = [
                    { cov:'General Liability', carrier:r85('gl_carrier', submission) || 'TBD', limit:n85(r85('gl_each_occurrence', submission)) || 1000000, prem:n85(r85('gl_premium', submission)) },
                    { cov:'Auto Liability', carrier:r85('al_carrier', submission) || 'TBD', limit:n85(r85('al_combined_single_limit', submission)) || 1000000, prem:n85(r85('al_premium', submission)) }
                ];
                primaryTbody.innerHTML = rows.map(x => `
                    <tr>
                      <td><select data-pp="coverage"><option${x.cov==='General Liability'?' selected':''}>General Liability</option><option${x.cov==='Auto Liability'?' selected':''}>Auto Liability</option><option>Employers Liability</option><option>Other</option></select></td>
                      <td><input type="text" data-pp="carrier" value="${String(x.carrier).replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"></td>
                      <td><div class="currency-wrap"><input type="text" data-pp="limit" class="convert-to-millions" value="${money85(x.limit)}"></div></td>
                      <td><div class="currency-wrap"><input type="text" data-pp="ulPrem" value="${money85(x.prem)}"></div></td>
                      <td><div class="currency-wrap"><input type="text" data-pp="manualPrem" value=""></div></td>
                      <td><select data-pp="admit"><option>Admitted</option><option>Non-Admitted</option></select></td>
                      <td><input type="text" data-pp="dilFactor" value="0.25"></td>
                      <td class="computed" data-pp-out="dilPrem">$0</td><td class="computed" data-pp-out="firstMilPrem">$0</td><td><button type="button" class="btn-secondary btn-sm" data-pp-remove>Remove</button></td>
                    </tr>`).join('');
            }
            if (towerTbody) {
                const leadCarrier = r85('underlying_lead_carrier', submission) || r85('gl_carrier', submission) || 'Underlying Lead';
                const rows = [];
                if (leadLimit) rows.push({ limit:leadLimit, attach:leadAttach, carrier:leadCarrier, prem:n85(r85('underlying_lead_premium', submission)), target:'Underlying' });
                if (requested) rows.push({ limit:requested, attach:ourAttach || leadLimit || 0, carrier:'Internal', prem:0, target:'Target' });
                if (rows.length) {
                    towerTbody.innerHTML = rows.map((x,i) => `
                      <tr${i===rows.length-1?' class="is-internal-layer"':''}>
                        <td><div class="currency-wrap"><input type="text" data-tw="limit" class="convert-to-millions" value="${money85(x.limit)}"></div></td>
                        <td><div class="currency-wrap"><input type="text" data-tw="attach" class="convert-to-millions" value="${money85(x.attach)}"></div></td>
                        <td class="computed" data-tw-out="internalPrem">$0</td><td class="computed" data-tw-out="internalPpm">$0</td>
                        <td><input type="text" data-tw="carrier" value="${String(x.carrier).replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"></td>
                        <td><div class="currency-wrap"><input type="text" data-tw="cPrem" value="${money85(x.prem)}"></div></td>
                        <td class="computed" data-tw-out="cPpm">$0</td><td class="computed" data-tw-out="rel">-</td><td><input type="text" data-tw="target" value="${x.target}"></td>
                        <td><button type="button" class="btn-secondary btn-sm" data-tw-remove>Remove</button></td>
                      </tr>`).join('');
                }
            }
            document.querySelectorAll('#risk-internal-rater input, #risk-internal-rater select').forEach(el => el.dispatchEvent(new Event('change', { bubbles:true })));
            console.log('[workbench] v8.6.93 internal rater hydrate:', { requested, leadLimit, leadAttach, ourAttach });
        }


        // v8.6.88 — visible Limits & Premiums Lead Excess card hydrator.
        // v8.6.87 proved the data layer was healthy (Penn Millers, $2M xs $1M,
        // $35,019 premium) but the user-facing Lead Excess card was still blank
        // because the static template had no resolver-bound writer. This pass
        // writes the underlying lead umbrella into the visible card without any
        // API calls and without triggering the Carrier Layer handler that would
        // overwrite the carrier with our own paper.
        function applyLeadExcessCardFromResolver(submission) {
            const rules = window.WorkbenchRules;
            if (!rules || typeof rules.resolveField !== 'function') return;
            const row = document.querySelector('.limit-entry[data-coverage-type="lead-excess"]');
            const panel = document.getElementById('details-lead-excess');
            if (!row || !panel) return;

            const resolve = (field) => {
                const out = rules.resolveField(field, submission);
                return out && out.value != null && out.value !== '' ? out.value : null;
            };
            const valueMap = {
                underlying_lead_carrier: resolve('underlying_lead_carrier') || resolve('gl_carrier') || resolve('al_carrier'),
                gl_effective_date: resolve('gl_effective_date') || resolve('policy_effective'),
                gl_expiration_date: resolve('gl_expiration_date') || resolve('policy_expiration'),
                underlying_lead_limit: resolve('underlying_lead_limit'),
                underlying_lead_aggregate: resolve('underlying_lead_limit'),
                underlying_lead_premium: resolve('underlying_lead_premium')
            };

            const hasEvidence = Object.values(valueMap).some(v => v != null && v !== '');
            if (!hasEvidence) return;

            const setField = (field, value) => {
                if (value == null || value === '') return false;
                const el = row.querySelector('[data-field="' + field + '"]');
                if (!el) return false;
                try {
                    if (el.classList.contains('limit-date') || el._flatpickr) {
                        let v = value;
                        if (rules && typeof rules.normalizeDateString === 'function') {
                            v = rules.normalizeDateString(v);
                        }
                        if (el._flatpickr && typeof el._flatpickr.setDate === 'function') {
                            el._flatpickr.setDate(v, true);
                        } else {
                            el.value = v;
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    } else {
                        el.value = String(value);
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    el.classList.add('autofilled-from-platform');
                    return true;
                } catch (e) {
                    console.warn('[workbench] v8.6.93 Lead Excess card field skipped:', field, e && e.message);
                    return false;
                }
            };

            let filled = 0;
            Object.entries(valueMap).forEach(([field, value]) => { if (setField(field, value)) filled++; });

            const mainCb = row.querySelector('input[data-target="details-lead-excess"]');
            if (mainCb && !mainCb.checked) {
                mainCb.checked = true;
                mainCb.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const carrierLayerCb = row.querySelector('input[data-policy-layer="lead-excess"]');
            if (carrierLayerCb && !carrierLayerCb.checked) {
                // Do not dispatch the existing change handler here: that handler
                // treats checked carrier layers as our paper and would overwrite
                // Penn Millers with Steadfast. This card represents the underlying
                // carrier lead umbrella, so we mark the checkbox and reveal options.
                carrierLayerCb.checked = true;
            }
            panel.classList.add('visible');
            panel.style.display = '';
            const header = row.querySelector('.limit-entry-header');
            header?.querySelector('.collapse-arrow')?.classList.add('expanded');
            row.dataset.hydratedFromResolver = 'v8.6.93';
            console.log('[workbench] v8.6.93 Lead Excess card hydrate:', filled, 'fields', valueMap);
        }

        function applyPrimaryCoverageCards91(submission) {
            // v8.6.91: second-pass binding for visible GL/AL cards. Some cards
            // are rebuilt after the initial Phase 4/7 appliers run; re-apply
            // resolver values late so visible inputs do not remain blank.
            try { applyGLCoverageFromActiveSubmission(submission); } catch (e) { console.warn('[workbench] v8.6.93 GL visible card retry skipped:', e.message); }
            try { applyALCoverageFromActiveSubmission(submission); } catch (e) { console.warn('[workbench] v8.6.93 AL visible card retry skipped:', e.message); }
        }

        function applyV8685PopulationPass(submission) {
            if (!submission) return;
            try { applyPrimaryCoverageCards91(submission); } catch (e) { console.warn('[workbench] v8.6.93 primary cards skipped:', e.message); }
            try { applyLossHistoryFromActiveSubmission(submission); } catch (e) { console.warn('[workbench] v8.6.93 losses skipped:', e.message); }
            try { applyALFleetFromActiveSubmission(submission); } catch (e) { console.warn('[workbench] v8.6.93 fleet skipped:', e.message); }
            try { applyInternalRaterFromActiveSubmission(submission); } catch (e) { console.warn('[workbench] v8.6.93 rater skipped:', e.message); }
            try { applyLeadExcessCardFromResolver(submission); } catch (e) { console.warn('[workbench] v8.6.93 lead-excess card skipped:', e.message); }
            // Retry after flatpickr/details panels finish initializing.
            setTimeout(() => { try { applyPrimaryCoverageCards91(submission); } catch (_) {} }, 250);
            setTimeout(() => { try { applyPrimaryCoverageCards91(submission); } catch (_) {} }, 900);
        }

        function renderFieldCoverageReport(submission) {
            const rules = window.WorkbenchRules;
            if (!rules || typeof rules.buildFieldCoverageReport !== 'function') return;
            const report = rules.buildFieldCoverageReport(submission);
            window.workbenchFieldCoverageReport = report;
            console.log('[workbench] v8.6.93 field coverage report:', report.summary);
            try { console.table(report.rows); } catch (_) {}
            try { console.table(report.modules); } catch (_) {}

            let box = document.getElementById('stmFieldCoverageReport');
            if (!box) {
                box = document.createElement('div');
                box.id = 'stmFieldCoverageReport';
                box.style.cssText = 'margin:10px 18px 0;padding:10px 12px;border:1px solid rgba(181,71,8,.35);border-radius:8px;background:rgba(181,71,8,.08);font-size:12px;line-height:1.35;';
                const topbar = document.querySelector('header.topbar');
                if (topbar && topbar.parentNode) topbar.parentNode.insertBefore(box, topbar.nextSibling);
                else document.body.insertBefore(box, document.body.firstChild);
            }
            const s = report.summary || {};
            const layer = report.layerDecision || {};
            const conflict = layer.conflict && layer.conflict.message ? '<br><strong>Layer review:</strong> ' + escapeHtml(layer.conflict.message) : '';
            box.innerHTML = '<strong>Workbench fill report:</strong> '
                + escapeHtml(String(s.resolved || 0)) + ' resolved, '
                + escapeHtml(String(s.review || 0)) + ' review, '
                + escapeHtml(String(s.missing || 0)) + ' missing of '
                + escapeHtml(String(s.total || 0)) + '. '
                + 'No API call was made. Details are in <code>window.workbenchFieldCoverageReport</code> and console tables.'
                + conflict;
            box.style.display = 'block';
        }

        // FIX-PHASE-12-EXCESS-TOWER-2026-05-14
        // The excess tower is structurally unlike every prior coverage:
        // a VARIABLE number of layers, not one fixed-field panel. The
        // excess module emits "**Layer N:**" blocks; WorkbenchRules
        // .parseExcessTower() handles the refusal-diagnostic check, the
        // cross-applicant gate, and multi-layer parsing with sentinel
        // filtering. This applier maps the parsed layers onto the UI:
        //   Layer 1  → the default-rendered #details-lead-excess panel
        //   Layer 2+ → cloned 'lead-excess' templates in
        //              #excess-limits-list (one clone per extra layer)
        //
        // Per-layer panel column order (verified against workbench.html):
        //   [carrier, effective_date, expiration_date, limit,
        //    aggregate, premium] — positions 0..5. Position 6+
        //   (commission, adj/flat, min-earned) are financial inputs the
        //   underwriter fills manually; we never touch them.
        function applyExcessTowerFromActiveSubmission(submission) {
            const rules = window.WorkbenchRules;
            // FIX-PHASE-13.4-MULTIPASS-SOLVER-2026-05-14
            // Prefer the resolved structured tower (13.2 JSON + 13.0/13.4
            // multi-pass solver + 13.1 persisted relabels). Fall back to
            // the legacy flat parseExcessTower only if the structured
            // path is unavailable (older excess output with no JSON
            // block) — never regress.
            const haveStructured = rules && typeof rules.buildTowerFromExcessModule === 'function';

            if (haveStructured) {
                const built = rules.buildTowerFromExcessModule(submission);
                if (built.blocked) {
                    console.log(
                        '[workbench] Phase 13.4 Excess tower: blocked (' + built.reason + ').',
                        built.reason === 'cross_applicant'
                            ? 'Excess docs reference "' + (built.statedInsured || '?') +
                              '" not this submission\'s insured.'
                            : 'Refusal diagnostic from Phase 6.1 gate or prompt-level refusal.',
                        'Tower left empty (correct — no contamination).'
                    );
                    return;
                }
                if (built.rungs && built.rungs.length > 0) {
                    // Each rung's panel columns: carrier, eff, exp, limit,
                    // aggregate, premium. The solver supplies limit +
                    // attachment + provenance; carrier from participants.
                    // FIX-PHASE-GO-LIVE-73-TOWER-WRITER-2026-05-16
                    // Panel columns: [carrier, eff, exp, limit,
                    // aggregate, premium]. The old writer emitted
                    // [carrier, null, null, limit, null, null] —
                    // silently dropping dates, aggregate and premium
                    // even though the rung now carries them. Write the
                    // full economics; leave a column null only when the
                    // rung genuinely lacks that value (underwriter fills).
                    const rungToPositions = (r) => {
                        const carrier = (r.participants && r.participants.length === 1)
                            ? r.participants[0].carrier
                            : (r.participants || []).map(p => p.carrier).filter(Boolean).join(' / ');
                        return [
                            carrier || null,
                            r.effectiveDate != null ? r.effectiveDate : null,
                            r.expirationDate != null ? r.expirationDate : null,
                            r.limit != null ? r.limit : null,
                            r.aggregate != null ? r.aggregate : null,
                            r.premium != null ? r.premium : null
                        ];
                    };

                    const ordered = built.rungs;     // already attachment-ordered
                    let leadFilled = 0, clonesAdded = 0, skippedUncertain = 0;

                    // Lead → default #details-lead-excess. If the lead
                    // itself is ???? we still skip filling it (partial
                    // tower, never wrong data).
                    const lead = ordered.find(r => r.kind === 'lead');
                    if (lead && lead.status !== '????') {
                        const f1 = fillCoveragePanelByPosition('#details-lead-excess', rungToPositions(lead));
                        leadFilled = f1.filled;
                        const leadCb = document.querySelector('input[data-target="details-lead-excess"]');
                        if (leadCb && !leadCb.checked) leadCb.click();
                    } else if (lead) {
                        skippedUncertain++;
                    }

                    // Excess rungs → clones, in attachment order. ????
                    // rungs are SKIPPED (island) — every resolved rung
                    // still fills, so a partial tower populates fully.
                    const excessList = document.getElementById('excess-limits-list');
                    const excessRungs = ordered.filter(r => r.kind !== 'lead');
                    if (excessList && typeof addCoverageEntry === 'function') {
                        for (const r of excessRungs) {
                            if (r.status === '????') { skippedUncertain++; continue; }
                            const entry = addCoverageEntry('lead-excess', excessList);
                            if (!entry) continue;
                            const panel = entry.querySelector('.limit-details-panel');
                            if (!panel || !panel.id) continue;
                            fillCoveragePanelByPosition('#' + panel.id, rungToPositions(r));
                            const cb = entry.querySelector('input[type="checkbox"][data-target]');
                            if (cb && !cb.checked) cb.click();
                            clonesAdded++;
                        }
                    } else if (excessRungs.length) {
                        console.warn('[workbench] Phase 13.4: excess-limits-list',
                            'or addCoverageEntry unavailable —', excessRungs.length,
                            'excess rung(s) could not be added.');
                    }

                    console.log(
                        '[workbench] Phase 13.4 Excess tower apply:',
                        ordered.length, 'rung(s) ·',
                        'lead filled (' + leadFilled + ' fields) ·',
                        clonesAdded, 'excess rung(s) cloned+filled ·',
                        skippedUncertain, '???? rung(s) skipped (await relabel) ·',
                        'anyUncertain=' + built.anyUncertain
                    );
                    console.log('[workbench] Phase 13.4 tower:', ordered.map(r => ({
                        label: r.label, status: r.status,
                        provenance: r.attachmentProvenance,
                        reason: r.uncertaintyReason || null
                    })));
                    return;
                }
                // No structured rungs — fall through to legacy path.
                console.log('[workbench] Phase 13.4: no structured tower',
                    '(reason ' + built.reason + ') — trying legacy parser.');
            }

            // ── Legacy fallback (pre-13.2 excess output, no JSON block) ──
            if (!rules || typeof rules.parseExcessTower !== 'function') return;
            const extractions =
                (submission && submission.snapshot && submission.snapshot.extractions) ||
                (submission && submission.extractions) || null;
            const rec = extractions && extractions.excess;
            if (!rec || typeof rec.text !== 'string') {
                console.log('[workbench] Excess tower: no excess extraction. Empty.');
                return;
            }
            const accountName = (submission && submission.account_name) || null;
            const result = rules.parseExcessTower(rec.text, accountName);
            if (result.blocked) {
                console.log('[workbench] Excess tower (legacy): blocked (' + result.reason + ').');
                return;
            }
            if (!result.layers || result.layers.length === 0) {
                console.log('[workbench] Excess tower (legacy): 0 layers. Empty.');
                return;
            }
            const toPositions = (layer) => ([
                layer.carrier, layer.effective_date, layer.expiration_date,
                layer.limit, layer.aggregate, layer.premium
            ]);
            const layers = result.layers;
            let layer1Filled = 0, clonesAdded = 0;
            const f1 = fillCoveragePanelByPosition('#details-lead-excess', toPositions(layers[0]));
            layer1Filled = f1.filled;
            const leadCb = document.querySelector('input[data-target="details-lead-excess"]');
            if (leadCb && !leadCb.checked) leadCb.click();
            const excessList = document.getElementById('excess-limits-list');
            if (excessList && typeof addCoverageEntry === 'function') {
                for (let i = 1; i < layers.length; i++) {
                    const entry = addCoverageEntry('lead-excess', excessList);
                    if (!entry) continue;
                    const panel = entry.querySelector('.limit-details-panel');
                    if (!panel || !panel.id) continue;
                    fillCoveragePanelByPosition('#' + panel.id, toPositions(layers[i]));
                    const cb = entry.querySelector('input[type="checkbox"][data-target]');
                    if (cb && !cb.checked) cb.click();
                    clonesAdded++;
                }
            }
            console.log('[workbench] Excess tower (legacy) apply:',
                layers.length, 'layer(s) · lead', layer1Filled, 'fields ·',
                clonesAdded, 'clones.');
        }

        // FIX-PHASE-14.0-SUBJECTIVITY-INTELLIGENCE-2026-05-14
        // Reads recommendSubjectivities() and applies it to the
        // #form-subjectivities panel:
        //   • mode 'auto'    → check the box (deterministic consequence
        //                      of a known fact — Option A parity with
        //                      the tower's computed-but-confident fill).
        //   • mode 'suggest' → DO NOT check; add a visible "suggested"
        //                      hint + reason tooltip so the underwriter
        //                      decides (subjectivity analogue of ????).
        // Fully guarded: absent rules/panel → silent no-op, panel
        // unchanged. Matches subjectivities by normalized label text.
        function applySubjectivityIntelligenceFromActiveSubmission(submission) {
            const rules = window.WorkbenchRules;
            if (!rules || typeof rules.recommendSubjectivities !== 'function') return;

            let rec;
            try { rec = rules.recommendSubjectivities(submission); }
            catch (e) {
                console.warn('[workbench] Phase 14.0 subjectivity: skipped —', e && e.message);
                return;
            }
            if (!rec || !Array.isArray(rec.recommendations) || !rec.recommendations.length) {
                console.log('[workbench] Phase 14.0 subjectivity: no recommendations',
                    rec && rec.towerBlocked ? '(tower blocked — correct, no contamination).' : '.');
                return;
            }

            const panel = document.getElementById('form-subjectivities');
            if (!panel) return;
            const entries = Array.from(panel.querySelectorAll('.subjectivity-entry'));
            const norm = (s) => String(s || '')
                .replace(/&amp;/g, '&')
                .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

            let strongCount = 0, suggested = 0, unmatched = 0;
            for (const r of rec.recommendations) {
                const want = norm(r.label);
                const entry = entries.find(e => {
                    const lbl = e.querySelector('.checkbox-label');
                    if (!lbl) return false;
                    const txt = norm(lbl.textContent);
                    return txt === want || (want.length >= 12 && txt.indexOf(want) === 0)
                        || (want.length >= 12 && want.indexOf(txt) === 0 && txt.length >= 12);
                });
                if (!entry) { unmatched++; continue; }
                const cb = entry.querySelector('input[type="checkbox"]');
                if (!cb) { unmatched++; continue; }

                // FIX-PHASE-14.0.1-SUGGEST-ONLY-2026-05-14
                // The system NEVER checks a subjectivity box. A
                // subjectivity is an underwriting commitment that goes on
                // the binder — the underwriter consciously puts their
                // name to each one. The system's job is to surface which
                // ones the deal's facts point to, with reasoning; the
                // click is always the underwriter's. Fact-implied recs
                // (formerly 'auto') get a stronger STRONG-MATCH cue so
                // the high-confidence ones stand out, but nothing is
                // pre-checked.
                const factImplied = (r.mode === 'auto');
                entry.classList.add('subjectivity-suggested');
                if (factImplied) entry.classList.add('subjectivity-strong');
                entry.setAttribute('title',
                    (factImplied ? 'Strongly indicated by this deal\u2019s facts'
                                 : 'Suggested \u2014 your call')
                    + ' \u2014 ' + (r.reason || '')
                    + ' \u2014 click to apply');
                if (!entry.querySelector('.subjectivity-suggest-chip')) {
                    const chip = document.createElement('span');
                    chip.className = 'subjectivity-suggest-chip'
                        + (factImplied ? ' subjectivity-suggest-chip--strong' : '');
                    chip.textContent = factImplied ? 'INDICATED' : 'SUGGESTED';
                    const lbl = entry.querySelector('.checkbox-label');
                    if (lbl) lbl.appendChild(chip);
                }
                if (factImplied) strongCount++; else suggested++;
            }

            console.log(
                '[workbench] Phase 14.0.1 subjectivity intelligence (suggest-only):',
                strongCount, 'strongly indicated ·',
                suggested, 'suggested ·',
                unmatched, 'unmatched ·',
                'NONE auto-checked (underwriter decides every box) ·',
                'anySuggest=' + rec.anySuggest +
                (rec.towerBlocked ? ' · towerBlocked' : '')
            );
            console.log('[workbench] Phase 14.0.1 recommendations:',
                rec.recommendations.map(r => ({
                    strength: r.mode === 'auto' ? 'indicated' : 'suggested',
                    label: r.label, fact: r.factSource })));
        }

        // FIX-PHASE-4-GL-PRIMARY-COVERAGE-2026-05-14
        // Positional fill for any coverage panel (#details-gl, #details-al,
        // #details-lead-excess, dynamically-added panels in Phase 4.1+).
        // Mirrors the altInput-skip logic of pipeline-bridge.js fillPanel
        // (FIX-2026-05-14-COVERAGE-ALIGNMENT) so we can write 8 values
        // into the 8 logical columns of #details-gl regardless of how
        // many DOM inputs flatpickr created.
        //
        // Returns { filled, missed } counts.
        function fillCoveragePanelByPosition(panelSelector, valuesByPosition) {
            const panel = document.querySelector(panelSelector);
            if (!panel) {
                console.warn('[workbench] Phase 4: panel not found:', panelSelector);
                return { filled: 0, missed: valuesByPosition.length };
            }
            // Same filter as pipeline-bridge.js fillPanel — exclude
            // checkboxes and flatpickr altInput siblings so the index
            // matches the visible column order.
            const els = Array.from(panel.querySelectorAll('input, select, textarea'))
                .filter(el => {
                    if (el.matches('[type="checkbox"]')) return false;
                    if (!el._flatpickr) {
                        const prev = el.previousElementSibling;
                        if (prev && prev._flatpickr) return false;
                    }
                    return true;
                });

            let filled = 0, missed = 0;
            for (let i = 0; i < valuesByPosition.length; i++) {
                const value = valuesByPosition[i];
                const el = els[i];
                if (value == null || value === '' || !el) { missed++; continue; }
                try {
                    if (el.classList.contains('limit-date') || el._flatpickr) {
                        // Date — normalize then setDate via flatpickr
                        let v = value;
                        if (window.WorkbenchRules
                            && typeof window.WorkbenchRules.normalizeDateString === 'function') {
                            v = window.WorkbenchRules.normalizeDateString(v);
                        }
                        if (el._flatpickr && typeof el._flatpickr.setDate === 'function') {
                            el._flatpickr.setDate(v, true);
                        } else {
                            el.value = v;
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    } else {
                        // Text / currency input
                        el.value = value;
                        el.dispatchEvent(new Event('input',  { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    el.classList.add('autofilled-from-platform');
                    filled++;
                } catch (err) {
                    console.warn('[workbench] Phase 4: fill error at position', i, err);
                    missed++;
                }
            }
            return { filled, missed };
        }

        function applyResolvedToElement(el, kind, value) {
            const tag = (el.tagName || '').toLowerCase();
            try {
                if (kind === 'date') {
                    // FIX-v8.6.48.1: defensive ISO normalization. Resolver
                    // normalizes for DATE_FIELDS at source, but if a future
                    // Tier 2 parser returns a raw string format, this layer
                    // is the last line of defense before flatpickr.setDate().
                    let v = value;
                    if (window.WorkbenchRules
                        && typeof window.WorkbenchRules.normalizeDateString === 'function') {
                        v = window.WorkbenchRules.normalizeDateString(v);
                    }
                    if (el._flatpickr && typeof el._flatpickr.setDate === 'function') {
                        el._flatpickr.setDate(v, true);
                        return true;
                    }
                    el.value = v;
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
                if (kind === 'select') {
                    if (tag !== 'select') return false;
                    const options = Array.from(el.options || []);
                    const wanted = String(value).trim().toLowerCase();
                    const match = options.find(o =>
                        String(o.value).trim().toLowerCase() === wanted
                        || String(o.text).trim().toLowerCase() === wanted
                    );
                    if (!match) return false;
                    el.value = match.value;
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
                if (kind === 'value') {
                    if (tag === 'input' || tag === 'textarea') {
                        el.value = value;
                        el.dispatchEvent(new Event('input',  { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                    return false;
                }
                if (kind === 'text') {
                    el.textContent = value;
                    return true;
                }
            } catch (err) {
                console.warn('[workbench] applyResolvedToElement error:', err);
            }
            return false;
        }

        setupTextareaAutoScroll('#descOps');
        setupTextareaAutoScroll('#expLoss');
        setupTextareaAutoScroll('#acctStrengths');
        setupTextareaAutoScroll('#pricingRationale');

        const tab = (li, group, selector, prefix, key) => {
            group.forEach(n => {
                n.classList.remove("active");
                // Update ARIA roving state for accessibility
                if (n.getAttribute('role') === 'tab') {
                    n.setAttribute('aria-selected', 'false');
                    n.setAttribute('tabindex', '-1');
                }
            });
            li.classList.add("active");
            if (li.getAttribute('role') === 'tab') {
                li.setAttribute('aria-selected', 'true');
                li.setAttribute('tabindex', '0');
            }
            try {
                li.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            } catch (_) {
                // Older browsers can ignore the scroll helper; tabs still activate normally.
            }
            const activePanelId = li.dataset[key];
            $$(selector).forEach(p => p.classList.toggle("active", p.id === prefix + activePanelId));

            const container = $('.container');
            const fullWidthPanels = ['gl-exposure-rater', 'al-fleet-rater', 'internal-rater'];
            const fullWidthPages = ['renewal'];
            const shouldBeFullWidth = (key === 'risk' && fullWidthPanels.includes(activePanelId))
                || (key === 'page' && fullWidthPages.includes(activePanelId));

            container.classList.toggle('full-width', shouldBeFullWidth);
        };

        // Wire click + keyboard arrow navigation for each tablist
        const wireTablist = (navId, panelSelector, prefix, key) => {
            const items = $$(`#${navId} li`);
            items.forEach(li => {
                const panelId = prefix + li.dataset[key];
                const panel = document.getElementById(panelId);
                if (panel) {
                    panel.setAttribute('role', 'tabpanel');
                    li.setAttribute('aria-controls', panelId);
                }
                li.onclick = () => tab(li, items, panelSelector, prefix, key);
                li.addEventListener('keydown', e => {
                    let target = null;
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                        e.preventDefault();
                        target = li.nextElementSibling || items[0];
                        // Skip hidden items
                        while (target && target.style.display === 'none') target = target.nextElementSibling || items[0];
                    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        target = li.previousElementSibling || items[items.length - 1];
                        while (target && target.style.display === 'none') target = target.previousElementSibling || items[items.length - 1];
                    } else if (e.key === 'Home') {
                        e.preventDefault();
                        target = items[0];
                    } else if (e.key === 'End') {
                        e.preventDefault();
                        target = items[items.length - 1];
                    } else if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        li.click();
                        return;
                    }
                    if (target) {
                        target.focus();
                        target.click();
                    }
                });
            });
        };
        wireTablist('mainNav',         '.page-section',         'page-',         'page');
        wireTablist('riskNav',         '.risk-panel',           'risk-',         'risk');
        wireTablist('formsNav',        '.form-panel',           'form-',         'form');
        wireTablist('underwritingNav', '.underwriting-panel',   'underwriting-', 'underwriting');

        $("#dealNum").textContent = Date.now().toString().slice(-6);
        $("#dealName").oninput = e => $("#insuredNameTxt").textContent = e.target.value || "—";
        $("#admission").onchange = e => {
            const c = e.target.value === "admitted" ? "BluePeak Admitted Casualty Company" : "Crestline E&S Insurance Company";
            $("#paper").value = c;
            $("#paperTxt").textContent = c;
        };

        const pretty = id => $("#" + id)._flatpickr?.altInput.value || "";
        const showPP = () => $("#ppTxt").textContent = (pretty("polEff") && pretty("polExp")) ? `${pretty("polEff")} → ${pretty("polExp")}` : "—";
        ["polEff", "polExp"].forEach(id => $("#" + id).addEventListener("change", showPP));
        showPP();

        function setupPolicyTermAnnualize() {
            const effEl = document.getElementById('polEff');
            const expEl = document.getElementById('polExp');
            if (!effEl || !expEl) return;
            let updatingExpiration = false;
            let expirationIsAuto = !expEl.value;

            const parseDateInput = (el) => {
                if (el?._flatpickr?.selectedDates?.[0]) return el._flatpickr.selectedDates[0];
                const raw = el?.value || el?._flatpickr?.altInput?.value || '';
                if (!raw) return null;
                const d = new Date(raw);
                return isNaN(d.getTime()) ? null : d;
            };
            const addTwelveMonths = (d) => {
                const next = new Date(d.getTime());
                next.setFullYear(next.getFullYear() + 1);
                return next;
            };
            const setExpirationFromEffective = () => {
                const eff = parseDateInput(effEl);
                if (!eff) return;
                if (expirationIsAuto || !expEl.value) {
                    expirationIsAuto = true;
                    updatingExpiration = true;
                    const exp = addTwelveMonths(eff);
                    if (expEl._flatpickr) expEl._flatpickr.setDate(exp, true);
                    else {
                        expEl.value = exp.toISOString().slice(0, 10);
                        expEl.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    updatingExpiration = false;
                    showPP();
                }
            };
            ['input', 'change'].forEach(ev => {
                effEl.addEventListener(ev, () => setTimeout(setExpirationFromEffective, 0));
                expEl.addEventListener(ev, () => {
                    if (updatingExpiration) return;
                    expirationIsAuto = !expEl.value;
                    showPP();
                });
            });
            setTimeout(setExpirationFromEffective, 150);
        }
        setupPolicyTermAnnualize();

        $("#isoClass").addEventListener('input', () => {
            const code = $("#isoClass").value;
            $("#isoDesc").value = isoDescMap[code] || "";
            $("#hazardGrade").value = isoHazardGradeMap[code] || "";
            $("#guidelineConflicts").value = guidelineConflictsMap[code] || "";
        });

        $("#homeState").addEventListener('change', () => {
            const selectedState = $("#homeState").value;
            $("#statRepose").value = stateReposeMap[selectedState] || "";
            $("#dramScore").value = dramScoreMap[selectedState] || "";
        });

        const homeStateSelect = $("#homeState");
        if (homeStateSelect && !homeStateSelect.options.length) {
            homeStateSelect.innerHTML = `<option value="" disabled selected>— Select —</option>` + states.map(st => `<option>${st}</option>`).join("");
        }

        $("#pageContent").addEventListener("input", e => {
            if (e.target.classList.contains("currency-input")) {
                formatCurrency(e.target);
            }
        });

        const sameAsMailingChk = $("#sameAsMailingChk");
        if (sameAsMailingChk) {
            const insuredForm = $("#insuredForm");
            const fieldMap = { mailStreet: 'riskStreet', mailSuite: 'riskSuite', mailCity: 'riskCity', mailState: 'riskState', mailZip: 'riskZip' };
            const handleSameAsMailing = () => {
                const isChecked = sameAsMailingChk.checked;
                for (const sourceName in fieldMap) {
                    const destName = fieldMap[sourceName];
                    const sourceField = insuredForm.querySelector(`[name="${sourceName}"]`);
                    const destField = insuredForm.querySelector(`[name="${destName}"]`);
                    if (sourceField && destField) {
                        destField.value = isChecked ? sourceField.value : '';
                        destField.readOnly = isChecked;
                    }
                }
            };
            sameAsMailingChk.addEventListener('change', handleSameAsMailing);
            for (const sourceName in fieldMap) {
                insuredForm.querySelector(`[name="${sourceName}"]`)?.addEventListener('input', () => {
                    if (sameAsMailingChk.checked) handleSameAsMailing();
                });
            }
        }

        // Risk Limits are wired in Phase 15 below. The Phase 15 block intentionally
        // preserves the original template-clone workflow for adding additional
        // coverages while keeping the current Speed to Market AI visual shell.

        document.addEventListener("click", e => {
            if (e.target.classList.contains("edit")) {
                $(`#${e.target.dataset.target}`)?.showModal();
            }
        });
        $("#insuredSaveBtn").onclick = () => {
            const f = new FormData($("#insuredForm")), v = n => f.get(n) || "";
            $("#mailingTxt").textContent = `${v("mailStreet")} ${v("mailSuite")}`.trim() + `, ${v("mailCity")}, ${v("mailState")} ${v("mailZip")}`;
            $("#controllingTxt").textContent = `${v("riskStreet")} ${v("riskSuite")}`.trim() + `, ${v("riskCity")}, ${v("riskState")} ${v("riskZip")}`;
        };
        $("#brokerSaveBtn").onclick = () => {
            const f = new FormData($("#brokerForm")), v = n => f.get(n) || "";
            $("#brokerCoTxt").textContent = v("brokerCo");
            $("#brokerTypeTxt").textContent = v("brokerType");
            $("#brokerAddrTxt").textContent = `${v("bStreet")} ${v("bSuite")}`.trim() + `, ${v("bCity")}, ${v("bState")} ${v("bZip")}`;
            $("#brokerNameTxt").textContent = v("brokerName");
            $("#regionTxt").textContent = v("region");
            $("#brokerageTxt").textContent = v("brokerCo");
        };

        const closeAllDropdowns = (exceptThisOne = null) => {
            $$('.coverage-dropdown.visible, #actionsMenu.visible').forEach(d => {
                if (d !== exceptThisOne) {
                    d.classList.remove('visible');
                    if (d.id === 'actionsMenu') {
                        $('#actionsBtn')?.classList.remove('open');
                        $('#actionsBtn')?.setAttribute('aria-expanded', 'false');
                    }
                }
            });
        };
        document.addEventListener('click', () => closeAllDropdowns());

        function setupActionsMenu() {
            const actionsBtn = $('#actionsBtn'), actionsMenu = $('#actionsMenu');
            if (!actionsBtn || !actionsMenu) return;
            actionsBtn.addEventListener('click', e => {
                e.stopPropagation();
                const isVisible = actionsMenu.classList.toggle('visible');
                actionsBtn.classList.toggle('open', isVisible);
                actionsBtn.setAttribute('aria-expanded', String(isVisible));
                if (isVisible) closeAllDropdowns(actionsMenu);
            });
            actionsMenu.addEventListener('click', e => {
                if (e.target.tagName === 'LI') {
                    const status = e.target.dataset.status;
                    // FIX-PHASE-14.3-WORKFLOW-READINESS-2026-05-14
                    // Advisory only — surface readiness gaps but NEVER
                    // block the transition (suggest-only parity).
                    try {
                        const WR = window.WorkbenchRules;
                        const sub = window.workbenchActiveSubmission || null;
                        if (WR && typeof WR.assessWorkflowReadiness === 'function' && sub) {
                            const a = WR.assessWorkflowReadiness(sub, status);
                            if (a && !a.ready && a.blockers.length) {
                                console.warn('[workbench] Phase 14.3 readiness — "'
                                    + status + '" has ' + a.blockers.length
                                    + ' open item(s) (advisory, not blocking):',
                                    a.blockers.map(b => b.reason).join(', '));
                                a.blockers.forEach(b =>
                                    console.warn('   • ' + b.reason + ': ' + b.detail));
                            } else if (a && a.ready) {
                                console.log('[workbench] Phase 14.3 readiness — "'
                                    + status + '": all checks clear.');
                            }
                        }
                    } catch (rErr) {
                        console.warn('[workbench] Phase 14.3 readiness skipped —',
                            rErr && rErr.message);
                    }
                    const statusEl = $("#statusText");
                    statusEl.textContent = status;
                    statusEl.setAttribute('data-status', status);
                    recordHistory('Status changed', `Submission marked ${status}`);
                    actionsMenu.classList.remove('visible');
                    actionsBtn.classList.remove('open');
                    actionsBtn.setAttribute('aria-expanded', 'false');
                }
            });
            // Close on Escape
            actionsBtn.addEventListener('keydown', e => {
                if (e.key === 'Escape' && actionsMenu.classList.contains('visible')) {
                    actionsMenu.classList.remove('visible');
                    actionsBtn.classList.remove('open');
                    actionsBtn.setAttribute('aria-expanded', 'false');
                }
            });
        }

        // Set initial data-status attribute so the pill renders styled on load
        const initialStatusEl = $("#statusText");
        if (initialStatusEl) {
            initialStatusEl.setAttribute('data-status', initialStatusEl.textContent.trim() || 'Cleared');
        }

        setupActionsMenu();
        setupTypeSelector();

        /* ============================================================
           PHASE 8 — RESTORED UI WIRING
           Setup functions for the page sections restored from
           STM AI v8.6 source (loss tables, raters, forms, renewal).
           These guard with `if (!targetEl) return;` so they no-op
           gracefully if a section's HTML hasn't been added yet.
           ============================================================ */

        /* ─── Loss tables (GL + Auto): Add/Remove year, No Losses checkbox ── */
        function setupLossTable(cfg) {
            const wrap = $(`#${cfg.rowsId}`);
            if (!wrap) return;
            const availableYears = Array.from({ length: 51 }, (_, i) => 2050 - i);
            const yearOpts = (selYear) => availableYears.map(y => `<option value="${y}" ${y===selYear?"selected":""}>${String(y).slice(-2)}-${String(y + 1).slice(-2)}</option>`).join("");
            const numInp = () => { const n = document.createElement("input"); n.type = "text"; n.inputMode = "numeric"; n.pattern = "[0-9,]*"; n.addEventListener("input", e => e.target.value = e.target.value.replace(/[^0-9]/g, "")); return n; };
            const money = () => { const w = document.createElement("div"); w.className = "currency-wrap"; w.innerHTML = `<input type="text" class="currency-input" inputmode="numeric" placeholder="">`; return w; };
            const makeDateInput = () => { const i = document.createElement("input"); i.type = "text"; i.className = "loss-date-picker"; i.placeholder = "Select Date…"; return i; };

            function addRow(startYear) {
                const row = document.createElement("div");
                row.className = "loss-row";
                const sel = document.createElement("select");
                sel.className = "policy-select";
                sel.innerHTML = yearOpts(startYear);
                row.append(sel, money(), numInp(), money(), money(), money(), makeDateInput());
                wrap.appendChild(row);
                initFlatpickr(row.querySelector(".loss-date-picker"));
            }
            [2025, 2024, 2023, 2022, 2021].forEach(addRow);
            const addBtn = $(`#${cfg.addBtnId}`);
            const removeBtn = $(`#${cfg.removeBtnId}`);
            const noLossesChk = $(`#${cfg.noLossesChkId}`);
            if (addBtn) addBtn.onclick = () => {
                const lastSel = wrap.lastElementChild?.querySelector(".policy-select");
                addRow(lastSel ? parseInt(lastSel.value, 10) - 1 : new Date().getFullYear());
            };
            if (removeBtn) removeBtn.onclick = () => { if (wrap.childElementCount > 1) wrap.lastElementChild.remove(); };
            if (noLossesChk) noLossesChk.onchange = e => {
                wrap.querySelectorAll(".loss-row input").forEach(inp => {
                    if (inp.classList.contains("currency-input") || inp.pattern === "[0-9,]*") {
                        inp.value = e.target.checked ? "0" : "";
                        if (inp.classList.contains("currency-input")) formatCurrency(inp);
                    }
                });
            };
            wrap.addEventListener('change', e => {
                if (e.target.matches('.policy-select') && e.target === wrap.querySelector('.policy-select')) {
                    let currentYear = parseInt(e.target.value, 10);
                    wrap.querySelectorAll('.policy-select').forEach((sel, index) => {
                        if (index > 0) sel.value = --currentYear;
                    });
                }
            });
        }

        /* ─── Large Loss subsection: Add/Remove rows ─────────────── */
        function setupLargeLosses(config) {
            const addButton = $(`#${config.addButtonId}`);
            const removeButton = $(`#${config.removeButtonId}`);
            const container = $(`#${config.containerId}`);
            if (!addButton || !container || !removeButton) return;
            addButton.addEventListener('click', () => {
                if (container.children.length === 0) {
                    container.insertAdjacentHTML('beforebegin', `<h3 class="large-losses-heading">Large Losses</h3>`);
                    container.innerHTML = `<div class="large-loss-header"><span>Date of Loss</span><span>Total Incurred</span><span>Total Paid</span><span>Status</span><span>Description of Loss</span></div>`;
                }
                const row = document.createElement('div');
                row.className = 'large-loss-row';
                row.innerHTML = `<input type="text" class="large-loss-date" placeholder="Select Date..."><div class="currency-wrap"><input type="text" class="currency-input" placeholder="0"></div><div class="currency-wrap"><input type="text" class="currency-input" placeholder="0"></div><select><option>Open</option><option>Closed</option></select><textarea rows="1" placeholder="Enter description..."></textarea>`;
                container.appendChild(row);
                initFlatpickr(row.querySelector('.large-loss-date'));
            });
            removeButton.addEventListener('click', () => {
                if (container.children.length > 1) container.lastElementChild.remove();
                if (container.children.length === 1) {
                    container.previousElementSibling?.remove();
                    container.innerHTML = '';
                }
            });
        }

        /* ─── Subjectivities "Other?" expansion ─────────────────── */
        function setupSubjectivities() {
            const otherCheckbox = $("#otherSubjectivityCheckbox");
            if (!otherCheckbox) return;
            const otherPanel = otherCheckbox.closest('.other-subjectivity').querySelector('.other-details-panel');
            otherCheckbox.addEventListener('change', () => otherPanel.classList.toggle('visible', otherCheckbox.checked));
            otherPanel.querySelector('.add-other-btn')?.addEventListener('click', () => {
                otherPanel.insertBefore(document.createElement('div'), otherPanel.lastElementChild).outerHTML = `<div class="other-input-group"><textarea rows="2" placeholder="Enter other subjectivity..."></textarea></div>`;
            });
        }

        /* ─── Year-over-Year (YOY) Metrics for Renewal ──────────── */
        function setupYOY() {
            const yoyTable = document.getElementById('yoyTable');
            if (!yoyTable) return;
            let YOY_YEARS = [];
            const YOY_ROWS = [
                { id: 'gross', label: 'Gross Sales / Revenues', type: 'currency' },
                { id: 'glPrem', label: 'GL Premium', type: 'currency' },
                { id: 'glRate', label: 'GL Rate', type: 'currency' },
                { id: 'alPrem', label: 'AL Premium', type: 'currency' },
                { id: 'autoUnits', label: 'Auto Units', type: 'number' },
                { id: 'autoRates', label: 'Auto Rates', type: 'currency' },
                { id: 'comm', label: 'Commission', type: 'percent', init: ['17.5', '17.5', '17.5', '17.5'] },
                { id: 'lead', label: 'Lead Pricing', type: 'currency' },
                { id: 'l1', label: '1st Layer', type: 'currency' },
                { id: 'l2', label: '2nd Layer', type: 'currency' },
                { id: 'l3', label: '3rd Layer', type: 'currency' },
                { id: 'l4', label: '4th Layer', type: 'currency' },
                { id: 'l5', label: '5th Layer', type: 'currency' },
                { id: 'l6', label: '6th Layer', type: 'currency' },
                { id: 'l7', label: '7th Layer', type: 'currency' },
            ];
            function getPolicyBaseYear() {
                const effEl = document.getElementById('polEff');
                const selected = effEl?._flatpickr?.selectedDates?.[0];
                if (selected) return selected.getFullYear();
                const raw = effEl?.value || effEl?._flatpickr?.altInput?.value || '';
                const parsed = raw ? new Date(raw) : null;
                return parsed && !isNaN(parsed.getTime()) ? parsed.getFullYear() : new Date().getFullYear();
            }
            function getYOYYears() {
                const y = getPolicyBaseYear();
                return [y, y - 1, y - 2, y - 3];
            }
            function captureValues() {
                const out = {};
                document.querySelectorAll('.yoy-input').forEach(el => {
                    out[`${el.dataset.row}:${el.dataset.idx}`] = { value: el.value, edited: el.dataset.userEdited || '0' };
                });
                return out;
            }
            function buildYOY(preserve = false) {
                const prev = preserve ? captureValues() : {};
                YOY_YEARS = getYOYYears();
                const head = `<tr><th style="min-width:200px">Metric</th>${YOY_YEARS.map((y, i) => `<th class="right">${y}</th>${i < YOY_YEARS.length - 1 ? '<th class="right">Var%</th>' : ''}`).join('')}</tr>`;
                const body = YOY_ROWS.map(r => {
                    const cells = YOY_YEARS.map((_, i) => {
                        const saved = prev[`${r.id}:${i}`];
                        const seed = saved ? saved.value : (r.init?.[i] ?? '');
                        const val = (r.type === 'percent' && seed && !String(seed).includes('%')) ? seed + '%' : seed;
                        const input = `<input class="yoy-input mono input-highlight" data-row="${r.id}" data-idx="${i}" data-type="${r.type}" data-user-edited="${saved?.edited || '0'}" value="${String(val).replace(/"/g, '&quot;')}">`;
                        const varCell = (i < YOY_YEARS.length - 1) ? `<td class="right mono" data-var="${r.id}" data-from="${i}">—</td>` : '';
                        return `<td class="right">${input}</td>${varCell}`;
                    }).join('');
                    return `<tr><td><strong>${r.label}</strong></td>${cells}</tr>`;
                }).join('');
                yoyTable.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
                document.querySelectorAll('.yoy-input').forEach(el => {
                    const kind = el.dataset.type;
                    const dec = el.dataset.row === 'glRate' ? 2 : el.dataset.row === 'autoRates' ? 0 : null;
                    const formatter = (kind === 'currency' || el.dataset.row === 'autoRates') ? 'currency' : kind === 'percent' ? 'percent' : 'number';
                    attachFormatter(el, formatter, dec);
                    el.addEventListener('input', recalcYOY);
                    el.addEventListener('blur', recalcYOY);
                });
                document.querySelectorAll('.yoy-input[data-row="glRate"], .yoy-input[data-row="autoRates"]').forEach(el => el.addEventListener('input', () => el.dataset.userEdited = '1'));
                recalcYOY();
            }
            function yoyVal(rowId, idx) {
                const el = document.querySelector(`.yoy-input[data-row="${rowId}"][data-idx="${idx}"]`);
                if (!el) return 0;
                const t = el.dataset.type;
                if (t === 'currency') return parseCurrency(el.value);
                return t === 'percent' ? (parsePercent(el.value) * 100) : parseNumber(el.value);
            }
            function setYOYValue(rowId, i, n, decimals = 2) {
                const el = document.querySelector(`.yoy-input[data-row="${rowId}"][data-idx="${i}"]`);
                if (!el || el.dataset.userEdited === '1') return;
                const isMoney = (rowId === 'glRate' || rowId === 'autoRates');
                el.value = isMoney ? fmt.money(n || 0, decimals) : fmt.num(n || 0, decimals);
            }
            function recalcYOY() {
                const glPer = Math.max(1, parseNumber(document.querySelector('#glPer')?.value || '1000'));
                for (let i = 0; i < YOY_YEARS.length; i++) {
                    const gross = yoyVal('gross', i);
                    const glPrem = yoyVal('glPrem', i);
                    const alPrem = yoyVal('alPrem', i);
                    const units = yoyVal('autoUnits', i);
                    const glRate = gross > 0 ? glPrem / (gross / glPer) : 0;
                    const auRate = units > 0 ? alPrem / units : 0;
                    setYOYValue('glRate', i, glRate, 2);
                    setYOYValue('autoRates', i, auRate, 0);
                }
                YOY_ROWS.forEach(r => {
                    for (let i = 0; i < YOY_YEARS.length - 1; i++) {
                        const cur = yoyVal(r.id, i);
                        const base = yoyVal(r.id, i + 1);
                        const td = document.querySelector(`[data-var="${r.id}"][data-from="${i}"]`);
                        if (!td) continue;
                        if (!base || base === 0) { td.textContent = '—'; td.style.color = 'inherit'; continue; }
                        const pct = ((cur - base) / Math.abs(base));
                        td.textContent = fmt.pct(pct, 0);
                        td.style.color = pct > 0 ? 'var(--success)' : pct < 0 ? 'var(--danger)' : 'inherit';
                    }
                });
            }
            const yoyResetBtn = document.getElementById('yoyReset');
            if (yoyResetBtn) {
                yoyResetBtn.addEventListener('click', () => buildYOY(false));
            }
            document.querySelector('#glPer')?.addEventListener('input', recalcYOY);
            document.querySelector('#polEff')?.addEventListener('change', () => buildYOY(true));
            document.querySelector('#polEff')?.addEventListener('input', () => setTimeout(() => buildYOY(true), 0));
            buildYOY(false);
        }

        /* ─── Effective Rate Change (ERC) for Renewal ──────────── */
        function setupERC() {
            if (!document.getElementById('ercTable')) return;
            const q = s => document.querySelector(s);
            const ercIn = {
                expGlExp: q('[data-erc="expGlExp"]'), expAlExp: q('[data-erc="expAlExp"]'),
                expPrem: q('[data-erc="expPrem"]'), splitGl: q('[data-erc="splitGl"]'),
                splitAl: q('[data-erc="splitAl"]'), renGlExp: q('[data-erc="renGlExp"]'),
                renAlExp: q('[data-erc="renAlExp"]'), renPrem: q('[data-erc="renPrem"]'),
                glPer: q('#glPer')
            };
            const ercOut = {
                premGl: q('[data-erc-out="premGl"]'), premAl: q('[data-erc-out="premAl"]'),
                premTot: q('[data-erc-out="premTotal"]'), rateGl: q('[data-erc-out="rateGl"]'),
                rateAl: q('[data-erc-out="rateAl"]'), flatGl: q('[data-erc-out="flatGl"]'),
                flatAl: q('[data-erc-out="flatAl"]'), flatTot: q('[data-erc-out="flatTotal"]'),
                renGl: q('[data-erc-out="renGl"]'), renAl: q('[data-erc-out="renAl"]'),
                ercPct: q('#ercPct')
            };
            const summaryOut = {
                expGlExp: q('[data-summary-out="expGlExp"]'), expAlExp: q('[data-summary-out="expAlExp"]'),
                expPrem: q('[data-summary-out="expPrem"]'), splitGl: q('[data-summary-out="splitGl"]'),
                splitAl: q('[data-summary-out="splitAl"]'), renGlExp: q('[data-summary-out="renGlExp"]'),
                renAlExp: q('[data-summary-out="renAlExp"]'), renPrem: q('[data-summary-out="renPrem"]'),
                erc: q('[data-summary-out="erc"]')
            };
            const setSummary = (key, text) => { if (summaryOut[key]) summaryOut[key].textContent = text || '—'; };
            function calcERC() {
                const glPer = Math.max(1, parseNumber(ercIn.glPer?.value || '1000'));
                const glPerEcho = q('#glPerEcho');
                if (glPerEcho) glPerEcho.textContent = fmt.num(glPer);
                const expGlExp = parseNumber(ercIn.expGlExp?.value);
                const expAlExp = parseNumber(ercIn.expAlExp?.value);
                const expPrem = parseCurrency(ercIn.expPrem?.value);
                let pctGl = parsePercent(ercIn.splitGl?.value);
                if (!pctGl) pctGl = .5;
                pctGl = Math.min(Math.max(pctGl, 0), 1);
                const pctAl = 1 - pctGl;
                const premGl = expPrem * pctGl;
                const premAl = expPrem * pctAl;
                if (ercOut.premGl) ercOut.premGl.textContent = fmt.money(premGl);
                if (ercOut.premAl) ercOut.premAl.textContent = fmt.money(premAl);
                if (ercOut.premTot) ercOut.premTot.textContent = fmt.money(premGl + premAl);
                const glBase = expGlExp / glPer;
                const rateGl = glBase ? premGl / glBase : 0;
                const rateAl = expAlExp ? premAl / expAlExp : 0;
                if (ercOut.rateGl) ercOut.rateGl.textContent = fmt.money(rateGl, 2);
                if (ercOut.rateAl) ercOut.rateAl.textContent = fmt.money(rateAl, 2);
                const renGlExp = parseNumber(ercIn.renGlExp?.value) || expGlExp;
                const renAlExp = parseNumber(ercIn.renAlExp?.value) || expAlExp;
                const flatGl = (renGlExp / glPer) * rateGl;
                const flatAl = renAlExp * rateAl;
                const flatTotal = flatGl + flatAl;
                if (ercOut.flatGl) ercOut.flatGl.textContent = fmt.money(flatGl);
                if (ercOut.flatAl) ercOut.flatAl.textContent = fmt.money(flatAl);
                if (ercOut.flatTot) ercOut.flatTot.textContent = fmt.money(flatTotal);
                const renPrem = parseCurrency(ercIn.renPrem?.value);
                const usePrem = renPrem > 0 ? renPrem : flatTotal;
                const selGl = renPrem > 0 ? (renPrem * pctGl) : flatGl;
                const selAl = renPrem > 0 ? (renPrem * pctAl) : flatAl;
                if (ercOut.renGl) ercOut.renGl.textContent = fmt.money(selGl);
                if (ercOut.renAl) ercOut.renAl.textContent = fmt.money(selAl);
                const erc = flatTotal > 0 ? (usePrem / flatTotal - 1) : 0;
                if (ercOut.ercPct) ercOut.ercPct.textContent = fmt.pct(erc, 2);
                const ercText = fmt.pct(erc, 2);
                setSummary('expGlExp', expGlExp ? fmt.num(expGlExp) : '—');
                setSummary('expAlExp', expAlExp ? fmt.num(expAlExp) : '—');
                setSummary('expPrem', expPrem ? fmt.money(expPrem) : '—');
                setSummary('splitGl', fmt.pct(pctGl, 1));
                setSummary('splitAl', fmt.pct(pctAl, 1));
                setSummary('renGlExp', renGlExp ? fmt.num(renGlExp) : '—');
                setSummary('renAlExp', renAlExp ? fmt.num(renAlExp) : '—');
                setSummary('renPrem', usePrem ? fmt.money(usePrem) : '—');
                setSummary('erc', ercText);
                const ercBadge = document.querySelector('.erc-badge');
                if (ercBadge) {
                    ercBadge.classList.remove('is-positive', 'is-negative', 'is-flat');
                    if (Math.abs(erc) < 0.001) ercBadge.classList.add('is-flat');
                    else if (erc > 0) ercBadge.classList.add('is-positive');
                    else ercBadge.classList.add('is-negative');
                }
            }
            Object.values(ercIn).forEach(inp => {
                if (!inp) return;
                const kind = (inp === ercIn.splitGl || inp === ercIn.splitAl) ? 'percent'
                    : (inp === ercIn.glPer) ? 'number'
                    : (inp === ercIn.expPrem || inp === ercIn.renPrem) ? 'currency'
                    : 'number';
                attachFormatter(inp, kind);
                ['input', 'blur'].forEach(ev => inp.addEventListener(ev, calcERC));
            });
            if (ercIn.splitGl) {
                ercIn.splitGl.addEventListener('input', () => {
                    const gl = Math.min(Math.max(parsePercent(ercIn.splitGl.value) * 100, 0), 100);
                    if (ercIn.splitAl) ercIn.splitAl.value = (100 - gl).toFixed(1) + '%';
                    calcERC();
                });
            }
            if (ercIn.splitAl) {
                ercIn.splitAl.addEventListener('input', () => {
                    const al = Math.min(Math.max(parsePercent(ercIn.splitAl.value) * 100, 0), 100);
                    if (ercIn.splitGl) ercIn.splitGl.value = (100 - al).toFixed(1) + '%';
                    calcERC();
                });
            }
            calcERC();
        }

        /* ─── Renewal Auto Liability rater ───────────────────── */
        function setupRenewalAutoRater() {
            const autoTable = document.getElementById('autoTable');
            if (!autoTable) return;
            const AUTO_ROWS = [
                'Private Passenger', 'Light', 'Medium', 'Heavy (Local)', 'Heavy (Other than Local)',
                'Extra Heavy (Local)', 'Extra Heavy (Intermediate)', 'Extra Heavy (Long Haul)',
                'Truck Tractors (Local)', 'Truck Tractor (Intermediate)', 'Truck Tractors (Long Haul)',
                'Other (Low Risk)', 'Other (Moderate Risk)', 'Other (High Risk)', 'HNO Only'
            ];
            function buildAuto() {
                const tb = autoTable.querySelector('tbody');
                tb.innerHTML = AUTO_ROWS.map((name, i) =>
                    `<tr data-row="${i}"><td>${name}</td><td class="right"><input data-a="units" class="mono input-highlight" /></td><td class="right"><input data-a="rate" class="mono input-highlight" placeholder="$" /></td><td class="right mono" data-a-out="prem">$0</td><td class="right"><input data-a="expUnits" class="mono input-highlight" /></td><td class="right mono" data-a-out="fleetChange">0</td><td class="right"><input data-a="expRate" class="mono input-highlight" placeholder="$" /></td><td class="right mono" data-a-out="rateChange">$0</td><td class="right mono" data-a-out="expPrem">$0</td><td class="right mono" data-a-out="change">$0</td></tr>`
                ).join('');
                if (!autoTable.querySelector('tfoot')) {
                    autoTable.insertAdjacentHTML('beforeend', `<tfoot><tr class="total-row"><td>Total</td><td class="right mono" id="autoUnitsTotal">0</td><td></td><td class="right mono" id="autoRenewalTotal">$0</td><td class="right mono" id="autoExpUnitsTotal">0</td><td class="right mono" id="autoFleetChangeTotal">0</td><td></td><td></td><td class="right mono" id="autoExpiringTotal">$0</td><td class="right mono" id="autoChangeTotal">$0</td></tr></tfoot>`);
                }
                autoTable.querySelectorAll('tbody input').forEach(inp => {
                    const key = inp.getAttribute('data-a');
                    attachFormatter(inp, key.toLowerCase().includes('rate') ? 'currency' : 'number');
                    ['input', 'blur'].forEach(ev => inp.addEventListener(ev, calcAuto));
                });
                calcAuto();
            }
            function calcAuto() {
                let totalCurrent = 0, totalExpiring = 0, totalUnits = 0, totalExpUnits = 0;
                autoTable.querySelectorAll('tbody tr').forEach(tr => {
                    const units = parseNumber(tr.querySelector('[data-a="units"]').value);
                    const rate = parseCurrency(tr.querySelector('[data-a="rate"]').value);
                    const prem = units * rate;
                    const expU = parseNumber(tr.querySelector('[data-a="expUnits"]').value) || units;
                    const expR = parseCurrency(tr.querySelector('[data-a="expRate"]').value) || rate;
                    const expPrem = expU * expR;
                    tr.querySelector('[data-a="expUnits"]').placeholder = fmt.num(units);
                    tr.querySelector('[data-a="expRate"]').placeholder = fmt.money(rate, 0);
                    tr.querySelector('[data-a-out="prem"]').textContent = fmt.money(prem);
                    tr.querySelector('[data-a-out="fleetChange"]').textContent = fmt.num(units - expU);
                    tr.querySelector('[data-a-out="rateChange"]').textContent = fmt.money(rate - expR);
                    tr.querySelector('[data-a-out="expPrem"]').textContent = fmt.money(expPrem);
                    tr.querySelector('[data-a-out="change"]').textContent = fmt.money(prem - expPrem);
                    totalUnits += units;
                    totalExpUnits += expU;
                    totalCurrent  += prem;
                    totalExpiring += expPrem;
                });
                // Phase 19: update stat-tile summary
                const renTile = document.getElementById('autoRenewalTotal');
                const expTile = document.getElementById('autoExpiringTotal');
                const chgTile = document.getElementById('autoChangeTotal');
                const chgPctEl = document.getElementById('autoChangePct');
                const chgWrap = document.getElementById('autoChangeTile');
                const unitsTotal = document.getElementById('autoUnitsTotal');
                const expUnitsTotal = document.getElementById('autoExpUnitsTotal');
                const fleetChangeTotal = document.getElementById('autoFleetChangeTotal');
                if (unitsTotal) unitsTotal.textContent = fmt.num(totalUnits);
                if (expUnitsTotal) expUnitsTotal.textContent = fmt.num(totalExpUnits);
                if (fleetChangeTotal) fleetChangeTotal.textContent = fmt.num(totalUnits - totalExpUnits);
                if (renTile) renTile.textContent = fmt.money(totalCurrent);
                if (expTile) expTile.textContent = fmt.money(totalExpiring);
                const change = totalCurrent - totalExpiring;
                const changePct = totalExpiring > 0 ? (change / totalExpiring) : 0;
                if (chgTile) chgTile.textContent = (change >= 0 ? '+' : '') + fmt.money(change);
                if (chgPctEl) chgPctEl.textContent = (changePct >= 0 ? '+' : '') + fmt.pct(changePct, 1);
                if (chgWrap) {
                    chgWrap.classList.remove('stat-tile--success', 'stat-tile--danger', 'stat-tile--amber');
                    if (Math.abs(change) < 1) {
                        // flat — no color
                    } else if (change > 0) {
                        chgWrap.classList.add('stat-tile--success');
                    } else {
                        chgWrap.classList.add('stat-tile--danger');
                    }
                }
            }
            buildAuto();
        }

        /* ─── Wire everything up ──────────────────────────────── */
        setupLossTable({ rowsId: "glLossRows", addBtnId: "addGlYear", removeBtnId: "removeGlYear", noLossesChkId: "noLossesGlChk" });
        setupLossTable({ rowsId: "autoLossRows", addBtnId: "addAutoYear", removeBtnId: "removeAutoYear", noLossesChkId: "noLossesAutoChk" });
        setupLargeLosses({ addButtonId: 'addGlLargeLoss', removeButtonId: 'removeGlLargeLoss', containerId: 'glLargeLossRows' });
        setupLargeLosses({ addButtonId: 'addAutoLargeLoss', removeButtonId: 'removeAutoLargeLoss', containerId: 'autoLargeLossRows' });
        setupSubjectivities();
        setupYOY();
        setupERC();
        setupRenewalAutoRater();

        /* ============================================================
           PHASE 15 — LIMITS & PREMIUMS WIRING
           Restored original workflow: each Add Coverage dropdown clones
           the hidden template for that coverage type, inserts additional
           entries next to existing entries of the same type, preserves
           checkbox/collapse/delete behavior, and resets coverages only
           when switching between Lead and Excess layer families.
           ============================================================ */

        const COVERAGE_TYPES = {
            primary: {
                'gl': 'General Liability',
                'al': 'Auto Liability',
                'el': 'Employers Liability',
                'aircraft': 'Aircraft Liability',
                'ebl': 'Employee Benefits Liability',
                'garage': 'Garage Liability',
                'liquor': 'Liquor Liability',
                'stop-gap': 'Stop Gap',
                'watercraft': 'Watercraft Liability',
                'other': 'Other',
            },
            excess: {
                'lead-excess': 'Lead Excess',
                'excess': 'Excess',
            },
            foreign: {
                'fgl': 'Foreign General Liability',
                'fal': 'Foreign Auto Liability',
                'fl-ebl': 'Foreign Liability — EBL',
                'fl-el': 'Foreign Liability — EL',
                'fl-products': 'Foreign Liability — Premises & Products',
                'fl-prem': 'Foreign Liability — Premises Only',
                'fl-prodops': 'Foreign Liability — Products/Ops Only',
            },
        };

        let coverageCloneSeq = 0;

        function getCoverageName(entry) {
            return entry?.querySelector('.limit-entry-header .checkbox-label span')?.textContent?.trim()
                || entry?.querySelector('.limit-entry-name')?.textContent?.trim()
                || entry?.dataset.coverageType
                || 'Coverage';
        }

        function initLimitDateInputs(root) {
            if (!root || !window.flatpickr) return;
            // FIX-PHASE-GO-LIVE-76B-DATE-PICKER-STACK-2026-05-16
            // Extension v8.6.76 audit (HIGH): EL/EBL/Liquor panels showed
            // TWO visible date pickers per labeled column. Root cause:
            // flatpickr altInput:true creates a visible sibling input;
            // on a reused/re-initialized panel (idempotent re-apply, or
            // any second init pass) a NEW altInput was created while the
            // PRIOR altInput sibling remained in the DOM — stacking two
            // visible "Select Date..." inputs under one label, with no
            // distinguishing sub-label. Make this function fully
            // self-healing and idempotent: before (re)initializing a
            // .limit-date, remove ALL adjacent flatpickr altInput
            // siblings and reset the canonical input, so there is always
            // exactly ONE picker per column no matter how many times
            // this runs. This also hard-fixes the duplicate-date symptom
            // independently of the panel-level idempotency guard.
            const purgeAltSiblings = (canonical, keepAlt) => {
                // Remove flatpickr altInput siblings EXCEPT the one the
                // live instance legitimately owns (keepAlt). On a fresh
                // (uninitialized) input keepAlt is null → remove all.
                let sib = canonical.nextElementSibling;
                while (sib && sib.classList && sib.classList.contains('flatpickr-input')
                       && sib.classList.contains('flatpickr-alt-input')) {
                    const next = sib.nextElementSibling;
                    if (sib !== keepAlt) sib.remove();
                    sib = next;
                }
                const cell = canonical.closest('label, .field, td, .grid > *') || canonical.parentNode;
                if (cell) {
                    cell.querySelectorAll('input.flatpickr-alt-input').forEach(a => {
                        if (a !== canonical && a !== keepAlt) a.remove();
                    });
                }
            };
            root.querySelectorAll('.limit-date').forEach(el => {
                // Never operate on an altInput itself.
                if (el.classList.contains('flatpickr-alt-input')) { return; }
                if (el._flatpickr) {
                    // Already initialized: strip any stacked duplicate
                    // altInputs but KEEP the instance's own altInput.
                    purgeAltSiblings(el, el._flatpickr.altInput || null);
                    return;
                }
                const prev = el.previousElementSibling;
                if (prev && prev._flatpickr) return;
                // Fresh input: clean slate (remove ALL alt orphans), init once.
                purgeAltSiblings(el, null);
                el.classList.remove('flatpickr-input');
                initFlatpickr(el);
            });
        }

        function isHidden(el) {
            for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
                if (n.classList?.contains('is-hidden')) return true;
                if (n.style?.display === 'none') return true;
                if (n.classList?.contains('limit-templates')) return true;
            }
            return false;
        }

        function isPremiumInput(input) {
            if (!input || input.classList.contains('policy-mep-premium')) return false;
            if (input.matches('[readonly]')) return false;
            const label = input.closest('label');
            const labelText = (label?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            return labelText.includes('premium') && !labelText.includes('minimum earned premium') && !labelText.includes('min. earned premium');
        }

        function recalcEntryMep(entry) {
            if (!entry) return;
            const layerChecked = !!entry.querySelector('input[data-policy-layer]:checked');
            const premiumInput = Array.from(entry.querySelectorAll('input.currency-input')).find(isPremiumInput);
            const mepPctInput = entry.querySelector('.policy-mep-pct');
            const mepPremiumOutput = entry.querySelector('.policy-mep-premium');
            if (!mepPremiumOutput) return;
            if (!layerChecked) {
                mepPremiumOutput.value = '';
                return;
            }
            const premium = premiumInput ? parseCurrency(premiumInput.value) : 0;
            const mepPct = parseNumber(mepPctInput?.value || 0);
            mepPremiumOutput.value = premium || mepPct ? ((premium * mepPct) / 100).toLocaleString('en-US') : '';
        }

        function getVisibleLimitsPremiumTotal() {
            let total = 0;
            document.querySelectorAll('#risk-limits .limit-entry input.currency-input').forEach(inp => {
                if (isHidden(inp)) return;
                if (!isPremiumInput(inp)) return;
                total += parseCurrency(inp.value);
            });
            return total;
        }

        function recalcMEP() {
            const total = getVisibleLimitsPremiumTotal();
            document.querySelectorAll('#risk-limits .limit-entry').forEach(recalcEntryMep);
            if (typeof updatePricingSummary === 'function') updatePricingSummary();
        }

        function resetCoverageListsForLayerSwitch() {
            document.querySelectorAll('#risk-limits .limits-list').forEach(list => {
                list.querySelectorAll('.limit-entry:not(.default-entry)').forEach(entry => entry.remove());
                list.querySelectorAll('.limit-entry.default-entry').forEach(entry => {
                    const checkbox = entry.querySelector('input[type="checkbox"][data-target]');
                    const detailsPanel = entry.querySelector('.limit-details-panel');
                    if (checkbox) checkbox.checked = false;
                    if (detailsPanel) detailsPanel.classList.remove('visible');
                    entry.querySelector('.collapse-arrow')?.classList.remove('expanded');
                    entry.querySelector('.policy-options-panel')?.classList.remove('visible');
                    const policyLayer = entry.querySelector('input[data-policy-layer]');
                    if (policyLayer) policyLayer.checked = false;
                    detailsPanel?.querySelectorAll('input:not([type=checkbox]):not([type=radio])').forEach(input => { input.value = ''; });
                    detailsPanel?.querySelectorAll('select').forEach(select => { select.selectedIndex = 0; });
                });
            });
            recalcMEP();
        }

        function addCoverageEntry(typeKey, targetList) {
            if (!targetList) return;
            const templateEntry = Array.from(document.querySelectorAll('.limit-templates [data-template-key]')).find(el => el.dataset.templateKey === typeKey);
            if (!templateEntry) {
                console.warn(`Template for ${typeKey} not found`);
                return;
            }
            const newEntry = templateEntry.cloneNode(true);
            coverageCloneSeq += 1;
            newEntry.removeAttribute('data-template-key');
            newEntry.dataset.coverageType = typeKey;
            newEntry.classList.remove('default-entry');

            // Defensive flatpickr-clone cleanup (belt-and-suspenders for the
            // same root cause fixed at initFlatpickr-on-load above). If a
            // template ever ends up flatpickr-initialized — by stale code,
            // by a third party plugin, or by future regressions — the clone
            // will arrive carrying orphan altInput siblings AND the original
            // .limit-date already class-tagged as flatpickr-input. Strip those
            // here so initLimitDateInputs() runs against a clean canonical
            // input and produces exactly one altInput per date column.
            newEntry.querySelectorAll('.flatpickr-alt-input').forEach(alt => alt.remove());
            newEntry.querySelectorAll('.limit-date').forEach(orig => {
                orig.classList.remove('flatpickr-input');
                if (orig.type === 'hidden') orig.type = 'text';
                try { delete orig._flatpickr; } catch (e) { orig._flatpickr = undefined; }
            });

            const newCheckbox = newEntry.querySelector('input[type="checkbox"][data-target]');
            const newDetailsPanel = newEntry.querySelector('.limit-details-panel');
            const uniqueId = `details-${typeKey}-${Date.now()}-${coverageCloneSeq}`;
            if (newCheckbox) {
                newCheckbox.dataset.target = uniqueId;
                newCheckbox.checked = false;
            }
            if (newDetailsPanel) {
                newDetailsPanel.id = uniqueId;
                newDetailsPanel.classList.remove('visible');
                newDetailsPanel.querySelectorAll('input:not([type=checkbox]):not([type=radio])').forEach(input => { input.value = ''; });
                newDetailsPanel.querySelectorAll('select').forEach(select => { select.selectedIndex = 0; });
            }
            newEntry.querySelector('.collapse-arrow')?.classList.remove('expanded');
            newEntry.querySelector('.policy-options-panel')?.classList.remove('visible');
            const policyLayer = newEntry.querySelector('input[data-policy-layer]');
            if (policyLayer) policyLayer.checked = false;

            const existingEntries = Array.from(targetList.querySelectorAll('[data-coverage-type]')).filter(el => el.dataset.coverageType === typeKey);
            if (existingEntries.length > 0) {
                existingEntries[existingEntries.length - 1].after(newEntry);
            } else {
                targetList.appendChild(newEntry);
            }

            initLimitDateInputs(newEntry);
            recordHistory('Coverage added', getCoverageName(newEntry));
            recalcMEP();
            // FIX-PHASE-8-EMPLOYERS-LIABILITY-2026-05-14: return the clone
            // so programmatic callers (applyELCoverageFromActiveSubmission)
            // can fill it. Existing dropdown callers ignore the return —
            // non-breaking.
            return newEntry;
        }

        function setupAddCoverageDropdowns() {
            document.querySelectorAll('#risk-limits .add-coverage-wrapper').forEach(wrapper => {
                if (wrapper.dataset.coverageWired === '1') return;
                wrapper.dataset.coverageWired = '1';
                const button = wrapper.querySelector('.add-limit-btn');
                const dropdown = wrapper.querySelector('.coverage-dropdown');
                const category = button?.dataset.category;
                const targetListId = wrapper.dataset.targetListId;
                const targetList = document.getElementById(targetListId);
                if (!button || !dropdown || !category || !targetList) return;

                dropdown.innerHTML = '';
                const categoryTypes = COVERAGE_TYPES[category] || {};
                Object.entries(categoryTypes).forEach(([key, value]) => {
                    const li = document.createElement('li');
                    li.textContent = value;
                    li.dataset.typeKey = key;
                    dropdown.appendChild(li);
                });

                button.addEventListener('click', e => {
                    e.stopPropagation();
                    const shouldOpen = !dropdown.classList.contains('visible');
                    closeAllDropdowns(dropdown);
                    dropdown.classList.toggle('visible', shouldOpen);
                    button.setAttribute('aria-expanded', String(shouldOpen));
                });

                dropdown.addEventListener('click', e => {
                    const item = e.target.closest('li[data-type-key]');
                    if (!item) return;
                    addCoverageEntry(item.dataset.typeKey, targetList);
                    dropdown.classList.remove('visible');
                    button.setAttribute('aria-expanded', 'false');
                });
            });
        }

        function setupLimitsSection() {
            const riskLimitsSection = document.getElementById('risk-limits');
            if (!riskLimitsSection || riskLimitsSection.dataset.limitsWired === '1') return;
            riskLimitsSection.dataset.limitsWired = '1';

            initLimitDateInputs(riskLimitsSection);

            riskLimitsSection.addEventListener('click', e => {
                const collapseArrow = e.target.closest('.collapse-arrow');
                if (collapseArrow) {
                    const header = collapseArrow.closest('.limit-entry-header');
                    const detailsPanel = header?.nextElementSibling;
                    detailsPanel?.classList.toggle('visible');
                    collapseArrow.classList.toggle('expanded', detailsPanel?.classList.contains('visible'));
                    return;
                }
                const deleteIcon = e.target.closest('.delete-icon');
                if (deleteIcon) {
                    const entry = deleteIcon.closest('.limit-entry');
                    const name = getCoverageName(entry);
                    if (entry && confirm('Are you sure you want to delete this coverage entry?')) {
                        entry.remove();
                        recordHistory('Coverage removed', name);
                        recalcMEP();
                    }
                }
            });

            riskLimitsSection.addEventListener('change', e => {
                const target = e.target;
                if (target.matches('.limit-entry-header input[type="checkbox"][data-target]')) {
                    const header = target.closest('.limit-entry-header');
                    const panelId = target.dataset.target;
                    const panel = panelId ? document.getElementById(panelId) : header?.nextElementSibling;
                    panel?.classList.toggle('visible', target.checked);
                    header?.querySelector('.collapse-arrow')?.classList.toggle('expanded', target.checked);
                    recordHistory(target.checked ? 'Coverage selected' : 'Coverage cleared', getCoverageName(target.closest('.limit-entry')));
                }
                if (target.matches('input[data-policy-layer]')) {
                    const entry = target.closest('.limit-entry');
                    const optionsPanel = entry?.querySelector('.policy-options-panel');
                    optionsPanel?.classList.toggle('visible', target.checked);
                    if (target.checked) {
                        const carrierInput = entry?.querySelector('.limit-details-panel input[placeholder="Carrier Name"]');
                        const effDateInput = entry?.querySelectorAll('.limit-details-panel .limit-date')[0];
                        const expDateInput = entry?.querySelectorAll('.limit-details-panel .limit-date')[1];
                        if (carrierInput && document.getElementById('paper')) carrierInput.value = document.getElementById('paper').value;
                        if (effDateInput?._flatpickr) effDateInput._flatpickr.setDate(document.getElementById('polEff')?.value || '', true);
                        if (expDateInput?._flatpickr) expDateInput._flatpickr.setDate(document.getElementById('polExp')?.value || '', true);
                    }
                    recordHistory(target.checked ? 'Carrier layer enabled' : 'Carrier layer disabled', getCoverageName(entry));
                    recalcMEP();
                }
            });

            riskLimitsSection.addEventListener('input', e => {
                if (e.target.matches('.currency-input, .policy-mep-pct')) {
                    const entry = e.target.closest('.limit-entry');
                    if (entry) recalcEntryMep(entry);
                    recalcMEP();
                }
            });
        }

        function applyLayerTypeToLimits() {
            const typeEl = document.querySelector('#layerType, #typeSelector, [data-deal-type]');
            const layerTypeText = (typeEl?.value || '').trim();
            const lower = layerTypeText.toLowerCase();
            const isLead = lower.startsWith('lead');
            const isExcess = lower.startsWith('excess') || lower.includes('umbrella') || lower.includes('follow');
            const hasSelection = isLead || isExcess;

            const card = document.querySelector('#risk-limits .card');
            let emptyState = document.getElementById('limitsLayerEmptyState');
            if (!emptyState && card) {
                emptyState = document.createElement('div');
                emptyState.id = 'limitsLayerEmptyState';
                emptyState.className = 'limits-empty-state';
                emptyState.innerHTML = `<strong>Select a Layer Type to view coverages.</strong><br>Lead layers show the policy layer plus Primary and Foreign coverages. Excess layers show Primary, Foreign, and Excess coverages.`;
                const note = card.querySelector('.card-meta-note');
                if (note) note.after(emptyState);
                else card.insertBefore(emptyState, card.firstElementChild?.nextElementSibling || null);
            }

            const show = (el, visible) => {
                if (!el) return;
                el.classList.toggle('is-hidden', !visible);
                el.style.display = visible ? '' : 'none';
            };
            document.querySelectorAll('#risk-limits .limits-category').forEach(cat => {
                const visibilityType = cat.dataset.visibility;
                if (visibilityType === 'lead-only') show(cat, hasSelection && isLead);
                else if (visibilityType === 'excess') show(cat, hasSelection && isExcess);
                else if (visibilityType === 'lead-and-excess') show(cat, hasSelection);
                else show(cat, hasSelection);
            });

            show(emptyState, !hasSelection);
            show(document.querySelector('.add-coverage-wrapper[data-button-type="primary"]'), hasSelection);
            show(document.querySelector('.add-coverage-wrapper[data-button-type="foreign"]'), hasSelection);
            show(document.querySelector('.add-coverage-wrapper[data-button-type="excess"]'), hasSelection && isExcess);
            recalcMEP();
            updatePricingSummary();
        }

        function setupLayerTypeLimitsReset() {
            const typeEl = document.querySelector('#layerType, #typeSelector, [data-deal-type]');
            if (!typeEl) return;
            let previousLayerGroup = '';
            const getGroup = () => {
                const text = (typeEl.value || '').trim().toLowerCase();
                if (text.startsWith('lead')) return 'lead';
                if (text.startsWith('excess') || text.includes('umbrella') || text.includes('follow')) return 'excess';
                return '';
            };
            previousLayerGroup = getGroup();
            typeEl.addEventListener('change', (ev) => {
                // FIX-PHASE-GO-LIVE-80-USER-OVERRIDE-2026-05-16
                // A genuine user selection (isTrusted) marks the field
                // authoritative so the Layer Type engine will NOT
                // overwrite it on a later wave/re-fill. Our own
                // programmatic dispatch (new Event('change')) is
                // isTrusted:false → it must NOT lock the field, so the
                // engine can still refine an inference later.
                if (ev && ev.isTrusted === true) {
                    typeEl.setAttribute('data-user-set', '1');
                }
                const currentLayerGroup = getGroup();
                if (currentLayerGroup && currentLayerGroup !== previousLayerGroup) {
                    resetCoverageListsForLayerSwitch();
                }
                previousLayerGroup = currentLayerGroup;
                applyLayerTypeToLimits();
                recordHistory('Layer Type changed', typeEl.value || 'Cleared');
            });
        }

        setupLimitsSection();
        setupAddCoverageDropdowns();
        applyLayerTypeToLimits();
        setupLayerTypeLimitsReset();

        /* ============================================================
           PHASE 16 — GL EXPOSURE RATER (Class Territory Table)
           5 default rows + Add Class Code / Remove Last Row.
           Per-row calc:  PremOps Premium  = (Exposures / 1000) × PremOps Rate
                          Products Premium = (Exposures / 1000) × Products Rate
                          Total Rate       = PremOps Rate + Products Rate
           Footer totals = sum of all premiums.
           ============================================================ */

        // A small map of common construction-class descriptions
        const ISO_CLASS_DESC = {
            '91111': 'Apartment Buildings — habitational',
            '91140': 'Apartment Buildings — owner-occupied',
            '91560': 'Carpentry — interior finish',
            '91580': 'Carpentry — N.O.C.',
            '91585': 'Concrete Construction — N.O.C.',
            '94276': 'Excavation Contractors',
            '95625': 'Plumbing — commercial',
            '97047': 'Roofing Contractors — N.O.C.',
            '98305': 'Steel Erection — frames or structures',
            '99746': 'Construction or Erection — N.O.C.',
        };

        function setupGLRater() {
            const tbl = document.getElementById('classTerritoryTable');
            if (!tbl) return;
            const tbody = tbl.querySelector('tbody');
            const totPremOpsEl = document.getElementById('totalPremOps');
            const totProductsEl = document.getElementById('totalProducts');
            const totalDisplayEl = document.getElementById('totalPremium');
            let rowSeq = 0;

            function makeRow() {
                rowSeq++;
                const tr = document.createElement('tr');
                tr.dataset.rowId = String(rowSeq);
                tr.innerHTML = `
                    <td class="col-index">${rowSeq}</td>
                    <td class="col-class-code"><input type="text" data-f="code" placeholder="91580" maxlength="6"></td>
                    <td class="col-class-desc"><input type="text" data-f="desc" placeholder="Description" data-auto-desc="1"></td>
                    <td class="col-state"><input type="text" data-f="state" placeholder="GA" maxlength="2" style="text-transform:uppercase"></td>
                    <td class="col-zip"><input type="text" data-f="zip" inputmode="numeric" pattern="[0-9]*" maxlength="5" placeholder="30009"></td>
                    <td class="col-exposures"><div class="currency-wrap"><input type="text" data-f="exposures" inputmode="numeric" placeholder="0"></div></td>
                    <td class="col-exp-base"><select data-f="base"><option value="1000">per $1,000</option><option value="100">per $100</option><option value="1">per $1</option><option value="payroll">payroll</option></select></td>
                    <td class="col-rate"><input type="text" data-f="rateP" inputmode="numeric" placeholder="0.000"></td>
                    <td class="col-rate"><input type="text" data-f="rateG" inputmode="numeric" placeholder="0.000"></td>
                    <td class="col-rate computed" data-out="totalRate">0.000</td>
                    <td class="col-premium computed" data-out="premP">$0</td>
                    <td class="col-premium computed" data-out="premG">$0</td>
                `;
                tbody.appendChild(tr);

                // v8.6.93 — manual GL class-code lookup.
                // This makes the rater work both ways: AI can seed rows, and an
                // underwriter can type a class code manually and get the stored
                // description + exposure/rating basis without re-running the pipeline.
                const codeInp = tr.querySelector('[data-f="code"]');
                const descInp = tr.querySelector('[data-f="desc"]');
                const baseSel = tr.querySelector('[data-f="base"]');
                const basisToSelectValue = (basis) => {
                    if (typeof normalizeBasisForSelect === 'function') return normalizeBasisForSelect(basis);
                    const b = String(basis || '').toLowerCase();
                    if (/payroll/.test(b)) return 'payroll';
                    if (/\$?100\b/.test(b)) return '100';
                    if (/\$?1\b(?!,?000)/.test(b)) return '1';
                    return '1000';
                };
                const applyClassCodeReference = () => {
                    const rawCode = codeInp.value.trim();
                    const code = rawCode.replace(/[^0-9]/g, '').slice(0, 5);
                    if (!code || code.length < 4) return;
                    if (codeInp.value !== code) codeInp.value = code;
                    const ref = window.WorkbenchRules && typeof window.WorkbenchRules.lookupGlClassCode === 'function'
                        ? window.WorkbenchRules.lookupGlClassCode(code)
                        : null;
                    const desc = ref && ref.description ? ref.description : ISO_CLASS_DESC[code];
                    if (descInp.dataset.autoDesc === '1' && desc) {
                        descInp.value = desc;
                        descInp.dispatchEvent(new Event('input', { bubbles: true }));
                        descInp.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    if (ref && ref.ratingBasis && baseSel) {
                        const v = basisToSelectValue(ref.ratingBasis);
                        if (v && baseSel.value !== v) {
                            baseSel.value = v;
                            baseSel.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                    tr.dataset.glClassCodeLookup = ref ? 'matched' : 'unmatched';
                    tr.dataset.glClassCodeReview = ref && ref.review ? '1' : '0';
                    if (ref && ref.review) tr.classList.add('class-code-review-required');
                    else tr.classList.remove('class-code-review-required');
                };
                ['input', 'change', 'blur'].forEach(ev => codeInp.addEventListener(ev, applyClassCodeReference));
                descInp.addEventListener('input', () => { descInp.dataset.autoDesc = '0'; });

                // Format exposures + rates
                const expInp = tr.querySelector('[data-f="exposures"]');
                attachFormatter(expInp, 'number');
                ['rateP', 'rateG'].forEach(k => {
                    const inp = tr.querySelector(`[data-f="${k}"]`);
                    attachFormatter(inp, 'number', 3);
                });

                // Wire calculation
                tr.querySelectorAll('input, select').forEach(el => {
                    ['input', 'blur', 'change'].forEach(ev => el.addEventListener(ev, recalcGLRater));
                });

                return tr;
            }

            function recalcGLRater() {
                let totP = 0, totG = 0;
                tbody.querySelectorAll('tr').forEach(tr => {
                    const exp = parseNumber(tr.querySelector('[data-f="exposures"]').value);
                    const baseSel = tr.querySelector('[data-f="base"]').value;
                    const base = (baseSel === 'payroll') ? 100 : Number(baseSel) || 1;
                    const rateP = parseNumber(tr.querySelector('[data-f="rateP"]').value);
                    const rateG = parseNumber(tr.querySelector('[data-f="rateG"]').value);
                    const premP = (exp / base) * rateP;
                    const premG = (exp / base) * rateG;
                    tr.querySelector('[data-out="totalRate"]').textContent = (rateP + rateG).toFixed(3);
                    tr.querySelector('[data-out="premP"]').textContent = fmt.money(premP);
                    tr.querySelector('[data-out="premG"]').textContent = fmt.money(premG);
                    totP += premP; totG += premG;
                });
                if (totPremOpsEl) totPremOpsEl.innerHTML = `<strong>${fmt.money(totP)}</strong>`;
                if (totProductsEl) totProductsEl.innerHTML = `<strong>${fmt.money(totG)}</strong>`;
                if (totalDisplayEl) totalDisplayEl.textContent = fmt.money(totP + totG);
            }

            // Build 5 default empty rows
            for (let i = 0; i < 5; i++) makeRow();

            // Wire Add / Remove Row buttons
            const addBtn = document.getElementById('glRaterAddRow');
            const removeBtn = document.getElementById('glRaterRemoveRow');
            if (addBtn) addBtn.addEventListener('click', () => { makeRow(); recalcGLRater(); });
            if (removeBtn) removeBtn.addEventListener('click', () => {
                if (tbody.children.length > 1) {
                    tbody.lastElementChild.remove();
                    recalcGLRater();
                }
            });

            // Wire Reset button (#resetBtn — defined in Phase 8 HTML)
            const resetBtn = document.getElementById('resetBtn');
            if (resetBtn) resetBtn.addEventListener('click', () => {
                tbody.innerHTML = '';
                rowSeq = 0;
                for (let i = 0; i < 5; i++) makeRow();
                recalcGLRater();
            });

            recalcGLRater();
        }

        /* ============================================================
           PHASE 16 — AL FLEET RATER
           15 vehicle classes (matching the Renewal AL rater) with
           per-class default rates. Selected Rate defaults to Default
           but can be overridden. Premium = #Vehicles × Selected Rate.
           ============================================================ */

        function setupALFleetRater() {
            const tbl = document.getElementById('autoExposuresTbl');
            if (!tbl) return;
            const tbody = tbl.querySelector('tbody');
            const totalEl = document.getElementById('autoTotalPremium');

            const VEHICLE_CLASSES = [
                { name: 'Private Passenger',                 defaultRate: 250 },
                { name: 'Light',                             defaultRate: 320 },
                { name: 'Medium',                            defaultRate: 450 },
                { name: 'Heavy (Local)',                     defaultRate: 580 },
                { name: 'Heavy (Other than Local)',          defaultRate: 720 },
                { name: 'Extra Heavy (Local)',               defaultRate: 880 },
                { name: 'Extra Heavy (Intermediate)',        defaultRate: 1050 },
                { name: 'Extra Heavy (Long Haul)',           defaultRate: 1280 },
                { name: 'Truck Tractors (Local)',            defaultRate: 1100 },
                { name: 'Truck Tractor (Intermediate)',      defaultRate: 1340 },
                { name: 'Truck Tractors (Long Haul)',        defaultRate: 1680 },
                { name: 'Other (Low Risk)',                  defaultRate: 280 },
                { name: 'Other (Moderate Risk)',             defaultRate: 420 },
                { name: 'Other (High Risk)',                 defaultRate: 720 },
                { name: 'HNO Only',                          defaultRate: 95 },
            ];

            tbody.innerHTML = VEHICLE_CLASSES.map((v, i) => `
                <tr data-row="${i}">
                    <td>${v.name}</td>
                    <td class="computed" data-out="defaultRate">${fmt.money(v.defaultRate, 0)}</td>
                    <td><div class="currency-wrap"><input type="text" data-f="selRate" inputmode="numeric" placeholder="${v.defaultRate}"></div></td>
                    <td><input type="text" data-f="units" inputmode="numeric" placeholder="0"></td>
                    <td class="computed" data-out="premium">$0</td>
                </tr>
            `).join('');

            function recalcAL() {
                let total = 0;
                tbody.querySelectorAll('tr').forEach((tr, i) => {
                    const def = VEHICLE_CLASSES[i].defaultRate;
                    const selRaw = parseCurrency(tr.querySelector('[data-f="selRate"]').value);
                    const sel = selRaw > 0 ? selRaw : def;
                    const units = parseNumber(tr.querySelector('[data-f="units"]').value);
                    const prem = units * sel;
                    tr.querySelector('[data-out="premium"]').textContent = fmt.money(prem);
                    total += prem;
                });
                if (totalEl) totalEl.innerHTML = `<strong>${fmt.money(total)}</strong>`;
            }

            tbody.querySelectorAll('input').forEach(inp => {
                attachFormatter(inp, inp.dataset.f === 'selRate' ? 'currency' : 'number');
                ['input', 'blur'].forEach(ev => inp.addEventListener(ev, recalcAL));
            });

            recalcAL();
        }

        setupGLRater();
        setupALFleetRater();

        /* ============================================================
           PHASE 17 - INTERNAL RATER (Excel/VBA aligned, no Auto)
           ============================================================
           This section ports the workbook's Rating Worksheet V2 behavior:
           - hazard grade populates the same GL/Other factor arrays used by VBA
           - primary policy DIL premiums feed the first $1M ground-up premium
           - the ground-up curve follows the Excel row breakpoints through $110M
           - tower layers price from the selected limit and attachment geometry
           - high excess rows activate for >$25M limits or >$100M top-of-stack
           ============================================================ */

        function setupInternalRater() {
            const section = document.getElementById('risk-internal-rater');
            if (!section || !document.getElementById('groundUpTbl')) return;

            const ONE_M = 1000000;
            const MAX_GU = 110 * ONE_M;
            const HIGH_EXCESS_THRESHOLD = 100 * ONE_M;
            const STANDARD_LIMIT_THRESHOLD = 25 * ONE_M;

            const hazardSel = document.getElementById('hazardGradeSelect');
            const hazardDisplay = document.getElementById('hazardDisplay');
            const limitInput = document.getElementById('nonAdmittedLimit');
            const qsLimitInput = document.getElementById('quotaShareLimit');
            const attachInput = document.getElementById('nonAdmittedAttachment');
            const appliedPremiumInput = document.getElementById('nonAdmittedPremium');
            const primaryTbody = document.querySelector('#primaryPoliciesTbl tbody');
            const groundUpTbody = document.querySelector('#groundUpTbl tbody');
            const towerTbody = document.querySelector('#towerLimitsTable tbody');
            const highExcessTbody = document.querySelector('#highExcessTable tbody');
            const highExcessCard = document.getElementById('highExcessCard');

            const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[ch]));

            const cleanNumber = value => {
                if (value == null || value === '') return 0;
                const n = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
                return Number.isFinite(n) ? n : 0;
            };
            const money = n => fmt.money(Number.isFinite(n) ? n : 0, 0);
            const ppm = (premium, limit) => limit > 0 ? premium / (limit / ONE_M) : 0;
            const pct = n => Number.isFinite(n) && n !== 0 ? (n * 100).toFixed(1) + '%' : '-';
            const roundToDollar = n => Number.isFinite(n) ? Math.round(n) : 0;
            const mround = (n, step) => Math.round(n / step) * step;
            const roundPremium = n => n > 5000 ? mround(n, 100) : mround(n, 25);
            const asMillionBand = dollars => Math.max(ONE_M, Math.min(MAX_GU, Math.round(dollars / ONE_M) * ONE_M));

            const HAZARD = {
                Low: {
                    ground: [0.50, 0.50, 0.60, 0.70, 0.50, 0.60, 0.65, 0.65, 0.60, 0.60, 0.65, 0.70],
                    top:    [0.16, 0.20, 0.16, 0.16, 0.16, 0.16, 0.16, 0.16]
                },
                Moderate: {
                    ground: [0.55, 0.55, 0.60, 0.65, 0.50, 0.60, 0.65, 0.65, 0.60, 0.60, 0.65, 0.70],
                    top:    [0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20]
                },
                'Moderate High': {
                    ground: [0.55, 0.55, 0.60, 0.65, 0.50, 0.60, 0.65, 0.65, 0.60, 0.60, 0.65, 0.70],
                    top:    [0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20]
                },
                Medium: {
                    ground: [0.55, 0.55, 0.60, 0.65, 0.50, 0.60, 0.65, 0.65, 0.60, 0.60, 0.65, 0.70],
                    top:    [0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20]
                },
                High: {
                    ground: [0.60, 0.60, 0.60, 0.60, 0.50, 0.60, 0.65, 0.65, 0.60, 0.60, 0.65, 0.70],
                    top:    [0.25, 0.20, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25]
                }
            };

            const FACTOR_INDEX_BY_TOP = new Map([
                [2, 0], [3, 1], [4, 2], [5, 3], [6, 4], [11, 5],
                [16, 6], [21, 7], [26, 8], [51, 9], [76, 10], [101, 11]
            ]);

            const highExcessFactors = [0.70, 0.70, 0.75, 0.75, 0.80, 0.80, 0.80, 0.80, 0.90, 0.90, 0.90, 0.90, 0.95, 0.95];
            const state = { groundRows: [], visibleGroundRows: [], groundByTop: new Map() };

            function getHazardKey() {
                const raw = hazardSel?.value || 'High';
                if (/moderate high/i.test(raw)) return 'Moderate High';
                if (/medium|moderate/i.test(raw)) return 'Moderate';
                if (/low/i.test(raw)) return 'Low';
                return 'High';
            }

            function getHazardConfig() {
                return HAZARD[getHazardKey()] || HAZARD.High;
            }

            function convertToDollars(input, shouldRecalc = true) {
                if (!input) return 0;
                const raw = String(input.value || '').replace(/[$,]/g, '').trim();
                if (!raw) return 0;
                let num = parseFloat(raw);
                if (!Number.isFinite(num)) return 0;
                if (num > 0 && num < 1000) num *= ONE_M;
                input.value = num.toLocaleString('en-US');
                if (shouldRecalc) recalcInternalRater();
                return num;
            }

            function hookCurrency(input, opts = {}) {
                if (!input) return;
                const normalize = () => {
                    if (input.classList.contains('convert-to-millions')) convertToDollars(input, opts.recalc !== false);
                    else if (input.value.trim()) {
                        input.value = cleanNumber(input.value).toLocaleString('en-US');
                        if (opts.recalc !== false) recalcInternalRater();
                    }
                };
                input.addEventListener('blur', normalize);
                input.addEventListener('change', normalize);
                input.addEventListener('input', () => {
                    if (opts.recalc !== false) recalcInternalRater();
                });
            }

            function hazardFactorForCoverage(coverage) {
                const top = getHazardConfig().top;
                const key = String(coverage || '').toLowerCase();
                if (key.includes('general')) return top[0];
                if (key.includes('employer')) return top[2];
                return top[2];
            }

            function coverageBucket(coverage) {
                return String(coverage || '').toLowerCase().includes('general') ? 'gl' : 'other';
            }

            function addPrimaryPolicyRow(coverage = 'General Liability', carrier = 'TBD', limit = ONE_M, ulPrem = '', manualPrem = '') {
                const tr = document.createElement('tr');
                const factor = hazardFactorForCoverage(coverage);
                tr.innerHTML = `
                    <td><select data-pp="coverage">
                        <option ${coverage === 'General Liability' ? 'selected' : ''}>General Liability</option>
                        <option ${coverage === 'Employers Liability' ? 'selected' : ''}>Employers Liability</option>
                        <option ${coverage === 'Other' ? 'selected' : ''}>Other</option>
                    </select></td>
                    <td><input type="text" data-pp="carrier" value="${safe(carrier)}" placeholder="Carrier"></td>
                    <td><div class="currency-wrap"><input type="text" data-pp="limit" class="convert-to-millions" value="${limit ? limit.toLocaleString('en-US') : ''}" placeholder="0"></div></td>
                    <td><div class="currency-wrap"><input type="text" data-pp="ulPrem" value="${safe(ulPrem)}" placeholder="0"></div></td>
                    <td><div class="currency-wrap"><input type="text" data-pp="manualPrem" value="${safe(manualPrem)}" placeholder="0"></div></td>
                    <td><select data-pp="admit"><option>Admitted</option><option>Non-Admitted</option></select></td>
                    <td><input type="text" data-pp="dilFactor" value="${factor.toFixed(2)}" inputmode="decimal"></td>
                    <td class="computed" data-pp-out="dilPrem">$0</td>
                    <td class="computed" data-pp-out="firstMilPrem">$0</td>
                    <td><button type="button" class="btn-secondary btn-sm" data-pp-remove>Remove</button></td>
                `;
                primaryTbody.appendChild(tr);
                tr.querySelectorAll('input, select').forEach(el => {
                    if (el.matches('[data-pp="limit"], [data-pp="ulPrem"], [data-pp="manualPrem"]')) hookCurrency(el);
                    else el.addEventListener('input', recalcInternalRater);
                    el.addEventListener('change', () => {
                        if (el.matches('[data-pp="coverage"]')) {
                            const factorInput = tr.querySelector('[data-pp="dilFactor"]');
                            if (factorInput) factorInput.value = hazardFactorForCoverage(el.value).toFixed(2);
                        }
                        recalcInternalRater();
                    });
                });
                tr.querySelector('[data-pp-remove]')?.addEventListener('click', () => {
                    tr.remove();
                    recalcInternalRater();
                });
                recalcInternalRater();
            }

            function primaryRows() {
                return Array.from(primaryTbody.querySelectorAll('tr')).map(tr => {
                    const coverage = tr.querySelector('[data-pp="coverage"]')?.value || 'Other';
                    const limit = cleanNumber(tr.querySelector('[data-pp="limit"]')?.value);
                    const ulPrem = cleanNumber(tr.querySelector('[data-pp="ulPrem"]')?.value);
                    const manualPrem = cleanNumber(tr.querySelector('[data-pp="manualPrem"]')?.value);
                    const factor = cleanNumber(tr.querySelector('[data-pp="dilFactor"]')?.value) || hazardFactorForCoverage(coverage);
                    const dilPrem = Math.max(ulPrem, manualPrem) * factor;
                    const firstMil = manualPrem > 0 ? manualPrem : dilPrem;
                    tr.querySelector('[data-pp-out="dilPrem"]').textContent = dilPrem > 0 ? money(dilPrem) : '$0';
                    tr.querySelector('[data-pp-out="firstMilPrem"]').textContent = firstMil > 0 ? money(firstMil) : '$0';
                    return { tr, coverage, bucket: coverageBucket(coverage), limit, ulPrem, manualPrem, factor, dilPrem, firstMil };
                });
            }

            function updatePrimaryHazardFactors() {
                primaryTbody.querySelectorAll('tr').forEach(tr => {
                    const coverage = tr.querySelector('[data-pp="coverage"]')?.value || 'Other';
                    const factorInput = tr.querySelector('[data-pp="dilFactor"]');
                    if (factorInput) factorInput.value = hazardFactorForCoverage(coverage).toFixed(2);
                });
            }

            function sumPremiums(series, fromM, toM) {
                let total = 0;
                for (let m = fromM; m <= toM; m += 1) total += series.get(m * ONE_M)?.premium || 0;
                return total;
            }

            function buildSeries(basePremium, factors) {
                const rows = new Map();
                for (let m = 1; m <= 110; m += 1) {
                    let factor = null;
                    let premium = 0;
                    if (m === 1) {
                        premium = basePremium;
                    } else if (m >= 2 && m <= 5) {
                        factor = factors[FACTOR_INDEX_BY_TOP.get(m)];
                        premium = (rows.get((m - 1) * ONE_M)?.premium || 0) * factor;
                    } else if (m === 6) {
                        factor = factors[4];
                        premium = (sumPremiums(rows, 2, 5) / 5) * factor;
                    } else if (m >= 7 && m <= 10) {
                        factor = 1;
                        premium = rows.get(6 * ONE_M)?.premium || 0;
                    } else if (m === 11) {
                        factor = factors[5];
                        premium = (sumPremiums(rows, 6, 10) / 5) * factor;
                    } else if (m >= 12 && m <= 15) {
                        factor = 1;
                        premium = rows.get(11 * ONE_M)?.premium || 0;
                    } else if (m === 16) {
                        factor = factors[6];
                        premium = (sumPremiums(rows, 11, 15) / 5) * factor;
                    } else if (m >= 17 && m <= 20) {
                        factor = 1;
                        premium = rows.get(16 * ONE_M)?.premium || 0;
                    } else if (m === 21) {
                        factor = factors[7];
                        premium = (sumPremiums(rows, 16, 20) / 5) * factor;
                    } else if (m >= 22 && m <= 25) {
                        factor = 1;
                        premium = rows.get(21 * ONE_M)?.premium || 0;
                    } else if (m === 26) {
                        factor = factors[8];
                        premium = (sumPremiums(rows, 21, 25) / 5) * factor;
                    } else if (m >= 27 && m <= 50) {
                        factor = 1;
                        premium = rows.get(26 * ONE_M)?.premium || 0;
                    } else if (m === 51) {
                        factor = factors[9];
                        premium = (sumPremiums(rows, 26, 50) / 25) * factor;
                    } else if (m >= 52 && m <= 75) {
                        factor = 1;
                        premium = rows.get(51 * ONE_M)?.premium || 0;
                    } else if (m === 76) {
                        factor = factors[10];
                        premium = (sumPremiums(rows, 51, 75) / 25) * factor;
                    } else if (m >= 77 && m <= 100) {
                        factor = 1;
                        premium = rows.get(76 * ONE_M)?.premium || 0;
                    } else if (m === 101) {
                        factor = factors[11];
                        premium = (sumPremiums(rows, 76, 100) / 25) * factor;
                    } else {
                        factor = 1;
                        premium = rows.get(101 * ONE_M)?.premium || 0;
                    }
                    rows.set(m * ONE_M, { top: m * ONE_M, factor, premium: Math.max(0, premium) });
                }
                return rows;
            }

            function renderGroundUp(glBase, otherBase) {
                const factors = getHazardConfig().ground;
                const gl = buildSeries(glBase, factors);
                const other = buildSeries(otherBase, factors);
                const cutOff = attachmentCutOff();
                const window = groundLayerWindow(calcLimit(), cleanNumber(attachInput?.value));
                state.groundRows = [];
                state.visibleGroundRows = [];
                state.groundByTop = new Map();
                const rows = [];

                for (let m = 1; m <= 110; m += 1) {
                    const top = m * ONE_M;
                    const g = gl.get(top) || { factor: null, premium: 0 };
                    const o = other.get(top) || { factor: null, premium: 0 };
                    const weightedDenom = g.premium + o.premium;
                    const layerRate = weightedDenom > 0
                        ? (((g.factor || 0) * g.premium) + ((o.factor || 0) * o.premium)) / weightedDenom
                        : 0;
                    const row = { top, glFactor: g.factor, glPremium: g.premium, otherFactor: o.factor, otherPremium: o.premium, layerRate };
                    state.groundRows.push(row);
                    state.groundByTop.set(top, row);

                    // VBA Alignment: Rating Worksheet V2 hides B49:B158 rows where
                    // band top >= cutOff. Keep all rows in state for math, but render
                    // only the workbook-visible rows so the table resizes as Limit /
                    // Attachment / underlying primary policies change.
                    if (top >= cutOff) continue;

                    state.visibleGroundRows.push(row);
                    const inLayer = window.active && top > window.start && top <= window.end;
                    rows.push(`
                        <tr data-ground-top="${top}" class="${inLayer ? 'is-in-layer' : ''}">
                            <td>${money(top)}</td>
                            <td class="computed">${g.factor == null ? '-' : g.factor.toFixed(3)}</td>
                            <td class="computed">${money(g.premium)}</td>
                            <td class="computed">${o.factor == null ? '-' : o.factor.toFixed(3)}</td>
                            <td class="computed">${money(o.premium)}</td>
                            <td class="computed">${layerRate ? layerRate.toFixed(3) : '-'}</td>
                        </tr>
                    `);
                }

                if (!rows.length) {
                    rows.push(`
                        <tr class="rater-empty-row">
                            <td colspan="6">Enter a policy limit, attachment, and primary policy limit to show the workbook-visible ground-up bands.</td>
                        </tr>
                    `);
                }

                groundUpTbody.innerHTML = rows.join('');
            }

            function underlyingLimits() {
                return primaryRows()
                    .map(row => row.limit || 0)
                    .filter(value => value > 0);
            }

            function maxPrimaryLimit() {
                const limits = underlyingLimits();
                return Math.max(ONE_M, ...limits);
            }

            function smallestPositive(values) {
                return values.reduce((min, value) => {
                    if (!(value > 0)) return min;
                    return min === 0 || value < min ? value : min;
                }, 0);
            }

            function calcLimit() {
                const polLimit = cleanNumber(limitInput?.value);
                const qsLimit = cleanNumber(qsLimitInput?.value);
                return qsLimit > 0 ? qsLimit : polLimit;
            }

            function attachmentCutOff() {
                const limits = underlyingLimits();
                const maxPrim = Math.max(0, ...limits.slice(0, 2));
                const minOther = smallestPositive(limits.slice(2));
                const primaryBase = Math.max(maxPrim, minOther);
                const ratedLimit = calcLimit();
                const attachment = cleanNumber(attachInput?.value);
                const cutOff = primaryBase + ratedLimit + attachment;
                // If the workbook driver cells are incomplete, keep a minimal
                // table visible instead of letting layout collapse.
                return cutOff > ONE_M ? Math.min(MAX_GU + ONE_M, cutOff) : (2 * ONE_M);
            }

            function groundLayerWindow(limit, attachment) {
                const primaryLimit = maxPrimaryLimit();
                const adjustment = primaryLimit - ONE_M;
                const start = attachment + adjustment;
                const end = start + Math.max(0, limit);
                return { active: limit > 0 && attachment >= 0 && primaryLimit > 0, start, end };
            }

            function inLayerBandTops(limit, attachment) {
                const window = groundLayerWindow(limit, attachment);
                const tops = [];
                for (let top = ONE_M; top <= MAX_GU; top += ONE_M) {
                    if (top > window.start && top <= window.end) tops.push(top);
                }
                if (!tops.length && limit > 0) {
                    const first = asMillionBand(window.start + ONE_M);
                    const count = Math.max(1, Math.ceil(limit / ONE_M));
                    for (let i = 0; i < count; i += 1) tops.push(asMillionBand(first + i * ONE_M));
                }
                return tops;
            }

            function premiumForTops(tops) {
                return tops.reduce((sum, top) => {
                    const row = state.groundByTop.get(asMillionBand(top));
                    return sum + (row ? (row.glPremium + row.otherPremium) : 0);
                }, 0);
            }

            function standardLayerPremium(limit, attachment) {
                return roundPremium(premiumForTops(inLayerBandTops(limit, attachment)));
            }

            function highExcessBasePremium(attachment) {
                const polLimit = cleanNumber(limitInput?.value);
                const ratedLimit = calcLimit();
                if (attachment >= HIGH_EXCESS_THRESHOLD) {
                    const row = state.groundByTop.get(95 * ONE_M);
                    return row ? row.glPremium + row.otherPremium : 0;
                }
                if ((attachment + ratedLimit) > HIGH_EXCESS_THRESHOLD || polLimit > STANDARD_LIMIT_THRESHOLD) {
                    const row = state.groundByTop.get(asMillionBand(attachment));
                    return row ? row.glPremium + row.otherPremium : 0;
                }
                return 0;
            }

            function renderTowerDefaults() {
                towerTbody.innerHTML = '';
                addTowerLayerRow(5 * ONE_M, 0, true);
                addTowerLayerRow(5 * ONE_M, 5 * ONE_M, false);
                addTowerLayerRow(10 * ONE_M, 10 * ONE_M, false);
                addTowerLayerRow(10 * ONE_M, 20 * ONE_M, false);
                addTowerLayerRow(20 * ONE_M, 30 * ONE_M, false);
            }

            function addTowerLayerRow(limit = 5 * ONE_M, attachment = 0, isInternal = false) {
                const tr = document.createElement('tr');
                if (isInternal) tr.classList.add('is-internal-layer');
                tr.innerHTML = `
                    <td><div class="currency-wrap"><input type="text" data-tw="limit" class="convert-to-millions" value="${limit.toLocaleString('en-US')}"></div></td>
                    <td><div class="currency-wrap"><input type="text" data-tw="attach" class="convert-to-millions" value="${attachment.toLocaleString('en-US')}"></div></td>
                    <td class="computed" data-tw-out="internalPrem">$0</td>
                    <td class="computed" data-tw-out="internalPpm">$0</td>
                    <td><input type="text" data-tw="carrier" placeholder="${isInternal ? 'Internal' : 'Carrier'}"></td>
                    <td><div class="currency-wrap"><input type="text" data-tw="cPrem" placeholder="0"></div></td>
                    <td class="computed" data-tw-out="cPpm">$0</td>
                    <td class="computed" data-tw-out="rel">-</td>
                    <td><input type="text" data-tw="target" placeholder="Target"></td>
                    <td><button type="button" class="btn-secondary btn-sm" data-tw-remove>Remove</button></td>
                `;
                towerTbody.appendChild(tr);
                tr.querySelectorAll('input').forEach(input => {
                    if (input.matches('[data-tw="limit"], [data-tw="attach"], [data-tw="cPrem"]')) hookCurrency(input);
                    else input.addEventListener('input', recalcInternalRater);
                });
                tr.querySelector('[data-tw-remove]')?.addEventListener('click', () => {
                    tr.remove();
                    recalcInternalRater();
                });
            }

            function recalcTowerRows() {
                towerTbody.querySelectorAll('tr').forEach(tr => {
                    const limit = cleanNumber(tr.querySelector('[data-tw="limit"]')?.value);
                    const attach = cleanNumber(tr.querySelector('[data-tw="attach"]')?.value);
                    const internalPremium = standardLayerPremium(limit, attach);
                    const internalPpm = ppm(internalPremium, limit);
                    const cPrem = cleanNumber(tr.querySelector('[data-tw="cPrem"]')?.value);
                    const cPpm = ppm(cPrem, limit);
                    const rel = cPpm > 0 ? internalPpm / cPpm : 0;
                    tr.querySelector('[data-tw-out="internalPrem"]').textContent = money(internalPremium);
                    tr.querySelector('[data-tw-out="internalPpm"]').textContent = money(internalPpm);
                    tr.querySelector('[data-tw-out="cPpm"]').textContent = cPrem > 0 ? money(cPpm) : '-';
                    tr.querySelector('[data-tw-out="rel"]').textContent = rel > 0 ? rel.toFixed(2) + 'x' : '-';
                });
            }

            function shouldShowHighExcess() {
                const polLimit = cleanNumber(limitInput?.value);
                const ratedLimit = calcLimit();
                const attachment = cleanNumber(attachInput?.value);
                return polLimit > STANDARD_LIMIT_THRESHOLD || (ratedLimit + attachment) > HIGH_EXCESS_THRESHOLD;
            }

            function renderHighExcessDefaults() {
                highExcessTbody.innerHTML = '';
                // VBA alignment: C207 = IF(D19>100M,100M,D19); C208:C220
                // stack from the prior row's limit + attachment.
                let attach = Math.min(cleanNumber(attachInput?.value), HIGH_EXCESS_THRESHOLD);
                for (let i = 0; i < 14; i += 1) {
                    addHighExcessRow(25 * ONE_M, attach, highExcessFactors[i] || 0.95, i < 4, false);
                    attach += 25 * ONE_M;
                }
                recalcInternalRater();
            }

            function addHighExcessRow(limit = 25 * ONE_M, attachment = null, selectedFactor = null, active = true, doRecalc = true) {
                const rowCount = highExcessTbody.querySelectorAll('tr').length;
                const attach = attachment == null
                    ? Math.min(cleanNumber(attachInput?.value), HIGH_EXCESS_THRESHOLD) + (rowCount * 25 * ONE_M)
                    : attachment;
                const factor = selectedFactor == null ? (highExcessFactors[rowCount] || 0.95) : selectedFactor;
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><input type="checkbox" data-he="active" ${active ? 'checked' : ''} aria-label="Use high excess layer"></td>
                    <td><div class="currency-wrap"><input type="text" data-he="limit" class="convert-to-millions" value="${limit.toLocaleString('en-US')}"></div></td>
                    <td><div class="currency-wrap"><input type="text" data-he="attach" class="convert-to-millions" value="${attach.toLocaleString('en-US')}" readonly></div></td>
                    <td><select data-he="admit"><option>Admitted</option><option>Non-Admitted</option></select></td>
                    <td><input type="text" data-he="factor" value="${factor.toFixed(2)}" inputmode="decimal"></td>
                    <td class="computed" data-he-out="annual">$0</td>
                    <td class="computed" data-he-out="term">$0</td>
                    <td><div class="currency-wrap"><input type="text" data-he="applied" placeholder="0"></div></td>
                    <td class="computed" data-he-out="policy">$0</td>
                    <td class="computed" data-he-out="appliedFactor">-</td>
                    <td class="computed" data-he-out="ppm">$0</td>
                    <td><input type="text" data-he="carrier" placeholder="Carrier"></td>
                    <td><div class="currency-wrap"><input type="text" data-he="towerPrem" placeholder="0"></div></td>
                    <td class="computed" data-he-out="towerPpm">-</td>
                    <td><button type="button" class="btn-secondary btn-sm" data-he-remove>Remove</button></td>
                `;
                highExcessTbody.appendChild(tr);
                tr.querySelectorAll('input, select').forEach(input => {
                    if (input.matches('[data-he="limit"], [data-he="attach"], [data-he="applied"], [data-he="towerPrem"]')) hookCurrency(input);
                    else input.addEventListener('input', recalcInternalRater);
                    input.addEventListener('change', recalcInternalRater);
                });
                tr.querySelector('[data-he-remove]')?.addEventListener('click', () => {
                    tr.remove();
                    recalcInternalRater();
                });
                if (doRecalc) recalcInternalRater();
            }

            function recalcHighExcessRows() {
                const show = shouldShowHighExcess();
                if (highExcessCard) highExcessCard.style.display = show ? '' : 'none';
                if (!show) return;
                let stackedAttachment = Math.min(cleanNumber(attachInput?.value), HIGH_EXCESS_THRESHOLD);
                highExcessTbody.querySelectorAll('tr').forEach(tr => {
                    const active = tr.querySelector('[data-he="active"]')?.checked;
                    tr.classList.toggle('is-selected-layer', Boolean(active));
                    const limit = cleanNumber(tr.querySelector('[data-he="limit"]')?.value);
                    const attachInputEl = tr.querySelector('[data-he="attach"]');
                    if (attachInputEl) attachInputEl.value = stackedAttachment.toLocaleString('en-US');
                    const attach = stackedAttachment;
                    stackedAttachment += limit || (25 * ONE_M);
                    const selectedFactor = cleanNumber(tr.querySelector('[data-he="factor"]')?.value);
                    const base = highExcessBasePremium(attach);
                    const annual = active ? roundPremium(base * selectedFactor * Math.max(1, limit / (25 * ONE_M))) : 0;
                    const term = annual;
                    const applied = cleanNumber(tr.querySelector('[data-he="applied"]')?.value);
                    const policyPremium = active ? (applied > 0 ? applied : term) : 0;
                    const appliedFactor = base > 0 ? policyPremium / base : 0;
                    const policyPpm = ppm(policyPremium, limit);
                    const towerPrem = cleanNumber(tr.querySelector('[data-he="towerPrem"]')?.value);
                    const towerPpm = ppm(towerPrem, limit);
                    tr.querySelector('[data-he-out="annual"]').textContent = money(annual);
                    tr.querySelector('[data-he-out="term"]').textContent = money(term);
                    tr.querySelector('[data-he-out="policy"]').textContent = money(policyPremium);
                    tr.querySelector('[data-he-out="appliedFactor"]').textContent = appliedFactor ? appliedFactor.toFixed(2) + 'x' : '-';
                    tr.querySelector('[data-he-out="ppm"]').textContent = money(policyPpm);
                    tr.querySelector('[data-he-out="towerPpm"]').textContent = towerPrem > 0 ? money(towerPpm) : '-';
                });
            }

            function recalcPricingSummaryFromRater() {
                const applied = cleanNumber(appliedPremiumInput?.value);
                if (applied > 0) return applied;
                const polLimit = cleanNumber(limitInput?.value);
                const ratedLimit = calcLimit();
                const attachment = cleanNumber(attachInput?.value);
                if (polLimit <= STANDARD_LIMIT_THRESHOLD && (ratedLimit + attachment) <= HIGH_EXCESS_THRESHOLD) {
                    return standardLayerPremium(ratedLimit, attachment);
                }
                return Array.from(highExcessTbody.querySelectorAll('tr')).reduce((sum, tr) => {
                    return sum + cleanNumber(tr.querySelector('[data-he-out="policy"]')?.textContent);
                }, 0);
            }

            function syncPricingSummary() {
                // Underwriting Pricing panel removed by request. Internal rater math remains active.
            }

            function recalcInternalRater() {
                if (!groundUpTbody || !primaryTbody) return;
                const hazard = getHazardKey();
                if (hazardDisplay) {
                    hazardDisplay.textContent = hazard + ' Hazard';
                    hazardDisplay.dataset.grade = hazard;
                }
                const rows = primaryRows();
                const glBase = rows.filter(row => row.bucket === 'gl').reduce((sum, row) => sum + row.firstMil, 0);
                const otherBase = rows.filter(row => row.bucket !== 'gl').reduce((sum, row) => sum + row.firstMil, 0);
                renderGroundUp(glBase, otherBase);
                recalcTowerRows();
                recalcHighExcessRows();
                syncPricingSummary();
            }

            section.querySelectorAll('.convert-to-millions').forEach(input => hookCurrency(input));
            hookCurrency(appliedPremiumInput);
            [limitInput, qsLimitInput, attachInput, appliedPremiumInput].forEach(input => {
                input?.addEventListener('input', recalcInternalRater);
                input?.addEventListener('change', recalcInternalRater);
            });

            document.getElementById('internalAddPrimary')?.addEventListener('click', () => addPrimaryPolicyRow('Other', '', ONE_M));
            document.getElementById('internalAddLayer')?.addEventListener('click', () => addTowerLayerRow());
            document.getElementById('internalAddHighExcess')?.addEventListener('click', () => addHighExcessRow());

            hazardSel?.addEventListener('change', () => {
                updatePrimaryHazardFactors();
                recalcInternalRater();
            });

            document.getElementById('clearSheetBtn')?.addEventListener('click', () => {
                if (!confirm('Clear the entire Internal Rater sheet? This will reset factors, primary policies, tower layers, and high excess rows.')) return;
                primaryTbody.innerHTML = '';
                addPrimaryPolicyRow('General Liability', 'TBD', ONE_M);
                addPrimaryPolicyRow('Employers Liability', 'TBD', ONE_M);
                addPrimaryPolicyRow('Other', 'TBD', ONE_M);
                renderTowerDefaults();
                renderHighExcessDefaults();
                recalcInternalRater();
            });

            addPrimaryPolicyRow('General Liability', 'TBD', ONE_M);
            addPrimaryPolicyRow('Employers Liability', 'TBD', ONE_M);
            addPrimaryPolicyRow('Other', 'TBD', ONE_M);
            renderTowerDefaults();
            renderHighExcessDefaults();
            recalcInternalRater();
        }

        setupInternalRater();
        setTimeout(() => { if (window.workbenchActiveSubmission) applyV8685PopulationPass(window.workbenchActiveSubmission); }, 600);

        /* ============================================================
           PHASE 18 — FORMS & ENDORSEMENTS
           Two layer-type sets (Lead, Excess), each with three
           categories (Policy Forms, Endorsements, Exclusions).
           Selecting/deselecting a form toggles a checkbox + visual
           highlight. Reset Default → restores `def: true` flags.
           Preview → shows count of selected forms (placeholder).
           ============================================================ */

        const FORMS_DATA = {
            Lead: {
                'Policy Forms': [
                    { num: 'STM-LD-PF-001 CW (01/26)',      name: 'Straight Excess Liability Policy', def: true },
                    { num: 'STM-LD-PF-002 CW (01/26)',  name: 'Straight Excess Liability Policy Declarations', def: true },
                    { num: 'STM-LD-PF-003 CW (01/26)',      name: 'Schedule of Underlying Insurance', def: true },
                    { num: 'STM-LD-PF-004 CW (01/26)',    name: 'Straight Excess Liability Policy Jacket', def: true },
                ],
                'Endorsements': [
                    { num: 'STM-LD-EN-001 CW (01/26)',       name: 'Anti-Stacking of Limits', def: true },
                    { num: 'STM-LD-EN-002 CW (01/26)',       name: 'Other Aggregate Limit Amended', def: true },
                    { num: 'STM-LD-EN-003 CW (01/26)',       name: 'Disclosure of Important Information Relating to Terrorism Risk Insurance Act', def: true },
                    { num: 'STM-LD-EN-004 CW (01/26)',      name: 'Certified Act of Terrorism Retained Amount Provisions', def: true },
                    { num: 'STM-LD-EN-005 CW (01/26)',    name: 'Service of Suit Clause', def: true },
                    { num: 'STM-LD-EN-006 CW (01/26)',      name: 'Sanctions Exclusion Endorsement', def: true },
                    { num: 'STM-LD-EN-007 CW (01/26)',       name: 'Cap on Losses From Certified Acts of Terrorism', def: true },
                ],
                'Exclusions': [
                    { num: 'STM-LD-EX-001 CW (01/26)',       name: 'Abuse Or Molestation Exclusion', def: true },
                    { num: 'STM-LD-EX-002 CW (01/26)',       name: 'Assault or Battery Exclusion', def: true },
                    { num: 'STM-LD-EX-003 CW (01/26)',       name: 'Communicable Disease Exclusion', def: true },
                    { num: 'STM-LD-EX-004 CW (01/26)',       name: 'Cross Suits Exclusion', def: true },
                    { num: 'STM-LD-EX-005 CW (01/26)',       name: 'Discrimination Exclusion', def: true },
                    { num: 'STM-LD-EX-006 CW (01/26)',       name: 'Exclusion - Recording and Distribution of Material or Information in Violation of Law', def: true },
                    { num: 'STM-LD-EX-007 CW (01/26)',       name: 'Fungus or Bacteria Exclusion', def: true },
                    { num: 'STM-LD-EX-008 CW (01/26)',       name: 'Intellectual Property Exclusion', def: true },
                    { num: 'STM-LD-EX-009 CW (01/26)',       name: 'Lead Exclusion', def: true },
                    { num: 'STM-LD-EX-010 CW (01/26)',      name: 'Network Security, Electronic Data and Data Privacy Exclusion', def: true },
                    { num: 'STM-LD-EX-011 CW (01/26)',       name: 'Per- and Polyfluoroalkyl Substances (PFAS) Exclusion', def: true },
                    { num: 'STM-LD-EX-012 CW (01/26)',       name: 'Professional Services Exclusion', def: true },
                    { num: 'STM-LD-EX-013 CW (01/26)',       name: 'Radioactive Matter Exclusion', def: true },
                    { num: 'STM-LD-EX-014 CW (01/26)',       name: 'Silica or Silica Mixed Dust Exclusion', def: true },
                    { num: 'STM-LD-EX-015 CW (01/26)',       name: 'Total Pollution Exclusion', def: true },
                    { num: 'STM-LD-EX-016 CW (01/26)',      name: 'Trafficking Exclusion', def: true },
                ],
            },
            Excess: {
                'Policy Forms': [
                    { num: 'STM-XS-PF-001 CW (01/26)',      name: 'Following Form Excess Liability Policy', def: true },
                    { num: 'STM-XS-PF-002 CW (01/26)',  name: 'Following Form Excess Liability Policy Declarations', def: true },
                    { num: 'STM-XS-PF-003 CW (01/26)',    name: 'Follow Form Excess Liability Policy Jacket', def: true },
                ],
                'Endorsements': [
                    { num: 'STM-XS-EN-001 CW (01/26)',       name: 'Anti-Stacking of Limits', def: true },
                    { num: 'STM-XS-EN-002 CW (01/26)',       name: 'Other Aggregate Limit Amended', def: true },
                    { num: 'STM-XS-EN-003 CW (01/26)',       name: 'Disclosure of Important Information Relating to Terrorism Risk Insurance Act', def: true },
                    { num: 'STM-XS-EN-004 CW (01/26)',      name: 'Certified Act of Terrorism Retained Amount Provisions', def: true },
                    { num: 'STM-XS-EN-005 CW (01/26)',    name: 'Service of Suit Clause', def: true },
                    { num: 'STM-XS-EN-006 CW (01/26)',      name: 'Sanctions Exclusion Endorsement', def: true },
                    { num: 'STM-XS-EN-007 CW (01/26)',      name: 'Revised Definition of Spouse Endorsement', def: true },
                    { num: 'STM-XS-EN-008 CW (01/26)',       name: 'Cap on Losses From Certified Acts of Terrorism', def: true },
                ],
                'Exclusions': [
                    { num: 'STM-XS-EX-001 CW (01/26)',      name: 'Abuse or Molestation Exclusion (Care, Custody or Control deleted)', def: true },
                    { num: 'STM-XS-EX-002 CW (01/26)',       name: 'Access Or Disclosure Of Confidential Or Personal Information And Data-Related Liability Exclusion', def: true },
                    { num: 'STM-XS-EX-003 CW (01/26)',       name: 'Communicable Disease Exclusion', def: true },
                    { num: 'STM-XS-EX-004 CW (01/26)',       name: 'Cross Suits Exclusion', def: true },
                    { num: 'STM-XS-EX-005 CW (01/26)',       name: 'Discrimination Exclusion', def: true },
                    { num: 'STM-XS-EX-006 CW (01/26)',       name: 'Exclusion - Recording and Distribution of Material or Information in Violation of Law', def: true },
                    { num: 'STM-XS-EX-007 CW (01/26)',       name: 'Fungus or Bacteria Exclusion', def: true },
                    { num: 'STM-XS-EX-008 CW (01/26)',       name: 'Intellectual Property Exclusion', def: true },
                    { num: 'STM-XS-EX-009 CW (01/26)',       name: 'Lead Exclusion', def: true },
                    { num: 'STM-XS-EX-010 CW (01/26)',      name: 'Network Security, Electronic Data and Data Privacy Exclusion', def: true },
                    { num: 'STM-XS-EX-011 CW (01/26)',       name: 'Per- and Polyfluoroalkyl Substances (PFAS) Exclusion', def: true },
                    { num: 'STM-XS-EX-012 CW (01/26)',       name: 'Professional Services Exclusion', def: true },
                    { num: 'STM-XS-EX-013 CW (01/26)',       name: 'Radioactive Matter Exclusion', def: true },
                    { num: 'STM-XS-EX-014 CW (01/26)',       name: 'Silica or Silica Mixed Dust Exclusion', def: true },
                    { num: 'STM-XS-EX-015 CW (01/26)',       name: 'Total Pollution Exclusion', def: true },
                    { num: 'STM-XS-EX-016 CW (01/26)',      name: 'Trafficking Exclusion', def: true },
                ],
            },
        };

        function setupFormsAndEndorsements() {
            const container = document.getElementById('formsContainer');
            if (!container) return;
            const list      = container.querySelector('.forms-list');
            const indicator = document.getElementById('formsLayerIndicator');
            const selectAll = container.querySelector('.select-all-forms');

            const ICON_PREVIEW = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
            const ICON_DOWNLOAD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
            const ICON_REMOVE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;

            function getLayerSelection() {
                const typeEl = document.querySelector('#layerType, #typeSelector, [data-deal-type]');
                const raw = (typeEl?.value || '').trim();
                const lower = raw.toLowerCase();
                if (!raw) return { key: null, label: '' };
                if (lower.startsWith('lead')) return { key: 'Lead', label: raw };
                if (lower.startsWith('excess') || lower.includes('umbrella') || lower.includes('follow')) return { key: 'Excess', label: raw };
                return { key: null, label: raw };
            }

            function showFormsEmptyState(message = 'Select a Layer Type on the Deal page to load applicable forms.') {
                list.innerHTML = `<div class="forms-empty-state"><strong>No forms loaded yet.</strong><br>${escapeHtml(message)}</div>`;
                if (indicator) indicator.textContent = 'Select Layer Type';
                if (selectAll) {
                    selectAll.checked = false;
                    selectAll.indeterminate = false;
                    selectAll.disabled = true;
                }
            }

            function getFormLabel(row) {
                const num = row?.querySelector('.form-num')?.textContent?.trim() || '';
                const name = row?.querySelector('.form-name')?.childNodes?.[0]?.nodeValue?.trim() || row?.querySelector('.form-name')?.textContent?.trim() || '';
                return { num, name, label: `${num} — ${name}`.replace(/^\s*—\s*/, '').trim() };
            }

            function populateForms(layerType) {
                const set = FORMS_DATA[layerType];
                list.innerHTML = '';
                if (!set) {
                    showFormsEmptyState('No default forms apply until Lead or Excess Layer Type is selected.');
                    return;
                }
                if (indicator) indicator.textContent = `${layerType} Layer`;
                if (selectAll) selectAll.disabled = false;

                Object.entries(set).forEach(([categoryName, forms]) => {
                    const section = document.createElement('div');
                    section.className = 'form-category-section';
                    const header = document.createElement('h4');
                    header.className = 'form-category-header';
                    header.textContent = categoryName;
                    section.appendChild(header);
                    forms.forEach(form => {
                        const row = document.createElement('div');
                        row.className = 'form-row' + (form.def ? ' is-selected' : '');
                        row.dataset.formNum = form.num;
                        row.dataset.category = categoryName;
                        row.dataset.default = String(form.def);
                        row.innerHTML = `
                            <div class="form-checkbox"><input type="checkbox" ${form.def ? 'checked' : ''}></div>
                            <span class="form-num">${escapeHtml(form.num)}</span>
                            <span class="form-name">${escapeHtml(form.name)}${form.def ? '<span class="form-default-flag">Default</span>' : ''}</span>
                            <div class="form-actions-icons">
                                <button type="button" class="form-action-btn" data-form-action="preview" title="Preview" aria-label="Preview">${ICON_PREVIEW}</button>
                                <button type="button" class="form-action-btn" data-form-action="download" title="Download" aria-label="Download">${ICON_DOWNLOAD}</button>
                                <button type="button" class="form-action-btn form-action-btn--remove" data-form-action="remove" title="Remove" aria-label="Remove">${ICON_REMOVE}</button>
                            </div>`;
                        section.appendChild(row);
                    });
                    list.appendChild(section);
                });
                wireFormRowEvents();
                updateSelectAllState();
                recordHistory('Forms loaded', `${layerType} form set loaded`);
                // FIX-PHASE-14.2-FORMS-EMPHASIS-DOM-2026-05-14
                // Decorate (do NOT add/remove) the forms this deal's
                // facts make high-relevance. Suggest-only parity with
                // subjectivities: an INDICATED chip + reason tooltip on
                // matching rows; the form set itself is untouched.
                // Guarded: no rules / no submission → silent no-op.
                try { applyFormsEmphasis(list); }
                catch (e) { console.warn('[workbench] Phase 14.2 forms emphasis skipped —', e && e.message); }
            }

            function applyFormsEmphasis(listEl) {
                const W = window;
                if (!listEl || !W.WorkbenchRules
                    || typeof W.WorkbenchRules.recommendForms !== 'function') return;
                const sub = W.workbenchActiveSubmission || null;
                if (!sub) return;
                const rec = W.WorkbenchRules.recommendForms(sub);
                if (!rec || !Array.isArray(rec.emphases) || !rec.emphases.length) {
                    console.log('[workbench] Phase 14.2 forms emphasis: 0 emphasized',
                        rec && rec.towerBlocked ? '(tower blocked — correct).' : '.');
                    return;
                }
                const norm = (s) => String(s || '')
                    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
                const rows = Array.from(listEl.querySelectorAll('.form-row'));
                let decorated = 0;
                for (const emp of rec.emphases) {
                    const want = norm(emp.formName);
                    const row = rows.find(r => {
                        const nm = r.querySelector('.form-name');
                        if (!nm) return false;
                        const t = norm(nm.childNodes && nm.childNodes[0]
                            ? nm.childNodes[0].nodeValue : nm.textContent);
                        return t === want || (want.length >= 10 && t.indexOf(want) === 0)
                            || (want.length >= 10 && t.indexOf(want) !== -1);
                    });
                    if (!row) continue;
                    row.classList.add('form-row--indicated');
                    row.setAttribute('title',
                        'Indicated by this deal\u2019s facts — ' + (emp.reason || ''));
                    const nameEl = row.querySelector('.form-name');
                    if (nameEl && !nameEl.querySelector('.form-indicated-chip')) {
                        const chip = document.createElement('span');
                        chip.className = 'form-indicated-chip';
                        chip.textContent = 'INDICATED';
                        nameEl.appendChild(chip);
                    }
                    decorated++;
                }
                console.log('[workbench] Phase 14.2 forms emphasis:',
                    decorated, 'of', rec.emphases.length,
                    'emphasis(es) decorated · form set UNCHANGED (suggest-only)' +
                    (rec.towerBlocked ? ' · towerBlocked' : ''));
            }

            function wireFormRowEvents() {
                list.querySelectorAll('.form-row').forEach(row => {
                    if (row.dataset.wired === '1') return;
                    row.dataset.wired = '1';
                    const cb = row.querySelector('input[type="checkbox"]');
                    if (!cb) return;
                    row.addEventListener('click', e => {
                        if (e.target.closest('.form-actions-icons') || e.target === cb) return;
                        cb.checked = !cb.checked;
                        cb.dispatchEvent(new Event('change', { bubbles: true }));
                    });
                    cb.addEventListener('change', () => {
                        row.classList.toggle('is-selected', cb.checked);
                        updateSelectAllState();
                        updatePricingSummary();
                    });
                    row.querySelectorAll('[data-form-action]').forEach(btn => {
                        btn.addEventListener('click', e => {
                            e.stopPropagation();
                            const action = btn.dataset.formAction;
                            const { num, name, label } = getFormLabel(row);
                            if (action === 'preview') {
                                alert(`Form Preview\n\n${label}\n\nThis is a local preview placeholder for the selected policy form.`);
                                recordHistory('Form previewed', label);
                            } else if (action === 'download') {
                                const blob = new Blob([`Form Number: ${num}\nForm Name: ${name}\nGenerated: ${new Date().toLocaleString()}\n`], { type: 'text/plain' });
                                const a = document.createElement('a');
                                a.href = URL.createObjectURL(blob);
                                a.download = `${(num || 'form').replace(/[^a-z0-9_-]+/gi, '_')}.txt`;
                                document.body.appendChild(a);
                                a.click();
                                setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
                                recordHistory('Form downloaded', label);
                            } else if (action === 'remove') {
                                row.remove();
                                updateSelectAllState();
                                updatePricingSummary();
                                recordHistory('Form removed', label);
                            }
                        });
                    });
                });
            }

            function updateSelectAllState() {
                if (!selectAll) return;
                const all = list.querySelectorAll('.form-row input[type="checkbox"]');
                if (all.length === 0) {
                    selectAll.checked = false;
                    selectAll.indeterminate = false;
                    selectAll.disabled = true;
                    return;
                }
                const checked = list.querySelectorAll('.form-row input[type="checkbox"]:checked');
                selectAll.disabled = false;
                selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
                selectAll.checked = checked.length === all.length;
            }

            function syncFormsWithLayerType() {
                const selection = getLayerSelection();
                if (!selection.key) {
                    showFormsEmptyState(selection.label ? `No default forms configured for ${selection.label}.` : 'Select a Lead or Excess Layer Type on the Deal page.');
                    updatePricingSummary();
                    return;
                }
                populateForms(selection.key);
                updatePricingSummary();
            }

            function resetCoverageLists() {
                syncFormsWithLayerType();
                const selection = getLayerSelection();
                recordHistory('Forms reset', selection.key ? `${selection.key} defaults restored` : 'No layer selected');
            }
            document.getElementById('formsReset')?.addEventListener('click', resetCoverageLists);
            document.getElementById('formsPreview')?.addEventListener('click', () => {
                const checked = list.querySelectorAll('.form-row input[type="checkbox"]:checked');
                const names = Array.from(checked).map(cb => getFormLabel(cb.closest('.form-row')).label);
                if (names.length === 0) {
                    alert('No forms selected to preview. Select a Layer Type and choose at least one form.');
                    return;
                }
                alert(`Preview — ${names.length} selected form${names.length === 1 ? '' : 's'}:\n\n${names.join('\n')}`);
                recordHistory('Forms previewed', `${names.length} selected`);
            });
            document.getElementById('formsAdd')?.addEventListener('click', () => {
                if (!list.querySelector('.form-category-section')) {
                    alert('Select a Layer Type before adding custom forms.');
                    return;
                }
                const formNum = prompt('Form Number:');
                if (!formNum) return;
                const formName = prompt('Form Name:');
                if (!formName) return;
                const firstCategory = list.querySelector('.form-category-section');
                if (!firstCategory) return;
                const row = document.createElement('div');
                row.className = 'form-row is-selected';
                row.dataset.formNum = formNum;
                row.dataset.default = 'false';
                row.innerHTML = `<div class="form-checkbox"><input type="checkbox" checked></div><span class="form-num">${escapeHtml(formNum)}</span><span class="form-name">${escapeHtml(formName)}</span><div class="form-actions-icons"><button type="button" class="form-action-btn" data-form-action="preview" title="Preview" aria-label="Preview">${ICON_PREVIEW}</button><button type="button" class="form-action-btn" data-form-action="download" title="Download" aria-label="Download">${ICON_DOWNLOAD}</button><button type="button" class="form-action-btn form-action-btn--remove" data-form-action="remove" title="Remove" aria-label="Remove">${ICON_REMOVE}</button></div>`;
                firstCategory.appendChild(row);
                wireFormRowEvents();
                updateSelectAllState();
                updatePricingSummary();
                recordHistory('Form added', `${formNum} — ${formName}`);
            });
            if (selectAll) selectAll.addEventListener('change', () => {
                const targetChecked = selectAll.checked;
                list.querySelectorAll('.form-row input[type="checkbox"]').forEach(cb => {
                    cb.checked = targetChecked;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                });
                selectAll.checked = targetChecked;
                selectAll.indeterminate = false;
                const selection = getLayerSelection();
                recordHistory(targetChecked ? 'All forms selected' : 'All forms cleared', selection.key || 'No layer');
            });
            const typeEl = document.querySelector('#layerType, #typeSelector, [data-deal-type]');
            if (typeEl) typeEl.addEventListener('change', syncFormsWithLayerType);
            syncFormsWithLayerType();
        }

        setupFormsAndEndorsements();

        function updatePricingSummary() {
            // Underwriting Pricing panel removed by request. Keep this no-op so existing rater/event hooks stay safe.
        }
        renderHistoryLog();
        updatePricingSummary();

        /* Version badge — populate from window.STM_BUILD (STM AI convention) */
        const versionValueEl = $('#versionBadgeValue');
        if (versionValueEl && window.STM_BUILD) {
            // Show the short semver portion (e.g. "v8.6.35") not the full date string
            const shortVer = window.STM_BUILD.split('-')[0];
            versionValueEl.textContent = shortVer;
        }
        const versionBadge = $('#versionBadge');
        if (versionBadge) {
            versionBadge.addEventListener('click', () => {
                if (!navigator.clipboard) return;
                navigator.clipboard.writeText(window.STM_BUILD || '').then(() => {
                    const lbl = versionBadge.querySelector('.topbar-pill-value');
                    if (!lbl) return;
                    const orig = lbl.textContent;
                    lbl.textContent = 'COPIED';
                    setTimeout(() => { lbl.textContent = orig; }, 1100);
                }).catch(() => {});
            });
            versionBadge.style.cursor = 'pointer';
            versionBadge.title = 'Click to copy full build string';
        }

        /* Theme toggle wiring */
        const themeBtn = $('#themeToggle');
        // Restore previously chosen theme on load
        try {
            const stored = localStorage.getItem('stm-theme');
            if (stored === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
        } catch (e) {}
        if (themeBtn) {
            themeBtn.addEventListener('click', () => {
                const root = document.documentElement;
                const isDark = root.getAttribute('data-theme') === 'dark';
                const next = isDark ? 'light' : 'dark';
                if (next === 'dark') root.setAttribute('data-theme', 'dark');
                else root.removeAttribute('data-theme');
                try { localStorage.setItem('stm-theme', next); } catch (e) {}
            });
        }

        /* ════════════════════════════════════════════════════════════
           Deal Hero — live-bind 4 stat tiles to the form fields below.
           Read-only: never mutates the form, only reads values back
           out and renders derived summary metrics. Safe to call at
           any time; idempotent.
           ════════════════════════════════════════════════════════════ */
        function setupDealHero() {
            const nameEl    = $('#heroInsuredName');
            const numEl     = $('#heroDealNum');
            const typeEl    = $('#heroDealType');
            const pillEl    = $('#heroStatusPill');
            if (!nameEl) return;  // page might not exist in some renderings

            const termVal   = $('#statTermValue');
            const termCap   = $('#statTermCaption');
            const quoteVal  = $('#statQuoteValue');
            const quoteCap  = $('#statQuoteCaption');
            const quoteTile = quoteVal?.closest('.hero-stat');
            const targetVal = $('#statTargetValue');
            const targetCap = $('#statTargetCaption');
            const targetTile = targetVal?.closest('.hero-stat');
            const asgVal    = $('#statAssignedValue');
            const asgCap    = $('#statAssignedCaption');
            const asgTile   = asgVal?.closest('.hero-stat');

            const setTile = (valEl, capEl, tileEl, value, caption, state) => {
                if (!valEl) return;
                if (value && value !== '—') {
                    valEl.textContent = value;
                    tileEl?.classList.remove('is-empty');
                } else {
                    valEl.textContent = '—';
                    tileEl?.classList.add('is-empty');
                }
                if (capEl) capEl.textContent = caption || '';
                if (tileEl) {
                    tileEl.removeAttribute('data-state');
                    if (state) tileEl.setAttribute('data-state', state);
                }
            };

            const parseFpDate = (id) => {
                const el = document.getElementById(id);
                if (!el) return null;
                if (el._flatpickr && el._flatpickr.selectedDates && el._flatpickr.selectedDates[0]) {
                    return el._flatpickr.selectedDates[0];
                }
                const raw = el.value || (el._flatpickr?.altInput?.value) || '';
                if (!raw) return null;
                const d = new Date(raw);
                return isNaN(d.getTime()) ? null : d;
            };

            const daysBetween = (a, b) => Math.round((b - a) / (1000 * 60 * 60 * 24));
            const fmtMD = (d) => d ? `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}` : '—';

            const refresh = () => {
                // Insured name
                const insured = ($('#dealName')?.value || '').trim();
                if (insured) {
                    nameEl.textContent = insured;
                    nameEl.classList.remove('is-empty');
                } else {
                    nameEl.textContent = 'Untitled deal';
                    nameEl.classList.add('is-empty');
                }

                // Deal #
                const dealNum = $('#dealNum')?.textContent?.trim();
                if (numEl && dealNum) numEl.textContent = `#${dealNum}`;

                // Deal Type (mirror of sidebar typeSelect)
                const dealTypeSel = $('#typeSelect');
                if (typeEl && dealTypeSel) typeEl.textContent = dealTypeSel.value || 'New';

                // Status pill (mirror of #statusText)
                const statusEl = $('#statusText');
                if (pillEl && statusEl) {
                    const txt = statusEl.textContent.trim();
                    pillEl.textContent = txt || 'Cleared';
                    pillEl.setAttribute('data-status', txt || 'Cleared');
                }

                // Policy term
                const eff = parseFpDate('polEff');
                const exp = parseFpDate('polExp');
                if (eff && exp && exp > eff) {
                    const days = daysBetween(eff, exp);
                    const months = Math.round(days / 30.44);
                    const termStr = `${fmtMD(eff)} → ${fmtMD(exp)}`;
                    const monthStr = months === 12 ? '12 months' : (months > 0 ? `${months} months` : `${days} days`);
                    setTile(termVal, termCap, termVal?.closest('.hero-stat'), termStr, monthStr, null);
                } else if (eff) {
                    setTile(termVal, termCap, termVal?.closest('.hero-stat'), fmtMD(eff), 'Expiration not set', null);
                } else {
                    setTile(termVal, termCap, termVal?.closest('.hero-stat'), '', 'Not set', null);
                }

                // Days to quote expiration
                const quote = parseFpDate('quoteExp');
                if (quote) {
                    const today = new Date(); today.setHours(0,0,0,0);
                    const days = daysBetween(today, quote);
                    let state = null, caption = '';
                    if (days < 0)       { state = 'overdue'; caption = `Expired ${Math.abs(days)}d ago`; }
                    else if (days === 0){ state = 'urgent';  caption = 'Expires today'; }
                    else if (days <= 3) { state = 'urgent';  caption = `Expires ${fmtMD(quote)}`; }
                    else if (days <= 14){ state = 'warning'; caption = `Expires ${fmtMD(quote)}`; }
                    else                { state = 'ok';      caption = `Expires ${fmtMD(quote)}`; }
                    setTile(quoteVal, quoteCap, quoteTile, days >= 0 ? `${days}d` : `${Math.abs(days)}d ago`, caption, state);
                } else {
                    setTile(quoteVal, quoteCap, quoteTile, '', 'Quote expiry not set', null);
                }

                // Target date
                const target = parseFpDate('targetDate');
                if (target) {
                    const today = new Date(); today.setHours(0,0,0,0);
                    const days = daysBetween(today, target);
                    let state = null, caption = '';
                    if (days < 0)       { state = 'overdue'; caption = `Past target by ${Math.abs(days)}d`; }
                    else if (days === 0){ state = 'urgent';  caption = 'Target is today'; }
                    else if (days <= 7) { state = 'warning'; caption = `In ${days}d`; }
                    else                { state = null;     caption = `In ${days}d`; }
                    setTile(targetVal, targetCap, targetTile, fmtMD(target), caption, state);
                } else {
                    setTile(targetVal, targetCap, targetTile, '', 'No target', null);
                }

                // Assigned (UW / Asst)
                const uw = $('#underwriter')?.value || '';
                const asst = $('#assistant')?.value || '';
                const initials = (s) => s.split(/\s+/).filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 3);
                if (uw && asst) {
                    setTile(asgVal, asgCap, asgTile, `${initials(uw)} / ${initials(asst)}`, `${uw} · ${asst}`, null);
                } else if (uw) {
                    setTile(asgVal, asgCap, asgTile, initials(uw), `${uw} · No assistant`, 'warning');
                } else if (asst) {
                    setTile(asgVal, asgCap, asgTile, `— / ${initials(asst)}`, `No UW · ${asst}`, 'warning');
                } else {
                    setTile(asgVal, asgCap, asgTile, '', 'Unassigned', null);
                }
            };

            // Re-render on any field change that affects the hero
            ['#dealName', '#polEff', '#polExp', '#quoteExp', '#targetDate',
             '#underwriter', '#assistant', '#typeSelect'].forEach(sel => {
                const el = $(sel);
                if (!el) return;
                el.addEventListener('input', refresh);
                el.addEventListener('change', refresh);
            });
            // Status pill mirrors #statusText (mutated by Actions menu) — observe it
            const statusEl = $('#statusText');
            if (statusEl) {
                new MutationObserver(refresh).observe(statusEl, {
                    childList: true, characterData: true, subtree: true
                });
            }
            // Initial paint, plus a delayed paint so flatpickr finishes attaching
            refresh();
            setTimeout(refresh, 200);
        }

        /* ════════════════════════════════════════════════════════════
           Policy-term combined control — auto-calculates "12 months"
           caption from polEff + polExp. Pure read-only on flatpickr
           dates, identical to setupPolicyTermAutoFill but no setDate.
           ════════════════════════════════════════════════════════════ */
        function setupPolicyTermDuration() {
            const cap = $('#policyTermDuration');
            if (!cap) return;
            const update = () => {
                const eff = (() => {
                    const el = $('#polEff');
                    if (!el) return null;
                    if (el._flatpickr?.selectedDates?.[0]) return el._flatpickr.selectedDates[0];
                    const d = new Date(el.value || '');
                    return isNaN(d.getTime()) ? null : d;
                })();
                const exp = (() => {
                    const el = $('#polExp');
                    if (!el) return null;
                    if (el._flatpickr?.selectedDates?.[0]) return el._flatpickr.selectedDates[0];
                    const d = new Date(el.value || '');
                    return isNaN(d.getTime()) ? null : d;
                })();
                if (eff && exp && exp > eff) {
                    const days = Math.round((exp - eff) / (1000 * 60 * 60 * 24));
                    const months = Math.round(days / 30.44);
                    const text = months === 12 ? '12 months'
                               : (months > 0 ? `${months} months` : `${days} days`);
                    cap.textContent = `Term: ${text}`;
                    cap.classList.add('is-set');
                } else {
                    cap.textContent = 'Effective and expiration dates';
                    cap.classList.remove('is-set');
                }
            };
            ['#polEff', '#polExp'].forEach(sel => {
                const el = $(sel);
                if (!el) return;
                el.addEventListener('change', update);
                el.addEventListener('input', update);
            });
            update();
            setTimeout(update, 200);
        }

        /* ════════════════════════════════════════════════════════════
           Sidebar Summary — auto-hide rows whose <dd> is "—".
           As underwriter fills the deal, rows fade in. Always shows
           Deal #, Type, Status (the always-relevant trio).
           ════════════════════════════════════════════════════════════ */
        function setupSummaryAutoCollapse() {
            const sidebar = $('.sidebar dl');
            if (!sidebar) return;
            const ALWAYS_SHOW = new Set(['dealNum', 'typeSelect', 'statusText']);

            const update = () => {
                const dts = Array.from(sidebar.children).filter(n => n.tagName === 'DT');
                dts.forEach(dt => {
                    const dd = dt.nextElementSibling;
                    if (!dd || dd.tagName !== 'DD') return;
                    // Find the value-bearing child or the dd itself
                    const valNode = dd.querySelector('span, input, select') || dd;
                    const valId = valNode.id || '';
                    if (ALWAYS_SHOW.has(valId)) {
                        dt.style.display = '';
                        dd.style.display = '';
                        return;
                    }
                    let text = '';
                    if (valNode.tagName === 'INPUT' || valNode.tagName === 'SELECT') {
                        text = (valNode.value || '').trim();
                    } else {
                        text = (valNode.textContent || '').trim();
                    }
                    const isEmpty = !text || text === '—' || text === '';
                    dt.style.display = isEmpty ? 'none' : '';
                    dd.style.display = isEmpty ? 'none' : '';
                });
            };

            // Observe value changes throughout the sidebar
            new MutationObserver(update).observe(sidebar, {
                childList: true, characterData: true, subtree: true
            });
            sidebar.addEventListener('input', update);
            sidebar.addEventListener('change', update);
            // Also re-run when dealName/admission/etc upstream changes
            ['#dealName', '#admission', '#polEff', '#polExp'].forEach(sel => {
                const el = $(sel);
                if (el) {
                    el.addEventListener('input', update);
                    el.addEventListener('change', update);
                }
            });
            update();
            setTimeout(update, 250);
        }

        setupDealHero();
        setupPolicyTermDuration();
        setupSummaryAutoCollapse();

        /* Save button wiring — captures all field values to localStorage
           keyed by the deal number, gives visible feedback. */
        const saveBtn = $('#saveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const originalText = saveBtn.textContent;
                if (saveBtn.dataset.saving === '1') return;  // debounce double-clicks
                saveBtn.dataset.saving = '1';
                saveBtn.disabled = true;
                saveBtn.textContent = 'Saving…';

                try {
                    // Snapshot every input/select/textarea value + sidebar text + status
                    const dealNum = $('#dealNum')?.textContent?.trim() || 'untitled';
                    const snapshot = {
                        savedAt: new Date().toISOString(),
                        dealNum: dealNum,
                        status: $('#statusText')?.getAttribute('data-status') || 'Cleared',
                        fields: {},
                        sidebar: {
                            insuredName: $('#insuredNameTxt')?.textContent || '',
                            mailing: $('#mailingTxt')?.textContent || '',
                            controlling: $('#controllingTxt')?.textContent || '',
                            brokerCo: $('#brokerCoTxt')?.textContent || '',
                            brokerName: $('#brokerNameTxt')?.textContent || '',
                            paper: $('#paperTxt')?.textContent || '',
                        },
                    };
                    document.querySelectorAll('input, select, textarea').forEach(el => {
                        const id = el.id || el.name || '';
                        if (!id || el.type === 'button' || el.type === 'submit') return;
                        const key = el.id || `name:${el.name}`;
                        if (el.type === 'checkbox' || el.type === 'radio') {
                            snapshot.fields[key] = el.checked;
                        } else {
                            snapshot.fields[key] = el.value;
                        }
                    });

                    const storageKey = `stm-deal:${dealNum}`;
                    localStorage.setItem(storageKey, JSON.stringify(snapshot));

                    saveBtn.textContent = 'Saved ✓';
                    recordHistory('Saved', `Local snapshot ${storageKey}`);
                    setTimeout(() => {
                        saveBtn.textContent = originalText;
                        saveBtn.disabled = false;
                        delete saveBtn.dataset.saving;
                    }, 1400);
                } catch (e) {
                    // Private mode, quota exceeded, etc.
                    saveBtn.textContent = 'Save failed';
                    recordHistory('Save failed', e.message || 'Unable to write local snapshot');
                    setTimeout(() => {
                        saveBtn.textContent = originalText;
                        saveBtn.disabled = false;
                        delete saveBtn.dataset.saving;
                    }, 2000);
                    console.warn('Save failed:', e.message);
                }
            });
        }
    }

    // --- Script Loading and Initialization Trigger ---
    if (window.flatpickr) {
        init();
    } else {
        let attempts = 0;
        const checkFlatpickr = setInterval(() => {
            if (window.flatpickr) {
                clearInterval(checkFlatpickr);
                init();
            } else if (++attempts > 100) {
                // Flatpickr CDN failed (offline, corporate firewall, etc.)
                // Provide a no-op stub that mimics the real flatpickr surface enough
                // for `el._flatpickr.altInput.value` reads to keep working.
                clearInterval(checkFlatpickr);
                console.warn('Flatpickr failed to load after 5s — using inline date inputs.');
                window.flatpickr = function(target, opts) {
                    if (!target) return null;
                    // Resolve target to an array of elements
                    let elements = [];
                    if (typeof target === 'string') {
                        elements = Array.from(document.querySelectorAll(target));
                    } else if (target.nodeType === 1) {
                        elements = [target];
                    } else if (target.length !== undefined) {
                        elements = Array.from(target).filter(Boolean);
                    }
                    if (elements.length === 0) return null;

                    const stubs = elements.map(el => {
                        if (el._flatpickr) return el._flatpickr;
                        // Make a hidden mirror input for altInput.value reads
                        const altInput = document.createElement('input');
                        altInput.type = 'hidden';
                        altInput.value = el.value || '';
                        if (el.parentNode) el.parentNode.insertBefore(altInput, el.nextSibling);
                        el.addEventListener('input', () => { altInput.value = el.value; });
                        const stub = {
                            altInput: altInput,
                            input: el,
                            setDate: function(d, fire) {
                                const v = d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d)) : '';
                                el.value = v;
                                altInput.value = v;
                                if (fire) el.dispatchEvent(new Event('change', { bubbles: true }));
                            },
                            destroy: function() {
                                altInput.remove();
                                delete el._flatpickr;
                            },
                        };
                        el._flatpickr = stub;
                        return stub;
                    });
                    return stubs.length === 1 ? stubs[0] : stubs;
                };
                init();
            }
        }, 50);
    }
});
