// scripts/data-validation.js
/**
 * Funkcje walidacji danych przed zapisem do Firestore
 * Zapobiega zapisywaniu nieprawidłowych lub niespójnych danych
 */

/**
 * Dozwolone klucze dla stanu komórki
 */
export const ALLOWED_CELL_KEYS = [
    'content',
    'content1',
    'content2',
    'isSplit',
    'isBreak',
    'isMassage',
    'isMassage1',
    'isMassage2',
    'isPnf',
    'isPnf1',
    'isPnf2',
    'isEveryOtherDay',
    'isEveryOtherDay1',
    'isEveryOtherDay2',
    'treatmentStartDate',
    'treatmentExtensionDays',
    'treatmentEndDate',
    'additionalInfo',
    'treatmentData1',
    'treatmentData2',
    'history',
];

/**
 * Dozwolone klucze dla danych leczenia (treatmentData)
 */
export const ALLOWED_TREATMENT_KEYS = ['startDate', 'extensionDays', 'endDate', 'additionalInfo'];

/**
 * Waliduje format daty YYYY-MM-DD
 * @param {string} dateStr - String z datą
 * @returns {boolean}
 */
export const isValidDate = (dateStr) => {
    if (!dateStr || typeof dateStr !== 'string') return false;
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateStr)) return false;

    // Parsuj części daty
    const parts = dateStr.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);

    // Sprawdź zakresy
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;

    // Utwórz datę i sprawdź czy nie została automatycznie skorygowana
    // np. 2024-02-30 staje się 2024-03-01 - to wykryjemy
    const date = new Date(year, month - 1, day);
    if (isNaN(date.getTime())) return false;

    // Upewnij się, że data nie została skorygowana
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

/**
 * Waliduje wartość boolean lub null
 * @param {*} value - Wartość do sprawdzenia
 * @returns {boolean}
 */
export const isValidBoolean = (value) => {
    return value === null || value === undefined || typeof value === 'boolean';
};

/**
 * Waliduje treść komórki (tekst pacjenta)
 * @param {string} content - Treść komórki
 * @returns {{valid: boolean, error?: string}}
 */
export const validateCellContent = (content) => {
    if (content === null || content === undefined || content === '') {
        return { valid: true };
    }

    if (typeof content !== 'string') {
        return { valid: false, error: 'Treść komórki musi być tekstem' };
    }

    if (content.length > 50) {
        return { valid: false, error: 'Treść komórki nie może przekraczać 50 znaków' };
    }

    // Sprawdź czy nie zawiera niebezpiecznych znaków
    const dangerousPatterns = [/<script/i, /javascript:/i, /on\w+=/i];
    for (const pattern of dangerousPatterns) {
        if (pattern.test(content)) {
            return { valid: false, error: 'Treść zawiera niedozwolone znaki' };
        }
    }

    return { valid: true };
};

/**
 * Waliduje dane leczenia (treatmentData)
 * @param {Object} data - Obiekt z danymi leczenia
 * @returns {{valid: boolean, error?: string}}
 */
export const validateTreatmentData = (data) => {
    if (!data || typeof data !== 'object') {
        return { valid: true }; // null/undefined is OK
    }

    // Sprawdź czy nie ma nieznanych kluczy
    for (const key of Object.keys(data)) {
        if (!ALLOWED_TREATMENT_KEYS.includes(key)) {
            return { valid: false, error: `Nieznany klucz w danych leczenia: ${key}` };
        }
    }

    // Waliduj daty
    if (data.startDate !== null && data.startDate !== undefined && !isValidDate(data.startDate)) {
        return { valid: false, error: 'Nieprawidłowy format daty rozpoczęcia' };
    }

    if (data.endDate !== null && data.endDate !== undefined && !isValidDate(data.endDate)) {
        return { valid: false, error: 'Nieprawidłowy format daty zakończenia' };
    }

    // Waliduj extensionDays
    if (data.extensionDays !== null && data.extensionDays !== undefined) {
        if (typeof data.extensionDays !== 'number' || data.extensionDays < 0 || data.extensionDays > 365) {
            return { valid: false, error: 'Dni przedłużenia muszą być liczbą od 0 do 365' };
        }
    }

    return { valid: true };
};

/**
 * Waliduje pojedynczy stan komórki
 * @param {Object} cellState - Stan komórki
 * @returns {{valid: boolean, errors: string[]}}
 */
export const validateCellState = (cellState) => {
    const errors = [];

    if (!cellState || typeof cellState !== 'object') {
        return { valid: false, errors: ['Stan komórki musi być obiektem'] };
    }

    // Sprawdź czy nie ma nieznanych kluczy
    for (const key of Object.keys(cellState)) {
        if (!ALLOWED_CELL_KEYS.includes(key)) {
            errors.push(`Nieznany klucz w stanie komórki: ${key}`);
        }
    }

    // Waliduj treść
    const contentValidation = validateCellContent(cellState.content);
    if (!contentValidation.valid) errors.push(contentValidation.error);

    const content1Validation = validateCellContent(cellState.content1);
    if (!content1Validation.valid) errors.push(`content1: ${content1Validation.error}`);

    const content2Validation = validateCellContent(cellState.content2);
    if (!content2Validation.valid) errors.push(`content2: ${content2Validation.error}`);

    // Waliduj flagi boolean
    const booleanFields = [
        'isSplit',
        'isBreak',
        'isMassage',
        'isMassage1',
        'isMassage2',
        'isPnf',
        'isPnf1',
        'isPnf2',
        'isEveryOtherDay',
        'isEveryOtherDay1',
        'isEveryOtherDay2',
    ];

    for (const field of booleanFields) {
        if (cellState[field] !== undefined && !isValidBoolean(cellState[field])) {
            errors.push(`${field} musi być wartością boolean lub null`);
        }
    }

    // Waliduj daty
    if (
        cellState.treatmentStartDate !== null &&
        cellState.treatmentStartDate !== undefined &&
        !isValidDate(cellState.treatmentStartDate)
    ) {
        errors.push('Nieprawidłowy format daty rozpoczęcia');
    }

    if (
        cellState.treatmentEndDate !== null &&
        cellState.treatmentEndDate !== undefined &&
        !isValidDate(cellState.treatmentEndDate)
    ) {
        errors.push('Nieprawidłowy format daty zakończenia');
    }

    // Waliduj treatmentData1 i treatmentData2
    const td1Validation = validateTreatmentData(cellState.treatmentData1);
    if (!td1Validation.valid) errors.push(`treatmentData1: ${td1Validation.error}`);

    const td2Validation = validateTreatmentData(cellState.treatmentData2);
    if (!td2Validation.valid) errors.push(`treatmentData2: ${td2Validation.error}`);

    // Sprawdź spójność - jeśli isSplit to content powinien być pusty
    if (cellState.isSplit && cellState.content && cellState.content.trim() !== '') {
        errors.push('Podzielona komórka nie powinna mieć content, tylko content1/content2');
    }

    return {
        valid: errors.length === 0,
        errors,
    };
};

/**
 * Waliduje cały stan harmonogramu
 * @param {Object} scheduleCells - Obiekt ze stanami komórek
 * @returns {{valid: boolean, errors: string[]}}
 */
export const validateScheduleState = (scheduleCells) => {
    const errors = [];

    if (!scheduleCells || typeof scheduleCells !== 'object') {
        return { valid: false, errors: ['scheduleCells musi być obiektem'] };
    }

    for (const time of Object.keys(scheduleCells)) {
        // Waliduj format czasu (HH:MM lub podobny)
        if (!/^\d{1,2}:\d{2}$/.test(time)) {
            errors.push(`Nieprawidłowy format czasu: ${time}`);
            continue;
        }

        const timeSlot = scheduleCells[time];
        if (!timeSlot || typeof timeSlot !== 'object') {
            errors.push(`Nieprawidłowy slot czasowy dla ${time}`);
            continue;
        }

        for (const employeeIndex of Object.keys(timeSlot)) {
            const cellValidation = validateCellState(timeSlot[employeeIndex]);
            if (!cellValidation.valid) {
                errors.push(`Komórka [${time}][${employeeIndex}]: ${cellValidation.errors.join(', ')}`);
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors,
    };
};

/**
 * Czyści stan komórki z niedozwolonych kluczy (sanityzacja)
 * @param {Object} cellState - Stan komórki
 * @returns {Object} - Oczyszczony stan
 */
export const sanitizeCellState = (cellState) => {
    if (!cellState || typeof cellState !== 'object') return {};

    const sanitized = {};

    for (const key of ALLOWED_CELL_KEYS) {
        if (key in cellState) {
            const value = cellState[key];

            // Specjalna obsługa dla treatmentData
            if (key === 'treatmentData1' || key === 'treatmentData2') {
                if (value && typeof value === 'object') {
                    sanitized[key] = sanitizeTreatmentData(value);
                }
            } else if (key === 'history') {
                // Zachowaj historię bez zmian (ale ogranicz rozmiar)
                if (Array.isArray(value)) {
                    sanitized[key] = value.slice(0, 10);
                }
            } else {
                sanitized[key] = value;
            }
        }
    }

    return sanitized;
};

/**
 * Czyści dane leczenia z niedozwolonych kluczy
 * @param {Object} data - Dane leczenia
 * @returns {Object} - Oczyszczone dane
 */
export const sanitizeTreatmentData = (data) => {
    if (!data || typeof data !== 'object') return null;

    const sanitized = {};
    for (const key of ALLOWED_TREATMENT_KEYS) {
        if (key in data) {
            sanitized[key] = data[key];
        }
    }

    return Object.keys(sanitized).length > 0 ? sanitized : null;
};
