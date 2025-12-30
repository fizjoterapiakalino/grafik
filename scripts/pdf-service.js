// scripts/pdf-service.js
import { Shared } from './shared.js';

export const PdfService = (() => {
    const SCRAPED_PDFS_CACHE_KEY = 'scrapedPdfLinks';
    const RENDER_API_BASE_URL = 'https://pdf-scraper-api-5qqr.onrender.com';

    const SEEN_DOCS_COUNT_KEY = 'seenPdfDocsCount';

    const checkForNewDocuments = (docs) => {
        const seenCount = parseInt(localStorage.getItem(SEEN_DOCS_COUNT_KEY) || '0', 10);
        const currentCount = docs.length;

        if (currentCount > seenCount) {
            // Dispatch event for UI to show badge
            window.dispatchEvent(
                new CustomEvent('iso-updates-available', { detail: { count: currentCount - seenCount } }),
            );
        } else {
            window.dispatchEvent(new CustomEvent('iso-updates-cleared'));
        }
    };

    const markAsSeen = () => {
        const cachedData = localStorage.getItem(SCRAPED_PDFS_CACHE_KEY);
        if (cachedData) {
            const docs = JSON.parse(cachedData);
            localStorage.setItem(SEEN_DOCS_COUNT_KEY, docs.length.toString());
            window.dispatchEvent(new CustomEvent('iso-updates-cleared'));
        }
    };

    const fetchAndCachePdfLinks = async (forceScrape = false) => {
        Shared.setIsoLinkActive(false);

        try {
            if (forceScrape) {
                window.showToast('Rozpoczynam odświeżanie linków ISO...', 3000);
            }

            const response = await fetch(`${RENDER_API_BASE_URL}/api/pdfs`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();

            localStorage.setItem(SCRAPED_PDFS_CACHE_KEY, JSON.stringify(data));
            checkForNewDocuments(data); // Check for updates after fetch

            window.showToast('Linki ISO zostały zaktualizowane.', 3000);
            Shared.setIsoLinkActive(true);
            return data;
        } catch (error) {
            console.error('Błąd podczas pobierania lub cachowania linków PDF:', error);
            window.showToast('Błąd podczas pobierania linków ISO.', 5000);
            Shared.setIsoLinkActive(false);
            return [];
        }
    };

    let sse = null;

    const initRealtimeUpdates = () => {
        if (sse) {
            sse.close();
        }
        sse = new EventSource(`${RENDER_API_BASE_URL}/api/events`);

        sse.addEventListener('scrapingComplete', (event) => {
            console.log('Otrzymano zdarzenie scrapingComplete:', event.data);
            window.showToast('Scraping zakończony w tle. Odświeżam linki ISO...', 5000);
            fetchAndCachePdfLinks();
        });

        sse.onerror = (error) => {
            console.warn(
                'Nie udało się nawiązać połączenia SSE z serwerem PDF Scraper. Ta funkcja nie jest krytyczna dla działania grafiku.',
            );
            sse.close();
            sse = null;
        };
    };

    const destroy = () => {
        if (sse) {
            sse.close();
            sse = null;
        }
    };

    return {
        fetchAndCachePdfLinks,
        initRealtimeUpdates,
        destroy,
        markAsSeen,
        checkForNewDocuments,
    };
})();
