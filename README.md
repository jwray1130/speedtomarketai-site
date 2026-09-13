# Speed to Market AI

The public homepage is served at `/`. The redesigned application is served at `/platform` and `/workbench?submission=<id>`.

The redesigned pages use `redesign-runtime.js`, `integration-core.js` and the phase adapters to connect their controls to the existing Pipeline and Workbench engines. The engine pages run in internal frames. `platform.html` and `workbench.html` contain the same embedded design templates and must remain identical. Authentication and production saves use the existing services; the deployed application contains no test sign-in or simulated model transport.

## Parity repair

This repair preserves the redesigned layout while restoring reliable classification state, file routing, source evidence transfer, relevant-page markers, confidence formatting and Workbench field updates. Manual field edits remain authoritative. Existing automatic over-tagging can be reviewed in **Documents → Document tools → Review automatic page markers** before applying the displayed changes.

Summary integrity checks preserve source output and expose conflicts for review. They cannot guarantee the correctness of a new model response. Missing source values remain unknown. Rating formulas and underwriting decisions are not replaced by this repair.

## Verification

The regression suite runs production functions with local fixtures and stubbed cloud/model boundaries. It covers classification recovery, concurrency, document identity and persistence, field mapping, edit ownership, loss arithmetic, source isolation and embedded page rendering.

With Node.js 22 or later:

```sh
cd tests
npm ci --ignore-scripts
npm test
```

Browser verification also uses the actual Workbench engine, phase adapters and redesigned templates with local source fixtures. Local checks do not certify production authentication, Supabase permissions, live AI/OCR services, exports, or a fresh end-to-end document run. Validate these on an authenticated preview before production promotion.

## Deployment

This is a static site. Deploy the repository root with `vercel.json` and the existing GitHub/Vercel project settings. The application needs no npm build step. `tests/` and its dependencies are excluded from deployment. Preserve the existing production branch until the repair preview has been verified.

Earlier release notes describe a different source release; they are historical context and are not certification of this redesigned repair.
