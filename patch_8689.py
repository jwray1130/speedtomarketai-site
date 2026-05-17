from pathlib import Path
# Patch workbench-rules
p=Path('/mnt/data/stm_8689/workbench-rules.js')
s=p.read_text()
s=s.replace("version: 'v8.6.88-visible-lead-excess-header-fix'", "version: 'v8.6.89-premium-exposure-loss-polish'")
helper = r'''
  // v8.6.89 - quote premium allocation helpers.
  // Do NOT use package total premium or full Business Auto premium for primary GL/AL.
  // GL should use the Commercial General Liability line item. AL should use the
  // Business Auto LIABILITY line item only, excluding physical damage and APD charges.
  function premiumLineToDisplay89(v) {
    const n = moneyToNumberFor85(v);
    return n == null ? null : n.toLocaleString('en-US');
  }

  function findCoverageSummaryPremium89(clean, labelRe) {
    if (!clean) return null;
    const lines = String(clean).split(/\n+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    for (const line of lines) {
      if (!labelRe.test(line)) continue;
      const m = /\$\s*([0-9][0-9,]*(?:\.\d+)?)/.exec(line) || /\b([0-9]{2,3}(?:,[0-9]{3})+(?:\.\d+)?)\b/.exec(line);
      if (m) return premiumLineToDisplay89(m[1]);
    }
    return null;
  }

  function quotePremiumByCoverage89(clean, kind) {
    const c = clean || '';
    if (kind === 'gl') {
      return findCoverageSummaryPremium89(c, /\bCOMMERCIAL\s+GENERAL\s+LIABILITY\b/i)
          || findCoverageSummaryPremium89(c, /\bGENERAL\s+LIABILITY\b/i);
    }
    if (kind === 'al') {
      const lines = String(c).split(/\n+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
      for (const line of lines) {
        if (!/^LIABILITY\b/i.test(line)) continue;
        if (/HIRED|NON[-\s]*OWNED|PHYSICAL|COMPREHENSIVE|COLLISION/i.test(line)) continue;
        const dollars = Array.from(line.matchAll(/\$\s*([0-9][0-9,]*(?:\.\d+)?)/g)).map(m => m[1]);
        if (dollars.length) return premiumLineToDisplay89(dollars[dollars.length - 1]);
      }
      const m = /(?:^|\n)\s*LIABILITY\s+1\s+\$?\s*1,000,000[\s\S]{0,80}?\$\s*([0-9][0-9,]*(?:\.\d+)?)/i.exec(c);
      if (m) return premiumLineToDisplay89(m[1]);
      return null;
    }
    return null;
  }

'''
anchor='  // v8.6.86 - fleet classification engine.'
if helper not in s:
    s=s.replace(anchor, helper+anchor)
marker='    // v8.6.85: generic no-cost adapters used across modules.\n'
insert=r'''    // v8.6.89: premium source authority. Quote page line items beat generic
    // LLM prose labels like Total Premium/Annual Premium, which caused package
    // totals or full Business Auto premium to be applied to GL/AL liability.
    if (fieldName === 'gl_premium' && (moduleKey === 'gl_quote' || moduleKey === 'excess' || moduleKey === 'tower')) {
      const glPrem = quotePremiumByCoverage89(quoteFileClean || cleanPlusQuote, 'gl');
      if (glPrem) return hit(glPrem, 0.93, 'quote_coverage_line_commercial_general_liability');
    }
    if (fieldName === 'al_premium' && (moduleKey === 'al_quote' || moduleKey === 'excess' || moduleKey === 'tower')) {
      const alPrem = quotePremiumByCoverage89(quoteFileClean || cleanPlusQuote, 'al');
      if (alPrem) return hit(alPrem, 0.93, 'quote_auto_liability_line_only');
    }

'''
if insert not in s:
    s=s.replace(marker, insert+marker)
s=s.replace("if (fieldName === 'gl_premium') return hit(moneyLine(['GL Premium','Total Premium','Annual Premium','Premium']), 0.75, 'gl_premium');", "if (fieldName === 'gl_premium') return hit(moneyLine(['GL Premium','Commercial General Liability']), 0.75, 'gl_premium_specific');")
s=s.replace("if (fieldName === 'al_premium') return hit(moneyLine(['AL Premium','Auto Premium','Total Premium','Annual Premium','Premium']), 0.75, 'al_premium');", "if (fieldName === 'al_premium') return hit(moneyLine(['AL Premium','Auto Liability Premium']), 0.75, 'al_premium_specific');")
p.write_text(s)

# Patch workbench-app
p=Path('/mnt/data/stm_8689/workbench-app.js')
s=p.read_text()
s=s.replace("window.STM_BUILD = 'v8.6.88-visible-lead-excess-header-fix-2026-05-17';", "window.STM_BUILD = 'v8.6.89-premium-exposure-loss-polish-2026-05-17';")
for a,b in [
    ('v8.6.88 underwriting apply','v8.6.89 underwriting apply'),
    ('v8.6.88 GL exposure rater apply','v8.6.89 GL exposure rater apply'),
    ('v8.6.88 loss history apply','v8.6.89 loss history apply'),
    ('v8.6.88 AL fleet/code apply','v8.6.89 AL fleet/code apply'),
    ('v8.6.88 internal rater hydrate','v8.6.89 internal rater hydrate'),
    ('v8.6.88 Lead Excess card','v8.6.89 Lead Excess card'),
    ('v8.6.88 lead-excess card','v8.6.89 lead-excess card'),
    ('v8.6.88 losses skipped','v8.6.89 losses skipped'),
    ('v8.6.88 fleet skipped','v8.6.89 fleet skipped'),
    ('v8.6.88 rater skipped','v8.6.89 rater skipped'),
    ('v8.6.88 field coverage report','v8.6.89 field coverage report')]:
    s=s.replace(a,b)
s=s.replace("row.dataset.hydratedFromResolver = 'v8.6.88';", "row.dataset.hydratedFromResolver = 'v8.6.89';")
helper_app = r'''
        // v8.6.89 - parse all GL class rows from quote / ACORD page text and
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
        function stateZipFromSubmission89(submission) {
            const text = [submission?.mailing_address, submission?.controlling_address, submission?.address, JSON.stringify(submission?.snapshot?.handoff || {})].filter(Boolean).join(' ')
                + '\n' + collectSnapshotFileTexts89(submission, /acord|application|quote|supp/i);
            const m = /\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/.exec(text);
            return { state: m ? m[1] : (r85('home_state', submission) || 'VA'), zip: m ? m[2] : '' };
        }
        function parseGLClassRows89(submission) {
            const text = collectSnapshotFileTexts89(submission, /quote|acord|application|gl|exposure|supp/i);
            const rows = [];
            const seen = new Set();
            const mapDesc = d => String(d || '').replace(/\s+/g, ' ').replace(/[-–—]\s*$/, '').trim();
            const add = (desc, code, exposure) => {
                const n = Number(String(exposure || '').replace(/[^0-9]/g, '')) || 0;
                if (!/^\d{4,5}$/.test(String(code || '')) || n <= 0) return;
                if (n < 100000) return;
                const key = code + ':' + n;
                if (seen.has(key)) return;
                seen.add(key);
                rows.push({ code:String(code), desc:mapDesc(desc), exposure:n.toLocaleString('en-US'), base:'1000' });
            };
            const lines = String(text || '').split(/\n+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
            for (const line of lines) {
                let m = /^(.{3,90}?)\s+(\d{4,5})\s+(\d{1,3}(?:,\d{3})+|\d{5,})\s+\(?0*1\)?\b/i.exec(line);
                if (m) { add(m[1], m[2], m[3]); continue; }
                m = /\b(\d{4,5})\b\s+(.{3,90}?)\s+\$?\s*(\d{1,3}(?:,\d{3})+|\d{5,})\b/i.exec(line);
                if (m && !/Premium|Limit|Deductible/i.test(line)) add(m[2], m[1], m[3]);
            }
            return rows.slice(0, 8);
        }

'''
marker3='        function applyGLExposureRaterFromActiveSubmission(submission) {\n'
if helper_app not in s:
    s=s.replace(marker3, helper_app+marker3)
start=s.index('        function applyGLExposureRaterFromActiveSubmission(submission) {')
end=s.index('\n\n        // v8.6.87', start)
new_func=r'''        function applyGLExposureRaterFromActiveSubmission(submission) {
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
            console.log('[workbench] v8.6.89 GL exposure rater apply:', filled, 'cells filled', rowsToApply);
        }
'''
s=s[:start]+new_func+s[end:]
p.write_text(s)
print('patched ok')
