# Public / private dataset option

Created: 2026-09-29
Source: Telegram 29/9/2026 3:08am - "please add public private dataset option"

## Idea

- Add a public/private option to a dataset (project).
- Private stays as today (members only); public is viewable by others.
- Public datasets feed the discovery gallery
  (`tasks/public-dataset-gallery.md`).

## Open questions

- Applies to a project, or per dataset/label?
- Read-only view, or downloadable?
- Default private and opt-in to public?

## Status

- [ ] confirm scope with Beeno — project-level flag (dataset = project)
- [x] implement (2026-09-30)

## Implemented (2026-09-30)

- `project.is_public boolean null` (null/false = private, default private,
  opt-in public) — migration `db/migrations/20260930000000_project-is-public.ts`,
  `Project` type in `db/proxy.ts`, `db/erd.txt`.
- Access helpers in `server/app/context/project-context.tsx`:
  `canViewProject` (public → anyone incl. logged-out; private → admin /
  creator / member), `canEditProject` (admin / creator / member; public
  never grants write), `requireViewProjectById` / `requireEditProjectById`
  guards for ws/ajax endpoints.
- `NoAccessMessage` component (`server/app/components/no-access-message.tsx`).
- Project list UI: public/private badge + owner-only toggle button
  (`/project/set-visibility`, owner/admin only). `AddProject` accepts
  `is_public` (default private).
- Page-level `canViewProject` checks on all project-scoped pages (stats,
  manage-dataset, manage-labels ×3, upload-image, annotate-image,
  annotate-bounding-box, annotate-keypoint, manage-keypoints ×3, train-ai,
  preview-ai, review-bounding-box, similar-images, import-export-model,
  import-dataset, app-home).
- API-level checks: write endpoints require `canEditProject` (annotation
  updates, batch unlabel/delete/export, dataset import/export, label
  CRUD, keypoint templates, image upload/remove); read endpoints require
  `canViewProject` (list images, load label status, reload review).
- `/uploads` static files now gated by `uploadsAuthMiddleware`
  (`server/app/auth/uploads.ts`): a file is served only if it belongs to
  at least one project the viewer can see. Fixes the pre-existing hole
  where any logged-out visitor could fetch any uploaded image by filename.
- Owner checks added to `ModifyProject` / `DeleteProject` (previously any
  logged-in user could rename/delete any project), `AddMember` (owner
  only), `DeleteMember` (owner/admin, or self-leave).

## Remaining (for the gallery, `tasks/public-dataset-gallery.md`)

- Public read-only dataset detail page (`/dataset?project=`)
- Public gallery page (`/gallery`) with text search
- Public dataset download (reuse ExportDataset YOLO zip via HTTP streaming,
  not the ws/base64 path)
- Moderation: report button wiring on public pages, admin unlist
