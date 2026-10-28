import { AppConfig } from './common.js';
import { db as dbRaw } from './firebase-config.js';
import { EmployeeManager } from './employee-manager.js';
import { createDailyWorkloadSnapshot, type DailyWorkloadSnapshot } from './statistics-helpers.js';
import type { LeaveEntry, ScheduleCellsMap } from './types/index.js';
import type { FirestoreDbWrapper } from './types/firebase';

const db = dbRaw as unknown as FirestoreDbWrapper;
const DAILY_STATS_COLLECTION = 'statsDaily';

type LeavesMap = Record<string, LeaveEntry[]>;

const normalizeLeavesData = (rawData: unknown): LeavesMap => {
    if (!rawData || typeof rawData !== 'object') return {};

    return Object.fromEntries(
        Object.entries(rawData as Record<string, unknown>)
            .filter(([, value]) => Array.isArray(value))
            .map(([employeeName, value]) => [
                employeeName,
                (value as unknown[]).filter((leave): leave is LeaveEntry => {
                    if (!leave || typeof leave !== 'object') return false;
                    const candidate = leave as Partial<LeaveEntry>;
                    return typeof candidate.startDate === 'string' && typeof candidate.endDate === 'string';
                }),
            ])
    );
};

/**
 * Zapisuje wyłącznie dzisiejszy stan grafiku. Celowo nie tworzy brakujących
 * danych z przeszłości: taki backfill przypisywałby stare dni według obecnego
 * miejsca pacjenta i fałszował historię po przeniesieniu.
 */
export const persistTodayWorkloadSnapshot = async (
    scheduleCells: ScheduleCellsMap,
    referenceDate: Date = new Date()
): Promise<DailyWorkloadSnapshot | null> => {
    let employees = EmployeeManager.getAll();
    if (Object.keys(employees).length === 0) {
        try {
            await EmployeeManager.load();
            employees = EmployeeManager.getAll();
        } catch (loadError) {
            console.warn('Nie udało się załadować listy pracowników przed snapshotem:', loadError);
        }
    }
    if (Object.keys(employees).length === 0) return null;

    const leavesDoc = await db
        .collection(AppConfig.firestore.collections.leaves)
        .doc(AppConfig.firestore.docs.mainLeaves)
        .get();
    const leavesData = leavesDoc.exists ? normalizeLeavesData(leavesDoc.data()) : {};
    const snapshot = createDailyWorkloadSnapshot(scheduleCells, employees, leavesData, referenceDate);

    if (!snapshot.isWorkday) return snapshot;

    // Nadpisanie dokumentu jest zamierzone: w ciągu bieżącego dnia snapshot
    // ma odzwierciedlać ostatni zatwierdzony stan grafiku.
    await db.collection<DailyWorkloadSnapshot>(DAILY_STATS_COLLECTION)
        .doc(snapshot.date)
        .set(snapshot);

    return snapshot;
};
