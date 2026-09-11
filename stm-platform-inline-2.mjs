
  // postal-mime is ESM-only; load via esm.sh and attach to window so the
  // rest of app.js (non-module) can call window.PostalMime.parse(buf).
  // Used by parseEml() in app.js to expand .eml drops into the email body
  // + each attachment as separate file-queue entries (mirroring the .msg
  // attachment unpack flow so the deterministic detector chain runs on
  // every attachment independently).
  //
  // PHASE B FIX (per GPT external audit): fire-and-forget instead of
  // top-level await. The previous version awaited the import at the top
  // level of a module script, which BLOCKS DOMContentLoaded until the ESM
  // CDN responds.
  //
  // PHASE 5 FIX (per GPT external audit round 4): store the promise on
  // window.PostalMimeReady so extractText() can await it on fast .eml
  // uploads. Without this, dropping an .eml within the first ~500ms of
  // page load (before the ESM CDN responds) silently falls back to the
  // legacy text-only parseEml path — which doesn't extract attachments.
  // test account and other .eml-with-attachments flows would lose every
  // attached PDF. Race window is small but real, especially on slow
  // corp networks. Keeping the import non-blocking (DOMContentLoaded
  // still fires snappy) but exposing the promise so consumers can await
  // briefly when they actually need the parser.
  window.PostalMimeReady = import('./vendor/postal-mime/postal-mime.mjs')
    .then(mod => {
      window.PostalMime = mod.default || mod.PostalMime || mod;
      return window.PostalMime;
    })
    .catch(err => {
      console.warn('postal-mime failed to load — .eml will fall back to text-only parsing', err);
      window.__postalMimeFailed = true;
      return null;
    });
