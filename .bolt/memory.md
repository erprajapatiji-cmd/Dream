# Project memory

## Product intent & audience

- Ball by Ball Data API Pipeline: ingests Kaggle cricket datasets and transmits ball-by-ball records via an authenticated API key.
- Framework: Vite + React.
- Audience: developers/data engineers consuming cricket ball-by-ball data through an API; user-facing app likely includes a bulk import/upload UI.

## Brand personality & voice

- Production-grade, not cookie-cutter. Beautiful, intentional design.
- User-facing copy uses Hindi/Hinglish when the user writes in Hindi, explaining technical steps clearly and simply.

## Visual design & UX direction

- File/import flow must show selection count (e.g., "448 files queued"), a prominent bulk import button ("Import All N Files"), and import progress.
- Guidance is to recommend smaller batches (100–150 files) if large selections stall.
- UI built with JSX + Tailwind classes; icons from lucide-react; `@/` alias for `src/` imports.

## Decisions, constraints & rationale

- Kaggle datasets are the source; API key is required to transmit records.
- Batch importing is supported but very large selections (e.g., 448 files) may require browser file-access permission or smaller batches.
- Avoid extra UI packages unless absolutely necessary or requested.

## Open questions & assumptions

- Whether server-side processing or a backend exists for the API pipeline, or if this is frontend-only scaffolding.
- How Kaggle data is obtained (manual download/upload vs. automated fetch) and where the API key is stored/used.
- Data format/schema of the ball-by-ball records (columns, match linkage) is not yet defined.