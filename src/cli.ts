#!/usr/bin/env node
import { select, input } from '@inquirer/prompts';
import { runBatchDownload } from './batch-down.js';
import { authenticate } from './auth.js';
import chalk from 'chalk';
import * as path from 'path';

async function main() {
  console.clear();
  console.log(chalk.blue.bold('================================='));
  console.log(chalk.cyan.bold('   Coursera CLI Downloader 🚀'));
  console.log(chalk.blue.bold('=================================\n'));

  const action = await select({
    message: 'Ne yapmak istersiniz?',
    choices: [
      {
        name: '🔑 Oturum Aç (Login)',
        value: 'auth',
        description: 'Coursera hesabınıza giriş yapın.',
      },
      {
        name: '⚡ Batch İndirme Başlat',
        value: 'download',
        description: 'Paralel motor kullanarak bir kursu çok hızlı indirin.',
      },
      {
        name: '❌ Çıkış',
        value: 'exit',
      },
    ],
  });

  if (action === 'exit') {
    console.log('Görüşmek üzere!');
    process.exit(0);
  }

  if (action === 'auth') {
    // Calling the auth script synchronously
    console.log(chalk.yellow('\n--- Oturum Açma Modülü Başlatılıyor ---'));
    try {
      await authenticate();
    } catch (e) {
      console.error(chalk.red('Oturum açma başarısız oldu veya iptal edildi.'));
    }
    
    // Restart menu after auth
    await main();
  }

  if (action === 'download') {
    const defaultUrl = 'https://www.coursera.org/learn/EĞİTİM_ADI/home/welcome';
    console.log(chalk.yellow('\n--- BİLGİLENDİRME (LÜTFEN OKUYUN) ---'));
    console.log(chalk.gray('1. İçeriklerin bulunabilmesi için kursa KESİNLİKLE "Enroll / Kaydol" yapmış olmalısınız!'));
    console.log(chalk.gray('2. Eğer kursa kendi başınıza DİĞER tarayıcınızdan YENİ kayıt olduysanız, program hala eski çerezlerinizi (auth.json) kullanıyor demektir.'));
    console.log(chalk.gray('   Böyle bir durumda 0 içerik hatası alırsınız. Lütfen ana menüden "Oturumu Yenile" seçeneğini kullanarak çerezlerinizi tazeleyin!'));
    console.log(chalk.gray('3. Anasayfayı aramak yerine doğrudan haftanın/modülün veya videonun (".../lecture/...") linkini verebilirsiniz.\n'));

    const courseUrl = await input({
      message: 'Kurs, Hafta veya Video Linki:',
      validate: (value) => value.includes('coursera.org/learn/') ? true : 'Lütfen geçerli bir coursera/learn linki girin.'
    });

    const activeConcurrent = await input({
      message: 'Aynı anda kaç video/dosya indirmek istersiniz? (Default: 3)',
      default: '3',
      validate: (value) => !isNaN(Number(value)) && Number(value) > 0 ? true : 'Lütfen geçerli bir sayı girin (Örn: 3, 5, 10)'
    });

    console.log(chalk.cyan('\n--- İndirme Motoru Başlatılıyor ---\n'));
    try {
      await runBatchDownload(courseUrl, Number(activeConcurrent));
    } catch (error: any) {
      console.error(chalk.red(error.message));
    }
    
    // Suggest restart
    const again = await select({
      message: 'Menüye dönmek ister misiniz?',
      choices: [{name: 'Evet', value: true}, {name: 'Hayır, Çıkış', value: false}]
    });

    if (again) await main();
  }
}

main().catch(err => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
