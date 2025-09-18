const ScrappedPdfs = (() => {
    const RENDER_API_URL = 'https://pdf-scraper-api-5qqr.onrender.com/api/pdfs';
    let allLinksData = [];

    const displayLinks = (linksToDisplay) => {
        const tableBody = document.getElementById('pdf-table-body');
        if (!tableBody) return;
        tableBody.innerHTML = '';

        if (linksToDisplay.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="3">Brak wyników.</td></tr>';
            return;
        }

        linksToDisplay.forEach(linkData => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${linkData.date}</td>
                <td><span class="doc-type-badge">${linkData.type}</span></td>
                <td><a href="${linkData.url}" target="_blank"><i class="fas fa-file-pdf"></i> ${linkData.title}</a></td>
            `;
            tableBody.appendChild(row);
        });
    };

    const fetchAndDisplayPdfLinks = async () => {
        const container = document.getElementById('pdf-links-container');
        if (!container) return;
        container.innerHTML = '<p>Ładowanie linków...</p>';

        try {
            const response = await fetch(RENDER_API_URL);
            if (!response.ok) throw new Error(`Błąd HTTP: ${response.status}`);
            
            // API zwraca teraz kompletną, posortowaną tablicę obiektów
            const documents = await response.json();

            if (!documents || !Array.isArray(documents) || documents.length === 0) {
                container.innerHTML = '<p>Brak dostępnych linków PDF.</p>';
                return;
            }

            // Nie musimy już nic parsować, dane są gotowe. Sortujemy po dacie.
            allLinksData = documents.sort((a, b) => b.date.localeCompare(a.date));
            
            container.style.display = 'none';
            document.getElementById('pdf-table-container').style.display = 'block';
            
            displayLinks(allLinksData);

        } catch (error) {
            console.error('Błąd podczas pobierania linków PDF:', error);
            container.innerHTML = '<p>Wystąpił błąd podczas ładowania linków.</p>';
        }
    };
    
    const initSearch = () => {
        const searchInput = document.getElementById('pdfSearchInput');
        if (!searchInput) return;

        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const filteredLinks = allLinksData.filter(link => 
                link.title.toLowerCase().includes(searchTerm) ||
                link.type.toLowerCase().includes(searchTerm) ||
                link.date.toLowerCase().includes(searchTerm)
            );
            displayLinks(filteredLinks);
        });
    };

    const init = () => {
        fetchAndDisplayPdfLinks();
        initSearch();
    };

    const destroy = () => { allLinksData = []; };

    return { init, destroy };
})();