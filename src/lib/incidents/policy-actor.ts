export type PolicyAuditSource = 'UI' | 'API' | 'RESTORE' | 'SYSTEM' | 'MIGRATION';

export type AuthorizedPolicyActor = {
  actorId: string;
  capabilities: readonly string[];
  source: PolicyAuditSource;
};
