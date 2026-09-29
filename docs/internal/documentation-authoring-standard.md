# OpsKnight documentation authoring standard

The documentation product must let a new reader complete a supported task
without reading source code or guessing a UI location. Feature-to-page mapping
is coverage evidence, not reader-quality evidence.

## Reader-completeness states

- `DISCOVERED` — the product surface exists in discovery.
- `MAPPED` — a documentation page is associated with it.
- `DRAFTED` — task-oriented content exists but has not passed the full reader contract.
- `READER_COMPLETE` — the page contains the complete task journey and verification/reversal guidance.
- `HUMAN_VERIFIED` — an unfamiliar reviewer completed the task using only the page and recorded evidence.
- `RUNTIME_VERIFIED` — the task also passed against the immutable candidate image through a recorded journey.

Only `READER_COMPLETE` or higher describes useful task documentation. Only
`HUMAN_VERIFIED` and `RUNTIME_VERIFIED` qualify as release evidence. Source
verification in `verification` is independent: it proves accuracy against code,
not usability.

Example metadata:

```yaml
reader:
  status: READER_COMPLETE
  task: Connect Slack and deliver a test incident to a service channel
  evidence: []
```

For `HUMAN_VERIFIED`, add the reviewer, ISO time, full reviewed revision, and
evidence paths. For `RUNTIME_VERIFIED`, also add an existing journey path. Never
promote a page from a structural checker alone.

## Page types

- **Concept** explains what a feature is, why it exists, boundaries, and relationships.
- **How-to** completes one operational task.
- **Tutorial** teaches an end-to-end workflow to a new user.
- **Reference** defines exact fields, options, states, API, or configuration contracts.
- **Troubleshooting** diagnoses a symptom and produces a verified recovery.
- **Deployment** installs or operates one supported topology.
- **Integration** connects, verifies, uses, rotates, and diagnoses an external system.

## How-to contract

A how-to page that claims `READER_COMPLETE` or higher contains:

1. A short statement of what the task accomplishes.
2. **Before you begin** or **Prerequisites** with role, permission, configuration, supported state, and dependencies.
3. **Open the feature** with exact UI navigation such as **Incidents → select incident → Collaboration**.
4. **Configure** when the task has fields or options.
5. Numbered completion steps using exact labels.
6. **What OpsKnight does** for material side effects and state transitions.
7. **Verify** with exact observable success criteria.
8. **Change or undo** when the action is reversible, or an explicit irreversibility boundary.
9. **Troubleshooting** with concrete symptoms and recovery.
10. **Next steps** with the adjacent reader journey.

Do not write “open collaboration controls” when the UI has a named path. Do not
invent a label that differs from the current product.

## Tutorial contract

A tutorial states the outcome, prerequisites, starting state, complete ordered
journey, checkpoints after meaningful stages, final verification, cleanup or
safe teardown, troubleshooting, and next production step.

## Deployment contract

A reader-complete deployment page contains prerequisites; topology choice;
installation; exact configuration and secret handling; rendered validation;
migration ownership; health verification; a first-user/incident acceptance
journey; production considerations; routine operation; backup/recovery;
upgrade/rollback; troubleshooting; and related pages. Commands must include the
working directory/context and expected success signal.

## Integration contract

A reader-complete integration page contains purpose and direction;
prerequisites; provider-side setup; exact OpsKnight navigation; authentication;
configuration fields; connection test; real incident use; expected state or
payload; failure/retry and limits; signature/security behavior; credential
rotation or disconnect; troubleshooting; and related pages.

## Troubleshooting contract

Organize by symptom. Each path states the check or command, expected healthy
result, branches for observed results, exact recovery, and verification. Preserve
diagnostic evidence before destructive recovery.

## Screenshot standard

Include a screenshot only when it answers where the reader must interact or
what a state change should look like. Place it beside the relevant step.

- Crop to the relevant UI; use a full page only when layout context matters.
- Use professional synthetic data and meaningful alt text.
- Prefer before/after images for state changes.
- Capture desktop and mobile only when the workflows differ.
- Do not add an image when text or a command is clearer.
- Tie every image to a runtime journey or a recorded manual UI verification.
- Never use a stale screenshot or expose real customer, credential, or local-test data.

## Human task verification

The reviewer must be unfamiliar with the specific feature and use only the
candidate documentation. Asking where to click, which value to enter, how to
verify success, or needing source code is a failed review. Record the exact
revision, environment/image, task, result, friction, and evidence. Fix the page
and repeat rather than explaining the missing step outside the documentation.

## Version language

Keep version identity at documentation-set and release-boundary pages. Do not
repeat the version in every reader page unless behavior genuinely differs by
version.
