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

    const getNodeText = (node) => {
        if (!node) return '';
        return (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    };

    const meaningfulNodes = [];
    const collectMeaningfulNodes = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            if (getNodeText(node).length > 0) {
                meaningfulNodes.push(node);
            }
            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return;

        if (node.nodeName === 'A' || node.nodeName === 'B') {
            meaningfulNodes.push(node);
            return;
        }

        Array.from(node.childNodes).forEach(collectMeaningfulNodes);
    };

    Array.from(container.childNodes).forEach(collectMeaningfulNodes);

    // Regex dla formatu daty YYYY-MM-DD
    const dateRegex = /(\d{4}-\d{2}-\d{2})/;

    const isPdfLink = (href) => /\.pdf(?:$|[?#])/i.test(href || '');

    for (let i = 0; i < meaningfulNodes.length; i++) {
        const linkNode = meaningfulNodes[i];
        if (linkNode.nodeName !== 'A' || !linkNode.href || !isPdfLink(linkNode.href)) {
            continue;
        }

        let date = '';
        let type = '';

        for (let j = i - 1; j >= 0; j--) {
            const previousNode = meaningfulNodes[j];
            if (previousNode.nodeName === 'A') {
                break;
            }

            if (!type && previousNode.nodeName === 'B') {
                type = getNodeText(previousNode);
            }

            if (!date && previousNode.nodeType === Node.TEXT_NODE) {
                const dateMatch = previousNode.textContent.match(dateRegex);
                if (dateMatch) {
                    date = dateMatch[0];
                }
            }

            if (date && type) break;
        }

        if (!date) continue;

        results.push({
            date,
            type,
            title: getNodeText(linkNode),
            url: linkNode.href,
        });
    }

    return results;
}

// Export dla Node.js (testy)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = parseDocumentsInBrowser;
}
