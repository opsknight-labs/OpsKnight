import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/rbac';
import { jsonError } from '@/lib/api-response';
import { getBaseUrl } from '@/lib/env-validation';
import { getMicrosoftTeamsConfig } from '@/lib/microsoft-teams/auth';
import { buildMicrosoftTeamsAppManifestJson } from '@/lib/microsoft-teams/app-manifest';
import { buildStoredZip } from '@/lib/zip-store';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await assertAdmin();
  } catch {
    return jsonError('Admin access required.', 403);
  }
  try {
    const resolved = await getMicrosoftTeamsConfig();
    if (!resolved) return jsonError('Microsoft Teams is not configured.', 409);
    const manifest = buildMicrosoftTeamsAppManifestJson({
      appUrl: getBaseUrl(),
      botId: resolved.config.clientId,
      applicationIdUri: process.env.MICROSOFT_TEAMS_APPLICATION_ID_URI?.trim() || undefined,
      includeWarRoomPermissions: resolved.config.warRoomsEnabled,
      includeWarRoomCollaborationPermissions: resolved.config.warRoomsEnabled,
    });
    const assetRoot = path.join(process.cwd(), 'public', 'microsoft-teams');
    const [color, outline] = await Promise.all([
      readFile(path.join(assetRoot, 'color.png')),
      readFile(path.join(assetRoot, 'outline.png')),
    ]);
    const zip = buildStoredZip([
      { name: 'manifest.json', data: new TextEncoder().encode(manifest) },
      { name: 'color.png', data: color },
      { name: 'outline.png', data: outline },
    ]);
    return new NextResponse(Buffer.from(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="opsknight-teams.zip"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return jsonError('Failed to build the Teams app package.', 500);
  }
}
