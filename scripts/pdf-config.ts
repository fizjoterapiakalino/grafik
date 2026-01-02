// scripts/pdf-config.ts
// Wspólna konfiguracja kolorów i stylów dla eksportu PDF

/**
 * Deklaracja typu dla pdfMake (zewnętrzna biblioteka załadowana przez CDN)
 * pdfMake jest dostępny globalnie - nie eksportujemy go, tylko deklarujemy typ
 */
declare global {
    const pdfMake: {
        createPdf(docDefinition: unknown): { download(filename: string): void };
    };
}

/**
 * Paleta kolorów Slate (szare) używana w PDF
 */
export const PdfColors = {
    // Slate palette
    slate50: '#f8fafc',
    slate100: '#f1f5f9',
    slate200: '#e2e8f0',
    slate300: '#cbd5e1',
    slate500: '#64748b',
    slate700: '#334155',
    slate800: '#1e293b',
    slate900: '#0f172a',

    // Emerald (zielone akcenty)
    emerald600: '#059669',

    // Białe
    white: '#ffffff',
} as const;

/**
 * Domyślne style dla dokumentów PDF
 */
export const PdfStyles = {
    header: {
        fontSize: 22,
        bold: true,
        margin: [0, 0, 0, 15],
        color: PdfColors.slate900,
    },
    tableExample: {
        margin: [0, 5, 0, 15],
    },
    tableHeader: {
        bold: true,
        fontSize: 11,
        alignment: 'center' as const,
        margin: [0, 5, 0, 5],
    },
    employeeName: {
        bold: true,
        fontSize: 10,
        color: PdfColors.slate800,
    },
} as const;

/**
 * Domyślny styl tekstu w PDF
 */
export const PdfDefaultStyle = {
    font: 'Roboto',
    fontSize: 9,
    color: PdfColors.slate700,
} as const;

/**
 * Domyślny layout tabeli z liniami
 */
export const PdfTableLayout = {
    hLineWidth: () => 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => PdfColors.slate300,
    vLineColor: () => PdfColors.slate300,
    paddingLeft: () => 8,
    paddingRight: () => 8,
    paddingTop: () => 6,
    paddingBottom: () => 6,
} as const;

/**
 * Kompaktowy layout tabeli (mniejsze paddingi)
 */
export const PdfTableLayoutCompact = {
    ...PdfTableLayout,
    paddingLeft: () => 6,
    paddingRight: () => 6,
    paddingTop: () => 4,
    paddingBottom: () => 4,
} as const;

/**
 * Domyślna konfiguracja strony PDF
 */
export const PdfPageConfig = {
    pageOrientation: 'landscape' as const,
    pageSize: 'A3' as const,
    pageMargins: [20, 20, 20, 20] as [number, number, number, number],
} as const;

/**
 * Kolory nagłówków tabel
 */
export const PdfHeaderColors = {
    firstColumn: PdfColors.slate800,  // Ciemny dla pierwszej kolumny
    dataColumns: PdfColors.emerald600, // Zielony dla kolumn danych
    text: PdfColors.white,
} as const;

/**
 * Kolory bloków urlopowych w PDF
 */
export const PdfLeaveBlockColors = {
    background: PdfColors.slate200,
    text: PdfColors.slate800,
} as const;
