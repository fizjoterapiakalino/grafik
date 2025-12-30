// scripts/scrapped-pdfs.ts
import { PdfService, PdfDocument } from './pdf-service.js';

/**
 * Mapowanie typów dokumentów na klasy CSS
 */
interface TypeMapping {
    match: string;
    class: string;
}

/**
 * Interfejs publicznego API ScrappedPdfs
 */
interface ScrappedPdfsAPI {
    init(): Promise<void>;
    destroy(): void;
    openPdf(url: string, docTitle: string): void;
    actualOpenPdf(url: string, docTitle: string): void;
}

/**
 * Moduł do wyświetlania i zarządzania listą dokumentów PDF/ISO
 */
export const ScrappedPdfs: ScrappedPdfsAPI = (() => {
    let allLinksData: PdfDocument[] = [];
    let isModalInitialized = false;

    const TYPE_CLASS_MAP: TypeMapping[] = [
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

    const getTypeClass = (type: string | undefined): string => {
        const typeLower = (type || '').toLowerCase();
        for (const mapping of TYPE_CLASS_MAP) {
            if (typeLower.includes(mapping.match)) {
                return mapping.class;
            }
        }
        return '';
    };

    const createTableRow = (linkData: PdfDocument): HTMLTableRowElement => {
        const row = document.createElement('tr');

        const dateCell = document.createElement('td');
        dateCell.textContent = linkData.date || '';
        row.appendChild(dateCell);

        const typeCell = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = 'doc-type-badge';

        const typeClass = getTypeClass(linkData.type);
        if (typeClass) {
            badge.classList.add(typeClass);
        }

        badge.textContent = linkData.type || '';
        typeCell.appendChild(badge);
        row.appendChild(typeCell);

        const linkCell = document.createElement('td');
        const anchor = document.createElement('a');
        anchor.href = linkData.url;
        anchor.className = 'pdf-link';

        anchor.addEventListener('click', (e: MouseEvent) => {
            e.preventDefault();
            openPdf(linkData.url, linkData.title);
        });

        const icon = document.createElement('i');
        icon.className = 'fas fa-file-pdf';
        anchor.appendChild(icon);

        anchor.appendChild(document.createTextNode(` ${linkData.title}`));

        linkCell.appendChild(anchor);
        row.appendChild(linkCell);

        return row;
    };

    const displayLinks = (linksToDisplay: PdfDocument[]): void => {
        const tableBody = document.getElementById('pdf-table-body');
        if (!tableBody) return;

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

        const fragment = document.createDocumentFragment();
        linksToDisplay.forEach((linkData) => {
            fragment.appendChild(createTableRow(linkData));
        });
        tableBody.appendChild(fragment);
    };

    const fetchAndDisplayPdfLinks = async (): Promise<void> => {
        const container = document.getElementById('pdf-links-container');
        const tableContainer = document.getElementById('pdf-table-container');

        if (!container) return;
        container.textContent = 'Ładowanie dokumentów...';

        try {
            const documents = await PdfService.fetchAndCachePdfLinks(true);

            if (!documents || !Array.isArray(documents) || documents.length === 0) {
                container.textContent = 'Brak dostępnych dokumentów.';
                return;
            }

            allLinksData = documents.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

            container.style.display = 'none';
            if (tableContainer) {
                tableContainer.style.display = 'block';
            }

            const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
            if (searchInput && searchInput.value.trim()) {
                handleGlobalSearch(new CustomEvent('app:search', { detail: { searchTerm: searchInput.value.trim() } }));
            } else {
                displayLinks(allLinksData);
            }
        } catch (error) {
            console.error('Błąd podczas pobierania dokumentów PDF:', error);
            container.textContent = 'Wystąpił błąd podczas ładowania dokumentów.';
        }
    };

    const initRefresh = (): void => {
        const refreshBtn = document.getElementById('refreshPdfsBtn');
        if (!refreshBtn) return;

        const handleRefresh = async (): Promise<void> => {
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

    const handleGlobalSearch = (e: CustomEvent<{ searchTerm: string }>): void => {
        const searchTerm = (e.detail.searchTerm || '').toLowerCase();

        const filteredLinks = allLinksData.filter(
            (link) =>
                (link.title && link.title.toLowerCase().includes(searchTerm)) ||
                (link.type && link.type.toLowerCase().includes(searchTerm)) ||
                (link.date && link.date.toLowerCase().includes(searchTerm))
        );

        displayLinks(filteredLinks);
    };

    // Modal Functions
    let pendingUrl: string | null = null;
    let pendingTitle: string | null = null;
    let isIsoAuthenticated = false;

    const closeModal = (): void => {
        const modal = document.getElementById('pdfModal');
        const iframe = document.getElementById('pdfIframe') as HTMLIFrameElement | null;
        if (modal) modal.style.display = 'none';
        if (iframe) iframe.src = '';
    };

    const closeLoginModal = (): void => {
        const loginModal = document.getElementById('isoLoginModal');
        if (loginModal) {
            loginModal.style.display = 'none';
            const l = document.getElementById('isoLogin') as HTMLInputElement | null;
            const p = document.getElementById('isoPassword') as HTMLInputElement | null;
            if (l) l.value = '';
            if (p) p.value = '';
        }
        pendingUrl = null;
        pendingTitle = null;
    };

    const openPdf = (url: string, docTitle: string): void => {
        if (isIsoAuthenticated) {
            actualOpenPdf(url, docTitle);
        } else {
            pendingUrl = url;
            pendingTitle = docTitle;
            const loginModal = document.getElementById('isoLoginModal');
            if (loginModal) {
                loginModal.style.display = 'flex';
            } else {
                actualOpenPdf(url, docTitle);
            }
        }
    };

    const actualOpenPdf = (url: string, docTitle: string): void => {
        const modal = document.getElementById('pdfModal');
        const openNewTabBtn = document.getElementById('pdfOpenNewTabBtn') as HTMLAnchorElement | null;
        const iframe = document.getElementById('pdfIframe') as HTMLIFrameElement | null;
        const title = document.getElementById('pdfModalTitle');

        if (!modal || !iframe) return;

        if (openNewTabBtn) openNewTabBtn.href = url;
        if (title) title.textContent = docTitle || 'Podgląd dokumentu';

        const separator = url.includes('#') ? '&' : '#';
        const cleanUrl = `${url}${separator}navpanes=0&toolbar=0&view=FitH`;

        iframe.src = cleanUrl;
        modal.style.display = 'flex';
    };

    const initModal = (): void => {
        if (isModalInitialized) return;

        const modal = document.getElementById('pdfModal');
        const closeBtn = document.getElementById('pdfCloseBtn');
        const loginModal = document.getElementById('isoLoginModal');
        const loginConfirmBtn = document.getElementById('isoLoginConfirmBtn');
        const loginCancelBtn = document.getElementById('isoLoginCancelBtn');

        if (!modal) return;

        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }

        modal.addEventListener('click', (e: MouseEvent) => {
            if (e.target === modal) closeModal();
        });

        if (loginConfirmBtn) {
            loginConfirmBtn.addEventListener('click', () => {
                isIsoAuthenticated = true;
                closeLoginModal();
                if (pendingUrl) {
                    actualOpenPdf(pendingUrl, pendingTitle || '');
                }
            });
        }

        if (loginCancelBtn) {
            loginCancelBtn.addEventListener('click', closeLoginModal);
        }

        document.addEventListener('keydown', (e: KeyboardEvent) => {
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

    const init = async (): Promise<void> => {
        await fetchAndDisplayPdfLinks();
        document.addEventListener('app:search', handleGlobalSearch as EventListener);
        initRefresh();
        initModal();
    };

    const destroy = (): void => {
        allLinksData = [];
        document.removeEventListener('app:search', handleGlobalSearch as EventListener);
    };

    return {
        init,
        destroy,
        openPdf,
        actualOpenPdf,
    };
})();

// Backward compatibility
declare global {
    interface Window {
        ScrappedPdfs: ScrappedPdfsAPI;
    }
}

window.ScrappedPdfs = ScrappedPdfs;
