# coursera-scraper

A CLI for locally exporting Coursera course materials you are already authorized to access.

This project is unofficial and provided for educational and personal offline-use scenarios only.
This project is not affiliated with, endorsed by, or sponsored by Coursera.

## Security posture

- Session state is stored outside the repository in `~/.coursera-scraper/auth.json`.
- Downloaded filenames and folders are sanitized before being written to disk.
- Downloads are restricted to `https://` URLs, block localhost/private-network targets, cap redirects, and enforce a 2 GB per-file limit.
- Parallel downloads are capped to reduce accidental rate spikes.

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

## Responsible use

- Only access content you are enrolled in and legally allowed to download.
- Use this repository for educational research and personal offline access workflows only.
- Do not commit `auth.json`, exported course files, screenshots, or debug dumps.
- Review [SECURITY.md](SECURITY.md) before opening issues that may involve sensitive data.

## Open source caveats

The repository is technically safer after hardening, but publishing a public downloader for a proprietary learning platform can still carry policy, copyright, and trademark risk. Before making the repository public, review:

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
