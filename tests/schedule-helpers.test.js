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
    updateCellContent,
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
    afterEach(() => {
        jest.useRealTimers();
    });

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

    test('assigns a stable patient ID to a newly entered patient and replaces it for another patient', () => {
        const state = {};
        const cell = document.createElement('td');

        updateCellContent(state, 'Kowalski', null, cell, cell);
        expect(typeof state.patientId).toBe('string');
        const firstId = state.patientId;

        updateCellContent(state, 'Nowak', null, cell, cell);
        expect(typeof state.patientId).toBe('string');
        expect(state.patientId).not.toBe(firstId);
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
            const source = { isMassage: true, isPnf: false, isEveryOtherDay: true, isHydrotherapy: true };
            const target = {};

            copyFlags(source, target, null, null);

            expect(target.isMassage).toBe(true);
            expect(target.isPnf).toBe(false);
            expect(target.isEveryOtherDay).toBe(true);
            expect(target.isHydrotherapy).toBe(true);
        });

        test('copies flags from split part to normal', () => {
            const source = { isMassage1: true, isPnf1: false, isEveryOtherDay1: true, isHydrotherapy1: true };
            const target = {};

            copyFlags(source, target, 1, null);

            expect(target.isMassage).toBe(true);
            expect(target.isPnf).toBe(false);
            expect(target.isEveryOtherDay).toBe(true);
            expect(target.isHydrotherapy).toBe(true);
        });

        test('copies flags from normal to split part', () => {
            const source = { isMassage: true, isPnf: true, isHydrotherapy: true };
            const target = {};

            copyFlags(source, target, null, 2);

            expect(target.isMassage2).toBe(true);
            expect(target.isPnf2).toBe(true);
            expect(target.isHydrotherapy2).toBe(true);
        });
    });

    describe('clearSplitFields', () => {
        test('removes all split-specific fields', () => {
            const state = {
                content: 'Test',
                content1: 'Part1',
                content2: 'Part2',
                isMassage1: true,
                isHydrotherapy1: true,
                isHydrotherapy2: true,
                treatmentData1: { startDate: '2024-01-01' },
                treatmentData2: { startDate: '2024-02-01' },
            };

            clearSplitFields(state);

            expect(state.content).toBe('Test');
            expect(state.content1).toBeUndefined();
            expect(state.content2).toBeUndefined();
            expect(state.isMassage1).toBeUndefined();
            expect(state.isHydrotherapy1).toBeUndefined();
            expect(state.isHydrotherapy2).toBeUndefined();
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

        test('returns current date using formatLocalIsoDate', () => {
            const result = getTodayDate();
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            expect(result).toBe(`${year}-${month}-${day}`);
        });

        test('returns local date even when UTC date is different (e.g. 00:30 local in UTC+2)', () => {
            const localMidnightDate = new Date(2024, 4, 10, 0, 30, 0);
            jest.useFakeTimers().setSystemTime(localMidnightDate);
            const result = getTodayDate();
            expect(result).toBe('2024-05-10');
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

        test('moves split part into normal cell and clears split-only fields', () => {
            const oldCellState = {
                isSplit: true,
                content1: 'Part One',
                content2: 'Part Two',
                isMassage1: true,
                isPnf1: false,
                isEveryOtherDay1: true,
                treatmentData1: {
                    startDate: '2024-02-01',
                    extensionDays: 2,
                    endDate: '2024-02-13',
                    additionalInfo: 'From split',
                },
            };

            const updateFn = createTargetUpdateFn(oldCellState, 1, null);
            const target = {
                isSplit: true,
                content1: 'Old A',
                content2: 'Old B',
                treatmentData1: { startDate: '2024-01-01' },
            };

            updateFn(target);

            expect(target.content).toBe('Part One');
            expect(target.isSplit).toBe(false);
            expect(target.isMassage).toBe(true);
            expect(target.isEveryOtherDay).toBe(true);
            expect(target.treatmentStartDate).toBe('2024-02-01');
            expect(target.treatmentEndDate).toBe('2024-02-13');
            expect(target.additionalInfo).toBe('From split');
            expect(target.content1).toBeUndefined();
            expect(target.content2).toBeUndefined();
            expect(target.treatmentData1).toBeUndefined();
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

    describe('updateCellContent', () => {
        test('converts slash-separated input into split cell', () => {
            const cellState = {};
            const parentCell = document.createElement('td');
            const element = document.createElement('div');

            updateCellContent(cellState, 'Jan/Anna', null, element, parentCell);

            expect(cellState.isSplit).toBe(true);
            expect(cellState.content1).toBe('Jan');
            expect(cellState.content2).toBe('Anna');
        });

        test('initializes treatment data for first split entry', () => {
            jest.useFakeTimers().setSystemTime(new Date('2024-01-10T12:00:00Z'));

            const parentCell = document.createElement('td');
            const wrapper = document.createElement('div');
            wrapper.className = 'split-cell-wrapper';
            const firstPart = document.createElement('div');
            wrapper.appendChild(firstPart);
            parentCell.appendChild(wrapper);

            const cellState = { isSplit: true };

            updateCellContent(cellState, 'Pacjent', 1, firstPart, parentCell);

            expect(cellState.content1).toBe('Pacjent');
            expect(cellState.treatmentData1).toEqual({
                startDate: '2024-01-10',
                extensionDays: 0,
                endDate: '2024-01-20',
            });
        });

        test('clears split part flags and treatment data when text is removed', () => {
            const parentCell = document.createElement('td');
            const wrapper = document.createElement('div');
            wrapper.className = 'split-cell-wrapper';
            const firstPart = document.createElement('div');
            wrapper.appendChild(firstPart);
            parentCell.appendChild(wrapper);

            const cellState = {
                isSplit: true,
                content1: 'Pacjent',
                isMassage1: true,
                isPnf1: true,
                isEveryOtherDay1: true,
                isHydrotherapy1: true,
                treatmentData1: { startDate: '2024-01-10' },
            };

            updateCellContent(cellState, '', 1, firstPart, parentCell);

            expect(cellState.content1).toBe('');
            expect(cellState.isMassage1).toBeUndefined();
            expect(cellState.isPnf1).toBeUndefined();
            expect(cellState.isEveryOtherDay1).toBeUndefined();
            expect(cellState.isHydrotherapy1).toBeUndefined();
            expect(cellState.treatmentData1).toBeUndefined();
        });

        test('resets treatment data when normal cell gets a different patient', () => {
            jest.useFakeTimers().setSystemTime(new Date('2024-01-10T12:00:00Z'));

            const cellState = {
                content: 'Stary Pacjent',
                treatmentStartDate: '2024-01-01',
                treatmentExtensionDays: 7,
                treatmentEndDate: '2024-01-23',
                additionalInfo: 'Legacy note',
            };

            updateCellContent(cellState, 'Nowy Pacjent', null, document.createElement('td'), document.createElement('td'));

            expect(cellState.content).toBe('Nowy Pacjent');
            expect(cellState.treatmentStartDate).toBe('2024-01-10');
            expect(cellState.treatmentExtensionDays).toBe(0);
            expect(cellState.treatmentEndDate).toBe('2024-01-20');
            expect(cellState.additionalInfo).toBeNull();
        });

        test('migrates existing single cell data and flags into part 1 and creates fresh treatmentData2 when entering slash', () => {
            jest.useFakeTimers().setSystemTime(new Date(2024, 0, 15, 12, 0, 0));
            const cellState = {
                content: 'Kowalski',
                patientId: 'pid-original',
                treatmentStartDate: '2024-01-02',
                treatmentExtensionDays: 3,
                treatmentEndDate: '2024-01-20',
                additionalInfo: 'Ważna informacja',
                isMassage: true,
                isPnf: false,
                isEveryOtherDay: true,
                isSharedPatient: false,
                isHydrotherapy: true,
            };
            const parentCell = document.createElement('td');
            const element = document.createElement('div');

            updateCellContent(cellState, 'Kowalski / Nowak', null, element, parentCell);

            expect(cellState.isSplit).toBe(true);
            expect(cellState.content1).toBe('Kowalski ');
            expect(cellState.content2).toBe(' Nowak');
            // Part 1 preserved single cell data
            expect(cellState.patientId1).toBe('pid-original');
            expect(cellState.treatmentData1).toEqual({
                startDate: '2024-01-02',
                extensionDays: 3,
                endDate: '2024-01-20',
                additionalInfo: 'Ważna informacja',
            });
            expect(cellState.isMassage1).toBe(true);
            expect(cellState.isEveryOtherDay1).toBe(true);
            expect(cellState.isHydrotherapy1).toBe(true);

            // Part 2 got fresh treatmentData2
            expect(cellState.treatmentData2).toEqual({
                startDate: '2024-01-15',
                extensionDays: 0,
                endDate: '2024-01-25',
            });
            expect(cellState.patientId2).toBeDefined();

            // Old single-cell fields are deleted
            expect(cellState.content).toBeUndefined();
            expect(cellState.patientId).toBeNull();
            expect(cellState.treatmentStartDate).toBeUndefined();
            expect(cellState.isMassage).toBeUndefined();
            expect(cellState.isHydrotherapy).toBeUndefined();
        });
    });
});
