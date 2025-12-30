const parseDocumentsInBrowser = require('../domParser');

/**
 * @jest-environment jsdom
 */

describe('DOM Parser Logic', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="tresc"></div>';
    });

    describe('Edge cases', () => {
        test('should return empty array if container is missing', () => {
            document.body.innerHTML = ''; // No #tresc
            const results = parseDocumentsInBrowser();
            expect(results).toEqual([]);
        });

        test('should return empty array for empty container', () => {
            const container = document.getElementById('tresc');
            container.innerHTML = '';
            const results = parseDocumentsInBrowser();
            expect(results).toEqual([]);
        });

        test('should handle container with only whitespace', () => {
            const container = document.getElementById('tresc');
            container.innerHTML = '   \n\n   ';
            const results = parseDocumentsInBrowser();
            expect(results).toEqual([]);
        });
    });

    describe('Basic parsing', () => {
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
            expect(results).toEqual([]);
        });
    });

    describe('Date format validation', () => {
        test('should match various valid date formats', () => {
            const container = document.getElementById('tresc');
            container.innerHTML = `
                2023-01-01 <b>Type</b> <a href="link.pdf">Title</a>
                2024-12-31 <b>Type</b> <a href="link2.pdf">Title2</a>
            `;

            const results = parseDocumentsInBrowser();
            expect(results).toHaveLength(2);
            expect(results[0].date).toBe('2023-01-01');
            expect(results[1].date).toBe('2024-12-31');
        });

        test('should not match invalid date formats', () => {
            const container = document.getElementById('tresc');
            container.innerHTML = `
                23-10-25 <b>Type</b> <a href="link.pdf">Title</a>
                2023/10/25 <b>Type</b> <a href="link2.pdf">Title2</a>
            `;

            const results = parseDocumentsInBrowser();
            expect(results).toEqual([]);
        });

        test('should extract date when embedded in text', () => {
            const container = document.getElementById('tresc');
            container.innerHTML = `
                Data dokumentu: 2023-10-25 - ostatnia aktualizacja
                <b>Procedura</b>
                <a href="http://example.com/proc.pdf">Procedura XYZ</a>
            `;

            const results = parseDocumentsInBrowser();
            expect(results).toHaveLength(1);
            expect(results[0].date).toBe('2023-10-25');
        });
    });

    describe('Special characters and encoding', () => {
        test('should handle Polish characters in type and title', () => {
            const container = document.getElementById('tresc');
            container.innerHTML = `
                2023-10-25
                <b>Świąteczne procedury</b>
                <a href="http://example.com/doc.pdf">Załącznik nr 1</a>
            `;

            const results = parseDocumentsInBrowser();
            expect(results).toHaveLength(1);
            expect(results[0].type).toBe('Świąteczne procedury');
            expect(results[0].title).toBe('Załącznik nr 1');
        });

        test('should trim whitespace from type and title', () => {
            const container = document.getElementById('tresc');
            container.innerHTML = `
                2023-10-25
                <b>   Spaced Type   </b>
                <a href="http://example.com/doc.pdf">   Spaced Title   </a>
            `;

            const results = parseDocumentsInBrowser();
            expect(results).toHaveLength(1);
            expect(results[0].type).toBe('Spaced Type');
            expect(results[0].title).toBe('Spaced Title');
        });
    });

    describe('URL handling', () => {
        test('should capture full URL with query params', () => {
            const container = document.getElementById('tresc');
            container.innerHTML = `
                2023-10-25
                <b>Type</b>
                <a href="http://example.com/doc.pdf?version=2&lang=pl">Title</a>
            `;

            const results = parseDocumentsInBrowser();
            expect(results).toHaveLength(1);
            expect(results[0].url).toContain('version=2');
            expect(results[0].url).toContain('lang=pl');
        });

        test('should skip links without href', () => {
            const container = document.getElementById('tresc');
            container.innerHTML = `
                2023-10-25
                <b>Type</b>
                <a>Missing href</a>
            `;

            const results = parseDocumentsInBrowser();
            expect(results).toEqual([]);
        });
    });

    describe('Mixed content', () => {
        test('should handle real-world like structure with various document types', () => {
            const container = document.getElementById('tresc');
            container.innerHTML = `
                <h2>Dokumenty ISO</h2>
                
                2024-01-15 <b>ISO 9001</b> <a href="http://example.com/iso9001.pdf">Procedura jakości</a>
                
                <hr>
                
                2024-01-10 <b>NFZ</b> <a href="http://example.com/nfz.pdf">Zarządzenie prezesa</a>
                
                2023-12-20 <b>Akty prawne</b> <a href="http://example.com/akty.pdf">Rozporządzenie MZ</a>
                
                <div>Some other content</div>
            `;

            const results = parseDocumentsInBrowser();
            expect(results).toHaveLength(3);
            expect(results[0].date).toBe('2024-01-15');
            expect(results[0].type).toBe('ISO 9001');
            expect(results[1].type).toBe('NFZ');
            expect(results[2].type).toBe('Akty prawne');
        });
    });
});
