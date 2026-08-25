'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createApiKey, revokeApiKey } from '@/app/(app)/settings/actions';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/shadcn/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/shadcn/table';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import { EmptyState } from './feedback/EmptyState';
import CopyButton from './CopyButton';
import ConfirmDialog from './ConfirmDialog';
import { Key, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  expiresAt?: string | null;
  expired?: boolean;
  ownerEmail?: string;
};

type State = {
  error?: string | null;
  success?: boolean;
  token?: string | null;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {pending ? 'Creating...' : 'Create API Key'}
    </Button>
  );
}

export default function ApiKeysPanel({
  keys,
  canCreateWriteKeys,
}: {
  keys: ApiKey[];
  canCreateWriteKeys: boolean;
}) {
  const [state, formAction] = useActionState<State, FormData>(createApiKey, {
    error: null,
    success: false,
    token: null,
  });
  const [revokeKeyId, setRevokeKeyId] = useState<string | null>(null);

  const handleRevoke = async (keyId: string) => {
    const formData = new FormData();
    formData.append('keyId', keyId);
    await revokeApiKey(formData);
    setRevokeKeyId(null);
    window.location.reload();
  };

  const scopes = [
    {
      value: 'events:write',
      title: 'Events Write',
      detail: 'Create and update events',
      defaultChecked: true,
    },
    { value: 'incidents:read', title: 'Incidents Read', detail: 'View incident data' },
    { value: 'incidents:write', title: 'Incidents Write', detail: 'Create and update incidents' },
    { value: 'services:read', title: 'Services Read', detail: 'View service information' },
    { value: 'schedules:read', title: 'Schedules Read', detail: 'View on-call schedules' },
  ];
  const visibleScopes = canCreateWriteKeys
    ? scopes
    : scopes.filter(scope => !scope.value.endsWith(':write'));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create New API Key</CardTitle>
          <CardDescription>
            Generate a new API key for programmatic access to OpsKnight
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="key-name">Key Name</Label>
              <Input id="key-name" name="name" placeholder="e.g., Production Automation" required />
              <p className="text-sm text-muted-foreground">Give your API key a descriptive name</p>
            </div>

            <div className="space-y-3">
              <Label>Permissions</Label>
              <p className="text-sm text-muted-foreground">Choose the scopes this key can access</p>
              <div className="grid gap-3 md:grid-cols-2">
                {visibleScopes.map(scope => (
                  <div
                    key={scope.value}
                    className="flex items-start space-x-3 rounded-lg border p-4 hover:bg-accent"
                  >
                    <Checkbox
                      name="scopes"
                      value={scope.value}
                      defaultChecked={scope.defaultChecked}
                      id={scope.value}
                    />
                    <div className="flex-1 space-y-1">
                      <label
                        htmlFor={scope.value}
                        className="text-sm font-medium leading-none cursor-pointer"
                      >
                        {scope.title}
                      </label>
                      <p className="text-sm text-muted-foreground">{scope.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="expiration-days">Expiration</Label>
              <select
                id="expiration-days"
                name="expirationDays"
                defaultValue="90"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
                <option value="365">1 year</option>
              </select>
              <p className="text-sm text-muted-foreground">
                Keys stop authenticating automatically after this date.
              </p>
            </div>

            {state?.error && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}

            {state?.token && (
              <>
                <Alert className="bg-green-50 border-green-200">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-700">
                    API key created successfully! Copy it now - it will not be shown again.
                  </AlertDescription>
                </Alert>
                <div className="flex items-center gap-2 rounded-lg border bg-muted p-4">
                  <code className="flex-1 text-sm font-mono">{state.token}</code>
                  <CopyButton text={state.token} />
                </div>
              </>
            )}

            <div className="flex justify-end pt-4 border-t">
              <SubmitButton />
            </div>
          </form>
        </CardContent>
      </Card>

      {keys.length === 0 ? (
        <EmptyState
          icon={Key}
          title="No API keys yet"
          description="Create your first API key to automate workflows and integrate with external systems."
        />
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Active API Keys</CardTitle>
                <CardDescription>
                  {keys.length} {keys.length === 1 ? 'key' : 'keys'} configured
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map(key => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {key.ownerEmail || 'You'}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                        {key.prefix}********
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.length > 0 ? (
                          key.scopes.map(scope => (
                            <Badge key={scope} variant="secondary" size="xs">
                              {scope}
                            </Badge>
                          ))
                        ) : (
                          <Badge variant="outline" size="xs">
                            No scopes
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{key.createdAt}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {key.expiresAt || 'Legacy key'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={key.revokedAt || key.expired ? 'destructive' : 'default'}
                        className="text-xs"
                      >
                        {key.revokedAt ? 'Revoked' : key.expired ? 'Expired' : 'Active'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {!key.revokedAt && !key.expired && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRevokeKeyId(key.id)}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={revokeKeyId !== null}
        title="Revoke API Key"
        message="Are you sure you want to revoke this API key? This action cannot be undone and any applications using this key will stop working immediately."
        confirmLabel="Revoke Key"
        cancelLabel="Cancel"
        onConfirm={() => revokeKeyId && handleRevoke(revokeKeyId)}
        onCancel={() => setRevokeKeyId(null)}
        variant="danger"
      />
    </div>
  );
}
