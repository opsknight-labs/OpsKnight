import { runDemoVideoSeed } from '../../prisma/demo-video-seed';

async function main() {
  console.log('[scripts/demo-video/seed] Initiating demo video seed...');
  await runDemoVideoSeed();
  console.log('[scripts/demo-video/seed] Demo video seed completed successfully.');
}

main().catch(err => {
  console.error('[scripts/demo-video/seed] Seed failed:', err);
  process.exit(1);
});
