import 'server-only';

import prisma from '@/lib/prisma';

export type OnboardingStep = {
  id: 'service' | 'integration' | 'schedule' | 'policy' | 'teammate';
  title: string;
  description: string;
  href: string;
  done: boolean;
};

/** Pure mapping from counts to steps, kept separate so it is testable without a database. */
export function buildOnboardingSteps(c: {
  services: number;
  integrations: number;
  schedules: number;
  policies: number;
  users: number;
}): OnboardingStep[] {
  return [
    {
      id: 'service',
      title: 'Add a service',
      description: 'Model what you run and who owns it.',
      href: '/services',
      done: c.services > 0,
    },
    {
      id: 'integration',
      title: 'Connect an integration',
      description: 'Send alerts in from your monitoring tools.',
      href: '/settings/integrations',
      done: c.integrations > 0,
    },
    {
      id: 'schedule',
      title: 'Create an on-call schedule',
      description: 'Decide who is on call and when.',
      href: '/schedules',
      done: c.schedules > 0,
    },
    {
      id: 'policy',
      title: 'Create an escalation policy',
      description: 'Define who gets paged, and in what order.',
      href: '/policies',
      done: c.policies > 0,
    },
    // The first user is the admin who is setting up, so a teammate means a second user.
    {
      id: 'teammate',
      title: 'Invite a teammate',
      description: 'On-call works better with a team.',
      href: '/users',
      done: c.users > 1,
    },
  ];
}

/** Five cheap parallel count queries. */
export async function getOnboardingSteps(): Promise<OnboardingStep[]> {
  const [services, integrations, schedules, policies, users] = await Promise.all([
    prisma.service.count(),
    prisma.integration.count(),
    prisma.onCallSchedule.count(),
    prisma.escalationPolicy.count(),
    prisma.user.count(),
  ]);
  return buildOnboardingSteps({ services, integrations, schedules, policies, users });
}
