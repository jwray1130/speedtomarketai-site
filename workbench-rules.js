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
    'created_date',
    // FIX-PHASE-4-GL-PRIMARY-COVERAGE-2026-05-14
    'gl_effective_date',
    'gl_expiration_date',
    // FIX-PHASE-7-AL-PRIMARY-COVERAGE-2026-05-14
    'al_effective_date',
    'al_expiration_date',
    // FIX-PHASE-8-EMPLOYERS-LIABILITY-2026-05-14
    'el_effective_date',
    'el_expiration_date',
    // FIX-PHASE-9-EMPLOYEE-BENEFITS-LIABILITY-2026-05-14
    'ebl_effective_date',
    'ebl_expiration_date',
    // FIX-PHASE-10-AIRCRAFT-GARAGE-LIQUOR-2026-05-14
    'aircraft_effective_date',
    'aircraft_expiration_date',
    'garage_effective_date',
    'garage_expiration_date',
    'liquor_effective_date',
    'liquor_expiration_date',
    // FIX-PHASE-11-FOREIGN-GL-AL-2026-05-14
    'fgl_effective_date',
    'fgl_expiration_date',
    'fal_effective_date',
    'fal_expiration_date'
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

  // FIX-PHASE-3-TIER-1-2-DISPATCH-2026-05-14
  // ─── Label pattern catalog (Tier 2 markdown parsing) ──────────────────
  // For each resolver field, a priority-ordered list of regex patterns.
  // Each pattern has a parser_confidence (1.0 = exact label match,
  // 0.75 = multi-candidate / fuzzy label, 0.60 = inferred from context,
  // 0.50 = wrapped / multi-line / weakest signal).
  // The composed final confidence is parser_confidence × module
  // extraction.confidence.
  //
  // Patterns are intentionally case-insensitive and tolerant of common
  // markdown formatting variations (bold asterisks, bullet dashes,
  // colons optional, leading whitespace). When a pattern hits, the
  // captured group is trimmed and returned. If no pattern hits, the
  // module is skipped and the next module in the field's priority list
  // is tried.

  const LABEL_PATTERNS = {
    home_state: [
      // Strict label match — high confidence. Allow leading bullet
      // dashes (- or *) and bold markers (**) in any combination.
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Home\s+State|State\s+of\s+Domicile|Mailing\s+State|Primary\s+State|Domicile\s+State)\**\s*:?\s*\**\s*([A-Z]{2})\b/im, conf: 1.0 },
      // Generic "State:" — slightly weaker (could be product state, etc.)
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*State\**\s*:\s*([A-Z]{2})\b/im, conf: 0.75 },
      // Two-letter state inferred from an address line ending in ZIP
      { re: /,\s+([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/, conf: 0.60 }
    ],
    mailing_address: [
      // Bold label, value on same line, may be preceded by bullet
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Mailing\s+Address\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      // Generic "Address:" — could be controlling or other
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Address\**\s*:\s*([^\n]+?)(?:\n|$)/im, conf: 0.60 }
    ],
    controlling_address: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Physical|Controlling|Premises|Insured)\s+Address\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      // Insured address often appears under a "Named Insured" section
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Location\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    broker_name: [
      // Producer / broker name with bold formatting and optional bullet
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Producer|Broker)\s+Name\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Producer|Broker|Agent)\**\s*:\s*([^\n,]+?)(?:\n|,|$)/im, conf: 0.75 },
      // Email signature pattern — name on line before company line
      { re: /(?:^|\n)([A-Z][a-z]+\s+[A-Z][a-z]+)\s*\n\s*(?:Producer|Broker|AmWINS|CRC|Burns|RT\s+Specialty)/m, conf: 0.60 }
    ],
    broker_address: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Producer|Broker)\s+Address\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Producer\s+Office\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    // FIX-PHASE-5.0-BROKER-COMPANY-PATTERNS-2026-05-14
    // FIX-PHASE-5.1-WHOLESALE-CONF-CALIBRATION-2026-05-14
    // Distinct from broker_name (the human producer). broker_company is
    // the brokerage firm (AmWINS, CRC Insurance Services, Burns &
    // Wilcox, RT Specialty, etc.). Common labels in extractions:
    //   "Producer Firm:", "Brokerage:", "Broker Firm:", "Brokerage Firm:",
    //   "Wholesaler:", "Wholesale Broker:"
    broker_company: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Producer|Broker|Brokerage)\s+Firm\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Brokerage\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      // "Wholesale Broker:" and "Wholesaler:" are unambiguous broker-firm
      // labels in E&S casualty submissions — calibrated to 1.0 alongside
      // "Brokerage:" and "Producer Firm:".
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Wholesale(?:r|\s+Broker)?\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      // Often the broker section lists the company on a line after a
      // person — e.g., "Rachel Tran\nAmWINS Brokerage of Texas\n...".
      // Capture line that contains a well-known broker token.
      { re: /(?:^|\n)\s*((?:AmWINS|CRC|Burns\s*(?:&|and)\s*Wilcox|RT\s+Specialty|Brown\s*(?:&|and)\s*Brown|Hull\s+(?:&|and)\s+Co)[^\n]*)(?:\n|$)/i, conf: 0.75 }
    ],
    // layer_type: Phase 11 classifier reads schedule of underlying; no
    // pattern-based extraction is reliable enough to ship.

    // ─── Phase 4 — Primary GL Coverage labels ───
    // FIX-PHASE-4-GL-PRIMARY-COVERAGE-2026-05-14
    // gl_quote extractions from the platform follow a "**Section:**\n
    // - Label: Value" pattern. We accept bullet dashes, optional bold,
    // and several label variants per field. Currency values capture
    // both formatted ("$1,000,000") and raw ("1000000") forms.
    gl_carrier: [
      // "Carrier: <name>" — possibly inside a "Carrier & Administrative" section
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurance\s+Company\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    gl_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Inception\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 },
      // FIX-PHASE-4.1-POLICY-PERIOD-COMPOSITE-2026-05-14
      // Composite: "Policy Period: 05/01/2026 – 05/01/2027" — capture
      // the LHS date. Separator can be en-dash, em-dash, hyphen, or
      // text ("to", "thru", "through"). Date format is anything containing
      // digits, slashes, dashes, or dots.
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    gl_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Expiry\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 },
      // FIX-PHASE-4.1-POLICY-PERIOD-COMPOSITE-2026-05-14
      // Composite RHS — Policy Period range right-side date.
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    gl_each_occurrence: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Each\s+Occurrence\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Per\s+Occurrence\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Occurrence\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 }
    ],
    gl_general_aggregate: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*General\s+Aggregate\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Aggregate\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.60 }
    ],
    gl_products_ops_aggregate: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Products[\/\s\-]+Completed\s+Operations\s+Aggregate\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Products[\/\s\-]+Comp(?:leted)?\s+Op(?:eration)?s?\s+Agg(?:regate)?\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Products[\/\s\-]+Comp\s+Ops\s+Agg\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.75 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*P\/C\s*Aggregate\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.70 }
    ],
    gl_personal_adv_injury: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Personal\s*(?:and|&)?\s*Adv(?:ertising)?\s*Injury\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Personal\s*(?:and|&)?\s*Advertising\s*(?:Injury)?\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*PI[\/\s\-]+Adv\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.70 }
    ],
    gl_premium: [
      // Most specific first: "Total Premium" / "GL Premium" / "Annual Premium" before generic "Premium"
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*GL\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Annual\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.75 }
    ],

    // ─── Phase 7 — Primary AL Coverage labels ───
    // FIX-PHASE-7-AL-PRIMARY-COVERAGE-2026-05-14
    // The al_quote prompt produces: "Carrier:", "Period:" (composite
    // dates, same shape as GL Policy Period), "Combined Single Limit:",
    // "Premium:". Patterns mirror the GL patterns with AL-specific labels.
    al_carrier: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurance\s+Company\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    al_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Inception\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 },
      // Composite: "Period: 05/01/2026 – 05/01/2027" — LHS date
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    al_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Expiry\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 },
      // Composite RHS
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    al_combined_single_limit: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Combined\s+Single\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*CSL\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Each\s+Accident\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.60 }
    ],
    al_premium: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*AL\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Auto\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Annual\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.75 }
    ],

    // ─── Phase 8 — Employers Liability labels ───
    // FIX-PHASE-8-EMPLOYERS-LIABILITY-2026-05-14
    // Two source shapes: el_quote uses bare labels ("Carrier:", "Bodily
    // Injury by Accident:"); gl_quote uses "EL "-prefixed labels ("EL
    // Carrier:", "EL Bodily Injury by Accident:") so they don't collide
    // with the GL coverage fields in the same extraction. Patterns cover
    // both. el_quote is tried first per SOURCE_AUTHORITY, so its bare
    // labels win when a standalone WC/EL doc exists.
    el_carrier: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*EL\s+Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.90 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    el_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    el_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    el_bi_accident: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*EL\s+Bodily\s+Injury\s+by\s+Accident\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Bodily\s+Injury\s+by\s+Accident\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:E\.?L\.?\s+)?Each\s+Accident\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 }
    ],
    el_bi_disease: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*EL\s+Bodily\s+Injury\s+by\s+Disease\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Bodily\s+Injury\s+by\s+Disease\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Disease\s*[-–—]\s*Each\s+Employee\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 }
    ],
    el_disease_policy_limit: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*EL\s+Disease\s*[-–—]\s*Policy\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Disease\s*[-–—]\s*Policy\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Disease\s+Policy\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 }
    ],
    el_premium: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*EL\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.70 }
    ],

    // ─── Phase 9 — Employee Benefits Liability labels ───
    // FIX-PHASE-9-EMPLOYEE-BENEFITS-LIABILITY-2026-05-14
    // ebl_quote uses bare labels; gl_quote uses "EBL "-prefixed labels.
    // ebl_quote tried first per SOURCE_AUTHORITY.
    ebl_carrier: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*EBL\s+Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.90 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    ebl_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    ebl_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    ebl_each_employee_limit: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*EBL\s+Each\s+Employee\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Each\s+Employee\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Each\s+Employee\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.80 }
    ],
    ebl_premium: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*EBL\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.70 }
    ],

    // ─── Phase 10 — Aircraft / Garage / Liquor labels ───
    // FIX-PHASE-10-AIRCRAFT-GARAGE-LIQUOR-2026-05-14
    // Each dedicated module uses bare labels; gl_quote uses prefixed
    // labels (Liquor only — aircraft/garage are never GL endorsements).
    aircraft_carrier: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    aircraft_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    aircraft_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    aircraft_each_occurrence: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Each\s+Occurrence\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Combined\s+Single\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 }
    ],
    aircraft_premium: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.75 }
    ],

    garage_carrier: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    garage_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    garage_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    garage_limit: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Combined\s+Single\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 }
    ],
    garage_premium: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.75 }
    ],

    liquor_carrier: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Liquor\s+Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.90 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    liquor_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    liquor_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    liquor_each_common_cause_limit: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Liquor\s+Each\s+Common\s+Cause\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Each\s+Common\s+Cause\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Each\s+Common\s+Cause\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.80 }
    ],
    liquor_aggregate_limit: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Liquor\s+Aggregate\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Aggregate\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Aggregate\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.80 }
    ],
    liquor_premium: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Liquor\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.70 }
    ],

    // ─── Phase 11 — Foreign GL / Foreign AL labels ───
    // FIX-PHASE-11-FOREIGN-GL-AL-2026-05-14
    // foreign_gl_quote / foreign_al_quote use bare labels. Strict source
    // (no gl_quote fallback) so no prefixed-label collision concern.
    fgl_carrier: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    fgl_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    fgl_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    fgl_each_occurrence: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Each\s+Occurrence\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 }
    ],
    fgl_general_aggregate: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*General\s+Aggregate\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Aggregate\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.75 }
    ],
    fgl_premium: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.75 }
    ],

    fal_carrier: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Insurer\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 }
    ],
    fal_effective_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*[\d\/\-\.]+/im, conf: 0.85 }
    ],
    fal_expiration_date: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Period\**\s*:\s*\**\s*[\d\/\-\.]+\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/im, conf: 0.85 }
    ],
    fal_combined_single_limit: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Combined\s+Single\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*CSL\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.85 }
    ],
    fal_premium: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Total\s+Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/im, conf: 0.75 }
    ]
  };

  // ─── Tier 1 parser: JSON code block in extraction text ────────────────
  // Looks for a fenced ```json ... ``` block or a leading JSON object.
  // Returns the parsed object on success, null on miss.
  function parseJsonBlock(text) {
    if (!text || typeof text !== 'string') return null;
    // Try fenced JSON block first
    const fencedMatch = /```json\s*([\s\S]*?)```/i.exec(text);
    if (fencedMatch) {
      try { return JSON.parse(fencedMatch[1].trim()); }
      catch (e) { /* fall through */ }
    }
    // Try a JSON object starting at first { and ending at matching }
    const objMatch = /({[\s\S]+?})/m.exec(text);
    if (objMatch) {
      try { return JSON.parse(objMatch[1]); }
      catch (e) { /* fall through */ }
    }
    return null;
  }

  // FIX-PHASE-4.1-SENTINEL-FILTER-2026-05-14
  // ─── Sentinel-value detection ─────────────────────────────────────────
  // ACORDs and broker docs frequently contain placeholder text where a
  // field has not been filled in. The LLM extracts these placeholders
  // verbatim (e.g., "Carrier: No information provided"). Without this
  // filter, parseMarkdown happily returns "No information provided" as
  // the value with parser_confidence 1.0 — silently corrupting the
  // workbench with literal placeholder strings as if they were real data.
  //
  // Variants observed in live extractions:
  //   "No information provided"
  //   "Not provided" / "Not specified"
  //   "N/A" / "n/a" / "N.A."
  //   "Unknown"
  //   "TBD" / "TBA" / "To Be Determined" / "To Be Advised"
  //   "(blank)" / "—" / "–" (em/en dash standalone)
  //   "Pending"
  //
  // Returns true if the value should be treated as no-value.
  function isSentinelValue(s) {
    if (s == null || s === '') return true;
    const trimmed = String(s).trim();
    if (!trimmed) return true;
    // Dash placeholders (em-dash, en-dash, hyphen, or repeated dashes)
    if (/^[—–-]+$/.test(trimmed)) return true;
    // Common placeholder phrases — match start of trimmed value so
    // longer strings like "No information provided (no bound carrier)"
    // also count as sentinels.
    if (/^(no\s+info(rmation)?\s+(?:provided|available|listed)|not\s+(?:provided|specified|listed|applicable|available)|n[.\/]?\s?a\.?|unknown|tbd|tba|to\s+be\s+(?:determined|advised|provided|confirmed)|pending|\(blank\))(?:\s|$|[\.,;:])/i.test(trimmed)) {
      return true;
    }
    return false;
  }

  // FIX-PHASE-5.0-STRUCTURAL-VALIDITY-2026-05-14
  // ─── Structural validity check ────────────────────────────────────────
  // Catches captured-fragment garbage that isn't a placeholder phrase
  // (so sentinel filter misses it) but isn't a structurally plausible
  // value either. Concrete trigger: Anahuac's submission.broker column
  // contains "; retained indefinitely" — a fragment from a COIs context
  // block mis-captured as broker name during platform extraction.
  //
  // Rejection rules:
  //   - empty / whitespace-only
  //   - starts with non-alphanumeric character (e.g., punctuation)
  //   - fewer than 2 alphanumeric characters total
  //
  // This is intentionally permissive — it accepts dates (e.g., 2026-05-01),
  // currency strings (1,000,000), single-word values (Wholesale, TX),
  // multi-word names (Tracy Savage, Great American E&S), addresses with
  // numbers/punctuation (123 Main St). It only rejects obvious junk.
  function looksStructurallyValid(value) {
    if (value == null) return false;
    const s = String(value).trim();
    if (s.length < 2) return false;
    // Must start with a letter or digit (Unicode letters allowed)
    if (!/^[\p{L}\p{N}]/u.test(s)) return false;
    // Must contain at least 2 alphanumeric characters total
    const alphaNum = s.match(/[\p{L}\p{N}]/gu);
    if (!alphaNum || alphaNum.length < 2) return false;
    return true;
  }

  // ─── Tier 2 parser: markdown label patterns ───────────────────────────
  // Returns { value, parser_confidence } on hit, null on miss.
  // FIX-PHASE-4.1-SENTINEL-FILTER-2026-05-14 — when a pattern matches
  // but the value is a sentinel (placeholder text), continue to the
  // next pattern rather than returning a false-positive value.
  function parseMarkdown(text, fieldName) {
    if (!text || typeof text !== 'string') return null;
    const patterns = LABEL_PATTERNS[fieldName];
    if (!patterns || !patterns.length) return null;
    for (const p of patterns) {
      const m = p.re.exec(text);
      if (m && m[1]) {
        let value = m[1].trim()
          .replace(/^\**\s*/, '')   // strip leading bold markers
          .replace(/\s*\**$/, '');  // strip trailing bold markers
        if (!value) continue;
        if (isSentinelValue(value)) continue;  // treat placeholder as miss
        return { value: value, parser_confidence: p.conf };
      }
    }
    return null;
  }

  // FIX-PHASE-3.5-CROSS-APPLICANT-DEFENSE-2026-05-14
  // ─── Applicant identity gate ──────────────────────────────────────────
  // Some platform-side extractions on multi-applicant submissions pull
  // data from the wrong ACORD. Concrete example: SUB-MP1ZXZ3E (Anahuac
  // Infrastructure LLC) has a gl_quote module whose text refers to
  // "Carroll County Coop, Inc." — a completely unrelated entity that
  // appeared in the same submission packet.
  //
  // Reading any field from a module that doesn't match the submission's
  // account name silently fills the workbench with the wrong insured's
  // data. This gate detects the mismatch and refuses the module's
  // contributions BEFORE any field resolution touches it.
  //
  // Logic:
  //   1. Extract the module text's stated Named Insured via regex.
  //   2. Normalize both the extracted name and submission.account_name
  //      (strip suffixes, punctuation, casing).
  //   3. Compare with a permissive match (substring tolerated).
  //   4. If mismatch → skip the module; log once.
  //   5. If extraction can't determine an insured → unknown, proceed.
  //
  // The check result is cached per (submission.id, module key) so
  // subsequent field resolutions on the same module don't re-scan.

  const _applicantMatchCache = Object.create(null);

  function extractNamedInsured(text) {
    if (!text || typeof text !== 'string') return null;
    const patterns = [
      /(?:^|\n|>)\s*(?:[-*]\s+)?\**\s*Named\s+Insured\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im,
      /(?:^|\n|>)\s*(?:[-*]\s+)?\**\s*Insured\s+Name\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im,
      /(?:^|\n|>)\s*(?:[-*]\s+)?\**\s*Insured\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im,
      /(?:^|\n|>)\s*(?:[-*]\s+)?\**\s*Applicant\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im,
      /(?:^|\n|>)\s*(?:[-*]\s+)?\**\s*Company\s+Name\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im
    ];
    for (const re of patterns) {
      const m = re.exec(text);
      if (m && m[1]) {
        // FIX-PHASE-7.1: the losses module emits HTML, so a labeled
        // "Named Insured: <strong>X</strong> &nbsp;·&nbsp; Effective..."
        // capture needs HTML tags stripped and truncation at the first
        // meta separator (· / &nbsp; / |) so we don't compare a whole
        // metadata line against the account name.
        let v = m[1]
          .replace(/<[^>]+>/g, '')          // strip HTML tags
          .replace(/&nbsp;/gi, ' ')         // decode nbsp
          .split(/\s*[·|]\s*/)[0]           // truncate at first · or | separator
          .trim()
          .replace(/^\**\s*/, '')
          .replace(/\s*\**$/, '')
          .trim();
        if (v) return v;
      }
    }
    // FIX-PHASE-7.1-ACORD-VERBATIM-INSURED-FALLBACK-2026-05-14
    // (Phase 8 hardening: the v7.1 pattern only matched company-name and
    // street-address ON THE SAME LINE — overfit to Carroll County's
    // specific ACORD layout. Real ACORDs also place the name on line 1
    // and the address on line 2, use Title-Case not ALL-CAPS, and have
    // DBA lines. We now try three layouts in priority order.)
    //
    // When labeled patterns all miss, the insured still appears in the
    // verbatim ACORD text. Carriers do NOT appear with the insured's
    // mailing address, and we additionally skip carrier-looking names.
    const carrierLike = /\b(insurance|casualty|indemnity|underwriters?|assurance|surplus\s+lines?|reinsurance|mutual|specialty\s+insurance|E&S)\b/i;
    const suffixGroup = '(?:INC|LLC|L\\.L\\.C|CORP|CORPORATION|CO|COMPANY|COOP|CO-OP|COOPERATIVE|LP|LLP|LTD|PLLC|PC|PA)';

    // Layout 1: company name + street address on the SAME line
    //   "CARROLL COUNTY COOP, INC   505 E. Stuart Dr.   Hillsville VA"
    const sameLineRe = new RegExp(
      '([A-Z][A-Za-z0-9&.,\'\\- ]{2,60}?(?:,?\\s*' + suffixGroup + ')\\b\\.?)\\s+\\d{1,6}\\s+[A-Z][A-Za-z0-9.\\- ]',
      'g'
    );
    // Layout 2: company name on its own line, address on the NEXT line
    //   "Carroll County Coop, Inc.\n505 E. Stuart Dr., Hillsville VA 24343"
    const twoLineRe = new RegExp(
      '(?:^|\\n)\\s*([A-Z][A-Za-z0-9&.,\'\\- ]{2,60}?(?:,?\\s*' + suffixGroup + ')\\b\\.?)\\s*\\n\\s*\\d{1,6}\\s+[A-Za-z]',
      'gi'
    );
    // Layout 3: DBA — "ABC Holdings LLC dba Carroll County Coop" → take
    // the dba operating name (what appears on the policy as the insured)
    const dbaRe = /\bd\/?b\/?a\.?\s+([A-Z][A-Za-z0-9&.,'\- ]{2,60}?)(?:\n|,|$)/i;

    const tryPattern = (re) => {
      let m;
      // reset lastIndex for global regexes reused across calls
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        const candidate = (m[1] || '').trim().replace(/\s+/g, ' ').replace(/[,]+$/, '').trim();
        if (!candidate) { if (!re.global) break; else continue; }
        if (carrierLike.test(candidate)) { if (!re.global) break; else continue; }
        return candidate;
      }
      return null;
    };

    return tryPattern(sameLineRe)
        || tryPattern(twoLineRe)
        || tryPattern(dbaRe)
        || null;
  }

  function normalizeCompanyName(name) {
    if (!name) return '';
    return String(name)
      .toLowerCase()
      .replace(/[,.()]/g, ' ')
      // Strip common corporate suffixes
      .replace(/\b(llc|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|plc|pllc|na)\b\.?/g, '')
      // Strip "the" prefix
      .replace(/^the\s+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Returns:
  //   true  → confident match (proceed with module)
  //   false → confident mismatch (skip module)
  //   null  → unknown / can't determine (proceed; treat as match)
  function applicantsMatch(extractedName, submissionAccountName) {
    if (!extractedName || !submissionAccountName) return null;
    const a = normalizeCompanyName(extractedName);
    const b = normalizeCompanyName(submissionAccountName);
    if (!a || !b) return null;
    if (a === b) return true;
    // Permissive: one contains the other (e.g., "Anahuac" vs
    // "Anahuac Infrastructure"), only if the shorter side is >= 4 chars
    // (avoid false-positives on 2- or 3-letter fragments).
    const shorter = a.length <= b.length ? a : b;
    const longer  = a.length <= b.length ? b : a;
    if (shorter.length >= 4 && longer.includes(shorter)) return true;
    return false;
  }

  function checkApplicantMatch(submission, moduleKey, moduleRec) {
    if (!submission || !submission.account_name) return null;
    if (!moduleRec || !moduleRec.text) return null;
    const cacheKey = (submission.id || '?') + '__' + moduleKey;
    if (Object.prototype.hasOwnProperty.call(_applicantMatchCache, cacheKey)) {
      return _applicantMatchCache[cacheKey];
    }
    const extracted = extractNamedInsured(moduleRec.text);
    if (!extracted) {
      _applicantMatchCache[cacheKey] = null; // unknown — can't verify
      return null;
    }
    const match = applicantsMatch(extracted, submission.account_name);
    _applicantMatchCache[cacheKey] = match;
    if (match === false) {
      // Log once per (submission, module) so console isn't spammed.
      console.warn(
        '[WorkbenchRules] Cross-applicant defense: module "' + moduleKey +
        '" stated insured "' + extracted +
        '" does not match submission "' + submission.account_name +
        '". Skipping for this submission.'
      );
    }
    return match;
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
  //                                    (Tier 3 — opt-in only, not yet wired)

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
    // FIX-PHASE-5.0-BROKER-TIER-PRIORITY-2026-05-14
    // Tier 2 markdown sources outrank Tier 0 submission.broker because
    // the broker column on Anahuac contains "; retained indefinitely"
    // — a captured fragment, not a broker name. Phase 5.0's structural
    // validity check now rejects that Tier 0 value automatically, but
    // we ALSO prefer better Tier 2 sources when they exist.
    broker_company:      ['summary-ops', 'supplemental', 'submission.broker'],
    broker_type:         ['hardcoded:Wholesale'],
    broker_region:       ['hardcoded:South East'],

    // ─── Phase 3 Tier 2 additions ───
    // Module order = priority. For each field, the first module whose
    // markdown parse hits with parser_confidence > 0 wins. Modules are
    // listed roughly in order of authority for that field:
    //   - supplemental: ACORD-derived data
    //   - gl_quote:     primary policy quote sheet
    //   - summary-ops:  AI-synthesized account summary
    //   - subcontract:  subcontract agreement details
    //   - exposure:     exposure analysis
    home_state:          ['supplemental:json', 'gl_quote:json',
                          'supplemental', 'gl_quote', 'summary-ops'],
    mailing_address:     ['supplemental:json', 'supplemental',
                          'gl_quote', 'summary-ops'],
    controlling_address: ['gl_quote:json', 'gl_quote', 'supplemental'],
    broker_name:         ['summary-ops', 'supplemental'],
    broker_address:      ['summary-ops', 'supplemental'],
    layer_type:          [],    // Phase 11 classifier — placeholder

    // ─── Phase 4 — Primary GL Coverage ───
    // FIX-PHASE-4-GL-PRIMARY-COVERAGE-2026-05-14
    // STRICT SOURCE RULE per Justin's spec: GL coverage data comes ONLY
    // from the gl_quote module. No fallbacks to supplemental (ACORDs),
    // summary-ops (AI synthesis), or any other module. If gl_quote is
    // gated out by the Phase 3.5 cross-applicant defense, or the field
    // pattern misses, the field stays empty — no degraded fallback.
    gl_carrier:                 ['gl_quote:json', 'gl_quote'],
    gl_effective_date:          ['gl_quote:json', 'gl_quote'],
    gl_expiration_date:         ['gl_quote:json', 'gl_quote'],
    gl_each_occurrence:         ['gl_quote:json', 'gl_quote'],
    gl_general_aggregate:       ['gl_quote:json', 'gl_quote'],
    gl_products_ops_aggregate:  ['gl_quote:json', 'gl_quote'],
    gl_personal_adv_injury:     ['gl_quote:json', 'gl_quote'],
    gl_premium:                 ['gl_quote:json', 'gl_quote'],

    // ─── Phase 7 — Primary AL Coverage ───
    // FIX-PHASE-7-AL-PRIMARY-COVERAGE-2026-05-14
    // STRICT SOURCE RULE per Justin's spec (same as GL): AL coverage data
    // comes ONLY from the al_quote module. No fallbacks. The #details-al
    // panel is 5 fields: carrier, eff, exp, CSL, premium (no split limits).
    al_carrier:                 ['al_quote:json', 'al_quote'],
    al_effective_date:          ['al_quote:json', 'al_quote'],
    al_expiration_date:         ['al_quote:json', 'al_quote'],
    al_combined_single_limit:   ['al_quote:json', 'al_quote'],
    al_premium:                 ['al_quote:json', 'al_quote'],

    // ─── Phase 8 — Employers Liability Coverage ───
    // FIX-PHASE-8-EMPLOYERS-LIABILITY-2026-05-14
    // OPTION B source priority: a dedicated standalone WC/EL quote
    // (el_quote) is the authoritative source; when EL appears only as a
    // coverage line inside a GL package quote, gl_quote also emits the
    // EL fields and serves as the fallback. Resolver tries el_quote
    // first, gl_quote second. The #details-el panel is 7 fields:
    // carrier, eff, exp, BI-by-accident, BI-by-disease, disease-policy
    // -limit, premium. (#details-el-clone is a CLONABLE template, not a
    // default-rendered panel — workbench applier clones+enables it.)
    el_carrier:                 ['el_quote:json', 'el_quote', 'gl_quote:json', 'gl_quote'],
    el_effective_date:          ['el_quote:json', 'el_quote', 'gl_quote:json', 'gl_quote'],
    el_expiration_date:         ['el_quote:json', 'el_quote', 'gl_quote:json', 'gl_quote'],
    el_bi_accident:             ['el_quote:json', 'el_quote', 'gl_quote:json', 'gl_quote'],
    el_bi_disease:              ['el_quote:json', 'el_quote', 'gl_quote:json', 'gl_quote'],
    el_disease_policy_limit:    ['el_quote:json', 'el_quote', 'gl_quote:json', 'gl_quote'],
    el_premium:                 ['el_quote:json', 'el_quote', 'gl_quote:json', 'gl_quote'],

    // ─── Phase 9 — Employee Benefits Liability Coverage ───
    // FIX-PHASE-9-EMPLOYEE-BENEFITS-LIABILITY-2026-05-14
    // EBL is most commonly a GL endorsement, so gl_quote is the common
    // source; standalone EBL quotes feed ebl_quote. Resolver tries
    // ebl_quote first, gl_quote fallback (Option B, same as EL). The
    // #details-ebl panel is 5 fields: carrier, eff, exp, each-employee
    // -limit, premium. Clonable template (details-ebl-clone).
    ebl_carrier:                ['ebl_quote:json', 'ebl_quote', 'gl_quote:json', 'gl_quote'],
    ebl_effective_date:         ['ebl_quote:json', 'ebl_quote', 'gl_quote:json', 'gl_quote'],
    ebl_expiration_date:        ['ebl_quote:json', 'ebl_quote', 'gl_quote:json', 'gl_quote'],
    ebl_each_employee_limit:    ['ebl_quote:json', 'ebl_quote', 'gl_quote:json', 'gl_quote'],
    ebl_premium:                ['ebl_quote:json', 'ebl_quote', 'gl_quote:json', 'gl_quote'],

    // ─── Phase 10 — Aircraft / Garage / Liquor ───
    // FIX-PHASE-10-AIRCRAFT-GARAGE-LIQUOR-2026-05-14
    // Aircraft & Garage: standalone policies, never GL endorsements →
    // STRICT dedicated-module source (like GL/AL). Liquor: genuinely can
    // be a GL endorsement → Option B (gl_quote fallback). All clonable
    // panels. Aircraft 5 fields, Garage 5 fields, Liquor 6 fields.
    aircraft_carrier:           ['aircraft_quote:json', 'aircraft_quote'],
    aircraft_effective_date:    ['aircraft_quote:json', 'aircraft_quote'],
    aircraft_expiration_date:   ['aircraft_quote:json', 'aircraft_quote'],
    aircraft_each_occurrence:   ['aircraft_quote:json', 'aircraft_quote'],
    aircraft_premium:           ['aircraft_quote:json', 'aircraft_quote'],

    garage_carrier:             ['garage_quote:json', 'garage_quote'],
    garage_effective_date:      ['garage_quote:json', 'garage_quote'],
    garage_expiration_date:     ['garage_quote:json', 'garage_quote'],
    garage_limit:               ['garage_quote:json', 'garage_quote'],
    garage_premium:             ['garage_quote:json', 'garage_quote'],

    liquor_carrier:             ['liquor_quote:json', 'liquor_quote', 'gl_quote:json', 'gl_quote'],
    liquor_effective_date:      ['liquor_quote:json', 'liquor_quote', 'gl_quote:json', 'gl_quote'],
    liquor_expiration_date:     ['liquor_quote:json', 'liquor_quote', 'gl_quote:json', 'gl_quote'],
    liquor_each_common_cause_limit: ['liquor_quote:json', 'liquor_quote', 'gl_quote:json', 'gl_quote'],
    liquor_aggregate_limit:     ['liquor_quote:json', 'liquor_quote', 'gl_quote:json', 'gl_quote'],
    liquor_premium:             ['liquor_quote:json', 'liquor_quote', 'gl_quote:json', 'gl_quote'],

    // ─── Phase 11 — Foreign GL / Foreign AL ───
    // FIX-PHASE-11-FOREIGN-GL-AL-2026-05-14
    // Foreign/international liability is a distinct policy form, not a GL
    // endorsement → STRICT dedicated-module source (no gl_quote fallback,
    // same rule as GL/AL Phase 4/7). Default-rendered panels. FGL 6
    // fields, FAL 5 fields.
    fgl_carrier:                ['foreign_gl_quote:json', 'foreign_gl_quote'],
    fgl_effective_date:         ['foreign_gl_quote:json', 'foreign_gl_quote'],
    fgl_expiration_date:        ['foreign_gl_quote:json', 'foreign_gl_quote'],
    fgl_each_occurrence:        ['foreign_gl_quote:json', 'foreign_gl_quote'],
    fgl_general_aggregate:      ['foreign_gl_quote:json', 'foreign_gl_quote'],
    fgl_premium:                ['foreign_gl_quote:json', 'foreign_gl_quote'],

    fal_carrier:                ['foreign_al_quote:json', 'foreign_al_quote'],
    fal_effective_date:         ['foreign_al_quote:json', 'foreign_al_quote'],
    fal_expiration_date:        ['foreign_al_quote:json', 'foreign_al_quote'],
    fal_combined_single_limit:  ['foreign_al_quote:json', 'foreign_al_quote'],
    fal_premium:                ['foreign_al_quote:json', 'foreign_al_quote']
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

    // FIX-PHASE-5.0-STRUCTURAL-VALIDITY-2026-05-14
    // Helper: validate a Tier 0 resolved value before returning it.
    // Returns the value as-is if it passes both checks, or null if it
    // fails (so resolveField falls through to the next descriptor).
    // Date fields skip these checks since ISO dates aren't expected
    // to satisfy either filter (sentinel words / structural validity
    // are designed for human-readable text).
    const validateTier0 = (val) => {
      if (val == null || val === '') return null;
      if (DATE_FIELDS.has(fieldName)) return val; // dates bypass filters
      if (isSentinelValue(val)) return null;
      if (!looksStructurallyValid(val)) return null;
      return val;
    };

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
      } else {
        // FIX-PHASE-5.0: reject captured-fragment garbage (e.g.,
        // submission.broker = "; retained indefinitely" on Anahuac).
        value = validateTier0(value);
        if (value == null) return null;
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
      // Hardcoded values are author-controlled — still run them through
      // validateTier0 as a defensive net (catches accidental typos that
      // produced sentinel/punctuation strings).
      const validated = DATE_FIELDS.has(fieldName) ? v : validateTier0(v);
      if (validated == null) return null;
      return {
        value: validated,
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

    // Module-based descriptors (Tier 1 = JSON code block, Tier 2 = markdown).
    // FIX-PHASE-3-TIER-1-2-DISPATCH-2026-05-14
    // Format:
    //   '<module>'        → Tier 2 markdown label parse
    //   '<module>:json'   → Tier 1 JSON code block parse
    //   '<module>:llm'    → Tier 3 LLM mini-extraction (not yet implemented)
    const colonIdx = descriptor.indexOf(':');
    const moduleKey = colonIdx === -1 ? descriptor : descriptor.slice(0, colonIdx);
    const tierHint  = colonIdx === -1 ? '' : descriptor.slice(colonIdx + 1);

    // Look up extractions on the active submission's snapshot. Multiple
    // possible paths because this code may be called from console with
    // shapes that differ — be permissive.
    const extractions =
      (submission && submission.snapshot && submission.snapshot.extractions) ||
      (submission && submission.extractions) ||
      null;
    if (!extractions) return null;
    const moduleRec = extractions[moduleKey];
    if (!moduleRec || typeof moduleRec.text !== 'string') return null;

    // FIX-PHASE-3.5-CROSS-APPLICANT-DEFENSE-2026-05-14
    // Refuse modules whose stated Named Insured doesn't match the
    // submission's account_name. Returns null treated as unknown
    // (proceed). Returns false explicitly = skip this module entirely.
    const applicantCheck = checkApplicantMatch(submission, moduleKey, moduleRec);
    if (applicantCheck === false) {
      return null;
    }

    const extractionConf = (typeof moduleRec.confidence === 'number')
      ? moduleRec.confidence
      : 1.0;

    if (tierHint === 'json') {
      const obj = parseJsonBlock(moduleRec.text);
      if (!obj) return null;
      // Map fieldName to a plausible JSON key. Lowercase camelCase
      // common variants; extend the variant list as needed when real
      // JSON outputs land in Phase 3.5+.
      const variants = [
        fieldName,
        camel(fieldName),
        fieldName.replace(/_/g, ' '),
        fieldName.replace(/_/g, '')
      ];
      let val = null;
      for (const v of variants) {
        if (obj[v] != null && obj[v] !== '') { val = obj[v]; break; }
      }
      if (val == null || val === '') return null;
      if (DATE_FIELDS.has(fieldName)) val = normalizeDateString(val);
      return {
        value: val,
        source: descriptor,
        tier: 1,
        confidence: extractionConf  // JSON is exact; parser_conf = 1.0
      };
    }

    if (tierHint === 'llm') {
      // Tier 3 — not yet wired. Phase 3.x or later.
      return null;
    }

    // Plain module reference → Tier 2 markdown parse
    const parsed = parseMarkdown(moduleRec.text, fieldName);
    if (!parsed) return null;
    let val = parsed.value;
    if (DATE_FIELDS.has(fieldName)) val = normalizeDateString(val);
    return {
      value: val,
      source: descriptor,
      tier: 2,
      // Composed confidence: extraction × parser (Justin's refinement)
      confidence: extractionConf * parsed.parser_confidence,
      extraction_confidence: extractionConf,
      parser_confidence: parsed.parser_confidence
    };
  }

  function camel(snake) {
    return snake.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
  }

  // ─── Public surface ───────────────────────────────────────────────────────

  root.WorkbenchRules = {
    SOURCE_AUTHORITY,
    GUIDELINE_CAPS,
    DEFAULTS,
    COMPUTE,
    DATE_FIELDS,
    LABEL_PATTERNS,
    resolveField,
    normalizeDateString,
    parseJsonBlock,
    parseMarkdown,
    isSentinelValue,
    looksStructurallyValid,
    extractNamedInsured,
    normalizeCompanyName,
    applicantsMatch,
    formatIso,
    version: 'phase11-foreign-gl-al',
    fixTag: 'FIX-PHASE-5.1-PAPERTXT-MIRROR-2026-05-14'
  };

  // FIX-PHASE-5.0-DEBUG-HELPER-2026-05-14
  // Optional debug surface — only exposed when the page URL contains
  // ?debug=1 (or &debug=1). Lets Justin reset the cross-applicant cache
  // between test scenarios without a full page reload. Cache is otherwise
  // private and immutable for safety, but observable + clearable in
  // debug mode for development iteration.
  try {
    const params = (typeof window !== 'undefined' && window.location)
      ? new URLSearchParams(window.location.search)
      : null;
    if (params && params.get('debug') === '1') {
      root.WorkbenchRules._debugClearApplicantCache = function () {
        const keys = Object.keys(_applicantMatchCache);
        for (const k of keys) delete _applicantMatchCache[k];
        console.log('[WorkbenchRules] _applicantMatchCache cleared (' + keys.length + ' entries)');
        return keys.length;
      };
      root.WorkbenchRules._debugInspectApplicantCache = function () {
        return Object.assign({}, _applicantMatchCache);
      };
      console.log('[WorkbenchRules] Debug mode active. Available:',
                  '_debugClearApplicantCache(), _debugInspectApplicantCache()');
    }
  } catch (e) { /* no-op outside browser */ }

  // Console-testable convenience wrapper. From the workbench console:
  //   window.workbenchResolveField('insured_name')
  //   → { value: 'Anahuac Infrastructure LLC', source: 'submission.account_name',
  //       tier: 0, confidence: 1.0 }
  root.workbenchResolveField = function (fieldName) {
    const sub = root.workbenchActiveSubmission || null;
    return resolveField(fieldName, sub);
  };
})(typeof window !== 'undefined' ? window : globalThis);
