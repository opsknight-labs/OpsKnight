import * as fs from 'fs';
import * as path from 'path';

export interface Chapter {
  id: string;
  number: number;
  title: string;
  subtitle: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

export interface ChaptersManifest {
  totalDuration: number;
  chapters: Chapter[];
  generatedAt: string;
}

export const DEFAULT_CHAPTERS_PATH = path.resolve(
  process.cwd(),
  'test-results/demo-video/chapters.json'
);

export function loadChapters(filePath: string = DEFAULT_CHAPTERS_PATH): ChaptersManifest {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Chapters file not found at: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

export function getReadmeCutSegments(manifest: ChaptersManifest): Array<{
  id: string;
  title: string;
  start: number;
  duration: number;
}> {
  // Target: ~35-45 second cut:
  // Dashboard -> Incident -> Schedule -> Escalation -> ChatOps -> Status Page -> Analytics -> Postmortem -> Integrations -> Logo
  const targetIds: Array<{ id: string; targetDuration: number }> = [
    { id: 'command-center', targetDuration: 4 },
    { id: 'incidents', targetDuration: 5 },
    { id: 'schedules', targetDuration: 4 },
    { id: 'escalation', targetDuration: 4 },
    { id: 'chatops', targetDuration: 4 },
    { id: 'status-page', targetDuration: 6 },
    { id: 'analytics', targetDuration: 4 },
    { id: 'postmortems', targetDuration: 4 },
    { id: 'integrations', targetDuration: 4 },
    { id: 'end-card', targetDuration: 3 },
  ];

  const segments: Array<{ id: string; title: string; start: number; duration: number }> = [];

  for (const target of targetIds) {
    const found = manifest.chapters.find(c => c.id === target.id);
    if (found) {
      // Pick middle or beginning of chapter
      const chapterDur = found.duration || 10;
      const start = found.startTime + (chapterDur > target.targetDuration ? 1 : 0);
      segments.push({
        id: found.id,
        title: found.title,
        start,
        duration: Math.min(target.targetDuration, chapterDur),
      });
    }
  }

  return segments;
}
