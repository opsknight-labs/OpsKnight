'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorFromResponse } from '@/lib/client-error';
import { toUserFacingError } from '@/lib/user-facing-error';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { Switch } from '@/components/ui/shadcn/switch';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/shadcn/card';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import { EmptyState } from '@/components/settings/feedback/EmptyState';
import ConfirmDialog from '@/components/settings/ConfirmDialog';
import { FileText, Plus, Trash2, AlertTriangle, Loader2 } from 'lucide-react';

type CustomField = {
    id: string;
    name: string;
    key: string;
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN' | 'URL' | 'EMAIL';
    required: boolean;
    defaultValue?: string | null;
    options?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    order: number;
    showInList: boolean;
    _count: {
        values: number;
    };
};

type CustomFieldsConfigProps = {
    customFields: CustomField[];
};

function displayError(error: unknown, fallback: string): string {
    const friendly = toUserFacingError(error, fallback);
    return friendly.description || friendly.title;
}

export default function CustomFieldsConfig({ customFields: initialFields }: CustomFieldsConfigProps) {
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
                const options = formData.type === 'SELECT' && formData.options
                    ? formData.options.split(',').map(o => o.trim()).filter(Boolean)
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
        { value: 'TEXT', label: 'Text' },
        { value: 'NUMBER', label: 'Number' },
        { value: 'DATE', label: 'Date' },
        { value: 'SELECT', label: 'Select (Dropdown)' },
        { value: 'BOOLEAN', label: 'Boolean (Yes/No)' },
        { value: 'URL', label: 'URL' },
        { value: 'EMAIL', label: 'Email' },
    ];

    return (
        <div className="space-y-6">
            {error && (
                <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Add New Field Card */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Add Custom Field</CardTitle>
                            <CardDescription>
                                Create custom fields to capture additional incident information
                            </CardDescription>
                        </div>
                        <Button onClick={() => setShowAddForm(!showAddForm)}>
                            {showAddForm ? 'Cancel' : (
                                <>
                                    <Plus className="mr-2 h-4 w-4" />
                                    Add Field
                                </>
                            )}
                        </Button>
                    </div>
                </CardHeader>

                {showAddForm && (
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="field-name">Field Name</Label>
                                    <Input
                                        id="field-name"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        required
                                        placeholder="e.g., Customer ID"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="field-key">Field Key</Label>
                                    <Input
                                        id="field-key"
                                        value={formData.key}
                                        onChange={(e) => setFormData({ ...formData, key: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                                        required
                                        placeholder="e.g., customer_id"
                                    />
                                    <p className="text-sm text-muted-foreground">
                                        Unique identifier (letters, numbers, underscores only)
                                    </p>
                                </div>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="field-type">Field Type</Label>
                                    <Select
                                        value={formData.type}
                                        onValueChange={(value) => setFormData({ ...formData, type: value as CustomField['type'] })}
                                    >
                                        <SelectTrigger id="field-type">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {fieldTypeOptions.map((option) => (
                                                <SelectItem key={option.value} value={option.value}>
                                                    {option.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="default-value">Default Value (Optional)</Label>
                                    <Input
                                        id="default-value"
                                        value={formData.defaultValue}
                                        onChange={(e) => setFormData({ ...formData, defaultValue: e.target.value })}
                                        placeholder="Default value for new incidents"
                                    />
                                </div>
                            </div>

                            {formData.type === 'SELECT' && (
                                <div className="space-y-2">
                                    <Label htmlFor="options">Options (comma-separated)</Label>
                                    <Input
                                        id="options"
                                        value={formData.options}
                                        onChange={(e) => setFormData({ ...formData, options: e.target.value })}
                                        required
                                        placeholder="Option 1, Option 2, Option 3"
                                    />
                                    <p className="text-sm text-muted-foreground">
                                        Enter options separated by commas
                                    </p>
                                </div>
                            )}

                            <div className="flex items-center gap-6">
                                <div className="flex items-center space-x-2">
                                    <Switch
                                        id="required"
                                        checked={formData.required}
                                        onCheckedChange={(checked) => setFormData({ ...formData, required: checked })}
                                    />
                                    <Label htmlFor="required" className="font-normal">
                                        Required field
                                    </Label>
                                </div>

                                <div className="flex items-center space-x-2">
                                    <Switch
                                        id="show-in-list"
                                        checked={formData.showInList}
                                        onCheckedChange={(checked) => setFormData({ ...formData, showInList: checked })}
                                    />
                                    <Label htmlFor="show-in-list" className="font-normal">
                                        Show in incident list
                                    </Label>
                                </div>
                            </div>

                            <div className="flex justify-end pt-4 border-t">
                                <Button type="submit" disabled={isPending}>
                                    {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Create Field
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                )}
            </Card>

            {/* Existing Fields */}
            {initialFields.length === 0 ? (
                <EmptyState
                    icon={FileText}
                    title="No custom fields yet"
                    description="Create custom fields to capture additional structured data for incidents."
                />
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle>Existing Custom Fields</CardTitle>
                        <CardDescription>
                            {initialFields.length} custom {initialFields.length === 1 ? 'field' : 'fields'} configured
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {initialFields.map((field) => (
                                <div
                                    key={field.id}
                                    className="flex items-center justify-between p-4 rounded-lg border hover:bg-accent"
                                >
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h4 className="font-medium">{field.name}</h4>
                                            <Badge variant="secondary" size="xs">
                                                {field.type}
                                            </Badge>
                                            {field.required && (
                                                <Badge variant="outline" size="xs">
                                                    Required
                                                </Badge>
                                            )}
                                            {field.showInList && (
                                                <Badge variant="outline" size="xs">
                                                    In List
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                            <code className="text-xs bg-muted px-2 py-0.5 rounded">
                                                {field.key}
                                            </code>
                                            <span>•</span>
                                            <span>{field._count.values} values</span>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setDeleteId(field.id)}
                                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            <ConfirmDialog
                open={deleteId !== null}
                title="Delete Custom Field"
                message="Are you sure you want to delete this custom field? This will remove all values for this field from existing incidents. This action cannot be undone."
                confirmLabel="Delete Field"
                cancelLabel="Cancel"
                onConfirm={() => deleteId && handleDelete(deleteId)}
                onCancel={() => setDeleteId(null)}
                variant="danger"
            />
        </div>
    );
}
