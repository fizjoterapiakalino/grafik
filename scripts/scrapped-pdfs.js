const ScrappedPdfs = (() => {
    const SCRAPED_PDFS_CACHE_KEY = 'scrapedPdfLinks'; // Klucz do localStorage

    const fetchAndDisplayPdfLinks = () => {
        const container = document.getElementById('pdf-links-container');
        if (!container) {
            console.error('Nie znaleziono kontenera na linki PDF.');
            return;
        }
        container.innerHTML = '<p>Ładowanie linków...</p>';

        try {
            const cachedLinks = localStorage.getItem(SCRAPED_PDFS_CACHE_KEY);
            const links = cachedLinks ? JSON.parse(cachedLinks) : [];

            if (!links || links.length === 0) {
                container.innerHTML = '<p>Brak dostępnych linków PDF. Spróbuj odświeżyć stronę ISO, aby pobrać najnowsze linki.</p>';
                return;
            }

            const ul = document.createElement('ul');
            ul.className = 'pdf-link-list'; // Klasa do ewentualnej stylizacji

            links.forEach(link => {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.href = link;
                a.target = "_blank"; // Otwórz w nowej karcie
                a.textContent = decodeURIComponent(link.substring(link.lastIndexOf('/') + 1)); // Wyświetl samą nazwę pliku
                li.appendChild(a);
                ul.appendChild(li);
            });
            container.innerHTML = '';
            container.appendChild(ul);

        } catch (error) {
            console.error('Błąd podczas pobierania linków PDF:', error);
            container.innerHTML = '<p>Wystąpił błąd podczas ładowania linków. Spróbuj ponownie później.</p>';
        }
    };

    const init = () => {
        fetchAndDisplayPdfLinks();
    };
    
    // Na tej prostej stronie nie ma potrzeby implementowania funkcji destroy
    const destroy = () => {};

    return {
        init,
        destroy
    };
})();
