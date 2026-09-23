# One-click AI auto label (classification)

Use a local vision language model (VLM) to auto-annotate all images of a
project for a selected label with one click, replacing the premium
MiniCPM-API plan with a local Ollama model.

## Phase 1 — environment & validation (DONE 2026-09-23)

### Setup

- Ollama 0.34.3 installed (Windows), model `minicpm-v4.6:latest` (1.6GB) pulled.
- `img-read@1.1.4` added to `image-ai-builder` dependencies (CJS, imports fine
  from ESM; brings `openai` + `mime-detect`, no native modules).
- `server/env.ts` + `.env.example`: added `VLM_BASE_URL` (default
  `http://localhost:11434/v1`), `VLM_MODEL` (default `minicpm-v4.6`),
  `VLM_API_KEY` (default `no-api-key`). LM Studio works by changing
  `VLM_BASE_URL` to `http://localhost:1234/v1`.

### Test scripts (root of image-ai-builder, run with `node.exe`)

- `test-vlm.mts` — smoke test: reads images from `uploads/`, asks the VLM for
  `{"answer":"yes"|"no"}` JSON, prints parse results and per-image timing.
- `list-project.mts <project_id>` — lists labels (with annotation counts) and
  images of a project. NOTE: imports `./dist/db/proxy.js` (built output), not
  `./db/proxy.ts` — the `db/` folder has its own tsconfig and is not
  type-stripped at runtime.
- `test-accuracy.mts <project_id> <label_id> [limit]` — runs the VLM over
  annotated images and compares against human answers in `image_label`
  (confusion matrix + accuracy + timing).

### Accuracy report (project 17, model minicpm-v4.6, CPU inference)

| label        | tested | accuracy          | confusion               | speed     |
| ------------ | ------ | ----------------- | ----------------------- | --------- |
| `[38]` cat   | 20     | 19/20 = 95%       | tn=19, fp=1, fn=0, tp=0 | 12.9s/img |
| `[39]` bird  | 20     | 20/20 = 100%      | tp=20                   | 15.9s/img |
| **combined** | **40** | **39/40 = 97.5%** |                         | ~14s/img  |

- Gate (≥70%) passed → Phase 2 approved.
- The single fp: image `694f5583-03d...` (truth=no for cat, AI said yes).
- Prompt used: `Look at this image. Does it show {label}? Answer with JSON
only: {"answer":"yes"} or {"answer":"no"}. No other text.`
- Parser must be defensive: strip markdown fences, regex-recover
  `{"answer":"..."}` from prose. One empty-content response observed in ~45
  calls (retry once on empty content is advisable).
- CPU speed ~14s/image on Ryzen 5 5500U → a 6000-image project is ~23h.
  Progress broadcast + cancel + skip-already-annotated (resumable) are
  mandatory in Phase 2. `OLLAMA_KEEP_ALIVE=-1` recommended to avoid model
  reload between images.

## Phase 2 — backend service (DONE 2026-09-23)

- `server/app/auto-label.ts`: `startAutoLabelJob({ project_id, label_id,
user_id, onProgress, onFinish })` / `cancelAutoLabelJob(project_id)` /
  `getAutoLabelJob()`. Global single-job lock (`currentJob` module state);
  skips images with a latest answer for the label (resumable, never
  overwrites human annotations); retry once on empty/unparsed VLM response;
  aborts with status `failed` after 3 consecutive failures (VLM down guard).
- Prompt: same as the accuracy test; parser = JSON.parse + regex fallback
  `/\{\s*"answer"\s*:\s*"(yes|no)"\s*\}/i`.
- WS handlers live in `server/app/auto-label.tsx` (moved out of
  manage-dataset.tsx on 2026-09-23): `/auto-label/start` and
  `/auto-label/cancel`, registered via `...AutoLabel.routes` in routes.tsx.
  Pages that start the job (stats, manage-dataset) just emit these
  endpoints — no duplicated handler code. The progress broadcast
  (`broadcastAutoLabelProgress` / `broadcastAutoLabelFinished`) also lives
  there, targeting sessions on `/manage-dataset` and `/stats`.
- Progress broadcast: `broadcastAutoLabelProgress` / `broadcastAutoLabelFinished`
  send `['eval', ...]` to every session on `/manage-dataset` (same pattern as
  broadcastProgress in similar-images.tsx). The start handler opens a Swal
  progress dialog whose Cancel button emits auto-label-cancel.
- Dependency labels are NOT auto-marked by the job (user decision: skip for
  now — annotate-image submit already handles the precondition on manual
  labeling).
- Verified in browser (project 17): start shows `AI auto label... 0/N` with
  live yes/no/failed counts; cancel mid-job keeps written rows; re-start
  picks up only un-annotated images (0/5 → cancel after 1 → re-start 0/3 →
  done 58/58); double-start rejected with "another auto label job is already
  running"; fully-annotated label rejected with "all images are already
  annotated"; rows written with the triggering user's id and answer 0/1.

## Phase 3 — frontend: stats page button (DONE 2026-09-23)

- Button lives on the **stats page** (`/stats`), next to each label title in
  the label cards — the chart there already shows the unknown (un-annotated)
  count, so "how many are left" is visible right where the button is.
  (Original plan was the manage-dataset label panel; changed by user.)
- stats.tsx additions: sweetAlertPlugin node, `AutoLabelTexts` component
  (injects `window.autoLabelTexts`, same pattern as AIScript in
  annotate-image.tsx), client script with `startAutoLabel(label_id,
unknown_count)` (Swal confirm showing the un-annotated count and the ~15s
  per image CPU warning, then emits `/manage-dataset/auto-label-start`;
  checks `window.__ws.readyState === 1` before emitting), sparkles-outline
  button with the unknown count baked into onclick, `.stats-ai-button` CSS.
- unknown = 0 → info Swal "all images are already annotated" (no emit).
- `broadcastAutoLabelProgress` / `broadcastAutoLabelFinished` in
  manage-dataset.tsx now also target sessions on `/stats`; on finish the
  stats page reloads after 3s so the chart reflects the new distribution.
- WS handlers stay in manage-dataset.tsx — the stats page emits the same
  endpoints (no duplicated handler code).
- Verified in browser (project 17, zh-TW): buttons render with per-label
  unknown counts (38 → 6, 39 → 0); unknown=0 shows the info dialog; confirm
  dialog shows the localized count; progress Swal updates live (0/6 → 2/6);
  on completion the page auto-reloads and the chart shows unknown=0; DB
  rows written correctly (58/58).

## Phase 4 — mutually exclusive labels (TODO)

- `label.exclusive_group text NULL` migration (resilient pattern like
  `20250305120000_label-display-order.ts`).
- Enforce in 3 places: annotate-image submit (yes → siblings in group become
  no), auto-label job (keep one yes per group), manage-labels UI.
- Round-trip through dataset export/import metadata.
