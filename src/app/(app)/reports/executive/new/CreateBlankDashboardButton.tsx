'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Loader2 } from 'lucide-react';

export default function CreateBlankDashboardButton() {
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (isCreating) return;
    setIsCreating(true);

    try {
      const response = await fetch('/api/dashboards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Untitled Dashboard',
          description: '',
          widgets: [],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create dashboard');
      }

      const data = await response.json();
      window.location.href = `/reports/executive/${data.dashboard.id}`;
    } catch (error) {
      console.error('Failed to create dashboard:', error);
      alert('Failed to create dashboard. Please try again.');
      setIsCreating(false);
    }
  };

  return (
    <Button onClick={handleCreate} className="w-full" disabled={isCreating}>
      {isCreating ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Creating...
        </>
      ) : (
        'Create Blank Dashboard'
      )}
    </Button>
  );
}
