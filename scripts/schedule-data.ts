// scripts/schedule-data.ts
import { db as dbRaw } from './firebase-config.js';
import { AppConfig, UndoManager } from './common.js';
import { validateCellState, sanitizeCellState } from './data-validation.js';
import type { FirestoreDbWrapper } from './types/firebase';
import type { CellState, ScheduleHistoryEntry, ScheduleAppState } from './types/index.js';

const db = dbRaw as unknown as FirestoreDbWrapper;

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
 * Moduł danych harmonogramu
 */
export const ScheduleData: ScheduleDataAPI = (() => {
    let appState: ScheduleAppState = {
        scheduleCells: {},
    };
    let undoManager: InstanceType<typeof UndoManager>;
    let unsubscribeSchedule: (() => void) | null = null;
    let isSaving = false;
    let saveQueued = false;
    let currentUserId: string | null = null;
    let isInitialLoad = true;
    let _onDataChange: (() => void) | null = null;
    const PENDING_SAVE_STORAGE_KEY = 'schedulePendingServerSave';
    const PENDING_SAVE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const SAVE_CONFIRM_TIMEOUT_MS = 10000;

    interface PendingScheduleSave {
        payload: ScheduleAppState;
        token: string;
        createdAt: string;
    }

    const getScheduleDocRef = () => {
        return db.collection(AppConfig.firestore.collections.schedules).doc(AppConfig.firestore.docs.mainSchedule);
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

    const readPendingSave = (): PendingScheduleSave | null => {
        try {
            const raw = localStorage.getItem(PENDING_SAVE_STORAGE_KEY);
            if (!raw) return null;

            const pending = JSON.parse(raw) as PendingScheduleSave;
            const createdAt = new Date(pending.createdAt).getTime();
            if (!pending.payload?.scheduleCells || !pending.token || Number.isNaN(createdAt)) {
                localStorage.removeItem(PENDING_SAVE_STORAGE_KEY);
                return null;
            }

            if (Date.now() - createdAt > PENDING_SAVE_MAX_AGE_MS) {
                localStorage.removeItem(PENDING_SAVE_STORAGE_KEY);
                return null;
            }

            return pending;
        } catch (error) {
            console.warn('Nie udało się odczytać lokalnej kopii oczekującego zapisu:', error);
            localStorage.removeItem(PENDING_SAVE_STORAGE_KEY);
            return null;
        }
    };

    const storePendingSave = (payload: ScheduleAppState, token: string): void => {
        try {
            const pending: PendingScheduleSave = {
                payload,
                token,
                createdAt: new Date().toISOString(),
            };
            localStorage.setItem(PENDING_SAVE_STORAGE_KEY, JSON.stringify(pending));
        } catch (error) {
            console.warn('Nie udało się zapisać lokalnej kopii oczekującego zapisu:', error);
        }
    };

    const clearPendingSave = (token: string): void => {
        const pending = readPendingSave();
        if (!pending || pending.token === token) {
            localStorage.removeItem(PENDING_SAVE_STORAGE_KEY);
        }
    };

    const verifyScheduleSaved = async (token: string): Promise<void> => {
        const docRef = getScheduleDocRef();
        const snapshot = docRef.getFromServer ? await docRef.getFromServer() : await docRef.get();
        const serverData = snapshot.data() as ScheduleAppState | undefined;

        if (!snapshot.exists || serverData?.saveToken !== token) {
            throw new Error('Nie potwierdzono zapisu harmonogramu na serwerze.');
        }
    };

    const restorePendingSaveIfNeeded = async (): Promise<void> => {
        const pending = readPendingSave();
        if (!pending || isSaving) return;

        try {
            await verifyScheduleSaved(pending.token);
            clearPendingSave(pending.token);
        } catch {
            appState.scheduleCells = pending.payload.scheduleCells;
            notifyChange();
            window.showToast('Przywrócono niezapisane zmiany i ponawiam zapis...', 5000);
            await saveSchedule();
        }
    };

    const init = (onDataChange: (() => void) | null, undoButtonElement: HTMLButtonElement | null): void => {
        _onDataChange = onDataChange;

        undoManager = new UndoManager({
            maxStates: AppConfig.undoManager.maxStates,
            onUpdate: (manager: InstanceType<typeof UndoManager>) => {
                if (undoButtonElement) {
                    const canUndo = manager.canUndo();
                    undoButtonElement.disabled = !canUndo;
                    undoButtonElement.classList.toggle('active', canUndo);
                }
            },
        });
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
                } else {
                    appState.scheduleCells = {};
                    saveSchedule();
                }

                if (isInitialLoad) {
                    undoManager.initialize(getCurrentTableState());
                    isInitialLoad = false;
                    void restorePendingSaveIfNeeded();
                }

                notifyChange();
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
        window.setSaveStatus('saving');

        try {
            if (AppConfig.debug) {
                for (const time of Object.keys(appState.scheduleCells)) {
                    for (const empIdx of Object.keys(appState.scheduleCells[time])) {
                        const validation = validateCellState(appState.scheduleCells[time][empIdx]);
                        if (!validation.valid) {
                            console.warn(`Walidacja komórki [${time}][${empIdx}]:`, validation.errors);
                        }
                    }
                }
            }

            const saveToken = createSaveToken();
            const payload: ScheduleAppState = {
                ...appState,
                lastSavedAt: new Date().toISOString(),
                lastSavedBy: currentUserId,
                saveToken,
            };

            storePendingSave(payload, saveToken);
            await withTimeout(
                getScheduleDocRef().set(payload, { merge: true }),
                SAVE_CONFIRM_TIMEOUT_MS,
                'Przekroczono czas zapisu harmonogramu.'
            );
            await withTimeout(
                verifyScheduleSaved(saveToken),
                SAVE_CONFIRM_TIMEOUT_MS,
                'Przekroczono czas potwierdzenia zapisu harmonogramu.'
            );
            clearPendingSave(saveToken);
            window.setSaveStatus('saved');
            isSaving = false;

            if (saveQueued) {
                saveQueued = false;
                await saveSchedule();
            }
        } catch (error) {
            console.error('Error saving schedule to Firestore:', error);
            window.setSaveStatus('error');
            window.showToast('Nie potwierdzono zapisu na serwerze. Zmiany zapisano lokalnie i zostaną ponowione.', 7000);
            isSaving = false;
        }
    };

    const updateCellState = (time: string, employeeIndex: string, updateFn: (state: CellState) => void): void => {
        undoManager.pushState(getCurrentTableState());

        if (!appState.scheduleCells[time]) appState.scheduleCells[time] = {};
        const cellState = appState.scheduleCells[time][employeeIndex] || {};

        const oldContent = cellState.isSplit
            ? `${cellState.content1 || ''}/${cellState.content2 || ''}`
            : cellState.content;
        _updateCellHistory(cellState, oldContent ?? undefined);

        updateFn(cellState);

        const validation = validateCellState(cellState);
        if (!validation.valid && AppConfig.debug) {
            console.warn(`Walidacja komórki [${time}][${employeeIndex}]:`, validation.errors);
        }

        appState.scheduleCells[time][employeeIndex] = sanitizeCellState(cellState) as CellState;

        notifyChange();
        saveSchedule();
    };

    const updateMultipleCells = (updates: CellUpdate[]): void => {
        undoManager.pushState(getCurrentTableState());

        updates.forEach(({ time, employeeIndex, updateFn }) => {
            if (!appState.scheduleCells[time]) appState.scheduleCells[time] = {};
            const cellState = appState.scheduleCells[time][employeeIndex] || {};

            const oldContent = cellState.isSplit
                ? `${cellState.content1 || ''}/${cellState.content2 || ''}`
                : cellState.content;
            _updateCellHistory(cellState, oldContent ?? undefined);

            updateFn(cellState);

            const validation = validateCellState(cellState);
            if (!validation.valid && AppConfig.debug) {
                console.warn(`Walidacja komórki [${time}][${employeeIndex}]:`, validation.errors);
            }

            appState.scheduleCells[time][employeeIndex] = sanitizeCellState(cellState) as CellState;
        });

        notifyChange();
        saveSchedule();
    };

    const getCurrentTableState = (): ScheduleAppState => JSON.parse(JSON.stringify(appState));

    const getCellState = (time: string, employeeIndex: string): CellState | undefined => {
        return appState.scheduleCells[time]?.[employeeIndex];
    };

    const undo = (): void => {
        const prevState = undoManager.undo() as ScheduleAppState | null;
        if (prevState) {
            appState.scheduleCells = prevState.scheduleCells;
            notifyChange();
            saveSchedule();
        }
    };

    const destroy = (): void => {
        if (unsubscribeSchedule) {
            unsubscribeSchedule();
        }
    };

    const getAppState = (): ScheduleAppState => appState;

    const pushCurrentState = (): void => {
        undoManager.pushState(getCurrentTableState());
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

// Backward compatibility
declare global {
    interface Window {
        ScheduleData: ScheduleDataAPI;
    }
}

window.ScheduleData = ScheduleData;
