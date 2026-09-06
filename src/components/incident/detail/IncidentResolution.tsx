'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/shadcn/button';
import { Textarea } from '@/components/ui/shadcn/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { CheckCircle2, Lock, Loader2, Target } from 'lucide-react';

type IncidentResolutionProps = {
  incidentId: string;
  canManage: boolean;
  onResolve: (formData: FormData) => void;
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending}
      className="w-full h-10 bg-green-600 hover:bg-green-700 text-white"
    >
      {pending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Resolving...
        </>
      ) : (
        <>
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Resolve Incident
        </>
      )}
    </Button>
  );
}

export default function IncidentResolution({
  incidentId: _incidentId,
  canManage,
  onResolve,
}: IncidentResolutionProps) {
  if (!canManage) {
    return (
      <Card className="border-orange-200 bg-orange-50/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-900">
            <Lock className="h-5 w-5" />
            Resolution - Access Restricted
          </CardTitle>
          <CardDescription className="text-orange-700">
            You need Responder role or above to resolve incidents
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-green-200 bg-green-50/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-green-900">
          <Target className="h-5 w-5" />
          Resolve Incident
        </CardTitle>
        <CardDescription className="text-green-700">
          Mark this incident as resolved with a summary note
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={onResolve} className="space-y-4">
          <div className="space-y-2">
            <Textarea
              name="resolution"
              required
              minLength={10}
              maxLength={1000}
              rows={4}
              placeholder="Root cause, fix applied, or summary..."
              className="resize-none bg-white"
            />
            <p className="text-xs text-muted-foreground">
              10-1000 characters. Supports Markdown formatting.
            </p>
          </div>
          <SubmitButton />
        </form>
      </CardContent>
    </Card>
  );
}
