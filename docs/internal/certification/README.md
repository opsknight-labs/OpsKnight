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
