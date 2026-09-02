'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Plus, Trash2, ArrowRight, Shield, Code2, ChevronRight } from 'lucide-react';

export type RoleMappingRule = {
  claim: string;
  value: string;
  role: 'USER' | 'ADMIN' | 'RESPONDER' | 'AUDITOR';
};

type Props = {
  initialMappings?: RoleMappingRule[] | null;
  onChange?: (mappings: RoleMappingRule[]) => void;
};

export default function RoleMappingEditor({ initialMappings, onChange }: Props) {
  const parsedMappings = Array.isArray(initialMappings) ? initialMappings : [];
  const [mappings, setMappings] = useState<RoleMappingRule[]>(parsedMappings);
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    onChange?.(mappings);
  }, [mappings, onChange]);

  const addRule = () => {
    setMappings([...mappings, { claim: 'groups', value: '', role: 'USER' }]);
  };

  const removeRule = (index: number) => {
    setMappings(mappings.filter((_, i) => i !== index));
  };

  const updateRule = (index: number, field: keyof RoleMappingRule, value: string) => {
    const newMappings = [...mappings];
    newMappings[index] = { ...newMappings[index], [field]: value };
    setMappings(newMappings);
  };

  return (
    <div className="space-y-3">
      {/* Hidden input for server action form submission */}
      <input type="hidden" name="roleMapping" value={JSON.stringify(mappings)} />

      {mappings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 p-6 text-center bg-muted/20 space-y-2">
          <div className="p-2 rounded-full bg-muted w-9 h-9 mx-auto flex items-center justify-center text-muted-foreground">
            <Shield className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-foreground">
              No role mapping rules configured
            </p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
              Users signing in via SSO will receive the default{' '}
              <span className="font-semibold text-foreground">USER</span> role unless explicitly
              mapped here.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addRule}
            className="h-8 text-xs gap-1.5 mt-2"
          >
            <Plus className="h-3.5 w-3.5" />
            Add First Rule
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {/* Header titles for desktop */}
          <div className="hidden sm:grid sm:grid-cols-[1fr_auto_1fr_auto_140px_36px] gap-2 px-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            <span>IdP Claim Key</span>
            <span className="w-5 text-center">Match</span>
            <span>Expected Value</span>
            <span className="w-5 text-center">Action</span>
            <span>Assigned Role</span>
            <span className="w-9" />
          </div>

          {/* Rule rows */}
          <div className="space-y-2">
            {mappings.map((rule, index) => (
              <div
                key={index}
                className="rounded-xl border border-border/80 bg-card p-3 sm:p-2.5 shadow-sm transition-all hover:border-border flex flex-col sm:grid sm:grid-cols-[1fr_auto_1fr_auto_140px_36px] items-stretch sm:items-center gap-2.5"
              >
                {/* Field 1: Claim Key */}
                <div className="space-y-1 sm:space-y-0 min-w-0">
                  <span className="sm:hidden text-[10px] font-semibold uppercase text-muted-foreground">
                    Claim Key
                  </span>
                  <Input
                    type="text"
                    placeholder="e.g. groups or role"
                    value={rule.claim}
                    onChange={e => updateRule(index, 'claim', e.target.value)}
                    required
                    className="h-8 text-xs font-mono"
                  />
                </div>

                {/* Operator = */}
                <div className="hidden sm:flex items-center justify-center w-5 text-muted-foreground font-mono text-xs font-bold">
                  =
                </div>

                {/* Field 2: Expected Value */}
                <div className="space-y-1 sm:space-y-0 min-w-0">
                  <span className="sm:hidden text-[10px] font-semibold uppercase text-muted-foreground">
                    Expected Value
                  </span>
                  <Input
                    type="text"
                    placeholder="e.g. admin or devops"
                    value={rule.value}
                    onChange={e => updateRule(index, 'value', e.target.value)}
                    required
                    className="h-8 text-xs font-mono"
                  />
                </div>

                {/* Operator -> */}
                <div className="hidden sm:flex items-center justify-center w-5 text-muted-foreground">
                  <ArrowRight className="h-3.5 w-3.5" />
                </div>

                {/* Field 3: Role Selector */}
                <div className="space-y-1 sm:space-y-0">
                  <span className="sm:hidden text-[10px] font-semibold uppercase text-muted-foreground">
                    Assigned Role
                  </span>
                  <select
                    value={rule.role}
                    onChange={e =>
                      updateRule(index, 'role', e.target.value as RoleMappingRule['role'])
                    }
                    className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors cursor-pointer"
                  >
                    <option value="ADMIN">Admin (Full Access)</option>
                    <option value="RESPONDER">Responder (Incidents)</option>
                    <option value="AUDITOR">Auditor (Read-Only)</option>
                    <option value="USER">User (Standard)</option>
                  </select>
                </div>

                {/* Remove button */}
                <div className="flex items-center justify-end sm:justify-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRule(index)}
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    aria-label={`Remove rule ${index + 1}`}
                    title="Remove rule"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Action bar below rules */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRule}
              className="h-8 text-xs gap-1.5 self-start"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Rule
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Rules are evaluated top-down. The first matching claim assigns the role.
            </p>
          </div>
        </div>
      )}

      {/* JSON Payload Inspector (Collapsible) */}
      <div className="pt-2">
        <button
          type="button"
          onClick={() => setShowJson(!showJson)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-medium transition-colors"
        >
          <Code2 className="h-3.5 w-3.5" />
          <span>{showJson ? 'Hide JSON Preview' : 'Show JSON Preview'}</span>
          <ChevronRight
            className={`h-3 w-3 transition-transform duration-150 ${showJson ? 'rotate-90' : ''}`}
          />
        </button>

        {showJson && (
          <div className="mt-2 rounded-lg border bg-muted/40 p-3 space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Serialized Rule Payload
            </div>
            <pre className="text-xs font-mono text-muted-foreground overflow-auto max-h-48 p-2 rounded bg-background/50 border">
              {JSON.stringify(mappings, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
