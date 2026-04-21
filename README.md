<p align="center">
  <img src="https://upload.wikimedia.org/wikipedia/commons/e/e5/Coursera_logo.svg" alt="Coursera Logo" width="300" />
</p>

<h1 align="center">coursera-scraper 🚀</h1>

<p align="center">
  <strong>An unofficial Coursera scraper/downloader CLI for Node.js.</strong>
</p>

<p align="center">
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 18+"></a>
  <a href="https://playwright.dev"><img src="https://img.shields.io/badge/Playwright-Enabled-2EAD33?style=for-the-badge&logo=playwright&logoColor=white" alt="Playwright"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-Ready-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://github.com/your-username/coursera-scraper/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-800080?style=for-the-badge" alt="License"></a>
</p>

<hr>

> ⚠️ **Disclaimer:** This project is **not affiliated with, endorsed by, or sponsored by Coursera**.

It uses a locally saved Coursera session, validates `coursera.org/learn/...` URLs, discovers course/module/lesson links, extracts video or reading content, and writes the results to local `downloads/` folders. Internally, it uses Playwright for browser-driven login, navigation, and response interception.

## Requirements

- Node.js 18+
- Google Chrome installed for Playwright's `channel: "chrome"` launch mode

## Install

Install from npm:

```bash
npm install -g coursera-scraper
npx playwright install chrome
```

Install from source:

```bash
npm install
npx playwright install chrome
npm run build
```

## Usage

Start the interactive CLI:

```bash
coursera-dl
```

When running from a source checkout:

```bash
npm run cli
```

Or use the direct download entry point:

```bash
npm run download "https://www.coursera.org/learn/course-slug/home/welcome"
```

## Security posture

- Session state is stored outside the repository in `~/.coursera-scraper/auth.json`.
- Downloaded filenames and folders are sanitized before being written to disk.
- Downloads are restricted to `https://` URLs, block localhost/private-network targets, cap redirects, and enforce a 2 GB per-file limit.
- Parallel downloads are capped to reduce accidental rate spikes.

## Responsible use

- Only access content you are enrolled in and allowed to access.
- Do not commit `auth.json`, screenshots, course exports, or debug dumps.
- Check [SECURITY.md](SECURITY.md) before opening issues.

## Open source caveats

The repository is technically safer after hardening, but publishing a public downloader for a proprietary learning platform can still carry policy, copyright, and trademark risk. This README does not hide this fact. Before making the repository public, review:

- Coursera Terms of Use
- any local copyright exceptions or fair-use assumptions you are relying on
- whether the project name and README wording imply affiliation

## Development

```bash
npm run scan:sensitive
npm run lint
npm run build
npm run audit:prod
```

## License

MIT. See [LICENSE](LICENSE).
