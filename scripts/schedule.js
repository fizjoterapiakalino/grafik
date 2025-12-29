// scripts/schedule.js
import { auth } from './firebase-config.js';
import { AppConfig, capitalizeFirstLetter, hideLoadingOverlay } from './common.js';
import { EmployeeManager } from './employee-manager.js';
import { ScheduleUI } from './schedule-ui.js';
import { ScheduleEvents } from './schedule-events.js';
import { ScheduleData } from './schedule-data.js';
import { ScheduleModals } from './schedule-modals.js';
import { ScheduleLogic } from './schedule-logic.js';
import { safeCopy } from './utils.js';
import {
    getTargetPart,
    getSourcePart,
    createTargetUpdateFn,
    createSourceClearFn,
    updateCellContent,
    initTreatmentData,
} from './schedule-helpers.js';

export const Schedule = (() => {
    let loadingOverlay;
    let undoButton;

    const render = () => {
        ScheduleUI.render();
        ScheduleUI.updatePatientCount();
    };

    const renderAndSave = () => {
        render();
        ScheduleData.saveSchedule();
    };

    const updateCellState = (cell, updateFn) => {
        if (!cell) return;
        const time = cell.dataset.time;
        const employeeIndex = cell.dataset.employeeIndex;
        ScheduleData.updateCellState(time, employeeIndex, updateFn);
    };

    const mainController = {
        /**
         * Przetwarza wyjście z trybu edycji komórki
         * @param {HTMLElement} element - Edytowany element
         * @param {string} newText - Nowy tekst wpisany przez użytkownika
         */
        processExitEditMode(element, newText) {
            element.setAttribute('contenteditable', 'false');
            const parentCell = element.closest('[data-time]');
            if (!parentCell) return;

            const employeeIndex = parentCell.dataset.employeeIndex;
            const time = parentCell.dataset.time;
            const duplicate = this.findDuplicateEntry(newText, time, employeeIndex);
            const targetPart = getTargetPart(element);

            /**
             * Wykonuje aktualizację harmonogramu
             * @param {boolean} isMove - Czy to operacja przeniesienia (z duplikatu)
             */
            const updateSchedule = (isMove = false) => {
                if (isMove && duplicate) {
                    // Atomowa operacja przeniesienia
                    const oldCellState = duplicate.cellData;
                    const sourcePart = getSourcePart(oldCellState, newText);

                    const updates = [
                        // 1. Aktualizuj komórkę docelową
                        {
                            time: time,
                            employeeIndex: employeeIndex,
                            updateFn: createTargetUpdateFn(oldCellState, sourcePart, targetPart),
                        },
                        // 2. Wyczyść komórkę źródłową
                        {
                            time: duplicate.time,
                            employeeIndex: duplicate.employeeIndex,
                            updateFn: createSourceClearFn(sourcePart),
                        },
                    ];

                    ScheduleData.updateMultipleCells(updates);
                } else {
                    // Standardowa aktualizacja pojedynczej komórki
                    ScheduleData.updateCellState(time, employeeIndex, (cellState) => {
                        updateCellContent(cellState, newText, targetPart, element, parentCell);

                        // Inicjalizuj dane leczenia dla nowych wpisów
                        if (!isMove) {
                            initTreatmentData(cellState);
                        }
                    });
                }
            };

            // Pokaż dialog potwierdzenia jeśli znaleziono duplikat
            if (duplicate) {
                ScheduleModals.showDuplicateConfirmationDialog(
                    duplicate,
                    () => updateSchedule(true),
                    () => updateSchedule(false),
                    () => ScheduleUI.render(),
                );
            } else {
                updateSchedule(false);
            }
        },

        exitEditMode(element) {
            if (!element || element.getAttribute('contenteditable') !== 'true') return;
            const newText = capitalizeFirstLetter(element.textContent.trim());

            if (newText.length > 35) {
                window.showToast('Wprowadzony tekst jest za długi (maks. 35 znaków).', 3000);
                element.setAttribute('contenteditable', 'false');
                ScheduleUI.render();
                return;
            }

            if (/^\d+$/.test(newText)) {
                ScheduleModals.showNumericConfirmationDialog(
                    newText,
                    () => {
                        this.processExitEditMode(element, newText);
                    },
                    () => {
                        element.setAttribute('contenteditable', 'false');
                        ScheduleUI.render();
                    },
                );
                return;
            }

            this.processExitEditMode(element, newText);
        },

        enterEditMode(element, clearContent = false, initialChar = '') {
            if (
                !element ||
                element.classList.contains('break-cell') ||
                element.getAttribute('contenteditable') === 'true'
            )
                return;
            if (element.tagName === 'TD' && element.classList.contains('split-cell')) {
                const firstDiv = element.querySelector('div');
                if (firstDiv) {
                    this.enterEditMode(firstDiv, clearContent, initialChar);
                }
                return;
            }
            const isEditableTarget =
                (element.tagName === 'TD' && !element.classList.contains('split-cell')) ||
                (element.tagName === 'DIV' &&
                    (element.parentNode.classList.contains('split-cell') ||
                        element.parentNode.classList.contains('split-cell-wrapper') ||
                        element.classList.contains('editable-cell')));
            if (!isEditableTarget) return;
            const originalValue = ScheduleUI.getElementText(element);
            element.dataset.originalValue = originalValue;
            element.innerHTML = ScheduleUI.getElementText(element);
            element.setAttribute('contenteditable', 'true');
            element.classList.remove('massage-text', 'pnf-text', 'empty-slot');
            delete element.dataset.isMassage;
            delete element.dataset.isPnf;
            if (clearContent) {
                element.textContent = initialChar;
            } else if (initialChar) {
                element.textContent += initialChar;
            }
            element.focus();
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(element);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        },

        findDuplicateEntry(text, currentTime, currentEmployeeIndex) {
            if (!text) return null;
            const lowerCaseText = text.toLowerCase();
            const appState = ScheduleData.getAppState(); // Access raw state for search

            for (const time in appState.scheduleCells) {
                for (const employeeIndex in appState.scheduleCells[time]) {
                    if (time === currentTime && employeeIndex === currentEmployeeIndex) {
                        continue;
                    }
                    const cellData = appState.scheduleCells[time][employeeIndex];
                    if (
                        cellData.content?.toLowerCase() === lowerCaseText ||
                        cellData.content1?.toLowerCase() === lowerCaseText ||
                        cellData.content2?.toLowerCase() === lowerCaseText
                    ) {
                        return { time, employeeIndex, cellData };
                    }
                }
            }
            return null;
        },

        getCurrentTableStateForCell(cell) {
            if (cell.tagName === 'TH') {
                return { content: ScheduleUI.getElementText(cell) };
            }
            if (cell.classList.contains('break-cell')) {
                return { content: AppConfig.schedule.breakText, isBreak: true };
            }
            if (cell.classList.contains('split-cell')) {
                const part1 = cell.children[0];
                const part2 = cell.children[1];
                return {
                    content1: ScheduleUI.getElementText(part1),
                    content2: ScheduleUI.getElementText(part2),
                    isSplit: true,
                    isMassage1: part1?.dataset.isMassage === 'true',
                    isMassage2: part2?.dataset.isMassage === 'true',
                    isPnf1: part1?.dataset.isPnf === 'true',
                    isPnf2: part2?.dataset.isPnf === 'true',
                };
            }
            return {
                content: ScheduleUI.getElementText(cell),
                isMassage: cell.dataset.isMassage === 'true',
                isPnf: cell.dataset.isPnf === 'true',
            };
        },

        openPatientInfoModal(element) {
            const parentCell = element.closest('td');
            const time = parentCell.dataset.time;
            const employeeIndex = parentCell.dataset.employeeIndex;
            const realCellState = ScheduleData.getCellState(time, employeeIndex) || {};

            // Create a virtual state for the modal if split
            let cellState = realCellState;
            let partIndex = null;

            if (realCellState.isSplit) {
                // Determine which part was clicked
                if (element.tagName === 'DIV' && element.parentNode.classList.contains('split-cell-wrapper')) {
                    partIndex = element === element.parentNode.children[0] ? 1 : 2;
                } else if (element.closest('.split-cell-wrapper')) {
                    // Fallback if element is inside the div (e.g. icon)
                    const div = element.closest('.split-cell-wrapper > div');
                    partIndex = div === div.parentNode.children[0] ? 1 : 2;
                }

                if (partIndex) {
                    const treatmentData = realCellState[`treatmentData${partIndex}`] || {};
                    cellState = {
                        ...realCellState,
                        content: realCellState[`content${partIndex}`],
                        treatmentStartDate: treatmentData.startDate,
                        treatmentExtensionDays: treatmentData.extensionDays,
                        treatmentEndDate: treatmentData.endDate,
                        additionalInfo: treatmentData.additionalInfo,
                        isMassage: realCellState[`isMassage${partIndex}`],
                        isPnf: realCellState[`isPnf${partIndex}`],
                        isEveryOtherDay: realCellState[`isEveryOtherDay${partIndex}`],
                    };
                }
            }

            ScheduleModals.openPatientInfoModal(element, cellState, (updateFn) => {
                // Wrap updateFn to map back to specific part if split
                if (partIndex) {
                    updateCellState(parentCell, (state) => {
                        // Create a temporary state object to capture updates
                        const tempState = { ...cellState };
                        updateFn(tempState);

                        // Map back to real state
                        state[`content${partIndex}`] = safeCopy(tempState.content);
                        state[`isMassage${partIndex}`] = safeCopy(tempState.isMassage);
                        state[`isPnf${partIndex}`] = safeCopy(tempState.isPnf);
                        state[`isEveryOtherDay${partIndex}`] = safeCopy(tempState.isEveryOtherDay);

                        if (!state[`treatmentData${partIndex}`]) state[`treatmentData${partIndex}`] = {};
                        state[`treatmentData${partIndex}`].startDate = safeCopy(tempState.treatmentStartDate);
                        state[`treatmentData${partIndex}`].extensionDays = safeCopy(tempState.treatmentExtensionDays);
                        state[`treatmentData${partIndex}`].endDate = safeCopy(tempState.treatmentEndDate);
                        state[`treatmentData${partIndex}`].additionalInfo = safeCopy(tempState.additionalInfo);
                    });
                } else {
                    updateCellState(parentCell, updateFn);
                }
            });
        },

        showHistoryModal(cell) {
            const time = cell.dataset.time;
            const employeeIndex = cell.dataset.employeeIndex;
            const cellState = ScheduleData.getCellState(time, employeeIndex);

            ScheduleModals.showHistoryModal(cell, cellState, (updateFn) => {
                updateCellState(cell, updateFn);
            });
        },

        openEmployeeSelectionModal(cell) {
            ScheduleModals.openEmployeeSelectionModal(cell);
        },

        toggleSpecialStyle(cell, dataAttribute) {
            updateCellState(cell, (state) => {
                if (state.isSplit) {
                    state[`${dataAttribute}1`] = !state[`${dataAttribute}1`];
                    state[`${dataAttribute}2`] = !state[`${dataAttribute}2`];
                } else {
                    state[dataAttribute] = !state[dataAttribute];
                }
                window.showToast('Zmieniono styl');
            });
        },

        mergeSplitCell(cell) {
            const time = cell.dataset.time;
            const employeeIndex = cell.dataset.employeeIndex;
            const cellState = ScheduleData.getCellState(time, employeeIndex);

            if (!cellState || !cellState.isSplit) {
                window.showToast('Ta komórka nie jest podzielona.', 3000);
                return;
            }

            const content1 = cellState.content1 || '';
            const content2 = cellState.content2 || '';

            if (content1.trim() !== '' && content2.trim() !== '') {
                window.showToast('Jedna z części komórki musi być pusta, aby je scalić.', 3000);
                return;
            }

            const mergedContent = content1.trim() === '' ? content2 : content1;
            const activePart = content1.trim() === '' ? 2 : 1;

            updateCellState(cell, (state) => {
                // Copy flags
                state.isMassage = safeCopy(state[`isMassage${activePart}`]);
                state.isPnf = safeCopy(state[`isPnf${activePart}`]);
                state.isEveryOtherDay = safeCopy(state[`isEveryOtherDay${activePart}`]);

                // Copy treatment data
                const treatmentData = state[`treatmentData${activePart}`] || {};
                state.treatmentStartDate = safeCopy(treatmentData.startDate);
                state.treatmentExtensionDays = safeCopy(treatmentData.extensionDays);
                state.treatmentEndDate = safeCopy(treatmentData.endDate);
                state.additionalInfo = safeCopy(treatmentData.additionalInfo);

                // Clear split state
                state.isSplit = null;
                state.content1 = null;
                state.content2 = null;
                state.isMassage1 = null;
                state.isMassage2 = null;
                state.isPnf1 = null;
                state.isPnf2 = null;
                state.isEveryOtherDay1 = null;
                state.isEveryOtherDay2 = null;
                state.treatmentData1 = null;
                state.treatmentData2 = null;

                state.content = mergedContent;
                window.showToast('Scalono komórkę.');
            });
        },

        undoLastAction() {
            ScheduleData.undo();
        },

        clearCell(cell) {
            const clearContent = (state) => {
                const contentKeys = [
                    'content',
                    'content1',
                    'content2',
                    'isSplit',
                    'isBreak',
                    'isMassage',
                    'isPnf',
                    'isEveryOtherDay',
                    'treatmentStartDate',
                    'treatmentExtensionDays',
                    'treatmentEndDate',
                    'additionalInfo',
                    'treatmentData1',
                    'treatmentData2',
                    'isMassage1',
                    'isMassage2',
                    'isPnf1',
                    'isPnf2',
                ];
                for (const key of contentKeys) {
                    if (Object.prototype.hasOwnProperty.call(state, key)) {
                        state[key] = null;
                    }
                }
                window.showToast('Wyczyszczono komórkę');
            };
            updateCellState(cell, clearContent);
        },
    };

    const handleUndoClick = () => {
        ScheduleData.undo();
    };

    const init = async () => {
        loadingOverlay = document.getElementById('loadingOverlay');
        undoButton = document.getElementById('undoButton');

        if (undoButton) {
            undoButton.removeEventListener('click', handleUndoClick); // Ensure no duplicates
            undoButton.addEventListener('click', handleUndoClick);
        }

        if (loadingOverlay) loadingOverlay.style.display = 'flex';
        try {
            await EmployeeManager.load();

            // Initialize Data Module
            ScheduleData.init(render, undoButton);

            // Initialize UI Module
            ScheduleUI.initialize(ScheduleData.getAppState()); // Pass raw state for rendering

            // Initialize Events Module
            ScheduleEvents.initialize({
                appState: ScheduleData.getAppState(),
                undoManager: {
                    pushState: () => {
                        if (ScheduleData.pushCurrentState) {
                            ScheduleData.pushCurrentState();
                        }
                    },
                },
                ui: ScheduleUI,
                updateCellState: updateCellState,
                updateMultipleCells: ScheduleData.updateMultipleCells,
                renderAndSave: renderAndSave,
                getCurrentTableState: ScheduleData.getCurrentTableState,
                exitEditMode: mainController.exitEditMode.bind(mainController),
                enterEditMode: mainController.enterEditMode.bind(mainController),
                getCurrentTableStateForCell: mainController.getCurrentTableStateForCell.bind(mainController),
                openPatientInfoModal: mainController.openPatientInfoModal.bind(mainController),
                showHistoryModal: mainController.showHistoryModal.bind(mainController),
                openEmployeeSelectionModal: mainController.openEmployeeSelectionModal.bind(mainController),
                toggleSpecialStyle: mainController.toggleSpecialStyle.bind(mainController),
                mergeSplitCell: mainController.mergeSplitCell.bind(mainController),
                undoLastAction: mainController.undoLastAction.bind(mainController),
                clearCell: mainController.clearCell.bind(mainController),
            });

            auth.onAuthStateChanged((user) => {
                if (user) {
                    ScheduleData.setCurrentUserId(user.uid);
                } else {
                    ScheduleData.setCurrentUserId(null);
                }
                ScheduleData.listenForScheduleChanges();
            });
        } catch (error) {
            console.error('Błąd inicjalizacji strony harmonogramu:', error);
            window.showToast('Wystąpił krytyczny błąd inicjalizacji. Odśwież stronę.', 5000);
        } finally {
            if (loadingOverlay) hideLoadingOverlay(loadingOverlay);
        }
    };

    const destroy = () => {
        if (undoButton) {
            undoButton.removeEventListener('click', handleUndoClick);
        }
        ScheduleEvents.destroy();
        ScheduleData.destroy();
        ScheduleUI.destroy();
        console.log('Schedule module destroyed');
    };

    return {
        init,
        destroy,
    };
})();

// Backward compatibility - removed as part of refactoring
// window.Schedule = Schedule;
