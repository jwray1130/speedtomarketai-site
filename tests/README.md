# Regression verification

Run `npm ci --ignore-scripts` and `npm test` in this directory with Node.js 22 or later.

Tests execute production parsers, source resolvers, adapters and rendering functions against local fixtures. Cloud and model boundaries are stubbed. The suite does not send customer documents to external services and is excluded from the static deployment.

Live authentication, PDF intake, model output, storage permissions, exports and cloud save/reopen require separate acceptance checks on an authenticated preview.

After changing an inline HTML or generated frame script, run `node csp-hashes.cjs --write` here to refresh the report-only CSP hashes, then rerun the suite. The updater preserves all other policy directives.
