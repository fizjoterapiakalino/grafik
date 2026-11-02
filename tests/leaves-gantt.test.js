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
    destroyGanttPopups,
} from '../scripts/leaves-gantt.js';

describe('leaves Gantt helpers', () => {
    afterEach(() => {
        destroyGanttPopups();
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

    test('calculates correct working days across October DST transition without +/- 1 day shift', () => {
        // 2026-10-24: Saturday, 2026-10-25: Sunday (DST change), 2026-10-26: Monday, 2026-10-27: Tuesday
        const leaves = [
            {
                id: 'dst-leave',
                type: 'vacation',
                startDate: '2026-10-24',
                endDate: '2026-10-27',
            },
        ];

        expect(calculateWorkingDays('2026-10-24', '2026-10-27')).toBe(2);
        expect(calculatePlannedVacationDays(leaves, 2026)).toBe(2);
    });

    test('destroyGanttPopups removes popup elements and clears listeners cleanly', () => {
        const popup = document.createElement('div');
        popup.className = 'gantt-leave-popup';
        document.body.appendChild(popup);
        expect(document.querySelector('.gantt-leave-popup')).not.toBeNull();

        destroyGanttPopups();
        expect(document.querySelector('.gantt-leave-popup')).toBeNull();

        // Dispatching mousedown after popup destruction should be safe
        expect(() => {
            document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        }).not.toThrow();
    });
});
