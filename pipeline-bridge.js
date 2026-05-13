/* ======================================================================
   Speed to Market AI Unified Workbench Prototype
   Phase 01: intake -> mock pipeline -> draft review -> workbench autofill
   ----------------------------------------------------------------------
   This is intentionally deterministic. It demonstrates the final product
   shape before wiring to the live LLM/Supabase pipeline.
   ====================================================================== */
(function () {
  'use strict';

  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const SAMPLE_PACKET = {
    meta: {
      account: 'Ridgeway Utility Contractors, Inc.',
      broker: 'AmWINS Brokerage of Georgia',
      pipelineConfidence: 0.89,
      populated: 87,
      defaulted: 14,
      conflicts: 3,
      missing: 5
    },
    deal: {
      name: 'Ridgeway Utility Contractors, Inc.',
      dealType: 'New',
      policyEff: '2026-06-01',
      policyExp: '2027-06-01',
      homeState: 'GA',
      market: 'nonAdmitted',
      layerType: 'Excess Practice Construction',
      underwriter: 'Justin Wray',
      assistant: 'Casey Morgan',
      paper: 'Crestline E&S Insurance Company',
      submissionDate: '2026-05-13',
      quoteExpiration: '2026-06-12',
      targetDate: '2026-05-22',
      createdDate: '2026-05-13'
    },
    addresses: {
      mailing: '1400 Peachtree Industrial Blvd, Suite 210, Atlanta, GA 30341',
      controlling: '1400 Peachtree Industrial Blvd, Atlanta, GA 30341'
    },
    broker: {
      company: 'AmWINS Brokerage of Georgia',
      type: 'Wholesale',
      address: '3630 Peachtree Rd NE, Suite 1700, Atlanta, GA 30326',
      name: 'Sarah McKenzie',
      region: 'South East'
    },
    losses: {
      gl: [
        ['2025', '18,500,000', '2', '15,000', '0', '15,000', '2026-04-30'],
        ['2024', '17,200,000', '1', '8,500', '0', '8,500', '2026-04-30'],
        ['2023', '16,850,000', '0', '0', '0', '0', '2026-04-30']
      ],
      auto: [
        ['2025', '42', '1', '18,250', '0', '18,250', '2026-04-30'],
        ['2024', '39', '0', '0', '0', '0', '2026-04-30'],
        ['2023', '37', '1', '9,750', '0', '9,750', '2026-04-30']
      ]
    },
    coverages: {
      gl: {
        carrier: 'Great American E&S Insurance Company', eff: '2026-06-01', exp: '2027-06-01',
        occ: '1,000,000', agg: '2,000,000', pcAgg: '2,000,000', pai: '1,000,000', premium: '185,000'
      },
      al: {
        carrier: 'National Indemnity Company', eff: '2026-06-01', exp: '2027-06-01',
        csl: '1,000,000', premium: '96,000'
      },
      excess: {
        carrier: 'Zurich / Steadfast', eff: '2026-06-01', exp: '2027-06-01',
        limit: '10,000,000', aggregate: '10,000,000', premium: '240,000', attachment: '10,000,000', triaPct: '1.00', mep: '25'
      }
    },
    risk: {
      isoClass: '95233', isoDesc: 'Garbage, Ash or Refuse Collecting', hazard: '5 - High',
      exposure: '18,500,000', exposureBasis: 'Gross Sales/Revenues', website: 'https://ridgewayutility.example.com',
      statute: '8', dram: 'Low'
    },
    narratives: {
      descOps: 'Ridgeway Utility Contractors performs municipal utility and underground service work, with emphasis on small-diameter gas distribution, water, sewer, and street-opening work for towns, municipalities, and utility districts. The account is not a long-haul pipeline contractor; operations appear local/regional and tied to municipal utility maintenance and replacement work.',
      expLoss: 'Premises exposure is limited and secondary to field operations, with the main severity driven by street work, underground utility work, traffic control, excavation, and completed operations. Products exposure is incidental. Completed operations is the key GL severity driver given underground utility work, potential third-party property damage, service interruption, and bodily injury arising after completed work. Auto exposure is meaningful due to service trucks and field units traveling to job sites, but fleet size appears moderate and loss history is clean with no severe attachment-threatening losses identified.',
      acctStrengths: 'The account shows stable revenues, a long operating history, and favorable GL/Auto loss experience with no meaningful excess penetration. Work appears focused on municipal utility distribution and local service contracts rather than high-pressure transmission or long-haul pipeline construction, which materially improves risk quality. The primary terms appear adequate, and the risk provides a credible excess casualty opportunity subject to confirming final underlying forms, scheduled operations, and any gas-specific exclusions.',
      guidelineConflicts: 'Potential referral item: utility contractor / underground gas distribution work should be reviewed against construction hazard grade and attachment point guidance. If any waste hauling or concrete mix-in-transit exposure is confirmed, minimum attachment strategy may change. No prohibited exposure identified in this demo packet, but the system flags gas utility work for underwriter review.',
      rationale: '$10M xs $10M considered based on broker request and tower structure. Attachment excludes primary limits and is calculated from lead/excess layers only. Proposed structure follows strong underlying GL/AL terms, flat premium, TRIA accepted at 1%, and 25% minimum earned premium. Final quote subject to underlying forms, complete loss runs, and confirmation of gas distribution scope.'
    },
    review: {
      accepted: [
        'Named insured from ACORD 125 / GL quote match',
        'Policy term aligned across ACORD and GL quote',
        'GL and AL primary limits extracted from quote documents only',
        'Loss years separated by GL and Auto lines of business'
      ],
      defaulted: [
        'Underwriter defaulted to Justin Wray for prototype',
        'Assistant defaulted to Casey Morgan',
        'Broker type defaulted to Wholesale',
        'Quote expiration defaulted to 30 days from submission date',
        'TRIA defaulted to Accepted at 1% and 25% MEP'
      ],
      conflicts: [
        'Email requested $15M xs $10M; rule capped considered excess limit at $10M',
        'Website address differs slightly from GL quote physical address',
        'One supplemental exposure value conflicts with GL quote exposure schedule'
      ],
      missing: [
        'Complete copy of lead policy',
        'Final underlying GL policy forms',
        'Signed UM/UIM selection/rejection where required',
        'Confirmation of gas distribution pressure/scope',
        'Current subcontract agreement'
      ]
    }
  };

  const PIPELINE_STAGES = [
    { label: 'Stage 0', sub: 'Classify', nodes: [ ['CLS', 'Document routing', 'Acord · quote · loss · email'] ] },
    { label: 'Stage 1', sub: 'Extract · 10 Parallel', nodes: [
      ['A2', 'Supplemental App', 'ACORD 125 + supp'],
      ['A3', 'Subcontract', 'sub agreement'],
      ['A5', 'Safety Manual', 'safety program'],
      ['A11', 'Loss History', 'GL + Auto loss runs'],
      ['A12', 'Primary GL', 'GL quote'],
      ['A13', 'Primary AL', 'AL quote'],
      ['A14', 'Excess Policy', 'lead/excess quotes'],
      ['A16', 'Email Intel', 'broker cover email']
    ]},
    { label: 'Stage 2', sub: 'Normalize + Rules', nodes: [
      ['R1', 'Source Priority Resolver', 'ACORD > quote > email'],
      ['R2', 'Tower Resolver', 'limit caps + attachment'],
      ['R3', 'Workbench Draft Packet', '87 mapped fields']
    ]},
    { label: 'Stage 3', sub: 'Analyze · 4 Parallel', nodes: [
      ['A6', 'Summary of Operations', 'from A2+A3+A5'],
      ['A8', 'Guideline Cross-Ref', 'from A6 + rules'],
      ['A9', 'Exposure to Loss', 'from A6'],
      ['A10', 'Account Strengths', 'from A6'],
      ['A17', 'Discrepancy Check', 'email vs source docs']
    ]},
    { label: 'Stage 4', sub: 'Deliver', nodes: [ ['D1', 'Review Autofill', 'human approval gate'] ] }
  ];

  function init() {
    injectIntakeCard();
    injectReviewCard();
    injectPipelineModal();
  }

  function injectIntakeCard() {
    const page = q('#page-deal');
    const hero = q('.deal-hero', page);
    if (!page || !hero || q('#unifiedIntakeCard')) return;
    const card = document.createElement('section');
    card.className = 'card card--wide unified-intake-card';
    card.id = 'unifiedIntakeCard';
    card.innerHTML = `
      <header class="card-head">
        <div>
          <h2>Submission intake + AI pipeline</h2>
          <p class="card-subtitle">One-system flow: drop the broker email and docs, run the pipeline, review the draft, then populate the workbench tabs.</p>
        </div>
        <span class="forms-layer-indicator">Phase 01 Demo</span>
      </header>
      <div class="unified-intake-layout">
        <div class="unified-dropzone" id="unifiedDropzone" tabindex="0" role="button" aria-label="Load demo submission documents">
          <h3>Drop submission package here</h3>
          <p>This prototype simulates the final flow with a sample broker email, ACORD 125, GL quote, AL quote, loss runs, excess quote, and supplemental application.</p>
          <div class="unified-doc-pills" id="unifiedDocPills">
            <span class="unified-doc-pill">Broker Email</span>
            <span class="unified-doc-pill">ACORD 125</span>
            <span class="unified-doc-pill">GL Quote</span>
            <span class="unified-doc-pill">AL Quote</span>
            <span class="unified-doc-pill">Loss Runs</span>
            <span class="unified-doc-pill">Excess Quote</span>
          </div>
        </div>
        <aside class="unified-intake-side">
          <h3>What this demo will do</h3>
          <ul>
            <li><span>Classify docs into modules</span><span class="unified-small-tag">A2/A11/A12/A13/A14/A16</span></li>
            <li><span>Resolve source priority rules</span><span class="unified-small-tag">packet</span></li>
            <li><span>Apply lead/excess business rules</span><span class="unified-small-tag">caps + attachment</span></li>
            <li><span>Populate workbench tabs</span><span class="unified-small-tag">review gate</span></li>
          </ul>
          <div class="unified-action-row">
            <button type="button" class="btn-primary" id="runUnifiedPipelineBtn">Process Submission</button>
            <button type="button" class="btn-secondary" id="loadPacketBtn">View Draft Packet</button>
          </div>
          <p class="unified-secondary-note">Phase 01 uses mock extracted data. Later phases replace the mock with your live parser/classifier/LLM pipeline.</p>
        </aside>
      </div>`;
    hero.parentNode.insertBefore(card, hero);
    q('#runUnifiedPipelineBtn', card).addEventListener('click', runPipelineDemo);
    q('#loadPacketBtn', card).addEventListener('click', () => {
      window.alert(JSON.stringify(SAMPLE_PACKET, null, 2).slice(0, 3500) + '\n\n...packet truncated for display');
    });
    const dz = q('#unifiedDropzone', card);
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('is-dragging'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('is-dragging'); }));
    dz.addEventListener('click', () => pulseDocPills());
  }

  function injectReviewCard() {
    const page = q('#page-deal');
    const hero = q('.deal-hero', page);
    if (!page || !hero || q('#autofillReviewCard')) return;
    const review = document.createElement('section');
    review.className = 'card card--wide autofill-review-card';
    review.id = 'autofillReviewCard';
    review.innerHTML = `
      <header class="card-head">
        <div>
          <h2>Draft workbench ready</h2>
          <p class="card-subtitle">The pipeline resolved extracted facts into a reviewable underwriting draft. Apply high-confidence values to populate the tabs.</p>
        </div>
        <div class="unified-action-row">
          <button type="button" class="btn-primary" id="applyDraftBtn">Apply Draft to Workbench</button>
          <button type="button" class="btn-secondary" id="reviewUnderwritingBtn">Open Underwriting Tab</button>
        </div>
      </header>
      <div class="autofill-kpis">
        <div class="autofill-kpi"><span>Fields Populated</span><strong id="draftFieldsKpi">0</strong></div>
        <div class="autofill-kpi"><span>Defaulted by Rule</span><strong id="draftDefaultsKpi">0</strong></div>
        <div class="autofill-kpi"><span>Conflicts</span><strong id="draftConflictsKpi">0</strong></div>
        <div class="autofill-kpi"><span>Missing Info</span><strong id="draftMissingKpi">0</strong></div>
      </div>
      <div class="autofill-review-grid">
        <div class="autofill-review-list"><h3>Accepted / high confidence</h3><ul id="acceptedList"></ul></div>
        <div class="autofill-review-list"><h3>Defaults and conflicts</h3><ul id="defaultsList"></ul></div>
      </div>`;
    hero.parentNode.insertBefore(review, hero);
    q('#applyDraftBtn', review).addEventListener('click', () => applyPacketToWorkbench(SAMPLE_PACKET));
    q('#reviewUnderwritingBtn', review).addEventListener('click', () => clickMainTab('underwriting'));
  }

  function injectPipelineModal() {
    if (q('#pipelineModal')) return;
    const modal = document.createElement('div');
    modal.className = 'pipeline-modal';
    modal.id = 'pipelineModal';
    modal.innerHTML = `
      <div class="pipeline-shell" role="dialog" aria-modal="true" aria-labelledby="pipelineTitle">
        <div class="pipeline-shell-head">
          <div>
            <h2 id="pipelineTitle">Processing submission</h2>
            <p id="pipelineSubtitle">Classifying documents and building a reviewable workbench draft.</p>
          </div>
          <button type="button" class="pipeline-close" id="pipelineCloseBtn" aria-label="Close">×</button>
        </div>
        <div class="pipeline-body">
          <div class="pipeline-progress-row">
            <div class="pipeline-progress-track"><div class="pipeline-progress-fill" id="pipelineProgressFill"></div></div>
            <strong id="pipelineProgressText" class="unified-small-tag">0%</strong>
          </div>
          <div id="pipelineStages"></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    q('#pipelineCloseBtn', modal).addEventListener('click', () => modal.classList.remove('is-open'));
    q('#pipelineStages', modal).innerHTML = PIPELINE_STAGES.map((stage, sIdx) => `
      <div class="pipeline-stage-grid">
        <div class="pipeline-stage-label">${stage.label}<strong>${stage.sub}</strong></div>
        <div class="pipeline-node-grid">
          ${stage.nodes.map((n, nIdx) => `
            <div class="pipeline-node" data-node-index="${sIdx}-${nIdx}">
              <span class="pipeline-node-code">${n[0]}</span>
              <div class="pipeline-node-title">${n[1]}</div>
              <div class="pipeline-node-sub"><span>${n[2]}</span><span>queued</span></div>
            </div>`).join('')}
        </div>
      </div>`).join('');
  }

  async function runPipelineDemo() {
    const modal = q('#pipelineModal');
    const fill = q('#pipelineProgressFill');
    const pct = q('#pipelineProgressText');
    if (!modal || !fill || !pct) return;
    modal.classList.add('is-open');
    const nodes = qa('.pipeline-node', modal);
    nodes.forEach(n => {
      n.classList.remove('is-running', 'is-complete');
      const status = q('.pipeline-node-sub span:last-child', n);
      if (status) status.textContent = 'queued';
    });
    fill.style.width = '0%';
    pct.textContent = '0%';
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      n.classList.add('is-running');
      const status = q('.pipeline-node-sub span:last-child', n);
      if (status) status.textContent = 'running';
      await wait(130 + Math.random() * 140);
      n.classList.remove('is-running');
      n.classList.add('is-complete');
      if (status) status.textContent = 'conf ' + (88 + Math.floor(Math.random() * 10)) + '%';
      const progress = Math.round(((i + 1) / nodes.length) * 100);
      fill.style.width = progress + '%';
      pct.textContent = progress + '%';
    }
    populateReviewCard(SAMPLE_PACKET);
    setTimeout(() => modal.classList.remove('is-open'), 550);
  }

  function populateReviewCard(packet) {
    const card = q('#autofillReviewCard');
    if (!card) return;
    card.classList.add('is-visible');
    q('#draftFieldsKpi').textContent = packet.meta.populated;
    q('#draftDefaultsKpi').textContent = packet.meta.defaulted;
    q('#draftConflictsKpi').textContent = packet.meta.conflicts;
    q('#draftMissingKpi').textContent = packet.meta.missing;
    q('#acceptedList').innerHTML = packet.review.accepted.map(x => `<li>${escapeText(x)}<span class="autofill-badge">confirmed</span></li>`).join('');
    q('#defaultsList').innerHTML = packet.review.defaulted.concat(packet.review.conflicts).map((x, i) => `<li>${escapeText(x)}<span class="autofill-badge">${i < packet.review.defaulted.length ? 'default' : 'conflict'}</span></li>`).join('');
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function applyPacketToWorkbench(packet) {
    applyDeal(packet);
    applyAddressBroker(packet);
    applyLosses(packet);
    applyCoverages(packet);
    applyRiskProfile(packet);
    applyNarratives(packet);
    recordDemoHistory(packet);
    markAutofilledFields();
    window.alert('Draft applied. Deal Info, Loss History, Limits, Risk Profile, and Underwriting narratives have been populated for the demo.');
  }

  function applyDeal(packet) {
    const d = packet.deal;
    setValue('#dealName', d.name);
    setSelect('#admission', d.market);
    setSelect('#layerType', d.layerType);
    setSelect('#underwriter', d.underwriter);
    setSelect('#assistant', d.assistant);
    setValue('#paper', d.paper);
    setDate('#polEff', d.policyEff);
    setDate('#polExp', d.policyExp);
    setDate('#subDate', d.submissionDate);
    setDate('#quoteExp', d.quoteExpiration);
    setDate('#targetDate', d.targetDate);
    setDate('#createDate', d.createdDate);
    setSelect('#homeState', d.homeState);
    setText('#heroInsuredName', d.name);
    setText('#heroDealType', d.dealType);
    setText('#statAssignedValue', 'Justin');
    setText('#statAssignedCaption', 'Justin Wray / Casey Morgan');
    setText('#statTargetValue', 'May 22');
    setText('#statTargetCaption', 'Target from email fallback');
    setText('#statQuoteValue', '30');
    setText('#statQuoteCaption', 'days from submission');
    setText('#statTermValue', '12 mo');
    setText('#statTermCaption', '6/1/2026 to 6/1/2027');
  }

  function applyAddressBroker(packet) {
    setText('#mailingTxt', packet.addresses.mailing);
    setText('#controllingTxt', packet.addresses.controlling);
    setText('#brokerCoTxt', packet.broker.company);
    setText('#brokerTypeTxt', packet.broker.type);
    setText('#brokerAddrTxt', packet.broker.address);
    setText('#brokerNameTxt', packet.broker.name);
    setText('#regionTxt', packet.broker.region);
  }

  function applyLosses(packet) {
    fillLossRows('#glLossRows', packet.losses.gl);
    fillLossRows('#autoLossRows', packet.losses.auto);
    clickRiskTab('loss');
  }

  function fillLossRows(containerSelector, rows) {
    const wrap = q(containerSelector);
    if (!wrap) return;
    const domRows = qa('.loss-row', wrap);
    rows.forEach((row, idx) => {
      const dom = domRows[idx];
      if (!dom) return;
      const cells = qa('select, input', dom);
      if (cells[0]) { cells[0].value = row[0]; fire(cells[0], 'change'); }
      row.slice(1).forEach((val, i) => {
        const el = cells[i + 1];
        if (!el) return;
        if (el._flatpickr && /^\d{4}-\d{2}-\d{2}$/.test(val)) el._flatpickr.setDate(val, true);
        else setElementValue(el, val);
      });
    });
  }

  function applyCoverages(packet) {
    const gl = packet.coverages.gl;
    const al = packet.coverages.al;
    const xs = packet.coverages.excess;
    // Details panels contain plain repeated inputs; populate by local order.
    fillPanel('#details-gl', [gl.carrier, gl.eff, gl.exp, gl.occ, gl.agg, gl.pcAgg, gl.pai, gl.premium]);
    fillPanel('#details-al', [al.carrier, al.eff, al.exp, al.csl, al.premium]);
    fillPanel('#details-lead-excess', [xs.carrier, xs.eff, xs.exp, xs.limit, xs.aggregate, xs.premium, '', 'Flat', 'Accepted', xs.triaPct, xs.mep]);
    const glCheck = q('input[data-target="details-gl"]');
    const alCheck = q('input[data-target="details-al"]');
    const xsCheck = q('input[data-target="details-lead-excess"]');
    [glCheck, alCheck, xsCheck].forEach(chk => { if (chk && !chk.checked) chk.click(); });
  }

  function fillPanel(selector, values) {
    const panel = q(selector);
    if (!panel) return;
    const els = qa('input, select, textarea', panel).filter(el => !el.matches('[type="checkbox"]'));
    values.forEach((val, idx) => {
      const el = els[idx];
      if (!el || val === '') return;
      if (el.classList.contains('limit-date') || el._flatpickr) setDateElement(el, val);
      else setElementValue(el, val);
    });
  }

  function applyRiskProfile(packet) {
    const r = packet.risk;
    setValue('#isoClass', r.isoClass);
    setValue('#isoDesc', r.isoDesc);
    setValue('#hazardGrade', r.hazard);
    setValue('#exposureAmt input, #exposureAmt', r.exposure);
    setSelect('#exposureBasis', r.exposureBasis);
    setValue('#website', r.website);
    setValue('#statRepose', r.statute);
    setValue('#dramScore', r.dram);
  }

  function applyNarratives(packet) {
    setValue('#descOps', packet.narratives.descOps);
    setValue('#expLoss', packet.narratives.expLoss);
    setValue('#acctStrengths', packet.narratives.acctStrengths);
    setValue('#guidelineConflicts', packet.narratives.guidelineConflicts);
    setValue('#pricingRationale', packet.narratives.rationale);
  }

  function recordDemoHistory(packet) {
    const detail = `${packet.meta.populated} fields populated · ${packet.meta.conflicts} conflicts flagged · confidence ${Math.round(packet.meta.pipelineConfidence * 100)}%`;
    const log = q('#historyLog');
    if (log) {
      log.innerHTML = `<div class="history-entry"><div class="history-entry-main"><strong>Autofill draft applied</strong><span>${escapeText(detail)}</span></div><time>Now</time></div>` + log.innerHTML;
    }
  }

  function clickMainTab(page) {
    const li = q(`#mainNav li[data-page="${page}"]`);
    if (li) li.click();
  }
  function clickRiskTab(risk) {
    const li = q(`#riskNav li[data-risk="${risk}"]`);
    if (li) li.click();
  }

  function setValue(selector, value) {
    const el = q(selector);
    if (!el) return;
    setElementValue(el, value);
  }
  function setText(selector, value) {
    const el = q(selector);
    if (el) el.textContent = value;
  }
  function setSelect(selector, value) {
    const el = q(selector);
    if (!el || !value) return;
    const target = String(value).toLowerCase();
    const opt = Array.from(el.options || []).find(o => String(o.value || o.textContent).toLowerCase() === target || String(o.textContent).toLowerCase() === target);
    if (opt) el.value = opt.value || opt.textContent;
    else {
      const add = new Option(value, value);
      el.add(add);
      el.value = value;
    }
    fire(el, 'change');
  }
  function setDate(selector, iso) {
    const el = q(selector);
    if (el) setDateElement(el, iso);
  }
  function setDateElement(el, iso) {
    if (el._flatpickr) el._flatpickr.setDate(iso, true);
    else setElementValue(el, iso);
  }
  function setElementValue(el, value) {
    el.value = value;
    fire(el, 'input');
    fire(el, 'change');
  }
  function fire(el, eventName) {
    el.dispatchEvent(new Event(eventName, { bubbles: true }));
  }
  function markAutofilledFields() {
    ['#dealName','#polEff','#polExp','#homeState','#admission','#layerType','#underwriter','#assistant','#paper','#subDate','#quoteExp','#targetDate','#createDate','#descOps','#expLoss','#acctStrengths','#guidelineConflicts','#pricingRationale','#isoClass','#exposureAmt','#website'].forEach(sel => {
      const el = q(sel);
      if (!el) return;
      el.classList.add('autofilled-field');
      setTimeout(() => el.classList.remove('autofilled-field'), 4800);
    });
  }
  function pulseDocPills() {
    qa('.unified-doc-pill').forEach((el, i) => {
      setTimeout(() => {
        el.style.transform = 'translateY(-2px)';
        setTimeout(() => { el.style.transform = ''; }, 160);
      }, i * 60);
    });
  }
  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function escapeText(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Delay one tick so the original workbench app has time to build its dynamic rows.
    setTimeout(init, 50);
  });
})();
