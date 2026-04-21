import { chromium } from 'playwright';
import * as readline from 'readline';
import chalk from 'chalk';
import { getAuthPath, saveStorageStateSecurely } from './security.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const askQuestion = (query: string): Promise<string> => {
  return new Promise((resolve) => rl.question(query, resolve));
};

export async function authenticate(): Promise<void> {
  console.log('Starting headed browser for authentication...');

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log(chalk.cyan('Navigating to Coursera login...'));
    await page.goto('https://www.coursera.org/?authMode=login', { waitUntil: 'domcontentloaded' });

    console.log('====================================================');
    console.log('Complete the login flow in the opened browser window.');
    console.log('Press Enter only after the Coursera homepage has fully loaded.');
    console.log('====================================================');

    await askQuestion('Press Enter after login is complete: ');

    const authPath = getAuthPath();
    console.log('Saving your local session state...');
    await saveStorageStateSecurely(context, authPath);

    console.log(`Done. Session state saved to ${authPath}.`);
    console.log('Keep this file private. It should never be committed or shared.');
  } finally {
    await browser.close().catch(() => undefined);
    rl.close();
  }
}
