import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const MIME_MAP = new Map<string, string>([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['svg', 'image/svg+xml'],
  ['bmp', 'image/bmp'],
  ['ico', 'image/x-icon'],
  ['pdf', 'application/pdf'],
  ['txt', 'text/plain; charset=utf-8'],
  ['log', 'text/plain; charset=utf-8'],
  ['json', 'application/json; charset=utf-8'],
  ['csv', 'text/csv; charset=utf-8'],
  ['zip', 'application/zip'],
]);

export async function GET(_req: NextRequest, props: { params: Promise<{ filename: string }> }) {
  const { filename } = await props.params;

  // Strict validation: filename can only contain alphanumeric, dots, hyphens, and underscores
  if (!filename || !/^[a-zA-Z0-9._-]+$/.test(filename) || filename.includes('..')) {
    return NextResponse.json({ error: 'Invalid file name' }, { status: 400 });
  }

  const filePath = join(process.cwd(), 'public', 'uploads', filename);

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- filename is strictly regex-validated above against path traversal
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- filename is strictly regex-validated above against path traversal
    const fileBuffer = await readFile(filePath);
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const contentType = MIME_MAP.get(ext) || 'application/octet-stream';

    const isImage = contentType.startsWith('image/');

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileStat.size.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': isImage
          ? 'inline'
          : `inline; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
