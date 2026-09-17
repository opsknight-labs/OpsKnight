'use client';

import { useState, useTransition } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Settings,
  Shield,
  Users,
  Globe,
  Loader2,
  Check,
  Sparkles,
  Zap,
  Activity,
  Layers,
  HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import EscalationPolicyCombobox from '@/components/service/EscalationPolicyCombobox';

interface TeamOption {
  id: string;
  name: string;
}

interface PolicyOption {
  id: string;
  name: string;
  description?: string | null;
}

interface ServiceGeneralSettingsProps {
  service: {
    id: string;
    name: string;
    description: string | null;
    region: string | null;
    slaTier: string | null;
    teamId: string | null;
    escalationPolicyId: string | null;
  };
  teams: TeamOption[];
  policies: PolicyOption[];
  canManageService: boolean;
  action: (formData: FormData) => void | Promise<void>;
}

interface SlaTierDef {
  id: string;
  name: string;
  subtitle: string;
  uptime: string;
  ackTarget: string;
  colorClass: string;
  badgeClass: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SLA_TIERS: SlaTierDef[] = [
  {
    id: 'Platinum',
    name: 'Platinum',
    subtitle: 'Mission Critical',
    uptime: '99.99%',
    ackTarget: '15m Ack SLA',
    colorClass:
      'border-violet-500/40 bg-violet-500/5 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/30',
    badgeClass: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
    icon: Sparkles,
  },
  {
    id: 'Gold',
    name: 'Gold',
    subtitle: 'Business Critical',
    uptime: '99.9%',
    ackTarget: '30m Ack SLA',
    colorClass:
      'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30',
    badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    icon: Zap,
  },
  {
    id: 'Silver',
    name: 'Silver',
    subtitle: 'Standard Production',
    uptime: '99.5%',
    ackTarget: '1h Ack SLA',
    colorClass:
      'border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/30',
    badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    icon: Activity,
  },
  {
    id: 'Bronze',
    name: 'Bronze',
    subtitle: 'Non-Critical',
    uptime: '99.0%',
    ackTarget: '4h Ack SLA',
    colorClass:
      'border-slate-500/40 bg-slate-500/5 text-slate-700 dark:text-slate-300 ring-1 ring-slate-500/30',
    badgeClass: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
    icon: Layers,
  },
  {
    id: 'Internal',
    name: 'Internal',
    subtitle: 'Internal Tools',
    uptime: 'Best Effort',
    ackTarget: 'Standard Queue',
    colorClass:
      'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    icon: HelpCircle,
  },
];

const REGION_SUGGESTIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1', 'global'];

export default function ServiceGeneralSettings({
  service,
  teams,
  policies,
  canManageService,
  action,
}: ServiceGeneralSettingsProps) {
  const [name, setName] = useState(service.name);
  const [description, setDescription] = useState(service.description || '');
  const [selectedTier, setSelectedTier] = useState<string>(service.slaTier || '');
  const [teamId, setTeamId] = useState(service.teamId || '');
  const [escalationPolicyId, setEscalationPolicyId] = useState(service.escalationPolicyId || '');
  const [region, setRegion] = useState(service.region || '');
  const [isPending, startTransition] = useTransition();

  const isDirty =
    name !== service.name ||
    description !== (service.description || '') ||
    selectedTier !== (service.slaTier || '') ||
    teamId !== (service.teamId || '') ||
    escalationPolicyId !== (service.escalationPolicyId || '') ||
    region !== (service.region || '');

  const activeTierDef = SLA_TIERS.find(t => t.id === selectedTier);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (!canManageService) {
      e.preventDefault();
      return;
    }
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      await action(formData);
    });
  };

  return (
    <Card className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs">
      <CardHeader className="pb-4 border-b border-border/60 bg-muted/20 dark:bg-muted/10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20 shadow-2xs">
                <Settings className="h-4 w-4" />
              </div>
              <div>
                <span className="text-muted-foreground font-mono mr-1.5 text-xs">1.</span>
                <span>General Configuration</span>
              </div>
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Manage service identity, SLA tier classification, escalation routing, and team
              ownership.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] font-semibold w-fit px-2.5 py-0.5 inline-flex items-center gap-1.5',
              activeTierDef
                ? activeTierDef.badgeClass
                : 'text-muted-foreground border-border bg-muted/40'
            )}
          >
            {activeTierDef ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {activeTierDef.name} Tier
              </>
            ) : (
              'No SLA Tier Set'
            )}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-5">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Hidden input for SLA tier */}
          <input type="hidden" name="slaTier" value={selectedTier} />

          {/* Service Identity Section */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label
                  htmlFor="name"
                  className="text-xs font-semibold text-foreground flex items-center justify-between"
                >
                  <span>
                    Service Name <span className="text-destructive">*</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground font-normal">
                    Canonical identifier
                  </span>
                </Label>
                <Input
                  id="name"
                  name="name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  disabled={!canManageService || isPending}
                  placeholder="e.g. auth-service, payment-gateway"
                  className="text-xs h-9 bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="teamId"
                  className="text-xs font-semibold text-foreground flex items-center justify-between"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    Owning Team
                  </span>
                  <span className="text-[10px] text-muted-foreground font-normal">
                    {teams.length} available
                  </span>
                </Label>
                <select
                  id="teamId"
                  name="teamId"
                  value={teamId}
                  onChange={e => setTeamId(e.target.value)}
                  disabled={!canManageService || isPending}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">No Owning Team (Unassigned)</option>
                  {teams.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="description"
                className="text-xs font-semibold text-foreground flex items-center justify-between"
              >
                <span>Description</span>
                <span className="text-[10px] text-muted-foreground font-normal">
                  Service responsibilities and architecture context
                </span>
              </Label>
              <Textarea
                id="description"
                name="description"
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                disabled={!canManageService || isPending}
                placeholder="What critical components and flows does this service own?"
                className="text-xs bg-background resize-y"
              />
            </div>
          </div>

          {/* Interactive SLA Tier Grid */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-foreground">
                Service SLA Tier Classification
              </Label>
              {selectedTier && (
                <button
                  type="button"
                  onClick={() => setSelectedTier('')}
                  disabled={!canManageService || isPending}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors underline cursor-pointer"
                >
                  Clear Tier Selection
                </button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Categorizes response expectations, baseline availability targets, and priority
              escalation urgency for this service.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-1">
              {SLA_TIERS.map(tier => {
                const isSelected = selectedTier === tier.id;
                const IconComponent = tier.icon;
                return (
                  <button
                    key={tier.id}
                    type="button"
                    disabled={!canManageService || isPending}
                    onClick={() => setSelectedTier(isSelected ? '' : tier.id)}
                    className={cn(
                      'flex flex-col justify-between p-3 rounded-xl border text-left transition-all cursor-pointer relative',
                      'disabled:cursor-not-allowed disabled:opacity-60',
                      isSelected
                        ? tier.colorClass
                        : 'border-border/80 bg-card hover:bg-muted/40 hover:border-border text-foreground shadow-2xs'
                    )}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold flex items-center gap-1.5">
                          <IconComponent className="h-3.5 w-3.5 shrink-0" />
                          {tier.name}
                        </span>
                        {isSelected && (
                          <div className="h-4 w-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                            <Check className="h-2.5 w-2.5" />
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground font-medium">
                        {tier.subtitle}
                      </p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-border/40 flex items-center justify-between text-[10px] font-mono">
                      <span className="font-semibold">{tier.uptime}</span>
                      <span className="text-muted-foreground text-[9px]">{tier.ackTarget}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Operational Routing & Region */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border/50">
            <div className="space-y-1.5">
              <Label
                htmlFor="escalationPolicyId"
                className="text-xs font-semibold text-foreground flex items-center justify-between"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                  Default Escalation Policy
                </span>
                <span className="text-[10px] text-muted-foreground font-normal">
                  {policies.length} configured
                </span>
              </Label>
              <EscalationPolicyCombobox
                policies={policies}
                value={escalationPolicyId}
                onChange={setEscalationPolicyId}
                disabled={!canManageService || isPending}
              />
              <p className="text-[10px] text-muted-foreground">
                Determines the responder paging on-call rotation triggered by alerts for this
                service.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="region"
                className="text-xs font-semibold text-foreground flex items-center justify-between"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                  Primary Region / Deployment Zone
                </span>
                <span className="text-[10px] text-muted-foreground font-normal">
                  Cloud or datacenter
                </span>
              </Label>
              <Input
                id="region"
                name="region"
                value={region}
                onChange={e => setRegion(e.target.value)}
                disabled={!canManageService || isPending}
                placeholder="e.g. us-east-1, eu-central-1, global"
                className="text-xs h-9 bg-background font-mono"
              />
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-[9px] text-muted-foreground">Quick set:</span>
                {REGION_SUGGESTIONS.map(reg => (
                  <button
                    key={reg}
                    type="button"
                    disabled={!canManageService || isPending}
                    onClick={() => setRegion(reg)}
                    className={cn(
                      'text-[9px] px-1.5 py-0.5 rounded border transition-colors font-mono cursor-pointer',
                      region === reg
                        ? 'bg-primary/10 border-primary/30 text-primary font-semibold'
                        : 'bg-muted/40 border-border/60 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {reg}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Form Actions */}
          {canManageService && (
            <div className="pt-2 flex items-center justify-between gap-3 border-t border-border/50">
              <div className="text-[11px] text-muted-foreground">
                {isDirty ? (
                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                    You have unsaved changes.
                  </span>
                ) : (
                  <span>All settings are currently synced.</span>
                )}
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={!isDirty || isPending}
                className="text-xs font-semibold"
              >
                {isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Save Changes
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
