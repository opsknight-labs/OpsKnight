# Documentation capability map

The machine-readable inventory is
[`docs/v2.0.0/capabilities.yaml`](../v2.0.0/capabilities.yaml). Each entry links a
product capability to its concepts, task guides, reference contracts, tests,
source evidence, generated runtime evidence, roles, and coverage status.

## Status meanings

- `discovered` — source evidence exists, but documentation coverage is not mapped.
- `partial` — at least one required documentation or evidence layer is missing.
- `documented` — required pages exist and source/test evidence is mapped.
- `certified` — documented coverage and runtime evidence passed for this revision.

Empty arrays are intentional coverage gaps. They must not be replaced with
invented paths to make a check pass.
