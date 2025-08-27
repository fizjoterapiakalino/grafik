const express = require('express');
const puppeteer = require('puppeteer-core'); // Changed from 'puppeteer'
const chromium = require('@sparticuz/chromium'); // Added this line
const app = express();
const port = process.env.PORT || 3000;

let pdfLinks = []; // Przechowuje pobrane linki do PDF

// Funkcja do logowania i pobierania linków
async function scrapePdfLinks() {
  console.log('Rozpoczynam scraping...');
  let browser = null; // Initialize browser to null

  try {
    // Updated puppeteer.launch configuration
    browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    await page.goto(process.env.TARGET_URL, { waitUntil: 'networkidle2' });

    // Logowanie
    // TODO: Uzupełnij selektory pól logowania i przycisku
    await page.type('#username', process.env.LOGIN_USERNAME);
    await page.type('#password', process.env.LOGIN_PASSWORD);
    await page.click('#loginButton'); // Przykładowy selektor przycisku logowania

    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // Sprawdź, czy logowanie się powiodło
    const currentUrl = page.url();
    if (currentUrl.includes('login.html')) { // Zmień na faktyczny URL po zalogowaniu
      console.error('Logowanie nieudane. Sprawdź dane logowania i URL.');
      return; // Stop execution if login fails
    }

    // Pobieranie linków do PDF
    // TODO: Uzupełnij selektor dla linków do PDF
    const links = await page.evaluate(() => {
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
  }
}

// Endpoint API do zwracania linków PDF
app.get('/api/pdfs', (req, res) => {
  res.json(pdfLinks);
});

// Uruchom scraping przy starcie serwera i co jakiś czas
scrapePdfLinks();
setInterval(scrapePdfLinks, 60 * 60 * 1000); // Co godzinę

app.listen(port, () => {
  console.log(`Serwer działa na porcie ${port}`);
});