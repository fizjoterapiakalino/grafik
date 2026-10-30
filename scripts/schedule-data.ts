// scripts/schedule-data.ts
import { db as dbRaw, FieldValue } from './firebase-config.js';
import { AppConfig } from './common.js';
import { CELL_CONTENT_KEYS } from './utils.js';
import { ensureCellPatientIds } from './schedule-helpers.js';
import { ensureTodayWorkloadSnapshot, persistTodayWorkloadSnapshot } from './workload-snapshot.js';
import type { FirestoreDbWrapper } from './types/firebase';
import type { CellState, ScheduleHistoryEntry, ScheduleAppState } from './types/index.js';

const db = dbRaw as unknown as FirestoreDbWrapper;

const ALLOWED_CELL_KEYS = [
    ...CELL_CONTENT_KEYS,
    'isBreak',
    'history',
] as const;

const ALLOWED_TREATMENT_KEYS = ['startDate', 'extensionDays', 'endDate', 'additionalInfo'] as const;

const sanitizeTreatmentData = (data: unknown): Record<string, unknown> | null => {
    if (!data || typeof data !== 'object') return null;
    const typed = data as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const key of ALLOWED_TREATMENT_KEYS) {
        if (key in typed) sanitized[key] = typed[key];
    }
    return Object.keys(sanitized).length > 0 ? sanitized : null;
};

export const sanitizeCellState = (cellState: unknown): CellState => {
    if (!cellState || typeof cellState !== 'object') return {};
    const state = cellState as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const key of ALLOWED_CELL_KEYS) {
        if (key in state) {
            const val = state[key];
            if (key === 'treatmentData1' || key === 'treatmentData2') {
                if (val && typeof val === 'object') {
                    sanitized[key] = sanitizeTreatmentData(val);
                }
            } else if (key === 'history') {
                if (Array.isArray(val)) {
                    sanitized[key] = val.slice(0, 10);
                }
            } else {
                sanitized[key] = val;
            }
        }
    }
    return sanitized as CellState;
};

/**
 * Aktualizacja komórki
 */
interface CellUpdate {
    time: string;
    employeeIndex: string;
    updateFn: (state: CellState) => void;
}

/**
 * Interfejs publicznego API ScheduleData
 */
interface ScheduleDataAPI {
    init(onDataChange: (() => void) | null, undoButtonElement: HTMLButtonElement | null): void;
    setCurrentUserId(uid: string | null): void;
    listenForScheduleChanges(): void;
    saveSchedule(): Promise<void>;
    updateCellState(time: string, employeeIndex: string, updateFn: (state: CellState) => void): void;
    updateMultipleCells(updates: CellUpdate[]): void;
    getCurrentTableState(): ScheduleAppState;
    getCellState(time: string, employeeIndex: string): CellState | undefined;
    undo(): void;
    destroy(): void;
    getAppState(): ScheduleAppState;
    pushCurrentState(): void;
}

/**
 * Element na stosie undo
 */
interface CellUndoItem {
    time: string;
    employeeIndex: string;
    prevCell: CellState;
}
type CellUndoBatch = CellUndoItem[];

interface DirtyCellEntry {
    time: string;
    employeeIndex: string;
    value: CellState | null;
}

/**
 * Moduł danych harmonogramu
 */
export const ScheduleData: ScheduleDataAPI = (() => {
    let appState: ScheduleAppState = {
        scheduleCells: {},
    };
    let cellUndoStack: CellUndoBatch[] = [];
    let _undoButtonElement: HTMLButtonElement | null = null;
    const dirtyCells = new Map<string, DirtyCellEntry>();

    let unsubscribeSchedule: (() => void) | null = null;
    let isSaving = false;
    let saveQueued = false;
    let currentUserId: string | null = null;
    let isInitialLoad = true;
    let initialSnapshotEnsured = false;
    let _onDataChange: (() => void) | null = null;
    const PENDING_SAVE_STORAGE_KEY = 'schedulePendingServerSave';
    const SAVE_CONFIRM_TIMEOUT_MS = 10000;

    const getScheduleDocRef = () => {
        return db.collection(AppConfig.firestore.collections.schedules).doc(AppConfig.firestore.docs.mainSchedule);
    };

    const updateUndoButtonUI = (): void => {
        if (_undoButtonElement) {
            const canUndo = cellUndoStack.length > 0;
            _undoButtonElement.disabled = !canUndo;
            _undoButtonElement.classList.toggle('active', canUndo);
        }
    };

    const pushUndoBatch = (batch: CellUndoBatch): void => {
        cellUndoStack.push(batch);
        const maxStates = AppConfig.undoManager?.maxStates ?? 20;
        if (cellUndoStack.length > maxStates) {
            cellUndoStack.shift();
        }
        updateUndoButtonUI();
    };

    const _updateCellHistory = (cellState: CellState, oldContent: string | undefined): void => {
        if (!oldContent || oldContent.trim() === '') {
            return;
        }

        if (!cellState.history) {
            cellState.history = [];
        }

        const lastHistoryValue = cellState.history[0] ? cellState.history[0].oldValue : null;
        if (lastHistoryValue === oldContent) {
            return;
        }

        const historyEntry: ScheduleHistoryEntry = {
            oldValue: oldContent,
            timestamp: new Date().toISOString(),
            userId: currentUserId,
        };

        cellState.history.unshift(historyEntry);
        const MAX_HISTORY_ENTRIES = 10;
        cellState.history = cellState.history.slice(0, MAX_HISTORY_ENTRIES);
    };

    const notifyChange = (): void => {
        if (_onDataChange && typeof _onDataChange === 'function') {
            _onDataChange();
        }
    };

    const createSaveToken = (): string => {
        if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
            return crypto.randomUUID();
        }
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    };

    const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
        });

        try {
            return await Promise.race([promise, timeoutPromise]);
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    };

    const storePendingDirtyCells = (): void => {
        try {
            const arr = Array.from(dirtyCells.values());
            if (arr.length === 0) {
                localStorage.removeItem(PENDING_SAVE_STORAGE_KEY);
            } else {
                localStorage.setItem(PENDING_SAVE_STORAGE_KEY, JSON.stringify(arr));
            }
        } catch (error) {
            console.warn('Nie udało się zapisać lokalnej kopii oczekującego zapisu:', error);
        }
    };

    const applyDirtyCellsToLocalState = (): void => {
        if (dirtyCells.size === 0) return;
        for (const { time, employeeIndex, value } of dirtyCells.values()) {
            if (value && Object.keys(value).length > 0) {
                if (!appState.scheduleCells[time]) appState.scheduleCells[time] = {};
                appState.scheduleCells[time][employeeIndex] = value;
            } else if (appState.scheduleCells[time]) {
                delete appState.scheduleCells[time][employeeIndex];
            }
        }
    };

    const restorePendingSaveIfNeeded = async (): Promise<void> => {
        try {
            const raw = localStorage.getItem(PENDING_SAVE_STORAGE_KEY);
            if (!raw) return;

            let pendingArr: DirtyCellEntry[] = [];
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    pendingArr = parsed;
                }
            } catch {
                localStorage.removeItem(PENDING_SAVE_STORAGE_KEY);
                return;
            }

            if (pendingArr.length === 0) {
                localStorage.removeItem(PENDING_SAVE_STORAGE_KEY);
                return;
            }

            for (const item of pendingArr) {
                if (item && item.time && item.employeeIndex !== undefined) {
                    dirtyCells.set(`${item.time}__${item.employeeIndex}`, item);
                }
            }

            if (dirtyCells.size > 0) {
                applyDirtyCellsToLocalState();
                notifyChange();
                if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
                    window.showToast('Przywrócono niezapisane zmiany i ponawiam zapis...', 5000);
                }
                await saveSchedule();
            }
        } catch (error) {
            console.warn('Nie udało się odczytać lokalnej kopii oczekującego zapisu:', error);
            localStorage.removeItem(PENDING_SAVE_STORAGE_KEY);
        }
    };

    const init = (onDataChange: (() => void) | null, undoButtonElement: HTMLButtonElement | null): void => {
        _onDataChange = onDataChange;
        _undoButtonElement = undoButtonElement;
        cellUndoStack = [];
        updateUndoButtonUI();
    };

    const setCurrentUserId = (uid: string | null): void => {
        currentUserId = uid;
    };

    const listenForScheduleChanges = (): void => {
        if (unsubscribeSchedule) {
            unsubscribeSchedule();
        }

        const docRef = getScheduleDocRef();
        unsubscribeSchedule = docRef.onSnapshot(
            (doc) => {
                if (doc.exists) {
                    const savedData = doc.data() as ScheduleAppState | undefined;
                    if (savedData?.scheduleCells && Object.keys(savedData.scheduleCells).length > 0) {
                        appState.scheduleCells = savedData.scheduleCells;
                    } else {
                        appState.scheduleCells = {};
                    }
                    applyDirtyCellsToLocalState();
                } else {
                    appState.scheduleCells = {};
                    void saveSchedule();
                }

                if (isInitialLoad) {
                    isInitialLoad = false;
                    void restorePendingSaveIfNeeded();
                }

                notifyChange();
                if (!initialSnapshotEnsured && Object.keys(appState.scheduleCells).length > 0) {
                    initialSnapshotEnsured = true;
                    void ensureTodayWorkloadSnapshot(appState.scheduleCells)
                        .catch(error => console.warn('Nie udało się upewnić dzisiejszego snapshotu obciążenia:', error));
                }
            },
            (error) => {
                console.error('Error listening to schedule changes:', error);
                window.showToast('Błąd synchronizacji grafiku. Odśwież stronę.', 5000);
            }
        );
    };

    const saveSchedule = async (): Promise<void> => {
        if (isSaving) {
            saveQueued = true;
            return;
        }

        isSaving = true;
        if (typeof window !== 'undefined' && typeof window.setSaveStatus === 'function') {
            window.setSaveStatus('saving');
        }

        try {
            const docRef = getScheduleDocRef();
            const saveToken = createSaveToken();
            const nowIso = new Date().toISOString();

            if (dirtyCells.size > 0) {
                const batchToSave = new Map(dirtyCells);
                const updatePayload: Record<string, unknown> = {
                    lastSavedAt: nowIso,
                    lastSavedBy: currentUserId,
                    saveToken,
                };

                for (const entry of batchToSave.values()) {
                    const { time, employeeIndex, value } = entry;
                    const fieldPath = `scheduleCells.${time}.${employeeIndex}`;
                    updatePayload[fieldPath] = (value && Object.keys(value).length > 0)
                        ? value
                        : (FieldValue as { delete(): unknown }).delete();
                }

                const performUpdate = async (): Promise<void> => {
                    try {
                        await docRef.update(updatePayload);
                    } catch (err: unknown) {
                        const error = err as { code?: string; message?: string };
                        if (error?.code === 'not-found' || error?.message?.includes('No document to update') || error?.message?.includes('NOT_FOUND')) {
                            await docRef.set({
                                scheduleCells: appState.scheduleCells,
                                lastSavedAt: nowIso,
                                lastSavedBy: currentUserId,
                                saveToken,
                            }, { merge: true });
                        } else {
                            throw err;
                        }
                    }
                };

                await withTimeout(
                    performUpdate(),
                    SAVE_CONFIRM_TIMEOUT_MS,
                    'Przekroczono czas zapisu harmonogramu.'
                );

                for (const [key, entry] of batchToSave) {
                    if (dirtyCells.get(key) === entry) {
                        dirtyCells.delete(key);
                    }
                }
                storePendingDirtyCells();
            } else {
                const payload: ScheduleAppState = {
                    ...appState,
                    lastSavedAt: nowIso,
                    lastSavedBy: currentUserId,
                    saveToken,
                };
                await withTimeout(
                    docRef.set(payload, { merge: true }),
                    SAVE_CONFIRM_TIMEOUT_MS,
                    'Przekroczono czas zapisu harmonogramu.'
                );
            }

            if (typeof window !== 'undefined' && typeof window.setSaveStatus === 'function') {
                window.setSaveStatus('saved');
            }
            void persistTodayWorkloadSnapshot(appState.scheduleCells)
                .catch(snapshotError => console.warn('Nie udało się zapisać dzisiejszego snapshotu obciążenia:', snapshotError));
            isSaving = false;

            if (saveQueued || dirtyCells.size > 0) {
                saveQueued = false;
                await saveSchedule();
            }
        } catch (error) {
            console.error('Error saving schedule to Firestore:', error);
            if (typeof window !== 'undefined' && typeof window.setSaveStatus === 'function') {
                window.setSaveStatus('error');
            }
            if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
                window.showToast('Nie potwierdzono zapisu na serwerze. Zmiany zapisano lokalnie i zostaną ponowione.', 7000);
            }
            isSaving = false;
        }
    };

    const updateCellState = (time: string, employeeIndex: string, updateFn: (state: CellState) => void): void => {
        const currentCell = appState.scheduleCells[time]?.[employeeIndex];
        const prevCell: CellState = currentCell ? JSON.parse(JSON.stringify(currentCell)) : {};
        pushUndoBatch([{ time, employeeIndex, prevCell }]);

        if (!appState.scheduleCells[time]) appState.scheduleCells[time] = {};
        const cellState = appState.scheduleCells[time][employeeIndex] || {};

        const oldContent = cellState.isSplit
            ? `${cellState.content1 || ''}/${cellState.content2 || ''}`
            : cellState.content;
        _updateCellHistory(cellState, oldContent ?? undefined);

        updateFn(cellState);
        ensureCellPatientIds(cellState);

        const sanitized = sanitizeCellState(cellState);
        if (Object.keys(sanitized).length > 0) {
            appState.scheduleCells[time][employeeIndex] = sanitized;
            dirtyCells.set(`${time}__${employeeIndex}`, { time, employeeIndex, value: sanitized });
        } else {
            delete appState.scheduleCells[time][employeeIndex];
            dirtyCells.set(`${time}__${employeeIndex}`, { time, employeeIndex, value: null });
        }
        storePendingDirtyCells();

        notifyChange();
        void saveSchedule();
    };

    const updateMultipleCells = (updates: CellUpdate[]): void => {
        const batch: CellUndoBatch = updates.map(({ time, employeeIndex }) => {
            const currentCell = appState.scheduleCells[time]?.[employeeIndex];
            const prevCell: CellState = currentCell ? JSON.parse(JSON.stringify(currentCell)) : {};
            return { time, employeeIndex, prevCell };
        });
        pushUndoBatch(batch);

        updates.forEach(({ time, employeeIndex, updateFn }) => {
            if (!appState.scheduleCells[time]) appState.scheduleCells[time] = {};
            const cellState = appState.scheduleCells[time][employeeIndex] || {};

            const oldContent = cellState.isSplit
                ? `${cellState.content1 || ''}/${cellState.content2 || ''}`
                : cellState.content;
            _updateCellHistory(cellState, oldContent ?? undefined);

            updateFn(cellState);
            ensureCellPatientIds(cellState);

            const sanitized = sanitizeCellState(cellState);
            if (Object.keys(sanitized).length > 0) {
                appState.scheduleCells[time][employeeIndex] = sanitized;
                dirtyCells.set(`${time}__${employeeIndex}`, { time, employeeIndex, value: sanitized });
            } else {
                delete appState.scheduleCells[time][employeeIndex];
                dirtyCells.set(`${time}__${employeeIndex}`, { time, employeeIndex, value: null });
            }
        });
        storePendingDirtyCells();

        notifyChange();
        void saveSchedule();
    };

    const getCurrentTableState = (): ScheduleAppState => JSON.parse(JSON.stringify(appState));

    const getCellState = (time: string, employeeIndex: string): CellState | undefined => {
        return appState.scheduleCells[time]?.[employeeIndex];
    };

    const undo = (): void => {
        const lastBatch = cellUndoStack.pop();
        updateUndoButtonUI();
        if (lastBatch && lastBatch.length > 0) {
            for (const { time, employeeIndex, prevCell } of lastBatch) {
                if (!appState.scheduleCells[time]) {
                    appState.scheduleCells[time] = {};
                }
                const sanitized = sanitizeCellState(prevCell);
                if (Object.keys(sanitized).length > 0) {
                    appState.scheduleCells[time][employeeIndex] = sanitized;
                    dirtyCells.set(`${time}__${employeeIndex}`, { time, employeeIndex, value: sanitized });
                } else {
                    delete appState.scheduleCells[time][employeeIndex];
                    dirtyCells.set(`${time}__${employeeIndex}`, { time, employeeIndex, value: null });
                }
            }
            storePendingDirtyCells();
            notifyChange();
            void saveSchedule();
        }
    };

    const destroy = (): void => {
        if (unsubscribeSchedule) {
            unsubscribeSchedule();
            unsubscribeSchedule = null;
        }
        isInitialLoad = true;
        initialSnapshotEnsured = false;
        cellUndoStack = [];
        updateUndoButtonUI();
        dirtyCells.clear();
    };

    const getAppState = (): ScheduleAppState => appState;

    const pushCurrentState = (): void => {
        // Safe no-op for API compatibility; updateCellState & updateMultipleCells record delta directly
    };

    return {
        init,
        setCurrentUserId,
        listenForScheduleChanges,
        saveSchedule,
        updateCellState,
        updateMultipleCells,
        getCurrentTableState,
        getCellState,
        undo,
        destroy,
        getAppState,
        pushCurrentState,
    };
})();
