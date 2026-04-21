#!/usr/bin/env node
import { select, input } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { authenticate } from './auth.js';
import { runBatchDownload } from './batch-down.js';
import { MAX_CONCURRENCY, validateCourseraUrl } from './security.js';

// ASCII Header Configuration
const drawHeader = () => {
  console.clear();
  console.log();
  console.log(chalk.bold.hex('#0056D2')(' ╭───────────────────────────────────────────────────╮'));
  console.log(chalk.bold.hex('#0056D2')(' │ ') + chalk.bgHex('#0056D2').white.bold('              COURSERA DOWNLOADER              ') + chalk.bold.hex('#0056D2')(' │'));
  console.log(chalk.bold.hex('#0056D2')(' ╰───────────────────────────────────────────────────╯'));
  console.log(chalk.dim('   An unofficial, high-performance offline learning tool\n'));
};

async function main(): Promise<void> {
  drawHeader();

  const action = await select({
    message: chalk.magenta('◈') + ' What would you like to do?',
    choices: [
      {
        name: 'Login & Refresh Session',
        value: 'auth',
        description: 'Sign in with your Coursera account to capture a browser session cookies.',
      },
      {
        name: 'Download Course Content',
        value: 'download',
        description: 'Provide a course URL to download all available video and text modules.',
      },
      {
        name: 'Exit',
        value: 'exit',
      },
    ],
  });

  if (action === 'exit') {
    console.log(chalk.gray('\n» Goodbye. ✨\n'));
    process.exit(0);
  }

  if (action === 'auth') {
    console.log();
    const spinner = ora({
      text: chalk.blueBright('Starting secure browser for authentication...'),
      color: 'cyan',
    }).start();

    try {
      spinner.stop(); // Stop before launching browser so it doesn't collide
      await authenticate();
      console.log();
      spinner.succeed(chalk.green('Session tokens successfully updated and saved locally.'));
    } catch {
      console.log();
      spinner.fail(chalk.red('Authentication flow was interrupted or failed.'));
    }

    // Brief pause to read
    await new Promise((r) => setTimeout(r, 1500));
    await main();
    return;
  }

  console.log(chalk.yellow('\n⚠ Security & Usage Posture'));
  console.log(chalk.dim('│ ') + chalk.gray('1. Only access content you are explicitly enrolled in.'));
  console.log(chalk.dim('│ ') + chalk.gray('2. This tool is fully unofficial and not affiliated with Coursera.'));
  console.log(chalk.dim('│ ') + chalk.gray(`3. Concurrency is rigidly capped at ${MAX_CONCURRENCY} to prevent rate limit bans.`));
  console.log('');

  const courseUrl = await input({
    message: chalk.blueBright('❯') + ' Enter Course, Module, or Video URL:',
    validate: (value) => {
      try {
        validateCourseraUrl(value);
        return true;
      } catch (error) {
        return error instanceof Error ? error.message : 'Please enter a valid https://www.coursera.org/learn/... link.';
      }
    },
  });

  const activeConcurrent = await input({
    message: chalk.blueBright('❯') + ` Maximum parallel downloads (1-${MAX_CONCURRENCY}, default: 3):`,
    default: '3',
    validate: (value) => {
      const numericValue = Number(value);
      if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > MAX_CONCURRENCY) {
        return `Please specify a whole number between 1 and ${MAX_CONCURRENCY}.`;
      }
      return true;
    },
  });

  console.log('');
  const initSpinner = ora({ text: chalk.blueBright('Initializing browser engine & security checks...'), color: 'cyan' }).start();

  try {
    initSpinner.succeed(chalk.green('Engine fully initialized. Booting batch protocols.'));
    await runBatchDownload(courseUrl, Number(activeConcurrent));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    initSpinner.fail(chalk.red('Critical error encountered starting batch sequence.'));
    console.error(chalk.redBright('\n✘ ' + message));
  }

  console.log();
  const again = await select({
    message: chalk.magenta('◈') + ' Sequence complete. Do you want to return to the main menu?',
    choices: [
      { name: 'Yes, back to main', value: true },
      { name: 'No, exit terminal', value: false },
    ],
  });

  if (again) {
    await main();
  }
}

main().catch((error) => {
  console.error(chalk.bgRed.white('\n FATAL ERROR '), error);
  process.exit(1);
});
