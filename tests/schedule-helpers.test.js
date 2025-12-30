// tests/schedule-helpers.test.js
/**
 * @jest-environment jsdom
 */

import {
    getTargetPart,
    getSourcePart,
    getTreatmentData,
    copyFlags,
    copyTreatmentToTarget,
    clearSplitFields,
    createTargetUpdateFn,
    copyFullCellState,
    createSourceClearFn,
    clearAllProperties,
    getTodayDate,
    initTreatmentData,
} from '../scripts/schedule-helpers.js';

// Mock schedule-logic.js
jest.mock('../scripts/schedule-logic.js', () => ({
    ScheduleLogic: {
        calculateEndDate: jest.fn((startDate, extensionDays) => {
            // Simple mock: add extension days to start date
            const date = new Date(startDate);
            date.setDate(date.getDate() + 10 + (extensionDays || 0));
            return date.toISOString().split('T')[0];
        }),
    },
}));

describe('schedule-helpers', () => {
    describe('getTargetPart', () => {
        test('returns null for non-split cell', () => {
            const element = document.createElement('td');
            expect(getTargetPart(element)).toBeNull();
        });

        test('returns 1 for first div in split-cell-wrapper', () => {
            const wrapper = document.createElement('div');
            wrapper.className = 'split-cell-wrapper';
            const firstDiv = document.createElement('div');
            const secondDiv = document.createElement('div');
            wrapper.appendChild(firstDiv);
            wrapper.appendChild(secondDiv);

            expect(getTargetPart(firstDiv)).toBe(1);
        });

        test('returns 2 for second div in split-cell-wrapper', () => {
            const wrapper = document.createElement('div');
            wrapper.className = 'split-cell-wrapper';
            const firstDiv = document.createElement('div');
            const secondDiv = document.createElement('div');
            wrapper.appendChild(firstDiv);
            wrapper.appendChild(secondDiv);

            expect(getTargetPart(secondDiv)).toBe(2);
        });
    });

    describe('getSourcePart', () => {
        test('returns null for non-split cell', () => {
            const cellState = { content: 'Test' };
            expect(getSourcePart(cellState, 'Test')).toBeNull();
        });

        test('returns 1 when text matches content1', () => {
            const cellState = { isSplit: true, content1: 'Kowalski', content2: 'Nowak' };
            expect(getSourcePart(cellState, 'kowalski')).toBe(1);
        });

        test('returns 2 when text matches content2', () => {
            const cellState = { isSplit: true, content1: 'Kowalski', content2: 'Nowak' };
            expect(getSourcePart(cellState, 'NOWAK')).toBe(2);
        });

        test('returns null when text matches neither', () => {
            const cellState = { isSplit: true, content1: 'Kowalski', content2: 'Nowak' };
            expect(getSourcePart(cellState, 'Wiśniewski')).toBeNull();
        });
    });

    describe('getTreatmentData', () => {
        test('returns treatment data from normal cell', () => {
            const cellState = {
                treatmentStartDate: '2024-01-15',
                treatmentExtensionDays: 5,
                treatmentEndDate: '2024-01-30',
                additionalInfo: 'Test info',
            };

            const result = getTreatmentData(cellState, null);
            expect(result.startDate).toBe('2024-01-15');
            expect(result.extensionDays).toBe(5);
            expect(result.endDate).toBe('2024-01-30');
            expect(result.additionalInfo).toBe('Test info');
        });

        test('returns treatment data from split cell part 1', () => {
            const cellState = {
                treatmentData1: { startDate: '2024-02-01', extensionDays: 3 },
                treatmentData2: { startDate: '2024-03-01', extensionDays: 7 },
            };

            const result = getTreatmentData(cellState, 1);
            expect(result.startDate).toBe('2024-02-01');
            expect(result.extensionDays).toBe(3);
        });

        test('returns empty object when treatmentData is missing', () => {
            const cellState = { isSplit: true };
            const result = getTreatmentData(cellState, 1);
            expect(result).toEqual({});
        });
    });

    describe('copyFlags', () => {
        test('copies flags from normal to normal cell', () => {
            const source = { isMassage: true, isPnf: false, isEveryOtherDay: true };
            const target = {};

            copyFlags(source, target, null, null);

            expect(target.isMassage).toBe(true);
            expect(target.isPnf).toBe(false);
            expect(target.isEveryOtherDay).toBe(true);
        });

        test('copies flags from split part to normal', () => {
            const source = { isMassage1: true, isPnf1: false, isEveryOtherDay1: true };
            const target = {};

            copyFlags(source, target, 1, null);

            expect(target.isMassage).toBe(true);
            expect(target.isPnf).toBe(false);
            expect(target.isEveryOtherDay).toBe(true);
        });

        test('copies flags from normal to split part', () => {
            const source = { isMassage: true, isPnf: true };
            const target = {};

            copyFlags(source, target, null, 2);

            expect(target.isMassage2).toBe(true);
            expect(target.isPnf2).toBe(true);
        });
    });

    describe('clearSplitFields', () => {
        test('removes all split-specific fields', () => {
            const state = {
                content: 'Test',
                content1: 'Part1',
                content2: 'Part2',
                isMassage1: true,
                treatmentData1: { startDate: '2024-01-01' },
                treatmentData2: { startDate: '2024-02-01' },
            };

            clearSplitFields(state);

            expect(state.content).toBe('Test');
            expect(state.content1).toBeUndefined();
            expect(state.content2).toBeUndefined();
            expect(state.isMassage1).toBeUndefined();
            expect(state.treatmentData1).toBeUndefined();
            expect(state.treatmentData2).toBeUndefined();
        });
    });

    describe('clearAllProperties', () => {
        test('clears all properties from object', () => {
            const state = { a: 1, b: 2, c: 3 };
            clearAllProperties(state);

            expect(Object.keys(state).length).toBe(0);
        });
    });

    describe('getTodayDate', () => {
        test('returns date in YYYY-MM-DD format', () => {
            const result = getTodayDate();
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        test('returns current date', () => {
            const result = getTodayDate();
            const today = new Date();
            const expected = today.toISOString().split('T')[0];
            expect(result).toBe(expected);
        });
    });

    describe('copyTreatmentToTarget', () => {
        test('copies to normal cell', () => {
            const treatmentData = {
                startDate: '2024-01-01',
                extensionDays: 5,
                endDate: '2024-01-16',
                additionalInfo: 'Note',
            };
            const target = {};

            copyTreatmentToTarget(treatmentData, target, null);

            expect(target.treatmentStartDate).toBe('2024-01-01');
            expect(target.treatmentExtensionDays).toBe(5);
            expect(target.treatmentEndDate).toBe('2024-01-16');
            expect(target.additionalInfo).toBe('Note');
        });

        test('copies to split cell part 2', () => {
            const treatmentData = {
                startDate: '2024-02-01',
                extensionDays: 3,
            };
            const target = {};

            copyTreatmentToTarget(treatmentData, target, 2);

            expect(target.treatmentData2.startDate).toBe('2024-02-01');
            expect(target.treatmentData2.extensionDays).toBe(3);
        });
    });

    describe('copyFullCellState', () => {
        test('copies all properties from source to target', () => {
            const source = {
                content: 'Test',
                isSplit: false,
                isMassage: true,
                treatmentStartDate: '2024-01-01',
                treatmentData1: { startDate: '2024-02-01' },
            };
            const target = {};

            copyFullCellState(source, target);

            expect(target.content).toBe('Test');
            expect(target.isSplit).toBe(false);
            expect(target.isMassage).toBe(true);
            expect(target.treatmentStartDate).toBe('2024-01-01');
            expect(target.treatmentData1).toEqual({ startDate: '2024-02-01' });
        });
    });

    describe('createSourceClearFn', () => {
        test('clears all properties for normal cell', () => {
            const clearFn = createSourceClearFn(null);
            const state = { content: 'Test', isMassage: true };

            clearFn(state);

            expect(Object.keys(state).length).toBe(0);
        });

        test('clears only specified part for split cell', () => {
            const clearFn = createSourceClearFn(1);
            const state = {
                isSplit: true,
                content1: 'Part1',
                content2: 'Part2',
                isMassage1: true,
            };

            clearFn(state);

            expect(state.content1).toBe('');
            expect(state.content2).toBe('Part2');
            expect(state.isMassage1).toBeUndefined();
        });

        test('clears entire cell when both parts are empty', () => {
            const clearFn = createSourceClearFn(1);
            const state = {
                isSplit: true,
                content1: 'Part1',
                content2: '',
            };

            clearFn(state);

            expect(Object.keys(state).length).toBe(0);
        });
    });

    describe('createTargetUpdateFn', () => {
        test('creates function that copies data to target cell', () => {
            const oldCellState = {
                content: 'OldPatient',
                isMassage: true,
                treatmentStartDate: '2024-01-01',
            };

            const updateFn = createTargetUpdateFn(oldCellState, null, null);
            const target = {};

            updateFn(target);

            expect(target.content).toBe('OldPatient');
            expect(target.isMassage).toBe(true);
        });
    });

    describe('initTreatmentData', () => {
        test('initializes treatment data for new entry', () => {
            const cellState = { content: 'New Patient' };

            initTreatmentData(cellState);

            expect(cellState.treatmentStartDate).toBeDefined();
            expect(cellState.treatmentStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(cellState.treatmentEndDate).toBeDefined();
        });

        test('does not overwrite existing treatment data', () => {
            const cellState = {
                content: 'Existing Patient',
                treatmentStartDate: '2024-01-15',
            };

            initTreatmentData(cellState);

            expect(cellState.treatmentStartDate).toBe('2024-01-15');
        });

        test('does not initialize for split cells', () => {
            const cellState = { content: 'Test', isSplit: true };

            initTreatmentData(cellState);

            expect(cellState.treatmentStartDate).toBeUndefined();
        });

        test('does not initialize for empty cells', () => {
            const cellState = { content: '' };

            initTreatmentData(cellState);

            expect(cellState.treatmentStartDate).toBeUndefined();
        });
    });
});
