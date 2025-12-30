// scripts/data-validation.ts
/**
 * Funkcje walidacji danych przed zapisem do Firestore
 * Zapobiega zapisywaniu nieprawidłowych lub niespójnych danych
 */

/**
 * Wynik walidacji
 */
export interface ValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * Wynik walidacji z wieloma błędami
 */
export interface ValidationResultMultiple {
    valid: boolean;
    errors: string[];
}

/**
 * Dane leczenia
 */
export interface TreatmentDataForValidation {
    startDate?: string | null;
    extensionDays?: number | null;
    endDate?: string | null;
    additionalInfo?: string | null;
}

/**
 * Stan komórki do walidacji
 */
export interface CellStateForValidation {
    content?: string | null;
    content1?: string | null;
    content2?: string | null;
    isSplit?: boolean | null;
    isBreak?: boolean | null;
    isMassage?: boolean | null;
    isMassage1?: boolean | null;
    isMassage2?: boolean | null;
    isPnf?: boolean | null;
    isPnf1?: boolean | null;
    isPnf2?: boolean | null;
    isEveryOtherDay?: boolean | null;
    isEveryOtherDay1?: boolean | null;
    isEveryOtherDay2?: boolean | null;
    treatmentStartDate?: string | null;
    treatmentExtensionDays?: number | null;
    treatmentEndDate?: string | null;
    additionalInfo?: string | null;
    treatmentData1?: TreatmentDataForValidation | null;
    treatmentData2?: TreatmentDataForValidation | null;
    history?: unknown[];
    [key: string]: unknown;
}

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
] as const;

export type AllowedCellKey = typeof ALLOWED_CELL_KEYS[number];

/**
 * Dozwolone klucze dla danych leczenia
 */
export const ALLOWED_TREATMENT_KEYS = ['startDate', 'extensionDays', 'endDate', 'additionalInfo'] as const;

export type AllowedTreatmentKey = typeof ALLOWED_TREATMENT_KEYS[number];

/**
 * Waliduje format daty YYYY-MM-DD
 */
export const isValidDate = (dateStr: unknown): boolean => {
    if (!dateStr || typeof dateStr !== 'string') return false;
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateStr)) return false;

    const parts = dateStr.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);

    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;

    const date = new Date(year, month - 1, day);
    if (isNaN(date.getTime())) return false;

    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

/**
 * Waliduje wartość boolean lub null
 */
export const isValidBoolean = (value: unknown): boolean => {
    return value === null || value === undefined || typeof value === 'boolean';
};

/**
 * Waliduje treść komórki
 */
export const validateCellContent = (content: unknown): ValidationResult => {
    if (content === null || content === undefined || content === '') {
        return { valid: true };
    }

    if (typeof content !== 'string') {
        return { valid: false, error: 'Treść komórki musi być tekstem' };
    }

    if (content.length > 50) {
        return { valid: false, error: 'Treść komórki nie może przekraczać 50 znaków' };
    }

    const dangerousPatterns = [/<script/i, /javascript:/i, /on\w+=/i];
    for (const pattern of dangerousPatterns) {
        if (pattern.test(content)) {
            return { valid: false, error: 'Treść zawiera niedozwolone znaki' };
        }
    }

    return { valid: true };
};

/**
 * Waliduje dane leczenia
 */
export const validateTreatmentData = (data: unknown): ValidationResult => {
    if (!data || typeof data !== 'object') {
        return { valid: true };
    }

    const typedData = data as Record<string, unknown>;

    for (const key of Object.keys(typedData)) {
        if (!ALLOWED_TREATMENT_KEYS.includes(key as AllowedTreatmentKey)) {
            return { valid: false, error: `Nieznany klucz w danych leczenia: ${key}` };
        }
    }

    if (typedData.startDate !== null && typedData.startDate !== undefined && !isValidDate(typedData.startDate)) {
        return { valid: false, error: 'Nieprawidłowy format daty rozpoczęcia' };
    }

    if (typedData.endDate !== null && typedData.endDate !== undefined && !isValidDate(typedData.endDate)) {
        return { valid: false, error: 'Nieprawidłowy format daty zakończenia' };
    }

    if (typedData.extensionDays !== null && typedData.extensionDays !== undefined) {
        const ext = typedData.extensionDays;
        if (typeof ext !== 'number' || ext < 0 || ext > 365) {
            return { valid: false, error: 'Dni przedłużenia muszą być liczbą od 0 do 365' };
        }
    }

    return { valid: true };
};

/**
 * Waliduje pojedynczy stan komórki
 */
export const validateCellState = (cellState: unknown): ValidationResultMultiple => {
    const errors: string[] = [];

    if (!cellState || typeof cellState !== 'object') {
        return { valid: false, errors: ['Stan komórki musi być obiektem'] };
    }

    const state = cellState as CellStateForValidation;

    for (const key of Object.keys(state)) {
        if (!ALLOWED_CELL_KEYS.includes(key as AllowedCellKey)) {
            errors.push(`Nieznany klucz w stanie komórki: ${key}`);
        }
    }

    const contentValidation = validateCellContent(state.content);
    if (!contentValidation.valid) errors.push(contentValidation.error!);

    const content1Validation = validateCellContent(state.content1);
    if (!content1Validation.valid) errors.push(`content1: ${content1Validation.error}`);

    const content2Validation = validateCellContent(state.content2);
    if (!content2Validation.valid) errors.push(`content2: ${content2Validation.error}`);

    const booleanFields = [
        'isSplit', 'isBreak', 'isMassage', 'isMassage1', 'isMassage2',
        'isPnf', 'isPnf1', 'isPnf2', 'isEveryOtherDay', 'isEveryOtherDay1', 'isEveryOtherDay2',
    ] as const;

    for (const field of booleanFields) {
        if (state[field] !== undefined && !isValidBoolean(state[field])) {
            errors.push(`${field} musi być wartością boolean lub null`);
        }
    }

    if (state.treatmentStartDate !== null && state.treatmentStartDate !== undefined && !isValidDate(state.treatmentStartDate)) {
        errors.push('Nieprawidłowy format daty rozpoczęcia');
    }

    if (state.treatmentEndDate !== null && state.treatmentEndDate !== undefined && !isValidDate(state.treatmentEndDate)) {
        errors.push('Nieprawidłowy format daty zakończenia');
    }

    const td1Validation = validateTreatmentData(state.treatmentData1);
    if (!td1Validation.valid) errors.push(`treatmentData1: ${td1Validation.error}`);

    const td2Validation = validateTreatmentData(state.treatmentData2);
    if (!td2Validation.valid) errors.push(`treatmentData2: ${td2Validation.error}`);

    if (state.isSplit && state.content && state.content.trim() !== '') {
        errors.push('Podzielona komórka nie powinna mieć content, tylko content1/content2');
    }

    return { valid: errors.length === 0, errors };
};

/**
 * Typ dla struktury harmonogramu
 */
type ScheduleCells = Record<string, Record<string, CellStateForValidation>>;

/**
 * Waliduje cały stan harmonogramu
 */
export const validateScheduleState = (scheduleCells: unknown): ValidationResultMultiple => {
    const errors: string[] = [];

    if (!scheduleCells || typeof scheduleCells !== 'object') {
        return { valid: false, errors: ['scheduleCells musi być obiektem'] };
    }

    const cells = scheduleCells as ScheduleCells;

    for (const time of Object.keys(cells)) {
        if (!/^\d{1,2}:\d{2}$/.test(time)) {
            errors.push(`Nieprawidłowy format czasu: ${time}`);
            continue;
        }

        const timeSlot = cells[time];
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

    return { valid: errors.length === 0, errors };
};

/**
 * Czyści dane leczenia z niedozwolonych kluczy
 */
export const sanitizeTreatmentData = (data: unknown): TreatmentDataForValidation | null => {
    if (!data || typeof data !== 'object') return null;

    const typedData = data as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};

    for (const key of ALLOWED_TREATMENT_KEYS) {
        if (key in typedData) {
            sanitized[key] = typedData[key];
        }
    }

    return Object.keys(sanitized).length > 0 ? sanitized as TreatmentDataForValidation : null;
};

/**
 * Czyści stan komórki z niedozwolonych kluczy
 */
export const sanitizeCellState = (cellState: unknown): CellStateForValidation => {
    if (!cellState || typeof cellState !== 'object') return {};

    const state = cellState as CellStateForValidation;
    const sanitized: CellStateForValidation = {};

    for (const key of ALLOWED_CELL_KEYS) {
        if (key in state) {
            const value = state[key];

            if (key === 'treatmentData1' || key === 'treatmentData2') {
                if (value && typeof value === 'object') {
                    sanitized[key] = sanitizeTreatmentData(value);
                }
            } else if (key === 'history') {
                if (Array.isArray(value)) {
                    sanitized[key] = value.slice(0, 10);
                }
            } else {
                (sanitized as Record<string, unknown>)[key] = value;
            }
        }
    }

    return sanitized;
};
