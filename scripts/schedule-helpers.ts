// scripts/schedule-helpers.ts
/**
 * Funkcje pomocnicze do operacji na komórkach harmonogramu.
 * Wydzielone z schedule.js dla lepszej czytelności i testowalności.
 */

import { safeCopy, safeBool, formatLocalIsoDate } from './utils.js';
import { ScheduleLogic } from './schedule-logic.js';
import type { CellState, TreatmentData } from './types/index.js';

/**
 * Tworzy nieosobowy, stabilny identyfikator wpisu pacjenta. Nazwa pacjenta
 * pozostaje wyłącznie etykietą w grafiku i nie jest używana do agregacji.
 */
export const createPatientId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `patient-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
};

const ensurePatientId = (state: CellState, part: number | null): void => {
    const contentKey = part ? `content${part}` : 'content';
    const patientIdKey = part ? `patientId${part}` : 'patientId';
    const content = state[contentKey];
    if (typeof content === 'string' && content.trim() !== '' && !state[patientIdKey]) {
        state[patientIdKey] = createPatientId();
    }
};

/** Uzupełnia ID dla wpisów utworzonych przed migracją i porządkuje zmianę split/normal. */
export const ensureCellPatientIds = (state: CellState): void => {
    if (state.isHydrotherapy) return;

    if (state.isSplit) {
        if (!state.patientId1 && state.patientId && typeof state.content1 === 'string' && state.content1.trim() !== '') {
            state.patientId1 = state.patientId;
        }
        delete state.patientId;
        ensurePatientId(state, 1);
        ensurePatientId(state, 2);
        return;
    }

    delete state.patientId1;
    delete state.patientId2;
    ensurePatientId(state, null);
};

/**
 * Określa numer części podzielonej komórki (1 lub 2) na podstawie elementu DOM
 */
export const getTargetPart = (element: HTMLElement | null): number | null => {
    if (!element) return null;
    const splitDiv = (element.tagName === 'DIV' && (element.parentElement as HTMLElement | null)?.classList.contains('split-cell-wrapper'))
        ? element
        : (element.closest?.('.split-cell-wrapper > div') as HTMLElement | null);
    if (splitDiv && splitDiv.parentElement?.classList.contains('split-cell-wrapper')) {
        return splitDiv === splitDiv.parentElement.children[0] ? 1 : 2;
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
        const td = (cellState[`treatmentData${part}`] as TreatmentData) || {};
        return {
            ...td,
            absenceDates: Array.isArray(td.absenceDates)
                ? [...td.absenceDates]
                : (td.absenceDates ?? (cellState[`absenceDates${part}`] as string[] | null | undefined)),
        };
    }
    return {
        startDate: cellState.treatmentStartDate,
        extensionDays: cellState.treatmentExtensionDays,
        endDate: cellState.treatmentEndDate,
        additionalInfo: cellState.additionalInfo,
        absenceDates: Array.isArray(cellState.absenceDates) ? [...cellState.absenceDates] : cellState.absenceDates,
    };
};

/**
 * Kopiuje flagi specjalne z komórki źródłowej do docelowej
 */
export const copyFlags = (source: CellState, target: CellState, sourcePart: number | null, targetPart: number | null): void => {
    const flags = ['isMassage', 'isPnf', 'isEveryOtherDay', 'isSharedPatient', 'isHydrotherapy'];

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
    const copiedAbsence = Array.isArray(treatmentData.absenceDates)
        ? [...treatmentData.absenceDates]
        : (treatmentData.absenceDates === null ? null : undefined);

    if (targetPart) {
        target[`treatmentData${targetPart}`] = {
            startDate: safeCopy(treatmentData.startDate),
            extensionDays: safeCopy(treatmentData.extensionDays),
            endDate: safeCopy(treatmentData.endDate),
            additionalInfo: safeCopy(treatmentData.additionalInfo),
            absenceDates: copiedAbsence !== undefined ? copiedAbsence : null,
        };
    } else {
        target.treatmentStartDate = safeCopy(treatmentData.startDate) as string | undefined;
        target.treatmentExtensionDays = safeCopy(treatmentData.extensionDays) as number | undefined;
        target.treatmentEndDate = safeCopy(treatmentData.endDate) as string | undefined;
        target.additionalInfo = safeCopy(treatmentData.additionalInfo) as string | null | undefined;
        target.absenceDates = copiedAbsence !== undefined ? copiedAbsence : null;
    }
};

/**
 * Czyści pola specyficzne dla podzielonej komórki
 */
export const clearSplitFields = (state: CellState): void => {
    const splitFields = [
        'content1', 'content2', 'patientId1', 'patientId2', 'isMassage1', 'isMassage2',
        'isPnf1', 'isPnf2', 'isEveryOtherDay1', 'isEveryOtherDay2',
        'isSharedPatient1', 'isSharedPatient2',
        'isHydrotherapy1', 'isHydrotherapy2',
        'treatmentData1', 'treatmentData2',
        'absenceDates1', 'absenceDates2',
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
            cellState[`patientId${targetPart}`] = safeCopy(
                sourcePart ? oldCellState[`patientId${sourcePart}`] : oldCellState.patientId
            );

            const treatmentData = getTreatmentData(oldCellState, sourcePart);
            copyTreatmentToTarget(treatmentData, cellState, targetPart);
        } else if (sourcePart) {
            cellState.content = safeCopy(oldCellState[`content${sourcePart}`]) as string | undefined;
            cellState.isSplit = false;

            copyFlags(oldCellState, cellState, sourcePart, null);
            cellState.patientId = safeCopy(oldCellState[`patientId${sourcePart}`] as string | undefined);

            const treatmentData = getTreatmentData(oldCellState, sourcePart);
            copyTreatmentToTarget(treatmentData, cellState, null);

            clearSplitFields(cellState);
        } else {
            copyFullCellState(oldCellState, cellState);
        }
        ensureActiveTreatmentDates(cellState, { resetIfExpired: false });
    };
};

/**
 * Kopiuje pełny stan komórki (dla przenoszenia normal -> normal)
 */
export const copyFullCellState = (source: CellState, target: CellState): void => {
    target.content = safeCopy(source.content) as string | undefined;
    target.patientId = safeCopy(source.patientId) as string | undefined;
    target.isSplit = safeBool(source.isSplit);
    target.content1 = safeCopy(source.content1) as string | undefined;
    target.content2 = safeCopy(source.content2) as string | undefined;
    target.patientId1 = safeCopy(source.patientId1) as string | undefined;
    target.patientId2 = safeCopy(source.patientId2) as string | undefined;

    ['isMassage', 'isPnf', 'isEveryOtherDay', 'isSharedPatient'].forEach((flag) => {
        target[flag] = safeBool(source[flag] as boolean);
        target[`${flag}1`] = safeBool(source[`${flag}1`] as boolean);
        target[`${flag}2`] = safeBool(source[`${flag}2`] as boolean);
    });

    target.treatmentStartDate = safeCopy(source.treatmentStartDate) as string | undefined;
    target.treatmentExtensionDays = safeCopy(source.treatmentExtensionDays) as number | undefined;
    target.treatmentEndDate = safeCopy(source.treatmentEndDate) as string | undefined;
    target.additionalInfo = safeCopy(source.additionalInfo) as string | null | undefined;
    target.absenceDates = Array.isArray(source.absenceDates)
        ? [...source.absenceDates]
        : (source.absenceDates === null ? null : undefined);
    target.absenceDates1 = Array.isArray(source.absenceDates1)
        ? [...source.absenceDates1]
        : (source.absenceDates1 === null ? null : undefined);
    target.absenceDates2 = Array.isArray(source.absenceDates2)
        ? [...source.absenceDates2]
        : (source.absenceDates2 === null ? null : undefined);

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
            delete state[`patientId${sourcePart}`];
            delete state[`isMassage${sourcePart}`];
            delete state[`isPnf${sourcePart}`];
            delete state[`isEveryOtherDay${sourcePart}`];
            delete state[`isSharedPatient${sourcePart}`];
            delete state[`treatmentData${sourcePart}`];
            delete state[`absenceDates${sourcePart}`];

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
export const getTodayDate = (): string => formatLocalIsoDate();

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
        const previousContent = (cellState.content || '').trim().toLocaleLowerCase('pl-PL');
        const previousPatientId = cellState.patientId;

        if (!cellState.isSplit) {
            const hasSingleData =
                cellState.treatmentStartDate != null ||
                cellState.isMassage != null ||
                cellState.isPnf != null ||
                cellState.isEveryOtherDay != null ||
                cellState.isSharedPatient != null ||
                cellState.isHydrotherapy != null ||
                cellState.patientId != null;

            if (hasSingleData) {
                if (cellState.treatmentStartDate != null) {
                    const td1: TreatmentData = {
                        startDate: cellState.treatmentStartDate,
                        extensionDays: cellState.treatmentExtensionDays ?? 0,
                        endDate: cellState.treatmentEndDate ?? ScheduleLogic.calculateEndDate(cellState.treatmentStartDate, cellState.treatmentExtensionDays ?? 0),
                        additionalInfo: cellState.additionalInfo,
                    };
                    if (Array.isArray(cellState.absenceDates)) {
                        td1.absenceDates = [...cellState.absenceDates];
                    } else if (cellState.absenceDates === null) {
                        td1.absenceDates = null;
                    }
                    cellState.treatmentData1 = td1;
                }
                if (cellState.isMassage != null) cellState.isMassage1 = cellState.isMassage;
                if (cellState.isPnf != null) cellState.isPnf1 = cellState.isPnf;
                if (cellState.isEveryOtherDay != null) cellState.isEveryOtherDay1 = cellState.isEveryOtherDay;
                if (cellState.isSharedPatient != null) cellState.isSharedPatient1 = cellState.isSharedPatient;
                if (cellState.isHydrotherapy != null) cellState.isHydrotherapy1 = cellState.isHydrotherapy;
                if (cellState.patientId != null) cellState.patientId1 = cellState.patientId;
            }

            delete cellState.content;
            delete cellState.patientId;
            delete cellState.treatmentStartDate;
            delete cellState.treatmentExtensionDays;
            delete cellState.treatmentEndDate;
            delete cellState.additionalInfo;
            delete cellState.absenceDates;
            delete cellState.isMassage;
            delete cellState.isPnf;
            delete cellState.isEveryOtherDay;
            delete cellState.isSharedPatient;
            delete cellState.isHydrotherapy;
        }

        cellState.isSplit = true;
        cellState.content1 = parts[0];
        cellState.content2 = parts[1];

        if (parts[0].trim().toLocaleLowerCase('pl-PL') === previousContent && previousPatientId && !cellState.patientId1) {
            cellState.patientId1 = previousPatientId;
        }

        if (parts[0].trim() !== '' && !cellState.treatmentData1?.startDate) {
            const today = getTodayDate();
            cellState.treatmentData1 = {
                startDate: today,
                extensionDays: 0,
                endDate: ScheduleLogic.calculateEndDate(today, 0),
            };
        }

        if (parts[1].trim() !== '' && !cellState.treatmentData2?.startDate) {
            const today = getTodayDate();
            cellState.treatmentData2 = {
                startDate: today,
                extensionDays: 0,
                endDate: ScheduleLogic.calculateEndDate(today, 0),
            };
        }

        cellState.patientId = null;
        ensurePatientId(cellState, 1);
        ensurePatientId(cellState, 2);
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

    const contentKey = `content${part}` as 'content1' | 'content2';
    const treatmentKey = `treatmentData${part}` as 'treatmentData1' | 'treatmentData2';

    const oldContent = ((cellState[contentKey] as string) || '').trim().toLowerCase();
    const newContent = newText.trim().toLowerCase();
    const isDifferentPatient = oldContent !== '' && oldContent !== newContent && newContent !== '';

    cellState[contentKey] = newText;

    let treatmentData = cellState[treatmentKey] as TreatmentData | undefined;

    if (newContent === '') {
        delete cellState[`patientId${part}`];
        delete cellState[treatmentKey];
        delete cellState[`isMassage${part}`];
        delete cellState[`isPnf${part}`];
        delete cellState[`isEveryOtherDay${part}`];
        delete cellState[`isSharedPatient${part}`];
        delete cellState[`isHydrotherapy${part}`];
        delete cellState[`absenceDates${part}`];
        return;
    }

    if (isDifferentPatient) {
        // Nowy pacjent w tej części - resetuj dane leczenia
        treatmentData = {
            startDate: getTodayDate(),
            extensionDays: 0,
            endDate: ScheduleLogic.calculateEndDate(getTodayDate(), 0),
            absenceDates: null,
        };
        cellState[treatmentKey] = treatmentData;
        delete cellState[`absenceDates${part}`];
        cellState[`patientId${part}`] = createPatientId();
    } else if (treatmentData?.startDate) {
        // Ten sam pacjent - przelicz tylko datę końcową
        treatmentData.endDate = ScheduleLogic.calculateEndDate(treatmentData.startDate, treatmentData.extensionDays ?? undefined);
    } else if (newContent !== '') {
        // Pierwszy wpis - ustaw nowe dane
        treatmentData = {
            startDate: getTodayDate(),
            extensionDays: 0,
            endDate: ScheduleLogic.calculateEndDate(getTodayDate(), 0),
        };
        cellState[treatmentKey] = treatmentData;
    }

    ensurePatientId(cellState, part);
};

/**
 * Aktualizuje normalną (niepodzieloną) komórkę
 */
const updateNormalCell = (cellState: CellState, newText: string): void => {
    const oldContent = (cellState.content || '').trim().toLowerCase();
    const newContent = newText.trim().toLowerCase();

    if (newContent === '') {
        cellState.content = '';
        cellState.patientId = null;
        cellState.treatmentStartDate = null;
        cellState.treatmentExtensionDays = null;
        cellState.treatmentEndDate = null;
        cellState.additionalInfo = null;
        cellState.absenceDates = null;
        cellState.isMassage = null;
        cellState.isPnf = null;
        cellState.isEveryOtherDay = null;
        cellState.isSharedPatient = null;
        cellState.isHydrotherapy = null;
        return;
    }

    // Sprawdź czy zawartość się zmieniła (inny pacjent)
    const contentChanged = oldContent !== newContent && newContent !== '';
    const isDifferentPatient = oldContent !== '' && oldContent !== newContent && newContent !== '';

    if (isDifferentPatient) {
        // Nowy pacjent - resetuj wszystkie dane leczenia
        cellState.treatmentStartDate = getTodayDate();
        cellState.treatmentExtensionDays = 0;
        cellState.additionalInfo = null;
        cellState.absenceDates = null;
        cellState.treatmentEndDate = ScheduleLogic.calculateEndDate(cellState.treatmentStartDate, 0);
        cellState.patientId = createPatientId();
    } else if (contentChanged) {
        // Pierwszy wpis w pustej komórce
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
    ensurePatientId(cellState, null);
};

/**
 * Wymusza poprawność i spójność dat leczenia na komórce (normalnej lub podzielonej).
 */
export const ensureActiveTreatmentDates = (
    state: CellState,
    options?: { resetIfExpired?: boolean; todayIso?: string }
): void => {
    const resetIfExpired = options?.resetIfExpired ?? false;
    const todayIso = options?.todayIso || getTodayDate();

    const processTreatmentData = (data: TreatmentData | null | undefined, hasContent: boolean): TreatmentData | undefined => {
        if (!data && !hasContent) return undefined;
        const current = data ? { ...data } : {};
        const extDays = typeof current.extensionDays === 'number' ? current.extensionDays : 0;
        const currentEnd = current.endDate || (current.startDate ? ScheduleLogic.calculateEndDate(current.startDate, extDays) : null);
        const isExpired = !!(currentEnd && currentEnd < todayIso);

        if (resetIfExpired && isExpired) {
            current.startDate = todayIso;
            current.extensionDays = 0;
            current.endDate = ScheduleLogic.calculateEndDate(todayIso, 0);
            return current;
        }

        if (!current.startDate) {
            current.startDate = todayIso;
            current.extensionDays = extDays;
            current.endDate = ScheduleLogic.calculateEndDate(todayIso, extDays);
            return current;
        }

        if (current.extensionDays === undefined || current.extensionDays === null) {
            current.extensionDays = 0;
        }

        if (!current.endDate) {
            current.endDate = currentEnd || ScheduleLogic.calculateEndDate(current.startDate, current.extensionDays);
        }

        return current;
    };

    if (state.isSplit) {
        const hasContent1 = typeof state.content1 === 'string' && state.content1.trim() !== '';
        if (state.treatmentData1 || hasContent1) {
            state.treatmentData1 = processTreatmentData(state.treatmentData1, hasContent1);
        }

        const hasContent2 = typeof state.content2 === 'string' && state.content2.trim() !== '';
        if (state.treatmentData2 || hasContent2) {
            state.treatmentData2 = processTreatmentData(state.treatmentData2, hasContent2);
        }
        return;
    }

    const hasContent = typeof state.content === 'string' && state.content.trim() !== '';
    if (hasContent || state.treatmentStartDate || state.treatmentEndDate) {
        const extDays = typeof state.treatmentExtensionDays === 'number' ? state.treatmentExtensionDays : 0;
        const currentEnd = state.treatmentEndDate || (state.treatmentStartDate ? ScheduleLogic.calculateEndDate(state.treatmentStartDate, extDays) : null);
        const isExpired = !!(currentEnd && currentEnd < todayIso);

        if (resetIfExpired && isExpired) {
            state.treatmentStartDate = todayIso;
            state.treatmentExtensionDays = 0;
            state.treatmentEndDate = ScheduleLogic.calculateEndDate(todayIso, 0);
        } else {
            if (!state.treatmentStartDate) {
                state.treatmentStartDate = todayIso;
            }
            if (state.treatmentExtensionDays === undefined || state.treatmentExtensionDays === null) {
                state.treatmentExtensionDays = 0;
            }
            if (!state.treatmentEndDate) {
                state.treatmentEndDate = currentEnd || ScheduleLogic.calculateEndDate(state.treatmentStartDate, state.treatmentExtensionDays);
            }
        }
    }
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
