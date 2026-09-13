'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/rbac';
import { consumeMicrosoftTeamsIdentityChallenge } from '@/lib/microsoft-teams/identity';
import { emitAuditEvent } from '@/lib/audit';

const schema = z.object({ token: z.string().trim().min(32).max(256) }).strict();

export async function linkMicrosoftTeamsAccount(formData: FormData) {
  const parsed = schema.parse({ token: formData.get('token') });
  const user = await getCurrentUser();
  const link = await consumeMicrosoftTeamsIdentityChallenge(parsed.token, user.id);
  await emitAuditEvent({
    action: 'chatops.identity.linked', source: 'UI',
    target: { type: 'USER', id: user.id }, actor: { type: 'USER', id: user.id },
    metadata: { provider: 'MICROSOFT_TEAMS', providerTenantId: link.providerTenantId },
  }).catch(() => undefined);
  redirect('/settings?chatopsLinked=1');
}
