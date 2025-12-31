// scripts/pdf-service.ts
import { debugLog } from './common.js';
import { Shared } from './shared.js';

/**
 * Dokument PDF z API
 */
export interface PdfDocument {
    id: string;
    title: string;
    url: string;
    date?: string;
    type?: string;
}

/**
 * Status serwera
 */
interface ServerStatus {
    status: string;
    lastScrape?: string;
}

/**
 * Interfejs publicznego API PdfService
 */
interface PdfServiceAPI {
    fetchAndCachePdfLinks(forceScrape?: boolean): Promise<PdfDocument[]>;
    initRealtimeUpdates(): void;
    destroy(): void;
    markAsSeen(): void;
    checkForNewDocuments(docs: PdfDocument[]): void;
    getCachedData(): PdfDocument[] | null;
    getServerStatus(): Promise<ServerStatus | null>;
}

export const PdfService: PdfServiceAPI = (() => {
    const SCRAPED_PDFS_CACHE_KEY = 'scrapedPdfLinks';
    const SEEN_DOCS_COUNT_KEY = 'seenPdfDocsCount';
    const RENDER_API_BASE_URL = 'https://pdf-scraper-api-5qqr.onrender.com';

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;
    const SSE_RECONNECT_DELAY_MS = 5000;

    let sse: EventSource | null = null;
    let sseReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isDestroyed = false;

    const checkForNewDocuments = (docs: PdfDocument[]): void => {
        const seenCount = parseInt(localStorage.getItem(SEEN_DOCS_COUNT_KEY) || '0', 10);
        const currentCount = docs.length;

        if (currentCount > seenCount) {
            const newCount = currentCount - seenCount;
            window.dispatchEvent(new CustomEvent('iso-updates-available', { detail: { count: newCount } }));
            debugLog(`${newCount} nowych dokumentów ISO od ostatniej wizyty.`);
        } else {
            window.dispatchEvent(new CustomEvent('iso-updates-cleared'));
        }
    };

    const markAsSeen = (): void => {
        const cachedData = localStorage.getItem(SCRAPED_PDFS_CACHE_KEY);
        if (cachedData) {
            try {
                const docs = JSON.parse(cachedData) as PdfDocument[];
                localStorage.setItem(SEEN_DOCS_COUNT_KEY, docs.length.toString());
                window.dispatchEvent(new CustomEvent('iso-updates-cleared'));
            } catch (err) {
                console.error('Błąd parsowania cached PDF data:', err);
            }
        }
    };

    const getCachedData = (): PdfDocument[] | null => {
        try {
            const cached = localStorage.getItem(SCRAPED_PDFS_CACHE_KEY);
            return cached ? JSON.parse(cached) : null;
        } catch (err) {
            console.error('Błąd odczytu cache:', err);
            return null;
        }
    };

    const fetchWithRetry = async (url: string, retries: number = MAX_RETRIES): Promise<Response> => {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response;
        } catch (error) {
            if (retries > 0) {
                console.warn(`Retry pobierania (pozostało ${retries} prób):`, (error as Error).message);
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
                return fetchWithRetry(url, retries - 1);
            }
            throw error;
        }
    };

    const fetchAndCachePdfLinks = async (forceScrape: boolean = false): Promise<PdfDocument[]> => {
        Shared.setIsoLinkActive(false);

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

            const cached = getCachedData();
            if (cached && cached.length > 0) {
                debugLog('Używam cache jako fallback');
                Shared.setIsoLinkActive(true);
                return cached;
            }

            window.showToast('Nie można pobrać linków ISO.', 5000);
            Shared.setIsoLinkActive(false);
            return [];
        }
    };

    const initRealtimeUpdates = (): void => {
        if (isDestroyed) return;

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
                debugLog('Połączono z PDF Scraper SSE');
            });

            sse.addEventListener('scrapingComplete', (event) => {
                debugLog('Otrzymano zdarzenie scrapingComplete:', event.data);
                window.showToast('Nowe dokumenty ISO dostępne!', 5000);
                fetchAndCachePdfLinks(true);
            });

            sse.onerror = () => {
                console.warn('Błąd połączenia SSE z PDF Scraper API');
                sse?.close();
                sse = null;

                if (!isDestroyed) {
                    sseReconnectTimeout = setTimeout(() => {
                        debugLog('Próba ponownego połączenia SSE...');
                        initRealtimeUpdates();
                    }, SSE_RECONNECT_DELAY_MS);
                }
            };
        } catch (error) {
            console.warn('Nie można zainicjalizować SSE:', error);
        }
    };

    const getServerStatus = async (): Promise<ServerStatus | null> => {
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

    const destroy = (): void => {
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
