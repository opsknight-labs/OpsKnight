import Link from 'next/link';
import { getUserPermissions } from '@/lib/rbac';
import { deleteTemplate, getAllTemplates } from '../template-actions';
import { revalidatePath } from 'next/cache';
import ConfirmSubmitButton from '@/components/ConfirmSubmitButton';
import { Plus, Trash2, ArrowUpRight, Copy, MoreHorizontal, LayoutTemplate } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';
import CreateIncidentButton, {
  CreateIncidentMenuItem,
} from '@/components/incident/CreateIncidentButton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';

export const revalidate = 0;

const urgencyColorMap: Record<string, string> = {
  HIGH: 'border-l-red-500',
  MEDIUM: 'border-l-amber-500',
  LOW: 'border-l-emerald-500',
};

export default async function TemplatesPage() {
  const permissions = await getUserPermissions();
  const canManageTemplates = permissions.isResponderOrAbove;

  const templates = await getAllTemplates(permissions.id);

  async function handleDelete(formData: FormData) {
    'use server';
    const templateId = formData.get('templateId') as string;
    try {
      await deleteTemplate(templateId);
      revalidatePath('/incidents/templates');
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Failed to delete template');
    }
  }

  return (
    <main className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
      {/* Header Banner - Matches IncidentsPage style */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-lg p-4 md:p-6 shadow-lg">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight flex items-center gap-2">
              <LayoutTemplate className="h-6 w-6 md:h-8 md:w-8 text-indigo-400" />
              Incident Templates
            </h1>
            <p className="text-xs md:text-sm opacity-80 mt-1 max-w-xl">
              Standardize your incident response with pre-configured templates.
            </p>
          </div>
          {canManageTemplates && (
            <Link href="/incidents/templates/create">
              <Button className="bg-white text-slate-900 hover:bg-slate-100 font-semibold shadow-xl border border-white/20">
                <Plus className="w-4 h-4 mr-2" />
                Create Template
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Premium List Container */}
      <div className="group relative rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-50 shadow-sm overflow-hidden min-h-[400px]">
        {/* Decorative Accent Bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-slate-900 to-indigo-600 opacity-80" />

        {/* Header Strip */}
        <div className="px-4 md:px-5 py-3.5 border-b border-slate-200/60 flex flex-wrap justify-between items-center gap-3 bg-white/50 backdrop-blur-sm">
          <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500 font-extrabold">
            Available Templates
          </div>
          <div className="text-sm text-slate-500">
            Total: <span className="font-semibold text-slate-900">{templates.length}</span>
          </div>
        </div>

        {/* List Content */}
        <div className="p-3 md:p-4 lg:p-5 flex flex-col gap-3">
          {templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <LayoutTemplate className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-xl font-semibold mb-1 text-slate-900">No Templates Found</h3>
              <p className="text-sm text-slate-500 max-w-xs mx-auto mb-6">
                Create your first template to speed up incident creation.
              </p>
              {canManageTemplates && (
                <Link href="/incidents/templates/create">
                  <Button variant="outline">Create First Template</Button>
                </Link>
              )}
            </div>
          ) : (
            templates.map(template => (
              <div
                key={template.id}
                className={cn(
                  'group/row relative rounded-xl border bg-white shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-all duration-200',
                  'hover:shadow-md hover:-translate-y-[1px] hover:border-slate-300',
                  'border-slate-200',
                  'border-l-4',
                  urgencyColorMap[template.defaultUrgency] || 'border-l-slate-300'
                )}
              >
                <div className="flex gap-3 items-start p-3.5 md:p-4">
                  {/* Content Section */}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <h3 className="text-base font-bold text-slate-900 leading-tight">
                          {template.name}
                        </h3>
                        {template.isPublic ? (
                          <Badge
                            variant="secondary"
                            className="bg-green-50 text-green-700 border-green-200 hover:bg-green-100 text-[10px] font-bold uppercase tracking-wider h-5"
                          >
                            Public
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-slate-500 border-slate-200 text-[10px] font-bold uppercase tracking-wider h-5"
                          >
                            Private
                          </Badge>
                        )}
                      </div>

                      {/* Indicators */}
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            'font-mono text-[10px] uppercase border',
                            template.defaultUrgency === 'HIGH'
                              ? 'text-red-600 border-red-200 bg-red-50'
                              : template.defaultUrgency === 'MEDIUM'
                                ? 'text-amber-600 border-amber-200 bg-amber-50'
                                : 'text-emerald-600 border-emerald-200 bg-emerald-50'
                          )}
                        >
                          {template.defaultUrgency}
                        </Badge>
                        {template.defaultPriority ? (
                          <Badge
                            variant="secondary"
                            className="bg-slate-100 text-slate-600 border-slate-200 font-bold text-[10px]"
                          >
                            {template.defaultPriority}
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="bg-slate-100 text-slate-400 border-slate-200 font-bold text-[10px]"
                          >
                            No Priority
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 text-sm text-slate-500">
                      {template.description ? (
                        <p className="line-clamp-1 flex-1">{template.description}</p>
                      ) : (
                        <p className="italic opacity-50 flex-1">No description</p>
                      )}

                      <div className="flex items-center gap-4 text-xs font-medium shrink-0 opacity-80">
                        {template.defaultService && (
                          <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                            <span className="uppercase tracking-wider text-[10px] font-bold text-slate-400">
                              Service
                            </span>
                            <span className="text-slate-700">{template.defaultService.name}</span>
                          </div>
                        )}
                        <div className="hidden sm:flex items-center gap-1.5">
                          <span className="uppercase tracking-wider text-[10px] font-bold text-slate-400">
                            Default Title
                          </span>
                          <span
                            className="text-slate-700 max-w-[150px] truncate"
                            title={template.title}
                          >
                            {template.title}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons (Right Side) */}
                  <div className="flex items-center gap-1 self-start sm:self-center pl-2 border-l border-slate-100 ml-1">
                    <CreateIncidentButton
                      templateId={template.id}
                      size="sm"
                      className="h-8 shadow-sm bg-slate-900 text-white hover:bg-indigo-600 transition-colors"
                    >
                      Use Template
                      <ArrowUpRight className="w-3.5 h-3.5 ml-1.5 opacity-70" />
                    </CreateIncidentButton>

                    {canManageTemplates && template.createdById === permissions.id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 rounded-full hover:bg-slate-100"
                          >
                            <MoreHorizontal className="w-4 h-4 text-slate-500" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <CreateIncidentMenuItem templateId={template.id}>
                            <Copy className="w-4 h-4 mr-2" />
                            Use Template
                          </CreateIncidentMenuItem>
                          <form action={handleDelete}>
                            <input type="hidden" name="templateId" value={template.id} />
                            <ConfirmSubmitButton
                              confirmMessage="Are you sure you want to delete this template?"
                              className="w-full relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-red-50 hover:text-red-600 focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete Template
                            </ConfirmSubmitButton>
                          </form>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
