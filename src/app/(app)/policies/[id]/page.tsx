import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import StepsList from '@/components/policies/StepsList';
import PolicyDeleteButton from '@/components/PolicyDeleteButton';
import PolicyActivityTimeline from '@/components/policies/PolicyActivityTimeline';
import PolicyDetailTabs from '@/components/policies/PolicyDetailTabs';
import {
  updatePolicy,
  addPolicyStep,
  updatePolicyStep,
  deletePolicyStep,
  movePolicyStep,
  reorderPolicySteps,
} from '../actions';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import {
  ArrowLeft,
  ShieldAlert,
  ShieldCheck,
  Settings,
  AlertTriangle,
  Server,
  Activity,
  ChevronRight,
  Plus,
  ExternalLink,
} from 'lucide-react';
import { Input } from '@/components/ui/shadcn/input';
import { Textarea } from '@/components/ui/shadcn/textarea';

export const revalidate = 0;

export default async function PolicyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string; tab?: string }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const errorCode = resolvedSearchParams?.error;
  const defaultTab = resolvedSearchParams?.tab;

  const [policy, users, teams, schedules, services, auditLogs, permissions] = await Promise.all([
    prisma.escalationPolicy.findUnique({
      where: { id },
      include: {
        steps: {
          include: {
            targetUser: true,
            targetTeam: true,
            targetSchedule: true,
          },
          orderBy: { stepOrder: 'asc' },
        },
        services: {
          include: { team: true },
          orderBy: { name: 'asc' },
        },
      },
    }),
    prisma.user.findMany({
      where: { status: 'ACTIVE', role: { in: ['ADMIN', 'RESPONDER'] } },
      select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
      orderBy: { name: 'asc' },
    }),
    prisma.team.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.onCallSchedule.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.service.findMany({
      where: { escalationPolicyId: id },
      include: { team: true },
      orderBy: { name: 'asc' },
    }),
    prisma.auditLog.findMany({
      where: {
        entityType: 'ESCALATION_POLICY',
        entityId: id,
      },
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            gender: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
    }),
    getUserPermissions(),
  ]);

  if (!policy) notFound();

  const canManagePolicies = permissions.isAdmin;
  const totalDuration = policy.steps.reduce((acc, s) => acc + s.delayMinutes, 0);

  // Tab 1: Escalation Steps Content
  const stepsContent = (
    <StepsList
      initialSteps={policy.steps.map(step => ({
        ...step,
        targetTeam: step.targetTeam
          ? {
              ...step.targetTeam,
              teamLead: (step.targetTeam as any).teamLead, // eslint-disable-line @typescript-eslint/no-explicit-any
            }
          : null,
      }))}
      policyId={policy.id}
      canManage={canManagePolicies}
      updateStep={updatePolicyStep}
      deleteStep={deletePolicyStep}
      moveStep={movePolicyStep}
      reorderSteps={reorderPolicySteps}
      addStep={addPolicyStep}
      users={users}
      teams={teams}
      schedules={schedules}
    />
  );

  // Tab 2: Linked Services Content
  const servicesContent = (
    <Card className="border-slate-200/80 bg-white shadow-2xs">
      <CardHeader className="pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" />
              Attached Services ({services.length})
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Services currently routing incident notifications and alerts through this escalation
              policy.
            </CardDescription>
          </div>
          {canManagePolicies && (
            <Link href="/services">
              <Button variant="outline" size="sm" className="text-xs gap-1.5 h-8">
                <Plus className="h-3.5 w-3.5" />
                Manage Service Links
              </Button>
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {services.length === 0 ? (
          <div className="p-8 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 space-y-2">
            <Server className="h-8 w-8 text-slate-300 mx-auto" />
            <h4 className="text-sm font-semibold text-foreground">No services attached</h4>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Attach services to this escalation policy so that when alerts fire on a service,
              responders are notified in the configured step order.
            </p>
            {canManagePolicies && (
              <div className="pt-2">
                <Link href="/services">
                  <Button size="sm" className="text-xs">
                    Browse Services
                  </Button>
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {services.map(service => (
              <Link key={service.id} href={`/services/${service.id}`} className="block group">
                <div className="p-4 rounded-xl border border-slate-200/80 bg-white hover:border-primary/50 hover:bg-primary/5 transition-all flex items-start justify-between shadow-2xs">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5 truncate">
                      <Server className="h-3.5 w-3.5 text-slate-400 group-hover:text-primary shrink-0 transition-colors" />
                      <span className="truncate">{service.name}</span>
                    </div>
                    {service.team ? (
                      <p className="text-[11px] text-muted-foreground truncate">
                        Team:{' '}
                        <span className="font-medium text-slate-700">{service.team.name}</span>
                      </p>
                    ) : (
                      <p className="text-[11px] text-slate-400 italic">No team assigned</p>
                    )}
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-slate-300 group-hover:text-primary shrink-0 ml-2 transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );

  // Tab 3: Policy Activity History Content
  const activityContent = (
    <Card className="border-slate-200/80 bg-white shadow-2xs">
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Audit & Modification History
        </CardTitle>
        <CardDescription className="text-xs">
          Real-time record of all updates, step changes, and configuration modifications made to
          this policy.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PolicyActivityTimeline logs={auditLogs} />
      </CardContent>
    </Card>
  );

  // Tab 4: Policy Settings & Danger Zone Content
  const settingsContent = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
      {/* General Settings */}
      <Card className="border-slate-200/80 bg-white shadow-2xs">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Settings className="h-4 w-4 text-primary" />
            General Information
          </CardTitle>
          <CardDescription className="text-xs">
            Update the escalation policy name and description.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canManagePolicies ? (
            <form action={updatePolicy.bind(null, policy.id)} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Policy Name <span className="text-destructive">*</span>
                </label>
                <Input name="name" defaultValue={policy.name} required className="text-xs h-9" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Description</label>
                <Textarea
                  name="description"
                  defaultValue={policy.description || ''}
                  className="resize-none text-xs"
                  rows={4}
                  placeholder="Describe the operational purpose of this escalation policy..."
                />
              </div>
              <Button type="submit" size="sm" className="w-full text-xs font-medium">
                Save Policy Changes
              </Button>
            </form>
          ) : (
            <div className="bg-slate-50 p-4 rounded-xl text-xs text-muted-foreground italic border border-slate-200/60">
              You do not have permission to edit this policy. Admin role required.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      {canManagePolicies ? (
        <Card className="border-red-200 bg-red-50/20 shadow-2xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-red-900 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              Danger Zone
            </CardTitle>
            <CardDescription className="text-xs text-red-700/80">
              Destructive actions for this escalation policy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Deleting this policy will permanently remove all configured notification steps. Any
              services currently routing through this policy will become unassigned.
            </p>
            <div className="pt-2">
              <PolicyDeleteButton
                policyId={policy.id}
                servicesUsingPolicy={services.map(s => ({ id: s.id, name: s.name }))}
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-slate-200/80 bg-slate-50/40 shadow-2xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-muted-foreground flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-slate-400" />
              Access Control
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Escalation policy configuration and deletion are restricted to team administrators.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );

  return (
    <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 space-y-6">
      {/* Navigation Breadcrumb Bar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link
            href="/policies"
            className="hover:text-foreground font-medium flex items-center gap-1 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Escalation Policies
          </Link>
          <ChevronRight className="h-3 w-3 text-slate-400" />
          <span className="text-foreground font-semibold truncate max-w-[200px]">
            {policy.name}
          </span>
        </div>
      </div>

      {/* Centralized Hero Header */}
      <div className="bg-gradient-to-r from-primary via-primary/95 to-primary/80 text-white rounded-2xl p-6 sm:p-7 shadow-lg relative overflow-hidden">
        <div className="absolute -right-12 -bottom-12 w-64 h-64 rounded-full bg-white/5 pointer-events-none blur-2xl" />
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-white/15 text-white/90 backdrop-blur-xs border border-white/20">
                Incident Response Routing
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-2 text-white">
              <ShieldAlert className="h-7 w-7 shrink-0 text-white/90" />
              {policy.name}
            </h1>
            <p className="text-xs sm:text-sm text-white/80 leading-relaxed">
              {policy.description || 'No description provided for this escalation policy.'}
            </p>
          </div>

          {/* 3-Stat Capsule */}
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3.5 w-full lg:w-auto shrink-0">
            <Card className="bg-white/10 border-white/20 backdrop-blur-md text-white shadow-xs">
              <CardContent className="p-3 sm:p-4 text-center">
                <div className="text-xl sm:text-2xl font-black tracking-tight">
                  {policy.steps.length}
                </div>
                <div className="text-[10px] sm:text-xs text-white/75 font-medium mt-0.5">Steps</div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 border-white/20 backdrop-blur-md text-white shadow-xs">
              <CardContent className="p-3 sm:p-4 text-center">
                <div className="text-xl sm:text-2xl font-black tracking-tight text-emerald-200">
                  {services.length}
                </div>
                <div className="text-[10px] sm:text-xs text-white/75 font-medium mt-0.5">
                  Services
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 border-white/20 backdrop-blur-md text-white shadow-xs">
              <CardContent className="p-3 sm:p-4 text-center">
                <div className="text-xl sm:text-2xl font-black tracking-tight text-blue-200">
                  ~{totalDuration}m
                </div>
                <div className="text-[10px] sm:text-xs text-white/75 font-medium mt-0.5">
                  Cycle Time
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {errorCode === 'duplicate-policy' && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-xs font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          An escalation policy with this name already exists.
        </div>
      )}

      {/* Clean Tabbed Workspace Layout */}
      <PolicyDetailTabs
        defaultTab={defaultTab}
        stepCount={policy.steps.length}
        serviceCount={services.length}
        activityCount={auditLogs.length}
        steps={stepsContent}
        services={servicesContent}
        activity={activityContent}
        settings={settingsContent}
      />
    </div>
  );
}
