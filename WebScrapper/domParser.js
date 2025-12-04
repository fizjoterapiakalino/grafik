// Funkcja parsująca dokument
// Ta funkcja będzie uruchamiana w kontekście przeglądarki (Puppeteer) oraz w testach (jsdom).
// Musi być 'czysta' i nie zależeć od zewnętrznych zmiennych domknięcia.

function parseDocumentsInBrowser() {
    const results = [];
    const container = document.querySelector('div#tresc');
    if (!container) return [];

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

    for (let i = 0; i < meaningfulNodes.length; i++) {
        const currentNode = meaningfulNodes[i];

        // Krok 1: Szukamy węzła tekstowego, który zawiera datę
        if (currentNode.nodeType === Node.TEXT_NODE && /\d{4}-\d{2}-\d{2}/.test(currentNode.textContent)) {
            // Krok 2: Sprawdzamy sekwencję: Data -> <b>Typ</b> -> <a>Link</a>
            // W meaningfulNodes powinny to być kolejne elementy: i+1 oraz i+2
            const typeNode = meaningfulNodes[i + 1];
            const linkNode = meaningfulNodes[i + 2];

            if (typeNode && typeNode.nodeName === 'B' && linkNode && linkNode.nodeName === 'A') {
                const dateMatch = currentNode.textContent.match(/(\d{4}-\d{2}-\d{2})/);

                if (dateMatch) {
                    results.push({
                        date: dateMatch[0],
                        type: typeNode.innerText ? typeNode.innerText.trim() : typeNode.textContent.trim(),
                        title: linkNode.innerText ? linkNode.innerText.trim() : linkNode.textContent.trim(),
                        url: linkNode.href,
                    });
                    // Przeskakujemy przetworzone elementy
                    i += 2;
                }
            }
        }
    }
    return results;
}

module.exports = parseDocumentsInBrowser;
