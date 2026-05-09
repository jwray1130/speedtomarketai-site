# Production Reference · v9.0.0-z1

Operational reference for the Z1 re-skin. For deployment steps, see `INTEGRATION.md`. For what changed, see `CHANGELOG.md`. This file documents how the system *works* in its v9 shape — design conventions, file responsibilities, debug paths.

---

## Design system

### Colors (Z1 palette)

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--signal` | `#0e46a3` | `#0e46a3` | Royal blue · primary brand color, info indicators, active states |
| `--signal-hover` | `#1a55b8` | `#1a55b8` | Hover state for signal-blue surfaces |
| `--signal-dim` | `#072d6a` | `#072d6a` | Deepest blue · topbar bottom, deep loss-table headers |
| `--signal-pale` | `rgba(14,70,163,0.10)` | `rgba(14,70,163,0.18)` | Subtle blue tint backgrounds |
| `--signal-tint` | `rgba(14,70,163,0.22)` | `rgba(14,70,163,0.32)` | Blue glow / focus ring |
| `--accent` | `#ffd100` | `#ffd100` | Amber yellow · primary "do the thing" CTAs (Run, brand AI italic) |
| `--accent-dim` | `#e6bc00` | `#e6bc00` | Amber border / subtle accent |
| `--text-on-signal` | `#ffffff` | `#ffffff` | White text against royal-blue backgrounds |
| `--text-on-accent` | `#1a1a1a` | `#1a1a1a` | Dark text against amber-yellow backgrounds |
| `--bg` | `#f7f9fc` | `#0a1828` | Page background |
| `--surface` | `#ffffff` | `#102236` | Card / panel surface |
| `--text` | `#0a1a3a` | `#e8eef7` | Primary body text |

The full token catalog is in `tokens.css`. Always reference tokens — never hardcode hex literals in body CSS.

### Typography

- **Display + body:** `Inter` (loaded from Google Fonts). Variable font; `'Inter Variable'` references work but `'Inter'` is the canonical alias used in v9
- **Mono:** `Geist Mono` (Google Fonts), fallback `'SF Mono', Menlo, monospace`. Used for: build labels, status pills, mono-uppercase eyebrows, file names, table cells, code blocks
- **Base scale:** 14.5px / 1.42 line-height (matches Z1 reference). Most surfaces use 12.5px / 1.55 for body content; mono labels are 9.5–11px

### Geometry

- `--radius: 8px` (default), `--radius-md: 10px` (cards), `--radius-lg: 12px` (admin/queue cards), `--radius-pill: 999px`
- Forms: 8×10px padding (looser than Z1's `.43rem .53rem` for Altitude's denser data forms)

### Theme convention

Light is the **default**. Dark is opt-in via `<html data-theme="dark">`. localStorage key `stm-theme` stores the preference (`'light'` or `'dark'`); absent = use default (light).

```js
// Verify in browser console:
document.documentElement.getAttribute('data-theme')   // → null = light, 'dark' = dark
localStorage.getItem('stm-theme')                     // → null = unset, 'dark' = forced dark, 'light' = forced light
```

---

## Carrier name resolution

`prompts.js` uses `{{CARRIER_NAME}}` placeholders in templates that need the carrier's display name. The host (app.js) resolves the placeholder before the prompt is sent to the LLM via `pipeline.js`'s `callLLM()`.

### Resolution chain

```
getCarrierName() {
  1. STATE.api.carrierName           — Settings UI value (when shipped; not in v9.0.0)
  2. localStorage.stm-carrier-name   — manual fallback
  3. 'Our Carrier'                   — generic default; never sees daylight in production
}
```

### How it threads through the system

```
prompts.js               app.js                          pipeline.js
─────────────            ─────────────                   ─────────────
{{CARRIER_NAME}}    →    interpolateCarrierName(text)    →    callLLM applies it
in tower prompt          replaces all placeholders            before sending to LLM
                         globally
```

### Where placeholders exist (today)

Only in the `tower` prompt. 9 occurrences:

1. Role description ("the broker's requested {{CARRIER_NAME}} layer")
2. Input context #1 ("the broker's requested {{CARRIER_NAME}} layer structure")
3. Capacity check ("the requested {{CARRIER_NAME}} layer exceeds {{CARRIER_NAME}} capacity") — 2 places in same sentence
4. Notes · Ask vs Offer ("what {{CARRIER_NAME}} can compliantly offer")
5. Notes · Primary Adequacy ("primary AL CSL meets {{CARRIER_NAME}} minimums")
6. Rules · ★ rule ("the {{CARRIER_NAME}} quote")
7-8. Header documentation block (×2 — these are comments, not in the active prompt body)

### Setting the carrier name

Until the Settings UI ships:

```js
// One-time setup per browser:
localStorage.setItem('stm-carrier-name', 'Berkley Specialty');
location.reload();
```

After reload, every pipeline run will interpolate "Berkley Specialty" wherever `{{CARRIER_NAME}}` appears.

### Verifying interpolation works

```js
// In browser console after page load:
window.interpolateCarrierName('test {{CARRIER_NAME}} test')
// → 'test Berkley Specialty test'  (or 'test Our Carrier test' if unset)
```

---

## File responsibilities (post-v9)

| File | Owns |
|---|---|
| `tokens.css` | All design tokens. Source of truth for colors, fonts, geometry, shadows, animation timing |
| `app.css` | All non-docs-view UI styling. Topbar, page system, KPIs, buttons, modals, forms, toasts, submission workbench, summary cards, decision pane, queue table, admin grid, specialty renderers (discrepancy/loss/tower) |
| `documents-view.css` | Document overlay UI styling. Namespaced under `#docs-view-root`. Has its own scoped token system that mirrors `tokens.css` |
| `app.html` | App chrome HTML. Auth overlay, topbar, queue view, submission view, settings modal, admin view |
| `index.html` | Marketing site HTML + embedded CSS + Three.js gradient setup. Standalone — does not load `app.css` |
| `prompts.js` | The 19 LLM prompt templates as `window.PROMPTS`, plus `window.PROMPT_INJECTION_DEFENSE` |
| `app.js` | App boot, STATE, theme toggle, carrier name helpers, MOCKS, settings modal logic, audit log, queue rendering, summary view, pipeline orchestration plumbing, supabase client wiring |
| `pipeline.js` | LLM dispatch (`callLLM`), pipeline DAG execution, classifier review banner, stage tracking, incremental update logic |
| `documents-view.js` | The full document workspace (file grid, tag system, annotations, multi-file selection, search, modal flows). Self-contained module that mounts under `#docs-view-root` |
| `scraper.js` | Web crawl + content extraction for "Insured Website" intake |
| `admin-views.js` | Admin view rendering, audit log entries display |
| `supabase-data.js` | Supabase auth, data persistence, cloud sync, retries |

---

## Known gotchas

### LocalStorage keys

| Key | Purpose | Format |
|---|---|---|
| `stm-theme` | Theme preference | `'light'` or `'dark'` (or absent) |
| `stm-carrier-name` | Carrier display name | Free-text string (e.g., `'Berkley Specialty'`) |

Both are domain-scoped. Deploys to different subdomains have separate state.

### Animation keyframes

All keyframes are prefixed to prevent collisions:

- `stm-*` — used in app.css (e.g., `stm-spin`, `stm-progress-pulse`, `stm-pulse`, `stm-fade-in`, `stm-modal-in`, `stm-toast-in`, `stm-fb-flash-positive/negative/suggestion`, `stm-fb-popover-enter`, `stm-updated-pulse`)
- `dv-*` — used in documents-view.css (e.g., `dv-spin`, `dv-modal-in`, `dv-toast-in`, `dv-search-pulse`, `dv-progress-grad`)

Never declare an unprefixed `@keyframes` block in either file. If a CSS file other than these two declares animations, prefix appropriately to avoid collision.

### Three.js gradient performance

Both `app.html` (auth overlay) and `index.html` (marketing hero) run Three.js gradients. Both:

- Honor `prefers-reduced-motion` — skip the WebGL setup if user has it enabled
- Pause when not visible (auth overlay pauses after sign-in; hero pauses on tab blur)
- Use vertex-displaced plane geometry with simplex noise (snoise) — no actual particle systems

If users report sluggishness on low-end devices, the auth overlay can be disabled by removing the `<canvas id="authBackdropCanvas">` element. The card still renders with a static deep-blue background.

### Carrier-name-in-prompt coupling

prompts.js's `{{CARRIER_NAME}}` placeholders MUST be interpolated by app.js's `interpolateCarrierName` (called from pipeline.js's callLLM). If app.js fails to load before pipeline.js's first dispatch, the LLM sees literal `{{CARRIER_NAME}}` in the system prompt and produces garbage.

The `pipeline.js` callLLM has an identity-fn fallback (`(s => s)` if `window.interpolateCarrierName` is undefined) — but this means failing-silent rather than failing-loud. Consider adding a `console.warn` if the fallback fires:

```js
const interpolate = (typeof window.interpolateCarrierName === 'function')
    ? window.interpolateCarrierName
    : (s => { console.warn('[pipeline] interpolateCarrierName unavailable'); return s; });
```

(Not added by default — would clutter the console for users who haven't configured carrier name. Trade-off worth revisiting.)

### Default carrier guideline is just structure

The new `DEFAULT_GUIDELINE` constant in app.js is a 4.3KB neutral starter template, not a real carrier guideline. The guideline cross-reference module will produce *shaped* output but cannot make carrier-specific claims about appetite, attachment points, or empowerment levels. Users MUST upload their own guideline via Settings → Carrier Guideline to get useful cross-reference output.

This is intentional: the prior 9.5KB Zurich excerpt would have been wrong (and potentially misleading) for non-Zurich carriers using the product.

---

## Debug paths

### "Theme is wrong"

1. Check `<html data-theme>`: should be absent (light) or `"dark"`. Anything else is a bug.
2. Check `localStorage.stm-theme`: should be absent, `'light'`, or `'dark'`. Anything else is stale data.
3. Check no other CSS file is fighting the namespace. `tokens.css` is loaded first, so its `:root` declarations should win against any stale stylesheet.

### "Tower badge still says ZURICH"

1. Check build label in topbar — must be `v9.0.0-z1`. If older, it's a cache issue (hard-refresh).
2. Check prompts.js loaded: `window.PROMPTS.tower.includes('★ PROPOSED')` should be `true`.
3. Check pipeline.js called interpolateCarrierName: instrument callLLM with a console.log of the system prompt before sending.

### "{{CARRIER_NAME}} appears in tower notes"

1. Confirm app.js loaded before pipeline.js's first dispatch: order in app.html should be prompts.js → app.js → pipeline.js → ...
2. `typeof window.interpolateCarrierName` should be `'function'`.
3. `window.getCarrierName()` should return your carrier name (or `'Our Carrier'`).
4. If all of the above are correct, the LLM is producing the literal placeholder in its output despite receiving the resolved value — possible if it copied the template's example. Re-run the pipeline; if persistent, file a regression.

### "Build label is stale after deploy"

1. Hard-refresh browser (`Ctrl+Shift+R`).
2. If still stale: check Vercel deploy log for errors.
3. If deploy succeeded: check `Cache-Control` header on app.html (should be `no-cache` per the new vercel.json).
4. If header is wrong: vercel.json wasn't picked up — re-deploy after clearing Vercel build cache.

### "Pipeline output looks weird in dark mode but fine in light"

This pattern usually indicates a missing dark-mode token override. Check `tokens.css` `html[data-theme="dark"]` block — likely missing a token used in the affected surface. Add the override and re-deploy.

---

## Versioning + build labels

```
v9.0.0-z1-aesthetic-carrier-neutral-2026-05-08
│  │ │  │   ─────────────────────  └─ build date
│  │ │  └─ tag
│  │ └─ context
└──┴───── SemVer
```

- **Major bump** (v8 → v9) for the re-skin — visual identity changed dramatically; users will notice
- **Minor and patch** stay at 0 for the initial v9.0.0
- Subsequent releases: bump patch for bugfixes (`v9.0.1`), minor for new modules (`v9.1.0`), major for next big visual shift

Always bump the label in `app.js` (line 9) before deploying. Vercel deploys without label changes are nearly impossible to debug from the browser; the label is the source of truth for "what's actually running on prod right now."

---

## What's NOT in v9.0.0

Deferred items (not blockers):

1. **Settings UI for carrier name.** Set via console for now; see INTEGRATION.md. ETA: a small follow-up patch.
2. **`prefers-reduced-motion` overrides** for parsing/running pulses (file-item.parsing::after, pipe-node.running::after). The motion is subtle and not a major accessibility blocker, but worth adding.
3. **Centralized theme module.** Theme handling lives in 3 places (tokens.css `data-theme`, app.js toggleTheme, documents-view.js applyTheme + fallback toggle). Refactor to a shared module if maintenance burden grows.
4. **Status-menu dot colors via class-based variants.** Currently hardcoded by `[data-status="..."]` selector match. Refactor for resilience against status-string renames.
5. **MOCKS demo data uses real carrier names** (Starr, Great American). These are brokered insureds in the demo, not the writing carrier — full neutrality would replace with placeholder names.
6. **Inline-styled buttons in index.html** (~lines 1666-1681). Move to CSS classes.
