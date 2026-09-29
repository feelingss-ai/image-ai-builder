# Active learning loop (which images to label next)

Created: 2026-09-29
Source: Beeno, inspired by Roboflow's active learning

## Idea

- Use the partially-trained model to score unlabeled images and label the most
  informative first.
- Loop: train -> score -> label the top ones -> retrain.
- Since annotation is per-label yes/no (`image_label.answer` 0/1), "least
  informative" means **least confidence for that label** (output near the 0.5
  decision boundary), computed **per label** - not a multi-class softmax.
  (Only within a mutually exclusive group would a class-style confidence apply,
  and only once that feature exists.)

## Already exists

- AI **classification** suggestion is already done by Elly
  (`annotate-image.tsx`: toggle, inline badge, ArrowDown to accept, Esc to
  dismiss). Not for boxes yet.

## Not done yet

- The active-learning scoring itself (choosing which image to label next).
- Suggesting a **box** (only classification suggestion exists so far).

## Must respect the parent dependency

- A child label only applies when its parent is yes (precondition), and images
  already marked negative for the parent are skipped for the child.
- So scoring/queueing is per label and must follow that order: don't queue a
  child's images until the parent is satisfied.

## Open questions

- Score all unlabeled images, or a sample?
- One queue per label, per project, or shared?

## Status

- [ ] agree on the scoring approach
- [ ] wire into the annotation flow
