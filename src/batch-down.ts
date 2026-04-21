import { chromium, type Page, type Response } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import pLimit from 'p-limit';
import cliProgress from 'cli-progress';
import {
  clampConcurrency,
  downloadToFile,
  ensureDir,
  getAuthPath,
  resolveSafePath,
  sanitizePathSegment,
  validateCourseraUrl,
} from './security.js';

type ApolloWindow = Window & {
  __APOLLO_STATE__?: unknown;
};

interface CourseItem {
  url: string;
  folderName: string;
  order: number;
}

export async function runBatchDownload(targetUrl: string, concurrency = 3): Promise<void> {
  const validatedTargetUrl = validateCourseraUrl(targetUrl);
  const authPath = getAuthPath();

  if (!fs.existsSync(authPath)) {
    throw new Error('Missing auth state. Run the login flow first so the tool can reuse your Coursera session.');
  }

  const effectiveConcurrency = clampConcurrency(concurrency);
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
  });

  try {
    console.log(chalk.cyanBright('\n[session] Starting Coursera browser context...'));
    const context = await browser.newContext({ storageState: authPath });
    const indexPage = await context.newPage();

    console.log('[scan] Loading course page and indexing lessons...');
    await indexPage.goto(validatedTargetUrl.toString(), {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });
    await indexPage.waitForTimeout(4_000);

    const resolvedUrl = indexPage.url();
    if (validatedTargetUrl.pathname.includes('/home/') && !resolvedUrl.includes('/home/')) {
      console.log(chalk.red('\nAccess check failed: Coursera redirected the page.'));
      console.log(`Requested: ${validatedTargetUrl.toString()}`);
      console.log(`Resolved:  ${resolvedUrl}`);
      console.log('\nThis usually means either the course is not enrolled on this account or the saved auth session is stale.');
      return;
    }

    const weekLinks = await indexPage.evaluate(() => {
      return Array.from(document.querySelectorAll('a'))
        .map((anchor) => anchor.href)
        .filter((href) => href.includes('/home/week/') || href.includes('/home/module/'))
        .filter((href, index, all) => all.indexOf(href) === index);
    });

    const items: CourseItem[] = [];

    if (weekLinks.length === 0) {
      const directItems = await indexPage.evaluate(() => {
        return Array.from(document.querySelectorAll('a'))
          .map((anchor) => anchor.href)
          .filter((href) => href.includes('/lecture/') || href.includes('/supplement/') || href.includes('/item/'))
          .filter((href, index, all) => all.indexOf(href) === index);
      });

      let order = 1;
      for (const itemUrl of directItems) {
        const safeUrl = toSafeCourseraUrl(itemUrl);
        if (!safeUrl) {
          continue;
        }

        items.push({ url: safeUrl, folderName: 'standalone_items', order: order++ });
      }
    } else {
      console.log(`Found ${weekLinks.length} modules. Indexing all downloadable items...`);

      let weekIndex = 1;
      for (const weekUrl of weekLinks) {
        const safeWeekUrl = toSafeCourseraUrl(weekUrl);
        if (!safeWeekUrl) {
          continue;
        }

        if (safeWeekUrl !== indexPage.url()) {
          await indexPage.goto(safeWeekUrl, {
            waitUntil: 'networkidle',
            timeout: 60_000,
          });
          await indexPage.waitForTimeout(3_000);
        }

        const folderName = `week_${weekIndex.toString().padStart(2, '0')}`;
        const weekItems = await indexPage.evaluate(() => {
          return Array.from(document.querySelectorAll('a'))
            .map((anchor) => anchor.href)
            .filter((href) => href.includes('/lecture/') || href.includes('/supplement/') || href.includes('/item/'))
            .filter((href, index, all) => all.indexOf(href) === index);
        });

        let order = 1;
        for (const itemUrl of weekItems) {
          const safeItemUrl = toSafeCourseraUrl(itemUrl);
          if (!safeItemUrl) {
            continue;
          }

          items.push({ url: safeItemUrl, folderName, order: order++ });
        }

        weekIndex++;
      }
    }

    await indexPage.close();

    const uniqueItems = Array.from(new Map(items.map((item) => [item.url, item])).values());
    console.log(`\nIndexed ${uniqueItems.length} unique course items.`);

    if (uniqueItems.length === 0) {
      console.log('No downloadable items were found for this page.');
      return;
    }

    const multibar = new cliProgress.MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        format: '{filename} | {bar} | {percentage}% | {value}/{total} bytes | Speed: {speed} | ETA: {eta}s',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
      },
      cliProgress.Presets.shades_classic,
    );

    const mainBar = multibar.create(uniqueItems.length, 0, {
      filename: 'overall progress'.padEnd(30, ' '),
      speed: '-',
      value: 0,
      total: uniqueItems.length,
    });
    (mainBar as cliProgress.SingleBar & { format?: string }).format =
      '{filename} | {bar} | {percentage}% | {value}/{total} tasks | ETA: {eta}s';

    const courseSlug = validatedTargetUrl.pathname.split('/')[2] ?? 'course';
    const downloadDir = resolveSafePath(path.join(process.cwd(), 'downloads'), courseSlug);
    ensureDir(downloadDir);

    if (effectiveConcurrency !== concurrency) {
      console.log(`Using concurrency ${effectiveConcurrency} (requested ${concurrency}).`);
    }

    const limit = pLimit(effectiveConcurrency);
    const tasks = uniqueItems.map((item) => limit(async () => {
      const page = await context.newPage();

      try {
        const itemDir = resolveSafePath(downloadDir, item.folderName);
        ensureDir(itemDir);

        const videoApiPromise = page
          .waitForResponse(
            (response) =>
              response.url().includes('onDemandLectureVideos.v1') ||
              response.url().includes('onDemandVideos.v1'),
            { timeout: 15_000 },
          )
          .catch(() => null);

        await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForTimeout(3_000);

        const pageTitle = sanitizePathSegment(
          (await page.title()).replace(' | Coursera', ''),
          'lesson',
          50,
        );
        const fileNamePrefix = `${String(item.order).padStart(2, '0')}_${pageTitle}`;

        if (item.url.includes('/lecture/') || item.url.includes('/item/')) {
          const videoUrl = await findVideoUrl(page, videoApiPromise);

          if (!videoUrl) {
            const notePath = resolveSafePath(itemDir, `${fileNamePrefix}.txt`);
            fs.writeFileSync(notePath, 'Video URL could not be resolved for this lesson.', 'utf-8');
            return;
          }

          const filePath = resolveSafePath(itemDir, `${fileNamePrefix}.mp4`);
          const label = fileNamePrefix.slice(0, 27).padEnd(30, ' ');
          const fileBar = multibar.create(100, 0, {
            filename: `video ${label}`,
            speed: '0 MB/s',
          });

          await downloadToFile(videoUrl, filePath, {
            onStart: (totalBytes) => {
              if (totalBytes > 0) {
                fileBar.start(totalBytes, 0, { speed: '0 MB/s' });
              }
            },
            onProgress: (downloadedBytes, totalBytes, speedLabel) => {
              fileBar.update(totalBytes > 0 ? downloadedBytes : 0, { speed: speedLabel });
            },
            onFinish: (downloadedBytes, totalBytes) => {
              if (fileBar.isActive) {
                fileBar.update(totalBytes > 0 ? totalBytes : downloadedBytes, { speed: 'done' });
                fileBar.stop();
              }
            },
            onError: () => {
              if (fileBar.isActive) {
                fileBar.stop();
              }
            },
          });
          return;
        }

        if (item.url.includes('/supplement/')) {
          const readingText = await page.evaluate(() => {
            const content = document.querySelector('.rc-CML, .rc-ReadingItem, #main, [data-e2e="ReadingItem"]');
            return content ? (content as HTMLElement).innerText : '';
          });

          if (readingText) {
            const filePath = resolveSafePath(itemDir, `${fileNamePrefix}.txt`);
            fs.writeFileSync(filePath, readingText, 'utf-8');
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Failed to process ${item.url}: ${message}`));
      } finally {
        mainBar.increment();
        await page.close().catch(() => undefined);
      }
    }));

    await Promise.all(tasks);
    multibar.stop();
    console.log('\nAll downloads completed.');
  } finally {
    await browser.close();
  }
}

async function findVideoUrl(page: Page, videoApiPromise: Promise<Response | null>): Promise<string | null> {
  const videoResponse = await videoApiPromise;
  if (videoResponse && videoResponse.ok()) {
    try {
      const payload = await videoResponse.json();
      const fromApi = findFirstMp4(payload);
      if (fromApi) {
        return fromApi;
      }
    } catch {
      // Ignore malformed API payloads and continue with fallbacks.
    }
  }

  const fromApollo = await page.evaluate(() => {
    const appWindow = window as ApolloWindow;
    if (!appWindow.__APOLLO_STATE__) {
      return null;
    }

    const json = JSON.stringify(appWindow.__APOLLO_STATE__);
    const match = json.match(/https:\/\/[^"']+\.mp4[^"']*/);
    return match ? match[0] : null;
  });
  if (fromApollo) {
    return fromApollo;
  }

  return page.evaluate(() => {
    const video = document.querySelector('video');
    if (video && video.src.includes('.mp4')) {
      return video.src;
    }

    const source = document.querySelector('video source[type="video/mp4"]');
    return source ? (source as HTMLSourceElement).src : null;
  });
}

function findFirstMp4(value: unknown): string | null {
  if (typeof value === 'string' && value.includes('.mp4') && value.startsWith('https://')) {
    return value;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = findFirstMp4(entry);
      if (match) {
        return match;
      }
    }
  }

  if (typeof value === 'object' && value !== null) {
    for (const nestedValue of Object.values(value)) {
      const match = findFirstMp4(nestedValue);
      if (match) {
        return match;
      }
    }
  }

  return null;
}

function toSafeCourseraUrl(candidate: string): string | null {
  try {
    return validateCourseraUrl(candidate).toString();
  } catch {
    return null;
  }
}
