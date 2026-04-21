import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

async function test() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ storageState: 'auth.json' });
  const page = await context.newPage();

  const apiEndpoints = new Set<string>();

  page.on('response', async res => {
    if (res.url().includes('/api/')) {
      const u = new URL(res.url());
      apiEndpoints.add(u.pathname);
    }
  });

  console.log('Navigating...');
  await page.goto('https://www.coursera.org/learn/algebra-ii/home/module/1', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  fs.writeFileSync('api-endpoints.txt', Array.from(apiEndpoints).join('\n'));
  console.log('Done mapping APIs. Logged to api-endpoints.txt');

  const html = await page.content();
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (nextDataMatch) {
    fs.writeFileSync('next-data.json', nextDataMatch[1]);
    console.log('Extracted __NEXT_DATA__ state.');
  }

  const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*({.*?});/s);
  if (apolloMatch) {
    fs.writeFileSync('apollo-state.json', apolloMatch[1]);
    console.log('Extracted __APOLLO_STATE__');
  }

  await browser.close();
}

test().catch(console.error);
