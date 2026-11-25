import Link from 'next/link';
import { Boxes } from 'lucide-react';
import { EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/shadcn/button';

export default function BusinessServiceNotFound() {
  return (
    <div className="p-6">
      <EmptyState
        variant="simple"
        icon={<Boxes className="h-6 w-6" aria-hidden />}
        title="Business service not found"
        description="It may have been deleted, or you may not have access to it."
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/services/business">Back to business services</Link>
          </Button>
        }
      />
    </div>
  );
}
