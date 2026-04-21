import { runBatchDownload } from './batch-down.js';

async function main(): Promise<void> {
  const targetUrl = process.argv[2];

  if (!targetUrl) {
    console.error('Usage: npm run download "https://www.coursera.org/learn/course-slug/home/welcome"');
    process.exit(1);
  }

  await runBatchDownload(targetUrl, 3);
}

main().catch((error) => {
  console.error('Download failed:', error);
  process.exit(1);
});
