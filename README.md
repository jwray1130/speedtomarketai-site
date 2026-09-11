# Speed to Market AI

This repository serves the existing public homepage and the native Phase 7 application.

- `/` retains the current marketing homepage.
- `/platform` opens Queue, Pipeline, Summary, Documents and Administration.
- `/workbench?submission=<id>` opens the underwriting workbench for an authorized submission.

The application runs directly in the selected design. There is no hidden old application frame or runtime bridge. The application uses the existing Supabase project and deployed services; the shipped runtime contains no test sign-in, mocked cloud transport, or simulated AI provider.

## Preview and release status

The source application release passed 347 browser check groups with simulated cloud/authentication/AI transport and real controls, parsers, OCR and exports. The extracted release rebuilt byte-for-byte. This repository preserves 289 application files exactly from that tested release, including the vendor manifest and its 236 assets.

Three deployment files differ from the standalone application package: the existing homepage replaces its root redirect; `vercel.json` scopes the application's enforcing Content Security Policy separately from the existing homepage policy; `.vercelignore` excludes repository material while retaining bundled vendor licenses. `.gitattributes` prevents newline conversion from changing tested file hashes.

The homepage retains its existing report-only CSP. Platform, Workbench and vendor assets receive the candidate's exact enforcing CSP. Other common security headers remain site-wide. Browser tests of the standalone application do not certify a Vercel deployment or live backend security.

Use a separate preview deployment for the remaining live sign-in, save/reopen, database/storage permission and AI-service checks. Do not treat this branch as production certification. The production homepage and customer submission data have not been changed by preparing this branch.

## Deployment

This is a static site: deploy the repository root with its `vercel.json`, using the existing GitHub/Vercel project settings. No application build or npm install is required. Preserve the existing production-branch assignment. Verify preview headers, asset hashes, authentication redirects and representative workflows before promotion.

Source release archive: `STM_v10_Phase7_Release_Candidate.zip`.
SHA-256: `4b3dde34a6c41e177f3a83052db841d0f2b09529c632fea1c275e68938937f9f`.

See `RELEASE_NOTES.md` for the change and validation boundary.
