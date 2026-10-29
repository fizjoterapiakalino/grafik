import { AppConfig } from './common.js';
import { db as dbRaw } from './firebase-config.js';
import { EmployeeManager } from './employee-manager.js';
import { createDailyWorkloadSnapshot, normalizeLeavesData, type DailyWorkloadSnapshot } from './statistics-helpers.js';
import { formatLocalIsoDate } from './utils.js';
import type { ScheduleCellsMap } from './types/index.js';
import type { FirestoreDbWrapper } from './types/firebase';

const db = dbRaw as unknown as FirestoreDbWrapper;
const DAILY_STATS_COLLECTION = 'statsDaily';

let inFlightPromise: Promise<DailyWorkloadSnapshot | null> | null = null;
let latestQueued: { scheduleCells: ScheduleCellsMap; referenceDate: Date } | null = null;

const executePersist = async (
    scheduleCells: ScheduleCellsMap,
    referenceDate: Date
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

    // Upewnij się, że data odpowiada dacie lokalnej
    snapshot.date = formatLocalIsoDate(referenceDate);

    if (!snapshot.isWorkday) return snapshot;

    // Nadpisanie dokumentu jest zamierzone: w ciągu bieżącego dnia snapshot
    // ma odzwierciedlać ostatni zatwierdzony stan grafiku.
    await db.collection<DailyWorkloadSnapshot>(DAILY_STATS_COLLECTION)
        .doc(snapshot.date)
        .set(snapshot);

    return snapshot;
};

/**
 * Zapisuje wyłącznie dzisiejszy stan grafiku. Celowo nie tworzy brakujących
 * danych z przeszłości: taki backfill przypisywałby stare dni według obecnego
 * miejsca pacjenta i fałszował historię po przeniesieniu.
 * Posiada mechanizm single-flight coalescing eliminujący wyścigi równoległych zapisów.
 */
export const persistTodayWorkloadSnapshot = async (
    scheduleCells: ScheduleCellsMap,
    referenceDate: Date = new Date()
): Promise<DailyWorkloadSnapshot | null> => {
    if (inFlightPromise) {
        latestQueued = { scheduleCells, referenceDate };
        return inFlightPromise;
    }

    inFlightPromise = (async () => {
        try {
            let result = await executePersist(scheduleCells, referenceDate);
            while (latestQueued) {
                const next = latestQueued;
                latestQueued = null;
                result = await executePersist(next.scheduleCells, next.referenceDate);
            }
            return result;
        } finally {
            inFlightPromise = null;
        }
    })();

    return inFlightPromise;
};
