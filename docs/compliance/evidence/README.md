# Evidence collection

The [machine-readable index](../../../src/lib/compliance/evidence.ts) is derived from the [control catalogue](../../../src/lib/compliance/controls.ts).

For each reviewed control record: control ID; product commit/version; operator/deployment; reviewer and UTC timestamp; source link; protected artifact location; observed outcome; gap or exception; owner; next review date. Preserve failures as well as successes. Restrict sensitive operational artifacts and follow an approved retention policy.

Backup evidence starts with the [recovery procedure](../../v1.5/deployment/backup-restore.md), [restore workflow](../../../.github/workflows/enterprise-readiness.yml) and [verifier](../../../scripts/verify-backup-restore.sh). Download actual drill output and record the run and commit. The workflow retains its reports for 90 days; that is not a production recovery guarantee. Operators must preserve their own restoration results, recovery times, backup age, key availability and scheduled drill records.
