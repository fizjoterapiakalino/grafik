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
        0: { firstName: 'Jan', lastName: 'Kowalski', role: 'user', uid: 'user123' },
        1: { firstName: 'Anna', lastName: 'Nowak', role: 'admin', uid: 'admin456' },
        2: { displayName: 'Marek', role: 'user' }, // Legacy format
    };

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset internal state if possible, or re-load
        // Since EmployeeManager is a singleton IIFE, we rely on load() to reset/set state
    });

    test('load() should fetch employees from Firestore', async () => {
        db.collection()
            .doc()
            .get.mockResolvedValue({
                exists: true,
                data: () => ({ employees: mockEmployees }),
            });

        await EmployeeManager.load();

        const employees = EmployeeManager.getAll();
        expect(employees).toEqual(mockEmployees);
        expect(db.collection).toHaveBeenCalledWith('schedules');
        expect(db.doc).toHaveBeenCalledWith('mainSchedule');
    });

    test('load() should handle missing data gracefully', async () => {
        db.collection().doc().get.mockResolvedValue({
            exists: false,
        });

        await EmployeeManager.load();
        expect(EmployeeManager.getAll()).toEqual({});
    });

    test('getById() should return correct employee', async () => {
        // Ensure data is loaded
        db.collection()
            .doc()
            .get.mockResolvedValue({
                exists: true,
                data: () => ({ employees: mockEmployees }),
            });
        await EmployeeManager.load();

        expect(EmployeeManager.getById('0')).toEqual(mockEmployees['0']);
        expect(EmployeeManager.getById('999')).toBeNull();
    });

    test('getFullNameById() should format names correctly', async () => {
        await EmployeeManager.load(); // Assumes mockEmployees is still set from previous mock setup if not cleared, but better to be explicit if needed.
        // Re-mocking for safety in this test block
        db.collection()
            .doc()
            .get.mockResolvedValue({
                exists: true,
                data: () => ({ employees: mockEmployees }),
            });
        await EmployeeManager.load();

        expect(EmployeeManager.getFullNameById('0')).toBe('Jan Kowalski');
        expect(EmployeeManager.getFullNameById('2')).toBe('Marek');
        expect(EmployeeManager.getFullNameById('999')).toBe('Nieznany Pracownik 999');
    });

    test('isUserAdmin() should return true for admin uid', async () => {
        await EmployeeManager.load();
        expect(EmployeeManager.isUserAdmin('admin456')).toBe(true);
        expect(EmployeeManager.isUserAdmin('user123')).toBe(false);
        expect(EmployeeManager.isUserAdmin('unknown')).toBe(false);
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
});
