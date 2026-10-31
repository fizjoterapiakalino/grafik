jest.mock('../scripts/firebase-config.js', () => ({
    db: {
        collection: jest.fn().mockReturnThis(),
        doc: jest.fn().mockReturnThis(),
        get: jest.fn(),
        update: jest.fn(),
    },
    auth: {},
}));

import { ScheduleLogic } from '../scripts/schedule-logic.js';
import { ScheduleUI } from '../scripts/schedule-ui.js';
import { AppConfig } from '../scripts/common.js';

// Mock AppConfig if needed, but it's usually a simple object.
// If it's imported from a module that has side effects, we might need to mock it.
// For now assuming common.js is safe to import.

describe('ScheduleLogic', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    describe('getCellDisplayData', () => {
        test('should handle break cell', () => {
            const cellData = { isBreak: true };
            const result = ScheduleLogic.getCellDisplayData(cellData);
            expect(result.isBreak).toBe(true);
            expect(result.text).toBe(AppConfig.schedule.breakText);
            expect(result.classes).toContain('break-cell');
        });

        test('should handle normal cell with content', () => {
            const cellData = { content: 'test', isMassage: true };
            const result = ScheduleLogic.getCellDisplayData(cellData);
            expect(result.text).toBe('Test'); // Capitalized
            expect(result.classes).toContain('massage-text');
            expect(result.styles.backgroundColor).toBe(AppConfig.schedule.contentCellColor);
        });

        test('should mark normal every-other-day cell for colored display', () => {
            const result = ScheduleLogic.getCellDisplayData({
                content: 'kowalski',
                isEveryOtherDay: true,
            });

            expect(result.text).toBe('Kowalski');
            expect(result.classes).toContain('every-other-day-text');
        });

        test('should handle split cell', () => {
            const cellData = {
                isSplit: true,
                content1: 'a',
                content2: 'b',
                isPnf1: true,
            };
            const result = ScheduleLogic.getCellDisplayData(cellData);
            expect(result.isSplit).toBe(true);
            expect(result.classes).toContain('split-cell');
            expect(result.parts.length).toBe(2);
            expect(result.parts[0].text).toBe('A');
            expect(result.parts[0].classes).toContain('pnf-text');
            expect(result.parts[1].text).toBe('B');
        });

        test('should mark only selected split parts as every-other-day', () => {
            const result = ScheduleLogic.getCellDisplayData({
                isSplit: true,
                content1: 'kowalski',
                content2: 'nowak',
                isEveryOtherDay1: true,
            });

            expect(result.parts[0].classes).toContain('every-other-day-text');
            expect(result.parts[1].classes).not.toContain('every-other-day-text');
        });

        test('should force hydrotherapy display for full cell', () => {
            const result = ScheduleLogic.getCellDisplayData({
                content: 'Pacjent',
                isHydrotherapy: true,
            });

            expect(result.text).toBe('Hydro.');
            expect(result.classes).toContain('hydrotherapy-cell');
            expect(result.styles.backgroundColor).toBe('var(--bg-hydrotherapy)');
        });

        test('should mark ended treatments for normal cell', () => {
            jest.useFakeTimers().setSystemTime(new Date('2024-01-20T12:00:00Z'));

            const result = ScheduleLogic.getCellDisplayData({
                content: 'Pacjent',
                treatmentEndDate: '2024-01-20',
            });

            expect(result.treatmentEndDate).toBe('2024-01-20');
            expect(result.daysRemaining).toBe(0);
            expect(result.classes).toContain('treatment-end-marker');
        });

        test('should mark normal cell with patient-absence-marker when absenceDates contains today', () => {
            jest.useFakeTimers().setSystemTime(new Date('2024-01-20T12:00:00Z'));

            const result = ScheduleLogic.getCellDisplayData({
                content: 'Kowalski',
                absenceDates: ['2024-01-20', '2024-01-21'],
            });

            expect(result.classes).toContain('patient-absence-marker');
            expect(result.isAbsentToday).toBe(true);
            expect(result.absenceDates).toEqual(['2024-01-20', '2024-01-21']);
        });

        test('should not mark cell when absenceDates does not contain today', () => {
            jest.useFakeTimers().setSystemTime(new Date('2024-01-20T12:00:00Z'));

            const result = ScheduleLogic.getCellDisplayData({
                content: 'Kowalski',
                absenceDates: ['2024-01-21', '2024-01-22'],
            });

            expect(result.classes).not.toContain('patient-absence-marker');
            expect(result.isAbsentToday).toBeUndefined();
        });

        test('should not mark empty cell even if absenceDates contains today', () => {
            jest.useFakeTimers().setSystemTime(new Date('2024-01-20T12:00:00Z'));

            const result = ScheduleLogic.getCellDisplayData({
                content: '',
                absenceDates: ['2024-01-20'],
            });

            expect(result.classes).not.toContain('patient-absence-marker');
            expect(result.isAbsentToday).toBeUndefined();
        });

        test('should mark only the absent part in a split cell', () => {
            jest.useFakeTimers().setSystemTime(new Date('2024-01-20T12:00:00Z'));

            const result = ScheduleLogic.getCellDisplayData({
                isSplit: true,
                content1: 'Nowak',
                content2: 'Wiśniewski',
                treatmentData1: {
                    absenceDates: ['2024-01-20'],
                },
                absenceDates2: ['2024-01-25'],
            });

            expect(result.parts[0].classes).toContain('patient-absence-marker');
            expect(result.parts[0].isAbsentToday).toBe(true);
            expect(result.parts[0].absenceDates).toEqual(['2024-01-20']);

            expect(result.parts[1].classes).not.toContain('patient-absence-marker');
            expect(result.parts[1].isAbsentToday).toBeUndefined();
            expect(result.parts[1].absenceDates).toEqual(['2024-01-25']);
        });

        test('should support absenceDates1 fallback for split cell part 1', () => {
            jest.useFakeTimers().setSystemTime(new Date('2024-01-20T12:00:00Z'));

            const result = ScheduleLogic.getCellDisplayData({
                isSplit: true,
                content1: 'Nowak',
                content2: 'Wiśniewski',
                absenceDates1: ['2024-01-20'],
            });

            expect(result.parts[0].classes).toContain('patient-absence-marker');
            expect(result.parts[0].isAbsentToday).toBe(true);
            expect(result.parts[1].classes).not.toContain('patient-absence-marker');
        });
    });

    describe('ScheduleUI.getElementText with absence marker', () => {
        test('should return clean patient text ignoring absence markers and mobile tags', () => {
            // Desktop cell with patient-absence-marker class
            const td = document.createElement('td');
            td.className = 'editable-cell patient-absence-marker';
            const span = document.createElement('span');
            span.textContent = 'Jan Kowalski';
            td.appendChild(span);

            expect(ScheduleUI.getElementText(td)).toBe('Jan Kowalski');

            // Split part with patient-absence-marker
            const splitDiv = document.createElement('div');
            splitDiv.className = 'patient-absence-marker';
            splitDiv.setAttribute('data-split-part', '1');
            const splitSpan = document.createElement('span');
            splitSpan.textContent = 'Anna Nowak';
            splitDiv.appendChild(splitSpan);

            expect(ScheduleUI.getElementText(splitDiv)).toBe('Anna Nowak');

            // Mobile element with absence tag inside cell-icon container
            const mobileEl = document.createElement('div');
            mobileEl.className = 'mobile-schedule-patient editable-cell patient-absence-marker';
            const mobileLabel = document.createElement('span');
            mobileLabel.className = 'mobile-schedule-patient-name';
            mobileLabel.textContent = 'Piotr Wiśniewski';
            mobileEl.appendChild(mobileLabel);

            const meta = document.createElement('div');
            meta.className = 'mobile-schedule-meta cell-icon';
            const absenceTag = document.createElement('span');
            absenceTag.className = 'mobile-schedule-tag absence';
            absenceTag.textContent = '⚠️ Nieobecny';
            meta.appendChild(absenceTag);
            mobileEl.appendChild(meta);

            expect(ScheduleUI.getElementText(mobileEl)).toBe('Piotr Wiśniewski');
        });
    });

    describe('calculatePatientCount', () => {
        test('should count patients correctly', () => {
            const scheduleCells = {
                '08:00': {
                    0: { content: 'Pacjent 1' },
                    1: { isBreak: true },
                    2: { isSplit: true, content1: 'P2', content2: 'P3' },
                },
            };
            const count = ScheduleLogic.calculatePatientCount(scheduleCells);
            expect(count).toBe(3); // P1 + P2 + P3
        });

        test('should ignore empty cells', () => {
            const scheduleCells = {
                '08:00': {
                    0: { content: '' },
                    1: { isSplit: true, content1: '', content2: '' },
                },
            };
            const count = ScheduleLogic.calculatePatientCount(scheduleCells);
            expect(count).toBe(0);
        });

        test('should ignore hydrotherapy cells', () => {
            const scheduleCells = {
                '08:00': {
                    0: { content: 'Pacjent 1', isHydrotherapy: true },
                    1: { content: 'Pacjent 2' },
                },
            };

            expect(ScheduleLogic.calculatePatientCount(scheduleCells)).toBe(1);
        });
    });

    describe('calculateEmployeeWorkload', () => {
        test('should ignore breaks and hydrotherapy when counting employee workload', () => {
            const scheduleCells = {
                '8:00': {
                    0: { content: 'Pacjent 1' },
                },
                '8:30': {
                    0: { isBreak: true },
                },
                '9:00': {
                    0: { content: 'Hydro.', isHydrotherapy: true },
                },
            };

            const workload = ScheduleLogic.calculateEmployeeWorkload(scheduleCells, '0');

            expect(workload.filled).toBe(1);
            expect(workload.total).toBe(21);
            expect(workload.percentage).toBe(5);
        });

        test('should count each occupied split part as separate workload', () => {
            const scheduleCells = {
                '8:00': {
                    0: {
                        isSplit: true,
                        content1: 'Pacjent 1',
                        content2: 'Pacjent 2',
                    },
                },
                '8:30': {
                    0: {
                        isSplit: true,
                        content1: 'Pacjent 3',
                        content2: 'Hydro.',
                        isHydrotherapy2: true,
                    },
                },
            };

            const workload = ScheduleLogic.calculateEmployeeWorkload(scheduleCells, '0', 'first');

            expect(workload.filled).toBe(3);
            expect(workload.total).toBe(15);
            expect(workload.percentage).toBe(20);
        });

        test('should use afternoon shift range for workload totals', () => {
            const scheduleCells = {
                '10:00': {
                    0: { content: 'Przed zmianą' },
                },
                '10:30': {
                    0: { content: 'Pacjent 1' },
                },
                '17:00': {
                    0: { content: 'Pacjent 2' },
                },
            };

            const workload = ScheduleLogic.calculateEmployeeWorkload(scheduleCells, '0', 'second');

            expect(workload.filled).toBe(2);
            expect(workload.total).toBe(14);
            expect(workload.percentage).toBe(14);
        });
    });

    describe('calculateEndDate', () => {
        test('should skip weekends and holidays', () => {
            expect(ScheduleLogic.calculateEndDate('2024-01-01', 0)).toBe('2024-01-22');
        });
    });
});
