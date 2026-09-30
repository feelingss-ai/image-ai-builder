# Auto label — bounding box (detection / grounding)

Companion to `tasks/auto-label-classification.md` (which covers per-label yes/no
classification). This task covers auto-annotating **boxes**, not just labels.

## Why

Classification answers "does this image contain X?" but many datasets need the
**location** (wound, vomit/poop, tongue/jaw pose). One-click auto **box**
annotation would bootstrap those projects the same way the classifier bootstraps
classification projects.

## Candidate model

**LocateAnything-3B** — open-vocabulary detection / grounding (locate an object
from a text prompt, no training needed).

## Benchmark result (2026-09-30)

| Test | Result |
| --- | --- |
| dog (grounding) | IoU **100%**, mean IoU **0.96** |
| vomit / poop | localizes well |

So it grounds common objects near-perfectly and handles the animal-health
classes (vomit, poop) usefully.

## Approach (proposed)

- Extend the existing auto-label job (`server/app/auto-label.ts`) with a **box
  mode**: instead of writing `image_label.answer`, write `image_bounding_box`
  rows (label_id + x/y/width/height).
- The model is prompted with the label name (open-vocabulary), so it works
  without a trained detector — good for **cold start** on a new project.
- Store as **suggestions for human review** (same philosophy as the
  classification AI suggestion), not as confirmed boxes.
- Respect the parent dependency: only propose a box for a label whose parent is
  yes (see `tasks/auto-label-classification.md`).

## Relationship to the trained box model

We already train local box models (MobileNet / Small-CNN tiers). Likely split:

- **Cold start / new project** → LocateAnything-3B (no training needed).
- **After enough labels** → the project's trained box model (smaller, faster,
  and tuned to the project's classes).

## Open questions

- Speed / memory on the target laptop vs the classification models?
- Small / occluded objects — the known weak spot of the trained box models; does
  LocateAnything do better?
- Multiple boxes per image (e.g. several lesions) — supported?
- Export/format compat with the existing `image_bounding_box` schema and the
  YOLO dataset export?
- Should the job pick box-vs-classification mode automatically per label?

## Status

- [ ] confirm model + prompt for box auto-label
- [ ] extend the auto-label job with a box mode
- [ ] human review flow for suggested boxes
