import type { LoadScheduleFixture } from '../schedules';
import type { LoadTeamFixture, LoadUserFixture, ScaleDimensions } from '../users';

export interface LoadEscalationRuleFixture {
  id: string;
  policyId: string;
  stepOrder: number;
  delayMinutes: number;
  targetType: 'USER' | 'SCHEDULE' | 'TEAM';
  targetUserId?: string;
  targetScheduleId?: string;
  targetTeamId?: string;
   notifyOnlyTeamLead?: boolean;
   notificationChannels: Array<'EMAIL' | 'SMS' | 'PUSH' | 'SLACK' | 'WEBHOOK' | 'MICROSOFT_TEAMS'>;
}

export interface LoadEscalationPolicyFixture {
  id: string;
  name: string;
  description: string;
  rules: LoadEscalationRuleFixture[];
}

export function buildEscalationPolicyFixtures(
  scale: ScaleDimensions,
  users: LoadUserFixture[],
  teams: LoadTeamFixture[],
  schedules: LoadScheduleFixture[]
): LoadEscalationPolicyFixture[] {
  const policies: LoadEscalationPolicyFixture[] = [];
  const responders = users.filter(u => u.role !== 'USER');
  const userPool = responders.length > 0 ? responders : users;

  for (let i = 0; i < scale.escalationPolicies; i++) {
    const index = i + 1;
    const policyId = `lt-policy-${String(index).padStart(3, '0')}`;
    const primaryUser = userPool[i % userPool.length];
    const primarySchedule = schedules[i % schedules.length];
    const secondarySchedule = schedules[(i + 1) % schedules.length];
    const targetTeam = teams[i % teams.length];

    const rules: LoadEscalationRuleFixture[] = [
      {
        id: `lt-rule-${String(index).padStart(3, '0')}-s0`,
        policyId,
        stepOrder: 0,
        delayMinutes: 0,
        targetType: 'USER',
        targetUserId: primaryUser.id,
        notificationChannels: ['EMAIL', 'PUSH'],
      },
      {
        id: `lt-rule-${String(index).padStart(3, '0')}-s1`,
        policyId,
        stepOrder: 1,
        delayMinutes: 1,
        targetType: 'SCHEDULE',
        targetScheduleId: primarySchedule.id,
        notificationChannels: ['EMAIL', 'SMS', 'PUSH'],
      },
      {
        id: `lt-rule-${String(index).padStart(3, '0')}-s2`,
        policyId,
        stepOrder: 2,
        delayMinutes: 2,
        targetType: 'SCHEDULE',
        targetScheduleId: secondarySchedule.id,
        notificationChannels: ['EMAIL', 'SMS', 'SLACK'],
      },
      {
        id: `lt-rule-${String(index).padStart(3, '0')}-s3`,
        policyId,
        stepOrder: 3,
        delayMinutes: 3,
        targetType: 'TEAM',
        targetTeamId: targetTeam.id,
        notifyOnlyTeamLead: false,
        notificationChannels: ['EMAIL', 'SLACK', 'WEBHOOK'],
      },
    ];

    policies.push({
      id: policyId,
      name: `LoadCert 4-Step Escalation Policy ${String(index).padStart(3, '0')}`,
      description: `Deterministic 4-step escalation chain (User -> Primary Schedule -> Secondary Schedule -> Team Broadcast)`,
      rules,
    });
  }

  return policies;
}
