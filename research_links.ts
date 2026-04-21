import { chromium } from 'playwright';
import path from 'path';

async function research() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ storageState: 'auth.json' });
  const page = await context.newPage();

  console.log('Navigating to algebra-ii/home/module/1...');
  await page.goto('https://www.coursera.org/learn/algebra-ii/home/module/1', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  const url = page.url();
  console.log('Final URL:', url);
  
  if (url !== 'https://www.coursera.org/learn/algebra-ii/home/module/1') {
    console.log('WARNING: The page redirected! This means the user is STILL not enrolled in the eyes of auth.json!');
  }

  // Find any text related to lessons
  const content = await page.evaluate(() => {
    // try to find all elements with role="link" or a tags
    const links = Array.from(document.querySelectorAll('a, [role="link"], [data-track-component]'));
    return links.map(l => {
      const href = (l as HTMLAnchorElement).href || '';
      const text = (l as HTMLElement).innerText || '';
      const dataLabel = l.getAttribute('data-track-component') || '';
      return { tag: l.tagName, href, text: text.trim().substring(0, 50), dataLabel };
    }).filter(l => l.href.includes('lecture') || l.href.includes('item') || l.href.includes('module') || l.href.includes('week') || l.text.includes('Video') || l.text.includes('Reading'));
  });

  console.log('Found syllabus-like items:', content);

  await browser.close();
}

research().catch(console.error);
