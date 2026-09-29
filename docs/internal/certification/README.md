# Documentation certification

Generated certification reports belong here. A report records the commit,
capability coverage, journey results, evidence inventory, broken-link count,
reference validation, and deployment-example validation.

Certification output is evidence about a specific revision, not a permanent
product claim.

## Human review sign-offs

`reviewer-checklists.yaml` separates review instructions from completed review.
Every area has an explicit `pending`, `passed`, or `failed` sign-off. A completed
sign-off must name the reviewer, ISO review time, full source revision, and
repository evidence paths. Do not populate these fields from an automated
content check.

Normal static certification reports pending reviews without pretending that
they passed. Release certification runs the same contract with `--release` and
fails unless every area has an evidence-backed `passed` sign-off.

## v1.5 knowledge parity

The generated topic inventory is not a parity claim. Each disposition must be a
human-reviewed record tied to the current source revision and evidence. Static
certification reports reviewed and pending totals. Release certification fails
until all inventory topics have valid dispositions; bulk title matching or an
automated destination guess does not qualify as manual review.
