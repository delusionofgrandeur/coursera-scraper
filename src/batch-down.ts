import { chromium, type Page, type Response } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import pLimit from 'p-limit';
import cliProgress from 'cli-progress';
import ora from 'ora';
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

export interface BatchDownloadItemFailure {
  url: string;
  message: string;
}

export function assertBatchDownloadAccess(requestedUrl: URL, resolvedUrl: string): void {
  if (requestedUrl.pathname.includes('/home/') && !resolvedUrl.includes('/home/')) {
    throw new Error(
      `Access check failed: Coursera redirected the page (potential auth issue or course not enrolled).\nRequested: ${requestedUrl.toString()}\nResolved:  ${resolvedUrl}`,
    );
  }
}

export function assertBatchDownloadItemsFound(items: readonly CourseItem[]): void {
  if (items.length === 0) {
    throw new Error('Module scan completed, but no downloadable content items were discovered.');
  }
}

export function finalizeBatchDownloadFailures(failures: readonly BatchDownloadItemFailure[]): void {
  if (failures.length === 0) {
    return;
  }

  const preview = failures
    .slice(0, 3)
    .map((failure) => `${failure.url} -> ${failure.message}`)
    .join(' | ');
  const remainder = failures.length > 3 ? ` (+${failures.length - 3} more)` : '';

  throw new Error(`Download finished with ${failures.length} failed item(s). ${preview}${remainder}`);
}

export async function runBatchDownload(targetUrl: string, concurrency = 3): Promise<void> {
  const validatedTargetUrl = validateCourseraUrl(targetUrl);
  const authPath = getAuthPath();

  if (!fs.existsSync(authPath)) {
    throw new Error('Missing auth state. Run the login flow first so the tool can reuse your Coursera session.');
  }

  const effectiveConcurrency = clampConcurrency(concurrency);
  const scanSpinner = ora({ text: chalk.blueBright('Waking up browser & secure context...'), color: 'cyan' }).start();
  
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
  });

  try {
    const context = await browser.newContext({ storageState: authPath });
    const indexPage = await context.newPage();

    scanSpinner.text = chalk.blueBright('Loading course metadata and compiling module map...');
    await indexPage.goto(validatedTargetUrl.toString(), {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });
    await indexPage.waitForTimeout(4_000);

    const resolvedUrl = indexPage.url();
    assertBatchDownloadAccess(validatedTargetUrl, resolvedUrl);

    const items = await collectCourseItems(indexPage);

    await indexPage.close();

    const uniqueItems = Array.from(new Map(items.map((item) => [item.url, item])).values());
    assertBatchDownloadItemsFound(uniqueItems);

    scanSpinner.succeed(chalk.green(`Scan complete. Indexed ${uniqueItems.length} unique downloadable item(s).`));
    console.log();

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
    const failures: BatchDownloadItemFailure[] = [];
    const tasks = uniqueItems.map((item) =>
      limit(async () => {
        const page = await context.newPage();

        try {
          await processCourseItem(page, item, downloadDir, multibar);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push({ url: item.url, message });
          console.error(chalk.red(`Failed to process ${item.url}: ${message}`));
        } finally {
          mainBar.increment();
          await page.close().catch(() => undefined);
        }
      }),
    );

    await Promise.all(tasks);
    multibar.stop();
    finalizeBatchDownloadFailures(failures);
    console.log('\nAll downloads completed.');
  } catch (error) {
    if (scanSpinner.isSpinning) {
      const message = error instanceof Error ? error.message : 'Download scan failed.';
      scanSpinner.fail(chalk.red(message));
    }

    throw error;
  } finally {
    await browser.close();
  }
}

async function collectCourseItems(indexPage: Page): Promise<CourseItem[]> {
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

    return items;
  }

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

    weekIndex += 1;
  }

  return items;
}

async function processCourseItem(
  page: Page,
  item: CourseItem,
  downloadDir: string,
  multibar: cliProgress.MultiBar,
): Promise<void> {
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

  const pageTitle = sanitizePathSegment((await page.title()).replace(' | Coursera', ''), 'lesson', 50);
  const fileNamePrefix = `${String(item.order).padStart(2, '0')}_${pageTitle}`;

  if (item.url.includes('/lecture/') || item.url.includes('/item/')) {
    await downloadLectureItem(page, itemDir, fileNamePrefix, videoApiPromise, multibar);
    return;
  }

  if (item.url.includes('/supplement/')) {
    await writeSupplementItem(page, itemDir, fileNamePrefix);
    return;
  }

  throw new Error('Unsupported course item type.');
}

async function downloadLectureItem(
  page: Page,
  itemDir: string,
  fileNamePrefix: string,
  videoApiPromise: Promise<Response | null>,
  multibar: cliProgress.MultiBar,
): Promise<void> {
  const videoUrl = await findVideoUrl(page, videoApiPromise);

  if (!videoUrl) {
    const notePath = resolveSafePath(itemDir, `${fileNamePrefix}.txt`);
    fs.writeFileSync(notePath, 'Video URL could not be resolved for this lesson.', 'utf-8');
    throw new Error('Video URL could not be resolved for this lesson.');
  }

  const filePath = resolveSafePath(itemDir, `${fileNamePrefix}.mp4`);
  const label = fileNamePrefix.slice(0, 27).padEnd(30, ' ');
  const fileBar = multibar.create(1, 0, {
    filename: `video ${label}`,
    speed: '0 MB/s',
  });

  await downloadToFile(videoUrl, filePath, {
    onStart: (totalBytes) => {
      fileBar.setTotal(totalBytes > 0 ? totalBytes : 1);
      fileBar.update(0, { speed: '0 MB/s' });
    },
    onProgress: (downloadedBytes, totalBytes, speedLabel) => {
      fileBar.setTotal(totalBytes > 0 ? totalBytes : Math.max(downloadedBytes, 1));
      fileBar.update(downloadedBytes, { speed: speedLabel });
    },
    onFinish: (downloadedBytes, totalBytes) => {
      fileBar.setTotal(totalBytes > 0 ? totalBytes : Math.max(downloadedBytes, 1));
      fileBar.update(totalBytes > 0 ? totalBytes : downloadedBytes, { speed: 'done' });
      fileBar.stop();
    },
    onError: () => {
      if (fileBar.isActive) {
        fileBar.stop();
      }
    },
  });
}

async function writeSupplementItem(page: Page, itemDir: string, fileNamePrefix: string): Promise<void> {
  const readingText = await page.evaluate(() => {
    const content = document.querySelector('.rc-CML, .rc-ReadingItem, #main, [data-e2e="ReadingItem"]');
    return content ? (content as HTMLElement).innerText : '';
  });

  if (!readingText.trim()) {
    throw new Error('Reading content could not be extracted for this lesson.');
  }

  const filePath = resolveSafePath(itemDir, `${fileNamePrefix}.txt`);
  fs.writeFileSync(filePath, readingText, 'utf-8');
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
