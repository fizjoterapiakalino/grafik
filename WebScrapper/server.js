// WebScrapper/server.js
const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

// Path to store persistence data
const DATA_FILE = path.join(__dirname, 'scrapedData.json');

let scrapedData = [];

// Load data on startup
try {
    if (fs.existsSync(DATA_FILE)) {
        const rawData = fs.readFileSync(DATA_FILE, 'utf8');
        scrapedData = JSON.parse(rawData);
        console.log(`Załadowano ${scrapedData.length} rekordów z pamięci trwałej.`);
    }
} catch (err) {
    console.error('Błąd odczytu pliku danych:', err);
}

// Read the parser logic from file to inject into browser
const parserLogicPath = path.join(__dirname, 'domParser.js');
let parserFunctionString = fs.readFileSync(parserLogicPath, 'utf8');
parserFunctionString = parserFunctionString.replace(/module\.exports\s*=\s*parseDocumentsInBrowser;/, '');

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

        if (process.env.LOGIN_USERNAME && process.env.LOGIN_PASSWORD) {
            await page.authenticate({
                username: process.env.LOGIN_USERNAME,
                password: process.env.LOGIN_PASSWORD,
            });
        }

        if (!process.env.TARGET_URL) {
            throw new Error('TARGET_URL environment variable is not set');
        }

        await page.goto(process.env.TARGET_URL, { waitUntil: 'networkidle2' });

        const documents = await page.evaluate(new Function(`${parserFunctionString}; return parseDocumentsInBrowser();`));

        if (Array.isArray(documents)) {
            scrapedData = documents;
            console.log(`Pobrano dane ${scrapedData.length} dokumentów.`);

            // Save to file
            try {
                fs.writeFileSync(DATA_FILE, JSON.stringify(scrapedData, null, 2));
            } catch (err) {
                console.error('Błąd zapisu danych do pliku:', err);
            }

            if (documents.length === 0) {
                console.warn('Scraping zakończony sukcesem, ale nie znaleziono żadnych dokumentów.');
            }
        } else {
            console.error('Otrzymano nieprawidłowe dane ze scrapera:', documents);
        }

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

// Run immediately on start (if we want fresh data, otherwise we rely on loaded data)
// It's usually good to try refreshing on start up in background
scrapePdfLinks();

setInterval(scrapePdfLinks, 60 * 60 * 1000);

process.on('SIGINT', () => {
    console.log('Zamykanie serwera...');
    process.exit();
});

app.listen(port, () => {
    console.log(`Serwer działa na porcie ${port}`);
});
