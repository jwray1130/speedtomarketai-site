// ============================================================================
// scraper.js — Altitude / Speed to Market AI
// ============================================================================
// Extracted from app.html as Phase 8 step 5 (maintainability split).
// The website-scraping subsystem: BFS crawler with sitemap discovery, CORS
// proxy rotation, Jina Reader fallback. Triggered when a UW clicks Auto-Find
// or Manual URL on the submission INSURED WEBSITE SCRAPE block.
//
// Loaded via <script src="scraper.js"> AFTER the inline init script (which
// defines llmProxyFetch and the other utilities the scraper calls).
//
// External globals this file uses at CALL time (must exist on window or in
// global scope by then):
//   STATE              — STATE.files for ingesting scraped pages
//   logAudit, toast    — diagnostic helpers
//   escapeHtml         — XSS sanitizer
//   llmProxyFetch      — Edge Function proxy (Phase 2)
//   incrementalProcess — feeds scraped pages back into the pipeline
//   renderFileList     — re-renders the file chips after ingestion
//   updateRunButton    — re-enables the Run button when ready
//
// Functions exported on window via the explicit footer block (same lesson
// from steps 3-4: never rely on implicit global attachment across script
// boundaries when explicit `window.X = X` makes the contract obvious).
//
// Phase 8 design rule: byte-for-byte preservation of every function body.
// No logic changed, only file location.
// ============================================================================

// ============================================================================
// WEBSITE SCRAPE (Session 8) — fetch an insured's public website and ingest it
// as a pseudo-file that feeds the A1 website-intel extraction module.
//
// Progressive fallback chain:
//   1. CORS proxy (corsproxy.io / allorigins.win) — works for most public sites
//   2. Claude web_fetch tool routed through the authenticated llm-proxy Edge
//      Function (Phase 3 moved API keys server-side; the browser never holds one)
//   3. Prompt user to paste HTML manually via manualPasteModal
//
// All three paths end with the same result: a STATE.files entry of type 'website'
// that flows through the pipeline exactly like an uploaded file.
// ============================================================================
function setWebTab(tab) {
  document.getElementById('webTabUrl').classList.toggle('active', tab === 'url');
  document.getElementById('webTabFind').classList.toggle('active', tab === 'find');
  document.getElementById('webBodyUrl').style.display = tab === 'url' ? 'flex' : 'none';
  document.getElementById('webBodyFind').style.display = tab === 'find' ? 'flex' : 'none';
  document.getElementById('webStatus').style.display = 'none';
}

function setWebStatus(msg, kind) {
  const el = document.getElementById('webStatus');
  el.className = 'web-status' + (kind ? ' ' + kind : '');
  const spinner = kind === 'running' ? '<span class="web-status-spinner"></span>' : '';
  el.innerHTML = spinner + msg;
  el.style.display = 'block';
}

// Normalize input — ensure it has a protocol, strip whitespace
function normalizeUrl(raw) {
  let url = (raw || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); return url; } catch { return null; }
}

// Strip HTML down to plain visible text — removes nav/footer/scripts/comments/svgs.
function htmlToText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  // Remove junk elements
  tmp.querySelectorAll('script, style, noscript, iframe, svg, nav, footer, header[role="banner"], .cookie-banner, .cookie-notice, [aria-hidden="true"]').forEach(el => el.remove());
  // Prefer <main> / <article> / body content
  const main = tmp.querySelector('main') || tmp.querySelector('article') || tmp.querySelector('#content') || tmp.querySelector('.content') || tmp;
  let text = (main.innerText || main.textContent || '').replace(/\s+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  // Also grab title + meta description for context
  const title = tmp.querySelector('title')?.textContent?.trim() || '';
  const meta = tmp.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || '';
  let prefix = '';
  if (title) prefix += '=== PAGE TITLE ===\n' + title + '\n\n';
  if (meta) prefix += '=== META DESCRIPTION ===\n' + meta + '\n\n';
  return prefix + '=== PAGE CONTENT ===\n' + text;
}

// Extract candidate internal links for comprehensive crawling. This is the "discovery"
// step — we want EVERY page that's likely to have operational content, then we'll let
// the crawler decide how deep to go and the skip-list decide what to ignore.
//
// Strategy:
//   - Pull links from <nav>, <header>, <footer>, and <main> separately (nav/footer are
//     authoritative site maps; main-area links catch cross-linked content)
//   - Same-domain only
//   - Skip obvious non-content URLs (mailto, tel, hash-only, file downloads)
//   - Skip boilerplate pages (privacy, terms, careers, login, cart, 404)
//   - Return in nav-order (sites list their most important pages first in nav)
function extractCandidateLinks(html, baseUrl) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const base = new URL(baseUrl);
  const targets = [];
  const seen = new Set();
  // Pages we never want to scrape — boilerplate, legal, auth, ecommerce, download links
  const SKIP_PATTERNS = /(^|\/)(privacy|terms|tos|legal|cookie|disclaimer|accessibility|sitemap|login|sign-?in|sign-?up|register|account|cart|checkout|search|careers?|jobs?|contact|404|403|feed|rss|wp-admin|wp-login|wp-content)(\/|\.|\?|$)/i;
  // File extensions we skip (images, docs, archives — not HTML pages)
  const SKIP_EXT = /\.(pdf|doc|docx|xls|xlsx|zip|tar|gz|dmg|exe|pkg|mp4|mp3|avi|mov|jpg|jpeg|png|gif|svg|webp|ico|css|js|json|xml)($|\?)/i;

  // Prioritize by source element — nav/footer links are the "site map"
  // Prioritize by source element. In priority order:
  //   1 — primary navigation (top nav, header, role=navigation, tab lists)
  //   2 — sidebars (likely section/service sub-nav on B2B contractor sites)
  //   3 — footers (site map pattern — every company lists all pages here)
  //   4 — main content (cross-linked articles, service detail pages)
  //   5 — anywhere else (catch-all)
  const sourcePriority = [
    ['nav a[href]', 1],
    ['header a[href]', 1],
    ['[role="navigation"] a[href]', 1],
    ['[role="tablist"] a[href]', 1],
    ['[role="tab"][href]', 1],
    ['.tabs a[href]', 1],
    ['.tab-list a[href]', 1],
    ['ul.menu a[href]', 1],
    ['aside a[href]', 2],
    ['[role="complementary"] a[href]', 2],
    ['.sidebar a[href]', 2],
    ['#sidebar a[href]', 2],
    ['.sub-nav a[href]', 2],
    ['footer a[href]', 3],
    ['[role="contentinfo"] a[href]', 3],
    ['main a[href]', 4],
    ['article a[href]', 4],
    ['a[href]', 5]  // fallback — everything else
  ];

  const withPriority = [];
  sourcePriority.forEach(([sel, pri]) => {
    tmp.querySelectorAll(sel).forEach(a => {
      try {
        const href = a.getAttribute('href');
        if (!href) return;
        if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
        const abs = new URL(href, base).href;
        const absUrl = new URL(abs);
        if (absUrl.hostname !== base.hostname) return;
        // Normalize — strip hash, drop trailing slash inconsistency. We keep
        // the query string since many sites use ?tab=… or ?category=… for
        // real content differentiation (these are often the "clickable tabs"
        // people worry about — if the server returns different HTML per
        // query string, BFS will naturally capture each variant).
        absUrl.hash = '';
        const norm = absUrl.href.replace(/\/$/, '');
        if (seen.has(norm)) return;
        const path = absUrl.pathname;
        if (path === '/' || path === base.pathname) return;
        if (SKIP_PATTERNS.test(path)) return;
        if (SKIP_EXT.test(path)) return;
        seen.add(norm);
        withPriority.push({ url: abs, priority: pri, linkText: (a.textContent || '').trim().slice(0, 60) });
      } catch {}
    });
  });

  // Sort by priority (nav > sidebar > footer > main > other)
  withPriority.sort((a, b) => a.priority - b.priority);
  return withPriority;
}

// Remove boilerplate that repeats across pages (same header/footer text, copyright lines,
// "© 2024 Meridian" etc.). Helps save LLM tokens and focuses the output on actual content.
function dedupeBoilerplate(pagesTexts) {
  if (pagesTexts.length < 3) return pagesTexts;  // not enough samples to find boilerplate
  // Find lines that appear in >50% of pages → likely boilerplate
  const lineCounts = new Map();
  const perPageLines = pagesTexts.map(t => {
    const lines = t.split('\n').map(l => l.trim()).filter(l => l.length > 20);  // only substantive lines
    return new Set(lines);
  });
  for (const lineSet of perPageLines) {
    for (const line of lineSet) {
      lineCounts.set(line, (lineCounts.get(line) || 0) + 1);
    }
  }
  const threshold = Math.ceil(pagesTexts.length * 0.6);
  const boilerplateLines = new Set();
  for (const [line, count] of lineCounts) {
    if (count >= threshold) boilerplateLines.add(line);
  }
  if (boilerplateLines.size === 0) return pagesTexts;
  // Strip boilerplate lines from each page
  return pagesTexts.map(t =>
    t.split('\n').filter(l => !boilerplateLines.has(l.trim())).join('\n')
  );
}

// Discover sitemap URLs for a site. Checks /sitemap.xml, /sitemap_index.xml,
// and follows Sitemap: directives in /robots.txt. Returns an array of URLs.
// Empty array if no sitemap found or all fetches failed.
//
// Sitemaps give us the AUTHORITATIVE list of every page the site wants indexed —
// typically 50–500 URLs on a mid-size commercial site, vs 5–20 via nav-link BFS.
// This is the single biggest crawl-quality improvement for sites that publish one.
async function discoverSitemapUrls(startUrl) {
  const base = new URL(startUrl);
  const urls = [];
  // Candidate sitemap locations, in order of likelihood
  const candidates = [
    base.origin + '/sitemap.xml',
    base.origin + '/sitemap_index.xml',
    base.origin + '/sitemap-index.xml',
    base.origin + '/wp-sitemap.xml',          // WordPress
    base.origin + '/sitemap.xml.gz'
  ];
  // Also peek at robots.txt for Sitemap: directives
  try {
    const rob = await fetchTextViaProxy(base.origin + '/robots.txt');
    if (rob) {
      const smLines = rob.match(/^\s*Sitemap:\s*(.+)$/gim) || [];
      smLines.forEach(line => {
        const m = line.match(/Sitemap:\s*(.+)/i);
        if (m && m[1]) candidates.unshift(m[1].trim());   // robots.txt wins priority
      });
    }
  } catch { /* robots.txt optional */ }

  for (const smUrl of candidates) {
    try {
      const xml = await fetchTextViaProxy(smUrl);
      if (!xml || xml.length < 40) continue;
      // <sitemapindex> → list of child sitemaps (recurse one level)
      const childSitemaps = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m => m[1].trim());
      if (childSitemaps.length > 0) {
        // Expand up to 10 child sitemaps to keep discovery bounded
        for (const childUrl of childSitemaps.slice(0, 10)) {
          try {
            const childXml = await fetchTextViaProxy(childUrl);
            if (!childXml) continue;
            const locs = [...childXml.matchAll(/<url>[\s\S]*?<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m => m[1].trim());
            urls.push(...locs);
          } catch {}
          if (urls.length > 500) break;   // hard cap on sitemap expansion
        }
      } else {
        // Plain <urlset> sitemap
        const locs = [...xml.matchAll(/<url>[\s\S]*?<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m => m[1].trim());
        urls.push(...locs);
      }
      if (urls.length > 0) return urls.slice(0, 500);
    } catch { /* try next candidate */ }
  }
  return urls;
}

// Lightweight text fetch via the first available CORS proxy. Used for
// sitemap.xml / robots.txt — small text files that don't need the
// SPA-detection logic in fetchViaProxy.
async function fetchTextViaProxy(url) {
  const proxies = [
    u => 'https://corsproxy.io/?' + encodeURIComponent(u),
    u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    u => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u)
  ];
  for (const mk of proxies) {
    try {
      const res = await fetch(mk(url), { method: 'GET' });
      if (!res.ok) continue;
      const text = await res.text();
      if (text && text.length > 20) return text;
    } catch {}
  }
  return null;
}

// Fetch a URL via a chain of fallback services. Returns { html, source } or throws.
//
// Strategy (in order):
//   1) Three HTML CORS proxies (corsproxy.io, allorigins, codetabs, cors.sh).
//      These return the raw HTML exactly as the server sent it — fast, cheap,
//      works for server-rendered sites (WordPress, static, etc.).
//   2) Jina Reader (r.jina.ai) — a free JS-rendering reader that executes
//      JavaScript in a headless browser and returns clean markdown/text of
//      the fully-rendered page. The escape hatch for React/Next.js/Vue SPAs
//      that return an empty `<div id="root">` from raw HTML fetches.
//
// The caller gets back `{ html, source }`. If the source is 'jina' the
// "html" is already clean text (no tags) and htmlToText() will just
// normalize whitespace — safe to run either way.
async function fetchViaProxy(url) {
  // Tier 1 — raw HTML proxies. Try each in order; any 2xx with non-tiny body wins.
  const htmlProxies = [
    { name: 'corsproxy.io', mk: u => 'https://corsproxy.io/?' + encodeURIComponent(u) },
    { name: 'allorigins',   mk: u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
    { name: 'codetabs',     mk: u => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u) },
    { name: 'cors.sh',      mk: u => 'https://proxy.cors.sh/' + u }
  ];
  let lastErr = null;
  for (const proxy of htmlProxies) {
    try {
      const res = await fetch(proxy.mk(url), { method: 'GET' });
      if (!res.ok) { lastErr = new Error(proxy.name + ' HTTP ' + res.status); continue; }
      const html = await res.text();
      // Guard against SPA shells — if the HTML is clearly an empty React/Vue
      // root, skip it and let Jina handle it. We detect by looking for a real
      // amount of text content inside <body>.
      if (html && html.length > 500 && hasMeaningfulContent(html)) {
        return { html, source: proxy.name };
      }
      lastErr = new Error(proxy.name + ' returned ' + (html ? html.length : 0) + ' chars · likely SPA shell');
    } catch (e) {
      lastErr = new Error(proxy.name + ': ' + e.message);
    }
  }
  // Tier 2 — Jina Reader. JS-renders the page in a cloud browser and returns
  // clean text. Slower than the HTML proxies but handles modern SPAs.
  try {
    const jinaUrl = 'https://r.jina.ai/' + url;
    const res = await fetch(jinaUrl, { method: 'GET', headers: { 'Accept': 'text/plain' } });
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 100) {
        // Wrap the text in a minimal HTML doc so htmlToText() produces the same
        // downstream shape as the raw-proxy path. Page title / meta will be
        // absent but the body content is what drives extraction anyway.
        const wrapped = '<!doctype html><html><head><title></title></head><body><main>' +
                        escapeHtmlForWrapper(text) + '</main></body></html>';
        return { html: wrapped, source: 'jina (JS-rendered)' };
      }
      lastErr = new Error('Jina returned ' + (text ? text.length : 0) + ' chars');
    } else {
      lastErr = new Error('Jina HTTP ' + res.status);
    }
  } catch (e) {
    lastErr = new Error('Jina: ' + e.message);
  }
  throw new Error('All fetchers failed · last: ' + (lastErr ? lastErr.message : 'unknown'));
}

// Quick heuristic: does this HTML actually have rendered text content, or is it
// an empty SPA shell waiting for JavaScript to fill it in? We look for >300 chars
// of visible text inside <body>, excluding script/style tags.
function hasMeaningfulContent(html) {
  try {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : html;
    // Strip scripts/styles/comments before counting text
    const cleaned = body
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.length > 300;
  } catch {
    return html.length > 1000;  // fallback
  }
}

// Escape only the characters that could break out of a wrapper HTML element.
// The wrapper's only purpose is so htmlToText() can normalize whitespace.
function escapeHtmlForWrapper(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================================
// COMPREHENSIVE CRAWLER — BFS up to depth 2, full nav discovery, dedup, budgeted
// ============================================================================
// Defaults produce a 30-60 page scrape for most corporate sites (~60-120s total).
// - Sitemap: if /sitemap.xml or /robots.txt reveals a sitemap, seed queue from it
//   (many corp sites have 50–500 URLs listed — this is the single biggest quality lift)
// - Depth 1: homepage + all nav/footer/aside/sidebar links
// - Depth 2-3: follow deeper to capture /services/commercial/foo-bar style nested IA
// - Hard caps: max 60 pages, max 240s elapsed, avoid crawl explosion on huge sites
async function scrapeUrl(url, options = {}) {
  const MAX_PAGES = options.maxPages || 60;
  const MAX_DEPTH = options.maxDepth || 3;
  const MAX_ELAPSED_MS = options.maxElapsedMs || 240000;  // 4 min hard cap
  const startTime = Date.now();

  // Queue entries: { url, depth, linkText? }
  const queue = [{ url, depth: 0 }];
  const visited = new Set();
  const pagesScraped = [];  // { url, text, depth, linkText? }
  let failCount = 0;

  setWebStatus('<strong>Starting crawl</strong> of ' + url.replace(/^https?:\/\//, '') + '…', 'running');
  logAudit('Scrape', '=== CRAWL START · ' + url + ' · browser BFS (max ' + MAX_PAGES + ' pages, depth ' + MAX_DEPTH + ') ===', 'ok');

  // ---- Sitemap discovery ----
  // Before we crawl, try to find a sitemap. Sitemaps are the authoritative
  // list of every page a site wants indexed — if one exists, it's way better
  // than heuristic link-following. We check /sitemap.xml directly, then
  // /robots.txt for "Sitemap:" directives. All discovered URLs get appended
  // to the BFS queue at depth 1 (not 0, so the homepage still goes first).
  try {
    setWebStatus('<strong>Checking sitemap</strong>…', 'running');
    const sitemapUrls = await discoverSitemapUrls(url);
    if (sitemapUrls.length > 0) {
      // Filter to same-domain and skip boilerplate pages
      const base = new URL(url);
      const SKIP = /(^|\/)(privacy|terms|tos|legal|cookie|disclaimer|accessibility|sitemap|login|sign-?in|sign-?up|register|account|cart|checkout|search|404|feed|rss|wp-admin|wp-login)(\/|\.|\?|$)/i;
      const added = new Set();
      for (const smUrl of sitemapUrls) {
        try {
          const u = new URL(smUrl);
          if (u.hostname !== base.hostname) continue;
          if (SKIP.test(u.pathname)) continue;
          const key = u.href.replace(/\/$/, '');
          if (added.has(key)) continue;
          added.add(key);
          queue.push({ url: smUrl, depth: 1, linkText: 'sitemap' });
        } catch {}
      }
      logAudit('Scrape', 'Sitemap discovered · ' + added.size + ' URLs added to crawl queue', 'ok');
    }
  } catch (e) {
    // Sitemap is optional — if it fails, fall back to pure BFS from homepage
    logAudit('Scrape', 'No sitemap found, using BFS discovery only', 'ok');
  }

  while (queue.length > 0 && pagesScraped.length < MAX_PAGES) {
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_ELAPSED_MS) {
      logAudit('Classifier', 'Crawl time budget exceeded at ' + pagesScraped.length + ' pages', 'warn');
      break;
    }
    const { url: pageUrl, depth, linkText } = queue.shift();
    // Normalize + dedup
    let normUrl;
    try { normUrl = new URL(pageUrl); normUrl.hash = ''; } catch { continue; }
    const key = normUrl.href.replace(/\/$/, '');
    if (visited.has(key)) continue;
    visited.add(key);

    // Status update
    setWebStatus(
      '<strong>Crawling</strong> page ' + (pagesScraped.length + 1) + '/' + MAX_PAGES +
      ' (depth ' + depth + '): ' +
      normUrl.pathname.slice(0, 50) + (normUrl.pathname.length > 50 ? '…' : '') +
      '<br><span style="color: var(--text-3); font-size: 10px;">' +
      pagesScraped.length + ' scraped · ' + failCount + ' skipped · ' + Math.round(elapsed / 1000) + 's elapsed</span>',
      'running'
    );

    let html, fetchSource;
    try {
      const fr = await fetchViaProxy(pageUrl);
      html = fr.html;
      fetchSource = fr.source;
    } catch (e) {
      failCount++;
      logAudit('Scrape', 'Page FAILED · ' + pageUrl + ' — ' + e.message, 'warn');
      continue;
    }

    const pageText = htmlToText(html);
    if (pageText && pageText.length > 80) {
      pagesScraped.push({ url: pageUrl, text: pageText, depth, linkText });
      // Granular per-page audit — the UW can scroll the audit log to verify
      // every tab on the insured's site was reached. If something's missing,
      // they'll see it's missing from this list.
      const pagePath = (() => { try { return new URL(pageUrl).pathname || '/'; } catch { return pageUrl; } })();
      logAudit('Scrape', 'Page ' + pagesScraped.length + ' · ' + pagePath + ' · ' + Math.round(pageText.length / 1024 * 10) / 10 + 'K chars · via ' + (fetchSource || 'proxy') + (linkText ? ' · link text: "' + linkText.slice(0, 40) + '"' : ''), 'ok');
    } else {
      logAudit('Scrape', 'Page SKIPPED (too short) · ' + pageUrl + ' · ' + (pageText?.length || 0) + ' chars', 'warn');
    }

    // Discover links from this page if we're still under depth limit
    if (depth < MAX_DEPTH) {
      const candidates = extractCandidateLinks(html, pageUrl);
      for (const { url: candUrl, linkText: cLinkText } of candidates) {
        try {
          const candNorm = new URL(candUrl);
          candNorm.hash = '';
          const candKey = candNorm.href.replace(/\/$/, '');
          if (!visited.has(candKey)) {
            queue.push({ url: candUrl, depth: depth + 1, linkText: cLinkText });
          }
        } catch {}
      }
    }
  }

  if (pagesScraped.length === 0) {
    throw new Error('Could not fetch any pages from ' + url + '. Site may be bot-blocked, JS-only, or offline. Try pasting HTML manually.');
  }

  // Dedupe boilerplate that repeats across pages
  const texts = pagesScraped.map(p => p.text);
  const deduped = dedupeBoilerplate(texts);

  // Assemble final text with section headers per page
  let combinedText = '# SITE CRAWL: ' + url + '\n';
  combinedText += 'Pages scraped: ' + pagesScraped.length + ' · Elapsed: ' + Math.round((Date.now() - startTime) / 1000) + 's\n\n';
  pagesScraped.forEach((p, i) => {
    combinedText += '=====================================\n';
    combinedText += '# PAGE ' + (i + 1) + ': ' + p.url + '\n';
    if (p.linkText) combinedText += '# (linked as: "' + p.linkText + '")\n';
    combinedText += '=====================================\n\n';
    combinedText += deduped[i] + '\n\n';
  });

  return {
    url,
    text: combinedText,
    subPages: pagesScraped.slice(1).map(p => p.url),  // exclude homepage
    totalPages: pagesScraped.length,
    failedPages: failCount,
    elapsedMs: Date.now() - startTime,
    method: 'browser-crawl'
  };
}

// ============================================================================
// CLAUDE-DRIVEN CRAWL — uses server-side web_fetch via the real API. Claude
// decides which pages to read based on actual content, not hardcoded patterns.
// Uses the server-side proxy to access the Anthropic API. Produces a richer,
// more intelligently filtered scrape but costs API tokens.
// ============================================================================
async function scrapeUrlViaClaude(url) {
  setWebStatus('<strong>Claude-driven crawl</strong> starting for ' + url.replace(/^https?:\/\//, '') + '…', 'running');
  logAudit('Scrape', '=== CRAWL START · ' + url + ' · Claude agentic (max 25 pages, AI-selected) ===', 'ok');

  const crawlPrompt = `You are an excess casualty insurance underwriter researching a commercial insured's website. Your goal is to extract every operationally-relevant fact from their public web presence.

TARGET: ${url}

YOUR JOB:
1. Fetch the homepage first.
2. Based on the nav and content, identify up to 20 sub-pages that likely contain operational information: services, capabilities, markets, safety programs, certifications, leadership, projects, case studies, locations, industries served, equipment, etc.
3. Skip boilerplate: privacy/terms/careers/contact/login/search/cart pages — these have no UW value.
4. Fetch each chosen sub-page.
5. Return ALL the raw text content from every page you fetched, organized with clear page headers.

OUTPUT FORMAT:
# SITE CRAWL: <url>
Pages scraped: <N>

=====================================
# PAGE 1: <full url>
=====================================
<full text content of page 1>

=====================================
# PAGE 2: <full url>
=====================================
<full text content of page 2>

...and so on for every page.

Do NOT summarize or paraphrase — return the raw extracted text. Downstream modules will do the analysis. Your job is comprehensive retrieval.

START CRAWLING.`;

  const body = {
    model: STATE.api.model || 'claude-opus-4-7',
    max_tokens: 16000,
    messages: [{ role: 'user', content: crawlPrompt }],
    tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 25 }]
  };

  const data = await llmProxyFetch(body, { 'anthropic-beta': 'web-fetch-2025-09-10' });

  // Count fetches from the content blocks (server-side tool uses)
  const fetchCalls = (data.content || []).filter(b => b.type === 'tool_use' && b.name === 'web_fetch').length;
  // Extract the final text output
  const textBlock = (data.content || []).reverse().find(b => b.type === 'text');
  if (!textBlock) throw new Error('Claude returned no text output');
  const combinedText = textBlock.text;

  // Parse the returned text to count pages (each `# PAGE N:` header)
  const pageHeaderMatches = combinedText.match(/^# PAGE \d+:/gm) || [];
  const pageCount = pageHeaderMatches.length || fetchCalls || 1;
  // Extract sub-page URLs from the headers (best-effort)
  const subPages = [];
  const headerMatches = [...combinedText.matchAll(/^# PAGE \d+: (https?:\/\/\S+)/gm)];
  headerMatches.forEach((m, i) => {
    if (i > 0) subPages.push(m[1]);  // skip homepage (page 1)
  });

  // Per-page audit log — extract each page's URL + approximate content size
  // by finding the content between consecutive page markers. Lets the UW
  // verify exactly which pages Claude chose to fetch.
  const pageSections = combinedText.split(/^=+\s*\n# PAGE \d+: /gm);
  // pageSections[0] is the header text before any page; the rest are content blocks
  [...combinedText.matchAll(/^# PAGE (\d+): (https?:\/\/\S+)/gm)].forEach((m, i) => {
    const pageNum = m[1];
    const pageUrl = m[2];
    const contentLen = pageSections[i + 1] ? pageSections[i + 1].length : 0;
    const path = (() => { try { return new URL(pageUrl).pathname || '/'; } catch { return pageUrl; } })();
    logAudit('Scrape', 'Page ' + pageNum + ' · ' + path + ' · ' + Math.round(contentLen / 1024 * 10) / 10 + 'K chars · selected by Claude', 'ok');
  });

  return {
    url,
    text: combinedText,
    subPages,
    totalPages: pageCount,
    failedPages: 0,
    method: 'claude-crawl',
    fetchCalls
  };
}

// Top-level flow — called from the "Scrape" button. Always uses the browser
// BFS crawler (faster, deterministic, zero token cost, more pages crawled).
async function scrapeWebsiteFromUrl() {
  const raw = document.getElementById('webUrlInput').value;
  const url = normalizeUrl(raw);
  if (!url) {
    setWebStatus('Enter a valid URL first (e.g. https://www.example.com)', 'error');
    return;
  }
  const btn = document.getElementById('btnScrapeUrl');
  btn.disabled = true;
  try {
    // Always use the browser BFS crawler. The Claude-driven crawl path
    // (scrapeUrlViaClaude) is preserved for reference but disabled — it was
    // designed for direct-API-key access; routed through the llm-proxy Edge
    // Function it can't use web_fetch tools effectively. Browser BFS is faster,
    // deterministic, costs zero tokens, and crawls more pages.
    const useClaude = false;
    const result = useClaude ? await scrapeUrlViaClaude(url) : await scrapeUrl(url);
    // Turn this into a pseudo-file entry that flows through the normal pipeline.
    ingestScrapedWebsite(url, result.text, result.subPages, {
      foundVia: 'direct-url',
      method: result.method,
      totalPages: result.totalPages,
      failedPages: result.failedPages || 0,
      elapsedMs: result.elapsedMs
    });
  } catch (err) {
    setWebStatus('<strong>Scrape failed</strong> — ' + err.message, 'error');
    logAudit('Classifier', 'Website scrape failed for ' + url + ': ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// Find-by-name flow — primary path. Uses Claude's web_search tool through the
// authenticated llm-proxy Edge Function to identify the authoritative domain.
// If auto-find fails (no result, tool unavailable, or any error), we
// automatically switch to the Manual URL tab so the user can enter it directly.
async function findAndScrapeWebsite() {
  const name = document.getElementById('webNameInput').value.trim();
  const zip = document.getElementById('webZipInput').value.trim();
  if (!name) {
    setWebStatus('Enter the named insured first', 'error');
    return;
  }
  if (!window.currentUser) {
    // Not signed in — auto-search isn't available. Switch to Manual URL tab.
    switchToManualUrlTab('<strong>Auto-find requires sign-in.</strong> Sign in first, or enter the URL manually below.');
    return;
  }
  const btn = document.getElementById('btnFindAndScrape');
  btn.disabled = true;
  try {
    setWebStatus('<strong>Searching</strong> for "' + name + (zip ? ' · ' + zip : '') + '"…', 'running');
    const url = await findWebsiteViaClaude(name, zip);
    if (!url) {
      // Claude ran but couldn't find an authoritative domain. Switch to Manual tab.
      switchToManualUrlTab('<strong>No authoritative website found</strong> for "' + escapeHtml(name) + '". Enter the URL manually below if you know it.');
      return;
    }
    document.getElementById('webUrlInput').value = url;
    // Use the browser BFS crawler — same reasoning as the manual-URL path
    // (Claude-driven crawl can't operate through the Edge Function proxy).
    const result = await scrapeUrl(url);
    ingestScrapedWebsite(url, result.text, result.subPages, {
      foundVia: 'claude-search',
      searchTerms: name + (zip ? ' · ' + zip : ''),
      method: result.method,
      totalPages: result.totalPages,
      failedPages: result.failedPages || 0
    });
  } catch (err) {
    // Auto-find failed at some step (API error, network, etc). Switch to Manual tab.
    logAudit('Classifier', 'Find & scrape failed for ' + name + ': ' + err.message, 'error');
    switchToManualUrlTab('<strong>Auto-find failed</strong> — ' + escapeHtml(err.message) + '. Enter the URL manually below.');
  } finally {
    btn.disabled = false;
  }
}

// Helper — switch UI to Manual URL tab with a helpful prompt explaining why.
// Keeps the status message visible so the user knows what happened.
function switchToManualUrlTab(reasonHtml) {
  setWebTab('url');
  setWebStatus(reasonHtml, 'error');
  // Focus the URL input so they can start typing immediately
  setTimeout(() => {
    const input = document.getElementById('webUrlInput');
    if (input) input.focus();
  }, 80);
}

// Ask Claude to identify the authoritative website URL for an insured.
// Returns a URL string or null.
async function findWebsiteViaClaude(name, zip) {
  const userPrompt = `Find the official corporate website for this business. Return ONLY the URL on a single line, with no explanation, no markdown, no surrounding text. If you can't find an authoritative website with high confidence, return exactly "NONE".

Business: ${name}
${zip ? 'Location: ' + zip : ''}

Criteria for "authoritative":
- The business's own domain (not a directory listing like Yelp, Yellowpages, BBB, LinkedIn company page, Facebook)
- Matches name + location
- Has actual operational content (services, about, projects), not a parked domain

Return exactly one of:
1. A URL like https://example.com
2. The literal string NONE`;

  // Use Anthropic's web_search tool — server handles the actual search
  const body = {
    model: STATE.api.model || 'claude-opus-4-7',
    max_tokens: 1024,
    messages: [{ role: 'user', content: userPrompt }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]
  };
  const data = await llmProxyFetch(body);
  // Extract the final text block (after any tool_use/tool_result turns)
  const textBlock = (data.content || []).reverse().find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text response from Claude');
  const reply = (textBlock.text || '').trim();
  if (reply === 'NONE' || /^none$/i.test(reply)) return null;
  // Extract first URL from the reply
  const urlMatch = reply.match(/https?:\/\/[^\s"'<>]+/);
  if (!urlMatch) throw new Error('Claude returned unparseable response: ' + reply.slice(0, 100));
  return urlMatch[0].replace(/[.,;:)\]}]+$/, '');  // trim trailing punctuation
}

// Create a STATE.files entry from scraped website text and route it to the website module.
function ingestScrapedWebsite(url, text, subPages, extra) {
  if (!text || text.length < 100) {
    setWebStatus('<strong>Scraped content too small</strong> (' + (text ? text.length : 0) + ' chars). Site may be JS-only or bot-blocked. Paste HTML manually instead.', 'error');
    return;
  }
  const hostname = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })();
  const displayName = hostname + '.web';
  const id = 'f_web_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const entry = {
    id,
    name: displayName,
    size: text.length,
    type: 'text/website',
    text: text,
    classification: 'website',
    confidence: 0.95,
    routedTo: 'website',
    state: 'classified',
    error: null,
    sourceUrl: url,
    subPages: subPages || [],
    scrapedAt: new Date().toISOString(),
    foundVia: extra?.foundVia || 'direct-url',
    crawlMethod: extra?.method || 'unknown',
    crawlStats: {
      totalPages: extra?.totalPages || (subPages?.length || 0) + 1,
      failedPages: extra?.failedPages || 0,
      elapsedMs: extra?.elapsedMs || null
    }
  };
  STATE.files.push(entry);
  renderFileList();
  updateRunButton();

  // Build the success status with crawl stats
  const totalPages = entry.crawlStats.totalPages;
  const kb = Math.round(text.length / 1024);
  const method = extra?.method === 'claude-crawl' ? 'Claude AI crawl' : 'browser crawl';
  const timeStr = extra?.elapsedMs ? ' · ' + Math.round(extra.elapsedMs / 1000) + 's' : '';
  const failStr = (extra?.failedPages || 0) > 0 ? ' · ' + extra.failedPages + ' skipped' : '';
  const msg = '<strong>Crawled</strong> ' + hostname + ' · ' + totalPages + ' page' + (totalPages === 1 ? '' : 's') +
              ' · ' + kb + 'K chars' + timeStr + failStr +
              '<br><span style="color: var(--text-3); font-size: 10px;">Method: ' + method + ' · classified as WEBSITE</span>';
  setWebStatus(msg, 'success');

  // Comprehensive crawl-complete audit entry — summary + full page list.
  // The per-page entries were logged during the crawl; this summary line ties them
  // together so the UW can see at a glance what was and wasn't scraped.
  logAudit('Scrape', '=== CRAWL COMPLETE · ' + url + ' · ' + totalPages + ' pages · ' + text.length.toLocaleString() + ' chars' + (extra?.failedPages > 0 ? ' · ' + extra.failedPages + ' failed' : '') + ' · via ' + entry.crawlMethod + ' ===', 'ok');
  // Also log the full URL list as one entry so they can confirm coverage
  const allScrapedUrls = [url].concat(subPages || []);
  if (allScrapedUrls.length > 0) {
    logAudit('Scrape', 'Pages in crawl: ' + allScrapedUrls.map(u => { try { return new URL(u).pathname || '/'; } catch { return u; } }).join(' · '), 'ok');
  }

  // If pipeline was already done, run incremental flow so the A1 website module updates
  if (STATE.pipelineDone) {
    incrementalProcess([entry]);
  }
}

// ============================================================================
// Phase 8 step 5: explicit window-exports for every top-level declaration.
// Required because HTML inline handlers (onclick="setWebTab('url')" etc.)
// look up handlers via window. Internal cluster references work fine
// without these exports, but the inline-handler bridge needs them.
// ============================================================================
window.setWebTab = setWebTab;
window.setWebStatus = setWebStatus;
window.normalizeUrl = normalizeUrl;
window.htmlToText = htmlToText;
window.extractCandidateLinks = extractCandidateLinks;
window.dedupeBoilerplate = dedupeBoilerplate;
window.discoverSitemapUrls = discoverSitemapUrls;
window.fetchTextViaProxy = fetchTextViaProxy;
window.fetchViaProxy = fetchViaProxy;
window.hasMeaningfulContent = hasMeaningfulContent;
window.escapeHtmlForWrapper = escapeHtmlForWrapper;
window.scrapeUrl = scrapeUrl;
window.scrapeUrlViaClaude = scrapeUrlViaClaude;
window.scrapeWebsiteFromUrl = scrapeWebsiteFromUrl;
window.findAndScrapeWebsite = findAndScrapeWebsite;
window.switchToManualUrlTab = switchToManualUrlTab;
window.findWebsiteViaClaude = findWebsiteViaClaude;
window.ingestScrapedWebsite = ingestScrapedWebsite;
