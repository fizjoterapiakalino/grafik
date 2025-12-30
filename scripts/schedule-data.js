// scripts/schedule-data.js
import { db } from './firebase-config.js';
import { AppConfig, UndoManager } from './common.js';

export const ScheduleData = (() => {
    let appState = {
        scheduleCells: {},
    };
    let undoManager;
    let unsubscribeSchedule;
    let isSaving = false;
    let saveQueued = false;
    let currentUserId = null;
    let isInitialLoad = true;
    let _onDataChange = null; // Callback to notify controller/UI of changes

    // --- Private Methods ---

    const getScheduleDocRef = () => {
        return db.collection(AppConfig.firestore.collections.schedules).doc(AppConfig.firestore.docs.mainSchedule);
    };

    const _updateCellHistory = (cellState, oldContent) => {
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

        const historyEntry = {
            oldValue: oldContent,
            timestamp: new Date().toISOString(),
            userId: currentUserId,
        };

        cellState.history.unshift(historyEntry);
        const MAX_HISTORY_ENTRIES = 10;
        cellState.history = cellState.history.slice(0, MAX_HISTORY_ENTRIES);
    };

    const notifyChange = () => {
        if (_onDataChange && typeof _onDataChange === 'function') {
            _onDataChange();
        }
    };

    // --- Public Methods ---

    const init = (onDataChange, undoButtonElement) => {
        _onDataChange = onDataChange;

        undoManager = new UndoManager({
            maxStates: AppConfig.undoManager.maxStates,
            onUpdate: (manager) => {
                if (undoButtonElement) undoButtonElement.disabled = !manager.canUndo();
            },
        });
    };

    const setCurrentUserId = (uid) => {
        currentUserId = uid;
    };

    const listenForScheduleChanges = () => {
        if (unsubscribeSchedule) {
            unsubscribeSchedule();
        }

        const docRef = getScheduleDocRef();
        unsubscribeSchedule = docRef.onSnapshot(
            (doc) => {
                if (doc.exists) {
                    const savedData = doc.data();
                    if (savedData.scheduleCells && Object.keys(savedData.scheduleCells).length > 0) {
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
            },
        );
    };

    const saveSchedule = async () => {
        if (isSaving) {
            saveQueued = true;
            return;
        }

        isSaving = true;
        window.setSaveStatus('saving');

        try {
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

    const updateCellState = (time, employeeIndex, updateFn) => {
        undoManager.pushState(getCurrentTableState());

        if (!appState.scheduleCells[time]) appState.scheduleCells[time] = {};
        let cellState = appState.scheduleCells[time][employeeIndex] || {};

        const oldContent = cellState.isSplit
            ? `${cellState.content1 || ''}/${cellState.content2 || ''}`
            : cellState.content;
        _updateCellHistory(cellState, oldContent);

        updateFn(cellState);

        appState.scheduleCells[time][employeeIndex] = cellState;

        notifyChange();
        saveSchedule();
    };

    const updateMultipleCells = (updates) => {
        // updates: array of { time, employeeIndex, updateFn }
        undoManager.pushState(getCurrentTableState());

        updates.forEach(({ time, employeeIndex, updateFn }) => {
            if (!appState.scheduleCells[time]) appState.scheduleCells[time] = {};
            let cellState = appState.scheduleCells[time][employeeIndex] || {};

            const oldContent = cellState.isSplit
                ? `${cellState.content1 || ''}/${cellState.content2 || ''}`
                : cellState.content;
            _updateCellHistory(cellState, oldContent);

            updateFn(cellState);

            appState.scheduleCells[time][employeeIndex] = cellState;
        });

        notifyChange();
        saveSchedule();
    };

    const getCurrentTableState = () => JSON.parse(JSON.stringify(appState));

    const getCellState = (time, employeeIndex) => {
        return appState.scheduleCells[time]?.[employeeIndex];
    };

    const undo = () => {
        const prevState = undoManager.undo();
        if (prevState) {
            appState.scheduleCells = prevState.scheduleCells;
            notifyChange();
            saveSchedule();
        }
    };

    const destroy = () => {
        if (unsubscribeSchedule) {
            unsubscribeSchedule();
        }
    };

    const getAppState = () => appState;

    const pushCurrentState = () => {
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
window.ScheduleData = ScheduleData;
