import { chromium, type BrowserContext, type Page, type Response } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
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

export interface CourseItem {
  url: string;
  folderName: string;
  order: number;
}

const MAX_ITEM_ATTEMPTS = 3;
const MAX_RESOLVER_CONCURRENCY = 3;

export interface BatchDownloadItemFailure {
  url: string;
  message: string;
}

export interface BatchDownloadPipelineSettings {
  downloadConcurrency: number;
  resolverConcurrency: number;
  bufferSize: number;
}

export type PreparedDownloadJob =
  | {
      kind: 'skip';
      url: string;
    }
  | {
      kind: 'supplement';
      url: string;
      filePath: string;
      text: string;
    }
  | {
      kind: 'video';
      url: string;
      filePath: string;
      fileNamePrefix: string;
      videoUrl: string;
    };

interface CourseItemAttempt {
  item: CourseItem;
  attempt: number;
}

type VideoDownloadJob = Extract<PreparedDownloadJob, { kind: 'video' }> & CourseItemAttempt;

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

export function getBatchDownloadPipelineSettings(effectiveConcurrency: number): BatchDownloadPipelineSettings {
  const downloadConcurrency = clampConcurrency(effectiveConcurrency);

  return {
    downloadConcurrency,
    resolverConcurrency: Math.min(MAX_RESOLVER_CONCURRENCY, downloadConcurrency),
    bufferSize: downloadConcurrency * 2,
  };
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
    await runBatchDownloadWithValidatedUrl(validatedTargetUrl, context, effectiveConcurrency, concurrency, scanSpinner);
  } catch (error) {
    if (scanSpinner.isSpinning) {
      const message = error instanceof Error ? error.message : 'Download scan failed.';
      scanSpinner.fail(chalk.red(message));
    }

    throw error;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function runBatchDownloadWithValidatedUrl(
  validatedTargetUrl: URL,
  context: BrowserContext,
  effectiveConcurrency: number,
  requestedConcurrency: number,
  scanSpinner: ReturnType<typeof ora>,
): Promise<void> {
  const indexPage = await context.newPage();

  try {
    scanSpinner.text = chalk.blueBright('Loading course metadata and compiling module map...');
    await indexPage.goto(validatedTargetUrl.toString(), {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });
    await waitForCourseContentLinks(indexPage);

    const resolvedUrl = indexPage.url();
    assertBatchDownloadAccess(validatedTargetUrl, resolvedUrl);

    const items = await collectCourseItems(indexPage);
    const uniqueItems = Array.from(new Map(items.map((item) => [item.url, item])).values());
    assertBatchDownloadItemsFound(uniqueItems);

    scanSpinner.succeed(chalk.green(`Scan complete. Indexed ${uniqueItems.length} unique downloadable item(s).`));
    console.log();

    const multibar = new cliProgress.MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        noTTYOutput: true,
        format: '{filename} | {bar} | {percentage}% | {value}/{total} bytes | Speed: {speed} | ETA: {eta}s',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
      },
      cliProgress.Presets.shades_classic,
    );

    const mainBar = multibar.create(
      uniqueItems.length,
      0,
      {
        filename: 'overall progress'.padEnd(30, ' '),
        speed: '-',
      },
      {
        format: '{filename} | {bar} | {percentage}% | {value}/{total} tasks | ETA: {eta}s',
      },
    );

    const courseSlug = validatedTargetUrl.pathname.split('/')[2] ?? 'course';
    const downloadDir = resolveSafePath(path.join(process.cwd(), 'downloads'), courseSlug);
    ensureDir(downloadDir);

    if (effectiveConcurrency !== requestedConcurrency) {
      console.log(`Using concurrency ${effectiveConcurrency} (requested ${requestedConcurrency}).`);
    }

    const failures: BatchDownloadItemFailure[] = [];
    await runDownloadPipeline(context, uniqueItems, downloadDir, effectiveConcurrency, multibar, mainBar, failures);
    multibar.stop();
    finalizeBatchDownloadFailures(failures);
    console.log('\nAll downloads completed.');
  } finally {
    await indexPage.close().catch(() => undefined);
  }
}

async function runDownloadPipeline(
  context: BrowserContext,
  items: readonly CourseItem[],
  downloadDir: string,
  effectiveConcurrency: number,
  multibar: cliProgress.MultiBar,
  mainBar: cliProgress.SingleBar,
  failures: BatchDownloadItemFailure[],
): Promise<void> {
  const settings = getBatchDownloadPipelineSettings(effectiveConcurrency);
  const itemQueue = new AsyncBoundedQueue<CourseItemAttempt>();
  const downloadQueue = new AsyncBoundedQueue<VideoDownloadJob>(settings.bufferSize);
  let finalizedItems = 0;

  const finalizeItem = () => {
    finalizedItems += 1;
    mainBar.increment(1, {
      filename: 'overall progress'.padEnd(30, ' '),
      speed: '-',
    });

    if (finalizedItems >= items.length) {
      itemQueue.close();
      downloadQueue.close();
    }
  };

  const retryOrFail = (attempt: CourseItemAttempt, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);

    if (attempt.attempt >= MAX_ITEM_ATTEMPTS) {
      failures.push({ url: attempt.item.url, message });
      console.error(chalk.red(`Failed to process ${attempt.item.url}: ${message}`));
      finalizeItem();
      return;
    }

    console.warn(
      chalk.yellow(
        `Retrying ${attempt.item.url} after attempt ${attempt.attempt}/${MAX_ITEM_ATTEMPTS} failed: ${message}`,
      ),
    );

    void delay(getRetryDelayMs(attempt.attempt))
      .then(() => itemQueue.push({ item: attempt.item, attempt: attempt.attempt + 1 }))
      .catch((pushError: unknown) => {
        const pushMessage = pushError instanceof Error ? pushError.message : String(pushError);
        failures.push({ url: attempt.item.url, message: pushMessage });
        console.error(chalk.red(`Failed to retry ${attempt.item.url}: ${pushMessage}`));
        finalizeItem();
      });
  };

  const resolverWorkers = Array.from({ length: settings.resolverConcurrency }, async () => {
    for (;;) {
      const attempt = await itemQueue.shift();
      if (!attempt) {
        return;
      }

      let page: Page | null = null;
      try {
        page = await context.newPage();
        const job = await prepareCourseItemJob(page, attempt.item, downloadDir);
        if (job.kind === 'skip') {
          finalizeItem();
          continue;
        }

        if (job.kind === 'supplement') {
          fs.writeFileSync(job.filePath, job.text, 'utf-8');
          finalizeItem();
          continue;
        }

        await downloadQueue.push({ ...job, item: attempt.item, attempt: attempt.attempt });
      } catch (error) {
        retryOrFail(attempt, error);
      } finally {
        await page?.close().catch(() => undefined);
      }
    }
  });

  const downloadWorkers = Array.from({ length: settings.downloadConcurrency }, async () => {
    for (;;) {
      const job = await downloadQueue.shift();
      if (!job) {
        return;
      }

      try {
        await downloadVideoJob(job, multibar);
        finalizeItem();
      } catch (error) {
        retryOrFail(job, error);
      }
    }
  });

  for (const item of items) {
    await itemQueue.push({ item, attempt: 1 });
  }

  await Promise.all([...resolverWorkers, ...downloadWorkers]);
}

class AsyncBoundedQueue<T> {
  private readonly values: T[] = [];
  private readonly waitingConsumers: Array<(value: T | null) => void> = [];
  private readonly waitingProducers: Array<() => void> = [];
  private isClosed = false;

  constructor(private readonly maxSize = Number.POSITIVE_INFINITY) {}

  async push(value: T): Promise<void> {
    while (!this.isClosed && this.values.length >= this.maxSize && this.waitingConsumers.length === 0) {
      await new Promise<void>((resolve) => {
        this.waitingProducers.push(resolve);
      });
    }

    if (this.isClosed) {
      throw new Error('Cannot add work to a closed queue.');
    }

    const consumer = this.waitingConsumers.shift();
    if (consumer) {
      consumer(value);
      return;
    }

    this.values.push(value);
  }

  async shift(): Promise<T | null> {
    const value = this.values.shift();
    if (value) {
      this.waitingProducers.shift()?.();
      return value;
    }

    if (this.isClosed) {
      return null;
    }

    return new Promise<T | null>((resolve) => {
      this.waitingConsumers.push(resolve);
    });
  }

  close(): void {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;

    while (this.waitingConsumers.length > 0) {
      this.waitingConsumers.shift()?.(null);
    }

    while (this.waitingProducers.length > 0) {
      this.waitingProducers.shift()?.();
    }
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
      await waitForCourseContentLinks(indexPage);
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

async function waitForCourseContentLinks(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () =>
        Array.from(document.querySelectorAll('a')).some((anchor) => {
          return (
            anchor.href.includes('/home/week/') ||
            anchor.href.includes('/home/module/') ||
            anchor.href.includes('/lecture/') ||
            anchor.href.includes('/supplement/') ||
            anchor.href.includes('/item/')
          );
        }),
      { timeout: 12_000 },
    )
    .catch(() => undefined);
}

export async function prepareCourseItemJob(
  page: Page,
  item: CourseItem,
  downloadDir: string,
): Promise<PreparedDownloadJob> {
  const itemDir = resolveSafePath(downloadDir, item.folderName);
  ensureDir(itemDir);

  const isVideoItem = item.url.includes('/lecture/') || item.url.includes('/item/');
  const existingOutputPath = findExistingItemOutputPath(itemDir, item.order, isVideoItem ? '.mp4' : '.txt');
  if (existingOutputPath) {
    return { kind: 'skip', url: item.url };
  }

  const videoApiPromise = isVideoItem ? waitForVideoApiResponse(page) : Promise.resolve(null);

  await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForCourseItemHydration(page, isVideoItem);

  const pageTitle = sanitizePathSegment((await page.title()).replace(' | Coursera', ''), 'lesson', 50);
  const fileNamePrefix = `${String(item.order).padStart(2, '0')}_${pageTitle}`;

  if (isVideoItem) {
    const filePath = resolveSafePath(itemDir, `${fileNamePrefix}.mp4`);
    if (fileExistsWithContent(filePath)) {
      return { kind: 'skip', url: item.url };
    }

    const videoUrl = await findVideoUrl(page, videoApiPromise);

    if (!videoUrl) {
      const notePath = resolveSafePath(itemDir, `${fileNamePrefix}.txt`);
      fs.writeFileSync(notePath, 'Video URL could not be resolved for this lesson.', 'utf-8');
      throw new Error('Video URL could not be resolved for this lesson.');
    }

    return {
      kind: 'video',
      url: item.url,
      filePath,
      fileNamePrefix,
      videoUrl,
    };
  }

  if (item.url.includes('/supplement/')) {
    const filePath = resolveSafePath(itemDir, `${fileNamePrefix}.txt`);
    if (fileExistsWithContent(filePath)) {
      return { kind: 'skip', url: item.url };
    }

    const readingText = await page.evaluate(() => {
      const content = document.querySelector('.rc-CML, .rc-ReadingItem, #main, [data-e2e="ReadingItem"]');
      return content ? (content as HTMLElement).innerText : '';
    });

    if (!readingText.trim()) {
      throw new Error('Reading content could not be extracted for this lesson.');
    }

    return {
      kind: 'supplement',
      url: item.url,
      filePath,
      text: readingText,
    };
  }

  throw new Error('Unsupported course item type.');
}

async function downloadVideoJob(job: VideoDownloadJob, multibar: cliProgress.MultiBar): Promise<void> {
  if (fileExistsWithContent(job.filePath)) {
    return;
  }

  const label = job.fileNamePrefix.slice(0, 27).padEnd(30, ' ');
  const filename = `video ${label}`;
  const fileBar = multibar.create(1, 0, {
    filename,
    speed: '0 MB/s',
  });

  await downloadToFile(job.videoUrl, job.filePath, {
    onStart: (totalBytes) => {
      fileBar.setTotal(totalBytes > 0 ? totalBytes : 1);
      fileBar.update(0, { filename, speed: '0 MB/s' });
    },
    onProgress: (downloadedBytes, totalBytes, speedLabel) => {
      fileBar.setTotal(totalBytes > 0 ? totalBytes : Math.max(downloadedBytes, 1));
      fileBar.update(downloadedBytes, { filename, speed: speedLabel });
    },
    onFinish: (downloadedBytes, totalBytes) => {
      fileBar.setTotal(totalBytes > 0 ? totalBytes : Math.max(downloadedBytes, 1));
      fileBar.update(totalBytes > 0 ? totalBytes : downloadedBytes, { filename, speed: 'done' });
      fileBar.stop();
    },
    onError: () => {
      if (fileBar.isActive) {
        fileBar.stop();
      }
    },
  });
}

function waitForVideoApiResponse(page: Page): Promise<Response | null> {
  return page
    .waitForResponse(
      (response) =>
        response.url().includes('onDemandLectureVideos.v1') ||
        response.url().includes('onDemandVideos.v1'),
      { timeout: 15_000 },
    )
    .catch(() => null);
}

async function waitForCourseItemHydration(page: Page, isVideoItem: boolean): Promise<void> {
  const selector = isVideoItem
    ? 'video, video source[type="video/mp4"]'
    : '.rc-CML, .rc-ReadingItem, #main, [data-e2e="ReadingItem"]';

  await Promise.race([
    page.waitForSelector(selector, { timeout: 2_500 }).catch(() => undefined),
    page.waitForLoadState('networkidle', { timeout: 2_500 }).catch(() => undefined),
  ]);
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

function fileExistsWithContent(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function findExistingItemOutputPath(itemDir: string, order: number, extension: '.mp4' | '.txt'): string | null {
  const prefix = `${String(order).padStart(2, '0')}_`;

  try {
    const matchingFile = fs
      .readdirSync(itemDir, { withFileTypes: true })
      .find((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(extension));

    if (!matchingFile) {
      return null;
    }

    const filePath = path.join(itemDir, matchingFile.name);
    return fileExistsWithContent(filePath) ? filePath : null;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getRetryDelayMs(attempt: number): number {
  return attempt * 2_000;
}
