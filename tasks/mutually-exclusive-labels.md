# Mutually exclusive label groups

Created: 2026-09-29
Source: Telegram 21/9/2026; confirmed 25/9 and 29/9
Priority: HIGH (before the dependency tree UI)

## Idea

- Today every label is an independent yes/no: `image_label.answer` is 0 or 1 per
  (image, label). Nothing stops two sibling labels both being yes.
- For a set of alternatives under a parent, only one should be true per image.
- Build it on top of the existing parent dependency (`label.dependency_id`) -
  the siblings under a parent are the mutually exclusive choices.
- Selecting one sibling clears the others.

## Note on the annotation model

- The storage stays per-label yes/no (`image_label.answer`); the group only
  constrains which labels may be yes. Do not turn it into a single multi-class
  column - other labels outside a group remain independent yes/no.

## Open questions

- Flag on the parent, or an explicit group? (confirm with Elly)
- Must pick one, or can pick none?
- Applies per image or per bounding box?

## Status

- [ ] confirm the design with Elly
- [ ] implement
