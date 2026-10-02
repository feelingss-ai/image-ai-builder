# Public dataset gallery (discover / search datasets)

Created: 2026-09-29
Source: Telegram 29/9/2026 3:08am - "a gallary for public project for discover /
search suitable dataset for a public user"

## Idea

- A gallery of public projects so a public user can discover and search for a
  suitable dataset, without needing an account.
- The public/private dataset option decides what appears here
  (`tasks/public-sharing-flag.md`).
- Analogue of Roboflow Universe (public datasets are browsable).
- The similar-image / embedding work (Elly) could power "find a dataset like
  this one" search later.

## Open questions

- What does a public user get - browse/preview only, or download too?
- Search by text (name/tags/labels), and/or by example image?
- What metadata makes a dataset discoverable (task type, size, labels, preview)?
- Who approves a project to be public / any moderation?

## Status

- [x] Phase 3+4 implemented (2026-10-02) — public dataset detail page +
      gallery with text search
- [x] Phase 5 implemented (2026-10-02) — public dataset download
- [ ] confirm the gallery scope with Beeno

## Implemented (2026-10-02) — Phase 5: public download

- `buildDatasetZip` extracted from `ExportDataset` in
  `manage-dataset.tsx` (exported, along with `getProjectImages`,
  `select_project_labels_full`, `select_project_image_labels`,
  `select_project_bounding_boxes_full`) so the member export (ws/base64)
  and the public download share one zip-building path.
- `/dataset/download?project=` HTTP endpoint in `public-dataset.tsx`
  (resolve-based route, `streaming: false`): same visibility rule as the
  page (`canViewProject`), responds with `Content-Type: application/zip`
  - `Content-Disposition: attachment` directly on `res` (no ws/base64 —
    works for large datasets and logged-out visitors). Per-project build
    lock (`buildingProjects` map) serializes concurrent downloads of the
    same project. Errors: 400 JSON (`Dataset not found` / `project is
required` / `no images`).
- Download button on `/dataset` page (hidden when the project has no
  images). Filename: `dataset_{id}_{title-sanitized}.zip`.
- Verified: curl download of project 17 → HTTP 200, 9.2MB, 117 entries
  (data.yaml + metadata.json + metadata.sig + train/images +
  train/labels); private project 13 / missing project 999 / missing
  param → HTTP 400 `Dataset not found`.
  read-only view of a public project — title, Public badge, creator display
  name, image/label counts, latest 12 images grid, per-label yes/no/unknown
  charts (shared `StatsChart`), 4 sample images per label, report link to
  `/report-content?return_url=...`. Private project + non-member renders the
  same not-found message as a missing project (no existence leak); members
  see a "preview — dataset is private" note.
- **`/gallery`** (`server/app/pages/gallery.tsx`): lists all `is_public`
  projects as cards (3 newest thumbnails, title, creator, image/label
  counts). Search `?q=` matches project title OR any label title (case
  insensitive). Sort `?sort=newest` (default) | `?sort=images`.
- **Shared extraction**: `StatsChart` + `statsChartStyle` moved to
  `server/app/components/stats-chart.tsx`; `select_label_count`,
  `select_eligible_image_count`, `getLabelAnswerStats` moved to
  `server/app/context/project-stats.ts` (stats.tsx now imports them,
  behaviour unchanged).
- **Entry links**: landing page CTA "Browse Datasets" → `/gallery`;
  `/app/project` list footer link → `/gallery`; `/dataset` back button →
  `/gallery`.
- Images served via `/uploads/` — works for logged-out visitors on public
  projects thanks to the Phase 2 `uploadsAuthMiddleware`.

## Remaining

- Moderation: admin unlist action, report review wiring for datasets
- "Find similar dataset" via image embeddings (future, Elly's work)
