/**
 * @jest-environment jsdom
 */

const mockUnsubscribe = jest.fn();
const mockDocRef = {
    onSnapshot: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
    get: jest.fn(),
};

jest.mock('../scripts/firebase-config.js', () => ({
    db: {
        collection: jest.fn(() => ({
            doc: jest.fn(() => mockDocRef),
        })),
    },
    FieldValue: {
        delete: jest.fn(() => '__DELETE__'),
    },
}));

import { db } from '../scripts/firebase-config.js';
import { ScheduleData, sanitizeCellState, sanitizeAbsenceDates } from '../scripts/schedule-data.js';

describe('ScheduleData', () => {
    let snapshotCallback = null;
    const emitSnapshot = (scheduleCells = {}) => {
        if (snapshotCallback) {
            snapshotCallback({
                exists: true,
                data: () => ({ scheduleCells }),
            });
            return mockUnsubscribe;
        }
        mockDocRef.onSnapshot.mockImplementation((onNext) => {
            snapshotCallback = onNext;
            onNext({
                exists: true,
                data: () => ({ scheduleCells }),
            });
            return mockUnsubscribe;
        });
    };

    const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

    let lastSavedPayload = null;
    beforeEach(() => {
        jest.clearAllMocks();
        snapshotCallback = null;
        window.setSaveStatus = jest.fn();
        window.showToast = jest.fn();
        lastSavedPayload = null;
        mockDocRef.set.mockImplementation((payload) => {
            lastSavedPayload = payload;
            return Promise.resolve();
        });
        mockDocRef.update.mockImplementation((payload) => {
            lastSavedPayload = payload;
            return Promise.resolve();
        });
        mockDocRef.get.mockImplementation(() => Promise.resolve({
            exists: true,
            data: () => lastSavedPayload || ScheduleData.getAppState(),
        }));
        emitSnapshot({});
    });

    afterEach(() => {
        ScheduleData.destroy();
    });

    test('listenForScheduleChanges loads schedule cells and notifies caller', () => {
        const onChange = jest.fn();
        const scheduleCells = {
            '8:00': {
                0: { content: 'Pacjent' },
            },
        };
        emitSnapshot(scheduleCells);

        ScheduleData.init(onChange, null);
        ScheduleData.listenForScheduleChanges();

        expect(db.collection).toHaveBeenCalledWith('schedules');
        expect(ScheduleData.getAppState().scheduleCells).toEqual(scheduleCells);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    test('updateCellState stores sanitized data, history and save status via atomic update', async () => {
        const onChange = jest.fn();
        emitSnapshot({
            '8:00': {
                0: { content: 'Stary pacjent' },
            },
        });

        ScheduleData.init(onChange, null);
        ScheduleData.setCurrentUserId('user-1');
        ScheduleData.listenForScheduleChanges();
        onChange.mockClear();

        ScheduleData.updateCellState('8:00', '0', (state) => {
            state.content = 'Nowy pacjent';
            state.isEveryOtherDay = true;
            state.unknownField = 'usun';
        });
        await flushPromises();

        const cell = ScheduleData.getCellState('8:00', '0');
        expect(cell.content).toBe('Nowy pacjent');
        expect(cell.isEveryOtherDay).toBe(true);
        expect(cell.unknownField).toBeUndefined();
        expect(cell.history[0].oldValue).toBe('Stary pacjent');
        expect(cell.history[0].userId).toBe('user-1');
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(window.setSaveStatus).toHaveBeenCalledWith('saving');
        expect(window.setSaveStatus).toHaveBeenCalledWith('saved');
        expect(mockDocRef.update).toHaveBeenCalledWith(expect.objectContaining({
            'scheduleCells.8:00.0': expect.objectContaining({
                content: 'Nowy pacjent',
                isEveryOtherDay: true,
            }),
        }));
    });

    test('updateMultipleCells applies a single batch of cell updates via atomic update', async () => {
        const onChange = jest.fn();

        ScheduleData.init(onChange, null);
        ScheduleData.listenForScheduleChanges();
        onChange.mockClear();

        ScheduleData.updateMultipleCells([
            {
                time: '8:00',
                employeeIndex: '0',
                updateFn: (state) => {
                    state.content = 'Pacjent 1';
                },
            },
            {
                time: '8:30',
                employeeIndex: '1',
                updateFn: (state) => {
                    state.content = 'Pacjent 2';
                    state.isPnf = true;
                },
            },
        ]);
        await flushPromises();

        expect(ScheduleData.getCellState('8:00', '0').content).toBe('Pacjent 1');
        expect(ScheduleData.getCellState('8:30', '1')).toMatchObject({
            content: 'Pacjent 2',
            isPnf: true,
        });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(mockDocRef.update).toHaveBeenCalledTimes(1);
        expect(mockDocRef.update).toHaveBeenCalledWith(expect.objectContaining({
            'scheduleCells.8:00.0': expect.objectContaining({ content: 'Pacjent 1' }),
            'scheduleCells.8:30.1': expect.objectContaining({ content: 'Pacjent 2', isPnf: true }),
        }));
    });

    test('undo restores previous state and triggers save', async () => {
        emitSnapshot({
            '8:00': {
                0: { content: 'Przed zmianą' },
            },
        });

        ScheduleData.init(jest.fn(), null);
        ScheduleData.listenForScheduleChanges();
        ScheduleData.pushCurrentState();

        ScheduleData.updateCellState('8:00', '0', (state) => {
            state.content = 'Po zmianie';
        });
        await flushPromises();

        ScheduleData.undo();
        await flushPromises();

        expect(ScheduleData.getCellState('8:00', '0').content).toBe('Przed zmianą');
        expect(mockDocRef.update).toHaveBeenCalledTimes(2);
    });

    test('multi-user concurrency: editing 8:00/0 sends atomic update without overwriting remote 8:30/1, and undo preserves remote 8:30/1', async () => {
        const onChange = jest.fn();
        emitSnapshot({
            '8:00': {
                0: { content: 'Pacjent Początkowy' },
            },
        });

        ScheduleData.init(onChange, null);
        ScheduleData.listenForScheduleChanges();
        onChange.mockClear();
        mockDocRef.update.mockClear();

        // 1) User edits cell 8:00 / 0
        ScheduleData.updateCellState('8:00', '0', (state) => {
            state.content = 'Lokalna Zmiana';
        });
        await flushPromises();

        expect(mockDocRef.update).toHaveBeenCalledTimes(1);
        const firstUpdateCall = mockDocRef.update.mock.calls[0][0];
        expect(firstUpdateCall['scheduleCells.8:00.0']).toEqual(expect.objectContaining({ content: 'Lokalna Zmiana' }));
        expect(firstUpdateCall['scheduleCells.8:30.1']).toBeUndefined();

        // 2) Remote snapshot arrives concurrently with another therapist's edit at 8:30 / 1
        emitSnapshot({
            '8:00': {
                0: { content: 'Lokalna Zmiana' },
            },
            '8:30': {
                1: { content: 'Zdalny Pacjent Innego Fizjoterapeuty' },
            },
        });

        expect(ScheduleData.getCellState('8:30', '1')).toEqual({ content: 'Zdalny Pacjent Innego Fizjoterapeuty' });
        mockDocRef.update.mockClear();

        // 3) User hits Undo: only 8:00 / 0 is restored, and remote 8:30 / 1 remains intact
        ScheduleData.undo();
        await flushPromises();

        expect(ScheduleData.getCellState('8:00', '0')).toEqual(expect.objectContaining({ content: 'Pacjent Początkowy' }));
        expect(ScheduleData.getCellState('8:30', '1')).toEqual({ content: 'Zdalny Pacjent Innego Fizjoterapeuty' });

        expect(mockDocRef.update).toHaveBeenCalledTimes(1);
        const secondUpdateCall = mockDocRef.update.mock.calls[0][0];
        expect(secondUpdateCall['scheduleCells.8:00.0']).toEqual(expect.objectContaining({ content: 'Pacjent Początkowy' }));
        expect(secondUpdateCall['scheduleCells.8:30.1']).toBeUndefined();
    });

    test('destroy unsubscribes active schedule listener', () => {
        ScheduleData.init(jest.fn(), null);
        ScheduleData.listenForScheduleChanges();

        ScheduleData.destroy();

        expect(mockUnsubscribe).toHaveBeenCalled();
    });

    describe('absenceDates sanitization and persistence', () => {
        test('sanitizeAbsenceDates filters non-YYYY-MM-DD strings, dedupes, and sorts chronologically', () => {
            expect(sanitizeAbsenceDates(null)).toEqual([]);
            expect(sanitizeAbsenceDates(undefined)).toEqual([]);
            expect(sanitizeAbsenceDates('2026-11-01')).toEqual([]);
            expect(sanitizeAbsenceDates([
                '2026-11-10',
                'invalid',
                '2026-11-02',
                '2026-11-10',
                123,
                null,
                ' 2026-11-05 ',
            ])).toEqual(['2026-11-02', '2026-11-05', '2026-11-10']);
        });

        test('sanitizeCellState sanitizes absenceDates for normal cell and split treatmentData', () => {
            const rawCell = {
                content: 'Jan Kowalski',
                absenceDates: ['2026-11-08', 'bad', '2026-11-01'],
                treatmentData1: {
                    startDate: '2026-10-20',
                    absenceDates: ['2026-10-25', '2026-10-22'],
                },
                treatmentData2: {
                    startDate: '2026-10-21',
                    absenceDates: null,
                },
                absenceDates1: ['2026-11-12', '2026-11-04'],
                absenceDates2: null,
            };

            const sanitized = sanitizeCellState(rawCell);
            expect(sanitized.absenceDates).toEqual(['2026-11-01', '2026-11-08']);
            expect(sanitized.treatmentData1?.absenceDates).toEqual(['2026-10-22', '2026-10-25']);
            expect(sanitized.treatmentData2?.absenceDates).toBeNull();
            expect(sanitized.absenceDates1).toEqual(['2026-11-04', '2026-11-12']);
            expect(sanitized.absenceDates2).toBeNull();
        });

        test('updateCellState persists sanitized absenceDates to Firestore', async () => {
            emitSnapshot({
                '09:00': {
                    0: { content: 'Pacjent Bez Nieobecności' },
                },
            });

            ScheduleData.init(jest.fn(), null);
            ScheduleData.listenForScheduleChanges();
            mockDocRef.update.mockClear();

            ScheduleData.updateCellState('09:00', '0', (state) => {
                state.absenceDates = ['2026-11-09', 'invalid', '2026-11-03'];
            });
            await flushPromises();

            expect(mockDocRef.update).toHaveBeenCalledTimes(1);
            const updateCall = mockDocRef.update.mock.calls[0][0];
            expect(updateCall['scheduleCells.09:00.0'].absenceDates).toEqual(['2026-11-03', '2026-11-09']);
        });
    });
});
