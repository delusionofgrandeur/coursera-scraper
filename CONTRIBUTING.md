# Contributing to Coursera CLI Downloader

First off, thank you for considering contributing to the project! It's people like you that make Coursera CLI Downloader such a great tool.

## How Can I Contribute?

### Reporting Bugs
If you find a bug, please create an issue on GitHub. Include:
* Your OS and Node.js version.
* Details on the course/URL you were trying to download so we can reproduce it.
* A snippet of the terminal output when the error occurred.

### Suggesting Enhancements
Feature requests are always welcome. Create an issue and detail what you would like to see changed or added. Better yet, submit a Pull Request!

### Your First Pull Request
1. Fork the repo and create your branch from `main`.
2. Make sure you use Node.js version 18 or higher.
3. Install dependencies with `npm install`.
4. Make your code changes. Use `npm run build` to ensure Typescript compiles successfully.
5. Format your code (Prettier and ESLint is included in the project files).
6. Issue that pull request!

### Code Guidelines
* This project favors async/await over promises.
* Prefer Playwright configurations that mimic realistic browser signatures to bypass scraping blocks.
* Document any new CLI arguments clearly in the `README.md`.
