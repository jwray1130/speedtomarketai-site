# Speed to Market AI Unified Workbench Prototype — Phase 01

This is a GitHub-ready static prototype showing the unified product vision:

1. New Submission opens inside the underwriting workbench.
2. The user sees a Submission Intake + AI Pipeline card.
3. Process Submission simulates the pipeline stages.
4. The system creates a reviewable draft packet.
5. Apply Draft to Workbench fills Deal Info, addresses, broker, losses, limits, risk profile, and underwriting narrative fields.

## Files

- `index.html` — workbench shell with unified intake bridge loaded.
- `style.css` — existing workbench design system.
- `app.js` — existing workbench logic.
- `pipeline-bridge.css` — Phase 01 unified intake/review/pipeline UI.
- `pipeline-bridge.js` — deterministic prototype bridge and mock draft packet.
- `vercel.json` — clean URL config.

## How to run locally

Open `index.html` in a browser, or run a static server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## What is intentionally mocked

This phase does not call the live LLM/Supabase pipeline. `pipeline-bridge.js` uses a deterministic sample `SAMPLE_PACKET` so the product flow can be reviewed safely and quickly.

## Intended next phase

Replace the mock packet with the live pipeline output and add a resolver module:

- `buildSubmissionDraftPacket(extractions)`
- `resolveSourcePriority(packet)`
- `resolveTowerRules(packet)`
- `applySubmissionDraftToWorkbench(resolvedPacket)`
