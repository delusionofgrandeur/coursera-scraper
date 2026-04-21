# coursera-scraper

An unofficial Coursera scraper/downloader CLI for Node.js.

This project is not affiliated with, endorsed by, or sponsored by Coursera.

It uses a locally saved Coursera session, validates `coursera.org/learn/...` URLs, discovers course/module/lesson links, extracts video or reading content, and writes the results to local `downloads/` folders. Internally, it uses Playwright for browser-driven login, navigation, and response interception.

## Requirements

- Node.js 18+
- Google Chrome installed for Playwright's `channel: "chrome"` launch mode

## Install

```bash
npm install
npx playwright install chrome
npm run build
```

## Usage

Start the interactive CLI:

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
