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
    'treatmentData1', 'treatmentData2', 'isMassage1', 'isMassage2', 'isPnf1', 'isPnf2', 'isHydrotherapy'
] as const;

/**
 * Moduł Drag & Drop dla harmonogramu
 */
export const ScheduleDragDrop: DragDropAPI = (() => {
    let _dependencies: DragDropDependencies;
    let draggedCell: HTMLElement | null = null;
    let draggedSplitPart: number | null = null; // 1 = górna część, 2 = dolna część, null = cała komórka
    let isAltDrag: boolean = false; // Tryb kopiowania (Alt+przeciągnij)

    /**
     * Rozpoczęcie przeciągania komórki lub części podzielonej komórki
     */
    const handleDragStart = (event: DragEvent): void => {
        const target = event.target as HTMLElement;
        const dragPart = target.dataset.splitPart;
        isAltDrag = event.altKey;

        if (dragPart) {
            const parentCell = target.closest<HTMLTableCellElement>('td.editable-cell');
            if (parentCell && !parentCell.classList.contains('break-cell') && !parentCell.classList.contains('hydrotherapy-cell') && event.dataTransfer) {
                draggedCell = parentCell;
                draggedSplitPart = Number.parseInt(dragPart, 10);
                event.dataTransfer.setData('application/json', JSON.stringify({
                    ...(_dependencies.getCurrentTableStateForCell(parentCell) as object),
                    draggedPart: draggedSplitPart
                }));
                event.dataTransfer.effectAllowed = isAltDrag ? 'copy' : 'move';
                target.classList.add('is-dragging');
                if (isAltDrag) target.classList.add('is-copying');
                parentCell.classList.add('has-dragging-part');
            } else event.preventDefault();
            return;
        }

        const cellTarget = target.closest<HTMLTableCellElement>('td.editable-cell');
        if (cellTarget && !cellTarget.classList.contains('break-cell') && !cellTarget.classList.contains('hydrotherapy-cell') && event.dataTransfer) {
            draggedCell = cellTarget;
            draggedSplitPart = null;
            event.dataTransfer.setData('application/json', JSON.stringify(_dependencies.getCurrentTableStateForCell(cellTarget)));
            event.dataTransfer.effectAllowed = isAltDrag ? 'copy' : 'move';
            draggedCell.classList.add('is-dragging');
            if (isAltDrag) draggedCell.classList.add('is-copying');
        } else event.preventDefault();
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
            if (eventTarget.dataset.splitPart ||
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
        (event.target as HTMLElement).classList.remove('drag-over-target');
    };

    const _getSourceData = (cell: HTMLElement, part: number | null): any => {
        const { time = '', employeeIndex = '' } = cell.dataset;
        const state = _dependencies.appState.scheduleCells[time]?.[employeeIndex] || {};

        if (part && state.isSplit) {
            return {
                content: (state as any)[`content${part}`],
                isMassage: (state as any)[`isMassage${part}`],
                isPnf: (state as any)[`isPnf${part}`],
                isEveryOtherDay: (state as any)[`isEveryOtherDay${part}`],
                treatmentData: (state as any)[`treatmentData${part}`] || {}
            };
        }

        return {
            content: state.content,
            isMassage: state.isMassage,
            isPnf: state.isPnf,
            isEveryOtherDay: state.isEveryOtherDay,
            treatmentData: {
                startDate: state.treatmentStartDate,
                extensionDays: state.treatmentExtensionDays,
                endDate: state.treatmentEndDate,
                additionalInfo: state.additionalInfo,
            }
        };
    };

    const _updateTargetStateFromSingle = (targetState: any, sourceData: any): void => {
        for (const key of CONTENT_KEYS) delete (targetState as any)[key];
        Object.assign(targetState, {
            content: safeCopy(sourceData.content),
            isMassage: safeBool(sourceData.isMassage),
            isPnf: safeBool(sourceData.isPnf),
            isEveryOtherDay: safeBool(sourceData.isEveryOtherDay),
            treatmentStartDate: safeCopy(sourceData.treatmentData.startDate),
            treatmentExtensionDays: safeCopy(sourceData.treatmentData.extensionDays),
            treatmentEndDate: safeCopy(sourceData.treatmentData.endDate),
            additionalInfo: safeCopy(sourceData.treatmentData.additionalInfo)
        });
    };

    const _updateTargetState = (targetState: any, sourceData: any, targetPart: number | null, shouldAutoSplit: boolean): void => {
        if (shouldAutoSplit) {
            Object.assign(targetState, {
                content1: safeCopy(targetState.content),
                isMassage1: safeBool(targetState.isMassage),
                isPnf1: safeBool(targetState.isPnf),
                isEveryOtherDay1: safeBool(targetState.isEveryOtherDay),
                treatmentData1: {
                    startDate: safeCopy(targetState.treatmentStartDate),
                    extensionDays: safeCopy(targetState.treatmentExtensionDays),
                    endDate: safeCopy(targetState.treatmentEndDate),
                    additionalInfo: safeCopy(targetState.additionalInfo),
                },
                content2: safeCopy(sourceData.content),
                isMassage2: safeBool(sourceData.isMassage),
                isPnf2: safeBool(sourceData.isPnf),
                isEveryOtherDay2: safeBool(sourceData.isEveryOtherDay),
                treatmentData2: safeCopy(sourceData.treatmentData),
                isSplit: true,
                content: null, isMassage: null, isPnf: null, isEveryOtherDay: null, treatmentStartDate: null, treatmentExtensionDays: null, treatmentEndDate: null, additionalInfo: null
            });
        } else if (targetPart && targetState.isSplit) {
            const updates = {
                [`content${targetPart}`]: safeCopy(sourceData.content),
                [`isMassage${targetPart}`]: safeBool(sourceData.isMassage),
                [`isPnf${targetPart}`]: safeBool(sourceData.isPnf),
                [`isEveryOtherDay${targetPart}`]: safeBool(sourceData.isEveryOtherDay),
                [`treatmentData${targetPart}`]: safeCopy(sourceData.treatmentData)
            };
            Object.assign(targetState, updates);
        } else {
            _updateTargetStateFromSingle(targetState, sourceData);
        }
    };

    const _updateSourceState = (sourceState: any, sourcePart: number | null): void => {
        if (sourcePart && sourceState.isSplit) {
            const keys = [`content${sourcePart}`, `isMassage${sourcePart}`, `isPnf${sourcePart}`, `isEveryOtherDay${sourcePart}`, `treatmentData${sourcePart}`];
            keys.forEach(k => sourceState[k] = null);

            const otherPart = sourcePart === 1 ? 2 : 1;
            const otherContent = sourceState[`content${otherPart}`] as string | undefined;

            if (!otherContent?.trim()) {
                Object.assign(sourceState, { isSplit: null, content1: null, content2: null, isMassage1: null, isMassage2: null, isPnf1: null, isPnf2: null, isEveryOtherDay1: null, isEveryOtherDay2: null, treatmentData1: null, treatmentData2: null });
            } else {
                sourceState.content = safeCopy(otherContent);
                sourceState.isMassage = safeBool(sourceState[`isMassage${otherPart}`] as boolean);
                sourceState.isPnf = safeBool(sourceState[`isPnf${otherPart}`] as boolean);
                sourceState.isEveryOtherDay = safeBool(sourceState[`isEveryOtherDay${otherPart}`] as boolean);
                const otherTD = sourceState[`treatmentData${otherPart}`];
                if (otherTD) {
                    Object.assign(sourceState, { treatmentStartDate: safeCopy(otherTD.startDate), treatmentExtensionDays: safeCopy(otherTD.extensionDays), treatmentEndDate: safeCopy(otherTD.endDate), additionalInfo: safeCopy(otherTD.additionalInfo) });
                }
                Object.assign(sourceState, { isSplit: null, content1: null, content2: null, isMassage1: null, isMassage2: null, isPnf1: null, isPnf2: null, isEveryOtherDay1: null, isEveryOtherDay2: null, treatmentData1: null, treatmentData2: null });
            }
        } else {
            for (const key of CONTENT_KEYS) sourceState[key] = null;
        }
    };

    /**
     * Upuszczenie komórki na cel
     */
    const handleDrop = (event: DragEvent): void => {
        event.preventDefault();
        const dropTargetCell = (event.target as HTMLElement).closest<HTMLTableCellElement>('td.editable-cell');
        document.querySelectorAll('.drag-over-target').forEach((el) => el.classList.remove('drag-over-target'));

        if (!dropTargetCell || dropTargetCell.classList.contains('break-cell') || dropTargetCell.classList.contains('hydrotherapy-cell') || !draggedCell || draggedCell === dropTargetCell) return;

        const { time: sourceTime = '', employeeIndex: sourceIndex = '' } = draggedCell.dataset;
        const { time: targetTime = '', employeeIndex: targetIndex = '' } = dropTargetCell.dataset;

        const eventTarget = event.target as HTMLElement;
        const splitDiv = eventTarget.closest<HTMLElement>('.split-cell-wrapper > div');
        let targetPart: number | null = null;
        if (eventTarget.dataset.splitPart) targetPart = Number.parseInt(eventTarget.dataset.splitPart, 10);
        else if (splitDiv?.dataset.splitPart) targetPart = Number.parseInt(splitDiv.dataset.splitPart, 10);

        const sourceCellState = _dependencies.appState.scheduleCells[sourceTime]?.[sourceIndex] || {};
        const targetCellState = _dependencies.appState.scheduleCells[targetTime]?.[targetIndex] || {};

        if (!draggedSplitPart && targetCellState.isSplit && !targetPart) {
            (globalThis as any).showToast?.('Wybierz konkretną część podzielonej komórki', 3000);
            return;
        }

        if (targetPart && targetCellState.isSplit) {
            const content = targetCellState[`content${targetPart}`] as string | undefined;
            if (content?.trim()) {
                (globalThis as any).showToast?.('Ta część komórki jest już zajęta', 3000);
                return;
            }
        }

        const sourceData = _getSourceData(draggedCell, draggedSplitPart);
        const sourceContent = sourceData.content as string | undefined;
        if (!sourceContent?.trim()) {
            const s1 = sourceCellState.content1 as string | undefined;
            const s2 = sourceCellState.content2 as string | undefined;
            if (!draggedSplitPart && sourceCellState.isSplit && (s1?.trim() || s2?.trim())) { /* continue */ }
            else return;
        }

        const t1 = targetCellState.content1 as string | undefined;
        const t2 = targetCellState.content2 as string | undefined;
        const tc = targetCellState.content as string | undefined;
        const targetHasContent = !!(targetCellState.isSplit ? (t1?.trim() || t2?.trim()) : tc?.trim());
        const shouldAutoSplit = !targetCellState.isSplit && targetHasContent && !targetPart;

        const updates = [
            { time: targetTime, employeeIndex: targetIndex, updateFn: (state: CellState) => _updateTargetState(state, sourceData, targetPart, shouldAutoSplit) }
        ];

        if (!isAltDrag) {
            updates.push({ time: sourceTime, employeeIndex: sourceIndex, updateFn: (state: CellState) => _updateSourceState(state, draggedSplitPart) });
        }

        _dependencies.updateMultipleCells(updates);
        dropTargetCell.classList.add('just-dropped');
        setTimeout(() => dropTargetCell.classList.remove('just-dropped'), 300);
        if (isAltDrag) (globalThis as any).showToast?.('Skopiowano pacjenta', 1500);
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

(globalThis as any).ScheduleDragDrop = ScheduleDragDrop;
