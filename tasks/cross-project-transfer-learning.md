# Cross-project transfer learning

Created: 2026-09-29
Status: agent proposal - not requested; drop if not useful

## Idea

- Reuse a trained model (or its frozen feature extractor) as the starting point
  for a new label/project, so small datasets train faster and better.
- Related to the existing transfer-learning mode and the trained model store.

## Open questions

- Within a project only, or across projects?
- Reuse user-owned models only (privacy), or a shared base model?

## Status

- [ ] decide if this is wanted
