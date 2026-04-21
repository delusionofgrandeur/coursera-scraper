#!/usr/bin/env node
import { select, input } from '@inquirer/prompts';
import chalk from 'chalk';
import { authenticate } from './auth.js';
import { runBatchDownload } from './batch-down.js';
import { MAX_CONCURRENCY, validateCourseraUrl } from './security.js';

async function main(): Promise<void> {
  console.clear();
  console.log(chalk.blue.bold('================================='));
  console.log(chalk.cyan.bold('   Coursera CLI Downloader'));
  console.log(chalk.blue.bold('=================================\n'));
  console.log(chalk.gray('Unofficial tool for educational and personal offline-use scenarios only.\n'));

  const action = await select({
    message: 'What would you like to do?',
    choices: [
      {
        name: 'Login and refresh session',
        value: 'auth',
        description: 'Sign in with your Coursera account and save a local session.',
      },
      {
        name: 'Download course content',
        value: 'download',
        description: 'Download course materials with guarded concurrency and path validation.',
      },
      {
        name: 'Exit',
        value: 'exit',
      },
    ],
  });

  if (action === 'exit') {
    console.log('Goodbye.');
    process.exit(0);
  }

  if (action === 'auth') {
    console.log(chalk.yellow('\n--- Starting login flow ---'));
    try {
      await authenticate();
    } catch {
      console.error(chalk.red('Login did not complete successfully.'));
    }

    await main();
    return;
  }

  console.log(chalk.yellow('\n--- Before you download ---'));
  console.log(chalk.gray('1. Only use content you are enrolled in and allowed to access.'));
  console.log(chalk.gray('2. This project is unofficial and is not affiliated with Coursera.'));
  console.log(chalk.gray('3. If Coursera recently redirected or access changed, refresh the saved session first.'));
  console.log(chalk.gray(`4. Concurrency is capped at ${MAX_CONCURRENCY} to reduce accidental rate spikes.\n`));

  const courseUrl = await input({
    message: 'Course, week, or lesson URL:',
    validate: (value) => {
      try {
        validateCourseraUrl(value);
        return true;
      } catch (error) {
        return error instanceof Error ? error.message : 'Enter a valid https://www.coursera.org/learn/... URL.';
      }
    },
  });

  const activeConcurrent = await input({
    message: `How many files should download in parallel? (1-${MAX_CONCURRENCY}, default: 3)`,
    default: '3',
    validate: (value) => {
      const numericValue = Number(value);
      if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > MAX_CONCURRENCY) {
        return `Enter a whole number between 1 and ${MAX_CONCURRENCY}.`;
      }

      return true;
    },
  });

  console.log(chalk.cyan('\n--- Starting downloader ---\n'));
  try {
    await runBatchDownload(courseUrl, Number(activeConcurrent));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(message));
  }

  const again = await select({
    message: 'Return to the menu?',
    choices: [
      { name: 'Yes', value: true },
      { name: 'No, exit', value: false },
    ],
  });

  if (again) {
    await main();
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
