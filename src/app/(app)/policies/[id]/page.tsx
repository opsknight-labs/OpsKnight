import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import StepsList from '@/components/policies/StepsList';
import PolicyDeleteButton from '@/components/PolicyDeleteButton';
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
import { ArrowLeft, ShieldCheck, Settings, AlertTriangle, Server } from 'lucide-react';
import { Input } from '@/components/ui/shadcn/input';
import { Textarea } from '@/components/ui/shadcn/textarea';

export const revalidate = 0;

export default async function PolicyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const errorCode = resolvedSearchParams?.error;

  const [policy, users, teams, schedules, services, permissions] = await Promise.all([
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
    getUserPermissions(),
  ]);

  if (!policy) notFound();

  const canManagePolicies = permissions.isAdmin;
  const totalDuration = policy.steps.reduce((acc, s) => acc + s.delayMinutes, 0);

  return (
    <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 space-y-6">
      {/* Navigation Breadcrumb */}
      <div>
        <Link href="/policies">
          <Button
            variant="ghost"
            size="sm"
            className="pl-0 text-slate-500 mb-2 hover:text-slate-900 -ml-1 text-xs gap-1.5"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Escalation Policies
          </Button>
        </Link>

        {/* Hero Header */}
        <div className="bg-gradient-to-r from-primary via-primary/95 to-primary/80 text-white rounded-2xl p-6 sm:p-7 shadow-lg relative overflow-hidden">
          <div className="absolute -right-12 -bottom-12 w-64 h-64 rounded-full bg-white/5 pointer-events-none blur-2xl" />
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
            <div className="space-y-1.5 max-w-2xl">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-white/15 text-white/90 backdrop-blur-xs border border-white/20">
                  Escalation Policy Details
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-2 text-white">
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
                  <div className="text-[10px] sm:text-xs text-white/75 font-medium mt-0.5">
                    Steps
                  </div>
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
                    Cycle Duration
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>

      {errorCode === 'duplicate-policy' && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-xs font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          An escalation policy with this name already exists.
        </div>
      )}

      {/* Main Workspace Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main 2 Cols: Escalation Steps Manager */}
        <div className="lg:col-span-2 space-y-6">
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
        </div>

        {/* Sidebar 1 Col: Settings, Linked Services, Danger Zone */}
        <div className="space-y-6">
          {/* Policy Settings */}
          <Card className="border-slate-200/80 bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Settings className="h-3.5 w-3.5 text-primary" />
                Policy Settings
              </CardTitle>
            </CardHeader>
            <CardContent>
              {canManagePolicies ? (
                <form action={updatePolicy.bind(null, policy.id)} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">
                      Policy Name <span className="text-destructive">*</span>
                    </label>
                    <Input name="name" defaultValue={policy.name} required className="text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Description</label>
                    <Textarea
                      name="description"
                      defaultValue={policy.description || ''}
                      className="resize-none text-xs"
                      rows={3}
                      placeholder="Describe the purpose of this escalation policy..."
                    />
                  </div>
                  <Button type="submit" size="sm" className="w-full text-xs font-medium">
                    Save Changes
                  </Button>
                </form>
              ) : (
                <div className="bg-slate-50 p-3 rounded-lg text-xs text-muted-foreground italic border border-slate-200/60">
                  You do not have permission to edit this policy. Admin role required.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Linked Services */}
          <Card className="border-slate-200/80 bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                Linked Services ({services.length})
              </CardTitle>
              <CardDescription className="text-xs">
                Services currently routing incident alerts through this policy.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {services.length === 0 ? (
                <div className="p-3 text-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50">
                  <p className="text-xs text-muted-foreground italic">
                    No services are currently attached to this policy.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {services.map(service => (
                    <Link key={service.id} href={`/services/${service.id}`} className="block group">
                      <div className="p-3 rounded-lg border border-slate-200/80 hover:border-primary/40 hover:bg-primary/5 transition-all flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors truncate">
                            {service.name}
                          </div>
                          {service.team && (
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              Team: {service.team.name}
                            </div>
                          )}
                        </div>
                        <Server className="h-3.5 w-3.5 text-slate-400 group-hover:text-primary transition-colors shrink-0 ml-2" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Danger Zone */}
          {canManagePolicies && (
            <Card className="border-red-100 bg-red-50/20">
              <CardContent className="p-4 space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-red-900">
                  Danger Zone
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Deleting this policy will remove all configured notification steps. Services
                  routing here will become unassigned.
                </p>
                <div className="pt-2">
                  <PolicyDeleteButton
                    policyId={policy.id}
                    servicesUsingPolicy={services.map(s => ({ id: s.id, name: s.name }))}
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
