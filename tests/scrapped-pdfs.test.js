import { ScrappedPdfs } from '../scripts/scrapped-pdfs.js';

/**
 * @jest-environment jsdom
 */

describe('ScrappedPdfs', () => {
    let container;
    let tableBody;
    let tableContainer;
    let searchInput;

    beforeEach(() => {
        // Setup DOM
        document.body.innerHTML = `
            <div id="pdf-links-container"></div>
            <div id="pdf-table-container" style="display: none;">
                <input type="text" id="pdfSearchInput">
                <table>
                    <tbody id="pdf-table-body"></tbody>
                </table>
            </div>
        `;
        container = document.getElementById('pdf-links-container');
        tableBody = document.getElementById('pdf-table-body');
        tableContainer = document.getElementById('pdf-table-container');
        searchInput = document.getElementById('pdfSearchInput');

        // Reset fetch mock
        global.fetch = jest.fn();
    });

    afterEach(() => {
        ScrappedPdfs.destroy();
        jest.clearAllMocks();
    });

    test('should display loading message initially', () => {
        global.fetch.mockImplementation(() => new Promise(() => {})); // Never resolves
        ScrappedPdfs.init();
        expect(container.textContent).toBe('Ładowanie linków...');
    });

    test('should display links when fetch is successful', async () => {
        const mockData = [{ date: '2023-10-25', type: 'Grafik', title: 'Plan.pdf', url: 'http://example.com/1.pdf' }];

        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => mockData,
        });

        await ScrappedPdfs.init();

        expect(container.style.display).toBe('none');
        expect(tableContainer.style.display).toBe('block');

        const rows = tableBody.querySelectorAll('tr');
        expect(rows.length).toBe(1);
        expect(rows[0].innerHTML).toContain('2023-10-25');
        expect(rows[0].innerHTML).toContain('Grafik');
        expect(rows[0].innerHTML).toContain('Plan.pdf');
    });

    test('should handle API errors gracefully', async () => {
        global.fetch.mockRejectedValue(new Error('Network error'));

        await ScrappedPdfs.init();

        expect(container.textContent).toBe('Wystąpił błąd podczas ładowania linków.');
    });

    test('should handle empty results', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => [],
        });

        await ScrappedPdfs.init();

        expect(container.textContent).toBe('Brak dostępnych linków PDF.');
    });

    test('should filter links based on search input', async () => {
        const mockData = [
            { date: '2023-10-25', type: 'Grafik', title: 'Plan A', url: '#' },
            { date: '2023-10-26', type: 'Zmiana', title: 'Plan B', url: '#' },
        ];

        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => mockData,
        });

        await ScrappedPdfs.init();

        // Simulate typing 'Zmiana'
        searchInput.value = 'zmiana';
        searchInput.dispatchEvent(new Event('input'));

        const rows = tableBody.querySelectorAll('tr');
        expect(rows.length).toBe(1);
        expect(rows[0].textContent).toContain('Zmiana');
        expect(rows[0].textContent).not.toContain('Grafik');
    });

    test('should prevent XSS injection in rendering', async () => {
        const mockData = [{ date: '2023-10-25', type: '<img src=x onerror=alert(1)>', title: '<b>Bold</b>', url: '#' }];

        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => mockData,
        });

        await ScrappedPdfs.init();

        const rows = tableBody.querySelectorAll('tr');
        // Check text content instead of innerHTML to verify encoding, or check that html tags are not present as elements
        const typeCell = rows[0].querySelector('.doc-type-badge');
        expect(typeCell.innerHTML).not.toContain('<img');
        expect(typeCell.textContent).toBe('<img src=x onerror=alert(1)>');

        const titleLink = rows[0].querySelector('a');
        expect(titleLink.innerHTML).not.toContain('<b>'); // It contains <i class="..."></i> but <b> should be text
        expect(titleLink.textContent).toContain('<b>Bold</b>');
    });
});
