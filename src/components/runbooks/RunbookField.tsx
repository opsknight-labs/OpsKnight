'use client';

import { Children, cloneElement, isValidElement, useId } from 'react';
import { Label } from '@/components/ui/shadcn/label';
import { Input } from '@/components/ui/shadcn/input';
import { Textarea } from '@/components/ui/shadcn/textarea';

export default function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {Children.map(children, child =>
        isValidElement<{ id?: string }>(child) && (child.type === Input || child.type === Textarea)
          ? cloneElement(child, { id })
          : child
      )}
    </div>
  );
}
