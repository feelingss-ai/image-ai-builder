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
  `2025030512000_label-display-order.ts`).
- Enforce in 3 places: annotate-image submit (yes → siblings in group become
  no), auto-label job (keep one yes per group), manage-labels UI.
- Round-trip through dataset export/import metadata.

## Benchmark — model & prompt choice (2026-09-29/30)

Independent benchmark (Beeno) to pick the model/prompt for this feature.
Raw data: `~/agent/sessions/2026-09-29-vlm-autolabel-breed-test/`.

### Model choice

| Model | Task | Accuracy | Notes |
| --- | --- | --- | --- |
| **minicpm-v-4.6-thinking** | classification | species 91%, **breed 97%** | **best VLM tested** (fast + small) |
| qwen3-vl-4b-instruct | classification | breed 97% | fast (~1.8s), robust |
| qwen3.5-9b | classification | breed 97% | ~18s, not worth 10× |
| minicpm-v-4.6 (plain) | classification | breed 75% | needs a reasoning prompt |
| gemma-4-e2b / e4b | classification | 53% / 61% | not competitive |
| bonsai-27b | classification | ~36s/img | thinking trace dominates; impractical |

For **detection / boxes**, see `tasks/auto-label-box.md` (LocateAnything-3B).

Cantonese note: `minicpm-v-4.6` is marked "Only zh" in the LM Studio sheet —
meaning it can **read** Cantonese but **replies in written Chinese**. That is
fine for auto-labeling (we only need it to *understand* the image/prompt), so it
is not a blocker. Prefer a "Support" model only if the output must be Cantonese.

### Thinking: on vs off (measured 2026-09-30)

- Thinking models spend most of their time on the **hidden reasoning trace**:
  bonsai-27b same image **13.7s with thinking vs 1.2s with `--no-thinking`**
  (~11× faster).
- So the slow models are slow because of **long reasoning**, not output length.
- `img-read` supports `-r none|minimal|low|medium|high|xhigh` (or `--no-thinking`)
  to control this.

**Reasoning is NOT reliable without a prompt hint** (gemma-4-e4b, same request):

| prompt | reasoned? |
| --- | --- |
| base (no hint) | 2 of 4 runs (~50%) — the model decides |
| `-r high` (flag only) | 2 of 3 runs — still flaky |
| **"think step by step" + a `reason` field** | **4 of 4 runs — deterministic** |
| `-r none` | 0 of 4 — reliably suppresses |

So: **ask for it in the prompt** (a `reason` field before the answer) instead of
relying on the model to volunteer reasoning, or on a server flag. This is
deterministic, portable across models, and matches the Phase-1 change to
"explain before deciding".

### Context size vs memory (minicpm-v-4.6 and minicpm-v-4.6-thinking)

Both minicpm models (~752M, 1.92 GB file) share the same context → RAM curve:

| Context | RAM |
| --- | --- |
| 8k | 2.13 GB |
| **16k** | **2.24 GB** |
| 131k | 3.66 GB |
| 262k | 5.28 GB |

Running at **16k** (instead of 131k) uses ~2.24 GB instead of 3.66 GB — about
40% less memory, with **no meaningful speed change** (single-image calls are only
a few hundred tokens, far below the window). Shrinking context is a cheap way to
cut footprint for auto-labeling, where each call is one image.

### Prompt design comparison (breed, 64 images) — RESULT

Prompt shapes tested on `minicpm-v-4.6` (same question, different output shape /
whether a reason is requested):

- `pick1` — enumerate + pick exactly one (baseline)
- `pick1_reason` — reason first, then one
- `bool` — 8 independent booleans
- `unknown` — pick one, or "unknown"
- `terse` — bare breed name, no JSON

**Key method note:** `minicpm-v-4.6-thinking` **ignores `--no-thinking`** (it
always reasons). So the real thinking on/off comparison is the two **models**:
plain `minicpm-v-4.6` = OFF, `minicpm-v-4.6-thinking` = ON (same base, 1.92 GB).

| Variant | thinking ON | thinking OFF |
| --- | --- | --- |
| `unknown` | **62/64 (97%)** | 50/64 (78%) |
| `pick1` | 61/64 (95%) | 45/64 (70%) |
| `terse` | 61/64 (95%) | (n/a — flag ignored) |
| `pick1_reason` | 60/64 (94%) | 50/64 (78%) |
| `bool` | 57/64 (89%) | **18/64 (28%)** |

Findings:

- **Thinking matters a lot**: every variant drops 17–61 points without it.
- **A `reason` field only helps without thinking**: `pick1` 70% → `pick1_reason`
  78% (+8). With thinking it is a wash (95% → 94%) — the model is already at its
  ceiling. So add a reason hint only for weak models / when thinking is off.
- **Best variants**: `unknown` (97%) and `pick1` (95%). **`bool` (8 booleans) is
  the worst** — especially without thinking (28%), so avoid multi-label output.
- **`terse` (bare text, no JSON) is fine** (61/64 = 95% with thinking). An earlier
  "47%" was a **parser bug**: the model names several breeds while deliberating,
  so `head -1` (first match) grabbed a breed from the reasoning. The fix is to
  take the **last** breed name in the **Content** section (`tail -1`), which is
  the model's actual answer. The 3 remaining misses are genuine model errors.

Still to run: `yes/no` vs `true/false`, `unknown_reason`, `bool_reason`.

### Prompt-format findings

- **Reasoning-before-label helps, mostly for the weaker model.** On a 100-image
  species test, adding a one-sentence `reason` before the label cut minicpm
  false positives from **59 → 6** (exact match 46 → 80); for the strong model the
  gain was smaller (89 → 93). Reasoning is **nearly free** in time.
  This matches the Phase-1 change to "explain before deciding".
- **Probabilities / real numbers do NOT help.** The model emits `0`/`1` anyway;
  thresholding at 0.5 gave *more* false positives than a plain boolean.
  Confidence is not calibrated (negatives 0.73–0.85 vs positives 0.80–0.90).
- **`true/false` vs `"yes"/"no"`**: identical accuracy.
- **Two-stage** (VLM describe → text model label) rejected — same accuracy,
  extra latency.
- Per-label yes/no is what the job already does; **ask one label at a time**
  (batching several labels in one prompt caused over-triggering).

### Gotcha: local model load failures

LM Studio / Ollama load models just-in-time; the first calls after a model
switch can return **empty** ("Failed to load model ... Operation canceled").
If counted as wrong answers, results are skewed against whichever model ran
first after a switch. **Fix = warm-up call per model + retry on empty**
(the job already retries once on empty/unparsed — keep that).

### Speed note

Local CPU speed varies hugely: ~14s/img on Ryzen 5 5500U (Elly, Phase 1) vs
~1–2.5s/img on a discrete NVIDIA GPU (RTX 5050, Beeno). Benchmark on the
**deployment machine**; the ~15s/image warning in the UI is the CPU case.
