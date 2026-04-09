import { ScrappedPdfs } from '../scripts/scrapped-pdfs.js';

// Mock PdfService
jest.mock('../scripts/pdf-service.js', () => ({
    PdfService: {
        fetchAndCachePdfLinks: jest.fn(),
    },
}));

import { PdfService } from '../scripts/pdf-service.js';

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
            <input type="text" id="searchInput">
            <button id="refreshPdfsBtn"><span>Odśwież</span></button>
            <div id="pdfModal" style="display: none;">
                <button id="pdfCloseBtn"></button>
                <a id="pdfOpenNewTabBtn"></a>
                <div id="pdfModalTitle"></div>
                <iframe id="pdfIframe"></iframe>
            </div>
            <div id="isoLoginModal" style="display: none;">
                <input id="isoLogin">
                <input id="isoPassword">
                <button id="isoLoginConfirmBtn"></button>
                <button id="isoLoginCancelBtn"></button>
            </div>
        `;
        container = document.getElementById('pdf-links-container');
        tableBody = document.getElementById('pdf-table-body');
        tableContainer = document.getElementById('pdf-table-container');
        searchInput = document.getElementById('pdfSearchInput');

        // Reset mocks
        jest.clearAllMocks();
    });

    afterEach(() => {
        ScrappedPdfs.destroy();
        jest.clearAllMocks();
    });

    test('should display loading message initially', () => {
        PdfService.fetchAndCachePdfLinks.mockImplementation(() => new Promise(() => {})); // Never resolves
        ScrappedPdfs.init();
        expect(container.textContent).toBe('Ładowanie dokumentów...');
    });

    test('should display links when fetch is successful', async () => {
        const mockData = [{ date: '2023-10-25', type: 'Grafik', title: 'Plan.pdf', url: 'http://example.com/1.pdf' }];

        PdfService.fetchAndCachePdfLinks.mockResolvedValue(mockData);

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
        PdfService.fetchAndCachePdfLinks.mockRejectedValue(new Error('Network error'));

        await ScrappedPdfs.init();

        expect(container.textContent).toBe('Wystąpił błąd podczas ładowania dokumentów.');
    });

    test('should handle empty results', async () => {
        PdfService.fetchAndCachePdfLinks.mockResolvedValue([]);

        await ScrappedPdfs.init();

        expect(container.textContent).toBe('Brak dostępnych dokumentów.');
    });

    test('should filter links based on search event', async () => {
        const mockData = [
            { date: '2023-10-25', type: 'Grafik', title: 'Plan A', url: '#' },
            { date: '2023-10-26', type: 'Zmiana', title: 'Plan B', url: '#' },
        ];

        PdfService.fetchAndCachePdfLinks.mockResolvedValue(mockData);

        await ScrappedPdfs.init();

        // Simulate search event (the module listens to 'app:search' custom event)
        document.dispatchEvent(new CustomEvent('app:search', { detail: { searchTerm: 'zmiana' } }));

        const rows = tableBody.querySelectorAll('tr');
        expect(rows.length).toBe(1);
        expect(rows[0].textContent).toContain('Zmiana');
        expect(rows[0].textContent).not.toContain('Grafik');
    });

    test('should sort links by date descending before rendering', async () => {
        const mockData = [
            { date: '2023-10-25', type: 'Grafik', title: 'Plan A', url: '#' },
            { date: '2023-10-26', type: 'Zmiana', title: 'Plan B', url: '#' },
        ];

        PdfService.fetchAndCachePdfLinks.mockResolvedValue(mockData);

        await ScrappedPdfs.init();

        const rows = tableBody.querySelectorAll('tr');
        expect(rows[0].textContent).toContain('2023-10-26');
        expect(rows[1].textContent).toContain('2023-10-25');
    });

    test('should show empty search state when nothing matches', async () => {
        const mockData = [
            { date: '2023-10-25', type: 'Grafik', title: 'Plan A', url: '#' },
        ];

        PdfService.fetchAndCachePdfLinks.mockResolvedValue(mockData);

        await ScrappedPdfs.init();
        document.dispatchEvent(new CustomEvent('app:search', { detail: { searchTerm: 'brak' } }));

        const emptyCell = tableBody.querySelector('.empty-message');
        expect(emptyCell.textContent).toBe('Brak wyników.');
    });

    test('should prevent XSS injection in rendering', async () => {
        const mockData = [{ date: '2023-10-25', type: '<img src=x onerror=alert(1)>', title: '<b>Bold</b>', url: '#' }];

        PdfService.fetchAndCachePdfLinks.mockResolvedValue(mockData);

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

    test('should require ISO login and open pending PDF after confirmation', async () => {
        PdfService.fetchAndCachePdfLinks.mockResolvedValue([
            { date: '2023-10-25', type: 'ISO', title: 'Plan.pdf', url: 'http://example.com/doc.pdf' },
        ]);

        await ScrappedPdfs.init();

        ScrappedPdfs.openPdf('http://example.com/doc.pdf', 'Plan.pdf');
        expect(document.getElementById('isoLoginModal').style.display).toBe('flex');

        document.getElementById('isoLoginConfirmBtn').click();

        expect(document.getElementById('pdfModal').style.display).toBe('flex');
        expect(document.getElementById('pdfOpenNewTabBtn').href).toBe('http://example.com/doc.pdf');
        expect(document.getElementById('pdfIframe').src).toContain('http://example.com/doc.pdf#navpanes=0&toolbar=0&view=FitH');
        expect(document.getElementById('pdfModalTitle').textContent).toBe('Plan.pdf');
    });
});
