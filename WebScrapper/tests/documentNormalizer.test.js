const { createDocumentId, normalizeDocuments, normalizeText, normalizeUrl } = require('../documentNormalizer');

describe('documentNormalizer', () => {
    test('normalizes whitespace in text fields', () => {
        expect(normalizeText('  ISO   9001 \n procedura  ')).toBe('ISO 9001 procedura');
    });

    test('resolves relative URLs against source URL', () => {
        expect(normalizeUrl('docs/file.pdf', 'https://example.com/private/')).toBe('https://example.com/private/docs/file.pdf');
    });

    test('deduplicates documents by URL and sorts by newest date first', () => {
        const documents = normalizeDocuments(
            [
                { date: '2024-01-01', type: 'ISO', title: 'A', url: 'a.pdf' },
                { date: '2024-02-01', type: 'NFZ', title: 'B', url: 'b.pdf' },
                { date: '2024-03-01', type: 'Duplikat', title: 'B2', url: 'B.pdf' },
            ],
            { scrapedAt: '2026-06-02T10:00:00.000Z', sourceUrl: 'https://example.com/private/' }
        );

        expect(documents).toHaveLength(2);
        expect(documents[0]).toMatchObject({
            date: '2024-02-01',
            type: 'NFZ',
            title: 'B',
            url: 'https://example.com/private/b.pdf',
            sourceUrl: 'https://example.com/private/',
            scrapedAt: '2026-06-02T10:00:00.000Z',
        });
        expect(documents[1].date).toBe('2024-01-01');
    });

    test('adds stable ids for identical document data', () => {
        const document = {
            date: '2024-01-01',
            type: 'ISO',
            title: 'Procedura',
            url: 'https://example.com/procedura.pdf',
        };

        expect(createDocumentId(document)).toBe(createDocumentId(document));
        expect(createDocumentId(document)).toMatch(/^pdf-/);
    });

    test('uses file name as fallback title and skips invalid URLs', () => {
        const documents = normalizeDocuments(
            [
                { date: '2024-01-01', type: 'ISO', title: '', url: 'folder/procedura.pdf?version=2' },
                { date: '2024-01-02', type: 'ISO', title: 'Invalid', url: 'http://[invalid' },
            ],
            { sourceUrl: 'https://example.com/private/' }
        );

        expect(documents).toHaveLength(1);
        expect(documents[0].title).toBe('procedura.pdf');
    });
});
