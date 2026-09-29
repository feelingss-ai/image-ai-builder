# Auto collect + annotate workflow

Created: 2026-09-29
Source: Telegram 23/9/2026 (design photos); Beeno tested VLM detection with
DeepSeek V4.1 Flash

## Idea

- Given keywords, auto collect images, auto pre-annotate with a VLM, store them
  in the builder, then train - with human review checkpoints.
- Compose existing pieces: `image-dataset` (collect), `img-read` (VLM), the
  builder (store / review / train), and the agent API/MCP to drive it.
- Auto-annotation must follow the same label rules as the manual flow:
  per-label yes/no, respect the parent dependency (ask children only when the
  parent is yes), and only use a pick-one choice inside a mutually exclusive
  group if that exists.

## Open questions

- Beeno has a more detailed design (across opencode / dsh / gemini sessions) -
  consolidate that first.
- Review checkpoint at each stage, or only at the end?

## Status

- [ ] consolidate the detailed design
