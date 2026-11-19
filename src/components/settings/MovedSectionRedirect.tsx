'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  movedIntelligenceSection,
  type IntelligenceSettingsGroupId,
} from '@/lib/intelligence/settings/routes';

/** Old `#section` links on a group page (bookmarks, sent digests) follow the section to its new group. */
export default function MovedSectionRedirect({ group }: { group: IntelligenceSettingsGroupId }) {
  const router = useRouter();
  useEffect(() => {
    const target = movedIntelligenceSection(group, window.location.hash.slice(1));
    if (target) router.replace(target);
  }, [group, router]);
  return null;
}
