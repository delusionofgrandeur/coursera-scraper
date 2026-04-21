import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

interface CourseSearchResult {
  title: string;
  partner: string;
  rating: string;
  link: string;
}

async function runScraper() {
  console.log('Starting Coursera scraper...');
  
  // Launch the browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Search query (you can change this to any topic)
  const query = 'python';
  const url = `https://www.coursera.org/search?query=${encodeURIComponent(query)}`;
  
  console.log(`Navigating to ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Await the product cards to render
  console.log('Waiting for course results to load...');
  try {
    // Coursera often uses ul with product cards
    await page.waitForSelector('ul[data-e2e="Search-Results-List"], .cds-ProductCard-container', { timeout: 15000 });
  } catch {
    console.log('Could not find standard result list. Attempting to parse whatever is on the page...');
  }

  // Evaluate the page and extract course information
  console.log('Extracting course data...');
  const courses = await page.evaluate((): CourseSearchResult[] => {
    const results: CourseSearchResult[] = [];
    
    // Find all links that represent a course, specialization, or professional certificate
    // They typically have a parent wrapper which acts as a card
    const listItems = document.querySelectorAll('.cds-ProductCard-base, [data-e2e="ProductCard"]');
    
    listItems.forEach((item) => {
      // Title
      const titleEl = item.querySelector('h3, .cds-ProductCard-header');
      const title = titleEl ? (titleEl as HTMLElement).innerText.trim() : 'No title';
      
      // Partner/University
      const partnerEl = item.querySelector('.cds-ProductCard-partnerNames, [data-e2e="partner-names"]');
      const partner = partnerEl ? (partnerEl as HTMLElement).innerText.trim() : 'No partner specified';
      
      // Rating
      const ratingEl = item.querySelector('.cds-RatingSnippet-rating, [data-e2e="rating-snippet"]');
      const rating = ratingEl ? (ratingEl as HTMLElement).innerText.trim() : 'No rating';
      
      // Link
      const linkEl = item.querySelector('a');
      let link = linkEl ? linkEl.getAttribute('href') ?? '' : '';
      if (link && !link.startsWith('http')) {
        link = 'https://www.coursera.org' + link;
      }
      
      // Push to results array if title exists (to avoid pushing empty/dummy cards)
      if (title !== 'No title') {
        results.push({ title, partner, rating, link });
      }
    });
    
    return results;
  });

  console.log(`Successfully scraped ${courses.length} courses!`);
  
  // Save to file
  const outPath = path.join(process.cwd(), 'coursera_results.json');
  fs.writeFileSync(outPath, JSON.stringify(courses, null, 2), 'utf-8');
  
  console.log(`Results saved to: ${outPath}`);

  // Print a sample of what we got
  if (courses.length > 0) {
    console.log('\nSample from scraped data:');
    console.log(courses.slice(0, 3));
  }

  // Cleanup
  await browser.close();
}

runScraper().catch((err) => {
  console.error('An error occurred during scraping:', err);
  process.exit(1);
});
