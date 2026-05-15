// ============================================================================
// workbench-rules.js — Speed to Market AI underwriting rules + source resolver
// ============================================================================
// Single source of truth for:
//   - SOURCE_AUTHORITY:  which extraction modules / submission columns are
//                        authoritative for each workbench field, in priority
//                        order. Used by resolveField() to walk the waterfall.
//   - GUIDELINE_CAPS:    company-wide max-limit rules ($5M lead, $10M excess,
//                        $10M quota share). Applied uniformly. Not user-
//                        editable from the UI — only changed here.
//   - DEFAULTS:          hardcoded defaults that map to placeholder UW/UA
//                        assignments today; replaced by Phase 6 with real
//                        Supabase-backed tables for email-to-UW routing and
//                        UA assignment per UW.
//   - COMPUTE:           pure utility functions for date math + formatting.
//
// PHASE 2 SCOPE: this file ships with Tier 0 + Tier 0.5 entries only —
//   - submission.* (direct top-level Supabase column)
//   - hardcoded:<value>
//   - compute:<formula>
// Tier 1 (JSON-in-extraction) and Tier 2 (markdown label parsing) entries
// will be added in Phase 3 alongside resolveField()'s parser implementations.
//
// FIX-PHASE-2-SOURCE-PRIORITY-RESOLVER-2026-05-14
// ============================================================================

(function (root) {
  'use strict';

  // ─── Hardcoded defaults ───────────────────────────────────────────────────
  // Phase 6 replaces these with Supabase lookups.

  const DEFAULTS = {
    underwriter: 'Justin Wray',
    assistant: 'Tracy Savage',
    broker_type: 'Wholesale',
    broker_region: 'South East',
    paper: 'Steadfast Insurance Company',
    market: 'nonAdmitted',             // FIX-v8.6.48.1: option value, not display text
    target_lead_lookback_days: 10,     // target bind = effective - 10 days
    quote_expiration_days: 30          // quote exp  = submission + 30 days
  };

  // FIX-v8.6.48.1-DATE-NORMALIZATION-2026-05-14
  // Set of resolver field names that must produce a strict ISO YYYY-MM-DD
  // date string. Any descriptor in SOURCE_AUTHORITY that resolves to one
  // of these fields will be normalized in tryDescriptor() before return.
  // This catches the Anahuac-specific bug where submission.effective_date
  // is stored as a MM/DD/YYYY string in Supabase ("05/01/2026") rather
  // than an ISO date — flatpickr's setDate() can't parse that locale-
  // dependent format reliably and was rendering #polEff as "2026-01-01".
  const DATE_FIELDS = new Set([
    'policy_effective',
    'policy_expiration',
    'submission_date',
    'quote_expiration',
    'target_date',
    'created_date'
  ]);

  // Accepts: ISO YYYY-MM-DD, ISO datetime with time portion,
  // MM/DD/YYYY, MM-DD-YYYY, M/D/YYYY, Date instances. Returns strict
  // ISO YYYY-MM-DD. Never throws — if the input is unparseable, returns
  // the input as-is so downstream consumers can decide what to do.
  function normalizeDateString(s) {
    if (s == null || s === '') return s;
    if (s instanceof Date) {
      if (isNaN(s.getTime())) return s;
      return formatIso(s);
    }
    const str = String(s).trim();
    let m;
    // Already ISO YYYY-MM-DD
    if (m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str)) {
      return str;
    }
    // ISO with time component (created_at from Supabase)
    if (m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(str)) {
      return `${m[1]}-${m[2]}-${m[3]}`;
    }
    // MM/DD/YYYY (Anahuac's effective_date shape)
    if (m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str)) {
      const mm = String(m[1]).padStart(2, '0');
      const dd = String(m[2]).padStart(2, '0');
      return `${m[3]}-${mm}-${dd}`;
    }
    // MM-DD-YYYY
    if (m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(str)) {
      const mm = String(m[1]).padStart(2, '0');
      const dd = String(m[2]).padStart(2, '0');
      return `${m[3]}-${mm}-${dd}`;
    }
    // Last-resort: Date parser (locale-dependent, kept as a fallback only)
    const d = new Date(str);
    if (!isNaN(d.getTime())) return formatIso(d);
    return str;
  }

  // ─── Company guideline caps ───────────────────────────────────────────────
  // Per Justin's spec: company/guideline rules, applied uniformly.
  // Used by Phase 4+ excess/lead writers — defined here so a single file
  // contains every policy number that gates an autofill decision.

  const GUIDELINE_CAPS = {
    lead_max_limit: 5_000_000,         // never exceed $5M when we are lead
    excess_max_limit: 10_000_000,      // never exceed $10M when we are excess
    excess_min_attachment: 10_000_000, // $10M layer requires $10M+ attached
    quota_share_max_limit: 10_000_000, // QS never exceeds $10M either
    lead_carrier: 'Steadfast',         // our default lead paper
    tria_default_pct: 1.00,            // 1% TRIA
    tria_default_status: 'Accepted',
    min_earned_default_pct: 25,        // 25% MEP
    adj_flat_default: 'Flat'
  };

  // ─── Source priority per field ────────────────────────────────────────────
  // Each entry is an ordered list of source descriptors. resolveField walks
  // the list top-down and returns the first non-empty match.
  //
  // Source descriptor formats supported in Phase 2 (Tier 0 + 0.5):
  //   'submission.<column>'          → read submission[column] directly
  //   'hardcoded:<value>'            → return literal value
  //   'compute:<formula>'            → run a named compute function
  //                                    (see COMPUTE below)
  //
  // Source descriptor formats added in Phase 3:
  //   '<module>'                     → parse extractions[module].text via
  //                                    label-pattern matching (Tier 2)
  //   '<module>:json'                → require a JSON code block in
  //                                    extractions[module].text (Tier 1)
  //   '<module>:llm'                 → fire targeted LLM mini-extraction
  //                                    (Tier 3 — opt-in only)

  const SOURCE_AUTHORITY = {
    // ─── Deal Information ───
    insured_name:        ['submission.account_name'],
    policy_effective:    ['submission.effective_date'],
    policy_expiration:   ['compute:effective_plus_year'],
    submission_date:     ['submission.created_at'],
    quote_expiration:    ['compute:submission_plus_quote_days'],
    target_date:         ['compute:effective_minus_lead_days'],
    created_date:        ['submission.created_at'],
    underwriter:         ['hardcoded:Justin Wray'],
    assistant:           ['hardcoded:Tracy Savage'],
    paper:               ['hardcoded:Steadfast Insurance Company'],
    market:              ['hardcoded:nonAdmitted'],

    // ─── Broker block (display divs in Phase 2) ───
    broker_company:      ['submission.broker'],
    broker_type:         ['hardcoded:Wholesale'],
    broker_region:       ['hardcoded:South East']

    // Phase 3 will add:
    //   home_state, layer_type, mailing_address, controlling_address,
    //   broker_name, broker_address  — all needing Tier 2 markdown parsing
    //   of the supplemental / gl_quote / summary-ops modules.
  };

  // ─── Compute utilities ────────────────────────────────────────────────────
  // Pure functions. Each receives the submission row and returns either a
  // string value (for fields the resolver will set) or null if it can't
  // compute (e.g., missing dependency).

  const COMPUTE = {
    effective_plus_year(submission) {
      // FIX-v8.6.48.1: normalize Anahuac-shape MM/DD/YYYY before parsing.
      // Also use UTC to avoid local-timezone day-shift quirks where
      // "2026-05-01" might render as Apr 30 in negative-offset zones.
      const eff = normalizeDateString(submission && submission.effective_date);
      if (!eff || !/^\d{4}-\d{2}-\d{2}$/.test(eff)) return null;
      const [y, mo, d] = eff.split('-').map(Number);
      const next = new Date(Date.UTC(y + 1, mo - 1, d));
      return formatIso(next);
    },
    effective_minus_lead_days(submission) {
      const eff = normalizeDateString(submission && submission.effective_date);
      if (!eff || !/^\d{4}-\d{2}-\d{2}$/.test(eff)) return null;
      const [y, mo, d] = eff.split('-').map(Number);
      const next = new Date(Date.UTC(y, mo - 1, d - DEFAULTS.target_lead_lookback_days));
      return formatIso(next);
    },
    submission_plus_quote_days(submission) {
      const sub = normalizeDateString(submission && submission.created_at);
      if (!sub || !/^\d{4}-\d{2}-\d{2}$/.test(sub)) return null;
      const [y, mo, d] = sub.split('-').map(Number);
      const next = new Date(Date.UTC(y, mo - 1, d + DEFAULTS.quote_expiration_days));
      return formatIso(next);
    }
  };

  function formatIso(d) {
    // Always return YYYY-MM-DD so flatpickr / setDate can parse cleanly.
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // ─── Resolver ─────────────────────────────────────────────────────────────
  // Walks the SOURCE_AUTHORITY priority list for a field. Returns an object:
  //   { value, source, tier, confidence } on success
  //   null on miss
  // Phase 2 implements Tier 0 paths only. Phase 3 adds Tier 1/2 dispatching.

  function resolveField(fieldName, submission) {
    const chain = SOURCE_AUTHORITY[fieldName];
    if (!chain) {
      return null; // No rule defined for this field
    }
    for (const descriptor of chain) {
      const resolved = tryDescriptor(descriptor, submission, fieldName);
      if (resolved !== null && resolved.value !== null
          && resolved.value !== undefined && resolved.value !== '') {
        return resolved;
      }
    }
    return null;
  }

  function tryDescriptor(descriptor, submission, fieldName) {
    if (typeof descriptor !== 'string') return null;

    // submission.<column>
    if (descriptor.startsWith('submission.')) {
      const col = descriptor.slice('submission.'.length);
      if (!submission || submission[col] == null) return null;
      let value = submission[col];
      // FIX-v8.6.48.1: normalize date-typed fields to strict ISO YYYY-MM-DD
      // before they leave the resolver. Anahuac's effective_date column
      // ships as "05/01/2026" (MM/DD/YYYY string), and Supabase's created_at
      // includes a time component — flatpickr only reliably parses ISO.
      if (DATE_FIELDS.has(fieldName)) {
        value = normalizeDateString(value);
      }
      return {
        value: value,
        source: descriptor,
        tier: 0,
        confidence: 1.0
      };
    }

    // hardcoded:<value>
    if (descriptor.startsWith('hardcoded:')) {
      const v = descriptor.slice('hardcoded:'.length);
      return {
        value: v,
        source: descriptor,
        tier: 0,
        confidence: 1.0
      };
    }

    // compute:<formula>
    if (descriptor.startsWith('compute:')) {
      const name = descriptor.slice('compute:'.length);
      const fn = COMPUTE[name];
      if (typeof fn !== 'function') return null;
      let v = fn(submission);
      if (v === null || v === undefined || v === '') return null;
      // Defensive: COMPUTE functions already normalize, but if a future
      // formula returns a non-ISO string, catch it here for date fields.
      if (DATE_FIELDS.has(fieldName)) {
        v = normalizeDateString(v);
      }
      return {
        value: v,
        source: descriptor,
        tier: 0,
        confidence: 1.0
      };
    }

    // Module-based descriptors (Tier 1/2/3) — not yet implemented in Phase 2.
    // Phase 3 will branch here based on suffix (:json, :llm, plain).
    return null;
  }

  // ─── Public surface ───────────────────────────────────────────────────────

  root.WorkbenchRules = {
    SOURCE_AUTHORITY,
    GUIDELINE_CAPS,
    DEFAULTS,
    COMPUTE,
    DATE_FIELDS,
    resolveField,
    normalizeDateString,
    formatIso,
    version: 'phase2-tier0-v48.1',
    fixTag: 'FIX-PHASE-2-SOURCE-PRIORITY-RESOLVER-2026-05-14'
  };

  // Console-testable convenience wrapper. From the workbench console:
  //   window.workbenchResolveField('insured_name')
  //   → { value: 'Anahuac Infrastructure LLC', source: 'submission.account_name',
  //       tier: 0, confidence: 1.0 }
  root.workbenchResolveField = function (fieldName) {
    const sub = root.workbenchActiveSubmission || null;
    return resolveField(fieldName, sub);
  };
})(typeof window !== 'undefined' ? window : globalThis);
