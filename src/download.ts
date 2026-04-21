import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// Helper to download a file
const downloadFile = (url: string, dest: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
};

async function runDownloader() {
  const authPath = path.join(process.cwd(), 'auth.json');
  if (!fs.existsSync(authPath)) {
    console.error('HATA: auth.json bulunamadı. Lütfen önce "npm run auth" komutunu çalıştırarak giriş yapın.');
    process.exit(1);
  }

  // Take URL from command line or use a default one for test
  const targetUrl = process.argv[2];
  if (!targetUrl) {
    console.error('HATA: Lütfen indireceğiniz kursun linkini gönderin.');
    console.log('Kullanım: npm run download "https://www.coursera.org/learn/KURS_ADI"');
    process.exit(1);
  }

  console.log('Starting headless browser with saved auth state...');
  const browser = await chromium.launch({ headless: true });
  // Load saved state
  const context = await browser.newContext({ storageState: authPath });
  const page = await context.newPage();

  console.log(`Navigating to ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  // Example extraction logic (Will adapt to Coursera's enrolled view)
  // Typically, a user would go to targetUrl (e.g. /learn/python/home/welcome)
  console.log('Sayfa yüklendi, kurs içeriği analiz ediliyor...');

  // Create downloads directory
  const courseSlug = new URL(targetUrl).pathname.split('/')[2] || 'course';
  const downloadDir = path.join(process.cwd(), 'downloads', courseSlug);
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  console.log(`\nİndirme klasörü: ${downloadDir}\n`);

  try {
    // Find week links
    // Often week links are in nav menus matching `/learn/SLUG/home/week/X`
    const weekLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        return links
            .map(a => a.href)
            .filter(href => href.includes('/home/week/'))
            .filter((v, i, a) => a.indexOf(v) === i); // unique
    });

    if (weekLinks.length === 0) {
        console.log('Uyarı: Sayfada hafta (week) linkleri bulunamadı. Lütfen URL\'nin kayıtlı olduğunuz bir kursun "home/welcome" sayfası olduğundan emin olun.');
        console.log('Yine de sayfadaki modülleri aramaya çalışıyorum...');
    } else {
        console.log(`Toplam ${weekLinks.length} hafta bulundu. Gerekli dosyalar toplanıyor...`);
    }

    // Since a full crawl takes a very long time, for this boilerplate we'll just demonstrate fetching the current page's items
    // and if standard items are found, we'll "download" them.
    const items = await page.evaluate(() => {
        const itemLinks = Array.from(document.querySelectorAll('a'));
        return itemLinks
            .map(a => a.href)
            .filter(href => href.includes('/lecture/') || href.includes('/supplement/'))
            .filter((v, i, a) => a.indexOf(v) === i);
    });

    console.log(`Şu anki sayfada ${items.length} ders materyali bulundu.`);

    for (let i = 0; i < items.length; i++) {
        const itemUrl = items[i];
        console.log(`\n[${i+1}/${items.length}] Gidiliyor: ${itemUrl}`);
        await page.goto(itemUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000); // Wait for video or text to render

        if (itemUrl.includes('/lecture/')) {
            // Lecture = Video
            const videoSrc = await page.evaluate(() => {
                const videoTag = document.querySelector('video source');
                return videoTag ? (videoTag as HTMLSourceElement).src : null;
            });

            if (videoSrc) {
                const title = await page.title();
                const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                const filePath = path.join(downloadDir, `${safeTitle}.mp4`);
                console.log(`Video bulundu, indiriliyor: ${filePath}`);
                
                // UNCOMMENT to actually download 
                // await downloadFile(videoSrc, filePath);
                console.log(`--> (Test modu) İndirme simüle edildi.`);
            } else {
                console.log('Video tagi bulunamadı. (Belki sayfa geç yüklendi veya video yok)');
            }
        } 
        else if (itemUrl.includes('/supplement/')) {
            // Supplement = Reading
            const readingText = await page.evaluate(() => {
                const content = document.querySelector('#main, [data-e2e="ReadingItem"]');
                return content ? (content as HTMLElement).innerText : 'İçerik bulunamadı';
            });

            const title = await page.title();
            const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const filePath = path.join(downloadDir, `${safeTitle}.txt`);
            
            console.log(`Okuma metni bulundu, kaydediliyor: ${filePath}`);
            fs.writeFileSync(filePath, readingText, 'utf-8');
        }
    }

  } catch (error) {
    console.log('Kurs tarama sırasında bir hata oluştu:', error);
  }

  console.log('\nİşlem tamamlandı.');
  await browser.close();
}

runDownloader().catch((err) => {
  console.error('An error occurred during downloading:', err);
  process.exit(1);
});
