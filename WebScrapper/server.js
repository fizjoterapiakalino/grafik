// WebScrapper/server.js
const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { normalizeDocuments } = require('./documentNormalizer');

const app = express();
const port = process.env.PORT || 3000;
app.disable('x-powered-by');

// Konfiguracja CORS z określonymi origin dla bezpieczeństwa
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : ['http://localhost:8000', 'http://localhost:3000', 'https://fizjoterapiakalino.github.io'];
const corsOptions = {
    origin: allowedOrigins,
    optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Path to store persistence data
const DATA_FILE = path.join(__dirname, 'scrapedData.json');

// Stałe konfiguracyjne
const SCRAPING_INTERVAL_MS = 60 * 60 * 1000; // 1 godzina
const SCRAPING_TIMEOUT_MS = 60 * 1000; // 1 minuta timeout dla scrapingu
const MANUAL_SCRAPE_MIN_INTERVAL_MS = Number(process.env.MANUAL_SCRAPE_MIN_INTERVAL_MS || 5 * 60 * 1000);
const SCRAPER_API_TOKEN = process.env.SCRAPER_API_TOKEN || '';

let scrapedData = [];
let isScrapingInProgress = false;
let lastScrapingTime = null;
let scrapingError = null;
let lastManualScrapeTime = 0;

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
        const tempFile = `${DATA_FILE}.tmp`;
        fs.writeFileSync(tempFile, JSON.stringify(scrapedData, null, 2));
        fs.renameSync(tempFile, DATA_FILE);
    } catch (err) {
        console.error('Błąd zapisu danych do pliku:', err);
    }
};

const isAuthorizedScrapeRequest = (req) => {
    if (!SCRAPER_API_TOKEN) return true;
    return req.get('x-scraper-token') === SCRAPER_API_TOKEN;
};

const getAllowedSseOrigin = (origin) => {
    if (!origin) return allowedOrigins[0] || '*';
    return allowedOrigins.includes(origin) ? origin : allowedOrigins[0] || '*';
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
            const scrapedAt = new Date().toISOString();
            const normalizedDocuments = normalizeDocuments(documents, {
                scrapedAt,
                sourceUrl: process.env.TARGET_URL,
            });

            if (normalizedDocuments.length === 0 && scrapedData.length > 0) {
                throw new Error('Scraper zwrócił pustą listę. Zachowuję poprzedni cache, żeby nie ukrywać dokumentów.');
            }

            scrapedData = normalizedDocuments;
            lastScrapingTime = scrapedAt;
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
    if (!isAuthorizedScrapeRequest(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (isScrapingInProgress) {
        return res.status(409).json({ error: 'Scraping już w toku' });
    }

    const now = Date.now();
    const msSinceLastManualScrape = now - lastManualScrapeTime;
    if (msSinceLastManualScrape < MANUAL_SCRAPE_MIN_INTERVAL_MS) {
        const retryAfterSeconds = Math.ceil((MANUAL_SCRAPE_MIN_INTERVAL_MS - msSinceLastManualScrape) / 1000);
        res.setHeader('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({
            error: 'Scraping był uruchomiony niedawno',
            retryAfterSeconds,
        });
    }

    lastManualScrapeTime = now;

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
    res.setHeader('Access-Control-Allow-Origin', getAllowedSseOrigin(req.get('origin')));

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
