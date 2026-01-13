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
 * Cache z timestampem
 */
interface CachedPdfData {
    data: PdfDocument[];
    timestamp: number;
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
    const SCRAPED_PDFS_CACHE_KEY = 'scrapedPdfLinksV2'; // Nowa wersja cache z TTL
    const SEEN_DOCS_COUNT_KEY = 'seenPdfDocsCount';
    const RENDER_API_BASE_URL = 'https://pdf-scraper-api-5qqr.onrender.com';

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 3000; // Zwiększone dla cold start
    const SSE_RECONNECT_DELAY_MS = 5000;

    // Cache TTL - 30 minut (dane są odświeżane w tle po tym czasie)
    const CACHE_TTL_MS = 30 * 60 * 1000;
    // Stale cache - użyj jeśli API niedostępne (max 24h)
    const STALE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

    let sse: EventSource | null = null;
    let sseReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isDestroyed = false;
    let isBackgroundRefreshInProgress = false;

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
        const cached = getCachedDataWithMeta();
        if (cached && cached.data.length > 0) {
            localStorage.setItem(SEEN_DOCS_COUNT_KEY, cached.data.length.toString());
            window.dispatchEvent(new CustomEvent('iso-updates-cleared'));
        }
    };

    /**
     * Pobiera cache z metadanymi (timestamp)
     */
    const getCachedDataWithMeta = (): CachedPdfData | null => {
        try {
            const cached = localStorage.getItem(SCRAPED_PDFS_CACHE_KEY);
            if (!cached) return null;

            const parsed = JSON.parse(cached);
            // Sprawdź czy to nowy format (z timestamp) czy stary (tablica)
            if (Array.isArray(parsed)) {
                // Stary format - migruj do nowego
                return { data: parsed, timestamp: 0 };
            }
            return parsed as CachedPdfData;
        } catch (err) {
            console.error('Błąd odczytu cache:', err);
            return null;
        }
    };

    /**
     * Sprawdza czy cache jest świeży (w ramach TTL)
     */
    const isCacheFresh = (cached: CachedPdfData | null): boolean => {
        if (!cached || !cached.timestamp) return false;
        return Date.now() - cached.timestamp < CACHE_TTL_MS;
    };

    /**
     * Sprawdza czy cache może być użyty jako fallback (stale)
     */
    const isCacheUsable = (cached: CachedPdfData | null): boolean => {
        if (!cached || cached.data.length === 0) return false;
        if (!cached.timestamp) return true; // Stary format - użyj
        return Date.now() - cached.timestamp < STALE_CACHE_TTL_MS;
    };

    const getCachedData = (): PdfDocument[] | null => {
        const cached = getCachedDataWithMeta();
        return cached ? cached.data : null;
    };

    /**
     * Zapisuje dane do cache z timestampem
     */
    const saveToCache = (data: PdfDocument[]): void => {
        const cacheData: CachedPdfData = {
            data,
            timestamp: Date.now()
        };
        localStorage.setItem(SCRAPED_PDFS_CACHE_KEY, JSON.stringify(cacheData));
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

    /**
     * Pobiera dane z API i zapisuje do cache
     */
    const fetchFromApi = async (): Promise<PdfDocument[] | null> => {
        try {
            const response = await fetchWithRetry(`${RENDER_API_BASE_URL}/api/pdfs`);
            const data = await response.json();

            if (Array.isArray(data)) {
                saveToCache(data);
                checkForNewDocuments(data);
                Shared.setIsoLinkActive(true);

                if (data.length > 0) {
                    debugLog(`Pobrano ${data.length} dokumentów ISO z API`);
                }

                return data;
            } else {
                throw new Error('Nieprawidłowy format danych z API');
            }
        } catch (error) {
            console.error('Błąd podczas pobierania linków PDF:', error);
            return null;
        }
    };

    const fetchAndCachePdfLinks = async (forceScrape: boolean = false): Promise<PdfDocument[]> => {
        Shared.setIsoLinkActive(false);

        const cachedWithMeta = getCachedDataWithMeta();

        // Jeśli nie wymuszamy odświeżenia i cache jest świeży - użyj go
        if (!forceScrape && isCacheFresh(cachedWithMeta)) {
            debugLog('Używam świeżego cache (TTL ok)');
            checkForNewDocuments(cachedWithMeta!.data);
            Shared.setIsoLinkActive(true);
            return cachedWithMeta!.data;
        }

        // Jeśli cache jest przestarzały ale użyteczny - pokaż go od razu, odśwież w tle
        if (!forceScrape && isCacheUsable(cachedWithMeta) && !isBackgroundRefreshInProgress) {
            debugLog('Używam przestarzałego cache, odświeżam w tle...');
            checkForNewDocuments(cachedWithMeta!.data);
            Shared.setIsoLinkActive(true);

            // Odśwież w tle (stale-while-revalidate)
            isBackgroundRefreshInProgress = true;
            fetchFromApi().finally(() => {
                isBackgroundRefreshInProgress = false;
            });

            return cachedWithMeta!.data;
        }

        // Brak cache lub wymuszony refresh - pobierz synchronicznie
        if (forceScrape) {
            window.showToast?.('Odświeżanie linków ISO...', 3000);
        }

        const data = await fetchFromApi();
        if (data) {
            return data;
        }

        // Fallback do przestarzałego cache jeśli API niedostępne
        if (isCacheUsable(cachedWithMeta)) {
            debugLog('API niedostępne, używam przestarzałego cache jako fallback');
            Shared.setIsoLinkActive(true);
            return cachedWithMeta!.data;
        }

        window.showToast?.('Nie można pobrać linków ISO.', 5000);
        Shared.setIsoLinkActive(false);
        return [];
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
                window.showToast?.('Nowe dokumenty ISO dostępne!', 5000);
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
