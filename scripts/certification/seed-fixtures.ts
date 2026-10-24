import { PrismaClient } from '@prisma/client';
import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { API_SCOPES } from '../../src/lib/authorization';

const DATABASE_URL = 'postgresql://opsknight:bf5efc57520313b61b4950d1ebf4f355@127.0.0.1:55490/opsknight?sslmode=disable';
const API_KEY_SECRET = 'd63f3fab7ed1d4bd07d921fac8ec8104b29f34e2587d62ccca2f6093a4f8934f';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } }
});

function hashToken(token: string): string {
  return createHmac('sha256', API_KEY_SECRET)
    .update(`opsknight:api-key:v2:${token}`)
    .digest('hex');
}

function mintToken(prefixStr: string = 'ok_test_') {
  const raw = randomBytes(24).toString('base64url');
  const token = `${prefixStr}${raw}`;
  return {
    token,
    prefix: token.slice(0, 12),
    tokenHash: hashToken(token)
  };
}

async function main() {
  console.log('Seeding certification test fixtures into DB...');

  // 1. Reference SLA & Classification policies
  await prisma.incidentSlaPolicy.upsert({
    where: { scopeKey_version: { scopeKey: 'workspace', version: 1 } },
    update: {},
    create: {
      id: 'cert-sla-workspace-v1',
      scopeKey: 'workspace',
      version: 1,
      inheritWorkspace: false,
      baseAckTargetMs: 15 * 60_000,
      baseResolveTargetMs: 120 * 60_000,
    },
  });

  await prisma.incidentClassificationPolicy.upsert({
    where: { scopeKey_version: { scopeKey: 'workspace', version: 1 } },
    update: {},
    create: {
      id: 'cert-classification-workspace-v1',
      scopeKey: 'workspace',
      version: 1,
      inheritWorkspace: false,
    },
  });

  // 2. Identities & Credentials
  // 2a. Admin User
  let adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!adminUser) {
    adminUser = await prisma.user.create({
      data: {
        name: 'Certification Admin',
        email: 'cert-admin@opsknight.local',
        passwordHash: '$2a$12$0IDUir/oGy2QmOUGx5EtI.GMQlN7muXz3lS3Twcs1FCE8LCplEm5W',
        role: 'ADMIN',
        status: 'ACTIVE'
      }
    });
  }

  // All active API scopes for admin
  const allScopes = Object.values(API_SCOPES);
  const adminMint = mintToken('ok_admin_');
  await prisma.apiKey.create({
    data: {
      name: 'Certification Admin Token',
      prefix: adminMint.prefix,
      tokenHash: adminMint.tokenHash,
      scopes: allScopes,
      userId: adminUser.id
    }
  });

  // 2b. Responder User
  const responderUser = await prisma.user.upsert({
    where: { email: 'responder@opsknight.local' },
    update: {},
    create: {
      name: 'Cert Responder',
      email: 'responder@opsknight.local',
      passwordHash: 'not-a-password',
      role: 'RESPONDER',
      status: 'ACTIVE'
    }
  });
  const responderMint = mintToken('ok_resp_');
  await prisma.apiKey.create({
    data: {
      name: 'Responder Token',
      prefix: responderMint.prefix,
      tokenHash: responderMint.tokenHash,
      scopes: ['incidents:read', 'incidents:write', 'services:read', 'teams:read', 'schedules:read', 'runbooks:read', 'runbooks:execute', 'postmortems:read', 'postmortems:write'],
      userId: responderUser.id
    }
  });

  // 2c. Auditor User
  const auditorUser = await prisma.user.upsert({
    where: { email: 'auditor@opsknight.local' },
    update: {},
    create: {
      name: 'Cert Auditor',
      email: 'auditor@opsknight.local',
      passwordHash: 'not-a-password',
      role: 'AUDITOR',
      status: 'ACTIVE'
    }
  });
  const auditorMint = mintToken('ok_audit_');
  await prisma.apiKey.create({
    data: {
      name: 'Auditor Token',
      prefix: auditorMint.prefix,
      tokenHash: auditorMint.tokenHash,
      scopes: ['audit:read', 'audit:export', 'incidents:read', 'services:read', 'teams:read', 'reports:read', 'postmortems:read'],
      userId: auditorUser.id
    }
  });

  // 2d. Regular User
  const regularUser = await prisma.user.upsert({
    where: { email: 'user@opsknight.local' },
    update: {},
    create: {
      name: 'Cert Regular User',
      email: 'user@opsknight.local',
      passwordHash: 'not-a-password',
      role: 'USER',
      status: 'ACTIVE'
    }
  });
  const regularMint = mintToken('ok_user_');
  await prisma.apiKey.create({
    data: {
      name: 'Regular User Token',
      prefix: regularMint.prefix,
      tokenHash: regularMint.tokenHash,
      scopes: ['incidents:read', 'services:read', 'reports:write'],
      userId: regularUser.id
    }
  });

  // 2e. Team A & User A
  const teamA = await prisma.team.create({
    data: {
      name: `Team Alpha ${Date.now()}`,
      description: 'Primary Core Team Alpha'
    }
  });
  const teamAUser = await prisma.user.create({
    data: {
      name: 'Team A Engineer',
      email: `team-a-eng-${Date.now()}@opsknight.local`,
      passwordHash: 'not-a-password',
      role: 'RESPONDER',
      status: 'ACTIVE'
    }
  });
  await prisma.teamMember.create({
    data: {
      teamId: teamA.id,
      userId: teamAUser.id,
      role: 'MEMBER'
    }
  });
  const teamAMint = mintToken('ok_teamA_');
  await prisma.apiKey.create({
    data: {
      name: 'Team A Token',
      prefix: teamAMint.prefix,
      tokenHash: teamAMint.tokenHash,
      scopes: ['incidents:read', 'incidents:write', 'services:read', 'teams:read'],
      userId: teamAUser.id
    }
  });

  // 2f. Team B & User B
  const teamB = await prisma.team.create({
    data: {
      name: `Team Beta ${Date.now()}`,
      description: 'Secondary Team Beta'
    }
  });
  const teamBUser = await prisma.user.create({
    data: {
      name: 'Team B Engineer',
      email: `team-b-eng-${Date.now()}@opsknight.local`,
      passwordHash: 'not-a-password',
      role: 'RESPONDER',
      status: 'ACTIVE'
    }
  });
  await prisma.teamMember.create({
    data: {
      teamId: teamB.id,
      userId: teamBUser.id,
      role: 'MEMBER'
    }
  });
  const teamBMint = mintToken('ok_teamB_');
  await prisma.apiKey.create({
    data: {
      name: 'Team B Token',
      prefix: teamBMint.prefix,
      tokenHash: teamBMint.tokenHash,
      scopes: ['incidents:read', 'incidents:write', 'services:read', 'teams:read'],
      userId: teamBUser.id
    }
  });

  // 2g. Limited Scope Token (only incidents:read)
  const limitedMint = mintToken('ok_ltd_');
  await prisma.apiKey.create({
    data: {
      name: 'Limited Scope Token',
      prefix: limitedMint.prefix,
      tokenHash: limitedMint.tokenHash,
      scopes: ['incidents:read'],
      userId: adminUser.id
    }
  });

  // 2h. Revoked Token
  const revokedMint = mintToken('ok_rev_');
  await prisma.apiKey.create({
    data: {
      name: 'Revoked Token',
      prefix: revokedMint.prefix,
      tokenHash: revokedMint.tokenHash,
      scopes: allScopes,
      userId: adminUser.id,
      revokedAt: new Date()
    }
  });

  // 2i. Expired Token
  const expiredMint = mintToken('ok_exp_');
  await prisma.apiKey.create({
    data: {
      name: 'Expired Token',
      prefix: expiredMint.prefix,
      tokenHash: expiredMint.tokenHash,
      scopes: allScopes,
      userId: adminUser.id,
      expiresAt: new Date(Date.now() - 3600000)
    }
  });

  // 2j. Disabled User & Token
  const disabledUser = await prisma.user.create({
    data: {
      name: 'Disabled User',
      email: `disabled-${Date.now()}@opsknight.local`,
      passwordHash: 'not-a-password',
      role: 'USER',
      status: 'DISABLED'
    }
  });
  const disabledMint = mintToken('ok_dis_');
  await prisma.apiKey.create({
    data: {
      name: 'Disabled User Token',
      prefix: disabledMint.prefix,
      tokenHash: disabledMint.tokenHash,
      scopes: allScopes,
      userId: disabledUser.id
    }
  });

  // 2k. Service Account
  const saUser = await prisma.user.create({
    data: {
      name: `Machine Automation SA ${Date.now()}`,
      email: `automation-sa-${Date.now()}@serviceaccount.opsknight.local`,
      passwordHash: 'not-a-password',
      role: 'ADMIN',
      status: 'ACTIVE',
      department: 'SERVICE_ACCOUNT',
      jobTitle: 'Service Account'
    }
  });
  const saMint = mintToken('ok_sa_live_');
  const saToken = await prisma.apiKey.create({
    data: {
      name: 'SA Primary Token',
      prefix: saMint.prefix,
      tokenHash: saMint.tokenHash,
      scopes: ['incidents:read', 'incidents:write', 'services:read', 'teams:read', 'automation:read'],
      userId: saUser.id
    }
  });

  // 3. Escalation Policies & Services
  const escalationPolicyA = await prisma.escalationPolicy.create({
    data: {
      name: `Alpha Escalation Policy ${Date.now()}`,
      description: 'Escalation for Team Alpha',
      steps: {
        create: [
          {
            stepOrder: 1,
            delayMinutes: 5,
            targetUserId: teamAUser.id,
            notificationChannels: ['EMAIL']
          }
        ]
      }
    }
  });

  const escalationPolicyB = await prisma.escalationPolicy.create({
    data: {
      name: `Beta Escalation Policy ${Date.now()}`,
      description: 'Escalation for Team Beta',
      steps: {
        create: [
          {
            stepOrder: 1,
            delayMinutes: 10,
            targetUserId: teamBUser.id,
            notificationChannels: ['EMAIL']
          }
        ]
      }
    }
  });

  const serviceA = await prisma.service.create({
    data: {
      name: `Payments Gateway ${Date.now()}`,
      description: 'Processes credit card payments',
      teamId: teamA.id,
      escalationPolicyId: escalationPolicyA.id,
      status: 'OPERATIONAL'
    }
  });

  const serviceB = await prisma.service.create({
    data: {
      name: `Inventory Catalog ${Date.now()}`,
      description: 'Product catalog and stock service',
      teamId: teamB.id,
      escalationPolicyId: escalationPolicyB.id,
      status: 'OPERATIONAL'
    }
  });

  // 4. Schedules & Layers
  const scheduleA = await prisma.onCallSchedule.create({
    data: {
      name: `Payments On-Call Rotation ${Date.now()}`,
      timeZone: 'UTC',
      layers: {
        create: [
          {
            name: 'Primary Rotation',
            start: new Date(),
            rotationLengthHours: 168,
            priority: 0,
            users: {
              create: [
                { userId: teamAUser.id, position: 0 }
              ]
            }
          }
        ]
      }
    }
  });

  // 5. Custom Field Definitions
  const cfEnv = await prisma.customField.create({
    data: {
      key: `environment_${Date.now()}`,
      name: 'Target Environment',
      type: 'SELECT',
      options: ['production', 'staging', 'development'],
      required: false,
      order: 1
    }
  });

  // 6. Incidents
  const tagAlpha = await prisma.tag.create({
    data: { name: `p1-outage-${Date.now()}` }
  });

  const incidentOpen = await prisma.incident.create({
    data: {
      title: 'Payment processing error rates exceeding 5% threshold',
      description: '502 Bad Gateway observed on /checkout endpoint',
      serviceId: serviceA.id,
      teamId: teamA.id,
      status: 'OPEN',
      urgency: 'HIGH',
      priority: 'P1',
      tags: {
        create: [
          { tagId: tagAlpha.id }
        ]
      }
    }
  });

  const incidentAcked = await prisma.incident.create({
    data: {
      title: 'Database connection pool saturation',
      description: 'Active connections reaching max limit',
      serviceId: serviceA.id,
      status: 'ACKNOWLEDGED',
      urgency: 'HIGH',
      priority: 'P2',
      assigneeId: teamAUser.id,
      acknowledgedAt: new Date()
    }
  });

  const incidentResolved = await prisma.incident.create({
    data: {
      title: 'Memory leak in session cache cluster',
      description: 'Resolved by rolling restart of Redis nodes',
      serviceId: serviceA.id,
      status: 'RESOLVED',
      urgency: 'MEDIUM',
      priority: 'P3',
      assigneeId: teamAUser.id,
      acknowledgedAt: new Date(Date.now() - 7200000),
      resolvedAt: new Date(Date.now() - 3600000)
    }
  });

  // Paginated incidents for pagination tests
  for (let i = 1; i <= 20; i++) {
    await prisma.incident.create({
      data: {
        title: `Pagination Load Incident #${i}`,
        serviceId: serviceB.id,
        teamId: teamB.id,
        status: i % 2 === 0 ? 'OPEN' : 'RESOLVED',
        urgency: 'LOW',
        priority: 'P4',
        resolvedAt: i % 2 !== 0 ? new Date() : null
      }
    });
  }

  // 7. Postmortem
  const postmortem = await prisma.postmortem.create({
    data: {
      incidentId: incidentResolved.id,
      title: 'Postmortem: Redis Session Cluster Memory Exhaustion',
      summary: 'Root cause was unbounded session storage keys without TTL',
      status: 'DRAFT',
      impact: {
        downtimeMinutes: 45,
        affectedUsers: 12000
      }
    }
  });

  // 8. Status Page
  const statusPage = await prisma.statusPage.create({
    data: {
      name: `OpsKnight Public Status ${Date.now()}`,
      slug: `status-${Date.now()}`,
      enabled: true,
      privacyMode: 'PUBLIC',
      services: {
        create: [
          { serviceId: serviceA.id, displayName: 'Payment API' },
          { serviceId: serviceB.id, displayName: 'Catalog Service' }
        ]
      }
    }
  });

  // 9. Runbook
  const runbook = await prisma.runbook.create({
    data: {
      name: `Restart Cache Cluster ${Date.now()}`,
      slug: `restart-cache-${Date.now()}`,
      description: 'Gracefully drains and restarts Redis instances',
      ownerTeamId: teamA.id,
      createdById: adminUser.id,
      versions: {
        create: [
          {
            version: 1,
            state: 'PUBLISHED',
            definition: {
              steps: [
                { id: 'step-1', name: 'Drain connections', type: 'manual' }
              ]
            },
            checksum: 'test-checksum-v1',
            createdById: adminUser.id
          }
        ]
      }
    }
  });

  // 10. Dashboard & Report
  const dashboard = await prisma.dashboard.create({
    data: {
      name: `Ops Overview ${Date.now()}`,
      description: 'Executive service reliability metrics',
      userId: adminUser.id,
      layout: {},
      widgets: {
        create: [
          {
            title: 'Incident Volume',
            widgetType: 'INCIDENT_COUNT',
            metricKey: 'incidents.total',
            position: { x: 0, y: 0, w: 6, h: 4 },
            config: {}
          }
        ]
      }
    }
  });

  const manifest = {
    seededAt: new Date().toISOString(),
    apiBase: 'http://127.0.0.1:3900/api/v2',
    directApiBase: 'http://127.0.0.1:3901/api/v2',
    tokens: {
      admin: adminMint.token,
      responder: responderMint.token,
      auditor: auditorMint.token,
      regular: regularMint.token,
      teamA: teamAMint.token,
      teamB: teamBMint.token,
      serviceAccount: saMint.token,
      limited: limitedMint.token,
      revoked: revokedMint.token,
      expired: expiredMint.token,
      disabled: disabledMint.token,
      coldStart: mintToken('ok_cold_').token
    },
    users: {
      adminId: adminUser.id,
      responderId: responderUser.id,
      auditorId: auditorUser.id,
      regularId: regularUser.id,
      teamAUserId: teamAUser.id,
      teamBUserId: teamBUser.id,
      disabledUserId: disabledUser.id,
      serviceAccountUserId: saUser.id
    },
    teams: {
      teamAId: teamA.id,
      teamBId: teamB.id
    },
    services: {
      serviceAId: serviceA.id,
      serviceBId: serviceB.id
    },
    escalationPolicies: {
      policyAId: escalationPolicyA.id,
      policyBId: escalationPolicyB.id
    },
    schedules: {
      scheduleAId: scheduleA.id
    },
    incidents: {
      openId: incidentOpen.id,
      ackedId: incidentAcked.id,
      resolvedId: incidentResolved.id
    },
    postmortems: {
      postmortemId: postmortem.id
    },
    statusPages: {
      statusPageId: statusPage.id
    },
    runbooks: {
      runbookId: runbook.id
    },
    dashboards: {
      dashboardId: dashboard.id
    },
    customFields: {
      envFieldId: cfEnv.id
    },
    serviceAccounts: {
      serviceAccountId: saUser.id,
      tokenId: saToken.id
    }
  };

  const manifestPath = path.resolve('tests/certification/fixtures.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('Seeded successfully! Saved fixture manifest to', manifestPath);
}

main()
  .catch(err => {
    console.error('Seeding failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
