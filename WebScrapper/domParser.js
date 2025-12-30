/**
 * DOM Parser dla dokumentów ISO/PDF
 *
 * Ta funkcja jest uruchamiana w kontekście przeglądarki (Puppeteer)
 * oraz w testach jednostkowych (jsdom).
 *
 * WYMOGI:
 * - Musi być 'czysta' i nie zależeć od zewnętrznych zmiennych domknięcia
 * - Musi działać zarówno w Node.js (przez Puppeteer) jak i w testach
 *
 * STRUKTURA PARSOWANEGO HTML:
 * Oczekiwana sekwencja węzłów:
 *   TextNode(data: "YYYY-MM-DD") -> <b>Typ dokumentu</b> -> <a href="url">Tytuł</a>
 *
 * @returns {Array<{date: string, type: string, title: string, url: string}>}
 */
function parseDocumentsInBrowser() {
    const results = [];
    const container = document.querySelector('div#tresc');

    if (!container) {
        console.warn('parseDocumentsInBrowser: Nie znaleziono kontenera #tresc');
        return [];
    }

    // Pobieramy wszystkie elementy (węzły) wewnątrz kontenera
    const nodes = Array.from(container.childNodes);

    // Filtrujemy tylko istotne węzły: TextNode (nie puste) i Elementy
    // To ułatwia nawigację, bo ignoruje przypadkowe spacje/znaki nowej linii
    const meaningfulNodes = nodes.filter((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent.trim().length > 0;
        }
        return node.nodeType === Node.ELEMENT_NODE;
    });

    // Regex dla formatu daty YYYY-MM-DD
    const dateRegex = /(\d{4}-\d{2}-\d{2})/;

    for (let i = 0; i < meaningfulNodes.length; i++) {
        const currentNode = meaningfulNodes[i];

        // Krok 1: Szukamy węzła tekstowego, który zawiera datę
        if (currentNode.nodeType === Node.TEXT_NODE && dateRegex.test(currentNode.textContent)) {
            // Krok 2: Sprawdzamy sekwencję: Data -> <b>Typ</b> -> <a>Link</a>
            // W meaningfulNodes powinny to być kolejne elementy: i+1 oraz i+2
            const typeNode = meaningfulNodes[i + 1];
            const linkNode = meaningfulNodes[i + 2];

            // Walidacja sekwencji
            const isValidSequence =
                typeNode && typeNode.nodeName === 'B' && linkNode && linkNode.nodeName === 'A' && linkNode.href;

            if (isValidSequence) {
                const dateMatch = currentNode.textContent.match(dateRegex);

                if (dateMatch) {
                    // Bezpieczne pobieranie tekstu (innerText dla przeglądarki, textContent dla jsdom)
                    const getNodeText = (node) => {
                        if (!node) return '';
                        return (node.innerText || node.textContent || '').trim();
                    };

                    results.push({
                        date: dateMatch[0],
                        type: getNodeText(typeNode),
                        title: getNodeText(linkNode),
                        url: linkNode.href,
                    });

                    // Przeskakujemy przetworzone elementy (optymalizacja)
                    i += 2;
                }
            }
        }
    }

    return results;
}

// Export dla Node.js (testy)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = parseDocumentsInBrowser;
}
