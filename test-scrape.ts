import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function diagnose() {
  const authPath = path.join(process.cwd(), 'auth.json');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ storageState: authPath });
  const page = await context.newPage();

  const url = 'https://www.coursera.org/learn/algebra-ii/home/welcome';
  console.log(`Diagnostic: navigating to ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  const finalUrl = page.url();
  console.log('Final URL resolved to:', finalUrl);

  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).map(a => a.href);
  });
  
  fs.writeFileSync('diagnostic_links.txt', links.join('\n'));
  console.log(`Extracted ${links.length} links. Saved to diagnostic_links.txt`);
  
  // also take a screenshot
  await page.screenshot({ path: 'diagnostic_screenshot.png' });
  console.log('Saved screenshot to diagnostic_screenshot.png');

  await browser.close();
}

diagnose().catch(err => console.error(err));
