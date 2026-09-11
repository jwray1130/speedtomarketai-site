
  // FIX-AUDIT-2026-06-09 (.msg ingestion): @kenjiuno/msgreader ships NO
  // lib/index.browser.js — that path 404s on jsDelivr, so the old <script>
  // tag set __msgReaderFailed on every page load and ALL .msg uploads
  // errored. The package is CJS/ESM only; load it the same way as
  // postal-mime: ESM via the CDN's +esm transform, attached to window,
  // with a Ready promise the extractor can await briefly.
  window.MsgReaderReady = import('./vendor/msgreader/msgreader.mjs')
    .then(mod => {
      window.MsgReader = mod.default || mod.MsgReader || mod;
      return window.MsgReader;
    })
    .catch(err => {
      console.warn('msgreader failed to load — .msg will need .eml forward or paste-as-text', err);
      window.__msgReaderFailed = true;
      return null;
    });
