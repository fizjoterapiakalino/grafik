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

    // --- PRECYZYJNA LOGIKA SCRAPOWANIA BAZUJĄCA NA ŹRÓDLE HTML ---
    const documents = await page.evaluate(() => {
        const results = [];
        // Znajdź wszystkie znaczniki <b>, które mogą być datą
        const allBoldElements = document.querySelectorAll('div#tresc > b');

        for (const element of allBoldElements) {
            const text = element.innerText;
            const dateRegex = /(\d{4}-\d{2}-\d{2})/;
            const match = text.match(dateRegex);

            // Jeśli element <b> zawiera datę...
            if (match) {
                const date = match[0];
                
                // ...to następny element <b> powinien być typem dokumentu...
                const typeElement = element.nextElementSibling;
                // ...a element po nim powinien być linkiem <a>
                const linkElement = typeElement ? typeElement.nextElementSibling : null;

                if (typeElement && typeElement.tagName === 'B' && linkElement && linkElement.tagName === 'A') {
                    results.push({
                        date: date,
                        type: typeElement.innerText.trim(),
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