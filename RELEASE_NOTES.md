# Native Phase 7 preview

The visible Platform and Workbench pages now own the submission and underwriting workflows directly. This replaces the existing application pages with the verified native release while preserving the public homepage unchanged.

The update connects reviewed Summary values to Workbench, including explicit blanks and saved manual overrides; prevents delayed source loading from restoring older values; requires cloud acknowledgement before navigation; preserves recovery when saving or resetting fails; and persists review status with its History event. Browser parsing/export/OCR libraries are bundled locally, updated and recorded by version and SHA-256.

The original July prompts and rating engine remain byte-identical. The processing engine has eight event-wiring changes for enforcing CSP; source rules have three guards protecting reviewed Summary values. Reversing those declared changes restores the July hashes.

Validation before repository integration: 308 earlier regression groups, 14 PDF/security groups, 19 complete-workflow groups, and six delayed-source comparison groups, all passing. Separate migration, administration and PDF-compatibility logic checks passed. These use simulated service responses and do not prove live database isolation or provider behavior.

Initial repository integration preserved 289 exact tested application files and the exact existing homepage Git blob. The standalone root redirect is omitted. Security headers are scoped so the application and vendor workers receive the tested enforcing policy while the homepage keeps its existing report-only behavior. Vendor license files remain included.

A follow-up fixes Workbench email sign-in so the selected submission survives the return link. Both shared sign-in entry points retain the current origin and selected submission, omit unrelated query values and authentication fragments, and preserve existing route aliases. All 48 focused callback checks passed against the updated source; these are isolated logic checks and are separate from the earlier browser totals.

The local integrated homepage displays its existing access-code gate. Platform and Workbench display real sign-in requirements with no browser errors observed. No access code was bypassed, no magic link was sent, and no customer submission was modified.

Remaining validation: actual Vercel preview assets/headers; authorized live sign-in and redirects; representative save/reopen; two-account database and storage isolation; deployed model/website functions; and a production/rollback decision after those checks.
