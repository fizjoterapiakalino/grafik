// scripts/schedule.ts
import { debugLog, AppConfig, capitalizeFirstLetter, hideLoadingOverlay } from './common.js';
import { auth as authRaw } from './firebase-config.js';
import { EmployeeManager } from './employee-manager.js';
import { ScheduleUI } from './schedule-ui.js';
import { ScheduleEvents } from './schedule-events.js';
import { ScheduleData } from './schedule-data.js';
import { ScheduleModals } from './schedule-modals.js';
import { UXEnhancements } from './ux-enhancements.js';
import { safeCopy } from './utils.js';
import {
    getTargetPart,
    getSourcePart,
    createTargetUpdateFn,
    createSourceClearFn,
    updateCellContent,
    initTreatmentData,
} from './schedule-helpers.js';
import type { FirebaseAuthWrapper, FirebaseUser } from './types/firebase';
import type { CellState, TreatmentData } from './types/index.js';

const auth = authRaw as unknown as FirebaseAuthWrapper;

interface DuplicateInfo {
    time: string;
    employeeIndex: string;
    cellData: CellState;
}

/**
 * Interfejs publicznego API Schedule
 */
interface ScheduleAPI {
    init(): Promise<void>;
    destroy(): void;
}

/**
 * Główny moduł kontrolera harmonogramu
 */
export const Schedule: ScheduleAPI = (() => {
    let loadingOverlay: HTMLElement | null = null;
    let undoButton: HTMLButtonElement | null = null;

    const render = (): void => {
        ScheduleUI.render();
        ScheduleUI.updatePatientCount();
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateCellState = (cell: HTMLElement | null, updateFn: (state: any) => void): void => {
        if (!cell) return;
        const cellData = cell as HTMLElement & { dataset: { time?: string; employeeIndex?: string } };
        const time = cellData.dataset.time;
        const employeeIndex = cellData.dataset.employeeIndex;
        if (time && employeeIndex) {
            ScheduleData.updateCellState(time, employeeIndex, updateFn);
        }
    };

    const mainController = {
        processExitEditMode(element: HTMLElement, newText: string): void {
            element.setAttribute('contenteditable', 'false');
            const parentCell = element.closest<HTMLElement>('[data-time]');
            if (!parentCell) return;

            const { employeeIndex = '', time = '' } = parentCell.dataset;
            const duplicate = this.findDuplicateEntry(newText, time, employeeIndex);
            const targetPart = getTargetPart(element);

            const updateSchedule = (isMove = false): void => {
                if (isMove && duplicate) {
                    const oldCellState = duplicate.cellData as any;
                    const sourcePart = getSourcePart(oldCellState, newText);

                    const updates = [
                        {
                            time: time,
                            employeeIndex: employeeIndex,
                            updateFn: createTargetUpdateFn(oldCellState, sourcePart, targetPart),
                        },
                        {
                            time: duplicate.time,
                            employeeIndex: duplicate.employeeIndex,
                            updateFn: createSourceClearFn(sourcePart),
                        },
                    ];

                    ScheduleData.updateMultipleCells(updates as any);
                } else {
                    ScheduleData.updateCellState(time, employeeIndex, (cellState) => {
                        updateCellContent(cellState, newText, targetPart, element, parentCell);
                        if (!isMove) initTreatmentData(cellState);
                    });
                }
            };

            if (duplicate) {
                ScheduleModals.showDuplicateConfirmationDialog(
                    duplicate,
                    () => updateSchedule(true),
                    () => updateSchedule(false),
                    () => ScheduleUI.render()
                );
            } else {
                updateSchedule(false);
            }
        },

        exitEditMode(element: HTMLElement): void {
            if (!element || element.getAttribute('contenteditable') !== 'true') return;
            const newText = capitalizeFirstLetter((element.textContent || '').trim());

            if (newText.length > 35) {
                (globalThis as any).showToast?.('Wprowadzony tekst jest za długi (maks. 35 znaków).', 3000);
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
                    }
                );
                return;
            }

            this.processExitEditMode(element, newText);
        },

        enterEditMode(element: HTMLElement, clearContent = false, initialChar = ''): void {
            if (
                !element ||
                element.classList.contains('break-cell') ||
                element.getAttribute('contenteditable') === 'true'
            )
                return;
            if (element.tagName === 'TD' && element.classList.contains('split-cell')) {
                const firstDiv = element.querySelector('div');
                if (firstDiv) {
                    this.enterEditMode(firstDiv as HTMLElement, clearContent, initialChar);
                }
                return;
            }
            const isEditableTarget =
                (element.tagName === 'TD' && !element.classList.contains('split-cell')) ||
                (element.tagName === 'DIV' &&
                    (element.parentElement?.classList.contains('split-cell') ||
                        element.parentElement?.classList.contains('split-cell-wrapper') ||
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
            const sel = globalThis.getSelection();
            range.selectNodeContents(element);
            range.collapse(false);
            sel?.removeAllRanges();
            sel?.addRange(range);
        },

        findDuplicateEntry(text: string, currentTime: string, currentEmployeeIndex: string): DuplicateInfo | null {
            if (!text) return null;
            const lowerCaseText = text.toLowerCase();
            const appState = ScheduleData.getAppState();

            for (const time in appState.scheduleCells) {
                const dayCells = appState.scheduleCells[time];
                for (const employeeIndex in dayCells) {
                    if (time === currentTime && employeeIndex === currentEmployeeIndex) continue;
                    const cellData = dayCells[employeeIndex];
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

        getCurrentTableStateForCell(cell: HTMLElement): Record<string, unknown> {
            if (cell.tagName === 'TH') {
                return { content: ScheduleUI.getElementText(cell) };
            }
            if (cell.classList.contains('break-cell')) {
                return { content: AppConfig.schedule.breakText, isBreak: true };
            }
            if (cell.classList.contains('split-cell')) {
                const part1 = cell.children[0] as HTMLElement | undefined;
                const part2 = cell.children[1] as HTMLElement | undefined;
                return {
                    content1: ScheduleUI.getElementText(part1 || null),
                    content2: ScheduleUI.getElementText(part2 || null),
                    isSplit: true,
                    isMassage1: part1?.dataset.isMassage === 'true',
                    isMassage2: part2?.dataset.isMassage === 'true',
                    isPnf1: part1?.dataset.isPnf === 'true',
                    isPnf2: part2?.dataset.isPnf === 'true',
                    isHydrotherapy1: part1?.dataset.isHydrotherapy === 'true',
                    isHydrotherapy2: part2?.dataset.isHydrotherapy === 'true',
                };
            }
            return {
                content: ScheduleUI.getElementText(cell),
                isMassage: cell.dataset.isMassage === 'true',
                isPnf: cell.dataset.isPnf === 'true',
                isHydrotherapy: cell.dataset.isHydrotherapy === 'true',
            };
        },

        openPatientInfoModal(element: HTMLElement): void {
            const parentCell = element.closest('td');
            if (!parentCell) return;
            const { time = '', employeeIndex = '' } = parentCell.dataset;
            const realCellState = ScheduleData.getCellState(time, employeeIndex) || ({} as CellState);

            let cellState: CellState = realCellState;
            let partIndex: number | null = null;

            if (realCellState.isSplit) {
                const wrapper = element.closest('.split-cell-wrapper');
                if (element.tagName === 'DIV' && element.parentElement?.classList.contains('split-cell-wrapper')) {
                    partIndex = element === element.parentElement.children[0] ? 1 : 2;
                } else if (wrapper) {
                    const div = element.closest('.split-cell-wrapper > div');
                    if (div && div.parentElement) {
                        partIndex = div === div.parentElement.children[0] ? 1 : 2;
                    }
                }

                if (partIndex) {
                    const treatmentData = (realCellState[`treatmentData${partIndex}`] as TreatmentData) || {};
                    cellState = {
                        ...realCellState,
                        content: realCellState[`content${partIndex}`] as string,
                        treatmentStartDate: treatmentData.startDate,
                        treatmentExtensionDays: treatmentData.extensionDays,
                        treatmentEndDate: treatmentData.endDate,
                        additionalInfo: treatmentData.additionalInfo,
                        isMassage: realCellState[`isMassage${partIndex}`] as boolean,
                        isPnf: realCellState[`isPnf${partIndex}`] as boolean,
                        isEveryOtherDay: realCellState[`isEveryOtherDay${partIndex}`] as boolean,
                        isHydrotherapy: realCellState[`isHydrotherapy${partIndex}`] as boolean,
                    };
                }
            }

            ScheduleModals.openPatientInfoModal(element, cellState as any, (updateFn) => {
                if (partIndex) {
                    updateCellState(parentCell, (state) => {
                        const tempState = { ...cellState };
                        updateFn(tempState as any);

                        state[`content${partIndex}`] = safeCopy(tempState.content);
                        state[`isMassage${partIndex}`] = safeCopy(tempState.isMassage);
                        state[`isPnf${partIndex}`] = safeCopy(tempState.isPnf);
                        state[`isEveryOtherDay${partIndex}`] = safeCopy(tempState.isEveryOtherDay);
                        state[`isHydrotherapy${partIndex}`] = safeCopy(tempState.isHydrotherapy);

                        const targetTD = (state[`treatmentData${partIndex}`] || {}) as TreatmentData;
                        targetTD.startDate = safeCopy(tempState.treatmentStartDate);
                        targetTD.extensionDays = safeCopy(tempState.treatmentExtensionDays);
                        targetTD.endDate = safeCopy(tempState.treatmentEndDate);
                        targetTD.additionalInfo = safeCopy(tempState.additionalInfo);
                        state[`treatmentData${partIndex}`] = targetTD;
                    });
                } else {
                    updateCellState(parentCell, updateFn);
                }
            });
        },

        showHistoryModal(cell: HTMLElement): void {
            const { time = '', employeeIndex = '' } = cell.dataset;
            const cellState = ScheduleData.getCellState(time, employeeIndex);

            ScheduleModals.showHistoryModal(cell, (cellState || {}) as any, (updateFn) => {
                updateCellState(cell, updateFn);
            });
        },

        openEmployeeSelectionModal(_cell: HTMLElement): void {
            ScheduleModals.openEmployeeSelectionModal();
        },

        toggleSpecialStyle(cell: HTMLElement, dataAttribute: string): void {
            updateCellState(cell, (state) => {
                if (state.isSplit) {
                    state[`${dataAttribute}1`] = !state[`${dataAttribute}1`];
                    state[`${dataAttribute}2`] = !state[`${dataAttribute}2`];
                } else {
                    state[dataAttribute] = !state[dataAttribute];
                }
                (globalThis as any).showToast?.('Zmieniono styl');
            });
        },

        mergeSplitCell(cell: HTMLElement): void {
            const { time = '', employeeIndex = '' } = cell.dataset;
            const cellState = ScheduleData.getCellState(time, employeeIndex);

            if (!cellState || !cellState.isSplit) {
                (globalThis as any).showToast?.('Ta komórka nie jest podzielona.', 3000);
                return;
            }

            const content1 = (cellState.content1 as string) || '';
            const content2 = (cellState.content2 as string) || '';

            if (content1.trim() !== '' && content2.trim() !== '') {
                (globalThis as any).showToast?.('Jedna z części komórki musi być pusta, aby je scalić.', 3000);
                return;
            }

            const mergedContent = content1.trim() === '' ? content2 : content1;
            const activePart = content1.trim() === '' ? 2 : 1;

            updateCellState(cell, (state) => {
                state.isMassage = safeCopy(state[`isMassage${activePart}`]);
                state.isPnf = safeCopy(state[`isPnf${activePart}`]);
                state.isEveryOtherDay = safeCopy(state[`isEveryOtherDay${activePart}`]);
                state.isHydrotherapy = safeCopy(state[`isHydrotherapy${activePart}`]);

                const treatmentData = (state[`treatmentData${activePart}`] as TreatmentData) || {};
                state.treatmentStartDate = safeCopy(treatmentData.startDate);
                state.treatmentExtensionDays = safeCopy(treatmentData.extensionDays);
                state.treatmentEndDate = safeCopy(treatmentData.endDate);
                state.additionalInfo = safeCopy(treatmentData.additionalInfo);

                state.isSplit = null;
                state.content1 = null;
                state.content2 = null;
                state.isMassage1 = null;
                state.isMassage2 = null;
                state.isPnf1 = null;
                state.isPnf2 = null;
                state.isEveryOtherDay1 = null;
                state.isEveryOtherDay2 = null;
                state.isHydrotherapy1 = null;
                state.isHydrotherapy2 = null;
                state.isHydrotherapy = null;
                state.treatmentData1 = null;
                state.treatmentData2 = null;

                state.content = mergedContent;
                (globalThis as any).showToast?.('Scalono komórkę.');
            });
        },

        undoLastAction(): void {
            ScheduleData.undo();
        },

        clearCell(cell: HTMLElement): void {
            const clearContent = (state: CellState): void => {
                const contentKeys = [
                    'content', 'content1', 'content2', 'isSplit', 'isBreak',
                    'isMassage', 'isPnf', 'isEveryOtherDay',
                    'treatmentStartDate', 'treatmentExtensionDays', 'treatmentEndDate', 'additionalInfo',
                    'treatmentData1', 'treatmentData2', 'isMassage1', 'isMassage2', 'isPnf1', 'isPnf2',
                    'isHydrotherapy', 'isHydrotherapy1', 'isHydrotherapy2',
                ];
                for (const key of contentKeys) {
                    if (Object.prototype.hasOwnProperty.call(state, key)) {
                        state[key] = null;
                    }
                }
                (globalThis as any).showToast?.('Wyczyszczono komórkę');
            };
            updateCellState(cell, clearContent);
        },
    };

    const handleUndoClick = (): void => {
        ScheduleData.undo();
    };

    const init = async (): Promise<void> => {
        loadingOverlay = document.getElementById('loadingOverlay');
        undoButton = document.getElementById('undoButton') as HTMLButtonElement | null;

        if (undoButton) {
            undoButton.removeEventListener('click', handleUndoClick);
            undoButton.addEventListener('click', handleUndoClick);
        }

        if (loadingOverlay) loadingOverlay.style.display = 'flex';
        try {
            await EmployeeManager.load();

            ScheduleData.init(render, undoButton);

            ScheduleUI.initialize(ScheduleData.getAppState() as any);

            ScheduleEvents.initialize({
                appState: ScheduleData.getAppState() as any,
                ui: ScheduleUI,
                updateCellState: updateCellState as any,
                updateMultipleCells: ScheduleData.updateMultipleCells as any,
                getCurrentTableStateForCell: mainController.getCurrentTableStateForCell.bind(mainController),
                exitEditMode: mainController.exitEditMode.bind(mainController),
                enterEditMode: mainController.enterEditMode.bind(mainController),
                openPatientInfoModal: mainController.openPatientInfoModal.bind(mainController),
                showHistoryModal: mainController.showHistoryModal.bind(mainController),
                toggleSpecialStyle: mainController.toggleSpecialStyle.bind(mainController),
                mergeSplitCell: mainController.mergeSplitCell.bind(mainController),
                undoLastAction: mainController.undoLastAction.bind(mainController),
                clearCell: mainController.clearCell.bind(mainController),
            });

            auth.onAuthStateChanged((user: FirebaseUser | null) => {
                if (user) {
                    ScheduleData.setCurrentUserId(user.uid);
                } else {
                    ScheduleData.setCurrentUserId(null);
                }
                ScheduleData.listenForScheduleChanges();
            });
        } catch (error) {
            console.error('Błąd inicjalizacji strony harmonogramu:', error);
            (globalThis as any).showToast?.('Wystąpił krytyczny błąd inicjalizacji. Odśwież stronę.', 5000);
        } finally {
            if (loadingOverlay) hideLoadingOverlay(loadingOverlay);
            UXEnhancements.initScheduleEnhancements();
        }
    };

    const destroy = (): void => {
        if (undoButton) {
            undoButton.removeEventListener('click', handleUndoClick);
        }
        ScheduleEvents.destroy();
        ScheduleData.destroy();
        ScheduleUI.destroy();
        debugLog('Schedule module destroyed');
    };

    return {
        init,
        destroy,
    };
})();
