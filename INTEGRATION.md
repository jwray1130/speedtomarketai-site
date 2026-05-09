# Integration · v9.0.0-z1

How to deploy the Z1 re-skin to production. Read this end-to-end before starting.

## What's in this release

The session-by-session plan is in `PLAN.md`. The transformation produced **12 files** that ship together:

| File | Status | Lines | Notes |
|---|---|---|---|
| `tokens.css` | NEW | 350 | New top-level design token file |
| `app.css` | rewrite | 5,320 | Full Z1-aesthetic rewrite (concatenation of tokens + parts 1+2+3) |
| `documents-view.css` | rewrite | 3,270 | Token block re-skinned, body lightly transformed |
| `app.html` | edits | 1,255 | Auth overlay + Three.js gradient + settings copy |
| `index.html` | edits | 4,946 | Marketing site Three.js palettes + token blocks |
| `prompts.js` | edits | 1,593 | Tower prompt scrubbed; `{{CARRIER_NAME}}` placeholders |
| `app.js` | edits | 6,967 | DEFAULT_GUIDELINE rewrite, MOCKS scrub, toggleTheme flip, carrier helpers |
| `pipeline.js` | edits | 4,951 | callLLM hooked into interpolateCarrierName |
| `documents-view.js` | edits | 6,364 | applyTheme + fallback toggleTheme flipped, console color literals |
| `scraper.js` | unchanged | 819 | Pass-through (already neutral) |
| `admin-views.js` | unchanged | 306 | Pass-through (already neutral) |
| `supabase-data.js` | unchanged | 1,754 | Pass-through (already neutral) |
| `vercel.json` | edits | 22 | Cache headers added |

`scraper.js`, `admin-views.js`, and `supabase-data.js` are unchanged — listed for completeness so the deploy bundle is identical-shape across versions.

## Deploy order

The order matters for cache invalidation. Always deploy the bundle as a single unit; never split across deploys. **All 13 files in one commit, one push, one Vercel deploy.**

```bash
# Verify all files are at the new build
grep "v9.0.0-z1" app.js
# → window.STM_BUILD = 'v9.0.0-z1-aesthetic-carrier-neutral-2026-05-08';

# Commit + push
git add tokens.css app.css documents-view.css app.html index.html \
        prompts.js app.js pipeline.js documents-view.js \
        vercel.json CHANGELOG.md INTEGRATION.md PRODUCTION.md
git commit -m "v9.0.0-z1: aesthetic re-skin + carrier-neutral content"
git push

# Vercel auto-deploys from main. Wait 30-60 seconds, then verify.
```

## Verification after deploy

1. **Build label visible.** Open the live site. The version badge in the top-right of the topbar should show `v9.0.0-z1`. If it shows v8.6.x, the deploy hasn't picked up the new files OR your browser is cached. Hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`).

2. **Theme renders correctly.** App should load in **light mode by default** (white surfaces, royal-blue topbar gradient, amber accents). Click the theme toggle — should flip to dark. Refresh — preference persists.

3. **Sign-in flow.** Auth overlay should show:
   - Deep blue backdrop with subtle Three.js royal-blue gradient
   - Frosted glass card with white-on-blue tint
   - Amber yellow "Send magic link" button
   - "Speed to Market AI" header with amber-italic "AI"

4. **Pipeline produces output.** Run a test submission. The Excess Tower card should render with:
   - `★ PROPOSED` badge (NOT `★ ZURICH`) on the proposed-layer row
   - Notes paragraphs that say "the carrier" or your configured carrier name (NOT "Zurich")
   - All three tower-notes paragraphs present

5. **No `{{CARRIER_NAME}}` placeholders in output.** If the LLM produces literal text with `{{CARRIER_NAME}}` in it, the interpolation isn't running. Check:
   - Browser console for `interpolateCarrierName` defined: `typeof window.interpolateCarrierName === 'function'` should be `true`
   - pipeline.js's callLLM is calling `interpolate(systemPrompt || '')` — check console.log of the body sent to the API

6. **Documents view renders.** Press the docs view shortcut. The overlay should show:
   - Glass-effect blue sidebar with category cards
   - White doc-grid with tag-color-coded items
   - Topbar with brand mark + search + view toggle

## Configure carrier name (optional but recommended)

Without configuration, the LLM sees `'Our Carrier'` as the placeholder fill. To set your carrier name, choose ONE of:

### Quickest (browser console, per-user)

```js
localStorage.setItem('stm-carrier-name', 'Berkley Specialty');
location.reload();
```

The next pipeline run will use "Berkley Specialty" in tower prompts.

### Add to Settings UI (recommended for production)

The Settings modal in app.html doesn't yet have a carrier-name field. To add one:

1. Open `app.html` and find the Settings modal section (search for `<h3>` containing "Carrier Underwriting Guideline").
2. Add a new field above it:
   ```html
   <div class="form-group">
     <label>Carrier Display Name</label>
     <input type="text" id="apiCarrierName" placeholder="e.g., Berkley Specialty" value="">
     <div class="form-hint">Used in tower prompts to identify the underwriting carrier. Leave empty to use 'Our Carrier' generic.</div>
   </div>
   ```
3. In `app.js`'s `saveSettings()` and `loadSettings()` functions, add corresponding read/write for `STATE.api.carrierName` (parallel to how `apiMaxTokens` is handled).
4. Optionally, persist to Supabase user_settings table (parallel to `carrier_guideline`).

**Estimated work:** ~15 lines HTML + ~10 lines JS. **Not included in v9.0.0** because adding new Settings fields is outside the scope of an aesthetic re-skin.

## Browser cache reminders

The new `vercel.json` adds cache headers:

- HTML files (`app.html`, `index.html`): `no-cache, no-store, must-revalidate` — always fresh on each request
- CSS/JS files: `public, max-age=300, must-revalidate` — 5-minute browser cache, then revalidate against the server

For users on the production site at the moment of deploy, their existing cached HTML may serve old JS+CSS for up to 5 minutes after deploy. After hard-refresh (or 5 minutes), they get the new bundle.

Aggressive cache-busting (query strings on script tags) was considered and rejected — would require app.html template changes and break the static-host model. The 5-minute window is acceptable for a non-realtime app.

## Known operational notes

See `PRODUCTION.md` for the full operational reference. Key items to be aware of:

- **Theme migration** is silent. Existing users will land on light mode regardless of prior preference unless they had explicitly set `localStorage.stm-theme = 'dark'` (which the prior code never wrote — dark was the implicit default). To preserve implicit dark preferences, see PRODUCTION.md → Migration.
- **Carrier name** falls back to `'Our Carrier'` if unset. This is intentional. To track which deploys have configured carrier names, query Supabase user_settings or add a console warning if `STATE.api.carrierName` is empty after sign-in.
- **localStorage keys used:** `stm-theme`, `stm-carrier-name`. Both are domain-scoped; deploys to different subdomains start fresh.

## Rollback plan

If v9.0.0 has a critical issue, revert by deploying the prior v8.6.29 bundle. Steps:

```bash
git revert <v9.0.0 commit hash>
git push
# Vercel re-deploys; old build label v8.6.29 visible in version badge within ~60s.
```

The localStorage keys (`stm-theme`, `stm-carrier-name`) are forward-compatible with v8.6.29:

- `stm-theme = 'light'` was meaningful in v8.6.x ("force light"). Behavior unchanged.
- `stm-theme = 'dark'` was never written by v8.6.x. v8.6.29 reads it as a no-op (falls through to dark default — same outcome).
- `stm-carrier-name` is unread by v8.6.x. No conflict.

No data migration needed for rollback.

## Post-deploy checklist (recommended within 24h)

- [ ] Verify build badge `v9.0.0-z1` on production
- [ ] Hard-refresh and confirm light theme as default
- [ ] Run one test submission, confirm tower badge says `★ PROPOSED`
- [ ] Set `localStorage.stm-carrier-name` for at least one test user; verify next pipeline run interpolates correctly
- [ ] Check Vercel deploy logs for build errors (none expected — pure asset deploy)
- [ ] Query Supabase user_settings to identify users with stale `carrier_guideline` content (anyone with the old Zurich-prefixed text — they'll need to re-paste their guideline if they want carrier-specific behavior)
- [ ] Update internal docs / wiki to reference new build label
- [ ] Slack post to team: deploy notes + "remember to set your carrier name in console for now"

## Next-up (deferred from re-skin scope)

Items called out during the re-skin that should be follow-up tasks (not blockers for deploy):

1. **Settings UI for carrier name.** ~15 lines HTML + ~10 lines JS. See above.
2. **`tower-layer-badge.primary-badge` contrast in dark mode.** Uses `color: var(--surface)` on `background: var(--text-3)` — works in light, marginal in dark. Add a dedicated badge color or `--text-on-surface-3`.
3. **`prefers-reduced-motion` overrides for parsing/running pulses.** The `stm-progress-pulse` keyframe doesn't honor reduced-motion. Add `@media (prefers-reduced-motion: reduce) { .pipe-node.running::after { animation: none; } .file-item.parsing::after { animation: none; } }`
4. **Status menu data-attribute selector dot colors.** Hardcoded by status-string match. Refactor to class-based variants for robustness against status-string renames.
5. **MOCKS demo data still uses real carrier names** (Starr Indemnity, Great American). These are brokered insureds in the demo, not the writing carrier — but full neutrality would replace with placeholder names.
6. **Three locations of theme handling** (app.css, documents-view.css, app.js). Logic is consistent but lives in 3 places. Centralize into a shared module for future maintainability.
7. **Inline-styled gradient buttons in index.html** (~lines 1666-1681). Move to CSS classes.
