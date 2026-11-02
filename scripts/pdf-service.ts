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
    sourceUrl?: string;
    scrapedAt?: string;
}

/**
 * Status serwera
 */
interface ServerStatus {
    documentsCount: number;
    lastScrapingTime?: string | null;
    isScrapingInProgress: boolean;
    scrapingError?: string | null;
    uptime?: number;
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
    fetchAndCachePdfLinks(forceScrape?: boolean, runServerScrape?: boolean): Promise<PdfDocument[]>;
    destroy(): void;
    markAsSeen(): void;
    checkForNewDocuments(docs: PdfDocument[]): void;
    getCachedData(): PdfDocument[] | null;
    getCachedPdfs(): PdfDocument[] | null;
    hasUnseenUpdates(): boolean;
    getServerStatus(): Promise<ServerStatus | null>;
    triggerScraping(): Promise<boolean>;
}

export const PdfService: PdfServiceAPI = (() => {
    const SCRAPED_PDFS_CACHE_KEY = 'scrapedPdfLinksV2';
    const SEEN_DOC_IDS_KEY = 'seenPdfDocIdsV2';
    const RENDER_API_BASE_URL = 'https://pdf-scraper-api-5qqr.onrender.com';

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 3000;

    // Cache TTL - 30 minut (dane są odświeżane w tle po tym czasie)
    const CACHE_TTL_MS = 30 * 60 * 1000;
    // Stale cache - użyj jeśli API niedostępne (max 24h)
    const STALE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

    let isBackgroundRefreshInProgress = false;

    const getDocumentIdentity = (doc: PdfDocument): string => {
        return String(doc.id || doc.url || `${doc.date || ''}|${doc.type || ''}|${doc.title || ''}`).trim();
    };

    const getDocumentIds = (docs: PdfDocument[]): string[] => {
        return docs.map(getDocumentIdentity).filter(Boolean);
    };

    const getSeenDocIds = (): Set<string> | null => {
        try {
            const stored = localStorage.getItem(SEEN_DOC_IDS_KEY);
            if (!stored) return null;
            const parsed = JSON.parse(stored);
            if (!Array.isArray(parsed)) return null;
            return new Set(parsed.map(String).filter(Boolean));
        } catch (error) {
            console.error('Błąd odczytu listy widzianych dokumentów ISO:', error);
            return null;
        }
    };

    const saveSeenDocIds = (docs: PdfDocument[]): void => {
        localStorage.setItem(SEEN_DOC_IDS_KEY, JSON.stringify(getDocumentIds(docs)));
    };

    const checkForNewDocuments = (docs: PdfDocument[]): void => {
        const currentIds = getDocumentIds(docs);
        const seenIds = getSeenDocIds();

        if (seenIds) {
            const newIds = currentIds.filter((id) => !seenIds.has(id));
            if (newIds.length > 0) {
                window.dispatchEvent(new CustomEvent('iso-updates-available', { detail: { count: newIds.length } }));
                debugLog(`${newIds.length} nowych dokumentów ISO od ostatniej wizyty.`);
            } else {
                window.dispatchEvent(new CustomEvent('iso-updates-cleared'));
            }
            return;
        }

        if (docs.length > 0) {
            saveSeenDocIds(docs);
        }
        window.dispatchEvent(new CustomEvent('iso-updates-cleared'));
    };

    const hasUnseenUpdates = (): boolean => {
        const cached = getCachedData();
        if (!cached || cached.length === 0) return false;
        const seenIds = getSeenDocIds();
        if (!seenIds) return false;
        const currentIds = getDocumentIds(cached);
        return currentIds.some((id) => !seenIds.has(id));
    };

    const markAsSeen = (): void => {
        const cached = getCachedDataWithMeta();
        if (cached && cached.data.length > 0) {
            saveSeenDocIds(cached.data);
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
            if (Array.isArray(parsed)) {
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
        if (!cached.timestamp) return true;
        return Date.now() - cached.timestamp < STALE_CACHE_TTL_MS;
    };

    const getCachedData = (): PdfDocument[] | null => {
        const cached = getCachedDataWithMeta();
        return cached ? cached.data : null;
    };

    const getCachedPdfs = (): PdfDocument[] | null => getCachedData();

    /**
     * Zapisuje dane do cache z timestampem
     */
    const saveToCache = (data: PdfDocument[]): void => {
        const cacheData: CachedPdfData = {
            data,
            timestamp: Date.now(),
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

    const triggerServerScrape = async (): Promise<boolean> => {
        try {
            const scraperToken = localStorage.getItem('pdfScraperToken') || '';
            const headers: Record<string, string> = {};
            if (scraperToken) {
                headers['X-Scraper-Token'] = scraperToken;
            }

            const response = await fetch(`${RENDER_API_BASE_URL}/api/scrape`, {
                method: 'POST',
                headers,
            });

            if (response.ok) {
                return true;
            }

            if (response.status === 409) {
                debugLog('Scraping jest już w toku na serwerze.');
                return true;
            }

            if (response.status === 429) {
                const retryAfter = response.headers.get('Retry-After');
                debugLog(`Serwer ograniczył ręczne odświeżenie ISO. Retry-After: ${retryAfter || 'brak'}s`);
                return false;
            }

            if (response.status === 401) {
                debugLog('Ręczne uruchomienie scrapera wymaga tokena.');
                return false;
            }

            debugLog(`Nie udało się uruchomić scrapingu. Status: ${response.status}`);
            return false;
        } catch (error) {
            console.warn('Nie można uruchomić scrapingu na serwerze:', error);
            return false;
        }
    };

    const fetchAndCachePdfLinks = async (forceScrape: boolean = false, runServerScrape: boolean = true): Promise<PdfDocument[]> => {
        Shared.setIsoLinkActive(false);

        const cachedWithMeta = getCachedDataWithMeta();

        if (!forceScrape && isCacheFresh(cachedWithMeta)) {
            debugLog('Używam świeżego cache (TTL ok)');
            checkForNewDocuments(cachedWithMeta!.data);
            Shared.setIsoLinkActive(true);
            return cachedWithMeta!.data;
        }

        if (!forceScrape && isCacheUsable(cachedWithMeta) && !isBackgroundRefreshInProgress) {
            debugLog('Używam przestarzałego cache, odświeżam w tle...');
            checkForNewDocuments(cachedWithMeta!.data);
            Shared.setIsoLinkActive(true);

            isBackgroundRefreshInProgress = true;
            fetchFromApi().finally(() => {
                isBackgroundRefreshInProgress = false;
            });

            return cachedWithMeta!.data;
        }

        if (forceScrape && runServerScrape) {
            window.showToast?.('Odświeżanie linków ISO...', 3000);
            await triggerServerScrape();
        }

        const data = await fetchFromApi();
        if (data) {
            return data;
        }

        if (isCacheUsable(cachedWithMeta)) {
            debugLog('API niedostępne, używam przestarzałego cache jako fallback');
            Shared.setIsoLinkActive(true);
            return cachedWithMeta!.data;
        }

        window.showToast?.('Nie można pobrać linków ISO.', 5000);
        Shared.setIsoLinkActive(false);
        return [];
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
        // cleanup
    };

    return {
        fetchAndCachePdfLinks,
        destroy,
        markAsSeen,
        checkForNewDocuments,
        getCachedData,
        getCachedPdfs,
        hasUnseenUpdates,
        getServerStatus,
        triggerScraping: triggerServerScrape,
    };
})();
