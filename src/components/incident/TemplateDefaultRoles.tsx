'use client';

import { UsersRound } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { INCIDENT_ROLES, type IncidentRoleKey } from '@/lib/incidents/roles';

const NONE = '__none__';

export type TemplateDefaultRolesValue = Partial<Record<IncidentRoleKey, string>>;

/** Optional role holders applied to every incident declared from the template. */
export default function TemplateDefaultRoles({
  users,
  value,
  onChange,
}: {
  users: Array<{ id: string; name: string }>;
  value: TemplateDefaultRolesValue;
  onChange: (next: TemplateDefaultRolesValue) => void;
}) {
  const holderOf = (key: IncidentRoleKey) =>
    Object.entries(value).find(([roleKey]) => roleKey === key)?.[1];
  return (
    <div className="rounded-2xl border border-border/80 bg-card text-card-foreground shadow-2xs p-5 sm:p-6 space-y-4">
      <div className="flex items-center gap-2.5 pb-2 border-b border-border/70">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary">
          <UsersRound className="h-4 w-4" aria-hidden />
        </div>
        <div>
          <h3 className="text-sm font-bold text-foreground">Default Roles</h3>
          <p className="text-[11px] text-muted-foreground">
            Optional. These people take the roles on every incident declared from this template.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {INCIDENT_ROLES.map(role => (
          <div key={role.key} className="space-y-1">
            <label
              htmlFor={`default-role-${role.key}`}
              className="text-xs font-semibold text-foreground"
            >
              {role.label}
            </label>
            <Select
              value={holderOf(role.key) ?? NONE}
              onValueChange={next => {
                const rest = Object.fromEntries(
                  Object.entries(value).filter(([roleKey]) => roleKey !== role.key)
                ) as TemplateDefaultRolesValue;
                onChange(next === NONE ? rest : { ...rest, [role.key]: next });
              }}
            >
              <SelectTrigger id={`default-role-${role.key}`} className="h-9 text-xs">
                <SelectValue placeholder="No default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE} className="text-xs text-muted-foreground">
                  No default
                </SelectItem>
                {users.map(user => (
                  <SelectItem key={user.id} value={user.id} className="text-xs">
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{role.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
