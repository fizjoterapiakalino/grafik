import { ScheduleLogic } from '../scripts/schedule-logic.js';
import { AppConfig } from '../scripts/common.js';

// Mock AppConfig if needed, but it's usually a simple object.
// If it's imported from a module that has side effects, we might need to mock it.
// For now assuming common.js is safe to import.

describe('ScheduleLogic', () => {
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
    });
});
