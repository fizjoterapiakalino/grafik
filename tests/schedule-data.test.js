/**
 * @jest-environment jsdom
 */

const mockUnsubscribe = jest.fn();
const mockDocRef = {
    onSnapshot: jest.fn(),
    set: jest.fn(),
};

jest.mock('../scripts/firebase-config.js', () => ({
    db: {
        collection: jest.fn(() => ({
            doc: jest.fn(() => mockDocRef),
        })),
    },
}));

import { db } from '../scripts/firebase-config.js';
import { ScheduleData } from '../scripts/schedule-data.js';

describe('ScheduleData', () => {
    const emitSnapshot = (scheduleCells = {}) => {
        mockDocRef.onSnapshot.mockImplementation((onNext) => {
            onNext({
                exists: true,
                data: () => ({ scheduleCells }),
            });
            return mockUnsubscribe;
        });
    };

    const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

    beforeEach(() => {
        jest.clearAllMocks();
        window.setSaveStatus = jest.fn();
        window.showToast = jest.fn();
        mockDocRef.set.mockResolvedValue(undefined);
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

    test('updateCellState stores sanitized data, history and save status', async () => {
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
        expect(mockDocRef.set).toHaveBeenCalledWith(ScheduleData.getAppState(), { merge: true });
    });

    test('updateMultipleCells applies a single batch of cell updates', async () => {
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
        expect(mockDocRef.set).toHaveBeenCalledTimes(1);
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
        expect(mockDocRef.set).toHaveBeenCalledTimes(2);
    });

    test('destroy unsubscribes active schedule listener', () => {
        ScheduleData.init(jest.fn(), null);
        ScheduleData.listenForScheduleChanges();

        ScheduleData.destroy();

        expect(mockUnsubscribe).toHaveBeenCalled();
    });
});
