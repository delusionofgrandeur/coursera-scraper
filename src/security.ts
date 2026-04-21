import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { isIP } from 'node:net';
import type { BrowserContext } from 'playwright';

export const MAX_CONCURRENCY = 5;

const MAX_REDIRECTS = 5;
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
const RESERVED_WINDOWS_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

type ValidateHttpsUrlOptions = {
  allowedHosts?: string[];
  allowSubdomains?: boolean;
  requireLearnPath?: boolean;
};

type DownloadProgressCallbacks = {
  onStart?: (totalBytes: number) => void;
  onProgress?: (downloadedBytes: number, totalBytes: number, speedLabel: string) => void;
  onFinish?: (downloadedBytes: number, totalBytes: number) => void;
  onError?: () => void;
};

export function getConfigDir(): string {
  return path.join(os.homedir(), '.coursera-scraper');
}

export function getAuthPath(): string {
  return path.join(getConfigDir(), 'auth.json');
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function clampConcurrency(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }

  return Math.min(Math.floor(value), MAX_CONCURRENCY);
}

export function sanitizePathSegment(input: string, fallback = 'item', maxLength = 80): string {
  const ascii = input
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\s.-]+|[_\s.-]+$/g, '');

  const trimmed = ascii.slice(0, maxLength) || fallback;
  if (RESERVED_WINDOWS_NAMES.has(trimmed.toLowerCase())) {
    return `${fallback}_${trimmed}`;
  }

  return trimmed || fallback;
}

export function resolveSafePath(baseDir: string, ...segments: string[]): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(
    resolvedBase,
    ...segments.map((segment) => sanitizePathSegment(segment)),
  );
  const relative = path.relative(resolvedBase, resolvedTarget);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Refusing to write outside the expected output directory.');
  }

  return resolvedTarget;
}

export function validateCourseraUrl(input: string): URL {
  return validateHttpsUrl(input, {
    allowedHosts: ['coursera.org', 'www.coursera.org'],
    allowSubdomains: false,
    requireLearnPath: true,
  });
}

export function validateRemoteDownloadUrl(input: string): URL {
  return validateHttpsUrl(input, {
    allowSubdomains: true,
    requireLearnPath: false,
  });
}

export async function saveStorageStateSecurely(
  context: BrowserContext,
  destinationPath: string,
): Promise<void> {
  ensureDir(path.dirname(destinationPath));
  await context.storageState({ path: destinationPath });
  await tightenFilePermissions(destinationPath);
}

export async function downloadToFile(
  sourceUrl: string,
  destinationPath: string,
  callbacks: DownloadProgressCallbacks = {},
): Promise<void> {
  const validatedUrl = validateRemoteDownloadUrl(sourceUrl).toString();
  await downloadToFileInternal(validatedUrl, destinationPath, callbacks, 0);
}

function validateHttpsUrl(input: string, options: ValidateHttpsUrlOptions): URL {
  let parsed: URL;

  try {
    parsed = new URL(input);
  } catch {
    throw new Error('Invalid URL provided.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Only https:// URLs are allowed.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Credentialed URLs are not allowed.');
  }

  if (parsed.port && parsed.port !== '443') {
    throw new Error('Custom ports are not allowed.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isBlockedHostname(hostname)) {
    throw new Error(`Blocked hostname: ${hostname}`);
  }

  if (options.allowedHosts && !matchesAllowedHost(hostname, options.allowedHosts, options.allowSubdomains)) {
    throw new Error(`Unexpected host: ${hostname}`);
  }

  if (options.requireLearnPath && !parsed.pathname.startsWith('/learn/')) {
    throw new Error('Only Coursera course URLs under /learn/ are supported.');
  }

  return parsed;
}

function matchesAllowedHost(hostname: string, allowedHosts: string[], allowSubdomains = false): boolean {
  return allowedHosts.some((allowedHost) => {
    if (hostname === allowedHost) {
      return true;
    }

    return allowSubdomains && hostname.endsWith(`.${allowedHost}`);
  });
}

function isBlockedHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return true;
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 0) {
    return false;
  }

  if (ipVersion === 4) {
    return (
      hostname.startsWith('10.') ||
      hostname.startsWith('127.') ||
      hostname.startsWith('169.254.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    );
  }

  const normalized = hostname.toLowerCase();
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
}

async function tightenFilePermissions(filePath: string): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }

  await fs.promises.chmod(filePath, 0o600).catch(() => undefined);
}

async function downloadToFileInternal(
  sourceUrl: string,
  destinationPath: string,
  callbacks: DownloadProgressCallbacks,
  redirectCount: number,
): Promise<void> {
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error('Too many redirects while downloading a file.');
  }

  ensureDir(path.dirname(destinationPath));
  const tempPath = `${destinationPath}.part`;
  fs.rmSync(tempPath, { force: true });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let downloadedBytes = 0;
    let totalBytes = 0;
    let lastTickAt = Date.now();
    let lastTickBytes = 0;

    const fail = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      callbacks.onError?.();
      fs.rm(tempPath, { force: true }, () => reject(error));
    };

    const request = https.get(sourceUrl, (response) => {
      const statusCode = response.statusCode ?? 0;

      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, sourceUrl).toString();

        downloadToFileInternal(
          validateRemoteDownloadUrl(nextUrl).toString(),
          destinationPath,
          callbacks,
          redirectCount + 1,
        )
          .then(resolve)
          .catch(reject);
        return;
      }

      if (statusCode !== 200) {
        response.resume();
        fail(new Error(`Download failed with HTTP ${statusCode}.`));
        return;
      }

      totalBytes = Number.parseInt(response.headers['content-length'] ?? '0', 10) || 0;
      if (totalBytes > MAX_DOWNLOAD_BYTES) {
        response.resume();
        fail(new Error('Refusing to download a file larger than 2 GB.'));
        return;
      }

      callbacks.onStart?.(totalBytes);

      const file = fs.createWriteStream(tempPath, { flags: 'w' });

      response.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length;

        if (downloadedBytes > MAX_DOWNLOAD_BYTES) {
          response.destroy(new Error('Refusing to download more than 2 GB for a single file.'));
          return;
        }

        const now = Date.now();
        if (now - lastTickAt >= 500) {
          const deltaBytes = downloadedBytes - lastTickBytes;
          const deltaMs = Math.max(now - lastTickAt, 1);
          const mbPerSecond = ((deltaBytes / deltaMs) * 1000) / (1024 * 1024);
          callbacks.onProgress?.(downloadedBytes, totalBytes, `${mbPerSecond.toFixed(2)} MB/s`);
          lastTickAt = now;
          lastTickBytes = downloadedBytes;
        }
      });

      response.on('error', fail);
      file.on('error', fail);

      file.on('finish', () => {
        file.close(() => {
          try {
            fs.renameSync(tempPath, destinationPath);
            callbacks.onFinish?.(downloadedBytes, totalBytes);
            settled = true;
            resolve();
          } catch (error) {
            fail(error as Error);
          }
        });
      });

      response.pipe(file);
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('Download timed out.'));
    });

    request.on('error', fail);
  });
}
