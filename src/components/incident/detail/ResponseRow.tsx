'use client';

import { useState } from 'react';
import IncidentImpacts, { type IncidentImpactChip } from './IncidentImpacts';
import IncidentRoles, { type IncidentRoleSlot } from './IncidentRoles';
import type { IncidentPickerUser } from './IncidentUserPicker';
import type { IncidentRoleKey } from '@/lib/incidents/roles';

/**
 * Impacts and roles on the title card. Marked impacts and filled roles show as chips; whatever is still
 * empty (other roles, the impacted business service) sits behind one "+ Add", so the card never fills up
 * with dashed placeholders.
 */
export default function ResponseRow({
  incidentId,
  impacts,
  canEditImpacts,
  linkableImpacts = true,
  roles,
  users,
  currentUserId,
  onSetRole,
}: {
  incidentId: string;
  impacts: IncidentImpactChip[];
  canEditImpacts: boolean;
  linkableImpacts?: boolean;
  roles: IncidentRoleSlot[];
  users: IncidentPickerUser[];
  currentUserId: string;
  onSetRole: (roleKey: IncidentRoleKey, userId: string | null) => Promise<unknown>;
}) {
  const [impactOpen, setImpactOpen] = useState(false);
  return (
    <>
      <IncidentImpacts
        incidentId={incidentId}
        impacts={impacts}
        canEdit={canEditImpacts}
        linkable={linkableImpacts}
        open={impactOpen}
        onOpenChange={setImpactOpen}
        addFromMenu
      />
      <div className="min-w-0">
        <IncidentRoles
          roles={roles}
          users={users}
          currentUserId={currentUserId}
          onSetRole={onSetRole}
          addItems={
            canEditImpacts
              ? [
                  {
                    key: 'impact',
                    label: 'Impacted business service',
                    description: 'Mark a business service this incident affects.',
                    onSelect: () => setImpactOpen(true),
                  },
                ]
              : []
          }
        />
      </div>
    </>
  );
}
