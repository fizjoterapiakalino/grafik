// scripts/leaves-pdf.ts
// Moduł eksportu urlopów do PDF

import {
    PdfColors,
    PdfStyles,
    PdfDefaultStyle,
    PdfTableLayout,
    PdfPageConfig,
    PdfHeaderColors,
} from './pdf-config.js';

/**
 * Opcje eksportu PDF
 */
export interface LeavesPdfOptions {
    year: number;
    tableId?: string;
}

/**
 * Eksportuje tabelę urlopów do pliku PDF
 * @param options - Opcje eksportu (rok, id tabeli)
 */
export const printLeavesTableToPdf = (options: LeavesPdfOptions): void => {
    const { year, tableId = 'leavesTable' } = options;

    const table = document.getElementById(tableId);
    if (!table) {
        console.warn('LeavesPdf: Nie znaleziono tabeli do eksportu');
        return;
    }

    // Generuj nagłówki
    const headers = Array.from(table.querySelectorAll('thead th')).map((th, index) => {
        return {
            text: th.textContent || '',
            style: 'tableHeader',
            fillColor: index === 0 ? PdfHeaderColors.firstColumn : PdfHeaderColors.dataColumns,
            color: PdfHeaderColors.text,
        };
    });

    // Generuj wiersze
    const body = Array.from(table.querySelectorAll('tbody tr')).map((row) => {
        const tr = row as HTMLTableRowElement;
        return Array.from(tr.cells).map((cell, index) => {
            if (index === 0) {
                // Kolumna nazwisk - z tłem
                return {
                    text: (cell.textContent || '').trim(),
                    style: 'employeeName',
                    fillColor: PdfColors.slate100,
                };
            }

            // Kolumny miesięcy - bez tła
            // Filtruj tylko urlopy wypoczynkowe i wybicia
            const allowedTypes = ['vacation', 'schedule_pickup'];
            const blocks = Array.from(cell.querySelectorAll('.leave-block'))
                .filter(b => {
                    const type = b.getAttribute('data-type') || 'vacation';
                    return allowedTypes.includes(type);
                });

            if (blocks.length > 0) {
                // Helper: pobierz tekst bloku bez badge'a
                const getBlockText = (b: Element): string => {
                    const clone = b.cloneNode(true) as HTMLElement;
                    const badge = clone.querySelector('.leave-date-badge');
                    if (badge) badge.remove();
                    return clone.textContent?.trim() || '';
                };

                return {
                    table: {
                        widths: ['*'],
                        body: blocks.map(b => [{
                            text: getBlockText(b),
                            alignment: 'center',
                            margin: [0, 2, 0, 2],
                            fontSize: 8,
                        }]),
                    },
                    layout: 'noBorders',
                    margin: [0, 1, 0, 1],
                };
            }
            return { text: '' };
        });
    });

    // Definicja dokumentu PDF
    const docDefinition = {
        ...PdfPageConfig,
        content: [
            { text: `Grafik Urlopów - ${year}`, style: 'header' },
            {
                style: 'tableExample',
                table: {
                    headerRows: 1,
                    widths: ['auto', '*', '*', '*', '*', '*', '*', '*', '*', '*', '*', '*', '*'],
                    body: [headers, ...body],
                },
                layout: PdfTableLayout,
            },
        ],
        styles: PdfStyles,
        defaultStyle: PdfDefaultStyle,
    };

    pdfMake.createPdf(docDefinition).download(`grafik-urlopow-${year}.pdf`);
};

/**
 * API modułu PDF Urlopów
 */
export const LeavesPdf = {
    print: printLeavesTableToPdf,
};

// Backward compatibility
declare global {
    interface Window {
        LeavesPdf: typeof LeavesPdf;
    }
}

window.LeavesPdf = LeavesPdf;
