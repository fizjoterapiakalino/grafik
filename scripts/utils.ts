// scripts/utils.ts
// Centralne funkcje pomocnicze używane w całej aplikacji

import type { TreatmentData, CellState } from './types/index.js';

// Re-eksportuj typy dla kompatybilności wstecznej
export type { TreatmentData, CellState } from './types/index.js';

/**
 * Bezpiecznie kopiuje wartość, zwracając null jeśli wartość jest undefined.
 * Używane do zapobiegania zapisywania undefined do Firestore.
 */
export const safeCopy = <T>(val: T | undefined): T | null =>
    (val === undefined ? null : val);

/**
 * Bezpiecznie konwertuje wartość na boolean, zwracając false jeśli undefined.
 */
export const safeBool = (val: unknown): boolean =>
    (val === undefined ? false : !!val);

const clone = typeof structuredClone === 'function' ? structuredClone : <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

/**
 * Tworzy głęboką kopię obiektu lub tablicy.
 */
export const deepClone = <T>(obj: T): T => clone(obj);

/**
 * Lista kluczy zawartości komórki używanych do czyszczenia/kopiowania.
 */
export const CELL_CONTENT_KEYS = [
    'content',
    'patientId',
    'content1',
    'content2',
    'patientId1',
    'patientId2',
    'isSplit',
    'isMassage',
    'isMassage1',
    'isMassage2',
    'isPnf',
    'isPnf1',
    'isPnf2',
    'isEveryOtherDay',
    'isEveryOtherDay1',
    'isEveryOtherDay2',
    'isSharedPatient',
    'isSharedPatient1',
    'isSharedPatient2',
    'isHydrotherapy',
    'isHydrotherapy1',
    'isHydrotherapy2',
    'treatmentStartDate',
    'treatmentExtensionDays',
    'treatmentEndDate',
    'additionalInfo',
    'treatmentData1',
    'treatmentData2',
] as const;

export type CellContentKey = typeof CELL_CONTENT_KEYS[number];

/**
 * Czyści wszystkie klucze zawartości z obiektu stanu komórki.
 */
export const clearCellContentKeys = (state: CellState): void => {
    for (const key of CELL_CONTENT_KEYS) {
        state[key] = null;
    }
};

/**
 * Źródło danych leczenia (może być obiekt z treatment lub treatmentData)
 */
interface TreatmentSource {
    treatmentStartDate?: string | null;
    treatmentExtensionDays?: number | null;
    treatmentEndDate?: string | null;
    startDate?: string | null;
    extensionDays?: number | null;
    endDate?: string | null;
    additionalInfo?: string | null;
    treatmentData1?: TreatmentData;
    treatmentData2?: TreatmentData;
}

/**
 * Kopiuje dane treatment do obiektu docelowego.
 * @param source - Obiekt źródłowy z danymi treatment
 * @param target - Obiekt docelowy
 * @param suffix - Opcjonalny suffix dla kluczy (np. '1' dla treatmentData1)
 */
export const copyTreatmentData = (
    source: TreatmentSource,
    target: CellState,
    suffix: string = ''
): void => {
    const treatmentDataKey = `treatmentData${suffix}` as keyof TreatmentSource;
    const treatmentData: TreatmentData = suffix
        ? (source[treatmentDataKey] as TreatmentData) || {}
        : source;

    if (suffix) {
        const targetKey = `treatmentData${suffix}` as keyof CellState;
        (target as Record<string, unknown>)[targetKey] = {
            startDate: safeCopy(treatmentData.startDate),
            extensionDays: safeCopy(treatmentData.extensionDays),
            endDate: safeCopy(treatmentData.endDate),
            additionalInfo: safeCopy(treatmentData.additionalInfo),
        };
    } else {
        target.treatmentStartDate = safeCopy(
            (source as TreatmentSource).treatmentStartDate ?? treatmentData.startDate
        );
        target.treatmentExtensionDays = safeCopy(
            (source as TreatmentSource).treatmentExtensionDays ?? treatmentData.extensionDays
        );
        target.treatmentEndDate = safeCopy(
            (source as TreatmentSource).treatmentEndDate ?? treatmentData.endDate
        );
        target.additionalInfo = safeCopy(treatmentData.additionalInfo);
    }
};

// ==========================================
// Funkcje pomocnicze dla dat UTC
// ==========================================

/**
 * Konwertuje string daty (YYYY-MM-DD) na obiekt Date w UTC.
 * Ważne: używaj tej funkcji zamiast new Date(string) aby uniknąć
 * problemów ze strefami czasowymi.
 * 
 * @param dateString - Data w formacie YYYY-MM-DD
 * @returns Obiekt Date z czasem 00:00:00 UTC
 * 
 * @example
 * toUTCDate('2025-12-31') // Date: 2025-12-31T00:00:00.000Z
 */
export const toUTCDate = (dateString: string): Date => {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
};

/**
 * Konwertuje obiekt Date na string w formacie YYYY-MM-DD.
 * Używa UTC aby uniknąć problemów ze strefami czasowymi.
 * 
 * @param date - Obiekt Date
 * @returns String w formacie YYYY-MM-DD
 * 
 * @example
 * toDateString(new Date(Date.UTC(2025, 11, 31))) // '2025-12-31'
 */
export const toDateString = (date: Date): string => {
    return date.toISOString().split('T')[0];
};

/**
 * Konwertuje obiekt Date na lokalny string YYYY-MM-DD (bez przesunięcia UTC o północy).
 */
export const formatLocalIsoDate = (date: Date = new Date()): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Sprawdza czy URL używa bezpiecznego protokołu HTTP/HTTPS (blokuje javascript:, data:, vbscript:).
 */
export const isSafeHttpUrl = (rawUrl: string): boolean => {
    if (!rawUrl || /^\s*(javascript|data|vbscript):/i.test(rawUrl)) return false;
    try {
        const base =
            typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
                ? window.location.origin
                : 'https://localhost';
        const parsed = new URL(rawUrl, base);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
        return false;
    }
};

/**
 * Formatuje datę do formatu DD.MM.YYYY (polski format wyświetlania).
 * 
 * @param date - Obiekt Date
 * @returns String w formacie DD.MM.YYYY
 * 
 * @example
 * formatDatePL(new Date(Date.UTC(2025, 11, 31))) // '31.12.2025'
 */
export const formatDatePL = (date: Date): string => {
    const day = date.getUTCDate().toString().padStart(2, '0');
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${day}.${month}.${year}`;
};

/**
 * Sprawdza czy dany dzień jest dniem roboczym (Pn-Pt).
 * 
 * @param date - Obiekt Date
 * @returns true jeśli dzień roboczy, false jeśli weekend
 */
export const isWorkday = (date: Date): boolean => {
    const day = date.getUTCDay();
    return day !== 0 && day !== 6;
};

/**
 * Zabezpiecza tekst przed XSS, kodując znaki specjalne HTML.
 */
export const escapeHTML = (str: string): string => {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};
