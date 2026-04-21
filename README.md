<p align="center">
  <img src="https://upload.wikimedia.org/wikipedia/commons/e/e5/Coursera_logo.svg" alt="Coursera Logo" width="300" />
</p>

<h1 align="center">Coursera CLI Downloader 🚀</h1>

<p align="center">
  <strong>Fast, concurrent, API-driven Coursera course downloader with progress bars.</strong>
  <br>
  <a href="https://github.com/delusionofgrandeur/coursera-scraper/issues">Report Bug</a>
  ·
  <a href="https://github.com/delusionofgrandeur/coursera-scraper/issues">Request Feature</a>
</p>

---

## ⚡ Features

- **Blazing Fast**: Uses `p-limit` and Node streams for parallel downloading (up to X active connections).
- **Apollo State & API Interception**: Bypasses basic DOM scraping limitations by fetching directly from Coursera's Apollo state and internal APIs.
- **Auto Hierarchy Organization**: Files are grouped neatly under `downloads/COURSE_NAME/Week_XX/01_module_name.mp4`.
- **Text & Readings Extraction**: Converts text-based lectures (`rc-CML`) to `.txt` files directly.
- **Beautiful CLI Experience**: Uses `cli-progress`, `@inquirer/prompts`, and `chalk` for a visually pleasing menu and multi-bar progress tracker (including real-time ETA & Mbps speeds).
- **HTTP 302 Redirect Support**: Automatically resolves secure AWS S3 / Cloudfront redirects for video files.

---

## 🛠 Prerequisites

- Node.js (v18 or higher)
- NPM

## 📦 Installation

To install globally on your machine:
```bash
npm install -g coursera-scraper
```

*Note: You may need to run `npx playwright install chrome` on first setup to download the headless browser drivers.*

## 🚀 Usage

Simply run the following command anywhere in your terminal:
```bash
coursera-dl
```

**Workflow:**
1. Select **"🔑 Oturum Aç (Login)"** from the interactive menu. A browser will open for you to log into Coursera.
2. Select **"⚡ Batch İndirme Başlat"** to begin downloading.
3. Paste the URL of your enrolled course (e.g., `https://www.coursera.org/learn/algebra/home/welcome`). You can also paste specific week links or video URLs.

> **Note:** The authentication session is saved to `~/.coursera-scraper/auth.json`. You only need to log in once!

## ⚙️ How It Works
1. Identifies the `__APOLLO_STATE__` to find the exact structure (modules, item IDs, types).
2. Intercepts Coursera's `onDemandLectureVideos.v1` API to gather MP4 links.
3. Renders and extracts textual information via Playwright for reading assignments.

---

## 🤝 Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests to us.

---

## ⚠️ Disclaimer & Legal

This tool is strictly provided for **personal, offline educational use and backup purposes only**. Downloading content you do not own or have rights to may violate the [Coursera Terms of Service](https://www.coursera.org/about/terms). The authors of this script hold no liability for how it is used. **Use at your own risk.**

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
