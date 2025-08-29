const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

let pdfLinks = []; // Przechowuje pobrane linki do PDF
let isScraping = false; // Nowa zmienna do śledzenia statusu scrapingu
const sseClients = []; // Tablica do przechowywania klientów SSE

// Endpoint dla Server-Sent Events
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.push(res);

  req.on('close', () => {
    const index = sseClients.indexOf(res);
    if (index > -1) {
      sseClients.splice(index, 1);
    }
  });
});

// Funkcja do logowania i pobierania linków
async function scrapePdfLinks() {
  if (isScraping) {
    console.log('Scraping jest już w toku. Pomijam nowe żądanie.');
    return;
  }
  isScraping = true;
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

    // --- KLUCZOWA ZMIANA JEST TUTAJ ---
    // Ustawiamy dane logowania, których Puppeteer użyje automatycznie
    await page.authenticate({
        username: process.env.LOGIN_USERNAME,
        password: process.env.LOGIN_PASSWORD,
    });

    // Teraz przechodzimy na stronę. Puppeteer sam obsłuży okno logowania.
    await page.goto(process.env.TARGET_URL, { waitUntil: 'networkidle2' });

    // Nie potrzebujemy już page.type() i page.click() do logowania.

    // Pobieranie linków do PDF
    // TODO: Upewnij się, że selektor 'a[href$=".pdf"]' jest poprawny dla strony po zalogowaniu.
    const links = await page.evaluate(() => {
      // Upewniamy się, że linki są pełnymi adresami URL
      const anchors = Array.from(document.querySelectorAll('a[href$=".pdf"]'));
      return anchors.map(a => a.href);
    });

    pdfLinks = links;
    console.log(`Pobrano ${pdfLinks.length} linków do PDF.`);

  } catch (error) {
    console.error('Błąd podczas scrapingu:', error);
  } finally {
    if (browser !== null) {
      await browser.close();
    }
    isScraping = false; // Zakończono scraping

    // Wyślij zdarzenie do wszystkich klientów SSE po zakończeniu scrapingu
    sseClients.forEach(client => {
      client.write(`event: scrapingComplete\ndata: ${JSON.stringify({ links: pdfLinks, isScraping: false })}\n\n`);
    });
  }
}

// Endpoint API do zwracania linków PDF
app.get('/api/pdfs', (req, res) => {
  res.json({ links: pdfLinks, isScraping: isScraping });
});

// Nowy endpoint do ręcznego wywołania scrapingu
app.post('/api/scrape', async (req, res) => {
  if (isScraping) {
    return res.status(202).json({ message: 'Scraping już w toku.', isScraping: true });
  }
  scrapePdfLinks(); // Uruchom scraping w tle
  res.status(200).json({ message: 'Scraping rozpoczęty.', isScraping: true });
});

// Uruchom scraping przy starcie serwera i co jakiś czas
scrapePdfLinks();
setInterval(scrapePdfLinks, 60 * 60 * 1000); // Co godzinę

app.listen(port, () => {
  console.log(`Serwer działa na porcie ${port}`);
});
