import { EmployeeManager } from '../scripts/employee-manager.js';
import { db } from '../scripts/firebase-config.js';

// Mock Firebase
jest.mock('../scripts/firebase-config.js', () => ({
    db: {
        collection: jest.fn().mockReturnThis(),
        doc: jest.fn().mockReturnThis(),
        get: jest.fn(),
        update: jest.fn(),
    },
}));

// Mock window.showToast
window.showToast = jest.fn();

describe('EmployeeManager', () => {
    const mockEmployees = {
        0: {
            firstName: 'Jan',
            lastName: 'Kowalski',
            role: 'user',
            uid: 'user123',
            leaveEntitlement: 26,
            carriedOverLeaveByYear: { 2026: 4 },
        },
        1: {
            firstName: 'Anna',
            lastName: 'Nowak',
            role: 'admin',
            uid: 'admin456',
            leaveEntitlement: 20,
            carriedOverLeave: 1,
        },
        2: { displayName: 'Marek', role: 'user' }, // Legacy format
    };

    const mockLoadResult = (employees = mockEmployees) => {
        db.collection()
            .doc()
            .get.mockResolvedValue({
                exists: true,
                data: () => ({ employees }),
            });
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockLoadResult();
    });

    test('load() should fetch employees from Firestore', async () => {
        await EmployeeManager.load();

        const employees = EmployeeManager.getAll();
        expect(employees).toEqual(mockEmployees);
        expect(db.collection).toHaveBeenCalledWith('schedules');
        expect(db.doc).toHaveBeenCalledWith('mainSchedule');
    });

    test('load() should handle missing data gracefully', async () => {
        db.collection().doc().get.mockResolvedValue({
            exists: false,
            data: () => ({}),
        });

        await EmployeeManager.load();
        expect(EmployeeManager.getAll()).toEqual({});
    });

    test('getById() should return correct employee', async () => {
        await EmployeeManager.load();

        expect(EmployeeManager.getById('0')).toEqual(mockEmployees['0']);
        expect(EmployeeManager.getById('999')).toBeNull();
    });

    test('getFullNameById() should format names correctly', async () => {
        await EmployeeManager.load();

        expect(EmployeeManager.getFullNameById('0')).toBe('Jan Kowalski');
        expect(EmployeeManager.getFullNameById('2')).toBe('Marek');
        expect(EmployeeManager.getFullNameById('999')).toBe('Nieznany Pracownik 999');
    });

    test('getNameById() and getLastNameById() should use fallbacks', async () => {
        await EmployeeManager.load();

        expect(EmployeeManager.getNameById('2')).toBe('Marek');
        expect(EmployeeManager.getNameById('999')).toBe('Pracownik 999');
        expect(EmployeeManager.getLastNameById('0')).toBe('Kowalski');
        expect(EmployeeManager.getLastNameById('999')).toBe('Nieznany 999');
    });

    test('getLeaveInfoById() should prefer year-specific values and fall back to legacy field', async () => {
        await EmployeeManager.load();

        expect(EmployeeManager.getLeaveInfoById('0', 2026)).toEqual({
            entitlement: 26,
            carriedOver: 4,
        });
        expect(EmployeeManager.getLeaveInfoById('1', 2026)).toEqual({
            entitlement: 20,
            carriedOver: 1,
        });
        expect(EmployeeManager.getLeaveInfoById('999', 2026)).toEqual({
            entitlement: 0,
            carriedOver: 0,
        });
    });

    test('getEmployeeByUid() should return employee with id', async () => {
        await EmployeeManager.load();

        expect(EmployeeManager.getEmployeeByUid('admin456')).toEqual({
            id: '1',
            ...mockEmployees['1'],
        });
        expect(EmployeeManager.getEmployeeByUid('')).toBeNull();
        expect(EmployeeManager.getEmployeeByUid('missing')).toBeNull();
    });

    test('isUserAdmin() should return true for admin uid', async () => {
        await EmployeeManager.load();
        expect(EmployeeManager.isUserAdmin('admin456')).toBe(true);
        expect(EmployeeManager.isUserAdmin('user123')).toBe(false);
        expect(EmployeeManager.isUserAdmin('unknown')).toBe(false);
    });

    test('compareEmployees() should sort by composed display key', () => {
        expect(
            EmployeeManager.compareEmployees(
                { firstName: 'Żaneta', lastName: 'Nowak' },
                { displayName: 'Adam' }
            )
        ).toBeGreaterThan(0);
    });

    test('load() should handle Firestore errors gracefully', async () => {
        db.collection().doc().get.mockRejectedValue(new Error('Network error'));

        await EmployeeManager.load();

        expect(EmployeeManager.getAll()).toEqual({});
        expect(window.showToast).toHaveBeenCalled();
    });

    test('updateCarriedOverLeave() should update local state and Firestore', async () => {
        await EmployeeManager.load();

        await EmployeeManager.updateCarriedOverLeave('1', 2026, 3);

        expect(EmployeeManager.getById('1').carriedOverLeaveByYear[2026]).toBe(3);
        expect(db.collection().doc().update).toHaveBeenCalledWith({
            'employees.1.carriedOverLeaveByYear.2026': 3,
        });
    });

    test('updateEmployee() should update local state and Firestore', async () => {
        await EmployeeManager.load();

        const updates = { firstName: 'Janusz' };
        await EmployeeManager.updateEmployee('0', updates);

        // Check local state
        expect(EmployeeManager.getById('0').firstName).toBe('Janusz');

        // Check Firestore call
        expect(db.collection().doc().update).toHaveBeenCalledWith({
            'employees.0': { ...mockEmployees['0'], ...updates },
        });
    });

    test('updateEmployee() should skip missing employees', async () => {
        await EmployeeManager.load();

        await EmployeeManager.updateEmployee('999', { firstName: 'Ghost' });

        expect(db.collection().doc().update).not.toHaveBeenCalled();
    });
});
