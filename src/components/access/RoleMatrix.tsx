import { Check, Minus } from 'lucide-react';

import {
  getRoleCapabilities,
  roleLabel,
  ROLE_DESCRIPTIONS,
  type AppRole,
  type Capability,
} from '@/lib/authorization';
import {
  ALL_CATALOGUED_CAPABILITIES,
  CAPABILITY_GROUPS,
  capabilityGroupLabel,
  capabilityInfo,
} from '@/lib/access/catalog';
import { cn } from '@/lib/utils';

const ROLES: AppRole[] = ['USER', 'AUDITOR', 'RESPONDER', 'ADMIN'];

/** Capabilities shown in the matrix, grouped. Purely personal ones are hidden as noise. */
const HIDDEN: ReadonlySet<Capability> = new Set(['user.notification_preferences'] as Capability[]);

/**
 * Role comparison generated from the enforced role definitions, so it is always accurate.
 * `highlight` marks a role (for example the one being assigned); `current` marks the viewer's.
 */
export default function RoleMatrix({
  highlight,
  current,
  compact = false,
}: {
  highlight?: AppRole | null;
  current?: AppRole | null;
  compact?: boolean;
}) {
  const roleCaps = new Map(ROLES.map(role => [role, new Set(getRoleCapabilities(role))]));
  const groups = CAPABILITY_GROUPS.map(group => ({
    group,
    label: capabilityGroupLabel(group),
    capabilities: ALL_CATALOGUED_CAPABILITIES.filter(
      capability =>
        capabilityInfo(capability).group === group &&
        !HIDDEN.has(capability) &&
        ROLES.some(role => roleCaps.get(role)!.has(capability))
    ),
  })).filter(group => group.capabilities.length > 0);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <caption className="sr-only">What each role can do</caption>
        <thead>
          <tr className="bg-muted/50">
            <th scope="col" className="px-3 py-2 text-left font-medium text-muted-foreground">
              Permission
            </th>
            {ROLES.map(role => (
              <th
                key={role}
                scope="col"
                className={cn(
                  'px-3 py-2 text-center font-semibold text-foreground',
                  highlight === role && 'bg-primary/10'
                )}
              >
                <div>{roleLabel(role)}</div>
                {current === role && (
                  <div className="text-[10px] font-normal uppercase text-muted-foreground">You</div>
                )}
              </th>
            ))}
          </tr>
          {!compact && (
            <tr className="border-b border-border">
              <td />
              {ROLES.map(role => (
                <td
                  key={role}
                  className={cn(
                    'px-3 pb-2 text-center align-top text-[11px] text-muted-foreground',
                    highlight === role && 'bg-primary/10'
                  )}
                >
                  {ROLE_DESCRIPTIONS.get(role)}
                </td>
              ))}
            </tr>
          )}
        </thead>
        {groups.map(group => (
          <tbody key={group.group}>
            <tr className="bg-muted/30">
              <th
                scope="rowgroup"
                colSpan={ROLES.length + 1}
                className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {group.label}
              </th>
            </tr>
            {group.capabilities.map(capability => (
              <tr key={capability} className="border-t border-border/60">
                <th scope="row" className="px-3 py-1.5 text-left font-normal text-foreground">
                  {capabilityInfo(capability).label}
                </th>
                {ROLES.map(role => {
                  const has = roleCaps.get(role)!.has(capability);
                  return (
                    <td
                      key={role}
                      className={cn(
                        'px-3 py-1.5 text-center',
                        highlight === role && 'bg-primary/10'
                      )}
                    >
                      {has ? (
                        <Check className="mx-auto h-4 w-4 text-emerald-600" aria-label="Yes" />
                      ) : (
                        <Minus
                          className="mx-auto h-4 w-4 text-muted-foreground/40"
                          aria-label="No"
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
