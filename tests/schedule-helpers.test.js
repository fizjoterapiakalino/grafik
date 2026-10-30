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
    ensureActiveTreatmentDates,
} from '../scripts/schedule-helpers.js';
jest.mock('../scripts/firebase-config.js', () => ({
    db: {
        collection: jest.fn().mockReturnThis(),
        doc: jest.fn().mockReturnThis(),
        get: jest.fn(),
        update: jest.fn(),
    },
    auth: {},
}));

import { ScheduleModals } from '../scripts/schedule-modals.js';

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

jest.mock('../scripts/schedule-ui.js', () => ({
    ScheduleUI: {
        getElementText: jest.fn((element) => {
            if (!element) return '';
            return element.textContent ? element.textContent.trim() : '';
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

        test('populates treatmentStartDate and treatmentEndDate on target for a legacy undated source cell', () => {
            const sourceCell = { content: 'Kowalski' };
            const target = {};
            const updateFn = createTargetUpdateFn(sourceCell, null, null);
            updateFn(target);

            expect(target.content).toBe('Kowalski');
            expect(typeof target.treatmentStartDate).toBe('string');
            expect(target.treatmentStartDate.length).toBeGreaterThan(0);
            expect(typeof target.treatmentEndDate).toBe('string');
            expect(target.treatmentEndDate.length).toBeGreaterThan(0);
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

    describe('ensureActiveTreatmentDates', () => {
        test('fills missing treatmentStartDate/treatmentEndDate on normal and split cells while keeping existing dates when resetIfExpired is false', () => {
            const normalMissing = { content: 'Kowalski' };
            ensureActiveTreatmentDates(normalMissing, { resetIfExpired: false, todayIso: '2026-10-30' });
            expect(normalMissing.treatmentStartDate).toBe('2026-10-30');
            expect(normalMissing.treatmentEndDate).toBe('2026-11-09');

            const normalExpired = {
                content: 'Nowak',
                treatmentStartDate: '2026-09-01',
                treatmentEndDate: '2026-09-19',
                treatmentExtensionDays: 3,
            };
            ensureActiveTreatmentDates(normalExpired, { resetIfExpired: false, todayIso: '2026-10-30' });
            expect(normalExpired.treatmentStartDate).toBe('2026-09-01');
            expect(normalExpired.treatmentEndDate).toBe('2026-09-19');
            expect(normalExpired.treatmentExtensionDays).toBe(3);

            const normalMissingEnd = {
                content: 'Wiśniewski',
                treatmentStartDate: '2026-10-20',
            };
            ensureActiveTreatmentDates(normalMissingEnd, { resetIfExpired: false, todayIso: '2026-10-30' });
            expect(normalMissingEnd.treatmentStartDate).toBe('2026-10-20');
            expect(normalMissingEnd.treatmentEndDate).toBe('2026-10-30');

            const splitMissing = {
                isSplit: true,
                content1: 'A',
                content2: 'B',
            };
            ensureActiveTreatmentDates(splitMissing, { resetIfExpired: false, todayIso: '2026-10-30' });
            expect(splitMissing.treatmentData1.startDate).toBe('2026-10-30');
            expect(splitMissing.treatmentData1.endDate).toBe('2026-11-09');
            expect(splitMissing.treatmentData2.startDate).toBe('2026-10-30');
            expect(splitMissing.treatmentData2.endDate).toBe('2026-11-09');

            const splitCell = {
                isSplit: true,
                content1: 'A',
                treatmentData1: { startDate: '2026-09-01', endDate: '2026-09-19' },
                content2: 'B',
                treatmentData2: { startDate: '2026-10-20' },
            };
            ensureActiveTreatmentDates(splitCell, { resetIfExpired: false, todayIso: '2026-10-30' });
            expect(splitCell.treatmentData1.startDate).toBe('2026-09-01');
            expect(splitCell.treatmentData1.endDate).toBe('2026-09-19');
            expect(splitCell.treatmentData2.startDate).toBe('2026-10-20');
            expect(splitCell.treatmentData2.endDate).toBe('2026-10-30');
        });

        test('resets expired part and preserves active part on split cell when resetIfExpired is true', () => {
            const splitCell = {
                isSplit: true,
                content1: 'Pacjent 1',
                content2: 'Pacjent 2',
                treatmentData1: {
                    startDate: '2026-09-01',
                    endDate: '2026-09-19',
                    extensionDays: 5,
                },
                treatmentData2: {
                    startDate: '2026-10-26',
                    endDate: '2026-11-16',
                    extensionDays: 2,
                },
            };

            ensureActiveTreatmentDates(splitCell, { resetIfExpired: true, todayIso: '2026-10-30' });

            expect(splitCell.treatmentData1.startDate).toBe('2026-10-30');
            expect(splitCell.treatmentData1.extensionDays).toBe(0);
            expect(splitCell.treatmentData1.endDate).toBe('2026-11-09');
            expect(splitCell.treatmentData2.startDate).toBe('2026-10-26');
            expect(splitCell.treatmentData2.endDate).toBe('2026-11-16');
            expect(splitCell.treatmentData2.extensionDays).toBe(2);
        });
    });

    describe('ScheduleModals.openPatientInfoModal', () => {
        test('opened on 2nd child of split-cell-wrapper reads treatmentData2 and saves to treatmentData2 without writing root treatmentStartDate', () => {
            window.showToast = jest.fn();

            document.body.innerHTML = `
                <div id="patientInfoModal" style="display: none;">
                    <input id="patientName" />
                    <input id="treatmentStartDate" />
                    <input id="treatmentExtensionDays" />
                    <input id="treatmentEndDate" />
                    <textarea id="additionalInfo"></textarea>
                    <button id="savePatientInfoModal"></button>
                    <button id="closePatientInfoModal"></button>
                </div>
                <div class="split-cell-wrapper">
                    <div id="part1">Pacjent Pierwszy</div>
                    <div id="part2">Pacjent Drugi</div>
                </div>
            `;

            const part2El = document.getElementById('part2');
            const startDateInput = document.getElementById('treatmentStartDate');
            const extensionDaysInput = document.getElementById('treatmentExtensionDays');
            const saveBtn = document.getElementById('savePatientInfoModal');

            const cellState = {
                isSplit: true,
                content1: 'Pacjent Pierwszy',
                content2: 'Pacjent Drugi',
                treatmentData1: {
                    startDate: '2026-10-01',
                    extensionDays: 1,
                    endDate: '2026-10-15',
                    additionalInfo: 'Info 1',
                },
                treatmentData2: {
                    startDate: '2026-10-20',
                    extensionDays: 4,
                    endDate: '2026-11-05',
                    additionalInfo: 'Info 2',
                },
            };

            let updatedState = null;
            const updateCallback = (fn) => {
                const stateCopy = JSON.parse(JSON.stringify(cellState));
                fn(stateCopy);
                updatedState = stateCopy;
            };

            ScheduleModals.openPatientInfoModal(part2El, cellState, updateCallback);

            expect(startDateInput.value).toBe('2026-10-20');
            expect(extensionDaysInput.value).toBe('4');

            saveBtn.click();

            expect(updatedState).not.toBeNull();
            expect(updatedState.treatmentData2).toBeDefined();
            expect(updatedState.treatmentData2.startDate).toBe('2026-10-20');
            expect(updatedState.treatmentData2.extensionDays).toBe(4);
            expect(updatedState.treatmentStartDate).toBeUndefined();

            // Defaulting blank startDateInput to today
            ScheduleModals.openPatientInfoModal(part2El, cellState, updateCallback);
            startDateInput.value = '   ';
            saveBtn.click();
            expect(updatedState.treatmentData2.startDate).toBe(getTodayDate());
            expect(updatedState.treatmentStartDate).toBeUndefined();
        });
    });
});
