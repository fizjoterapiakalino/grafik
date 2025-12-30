// scripts/schedule-data.ts
import { db as dbRaw } from './firebase-config.js';
import { AppConfig, UndoManager } from './common.js';
import { validateCellState, sanitizeCellState } from './data-validation.js';
import type { FirestoreDbWrapper } from './types/firebase';

const db = dbRaw as unknown as FirestoreDbWrapper;

/**
 * Wpis historii komórki
 */
interface HistoryEntry {
    oldValue: string;
    timestamp: string;
    userId: string | null;
}

/**
 * Stan komórki harmonogramu
 */
interface CellState {
    content?: string;
    content1?: string;
    content2?: string;
    isSplit?: boolean;
    history?: HistoryEntry[];
    [key: string]: unknown;
}

/**
 * Mapa komórek harmonogramu
 */
type ScheduleCells = Record<string, Record<string, CellState>>;

/**
 * Stan aplikacji
 */
interface AppState {
    scheduleCells: ScheduleCells;
}

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
    getCurrentTableState(): AppState;
    getCellState(time: string, employeeIndex: string): CellState | undefined;
    undo(): void;
    destroy(): void;
    getAppState(): AppState;
    pushCurrentState(): void;
}

/**
 * Moduł danych harmonogramu
 */
export const ScheduleData: ScheduleDataAPI = (() => {
    let appState: AppState = {
        scheduleCells: {},
    };
    let undoManager: InstanceType<typeof UndoManager>;
    let unsubscribeSchedule: (() => void) | null = null;
    let isSaving = false;
    let saveQueued = false;
    let currentUserId: string | null = null;
    let isInitialLoad = true;
    let _onDataChange: (() => void) | null = null;

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

        const historyEntry: HistoryEntry = {
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
                    const savedData = doc.data() as AppState | undefined;
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

            await getScheduleDocRef().set(appState, { merge: true });
            window.setSaveStatus('saved');
            isSaving = false;

            if (saveQueued) {
                saveQueued = false;
                await saveSchedule();
            }
        } catch (error) {
            console.error('Error saving schedule to Firestore:', error);
            window.setSaveStatus('error');
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
        _updateCellHistory(cellState, oldContent);

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
            _updateCellHistory(cellState, oldContent);

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

    const getCurrentTableState = (): AppState => JSON.parse(JSON.stringify(appState));

    const getCellState = (time: string, employeeIndex: string): CellState | undefined => {
        return appState.scheduleCells[time]?.[employeeIndex];
    };

    const undo = (): void => {
        const prevState = undoManager.undo() as AppState | null;
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

    const getAppState = (): AppState => appState;

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
