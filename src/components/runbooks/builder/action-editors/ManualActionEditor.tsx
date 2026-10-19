'use client';

import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';

interface ManualActionEditorProps {
  config: Record<string, unknown>;
  errors?: Record<string, string>;
  editorId?: string;
  readOnly?: boolean;
  onChange: (config: Record<string, unknown>) => void;
}

export default function ManualActionEditor({
  config,
  editorId = 'manual',
  readOnly = false,
  onChange,
}: ManualActionEditorProps) {
  const instructions = String(config.instructions ?? '');

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`manual-instructions-${editorId}`} className="text-xs">
          Instructions
        </Label>
        <span className="text-xs text-muted-foreground">Shown to the on-call responder</span>
      </div>
      <Textarea
        id={`manual-instructions-${editorId}`}
        aria-label="Manual instructions"
        placeholder="What should the responder check or do before marking this step complete?"
        value={instructions}
        disabled={readOnly}
        onChange={e => onChange({ ...config, instructions: e.target.value })}
        className="min-h-24 text-sm"
      />
      <p className="text-xs text-muted-foreground">
        The run pauses here until a responder with approval permission marks it complete.
      </p>
    </div>
  );
}
