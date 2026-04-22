#!/usr/bin/env node
import { input, select } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { authenticate } from './auth.js';
import { runBatchDownload } from './batch-down.js';
import {
  enqueueQueueItem,
  getQueueItems,
  removeQueueItem,
  retryFailedQueueItems,
  runQueue,
  type QueueItem,
} from './queue.js';
import { MAX_CONCURRENCY, validateCourseraUrl } from './security.js';

function drawHeader(): void {
  console.clear();
  console.log();
  console.log(chalk.cyanBright.bold('   ______                                        ____ __  '));
  console.log(chalk.cyanBright.bold('  / ____/___  __  ___________  _________        / __ \\/ / '));
  console.log(chalk.cyanBright.bold(' / /   / __ \\/ / / / ___/ ___// _ \\/ ___/______/ / / / /  '));
  console.log(chalk.cyanBright.bold('/ /___/ /_/ / /_/ / /  (__  )/  __/ /  /_____/ /_/ / /___'));
  console.log(chalk.cyanBright.bold('\\____/\\____/\\__/_/_/  /____/ \\___/_/        /_____/_____/'));
  console.log(chalk.blue('                                      batch module downloader\n'));
}

function getStatusColor(status: QueueItem['status']): (value: string) => string {
  switch (status) {
    case 'completed':
      return chalk.green;
    case 'failed':
      return chalk.red;
    case 'running':
      return chalk.cyan;
    default:
      return chalk.yellow;
  }
}

function printQueueItems(items: QueueItem[]): void {
  if (items.length === 0) {
    console.log(chalk.gray('Queue is empty.\n'));
    return;
  }

  console.log(chalk.yellow('\nQueue snapshot\n'));
  for (const item of items) {
    const color = getStatusColor(item.status);
    console.log(color(`[${item.status.toUpperCase().padEnd(9, ' ')}] c=${item.concurrency} ${item.url}`));
    console.log(chalk.gray(`  id:       ${item.id}`));

    if (item.createdAt) {
      console.log(chalk.gray(`  created:  ${item.createdAt}`));
    }

    if (item.startedAt) {
      console.log(chalk.gray(`  started:  ${item.startedAt}`));
    }

    if (item.finishedAt) {
      console.log(chalk.gray(`  finished: ${item.finishedAt}`));
    }

    if (item.error) {
      console.log(chalk.red(`  error:    ${item.error}`));
    }

    console.log();
  }
}

function parseConcurrencyValue(value: string): number {
  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > MAX_CONCURRENCY) {
    throw new Error(`Concurrency must be a whole number between 1 and ${MAX_CONCURRENCY}.`);
  }

  return numericValue;
}

function parseCommandConcurrency(args: string[]): number {
  const flagIndex = args.indexOf('--concurrency');

  if (flagIndex === -1) {
    return 3;
  }

  const value = args[flagIndex + 1];
  if (!value) {
    throw new Error('Missing value for --concurrency.');
  }

  return parseConcurrencyValue(value);
}

function printQueueSummary(summary: {
  total: number;
  completed: number;
  failed: number;
  remainingPending: number;
  recoveredRunning: number;
}): void {
  console.log();
  console.log(chalk.green(`Completed: ${summary.completed}`));
  console.log(chalk.red(`Failed: ${summary.failed}`));
  console.log(chalk.yellow(`Pending: ${summary.remainingPending}`));

  if (summary.recoveredRunning > 0) {
    console.log(chalk.cyan(`Recovered stale running items: ${summary.recoveredRunning}`));
  }

  if (summary.total === 0) {
    console.log(chalk.gray('Queue had no pending items to run.'));
  }

  console.log();
}

async function pauseForMenu(): Promise<void> {
  await input({
    message: 'Press Enter to return to the menu',
    default: '',
  });
}

async function executeAuthentication(): Promise<void> {
  console.log();
  const spinner = ora({
    text: chalk.blueBright('Preparing automatic Coursera authentication flow...'),
    color: 'cyan',
  }).start();

  try {
    spinner.stop();
    await authenticate();
    console.log();
    spinner.succeed(chalk.green('Session tokens successfully updated and saved locally.'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication flow failed.';
    console.log();
    spinner.fail(chalk.red('Authentication flow was interrupted or failed.'));
    console.error(chalk.red(`  ${message}`));
  }
}

async function promptForUrl(): Promise<string> {
  return input({
    message: '> Enter Course, Module, or Video URL:',
    validate: (value) => {
      try {
        validateCourseraUrl(value);
        return true;
      } catch (error) {
        return error instanceof Error ? error.message : 'Please enter a valid https://www.coursera.org/learn/... link.';
      }
    },
  });
}

async function promptForConcurrency(defaultValue = '3'): Promise<number> {
  const value = await input({
    message: `> Maximum parallel downloads (1-${MAX_CONCURRENCY}, default: ${defaultValue}):`,
    default: defaultValue,
    validate: (rawValue) => {
      try {
        parseConcurrencyValue(rawValue);
        return true;
      } catch (error) {
        return error instanceof Error ? error.message : 'Invalid concurrency value.';
      }
    },
  });

  return parseConcurrencyValue(value);
}

async function executeDirectDownload(): Promise<void> {
  console.log(chalk.yellow('\nSecurity and usage posture'));
  console.log(chalk.gray('1. Only access content you are explicitly enrolled in.'));
  console.log(chalk.gray('2. This tool is unofficial and is not affiliated with Coursera.'));
  console.log(chalk.gray(`3. Concurrency is capped at ${MAX_CONCURRENCY} to reduce rate-limit risk.\n`));

  const courseUrl = await promptForUrl();
  const concurrency = await promptForConcurrency();

  console.log();
  const initSpinner = ora({
    text: chalk.blueBright('Initializing browser engine and security checks...'),
    color: 'cyan',
  }).start();

  try {
    initSpinner.stop();
    console.log(chalk.cyan('Security checks passed. Starting single download sequence...\n'));
    await runBatchDownload(courseUrl, concurrency);
    console.log(chalk.green('\nDownload sequence completed successfully.'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (initSpinner.isSpinning) {
      initSpinner.fail(chalk.red('Critical error encountered before the download started.'));
    }

    console.error(chalk.red(`\nDownload failed: ${message}`));
  }
}

async function executeInteractiveQueueAdd(): Promise<void> {
  const queueUrl = await promptForUrl();
  const concurrency = await promptForConcurrency();
  const result = enqueueQueueItem(queueUrl, concurrency);

  if (!result.added && result.existing) {
    console.log(chalk.yellow(`\nSkipped duplicate queue entry: ${result.existing.url}`));
    return;
  }

  if (result.item) {
    console.log(chalk.green(`\nQueued ${result.item.url}`));
    console.log(chalk.gray(`  id: ${result.item.id}`));
    console.log(chalk.gray(`  concurrency: ${result.item.concurrency}`));
  }
}

async function executeInteractiveQueueRemove(): Promise<void> {
  const removableItems = getQueueItems().filter((item) => item.status !== 'running');

  if (removableItems.length === 0) {
    console.log(chalk.gray('\nNo removable queue items are available.\n'));
    return;
  }

  const selectedId = await select({
    message: 'Select a queue item to remove:',
    choices: removableItems.map((item) => ({
      name: `${item.id.slice(0, 8)} | ${item.status} | ${item.url}`,
      value: item.id,
      description: `Concurrency ${item.concurrency}`,
    })),
  });

  const result = removeQueueItem(selectedId);
  if (result.removed && result.item) {
    console.log(chalk.green(`\nRemoved queue item ${result.item.id.slice(0, 8)}.`));
    return;
  }

  console.log(chalk.red('\nThe selected queue item could not be removed.\n'));
}

async function executeQueueRun(): Promise<void> {
  const summary = await runQueue(runBatchDownload, {
    onRecoveredRunningItem: (item) => {
      console.log(chalk.cyan(`Recovered stale running item ${item.id.slice(0, 8)}.`));
    },
    onItemStart: (item, index, total) => {
      console.log(chalk.cyan(`\n[${index}/${total}] Running ${item.url}`));
      console.log(chalk.gray(`  queue id: ${item.id}`));
      console.log(chalk.gray(`  concurrency: ${item.concurrency}`));
    },
    onItemSuccess: (item, index, total) => {
      console.log(chalk.green(`[${index}/${total}] Completed ${item.id.slice(0, 8)}.`));
    },
    onItemFailure: (item, error, index, total) => {
      console.log(chalk.red(`[${index}/${total}] Failed ${item.id.slice(0, 8)}.`));
      console.log(chalk.red(`  ${error}`));
    },
  });

  printQueueSummary(summary);
}

function printCommandUsage(): void {
  console.log('Usage:');
  console.log('  coursera-dl');
  console.log('  coursera-dl queue add <url> [--concurrency N]');
  console.log('  coursera-dl queue run');
  console.log('  coursera-dl queue list');
  console.log('  coursera-dl queue remove <id-or-prefix>');
  console.log('  coursera-dl queue retry-failed');
}

async function handleQueueCommand(args: string[]): Promise<void> {
  const subcommand = args[1];

  switch (subcommand) {
    case 'add': {
      const targetUrl = args[2];

      if (!targetUrl) {
        throw new Error('Usage: coursera-dl queue add <url> [--concurrency N]');
      }

      const concurrency = parseCommandConcurrency(args.slice(3));
      const result = enqueueQueueItem(targetUrl, concurrency);

      if (!result.added && result.existing) {
        console.log(chalk.yellow(`Skipped duplicate queue entry: ${result.existing.url}`));
        return;
      }

      if (result.item) {
        console.log(chalk.green(`Queued ${result.item.url}`));
        console.log(chalk.gray(`id: ${result.item.id}`));
        console.log(chalk.gray(`concurrency: ${result.item.concurrency}`));
      }

      return;
    }

    case 'run':
      await executeQueueRun();
      return;

    case 'list':
      printQueueItems(getQueueItems());
      return;

    case 'remove': {
      const id = args[2];

      if (!id) {
        throw new Error('Usage: coursera-dl queue remove <id>');
      }

      const result = removeQueueItem(id);

      if (result.removed && result.item) {
        console.log(chalk.green(`Removed queue item ${result.item.id}.`));
        return;
      }

      if (result.reason === 'running') {
        throw new Error('Cannot remove a running queue item.');
      }

      if (result.reason === 'ambiguous') {
        const matches = (result.matches ?? []).map((item) => item.id).join(', ');
        throw new Error(`Queue item prefix is ambiguous: ${id}. Matches: ${matches}`);
      }

      throw new Error(`Queue item not found: ${id}`);
    }

    case 'retry-failed': {
      const retried = retryFailedQueueItems();
      if (retried === 0) {
        console.log(chalk.gray('No failed queue items were reset.'));
        return;
      }

      console.log(chalk.green(`Reset ${retried} failed queue item(s) to pending.`));
      return;
    }

    default:
      printCommandUsage();
      throw new Error('Unknown queue subcommand.');
  }
}

async function handleCommandLineMode(args: string[]): Promise<boolean> {
  if (args.length === 0) {
    return false;
  }

  if (args[0] !== 'queue') {
    printCommandUsage();
    throw new Error('Unknown command.');
  }

  await handleQueueCommand(args);
  return true;
}

async function runInteractiveMenu(): Promise<void> {
  for (;;) {
    drawHeader();

    const action = await select({
      message: '> What would you like to do?',
      choices: [
        {
          name: 'Login and Refresh Session',
          value: 'auth',
          description: 'Sign in with your Coursera account and refresh the saved browser session.',
        },
        {
          name: 'Download Course Content',
          value: 'download',
          description: 'Run a single download immediately.',
        },
        {
          name: 'Add Link to Queue',
          value: 'queue_add',
          description: 'Save a course link for later processing.',
        },
        {
          name: 'View Queue',
          value: 'queue_view',
          description: 'See queued, running, completed, and failed items.',
        },
        {
          name: 'Run Queue',
          value: 'queue_run',
          description: 'Process all pending queue items in sequence.',
        },
        {
          name: 'Remove Queue Item',
          value: 'queue_remove',
          description: 'Remove any queued item that is not currently running.',
        },
        {
          name: 'Retry Failed Items',
          value: 'queue_retry',
          description: 'Reset failed items back to pending.',
        },
        {
          name: 'Exit',
          value: 'exit',
        },
      ],
    });

    if (action === 'exit') {
      console.log(chalk.gray('\nGoodbye.\n'));
      return;
    }

    console.log();

    switch (action) {
      case 'auth':
        await executeAuthentication();
        await pauseForMenu();
        break;
      case 'download':
        await executeDirectDownload();
        await pauseForMenu();
        break;
      case 'queue_add':
        await executeInteractiveQueueAdd();
        await pauseForMenu();
        break;
      case 'queue_view':
        printQueueItems(getQueueItems());
        await pauseForMenu();
        break;
      case 'queue_run':
        await executeQueueRun();
        await pauseForMenu();
        break;
      case 'queue_remove':
        await executeInteractiveQueueRemove();
        await pauseForMenu();
        break;
      case 'queue_retry': {
        const retried = retryFailedQueueItems();

        if (retried === 0) {
          console.log(chalk.gray('No failed queue items were reset.'));
          await pauseForMenu();
          break;
        }

        console.log(chalk.green(`Reset ${retried} failed queue item(s) to pending.`));
        const shouldRunNow = await select({
          message: 'Start the queue now?',
          choices: [
            { name: 'Yes, run queue now', value: true },
            { name: 'No, return to menu', value: false },
          ],
        });

        if (shouldRunNow) {
          await executeQueueRun();
        }

        await pauseForMenu();
        break;
      }
      default:
        break;
    }
  }
}

async function main(): Promise<void> {
  const handledAsCommand = await handleCommandLineMode(process.argv.slice(2));

  if (!handledAsCommand) {
    await runInteractiveMenu();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.bgRed.white('\n FATAL ERROR '), message);
  process.exit(1);
});
