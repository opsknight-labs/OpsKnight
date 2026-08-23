'use client';

import { useState } from 'react';
import { Link2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/shadcn/button';
import { allowOidcLinking } from '@/app/(app)/users/oidc-actions';

export default function OidcLinkingApprovalButton({
  userId,
  userName,
}: {
  userId: string;
  userName: string;
}) {
  const [pending, setPending] = useState(false);

  const approve = async () => {
    setPending(true);
    try {
      const result = await allowOidcLinking(userId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.alreadyLinked) {
        toast.info(`${userName} already has an OIDC identity linked.`);
        return;
      }
      toast.success(`OIDC linking allowed for ${userName}'s next verified sign-in.`);
    } catch {
      toast.error('Failed to allow OIDC linking.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 text-xs"
      onClick={approve}
      disabled={pending}
      title="Allow this existing user to link a verified identity from the configured OIDC provider on their next sign-in"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
      Allow OIDC linking
    </Button>
  );
}
