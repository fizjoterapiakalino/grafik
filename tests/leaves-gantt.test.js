jest.mock('../scripts/firebase-config.js', () => ({
    db: {
        collection: jest.fn().mockReturnThis(),
        doc: jest.fn().mockReturnThis(),
        get: jest.fn(),
        update: jest.fn(),
    },
}));

import {
    calculatePlannedVacationDays,
    calculateWorkingDays,
    expandAllMonths,
    renderGanttHeader,
} from '../scripts/leaves-gantt.js';

describe('leaves Gantt helpers', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('counts planned vacation days excluding Polish holidays', () => {
        const leaves = [
            {
                id: 'leave-1',
                type: 'vacation',
                startDate: '2026-06-01',
                endDate: '2026-06-05',
            },
        ];

        expect(calculatePlannedVacationDays(leaves, 2026)).toBe(4);
        expect(calculateWorkingDays('2026-06-01', '2026-06-05')).toBe(4);
    });

    test('marks holiday days in the expanded Gantt header', () => {
        expandAllMonths();

        document.body.innerHTML = renderGanttHeader(2026);

        const holidayHeader = document.querySelector('.gantt-day-header[data-date="2026-06-04"]');
        expect(holidayHeader).not.toBeNull();
        expect(holidayHeader.classList.contains('holiday')).toBe(true);
        expect(holidayHeader.title).toBe('Święto');
    });
});
