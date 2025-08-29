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

    // --- OSTATECZNA LOGIKA BAZUJĄCA NA PLIKU HTML ---
    const documents = await page.evaluate(() => {
        const results = [];
        const container = document.querySelector('div#tresc');
        if (!container) return [];

        // Pobierz wszystkie elementy (węzły) wewnątrz kontenera
        const nodes = Array.from(container.childNodes);
        
        // Pętla przechodzi przez wszystkie węzły
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];

            // Szukamy węzła tekstowego, który zawiera datę
            if (node.nodeType === Node.TEXT_NODE && /\d{4}-\d{2}-\d{2}/.test(node.textContent)) {
                
                // Sprawdzamy, czy kolejne elementy pasują do wzorca: <b>, <a>
                const typeNode = nodes[i + 2]; // Przeskakujemy myślnik i spację
                const linkNode = nodes[i + 4]; // Przeskakujemy kolejny myślnik i spację

                if (typeNode && typeNode.nodeName === 'B' && linkNode && linkNode.nodeName === 'A') {
                    const dateMatch = node.textContent.match(/(\d{4}-\d{2}-\d{2})/);
                    if (dateMatch) {
                         results.push({
                            date: dateMatch[0],
                            type: typeNode.innerText.trim(),
                            title: linkNode.innerText.trim(),
                            url: linkNode.href
                        });
                        // Przeskakujemy przetworzone elementy, aby ich ponownie nie analizować
                        i += 4;
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