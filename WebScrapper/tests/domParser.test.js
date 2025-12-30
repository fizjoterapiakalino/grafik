const parseDocumentsInBrowser = require('../domParser');

/**
 * @jest-environment jsdom
 */

describe('DOM Parser Logic', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="tresc"></div>';
    });

    test('should return empty array if container is missing', () => {
        document.body.innerHTML = ''; // No #tresc
        const results = parseDocumentsInBrowser();
        expect(results).toEqual([]);
    });

    test('should parse correct sequence of Date -> B -> A', () => {
        const container = document.getElementById('tresc');
        container.innerHTML = `
            2023-10-25
            <b>Grafik</b>
            <a href="http://example.com/grafik.pdf">Pobierz</a>
        `;

        const results = parseDocumentsInBrowser();
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            date: '2023-10-25',
            type: 'Grafik',
            title: 'Pobierz',
            url: 'http://example.com/grafik.pdf',
        });
    });

    test('should ignore random text and whitespace', () => {
        const container = document.getElementById('tresc');
        // Add extra whitespace and text nodes
        container.innerHTML = `
            Random text

            2023-10-26

            <b>Zmiany</b>

            <a href="http://example.com/zmiany.pdf">Link</a>

            Footer text
        `;

        const results = parseDocumentsInBrowser();
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            date: '2023-10-26',
            type: 'Zmiany',
            title: 'Link',
            url: 'http://example.com/zmiany.pdf',
        });
    });

    test('should handle multiple entries', () => {
        const container = document.getElementById('tresc');
        container.innerHTML = `
            2023-10-27 <b>Type1</b> <a href="link1.pdf">Title1</a>
            Some separator
            2023-10-28 <b>Type2</b> <a href="link2.pdf">Title2</a>
        `;

        const results = parseDocumentsInBrowser();
        expect(results).toHaveLength(2);
        expect(results[0].date).toBe('2023-10-27');
        expect(results[1].date).toBe('2023-10-28');
    });

    test('should not parse incomplete sequences', () => {
        const container = document.getElementById('tresc');
        container.innerHTML = `
            2023-10-29
            <b>Only Type</b>
            <!-- Missing Link -->
        `;

        const results = parseDocumentsInBrowser();
        expect(results).toHaveLength(0);
    });
});
