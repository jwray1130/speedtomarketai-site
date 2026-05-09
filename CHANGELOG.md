# Changelog

All notable changes to Speed to Market AI / Altitude.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/) — MAJOR for breaking visual or behavioral changes, MINOR for additive features, PATCH for bugfixes.

---

## [v9.0.0-z1-aesthetic-carrier-neutral] — 2026-05-08

The Z1 aesthetic re-skin. Visual transformation from the prior
Stripe-flavored multi-color palette to the Z1 royal-blue + amber-yellow
system. Simultaneous strip of all Zurich-specific copy and branding,
making the codebase carrier-neutral so it can ship to any E&S writing
carrier with a one-field configuration change.

**Highlights**

- New design system: royal blue (`#0e46a3`) signal, amber-yellow (`#ffd100`) accent, Inter typography, 14.5px / 1.42 base scale, soft white surfaces, glass-effect blue sidebar
- Light mode is now the **default**; dark mode is opt-in via `html[data-theme="dark"]`. Existing users with `localStorage.stm-theme=light` migrate silently
- All Zurich-specific copy, mocks, and the embedded 9.5KB E&S excerpt replaced with carrier-neutral content. The `DEFAULT_GUIDELINE` is now a starter template
- New `{{CARRIER_NAME}}` placeholder convention in prompts.js, resolved at LLM-dispatch time via the new `interpolateCarrierName()` helper in app.js
- Auth screen + marketing site: Three.js gradients re-tuned from Stripe-style multi-color (pink/orange/sky-blue/lavender) to single-hue royal-blue cascade with amber spark
- Zero HTML structural changes — every selector, ID, and class preserved 1:1. Pure aesthetic transformation; JS continues to work without rework

### Changed

#### Design system (CSS)

- `tokens.css` (NEW, 350 lines) — single source of truth for design tokens. Royal blue + amber Z1 palette. Light-default theme system with `html[data-theme="dark"]` opt-in
- `app.css` — full rewrite, 5,320 lines (was 3,636)
  - Part 1 · chrome (topbar, page heads, KPIs, buttons, modals, forms, toasts) — 1,008 lines
  - Part 2 · submission workbench (3-pane, files, web intake, pipeline DAG) — 1,084 lines
  - Part 3 · summary, decision, queue, admin, specialty renderers (Discrepancy / Loss History / Excess Tower) — 2,878 lines
- `documents-view.css` — token block re-skinned (light-default, royal-blue glass sidebar). Body of the file mostly unchanged via surgical sed transformations. 12-color tag system preserved (theme-stable)
- All animation keyframes prefixed `stm-` (app.css) or `dv-` (documents-view.css) to prevent cross-file collisions
- 17 hardcoded `#0A2540` (legacy Altitude bg) replaced with `var(--text-on-signal)` or `var(--text)` per context
- 73 instances of `rgba(5, 112, 222, *)` (old signal RGB) → `rgba(14, 70, 163, *)` (royal blue RGB)
- 3 duplicate `@keyframes` definitions (`spin`, `progress`, `spinner-rotate`) consolidated to single declarations
- Hardcoded `#63B3ED` for assistant-review surfaces promoted to `--assistant: #5b8def` token system

#### HTML

- `app.html` (1,255 lines) — Auth overlay backdrop dark navy → deep blue (`#072d6a`); frosted dark card → glass white-on-blue; "Send magic link" button gradient blue → solid amber yellow. Three.js gradient palette flipped from Stripe-style multi-color to royal-blue cascade. Settings copy "default Zurich E&S Excess Casualty excerpt" → "default carrier guideline excerpt" (×2). Annotation color picker "Black" swatch `#0A2540` → `#0a1a3a`
- `index.html` (4,946 lines) — Token blocks (dark default + light override) wholesale rewritten. Three.js hero "FLAME" palette: 4-color Stripe-style → single-hue royal-blue cascade with amber spark. Orbital module sphere: scan color `#5BD2FF` → `#5b8def`, halo color `#0570DE` → `#0e46a3`. Meta theme-color `#0A2540` → `#0a1828`. 73 rgba conversions, 15 hex conversions, 6 brand SVG stroke updates

#### JavaScript

- `prompts.js` (1,593 lines) — All 10 Zurich references in the `tower` prompt scrubbed. 9 `{{CARRIER_NAME}}` placeholders inserted; 1 literal `★ PROPOSED` badge replaces the old `★ ZURICH` badge. New header block documents the placeholder convention
- `app.js` (6,967 lines) — DEFAULT_GUIDELINE constant rewritten from 9.5KB Zurich excerpt to 4.3KB neutral starter template. MOCKS demo submission scrubbed (tower badge, row 2, all 3 notes paragraphs, classcode notes, guidelines quote). Toast + 2 confirm dialogs updated. `toggleTheme()` flipped to light-default convention. **NEW:** `getCarrierName()` and `interpolateCarrierName()` helpers exported on `window`
- `pipeline.js` (4,951 lines) — `callLLM()` now invokes `window.interpolateCarrierName()` on the system prompt before sending to the LLM. Identity-fn fallback if the helper isn't loaded yet (early-boot race protection)
- `documents-view.js` (6,364 lines) — `applyTheme()` and the local fallback `toggleTheme()` flipped to match the new light-default convention. 3 hardcoded `#0570DE` literals (2 console.log style + 1 default annotation color) → `#0e46a3`
- `scraper.js` — pass-through unchanged. Already neutral

#### Operational

- `vercel.json` — added cache headers: HTML files no-cache (always fresh), CSS/JS files 5-min cache with revalidation. The previous file was minimal (`{ cleanUrls: true }` only)
- `STM_BUILD` build label bumped from `v8.6.29-progressive-thumb-quality-2026-05-06` to `v9.0.0-z1-aesthetic-carrier-neutral-2026-05-08`

### Migration notes

#### Theme preference (silent migration)

Previously: `localStorage.stm-theme = 'light'` meant "force light"; absence meant dark. Now: `localStorage.stm-theme = 'dark'` means "force dark"; absence means light.

The localStorage key is preserved across both versions, but **value semantics flip**. Practical effect:

- Users who previously selected light mode (`stm-theme = 'light'`) will get the new light theme on first page load (the value `'light'` is now meaningful — it sets the explicit light state, though "light" being the default means the visual outcome is identical). No action required.
- Users who never explicitly toggled (no `stm-theme` key) will get the new light default. They previously saw dark — this is a breaking visual change, but it matches the broader app re-skin and is consistent with the marketing site dark hero / app body light contrast pattern.
- Users who previously selected dark mode (no key, since dark was the prior default) will now see light. They can re-enable dark via the toggle; their preference is then stored as `stm-theme = 'dark'` under the new convention.

If we want to preserve users' implicit dark preference, a small migration could be added on first load post-deploy: `if (localStorage.getItem('stm-theme') === null) localStorage.setItem('stm-theme', 'dark')`. **Not included** by default, since the re-skin's visual identity is light-first.

#### Carrier name (set in Settings)

`{{CARRIER_NAME}}` placeholders are resolved by the new `interpolateCarrierName()` helper. The resolution chain:

1. `STATE.api.carrierName` (set via Settings UI — to-be-built; see INTEGRATION.md)
2. `localStorage.stm-carrier-name` (manual fallback)
3. `'Our Carrier'` (generic default)

For any deploy where the Settings UI hasn't shipped yet, set the localStorage value manually:

```js
localStorage.setItem('stm-carrier-name', 'Berkley Specialty');
// then reload
```

Without configuration, the LLM receives `'Our Carrier'` in tower prompts. This is the safe default but loses personalization.

### Removed

- The 9.5KB embedded Zurich E&S Excess Casualty Underwriting Guideline excerpt (DEFAULT_GUIDELINE constant in app.js)
- All `★ ZURICH` badge HTML in mocks and prompts.js
- Hardcoded references to "Zurich capacity," "Zurich minimums," "Head of Zurich E&S empowerment," etc. across 18 sites
- `#0570DE` (Stripe blue) — replaced everywhere with `#0e46a3` (royal blue)
- `#0A2540` (legacy dark Altitude bg) — replaced with new tokens or `#0a1828` per context
- Stripe-style hero gradient color palette (pink/orange/sky-blue/lavender) — replaced with royal-blue cascade

### Bug fixes (incidental, baked into the re-skin)

- `web-action-btn:hover` had `color: var(--signal-ink)` on `var(--signal)` background — invisible blue-on-blue text. Now `text-on-signal` (white)
- Three duplicate `@keyframes` (`spin`, `progress`, `spinner-rotate`) merged to single declarations (`stm-spin`, `stm-progress-pulse`)
- `applyTheme(theme)` previously asymmetric (only `'light'` set the attribute; anything else removed it). Now symmetric: `'dark'` sets, anything else removes — including typos and `undefined` calls, which now safely default to light
- Original CSS comments said `/* SIGNAL (chartreuse...) */` describing `#0570DE` — leftover from an earlier iteration when signal was actually chartreuse. All comments updated to match reality
- Original `--amber: #00D4FF` was named "amber" but valued cyan — stale rename. Now genuine amber `#ffd100`
- Light-mode `--amber: #0570DE` was duplicated to `--signal` value, losing distinct identity. Now `#ffd100` in both modes — theme-stable

---

## Prior series (v8.6.x)

The v8.6 series spanned April–May 2026. Highlights only:

- **v8.6.29** — Progressive thumbnail quality (2026-05-06)
- **v8.6.28** — DELETE timeout fix via TOAST storage migration
- **v8.6.12** — Full classifier tag taxonomy refactor
- **v8.6.5** — Shared helper to flush pending writes (per GPT external audit)

For complete history of v8.6.x, see git log.

---

## Versioning convention

```
vMAJOR.MINOR.PATCH-context-tag-YYYY-MM-DD

  vMAJOR    Breaking visual/behavioral changes (e.g., re-skin)
  vMINOR    Additive features (new modules, new prompt templates)
  vPATCH    Bug fixes only (no behavior change)

  context   Shorthand for what shipped (e.g., "z1-aesthetic")
  tag       Optional refinement (e.g., "carrier-neutral")
  date      Build date YYYY-MM-DD
```

The full string is set as `window.STM_BUILD` in app.js and rendered live in the topbar version badge. Click the badge to copy. If a Vercel deploy doesn't pick up the new version, the badge will show the old string and you'll know immediately.
