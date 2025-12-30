// scripts/schedule-helpers.ts
/**
 * Funkcje pomocnicze do operacji na komórkach harmonogramu.
 * Wydzielone z schedule.js dla lepszej czytelności i testowalności.
 */

import { safeCopy, safeBool } from './utils.js';
import { ScheduleLogic } from './schedule-logic.js';

/**
 * Stan komórki harmonogramu
 */
interface CellState {
    content?: string;
    content1?: string;
    content2?: string;
    isSplit?: boolean;
    isMassage?: boolean;
    isPnf?: boolean;
    isEveryOtherDay?: boolean;
    isMassage1?: boolean;
    isMassage2?: boolean;
    isPnf1?: boolean;
    isPnf2?: boolean;
    isEveryOtherDay1?: boolean;
    isEveryOtherDay2?: boolean;
    treatmentStartDate?: string;
    treatmentExtensionDays?: number;
    treatmentEndDate?: string;
    additionalInfo?: string | null;
    treatmentData1?: TreatmentData;
    treatmentData2?: TreatmentData;
    [key: string]: unknown;
}

/**
 * Dane leczenia
 */
interface TreatmentData {
    startDate?: string;
    extensionDays?: number;
    endDate?: string;
    additionalInfo?: string | null;
}

/**
 * Określa numer części podzielonej komórki (1 lub 2) na podstawie elementu DOM
 */
export const getTargetPart = (element: HTMLElement): number | null => {
    if (element.tagName === 'DIV' && element.parentNode && (element.parentNode as HTMLElement).classList.contains('split-cell-wrapper')) {
        return element === (element.parentNode as HTMLElement).children[0] ? 1 : 2;
    }
    return null;
};

/**
 * Określa z której części podzielonej komórki pochodzi tekst
 */
export const getSourcePart = (cellState: CellState, text: string): number | null => {
    if (!cellState.isSplit) return null;
    const lowerText = text.toLowerCase();
    if (cellState.content1?.toLowerCase() === lowerText) return 1;
    if (cellState.content2?.toLowerCase() === lowerText) return 2;
    return null;
};

/**
 * Pobiera dane leczenia z komórki (obsługuje zarówno split jak i normal)
 */
export const getTreatmentData = (cellState: CellState, part: number | null): TreatmentData => {
    if (part) {
        return (cellState[`treatmentData${part}`] as TreatmentData) || {};
    }
    return {
        startDate: cellState.treatmentStartDate,
        extensionDays: cellState.treatmentExtensionDays,
        endDate: cellState.treatmentEndDate,
        additionalInfo: cellState.additionalInfo,
    };
};

/**
 * Kopiuje flagi specjalne z komórki źródłowej do docelowej
 */
export const copyFlags = (source: CellState, target: CellState, sourcePart: number | null, targetPart: number | null): void => {
    const flags = ['isMassage', 'isPnf', 'isEveryOtherDay'];

    flags.forEach((flag) => {
        const sourceKey = sourcePart ? `${flag}${sourcePart}` : flag;
        const targetKey = targetPart ? `${flag}${targetPart}` : flag;
        target[targetKey] = safeBool(source[sourceKey] as boolean);
    });
};

/**
 * Kopiuje dane leczenia do komórki docelowej
 */
export const copyTreatmentToTarget = (treatmentData: TreatmentData, target: CellState, targetPart: number | null): void => {
    if (targetPart) {
        target[`treatmentData${targetPart}`] = {
            startDate: safeCopy(treatmentData.startDate),
            extensionDays: safeCopy(treatmentData.extensionDays),
            endDate: safeCopy(treatmentData.endDate),
            additionalInfo: safeCopy(treatmentData.additionalInfo),
        };
    } else {
        target.treatmentStartDate = safeCopy(treatmentData.startDate) as string | undefined;
        target.treatmentExtensionDays = safeCopy(treatmentData.extensionDays) as number | undefined;
        target.treatmentEndDate = safeCopy(treatmentData.endDate) as string | undefined;
        target.additionalInfo = safeCopy(treatmentData.additionalInfo) as string | null | undefined;
    }
};

/**
 * Czyści pola specyficzne dla podzielonej komórki
 */
export const clearSplitFields = (state: CellState): void => {
    const splitFields = [
        'content1', 'content2', 'isMassage1', 'isMassage2',
        'isPnf1', 'isPnf2', 'isEveryOtherDay1', 'isEveryOtherDay2',
        'treatmentData1', 'treatmentData2',
    ];
    splitFields.forEach((field) => delete state[field]);
};

/**
 * Tworzy funkcję aktualizacji dla komórki docelowej przy przenoszeniu
 */
export const createTargetUpdateFn = (oldCellState: CellState, sourcePart: number | null, targetPart: number | null): ((cellState: CellState) => void) => {
    return (cellState: CellState) => {
        if (targetPart) {
            cellState[`content${targetPart}`] = safeCopy(
                sourcePart ? oldCellState[`content${sourcePart}`] : oldCellState.content
            );

            copyFlags(oldCellState, cellState, sourcePart, targetPart);

            const treatmentData = getTreatmentData(oldCellState, sourcePart);
            copyTreatmentToTarget(treatmentData, cellState, targetPart);
        } else if (sourcePart) {
            cellState.content = safeCopy(oldCellState[`content${sourcePart}`]) as string | undefined;
            cellState.isSplit = false;

            copyFlags(oldCellState, cellState, sourcePart, null);

            const treatmentData = getTreatmentData(oldCellState, sourcePart);
            copyTreatmentToTarget(treatmentData, cellState, null);

            clearSplitFields(cellState);
        } else {
            copyFullCellState(oldCellState, cellState);
        }
    };
};

/**
 * Kopiuje pełny stan komórki (dla przenoszenia normal -> normal)
 */
export const copyFullCellState = (source: CellState, target: CellState): void => {
    target.content = safeCopy(source.content) as string | undefined;
    target.isSplit = safeBool(source.isSplit);
    target.content1 = safeCopy(source.content1) as string | undefined;
    target.content2 = safeCopy(source.content2) as string | undefined;

    ['isMassage', 'isPnf', 'isEveryOtherDay'].forEach((flag) => {
        target[flag] = safeBool(source[flag] as boolean);
        target[`${flag}1`] = safeBool(source[`${flag}1`] as boolean);
        target[`${flag}2`] = safeBool(source[`${flag}2`] as boolean);
    });

    target.treatmentStartDate = safeCopy(source.treatmentStartDate) as string | undefined;
    target.treatmentExtensionDays = safeCopy(source.treatmentExtensionDays) as number | undefined;
    target.treatmentEndDate = safeCopy(source.treatmentEndDate) as string | undefined;
    target.additionalInfo = safeCopy(source.additionalInfo) as string | null | undefined;

    if (source.treatmentData1) {
        target.treatmentData1 = JSON.parse(JSON.stringify(source.treatmentData1));
    }
    if (source.treatmentData2) {
        target.treatmentData2 = JSON.parse(JSON.stringify(source.treatmentData2));
    }
};

/**
 * Tworzy funkcję czyszczenia źródłowej komórki
 */
export const createSourceClearFn = (sourcePart: number | null): ((state: CellState) => void) => {
    return (state: CellState) => {
        if (sourcePart) {
            state[`content${sourcePart}`] = '';
            delete state[`isMassage${sourcePart}`];
            delete state[`isPnf${sourcePart}`];
            delete state[`isEveryOtherDay${sourcePart}`];
            delete state[`treatmentData${sourcePart}`];

            const otherPart = sourcePart === 1 ? 2 : 1;
            if (!state[`content${otherPart}`]) {
                clearAllProperties(state);
            }
        } else {
            clearAllProperties(state);
        }
    };
};

/**
 * Czyści wszystkie właściwości obiektu stanu
 */
export const clearAllProperties = (state: CellState): void => {
    for (const key in state) {
        if (Object.prototype.hasOwnProperty.call(state, key)) {
            delete state[key];
        }
    }
};

/**
 * Tworzy datę dzisiejszą w formacie YYYY-MM-DD
 */
export const getTodayDate = (): string => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Aktualizuje stan komórki przy standardowej edycji (nie przenoszeniu)
 */
export const updateCellContent = (
    cellState: CellState,
    newText: string,
    targetPart: number | null,
    element: HTMLElement,
    parentCell: HTMLElement
): void => {
    if (newText.includes('/')) {
        const parts = newText.split('/', 2);
        cellState.isSplit = true;
        cellState.content1 = parts[0];
        cellState.content2 = parts[1];
    } else if (cellState.isSplit) {
        updateSplitCellPart(cellState, newText, targetPart, element, parentCell);
    } else {
        updateNormalCell(cellState, newText);
    }
};

/**
 * Aktualizuje część podzielonej komórki
 */
const updateSplitCellPart = (
    cellState: CellState,
    newText: string,
    targetPart: number | null,
    element: HTMLElement,
    parentCell: HTMLElement
): void => {
    let part = targetPart;

    if (!part) {
        const isFirstDiv = element === parentCell.querySelector('.split-cell-wrapper > div:first-child');
        part = isFirstDiv ? 1 : 2;
    }

    cellState[`content${part}`] = newText;

    const treatmentData = cellState[`treatmentData${part}`] as TreatmentData | undefined;
    if (treatmentData?.startDate) {
        treatmentData.endDate = ScheduleLogic.calculateEndDate(treatmentData.startDate, treatmentData.extensionDays);
    }
};

/**
 * Aktualizuje normalną (niepodzieloną) komórkę
 */
const updateNormalCell = (cellState: CellState, newText: string): void => {
    const oldContent = cellState.content || '';
    const contentChanged = oldContent.trim().toLowerCase() !== newText.trim().toLowerCase() && newText.trim() !== '';

    if (contentChanged) {
        if (!cellState.treatmentStartDate) {
            cellState.treatmentStartDate = getTodayDate();
        }
        cellState.additionalInfo = cellState.additionalInfo || null;
        cellState.treatmentExtensionDays = cellState.treatmentExtensionDays || 0;
        cellState.treatmentEndDate = ScheduleLogic.calculateEndDate(
            cellState.treatmentStartDate,
            cellState.treatmentExtensionDays
        );
    }

    cellState.content = newText;
};

/**
 * Inicjalizuje dane leczenia dla nowej komórki
 */
export const initTreatmentData = (cellState: CellState): void => {
    if (!cellState.treatmentStartDate && !cellState.isSplit && cellState.content) {
        cellState.treatmentStartDate = getTodayDate();
        cellState.treatmentEndDate = ScheduleLogic.calculateEndDate(cellState.treatmentStartDate, 0);
    }
};
