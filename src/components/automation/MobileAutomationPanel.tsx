'use client';
import { useState } from 'react';
import AutomationShell from './AutomationShell';
import { Button } from '@/components/ui/shadcn/button';
export default function MobileAutomationPanel({
  serviceId,
  initialOpen,
}: {
  serviceId: string;
  initialOpen: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <div className="rounded-xl border bg-card p-3 space-y-3">
      <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
        Automation
      </Button>
      {open && <AutomationShell serviceId={serviceId} />}
    </div>
  );
}
