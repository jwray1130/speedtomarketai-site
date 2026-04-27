// ============================================================================
// app.js — Altitude / Speed to Market AI
// ============================================================================
// Extracted from app.html as Phase 8 step 7 (the final maintainability split).
// Everything that was inline JS in app.html is now here. After this split,
// app.html is pure HTML markup — no inline <script> blocks except CDN tags.
//
// Loaded via <script src="app.js"> AFTER:
//   - CDN scripts (pdfjs, mammoth, xlsx, msgreader, supabase-js)
//   - prompts.js (PROMPTS, PROMPT_INJECTION_DEFENSE — no deps)
//
// Loaded BEFORE the rest of the split files (which depend on globals this
// file creates: window.sb, window.STATE, etc.):
//   - supabase-data.js
//   - admin-views.js
//   - scraper.js
//   - pipeline.js
//
// What this file contains:
//   1. Supabase client init + auth flow + llmProxyFetch (formerly Block 1)
//   2. STATE, guideline, edit persistence, file parsing, queue, feedback
//      (formerly Block 2)
//   3. Demo mocks, audit log UI, exports, sanitizer, summary card renderer,
//      handoff workflow, manual-paste modal, decision pane, UI plumbing
//      (formerly Block 3)
//
// Why blocks 2 and 3 are concatenated: in the original app.html they were
// two adjacent <script>...</script> elements separated only by a blank
// line. Function declarations in inline scripts attach to the global
// scope, so concatenating them produces the same runtime semantics with
// less ceremony. Top-level consts are explicitly window-exported in the
// footer below.
//
// Cross-file references: STATE, sb, MOCKS, ACTIVE_GUIDELINE are referenced
// by the other split files. They are explicitly window-exported below.
// Plus 55 functions used by HTML inline onclick/onchange handlers — also
// explicitly window-exported.
// ============================================================================

// ----- (was Block 1: lines 690-800 of app.html — auth + Supabase init) -----
// ============================================================================
// SUPABASE AUTH + LLM PROXY CLIENT — runs BEFORE STATE init
// ============================================================================
const SUPABASE_URL = 'https://hscjnbolpxmiyujaxjyd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_V0Vdf2RcNqR-UgZD3U_6CQ_Rmj-u4p5';
const LLM_PROXY_URL = 'https://hscjnbolpxmiyujaxjyd.supabase.co/functions/v1/llm-proxy';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.sb = sb;
window.currentUser = null;

async function checkAuth() {
  const { data: { session } } = await sb.auth.getSession();
  const overlay = document.getElementById('authOverlay');
  if (!session) {
    if (overlay) overlay.style.display = 'flex';
    return false;
  }
  // Fetch profile row — falls back to session.user data if the row isn't there yet
  let profile = null;
  try {
    const { data } = await sb.from('users').select('id,email,display_name,role').eq('id', session.user.id).single();
    profile = data;
  } catch (e) { /* swallow — profile row may not exist yet */ }
  window.currentUser = profile || {
    id: session.user.id,
    email: session.user.email,
    display_name: session.user.email ? session.user.email.split('@')[0] : 'User',
    role: 'user'
  };
  if (overlay) overlay.style.display = 'none';
  // Update the top-bar avatar name from the signed-in profile
  const avatarNameEl = document.querySelector('.avatar-name');
  if (avatarNameEl && window.currentUser.display_name) {
    avatarNameEl.innerHTML = escapeHtml(window.currentUser.display_name) + '<br><small>Exec UW · Casualty</small>';
  }
  const avatarCircleEl = document.querySelector('.avatar-circle');
  if (avatarCircleEl && window.currentUser.display_name) {
    const initials = window.currentUser.display_name.split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase();
    avatarCircleEl.textContent = initials || 'U';
  }
  // Refresh the API pill
  if (typeof updateApiPillUI === 'function') updateApiPillUI();
  // Phase 4: pull user's submissions/settings from Supabase into STATE.
  // Fire-and-forget — the UI is already up; hydration will re-render the
  // Queue when data lands. Any failure is logged, not thrown.
  if (typeof sbHydrate === 'function') { sbHydrate(); }
  return true;
}

async function sendMagicLink() {
  const email = (document.getElementById('authEmail').value || '').trim();
  const err = document.getElementById('authError');
  const ok = document.getElementById('authSuccess');
  err.textContent = ''; ok.textContent = '';
  if (!email) { err.textContent = 'Enter your email.'; return; }
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
  if (error) { err.textContent = error.message; return; }
  ok.textContent = 'Check your email for the sign-in link.';
}

async function signOut() {
  await sb.auth.signOut();
  window.location.reload();
}
window.signOut = signOut;

// Returns the signed-in user's display_name, or 'Unknown' if nobody is signed in.
// Used everywhere we previously had the hardcoded 'J. Wray' actor string.
function currentActor() {
  return (window.currentUser && window.currentUser.display_name) ? window.currentUser.display_name : 'Unknown';
}
window.currentActor = currentActor;

// Shared helper: POST to the LLM proxy with the current session token.
// Returns the parsed Anthropic Messages response.
async function llmProxyFetch(body, extraHeaders) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Not signed in');
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + session.access_token
  };
  if (extraHeaders) {
    for (const k in extraHeaders) headers[k] = extraHeaders[k];
  }
  const res = await fetch(LLM_PROXY_URL, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('LLM proxy ' + res.status + ': ' + t.slice(0, 400));
  }
  return res.json();
}

// ============================================================================
// SUPABASE DATA-ACCESS HELPERS — moved to supabase-data.js (Phase 8 step 3).
// Loaded via <script src="supabase-data.js"> in <head>. All sb* functions
// and admin renderers (renderAdminUsersCard / renderAdminFeedbackCard /
// renderAdminAuditLog) are window-exported so inline code finds them.
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('authSendBtn');
  if (btn) btn.addEventListener('click', sendMagicLink);
  const emailIn = document.getElementById('authEmail');
  if (emailIn) emailIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendMagicLink(); } });
  checkAuth();
  // Initialize the Documents view once the DOM is parsed. The view's markup
  // is already in the page (#docs-view-root) but hidden via CSS; this call
  // wires up event handlers, builds the category grid, and prepares state.
  // Safe to call before auth — the view is invisible until showStage('docs').
  if (typeof window.initDocumentsView === 'function') {
    try { window.initDocumentsView(); }
    catch (err) { console.error('initDocumentsView failed:', err); }
  }
});

// ----- (was Block 2: lines 812-3110 of app.html — STATE, files, queue, feedback) -----
// ============================================================================
// GLOBAL STATE
// ============================================================================
// ============================================================================
// CARRIER UNDERWRITING GUIDELINE — real excerpt from Zurich E&S Excess Casualty
// Full 114-page guideline loaded as a condensed excerpt (~9.5KB) covering
// Construction, Work-from-Heights, NY operations, Attachment Points, and
// Chapter 1 prohibitions/empowerment levels. Carriers can override this by
// pasting their own full guideline in Settings → "Carrier Guideline".
// ============================================================================
const DEFAULT_GUIDELINE = `ZURICH E&S EXCESS CASUALTY UNDERWRITING GUIDELINE — RELEVANT EXCERPT
(Full guideline: 114 pages. This excerpt covers rules relevant to construction, heights, NY operations, and attachment point strategy.)

========================================================================
CHAPTER 1 — GENERAL UW PRINCIPLES
========================================================================

PROHIBITED COVERAGES, EXPOSURES, AND PROCESSES (Chapter 1):
- Accident and Health Insurance and Medical
- Artificial Intelligence - mfg, selling/distribution of software, service providers, users (except for incidental use)
- Asbestos
- Certificate of Insurance - issuing or certifying
- Contractors' Pollution Policy
- Data Breach, Cyber Security, BIPA, Privacy Liability
- Employee Practice Liability
- Fidelity
- Foreign Policies where there is no US Master policy
- Health insurance companies
- Installment Plans
- Intellectual Property
- Manufacturers and distributors of controlled substances
- Nuclear, Radiologic and Low-Level Radioactive Waste (LLRW)
- Patent Infringement
- Professional Liability (other than incidental)
- Railroad Protective Liability
- Social Media Platforms and technology vendors supporting Social Media Platform activity
- Stand-alone coverages other than GL or AL

REQUIRES ZURICH E&S HEAD OF UNDERWRITING EMPOWERMENT:
- Delivery Network Companies or DNC's (i.e., Door Dash & Grubhub)
- Environmental Liability or other stand-alone pollution coverage
- Risk Purchasing Groups (RPGs) or Risk Retention Groups (RRGs) as the named insured
- Shared and Gig Economy Risk
- Special Acceptance: any request for a treaty Special Acceptance
- Transportation Operations: operation of transportation such as railways, metros, bus companies, cable cars, trams, ski lifts and operators of highways
- Treaty Exclusion: Any intention to write a risk that would otherwise be excluded from an applicable treaty

REQUIRES LEVEL 5 EMPOWERMENT:
- Charters' Liability
- Corridor Buy Backs
- Credit Risk Collateral Programs
- Cut-Through Agreements
- Lead
- Manuscript Endorsements (not applicable to fill-in wording of existing forms)
- Marine Protection & Indemnity aka Brown Water (Commercial Hull)
- Multi-Year Rate Guarantee (Long-Term Agreements)
- Municipalities or Government Owned Entities
- Ship Repairer's
- Silica
- Trailing SIRs
- U.S. Territories: any risk domiciled (or predominant exposure) in a US Territory
- Warehouse Legal Liability

REQUIRES LEVEL 4 EMPOWERMENT:
- Admitted paper
- Anti-Stacking of Limits (removal of the endorsement)
- Auditable Policies (Premium Computation Amendatory Endorsement)
- Corridor Deductibles
- Maritime Employers Liability
- Minimum Earned Premium <25% (does not apply to admitted policies in FL or NY)
- Multiple Layer / Ventilated Policy
- Punitive Damages Coverage (remaining silent or granting coverage on a policy with a limit greater than $10m)
- Quota Share placements with unequal participation unless Zurich E&S has the lower percentage
- Temporary Staffing Firms
- USL&H and Jones Act

SECTION 1.5 — ATTACHMENT POINT STRATEGY (GL Occurrence Limit by Hazard Grade × Size):

By Total Cost of Work:
- 0-100m:   HG1-HG4 = $1M,  HG5-HG6 = $2M
- 100-250m: HG1-HG2 = $1M,  HG3-HG4 = $2M,  HG5-HG6 = $2M
- 250-500m: HG1-HG3 = $2M,  HG4-HG6 = $5M
- >500m:    HG1-HG3 = $5M,  HG4-HG6 = $10M

By Payroll:
- 0-25m:    HG1-HG4 = $1M,  HG5-HG6 = $2M
- 25-100m:  HG1-HG2 = $1M,  HG3-HG4 = $2M,  HG5-HG6 = $2M
- 100-250m: HG1-HG3 = $2M,  HG4-HG6 = $5M
- >250m:    HG1-HG3 = $5M,  HG4-HG6 = $10M

Regardless of risk size, a $5M Minimum Attachment Point is required when there is exposure in:
- Concrete Mix-In-Transit
- Waste Haulers

GENERAL POLICY LEVEL REFERRAL TRIGGERS BY EMPOWERMENT LEVEL:
- Policy Term: 18 months max for Levels 1-5
- Policy Limits: Level 1-4 up to $10M (L4 up to $12.5M if 50% QS excess of $10m ground up)
- Aggregate Caps: L1-L3 up to 2x policy limit
- Single Loss Threshold: L1-L2 up to $5M, L3 up to $7.5M, L4 up to $10M in prior 5 years
- Risk with total incurred in any single year >75% of ground up attachment point in past 5 yrs: requires L3+
- % Assisted Living/Non-Market Rate/Student Housing: L1-L2 <25%; L3 <25% lead layer or up to 50% when attaching $5m+; L4-L5 up to 100%

========================================================================
CHAPTER 6 — CONSTRUCTION UNDERWRITING GUIDELINES
========================================================================

PROHIBITED COVERAGES, EXPOSURES, AND PROCESSES (Construction):
- Asbestos handling
- Blasting or Explosives Operators
- Building Structure - raising or moving
- Business classified as homebuilders (SIC 1521) with more than 35 single family home projects in any 12-month period
- Dam or Reservoir Construction
- Dike, Levee or Revetment Construction
- Diving - marine
- Dredging (all types including gold-endless-bucket, gold-floating-dragline, drilling other than water)
- Energy related risks or any risk that conflicts with Zurich's sustainability efforts
- Freight Forwarders or Handlers packing, handling or shipping explosives or ammunition under contract
- Gas Companies
- Gunsmiths
- Hazardous Material Contractors
- Jetty or Breakwater Construction
- Marine Appraisers or Surveyors
- Mass Timber or Tract Home Construction
- Mining (does not include quarries)
- Oil and Gas Wells - Instrument
- Offshore exposures (any/all)
- Operation of water treatment facilities by a construction or engineering company
- Pipelines - operation - gas
- Pipelines - operation - oil
- Railroads - urban transit and commuter rail systems
- Ship Building
- Ship Ceiling or Scaling
- Sinking
- Stables - boarding, livery or racing
- Stevedoring - handling explosives or ammunition - under contract
- Subway Construction
- Tunneling through the use of tunnel boring machines with diameters of 5 meters or greater

REQUIRES ZURICH E&S HEAD OF UW EMPOWERMENT:
- Construction contract value / revenue greater than $1 billion USD on any account or project
- Pipeline Construction - oil
- Pipeline Construction - gas
- Pipeline Construction - slurry - nonflammable mixtures

REQUIRES LEVEL 5 EMPOWERMENT:
- Bridge Construction (>15% over navigable waters requires BU Head of UW Empowerment)

REQUIRES LEVEL 4 EMPOWERMENT:
- Professional Means & Methods coverage

SNOW AND ICE REMOVAL CONTRACTORS: minimum $5m attachment. Exceptions require Level 5 Empowerment. Less than 10% snow and ice removal operations is considered incidental.

----- NEW YORK CONTRACTING OPERATIONS -----

"$5,000,000 minimum attachment point for any contractor operating in the 5 boroughs of New York City"

"$5,000,000 maximum limit for any contractor operating in New York State"
- Maximum limit of $7,500,000 as part of a quota share attaching at $10,000,000 or higher
- Exceptions require Head of Zurich E&S empowerment

"For contractors domiciled outside New York, the underwriter must attach a mandatory Designated Operations Exclusion removing any 5 boroughs exposure, or if the account has exposure in the 5 boroughs of New York, follow the attachment point and capacity restrictions for New York Construction identified above."

Exceptions to provide completed operations coverage require Level 5 Empowerment.

----- CRANE, SCAFFOLDING, WINDOW WASHERS, GLAZIERS & MASONS (Work from Heights) -----

"Given the inherent nature of the risk, Zurich E&S looks to ensure that we manage losses from activity performed at heights. Any deviations to the rules in this guideline require Level 5 Empowerment."

Requirements:
- Minimum $5m ground up attachment point
- Maximum capacity of $5m
- No operations in New York State
- Five or more years of industry experience
- $25,000 minimum policy premium

Cranes: Crane erection, inspection, service & repair or rental, including overhead cranes with/without operator are acceptable subject to: "No tower cranes"

Scaffolding: Scaffolding Erection & Dismantling is acceptable subject to: "Ten stories or less"

Window Washers: Four stories or less in Metropolitan areas

Glaziers: Exterior work 10 stories or less

----- STRUCTURAL STEEL/IRON ERECTION -----

Bridge Contractor Underwriting Guideline — applicable classifications for Bridge Contractor classification:
- Bridge or Elevated Highway Construction - Concrete
- Bridge or Elevated Highway Construction - Iron or Steel (GL Class 91266, SIC 1622)
- Iron or Steel - Erection - Frame Structures (GL Class 91265, SIC 1622)

All bridge contractors require a minimum $5m attachment point.

----- RESIDENTIAL CONSTRUCTION STATE APPETITE GRID -----
(A = Most appetite, B = Moderate, C = Restricted)

A-states: AL, CO, CT, DE, GA, ID, IL, IN, IA, KS, KY, ME, MD, MA, MI, MN, MT, NE, NV, NH, NJ, NM, NC, ND, OH, OK, OR, PA, RI, SD, TN, UT, VT, VA, WI, WY
B-states: AR, MS, MO, WV
C-states: AZ, CA, FL, HI, LA, NY, SC, TX, WA

RESIDENTIAL EXCLUSION FORMS:
- U-UMB-433: Multi-Unit Residential Construction Exclusion
- U-UMB-616 / U-EXS-346: Designated Operations Exclusion - Residential
- U-UMB-617 / U-EXS-347: Designated Operations Exclusion - Residential Operations with Apartments
- U-UMB-618 / U-EXS-348: Designated Work Exclusion - Residential with Apartments Solely as Rental Units
- U-UMB-619 / U-SXS-110 / U-EXS-349: Designated Operations Exclusion - Residential with Senior Living Facilities

========================================================================
END OF RELEVANT EXCERPT
========================================================================
`;

// Guideline used at runtime. Phase 4: persisted per-user in Supabase
// user_settings.carrier_guideline so it follows the UW across devices.
let ACTIVE_GUIDELINE = DEFAULT_GUIDELINE;

function loadGuidelineFromStorage() {
  // No-op. sbHydrate() loads user_settings.carrier_guideline into
  // ACTIVE_GUIDELINE after sign-in. Kept as a stub so init-time callers don't
  // break.
}

function saveGuidelineOverride(text) {
  const clearing = !text || text.length < 100;
  if (clearing) {
    ACTIVE_GUIDELINE = DEFAULT_GUIDELINE;
  } else {
    ACTIVE_GUIDELINE = text;
  }
  // Persist to Supabase (fire-and-forget). `null` clears the override.
  if (typeof sbSaveSettings === 'function') {
    sbSaveSettings({ carrier_guideline: clearing ? null : text }).catch(e => {
      console.warn('Guideline save failed', e);
      toast('Guideline save failed · ' + (e.message || 'network'), 'error');
    });
  }
  logAudit('Admin', 'Carrier guideline updated · ' + (text ? text.length.toLocaleString() + ' chars' : 'reset to default'), 'user');
  toast('Guideline ' + (text ? 'updated' : 'reset to Zurich default'));
}

function getActiveGuideline() {
  return ACTIVE_GUIDELINE || DEFAULT_GUIDELINE;
}

const STATE = {
  api: { model: 'claude-sonnet-4-6', maxTokens: 4096 },
  files: [],
  extractions: {},
  audit: [],
  // Phase 6 step 7: admin-mode audit log (cloud-backed via sbLoadAuditEvents).
  // Non-admins use STATE.audit (session-only). This bag holds the currently-
  // loaded page plus filter/pagination state. Reset on every tab open.
  adminAudit: {
    rows: [],           // currently-loaded cloud rows, newest first
    category: 'all',    // active category filter
    categories: null,   // cached distinct-category list (null until first fetch)
    hasMore: true       // whether last fetch returned a full page
  },
  pipelineRun: null,
  pipelineStart: 0,
  pipelineRunning: false,
  pipelineDone: false,
  // Summary editing state — Supabase-backed. Per-module rows in
  // `submission_edits` plus a snapshot copy on `submissions.snapshot`.
  edits: {},         // moduleId -> { htmlOverride, originalText, editedAt }
  customCards: [],   // [{ id, title, html, createdAt, editedAt }]
  hiddenCards: {},   // moduleId or customId -> true  (soft-deleted cards)
  // Assistant Review Workflow — tracks UW ↔ Assistant handoff for the current submission
  handoff: {
    status: null,            // null | 'awaiting_assistant' | 'in_review' | 'returned_to_uw'
    assignee: null,          // 'Tracy Savage' etc.
    uwNote: null,            // note from UW when sending to assistant
    assistantNote: null,     // note from assistant when returning
    sentAt: null,            // timestamp when UW sent to assistant
    openedAt: null,          // timestamp when assistant opened (status → in_review)
    returnedAt: null,        // timestamp when assistant returned to UW
    viewAs: 'uw',            // current view perspective: 'uw' | 'assistant'
    history: []              // chronological list of transitions
  },
  // Queue-level submission tracking — once a pipeline completes, the submission
  // snapshots into this array and shows on the Queue view. UW drives status from
  // AWAITING UW REVIEW → INQUIRED / QUOTED / DECLINED / BOUND. Status never reverts
  // automatically; only UW can change it. Persisted to Supabase `submissions`
  // table (one row per submission). Snapshot is "lite": file.text bytes are
  // dropped to stay under DB row size limits; extractions are kept so the
  // Summary view survives reload, but re-running requires the source files again.
  submissions: [],            // array of archived submission records
  activeSubmissionId: null,   // which submission is currently loaded in the workbench
  // Tier 1 feedback collection — card-level reactions written to Supabase
  // `feedback_events` table via submitFeedbackEvent(). Stamped with reviewer
  // name. STATE.feedback is no longer the source of truth (Phase 4); admin
  // views read directly from Supabase. STATE.feedback is left empty by design.
  feedback: [],               // array of FeedbackEvent records
  feedbackExportedAt: null    // timestamp of last export, drives "new since last export" counter
};

// ============================================================================
// EDIT PERSISTENCE — Supabase-backed autosave for summary edits
// (Phase 4: migrated from localStorage. Per-module rows in `submission_edits`,
// plus a snapshot copy on `submissions.snapshot` for fast rehydration.)
// ============================================================================
let SAVE_DEBOUNCE = null;
let LAST_SAVE_TS = 0;

// Load edits scoped to the most recent pipeline run.
//
// Phase 4: localStorage is no longer the source of truth. Edits for each
// submission live in the Supabase `submission_edits` table, and the
// per-submission snapshot (submissions.snapshot) also carries the last
// archived copy for fast rehydration. This function is kept as a no-op stub
// so callers that used to trigger a localStorage read don't break.
function loadEdits() {
  // No-op. Edits are loaded from Supabase when a submission is opened
  // (see rehydrateSubmission → sbLoadEdits).
}

// Called from rehydrateSubmission when the user opens a submission whose pipeline
// run matches the stashed edits. Merges in the pending edits only if IDs match.
function applyPendingEditsIfMatch(pipelineRunId) {
  if (!STATE._pendingEdits) return false;
  if (STATE._pendingEdits.pipelineRun !== pipelineRunId) return false;
  if (STATE._pendingEdits.edits)       STATE.edits       = STATE._pendingEdits.edits;
  if (STATE._pendingEdits.customCards) STATE.customCards = STATE._pendingEdits.customCards;
  if (STATE._pendingEdits.hiddenCards) STATE.hiddenCards = STATE._pendingEdits.hiddenCards;
  STATE._pendingEdits = null;  // consumed
  return true;
}

function saveEditsNow() {
  // In-memory edits are persisted two ways for resilience:
  //   1) Baked into the active submission's snapshot (see archiveCurrentSubmission
  //      / rehydrateSubmission) so a reload restores cleanly.
  //   2) Per-module rows in Supabase `submission_edits` so admin views and
  //      multi-device access work. This is fire-and-forget — we update the
  //      save indicator optimistically and only toast on real failure.
  LAST_SAVE_TS = Date.now();
  const ind = document.getElementById('saveIndicator');
  const txt = document.getElementById('saveIndicatorText');
  if (ind && txt) {
    ind.classList.remove('saving');
    ind.classList.add('saved');
    txt.textContent = 'Saved just now';
    setTimeout(updateSaveIndicator, 1200);
  }
  const submissionId = STATE.activeSubmissionId;
  if (!submissionId) return;   // nothing to persist yet (no archived submission)
  sbSaveAllEditsForSubmission(
    submissionId,
    STATE.pipelineRun || null,
    STATE.edits, STATE.customCards, STATE.hiddenCards
  ).catch(e => {
    console.warn('Edit save failed', e);
    toast('Save failed · ' + (e.message || 'network'), 'error');
  });
}

// Debounced save — called on every edit
function markDirty() {
  const ind = document.getElementById('saveIndicator');
  const txt = document.getElementById('saveIndicatorText');
  if (ind && txt) {
    ind.classList.remove('saved');
    ind.classList.add('saving');
    txt.textContent = 'Saving…';
  }
  clearTimeout(SAVE_DEBOUNCE);
  SAVE_DEBOUNCE = setTimeout(saveEditsNow, 450);
}

// Phase 8.5 Round 4 fix #2: resync the active submission's snapshot to current
// STATE for edits/customCards/hiddenCards. Called by every function that mutates
// edit state (clearAllEdits, revertCard, restoreAllCards, deleteCard, addCustomCard,
// edit-commits in addEditListeners). Without this, the snapshot drifts from STATE
// after a clear/revert/restore: cloud rows get deleted, STATE clears, but the
// submission's snapshot.edits/customCards/hiddenCards still hold stale data. Then
// on next rehydrate, snapshot loads first (with stale data), cloud overlay
// (now empty) doesn't fight it, and stale data wins. Bug observed during Round 3
// testing — RACE_TEST_MARKER_PHASE_8_5_R2 reappeared after clearAllEdits + reload.
// This helper re-syncs the snapshot blob and triggers a single sbSaveSubmission
// upsert with the freshly-aligned snapshot.
function resyncActiveSnapshot(reason) {
  const sid = STATE.activeSubmissionId;
  if (!sid) return;
  const rec = STATE.submissions.find(s => s.id === sid);
  if (!rec || !rec.snapshot) return;
  // Update the three edit-state slots in-place. Other snapshot fields
  // (files, extractions, handoff, audit, derived) are unchanged by edit
  // mutations, so we leave them alone.
  rec.snapshot.edits        = deepClone(STATE.edits);
  rec.snapshot.customCards  = deepClone(STATE.customCards);
  rec.snapshot.hiddenCards  = deepClone(STATE.hiddenCards);
  rec.lastModifiedAt = Date.now();
  // Fire-and-forget cloud save with verbose audit, mirroring the pattern in
  // changeSubmissionStatus and archiveCurrentSubmission.
  (async () => {
    try {
      if (typeof sbSaveSubmission !== 'function') return;
      const liteSnapshot = {
        ...rec.snapshot,
        files: (rec.snapshot.files || []).map(f => ({ ...f, text: '', textDropped: true, _rawFile: undefined })),
        derived: {
          account:         rec.account || null,
          broker:          rec.broker || null,
          effectiveDate:   rec.effective || rec.effectiveDate || null,
          requestedLimits: rec.requested || rec.requestedLimits || null,
          missingInfo:     rec.missingInfo || null
        }
      };
      await sbSaveSubmission(buildSubmissionPayload(rec, liteSnapshot));
      if (typeof logAudit === 'function') logAudit('Submissions', 'Snapshot resynced (' + reason + ') · ' + sid, 'ok');
    } catch (err) {
      console.warn('resyncActiveSnapshot save failed', sid, err);
      if (typeof logAudit === 'function') logAudit('Submissions', 'Snapshot resync FAILED (' + reason + ') · ' + sid + ' · ' + (err.message || err), 'error');
    }
  })();
}

function updateSaveIndicator() {
  const ind = document.getElementById('saveIndicator');
  const txt = document.getElementById('saveIndicatorText');
  if (!ind || !txt) return;
  if (LAST_SAVE_TS === 0) {
    txt.textContent = 'Ready';
    return;
  }
  const diff = Math.round((Date.now() - LAST_SAVE_TS) / 1000);
  if (diff < 5) txt.textContent = 'Saved just now';
  else if (diff < 60) txt.textContent = `Saved ${diff}s ago`;
  else if (diff < 3600) txt.textContent = `Saved ${Math.round(diff / 60)}m ago`;
  else txt.textContent = 'Saved';
}
setInterval(updateSaveIndicator, 10000);

// Reset edits, custom cards, and hidden cards back to original AI output.
// Clears in-memory STATE AND deletes the matching cloud submission_edits rows
// for the active submission (so Reset is durable and survives a refresh).
// Other submissions' edits are not touched.
function clearAllEdits() {
  if (Object.keys(STATE.edits).length === 0 &&
      STATE.customCards.length === 0 &&
      Object.keys(STATE.hiddenCards).length === 0) {
    toast('Nothing to reset', 'warn');
    return;
  }
  if (!confirm('Reset ALL edits, custom cards, and hidden cards back to original AI output? This cannot be undone.')) return;
  STATE.edits = {};
  STATE.customCards = [];
  STATE.hiddenCards = {};
  saveEditsNow();
  // Phase 8.5 fix: also delete remote submission_edits rows for this
  // submission. saveEditsNow's upsert path has nothing to write when local
  // state is empty, so without this delete the orphan rows would resurrect
  // on next rehydrate (which now overlays cloud edits on snapshot).
  const sid = STATE.activeSubmissionId;
  if (sid && typeof sbDeleteAllEditsForSubmission === 'function') {
    (async () => {
      try {
        await sbDeleteAllEditsForSubmission(sid);
        if (typeof logAudit === 'function') logAudit('Edits', 'Cloud edits deleted for ' + sid, 'ok');
      } catch (err) {
        console.warn('sbDeleteAllEditsForSubmission failed', err);
        if (typeof logAudit === 'function') logAudit('Edits', 'Cloud delete FAILED for ' + sid + ' · ' + (err.message || err), 'error');
        if (typeof toast === 'function') toast('Reset locally, cloud cleanup failed · ' + (err.message || err).slice(0, 60), 'error');
      }
    })();
  }
  renderSummaryCards();
  // Phase 8.5 Round 4 fix #2: resync snapshot so reload doesn't resurrect old data
  resyncActiveSnapshot('clearAllEdits');
  logAudit('Edits', 'Reset all edits, custom cards, and hidden cards', '—');
  toast('All edits reset');
}

// ============================================================================
// API SETTINGS — model + max tokens only. Key held server-side in Edge Function.
// ============================================================================

function openSettings() {
  const m = document.getElementById('settingsModal');
  if (!m) { console.warn('openSettings: settingsModal not in DOM'); toast('Settings modal not found', 'error'); return; }
  // Populate fields defensively — any missing element shouldn't block the
  // modal from opening. This was a real bug: a null guidelineStatus element
  // would throw and prevent the modal from ever showing.
  try {
    const maxTok = document.getElementById('apiMaxTokens');
    if (maxTok && STATE.api) maxTok.value = STATE.api.maxTokens;
    const sel = document.getElementById('apiModel');
    if (sel && STATE.api) {
      Array.from(sel.options).forEach(o => { o.selected = (o.value === STATE.api.model); });
    }
    // Round 5 fix #1: pre-populate forceGlobal checkbox from STATE.
    const fg = document.getElementById('forceGlobalModel');
    if (fg && STATE.api) fg.checked = !!STATE.api.forceGlobal;
    // Guideline field — show whatever's active, but only populate textarea if override exists.
    // Phase 4: the override lives in ACTIVE_GUIDELINE (hydrated from user_settings
    // on sign-in). If it doesn't equal DEFAULT_GUIDELINE, treat it as a user override.
    const ta = document.getElementById('carrierGuideline');
    const status = document.getElementById('guidelineStatus');
    if (ta) {
      const hasOverride = ACTIVE_GUIDELINE && ACTIVE_GUIDELINE !== DEFAULT_GUIDELINE;
      if (hasOverride) {
        ta.value = ACTIVE_GUIDELINE;
        if (status) {
          status.textContent = 'CUSTOM · ' + ACTIVE_GUIDELINE.length.toLocaleString() + ' CHARS';
          status.style.color = 'var(--signal-ink)';
        }
      } else {
        ta.value = '';
        if (status) {
          status.textContent = 'DEFAULT · ' + (DEFAULT_GUIDELINE ? DEFAULT_GUIDELINE.length.toLocaleString() : '?') + ' CHARS';
          status.style.color = 'var(--text-3)';
        }
      }
    }
  } catch (err) {
    console.warn('openSettings field population failed', err);
    // Non-fatal — we still open the modal below so the UW can at least see it.
  }
  m.classList.add('open');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('open');
}

function saveSettings() {
  const model = document.getElementById('apiModel').value;
  const maxTokens = parseInt(document.getElementById('apiMaxTokens').value) || 4096;
  // Round 5 fix #1: read forceGlobal checkbox state. When true, callLLM in
  // pipeline.js routes every LLM call through this model regardless of the
  // per-module preference. Defaults to false (existing per-module routing).
  const forceGlobal = !!document.getElementById('forceGlobalModel')?.checked;
  STATE.api = { model, maxTokens, forceGlobal };

  // Phase 8.5 fix: persist model + max_tokens to user_settings. Previously
  // these only updated STATE.api in-memory — sbHydrate read them on page
  // load but saveSettings never wrote them, so changes vanished on refresh.
  // Round 5 adds force_global_model to the persisted set.
  if (typeof sbSaveSettings === 'function') {
    sbSaveSettings({ default_model: model, max_tokens: maxTokens, force_global_model: forceGlobal }).catch(e => {
      console.warn('Model/token settings save failed', e);
      if (typeof toast === 'function') toast('Model/tokens saved locally, cloud save failed · ' + (e.message || 'network').slice(0, 60), 'warn');
    });
  }

  // Save guideline override if present
  const ta = document.getElementById('carrierGuideline');
  if (ta) {
    const val = ta.value.trim();
    if (val.length === 0) {
      saveGuidelineOverride('');
    } else if (val.length < 100) {
      toast('Guideline too short (min 100 chars) · kept existing', 'warn');
    } else if (val !== ACTIVE_GUIDELINE) {
      saveGuidelineOverride(val);
    }
  }

  updateApiPillUI();
  closeSettings();
  toast('Settings saved');
}

function resetGuidelineToDefault() {
  if (!confirm('Reset the carrier guideline back to the default Zurich E&S excerpt? Any custom guideline you pasted will be cleared.')) return;
  document.getElementById('carrierGuideline').value = '';
  document.getElementById('guidelineStatus').textContent = 'DEFAULT · ' + DEFAULT_GUIDELINE.length.toLocaleString() + ' CHARS';
  document.getElementById('guidelineStatus').style.color = 'var(--text-3)';
  saveGuidelineOverride('');
}

function showDefaultGuideline() {
  const ta = document.getElementById('carrierGuideline');
  if (!ta) return;
  if (ta.value.length > 0 && !confirm('Replace the current textarea content with the default Zurich E&S guideline excerpt? Any unsaved changes will be lost.')) return;
  ta.value = DEFAULT_GUIDELINE;
  document.getElementById('guidelineStatus').textContent = 'VIEWING DEFAULT (unsaved)';
  document.getElementById('guidelineStatus').style.color = 'var(--warning)';
}

// ============================================================================
// GUIDELINE DROP ZONE — Round 5 fix #3
// ============================================================================
// Accept a PDF, DOCX, DOC, TXT, or MD file dragged or selected. Parse the text
// client-side using the same extractText() helper as broker file uploads.
// Populate the textarea with the parsed result and show a status badge.
// User still has to click Save to commit the new guideline to user_settings.
// ============================================================================

const GUIDELINE_MAX_FILE_SIZE = 10 * 1024 * 1024;       // 10MB — generous for big PDFs
const GUIDELINE_MIN_TEXT_LENGTH = 100;                  // matches saveSettings threshold

function handleGuidelineDrop(event) {
  const dt = event.dataTransfer;
  if (!dt || !dt.files || dt.files.length === 0) {
    toast('No file dropped', 'warn');
    return;
  }
  if (dt.files.length > 1) {
    toast('Drop only one guideline file at a time', 'warn');
    return;
  }
  loadGuidelineFromFile(dt.files[0]);
}

function handleGuidelineFileInput(event) {
  const f = event.target.files && event.target.files[0];
  if (!f) return;
  loadGuidelineFromFile(f);
  // Clear the input so re-selecting the same file fires onchange again
  event.target.value = '';
}

async function loadGuidelineFromFile(file) {
  const ta = document.getElementById('carrierGuideline');
  const status = document.getElementById('guidelineStatus');
  if (!ta) return;

  // Validate extension
  const name = (file.name || '').toLowerCase();
  const allowed = ['.pdf', '.docx', '.doc', '.txt', '.md'];
  const ok = allowed.some(ext => name.endsWith(ext));
  if (!ok) {
    toast('Unsupported file type · use PDF, DOCX, DOC, TXT, or MD', 'error');
    return;
  }

  // Validate size
  if (file.size > GUIDELINE_MAX_FILE_SIZE) {
    toast('File too large · max 10MB', 'error');
    return;
  }

  // Show progress
  if (status) {
    status.textContent = 'PARSING ' + file.name.toUpperCase() + '...';
    status.style.color = 'var(--text-2)';
  }

  try {
    // Reuse the broker-upload extractText() helper. It handles PDF / DOCX / DOC
    // / plain text and returns the extracted text plus optional metadata.
    const meta = {};
    const text = await extractText(file, meta);
    const cleanText = (text || '').trim();

    // Sanity check: scanned PDFs come back near-empty
    if (cleanText.length < GUIDELINE_MIN_TEXT_LENGTH) {
      if (status) {
        status.textContent = 'PARSED ' + cleanText.length + ' CHARS · TOO SHORT';
        status.style.color = 'var(--error)';
      }
      toast('Parsed only ' + cleanText.length + ' chars — file may be a scanned PDF or empty. Use the textarea to paste manually.', 'error');
      return;
    }

    // Drop it in the textarea so user can review/edit before save
    ta.value = cleanText;
    if (status) {
      status.textContent = 'LOADED ' + file.name.toUpperCase() + ' · ' + cleanText.length.toLocaleString() + ' CHARS · CLICK SAVE';
      status.style.color = 'var(--signal)';
    }
    toast('Guideline parsed (' + cleanText.length.toLocaleString() + ' chars) · click Save to apply');
    if (typeof logAudit === 'function') {
      logAudit('Settings', 'Guideline file dropped: ' + file.name + ' · ' + cleanText.length + ' chars', 'ok');
    }
  } catch (err) {
    console.error('Guideline file parse failed', err);
    if (status) {
      status.textContent = 'PARSE FAILED';
      status.style.color = 'var(--error)';
    }
    toast('Parse failed · ' + (err.message || 'unknown') + ' · use textarea to paste manually', 'error');
  }
}

// Updates the API pill in the top bar to reflect signed-in state.
// Signed in → "SIGNED IN · <name>" with a click-to-sign-out behavior
// Not signed in → "NOT SIGNED IN"
function updateApiPillUI() {
  const pill = document.getElementById('apiPill');
  const text = document.getElementById('apiPillText');
  const shPill = document.getElementById('shModePill');
  if (!pill || !text) return;
  if (window.currentUser) {
    pill.classList.remove('demo');
    pill.classList.add('live');
    text.textContent = 'SIGNED IN · ' + (window.currentUser.display_name || 'user').toUpperCase();
    pill.title = 'Click to open Settings · Right-click to sign out';
    pill.onclick = function(e) {
      e.stopPropagation();
      if (typeof openSettings === 'function') openSettings();
    };
    pill.oncontextmenu = function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (confirm('Sign out?')) signOut();
      return false;
    };
    if (shPill) { shPill.textContent = 'LIVE · ' + (STATE.api.model || '').toUpperCase(); shPill.className = 'sub-pill signal'; }
  } else {
    pill.classList.remove('live');
    pill.classList.add('demo');
    text.textContent = 'NOT SIGNED IN';
    pill.title = 'Sign in required';
    pill.onclick = null;
    pill.oncontextmenu = null;
    if (shPill) { shPill.textContent = 'SIGN IN REQUIRED'; shPill.className = 'sub-pill amber'; }
  }
  if (typeof updateDecisionPaneIdle === 'function') updateDecisionPaneIdle();
}

// Load on init
loadGuidelineFromStorage();
loadEdits();

// ============================================================================
// FILE PARSING — handle every document format
// ============================================================================
async function extractText(file, metadata) {
  const name = file.name.toLowerCase();
  // metadata is an optional out-param object — callers can pass {} to receive
  // extraction stats (pageCount for PDFs, sheetCount for XLSX, etc.) that feed
  // the audit log without changing the primary return value shape.
  const meta = metadata || {};

  if (name.endsWith('.pdf')) {
    if (typeof pdfjsLib === 'undefined') throw new Error('PDF parser not loaded');
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = '';
    let totalItems = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      totalItems += content.items.length;
      text += content.items.map(it => it.str).join(' ') + '\n\n';
    }
    meta.kind = 'pdf';
    meta.pageCount = pdf.numPages;
    // Scanned-PDF detection: empty or tiny text layer relative to page count.
    // A real 5-page text PDF will have thousands of chars; a scanned image PDF has 0-50 chars of metadata.
    const cleanedLength = text.replace(/\s+/g, '').length;
    const avgCharsPerPage = cleanedLength / pdf.numPages;
    if (cleanedLength < 100 || avgCharsPerPage < 50) {
      throw new Error('__SCANNED_PDF__::' + pdf.numPages + ' page(s), ' + cleanedLength + ' text chars extracted — appears to be a scanned image PDF with no text layer. Use OCR, or paste the content manually.');
    }
    return text;
  }

  if (name.endsWith('.docx')) {
    if (typeof mammoth === 'undefined') throw new Error('DOCX parser not loaded');
    const buf = await file.arrayBuffer();
    const r = await mammoth.extractRawText({ arrayBuffer: buf });
    meta.kind = 'docx';
    return r.value;
  }

  if (name.endsWith('.doc')) {
    // Legacy .doc — approximate plain-text scrape
    const buf = await file.arrayBuffer();
    const raw = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    const cleaned = raw.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned.length < 200) throw new Error('Legacy .doc extraction failed — save as .docx and re-upload');
    meta.kind = 'doc';
    meta.approximate = true;
    return cleaned + '\n\n[Note: Legacy .doc extraction is approximate. For best results, save as .docx.]';
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.xlsm') || name.endsWith('.xlsb')) {
    if (typeof XLSX === 'undefined') throw new Error('XLSX parser not loaded');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true, cellText: true });
    let text = '';
    wb.SheetNames.forEach(s => {
      text += '=== Sheet: ' + s + ' ===\n';
      text += XLSX.utils.sheet_to_csv(wb.Sheets[s], { blankrows: false }) + '\n\n';
    });
    meta.kind = 'xlsx';
    meta.sheetCount = wb.SheetNames.length;
    meta.sheetNames = wb.SheetNames.slice();
    return text;
  }

  // PowerPoint — no reliable in-browser text extractor is available. Fail loudly so the
  // user gets an obvious "paste text manually" affordance instead of silent garbage.
  if (name.endsWith('.pptx') || name.endsWith('.ppt')) {
    throw new Error('__UNREADABLE__::PowerPoint content cannot be auto-extracted in-browser. Paste the relevant slide text manually, or export the deck to PDF first.');
  }

  // Raster images — same story. OCR would need a heavy library (Tesseract.js ~10MB).
  // For now, surface a clear manual-entry affordance.
  if (/\.(png|jpg|jpeg|webp|heic|heif|gif|bmp|tiff|tif)$/.test(name)) {
    throw new Error('__UNREADABLE__::Image files require OCR, which isn\'t enabled in this build. Paste the visible text manually.');
  }

  if (name.endsWith('.csv') || name.endsWith('.tsv')) {
    meta.kind = name.endsWith('.tsv') ? 'tsv' : 'csv';
    const txt = await file.text();
    meta.rowCount = txt.split('\n').filter(l => l.trim()).length;
    return txt;
  }

  if (name.endsWith('.msg')) {
    if (window.__msgReaderFailed || typeof MsgReader === 'undefined') {
      throw new Error('.msg parser not available — forward as .eml or paste content as .txt');
    }
    const buf = await file.arrayBuffer();
    const reader = new MsgReader(buf);
    const data = reader.getFileData();
    let text = '';
    if (data.senderName || data.senderEmail) text += 'From: ' + (data.senderName || '') + ' <' + (data.senderEmail || '') + '>\n';
    if (data.recipients && data.recipients.length) text += 'To: ' + data.recipients.map(r => (r.name || '') + ' <' + (r.email || '') + '>').join(', ') + '\n';
    if (data.subject) text += 'Subject: ' + data.subject + '\n';
    if (data.messageDeliveryTime) text += 'Date: ' + data.messageDeliveryTime + '\n';
    const body = data.body || data.bodyHTML || '[No body]';
    text += '\n' + body;
    if (data.attachments && data.attachments.length) {
      text += '\n\nAttachments: ' + data.attachments.map(a => a.fileName || a.name || 'attachment').join(', ');
    }
    meta.kind = 'msg';
    meta.subject = data.subject || '';
    meta.attachmentCount = (data.attachments || []).length;
    meta.body = body;  // bare body without headers — used for attachment-context lookup
    // Preserve attachment bytes for downstream unpacking. We store the raw
    // Uint8Array content + filename; handleFiles() picks these up after the
    // parent .msg parse completes and injects them as pseudo-files.
    if (data.attachments && data.attachments.length) {
      meta.attachments = data.attachments.map(a => ({
        name: a.fileName || a.name || 'attachment',
        content: a.content || null,   // Uint8Array of the attachment bytes
        contentLength: (a.content && a.content.length) ? a.content.length : 0,
        mimeType: a.mimeType || a.contentType || null
      })).filter(a => a.content && a.contentLength > 0);
    }
    return text;
  }

  if (name.endsWith('.eml')) {
    meta.kind = 'eml';
    return parseEml(await file.text());
  }

  if (name.endsWith('.html') || name.endsWith('.htm')) {
    meta.kind = 'html';
    const tmp = document.createElement('div');
    tmp.innerHTML = await file.text();
    tmp.querySelectorAll('script, style, noscript, iframe').forEach(el => el.remove());
    return (tmp.innerText || tmp.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  if (name.endsWith('.rtf')) {
    meta.kind = 'rtf';
    const raw = await file.text();
    return raw
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\[a-z]+\d*\s?/gi, '')
      .replace(/[{}]/g, '')
      .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Fallback: read as plain text, but detect binary garbage (high proportion of non-printable
  // bytes means the file is probably an unsupported binary format — don't feed noise to the LLM).
  const fallbackText = await file.text();
  if (fallbackText.length === 0) {
    throw new Error('__UNREADABLE__::File is empty');
  }
  const nonPrintable = (fallbackText.match(/[\x00-\x08\x0E-\x1F\x7F]/g) || []).length;
  if (nonPrintable / fallbackText.length > 0.1) {
    throw new Error('__UNREADABLE__::File appears to be a binary format we don\'t parse (.' + name.split('.').pop() + '). Convert to PDF/DOCX/TXT or paste content manually.');
  }
  meta.kind = 'text';
  return fallbackText;
}

// ============================================================================
// buildAttachmentContext — for each attachment name in a .msg, find the
// sentence in the email body that references it. This gives the classifier
// extra signal on poorly-named files. Example: broker says "See attached
// Meridian safety manual (Jan 2026 rev)" next to a PDF named `doc2.pdf` —
// we surface that sentence so the classifier knows to route to `safety`.
// Returns a map of { attachmentName: contextString }. Context is empty if
// no reference is found (many brokers attach without mentioning by name).
// ============================================================================
function buildAttachmentContext(meta) {
  const out = {};
  const body = meta.body || '';
  const attachments = meta.attachments || [];
  if (!body || attachments.length === 0) return out;
  // Split body into sentences/clauses. Loose split — emails are rarely well-punctuated.
  const sentences = body.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 5);
  for (const att of attachments) {
    const nameLower = (att.name || '').toLowerCase();
    if (!nameLower) { out[att.name] = ''; continue; }
    // Strip extension for matching — brokers rarely type "the safety_manual.pdf", they type "the safety manual"
    const stem = nameLower.replace(/\.[a-z0-9]+$/, '').replace(/[_-]+/g, ' ').trim();
    const stemTokens = stem.split(/\s+/).filter(t => t.length > 2);
    // Strategy 1: exact filename (with or without extension) mentioned in a sentence
    let match = sentences.find(s => s.toLowerCase().includes(nameLower)) ||
                sentences.find(s => stem && s.toLowerCase().includes(stem));
    // Strategy 2: keyword-style match — all multi-char tokens from the stem appear in the same sentence
    if (!match && stemTokens.length > 0) {
      match = sentences.find(s => {
        const sLower = s.toLowerCase();
        return stemTokens.every(t => sLower.includes(t));
      });
    }
    // Strategy 3: look for "attached" + any stem token in the same sentence
    if (!match && stemTokens.length > 0) {
      match = sentences.find(s => {
        const sLower = s.toLowerCase();
        return /attach/.test(sLower) && stemTokens.some(t => sLower.includes(t));
      });
    }
    out[att.name] = match ? match.slice(0, 300) : '';
  }
  return out;
}

function parseEml(raw) {
  let he = raw.search(/\r?\n\r?\n/);
  if (he === -1) return raw;
  const headers = raw.substring(0, he);
  const body = raw.substring(he).replace(/^\r?\n\r?\n/, '');
  const unfolded = headers.replace(/\r?\n[ \t]+/g, ' ');
  const hdr = name => {
    const m = unfolded.match(new RegExp('^' + name + ':\\s*(.*)$', 'im'));
    return m ? m[1].trim() : '';
  };
  let out = '';
  if (hdr('From')) out += 'From: ' + hdr('From') + '\n';
  if (hdr('To')) out += 'To: ' + hdr('To') + '\n';
  if (hdr('Cc')) out += 'Cc: ' + hdr('Cc') + '\n';
  if (hdr('Subject')) out += 'Subject: ' + hdr('Subject') + '\n';
  if (hdr('Date')) out += 'Date: ' + hdr('Date') + '\n';
  out += '\n';
  const ct = hdr('Content-Type').toLowerCase();
  if (ct.includes('multipart')) {
    const bm = ct.match(/boundary="?([^";\s]+)"?/i);
    if (bm) {
      const boundary = '--' + bm[1];
      const parts = body.split(boundary).filter(p => p.trim());
      for (const part of parts) {
        if (/content-type:\s*text\/plain/i.test(part)) {
          const bs = part.search(/\r?\n\r?\n/);
          if (bs > -1) { out += part.substring(bs).replace(/^\r?\n\r?\n/, '').trim(); return out; }
        }
      }
      for (const part of parts) {
        if (/content-type:\s*text\/html/i.test(part)) {
          const bs = part.search(/\r?\n\r?\n/);
          if (bs > -1) {
            const tmp = document.createElement('div');
            tmp.innerHTML = part.substring(bs).replace(/^\r?\n\r?\n/, '').trim();
            tmp.querySelectorAll('script, style').forEach(el => el.remove());
            out += (tmp.innerText || tmp.textContent || '').trim();
            return out;
          }
        }
      }
    }
  }
  out += body;
  return out;
}

function fileIconFor(name) {
  const ext = name.split('.').pop().toUpperCase();
  if (['XLSX', 'XLS', 'XLSM', 'XLSB', 'CSV', 'TSV'].includes(ext)) return 'XLS';
  if (['DOCX', 'DOC'].includes(ext)) return 'DOC';
  if (['HTML', 'HTM'].includes(ext)) return 'HTM';
  if (['TXT', 'MD'].includes(ext)) return 'TXT';
  if (ext === 'URL' || ext === 'WEB') return 'WEB';
  return ext.slice(0, 3);
}

// ============================================================================
// WEBSITE SCRAPE — moved to scraper.js (Phase 8 step 5).
// Loaded via <script src="scraper.js"> in <head>. All scraper functions
// (setWebTab, scrapeWebsiteFromUrl, findAndScrapeWebsite, etc.) are exposed
// on window so HTML inline handlers can find them.
// ============================================================================
// ============================================================================
// FILE UPLOAD + DROPZONE
// ============================================================================
function setupDropzone() {
  const dz = document.getElementById('dropzone');
  const input = document.getElementById('fileInput');
  if (!dz || !input) return;

  dz.addEventListener('click', (e) => {
    if (e.target === input) return;
    input.click();
  });
  input.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFiles(Array.from(e.target.files));
    input.value = '';
  });
  ['dragenter', 'dragover'].forEach(ev => {
    dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dz.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('dragover'); });
  });
  dz.addEventListener('drop', e => {
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFiles(files);
  });
}

async function handleFiles(fileList) {
  // Detect if this is an incremental addition — pipeline already completed,
  // new files should refresh only affected modules, not nuke the run.
  const isIncremental = STATE.pipelineDone;
  const newFiles = [];

  // Quick text-content hash for dedup. Same file re-dropped (common when brokers
  // resend "the latest" loss run that hasn't actually changed) → skip re-processing
  // to save API spend. Uses the extracted text hash rather than raw binary so that
  // cosmetic PDF re-exports (metadata changes only) still dedup correctly.
  const hashText = (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return 'h_' + (h >>> 0).toString(36) + '_' + s.length;
  };

  for (const file of fileList) {
    const id = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const entry = {
      id, name: file.name, size: file.size, type: file.type,
      text: '', classification: null, confidence: 0, routedTo: null,
      state: 'parsing', error: null,
      isIncremental: isIncremental,
      // Hold a reference to the raw File object so the pipeline can mirror
      // the binary into the Document Library after classification (Step 1
      // of the wire-up plan). Browsers keep File objects in memory as long
      // as something references them; we drop this once the file finishes
      // processing through the docs view to avoid retention. Not persisted
      // in snapshot.files (lite snapshot drops `file` along with `text`).
      _rawFile: file,
    };
    STATE.files.push(entry);
    newFiles.push(entry);
    renderFileList();
    try {
      const meta = {};
      entry.text = await extractText(file, meta);
      if (!entry.text || entry.text.length < 20) {
        entry.state = 'error';
        entry.error = 'Empty or too short';
        logAudit('Extract', 'FAILED ' + file.name + ' · empty or too short (' + (entry.text?.length || 0) + ' chars)', 'error');
      } else {
        // Dedup check — if we already have a file with the same content hash, this is
        // the same content. Mark as duplicate and don't classify / route / process again.
        entry.contentHash = hashText(entry.text);
        const existingDup = STATE.files.find(f => f !== entry && f.contentHash === entry.contentHash && f.state !== 'error');
        if (existingDup) {
          entry.state = 'duplicate';
          entry.duplicateOf = existingDup.name;
          logAudit('Extract', 'DUPLICATE ' + file.name + ' · matches already-loaded ' + existingDup.name + ' (same content hash) · skipped', 'warn');
          toast(file.name + ' is a duplicate of ' + existingDup.name + ' — skipped', 'warn');
          renderFileList();
          continue;
        }
        entry.state = 'parsed';
        entry.extractMeta = meta;  // preserve for later reference
        // Granular per-file audit — the UW can scroll the audit log to verify what
        // got pulled from each document. Format varies by file type so the log
        // shows meaningful coverage info (pages for PDF, sheets for XLSX, etc.).
        const kbChars = Math.round(entry.text.length / 1024 * 10) / 10;
        let coverageDetail = '';
        if (meta.kind === 'pdf') {
          coverageDetail = meta.pageCount + ' page' + (meta.pageCount === 1 ? '' : 's');
        } else if (meta.kind === 'xlsx') {
          coverageDetail = meta.sheetCount + ' sheet' + (meta.sheetCount === 1 ? '' : 's') + ' · tabs: ' + (meta.sheetNames || []).slice(0, 6).join(', ') + (meta.sheetNames?.length > 6 ? '…' : '');
        } else if (meta.kind === 'csv' || meta.kind === 'tsv') {
          coverageDetail = (meta.rowCount || '?') + ' rows';
        } else if (meta.kind === 'msg') {
          coverageDetail = 'email';
          if (meta.subject) coverageDetail += ' · "' + meta.subject.slice(0, 50) + '"';
          if (meta.attachmentCount > 0) coverageDetail += ' · ' + meta.attachmentCount + ' attachment' + (meta.attachmentCount === 1 ? '' : 's');
        } else if (meta.kind === 'eml') {
          coverageDetail = 'email';
        } else {
          coverageDetail = (meta.kind || 'text') + ' file';
        }
        logAudit('Extract', file.name + ' · ' + coverageDetail + ' · ' + kbChars + 'K chars extracted', 'ok');

        // === EMAIL ATTACHMENT UNPACK ===
        // If this is a .msg with attachments, synthesize File objects from each
        // attachment and inject them back into newFiles so they flow through the
        // normal parse + classify pipeline. We cap nesting at one level — if an
        // attached .msg contains its own attachments, we leave those opaque.
        if (meta.kind === 'msg' && meta.attachments && meta.attachments.length > 0 && !entry.isNestedAttachment) {
          const attachmentContext = buildAttachmentContext(meta);
          for (const att of meta.attachments) {
            try {
              // Wrap the Uint8Array in a Blob + File so extractText can re-use existing logic
              const blob = new Blob([att.content], { type: att.mimeType || 'application/octet-stream' });
              const pseudoFile = new File([blob], att.name, { type: att.mimeType || 'application/octet-stream' });
              const attachId = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
              const attachEntry = {
                id: attachId,
                name: att.name,
                size: att.contentLength,
                type: att.mimeType || '',
                text: '', classification: null, confidence: 0, routedTo: null,
                state: 'parsing', error: null,
                isIncremental: isIncremental,
                parentEmailId: entry.id,                   // lineage marker
                parentEmailName: entry.name,
                emailContext: attachmentContext[att.name] || '',  // sentence near the attachment reference
                emailSubject: meta.subject || '',
                isNestedAttachment: true,                   // prevents further recursion
                _rawFile: pseudoFile,                       // for pipeline → docs view ingestion
              };
              STATE.files.push(attachEntry);
              newFiles.push(attachEntry);
              renderFileList();
              // Parse the attachment synchronously — same extractText path, same error handling
              try {
                const attMeta = {};
                attachEntry.text = await extractText(pseudoFile, attMeta);
                if (!attachEntry.text || attachEntry.text.length < 20) {
                  attachEntry.state = 'error';
                  attachEntry.error = 'Empty or too short';
                } else {
                  attachEntry.contentHash = hashText(attachEntry.text);
                  const dup = STATE.files.find(f => f !== attachEntry && f.contentHash === attachEntry.contentHash && f.state !== 'error');
                  if (dup) {
                    attachEntry.state = 'duplicate';
                    attachEntry.duplicateOf = dup.name;
                    logAudit('Extract', 'DUPLICATE attachment ' + att.name + ' (from ' + entry.name + ') · matches ' + dup.name + ' · skipped', 'warn');
                  } else {
                    attachEntry.state = 'parsed';
                    attachEntry.extractMeta = attMeta;
                    const akb = Math.round(attachEntry.text.length / 1024 * 10) / 10;
                    logAudit('Extract', 'ATTACHMENT ' + att.name + ' (from ' + entry.name + ') · ' + akb + 'K chars extracted', 'ok');
                  }
                }
              } catch (attErr) {
                if (attErr.message && attErr.message.startsWith('__SCANNED_PDF__::')) {
                  attachEntry.state = 'needs_manual';
                  attachEntry.needsReview = true;
                  attachEntry.manualReason = 'scanned';
                  attachEntry.warning = attErr.message.slice('__SCANNED_PDF__::'.length);
                  logAudit('Classifier', 'Attachment ' + att.name + ' flagged as scanned PDF — manual entry required', 'warn');
                } else if (attErr.message && attErr.message.startsWith('__UNREADABLE__::')) {
                  attachEntry.state = 'needs_manual';
                  attachEntry.needsReview = true;
                  attachEntry.manualReason = 'unreadable';
                  attachEntry.warning = attErr.message.slice('__UNREADABLE__::'.length);
                  logAudit('Classifier', 'Attachment ' + att.name + ' flagged as unreadable format — manual entry required', 'warn');
                } else {
                  attachEntry.state = 'error';
                  attachEntry.error = attErr.message;
                  logAudit('Extract', 'FAILED attachment ' + att.name + ': ' + attErr.message, 'error');
                }
              }
              renderFileList();
            } catch (outerErr) {
              logAudit('Extract', 'Could not unpack attachment ' + att.name + ' from ' + entry.name + ': ' + outerErr.message, 'error');
            }
          }
        }
      }
    } catch (err) {
      // Distinguish "tried and parser said no" from "truly broken"
      // Sentinel prefix '__SCANNED_PDF__::' or '__UNREADABLE__::' indicates a file format
      // the pipeline knows how to flag but can't extract. We mark it as needs_manual so the
      // UW sees a clear affordance rather than a hard error in the audit log.
      if (err.message && err.message.startsWith('__SCANNED_PDF__::')) {
        entry.state = 'needs_manual';
        entry.needsReview = true;
        entry.manualReason = 'scanned';
        entry.warning = err.message.slice('__SCANNED_PDF__::'.length);
        logAudit('Classifier', 'Flagged ' + file.name + ' as scanned PDF — OCR or manual entry required', 'warn');
      } else if (err.message && err.message.startsWith('__UNREADABLE__::')) {
        entry.state = 'needs_manual';
        entry.needsReview = true;
        entry.manualReason = 'unreadable';
        entry.warning = err.message.slice('__UNREADABLE__::'.length);
        logAudit('Classifier', 'Flagged ' + file.name + ' as unreadable format — manual entry required', 'warn');
      } else {
        entry.state = 'error';
        entry.error = err.message;
        toast(file.name + ': ' + err.message, 'error');
      }
    }
    renderFileList();
  }
  updateRunButton();

  // INCREMENTAL FLOW — if pipeline was already done, classify + route + re-run only affected modules
  if (isIncremental) {
    const parsedNew = newFiles.filter(f => f.state === 'parsed');
    if (parsedNew.length > 0) {
      await incrementalProcess(parsedNew);
    }
  }
}

function removeFile(id) {
  STATE.files = STATE.files.filter(f => f.id !== id);
  renderFileList();
  updateRunButton();
}

function renderFileList() {
  const list = document.getElementById('fileList');
  const footer = document.getElementById('filesFooter');
  const count = document.getElementById('fileCount');

  count.textContent = STATE.files.length + ' file' + (STATE.files.length === 1 ? '' : 's');

  if (STATE.files.length === 0) {
    list.innerHTML = '';
    footer.style.display = 'none';
    return;
  }

  list.innerHTML = STATE.files.map(f => {
    const icon = fileIconFor(f.name);
    let stateClass = '';
    let stateText = '';
    let extraBadge = '';

    if (f.state === 'parsing') { stateClass = 'parsing'; stateText = 'parsing…'; }
    else if (f.state === 'parsed') { stateClass = 'classified'; stateText = Math.round(f.text.length / 1024) + 'K chars · ready'; }
    else if (f.state === 'needs_manual') {
      // Scanned PDF or unreadable format — show amber warning badge + click-to-paste affordance.
      // The UW can paste the visible text into a modal to feed the pipeline the content it needs.
      stateClass = 'unknown';
      if (f.manualReason === 'scanned') {
        stateText = 'SCANNED PDF';
        extraBadge = '<span style="display:inline-block; margin-left: 4px; font-family: var(--font-mono); font-size: 8.5px; font-weight: 700; background: var(--warning); color: #0A0E1A; padding: 1px 5px; border-radius: 2px; letter-spacing: 0.06em;">PASTE TEXT</span>';
      } else {
        stateText = 'NOT READABLE';
        extraBadge = '<span style="display:inline-block; margin-left: 4px; font-family: var(--font-mono); font-size: 8.5px; font-weight: 700; background: var(--warning); color: #0A0E1A; padding: 1px 5px; border-radius: 2px; letter-spacing: 0.06em;">PASTE TEXT</span>';
      }
    }
    else if (f.state === 'classified') {
      stateClass = 'classified';
      // Helper to render a classifier type as a compact file-list label.
      // Turns "supplemental_contractors" into "SUPP · CONTRACTORS", leaves simple types uppercased.
      const prettyType = (t) => {
        if (!t) return '';
        if (t.startsWith('supplemental_')) return 'SUPP · ' + t.slice('supplemental_'.length).toUpperCase();
        if (t === 'supplemental') return 'SUPP · GENERIC';
        return t.toUpperCase();
      };
      // Show combined-doc info
      if (f.isCombined && f.classifications && f.classifications.length > 1) {
        stateText = f.classifications.map(c => prettyType(c.type)).join(' + ');
        extraBadge = '<span style="display:inline-block; margin-left: 4px; font-family: var(--font-mono); font-size: 8.5px; font-weight: 700; background: var(--warning); color: #0A0E1A; padding: 1px 5px; border-radius: 2px; letter-spacing: 0.06em;">COMBINED</span>';
      } else {
        stateText = prettyType(f.classification);
      }
      if (f.needsReview) {
        stateClass = 'unknown';  // use the amber border
        extraBadge = '<span style="display:inline-block; margin-left: 4px; font-family: var(--font-mono); font-size: 8.5px; font-weight: 700; background: var(--warning); color: #0A0E1A; padding: 1px 5px; border-radius: 2px; letter-spacing: 0.06em;">REVIEW</span>';
      }
    }
    else if (f.state === 'error') { stateClass = 'error'; stateText = 'error: ' + (f.error || 'unknown'); }

    const confBadge = f.state === 'classified' && f.confidence ? Math.round(f.confidence * 100) + '%' : '';

    // Lineage marker — if this file was unpacked from an email attachment,
    // show a small paperclip icon and the parent email's name as a subtitle so
    // the UW can trace exactly where each file came from. Auditable by design.
    const lineageHtml = f.parentEmailId && f.parentEmailName
      ? `<div class="file-lineage" title="Unpacked from email: ${escapeHtml(f.parentEmailName)}"><span class="lineage-clip">📎</span>from: ${escapeHtml(f.parentEmailName.length > 32 ? f.parentEmailName.slice(0, 29) + '…' : f.parentEmailName)}</div>`
      : '';

    return `
      <div class="file-item ${stateClass}" ${f.state === 'needs_manual' ? `onclick="openManualPasteModal('${f.id}')" style="cursor: pointer;" title="Click to paste the document text manually"` : ''}>
        <div class="file-icon">${icon}</div>
        <div class="file-meta">
          <div class="file-name">${escapeHtml(f.name)}</div>
          <div class="file-class"><span class="tag">${escapeHtml(stateText)}</span>${extraBadge}</div>
          ${lineageHtml}
        </div>
        ${confBadge ? `<div class="file-conf">${confBadge}</div>` : ''}
        <div class="file-remove" onclick="removeFile('${f.id}')" title="Remove">✕</div>
      </div>
    `;
  }).join('');

  footer.style.display = 'flex';
  const parsed = STATE.files.filter(f => f.state === 'parsed' || f.state === 'classified').length;
  const errors = STATE.files.filter(f => f.state === 'error').length;
  document.getElementById('filesClassified').textContent = parsed + '/' + STATE.files.length + ' parsed';
  document.getElementById('filesRoutingOk').innerHTML = errors > 0
    ? `<span style="color: var(--danger);">${errors} error${errors === 1 ? '' : 's'}</span>`
    : (parsed === STATE.files.length ? `<span class="ok">✓ ALL PARSED</span>` : '');
}

function updateRunButton() {
  const btn = document.getElementById('btnRun');
  const label = document.getElementById('btnRunLabel');
  const ready = STATE.files.filter(f => f.state === 'parsed' || f.state === 'classified').length;
  if (ready > 0) {
    btn.disabled = false;
    label.textContent = 'Run Pipeline · ' + ready + ' file' + (ready === 1 ? '' : 's');
  } else {
    btn.disabled = true;
    label.textContent = 'Drop files to begin';
  }
  updateQueueKpi();
}

function updateQueueKpi() {
  const active = document.getElementById('kpiActive');
  const sub = document.getElementById('kpiActiveSub');
  if (!active || !sub) return;
  const total = STATE.submissions.length;
  const awaiting = STATE.submissions.filter(s => s.status === 'AWAITING UW REVIEW').length;
  if (total === 0) {
    // No archived submissions yet — fall back to the live workbench state
    if (STATE.pipelineRunning) {
      active.innerHTML = '<em class="kpi-submissions-awaiting">RUN</em>';
      sub.textContent = 'pipeline in progress…';
    } else if (STATE.files.length > 0) {
      active.innerHTML = '<em>' + STATE.files.length + '</em>';
      sub.textContent = 'files loaded · ready to run';
    } else {
      active.innerHTML = '<em>—</em>';
      sub.textContent = 'Click New Submission to begin';
    }
    return;
  }
  // Archived submissions exist — show the cohort stats instead
  active.innerHTML = '<em class="kpi-submissions-count">' + total + '</em>';
  if (awaiting > 0) {
    sub.innerHTML = '<strong style="color: var(--warning);">' + awaiting + ' awaiting UW review</strong> · ' + (total - awaiting) + ' in progress';
  } else {
    sub.textContent = total + ' submission' + (total === 1 ? '' : 's') + ' · none awaiting review';
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================================
// SUBMISSIONS QUEUE — archive on pipeline-run, UW-driven status, click to rehydrate
// ============================================================================
// Lifecycle:
//   Pipeline completes → archiveCurrentSubmission() creates/updates the record →
//   queue shows the row with derived fields + missing-info chip + AWAITING UW REVIEW
//   status. UW clicks the status pill to change it. Clicking a row rehydrates that
//   submission back into the workbench. Clicking New Submission archives the current
//   one (if any) before wiping. Persistence is Supabase `submissions` table,
//   one row per submission, with a "lite" snapshot (file bytes dropped, extractions
//   preserved) to stay under DB row size limits.
// ============================================================================

const SUB_STATUSES = ['AWAITING UW REVIEW', 'INQUIRED', 'QUOTED', 'DECLINED', 'BOUND'];
const SUB_STATUS_CLASS = {
  'AWAITING UW REVIEW': 'status-awaiting',
  'INQUIRED':           'status-inquired',
  'QUOTED':             'status-quoted',
  'DECLINED':           'status-declined',
  'BOUND':              'status-bound'
};

// ---- Persistence ----------------------------------------------------------
// Phase 4: the Queue lives in Supabase (public.submissions). loadSubmissions
// is kept as a no-op shim so init-time callers don't break — the real load
// happens in sbHydrate() after sign-in. Phase 7 step 3 replaced the old batch
// saveSubmissions() with the direct-save pattern (sbSaveSubmission +
// buildSubmissionPayload at each mutation site); the dead saveSubmissions
// function was removed in v6.1 cleanup.
function loadSubmissions() {
  // No-op. The real load happens in sbHydrate() after sign-in. That function
  // re-populates STATE.submissions from public.submissions and re-renders the
  // Queue. Leaving this as a stub so init-time callers don't break.
}

// ---- Derive display fields from extractions -------------------------------
// Regex-heavy but deliberately loose — extraction outputs follow the prompt
// templates but aren't strict JSON, so we have to scan prose. Each helper
// returns null if it can't find a confident match; the queue cell then shows "—".

function deriveAccountName() {
  // Try supplemental first (most authoritative), then summary-ops opening line
  const supp = STATE.extractions.supplemental;
  if (supp && supp.text) {
    const m = supp.text.match(/\*{0,2}Company Name\*{0,2}\s*:?\s*([^\n]+)/i)
          || supp.text.match(/\*{0,2}Applicant\*{0,2}\s*:?\s*([^\n]+)/i)
          || supp.text.match(/\*{0,2}Named Insured\*{0,2}\s*:?\s*([^\n]+)/i);
    if (m) return cleanDerived(m[1]);
  }
  const so = STATE.extractions['summary-ops'];
  if (so && so.text) {
    // Opening narrative typically starts "<Company Name>, founded in..."
    const m = so.text.match(/^([A-Z][^,\n]{3,80}?),\s*(founded|established|specialize|is\s+a)/im);
    if (m) return cleanDerived(m[1]);
  }
  // Fall back to GL/AL named insured
  for (const mid of ['gl_quote', 'al_quote']) {
    const ext = STATE.extractions[mid];
    if (ext && ext.text) {
      const m = ext.text.match(/\*{0,2}Named Insured\*{0,2}\s*:?\s*([^\n]+)/i);
      if (m) return cleanDerived(m[1]);
    }
  }
  return null;
}

function deriveBroker() {
  // Email Intel extraction is most reliable — module pulls broker identity
  // from the broker's actual email with verbatim quotes
  const intel = STATE.extractions.email_intel;
  if (intel && intel.text) {
    const m = intel.text.match(/From\s*:?\s*([^\n]+)/i);
    if (m) return cleanDerived(m[1]);
  }
  // Also check any file classified as email — the raw From: header
  const emailFile = STATE.files.find(f => f.classification === 'email');
  if (emailFile && emailFile.text) {
    const m = emailFile.text.match(/^From\s*:\s*([^\n]+)/im);
    if (m) return cleanDerived(m[1]);
  }
  // Composed referral email (PROMPTS.email output) — has "Broker: <n>" line
  const referralEmail = STATE.extractions.email;
  if (referralEmail && referralEmail.text) {
    const m = referralEmail.text.match(/Broker\s*:?\s*([^\n]+)/i);
    if (m) return cleanDerived(m[1]);
  }
  // Fall back to supplemental if broker is named there
  const supp = STATE.extractions.supplemental;
  if (supp && supp.text) {
    const m = supp.text.match(/\*{0,2}Broker\*{0,2}\s*:?\s*([^\n]+)/i);
    if (m) return cleanDerived(m[1]);
  }
  return null;
}

function deriveEffective() {
  // GL quote is authoritative for effective date — it's the policy period start
  for (const mid of ['gl_quote', 'al_quote', 'excess']) {
    const ext = STATE.extractions[mid];
    if (ext && ext.text) {
      const m = ext.text.match(/\*{0,2}Policy Period\*{0,2}\s*:?\s*([\d\/\-\.]+)/i)
            || ext.text.match(/\*{0,2}Period\*{0,2}\s*:?\s*([\d\/\-\.]+)/i)
            || ext.text.match(/\*{0,2}Effective\*{0,2}\s*:?\s*([\d\/\-\.]+)/i);
      if (m) return cleanDerived(m[1]);
    }
  }
  const email = STATE.extractions.email;
  if (email && email.text) {
    const m = email.text.match(/Effective\s*:?\s*([^\n]+)/i);
    if (m) return cleanDerived(m[1]);
  }
  return null;
}

function deriveRequested() {
  // Broker's ask. Usually named in supplemental or email.
  const email = STATE.extractions.email;
  if (email && email.text) {
    const m = email.text.match(/Excess Target\s*:?\s*([^\n]+)/i)
          || email.text.match(/Requested\s*:?\s*([^\n]+)/i);
    if (m) return cleanDerived(m[1]);
  }
  const supp = STATE.extractions.supplemental;
  if (supp && supp.text) {
    const m = supp.text.match(/Lead Excess Target\s*:?\s*([^\n]+)/i)
          || supp.text.match(/Requested (?:Limit|Excess)\s*:?\s*([^\n]+)/i);
    if (m) return cleanDerived(m[1]);
  }
  const excess = STATE.extractions.excess;
  if (excess && excess.text) {
    // Try "Proposed Lead Excess Layer (Requested):" style header
    const m = excess.text.match(/Limit\s*:?\s*(\$[\d,]+(?:\.\d+)?[MK]?)/i);
    if (m) return cleanDerived(m[1]);
  }
  // Tower extraction often has "$XM xs $YM" structure
  const tower = STATE.extractions.tower;
  if (tower && tower.text) {
    const m = tower.text.match(/(\$\d+M?\s+xs\s+\$?[\w\s]+?)(?=\s*[<\n])/i);
    if (m) return cleanDerived(m[1]);
  }
  return null;
}

// Strip markdown bold, strip quote marks, cap at 60 chars for queue display
function cleanDerived(s) {
  if (!s) return null;
  let out = String(s).trim();
  out = out.replace(/^\*+|\*+$/g, '').replace(/^["']|["']$/g, '').trim();
  if (!out) return null;
  if (out.length > 60) out = out.slice(0, 57) + '…';
  return out;
}

// ---- Missing-info detection ----------------------------------------------
// Independent of status — flags what the pipeline didn't see, regardless of
// what the UW decided. A QUOTED submission can still show missing loss runs
// because that's a fact about coverage of the source docs.
function computeMissingInfo() {
  const missing = [];
  if (!deriveAccountName())  missing.push('Named Insured');
  if (!deriveBroker())       missing.push('Broker');
  if (!deriveEffective())    missing.push('Effective date');
  if (!STATE.extractions.losses)    missing.push('Loss runs');
  if (!STATE.extractions.gl_quote)  missing.push('Primary GL');
  if (!STATE.extractions.al_quote)  missing.push('Primary AL');
  // Underlying excess is only "missing" if one was requested (the requested
  // field was populated) but no excess doc was classified.
  if (deriveRequested() && !STATE.extractions.excess) {
    missing.push('Underlying excess schedule');
  }
  if (!STATE.extractions.supplemental) missing.push('Supplemental application');
  if (!STATE.extractions.safety)       missing.push('Safety program');
  // Email is expected on every submission — if no email was classified, flag it.
  // A submission without an email likely means the broker's cover message wasn't
  // included and the UW should verify they have the full submission package.
  if (!STATE.extractions.email_intel) missing.push('Broker email');
  return missing;
}

// ---- Archive / upsert ----------------------------------------------------
// Snapshot the current workbench state into STATE.submissions. If there's
// already a record for this pipeline run, update it in place (preserves
// UW-set status, history, and any edits the UW made since the run). Returns
// the submission record (never null).
function archiveCurrentSubmission() {
  if (!STATE.pipelineDone || !STATE.pipelineRun) return null;
  // Compute derived fields from current extractions
  const extractedIds = Object.keys(STATE.extractions);
  const avgConf = extractedIds.length > 0
    ? extractedIds.reduce((a, mid) => a + (STATE.extractions[mid].confidence || 0), 0) / extractedIds.length
    : 0;
  const derived = {
    account:     deriveAccountName(),
    broker:      deriveBroker(),
    effective:   deriveEffective(),
    requested:   deriveRequested(),
    confidence:  avgConf,
    modulesRun:  extractedIds.length,
    missingInfo: computeMissingInfo()
  };
  // Build the snapshot — clone just what's needed for rehydration.
  // Note: edits/customCards/hiddenCards have their own per-row storage in
  // Supabase `submission_edits`; we include them in the snapshot too so a
  // rehydrated submission restores cleanly even before sbLoadEdits resolves.
  const snapshot = {
    files:          deepClone(STATE.files),
    extractions:    deepClone(STATE.extractions),
    edits:          deepClone(STATE.edits),
    customCards:    deepClone(STATE.customCards),
    hiddenCards:    deepClone(STATE.hiddenCards),
    handoff:        deepClone(STATE.handoff),
    audit:          STATE.audit.slice(),            // shallow is fine, events are flat
    runTotalCost:   STATE.runTotalCost || 0,
    pipelineRun:    STATE.pipelineRun
  };
  // Upsert — look for an existing record by pipelineRun
  let rec = STATE.submissions.find(s => s.pipelineRun === STATE.pipelineRun);
  const now = Date.now();
  if (rec) {
    // Update existing record in place. Preserve UW-set status + history +
    // createdAt. Everything else refreshes to latest.
    Object.assign(rec, derived, { snapshot, lastModifiedAt: now });
  } else {
    // Brand new record
    rec = {
      id:              'SUB-' + now.toString(36).toUpperCase(),
      pipelineRun:     STATE.pipelineRun,
      createdAt:       now,
      lastModifiedAt:  now,
      status:          'AWAITING UW REVIEW',
      statusHistory:   [{ from: null, to: 'AWAITING UW REVIEW', at: now, actor: currentActor() }],
      ...derived,
      snapshot
    };
    STATE.submissions.push(rec);
  }
  STATE.activeSubmissionId = rec.id;
  // Phase 4 (v2): save this one record directly — bypasses the batch
  // saveSubmissions() path which was silently skipping all promise callbacks.
  // This is fire-and-forget but uses explicit await inside an async IIFE so
  // every step logs to audit, making future silent failures impossible.
  (async () => {
    if (typeof logAudit === 'function') logAudit('Submissions', 'Saving ' + rec.id + ' to cloud…', 'ok');
    try {
      if (typeof sbSaveSubmission !== 'function') {
        throw new Error('sbSaveSubmission not defined');
      }
      // Build lite snapshot (drop raw file text bytes to stay under row-size limits)
      const liteSnapshot = rec.snapshot ? {
        ...rec.snapshot,
        files: (rec.snapshot.files || []).map(f => ({ ...f, text: '', textDropped: true, _rawFile: undefined })),
        derived: {
          account:         rec.account || null,
          broker:          rec.broker || null,
          effectiveDate:   rec.effective || rec.effectiveDate || null,
          requestedLimits: rec.requested || rec.requestedLimits || null,
          missingInfo:     rec.missingInfo || null
        }
      } : null;
      const saved = await sbSaveSubmission(buildSubmissionPayload(rec, liteSnapshot));
      if (typeof logAudit === 'function') logAudit('Submissions', 'Saved ' + rec.id + ' to cloud · row id ' + (saved && saved.id ? saved.id.slice(0, 12) : '(no id)'), 'ok');
      if (typeof toast === 'function') toast('Saved to cloud · ' + rec.id.slice(0, 12));
    } catch (err) {
      console.error('Submission save failed', rec.id, err);
      const msg = (err && err.message) ? err.message : String(err);
      if (typeof logAudit === 'function') logAudit('Submissions', 'SAVE FAILED ' + rec.id + ' · ' + msg + ' · kept in-memory', 'error');
      if (typeof toast === 'function') toast('Cloud save failed · ' + msg.slice(0, 80));
    }
  })();
  renderQueueTable();
  updateQueueKpi();
  return rec;
}

function deepClone(v) {
  // Browser-native where available, JSON fallback otherwise. Our objects
  // are plain data (no Dates, no functions, no circular refs) so JSON is safe.
  if (typeof structuredClone === 'function') {
    try { return structuredClone(v); } catch (e) {}
  }
  return JSON.parse(JSON.stringify(v));
}

// ---- Status change -------------------------------------------------------
function changeSubmissionStatus(submissionId, newStatus) {
  const rec = STATE.submissions.find(s => s.id === submissionId);
  if (!rec) return;
  if (!SUB_STATUSES.includes(newStatus)) {
    toast('Invalid status: ' + newStatus, 'error');
    return;
  }
  if (rec.status === newStatus) { closeAllStatusMenus(); return; }
  const from = rec.status;
  const now = Date.now();
  rec.status = newStatus;
  rec.lastModifiedAt = now;
  rec.statusHistory = rec.statusHistory || [];
  rec.statusHistory.push({ from, to: newStatus, at: now, actor: currentActor() });
  renderQueueTable();
  updateQueueKpi();
  logAudit('Submissions', rec.id + ' · status ' + from + ' → ' + newStatus, '—');
  toast(displayAccount(rec) + ' · ' + newStatus.toLowerCase());
  closeAllStatusMenus();
  // Phase 4 (v2): persist the single record directly, bypassing the batch
  // saveSubmissions() path. Fire-and-forget with verbose audit so any failure
  // is visible instead of silent. Mirrors the pattern in archiveCurrentSubmission.
  (async () => {
    try {
      if (typeof sbSaveSubmission !== 'function') throw new Error('sbSaveSubmission not defined');
      const liteSnapshot = rec.snapshot ? {
        ...rec.snapshot,
        files: (rec.snapshot.files || []).map(f => ({ ...f, text: '', textDropped: true, _rawFile: undefined })),
        derived: {
          account:         rec.account || null,
          broker:          rec.broker || null,
          effectiveDate:   rec.effective || rec.effectiveDate || null,
          requestedLimits: rec.requested || rec.requestedLimits || null,
          missingInfo:     rec.missingInfo || null
        }
      } : null;
      await sbSaveSubmission(buildSubmissionPayload(rec, liteSnapshot));
      if (typeof logAudit === 'function') logAudit('Submissions', 'Status synced to cloud · ' + rec.id + ' · ' + newStatus, 'ok');
    } catch (err) {
      console.error('Status sync failed', rec.id, err);
      const msg = (err && err.message) ? err.message : String(err);
      if (typeof logAudit === 'function') logAudit('Submissions', 'STATUS SYNC FAILED ' + rec.id + ' · ' + msg, 'error');
      if (typeof toast === 'function') toast('Status save failed · ' + msg.slice(0, 80));
    }
  })();
}

function displayAccount(rec) {
  return rec.account || ('Submission ' + rec.id.replace('SUB-', ''));
}

// ---- Rehydration ---------------------------------------------------------
// Pull a submission's snapshot back into the workbench. Before doing so,
// save the currently-active submission's state so the UW doesn't lose
// anything when hopping between submissions.
function rehydrateSubmission(submissionId) {
  const rec = STATE.submissions.find(s => s.id === submissionId);
  if (!rec || !rec.snapshot) {
    toast('Could not load submission — snapshot missing', 'error');
    return;
  }
  // Same-submission click: if UW clicks the row they're already on, just go to
  // submission view without reloading. The live workbench state is fresher than
  // any stored snapshot, so reloading would be destructive.
  if (STATE.activeSubmissionId === submissionId && STATE.pipelineDone) {
    switchView('submission');
    showStage('sum');
    return;
  }
  // Different submission: save active submission's current state before swapping
  // so the UW doesn't lose any live edits made since archive.
  if (STATE.activeSubmissionId && STATE.activeSubmissionId !== submissionId) {
    const activeRec = STATE.submissions.find(s => s.id === STATE.activeSubmissionId);
    if (activeRec && STATE.pipelineDone) {
      // Phase 8.5 round 3 fix #4: flush any pending debounced edit save
      // BEFORE snapshotting. Without this, an edit made within the 450ms
      // debounce window before the user clicks a different submission would
      // race: the snapshot captures the new edit, but submission_edits still
      // holds the OLD edit (because the debounce hasn't fired yet). Then on
      // later rehydrate, sbLoadEdits overlays the stale cloud row on top of
      // the fresh snapshot edit, silently losing the edit. Cancelling the
      // timer and calling saveEditsNow() synchronously here forces the cloud
      // edit row to match the snapshot before we move on.
      if (SAVE_DEBOUNCE) {
        clearTimeout(SAVE_DEBOUNCE);
        SAVE_DEBOUNCE = null;
        if (typeof saveEditsNow === 'function') saveEditsNow();
      }
      // Refresh snapshot with any edits the UW made to the active submission
      activeRec.snapshot = {
        files:          deepClone(STATE.files),
        extractions:    deepClone(STATE.extractions),
        edits:          deepClone(STATE.edits),
        customCards:    deepClone(STATE.customCards),
        hiddenCards:    deepClone(STATE.hiddenCards),
        handoff:        deepClone(STATE.handoff),
        audit:          STATE.audit.slice(),
        runTotalCost:   STATE.runTotalCost || 0,
        pipelineRun:    STATE.pipelineRun
      };
      activeRec.lastModifiedAt = Date.now();
      // Phase 7 step 3: replace the broken-shape batch saveSubmissions() with
      // a direct single-record save. Matches the pattern in archiveCurrentSubmission /
      // changeSubmissionStatus / deleteSubmission. Verbose audit on every step
      // so future silent failures become impossible to miss. No green success
      // toast on auto-saves — would confuse UX since the user navigated away.
      (async () => {
        if (typeof logAudit === 'function') logAudit('Submissions', 'Saving ' + activeRec.id + ' to cloud (auto · switching submissions)…', 'ok');
        try {
          if (typeof sbSaveSubmission !== 'function') {
            throw new Error('sbSaveSubmission not defined');
          }
          const liteSnapshot = activeRec.snapshot ? {
            ...activeRec.snapshot,
            files: (activeRec.snapshot.files || []).map(f => ({ ...f, text: '', textDropped: true, _rawFile: undefined })),
            derived: {
              account:         activeRec.account || null,
              broker:          activeRec.broker || null,
              effectiveDate:   activeRec.effective || activeRec.effectiveDate || null,
              requestedLimits: activeRec.requested || activeRec.requestedLimits || null,
              missingInfo:     activeRec.missingInfo || null
            }
          } : null;
          const saved = await sbSaveSubmission(buildSubmissionPayload(activeRec, liteSnapshot));
          if (typeof logAudit === 'function') logAudit('Submissions', 'Saved ' + activeRec.id + ' (auto · switching submissions) · row id ' + (saved && saved.id ? saved.id.slice(0, 12) : '(no id)'), 'ok');
        } catch (err) {
          console.error('Submission save failed (rehydrate path)', activeRec.id, err);
          const msg = (err && err.message) ? err.message : String(err);
          if (typeof logAudit === 'function') logAudit('Submissions', 'SAVE FAILED ' + activeRec.id + ' (auto · switching submissions) · ' + msg + ' · kept in-memory', 'error');
          if (typeof toast === 'function') toast('Cloud save failed · ' + msg.slice(0, 80), 'error');
        }
      })();
    }
  }
  // Load target snapshot
  const snap = rec.snapshot;
  STATE.files         = deepClone(snap.files || []);
  STATE.extractions   = deepClone(snap.extractions || {});
  STATE.edits         = deepClone(snap.edits || {});
  STATE.customCards   = deepClone(snap.customCards || []);
  STATE.hiddenCards   = deepClone(snap.hiddenCards || {});
  STATE.handoff       = deepClone(snap.handoff || { status: null, viewAs: 'uw', history: [] });
  STATE.audit         = (snap.audit || []).slice();
  STATE.runTotalCost  = snap.runTotalCost || 0;
  STATE.pipelineRun   = snap.pipelineRun || rec.pipelineRun;
  STATE.pipelineDone  = true;
  STATE.pipelineRunning = false;
  STATE.activeSubmissionId = submissionId;

  // Phase 8.5 fix: overlay edits from submission_edits table on top of the
  // snapshot edits. The snapshot was captured at the last save; submission_edits
  // is the live source of truth and may be newer (e.g. user edited a card,
  // refreshed before next snapshot save). Cloud edits win on conflict.
  // Module keys come back prefixed: 'card:<id>' → STATE.edits[id]
  //                                 'custom:<id>' → STATE.customCards entry
  //                                 'hidden:<id>' → STATE.hiddenCards[id] = true
  if (typeof sbLoadEdits === 'function') {
    (async () => {
      try {
        const editRows = await sbLoadEdits(submissionId);
        if (!editRows || editRows.length === 0) {
          if (typeof logAudit === 'function') logAudit('Edits', 'Hydrate · ' + submissionId + ' · 0 cloud edit rows', 'ok');
          return;
        }
        // Apply each row by prefix
        const customById = new Map();
        // Index existing customCards so we can replace entries that come back from cloud
        for (const cc of STATE.customCards) { if (cc && cc.id) customById.set(cc.id, cc); }
        let editCount = 0, customCount = 0, hiddenCount = 0;
        for (const row of editRows) {
          const key = row.module_key || '';
          if (key.startsWith('card:')) {
            const moduleId = key.slice(5);
            STATE.edits[moduleId] = row.payload || {};
            editCount++;
          } else if (key.startsWith('custom:')) {
            const cc = row.payload || {};
            if (cc.id) {
              customById.set(cc.id, cc);   // replace or insert
              customCount++;
            }
          } else if (key.startsWith('hidden:')) {
            const moduleId = key.slice(7);
            STATE.hiddenCards[moduleId] = true;
            hiddenCount++;
          }
        }
        STATE.customCards = Array.from(customById.values());
        if (typeof logAudit === 'function') {
          logAudit('Edits', 'Hydrate · ' + submissionId + ' · cloud overlay: ' +
            editCount + ' edits, ' + customCount + ' custom, ' + hiddenCount + ' hidden', 'ok');
        }
        // Re-render the workbench cards so the cloud-overlaid edits show
        if (typeof renderSummaryCards === 'function') renderSummaryCards();
      } catch (err) {
        console.warn('sbLoadEdits failed during rehydrate', err);
        if (typeof logAudit === 'function') logAudit('Edits', 'Hydrate FAILED · ' + submissionId + ' · ' + (err.message || err), 'error');
      }
    })();
  }
  // Phase 4: rehydrate feedback events for this submission from Supabase so
  // the UW's 👍/👎/💬 reactions show up on the cards after refresh or when
  // opening an archived submission. Fire-and-forget with audit logging.
  if (typeof sbLoadFeedbackForSubmission === 'function') {
    (async () => {
      try {
        const events = await sbLoadFeedbackForSubmission(submissionId);
        // Merge: keep any in-memory events for other submissions, replace
        // this submission's events with the DB copy.
        const othersOnly = (STATE.feedback || []).filter(e => e.submissionId !== submissionId);
        STATE.feedback = othersOnly.concat(events);
        if (typeof logAudit === 'function') logAudit('Feedback', 'Loaded ' + events.length + ' event(s) for ' + submissionId, 'ok');
        // Re-render anything that shows feedback counts / per-card reactions
        if (typeof updateFeedbackCount === 'function') updateFeedbackCount();
        if (typeof renderSummaryCards === 'function') renderSummaryCards();
      } catch (err) {
        console.warn('Feedback rehydrate failed', err);
        if (typeof logAudit === 'function') logAudit('Feedback', 'Rehydrate failed: ' + (err.message || err), 'warn');
      }
    })();
  }
  // Phase 4 leftover: the localStorage-era stash mechanism populated
  // STATE._pendingEdits from a 'stm-edits-v1' key on init, then consumed it
  // here once the matching submission rehydrated. The localStorage write side
  // was removed during Phase 4 migration; the read/consume side survived
  // because it's harmless when _pendingEdits is always null. Calling this is
  // a no-op today. Leaving it in place rather than removing because it
  // doesn't hurt and removing it would touch the rehydrate flow.
  if (typeof applyPendingEditsIfMatch === 'function') {
    applyPendingEditsIfMatch(STATE.pipelineRun);
  }
  // Phase 8.5 fix #1: do NOT call saveEditsNow() during rehydrate. The previous
  // call here was a localStorage-era artifact (stash the rehydrated edits to
  // stm-edits-v1 so reload picks the right submission). Now that submission_edits
  // is the cloud source of truth and sbLoadEdits() runs above to overlay cloud
  // rows asynchronously, calling saveEditsNow() here was a race: it could upsert
  // the older snapshot edits over fresher cloud rows before sbLoadEdits resolved.
  // Subsequent edits naturally trigger saveEditsNow via markDirty()/onEditCommit,
  // so removing this call costs nothing functionally.
  document.body.classList.add('pipeline-complete-mode');
  // UI refresh — render the submission view with the rehydrated state
  const sh = document.getElementById('sh-name');
  const sm = document.getElementById('sh-meta');
  if (sh) sh.textContent = displayAccount(rec);
  if (sm) {
    const parts = [];
    if (rec.broker)    parts.push('Broker: ' + rec.broker);
    if (rec.effective) parts.push('Effective: ' + rec.effective);
    if (rec.requested) parts.push('Requested: ' + rec.requested);
    parts.push(rec.modulesRun + '/' + Object.keys(MODULES).length + ' modules · ' + Math.round((rec.confidence || 0) * 100) + '% avg confidence');
    sm.textContent = parts.join(' · ');
  }
  // Warn if files had their bytes dropped by localStorage lite-persistence
  const droppedCount = STATE.files.filter(f => f.textDropped).length;
  if (droppedCount > 0) {
    toast(droppedCount + ' file' + (droppedCount === 1 ? '' : 's') + ' · bytes not in cache · re-upload to re-run', 'warn');
  }
  renderFileList();
  updateRunButton();
  renderSummaryCards();
  if (typeof renderClassifierReview === 'function') renderClassifierReview();
  if (typeof renderHandoffState === 'function') renderHandoffState();
  if (typeof renderAuditIfOpen === 'function') renderAuditIfOpen();
  if (typeof updateDecisionPane === 'function') updateDecisionPane();
  // Re-enable action buttons
  ['btnExcel', 'btnMd', 'btnRerunGuidelines'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = false;
  });
  // Pipeline UI — jump to summary stage
  const empty = document.getElementById('pipelineEmpty');
  const flow  = document.getElementById('pipelineFlow');
  if (empty) empty.style.display = 'none';
  if (flow)  flow.style.display = 'block';
  const sumTab = document.getElementById('stageTabSum');
  if (sumTab) sumTab.disabled = false;
  document.getElementById('sumCount').textContent = Object.keys(STATE.extractions).length;
  switchView('submission');
  showStage('sum');
  renderQueueTable();
  updateQueueKpi();
  logAudit('Submissions', 'Rehydrated ' + rec.id + ' · ' + displayAccount(rec), '—');
}

// ---- Delete submission ---------------------------------------------------
function deleteSubmission(submissionId, confirmAlready) {
  const rec = STATE.submissions.find(s => s.id === submissionId);
  if (!rec) return;
  if (!confirmAlready && !confirm('Delete ' + displayAccount(rec) + ' from the queue? This cannot be undone.')) return;
  const label = displayAccount(rec);
  STATE.submissions = STATE.submissions.filter(s => s.id !== submissionId);
  if (STATE.activeSubmissionId === submissionId) {
    STATE.activeSubmissionId = null;
  }
  renderQueueTable();
  updateQueueKpi();
  logAudit('Submissions', 'Deleted ' + submissionId + ' · ' + label + ' (local)', '—');
  toast('Deleted · ' + label);
  // Phase 5 — cascade to documents. We MUST run this BEFORE deleting the
  // submission row, because submissions FK has ON DELETE CASCADE on
  // document_pages — if the submission goes first, the cascade nukes the
  // rows before we can read their storage_paths, leaving orphan binaries
  // in the bucket. Doing storage+rows first, then submission, is safe in
  // either order from the user's perspective.
  // If the local docs view has hydrated docs in memory for this
  // submission, prune them so the user doesn't see stale rows. (Sync
  // step — does not await any cloud work.)
  if (window.docsView && typeof window.docsView.pruneSubmission === 'function') {
    try { window.docsView.pruneSubmission(submissionId); } catch(e) {}
  }
  // Now run the cloud-side cleanup with explicit ordering: documents first
  // (storage + rows), then submission row. Both wrapped in async IIFE so
  // the UI doesn't block on network round-trips.
  (async () => {
    try {
      if (typeof sbDeleteDocumentPagesForSubmission === 'function') {
        await sbDeleteDocumentPagesForSubmission(submissionId);
      }
    } catch (err) {
      console.warn('Document cascade delete failed for ' + submissionId + ':', err);
    }
    try {
      if (typeof sbDeleteSubmission !== 'function') throw new Error('sbDeleteSubmission not defined');
      await sbDeleteSubmission(submissionId);
      if (typeof logAudit === 'function') logAudit('Submissions', 'Cloud delete confirmed · ' + submissionId, 'ok');
    } catch (err) {
      console.error('Cloud delete failed', submissionId, err);
      const msg = (err && err.message) ? err.message : String(err);
      if (typeof logAudit === 'function') logAudit('Submissions', 'CLOUD DELETE FAILED ' + submissionId + ' · ' + msg + ' · row will reappear on refresh', 'error');
      if (typeof toast === 'function') toast('Cloud delete failed · ' + msg.slice(0, 80) + ' · will reappear on refresh');
    }
  })();
}

// ---- Status menu (dropdown) ----------------------------------------------
function toggleStatusMenu(submissionId, anchorEl, evt) {
  if (evt) { evt.stopPropagation(); evt.preventDefault(); }
  closeAllStatusMenus(submissionId);
  const menu = document.getElementById('statusMenu-' + submissionId);
  if (menu) menu.classList.toggle('open');
}
function closeAllStatusMenus(exceptId) {
  document.querySelectorAll('.status-menu.open').forEach(m => {
    if (!exceptId || m.id !== 'statusMenu-' + exceptId) m.classList.remove('open');
  });
}
// Click-outside dismiss
document.addEventListener('click', (e) => {
  if (!e.target.closest('.status-wrap')) closeAllStatusMenus();
});

// ---- Queue rendering -----------------------------------------------------
function renderQueueTable() {
  const tbody = document.getElementById('queueBody');
  if (!tbody) return;
  if (STATE.submissions.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="padding: 60px 24px; text-align: center; color: var(--text-3);">
          <div style="font-size: 13px; color: var(--text-2); margin-bottom: 6px; font-weight: 500;">No submissions yet</div>
          <div style="font-size: 12px; color: var(--text-3);">Click <strong style="color: var(--signal-ink);">+ New Submission</strong> to open the workbench. Once the pipeline runs, submissions archive here with UW status tracking.</div>
        </td>
      </tr>
    `;
    return;
  }
  // Sort: active submission first, then by lastModifiedAt desc
  const sorted = [...STATE.submissions].sort((a, b) => {
    if (a.id === STATE.activeSubmissionId) return -1;
    if (b.id === STATE.activeSubmissionId) return 1;
    return (b.lastModifiedAt || 0) - (a.lastModifiedAt || 0);
  });
  tbody.innerHTML = sorted.map(rec => renderQueueRow(rec)).join('');
}

function renderQueueRow(rec) {
  const isActive = rec.id === STATE.activeSubmissionId;
  const activeTag = isActive ? '<span class="sub-active-tag">ACTIVE</span>' : '';
  const account   = rec.account   ? escapeHtml(rec.account)   : '<span style="color: var(--text-3); font-style: italic;">(no name extracted)</span>';
  const broker    = rec.broker    ? escapeHtml(rec.broker)    : '<span style="color: var(--text-3);">—</span>';
  const effective = rec.effective ? escapeHtml(rec.effective) : '<span style="color: var(--text-3);">—</span>';
  const requested = rec.requested ? escapeHtml(rec.requested) : '<span style="color: var(--text-3);">—</span>';
  const modulesText = '<strong>' + (rec.modulesRun || 0) + '</strong>/' + Object.keys(MODULES).length;
  const confPct = Math.round((rec.confidence || 0) * 100);
  const confClass = confPct >= 90 ? 'conf-high' : (confPct >= 75 ? 'conf-mid' : 'conf-low');
  const confText = rec.modulesRun > 0 ? confPct + '%' : '—';
  const missing = rec.missingInfo || [];
  const missingChip = missing.length === 0
    ? '<span class="missing-chip none">✓ complete</span>'
    : `<span class="missing-chip">${missing.length} missing<span class="missing-chip-tooltip">
        <div class="missing-chip-tooltip-title">Missing from extraction</div>
        <ul>${missing.map(m => '<li>' + escapeHtml(m) + '</li>').join('')}</ul>
      </span></span>`;
  const statusClass = SUB_STATUS_CLASS[rec.status] || 'status-awaiting';
  const statusPill = `
    <div class="status-wrap">
      <button class="status-pill ${statusClass}" onclick="toggleStatusMenu('${rec.id}', this, event)">${escapeHtml(rec.status)}</button>
      <div class="status-menu" id="statusMenu-${rec.id}">
        ${SUB_STATUSES.map(s => `
          <div class="status-menu-item${s === rec.status ? ' current' : ''}" data-status="${s}" onclick="event.stopPropagation(); changeSubmissionStatus('${rec.id}', '${s}')">
            <span class="dot"></span>${s}
          </div>
        `).join('')}
      </div>
    </div>
  `;
  const runShort = (rec.pipelineRun || '').replace('PIPE-', '').slice(0, 10);
  const deleteBtn = `<span class="sub-delete" onclick="event.stopPropagation(); deleteSubmission('${rec.id}')" title="Remove from queue">×</span>`;
  return `
    <tr class="sub-row${isActive ? ' sub-active' : ''}" onclick="rehydrateSubmission('${rec.id}')">
      <td>
        <div class="acct-name">${account}${activeTag}${deleteBtn}</div>
        <div class="acct-sub">${runShort || '—'}</div>
      </td>
      <td>${broker}</td>
      <td>${effective}</td>
      <td>${requested}</td>
      <td class="modules-cell">${modulesText}</td>
      <td class="conf-cell ${confClass}">${confText}</td>
      <td>${missingChip}</td>
      <td onclick="event.stopPropagation()">${statusPill}</td>
    </tr>
  `;
}

// Init — load persisted submissions on page load
loadSubmissions();

// ============================================================================
// END SUBMISSIONS QUEUE MODULE
// ============================================================================


// ============================================================================
// FEEDBACK MODULE (Tier 1) — card-level reactions, attributed, local-first
// ============================================================================
// This module captures UW reactions to each summary card so prompt quality can
// be improved over time. Events are attributed (stamped with reviewer name) and
// stored locally. When a backend is added later, the ONE change needed is to
// add a fetch() POST inside `submitFeedbackEvent()` — every capture surface
// (thumbs up/down/suggestion buttons, card-level popovers, future submission
// wrap-up modal) routes through that one function.
//
// TODO(tier 2): passive edit-diff capture — when a UW edits a card, compute a
//               diff vs original and submit as a 'correction' feedback event
// TODO(tier 3): submission wrap-up modal when UW changes status to QUOTED/
//               DECLINED/BOUND — captures overall sentiment + missed items
// ============================================================================

const FEEDBACK_KEY = 'stm-feedback-v1';
const FEEDBACK_REASONS_NEGATIVE = [
  { id: 'missed_fact',    label: 'Missed a fact' },
  { id: 'hallucinated',   label: 'Hallucinated' },
  { id: 'wrong_structure',label: 'Wrong structure' },
  { id: 'wrong_emphasis', label: 'Wrong emphasis' },
  { id: 'other',          label: 'Other' }
];
const FEEDBACK_REASONS_SUGGESTION = [
  { id: 'add_detail',     label: 'Add more detail' },
  { id: 'add_section',    label: 'Add new section' },
  { id: 'add_comparison', label: 'Add comparison' },
  { id: 'add_citation',   label: 'Add source citation' },
  { id: 'other',          label: 'Other' }
];

// ---- Persistence --------------------------------------------------------
// Phase 4: feedback lives in Supabase `feedback_events`. Each 👍/👎/💬 click
// becomes one row insert via sbLogFeedback(). The app no longer reads
// feedback back locally; the Phase 6 admin view queries Supabase directly.
function loadFeedback() {
  // No-op. STATE.feedback stays empty; sbHydrate() leaves it that way.
}
function saveFeedback() {
  // No-op. Persistence happens per-event in submitFeedbackEvent() below.
}

// ---- Core submission function — SINGLE HOOK POINT FOR BACKEND WIRING ----
// Every 👍/👎/💬 across the app routes through here. It enriches the event
// with timestamp/actor/context, appends to the in-memory STATE.feedback so
// the admin card can show a live count, writes a row to Supabase
// feedback_events, and echoes to the audit trail.
function submitFeedbackEvent(event) {
  // Required fields — enforce defaults
  const enriched = {
    id: 'fb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    timestamp: Date.now(),
    actor: currentActor(),
    pipelineRun: STATE.pipelineRun || null,
    submissionId: STATE.activeSubmissionId || null,
    exportedAt: null,
    ...event
  };
  STATE.feedback.push(enriched);
  // Persist to Supabase — fire-and-forget. Failure is logged both to the
  // in-memory audit AND to a visible red toast so we never go silent again.
  if (typeof sbLogFeedback === 'function') {
    sbLogFeedback(enriched).catch(e => {
      console.warn('Feedback write failed', e);
      if (typeof logAudit === 'function') {
        logAudit('Feedback', 'Persist failed: ' + (e.message || e) + ' · in-memory only', 'warn');
      }
      if (typeof toast === 'function') {
        toast('Feedback save failed · ' + (e.message || 'network error').slice(0, 80), 'error');
      }
    });
  }
  // Echo to audit log so feedback is traceable in the existing audit trail too
  const sentBlurb = enriched.sentiment === 'positive' ? '👍'
                  : enriched.sentiment === 'negative' ? '👎'
                  : enriched.sentiment === 'suggestion' ? '💬'
                  : '—';
  const targetLabel = enriched.moduleId
    ? (MODULES[enriched.moduleId] ? MODULES[enriched.moduleId].code + ' ' + MODULES[enriched.moduleId].name : enriched.moduleId)
    : (enriched.level || 'submission');
  logAudit('Feedback', sentBlurb + ' ' + targetLabel + (enriched.reason ? ' · ' + enriched.reason : '') + (enriched.text ? ' · "' + enriched.text.slice(0, 60) + (enriched.text.length > 60 ? '…' : '') + '"' : ''), enriched.actor);
  // Refresh Admin view count if it's rendered
  if (typeof updateFeedbackCount === 'function') updateFeedbackCount();
  return enriched;
}

// ---- Public capture APIs (called from card UI) --------------------------

// One-click positive feedback. Fires immediately, no popover.
function feedbackQuickPositive(moduleId, customId) {
  const targetId = moduleId || customId;
  const ext = moduleId ? STATE.extractions[moduleId] : null;
  const cc = customId ? STATE.customCards.find(c => c.id === customId) : null;
  const event = {
    moduleId: moduleId || null,
    customCardId: customId || null,
    moduleName: moduleId ? (MODULES[moduleId] ? MODULES[moduleId].name : moduleId) : (cc ? cc.title : 'custom'),
    sentiment: 'positive',
    reason: null,
    text: null,
    outputSnapshot: ext ? (ext.text || '').slice(0, 2000) : (cc ? (cc.html || '').slice(0, 2000) : null),
    outputConfidence: ext ? ext.confidence : null,
    sourceDocNames: getSourceDocNamesForModule(moduleId),
    level: 'card'
  };
  submitFeedbackEvent(event);
  // Subtle visual confirmation on the card itself
  flashCardFeedback(targetId, 'positive');
  toast('Thanks — feedback logged');
}

// Open the popover for negative or suggestion feedback. Sentiment parameter
// controls chip set and framing; submission happens when the user hits Submit
// inside the popover.
function feedbackOpenPopover(moduleId, customId, sentiment, anchorBtn) {
  // Close any already-open popover first
  closeAllFeedbackPopovers();
  const popover = document.createElement('div');
  popover.className = 'fb-popover';
  popover.dataset.moduleId = moduleId || '';
  popover.dataset.customId = customId || '';
  popover.dataset.sentiment = sentiment;
  const isNegative = sentiment === 'negative';
  const chips = isNegative ? FEEDBACK_REASONS_NEGATIVE : FEEDBACK_REASONS_SUGGESTION;
  const title = isNegative ? 'What was wrong?' : 'What would you have liked to see?';
  const submitLabel = isNegative ? 'Submit feedback' : 'Submit suggestion';
  popover.innerHTML = `
    <div class="fb-popover-head">
      <span class="fb-popover-title">${title}</span>
      <button class="fb-popover-close" onclick="closeAllFeedbackPopovers()" title="Cancel">✕</button>
    </div>
    <div class="fb-popover-chips">
      ${chips.map(c => `<button class="fb-chip" data-reason="${c.id}" onclick="toggleFeedbackChip(this)">${escapeHtml(c.label)}</button>`).join('')}
    </div>
    <textarea class="fb-popover-textarea" placeholder="${isNegative ? 'Optional — what would have been correct?' : 'Optional — describe what was missing…'}" rows="3"></textarea>
    <div class="fb-popover-actions">
      <button class="fb-btn fb-btn-cancel" onclick="closeAllFeedbackPopovers()">Cancel</button>
      <button class="fb-btn fb-btn-submit" onclick="submitFeedbackFromPopover(this)">${submitLabel}</button>
    </div>
  `;
  // Position: append to the card so it flows naturally below the header
  const card = anchorBtn.closest('.sc-card');
  if (!card) return;
  // Expand the card if it was collapsed so the popover is visible
  card.classList.remove('collapsed');
  card.appendChild(popover);
  // Autofocus the textarea after a beat
  setTimeout(() => popover.querySelector('.fb-popover-textarea')?.focus(), 80);
}
function toggleFeedbackChip(btn) {
  btn.classList.toggle('active');
}
function closeAllFeedbackPopovers() {
  document.querySelectorAll('.fb-popover').forEach(p => p.remove());
}
function submitFeedbackFromPopover(submitBtn) {
  const popover = submitBtn.closest('.fb-popover');
  if (!popover) return;
  const moduleId = popover.dataset.moduleId || null;
  const customId = popover.dataset.customId || null;
  const sentiment = popover.dataset.sentiment;
  const activeChips = [...popover.querySelectorAll('.fb-chip.active')].map(b => b.dataset.reason);
  const text = popover.querySelector('.fb-popover-textarea').value.trim();
  // Require EITHER a chip selection OR text — otherwise nothing was actually said
  if (activeChips.length === 0 && !text) {
    toast('Select a reason or add a comment first', 'warn');
    return;
  }
  const ext = moduleId ? STATE.extractions[moduleId] : null;
  const cc = customId ? STATE.customCards.find(c => c.id === customId) : null;
  const event = {
    moduleId: moduleId || null,
    customCardId: customId || null,
    moduleName: moduleId ? (MODULES[moduleId] ? MODULES[moduleId].name : moduleId) : (cc ? cc.title : 'custom'),
    sentiment: sentiment,
    reason: activeChips.length > 0 ? activeChips.join(',') : null,
    text: text || null,
    outputSnapshot: ext ? (ext.text || '').slice(0, 2000) : (cc ? (cc.html || '').slice(0, 2000) : null),
    outputConfidence: ext ? ext.confidence : null,
    sourceDocNames: getSourceDocNamesForModule(moduleId),
    level: 'card'
  };
  submitFeedbackEvent(event);
  closeAllFeedbackPopovers();
  flashCardFeedback(moduleId || customId, sentiment);
  toast(sentiment === 'negative' ? 'Feedback logged — thanks' : 'Suggestion logged — thanks');
}

// Helper — which files fed a given module? Used so feedback event captures
// exactly what input the UW was reacting to. Essential for replaying an
// extraction against an updated prompt later.
function getSourceDocNamesForModule(moduleId) {
  if (!moduleId || !MODULES[moduleId]) return [];
  const m = MODULES[moduleId];
  if (m.inputsFrom === 'file') {
    return STATE.files
      .filter(f => {
        const targets = (f.routedToAll && f.routedToAll.length) ? f.routedToAll : (f.routedTo ? [f.routedTo] : []);
        return targets.includes(moduleId);
      })
      .map(f => f.name);
  }
  // 'extraction' or 'extractions' — the inputs are other modules' outputs
  const allDeps = [...(m.deps || []), ...(m.optionalDeps || [])];
  return allDeps.filter(d => STATE.extractions[d]).map(d => MODULES[d] ? MODULES[d].code + ' ' + MODULES[d].name : d);
}

// Subtle flash animation on the card so the UW knows their feedback registered.
// Classes cleaned up after the animation completes.
function flashCardFeedback(targetId, sentiment) {
  if (!targetId) return;
  const card = document.querySelector(`.sc-card[data-mid="${CSS.escape(targetId)}"]`);
  if (!card) return;
  const cls = sentiment === 'positive' ? 'fb-flash-positive' : (sentiment === 'negative' ? 'fb-flash-negative' : 'fb-flash-suggestion');
  card.classList.add(cls);
  setTimeout(() => card.classList.remove(cls), 900);
}

// ---- Export (Admin view) ------------------------------------------------
// Builds an xlsx with:
//   Tab 1 — Summary: counts by module / sentiment / reason
//   Tab 2 — All Events: every feedback record, ordered newest-first
//   Tab 3+ — one tab per module that received feedback, with the output snapshots
async function exportFeedback() {
  if (typeof XLSX === 'undefined') {
    toast('SheetJS not loaded', 'error');
    return;
  }
  // Phase 4: pull feedback from Supabase so the export is complete across all
  // sessions/devices, not just in-memory STATE. Falls back to STATE.feedback
  // if the Supabase read fails (offline, rate-limited, etc).
  let events = [];
  try {
    if (typeof sb !== 'undefined') {
      const { data, error } = await sb
        .from('feedback_events')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      // Translate DB rows into the event shape the export code expects
      events = (data || []).map(row => {
        const ctx = row.context || {};
        const sentiment = row.rating === 'up'   ? 'positive'
                        : row.rating === 'down' ? 'negative'
                        : row.rating === 'comment' ? 'suggestion' : null;
        let moduleId = null, customCardId = null;
        if (row.module_key) {
          if      (row.module_key.startsWith('card:'))   moduleId     = row.module_key.slice(5);
          else if (row.module_key.startsWith('custom:')) customCardId = row.module_key.slice(7);
        }
        return {
          timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
          actor: ctx.actor || 'unknown',
          pipelineRun: row.pipeline_run || '',
          submissionId: row.submission_id || '',
          sentiment: sentiment,
          moduleId: moduleId,
          customCardId: customCardId,
          moduleName: ctx.moduleName || moduleId || '(custom)',
          reason: ctx.reason || '',
          text: row.comment || '',
          outputSnapshot: ctx.outputSnapshot || '',
          outputConfidence: ctx.outputConfidence || '',
          sourceDocNames: ctx.sourceDocNames || []
        };
      });
    }
  } catch (err) {
    console.warn('Feedback export: Supabase read failed, falling back to in-memory', err);
    events = STATE.feedback || [];
  }
  // If nothing came back from either source, fall back to in-memory
  if (events.length === 0 && (STATE.feedback || []).length > 0) {
    events = STATE.feedback;
  }
  if (events.length === 0) {
    toast('No feedback events yet', 'warn');
    return;
  }
  const now = Date.now();

  const wb = XLSX.utils.book_new();

  // Tab 1 — Summary
  const byModule = {};
  const bySentiment = { positive: 0, negative: 0, suggestion: 0 };
  const byReason = {};
  events.forEach(e => {
    const mk = e.moduleName || e.moduleId || '(custom)';
    byModule[mk] = byModule[mk] || { positive: 0, negative: 0, suggestion: 0 };
    if (bySentiment[e.sentiment] !== undefined) bySentiment[e.sentiment]++;
    if (byModule[mk][e.sentiment] !== undefined) byModule[mk][e.sentiment]++;
    if (e.reason) e.reason.split(',').forEach(r => { byReason[r] = (byReason[r] || 0) + 1; });
  });
  const summaryRows = [
    ['FEEDBACK EXPORT'],
    [],
    ['Generated',         new Date(now).toISOString()],
    ['Total events',      events.length],
    ['Positive (👍)',     bySentiment.positive],
    ['Negative (👎)',     bySentiment.negative],
    ['Suggestions (💬)',  bySentiment.suggestion],
    [],
    ['Note', 'This export pulls from cloud · tabs "All Events" and per-module sheets below contain full detail including comments'],
    [],
    ['BREAKDOWN BY MODULE'],
    ['Module', 'Positive', 'Negative', 'Suggestions', 'Total']
  ];
  Object.entries(byModule).forEach(([mk, v]) => {
    summaryRows.push([mk, v.positive, v.negative, v.suggestion, v.positive + v.negative + v.suggestion]);
  });
  summaryRows.push([]);
  summaryRows.push(['TOP REASONS (negative + suggestions)']);
  summaryRows.push(['Reason', 'Count']);
  Object.entries(byReason).sort((a, b) => b[1] - a[1]).forEach(([r, c]) => {
    summaryRows.push([r, c]);
  });
  const summaryWS = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWS['!cols'] = [{ wch: 44 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, summaryWS, 'Summary');

  // Tab 2 — All Events (with full comment text)
  const eventHeader = ['Timestamp (ISO)', 'Actor', 'Module', 'Sentiment', 'Reason(s)', 'Comment', 'Pipeline Run', 'Submission ID', 'Source Docs', 'Output Snapshot'];
  const eventRows = [eventHeader];
  [...events].sort((a, b) => b.timestamp - a.timestamp).forEach(e => {
    eventRows.push([
      new Date(e.timestamp).toISOString(),
      e.actor || '',
      e.moduleName || e.moduleId || '(custom)',
      e.sentiment || '',
      e.reason || '',
      e.text || '',
      e.pipelineRun || '',
      e.submissionId || '',
      (e.sourceDocNames || []).join(' · '),
      (e.outputSnapshot || '').toString().slice(0, 2000)
    ]);
  });
  const eventsWS = XLSX.utils.aoa_to_sheet(eventRows);
  eventsWS['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 24 }, { wch: 10 }, { wch: 18 }, { wch: 60 }, { wch: 22 }, { wch: 16 }, { wch: 36 }, { wch: 120 }];
  XLSX.utils.book_append_sheet(wb, eventsWS, 'All Events');

  // Tab 3+ — one tab per module that received feedback
  const addedSheets = new Set(['Summary', 'All Events']);
  Object.keys(byModule).forEach(mk => {
    const modEvents = events.filter(e => (e.moduleName || e.moduleId || '(custom)') === mk);
    if (modEvents.length === 0) return;
    const rows = [
      [mk],
      [],
      ['Events on this module', modEvents.length],
      [],
      ['Timestamp', 'Actor', 'Sentiment', 'Reason(s)', 'Comment', 'Source Docs', 'Output Snapshot']
    ];
    modEvents.sort((a, b) => b.timestamp - a.timestamp).forEach(e => {
      rows.push([
        new Date(e.timestamp).toISOString(),
        e.actor || '',
        e.sentiment || '',
        e.reason || '',
        e.text || '',
        (e.sourceDocNames || []).join(' · '),
        (e.outputSnapshot || '').toString().slice(0, 2000)
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 60 }, { wch: 36 }, { wch: 120 }];
    let sheetName = mk.slice(0, 31).replace(/[\\\/\[\]\*\?:]/g, '_');
    let n = 1;
    const base = sheetName;
    while (addedSheets.has(sheetName)) { sheetName = base.slice(0, 29) + '_' + n; n++; }
    addedSheets.add(sheetName);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  const filename = 'stm_feedback_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.xlsx';
  XLSX.writeFile(wb, filename);
  logAudit('Feedback', 'Exported ' + events.length + ' events · ' + filename, '—');
  toast('Feedback exported · ' + events.length + ' events · ' + filename);
  updateFeedbackCount();
}

// Clear all feedback (keeps exported-at timestamp so the export flow is clean).
// Used from Admin view — confirmation required.
function clearFeedback() {
  if (STATE.feedback.length === 0) { toast('No feedback to clear', 'warn'); return; }
  if (!confirm('Delete all ' + STATE.feedback.length + ' feedback events? This cannot be undone. Export first if you want to keep them.')) return;
  STATE.feedback = [];
  saveFeedback();
  logAudit('Feedback', 'All feedback cleared by user', '—');
  updateFeedbackCount();
  toast('All feedback cleared');
}

// Update the live counter on the Admin card
function updateFeedbackCount() {
  // Phase 6 step 4: admins always see cloud-truth, not session-only counts.
  // Delegate to the admin renderer so a live feedback submission in-session
  // doesn't overwrite the cloud-truth status text with a session-only number.
  if (window.currentUser && window.currentUser.role === 'admin') {
    if (typeof renderAdminFeedbackCard === 'function') renderAdminFeedbackCard();
    return;
  }
  const el = document.getElementById('feedbackStatus');
  if (!el) return;
  const total = STATE.feedback.length;
  const newSince = STATE.feedbackExportedAt
    ? STATE.feedback.filter(e => !e.exportedAt || e.exportedAt > STATE.feedbackExportedAt).length
    : total;
  const pos = STATE.feedback.filter(e => e.sentiment === 'positive').length;
  const neg = STATE.feedback.filter(e => e.sentiment === 'negative').length;
  const sug = STATE.feedback.filter(e => e.sentiment === 'suggestion').length;
  if (total === 0) {
    el.textContent = 'NO EVENTS YET';
  } else {
    el.textContent = total + ' EVENTS · ' + pos + ' 👍 · ' + neg + ' 👎 · ' + sug + ' 💬' + (newSince !== total ? ' · ' + newSince + ' NEW' : '');
  }
}

// Init
loadFeedback();
// ============================================================================
// END FEEDBACK MODULE
// ============================================================================


// Initialize dropzone when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupDropzone);
} else {
  setupDropzone();
}

// Placeholder toast function if not defined yet (real one comes later in script)
if (typeof toast === 'undefined') {
  window.toast = function(msg, kind) {
    const w = document.getElementById('toastWrap');
    if (!w) { console.log('[toast]', msg); return; }
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    w.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; }, 2600);
    setTimeout(() => t.remove(), 3000);
  };
}


// ----- (was Block 3: lines 3114-5449 of app.html — exports, summary, handoff, plumbing) -----
// ============================================================================
// EXTRACTION PROMPTS — moved to prompts.js (Phase 8 step 1, 2026-04-25).
// Loaded via <script src="prompts.js"> in <head> as window.PROMPTS.
// ============================================================================

// ============================================================================
// DEMO MODE MOCKS — realistic outputs for each module
// ============================================================================
const MOCKS = {
  classifier: {
    'Commercial_App': {type:'supplemental_contractors',confidence:0.96,reasoning:'construction supplemental: max height 62 ft, crane usage, subcontracted work %, % direct/commercial/residential, states with % — subtype = contractors'},
    'Subk': {type:'subcontract',confidence:0.94,reasoning:'Master Subcontract Agreement with Article 8 Indemnification + Article 11 Insurance'},
    'Loss': {type:'losses',confidence:0.99,reasoning:'carrier loss run format with DOL / incurred / paid columns across 5 policy years'},
    'Starr': {type:'gl_quote',confidence:0.97,reasoning:'Starr Indemnity primary GL quote with CG 00 01 form + endorsement schedule'},
    'GreatAm': {type:'al_quote',confidence:0.93,reasoning:'Great American commercial auto quote with Symbol 1 covered auto + fleet schedule'},
    'Safety': {type:'safety',confidence:0.91,reasoning:'68-page written safety program with Safety Director, OSHA training matrix, EMR/TRIR metrics'},
    'RE_Meridian': {type:'email',confidence:0.99,reasoning:'Outlook format with From:/To:/Subject: broker renewal submission'},
    'Vendor': {type:'vendor',confidence:0.95,reasoning:'operated equipment lease with borrowed-servant language'},
    'Excess': {type:'excess',confidence:0.95,reasoning:'follow-form excess policy with layer structure + attachment point + underlying schedule'},
    'Website': {type:'website',confidence:0.94,reasoning:'homepage + services + about + projects pages from corporate site scrape'},
    default: {type:'unknown',confidence:0.5,reasoning:'could not confidently classify from text sample'}
  },

  'summary-ops': `Meridian Structural Group, LLC, founded in 2008, specializes in structural steel erection and concrete tilt-wall construction for commercial, light industrial, and select mid-rise residential projects. The company operates across Texas, Oklahoma, Louisiana, New Mexico, Arkansas, Colorado, and New York, and focuses on self-performance of structural work with subcontracted MEP, finishes, and specialty trades. Meridian prioritizes an OSHA VPP Star-certified safety culture, a 68-page written safety program, a full-time CSP/CHST-credentialed safety director, myCOI subcontractor tracking, and broad-form contractual risk transfer.

**Products and Services:**
- Structural steel erection
- Tilt-wall concrete construction
- Precast panel installation
- Design-build and general contracting services
- Rigging and heavy-lift planning

**Percentage of Work by Location:**
- Texas 61%
- Oklahoma 14%
- Louisiana 11%
- New Mexico 6%
- Arkansas 4%
- Colorado 3%
- New York 1%

**Safety Protocols:**
- Training: OSHA 30-hr (100% foremen), OSHA 10-hr (100% field), NCCCO crane operator certifications
- Safety Measures: 68-page written safety manual (rev. Jan 2026), Samsara telematics on all Class 5+ fleet units, Lytx AI cameras on Class 8
- Safety Staff: Safety Director Patricia Chen, CSP, CHST (7-yr tenure, full-time); 3 site safety managers; 1:42 safety-FTE to field-employee ratio
- Certifications: OSHA VPP Star (2021-present), AISC Certified Erector, ABC STEP Platinum (8 years)
- Performance: EMR 0.81 (3-yr avg), TRIR 2.1, DART 1.1

**Subcontractor Requirements:**
- Subcontracted Work: MEP trades, finishes, roofing, landscape (32% of operations)
- Risk Transfer: COIs via myCOI with broad-form hold-harmless; Meridian named AI on primary and non-contributory basis (CG 20 10 + CG 20 37)
- Liability Limits: GL $1M/$2M/$2M, AL $1M CSL, Umbrella $5M general / $10M structural/crane/rigging/roofing/electrical
- Compliance: 5-year completed ops tail required

**Source Products & Services (verbatim):**
- Structural steel erection
- Tilt-wall concrete construction
- Precast panel installation
- Design-build and general contracting services
- Rigging and heavy-lift planning

**Checklist – Did the Draft Include Each Item?**
- ✔ Structural steel erection
- ✔ Tilt-wall concrete construction
- ✔ Precast panel installation
- ✔ Design-build and general contracting services
- ✔ Rigging and heavy-lift planning

All items present. QC passed on first pass.`,

  supplemental: `**Supplemental Application Summary**

- Company Name: Meridian Structural Group, LLC
- Years in Business: 18 (Founded 2008)

**Operations:**
- Description: General contractor specializing in structural steel erection and concrete tilt-wall construction for commercial, light industrial, and select mid-rise residential projects.
- Max Height of Work: 62 ft
- Max Depth of Work: 14 ft (excavation support)
- Crane Usage: Yes. Details: 2 owned (65-ton & 90-ton crawler), balance leased with operator.

**Geographic Spread:**
- TX: 61%
- OK: 14%
- LA: 11%
- NM: 6%
- AR: 4%
- CO: 3%
- NY: 1%

**Work Mix:**
- Direct / Self-Performed: 68%
- Subcontracted: 32%
- Commercial: 74%
- Residential: 18%

**Subcontractor Risk-Transfer:**
- Additional Insured Required: Yes
- COIs Retained: Yes (myCOI)
- Indemnification / Hold-Harmless: Yes (broad form)
- Minimum Insurance Limits: GL $1M/$2M/$2M; AL $1M CSL; Umbrella $5M (general), $10M (structural/crane/rigging/roofing/electrical)

**Safety Program:**
- Formal Written Program: Yes
- Additional Safety Details: 68-page manual rev. Jan 2026. Safety Director Patricia Chen, CSP, CHST. OSHA VPP Star, AISC Certified Erector, ABC STEP Platinum. Samsara telematics on all Class 5+ units.

**Source Extracts (verbatim)**
- Applicant: Meridian Structural Group, LLC
- MAX HEIGHT OF WORK: 62 ft
- CRANES USED: [X] YES
- STATES: TX 61% | OK 14% | LA 11% | NM 6% | AR 4% | CO 3% | NY 1%
- Minimum Limits: GL $1M/$2M/$2M; AL $1M CSL; Umbrella $5M/$10M

**Checklist** — all 18 required fields present. QC passed on first pass.`,

  subcontract: `**Subcontractor Requirements:**

- **Subcontracted Work:** All subcontractors executing the Master Agreement
- **Risk Transfer / Indemnification:** Subcontractor shall indemnify, defend, and hold harmless Contractor, Owner, Architect from all claims arising from performance — "to the fullest extent permitted by law"
- **Additional Insured:** Meridian Structural Group named as AI on primary and non-contributory basis (CG 20 10 + CG 20 37, ongoing + completed ops)
- **Waiver of Subrogation:** Required on all lines
- **Liability Limits:**
  - GL: $1M occ / $2M gen agg / $2M prod-CO agg · per-project aggregate
  - AL: $1M CSL (any auto)
  - Umbrella/Excess: $5M general; $10M structural / crane / rigging / roofing / electrical
- **Duration of Coverage:** Completed ops maintained 5+ years following final acceptance

**Source Extracts (verbatim)**
- "Commercial General Liability on an occurrence form with limits of not less than $1,000,000..."
- "Meridian Structural Group... shall be named as Additional Insured on a primary and non-contributory basis (CG 20 10 and CG 20 37)..."
- "Completed operations coverage shall be maintained for a period of not less than five (5) years..."

**Checklist** — all 10 required fields present. QC passed.`,

  vendor: `**Vendor Agreement Analysis**
- **Vendor Name:** Southwest Crane Services, Inc.
- **Vendor Type:** Operated Equipment Lessor (crane rental with operator furnished)
- **Service/Equipment:** Crawler cranes 65T-250T, bare-rental or operated basis per-project
- **On-Site Work:** Yes — operator-furnished cranes at Lessee jobsite under Lessee direction

**Risk Transfer:**
- Indemnification: Mutual limited (each party for own negligence). Lessee defends Lessor for claims arising from Lessee signal person / direction
- Additional Insured: Yes — each party names the other on primary and non-contributory basis
- Waiver of Subrogation: Yes on GL, AL, WC
- Hold Harmless Scope: Mutual limited

**Insurance Limits Required:**
- GL: $2M each occurrence / $4M general aggregate
- AL: $2M combined single limit
- Umbrella/Excess: $10M each occurrence

**Operated Equipment Specific:**
- Borrowed Servant Language: Yes — Agreement acknowledges operator may be deemed borrowed servant under applicable state law when Lessee directs signaling/picks. Lessor does not waive WC employer status.
- Operator Qualifications: Required — NCCCO-certified operator furnished by Lessor

**Source Extracts (verbatim)**
- "Commercial General Liability: $2,000,000 each occurrence / $4,000,000 general aggregate"
- "the operator may be deemed a borrowed servant of Lessee under applicable state law"

**Checklist** — all 12 fields present. QC passed.`,

  safety: `**Written Safety Program Summary**

**Program Oversight:**
- Safety Director: Patricia Chen, CSP, CHST — 7 years tenure — full-time
- Reporting: Direct to CEO
- Staff: 3 site safety managers + 1 fleet safety specialist
- Ratio: 1 safety FTE per 42 field employees

**Written Program Scope:**
- Page Count: 68 pages
- Last Revision: January 15, 2026
- Topics: Fall Protection (Subpart M), Scaffolding (Subpart L), Cranes & Rigging (Subpart CC), Hot Work, Confined Space, Excavation (Subpart P), PPE, HazCom, Electrical Safety, Fleet Safety

**Training Matrix:**
- OSHA 30-Hour: 100% of foremen and superintendents
- OSHA 10-Hour: 100% of field personnel
- NCCCO Certification: All crane operators
- Competent Person - Fall Protection: Designated by jobsite
- Refresher Frequency: Annual, documented

**Performance Metrics (3-year average):**
- EMR: 0.81 (NAICS 236220 benchmark 1.00) — 19% better than industry
- TRIR: 2.1 (BLS benchmark 2.8) — 25% better than industry
- DART: 1.1
- LTIR: 0.4

**Programs & Certifications:**
- OSHA VPP Star: Continuously since 2021
- ABC STEP Platinum: 8 consecutive years (2018-2026)
- AISC Certified Erector: Advanced + Seismic

**Fleet / Mobile Equipment:**
- Telematics: Samsara across all Class 5+ units
- In-Cab Cameras: Lytx DriveCam with AI coaching on Class 8
- Speed Governance: 65 mph max Class 8
- CDL Qualification: Annual MVRs, hair-follicle pre-employment, random DOT testing

**Source Extracts (verbatim)** — key lines from the 68-page manual.
**Checklist** — all required fields present. QC passed.`,

  losses: `<div class="loss-output">

<div class="loss-summary-block">
  <div class="loss-summary-label">Summary</div>
  <p class="loss-summary-text"><strong>40 total claims over 5 policy years</strong> (22 GL + 18 AL). Combined incurred $489,000. Largest single loss $178,000 AL (7/14/23 I-35 Dallas rear-end, cervical BI, closed at AL primary limit). <strong>No claims exceeding $500K</strong> in the review period. <strong>Zero penetration</strong> of the $1M primary limits over 5 years. Frequency and severity both trending favorably in the most recent 24-month window following Samsara telematics deployment Q2 2024 and Lytx DriveCam rollout on Class 8 fleet.</p>
  <div class="loss-summary-meta">
    Effective Date Reviewed: <strong>5/1/2026</strong> &nbsp;·&nbsp; Valuation: <strong>3/31/2026</strong> &nbsp;·&nbsp; Period: <strong>5/1/2021 – 3/31/2026</strong> &nbsp;·&nbsp; Carriers: Starr Indemnity (GL), Great American (AL)
  </div>
</div>

<div class="loss-section-title">General Liability Loss Information</div>
<table class="loss-tbl">
  <thead>
    <tr>
      <th style="width:110px;">Policy Year</th>
      <th style="width:80px;">Claims</th>
      <th>Incurred</th>
      <th>Paid</th>
      <th style="width:110px;">Date Valued</th>
      <th>Historic Exposure</th>
    </tr>
  </thead>
  <tbody>
    <tr><td class="yr">2025-26</td><td class="num">4</td><td class="num">$30,700</td><td class="num">$18,400</td><td class="num">3/31/2026</td><td>$127M Rev · 75 PU</td></tr>
    <tr><td class="yr">2024-25</td><td class="num">4</td><td class="num">$51,100</td><td class="num">$42,600</td><td class="num">3/31/2026</td><td>$118M Rev · 68 PU</td></tr>
    <tr class="outlier"><td class="yr">2023-24</td><td class="num">6</td><td class="num">$48,200</td><td class="num">$48,200</td><td class="num">3/31/2026</td><td>$108M Rev · 62 PU</td></tr>
    <tr><td class="yr">2022-23</td><td class="num">5</td><td class="num">$94,100</td><td class="num">$94,100</td><td class="num">3/31/2026</td><td>$95M Rev · 58 PU</td></tr>
    <tr><td class="yr">2021-22</td><td class="num">3</td><td class="num">$28,100</td><td class="num">$28,100</td><td class="num">3/31/2026</td><td>$82M Rev · 54 PU</td></tr>
  </tbody>
  <tfoot>
    <tr><td>TOTAL</td><td class="num">22</td><td class="num">$252,200</td><td class="num">$231,400</td><td></td><td></td></tr>
  </tfoot>
</table>

<div class="loss-section-title">General Liability Large Losses ($500K+)</div>
<table class="loss-tbl">
  <thead>
    <tr>
      <th style="width:110px;">DOL</th>
      <th style="width:130px;">Incurred</th>
      <th style="width:130px;">Paid</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr><td colspan="4" class="loss-empty-row">No GL claims exceeding $500K in the 5-year review period. Largest GL loss: <strong>$62,400</strong> (3/2/23 — dropped object during steel erection, visiting contractor foot laceration requiring surgery, CLOSED).</td></tr>
  </tbody>
</table>

<div class="loss-section-title">Auto Liability Loss Information</div>
<table class="loss-tbl">
  <thead>
    <tr>
      <th style="width:110px;">Policy Year</th>
      <th style="width:80px;">Claims</th>
      <th>Incurred</th>
      <th>Paid</th>
      <th style="width:110px;">Date Valued</th>
      <th>Historic Exposure</th>
    </tr>
  </thead>
  <tbody>
    <tr><td class="yr">2025-26</td><td class="num">1</td><td class="num">$8,200</td><td class="num">$8,200</td><td class="num">3/31/2026</td><td>75 power units</td></tr>
    <tr><td class="yr">2024-25</td><td class="num">4</td><td class="num">$12,100</td><td class="num">$12,100</td><td class="num">3/31/2026</td><td>68 power units</td></tr>
    <tr class="outlier"><td class="yr">2023-24</td><td class="num">5</td><td class="num">$178,600</td><td class="num">$178,600</td><td class="num">3/31/2026</td><td>62 power units</td></tr>
    <tr><td class="yr">2022-23</td><td class="num">4</td><td class="num">$18,400</td><td class="num">$18,400</td><td class="num">3/31/2026</td><td>58 power units</td></tr>
    <tr><td class="yr">2021-22</td><td class="num">4</td><td class="num">$19,500</td><td class="num">$19,500</td><td class="num">3/31/2026</td><td>54 power units</td></tr>
  </tbody>
  <tfoot>
    <tr><td>TOTAL</td><td class="num">18</td><td class="num">$236,800</td><td class="num">$236,800</td><td></td><td></td></tr>
  </tfoot>
</table>

<div class="loss-section-title">Auto Liability Large Losses ($500K+)</div>
<table class="loss-tbl">
  <thead>
    <tr>
      <th style="width:110px;">DOL</th>
      <th style="width:130px;">Incurred</th>
      <th style="width:130px;">Paid</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr><td colspan="4" class="loss-empty-row">No AL claims exceeding $500K in the 5-year review period. Largest AL loss: <strong>$178,000</strong> (7/14/23 — Class 8 boom truck rear-ended passenger vehicle I-35 Dallas, cervical BI settled at primary limit inclusive of defense, CLOSED). This represents 17.8% of the $1M AL primary CSL and is the closest approach to primary in the review window.</td></tr>
  </tbody>
</table>

<div class="loss-notes-block">
  <div class="loss-notes-title">Analyst Notes</div>
  <p><strong>Frequency.</strong> 5-year average 8.0 claims per year (4.4 GL + 3.6 AL). 2023-24 peak of 11 combined claims (38% above average) driven by Class 8 fleet operations pre-telematics. Frequency declined sharply after Samsara deployment Q2 2024: 8 combined claims in 2024-25, 5 in 2025-26. 55% reduction from peak, consistent with telematics-attributable frequency improvement benchmarks for heavy-fleet construction accounts.</p>
  <p><strong>Severity.</strong> 5-year average paid severity $9.7K per claim. Skewed by single 2023-24 AL event ($178K I-35 Dallas rear-end). Excluding that outlier, average severity falls to $7.9K. Post-2023, no single loss has exceeded $70K across either line. AL severity clusters at Class 8 rear-end events on interstate corridors (TX/OK/LA); GL severity clusters at dropped-object and tilt-wall property damage.</p>
  <p><strong>Trend.</strong> Both frequency and severity are trending down in the most recent 24-month window. The 2023-24 outlier appears to be a precipitating event for the telematics program rather than a symptom of emerging catastrophic exposure. $20,800 open reserves on 3 open GL claims are within expected range. No pattern shift detected in loss type, geography, or class of activity. Reserves have moved downward over time as claims have matured and closed at or below initial reserve levels.</p>
  <p><strong>Attachment Penetration.</strong> Zero penetration of $1M GL primary or $1M AL CSL over 5 years. Closest approach was 17.8% of AL primary (2023 Dallas rear-end). No claim has approached the requested $2M lead excess attachment — a $2M excess attachment would have absorbed zero dollars of loss in the 5-year period. Residual excess exposure is driven primarily by AL nuclear-verdict corridor risk in TX/OK/LA rather than by frequency-adjusted severity trend. Primary carrier reserving patterns (ratio open-to-paid trending favorable) support reserve adequacy.</p>
</div>

</div>`,

  gl_quote: `**Primary GL Summary**

**Carrier & Administrative:**
- Carrier: Starr Indemnity & Liability Company
- AM Best: A XV
- Form: CG 00 01 04 13
- Policy Period: 05/01/2026 - 05/01/2027
- Named Insured: Meridian Structural Group, LLC
- Total Premium: $384,200

**Coverage Structure:**
- Each Occurrence: $1,000,000
- General Aggregate: $2,000,000
- Products/Completed Operations Aggregate: $2,000,000
- Personal & Advertising Injury: $1,000,000
- Damage to Premises Rented: $300,000
- Medical Expense: $10,000
- Self-Insured Retention: $25,000 per occurrence
- Defense: Outside the limits
- Aggregate Applies: Per Project (CG 25 03)

**Classifications:**
- Code 97655 - Metal Erection–Structural - 62%
- Code 91560 - Concrete Construction (incl. Tilt-Up) - 20%
- Code 91585 - Contractors–Subcontracted Work (Commercial Building) - 15%
- Code 91580 - Contractors–Subcontracted Work (Single/Multiple Dwellings) - 3%

**Key Endorsements Affecting Excess:**
- CG 21 39 - Contractual Liability Limitation - NARROWING: limits insured-contract definition
- CG 22 94 - Exclusion, Damages From Subsidence of Earth - CONCERNING for tilt-wall
- CG 25 03 - Designated Construction Project(s) General Aggregate Limit - ALIGNS with project-based ops
- MANU-001 - Residential 3+ Units New Construction Exclusion - ALIGNS with no-condo representation
- MANU-002 - Crane and Rigging Exclusion DELETED - POSITIVE
- CG 20 10 / CG 20 37 - Blanket Additional Insured - STANDARD

**Source Extracts (verbatim)** + **Checklist** — all fields present. QC passed.`,

  al_quote: `**Primary AL Summary**

**Carrier & Administrative:**
- Carrier: Great American Insurance Group
- AM Best: A+ XV
- Form: CA 00 01 11 20
- Policy Period: 05/01/2026 - 05/01/2027
- Named Insured: Meridian Structural Group, LLC
- Total Premium: $218,400

**Liability Structure:**
- Combined Single Limit: $1,000,000
- Covered Auto Symbol: 1 (Any Auto)
- Hired and Non-Owned: Included
- Medical Payments: $5,000
- UM/UIM: $1,000,000 CSL (Texas stacking applicable)

**Fleet Composition:**
- Class 8 Boom/Flatbed Trucks: 12
- Class 5-7 Stake/Flatbed: 19
- Trailers: 28
- Private Passenger: 9
- Pickup/Service Vehicles: 16
- Mobile Equipment (Cranes): 2

**Garaging & Radius:**
- Primary Garaging: Dallas, TX
- Satellite: Oklahoma City, OK; Albuquerque, NM
- Radius: 500 miles primary; annual long-haul to NY

**Key Endorsements:**
- CA 99 48 - Pollution Liability Broadened Coverage - ALIGNS with cargo/fuel
- CA 23 20 - Fellow Employee Coverage - ALIGNS with multi-crew ops
- CA 99 10 - Drive Other Car - ALIGNS with executive fleet use
- MCS-90 ICC Filing - For hazmat placarded loads (surety-style, not coverage)

**Source Extracts (verbatim)** + **Checklist** — all fields present. QC passed.`,

  excess: `**Underlying Excess Program Tower**

Note: No existing underlying excess layers — this is the lead excess placement at the $2M combined primary attachment.

**Primary Layer:**
- GL Primary: Starr Indemnity - A XV - $1M occ / $2M agg / $2M prod-CO - $384,200 premium
- AL Primary: Great American - A+ XV - $1M CSL - $218,400 premium

**Proposed Lead Excess Layer (Requested):**
- Limit: $5,000,000 combined GL/AL
- Attachment: $2,000,000 combined primary exhaustion
- Effective: 05/01/2026
- Follow-Form Strategy: follow-form over primary GL EXCEPT delete subsidence exclusion (CG 22 94) and broaden contractual liability (CG 21 39); follow-form over primary AL
- Layer structure: $5M xs Primary (single-layer tower)

**Tower Summary:**
- Total Underlying Limits: $2,000,000 combined (no existing underlying excess)
- Tower Coordination: No upper tower - LEAD placement
- Carrier Downgrades: N/A - primary carriers both A/XV or better
- Form Coordination: Follow-form with two specific manuscript departures

**Attachment Coordination Flags:**
- Standard $2M attachment for construction at this revenue band
- Excess layer absorbs all shock losses from $2M to $7M
- Primary GL aggregate on Per Project basis (CG 25 03); excess should clarify aggregate coordination

**Source Extracts (verbatim)** + **Checklist** — all fields present. QC passed.`,

  tower: `<div class="tower-output">

<div class="tower-top-bar">
  <div class="tower-title-group">
    <span class="tower-tag-label">EXCESS TOWER</span>
    <span class="tower-title">Meridian Structural Group · 5/1/2026</span>
  </div>
  <div class="tower-total">$2M primary bound · $5M proposed · tower complete</div>
</div>

<div class="tower-stack">

  <div class="tower-layer proposed">
    <div class="tower-layer-row-1">
      <span class="tower-layer-badge proposed-badge">★ ZURICH</span>
      <span class="tower-layer-carrier">Proposed Quote — Lead Excess</span>
      <span class="tower-layer-limits">$5M xs Primary</span>
    </div>
    <div class="tower-layer-row-2">Follow-form GL+AL · Premium est $85K · AM Best A XV · Attaches at $2M combined primary exhaustion · Compliant with Zurich capacity and attachment guidelines for this class.</div>
  </div>

  <div class="tower-primaries-row">
    <div class="tower-primary">
      <div class="tower-layer-row-1">
        <span class="tower-layer-badge primary-badge">GL</span>
        <span class="tower-layer-carrier">Starr Indemnity</span>
        <span class="tower-layer-limits">$1M / $2M</span>
      </div>
      <div class="tower-layer-row-2">CG 00 01 04 13 · Premium $384,200 · SIR $25K · AM Best A XV · Per-project agg (CG 25 03)</div>
    </div>
    <div class="tower-primary">
      <div class="tower-layer-row-1">
        <span class="tower-layer-badge primary-badge">AL</span>
        <span class="tower-layer-carrier">Great American</span>
        <span class="tower-layer-limits">$1M CSL</span>
      </div>
      <div class="tower-layer-row-2">CA 00 01 · Premium $218,400 · 75 power units · AM Best A+ XV · Symbol 1 covered auto</div>
    </div>
  </div>

</div>

<div class="tower-notes">
  <p><strong>Ask vs Offer.</strong> Broker requested <strong>$5M xs Primary</strong> lead excess from Zurich — a single-layer placement attaching at the $2M combined primary exhaustion. Request is within Zurich E&S Excess Casualty capacity ($5M per layer) and within empowerment thresholds for this class. Compliant Zurich quote: <strong>$5M xs Primary · $85K est premium · Follow-form GL+AL with Additional Insured and Waiver of Subrogation endorsements</strong>.</p>
  <p><strong>Tower Completion.</strong> Tower is <strong>complete at $7M</strong> total ($2M primary + $5M Zurich excess). No additional layers requested by broker. No open capacity to market. If Meridian subsequently needs a higher tower, Zurich is not capacity-capped on upper layers — could support $5M xs $7M or further excess placements at incremental premium.</p>
  <p><strong>Primary Adequacy.</strong> Primary GL ($1M/$2M Starr, A XV) and Primary AL ($1M CSL Great American, A+ XV) both meet Zurich minimums. Combined primary exhaustion at $2M is standard for construction at this revenue band and aligns cleanly with Zurich's lead excess attachment. Verify Employers Liability limit at $500K minimum (not $1M — NOT operating in WV). Per-project aggregate on GL (CG 25 03) coordinates cleanly with excess layer. No corridor gap between primary layers.</p>
</div>

</div>`,

  website: `**Website Intelligence Summary**

**Services Extracted:**
- Structural steel erection
- Tilt-wall concrete construction
- Precast panel installation
- Design-build solutions
- General contracting
- Crane rental and heavy lift services
- Scaffolding erection and rental
- Pre-construction consulting

**Target Markets / Industries:**
- Commercial developers
- Industrial developers
- Multi-family developers

**Geographic Presence:**
- Texas (HQ)
- Southwest (OK, NM, LA, AR, CO)
- Northeast (NY)

**Recent Projects:**
- Frisco Tech Center (TX) - Commercial office - $14M
- Austin Mixed-Use Tower (TX) - Mid-rise residential/retail - $31M
- Santa Fe Resort Lodge (NM) - Hospitality - $22M
- Albany Distribution Center (NY) - Industrial warehouse - $18M

**Certifications / Credentials:**
- AISC Certified Erector (Advanced + Seismic)
- OSHA VPP Star (since 2021)
- ABC STEP Platinum (8 consecutive years)

**Discrepancies vs Application:**
- Crane Rental / Heavy Lift Services promoted on website but NOT disclosed as a service line in the application
- Scaffolding Erection and Rental promoted on website but NOT disclosed in application

**Notable Promotional Claims:**
- Careers page actively recruiting crane operators and scaffolding foremen — reinforces the scope gap

**Source Extracts (verbatim)** + **Checklist** — all fields present. QC passed.`,

  classcode: `**Primary Class Code Match(es):**

- **Code 97655 — Metal Erection–Structural**
  Rationale: Core operation (62% of revenue). Applies directly to erection of structural steel frame for commercial/industrial buildings. Includes welding as incidental. Meridian's description of structural steel erection up to 62 ft in commercial and light-industrial buildings lands squarely in this class.
  NCCI WC cross-reference: 5040 Iron or Steel — Erection — Structural / 5057 Iron or Steel — Erection — NOC.
  NAICS: 238120 Structural Steel and Precast Concrete Contractors.
  SIC: 1791 Structural Steel Erection.

- **Code 91560 — Concrete Construction**
  Rationale: Major secondary operation (20% of revenue — tilt-wall concrete construction). This GL code covers concrete construction including tilt-up wall sections. Tilt-wall panels poured on slab and lifted into place fall under the NCCI WC 5214 code ("Concrete Construction — Erection of Precast and Prestressed Structural Concrete Products or Tilt-Up Wall Sections") which cross-references to GL 91560.
  NCCI WC cross-reference: 5213 Concrete Construction — foundations / 5214 Precast/Tilt-Up Wall Sections.
  NAICS: 238110 Poured Concrete Foundation and Structure Contractors / 238120 Structural Steel and Precast Concrete Contractors.
  SIC: 1771 Concrete Work.

**Alternative / Secondary Codes:**

- **Code 97651 — Metal Erection–Frame Structures Iron Work on Outside of Buildings**
  When to use: If the insured's primary work is specifically the erection of iron/steel frame structures on the EXTERIOR of buildings (vs. overall structural steel framing). Narrower scope than 97655.

- **Code 97653 — Metal Erection–Nonstructural**
  When to use: NOT appropriate for Meridian — their work is load-bearing structural steel. Included here for contrast; would apply to decorative metalwork or non-load-bearing installations only.

- **Code 91585 — Contractors–Subcontracted Work–In Connection with Commercial Building Construction**
  When to use: If Meridian acts as GC on some projects and subs out portions of work (MEP, finishes, roofing). Rated on cost of subcontracted work.

**Split / Multi-Class Considerations:**

Meridian's revenue mix requires a split-rated classification:
- 62% Structural Steel Erection → **97655**
- 20% Tilt-Wall Concrete Construction → **91560**
- 18% Residential Construction (single-family + small multi-family) → requires additional review — if Meridian acts as GC on residential, 91580 (Contractors — Subcontracted Work — In Connection with Construction of Single or Multiple Dwellings) may apply on sub portion; direct residential structural work uses 97655 with residential exclusion endorsement attached

Revenue-based allocation is acceptable for multi-class rating per most ISO filings.

**Underwriting Notes:**

- **Height exposure:** 97655 does not explicitly cap height. At 62 ft, this triggers the Zurich Work-from-Heights guideline (Ch.6) — $5M minimum attachment, $5M max capacity, no NY operations, Level 5 Empowerment for deviation.
- **NY exposure:** 1% Albany operations triggers NY Contracting rules (Ch.6) — $5M min attachment in 5 boroughs, $5M max limit statewide.
- **Class 97655 in appetite** per Chapter 6 (no prohibition), but structural steel erection at height is a severity-driven class with nuclear-verdict exposure in TX, FL, GA, and NY.
- **Bridge Contractor classification** (NCCI 1622 SIC) would apply IF Meridian does bridge work — their description does not indicate bridge work, so standard structural steel applies.
- **Residential 18%:** verify Meridian does NOT exceed 35 single-family home projects/year (Chapter 6 prohibition list). Also confirm no condo construction (hard prohibition).

**Cross-Reference Summary:**
- Primary SIC: 1791 Structural Steel Erection
- Primary NAICS: 238120 Structural Steel and Precast Concrete Contractors
- Primary NCCI WC: 5040 Iron or Steel — Erection — Structural
- Secondary NAICS: 238110 Poured Concrete Foundation (for tilt-wall)

**Source:** InsuranceXDate General Liability Class Codes — https://www.insurancexdate.com/gl.php`,

  exposure: `**Exposure to Loss:**

**Premises Exposure:**
- Jobsite visitor injuries at active construction sites (architects, engineers, owners on walks) — fall-from-elevation, struck-by, trip-and-fall
- Office/regional operating locations — invitee slip/fall, parking lot
- Delivery and vendor personnel on project sites

**Products Exposure:**
- Limited direct — services/installation contractor, not manufacturer
- Installed structural steel and tilt-wall concrete carry component-level product liability on installer-traced defect
- Installed precast panels procured from third parties transfer manufacturing upstream

**Completed Operations Exposure:**
- Long-tail structural failure following project completion — TX statute of repose 10 yrs (§16.009)
- Progressive collapse from latent design/installation defects discovered years later
- Concrete form blowout / tilt-wall cracking to adjacent structures
- Mid-rise residential 18% (Austin mixed-use tower) — envelope/water intrusion tail

**Operations Exposure:**
- Fall-from-elevation during steel erection at 62 ft — severity-skewed; industry leader in excess penetration
- Struck-by / caught-between during crane and rigging ops; borrowed-servant exposure from operated crane leases
- Dropped object / falling material during steel erection and tilt-wall panel placement
- Excavation incidents at 14 ft depth — cave-in, struck-by equipment
- Subsidence PD to adjacent buildings during tilt-wall (primary GL excludes subsidence via CG 22 94)
- NY Labor Law §240/241 absolute-liability exposure (Albany project) — severity risk at 1% operations

**Auto Liability:**
- 12 Class 8 boom trucks in TX/OK/LA nuclear-verdict corridors — rear-underride, downgrade runaway, improper load securement
- 19 Class 5-7 stake/flatbed hauling materials to jobsites
- 28 trailers/lowboys transporting crane components/heavy equipment — securement / detachment claims
- Non-owned/hired from subs and employee vehicles
- Mobile equipment on-road (crane carriers) with permitting/escort requirements

**Severity / Attachment Penetration Flags:**
- Fatality from fall-from-elevation at 62 ft could produce >$5M judgment in NY (§240 absolute liability) or TX
- Class 8 boom truck nuclear verdict in Dallas corridor — pedestrian fatality on I-35 corridor could produce $10M+
- Subsidence to adjacent high-rise during tilt-wall placement — $2M+ PD scenarios plausible
- Crane collapse or dropped load at urban site — potential for $10M+ third-party BI/PD`,

  strengths: `**Strengths:**

**Established expertise in Commercial Structural Construction:**
- 18 years continuous operations since 2008 with consistent focus on structural steel and tilt-wall concrete
- In-house expertise with 68% self-performance — greater operational control than typical GC at this revenue band
- Proven capability on projects up to $31M (Austin Mixed-Use, Santa Fe Resort)
- AISC Certified Erector (Advanced + Seismic) — third-party validation of steel competency

**Commitment to safety:**
- OSHA VPP Star continuously since 2021 — top-tier voluntary protection
- ABC STEP Platinum 8 consecutive years — sustained safety excellence
- 68-page written program rev. January 2026 with full-time CSP/CHST Safety Director (Patricia Chen, 7-year tenure)
- 100% foremen OSHA 30-hour; 100% field OSHA 10-hour
- EMR 0.81 (3-yr avg) materially below 1.00 industry benchmark; TRIR 2.1 below BLS NAICS 236220 average
- Samsara telematics across all Class 5+ fleet; Lytx AI cameras on Class 8 boom trucks

**Strong subcontractor management:**
- Broad-form contractual indemnification with primary and non-contributory AI (CG 20 10 + CG 20 37) on ongoing + completed ops
- Tiered umbrella by trade severity ($5M general; $10M structural/crane/rigging/roofing/electrical)
- Waiver of subrogation on GL, AL, WC
- Third-party COI tracking via myCOI with pre-mobilization verification
- 5-year completed ops tail required of all subs

**Low loss history:**
- 5-year experience shows zero claims penetrating $2M primary attachment
- 40 total claims across GL/AL in 5 years — low frequency relative to $127M revenue and 75-unit fleet
- Total incurred $487K — very low severity
- Largest single loss $178K (AL rear-end, 2023, closed paid) — only 9% of $2M attachment
- Claim frequency trending down since 2023 peak (-55% to 2025) coinciding with Safety Director hire and Samsara telematics deployment
- No fraud patterns or claim clustering anomalies detected`,

  guidelines: `**Source Narrative Operational Details and Listed Products & Services (verbatim):**

Meridian Structural Group, LLC — General contractor specializing in structural steel erection and concrete tilt-wall construction for commercial, light industrial, and select mid-rise residential projects. Maximum height of work: 62 ft. Maximum depth: 14 ft. Operations in AL, GA, NC, SC, FL, TX, and New York (1% — Albany warehouse). Revenue mix: 62% structural steel erection, 20% tilt-wall concrete, 18% residential (single-family + small multi-family, no condo).

Products/Services:
- Structural steel erection (frame structures)
- Tilt-wall concrete construction
- Light industrial construction
- Mid-rise residential construction (single-family, small multi-family)

---

**Operational Detail:** Structural steel erection at heights up to 62 feet (Work from Heights classification)
**State:** All operating states (AL, GA, NC, SC, FL, TX, NY)
**Guideline Conflict:** "Crane, Scaffolding, Window Washers, Glaziers & Masons UW Guideline (Work from Heights) — Minimum $5m ground up attachment point. Maximum capacity of $5m. No operations in New York State. Five or more years of industry experience. $25,000 minimum policy premium. Any deviations to the rules in this guideline require Level 5 Empowerment."
**Explanation of Conflict:** Structural steel frame erection at height falls within the Work from Heights category. Requested $5M lead excess meets the $5M maximum capacity ceiling cleanly. TWO remaining rule conflicts:
(1) Requested $2M attachment violates $5M minimum (Chapter 6 Work from Heights attachment floor).
(2) Stated 1% NY operations directly conflicts with "No operations in New York State" rule for Work from Heights risks.
Both deviations require LEVEL 5 EMPOWERMENT. Referral to Tiffany Fann (Chapter 6 Contact SME) mandatory. Note: $5,000 premium threshold satisfied (est $85K premium) and 18-year industry tenure exceeds 5-year minimum — two of five Chapter 6 checks clear.

---

**Operational Detail:** Operations in New York State (1% — Albany warehouse)
**State:** New York
**Guideline Conflict:** "New York Contracting Operations — $5,000,000 minimum attachment point for any contractor operating in the 5 boroughs of New York City. $5,000,000 maximum limit for any contractor operating in New York State. Maximum limit of $7,500,000 as part of a quota share attaching at $10,000,000 or higher. Exceptions require Head of Zurich E&S empowerment."
**Explanation of Conflict:** Even at 1% of operations, ANY exposure in New York State triggers the NY Contracting rules. Requested $5M lead excess at $2M attachment meets the $5M NY State maximum limit cleanly. Remaining concern: (1) $2M attachment below $5M NY minimum if any 5-boroughs exposure exists. For non-5-boroughs NY exposure (Albany), Designated Operations Exclusion U-EXS-345-B CW may be attached to remove the conflict — but must be explicit. Verify whether Albany warehouse involves any construction/installation/repair or is pure storage.

---

**Product/Service:** Iron or Steel - Erection - Frame Structures (GL Class 91265, SIC 1622)
**State:** All operating states
**Guideline Conflict:** "All bridge contractors require a minimum $5m attachment point." (Applicable if Bridge Contractor classification is used.)
**Explanation of Conflict:** The primary GL classification of the insured determines whether Bridge Contractor rules apply. Class 91265 (Iron or Steel - Erection - Frame Structures) is ONE of the classes listed in the Bridge Contractor guideline. Confirm whether Meridian's GL primary classification code falls under Bridge Contractor bucket. If yes, $5M minimum attachment applies regardless of height.

---

**Operational Detail:** Tilt-wall concrete construction (20% of operations)
**State:** All operating states
**Guideline Conflict:** No conflict identified.
**Explanation of Conflict:** Tilt-wall is within the construction appetite. No explicit prohibition or attachment rule. Subsidence exposure is a primary-level coverage decision (CG 22 94 subsidence exclusion typical).

---

**Operational Detail:** Residential construction 18% — single-family + small multi-family, no condo
**State:** AL (A-state), GA (A-state), NC (A-state), SC (C-state), FL (C-state), TX (C-state)
**Guideline Conflict:** "Business classified as homebuilders (SIC 1521) with more than 35 single family home projects in any 12-month period" (PROHIBITED — Chapter 6 Construction Prohibited list).
**Explanation of Conflict:** CONFIRM home project count. If Meridian performs >35 single-family home projects in any 12-month period AND is classified as homebuilders under SIC 1521, this is a HARD PROHIBITION with no empowerment path. Also: SC, FL, TX are C-states (restricted appetite) on the Residential State Appetite Grid — compare against state-level project volumes.

---

**Operational Detail:** Residential mid-rise (small multi-family, non-condo)
**State:** All
**Guideline Conflict:** Review required against forms U-UMB-433 (Multi-Unit Residential Construction Exclusion) and related exclusion endorsements.
**Explanation of Conflict:** If the Residential Operations Exclusion is to be waived/modified for multi-unit (non-condo) exposure, confirm proper form is on policy. Multi-family is NOT auto-prohibited but mandates explicit form handling (U-UMB-618 / U-EXS-348 for residential-solely-as-rental, etc.).

---

**Request:** $5M xs Primary lead excess
**State:** All
**Guideline Conflict:** "Policy Limits: Up to $10,000,000 (Levels 1-4). $12,500,000 if p/o 50% quota share excess of $10m ground up."
**Explanation of Conflict:** Requested $5M single-layer lead limit is well within the $10M Level 1-4 capacity cap. However, "Lead" placement is a specific Level 5 Empowerment item per Chapter 1 General Referral Triggers regardless of limit size — elevate to Level 5 for sign-off.

---

**Underlying Program:** Primary GL $1M/$2M (Starr Indemnity), Primary AL $1M CSL (Great American)
**State:** All
**Guideline Conflict:** No conflict identified on underlying limits. "Minimum UL Limit for Employers Liability & Stop Gap: $500,000 / $500,000 / $500,000 (WV requires $1M/$1M/$1M)."
**Explanation of Conflict:** Primary GL meets minimum. Primary AL meets minimum. Verify Employers Liability limit meets $500K minimum (or $1M in WV — does Meridian operate in WV? Not listed in operational states). Confirm A.M. Best ratings A-/VII or better for both Starr and Great American.

---

**QUALITY-CONTROL CHECKLIST — Step 2**

✔ Structural steel erection - AL, GA, NC, SC, FL, TX, NY
✔ Tilt-wall concrete construction - All operating states
✔ Light industrial construction - All operating states
✔ Mid-rise residential (single-family / small multi-family) - AL, GA, NC, SC, FL, TX
✔ Work from Heights (62 ft) - All operating states
✔ NY operations (1% Albany) - New York
✔ Class 91265 Iron/Steel Frame Erection - All operating states
✔ Requested $5M xs Primary structure - All states
✔ Underlying program adequacy - All states

All operational details and products cross-referenced against guidelines for every identified state. Step 2 checklist 100% ✔. No rewrite required.

---

**Referral Triggers:**
- Work from Heights deviation (62 ft, structural steel frame): requires LEVEL 5 EMPOWERMENT → Tiffany Fann
- Lead excess placement (any limit): LEVEL 5 EMPOWERMENT per Chapter 1 (Lead is a named Level 5 item)
- $2M attachment vs $5M Work-from-Heights minimum: LEVEL 5 EMPOWERMENT required if deviating from attachment floor
- NY State operations conflicts with "No operations in New York State" for Work from Heights: LEVEL 5 EMPOWERMENT required for deviation, OR attach U-EXS-345 Designated Operations Exclusion for NY

**Prohibited Exposures:**
- None hard-prohibited AS DESCRIBED, pending confirmation of:
  (1) Single-family home project count stays ≤35/year (Chapter 6 prohibition list)
  (2) Insured is not classified as SIC 1521 homebuilder above the 35-project threshold

**Minimum Attachment Requirements:**
- Work from Heights rule: $5M minimum — NOT met by requested $2M attachment
- NY 5-boroughs (if applicable): $5M minimum — NOT met unless Albany confirmed as non-5-boroughs
- Bridge Contractor class (if 91265 is primary): $5M minimum — NOT met by requested $2M`,

  email: `Subject: Meridian Structural Group, LLC — 5/1/2026 — Referral for Senior UW Approval

Hi team,

Requesting senior UW review and approval on the following account:

Account: Meridian Structural Group, LLC
Effective: 5/1/2026
Excess Target: $5M xs Primary
Broker: AmWINS (Rachel Tran)

Recommendation: Quote with conditions — 2 referral triggers require Senior UW approval.

Referral Triggers:
1. Maximum height of work 62 ft exceeds 40 ft no-referral threshold per Section 5.1. Height-in-Excess Questionnaire attached.
2. NY Labor Law §240/241 exposure (1% ops, Albany warehouse) triggers mandatory referral per Section 6.1.

Key Positives:
- OSHA VPP Star since 2021; ABC STEP Platinum 8 consecutive years; AISC Certified Erector
- EMR 0.81 / TRIR 2.1 — 19%+ better than NAICS 236220 benchmark
- Broad-form hold-harmless + primary and non-contributory AI + tiered umbrella by trade severity

Loss History: 40 claims over 5 years ($487K incurred). Zero penetration of $2M primary attachment. Largest loss $178K (17.8% of AL primary). Frequency -55% from 2023 peak after Samsara telematics deployment.

Full workbench brief attached (generated by Speed to Market AI). Every fact cited to source. Pipeline run #[RUN_ID], model [MODEL], prompts v2.4.

Please advise.

Thanks,
Justin`,

  email_intel: `**Broker Email Intel Extract**

**Named Insured / Entity:**
- Value: Meridian Structural Group, LLC
- Broker's Words: "Please find attached the renewal submission for Meridian Structural Group, LLC, effective 5/1/2026."

**Effective Date:**
- Value: 5/1/2026
- Broker's Words: "effective 5/1/2026"

**Requested Coverage:**
- Limit: $5,000,000
- Attachment: $2,000,000
- Broker's Words: "Client is seeking a $5M lead excess at $2M attachment"

**Operations Mentioned:**
- Steel erection (primary discipline)
- Tilt-wall concrete
- "Most work is steel frame erection on commercial projects in Texas and surrounding states, with some tilt-wall."

**States / Geographic Spread:**
- Primarily TX, also OK, LA, AR
- Broker's Words: "Ops are mostly Texas with some surrounding southwest states"

**Fleet Details:**
- Power Units: ~75 per broker
- Broker's Words: "fleet of about 75 trucks, mostly Class 8 tractors and crew trucks"

**Size Indicators:**
- Revenue: ~$127M per broker
- Broker's Words: "around $127M in revenue last year"

**Loss / Safety Mentions:**
- EMR mentioned as 0.85
- Broker's Words: "EMR of 0.85, clean loss history last 3 years"

**Summary for Pipeline:**
Broker email provides operational context for Meridian Structural: steel erection primary, TX-centric with regional spread, ~75-unit fleet per broker claim (unverified against AL quote), $127M revenue, EMR 0.85 per broker. Discrepancy module should cross-check fleet count against the AL quote and loss history claims against the loss runs.

**Source Extracts (verbatim)**
- "Please find attached the renewal submission for Meridian Structural Group, LLC, effective 5/1/2026."
- "Client is seeking a $5M lead excess at $2M attachment"
- "Most work is steel frame erection on commercial projects in Texas and surrounding states, with some tilt-wall."
- "fleet of about 75 trucks, mostly Class 8 tractors and crew trucks"
- "around $127M in revenue last year"
- "EMR of 0.85, clean loss history last 3 years"

**Checklist**
Named Insured ✔ · Effective ✔ · Requested ✔ · Operations ✔ · States ✔ · Fleet ✔ · Size ✔ · Loss/Safety ✔`,

  discrepancy: `<div class="discrepancy-output">

<div class="disc-header">
  <div class="disc-header-label">Cross-Check Result</div>
  <div class="disc-header-summary">4 matches · 1 minor variance · 1 material conflict</div>
</div>

<div class="disc-section">
  <div class="disc-section-title">Material Conflicts</div>
  <div class="disc-row disc-material" data-flag-id="c1">
    <div class="disc-row-icon">✕</div>
    <div class="disc-row-body">
      <div class="disc-row-field">Fleet power units</div>
      <div class="disc-row-compare">
        <div class="disc-compare-side disc-broker">
          <span class="disc-compare-label">Broker said</span>
          <span class="disc-compare-value">"fleet of about 75 trucks, mostly Class 8 tractors and crew trucks"</span>
        </div>
        <div class="disc-compare-side disc-auth">
          <span class="disc-compare-label">Primary AL Quote (A13)</span>
          <span class="disc-compare-value">47 power units scheduled · 12 Class 8 tractors · 35 crew trucks / pickups</span>
        </div>
      </div>
      <div class="disc-row-explanation">Broker claim is 59% higher than the scheduled units on the AL quote. If broker expected a 75-unit exposure, premium basis is understated. Verify fleet count with broker before binding.</div>
    </div>
    <button class="disc-dismiss" onclick="dismissDiscrepancyFlag('c1')">Clear flag</button>
  </div>
</div>

<div class="disc-section">
  <div class="disc-section-title">Minor Variances</div>
  <div class="disc-row disc-minor" data-flag-id="m1">
    <div class="disc-row-icon">⚠</div>
    <div class="disc-row-body">
      <div class="disc-row-field">EMR (Experience Modification Rate)</div>
      <div class="disc-row-compare">
        <div class="disc-compare-side disc-broker">
          <span class="disc-compare-label">Broker said</span>
          <span class="disc-compare-value">"EMR of 0.85"</span>
        </div>
        <div class="disc-compare-side disc-auth">
          <span class="disc-compare-label">Safety Manual (A5)</span>
          <span class="disc-compare-value">Current EMR 0.81 (effective 1/1/2026)</span>
        </div>
      </div>
      <div class="disc-row-explanation">4-point rounding or stale data — broker likely quoting prior-year EMR. Use 0.81 from safety manual.</div>
    </div>
    <button class="disc-dismiss" onclick="dismissDiscrepancyFlag('m1')">Clear flag</button>
  </div>
</div>

<div class="disc-section">
  <div class="disc-section-title">Matches</div>
  <div class="disc-row disc-match">
    <div class="disc-row-icon">✓</div>
    <div class="disc-row-body">
      <div class="disc-row-field">Named Insured</div>
      <div class="disc-row-match-note">Broker's "Meridian Structural Group, LLC" aligns with Supplemental Application.</div>
    </div>
  </div>
  <div class="disc-row disc-match">
    <div class="disc-row-icon">✓</div>
    <div class="disc-row-body">
      <div class="disc-row-field">Effective Date</div>
      <div class="disc-row-match-note">Broker's 5/1/2026 aligns with GL Quote policy period start.</div>
    </div>
  </div>
  <div class="disc-row disc-match">
    <div class="disc-row-icon">✓</div>
    <div class="disc-row-body">
      <div class="disc-row-field">Requested Limits</div>
      <div class="disc-row-match-note">Broker's $5M xs $2M aligns with Supplemental Application request.</div>
    </div>
  </div>
  <div class="disc-row disc-match">
    <div class="disc-row-icon">✓</div>
    <div class="disc-row-body">
      <div class="disc-row-field">Primary Operations</div>
      <div class="disc-row-match-note">Broker's "steel frame erection" + "tilt-wall" aligns with Supplemental operations description.</div>
    </div>
  </div>
</div>

</div>`
};

// ============================================================================
// PIPELINE DAG + CLASSIFIER + INCREMENTAL — moved to pipeline.js (Phase 8 step 6).
// Loaded via <script src="pipeline.js"> in <head>.
// ============================================================================

// ============================================================================
// AUDIT LOG — every LLM call, file event, export action
// ============================================================================
function logAudit(actor, action, meta) {
  STATE.audit.push({
    time: new Date().toISOString().slice(11, 19),
    actor, action, meta: meta || '—',
    ts: Date.now()
  });
  renderAuditIfOpen();
  // Phase 6 step 1: also persist to Supabase audit_events (fire-and-forget).
  // Never blocks, never throws, silently no-ops when not signed in. See
  // sbLogAuditEvent for the safety rules — including: this helper is
  // forbidden from calling logAudit() itself (would recurse forever).
  if (typeof sbLogAuditEvent === 'function') {
    sbLogAuditEvent(actor, action, meta);
  }
}

function renderAuditIfOpen() {
  // Phase 6 step 7: admins use renderAdminAuditLog (cloud-backed). This
  // function only paints session-local STATE.audit for non-admin users.
  // Admin view refreshes on Admin tab open and on explicit Refresh click —
  // not on every logAudit() fire, to avoid hammering the DB.
  if (window.currentUser && window.currentUser.role === 'admin') return;

  const el = document.getElementById('auditEntries');
  // Update the count badge in the header (shown whether collapsed or expanded —
  // the UW can see at a glance how many events there are before expanding).
  const countEl = document.getElementById('auditCount');
  if (countEl) countEl.textContent = STATE.audit.length > 0 ? '· ' + STATE.audit.length + ' event' + (STATE.audit.length === 1 ? '' : 's') : '';
  if (!el) return;
  if (STATE.audit.length === 0) {
    el.innerHTML = '<div style="padding: 30px 18px; text-align: center; color: var(--text-3); font-size: 12px;">No events yet. Upload files and run the pipeline to populate the audit log.</div>';
    return;
  }
  // Newest first, limit 200
  const recent = STATE.audit.slice(-200).reverse();
  el.innerHTML = recent.map(e => `
    <div class="audit-entry">
      <span class="audit-time">${e.time}</span>
      <span class="audit-actor">${escapeHtml(e.actor)}</span>
      <span class="audit-action">${escapeHtml(e.action)}</span>
      <span class="audit-ver">${escapeHtml(e.meta)}</span>
    </div>
  `).join('');
}

// Toggle the Live Audit Log panel. Defaults to collapsed so it doesn't dominate
// the Admin view — the event count in the header tells the UW how many items
// are waiting, they expand when they want to dig in.
function toggleAuditLog() {
  const container = document.getElementById('auditLogContainer');
  if (container) container.classList.toggle('collapsed');
}

// refreshAudit moved to admin-views.js (Phase 8 step 4).

// Export audit log. Admin mode exports the currently-loaded cloud rows under
// the active filter (with a marker noting what was filtered); non-admin mode
// exports session-local STATE.audit (legacy behavior).
function exportAudit() {
  const isAdmin = !!(window.currentUser && window.currentUser.role === 'admin');
  let rows, source, filter;
  if (isAdmin) {
    rows = (STATE.adminAudit.rows || []).map(r => ({
      created_at:    r.created_at,
      category:      r.category,
      message:       r.message,
      meta:          r.meta,
      user_id:       r.user_id,
      submission_id: r.submission_id
    }));
    source = 'supabase.public.audit_events';
    filter = STATE.adminAudit.category;
  } else {
    rows = STATE.audit || [];
    source = 'session_state';
    filter = null;
  }
  if (rows.length === 0) { toast('No audit events to export', 'warn'); return; }
  const payload = {
    source: source,
    filter_category: filter,
    generated_at: new Date().toISOString(),
    event_count: rows.length,
    events: rows
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'stm_audit_' + (isAdmin ? 'cloud_' : '') + Date.now() + '.json';
  a.click();
  URL.revokeObjectURL(url);
  toast((isAdmin ? 'Cloud audit JSON · ' : 'Audit JSON · ') + rows.length + ' events');
}

// ============================================================================
// EXCEL PACK EXPORT — real .xlsx with per-module tabs + summary + audit
// ============================================================================
function exportExcel() {
  if (Object.keys(STATE.extractions).length === 0) {
    toast('Run pipeline first', 'warn');
    return;
  }
  if (typeof XLSX === 'undefined') {
    toast('SheetJS not loaded — check internet connection', 'error');
    return;
  }

  const wb = XLSX.utils.book_new();
  const now = new Date();

  // ---- TAB 1: Executive Summary ----
  const summaryRows = [
    ['SPEED TO MARKET AI — EXECUTIVE SUMMARY'],
    [],
    ['Pipeline Run', STATE.pipelineRun || '—'],
    ['Generated', now.toISOString()],
    ['Provider', 'ANTHROPIC'],
    ['Model', STATE.api.model],
    ['Prompts Version', 'v2.4'],
    ['Files Ingested', STATE.files.length],
    ['Modules Completed', Object.keys(STATE.extractions).length + ' / ' + Object.keys(MODULES).length],
    ['Audit Events', STATE.audit.length],
    [],
    ['MODULES COMPLETED'],
    ['Code', 'Module', 'Source', 'Confidence', 'Timing (s)', 'Mode']
  ];
  Object.entries(STATE.extractions).forEach(([mid, ext]) => {
    summaryRows.push([
      MODULES[mid].code,
      MODULES[mid].name,
      ext.sourceInfo || '—',
      Math.round(ext.confidence * 100) + '%',
      ext.timing.toFixed(1),
      ext.mode
    ]);
  });
  summaryRows.push([]);
  summaryRows.push(['FILES INGESTED']);
  summaryRows.push(['Filename', 'Size (KB)', 'Classification', 'Confidence', 'Routed To', 'State']);
  STATE.files.forEach(f => {
    summaryRows.push([
      f.name,
      Math.round(f.size / 1024),
      f.classification || 'unknown',
      f.confidence ? Math.round(f.confidence * 100) + '%' : '—',
      f.routedTo ? MODULES[f.routedTo].code : '—',
      f.state
    ]);
  });
  const summaryWS = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWS['!cols'] = [{ wch: 14 }, { wch: 34 }, { wch: 36 }, { wch: 14 }, { wch: 12 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, summaryWS, 'Summary');

  // ---- TAB N: One tab per completed module ----
  const addedSheetNames = new Set(['Summary']);
  Object.entries(STATE.extractions).forEach(([mid, ext]) => {
    if (STATE.hiddenCards[mid]) return;  // skip hidden cards
    const m = MODULES[mid];
    const isEdited = STATE.edits[mid] && STATE.edits[mid].htmlOverride;
    const effectiveText = getEffectiveText(mid);
    const rows = [
      [m.code + ' — ' + m.name + (isEdited ? '  (EDITED)' : '')],
      [],
      ['Confidence', Math.round(ext.confidence * 100) + '%'],
      ['Timing', ext.timing.toFixed(1) + 's'],
      ['Source', ext.sourceInfo || '—'],
      ['Mode', ext.mode],
      ['Edited', isEdited ? 'YES · ' + new Date(STATE.edits[mid].editedAt).toISOString() : 'no'],
      ['Generated', now.toISOString()],
      [],
      ['--- EXTRACTION OUTPUT ---'],
      []
    ];
    // Split effective text into rows (one line per row)
    effectiveText.split('\n').forEach(line => rows.push([line]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 110 }, { wch: 30 }];
    let sheetName = (m.code + '_' + m.name).slice(0, 31).replace(/[\\\/\[\]\*\?:]/g, '_');
    let suffix = 1;
    const baseName = sheetName;
    while (addedSheetNames.has(sheetName)) {
      sheetName = baseName.slice(0, 29) + '_' + suffix;
      suffix++;
    }
    addedSheetNames.add(sheetName);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  // ---- Custom cards get their own tabs ----
  STATE.customCards.forEach((cc, idx) => {
    if (STATE.hiddenCards[cc.id]) return;
    const text = getCustomText(cc);
    const rows = [
      ['CUSTOM · ' + cc.title],
      [],
      ['Created', new Date(cc.createdAt).toISOString()],
      ['Edited', new Date(cc.editedAt).toISOString()],
      [],
      ['--- CONTENT ---'],
      []
    ];
    text.split('\n').forEach(line => rows.push([line]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 110 }, { wch: 30 }];
    let sheetName = ('CUSTOM_' + (cc.title || 'Note') + '_' + (idx + 1)).slice(0, 31).replace(/[\\\/\[\]\*\?:]/g, '_');
    let suffix = 1;
    while (addedSheetNames.has(sheetName)) {
      sheetName = sheetName.slice(0, 29) + '_' + suffix;
      suffix++;
    }
    addedSheetNames.add(sheetName);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  // ---- TAB LAST: Audit trail ----
  const auditRows = [
    ['AUDIT TRAIL'],
    [],
    ['Pipeline Run', STATE.pipelineRun || '—'],
    ['Total Events', STATE.audit.length],
    [],
    ['Timestamp', 'Actor', 'Action', 'Model / Version']
  ];
  STATE.audit.forEach(e => {
    auditRows.push([e.time, e.actor, e.action, e.meta]);
  });
  const auditWS = XLSX.utils.aoa_to_sheet(auditRows);
  auditWS['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 80 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, auditWS, 'Audit');

  const filename = 'stm_pack_' + (STATE.pipelineRun || Date.now()) + '.xlsx';
  XLSX.writeFile(wb, filename);
  logAudit('Export', 'Exported Excel pack · ' + Object.keys(STATE.extractions).length + ' tabs · ' + filename, STATE.api.model);
  toast('Excel pack downloaded · ' + filename);
}

// ============================================================================
// COPY REFERRAL EMAIL — copies the composed email to clipboard
// ============================================================================
async function copyReferralEmail() {
  const emailExt = STATE.extractions.email;
  if (!emailExt) { toast('No referral email — run pipeline first', 'warn'); return; }
  // Use the edited text if present, falling back to the original extraction
  let text = getEffectiveText('email');
  // Substitute placeholders with live values
  text = text
    .replace(/\[RUN_ID\]|\{RUN_ID\}/g, STATE.pipelineRun || 'unknown')
    .replace(/\[MODEL\]|\{MODEL\}/g, STATE.api.model);
  try {
    await navigator.clipboard.writeText(text);
    logAudit('Export', 'Copied referral email to clipboard' + (STATE.edits.email ? ' (edited)' : ''), '—');
    toast('Referral email copied' + (STATE.edits.email ? ' (edited version)' : ''));
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('Referral email copied (fallback method)'); }
    catch (e) { toast('Could not copy — selecting text instead', 'error'); }
    document.body.removeChild(ta);
  }
}

// ============================================================================
// MARKDOWN EXPORT — dump all extractions as a single .md file
// ============================================================================
function exportMarkdown() {
  if (Object.keys(STATE.extractions).length === 0 && STATE.customCards.length === 0) {
    toast('Run pipeline first (or add a custom card)', 'warn');
    return;
  }
  let md = '# SPEED TO MARKET AI — UNDERWRITING SUMMARY\n\n';
  md += '**Pipeline Run:** ' + (STATE.pipelineRun || '—') + '\n';
  md += '**Generated:** ' + new Date().toISOString() + '\n';
  md += '**Provider:** ' + ('ANTHROPIC') + '\n';
  md += '**Model:** ' + (STATE.api.model) + '\n';
  md += '**Prompts Version:** v2.4\n';
  md += '**Files Ingested:** ' + STATE.files.length + '\n';
  md += '**Modules Completed:** ' + Object.keys(STATE.extractions).length + ' / ' + Object.keys(MODULES).length + '\n';
  const editedCount = Object.keys(STATE.edits).length;
  const customCount = STATE.customCards.filter(cc => !STATE.hiddenCards[cc.id]).length;
  if (editedCount > 0) md += '**Edited Cards:** ' + editedCount + '\n';
  if (customCount > 0) md += '**Custom Cards:** ' + customCount + '\n';
  md += '\n---\n\n';

  // Extraction cards in CARD_ORDER, skipping hidden
  const order = (typeof CARD_ORDER !== 'undefined') ? CARD_ORDER : Object.keys(STATE.extractions);
  order.filter(mid => STATE.extractions[mid] && !STATE.hiddenCards[mid]).forEach(mid => {
    const m = MODULES[mid];
    const ext = STATE.extractions[mid];
    const isEdited = STATE.edits[mid] && STATE.edits[mid].htmlOverride;
    md += '## ' + m.code + ' — ' + m.name + (isEdited ? ' (edited)' : '') + '\n\n';
    md += '_Confidence: ' + Math.round(ext.confidence * 100) + '% · ';
    md += 'Timing: ' + ext.timing.toFixed(1) + 's · ';
    md += 'Source: ' + (ext.sourceInfo || '—') + ' · ';
    md += 'Mode: ' + ext.mode;
    if (isEdited) md += ' · Edited: ' + new Date(STATE.edits[mid].editedAt).toISOString();
    md += '_\n\n';
    md += getEffectiveText(mid) + '\n\n---\n\n';
  });

  // Custom cards
  STATE.customCards.filter(cc => !STATE.hiddenCards[cc.id]).forEach(cc => {
    md += '## CUSTOM — ' + cc.title + '\n\n';
    md += '_Added: ' + new Date(cc.createdAt).toISOString() + '_\n\n';
    md += getCustomText(cc) + '\n\n---\n\n';
  });

  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'stm_summary_' + (STATE.pipelineRun || Date.now()) + '.md';
  a.click();
  URL.revokeObjectURL(url);
  logAudit('Export', 'Exported markdown summary · ' + (Object.keys(STATE.extractions).length + customCount) + ' sections', '—');
  toast('Markdown downloaded');
}

// ============================================================================
// PIPELINE ORCHESTRATOR — moved to pipeline.js (Phase 8 step 6).
// Loaded via <script src="pipeline.js"> in <head>.
// ============================================================================
// ============================================================================
// ADAPTIVE LAYOUT — observe sub-layout's actual width and add .is-narrow class
// when 3 columns won't fit. More reliable than viewport media queries, which
// break inside iframes / split-preview contexts where viewport width doesn't
// match the rendered container width.
// Threshold: 3 columns need at least 300+260+520+32 = 1112px minimum comfortable
// width. Below that, stack vertically.
// ============================================================================
(function initAdaptiveLayout() {
  const NARROW_BREAKPOINT = 1100;
  const subLayout = document.querySelector('.sub-layout');
  if (!subLayout) return;

  const applyClass = (width) => {
    if (width < NARROW_BREAKPOINT) {
      subLayout.classList.add('is-narrow');
    } else {
      subLayout.classList.remove('is-narrow');
    }
  };

  // Initial measurement on next frame (after layout is computed)
  requestAnimationFrame(() => {
    applyClass(subLayout.offsetWidth);
  });

  // Observe container width changes (window resize, pane toggle, etc.)
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        applyClass(entry.contentRect.width);
      }
    });
    ro.observe(subLayout);
  } else {
    // Fallback for older browsers
    window.addEventListener('resize', () => applyClass(subLayout.offsetWidth));
  }
})();


// ============================================================================
// HTML SANITIZER — for raw HTML emitted by the Loss / Tower / Discrepancy
// modules. Defends against prompt-injection XSS where a malicious broker
// document could trick the model into emitting <script>, on*= handlers, or
// javascript: URLs. We use the browser's own DOMParser (no external libs) and
// walk the tree, allowlisting tags + attributes and dropping anything else.
// ============================================================================
const SAFE_TAGS = new Set([
  'div', 'span', 'p', 'br', 'hr', 'strong', 'em', 'b', 'i', 'u', 'small', 'sub', 'sup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'figure', 'figcaption', 'blockquote', 'code', 'pre',
  'svg', 'g', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'marker',
  'a', 'abbr', 'mark', 'time'
]);
// Per-attribute allowlist. Keep narrow — anything not on this list is dropped.
// Phase 8.5 round 3 fix #8: ALL entries lowercase. The walker lowercases
// attr.name before the allowlist check (line ~3852), so mixed-case entries
// like 'viewBox' / 'markerWidth' / 'refX' would never match and would be
// stripped — breaking SVG rendering for any future card that uses them.
// Pure rendering robustness fix; not security.
const SAFE_ATTRS = new Set([
  'class', 'id', 'title', 'colspan', 'rowspan', 'datetime', 'data-mid',
  // SVG geometry (used by tower diagrams)
  'viewbox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'd', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity',
  'text-anchor', 'dominant-baseline', 'font-size', 'font-weight', 'font-family',
  'xmlns', 'preserveaspectratio', 'orient', 'markerwidth', 'markerheight', 'refx', 'refy'
]);

function sanitizeModelHtml(html) {
  if (!html || typeof html !== 'string') return '';
  try {
    // Parse in a sandboxed document — DOMParser does not execute scripts and
    // does not load external resources during parsing.
    const doc = new DOMParser().parseFromString('<div id="__root__">' + html + '</div>', 'text/html');
    const root = doc.getElementById('__root__');
    if (!root) return '';

    // Walk every element. Strip disallowed tags entirely. For allowed tags,
    // strip every disallowed attribute and any href that isn't http(s)/mailto/tel/relative.
    const walk = (el) => {
      // Snapshot children first (live NodeList changes during removal)
      const children = Array.from(el.children);
      for (const child of children) {
        const tag = (child.tagName || '').toLowerCase();
        if (!SAFE_TAGS.has(tag)) {
          // Remove the element entirely (including descendants). We don't try
          // to preserve text content from inside a <script> — too risky.
          child.remove();
          continue;
        }
        // Strip every attribute that isn't on the allowlist, plus any on*= handler
        const attrs = Array.from(child.attributes);
        for (const attr of attrs) {
          const name = attr.name.toLowerCase();
          // Always strip event handlers (onclick, onerror, onload, onmouseover, etc.)
          if (name.startsWith('on')) { child.removeAttribute(attr.name); continue; }
          // Style attributes can hide expressions or url(javascript:); drop them.
          // (The 3 cards rely on classes from app CSS, not inline styles.)
          if (name === 'style') { child.removeAttribute(attr.name); continue; }
          // Anchor href — only allow safe protocols
          if (tag === 'a' && name === 'href') {
            const v = (attr.value || '').trim().toLowerCase();
            const safe = v.startsWith('http://') || v.startsWith('https://') ||
                         v.startsWith('mailto:') || v.startsWith('tel:') ||
                         v.startsWith('/') || v.startsWith('#') || v.startsWith('?');
            if (!safe) { child.removeAttribute(attr.name); continue; }
            // Force noopener on external links
            if (v.startsWith('http://') || v.startsWith('https://')) {
              child.setAttribute('target', '_blank');
              child.setAttribute('rel', 'noopener noreferrer');
            }
            continue;
          }
          // Any other attribute not on the allowlist → drop
          if (!SAFE_ATTRS.has(name)) { child.removeAttribute(attr.name); continue; }
          // Final defense: strip javascript: from any remaining attribute value
          if (typeof attr.value === 'string' && /javascript\s*:/i.test(attr.value)) {
            child.removeAttribute(attr.name);
          }
        }
        walk(child);
      }
    };
    walk(root);
    return root.innerHTML;
  } catch (e) {
    console.warn('sanitizeModelHtml failed, returning escaped fallback', e);
    // Fallback: render as escaped text so worst case is "ugly card" not "XSS"
    return (html || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

// ============================================================================
// MARKDOWN → HTML RENDERER — converts extraction output to HTML
// ============================================================================
function renderMarkdown(md) {
  if (!md) return '';

  // === Markdown tables (must process BEFORE general HTML escape so pipes don't get mangled) ===
  // Detect blocks of consecutive lines starting/ending with | that contain a separator row like |---|---|
  const tableBlocks = [];
  const lines = md.split('\n');
  let i = 0;
  const processedLines = [];
  while (i < lines.length) {
    const line = lines[i];
    // Table candidate: starts with |, followed by a line that's |---|---| separator
    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      // Collect all consecutive table rows
      const headerRow = line;
      const separator = lines[i + 1];
      const rows = [];
      let j = i + 2;
      while (j < lines.length && /^\s*\|.+\|\s*$/.test(lines[j])) {
        rows.push(lines[j]);
        j++;
      }
      // Build HTML table
      const parseCells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const headers = parseCells(headerRow);
      const bodyRows = rows.map(parseCells);
      // Phase 8.5 fix #2: escape cell content before HTML insertion. The general
      // escape pass below runs AFTER tables are pulled into placeholders, so
      // without per-cell escaping a markdown table cell containing raw HTML
      // (worst case: prompt-injected <img onerror=…> from a broker doc) would
      // render live. PROMPT_INJECTION_DEFENSE makes this unlikely; escaping here
      // is defense-in-depth.
      const escCell = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      let tableHtml = '<div class="md-table-wrap"><table class="md-table">';
      tableHtml += '<thead><tr>' + headers.map(h => `<th>${escCell(h)}</th>`).join('') + '</tr></thead>';
      tableHtml += '<tbody>' + bodyRows.map(r => {
        return '<tr>' + r.map((cell, idx) => {
          // Right-align cells that look like dollar amounts, percentages, or numbers
          const isNumeric = /^[\$\d\-—.,%()]+$/.test(cell) || /^\d+[%$]?$/.test(cell);
          const align = (isNumeric && idx > 0) ? ' style="text-align: right; font-variant-numeric: tabular-nums;"' : '';
          return `<td${align}>${escCell(cell)}</td>`;
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
      // Replace with a placeholder so the rest of the pipeline doesn't touch it
      const placeholder = `@@MDTABLE${tableBlocks.length}@@`;
      tableBlocks.push(tableHtml);
      processedLines.push(placeholder);
      i = j;
    } else {
      processedLines.push(line);
      i++;
    }
  }
  md = processedLines.join('\n');

  let html = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Bold
  html = html.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr>');
  // Headings (#, ##, ###)
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  // Bullet lines (- or *)
  html = html.replace(/^(\s*)[-*]\s+(.+)$/gm, '<li>$2</li>');
  // Wrap consecutive <li> blocks in <ul>
  html = html.replace(/(<li>[\s\S]*?<\/li>)(?=\s*(?!<li>))/g, m => '<ul>' + m + '</ul>');
  html = html.replace(/<\/ul>\s*<ul>/g, '');
  // Paragraph-ize remaining blocks separated by blank lines
  html = html.split(/\n\n+/).map(block => {
    const trim = block.trim();
    if (!trim) return '';
    if (trim.match(/^<(h\d|ul|ol|li|hr|table|div|p|pre)/i)) return block;
    if (trim.match(/^@@MDTABLE\d+@@$/)) return block;
    return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
  }).join('\n');
  // Restore table placeholders
  tableBlocks.forEach((tableHtml, idx) => {
    html = html.replace(`@@MDTABLE${idx}@@`, tableHtml);
  });
  // QC markers — ✔/✖/✓/✗ → styled spans
  html = html.replace(/[✔✓]/g, '<span class="qc-check">✔</span>');
  html = html.replace(/[✖✗]/g, '<span class="qc-fail">✖</span>');
  return html;
}

// ============================================================================
// SUMMARY CARD RENDERER — dynamic cards driven by STATE.extractions
// ============================================================================
// Display order for cards — discrepancy sits at the top (decision-critical info)
// then the account overview, then analysis, then the raw extractions.
const CARD_ORDER = [
  'discrepancy',
  'summary-ops', 'guidelines', 'losses', 'tower',
  'exposure', 'strengths', 'classcode',
  'supplemental', 'subcontract', 'vendor', 'safety',
  'gl_quote', 'al_quote', 'excess', 'website',
  'email_intel'
];
// Which cards render full-width (rich/dense content benefits from width)
const FULL_WIDTH = new Set(['discrepancy', 'summary-ops', 'guidelines', 'losses', 'tower', 'exposure', 'strengths', 'email_intel']);

function renderSummaryCards() {
  const container = document.getElementById('summaryCards');
  if (!container) return;

  const extractedIds = CARD_ORDER.filter(mid => STATE.extractions[mid]);

  // Update summary header stats
  const sm = document.querySelector('.summary-meta-text');
  if (sm) {
    const count = extractedIds.length;
    const avgConf = count > 0
      ? Math.round(extractedIds.reduce((a, mid) => a + STATE.extractions[mid].confidence, 0) / count * 100) + '%'
      : '—';
    const totalTime = count > 0
      ? extractedIds.reduce((a, mid) => a + STATE.extractions[mid].timing, 0).toFixed(1) + 's'
      : '—';
    const editedCount = Object.keys(STATE.edits).length + STATE.customCards.length;
    const editedSuffix = editedCount > 0 ? ` · <strong style="color: var(--warning);">${editedCount} edited</strong>` : '';
    sm.innerHTML = `<strong>${count}/${Object.keys(MODULES).length} modules</strong> · extraction time <strong>${totalTime}</strong> · avg confidence <strong>${avgConf}</strong>${editedSuffix}`;
  }

  if (extractedIds.length === 0 && STATE.customCards.length === 0) {
    container.innerHTML = '<div style="padding: 60px 20px; text-align: center; color: var(--text-3); grid-column: 1 / -1;"><div style="font-family: var(--font-display); font-size: 42px; font-style: italic; color: var(--line-warm); margin-bottom: 10px;">◇</div><p>No extractions yet. Run the pipeline first — or click <strong>+ Add Custom Note</strong> below to start with a blank card.</p></div>';
    updateHiddenTray();
    return;
  }

  const cards = [];

  // Extraction cards (skip hidden)
  extractedIds.forEach(mid => {
    if (STATE.hiddenCards[mid]) return;
    cards.push(renderExtractionCard(mid));
  });

  // Custom cards (skip hidden)
  STATE.customCards.forEach(cc => {
    if (STATE.hiddenCards[cc.id]) return;
    cards.push(renderCustomCard(cc));
  });

  container.innerHTML = cards.join('');
  updateHiddenTray();

  // Attach contenteditable listeners on each body
  container.querySelectorAll('.sc-body[data-editable="true"]').forEach(body => {
    body.addEventListener('input', () => {
      const card = body.closest('.sc-card');
      const mid = card.dataset.mid;
      const type = card.dataset.type;
      card.classList.add('dirty');
      if (type === 'extraction') {
        STATE.edits[mid] = STATE.edits[mid] || { originalText: STATE.extractions[mid].text };
        STATE.edits[mid].htmlOverride = body.innerHTML;
        STATE.edits[mid].editedAt = Date.now();
      } else if (type === 'custom') {
        const cc = STATE.customCards.find(c => c.id === mid);
        if (cc) {
          cc.html = body.innerHTML;
          cc.editedAt = Date.now();
        }
      }
      markDirty();
    });
    // Prevent click-on-body from toggling the card collapse
    body.addEventListener('click', e => e.stopPropagation());
  });

  // Custom card title editing
  container.querySelectorAll('.sc-card-title-edit').forEach(titleEl => {
    titleEl.addEventListener('input', () => {
      const card = titleEl.closest('.sc-card');
      const mid = card.dataset.mid;
      const cc = STATE.customCards.find(c => c.id === mid);
      if (cc) {
        cc.title = titleEl.textContent;
        cc.editedAt = Date.now();
        markDirty();
      }
    });
    titleEl.addEventListener('click', e => e.stopPropagation());
    titleEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } });
  });

  // Update decision pane verdict + meta
  updateDecisionPane();
}

function renderExtractionCard(mid) {
  const m = MODULES[mid];
  const ext = STATE.extractions[mid];
  const isFull = FULL_WIDTH.has(mid);
  const confPct = Math.round(ext.confidence * 100);
  const modeBadge = ext.mode === 'live'
    ? '<span style="color: var(--signal-ink); font-weight: 700;">LIVE</span>'
    : '<span style="color: var(--warning); font-weight: 700;">DEMO</span>';
  const sourceText = ext.sourceInfo
    ? `from ${escapeHtml(ext.sourceInfo.length > 60 ? ext.sourceInfo.slice(0, 57) + '…' : ext.sourceInfo)}`
    : '';

  const edit = STATE.edits[mid];
  const isEdited = !!(edit && edit.htmlOverride);
  // Losses, Tower, and Discrepancy modules emit raw HTML (purpose-built containers)
  // — detect and inject directly, bypassing markdown pipeline which would escape all tags.
  // Phase 4 hardening: any raw HTML here is sanitized through sanitizeModelHtml() before
  // injection so a prompt-injected broker document can't slip in <script>, onerror=,
  // javascript: links, or other XSS vectors. The renderMarkdown() path is already safe
  // because it escapes everything by default.
  const isPreRenderedHtml = !isEdited && ext.text && /^\s*<div class="(loss-output|tower-output|discrepancy-output)">/.test(ext.text);
  const bodyHtml = isEdited
    ? sanitizeModelHtml(edit.htmlOverride)
    : (isPreRenderedHtml ? sanitizeModelHtml(ext.text) : renderMarkdown(ext.text));
  const editedBadge = isEdited ? '<span style="font-family:var(--font-mono); font-size: 9.5px; color: var(--warning); padding-left: 6px; font-weight: 700; letter-spacing: 0.08em;">· EDITED</span>' : '';
  const updatedBadge = ext.wasUpdated ? '<span class="sc-updated-badge" title="Refreshed by incremental update">UPDATED</span>' : '';
  const revertBtn = isEdited ? `<button class="sc-act" onclick="event.stopPropagation(); revertCard('${mid}')" title="Revert to original AI output">⟲</button>` : '';

  // Default to collapsed for a clean summary view. One exception:
  //   - Cards flagged as was-updated (after an incremental refresh) auto-expand
  //     so the UW immediately sees what changed without hunting for it.
  // Edited cards (dirty) stay collapsed — the EDITED badge in the header tells
  // the user the card has been modified; they can click to expand and see it.
  const startCollapsed = !ext.wasUpdated;

  return `
    <div class="sc-card${startCollapsed ? ' collapsed' : ''}${isFull ? ' full' : ''}${isEdited ? ' dirty' : ''}${ext.wasUpdated ? ' was-updated' : ''}" data-mid="${mid}" data-type="extraction">
      <div class="sc-card-head" onclick="toggleCard(this)">
        <div class="sc-card-head-top">
          <span class="sc-tag">${m.code}</span>
          <span class="sc-name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}${editedBadge}</span>
          ${updatedBadge}
          <div class="sc-card-actions">
            <button class="sc-act fb-act fb-pos" onclick="event.stopPropagation(); feedbackQuickPositive('${mid}')" title="Good output — log positive feedback">👍</button>
            <button class="sc-act fb-act fb-neg" onclick="event.stopPropagation(); feedbackOpenPopover('${mid}', null, 'negative', this)" title="Something's wrong — give feedback">👎</button>
            <button class="sc-act fb-act fb-sug" onclick="event.stopPropagation(); feedbackOpenPopover('${mid}', null, 'suggestion', this)" title="Suggest what's missing">💬</button>
            ${revertBtn}
            <button class="sc-act" onclick="event.stopPropagation(); focusEditCard('${mid}')" title="Edit">✎</button>
            <button class="sc-act danger" onclick="event.stopPropagation(); deleteCard('${mid}')" title="Hide card">✕</button>
          </div>
          <span class="sc-toggle">▾</span>
        </div>
        <div class="sc-card-head-bottom">
          <div class="sc-card-head-bottom-left">
            ${sourceText ? `<span class="sc-source" title="${escapeHtml(ext.sourceInfo || '')}">${sourceText}</span>` : '<span>&nbsp;</span>'}
          </div>
          <div class="sc-card-head-bottom-right">
            <span>${ext.timing.toFixed(1)}s</span>
            <span>·</span>
            ${modeBadge}
            <span>·</span>
            <span>conf <strong style="color: var(--signal-ink);">${confPct}%</strong></span>
          </div>
        </div>
      </div>
      <div class="sc-body" contenteditable="true" data-editable="true" spellcheck="true">${bodyHtml}</div>
    </div>
  `;
}

function renderCustomCard(cc) {
  return `
    <div class="sc-card full custom collapsed" data-mid="${cc.id}" data-type="custom">
      <div class="sc-card-head" onclick="toggleCard(this)">
        <div class="sc-card-head-top">
          <span class="sc-tag">CUSTOM</span>
          <span class="sc-card-title-edit" contenteditable="true" spellcheck="true">${escapeHtml(cc.title)}</span>
          <div class="sc-card-actions">
            <button class="sc-act danger" onclick="event.stopPropagation(); deleteCard('${cc.id}')" title="Delete">✕</button>
          </div>
          <span class="sc-toggle">▾</span>
        </div>
        <div class="sc-card-head-bottom">
          <div class="sc-card-head-bottom-left">
            <span>Custom note · click title to rename</span>
          </div>
          <div class="sc-card-head-bottom-right">
            <span>${new Date(cc.editedAt).toLocaleString()}</span>
          </div>
        </div>
      </div>
      <div class="sc-body" contenteditable="true" data-editable="true" spellcheck="true">${typeof sanitizeModelHtml === 'function' ? sanitizeModelHtml(cc.html || '<p>Start typing your note…</p>') : (cc.html || '<p>Start typing your note…</p>')}</div>
    </div>
  `;
}

function toggleCard(headEl) {
  const card = headEl.closest('.sc-card');
  if (card) card.classList.toggle('collapsed');
}

function toggleAllCards(collapse) {
  document.querySelectorAll('.sc-card').forEach(c => c.classList.toggle('collapsed', collapse));
}

// ============================================================================
// CARD ACTIONS — edit, delete, revert, custom, restore
// ============================================================================

function focusEditCard(mid) {
  const card = document.querySelector(`.sc-card[data-mid="${mid}"]`);
  if (!card) return;
  card.classList.remove('collapsed');
  card.classList.add('editing');
  const body = card.querySelector('.sc-body');
  if (body) {
    body.focus();
    // Position cursor at end
    const range = document.createRange();
    range.selectNodeContents(body);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    // Remove editing class on blur
    body.addEventListener('blur', () => card.classList.remove('editing'), { once: true });
  }
}

function deleteCard(mid) {
  STATE.hiddenCards[mid] = true;
  markDirty();
  renderSummaryCards();
  // Note: no snapshot resync needed here — markDirty triggers cloud upsert of
  // submission_edits, which on next rehydrate will overlay 'hidden:mid'=true on
  // top of whatever snapshot held. Adds work via overlay; only DELETIONS need
  // snapshot resync (see clearAllEdits, revertCard, restoreAllCards).
  logAudit('Edits', 'Hid card ' + mid, '—');
}

function revertCard(mid) {
  if (!confirm('Revert ' + (MODULES[mid] ? MODULES[mid].name : mid) + ' to original AI output? All your edits to this card will be lost.')) return;
  delete STATE.edits[mid];
  // Phase 8.5 round 3 fix #1: also delete the cloud submission_edits row.
  // Without this, the local revert succeeds but the cloud edit row remains
  // and would resurrect on next rehydrate (which now overlays cloud edits
  // on top of the snapshot). Same shape as the clearAllEdits cloud-delete
  // fix from round 1 — applied here for the single-card revert path.
  const sid = STATE.activeSubmissionId;
  if (sid && typeof sbDeleteEdit === 'function') {
    sbDeleteEdit(sid, 'card:' + mid).catch(e => {
      console.warn('Cloud edit delete failed for', mid, e);
      if (typeof logAudit === 'function') logAudit('Edits', 'Cloud revert FAILED for ' + mid + ' · ' + (e.message || e), 'error');
      if (typeof toast === 'function') toast('Reverted locally, cloud cleanup failed · ' + (e.message || 'network').slice(0, 60), 'error');
    });
  }
  markDirty();
  renderSummaryCards();
  // Phase 8.5 Round 4 fix #2: resync snapshot so reload doesn't resurrect the reverted edit
  resyncActiveSnapshot('revertCard:' + mid);
  logAudit('Edits', 'Reverted ' + mid + ' to original', '—');
  toast('Reverted to original');
}

function restoreAllCards() {
  // Phase 8.5 round 3 fix #2: capture hidden IDs BEFORE clearing local state,
  // so we can delete the matching cloud submission_edits rows. Without this,
  // restored cards would re-hide on next rehydrate (which overlays cloud
  // hidden:<id> rows on top of the snapshot). Same shape as the revert and
  // clearAllEdits cloud-delete patterns.
  const hiddenIds = Object.keys(STATE.hiddenCards || {});
  STATE.hiddenCards = {};
  const sid = STATE.activeSubmissionId;
  if (sid && hiddenIds.length > 0 && typeof sbDeleteEdit === 'function') {
    hiddenIds.forEach(id => {
      sbDeleteEdit(sid, 'hidden:' + id).catch(e => {
        console.warn('Cloud hidden-row delete failed for', id, e);
        if (typeof logAudit === 'function') logAudit('Edits', 'Cloud restore FAILED for hidden:' + id + ' · ' + (e.message || e), 'error');
      });
    });
  }
  markDirty();
  renderSummaryCards();
  // Phase 8.5 Round 4 fix #2: resync snapshot so reload doesn't re-hide the cards
  resyncActiveSnapshot('restoreAllCards');
  logAudit('Edits', 'Restored all hidden cards (' + hiddenIds.length + ')', '—');
  toast('All cards restored');
}

// Dismiss a single discrepancy flag (material conflict or minor variance).
// Per spec: NO audit logging — this is a lightweight "I've seen it, stop showing it"
// action. Flags are dismissed from view only; the original extraction text is
// preserved, so re-rendering the card (e.g. after a reload) brings them back.
// If the UW wants the dismissal to persist, they can edit the card, which stores
// an htmlOverride in STATE.edits and is saved to Supabase submission_edits.
function dismissDiscrepancyFlag(flagId) {
  const row = document.querySelector('.disc-row[data-flag-id="' + flagId + '"]');
  if (!row) return;
  row.classList.add('is-dismissed');
  // After the CSS transition completes, collapse the row's height. We leave the
  // element in the DOM so it can be un-hidden if the UW ever needs it, but it's
  // visually and functionally gone.
  setTimeout(() => {
    // If all rows in a section are dismissed, show a pleasant empty-state message
    // so the section doesn't sit awkwardly blank.
    const section = row.closest('.disc-section');
    if (section) {
      const remaining = section.querySelectorAll('.disc-row:not(.is-dismissed)').length;
      if (remaining === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'disc-empty-row';
        emptyMsg.textContent = 'All flags in this section have been cleared.';
        section.appendChild(emptyMsg);
      }
    }
  }, 240);
}

function updateHiddenTray() {
  const tray = document.getElementById('hiddenTray');
  const count = document.getElementById('hiddenCount');
  if (!tray || !count) return;
  const hiddenIds = Object.keys(STATE.hiddenCards);
  if (hiddenIds.length > 0) {
    tray.classList.add('show');
    count.textContent = hiddenIds.length;
  } else {
    tray.classList.remove('show');
  }
}

// Opens the file picker so the user can add follow-up docs. Because the pipeline
// is already done, handleFiles will route to the incrementalProcess flow and
// refresh only the affected modules + downstream dependents.
function triggerAddDocuments() {
  const fi = document.getElementById('fileInput');
  if (fi) fi.click();
}

// ============================================================================
// ASSISTANT REVIEW WORKFLOW — UW ↔ Assistant handoff state machine
// States: null → awaiting_assistant → in_review → returned_to_uw → (optionally loop)
// ============================================================================

function openSendToAssistantModal() {
  if (!STATE.pipelineDone) return;
  document.getElementById('sendAssistantModal').classList.add('open');
}

function closeSendToAssistantModal() {
  document.getElementById('sendAssistantModal').classList.remove('open');
}

function confirmSendToAssistant() {
  const assignee = document.getElementById('handoffAssignee').value;
  const note = document.getElementById('handoffUwNote').value.trim();
  if (!note) {
    toast('Please write a note for the assistant before sending', 'warn');
    return;
  }
  const now = Date.now();
  STATE.handoff.status = 'awaiting_assistant';
  STATE.handoff.assignee = assignee;
  STATE.handoff.uwNote = note;
  STATE.handoff.sentAt = now;
  STATE.handoff.history.push({ transition: 'uw→assistant', at: now, actor: currentActor(), assignee: assignee, noteLength: note.length });
  logAudit('Handoff', 'Sent to ' + assignee + ' · note ' + note.length + ' chars', STATE.api.model);
  closeSendToAssistantModal();
  renderHandoffState();
  toast('Sent to ' + assignee + ' for review', 'success');
}

function openReturnToUwModal() {
  if (STATE.handoff.viewAs !== 'assistant') {
    toast('Switch to Assistant view first', 'warn');
    return;
  }
  document.getElementById('returnUwModal').classList.add('open');
}

function closeReturnToUwModal() {
  document.getElementById('returnUwModal').classList.remove('open');
}

function confirmReturnToUw() {
  const note = document.getElementById('handoffAssistantNote').value.trim();
  if (!note) {
    toast('Please write a review note before returning', 'warn');
    return;
  }
  const now = Date.now();
  STATE.handoff.status = 'returned_to_uw';
  STATE.handoff.assistantNote = note;
  STATE.handoff.returnedAt = now;
  STATE.handoff.history.push({ transition: 'assistant→uw', at: now, actor: STATE.handoff.assignee || 'Assistant', noteLength: note.length });
  logAudit('Handoff', 'Returned to UW by ' + (STATE.handoff.assignee || 'Assistant') + ' · note ' + note.length + ' chars', STATE.api.model);
  // Auto-switch back to UW view — the UW is the one who needs to see the returned note
  STATE.handoff.viewAs = 'uw';
  closeReturnToUwModal();
  renderHandoffState();
  toast('Returned to UW with review notes', 'success');
}

// ============================================================================
// MANUAL-PASTE MODAL (Session 7) — file-format hardening fallback
// For scanned PDFs, PowerPoint, images, and other unreadable formats the user
// can paste the document's visible text and feed it to the pipeline normally.
// ============================================================================
let __pasteTargetFileId = null;

function openManualPasteModal(fileId) {
  const entry = STATE.files.find(f => f.id === fileId);
  if (!entry) return;
  __pasteTargetFileId = fileId;

  const modal = document.getElementById('manualPasteModal');
  const title = document.getElementById('mpmTitle');
  const label = document.getElementById('mpmLabel');
  const warning = document.getElementById('mpmWarning');
  const textarea = document.getElementById('mpmTextarea');
  const charCount = document.getElementById('mpmCharCount');
  const saveBtn = document.getElementById('mpmSaveBtn');

  title.textContent = 'Paste text for: ' + entry.name;
  label.textContent = 'Document content · ' + entry.name;

  // Build the warning text based on why this file landed here.
  // Phase 8.5 round 3 fix #7: escape entry.warning before HTML insertion.
  // Today entry.warning is always set by app code with hardcoded strings, but
  // escaping is defense-in-depth: if a future code path ever pipes a filename,
  // file extension, or other dynamic content into entry.warning, we don't want
  // it injected as HTML.
  const safeWarning = entry.manualReason === 'scanned'
    ? escapeHtml(entry.warning || 'This PDF has no text layer.')
    : escapeHtml(entry.warning || 'This format cannot be auto-extracted.');
  const reasonText = entry.manualReason === 'scanned'
    ? '<strong style="color: var(--warning);">Scanned PDF detected.</strong> ' + safeWarning + ' Paste the visible content below to feed it to the pipeline.'
    : '<strong style="color: var(--warning);">Format not readable in-browser.</strong> ' + safeWarning + ' Paste the visible content below.';
  warning.innerHTML = reasonText;

  // Reset textarea (or restore if user had previously typed something and reopened)
  textarea.value = entry.manualText || '';
  charCount.textContent = textarea.value.length + ' chars · minimum 20 to save';
  saveBtn.disabled = textarea.value.length < 20;

  // Live char counter
  textarea.oninput = () => {
    const n = textarea.value.length;
    charCount.textContent = n + ' chars · minimum 20 to save';
    saveBtn.disabled = n < 20;
  };

  modal.classList.add('open');
  setTimeout(() => textarea.focus(), 50);
}

function closeManualPasteModal() {
  document.getElementById('manualPasteModal').classList.remove('open');
  __pasteTargetFileId = null;
}

function confirmManualPaste() {
  if (!__pasteTargetFileId) return;
  const entry = STATE.files.find(f => f.id === __pasteTargetFileId);
  if (!entry) return;
  const text = document.getElementById('mpmTextarea').value.trim();
  if (text.length < 20) {
    toast('Please paste at least 20 characters of document text', 'warn');
    return;
  }
  // Upgrade the entry — it's now indistinguishable from a normally-parsed file from
  // the pipeline's perspective. We preserve manualReason/warning for the audit trail
  // and store the raw pasted text on entry.manualText so re-opening the modal shows
  // what the user typed.
  entry.text = text;
  entry.manualText = text;
  entry.state = 'parsed';
  entry.needsReview = false;
  entry.manuallyPasted = true;
  logAudit('Classifier', 'Manual paste accepted for ' + entry.name + ' (' + text.length + ' chars) — was ' + (entry.manualReason || 'unreadable'), 'user');
  closeManualPasteModal();
  renderFileList();
  updateRunButton();
  toast('Text saved — ' + entry.name + ' is ready for the pipeline', 'success');

  // If pipeline already completed, run incremental flow so the new content updates affected modules
  if (STATE.pipelineDone) {
    incrementalProcess([entry]);
  }
}

function toggleAssistantView() {
  if (!STATE.handoff.status) {
    toast('Send to assistant first to enable assistant view', 'warn');
    return;
  }
  const now = Date.now();
  if (STATE.handoff.viewAs === 'uw') {
    STATE.handoff.viewAs = 'assistant';
    // First time opening as assistant: mark as in_review
    if (STATE.handoff.status === 'awaiting_assistant') {
      STATE.handoff.status = 'in_review';
      STATE.handoff.openedAt = now;
      STATE.handoff.history.push({ transition: 'assistant_opened', at: now, actor: STATE.handoff.assignee || 'Assistant' });
      logAudit('Handoff', (STATE.handoff.assignee || 'Assistant') + ' opened submission for review', STATE.api.model);
    }
  } else {
    STATE.handoff.viewAs = 'uw';
  }
  renderHandoffState();
}

// Centralized renderer — updates pill, note banner, button states, and body class
// based on current STATE.handoff. Call after any state transition or view toggle.
function renderHandoffState() {
  const h = STATE.handoff;
  const pill = document.getElementById('shHandoffPill');
  const banner = document.getElementById('handoffNoteBanner');
  const btnSend = document.getElementById('btnSendToAssistant');
  const btnReturn = document.getElementById('btnReturnToUw');
  const btnToggle = document.getElementById('btnToggleAssistantView');
  const divider = document.getElementById('handoffDivider');
  const toggleLabel = document.getElementById('toggleViewLabel');

  // Body class for assistant-view visual treatment
  document.body.classList.toggle('viewing-as-assistant', h.viewAs === 'assistant');

  // Status pill in sub-header
  if (pill) {
    if (h.status === 'awaiting_assistant') {
      pill.style.display = 'inline-flex';
      pill.className = 'sub-pill handoff-pill awaiting';
      pill.textContent = 'AWAITING ' + (h.assignee || 'ASSISTANT').toUpperCase();
    } else if (h.status === 'in_review') {
      pill.style.display = 'inline-flex';
      pill.className = 'sub-pill handoff-pill in-review';
      pill.textContent = (h.assignee || 'ASSISTANT').toUpperCase() + ' IN REVIEW';
    } else if (h.status === 'returned_to_uw') {
      pill.style.display = 'inline-flex';
      pill.className = 'sub-pill handoff-pill returned';
      pill.textContent = 'RETURNED TO UW';
    } else {
      pill.style.display = 'none';
    }
  }

  // Pinned note banner — shows UW's note when viewing as assistant,
  // or assistant's return note when back in UW view after return
  if (banner) {
    const showUwNote = h.viewAs === 'assistant' && h.uwNote;
    const showAssistantNote = h.viewAs === 'uw' && h.status === 'returned_to_uw' && h.assistantNote;
    if (showUwNote) {
      banner.style.display = 'block';
      banner.classList.remove('from-assistant');
      document.getElementById('hnbIcon').textContent = 'JW';
      document.getElementById('hnbEyebrow').textContent = 'Note from UW';
      document.getElementById('hnbTitle').textContent = currentActor() + ' · for ' + (h.assignee || 'assistant') + ' review';
      document.getElementById('hnbTimestamp').textContent = h.sentAt ? formatTimestamp(h.sentAt) : '';
      document.getElementById('hnbBody').textContent = h.uwNote;
    } else if (showAssistantNote) {
      banner.style.display = 'block';
      banner.classList.add('from-assistant');
      const initials = (h.assignee || 'TS').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
      document.getElementById('hnbIcon').textContent = initials;
      document.getElementById('hnbEyebrow').textContent = 'Review returned';
      document.getElementById('hnbTitle').textContent = (h.assignee || 'Assistant') + ' · review complete';
      document.getElementById('hnbTimestamp').textContent = h.returnedAt ? formatTimestamp(h.returnedAt) : '';
      document.getElementById('hnbBody').textContent = h.assistantNote;
    } else {
      banner.style.display = 'none';
    }
  }

  // Button visibility and enablement
  if (divider) divider.style.display = STATE.pipelineDone ? 'block' : 'none';

  if (btnSend) {
    btnSend.disabled = !STATE.pipelineDone;
    btnSend.style.display = (h.viewAs === 'assistant') ? 'none' : '';
    // Relabel if resending after a return cycle
    const label = btnSend.querySelector('svg') ? btnSend.lastChild : null;
    if (h.status === 'returned_to_uw') {
      btnSend.title = 'Send back to assistant with updated notes';
    }
  }

  if (btnReturn) {
    btnReturn.style.display = (h.viewAs === 'assistant') ? '' : 'none';
    btnReturn.disabled = !(h.status === 'in_review' || h.status === 'awaiting_assistant');
  }

  if (btnToggle) {
    btnToggle.style.display = h.status ? '' : 'none';
    if (toggleLabel) {
      toggleLabel.textContent = h.viewAs === 'uw' ? 'View as Assistant' : 'View as UW';
    }
  }
}

// Human-readable timestamp for the handoff banner — "today at 2:14 PM" / "Apr 19 at 3:02 PM"
function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return 'today at ' + timeStr;
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return dateStr + ' at ' + timeStr;
}

function addCustomCard() {
  const id = 'custom_' + Date.now().toString(36);
  STATE.customCards.push({
    id,
    title: 'Custom Note',
    html: '<p>Start typing your note…</p>',
    createdAt: Date.now(),
    editedAt: Date.now()
  });
  markDirty();
  renderSummaryCards();
  // Note: no snapshot resync needed — overlay handles adds correctly. See deleteCard comment.
  logAudit('Edits', 'Added custom card ' + id, '—');
  // Enable relevant export buttons now that there's content
  const btnMd = document.getElementById('btnMd');
  const btnExcel = document.getElementById('btnExcel');
  if (btnMd) btnMd.disabled = false;
  if (btnExcel) btnExcel.disabled = false;
  // Auto-focus the new card
  setTimeout(() => focusEditCard(id), 60);
  toast('Custom card added');
}

// Helper: get the "effective" text for a module (edited plain text or original)
function getEffectiveText(mid) {
  const edit = STATE.edits[mid];
  if (edit && edit.htmlOverride) {
    // Convert edited HTML back to plain text for exports
    const tmp = document.createElement('div');
    tmp.innerHTML = edit.htmlOverride;
    return (tmp.innerText || tmp.textContent || '').trim();
  }
  return STATE.extractions[mid] ? STATE.extractions[mid].text : '';
}

// Helper: get effective text for a custom card
function getCustomText(cc) {
  const tmp = document.createElement('div');
  tmp.innerHTML = cc.html || '';
  return (tmp.innerText || tmp.textContent || '').trim();
}

// Refresh the Decision pane BEFORE a pipeline run so meta-rows reflect current state
function updateDecisionPaneIdle() {
  const metaBlocks = document.querySelectorAll('.meta-block');
  metaBlocks.forEach(mb => {
    const h4 = mb.querySelector('h4');
    if (!h4) return;
    if (h4.textContent.trim() === 'Submission') {
      mb.innerHTML = `
        <h4>Submission</h4>
        <div class="meta-row"><span class="meta-row-label">Files</span><span class="meta-row-value">${STATE.files.length || '—'}</span></div>
        <div class="meta-row"><span class="meta-row-label">Modules run</span><span class="meta-row-value">—</span></div>
        <div class="meta-row"><span class="meta-row-label">Mode</span><span class="meta-row-value">LIVE · ANTHROPIC</span></div>
      `;
    } else if (h4.textContent.trim() === 'Audit') {
      mb.innerHTML = `
        <h4>Audit</h4>
        <div class="meta-row"><span class="meta-row-label">Pipeline run</span><span class="meta-row-value">—</span></div>
        <div class="meta-row"><span class="meta-row-label">Model</span><span class="meta-row-value" style="font-size: 10.5px; font-family: var(--font-mono);">${STATE.api.model}</span></div>
        <div class="meta-row"><span class="meta-row-label">Prompts</span><span class="meta-row-value">v2.4</span></div>
        <div class="meta-row"><span class="meta-row-label">Events logged</span><span class="meta-row-value">${STATE.audit.length}</span></div>
        <div class="meta-row"><span class="meta-row-label">Reviewer</span><span class="meta-row-value">${escapeHtml(currentActor())}</span></div>
      `;
    }
  });
}

// ============================================================================
// DECISION PANE — verdict card + action buttons reflect pipeline state
// ============================================================================
function updateDecisionPane() {
  const extracted = Object.keys(STATE.extractions);
  const guidelines = STATE.extractions.guidelines;
  let verdict, verdictDetail, isReferral = false, isDecline = false, isError = false;

  // Zero-completion case: pipeline ran but nothing succeeded
  if (extracted.length === 0) {
    verdict = 'No output';
    verdictDetail = 'Pipeline completed but no modules produced output. Review audit log for failures.';
    isError = true;
  } else if (!guidelines) {
    // Guidelines didn't run — probably no supplemental or summary-ops
    verdict = 'Incomplete';
    verdictDetail = `${extracted.length} modules ran but guideline cross-reference did not — not enough input to determine appetite.`;
    isError = true;
  } else {
    // Parse guidelines for structured decision signals
    const text = guidelines.text;

    // REFERRAL: look for explicit triggers section with content (not "None")
    const refTriggerMatch = text.match(/Referral Triggers?[^\n]*:?\s*\n([\s\S]{0,800}?)(?=\n\n|\n\*\*|$)/i);
    if (refTriggerMatch) {
      const triggerBody = refTriggerMatch[1].trim();
      const hasRealTriggers = triggerBody.length > 20 && !/^(none|no referral|n\/a)/i.test(triggerBody);
      if (hasRealTriggers) isReferral = true;
    }
    // Fallback: any "Referral" verdict string in a guideline conflict block
    if (!isReferral && /referral required|senior uw approval|requires referral/i.test(text)) {
      isReferral = true;
    }

    // PROHIBITED: look for Prohibited Exposures section with content (not "None")
    const prohibMatch = text.match(/Prohibited Exposures?[^\n]*:?\s*\n([\s\S]{0,600}?)(?=\n\n|\n\*\*|$)/i);
    if (prohibMatch) {
      const prohibBody = prohibMatch[1].trim();
      const hasRealProhib = prohibBody.length > 10 && !/^-?\s*(none|n\/a|no prohibited)/i.test(prohibBody);
      if (hasRealProhib) isDecline = true;
    }

    if (isDecline) {
      verdict = 'Decline';
      verdictDetail = 'Prohibited exposure identified by guideline cross-reference. See Guidelines card for detail.';
    } else if (isReferral) {
      verdict = 'Quote w/ Conditions';
      verdictDetail = 'Referral triggers identified. Senior UW approval required before binding. See Guidelines card.';
    } else {
      verdict = 'Quote';
      verdictDetail = 'All guideline checks passed. Clean pass — proceed to binding.';
    }
  }

  const vCard = document.querySelector('.verdict-card');
  if (vCard) {
    vCard.classList.remove('ref');
    const valueEl = vCard.querySelector('.verdict-value');
    const subEl = vCard.querySelector('.verdict-sub');
    if (valueEl) valueEl.textContent = verdict;
    if (subEl) subEl.textContent = verdictDetail;
    if (isReferral || isDecline || isError) vCard.classList.add('ref');
  }

  // Rewrite meta-blocks with live post-pipeline state
  const metaBlocks = document.querySelectorAll('.meta-block');
  metaBlocks.forEach(mb => {
    const h4 = mb.querySelector('h4');
    if (!h4) return;
    const title = h4.textContent.trim();
    if (title === 'Submission') {
      const runCost = STATE.runTotalCost || 0;
      const costStr = fmtCost(runCost);
      mb.innerHTML = `
        <h4>Submission</h4>
        <div class="meta-row"><span class="meta-row-label">Files</span><span class="meta-row-value">${STATE.files.length}</span></div>
        <div class="meta-row"><span class="meta-row-label">Modules run</span><span class="meta-row-value">${extracted.length} / ${Object.keys(MODULES).length}</span></div>
        <div class="meta-row"><span class="meta-row-label">Mode</span><span class="meta-row-value">LIVE · ANTHROPIC</span></div>
        <div class="meta-row"><span class="meta-row-label">Run cost</span><span class="meta-row-value" style="font-family: var(--font-mono);">${costStr}</span></div>
      `;
    } else if (title === 'Audit') {
      mb.innerHTML = `
        <h4>Audit</h4>
        <div class="meta-row"><span class="meta-row-label">Pipeline run</span><span class="meta-row-value" style="font-size: 10.5px; font-family: var(--font-mono);">${STATE.pipelineRun || '—'}</span></div>
        <div class="meta-row"><span class="meta-row-label">Model</span><span class="meta-row-value" style="font-size: 10.5px; font-family: var(--font-mono);">split Opus/Sonnet</span></div>
        <div class="meta-row"><span class="meta-row-label">Prompts</span><span class="meta-row-value">v2.4</span></div>
        <div class="meta-row"><span class="meta-row-label">Events logged</span><span class="meta-row-value">${STATE.audit.length}</span></div>
        <div class="meta-row"><span class="meta-row-label">Reviewer</span><span class="meta-row-value">${escapeHtml(currentActor())}</span></div>
      `;
    }
  });
}

// Live updater for the submission sidebar's Run cost row. Called from runModule
// as each module finishes so the UW sees spend accumulating in real time.
function renderSubmissionSidebar() {
  const costEl = document.getElementById('sidebarRunCost');
  if (costEl) {
    const cost = STATE.runTotalCost || 0;
    costEl.textContent = fmtCost(cost);
  }
}

// ============================================================================
// UI PLUMBING
// ============================================================================
function switchView(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  window.scrollTo(0, 0);
  // Phase 6: refresh admin views when Admin tab opens. Each renderer gates on
  // currentUser.role internally, so non-admins are skipped silently.
  if (name === 'admin') {
    if (typeof renderAdminUsersCard    === 'function') renderAdminUsersCard();
    if (typeof renderAdminFeedbackCard === 'function') renderAdminFeedbackCard();
    if (typeof renderAdminAuditLog     === 'function') renderAdminAuditLog({ append: false });
  }
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));

// New submission entry point — archives the currently-loaded submission (if any)
// then clears state and opens the workbench for a fresh one.
function startNewSubmission() {
  // Save any in-flight edits to the active submission before wiping
  if (STATE.activeSubmissionId && STATE.pipelineDone) {
    const activeRec = STATE.submissions.find(s => s.id === STATE.activeSubmissionId);
    if (activeRec) {
      activeRec.snapshot = {
        files:          deepClone(STATE.files),
        extractions:    deepClone(STATE.extractions),
        edits:          deepClone(STATE.edits),
        customCards:    deepClone(STATE.customCards),
        hiddenCards:    deepClone(STATE.hiddenCards),
        handoff:        deepClone(STATE.handoff),
        audit:          STATE.audit.slice(),
        runTotalCost:   STATE.runTotalCost || 0,
        pipelineRun:    STATE.pipelineRun
      };
      activeRec.lastModifiedAt = Date.now();
      // Phase 7 step 3: replace the broken-shape batch saveSubmissions() with
      // a direct single-record save. Same pattern as the rehydrate path above.
      // No green success toast — user clicked "new submission", we don't need
      // to celebrate the auto-save of the previous one.
      (async () => {
        if (typeof logAudit === 'function') logAudit('Submissions', 'Saving ' + activeRec.id + ' to cloud (auto · before new submission)…', 'ok');
        try {
          if (typeof sbSaveSubmission !== 'function') {
            throw new Error('sbSaveSubmission not defined');
          }
          const liteSnapshot = activeRec.snapshot ? {
            ...activeRec.snapshot,
            files: (activeRec.snapshot.files || []).map(f => ({ ...f, text: '', textDropped: true, _rawFile: undefined })),
            derived: {
              account:         activeRec.account || null,
              broker:          activeRec.broker || null,
              effectiveDate:   activeRec.effective || activeRec.effectiveDate || null,
              requestedLimits: activeRec.requested || activeRec.requestedLimits || null,
              missingInfo:     activeRec.missingInfo || null
            }
          } : null;
          const saved = await sbSaveSubmission(buildSubmissionPayload(activeRec, liteSnapshot));
          if (typeof logAudit === 'function') logAudit('Submissions', 'Saved ' + activeRec.id + ' (auto · before new submission) · row id ' + (saved && saved.id ? saved.id.slice(0, 12) : '(no id)'), 'ok');
        } catch (err) {
          console.error('Submission save failed (startNew path)', activeRec.id, err);
          const msg = (err && err.message) ? err.message : String(err);
          if (typeof logAudit === 'function') logAudit('Submissions', 'SAVE FAILED ' + activeRec.id + ' (auto · before new submission) · ' + msg + ' · kept in-memory', 'error');
          if (typeof toast === 'function') toast('Cloud save failed · ' + msg.slice(0, 80), 'error');
        }
      })();
    }
  }
  // Fresh start — reset any lingering state from a previous submission
  STATE.files = [];
  STATE.extractions = {};
  STATE.pipelineDone = false;
  STATE.pipelineRunning = false;
  STATE.pipelineRun = null;
  STATE.activeSubmissionId = null;
  STATE.edits = {};
  STATE.hiddenCards = {};
  STATE.customCards = [];
  STATE.audit = [];
  STATE.runTotalCost = 0;
  STATE._pendingEdits = null;   // drop any stashed prior-session edits
  // Phase 4: edits no longer live in localStorage — they're in Supabase
  // submission_edits, scoped by submission_id. A fresh pipeline has no
  // active submission yet, so there's nothing to clear here.
  if (STATE.handoff) {
    STATE.handoff.status = null;
    STATE.handoff.viewAs = 'uw';
  }
  document.body.classList.remove('pipeline-complete-mode');
  // Reset sub-header to the fresh-submission state
  const sh = document.getElementById('sh-name');
  const sm = document.getElementById('sh-meta');
  if (sh) sh.textContent = 'New submission';
  if (sm) sm.textContent = 'Drop broker documents to begin · classifier identifies each file · pipeline fans out across 17 specialist modules';
  // Clear any scrape status / website inputs from prior sessions
  const webStatus = document.getElementById('webStatus');
  if (webStatus) webStatus.style.display = 'none';
  ['webUrlInput', 'webNameInput', 'webZipInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderFileList();
  updateRunButton();
  if (typeof renderQueueTable === 'function') renderQueueTable();
  if (typeof updateQueueKpi === 'function') updateQueueKpi();
  // Phase 4 fix: clicking New Submission from the Queue was still showing the
  // last-opened submission's cards because renderSummaryCards() wasn't being
  // called after the state wipe — the cards DOM persisted from the prior view.
  // Force a re-render of every panel so nothing stale leaks through.
  if (typeof renderSummaryCards === 'function') renderSummaryCards();
  if (typeof renderAuditIfOpen === 'function') renderAuditIfOpen();
  if (typeof updateDecisionPane === 'function') updateDecisionPane();
  if (typeof renderClassifierReview === 'function') renderClassifierReview();
  if (typeof renderHandoffState === 'function') renderHandoffState();
  // Make sure we land on the intake/workbench stage, not whichever stage the
  // prior submission was on.
  if (typeof showStage === 'function') showStage('pipe');
  switchView('submission');
}

function showStage(stage) {
  // Remove active state from all three stage tabs first; explicit assignment is
  // simpler than tracking which one is active. Same for the three stage containers.
  document.getElementById('stageTabPipe').classList.remove('active');
  document.getElementById('stageTabSum').classList.remove('active');
  document.getElementById('stageTabDocs')?.classList.remove('active');
  document.getElementById('pipelineStage').style.display = 'none';
  document.getElementById('summaryStage').classList.remove('active');

  // Documents stage = native overlay. The Speed File Manager UI is mounted
  // directly inside Altitude (in <div id="docs-view-root">), with all CSS
  // namespaced under that id so there are zero style collisions. Activation
  // is just a body class — the CSS does the rest. State (uploaded docs,
  // tags, annotations) survives stage switches because the DOM tree stays
  // mounted; we just toggle visibility.
  if (stage === 'pipe') {
    document.getElementById('pipelineStage').style.display = 'block';
    document.getElementById('stageTabPipe').classList.add('active');
    document.body.classList.remove('docs-fullwidth');
  } else if (stage === 'sum') {
    document.getElementById('summaryStage').classList.add('active');
    document.getElementById('stageTabSum').classList.add('active');
    document.body.classList.remove('docs-fullwidth');
    // Refresh the review banner whenever the summary view becomes visible
    if (typeof renderClassifierReview === 'function') renderClassifierReview();
  } else if (stage === 'docs') {
    document.getElementById('stageTabDocs').classList.add('active');
    document.body.classList.add('docs-fullwidth');
    // Phase 4: scope the docs view to the active submission so the user
    // sees only that submission's docs, and any new uploads get linked.
    // If there's no active submission (cross-account browsing), we pass
    // (null, null) which clears scope and shows everything.
    if (window.docsView && typeof window.docsView.setSubmissionContext === 'function') {
      const sid = STATE && STATE.activeSubmissionId ? STATE.activeSubmissionId : null;
      let title = null;
      if (sid && STATE.submissions) {
        const rec = STATE.submissions.find(s => s.id === sid);
        if (rec) {
          // Prefer account_name; fall back to title or broker. Keep it short.
          title = rec.account_name || rec.title || rec.broker || ('Submission ' + sid.slice(0, 8));
        }
      }
      window.docsView.setSubmissionContext(sid, title);
    }
    // Notify the docs view it's now visible (lets it lazy-init annotations,
    // canvas resize, and re-measure thumb scaling for any docs already loaded).
    if (typeof window.docsViewActivated === 'function') window.docsViewActivated();
  }
  // Refresh the workbench Documents-tab count badge whenever we navigate.
  // Counts surface the current number of doc rows scoped to the active
  // submission (read live from the Documents view).
  if (typeof updateActiveSubmissionDocsCount === 'function') {
    updateActiveSubmissionDocsCount();
  }
}

function toast(msg) {
  const w = document.getElementById('toastWrap');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  w.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; }, 2600);
  setTimeout(() => t.remove(), 3000);
}

function toggleTheme() {
  const el = document.documentElement;
  const cur = el.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  if (next === 'light') el.setAttribute('data-theme', 'light');
  else el.removeAttribute('data-theme');
  try { localStorage.setItem('stm-theme', next); } catch(e) {}
}
(function initTheme() {
  try {
    const stored = localStorage.getItem('stm-theme');
    if (stored === 'light') document.documentElement.setAttribute('data-theme', 'light');
  } catch(e) {}
})();

// ============================================================================
// Phase 8 step 7: explicit window-exports for cross-file references and
// HTML inline handlers. Same pattern as steps 3-6: never rely on implicit
// global attachment.
// ============================================================================

// Top-level consts referenced by other extracted files (STATE: 100 refs;
// sb: 37 refs; MOCKS: 3 refs; ACTIVE_GUIDELINE: 1 ref). The supabase-js
// CDN puts createClient on window.supabase already, but our wrapper `sb`
// is local to this file — must be explicitly exported.
window.STATE = STATE;
window.sb = sb;
window.MOCKS = MOCKS;
window.SAFE_TAGS = SAFE_TAGS;
window.SAFE_ATTRS = SAFE_ATTRS;
window.SUB_STATUSES = SUB_STATUSES;
window.SUB_STATUS_CLASS = SUB_STATUS_CLASS;
window.CARD_ORDER = CARD_ORDER;
window.FULL_WIDTH = FULL_WIDTH;
window.FEEDBACK_REASONS_NEGATIVE = FEEDBACK_REASONS_NEGATIVE;
window.FEEDBACK_REASONS_SUGGESTION = FEEDBACK_REASONS_SUGGESTION;
window.DEFAULT_GUIDELINE = DEFAULT_GUIDELINE;
// ACTIVE_GUIDELINE is a `let` (mutable) — accessor via window.getActiveGuideline()
// is the safe pattern. The let binding cannot be aliased to window directly
// because reassignment would only update the local. Other files use
// getActiveGuideline() instead of reading ACTIVE_GUIDELINE directly.

// Inline-handler functions (from HTML onclick/onchange/onkeypress attributes).
// All 55 unique handlers identified by audit. Each is a function declaration
// somewhere above; reassigning to window is idempotent and harmless.
window.addCustomCard = addCustomCard;
window.changeSubmissionStatus = changeSubmissionStatus;
window.clearAllEdits = clearAllEdits;
window.closeAllFeedbackPopovers = closeAllFeedbackPopovers;
window.closeManualPasteModal = closeManualPasteModal;
window.closeReturnToUwModal = closeReturnToUwModal;
window.closeSendToAssistantModal = closeSendToAssistantModal;
window.closeSettings = closeSettings;
window.confirmManualPaste = confirmManualPaste;
window.confirmReturnToUw = confirmReturnToUw;
window.confirmSendToAssistant = confirmSendToAssistant;
window.deleteCard = deleteCard;
window.deleteSubmission = deleteSubmission;
window.dismissDiscrepancyFlag = dismissDiscrepancyFlag;
window.exportAudit = exportAudit;
window.exportExcel = exportExcel;
window.exportFeedback = exportFeedback;
window.exportMarkdown = exportMarkdown;
window.feedbackOpenPopover = feedbackOpenPopover;
window.feedbackQuickPositive = feedbackQuickPositive;
window.focusEditCard = focusEditCard;
window.openManualPasteModal = openManualPasteModal;
window.openReturnToUwModal = openReturnToUwModal;
window.openSendToAssistantModal = openSendToAssistantModal;
window.openSettings = openSettings;
window.rehydrateSubmission = rehydrateSubmission;
window.removeFile = removeFile;
window.resetGuidelineToDefault = resetGuidelineToDefault;
window.restoreAllCards = restoreAllCards;
window.revertCard = revertCard;
window.saveSettings = saveSettings;
window.showDefaultGuideline = showDefaultGuideline;
// Round 5 fix #3: guideline drop handlers
window.handleGuidelineDrop = handleGuidelineDrop;
// Documents view module routes uploads through Altitude's main pipeline so
// classifier + routing + incremental flow all run normally.
window.handleFiles = handleFiles;

window.startNewSubmission = startNewSubmission;
window.submitFeedbackFromPopover = submitFeedbackFromPopover;
window.toast = toast;
window.toggleAllCards = toggleAllCards;
window.toggleAssistantView = toggleAssistantView;
window.toggleCard = toggleCard;
window.toggleFeedbackChip = toggleFeedbackChip;
window.toggleStatusMenu = toggleStatusMenu;
window.toggleTheme = toggleTheme;
window.triggerAddDocuments = triggerAddDocuments;

// ============================================================================
// WORKBENCH DOCS-COUNT BADGE
// The "Documents" tab in the workbench header shows a count badge. The badge
// element is hardcoded to 0 in HTML; this function reads the actual count
// from the Documents view (window.docsView API) filtered to the active
// submission, and updates the badge in place. Called from:
//   • showStage — every navigation between Pipeline/Summary/Documents
//   • setActiveSubmission flows — when the user opens a submission
//   • The Documents view itself — after every state change (upload/delete/
//     hydrate). The Documents view calls window.refreshActiveSubmissionDocsCount
//     which we expose below.
// ============================================================================
function updateActiveSubmissionDocsCount() {
  const el = document.getElementById('docsCount');
  if (!el) return;
  const sid = (typeof STATE !== 'undefined' && STATE) ? STATE.activeSubmissionId : null;
  if (!sid) { el.textContent = '0'; return; }
  if (!window.docsView || typeof window.docsView.getDocs !== 'function') {
    el.textContent = '0';
    return;
  }
  try {
    const docs = window.docsView.getDocs();
    const count = docs.filter(d => d.submissionId === sid).length;
    el.textContent = String(count);
  } catch (e) {
    el.textContent = '0';
  }
}
// Public hook: the Documents view calls this from renderDocsList so the
// count updates the moment uploads/deletes/hydration change the doc set.
window.refreshActiveSubmissionDocsCount = updateActiveSubmissionDocsCount;

// Cross-file functions called by other split files (in addition to inline
// handlers above). These were already on window via implicit attachment in
// the inline script, but explicit assignment is robust.
window.checkAuth = checkAuth;
window.sendMagicLink = sendMagicLink;
window.signOut = signOut;
window.currentActor = currentActor;
window.llmProxyFetch = llmProxyFetch;
window.getActiveGuideline = getActiveGuideline;
window.escapeHtml = escapeHtml;
window.sanitizeModelHtml = sanitizeModelHtml;
window.renderQueueTable = renderQueueTable;
window.renderFileList = renderFileList;
window.renderSummaryCards = renderSummaryCards;
window.renderHandoffState = renderHandoffState;
window.renderSubmissionSidebar = renderSubmissionSidebar;
window.renderMarkdown = renderMarkdown;
window.archiveCurrentSubmission = archiveCurrentSubmission;
window.updateDecisionPane = updateDecisionPane;
window.updateDecisionPaneIdle = updateDecisionPaneIdle;
window.updateFeedbackCount = updateFeedbackCount;
window.updateQueueKpi = updateQueueKpi;
window.updateRunButton = updateRunButton;
window.switchView = switchView;
window.logAudit = logAudit;
window.renderAuditIfOpen = renderAuditIfOpen;
window.toggleAuditLog = toggleAuditLog;
