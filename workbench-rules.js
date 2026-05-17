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
    // FIX-PHASE-GO-LIVE-75-EXPIRATION-SOURCE-PRIORITY-2026-05-16
    // policy_expiration reuses the SAME proven expiration patterns as
    // gl_expiration_date. The resolver's markdown parse keys on
    // LABEL_PATTERNS[fieldName], so with fieldName='policy_expiration'
    // and module descriptors 'gl_quote'/'al_quote' it extracts the
    // stated term from the quote text before any +1yr compute fallback.
    policy_expiration: [
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 1.0 },
      { re: /(?:^|\n)\s*(?:[-*]\s+)?\**\s*Expiry\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/im, conf: 0.75 },
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
    // FIX-PHASE-GO-LIVE-73-JSON-BALANCED-BRACE-2026-05-16
    // (extended GO-LIVE-75) The old fallback used a non-greedy
    // /({[\s\S]+?})/m which captured only up to the FIRST closing
    // brace. The balanced scanner below walks a depth counter
    // (string-literal aware) to the matching close so nested structures
    // survive. GO-LIVE-75: also handle a TOP-LEVEL ARRAY ([{...},{...}])
    // — if the model ever returns a bare array instead of an object,
    // the old code grabbed only the first element's object. We now
    // start at whichever of '{' or '[' appears first and balance the
    // matching bracket type, so a full top-level array is preserved.
    const objAt = text.indexOf('{');
    const arrAt = text.indexOf('[');
    let start = -1, openCh = '{', closeCh = '}';
    if (objAt !== -1 && (arrAt === -1 || objAt < arrAt)) {
      start = objAt; openCh = '{'; closeCh = '}';
    } else if (arrAt !== -1) {
      start = arrAt; openCh = '['; closeCh = ']';
    }
    if (start !== -1) {
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
          if (esc) { esc = false; }
          else if (ch === '\\') { esc = true; }
          else if (ch === '"') { inStr = false; }
          continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === openCh) depth++;
        else if (ch === closeCh) {
          depth--;
          if (depth === 0) {
            const candidate = text.slice(start, i + 1);
            try { return JSON.parse(candidate); }
            catch (e) { /* fall through to tolerant retry */ }
            try {
              // tolerant retry: strip trailing commas before } or ]
              return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
            } catch (e2) { return null; }
          }
        }
      }
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

  // FIX-PHASE-GO-LIVE-80-UNKNOWN-INSURED-2026-05-16
  // The real paid run (SUB-MP94Y8F5) exposed this: the excess module's
  // extracted "insured" was the literal phrase "Not stated on the
  // provided quote pages" (broker quote pages routinely omit the named
  // insured). The cross-applicant guard fed that phrase into
  // applicantsMatch, which returned false, which blocked the tower —
  // treating "the page is silent" identically to "the page names a
  // DIFFERENT company". Those are different and must be handled
  // differently (GPT + underwriter both flagged this):
  //   • silent on insured  → cannot confirm, ALLOW under review (null)
  //   • different insured   → wrong applicant, BLOCK (false)  ← unchanged
  // isSentinelValue intentionally NOT broadened (it gates 600+ lines of
  // resolver logic; widening it risks regressions). This is a focused
  // predicate used ONLY at the cross-applicant call sites.
  function isInsuredNotStated(s) {
    if (s == null) return true;
    const t = String(s).trim().toLowerCase();
    if (!t) return true;
    if (isSentinelValue(t)) return true;          // reuse existing coverage
    // Phrases that mean "the document does not state an insured" rather
    // than naming one. Anchored to the start so a real company name that
    // merely contains a word like "national" is unaffected.
    if (/^(not\s+stated|none\s+stated|insured\s+not\s+stated|no\s+named\s+insured|not\s+shown|not\s+listed\s+on|not\s+on\s+(the\s+)?(extract|quote|provided)|\(?\s*unknown\s*\)?|not\s+identified|unnamed|blank)\b/.test(t)) {
      return true;
    }
    if (/\bnot\s+stated\b/.test(t)) return true;  // "... not stated on the provided quote pages"
    return false;
  }

  // Cross-applicant verdict that distinguishes the three cases. Returns
  // 'match' | 'mismatch' | 'unverifiable'. The guards use this so a
  // silent-on-insured document is extracted under review, while a
  // genuinely different insured (Anahuac vs Carroll) is still blocked.
  function applicantVerdict(extractedName, submissionAccountName) {
    if (isInsuredNotStated(extractedName)) return 'unverifiable';
    const m = applicantsMatch(extractedName, submissionAccountName);
    if (m === true) return 'match';
    if (m === false) return 'mismatch';     // wrong applicant — block (unchanged)
    return 'unverifiable';
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
    // FIX-PHASE-GO-LIVE-80-UNKNOWN-INSURED-2026-05-16
    // Distinguish "document is silent on insured" (unverifiable →
    // allow under review, return null) from "document names a DIFFERENT
    // insured" (mismatch → block, return false — Anahuac defense
    // UNCHANGED).
    const verdict = applicantVerdict(extracted, submission.account_name);
    const match = verdict === 'match' ? true
                : verdict === 'mismatch' ? false
                : null;                       // 'unverifiable'
    _applicantMatchCache[cacheKey] = match;
    if (match === false) {
      // Log once per (submission, module) so console isn't spammed.
      console.warn(
        '[WorkbenchRules] Cross-applicant defense: module "' + moduleKey +
        '" stated insured "' + extracted +
        '" does not match submission "' + submission.account_name +
        '". Skipping for this submission.'
      );
    } else if (verdict === 'unverifiable'
               && isInsuredNotStated(extracted)) {
      console.log(
        '[WorkbenchRules] Module "' + moduleKey + '": insured not stated '
        + 'on source — extracted under review (not blocked).'
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
    policy_expiration:   [
      // FIX-PHASE-GO-LIVE-75-EXPIRATION-SOURCE-PRIORITY-2026-05-16
      // Per the stated rule: policy term must be pulled from the GL/AL
      // quote when present, NOT blindly computed as effective + 1 year
      // (wrong for short-term, multi-year, extended or non-annual
      // terms). These plain module descriptors run the resolver's
      // standard markdown parse, which keys on LABEL_PATTERNS
      // ['policy_expiration'] (added below, mirroring the proven
      // gl_expiration_date regexes) against the gl_quote / al_quote
      // module text. Falls back to the +1yr compute only when neither
      // quote actually states an expiration. Uses ONLY the existing
      // resolver mechanism — no new descriptor plumbing.
      'gl_quote', 'al_quote',
      'compute:effective_plus_year'
    ],
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
    fal_premium:                ['foreign_al_quote:json', 'foreign_al_quote'],

    // ─── v8.6.81 — Workbench fill reliability fields ───
    // These fields drove the paid-run disappointment: the modules had
    // usable prose, but the workbench only filled fields that resolved
    // through the older coverage/deal-info paths. These resolver entries
    // are intentionally module-specific and are backed by adapter parsers
    // below, so the existing SUB-MP94Y8F5 extraction can be repaired
    // without a full paid rerun.
    iso_class_code:             ['classcode:json', 'classcode', 'gl_quote:json', 'gl_quote', 'summary-ops'],
    iso_description:            ['classcode:json', 'classcode', 'gl_quote:json', 'gl_quote', 'summary-ops'],
    hazard_grade:               ['classcode:json', 'classcode', 'exposure:json', 'exposure', 'guidelines'],
    exposure_amount:            ['gl_quote:json', 'gl_quote', 'classcode:json', 'classcode', 'exposure:json', 'exposure', 'supplemental'],
    exposure_basis:             ['gl_quote:json', 'gl_quote', 'classcode:json', 'classcode', 'exposure:json', 'exposure', 'supplemental'],
    website:                    ['website:json', 'website', 'summary-ops', 'supplemental'],
    exposure_to_loss:           ['exposure:json', 'exposure'],
    account_strengths:          ['strengths:json', 'strengths'],
    guideline_conflicts_text:   ['guidelines:json', 'guidelines'],
    description_operations:     ['summary-ops:json', 'summary-ops', 'supplemental:json', 'supplemental', 'website:json', 'website'],
    underwriting_rationale:     ['discrepancy:json', 'discrepancy', 'guidelines:json', 'guidelines', 'exposure:json', 'exposure', 'summary-ops']
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
      // v8.6.81: JSON outputs may be wrapped under workbench_fields,
      // fields, data, or module-specific objects, and arrays may contain
      // objects with the desired key. Use a deep, synonym-aware lookup
      // instead of only top-level exact keys.
      let val = lookupJsonField(obj, fieldName);
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

    // Plain module reference → v8.6.81 adapter first, then Tier 2
    // markdown-label parsing. The adapter is module-specific and exists
    // specifically because real paid-run outputs are heterogeneous
    // (classcode markdown, tower HTML/JSON, prose narratives) and should
    // not be treated as one generic label soup.
    const adapted = moduleSpecificFieldAdapter(moduleKey, moduleRec.text, fieldName, submission);
    if (adapted && adapted.value != null && adapted.value !== '') {
      let val = adapted.value;
      if (DATE_FIELDS.has(fieldName)) val = normalizeDateString(val);
      return {
        value: val,
        source: descriptor + ':adapter',
        tier: 2.5,
        confidence: extractionConf * (adapted.parser_confidence || 0.85),
        extraction_confidence: extractionConf,
        parser_confidence: adapted.parser_confidence || 0.85,
        reason: adapted.reason || null
      };
    }

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

  // ===================================================================
  // v8.6.81 — Workbench fill reliability adapters
  // ===================================================================
  // These adapters do not call the API. They salvage the already-paid
  // extraction text by parsing the actual module shapes seen in the live
  // run: classcode markdown, narrative sections, and quote prose. This is
  // deliberately module-specific; generic keyword scans caused false
  // construction classifications and are not allowed for routing.

  const JSON_FIELD_SYNONYMS = {
    iso_class_code: ['iso_class_code','isoClassCode','class_code','classCode','code','iso_code','isoCode'],
    iso_description: ['iso_description','isoDescription','class_description','classDescription','description','class_desc'],
    hazard_grade: ['hazard_grade','hazardGrade','hazard','hg','risk_grade','riskGrade'],
    exposure_amount: ['exposure_amount','exposureAmount','sales','gross_sales','grossSales','receipts','payroll','amount'],
    exposure_basis: ['exposure_basis','exposureBasis','basis','rating_basis','ratingBasis','base'],
    exposure_to_loss: ['exposure_to_loss','exposureToLoss','exposure','loss_exposure','lossExposure'],
    account_strengths: ['account_strengths','accountStrengths','strengths','account_strength','strength'],
    guideline_conflicts_text: ['guideline_conflicts_text','guidelineConflicts','guidelines','guideline_cross_reference','guidelineCrossReference'],
    description_operations: ['description_operations','descriptionOfOperations','operations','summary_of_operations','summaryOfOperations','descOps'],
    underwriting_rationale: ['underwriting_rationale','underwritingRationale','rationale','pricing_rationale','pricingRationale'],
    broker_company: ['broker_company','brokerCompany','brokerage','producer_firm','producerFirm'],
    broker_name: ['broker_name','brokerName','producer_name','producerName'],
    broker_address: ['broker_address','brokerAddress','producer_address','producerAddress'],
    home_state: ['home_state','homeState','state','domicile_state','domicileState'],
    website: ['website','url','site','web_site']
  };

  function lookupJsonField(obj, fieldName) {
    if (obj == null) return null;
    const keys = [fieldName, camel(fieldName), fieldName.replace(/_/g, ' '), fieldName.replace(/_/g, '')]
      .concat(JSON_FIELD_SYNONYMS[fieldName] || []);
    const norm = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
    const wanted = new Set(keys.map(norm));
    const seen = new Set();
    function walk(node) {
      if (node == null) return null;
      if (typeof node !== 'object') return null;
      if (seen.has(node)) return null;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const item of node) {
          const v = walk(item);
          if (v != null && v !== '') return v;
        }
        return null;
      }
      for (const [k, v] of Object.entries(node)) {
        if (wanted.has(norm(k)) && v != null && v !== '') return v;
      }
      // Favor common wrapper objects before arbitrary recursion.
      for (const wrap of ['workbench_fields','workbenchFields','fields','data','extracted','extracted_fields','extractedFields']) {
        if (node[wrap] && typeof node[wrap] === 'object') {
          const v = walk(node[wrap]);
          if (v != null && v !== '') return v;
        }
      }
      for (const v of Object.values(node)) {
        const out = walk(v);
        if (out != null && out !== '') return out;
      }
      return null;
    }
    return walk(obj);
  }

  function stripMarkup(text) {
    if (!text) return '';
    return String(text)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>|<\/div>|<\/li>|<\/tr>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function unmarkdown(text) {
    return stripMarkup(text)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      .replace(/\*\*/g, '')
      .replace(/^\s*[-*]\s+/gm, '')
      .trim();
  }

  function firstReasonableParagraph(text, maxChars) {
    const clean = unmarkdown(text);
    const paras = clean.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    let p = paras.find(x => x.length > 80) || paras[0] || clean;
    // Strip a leading section heading such as "Summary of Operations:"
    // or "Exposure to Loss:" while preserving the actual narrative.
    p = p.replace(/^[A-Z][A-Za-z0-9 &\/\-]{2,90}:\s*/i, '').trim();
    if (maxChars && p.length > maxChars) p = p.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
    return p;
  }

  function normalizeMoneyForDisplay(v) {
    const n = _num(v);
    if (n == null) return null;
    return Math.round(n).toLocaleString('en-US');
  }

  function moduleSpecificFieldAdapter(moduleKey, text, fieldName, submission) {
    const raw = text || '';
    const clean = unmarkdown(raw);
    const lower = clean.toLowerCase();
    const hit = (value, conf, reason) => {
      if (value == null || value === '' || isSentinelValue(value)) return null;
      return { value, parser_confidence: conf || 0.80, reason: reason || 'adapter' };
    };

    // Classcode module — anchor on the module's stated primary class code.
    if (moduleKey === 'classcode') {
      let m = /\*\*Code\s+(\d{4,5})\s+—\s+([^*]+?)\*\*/.exec(raw)
           || /\bCode\s+(\d{4,5})\s+[—-]\s+([^\n]+)/i.exec(clean)
           || /\bISO\s+(?:Class\s+)?Code\s*:?\s*(\d{4,5})\s*(?:[—-]\s*([^\n]+))?/i.exec(clean);
      if (fieldName === 'iso_class_code' && m) return hit(m[1], 0.98, 'primary_classcode');
      if (fieldName === 'iso_description' && m && m[2]) return hit(m[2].trim(), 0.95, 'primary_class_description');
      if (fieldName === 'exposure_basis') {
        if (/sales|revenue|receipts|merchant wholesaler|dealer|distributor|retail|wholesale/i.test(clean)) return hit('Gross Sales/Revenues', 0.85, 'classcode_sales_basis');
        if (/payroll/i.test(clean)) return hit('Payroll', 0.80, 'classcode_payroll_basis');
        if (/acre|acres/i.test(clean)) return hit('Acres', 0.80, 'classcode_acres_basis');
      }
      if (fieldName === 'hazard_grade') {
        m = /Hazard\s+Grade\s*:?\s*(?:HG\s*)?([1-6]|Low|Moderate(?:\s+High)?|High)\b/i.exec(clean)
         || /\bHG\s*([1-6])\b/i.exec(clean);
        if (m) return hit(normalizeHazardGrade(m[1]), 0.85, 'classcode_hazard');
        if (/fertilizer|chemical|hazardous|pollution|contamination/i.test(clean)) return hit('High', 0.65, 'classcode_severity_inferred');
      }
      if (fieldName === 'exposure_amount') {
        m = /(?:sales|revenue|receipts|exposure)\D{0,40}(\$?\s*[0-9][0-9,\.]*\s*(?:million|thousand|m|mm|k)?)/i.exec(clean);
        const v = m && normalizeMoneyForDisplay(m[1]);
        if (v) return hit(v, 0.70, 'classcode_exposure_amount');
      }
      if (fieldName === 'description_operations') return hit(firstReasonableParagraph(clean, 1200), 0.80, 'classcode_ops_summary');
    }

    // Quote modules — recover common quote terms from prose when JSON is absent.
    if (moduleKey === 'gl_quote' || moduleKey === 'al_quote') {
      const isGL = moduleKey === 'gl_quote';
      const carrier = /(?:Carrier|Insurer|Insurance Company)\s*:?\s*([^\n]+)/i.exec(clean);
      const period = /(?:Policy\s+)?Period\s*:?\s*([0-9\/\-.]+)\s*(?:[-–—]|to|through|thru)\s*([0-9\/\-.]+)/i.exec(clean);
      if ((fieldName === 'gl_carrier' && isGL) || (fieldName === 'al_carrier' && !isGL)) {
        if (carrier) return hit(carrier[1].trim(), 0.85, 'quote_carrier');
      }
      if ((fieldName === 'gl_effective_date' && isGL) || (fieldName === 'al_effective_date' && !isGL)) {
        if (period) return hit(period[1], 0.85, 'quote_period_start');
      }
      if ((fieldName === 'gl_expiration_date' && isGL) || (fieldName === 'al_expiration_date' && !isGL)) {
        if (period) return hit(period[2], 0.85, 'quote_period_end');
      }
      const moneyLine = (labels) => {
        for (const lab of labels) {
          const re = new RegExp(lab + '\\s*:?\\s*\\$?\\s*([0-9][0-9,\\.]*\\s*(?:million|thousand|m|mm|k)?)', 'i');
          const mm = re.exec(clean);
          if (mm) return normalizeMoneyForDisplay(mm[1]);
        }
        return null;
      };
      if (fieldName === 'gl_each_occurrence') return hit(moneyLine(['Each Occurrence','Occurrence Limit','Each Occ']), 0.80, 'gl_each_occurrence');
      if (fieldName === 'gl_general_aggregate') return hit(moneyLine(['General Aggregate','Aggregate Limit','Aggregate']), 0.80, 'gl_aggregate');
      if (fieldName === 'gl_products_ops_aggregate') return hit(moneyLine(['Products\\/Completed Operations Aggregate','Products.*Aggregate','Products\\s*Comp.*Agg']), 0.75, 'gl_products_aggregate');
      if (fieldName === 'gl_personal_adv_injury') return hit(moneyLine(['Personal.*Advertising Injury','Personal and Adv Injury','PI.*Adv']), 0.75, 'gl_pai');
      if (fieldName === 'gl_premium') return hit(moneyLine(['GL Premium','Total Premium','Annual Premium','Premium']), 0.75, 'gl_premium');
      if (fieldName === 'al_combined_single_limit') return hit(moneyLine(['Combined Single Limit','CSL','Each Accident']), 0.80, 'al_csl');
      if (fieldName === 'al_premium') return hit(moneyLine(['AL Premium','Auto Premium','Total Premium','Annual Premium','Premium']), 0.75, 'al_premium');
      if (fieldName === 'exposure_amount') return hit(moneyLine(['Exposure','Sales','Receipts','Revenue']), 0.65, 'quote_exposure_amount');
      if (fieldName === 'exposure_basis') {
        if (/sales|revenue|receipts/i.test(clean)) return hit('Gross Sales/Revenues', 0.75, 'quote_sales_basis');
        if (/payroll/i.test(clean)) return hit('Payroll', 0.70, 'quote_payroll_basis');
      }
    }

    // Narrative modules — return clean text, bounded for UI textareas.
    if (fieldName === 'exposure_to_loss' && moduleKey === 'exposure') return hit(firstReasonableParagraph(clean, 2500), 0.90, 'exposure_narrative');
    if (fieldName === 'account_strengths' && moduleKey === 'strengths') return hit(firstReasonableParagraph(clean, 2200), 0.90, 'strengths_narrative');
    if (fieldName === 'guideline_conflicts_text' && moduleKey === 'guidelines') return hit(firstReasonableParagraph(clean, 2500), 0.88, 'guidelines_narrative');
    if (fieldName === 'description_operations' && (moduleKey === 'summary-ops' || moduleKey === 'supplemental' || moduleKey === 'website')) return hit(firstReasonableParagraph(clean, 2200), 0.86, 'ops_narrative');
    if (fieldName === 'underwriting_rationale' && (moduleKey === 'discrepancy' || moduleKey === 'guidelines' || moduleKey === 'exposure' || moduleKey === 'summary-ops')) return hit(firstReasonableParagraph(clean, 2200), 0.78, 'rationale_narrative');

    // Website / URL.
    if (fieldName === 'website') {
      const m = /(https?:\/\/[^\s)]+|www\.[^\s)]+)/i.exec(clean);
      if (m) return hit(m[1], 0.75, 'website_url');
    }
    return null;
  }

  function normalizeHazardGrade(v) {
    const s = String(v || '').trim().toLowerCase();
    if (s === '1' || s.includes('low')) return 'Low';
    if (s === '2' || s === '3' || s === 'moderate') return 'Moderate';
    if (s === '4' || s.includes('moderate high')) return 'Moderate High';
    if (s === '5' || s === '6' || s.includes('high')) return 'High';
    return String(v || '').trim();
  }

  function buildFieldCoverageReport(submission) {
    const groups = {
      'Deal Information': ['insured_name','policy_effective','policy_expiration','home_state','mailing_address','controlling_address','broker_company','broker_name','broker_address','broker_region','market','paper','underwriter','assistant'],
      'Layer / Tower Gate': ['layer_type'],
      'Primary GL': ['gl_carrier','gl_effective_date','gl_expiration_date','gl_each_occurrence','gl_general_aggregate','gl_products_ops_aggregate','gl_personal_adv_injury','gl_premium'],
      'Primary AL': ['al_carrier','al_effective_date','al_expiration_date','al_combined_single_limit','al_premium'],
      'Risk Profile': ['iso_class_code','iso_description','hazard_grade','exposure_amount','exposure_basis','website'],
      'Underwriting Narrative': ['description_operations','exposure_to_loss','account_strengths','guideline_conflicts_text','underwriting_rationale']
    };
    const rows = [];
    let resolved = 0, missing = 0, review = 0;
    let ltDecision = null;
    try { ltDecision = decideLayerType(submission); } catch (e) { ltDecision = null; }
    for (const [group, fields] of Object.entries(groups)) {
      for (const field of fields) {
        let r = null;
        if (field === 'layer_type' && ltDecision && ltDecision.layerType) {
          r = { value: ltDecision.layerType, source: 'decideLayerType', tier: 'decision', confidence: ltDecision.conflict ? 0.80 : 0.95, reason: (ltDecision.reasons || []).join(' | ') };
        } else {
          r = resolveField(field, submission);
        }
        const status = r && r.value ? (ltDecision && field === 'layer_type' && ltDecision.conflict ? 'review' : 'resolved') : 'missing';
        if (status === 'resolved') resolved++;
        else if (status === 'review') review++;
        else missing++;
        rows.push({
          group, field, status,
          value: r && r.value != null ? String(r.value).slice(0, 160) : '',
          source: r ? r.source : '',
          tier: r ? r.tier : '',
          confidence: r && r.confidence != null ? Number(r.confidence).toFixed(3) : '',
          reason: r && r.reason ? r.reason : (status === 'missing' ? 'No authoritative source parsed' : '')
        });
      }
    }
    const ex = (submission && submission.snapshot && submission.snapshot.extractions) || (submission && submission.extractions) || {};
    const modules = Object.keys(ex).sort().map(k => {
      const rec = ex[k] || {};
      const txt = typeof rec.text === 'string' ? rec.text : '';
      const json = txt ? parseJsonBlock(txt) : null;
      let applicant = 'unknown';
      try {
        const stated = extractNamedInsured(txt);
        applicant = stated ? applicantVerdict(stated, submission && submission.account_name) : 'not_found';
      } catch (e) { applicant = 'error'; }
      return { module: k, hasText: !!txt, chars: txt.length, hasJson: !!json, applicant };
    });
    return { summary: { resolved, review, missing, total: resolved + review + missing }, rows, modules, layerDecision: ltDecision };
  }

  function camel(snake) {
    return snake.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
  }

  // ─── Public surface ───────────────────────────────────────────────────────

  // ─── Phase 12 — Excess Tower parser ───
  // FIX-PHASE-12-EXCESS-TOWER-2026-05-14
  // The excess module emits a VARIABLE number of "**Layer N:**" blocks —
  // fundamentally different from every prior coverage (fixed single-value
  // fields). This dedicated parser:
  //   1. Detects the Phase-6.1/3.5 refusal diagnostic → blocked
  //   2. Runs the cross-applicant gate (extractNamedInsured vs account)
  //      → blocked on mismatch (same defense as resolveField applies to
  //      single-value modules; replicated here since the tower bypasses
  //      resolveField)
  //   3. Splits into layer blocks, extracts per-layer fields, filters
  //      sentinel/empty layers
  // Returns: { blocked: bool, reason: string, layers: [ {carrier,
  //   effective_date, expiration_date, limit, aggregate, premium} ] }
  // ─── Phase 13.0 — Tower Assembly Engine ───
  // FIX-PHASE-13.0-TOWER-ASSEMBLY-2026-05-14
  //
  // parseExcessTower (Phase 12) parses ONE excess module's text into a
  // flat layer list. assembleTower (this) is the whole-packet pass: it
  // takes the set of in-tower documents (each carrying its own Dec Page
  // limit + Schedule-of-Underlying attachment + optional quota-share
  // participation) and reconstructs the real tower:
  //
  //   • Classify each doc lead vs excess by POSITION, not per-file label.
  //     Lead = schedules primary coverages AND attaches at base ($0 over
  //     primary). An excess that also schedules primary is still excess
  //     if its Dec Page limit attaches up the tower.
  //   • Quota-share / shared rung: multiple carriers at the SAME
  //     attachment sharing one combined layer limit. The combined limit
  //     is counted ONCE; next attachment = prior attachment + full
  //     combined limit (NOT + a participation).
  //   • Validate continuity: each rung's attachment must equal the
  //     running sum of full limits beneath it. Gap / overlap / conflict
  //     / unclassifiable → that rung is marked status:'????' (the UI
  //     highlights it, colors it the Underlying color, user relabels).
  //   • A user relabel (Phase 13.1) is structured input: it overrides a
  //     rung's limit/attachment and the walk-up RE-RUNS so everything
  //     stacked above re-chains. assembleTower is pure + deterministic
  //     so re-running with an override just works.
  //
  // INPUT: docs = [ {
  //    id, name,
  //    decLimit,            // number — this policy's own Dec Page limit
  //    statedAttachment,    // number|null — attachment from its Schedule
  //                         //   of Underlying, if the doc states one
  //    schedulesPrimary,    // bool — does its SoU list primary coverages
  //    sharedGroupKey,      // string|null — rungs sharing one combined
  //                         //   layer carry the same key
  //    sharedCombinedLimit, // number|null — full combined layer limit
  //                         //   when this is a quota-share participation
  //    carrier,
  //    override             // {limit?, attachment?, kind?} from a user
  //                         //   relabel (Phase 13.1) — wins over parsed
  //  }, ... ]
  // OUTPUT: { rungs: [...], blocked, anyUncertain, totalTowerLimit }
  // FIX-PHASE-GO-LIVE-73-MONEY-PARSER-2026-05-16
  // Multiplier-aware money parser. The old implementation stripped all
  // non-numeric characters then parseFloat'd, so "$5M" -> 5 (a silent
  // 1,000,000x error — the single most dangerous bug in an underwriting
  // tower). This version understands magnitude suffixes/words and, when
  // a value is genuinely ambiguous, returns null rather than a
  // misleadingly tiny number. Callers already treat null as "absent /
  // user must confirm", which is the safe failure mode for money.
  function _num(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim().toLowerCase();
    if (!s) return null;
    // Strip currency symbols, spaces and thousands separators, but keep
    // letters (k/m/mm/b, "million", "thousand") and the decimal point.
    s = s.replace(/[\$£€,]/g, '').replace(/\s+/g, ' ').trim();

    // Word multipliers: "5 million", "2.5 thousand", "1 billion".
    let m = s.match(/^([0-9]*\.?[0-9]+)\s*(billion|million|thousand)\b/);
    if (m) {
      const base = parseFloat(m[1]);
      if (!isFinite(base)) return null;
      const mult = m[2] === 'billion' ? 1e9
                 : m[2] === 'million' ? 1e6
                 : 1e3;
      return base * mult;
    }
    // Suffix multipliers: 5m, 5mm, $5M, 250k, 1b, 5.0mm.
    m = s.match(/^([0-9]*\.?[0-9]+)\s*(mm|m|k|b)\b/);
    if (m) {
      const base = parseFloat(m[1]);
      if (!isFinite(base)) return null;
      const suf = m[2];
      const mult = suf === 'b' ? 1e9
                 : (suf === 'm' || suf === 'mm') ? 1e6
                 : 1e3; // k
      return base * mult;
    }
    // Plain number path. After removing currency/commas we should have
    // only digits and at most one decimal point. If any unrecognised
    // letters remain, the value is ambiguous — return null (safe) rather
    // than silently producing a wrong magnitude.
    if (/[a-z]/.test(s)) return null;        // unhandled letters → ambiguous
    const plain = parseFloat(s.replace(/[^0-9.]/g, ''));
    return isFinite(plain) ? plain : null;
  }

  function assembleTower(docs) {
    if (!Array.isArray(docs) || docs.length === 0) {
      return { rungs: [], blocked: false, anyUncertain: false, totalTowerLimit: 0 };
    }
    // 1. Normalize + apply any user overrides (Phase 13.1 hook). An
    //    override's explicit limit/attachment/kind always wins.
    const items = docs.map((d, idx) => {
      const ov = d.override || {};
      return {
        idx,
        id: d.id || ('doc-' + idx),
        name: d.name || ('doc-' + idx),
        sourceDocName: d.sourceDocName || null,
        carrier: d.carrier || null,
        decLimit: _num(ov.limit != null ? ov.limit : d.decLimit),
        statedAttachment: _num(ov.attachment != null ? ov.attachment : d.statedAttachment),
        _attFromUser: (ov.attachment != null),   // provenance: user relabel
        schedulesPrimary: !!d.schedulesPrimary,
        sharedGroupKey: d.sharedGroupKey || null,
        sharedCombinedLimit: _num(d.sharedCombinedLimit),
        forcedKind: ov.kind || null,   // user can force 'lead' | 'excess'
        // FIX-PHASE-GO-LIVE-73-TOWER-ECONOMICS-2026-05-16
        // Preserve layer economics through normalization so rung
        // construction (and the workbench writer) can populate
        // eff/exp/aggregate/premium, not just carrier+limit.
        effectiveDate: d.effectiveDate || d.effective || null,
        expirationDate: d.expirationDate || d.expiration || null,
        aggregate: _num(d.aggregate),
        premium: _num(d.premium),
        override: ov
      };
    });

    // 2. Group quota-share participations. Rungs sharing a sharedGroupKey
    //    are ONE tower rung; combined limit counted once.
    const groups = new Map();      // key -> [items]
    const singles = [];
    for (const it of items) {
      if (it.sharedGroupKey) {
        if (!groups.has(it.sharedGroupKey)) groups.set(it.sharedGroupKey, []);
        groups.get(it.sharedGroupKey).push(it);
      } else {
        singles.push(it);
      }
    }

    // 3. Build provisional rungs. Each rung: { kind, limit, attachment,
    //    participants:[{carrier, participation}], status, sources:[ids] }
    const rungs = [];

    for (const it of singles) {
      const isLead = it.forcedKind === 'lead'
        || (it.forcedKind !== 'excess'
            && it.schedulesPrimary
            && (it.statedAttachment === 0 || it.statedAttachment == null));
      rungs.push({
        kind: isLead ? 'lead' : 'excess',
        limit: it.decLimit,
        attachment: isLead ? 0 : it.statedAttachment,
        participants: [{ carrier: it.carrier, participation: it.decLimit,
                         sourceDocName: it.sourceDocName || null, sourceId: it.id }],
        shared: false,
        status: 'ok',
        sources: [it.id],
        // FIX-PHASE-GO-LIVE-73-TOWER-ECONOMICS-2026-05-16
        // Preserve full layer economics so the workbench writer can
        // populate eff/exp/aggregate/premium, not just carrier+limit.
        effectiveDate: it.effectiveDate || it.effective || null,
        expirationDate: it.expirationDate || it.expiration || null,
        aggregate: it.aggregate != null ? it.aggregate : null,
        premium: it.premium != null ? it.premium : null,
        sourceDocName: it.sourceDocName || null,
        _statedAttachment: it.statedAttachment,
        _userRelabelAttachment: !!it._attFromUser
      });
    }
    for (const [key, parts] of groups.entries()) {
      // Combined layer limit: prefer an explicit sharedCombinedLimit,
      // else sum the participations (P/O amounts).
      const _explicitCombined = parts.find(p => p.sharedCombinedLimit)?.sharedCombinedLimit;
      const _sumParticipations = parts.reduce((s, p) => s + (p.decLimit || 0), 0);
      const combined = _explicitCombined || _sumParticipations;
      // FIX-PHASE-GO-LIVE-79-QS-IMBALANCE-2026-05-16
      // Extension v8.6.78 audit (HIGH, F1): an explicit
      // sharedCombinedLimit was trusted unconditionally even when it
      // contradicted the sum of the group's participations (e.g.
      // combined=15M but 5M+5M=10M participations, or combined=8M which
      // is LESS than 10M of participations). Every other tower anomaly
      // (gap, overlap, contradictory attachment, unreadable limit)
      // raises status:'????' + anyUncertain so the underwriter verifies
      // — QS imbalance was the one hole. A stated combined that does not
      // reconcile with the participations is internally contradictory
      // data (parser error, LLM hallucination, stale dec) and must be
      // surfaced, not silently bound against. Tolerance: 1% of the
      // larger magnitude (covers rounding) AND require >1 participant
      // with a positive sum (a single-participant group has nothing to
      // reconcile against — that is a legitimately stated combined).
      let _qsImbalance = false;
      if (_explicitCombined != null && isFinite(_explicitCombined)
          && parts.length > 1 && _sumParticipations > 0) {
        const _tol = Math.max(_explicitCombined, _sumParticipations) * 0.01;
        if (Math.abs(_explicitCombined - _sumParticipations) > _tol) {
          _qsImbalance = true;
        }
      }
      const att = parts.map(p => p.statedAttachment).find(a => a != null);
      const anyLead = parts.some(p => p.forcedKind === 'lead'
        || (p.forcedKind !== 'excess' && p.schedulesPrimary && (p.statedAttachment === 0 || p.statedAttachment == null)));
      rungs.push({
        kind: anyLead ? 'lead' : 'excess',
        limit: combined,                       // FULL combined — counted once
        attachment: anyLead ? 0 : (att == null ? null : att),
        // FIX-PHASE-13.4: every participant carries its own carrier +
        // sourceDocName so the File Manager can label ALL participant
        // docs in a shared rung (extension-flagged QS gap, 13.3).
        participants: parts.map(p => ({
          carrier: p.carrier,
          participation: p.decLimit,
          sourceDocName: p.sourceDocName || null,
          sourceId: p.id
        })),
        shared: true,
        sharedGroupKey: key,
        status: _qsImbalance ? '????' : 'ok',
        uncertaintyReason: _qsImbalance ? 'qs_combined_mismatch' : undefined,
        sources: parts.map(p => p.id),
        // FIX-PHASE-GO-LIVE-73-TOWER-ECONOMICS-2026-05-16
        // Shared layer: dates from any participant that has them;
        // premium summed across participants; aggregate = combined.
        effectiveDate: (parts.find(p => p.effectiveDate || p.effective) || {}).effectiveDate
                     || (parts.find(p => p.effective) || {}).effective || null,
        expirationDate: (parts.find(p => p.expirationDate || p.expiration) || {}).expirationDate
                     || (parts.find(p => p.expiration) || {}).expiration || null,
        aggregate: combined,
        premium: parts.some(p => p.premium != null)
          ? parts.reduce((s, p) => s + (p.premium || 0), 0) : null,
        sourceDocName: (parts.find(p => p.sourceDocName) || {}).sourceDocName || null,
        _statedAttachment: att,
        _userRelabelAttachment: parts.some(p => p._attFromUser)
      });
    }

    // ── Phase 13.4 — MULTI-PASS TOWER SOLVER ──
    // FIX-PHASE-13.4-MULTIPASS-SOLVER-2026-05-14
    //
    // Replaces the old single bottom-up walk-up. The old logic let one
    // unresolved rung poison every rung above it, and flagged any
    // computed (not document-stated) attachment as ????. Per Justin's
    // spec, the solver instead:
    //   • NEVER blocks — best-effort places everything determinable.
    //   • A ???? is an ISLAND: it does not poison rungs above it.
    //   • Resolves rungs from BELOW (running sum) AND from ABOVE
    //     (backfill: if rung N+1's attachment is known and the rungs
    //     between are known, rung N's position falls out by subtraction).
    //   • Iterates passes until the tower stops changing — a fix or a
    //     newly-read rung can cascade and unlock others.
    //   • computed-but-confident → status 'ok' and FILLS (Option A); only
    //     genuinely undeterminable rungs stay '????'.
    //   • CONFLICT GUARDRAIL: if below-says ≠ above-says for the same
    //     rung, it stays '????' reason 'conflict' — backfill resolves
    //     MISSING info, never silently chooses between CONTRADICTORY docs.
    //   • PROVENANCE: every placed rung records how its attachment was
    //     determined — 'stated' | 'computed_below' | 'computed_above' |
    //     'user_relabel' | 'lead_base' — so the later train/gap-find loop
    //     can see exactly why each layer landed where it did.

    // Lead handling first — anchors the base.
    let leadCount = 0;
    rungs.forEach(r => {
      if (r.kind === 'lead') {
        leadCount++;
        r.attachment = 0;
        r._attSource = 'lead_base';
        if (r._statedAttachment != null && _num(r._statedAttachment) !== 0) {
          // doc said non-zero but we classified lead → still base, note it
          r._attSource = 'lead_base';
        }
      }
    });

    // Sort: leads first, then by best-known attachment, unknowns last.
    rungs.sort((a, b) => {
      if (a.kind === 'lead' && b.kind !== 'lead') return -1;
      if (b.kind === 'lead' && a.kind !== 'lead') return 1;
      const aa = a.attachment == null ? Infinity : a.attachment;
      const bb = b.attachment == null ? Infinity : b.attachment;
      return aa - bb;
    });

    // ── Phase 13.4 — SEQUENCE TOWER SOLVER ──
    // A tower is a SEQUENCE: the lead sits at 0, and each excess rung
    // sits exactly on the top of the one below it (contiguous, no gaps
    // in a valid tower). We solve it as a sequence walk, not generic
    // graph neighbor-finding:
    //   • cursor starts at the lead's top (= lead.limit).
    //   • STATED attachment is an anchor. A rung whose stated attachment
    //     == cursor confirms (provenance 'stated'); cursor advances.
    //   • A rung with NO stated attachment but a known limit, sitting at
    //     the frontier, takes attachment = cursor (provenance
    //     'computed_below'); cursor advances by its limit.
    //   • BACKFILL: a still-unresolved limit-bearing rung whose top must
    //     equal a known anchor above (next stated/user/resolved rung)
    //     gets attachment = thatAnchor - limit (provenance
    //     'computed_above').
    //   • CONFLICT GUARDRAIL: if from-below and from-above both apply
    //     and disagree → '????' reason 'conflict', records both; never
    //     silently chooses.
    //   • ISLAND: a rung with NO limit is undeterminable; it BREAKS the
    //     cursor chain. Rungs above an island keep their OWN stated
    //     attachment (status ok — they stand alone) but cannot be
    //     computed_below across the break.
    //   • A stated rung is authoritative for its own position and is
    //     only flagged gap/overlap when the contiguous chain genuinely
    //     reaches a contradicting value adjacent to it.
    const EPS = 0.5;

    const lead = rungs.find(r => r.kind === 'lead');
    const leadTop = (lead && lead.limit != null && lead.limit > 0) ? lead.limit : null;
    if (lead) { lead.attachment = 0; lead._resolved = true; lead._attSource = 'lead_base'; }

    // Seed stated / user rungs.
    rungs.forEach(r => {
      if (r.kind === 'lead') return;
      if (r._userRelabelAttachment === true && r._statedAttachment != null) {
        r.attachment = _num(r._statedAttachment);
        r._attSource = 'user_relabel'; r._resolved = true;
      } else if (r._statedAttachment != null) {
        r.attachment = _num(r._statedAttachment);
        r._attSource = 'stated'; r._resolved = true;
      } else {
        r.attachment = null; r._resolved = false;
      }
    });

    const excess = rungs.filter(r => r.kind !== 'lead');

    // Helper: nearest known anchor attachment strictly above a level,
    // among rungs that have an attachment (stated/user/resolved).
    function anchorAbove(level) {
      let best = null;
      for (const o of excess) {
        const a = (o._statedAttachment != null) ? _num(o._statedAttachment)
                : (o._resolved ? o.attachment : null);
        if (a == null) continue;
        if (a <= level + EPS) continue;
        if (best == null || a < best) best = a;
      }
      return best;
    }

    // ITERATE: walk the cursor up from the lead, resolving the frontier
    // rung each pass; repeat until the tower stops changing (so a
    // backfill or a user fix can cascade).
    let progressed = true, guard = 0;
    while (progressed && guard < excess.length + 6) {
      progressed = false; guard++;
      if (leadTop == null) break;

      // Build the contiguous cursor chain from the lead.
      let cursor = leadTop;
      let chainBroken = false;
      // Working order: a rung's sort key is its stated/resolved
      // attachment if known, else the live cursor (so an unplaced
      // limit-only rung is tried AT the frontier, before any higher
      // stated anchor). Ties broken by stable source id.
      const ordered = excess.slice().sort((a, b) => {
        const ak = (a._resolved && a.attachment != null) ? a.attachment
                 : (a._statedAttachment != null ? _num(a._statedAttachment) : cursor);
        const bk = (b._resolved && b.attachment != null) ? b.attachment
                 : (b._statedAttachment != null ? _num(b._statedAttachment) : cursor);
        if (ak !== bk) return ak - bk;
        return a.sources[0] < b.sources[0] ? -1 : 1;
      });

      for (let i = 0; i < ordered.length; i++) {
        const r = ordered[i];

        if (r.limit == null || r.limit <= 0) {
          // Island: undeterminable height. Breaks the chain for
          // computed_below, but rungs with their own stated attachment
          // above remain valid.
          chainBroken = true;
          continue;
        }

        if (r._resolved) {
          // Resolved (stated/user/computed). Advance the cursor through
          // it. Gap/overlap flagging for STATED rungs is done by the
          // post-convergence validation walk, not here — doing it in the
          // resolve loop conflates "chain broken by undeterminable
          // island" (rung stands alone) with "chain computable but
          // contradictory" (flag it), which need different handling.
          if (Math.abs(r.attachment - cursor) <= EPS) {
            cursor = r.attachment + r.limit;
          } else if (r.attachment > cursor) {
            cursor = r.attachment + r.limit; // don't cascade past it
          } else {
            cursor = Math.max(cursor, r.attachment + r.limit);
          }
          continue;
        }

        // UNRESOLVED rung with a known limit.
        const fromBelow = chainBroken ? null : cursor;
        const aAbove = anchorAbove(chainBroken ? -Infinity : cursor);
        const fromAbove = (aAbove != null) ? (aAbove - r.limit) : null;

        if (fromBelow != null && fromAbove != null) {
          if (Math.abs(fromBelow - fromAbove) <= EPS) {
            r.attachment = fromBelow; r._attSource = 'computed_below';
            r._resolved = true; r.status = 'ok'; progressed = true;
            cursor = r.attachment + r.limit;
          } else {
            r.status = '????'; r.uncertaintyReason = 'conflict';
            r.conflictBelow = fromBelow; r.conflictAbove = fromAbove;
            if (r._lastConflict !== fromBelow + '/' + fromAbove) {
              r._lastConflict = fromBelow + '/' + fromAbove; progressed = true;
            }
            chainBroken = true; // unresolved → chain can't continue past
          }
        } else if (fromBelow != null) {
          r.attachment = fromBelow; r._attSource = 'computed_below';
          r._resolved = true; r.status = 'ok'; progressed = true;
          cursor = r.attachment + r.limit;
        } else if (fromAbove != null) {
          r.attachment = fromAbove; r._attSource = 'computed_above';
          r._resolved = true; r.status = 'ok'; progressed = true;
          // do not move the (broken) cursor
        } else {
          chainBroken = true; // can't place it this pass; blocks chain
        }
      }
    }

    // ── Post-convergence VALIDATION WALK ──
    // Walk rungs in tower order summing limits from the lead. For each
    // STATED rung, the expected attachment is the running sum beneath
    // it. If its stated attachment disagrees → gap (stated too high) or
    // overlap (stated too low). A rung with NO limit is an undeterminable
    // ISLAND: it breaks the walk, and rungs above the break are NOT
    // validated against the chain (they stand on their own stated
    // attachment — an island must not poison them). Conflict rungs have
    // a limit, so the walk continues through them and still flags a
    // contradicting stated rung above.
    (function validationWalk() {
      if (leadTop == null) return;
      // Order by best-known position. A no-limit / unresolved rung with
      // no stated attachment has no natural sort key; place it just
      // below the nearest stated rung above it so it sits in the right
      // tower position (an island between lead and a $10M-xs-$10M rung
      // must sort BELOW that rung, not at the end).
      const ex = rungs.filter(r => r.kind !== 'lead');
      const keyOf = (r) => {
        if (r.attachment != null) return r.attachment;
        if (r._statedAttachment != null) return _num(r._statedAttachment);
        return null; // unknown — positioned relative to neighbors below
      };
      const seq = ex.slice().sort((a, b) => {
        const ak = keyOf(a), bk = keyOf(b);
        const av = ak == null ? Infinity : ak;
        const bv = bk == null ? Infinity : bk;
        if (av !== bv) return av - bv;
        return a.sources[0] < b.sources[0] ? -1 : 1;
      });
      // Is there an undeterminable island (no limit AND no stated
      // attachment) anywhere in the program? If so, the chain is not
      // globally trustworthy and STATED rungs stand on their own — we do
      // not gap/overlap-flag them (per spec: a ???? island must not
      // poison independently-stated rungs).
      const hasUndeterminableIsland = ex.some(r =>
        (r.limit == null || r.limit <= 0) && r._statedAttachment == null && !r._resolved);

      let running = leadTop;
      let broken = false;
      for (const r of seq) {
        if (r.limit == null || r.limit <= 0) { broken = true; continue; }
        if (!broken && !hasUndeterminableIsland && r._attSource === 'stated') {
          if (r.attachment > running + EPS) {
            if (r.status !== '????') {
              r.status = '????'; r.uncertaintyReason = 'gap';
              r.expectedAttachment = running;
            }
          } else if (r.attachment < running - EPS) {
            if (r.status !== '????') {
              r.status = '????'; r.uncertaintyReason = 'overlap';
              r.expectedAttachment = running;
            }
          }
        }
        const base = (r.attachment != null) ? r.attachment : running;
        running = base + r.limit;
      }
    })();

    // Final classification of anything still unresolved.
    let anyUncertain = false;
    for (const r of rungs) {
      // FIX-PHASE-GO-LIVE-79-INVERTED-DATES-2026-05-16
      // Extension v8.6.78 audit (MEDIUM, F2): a rung whose
      // expirationDate precedes its effectiveDate was returned with
      // status:'ok' / anyUncertain:false, while every other anomaly
      // (gap, overlap, QS imbalance, unreadable limit) raises ????.
      // Inverted dates are internally contradictory data — flag them
      // the same way so the underwriter verifies. Only when BOTH dates
      // parse to valid timestamps (don't penalize a missing date).
      if (r.effectiveDate && r.expirationDate) {
        const _ef = Date.parse(r.effectiveDate);
        const _ex = Date.parse(r.expirationDate);
        if (isFinite(_ef) && isFinite(_ex) && _ex < _ef) {
          r.status = '????';
          if (!r.uncertaintyReason) r.uncertaintyReason = 'inverted_dates';
          anyUncertain = true;
          continue;
        }
      }
      if (r.kind === 'lead') {
        if (r.limit == null || r.limit <= 0) { r.status = '????'; r.uncertaintyReason = 'unreadable_limit'; anyUncertain = true; }
        else r.status = (r.status === '????') ? r.status : 'ok';
        if (r.status === '????') anyUncertain = true;
        continue;
      }
      if (r.limit == null || r.limit <= 0) {
        r.status = '????'; r.uncertaintyReason = 'unreadable_limit'; anyUncertain = true; continue;
      }
      if (!r._resolved || r.attachment == null) {
        r.status = '????';
        if (!r.uncertaintyReason) r.uncertaintyReason = 'attachment_undeterminable';
        anyUncertain = true;
        continue;
      }
      if (r.status === '????') { anyUncertain = true; continue; } // conflict/gap/overlap kept
      r.status = 'ok';
    }

    if (leadCount > 1) {
      anyUncertain = true;
      rungs.filter(r => r.kind === 'lead').forEach(r => {
        r.status = '????'; r.uncertaintyReason = 'multiple_leads';
      });
    }
    if (leadCount === 0 && rungs.length > 0) {
      anyUncertain = true;
      rungs[0].status = '????';
      rungs[0].uncertaintyReason = 'no_lead';
    }

    // Human-readable label + expose provenance per rung.
    const fmtM = (n) => {
      if (n == null) return '?';
      if (n >= 1e6 && n % 1e6 === 0) return '$' + (n / 1e6) + 'M';
      if (n >= 1e6) return '$' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
      return '$' + n.toLocaleString();
    };
    for (const r of rungs) {
      r.attachmentProvenance = r._attSource || (r.kind === 'lead' ? 'lead_base' : null);
      if (r.status === '????') {
        r.label = '????';
      } else if (r.kind === 'lead') {
        r.label = 'LEAD ' + fmtM(r.limit);
      } else {
        r.label = fmtM(r.limit) + ' xs ' + fmtM(r.attachment);
      }
    }

    const top = rungs.reduce((mx, r) =>
      (r.status === 'ok' && r.attachment != null && r.limit != null)
        ? Math.max(mx, r.attachment + r.limit) : mx, 0);

    return {
      rungs,
      blocked: false,
      anyUncertain,
      totalTowerLimit: top
    };
  }

  function parseExcessTower(text, accountName) {
    if (!text || typeof text !== 'string') {
      return { blocked: false, reason: 'no_text', layers: [] };
    }
    // 1. Refusal diagnostic (Phase 6.1 gate or prompt-level refusal)
    if (/\*\*\s*No matching underlying excess policies found for this insured/i.test(text)
        || /\*\*\s*No matching .* found for this insured/i.test(text)) {
      return { blocked: true, reason: 'refusal_diagnostic', layers: [] };
    }
    // 2. Cross-applicant gate — replicate the resolveField-level defense
    if (accountName && accountName !== '(unknown)') {
      const stated = extractNamedInsured(text);
      // FIX-PHASE-GO-LIVE-80-UNKNOWN-INSURED-2026-05-16: block only a
      // genuinely DIFFERENT insured. "Not stated"/"(unknown)" on quote
      // pages → unverifiable → allow tower under review (SUB-MP94Y8F5
      // root cause). Anahuac wrong-applicant → still 'mismatch' → blocked.
      if (stated && applicantVerdict(stated, accountName) === 'mismatch') {
        console.warn(
          '[WorkbenchRules] Cross-applicant defense: excess tower stated insured "' +
          stated + '" does not match submission "' + accountName +
          '". Skipping tower for this submission.'
        );
        return { blocked: true, reason: 'cross_applicant', layers: [], statedInsured: stated };
      }
    }
    // 3. Split into "**Layer N:**" blocks
    const layerSplit = text.split(/\*\*\s*Layer\s+\d+\s*[:\*]/i);
    // element 0 is the preamble before Layer 1 — discard it
    const blocks = layerSplit.slice(1);
    if (blocks.length === 0) {
      return { blocked: false, reason: 'no_layers', layers: [] };
    }
    const grab = (block, re) => {
      const m = re.exec(block);
      return m && m[1] ? m[1].trim() : null;
    };
    const layers = [];
    for (let block of blocks) {
      // Trim the block at the Tower Summary if it bled in (last block)
      const sumIdx = block.search(/\*\*\s*Tower\s+Summary/i);
      if (sumIdx !== -1) block = block.slice(0, sumIdx);

      const carrier = grab(block, /(?:^|\n)\s*[-*]?\s*\**\s*Carrier\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/i);
      // Limit: prefer explicit "Layer Limit", else first $ of "Limits: $X xs $Y", else "Limits: $X"
      let limit = grab(block, /(?:^|\n)\s*[-*]?\s*\**\s*Layer\s+Limit\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/i);
      if (!limit) {
        limit = grab(block, /(?:^|\n)\s*[-*]?\s*\**\s*Limits?\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:xs|x\/s|excess\s+of|over)\b/i);
      }
      if (!limit) {
        limit = grab(block, /(?:^|\n)\s*[-*]?\s*\**\s*Limits?\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/i);
      }
      const aggregate = grab(block, /(?:^|\n)\s*[-*]?\s*\**\s*Aggregate\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/i);
      const premium = grab(block, /(?:^|\n)\s*[-*]?\s*\**\s*Premium\**\s*:\s*\**\s*\$?\s*([\d,]+(?:\.\d+)?)/i);

      // Dates: from "Period: A – B", or explicit Effective/Expiration lines
      let eff = null, exp = null;
      const period = /(?:^|\n)\s*[-*]?\s*\**\s*Period\**\s*:\s*\**\s*([\d\/\-\.]+)\s*(?:[-–—]|to\b|thru\b|through\b)\s*([\d\/\-\.]+)/i.exec(block);
      if (period) { eff = period[1]; exp = period[2]; }
      else {
        eff = grab(block, /(?:^|\n)\s*[-*]?\s*\**\s*(?:Policy\s+)?Effective\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/i);
        exp = grab(block, /(?:^|\n)\s*[-*]?\s*\**\s*(?:Policy\s+)?Expiration\s+Date\**\s*:\s*\**\s*([^\n]+?)(?:\n|$)/i);
      }

      // Sentinel filtering — drop placeholder values
      const clean = (v) => (v && !isSentinelValue(v)) ? v : null;
      const layer = {
        carrier:         clean(carrier),
        effective_date:  clean(eff)  ? normalizeDateString(clean(eff))  : null,
        expiration_date: clean(exp)  ? normalizeDateString(clean(exp))  : null,
        limit:           clean(limit),
        aggregate:       clean(aggregate),
        premium:         clean(premium)
      };
      // Skip a layer that has NO useful data at all (carrier + limit both empty)
      if (!layer.carrier && !layer.limit && !layer.premium) continue;
      layers.push(layer);
    }
    return { blocked: false, reason: 'parsed', layers: layers };
  }

  // ─── Phase 13.1 — Relabel persistence + propagation ───
  // FIX-PHASE-13.1-RELABEL-PROPAGATION-2026-05-14
  //
  // _sampleTowerInputDoc: the canonical assembleTower() input contract,
  // exposed so validation tooling can build correct fixtures without
  // guessing field names (the input-side analogue of the Phase 10
  // liquor_*_limit naming fix). Returns one representative lead doc and
  // one representative quota-share participation doc.
  function _sampleTowerInputDoc() {
    return {
      contract: {
        id:                  'string  — stable doc id',
        name:                'string  — display name',
        sourceDocName:       'string|null — exact source file name this layer was read from; used by buildTowerView to label that file in the File Manager',
        carrier:             'string  — carrier on this policy',
        decLimit:            'number  — this policy\'s OWN Dec Page limit (e.g. 5000000)',
        statedAttachment:    'number|null — attachment from its Schedule of Underlying; 0 or null for the lead',
        schedulesPrimary:    'bool    — does its Schedule of Underlying list primary coverages',
        sharedGroupKey:      'string|null — rungs sharing ONE combined layer carry the same key',
        sharedCombinedLimit: 'number|null — the FULL combined layer limit when this is a quota-share participation',
        effectiveDate:       'string|null — ISO YYYY-MM-DD, this layer own effective date',
        expirationDate:      'string|null — ISO YYYY-MM-DD, this layer own expiration date',
        aggregate:           'number|null — this layer own aggregate limit if stated',
        premium:             'number|null — this layer own premium if stated',
        override:            '{limit?:number, attachment?:number, kind?:"lead"|"excess"} — user relabel; wins over parsed values'
      },
      exampleLead: {
        id: 'lead', name: 'Lead Umbrella', sourceDocName: 'Lead Umbrella Policy.pdf',
        carrier: 'Lead Co',
        decLimit: 5000000, statedAttachment: 0, schedulesPrimary: true
      },
      exampleExcess: {
        id: 'r1', name: '$5M xs $5M layer', sourceDocName: 'First Excess 5x5.pdf',
        carrier: 'Carrier One',
        decLimit: 5000000, statedAttachment: 5000000, schedulesPrimary: false
      },
      exampleQuotaShareParticipation: {
        id: 'r2a', name: 'Insurer A 50% of $10M xs $10M', sourceDocName: 'Insurer A Quote.pdf',
        carrier: 'Insurer A',
        decLimit: 5000000, statedAttachment: 10000000,
        sharedGroupKey: 'g10', sharedCombinedLimit: 10000000
      },
      exampleUserOverride: {
        id: 'r3', name: 'corrected layer', carrier: 'Carrier Three',
        decLimit: 4000000, statedAttachment: null,
        override: { limit: 4000000, attachment: 20000000 }
      }
    };
  }

  // applyTowerRelabel: the structured-relabel entry point. A user
  // relabel is NOT a display string — it is input to the assembly math.
  // Given the submission, the doc id, and the correction, this:
  //   1. writes the override into the submission's tower-relabel store
  //      (lives in submission.snapshot.towerRelabels — travels with the
  //      submission, no new Supabase schema)
  //   2. re-runs assembleTower with the override applied
  //   3. returns the freshly reconstructed tower so the caller can
  //      re-render / re-fill
  // Re-running is safe because assembleTower is pure + deterministic;
  // one corrected rung re-chains everything stacked above it.
  //
  // correction = { limit?:number, attachment?:number, kind?:'lead'|'excess' }
  function applyTowerRelabel(submission, docId, correction, towerDocs) {
    if (!submission || !docId || !correction) {
      return { ok: false, reason: 'bad_args' };
    }
    if (!submission.snapshot) submission.snapshot = {};
    if (!submission.snapshot.towerRelabels) submission.snapshot.towerRelabels = {};
    // Merge (not replace) — user may correct limit now, attachment later.
    const prev = submission.snapshot.towerRelabels[docId] || {};
    const merged = Object.assign({}, prev, {});
    if (correction.limit != null)      merged.limit = _num(correction.limit);
    if (correction.attachment != null) merged.attachment = _num(correction.attachment);
    if (correction.kind)               merged.kind = correction.kind;
    merged._relabeledByUser = true;
    merged._relabeledAt = new Date().toISOString();
    submission.snapshot.towerRelabels[docId] = merged;

    // Apply all stored relabels onto the doc set, then re-assemble.
    const relabels = submission.snapshot.towerRelabels;
    const withOverrides = (towerDocs || []).map(d => {
      const ov = relabels[d.id];
      return ov ? Object.assign({}, d, { override: Object.assign({}, d.override || {}, ov) }) : d;
    });
    const tower = assembleTower(withOverrides);
    return {
      ok: true,
      tower,
      relabels: submission.snapshot.towerRelabels,
      docId,
      applied: merged
    };
  }

  // Read stored relabels back (e.g. on submission reload) so a rebuilt
  // tower reflects every prior user correction. Pure accessor.
  function getTowerRelabels(submission) {
    return (submission && submission.snapshot && submission.snapshot.towerRelabels) || {};
  }

  // Convenience: assemble a tower with any stored relabels already
  // applied. This is what the workbench (13.4) and File Manager (13.3)
  // call so persisted corrections always take effect on reload.
  function assembleTowerWithRelabels(submission, towerDocs) {
    const relabels = getTowerRelabels(submission);
    const withOverrides = (towerDocs || []).map(d => {
      const ov = relabels[d.id];
      return ov ? Object.assign({}, d, { override: Object.assign({}, d.override || {}, ov) }) : d;
    });
    return assembleTower(withOverrides);
  }

  // ─── Phase 13.2 — Structured tower-document extraction ───
  // FIX-PHASE-13.2-EXCESS-STRUCTURED-TOWER-2026-05-14
  //
  // The excess module (Phase 13.2 prompt rework) now emits a
  // ```json { "tower_documents": [...] } ``` block whose objects match
  // the assembleTower() input contract exactly. parseTowerDocuments
  // extracts that block into the array assembleTower consumes. It also
  // runs the same refusal-diagnostic + cross-applicant gate as
  // parseExcessTower so contaminated excess data can never reach the
  // tower (defense-in-depth parity with every other coverage).
  //
  // Returns: { blocked, reason, docs:[...assembleTower input...], statedInsured? }
  function parseTowerDocuments(excessText, accountName) {
    if (!excessText || typeof excessText !== 'string') {
      return { blocked: false, reason: 'no_text', docs: [] };
    }
    // Refusal diagnostic — same check as parseExcessTower
    if (/\*\*\s*No matching underlying excess policies found for this insured/i.test(excessText)
        || /\*\*\s*No matching .* found for this insured/i.test(excessText)) {
      return { blocked: true, reason: 'refusal_diagnostic', docs: [] };
    }
    // Cross-applicant gate — replicate the resolveField-level defense
    if (accountName && accountName !== '(unknown)') {
      const stated = extractNamedInsured(excessText);
      // FIX-PHASE-GO-LIVE-80-UNKNOWN-INSURED-2026-05-16: block only a
      // genuinely DIFFERENT insured. Silent-on-insured quote pages →
      // unverifiable → allow under review. Anahuac → still blocked.
      if (stated && applicantVerdict(stated, accountName) === 'mismatch') {
        console.warn(
          '[WorkbenchRules] Cross-applicant defense: excess tower_documents stated insured "' +
          stated + '" does not match submission "' + accountName +
          '". Skipping tower for this submission.'
        );
        return { blocked: true, reason: 'cross_applicant', docs: [], statedInsured: stated };
      }
    }
    // Extract the ```json ... ``` block containing tower_documents.
    // Prefer a fenced block; fall back to a bare {...} with the key.
    let jsonStr = null;
    const fenced = excessText.match(/```(?:json)?\s*([\s\S]*?"tower_documents"[\s\S]*?)```/i);
    if (fenced) {
      jsonStr = fenced[1];
    } else {
      const bare = excessText.match(/\{[\s\S]*?"tower_documents"[\s\S]*\}/);
      if (bare) jsonStr = bare[0];
    }
    if (!jsonStr) {
      return { blocked: false, reason: 'no_json_block', docs: [] };
    }
    let parsed;
    try {
      parsed = JSON.parse(jsonStr.trim());
    } catch (e) {
      // Tolerant retry: trim to outermost balanced braces
      const first = jsonStr.indexOf('{');
      const last = jsonStr.lastIndexOf('}');
      if (first !== -1 && last !== -1 && last > first) {
        try { parsed = JSON.parse(jsonStr.slice(first, last + 1)); }
        catch (e2) { return { blocked: false, reason: 'json_parse_error', docs: [] }; }
      } else {
        return { blocked: false, reason: 'json_parse_error', docs: [] };
      }
    }
    const list = parsed && Array.isArray(parsed.tower_documents)
      ? parsed.tower_documents : [];
    // Normalize to the assembleTower input contract, dropping nothing —
    // assembleTower itself handles nulls / classification / ????.
    const docs = list.map((d, i) => ({
      id:                  (d.id != null ? String(d.id) : ('tower-doc-' + i)),
      name:                (d.name != null ? String(d.name) : ('Layer ' + (i + 1))),
      sourceDocName:       d.sourceDocName != null ? String(d.sourceDocName) : null,
      carrier:             d.carrier != null ? String(d.carrier) : null,
      decLimit:            d.decLimit,
      statedAttachment:    d.statedAttachment,
      schedulesPrimary:    !!d.schedulesPrimary,
      sharedGroupKey:      d.sharedGroupKey != null ? String(d.sharedGroupKey) : null,
      sharedCombinedLimit: d.sharedCombinedLimit != null ? d.sharedCombinedLimit : null,
      // FIX-PHASE-GO-LIVE-74-TOWER-ECONOMICS-PASSTHROUGH-2026-05-16
      // v73 wired assembleTower+writer to carry these, but this parser
      // (the real prompt→assembler hop) silently dropped them, so on
      // real Opus output they were always null. Forward them now so the
      // economics survive the full pipeline, not just hand-fed tests.
      effectiveDate:       d.effectiveDate != null ? String(d.effectiveDate) : null,
      expirationDate:      d.expirationDate != null ? String(d.expirationDate) : null,
      aggregate:           d.aggregate != null ? d.aggregate : null,
      premium:             d.premium != null ? d.premium : null
    }));
    return { blocked: false, reason: 'parsed', docs: docs };
  }

  // Convenience: excess module text → fully assembled tower (with any
  // persisted user relabels applied). This is the single call the
  // workbench (13.4) and File Manager (13.3) will use.
  function buildTowerFromExcessModule(submission) {
    const extractions =
      (submission && submission.snapshot && submission.snapshot.extractions) ||
      (submission && submission.extractions) || null;
    const rec = extractions && extractions.excess;
    const accountName = (submission && submission.account_name) || null;
    if (!rec || typeof rec.text !== 'string') {
      return { blocked: false, reason: 'no_excess_module', rungs: [], anyUncertain: false, totalTowerLimit: 0, docs: [] };
    }
    const pt = parseTowerDocuments(rec.text, accountName);
    if (pt.blocked) {
      return { blocked: true, reason: pt.reason, statedInsured: pt.statedInsured, rungs: [], anyUncertain: false, totalTowerLimit: 0, docs: [] };
    }
    if (!pt.docs.length) {
      return { blocked: false, reason: pt.reason, rungs: [], anyUncertain: false, totalTowerLimit: 0, docs: [] };
    }
    const tower = assembleTowerWithRelabels(submission, pt.docs);
    return Object.assign({ blocked: false, reason: 'assembled', docs: pt.docs }, tower);
  }

  // ─── Phase 13.3 — File Manager tower view ───
  // FIX-PHASE-13.3-FILEMANAGER-TOWER-LABELS-2026-05-14
  //
  // buildTowerView produces everything the File Manager needs to label
  // and color in-tower documents WITHOUT the File Manager knowing any
  // tower math. It:
  //   1. assembles the tower (with persisted relabels) from the excess
  //      module via buildTowerFromExcessModule
  //   2. best-effort matches each uploaded document to a rung by
  //      sourceDocName ↔ file name (normalized, fuzzy-contains both ways)
  //   3. returns per-doc annotations { docId, towerLabel, color,
  //      isUncertain, rungSourceId } AND the full ordered tower so the
  //      File Manager can also render a tower summary panel.
  //
  // Color rule (locked with Justin): in-tower docs use the Underlying
  // color. The File Manager's tag-color system maps 'yellow' →
  // 'Underlying' (see pipeline-documents-view tagColorLabels). So every
  // in-tower doc — lead, excess, OR ???? — is colored 'yellow'. ????
  // docs additionally carry isUncertain:true so the UI highlights them
  // for the user to relabel. Nothing in the tower is left uncolored;
  // an unresolved rung is still visually grouped with its tower.
  //
  // Unmatched rungs (no uploaded file confidently matched) are NOT
  // dropped — they appear in the returned tower[] with matchedDocId:null
  // so the summary panel can still show them as ???? for relabeling.
  const TOWER_UNDERLYING_COLOR = 'yellow';

  function _normName(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, '')          // drop extension
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function _nameMatch(a, b) {
    const na = _normName(a), nb = _normName(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    // fuzzy contains both directions, min length guard avoids junk hits
    const shorter = na.length <= nb.length ? na : nb;
    const longer  = na.length <= nb.length ? nb : na;
    return shorter.length >= 5 && longer.includes(shorter);
  }

  function buildTowerView(submission, uploadedDocs) {
    const built = buildTowerFromExcessModule(submission);
    const out = {
      blocked: !!built.blocked,
      reason: built.reason,
      statedInsured: built.statedInsured || null,
      anyUncertain: !!built.anyUncertain,
      totalTowerLimit: built.totalTowerLimit || 0,
      tower: [],          // ordered rungs, each annotated for the summary panel
      docAnnotations: {}  // docId -> { towerLabel, color, isUncertain, rungSourceId }
    };
    if (built.blocked || !built.rungs || built.rungs.length === 0) {
      return out;
    }
    const docs = Array.isArray(uploadedDocs) ? uploadedDocs : [];
    // Map rung.sources[0] (the tower-doc id) → its sourceDocName via the
    // parsed docs list (built.docs carries sourceDocName from 13.2/13.3).
    const srcNameById = {};
    (built.docs || []).forEach(d => { srcNameById[d.id] = d.sourceDocName || d.name || null; });

    built.rungs.forEach((r, idx) => {
      const rungSourceId = (r.sources && r.sources[0]) || ('rung-' + idx);
      const isUncertain = r.status === '????';
      const towerLabel = r.label || (isUncertain ? '????' : '');
      out.tower.push({
        order: idx,
        kind: r.kind,
        label: towerLabel,
        status: r.status,
        uncertaintyReason: r.uncertaintyReason || null,
        attachmentProvenance: r.attachmentProvenance || null,
        shared: !!r.shared,
        participants: r.participants || [],
        limit: r.limit,
        attachment: r.attachment,
        rungSourceId: rungSourceId,
        sourceDocName: srcNameById[rungSourceId] || null
      });
      // FIX-PHASE-13.4: annotate EVERY participant doc in the rung, not
      // just the first. A shared rung exposes participants[] each with
      // its own sourceDocName/sourceId — match and label them all so a
      // 60/40 quota-share shows the tower label on BOTH carrier docs.
      const partList = (r.shared && Array.isArray(r.participants) && r.participants.length)
        ? r.participants.map(p => ({ srcName: p.sourceDocName, srcId: p.sourceId }))
        : [{ srcName: srcNameById[rungSourceId], srcId: rungSourceId }];

      let participationIdx = 0;
      for (const part of partList) {
        const srcName = part.srcName || srcNameById[part.srcId] || null;
        if (!srcName) { participationIdx++; continue; }
        const hit = docs.find(dc => _nameMatch(srcName, dc.name || dc.fileName || dc.filename));
        if (!hit) { participationIdx++; continue; }
        // Shared rungs get a participation hint on the chip so the user
        // can tell the two carrier docs apart at a glance.
        let docLabel = towerLabel;
        if (r.shared && r.participants && r.participants.length > 1 && !isUncertain) {
          const pc = r.participants[participationIdx];
          if (pc && pc.carrier) docLabel = towerLabel + ' (' + pc.carrier + ')';
        }
        out.docAnnotations[hit.id] = {
          towerLabel: docLabel,
          color: TOWER_UNDERLYING_COLOR,   // 'yellow' = Underlying
          isUncertain: isUncertain,
          rungSourceId: rungSourceId,
          shared: !!r.shared
        };
        participationIdx++;
      }
    });
    return out;
  }

  // ─── Phase 14.0 — Subjectivity Intelligence ───
  // FIX-PHASE-14.0-SUBJECTIVITY-INTELLIGENCE-2026-05-14
  //
  // recommendSubjectivities(submission) reads the assembled tower + the
  // extracted primary coverages and returns which of the workbench's
  // standing subjectivities the deal's OWN facts call for. Each
  // recommendation is classified:
  //   • mode 'auto'    — mechanically implied by a fact the system is
  //                      certain of (e.g. the tower literally contains a
  //                      quota-share rung → "quota share partner
  //                      policies" subjectivity). The same threshold
  //                      philosophy as the tower solver: a deterministic
  //                      consequence auto-applies (Option A parity).
  //   • mode 'suggest' — judgment-based; surfaced with reasoning but the
  //                      underwriter decides (the subjectivity analogue
  //                      of a ???? — the system flags, you choose).
  // Pure + deterministic + offline-provable. Zero API spend. Matched to
  // the EXACT subjectivity label strings present in workbench.html so
  // the applier can check the right boxes by text.
  //
  // Returns: { recommendations: [ { label, mode, reason, factSource } ],
  //            anySuggest, towerBlocked }
  //
  // label values are matched (normalized, prefix-tolerant) against the
  // checkbox label text in #form-subjectivities.
  function recommendSubjectivities(submission) {
    const out = { recommendations: [], anySuggest: false, towerBlocked: false };
    if (!submission) return out;

    // Build the resolved tower (re-uses the full 13.x pipeline; persisted
    // relabels already applied). Subjectivities key off its facts.
    let tower = null;
    if (typeof buildTowerFromExcessModule === 'function') {
      tower = buildTowerFromExcessModule(submission);
      if (tower && tower.blocked) { out.towerBlocked = true; }
    }
    const rungs = (tower && !tower.blocked && Array.isArray(tower.rungs)) ? tower.rungs : [];

    const hasQuotaShare   = rungs.some(r => r.shared === true);
    const leadRung        = rungs.find(r => r.kind === 'lead');
    const leadResolved    = !!leadRung && leadRung.status !== '????';
    const excessRungs     = rungs.filter(r => r.kind !== 'lead');
    const hasInterveningExcess = excessRungs.length > 0;
    const anyUncertainRung = rungs.some(r => r.status === '????');
    const carriersPresent  = rungs.some(r =>
      (r.participants || []).some(p => p && p.carrier));

    // Which primary coverages did the pipeline extract FOR THIS INSURED?
    // FIX-PHASE-14.0.2-SUBJECTIVITY-CROSS-APPLICANT-GATE-2026-05-14
    // Cross-applicant defense parity: a coverage extraction only counts
    // toward a coverage.primary subjectivity if (a) it isn't a refusal
    // diagnostic AND (b) its stated named insured matches this
    // submission's account. Without (b) the recommender would fire a
    // "produce the underlying GL/Auto policy" subjectivity off a quote
    // that actually belongs to a DIFFERENT insured (the Anahuac /
    // Carroll County contamination case) — every other phase already
    // honors this gate; the subjectivity recommender now does too.
    const ex = (submission.snapshot && submission.snapshot.extractions)
            || submission.extractions || {};
    const acct = submission.account_name || null;
    const has = (k) => {
      const rec = ex[k];
      if (!rec || typeof rec.text !== 'string' || !rec.text.trim()) return false;
      if (/no matching .* found for this insured/i.test(rec.text)) return false;
      // Cross-applicant gate — identical defense to Phases 6.1 / 4 / 7.
      if (acct && acct !== '(unknown)'
          && typeof extractNamedInsured === 'function'
          && typeof applicantsMatch === 'function') {
        const stated = extractNamedInsured(rec.text);
        if (stated && applicantsMatch(stated, acct) === false) {
          return false; // contaminated extraction — do NOT count it
        }
      }
      return true;
    };
    const hasGL = has('gl_quote'), hasAL = has('al_quote'), hasEL = has('el_quote');

    function add(label, mode, reason, factSource) {
      out.recommendations.push({ label, mode, reason, factSource });
      if (mode === 'suggest') out.anySuggest = true;
    }

    // ── Deterministic (auto) rules — each follows mechanically from a
    //    fact the system is certain of. ──
    if (hasQuotaShare) {
      add('Complete copy of quota share partner policies within 60 days',
          'auto',
          'The assembled tower contains a quota-share / shared layer; the partner policies are required to confirm the combined-layer terms.',
          'tower.shared_rung');
    }
    if (leadResolved) {
      add('Complete copy of the lead policy within 60 days',
          'auto',
          'A lead policy was identified in the tower; the full lead policy is required to confirm scheduled underlying and follow-form terms.',
          'tower.lead');
    }
    if (hasInterveningExcess) {
      add('Complete copy of intervening layer policies within 60 days',
          'auto',
          'The tower has excess layer(s) between the lead and the quoted layer; intervening policies are required to confirm continuity.',
          'tower.excess_rungs');
    }
    if (carriersPresent) {
      add('All scheduled underlying carriers be rated by AM Best and have a rating of A- VII or better',
          'auto',
          'Underlying carriers are scheduled in the tower; the standard financial-strength condition applies.',
          'tower.carriers');
      add('Policy Numbers and exact names of each underlying issuing company, specified by line of business',
          'auto',
          'Underlying carriers present; exact issuing-company identification is a standing requirement to finalize the schedule of underlying.',
          'tower.carriers');
    }
    if (hasGL || hasAL || hasEL) {
      add('Complete copy of the GL policy and Declarations pages of Auto & EL with underlying limits within 60 days',
          'auto',
          'Primary ' + [hasGL && 'GL', hasAL && 'Auto', hasEL && 'EL'].filter(Boolean).join(' / ') +
          ' coverage was extracted; the underlying policy/declarations are required to confirm limits.',
          'coverage.primary');
    }

    // ── Judgment (suggest) rules — surfaced with reasoning; underwriter
    //    decides. These are NOT auto-checked. ──
    add('Acceptable review of currently valued loss history for a minimum of (5) years plus current year',
        'suggest',
        'Standard excess-casualty loss-history review; recommended on essentially all risks but left to underwriter judgment for this account.',
        'standing.judgment');
    add('Acceptable review of current financial statement prior to binding',
        'suggest',
        'Financial review is judgment-based — typically required on larger or construction risks; confirm whether this account warrants it.',
        'standing.judgment');
    add('Complete description of operations for all Named Insureds is required prior to binding coverage',
        'suggest',
        'Recommended when multiple or unclear named insureds are present; review the insured roster before requiring.',
        'standing.judgment');
    if (anyUncertainRung) {
      add('Completed Supplementary Underwriting Questionnaire',
          'suggest',
          'The tower has unresolved (????) layer(s); a supplementary questionnaire can close the gaps the documents left open.',
          'tower.uncertain');
    }

    return out;
  }

  // ─── Phase 14.1 — Forms Intelligence ───
  // FIX-PHASE-14.1-FORMS-INTELLIGENCE-2026-05-14
  //
  // recommendForms(submission) does NOT change the form set (defaults
  // still load by layer type, untouched). It flags which already-present
  // forms/exclusions/endorsements THIS deal's facts make extra-relevant,
  // so the underwriter's eye goes to the ones that matter for this risk.
  // Suggest-only, same model as subjectivities: emphasis + reasoning,
  // never auto-add/remove a form. Matched to the exact FORMS_DATA names.
  //
  // Returns { emphases:[{ formName, reason, factSource }], towerBlocked }
  // ─── Phase 14.3 — Workflow Readiness ───
  // FIX-PHASE-14.3-WORKFLOW-READINESS-2026-05-14
  //
  // assessWorkflowReadiness(submission, targetStatus) reports what (if
  // anything) is not yet in place for a forward transition. It is
  // ADVISORY ONLY — it never blocks the status change (suggest-only
  // parity: warn, don't prevent the click). The underwriter can always
  // override; the system just makes the gaps visible.
  //
  // Returns { targetStatus, ready:bool, blockers:[{reason,detail}],
  //           towerBlocked }
  function assessWorkflowReadiness(submission, targetStatus) {
    const out = { targetStatus: targetStatus || null, ready: true,
                  blockers: [], towerBlocked: false };
    if (!submission) { out.ready = false;
      out.blockers.push({ reason: 'no_submission',
        detail: 'No active submission loaded.' }); return out; }

    const advancing = /^(Quoted|Bound|Issued)$/i.test(targetStatus || '');
    if (!advancing) return out; // Inquired/Cancelled/Dead/Reinstate — no gate

    let tower = null;
    if (typeof buildTowerFromExcessModule === 'function') {
      tower = buildTowerFromExcessModule(submission);
      if (tower && tower.blocked) out.towerBlocked = true;
    }
    const rungs = (tower && !tower.blocked && Array.isArray(tower.rungs)) ? tower.rungs : [];

    if (out.towerBlocked) {
      out.blockers.push({ reason: 'tower_blocked',
        detail: 'Excess tower is blocked (refusal/cross-applicant) — '
              + 'underlying program cannot be confirmed for this insured.' });
    } else if (rungs.length === 0) {
      out.blockers.push({ reason: 'no_tower',
        detail: 'No excess tower assembled — no structured underlying '
              + 'program to quote/bind against.' });
    } else {
      if (rungs.some(r => r.status === '????')) {
        out.blockers.push({ reason: 'tower_uncertain',
          detail: 'Tower has unresolved (????) layer(s) — relabel in the '
                + 'File Manager before ' + targetStatus.toLowerCase() + '.' });
      }
      if (!rungs.some(r => r.kind === 'lead' && r.status !== '????')) {
        out.blockers.push({ reason: 'no_lead',
          detail: 'No resolved lead layer — the lead anchors the tower '
                + 'and schedules the primary coverages.' });
      }
    }

    // Bind/Issue additionally want the primary coverages confirmed.
    if (/^(Bound|Issued)$/i.test(targetStatus)) {
      const ex = (submission.snapshot && submission.snapshot.extractions)
              || submission.extractions || {};
      const acct = submission.account_name || null;
      const ok = (k) => {
        const r = ex[k];
        if (!r || typeof r.text !== 'string' || !r.text.trim()) return false;
        if (/no matching .* found for this insured/i.test(r.text)) return false;
        if (acct && acct !== '(unknown)'
            && typeof extractNamedInsured === 'function'
            && typeof applicantsMatch === 'function') {
          const s = extractNamedInsured(r.text);
          if (s && applicantsMatch(s, acct) === false) return false;
        }
        return true;
      };
      if (!ok('gl_quote') && !ok('al_quote')) {
        out.blockers.push({ reason: 'no_primary',
          detail: 'No confirmed primary GL/AL for this insured — required '
                + 'to ' + targetStatus.toLowerCase() + ' an excess placement.' });
      }
    }

    out.ready = out.blockers.length === 0;
    return out;
  }

  function recommendForms(submission) {
    const out = { emphases: [], towerBlocked: false };
    if (!submission) return out;

    let tower = null;
    if (typeof buildTowerFromExcessModule === 'function') {
      tower = buildTowerFromExcessModule(submission);
      if (tower && tower.blocked) out.towerBlocked = true;
    }
    const rungs = (tower && !tower.blocked && Array.isArray(tower.rungs)) ? tower.rungs : [];
    const hasQuotaShare = rungs.some(r => r.shared === true);
    const anyUncertain  = rungs.some(r => r.status === '????');

    const ex = (submission.snapshot && submission.snapshot.extractions)
            || submission.extractions || {};
    const acct = submission.account_name || null;
    const txt = (k) => {
      const r = ex[k];
      if (!r || typeof r.text !== 'string') return '';
      if (acct && acct !== '(unknown)'
          && typeof extractNamedInsured === 'function'
          && typeof applicantsMatch === 'function') {
        const s = extractNamedInsured(r.text);
        if (s && applicantsMatch(s, acct) === false) return ''; // contaminated
      }
      return r.text.toLowerCase();
    };
    const blob = [txt('gl_quote'), txt('al_quote'), txt('excess')].join(' ');
    const opsBlob = ((submission.snapshot && submission.snapshot.descOps) || '')
      .toLowerCase() + ' ' + blob;

    const add = (formName, reason, factSource) =>
      out.emphases.push({ formName, reason, factSource });

    // Construction / contractor signals → silica, NY Labor Law context,
    // PFAS, total pollution are the high-relevance exclusions.
    if (/construct|contractor|utility|excavat|grading|underground|concrete|paving/.test(opsBlob)) {
      add('Silica or Silica Mixed Dust Exclusion',
          'Construction/contractor operations detected — silica exposure is a primary excess-casualty concern for this class.',
          'coverage.ops_construction');
      add('Total Pollution Exclusion',
          'Contracting operations — pollution exposure (fuel, runoff, materials) makes the total pollution exclusion high-relevance.',
          'coverage.ops_construction');
      add('Per- and Polyfluoroalkyl Substances (PFAS) Exclusion',
          'Construction/utility work can implicate PFAS-bearing materials; confirm the PFAS exclusion is intended.',
          'coverage.ops_construction');
    }
    // Habitational / hospitality signals → abuse, assault/battery.
    if (/habitational|apartment|hotel|hospitality|residential|dwelling|tenant/.test(opsBlob)) {
      add('Abuse Or Molestation Exclusion',
          'Habitational/hospitality exposure detected — abuse/molestation is a high-relevance exclusion for this class.',
          'coverage.ops_habitational');
      add('Assault or Battery Exclusion',
          'Habitational/hospitality exposure — assault & battery is a primary loss driver for this class.',
          'coverage.ops_habitational');
    }
    // Quota-share tower → service of suit + cross suits matter more.
    if (hasQuotaShare) {
      add('Service of Suit Clause',
          'Tower contains a quota-share/shared layer — service-of-suit coordination across participating carriers is material.',
          'tower.shared_rung');
      add('Cross Suits Exclusion',
          'Multiple carriers on a shared layer — cross-suits language warrants review for inter-carrier consistency.',
          'tower.shared_rung');
    }
    // Any uncertain tower rung → schedule of underlying is the form to scrutinize.
    if (anyUncertain) {
      add('Schedule of Underlying Insurance',
          'The tower has unresolved (????) layer(s) — the Schedule of Underlying is the form to verify once the gap is relabeled.',
          'tower.uncertain');
    }
    // TRIA always relevant on excess casualty — light standing emphasis.
    add('Cap on Losses From Certified Acts of Terrorism',
        'Standing excess-casualty TRIA consideration — confirm terrorism cap aligns with the underlying program.',
        'standing.tria');

    return out;
  }

  // ===================================================================
  // FIX-PHASE-GO-LIVE-80-LAYER-TYPE-DECISION-ENGINE-2026-05-16
  // Layer Type is the master UI gate: until #layerType is set, Limits &
  // Premiums, Forms, and rating sections render empty-state. The real
  // paid run (SUB-MP94Y8F5) proved the prior crude logic
  // (hasLead ? 'Lead Other' : 'Excess Other', only if a tower assembled)
  // left it blank → whole workbench locked. This engine implements the
  // underwriter's exact spec:
  //   • Axis 1 (Lead vs Excess) — MECHANICAL from the real tower:
  //     excess/umbrella detected BENEATH our attachment → Excess;
  //     else (we are the first layer above primary) → Lead.
  //   • Axis 2 (operational subtype) — ORDERED 7-bucket classifier over
  //     the operations/class signals the pipeline already extracts.
  //   • Distributor/dealer/wholesale ⇒ Mercantile (controlling-operation
  //     wins). Blending/formulation/repackaging signals do NOT silently
  //     promote to Manufacturing — they raise a REVIEW conflict, per the
  //     "operational activity wins; severity → flags" rule.
  //   • NEVER blank: always resolves to a concrete option so the gate
  //     opens. Uncertainty → inferred + visible review badge, never a
  //     silent commit (Q9 correctness doctrine).
  // Pure function over the submission; returns the decision + reasoning
  // + any review conflict. The workbench applies it and renders the
  // badge; the user's manual selection remains authoritative.
  // ===================================================================
  const LAYER_SUBTYPES = [
    'Hospitality', 'Manufacturing', 'Mercantile',
    'Practice Construction', 'Project', 'Real Estate - Hab', 'Other'
  ];

  // Operational-activity verbs that move a distributor to Manufacturing
  // ONLY when they are the controlling operation (per the tiebreaker:
  // operational activity wins over product severity; presence alone is
  // a review flag, not an automatic reclassification).
  const MFG_TRIGGER_RE =
    /\b(manufactur|blend|mix(?:er|ing)|formulat|repackag|re-?label|private[- ]label|material(?:ly)? alter|product spec|quality control like a manufacturer)/i;

  function _moduleText(submission, key) {
    const ex = submission && submission.snapshot && submission.snapshot.extractions;
    const m = ex && ex[key];
    return (m && typeof m.text === 'string') ? m.text : '';
  }

  // FIX-PHASE-GO-LIVE-80B-CONTAMINATION-GUARD-2026-05-16
  // The offline proof against real SUB-MP94Y8F5 data caught this engine
  // misclassifying a fertilizer CO-OP as a construction contractor,
  // because the `subcontract` module text is 100% the EXCLUDED Anahuac
  // bridge-construction questionnaire (wrong applicant — every other
  // module correctly excluded it). The classifier must apply the SAME
  // cross-applicant discipline as the rest of the system: do not treat
  // a module's text as a signal if that text is about a different
  // insured than the submission. Reuse extractNamedInsured +
  // applicantsMatch (already proven). A module whose stated insured
  // clearly mismatches is dropped from the classification corpus.
  function _moduleTextIfApplicant(submission, key) {
    const txt = _moduleText(submission, key);
    if (!txt) return '';
    try {
      const acct = (submission && (submission.account_name || submission.accountName)) || '';
      if (!acct) return txt; // nothing to compare against — keep
      const stated = (typeof extractNamedInsured === 'function')
        ? extractNamedInsured(txt) : null;
      if (!stated) return txt; // module didn't state an insured — keep
      if (typeof applicantsMatch === 'function'
          && applicantsMatch(acct, stated) === false) {
        // Explicit mismatch → contaminated/foreign content. Drop it.
        return '';
      }
    } catch (e) { /* on any error, fail safe = keep original behavior */ }
    return txt;
  }

  function _classifyOperationalSubtype(submission) {
    // FIX-PHASE-GO-LIVE-80C-STRUCTURED-CLASS-2026-05-16
    // The offline proof against real data caught a fundamental flaw:
    // keyword-scanning 24KB of underwriting ANALYSIS prose for words
    // like "contractor" produced a false "Practice Construction" — the
    // word appears in pollution-endorsement recommendations, exclusion
    // notes, and WC cross-references, none of which mean the insured is
    // a contractor. The classcode module already did the real
    // classification and stated it STRUCTURALLY: a list of primary ISO
    // class codes and a primary NAICS. Anchor on THAT structured signal,
    // not prose soup. Prose is consulted only for the blender/mixer
    // Manufacturing-trigger review flag (per the user's exact ruling).
    const clsTxt = _moduleText(submission, 'classcode');
    const ops    = _moduleText(submission, 'summary-ops');
    const reasons = [];

    // ---- Extract the STRUCTURED class signal ----
    // Primary ISO codes: "- **Code NNNNN — Description**"
    const codeMatches = [];
    const codeRe = /\*\*Code\s+(\d{4,5})\s+—\s+([^*]+?)\*\*/g;
    let cm;
    while ((cm = codeRe.exec(clsTxt)) !== null) {
      codeMatches.push({ code: cm[1], desc: cm[2].trim() });
    }
    // Primary NAICS (the module marks the lead one "(primary)")
    let naicsPrimary = '';
    const naicsLine = (clsTxt.match(/NAICS:[^\n]*/i) || [''])[0];
    const naicsPrim = naicsLine.match(/(\d{6})\s+—\s+([^;()]+?)\s*\(primary\)/i);
    if (naicsPrim) naicsPrimary = naicsPrim[2].trim();

    // The PRIMARY class is the first listed code (the module orders by
    // dominance and says so in its rationale). Fall back to NAICS, then
    // to a minimal ops scan only if there is no structured signal at all.
    const primary = codeMatches.length ? codeMatches[0] : null;
    const classCorpus = (
      (primary ? primary.desc + ' ' : '') +
      naicsPrimary + ' ' +
      codeMatches.map(c => c.desc).join(' ')
    ).toLowerCase();

    // Bucket from the STRUCTURED class description(s), most-specific
    // first. These match against class-code DESCRIPTIONS, not analysis
    // prose, so incidental words in recommendations cannot poison it.
    const has = re => re.test(classCorpus);

    // PROJECT — only a real wrap/OCIP class context.
    if (has(/\b(wrap[- ]?up|ocip|ccip|owner[- ]controlled insurance|project[- ]specific)\b/)) {
      reasons.push('primary class indicates a single project / wrap-up placement');
      return { subtype: 'Project', reasons, conflict: null };
    }
    // PRACTICE CONSTRUCTION — primary class is a CONTRACTOR class.
    if (has(/\bcontractor\b|\bconstruction\b|carpentry|electrical work|plumbing|roofing|excavation|915\d\d|916\d\d/)) {
      reasons.push('primary class code is a contractor/construction class ('
        + (primary ? primary.code + ' ' + primary.desc : naicsPrimary) + ')');
      return { subtype: 'Practice Construction', reasons, conflict: null };
    }
    // REAL ESTATE - HAB.
    if (has(/habitational|apartment|dwelling|residential rental|lessor's risk|condominium/)) {
      reasons.push('primary class is habitational/real-estate');
      return { subtype: 'Real Estate - Hab', reasons, conflict: null };
    }
    // HOSPITALITY.
    if (has(/hotel|motel|resort|restaurant|tavern|lodging|food service|catering|hospitality/)) {
      reasons.push('primary class is hospitality (guest/patron exposure)');
      return { subtype: 'Hospitality', reasons, conflict: null };
    }
    // MANUFACTURING vs MERCANTILE — the tiebreaker, on STRUCTURED class.
    const distributorClass = has(/\bdealer|distributor|distribution|wholesale|wholesaler|retail|merchant|farm supply|supply store|store\b/);
    // Manufacturing only if the PRIMARY class itself is a mfg class
    // (e.g. "... Manufacturing", "... Mfg"), not merely that the word
    // "blend" appears in the rationale prose.
    const manufacturingClass = /\bmanufactur|\bmfg\b|processing plant|formulation plant/i.test(
      (primary ? primary.desc : '') + ' ' + naicsPrimary);
    // Blender/mixer Manufacturing-trigger — searched in the rationale
    // PROSE (per the user's ruling: presence = review flag, not auto
    // reclassification unless the class itself is mfg).
    const blenderInProse = MFG_TRIGGER_RE.test(clsTxt + '\n' + ops);

    if (distributorClass && !manufacturingClass) {
      const out = {
        subtype: 'Mercantile',
        reasons: ['primary class code is dealer/distributor/wholesale ('
          + (primary ? primary.code + ' ' + primary.desc : naicsPrimary)
          + ') — controlling operation is mercantile'],
        conflict: null
      };
      if (blenderInProse) {
        const m = (clsTxt + '\n' + ops).match(MFG_TRIGGER_RE);
        out.conflict = {
          field: 'layerType', severity: 'review',
          message: 'Inferred — review required: distributor/wholesale '
            + 'operation supports Mercantile, but on-site '
            + (m ? m[0] : 'blending/mixing')
            + ' facility may indicate Manufacturing. Confirm Layer Type.'
        };
        out.reasons.push('manufacturing-trigger ("' + (m ? m[0] : 'blend')
          + '") present in rationale but primary class is distributor → Mercantile + review flag');
      }
      return out;
    }
    if (manufacturingClass) {
      reasons.push('primary class code is a manufacturing class');
      return { subtype: 'Manufacturing', reasons, conflict: null };
    }
    if (distributorClass) {
      reasons.push('mercantile (dealer/distributor/retail) primary class');
      return { subtype: 'Mercantile', reasons, conflict: null };
    }
    // OTHER — no structured class resolved.
    reasons.push('no decisive structured class signal — defaulted to Other; confirm');
    return {
      subtype: 'Other', reasons,
      conflict: {
        field: 'layerType', severity: 'review',
        message: 'Inferred — review required: operations did not clearly '
          + 'match a core class. Defaulted to Other; confirm Layer Type.'
      }
    };
  }

  function decideLayerType(submission) {
    // ---- Axis 1: Lead vs Excess, mechanical from the real tower ----
    let family = 'lead';            // safe default: we are first above primary
    let familyReason = 'no tower assembled — treated as Lead (first layer above primary)';
    let towerInfo = null;
    try {
      if (typeof buildTowerFromExcessModule === 'function') {
        const tw = buildTowerFromExcessModule(submission);
        towerInfo = tw;
        if (tw && !tw.blocked && Array.isArray(tw.rungs) && tw.rungs.length) {
          // "Excess detected beneath us" = a resolved underlying
          // excess/umbrella layer attaches at/above primary but BELOW
          // our position. The lead rung (statedAttachment 0 /
          // schedulesPrimary) is the underlying program itself; if the
          // ONLY rung(s) are that lead umbrella with nothing stacked
          // above it, WE are the next layer → Lead. If there is a
          // resolved excess rung above the lead (something already sits
          // between primary and our attachment), → Excess.
          const resolved = tw.rungs.filter(r => r.status !== '????');
          const hasExcessBeneath = resolved.some(r => r.kind === 'excess');
          if (hasExcessBeneath) {
            family = 'excess';
            familyReason = 'resolved excess/umbrella layer(s) detected beneath our attachment → Excess';
          } else {
            family = 'lead';
            familyReason = 'tower shows lead/underlying program only, nothing stacked above it → we are the lead excess layer';
          }
        }
      }
    } catch (e) {
      familyReason = 'tower read failed (' + (e && e.message) + ') — defaulted to Lead';
    }

    // ---- Axis 2: operational subtype ----
    const cls = _classifyOperationalSubtype(submission);

    // ---- Combine; never blank ----
    const familyWord = family === 'excess' ? 'Excess' : 'Lead';
    let subtype = cls.subtype;
    if (LAYER_SUBTYPES.indexOf(subtype) === -1) subtype = 'Other';
    const layerType = familyWord + ' ' + subtype;

    return {
      layerType,                    // e.g. "Lead Mercantile" — never blank
      family,                       // 'lead' | 'excess'
      subtype,                      // one of LAYER_SUBTYPES
      reasons: [familyReason].concat(cls.reasons || []),
      conflict: cls.conflict || null,   // {field,severity,message} or null
      inferred: true,               // always an inference until user confirms
      towerRungCount: towerInfo && towerInfo.rungs ? towerInfo.rungs.length : 0
    };
  }

  root.WorkbenchRules = {
    decideLayerType,
    SOURCE_AUTHORITY,
    GUIDELINE_CAPS,
    DEFAULTS,
    COMPUTE,
    DATE_FIELDS,
    LABEL_PATTERNS,
    resolveField,
    buildFieldCoverageReport,
    moduleSpecificFieldAdapter,
    lookupJsonField,
    normalizeDateString,
    parseJsonBlock,
    parseMarkdown,
    isSentinelValue,
    looksStructurallyValid,
    extractNamedInsured,
    normalizeCompanyName,
    applicantsMatch,
    applicantVerdict,
    isInsuredNotStated,
    parseExcessTower,
    assembleTower,
    assembleTowerWithRelabels,
    applyTowerRelabel,
    getTowerRelabels,
    parseTowerDocuments,
    buildTowerFromExcessModule,
    buildTowerView,
    recommendSubjectivities,
    recommendForms,
    assessWorkflowReadiness,
    TOWER_UNDERLYING_COLOR,
    _sampleTowerInputDoc,
    formatIso,
    version: 'v8.6.81-workbench-fill-reliability',
    fixTag: 'FIX-PHASE-GO-LIVE-73-2026-05-16'
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
