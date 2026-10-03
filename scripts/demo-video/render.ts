import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { loadChapters, getReadmeCutSegments } from './chapters';

function findFfmpeg(): string {
  try {
    // Try ffmpeg-static first
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch {
    // ignore
  }

  // Check PATH
  try {
    const fromPath = execSync('which ffmpeg', { encoding: 'utf8' }).trim();
    if (fromPath && fs.existsSync(fromPath)) {
      return fromPath;
    }
  } catch {
    // ignore
  }

  throw new Error('ffmpeg binary not found. Please install ffmpeg or ffmpeg-static.');
}

function findRawRecording(): string {
  const searchDirs = [
    path.resolve(process.cwd(), 'test-results/demo-video/output'),
    path.resolve(process.cwd(), 'test-results/demo-video'),
  ];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;

    const findWebm = (currentDir: string): string | null => {
      const files = fs.readdirSync(currentDir);
      for (const file of files) {
        const fullPath = path.join(currentDir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          const res = findWebm(fullPath);
          if (res) return res;
        } else if (file.endsWith('.webm') && stat.size > 100_000) {
          return fullPath;
        }
      }
      return null;
    };

    const found = findWebm(dir);
    if (found) return found;
  }

  throw new Error('Raw Playwright recording (.webm) not found in test-results/demo-video/.');
}

export async function renderDemoVideo(): Promise<void> {
  const ffmpeg = findFfmpeg();
  const rawWebm = findRawRecording();
  const distDir = path.resolve(process.cwd(), 'dist');

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  console.log(`[render] Found ffmpeg at: ${ffmpeg}`);
  console.log(`[render] Found raw recording at: ${rawWebm} (${(fs.statSync(rawWebm).size / (1024 * 1024)).toFixed(2)} MB)`);

  const masterMp4 = path.join(distDir, 'opsknight-product-tour.mp4');
  const stream1080pMp4 = path.join(distDir, 'opsknight-product-tour-1080p.mp4');
  const readmeWebp = path.join(distDir, 'opsknight-readme-preview.webp');
  const readmePoster = path.join(distDir, 'opsknight-readme-poster.webp');

  // 1. Render Master MP4 (~3-4 min master, 1080p high quality)
  console.log('[render] Encoding master product tour (opsknight-product-tour.mp4)...');
  execSync(
    `"${ffmpeg}" -y -i "${rawWebm}" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r 30 "${masterMp4}"`,
    { stdio: 'inherit' }
  );

  // 2. Render 1080p streamable MP4 with faststart
  console.log('[render] Encoding 1080p streaming MP4 (opsknight-product-tour-1080p.mp4)...');
  execSync(
    `"${ffmpeg}" -y -i "${masterMp4}" -c:v copy -movflags +faststart "${stream1080pMp4}"`,
    { stdio: 'inherit' }
  );

  // 3. Render 35-45 second README Preview Cut
  console.log('[render] Generating 35-45s README preview cut (opsknight-readme-preview.webp)...');
  let chaptersManifest;
  try {
    chaptersManifest = loadChapters();
  } catch {
    console.log('[render] chapters.json not found, using automatic segment sampling...');
  }

  if (chaptersManifest && chaptersManifest.chapters.length >= 8) {
    const segments = getReadmeCutSegments(chaptersManifest);
    console.log(`[render] Cutting ${segments.length} highlight segments for README preview...`);

    const filterInputs: string[] = [];
    const filterConcat: string[] = [];

    segments.forEach((seg, idx) => {
      filterInputs.push(`[0:v]trim=start=${seg.start}:duration=${seg.duration},setpts=PTS-STARTPTS,scale=1280:720:flags=lanczos[v${idx}]`);
      filterConcat.push(`[v${idx}]`);
    });

    const filterComplex = `${filterInputs.join(';')};${filterConcat.join('')}concat=n=${segments.length}:v=1:a=0[outv]`;

    execSync(
      `"${ffmpeg}" -y -i "${rawWebm}" -filter_complex "${filterComplex}" -map "[outv]" -r 24 -vcodec libwebp -lossless 0 -q:v 70 -loop 0 "${readmeWebp}"`,
      { stdio: 'inherit' }
    );
  } else {
    // Fallback: fast speed-up or sample first 40s
    execSync(
      `"${ffmpeg}" -y -i "${rawWebm}" -t 40 -vf "scale=1280:720:flags=lanczos,fps=24" -vcodec libwebp -lossless 0 -q:v 70 -loop 0 "${readmeWebp}"`,
      { stdio: 'inherit' }
    );
  }

  // 4. Render README Poster Image
  console.log('[render] Generating README poster image (opsknight-readme-poster.webp)...');
  execSync(
    `"${ffmpeg}" -y -ss 00:00:06 -i "${rawWebm}" -vframes 1 -vf "scale=1920:1080:flags=lanczos" -vcodec libwebp -q:v 90 "${readmePoster}"`,
    { stdio: 'inherit' }
  );

  console.log('[render] All demo video artifacts generated successfully in dist/:');
  console.log(` - ${masterMp4} (${(fs.statSync(masterMp4).size / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(` - ${stream1080pMp4} (${(fs.statSync(stream1080pMp4).size / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(` - ${readmeWebp} (${(fs.statSync(readmeWebp).size / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(` - ${readmePoster} (${(fs.statSync(readmePoster).size / 1024).toFixed(2)} KB)`);
}

if (require.main === module) {
  renderDemoVideo()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[render] Error:', err);
      process.exit(1);
    });
}
