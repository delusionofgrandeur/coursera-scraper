import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import chalk from 'chalk';
import { ensureDir, getAuthPath, getConfigDir, saveStorageStateSecurely } from './security.js';

const COURSES_LOGIN_URL = 'https://www.coursera.org/?authMode=login';
const AUTH_POLL_INTERVAL_MS = 1_000;
const AUTH_TIMEOUT_MS = 10 * 60 * 1_000;
const AUTH_COOKIE_NAMES = new Set(['CAUTH']);

export async function authenticate(): Promise<void> {
  console.log('Starting local Chrome session for authentication...');

  const chromeExecutable = resolveChromeExecutablePath();
  const configDir = getConfigDir();
  const authPath = getAuthPath();
  ensureDir(configDir);
  const authProfileDir = fs.mkdtempSync(path.join(configDir, 'auth-browser-'));
  const debuggingPort = await reserveEphemeralPort();

  let browser: Browser | null = null;
  let chromeProcess: ChildProcess | null = null;

  try {
    chromeProcess = launchChromeForAuth(chromeExecutable, authProfileDir, debuggingPort);
    browser = await connectToChrome(debuggingPort);

    const context = await getAttachedContext(browser);
    const page = await getAttachedPage(context);

    console.log(chalk.cyan('Opening Coursera login in a regular Chrome window...'));
    await page.goto(COURSES_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    console.log('====================================================');
    console.log('Complete the login flow in the opened Chrome window.');
    console.log('If Google login was blocked before, this flow should be more reliable.');
    console.log('Keep the Chrome window open until the CLI confirms that your session was saved.');
    console.log('====================================================');

    console.log(chalk.cyan('Waiting for Coursera login to complete...'));
    await waitForCompletedLogin(browser, context, page);
    console.log(chalk.cyan('Login detected. Saving your local session state...'));
    console.log('Saving your local session state...');
    try {
      await saveStorageStateSecurely(context, authPath);
    } catch (error) {
      if (isBrowserClosedError(error)) {
        throw new Error(
          'Authentication window was closed before the session could be saved. Keep the browser open until the CLI confirms that your session was saved.',
        );
      }

      throw error;
    }

    console.log(`Done. Session state saved to ${authPath}.`);
    console.log('Keep this file private. It should never be committed or shared.');
  } finally {
    await browser?.close().catch(() => undefined);
    terminateChromeProcess(chromeProcess);
    await delay(500);

    try {
      fs.rmSync(authProfileDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(chalk.yellow(`Cleanup warning: ${message}`));
    }
  }
}

function resolveChromeExecutablePath(): string {
  const envPath = process.env.CHROME_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env['PROGRAMFILES'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['LOCALAPPDATA'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  if (process.platform === 'darwin') {
    const candidate = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const linuxCandidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
  ];

  for (const candidate of linuxCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'Could not find a local Google Chrome installation. Install Chrome or set CHROME_PATH before running auth.',
  );
}

async function reserveEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not reserve a debugging port for Chrome.')));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

function launchChromeForAuth(executablePath: string, profileDir: string, debuggingPort: number): ChildProcess {
  ensureDir(profileDir);

  const chromeArgs = [
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    COURSES_LOGIN_URL,
  ];

  const child = spawn(executablePath, chromeArgs, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });

  child.unref();
  return child;
}

async function connectToChrome(debuggingPort: number): Promise<Browser> {
  const endpoint = `http://127.0.0.1:${debuggingPort}`;
  let lastError: unknown;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await waitForJsonVersion(endpoint);
      return await chromium.connectOverCDP(endpoint);
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }

  throw new Error(
    `Could not attach to the local Chrome auth window. ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function waitForJsonVersion(endpoint: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = http.get(`${endpoint}/json/version`, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Chrome debugging endpoint returned HTTP ${response.statusCode}.`));
        return;
      }

      response.resume();
      resolve();
    });

    request.setTimeout(2_000, () => {
      request.destroy(new Error('Timed out waiting for Chrome debugging endpoint.'));
    });

    request.once('error', reject);
  });
}

async function getAttachedContext(browser: Browser): Promise<BrowserContext> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const context = browser.contexts()[0];
    if (context) {
      return context;
    }

    await delay(250);
  }

  throw new Error('Chrome opened, but no browser context became available.');
}

async function getAttachedPage(context: BrowserContext): Promise<Page> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const existingPage = context.pages()[0];
    if (existingPage) {
      return existingPage;
    }

    await delay(250);
  }

  return context.newPage();
}

async function assertLoginLooksComplete(page: Page, context: BrowserContext): Promise<void> {
  const currentUrl = page.url();
  const cookies = await context.cookies(['https://www.coursera.org']);
  const hasAuthCookie = cookies.some((cookie) => AUTH_COOKIE_NAMES.has(cookie.name));
  const stillShowsGuestLoginUi = await page
    .evaluate(() => {
      return Boolean(
        document.querySelector('[data-e2e="header-login-button"]') ||
          document.querySelector('[data-e2e="header-signup-button"]') ||
          document.querySelector('a[href*="authMode=login"]') ||
          document.querySelector('a[href*="authMode=signup"]'),
      );
    })
    .catch(() => false);

  if (currentUrl.includes('authMode=login') || currentUrl.includes('authMode=signup')) {
    throw new Error('Login still appears incomplete. Wait for the logged-in Coursera page to load, then try again.');
  }

  if (!hasAuthCookie) {
    throw new Error('Authenticated Coursera session cookie was not detected yet. Finish logging in and keep the auth window open.');
  }

  if (stillShowsGuestLoginUi) {
    throw new Error('Coursera still shows the guest login/signup controls. Wait for the logged-in page to finish rendering.');
  }
}

async function waitForCompletedLogin(browser: Browser, context: BrowserContext, fallbackPage: Page): Promise<void> {
  const deadline = Date.now() + AUTH_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (!browser.isConnected()) {
      throw new Error(
        'Authentication window was closed before login completed. Keep the browser open until the CLI confirms that your session was saved.',
      );
    }

    const activePage = getActiveAuthPage(context, fallbackPage);
    if (!activePage) {
      throw new Error(
        'Authentication window was closed before login completed. Keep the browser open until the CLI confirms that your session was saved.',
      );
    }

    try {
      await activePage.waitForLoadState('networkidle', { timeout: 1_000 }).catch(() => undefined);
      await assertLoginLooksComplete(activePage, context);
      return;
    } catch (error) {
      if (isBrowserClosedError(error)) {
        throw new Error(
          'Authentication window was closed before login completed. Keep the browser open until the CLI confirms that your session was saved.',
        );
      }

      if (isLoginIncompleteError(error)) {
        await delay(AUTH_POLL_INTERVAL_MS);
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    'Authentication timed out after 10 minutes. Complete the Coursera login flow and leave the browser open until the CLI confirms that your session was saved.',
  );
}

function getActiveAuthPage(context: BrowserContext, fallbackPage: Page): Page | null {
  if (!fallbackPage.isClosed()) {
    return fallbackPage;
  }

  const pages = context.pages().filter((page) => !page.isClosed());
  if (pages.length === 0) {
    return null;
  }

  const courseraPage = pages.find((page) => page.url().includes('coursera.org'));
  return courseraPage ?? pages.at(-1) ?? null;
}

function isLoginIncompleteError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === 'Login still appears incomplete. Wait for the logged-in Coursera page to load, then try again.' ||
    error.message === 'Authenticated Coursera session cookie was not detected yet. Finish logging in and keep the auth window open.' ||
    error.message === 'Coursera still shows the guest login/signup controls. Wait for the logged-in page to finish rendering.'
  );
}

function isBrowserClosedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('Target page, context or browser has been closed') ||
    error.message.includes('Browser has been closed') ||
    error.message.includes('Connection closed') ||
    error.message.includes('Session closed') ||
    error.message.includes('Browser closed')
  );
}

function terminateChromeProcess(chromeProcess: ChildProcess | null): void {
  const pid = chromeProcess?.pid;
  if (!pid) {
    return;
  }

  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    }

    chromeProcess.kill('SIGTERM');
  } catch {
    // Best effort cleanup only.
  }
}
