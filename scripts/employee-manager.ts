// scripts/employee-manager.ts
import { db as dbRaw } from './firebase-config.js';
import type { Employee, EmployeesMap, EmployeeLeaveInfo } from './types';
import type { FirestoreDbWrapper } from './types/firebase';

// Type assertion dla db
const db = dbRaw as unknown as FirestoreDbWrapper;

/**
 * Pracownik z ID (rozszerzony interfejs do zwracania z funkcji)
 */
interface EmployeeWithId extends Employee {
    id: string;
}

/**
 * Interfejs publicznego API EmployeeManager
 */
interface EmployeeManagerAPI {
    load(): Promise<void>;
    getAll(): EmployeesMap;
    getById(id: string): Employee | null;
    getNameById(id: string): string;
    getFullNameById(id: string): string;
    getLastNameById(id: string): string;
    getLeaveInfoById(id: string, year?: number): EmployeeLeaveInfo;
    updateCarriedOverLeave(id: string, year: number, value: number): Promise<void>;
    compareEmployees(empA: Employee, empB: Employee): number;
    getEmployeeByUid(uid: string): EmployeeWithId | null;
    isUserAdmin(uid: string): boolean;
    updateEmployee(id: string, data: Partial<Employee>): Promise<void>;
}

/**
 * Moduł zarządzający pracownikami
 * Singleton odpowiedzialny za pobieranie, aktualizowanie i wyszukiwanie pracowników
 */
export const EmployeeManager: EmployeeManagerAPI = (() => {
    /** Prywatna mapa pracowników */
    let _employees: EmployeesMap = {};

    /**
     * Interfejs dokumentu schedule z Firestore
     */
    interface ScheduleDocumentData {
        employees?: EmployeesMap;
        weeklyData?: Record<string, unknown>;
    }

    /**
     * Pobiera dane pracowników z Firestore
     */
    const _fetchFromDB = async (): Promise<void> => {
        try {
            const docRef = db.collection<ScheduleDocumentData>('schedules').doc('mainSchedule');
            const docSnap = await docRef.get();
            const data = docSnap.data();
            if (docSnap.exists && data?.employees) {
                _employees = data.employees;
            } else {
                _employees = {};
                console.warn("Brak obiektu 'employees' w Firestore. Inicjalizacja pustego stanu.");
            }
        } catch (error) {
            console.error('Błąd krytyczny podczas pobierania danych pracowników z Firestore:', error);
            window.showToast('Wystąpił błąd podczas pobierania listy pracowników. Spróbuj odświeżyć stronę.', 5000);
            _employees = {};
        }
    };

    /**
     * Pomocnicza funkcja do sortowania - zwraca klucz sortowania dla pracownika
     */
    const getSortKey = (emp: Employee): string => {
        if (emp.firstName || emp.lastName) {
            return `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
        }
        return (emp.displayName || emp.name || '').trim();
    };

    // Publiczne API modułu
    return {
        /**
         * Inicjalizuje moduł, pobierając dane z Firestore
         */
        load: async function (): Promise<void> {
            await _fetchFromDB();
        },

        /**
         * Zwraca wszystkich pracowników
         */
        getAll: (): EmployeesMap => _employees,

        /**
         * Zwraca konkretnego pracownika po jego ID/kluczu
         */
        getById: (id: string): Employee | null => _employees[id] || null,

        /**
         * Zwraca tylko imię i nazwisko pracownika (displayName lub fallback)
         */
        getNameById: (id: string): string =>
            _employees[id]?.displayName || _employees[id]?.name || `Pracownik ${id}`,

        /**
         * Zwraca pełne imię i nazwisko pracownika
         */
        getFullNameById: (id: string): string => {
            const employee = _employees[id];
            if (!employee) return `Nieznany Pracownik ${id}`;
            const firstName = employee.firstName || '';
            const lastName = employee.lastName || '';
            const fullName = `${firstName} ${lastName}`.trim();
            return fullName === '' ? employee.displayName || `Pracownik ${id}` : fullName;
        },

        /**
         * Zwraca tylko nazwisko pracownika
         */
        getLastNameById: (id: string): string => {
            const employee = _employees[id];
            if (!employee) return `Nieznany ${id}`;
            return employee.lastName || '';
        },

        /**
         * Zwraca informacje urlopowe pracownika dla danego roku
         */
        getLeaveInfoById: (id: string, year?: number): EmployeeLeaveInfo => {
            const employee = _employees[id];
            if (!employee) return { entitlement: 0, carriedOver: 0 };

            let carriedOver = 0;
            // Sprawdź czy mamy wartość dla konkretnego roku
            if (year && employee.carriedOverLeaveByYear && employee.carriedOverLeaveByYear[year] !== undefined) {
                carriedOver = employee.carriedOverLeaveByYear[year];
            } else {
                // Fallback do starego pola (dla kompatybilności wstecznej)
                carriedOver = employee.carriedOverLeave || 0;
            }

            return {
                entitlement: employee.leaveEntitlement || 0,
                carriedOver: carriedOver,
            };
        },

        /**
         * Aktualizuje urlop zaległy dla konkretnego roku
         */
        updateCarriedOverLeave: async function (id: string, year: number, value: number): Promise<void> {
            if (!_employees[id]) return;

            if (!_employees[id].carriedOverLeaveByYear) {
                _employees[id].carriedOverLeaveByYear = {};
            }
            _employees[id].carriedOverLeaveByYear![year] = value;

            try {
                const docRef = db.collection('schedules').doc('mainSchedule');
                const updateData: Record<string, number> = {};
                updateData[`employees.${id}.carriedOverLeaveByYear.${year}`] = value;
                await docRef.update(updateData);
            } catch (error) {
                console.error('Błąd podczas aktualizacji zaległego urlopu:', error);
                window.showToast('Nie udało się zapisać zmiany urlopu zaległego.', 5000);
            }
        },

        /**
         * Porównuje dwóch pracowników do sortowania (po imieniu i nazwisku)
         */
        compareEmployees: (empA: Employee, empB: Employee): number => {
            return getSortKey(empA).localeCompare(getSortKey(empB), 'pl', { sensitivity: 'base' });
        },

        /**
         * Zwraca pracownika i jego ID na podstawie UID z Firebase Auth
         */
        getEmployeeByUid: (uid: string): EmployeeWithId | null => {
            if (!uid) return null;
            for (const id in _employees) {
                if (_employees[id].uid === uid) {
                    return { id, ..._employees[id] };
                }
            }
            return null;
        },

        /**
         * Sprawdza, czy użytkownik o danym UID ma rolę admina
         */
        isUserAdmin: function (uid: string): boolean {
            if (!uid) return false;
            const employee = this.getEmployeeByUid(uid);
            return employee?.role === 'admin';
        },

        /**
         * Aktualizuje dane pracownika i zapisuje do Firestore
         */
        updateEmployee: async function (id: string, data: Partial<Employee>): Promise<void> {
            if (!_employees[id]) {
                console.error(`Pracownik o ID ${id} nie istnieje.`);
                return;
            }
            // Zaktualizuj lokalny stan
            const updatedEmployee: Employee = { ..._employees[id], ...data };
            _employees[id] = updatedEmployee;

            // Zapisz TYLKO tego pracownika do Firestore używając dot notation
            try {
                const docRef = db.collection('schedules').doc('mainSchedule');
                const updateData: Record<string, Employee> = {};
                updateData[`employees.${id}`] = updatedEmployee;
                await docRef.update(updateData);
            } catch (error) {
                console.error('Błąd podczas aktualizacji danych pracownika w Firestore:', error);
                window.showToast('Nie udało się zapisać zmian.', 5000);
            }
        },
    };
})();

// Backward compatibility - przypisanie do window
declare global {
    interface Window {
        EmployeeManager: EmployeeManagerAPI;
    }
}

window.EmployeeManager = EmployeeManager;
