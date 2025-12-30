// scripts/schedule-helpers.js
/**
 * Funkcje pomocnicze do operacji na komórkach harmonogramu.
 * Wydzielone z schedule.js dla lepszej czytelności i testowalności.
 */

import { safeCopy, safeBool } from './utils.js';
import { ScheduleLogic } from './schedule-logic.js';

/**
 * Określa numer części podzielonej komórki (1 lub 2) na podstawie elementu DOM
 * @param {HTMLElement} element - Edytowany element
 * @returns {number|null} - 1 lub 2 dla podzielonej komórki, null dla normalnej
 */
export const getTargetPart = (element) => {
    if (element.tagName === 'DIV' && element.parentNode.classList.contains('split-cell-wrapper')) {
        return element === element.parentNode.children[0] ? 1 : 2;
    }
    return null;
};

/**
 * Określa z której części podzielonej komórki pochodzi tekst
 * @param {Object} cellState - Stan komórki źródłowej
 * @param {string} text - Szukany tekst
 * @returns {number|null} - 1 lub 2 dla podzielonej komórki, null dla normalnej
 */
export const getSourcePart = (cellState, text) => {
    if (!cellState.isSplit) return null;
    const lowerText = text.toLowerCase();
    if (cellState.content1?.toLowerCase() === lowerText) return 1;
    if (cellState.content2?.toLowerCase() === lowerText) return 2;
    return null;
};

/**
 * Pobiera dane leczenia z komórki (obsługuje zarówno split jak i normal)
 * @param {Object} cellState - Stan komórki
 * @param {number|null} part - Część komórki (1 lub 2) lub null dla normalnej
 * @returns {Object} - Obiekt z danymi leczenia
 */
export const getTreatmentData = (cellState, part) => {
    if (part) {
        return cellState[`treatmentData${part}`] || {};
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
 * @param {Object} source - Stan źródłowy
 * @param {Object} target - Stan docelowy
 * @param {number|null} sourcePart - Część źródłowa
 * @param {number|null} targetPart - Część docelowa
 */
export const copyFlags = (source, target, sourcePart, targetPart) => {
    const flags = ['isMassage', 'isPnf', 'isEveryOtherDay'];

    flags.forEach((flag) => {
        const sourceKey = sourcePart ? `${flag}${sourcePart}` : flag;
        const targetKey = targetPart ? `${flag}${targetPart}` : flag;
        target[targetKey] = safeBool(source[sourceKey]);
    });
};

/**
 * Kopiuje dane leczenia do komórki docelowej
 * @param {Object} treatmentData - Dane leczenia źródłowe
 * @param {Object} target - Stan docelowy
 * @param {number|null} targetPart - Część docelowa (null = normalna komórka)
 */
export const copyTreatmentToTarget = (treatmentData, target, targetPart) => {
    if (targetPart) {
        target[`treatmentData${targetPart}`] = {
            startDate: safeCopy(treatmentData.startDate),
            extensionDays: safeCopy(treatmentData.extensionDays),
            endDate: safeCopy(treatmentData.endDate),
            additionalInfo: safeCopy(treatmentData.additionalInfo),
        };
    } else {
        target.treatmentStartDate = safeCopy(treatmentData.startDate);
        target.treatmentExtensionDays = safeCopy(treatmentData.extensionDays);
        target.treatmentEndDate = safeCopy(treatmentData.endDate);
        target.additionalInfo = safeCopy(treatmentData.additionalInfo);
    }
};

/**
 * Czyści pola specyficzne dla podzielonej komórki
 * @param {Object} state - Stan komórki
 */
export const clearSplitFields = (state) => {
    const splitFields = [
        'content1',
        'content2',
        'isMassage1',
        'isMassage2',
        'isPnf1',
        'isPnf2',
        'isEveryOtherDay1',
        'isEveryOtherDay2',
        'treatmentData1',
        'treatmentData2',
    ];
    splitFields.forEach((field) => delete state[field]);
};

/**
 * Tworzy funkcję aktualizacji dla komórki docelowej przy przenoszeniu
 * @param {Object} oldCellState - Stan starej komórki
 * @param {number|null} sourcePart - Część źródłowa
 * @param {number|null} targetPart - Część docelowa
 * @returns {Function} - Funkcja aktualizacji stanu
 */
export const createTargetUpdateFn = (oldCellState, sourcePart, targetPart) => {
    return (cellState) => {
        if (targetPart) {
            // Przenoszenie DO części podzielonej komórki
            cellState[`content${targetPart}`] = safeCopy(
                sourcePart ? oldCellState[`content${sourcePart}`] : oldCellState.content,
            );

            copyFlags(oldCellState, cellState, sourcePart, targetPart);

            const treatmentData = getTreatmentData(oldCellState, sourcePart);
            copyTreatmentToTarget(treatmentData, cellState, targetPart);
        } else if (sourcePart) {
            // Przenoszenie Z części podzielonej komórki DO normalnej
            cellState.content = safeCopy(oldCellState[`content${sourcePart}`]);
            cellState.isSplit = false;

            copyFlags(oldCellState, cellState, sourcePart, null);

            const treatmentData = getTreatmentData(oldCellState, sourcePart);
            copyTreatmentToTarget(treatmentData, cellState, null);

            clearSplitFields(cellState);
        } else {
            // Przenoszenie z normalnej do normalnej (pełna kopia)
            copyFullCellState(oldCellState, cellState);
        }
    };
};

/**
 * Kopiuje pełny stan komórki (dla przenoszenia normal -> normal)
 * @param {Object} source - Stan źródłowy
 * @param {Object} target - Stan docelowy
 */
export const copyFullCellState = (source, target) => {
    target.content = safeCopy(source.content);
    target.isSplit = safeBool(source.isSplit);
    target.content1 = safeCopy(source.content1);
    target.content2 = safeCopy(source.content2);

    // Kopiuj wszystkie flagi
    ['isMassage', 'isPnf', 'isEveryOtherDay'].forEach((flag) => {
        target[flag] = safeBool(source[flag]);
        target[`${flag}1`] = safeBool(source[`${flag}1`]);
        target[`${flag}2`] = safeBool(source[`${flag}2`]);
    });

    // Kopiuj dane leczenia
    target.treatmentStartDate = safeCopy(source.treatmentStartDate);
    target.treatmentExtensionDays = safeCopy(source.treatmentExtensionDays);
    target.treatmentEndDate = safeCopy(source.treatmentEndDate);
    target.additionalInfo = safeCopy(source.additionalInfo);

    // Kopiuj dane leczenia dla split cells
    if (source.treatmentData1) {
        target.treatmentData1 = JSON.parse(JSON.stringify(source.treatmentData1));
    }
    if (source.treatmentData2) {
        target.treatmentData2 = JSON.parse(JSON.stringify(source.treatmentData2));
    }
};

/**
 * Tworzy funkcję czyszczenia źródłowej komórki
 * @param {number|null} sourcePart - Część do wyczyszczenia
 * @returns {Function} - Funkcja czyszczenia stanu
 */
export const createSourceClearFn = (sourcePart) => {
    return (state) => {
        if (sourcePart) {
            // Wyczyść tylko konkretną część
            state[`content${sourcePart}`] = '';
            delete state[`isMassage${sourcePart}`];
            delete state[`isPnf${sourcePart}`];
            delete state[`isEveryOtherDay${sourcePart}`];
            delete state[`treatmentData${sourcePart}`];

            // Jeśli obie części są puste, wyczyść całą komórkę
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
 * @param {Object} state - Obiekt stanu
 */
export const clearAllProperties = (state) => {
    for (const key in state) {
        if (Object.prototype.hasOwnProperty.call(state, key)) {
            delete state[key];
        }
    }
};

/**
 * Tworzy datę dzisiejszą w formacie YYYY-MM-DD
 * @returns {string}
 */
export const getTodayDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Aktualizuje stan komórki przy standardowej edycji (nie przenoszeniu)
 * @param {Object} cellState - Stan komórki
 * @param {string} newText - Nowy tekst
 * @param {number|null} targetPart - Część docelowa
 * @param {HTMLElement} element - Element DOM
 * @param {HTMLElement} parentCell - Komórka rodzic
 */
export const updateCellContent = (cellState, newText, targetPart, element, parentCell) => {
    if (newText.includes('/')) {
        // Tekst z "/" tworzy podzieloną komórkę
        const parts = newText.split('/', 2);
        cellState.isSplit = true;
        cellState.content1 = parts[0];
        cellState.content2 = parts[1];
    } else if (cellState.isSplit) {
        // Edycja części podzielonej komórki
        updateSplitCellPart(cellState, newText, targetPart, element, parentCell);
    } else {
        // Edycja normalnej komórki
        updateNormalCell(cellState, newText);
    }
};

/**
 * Aktualizuje część podzielonej komórki
 * @param {Object} cellState - Stan komórki
 * @param {string} newText - Nowy tekst
 * @param {number|null} targetPart - Część docelowa
 * @param {HTMLElement} element - Element DOM
 * @param {HTMLElement} parentCell - Komórka rodzic
 */
const updateSplitCellPart = (cellState, newText, targetPart, element, parentCell) => {
    let part = targetPart;

    // Fallback jeśli targetPart nie zostało określone
    if (!part) {
        const isFirstDiv = element === parentCell.querySelector('.split-cell-wrapper > div:first-child');
        part = isFirstDiv ? 1 : 2;
    }

    cellState[`content${part}`] = newText;

    // Przelicz datę końcową jeśli istnieją dane leczenia
    const treatmentData = cellState[`treatmentData${part}`];
    if (treatmentData?.startDate) {
        treatmentData.endDate = ScheduleLogic.calculateEndDate(treatmentData.startDate, treatmentData.extensionDays);
    }
};

/**
 * Aktualizuje normalną (niepodzieloną) komórkę
 * @param {Object} cellState - Stan komórki
 * @param {string} newText - Nowy tekst
 */
const updateNormalCell = (cellState, newText) => {
    const oldContent = cellState.content || '';
    const contentChanged = oldContent.trim().toLowerCase() !== newText.trim().toLowerCase() && newText.trim() !== '';

    if (contentChanged) {
        // Treść się zmieniła - upewnij się że mamy datę rozpoczęcia
        if (!cellState.treatmentStartDate) {
            cellState.treatmentStartDate = getTodayDate();
        }
        cellState.additionalInfo = cellState.additionalInfo || null;
        cellState.treatmentExtensionDays = cellState.treatmentExtensionDays || 0;
        cellState.treatmentEndDate = ScheduleLogic.calculateEndDate(
            cellState.treatmentStartDate,
            cellState.treatmentExtensionDays,
        );
    }

    cellState.content = newText;
};

/**
 * Inicjalizuje dane leczenia dla nowej komórki
 * @param {Object} cellState - Stan komórki
 */
export const initTreatmentData = (cellState) => {
    if (!cellState.treatmentStartDate && !cellState.isSplit && cellState.content) {
        cellState.treatmentStartDate = getTodayDate();
        cellState.treatmentEndDate = ScheduleLogic.calculateEndDate(cellState.treatmentStartDate, 0);
    }
};
