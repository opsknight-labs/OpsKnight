import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/rbac';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { logger } from '@/lib/logger';

// 15 MB max file upload size
const MAX_FILE_SIZE = 15 * 1024 * 1024;

// Block dangerous executable extensions
const BLOCKED_EXTENSIONS = new Set([
  'exe',
  'bat',
  'cmd',
  'sh',
  'bash',
  'ps1',
  'vbs',
  'jar',
  'msi',
  'dll',
  'com',
  'scr',
  'hta',
  'cpl',
  'msc',
]);

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided in form data' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File size exceeds 15MB limit' }, { status: 413 });
    }

    const rawName = file.name || 'attachment';
    const sanitizedBase = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const extMatch = sanitizedBase.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';

    if (BLOCKED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: `Executable or script files (.${ext}) are not permitted.` },
        { status: 400 }
      );
    }

    const uniqueId = randomBytes(8).toString('hex');
    const timestamp = Date.now();
    const storedFilename = `${timestamp}-${uniqueId}${ext ? `.${ext}` : ''}`;

    const uploadDir = join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadDir, { recursive: true });

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- storedFilename is constructed from internal random bytes and timestamp
    await writeFile(join(uploadDir, storedFilename), buffer);

    const isImage =
      file.type.startsWith('image/') ||
      ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);

    return NextResponse.json({
      success: true,
      url: `/api/uploads/${storedFilename}`,
      directUrl: `/uploads/${storedFilename}`,
      filename: file.name,
      storedFilename,
      size: file.size,
      isImage,
      contentType: file.type || 'application/octet-stream',
    });
  } catch (error) {
    logger.error('[Upload] Failed to process uploaded file', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to upload file. Please try again.' },
      { status: 500 }
    );
  }
}
