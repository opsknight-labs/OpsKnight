import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateApiKey } from '@/lib/api-keys';
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());
test('UI and REST share team membership, lead, revision and session-revocation outcomes', async ({
  page,
}) => {
  if (
    !['/runbook_ui_test', '/rbe_engine_test'].includes(
      new URL(process.env.DATABASE_URL ?? '').pathname
    )
  )
    throw new Error('Dedicated administration browser database required.');
  const suffix = crypto.randomUUID();
  const password = 'Team-parity-browser-harbor-472!';
  const admin = await db.user.create({
    data: {
      name: `Team admin ${suffix}`,
      email: `team-admin-${suffix}@example.invalid`,
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: await bcrypt.hash(password, 12),
    },
  });
  const target = await db.user.create({
    data: {
      name: `Team member ${suffix}`,
      email: `team-member-${suffix}@example.invalid`,
      status: 'ACTIVE',
    },
  });
  const team = await db.team.create({
    data: {
      name: `Team browser ${suffix}`,
      members: { create: { userId: admin.id, role: 'OWNER' } },
    },
  });
  const initial = await db.team.findUniqueOrThrow({ where: { id: team.id } });
  const issued = generateApiKey();
  const credential = await db.apiKey.create({
    data: {
      name: 'Team browser parity',
      userId: admin.id,
      scopes: ['teams:read', 'teams:write'],
      prefix: issued.prefix,
      tokenHash: issued.tokenHash,
    },
  });
  const apiHeaders = { Authorization: `Bearer ${issued.token}` };
  try {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(admin.email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('form button[type="submit"]').click();
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto(`/teams/${team.id}?tab=members`);
    await page.getByRole('button', { name: 'Add Member', exact: true }).click();
    const modal = page.getByRole('dialog');
    const searched = page.waitForResponse(response => {
      const url = new URL(response.url());
      return (
        url.pathname === `/api/teams/${team.id}/available-users` &&
        url.searchParams.get('q') === target.name
      );
    });
    await modal.getByRole('textbox', { name: 'Search available users' }).fill(target.name);
    expect((await searched).ok()).toBe(true);
    await expect(modal.getByRole('combobox').first()).toBeEnabled();
    await modal.getByRole('combobox').first().click();
    const targetOption = page.getByRole('option').filter({ hasText: target.name });
    await expect(targetOption).toBeVisible();
    await targetOption.click();
    await modal.getByRole('button', { name: 'Add to Team', exact: true }).click();
    await expect(modal).not.toBeVisible();
    const membership = () =>
      db.teamMember.findUnique({
        where: { userId_teamId: { userId: target.id, teamId: team.id } },
      });
    await expect.poll(async () => (await membership())?.role).toBe('MEMBER');
    await page.getByRole('button', { name: 'MEMBER', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Admin', exact: true }).click();
    await expect.poll(async () => (await membership())?.role).toBe('ADMIN');
    const row = () =>
      page
        .getByRole('tabpanel', { name: /Members/ })
        .locator('p')
        .filter({ hasText: target.email })
        .locator('xpath=ancestor::div[contains(@class, "p-3.5")][1]');
    await row().getByRole('switch').click();
    await expect.poll(async () => (await membership())?.receiveTeamNotifications).toBe(false);
    await row().getByRole('button', { name: 'ADMIN', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Set as Team Lead', exact: true }).click();
    await expect
      .poll(async () => (await db.team.findUniqueOrThrow({ where: { id: team.id } })).teamLeadId)
      .toBe(target.id);
    const stale = await page.request.put(`/api/v2/teams/${team.id}/members/${target.id}`, {
      headers: {
        ...apiHeaders,
        'If-Match': `"${initial.revision}"`,
        'Idempotency-Key': `stale-${suffix}`,
      },
      data: { role: 'MEMBER' },
    });
    expect(stale.status()).toBe(412);
    const readLead = await page.request.get(`/api/v2/teams/${team.id}/lead`, {
      headers: apiHeaders,
    });
    expect(readLead.status()).toBe(200);
    expect((await readLead.json()).data.teamLeadId).toBe(target.id);
    const change = await page.request.put(`/api/v2/teams/${team.id}/members/${target.id}`, {
      headers: {
        ...apiHeaders,
        'If-Match': readLead.headers().etag,
        'Idempotency-Key': `rest-${suffix}`,
      },
      data: { role: 'MEMBER', receiveTeamNotifications: true },
    });
    expect(change.status()).toBe(200);
    await page.reload();
    await expect(row().getByRole('button', { name: 'MEMBER', exact: true })).toBeVisible();
    await expect(row().getByRole('switch')).toBeChecked();
    await row().getByTitle('Remove member', { exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Remove Member', exact: true })
      .click();
    await expect.poll(membership).toBeNull();
    const finalLead = await page.request.get(`/api/v2/teams/${team.id}/lead`, {
      headers: apiHeaders,
    });
    expect((await finalLead.json()).data.teamLeadId).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).tokenVersion).toBe(
      target.tokenVersion + 4
    );
    expect(
      await db.auditLog.count({
        where: { action: 'team.member.added', entityId: `${team.id}:${target.id}` },
      })
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: { action: 'team.member.removed', entityId: `${team.id}:${target.id}` },
      })
    ).toBe(1);
    expect(
      await db.inAppNotification.count({ where: { userId: target.id, entityId: team.id } })
    ).toBe(2);
    const [uiService, apiService] = await Promise.all(
      ['UI', 'REST'].map(channel =>
        db.service.create({
          data: { name: `Team ${channel} service ${suffix}` },
        })
      )
    );
    // DB fixture writes do not invalidate the page's prefetched RSC service list.
    await page.reload();
    await expect(row()).toHaveCount(0);
    await page.getByRole('tab', { name: /Services/ }).click();
    await expect(page).toHaveURL(/tab=services/);
    await page.mouse.move(0, 0);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Assign Services', exact: true }).click();
    const serviceModal = page.getByRole('dialog');
    await serviceModal.getByText(uiService.name, { exact: true }).click();
    await serviceModal.getByRole('button', { name: 'Assign (1)', exact: true }).click();
    await expect(serviceModal).not.toBeVisible();
    await expect
      .poll(
        async () => (await db.service.findUniqueOrThrow({ where: { id: uiService.id } })).teamId
      )
      .toBe(team.id);
    const assigned = await page.request.put(`/api/v2/teams/${team.id}/services/${apiService.id}`, {
      headers: {
        ...apiHeaders,
        'If-Match': `"${apiService.revision}"`,
        'Idempotency-Key': `service-${suffix}`,
      },
      data: {},
    });
    expect(assigned.status()).toBe(200);
    await page.reload();
    await expect(
      page.getByRole('tabpanel', { name: /Services/ }).getByText(apiService.name, { exact: true })
    ).toBeVisible();
    const services = await page.request.get(`/api/v2/teams/${team.id}/services`, {
      headers: apiHeaders,
    });
    expect(services.status()).toBe(200);
    expect(
      (await services.json()).data.map((service: { id: string }) => service.id).sort()
    ).toEqual([uiService.id, apiService.id].sort());
    const history = await page.request.get(`/api/v2/teams/${team.id}/activity`, {
      headers: apiHeaders,
    });
    expect(history.status()).toBe(200);
    const events = (await history.json()).data;
    expect(
      events.filter((event: { action: string }) => event.action === 'team.services_assigned')
    ).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain(admin.email);
    const firstActivityPage = await page.request.get(`/api/v2/teams/${team.id}/activity?limit=1`, {
      headers: apiHeaders,
    });
    expect(firstActivityPage.status()).toBe(200);
    const firstActivity = await firstActivityPage.json();
    expect(firstActivity.pagination.hasMore).toBe(true);
    const nextActivityPage = await page.request.get(
      `/api/v2/teams/${team.id}/activity?limit=1&cursor=${firstActivity.pagination.nextCursor}`,
      { headers: apiHeaders }
    );
    expect(nextActivityPage.status()).toBe(200);
    expect((await nextActivityPage.json()).data[0].id).not.toBe(firstActivity.data[0].id);
    await page.goto(`/teams/${team.id}?tab=activity`);
    await expect(
      page
        .getByRole('tabpanel', { name: 'Activity', exact: true })
        .getByText('Team Audit Trail', { exact: true })
    ).toBeVisible();
  } finally {
    await db.apiKey.update({ where: { id: credential.id }, data: { revokedAt: new Date() } });
  }
});
