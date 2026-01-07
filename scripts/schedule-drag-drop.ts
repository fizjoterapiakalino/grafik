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
    let draggedSplitPart: number | null = null; // 1 = górna część, 2 = dolna część, null = cała komórka

    /**
     * Rozpoczęcie przeciągania komórki lub części podzielonej komórki
     */
    const handleDragStart = (event: DragEvent): void => {
        const target = event.target as HTMLElement;

        // Sprawdź czy przeciągamy część podzielonej komórki
        if (target.hasAttribute('data-split-part')) {
            const parentCell = target.closest('td.editable-cell') as HTMLTableCellElement | null;
            if (parentCell && !parentCell.classList.contains('break-cell') && event.dataTransfer) {
                draggedCell = parentCell;
                draggedSplitPart = parseInt(target.getAttribute('data-split-part')!, 10);
                event.dataTransfer.setData(
                    'application/json',
                    JSON.stringify(Object.assign(
                        {},
                        _dependencies.getCurrentTableStateForCell(parentCell),
                        { draggedPart: draggedSplitPart }
                    ))
                );
                event.dataTransfer.effectAllowed = 'move';
                target.classList.add('is-dragging');
                parentCell.classList.add('has-dragging-part');
            } else {
                event.preventDefault();
            }
            return;
        }

        // Standardowe przeciąganie całej komórki
        const cellTarget = target.closest('td.editable-cell') as HTMLTableCellElement | null;

        if (cellTarget && !cellTarget.classList.contains('break-cell') && event.dataTransfer) {
            draggedCell = cellTarget;
            draggedSplitPart = null;
            event.dataTransfer.setData(
                'application/json',
                JSON.stringify(_dependencies.getCurrentTableStateForCell(cellTarget))
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
        const eventTarget = event.target as HTMLElement;
        const dropTargetCell = eventTarget.closest('td.editable-cell') as HTMLTableCellElement | null;

        // Usuń poprzednie podświetlenia
        document.querySelectorAll('.drag-over-target').forEach((el) => el.classList.remove('drag-over-target'));

        if (dropTargetCell && !dropTargetCell.classList.contains('break-cell') && draggedCell !== dropTargetCell && event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';

            // Sprawdź czy przeciągamy nad częścią split komórki
            if (eventTarget.hasAttribute('data-split-part') ||
                (eventTarget.tagName === 'DIV' && eventTarget.parentElement?.classList.contains('split-cell-wrapper'))) {
                // Podświetl tylko część split
                eventTarget.classList.add('drag-over-target');
            } else if (eventTarget.closest('.split-cell-wrapper')) {
                // Jeśli jesteśmy wewnątrz split-cell-wrapper (np. na span), znajdź odpowiedni div
                const splitDiv = eventTarget.closest('.split-cell-wrapper > div');
                if (splitDiv) {
                    splitDiv.classList.add('drag-over-target');
                } else {
                    dropTargetCell.classList.add('drag-over-target');
                }
            } else {
                // Podświetl całą komórkę
                dropTargetCell.classList.add('drag-over-target');
            }
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

            // Sprawdź czy kliknięto bezpośrednio na div z data-split-part
            if (eventTarget.hasAttribute('data-split-part')) {
                targetPart = parseInt(eventTarget.getAttribute('data-split-part')!, 10);
            } else {
                // Sprawdź czy kliknięto na element wewnątrz split-cell-wrapper (np. span)
                const splitDiv = eventTarget.closest('.split-cell-wrapper > div') as HTMLElement | null;
                if (splitDiv && splitDiv.hasAttribute('data-split-part')) {
                    targetPart = parseInt(splitDiv.getAttribute('data-split-part')!, 10);
                } else if (splitDiv) {
                    // Fallback - określ część na podstawie pozycji w wrapper
                    const wrapper = splitDiv.parentElement;
                    if (wrapper) {
                        targetPart = splitDiv === wrapper.children[0] ? 1 : 2;
                    }
                }
            }

            const sourceCellState = _dependencies.appState.scheduleCells[sourceTime]?.[sourceIndex] || {};
            const targetCellState = _dependencies.appState.scheduleCells[targetTime]?.[targetIndex] || {};
            const sourcePart = draggedSplitPart; // Która część jest przeciągana (null = cała komórka)

            // === WARUNEK 2: Blokada przenoszenia całej komórki na podzieloną bez wybrania części ===
            if (!sourcePart && targetCellState.isSplit && !targetPart) {
                // Próba upuszczenia całej komórki na podzieloną bez wskazania części
                window.showToast?.('Wybierz konkretną część podzielonej komórki', 3000);
                return;
            }

            // === WARUNEK 2b: Blokada nadpisywania części podzielonej komórki która już ma zawartość ===
            if (targetPart && targetCellState.isSplit) {
                const targetPartContent = targetCellState[`content${targetPart}`];
                const targetPartHasContent = targetPartContent && String(targetPartContent).trim() !== '';
                if (targetPartHasContent) {
                    window.showToast?.('Ta część komórki jest już zajęta', 3000);
                    return;
                }
            }

            // Wyciągnij dane ze źródła (z uwzględnieniem części split)
            let contentToMove: string | null | undefined;
            let isMassageToMove: boolean | null | undefined;
            let isPnfToMove: boolean | null | undefined;
            let isEveryOtherDayToMove: boolean | null | undefined;
            let treatmentDataToMove: {
                startDate?: string | null;
                extensionDays?: number | null;
                endDate?: string | null;
                additionalInfo?: string | null;
            };

            if (sourcePart && sourceCellState.isSplit) {
                // Źródło: część podzielonej komórki
                contentToMove = sourceCellState[`content${sourcePart}`] as string | null | undefined;
                isMassageToMove = sourceCellState[`isMassage${sourcePart}`] as boolean | null | undefined;
                isPnfToMove = sourceCellState[`isPnf${sourcePart}`] as boolean | null | undefined;
                isEveryOtherDayToMove = sourceCellState[`isEveryOtherDay${sourcePart}`] as boolean | null | undefined;
                const srcTreatment = sourceCellState[`treatmentData${sourcePart}`] as { startDate?: string | null; extensionDays?: number | null; endDate?: string | null; additionalInfo?: string | null } | null | undefined;
                treatmentDataToMove = srcTreatment || {};
            } else {
                // Źródło: cała komórka (normalna lub podzielona - przenosimy wszystko)
                contentToMove = sourceCellState.content;
                isMassageToMove = sourceCellState.isMassage;
                isPnfToMove = sourceCellState.isPnf;
                isEveryOtherDayToMove = sourceCellState.isEveryOtherDay;
                treatmentDataToMove = {
                    startDate: sourceCellState.treatmentStartDate,
                    extensionDays: sourceCellState.treatmentExtensionDays,
                    endDate: sourceCellState.treatmentEndDate,
                    additionalInfo: sourceCellState.additionalInfo,
                };
            }

            // Sprawdź czy jest co przenosić
            if (!contentToMove || contentToMove.trim() === '') {
                // Jeśli przeciągamy całą split komórkę, sprawdź obie części
                if (!sourcePart && sourceCellState.isSplit) {
                    const hasContent1 = sourceCellState.content1 && String(sourceCellState.content1).trim() !== '';
                    const hasContent2 = sourceCellState.content2 && String(sourceCellState.content2).trim() !== '';
                    if (!hasContent1 && !hasContent2) {
                        return;
                    }
                } else {
                    return;
                }
            }

            // === WARUNEK 1: Sprawdź czy cel ma już zawartość - automatyczny podział ===
            const targetHasContent = targetCellState.isSplit
                ? (targetCellState.content1 && String(targetCellState.content1).trim() !== '') ||
                (targetCellState.content2 && String(targetCellState.content2).trim() !== '')
                : (targetCellState.content && String(targetCellState.content).trim() !== '');

            // Jeśli cel ma zawartość i nie jest podzielony i nie wskazano konkretnej części
            const shouldAutoSplit = !targetCellState.isSplit && targetHasContent && !targetPart;

            const updates = [
                {
                    time: targetTime,
                    employeeIndex: targetIndex,
                    updateFn: (targetState: CellState) => {
                        if (shouldAutoSplit) {
                            // === AUTOMATYCZNY PODZIAŁ: cel ma zawartość, więc dzielimy ===
                            // Przenieś istniejącą zawartość do części 1
                            targetState.content1 = safeCopy(targetState.content);
                            targetState.isMassage1 = safeBool(targetState.isMassage);
                            targetState.isPnf1 = safeBool(targetState.isPnf);
                            targetState.isEveryOtherDay1 = safeBool(targetState.isEveryOtherDay);
                            targetState.treatmentData1 = {
                                startDate: safeCopy(targetState.treatmentStartDate),
                                extensionDays: safeCopy(targetState.treatmentExtensionDays),
                                endDate: safeCopy(targetState.treatmentEndDate),
                                additionalInfo: safeCopy(targetState.additionalInfo),
                            };

                            // Przenieś nową zawartość do części 2
                            targetState.content2 = safeCopy(contentToMove);
                            targetState.isMassage2 = safeBool(isMassageToMove);
                            targetState.isPnf2 = safeBool(isPnfToMove);
                            targetState.isEveryOtherDay2 = safeBool(isEveryOtherDayToMove);
                            targetState.treatmentData2 = {
                                startDate: safeCopy(treatmentDataToMove.startDate),
                                extensionDays: safeCopy(treatmentDataToMove.extensionDays),
                                endDate: safeCopy(treatmentDataToMove.endDate),
                                additionalInfo: safeCopy(treatmentDataToMove.additionalInfo),
                            };

                            // Oznacz jako podzieloną i wyczyść pola zwykłej komórki
                            targetState.isSplit = true;
                            targetState.content = null;
                            targetState.isMassage = null;
                            targetState.isPnf = null;
                            targetState.isEveryOtherDay = null;
                            targetState.treatmentStartDate = null;
                            targetState.treatmentExtensionDays = null;
                            targetState.treatmentEndDate = null;
                            targetState.additionalInfo = null;
                        } else if (targetPart && targetCellState.isSplit) {
                            // Cel: część podzielonej komórki
                            targetState[`content${targetPart}`] = safeCopy(contentToMove);
                            targetState[`isMassage${targetPart}`] = safeBool(isMassageToMove);
                            targetState[`isPnf${targetPart}`] = safeBool(isPnfToMove);
                            targetState[`isEveryOtherDay${targetPart}`] = safeBool(isEveryOtherDayToMove);
                            targetState[`treatmentData${targetPart}`] = {
                                startDate: safeCopy(treatmentDataToMove.startDate),
                                extensionDays: safeCopy(treatmentDataToMove.extensionDays),
                                endDate: safeCopy(treatmentDataToMove.endDate),
                                additionalInfo: safeCopy(treatmentDataToMove.additionalInfo),
                            };
                        } else {
                            // Cel: zwykła komórka (pusta lub bez wskazania części)
                            for (const key of CONTENT_KEYS) {
                                delete (targetState as Record<string, unknown>)[key];
                            }
                            targetState.content = safeCopy(contentToMove);
                            targetState.isMassage = safeBool(isMassageToMove);
                            targetState.isPnf = safeBool(isPnfToMove);
                            targetState.isEveryOtherDay = safeBool(isEveryOtherDayToMove);
                            targetState.treatmentStartDate = safeCopy(treatmentDataToMove.startDate);
                            targetState.treatmentExtensionDays = safeCopy(treatmentDataToMove.extensionDays);
                            targetState.treatmentEndDate = safeCopy(treatmentDataToMove.endDate);
                            targetState.additionalInfo = safeCopy(treatmentDataToMove.additionalInfo);
                        }
                    },
                },
                {
                    time: sourceTime,
                    employeeIndex: sourceIndex,
                    updateFn: (sourceState: CellState) => {
                        if (sourcePart && sourceState.isSplit) {
                            // Wyczyść tylko wybraną część podzielonej komórki
                            sourceState[`content${sourcePart}`] = null;
                            sourceState[`isMassage${sourcePart}`] = null;
                            sourceState[`isPnf${sourcePart}`] = null;
                            sourceState[`isEveryOtherDay${sourcePart}`] = null;
                            sourceState[`treatmentData${sourcePart}`] = null;

                            // === WARUNEK 3: Automatyczne scalenie jeśli obie części puste ===
                            const otherPart = sourcePart === 1 ? 2 : 1;
                            const otherContent = sourceState[`content${otherPart}`];
                            const otherHasContent = otherContent && String(otherContent).trim() !== '';

                            if (!otherHasContent) {
                                // Obie części puste - scal komórkę (usuń podział)
                                sourceState.isSplit = null;
                                sourceState.content1 = null;
                                sourceState.content2 = null;
                                sourceState.isMassage1 = null;
                                sourceState.isMassage2 = null;
                                sourceState.isPnf1 = null;
                                sourceState.isPnf2 = null;
                                sourceState.isEveryOtherDay1 = null;
                                sourceState.isEveryOtherDay2 = null;
                                sourceState.treatmentData1 = null;
                                sourceState.treatmentData2 = null;
                            } else {
                                // Druga część ma zawartość - przenieś ją do głównej i scal
                                const otherMassage = sourceState[`isMassage${otherPart}`];
                                const otherPnf = sourceState[`isPnf${otherPart}`];
                                const otherEveryOtherDay = sourceState[`isEveryOtherDay${otherPart}`];
                                const otherTreatmentData = sourceState[`treatmentData${otherPart}`] as { startDate?: string | null; extensionDays?: number | null; endDate?: string | null; additionalInfo?: string | null } | null | undefined;

                                // Przenieś zawartość do głównych pól
                                sourceState.content = safeCopy(otherContent);
                                sourceState.isMassage = safeBool(otherMassage);
                                sourceState.isPnf = safeBool(otherPnf);
                                sourceState.isEveryOtherDay = safeBool(otherEveryOtherDay);
                                if (otherTreatmentData) {
                                    sourceState.treatmentStartDate = safeCopy(otherTreatmentData.startDate);
                                    sourceState.treatmentExtensionDays = safeCopy(otherTreatmentData.extensionDays);
                                    sourceState.treatmentEndDate = safeCopy(otherTreatmentData.endDate);
                                    sourceState.additionalInfo = safeCopy(otherTreatmentData.additionalInfo);
                                }

                                // Wyczyść pola split
                                sourceState.isSplit = null;
                                sourceState.content1 = null;
                                sourceState.content2 = null;
                                sourceState.isMassage1 = null;
                                sourceState.isMassage2 = null;
                                sourceState.isPnf1 = null;
                                sourceState.isPnf2 = null;
                                sourceState.isEveryOtherDay1 = null;
                                sourceState.isEveryOtherDay2 = null;
                                sourceState.treatmentData1 = null;
                                sourceState.treatmentData2 = null;
                            }
                        } else {
                            // Wyczyść całą źródłową komórkę
                            for (const key of CONTENT_KEYS) {
                                sourceState[key] = null;
                            }
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
        // Usuń klasy is-dragging z części split i z komórek
        document.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
        document.querySelectorAll('.has-dragging-part').forEach((el) => el.classList.remove('has-dragging-part'));
        document.querySelectorAll('.drag-over-target').forEach((el) => el.classList.remove('drag-over-target'));
        draggedCell = null;
        draggedSplitPart = null;
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
        draggedSplitPart = null;
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
