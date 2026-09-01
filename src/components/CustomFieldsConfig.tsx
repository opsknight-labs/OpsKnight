'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { errorFromResponse } from '@/lib/client-error';
import { toUserFacingError } from '@/lib/user-facing-error';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Switch } from '@/components/ui/shadcn/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/shadcn/dialog';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/shadcn/card';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import { EmptyState } from '@/components/settings/feedback/EmptyState';
import ConfirmDialog from '@/components/settings/ConfirmDialog';
import {
  FileText,
  Plus,
  Trash2,
  Edit2,
  AlertTriangle,
  Loader2,
  SlidersHorizontal,
  Calendar,
  Hash,
  Link as LinkIcon,
  Mail,
  ToggleLeft,
  Eye,
  Search,
  CheckCircle2,
  Sparkles,
  Database,
  Columns,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type CustomField = {
  id: string;
  name: string;
  key: string;
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN' | 'URL' | 'EMAIL';
  required: boolean;
  defaultValue?: string | null;
  options?: string[] | null | undefined;
  order: number;
  showInList: boolean;
  _count: {
    values: number;
  };
};

type CustomFieldsConfigProps = {
  customFields: CustomField[];
  onOpenCreate?: () => void;
};

const typeConfigs: Record<
  CustomField['type'],
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string; desc: string }
> = {
  TEXT: {
    label: 'Text',
    icon: FileText,
    color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    desc: 'Single-line text string',
  },
  NUMBER: {
    label: 'Number',
    icon: Hash,
    color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
    desc: 'Numeric identifier or count',
  },
  DATE: {
    label: 'Date',
    icon: Calendar,
    color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    desc: 'Calendar timestamp',
  },
  SELECT: {
    label: 'Dropdown',
    icon: SlidersHorizontal,
    color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    desc: 'Select from predefined options',
  },
  BOOLEAN: {
    label: 'Toggle',
    icon: ToggleLeft,
    color: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
    desc: 'Yes/No switch toggle',
  },
  URL: {
    label: 'URL Link',
    icon: LinkIcon,
    color: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
    desc: 'External HTTP web link',
  },
  EMAIL: {
    label: 'Email',
    icon: Mail,
    color: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    desc: 'Contact email address',
  },
};

const QUICK_TEMPLATES: Array<{
  name: string;
  key: string;
  type: CustomField['type'];
  required: boolean;
  defaultValue: string;
  options: string;
  showInList: boolean;
  description: string;
}> = [
  {
    name: 'Customer Impact Tier',
    key: 'customer_tier',
    type: 'SELECT',
    required: true,
    defaultValue: 'Tier 1 - Mission Critical',
    options: 'Tier 1 - Mission Critical, Tier 2 - High Value, Tier 3 - Standard, Internal Only',
    showInList: true,
    description: 'Track customer SLA severity and business priority',
  },
  {
    name: 'Root Cause Category',
    key: 'root_cause_category',
    type: 'SELECT',
    required: false,
    defaultValue: '',
    options:
      'Software Bug, Hardware Failure, Network / DNS, Database / Cache, Human Error, Third-Party Provider',
    showInList: true,
    description: 'Categorize postmortem and incident origins',
  },
  {
    name: 'Jira Issue Key',
    key: 'jira_issue_key',
    type: 'TEXT',
    required: false,
    defaultValue: '',
    options: '',
    showInList: true,
    description: 'Link remediation ticket (e.g. PROJ-1042)',
  },
  {
    name: 'Affected Cloud Region',
    key: 'affected_region',
    type: 'SELECT',
    required: false,
    defaultValue: 'us-east-1',
    options: 'us-east-1, us-west-2, eu-central-1, eu-west-1, ap-southeast-1',
    showInList: false,
    description: 'Geographic region or cluster experiencing the fault',
  },
];

function displayError(error: unknown, fallback: string): string {
  const friendly = toUserFacingError(error, fallback);
  return friendly.description || friendly.title;
}

export default function CustomFieldsConfig({
  customFields: initialFields,
}: CustomFieldsConfigProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Dialog & Action States
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [viewFilter, setViewFilter] = useState<'ALL' | 'REQUIRED' | 'TABLE'>('ALL');

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    key: '',
    type: 'TEXT' as CustomField['type'],
    required: false,
    defaultValue: '',
    options: '',
    showInList: false,
  });

  const openCreateDialog = (template?: (typeof QUICK_TEMPLATES)[number]) => {
    setError(null);
    setEditingField(null);
    if (template) {
      setFormData({
        name: template.name,
        key: template.key,
        type: template.type,
        required: template.required,
        defaultValue: template.defaultValue,
        options: template.options,
        showInList: template.showInList,
      });
    } else {
      setFormData({
        name: '',
        key: '',
        type: 'TEXT',
        required: false,
        defaultValue: '',
        options: '',
        showInList: false,
      });
    }
    setDialogOpen(true);
  };

  const openEditDialog = (field: CustomField) => {
    setError(null);
    setEditingField(field);
    setFormData({
      name: field.name,
      key: field.key,
      type: field.type,
      required: field.required,
      defaultValue: field.defaultValue || '',
      options: Array.isArray(field.options) ? field.options.join(', ') : '',
      showInList: field.showInList,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate key format (alphanumeric and underscores only)
    if (!editingField && !/^[a-zA-Z0-9_]+$/.test(formData.key)) {
      setError('Key must contain only letters, numbers, and underscores');
      return;
    }

    startTransition(async () => {
      try {
        const options =
          formData.type === 'SELECT' && formData.options
            ? formData.options
                .split(',')
                .map(o => o.trim())
                .filter(Boolean)
            : null;

        if (editingField) {
          // Edit existing custom field (PATCH)
          const response = await fetch(`/api/settings/custom-fields/${editingField.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: formData.name,
              required: formData.required,
              defaultValue: formData.defaultValue || null,
              options,
              showInList: formData.showInList,
            }),
          });

          if (!response.ok) {
            throw await errorFromResponse(response, 'Failed to update custom field');
          }
        } else {
          // Create new custom field (POST)
          const response = await fetch('/api/settings/custom-fields', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...formData,
              options,
            }),
          });

          if (!response.ok) {
            throw await errorFromResponse(response, 'Failed to create custom field');
          }
        }

        router.refresh();
        setDialogOpen(false);
      } catch (err: unknown) {
        setError(displayError(err, 'Failed to save custom field'));
      }
    });
  };

  const handleDelete = async (id: string) => {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/settings/custom-fields/${id}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          throw await errorFromResponse(response, 'Failed to delete custom field');
        }

        setDeleteId(null);
        router.refresh();
      } catch (err: unknown) {
        setError(displayError(err, 'Failed to delete custom field'));
        setDeleteId(null);
      }
    });
  };

  // Filtered list of fields
  const filteredFields = useMemo(() => {
    return initialFields.filter(field => {
      const matchesSearch =
        searchQuery === '' ||
        field.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        field.key.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesType = typeFilter === 'ALL' || field.type === typeFilter;

      const matchesView =
        viewFilter === 'ALL' ||
        (viewFilter === 'REQUIRED' && field.required) ||
        (viewFilter === 'TABLE' && field.showInList);

      return matchesSearch && matchesType && matchesView;
    });
  }, [initialFields, searchQuery, typeFilter, viewFilter]);

  const parsedOptions = formData.options
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  const activeTemplateKeys = new Set(initialFields.map(f => f.key));

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Action and Search Filter Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 bg-card border border-border/80 p-3.5 rounded-2xl shadow-xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
          {/* Search Bar */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by label or key..."
              className="pl-9 h-9 text-xs bg-background"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Type Filter */}
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 text-xs w-[140px] bg-background">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Types</SelectItem>
              {Object.entries(typeConfigs).map(([typeKey, cfg]) => (
                <SelectItem key={typeKey} value={typeKey} className="text-xs">
                  {cfg.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* View Filter */}
          <Select value={viewFilter} onValueChange={v => setViewFilter(v as typeof viewFilter)}>
            <SelectTrigger className="h-9 text-xs w-[140px] bg-background">
              <SelectValue placeholder="All Scopes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Scopes</SelectItem>
              <SelectItem value="REQUIRED">Required Only</SelectItem>
              <SelectItem value="TABLE">In Incident Table</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button onClick={() => openCreateDialog()} size="sm" className="gap-1.5 shrink-0 h-9">
          <Plus className="h-4 w-4" />
          Add Custom Field
        </Button>
      </div>

      {/* Quick Starter Templates Banner (When few or no fields exist) */}
      {initialFields.length <= 4 && (
        <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-background to-primary/5 shadow-xs">
          <CardHeader className="pb-3 pt-4 px-4 sm:px-5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-semibold">Recommended Field Templates</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Quickly bootstrap common enterprise metadata standards with 1-click presets.
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-4 px-4 sm:px-5">
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {QUICK_TEMPLATES.map(tpl => {
                const isAlreadyAdded = activeTemplateKeys.has(tpl.key);
                return (
                  <button
                    key={tpl.key}
                    disabled={isAlreadyAdded || isPending}
                    onClick={() => openCreateDialog(tpl)}
                    className={cn(
                      'flex flex-col text-left p-3 rounded-xl border transition-all text-xs group',
                      isAlreadyAdded
                        ? 'border-border/60 bg-muted/40 opacity-60 cursor-not-allowed'
                        : 'border-border bg-card hover:border-primary/40 hover:bg-accent/40 hover:shadow-xs cursor-pointer'
                    )}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="font-semibold text-foreground truncate">{tpl.name}</span>
                      {isAlreadyAdded ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <Plus className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                      {tpl.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Custom Fields List */}
      {filteredFields.length === 0 ? (
        <EmptyState
          icon={SlidersHorizontal}
          title={
            searchQuery || typeFilter !== 'ALL' || viewFilter !== 'ALL'
              ? 'No matching custom fields'
              : 'No custom fields configured'
          }
          description={
            searchQuery || typeFilter !== 'ALL' || viewFilter !== 'ALL'
              ? 'Try adjusting your search terms or filters to find what you are looking for.'
              : 'Custom fields help capture incident root causes, customer impact tiers, Jira keys, or geographic regions.'
          }
          action={
            searchQuery || typeFilter !== 'ALL' || viewFilter !== 'ALL' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setTypeFilter('ALL');
                  setViewFilter('ALL');
                }}
              >
                Reset Filters
              </Button>
            ) : (
              <Button onClick={() => openCreateDialog()} size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                Create Custom Field
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-3.5">
          {filteredFields.map(field => {
            const typeConfig = typeConfigs[field.type] || typeConfigs.TEXT;
            const TypeIcon = typeConfig.icon;

            return (
              <Card
                key={field.id}
                className="border-border/80 bg-card hover:border-primary/30 hover:shadow-xs transition-all duration-150 overflow-hidden"
              >
                <CardContent className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-foreground">{field.name}</span>
                      <code className="text-xs bg-muted text-foreground/80 px-2 py-0.5 rounded-md font-mono border border-border/50">
                        {field.key}
                      </code>

                      {/* Type Badge */}
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-xs flex items-center gap-1 font-semibold py-0.5 px-2 rounded-md border',
                          typeConfig.color
                        )}
                      >
                        <TypeIcon className="h-3 w-3" />
                        <span>{typeConfig.label}</span>
                      </Badge>

                      {/* Required Badge */}
                      {field.required && (
                        <Badge
                          variant="outline"
                          className="text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
                        >
                          Required
                        </Badge>
                      )}

                      {/* In Table Badge */}
                      {field.showInList && (
                        <Badge
                          variant="outline"
                          className="text-[10px] font-bold uppercase tracking-wider bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20 flex items-center gap-1"
                        >
                          <Columns className="h-2.5 w-2.5" />
                          Table Column
                        </Badge>
                      )}
                    </div>

                    {/* Metadata & Usage Metrics */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Database className="h-3 w-3 text-muted-foreground" />
                        Usage: <strong className="text-foreground">
                          {field._count.values}
                        </strong>{' '}
                        incident(s)
                      </span>

                      {field.defaultValue && (
                        <span>
                          Default:{' '}
                          <code className="text-foreground font-mono bg-muted/60 px-1 py-0.5 rounded text-[11px]">
                            {field.defaultValue}
                          </code>
                        </span>
                      )}

                      {field.type === 'SELECT' && Array.isArray(field.options) && (
                        <span className="truncate max-w-[320px]">
                          Options ({field.options.length}):{' '}
                          <span className="text-foreground font-medium">
                            {field.options.slice(0, 3).join(', ')}
                            {field.options.length > 3 && ` +${field.options.length - 3} more`}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditDialog(field)}
                      disabled={isPending}
                      className="h-8 gap-1.5 text-xs"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteId(field.id)}
                      disabled={isPending}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 px-2.5"
                      title="Delete custom field"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Delete</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add / Edit Custom Field Modal Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                <SlidersHorizontal className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold">
                  {editingField
                    ? `Edit Field: ${editingField.name}`
                    : 'Create Custom Incident Field'}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {editingField
                    ? 'Update metadata field properties and display rules.'
                    : 'Add structured incident attributes to enforce consistency during incident triage.'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5 pt-2">
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Field Label */}
              <div className="space-y-1.5">
                <Label htmlFor="modal-field-name" className="text-xs font-semibold">
                  Field Label *
                </Label>
                <Input
                  id="modal-field-name"
                  value={formData.name}
                  onChange={e => {
                    const name = e.target.value;
                    setFormData(prev => ({
                      ...prev,
                      name,
                      key:
                        !editingField &&
                        (prev.key === '' ||
                          prev.key === prev.name.toLowerCase().replace(/[^a-z0-9]/g, '_'))
                          ? name.toLowerCase().replace(/[^a-z0-9]/g, '_')
                          : prev.key,
                    }));
                  }}
                  required
                  placeholder="e.g. Customer Impact Tier"
                  className="h-9 text-xs"
                />
              </div>

              {/* Field Key */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="modal-field-key" className="text-xs font-semibold">
                    Field Key (Identifier) *
                  </Label>
                  {editingField && (
                    <span className="text-[10px] text-muted-foreground uppercase font-mono">
                      Locked
                    </span>
                  )}
                </div>
                <Input
                  id="modal-field-key"
                  value={formData.key}
                  disabled={Boolean(editingField)}
                  onChange={e =>
                    setFormData({
                      ...formData,
                      key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                    })
                  }
                  required
                  placeholder="e.g. customer_tier"
                  className="h-9 font-mono text-xs bg-background disabled:opacity-60"
                />
                {!editingField && (
                  <p className="text-[10px] text-muted-foreground">
                    Alphanumeric and underscores only (used in API and webhooks)
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Field Type */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="modal-field-type" className="text-xs font-semibold">
                    Field Type
                  </Label>
                  {editingField && (
                    <span className="text-[10px] text-muted-foreground uppercase font-mono">
                      Locked
                    </span>
                  )}
                </div>
                <Select
                  value={formData.type}
                  disabled={Boolean(editingField)}
                  onValueChange={value =>
                    setFormData({ ...formData, type: value as CustomField['type'] })
                  }
                >
                  <SelectTrigger id="modal-field-type" className="h-9 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(typeConfigs).map(([typeKey, cfg]) => {
                      const Icon = cfg.icon;
                      return (
                        <SelectItem key={typeKey} value={typeKey} className="text-xs">
                          <div className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{cfg.label}</span>
                            <span className="text-[10px] text-muted-foreground">({cfg.desc})</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Default Value */}
              <div className="space-y-1.5">
                <Label htmlFor="modal-default-value" className="text-xs font-semibold">
                  Default Value (Optional)
                </Label>
                <Input
                  id="modal-default-value"
                  value={formData.defaultValue}
                  onChange={e => setFormData({ ...formData, defaultValue: e.target.value })}
                  placeholder="e.g. Tier 1 - Mission Critical"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Dropdown Options Builder for SELECT type */}
            {formData.type === 'SELECT' && (
              <div className="space-y-2 rounded-xl border border-border/80 bg-muted/20 p-3.5">
                <Label htmlFor="modal-options" className="text-xs font-semibold">
                  Dropdown Options (Comma-separated) *
                </Label>
                <Input
                  id="modal-options"
                  value={formData.options}
                  onChange={e => setFormData({ ...formData, options: e.target.value })}
                  required
                  placeholder="Tier 1 - Mission Critical, Tier 2 - Standard, Tier 3 - Internal"
                  className="h-9 text-xs bg-background"
                />
                {parsedOptions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1.5">
                    <span className="text-[11px] text-muted-foreground self-center mr-1">
                      Preview:
                    </span>
                    {parsedOptions.map((opt, i) => (
                      <Badge
                        key={i}
                        variant="secondary"
                        className="text-[10px] py-0.5 px-2 bg-background border border-border"
                      >
                        {opt}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Behavior & Scope Toggles */}
            <div className="grid gap-3 sm:grid-cols-2 p-3.5 rounded-xl border border-border/80 bg-muted/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="modal-required" className="text-xs font-semibold cursor-pointer">
                    Required on Creation
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Must be populated when declaring an incident
                  </p>
                </div>
                <Switch
                  id="modal-required"
                  checked={formData.required}
                  onCheckedChange={checked => setFormData({ ...formData, required: checked })}
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label
                    htmlFor="modal-showInList"
                    className="text-xs font-semibold cursor-pointer"
                  >
                    Show as Table Column
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Render as a visible column in the incidents view
                  </p>
                </div>
                <Switch
                  id="modal-showInList"
                  checked={formData.showInList}
                  onCheckedChange={checked => setFormData({ ...formData, showInList: checked })}
                />
              </div>
            </div>

            {/* Live Interactive Incident Form Simulator */}
            <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-semibold text-primary">
                <div className="flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5" />
                  <span>Interactive Responder Simulator</span>
                </div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">
                  Live Preview
                </span>
              </div>

              <div className="bg-background p-3.5 rounded-lg border border-border/80 space-y-1.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-foreground">
                    {formData.name || 'Untitled Field'}
                    {formData.required && <span className="text-rose-500 ml-1">*</span>}
                  </Label>
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                    {formData.type}
                  </Badge>
                </div>

                {formData.type === 'SELECT' ? (
                  <select
                    disabled
                    className="h-8 w-full rounded-md border border-input bg-muted/30 px-2.5 text-xs text-foreground cursor-not-allowed"
                  >
                    <option>{formData.defaultValue || 'Select an option...'}</option>
                    {parsedOptions.map((opt, i) => (
                      <option key={i}>{opt}</option>
                    ))}
                  </select>
                ) : formData.type === 'BOOLEAN' ? (
                  <div className="flex items-center gap-2 pt-1">
                    <Switch disabled checked={formData.defaultValue === 'true'} />
                    <span className="text-xs text-muted-foreground">Enabled / Disabled</span>
                  </div>
                ) : (
                  <Input
                    disabled
                    placeholder={formData.defaultValue || `Enter ${formData.name || 'value'}...`}
                    className="h-8 text-xs bg-muted/30 cursor-not-allowed"
                  />
                )}
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDialogOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending} className="gap-1.5">
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : editingField ? (
                  'Update Custom Field'
                ) : (
                  'Create Custom Field'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      {deleteId && (
        <ConfirmDialog
          open={true}
          title="Delete Custom Field?"
          message="Are you sure you want to delete this custom field? All historical values stored across existing incidents will be permanently removed."
          confirmLabel="Delete Field"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={() => handleDelete(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}
