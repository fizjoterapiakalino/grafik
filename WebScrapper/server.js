// WebScrapper/server.js
const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Konfiguracja CORS z określonymi origin dla bezpieczeństwa
const corsOptions = {
    origin: process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',')
        : ['http://localhost:8000', 'http://localhost:3000', 'https://fizjoterapiakalino.github.io'],
    optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Path to store persistence data
const DATA_FILE = path.join(__dirname, 'scrapedData.json');

// Stałe konfiguracyjne
const SCRAPING_INTERVAL_MS = 60 * 60 * 1000; // 1 godzina
const SCRAPING_TIMEOUT_MS = 60 * 1000; // 1 minuta timeout dla scrapingu

let scrapedData = [];
let isScrapingInProgress = false;
let lastScrapingTime = null;
let scrapingError = null;

// SSE clients for real-time updates
const sseClients = new Set();

/**
 * Wysyła wydarzenie do wszystkich połączonych klientów SSE
 * @param {string} eventName - Nazwa wydarzenia
 * @param {object} data - Dane do wysłania
 */
const broadcastSSE = (eventName, data) => {
    const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach((client) => {
        try {
            client.write(message);
        } catch (err) {
            console.warn('Błąd wysyłania SSE do klienta:', err.message);
            sseClients.delete(client);
        }
    });
};

/**
 * Ładuje dane z pliku przy uruchomieniu serwera
 */
const loadDataFromFile = () => {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const rawData = fs.readFileSync(DATA_FILE, 'utf8');
            scrapedData = JSON.parse(rawData);
            console.log(`Załadowano ${scrapedData.length} rekordów z pamięci trwałej.`);
        }
    } catch (err) {
        console.error('Błąd odczytu pliku danych:', err);
        scrapedData = [];
    }
};

/**
 * Zapisuje dane do pliku
 */
const saveDataToFile = () => {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(scrapedData, null, 2));
    } catch (err) {
        console.error('Błąd zapisu danych do pliku:', err);
    }
};

// Read the parser logic from file to inject into browser
const parserLogicPath = path.join(__dirname, 'domParser.js');
let parserFunctionString = '';
try {
    parserFunctionString = fs.readFileSync(parserLogicPath, 'utf8');
    parserFunctionString = parserFunctionString.replace(/module\.exports\s*=\s*parseDocumentsInBrowser;/, '');
} catch (err) {
    console.error('Błąd odczytu pliku parsera:', err);
}

/**
 * Główna funkcja scrapująca
 * @returns {Promise<boolean>} - true jeśli scraping zakończony sukcesem
 */
async function scrapePdfLinks() {
    if (isScrapingInProgress) {
        console.log('Scraping już w toku, pomijam...');
        return false;
    }

    isScrapingInProgress = true;
    scrapingError = null;
    console.log('Rozpoczynam scraping...');
    let browser = null;

    try {
        if (!process.env.TARGET_URL) {
            throw new Error('TARGET_URL environment variable is not set');
        }

        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();

        // Ustaw timeout dla całego procesu
        page.setDefaultTimeout(SCRAPING_TIMEOUT_MS);

        if (process.env.LOGIN_USERNAME && process.env.LOGIN_PASSWORD) {
            await page.authenticate({
                username: process.env.LOGIN_USERNAME,
                password: process.env.LOGIN_PASSWORD,
            });
        }

        await page.goto(process.env.TARGET_URL, { waitUntil: 'networkidle2' });

        const documents = await page.evaluate(
            new Function(`${parserFunctionString}; return parseDocumentsInBrowser();`),
        );

        if (Array.isArray(documents)) {
            scrapedData = documents;
            lastScrapingTime = new Date().toISOString();
            console.log(`Pobrano dane ${scrapedData.length} dokumentów.`);

            saveDataToFile();

            // Powiadom klientów SSE
            broadcastSSE('scrapingComplete', {
                count: scrapedData.length,
                timestamp: lastScrapingTime,
            });

            if (documents.length === 0) {
                console.warn('Scraping zakończony sukcesem, ale nie znaleziono żadnych dokumentów.');
            }

            return true;
        } else {
            throw new Error('Otrzymano nieprawidłowe dane ze scrapera');
        }
    } catch (error) {
        scrapingError = error.message;
        console.error('Błąd podczas scrapingu:', error);
        return false;
    } finally {
        if (browser !== null) {
            await browser.close();
        }
        isScrapingInProgress = false;
    }
}

// =====================
// API Endpoints
// =====================

/**
 * GET /api/pdfs - Zwraca zescrapowane dokumenty
 */
app.get('/api/pdfs', (req, res) => {
    res.json(scrapedData);
});

/**
 * GET /api/status - Zwraca status serwera i scrapingu
 */
app.get('/api/status', (req, res) => {
    res.json({
        documentsCount: scrapedData.length,
        lastScrapingTime,
        isScrapingInProgress,
        scrapingError,
        uptime: process.uptime(),
    });
});

/**
 * POST /api/scrape - Wymusza natychmiastowy scraping
 */
app.post('/api/scrape', async (req, res) => {
    if (isScrapingInProgress) {
        return res.status(409).json({ error: 'Scraping już w toku' });
    }

    const success = await scrapePdfLinks();
    if (success) {
        res.json({ message: 'Scraping zakończony pomyślnie', count: scrapedData.length });
    } else {
        res.status(500).json({ error: 'Scraping nie powiódł się', details: scrapingError });
    }
});

/**
 * GET /api/events - Server-Sent Events dla aktualizacji w czasie rzeczywistym
 */
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Wyślij początkowe wydarzenie
    res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

    sseClients.add(res);
    console.log(`Nowy klient SSE połączony. Aktywnych klientów: ${sseClients.size}`);

    // Heartbeat co 30 sekund, żeby utrzymać połączenie
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 30000);

    req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
        console.log(`Klient SSE rozłączony. Aktywnych klientów: ${sseClients.size}`);
    });
});

/**
 * GET /health - Health check endpoint
 */
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// =====================
// Inicjalizacja
// =====================

// Załaduj dane przy starcie
loadDataFromFile();

// Uruchom scraping przy starcie (w tle)
scrapePdfLinks();

// Uruchom scraping co godzinę
setInterval(scrapePdfLinks, SCRAPING_INTERVAL_MS);

// Graceful shutdown
const shutdown = () => {
    console.log('Zamykanie serwera...');
    // Zamknij wszystkie połączenia SSE
    sseClients.forEach((client) => {
        client.end();
    });
    sseClients.clear();
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.listen(port, () => {
    console.log(`Serwer działa na porcie ${port}`);
});
