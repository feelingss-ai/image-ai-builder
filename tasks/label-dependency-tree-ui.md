# Label dependency tree UI

Created: 2026-09-29
Source: Telegram 21/9/2026
Priority: LOW (after mutually exclusive label groups)

## Idea

- The parent dependency (`label.dependency_id`) already works; only the display
  is a flat list.
- Show labels as a tree (parent / children) in manage-labels and the annotation
  page.

## Open questions

- Display only for now, or should the tree drive training?
- Render together with the mutually exclusive groups.

## Status

- [ ] implement the tree view
