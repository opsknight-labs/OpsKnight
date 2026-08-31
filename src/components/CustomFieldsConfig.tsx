'use client';

import { useState, useTransition } from 'react';
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
  AlertTriangle,
  Loader2,
  SlidersHorizontal,
  Calendar,
  Hash,
  Link as LinkIcon,
  Mail,
  ToggleLeft,
  Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type CustomField = {
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
};

const typeBadges: Record<
  CustomField['type'],
  { label: string; icon: typeof FileText; color: string }
> = {
  TEXT: { label: 'Text', icon: FileText, color: 'bg-blue-50 text-blue-700 border-blue-200' },
  NUMBER: { label: 'Number', icon: Hash, color: 'bg-purple-50 text-purple-700 border-purple-200' },
  DATE: { label: 'Date', icon: Calendar, color: 'bg-amber-50 text-amber-700 border-amber-200' },
  SELECT: {
    label: 'Dropdown',
    icon: SlidersHorizontal,
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  BOOLEAN: { label: 'Toggle', icon: ToggleLeft, color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  URL: { label: 'URL', icon: LinkIcon, color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  EMAIL: { label: 'Email', icon: Mail, color: 'bg-rose-50 text-rose-700 border-rose-200' },
};

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
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    key: '',
    type: 'TEXT' as CustomField['type'],
    required: false,
    defaultValue: '',
    options: '',
    showInList: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate key format (alphanumeric and underscores only)
    if (!/^[a-zA-Z0-9_]+$/.test(formData.key)) {
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

        const response = await fetch('/api/settings/custom-fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...formData,
            options,
          }),
        });

        if (!response.ok) {
          throw await errorFromResponse(response, 'Failed to save custom field');
        }

        router.refresh();
        setShowAddForm(false);
        setFormData({
          name: '',
          key: '',
          type: 'TEXT',
          required: false,
          defaultValue: '',
          options: '',
          showInList: false,
        });
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

  const fieldTypeOptions = [
    { value: 'TEXT', label: 'Text (Single line)' },
    { value: 'NUMBER', label: 'Number (Numeric counter / ID)' },
    { value: 'DATE', label: 'Date (Calendar timestamp)' },
    { value: 'SELECT', label: 'Dropdown (Pick from predefined options)' },
    { value: 'BOOLEAN', label: 'Boolean (Yes / No Toggle)' },
    { value: 'URL', label: 'URL (Direct link)' },
    { value: 'EMAIL', label: 'Email Address' },
  ];

  const parsedOptions = formData.options
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Add New Field Card */}
      <Card className="border-slate-200 shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-bold">Custom Metadata Fields</CardTitle>
              <CardDescription>
                Capture incident root cause attributes, customer impact tiers, Jira keys, or
                external identifiers.
              </CardDescription>
            </div>
            <Button
              onClick={() => setShowAddForm(!showAddForm)}
              variant={showAddForm ? 'outline' : 'default'}
              size="sm"
            >
              {showAddForm ? (
                'Cancel'
              ) : (
                <>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Add Custom Field
                </>
              )}
            </Button>
          </div>
        </CardHeader>

        {showAddForm && (
          <CardContent className="pt-2 border-t border-slate-100 space-y-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="field-name" className="text-sm font-semibold">
                    Field Label *
                  </Label>
                  <Input
                    id="field-name"
                    value={formData.name}
                    onChange={e => {
                      const name = e.target.value;
                      setFormData(prev => ({
                        ...prev,
                        name,
                        key:
                          prev.key === '' ||
                          prev.key === prev.name.toLowerCase().replace(/[^a-z0-9]/g, '_')
                            ? name.toLowerCase().replace(/[^a-z0-9]/g, '_')
                            : prev.key,
                      }));
                    }}
                    required
                    placeholder="e.g., Customer Tier or Jira Ticket"
                    className="h-10"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="field-key" className="text-sm font-semibold">
                    Field Key (Identifier) *
                  </Label>
                  <Input
                    id="field-key"
                    value={formData.key}
                    onChange={e =>
                      setFormData({
                        ...formData,
                        key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                      })
                    }
                    required
                    placeholder="e.g., customer_tier"
                    className="h-10 font-mono text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Alphanumeric and underscores only (used in API and webhooks)
                  </p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="field-type" className="text-sm font-semibold">
                    Field Type
                  </Label>
                  <Select
                    value={formData.type}
                    onValueChange={value =>
                      setFormData({ ...formData, type: value as CustomField['type'] })
                    }
                  >
                    <SelectTrigger id="field-type" className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {fieldTypeOptions.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="default-value" className="text-sm font-semibold">
                    Default Value (Optional)
                  </Label>
                  <Input
                    id="default-value"
                    value={formData.defaultValue}
                    onChange={e => setFormData({ ...formData, defaultValue: e.target.value })}
                    placeholder="e.g., Enterprise or Standard"
                    className="h-10"
                  />
                </div>
              </div>

              {formData.type === 'SELECT' && (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <Label htmlFor="options" className="text-sm font-semibold">
                    Dropdown Options (Comma-separated) *
                  </Label>
                  <Input
                    id="options"
                    value={formData.options}
                    onChange={e => setFormData({ ...formData, options: e.target.value })}
                    required
                    placeholder="e.g., Tier 1 (Mission Critical), Tier 2 (Standard), Tier 3 (Internal)"
                    className="h-10 bg-white"
                  />
                  {parsedOptions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      <span className="text-xs text-muted-foreground mr-1">Preview Options:</span>
                      {parsedOptions.map((opt, i) => (
                        <Badge key={i} variant="outline" className="bg-white text-xs">
                          {opt}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Switches */}
              <div className="grid gap-4 sm:grid-cols-2 p-4 rounded-xl border border-slate-200 bg-muted/10">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label htmlFor="required" className="text-sm font-semibold">
                      Required Field
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Must be filled when creating an incident
                    </p>
                  </div>
                  <Switch
                    id="required"
                    checked={formData.required}
                    onCheckedChange={checked => setFormData({ ...formData, required: checked })}
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label htmlFor="showInList" className="text-sm font-semibold">
                      Show in Incident Table
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Display as a column in the incident list
                    </p>
                  </div>
                  <Switch
                    id="showInList"
                    checked={formData.showInList}
                    onCheckedChange={checked => setFormData({ ...formData, showInList: checked })}
                  />
                </div>
              </div>

              {/* 3. Live Form Simulator & Preview */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                  <Eye className="h-4 w-4" />
                  <span>Interactive Incident Form Simulator</span>
                </div>
                <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold text-foreground">
                      {formData.name || 'Untitled Field'}
                      {formData.required && <span className="text-rose-500 ml-1">*</span>}
                    </Label>
                    <Badge variant="outline" className="text-[10px]">
                      {formData.type}
                    </Badge>
                  </div>

                  {formData.type === 'SELECT' ? (
                    <select
                      disabled
                      className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-foreground"
                    >
                      <option>{formData.defaultValue || 'Select an option...'}</option>
                      {parsedOptions.map((opt, i) => (
                        <option key={i}>{opt}</option>
                      ))}
                    </select>
                  ) : formData.type === 'BOOLEAN' ? (
                    <div className="flex items-center gap-2 pt-1">
                      <Switch disabled checked={formData.defaultValue === 'true'} />
                      <span className="text-xs text-muted-foreground">Toggle Switch</span>
                    </div>
                  ) : (
                    <Input
                      disabled
                      placeholder={formData.defaultValue || `Enter ${formData.name || 'value'}...`}
                      className="h-10 bg-slate-50"
                    />
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddForm(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Save Custom Field'
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        )}
      </Card>

      {/* Existing Fields List */}
      {initialFields.length === 0 ? (
        <EmptyState
          icon={SlidersHorizontal}
          title="No custom fields configured"
          description="Custom fields help capture domain-specific metadata like Customer Tier, Jira Issue Key, or Affected Region."
          action={
            <Button onClick={() => setShowAddForm(true)} size="sm">
              <Plus className="mr-1.5 h-4 w-4" />
              Create First Custom Field
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3.5">
          {initialFields.map(field => {
            const badgeConfig = typeBadges[field.type] || typeBadges.TEXT;
            const Icon = badgeConfig.icon;

            return (
              <Card
                key={field.id}
                className="border-slate-200 bg-white hover:shadow-xs transition-all duration-150 overflow-hidden"
              >
                <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground">{field.name}</span>
                      <code className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono">
                        {field.key}
                      </code>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-xs flex items-center gap-1 font-medium',
                          badgeConfig.color
                        )}
                      >
                        <Icon className="h-3 w-3" />
                        <span>{badgeConfig.label}</span>
                      </Badge>
                      {field.required && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] bg-rose-50 text-rose-700 border-rose-200"
                        >
                          Required
                        </Badge>
                      )}
                      {field.showInList && (
                        <Badge variant="outline" className="text-[10px] text-slate-600">
                          In Table
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>
                        Usage: <strong className="text-foreground">{field._count.values}</strong>{' '}
                        incident(s)
                      </span>
                      {field.defaultValue && (
                        <span>
                          Default: <code className="text-foreground">{field.defaultValue}</code>
                        </span>
                      )}
                      {field.type === 'SELECT' && Array.isArray(field.options) && (
                        <span>
                          Options:{' '}
                          <span className="text-foreground">{field.options.join(', ')}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteId(field.id)}
                      disabled={isPending}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8"
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

      {/* Delete Confirmation Modal */}
      {deleteId && (
        <ConfirmDialog
          open={true}
          title="Delete Custom Field?"
          message="Are you sure you want to delete this custom field? This will also remove any values recorded for this field across all existing incidents."
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
