// scripts/scrapped-pdfs.js
export const ScrappedPdfs = (() => {
    const RENDER_API_URL = 'https://pdf-scraper-api-5qqr.onrender.com/api/pdfs';
    let allLinksData = [];

    const displayLinks = (linksToDisplay) => {
        const tableBody = document.getElementById('pdf-table-body');
        if (!tableBody) return;

        // Clear existing content
        while (tableBody.firstChild) {
            tableBody.removeChild(tableBody.firstChild);
        }

        if (linksToDisplay.length === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 3;
            cell.textContent = 'Brak wyników.';
            row.appendChild(cell);
            tableBody.appendChild(row);
            return;
        }

        linksToDisplay.forEach((linkData) => {
            const row = document.createElement('tr');

            // Date cell
            const dateCell = document.createElement('td');
            dateCell.textContent = linkData.date;
            row.appendChild(dateCell);

            // Type cell
            const typeCell = document.createElement('td');
            const badge = document.createElement('span');
            badge.className = 'doc-type-badge';
            badge.textContent = linkData.type; // Safe from XSS
            typeCell.appendChild(badge);
            row.appendChild(typeCell);

            // Link cell
            const linkCell = document.createElement('td');
            const anchor = document.createElement('a');
            anchor.href = linkData.url; // Still need to be careful with href if it can be javascript:, but usually scraper controls this
            anchor.target = '_blank';

            // Icon
            const icon = document.createElement('i');
            icon.className = 'fas fa-file-pdf';
            anchor.appendChild(icon);

            // Text
            anchor.appendChild(document.createTextNode(` ${linkData.title}`)); // Safe from XSS

            linkCell.appendChild(anchor);
            row.appendChild(linkCell);

            tableBody.appendChild(row);
        });
    };

    const fetchAndDisplayPdfLinks = async () => {
        const container = document.getElementById('pdf-links-container');
        const tableContainer = document.getElementById('pdf-table-container');

        if (!container) return;
        container.textContent = 'Ładowanie linków...';

        try {
            const response = await fetch(RENDER_API_URL);
            if (!response.ok) throw new Error(`Błąd HTTP: ${response.status}`);

            // API zwraca teraz kompletną, posortowaną tablicę obiektów
            const documents = await response.json();

            if (!documents || !Array.isArray(documents) || documents.length === 0) {
                container.textContent = 'Brak dostępnych linków PDF.';
                return;
            }

            // Nie musimy już nic parsować, dane są gotowe. Sortujemy po dacie.
            allLinksData = documents.sort((a, b) => b.date.localeCompare(a.date));

            container.style.display = 'none';
            if (tableContainer) {
                tableContainer.style.display = 'block';
            }

            displayLinks(allLinksData);
        } catch (error) {
            console.error('Błąd podczas pobierania linków PDF:', error);
            container.textContent = 'Wystąpił błąd podczas ładowania linków.';
        }
    };

    const initSearch = () => {
        const searchInput = document.getElementById('pdfSearchInput');
        if (!searchInput) return;

        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const filteredLinks = allLinksData.filter(
                (link) =>
                    (link.title && link.title.toLowerCase().includes(searchTerm)) ||
                    (link.type && link.type.toLowerCase().includes(searchTerm)) ||
                    (link.date && link.date.toLowerCase().includes(searchTerm)),
            );
            displayLinks(filteredLinks);
        });
    };

    const init = () => {
        const fetchPromise = fetchAndDisplayPdfLinks();
        initSearch();
        return fetchPromise;
    };

    const destroy = () => {
        allLinksData = [];
    };

    return { init, destroy };
})();

// Backward compatibility
if (typeof window !== 'undefined') {
    window.ScrappedPdfs = ScrappedPdfs;
}
