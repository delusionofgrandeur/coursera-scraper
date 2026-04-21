import { chromium } from 'playwright';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import fs from 'fs';
import chalk from 'chalk';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query: string): Promise<string> => {
  return new Promise(resolve => rl.question(query, resolve));
};

export async function authenticate() {
  console.log('Starting headed browser for authentication...');
  
  // Launch the browser using the globally installed Chrome to bypass Google's "browser not secure" blockage
  const browser = await chromium.launch({ 
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(chalk.cyan('Navigating to Coursera login...'));
  await page.goto('https://www.coursera.org/?authMode=login', { waitUntil: 'domcontentloaded' });

  console.log('====================================================');
  console.log('LÜTFEN AÇILAN TARAYICIDA COURSERA HESABINIZA GİRİŞ YAPIN.');
  console.log('Giriş yaptıktan ve anasayfa yüklendikten sonra...');
  console.log('====================================================');

  await askQuestion('GİRİŞİ TAMAMLADIKTAN SONRA ENTER TUŞUNA BASIN: ');

  const configDir = path.join(os.homedir(), '.coursera-scraper');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  const authPath = path.join(configDir, 'auth.json');
  
  console.log('Oturum bilgileriniz kaydediliyor...');
  await context.storageState({ path: authPath });

  console.log(`Bitti! Oturum bilgileri ${authPath} adresine kaydedildi.`);
  console.log('Artık indirme scriptini kapatmadan çalıştırabilirsiniz.');

  await browser.close();
  rl.close();
}

