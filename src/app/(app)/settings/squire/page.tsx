import { Brain } from 'lucide-react';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import { requirePageAccess } from '@/lib/access/server';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import {
  isSquireMemoryEnabled,
  listSquireMemories,
  SQUIRE_MEMORY_LIMITS,
} from '@/lib/intelligence/squire/memory';
import SquireMemoryPanel from './SquireMemoryPanel';

export const revalidate = 0;

export default async function SquireSettingsPage() {
  await requirePageAccess('/settings/squire');
  const actor = await getCurrentAuthorizationActor();
  const [memories, enabled] = await Promise.all([
    listSquireMemories(actor.id),
    isSquireMemoryEnabled(actor.id),
  ]);

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        eyebrow="Personal"
        title="Squire Memory"
        description="What Squire remembers about you, used to tailor its answers. Only you can see it."
        icon={Brain}
      />
      <SquireMemoryPanel
        memories={memories.map(memory => ({ id: memory.id, text: memory.text }))}
        enabled={enabled}
        limits={SQUIRE_MEMORY_LIMITS}
      />
    </div>
  );
}
