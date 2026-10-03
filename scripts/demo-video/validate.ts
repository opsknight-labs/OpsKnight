import * as fs from 'fs';
import * as path from 'path';

export function validateArtifacts(): boolean {
  const distDir = path.resolve(process.cwd(), 'dist');
  const requiredFiles = [
    { file: 'opsknight-product-tour.mp4', minSizeKb: 500, label: 'Master Product Tour MP4' },
    { file: 'opsknight-product-tour-1080p.mp4', minSizeKb: 500, label: 'Streamable 1080p MP4' },
    { file: 'opsknight-readme-preview.webp', minSizeKb: 100, label: 'README Preview WebP (35-45s)' },
    { file: 'opsknight-readme-poster.webp', minSizeKb: 5, label: 'README Poster Frame' },
  ];

  console.log('[validate] Validating demo video distribution artifacts in dist/...');
  let allValid = true;

  for (const item of requiredFiles) {
    const fullPath = path.join(distDir, item.file);
    if (!fs.existsSync(fullPath)) {
      console.error(`[validate] ❌ Missing file: ${item.file} (${item.label})`);
      allValid = false;
      continue;
    }

    const stat = fs.statSync(fullPath);
    const sizeKb = stat.size / 1024;
    if (sizeKb < item.minSizeKb) {
      console.error(
        `[validate] ❌ File too small: ${item.file} is ${sizeKb.toFixed(1)} KB (expected >= ${item.minSizeKb} KB)`
      );
      allValid = false;
      continue;
    }

    console.log(
      `[validate] ✅ ${item.label}: ${item.file} (${(sizeKb > 1024 ? (sizeKb / 1024).toFixed(2) + ' MB' : sizeKb.toFixed(1) + ' KB')})`
    );
  }

  // Validate chapters manifest
  const chaptersPath = path.resolve(process.cwd(), 'test-results/demo-video/chapters.json');
  if (fs.existsSync(chaptersPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(chaptersPath, 'utf8'));
      console.log(
        `[validate] ✅ Chapters manifest verified: ${manifest.chapters?.length || 0} chapters, total duration: ${manifest.totalDuration?.toFixed(1) || 0}s`
      );
    } catch {
      console.warn('[validate] ⚠️ chapters.json exists but could not be parsed.');
    }
  }

  if (!allValid) {
    throw new Error('Demo video validation failed. Some required artifacts are missing or invalid.');
  }

  console.log('[validate] All demo video artifacts are certified and ready for release!');
  return true;
}

if (require.main === module) {
  try {
    validateArtifacts();
    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
}
