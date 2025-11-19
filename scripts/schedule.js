// scripts/schedule.js
import { auth } from './firebase-config.js';
import { AppConfig, capitalizeFirstLetter, hideLoadingOverlay } from './common.js';
import { EmployeeManager } from './employee-manager.js';
import { ScheduleUI } from './schedule-ui.js';
import { ScheduleEvents } from './schedule-events.js';
import { ScheduleData } from './schedule-data.js';
import { ScheduleModals } from './schedule-modals.js';

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
        processExitEditMode(element, newText) {
            element.setAttribute('contenteditable', 'false');
            const parentCell = element.closest('td');
            if (!parentCell) return;
            const employeeIndex = parentCell.dataset.employeeIndex;
            const time = parentCell.dataset.time;
            const duplicate = this.findDuplicateEntry(newText, time, employeeIndex);

            const updateSchedule = (isMove = false) => {
                ScheduleData.updateCellState(time, employeeIndex, (cellState) => {
                    // --- History Management is handled inside ScheduleData now ---

                    if (isMove && duplicate) {
                        // Przenieś cały stan z duplikatu do bieżącej komórki
                        // Musimy pobrać stan duplikatu
                        const oldCellState = ScheduleData.getCellState(duplicate.time, duplicate.employeeIndex);

                        // Kopiuj stan starej komórki do nowej (nadpisując cellState)
                        Object.assign(cellState, oldCellState);

                        // Wyczyść starą komórkę (musimy to zrobić w oddzielnej operacji updateCellState dla starej komórki)
                        // Ale ScheduleData.updateCellState obsługuje jedną komórkę na raz.
                        // Rozwiązanie: Zróbmy to "na piechotę" tutaj, modyfikując appState bezpośrednio?
                        // Nie, to łamie enkapsulację.
                        // Powinniśmy wywołać updateCellState dla starej komórki.
                        // Ale jesteśmy wewnątrz callbacka dla nowej komórki.
                        // HACK: ScheduleData.updateCellState jest synchroniczne w zmianie stanu (ale asynchroniczne w zapisie).
                        // Możemy wywołać updateCellState dla starej komórki PO zakończeniu tego callbacka?
                        // Albo po prostu tutaj, jeśli ScheduleData na to pozwala.
                        // Lepiej: zróbmy to po updateSchedule.
                    }

                    if (newText.includes('/')) {
                        const parts = newText.split('/', 2);
                        cellState.isSplit = true;
                        cellState.content1 = parts[0];
                        cellState.content2 = parts[1];
                    } else if (cellState.isSplit) {
                        const isFirstDiv = element === parentCell.querySelector('div:first-child');
                        if (isFirstDiv) {
                            cellState.content1 = newText;
                        } else {
                            cellState.content2 = newText;
                        }
                        if (!cellState.content1 && !cellState.content2) {
                            delete cellState.isSplit;
                        }
                    } else {
                        const oldContent = cellState.content || '';
                        if (oldContent.trim().toLowerCase() !== newText.trim().toLowerCase() && newText.trim() !== '') {
                            // Content has changed, so reset the date and related info
                            const today = new Date();
                            const year = today.getFullYear();
                            const month = String(today.getMonth() + 1).padStart(2, '0');
                            const day = String(today.getDate()).padStart(2, '0');
                            cellState.treatmentStartDate = `${year}-${month}-${day}`;
                            cellState.additionalInfo = null;
                            cellState.treatmentExtensionDays = 0;
                            cellState.treatmentEndDate = null;
                        }
                        cellState.content = newText;
                    }
                    // Jeśli pacjent nie istnieje, komórka nie ma jeszcze daty i nie jest to operacja przeniesienia, ustaw datę
                    if (!cellState.treatmentStartDate && !isMove) {
                        const today = new Date();
                        const year = today.getFullYear();
                        const month = String(today.getMonth() + 1).padStart(2, '0');
                        const day = String(today.getDate()).padStart(2, '0');
                        cellState.treatmentStartDate = `${year}-${month}-${day}`;
                    }
                });

                if (isMove && duplicate) {
                    // Wyczyść starą komórkę
                    ScheduleData.updateCellState(duplicate.time, duplicate.employeeIndex, (state) => {
                        // Clear all properties
                        for (const key in state) delete state[key];
                    });
                }
            };

            if (duplicate) {
                ScheduleModals.showDuplicateConfirmationDialog(duplicate, () => updateSchedule(true), () => updateSchedule(false), () => { ScheduleUI.render(); });
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
                ScheduleModals.showNumericConfirmationDialog(newText,
                    () => { this.processExitEditMode(element, newText); },
                    () => {
                        element.setAttribute('contenteditable', 'false');
                        ScheduleUI.render();
                    }
                );
                return;
            }

            this.processExitEditMode(element, newText);
        },

        enterEditMode(element, clearContent = false, initialChar = '') {
            if (!element || element.classList.contains('break-cell') || element.getAttribute('contenteditable') === 'true') return;
            if (element.tagName === 'TD' && element.classList.contains('split-cell')) {
                const firstDiv = element.querySelector('div');
                if (firstDiv) {
                    this.enterEditMode(firstDiv, clearContent, initialChar);
                }
                return;
            }
            const isEditableTarget = (element.tagName === 'TD' && !element.classList.contains('split-cell')) || (element.tagName === 'DIV' && element.parentNode.classList.contains('split-cell'));
            if (!isEditableTarget) return;
            const originalValue = ScheduleUI.getElementText(element);
            element.dataset.originalValue = originalValue;
            element.innerHTML = ScheduleUI.getElementText(element);
            element.setAttribute('contenteditable', 'true');
            element.classList.remove('massage-text', 'pnf-text');
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
                    if (cellData.content?.toLowerCase() === lowerCaseText ||
                        cellData.content1?.toLowerCase() === lowerCaseText ||
                        cellData.content2?.toLowerCase() === lowerCaseText) {
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
                    isPnf2: part2?.dataset.isPnf === 'true'
                };
            }
            return {
                content: ScheduleUI.getElementText(cell),
                isMassage: cell.dataset.isMassage === 'true',
                isPnf: cell.dataset.isPnf === 'true'
            };
        },

        openPatientInfoModal(element) {
            const parentCell = element.closest('td');
            const time = parentCell.dataset.time;
            const employeeIndex = parentCell.dataset.employeeIndex;
            const cellState = ScheduleData.getCellState(time, employeeIndex) || {};

            ScheduleModals.openPatientInfoModal(element, cellState, (updateFn) => {
                updateCellState(parentCell, updateFn);
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
            updateCellState(cell, state => {
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

            updateCellState(cell, state => {
                delete state.isSplit;
                delete state.content1;
                delete state.content2;
                state.content = mergedContent;
                window.showToast('Scalono komórkę.');
            });
        },

        undoLastAction() {
            ScheduleData.undo();
        },

        clearCell(cell) {
            const clearContent = state => {
                const contentKeys = ['content', 'content1', 'content2', 'isSplit', 'isMassage', 'isPnf', 'isEveryOtherDay', 'treatmentStartDate', 'treatmentExtensionDays', 'treatmentEndDate', 'additionalInfo', 'treatmentData1', 'treatmentData2', 'isMassage1', 'isMassage2', 'isPnf1', 'isPnf2'];
                for (const key of contentKeys) {
                    if (state.hasOwnProperty(key)) {
                        state[key] = null;
                    }
                }
                window.showToast('Wyczyszczono komórkę');
            };
            updateCellState(cell, clearContent);
        }
    };

    const init = async () => {
        loadingOverlay = document.getElementById('loadingOverlay');
        undoButton = document.getElementById('undoButton');

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
                    }
                },
                ui: ScheduleUI,
                updateCellState: updateCellState,
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
                clearCell: mainController.clearCell.bind(mainController)
            });


            auth.onAuthStateChanged(user => {
                if (user) {
                    ScheduleData.setCurrentUserId(user.uid);
                } else {
                    ScheduleData.setCurrentUserId(null);
                }
                ScheduleData.listenForScheduleChanges();
            });

        } catch (error) {
            console.error("Błąd inicjalizacji strony harmonogramu:", error);
            window.showToast("Wystąpił krytyczny błąd inicjalizacji. Odśwież stronę.", 5000);
        } finally {
            if (loadingOverlay) hideLoadingOverlay(loadingOverlay);
        }
    };

    const destroy = () => {
        ScheduleEvents.destroy();
        ScheduleData.destroy();
        console.log("Schedule module destroyed");
    };

    return {
        init,
        destroy
    };
})();

// Backward compatibility
window.Schedule = Schedule;
