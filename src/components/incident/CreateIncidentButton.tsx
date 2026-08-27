'use client';

import React from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { DropdownMenuItem } from '@/components/ui/shadcn/dropdown-menu';
import { useCreateIncidentModal } from '@/contexts/IncidentCreationModalContext';
import { Plus } from 'lucide-react';

type CreateIncidentButtonProps = {
  serviceId?: string;
  templateId?: string;
  children?: React.ReactNode;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary' | 'destructive' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
};

export default function CreateIncidentButton({
  serviceId,
  templateId,
  children,
  variant = 'default',
  size = 'default',
  className,
}: CreateIncidentButtonProps) {
  const { openCreateIncident } = useCreateIncidentModal();

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={() => openCreateIncident({ serviceId, templateId })}
    >
      {children || (
        <>
          <Plus className="h-4 w-4 mr-2" />
          Create Incident
        </>
      )}
    </Button>
  );
}

export function CreateIncidentMenuItem({
  serviceId,
  templateId,
  children,
  className,
}: {
  serviceId?: string;
  templateId?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const { openCreateIncident } = useCreateIncidentModal();

  return (
    <DropdownMenuItem
      className={className}
      onClick={() => openCreateIncident({ serviceId, templateId })}
    >
      {children || (
        <>
          <Plus className="h-4 w-4 mr-2" />
          Create Incident
        </>
      )}
    </DropdownMenuItem>
  );
}
