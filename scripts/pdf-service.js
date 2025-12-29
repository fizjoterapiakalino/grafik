// scripts/pdf-service.js
import { Shared } from './shared.js';

export const PdfService = (() => {
    const SCRAPED_PDFS_CACHE_KEY = 'scrapedPdfLinks';
    const SEEN_DOCS_COUNT_KEY = 'seenPdfDocsCount';
    const RENDER_API_BASE_URL = 'https://pdf-scraper-api-5qqr.onrender.com';

    // Konfiguracja retry
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;
    const SSE_RECONNECT_DELAY_MS = 5000;

    let sse = null;
    let sseReconnectTimeout = null;
    let isDestroyed = false;

    /**
     * Sprawdza czy są nowe dokumenty od ostatniej wizyty
     * @param {Array} docs - Lista dokumentów
     */
    const checkForNewDocuments = (docs) => {
        const seenCount = parseInt(localStorage.getItem(SEEN_DOCS_COUNT_KEY) || '0', 10);
        const currentCount = docs.length;

        if (currentCount > seenCount) {
            const newCount = currentCount - seenCount;
            window.dispatchEvent(new CustomEvent('iso-updates-available', { detail: { count: newCount } }));
            console.log(`${newCount} nowych dokumentów ISO od ostatniej wizyty.`);
        } else {
            window.dispatchEvent(new CustomEvent('iso-updates-cleared'));
        }
    };

    /**
     * Oznacza wszystkie dokumenty jako przeczytane
     */
    const markAsSeen = () => {
        const cachedData = localStorage.getItem(SCRAPED_PDFS_CACHE_KEY);
        if (cachedData) {
            try {
                const docs = JSON.parse(cachedData);
                localStorage.setItem(SEEN_DOCS_COUNT_KEY, docs.length.toString());
                window.dispatchEvent(new CustomEvent('iso-updates-cleared'));
            } catch (err) {
                console.error('Błąd parsowania cached PDF data:', err);
            }
        }
    };

    /**
     * Pobiera dane z cache (localStorage)
     * @returns {Array|null}
     */
    const getCachedData = () => {
        try {
            const cached = localStorage.getItem(SCRAPED_PDFS_CACHE_KEY);
            return cached ? JSON.parse(cached) : null;
        } catch (err) {
            console.error('Błąd odczytu cache:', err);
            return null;
        }
    };

    /**
     * Wykonuje fetch z retry
     * @param {string} url - URL do pobrania
     * @param {number} retries - Liczba pozostałych prób
     * @returns {Promise<Response>}
     */
    const fetchWithRetry = async (url, retries = MAX_RETRIES) => {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response;
        } catch (error) {
            if (retries > 0) {
                console.warn(`Retry pobierania (pozostało ${retries} prób):`, error.message);
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
                return fetchWithRetry(url, retries - 1);
            }
            throw error;
        }
    };

    /**
     * Pobiera i cachuje linki PDF
     * @param {boolean} forceScrape - Czy wymusić odświeżenie mimo cache
     * @returns {Promise<Array>}
     */
    const fetchAndCachePdfLinks = async (forceScrape = false) => {
        Shared.setIsoLinkActive(false);

        // Jeśli nie wymuszamy i mamy cache, użyj cache
        if (!forceScrape) {
            const cached = getCachedData();
            if (cached && cached.length > 0) {
                checkForNewDocuments(cached);
                Shared.setIsoLinkActive(true);
                return cached;
            }
        }

        try {
            if (forceScrape) {
                window.showToast('Odświeżanie linków ISO...', 3000);
            }

            const response = await fetchWithRetry(`${RENDER_API_BASE_URL}/api/pdfs`);
            const data = await response.json();

            if (Array.isArray(data)) {
                localStorage.setItem(SCRAPED_PDFS_CACHE_KEY, JSON.stringify(data));
                checkForNewDocuments(data);
                Shared.setIsoLinkActive(true);

                if (forceScrape || data.length > 0) {
                    window.showToast(`Załadowano ${data.length} dokumentów ISO.`, 3000);
                }

                return data;
            } else {
                throw new Error('Nieprawidłowy format danych z API');
            }
        } catch (error) {
            console.error('Błąd podczas pobierania linków PDF:', error);

            // Spróbuj użyć cache jako fallback
            const cached = getCachedData();
            if (cached && cached.length > 0) {
                console.log('Używam cache jako fallback');
                Shared.setIsoLinkActive(true);
                return cached;
            }

            window.showToast('Nie można pobrać linków ISO.', 5000);
            Shared.setIsoLinkActive(false);
            return [];
        }
    };

    /**
     * Inicjalizuje połączenie SSE dla aktualizacji w czasie rzeczywistym
     */
    const initRealtimeUpdates = () => {
        if (isDestroyed) return;

        // Wyczyść poprzednie połączenie
        if (sse) {
            sse.close();
            sse = null;
        }

        if (sseReconnectTimeout) {
            clearTimeout(sseReconnectTimeout);
            sseReconnectTimeout = null;
        }

        try {
            sse = new EventSource(`${RENDER_API_BASE_URL}/api/events`);

            sse.addEventListener('connected', () => {
                console.log('Połączono z PDF Scraper SSE');
            });

            sse.addEventListener('scrapingComplete', (event) => {
                console.log('Otrzymano zdarzenie scrapingComplete:', event.data);
                window.showToast('Nowe dokumenty ISO dostępne!', 5000);
                fetchAndCachePdfLinks(true);
            });

            sse.onerror = (error) => {
                console.warn('Błąd połączenia SSE z PDF Scraper API');
                sse.close();
                sse = null;

                // Próba ponownego połączenia po opóźnieniu
                if (!isDestroyed) {
                    sseReconnectTimeout = setTimeout(() => {
                        console.log('Próba ponownego połączenia SSE...');
                        initRealtimeUpdates();
                    }, SSE_RECONNECT_DELAY_MS);
                }
            };
        } catch (error) {
            console.warn('Nie można zainicjalizować SSE:', error);
        }
    };

    /**
     * Pobiera status serwera scraper
     * @returns {Promise<Object|null>}
     */
    const getServerStatus = async () => {
        try {
            const response = await fetch(`${RENDER_API_BASE_URL}/api/status`);
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.warn('Nie można pobrać statusu serwera:', error);
        }
        return null;
    };

    /**
     * Czyści zasoby
     */
    const destroy = () => {
        isDestroyed = true;

        if (sseReconnectTimeout) {
            clearTimeout(sseReconnectTimeout);
            sseReconnectTimeout = null;
        }

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
        getCachedData,
        getServerStatus,
    };
})();
