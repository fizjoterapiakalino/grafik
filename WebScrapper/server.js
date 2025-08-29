const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

let scrapedData = []; 

async function scrapePdfLinks() {
  console.log('Rozpoczynam scraping...');
  let browser = null;

  try {
    browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();

    await page.authenticate({
        username: process.env.LOGIN_USERNAME,
        password: process.env.LOGIN_PASSWORD,
    });

    await page.goto(process.env.TARGET_URL, { waitUntil: 'networkidle2' });

    // --- ULEPSZONA LOGIKA SCRAPOWANIA ---
    const documents = await page.evaluate(() => {
        const results = [];
        // Znajdź wszystkie wiersze tabeli
        const rows = Array.from(document.querySelectorAll('tr')); 

        for (const row of rows) {
            // Pobierz wszystkie komórki z danego wiersza
            const cells = row.querySelectorAll('td');
            
            // Upewnij się, że wiersz ma co najmniej 3 komórki i zawiera link
            if (cells.length >= 3 && row.querySelector('a[href$=".pdf"]')) {
                const dateText = cells[0].innerText.trim();
                const typeText = cells[1].innerText.trim();
                const linkElement = cells[2].querySelector('a');

                const dateRegex = /\d{4}-\d{2}-\d{2}/;
                const match = dateText.match(dateRegex);
                
                if (match && linkElement) {
                    results.push({
                        date: match[0],
                        type: typeText,
                        title: linkElement.innerText.trim(),
                        url: linkElement.href
                    });
                }
            }
        }
        return results;
    });

    scrapedData = documents;
    console.log(`Pobrano dane ${scrapedData.length} dokumentów.`);

  } catch (error) {
    console.error('Błąd podczas scrapingu:', error);
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }
}

app.get('/api/pdfs', (req, res) => {
  res.json(scrapedData); 
});

scrapePdfLinks();
setInterval(scrapePdfLinks, 60 * 60 * 1000);

app.listen(port, () => {
  console.log(`Serwer działa na porcie ${port}`);
});