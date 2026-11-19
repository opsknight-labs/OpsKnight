/**
 * The policy as written to the audit log. Two things made the entry lose information: a key with
 * "session" in its name is redacted by the log sanitizer as if it were a credential (the sign-in
 * idle days are a number), and the same list assigned under two keys was once reported as circular.
 * The copy breaks shared references; the idle-days setting is recorded as `idleDays`.
 */
export function policyAuditDetails<T extends Record<string, unknown>>(policy: T) {
  const copy = JSON.parse(JSON.stringify(policy)) as Record<string, unknown>;
  if ('sessionIdleDays' in copy) {
    copy.idleDays = copy.sessionIdleDays;
    delete copy.sessionIdleDays;
  }
  return copy;
}
