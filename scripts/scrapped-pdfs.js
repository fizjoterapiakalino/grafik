// scripts/scrapped-pdfs.js
import { PdfService } from './pdf-service.js';

/**
 * Moduł do wyświetlania i zarządzania listą dokumentów PDF/ISO
 */
export const ScrappedPdfs = (() => {
    const RENDER_API_URL = 'https://pdf-scraper-api-5qqr.onrender.com/api/pdfs';

    let allLinksData = [];
    let isModalInitialized = false;

    // Mapowanie typów dokumentów na klasy CSS
    const TYPE_CLASS_MAP = [
        { match: 'nfz', class: 'type-nfz' },
        { match: 'pisma', class: 'type-pisma' },
        { match: 'akty prawne', class: 'type-akty' },
        { match: 'komisja socjalna', class: 'type-socjalna' },
        { match: 'socjalne', class: 'type-socjalna' },
        { match: 'szkolenia', class: 'type-szkolenia' },
        { match: 'szkoleń', class: 'type-szkolenia' },
        { match: 'iso', class: 'type-iso' },
        { match: 'karty charakterystyki', class: 'type-med' },
        { match: 'ulotki', class: 'type-med' },
        { match: 'druki', class: 'type-druk' },
        { match: 'wywieszki', class: 'type-druk' },
        { match: 'covid', class: 'type-covid' },
    ];

    /**
     * Zwraca klasę CSS dla typu dokumentu
     * @param {string} type - Typ dokumentu
     * @returns {string} - Klasa CSS
     */
    const getTypeClass = (type) => {
        const typeLower = (type || '').toLowerCase();
        for (const mapping of TYPE_CLASS_MAP) {
            if (typeLower.includes(mapping.match)) {
                return mapping.class;
            }
        }
        return '';
    };

    /**
     * Tworzy wiersz tabeli dla dokumentu
     * @param {Object} linkData - Dane dokumentu
     * @returns {HTMLTableRowElement}
     */
    const createTableRow = (linkData) => {
        const row = document.createElement('tr');

        // Komórka z datą
        const dateCell = document.createElement('td');
        dateCell.textContent = linkData.date;
        row.appendChild(dateCell);

        // Komórka z typem (badge)
        const typeCell = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = 'doc-type-badge';

        const typeClass = getTypeClass(linkData.type);
        if (typeClass) {
            badge.classList.add(typeClass);
        }

        badge.textContent = linkData.type;
        typeCell.appendChild(badge);
        row.appendChild(typeCell);

        // Komórka z linkiem
        const linkCell = document.createElement('td');
        const anchor = document.createElement('a');
        anchor.href = linkData.url;
        anchor.className = 'pdf-link';

        anchor.addEventListener('click', (e) => {
            e.preventDefault();
            openPdf(linkData.url, linkData.title);
        });

        // Ikona PDF
        const icon = document.createElement('i');
        icon.className = 'fas fa-file-pdf';
        anchor.appendChild(icon);

        // Tekst
        anchor.appendChild(document.createTextNode(` ${linkData.title}`));

        linkCell.appendChild(anchor);
        row.appendChild(linkCell);

        return row;
    };

    /**
     * Wyświetla listę dokumentów w tabeli
     * @param {Array} linksToDisplay - Lista dokumentów do wyświetlenia
     */
    const displayLinks = (linksToDisplay) => {
        const tableBody = document.getElementById('pdf-table-body');
        if (!tableBody) return;

        // Wyczyść zawartość
        tableBody.innerHTML = '';

        if (linksToDisplay.length === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 3;
            cell.textContent = 'Brak wyników.';
            cell.className = 'empty-message';
            row.appendChild(cell);
            tableBody.appendChild(row);
            return;
        }

        // Użyj DocumentFragment dla wydajności
        const fragment = document.createDocumentFragment();
        linksToDisplay.forEach((linkData) => {
            fragment.appendChild(createTableRow(linkData));
        });
        tableBody.appendChild(fragment);
    };

    /**
     * Pobiera i wyświetla dokumenty PDF
     */
    const fetchAndDisplayPdfLinks = async () => {
        const container = document.getElementById('pdf-links-container');
        const tableContainer = document.getElementById('pdf-table-container');

        if (!container) return;
        container.textContent = 'Ładowanie dokumentów...';

        try {
            // Użyj PdfService do pobrania danych z cache/API
            const documents = await PdfService.fetchAndCachePdfLinks(true);

            if (!documents || !Array.isArray(documents) || documents.length === 0) {
                container.textContent = 'Brak dostępnych dokumentów.';
                return;
            }

            // Sortuj po dacie (najnowsze pierwsze)
            allLinksData = documents.sort((a, b) => b.date.localeCompare(a.date));

            container.style.display = 'none';
            if (tableContainer) {
                tableContainer.style.display = 'block';
            }

            // Zastosuj istniejący filtr wyszukiwania
            const searchInput = document.getElementById('searchInput');
            if (searchInput && searchInput.value.trim()) {
                handleGlobalSearch({ detail: { searchTerm: searchInput.value.trim() } });
            } else {
                displayLinks(allLinksData);
            }
        } catch (error) {
            console.error('Błąd podczas pobierania dokumentów PDF:', error);
            container.textContent = 'Wystąpił błąd podczas ładowania dokumentów.';
        }
    };

    /**
     * Inicjalizuje przycisk odświeżania
     */
    const initRefresh = () => {
        const refreshBtn = document.getElementById('refreshPdfsBtn');
        if (!refreshBtn) return;

        const handleRefresh = async () => {
            if (refreshBtn.classList.contains('loading')) return;

            refreshBtn.classList.add('loading');
            const span = refreshBtn.querySelector('span');
            const originalText = span ? span.textContent : 'Odśwież';
            if (span) span.textContent = 'Ładowanie...';

            try {
                await fetchAndDisplayPdfLinks();
            } finally {
                refreshBtn.classList.remove('loading');
                if (span) span.textContent = originalText;
            }
        };

        refreshBtn.addEventListener('click', handleRefresh);
    };

    /**
     * Obsługuje globalne wyszukiwanie
     * @param {CustomEvent} e - Event z terminem wyszukiwania
     */
    const handleGlobalSearch = (e) => {
        const searchTerm = (e.detail.searchTerm || '').toLowerCase();

        const filteredLinks = allLinksData.filter(
            (link) =>
                (link.title && link.title.toLowerCase().includes(searchTerm)) ||
                (link.type && link.type.toLowerCase().includes(searchTerm)) ||
                (link.date && link.date.toLowerCase().includes(searchTerm)),
        );

        displayLinks(filteredLinks);
    };

    // =====================
    // Modal Functions
    // =====================

    let pendingUrl = null;
    let pendingTitle = null;
    let isIsoAuthenticated = false;

    /**
     * Zamyka modal PDF
     */
    const closeModal = () => {
        const modal = document.getElementById('pdfModal');
        const iframe = document.getElementById('pdfIframe');
        if (modal) modal.style.display = 'none';
        if (iframe) iframe.src = '';
    };

    /**
     * Zamyka modal logowania ISO
     */
    const closeLoginModal = () => {
        const loginModal = document.getElementById('isoLoginModal');
        if (loginModal) {
            loginModal.style.display = 'none';
            const l = document.getElementById('isoLogin');
            const p = document.getElementById('isoPassword');
            if (l) l.value = '';
            if (p) p.value = '';
        }
        pendingUrl = null;
        pendingTitle = null;
    };

    /**
     * Otwiera dokument PDF w oknie modalnym
     * @param {string} url - URL dokumentu
     * @param {string} docTitle - Tytuł dokumentu
     */
    const openPdf = (url, docTitle) => {
        if (isIsoAuthenticated) {
            actualOpenPdf(url, docTitle);
        } else {
            pendingUrl = url;
            pendingTitle = docTitle;
            const loginModal = document.getElementById('isoLoginModal');
            if (loginModal) {
                loginModal.style.display = 'flex';
            } else {
                // Fallback - otwórz bezpośrednio jeśli nie ma modalu logowania
                actualOpenPdf(url, docTitle);
            }
        }
    };

    /**
     * Faktycznie otwiera PDF (po autoryzacji)
     * @param {string} url - URL dokumentu
     * @param {string} docTitle - Tytuł dokumentu
     */
    const actualOpenPdf = (url, docTitle) => {
        const modal = document.getElementById('pdfModal');
        const openNewTabBtn = document.getElementById('pdfOpenNewTabBtn');
        const iframe = document.getElementById('pdfIframe');
        const title = document.getElementById('pdfModalTitle');

        if (!modal || !iframe) return;

        if (openNewTabBtn) openNewTabBtn.href = url;
        if (title) title.textContent = docTitle || 'Podgląd dokumentu';

        // Dodaj parametry dla lepszego wyświetlania PDF
        const separator = url.includes('#') ? '&' : '#';
        const cleanUrl = `${url}${separator}navpanes=0&toolbar=0&view=FitH`;

        iframe.src = cleanUrl;
        modal.style.display = 'flex';
    };

    /**
     * Inicjalizuje modal PDF
     */
    const initModal = () => {
        if (isModalInitialized) return;

        const modal = document.getElementById('pdfModal');
        const closeBtn = document.getElementById('pdfCloseBtn');
        const loginModal = document.getElementById('isoLoginModal');
        const loginConfirmBtn = document.getElementById('isoLoginConfirmBtn');
        const loginCancelBtn = document.getElementById('isoLoginCancelBtn');

        if (!modal) return;

        // Zamknij modal przez przycisk
        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }

        // Zamknij modal przez kliknięcie w tło
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        // Obsługa modalu logowania
        if (loginConfirmBtn) {
            loginConfirmBtn.addEventListener('click', () => {
                isIsoAuthenticated = true;
                closeLoginModal();
                if (pendingUrl) {
                    actualOpenPdf(pendingUrl, pendingTitle);
                }
            });
        }

        if (loginCancelBtn) {
            loginCancelBtn.addEventListener('click', closeLoginModal);
        }

        // Obsługa klawisza Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (modal.style.display === 'flex') {
                    closeModal();
                }
                if (loginModal && loginModal.style.display === 'flex') {
                    closeLoginModal();
                }
            }
        });

        isModalInitialized = true;
    };

    // =====================
    // Public API
    // =====================

    /**
     * Inicjalizuje moduł
     */
    const init = () => {
        const fetchPromise = fetchAndDisplayPdfLinks();
        document.addEventListener('app:search', handleGlobalSearch);
        initRefresh();
        initModal();
        return fetchPromise;
    };

    /**
     * Czyści zasoby modułu
     */
    const destroy = () => {
        allLinksData = [];
        document.removeEventListener('app:search', handleGlobalSearch);
    };

    return {
        init,
        destroy,
        openPdf,
        actualOpenPdf,
    };
})();

// Backward compatibility
if (typeof window !== 'undefined') {
    window.ScrappedPdfs = ScrappedPdfs;
}
