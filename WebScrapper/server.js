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

    // --- OSTATECZNA, PRECYZYJNA LOGIKA SCRAPOWANIA ---
    const documents = await page.evaluate(() => {
        const results = [];
        const container = document.querySelector('div#tresc');
        if (!container) return [];

        // Pobieramy wszystkie bezpośrednie węzły (również tekstowe) z kontenera
        const nodes = Array.from(container.childNodes);

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            
            // Szukamy węzła <b>, który zawiera datę w formacie YYYY-MM-DD
            if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'B' && /\d{4}-\d{2}-\d{2}/.test(node.innerText)) {
                
                // Sprawdzamy, czy kolejne węzły pasują do oczekiwanej struktury:
                // node -> <b>DATA</b>
                // node+1 -> "-" (węzeł tekstowy)
                // node+2 -> <b>TYP</b>
                // node+3 -> "-" (węzeł tekstowy)
                // node+4 -> <b><a href="...">TYTUŁ</a></b>
                if (i + 4 < nodes.length) {
                    const typeNode = nodes[i + 2];
                    const linkContainerNode = nodes[i + 4];

                    if (typeNode && typeNode.nodeName === 'B' && linkContainerNode && linkContainerNode.nodeName === 'B') {
                        const linkElement = linkContainerNode.querySelector('a[href$=".pdf"]');
                        
                        if (linkElement) {
                            results.push({
                                date: node.innerText.trim(),
                                type: typeNode.innerText.trim(),
                                title: linkElement.innerText.trim(),
                                url: linkElement.href
                            });
                            // Przeskakujemy o 4 pozycje, aby uniknąć ponownego przetwarzania tych samych elementów
                            i += 4;
                        }
                    }
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