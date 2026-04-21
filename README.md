<p align="center">
  <img src="https://readme-typing-svg.herokuapp.com?font=Fira+Code&weight=700&size=45&pause=1000&color=0056D2&center=true&vCenter=true&width=600&height=100&lines=Coursera+CLI;Offline+Learning;Batch+Downloader" alt="Typing SVG Banner" />
</p>

<h1 align="center">coursera-scraper 🚀</h1>

<p align="center">
  <strong>An unofficial Coursera scraper/downloader CLI for Node.js.</strong>
</p>

<p align="center">
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 20+"></a>
  <a href="https://playwright.dev"><img src="https://img.shields.io/badge/Playwright-Enabled-2EAD33?style=for-the-badge&logo=playwright&logoColor=white" alt="Playwright"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-Ready-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://github.com/your-username/coursera-scraper/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-800080?style=for-the-badge" alt="License"></a>
</p>

<hr>

> ⚠️ **Disclaimer:** This project is **not affiliated with, endorsed by, or sponsored by Coursera**.

It uses a locally saved Coursera session, validates `coursera.org/learn/...` URLs, discovers course/module/lesson links, extracts video or reading content, and writes the results to local `downloads/` folders. Internally, it uses Playwright for browser-driven login, navigation, and response interception.

## Requirements

- Node.js 20+
- Google Chrome installed for Playwright's `channel: "chrome"` launch mode

## Install

### Install from npm

1. Install the CLI globally:

```bash
npm install -g coursera-scraper
```

2. Install the Chrome browser that Playwright will launch:

```bash
npx -y playwright install chrome
```

3. Start the CLI:

```bash
coursera-dl
```

### Install from source

1. Install project dependencies:

```bash
npm install
```

2. Install the Chrome browser that Playwright will launch:

```bash
npx playwright install chrome
```

3. Build the TypeScript sources:

```bash
npm run build
```

4. Start the CLI:

```bash
npm run cli
```

## First run

1. Run the CLI:

```bash
coursera-dl
```

2. Choose the authentication flow when prompted and sign in through the opened browser.

3. After login, run the CLI again and paste a course URL such as:

```bash
https://www.coursera.org/learn/course-slug/home/welcome
```

4. The downloader will save output under the local `downloads/` folder.

## Usage

Interactive CLI:

```bash
coursera-dl
```

Interactive CLI from a source checkout:

```bash
npm run cli
```

Direct download entry point from a source checkout:

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
