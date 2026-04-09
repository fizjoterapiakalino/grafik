import { ScheduleLogic } from '../scripts/schedule-logic.js';
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

    describe('calculateEndDate', () => {
        test('should skip weekends and holidays', () => {
            expect(ScheduleLogic.calculateEndDate('2024-01-01', 0)).toBe('2024-01-22');
        });
    });
});
