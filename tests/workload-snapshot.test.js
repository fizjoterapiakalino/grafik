/**
 * @jest-environment jsdom
 */

const mockStatsDoc = {
    get: jest.fn(),
    set: jest.fn(),
};

const mockLeavesDoc = {
    get: jest.fn(),
};

jest.mock('../scripts/firebase-config.js', () => ({
    db: {
        collection: jest.fn((collectionName) => ({
            doc: jest.fn((_docId) => {
                if (collectionName === 'leaves') {
                    return mockLeavesDoc;
                }
                return mockStatsDoc;
            }),
        })),
    },
}));

jest.mock('../scripts/employee-manager.js', () => ({
    EmployeeManager: {
        getAll: jest.fn(),
        load: jest.fn().mockResolvedValue(undefined),
    },
}));

import { EmployeeManager } from '../scripts/employee-manager.js';
import {
    ensureTodayWorkloadSnapshot,
    persistTodayWorkloadSnapshot,
} from '../scripts/workload-snapshot.js';

describe('workload-snapshot', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        EmployeeManager.getAll.mockReturnValue({
            empA: { displayName: 'Anna Kowalska', color: '#10b981' },
        });
        mockLeavesDoc.get.mockResolvedValue({
            exists: false,
            data: () => ({}),
        });
        mockStatsDoc.set.mockResolvedValue(undefined);
    });

    test('ensureTodayWorkloadSnapshot skips .set() when statsDaily/{today} already exists', async () => {
        const WednesdayWorkday = new Date('2026-10-21T10:00:00Z');
        const existingData = {
            date: '2026-10-21',
            isWorkday: true,
            totalPatients: 8,
            employees: {
                empA: { employeeId: 'empA', patientSlots: 8, availableSlots: 15 },
            },
        };

        mockStatsDoc.get.mockResolvedValueOnce({
            exists: true,
            data: () => existingData,
        });

        const result = await ensureTodayWorkloadSnapshot({}, WednesdayWorkday);

        expect(mockStatsDoc.get).toHaveBeenCalled();
        expect(mockStatsDoc.set).not.toHaveBeenCalled();
        expect(result).toEqual(existingData);
    });

    test('ensureTodayWorkloadSnapshot writes .set() when statsDaily/{today} does not exist on a workday', async () => {
        const WednesdayWorkday = new Date('2026-10-21T10:00:00Z');
        mockStatsDoc.get.mockResolvedValueOnce({
            exists: false,
            data: () => null,
        });

        const scheduleCells = {
            '8:00': {
                empA: {
                    content: 'Pacjent Testowy',
                    treatmentStartDate: '2026-10-19',
                    treatmentEndDate: '2026-11-06',
                },
            },
        };

        const result = await ensureTodayWorkloadSnapshot(scheduleCells, WednesdayWorkday);

        expect(mockStatsDoc.get).toHaveBeenCalled();
        expect(mockStatsDoc.set).toHaveBeenCalledTimes(1);
        expect(result).toBeDefined();
        expect(result?.date).toBe('2026-10-21');
        expect(result?.employees.empA.patientSlots).toBe(1);
    });

    test('ensureTodayWorkloadSnapshot does not write on a weekend or public holiday', async () => {
        const Saturday = new Date('2026-10-24T10:00:00Z');

        const result = await ensureTodayWorkloadSnapshot({}, Saturday);

        expect(mockStatsDoc.get).not.toHaveBeenCalled();
        expect(mockStatsDoc.set).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    test('persistTodayWorkloadSnapshot coalesces in-flight calls', async () => {
        const WednesdayWorkday = new Date('2026-10-21T10:00:00Z');
        let resolveFirstSet;
        const firstSetPromise = new Promise((resolve) => {
            resolveFirstSet = resolve;
        });

        mockStatsDoc.set.mockImplementationOnce(() => firstSetPromise);

        const p1 = persistTodayWorkloadSnapshot({}, WednesdayWorkday);
        const p2 = persistTodayWorkloadSnapshot({}, WednesdayWorkday);

        resolveFirstSet();
        const [r1, r2] = await Promise.all([p1, p2]);

        expect(r1).toBeDefined();
        expect(r2).toBeDefined();
        expect(mockStatsDoc.set).toHaveBeenCalled();
    });
});
