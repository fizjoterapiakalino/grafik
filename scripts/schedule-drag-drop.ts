// scripts/schedule-drag-drop.ts
// Moduł obsługi Drag & Drop dla harmonogramu

import { safeCopy, safeBool } from './utils.js';
import type { CellState } from './types/index.js';

/**
 * Stan aplikacji z danymi komórek
 */
interface AppState {
    scheduleCells: Record<string, Record<string, CellState>>;
}

/**
 * Zależności wymagane przez moduł Drag & Drop
 */
export interface DragDropDependencies {
    appState: AppState;
    getCurrentTableStateForCell(cell: HTMLElement): unknown;
    updateMultipleCells(updates: { time: string; employeeIndex: string; updateFn: (state: CellState) => void }[]): void;
}

/**
 * API modułu Drag & Drop
 */
export interface DragDropAPI {
    initialize(deps: DragDropDependencies): void;
    destroy(): void;
    handleDragStart(event: DragEvent): void;
    handleDragOver(event: DragEvent): void;
    handleDrop(event: DragEvent): void;
    handleDragLeave(event: DragEvent): void;
    handleDragEnd(): void;
    getDraggedCell(): HTMLElement | null;
}

/**
 * Klucze zawartości komórki używane przy kopiowaniu/czyszczeniu
 */
const CONTENT_KEYS = [
    'content', 'content1', 'content2', 'isSplit', 'isMassage', 'isPnf', 'isEveryOtherDay',
    'treatmentStartDate', 'treatmentExtensionDays', 'treatmentEndDate', 'additionalInfo',
    'treatmentData1', 'treatmentData2', 'isMassage1', 'isMassage2', 'isPnf1', 'isPnf2'
] as const;

/**
 * Moduł Drag & Drop dla harmonogramu
 */
export const ScheduleDragDrop: DragDropAPI = (() => {
    let _dependencies: DragDropDependencies;
    let draggedCell: HTMLElement | null = null;

    /**
     * Rozpoczęcie przeciągania komórki
     */
    const handleDragStart = (event: DragEvent): void => {
        const target = (event.target as HTMLElement).closest('td.editable-cell') as HTMLTableCellElement | null;

        if (target && !target.classList.contains('break-cell') && event.dataTransfer) {
            draggedCell = target;
            event.dataTransfer.setData(
                'application/json',
                JSON.stringify(_dependencies.getCurrentTableStateForCell(target))
            );
            event.dataTransfer.effectAllowed = 'move';
            draggedCell.classList.add('is-dragging');
        } else {
            event.preventDefault();
        }
    };

    /**
     * Przeciąganie nad komórką docelową
     */
    const handleDragOver = (event: DragEvent): void => {
        event.preventDefault();
        const dropTargetCell = (event.target as HTMLElement).closest('td.editable-cell') as HTMLTableCellElement | null;

        // Usuń poprzednie podświetlenia
        document.querySelectorAll('.drag-over-target').forEach((el) => el.classList.remove('drag-over-target'));

        if (dropTargetCell && !dropTargetCell.classList.contains('break-cell') && draggedCell !== dropTargetCell && event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
            dropTargetCell.classList.add('drag-over-target');
        } else if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'none';
        }
    };

    /**
     * Opuszczenie obszaru przeciągania
     */
    const handleDragLeave = (event: DragEvent): void => {
        const target = event.target as HTMLElement;
        target.classList.remove('drag-over-target');
    };

    /**
     * Upuszczenie komórki na cel
     */
    const handleDrop = (event: DragEvent): void => {
        event.preventDefault();
        const dropTargetCell = (event.target as HTMLElement).closest('td.editable-cell') as HTMLTableCellElement | null;

        // Usuń podświetlenia
        document.querySelectorAll('.drag-over-target').forEach((el) => el.classList.remove('drag-over-target'));

        if (dropTargetCell && !dropTargetCell.classList.contains('break-cell') && draggedCell && draggedCell !== dropTargetCell) {
            const sourceTime = draggedCell.dataset.time!;
            const sourceIndex = draggedCell.dataset.employeeIndex!;
            const targetTime = dropTargetCell.dataset.time!;
            const targetIndex = dropTargetCell.dataset.employeeIndex!;

            // Sprawdź czy upuszczono na część podzielonej komórki
            let targetPart: number | null = null;
            const eventTarget = event.target as HTMLElement;
            if (eventTarget.tagName === 'DIV' && eventTarget.parentElement?.classList.contains('split-cell-wrapper')) {
                targetPart = eventTarget === eventTarget.parentElement.children[0] ? 1 : 2;
            }

            const sourceCellState = _dependencies.appState.scheduleCells[sourceTime]?.[sourceIndex] || {};

            // Sprawdź czy źródło ma zawartość
            const sourceContentString = sourceCellState.isSplit
                ? `${sourceCellState.content1 || ''}/${sourceCellState.content2 || ''}`
                : sourceCellState.content;

            if (!sourceContentString || sourceContentString.trim() === '') {
                return;
            }

            const updates = [
                {
                    time: targetTime,
                    employeeIndex: targetIndex,
                    updateFn: (targetState: CellState) => {
                        if (targetPart && targetState.isSplit) {
                            // Upuszczenie na część podzielonej komórki
                            let contentToMove = sourceCellState.content;
                            const isMassage = sourceCellState.isMassage;
                            const isPnf = sourceCellState.isPnf;
                            const isEveryOtherDay = sourceCellState.isEveryOtherDay;
                            const treatmentData = {
                                startDate: sourceCellState.treatmentStartDate,
                                extensionDays: sourceCellState.treatmentExtensionDays,
                                endDate: sourceCellState.treatmentEndDate,
                                additionalInfo: sourceCellState.additionalInfo,
                            };

                            if (sourceCellState.isSplit) {
                                contentToMove = sourceCellState.content1;
                            }

                            targetState[`content${targetPart}`] = safeCopy(contentToMove);
                            targetState[`isMassage${targetPart}`] = safeBool(isMassage);
                            targetState[`isPnf${targetPart}`] = safeBool(isPnf);
                            targetState[`isEveryOtherDay${targetPart}`] = safeBool(isEveryOtherDay);

                            targetState[`treatmentData${targetPart}`] = {
                                startDate: safeCopy(treatmentData.startDate),
                                extensionDays: safeCopy(treatmentData.extensionDays),
                                endDate: safeCopy(treatmentData.endDate),
                                additionalInfo: safeCopy(treatmentData.additionalInfo),
                            };

                            // Wyczyść pola dla niepodzielonej komórki
                            targetState.treatmentStartDate = null;
                            targetState.treatmentExtensionDays = null;
                            targetState.treatmentEndDate = null;
                            targetState.additionalInfo = null;
                            targetState.content = null;
                            targetState.isMassage = null;
                            targetState.isPnf = null;
                            targetState.isEveryOtherDay = null;
                        } else {
                            // Upuszczenie na zwykłą komórkę - przenieś wszystko
                            for (const key of CONTENT_KEYS) {
                                delete (targetState as Record<string, unknown>)[key];
                            }
                            for (const key of CONTENT_KEYS) {
                                if ((sourceCellState as Record<string, unknown>)[key] !== undefined) {
                                    (targetState as Record<string, unknown>)[key] = (sourceCellState as Record<string, unknown>)[key];
                                }
                            }
                        }
                    },
                },
                {
                    time: sourceTime,
                    employeeIndex: sourceIndex,
                    updateFn: (sourceState: CellState) => {
                        // Wyczyść źródłową komórkę
                        for (const key of CONTENT_KEYS) {
                            sourceState[key] = null;
                        }
                    },
                },
            ];

            _dependencies.updateMultipleCells(updates);
        }
    };

    /**
     * Zakończenie przeciągania
     */
    const handleDragEnd = (): void => {
        draggedCell?.classList.remove('is-dragging');
        draggedCell = null;
        document.querySelectorAll('.drag-over-target').forEach((el) => el.classList.remove('drag-over-target'));
    };

    /**
     * Pobierz aktualnie przeciąganą komórkę
     */
    const getDraggedCell = (): HTMLElement | null => draggedCell;

    /**
     * Inicjalizacja modułu
     */
    const initialize = (deps: DragDropDependencies): void => {
        _dependencies = deps;
    };

    /**
     * Zniszczenie modułu i reset stanu
     */
    const destroy = (): void => {
        draggedCell = null;
    };

    return {
        initialize,
        destroy,
        handleDragStart,
        handleDragOver,
        handleDrop,
        handleDragLeave,
        handleDragEnd,
        getDraggedCell,
    };
})();

// Backward compatibility
declare global {
    interface Window {
        ScheduleDragDrop: DragDropAPI;
    }
}

window.ScheduleDragDrop = ScheduleDragDrop;
