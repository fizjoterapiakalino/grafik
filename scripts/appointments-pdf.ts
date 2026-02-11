// scripts/appointments-pdf.ts
import {
    PdfColors,
    PdfDefaultStyle,
} from './pdf-config.js';

interface AppointmentCell {
    patientName: string;
}

interface AppointmentData {
    [time: string]: {
        station1?: AppointmentCell;
        station2?: AppointmentCell;
    }
}

/**
 * Eksportuje tabelę planowania do PDF zoptymalizowanego pod 1 stronę A4.
 */
export const printAppointmentsToPdf = (data: AppointmentData): void => {
    const headers = [
        { text: 'Godz.', style: 'tableHeader', fillColor: PdfColors.slate800, color: PdfColors.white },
        { text: 'Stanowisko 1', style: 'tableHeader', fillColor: PdfColors.emerald600, color: PdfColors.white },
        { text: 'Stanowisko 2', style: 'tableHeader', fillColor: PdfColors.emerald600, color: PdfColors.white }
    ];

    const slots = generateTimeSlots();

    const body = slots.map(time => {
        const rowData = data[time] || {};
        const name1 = (rowData.station1?.patientName || '').trim();
        const name2 = (rowData.station2?.patientName || '').trim();

        return [
            { text: time, alignment: 'center', bold: true, fillColor: PdfColors.slate50, fontSize: 9.5, margin: [0, 1, 0, 1] },
            { text: name1, fontSize: 10, margin: [0, 1, 0, 1], noWrap: true },
            { text: name2, fontSize: 10, margin: [0, 1, 0, 1], noWrap: true }
        ];
    });

    const compactLayout = {
        hLineWidth: () => 0.4,
        vLineWidth: () => 0.4,
        hLineColor: () => PdfColors.slate300,
        vLineColor: () => PdfColors.slate300,
        paddingLeft: () => 4,
        paddingRight: () => 4,
        paddingTop: () => 4.25,
        paddingBottom: () => 4.25,
    };

    const docDefinition = {
        pageOrientation: 'portrait',
        pageSize: 'A4',
        pageMargins: [8, 12, 8, 12],
        content: [
            { text: 'PLANOWANIE WIZYT', style: 'header', alignment: 'center', margin: [0, 0, 0, 4] },
            { text: `Data wydruku: ${new Date().toLocaleDateString('pl-PL')}`, alignment: 'center', fontSize: 8, margin: [0, 0, 0, 8] },
            {
                table: {
                    headerRows: 1,
                    widths: [50, '*', '*'],
                    body: [headers, ...body],
                    dontBreakRows: true,
                    keepWithHeaderRows: 1,
                },
                layout: compactLayout,
            }
        ],
        styles: {
            header: {
                fontSize: 12,
                bold: true,
                color: PdfColors.slate900,
            },
            tableHeader: {
                bold: true,
                fontSize: 8,
                margin: [0, 2, 0, 2],
                alignment: 'center',
            }
        },
        defaultStyle: {
            ...PdfDefaultStyle,
            fontSize: 10,
        }
    };

    pdfMake.createPdf(docDefinition).download(`planowanie-${new Date().toISOString().split('T')[0]}.pdf`);
};

function generateTimeSlots(): string[] {
    const slots: string[] = [];
    let curHour = 7;
    let curMin = 0;
    while (curHour < 17 || (curHour === 17 && curMin <= 40)) {
        slots.push(`${curHour.toString().padStart(2, '0')}:${curMin.toString().padStart(2, '0')}`);
        curMin += 20;
        if (curMin >= 60) { curHour += 1; curMin = 0; }
    }
    return slots;
}

(window as any).printAppointmentsToPdf = printAppointmentsToPdf;
