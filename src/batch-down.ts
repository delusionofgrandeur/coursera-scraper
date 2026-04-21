import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import * as https from 'https';
import pLimit from 'p-limit';
import cliProgress from 'cli-progress';

const downloadFile = (url: string, dest: string, bar: cliProgress.SingleBar | null = null): Promise<void> => {
  return new Promise((resolve, reject) => {
    const doReq = (reqUrl: string) => {
      https.get(reqUrl, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return doReq(response.headers.location); // Follow redirects
        }
        
        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        if (bar && totalSize) {
          bar.start(totalSize, 0, { speed: '0 MB/s' });
        }
        
        let downloaded = 0;
        let lastTime = Date.now();
        let lastDownloaded = 0;
        const file = fs.createWriteStream(dest);

        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (bar && totalSize) {
            const now = Date.now();
            if (now - lastTime >= 500) {
              const speed = ((downloaded - lastDownloaded) / (now - lastTime)) * 1000;
              const mbps = (speed / (1024 * 1024)).toFixed(2);
              bar.update(downloaded, { speed: `${mbps} MB/s` });
              lastTime = now;
              lastDownloaded = downloaded;
            } else {
              bar.update(downloaded); // Update pure chunks without speed jitter
            }
          }
        });

        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          if (bar) {
            bar.update(totalSize || downloaded);
            bar.stop();
          }
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        if (bar) bar.stop();
        reject(err);
      });
    };
    doReq(url);
  });
};

export async function runBatchDownload(targetUrl: string, concurrency: number = 3) {
  const configDir = path.join(os.homedir(), '.coursera-scraper');
  const authPath = path.join(configDir, 'auth.json');
  if (!fs.existsSync(authPath)) {
    throw new Error(chalk.red('HATA: auth.json bulunamadı. Lütfen önce "Oturum Aç" işlemini gerçekleştirin.'));
  }

  console.log(chalk.cyanBright('\n[API] Tarayıcı Context Başlatılıyor...'));
  const browser = await chromium.launch({ 
    headless: true,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({ storageState: authPath });

  // 1. Fetching all items fast
  console.log('[API] Modül Haritası Çıkartılıyor (Sayfa Yükleniyor)...');
  const indexPage = await context.newPage();
  
  // Go to the URL
  await indexPage.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await indexPage.waitForTimeout(4000);

  // Finding all weeks or directly finding lecture links if user provided a specific week
  const initialUrl = indexPage.url();
  if (targetUrl.includes('/home/') && !initialUrl.includes('/home/')) {
    console.log('\n❌ KRİTİK HATA: Coursera sayfayı yönlendirdi!');
    console.log(`Gitmeye çalıştığınız: ${targetUrl}`);
    console.log(`Gittiğimiz: ${initialUrl}`);
    console.log('\n--- NEDEN OLDU? ---');
    console.log('1. Bu kursa hesabınız üzerinden kayıt(Enroll) olmadınız.');
    console.log('2. Kendi tarayıcınızdan kayıt oldunuz ancak programın kullandığı "auth.json" çerez (cookie) dosyası eski kaldı!');
    console.log('\n👉 ÇÖZÜM: Lütfen programı kapatıp terminale "npm run auth" yazarak sisteme bir kere daha girip oturumunuzu (çerezleri) tazeleyin!\n');
    await browser.close();
    return;
  }

  interface CourseItem {
    url: string;
    folderName: string;
    order: number;
  }

  const weekLinks = await indexPage.evaluate(() => {
    return Array.from(document.querySelectorAll('a'))
      .map(a => a.href)
      .filter(href => href.includes('/home/week/') || href.includes('/home/module/'))
      .filter((v, i, a) => a.indexOf(v) === i); // unique
  });

  const allItems: CourseItem[] = [];

  if (weekLinks.length === 0) {
    // If specific video/reading is given
    const directItems = await indexPage.evaluate(() => {
      return Array.from(document.querySelectorAll('a'))
        .map(a => a.href)
        .filter(href => href.includes('/lecture/') || href.includes('/supplement/') || href.includes('/item/'))
        .filter((v, i, a) => a.indexOf(v) === i);
    });
    
    let orderIndex = 1;
    for (const url of directItems) {
      allItems.push({ url, folderName: 'Bagimsiz_Icerikler', order: orderIndex++ });
    }
    
    console.log('Uyarı: Sayfada birden fazla haftaya ait link bulunamadı.');
    console.log('Bu normal olabilir (Eğer direkt bir videonun veya belli bir haftanın linkini verdiyseniz).');
  } else {
    console.log(`Toplam ${weekLinks.length} farklı hafta tespit edildi. Tüm haftalar taranarak indeksleniyor...`);
    
    let weekCount = 1;
    for (const weekUrl of weekLinks) {
      if (weekUrl !== indexPage.url()) {
        await indexPage.goto(weekUrl, { waitUntil: 'networkidle', timeout: 60000 });
        await indexPage.waitForTimeout(3000); // Render beklemesi
      }
      
      const folderName = `Hafta_${weekCount.toString().padStart(2, '0')}`;
      
      // Try to get item titles from the DOM directly to ensure exact sequence matching, but fallback to just href extraction
      const items = await indexPage.evaluate(() => {
        return Array.from(document.querySelectorAll('a'))
          .map(a => a.href)
          .filter(href => href.includes('/lecture/') || href.includes('/supplement/') || href.includes('/item/'))
          .filter((v, i, a) => a.indexOf(v) === i);
      });

      let orderIndex = 1;
      for (const url of items) {
        allItems.push({ url, folderName, order: orderIndex++ });
      }
      
      weekCount++;
    }
  }

  await indexPage.close();

  // Deduplicate items maintaining their categorized structure
  const uniqueItemsMap = new Map<string, CourseItem>();
  for (const item of allItems) {
    if (!uniqueItemsMap.has(item.url)) {
      uniqueItemsMap.set(item.url, item);
    }
  }
  const uniqueItems = Array.from(uniqueItemsMap.values());
  
  console.log(`\n✅ Harita Hazır! Modüllere ayrılmış toplam ${uniqueItems.length} ders içeriği bulundu.\n`);

  if (uniqueItems.length === 0) {
    console.log('İndirilecek içerik bulunamadı. Bağlantınızı kontrol edin.');
    await browser.close();
    return;
  }

  // Setup Progress bar
  const multibar = new cliProgress.MultiBar({
    clearOnComplete: false,
    hideCursor: true,
    format: '{filename} | {bar} | {percentage}% | {value}/{total} bytes | Hız: {speed} | ETA: {eta}s',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
  }, cliProgress.Presets.shades_classic);

  // Main task bar
  const mainBar = multibar.create(uniqueItems.length, 0, { 
    filename: '🎯 GENEL İLERLEME'.padEnd(30, ' '),
    speed: '-',
    value: 0,
    total: uniqueItems.length
  });
  
  // Custom format specifically for main bar to override bytes with tasks
  (mainBar as any).format = '{filename} | {bar} | {percentage}% | {value}/{total} Görev | ETA: {eta}s';

  const courseSlug = new URL(targetUrl).pathname.split('/')[2] || 'course';
  const downloadDir = path.join(process.cwd(), 'downloads', courseSlug);

  // Setup concurrent limiter
  const limit = pLimit(concurrency);

  const fetchItemTask = async (item: CourseItem) => {
    const page = await context.newPage();
    try {
      // Create specific category directory
      const itemDir = path.join(downloadDir, item.folderName);
      if (!fs.existsSync(itemDir)) fs.mkdirSync(itemDir, { recursive: true });

      // 1. Set up API Interception BEFORE navigation (Professional XHR sniff)
      const videoApiPromise = page.waitForResponse(
        (res) => res.url().includes('onDemandLectureVideos.v1') || res.url().includes('onDemandVideos.v1'),
        { timeout: 15000 }
      ).catch(() => null);

      await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000); // IMPORTANT: Give React/Apollo time to render supplements
      
      let pageTitle = await page.title();
      // Clean Coursera suffix
      pageTitle = pageTitle.replace(' | Coursera', '');
      const safeTitle = pageTitle.replace(/[^a-z0-9ğüşıöç]/gi, '_').toLowerCase();
      
      const fileNamePrefix = `${String(item.order).padStart(2, '0')}_${safeTitle.substring(0, 50)}`;

      if (item.url.includes('/lecture/') || item.url.includes('/item/')) {
        let videoSrc: string | null = null;

        // Try getting video from intercepted API (Fast & Reliable)
        const videoResponse = await videoApiPromise;
        if (videoResponse && videoResponse.ok()) {
          try {
            const data = await videoResponse.json();
            // Try to recursively find a string containing .mp4
            const findMp4 = (obj: any): string | null => {
              if (typeof obj === 'string' && obj.includes('.mp4') && obj.startsWith('http')) return obj;
              if (typeof obj === 'object' && obj !== null) {
                for (const key of Object.keys(obj)) {
                  const result = findMp4(obj[key]);
                  if (result) return result;
                }
              }
              return null;
            };
            videoSrc = findMp4(data);
          } catch (e) {
            // ignore API json parse error
          }
        }

        // 2. Try Apollo State (Backup API data already in page memory)
        if (!videoSrc) {
          videoSrc = await page.evaluate(() => {
            if (typeof window !== 'undefined' && (window as any).__APOLLO_STATE__) {
              const apollo = (window as any).__APOLLO_STATE__;
              const jsonStr = JSON.stringify(apollo);
              const match = jsonStr.match(/https:\/\/[^"']+\.mp4[^"']*/);
              if (match) return match[0];
            }
            return null;
          });
        }

        // 3. Try DOM Parsing (Legacy fallback)
        if (!videoSrc) {
          videoSrc = await page.evaluate(() => {
            const video = document.querySelector('video');
            if (video && video.src && video.src.includes('mp4')) return video.src;
            const source = document.querySelector('video source[type="video/mp4"]');
            return source ? (source as HTMLSourceElement).src : null;
          });
        }

        if (videoSrc) {
          const filePath = path.join(itemDir, `${fileNamePrefix}.mp4`);
          // Create a specific bar for this file
          const label = fileNamePrefix.substring(0, 27).padEnd(30, ' ');
          const fileBar = multibar.create(100, 0, { filename: `▶ ${label}`, speed: '0 MB/s' });
          await downloadFile(videoSrc, filePath, fileBar);
        } else {
          // If a video page explicitly has no video, we store a note
          const filePath = path.join(itemDir, `${fileNamePrefix}.txt`);
          fs.writeFileSync(filePath, "Video linki yakalanamadı veya API reddedildi.", 'utf-8');
        }
      } else if (item.url.includes('/supplement/')) {
        const readingText = await page.evaluate(() => {
          const content = document.querySelector('.rc-CML, .rc-ReadingItem, #main, [data-e2e="ReadingItem"]');
          return content ? (content as HTMLElement).innerText : '';
        });
        if (readingText) {
          const filePath = path.join(itemDir, `${fileNamePrefix}.txt`);
          fs.writeFileSync(filePath, readingText, 'utf-8');
        }
      }
    } catch (e) {
      // ignore
    } finally {
      mainBar.increment();
      await page.close();
    }
  };

  const tasks = uniqueItems.map(item => limit(() => fetchItemTask(item)));
  await Promise.all(tasks);

  multibar.stop();
  console.log('\n🎉 Bütün indirmeler tamamlandı!');
  await browser.close();
}
