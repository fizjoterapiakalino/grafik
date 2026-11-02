// scripts/schedule-drag-drop.ts
// Moduł obsługi Drag & Drop dla harmonogramu

import { safeCopy, safeBool } from './utils.js';
import { ensureActiveTreatmentDates } from './schedule-helpers.js';
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

const STYLE_FLAGS = ['isMassage', 'isPnf', 'isEveryOtherDay', 'isSharedPatient', 'isHydrotherapy'] as const;

/**
 * Klucze zawartości komórki używane przy kopiowaniu/czyszczeniu
 */
const CONTENT_KEYS = [
    'content', 'content1', 'content2', 'patientId', 'patientId1', 'patientId2', 'isSplit', 'isMassage', 'isPnf', 'isEveryOtherDay', 'isSharedPatient',
    'treatmentStartDate', 'treatmentExtensionDays', 'treatmentEndDate', 'additionalInfo',
    'treatmentData1', 'treatmentData2', 'isMassage1', 'isMassage2', 'isPnf1', 'isPnf2',
    'isEveryOtherDay1', 'isEveryOtherDay2', 'isSharedPatient1', 'isSharedPatient2', 'isHydrotherapy',
    'isHydrotherapy1', 'isHydrotherapy2',
    'absenceDates', 'absenceDates1', 'absenceDates2'
] as const;

/**
 * Moduł Drag & Drop dla harmonogramu
 */
export const ScheduleDragDrop: DragDropAPI = (() => {
    let _dependencies: DragDropDependencies;
    let draggedCell: HTMLElement | null = null;
    let draggedSplitPart: number | null = null; // 1 = górna część, 2 = dolna część, null = cała komórka
    let isAltDrag: boolean = false; // Tryb kopiowania (Alt+przeciągnij)

    const startSplitDrag = (target: HTMLElement, parentCell: HTMLTableCellElement, event: DragEvent) => {
        draggedCell = parentCell;
        draggedSplitPart = Number.parseInt(target.dataset.splitPart!, 10);
        event.dataTransfer!.setData(
            'application/json',
            JSON.stringify({
                ...(_dependencies.getCurrentTableStateForCell(parentCell) as Record<string, unknown>),
                draggedPart: draggedSplitPart
            })
        );
        event.dataTransfer!.effectAllowed = isAltDrag ? 'copy' : 'move';
        target.classList.add('is-dragging');
        if (isAltDrag) {
            target.classList.add('is-copying');
        }
        parentCell.classList.add('has-dragging-part');
    };

    const startStandardDrag = (cellTarget: HTMLTableCellElement, event: DragEvent) => {
        draggedCell = cellTarget;
        draggedSplitPart = null;
        event.dataTransfer!.setData(
            'application/json',
            JSON.stringify(_dependencies.getCurrentTableStateForCell(cellTarget))
        );
        event.dataTransfer!.effectAllowed = isAltDrag ? 'copy' : 'move';
        draggedCell.classList.add('is-dragging');
        if (isAltDrag) {
            draggedCell.classList.add('is-copying');
        }
    };

    /**
     * Rozpoczęcie przeciągania komórki lub części podzielonej komórki
     */
    const handleDragStart = (event: DragEvent): void => {
        const target = event.target as HTMLElement;
        isAltDrag = event.altKey;

        // Sprawdź czy przeciągamy część podzielonej komórki
        if (target.dataset.splitPart !== undefined) {
            const parentCell = target.closest<HTMLTableCellElement>('td.editable-cell');
            if (parentCell && !parentCell.classList.contains('break-cell') && !parentCell.classList.contains('hydrotherapy-cell') && event.dataTransfer) {
                startSplitDrag(target, parentCell, event);
            } else {
                event.preventDefault();
            }
            return;
        }

        // Standardowe przeciąganie całej komórki
        const cellTarget = target.closest<HTMLTableCellElement>('td.editable-cell');
        if (cellTarget && !cellTarget.classList.contains('break-cell') && !cellTarget.classList.contains('hydrotherapy-cell') && event.dataTransfer) {
            startStandardDrag(cellTarget, event);
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
        const dropTargetCell = eventTarget.closest<HTMLTableCellElement>('td.editable-cell');

        // Usuń poprzednie podświetlenia
        document.querySelectorAll('.drag-over-target').forEach((el) => el.classList.remove('drag-over-target'));

        if (dropTargetCell && !dropTargetCell.classList.contains('break-cell') && !dropTargetCell.classList.contains('hydrotherapy-cell') && draggedCell !== dropTargetCell && event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';

            // Sprawdź czy przeciągamy nad częścią split komórki
            if (eventTarget.dataset.splitPart !== undefined ||
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
    const getTargetPartFromDrop = (eventTarget: HTMLElement): number | null => {
        if (eventTarget.dataset.splitPart !== undefined) {
            return Number.parseInt(eventTarget.dataset.splitPart, 10);
        }
        const splitDiv = eventTarget.closest<HTMLElement>('.split-cell-wrapper > div');
        if (splitDiv?.dataset.splitPart !== undefined) {
            return Number.parseInt(splitDiv.dataset.splitPart, 10);
        }
        if (splitDiv) {
            const wrapper = splitDiv.parentElement;
            if (wrapper) {
                return splitDiv === wrapper.children[0] ? 1 : 2;
            }
        }
        return null;
    };

    const extractDataToMove = (sourceState: CellState, sourcePart: number | null) => {
        if (sourcePart && sourceState.isSplit) {
            const td = (sourceState[`treatmentData${sourcePart}`] as { startDate?: string | null; extensionDays?: number | null; endDate?: string | null; additionalInfo?: string | null; absenceDates?: string[] | null } | null | undefined) || {};
            const absence = Array.isArray(td.absenceDates)
                ? [...td.absenceDates]
                : (Array.isArray(sourceState[`absenceDates${sourcePart}`])
                    ? [...(sourceState[`absenceDates${sourcePart}`] as string[])]
                    : (td.absenceDates === null ? null : undefined));
            return {
                content: sourceState[`content${sourcePart}`] as string | null | undefined,
                patientId: sourceState[`patientId${sourcePart}`] as string | null | undefined,
                isMassage: sourceState[`isMassage${sourcePart}`] as boolean | null | undefined,
                isPnf: sourceState[`isPnf${sourcePart}`] as boolean | null | undefined,
                isEveryOtherDay: sourceState[`isEveryOtherDay${sourcePart}`] as boolean | null | undefined,
                isSharedPatient: sourceState[`isSharedPatient${sourcePart}`] as boolean | null | undefined,
                isHydrotherapy: sourceState[`isHydrotherapy${sourcePart}`] as boolean | null | undefined,
                treatmentData: {
                    startDate: safeCopy(td.startDate),
                    extensionDays: safeCopy(td.extensionDays),
                    endDate: safeCopy(td.endDate),
                    additionalInfo: safeCopy(td.additionalInfo),
                    absenceDates: absence !== undefined ? absence : null,
                },
                absenceDates: absence !== undefined ? absence : null,
            };
        }
        const absence = Array.isArray(sourceState.absenceDates)
            ? [...sourceState.absenceDates]
            : (sourceState.absenceDates === null ? null : undefined);
        return {
            content: sourceState.content,
            patientId: sourceState.patientId,
            isMassage: sourceState.isMassage,
            isPnf: sourceState.isPnf,
            isEveryOtherDay: sourceState.isEveryOtherDay,
            isSharedPatient: sourceState.isSharedPatient,
            isHydrotherapy: sourceState.isHydrotherapy,
            treatmentData: {
                startDate: sourceState.treatmentStartDate,
                extensionDays: sourceState.treatmentExtensionDays,
                endDate: sourceState.treatmentEndDate,
                additionalInfo: sourceState.additionalInfo,
                absenceDates: absence !== undefined ? absence : null,
            },
            absenceDates: absence !== undefined ? absence : null,
        };
    };

    const applyTargetAutoSplit = (targetState: CellState, dataToMove: ReturnType<typeof extractDataToMove>) => {
        targetState.content1 = safeCopy(targetState.content);
        targetState.patientId1 = safeCopy(targetState.patientId);
        STYLE_FLAGS.forEach((f) => { targetState[`${f}1`] = safeBool(targetState[f]); });
        targetState.treatmentData1 = {
            startDate: safeCopy(targetState.treatmentStartDate),
            extensionDays: safeCopy(targetState.treatmentExtensionDays),
            endDate: safeCopy(targetState.treatmentEndDate),
            additionalInfo: safeCopy(targetState.additionalInfo),
            absenceDates: Array.isArray(targetState.absenceDates) ? [...targetState.absenceDates] : null,
        };

        targetState.content2 = safeCopy(dataToMove.content);
        targetState.patientId2 = safeCopy(dataToMove.patientId);
        STYLE_FLAGS.forEach((f) => { targetState[`${f}2`] = safeBool(dataToMove[f]); });
        targetState.treatmentData2 = {
            startDate: safeCopy(dataToMove.treatmentData.startDate),
            extensionDays: safeCopy(dataToMove.treatmentData.extensionDays),
            endDate: safeCopy(dataToMove.treatmentData.endDate),
            additionalInfo: safeCopy(dataToMove.treatmentData.additionalInfo),
            absenceDates: Array.isArray(dataToMove.treatmentData.absenceDates) ? [...dataToMove.treatmentData.absenceDates] : null,
        };

        targetState.isSplit = true;
        targetState.content = null;
        targetState.patientId = null;
        STYLE_FLAGS.forEach((f) => { targetState[f] = null; });
        targetState.treatmentStartDate = null;
        targetState.treatmentExtensionDays = null;
        targetState.treatmentEndDate = null;
        targetState.additionalInfo = null;
        targetState.absenceDates = null;
        ensureActiveTreatmentDates(targetState, { resetIfExpired: false });
    };

    const applyTargetPartUpdate = (targetState: CellState, targetPart: number, dataToMove: ReturnType<typeof extractDataToMove>) => {
        targetState[`content${targetPart}`] = safeCopy(dataToMove.content);
        targetState[`patientId${targetPart}`] = safeCopy(dataToMove.patientId);
        STYLE_FLAGS.forEach((f) => { targetState[`${f}${targetPart}`] = safeBool(dataToMove[f]); });
        targetState[`treatmentData${targetPart}`] = {
            startDate: safeCopy(dataToMove.treatmentData.startDate),
            extensionDays: safeCopy(dataToMove.treatmentData.extensionDays),
            endDate: safeCopy(dataToMove.treatmentData.endDate),
            additionalInfo: safeCopy(dataToMove.treatmentData.additionalInfo),
            absenceDates: Array.isArray(dataToMove.treatmentData.absenceDates) ? [...dataToMove.treatmentData.absenceDates] : null,
        };
        ensureActiveTreatmentDates(targetState, { resetIfExpired: false });
    };

    const applyTargetNormalUpdate = (targetState: CellState, dataToMove: ReturnType<typeof extractDataToMove>) => {
        for (const key of CONTENT_KEYS) {
            delete (targetState as Record<string, unknown>)[key];
        }
        targetState.content = safeCopy(dataToMove.content);
        targetState.patientId = safeCopy(dataToMove.patientId);
        STYLE_FLAGS.forEach((f) => { targetState[f] = safeBool(dataToMove[f]); });
        targetState.treatmentStartDate = safeCopy(dataToMove.treatmentData.startDate);
        targetState.treatmentExtensionDays = safeCopy(dataToMove.treatmentData.extensionDays);
        targetState.treatmentEndDate = safeCopy(dataToMove.treatmentData.endDate);
        targetState.additionalInfo = safeCopy(dataToMove.treatmentData.additionalInfo);
        targetState.absenceDates = Array.isArray(dataToMove.treatmentData.absenceDates) ? [...dataToMove.treatmentData.absenceDates] : null;
        ensureActiveTreatmentDates(targetState, { resetIfExpired: false });
    };

    const applySourceClear = (sourceState: CellState, sourcePart: number | null) => {
        if (sourcePart && sourceState.isSplit) {
            sourceState[`content${sourcePart}`] = null;
            sourceState[`patientId${sourcePart}`] = null;
            STYLE_FLAGS.forEach((f) => { sourceState[`${f}${sourcePart}`] = null; });
            sourceState[`treatmentData${sourcePart}`] = null;
            sourceState[`absenceDates${sourcePart}`] = null;

            const otherPart = sourcePart === 1 ? 2 : 1;
            const otherContent = sourceState[`content${otherPart}`];
            const otherHasContent = otherContent && String(otherContent).trim() !== '';

            if (otherHasContent) {
                const otherTreatmentData = sourceState[`treatmentData${otherPart}`] as { startDate?: string | null; extensionDays?: number | null; endDate?: string | null; additionalInfo?: string | null; absenceDates?: string[] | null } | null | undefined;

                sourceState.content = safeCopy(otherContent as string | null | undefined);
                sourceState.patientId = safeCopy(sourceState[`patientId${otherPart}`] as string | null | undefined);
                STYLE_FLAGS.forEach((f) => {
                    sourceState[f] = safeBool(sourceState[`${f}${otherPart}`]);
                });
                if (otherTreatmentData) {
                    sourceState.treatmentStartDate = safeCopy(otherTreatmentData.startDate);
                    sourceState.treatmentExtensionDays = safeCopy(otherTreatmentData.extensionDays);
                    sourceState.treatmentEndDate = safeCopy(otherTreatmentData.endDate);
                    sourceState.additionalInfo = safeCopy(otherTreatmentData.additionalInfo);
                    sourceState.absenceDates = Array.isArray(otherTreatmentData.absenceDates) ? [...otherTreatmentData.absenceDates] : null;
                }
            }

            sourceState.isSplit = null;
            sourceState.content1 = null;
            sourceState.content2 = null;
            sourceState.patientId1 = null;
            sourceState.patientId2 = null;
            STYLE_FLAGS.forEach((f) => {
                sourceState[`${f}1`] = null;
                sourceState[`${f}2`] = null;
            });
            sourceState.treatmentData1 = null;
            sourceState.treatmentData2 = null;
            sourceState.absenceDates1 = null;
            sourceState.absenceDates2 = null;
        } else {
            for (const key of CONTENT_KEYS) {
                sourceState[key] = null;
            }
        }
    };

    const isDropValid = (targetCellState: CellState, targetPart: number | null, sourcePart: number | null): boolean => {
        if (!sourcePart && targetCellState.isSplit && !targetPart) {
            (globalThis as any).showToast?.('Wybierz konkretną część podzielonej komórki', 3000);
            return false;
        }
        if (targetPart && targetCellState.isSplit) {
            const targetPartContent = targetCellState[`content${targetPart}`];
            if (targetPartContent && String(targetPartContent).trim() !== '') {
                (globalThis as any).showToast?.('Ta część komórki jest już zajęta', 3000);
                return false;
            }
        }
        return true;
    };

    const sourceHasContentToMove = (sourceCellState: CellState, sourcePart: number | null, dataToMove: ReturnType<typeof extractDataToMove>): boolean => {
        if (!dataToMove.content || dataToMove.content.trim() === '') {
            if (!sourcePart && sourceCellState.isSplit) {
                const hasContent1 = Boolean(sourceCellState.content1 && String(sourceCellState.content1).trim() !== '');
                const hasContent2 = Boolean(sourceCellState.content2 && String(sourceCellState.content2).trim() !== '');
                return hasContent1 || hasContent2;
            }
            return false;
        }
        return true;
    };

    /**
     * Upuszczenie komórki na cel
     */
    const handleDrop = (event: DragEvent): void => {
        event.preventDefault();
        const dropTargetCell = (event.target as HTMLElement).closest<HTMLTableCellElement>('td.editable-cell');

        document.querySelectorAll('.drag-over-target').forEach((el) => el.classList.remove('drag-over-target'));

        if (!dropTargetCell || dropTargetCell.classList.contains('break-cell') || dropTargetCell.classList.contains('hydrotherapy-cell') || !draggedCell || draggedCell === dropTargetCell) {
            return;
        }

        const sourceTime = draggedCell.dataset.time!;
        const sourceIndex = draggedCell.dataset.employeeIndex!;
        const targetTime = dropTargetCell.dataset.time!;
        const targetIndex = dropTargetCell.dataset.employeeIndex!;

        const targetPart = getTargetPartFromDrop(event.target as HTMLElement);

        const sourceCellState = _dependencies.appState.scheduleCells[sourceTime]?.[sourceIndex] || {};
        const targetCellState = _dependencies.appState.scheduleCells[targetTime]?.[targetIndex] || {};
        const sourcePart = draggedSplitPart;

        if (!isDropValid(targetCellState, targetPart, sourcePart)) {
            return;
        }

        const dataToMove = extractDataToMove(sourceCellState, sourcePart);
        if (!sourceHasContentToMove(sourceCellState, sourcePart, dataToMove)) {
            return;
        }

        const targetHasContent = targetCellState.isSplit
            ? (targetCellState.content1 && String(targetCellState.content1).trim() !== '') ||
            (targetCellState.content2 && String(targetCellState.content2).trim() !== '')
            : (targetCellState.content && String(targetCellState.content).trim() !== '');

        const shouldAutoSplit = !targetCellState.isSplit && targetHasContent && !targetPart;

        const updates = [
            {
                time: targetTime,
                employeeIndex: targetIndex,
                updateFn: (targetState: CellState) => {
                    if (shouldAutoSplit) {
                        applyTargetAutoSplit(targetState, dataToMove);
                    } else if (targetPart && targetCellState.isSplit) {
                        applyTargetPartUpdate(targetState, targetPart, dataToMove);
                    } else {
                        applyTargetNormalUpdate(targetState, dataToMove);
                    }
                },
            },
        ];

        if (!isAltDrag) {
            updates.push({
                time: sourceTime,
                employeeIndex: sourceIndex,
                updateFn: (sourceState: CellState) => applySourceClear(sourceState, sourcePart),
            });
        }

        _dependencies.updateMultipleCells(updates);

        dropTargetCell.classList.add('just-dropped');
        globalThis.setTimeout(() => {
            dropTargetCell.classList.remove('just-dropped');
        }, 300);

        if (isAltDrag) {
            (globalThis as any).showToast?.('Skopiowano pacjenta', 1500);
        }
    };

    /**
     * Zakończenie przeciągania
     */
    const handleDragEnd = (): void => {
        // Usuń klasy is-dragging z części split i z komórek
        document.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
        document.querySelectorAll('.is-copying').forEach((el) => el.classList.remove('is-copying'));
        document.querySelectorAll('.has-dragging-part').forEach((el) => el.classList.remove('has-dragging-part'));
        document.querySelectorAll('.drag-over-target').forEach((el) => el.classList.remove('drag-over-target'));
        draggedCell = null;
        draggedSplitPart = null;
        isAltDrag = false;
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

(globalThis as unknown as { ScheduleDragDrop: DragDropAPI }).ScheduleDragDrop = ScheduleDragDrop;
