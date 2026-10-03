#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';

const baseUrl = process.env.DEMO_URL || process.env.APP_URL || 'http://localhost:3000';
const prisma = new PrismaClient();

async function runVerification() {
  console.log('🧪 Starting OpsKnight Demo automated verification suite...');
  let failures = 0;

  // 1. HTTP Endpoint checks
  const endpoints = [
    { path: '/api/health', expectedStatus: 200, label: 'API Health Check' },
    { path: '/status', expectedStatus: 200, label: 'Default Status Page (/status)' },
    { path: '/status/healthy', expectedStatus: 200, label: 'All-Green Status Page (/status/healthy)' },
    { path: '/status/degraded', expectedStatus: 200, label: 'Degraded Status Page (/status/degraded)' },
  ];

  for (const ep of endpoints) {
    try {
      const url = `${baseUrl}${ep.path}`;
      const res = await fetch(url, { redirect: 'follow' });
      if (res.status === ep.expectedStatus) {
        console.log(`  ✅ [HTTP] ${ep.label} (${ep.path}) responded HTTP ${res.status}`);
      } else {
        console.error(`  ❌ [HTTP] ${ep.label} (${ep.path}) returned HTTP ${res.status} (expected ${ep.expectedStatus})`);
        failures++;
      }
    } catch (err) {
      console.error(`  ❌ [HTTP] ${ep.label} (${ep.path}) connection failed:`, err.message);
      failures++;
    }
  }

  // 2. Database & Security Isolation Verification
  try {
    // 2a. Demo Admin Verification
    const demoAdmin = await prisma.user.findUnique({
      where: { email: 'demo@opsknight.local' },
    });

    if (demoAdmin && demoAdmin.role === 'ADMIN' && demoAdmin.status === 'ACTIVE') {
      console.log('  ✅ [AUTH] Demo Admin user verified: demo@opsknight.local (ADMIN, ACTIVE)');
    } else {
      console.error('  ❌ [AUTH] Demo Admin user missing or invalid role/status');
      failures++;
    }

    // 2b. Zero External Outbound Integration Credentials Verification
    const slackIntegrations = await prisma.slackIntegration.count();
    const slackConfigs = await prisma.slackOAuthConfig.count();
    const oidcConfigs = await prisma.oidcConfig.count();
    const notificationProviders = await prisma.notificationProvider.count();
    const webhookIntegrations = await prisma.webhookIntegration.count();
    const statusPageWebhooks = await prisma.statusPageWebhook.count();
    const servicesWithWebhook = await prisma.service.count({
      where: { webhookUrl: { not: null } },
    });

    const outboundCredentialsFound =
      slackIntegrations +
      slackConfigs +
      oidcConfigs +
      notificationProviders +
      webhookIntegrations +
      statusPageWebhooks +
      servicesWithWebhook;

    if (outboundCredentialsFound === 0) {
      console.log('  ✅ [ISOLATION] Zero external credentials verified (no Slack, Teams, OIDC, Twilio, or outbound webhooks)');
    } else {
      console.error(`  ❌ [ISOLATION] Found ${outboundCredentialsFound} seeded external integration credentials or webhooks!`);
      failures++;
    }

    // 2c. Showcase Dataset Volume Verification
    const teamCount = await prisma.team.count();
    const serviceCount = await prisma.service.count();
    const incidentCount = await prisma.incident.count();
    const statusPageCount = await prisma.statusPage.count();
    const onCallScheduleCount = await prisma.onCallSchedule.count();

    if (teamCount >= 6 && serviceCount >= 18 && incidentCount >= 30 && statusPageCount >= 3) {
      console.log(
        `  ✅ [DATASET] Showcase dataset populated: ${teamCount} teams, ${serviceCount} services, ${incidentCount} incidents, ${onCallScheduleCount} on-call schedules, ${statusPageCount} status pages`
      );
    } else {
      console.error(
        `  ❌ [DATASET] Incomplete dataset: teams=${teamCount}, services=${serviceCount}, incidents=${incidentCount}, statusPages=${statusPageCount}`
      );
      failures++;
    }
  } catch (err) {
    console.error('  ❌ [DATABASE] Database inspection error:', err.message);
    failures++;
  } finally {
    await prisma.$disconnect();
  }

  if (failures > 0) {
    console.error(`\n❌ Demo verification failed with ${failures} error(s).`);
    process.exit(1);
  }

  console.log('\n🎉 Demo environment verified: all health endpoints, credentials, isolation constraints, and datasets passed!');
}

runVerification().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
